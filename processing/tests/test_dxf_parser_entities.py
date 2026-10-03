"""
Coverage for the structured output of the DXF parser.

``extract_measurements`` and ``get_measurements_data`` walk the same entity
list but build different results: the first renders a human-readable string, the
second returns a dictionary of lists plus a bounding box. They therefore have
their own branches, and every entity type needs exercising in both.

Also covered here are the parsing edge cases that a well-formed drawing never
produces: blank lines, a dangling group code, non-numeric coordinates, and the
empty-file error path.
"""

import math

import pytest

from processing.parser.dxf_parser import (
    DXFStructureError,
    _get_float,
    _get_points_lwpolyline,
    get_measurements_data,
    parse_dxf,
)


def _dxf(body: str) -> bytes:
    """Wrap entity definitions in a minimal ENTITIES section."""
    return f"0\nSECTION\n2\nENTITIES\n{body}0\nENDSEC\n0\nEOF\n".encode()


ARC_DXF = _dxf("""0
ARC
8
0
10
2.0
20
3.0
40
5.0
50
0.0
51
90.0
""")

OPEN_LWPOLYLINE_DXF = _dxf("""0
LWPOLYLINE
8
0
70
0
10
0.0
20
0.0
10
10.0
20
0.0
10
10.0
20
10.0
""")

CLOSED_LWPOLYLINE_DXF = _dxf("""0
LWPOLYLINE
8
0
70
1
10
0.0
20
0.0
10
10.0
20
0.0
10
10.0
20
10.0
""")

POLYLINE_DXF = _dxf("""0
POLYLINE
8
0
10
0.0
20
0.0
10
4.0
20
3.0
""")


# --- get_measurements_data: entity types -----------------------------------


def test_get_measurements_data_arc():
    """An ARC lands in `arcs` and contributes to the bounding box."""
    data = get_measurements_data(ARC_DXF)

    assert data["arcs"] == [{"radius": 5.0, "center": (2.0, 3.0)}]
    assert data["lines"] == []
    assert data["circles"] == []
    assert data["polylines"] == []

    # The arc's four extreme points define a 10 x 10 box around (2, 3).
    assert data["bounding_box"] == {
        "width": 10.0,
        "height": 10.0,
        "min_x": -3.0,
        "max_x": 7.0,
        "min_y": -2.0,
        "max_y": 8.0,
    }


def test_get_measurements_data_arc_with_zero_radius_is_dropped():
    """A degenerate ARC has no geometry and must not reach `arcs`."""
    degenerate = _dxf("0\nARC\n8\n0\n10\n1.0\n20\n1.0\n40\n0.0\n50\n0.0\n51\n90.0\n")

    data = get_measurements_data(degenerate)

    assert data["arcs"] == []
    # No point was collected, so there is no bounding box to report.
    assert data["bounding_box"] is None


def test_get_measurements_data_open_lwpolyline():
    """An open LWPOLYLINE sums its edges only, with no closing segment."""
    data = get_measurements_data(OPEN_LWPOLYLINE_DXF)

    assert len(data["polylines"]) == 1
    polyline = data["polylines"][0]
    assert polyline["closed"] is False
    assert polyline["vertices"] == [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0)]
    # 10 + 10, with the diagonal back to the start deliberately excluded.
    assert polyline["length"] == pytest.approx(20.0)


def test_get_measurements_data_closed_lwpolyline_includes_closing_edge():
    """Flag bit 0 set adds the closing segment to the total length."""
    data = get_measurements_data(CLOSED_LWPOLYLINE_DXF)

    polyline = data["polylines"][0]
    assert polyline["closed"] is True
    expected = 10.0 + 10.0 + math.hypot(10.0, 10.0)
    assert polyline["length"] == pytest.approx(expected)


def test_get_measurements_data_polyline_has_no_closed_flag():
    """POLYLINE does not read group code 70, so it is always treated as open."""
    data = get_measurements_data(POLYLINE_DXF)

    polyline = data["polylines"][0]
    assert polyline["closed"] is False
    assert polyline["vertices"] == [(0.0, 0.0), (4.0, 3.0)]
    assert polyline["length"] == pytest.approx(5.0)


def test_get_measurements_data_lwpolyline_needs_two_vertices():
    """A single-vertex polyline cannot have a length, so it is discarded."""
    single = _dxf("0\nLWPOLYLINE\n8\n0\n10\n1.0\n20\n2.0\n")

    data = get_measurements_data(single)

    assert data["polylines"] == []
    assert data["bounding_box"] is None


def test_get_measurements_data_combines_every_entity_type():
    """Lines, circles, arcs and polylines share one bounding box."""
    data = get_measurements_data(_dxf("""0
LINE
8
0
10
0.0
20
0.0
11
4.0
21
0.0
0
CIRCLE
8
0
10
2.0
20
2.0
40
1.0
0
ARC
8
0
10
2.0
20
2.0
40
1.0
50
0.0
51
90.0
0
LWPOLYLINE
8
0
70
0
10
0.0
20
0.0
10
4.0
20
0.0
"""))

    assert len(data["lines"]) == 1
    assert data["lines"][0]["length"] == pytest.approx(4.0)
    assert len(data["circles"]) == 1
    assert len(data["arcs"]) == 1
    assert len(data["polylines"]) == 1

    box = data["bounding_box"]
    assert box["min_x"] == 0.0
    assert box["max_x"] == 4.0
    assert box["min_y"] == 0.0
    assert box["max_y"] == 3.0
    assert box["width"] == 4.0
    assert box["height"] == 3.0


def test_get_measurements_data_returns_an_error_key_for_an_empty_file():
    """A parse failure is reported in the result, not raised."""
    data = get_measurements_data(b"")

    assert data["error"] == "File is empty"
    assert data["lines"] == []
    assert data["circles"] == []
    assert data["polylines"] == []
    assert data["arcs"] == []
    assert data["bounding_box"] is None


def test_get_measurements_data_empty_entities_section():
    """A well-formed file with no entities has no error but no geometry."""
    data = get_measurements_data(b"0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n")

    assert "error" not in data
    assert data["bounding_box"] is None


# --- _get_float -------------------------------------------------------------


def test_get_float_returns_the_value_at_the_index():
    assert _get_float({10: ["1.5", "2.5"]}, 10) == 1.5
    assert _get_float({10: ["1.5", "2.5"]}, 10, 1) == 2.5


def test_get_float_returns_zero_for_a_missing_code():
    assert _get_float({}, 10) == 0.0


def test_get_float_returns_zero_for_an_index_past_the_end():
    """Asking for a second vertex of a single-valued code yields 0.0."""
    assert _get_float({10: ["1.5"]}, 10, 3) == 0.0


def test_get_float_returns_zero_for_a_non_numeric_value():
    """Unparseable coordinates degrade to 0.0 instead of raising."""
    assert _get_float({10: ["not-a-number"]}, 10) == 0.0
    assert _get_float({10: [None]}, 10) == 0.0


# --- _get_points_lwpolyline -------------------------------------------------


def test_get_points_lwpolyline_pairs_coordinates():
    assert _get_points_lwpolyline({10: ["0.0", "1.0"], 20: ["2.0", "3.0"]}) == [(0.0, 2.0), (1.0, 3.0)]


def test_get_points_lwpolyline_skips_unparseable_vertices():
    """A bad vertex is dropped; the rest of the polyline survives."""
    points = _get_points_lwpolyline({10: ["0.0", "bad", "2.0"], 20: ["0.0", "1.0", "2.0"]})

    # The index alignment is preserved by the min() bound, so only the pair
    # that actually parses is returned.
    assert points == [(0.0, 0.0), (2.0, 2.0)]


def test_get_points_lwpolyline_truncates_to_the_shorter_list():
    """Missing Y coordinates stop the walk rather than raising."""
    assert _get_points_lwpolyline({10: ["0.0", "1.0", "2.0"], 20: ["0.0"]}) == [(0.0, 0.0)]


def test_get_points_lwpolyline_without_coordinates():
    assert _get_points_lwpolyline({}) == []


# --- parse_dxf: malformed input --------------------------------------------


def test_parse_dxf_ignores_blank_lines_and_non_numeric_codes():
    """Blank lines and stray text are skipped without derailing the walk."""
    entities = parse_dxf(b"0\nSECTION\n\n2\nENTITIES\ngarbage\n0\nLINE\n10\n0.0\n20\n0.0\n0\nENDSEC\n0\nEOF\n")

    assert len(entities) == 1
    assert entities[0]["type"] == "LINE"


def test_parse_dxf_stops_at_a_dangling_group_code():
    """A group code with no value line ends the parse instead of indexing past the end.

    The `break` happens before the value is consumed, so the dangling code is
    dropped rather than stored with an empty value.
    """
    entities = parse_dxf(b"0\nSECTION\n2\nENTITIES\n0\nLINE\n10")

    assert entities == [{"type": "LINE"}]


def test_parse_dxf_raises_on_empty_input():
    with pytest.raises(DXFStructureError, match="File is empty"):
        parse_dxf(b"")


def test_parse_dxf_ignores_values_before_the_entities_section():
    """Header-section pairs must not be collected as entities."""
    entities = parse_dxf(b"0\nHEADER\n9\n$ACADVER\n1\nAC1021\n0\nENDSEC\n0\nEOF\n")

    assert entities == []


def test_parse_dxf_keeps_repeated_group_codes_as_lists():
    """Every value lands in a list so LWPOLYLINE vertices are not lost."""
    entities = parse_dxf(OPEN_LWPOLYLINE_DXF)

    assert entities[0][10] == ["0.0", "10.0", "10.0"]
    assert entities[0][20] == ["0.0", "0.0", "10.0"]
