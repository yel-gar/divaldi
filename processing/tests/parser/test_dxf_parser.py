"""
Tests for dxf_parser module.
"""

import math
from pathlib import Path

import pytest

from processing.parser.dxf_parser import (
    extract_measurements,
    get_measurements_data,
    parse_dxf,
)


@pytest.fixture
def simple_dxf_content():
    """Fixture with simple DXF content (line and circle)."""
    return """0
SECTION
2
ENTITIES
0
LINE
10
0.0
20
0.0
11
10.0
21
0.0
0
CIRCLE
10
5.0
20
5.0
40
2.0
0
ENDSEC
0
EOF
"""


@pytest.fixture
def simple_dxf_file_path(simple_dxf_content, tmp_path):
    """Create a temporary DXF file and return its path."""
    dxf_file = tmp_path / "test.dxf"
    dxf_file.write_text(simple_dxf_content, encoding="utf-8")
    return str(dxf_file)


def test_parse_dxf_simple(simple_dxf_file_path):
    """Test parsing a simple DXF file."""
    with open(simple_dxf_file_path, "rb") as f:
        dxf_bytes = f.read()
    entities = parse_dxf(dxf_bytes)
    assert len(entities) == 2

    line = entities[0]
    assert line.get("type") == "LINE"
    assert float(line.get(10)[0]) == 0.0
    assert float(line.get(20)[0]) == 0.0
    assert float(line.get(11)[0]) == 10.0
    assert float(line.get(21)[0]) == 0.0

    circle = entities[1]
    assert circle.get("type") == "CIRCLE"
    assert float(circle.get(10)[0]) == 5.0
    assert float(circle.get(20)[0]) == 5.0
    assert float(circle.get(40)[0]) == 2.0


def test_parse_dxf_empty_entities(tmp_path):
    """Test that an empty ENTITIES section returns an empty list."""
    content = """0
SECTION
2
ENTITIES
0
ENDSEC
0
EOF
"""
    dxf_file = tmp_path / "empty.dxf"
    dxf_file.write_text(content, encoding="utf-8")
    with open(dxf_file, "rb") as f:
        dxf_bytes = f.read()
    entities = parse_dxf(dxf_bytes)
    assert entities == []


def test_extract_measurements_simple(simple_dxf_file_path):
    """Test extracting measurements from a simple DXF."""
    with open(simple_dxf_file_path, "rb") as f:
        dxf_bytes = f.read()
    result = extract_measurements(dxf_bytes)
    lines = result.split("\n")

    assert len(lines) >= 4

    result_text = "\n".join(lines)
    assert "Line 1: length = 10.000" in result_text
    assert "Circle 1: radius = 2.000" in result_text
    assert "Bounding box: width = 10.000, height = 7.000" in result_text
    assert "X range: [0.000, 10.000], Y range: [0.000, 7.000]" in result_text


def test_extract_measurements_no_entities(tmp_path):
    """Test that an empty ENTITIES section returns 'No measurements found.'"""
    content = """0
SECTION
2
ENTITIES
0
ENDSEC
0
EOF
"""
    dxf_file = tmp_path / "empty.dxf"
    dxf_file.write_text(content, encoding="utf-8")
    with open(dxf_file, "rb") as f:
        dxf_bytes = f.read()
    result = extract_measurements(dxf_bytes)
    assert result == "No measurements found."


def test_get_measurements_data_simple(simple_dxf_file_path):
    """Test getting structured measurements data."""
    with open(simple_dxf_file_path, "rb") as f:
        dxf_bytes = f.read()
    data = get_measurements_data(dxf_bytes)
    assert isinstance(data, dict)
    assert "lines" in data
    assert "circles" in data
    assert "bounding_box" in data

    assert len(data["lines"]) == 1
    line = data["lines"][0]
    assert math.isclose(line["length"], 10.0)
    assert line["start"] == (0.0, 0.0)
    assert line["end"] == (10.0, 0.0)

    assert len(data["circles"]) == 1
    circle = data["circles"][0]
    assert math.isclose(circle["radius"], 2.0)
    assert circle["center"] == (5.0, 5.0)

    bb = data["bounding_box"]
    assert math.isclose(bb["width"], 10.0)
    assert math.isclose(bb["height"], 7.0)
    assert bb["min_x"] == 0.0
    assert bb["max_x"] == 10.0
    assert bb["min_y"] == 0.0
    assert bb["max_y"] == 7.0


def test_extract_measurements_empty_file(tmp_path):
    """Test reaction to an empty file (empty bytes)."""
    dxf_file = tmp_path / "empty.dxf"
    dxf_file.write_text("", encoding="utf-8")
    with open(dxf_file, "rb") as f:
        dxf_bytes = f.read()
    result = extract_measurements(dxf_bytes)
    assert result.startswith("Error parsing file:")


def test_with_real_dxf_file():
    """Integration test with a real DXF file (if available)."""
    path = Path(__file__).parent / "data" / "test.dxf"
    if not path.exists():
        pytest.skip("No test.dxf file in tests/data/ folder")
    with open(path, "rb") as f:
        dxf_bytes = f.read()
    result = extract_measurements(dxf_bytes)
    assert "Line" in result or "Circle" in result


def test_parse_dxf_lwpolyline_simple(tmp_path):
    """Test parsing a simple LWPOLYLINE with multiple vertices."""
    content = """0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
0
100
AcDbPolyline
90
3
70
0
10
0.0
20
0.0
10
5.0
20
5.0
10
10.0
20
0.0
0
ENDSEC
0
EOF
"""
    dxf_file = tmp_path / "polyline.dxf"
    dxf_file.write_text(content, encoding="utf-8")
    with open(dxf_file, "rb") as f:
        dxf_bytes = f.read()

    entities = parse_dxf(dxf_bytes)
    assert len(entities) == 1
    ent = entities[0]
    assert ent["type"] == "LWPOLYLINE"
    xs = ent.get(10, [])
    ys = ent.get(20, [])
    assert len(xs) == 3
    assert len(ys) == 3
    assert float(xs[0]) == 0.0
    assert float(ys[0]) == 0.0
    assert float(xs[1]) == 5.0
    assert float(ys[1]) == 5.0
    assert float(xs[2]) == 10.0
    assert float(ys[2]) == 0.0
    flags = ent.get(70, ["0"])
    assert int(flags[0]) == 0


def test_extract_measurements_lwpolyline(tmp_path):
    """Test extracting measurements from open and closed LWPOLYLINE."""
    content_open = """0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
0
100
AcDbPolyline
90
3
70
0
10
0.0
20
0.0
10
3.0
20
4.0
10
6.0
20
0.0
0
ENDSEC
0
EOF
"""
    dxf_file = tmp_path / "polyline_open.dxf"
    dxf_file.write_text(content_open, encoding="utf-8")
    with open(dxf_file, "rb") as f:
        dxf_bytes = f.read()
    result = extract_measurements(dxf_bytes)
    assert "Polyline 1: length = 10.000, open, vertices = 3" in result
    assert "Bounding box: width = 6.000, height = 4.000" in result

    content_closed = """0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
0
100
AcDbPolyline
90
4
70
1
10
0.0
20
0.0
10
5.0
20
0.0
10
5.0
20
5.0
10
0.0
20
5.0
0
ENDSEC
0
EOF
"""
    dxf_file = tmp_path / "polyline_closed.dxf"
    dxf_file.write_text(content_closed, encoding="utf-8")
    with open(dxf_file, "rb") as f:
        dxf_bytes = f.read()
    result = extract_measurements(dxf_bytes)
    assert "Polyline 1: length = 20.000, closed, vertices = 4" in result
    assert "Bounding box: width = 5.000, height = 5.000" in result


def test_extract_measurements_arc(tmp_path):
    """Test extracting measurements from an ARC entity."""
    content = """0
SECTION
2
ENTITIES
0
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
0
ENDSEC
0
EOF
"""
    dxf_file = tmp_path / "arc.dxf"
    dxf_file.write_text(content, encoding="utf-8")
    with open(dxf_file, "rb") as f:
        dxf_bytes = f.read()
    result = extract_measurements(dxf_bytes)
    assert "Arc 1: radius = 5.000, center = (2.0, 3.0)" in result
    assert "Bounding box: width = 10.000, height = 10.000" in result
    assert "X range: [-3.000, 7.000], Y range: [-2.000, 8.000]" in result


def test_extract_measurements_mixed(tmp_path):
    """Test a mix of LINE, CIRCLE, ARC, and LWPOLYLINE."""
    content = """0
SECTION
2
ENTITIES
0
LINE
10
0.0
20
0.0
11
10.0
21
0.0
0
CIRCLE
10
5.0
20
5.0
40
2.0
0
ARC
10
1.0
20
1.0
40
3.0
50
0.0
51
180.0
0
LWPOLYLINE
8
0
100
AcDbPolyline
90
3
70
0
10
0.0
20
0.0
10
4.0
20
3.0
10
8.0
20
0.0
0
ENDSEC
0
EOF
"""
    dxf_file = tmp_path / "mixed.dxf"
    dxf_file.write_text(content, encoding="utf-8")
    with open(dxf_file, "rb") as f:
        dxf_bytes = f.read()
    result = extract_measurements(dxf_bytes)
    assert "Line 1: length = 10.000" in result
    assert "Circle 1: radius = 2.000" in result
    assert "Arc 1: radius = 3.000, center = (1.0, 1.0)" in result
    assert (
        "Polyline 1: length = 10.000, open, vertices = 3" in result
    )  # distances: 5+5=10
    # Bounding box
    assert "Bounding box: width = 12.000, height = 9.000" in result
    assert "X range: [-2.000, 10.000], Y range: [-2.000, 7.000]" in result


def test_parse_dxf_repeated_codes(tmp_path):
    """Test that repeated group codes are stored as lists."""
    content = """0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
0
100
AcDbPolyline
90
3
70
0
10
1.0
20
2.0
10
3.0
20
4.0
10
5.0
20
6.0
0
ENDSEC
0
EOF
"""
    dxf_file = tmp_path / "repeated.dxf"
    dxf_file.write_text(content, encoding="utf-8")
    with open(dxf_file, "rb") as f:
        dxf_bytes = f.read()
    entities = parse_dxf(dxf_bytes)
    ent = entities[0]
    assert ent["type"] == "LWPOLYLINE"
    xs = ent.get(10, [])
    ys = ent.get(20, [])
    assert len(xs) == 3
    assert len(ys) == 3
    assert float(xs[0]) == 1.0
    assert float(ys[0]) == 2.0
    assert float(xs[1]) == 3.0
    assert float(ys[1]) == 4.0
    assert float(xs[2]) == 5.0
    assert float(ys[2]) == 6.0


def test_get_measurements_data_error_handling():
    """Test that get_measurements_data handles bad input gracefully."""
    invalid_bytes = b"not a dxf"
    data = get_measurements_data(invalid_bytes)
    assert data.get("lines") == []
    assert data.get("circles") == []
    assert data.get("polylines") == []
    assert data.get("arcs") == []
    assert data.get("bounding_box") is None


def test_get_measurements_data_simple_with_polyline(simple_dxf_file_path):
    """Test structured data with existing simple DXF."""
    with open(simple_dxf_file_path, "rb") as f:
        dxf_bytes = f.read()
    data = get_measurements_data(dxf_bytes)
    assert "polylines" in data
    assert "arcs" in data
    assert len(data["polylines"]) == 0
    assert len(data["arcs"]) == 0
