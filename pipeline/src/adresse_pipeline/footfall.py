"""Street footfall estimated from the shape of the street network.

No open data counts pedestrians on Paris streets: the city's counters see bikes and cars,
and the open pedestrian counts on data.gouv.fr are for Toulouse and Bordeaux. Space syntax
research shows that how often a street lies on the shortest walks between nearby places
(its betweenness within a walking radius) predicts footfall well: R² 0.59 against sensors on
Liverpool shopping streets (UCL, GISRUK 2018), ahead of shop size and frontage.

For every street piece we count the shortest walks of up to RADIUS_M that pass along it, as
a multiple of the median Paris street. Each block gets the index of its busiest
street. The map draws the busiest streets themselves.
"""

from __future__ import annotations

from collections.abc import Callable

import igraph as ig
import numpy as np
import pandas as pd
import scipy.sparse as sp

from adresse_pipeline.walk import METRES_PER_MIN, ORIGIN, WalkGraph

# About a 10-minute walk, the radius at which space syntax studies usually find local
# pedestrian movement. Of 400, 800 and 1,600 m, it also follows the shops of each block best.
RADIUS_M = 800.0
# The map draws the busiest 5% of street pieces (about 17,000, 190 KB gzipped) in three steps.
MAP_LEVELS = (0.95, 0.98, 0.995)


def street_betweenness(graph: WalkGraph, radius: float = RADIUS_M) -> pd.DataFrame:
    """Each street piece (two network nodes, in metres), its length and the shortest walks
    along it, with the footfall index (walks as a multiple of the median street)."""
    pieces = sp.triu(graph.edges + graph.edges.T, format="coo")
    metres = pieces.data * METRES_PER_MIN
    g = ig.Graph(
        n=len(graph.xy), edges=np.column_stack([pieces.row, pieces.col]).tolist(), directed=False
    )
    walks = np.asarray(g.edge_betweenness(directed=False, cutoff=radius, weights=metres.tolist()))
    a, b = graph.xy[pieces.row], graph.xy[pieces.col]
    return pd.DataFrame(
        {
            "x0": a[:, 0],
            "y0": a[:, 1],
            "x1": b[:, 0],
            "y1": b[:, 1],
            "metres": metres,
            "walks": walks,
            "index": walks / np.median(walks),
        }
    )


def to_lonlat(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Inverse of `walk.to_metres`."""
    k = np.cos(np.radians(ORIGIN[1]))
    return x / (111_320 * k) + ORIGIN[0], y / 110_540 + ORIGIN[1]


def by_cell(streets: pd.DataFrame, cell_of: Callable[[float, float], str]) -> pd.Series:
    """The footfall index of each block's busiest street, placed by the street's midpoint."""
    lon, lat = to_lonlat(
        ((streets["x0"] + streets["x1"]) / 2).to_numpy(),
        ((streets["y0"] + streets["y1"]) / 2).to_numpy(),
    )
    cells = [cell_of(o, a) for o, a in zip(lon, lat, strict=True)]
    return streets["index"].groupby(cells).max().rename("street_footfall")


def to_geojson(streets: pd.DataFrame) -> dict:
    """The busiest streets as lines, each with its level (1 to 3) and footfall index."""
    cuts = streets["walks"].quantile(list(MAP_LEVELS)).to_numpy()
    busy = streets[streets["walks"] >= cuts[0]]
    level = np.searchsorted(cuts, busy["walks"].to_numpy(), side="right")
    lon0, lat0 = to_lonlat(busy["x0"].to_numpy(), busy["y0"].to_numpy())
    lon1, lat1 = to_lonlat(busy["x1"].to_numpy(), busy["y1"].to_numpy())
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"level": int(lv), "index": round(float(ix), 1)},
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [round(float(a), 5), round(float(b), 5)],
                        [round(float(c), 5), round(float(d), 5)],
                    ],
                },
            }
            for lv, ix, a, b, c, d in zip(level, busy["index"], lon0, lat0, lon1, lat1, strict=True)
        ],
    }
