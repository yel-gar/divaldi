"""
Tests for dxf_parser module.
"""

import math
import sys
from pathlib import Path

import pytest

# Add src to Python path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from dxf_parser import extract_measurements, get_measurements_data, parse_dxf


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
    assert float(line.get(10)) == 0.0
    assert float(line.get(20)) == 0.0
    assert float(line.get(11)) == 10.0
    assert float(line.get(21)) == 0.0

    circle = entities[1]
    assert circle.get("type") == "CIRCLE"
    assert float(circle.get(10)) == 5.0
    assert float(circle.get(20)) == 5.0
    assert float(circle.get(40)) == 2.0


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
    # Expect error message starting with "Error parsing file:"
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
