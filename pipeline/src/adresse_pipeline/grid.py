"""The H3 analysis grid and neighbourhood aggregation over it."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping

import h3
from shapely.geometry.base import BaseGeometry

# Resolution 9 cells are about 0.105 km², roughly a Haussmann block and its streets.
RESOLUTION = 9


def cells_covering(area: BaseGeometry) -> set[str]:
    return set(h3.geo_to_cells(area.__geo_interface__, RESOLUTION))


def cell_of(lon: float, lat: float) -> str:
    return h3.latlng_to_cell(lat, lon, RESOLUTION)


def cell_polygon(cell: str) -> dict:
    ring = [[round(lng, 6), round(lat, 6)] for lat, lng in h3.cell_to_boundary(cell)]
    return {"type": "Polygon", "coordinates": [[*ring, ring[0]]]}


def count_by_cell(points: Iterable[tuple[float, float]]) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for lon, lat in points:
        counts[cell_of(lon, lat)] += 1
    return counts


def ring_sum(values: Mapping[str, float], cells: Iterable[str], k: int = 1) -> dict[str, float]:
    """Sum of `values` over each cell and its neighbours up to `k` rings away."""
    return {c: sum(values.get(n, 0) for n in h3.grid_disk(c, k)) for c in cells}


def ring_weighted_mean(
    values: Mapping[str, float], weights: Mapping[str, float], cells: Iterable[str], k: int = 1
) -> dict[str, float | None]:
    """Weighted mean of `values` over each cell's disk; None where the disk has no weight."""
    out: dict[str, float | None] = {}
    for c in cells:
        disk = [n for n in h3.grid_disk(c, k) if weights.get(n) and n in values]
        total = sum(weights[n] for n in disk)
        out[c] = sum(values[n] * weights[n] for n in disk) / total if total else None
    return out
