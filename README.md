# Darsi — Small Town Ride

A Godot 4 Android-first prototype for a relaxed motorcycle life game set around Darsi, Andhra Pradesh 523247. This repository starts with the requested first milestone: a procedural, navigable Darsi geographic prototype, one rideable 125cc motorcycle, a follow/cockpit camera, collision, fuel, a small delivery loop, landmark discovery, and touch-friendly controls.

## Run it

1. Install **Godot 4.3 or newer**.
2. Import this folder and press **Play**.
3. Desktop controls: **WASD / arrow keys** ride, **C** changes camera, **P** enters photo mode, **M** toggles the map, **E** interacts, **Space** handbrakes.
4. On Android, the on-screen controls are created by the game itself. Landscape orientation is recommended.

The project uses the Compatibility renderer and has no third-party runtime dependency or scraped imagery. All geometry, materials, and UI in this first prototype are generated from code; audio is intentionally deferred to the polish pass.

## Geographic accuracy and data provenance

This is deliberately labelled a **geographic prototype**, not a claim of a finished 1:1 recreation. `data/darsi_map.json` stores a real-world WGS84 anchor for Darsi (15.7667 N, 79.6833 E), the public place identity and PIN, named road corridors and public-place references. The current road polylines and building footprints are **procedural approximation** around that anchor, clearly marked as such in the manifest. They are not presented as verified survey geometry.

The intended next step is to export a small OpenStreetMap extract under the ODbL, run `tools/import_osm.py`, review the resulting `data/darsi_map.json`, and regenerate the scene. No Google imagery or copyrighted map tiles are included. See [`docs/MAP_PIPELINE.md`](docs/MAP_PIPELINE.md) for the reproducible pipeline and legal/data notes.

## Prototype scope

- Correct-scale lat/lon-to-metre projection around the Darsi anchor.
- Main-road and neighbourhood-road layout represented as editable geographic polylines.
- Procedural roads, plots, fields, homes, shops, temple, school, fuel stop, trees, poles, wires, traffic props, and a bus stop.
- A distinct fictional 125cc commuter motorcycle (`Sahaja 125`) to avoid unlicensed manufacturer branding.
- Lightweight riding model: acceleration, braking, gears, engine braking, grip, lean, fuel burn, and arcade/normal/simulation modes.
- Delivery activity, petrol interaction, landmark discovery, money, simple progression state, day/night clock, rain toggle, and photo mode.
- Android-oriented performance baseline: Compatibility renderer, a sector-sized geographic manifest, pooled-looking decoration generation, and a low-cost procedural asset strategy. Runtime sector activation is planned for Prototype 2.

## Roadmap

1. **Prototype 1 (this checkout):** Darsi anchor/map prototype, one motorcycle, collision, cameras, roads.
2. **Prototype 2:** replace approximation with reviewed OSM geometry, streaming sectors, traffic/NPC pools, fuel and more landmarks.
3. **Prototype 3:** garage, used-bike market, deliveries, economy, fictional bikes across 125–650cc.
4. **Prototype 4:** weather surfaces, baked/mobile lighting, photo mode polish, audio and profiling.
5. **Final:** reviewed map coverage, Android QA on mid-range devices, accessibility, and content polish.

The distinction between **verified geographic data** and **procedural visual content** is kept in the map manifest and should remain visible in any future map import review.
