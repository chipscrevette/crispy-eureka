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

# Brands that are also first names: "Celine Daoust", "Chloe Bay" or "Céline Calvez!" are
# people's shops. After such a brand every word must be one a boutique uses.
FIRST_NAME_BRANDS = frozenset({"celine", "chloe"})
# A name that goes on with one of these is a boutique telling where it is, however long:
# "Saint Laurent Champs Elysees", "FRED Rue de la Paix", "Guerlain Boutique et Suite Facialiste".
BOUTIQUE_WORDS = frozenset(
    {"paris", "boutique", "store", "flagship", "femme", "homme", "men", "women"}
    | {"rue", "avenue", "boulevard", "place", "faubourg", "montaigne", "vendome"}
    | {"champs", "saint", "rive", "marais", "haussmann", "opera", "grenelle", "babylone"}
)
STOP_WORDS = frozenset({"de", "du", "des", "la", "le", "les", "et"})
# Words a boutique's name may put before the brand: "Les Boutiques Boucheron", "Christian Dior".
LEADING_WORDS = frozenset(
    {"les", "la", "le", "boutique", "boutiques", "maison", "christian", "polo"}
)

# Words that make a place something other than a boutique: offices, legal entities,
# showrooms, museums, a brand's restaurant, outlet stock, pop-ups, workshops.
NOT_A_BOUTIQUE = frozenset(
    {"bureau", "bureaux", "showroom", "sas", "sarl", "group", "groupe", "retail"}
    | {"foundation", "fondation", "etablissement", "galerie", "restaurant", "stock"}
    | {"serres", "ephemere", "sellier"}
)

# How a brand's own boutiques may spell it when the name differs from the catalogue.
ALIASES: dict[str, tuple[str, ...]] = {
    "Bulgari": ("bvlgari",),
    "Tiffany & Co.": ("tiffany",),
    "Van Cleef & Arpels": ("van cleef",),
}


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


def words(text: str | None) -> list[str]:
    """The name's words without accents or punctuation: "Hermès, Paris" → ["hermes", "paris"]."""
    folded = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    return re.findall(r"[a-z0-9]+", folded.lower())


def _contains(seq: list[str], part: list[str]) -> bool:
    return any(seq[i : i + len(part)] == part for i in range(len(seq) - len(part) + 1))


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

    def brand_for_qid(self, qid: str | None) -> Brand | None:
        return self._by_qid.get(qid) if qid else None

    def brand_for_name(self, name: str | None) -> Brand | None:
        """The brand a name starts with, whole words only: "Graffiti Bazar" is not Graff."""
        key = normalize(name)
        if not key:
            return None
        if key in self._by_key:
            return self._by_key[key]
        found = words(name)
        # the name as it is, then without the words a boutique may put before the brand
        starts = [found]
        while starts[-1] and starts[-1][0] in LEADING_WORDS:
            starts.append(starts[-1][1:])
        for brand in self.brands:
            for spelling in (brand.name, *ALIASES.get(brand.name, ())):
                head = words(spelling)
                for start in starts:
                    if start[: len(head)] == head and self._goes_on_as_a_boutique(
                        brand, start[len(head) :]
                    ):
                        return brand
        return None

    @staticmethod
    def _goes_on_as_a_boutique(brand: Brand, rest: list[str]) -> bool:
        key = normalize(brand.name)
        # after a first name, every word must be a boutique's: "Celine Paris Coiffure" is a salon
        if key in FIRST_NAME_BRANDS:
            return set(rest) <= BOUTIQUE_WORDS | STOP_WORDS
        if not rest or rest[0] in BOUTIQUE_WORDS:
            return True
        if len(key) <= 4:
            return False
        return len("".join(rest)) <= MAX_SUFFIX_CHARS

    def named_in(self, brand: Brand, name: str | None) -> bool:
        """Whether a place's own name shows the brand, as a boutique's sign would."""
        found = words(name)
        return any(
            _contains(found, words(spelling))
            for spelling in (brand.name, *ALIASES.get(brand.name, ()))
        )

    def match(self, place: Place) -> Brand | None:
        if place.category not in STORE_CATEGORIES:
            return None
        if place.operating_status not in (None, "open"):
            return None
        # "S.A.S." reads as one word once its dots are gone
        found = set(words(place.name)) | set(words((place.name or "").replace(".", "")))
        if found & NOT_A_BOUTIQUE:
            return None
        by_name = self.brand_for_name(place.name)
        # a brand tag alone is not enough: "77 Diamonds" tagged Graff, "Restaurant" tagged Dior
        tagged = self.brand_for_qid(place.brand_wikidata) or self.brand_for_name(place.brand_name)
        brand = by_name or (tagged if tagged and self.named_in(tagged, place.name) else None)
        # a fashion or jewellery brand's perfume line is a counter or an office, not its boutique
        if (
            brand
            and brand.segment != Segment.BEAUTY
            and "parfums" in found
            and "beaute" not in found
        ):
            return None
        return brand


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
