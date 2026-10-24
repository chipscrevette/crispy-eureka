import numpy as np
import pyarrow as pa
import pytest
import shapely

from adresse_pipeline.walk import METRES_PER_MIN, build_graph, to_metres, walkable

# about 100 m per 0.0009 degrees of latitude in Paris
STEP = 0.0009
LON, LAT = 2.30, 48.86


def segment(points, ids, cls="footway"):
    """A street through `points` (offsets in STEPs), with a connector at each point."""
    coords = [(LON + x * STEP * 1.5, LAT + y * STEP) for x, y in points]
    line = shapely.LineString(coords)
    ats = [line.project(shapely.Point(c), normalized=True) for c in coords]
    return {
        "class": cls,
        "geometry": shapely.to_wkb(line),
        "connectors": [{"connector_id": i, "at": a} for i, a in zip(ids, ats, strict=True)],
    }


def table(rows):
    return pa.Table.from_pylist(rows)


def minutes_between(graph, a, b):
    (na, nb), _ = graph.snap(
        *np.array(
            [
                [LON + a[0] * STEP * 1.5, LON + b[0] * STEP * 1.5],
                [LAT + a[1] * STEP, LAT + b[1] * STEP],
            ]
        )
    )
    return graph.minutes_from(np.array([na]), limit=np.inf)[0, nb]


def test_a_river_is_crossed_only_at_the_bridge():
    north = segment([(0, 2), (5, 2)], ["n0", "n5"])
    south = segment([(0, 0), (5, 0)], ["s0", "s5"])
    bridge = segment([(5, 2), (5, 0)], ["n5", "s5"])
    graph = build_graph(table([north, south, bridge]))
    walked = minutes_between(graph, (0, 2), (0, 0)) * METRES_PER_MIN
    straight = np.linalg.norm(
        np.subtract(*to_metres(np.array([LON, LON]), np.array([LAT + 2 * STEP, LAT])))
    )
    assert walked > 4 * straight


def test_the_shortest_of_two_parallel_paths_wins():
    direct = segment([(0, 0), (4, 0)], ["a", "b"])
    detour = segment([(0, 0), (2, 3), (4, 0)], ["a", "x", "b"])
    graph = build_graph(table([detour, direct]))
    walked = minutes_between(graph, (0, 0), (4, 0)) * METRES_PER_MIN
    assert walked == pytest.approx(4 * STEP * 1.5 * 111_320 * np.cos(np.radians(48.859)), rel=0.02)


def test_islands_are_dropped_so_points_snap_to_the_main_network():
    main = segment([(0, 0), (1, 0), (2, 0)], ["a", "b", "c"])
    courtyard = segment([(10, 10), (10.2, 10)], ["i", "j"])
    graph = build_graph(table([main, courtyard]))
    assert len(graph.xy) == 3


def test_motorways_and_the_peripherique_are_not_walkable():
    rows = [
        segment([(0, 0), (1, 0)], ["a", "b"], cls) for cls in ("footway", "motorway", "trunk", None)
    ]
    assert walkable(table(rows))["class"].to_pylist() == ["footway", None]
