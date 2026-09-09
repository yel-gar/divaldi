"""
Excel template filler module for commercial offer generation.

Copies the original Excel template, writes part parameters (material, area,
cutting length, bends, welding, turning hours, painting area) to the "Расчёт"
sheet, and saves the result to the specified output file. Excel formulas
will recalculate automatically when the file is opened by the user.
"""

import json
import shutil
from pathlib import Path
from typing import Dict, Any

from openpyxl import load_workbook


# Constants
LASER_SPEED = 10.0
WELDING_SPEED = 2.0
BENDING_RATE = 84.0
PAINTING_RATE = 5.53


def _load_material_prices(file_path: str) -> Dict[str, float]:
    """
    Loads material prices from the 'Цены на металл' sheet of the given Excel file.

    Opens the file with data_only=True to get calculated values (not formulas).

    Args:
        file_path: Path to the Excel file.

    Returns:
        A dictionary {material_name: price_per_m²}. Prices are taken from
        column H ('Стоимость 1м2') starting from row 3.
    """
    wb = load_workbook(file_path, data_only=True)
    sheet = wb['Цены на металл']
    prices = {}
    for row in range(3, sheet.max_row + 1):
        name_cell = sheet.cell(row=row, column=1)   # A
        price_cell = sheet.cell(row=row, column=8)  # H
        if name_cell.value and price_cell.value:
            try:
                price = float(price_cell.value)
                prices[str(name_cell.value).strip()] = price
            except (ValueError, TypeError):
                continue
    return prices


def _write_position(
    sheet,
    row_offset: int,
    pos_data: Dict[str, Any],
    material_prices: Dict[str, float]
) -> None:
    """
    Writes a single part position data to the 'Расчёт' sheet.

    Args:
        sheet: The 'Расчёт' worksheet.
        row_offset: Starting row of the position block (3, 12, 21, ...).
        pos_data: Dictionary with part parameters:
            - material (str): material name (must match the reference list)
            - area_m2 (float): sheet/part area in m²
            - laser_m (float): laser cutting length in meters
            - bends (int/float): number of bends
            - welding_m (float): weld seam length in meters
            - turning_hours (float): turning hours (already in hours)
            - painting_m2 (float): powder coating area in m²
        material_prices: Dictionary of material prices (from _load_material_prices).

    Returns:
        None
    """
    row_laser = row_offset
    row_bending = row_offset + 1
    row_turning = row_offset + 2
    row_welding = row_offset + 3
    row_painting = row_offset + 4

    material = pos_data.get('material', '').strip()
    area = float(pos_data.get('area_m2', 0.0))

    sheet.cell(row=row_laser, column=3).value = material   # C
    sheet.cell(row=row_laser, column=5).value = area       # E

    price_per_m2 = material_prices.get(material, 0.0)
    sheet.cell(row=row_laser, column=4).value = price_per_m2  # D

    laser_m = float(pos_data.get('laser_m', 0.0))
    hours_laser = laser_m / LASER_SPEED if LASER_SPEED > 0 else 0.0
    sheet.cell(row=row_laser, column=8).value = hours_laser

    bends = float(pos_data.get('bends', 0.0))
    hours_bending = bends / BENDING_RATE if BENDING_RATE > 0 else 0.0
    sheet.cell(row=row_bending, column=8).value = hours_bending

    hours_turning = float(pos_data.get('turning_hours', 0.0))
    sheet.cell(row=row_turning, column=8).value = hours_turning

    welding_m = float(pos_data.get('welding_m', 0.0))
    hours_welding = welding_m / WELDING_SPEED if WELDING_SPEED > 0 else 0.0
    sheet.cell(row=row_welding, column=8).value = hours_welding

    painting_m2 = float(pos_data.get('painting_m2', 0.0))
    sheet.cell(row=row_painting, column=5).value = painting_m2  # E


def process_calculation(
    json_data: str,
    template_path: str,
    output_path: str
) -> str:
    """
    Processes JSON data from GigaChat and creates a filled Excel commercial offer.

    Workflow:
        1. Parses the JSON.
        2. Copies the template (template_path) to output_path.
        3. Opens the copy for writing (without data_only).
        4. Loads material prices from the copy using data_only=True.
        5. Clears old data (for all 10 positions).
        6. Writes each position's parameters (up to 10) to the 'Расчёт' sheet.
        7. Saves the file.

    Args:
        json_data: JSON string from GigaChat.
            Expected structure:
            {
                "positions": [
                    {
                        "name": "Bracket left",
                        "material": "1,5 мм Оц. Сталь (2500х1250)",
                        "area_m2": 0.8,
                        "laser_m": 2.5,
                        "bends": 12,
                        "welding_m": 0.5,
                        "turning_hours": 0.0,
                        "painting_m2": 0.8
                    }
                ]
            }
        template_path: Path to the Excel template file (original).
        output_path: Path where the result file will be saved (including filename).

    Returns:
        The path to the created Excel file (output_path).

    Raises:
        ValueError: If JSON is invalid or missing the 'positions' key.
        FileNotFoundError: If the template file does not exist.
        PermissionError: If write permissions are insufficient.
    """
    try:
        data = json.loads(json_data)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON: {e}")

    positions = data.get('positions', [])
    if not positions:
        raise ValueError("JSON missing 'positions' key or it is empty.")

    template_file = Path(template_path)
    if not template_file.exists():
        raise FileNotFoundError(f"Template file not found: {template_path}")

    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    shutil.copy2(template_file, output_file)

    wb = load_workbook(output_file)
    calc_sheet = wb['Расчёт']

    material_prices = _load_material_prices(str(output_file))

    for i in range(10):
        row_start = 3 + i * 9
        # Laser: columns C, D, E, H
        for col in [3, 4, 5, 8]:
            calc_sheet.cell(row=row_start, column=col).value = None
        # Bending: H
        calc_sheet.cell(row=row_start + 1, column=8).value = None
        # Turning: H
        calc_sheet.cell(row=row_start + 2, column=8).value = None
        # Welding: H
        calc_sheet.cell(row=row_start + 3, column=8).value = None
        # Painting: E
        calc_sheet.cell(row=row_start + 4, column=5).value = None

    for idx, pos in enumerate(positions[:10]):
        row_start = 3 + idx * 9
        _write_position(calc_sheet, row_start, pos, material_prices)

    wb.save(output_file)

    return str(output_file)
