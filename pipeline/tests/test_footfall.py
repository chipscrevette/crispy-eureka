import numpy as np
from scipy.sparse import coo_matrix

from adresse_pipeline import footfall
from adresse_pipeline.walk import METRES_PER_MIN, WalkGraph


def street(n: int, metres: float = 100.0) -> WalkGraph:
    """A straight street of n nodes, `metres` apart, as `walk.build_graph` stores it."""
    a = np.arange(n - 1)
    minutes = np.full(n - 1, metres / METRES_PER_MIN)
    edges = coo_matrix((minutes, (a, a + 1)), shape=(n, n)).tocsr()
    return WalkGraph(edges, np.column_stack([np.arange(n) * metres, np.zeros(n)]))


def test_the_middle_of_a_street_carries_the_most_walks():
    walks = footfall.street_betweenness(street(4), radius=1000)["walks"].tolist()

    # 0-1 lies on the walks from 0 to 1, 2, 3; 1-2 on every walk crossing the middle
    assert walks == [3, 4, 3]


def test_walks_longer_than_the_radius_do_not_count():
    walks = footfall.street_betweenness(street(4), radius=150)["walks"].tolist()

    assert walks == [1, 1, 1]
    assert footfall.street_betweenness(street(4))["metres"].tolist() == [100, 100, 100]


def test_each_block_gets_its_busiest_street_with_the_median_at_100():
    streets = footfall.street_betweenness(street(4), radius=1000)
    cells = footfall.by_cell(streets, lambda lon, lat: "east" if lon > 2.3488 else "west")

    assert cells.to_dict() == {"east": 4 / 3 * 100, "west": 100.0}
