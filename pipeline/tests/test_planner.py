import numpy as np
import pandas as pd

from adresse_pipeline.huff import Market
from adresse_pipeline.planner import plan

# A street of five blocks, five minutes apart.
CELLS = ["a", "b", "c", "d", "e"]


def street(demand):
    rows = [
        (o, d, 5.0 * abs(i - j))
        for i, o in enumerate(CELLS)
        for j, d in enumerate(CELLS)
        if 5.0 * abs(i - j) <= 20
    ]
    times = pd.DataFrame(rows, columns=["origin", "dest", "minutes"])
    return Market.build(CELLS, np.array(demand, dtype=float), times, beta=0.5)


ALL = np.ones(5, dtype=bool)


def test_first_pick_is_the_biggest_unserved_demand():
    m = street([10, 0, 0, 0, 100])
    (pick,) = plan(m, m.sites([]), m.sites([]), ALL, k=1)
    assert pick.cell == "e"


def test_second_pick_goes_to_new_shoppers_not_the_same_ones():
    # e holds the most demand, but once open the next best is a, not d next door
    m = street([60, 0, 0, 0, 100])
    picks = plan(m, m.sites([]), m.sites([]), ALL, k=2)
    assert [p.cell for p in picks] == ["e", "a"]


def test_never_picks_a_block_the_brand_already_holds_or_an_unsuitable_one():
    m = street([10, 0, 50, 0, 100])
    suitable = np.array([True, True, True, True, False])
    picks = plan(m, m.sites(["c"]), m.sites([]), suitable, k=3)
    assert {"c", "e"}.isdisjoint(p.cell for p in picks)


def test_stops_when_no_block_is_left():
    m = street([10, 10, 10, 10, 10])
    assert len(plan(m, m.sites([]), m.sites([]), np.array([1, 0, 0, 0, 0], bool), k=3)) == 1


def test_the_same_inputs_give_the_same_plan():
    m = street([10, 10, 10, 10, 10])  # every block ties
    first = plan(m, m.sites([]), m.sites([]), ALL, k=3)
    assert first == plan(m, m.sites([]), m.sites([]), ALL, k=3)
    assert first[0].cell == "c"  # the middle reaches the most demand
