class_name DarsiWorldBuilder
extends Node3D
## Builds the 3D town of Darsi directly from data/darsi_world.json.
##
## Every road centreline, building footprint, tank, canal and point of interest in this
## scene is the real OpenStreetMap geometry of Darsi, Prakasam district, Andhra Pradesh
## 523247, projected into a local metre frame (+x east, +y north -> Godot +x east, -z north).
##
## Only the *third dimension* is synthesised: OSM has no facades, so building heights come
## from building:levels where tagged and from a type table otherwise, and plots on streets
## that nobody has mapped yet are filled with procedural compound houses so the town is not
## a field of empty asphalt. Those are tagged `procedural_infill` in the node metadata.
##
## Map data (c) OpenStreetMap contributors, ODbL 1.0.

signal world_built(stats: Dictionary)

const ROAD_Y := 0.02
const KERB_Y := 0.06
const MARKING_Y := 0.035

var world: Dictionary = {}
var half_x := 2100.0
var half_y := 2100.0
var rng := RandomNumberGenerator.new()

var landmarks: Array[Dictionary] = []
var road_graph: Array[Dictionary] = []      # drivable polylines in world space, for traffic + spawn
var _materials: Dictionary = {}
## Coarse occupancy grid (CELL metre cells) so plot placement is O(1) per candidate
## instead of testing thousands of rectangles. Two layers: hard blockers (buildings,
## water) and road corridors.
const CELL := 1.5
var _blocked: Dictionary = {}               # cell key -> true, buildings/water/plots
var _road_cells: Dictionary = {}            # cell key -> true, carriageway + 1 m
var _stats: Dictionary = {}

# ------------------------------------------------------------------ palettes
## Whitewash, lime wash and the pastel distempers you actually see on houses here.
const WALL_COLOURS := [
	Color("#e8e0cc"), Color("#f0e7d2"), Color("#d8cdb2"), Color("#cdbb9b"),
	Color("#e6c9a0"), Color("#b9cfc6"), Color("#e4b89a"), Color("#dcdcd0"),
	Color("#bdd0da"), Color("#f2e4c6"), Color("#cfa98f"), Color("#b6c4ab"),
	Color("#e3b7b2"), Color("#c9b7cf"), Color("#9fb9a8"), Color("#d6c08a"),
	Color("#a9bcc9"), Color("#e2cf9c"), Color("#c6a6a0"), Color("#aec3b0"),
]
const TRIM_COLOURS := [
	Color("#a8422c"), Color("#2b6450"), Color("#27436a"), Color("#80522a"),
	Color("#60356a"), Color("#96761f"), Color("#b5651d"), Color("#3f6f3a"),
]
const SHUTTER_COLOURS := [
	Color("#3c6ea5"), Color("#2f7a52"), Color("#a84a2f"), Color("#6b6f73"), Color("#8a6d2f"),
]


func _material(colour: Color, roughness := 0.9, metallic := 0.0, emission := Color.BLACK) -> StandardMaterial3D:
	var key := "%s|%.2f|%.2f|%s" % [colour.to_html(), roughness, metallic, emission.to_html()]
	if _materials.has(key):
		return _materials[key]
	var material := StandardMaterial3D.new()
	material.albedo_color = colour
	material.roughness = roughness
	material.metallic = metallic
	if emission != Color.BLACK:
		material.emission_enabled = true
		material.emission = emission
		material.emission_energy_multiplier = 1.5
	_materials[key] = material
	return material


# ------------------------------------------------------------------ entry point
func build(data: Dictionary) -> Dictionary:
	world = data
	rng.seed = 523247
	half_x = float(world.world.half_extent_x)
	half_y = float(world.world.half_extent_y)

	_build_ground()
	_build_green_areas()
	_build_water()
	_build_roads()
	_build_railways()
	var osm_buildings := _build_osm_buildings()
	var infill := _build_infill_buildings()
	_build_pois()
	_build_farm_fields()
	_build_street_furniture()
	_build_vegetation()
	_build_boundary()

	_stats.merge({
		"roads": world.roads.size(),
		"road_km": float(world.stats.road_length_m) / 1000.0,
		"osm_buildings": osm_buildings,
		"infill_buildings": infill,
		"landmarks": landmarks.size(),
		"drivable_segments": road_graph.size(),
	}, true)
	world_built.emit(_stats)
	return _stats


func get_stats() -> Dictionary:
	return _stats


## OSM metre space (+x east, +y north) -> Godot world space (x east, z south).
static func plane_to_world(x: float, y: float) -> Vector3:
	return Vector3(x, 0.0, -y)


static func unpack(flat: Array) -> PackedVector2Array:
	var points := PackedVector2Array()
	var i := 0
	while i + 1 < flat.size():
		points.append(Vector2(float(flat[i]), float(flat[i + 1])))
		i += 2
	return points


# ------------------------------------------------------------------ ground
func _build_ground() -> void:
	var ground := StaticBody3D.new()
	ground.name = "Ground"
	ground.collision_layer = 1
	ground.collision_mask = 0
	add_child(ground)

	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(half_x * 2.4, 2.0, half_y * 2.4)
	shape.shape = box
	shape.position = Vector3(0, -1.0, 0)
	ground.add_child(shape)

	# Dry red-brown Rayalaseema/Prakasam soil with a few large tonal patches.
	var plane := MeshInstance3D.new()
	plane.name = "GroundPlane"
	var mesh := PlaneMesh.new()
	mesh.size = Vector2(half_x * 2.4, half_y * 2.4)
	mesh.subdivide_width = 8
	mesh.subdivide_depth = 8
	mesh.material = _material(Color("#9c8c6e"), 1.0)
	plane.mesh = mesh
	ground.add_child(plane)

	var patch_colours := [Color("#8d7d5c"), Color("#9c8a62"), Color("#8a7c58"), Color("#a08d64"), Color("#7d8a5a")]
	for i in range(70):
		var size := rng.randf_range(90.0, 320.0)
		var px := rng.randf_range(-half_x, half_x)
		var py := rng.randf_range(-half_y, half_y)
		var patch := MeshInstance3D.new()
		var patch_mesh := PlaneMesh.new()
		patch_mesh.size = Vector2(size, size * rng.randf_range(0.6, 1.5))
		patch_mesh.material = _material(patch_colours[i % patch_colours.size()], 1.0)
		patch.mesh = patch_mesh
		patch.position = plane_to_world(px, py) + Vector3(0, 0.005 + float(i) * 0.0002, 0)
		patch.rotation.y = rng.randf_range(0.0, PI)
		ground.add_child(patch)


## Prakasam district outside the built-up area is a patchwork of irrigated fields.
## OSM has no landuse polygons mapped for Darsi, so the fields are laid out procedurally
## on the land the real road network leaves empty, with earth bunds between them.
func _build_farm_fields() -> void:
	var parent := Node3D.new()
	parent.name = "Fields"
	add_child(parent)

	var crops := [
		Color("#7f9150"), Color("#8ea35a"), Color("#6f8545"), Color("#9aa864"),
		Color("#b7a86a"), Color("#a3924f"), Color("#5f7a3c"), Color("#c0b074"),
	]
	var bund_colour := Color("#8a7450")
	var placed := 0
	var attempts := 0
	while placed < 420 and attempts < 6000:
		attempts += 1
		var centre := Vector2(rng.randf_range(-half_x + 60.0, half_x - 60.0), rng.randf_range(-half_y + 60.0, half_y - 60.0))
		# Fields are rare in the middle of town and common on the outskirts.
		if centre.length() < 450.0 and rng.randf() < 0.85:
			continue
		var field_size := Vector2(rng.randf_range(45.0, 130.0), rng.randf_range(40.0, 110.0))
		var rect := Rect2(centre - field_size * 0.5, field_size)
		if _is_occupied(rect):
			continue
		var angle := rng.randf_range(0.0, PI)
		var crop: Color = crops[rng.randi() % crops.size()]
		var field := Node3D.new()
		field.position = plane_to_world(centre.x, centre.y)
		field.rotation.y = angle
		parent.add_child(field)

		var plot := MeshInstance3D.new()
		var plot_mesh := PlaneMesh.new()
		plot_mesh.size = field_size
		plot_mesh.material = _material(crop, 0.98)
		plot.mesh = plot_mesh
		plot.position = Vector3(0, 0.04, 0)
		field.add_child(plot)

		# Earth bunds on all four sides hold the irrigation water in.
		for axis in [0, 1]:
			for side in [-1.0, 1.0]:
				var bund := MeshInstance3D.new()
				var bund_mesh := BoxMesh.new()
				if axis == 0:
					bund_mesh.size = Vector3(field_size.x, 0.45, 0.8)
					bund.position = Vector3(0.0, 0.2, side * field_size.y * 0.5)
				else:
					bund_mesh.size = Vector3(0.8, 0.45, field_size.y)
					bund.position = Vector3(side * field_size.x * 0.5, 0.2, 0.0)
				bund_mesh.material = _material(bund_colour, 1.0)
				bund.mesh = bund_mesh
				field.add_child(bund)

		# Crop rows give the fields some texture from the saddle.
		var rows := int(field_size.y / 6.0)
		for i in range(rows):
			var row := MeshInstance3D.new()
			var row_mesh := BoxMesh.new()
			row_mesh.size = Vector3(field_size.x * 0.94, 0.35, 0.7)
			row_mesh.material = _material(crop.darkened(0.18), 0.98)
			row.mesh = row_mesh
			row.position = Vector3(0.0, 0.18, -field_size.y * 0.5 + 3.0 + float(i) * 6.0)
			field.add_child(row)

		_mark_rect(_blocked, rect.grow(3.0))
		placed += 1
	_stats["fields"] = placed


func _build_green_areas() -> void:
	var parent := Node3D.new()
	parent.name = "Farmland"
	add_child(parent)
	var colours := {
		"farmland": Color("#8fa05a"),
		"farmyard": Color("#a89770"),
		"meadow": Color("#9bae68"),
		"orchard": Color("#6f8c4c"),
		"forest": Color("#55713f"),
		"scrub": Color("#8a9460"),
		"grass": Color("#93a862"),
		"village_green": Color("#93a862"),
		"cemetery": Color("#86936a"),
		"recreation_ground": Color("#8fa86a"),
	}
	for area in world.get("green", []):
		var points := unpack(area.outline)
		if points.size() < 3:
			continue
		var colour: Color = colours.get(String(area.kind), Color("#8fa05a"))
		var mesh_instance := _polygon_slab(points, 0.03, colour)
		if mesh_instance:
			mesh_instance.name = "Green_%s" % area.id
			parent.add_child(mesh_instance)
			_occupy(points, 0.0)


func _build_water() -> void:
	var parent := Node3D.new()
	parent.name = "Water"
	add_child(parent)
	for body in world.get("water", []):
		if body.has("outline"):
			var points := unpack(body.outline)
			if points.size() < 3:
				continue
			# Bund (earth embankment) around the tank, then the water surface sunk below it.
			var bund := _polygon_outline_wall(points, 1.4, 5.0, Color("#8a7350"))
			if bund:
				bund.name = "Bund_%s" % body.id
				parent.add_child(bund)
			var surface := _polygon_slab(points, -0.35, Color("#3f7f9c"))
			if surface:
				surface.name = "Tank_%s" % body.id
				var water_material := _material(Color("#3f7f9c"), 0.12, 0.25)
				water_material.metallic_specular = 0.9
				surface.material_override = water_material
				parent.add_child(surface)
			_occupy(points, 6.0)
		elif body.has("line"):
			var line := unpack(body.line)
			if line.size() < 2:
				continue
			var width := float(body.get("width", 3.0))
			var channel := _ribbon(line, width, -0.6, Color("#3f7f9c"))
			if channel:
				channel.name = "Canal_%s" % body.id
				parent.add_child(channel)
			var bank := _ribbon(line, width + 5.0, -0.05, Color("#8a7350"))
			if bank:
				bank.name = "CanalBank_%s" % body.id
				bank.position.y = -0.04
				parent.add_child(bank)


# ------------------------------------------------------------------ roads
func _build_roads() -> void:
	var parent := Node3D.new()
	parent.name = "Roads"
	add_child(parent)

	var surface_colours := {
		"highway": Color("#3b3b3d"),
		"arterial": Color("#403f40"),
		"collector": Color("#454345"),
		"neighbourhood": Color("#4a4744"),
		"lane": Color("#514c45"),
		"track": Color("#8a7450"),
		"path": Color("#9b8763"),
	}

	for road in world.roads:
		var points := unpack(road.points)
		if points.size() < 2:
			continue
		var width := float(road.width)
		var road_class := String(road["class"])
		var colour: Color = surface_colours.get(road_class, Color("#464646"))

		# Shoulder / verge first, then the carriageway on top.
		if road_class in ["highway", "arterial", "collector"]:
			var shoulder := _ribbon(points, width + 4.0, ROAD_Y - 0.01, Color("#7e6c4c"))
			if shoulder:
				shoulder.name = "Shoulder_%s" % road.id
				parent.add_child(shoulder)

		var surface := _ribbon(points, width, ROAD_Y, colour)
		if surface:
			surface.name = "Road_%s" % road.id
			surface.set_meta("osm_id", road.osm_id)
			surface.set_meta("name", road.name)
			parent.add_child(surface)
		_occupy_polyline(points, width * 0.5 + 0.6)

		# Lane markings on the classified network only, exactly like the real roads here.
		if road_class in ["highway", "arterial"]:
			var centre := _dashed_line(points, 0.18, Color("#e8e4d0"), 4.0, 6.0)
			if centre:
				centre.name = "Centreline_%s" % road.id
				parent.add_child(centre)
			for side in [-1.0, 1.0]:
				var edge := _offset_polyline(points, side * (width * 0.5 - 0.35))
				var edge_mesh := _ribbon(edge, 0.14, MARKING_Y, Color("#e8e4d0"))
				if edge_mesh:
					edge_mesh.name = "EdgeLine_%s_%d" % [road.id, int(side)]
					parent.add_child(edge_mesh)

		if bool(road.get("drivable", false)):
			var world_points: Array[Vector3] = []
			for p in points:
				world_points.append(plane_to_world(p.x, p.y))
			road_graph.append({
				"name": road.name,
				"class": road_class,
				"width": width,
				"points": world_points,
			})


func _build_railways() -> void:
	var rails: Array = world.get("railways", [])
	if rails.is_empty():
		return
	var parent := Node3D.new()
	parent.name = "Railways"
	add_child(parent)
	for rail in rails:
		var points := unpack(rail.points)
		if points.size() < 2:
			continue
		var ballast := _ribbon(points, 4.6, 0.08, Color("#6f6a62"))
		if ballast:
			parent.add_child(ballast)
		for side in [-0.72, 0.72]:
			var offset := _offset_polyline(points, side)
			var steel := _ribbon(offset, 0.14, 0.20, Color("#4a4440"))
			if steel:
				parent.add_child(steel)


# ------------------------------------------------------------------ buildings
func _build_osm_buildings() -> int:
	var parent := Node3D.new()
	parent.name = "BuildingsOSM"
	add_child(parent)
	var built := 0
	for building in world.buildings:
		var outline := unpack(building.outline)
		if outline.size() < 3:
			continue
		var height := float(building.height)
		var node := _extruded_building(outline, height, String(building.get("type", "yes")), String(building.get("amenity", "")))
		if node == null:
			continue
		node.name = "Building_%s" % building.id
		node.set_meta("osm", true)
		node.set_meta("osm_id", building.id)
		parent.add_child(node)
		_occupy(outline, 1.0)
		built += 1
		var bname := String(building.get("name", ""))
		if bname != "":
			var centre := Vector2(float(building.cx), float(building.cy))
			landmarks.append({
				"id": building.id,
				"name": bname,
				"kind": String(building.get("amenity", "building")),
				"position": plane_to_world(centre.x, centre.y),
			})
	return built


## Streets that OSM has mapped but nobody has traced buildings along still need a townscape.
## Plots are laid out along the real street geometry with Indian small-town proportions:
## 6-11 m frontage, 2-5 m setback, compound wall, flat RCC roof with a parapet and a tank.
func _build_infill_buildings() -> int:
	var parent := Node3D.new()
	parent.name = "BuildingsInfill"
	parent.set_meta("procedural_infill", true)
	add_child(parent)

	var built := 0
	var budget := 2600
	var streets: Array = []
	for road in world.roads:
		if String(road["class"]) in ["neighbourhood", "lane", "collector", "arterial"]:
			streets.append(road)
	# Densest streets first so the core of town fills up before the outskirts.
	streets.sort_custom(func(a, b): return _distance_to_centre(a) < _distance_to_centre(b))

	for road in streets:
		if built >= budget:
			break
		var points := unpack(road.points)
		if points.size() < 2:
			continue
		var road_class := String(road["class"])
		var half_width := float(road.width) * 0.5
		var centre_distance := _distance_to_centre(road)
		# Density falls off away from the town centre, like the real settlement pattern.
		var density := clampf(1.35 - centre_distance / 2200.0, 0.18, 1.0)
		var is_main := road_class in ["arterial", "collector"]

		for side in [-1.0, 1.0]:
			var travelled := rng.randf_range(0.0, 9.0)
			var total := _polyline_length(points)
			while travelled < total - 8.0 and built < budget:
				var frontage := rng.randf_range(6.5, 11.5)
				if rng.randf() > density:
					travelled += frontage + rng.randf_range(1.0, 12.0)
					continue
				var sample := _sample_polyline(points, travelled + frontage * 0.5)
				var position: Vector2 = sample.position
				var tangent: Vector2 = sample.tangent
				var normal: Vector2 = Vector2(-tangent.y, tangent.x) * side
				var setback := rng.randf_range(1.8, 4.0)
				var depth := rng.randf_range(7.0, 13.0)
				var centre: Vector2 = position + normal * (half_width + setback + depth * 0.5)
				if abs(centre.x) > half_x - 20.0 or abs(centre.y) > half_y - 20.0:
					travelled += frontage
					continue
				var footprint := Rect2(centre - Vector2(frontage, depth) * 0.5, Vector2(frontage, depth)).grow(0.4)
				if _is_occupied(footprint):
					travelled += frontage + 1.0
					continue

				var levels := 1
				var roll := rng.randf()
				if is_main:
					levels = 2 if roll < 0.55 else (3 if roll < 0.85 else 1)
				else:
					levels = 1 if roll < 0.55 else (2 if roll < 0.92 else 3)
				var height := 3.1 * float(levels) + rng.randf_range(-0.2, 0.3)
				var angle := atan2(tangent.y, tangent.x)
				var node := _plot_building(centre, Vector2(frontage, depth), angle, height, levels, is_main, normal)
				node.name = "Infill_%d" % built
				node.set_meta("procedural_infill", true)
				parent.add_child(node)
				_mark_rect(_blocked, footprint)
				built += 1
				travelled += frontage + rng.randf_range(0.2, 1.6)
	return built


func _distance_to_centre(road: Dictionary) -> float:
	var points: Array = road.points
	if points.size() < 2:
		return 9999.0
	var mid := int(points.size() / 4) * 2
	return Vector2(float(points[mid]), float(points[mid + 1])).length()


## One walled plot: compound wall, gate, house block, parapet, water tank, sunshades.
func _plot_building(centre: Vector2, size: Vector2, angle: float, height: float, levels: int, shopfront: bool, street_normal: Vector2) -> Node3D:
	var root := Node3D.new()
	root.position = plane_to_world(centre.x, centre.y)
	root.rotation.y = -angle

	var wall_colour: Color = WALL_COLOURS[rng.randi() % WALL_COLOURS.size()]
	var trim_colour: Color = TRIM_COLOURS[rng.randi() % TRIM_COLOURS.size()]

	var body_size := Vector3(size.x * rng.randf_range(0.72, 0.92), height, size.y * rng.randf_range(0.65, 0.85))
	_add_box(root, body_size, Vector3(0.0, height * 0.5, 0.0), wall_colour, "House")
	# Parapet wall around the flat roof.
	_add_box(root, Vector3(body_size.x + 0.22, 0.55, 0.22), Vector3(0.0, height + 0.27, -body_size.z * 0.5), trim_colour, "ParapetN")
	_add_box(root, Vector3(body_size.x + 0.22, 0.55, 0.22), Vector3(0.0, height + 0.27, body_size.z * 0.5), trim_colour, "ParapetS")
	_add_box(root, Vector3(0.22, 0.55, body_size.z), Vector3(-body_size.x * 0.5, height + 0.27, 0.0), trim_colour, "ParapetW")
	_add_box(root, Vector3(0.22, 0.55, body_size.z), Vector3(body_size.x * 0.5, height + 0.27, 0.0), trim_colour, "ParapetE")
	# Black plastic overhead water tank - on practically every roof in town.
	var tank := MeshInstance3D.new()
	var tank_mesh := CylinderMesh.new()
	tank_mesh.top_radius = 0.42
	tank_mesh.bottom_radius = 0.48
	tank_mesh.height = 0.9
	tank_mesh.radial_segments = 10
	tank_mesh.material = _material(Color("#1d1d1f"), 0.7)
	tank.mesh = tank_mesh
	tank.position = Vector3(body_size.x * 0.28, height + 0.95, body_size.z * 0.24)
	root.add_child(tank)

	# Windows and sunshades on the street face.
	var face_z := -body_size.z * 0.5 - 0.06
	for level in range(levels):
		var y := 1.25 + float(level) * 3.1
		if y + 0.8 > height:
			break
		for i in range(2):
			var x := (float(i) - 0.5) * body_size.x * 0.46
			_add_box(root, Vector3(0.95, 1.05, 0.08), Vector3(x, y, face_z), Color("#2d3a42"), "Window")
			_add_box(root, Vector3(1.25, 0.10, 0.45), Vector3(x, y + 0.62, face_z - 0.18), trim_colour, "Sunshade")

	if shopfront:
		# Roller shutter and a painted signboard, the standard main-road ground floor.
		var shutter: Color = SHUTTER_COLOURS[rng.randi() % SHUTTER_COLOURS.size()]
		_add_box(root, Vector3(body_size.x * 0.74, 2.3, 0.12), Vector3(0.0, 1.15, face_z - 0.04), shutter, "Shutter")
		_add_box(root, Vector3(body_size.x * 0.86, 0.75, 0.14), Vector3(0.0, 2.85, face_z - 0.10), trim_colour, "Signboard")
		_add_box(root, Vector3(body_size.x * 0.88, 0.12, 1.5), Vector3(0.0, 3.35, face_z - 0.70), Color("#2f6b56"), "Awning")
	else:
		# Compound wall with a gate.
		var wall_z := -size.y * 0.5
		var gate_w := 2.4
		var run := (size.x - gate_w) * 0.5
		if run > 0.5:
			for side in [-1.0, 1.0]:
				_add_box(root, Vector3(run, 1.6, 0.20), Vector3(side * (gate_w + run) * 0.5, 0.80, wall_z), wall_colour.darkened(0.12), "CompoundWall")
				_add_box(root, Vector3(run, 0.10, 0.26), Vector3(side * (gate_w + run) * 0.5, 1.63, wall_z), trim_colour, "WallCoping")
		# Gate pillars and a painted steel gate.
		for side in [-1.0, 1.0]:
			_add_box(root, Vector3(0.28, 1.95, 0.28), Vector3(side * gate_w * 0.5, 0.97, wall_z), wall_colour.darkened(0.2), "GatePillar")
		_add_box(root, Vector3(gate_w, 1.35, 0.08), Vector3(0.0, 0.68, wall_z), trim_colour, "Gate")
		_add_box(root, Vector3(0.9, 2.05, 0.1), Vector3(0.0, 1.02, face_z), Color("#4a3a28"), "Door")
		# Plinth: houses here sit a step above the street.
		_add_box(root, Vector3(size.x * 0.9, 0.35, size.y * 0.8), Vector3(0.0, 0.17, 0.0), wall_colour.darkened(0.3), "Plinth")

	# Collision: a single box is enough and keeps the physics broadphase cheap.
	var body := StaticBody3D.new()
	body.collision_layer = 1
	body.collision_mask = 0
	var collider := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(body_size.x, height, body_size.z)
	collider.shape = shape
	collider.position = Vector3(0.0, height * 0.5, 0.0)
	body.add_child(collider)
	root.add_child(body)
	return root


## Extrudes a real OSM footprint into walls + roof with collision.
func _extruded_building(outline: PackedVector2Array, height: float, type: String, amenity: String) -> Node3D:
	var root := Node3D.new()
	var centre := Vector2.ZERO
	for p in outline:
		centre += p
	centre /= float(outline.size())
	root.position = plane_to_world(centre.x, centre.y)

	var local: PackedVector2Array = PackedVector2Array()
	for p in outline:
		local.append(p - centre)

	var wall_colour: Color = WALL_COLOURS[abs(hash(type + str(outline.size()))) % WALL_COLOURS.size()]
	if amenity in ["place_of_worship", "hindu", "temple"]:
		wall_colour = Color("#f2e3c6")
	elif type in ["school", "college", "university"]:
		wall_colour = Color("#f0ddb8")
	elif type in ["industrial", "warehouse"]:
		wall_colour = Color("#c9ccc8")

	var walls := _wall_mesh(local, height, wall_colour)
	if walls == null:
		return null
	walls.name = "Walls"
	root.add_child(walls)

	var roof := _polygon_mesh(local, height, wall_colour.darkened(0.25))
	if roof:
		roof.name = "Roof"
		root.add_child(roof)

	# Parapet around the roof edge.
	var parapet := _wall_mesh(local, 0.5, wall_colour.darkened(0.12))
	if parapet:
		parapet.name = "Parapet"
		parapet.position.y = height
		root.add_child(parapet)

	# Gopuram-ish tower for temples so the skyline reads correctly.
	if amenity in ["place_of_worship", "hindu", "temple"] or type == "temple":
		var tower := MeshInstance3D.new()
		var tower_mesh := CylinderMesh.new()
		tower_mesh.top_radius = 0.6
		tower_mesh.bottom_radius = 2.0
		tower_mesh.height = 7.0
		tower_mesh.radial_segments = 8
		tower_mesh.material = _material(Color("#f6e7c5"), 0.8)
		tower.mesh = tower_mesh
		tower.position = Vector3(0.0, height + 3.5, 0.0)
		root.add_child(tower)
		var finial := MeshInstance3D.new()
		var finial_mesh := SphereMesh.new()
		finial_mesh.radius = 0.55
		finial_mesh.height = 1.1
		finial_mesh.material = _material(Color("#c9a227"), 0.25, 0.8)
		finial.mesh = finial_mesh
		finial.position = Vector3(0.0, height + 7.4, 0.0)
		root.add_child(finial)

	var body := StaticBody3D.new()
	body.collision_layer = 1
	body.collision_mask = 0
	var collider := CollisionShape3D.new()
	var shape := ConvexPolygonShape3D.new()
	var hull := PackedVector3Array()
	for p in local:
		hull.append(Vector3(p.x, 0.0, -p.y))
		hull.append(Vector3(p.x, height, -p.y))
	shape.points = hull
	collider.shape = shape
	body.add_child(collider)
	root.add_child(body)
	return root


# ------------------------------------------------------------------ POIs
func _build_pois() -> void:
	var parent := Node3D.new()
	parent.name = "PointsOfInterest"
	add_child(parent)

	var icon_colours := {
		"fuel": Color("#d94f3d"), "hospital": Color("#ffffff"), "clinic": Color("#ffffff"),
		"school": Color("#f0b429"), "college": Color("#f0b429"), "police": Color("#2b4a74"),
		"bus_station": Color("#2f6b56"), "theatre": Color("#8e44ad"), "place_of_worship": Color("#f2c14e"),
		"town": Color("#e8e4d0"), "village": Color("#e8e4d0"), "tractor": Color("#4b7f2f"),
	}

	for poi in world.pois:
		var kind := String(poi.kind)
		var pos := plane_to_world(float(poi.x), float(poi.y))
		landmarks.append({"id": poi.id, "name": String(poi.name), "kind": kind, "position": pos})
		if kind in ["town", "village", "suburb", "hamlet"]:
			continue  # place labels have no physical object

		var marker := Node3D.new()
		marker.name = "POI_%s" % poi.id
		marker.position = pos
		parent.add_child(marker)

		match kind:
			"fuel":
				_build_fuel_station(marker)
			"bus_station":
				_build_bus_station(marker)
			"place_of_worship":
				_build_temple(marker)
			_:
				var colour: Color = icon_colours.get(kind, Color("#cfcfcf"))
				# A signboard on two posts: the universal small-town shop/clinic board.
				_add_box(marker, Vector3(0.12, 2.6, 0.12), Vector3(-1.4, 1.3, 0.0), Color("#6d665c"), "Post")
				_add_box(marker, Vector3(0.12, 2.6, 0.12), Vector3(1.4, 1.3, 0.0), Color("#6d665c"), "Post")
				_add_box(marker, Vector3(3.2, 1.0, 0.12), Vector3(0.0, 2.7, 0.0), colour, "Board")

		var label := Label3D.new()
		label.text = String(poi.name)
		label.position = Vector3(0.0, 4.0, 0.0)
		label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		label.font_size = 48
		label.pixel_size = 0.012
		label.outline_size = 14
		label.modulate = Color(1, 1, 1)
		label.outline_modulate = Color(0, 0, 0, 0.85)
		label.no_depth_test = false
		label.visibility_range_end = 160.0
		marker.add_child(label)


func _build_fuel_station(parent: Node3D) -> void:
	_add_box(parent, Vector3(16.0, 0.12, 11.0), Vector3(0, 0.08, 0), Color("#b9b4ab"), "Forecourt")
	for i in range(2):
		var x := -3.0 + float(i) * 6.0
		_add_box(parent, Vector3(1.1, 1.9, 0.8), Vector3(x, 0.95, 0), Color("#d94f3d"), "Pump")
		_add_box(parent, Vector3(0.9, 0.5, 0.6), Vector3(x, 2.1, 0), Color("#f2efe6"), "PumpHead")
	for sx in [-1.0, 1.0]:
		for sz in [-1.0, 1.0]:
			_add_box(parent, Vector3(0.35, 5.0, 0.35), Vector3(sx * 6.0, 2.5, sz * 3.6), Color("#8e8880"), "Column")
	_add_box(parent, Vector3(14.0, 0.5, 9.0), Vector3(0, 5.2, 0), Color("#e7e3d8"), "Canopy")
	_add_box(parent, Vector3(14.2, 0.9, 0.2), Vector3(0, 4.7, -4.5), Color("#d94f3d"), "CanopyFascia")


func _build_bus_station(parent: Node3D) -> void:
	_add_box(parent, Vector3(34.0, 0.15, 20.0), Vector3(0, 0.08, 0), Color("#a9a49b"), "Apron")
	_add_box(parent, Vector3(26.0, 4.0, 7.0), Vector3(0, 2.0, 6.0), Color("#efe4cc"), "Terminal")
	_add_box(parent, Vector3(27.0, 0.4, 8.0), Vector3(0, 4.2, 6.0), Color("#8d6a4a"), "TerminalRoof")
	for i in range(4):
		_add_box(parent, Vector3(0.3, 3.2, 0.3), Vector3(-9.0 + float(i) * 6.0, 1.6, -4.0), Color("#7d776e"), "ShelterPost")
	_add_box(parent, Vector3(24.0, 0.25, 4.0), Vector3(0, 3.3, -4.0), Color("#2f6b56"), "ShelterRoof")
	_add_box(parent, Vector3(5.0, 1.0, 0.2), Vector3(0, 5.0, 2.6), Color("#2f6b56"), "StationBoard")


func _build_temple(parent: Node3D) -> void:
	_add_box(parent, Vector3(9.0, 4.0, 11.0), Vector3(0, 2.0, 0), Color("#f4e6c8"), "Mandapam")
	var vimana := MeshInstance3D.new()
	var mesh := CylinderMesh.new()
	mesh.top_radius = 0.7
	mesh.bottom_radius = 2.6
	mesh.height = 8.0
	mesh.radial_segments = 8
	mesh.material = _material(Color("#f0dcae"), 0.85)
	vimana.mesh = mesh
	vimana.position = Vector3(0, 8.0, 0)
	parent.add_child(vimana)
	_add_box(parent, Vector3(0.5, 7.0, 0.5), Vector3(-5.5, 3.5, -6.0), Color("#c0392b"), "Flagstaff")


# ------------------------------------------------------------------ furniture + planting
func _build_street_furniture() -> void:
	var parent := Node3D.new()
	parent.name = "StreetFurniture"
	add_child(parent)

	var pole_mesh := CylinderMesh.new()
	pole_mesh.top_radius = 0.11
	pole_mesh.bottom_radius = 0.16
	pole_mesh.height = 8.5
	pole_mesh.radial_segments = 6
	pole_mesh.material = _material(Color("#9a958c"), 0.9)

	var poles := MultiMeshInstance3D.new()
	poles.name = "ElectricPoles"
	var multimesh := MultiMesh.new()
	multimesh.transform_format = MultiMesh.TRANSFORM_3D
	multimesh.mesh = pole_mesh

	var transforms: Array[Transform3D] = []
	var lamps: Array[Vector3] = []
	for road in world.roads:
		var road_class := String(road["class"])
		if road_class in ["path", "track"]:
			continue
		var points := unpack(road.points)
		if points.size() < 2:
			continue
		var spacing := 38.0 if road_class in ["highway", "arterial"] else 46.0
		var total := _polyline_length(points)
		var travelled := spacing * 0.5
		var side := 1.0
		while travelled < total:
			var sample := _sample_polyline(points, travelled)
			var sample_tangent: Vector2 = sample.tangent
			var normal: Vector2 = Vector2(-sample_tangent.y, sample_tangent.x) * side
			var p: Vector2 = sample.position + normal * (float(road.width) * 0.5 + 1.6)
			if abs(p.x) < half_x and abs(p.y) < half_y:
				var t := Transform3D(Basis(), plane_to_world(p.x, p.y) + Vector3(0, 4.25, 0))
				transforms.append(t)
				if road_class in ["highway", "arterial", "collector"]:
					lamps.append(plane_to_world(p.x, p.y) + Vector3(0, 8.3, 0))
			travelled += spacing
			side = -side

	multimesh.instance_count = transforms.size()
	for i in range(transforms.size()):
		multimesh.set_instance_transform(i, transforms[i])
	poles.multimesh = multimesh
	parent.add_child(poles)

	# Lamp heads (visual only - real lights would be far too expensive at this count).
	var lamp_mesh := BoxMesh.new()
	lamp_mesh.size = Vector3(0.9, 0.16, 0.3)
	var lamp_material := _material(Color("#f6edc8"), 0.3, 0.0, Color("#ffd98a"))
	lamp_mesh.material = lamp_material
	var lamp_instances := MultiMeshInstance3D.new()
	lamp_instances.name = "StreetLamps"
	var lamp_multimesh := MultiMesh.new()
	lamp_multimesh.transform_format = MultiMesh.TRANSFORM_3D
	lamp_multimesh.mesh = lamp_mesh
	lamp_multimesh.instance_count = lamps.size()
	for i in range(lamps.size()):
		lamp_multimesh.set_instance_transform(i, Transform3D(Basis(), lamps[i]))
	lamp_instances.multimesh = lamp_multimesh
	parent.add_child(lamp_instances)
	_stats["street_poles"] = transforms.size()


func _build_vegetation() -> void:
	var parent := Node3D.new()
	parent.name = "Vegetation"
	add_child(parent)

	# Neem/banyan style canopy trees along streets, palms scattered in the fields.
	var trunk_mesh := CylinderMesh.new()
	trunk_mesh.top_radius = 0.16
	trunk_mesh.bottom_radius = 0.24
	trunk_mesh.height = 3.2
	trunk_mesh.radial_segments = 6
	trunk_mesh.material = _material(Color("#5b4632"), 0.95)

	var canopy_mesh := SphereMesh.new()
	canopy_mesh.radius = 2.6
	canopy_mesh.height = 4.0
	canopy_mesh.radial_segments = 8
	canopy_mesh.rings = 4
	canopy_mesh.material = _material(Color("#3f6b35"), 0.95)

	var trunks: Array[Transform3D] = []
	var canopies: Array[Transform3D] = []

	for road in world.roads:
		if String(road["class"]) in ["path"]:
			continue
		var points := unpack(road.points)
		if points.size() < 2:
			continue
		var total := _polyline_length(points)
		var travelled := rng.randf_range(10.0, 40.0)
		while travelled < total:
			if rng.randf() < 0.45:
				var sample := _sample_polyline(points, travelled)
				var side := 1.0 if rng.randf() < 0.5 else -1.0
				var sample_tangent: Vector2 = sample.tangent
				var normal: Vector2 = Vector2(-sample_tangent.y, sample_tangent.x) * side
				var p: Vector2 = sample.position + normal * (float(road.width) * 0.5 + rng.randf_range(2.5, 5.0))
				if abs(p.x) < half_x and abs(p.y) < half_y and not _is_occupied(Rect2(p - Vector2(2, 2), Vector2(4, 4))):
					var base := plane_to_world(p.x, p.y)
					var scale := rng.randf_range(0.8, 1.45)
					trunks.append(Transform3D(Basis().scaled(Vector3(1, scale, 1)), base + Vector3(0, 1.6 * scale, 0)))
					canopies.append(Transform3D(Basis().scaled(Vector3.ONE * scale), base + Vector3(0, 3.2 * scale + 1.2, 0)))
			travelled += rng.randf_range(16.0, 42.0)

	for i in range(1400):
		var p := Vector2(rng.randf_range(-half_x, half_x), rng.randf_range(-half_y, half_y))
		if _is_occupied(Rect2(p - Vector2(4, 4), Vector2(8, 8))):
			continue
		var base := plane_to_world(p.x, p.y)
		var scale := rng.randf_range(0.6, 1.2)
		trunks.append(Transform3D(Basis().scaled(Vector3(1, scale, 1)), base + Vector3(0, 1.6 * scale, 0)))
		canopies.append(Transform3D(Basis().scaled(Vector3.ONE * scale), base + Vector3(0, 3.2 * scale + 1.2, 0)))

	parent.add_child(_multimesh_node("TreeTrunks", trunk_mesh, trunks))
	parent.add_child(_multimesh_node("TreeCanopies", canopy_mesh, canopies))
	_stats["trees"] = trunks.size()


func _multimesh_node(node_name: String, mesh: Mesh, transforms: Array[Transform3D]) -> MultiMeshInstance3D:
	var node := MultiMeshInstance3D.new()
	node.name = node_name
	var multimesh := MultiMesh.new()
	multimesh.transform_format = MultiMesh.TRANSFORM_3D
	multimesh.mesh = mesh
	multimesh.instance_count = transforms.size()
	for i in range(transforms.size()):
		multimesh.set_instance_transform(i, transforms[i])
	node.multimesh = multimesh
	return node


func _build_boundary() -> void:
	# Invisible walls so the player cannot ride off the imported extract.
	var body := StaticBody3D.new()
	body.name = "WorldBounds"
	body.collision_layer = 1
	body.collision_mask = 0
	add_child(body)
	var thickness := 10.0
	var height := 40.0
	var sides := [
		[Vector3(0, height * 0.5, -half_y - thickness), Vector3(half_x * 2 + thickness * 4, height, thickness)],
		[Vector3(0, height * 0.5, half_y + thickness), Vector3(half_x * 2 + thickness * 4, height, thickness)],
		[Vector3(-half_x - thickness, height * 0.5, 0), Vector3(thickness, height, half_y * 2 + thickness * 4)],
		[Vector3(half_x + thickness, height * 0.5, 0), Vector3(thickness, height, half_y * 2 + thickness * 4)],
	]
	for side in sides:
		var collider := CollisionShape3D.new()
		var shape := BoxShape3D.new()
		shape.size = side[1]
		collider.shape = shape
		collider.position = side[0]
		body.add_child(collider)


# ------------------------------------------------------------------ mesh helpers
func _add_box(parent: Node3D, size: Vector3, position: Vector3, colour: Color, node_name := "Box") -> MeshInstance3D:
	var mesh := BoxMesh.new()
	mesh.size = size
	mesh.material = _material(colour, 0.88)
	var node := MeshInstance3D.new()
	node.name = node_name
	node.mesh = mesh
	node.position = position
	parent.add_child(node)
	return node


## Flat ribbon mesh following a polyline, used for roads, markings and canals.
func _ribbon(points: PackedVector2Array, width: float, y: float, colour: Color) -> MeshInstance3D:
	if points.size() < 2:
		return null
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var uvs := PackedVector2Array()
	var indices := PackedInt32Array()
	var half := width * 0.5
	var distance := 0.0

	for i in range(points.size()):
		var tangent: Vector2
		if i == 0:
			tangent = (points[1] - points[0]).normalized()
		elif i == points.size() - 1:
			tangent = (points[i] - points[i - 1]).normalized()
		else:
			tangent = ((points[i + 1] - points[i]) .normalized() + (points[i] - points[i - 1]).normalized()).normalized()
		if tangent.length() < 0.001:
			tangent = Vector2(1, 0)
		var normal := Vector2(-tangent.y, tangent.x)
		if i > 0:
			distance += points[i].distance_to(points[i - 1])
		var left := points[i] + normal * half
		var right := points[i] - normal * half
		vertices.append(plane_to_world(left.x, left.y) + Vector3(0, y, 0))
		vertices.append(plane_to_world(right.x, right.y) + Vector3(0, y, 0))
		normals.append(Vector3.UP)
		normals.append(Vector3.UP)
		uvs.append(Vector2(0.0, distance / max(width, 0.5)))
		uvs.append(Vector2(1.0, distance / max(width, 0.5)))

	for i in range(points.size() - 1):
		var base := i * 2
		indices.append_array([base, base + 2, base + 1, base + 1, base + 2, base + 3])

	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.material_override = _material(colour, 0.95)
	return node


func _dashed_line(points: PackedVector2Array, width: float, colour: Color, dash: float, gap: float) -> Node3D:
	var total := _polyline_length(points)
	if total < dash * 2.0:
		return null
	var root := Node3D.new()
	var travelled := 0.0
	while travelled + dash < total:
		var a := _sample_polyline(points, travelled)
		var b := _sample_polyline(points, travelled + dash)
		var segment := PackedVector2Array([a.position, b.position])
		var mesh := _ribbon(segment, width, MARKING_Y, colour)
		if mesh:
			root.add_child(mesh)
		travelled += dash + gap
	return root


func _offset_polyline(points: PackedVector2Array, offset: float) -> PackedVector2Array:
	var result := PackedVector2Array()
	for i in range(points.size()):
		var tangent: Vector2
		if i == 0:
			tangent = (points[1] - points[0]).normalized()
		elif i == points.size() - 1:
			tangent = (points[i] - points[i - 1]).normalized()
		else:
			tangent = ((points[i + 1] - points[i]).normalized() + (points[i] - points[i - 1]).normalized()).normalized()
		var normal := Vector2(-tangent.y, tangent.x)
		result.append(points[i] + normal * offset)
	return result


func _polygon_mesh(points: PackedVector2Array, y: float, colour: Color) -> MeshInstance3D:
	if points.size() < 3:
		return null
	var triangles := Geometry2D.triangulate_polygon(points)
	if triangles.is_empty():
		return null
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var uvs := PackedVector2Array()
	for index in triangles:
		var p := points[index]
		vertices.append(Vector3(p.x, y, -p.y))
		normals.append(Vector3.UP)
		uvs.append(p * 0.08)
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.material_override = _material(colour, 0.95)
	return node


func _polygon_slab(points: PackedVector2Array, y: float, colour: Color) -> MeshInstance3D:
	return _polygon_mesh(points, y, colour)


## Vertical wall band following a closed ring (used for building walls, parapets, bunds).
func _wall_mesh(points: PackedVector2Array, height: float, colour: Color) -> MeshInstance3D:
	if points.size() < 3:
		return null
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var uvs := PackedVector2Array()
	var count := points.size()
	for i in range(count):
		var a := points[i]
		var b := points[(i + 1) % count]
		var edge := b - a
		if edge.length() < 0.01:
			continue
		var normal := Vector3(edge.y, 0.0, edge.x).normalized()
		var a0 := Vector3(a.x, 0.0, -a.y)
		var b0 := Vector3(b.x, 0.0, -b.y)
		var a1 := Vector3(a.x, height, -a.y)
		var b1 := Vector3(b.x, height, -b.y)
		var length := edge.length()
		vertices.append_array([a0, b0, a1, a1, b0, b1])
		for j in range(6):
			normals.append(normal)
		uvs.append_array([
			Vector2(0, 0), Vector2(length * 0.25, 0), Vector2(0, height * 0.33),
			Vector2(0, height * 0.33), Vector2(length * 0.25, 0), Vector2(length * 0.25, height * 0.33),
		])
	if vertices.is_empty():
		return null
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.material_override = _material(colour, 0.92)
	return node


func _polygon_outline_wall(points: PackedVector2Array, height: float, thickness: float, colour: Color) -> MeshInstance3D:
	var expanded := Geometry2D.offset_polygon(points, thickness)
	if expanded.is_empty():
		return null
	return _wall_mesh(expanded[0], height, colour)


# ------------------------------------------------------------------ polyline maths
static func _polyline_length(points: PackedVector2Array) -> float:
	var total := 0.0
	for i in range(1, points.size()):
		total += points[i].distance_to(points[i - 1])
	return total


static func _sample_polyline(points: PackedVector2Array, distance: float) -> Dictionary:
	var travelled := 0.0
	for i in range(1, points.size()):
		var segment := points[i] - points[i - 1]
		var length := segment.length()
		if length < 0.0001:
			continue
		if travelled + length >= distance:
			var t := (distance - travelled) / length
			return {"position": points[i - 1].lerp(points[i], t), "tangent": segment / length}
		travelled += length
	var last := points.size() - 1
	var tangent := (points[last] - points[max(0, last - 1)])
	if tangent.length() < 0.0001:
		tangent = Vector2(1, 0)
	return {"position": points[last], "tangent": tangent.normalized()}


static func _cell_key(x: float, y: float) -> int:
	# Pack a 4 m cell into a single int so the Dictionary lookup stays cheap.
	return int(floor(x / CELL)) * 100000 + int(floor(y / CELL))


## Marks exactly the cells the rectangle covers - no extra ring, or plots lose a metre
## of frontage on every side and the streets end up with gaps.
func _mark_rect(target: Dictionary, rect: Rect2) -> void:
	var cx := floor(rect.position.x / CELL)
	var cx_end := floor(rect.end.x / CELL)
	var cy_start := floor(rect.position.y / CELL)
	var cy_end := floor(rect.end.y / CELL)
	while cx <= cx_end:
		var cy := cy_start
		while cy <= cy_end:
			target[int(cx) * 100000 + int(cy)] = true
			cy += 1.0
		cx += 1.0


func _rect_hits(target: Dictionary, rect: Rect2) -> bool:
	var cx := floor(rect.position.x / CELL)
	var cx_end := floor(rect.end.x / CELL)
	var cy_start := floor(rect.position.y / CELL)
	var cy_end := floor(rect.end.y / CELL)
	while cx <= cx_end:
		var cy := cy_start
		while cy <= cy_end:
			if target.has(int(cx) * 100000 + int(cy)):
				return true
			cy += 1.0
		cx += 1.0
	return false


func _occupy(points: PackedVector2Array, margin: float) -> void:
	if points.is_empty():
		return
	var rect := Rect2(points[0], Vector2.ZERO)
	for p in points:
		rect = rect.expand(p)
	_mark_rect(_blocked, rect.grow(margin))


## Stamps the carriageway itself (not its bounding box) into the road layer.
func _occupy_polyline(points: PackedVector2Array, margin: float) -> void:
	for i in range(1, points.size()):
		var a := points[i - 1]
		var b := points[i]
		var length := a.distance_to(b)
		var steps := int(ceil(length / (CELL * 0.5))) + 1
		for step in range(steps + 1):
			var p := a.lerp(b, float(step) / float(steps))
			_mark_rect(_road_cells, Rect2(p - Vector2(margin, margin), Vector2(margin, margin) * 2.0))


func _is_occupied(rect: Rect2) -> bool:
	return _rect_hits(_blocked, rect) or _rect_hits(_road_cells, rect)


func _is_blocked(rect: Rect2) -> bool:
	return _rect_hits(_blocked, rect)


## Nearest point on the drivable network - used to place the player and traffic on tarmac.
func nearest_road_point(from: Vector3) -> Dictionary:
	var best := {"position": Vector3.ZERO, "direction": Vector3.FORWARD, "distance": INF, "name": ""}
	for road in road_graph:
		var points: Array = road.points
		for i in range(1, points.size()):
			var a: Vector3 = points[i - 1]
			var b: Vector3 = points[i]
			var closest := Geometry3D.get_closest_point_to_segment(from, a, b)
			var distance := closest.distance_to(from)
			if distance < best.distance:
				best = {
					"position": closest,
					"direction": (b - a).normalized(),
					"distance": distance,
					"name": road.name,
				}
	return best
