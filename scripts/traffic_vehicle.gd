class_name TrafficVehicle
extends Node3D
## Simple ambient traffic that follows the real Darsi road centrelines.
## Motorcycles, auto-rickshaws, tractors and the odd APSRTC bus - the mix you actually
## see on these roads. They are kinematic: cheap, and they never fight the player's physics.

var route: Array[Vector3] = []
var speed := 8.0
var progress := 0.0
var length := 0.0
var kind := "motorcycle"
var _rng := RandomNumberGenerator.new()


func setup(road: Dictionary, phase: float) -> void:
	route = []
	for point in road.points:
		route.append(point)
	length = 0.0
	for i in range(1, route.size()):
		length += route[i - 1].distance_to(route[i])
	_rng.seed = hash(road.get("name", "")) + int(phase * 1000.0)
	progress = phase * maxf(length, 1.0)

	var roll := _rng.randf()
	var road_class := String(road.get("class", "neighbourhood"))
	if road_class in ["highway", "arterial"]:
		kind = "bus" if roll < 0.18 else ("lorry" if roll < 0.34 else ("auto" if roll < 0.6 else "motorcycle"))
		speed = _rng.randf_range(10.0, 17.0)
	else:
		kind = "tractor" if roll < 0.12 else ("auto" if roll < 0.45 else "motorcycle")
		speed = _rng.randf_range(5.0, 10.0)
	_build()


func _build() -> void:
	match kind:
		"bus":
			_box(Vector3(2.5, 2.9, 10.5), Vector3(0, 1.7, 0), Color("#d8552f"))
			_box(Vector3(2.52, 0.9, 10.0), Vector3(0, 2.6, 0), Color("#f0e6d2"))
			_wheels(1.05, 3.6, 0.45)
		"lorry":
			_box(Vector3(2.4, 2.0, 4.0), Vector3(0, 1.6, 2.6), Color("#2f6b8f"))
			_box(Vector3(2.5, 2.4, 6.0), Vector3(0, 1.9, -1.6), Color("#c9a227"))
			_wheels(1.1, 2.8, 0.5)
		"auto":
			_box(Vector3(1.4, 1.5, 2.6), Vector3(0, 0.95, 0), Color("#f2c500"))
			_box(Vector3(1.42, 0.7, 1.4), Vector3(0, 1.75, 0.2), Color("#1f6b3a"))
			_wheels(0.6, 0.9, 0.28)
		"tractor":
			_box(Vector3(1.7, 1.3, 3.0), Vector3(0, 1.0, 0), Color("#2f7a3a"))
			_box(Vector3(1.5, 1.2, 1.2), Vector3(0, 2.0, 0.6), Color("#2f7a3a"))
			_wheels(0.95, 1.1, 0.75)
		_:
			_box(Vector3(0.5, 0.7, 1.9), Vector3(0, 0.7, 0), Color("#8b2f3f"))
			_box(Vector3(0.45, 0.8, 0.5), Vector3(0, 1.3, 0.25), Color("#2b3742"))
			_wheels(0.45, 0.66, 0.23)


func _box(size: Vector3, position: Vector3, colour: Color) -> void:
	var mesh := BoxMesh.new()
	mesh.size = size
	var material := StandardMaterial3D.new()
	material.albedo_color = colour
	material.roughness = 0.7
	mesh.material = material
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.position = position
	add_child(node)


func _wheels(half_width: float, half_length: float, radius: float) -> void:
	var mesh := CylinderMesh.new()
	mesh.top_radius = radius
	mesh.bottom_radius = radius
	mesh.height = 0.22
	mesh.radial_segments = 10
	var material := StandardMaterial3D.new()
	material.albedo_color = Color("#191b1c")
	material.roughness = 0.95
	mesh.material = material
	for sx in [-1.0, 1.0]:
		for sz in [-1.0, 1.0]:
			var wheel := MeshInstance3D.new()
			wheel.mesh = mesh
			wheel.position = Vector3(sx * half_width, radius, sz * half_length)
			wheel.rotation.z = PI * 0.5
			add_child(wheel)


func _process(delta: float) -> void:
	if route.size() < 2 or length < 2.0:
		return
	progress = fmod(progress + speed * delta, length)
	var sample := _sample(progress)
	# Keep to the left - India drives on the left.
	var side: Vector3 = sample.direction.cross(Vector3.UP).normalized() * -1.6
	global_position = sample.position + side + Vector3(0, 0.02, 0)
	if sample.direction.length() > 0.01:
		look_at(global_position + sample.direction, Vector3.UP)


func _sample(distance: float) -> Dictionary:
	var travelled := 0.0
	for i in range(1, route.size()):
		var segment: Vector3 = route[i] - route[i - 1]
		var segment_length := segment.length()
		if segment_length < 0.001:
			continue
		if travelled + segment_length >= distance:
			var t := (distance - travelled) / segment_length
			return {"position": route[i - 1].lerp(route[i], t), "direction": segment / segment_length}
		travelled += segment_length
	return {"position": route[route.size() - 1], "direction": (route[route.size() - 1] - route[route.size() - 2]).normalized()}
