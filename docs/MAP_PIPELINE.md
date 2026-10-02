# Darsi geographic data pipeline

The scene builder does not consume satellite imagery. It consumes a small JSON manifest with WGS84 points, then projects those points to metres around Darsi's anchor. This keeps road positions, distances, and streaming-sector boundaries inspectable and regenerable.

## Recommended source and license

Use a reviewed extract from [OpenStreetMap](https://www.openstreetmap.org/) for roads, public POIs, water, landuse, and building footprints. OSM data is available under the Open Data Commons Open Database License (ODbL); preserve attribution and follow share-alike obligations when distributing a derived database. Do not import Google tiles, screenshots, proprietary POI exports, or copyrighted vehicle/building meshes.

A small `.osm` file can be downloaded through an approved OSM export or Geofabrik/BBBike workflow. Keep the source extract outside the game repository if it is large. Only the reviewed, transformed manifest belongs in `data/`.

## Reproducible flow

1. Choose a bounding box that covers Darsi town and its intended playable roads. Record the date and source URL.
2. Review the extract in an OSM editor or GIS tool. Remove geometry that is outside the agreed play area and check that the road classes are sensible for a motorcycle game.
3. Run:

   ```bash
   python3 tools/import_osm.py \
     --input /path/to/darsi.osm \
     --base data/darsi_map.json \
     --output data/darsi_map.reviewed.json \
     --center 15.7667 79.6833
   ```

4. Inspect the generated roads and POIs in the Godot map screen. Replace the starter file only after a human review of the road graph and landmark positions.
5. Open the project in Godot and run the prototype. The world is regenerated at startup; there is no baked proprietary map texture.
6. Record `source_url`, `retrieved_at`, OSM changeset/extract date, attribution, and the reviewer in the manifest before release.

## What the importer does

`tools/import_osm.py` is intentionally conservative and dependency-free:

- reads OSM XML nodes and ways;
- keeps `highway` ways and converts their node references to `[lat, lon]` vertices;
- keeps public `amenity`, `shop`, `tourism`, and `historic` nodes as landmark references;
- preserves the base manifest's place identity and procedural fields;
- marks imported geometry `verified_source: openstreetmap` but does **not** pretend that OSM tags verify the visual building shape;
- leaves visual buildings, traffic, vegetation, weather, and detailed terrain procedural.

Ways that use missing nodes or lack a `highway` tag are skipped with a warning. Building polygons are not turned into exact visual buildings by the starter importer: use their centroids as references and create plausible geometry in the game unless you have separately reviewed a legal, suitable building dataset.

## Accuracy boundary

The current starter manifest contains a public coordinate anchor and named corridor references, while its road vertices and POI positions are explicitly approximate. The game UI and README repeat this distinction so the prototype cannot accidentally be marketed as a verified 1:1 Darsi recreation. After importing reviewed OSM geometry, update `provenance.verified` and keep `provenance.procedural_or_unverified` for generated visuals.
