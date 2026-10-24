"""Empty shop units from APUR's census of Paris ground floors (BDCOM), our availability check.

The Atelier Parisien d'Urbanisme surveys every ground-floor unit in Paris. Its "Local" layer
lists shops and also the units standing empty, with where they sit (on the street, on a corner,
in a mall, in a courtyard) and a size band. We read only the empty ones.
"""

from __future__ import annotations

import json
import urllib.parse
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

from adresse_pipeline.download import fetch

RELEASE = "BDCOM 2023"
LAYER = "https://carto2.apur.org/apur/rest/services/BDCOM/bdcom2023/MapServer/1"
# BDCOM `type` code of an empty unit ("Local vacant")
VACANT = "V"
PAGE = 1000  # the server's maxRecordCount


class Situation(Enum):
    STREET = "R"
    CORNER = "A"
    MALL = "CC"
    COURTYARD = "CI"


class Size(Enum):
    UNDER_300 = 1
    FROM_300_TO_1000 = 2
    OVER_1000 = 3


@dataclass(frozen=True)
class VacantShop:
    address: str
    lon: float
    lat: float
    situation: Situation
    size: Size

    @property
    def on_street(self) -> bool:
        """A shopfront a passer-by sees: on the street or on a corner, not in a mall or a yard."""
        return self.situation in (Situation.STREET, Situation.CORNER)


def query_url(offset: int | None = None) -> str:
    params = {"where": f"type='{VACANT}'", "f": "json"}
    if offset is None:
        params["returnCountOnly"] = "true"
    else:
        params |= {
            "outFields": "num,let,typ_voie,lib_voie,sit,surf",
            "outSR": "4326",
            "orderByFields": "OBJECTID",
            "resultOffset": str(offset),
            "resultRecordCount": str(PAGE),
        }
    return f"{LAYER}/query?{urllib.parse.urlencode(params)}"


def read_page(path: Path) -> dict:
    """One answer of the ArcGIS server. It reports errors with HTTP 200, so check the body."""
    body = json.loads(path.read_text(encoding="utf-8"))
    if "error" in body or not ({"features", "count"} & body.keys()):
        path.unlink()  # never keep an error page in the download cache
        raise ValueError(f"APUR answered {str(body)[:300]}")
    return body


def fetch_vacant() -> list[dict]:
    """Every empty unit, page by page, checked against the server's own count."""
    total = read_page(fetch(query_url()))["count"]
    features: list[dict] = []
    for offset in range(0, total, PAGE):
        features += read_page(fetch(query_url(offset)))["features"]
    if len(features) != total:
        raise ValueError(f"APUR listed {total} empty units but returned {len(features)}")
    return features


def vacant_shops(features: Iterable[dict]) -> Iterator[VacantShop]:
    for f in features:
        a, g = f["attributes"], f.get("geometry")
        if not g:
            continue
        street = " ".join(str(x) for x in (a["typ_voie"], a["lib_voie"]) if x)
        number = f"{a['num'] or ''}{a['let'] or ''}".strip()
        yield VacantShop(
            f"{number} {street}".strip(),
            float(g["x"]),
            float(g["y"]),
            Situation(a["sit"]),
            Size(a["surf"]),
        )
