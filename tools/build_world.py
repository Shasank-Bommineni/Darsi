#!/usr/bin/env python3
"""Convert the raw Darsi OpenStreetMap extract into the runtime world manifest.

Input : data/osm/darsi_raw.json   (verbatim Overpass answer, see tools/fetch_darsi_osm.py)
Output: data/darsi_world.json     (metre-space geometry consumed by scripts/world_builder.gd)

Everything geometric in the output is derived from OpenStreetMap - nothing is invented.
Coordinates are projected to a local east/north metre frame around the town anchor and
rounded to 0.1 m so the manifest stays small enough to ship with the game.

Data (c) OpenStreetMap contributors, ODbL.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

EAST_METRES_PER_DEGREE = 111320.0
NORTH_METRES_PER_DEGREE = 110574.0

# OSM highway value -> (game class, carriageway width in metres)
ROAD_CLASSES: dict[str, tuple[str, float]] = {
    "motorway": ("highway", 14.0),
    "motorway_link": ("highway", 8.0),
    "trunk": ("highway", 12.0),
    "trunk_link": ("highway", 7.0),
    "primary": ("arterial", 10.0),
    "primary_link": ("arterial", 6.5),
    "secondary": ("arterial", 8.5),
    "secondary_link": ("arterial", 6.0),
    "tertiary": ("collector", 7.0),
    "tertiary_link": ("collector", 5.5),
    "unclassified": ("neighbourhood", 5.5),
    "residential": ("neighbourhood", 5.0),
    "living_street": ("lane", 4.0),
    "service": ("lane", 3.5),
    "track": ("track", 3.0),
    "path": ("path", 1.8),
    "footway": ("path", 1.6),
    "pedestrian": ("path", 4.0),
    "cycleway": ("path", 2.0),
    "steps": ("path", 1.4),
    "bridleway": ("path", 1.8),
}

DRIVABLE = {"highway", "arterial", "collector", "neighbourhood", "lane", "track"}

BUILDING_HEIGHTS = {
    "house": 3.6,
    "residential": 4.2,
    "apartments": 9.0,
    "commercial": 7.0,
    "retail": 5.5,
    "industrial": 7.5,
    "warehouse": 7.0,
    "school": 7.0,
    "college": 9.0,
    "university": 10.0,
    "hospital": 9.0,
    "temple": 9.0,
    "mosque": 8.0,
    "church": 9.0,
    "government": 8.0,
    "civic": 7.5,
    "hut": 2.8,
    "shed": 2.6,
    "roof": 3.0,
    "farm_auxiliary": 3.4,
    "construction": 4.0,
    "yes": 4.4,
}

POI_KEYS = ("amenity", "shop", "tourism", "historic", "man_made", "office", "leisure", "place")

WATER_NATURAL = {"water", "wetland", "spring"}
GREEN_LANDUSE = {
    "farmland",
    "farmyard",
    "meadow",
    "orchard",
    "vineyard",
    "grass",
    "forest",
    "village_green",
    "allotments",
    "plant_nursery",
    "recreation_ground",
    "cemetery",
}


class Projector:
    def __init__(self, lat: float, lon: float) -> None:
        self.lat = lat
        self.lon = lon
        self.scale_x = EAST_METRES_PER_DEGREE * math.cos(math.radians(lat))

    def to_metres(self, lat: float, lon: float) -> tuple[float, float]:
        """Return (east, north) metres relative to the anchor."""
        return ((lon - self.lon) * self.scale_x, (lat - self.lat) * NORTH_METRES_PER_DEGREE)


def simplify(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    """Ramer-Douglas-Peucker in metre space."""
    if len(points) < 3:
        return points
    first, last = points[0], points[-1]
    dx, dy = last[0] - first[0], last[1] - first[1]
    length = math.hypot(dx, dy)
    index, best = 0, -1.0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        if length < 1e-9:
            distance = math.hypot(px - first[0], py - first[1])
        else:
            distance = abs(dy * px - dx * py + last[0] * first[1] - last[1] * first[0]) / length
        if distance > best:
            index, best = i, distance
    if best <= tolerance:
        return [first, last]
    return simplify(points[: index + 1], tolerance)[:-1] + simplify(points[index:], tolerance)


def clip_polyline(points: list[tuple[float, float]], half_x: float, half_y: float) -> list[list[tuple[float, float]]]:
    """Split a polyline into the segments that stay inside the playable rectangle."""

    def inside(p: tuple[float, float]) -> bool:
        return abs(p[0]) <= half_x and abs(p[1]) <= half_y

    def crossing(a: tuple[float, float], b: tuple[float, float]) -> tuple[float, float]:
        """Point where the segment a->b meets the rectangle, so roads stop exactly at the edge."""
        lo, hi = 0.0, 1.0
        for _ in range(40):
            mid = (lo + hi) * 0.5
            p = (a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid)
            if inside(p):
                lo = mid
            else:
                hi = mid
        return (a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo)

    runs: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = []
    for i, point in enumerate(points):
        if inside(point):
            if not current and i > 0:
                current.append(crossing(point, points[i - 1]))  # enter the window at the border
            current.append(point)
        else:
            if current:
                current.append(crossing(current[-1], point))  # leave at the border
                runs.append(current)
                current = []
    if current:
        runs.append(current)
    return [run for run in runs if len(run) >= 2]


def polygon_area(points: list[tuple[float, float]]) -> float:
    total = 0.0
    for i in range(len(points)):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % len(points)]
        total += x1 * y2 - x2 * y1
    return abs(total) * 0.5


def centroid(points: list[tuple[float, float]]) -> tuple[float, float]:
    sx = sum(p[0] for p in points) / len(points)
    sy = sum(p[1] for p in points) / len(points)
    return sx, sy


def r1(value: float) -> float:
    return round(value, 1)


def flat(points: list[tuple[float, float]]) -> list[float]:
    out: list[float] = []
    for x, y in points:
        out.append(r1(x))
        out.append(r1(y))
    return out


def building_height(tags: dict[str, str]) -> float:
    for key in ("height", "building:height"):
        raw = tags.get(key)
        if raw:
            try:
                return max(2.5, float(str(raw).replace("m", "").strip()))
            except ValueError:
                pass
    levels = tags.get("building:levels")
    if levels:
        try:
            return max(2.8, float(levels) * 3.2)
        except ValueError:
            pass
    return BUILDING_HEIGHTS.get(tags.get("building", "yes"), 4.4)


def ring_of(element: dict) -> list[tuple[float, float]] | None:
    geometry = element.get("geometry")
    if geometry:
        return [(point["lat"], point["lon"]) for point in geometry if point]
    members = element.get("members")
    if members:
        for member in members:
            if member.get("role") == "outer" and member.get("geometry"):
                return [(point["lat"], point["lon"]) for point in member["geometry"] if point]
    return None


def convert(raw: dict, half_x: float, half_y: float, simplify_m: float) -> dict:
    anchor = raw.get("darsi_request", {}).get("anchor", {"lat": 15.7667, "lon": 79.6833})
    projector = Projector(float(anchor["lat"]), float(anchor["lon"]))

    roads: list[dict] = []
    buildings: list[dict] = []
    water: list[dict] = []
    green: list[dict] = []
    pois: list[dict] = []
    railways: list[dict] = []
    walls: list[dict] = []

    def project_all(latlons: list[tuple[float, float]]) -> list[tuple[float, float]]:
        return [projector.to_metres(lat, lon) for lat, lon in latlons]

    for element in raw["elements"]:
        tags = element.get("tags") or {}
        kind = element.get("type")

        if kind == "node":
            lat, lon = element.get("lat"), element.get("lon")
            if lat is None or lon is None:
                continue
            x, y = projector.to_metres(float(lat), float(lon))
            if abs(x) > half_x or abs(y) > half_y:
                continue
            category = next((tags[key] for key in POI_KEYS if tags.get(key)), None)
            if not category:
                continue
            pois.append(
                {
                    "id": f"n{element['id']}",
                    "name": tags.get("name") or tags.get("name:en") or category.replace("_", " ").title(),
                    "kind": category,
                    "x": r1(x),
                    "y": r1(y),
                    "tags": {k: v for k, v in tags.items() if k in ("amenity", "shop", "religion", "place", "tourism", "man_made", "operator")},
                }
            )
            continue

        highway = tags.get("highway")
        if highway in ROAD_CLASSES and element.get("geometry"):
            road_class, width = ROAD_CLASSES[highway]
            metres = project_all([(p["lat"], p["lon"]) for p in element["geometry"] if p])
            for run in clip_polyline(metres, half_x + 60.0, half_y + 60.0):
                simplified = simplify(run, simplify_m)
                if len(simplified) < 2:
                    continue
                roads.append(
                    {
                        "id": f"w{element['id']}_{len(roads)}",
                        "osm_id": element["id"],
                        "name": tags.get("name") or tags.get("name:en") or tags.get("ref") or "",
                        "ref": tags.get("ref", ""),
                        "osm_highway": highway,
                        "class": road_class,
                        "width": width if tags.get("lanes") is None else max(width, _lane_width(tags, width)),
                        "oneway": tags.get("oneway") in ("yes", "1", "true"),
                        "surface": tags.get("surface", ""),
                        "bridge": bool(tags.get("bridge")),
                        "drivable": road_class in DRIVABLE,
                        "points": flat(simplified),
                    }
                )
            continue

        if tags.get("railway") in ("rail", "light_rail", "narrow_gauge", "disused", "abandoned") and element.get("geometry"):
            metres = project_all([(p["lat"], p["lon"]) for p in element["geometry"] if p])
            for run in clip_polyline(metres, half_x, half_y):
                railways.append({"id": f"r{element['id']}", "points": flat(simplify(run, simplify_m))})
            continue

        if tags.get("barrier") in ("wall", "fence", "hedge") and element.get("geometry"):
            metres = project_all([(p["lat"], p["lon"]) for p in element["geometry"] if p])
            for run in clip_polyline(metres, half_x, half_y):
                walls.append({"kind": tags["barrier"], "points": flat(simplify(run, max(simplify_m, 1.0)))})
            continue

        ring = ring_of(element)
        if not ring:
            continue
        metres = project_all(ring)
        if metres and metres[0] == metres[-1]:
            metres = metres[:-1]
        if len(metres) < 3:
            continue
        cx, cy = centroid(metres)
        if abs(cx) > half_x or abs(cy) > half_y:
            continue
        area = polygon_area(metres)

        if tags.get("building") or tags.get("building:part"):
            if area < 6.0:
                continue
            outline = simplify(metres + [metres[0]], 0.35)[:-1]
            if len(outline) < 3:
                continue
            buildings.append(
                {
                    "id": f"b{element['id']}",
                    "name": tags.get("name") or tags.get("name:en") or "",
                    "type": tags.get("building", "yes"),
                    "amenity": tags.get("amenity", "") or tags.get("shop", "") or tags.get("religion", ""),
                    "height": round(building_height(tags), 1),
                    "area": round(area, 1),
                    "cx": r1(cx),
                    "cy": r1(cy),
                    "outline": flat(outline),
                }
            )
            continue

        natural = tags.get("natural")
        waterway = tags.get("waterway")
        if natural in WATER_NATURAL or waterway in ("riverbank", "dock") or tags.get("landuse") in ("reservoir", "basin"):
            water.append(
                {
                    "id": f"wa{element['id']}",
                    "name": tags.get("name", ""),
                    "kind": natural or waterway or tags.get("landuse", "water"),
                    "area": round(area, 1),
                    "outline": flat(simplify(metres + [metres[0]], 1.5)[:-1]),
                }
            )
            continue

        landuse = tags.get("landuse") or tags.get("leisure") or natural
        if landuse in GREEN_LANDUSE or natural in ("scrub", "wood", "tree_row", "sand", "bare_rock"):
            green.append(
                {
                    "id": f"g{element['id']}",
                    "kind": landuse or natural,
                    "name": tags.get("name", ""),
                    "area": round(area, 1),
                    "outline": flat(simplify(metres + [metres[0]], 3.0)[:-1]),
                }
            )

    # Streams and canals are linear water features.
    for element in raw["elements"]:
        tags = element.get("tags") or {}
        if tags.get("waterway") in ("stream", "river", "canal", "drain", "ditch") and element.get("geometry"):
            metres = [projector.to_metres(p["lat"], p["lon"]) for p in element["geometry"] if p]
            for run in clip_polyline(metres, half_x, half_y):
                water.append(
                    {
                        "id": f"ws{element['id']}",
                        "name": tags.get("name", ""),
                        "kind": tags["waterway"],
                        "width": 6.0 if tags["waterway"] in ("river", "canal") else 2.5,
                        "line": flat(simplify(run, simplify_m)),
                    }
                )

    roads.sort(key=lambda r: (r["class"], r["id"]))
    buildings.sort(key=lambda b: -b["area"])

    named_roads = sorted({r["name"] for r in roads if r["name"]})
    return {
        "schema": "darsi-world-1.0",
        "place": {
            "name": "Darsi",
            "district": "Prakasam",
            "state": "Andhra Pradesh",
            "pin": "523247",
            "country": "India",
            "anchor": anchor,
        },
        "attribution": {
            "source": "OpenStreetMap",
            "license": "ODbL 1.0",
            "url": "https://www.openstreetmap.org/copyright",
            "fetched_at": raw.get("darsi_request", {}).get("fetched_at", ""),
            "osm_timestamp": raw.get("osm3s", {}).get("timestamp_osm_base", ""),
        },
        "world": {
            "half_extent_x": half_x,
            "half_extent_y": half_y,
            "projection": "equirectangular metres around the anchor; +x east, +y north",
        },
        "stats": {
            "roads": len(roads),
            "road_length_m": round(sum(_length(r["points"]) for r in roads), 1),
            "buildings": len(buildings),
            "water": len(water),
            "green": len(green),
            "pois": len(pois),
            "railways": len(railways),
            "walls": len(walls),
            "named_roads": named_roads,
        },
        "roads": roads,
        "buildings": buildings,
        "water": water,
        "green": green,
        "walls": walls,
        "railways": railways,
        "pois": pois,
    }


def _lane_width(tags: dict[str, str], fallback: float) -> float:
    try:
        lanes = float(tags["lanes"])
    except (KeyError, ValueError):
        return fallback
    return max(fallback, lanes * 3.2)


def _length(flat_points: list[float]) -> float:
    total = 0.0
    for i in range(2, len(flat_points), 2):
        total += math.hypot(flat_points[i] - flat_points[i - 2], flat_points[i + 1] - flat_points[i - 1])
    return total


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("data/osm/darsi_raw.json"))
    parser.add_argument("--output", type=Path, default=Path("data/darsi_world.json"))
    parser.add_argument("--half-x", type=float, default=2100.0)
    parser.add_argument("--half-y", type=float, default=2100.0)
    parser.add_argument("--simplify", type=float, default=0.75)
    args = parser.parse_args()

    raw = json.loads(args.input.read_text(encoding="utf-8"))
    world = convert(raw, args.half_x, args.half_y, args.simplify)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(world, separators=(",", ":")) + "\n", encoding="utf-8")
    stats = world["stats"]
    print(
        f"wrote {args.output}: {stats['roads']} road segments ({stats['road_length_m'] / 1000:.1f} km), "
        f"{stats['buildings']} buildings, {stats['water']} water, {stats['green']} green areas, {stats['pois']} POIs"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
