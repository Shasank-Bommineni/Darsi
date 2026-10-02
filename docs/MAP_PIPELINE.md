# Map pipeline

How the real geography of Darsi gets from OpenStreetMap into the game, and exactly which
parts of the world are real and which are generated.

## 1. Extract — `tools/fetch_darsi_osm.py`

Issues a single Overpass QL query for a 4.4 km × 4.4 km window centred on the town node at
**15.7667 N, 79.6833 E** and writes the verbatim answer to `data/osm/darsi_raw.json`.

```
[out:json][timeout:600];
(
  way["highway"](bbox);  way["building"](bbox);  way["waterway"](bbox);
  way["natural"](bbox);  way["landuse"](bbox);   way["leisure"](bbox);
  way["amenity"](bbox);  way["man_made"](bbox);  way["barrier"](bbox);
  way["railway"](bbox);  node["place"](bbox);    node["amenity"](bbox);
  node["shop"](bbox);    node["tourism"](bbox);  node["historic"](bbox);
  ... relations for building/natural/landuse/waterway ...
);
out tags geom;
```

The script tries five public Overpass endpoints in turn with back-off, because the main
instance is frequently busy. It runs from `.github/workflows/fetch-osm.yml`, which commits
the result back to the branch.

## 2. Convert — `tools/build_world.py`

Produces `data/darsi_world.json` (schema `darsi-world-1.0`). What it does:

* **Projection.** Equirectangular metres about the anchor: `east = (lon − lon0)·111320·cos(lat0)`,
  `north = (lat − lat0)·110574`. At this latitude and over 4 km the error is well under a metre.
* **Clipping.** Polylines are clipped to the playable rectangle, with the crossing point
  found by bisection so roads stop exactly on the border instead of jumping to a vertex
  tens of kilometres away (SH51 continues for 30 km past the window).
* **Simplification.** Ramer–Douglas–Peucker at 0.75 m in metre space, 0.35 m for building
  outlines. Coordinates are rounded to 0.1 m.
* **Classification.** OSM `highway=*` is mapped to seven game classes with carriageway
  widths, widened by `lanes` where tagged.
* **Heights.** `height` → `building:levels × 3.2 m` → a per-`building` type table.
* **Stats.** Road count, total carriageway length, and the list of named roads, which the
  tests assert against.

## 3. Verify

* `tests/test_world_manifest.py` — 26 checks on the manifest: the place is Darsi 523247 in
  Prakasam, the licence is recorded, named Darsi roads and POIs survived the import, no
  vertex escapes the extract, every footprint is a polygon, heights are plausible, and the
  town centre has a dense street network.
* `tools/render_map.py` → `docs/darsi_map_preview.svg`, a plain top-down render that can be
  compared side by side with openstreetmap.org.
* `tools/capture.gd` → `docs/screenshots/*.png`, rendered in CI with software OpenGL.

## 4. Build — `scripts/world_builder.gd`

### Real, straight from OSM

| Element | Source |
|---|---|
| Road carriageways, shoulders, centre lines, edge lines | `way[highway]` geometry |
| Building walls, roofs, parapets, temple towers | `way[building]` / `relation[building]` footprints |
| Tanks with their earth bunds | `way[natural=water]`, `landuse=reservoir` |
| Canals and streams, including the Ongole branch canal | `waterway=*` |
| Railway ballast and rails | `railway=*` |
| Landmark names, kinds and positions | tagged nodes (`amenity`, `shop`, `place`, …) |
| Fuel station forecourts, the bus station, temples | built at their real POI coordinates |

### Generated, because OSM does not have it

| Element | How it is derived | Marked as |
|---|---|---|
| ~1,000 street-frontage plots | Laid out along the **real** street centrelines: 6.5–11.5 m frontage, 1.8–4 m setback, compound wall with gate pillars, plinth, flat RCC roof, parapet, overhead water tank; density falls off with distance from the centre; shopfronts (shutter, signboard, awning) on classified roads | `procedural_infill` metadata on the node and its parent |
| ~420 fields | Bunded, cropped rectangles placed on land the real road network leaves empty, suppressed near the centre | `Fields` node |
| ~1,500 poles and lamps | Spaced along real road geometry, alternating sides | `StreetFurniture` node |
| ~1,000 trees | Along real roads and scattered in open land | `Vegetation` node |
| Ground tone patches | Random dry-soil variation | `Ground` node |
| Building heights | `building:levels` where tagged, otherwise a type table | recorded in the manifest |

Nothing in the generated set moves, renames or invents a *road*: the network and the
footprints are untouched OSM.

## Licensing

Map data © OpenStreetMap contributors, ODbL 1.0 — <https://www.openstreetmap.org/copyright>.
The attribution travels with the data: it is stored in `data/darsi_world.json`, shown in the
HUD, and printed on the expanded map. No imagery, Street View, or proprietary POI data is
used.
