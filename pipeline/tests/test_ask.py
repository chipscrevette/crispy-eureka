import re

import h3
import pytest

from adresse_pipeline.ask import (
    MARAIS,
    QUESTIONS,
    SAINT_GERMAIN,
    Paris,
    Tools,
    Trace,
    ordinal,
    places,
    run,
    short_place,
)
from adresse_pipeline.brands import Profile
from adresse_pipeline.model import WEB_DATA

needs_data = pytest.mark.skipif(
    not (WEB_DATA / "scores.json").exists(), reason="built data layers are not present"
)


@pytest.fixture(scope="module")
def paris():
    return Paris.load()


def numbers(text: str) -> set[str]:
    return {n.replace(",", "") for n in re.findall(r"\d[\d,]*(?:\.\d+)?", text)}


@needs_data
def test_every_number_in_every_answer_comes_from_one_of_its_tool_calls(paris):
    for q in QUESTIONS:
        out = run(q, paris)
        assert out["calls"], q.id
        found = numbers(str([c["result"] for c in out["calls"]]))
        found |= numbers(str([c["args"] for c in out["calls"]]))
        # ordinals print "88th" from the result's 88. The fixed wording is the
        # "/ 100" scale and the H3 ring radius ("about 350 m").
        text = out["answer"].replace("/ 100", "").replace("about 350 m", "")
        missing = numbers(text) - found
        assert not missing, f"{q.id}: {missing} not in any tool result"


@needs_data
def test_white_space_blocks_really_have_no_boutique_of_the_profile_nearby(paris):
    trace = Trace()
    for p in Profile:
        for b in Tools(paris, trace).top_blocks(p, without_competitors=True):
            cell = b["cell"]
            nearby = set(h3.grid_disk(cell, 1))
            stores = {h3.latlng_to_cell(s.lat, s.lon, paris.resolution) for s in paris.boutiques if s.profile == p}
            assert not nearby & stores, (p, cell)


@needs_data
def test_the_landmarks_fall_on_paris_blocks(paris):
    for lat, lon in (MARAIS, SAINT_GERMAIN):
        assert h3.latlng_to_cell(lat, lon, paris.resolution) in paris.blocks


def test_arrondissement_names_read_as_english_ordinals():
    assert short_place("Paris 1er Arrondissement") == "the 1st arrondissement"
    assert short_place("Paris 12e Arrondissement") == "the 12th arrondissement"
    assert short_place(None) == "Paris"
    assert ordinal(22) == "22nd"


def test_places_groups_repeated_arrondissements_in_order():
    rows = [("the 4th", "96"), ("the 3rd", "93"), ("the 4th", "95")]
    assert places(rows) == "the 4th (96, 95), the 3rd (93)"
