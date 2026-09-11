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

    All values are stored as lists (even for single-value codes) to handle
    repeated group codes (e.g., vertices of LWPOLYLINE).

    Args:
        dxf_bytes: DXF file content as bytes.

    Returns:
        List of entities, each entity is a dict with:
            - 'type' (str): entity type
            - group codes (int) -> list of values

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
        # Keep leading/trailing spaces only for string values (we don't use them yet)
        value = lines[i].rstrip("\n")  # Preserve spaces in string values
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
                    # Store all values as lists to handle repeated codes
                    current_entity.setdefault(code, []).append(value)

    if current_entity:
        entities.append(current_entity)

    return entities


def _get_float(entity: dict, code: int, index: int = 0) -> float:
    """Get float value from entity list at given index, return 0.0 if missing."""
    values = entity.get(code, [])
    if index < len(values):
        try:
            return float(values[index])
        except ValueError, TypeError:
            return 0.0
    return 0.0


def _get_points_lwpolyline(entity: dict) -> list[tuple[float, float]]:
    """Extract vertices from LWPOLYLINE entity."""
    xs = entity.get(10, [])
    ys = entity.get(20, [])
    points = []
    for i in range(min(len(xs), len(ys))):
        try:
            points.append((float(xs[i]), float(ys[i])))
        except ValueError, TypeError:
            continue
    return points


def extract_measurements(dxf_bytes: bytes) -> str:
    """
    Extract measurements from DXF bytes and return as a formatted string.

    Args:
        dxf_bytes: DXF file content as bytes.

    Returns:
        Multiline string with lines, circles, polylines, arcs, and bounding box.
        On error, returns a message starting with "Error parsing file:".
    """
    try:
        entities = parse_dxf(dxf_bytes)
    except (UnicodeDecodeError, DXFParserError) as e:
        return f"Error parsing file: {e}"

    measurements = []
    lines = []
    circles = []
    polylines = []
    arcs = []
    all_points = []

    for ent in entities:
        ent_type = ent.get("type", "")

        if ent_type == "LINE":
            try:
                x1 = _get_float(ent, 10, 0)
                y1 = _get_float(ent, 20, 0)
                x2 = _get_float(ent, 11, 0)
                y2 = _get_float(ent, 21, 0)
                length = math.hypot(x2 - x1, y2 - y1)
                lines.append((length, (x1, y1), (x2, y2)))
                all_points.extend([(x1, y1), (x2, y2)])
            except ValueError, TypeError:
                continue

        elif ent_type == "CIRCLE":
            try:
                cx = _get_float(ent, 10, 0)
                cy = _get_float(ent, 20, 0)
                radius = _get_float(ent, 40, 0)
                if radius > 0:
                    circles.append((radius, (cx, cy)))
                    all_points.extend([(cx - radius, cy - radius), (cx + radius, cy + radius)])
            except ValueError, TypeError:
                continue

        elif ent_type == "ARC":
            try:
                cx = _get_float(ent, 10, 0)
                cy = _get_float(ent, 20, 0)
                radius = _get_float(ent, 40, 0)
                if radius > 0:
                    arcs.append((radius, (cx, cy)))
                    all_points.extend([(cx - radius, cy - radius), (cx + radius, cy + radius)])
            except ValueError, TypeError:
                continue

        elif ent_type in ("LWPOLYLINE", "POLYLINE"):
            points = _get_points_lwpolyline(ent)
            if len(points) >= 2:
                # Compute total length (including closing segment if closed)
                is_closed = False
                if ent_type == "LWPOLYLINE":
                    flags = ent.get(70, ["0"])
                    is_closed = (int(flags[0]) & 1) == 1 if flags else False
                # POLYLINE: similar, but we may not handle properly; assume closed if flags bit 1 set

                total_length = 0.0
                for i in range(len(points) - 1):
                    dx = points[i + 1][0] - points[i][0]
                    dy = points[i + 1][1] - points[i][1]
                    total_length += math.hypot(dx, dy)
                if is_closed and len(points) > 2:
                    dx = points[0][0] - points[-1][0]
                    dy = points[0][1] - points[-1][1]
                    total_length += math.hypot(dx, dy)

                polylines.append((total_length, points, is_closed))
                all_points.extend(points)

    # Format output
    for i, (length, p1, p2) in enumerate(lines, 1):
        measurements.append(f"Line {i}: length = {length:.3f} (from {p1} to {p2})")

    for i, (radius, center) in enumerate(circles, 1):
        measurements.append(f"Circle {i}: radius = {radius:.3f}, center = {center}")

    for i, (radius, center) in enumerate(arcs, 1):
        measurements.append(f"Arc {i}: radius = {radius:.3f}, center = {center}")

    for i, (length, points, closed) in enumerate(polylines, 1):
        status = "closed" if closed else "open"
        measurements.append(f"Polyline {i}: length = {length:.3f}, {status}, vertices = {len(points)}")

    if all_points:
        xs = [p[0] for p in all_points]
        ys = [p[1] for p in all_points]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        width = max_x - min_x
        height = max_y - min_y
        measurements.append(f"Bounding box: width = {width:.3f}, height = {height:.3f}")
        measurements.append(f"X range: [{min_x:.3f}, {max_x:.3f}], Y range: [{min_y:.3f}, {max_y:.3f}]")

    if not measurements:
        return "No measurements found."

    return "\n".join(measurements)


def get_measurements_data(dxf_bytes: bytes) -> dict[str, Any]:
    """
    Extract measurements from DXF bytes and return as a structured dictionary.

    Args:
        dxf_bytes: DXF file content as bytes.

    Returns:
        Dictionary with keys 'lines', 'circles', 'polylines', 'arcs', 'bounding_box'.
        On error, returns a dictionary with an 'error' key.
    """
    try:
        entities = parse_dxf(dxf_bytes)
    except (UnicodeDecodeError, DXFParserError) as e:
        return {
            "error": str(e),
            "lines": [],
            "circles": [],
            "polylines": [],
            "arcs": [],
            "bounding_box": None,
        }

    result = {
        "lines": [],
        "circles": [],
        "polylines": [],
        "arcs": [],
        "bounding_box": None,
    }
    all_points = []

    for ent in entities:
        ent_type = ent.get("type", "")

        if ent_type == "LINE":
            try:
                x1 = _get_float(ent, 10, 0)
                y1 = _get_float(ent, 20, 0)
                x2 = _get_float(ent, 11, 0)
                y2 = _get_float(ent, 21, 0)
                length = math.hypot(x2 - x1, y2 - y1)
                result["lines"].append(
                    {
                        "length": length,
                        "start": (x1, y1),
                        "end": (x2, y2),
                    }
                )
                all_points.extend([(x1, y1), (x2, y2)])
            except ValueError, TypeError:
                continue

        elif ent_type == "CIRCLE":
            try:
                cx = _get_float(ent, 10, 0)
                cy = _get_float(ent, 20, 0)
                radius = _get_float(ent, 40, 0)
                if radius > 0:
                    result["circles"].append({"radius": radius, "center": (cx, cy)})
                    all_points.extend(
                        [
                            (cx - radius, cy - radius),
                            (cx + radius, cy + radius),
                        ]
                    )
            except ValueError, TypeError:
                continue

        elif ent_type == "ARC":
            try:
                cx = _get_float(ent, 10, 0)
                cy = _get_float(ent, 20, 0)
                radius = _get_float(ent, 40, 0)
                if radius > 0:
                    result["arcs"].append({"radius": radius, "center": (cx, cy)})
                    all_points.extend(
                        [
                            (cx - radius, cy - radius),
                            (cx + radius, cy + radius),
                        ]
                    )
            except ValueError, TypeError:
                continue

        elif ent_type in ("LWPOLYLINE", "POLYLINE"):
            points = _get_points_lwpolyline(ent)
            if len(points) >= 2:
                is_closed = False
                if ent_type == "LWPOLYLINE":
                    flags = ent.get(70, ["0"])
                    is_closed = (int(flags[0]) & 1) == 1 if flags else False
                # POLYLINE: assume closed if flag bit 1 set (simplified)
                total_length = 0.0
                for i in range(len(points) - 1):
                    dx = points[i + 1][0] - points[i][0]
                    dy = points[i + 1][1] - points[i][1]
                    total_length += math.hypot(dx, dy)
                if is_closed and len(points) > 2:
                    dx = points[0][0] - points[-1][0]
                    dy = points[0][1] - points[-1][1]
                    total_length += math.hypot(dx, dy)

                result["polylines"].append(
                    {
                        "length": total_length,
                        "vertices": points,
                        "closed": is_closed,
                    }
                )
                all_points.extend(points)

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
