"""OpenStreetMap shops, used to cross-check the Overture boutique layer."""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from collections.abc import Iterable, Iterator
from dataclasses import dataclass

from adresse_pipeline.brands import Brand, Catalogue, Place, Store, distance_m
from adresse_pipeline.download import urlopen

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
LUXURY_SHOP_TAGS = (
    "clothes|jewelry|watches|shoes|bag|leather|perfumery|cosmetics|boutique|"
    "fashion_accessories|beauty|fashion"
)
PARIS_QUERY = f"""
[out:json][timeout:180];
area["ref:INSEE"="75056"]["admin_level"="8"]->.paris;
nwr["shop"~"^({LUXURY_SHOP_TAGS})$"]["name"](area.paris);
out center tags;
"""
# Two records closer than this are taken to be the same boutique.
MATCH_RADIUS_M = 75


@dataclass(frozen=True)
class Shop:
    osm_id: str
    name: str
    brand: str | None
    brand_wikidata: str | None
    lon: float
    lat: float


def fetch_paris_shops() -> dict:
    body = urllib.parse.urlencode({"data": PARIS_QUERY}).encode()
    request = urllib.request.Request(
        OVERPASS_URL, data=body, headers={"User-Agent": "adresse (github.com/chipscrevette)"}
    )
    with urlopen(request, timeout=240) as res:
        return json.load(res)


def shops(overpass: dict) -> Iterator[Shop]:
    for el in overpass["elements"]:
        point = el.get("center") or el
        tags = el.get("tags", {})
        yield Shop(
            f"{el['type']}/{el['id']}",
            tags["name"],
            tags.get("brand"),
            tags.get("brand:wikidata"),
            point["lon"],
            point["lat"],
        )


def brand_of(shop: Shop, catalogue: Catalogue) -> Brand | None:
    return (
        catalogue.brand_for_qid(shop.brand_wikidata)
        or catalogue.brand_for_name(shop.brand)
        or catalogue.brand_for_name(shop.name)
    )


def close(place: Place, shop: Shop) -> bool:
    probe = Place("", None, None, None, None, None, 0.0, shop.lon, shop.lat)
    return distance_m(place, probe) <= MATCH_RADIUS_M


@dataclass(frozen=True)
class CrossCheck:
    confirmed: set[str]
    """Overture place ids with an OSM shop of the same brand nearby."""
    osm_only: list[tuple[Brand, Shop]]
    """Catalogue boutiques mapped in OSM but missing from the Overture layer."""


def cross_check(stores: Iterable[Store], osm: Iterable[Shop], catalogue: Catalogue) -> CrossCheck:
    stores = list(stores)
    osm_stores = [(b, s) for s in osm if (b := brand_of(s, catalogue))]
    confirmed = {
        st.place.id
        for st in stores
        if any(b == st.brand and close(st.place, s) for b, s in osm_stores)
    }
    osm_only = [
        (b, s)
        for b, s in osm_stores
        if not any(st.brand == b and close(st.place, s) for st in stores)
    ]
    return CrossCheck(confirmed, osm_only)
