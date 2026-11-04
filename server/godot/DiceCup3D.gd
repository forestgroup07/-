extends Node3D
## Transparent cup + 3 textured rigid dice. play_shake(faces) = big tumble then snap faces.
signal shake_finished

@export var shake_seconds: float = 1.8
@export var impulse_strength: float = 9.0
@export var torque_strength: float = 12.0
@export var cup_amp_y: float = 0.38
@export var cup_amp_xz: float = 0.09
@export var die_size: float = 0.14

## Face textures on cube: +Y=1 -Y=6 +Z=2 -Z=5 +X=3 -X=4 (opposites sum to 7)
const FACE_TEX := {
	1: "res://dice/die-face-1.png",
	2: "res://dice/die-face-2.png",
	3: "res://dice/die-face-3.png",
	4: "res://dice/die-face-4.png",
	5: "res://dice/die-face-5.png",
	6: "res://dice/die-face-6.png",
}

var _dice: Array[RigidBody3D] = []
var _cup_root: Node3D
var _cup_base: Vector3 = Vector3.ZERO
var _shaking := false
var _built := false
var _face_tex: Array[Texture2D] = []

func _ready() -> void:
	_load_face_textures()
	if not _built:
		_build_world()

func _load_face_textures() -> void:
	_face_tex.clear()
	_face_tex.append(null)
	for i in range(1, 7):
		var tex := load(FACE_TEX[i]) as Texture2D
		if tex == null:
			push_error("[DiceCup3D] missing %s" % FACE_TEX[i])
		_face_tex.append(tex)

## result_faces: optional [d1,d2,d3] in 1..6 — snapped after shake
func play_shake(result_faces: Array = []) -> void:
	if _shaking:
		return
	if not _built:
		_build_world()
	_shaking = true
	_unfreeze_dice()
	_reset_dice_pose()
	await _shake_loop()
	_settle_dice()
	await get_tree().create_timer(0.55).timeout
	if result_faces.size() >= 3:
		_snap_to_faces(result_faces)
	_shaking = false
	shake_finished.emit()

func _shake_loop() -> void:
	var end_t := Time.get_ticks_msec() + int(shake_seconds * 1000.0)
	var t0 := Time.get_ticks_msec()
	while Time.get_ticks_msec() < end_t:
		var u := float(Time.get_ticks_msec() - t0) / maxf(shake_seconds * 1000.0, 1.0)
		# Big vertical cup motion (fast then settle)
		var envelope := sin(u * PI)
		var shake_hz := lerpf(14.0, 7.0, u)
		var phase := u * shake_hz * TAU
		if _cup_root:
			_cup_root.position = _cup_base + Vector3(
				sin(phase * 1.3) * cup_amp_xz * envelope,
				absf(sin(phase)) * cup_amp_y * envelope,
				cos(phase * 0.9) * cup_amp_xz * envelope
			)
		for d in _dice:
			if d == null:
				continue
			var dir := Vector3(randf_range(-1, 1), randf_range(0.6, 1.4), randf_range(-1, 1)).normalized()
			d.apply_central_impulse(dir * impulse_strength * randf_range(0.7, 1.15) * envelope)
			d.apply_torque_impulse(
				Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1))
				* torque_strength * randf_range(0.7, 1.2)
			)
		await get_tree().create_timer(0.04).timeout
	if _cup_root:
		_cup_root.position = _cup_base

func _settle_dice() -> void:
	for d in _dice:
		if d == null:
			continue
		d.linear_velocity *= 0.15
		d.angular_velocity *= 0.15

func _unfreeze_dice() -> void:
	for d in _dice:
		if d == null:
			continue
		d.freeze = false
		d.sleeping = false

func _snap_to_faces(faces: Array) -> void:
	var spots := _rest_spots()
	for i in range(mini(3, faces.size())):
		var d := _dice[i]
		var val := clampi(int(faces[i]), 1, 6)
		d.linear_velocity = Vector3.ZERO
		d.angular_velocity = Vector3.ZERO
		d.freeze = true
		d.transform = Transform3D(_basis_face_up(val), spots[i])

func _basis_face_up(face: int) -> Basis:
	# Local axis where that face texture lives
	var local_n := Vector3.UP
	match face:
		1: local_n = Vector3.UP
		6: local_n = Vector3.DOWN
		2: local_n = Vector3(0, 0, 1)   # +Z
		5: local_n = Vector3(0, 0, -1)  # -Z
		3: local_n = Vector3.RIGHT
		4: local_n = Vector3.LEFT
	# Rotate so local_n → world UP
	if local_n.dot(Vector3.UP) > 0.999:
		return Basis.IDENTITY
	if local_n.dot(Vector3.UP) < -0.999:
		return Basis.from_euler(Vector3(PI, 0, 0))
	var axis := local_n.cross(Vector3.UP).normalized()
	var ang := local_n.angle_to(Vector3.UP)
	return Basis(axis, ang)

func _rest_spots() -> Array[Vector3]:
	return [
		Vector3(-0.08, 0.12, -0.05),
		Vector3(0.09, 0.12, 0.04),
		Vector3(0.0, 0.12, 0.09),
	] as Array[Vector3]

func _reset_dice_pose() -> void:
	var spots := _rest_spots()
	for i in range(_dice.size()):
		var d := _dice[i]
		d.linear_velocity = Vector3.ZERO
		d.angular_velocity = Vector3.ZERO
		d.freeze = false
		d.transform = Transform3D(
			Basis.from_euler(Vector3(randf() * TAU, randf() * TAU, randf() * TAU)),
			spots[i] + Vector3(0, 0.18 + i * 0.04, 0)
		)
		d.sleeping = false

func _build_world() -> void:
	_built = true
	_cup_root = Node3D.new()
	_cup_root.name = "CupRoot"
	add_child(_cup_root)
	_cup_base = _cup_root.position

	var cam := Camera3D.new()
	cam.name = "Cam"
	cam.position = Vector3(0.0, 1.05, 0.62)
	cam.rotation_degrees = Vector3(-52, 0, 0)
	cam.fov = 40.0
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

	var floor_body := _make_static_box(Vector3(0, -0.04, 0), Vector3(0.72, 0.08, 0.72), Color(0.15, 0.15, 0.18))
	floor_body.name = "Floor"
	_cup_root.add_child(floor_body)

	# Ring walls (hollow transparent cup collision)
	var wall_count := 20
	var radius := 0.34
	for i in range(wall_count):
		var ang := float(i) / float(wall_count) * TAU
		var wall := _make_static_box(
			Vector3(cos(ang) * radius, 0.30, sin(ang) * radius),
			Vector3(0.08, 0.62, 0.14),
			Color(0.75, 0.8, 0.85, 0.12)
		)
		wall.rotation.y = -ang
		wall.name = "Wall%d" % i
		_cup_root.add_child(wall)

	# Glass visual
	var glass := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.36
	cyl.bottom_radius = 0.36
	cyl.height = 0.58
	cyl.radial_segments = 36
	glass.mesh = cyl
	glass.position = Vector3(0, 0.30, 0)
	var glass_mat := StandardMaterial3D.new()
	glass_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	glass_mat.albedo_color = Color(0.78, 0.88, 0.98, 0.28)
	glass_mat.roughness = 0.05
	glass_mat.metallic = 0.12
	glass_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	glass.material_override = glass_mat
	_cup_root.add_child(glass)

	# Soft glass dome cap
	var cap := MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = 0.36
	sphere.height = 0.36
	sphere.is_hemisphere = true
	cap.mesh = sphere
	cap.position = Vector3(0, 0.58, 0)
	cap.material_override = glass_mat
	_cup_root.add_child(cap)

	var base := MeshInstance3D.new()
	var base_mesh := TorusMesh.new()
	base_mesh.inner_radius = 0.28
	base_mesh.outer_radius = 0.40
	base.mesh = base_mesh
	base.position = Vector3(0, 0.01, 0)
	base.rotation_degrees = Vector3(90, 0, 0)
	var chrome := StandardMaterial3D.new()
	chrome.albedo_color = Color(0.7, 0.72, 0.75)
	chrome.metallic = 0.95
	chrome.roughness = 0.22
	base.material_override = chrome
	_cup_root.add_child(base)

	_dice.clear()
	for i in range(3):
		var die := _make_die("Die%d" % (i + 1))
		_cup_root.add_child(die)
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
	body.mass = 0.32
	body.continuous_cd = true
	body.contact_monitor = true
	body.max_contacts_reported = 6
	body.physics_material_override = _die_phys_mat()
	var half := die_size * 0.5
	var col := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(die_size, die_size, die_size)
	col.shape = shape
	body.add_child(col)

	# Six textured faces (new die art)
	var specs := [
		{"n": Vector3.UP, "f": 1},
		{"n": Vector3.DOWN, "f": 6},
		{"n": Vector3(0, 0, 1), "f": 2},
		{"n": Vector3(0, 0, -1), "f": 5},
		{"n": Vector3.RIGHT, "f": 3},
		{"n": Vector3.LEFT, "f": 4},
	]
	for s in specs:
		body.add_child(_make_face_quad(s["n"], int(s["f"]), half))
	return body

func _make_face_quad(normal: Vector3, face_val: int, half: float) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.name = "Face%d" % face_val
	var q := QuadMesh.new()
	q.size = Vector2(die_size * 0.98, die_size * 0.98)
	mi.mesh = q
	mi.position = normal * (half + 0.0005)
	# QuadMesh faces -Z; build basis so -Z aligns with outward normal
	var up := Vector3.UP
	if absf(normal.dot(Vector3.UP)) > 0.95:
		up = Vector3.FORWARD
	# QuadMesh faces -Z; aim -Z along outward normal so texture faces out
	mi.basis = Basis.looking_at(normal, up)
	var mat := StandardMaterial3D.new()
	mat.roughness = 0.32
	mat.metallic = 0.02
	if _face_tex.size() > face_val and _face_tex[face_val] != null:
		mat.albedo_texture = _face_tex[face_val]
		mat.albedo_color = Color(1, 1, 1, 1)
	else:
		mat.albedo_color = Color(0.82, 0.08, 0.08)
	mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	mi.material_override = mat
	return mi

func _die_phys_mat() -> PhysicsMaterial:
	var pm := PhysicsMaterial.new()
	pm.bounce = 0.28
	pm.friction = 0.65
	return pm
