extends Control
## Rider HUD: speedometer, gear, fuel, clock, street name, minimap and touch controls.

var game  # the main scene (scripts/main.gd)
var bike: Motorcycle
var minimap: DarsiMinimap

var _speed_label: Label
var _unit_label: Label
var _gear_label: Label
var _street_label: Label
var _landmark_label: Label
var _clock_label: Label
var _mode_label: Label
var _notice_label: Label
var _fuel_bar: ProgressBar
var _rpm_bar: ProgressBar
var _attribution: Label
var _help: Label
var _touch_root: Control


func setup(owner_game) -> void:
	game = owner_game
	bike = owner_game.bike
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build()


func _build() -> void:
	var panel := PanelContainer.new()
	panel.name = "SpeedPanel"
	panel.position = Vector2(20, 0)
	panel.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	panel.offset_left = 20
	panel.offset_top = -168
	panel.offset_right = 290
	panel.offset_bottom = -20
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.07, 0.08, 0.09, 0.78)
	style.corner_radius_top_left = 10
	style.corner_radius_top_right = 10
	style.corner_radius_bottom_left = 10
	style.corner_radius_bottom_right = 10
	style.content_margin_left = 14
	style.content_margin_right = 14
	style.content_margin_top = 10
	style.content_margin_bottom = 10
	panel.add_theme_stylebox_override("panel", style)
	add_child(panel)

	var column := VBoxContainer.new()
	panel.add_child(column)

	var speed_row := HBoxContainer.new()
	column.add_child(speed_row)
	_speed_label = Label.new()
	_speed_label.text = "0"
	_speed_label.add_theme_font_size_override("font_size", 58)
	speed_row.add_child(_speed_label)
	_unit_label = Label.new()
	_unit_label.text = " km/h"
	_unit_label.add_theme_font_size_override("font_size", 20)
	_unit_label.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
	speed_row.add_child(_unit_label)

	_rpm_bar = ProgressBar.new()
	_rpm_bar.max_value = 9500
	_rpm_bar.show_percentage = false
	_rpm_bar.custom_minimum_size = Vector2(240, 8)
	column.add_child(_rpm_bar)

	var info_row := HBoxContainer.new()
	column.add_child(info_row)
	_gear_label = Label.new()
	_gear_label.text = "N"
	_gear_label.add_theme_font_size_override("font_size", 18)
	info_row.add_child(_gear_label)
	var spacer := Control.new()
	spacer.custom_minimum_size = Vector2(16, 0)
	info_row.add_child(spacer)
	_mode_label = Label.new()
	_mode_label.add_theme_font_size_override("font_size", 14)
	info_row.add_child(_mode_label)

	_fuel_bar = ProgressBar.new()
	_fuel_bar.max_value = Motorcycle.FUEL_CAPACITY
	_fuel_bar.show_percentage = false
	_fuel_bar.custom_minimum_size = Vector2(240, 10)
	column.add_child(_fuel_bar)

	# Top-left context strip.
	var top := VBoxContainer.new()
	top.position = Vector2(20, 16)
	add_child(top)
	_street_label = Label.new()
	_street_label.add_theme_font_size_override("font_size", 22)
	_street_label.add_theme_color_override("font_color", Color(1, 0.95, 0.82))
	top.add_child(_street_label)
	_landmark_label = Label.new()
	_landmark_label.add_theme_font_size_override("font_size", 15)
	top.add_child(_landmark_label)
	_clock_label = Label.new()
	_clock_label.add_theme_font_size_override("font_size", 15)
	top.add_child(_clock_label)

	_notice_label = Label.new()
	_notice_label.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_notice_label.offset_top = 90
	_notice_label.offset_left = -300
	_notice_label.offset_right = 300
	_notice_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_notice_label.add_theme_font_size_override("font_size", 22)
	_notice_label.add_theme_color_override("font_color", Color(1, 0.86, 0.5))
	add_child(_notice_label)

	_help = Label.new()
	_help.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	_help.offset_left = -430
	_help.offset_top = -92
	_help.offset_right = -16
	_help.offset_bottom = -34
	_help.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_help.add_theme_font_size_override("font_size", 13)
	_help.add_theme_color_override("font_color", Color(1, 1, 1, 0.65))
	_help.text = "W/S throttle+brake  A/D steer  Space rear brake  C camera  M map\nE interact  R recover  F fuel  L lights  H horn  T time  B ride mode"
	add_child(_help)

	_attribution = Label.new()
	_attribution.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	_attribution.offset_left = -520
	_attribution.offset_top = -30
	_attribution.offset_right = -16
	_attribution.offset_bottom = -8
	_attribution.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_attribution.add_theme_font_size_override("font_size", 12)
	_attribution.add_theme_color_override("font_color", Color(1, 1, 1, 0.55))
	_attribution.text = "Darsi 523247 - map data (c) OpenStreetMap contributors, ODbL"
	add_child(_attribution)

	minimap = DarsiMinimap.new()
	minimap.name = "Minimap"
	add_child(minimap)
	minimap.setup(game.world_builder.world, bike, game.landmarks)
	game.minimap = minimap

	if OS.has_feature("mobile") or DisplayServer.is_touchscreen_available():
		_build_touch_controls()


func _build_touch_controls() -> void:
	_touch_root = Control.new()
	_touch_root.name = "TouchControls"
	_touch_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_touch_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_touch_root)

	var buttons := [
		{"action": "accelerate", "text": "GAS", "anchor": Vector2(-150, -150), "preset": Control.PRESET_BOTTOM_RIGHT},
		{"action": "brake", "text": "BRAKE", "anchor": Vector2(-150, -70), "preset": Control.PRESET_BOTTOM_RIGHT},
		{"action": "steer_left", "text": "<", "anchor": Vector2(30, -110), "preset": Control.PRESET_BOTTOM_LEFT},
		{"action": "steer_right", "text": ">", "anchor": Vector2(130, -110), "preset": Control.PRESET_BOTTOM_LEFT},
	]
	for spec in buttons:
		var pad := Button.new()
		pad.text = spec.text
		pad.custom_minimum_size = Vector2(88, 64)
		pad.position = spec.anchor
		pad.set_anchors_preset(spec.preset)
		pad.button_down.connect(func(): Input.action_press(spec.action))
		pad.button_up.connect(func(): Input.action_release(spec.action))
		_touch_root.add_child(pad)


func _process(_delta: float) -> void:
	if bike == null:
		return
	_speed_label.text = str(bike.get_speed_kmh())
	_rpm_bar.value = bike.engine_rpm
	_gear_label.text = "Gear %d" % bike.gear if bike.gear > 0 else "N"
	_mode_label.text = "%s  |  %.1f km" % [bike.ride_mode, bike.odometer_m / 1000.0]
	_fuel_bar.value = bike.fuel
	_street_label.text = game.current_road if game.current_road != "" else "Darsi"
	_landmark_label.text = game.nearest_landmark
	_clock_label.text = "%s  -  lean %d deg" % [game.get_clock_string(), int(bike.get_lean_degrees())]
	_notice_label.text = game.get_notification()
