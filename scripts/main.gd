extends Node3D
## Darsi - Small Town Ride. Boots the real-geometry town, the motorcycle, traffic,
## the camera rig and the HUD.

const WORLD_DATA_PATH := "res://data/darsi_world.json"

var world_builder: DarsiWorldBuilder
var bike: Motorcycle
var traffic: Node3D
var camera: Camera3D
var camera_rig: Node3D
var sun: DirectionalLight3D
var environment: WorldEnvironment
var minimap: DarsiMinimap
var hud  # scripts/hud.gd has no class_name; keep it dynamic

var camera_mode := 0           # 0 chase, 1 close chase, 2 cockpit, 3 cinematic
var time_of_day := 8.5         # hours
var time_scale := 60.0         # one in-game minute per real second
var paused_ui := false
var world_stats: Dictionary = {}
var landmarks: Array[Dictionary] = []
var nearest_landmark := ""
var current_road := ""
var _camera_position := Vector3.ZERO
var _notification_timer := 0.0
var _notification_text := ""

const CAMERA_PRESETS := [
	{"offset": Vector3(0.0, 2.6, 7.2), "fov": 72.0, "look": Vector3(0, 1.1, 0)},
	{"offset": Vector3(0.0, 1.8, 4.3), "fov": 76.0, "look": Vector3(0, 0.9, 0)},
	{"offset": Vector3(0.0, 0.0, 0.0), "fov": 82.0, "look": Vector3(0, 0, -1)},
	{"offset": Vector3(4.5, 2.2, 6.0), "fov": 60.0, "look": Vector3(0, 1.0, 0)},
]


func _ready() -> void:
	randomize()
	_setup_environment()
	var data := _load_world_data()
	if data.is_empty():
		push_error("Darsi: could not load %s" % WORLD_DATA_PATH)
		return

	world_builder = DarsiWorldBuilder.new()
	world_builder.name = "Darsi"
	add_child(world_builder)
	world_stats = world_builder.build(data)
	landmarks = world_builder.landmarks

	_spawn_bike(data)
	_spawn_traffic()
	_setup_camera()
	_setup_hud()
	print("Darsi built: ", world_stats)


func _load_world_data() -> Dictionary:
	if not FileAccess.file_exists(WORLD_DATA_PATH):
		return {}
	var file := FileAccess.open(WORLD_DATA_PATH, FileAccess.READ)
	if file == null:
		return {}
	var parsed = JSON.parse_string(file.get_as_text())
	file.close()
	return parsed if parsed is Dictionary else {}


# ---------------------------------------------------------------- scene setup
func _setup_environment() -> void:
	environment = WorldEnvironment.new()
	environment.name = "Environment"
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sky_material := ProceduralSkyMaterial.new()
	sky_material.sky_top_color = Color(0.32, 0.52, 0.78)
	sky_material.sky_horizon_color = Color(0.86, 0.84, 0.74)
	sky_material.ground_bottom_color = Color(0.42, 0.37, 0.28)
	sky_material.ground_horizon_color = Color(0.78, 0.72, 0.58)
	sky_material.sun_angle_max = 12.0
	sky.sky_material = sky_material
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.9
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.05
	env.fog_enabled = true
	env.fog_light_color = Color(0.82, 0.79, 0.70)
	env.fog_density = 0.0016
	env.fog_sky_affect = 0.3
	environment.environment = env
	add_child(environment)

	sun = DirectionalLight3D.new()
	sun.name = "Sun"
	sun.light_energy = 1.25
	sun.light_color = Color(1.0, 0.96, 0.88)
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 220.0
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	add_child(sun)


func _spawn_bike(data: Dictionary) -> void:
	bike = Motorcycle.new()
	bike.name = "Motorcycle"
	add_child(bike)

	# Start on the real junction in the middle of Darsi, facing along the road.
	var start := world_builder.nearest_road_point(Vector3.ZERO)
	var position: Vector3 = start.position if start.distance < 1000.0 else Vector3.ZERO
	var direction: Vector3 = start.direction if start.distance < 1000.0 else Vector3.FORWARD
	bike.respawn_at(position + Vector3(0.0, 0.1, 0.0), direction)
	current_road = String(start.get("name", ""))

	bike.crashed.connect(_on_bike_crashed)
	bike.gear_changed.connect(func(g): _notify("Gear %d" % g, 0.8))


func _spawn_traffic() -> void:
	traffic = Node3D.new()
	traffic.name = "Traffic"
	add_child(traffic)
	var drivable: Array = world_builder.road_graph.filter(func(r): return r["class"] in ["highway", "arterial", "collector", "neighbourhood"])
	if drivable.is_empty():
		return
	var count: int = min(26, drivable.size())
	for i in range(count):
		var road: Dictionary = drivable[(i * 7) % drivable.size()]
		var vehicle := TrafficVehicle.new()
		vehicle.name = "Traffic%d" % i
		vehicle.setup(road, float(i) / float(count))
		traffic.add_child(vehicle)


func _setup_camera() -> void:
	camera_rig = Node3D.new()
	camera_rig.name = "CameraRig"
	add_child(camera_rig)
	camera = Camera3D.new()
	camera.name = "Camera"
	camera.fov = 72.0
	camera.near = 0.08
	camera.far = 1400.0
	camera.current = true
	camera_rig.add_child(camera)
	_camera_position = bike.global_position + Vector3(0, 3, 8)


func _setup_hud() -> void:
	hud = preload("res://scripts/hud.gd").new()
	hud.name = "HUD"
	add_child(hud)
	hud.setup(self)


# ---------------------------------------------------------------- loop
func _process(delta: float) -> void:
	if bike == null:
		return
	_update_time(delta)
	_update_camera(delta)
	_update_context()
	_notification_timer = maxf(0.0, _notification_timer - delta)


func _physics_process(_delta: float) -> void:
	if bike == null:
		return
	var throttle := Input.get_action_strength("accelerate")
	var front_brake := Input.get_action_strength("brake")
	var rear_brake := Input.get_action_strength("handbrake")
	var steer := Input.get_axis("steer_left", "steer_right")
	bike.set_controls(throttle, front_brake, rear_brake, steer)


func _update_time(delta: float) -> void:
	time_of_day = fmod(time_of_day + delta * time_scale / 3600.0, 24.0)
	var sun_angle := (time_of_day / 24.0) * TAU - PI * 0.5
	sun.rotation = Vector3(-sin(sun_angle) * 1.1 - 0.15, deg_to_rad(38.0), 0.0)
	var daylight := clampf(sin((time_of_day - 6.0) / 12.0 * PI), 0.0, 1.0)
	sun.light_energy = 0.08 + daylight * 1.35
	sun.light_color = Color(1.0, 0.92 - (1.0 - daylight) * 0.18, 0.80 - (1.0 - daylight) * 0.28)
	var env := environment.environment
	env.ambient_light_energy = 0.14 + daylight * 0.85
	var sky_material: ProceduralSkyMaterial = env.sky.sky_material
	sky_material.sky_top_color = Color(0.05, 0.07, 0.14).lerp(Color(0.32, 0.52, 0.78), daylight)
	sky_material.sky_horizon_color = Color(0.17, 0.14, 0.17).lerp(Color(0.88, 0.84, 0.72), daylight)
	env.fog_light_color = Color(0.09, 0.10, 0.14).lerp(Color(0.82, 0.79, 0.70), daylight)
	if bike:
		bike.headlight_on = daylight < 0.35


func _update_camera(delta: float) -> void:
	var preset: Dictionary = CAMERA_PRESETS[camera_mode]
	if camera_mode == 2:
		camera.global_transform = bike.cockpit_mount.global_transform
		camera.fov = preset.fov
		return
	var basis := bike.global_transform.basis
	# Follow the bike's heading, not its lean, so the horizon stays level.
	var forward := -basis.z
	var flat_forward := Vector3(forward.x, 0.0, forward.z).normalized()
	if flat_forward.length() < 0.1:
		flat_forward = Vector3.FORWARD
	var speed_pull := clampf(absf(bike.get_speed_mps()) / 24.0, 0.0, 1.0)
	var offset: Vector3 = preset.offset
	var target := bike.global_position + flat_forward * -offset.z * (1.0 + speed_pull * 0.22) + Vector3(0, offset.y, 0)
	target += flat_forward.cross(Vector3.UP) * offset.x
	_camera_position = _camera_position.lerp(target, clampf(delta * 6.0, 0.0, 1.0))
	camera.global_position = _camera_position
	camera.look_at(bike.global_position + preset.look + flat_forward * 4.0, Vector3.UP)
	camera.fov = lerpf(camera.fov, float(preset.fov) + speed_pull * 8.0, delta * 3.0)


func _update_context() -> void:
	var nearest := world_builder.nearest_road_point(bike.global_position)
	if nearest.distance < 25.0 and String(nearest.name) != "":
		current_road = String(nearest.name)
	var best := INF
	nearest_landmark = ""
	for landmark in landmarks:
		var distance: float = bike.global_position.distance_to(landmark.position)
		if distance < best:
			best = distance
			nearest_landmark = "%s (%d m)" % [landmark.name, int(distance)]


# ---------------------------------------------------------------- input
func _unhandled_input(event: InputEvent) -> void:
	if bike == null:
		return
	if event.is_action_pressed("toggle_camera"):
		camera_mode = (camera_mode + 1) % CAMERA_PRESETS.size()
		_notify("Camera: %s" % ["Chase", "Close", "Cockpit", "Cinematic"][camera_mode], 1.2)
	elif event.is_action_pressed("toggle_map"):
		if minimap:
			minimap.toggle_expanded()
	elif event.is_action_pressed("interact"):
		_interact()
	elif event is InputEventKey and event.pressed and not event.echo:
		match event.keycode:
			KEY_R:
				_respawn_on_road()
			KEY_F:
				bike.refuel()
				_notify("Refuelled", 1.5)
			KEY_H:
				bike.sound_horn()
				_notify("Horn!", 0.5)
			KEY_L:
				bike.toggle_headlight()
			KEY_T:
				time_of_day = fmod(time_of_day + 3.0, 24.0)
				_notify("Time: %02d:%02d" % [int(time_of_day), int(fmod(time_of_day, 1.0) * 60.0)], 1.5)
			KEY_B:
				_notify("Ride mode: %s" % bike.cycle_ride_mode(), 1.5)
			KEY_ESCAPE:
				get_tree().quit()


func _interact() -> void:
	for landmark in landmarks:
		if bike.global_position.distance_to(landmark.position) < 22.0:
			if landmark.kind == "fuel":
				bike.refuel()
				_notify("Refuelled at %s" % landmark.name, 2.0)
			else:
				_notify("%s - %s" % [landmark.name, String(landmark.kind).capitalize()], 2.5)
			return
	_notify("Nothing here to interact with", 1.2)


func _respawn_on_road() -> void:
	var nearest := world_builder.nearest_road_point(bike.global_position)
	bike.respawn_at(nearest.position + Vector3(0, 0.15, 0), nearest.direction)
	_notify("Back on the road", 1.5)


func _on_bike_crashed() -> void:
	_notify("Crashed! Press R to recover", 2.5)


func _notify(text: String, duration: float) -> void:
	_notification_text = text
	_notification_timer = duration


func get_notification() -> String:
	return _notification_text if _notification_timer > 0.0 else ""


func get_clock_string() -> String:
	var hours := int(time_of_day)
	var minutes := int(fmod(time_of_day, 1.0) * 60.0)
	return "%02d:%02d" % [hours, minutes]
