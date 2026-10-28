from pathlib import Path

from shapely.geometry import box

from adresse_pipeline.brands import Catalogue, Place
from adresse_pipeline.luxury_stores import find_stores, in_city

CATALOGUE = Catalogue.from_csv(Path(__file__).resolve().parents[1] / "data" / "luxury_brands.csv")


def place(name, lon, lat, *, id=None, category="fashion_and_apparel_store", brand=None):
    return Place(id or name, name, brand, None, category, "open", 0.9, lon, lat)


def test_leaves_out_samaritaine_concessions_even_when_overture_has_no_department_store_there():
    # release 2026-10-21.0 files La Samaritaine as "shopping" only
    places = [
        place("Grands Magasins de la Samaritaine", 2.34297, 48.85956, category="shopping"),
        place("Loewe", 2.342438, 48.859261),
        place("Gucci", 2.3428, 48.8593),
        place("Gucci", 2.3231, 48.8685, id="faubourg"),
    ]

    stores, concessions = find_stores(places, CATALOGUE)

    assert [s.place.id for s in stores] == ["faubourg"]
    assert concessions == 2


def test_leaves_out_a_boutique_named_after_its_department_store_wherever_it_is_placed():
    stores, concessions = find_stores(
        [place("LOEWE La Samaritaine", 2.30, 48.87, brand="Loewe")], CATALOGUE
    )

    assert stores == [] and concessions == 1


def test_keeps_only_boutiques_inside_the_city():
    paris = box(2.25, 48.82, 2.42, 48.90)
    stores, _ = find_stores(
        [
            place("Chanel", 2.3245, 48.8670, id="cambon"),
            place("Chanel", 2.4430, 48.8977, id="pantin"),
        ],
        CATALOGUE,
    )

    assert [s.place.id for s in in_city(stores, paris)] == ["cambon"]
