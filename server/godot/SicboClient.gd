extends Node
## Sic Bo Godot 4 client: WebSocket + 3D physics cup shake.
## Needs child SubViewport path: CupLayer/SubViewport/DiceCup3D
## Optional 2D die1/die2/die3 for final face display.

@export var server_url: String = "ws://127.0.0.1:3050"
@export var auth_token: String = "demo-godot-token"

var _peer := WebSocketPeer.new()
var _connected := false
var _faces: Array[Texture2D] = []
var _dice: Array[Sprite2D] = []
var _cup: Node3D
var _shaking := false
var _pending_result: Array = []

signal state_updated(state: Dictionary)
signal round_result(result: Dictionary)
signal bet_result(result: Dictionary)
signal auth_ok(user: Dictionary)

func _ready() -> void:
	_load_faces()
	_find_dice()
	_cup = get_node_or_null("CupLayer/SubViewport/DiceCup3D")
	# hide old video sprite if present
	var old := get_node_or_null("shake_anim")
	if old:
		old.visible = false
	_set_dice_visible(false)
	set_process_input(true)
	_ensure_shake_button()
	var err := _peer.connect_to_url(server_url)
	if err != OK:
		push_error("WebSocket connect failed: %s" % err)
	print("[sicbo] 3D cup=", _cup != null, " | Space/V/click 摇盅")
	# Auto demo so user sees motion without hunting for a key
	await get_tree().create_timer(0.6).timeout
	_trigger_preview_shake()

func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		var k: Key = event.keycode
		var pk: Key = event.physical_keycode
		if k == KEY_V or k == KEY_SPACE or pk == KEY_V or pk == KEY_SPACE:
			_trigger_preview_shake()
			get_viewport().set_input_as_handled()

func _trigger_preview_shake() -> void:
	if _shaking:
		print("[sicbo] already shaking, ignore")
		return
	_pending_result = [1 + randi() % 6, 1 + randi() % 6, 1 + randi() % 6]
	print("[sicbo] PREVIEW SHAKE -> ", _pending_result)
	_play_shake()

func _ensure_shake_button() -> void:
	if get_node_or_null("UILayer/ShakeBtn") != null:
		return
	var layer := get_node_or_null("UILayer") as CanvasLayer
	if layer == null:
		layer = CanvasLayer.new()
		layer.name = "UILayer"
		layer.layer = 100
		add_child(layer)
	var btn := Button.new()
	btn.name = "ShakeBtn"
	btn.text = "摇盅 (空格)"
	btn.position = Vector2(36, 36)
	btn.size = Vector2(180, 58)
	btn.add_theme_font_size_override("font_size", 22)
	btn.pressed.connect(_trigger_preview_shake)
	layer.add_child(btn)
func _load_faces() -> void:
	_faces.clear()
	_faces.append(null)
	for i in range(1, 7):
		var path := "res://dice/die-face-%d.png" % i
		var tex := load(path) as Texture2D
		if tex == null:
			push_error("Missing texture: %s" % path)
		_faces.append(tex)

func _find_dice() -> void:
	_dice.clear()
	for name in ["die1", "die2", "die3"]:
		var n := get_node_or_null(name)
		if n is Sprite2D:
			_dice.append(n)
	print("[sicbo] result dice sprites: ", _dice.size())

func _process(_delta: float) -> void:
	_peer.poll()
	var st := _peer.get_ready_state()
	if st == WebSocketPeer.STATE_OPEN:
		if not _connected:
			_connected = true
			_send({"type": "auth", "token": auth_token})
			print("[sicbo] connected, auth sent")
		while _peer.get_available_packet_count() > 0:
			var raw := _peer.get_packet().get_string_from_utf8()
			_on_message(raw)
	elif st == WebSocketPeer.STATE_CLOSED:
		if _connected:
			print("[sicbo] disconnected")
		_connected = false

func _send(obj: Dictionary) -> void:
	_peer.send_text(JSON.stringify(obj))

func place_bet(bet_type: String, amount: float) -> void:
	_send({"type": "bet", "betType": bet_type, "amount": amount})

func _on_message(raw: String) -> void:
	var data = JSON.parse_string(raw)
	if typeof(data) != TYPE_DICTIONARY:
		return
	var t: String = str(data.get("type", ""))
	match t:
		"auth_result":
			if data.get("ok", false):
				auth_ok.emit(data)
				print("[sicbo] auth ok, balance=", data.get("balance"))
		"state":
			state_updated.emit(data)
			var phase := str(data.get("phase", ""))
			if phase == "rolling" and not _shaking:
				_play_shake()
			if phase == "settle" or phase == "closed":
				if not _shaking:
					var dice = data.get("dice", null)
					if typeof(dice) == TYPE_ARRAY and dice.size() >= 3:
						_show_faces([int(dice[0]), int(dice[1]), int(dice[2])])
		"result":
			round_result.emit(data)
			var dice = data.get("dice", [])
			if typeof(dice) == TYPE_ARRAY and dice.size() >= 3:
				print("[sicbo] result ", dice)
				_pending_result = [int(dice[0]), int(dice[1]), int(dice[2])]
				_play_shake()
		"bet_result":
			bet_result.emit(data)
		_:
			pass

func _play_shake() -> void:
	if _shaking:
		return
	_shaking = true
	# Final faces live on 3D dice inside the cup; hide 2D result sprites during shake
	_set_dice_visible(false)
	var faces: Array = _pending_result if _pending_result.size() >= 3 else []
	if _cup and _cup.has_method("play_shake"):
		print("[sicbo] 3D physics shake start faces=", faces)
		await _cup.play_shake(faces)
	else:
		push_warning("[sicbo] DiceCup3D missing")
		await get_tree().create_timer(1.2).timeout
	_shaking = false
	if faces.size() >= 3:
		_show_faces(faces)
	# keep result sprites off — 3D cup already shows controlled faces
	_set_dice_visible(false)
	print("[sicbo] shake done")

func _set_dice_visible(v: bool) -> void:
	for d in _dice:
		d.visible = v

func _show_faces(faces: Array) -> void:
	for i in range(mini(3, faces.size())):
		if i >= _dice.size():
			break
		var val := int(faces[i])
		if val < 1 or val > 6:
			continue
		if _faces.size() > val and _faces[val] != null:
			_dice[i].texture = _faces[val]
