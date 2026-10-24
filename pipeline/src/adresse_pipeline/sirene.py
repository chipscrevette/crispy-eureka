"""Where people work: the Sirene register of establishments, geolocated by Etalab.

Each open establishment declares a headcount band. The middle of the band is our
estimate of the people working there, which places Paris's office workers on the grid.
"""

from __future__ import annotations

import csv
import gzip
import itertools
from collections import defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path

from pyproj import Transformer

from adresse_pipeline.grid import cell_of

URL = "https://files.data.gouv.fr/geo-sirene/last/dep/geo_siret_75.csv.gz"

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


def read_rows(path: Path) -> Iterator[dict[str, str]]:
    with gzip.open(path, "rt", encoding="utf-8", newline="") as f:
        first = f.readline()
        delimiter = ";" if first.count(";") > first.count(",") else ","
        yield from csv.DictReader(itertools.chain([first], f), delimiter=delimiter)


def establishments(rows: Iterable[dict[str, str]]) -> Iterator[Establishment]:
    """Open establishments with a known position and at least one worker.

    Positions come as WGS84 `longitude`/`latitude` (Etalab file) or as Lambert 93
    `coordonneeLambert…` (INSEE's own geolocated stock); either is accepted.
    """
    checked = False
    for row in rows:
        if not checked:
            missing = {"siret", "etatAdministratifEtablissement", "trancheEffectifsEtablissement"}
            missing -= row.keys()
            if missing or not ({"longitude", "latitude"} <= row.keys() or _LAMBERT <= row.keys()):
                raise ValueError(f"unexpected Sirene file, columns {sorted(row)[:40]}")
            checked = True
        if row["etatAdministratifEtablissement"] != "A":
            continue
        workers = BAND_MIDDLE.get(row["trancheEffectifsEtablissement"] or "", 0)
        if not workers:
            continue
        position = _position(row)
        if position:
            yield Establishment(row["siret"], *position, workers)


_LAMBERT = {"coordonneeLambertAbscisseEtablissement", "coordonneeLambertOrdonneeEtablissement"}


def _position(row: dict[str, str]) -> tuple[float, float] | None:
    try:
        if row.get("longitude") and row.get("latitude"):
            return float(row["longitude"]), float(row["latitude"])
        x = row.get("coordonneeLambertAbscisseEtablissement")
        y = row.get("coordonneeLambertOrdonneeEtablissement")
        if x and y and x != "[ND]" and y != "[ND]":
            return _LAMBERT93_TO_WGS84.transform(float(x), float(y))
    except ValueError:
        pass
    return None


def workers_by_cell(places: Iterable[Establishment]) -> dict[str, float]:
    cells: dict[str, float] = defaultdict(float)
    for e in places:
        cells[cell_of(e.lon, e.lat)] += e.workers
    return cells
