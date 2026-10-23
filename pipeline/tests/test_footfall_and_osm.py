from pathlib import Path

import pytest

from adresse_pipeline import idfm, osm
from adresse_pipeline.brands import Brand, Catalogue, Place, Segment, Store

CATALOGUE = Catalogue.from_csv(Path(__file__).resolve().parents[1] / "data" / "luxury_brands.csv")

# --- Île-de-France Mobilités ---

VALIDATIONS = (
    "JOUR;CODE_STIF_TRNS;CODE_STIF_RES;CODE_STIF_ARRET;ID_ZDC;LIBELLE_ARRET;CATEGORIE_TITRE;NB_VALD\n"
    "2025-10-01;100;110;90;71320;BONNE NOUVELLE;Navigo;1000\n"
    "2025-10-01;100;110;90;71320;BONNE NOUVELLE;NON DEFINI;Moins de 5\n"
    "2025-10-02;100;110;90;71320;BONNE NOUVELLE;Navigo;3000\n"
    "2025-10-02;100;110;88;71920;BOLIVAR;Navigo;400\n"
)

STATIONS = (
    "Geo Point;id_ref_ZdC;nom_ZdC;res_com\n"
    '"48.8705, 2.3485";71320;Bonne Nouvelle;METRO 8\n'
    '"48.8707, 2.3489";71320;Bonne Nouvelle;METRO 9\n'
    '"48.8807, 2.3740";71920;Bolivar;METRO 7bis\n'
    '"48.9000, 2.3000";99999;No ridership;METRO 1\n'
)


def write(tmp_path, name, text):
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return path


def test_daily_entries_average_over_all_days_and_ignore_suppressed_counts(tmp_path):
    entries = idfm.daily_entries_by_zdc(idfm.read_csv(write(tmp_path, "v.csv", VALIDATIONS)))

    assert entries == {"71320": 2000, "71920": 200}


def test_stations_merge_lines_into_one_point_and_drop_stations_without_ridership(tmp_path):
    entries = {"71320": 2000.0, "71920": 200.0}
    stations = idfm.stations(idfm.read_csv(write(tmp_path, "s.csv", STATIONS)), entries)

    by_zdc = {s.zdc: s for s in stations}
    assert set(by_zdc) == {"71320", "71920"}
    assert by_zdc["71320"].lon == pytest.approx(2.3487)
    assert by_zdc["71320"].daily_entries == 2000


# --- OpenStreetMap cross-check ---


def overpass(*elements):
    return {"elements": list(elements)}


def node(id, name, lon, lat, **tags):
    return {"type": "node", "id": id, "lon": lon, "lat": lat, "tags": {"name": name, **tags}}


def store(id, brand, lon, lat):
    return Store(
        Place(id, brand.name, None, None, "fashion_and_apparel_store", "open", 0.9, lon, lat), brand
    )


CARTIER = Brand("Cartier", Segment.JEWELLERY_WATCHES, None)
CHANEL = Brand("Chanel", Segment.FASHION_HOUSE, None)


def test_ways_use_their_centre():
    way = {"type": "way", "id": 7, "center": {"lon": 2.33, "lat": 48.87}, "tags": {"name": "Dior"}}
    [shop] = osm.shops(overpass(way))
    assert (shop.osm_id, shop.lon) == ("way/7", 2.33)


def test_cross_check_confirms_same_brand_nearby_only():
    stores = [
        store("a", CARTIER, 2.3308, 48.8686),
        store("b", CHANEL, 2.3200, 48.8700),
    ]
    shops = osm.shops(
        overpass(
            node(1, "Cartier", 2.3309, 48.8687),  # ~13 m from a
            node(2, "Dior", 2.3200, 48.8700),  # same spot as b, other brand
            node(3, "Boutique", 2.3500, 48.8600, brand="Chanel"),  # Chanel, far from b
        )
    )

    check = osm.cross_check(stores, shops, CATALOGUE)

    assert check.confirmed == {"a"}
    assert sorted((b.name, s.osm_id) for b, s in check.osm_only) == [
        ("Chanel", "node/3"),
        ("Dior", "node/2"),
    ]


def test_cross_check_ignores_shops_outside_the_catalogue():
    shops = osm.shops(overpass(node(1, "Zara", 2.33, 48.87)))
    assert osm.cross_check([], shops, CATALOGUE).osm_only == []
