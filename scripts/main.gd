extends Node3D
## Darsi prototype entry point.
## It intentionally keeps gameplay systems small and inspectable while the geographic
## manifest remains replaceable by a reviewed OSM import.

const WORLD_BUILDER_SCRIPT = preload("res://scripts/world_builder.gd")
const BIKE_SCRIPT = preload("res://scripts/bike_controller.gd")
const TRAFFIC_SCRIPT = preload("res://scripts/traffic_vehicle.gd")
const RADAR_SCRIPT = preload("res://scripts/radar.gd")

var map_data: Dictionary = {}
var world_builder
var bike
var landmarks_runtime: Array[Dictionary] = []
var traffic: Array = []
var discovered: Dictionary = {}
var money := 850
var clock_minutes := 17.0 * 60.0 + 20.0
var weather := "Clear"
var photo_mode := false
var camera_mode := "Third-person"
var mission_active := false
var mission_complete := false
var mission_stage := 0
var nearest_landmark: Dictionary = {}

var sun: DirectionalLight3D
var environment: WorldEnvironment
var third_camera: Camera3D
var cockpit_camera: Camera3D
var hud_root: Control
var title_label: Label
var stats_label: Label
var mission_label: Label
var prompt_label: Label
var toast_label: Label
var time_weather_label: Label
var radar
var map_panel: Panel
var photo_panel: Panel
var mode_button: Button
var weather_button: Button
var toast_time := 0.0
var toast_message := ""
var photo_hint: Label

func _ready() -> void:
	_load_map()
	_setup_environment()
	world_builder = WORLD_BUILDER_SCRIPT.new()
	world_builder.name = "DarsiGeographicPrototype"
	add_child(world_builder)
	landmarks_runtime = world_builder.build(map_data)
	_spawn_bike()
	_spawn_traffic()
	_setup_hud()
	_show_toast("Welcome home. Take the Sahaja 125 for a calm evening ride.")

func _load_map() -> void:
	var file := FileAccess.open("res://data/darsi_map.json", FileAccess.READ)
	if file:
		var parsed = JSON.parse_string(file.get_as_text())
		if parsed is Dictionary:
			map_data = parsed
	if map_data.is_empty():
			push_error("Darsi map manifest could not be loaded")

func _setup_environment() -> void:
	environment = WorldEnvironment.new()
	environment.name = "WarmAndhraAtmosphere"
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color("#9eb6b0")
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("#d2b995")
	env.ambient_light_energy = 0.72
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.fog_enabled = true
	env.fog_light_color = Color("#c6b99b")
	env.fog_light_energy = 0.45
	env.fog_density = 0.0035
	environment.environment = env
	add_child(environment)
	sun = DirectionalLight3D.new()
	sun.name = "LateAfternoonSun"
	sun.rotation_degrees = Vector3(-48, -32, 0)
	sun.light_color = Color("#ffe1ac")
	sun.light_energy = 1.25
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 180.0
	add_child(sun)

func _spawn_bike() -> void:
	bike = BIKE_SCRIPT.new()
	bike.name = "Sahaja125"
	var start := world_builder.latlon_to_world(15.7641, 79.6834)
	# Bike origin is at the road plane; the controller's capsule settles the chassis onto it.
	bike.position = start
	add_child(bike)
	bike.fuel_changed.connect(_on_fuel_changed)
	third_camera = Camera3D.new()
	third_camera.name = "ThirdPersonCamera"
	third_camera.position = Vector3(0, 4.1, 8.3)
	third_camera.rotation_degrees = Vector3(-14.0, 0.0, 0.0)
	third_camera.fov = 68.0
	third_camera.current = true
	bike.add_child(third_camera)
	cockpit_camera = Camera3D.new()
	cockpit_camera.name = "CockpitCamera"
	cockpit_camera.position = Vector3(0, 1.48, -0.5)
	cockpit_camera.rotation_degrees = Vector3(-4.0, 0.0, 0.0)
	cockpit_camera.fov = 74.0
	cockpit_camera.current = false
	bike.add_child(cockpit_camera)

func _spawn_traffic() -> void:
	var route_defs := [
		{"road": "addanki_darsi", "color": Color("#e6c85e"), "kind": "auto", "offset": 0},
		{"road": "vinukonda_darsi", "color": Color("#5e8990"), "kind": "bus", "offset": 2},
		{"road": "gangavaram", "color": Color("#c9654c"), "kind": "auto", "offset": 3},
		{"road": "market_spine", "color": Color("#719a63"), "kind": "cycle", "offset": 1}
	]
	for route in route_defs:
		for road in map_data.roads:
			if road.id != route.road:
				continue
			var path: Array[Vector3] = []
			for point in road.points:
				path.append(world_builder.latlon_to_world(float(point[0]), float(point[1])))
			if int(route.offset) % 2 == 1:
				path.reverse()
			var vehicle = TRAFFIC_SCRIPT.new()
			vehicle.name = "AmbientTraffic_%s" % route.road
			add_child(vehicle)
			vehicle.setup(path, route.color, route.kind)
			traffic.append(vehicle)

func _setup_hud() -> void:
	var layer := CanvasLayer.new()
	layer.name = "CozyHUD"
	add_child(layer)
	hud_root = Control.new()
	hud_root.name = "HUDRoot"
	hud_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	hud_root.mouse_filter = Control.MOUSE_FILTER_PASS
	layer.add_child(hud_root)

	var top_panel := Panel.new()
	top_panel.position = Vector2(22, 18)
	top_panel.size = Vector2(620, 92)
	top_panel.add_theme_stylebox_override("panel", _panel_style(Color(0.05, 0.12, 0.12, 0.90), 18))
	hud_root.add_child(top_panel)
	title_label = Label.new()
	title_label.position = Vector2(20, 12)
	title_label.text = "DARSI  /  SMALL TOWN RIDE"
	title_label.add_theme_color_override("font_color", Color("#f3ca86"))
	title_label.add_theme_font_size_override("font_size", 18)
	top_panel.add_child(title_label)
	stats_label = Label.new()
	stats_label.position = Vector2(20, 43)
	stats_label.text = "0 km/h   G1   FUEL 100%"
	stats_label.add_theme_color_override("font_color", Color("#f1eee0"))
	stats_label.add_theme_font_size_override("font_size", 16)
	top_panel.add_child(stats_label)
	time_weather_label = Label.new()
	time_weather_label.position = Vector2(390, 44)
	time_weather_label.text = "17:20  ·  CLEAR"
	time_weather_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	time_weather_label.size = Vector2(210, 28)
	time_weather_label.add_theme_color_override("font_color", Color("#b8d6ca"))
	top_panel.add_child(time_weather_label)

	var money_panel := Panel.new()
	money_panel.position = Vector2(22, 120)
	money_panel.size = Vector2(180, 45)
	money_panel.add_theme_stylebox_override("panel", _panel_style(Color(0.05, 0.12, 0.12, 0.78), 13))
	hud_root.add_child(money_panel)
	var money_label := Label.new()
	money_label.name = "MoneyLabel"
	money_label.position = Vector2(14, 10)
	money_label.text = "₹ 850   ·   0 DISCOVERED"
	money_label.add_theme_color_override("font_color", Color("#f3ca86"))
	money_panel.add_child(money_label)

	radar = RADAR_SCRIPT.new()
	radar.name = "Radar"
	radar.position = Vector2(1060, 24)
	radar.size = Vector2(190, 190)
	hud_root.add_child(radar)

	var mission_panel := Panel.new()
	mission_panel.position = Vector2(22, 525)
	mission_panel.size = Vector2(430, 105)
	mission_panel.add_theme_stylebox_override("panel", _panel_style(Color(0.05, 0.12, 0.12, 0.84), 16))
	hud_root.add_child(mission_panel)
	mission_label = Label.new()
	mission_label.position = Vector2(17, 13)
	mission_label.size = Vector2(395, 78)
	mission_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	mission_label.add_theme_color_override("font_color", Color("#d9e8d5"))
	mission_label.add_theme_font_size_override("font_size", 15)
	mission_panel.add_child(mission_label)

	prompt_label = Label.new()
	prompt_label.position = Vector2(380, 646)
	prompt_label.size = Vector2(520, 40)
	prompt_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	prompt_label.add_theme_color_override("font_color", Color("#f3ca86"))
	prompt_label.add_theme_font_size_override("font_size", 18)
	hud_root.add_child(prompt_label)
	toast_label = Label.new()
	toast_label.position = Vector2(360, 118)
	toast_label.size = Vector2(570, 36)
	toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	toast_label.add_theme_color_override("font_color", Color("#f1eee0"))
	hud_root.add_child(toast_label)

	mode_button = _make_action_button("NORMAL", Vector2(925, 224), Vector2(125, 42), _cycle_mode)
	weather_button = _make_action_button("CLEAR", Vector2(1060, 224), Vector2(150, 42), _cycle_weather)
	_make_action_button("MAP  M", Vector2(925, 276), Vector2(125, 42), _toggle_map)
	_make_action_button("PHOTO  P", Vector2(1060, 276), Vector2(150, 42), _toggle_photo_mode)
	_make_action_button("CAM  C", Vector2(925, 328), Vector2(125, 42), _toggle_camera)
	_make_action_button("INTERACT  E", Vector2(1060, 328), Vector2(150, 42), _interact)

	# Large, forgiving touch targets: they also make the desktop prototype pleasant with a mouse.
	_make_touch_button("◀", Vector2(28, 650), Vector2(68, 58), "left")
	_make_touch_button("▶", Vector2(108, 650), Vector2(68, 58), "right")
	_make_touch_button("BRAKE", Vector2(1000, 585), Vector2(105, 58), "brake")
	_make_touch_button("RIDE", Vector2(1118, 585), Vector2(105, 58), "accelerate")

	map_panel = Panel.new()
	map_panel.name = "MapPanel"
	map_panel.position = Vector2(285, 95)
	map_panel.size = Vector2(710, 535)
	map_panel.visible = false
	map_panel.z_index = 8
	map_panel.add_theme_stylebox_override("panel", _panel_style(Color(0.04, 0.10, 0.10, 0.97), 20))
	hud_root.add_child(map_panel)
	var map_text := RichTextLabel.new()
	map_text.position = Vector2(28, 22)
	map_text.size = Vector2(654, 490)
	map_text.bbcode_enabled = true
	map_text.fit_content = false
	map_text.text = _map_panel_text()
	map_text.add_theme_color_override("default_color", Color("#e6ead9"))
	map_text.add_theme_font_size_override("normal_font_size", 17)
	map_panel.add_child(map_text)

	photo_panel = Panel.new()
	photo_panel.position = Vector2(390, 560)
	photo_panel.size = Vector2(500, 76)
	photo_panel.visible = false
	photo_panel.z_index = 9
	photo_panel.add_theme_stylebox_override("panel", _panel_style(Color(0.04, 0.08, 0.08, 0.90), 15))
	hud_root.add_child(photo_panel)
	photo_hint = Label.new()
	photo_hint.position = Vector2(15, 12)
	photo_hint.size = Vector2(470, 52)
	photo_hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	photo_hint.text = "PHOTO MODE  ·  Q/E camera  ·  +/- FOV  ·  F12 capture  ·  P exit"
	photo_hint.add_theme_color_override("font_color", Color("#f3ca86"))
	photo_panel.add_child(photo_hint)
	_update_mission_label()

func _panel_style(color: Color, radius: int) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = color
	style.corner_radius_top_left = radius
	style.corner_radius_top_right = radius
	style.corner_radius_bottom_left = radius
	style.corner_radius_bottom_right = radius
	style.border_width_left = 1
	style.border_width_right = 1
	style.border_width_top = 1
	style.border_width_bottom = 1
	style.border_color = Color(0.85, 0.74, 0.48, 0.24)
	return style

func _make_action_button(text: String, position: Vector2, button_size: Vector2, callback: Callable) -> Button:
	var button := Button.new()
	button.text = text
	button.position = position
	button.size = button_size
	button.focus_mode = Control.FOCUS_NONE
	button.add_theme_font_size_override("font_size", 13)
	button.add_theme_color_override("font_color", Color("#d9e8d5"))
	button.add_theme_stylebox_override("normal", _panel_style(Color(0.06, 0.15, 0.15, 0.88), 12))
	button.add_theme_stylebox_override("hover", _panel_style(Color(0.13, 0.27, 0.25, 0.96), 12))
	button.pressed.connect(callback)
	hud_root.add_child(button)
	return button

func _make_touch_button(text: String, position: Vector2, button_size: Vector2, control: String) -> Button:
	var button := Button.new()
	button.text = text
	button.position = position
	button.size = button_size
	button.focus_mode = Control.FOCUS_NONE
	button.add_theme_font_size_override("font_size", 16)
	button.add_theme_color_override("font_color", Color("#f4e8c8"))
	button.add_theme_stylebox_override("normal", _panel_style(Color(0.05, 0.12, 0.12, 0.86), 16))
	button.add_theme_stylebox_override("pressed", _panel_style(Color(0.16, 0.35, 0.31, 0.96), 16))
	button.button_down.connect(func(): bike.set_touch_control(control, true))
	button.button_up.connect(func(): bike.set_touch_control(control, false))
	hud_root.add_child(button)
	return button

func _process(delta: float) -> void:
	clock_minutes = fmod(clock_minutes + delta * 0.95, 1440.0)
	_update_lighting()
	if photo_mode:
		_update_photo_camera(delta)
	else:
		_update_nearest_landmark()
	_update_hud()
	toast_time = max(0.0, toast_time - delta)
	toast_label.text = toast_message if toast_time > 0.0 else ""
	var traffic_points: Array[Vector3] = []
	for vehicle in traffic:
		if is_instance_valid(vehicle):
			traffic_points.append(vehicle.global_position)
	if radar and bike:
		radar.update_radar(bike.global_position, bike.rotation.y, landmarks_runtime, traffic_points)

func _update_hud() -> void:
	if not bike or not stats_label:
		return
	var fuel_percent := int(round((float(bike.get("fuel")) / float(bike.get("fuel_capacity"))) * 100.0))
	stats_label.text = "%d km/h    G%d    FUEL %d%%" % [bike.get_speed_kmh(), int(bike.get("gear")), fuel_percent]
	# The panel is unnamed, so find the label defensively.
	var money_label := hud_root.find_child("MoneyLabel", true, false) as Label
	if money_label:
		money_label.text = "₹ %d    ·    %d DISCOVERED" % [money, discovered.size()]
	var hour := int(clock_minutes) / 60
	var minute := int(clock_minutes) % 60
	time_weather_label.text = "%02d:%02d   ·   %s" % [hour, minute, weather.to_upper()]
	if mode_button:
		mode_button.text = String(bike.get("ride_mode")).to_upper()
	if weather_button:
		weather_button.text = weather.to_upper()

func _update_lighting() -> void:
	var daylight := sin((clock_minutes - 360.0) / 1440.0 * TAU) * 0.5 + 0.5
	var warm := clamp(daylight, 0.10, 1.0)
	sun.light_energy = 0.15 + warm * 1.18
	sun.rotation_degrees = Vector3(-18.0 - warm * 45.0, -32.0 + (1.0 - warm) * 35.0, 0.0)
	if environment and environment.environment:
		environment.environment.ambient_light_energy = 0.28 + warm * 0.58
		environment.environment.background_color = Color("#253d48").lerp(Color("#a9beb4"), warm)
	if bike:
		bike.set_meta("wet_roads", weather == "Light rain" or weather == "Heavy rain")

func _update_nearest_landmark() -> void:
	nearest_landmark = {}
	var nearest_distance := 99999.0
	for landmark in landmarks_runtime:
		var distance := bike.global_position.distance_to(landmark.position)
		if distance < 42.0 and distance < nearest_distance:
			nearest_distance = distance
			nearest_landmark = landmark
		if distance < 34.0 and not discovered.has(landmark.id):
			discovered[landmark.id] = true
			_show_toast("Discovered %s" % landmark.name)
	if nearest_landmark.is_empty():
		prompt_label.text = "Ride freely  ·  E interact  ·  C camera  ·  M map"
	else:
		var kind := String(nearest_landmark.kind)
		if kind == "fuel":
			prompt_label.text = "E  ·  Refuel at %s" % nearest_landmark.name
		elif nearest_landmark.id == "tea_stall" and not mission_active and not mission_complete:
			prompt_label.text = "E  ·  Pick up a parcel at %s" % nearest_landmark.name
		elif nearest_landmark.id == "darsi_bus_station" and mission_active and not mission_complete:
			prompt_label.text = "E  ·  Deliver parcel to Darsi Bus Station"
		else:
			prompt_label.text = "%s  ·  %dm away" % [nearest_landmark.name, int(nearest_distance)]
	_update_mission_label()

func _update_mission_label() -> void:
	if not mission_label:
		return
	if mission_complete:
		mission_label.text = "[ DONE ] Evening parcel delivered\nYou earned ₹120. Take the long way home and find another landmark."
	elif mission_active:
		mission_label.text = "[ DELIVERY ] Parcel for the bus station\nRide gently to Darsi Bus Station. No rush — traffic and fuel are part of the ride."
	else:
		mission_label.text = "[ OPTIONAL ACTIVITY ] A small parcel is waiting\nVisit Morning Chai Corner and press E. You can ignore it and explore."

func _interact() -> void:
	if nearest_landmark.is_empty():
		_show_toast("Nothing nearby. Follow the roads, or open the map with M.")
		return
	var id := String(nearest_landmark.id)
	var kind := String(nearest_landmark.kind)
	if kind == "fuel":
		if float(bike.get("fuel")) < float(bike.get("fuel_capacity")):
			bike.refuel()
			money = max(0, money - 35)
			_show_toast("Tank filled. ₹35 paid at %s." % nearest_landmark.name)
		else:
			_show_toast("The tank is already full.")
	elif id == "tea_stall" and not mission_active and not mission_complete:
		mission_active = true
		mission_stage = 1
		_show_toast("Parcel picked up. Ride to Darsi Bus Station.")
	elif id == "darsi_bus_station" and mission_active and not mission_complete:
		mission_active = false
		mission_complete = true
		money += 120
		_show_toast("Parcel delivered. ₹120 earned — nice ride.")
	else:
		_show_toast("A quiet stop at %s." % nearest_landmark.name)
	_update_mission_label()

func _cycle_mode() -> void:
	var new_mode: String = bike.cycle_ride_mode()
	_show_toast("Riding mode: %s" % new_mode)

func _cycle_weather() -> void:
	var options := ["Clear", "Cloudy", "Light rain", "Heavy rain"]
	var index := options.find(weather)
	weather = options[(index + 1) % options.size()]
	_show_toast("Weather changed to %s. Grip and reflections will respond." % weather)

func _toggle_camera() -> void:
	if camera_mode == "Third-person":
		camera_mode = "Cockpit"
		third_camera.current = false
		cockpit_camera.current = true
	else:
		camera_mode = "Third-person"
		cockpit_camera.current = false
		third_camera.current = true
	_show_toast("Camera: %s" % camera_mode)

func _toggle_map() -> void:
	if map_panel:
		map_panel.visible = not map_panel.visible
	_show_toast("Map opened" if map_panel.visible else "Map closed")

func _toggle_photo_mode() -> void:
	photo_mode = not photo_mode
	if photo_panel:
		photo_panel.visible = photo_mode
	bike.set_physics_process(not photo_mode)
	_show_toast("Photo mode: frame the town, then press F12 to capture." if photo_mode else "Back to riding.")

func _update_photo_camera(delta: float) -> void:
	if Input.is_key_pressed(KEY_Q):
		third_camera.position.x -= delta * 3.0
	if Input.is_key_pressed(KEY_E):
		third_camera.position.x += delta * 3.0
	if Input.is_key_pressed(KEY_UP):
		third_camera.position.y += delta * 2.0
	if Input.is_key_pressed(KEY_DOWN):
		third_camera.position.y -= delta * 2.0
	if Input.is_key_pressed(KEY_EQUAL) or Input.is_key_pressed(KEY_KP_ADD):
		third_camera.fov = max(35.0, third_camera.fov - delta * 18.0)
	if Input.is_key_pressed(KEY_MINUS) or Input.is_key_pressed(KEY_KP_SUBTRACT):
		third_camera.fov = min(95.0, third_camera.fov + delta * 18.0)

func _capture_photo() -> void:
	var image := get_viewport().get_texture().get_image()
	var path := "user://darsi_photo_%d.png" % Time.get_ticks_msec()
	image.save_png(path)
	_show_toast("Photo saved to %s" % path)

func _map_panel_text() -> String:
	return "[font_size=26][color=#f3ca86]DARSI MAP PROTOTYPE[/color][/font_size]\n\n" + \
		"[color=#b8d6ca]WGS84 anchor[/color]    15.7667° N, 79.6833° E\n" + \
		"[color=#b8d6ca]Place[/color]           Darsi, Prakasam, Andhra Pradesh 523247\n" + \
		"[color=#b8d6ca]Scale[/color]            projected metres around the real-world anchor\n\n" + \
		"[color=#f3ca86]ROUTES IN THIS SLICE[/color]\n" + \
		"  Addanki – Darsi Road      ·  Vinukonda – Darsi Road\n" + \
		"  E Gangavaram Road         ·  Padamati Bazar\n" + \
		"  Auto Nagar Loop           ·  school and farm connectors\n\n" + \
		"[color=#f3ca86]MAP DATA NOTE[/color]\n" + \
		"  Named corridors and the anchor are public geographic references.\n" + \
		"  Starter road vertices, plots and buildings are procedural approximations.\n" + \
		"  They are not claimed as verified 1:1 geometry. Import a reviewed\n" + \
		"  OSM extract with tools/import_osm.py before expanding the town.\n\n" + \
		"M / tap MAP to close    ·    Photo mode: P    ·    Ride mode: button"

func _show_toast(message: String) -> void:
	toast_message = message
	toast_time = 4.2

func _on_fuel_changed(_value: float) -> void:
	pass

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("toggle_camera"):
		_toggle_camera()
	elif event.is_action_pressed("photo_mode"):
		_toggle_photo_mode()
	elif event.is_action_pressed("toggle_map"):
		_toggle_map()
	elif event.is_action_pressed("interact"):
		_interact()
	elif photo_mode and event is InputEventKey and event.pressed and event.keycode == KEY_F12:
		_capture_photo()
