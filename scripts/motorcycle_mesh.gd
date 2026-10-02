class_name MotorcycleMesh
extends RefCounted
## Procedural but genuinely motorcycle-shaped model of a 150cc Indian commuter bike
## (the fictional "Sahaja Vega 150" - no manufacturer badge, logo or copied silhouette).
##
## Everything is built from primitive meshes so the game ships without scraped assets,
## but the proportions come from a real commuter motorcycle:
##   wheelbase 1.32 m, seat height 0.80 m, ground clearance 0.17 m,
##   wheel diameter 0.46 m (18" front / 18" rear), total length 2.02 m.

const WHEELBASE := 1.32
const WHEEL_RADIUS := 0.23
const TYRE_WIDTH_FRONT := 0.075
const TYRE_WIDTH_REAR := 0.095

static func paint(colour: Color, roughness := 0.45, metallic := 0.0) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = colour
	material.roughness = roughness
	material.metallic = metallic
	return material


static func _box(parent: Node3D, size: Vector3, pos: Vector3, material: Material, rot := Vector3.ZERO, node_name := "Part") -> MeshInstance3D:
	var mesh := BoxMesh.new()
	mesh.size = size
	mesh.material = material
	var node := MeshInstance3D.new()
	node.name = node_name
	node.mesh = mesh
	node.position = pos
	node.rotation = rot
	parent.add_child(node)
	return node


static func _cyl(parent: Node3D, radius: float, height: float, pos: Vector3, material: Material, rot := Vector3.ZERO, node_name := "Cyl", segments := 12) -> MeshInstance3D:
	var mesh := CylinderMesh.new()
	mesh.top_radius = radius
	mesh.bottom_radius = radius
	mesh.height = height
	mesh.radial_segments = segments
	mesh.rings = 1
	mesh.material = material
	var node := MeshInstance3D.new()
	node.name = node_name
	node.mesh = mesh
	node.position = pos
	node.rotation = rot
	parent.add_child(node)
	return node


static func _cone(parent: Node3D, bottom: float, top: float, height: float, pos: Vector3, material: Material, rot := Vector3.ZERO, node_name := "Cone") -> MeshInstance3D:
	var mesh := CylinderMesh.new()
	mesh.top_radius = top
	mesh.bottom_radius = bottom
	mesh.height = height
	mesh.radial_segments = 12
	mesh.material = material
	var node := MeshInstance3D.new()
	node.name = node_name
	node.mesh = mesh
	node.position = pos
	node.rotation = rot
	parent.add_child(node)
	return node


static func _sphere(parent: Node3D, radius: float, pos: Vector3, material: Material, node_name := "Sphere") -> MeshInstance3D:
	var mesh := SphereMesh.new()
	mesh.radius = radius
	mesh.height = radius * 2.0
	mesh.radial_segments = 12
	mesh.rings = 6
	mesh.material = material
	var node := MeshInstance3D.new()
	node.name = node_name
	node.mesh = mesh
	node.position = pos
	parent.add_child(node)
	return node


## Builds one wheel: tyre torus, rim, hub, brake disc and spokes.
static func build_wheel(tyre_width: float, is_front: bool) -> Node3D:
	var root := Node3D.new()
	root.name = "FrontWheel" if is_front else "RearWheel"
	var rubber := paint(Color(0.07, 0.075, 0.08), 0.95)
	var chrome := paint(Color(0.78, 0.80, 0.83), 0.18, 0.9)
	var hub_metal := paint(Color(0.42, 0.44, 0.47), 0.35, 0.7)

	var tyre := TorusMesh.new()
	tyre.inner_radius = WHEEL_RADIUS - tyre_width
	tyre.outer_radius = WHEEL_RADIUS
	tyre.rings = 24
	tyre.ring_segments = 10
	tyre.material = rubber
	var tyre_node := MeshInstance3D.new()
	tyre_node.name = "Tyre"
	tyre_node.mesh = tyre
	tyre_node.rotation = Vector3(0.0, 0.0, PI * 0.5)
	root.add_child(tyre_node)

	# Rim band and hub.
	_cyl(root, WHEEL_RADIUS - tyre_width + 0.005, tyre_width * 0.55, Vector3.ZERO, chrome, Vector3(0, 0, PI * 0.5), "Rim", 20)
	_cyl(root, 0.055, tyre_width * 1.5, Vector3.ZERO, hub_metal, Vector3(0, 0, PI * 0.5), "Hub", 12)
	# Brake disc on the left side.
	_cyl(root, 0.115, 0.008, Vector3(-tyre_width * 0.95, 0, 0), chrome, Vector3(0, 0, PI * 0.5), "BrakeDisc", 16)

	var spokes := Node3D.new()
	spokes.name = "Spokes"
	root.add_child(spokes)
	var spoke_length := WHEEL_RADIUS - tyre_width - 0.04
	for i in range(12):
		var angle := TAU * float(i) / 12.0
		var mid := spoke_length * 0.5 + 0.045
		_cyl(
			spokes,
			0.006,
			spoke_length,
			Vector3(0.0, cos(angle) * mid, sin(angle) * mid),
			chrome,
			Vector3(angle + PI * 0.5, 0.0, 0.0),
			"Spoke%d" % i,
			5,
		)
	return root


## Assembles the complete bike. Returns a dictionary of the animated sub-nodes so the
## controller can spin the wheels, compress the forks and turn the handlebars.
static func build(body_colour := Color(0.72, 0.16, 0.13)) -> Dictionary:
	var root := Node3D.new()
	root.name = "SahajaVega150"

	var paint_main := paint(body_colour, 0.28, 0.35)
	var paint_dark := paint(Color(0.10, 0.11, 0.12), 0.55)
	var chrome := paint(Color(0.80, 0.82, 0.86), 0.16, 0.95)
	var engine_metal := paint(Color(0.48, 0.50, 0.52), 0.42, 0.75)
	var seat_vinyl := paint(Color(0.06, 0.06, 0.07), 0.82)
	var amber := paint(Color(1.0, 0.72, 0.2), 0.3)
	amber.emission_enabled = true
	amber.emission = Color(1.0, 0.62, 0.1)
	amber.emission_energy_multiplier = 1.6
	var lamp := paint(Color(1.0, 0.97, 0.86), 0.12)
	lamp.emission_enabled = true
	lamp.emission = Color(1.0, 0.95, 0.80)
	lamp.emission_energy_multiplier = 2.4
	var red_lamp := paint(Color(0.9, 0.1, 0.1), 0.25)
	red_lamp.emission_enabled = true
	red_lamp.emission = Color(0.9, 0.05, 0.05)
	red_lamp.emission_energy_multiplier = 1.8

	var front_x := -WHEELBASE * 0.5
	var rear_x := WHEELBASE * 0.5

	# ---------------------------------------------------------------- rear end
	var rear_assembly := Node3D.new()
	rear_assembly.name = "RearAssembly"
	root.add_child(rear_assembly)

	var rear_wheel := build_wheel(TYRE_WIDTH_REAR, false)
	rear_wheel.position = Vector3(0.0, WHEEL_RADIUS, rear_x)
	rear_assembly.add_child(rear_wheel)

	# Swingarm (two tubes) from the pivot to the rear axle.
	for side in [-1.0, 1.0]:
		_box(
			rear_assembly,
			Vector3(0.035, 0.055, 0.56),
			Vector3(side * 0.10, WHEEL_RADIUS + 0.035, rear_x - 0.28),
			paint_dark,
			Vector3(-0.09, 0.0, 0.0),
			"Swingarm",
		)
	# Twin rear shock absorbers.
	for side in [-1.0, 1.0]:
		_cyl(rear_assembly, 0.022, 0.26, Vector3(side * 0.115, WHEEL_RADIUS + 0.17, rear_x - 0.06), chrome, Vector3(0.32, 0.0, 0.0), "RearShock")
		_cyl(rear_assembly, 0.033, 0.14, Vector3(side * 0.115, WHEEL_RADIUS + 0.21, rear_x - 0.08), paint_main, Vector3(0.32, 0.0, 0.0), "ShockSpring")

	# Rear mudguard and chain cover.
	_box(rear_assembly, Vector3(0.18, 0.035, 0.42), Vector3(0.0, WHEEL_RADIUS + 0.24, rear_x - 0.02), paint_main, Vector3(0.06, 0, 0), "RearMudguard")
	_box(rear_assembly, Vector3(0.025, 0.10, 0.50), Vector3(0.115, WHEEL_RADIUS + 0.02, rear_x - 0.26), paint_dark, Vector3(-0.05, 0, 0), "ChainCover")
	_cyl(rear_assembly, 0.055, 0.02, Vector3(0.115, WHEEL_RADIUS, rear_x), engine_metal, Vector3(0, 0, PI * 0.5), "Sprocket", 16)

	# Tail light, number plate, grab rail.
	_box(rear_assembly, Vector3(0.14, 0.07, 0.05), Vector3(0.0, 0.70, rear_x + 0.17), red_lamp, Vector3.ZERO, "TailLight")
	_box(rear_assembly, Vector3(0.20, 0.14, 0.012), Vector3(0.0, 0.57, rear_x + 0.20), paint(Color(0.92, 0.92, 0.90), 0.7), Vector3(0.22, 0, 0), "NumberPlate")
	for side in [-1.0, 1.0]:
		_cyl(rear_assembly, 0.012, 0.34, Vector3(side * 0.16, 0.79, rear_x - 0.08), chrome, Vector3(PI * 0.5, 0, 0), "GrabRail")
		_sphere(rear_assembly, 0.035, Vector3(side * 0.17, 0.74, rear_x + 0.14), amber, "RearIndicator")

	# ------------------------------------------------------------- centre / engine
	# Twin-cradle frame tubes.
	for side in [-1.0, 1.0]:
		_box(root, Vector3(0.028, 0.028, 0.74), Vector3(side * 0.085, 0.40, 0.04), paint_dark, Vector3(0.12, 0, 0), "CradleTube")
		_box(root, Vector3(0.028, 0.44, 0.028), Vector3(side * 0.085, 0.60, rear_x - 0.42), paint_dark, Vector3(-0.30, 0, 0), "FrameRiser")
	_box(root, Vector3(0.06, 0.055, 0.86), Vector3(0.0, 0.78, 0.02), paint_dark, Vector3(-0.06, 0, 0), "Backbone")

	# Engine: crankcase, finned cylinder leaning forward, head and cover.
	_box(root, Vector3(0.26, 0.24, 0.34), Vector3(0.0, 0.40, 0.10), engine_metal, Vector3.ZERO, "Crankcase")
	_box(root, Vector3(0.22, 0.26, 0.20), Vector3(0.0, 0.60, -0.03), engine_metal, Vector3(-0.38, 0, 0), "Cylinder")
	for i in range(6):
		_box(root, Vector3(0.25, 0.012, 0.23), Vector3(0.0, 0.52 + float(i) * 0.038, -0.015 - float(i) * 0.015), engine_metal, Vector3(-0.38, 0, 0), "CoolingFin%d" % i)
	_box(root, Vector3(0.21, 0.09, 0.17), Vector3(0.0, 0.735, -0.075), engine_metal, Vector3(-0.38, 0, 0), "CylinderHead")
	_cyl(root, 0.085, 0.07, Vector3(0.14, 0.40, 0.14), engine_metal, Vector3(0, 0, PI * 0.5), "ClutchCover", 14)
	_cyl(root, 0.075, 0.06, Vector3(-0.145, 0.40, 0.08), engine_metal, Vector3(0, 0, PI * 0.5), "MagnetoCover", 14)
	# Kick starter and gear lever.
	_box(root, Vector3(0.02, 0.02, 0.17), Vector3(0.18, 0.33, 0.20), engine_metal, Vector3(0.35, 0, 0), "KickStarter")
	_box(root, Vector3(0.02, 0.02, 0.19), Vector3(-0.17, 0.27, -0.10), engine_metal, Vector3(0, 0, 0), "GearLever")
	# Foot pegs.
	for side in [-1.0, 1.0]:
		_cyl(root, 0.018, 0.11, Vector3(side * 0.20, 0.30, 0.12), paint_dark, Vector3(0, 0, PI * 0.5), "FootPeg")

	# Exhaust: header pipe curving down and back into the silencer.
	_cyl(root, 0.022, 0.30, Vector3(0.06, 0.44, -0.16), chrome, Vector3(-0.95, 0.35, 0.0), "ExhaustHeader")
	_cyl(root, 0.026, 0.42, Vector3(0.14, 0.30, 0.08), chrome, Vector3(PI * 0.5, 0.0, 0.10), "ExhaustMid")
	_cone(root, 0.040, 0.052, 0.46, Vector3(0.175, 0.33, 0.46), chrome, Vector3(PI * 0.5, 0.0, 0.05), "Silencer")
	_cyl(root, 0.030, 0.06, Vector3(0.185, 0.34, 0.70), paint_dark, Vector3(PI * 0.5, 0, 0.05), "ExhaustTip")

	# Fuel tank: tapered body with knee recesses, plus filler cap.
	_box(root, Vector3(0.30, 0.20, 0.52), Vector3(0.0, 0.90, -0.10), paint_main, Vector3(-0.04, 0, 0), "FuelTank")
	_box(root, Vector3(0.24, 0.12, 0.44), Vector3(0.0, 1.00, -0.11), paint_main, Vector3(-0.04, 0, 0), "TankTop")
	for side in [-1.0, 1.0]:
		_box(root, Vector3(0.05, 0.14, 0.30), Vector3(side * 0.155, 0.86, 0.02), paint_main, Vector3(0.0, 0.0, side * 0.22), "TankKneeGrip")
	_cyl(root, 0.045, 0.02, Vector3(0.0, 1.063, -0.22), chrome, Vector3.ZERO, "FillerCap", 12)
	_box(root, Vector3(0.235, 0.04, 0.09), Vector3(0.0, 1.03, -0.02), paint(Color(0.86, 0.86, 0.88), 0.3, 0.8), Vector3.ZERO, "TankStripe")

	# Seat: rider saddle + pillion step.
	_box(root, Vector3(0.26, 0.085, 0.42), Vector3(0.0, 0.80, 0.26), seat_vinyl, Vector3(-0.02, 0, 0), "RiderSeat")
	_box(root, Vector3(0.24, 0.075, 0.30), Vector3(0.0, 0.845, 0.60), seat_vinyl, Vector3.ZERO, "PillionSeat")
	# Side panels / tool box.
	for side in [-1.0, 1.0]:
		_box(root, Vector3(0.025, 0.16, 0.26), Vector3(side * 0.105, 0.665, 0.42), paint_main, Vector3.ZERO, "SidePanel")

	# ------------------------------------------------------------------ front end
	var steering := Node3D.new()
	steering.name = "Steering"
	steering.position = Vector3(0.0, 0.62, front_x + 0.12)
	root.add_child(steering)

	var fork_travel := Node3D.new()  # moves vertically to show suspension travel
	fork_travel.name = "ForkTravel"
	steering.add_child(fork_travel)

	var front_wheel := build_wheel(TYRE_WIDTH_FRONT, true)
	front_wheel.position = Vector3(0.0, WHEEL_RADIUS - 0.62, -0.12)
	fork_travel.add_child(front_wheel)

	# Telescopic forks with a 26-degree rake.
	for side in [-1.0, 1.0]:
		_cyl(fork_travel, 0.020, 0.52, Vector3(side * 0.095, -0.22, -0.055), chrome, Vector3(-0.45, 0, 0), "ForkTube")
		_cyl(fork_travel, 0.027, 0.26, Vector3(side * 0.095, -0.40, -0.11), paint_dark, Vector3(-0.45, 0, 0), "ForkSlider")
	_box(steering, Vector3(0.22, 0.03, 0.08), Vector3(0.0, 0.10, -0.015), engine_metal, Vector3(-0.45, 0, 0), "TopYoke")
	_box(steering, Vector3(0.22, 0.03, 0.08), Vector3(0.0, -0.06, -0.055), engine_metal, Vector3(-0.45, 0, 0), "BottomYoke")

	# Front mudguard follows the wheel.
	_box(fork_travel, Vector3(0.14, 0.03, 0.34), Vector3(0.0, -0.26, -0.14), paint_main, Vector3(-0.08, 0, 0), "FrontMudguard")

	# Handlebar, grips, levers, mirrors.
	_cyl(steering, 0.014, 0.62, Vector3(0.0, 0.16, 0.0), chrome, Vector3(0.0, 0.0, PI * 0.5), "Handlebar")
	for side in [-1.0, 1.0]:
		_cyl(steering, 0.021, 0.12, Vector3(side * 0.255, 0.16, 0.0), paint_dark, Vector3(0, 0, PI * 0.5), "Grip")
		_box(steering, Vector3(0.10, 0.012, 0.02), Vector3(side * 0.22, 0.145, -0.055), chrome, Vector3(0, side * 0.25, 0), "Lever")
		_cyl(steering, 0.008, 0.17, Vector3(side * 0.20, 0.25, 0.01), paint_dark, Vector3(0.1, 0, side * 0.18), "MirrorStem")
		_box(steering, Vector3(0.11, 0.065, 0.015), Vector3(side * 0.235, 0.33, 0.02), paint(Color(0.62, 0.70, 0.76), 0.1, 0.9), Vector3(0.18, 0, 0), "Mirror")
		_sphere(steering, 0.032, Vector3(side * 0.175, 0.09, -0.07), amber, "FrontIndicator")

	# Headlamp, cowl and instrument cluster.
	_cyl(steering, 0.088, 0.09, Vector3(0.0, 0.05, -0.085), paint_main, Vector3(PI * 0.5, 0, 0), "HeadlampShell", 16)
	_cyl(steering, 0.080, 0.02, Vector3(0.0, 0.05, -0.135), lamp, Vector3(PI * 0.5, 0, 0), "HeadlampLens", 16)
	_cyl(steering, 0.042, 0.05, Vector3(-0.045, 0.21, -0.045), paint_dark, Vector3(0.25, 0, 0), "Speedometer", 12)
	_cyl(steering, 0.042, 0.05, Vector3(0.045, 0.21, -0.045), paint_dark, Vector3(0.25, 0, 0), "Tachometer", 12)

	var headlight := SpotLight3D.new()
	headlight.name = "Headlight"
	headlight.position = Vector3(0.0, 0.05, -0.16)
	headlight.rotation = Vector3(-0.06, PI, 0.0)
	headlight.spot_range = 42.0
	headlight.spot_angle = 34.0
	headlight.light_energy = 2.4
	headlight.light_color = Color(1.0, 0.96, 0.86)
	headlight.shadow_enabled = false
	steering.add_child(headlight)

	return {
		"root": root,
		"steering": steering,
		"fork_travel": fork_travel,
		"front_wheel": front_wheel,
		"rear_wheel": rear_wheel,
		"headlight": headlight,
		"front_axle_local": Vector3(0.0, WHEEL_RADIUS, front_x),
		"rear_axle_local": Vector3(0.0, WHEEL_RADIUS, rear_x),
	}


## A simple seated rider so the bike does not look driverless in third person.
static func build_rider() -> Node3D:
	var rider := Node3D.new()
	rider.name = "Rider"
	var shirt := paint(Color(0.21, 0.35, 0.52), 0.8)
	var trousers := paint(Color(0.18, 0.19, 0.22), 0.85)
	var skin := paint(Color(0.68, 0.49, 0.33), 0.75)
	var helmet_paint := paint(Color(0.92, 0.92, 0.94), 0.25, 0.1)
	var visor := paint(Color(0.08, 0.09, 0.12), 0.1, 0.6)

	_box(rider, Vector3(0.30, 0.46, 0.22), Vector3(0.0, 1.12, 0.17), shirt, Vector3(-0.22, 0, 0), "Torso")
	_box(rider, Vector3(0.26, 0.16, 0.26), Vector3(0.0, 0.88, 0.28), trousers, Vector3.ZERO, "Hips")
	for side in [-1.0, 1.0]:
		_box(rider, Vector3(0.11, 0.11, 0.34), Vector3(side * 0.11, 0.80, 0.14), trousers, Vector3(0.55, 0, 0), "Thigh")
		_box(rider, Vector3(0.10, 0.30, 0.10), Vector3(side * 0.165, 0.52, 0.06), trousers, Vector3(-0.25, 0, 0), "Shin")
		_box(rider, Vector3(0.10, 0.08, 0.22), Vector3(side * 0.185, 0.33, 0.07), trousers, Vector3.ZERO, "Boot")
		_box(rider, Vector3(0.095, 0.095, 0.46), Vector3(side * 0.165, 1.17, -0.10), shirt, Vector3(0.42, side * 0.02, 0), "Arm")
		_sphere(rider, 0.05, Vector3(side * 0.185, 1.08, -0.30), skin, "Hand")
	_cyl(rider, 0.055, 0.09, Vector3(0.0, 1.39, 0.10), skin, Vector3.ZERO, "Neck", 10)
	_sphere(rider, 0.125, Vector3(0.0, 1.50, 0.08), helmet_paint, "Helmet")
	_box(rider, Vector3(0.17, 0.09, 0.03), Vector3(0.0, 1.50, -0.04), visor, Vector3(-0.1, 0, 0), "Visor")
	return rider
