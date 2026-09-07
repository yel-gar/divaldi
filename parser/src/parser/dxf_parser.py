"""
DXF parser module for extracting geometric measurements from DXF files.
"""

import math
from typing import Any

SUPPORTED_ENCODINGS = ["utf-8", "cp1251", "latin-1"]


class DXFParserError(Exception):
    """Base exception for DXF parsing errors."""


class DXFStructureError(DXFParserError):
    """Exception raised for invalid DXF structure."""


def parse_dxf(dxf_bytes: bytes) -> list[dict[int | str, Any]]:
    """
    Parse DXF bytes and return a list of entities from the ENTITIES section.

    Args:
        dxf_bytes: DXF file content as bytes.

    Returns:
        List of entities, each entity is a dict with 'type' key (string)
        and group codes (int) as keys, values are strings.

    Raises:
        UnicodeDecodeError: if the bytes cannot be decoded with supported encodings.
        DXFStructureError: if the DXF structure is invalid or empty.
    """
    # Decode bytes with supported encodings
    for enc in SUPPORTED_ENCODINGS:
        try:
            content = dxf_bytes.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise UnicodeDecodeError("Cannot decode DXF with supported encodings")

    lines = content.splitlines()
    if not lines:
        raise DXFStructureError("File is empty")

    entities = []
    current_entity = None
    in_entities = False
    current_section = None

    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        try:
            code = int(line)
        except ValueError:
            i += 1
            continue
        i += 1
        if i >= len(lines):
            break
        value = lines[i].strip()
        i += 1

        # Section handling
        if code == 0 and value == "SECTION":
            in_entities = False
            current_section = None
        elif code == 2 and value == "ENTITIES":
            in_entities = True
            current_section = "ENTITIES"
        elif code == 0 and value == "ENDSEC":
            if current_section == "ENTITIES":
                in_entities = False
                current_section = None

        # Entity collection inside ENTITIES section
        if in_entities and current_section == "ENTITIES":
            if code == 0:  # New entity starts
                if current_entity:
                    entities.append(current_entity)
                current_entity = {"type": value}
            else:
                if current_entity is not None:
                    current_entity[code] = value

    if current_entity:
        entities.append(current_entity)

    return entities


def extract_measurements(dxf_bytes: bytes) -> str:
    """
    Extract measurements from DXF bytes and return as a formatted string.

    Args:
        dxf_bytes: DXF file content as bytes.

    Returns:
        Multiline string with lines, circles, and bounding box information.
        On error, returns a message starting with "Error parsing file:".
    """
    try:
        entities = parse_dxf(dxf_bytes)
    except (UnicodeDecodeError, DXFParserError) as e:
        return f"Error parsing file: {e}"

    measurements = []
    lines = []
    circles = []
    all_points = []

    for ent in entities:
        if ent.get("type") == "LINE":
            try:
                x1 = float(ent[10])
                y1 = float(ent[20])
                x2 = float(ent[11])
                y2 = float(ent[21])
                length = math.hypot(x2 - x1, y2 - y1)
                lines.append((length, (x1, y1), (x2, y2)))
                all_points.extend([(x1, y1), (x2, y2)])
            except (KeyError, ValueError, TypeError):
                # Skip invalid line
                pass

        elif ent.get("type") == "CIRCLE":
            try:
                cx = float(ent.get(10, 0))
                cy = float(ent.get(20, 0))
                radius = float(ent.get(40, 0))
                circles.append((radius, (cx, cy)))
                # Add circle radius extents for bounding box
                all_points.extend(
                    [(cx - radius, cy - radius), (cx + radius, cy + radius)]
                )
            except (ValueError, TypeError):
                # Skip invalid circle
                pass

    # Format output
    for i, (length, p1, p2) in enumerate(lines, 1):
        measurements.append(f"Line {i}: length = {length:.3f} (from {p1} to {p2})")

    for i, (radius, center) in enumerate(circles, 1):
        measurements.append(f"Circle {i}: radius = {radius:.3f}, center = {center}")

    if all_points:
        xs = [p[0] for p in all_points]
        ys = [p[1] for p in all_points]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        width = max_x - min_x
        height = max_y - min_y
        measurements.append(f"Bounding box: width = {width:.3f}, height = {height:.3f}")
        measurements.append(
            f"X range: [{min_x:.3f}, {max_x:.3f}], Y range: [{min_y:.3f}, {max_y:.3f}]"
        )

    if not measurements:
        return "No measurements found."

    return "\n".join(measurements)


def get_measurements_data(dxf_bytes: bytes) -> dict[str, Any]:
    """
    Extract measurements from DXF bytes and return as a structured dictionary.

    Args:
        dxf_bytes: DXF file content as bytes.

    Returns:
        Dictionary with keys 'lines', 'circles', 'bounding_box'.
    """
    entities = parse_dxf(dxf_bytes)
    result = {"lines": [], "circles": [], "bounding_box": None}
    all_points = []

    for ent in entities:
        if ent.get("type") == "LINE":
            try:
                x1 = float(ent[10])
                y1 = float(ent[20])
                x2 = float(ent[11])
                y2 = float(ent[21])
                length = math.hypot(x2 - x1, y2 - y1)
                result["lines"].append(
                    {"length": length, "start": (x1, y1), "end": (x2, y2)}
                )
                all_points.extend([(x1, y1), (x2, y2)])
            except (KeyError, ValueError, TypeError):
                pass

        elif ent.get("type") == "CIRCLE":
            try:
                cx = float(ent.get(10, 0))
                cy = float(ent.get(20, 0))
                radius = float(ent.get(40, 0))
                result["circles"].append({"radius": radius, "center": (cx, cy)})
                all_points.extend(
                    [(cx - radius, cy - radius), (cx + radius, cy + radius)]
                )
            except (ValueError, TypeError):
                pass

    if all_points:
        xs = [p[0] for p in all_points]
        ys = [p[1] for p in all_points]
        result["bounding_box"] = {
            "width": max(xs) - min(xs),
            "height": max(ys) - min(ys),
            "min_x": min(xs),
            "max_x": max(xs),
            "min_y": min(ys),
            "max_y": max(ys),
        }

    return result
