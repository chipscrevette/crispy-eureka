import json

import pytest

from adresse_pipeline import apur


def unit(sit, surf=1, num=3, street="DAUNOU", x=2.3322, y=48.8692, type="V"):
    """A row shaped like the BDCOM 2023 'Local' layer answers."""
    return {
        "attributes": {
            "num": num,
            "let": None,
            "typ_voie": "RUE",
            "lib_voie": street,
            "sit": sit,
            "surf": surf,
            "type": type,
        },
        "geometry": {"x": x, "y": y},
    }


def test_only_street_and_corner_units_count_as_shopfronts():
    shops = list(apur.units([unit("R"), unit("A"), unit("CC"), unit("CI")]))

    assert [s.on_street for s in shops] == [True, True, False, False]
    assert shops[0].address == "3 RUE DAUNOU"
    assert shops[0].size is apur.Size.UNDER_300


def test_situation_codes_in_any_case_and_missing_ones_are_read():
    shops = list(apur.units([unit("r"), unit(" a"), unit(None, surf=None), unit("??")]))

    assert [s.on_street for s in shops] == [True, True, False, False]
    assert shops[2].situation is apur.Situation.UNKNOWN
    assert shops[2].size is None


def test_empty_and_flagship_sized_units_are_told_apart():
    shop, empty, big = apur.units([unit("R", type="C"), unit("R", type="v"), unit("A", surf=2)])

    assert (shop.empty, empty.empty, big.empty) == (False, True, True)
    assert (empty.flagship_size, big.flagship_size) == (False, True)


def test_units_without_a_position_are_left_out():
    row = unit("R")
    row["geometry"] = None
    assert list(apur.units([row])) == []


def test_an_error_answer_fails_loudly_and_leaves_the_cache(tmp_path):
    page = tmp_path / "query"
    page.write_text(json.dumps({"error": {"code": 400, "message": "Invalid query"}}))

    with pytest.raises(ValueError, match="APUR answered"):
        apur.read_page(page)
    assert not page.exists()


def test_every_page_is_read_and_checked_against_the_count(tmp_path, monkeypatch):
    monkeypatch.setattr(apur, "PAGE", 2)
    pages = {apur.query_url(): {"count": 3}}
    pages[apur.query_url(0)] = {"features": [unit("R"), unit("A")]}
    pages[apur.query_url(2)] = {"features": [unit("CC")]}

    def fake_fetch(url):
        path = tmp_path / str(abs(hash(url)))
        path.write_text(json.dumps(pages[url]))
        return path

    monkeypatch.setattr(apur, "fetch", fake_fetch)
    assert len(apur.fetch_units()) == 3

    pages[apur.query_url(2)] = {"features": []}
    with pytest.raises(ValueError, match="listed 3 units but returned 2"):
        apur.fetch_units()


def zone(name, kind, rings):
    """A row shaped like the BDCOM 2023 'Périmètre de zones touristiques' layer answers."""
    return {"attributes": {"nom": name, "c_type": kind}, "geometry": {"rings": rings}}


# clockwise in lon/lat, as ArcGIS writes an outline; reversed, the same square is a hole
SQUARE = [[2.33, 48.86], [2.33, 48.87], [2.34, 48.87], [2.34, 48.86], [2.33, 48.86]]
INNER = [[2.334, 48.864], [2.336, 48.864], [2.336, 48.866], [2.334, 48.866], [2.334, 48.864]]


def test_international_zones_are_told_apart_and_holes_are_cut_out():
    from shapely.geometry import Point

    zones = list(
        apur.tourist_zones(
            [
                zone("Haussmann", "zti", [SQUARE, INNER]),
                zone("Montmartre", "ZT", [SQUARE]),
                zone("Empty", "ZTI", []),
            ]
        )
    )

    assert [(z.name, z.international) for z in zones] == [
        ("Haussmann", True),
        ("Montmartre", False),
    ]
    assert zones[0].area.contains(Point(2.331, 48.861))
    assert not zones[0].area.contains(Point(2.335, 48.865))  # in the hole
    assert zones[1].area.contains(Point(2.335, 48.865))
