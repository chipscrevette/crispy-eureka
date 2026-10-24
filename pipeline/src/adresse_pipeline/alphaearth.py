"""Google DeepMind's AlphaEarth Foundations satellite embeddings, averaged per H3 cell.

    python -m adresse_pipeline.alphaearth

Each 10 m pixel carries a 64-dimensional unit vector summarising a year of optical,
radar and lidar observations. The vectors are read straight from the public Cloud
Optimized GeoTIFFs (CC-BY 4.0, "The AlphaEarth Foundations Satellite Embedding dataset
is produced by Google and Google DeepMind"), averaged over each cell and renormalised.
"""

from __future__ import annotations

import csv
import os
from collections.abc import Iterator
from pathlib import Path

import h3
import numpy as np
from pyproj import Transformer

from adresse_pipeline.grid import RESOLUTION
from adresse_pipeline.overture import PARIS

ROOT = Path(__file__).resolve().parents[3]
FEATURES_CSV = ROOT / "pipeline" / "output" / "paris_h3_features.csv"
OUTPUT = ROOT / "pipeline" / "output" / "alphaearth_2025.csv"

YEAR = 2025
BUCKET = "https://storage.googleapis.com/alphaearth_foundations/satellite_embedding/v1/annual"
# The two 2025 tiles (UTM 31N) whose footprints cover Paris, found in the bucket's aef_index.csv.
TILES = (
    f"{BUCKET}/{YEAR}/31N/xabspe9ljwzh0de3l-0000000000-0000008192.tiff",
    f"{BUCKET}/{YEAR}/31N/xsp9ychrbkbuzfve4-0000008192-0000008192.tiff",
)
DIMS = 64
NODATA = -128


def dequantize(raw: np.ndarray) -> np.ndarray:
    """int8 → float in [-1, 1], as the dataset README specifies: (v / 127.5)² with v's sign."""
    v = raw.astype(np.float32)
    return np.sign(v) * (v / 127.5) ** 2


def unit(v: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(v, axis=-1, keepdims=True)
    return np.divide(v, norm, out=np.zeros_like(v), where=norm > 0)


def read_tile(url: str) -> Iterator[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """Yield (lon, lat, vectors) for the valid pixels of `url` inside the Paris box, row band by band."""
    import rasterio
    from rasterio.windows import Window

    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    with rasterio.open(f"/vsicurl/{url}") as src:
        to_utm = Transformer.from_crs(4326, src.crs, always_xy=True)
        to_wgs = Transformer.from_crs(src.crs, 4326, always_xy=True)
        corners = [
            to_utm.transform(x, y)
            for x in (PARIS.xmin, PARIS.xmax)
            for y in (PARIS.ymin, PARIS.ymax)
        ]
        rows, cols = zip(*(src.index(x, y) for x, y in corners), strict=True)
        r0, r1 = max(min(rows), 0), min(max(rows) + 1, src.height)
        c0, c1 = max(min(cols), 0), min(max(cols) + 1, src.width)
        if r0 >= r1 or c0 >= c1:
            return
        band = 256
        for r in range(r0, r1, band):
            h = min(band, r1 - r)
            raw = src.read(window=Window(c0, r, c1 - c0, h))  # (64, h, w)
            valid = (raw != NODATA).all(axis=0)
            if not valid.any():
                continue
            rr, cc = np.nonzero(valid)
            xs, ys = rasterio.transform.xy(src.transform, rr + r, cc + c0)
            lon, lat = to_wgs.transform(np.asarray(xs), np.asarray(ys))
            yield lon, lat, dequantize(raw[:, rr, cc].T)


def add_to_cells(
    sums: dict[str, np.ndarray],
    pixels: Iterator[tuple[np.ndarray, np.ndarray, np.ndarray]],
    cells: set[str],
) -> None:
    """Add each pixel's vector to its cell's running sum. The mean of a cell is its sum renormalised
    to unit length, the dataset README's rule for aggregating embeddings."""
    for lon, lat, vec in pixels:
        ids = np.array([h3.latlng_to_cell(a, o, RESOLUTION) for o, a in zip(lon, lat, strict=True)])
        for cell in set(ids.tolist()) & cells:
            s = vec[ids == cell].sum(axis=0)
            sums[cell] = sums[cell] + s if cell in sums else s


def main() -> None:
    with FEATURES_CSV.open() as f:
        cells = {row["cell"] for row in csv.DictReader(f)}
    sums: dict[str, np.ndarray] = {}
    for url in TILES:
        # The two tiles overlap by about 600 m at the city's southern edge; the pixels there
        # are counted twice, which leaves the renormalised mean unchanged when they agree.
        add_to_cells(sums, read_tile(url), cells)
    means = {c: unit(s) for c, s in sums.items()}
    missing = cells - means.keys()
    if len(missing) > 0.02 * len(cells):
        raise ValueError(f"alphaearth: {len(missing)} of {len(cells)} cells have no embedding")
    with OUTPUT.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["cell", *(f"A{i:02d}" for i in range(DIMS))])
        for cell in sorted(means):
            w.writerow([cell, *(f"{x:.4f}" for x in means[cell])])
    print(f"alphaearth: {YEAR} embeddings for {len(means)} of {len(cells)} cells", flush=True)


if __name__ == "__main__":
    main()
