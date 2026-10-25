from shapely.geometry import box

from adresse_pipeline import idfm, network

LINES = [
    {
        "id_line": "C01371",
        "shortname_line": "1",
        "transportmode": "metro",
        "colourweb_hexa": "ffcd00",
        "textcolourweb_hexa": "000000",
    },
    {
        "id_line": "C01742",
        "shortname_line": "A",
        "transportmode": "rail",
        "colourweb_hexa": "e3051c",
        "textcolourweb_hexa": "ffffff",
    },
    {
        "id_line": "C01739",
        "shortname_line": "H",
        "transportmode": "rail",
        "colourweb_hexa": "8d5e2a",
        "textcolourweb_hexa": "ffffff",
    },
    {
        "id_line": "C01389",
        "shortname_line": "T3a",
        "transportmode": "tram",
        "colourweb_hexa": "ff7f4f",
        "textcolourweb_hexa": "000000",
    },
]


def test_only_metro_and_rer_lines_keep_their_colours():
    lines = network.line_colours(LINES)
    assert {(x.mode, x.name, x.colour) for x in lines.values()} == {
        ("metro", "1", "#FFCD00"),
        ("rer", "A", "#E3051C"),
    }


def test_traces_join_the_reference_and_are_cut_to_paris():
    lines = network.line_colours(LINES)
    features = [
        {
            "properties": {"idrefligc": "C01371"},
            "geometry": {"type": "LineString", "coordinates": [[2.30, 48.87], [2.40, 48.85]]},
        },
        {
            "properties": {"idrefligc": "C01389"},
            "geometry": {"type": "LineString", "coordinates": [[2.30, 48.83], [2.40, 48.83]]},
        },
        {
            "properties": {"idrefligc": "C01742"},
            "geometry": {"type": "LineString", "coordinates": [[2.00, 48.90], [2.10, 48.90]]},
        },
    ]
    branches = network.traces(features, lines, box(2.2, 48.8, 2.5, 48.92))
    assert [line.name for line, _ in branches] == ["1"]
    out = network.to_geojson(branches)
    assert out["features"][0]["properties"] == {
        "mode": "metro",
        "line": "1",
        "colour": "#FFCD00",
        "text": "#000000",
    }


def test_stations_name_their_metro_and_rer_lines():
    assert idfm.line_name({"mode": "METRO", "indice_lig": "3bis"}) == "3bis"
    assert idfm.line_name({"mode": "RER", "indice_lig": "B"}) == "RER B"
    assert idfm.line_name({"mode": "TRAMWAY", "indice_lig": "T3a"}) == ""
    assert idfm.line_name({}) == ""
