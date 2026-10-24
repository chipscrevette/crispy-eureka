import numpy as np
import pandas as pd
import pytest

from adresse_pipeline.huff import OUTSIDE, Market, mean_percentile

# A street of four blocks, five minutes apart, with all demand at both ends.
CELLS = ["a", "b", "c", "d"]


def street(beta=0.2, demand=(100.0, 0.0, 0.0, 100.0)):
    rows = [
        (o, d, 5.0 * abs(i - j))
        for i, o in enumerate(CELLS)
        for j, d in enumerate(CELLS)
        if 5.0 * abs(i - j) <= 20
    ]
    times = pd.DataFrame(rows, columns=["origin", "dest", "minutes"])
    return Market.build(CELLS, np.array(demand), times, beta)


def test_a_lone_boutique_wins_most_of_its_own_block():
    m = street()
    own = m.sites(["a"])
    # block a: 1 / (OUTSIDE + 1); block d is 15 minutes away
    far = np.exp(-0.2 * 15)
    expected = 100 / (OUTSIDE + 1) + 100 * far / (OUTSIDE + far)
    assert m.capture(own, m.sites([])) == pytest.approx(expected)


def test_a_rival_next_door_halves_the_capture_of_that_block():
    m = street(demand=(100.0, 0.0, 0.0, 0.0))
    alone = m.capture(m.sites(["a"]), m.sites([]))
    shared = m.capture(m.sites(["a"]), m.sites(["a"]))
    assert shared == pytest.approx(100 / 3) and alone == pytest.approx(50)


def test_gain_is_gross_capture_minus_cannibalisation():
    m = street()
    own, rivals = m.sites(["a"]), m.sites(["d"])
    openings = m.openings(own, rivals)

    for cell in CELLS:
        after = m.capture(own + m.sites([cell]), rivals)
        assert openings.loc[cell, "gain"] == pytest.approx(after - m.capture(own, rivals))
    assert (openings["gain"] == openings["gross"] - openings["cannibalised"]).all()


def test_opening_next_to_yourself_cannibalises_more_than_opening_across_town():
    m = street()
    openings = m.openings(m.sites(["a"]), m.sites([]))

    assert openings.loc["a", "cannibalised"] > openings.loc["d", "cannibalised"]
    assert openings["gain"].idxmax() == "d"


def test_a_steeper_decay_shrinks_reach():
    gentle, steep = street(beta=0.05).reachable(), street(beta=1.0).reachable()
    # block b holds no demand of its own, so all it reaches is a and d, 5 and 10 min away
    assert gentle[1] > steep[1]


def test_mean_percentile_of_the_top_block_is_100():
    assert mean_percentile(np.array([1.0, 2.0, 3.0, 4.0]), np.array([0, 0, 0, 1], bool)) == 100
