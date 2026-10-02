class_name DarsiWorldBuilder
extends Node3D
## Builds a small, mobile-friendly town from the geographic manifest.
## Roads and POIs are projected from WGS84 into metres; decorative geometry is procedural.

var anchor_lat := 15.7667
var anchor_lon := 79.6833
var road_materials: Dictionary = {}
var landmarks_runtime: Array[Dictionary] = []
var rng := RandomNumberGenerator.new()

const EAST_METRES_PER_DEGREE := 111320.0
const NORTH_METRES_PER_DEGREE := 110540.0

func build(map_data: Dictionary) -> Array[Dictionary]:
	rng.seed = 523247
	anchor_lat = float(map_data.place.anchor.lat)
	anchor_lon = float(map_data.place.anchor.lon)
	_create_ground(map_data.world.extent_m)
	for road in map_data.roads:
		_build_road(road, map_data.world.road_widths_m)
	for field in map_data.fields:
		_build_field(field)
	_build_town_decoration(map_data)
	for landmark in map_data.landmarks:
		var projected := latlon_to_world(float(landmark.lat), float(landmark.lon))
		_build_landmark(landmark, projected)
		landmarks_runtime.append({"id": landmark.id, "name": landmark.name, "kind": landmark.kind, "position": projected})
	return landmarks_runtime

func latlon_to_world(lat: float, lon: float) -> Vector3:
	var x := (lon - anchor_lon) * EAST_METRES_PER_DEGREE * cos(deg_to_rad(anchor_lat))
	var z := -(lat - anchor_lat) * NORTH_METRES_PER_DEGREE
	return Vector3(x, 0.0, z)

func _material(color: Color, roughness := 0.9, emission := Color.BLACK) -> StandardMaterial3D:
	var key := "%s_%s_%s" % [color.to_html(false), str(roughness), emission.to_html(false)]
	if road_materials.has(key):
		return road_materials[key]
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.roughness = roughness
	if emission != Color.BLACK:
		mat.emission_enabled = true
		mat.emission = emission
		mat.emission_energy_multiplier = 1.4
	road_materials[key] = mat
	return mat

func _mesh_box(parent: Node3D, size: Vector3, position: Vector3, color: Color, collision := false, name := "Box") -> Node3D:
	var node: Node3D
	if collision:
		var body := StaticBody3D.new()
		body.name = name
		var collider := CollisionShape3D.new()
		var shape := BoxShape3D.new()
		shape.size = size
		collider.shape = shape
		body.add_child(collider)
		node = body
	else:
		var mesh_instance := MeshInstance3D.new()
		mesh_instance.name = name
		node = mesh_instance
	var mesh := BoxMesh.new()
	mesh.size = size
	mesh.material = _material(color)
	if node is MeshInstance3D:
		node.mesh = mesh
	else:
		var visual := MeshInstance3D.new()
		visual.mesh = mesh
		node.add_child(visual)
	node.position = position
	parent.add_child(node)
	return node

func _mesh_cylinder(parent: Node3D, radius: float, height: float, position: Vector3, color: Color, name := "Cylinder") -> MeshInstance3D:
	var node := MeshInstance3D.new()
	node.name = name
	var mesh := CylinderMesh.new()
	mesh.top_radius = radius
	mesh.bottom_radius = radius * 1.05
	mesh.height = height
	mesh.radial_segments = 8
	mesh.material = _material(color)
	node.mesh = mesh
	node.position = position
	parent.add_child(node)
	return node

func _create_ground(extent: Dictionary) -> void:
	var ground := StaticBody3D.new()
	ground.name = "DarsiGround"
	var visual := MeshInstance3D.new()
	var mesh := PlaneMesh.new()
	mesh.size = Vector2(float(extent.east - extent.west), float(extent.north - extent.south))
	mesh.material = _material(Color("#aa9b68"), 1.0)
	visual.mesh = mesh
	visual.position = Vector3((extent.east + extent.west) * 0.5, -0.18, (extent.north + extent.south) * 0.5)
	ground.add_child(visual)
	var collider := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(float(extent.east - extent.west), 0.35, float(extent.north - extent.south))
	collider.shape = shape
	collider.position = visual.position
	ground.add_child(collider)
	add_child(ground)

func _build_road(road: Dictionary, widths: Dictionary) -> void:
	var points: Array = road.points
	var road_class: String = String(road["class"])
	var road_width := float(widths.get(road_class, widths["neighbourhood"]))
	var road_root := Node3D.new()
	road_root.name = String(road.id)
	add_child(road_root)
	for i in range(points.size() - 1):
		var a := latlon_to_world(float(points[i][0]), float(points[i][1]))
		var b := latlon_to_world(float(points[i + 1][0]), float(points[i + 1][1]))
		var delta := b - a
		var length := Vector2(delta.x, delta.z).length()
		if length < 1.0:
			continue
		var center := (a + b) * 0.5
		var segment := _mesh_box(road_root, Vector3(road_width, 0.12, length + 0.8), center + Vector3(0, -0.07, 0), Color("#4e4c46"), true, "RoadSurface")
		segment.rotation.y = atan2(delta.x, delta.z)
		# Pale edge strips and a broken centre line keep the low-poly road legible on mobile.
		var edge_color := Color("#c4b88a") if road_class == "highway" else Color("#8c8060")
		for side in [-1.0, 1.0]:
			var edge := _mesh_box(road_root, Vector3(0.10, 0.018, length), center + Vector3(0, 0.012, 0), edge_color, false, "RoadEdge")
			edge.rotation.y = atan2(delta.x, delta.z)
			edge.position += Vector3(cos(atan2(delta.x, delta.z)) * side * road_width * 0.43, 0, -sin(atan2(delta.x, delta.z)) * side * road_width * 0.43)
		if road_class == "highway" or road_class == "arterial":
			var dash_count := max(1, int(length / 12.0))
			for dash in range(dash_count):
				if dash % 2 == 0:
					var t := (float(dash) + 0.5) / float(dash_count)
					var mark_pos := a.lerp(b, t) + Vector3(0, 0.02, 0)
					var marking := _mesh_box(road_root, Vector3(0.12, 0.02, min(4.0, length / float(dash_count) * 0.65)), mark_pos, Color("#e8d9a1"), false, "CentreMark")
					marking.rotation.y = atan2(delta.x, delta.z)

func _build_field(field: Dictionary) -> void:
	var center := latlon_to_world(float(field.center[0]), float(field.center[1]))
	var size := Vector2(float(field.size_m[0]), float(field.size_m[1]))
	var crop_colors := {"groundnut": Color("#a58e48"), "cotton": Color("#b6a054"), "millet": Color("#9f8842"), "red gram": Color("#98813c")}
	var field_node := Node3D.new()
	field_node.name = "Field_%s" % field.id
	add_child(field_node)
	_mesh_box(field_node, Vector3(size.x, 0.04, size.y), center + Vector3(0, -0.05, 0), crop_colors.get(field.crop, Color("#a28c4c")), false, "Field")
	var rows := int(size.x / 18.0)
	for i in range(rows):
		var x := -size.x * 0.5 + 9.0 + i * 18.0
		var row := _mesh_box(field_node, Vector3(0.18, 0.09, size.y - 14.0), center + Vector3(x, 0.03, 0), Color("#776a37"), false, "CropRow")
		row.rotation.y = deg_to_rad(2.0 if i % 2 == 0 else -2.0)

func _build_town_decoration(map_data: Dictionary) -> void:
	# The starter world intentionally uses instanced-looking simple meshes rather than large textures.
	# A deterministic seed makes map regeneration and bug reports reproducible.
	for i in range(46):
		var angle := rng.randf_range(0.0, TAU)
		var radius := rng.randf_range(220.0, 1180.0)
		var position := Vector3(cos(angle) * radius, 0, sin(angle) * radius * 0.78)
		if i < 28:
			_build_house(position, i)
		else:
			_build_tree(position, 0.8 + rng.randf() * 0.6)
	for i in range(22):
		var x := -900.0 + i * 86.0
		_build_power_pole(Vector3(x, 0, -680.0 + sin(i * 0.7) * 120.0), i)

func _build_house(position: Vector3, index: int) -> void:
	var house := Node3D.new()
	house.name = "Home_%02d" % index
	add_child(house)
	var width := rng.randf_range(8.0, 15.0)
	var depth := rng.randf_range(7.0, 13.0)
	var height := rng.randf_range(3.3, 6.0)
	var walls := [Color("#d6b58a"), Color("#c89c75"), Color("#e0caa2"), Color("#b7c0a0")][index % 4]
	_mesh_box(house, Vector3(width, height, depth), position + Vector3(0, height * 0.5, 0), walls, false, "House")
	var roof := _mesh_box(house, Vector3(width + 0.6, 0.45, depth + 0.6), position + Vector3(0, height + 0.22, 0), Color("#8d5542"), false, "Roof")
	roof.rotation.y = deg_to_rad((index % 3 - 1) * 5.0)
	_mesh_box(house, Vector3(1.1, 1.8, 0.08), position + Vector3(0, 1.25, -depth * 0.51), Color("#35575a"), false, "Door")
	for side in [-1.0, 1.0]:
		_mesh_box(house, Vector3(1.25, 0.85, 0.08), position + Vector3(side * width * 0.28, 2.0, -depth * 0.51), Color("#e8d3a7"), false, "Window")

func _build_tree(position: Vector3, scale: float) -> void:
	var tree := Node3D.new()
	tree.name = "NeemTree"
	add_child(tree)
	_mesh_cylinder(tree, 0.35 * scale, 4.0 * scale, position + Vector3(0, 2.0 * scale, 0), Color("#624632"), "Trunk")
	var crown := _mesh_cylinder(tree, 2.5 * scale, 3.6 * scale, position + Vector3(0, 5.0 * scale, 0), Color("#416b45"), "Canopy")
	crown.scale = Vector3(1.0, 1.0, 0.85)

func _build_power_pole(position: Vector3, index: int) -> void:
	var pole := Node3D.new()
	pole.name = "PowerPole_%02d" % index
	add_child(pole)
	_mesh_cylinder(pole, 0.11, 7.5, position + Vector3(0, 3.75, 0), Color("#71695d"), "Pole")
	_mesh_box(pole, Vector3(3.1, 0.12, 0.12), position + Vector3(0, 6.6, 0), Color("#4c4a45"), false, "Crossbar")
	for side in [-1.0, 0.0, 1.0]:
		_mesh_cylinder(pole, 0.07, 0.22, position + Vector3(side * 1.0, 6.8, 0), Color("#2f3331"), "Insulator")
	# A long cable is represented by slim segments so it remains inexpensive.
	if index > 0:
		var cable := _mesh_box(pole, Vector3(0.035, 0.035, 86.0), position + Vector3(-43.0, 6.75, 0), Color("#252b29"), false, "Wire")
		cable.rotation.y = deg_to_rad(2.0)

func _build_landmark(landmark: Dictionary, position: Vector3) -> void:
	var root := Node3D.new()
	root.name = "Landmark_%s" % landmark.id
	add_child(root)
	var kind := String(landmark.kind)
	if kind == "temple":
		_mesh_box(root, Vector3(15, 4.5, 12), position + Vector3(0, 2.25, 0), Color("#d99858"), true, "Temple")
		_mesh_cylinder(root, 2.2, 8.0, position + Vector3(0, 8.0, 0), Color("#cf7544"), "TempleTower")
	elif kind == "school":
		_mesh_box(root, Vector3(24, 5.0, 13), position + Vector3(0, 2.5, 0), Color("#d7c38c"), true, "School")
		_mesh_box(root, Vector3(18, 1.2, 0.15), position + Vector3(0, 5.25, -6.6), Color("#335f62"), false, "SchoolSign")
	elif kind == "fuel":
		_mesh_box(root, Vector3(22, 0.15, 18), position + Vector3(0, 0.03, 0), Color("#77726a"), true, "FuelYard")
		_mesh_box(root, Vector3(16, 0.25, 11), position + Vector3(0, 4.4, 0), Color("#e9d7ac"), false, "FuelCanopy")
		for x in [-5.0, 0.0, 5.0]:
			_mesh_cylinder(root, 0.7, 3.6, position + Vector3(x, 2.1, 0), Color("#d65b45"), "Pump")
	elif kind == "bus_station":
		_mesh_box(root, Vector3(27, 3.5, 11), position + Vector3(0, 1.75, 0), Color("#c98e62"), true, "BusStation")
		_mesh_box(root, Vector3(31, 0.2, 15), position + Vector3(0, 4.0, 0), Color("#567276"), false, "BusRoof")
	elif kind == "park":
		_mesh_box(root, Vector3(34, 0.08, 26), position + Vector3(0, 0.02, 0), Color("#6f9b62"), true, "Park")
		for i in range(5):
			_build_tree_at(root, position + Vector3(-12 + i * 6, 0, -9 if i % 2 == 0 else 9), 0.8)
	else:
		_mesh_box(root, Vector3(16, 3.2, 12), position + Vector3(0, 1.6, 0), Color("#c99670"), true, "Shop")
		_mesh_box(root, Vector3(12, 1.0, 0.14), position + Vector3(0, 3.5, -6.1), Color("#e4bb68"), false, "ShopSign")

func _build_tree_at(parent: Node3D, position: Vector3, scale: float) -> void:
	_mesh_cylinder(parent, 0.28 * scale, 3.0 * scale, position + Vector3(0, 1.5 * scale, 0), Color("#624632"), "TreeTrunk")
	_mesh_cylinder(parent, 1.9 * scale, 3.0 * scale, position + Vector3(0, 4.0 * scale, 0), Color("#416b45"), "TreeCrown")
