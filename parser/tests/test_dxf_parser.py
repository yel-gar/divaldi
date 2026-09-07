# tests/test_dxf_parser.py
import sys
import pytest
from pathlib import Path
import math

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from dxf_parser import parse_dxf, extract_measurements, get_measurements_data, DXFParserError


@pytest.fixture
def simple_dxf_content():
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
    dxf_file = tmp_path / "test.dxf"
    dxf_file.write_text(simple_dxf_content, encoding='utf-8')
    return str(dxf_file)


def test_parse_dxf_simple(simple_dxf_file_path):
    entities = parse_dxf(simple_dxf_file_path)
    assert len(entities) == 2

    line = entities[0]
    assert line.get('type') == 'LINE'
    assert float(line.get(10)) == 0.0
    assert float(line.get(20)) == 0.0
    assert float(line.get(11)) == 10.0
    assert float(line.get(21)) == 0.0

    circle = entities[1]
    assert circle.get('type') == 'CIRCLE'
    assert float(circle.get(10)) == 5.0
    assert float(circle.get(20)) == 5.0
    assert float(circle.get(40)) == 2.0


def test_parse_dxf_empty_entities(tmp_path):
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
    dxf_file.write_text(content, encoding='utf-8')
    entities = parse_dxf(str(dxf_file))
    assert entities == []


def test_extract_measurements_simple(simple_dxf_file_path):
    result = extract_measurements(simple_dxf_file_path)
    lines = result.split('\n')

    assert len(lines) >= 4

    result_text = '\n'.join(lines)
    assert "Line 1: length = 10.000" in result_text
    assert "Circle 1: radius = 2.000" in result_text
    assert "Bounding box: width = 10.000, height = 5.000" in result_text
    assert "X range: [0.000, 10.000], Y range: [0.000, 5.000]" in result_text


def test_extract_measurements_no_entities(tmp_path):
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
    dxf_file.write_text(content, encoding='utf-8')
    result = extract_measurements(str(dxf_file))
    assert result == "No measurements found."


def test_get_measurements_data_simple(simple_dxf_file_path):
    data = get_measurements_data(simple_dxf_file_path)
    assert isinstance(data, dict)
    assert 'lines' in data
    assert 'circles' in data
    assert 'bounding_box' in data

    assert len(data['lines']) == 1
    line = data['lines'][0]
    assert math.isclose(line['length'], 10.0)
    assert line['start'] == (0.0, 0.0)
    assert line['end'] == (10.0, 0.0)

    assert len(data['circles']) == 1
    circle = data['circles'][0]
    assert math.isclose(circle['radius'], 2.0)
    assert circle['center'] == (5.0, 5.0)

    bb = data['bounding_box']
    assert math.isclose(bb['width'], 10.0)
    assert math.isclose(bb['height'], 5.0)
    assert bb['min_x'] == 0.0
    assert bb['max_x'] == 10.0
    assert bb['min_y'] == 0.0
    assert bb['max_y'] == 5.0


def test_extract_measurements_file_not_found():
    result = extract_measurements("non_existent_file.dxf")
    assert result.startswith("Ошибка при парсинге файла:")


def test_extract_measurements_empty_file(tmp_path):
    dxf_file = tmp_path / "empty.dxf"
    dxf_file.write_text("", encoding='utf-8')
    result = extract_measurements(str(dxf_file))
    assert result.startswith("Ошибка при парсинге файла:")


@pytest.mark.skip(reason="Requires data/test.dxf file")
def test_with_real_dxf_file():
    path = Path("data/test.dxf")
    if not path.exists():
        pytest.skip("No test.dxf file in data/ folder")
    result = extract_measurements(str(path))
    assert "Line" in result or "Circle" in result