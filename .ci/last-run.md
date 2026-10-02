# Last CI run

commit: 32ab0706488419627f3ede2bf3e5ece8dcdca3be
parse: success  tests: failure  smoke: failure  export: success

```
=== Darsi world manifest validation ===
  PASS  data/darsi_world.json exists
  PASS  place name is Darsi
  PASS  PIN is 523247
  PASS  district is Prakasam
  PASS  state is Andhra Pradesh
  PASS  anchor latitude is Darsi's
  PASS  anchor longitude is Darsi's
  PASS  source is OpenStreetMap
  PASS  licence is ODbL 1.0
  PASS  the OSM database timestamp is recorded
  PASS  at least 120 road segments (194)
  PASS  over 30 km of road (67.8 km)
  PASS  at least 50 OSM buildings (91)
  PASS  at least 20 POIs (27)
  PASS  tanks/canals imported (5)
  PASS  road present: Podili - Vinukonda Road
  PASS  road present: Darsi - Chimakurthy Road
  PASS  road present: SH51
  PASS  POI present: APSRTC
  PASS  POI present: Darsi police station
  PASS  POI present: Jamal Hospital
  PASS  no road vertex escapes the extract (0 strays)
  PASS  every road has at least two vertices (0 degenerate)
  PASS  every building footprint is a polygon
  PASS  building heights are plausible
  PASS  the town centre has a dense street network (25 segments within 300 m)

=== 26 checks, 0 failures ===
4.3.stable.official.77dcf97d8
Godot Engine v4.3.stable.official.77dcf97d8 - https://godotengine.org

=== script checks ===
--- scripts/hud.gd
Godot Engine v4.3.stable.official.77dcf97d8 - https://godotengine.org

--- scripts/main.gd
Godot Engine v4.3.stable.official.77dcf97d8 - https://godotengine.org

--- scripts/minimap.gd
Godot Engine v4.3.stable.official.77dcf97d8 - https://godotengine.org

--- scripts/motorcycle.gd
Godot Engine v4.3.stable.official.77dcf97d8 - https://godotengine.org

--- scripts/motorcycle_mesh.gd
Godot Engine v4.3.stable.official.77dcf97d8 - https://godotengine.org

--- scripts/traffic_vehicle.gd
Godot Engine v4.3.stable.official.77dcf97d8 - https://godotengine.org

--- scripts/world_builder.gd
Godot Engine v4.3.stable.official.77dcf97d8 - https://godotengine.org

--- tests/headless_test.gd
Godot Engine v4.3.stable.official.77dcf97d8 - https://godotengine.org

=== headless acceptance tests ===
Godot Engine v4.3.stable.official.77dcf97d8 - https://godotengine.org

=== Darsi headless acceptance tests ===

[1] Geographic manifest
  PASS  data/darsi_world.json is shipped with the project
  PASS  manifest parses as JSON
  PASS  place is Darsi
  PASS  PIN code is 523247
  PASS  state is Andhra Pradesh
  PASS  geometry is attributed to OpenStreetMap
  PASS  licence recorded as ODbL 1.0
  PASS  anchor latitude matches Darsi (15.7667)
  PASS  anchor longitude matches Darsi (79.6833)
  PASS  at least 120 real road segments (194)
  PASS  more than 30 km of road (67.8 km)
  PASS  at least 50 OSM building footprints (91)
  PASS  at least 20 points of interest (27)
  PASS  tanks and canals present (5)
  PASS  Podili - Vinukonda Road is present
  PASS  Darsi - Chimakurthy Road is present
  PASS  state highway SH51 is present
  PASS  APSRTC bus station is present
  PASS  Darsi police station is present
  PASS  every road vertex lies inside the imported extract (0 strays)

[2] World construction
  built in 341 ms: { "street_poles": 1496, "trees": 1027, "roads": 194, "road_km": 67.7601, "osm_buildings": 91, "infill_buildings": 82, "landmarks": 27, "drivable_segments": 194 }
  PASS  real OSM buildings extruded (91)
  FAIL  plots filled along the real streets (82)
  PASS  drivable road graph built (194 segments)
  PASS  landmarks registered (27)
  PASS  road geometry node exists
  PASS  water geometry node exists
  PASS  vegetation node exists
  PASS  ground collider exists
  PASS  road meshes instantiated (236 children)
  PASS  town centre is within 120 m of a road (14.8 m)

[3] Motorcycle simulation
  PASS  the motorcycle is a rigid body, not a kinematic placeholder
  PASS  mass is kerb + rider (216 kg)
  PASS  the bike model has real structure (111 meshes/nodes)
  PASS  a rider is seated on the bike
  PASS  chassis collider exists
  PASS  both wheels exist as animated nodes
  PASS  the handlebars steer independently of the frame
  PASS  the bike rests on its suspension (y = 0.46)
  PASS  the bike stays upright at rest
  speed after 6 s of throttle: 2457563 km/h, travelled 3899047.1 m
  PASS  the engine actually accelerates the bike (2457563 km/h)
  FAIL  top speed is plausible for a 150cc commuter (2457563 km/h)
  PASS  the gearbox shifted up (gear 5)
  PASS  the odometer recorded the ride (3899047.1 m)
  PASS  the bike moved across the world
  FAIL  the bike is still upright under power
  PASS  fuel is being consumed (0.00 l)
  heading changed by 7.2 deg, peak lean -89.5 deg
  FAIL  steering changes the heading (7.2 deg)
  PASS  the bike leans into the corner (-89.5 deg)
  PASS  the bike did not fall over while cornering
  braking: 1155842.0 -> 18820.8 m/s
  PASS  the brakes stop the bike
  PASS  ride modes cycle
  PASS  refuelling fills the tank

=== 52 checks, 4 failures ===
  FAILED: plots filled along the real streets (82)
  FAILED: top speed is plausible for a 150cc commuter (2457563 km/h)
  FAILED: the bike is still upright under power
  FAILED: steering changes the heading (7.2 deg)
=== smoke run ===
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
ERROR: Invalid polygon data, triangulation failed.
   at: canvas_item_add_polygon (servers/rendering/renderer_canvas_cull.cpp:1607)
=== export ===

savepack: begin: Packing steps: 102
	savepack: step 2: Storing File: res://.godot/imported/icon.svg-218a8f2b3041327d8a5756f3a245f83b.ctex
	savepack: step 2: Storing File: res://icon.svg.import
	savepack: step 10: Storing File: res://data/darsi_world.json
	savepack: step 18: Storing File: res://.godot/imported/darsi_map_preview.svg-46fd48b510fce2e0dd7676004c04fd7b.ctex
	savepack: step 18: Storing File: res://docs/darsi_map_preview.svg.import
	savepack: step 27: Storing File: res://.godot/exported/133200997/export-3ad5c15c4f3250da0cc7c1af1770d85f-main.scn
	savepack: step 35: Storing File: res://scripts/hud.gdc
	savepack: step 43: Storing File: res://scripts/main.gdc
	savepack: step 52: Storing File: res://scripts/minimap.gdc
	savepack: step 60: Storing File: res://scripts/motorcycle.gdc
	savepack: step 68: Storing File: res://scripts/motorcycle_mesh.gdc
	savepack: step 77: Storing File: res://scripts/traffic_vehicle.gdc
	savepack: step 85: Storing File: res://scripts/world_builder.gdc
	savepack: step 93: Storing File: res://tests/headless_test.gdc
	savepack: step 93: Storing File: res://scenes/main.tscn.remap
	savepack: step 93: Storing File: res://scripts/hud.gd.remap
	savepack: step 93: Storing File: res://scripts/main.gd.remap
	savepack: step 93: Storing File: res://scripts/minimap.gd.remap
	savepack: step 93: Storing File: res://scripts/motorcycle.gd.remap
	savepack: step 93: Storing File: res://scripts/motorcycle_mesh.gd.remap
	savepack: step 93: Storing File: res://scripts/traffic_vehicle.gd.remap
	savepack: step 93: Storing File: res://scripts/world_builder.gd.remap
	savepack: step 93: Storing File: res://tests/headless_test.gd.remap
	savepack: step 93: Storing File: res://.godot/global_script_class_cache.cfg
	savepack: step 93: Storing File: res://icon.svg
	savepack: step 93: Storing File: res://.godot/uid_cache.bin
	savepack: step 93: Storing File: res://project.binary
savepack: end
total 64844
drwxr-xr-x 2 runner runner     4096 Oct  2 16:41 .
drwxr-xr-x 3 runner runner     4096 Oct  2 16:41 ..
-rw-rw-rw- 1 runner runner   311584 Oct  2 16:41 darsi.pck
-rwxr-xr-x 1 runner runner 66074584 Oct  2 16:41 darsi.x86_64
```
