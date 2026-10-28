"""Find catalogue luxury boutiques among map places."""

from __future__ import annotations

import csv
from collections.abc import Collection, Iterable
from pathlib import Path

from shapely.geometry import Point
from shapely.geometry.base import BaseGeometry

from adresse_pipeline.brands import Catalogue, Place, Store, dedupe, distance_m, normalize

CATALOGUE = Path(__file__).resolve().parents[2] / "data" / "luxury_brands.csv"
# Places a reviewer checked by hand and found not to be a boutique, each with its reason.
NOT_BOUTIQUES = Path(__file__).resolve().parents[2] / "data" / "not_boutiques.csv"


# Paris department stores that host brand concessions. Overture places a concession
# at the store's address, and OSM rarely maps it; it is not a street location choice.
GRANDS_MAGASINS = ("galerieslafayette", "printemps", "bonmarche", "samaritaine", "bhv")
CONCESSION_RADIUS_M = 120
# Where each one stands, for when Overture files it under another category or not at all:
# release 2026-10-21.0 has La Samaritaine only as "shopping", so its 16 concessions slipped through.
KNOWN_STORES = (
    ("La Samaritaine", 2.3428, 48.8592),
    ("Galeries Lafayette Haussmann", 2.3320, 48.8735),
    ("Printemps Haussmann", 2.3282, 48.8740),
    ("Le Bon Marché", 2.3245, 48.8510),
    ("BHV Marais", 2.3530, 48.8575),
)


def department_stores(places: Iterable[Place]) -> list[Place]:
    found = [
        p
        for p in places
        if p.category == "department_store"
        and any(name in normalize(p.name) for name in GRANDS_MAGASINS)
    ]
    known = [
        Place(f"known:{name}", name, None, None, "department_store", "open", 1.0, lon, lat)
        for name, lon, lat in KNOWN_STORES
    ]
    return found + known


def is_concession(place: Place) -> bool:
    """A name that says where it is hosted: "LOEWE La Samaritaine", "Hublot Galeries Lafayette"."""
    return any(name in normalize(place.name) for name in GRANDS_MAGASINS)


def not_boutiques(path: Path = NOT_BOUTIQUES) -> dict[str, str]:
    """Overture ids checked by hand and left out, with the reason for each."""
    with path.open(newline="", encoding="utf-8") as f:
        return {row["overture_id"]: row["reason"] for row in csv.DictReader(f)}


def find_stores(
    places: Iterable[Place], catalogue: Catalogue, excluded: Collection[str] = frozenset()
) -> tuple[list[Store], int]:
    """Street boutiques of catalogue brands, and how many concessions were left out.

    `excluded` holds Overture ids a reviewer found not to be boutiques.
    """
    places = list(places)
    anchors = department_stores(places)
    stores = dedupe(
        [Store(p, b) for p in places if p.id not in excluded and (b := catalogue.match(p))]
    )
    street = [
        s
        for s in stores
        if not is_concession(s.place)
        and all(distance_m(s.place, a) > CONCESSION_RADIUS_M for a in anchors)
    ]
    return street, len(stores) - len(street)


def in_city(stores: list[Store], area: BaseGeometry) -> list[Store]:
    """The boutiques within the city: the map, the counts and the model are about Paris."""
    return [s for s in stores if area.contains(Point(s.place.lon, s.place.lat))]


def to_geojson(stores: list[Store], release: str, confirmed: set[str] | None = None) -> dict:
    """`confirmed` holds the ids OpenStreetMap agrees on; None when OSM was not checked."""
    return {
        "type": "FeatureCollection",
        "metadata": {
            "source": f"Overture Maps Foundation, places release {release}",
            "license": "CDLA-Permissive-2.0 / ODbL depending on source; see DATA_LICENSES.md",
        },
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(s.place.lon, 6), round(s.place.lat, 6)],
                },
                "properties": {
                    "id": s.place.id,
                    "brand": s.brand.name,
                    "segment": s.brand.segment.value,
                    "profile": s.brand.profile.value,
                    "name": s.place.name,
                    **({} if confirmed is None else {"osm_confirmed": s.place.id in confirmed}),
                },
            }
            for s in sorted(stores, key=lambda s: (s.brand.name, s.place.id))
        ],
    }
