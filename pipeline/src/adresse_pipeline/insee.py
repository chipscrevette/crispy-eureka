"""INSEE Filosofi income data on the 200 m grid."""

from __future__ import annotations

import csv
import io
import re
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path

from pyproj import Transformer

from adresse_pipeline.grid import cell_of

FILOSOFI_URLS = {
    2021: "https://www.insee.fr/fr/statistiques/fichier/8735162/Filosofi2021_carreaux_200m_csv.zip",
    2019: "https://www.insee.fr/fr/statistiques/fichier/7655475/Filosofi2019_carreaux_200m_csv.zip",
}

_IDCAR = re.compile(r"RES200mN(\d+)E(\d+)")
_LAEA_TO_WGS84 = Transformer.from_crs("EPSG:3035", "EPSG:4326", always_xy=True)


@dataclass(frozen=True)
class Square:
    """One 200 m INSEE square. Counts can be fractional where INSEE imputed them."""

    lon: float
    lat: float
    individuals: float
    living_standard_sum: float
    households: float
    poor_households: float
    owner_households: float


def square_centre(idcar: str) -> tuple[float, float]:
    """Centre of a square from its id, e.g. `CRS3035RES200mN2862400E3758200`.

    The id gives the south-west corner in ETRS89-LAEA metres.
    """
    match = _IDCAR.search(idcar)
    if not match:
        raise ValueError(f"not a 200 m square id: {idcar!r}")
    north, east = (int(v) + 100 for v in match.groups())
    return _LAEA_TO_WGS84.transform(east, north)


def read_squares(rows: Iterable[dict[str, str]], commune_prefix: str = "75") -> Iterator[Square]:
    for raw in rows:
        row = {k.lower(): v for k, v in raw.items()}
        if not row["lcog_geo"].startswith(commune_prefix):
            continue
        lon, lat = square_centre(row["idcar_200m"])
        yield Square(
            lon=lon,
            lat=lat,
            individuals=float(row["ind"]),
            living_standard_sum=float(row["ind_snv"]),
            households=float(row["men"]),
            poor_households=float(row["men_pauv"]),
            owner_households=float(row["men_prop"]),
        )


def csv_rows_from_zip(path: Path) -> Iterator[dict[str, str]]:
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".csv") and "met" in n.lower())
        with z.open(name) as f:
            text = io.TextIOWrapper(f, encoding="utf-8-sig", newline="")
            first = text.readline()
            delimiter = ";" if first.count(";") > first.count(",") else ","
            yield from csv.DictReader(_chain(first, text), delimiter=delimiter)


def _chain(first: str, rest: Iterable[str]) -> Iterator[str]:
    yield first
    yield from rest


@dataclass
class CellIncome:
    individuals: float = 0.0
    living_standard_sum: float = 0.0
    households: float = 0.0
    poor_households: float = 0.0
    owner_households: float = 0.0


def by_cell(squares: Iterable[Square]) -> dict[str, CellIncome]:
    """Assign each square to the H3 cell containing its centre."""
    cells: dict[str, CellIncome] = defaultdict(CellIncome)
    for s in squares:
        c = cells[cell_of(s.lon, s.lat)]
        c.individuals += s.individuals
        c.living_standard_sum += s.living_standard_sum
        c.households += s.households
        c.poor_households += s.poor_households
        c.owner_households += s.owner_households
    return cells
