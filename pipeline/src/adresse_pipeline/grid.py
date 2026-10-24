"""The H3 analysis grid and neighbourhood aggregation over it."""

from __future__ import annotations

import os
from collections import defaultdict
from collections.abc import Iterable, Mapping

import h3
from shapely.geometry.base import BaseGeometry

# Resolution 10 cells are about 0.015 km², one side of a street block, so a score can tell
# one end of a street from the other. Resolution 9 (0.105 km², a whole Haussmann block and
# its streets) was the grid until 2026-10; ADRESSE_H3_RESOLUTION=9 rebuilds it for comparison.
RESOLUTION = int(os.environ.get("ADRESSE_H3_RESOLUTION", "10"))
# Neighbourhoods keep the size they had on the resolution-9 grid, whatever the resolution:
# "r1" is a resolution-9 block and its six neighbours (about 0.74 km²), "r2" adds the next
# ring (about 2 km²). At resolution 10 the closest disks by area are 4 and 6 rings.
DISK_RINGS = {9: {1: 1, 2: 2}, 10: {1: 4, 2: 6}}


def disk(cell: str, k: int = 1) -> list[str]:
    """The cell and its neighbours over the neighbourhood named `k` (r1 or r2) above."""
    return h3.grid_disk(cell, DISK_RINGS[RESOLUTION][k])


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
    """Sum of `values` over each cell's neighbourhood `k` (r1 or r2, see DISK_RINGS)."""
    return {c: sum(values.get(n, 0) for n in disk(c, k)) for c in cells}


def ring_weighted_mean(
    values: Mapping[str, float], weights: Mapping[str, float], cells: Iterable[str], k: int = 1
) -> dict[str, float | None]:
    """Weighted mean of `values` over each cell's disk; None where the disk has no weight."""
    out: dict[str, float | None] = {}
    for c in cells:
        around = [n for n in disk(c, k) if weights.get(n) and n in values]
        total = sum(weights[n] for n in around)
        out[c] = sum(values[n] * weights[n] for n in around) / total if total else None
    return out
