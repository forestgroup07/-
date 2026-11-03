extends Node3D
## Transparent cup + 3 rigid dice. Call play_shake() for a violent tumble.
signal shake_finished

@export var shake_seconds: float = 1.45
@export var impulse_strength: float = 4.2
@export var torque_strength: float = 6.0
@export var floor_jolt: float = 0.045

var _dice: Array[RigidBody3D] = []
var _floor: StaticBody3D
var _floor_base: Vector3 = Vector3.ZERO
var _shaking := false
var _built := false

func _ready() -> void:
	if not _built:
		_build_world()

func play_shake() -> void:
	if _shaking:
		return
	if not _built:
		_build_world()
	_shaking = true
	_reset_dice_pose()
	await _shake_loop()
	_shaking = false
	# let physics settle a bit
	await get_tree().create_timer(0.85).timeout
	shake_finished.emit()

func _shake_loop() -> void:
	var end_t := Time.get_ticks_msec() + int(shake_seconds * 1000.0)
	while Time.get_ticks_msec() < end_t:
		# jolt the floor like a real shaker plate
		if _floor:
			_floor.position = _floor_base + Vector3(
				randf_range(-floor_jolt, floor_jolt),
				randf_range(0.0, floor_jolt * 1.4),
				randf_range(-floor_jolt, floor_jolt)
			)
		for d in _dice:
			if d == null:
				continue
			var dir := Vector3(randf_range(-1, 1), randf_range(0.35, 1.2), randf_range(-1, 1)).normalized()
			d.apply_central_impulse(dir * impulse_strength * randf_range(0.55, 1.0))
			d.apply_torque_impulse(Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * torque_strength)
		await get_tree().create_timer(0.045).timeout
	if _floor:
		_floor.position = _floor_base

func _reset_dice_pose() -> void:
	var spots := [
		Vector3(-0.08, 0.22, -0.05),
		Vector3(0.09, 0.26, 0.04),
		Vector3(0.0, 0.34, 0.1),
	]
	for i in range(_dice.size()):
		var d := _dice[i]
		d.linear_velocity = Vector3.ZERO
		d.angular_velocity = Vector3.ZERO
		d.transform = Transform3D(Basis.from_euler(Vector3(randf() * 0.4, randf() * TAU, randf() * 0.4)), spots[i])
		d.sleeping = false

func _build_world() -> void:
	_built = true
	# Camera — top-down into the cup
	var cam := Camera3D.new()
	cam.name = "Cam"
	cam.position = Vector3(0.0, 0.95, 0.55)
	cam.rotation_degrees = Vector3(-55, 0, 0)
	cam.fov = 42.0
	cam.current = true
	add_child(cam)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-48, 35, 0)
	sun.light_energy = 1.35
	sun.shadow_enabled = true
	add_child(sun)

	var fill := OmniLight3D.new()
	fill.position = Vector3(0.2, 0.7, 0.3)
	fill.light_energy = 0.55
	fill.omni_range = 3.0
	add_child(fill)

	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0, 0, 0, 0)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.65, 0.62, 0.6)
	e.ambient_light_energy = 0.55
	env.environment = e
	add_child(env)

	_floor = _make_static_box(Vector3(0, -0.04, 0), Vector3(0.72, 0.08, 0.72), Color(0.15, 0.15, 0.18))
	_floor.name = "Floor"
	_floor_base = _floor.position
	add_child(_floor)

	# Ring walls (hollow cup)
	var wall_count := 18
	var radius := 0.36
	for i in range(wall_count):
		var ang := float(i) / float(wall_count) * TAU
		var wall := _make_static_box(
			Vector3(cos(ang) * radius, 0.28, sin(ang) * radius),
			Vector3(0.07, 0.56, 0.15),
			Color(0.75, 0.8, 0.85, 0.15)
		)
		wall.rotation.y = -ang
		wall.name = "Wall%d" % i
		add_child(wall)

	# Glass visual (no collision)
	var glass := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.37
	cyl.bottom_radius = 0.37
	cyl.height = 0.55
	cyl.radial_segments = 32
	glass.mesh = cyl
	glass.position = Vector3(0, 0.28, 0)
	var glass_mat := StandardMaterial3D.new()
	glass_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	glass_mat.albedo_color = Color(0.75, 0.85, 0.95, 0.18)
	glass_mat.roughness = 0.05
	glass_mat.metallic = 0.15
	glass_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	glass.material_override = glass_mat
	add_child(glass)

	# Chrome-ish base ring visual
	var base := MeshInstance3D.new()
	var base_mesh := TorusMesh.new()
	base_mesh.inner_radius = 0.30
	base_mesh.outer_radius = 0.40
	base.mesh = base_mesh
	base.position = Vector3(0, 0.01, 0)
	base.rotation_degrees = Vector3(90, 0, 0)
	var chrome := StandardMaterial3D.new()
	chrome.albedo_color = Color(0.7, 0.72, 0.75)
	chrome.metallic = 0.95
	chrome.roughness = 0.22
	base.material_override = chrome
	add_child(base)

	_dice.clear()
	for i in range(3):
		var die := _make_die("Die%d" % (i + 1))
		add_child(die)
		_dice.append(die)
	_reset_dice_pose()

func _make_static_box(pos: Vector3, size: Vector3, color: Color) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.position = pos
	var col := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	col.shape = shape
	body.add_child(col)
	var mesh_i := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = size
	mesh_i.mesh = box
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	if color.a < 0.99:
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.roughness = 0.35
	mesh_i.material_override = mat
	body.add_child(mesh_i)
	return body

func _make_die(die_name: String) -> RigidBody3D:
	var body := RigidBody3D.new()
	body.name = die_name
	body.mass = 0.35
	body.continuous_cd = true
	body.contact_monitor = true
	body.max_contacts_reported = 4
	body.physics_material_override = _die_phys_mat()
	var col := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(0.14, 0.14, 0.14)
	col.shape = shape
	body.add_child(col)
	var mesh_i := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(0.14, 0.14, 0.14)
	mesh_i.mesh = box
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.82, 0.08, 0.08)
	mat.roughness = 0.28
	mat.metallic = 0.05
	mesh_i.material_override = mat
	body.add_child(mesh_i)
	# simple white pip markers on +Y face (visual cue while tumbling)
	var pip := MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = 0.018
	sphere.height = 0.036
	pip.mesh = sphere
	pip.position = Vector3(0, 0.072, 0)
	var pip_mat := StandardMaterial3D.new()
	pip_mat.albedo_color = Color(0.95, 0.95, 0.95)
	pip.material_override = pip_mat
	body.add_child(pip)
	return body

func _die_phys_mat() -> PhysicsMaterial:
	var pm := PhysicsMaterial.new()
	pm.bounce = 0.35
	pm.friction = 0.55
	return pm
