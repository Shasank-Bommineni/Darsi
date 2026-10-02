#!/usr/bin/env python3
"""Import a reviewed, legally usable OpenStreetMap XML extract into Darsi's JSON manifest.

This is deliberately small and dependency-free so map regeneration works on a clean
machine. It does not download data and does not import imagery.
"""
from __future__ import annotations

import argparse
import copy
import json
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROAD_CLASSES = {
    "motorway": "highway",
    "motorway_link": "highway",
    "trunk": "highway",
    "trunk_link": "highway",
    "primary": "highway",
    "primary_link": "highway",
    "secondary": "arterial",
    "secondary_link": "arterial",
    "tertiary": "collector",
    "tertiary_link": "collector",
    "unclassified": "neighbourhood",
    "residential": "neighbourhood",
    "service": "lane",
    "living_street": "lane",
    "track": "lane",
}
LANDMARK_KEYS = ("amenity", "shop", "tourism", "historic", "man_made")


def tags(element: ET.Element) -> dict[str, str]:
    return {tag.attrib.get("k", ""): tag.attrib.get("v", "") for tag in element.findall("tag")}


def parse_osm(path: Path, center: tuple[float, float]) -> tuple[list[dict], list[dict]]:
    root = ET.parse(path).getroot()
    nodes: dict[str, tuple[float, float]] = {}
    roads: list[dict] = []
    landmarks: list[dict] = []
    for node in root.findall("node"):
        node_id = node.attrib.get("id")
        if not node_id:
            continue
        lat = float(node.attrib["lat"])
        lon = float(node.attrib["lon"])
        nodes[node_id] = (lat, lon)
        node_tags = tags(node)
        if any(node_tags.get(key) for key in LANDMARK_KEYS):
            kind = next((node_tags.get(key) for key in LANDMARK_KEYS if node_tags.get(key)), "place")
            name = node_tags.get("name") or node_tags.get("brand") or kind.replace("_", " ").title()
            landmarks.append(
                {
                    "id": f"osm_{node_id}",
                    "name": name,
                    "kind": kind,
                    "lat": lat,
                    "lon": lon,
                    "status": "imported OSM point; visual representation is procedural",
                    "osm_id": node_id,
                }
            )
    for way in root.findall("way"):
        way_tags = tags(way)
        highway = way_tags.get("highway")
        if highway not in ROAD_CLASSES:
            continue
        points = []
        missing = False
        for ref in way.findall("nd"):
            node_id = ref.attrib.get("ref")
            if node_id not in nodes:
                missing = True
                break
            points.append(list(nodes[node_id]))
        if missing or len(points) < 2:
            print(f"warning: skipped way {way.attrib.get('id', '?')} with missing/short geometry", file=sys.stderr)
            continue
        name = way_tags.get("name") or way_tags.get("ref") or f"OSM {highway}"
        roads.append(
            {
                "id": f"osm_way_{way.attrib.get('id', 'unknown')}",
                "name": name,
                "class": ROAD_CLASSES[highway],
                "source_status": "imported from reviewed OpenStreetMap geometry",
                "verified_source": "openstreetmap",
                "osm_id": way.attrib.get("id"),
                "points": points,
            }
        )
    print(f"parsed {len(roads)} roads and {len(landmarks)} landmark points from {path}", file=sys.stderr)
    return roads, landmarks


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="reviewed .osm XML extract")
    parser.add_argument("--base", required=True, type=Path, help="starter or previously reviewed manifest")
    parser.add_argument("--output", required=True, type=Path, help="new JSON manifest")
    parser.add_argument("--center", nargs=2, type=float, metavar=("LAT", "LON"), default=(15.7667, 79.6833))
    args = parser.parse_args()
    if not args.input.exists():
        parser.error(f"input does not exist: {args.input}")
    if not args.base.exists():
        parser.error(f"base manifest does not exist: {args.base}")

    base = json.loads(args.base.read_text(encoding="utf-8"))
    roads, landmarks = parse_osm(args.input, tuple(args.center))
    output = copy.deepcopy(base)
    output.setdefault("provenance", {})
    output["provenance"]["imported_source"] = "OpenStreetMap XML; review source and attribution before shipping"
    output["provenance"]["import_center"] = {"lat": args.center[0], "lon": args.center[1]}
    output["provenance"]["verified"] = list(output["provenance"].get("verified", [])) + [
        "road centerlines imported from a reviewed OpenStreetMap extract",
    ]
    output["provenance"]["procedural_or_unverified"] = list(output["provenance"].get("procedural_or_unverified", [])) + [
        "visual building geometry generated from imported locations",
    ]
    output["roads"] = roads
    # Keep gameplay landmarks which are not in the extract only if they have not been replaced
    # by an OSM point with the same id. This makes the import useful without deleting authored tasks.
    existing = [landmark for landmark in output.get("landmarks", []) if not str(landmark.get("id", "")).startswith("osm_")]
    output["landmarks"] = existing + landmarks
    output["place"]["anchor"] = {"lat": args.center[0], "lon": args.center[1]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
