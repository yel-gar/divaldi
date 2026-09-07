import math

class DXFParserError(Exception):    
    pass

class DXFStructureError(DXFParserError):    
    pass


def parse_dxf(file_path):    
    entities = []
    current_entity = None
    current_code = None
    in_entities = False
    current_section = None

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except UnicodeDecodeError:        
        try:
            with open(file_path, 'r', encoding='cp1251') as f:
                lines = f.readlines()
        except UnicodeDecodeError as e:
            raise UnicodeDecodeError(f"Can read UTF-8 or CP1251 only: {e}")

    if not lines:
        raise DXFStructureError("File is empty")

    for line in lines:
        line = line.strip()
        if not line:
            continue

        if line.isdigit():
            current_code = int(line)
            continue

        if current_code is not None:
            value = line
            
            if current_code == 0 and value == 'SECTION':
                in_entities = False
                current_section = None
            elif current_code == 2 and value == 'ENTITIES':
                in_entities = True
                current_section = 'ENTITIES'
            elif current_code == 0 and value == 'ENDSEC':
                if current_section == 'ENTITIES':
                    in_entities = False
                    current_section = None
            
            if in_entities and current_section == 'ENTITIES':
                if current_code == 0:
                    if current_entity:
                        entities.append(current_entity)
                    current_entity = {'type': value}
                else:
                    if current_entity is not None:
                        current_entity[current_code] = value

            current_code = None
    
    if current_entity:
        entities.append(current_entity)

    if not entities:    
        pass

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
                x1 = float(ent.get(10, 0))
                y1 = float(ent.get(20, 0))
                x2 = float(ent.get(11, 0))
                y2 = float(ent.get(21, 0))
                length = math.hypot(x2 - x1, y2 - y1)
                lines.append((length, (x1, y1), (x2, y2)))
                all_points.extend([(x1, y1), (x2, y2)])
            except (ValueError, TypeError) as e:                
                pass

        elif ent.get('type') == 'CIRCLE':
            try:
                cx = float(ent.get(10, 0))
                cy = float(ent.get(20, 0))
                radius = float(ent.get(40, 0))
                circles.append((radius, (cx, cy)))
                all_points.append((cx, cy))
            except (ValueError, TypeError) as e:                
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
                x1 = float(ent.get(10, 0))
                y1 = float(ent.get(20, 0))
                x2 = float(ent.get(11, 0))
                y2 = float(ent.get(21, 0))
                length = math.hypot(x2 - x1, y2 - y1)
                result['lines'].append({
                    'length': length,
                    'start': (x1, y1),
                    'end': (x2, y2)
                })
                all_points.extend([(x1, y1), (x2, y2)])
            except (ValueError, TypeError):
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
                all_points.append((cx, cy))
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