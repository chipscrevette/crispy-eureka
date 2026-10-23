from pathlib import Path

import pytest

from adresse_pipeline.brands import Brand, Catalogue, Place, Profile, Segment, Store, dedupe

CATALOGUE = Catalogue.from_csv(Path(__file__).resolve().parents[1] / "data" / "luxury_brands.csv")


def place(
    name,
    *,
    category="fashion_and_apparel_store",
    status="open",
    qid=None,
    brand_name=None,
    confidence=0.9,
    lon=2.3308,
    lat=48.8686,
    id="p",
):
    return Place(id, name, brand_name, qid, category, status, confidence, lon, lat)


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Cartier", "Cartier"),
        ("CARTIER Paris", "Cartier"),
        ("Hermès Faubourg", "Hermès"),
        ("Hermes", "Hermès"),
        ("Van Cleef & Arpels", "Van Cleef & Arpels"),
    ],
)
def test_matches_brand_names_with_short_suffixes_and_accents(name, expected):
    assert CATALOGUE.match(place(name)).name == expected


def test_rejects_long_names_that_only_start_with_a_brand():
    assert CATALOGUE.match(place("Céline Dupont Psychologue Clinicienne")) is None


def test_rejects_places_that_are_not_shops():
    assert CATALOGUE.match(place("Cartier", category="dental_clinic")) is None


def test_rejects_department_store_concessions():
    assert CATALOGUE.match(place("Dior", category="department_store")) is None


def test_rejects_closed_places():
    assert CATALOGUE.match(place("Chanel", status="permanently_closed")) is None


def test_wikidata_id_wins_over_an_unrecognised_name():
    assert CATALOGUE.match(place("Boutique Rue Saint-Honoré", qid="Q178516")).name == "Gucci"


def test_every_segment_maps_to_one_of_three_profiles():
    assert {b.profile for b in CATALOGUE.brands} == set(Profile)


def test_dedupe_keeps_one_store_per_brand_nearby_and_the_most_confident():
    brand = Brand("Cartier", Segment.JEWELLERY_WATCHES, None)
    a = Store(place("Cartier", id="a", confidence=0.6), brand)
    b = Store(place("Cartier", id="b", confidence=0.95, lon=2.33085), brand)
    far = Store(place("Cartier", id="far", lon=2.3010, lat=48.8710), brand)

    kept = dedupe([a, b, far])

    assert {s.place.id for s in kept} == {"b", "far"}


def test_dedupe_keeps_different_brands_at_the_same_address():
    cartier = Store(place("Cartier", id="c"), Brand("Cartier", Segment.JEWELLERY_WATCHES, None))
    chanel = Store(place("Chanel", id="h"), Brand("Chanel", Segment.FASHION_HOUSE, None))

    assert len(dedupe([cartier, chanel])) == 2


def test_find_stores_leaves_out_department_store_concessions():
    from adresse_pipeline.luxury_stores import find_stores

    printemps = place(
        "Printemps Haussmann", category="department_store", id="pr", lon=2.3290, lat=48.8739
    )
    inside = place("Dior", id="concession", lon=2.3292, lat=48.8740)
    street = place("Dior", id="montaigne", lon=2.3045, lat=48.8660)

    stores, concessions = find_stores([printemps, inside, street], CATALOGUE)

    assert [s.place.id for s in stores] == ["montaigne"]
    assert concessions == 1
