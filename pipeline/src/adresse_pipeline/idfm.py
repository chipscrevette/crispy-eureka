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
    # the lines that stop here as passengers name them: "1", "3bis", "RER A"
    lines: tuple[str, ...] = ()


def read_csv(path: Path) -> Iterator[dict[str, str]]:
    text = path.read_text(encoding="utf-8-sig")
    first = text.split("\n", 1)[0]
    delimiter = ";" if first.count(";") > first.count(",") else ","
    for row in csv.DictReader(io.StringIO(text), delimiter=delimiter):
        yield {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}


def zdc_id(raw: str) -> str:
    """Station ids come as "71320" in one file and "71320.0" in the other."""
    return str(int(float(raw)))


def daily_entries_by_zdc(rows: Iterable[dict[str, str]]) -> dict[str, float]:
    """Mean entries per day for each ZdC, summed over ticket types.

    Small counts are published as text (for example "Moins de 5") and count as zero.
    """
    totals: dict[str, float] = defaultdict(float)
    days: set[str] = set()
    rows = list(rows)
    if not rows or not {"jour", "id_zdc", "nb_vald"} <= rows[0].keys():
        raise ValueError(f"unexpected validations file: {len(rows)} rows, columns {_columns(rows)}")
    for row in rows:
        days.add(row["jour"])
        try:
            totals[zdc_id(row["id_zdc"])] += float(row["nb_vald"])
        except ValueError:
            continue
    return {zdc: total / len(days) for zdc, total in totals.items()}


def stations(rows: Iterable[dict[str, str]], entries: dict[str, float]) -> list[Station]:
    """One station per ZdC with ridership. The source has one row per line served."""
    points: dict[str, list[tuple[float, float]]] = defaultdict(list)
    names: dict[str, str] = {}
    served: dict[str, set[str]] = defaultdict(set)
    rows = list(rows)
    if not rows or not {"id_ref_zdc", "nom_zdc", "geo point"} <= rows[0].keys():
        raise ValueError(f"unexpected stations file: {len(rows)} rows, columns {_columns(rows)}")
    for row in rows:
        zdc = zdc_id(row["id_ref_zdc"])
        lat, lon = (float(v) for v in row["geo point"].split(","))
        points[zdc].append((lon, lat))
        names[zdc] = row["nom_zdc"]
        if line := line_name(row):
            served[zdc].add(line)
    joined = [
        Station(
            zdc,
            names[zdc],
            sum(lon for lon, _ in pts) / len(pts),
            sum(lat for _, lat in pts) / len(pts),
            entries[zdc],
            tuple(sorted(served[zdc], key=_line_order)),
        )
        for zdc, pts in points.items()
        if zdc in entries
    ]
    if not joined:
        sample = sorted(points)[:3], sorted(entries)[:3]
        raise ValueError(f"no station ids match the validations; samples {sample}")
    return joined


def line_name(row: dict[str, str]) -> str:
    """ "1" for a metro line, "RER A" for an RER line, "" for other modes or when the file lacks the columns."""
    mode = (row.get("mode") or "").upper()
    index = row.get("indice_lig") or row.get("indice ligne") or ""
    if not index:
        return ""
    if mode == "METRO":
        return index
    if mode == "RER":
        return f"RER {index}"
    return ""


def _line_order(line: str) -> tuple[int, str]:
    if line.startswith("RER"):
        return (1, line)
    digits = "".join(c for c in line if c.isdigit())
    return (0, f"{int(digits or 0):03d}{line}")


def to_geojson(stations: Iterable[Station]) -> dict:
    """The stations as map points, busiest first, so the map draws the big ones on top."""
    return {
        "type": "FeatureCollection",
        "period": VALIDATIONS_PERIOD,
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(s.lon, 5), round(s.lat, 5)]},
                "properties": {
                    "name": s.name,
                    "entries": round(s.daily_entries),
                    "lines": list(s.lines),
                },
            }
            for s in sorted(stations, key=lambda s: s.daily_entries)
        ],
    }


def _columns(rows: list[dict[str, str]]) -> list[str]:
    return sorted(rows[0]) if rows else []
