extends Node3D
## Builds the real Darsi world and saves a set of screenshots, so the geometry can be
## reviewed without a GPU workstation. Run from CI with:
##   xvfb-run godot --rendering-driver opengl3 --resolution 1280x720 scenes/capture.tscn

const OUTPUT_DIR := "res://docs/screenshots"

var _builder: DarsiWorldBuilder
var _camera: Camera3D
var _shots: Array = []
var _index := 0
var _settle := 0


func _ready() -> void:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUTPUT_DIR))

	var env_node := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sky_material := ProceduralSkyMaterial.new()
	sky_material.sky_top_color = Color(0.33, 0.53, 0.79)
	sky_material.sky_horizon_color = Color(0.88, 0.85, 0.74)
	sky_material.ground_bottom_color = Color(0.45, 0.39, 0.30)
	sky.sky_material = sky_material
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.58, 0.60, 0.66)
	env.ambient_light_energy = 0.32
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 0.78
	env.fog_enabled = true
	env.fog_light_color = Color(0.74, 0.71, 0.63)
	env.fog_density = 0.00035
	env.fog_sky_affect = 0.1
	env_node.environment = env
	add_child(env_node)

	var sun := DirectionalLight3D.new()
	sun.rotation = Vector3(deg_to_rad(-48.0), deg_to_rad(40.0), 0.0)
	sun.light_energy = 0.95
	sun.shadow_enabled = true
	add_child(sun)

	var file := FileAccess.open("res://data/darsi_world.json", FileAccess.READ)
	var data: Dictionary = JSON.parse_string(file.get_as_text())
	file.close()

	_builder = DarsiWorldBuilder.new()
	add_child(_builder)
	print("stats: ", _builder.build(data))

	_camera = Camera3D.new()
	_camera.far = 2600.0
	_camera.current = true
	add_child(_camera)

	# A motorcycle parked at the central junction for the hero shots.
	var junction := _builder.nearest_road_point(Vector3.ZERO)
	var bike := Motorcycle.new()
	add_child(bike)
	bike.respawn_at(junction.position + Vector3(0, 0.1, 0), junction.direction)

	var bike_pos: Vector3 = junction.position
	var along: Vector3 = junction.direction
	var side: Vector3 = along.cross(Vector3.UP).normalized()

	_shots = [
		{"name": "01_town_from_above", "pos": Vector3(0, 900, 900), "look": Vector3(0, 0, 0), "fov": 55.0},
		{"name": "02_central_junction", "pos": bike_pos + Vector3(0, 70, 0) + along * -60.0, "look": bike_pos, "fov": 60.0},
		{"name": "03_rider_view", "pos": bike_pos + along * -7.0 + Vector3(0, 2.6, 0) + side * 0.8, "look": bike_pos + Vector3(0, 1.0, 0), "fov": 70.0},
		{"name": "04_motorcycle_detail", "pos": bike_pos + along * -2.4 + side * 2.0 + Vector3(0, 1.2, 0), "look": bike_pos + Vector3(0, 0.75, 0), "fov": 45.0},
		{"name": "05_main_road", "pos": bike_pos + along * 120.0 + Vector3(0, 18, 0), "look": bike_pos, "fov": 55.0},
		{"name": "06_street_level", "pos": bike_pos + side * 40.0 + Vector3(0, 6.0, 0), "look": bike_pos + Vector3(0, 2.0, 0), "fov": 65.0},
	]
	print("capturing %d shots" % _shots.size())


func _process(_delta: float) -> void:
	if _index >= _shots.size():
		get_tree().quit(0)
		return
	var shot: Dictionary = _shots[_index]
	_camera.global_position = shot.pos
	_camera.look_at(shot.look, Vector3.UP)
	_camera.fov = shot.fov
	_settle += 1
	if _settle < 6:
		return
	_settle = 0
	await RenderingServer.frame_post_draw
	var image := get_viewport().get_texture().get_image()
	var path := "%s/%s.png" % [OUTPUT_DIR, shot.name]
	var error := image.save_png(path)
	print("saved %s (%s)" % [path, "ok" if error == OK else str(error)])
	_index += 1
