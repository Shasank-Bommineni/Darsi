class_name Motorcycle
extends RigidBody3D
## A single-track (two-wheel) rigid body motorcycle.
##
## This is a real vehicle simulation rather than a kinematic fake:
##  * both wheels are raycast suspension units with spring/damper forces,
##  * the engine applies a torque curve through a five-speed gearbox to the rear contact
##    patch, limited by the available tyre grip (friction circle),
##  * the front wheel is steered, and the yaw of the bike is produced by the lateral tyre
##    force at the front contact patch, not by writing to rotation.y,
##  * the machine leans into corners and is held up by a rider-balance torque, which is how
##    a real rider keeps a single-track vehicle upright.
##
## Vehicle data corresponds to a 150cc Indian commuter motorcycle:
## 149.5 cc, 12.4 kW @ 8500 rpm, 13.0 Nm @ 6500 rpm, 148 kg kerb, 1.32 m wheelbase.

signal crashed
signal fuel_changed(litres: float)
signal gear_changed(gear: int)
signal respawned

# ---------------------------------------------------------------- vehicle data
const WHEELBASE := MotorcycleMesh.WHEELBASE
const WHEEL_RADIUS := MotorcycleMesh.WHEEL_RADIUS
const KERB_MASS := 148.0
const RIDER_MASS := 68.0

const SUSPENSION_REST := 0.34
const SUSPENSION_TRAVEL := 0.20
const SPRING_FRONT := 26000.0
const SPRING_REAR := 30000.0
const DAMP_FRONT := 2600.0
const DAMP_REAR := 3000.0

const GEAR_RATIOS := [0.0, 2.92, 1.78, 1.32, 1.05, 0.87]  # index 0 = neutral
const PRIMARY_RATIO := 3.35
const FINAL_DRIVE := 3.0
const IDLE_RPM := 1400.0
const REDLINE_RPM := 9500.0
const PEAK_TORQUE_NM := 13.0
const PEAK_TORQUE_RPM := 6500.0

const FUEL_CAPACITY := 12.0
const DRAG_COEFFICIENT := 0.68          # Cd*A for an upright rider, m^2
const AIR_DENSITY := 1.18
const ROLLING_RESISTANCE := 0.018

const MAX_STEER_ANGLE := deg_to_rad(32.0)
const MAX_LEAN := deg_to_rad(42.0)

# ---------------------------------------------------------------- state
var throttle := 0.0
var front_brake := 0.0
var rear_brake := 0.0
var steer_input := 0.0
var engine_running := true
var gear := 1
var engine_rpm := IDLE_RPM
var fuel := 9.0
var odometer_m := 0.0
var ride_mode := "Normal"
var headlight_on := true
var horn_timer := 0.0
var wet_grip := 1.0

var _steer_angle := 0.0
var _lean_target := 0.0
var _wheel_spin := [0.0, 0.0]
var _front_contact := false
var _rear_contact := false
var _front_compression := 0.0
var _crash_cooldown := 0.0
var _shift_timer := 0.0
var _spawn_transform := Transform3D()

var visual: Node3D
var steering_node: Node3D
var fork_node: Node3D
var front_wheel_node: Node3D
var rear_wheel_node: Node3D
var headlight: SpotLight3D
var rider: Node3D
var third_person_mount: Node3D
var cockpit_mount: Node3D

const MODE_SETTINGS := {
	"Arcade": {"grip": 1.35, "power": 1.2, "assist": 1.5},
	"Normal": {"grip": 1.0, "power": 1.0, "assist": 1.0},
	"Simulation": {"grip": 0.86, "power": 1.0, "assist": 0.6},
}


func _ready() -> void:
	mass = KERB_MASS + RIDER_MASS
	gravity_scale = 1.0
	continuous_cd = true
	can_sleep = false
	max_contacts_reported = 4
	contact_monitor = true
	collision_layer = 2
	collision_mask = 1
	# A low centre of mass behind the front axle, as on a real commuter bike.
	center_of_mass_mode = RigidBody3D.CENTER_OF_MASS_MODE_CUSTOM
	center_of_mass = Vector3(0.0, 0.42, 0.05)
	linear_damp = 0.0
	angular_damp = 0.6

	_build_collision()
	_build_visual()
	_spawn_transform = global_transform
	body_entered.connect(_on_body_entered)


func _build_collision() -> void:
	# A thin capsule along the bike's length keeps the chassis from clipping walls without
	# fighting the raycast suspension.
	var collider := CollisionShape3D.new()
	collider.name = "Chassis"
	var shape := CapsuleShape3D.new()
	shape.radius = 0.26
	shape.height = 1.35
	collider.shape = shape
	collider.position = Vector3(0.0, 0.58, 0.0)
	collider.rotation = Vector3(PI * 0.5, 0.0, 0.0)
	add_child(collider)


func _build_visual() -> void:
	var parts := MotorcycleMesh.build()
	visual = parts.root
	steering_node = parts.steering
	fork_node = parts.fork_travel
	front_wheel_node = parts.front_wheel
	rear_wheel_node = parts.rear_wheel
	headlight = parts.headlight
	# The visual hangs below the body origin: the body origin sits at the static ride height.
	visual.position = Vector3(0.0, -SUSPENSION_REST, 0.0)
	add_child(visual)

	rider = MotorcycleMesh.build_rider()
	rider.position = Vector3(0.0, -SUSPENSION_REST, 0.0)
	add_child(rider)

	third_person_mount = Node3D.new()
	third_person_mount.name = "ThirdPersonMount"
	third_person_mount.position = Vector3(0.0, 0.55, 0.0)
	add_child(third_person_mount)

	cockpit_mount = Node3D.new()
	cockpit_mount.name = "CockpitMount"
	cockpit_mount.position = Vector3(0.0, 0.92, -0.30)
	add_child(cockpit_mount)


# ---------------------------------------------------------------- input plumbing
func set_controls(p_throttle: float, p_front_brake: float, p_rear_brake: float, p_steer: float) -> void:
	throttle = clampf(p_throttle, 0.0, 1.0)
	front_brake = clampf(p_front_brake, 0.0, 1.0)
	rear_brake = clampf(p_rear_brake, 0.0, 1.0)
	steer_input = clampf(p_steer, -1.0, 1.0)


func set_ride_mode(mode: String) -> void:
	if MODE_SETTINGS.has(mode):
		ride_mode = mode


func cycle_ride_mode() -> String:
	var modes := ["Arcade", "Normal", "Simulation"]
	set_ride_mode(modes[(modes.find(ride_mode) + 1) % modes.size()])
	return ride_mode


func refuel() -> void:
	fuel = FUEL_CAPACITY
	fuel_changed.emit(fuel)


func toggle_headlight() -> void:
	headlight_on = not headlight_on
	if headlight:
		headlight.visible = headlight_on


func sound_horn() -> void:
	horn_timer = 0.6


func get_speed_mps() -> float:
	return linear_velocity.dot(-global_transform.basis.z)


func get_speed_kmh() -> int:
	return int(round(absf(get_speed_mps()) * 3.6))


func get_lean_degrees() -> float:
	var up := global_transform.basis.y
	var forward := -global_transform.basis.z
	var flat_right := forward.cross(Vector3.UP).normalized()
	return rad_to_deg(asin(clampf(up.dot(flat_right), -1.0, 1.0)))


func get_heading_degrees() -> float:
	var forward := -global_transform.basis.z
	return rad_to_deg(atan2(forward.x, -forward.z))


func respawn_at(point: Vector3, direction: Vector3) -> void:
	var flat := Vector3(direction.x, 0.0, direction.z)
	if flat.length() < 0.01:
		flat = Vector3.FORWARD
	flat = flat.normalized()
	var basis := Basis.looking_at(flat, Vector3.UP)
	linear_velocity = Vector3.ZERO
	angular_velocity = Vector3.ZERO
	global_transform = Transform3D(basis, point + Vector3(0.0, SUSPENSION_REST + 0.05, 0.0))
	_spawn_transform = global_transform
	gear = 1
	engine_rpm = IDLE_RPM
	respawned.emit()


func reset_to_spawn() -> void:
	linear_velocity = Vector3.ZERO
	angular_velocity = Vector3.ZERO
	global_transform = _spawn_transform


# ---------------------------------------------------------------- physics
func _physics_process(delta: float) -> void:
	horn_timer = maxf(0.0, horn_timer - delta)
	_crash_cooldown = maxf(0.0, _crash_cooldown - delta)
	_shift_timer = maxf(0.0, _shift_timer - delta)
	_update_visual(delta)


func _integrate_forces(state: PhysicsDirectBodyState3D) -> void:
	var delta := state.step
	var transform := state.transform
	var forward := -transform.basis.z
	var right := transform.basis.x
	var up := transform.basis.y
	var settings: Dictionary = MODE_SETTINGS.get(ride_mode, MODE_SETTINGS["Normal"])
	var grip_scale := float(settings.grip) * wet_grip

	var speed := state.linear_velocity.dot(forward)
	var abs_speed := absf(speed)

	# ----- steering: full lock at walking pace, very little at speed (real trail effect)
	var steer_limit: float = MAX_STEER_ANGLE / (1.0 + abs_speed * 0.42)
	var target_steer := steer_input * steer_limit
	_steer_angle = move_toward(_steer_angle, target_steer, delta * (5.0 + abs_speed * 0.6))

	# ----- suspension raycasts
	var space := state.get_space_state()
	var axles := [
		{"local": Vector3(0.0, 0.0, -WHEELBASE * 0.5), "spring": SPRING_FRONT, "damp": DAMP_FRONT, "front": true},
		{"local": Vector3(0.0, 0.0, WHEELBASE * 0.5), "spring": SPRING_REAR, "damp": DAMP_REAR, "front": false},
	]
	_front_contact = false
	_rear_contact = false
	var contacts := []

	for axle in axles:
		var origin: Vector3 = transform * (axle.local as Vector3)
		var query := PhysicsRayQueryParameters3D.create(origin, origin - up * (SUSPENSION_REST + SUSPENSION_TRAVEL + WHEEL_RADIUS))
		query.exclude = [get_rid()]
		query.collision_mask = 1
		var hit := space.intersect_ray(query)
		if hit.is_empty():
			if axle.front:
				_front_compression = lerpf(_front_compression, 0.0, delta * 6.0)
			continue

		var distance: float = origin.distance_to(hit.position)
		var compression: float = clampf((SUSPENSION_REST + WHEEL_RADIUS) - distance, -SUSPENSION_TRAVEL, SUSPENSION_TRAVEL)
		var point_velocity: Vector3 = state.get_velocity_at_local_position(origin - state.transform.origin)
		var vertical_velocity: float = point_velocity.dot(up)
		var spring_force: float = float(axle.spring) * compression - float(axle.damp) * vertical_velocity
		spring_force = maxf(0.0, spring_force)
		var load := spring_force

		var contact_point: Vector3 = hit.position
		state.apply_force(up * spring_force, contact_point - state.transform.origin)

		if axle.front:
			_front_contact = true
			_front_compression = lerpf(_front_compression, compression, delta * 12.0)
		else:
			_rear_contact = true

		contacts.append({
			"front": axle.front,
			"point": contact_point,
			"load": load,
			"velocity": point_velocity,
		})

	# ----- engine, gearbox, drive force
	var wheel_rpm := abs_speed / (TAU * WHEEL_RADIUS) * 60.0
	var ratio: float = GEAR_RATIOS[gear] * PRIMARY_RATIO * FINAL_DRIVE / 3.35
	engine_rpm = clampf(maxf(wheel_rpm * ratio * 1.9, IDLE_RPM), IDLE_RPM, REDLINE_RPM)

	var drive_force := 0.0
	if engine_running and fuel > 0.0 and throttle > 0.01 and gear > 0:
		var torque := _engine_torque(engine_rpm) * float(settings.power)
		var wheel_torque: float = torque * GEAR_RATIOS[gear] * PRIMARY_RATIO * FINAL_DRIVE / 3.35 * 0.92
		drive_force = wheel_torque / WHEEL_RADIUS * throttle
		# Clutch slip off the line so first gear does not launch the bike like a rocket.
		if abs_speed < 2.0:
			drive_force *= 0.55 + abs_speed * 0.22
		fuel = maxf(0.0, fuel - delta * (0.00022 + throttle * 0.00055 + abs_speed * 0.000045))
		fuel_changed.emit(fuel)
	if fuel <= 0.0:
		engine_running = false

	# Resistances always oppose motion.
	var drag := 0.5 * AIR_DENSITY * DRAG_COEFFICIENT * speed * absf(speed)
	var rolling := ROLLING_RESISTANCE * mass * 9.81 * signf(speed)
	var engine_brake := 0.0
	if throttle < 0.05 and abs_speed > 0.3:
		engine_brake = (18.0 + abs_speed * 4.2) * signf(speed)

	var brake_force := (front_brake * 2100.0 + rear_brake * 1150.0) * signf(speed)
	if abs_speed < 0.4:
		brake_force = 0.0
		if throttle < 0.05:
			# Hold the bike still on the spot instead of creeping.
			state.linear_velocity = state.linear_velocity.project(up)

	var longitudinal := drive_force - drag - rolling - engine_brake - brake_force

	# ----- tyre forces at the contact patches
	for contact in contacts:
		var load: float = contact.load
		var is_front: bool = contact.front
		var patch_velocity: Vector3 = contact.velocity
		var offset: Vector3 = contact.point - state.transform.origin

		# Wheel heading: the front wheel is steered about the bike's up axis.
		var wheel_forward := forward
		if is_front:
			wheel_forward = forward.rotated(up, -_steer_angle)
		var wheel_right := wheel_forward.cross(up).normalized()

		var lateral_velocity := patch_velocity.dot(wheel_right)
		var mu: float = 1.05 * grip_scale
		var max_friction: float = mu * load

		# Lateral force: linear in slip, saturating at the friction limit.
		var lateral_force := clampf(-lateral_velocity * 420.0, -max_friction, max_friction)
		# Longitudinal force is delivered by the rear wheel, braking by both.
		var longitudinal_force := 0.0
		if is_front:
			longitudinal_force = clampf(longitudinal * 0.35, -max_friction, max_friction) if longitudinal < 0.0 else 0.0
		else:
			longitudinal_force = clampf(longitudinal if longitudinal > 0.0 else longitudinal * 0.65, -max_friction, max_friction)

		# Friction circle.
		var combined := Vector2(longitudinal_force, lateral_force)
		if combined.length() > max_friction and max_friction > 0.0:
			combined = combined.normalized() * max_friction
		state.apply_force(wheel_forward * combined.x + wheel_right * combined.y, offset)

	# ----- rider balance: lean into the corner and stay upright
	var on_ground := _front_contact or _rear_contact
	if on_ground:
		var turn_radius_curvature := tan(_steer_angle) / WHEELBASE
		# Ideal lean for the current speed and path curvature.
		_lean_target = clampf(atan(speed * speed * turn_radius_curvature / 9.81), -MAX_LEAN, MAX_LEAN)
		# Counter-steering feel: at speed, pushing the bar leans the bike the other way first.
		if abs_speed > 6.0:
			_lean_target = clampf(_lean_target + steer_input * 0.18, -MAX_LEAN, MAX_LEAN)

		var current_lean := asin(clampf(up.dot(forward.cross(Vector3.UP).normalized()), -1.0, 1.0))
		var roll_rate := state.angular_velocity.dot(forward)
		var assist: float = float(settings.assist)
		var balance_torque := (_lean_target - current_lean) * 5200.0 * assist - roll_rate * 1500.0 * assist
		# A stopped bike is held up by the rider's feet.
		if abs_speed < 1.5:
			balance_torque += -current_lean * 4200.0 - roll_rate * 1800.0
		state.apply_torque(forward * balance_torque)

		# Damp any yaw that is not matched by the steering input - stops tank-slappers.
		var yaw_rate := state.angular_velocity.dot(up)
		var desired_yaw := speed * tan(_steer_angle) / WHEELBASE
		state.apply_torque(up * ((desired_yaw - yaw_rate) * 900.0 * assist))

		# Keep the pitch sensible (no endless wheelies/stoppies).
		var pitch_rate := state.angular_velocity.dot(right)
		var pitch := asin(clampf(forward.dot(Vector3.UP), -1.0, 1.0))
		state.apply_torque(right * (-pitch * 3000.0 - pitch_rate * 1200.0))

	odometer_m += absf(speed) * delta

	# ----- crash / recovery
	if up.dot(Vector3.UP) < 0.35 and _crash_cooldown <= 0.0:
		_crash_cooldown = 2.5
		crashed.emit()


func _engine_torque(rpm: float) -> float:
	# Smooth single-cylinder curve: rises to the peak then falls away to the limiter.
	var normalised := rpm / PEAK_TORQUE_RPM
	var curve := 1.0 - 0.55 * pow(normalised - 1.0, 2.0)
	if rpm > REDLINE_RPM - 300.0:
		curve *= clampf((REDLINE_RPM - rpm) / 300.0, 0.0, 1.0)
	return PEAK_TORQUE_NM * maxf(0.12, curve)


func _auto_shift() -> void:
	if _shift_timer > 0.0:
		return
	var previous := gear
	if engine_rpm > 8200.0 and gear < GEAR_RATIOS.size() - 1 and throttle > 0.2:
		gear += 1
	elif engine_rpm < 3000.0 and gear > 1:
		gear -= 1
	if gear != previous:
		_shift_timer = 0.35
		gear_changed.emit(gear)


# ---------------------------------------------------------------- visuals
func _update_visual(delta: float) -> void:
	_auto_shift()
	var speed := get_speed_mps()
	if steering_node:
		steering_node.rotation.y = -_steer_angle
	if fork_node:
		fork_node.position.y = clampf(-_front_compression, -SUSPENSION_TRAVEL, SUSPENSION_TRAVEL) * 0.8
	var spin := speed / WHEEL_RADIUS * delta
	_wheel_spin[0] = fmod(_wheel_spin[0] + spin, TAU)
	_wheel_spin[1] = fmod(_wheel_spin[1] + spin, TAU)
	if front_wheel_node:
		front_wheel_node.rotation.x = _wheel_spin[0]
	if rear_wheel_node:
		rear_wheel_node.rotation.x = _wheel_spin[1]
	if rider:
		# The rider leans slightly into the turn and tucks as speed rises.
		rider.rotation.z = lerp(rider.rotation.z, -steer_input * 0.08, delta * 5.0)
		rider.rotation.x = lerp(rider.rotation.x, clampf(absf(speed) * 0.006, 0.0, 0.14), delta * 3.0)
	if headlight:
		headlight.visible = headlight_on


func _on_body_entered(body: Node) -> void:
	if _crash_cooldown > 0.0:
		return
	if absf(get_speed_mps()) > 9.0 and body is StaticBody3D:
		_crash_cooldown = 1.5
		crashed.emit()
