"""DVF property sales (geolocated Etalab version)."""

from __future__ import annotations

import csv
import gzip
import statistics
from collections import defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

import h3

from adresse_pipeline.grid import cell_of


def dvf_url(year: int, department: str = "75") -> str:
    return f"https://files.data.gouv.fr/geo-dvf/latest/csv/{year}/departements/{department}.csv.gz"


class Kind(StrEnum):
    APARTMENT = "Appartement"
    COMMERCIAL = "Local industriel. commercial ou assimilé"


BUILT_TYPES = {"Appartement", "Maison", "Local industriel. commercial ou assimilé"}

# Bounds that drop data-entry errors and non-market transfers, in €/m².
PLAUSIBLE_PRICE_M2 = {Kind.APARTMENT: (2_000, 60_000), Kind.COMMERCIAL: (1_000, 100_000)}
MIN_SURFACE_M2 = 9


@dataclass(frozen=True)
class Sale:
    kind: Kind
    year: int
    lon: float
    lat: float
    price_m2: float


def read_rows(path: Path) -> Iterator[dict[str, str]]:
    with gzip.open(path, "rt", encoding="utf-8", newline="") as f:
        yield from csv.DictReader(f)


def single_premise_sales(rows: Iterable[dict[str, str]]) -> Iterator[Sale]:
    """Sales of exactly one apartment or commercial premise.

    A DVF mutation spans several rows (one per lot or premise) that all repeat the
    total price. Only a mutation with a single built premise gives an honest €/m²;
    cellars and parking spaces (`Dépendance`) may come along with it.
    """
    mutations: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        if row["nature_mutation"] == "Vente":
            mutations[row["id_mutation"]].append(row)

    for group in mutations.values():
        built = [r for r in group if r["type_local"] in BUILT_TYPES]
        if len(built) != 1 or built[0]["type_local"] not in set(Kind):
            continue
        premise = built[0]
        kind = Kind(premise["type_local"])
        try:
            price = float(premise["valeur_fonciere"])
            surface = float(premise["surface_reelle_bati"])
            lon, lat = float(premise["longitude"]), float(premise["latitude"])
        except ValueError:
            continue
        if surface < MIN_SURFACE_M2:
            continue
        low, high = PLAUSIBLE_PRICE_M2[kind]
        if low <= price / surface <= high:
            yield Sale(kind, int(premise["date_mutation"][:4]), lon, lat, price / surface)


def median_price_m2(
    sales: Iterable[Sale], kind: Kind, cells: Iterable[str], min_sales: int
) -> tuple[dict[str, float | None], dict[str, int]]:
    """Median €/m² per cell over the nearest disk (k = 1, else 2) holding `min_sales` sales.

    Also returns the number of sales in each cell's 1-ring, a proxy for market activity.
    """
    by_cell: dict[str, list[float]] = defaultdict(list)
    for s in sales:
        if s.kind == kind:
            by_cell[cell_of(s.lon, s.lat)].append(s.price_m2)

    medians: dict[str, float | None] = {}
    counts: dict[str, int] = {}
    for c in cells:
        counts[c] = sum(len(by_cell.get(n, [])) for n in h3.grid_disk(c, 1))
        medians[c] = None
        for k in (1, 2):
            prices = [p for n in h3.grid_disk(c, k) for p in by_cell.get(n, [])]
            if len(prices) >= min_sales:
                medians[c] = statistics.median(prices)
                break
    return medians, counts
