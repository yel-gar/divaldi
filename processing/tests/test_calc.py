"""
Tests for calc module (Excel template filler).

The module under test operates on in-memory data:
- input payload is a parsed ``dict`` (not a JSON string);
- the template is passed as ``bytes`` and the result is returned as ``bytes``.

Material prices in tests are passed explicitly via the ``material_prices``
argument (loaded from ``tests/data/test_prices.json``). This decouples the
test suite from the contents of the production ``calc.xlsx`` and makes tests
robust against openpyxl round-trips (which drop cached formula values).
"""

import io
import json
import math
from pathlib import Path

import pytest
from openpyxl import load_workbook

from processing.calculator.calc import (
    COL_AREA,
    COL_HOURS,
    COL_MATERIAL,
    COL_PRICE_PER_M2,
    DEFAULT_PARAMETERS,
    FIRST_POSITION_ROW,
    POSITION_BLOCK_HEIGHT,
    ROW_BENDING,
    ROW_LASER,
    ROW_PAINTING,
    ROW_TURNING,
    ROW_WELDING,
    SHEET_CALC,
    Parameters,
    _load_material_prices,
    process_calculation,
)

DATA_DIR = Path(__file__).resolve().parent / "data"
TEMPLATE_PATH = DATA_DIR / "calc.xlsx"
PRICES_PATH = DATA_DIR / "test_prices.json"


@pytest.fixture(scope="session")
def template_bytes() -> bytes:
    """Load the production Excel template from the package resources."""
    if not TEMPLATE_PATH.exists():
        pytest.fail(f"Template not found: {TEMPLATE_PATH}")
    return TEMPLATE_PATH.read_bytes()


@pytest.fixture(scope="session")
def material_prices() -> dict[str, float]:
    """Load test-only material prices (decoupled from calc.xlsx)."""
    if not PRICES_PATH.exists():
        pytest.fail(f"Test prices not found: {PRICES_PATH}")
    return json.loads(PRICES_PATH.read_text(encoding="utf-8"))


@pytest.fixture
def calc(template_bytes, material_prices):
    """
    Thin wrapper around ``process_calculation`` that injects test prices.

    All tests below use this wrapper instead of calling ``process_calculation``
    directly, so that the suite does not depend on formula caches inside the
    xlsx template.
    """

    def _call(data, template=None, params=None):
        return process_calculation(
            data,
            template if template is not None else template_bytes,
            params,
            material_prices=material_prices,
        )

    return _call


@pytest.fixture
def sample_data_single() -> dict:
    """Valid payload with a single position."""
    return {
        "positions": [
            {
                "name": "Bracket support",
                "material": "1,5 мм Оц. Сталь (2500х1250)",
                "area_m2": 0.8,
                "laser_m": 2.5,
                "bends": 12,
                "welding_m": 0.5,
                "turning_hours": 0.0,
                "painting_m2": 0.8,
            }
        ]
    }


@pytest.fixture
def sample_data_multiple() -> dict:
    """Valid payload with 3 positions."""
    return {
        "positions": [
            {
                "name": "Part A",
                "material": "1,5 мм Оц. Сталь (2500х1250)",
                "area_m2": 0.8,
                "laser_m": 2.5,
                "bends": 12,
                "welding_m": 0.5,
                "turning_hours": 0.0,
                "painting_m2": 0.8,
            },
            {
                "name": "Part B",
                "material": "2,0 мм Оц. Сталь (2500х1250)",
                "area_m2": 1.2,
                "laser_m": 3.0,
                "bends": 8,
                "welding_m": 0.0,
                "turning_hours": 0.5,
                "painting_m2": 0.0,
            },
            {
                "name": "Part C",
                "material": "3,0 мм Ст3 (3000х1500)",
                "area_m2": 2.0,
                "laser_m": 4.0,
                "bends": 0,
                "welding_m": 1.0,
                "turning_hours": 0.0,
                "painting_m2": 1.5,
            },
        ]
    }


# ===== Helpers =====


def _open_calc_sheet(result_bytes: bytes):
    """Helper to open the resulting workbook and return the calc sheet."""
    wb = load_workbook(io.BytesIO(result_bytes))
    return wb, wb[SHEET_CALC]


def _base_row(block_index: int) -> int:
    """Return the first row of the given position block."""
    return FIRST_POSITION_ROW + block_index * POSITION_BLOCK_HEIGHT


def test_prices_fixture_covers_known_materials(material_prices):
    """The test prices cover every material used by the sample fixtures."""
    known = [
        "1,5 мм Оц. Сталь (2500х1250)",
        "2,0 мм Оц. Сталь (2500х1250)",
        "3,0 мм Ст3 (3000х1500)",
    ]
    for material in known:
        assert material in material_prices, f"Material '{material}' missing from test_prices.json"
        assert material_prices[material] > 0


def test_process_calculation_success(calc, sample_data_single):
    """A single valid position is written into the first block."""
    result = calc(sample_data_single)

    assert isinstance(result, bytes)
    assert len(result) > 0
    assert result[:2] == b"PK"

    wb, sheet = _open_calc_sheet(result)
    base = _base_row(0)

    assert sheet.cell(row=base + ROW_LASER, column=COL_MATERIAL).value == ("1,5 мм Оц. Сталь (2500х1250)")
    assert sheet.cell(row=base + ROW_LASER, column=COL_AREA).value == 0.8
    price = sheet.cell(row=base + ROW_LASER, column=COL_PRICE_PER_M2).value
    assert price is not None and price > 0

    assert sheet.cell(row=base + ROW_LASER, column=COL_HOURS).value == pytest.approx(0.25)
    assert sheet.cell(row=base + ROW_BENDING, column=COL_HOURS).value == pytest.approx(12 / 84)
    assert sheet.cell(row=base + ROW_TURNING, column=COL_HOURS).value == 0.0
    assert sheet.cell(row=base + ROW_WELDING, column=COL_HOURS).value == pytest.approx(0.25)
    assert sheet.cell(row=base + ROW_PAINTING, column=COL_AREA).value == 0.8

    assert "КП с ндс" in wb.sheetnames


def test_process_calculation_multiple_positions(calc, sample_data_multiple):
    """Three positions fill the first three blocks; the fourth is untouched."""
    result = calc(sample_data_multiple)
    _, sheet = _open_calc_sheet(result)

    assert sheet.cell(row=_base_row(0) + ROW_LASER, column=COL_MATERIAL).value == "1,5 мм Оц. Сталь (2500х1250)"
    assert sheet.cell(row=_base_row(1) + ROW_LASER, column=COL_MATERIAL).value == "2,0 мм Оц. Сталь (2500х1250)"
    assert sheet.cell(row=_base_row(2) + ROW_LASER, column=COL_MATERIAL).value == "3,0 мм Ст3 (3000х1500)"

    assert sheet.cell(row=_base_row(3) + ROW_LASER, column=COL_MATERIAL).value is None
    assert sheet.cell(row=_base_row(3) + ROW_LASER, column=COL_AREA).value is None


def test_process_calculation_clears_old_data(calc, template_bytes, sample_data_single):
    """
    Old data from the template is cleared before writing new data.

    Note: prices are injected via the ``calc`` wrapper, so the fact that
    openpyxl drops cached formula values on save does not affect this test.
    """
    wb = load_workbook(io.BytesIO(template_bytes))
    sheet = wb[SHEET_CALC]
    stale_base = _base_row(1)
    sheet.cell(row=stale_base + ROW_LASER, column=COL_MATERIAL).value = "STALE"
    sheet.cell(row=stale_base + ROW_LASER, column=COL_AREA).value = 999.9
    stale_buf = io.BytesIO()
    wb.save(stale_buf)
    stale_template = stale_buf.getvalue()

    result = calc(sample_data_single, template=stale_template)
    _, out_sheet = _open_calc_sheet(result)

    assert out_sheet.cell(row=_base_row(0) + ROW_LASER, column=COL_MATERIAL).value == "1,5 мм Оц. Сталь (2500х1250)"
    assert out_sheet.cell(row=_base_row(1) + ROW_LASER, column=COL_MATERIAL).value is None
    assert out_sheet.cell(row=_base_row(1) + ROW_LASER, column=COL_AREA).value is None


def test_process_calculation_custom_parameters(calc, sample_data_single):
    """A custom Parameters instance is respected by the calculation."""
    params = Parameters(laser_speed_m_per_hour=5.0)
    result = calc(sample_data_single, params=params)
    _, sheet = _open_calc_sheet(result)

    assert sheet.cell(row=_base_row(0) + ROW_LASER, column=COL_HOURS).value == pytest.approx(0.5)


def test_process_calculation_uses_default_parameters(calc, sample_data_single):
    """When parameters are omitted, DEFAULT_PARAMETERS is used."""
    assert DEFAULT_PARAMETERS.laser_speed_m_per_hour > 0
    assert DEFAULT_PARAMETERS.welding_speed_m_per_hour > 0
    assert DEFAULT_PARAMETERS.bending_rate_per_hour > 0
    assert DEFAULT_PARAMETERS.painting_rate_m2_per_hour > 0
    assert DEFAULT_PARAMETERS.max_positions >= 1

    result = calc(sample_data_single)
    _, sheet = _open_calc_sheet(result)
    assert sheet.cell(row=_base_row(0) + ROW_LASER, column=COL_HOURS).value == pytest.approx(0.25)


def test_process_calculation_data_not_dict(calc):
    with pytest.raises(ValueError, match="'data' must be a dict"):
        calc(["not", "a", "dict"])


def test_process_calculation_missing_positions(calc):
    with pytest.raises(ValueError, match="'positions' list"):
        calc({"other": "data"})


def test_process_calculation_positions_not_list(calc):
    with pytest.raises(ValueError, match="'positions' list"):
        calc({"positions": "not a list"})


def test_process_calculation_empty_positions(calc):
    with pytest.raises(ValueError, match="'positions' is empty"):
        calc({"positions": []})


def test_process_calculation_positions_items_not_dicts(calc):
    with pytest.raises(ValueError, match="list of objects"):
        calc({"positions": ["not a dict"]})


def test_process_calculation_too_many_positions(calc):
    pos = {
        "name": "Part",
        "material": "1,5 мм Оц. Сталь (2500х1250)",
        "area_m2": 0.8,
        "laser_m": 2.5,
        "bends": 12,
        "welding_m": 0.5,
        "turning_hours": 0.0,
        "painting_m2": 0.8,
    }
    data = {"positions": [pos] * 11}
    with pytest.raises(ValueError, match="only 10 are supported"):
        calc(data)


def test_process_calculation_missing_field(calc):
    data = {
        "positions": [
            {
                "name": "Missing field",
                "material": "1,5 мм Оц. Сталь (2500х1250)",
                "area_m2": 0.8,
                "laser_m": 2.5,
                "bends": 12,
                # welding_m
                "turning_hours": 0.0,
                "painting_m2": 0.8,
            }
        ]
    }
    with pytest.raises(ValueError, match="missing required field: welding_m"):
        calc(data)


def test_process_calculation_unknown_material(calc):
    data = {
        "positions": [
            {
                "name": "Unknown",
                "material": "Non-existent material",
                "area_m2": 1.0,
                "laser_m": 1.0,
                "bends": 0,
                "welding_m": 0.0,
                "turning_hours": 0.0,
                "painting_m2": 0.0,
            }
        ]
    }
    with pytest.raises(ValueError, match="unknown material"):
        calc(data)


def test_process_calculation_material_not_string(calc):
    data = {
        "positions": [
            {
                "name": "Bad material",
                "material": 123,
                "area_m2": 1.0,
                "laser_m": 1.0,
                "bends": 0,
                "welding_m": 0.0,
                "turning_hours": 0.0,
                "painting_m2": 0.0,
            }
        ]
    }
    with pytest.raises(ValueError, match="'material' must be a string"):
        calc(data)


def test_process_calculation_invalid_number(calc):
    data = {
        "positions": [
            {
                "name": "Invalid",
                "material": "1,5 мм Оц. Сталь (2500х1250)",
                "area_m2": "not a number",
                "laser_m": 2.5,
                "bends": 12,
                "welding_m": 0.5,
                "turning_hours": 0.0,
                "painting_m2": 0.8,
            }
        ]
    }
    with pytest.raises(ValueError, match="must be a real number"):
        calc(data)


def test_process_calculation_boolean_value(calc):
    data = {
        "positions": [
            {
                "name": "Boolean bends",
                "material": "1,5 мм Оц. Сталь (2500х1250)",
                "area_m2": 0.8,
                "laser_m": 2.5,
                "bends": True,
                "welding_m": 0.5,
                "turning_hours": 0.0,
                "painting_m2": 0.8,
            }
        ]
    }
    with pytest.raises(ValueError, match="must be a real number"):
        calc(data)


def test_process_calculation_negative_value(calc):
    data = {
        "positions": [
            {
                "name": "Negative area",
                "material": "1,5 мм Оц. Сталь (2500х1250)",
                "area_m2": -0.8,
                "laser_m": 2.5,
                "bends": 12,
                "welding_m": 0.5,
                "turning_hours": 0.0,
                "painting_m2": 0.8,
            }
        ]
    }
    with pytest.raises(ValueError, match="finite number >= 0"):
        calc(data)


def test_process_calculation_nan_value(calc):
    data = {
        "positions": [
            {
                "name": "NaN area",
                "material": "1,5 мм Оц. Сталь (2500х1250)",
                "area_m2": math.nan,
                "laser_m": 2.5,
                "bends": 12,
                "welding_m": 0.5,
                "turning_hours": 0.0,
                "painting_m2": 0.8,
            }
        ]
    }
    with pytest.raises(ValueError, match="finite number >= 0"):
        calc(data)


def test_process_calculation_infinity_value(calc):
    data = {
        "positions": [
            {
                "name": "Inf area",
                "material": "1,5 мм Оц. Сталь (2500х1250)",
                "area_m2": math.inf,
                "laser_m": 2.5,
                "bends": 12,
                "welding_m": 0.5,
                "turning_hours": 0.0,
                "painting_m2": 0.8,
            }
        ]
    }
    with pytest.raises(ValueError, match="finite number >= 0"):
        calc(data)


def test_load_material_prices(template_bytes):
    """
    Known materials must be present with a positive price.

    This exercises the *production* code path: prices are read from the
    real ``calc.xlsx`` (which must retain cached formula values because it
    was last saved by Excel).
    """
    prices = _load_material_prices(template_bytes)
    assert isinstance(prices, dict)
    known = [
        "1,5 мм Оц. Сталь (2500х1250)",
        "2,0 мм Оц. Сталь (2500х1250)",
        "3,0 мм Ст3 (3000х1500)",
    ]
    for material in known:
        assert material in prices, f"Material '{material}' not found"
        assert prices[material] > 0, f"Material '{material}' has non-positive price"


def test_load_material_prices_used_when_not_supplied(template_bytes, sample_data_single):
    """
    Omitting ``material_prices`` falls back to reading them from the template.

    The production ``calc.xlsx`` is expected to have cached formula values,
    so this is exactly the path used by the deployed service.
    """
    result = process_calculation(sample_data_single, template_bytes)
    _, sheet = _open_calc_sheet(result)
    price = sheet.cell(row=_base_row(0) + ROW_LASER, column=COL_PRICE_PER_M2).value
    assert price is not None and price > 0


def test_integration_with_real_template(calc, sample_data_single):
    """The commercial offer sheet keeps formulas referencing the calc sheet."""
    result = calc(sample_data_single)
    wb = load_workbook(io.BytesIO(result))
    kp_sheet = wb["КП с ндс"]
    assert kp_sheet.cell(row=15, column=2).value == "=Расчёт!C3"
    assert kp_sheet.cell(row=15, column=4).value == "=Расчёт!L8"
