import math

class DXFParserError(Exception):    
    pass

class DXFStructureError(DXFParserError):    
    pass


def parse_dxf(file_path):
    entities = []
    current_entity = None
    in_entities = False
    current_section = None

    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    if not lines:
        raise DXFStructureError("File is empty")

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
        
        if code == 0 and value == 'SECTION':
            in_entities = False
            current_section = None
        elif code == 2 and value == 'ENTITIES':
            in_entities = True
            current_section = 'ENTITIES'
        elif code == 0 and value == 'ENDSEC':
            if current_section == 'ENTITIES':
                in_entities = False
                current_section = None

        if in_entities and current_section == 'ENTITIES':
            if code == 0:
                if current_entity:
                    entities.append(current_entity)
                current_entity = {'type': value}
            else:
                if current_entity is not None:
                    current_entity[code] = value

    if current_entity:
        entities.append(current_entity)

    return entities


def extract_measurements(file_path):   
    try:
        entities = parse_dxf(file_path)
    except (FileNotFoundError, PermissionError, UnicodeDecodeError, DXFParserError) as e:        
        return f"Ошибка при парсинге файла: {e}"

    measurements = []
    lines = []
    circles = []
    all_points = []

    for ent in entities:
        if ent.get('type') == 'LINE':
            try:
                x1 = float(ent[10])
                y1 = float(ent[20])
                x2 = float(ent[11])
                y2 = float(ent[21])
                length = math.hypot(x2 - x1, y2 - y1)
                lines.append((length, (x1, y1), (x2, y2)))
                all_points.extend([(x1, y1), (x2, y2)])
            except (KeyError, ValueError, TypeError):
                pass

        elif ent.get('type') == 'CIRCLE':
            try:
                cx = float(ent.get(10, 0))
                cy = float(ent.get(20, 0))
                radius = float(ent.get(40, 0))
                circles.append((radius, (cx, cy)))                
                all_points.extend([
                    (cx - radius, cy - radius),
                    (cx + radius, cy + radius)
                ])
            except (ValueError, TypeError):
                pass
    
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
        measurements.append(f"X range: [{min_x:.3f}, {max_x:.3f}], Y range: [{min_y:.3f}, {max_y:.3f}]")

    if not measurements:
        return "No measurements found."

    return "\n".join(measurements)


def get_measurements_data(file_path):   
    entities = parse_dxf(file_path)
    result = {
        'lines': [],
        'circles': [],
        'bounding_box': None
    }
    all_points = []

    for ent in entities:
        if ent.get('type') == 'LINE':
            try:
                x1 = float(ent[10])
                y1 = float(ent[20])
                x2 = float(ent[11])
                y2 = float(ent[21])
                length = math.hypot(x2 - x1, y2 - y1)
                result['lines'].append({'length': length, 'start': (x1, y1), 'end': (x2, y2)})
                all_points.extend([(x1, y1), (x2, y2)])
            except (KeyError, ValueError, TypeError):
                pass

        elif ent.get('type') == 'CIRCLE':
            try:
                cx = float(ent.get(10, 0))
                cy = float(ent.get(20, 0))
                radius = float(ent.get(40, 0))
                result['circles'].append({
                    'radius': radius,
                    'center': (cx, cy)
                })
                all_points.extend([
                    (cx - radius, cy - radius),
                    (cx + radius, cy + radius)
                ])
            except (ValueError, TypeError):
                pass

    if all_points:
        xs = [p[0] for p in all_points]
        ys = [p[1] for p in all_points]
        result['bounding_box'] = {
            'width': max(xs) - min(xs),
            'height': max(ys) - min(ys),
            'min_x': min(xs),
            'max_x': max(xs),
            'min_y': min(ys),
            'max_y': max(ys)
        }

    return result