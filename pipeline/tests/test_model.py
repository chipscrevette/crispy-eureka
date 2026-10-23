import h3
import numpy as np
import pandas as pd
import pytest

from adresse_pipeline.brands import Profile
from adresse_pipeline.model import (
    NEIGHBOURS,
    Boutique,
    PositiveSet,
    design_matrix,
    drivers,
    in_set,
    labels,
    percentile,
    score_held_out,
)

CENTRE = h3.latlng_to_cell(48.8675, 2.3290, 9)  # Place Vendôme
RING = sorted(h3.grid_ring(CENTRE, 1))
FAR = h3.latlng_to_cell(48.8350, 2.4000, 9)


def boutique(cell, profile=Profile.JEWELLERY_WATCHES, confirmed=True, osm_only=False, brand="A"):
    return Boutique(brand, profile, cell, confirmed, osm_only)


def grid(cells):
    return pd.DataFrame(
        {"luxury_jewellery-watches_r1": 9, "apartment_price_m2": 1.0},
        index=pd.Index(cells, name="cell"),
    )


def test_design_matrix_never_counts_the_cells_own_boutiques():
    cells = [CENTRE, RING[0], FAR]
    x = design_matrix(grid(cells), [boutique(CENTRE), boutique(CENTRE), boutique(RING[0])])
    assert "luxury_jewellery-watches_r1" not in x.columns
    assert x.loc[CENTRE, NEIGHBOURS] == 1  # only the ring boutique
    assert x.loc[RING[0], NEIGHBOURS] == 2  # both centre boutiques
    assert x.loc[FAR, NEIGHBOURS] == 0


def test_labels_follow_the_profile():
    cells = [CENTRE, RING[0]]
    y = labels(
        grid(cells),
        [boutique(CENTRE), boutique(RING[0], Profile.BEAUTY)],
        Profile.JEWELLERY_WATCHES,
    )
    assert y.tolist() == [1, 0]


def test_positive_sets():
    overture_only = boutique(CENTRE, confirmed=False)
    confirmed = boutique(CENTRE)
    osm_only = boutique(CENTRE, osm_only=True)
    assert [in_set(b, PositiveSet.CONFIRMED) for b in (overture_only, confirmed, osm_only)] == [
        False,
        True,
        False,
    ]
    assert [in_set(b, PositiveSet.OVERTURE) for b in (overture_only, confirmed, osm_only)] == [
        True,
        True,
        False,
    ]
    assert all(in_set(b, PositiveSet.UNION) for b in (overture_only, confirmed, osm_only))


def test_percentile_puts_the_best_cell_at_100():
    assert percentile(np.array([0.1, 0.5, 0.9, 0.3])).tolist() == [25.0, 75.0, 100.0, 50.0]


def test_held_out_cells_are_ranked_against_unlabelled_cells_only():
    scores = np.array([0.9, 0.8, 0.1, 0.2, 0.95])
    held_out = np.array([False, True, False, False, False])
    unlabelled = np.array([False, True, True, True, False])  # cells 0 and 4 are training positives
    assert score_held_out(scores, held_out, unlabelled) == pytest.approx([200 / 3])


def test_drivers_rank_by_size_and_keep_the_raw_value():
    out = drivers(
        np.array([0.1, -0.7, 0.0, 0.3]),
        np.array([5.0, np.nan, 1.0, 2.0]),
        ["a", "b", "c", "d"],
        top=3,
    )
    assert out == [["b", -0.7, None], ["d", 0.3, 2.0], ["a", 0.1, 5.0]]
