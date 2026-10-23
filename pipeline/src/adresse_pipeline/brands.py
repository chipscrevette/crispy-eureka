"""Luxury brand catalogue and matching of map places to brands."""

from __future__ import annotations

import csv
import math
import re
import unicodedata
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path


class Segment(StrEnum):
    FASHION_HOUSE = "fashion house"
    LEATHER_GOODS = "leather goods"
    SHOES = "shoes"
    PREMIUM_FASHION = "premium fashion"
    JEWELLERY_WATCHES = "jewellery & watches"
    BEAUTY = "beauty"


class Profile(StrEnum):
    """The three brand profiles a user can score Paris for."""

    JEWELLERY_WATCHES = "jewellery-watches"
    FASHION_HOUSE = "fashion-house"
    BEAUTY = "beauty"


PROFILE_OF_SEGMENT: dict[Segment, Profile] = {
    Segment.FASHION_HOUSE: Profile.FASHION_HOUSE,
    Segment.LEATHER_GOODS: Profile.FASHION_HOUSE,
    Segment.SHOES: Profile.FASHION_HOUSE,
    Segment.PREMIUM_FASHION: Profile.FASHION_HOUSE,
    Segment.JEWELLERY_WATCHES: Profile.JEWELLERY_WATCHES,
    Segment.BEAUTY: Profile.BEAUTY,
}

# Overture `basic_category` values that can be a boutique. Department stores are
# left out on purpose: their concessions are not standalone location choices.
STORE_CATEGORIES = frozenset(
    {"fashion_and_apparel_store", "personal_care_and_beauty_store", "shopping"}
)

# A place name may carry a suffix ("Cartier Paris Rue de la Paix"), but not a
# long one: "Céline Dupont Psychologue" is someone's practice, not the brand.
MAX_SUFFIX_CHARS = 12


@dataclass(frozen=True)
class Brand:
    name: str
    segment: Segment
    wikidata: str | None

    @property
    def profile(self) -> Profile:
        return PROFILE_OF_SEGMENT[self.segment]


@dataclass(frozen=True)
class Place:
    id: str
    name: str | None
    brand_name: str | None
    brand_wikidata: str | None
    category: str | None
    operating_status: str | None
    confidence: float
    lon: float
    lat: float


@dataclass(frozen=True)
class Store:
    place: Place
    brand: Brand


def normalize(text: str | None) -> str:
    folded = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", folded.lower())


class Catalogue:
    def __init__(self, brands: list[Brand]):
        self.brands = brands
        self._by_key = {normalize(b.name): b for b in brands}
        self._by_qid = {b.wikidata: b for b in brands if b.wikidata}

    @classmethod
    def from_csv(cls, path: Path) -> Catalogue:
        with path.open(newline="", encoding="utf-8") as f:
            return cls(
                [
                    Brand(row["brand"], Segment(row["segment"]), row["wikidata"] or None)
                    for row in csv.DictReader(f)
                ]
            )

    def brand_for_name(self, name: str | None) -> Brand | None:
        key = normalize(name)
        if not key:
            return None
        if key in self._by_key:
            return self._by_key[key]
        for brand_key, brand in self._by_key.items():
            if (
                len(brand_key) > 4
                and key.startswith(brand_key)
                and len(key) - len(brand_key) <= MAX_SUFFIX_CHARS
            ):
                return brand
        return None

    def match(self, place: Place) -> Brand | None:
        if place.category not in STORE_CATEGORIES:
            return None
        if place.operating_status not in (None, "open"):
            return None
        if place.brand_wikidata in self._by_qid:
            return self._by_qid[place.brand_wikidata]
        return self.brand_for_name(place.brand_name) or self.brand_for_name(place.name)


def distance_m(a: Place, b: Place) -> float:
    lat = math.radians((a.lat + b.lat) / 2)
    dx = math.radians(b.lon - a.lon) * math.cos(lat)
    dy = math.radians(b.lat - a.lat)
    return 6_371_000 * math.hypot(dx, dy)


def dedupe(stores: list[Store], radius_m: float = 40) -> list[Store]:
    """Keep one store per brand within `radius_m`, preferring higher confidence.

    Overture merges several sources, so one boutique often appears two or three
    times a few metres apart.
    """
    kept: list[Store] = []
    for store in sorted(stores, key=lambda s: -s.place.confidence):
        if not any(
            k.brand == store.brand and distance_m(k.place, store.place) <= radius_m for k in kept
        ):
            kept.append(store)
    return kept
