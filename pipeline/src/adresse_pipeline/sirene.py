"""Where people work: INSEE's Sirene register of establishments.

Each open establishment declares a headcount band. The middle of the band is our
estimate of the people working there, which places Paris's office workers on the grid.
The monthly stock carries each establishment's position in Lambert 93.
"""

from __future__ import annotations

import json
import urllib.request
from collections import defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path

import pyarrow.compute as pc
import pyarrow.dataset as ds
from pyproj import Transformer

from adresse_pipeline.grid import cell_of

# "Base Sirene des entreprises et de leurs établissements" on data.gouv.fr; its files are
# replaced every month, so the current StockEtablissement file is looked up at build time.
DATASET_API = "https://www.data.gouv.fr/api/1/datasets/5b7ffc618b4c4169d30727e0/"
PARIS_COMMUNES = "751"  # 75101 to 75120, the arrondissements
COLUMNS = [
    "siret",
    "codeCommuneEtablissement",
    "etatAdministratifEtablissement",
    "trancheEffectifsEtablissement",
    "coordonneeLambertAbscisseEtablissement",
    "coordonneeLambertOrdonneeEtablissement",
]

# INSEE headcount bands (trancheEffectifsEtablissement) and the middle of each band.
# "NN" (no employee that year) and blank count as zero.
BAND_MIDDLE: dict[str, float] = {
    "00": 0,
    "01": 1.5,
    "02": 4,
    "03": 7.5,
    "11": 14.5,
    "12": 34.5,
    "21": 74.5,
    "22": 149.5,
    "31": 224.5,
    "32": 374.5,
    "41": 749.5,
    "42": 1499.5,
    "51": 3499.5,
    "52": 7499.5,
    "53": 10000,
}

_LAMBERT93_TO_WGS84 = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)


@dataclass(frozen=True)
class Establishment:
    siret: str
    lon: float
    lat: float
    workers: float


@dataclass(frozen=True)
class Release:
    url: str
    updated: str  # ISO date of the file


def stock_release(api: str = DATASET_API) -> Release:
    """The current establishment stock in Parquet, from the dataset's resource list."""
    with urllib.request.urlopen(api, timeout=60) as res:
        resources = json.load(res)["resources"]
    # titles read "Sirene : Fichier StockEtablissement - 01 octobre 2026 (format parquet)"
    for r in resources:
        title = r.get("title") or ""
        if "Fichier StockEtablissement -" in title and "parquet" in title.lower():
            return Release(r["url"], (r.get("last_modified") or "")[:10])
    raise ValueError(f"no StockEtablissement parquet in {[r.get('title') for r in resources]}")


def read_rows(path: Path) -> Iterator[dict[str, str]]:
    """Paris rows of the stock, reading only the columns we use."""
    data = ds.dataset(path, format="parquet")
    missing = [c for c in COLUMNS if c not in data.schema.names]
    if missing:
        raise ValueError(f"unexpected Sirene file, no {missing}; columns {data.schema.names}")
    paris = pc.starts_with(pc.field("codeCommuneEtablissement"), PARIS_COMMUNES)
    for batch in data.to_batches(columns=COLUMNS, filter=paris):
        for row in batch.to_pylist():
            yield {k: "" if v is None else str(v) for k, v in row.items()}


def establishments(rows: Iterable[dict[str, str]]) -> Iterator[Establishment]:
    """Open establishments with a known position and at least one worker.

    Positions are masked ("[ND]") for people who opted out of publication; those are left out.
    """
    for row in rows:
        if row["etatAdministratifEtablissement"] != "A":
            continue
        workers = BAND_MIDDLE.get(row["trancheEffectifsEtablissement"], 0)
        if not workers:
            continue
        try:
            x = float(row["coordonneeLambertAbscisseEtablissement"])
            y = float(row["coordonneeLambertOrdonneeEtablissement"])
        except ValueError:
            continue
        yield Establishment(row["siret"], *_LAMBERT93_TO_WGS84.transform(x, y), workers)


def workers_by_cell(places: Iterable[Establishment]) -> dict[str, float]:
    cells: dict[str, float] = defaultdict(float)
    for e in places:
        cells[cell_of(e.lon, e.lat)] += e.workers
    return cells
