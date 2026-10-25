from shapely.geometry import box

from adresse_pipeline.overture import Area, arrondissement_number, arrondissements_geojson


def test_numbers_read_from_overture_names():
    assert arrondissement_number("Paris 1er Arrondissement") == 1
    assert arrondissement_number("Paris 2e Arrondissement") == 2
    assert arrondissement_number("Paris 20e Arrondissement") == 20


def test_geojson_is_ordered_and_labelled_inside_each_area():
    areas = [
        Area("Paris 2e Arrondissement", "macrohood", box(2.34, 48.86, 2.35, 48.87)),
        Area("Paris 1er Arrondissement", "macrohood", box(2.33, 48.85, 2.34, 48.86)),
    ]
    out = arrondissements_geojson(areas)
    assert [f["properties"].get("n") for f in out["features"]] == [1, 2, None]
    lon, lat = out["features"][0]["properties"]["label"]
    assert 2.33 <= lon <= 2.34 and 48.85 <= lat <= 48.86


def test_city_outline_is_one_polygon_around_touching_arrondissements():
    areas = [
        Area("Paris 1er Arrondissement", "macrohood", box(2.33, 48.85, 2.34, 48.86)),
        Area("Paris 2e Arrondissement", "macrohood", box(2.34, 48.85, 2.35, 48.86)),
    ]
    city = arrondissements_geojson(areas)["features"][-1]
    assert city["properties"] == {"city": True}
    assert city["geometry"]["type"] == "Polygon"
