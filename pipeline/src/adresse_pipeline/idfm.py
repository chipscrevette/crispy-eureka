"""Île-de-France Mobilités rail ridership, our footfall proxy."""

from __future__ import annotations

import csv
import io
from collections import defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path

# Daily entries per station, rail network (metro, RER, Transilien, tram), Q4 2025.
VALIDATIONS_URL = "https://www.data.gouv.fr/api/1/datasets/r/cf44b14f-10e9-45d9-8188-d4e3bf102993"
VALIDATIONS_PERIOD = "Q4 2025"
STATIONS_URL = (
    "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/"
    "emplacement-des-gares-idf/exports/csv?use_labels=true"
)


@dataclass(frozen=True)
class Station:
    """A ZdC (zone de correspondance): every entrance and line of one named station."""

    zdc: str
    name: str
    lon: float
    lat: float
    daily_entries: float


def read_csv(path: Path) -> Iterator[dict[str, str]]:
    text = path.read_text(encoding="utf-8-sig")
    first = text.split("\n", 1)[0]
    delimiter = ";" if first.count(";") > first.count(",") else ","
    for row in csv.DictReader(io.StringIO(text), delimiter=delimiter):
        yield {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}


def daily_entries_by_zdc(rows: Iterable[dict[str, str]]) -> dict[str, float]:
    """Mean entries per day for each ZdC, summed over ticket types.

    Small counts are published as text (for example "Moins de 5") and count as zero.
    """
    totals: dict[str, float] = defaultdict(float)
    days: set[str] = set()
    for row in rows:
        days.add(row["jour"])
        try:
            totals[row["id_zdc"]] += float(row["nb_vald"])
        except ValueError:
            continue
    return {zdc: total / len(days) for zdc, total in totals.items()} if days else {}


def stations(rows: Iterable[dict[str, str]], entries: dict[str, float]) -> list[Station]:
    """One station per ZdC with ridership. The source has one row per line served."""
    points: dict[str, list[tuple[float, float]]] = defaultdict(list)
    names: dict[str, str] = {}
    for row in rows:
        zdc = row["id_ref_zdc"]
        lat, lon = (float(v) for v in row["geo point"].split(","))
        points[zdc].append((lon, lat))
        names[zdc] = row["nom_zdc"]
    return [
        Station(
            zdc,
            names[zdc],
            sum(lon for lon, _ in pts) / len(pts),
            sum(lat for _, lat in pts) / len(pts),
            entries[zdc],
        )
        for zdc, pts in points.items()
        if zdc in entries
    ]
