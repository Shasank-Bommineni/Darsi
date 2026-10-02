class_name SahajaBike
extends CharacterBody3D
## A fictional, legally distinct 125cc commuter bike for the first playable slice.
## The handling model exposes the same hooks that future licensed/fictional bikes can use.

signal fuel_changed(value: float)
signal bike_crashed

var displacement_cc := 125.0
var power_kw := 8.7
var peak_torque_nm := 10.8
var mass_kg := 142.0
var max_speed_mps := 30.0
var gear_count := 5
var gear := 1
var fuel := 5.5
var fuel_capacity := 8.0
var ride_mode := "Normal"
var distance_m := 0.0
var engine_running := true

var _touch_accelerate := false
var _touch_brake := false
var _touch_left := false
var _touch_right := false
var _steer_smoothed := 0.0
var _current_speed := 0.0
var _previous_position := Vector3.ZERO
var _lean := 0.0
var visual_root: Node3D
var third_mount: Node3D
var cockpit_mount: Node3D

const MODE_SCALE := {"Arcade": 1.18, "Normal": 1.0, "Simulation": 0.82}

func _ready() -> void:
	collision_layer = 2
	collision_mask = 1
	_previous_position = global_position
	_build_bike()

func _physics_process(delta: float) -> void:
	var accelerate := Input.get_action_strength("accelerate")
	var brake := Input.get_action_strength("brake")
	var steer := Input.get_axis("steer_left", "steer_right")
	if _touch_accelerate:
		accelerate = 1.0
	if _touch_brake:
		brake = 1.0
	if _touch_left:
		steer -= 1.0
	if _touch_right:
		steer += 1.0
	steer = clamp(steer, -1.0, 1.0)
	_steer_smoothed = move_toward(_steer_smoothed, steer, delta * 5.0)

	var mode_scale: float = MODE_SCALE.get(ride_mode, 1.0)
	var forward_input := accelerate
	var brake_force := brake
	if Input.is_action_pressed("handbrake"):
		brake_force = 1.0
	var speed_ratio := clamp(abs(_current_speed) / max_speed_mps, 0.0, 1.0)
	var traction := 1.0
	if get_meta("wet_roads", false):
		traction = 0.73
	if forward_input > 0.05 and fuel > 0.0 and engine_running:
		var gear_factor := 0.54 + float(gear) * 0.075
		_current_speed = move_toward(_current_speed, max_speed_mps * mode_scale * gear_factor, delta * (7.5 + power_kw * 0.30) * traction)
		fuel = max(0.0, fuel - delta * (0.00065 + speed_ratio * 0.00045))
	elif brake_force > 0.05:
		_current_speed = move_toward(_current_speed, 0.0, delta * (12.0 + brake_force * 8.0))
	else:
		# Engine braking is deliberately noticeable on a small commuter motorcycle.
		_current_speed = move_toward(_current_speed, 0.0, delta * (0.9 + speed_ratio * 1.1))

	if _current_speed > 0.15:
		var turn_rate := (0.88 - speed_ratio * 0.33) * _steer_smoothed * delta
		if ride_mode == "Simulation":
			turn_rate *= traction
		rotation.y -= turn_rate

	if _current_speed > 8.0 and abs(_steer_smoothed) > 0.04:
		_lean = lerp(_lean, -_steer_smoothed * min(0.42, speed_ratio * 0.58), delta * 6.0)
	else:
		_lean = lerp(_lean, 0.0, delta * 5.0)
	if visual_root:
		visual_root.rotation.z = _lean

	var forward := -global_transform.basis.z
	velocity.x = forward.x * _current_speed
	velocity.z = forward.z * _current_speed
	if not is_on_floor():
		velocity.y -= 9.8 * delta
	else:
		velocity.y = -0.4
	move_and_slide()
	if global_position.y < -3.0:
		global_position.y = 0.6
		_current_speed = 0.0
		bike_crashed.emit()

	distance_m += global_position.distance_to(_previous_position)
	_previous_position = global_position
	_update_gear()
	fuel_changed.emit(fuel)

func set_touch_control(control: String, pressed: bool) -> void:
	match control:
		"accelerate": _touch_accelerate = pressed
		"brake": _touch_brake = pressed
		"left": _touch_left = pressed
		"right": _touch_right = pressed

func set_ride_mode(next_mode: String) -> void:
	if next_mode in ["Arcade", "Normal", "Simulation"]:
		ride_mode = next_mode

func cycle_ride_mode() -> String:
	var modes := ["Arcade", "Normal", "Simulation"]
	var index := modes.find(ride_mode)
	set_ride_mode(modes[(index + 1) % modes.size()])
	return ride_mode

func refuel() -> void:
	fuel = fuel_capacity
	fuel_changed.emit(fuel)

func get_speed_kmh() -> int:
	return int(round(_current_speed * 3.6))

func get_heading_degrees() -> float:
	return rad_to_deg(rotation.y)

func _update_gear() -> void:
	var thresholds := [0.0, 7.0, 13.0, 19.0, 25.0, 30.0]
	for i in range(1, thresholds.size()):
		if _current_speed >= thresholds[i] and gear < min(gear_count, i + 1):
			gear = min(gear_count, i + 1)
	if gear > 1 and _current_speed < thresholds[gear - 1] - 2.0:
		gear -= 1
	if _current_speed < 1.0:
		gear = 1

func _build_bike() -> void:
	var collider := CollisionShape3D.new()
	var shape := CapsuleShape3D.new()
	shape.radius = 0.43
	shape.height = 1.15
	collider.shape = shape
	collider.position = Vector3(0, 0.72, 0)
	add_child(collider)
	visual_root = Node3D.new()
	visual_root.name = "Sahaja125Visual"
	add_child(visual_root)
	# The visual is intentionally original: no manufacturer badge, logo, or copied silhouette.
	_add_box(Vector3(0.55, 0.42, 1.18), Vector3(0, 1.02, -0.05), Color("#c86f4f"), "Tank")
	_add_box(Vector3(0.48, 0.18, 0.72), Vector3(0, 1.35, 0.33), Color("#252e30"), "Seat")
	_add_box(Vector3(0.22, 0.42, 0.88), Vector3(0, 0.74, -0.03), Color("#444c4b"), "Frame")
	_add_box(Vector3(0.11, 0.13, 0.9), Vector3(0, 1.47, -0.05), Color("#3c4746"), "Handlebar")
	_add_box(Vector3(0.36, 0.23, 0.12), Vector3(0, 1.33, -0.55), Color("#f2d38c"), "Headlamp")
	_add_wheel(Vector3(0, 0.45, -0.70), "FrontWheel")
	_add_wheel(Vector3(0, 0.45, 0.63), "RearWheel")
	_add_box(Vector3(0.10, 0.12, 0.74), Vector3(0.38, 0.65, 0.22), Color("#53605d"), "Exhaust")
	_add_mirror(Vector3(-0.29, 1.62, -0.18))
	_add_mirror(Vector3(0.29, 1.62, -0.18))
	third_mount = Node3D.new()
	third_mount.name = "ThirdPersonMount"
	third_mount.position = Vector3(0, 1.15, 0)
	add_child(third_mount)
	cockpit_mount = Node3D.new()
	cockpit_mount.name = "CockpitMount"
	cockpit_mount.position = Vector3(0, 1.38, -0.42)
	add_child(cockpit_mount)

func _add_box(size: Vector3, position: Vector3, color: Color, name: String) -> void:
	var mesh_instance := MeshInstance3D.new()
	mesh_instance.name = name
	var mesh := BoxMesh.new()
	mesh.size = size
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.72
	mesh.material = material
	mesh_instance.mesh = mesh
	mesh_instance.position = position
	visual_root.add_child(mesh_instance)

func _add_wheel(position: Vector3, name: String) -> void:
	var wheel := MeshInstance3D.new()
	wheel.name = name
	var mesh := CylinderMesh.new()
	mesh.top_radius = 0.34
	mesh.bottom_radius = 0.34
	mesh.height = 0.13
	mesh.radial_segments = 16
	var material := StandardMaterial3D.new()
	material.albedo_color = Color("#202526")
	material.roughness = 0.98
	mesh.material = material
	wheel.mesh = mesh
	wheel.rotation.z = PI * 0.5
	wheel.position = position
	visual_root.add_child(wheel)

func _add_mirror(position: Vector3) -> void:
	_add_box(Vector3(0.08, 0.34, 0.08), position + Vector3(0, -0.15, 0.1), Color("#313a38"), "MirrorStem")
	_add_box(Vector3(0.18, 0.08, 0.27), position, Color("#252b2b"), "Mirror")
