"""Street footfall estimated from the shape of the street network.

    python -m adresse_pipeline.footfall --overture-release 2026-10-21.0

No open data counts pedestrians on Paris streets: the city's counters see bikes and cars,
and the open pedestrian counts on data.gouv.fr are for Toulouse and Bordeaux. Space syntax
research shows that how often a street lies on the shortest walks between nearby places
(its betweenness within a walking radius) predicts footfall well: R² 0.59 against sensors on
Liverpool shopping streets (UCL, GISRUK 2018), ahead of shop size and frontage.

For every street piece we count the shortest walks of up to RADIUS_M that pass along it,
then give each block the count of its busiest street, as an index where the median street
of Paris is 100.
"""

from __future__ import annotations

import argparse

import igraph as ig
import numpy as np
import pandas as pd
import scipy.sparse as sp

from adresse_pipeline.grid import cell_of
from adresse_pipeline.model import OUTPUT as OUT
from adresse_pipeline.walk import METRES_PER_MIN, ORIGIN, WalkGraph, build_graph, read_segments

OUTPUT = OUT / "street_footfall.csv"

# About a 10-minute walk: the radius at which space syntax studies usually find local
# pedestrian movement.
RADIUS_M = 800.0


def street_betweenness(graph: WalkGraph, radius: float = RADIUS_M) -> pd.DataFrame:
    """Each street piece (two network nodes), its midpoint and the shortest walks along it."""
    pieces = sp.triu(graph.edges + graph.edges.T, format="coo")
    metres = pieces.data * METRES_PER_MIN
    g = ig.Graph(
        n=len(graph.xy), edges=np.column_stack([pieces.row, pieces.col]).tolist(), directed=False
    )
    walks = g.edge_betweenness(directed=False, cutoff=radius, weights=metres.tolist())
    mid = (graph.xy[pieces.row] + graph.xy[pieces.col]) / 2
    return pd.DataFrame({"x": mid[:, 0], "y": mid[:, 1], "metres": metres, "walks": walks})


def to_lonlat(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Inverse of `walk.to_metres`."""
    k = np.cos(np.radians(ORIGIN[1]))
    return x / (111_320 * k) + ORIGIN[0], y / 110_540 + ORIGIN[1]


def by_cell(streets: pd.DataFrame, cell_of) -> pd.Series:
    """The busiest street of each block, as an index: the median street of Paris = 100."""
    lon, lat = to_lonlat(streets["x"].to_numpy(), streets["y"].to_numpy())
    cells = [cell_of(o, a) for o, a in zip(lon, lat, strict=True)]
    index = streets["walks"] / streets["walks"].median() * 100
    return index.groupby(cells).max().rename("street_footfall")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--overture-release", required=True)
    args = parser.parse_args()
    streets = street_betweenness(build_graph(read_segments(args.overture_release)))
    cells = pd.read_csv(OUT / "paris_h3_overlays.csv", index_col="cell")
    busiest = by_cell(streets, cell_of).reindex(cells.index).fillna(0)
    busiest.rename_axis("cell").to_csv(OUTPUT)
    # shops follow footfall, so the two should rise together if the estimate is sound
    shops = cells.filter(like="_r0").sum(axis=1)
    print(
        f"street footfall: {len(streets):,} street pieces, walks of up to {RADIUS_M:g} m; "
        f"rank correlation with the shops in each block {busiest.corr(shops, method='spearman'):.2f}"
    )


if __name__ == "__main__":
    main()
