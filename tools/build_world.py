#!/usr/bin/env python3
"""Darsi world build -- turns real geodata into the runtime world package.

    python3 tools/build_world.py

Inputs
    data/osm/darsi_osm.json     Overpass extract (ODbL, (c) OpenStreetMap contributors)
    data/dem/darsi_dem.npz      SRTM-derived elevation (AWS Terrain Tiles / opentopodata)

Outputs (game/public/world/)
    meta.json       projection, bounds, provenance, statistics
    terrain.bin     float32 heightfield, row 0 = north
    ground.bin      uint8 ground-material ids, same grid
    urban.bin       uint8 urbanity field (0..255)
    network.json    classified road ribbons + routable graph
    buildings.json  real OSM footprints + generated plots
    areas.json      landuse / water / green polygons
    pois.json       named places and landmarks
    props.json      walls, mapped power lines, mapped street furniture

The build is deterministic: same inputs -> byte-identical outputs.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import struct
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from darsi.classify import (  # noqa: E402
    GROUND_DRY_EARTH,
    GROUND_FIELD,
    GROUND_GRASS,
    GROUND_SCRUB,
    GROUND_TOWN,
    GROUND_WATER_BED,
    LANDUSE_GROUND,
    NATURAL_GROUND,
    STOREY_H,
    classify_building,
)
from darsi.geo import (  # noqa: E402
    ANCHOR_LAT,
    ANCHOR_LON,
    Projector,
    dist,
    min_area_rect,
    poly_area,
    poly_centroid,
    point_in_poly,
    polyline_length,
    seg_point_dist,
)
from darsi.network import RoadNetwork  # noqa: E402
from darsi.osmread import read as read_osm  # noqa: E402
from darsi.rng import Rng, hash_f, hash_u32  # noqa: E402
from darsi.terrain import Dem, TerrainBuilder, limit_gradient  # noqa: E402
from darsi.urban import (  # noqa: E402
    COMMERCIAL_MIX,
    RESIDENTIAL_MIX,
    Occupancy,
    UrbanField,
    _mix_pick,
    building_height,
    storeys_for,
)

HALF = 4200.0          # playable half-extent in metres (8.4 km x 8.4 km)
TERRAIN_GRID = 769     # heightfield resolution -> ~10.9 m per cell
URBAN_GRID = 256

ROAD_URBAN_WEIGHT = {
    "highway": 0.35,
    "arterial": 0.55,
    "major": 0.8,
    "secondary": 1.0,
    "townroad": 1.15,
    "bazaar": 1.4,
    "residential": 1.3,
    "lane": 1.0,
    "farm": 0.08,
    "path": 0.15,
}

WATER_TAGS = ("water", "reservoir", "pond", "basin", "lake", "river", "stream", "canal", "drain", "ditch")


def r2(v):
    return round(float(v), 2)


def r1(v):
    return round(float(v), 1)


# ----------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--osm", default="data/osm/darsi_osm.json")
    ap.add_argument("--dem", default="data/dem/darsi_dem.npz")
    ap.add_argument("--out", default="game/public/world")
    ap.add_argument("--half", type=float, default=HALF)
    args = ap.parse_args()

    t0 = time.time()
    half = args.half
    proj = Projector(ANCHOR_LAT, ANCHOR_LON)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    osm_path = Path(args.osm)
    if not osm_path.exists():
        legacy = Path("data/osm/darsi_raw.json")
        if legacy.exists():
            print(f"!! {osm_path} missing, falling back to {legacy}")
            osm_path = legacy
        else:
            raise SystemExit(f"no OSM input at {osm_path}")
    osm = json.loads(osm_path.read_text())
    feats = read_osm(osm, proj)
    print(f"[1/9] OSM: {len(osm['elements'])} elements -> {len(feats)} tagged features  ({time.time()-t0:.1f}s)")

    provenance = {
        "osm": {
            "file": str(osm_path),
            "elements": len(osm["elements"]),
            "license": "ODbL 1.0",
            "attribution": "(c) OpenStreetMap contributors",
            "url": "https://www.openstreetmap.org/copyright",
            "osm3s": osm.get("osm3s", {}),
            "fetched_at": (osm.get("_darsi") or {}).get("fetched_at"),
        }
    }

    # ---------------------------------------------------------------- roads
    road_feats = [f for f in feats if f.osm_type == "way" and "highway" in f.tags]
    net = RoadNetwork()
    net.build(road_feats, half)
    net.weld(4.0)
    net.clip(half)
    net.refine(7.0)
    net.split_long(240.0)
    print(f"[2/9] roads: {len(net.edges)} edges, {len(net.nodes)} nodes, "
          f"{sum(polyline_length(e['pts']) for e in net.edges)/1000:.1f} km")

    # ---------------------------------------------------------------- areas
    areas = []
    water_polys = []
    field_polys = []
    for f in feats:
        if f.osm_type == "node" or not f.closed or len(f.pts) < 3:
            continue
        t = f.tags
        kind = None
        ground = None
        if t.get("natural") in NATURAL_GROUND:
            kind = "natural:" + t["natural"]
            ground = NATURAL_GROUND[t["natural"]]
        if t.get("landuse") in LANDUSE_GROUND:
            kind = "landuse:" + t["landuse"]
            ground = LANDUSE_GROUND[t["landuse"]]
        if t.get("leisure") in ("park", "pitch", "garden", "playground", "sports_centre"):
            kind = "leisure:" + t["leisure"]
            ground = GROUND_GRASS
        if t.get("water") or t.get("natural") == "water" or t.get("landuse") == "reservoir":
            kind = "water"
            ground = GROUND_WATER_BED
        if kind is None:
            continue
        a = abs(poly_area(f.pts))
        if a < 60:
            continue
        cx, cy = poly_centroid(f.pts)
        if abs(cx) > half + 600 or abs(cy) > half + 600:
            continue
        rec = {
            "id": f.ref,
            "kind": kind,
            "ground": ground,
            "name": t.get("name", ""),
            "area": r1(a),
            "poly": [[r1(p[0]), r1(p[1])] for p in f.pts],
        }
        areas.append(rec)
        if kind == "water":
            water_polys.append(f.pts)
        elif ground == GROUND_FIELD:
            field_polys.append(f.pts)
    areas.sort(key=lambda a: -a["area"])
    print(f"[3/9] areas: {len(areas)} polygons ({sum(1 for a in areas if a['kind']=='water')} water)")

    # waterways (linear canals / streams)
    waterways = []
    for f in feats:
        if f.osm_type != "way" or "waterway" not in f.tags:
            continue
        w = f.tags["waterway"]
        if w not in ("river", "stream", "canal", "drain", "ditch"):
            continue
        pts = [p for p in f.pts]
        if polyline_length(pts) < 25:
            continue
        waterways.append(
            {
                "id": f.ref,
                "kind": w,
                "name": f.tags.get("name", ""),
                "width": {"river": 14.0, "canal": 8.0, "stream": 4.0, "drain": 2.5, "ditch": 2.0}[w],
                "pts": [[r1(p[0]), r1(p[1])] for p in pts],
            }
        )

    # ---------------------------------------------------------------- terrain
    dem = None
    dem_path = Path(args.dem)
    if dem_path.exists():
        dem = Dem(str(dem_path))
        provenance["dem"] = dem.meta
    else:
        print("!! no DEM found -- terrain will be APPROXIMATED procedural relief")
        provenance["dem"] = {"source": "NOT AVAILABLE -- procedural fallback", "status": "APPROXIMATED"}

    terrain = TerrainBuilder(proj, half, TERRAIN_GRID, dem)
    terrain.build_base()
    print(f"[4/9] terrain base: {terrain.n}x{terrain.n} @ {terrain.cell:.2f} m  "
          f"range {float(terrain.h.min()):.1f}..{float(terrain.h.max()):.1f} m")

    # ground materials from land cover, painted coarse -> fine
    terrain.ground[:] = GROUND_DRY_EARTH
    for rec in areas:
        poly = [(p[0], p[1]) for p in rec["poly"]]
        terrain.stamp_polygon_ground(poly, rec["ground"])

    # carve the surveyed road network into the measured surface
    carve = []
    for e in net.edges:
        carve.append(
            {
                "pts": e["pts"],
                "width": e["width"],
                "shoulder": e["shoulder"] + 1.2,
                "blend": 10.0 if e["cls"] in ("highway", "arterial", "major") else 6.0,
                "smooth_passes": 10 if e["cls"] in ("highway", "arterial", "major") else 5,
                "max_grade": 0.055 if e["cls"] in ("highway", "arterial") else 0.085,
            }
        )
    terrain.carve_roads(carve)
    terrain.smooth(1)

    # water bodies get a dished bed so tanks read as tanks
    for rec in areas:
        if rec["kind"] != "water":
            continue
        poly = [(p[0], p[1]) for p in rec["poly"]]
        hs = [terrain.sample(p[0], p[1]) for p in poly]
        bed = min(hs) - min(2.6, max(0.8, math.sqrt(rec["area"]) * 0.035))
        terrain.flatten_polygon(poly, bed, blend=8.0)
        rec["water_level"] = r2(min(hs) - 0.35)
    terrain.smooth(1)

    # Second carve pass: smoothing and the water dishing partly undo the first
    # one, so re-impose the gradient-limited profiles on the settled surface.
    terrain.carve_roads(carve)

    # Final locking pass: sample what the surface actually is, limit the
    # gradient one last time, then carve to exactly that profile so the stored
    # road elevations and the terrain raster agree.
    final_profiles = []
    for e, r in zip(net.edges, carve):
        z = [terrain.sample(p[0], p[1]) for p in e["pts"]]
        final_profiles.append(limit_gradient(e["pts"], z, r["max_grade"]))
    terrain.carve_roads(carve, profiles=final_profiles)
    for e, z in zip(net.edges, final_profiles):
        e["z"] = [float(v) for v in z]

    worst = 0.0
    for e in net.edges:
        for i in range(len(e["pts"]) - 1):
            ds = math.hypot(e["pts"][i + 1][0] - e["pts"][i][0], e["pts"][i + 1][1] - e["pts"][i][1])
            if ds < 1.0:
                continue
            worst = max(worst, abs(e["z"][i + 1] - e["z"][i]) / ds)
    print(f"      steepest road gradient {worst * 100:.1f}%")
    print(f"[5/9] terrain carved; relief {float(terrain.h.min()):.1f}..{float(terrain.h.max()):.1f} m")

    # ---------------------------------------------------------------- urbanity
    urban = UrbanField(half)
    for e in net.edges:
        urban.add_road(e["pts"], ROAD_URBAN_WEIGHT.get(e["cls"], 0.5))

    osm_buildings = []
    for f in feats:
        t = f.tags
        if not (("building" in t) or ("building:part" in t)):
            continue
        if not f.closed or len(f.pts) < 3:
            continue
        a = abs(poly_area(f.pts))
        if a < 8:
            continue
        cx, cy = poly_centroid(f.pts)
        if abs(cx) > half or abs(cy) > half:
            continue
        osm_buildings.append(f)
        urban.add_building(cx, cy, a)

    for rec in areas:
        g = rec["ground"]
        score = 0.0
        if g == GROUND_TOWN:
            score = 1.0
        elif g in (GROUND_FIELD,):
            score = -0.8
        elif g == GROUND_WATER_BED:
            score = -1.0
        elif g == GROUND_SCRUB:
            score = -0.3
        if score:
            urban.add_area([(p[0], p[1]) for p in rec["poly"]], score)

    centres = []
    for f in feats:
        if f.osm_type == "node" and f.tags.get("place") in ("town", "village", "hamlet", "suburb", "neighbourhood"):
            r = {"town": 1500.0, "suburb": 700.0, "neighbourhood": 500.0, "village": 600.0, "hamlet": 280.0}[f.tags["place"]]
            s = {"town": 1.0, "suburb": 0.8, "neighbourhood": 0.7, "village": 0.75, "hamlet": 0.5}[f.tags["place"]]
            centres.append((f.pts[0][0], f.pts[0][1], r, s))
    if not centres:
        centres.append((0.0, 0.0, 1500.0, 1.0))
    urban.finalise(centres)
    print(f"[6/9] urbanity field {urban.n}x{urban.n}, {len(centres)} settlement centres, "
          f"{len(osm_buildings)} mapped footprints")

    # ---------------------------------------------------------------- POIs
    pois = []
    poi_index = []
    for f in feats:
        t = f.tags
        cat = None
        if t.get("amenity"):
            cat = "amenity:" + t["amenity"]
        elif t.get("shop"):
            cat = "shop:" + t["shop"]
        elif t.get("tourism"):
            cat = "tourism:" + t["tourism"]
        elif t.get("historic"):
            cat = "historic:" + t["historic"]
        elif t.get("office"):
            cat = "office:" + t["office"]
        elif t.get("healthcare"):
            cat = "healthcare:" + t["healthcare"]
        elif t.get("place"):
            cat = "place:" + t["place"]
        elif t.get("man_made") in ("water_tower", "tower", "mast", "storage_tank", "water_well"):
            cat = "man_made:" + t["man_made"]
        elif t.get("railway") == "station":
            cat = "railway:station"
        if cat is None:
            continue
        if f.osm_type == "node":
            x, y = f.pts[0]
        else:
            x, y = poly_centroid(f.pts)
        if abs(x) > half or abs(y) > half:
            continue
        pois.append(
            {
                "id": f.ref,
                "cat": cat,
                "name": t.get("name", ""),
                "name_te": t.get("name:te", ""),
                "x": r1(x),
                "y": r1(y),
                "religion": t.get("religion", ""),
                "operator": t.get("operator", ""),
            }
        )
        poi_index.append((x, y, cat, t.get("name", "")))
    print(f"[7/9] POIs: {len(pois)}")

    # ---------------------------------------------------------------- buildings
    buildings = []
    occ = Occupancy(half, 2.0)

    # keep plots out of carriageways, water and mapped areas we must not build on
    for e in net.edges:
        occ.mark_corridor(e["pts"], e["width"] * 0.5 + e["shoulder"] + 0.6)
    for w in waterways:
        occ.mark_corridor([(p[0], p[1]) for p in w["pts"]], w["width"] * 0.5 + 2.0)
    for rec in areas:
        if rec["kind"] == "water":
            occ.mark_poly([(p[0], p[1]) for p in rec["poly"]], pad=3.0)

    bid = 0
    name_poi = {}
    for p in poi_index:
        name_poi[(round(p[0], 1), round(p[1], 1))] = p

    for f in osm_buildings:
        cx, cy, w, d, ang = min_area_rect(f.pts)
        a = abs(poly_area(f.pts))
        u = urban.at(cx, cy)
        cat = classify_building(f.tags)
        rng = Rng(hash_u32(f.osm_id, 0x51A3))
        if cat is None:
            cat = _infer_category(a, u, w, d, rng)

        # A footprint this large is a *site*, not a single structure -- OSM
        # mappers routinely trace a whole campus as one `building` way. Drawing
        # it as one extruded box would put a 190 m shed in the middle of town.
        # Render it as a walled compound with real blocks inside instead.
        if a > 2200 and min(w, d) > 18:
            site, inner = _compound_site(bid, f, (cx, cy, w, d, ang), a, u, cat, terrain, rng)
            buildings.append(site)
            bid += 1
            for b in inner:
                b["id"] = bid
                bid += 1
                buildings.append(b)
            occ.mark_poly([(p[0], p[1]) for p in f.pts], pad=1.0)
            continue
        name = f.tags.get("name", "")
        levels = None
        try:
            if f.tags.get("building:levels"):
                levels = max(1, min(8, int(float(f.tags["building:levels"]))))
        except ValueError:
            levels = None
        if levels is None:
            levels = storeys_for(cat, u, rng, a)
        body, parapet = building_height(cat, levels, rng)
        try:
            if f.tags.get("height"):
                body = max(2.2, min(40.0, float(str(f.tags["height"]).split()[0])))
        except ValueError:
            pass
        poly = [(p[0], p[1]) for p in f.pts]
        gy = min(terrain.sample(p[0], p[1]) for p in poly)
        buildings.append(
            _building_record(
                bid, "osm", f.ref, cat, name, poly, (cx, cy, w, d, ang), gy, levels, body, parapet, u, rng, f.tags
            )
        )
        occ.mark_poly(poly, pad=1.0)
        bid += 1

    n_osm = len(buildings)

    # ---- places of worship ---------------------------------------------------
    # Mapped ones keep their surveyed position and name (REAL DATA).  Darsi's
    # OSM coverage only has a single worship node, so a small number of
    # neighbourhood temples are also generated -- deliberately unnamed, and
    # recorded as PROCEDURAL in docs/world-accuracy.md.  We never invent a name
    # for a real landmark.
    worship = _place_worship(net, urban, occ, terrain, water_polys, half, poi_index, centres)
    n_worship_real = sum(1 for w in worship if w["src"] == "osm")
    for g in worship:
        g["id"] = bid
        bid += 1
        buildings.append(g)

    # ---- generated plots along real streets ---------------------------------
    gen = _generate_plots(net, urban, occ, terrain, water_polys, half)
    for g in gen:
        g["id"] = bid
        bid += 1
        buildings.append(g)
    print(f"[8/9] buildings: {n_osm} from OSM + {len(worship)} worship "
          f"({n_worship_real} surveyed) + {len(gen)} generated = {len(buildings)}")

    # ---------------------------------------------------------------- props
    walls = []
    for f in feats:
        if f.osm_type != "way" or "barrier" not in f.tags:
            continue
        if f.tags["barrier"] not in ("wall", "fence", "hedge", "retaining_wall", "city_wall"):
            continue
        pts = f.pts + ([f.pts[0]] if f.closed else [])
        if polyline_length(pts) < 6:
            continue
        walls.append(
            {
                "id": f.ref,
                "kind": f.tags["barrier"],
                "h": 1.9 if f.tags["barrier"] in ("wall", "city_wall", "retaining_wall") else 1.4,
                "pts": [[r1(p[0]), r1(p[1])] for p in pts],
            }
        )

    power = []
    for f in feats:
        if f.osm_type != "way" or f.tags.get("power") not in ("line", "minor_line"):
            continue
        power.append(
            {
                "id": f.ref,
                "kind": f.tags["power"],
                "pts": [[r1(p[0]), r1(p[1])] for p in f.pts],
            }
        )
    power_nodes = [
        {"x": r1(f.pts[0][0]), "y": r1(f.pts[0][1]), "kind": f.tags["power"]}
        for f in feats
        if f.osm_type == "node" and f.tags.get("power") in ("tower", "pole", "transformer", "substation")
    ]

    railways = []
    for f in feats:
        if f.osm_type != "way" or f.tags.get("railway") not in ("rail", "disused", "abandoned", "construction"):
            continue
        railways.append({"id": f.ref, "kind": f.tags["railway"], "pts": [[r1(p[0]), r1(p[1])] for p in f.pts]})

    calming = [
        {"x": r1(f.pts[0][0]), "y": r1(f.pts[0][1]), "kind": f.tags.get("traffic_calming", "hump")}
        for f in feats
        if f.osm_type == "node" and "traffic_calming" in f.tags
    ]

    # ---------------------------------------------------------------- write
    out.mkdir(parents=True, exist_ok=True)
    (out / "terrain.bin").write_bytes(terrain.h.astype("<f4").tobytes())
    (out / "ground.bin").write_bytes(terrain.ground.astype(np.uint8).tobytes())

    uimg = _resample_u8(urban.value, URBAN_GRID)
    (out / "urban.bin").write_bytes(uimg.tobytes())

    network_json = {
        "nodes": [[r1(n["x"]), r1(n["y"]), r2(terrain.sample(n["x"], n["y"]))] for n in net.nodes],
        "edges": [
            {
                "i": e["id"],
                "a": e["a"],
                "b": e["b"],
                "cls": e["cls"],
                "name": e["name"],
                "w": r2(e["width"]),
                "sh": r2(e["shoulder"]),
                "ln": e["lanes"],
                "sf": e["surface"],
                "q": r2(e["quality"]),
                "mk": e["markings"],
                "sp": e["speed"],
                "ow": 1 if e["oneway"] else 0,
                "br": 1 if e["bridge"] else 0,
                "sd": r2(e["seed"]),
                "p": [[r1(p[0]), r1(p[1]), r2(z)] for p, z in zip(e["pts"], e["z"])],
            }
            for e in net.edges
        ],
    }
    _dump(out / "network.json", network_json)
    _dump(out / "buildings.json", {"buildings": buildings})
    _dump(out / "areas.json", {"areas": areas, "waterways": waterways})
    _dump(out / "pois.json", {"pois": pois})
    _dump(out / "props.json", {"walls": walls, "power": power, "power_nodes": power_nodes,
                               "railways": railways, "traffic_calming": calming})

    cls_counter = Counter(e["cls"] for e in net.edges)
    cat_counter = Counter(b["cat"] for b in buildings)
    lv_counter = Counter(b["lv"] for b in buildings)
    spawn = _choose_spawn(net, terrain)

    meta = {
        "schema": "darsi-world-2",
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "place": {
            "name": "Darsi",
            "name_te": "దర్శి",
            "district": "Prakasam",
            "state": "Andhra Pradesh",
            "country": "India",
            "pin": "523247",
        },
        "anchor": {"lat": ANCHOR_LAT, "lon": ANCHOR_LON},
        "projection": {
            "kind": "equirectangular-local-metres",
            "mx": proj.mx,
            "my": proj.my,
            "note": "x = metres east of anchor, y = metres north of anchor",
        },
        "half_extent": half,
        "terrain": {
            "grid": TERRAIN_GRID,
            "cell": terrain.cell,
            "min": r2(float(terrain.h.min())),
            "max": r2(float(terrain.h.max())),
            "mean": r2(float(terrain.h.mean())),
            "relief": r2(float(terrain.h.max() - terrain.h.min())),
            "dem_source": provenance["dem"].get("source", "unknown"),
        },
        "urban": {"grid": URBAN_GRID},
        "spawn": spawn,
        "stats": {
            "road_edges": len(net.edges),
            "road_nodes": len(net.nodes),
            "road_km": round(sum(polyline_length(e["pts"]) for e in net.edges) / 1000.0, 2),
            "road_classes": dict(cls_counter),
            "buildings_total": len(buildings),
            "buildings_osm": n_osm,
            "buildings_generated": len(gen),
            "building_categories": dict(cat_counter),
            "building_levels": {str(k): v for k, v in sorted(lv_counter.items())},
            "areas": len(areas),
            "water_areas": sum(1 for a in areas if a["kind"] == "water"),
            "waterways": len(waterways),
            "pois": len(pois),
            "walls": len(walls),
            "power_lines": len(power),
            "railways": len(railways),
        },
        "provenance": provenance,
    }
    _dump(out / "meta.json", meta)

    total = sum((out / f).stat().st_size for f in os.listdir(out))
    print(f"[9/9] wrote {out} ({total/1e6:.2f} MB) in {time.time()-t0:.1f}s")
    print(json.dumps(meta["stats"], indent=2)[:2200])
    return 0


# ----------------------------------------------------------------------------


def _resample_u8(field: np.ndarray, n: int) -> np.ndarray:
    src = field.shape[0]
    idx = np.clip((np.arange(n) * (src - 1) / (n - 1)).round().astype(int), 0, src - 1)
    sub = field[np.ix_(idx, idx)]
    return np.clip(sub * 255.0, 0, 255).astype(np.uint8)


def _dump(path: Path, obj):
    path.write_text(json.dumps(obj, separators=(",", ":"), sort_keys=False))


def _infer_category(area: float, u: float, w: float, d: float, rng: Rng) -> str:
    """OSM `building=yes` with no other hint -- decide from size and context."""
    if area < 16:
        return "shed"
    if area < 34:
        return "hut" if u < 0.45 else "shop"
    if area > 1400:
        return "warehouse" if u < 0.55 else "civic"
    if area > 600:
        return "school" if rng.chance(0.3) else ("commercial" if u > 0.55 else "warehouse")
    if u > 0.62 and min(w, d) < 9.0 and max(w, d) / max(1e-3, min(w, d)) > 1.5:
        return _mix_pick(COMMERCIAL_MIX, u, rng.f())
    return _mix_pick(RESIDENTIAL_MIX, u, rng.f())


def _building_record(bid, src, ref, cat, name, poly, rect, gy, levels, body, parapet, u, rng, tags=None):
    cx, cy, w, d, ang = rect
    rec = {
        "id": bid,
        "src": src,
        "cat": cat,
        "x": r1(cx),
        "y": r1(cy),
        "w": r2(max(1.5, w)),
        "d": r2(max(1.5, d)),
        "a": round(ang, 4),
        "g": r2(gy),
        "lv": int(levels),
        "h": r2(body),
        "pp": r2(parapet),
        "u": round(u, 3),
        "sd": hash_u32(bid, 0x7F4A) % 65536,
    }
    if name:
        rec["n"] = name
    if src == "osm":
        rec["ref"] = ref
        if len(poly) <= 24:
            rec["poly"] = [[r1(p[0]), r1(p[1])] for p in poly]
    if tags:
        for k in ("religion", "denomination", "operator", "amenity", "shop", "name:te"):
            if tags.get(k):
                rec.setdefault("t", {})[k] = tags[k]
    return rec


# ----------------------------------------------------------------------------


SITE_INNER_CATEGORY = {
    "school": "school",
    "hospital": "hospital",
    "government": "government",
    "civic": "civic",
    "warehouse": "warehouse",
    "industrial": "warehouse",
    "unfinished": "unfinished",
    "commercial": "commercial",
}


def _compound_site(bid, f, rect, area, u, cat, terrain, rng):
    """Turn an oversized OSM footprint into a walled site with real blocks."""
    cx, cy, w, d, ang = rect
    poly = [(p[0], p[1]) for p in f.pts]
    gy = min(terrain.sample(p[0], p[1]) for p in poly)
    name = f.tags.get("name", "")

    site = {
        "id": bid,
        "src": "osm",
        "ref": f.ref,
        "cat": "compound",
        "x": r1(cx),
        "y": r1(cy),
        "w": r2(w),
        "d": r2(d),
        "a": round(ang, 4),
        "g": r2(gy),
        "lv": 0,
        "h": 2.3,
        "pp": 0.0,
        "u": round(u, 3),
        "sd": hash_u32(f.osm_id, 0x2C0D) % 65536,
    }
    if name:
        site["n"] = name
    if len(poly) <= 48:
        site["poly"] = [[r1(p[0]), r1(p[1])] for p in poly]

    inner_cat = SITE_INNER_CATEGORY.get(cat, "commercial")
    # a handful of blocks laid out along the long axis, inside the boundary
    n = max(2, min(6, int(round(area / 1400.0))))
    ca, sa = math.cos(ang), math.sin(ang)
    long_w = max(w, d)
    short_d = min(w, d)
    along = ca, sa
    across = -sa, ca
    if d > w:
        along, across = across, (-across[0], -across[1])
        long_w, short_d = max(w, d), min(w, d)

    out = []
    usable = long_w - 18.0
    if usable <= 10:
        return site, out
    for i in range(n):
        t = (i + 0.5) / n
        off = (t - 0.5) * usable
        lateral = rng.range(-0.18, 0.18) * short_d
        bx = cx + along[0] * off + across[0] * lateral
        by = cy + along[1] * off + across[1] * lateral
        bw = min(usable / n * rng.range(0.55, 0.8), 26.0)
        bd = min(short_d * rng.range(0.3, 0.5), 22.0)
        if bw < 5 or bd < 5:
            continue
        levels = storeys_for(inner_cat, u, rng, bw * bd)
        body, parapet = building_height(inner_cat, levels, rng)
        byy = min(
            terrain.sample(bx + ox, by + oy)
            for ox, oy in ((-bw * 0.45, 0), (bw * 0.45, 0), (0, -bd * 0.45), (0, bd * 0.45), (0, 0))
        )
        rec = _building_record(
            0, "gen", "", inner_cat, "", [], (bx, by, bw, bd, ang), byy, levels, body, parapet, u, rng
        )
        rec["sd"] = hash_u32(f.osm_id, i, 0x11AB) % 65536
        rec["site"] = f.ref
        out.append(rec)
    return site, out


def _nearest_edge(net, x, y, max_dist=140.0):
    """Closest point on the surveyed network: (edge, px, py, tangent, dist)."""
    best = None
    for e in net.edges:
        pts = e["pts"]
        for i in range(len(pts) - 1):
            ax, ay = pts[i]
            bx, by = pts[i + 1]
            dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy
            if L2 < 1e-9:
                continue
            t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L2))
            cx, cy = ax + t * dx, ay + t * dy
            d = math.hypot(x - cx, y - cy)
            if d > max_dist:
                continue
            if best is None or d < best[4]:
                L = math.sqrt(L2)
                best = (e, cx, cy, (dx / L, dy / L), d)
    return best


def _worship_record(bid, src, ref, cat, name, rect, terrain, u, rng, tags=None):
    cx, cy, w, d, ang = rect
    gy = min(
        terrain.sample(cx + ox, cy + oy)
        for ox, oy in ((-w * 0.45, 0), (w * 0.45, 0), (0, -d * 0.45), (0, d * 0.45), (0, 0))
    )
    levels = 1
    body, parapet = building_height(cat, levels, rng)
    rec = _building_record(bid, src, ref, cat, name, [], rect, gy, levels, body, parapet, u, rng, tags)
    return rec


def _place_worship(net, urban, occ, terrain, water_polys, half, poi_index, centres):
    """Temples, mosques and churches as real 3D structures.

    1. Every mapped place of worship becomes a building at its surveyed
       position, oriented to the street it stands on, keeping its OSM name.
    2. A modest number of unnamed neighbourhood temples are generated near the
       settlement centres, because a mandal headquarters without a single
       visible temple would be a worse lie than an honestly-labelled generated
       one.  These carry no name and are documented as PROCEDURAL.
    """
    out = []

    def place(x, y, cat, name, src, ref, size_scale, seed):
        rng = Rng(seed)
        near = _nearest_edge(net, x, y, 160.0)
        if near is None:
            return False
        e, px, py, (tx, ty), dist = near
        ang = math.atan2(ty, tx)
        half_road = e["width"] * 0.5 + e["shoulder"]
        # which side of the road is the site on?
        nx, ny = -ty, tx
        side = 1.0 if ((x - px) * nx + (y - py) * ny) >= 0 else -1.0
        nx, ny = nx * side, ny * side
        if side < 0:
            ang += math.pi

        base_w = rng.range(9.0, 14.0) * size_scale
        base_d = rng.range(11.0, 17.0) * size_scale
        for attempt in range(7):
            w = base_w * (1.0 - attempt * 0.08)
            d = base_d * (1.0 - attempt * 0.08)
            if w < 5.0 or d < 5.5:
                return False
            setback = rng.range(2.5, 7.0) + attempt * 1.5
            cx = px + nx * (half_road + setback + d * 0.5)
            cy = py + ny * (half_road + setback + d * 0.5)
            if abs(cx) > half - 30 or abs(cy) > half - 30:
                return False
            if any(point_in_poly(cx, cy, wp) for wp in water_polys):
                return False
            if not occ.test_box(cx, cy, w + 4.0, d + 4.0, ang, pad=0.8):
                continue
            hs = [
                terrain.sample(cx + dx, cy + dy)
                for dx, dy in ((-w * 0.45, 0), (w * 0.45, 0), (0, -d * 0.45), (0, d * 0.45), (0, 0))
            ]
            if max(hs) - min(hs) > 3.0:
                continue
            occ.mark_box(cx, cy, w + 4.0, d + 4.0, ang, pad=0.5)
            u = urban.at(cx, cy)
            rec = _worship_record(0, src, ref, cat, name, (cx, cy, w, d, ang), terrain, u, Rng(seed ^ 0x9E37))
            rec["sd"] = seed % 65536
            rec["pl"] = [r2(w + 4.0), r2(d + 4.0), r2(setback), r2(half_road)]
            rec["wl"] = 1
            rec["fx"] = r1(px)
            rec["fy"] = r1(py)
            rec["rd"] = e["id"]
            out.append(rec)
            return True
        return False

    # ---- 1. surveyed places of worship --------------------------------------
    for x, y, cat, name in poi_index:
        if cat != "amenity:place_of_worship":
            continue
        kind = "temple"
        place(x, y, kind, name, "osm", "", 1.25, hash_u32(int(x * 10), int(y * 10), 0x7071))

    # ---- 2. neighbourhood temples -------------------------------------------
    # One per settlement centre plus a few more in the denser streets, capped
    # so the town never looks like a temple theme park.
    target = 0
    for cx, cy, radius, strength in centres:
        target += 1 if strength < 0.7 else 3
    target = min(target, 26)

    placed = 0
    ranked = sorted(centres, key=lambda c: -c[3])
    for ci, (ccx, ccy, radius, strength) in enumerate(ranked):
        want = 3 if strength >= 0.7 else 1
        got = 0
        for attempt in range(220):
            if got >= want or placed >= target:
                break
            r = Rng(hash_u32(ci, attempt, 0x7E3D))
            ang = r.f() * math.tau
            dist = radius * 0.12 * math.sqrt(r.f()) * 2.4
            x = ccx + math.cos(ang) * dist
            y = ccy + math.sin(ang) * dist
            if urban.at(x, y) < 0.28:
                continue
            if place(x, y, "temple", "", "gen", "", 0.78 + 0.3 * strength,
                     hash_u32(ci, attempt, 0x3311)):
                got += 1
                placed += 1
    return out


def _generate_plots(net, urban, occ, terrain, water_polys, half):
    """Lay deterministic street-facing plots along the surveyed road network.

    Only inside the measured built-up envelope; never on a real footprint,
    a carriageway or water.  Marked src="gen" in the output.
    """
    out = []
    main_classes = ("highway", "arterial", "major", "secondary", "townroad", "bazaar")
    buildable = ("arterial", "major", "secondary", "townroad", "bazaar", "residential", "lane")

    edges = sorted(net.edges, key=lambda e: e["id"])
    for e in edges:
        if e["cls"] not in buildable:
            continue
        pts = e["pts"]
        L = polyline_length(pts)
        if L < 14:
            continue
        half_road = e["width"] * 0.5 + e["shoulder"]
        commercial_road = e["cls"] in main_classes
        for side in (-1, 1):
            s = 3.0 + hash_f(e["id"], side, 11) * 6.0
            guard = 0
            while s < L - 6.0 and guard < 400:
                guard += 1
                px, py, tx, ty = _at_arclength(pts, s)
                nx, ny = -ty * side, tx * side
                u = urban.at(px + nx * 12, py + ny * 12)
                if u < 0.17:
                    s += 14.0
                    continue
                k = hash_u32(e["id"], side, int(s * 4), 0xBEE5)
                r = Rng(k)

                dense = u
                frontage = r.range(16.0, 26.0) - dense * r.range(5.0, 12.0)
                frontage = max(6.0, frontage)
                depth = r.range(13.0, 26.0) - dense * 3.0
                setback = max(0.4, r.range(0.5, 7.5) * (1.0 - 0.72 * dense))
                if commercial_road and dense > 0.5:
                    setback = r.range(0.2, 1.8)

                # probability that this slot is actually occupied
                p_build = 0.12 + 1.05 * dense
                if e["cls"] in ("lane",):
                    p_build *= 0.85
                if not r.chance(min(0.97, p_build)):
                    s += frontage + r.range(1.0, 7.0)
                    continue

                cdist = half_road + setback + depth * 0.5
                cx = px + nx * cdist
                cy = py + ny * cdist
                if abs(cx) > half - 20 or abs(cy) > half - 20:
                    s += frontage
                    continue
                # The renderer treats local +Z as the street-facing side, and
                # local +Z maps to the road only for side = +1 -- so plots on
                # the other side of the street must be turned around or every
                # shopfront on that side would face its own back yard.
                ang = math.atan2(ty, tx)
                if side == -1:
                    ang += math.pi

                if any(point_in_poly(cx, cy, wp) for wp in water_polys):
                    s += frontage
                    continue
                if not occ.test_box(cx, cy, frontage, depth, ang, pad=0.6):
                    s += r.range(3.0, 8.0)
                    continue

                # terrain must not be a cliff under the plot
                hs = [
                    terrain.sample(cx + dx, cy + dy)
                    for dx, dy in ((-frontage * 0.4, 0), (frontage * 0.4, 0), (0, -depth * 0.4), (0, depth * 0.4), (0, 0))
                ]
                if max(hs) - min(hs) > 3.4:
                    s += frontage
                    continue

                occ.mark_box(cx, cy, frontage, depth, ang, pad=0.3)

                # --- the structure inside the plot -------------------------
                if commercial_road and dense > 0.42:
                    cat = _mix_pick(COMMERCIAL_MIX, dense, r.f())
                    if r.chance(0.26):
                        cat = _mix_pick(RESIDENTIAL_MIX, dense, r.f())
                else:
                    cat = _mix_pick(RESIDENTIAL_MIX, dense, r.f())
                    if commercial_road and r.chance(0.22):
                        cat = _mix_pick(COMMERCIAL_MIX, dense, r.f())

                side_gap = r.range(0.2, 2.2) * (1.0 - 0.5 * dense)
                bw = max(4.0, frontage - side_gap * 2.0)
                bd_frac = r.range(0.42, 0.82)
                if cat in ("shop", "shophouse", "commercial"):
                    bd_frac = r.range(0.5, 0.9)
                bd = max(4.0, depth * bd_frac)
                # front-aligned: the building sits at the street end of the plot
                front_off = (depth - bd) * 0.5
                bx = px + nx * (half_road + setback + bd * 0.5)
                by = py + ny * (half_road + setback + bd * 0.5)

                gy = min(
                    terrain.sample(bx + ox, by + oy)
                    for ox, oy in ((-bw * 0.45, 0), (bw * 0.45, 0), (0, -bd * 0.45), (0, bd * 0.45), (0, 0))
                )
                area = bw * bd
                levels = storeys_for(cat, dense, r, area)
                body, parapet = building_height(cat, levels, r)

                rec = _building_record(
                    0, "gen", "", cat, "", [], (bx, by, bw, bd, ang), gy, levels, body, parapet, dense, r
                )
                rec["sd"] = k % 65536
                # compound wall + gate when the setback allows one
                wall = 0
                if setback > 2.2 and cat in ("house", "house_large", "house_two", "apartment", "unfinished") and r.chance(0.3 + 0.45 * dense):
                    wall = 1
                rec["pl"] = [r2(frontage), r2(depth), r2(setback), r2(half_road)]
                rec["wl"] = wall
                rec["fx"] = r2(px)
                rec["fy"] = r2(py)
                rec["rd"] = e["id"]
                out.append(rec)

                s += frontage + r.range(0.4, 3.2) * (1.0 - 0.6 * dense)
    return out


def _at_arclength(pts, s):
    acc = 0.0
    for i in range(len(pts) - 1):
        ax, ay = pts[i]
        bx, by = pts[i + 1]
        L = math.hypot(bx - ax, by - ay)
        if L < 1e-9:
            continue
        if acc + L >= s:
            t = (s - acc) / L
            return (ax + (bx - ax) * t, ay + (by - ay) * t, (bx - ax) / L, (by - ay) / L)
        acc += L
    ax, ay = pts[-2]
    bx, by = pts[-1]
    L = max(1e-9, math.hypot(bx - ax, by - ay))
    return (bx, by, (bx - ax) / L, (by - ay) / L)


def _choose_spawn(net, terrain):
    """Spawn on the busiest surveyed road closest to the town centre."""
    best = None
    for e in net.edges:
        if e["cls"] not in ("major", "secondary", "arterial", "townroad"):
            continue
        mid = e["pts"][len(e["pts"]) // 2]
        d = math.hypot(mid[0], mid[1])
        score = d - {"arterial": 260, "major": 200, "secondary": 120, "townroad": 60}[e["cls"]]
        if best is None or score < best[0]:
            i = len(e["pts"]) // 2
            a = e["pts"][max(0, i - 1)]
            b = e["pts"][min(len(e["pts"]) - 1, i + 1)]
            heading = math.atan2(b[1] - a[1], b[0] - a[0])
            best = (score, mid[0], mid[1], heading, e["id"], e["name"])
    if best is None:
        return {"x": 0.0, "y": 0.0, "z": r2(terrain.sample(0, 0)), "heading": 0.0}
    _, x, y, h, eid, name = best
    # sit in the left-hand lane (India drives on the left)
    return {"x": r1(x), "y": r1(y), "z": r2(terrain.sample(x, y)), "heading": round(h, 4), "edge": eid, "road": name}


if __name__ == "__main__":
    sys.exit(main())
