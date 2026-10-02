# Last CI run

commit: 72eac081efdf29bf078caf35827105e47fdfe762
parse: success  tests: failure  smoke: success  export: success

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
  built in 638 ms: { "street_poles": 1496, "trees": 1141, "roads": 194, "road_km": 67.7601, "osm_buildings": 91, "infill_buildings": 509, "landmarks": 27, "drivable_segments": 194 }
  PASS  real OSM buildings extruded (91)
  PASS  plots filled along the real streets (509)
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
  spawn (-5.480209, 0.59, 13.783) -> settled (-5.480063, 0.532213, 13.78306), contacts front=true rear=true, up=(-0.00027, 1, -0.000107)
  under the bike: /root/@Node3D@2/Ground at (-5.480063, 0, 13.78306) (normal (0, 1, 0))
  PASS  the bike rests on its suspension (y = 0.53)
  PASS  the bike stays upright at rest
  speed after 6 s of throttle: 52 km/h, travelled 56.1 m
  PASS  the engine actually accelerates the bike (52 km/h)
  PASS  top speed is plausible for a 150cc commuter (52 km/h)
  PASS  the gearbox shifted up (gear 3)
  PASS  the odometer recorded the ride (56.1 m)
  PASS  the bike moved across the world
  PASS  the bike is still upright under power
  PASS  fuel is being consumed (8.99 l)
  heading changed by 12.0 deg, peak lean -16.3 deg
  FAIL  steering changes the heading (12.0 deg)
  PASS  the bike leans into the corner (-16.3 deg)
  PASS  the bike did not fall over while cornering
  PASS  the lean angle stays inside the tyre's edge (-16.3 deg)
  PASS  the bike is rolling before the brake test (10.8 m/s)
  braking: 10.8 -> 0.0 m/s
  PASS  the brakes stop the bike
  PASS  ride modes cycle
  PASS  refuelling fills the tank

=== 54 checks, 1 failures ===
  FAILED: steering changes the heading (12.0 deg)
=== smoke run ===
Godot Engine v4.3.stable.official.77dcf97d8 - https://godotengine.org

Darsi built: { "street_poles": 1496, "trees": 1141, "roads": 194, "road_km": 67.7601, "osm_buildings": 91, "infill_buildings": 509, "landmarks": 27, "drivable_segments": 194 }
=== screenshots ===
Godot Engine v4.3.stable.official.77dcf97d8 - https://godotengine.org
WARNING: Could not set V-Sync mode, as changing V-Sync mode is not supported by the graphics driver.
     at: set_use_vsync (platform/linuxbsd/x11/gl_manager_x11.cpp:360)
OpenGL API 4.5 (Core Profile) Mesa 25.2.8-0ubuntu0.24.04.4 - Compatibility - Using Device: Mesa - llvmpipe (LLVM 20.1.2, 256 bits)
libpulse.so.0: cannot open shared object file: No such file or directory
libpulse.so.0: cannot open shared object file: No such file or directory
ALSA lib confmisc.c:855:(parse_card) cannot find card '0'
ALSA lib conf.c:5208:(_snd_config_evaluate) function snd_func_card_inum returned error: No such file or directory
ALSA lib confmisc.c:422:(snd_func_concat) error evaluating strings
ALSA lib conf.c:5208:(_snd_config_evaluate) function snd_func_concat returned error: No such file or directory
ALSA lib confmisc.c:1342:(snd_func_refer) error evaluating name
ALSA lib conf.c:5208:(_snd_config_evaluate) function snd_func_refer returned error: No such file or directory
ALSA lib conf.c:5731:(snd_config_expand) Evaluate error: No such file or directory
ALSA lib pcm.c:2721:(snd_pcm_open_noupdate) Unknown PCM default
ERROR: Condition "status < 0" is true. Returning: ERR_CANT_OPEN
   at: init_output_device (drivers/alsa/audio_driver_alsa.cpp:90)
WARNING: All audio drivers failed, falling back to the dummy driver.
     at: initialize (servers/audio_server.cpp:247)

stats: { "street_poles": 1496, "trees": 1141, "roads": 194, "road_km": 67.7601, "osm_buildings": 91, "infill_buildings": 509, "landmarks": 27, "drivable_segments": 194 }
capturing 6 shots
saved res://docs/screenshots/01_town_from_above.png (ok)
saved res://docs/screenshots/02_central_junction.png (ok)
saved res://docs/screenshots/03_rider_view.png (ok)
saved res://docs/screenshots/04_motorcycle_detail.png (ok)
saved res://docs/screenshots/05_main_road.png (ok)
saved res://docs/screenshots/06_street_level.png (ok)
total 1252
drwxr-xr-x 2 runner runner   4096 Oct  2 17:09 .
drwxr-xr-x 3 runner runner   4096 Oct  2 17:09 ..
-rw-r--r-- 1 runner runner 142818 Oct  2 17:10 01_town_from_above.png
-rw-rw-rw- 1 runner runner    805 Oct  2 17:09 01_town_from_above.png.import
-rw-r--r-- 1 runner runner 100673 Oct  2 17:10 02_central_junction.png
-rw-rw-rw- 1 runner runner    808 Oct  2 17:09 02_central_junction.png.import
-rw-r--r-- 1 runner runner 239235 Oct  2 17:10 03_rider_view.png
-rw-rw-rw- 1 runner runner    790 Oct  2 17:09 03_rider_view.png.import
-rw-r--r-- 1 runner runner 254512 Oct  2 17:10 04_motorcycle_detail.png
-rw-rw-rw- 1 runner runner    810 Oct  2 17:09 04_motorcycle_detail.png.import
-rw-r--r-- 1 runner runner 245384 Oct  2 17:10 05_main_road.png
-rw-rw-rw- 1 runner runner    786 Oct  2 17:09 05_main_road.png.import
-rw-r--r-- 1 runner runner 257691 Oct  2 17:10 06_street_level.png
-rw-rw-rw- 1 runner runner    796 Oct  2 17:09 06_street_level.png.import
=== export ===
	savepack: step 37: Storing File: res://docs/screenshots/06_street_level.png.import
	savepack: step 42: Storing File: res://.godot/imported/darsi_map_preview.svg-46fd48b510fce2e0dd7676004c04fd7b.ctex
	savepack: step 42: Storing File: res://docs/darsi_map_preview.svg.import
	savepack: step 47: Storing File: res://.godot/exported/133200997/export-a637d77a8079708f17d7f985c5beb852-capture.scn
	savepack: step 52: Storing File: res://.godot/exported/133200997/export-3ad5c15c4f3250da0cc7c1af1770d85f-main.scn
	savepack: step 57: Storing File: res://scripts/hud.gdc
	savepack: step 62: Storing File: res://scripts/main.gdc
	savepack: step 67: Storing File: res://scripts/minimap.gdc
	savepack: step 72: Storing File: res://scripts/motorcycle.gdc
	savepack: step 77: Storing File: res://scripts/motorcycle_mesh.gdc
	savepack: step 82: Storing File: res://scripts/traffic_vehicle.gdc
	savepack: step 87: Storing File: res://scripts/world_builder.gdc
	savepack: step 92: Storing File: res://tests/headless_test.gdc
	savepack: step 97: Storing File: res://tools/capture.gdc
	savepack: step 97: Storing File: res://scenes/capture.tscn.remap
	savepack: step 97: Storing File: res://scenes/main.tscn.remap
	savepack: step 97: Storing File: res://scripts/hud.gd.remap
	savepack: step 97: Storing File: res://scripts/main.gd.remap
	savepack: step 97: Storing File: res://scripts/minimap.gd.remap
	savepack: step 97: Storing File: res://scripts/motorcycle.gd.remap
	savepack: step 97: Storing File: res://scripts/motorcycle_mesh.gd.remap
	savepack: step 97: Storing File: res://scripts/traffic_vehicle.gd.remap
	savepack: step 97: Storing File: res://scripts/world_builder.gd.remap
	savepack: step 97: Storing File: res://tests/headless_test.gd.remap
	savepack: step 97: Storing File: res://tools/capture.gd.remap
	savepack: step 97: Storing File: res://.godot/global_script_class_cache.cfg
	savepack: step 97: Storing File: res://icon.svg
	savepack: step 97: Storing File: res://.godot/uid_cache.bin
	savepack: step 97: Storing File: res://project.binary
savepack: end
total 65668
drwxr-xr-x 2 runner runner     4096 Oct  2 17:10 .
drwxr-xr-x 3 runner runner     4096 Oct  2 17:10 ..
-rw-rw-rw- 1 runner runner  1159136 Oct  2 17:10 darsi.pck
-rwxr-xr-x 1 runner runner 66074584 Oct  2 17:10 darsi.x86_64
```
