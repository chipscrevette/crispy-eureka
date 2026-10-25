"""Metro and RER lines of Île-de-France Mobilités, drawn in their own colours on the map."""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import shapely
from shapely.geometry import mapping, shape
from shapely.geometry.base import BaseGeometry

from adresse_pipeline.idfm import read_csv

_EXPORTS = "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets"
# Rail network geometry: one feature per line branch, with the line's id in the reference.
TRACES_URL = f"{_EXPORTS}/traces-du-reseau-ferre-idf/exports/geojson"
# The lines reference: official short name and web colour of every line.
LINES_URL = f"{_EXPORTS}/referentiel-des-lignes/exports/csv"

RER_LINES = {"A", "B", "C", "D", "E"}


@dataclass(frozen=True)
class Line:
    """One line as passengers name it: mode, short name and colours."""

    mode: str
    name: str
    colour: str
    text: str


def line_colours(rows: Iterable[dict[str, str]]) -> dict[str, Line]:
    """Metro and RER lines of the reference, by line id (the C0xxxx code)."""
    rows = list(rows)
    need = {"id_line", "shortname_line", "transportmode", "colourweb_hexa"}
    if not rows or not need <= rows[0].keys():
        raise ValueError(f"unexpected lines reference: columns {sorted(rows[0]) if rows else []}")
    out = {}
    for row in rows:
        mode = row["transportmode"].lower()
        is_rer = mode == "rail" and row["shortname_line"] in RER_LINES
        if mode != "metro" and not is_rer:
            continue
        out[row["id_line"]] = Line(
            "metro" if mode == "metro" else "rer",
            row["shortname_line"],
            "#" + row["colourweb_hexa"].upper(),
            "#" + (row.get("textcolourweb_hexa") or "000000").upper(),
        )
    return out


def _line_id(props: dict) -> str:
    raw = str(props.get("idrefligc") or props.get("id_ligne") or "")
    return raw if raw.startswith("C") else f"C{raw}" if raw else ""


def traces(
    features: Iterable[dict], lines: dict[str, Line], area: BaseGeometry
) -> list[tuple[Line, BaseGeometry]]:
    """Each metro and RER branch inside `area`, with its line. Branches of other modes are left out."""
    features = list(features)
    if not features:
        raise ValueError("no rail traces in the file")
    out = []
    for f in features:
        props = {k.lower(): v for k, v in f["properties"].items()}
        line = lines.get(_line_id(props))
        if line is None or f.get("geometry") is None:
            continue
        geom = shape(f["geometry"]).intersection(area)
        if not geom.is_empty:
            out.append((line, geom))
    if not out:
        sample = sorted({k for f in features[:3] for k in f["properties"]})
        raise ValueError(f"no traces matched a metro or RER line; trace columns {sample}")
    return out


def to_geojson(branches: Iterable[tuple[Line, BaseGeometry]], tolerance: float = 0.00003) -> dict:
    """One feature per line, branches merged, RER drawn under the metro."""
    merged: dict[Line, list[BaseGeometry]] = {}
    for line, geom in branches:
        merged.setdefault(line, []).append(geom)
    features = []
    for line in sorted(merged, key=lambda x: (x.mode != "rer", x.name)):
        geom = shapely.line_merge(shapely.union_all(merged[line]))
        geom = shapely.set_precision(geom.simplify(tolerance), 0.00001)
        features.append(
            {
                "type": "Feature",
                "geometry": mapping(geom),
                "properties": {
                    "mode": line.mode,
                    "line": line.name,
                    "colour": line.colour,
                    "text": line.text,
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


def read_traces(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["features"]


def read_lines(path: Path) -> dict[str, Line]:
    return line_colours(read_csv(path))
