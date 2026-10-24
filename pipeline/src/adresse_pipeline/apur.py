"""Ground-floor units from APUR's census of Paris (BDCOM), our availability check.

The Atelier Parisien d'Urbanisme surveys every ground-floor unit in Paris. Its "Local" layer
lists shops, offices, surgeries and the units standing empty, with where they sit (on the
street, on a corner, in a mall, in a courtyard) and a size band. From it we know, around each
block, how many shopfronts stand empty, what share of all shopfronts that is (a street where
many stand empty is a weak street), and how many empty ones are big enough for a flagship.

The same service maps the tourist zones where shops may open on Sundays and late in the
evening. The international ones (ZTI) are where the State expects foreign visitors to shop.
"""

from __future__ import annotations

import json
import urllib.parse
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

from shapely.geometry import LinearRing, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from adresse_pipeline.download import fetch

RELEASE = "BDCOM 2023"
LAYER = "https://carto2.apur.org/apur/rest/services/BDCOM/bdcom2023/MapServer/1"
# BDCOM `type` code of an empty unit ("Local vacant")
VACANT = "V"
PAGE = 1000  # the server's maxRecordCount
ZONES_LAYER = "https://carto2.apur.org/apur/rest/services/BDCOM/bdcom2023/MapServer/4"
INTERNATIONAL = "ZTI"  # `c_type` of an international tourist zone


class Situation(Enum):
    STREET = "R"
    CORNER = "A"
    MALL = "CC"
    COURTYARD = "CI"
    UNKNOWN = ""


class Size(Enum):
    UNDER_300 = 1
    FROM_300_TO_1000 = 2
    OVER_1000 = 3


@dataclass(frozen=True)
class Unit:
    address: str
    lon: float
    lat: float
    situation: Situation
    size: Size | None
    empty: bool

    @property
    def on_street(self) -> bool:
        """A shopfront a passer-by sees: on the street or on a corner, not in a mall or a yard."""
        return self.situation in (Situation.STREET, Situation.CORNER)

    @property
    def flagship_size(self) -> bool:
        return self.size in (Size.FROM_300_TO_1000, Size.OVER_1000)


@dataclass(frozen=True)
class TouristZone:
    name: str
    kind: str  # the `c_type` code, ZTI for an international zone
    area: BaseGeometry

    @property
    def international(self) -> bool:
        return self.kind == INTERNATIONAL


def query_url(offset: int | None = None) -> str:
    params = {"where": "1=1", "f": "json"}
    if offset is None:
        params["returnCountOnly"] = "true"
    else:
        params |= {
            "outFields": "num,let,typ_voie,lib_voie,sit,surf,type",
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


def fetch_units() -> list[dict]:
    """Every ground-floor unit, page by page, checked against the server's own count."""
    total = read_page(fetch(query_url()))["count"]
    features: list[dict] = []
    for offset in range(0, total, PAGE):
        features += read_page(fetch(query_url(offset)))["features"]
    if len(features) != total:
        raise ValueError(f"APUR listed {total} units but returned {len(features)}")
    return features


def situation_of(code: str | None) -> Situation:
    """The census writes the codes in either case ('R' and 'r'); a few units have none."""
    code = (code or "").strip().upper()
    return Situation(code) if code in {s.value for s in Situation} else Situation.UNKNOWN


def units(features: Iterable[dict]) -> Iterator[Unit]:
    for f in features:
        a, g = f["attributes"], f.get("geometry")
        if not g:
            continue
        street = " ".join(str(x) for x in (a["typ_voie"], a["lib_voie"]) if x)
        number = f"{a['num'] or ''}{a['let'] or ''}".strip()
        yield Unit(
            f"{number} {street}".strip(),
            float(g["x"]),
            float(g["y"]),
            situation_of(a["sit"]),
            Size(a["surf"]) if a["surf"] in {s.value for s in Size} else None,
            (a["type"] or "").strip().upper() == VACANT,
        )


def zones_url() -> str:
    params = {"where": "1=1", "outFields": "nom,c_type", "outSR": "4326", "f": "json"}
    return f"{ZONES_LAYER}/query?{urllib.parse.urlencode(params)}"


def area_of(rings: list[list[list[float]]]) -> BaseGeometry:
    """An ArcGIS polygon: clockwise rings are outlines, counter-clockwise ones are holes."""
    outlines = [r for r in rings if not LinearRing(r).is_ccw]
    holes = [Polygon(r) for r in rings if LinearRing(r).is_ccw]
    shape = unary_union([Polygon(r) for r in outlines])
    return shape.difference(unary_union(holes)) if holes else shape


def tourist_zones(features: Iterable[dict]) -> Iterator[TouristZone]:
    for f in features:
        a, g = f["attributes"], f.get("geometry")
        if not g or not g.get("rings"):
            continue
        yield TouristZone(
            (a["nom"] or "").strip(), (a["c_type"] or "").strip().upper(), area_of(g["rings"])
        )


def fetch_tourist_zones() -> list[TouristZone]:
    zones = list(tourist_zones(read_page(fetch(zones_url()))["features"]))
    if not any(z.international for z in zones):
        kinds = sorted({z.kind for z in zones})
        raise ValueError(f"no {INTERNATIONAL} among the {len(zones)} APUR zones; kinds {kinds}")
    return zones
