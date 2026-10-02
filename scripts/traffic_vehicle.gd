class_name DarsiTrafficVehicle
extends Node3D
## Low-cost ambient traffic: pooled-looking decorative vehicles with no AI pathfinding yet.

var path: Array[Vector3] = []
var path_index := 0
var speed_mps := 5.0
var loop_path := true

func setup(points: Array[Vector3], vehicle_color: Color, vehicle_kind := "auto") -> void:
	path = points
	speed_mps = 3.0 if vehicle_kind == "cycle" else (4.8 if vehicle_kind == "auto" else 6.0)
	_build_vehicle(vehicle_color, vehicle_kind)
	if path.size() > 0:
		global_position = path[0] + Vector3(0, 0.65, 0)
	if path.size() > 1:
		look_at(path[1] + Vector3.UP * 0.65, Vector3.UP)

func _process(delta: float) -> void:
	if path.size() < 2:
		return
	var target := path[path_index + 1] + Vector3(0, 0.65, 0) if path_index + 1 < path.size() else path[0] + Vector3(0, 0.65, 0)
	var offset := target - global_position
	if offset.length() < 4.0:
		path_index = (path_index + 1) % path.size()
		target = path[path_index + 1] + Vector3(0, 0.65, 0) if path_index + 1 < path.size() else path[0] + Vector3(0, 0.65, 0)
	offset = target - global_position
	if offset.length() > 0.1:
		global_position += offset.normalized() * speed_mps * delta
		look_at(global_position + offset.normalized(), Vector3.UP)

func _build_vehicle(vehicle_color: Color, vehicle_kind: String) -> void:
	var body := MeshInstance3D.new()
	var body_mesh := BoxMesh.new()
	body_mesh.size = Vector3(1.65, 0.85, 3.0) if vehicle_kind != "auto" else Vector3(1.7, 1.0, 3.3)
	var body_material := StandardMaterial3D.new()
	body_material.albedo_color = vehicle_color
	body_material.roughness = 0.85
	body_mesh.material = body_material
	body.mesh = body_mesh
	body.position.y = 0.4
	add_child(body)
	if vehicle_kind == "auto":
		var roof := MeshInstance3D.new()
		var roof_mesh := BoxMesh.new()
		roof_mesh.size = Vector3(1.5, 0.55, 1.55)
		var roof_mat := StandardMaterial3D.new()
		roof_mat.albedo_color = Color("#e6c35b")
		roof_mesh.material = roof_mat
		roof.mesh = roof_mesh
		roof.position = Vector3(0, 1.05, 0.1)
		add_child(roof)
	elif vehicle_kind == "bus":
		body.scale = Vector3(1.35, 1.55, 1.0)
	# Wheels are only visual; avoiding per-vehicle collision is intentional for mobile performance.
	for x in [-0.78, 0.78]:
		for z in [-0.95, 0.95]:
			var wheel := MeshInstance3D.new()
			var wheel_mesh := CylinderMesh.new()
			wheel_mesh.top_radius = 0.28
			wheel_mesh.bottom_radius = 0.28
			wheel_mesh.height = 0.12
			wheel_mesh.radial_segments = 10
			var wheel_mat := StandardMaterial3D.new()
			wheel_mat.albedo_color = Color("#252829")
			wheel_mesh.material = wheel_mat
			wheel.mesh = wheel_mesh
			wheel.rotation.z = PI * 0.5
			wheel.position = Vector3(x, 0.22, z)
			add_child(wheel)
