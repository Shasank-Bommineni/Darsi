extends SceneTree
## Headless acceptance tests for Darsi. Run with:
##   godot --headless --script tests/headless_test.gd
## Exits with code 0 when every assertion passes, 1 otherwise.

var failures: Array[String] = []
var checks := 0


func _initialize() -> void:
	root.call_deferred("set_physics_process", true)
	_run.call_deferred()


func _check(condition: bool, label: String) -> void:
	checks += 1
	if condition:
		print("  PASS  %s" % label)
	else:
		failures.append(label)
		printerr("  FAIL  %s" % label)


func _run() -> void:
	print("=== Darsi headless acceptance tests ===")
	var world_data := _test_manifest()
	var builder := await _test_world_build(world_data)
	await _test_motorcycle(builder)
	_report()


# ---------------------------------------------------------------- 1. data
func _test_manifest() -> Dictionary:
	print("\n[1] Geographic manifest")
	var path := "res://data/darsi_world.json"
	_check(FileAccess.file_exists(path), "data/darsi_world.json is shipped with the project")
	var file := FileAccess.open(path, FileAccess.READ)
	var data = JSON.parse_string(file.get_as_text())
	file.close()
	_check(data is Dictionary, "manifest parses as JSON")
	if not (data is Dictionary):
		return {}

	_check(String(data.place.name) == "Darsi", "place is Darsi")
	_check(String(data.place.pin) == "523247", "PIN code is 523247")
	_check(String(data.place.state) == "Andhra Pradesh", "state is Andhra Pradesh")
	_check(String(data.attribution.source) == "OpenStreetMap", "geometry is attributed to OpenStreetMap")
	_check(String(data.attribution.license) == "ODbL 1.0", "licence recorded as ODbL 1.0")

	var anchor_lat := float(data.place.anchor.lat)
	var anchor_lon := float(data.place.anchor.lon)
	_check(absf(anchor_lat - 15.7667) < 0.01, "anchor latitude matches Darsi (15.7667)")
	_check(absf(anchor_lon - 79.6833) < 0.01, "anchor longitude matches Darsi (79.6833)")

	_check(data.roads.size() >= 120, "at least 120 real road segments (%d)" % data.roads.size())
	_check(float(data.stats.road_length_m) > 30000.0, "more than 30 km of road (%.1f km)" % (float(data.stats.road_length_m) / 1000.0))
	_check(data.buildings.size() >= 50, "at least 50 OSM building footprints (%d)" % data.buildings.size())
	_check(data.pois.size() >= 20, "at least 20 points of interest (%d)" % data.pois.size())
	_check(data.water.size() >= 3, "tanks and canals present (%d)" % data.water.size())

	# Named, verifiable Darsi features must be in the data.
	var names := ""
	for road in data.roads:
		names += String(road.name) + "|"
	_check(names.contains("Podili - Vinukonda Road"), "Podili - Vinukonda Road is present")
	_check(names.contains("Darsi - Chimakurthy Road"), "Darsi - Chimakurthy Road is present")
	_check(names.contains("SH51"), "state highway SH51 is present")

	var poi_names := ""
	for poi in data.pois:
		poi_names += String(poi.name) + "|"
	_check(poi_names.contains("APSRTC"), "APSRTC bus station is present")
	_check(poi_names.contains("Darsi police station"), "Darsi police station is present")

	# No invented geometry: every road point must sit inside the imported window.
	var half_x := float(data.world.half_extent_x) + 120.0
	var half_y := float(data.world.half_extent_y) + 120.0
	var out_of_range := 0
	for road in data.roads:
		var flat: Array = road.points
		var i := 0
		while i + 1 < flat.size():
			if absf(float(flat[i])) > half_x or absf(float(flat[i + 1])) > half_y:
				out_of_range += 1
			i += 2
	_check(out_of_range == 0, "every road vertex lies inside the imported extract (%d strays)" % out_of_range)
	return data


# ---------------------------------------------------------------- 2. world
func _test_world_build(data: Dictionary) -> DarsiWorldBuilder:
	print("\n[2] World construction")
	var builder := DarsiWorldBuilder.new()
	root.add_child(builder)
	var started := Time.get_ticks_msec()
	var stats := builder.build(data)
	var elapsed := Time.get_ticks_msec() - started
	print("  built in %d ms: %s" % [elapsed, stats])

	_check(stats.osm_buildings >= 50, "real OSM buildings extruded (%d)" % stats.osm_buildings)
	_check(stats.infill_buildings >= 200, "plots filled along the real streets (%d)" % stats.infill_buildings)
	_check(stats.drivable_segments >= 100, "drivable road graph built (%d segments)" % stats.drivable_segments)
	_check(builder.landmarks.size() >= 20, "landmarks registered (%d)" % builder.landmarks.size())
	_check(builder.get_node_or_null("Roads") != null, "road geometry node exists")
	_check(builder.get_node_or_null("Water") != null, "water geometry node exists")
	_check(builder.get_node_or_null("Vegetation") != null, "vegetation node exists")
	_check(builder.get_node_or_null("Ground") != null, "ground collider exists")

	var roads := builder.get_node("Roads")
	_check(roads.get_child_count() >= 150, "road meshes instantiated (%d children)" % roads.get_child_count())

	# The spawn point must be on tarmac in the middle of town.
	var nearest := builder.nearest_road_point(Vector3.ZERO)
	_check(nearest.distance < 120.0, "town centre is within 120 m of a road (%.1f m)" % nearest.distance)
	await process_frame
	return builder


# ---------------------------------------------------------------- 3. motorcycle
func _test_motorcycle(builder: DarsiWorldBuilder) -> void:
	print("\n[3] Motorcycle simulation")
	var bike := Motorcycle.new()
	root.add_child(bike)
	await physics_frame

	_check(bike is RigidBody3D, "the motorcycle is a rigid body, not a kinematic placeholder")
	_check(absf(bike.mass - (Motorcycle.KERB_MASS + Motorcycle.RIDER_MASS)) < 0.01, "mass is kerb + rider (%.0f kg)" % bike.mass)
	var part_count := _count_descendants(bike.visual)
	_check(bike.visual != null and part_count > 60, "the bike model has real structure (%d meshes/nodes)" % part_count)
	_check(bike.rider != null, "a rider is seated on the bike")
	_check(bike.get_node_or_null("Chassis") != null, "chassis collider exists")
	_check(bike.front_wheel_node != null and bike.rear_wheel_node != null, "both wheels exist as animated nodes")
	_check(bike.steering_node != null, "the handlebars steer independently of the frame")

	var start := builder.nearest_road_point(Vector3.ZERO)
	bike.respawn_at(start.position + Vector3(0, 0.2, 0), start.direction)
	var spawn := bike.global_position
	await physics_frame
	await physics_frame

	# Settle on the suspension.
	for i in range(40):
		bike.set_controls(0.0, 0.0, 0.0, 0.0)
		await physics_frame
	var settled_height := bike.global_position.y
	_check(settled_height > -0.5 and settled_height < 2.0, "the bike rests on its suspension (y = %.2f)" % settled_height)
	_check(bike.global_transform.basis.y.dot(Vector3.UP) > 0.9, "the bike stays upright at rest")

	# Full throttle in a straight line for 6 simulated seconds.
	for i in range(360):
		bike.set_controls(1.0, 0.0, 0.0, 0.0)
		await physics_frame
	var speed := bike.get_speed_kmh()
	print("  speed after 6 s of throttle: %d km/h, travelled %.1f m" % [speed, bike.odometer_m])
	_check(speed > 25, "the engine actually accelerates the bike (%d km/h)" % speed)
	_check(speed < 140, "top speed is plausible for a 150cc commuter (%d km/h)" % speed)
	_check(bike.gear >= 2, "the gearbox shifted up (gear %d)" % bike.gear)
	_check(bike.odometer_m > 40.0, "the odometer recorded the ride (%.1f m)" % bike.odometer_m)
	_check(bike.global_position.distance_to(spawn) > 40.0, "the bike moved across the world")
	_check(bike.global_transform.basis.y.dot(Vector3.UP) > 0.75, "the bike is still upright under power")
	_check(bike.fuel < Motorcycle.FUEL_CAPACITY, "fuel is being consumed (%.2f l)" % bike.fuel)

	# Steer right and check that the bike yaws and leans into the corner.
	var heading_before := bike.get_heading_degrees()
	var leaned := 0.0
	for i in range(180):
		bike.set_controls(0.55, 0.0, 0.0, 1.0)
		await physics_frame
		leaned = minf(leaned, bike.get_lean_degrees())
	var heading_after := bike.get_heading_degrees()
	var turned: float = absf(wrapf(heading_after - heading_before, -180.0, 180.0))
	print("  heading changed by %.1f deg, peak lean %.1f deg" % [turned, leaned])
	_check(turned > 15.0, "steering changes the heading (%.1f deg)" % turned)
	_check(absf(leaned) > 2.0, "the bike leans into the corner (%.1f deg)" % leaned)
	_check(bike.global_transform.basis.y.dot(Vector3.UP) > 0.6, "the bike did not fall over while cornering")

	# Brakes.
	var speed_before := absf(bike.get_speed_mps())
	for i in range(150):
		bike.set_controls(0.0, 1.0, 1.0, 0.0)
		await physics_frame
	var speed_after := absf(bike.get_speed_mps())
	print("  braking: %.1f -> %.1f m/s" % [speed_before, speed_after])
	_check(speed_after < speed_before * 0.5 + 0.5, "the brakes stop the bike")

	# Ride modes and refuelling.
	_check(bike.cycle_ride_mode() in ["Arcade", "Normal", "Simulation"], "ride modes cycle")
	bike.fuel = 1.0
	bike.refuel()
	_check(absf(bike.fuel - Motorcycle.FUEL_CAPACITY) < 0.01, "refuelling fills the tank")


func _count_descendants(node: Node) -> int:
	if node == null:
		return 0
	var total := 0
	for child in node.get_children():
		total += 1 + _count_descendants(child)
	return total


func _report() -> void:
	print("\n=== %d checks, %d failures ===" % [checks, failures.size()])
	for failure in failures:
		print("  FAILED: %s" % failure)
	quit(0 if failures.is_empty() else 1)
