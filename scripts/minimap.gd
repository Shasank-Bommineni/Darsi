class_name DarsiMinimap
extends Control
## Draws the real Darsi street network around the rider, plus landmark pins.

var world: Dictionary = {}
var tracked: Node3D
var landmarks: Array[Dictionary] = []
var expanded := false
var scale_m_per_px := 2.2
var _roads: Array = []

const CLASS_COLOURS := {
	"highway": Color("#f2a93b"),
	"arterial": Color("#f0c267"),
	"collector": Color("#dedad0"),
	"neighbourhood": Color("#b9b4a8"),
	"lane": Color("#9d998e"),
	"track": Color("#8d7d5f"),
	"path": Color("#7d7363"),
}
const CLASS_WIDTH := {
	"highway": 3.4, "arterial": 2.8, "collector": 2.2, "neighbourhood": 1.6, "lane": 1.1, "track": 0.9, "path": 0.7,
}


func setup(world_data: Dictionary, target: Node3D, poi_list: Array[Dictionary]) -> void:
	world = world_data
	tracked = target
	landmarks = poi_list
	_roads.clear()
	for road in world.get("roads", []):
		var flat: Array = road.points
		var points := PackedVector2Array()
		var i := 0
		while i + 1 < flat.size():
			# OSM metre space -> screen space is a straight x/y mapping (y flipped on draw).
			points.append(Vector2(float(flat[i]), float(flat[i + 1])))
			i += 2
		if points.size() >= 2:
			_roads.append({"class": String(road["class"]), "points": points, "name": String(road.get("name", ""))})
	set_process(true)


func toggle_expanded() -> void:
	expanded = not expanded
	_apply_layout()


func _apply_layout() -> void:
	var viewport := get_viewport_rect().size
	if expanded:
		var side: float = minf(viewport.x, viewport.y) * 0.82
		size = Vector2(side, side)
		position = (viewport - size) * 0.5
		scale_m_per_px = 2100.0 / (side * 0.5)
	else:
		var side: float = clampf(minf(viewport.x, viewport.y) * 0.26, 150.0, 260.0)
		size = Vector2(side, side)
		position = Vector2(viewport.x - side - 16.0, 16.0)
		scale_m_per_px = 2.3


func _process(_delta: float) -> void:
	_apply_layout()
	queue_redraw()


func _draw() -> void:
	if tracked == null:
		return
	var centre := size * 0.5
	var radius: float = minf(size.x, size.y) * 0.5
	# Background disc / panel.
	if expanded:
		draw_rect(Rect2(Vector2.ZERO, size), Color(0.08, 0.09, 0.10, 0.93))
		draw_rect(Rect2(Vector2.ZERO, size), Color(0.85, 0.80, 0.68, 0.5), false, 2.0)
	else:
		draw_circle(centre, radius, Color(0.08, 0.09, 0.10, 0.85))

	# Rider position in OSM metre space (world x = east, world -z = north).
	var rider_x := tracked.global_position.x
	var rider_y := -tracked.global_position.z
	var heading := atan2(-tracked.global_transform.basis.z.x, tracked.global_transform.basis.z.z)

	var to_screen := func(p: Vector2) -> Vector2:
		var local := Vector2(p.x - rider_x, p.y - rider_y) / scale_m_per_px
		if not expanded:
			local = local.rotated(heading)  # rotate the map so "up" is the way you ride
		return centre + Vector2(local.x, -local.y)

	var limit: float = radius + 20.0
	for road in _roads:
		var colour: Color = CLASS_COLOURS.get(road["class"], Color.GRAY)
		var width: float = CLASS_WIDTH.get(road["class"], 1.0)
		var points: PackedVector2Array = road.points
		var screen := PackedVector2Array()
		for p in points:
			screen.append(to_screen.call(p))
		for i in range(1, screen.size()):
			var a: Vector2 = screen[i - 1]
			var b: Vector2 = screen[i]
			if (a - centre).length() > limit and (b - centre).length() > limit:
				continue
			draw_line(a, b, colour, width)

	for water in world.get("water", []):
		if water.has("outline"):
			var ring := PackedVector2Array()
			var flat: Array = water.outline
			var i := 0
			while i + 1 < flat.size():
				ring.append(to_screen.call(Vector2(float(flat[i]), float(flat[i + 1]))))
				i += 2
			if ring.size() >= 3:
				draw_colored_polygon(ring, Color(0.25, 0.49, 0.62, 0.85))

	for landmark in landmarks:
		var p: Vector2 = to_screen.call(Vector2(landmark.position.x, -landmark.position.z))
		if (p - centre).length() > limit:
			continue
		var colour := Color("#e0634f")
		match String(landmark.kind):
			"fuel": colour = Color("#ff7b54")
			"hospital", "clinic": colour = Color("#f4f4f4")
			"bus_station": colour = Color("#4fd08a")
			"police": colour = Color("#6ba4e8")
			"school", "college": colour = Color("#f2c94c")
			"theatre": colour = Color("#c77dff")
		draw_circle(p, 3.2, colour)
		if expanded:
			draw_string(ThemeDB.fallback_font, p + Vector2(5, 4), String(landmark.name), HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(1, 1, 1, 0.85))

	# Rider arrow.
	var arrow_angle := 0.0 if not expanded else -heading
	var tip := centre + Vector2(0, -8).rotated(arrow_angle)
	var left := centre + Vector2(-5, 6).rotated(arrow_angle)
	var right := centre + Vector2(5, 6).rotated(arrow_angle)
	draw_colored_polygon(PackedVector2Array([tip, left, right]), Color("#ffe066"))

	if expanded:
		draw_string(ThemeDB.fallback_font, Vector2(12, size.y - 12), "Darsi, Prakasam, Andhra Pradesh 523247 - map data (c) OpenStreetMap contributors (ODbL)", HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(1, 1, 1, 0.7))
