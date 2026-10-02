#!/usr/bin/env python3
"""Validates data/darsi_world.json against the real geography of Darsi, AP 523247.

Runs without Godot so the data contract is checked on every push.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORLD = ROOT / "data" / "darsi_world.json"

ANCHOR = (15.7667, 79.6833)

# Features that genuinely exist in Darsi and must survive the import.
REQUIRED_ROAD_NAMES = ["Podili - Vinukonda Road", "Darsi - Chimakurthy Road", "SH51"]
REQUIRED_POI_FRAGMENTS = ["APSRTC", "Darsi police station", "Jamal Hospital"]

failures: list[str] = []
checks = 0


def check(condition: bool, label: str) -> None:
    global checks
    checks += 1
    if condition:
        print(f"  PASS  {label}")
    else:
        failures.append(label)
        print(f"  FAIL  {label}")


def main() -> int:
    print("=== Darsi world manifest validation ===")
    check(WORLD.exists(), "data/darsi_world.json exists")
    if not WORLD.exists():
        return 1
    world = json.loads(WORLD.read_text(encoding="utf-8"))

    place = world["place"]
    check(place["name"] == "Darsi", "place name is Darsi")
    check(place["pin"] == "523247", "PIN is 523247")
    check(place["district"] == "Prakasam", "district is Prakasam")
    check(place["state"] == "Andhra Pradesh", "state is Andhra Pradesh")
    check(math.isclose(place["anchor"]["lat"], ANCHOR[0], abs_tol=0.01), "anchor latitude is Darsi's")
    check(math.isclose(place["anchor"]["lon"], ANCHOR[1], abs_tol=0.01), "anchor longitude is Darsi's")

    attribution = world["attribution"]
    check(attribution["source"] == "OpenStreetMap", "source is OpenStreetMap")
    check(attribution["license"] == "ODbL 1.0", "licence is ODbL 1.0")
    check(bool(attribution.get("osm_timestamp")), "the OSM database timestamp is recorded")

    roads = world["roads"]
    buildings = world["buildings"]
    check(len(roads) >= 120, f"at least 120 road segments ({len(roads)})")
    check(world["stats"]["road_length_m"] > 30000, f"over 30 km of road ({world['stats']['road_length_m'] / 1000:.1f} km)")
    check(len(buildings) >= 50, f"at least 50 OSM buildings ({len(buildings)})")
    check(len(world["pois"]) >= 20, f"at least 20 POIs ({len(world['pois'])})")
    check(len(world["water"]) >= 3, f"tanks/canals imported ({len(world['water'])})")

    names = {r["name"] for r in roads}
    for required in REQUIRED_ROAD_NAMES:
        check(required in names, f"road present: {required}")

    poi_names = " | ".join(p["name"] for p in world["pois"])
    for fragment in REQUIRED_POI_FRAGMENTS:
        check(fragment in poi_names, f"POI present: {fragment}")

    # Geometry sanity.
    half_x = world["world"]["half_extent_x"] + 120
    half_y = world["world"]["half_extent_y"] + 120
    strays = 0
    short = 0
    for road in roads:
        pts = road["points"]
        check_pairs = len(pts) % 2 == 0
        if not check_pairs:
            failures.append(f"road {road['id']} has an odd coordinate count")
        if len(pts) < 4:
            short += 1
        for i in range(0, len(pts) - 1, 2):
            if abs(pts[i]) > half_x or abs(pts[i + 1]) > half_y:
                strays += 1
    check(strays == 0, f"no road vertex escapes the extract ({strays} strays)")
    check(short == 0, f"every road has at least two vertices ({short} degenerate)")

    for building in buildings:
        if len(building["outline"]) < 6:
            failures.append(f"building {building['id']} has fewer than 3 corners")
            break
    check(all(len(b["outline"]) >= 6 for b in buildings), "every building footprint is a polygon")
    check(all(2.0 <= b["height"] <= 40.0 for b in buildings), "building heights are plausible")

    # The town centre must be built-up: roads within 300 m of the anchor.
    close = [r for r in roads if any(
        math.hypot(r["points"][i], r["points"][i + 1]) < 300 for i in range(0, len(r["points"]) - 1, 2)
    )]
    check(len(close) >= 10, f"the town centre has a dense street network ({len(close)} segments within 300 m)")

    print(f"\n=== {checks} checks, {len(failures)} failures ===")
    for failure in failures:
        print(f"  FAILED: {failure}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
