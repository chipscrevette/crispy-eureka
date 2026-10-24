import json

import pytest

from adresse_pipeline import apur


def unit(sit, surf=1, num=3, street="DAUNOU", x=2.3322, y=48.8692):
    """A row shaped like the BDCOM 2023 'Local' layer answers."""
    return {
        "attributes": {
            "num": num,
            "let": None,
            "typ_voie": "RUE",
            "lib_voie": street,
            "sit": sit,
            "surf": surf,
        },
        "geometry": {"x": x, "y": y},
    }


def test_only_street_and_corner_units_count_as_shopfronts():
    shops = list(apur.vacant_shops([unit("R"), unit("A"), unit("CC"), unit("CI")]))

    assert [s.on_street for s in shops] == [True, True, False, False]
    assert shops[0].address == "3 RUE DAUNOU"
    assert shops[0].size is apur.Size.UNDER_300


def test_units_without_a_position_are_left_out():
    row = unit("R")
    row["geometry"] = None
    assert list(apur.vacant_shops([row])) == []


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
    assert len(apur.fetch_vacant()) == 3

    pages[apur.query_url(2)] = {"features": []}
    with pytest.raises(ValueError, match="listed 3 empty units but returned 2"):
        apur.fetch_vacant()
