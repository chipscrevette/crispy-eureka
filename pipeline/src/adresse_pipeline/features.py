"""Every feature on the Paris grid, with what it means and where it comes from."""

from __future__ import annotations

from dataclasses import asdict, dataclass

from adresse_pipeline.brands import Profile


@dataclass(frozen=True)
class Feature:
    key: str
    label: str
    unit: str
    source: str
    description: str


OVERTURE = "Overture Maps Places"
INSEE = "INSEE Filosofi, 200 m grid"
DVF = "DVF (DGFiP, Etalab geolocated)"
IDFM = "Île-de-France Mobilités rail validations"
SIRENE = "INSEE Sirene establishments"
HOTELS = "Atout France classified hotels"
APUR = "APUR BDCOM (census of Paris ground-floor units)"

# Overture `basic_category` values counted for each context feature.
CONTEXT_CATEGORIES: dict[str, frozenset[str]] = {
    "hotels_r1": frozenset({"hotel", "lodging"}),
    "dining_r1": frozenset({"restaurant", "cafe", "coffee_shop", "bar"}),
    "culture_r1": frozenset(
        {"art_gallery", "historic_site", "museum", "arts_and_entertainment", "music_venue"}
    ),
    "fashion_stores_r1": frozenset({"fashion_and_apparel_store"}),
    "beauty_stores_r1": frozenset({"personal_care_and_beauty_store"}),
    "mass_market_r1": frozenset({"fast_food_restaurant", "convenience_store"}),
    "offices_r1": frozenset({"corporate_or_business_office", "financial_service"}),
}

RING = "in the cell and its six neighbours (about 350 m around)"

FEATURES: list[Feature] = [
    Feature("hotels_r1", "Hotels", "places", OVERTURE, f"Hotels and lodgings {RING}"),
    Feature(
        "dining_r1",
        "Restaurants & cafés",
        "places",
        OVERTURE,
        f"Restaurants, cafés and bars {RING}",
    ),
    Feature(
        "culture_r1",
        "Culture",
        "places",
        OVERTURE,
        f"Galleries, museums, historic sites and venues {RING}",
    ),
    Feature(
        "fashion_stores_r1",
        "Fashion stores",
        "places",
        OVERTURE,
        f"All fashion and apparel stores {RING}",
    ),
    Feature(
        "beauty_stores_r1",
        "Beauty stores",
        "places",
        OVERTURE,
        f"All beauty and personal-care stores {RING}",
    ),
    Feature(
        "mass_market_r1",
        "Mass-market outlets",
        "places",
        OVERTURE,
        f"Fast food and convenience stores {RING}",
    ),
    Feature(
        "offices_r1",
        "Offices",
        "places",
        OVERTURE,
        f"Corporate offices and financial services {RING}",
    ),
    *[
        Feature(
            f"luxury_{p.value}_r1",
            f"Luxury boutiques ({p.value})",
            "boutiques",
            OVERTURE,
            f"Catalogue boutiques of the {p.value} profile {RING}",
        )
        for p in Profile
    ],
    Feature("population_r1", "Residents", "people", INSEE, f"Residents {RING}"),
    Feature(
        "living_standard_r1",
        "Living standard",
        "€ / person / year",
        INSEE,
        f"Mean disposable income per consumption unit of residents {RING}",
    ),
    Feature(
        "owners_share_r1",
        "Home owners",
        "share",
        INSEE,
        f"Share of households owning their home {RING}",
    ),
    Feature(
        "poverty_share_r1",
        "Households in poverty",
        "share",
        INSEE,
        f"Share of households below the poverty line {RING}",
    ),
    Feature(
        "apartment_price_m2",
        "Apartment price",
        "€ / m²",
        DVF,
        "Median sale price of apartments within about 350 m (700 m where sales are sparse)",
    ),
    Feature(
        "apartment_sales_r1", "Apartment sales", "sales", DVF, f"Single-apartment sales {RING}"
    ),
    Feature(
        "commercial_price_m2",
        "Retail premises price",
        "€ / m²",
        DVF,
        "Median sale price of commercial premises within about 350 m (700 m where sparse)",
    ),
    Feature(
        "transit_entries_r2",
        "Station entries",
        "entries / day",
        IDFM,
        "Average daily entries at metro, RER and train stations within about 600 m",
    ),
    Feature(
        "commercial_sales_r1",
        "Retail premises sales",
        "sales",
        DVF,
        f"Commercial-premises sales {RING}",
    ),
]


# Shown on the map, but never given to the model. Whether a unit stands empty says whether a
# brand can move in, not whether the place suits luxury. Upscale hotel rooms and the
# international tourist zones did not improve the hidden-brand test
# (pipeline/output/benchmark.json, "open data + upscale hotel rooms" and "+ international tourist zones").
OVERLAYS: list[Feature] = [
    Feature(
        "upscale_rooms_r1",
        "Upscale hotel rooms",
        "rooms",
        HOTELS,
        f"Rooms in 4- and 5-star hotels {RING}",
    ),
    Feature(
        "tourist_zone_r1",
        "International tourist zone",
        "share",
        APUR,
        "Share of the block and its six neighbours inside an international tourist zone (ZTI), "
        "where shops may open on Sundays and late in the evening",
    ),
    Feature(
        "vacant_shops_r1",
        "Empty shops",
        "units",
        APUR,
        f"Empty ground-floor shop units on the street or on a corner {RING}",
    ),
    Feature(
        "vacancy_r1",
        "Empty shopfront share",
        "share",
        APUR,
        f"Share of the shopfronts on the street or on a corner that stand empty, {RING}",
    ),
    Feature(
        "large_vacant_r1",
        "Empty flagship-size shops",
        "units",
        APUR,
        f"Empty shopfronts of 300 m² or more on the street or on a corner {RING}",
    ),
]


def as_json() -> list[dict]:
    return [asdict(f) for f in [*FEATURES, *OVERLAYS]]
