class_name DarsiRadar
extends Control
## Minimal hand-drawn radar avoids a large texture and stays crisp at Android resolutions.

var player_position := Vector3.ZERO
var player_heading := 0.0
var landmark_points: Array[Dictionary] = []
var traffic_points: Array[Vector3] = []
var radius_m := 230.0

func _ready() -> void:
	custom_minimum_size = Vector2(164, 164)
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func update_radar(position: Vector3, heading: float, landmarks: Array[Dictionary], traffic: Array[Vector3]) -> void:
	player_position = position
	player_heading = heading
	landmark_points = landmarks
	traffic_points = traffic
	queue_redraw()

func _draw() -> void:
	var center := size * 0.5
	var r := min(size.x, size.y) * 0.43
	draw_circle(center, r + 10.0, Color(0.03, 0.08, 0.08, 0.90))
	draw_circle(center, r, Color(0.10, 0.18, 0.17, 0.98))
	draw_arc(center, r, 0.0, TAU, 48, Color(0.82, 0.72, 0.48, 0.6), 1.5)
	draw_arc(center, r * 0.52, 0.0, TAU, 36, Color(0.82, 0.72, 0.48, 0.18), 1.0)
	for angle in [0.0, PI * 0.5, PI, PI * 1.5]:
		var endpoint := center + Vector2(cos(angle), sin(angle)) * r
		draw_line(center, endpoint, Color(0.82, 0.72, 0.48, 0.16), 1.0)
	for landmark in landmark_points:
		var relative: Vector3 = landmark.position - player_position
		if Vector2(relative.x, relative.z).length() > radius_m:
			continue
		var map_pos := Vector2(relative.x, relative.z) / radius_m * r
		var color := Color("#f3bd62") if landmark.kind == "fuel" else Color("#e8e2be")
		draw_circle(center + Vector2(map_pos.x, map_pos.y), 3.2, color)
	for traffic in traffic_points:
		var relative_traffic: Vector3 = traffic - player_position
		if Vector2(relative_traffic.x, relative_traffic.z).length() <= radius_m:
			var traffic_pos := Vector2(relative_traffic.x, relative_traffic.z) / radius_m * r
			draw_circle(center + Vector2(traffic_pos.x, traffic_pos.y), 2.2, Color("#df7350"))
	var arrow := PackedVector2Array([center + Vector2(0, -9), center + Vector2(6, 8), center + Vector2(0, 4), center + Vector2(-6, 8)])
	draw_colored_polygon(arrow, Color("#7dd0ba"))
