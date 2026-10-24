"""Ai2 OlmoEarth embeddings, averaged per H3 cell.

    python -m adresse_pipeline.olmoearth <rslearn dataset root>

OlmoEarth has no precomputed archive, so the `OlmoEarth` workflow runs the model itself:
rslearn fetches four seasonal Sentinel-2 mosaics of 2025 from Microsoft Planetary Computer
and OlmoEarth v1.2 Tiny writes one 192-dimensional embedding per 40 m (configs in
pipeline/olmoearth/). This module averages those embeddings over each cell.

The output is a derivative of OlmoEarth, released under the OlmoEarth Artifact License:
it may not be used for military, surveillance, policing or extractive purposes (see
DATA_LICENSES.md), and that restriction passes on to anyone who reuses it.
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

import h3
import numpy as np
from pyproj import Transformer

from adresse_pipeline.grid import RESOLUTION

ROOT = Path(__file__).resolve().parents[3]
FEATURES_CSV = ROOT / "pipeline" / "output" / "paris_h3_features.csv"
OUTPUT = ROOT / "pipeline" / "output" / "olmoearth_2025.csv"
YEAR = 2025
MODEL = "OlmoEarth v1.2 Tiny"


def embedding_rasters(dataset: Path) -> list[Path]:
    return sorted(dataset.glob("windows/*/*/layers/embeddings/**/*.tif"))


def add_raster(
    sums: dict[str, np.ndarray], counts: dict[str, int], path: Path, cells: set[str]
) -> None:
    import rasterio

    with rasterio.open(path) as src:
        data = src.read()  # (dims, h, w)
        to_wgs = Transformer.from_crs(src.crs, 4326, always_xy=True)
        rows, cols = np.indices(data.shape[1:])
        xs, ys = rasterio.transform.xy(src.transform, rows.ravel(), cols.ravel())
        lon, lat = to_wgs.transform(np.asarray(xs), np.asarray(ys))
    vectors = data.reshape(data.shape[0], -1).T
    valid = np.isfinite(vectors).all(axis=1) & (np.abs(vectors).sum(axis=1) > 0)
    ids = np.array([h3.latlng_to_cell(a, o, RESOLUTION) for o, a in zip(lon, lat, strict=True)])
    for cell in set(ids[valid].tolist()) & cells:
        mask = valid & (ids == cell)
        sums[cell] = sums.get(cell, 0) + vectors[mask].sum(axis=0)
        counts[cell] = counts.get(cell, 0) + int(mask.sum())


def main(dataset: Path) -> None:
    with FEATURES_CSV.open() as f:
        cells = {row["cell"] for row in csv.DictReader(f)}
    rasters = embedding_rasters(dataset)
    if not rasters:
        raise FileNotFoundError(f"olmoearth: no embedding rasters under {dataset}")
    sums: dict[str, np.ndarray] = {}
    counts: dict[str, int] = {}
    for path in rasters:
        add_raster(sums, counts, path, cells)
    missing = cells - sums.keys()
    if len(missing) > 0.02 * len(cells):
        raise ValueError(f"olmoearth: {len(missing)} of {len(cells)} cells have no embedding")
    dims = len(next(iter(sums.values())))
    with OUTPUT.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["cell", *(f"O{i:03d}" for i in range(dims))])
        for cell in sorted(sums):
            w.writerow([cell, *(f"{x:.4f}" for x in sums[cell] / counts[cell])])
    print(
        f"olmoearth: {MODEL} {YEAR} embeddings ({dims} dims) for {len(sums)} of {len(cells)} cells",
        flush=True,
    )


if __name__ == "__main__":
    main(Path(sys.argv[1]))
