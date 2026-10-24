"""Walking times across Paris on the Overture street network.

The rings of six neighbouring blocks used so far treat a river or a rail yard as
walkable. Catchments here follow real streets, footways and bridges instead: every
block centre is snapped to the network and walked from, up to LIMIT_MIN minutes.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass

import h3
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
import shapely
from scipy.sparse import coo_matrix, csr_matrix
from scipy.sparse.csgraph import connected_components, dijkstra
from scipy.spatial import cKDTree

from adresse_pipeline.model import OUTPUT, WEB_DATA
from adresse_pipeline.overture import PARIS_PADDED, _inside, dataset

# 4.8 km/h, the usual planning speed for city walking
METRES_PER_MIN = 80.0
LIMIT_MIN = 20.0
CATCHMENT_MIN = 10.0
# Road classes a pedestrian cannot use: the Périphérique and motorways.
NOT_WALKABLE = frozenset({"motorway", "trunk"})
ORIGIN = (2.3470, 48.8590)  # lon, lat near the city centre, for the local metric projection


def to_metres(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Equirectangular metres around ORIGIN: under 0.1% error across Paris."""
    k = math.cos(math.radians(ORIGIN[1]))
    return np.column_stack(((lon - ORIGIN[0]) * 111_320 * k, (lat - ORIGIN[1]) * 110_540))


@dataclass(frozen=True)
class WalkGraph:
    """Street network as a weighted graph: nodes are Overture connectors."""

    edges: csr_matrix  # minutes between adjacent connectors
    xy: np.ndarray  # node positions in metres, shape (n, 2)

    def snap(self, lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Nearest network node for each point, and the minutes to walk to it."""
        metres, idx = cKDTree(self.xy).query(to_metres(lon, lat))
        return idx, metres / METRES_PER_MIN

    def minutes_from(self, sources: np.ndarray, limit: float = LIMIT_MIN) -> np.ndarray:
        """Walking minutes from each source node to every node; inf beyond the limit."""
        return dijkstra(self.edges, directed=False, indices=sources, limit=limit)


def read_segments(release: str) -> pa.Table:
    table = dataset(release, "transportation", "segment").to_table(
        columns=["class", "geometry", "connectors"],
        filter=_inside(PARIS_PADDED) & (pc.field("subtype") == "road"),
    )
    return walkable(table)


def walkable(segments: pa.Table) -> pa.Table:
    keep = pc.invert(pc.is_in(segments["class"], pa.array(sorted(NOT_WALKABLE))))
    return segments.filter(pc.fill_null(keep, True))


def build_graph(segments: pa.Table) -> WalkGraph:
    """Split each segment at its connectors and weight each piece by walking time."""
    ids: dict[str, int] = {}
    pos: list[tuple[float, float]] = []
    src: list[int] = []
    dst: list[int] = []
    minutes: list[float] = []
    geoms = shapely.from_wkb(segments["geometry"].to_numpy(zero_copy_only=False))
    for geom, connectors in zip(geoms, segments["connectors"].to_pylist(), strict=True):
        if not connectors or len(connectors) < 2:
            continue
        coords = np.asarray(geom.coords)
        xy = to_metres(coords[:, 0], coords[:, 1])
        line = shapely.LineString(xy)
        nodes = []
        for c in connectors:
            point = geom.interpolate(c["at"], normalized=True)
            if c["connector_id"] not in ids:
                ids[c["connector_id"]] = len(pos)
                pos.append((point.x, point.y))
            nodes.append((c["at"] * line.length, ids[c["connector_id"]]))
        for (a_m, a), (b_m, b) in zip(nodes, nodes[1:], strict=False):
            if a != b:
                src.append(a)
                dst.append(b)
                minutes.append(max(b_m - a_m, 0.1) / METRES_PER_MIN)
    # a sparse matrix sums repeated entries, so keep only the shortest piece per pair
    pieces = (
        pd.DataFrame({"a": np.minimum(src, dst), "b": np.maximum(src, dst), "minutes": minutes})
        .groupby(["a", "b"], as_index=False)["minutes"]
        .min()
    )
    n = len(pos)
    edges = coo_matrix((pieces["minutes"], (pieces["a"], pieces["b"])), shape=(n, n)).tocsr()
    # Islands (a courtyard path, a footway cut at the bbox edge) would trap a snapped
    # block centre, so keep only the main network.
    _, label = connected_components(edges, directed=False)
    main = np.flatnonzero(label == np.bincount(label).argmax())
    lonlat = np.asarray(pos)[main]
    return WalkGraph(edges[main][:, main], to_metres(lonlat[:, 0], lonlat[:, 1]))


def cell_centres(cells: list[str]) -> tuple[np.ndarray, np.ndarray]:
    lat, lon = np.array([h3.cell_to_latlng(c) for c in cells]).T
    return lon, lat


def block_times(graph: WalkGraph, cells: list[str], limit: float = LIMIT_MIN) -> pd.DataFrame:
    """Walking minutes between block centres, for every pair within the limit."""
    nodes, access = graph.snap(*cell_centres(cells))
    # a block centre in a park or rail yard is a walk away from the nearest path
    times = graph.minutes_from(nodes, limit)[:, nodes] + access[:, None] + access[None, :]
    np.fill_diagonal(times, 0.0)
    times[times > limit] = np.inf
    origin, dest = np.nonzero(np.isfinite(times))
    return pd.DataFrame(
        {
            "origin": np.asarray(cells)[origin],
            "dest": np.asarray(cells)[dest],
            "minutes": times[origin, dest].round(2).astype("float32"),
        }
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--overture-release", required=True)
    args = parser.parse_args()
    graph = build_graph(read_segments(args.overture_release))
    cells = pd.read_csv(OUTPUT / "paris_h3_features.csv", usecols=["cell"])["cell"].tolist()
    times = block_times(graph, cells)
    times.to_parquet(OUTPUT / "walk_times.parquet", index=False)

    # the map draws the 10-minute catchment of the selected block
    index = {c: i for i, c in enumerate(cells)}
    near = times[times["minutes"] <= CATCHMENT_MIN]
    reach = near.groupby("origin")["dest"].agg(lambda d: sorted(index[x] for x in d))
    catchments = {
        "minutes": CATCHMENT_MIN,
        "speed_m_per_min": METRES_PER_MIN,
        "source": f"Overture Maps transportation, release {args.overture_release}",
        "cells": cells,
        "reach": [reach.get(c, [index[c]]) for c in cells],
    }
    (WEB_DATA / "catchments.json").write_text(json.dumps(catchments, separators=(",", ":")))
    sizes = near.groupby("origin").size()
    print(f"{len(graph.xy)} street nodes; {len(times)} block pairs within {LIMIT_MIN:g} min")
    print(f"blocks within {CATCHMENT_MIN:g} min: median {sizes.median():g}, min {sizes.min()}")


if __name__ == "__main__":
    main()
