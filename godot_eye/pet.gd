extends Node2D
## ŒIL D'E.N.O.S. — widget de bureau (Desktop Pet). Fenêtre sans bordure, transparente, toujours au premier plan.
##  * le regard suit le curseur GLOBAL (DisplayServer.mouse_get_position), même hors de la fenêtre ;
##  * glisser = déplacer la fenêtre, avec un ressort (léger dépassement), un lancer inertiel et des rebonds sur les bords de l'écran ;
##  * un simple clic (sans glisser) envoie {"t":"click"} à Python : micro + capture d'écran + vision + voix ; clic droit : fermer ;
##  * Python -> Godot : idle / listening / thinking / say{text,audio_path} / quit.
## Lancement : godot --path godot_eye -- --port <P> --token <T>      (test : -- --selftest <dossier>)

const WIN := Vector2(360.0, 460.0)
const EYE_SIZE := 210.0
const EYE_POS := Vector2(75.0, 238.0)
const RED := Color(1.0, 0.08, 0.1)
const CYAN := Color(0.1, 0.95, 1.0)
const AMBER := Color(1.0, 0.62, 0.08)
const SPRING_K := 230.0
const SPRING_C := 19.0
const FRICTION := 1.6
const BOUNCE := 0.62

var eye: Control                               # EnosAvatar (œil 3D, défaut) ou ColorRect + eye.gdshader (--eye2d, repli 2D)
var mat                                        # expose set_shader_parameter() dans les deux cas
var bubble: PanelContainer
var bubble_label: RichTextLabel
var player: AudioStreamPlayer
var persona := "enos"                           # "enos" : l'Œil rouge · "eto" : la boule blanche au visage bleu (eto_face.gd)
var wrap: Node2D
var face: Node2D
var bubble_box: StyleBoxFlat
var opt_bubble := true                          # option : bulle de texte au-dessus de la tête (utile aux sourds)
var opt_voice := true                           # option : voix de l'IA (coupée = texte seul)
var opt_typing := false                         # option : un clic sur la tête ouvre une zone de saisie au lieu du micro (utile aux muets)
var typer: LineEdit

var pos := Vector2.ZERO
var vel := Vector2.ZERO
var dragging := false
var grab := Vector2.ZERO
var press_at := Vector2.ZERO
var moved := 0.0
var mouse_override: Variant = null                # tests : curseur simulé

var look := Vector2.ZERO
var state := "idle"
var core := RED
var mood := 0.22
var speak := 0.0
var flare := 0.0
var hover := 0.0

var text_len := 0
var text_t := 0.0
var text_dur := 1.0
var text_active := false
var bubble_hold := 0.0

var ws := WebSocketPeer.new()
var url := ""
var was_open := false
var lost_since := -1.0
var retry_at := 0.0
var ping_at := 0.0
var started := 0.0
var selftest_dir := ""

var vacuum_busy := false                          # ASPIRATEUR en cours : la physique du glisser est suspendue
var vac_player: AudioStreamPlayer
var vac_woosh: AudioStreamWAV
var vac_pop: AudioStreamWAV


func _ready() -> void:
	started = Time.get_ticks_msec() / 1000.0
	get_viewport().transparent_bg = true
	var win := get_window()
	win.size = Vector2i(WIN)
	win.always_on_top = true
	win.transparent = true
	win.borderless = true
	_build()
	var port := ""
	var token := ""
	var args := OS.get_cmdline_user_args()
	for i in args.size():
		match args[i]:
			"--port": port = args[i + 1] if i + 1 < args.size() else ""
			"--token": token = args[i + 1] if i + 1 < args.size() else ""
			"--selftest": selftest_dir = args[i + 1] if i + 1 < args.size() else "."
			"--persona": persona = args[i + 1] if i + 1 < args.size() else "enos"
	url = "ws://127.0.0.1:%s/ws/pet?t=%s" % [port, token]
	var r := _usable()
	pos = (r.end - WIN - Vector2(36.0, 36.0)) if selftest_dir == "" else (r.position + Vector2(300.0, 200.0))
	DisplayServer.window_set_position(Vector2i(pos))
	_passthrough()
	_apply_persona()
	if selftest_dir != "":
		if persona == "eto":
			_selftest_eto()
		else:
			_selftest()


func _usable() -> Rect2:
	var scr := DisplayServer.window_get_current_screen()
	return Rect2(DisplayServer.screen_get_usable_rect(scr))


func _mouse() -> Vector2:
	if mouse_override != null:
		return mouse_override as Vector2
	return Vector2(DisplayServer.mouse_get_position())


func _passthrough() -> void:
	# seule la zone de l'œil capte la souris : le reste de la fenêtre (transparent) laisse passer les clics vers le bureau
	var pts := PackedVector2Array()
	var c := EYE_POS + Vector2(EYE_SIZE, EYE_SIZE) / 2.0
	for i in 28:
		pts.append(c + Vector2.from_angle(TAU * i / 28.0) * EYE_SIZE * 0.5)
	DisplayServer.window_set_mouse_passthrough(pts)


func _mono() -> SystemFont:
	var f := SystemFont.new()
	f.font_names = PackedStringArray(["Consolas", "Cascadia Mono", "Courier New", "monospace"])
	return f


func _build() -> void:
	if OS.get_cmdline_user_args().has("--eye2d"):
		var flat: ColorRect = ColorRect.new()
		var sm: ShaderMaterial = ShaderMaterial.new()
		sm.shader = load("res://shaders/eye.gdshader")
		flat.material = sm
		eye = flat
		mat = sm
	else:
		var avatar: Control = preload("res://avatar/enos_avatar.gd").new()          # preload : fonctionne même sans cache d'import (class_name non enregistré)
		eye = avatar
		mat = avatar
	eye.position = EYE_POS
	eye.size = Vector2(EYE_SIZE, EYE_SIZE)
	eye.pivot_offset = eye.size / 2.0
	eye.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(eye)
	wrap = Node2D.new()
	wrap.position = EYE_POS + Vector2(EYE_SIZE, EYE_SIZE) / 2.0
	add_child(wrap)
	face = Node2D.new()
	face.set_script(load("res://eto_face.gd"))
	face.R = EYE_SIZE * 0.44
	wrap.add_child(face)
	bubble = PanelContainer.new()
	bubble.position = Vector2(12.0, 10.0)
	bubble.size = Vector2(WIN.x - 24.0, 212.0)
	bubble.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bubble.modulate.a = 0.0
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.04, 0.008, 0.014, 0.94)
	sb.border_color = Color(0.95, 0.12, 0.2, 0.95)
	sb.set_border_width_all(2)
	sb.set_corner_radius_all(10)
	sb.shadow_color = Color(1.0, 0.1, 0.15, 0.35)
	sb.shadow_size = 10
	sb.set_content_margin_all(12)
	bubble.add_theme_stylebox_override("panel", sb)
	bubble_box = sb
	bubble_label = RichTextLabel.new()
	bubble_label.bbcode_enabled = true
	bubble_label.scroll_active = false
	bubble_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bubble_label.add_theme_font_override("normal_font", _mono())
	bubble_label.add_theme_font_size_override("normal_font_size", 17)
	bubble_label.add_theme_color_override("default_color", Color(1.0, 0.88, 0.9))
	bubble.add_child(bubble_label)
	add_child(bubble)
	player = AudioStreamPlayer.new()
	add_child(player)
	typer = LineEdit.new()
	typer.position = Vector2(12.0, WIN.y - 46.0)
	typer.size = Vector2(WIN.x - 24.0, 34.0)
	typer.max_length = 400
	typer.visible = false
	typer.placeholder_text = "Écrire…  (Entrée : envoyer · Échap : fermer)"
	typer.text_submitted.connect(_on_typed)
	add_child(typer)
	_apply_persona()


# ----------------------------------------------------------------------------- boucle
func _process(dt: float) -> void:
	var m := _mouse()
	# --- physique de la fenêtre : ressort pendant le glissement, inertie + rebonds ensuite
	if vacuum_busy:
		pass                                                              # le Tween de _vacuum() pilote la fenêtre et la vitesse (étirement de l'œil)
	elif dragging:
		moved = maxf(moved, m.distance_to(press_at))
		var target := m - grab
		vel += ((target - pos) * SPRING_K - vel * SPRING_C) * dt
		pos += vel * dt
	elif vel.length() > 2.0:
		pos += vel * dt
		vel *= exp(-FRICTION * dt)
		var r := _usable()
		var lo := r.position
		var hi := r.end - WIN
		if pos.x < lo.x:
			pos.x = lo.x
			vel.x = absf(vel.x) * BOUNCE
		elif pos.x > hi.x:
			pos.x = hi.x
			vel.x = -absf(vel.x) * BOUNCE
		if pos.y < lo.y:
			pos.y = lo.y
			vel.y = absf(vel.y) * BOUNCE
		elif pos.y > hi.y:
			pos.y = hi.y
			vel.y = -absf(vel.y) * BOUNCE
	else:
		vel = Vector2.ZERO
	if not vacuum_busy and (dragging or vel != Vector2.ZERO):
		DisplayServer.window_set_position(Vector2i(pos.round()))
	# --- écrasement/étirement de l'œil selon la vitesse (le « jelly » du bounce)
	var ax := clampf(absf(vel.x) / 3200.0, 0.0, 0.35)
	var ay := clampf(absf(vel.y) / 3200.0, 0.0, 0.35)
	eye.scale = eye.scale.lerp(Vector2(1.0 + ax - ay * 0.5, 1.0 + ay - ax * 0.5), clampf(dt * 18.0, 0.0, 1.0))
	wrap.scale = eye.scale
	# --- regard : curseur global
	var center := Vector2(DisplayServer.window_get_position()) + EYE_POS + Vector2(EYE_SIZE, EYE_SIZE) / 2.0
	var goal := ((m - center) / 420.0).limit_length(1.0)
	look = look.lerp(goal, clampf(dt * 9.0, 0.0, 1.0))
	# --- états de l'œil
	var goal_core := RED
	var goal_mood := 0.22
	var goal_speak := 0.0
	match state:
		"listening":
			goal_core = CYAN
			goal_mood = 0.1
			goal_speak = 0.45 + 0.35 * absf(sin(Time.get_ticks_msec() / 260.0))
		"thinking":
			goal_core = AMBER
			goal_mood = 1.0
			goal_speak = 0.2
	if text_active:
		goal_speak = 0.55 + 0.45 * absf(sin(Time.get_ticks_msec() / 70.0))
		goal_mood = 0.6
	core = core.lerp(goal_core, clampf(dt * 6.0, 0.0, 1.0))
	mood = lerpf(mood, goal_mood, clampf(dt * 5.0, 0.0, 1.0))
	speak = lerpf(speak, goal_speak, clampf(dt * 10.0, 0.0, 1.0))
	flare = maxf(0.0, flare - dt * 2.0)
	hover = lerpf(hover, 1.0 if (m - center).length() < EYE_SIZE * 0.5 else 0.0, clampf(dt * 8.0, 0.0, 1.0))
	if persona == "eto":                                                  # ETO : le visage suit le curseur, parle, réagit au survol et au glisser
		face.follow = look
		face.speaking = text_active or player.playing
		var want := "smile"
		match state:
			"listening":
				want = "listening"
			"thinking":
				want = "thinking"
		if text_active or player.playing:
			want = "speaking"
		elif dragging and moved > 8.0:
			want = "excited"
		elif hover > 0.5 and state == "idle":
			want = "warm"
		if want != face.base_name and selftest_dir == "":
			face.set_expression(want)
		face.tick(dt)
	mat.set_shader_parameter("look", look)
	mat.set_shader_parameter("speak", speak)
	mat.set_shader_parameter("flare", flare + 0.18 * hover)
	mat.set_shader_parameter("mood", mood)
	mat.set_shader_parameter("core_color", core)
	# --- bulle de texte : machine à écrire, maintien, fondu
	if text_active:
		text_t += dt
		bubble_label.visible_characters = int(text_len * clampf(text_t / text_dur, 0.0, 1.0))
		if text_t >= text_dur + 0.2:
			text_active = false
			bubble_hold = maxf(4.5, 2.0 + text_len * 0.06)               # un conseil long reste lisible plus longtemps (mode texte silencieux)
	elif bubble_hold > 0.0:
		bubble_hold -= dt
		if bubble_hold <= 0.0:
			create_tween().tween_property(bubble, "modulate:a", 0.0, 0.5)
	if selftest_dir == "":
		_keep_on_top(dt)
		_net()


var keep_t := 0.0
func _keep_on_top(dt: float) -> void:
	# le widget reste affiché quand E.N.O.S. est réduit ou qu'un autre programme passe devant (restauration + premier plan, sans voler le focus)
	keep_t += dt
	if keep_t < 0.5:
		return
	keep_t = 0.0
	var w := get_window()
	if w.mode == Window.MODE_MINIMIZED:
		w.mode = Window.MODE_WINDOWED
	if not w.always_on_top:
		w.always_on_top = true


func _input(ev: InputEvent) -> void:
	if ev is InputEventKey and ev.pressed and ev.keycode == KEY_ESCAPE and typer.visible:
		_close_typer()
		return
	if ev is InputEventMouseButton:
		if typer.visible and typer.get_rect().has_point(ev.position):   # clic dans la zone de saisie : pas de glissement
			return
		if ev.button_index == MOUSE_BUTTON_LEFT:
			if ev.pressed:
				if vacuum_busy:
					return
				dragging = true
				grab = _mouse() - pos
				press_at = _mouse()
				moved = 0.0
			elif dragging:
				dragging = false
				if moved < 8.0:                                          # simple clic : pas de glissement
					vel = Vector2.ZERO
					_on_click()
		elif ev.button_index == MOUSE_BUTTON_RIGHT and ev.pressed:
			_send({"t": "close"})
			if selftest_dir == "":
				get_tree().create_timer(2.0).timeout.connect(func() -> void: get_tree().quit())


func _close_typer() -> void:
	typer.visible = false
	typer.release_focus()
	typer.clear()


func _on_typed(t: String) -> void:
	var clean := t.strip_edges()
	_close_typer()
	if clean != "":
		_send({"t": "text", "text": clean})
		set_state("thinking")


func _on_click() -> void:
	if opt_typing:                                                       # mode saisie : la tête ouvre / ferme la zone de texte, pas de micro
		if typer.visible:
			_close_typer()
		else:
			typer.visible = true
			typer.grab_focus()
		flare = 1.0
		return
	if player.playing:                                                   # clic pendant que l'œil parle : on l'interrompt et on l'écoute
		player.stop()
	if text_active:
		text_active = false
		bubble_label.visible_characters = -1
	flare = 1.0
	if persona == "eto":
		face.react("surprised", 0.7)
	_send({"t": "click"})
	set_state("listening")                                              # retour visuel immédiat, Python confirme ensuite


func set_state(s: String) -> void:
	state = s


# ----------------------------------------------------------------------------- personnalité
func _apply_persona() -> void:
	if eye == null or wrap == null or bubble_box == null:
		return
	var eto := persona == "eto"
	eye.visible = not eto
	wrap.visible = eto
	if eto:                                                              # bulle blanche, bord bleu glacé, police douce
		bubble_box.bg_color = Color(1.0, 1.0, 1.0, 0.97)
		bubble_box.border_color = Color(0.45, 0.63, 1.0, 0.95)
		bubble_box.shadow_color = Color(0.18, 0.42, 1.0, 0.28)
		bubble_box.set_corner_radius_all(18)
		bubble_label.add_theme_color_override("default_color", Color(0.1, 0.16, 0.29))
		var f := SystemFont.new()
		f.font_names = PackedStringArray(["Segoe UI Variable Text", "Segoe UI", "Arial"])
		bubble_label.add_theme_font_override("normal_font", f)
		bubble_label.add_theme_font_size_override("normal_font_size", 16)
	else:
		bubble_box.bg_color = Color(0.04, 0.008, 0.014, 0.94)
		bubble_box.border_color = Color(0.95, 0.12, 0.2, 0.95)
		bubble_box.shadow_color = Color(1.0, 0.1, 0.15, 0.35)
		bubble_box.set_corner_radius_all(10)
		bubble_label.add_theme_color_override("default_color", Color(1.0, 0.88, 0.9))
		bubble_label.add_theme_font_override("normal_font", _mono())
		bubble_label.add_theme_font_size_override("normal_font_size", 17)


# ----------------------------------------------------------------------------- bulle / voix
func say(text: String, audio_path := "") -> void:
	bubble_label.text = text.replace("[", "(")
	if not opt_voice:
		audio_path = ""
	text_len = text.length()
	bubble_label.visible_characters = 0
	text_t = 0.0
	text_dur = clampf(0.4 + text_len * 0.05, 0.8, 18.0)
	if audio_path != "" and FileAccess.file_exists(audio_path):
		var st := AudioStreamMP3.load_from_file(audio_path)
		if st != null:
			player.stream = st
			player.play()
			text_dur = clampf(st.get_length() * 0.92, 0.8, 30.0)       # le texte s'écrit à la vitesse de la voix
	text_active = true
	bubble_hold = 0.0
	# apparition « pop » : la bulle surgit au-dessus de l'œil (échelle élastique + léger glissement), puis le fondu de sortie existant la fait disparaître
	bubble.pivot_offset = Vector2(bubble.size.x * 0.5, bubble.size.y)
	bubble.scale = Vector2(0.82, 0.82)
	bubble.position.y = 22.0
	var tw := create_tween().set_parallel(true)
	tw.tween_property(bubble, "modulate:a", 1.0 if opt_bubble else 0.0, 0.18)
	tw.tween_property(bubble, "scale", Vector2.ONE, 0.38).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_property(bubble, "position:y", 10.0, 0.3).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	flare = 0.7


# ----------------------------------------------------------------------------- réseau
func _net() -> void:
	var now := Time.get_ticks_msec() / 1000.0
	ws.poll()
	match ws.get_ready_state():
		WebSocketPeer.STATE_OPEN:
			if not was_open:
				was_open = true
				lost_since = -1.0
				_send({"t": "hello"})
			while ws.get_available_packet_count() > 0:
				var j: Variant = JSON.parse_string(ws.get_packet().get_string_from_utf8())
				if j is Dictionary:
					_handle(j)
			if now > ping_at:
				ping_at = now + 15.0
				_send({"t": "ping"})
		WebSocketPeer.STATE_CLOSED:
			if was_open:
				was_open = false
				lost_since = now
			if (lost_since > 0.0 and now - lost_since > 20.0) or (lost_since < 0.0 and now - started > 120.0):
				get_tree().quit()                                       # E.N.O.S. n'est plus là : ne jamais rester orphelin
			if now > retry_at:
				retry_at = now + 1.0
				ws = WebSocketPeer.new()
				ws.connect_to_url(url)


func _send(d: Dictionary) -> void:
	if ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
		ws.send_text(JSON.stringify(d))


func _handle(m: Dictionary) -> void:
	match m.get("t", ""):
		"idle", "listening", "thinking":
			set_state(String(m["t"]))
		"say":
			say(String(m.get("text", "")), String(m.get("audio_path", "")))
			print("ENOS_PET_SAY ", m.get("text", ""))
		"opts":                                                          # options de l'interface : voix, bulle, saisie
			opt_bubble = bool(m.get("bubble", opt_bubble))
			opt_voice = bool(m.get("voice", opt_voice))
			opt_typing = bool(m.get("typing", opt_typing))
			if not opt_voice:
				player.stop()
			if not opt_bubble:
				bubble.modulate.a = 0.0
			if not opt_typing and typer.visible:
				_close_typer()
		"stop_voice":                                                    # bouton INTERROMPRE de l'interface : l'œil se tait
			player.stop()
			text_active = false
			bubble_label.visible_characters = -1
		"persona":
			persona = "eto" if String(m.get("p", "enos")) == "eto" else "enos"
			_apply_persona()
		"emote":
			if persona == "eto":
				face.react(String(m.get("name", "smile")), float(m.get("secs", 1.8)))
		"vacuum":
			_vacuum(String(m.get("dir", "auto")))
		"quit":
			get_tree().quit()


# ----------------------------------------------------------------------------- ASPIRATEUR : le widget est aspiré vers l'autre écran
func _screen_for(right: bool) -> int:
	## écran voisin le plus proche, à droite (right) ou à gauche, d'après les centres ; -1 s'il n'y en a pas
	var cur := DisplayServer.window_get_current_screen()
	var cx := DisplayServer.screen_get_position(cur).x + DisplayServer.screen_get_size(cur).x / 2.0
	var best := -1
	var best_d := INF
	for s in DisplayServer.get_screen_count():
		if s == cur:
			continue
		var sx := DisplayServer.screen_get_position(s).x + DisplayServer.screen_get_size(s).x / 2.0
		var d := (sx - cx) if right else (cx - sx)
		if d > 0.0 and d < best_d:
			best = s
			best_d = d
	return best


func _vacuum(dir: String) -> void:
	## « auto » : vers l'écran voisin (à droite d'abord, sinon à gauche, donc ça marche aussi dans l'autre sens) · « right » / « left » : sens forcé.
	if vacuum_busy:
		return
	var right := dir != "left"
	var target := _screen_for(right)
	if dir == "auto" and target < 0:
		right = false
		target = _screen_for(false)
	if target < 0:                                                       # pas d'écran de ce côté : petite secousse de refus
		vel = Vector2(1500.0 if right else -1500.0, 0.0)
		return
	vacuum_busy = true
	dragging = false
	vel = Vector2.ZERO
	pos = Vector2(DisplayServer.window_get_position())
	var cur_rect := _usable()
	var t_pos := Vector2(DisplayServer.screen_get_position(target))
	var t_size := Vector2(DisplayServer.screen_get_size(target))
	var t_rect := Rect2(DisplayServer.screen_get_usable_rect(target))
	var sign_x := 1.0 if right else -1.0
	# 1. recul (l'aspirateur « inspire »)  2. aspiration en Ease In vers le bord de l'écran voisin  3. atterrissage avec léger rebond
	var start := pos
	var wind := start - Vector2(sign_x * 70.0, 0.0)
	var edge_x := t_pos.x if right else (t_pos.x + t_size.x - WIN.x)
	var ratio := clampf((start.y - cur_rect.position.y) / maxf(cur_rect.size.y, 1.0), 0.0, 1.0)
	var land_y := clampf(t_rect.position.y + ratio * t_rect.size.y, t_rect.position.y, t_rect.end.y - WIN.y)
	var edge := Vector2(edge_x, lerpf(start.y, land_y, 0.8))
	var land_x := (t_rect.position.x + 90.0) if right else (t_rect.end.x - WIN.x - 90.0)
	var land := Vector2(clampf(land_x, t_rect.position.x, t_rect.end.x - WIN.x), land_y)
	var dur := clampf(0.3 + absf(edge.x - wind.x) / 3500.0, 0.4, 0.75)
	_vac_sound(true)
	var tw := create_tween()
	tw.tween_method(_vac_step, start, wind, 0.18).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.tween_method(_vac_step, wind, edge, dur).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_IN)
	tw.tween_callback(func() -> void: _vac_sound(false))
	tw.tween_method(_vac_step, edge, land, 0.42).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_callback(_vacuum_done)


func _vac_step(p: Vector2) -> void:
	var dt := maxf(get_process_delta_time(), 0.001)
	vel = (p - pos) / dt                                                 # alimente l'étirement de l'œil (« jelly ») dans _process
	pos = p
	DisplayServer.window_set_position(Vector2i(p.round()))


func _vacuum_done() -> void:
	vel = Vector2.ZERO
	vacuum_busy = false
	flare = 1.0
	if persona == "eto":
		face.react("surprised", 0.6)


func _vac_sound(woosh: bool) -> void:
	if vac_player == null:
		vac_player = AudioStreamPlayer.new()
		vac_player.volume_db = -6.0
		add_child(vac_player)
		vac_woosh = _make_woosh()
		vac_pop = _make_pop()
	vac_player.stream = vac_woosh if woosh else vac_pop
	vac_player.play()


func _wav(data: PackedByteArray, rate: int) -> AudioStreamWAV:
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = rate
	w.stereo = false
	w.data = data
	return w


func _make_woosh() -> AudioStreamWAV:
	## « woosh » d'aspiration généré par code (aucun fichier) : bruit qui s'éclaircit + sifflement qui monte, de plus en plus fort, puis coupé net
	var rate := 22050
	var n := rate
	var data := PackedByteArray()
	data.resize(n * 2)
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	var lp := 0.0
	var ph := 0.0
	for i in n:
		var t := float(i) / float(n)
		var up := minf(t / 0.7, 1.0)
		var env: float = up * up if t < 0.7 else pow(1.0 - (t - 0.7) / 0.3, 1.5)
		lp += (rng.randf_range(-1.0, 1.0) - lp) * lerpf(0.04, 0.7, up)
		ph += TAU * lerpf(180.0, 1100.0, up) / float(rate)
		var s := (lp * 1.6 + sin(ph) * 0.25) * env * 0.8
		data.encode_s16(i * 2, int(clampf(s, -1.0, 1.0) * 32000.0))
	return _wav(data, rate)


func _make_pop() -> AudioStreamWAV:
	## petit « pop » grave à l'arrivée
	var rate := 22050
	var n := int(rate * 0.2)
	var data := PackedByteArray()
	data.resize(n * 2)
	var ph := 0.0
	for i in n:
		var t := float(i) / float(n)
		ph += TAU * lerpf(220.0, 70.0, t) / float(rate)
		data.encode_s16(i * 2, int(sin(ph) * pow(1.0 - t, 3.0) * 0.8 * 32000.0))
	return _wav(data, rate)


# ----------------------------------------------------------------------------- auto-test
func _shot(name: String) -> void:
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(selftest_dir.path_join(name + ".png"))


func _selftest() -> void:
	await get_tree().create_timer(1.0).timeout
	var r := _usable()
	# 1. regard : curseur simulé en haut à gauche de l'écran
	mouse_override = r.position + Vector2(20.0, 20.0)
	await get_tree().create_timer(0.6).timeout
	print("ENOS_PET look=", look)
	await _shot("pet_regard")
	# 2. états
	set_state("listening")
	await get_tree().create_timer(0.5).timeout
	await _shot("pet_ecoute")
	set_state("thinking")
	await get_tree().create_timer(0.5).timeout
	await _shot("pet_reflexion")
	set_state("idle")
	say("Vous êtes en train de coder un jeu d'échecs dans Godot. Le plateau a l'air superbe.", "")
	await get_tree().create_timer(1.6).timeout
	await _shot("pet_bulle")
	# 3. glisser-lâcher avec ressort : suit un curseur simulé, puis lancer
	var start := pos
	var c0 := start + Vector2(100.0, 300.0)
	mouse_override = c0
	_input(_fake_button(true))
	var trace := []
	for i in 40:
		mouse_override = c0 + Vector2(560.0, -120.0) * clampf(i / 25.0, 0.0, 1.0)
		await get_tree().create_timer(0.016).timeout
		trace.append(snappedf(pos.x, 1.0))
	_input(_fake_button(false))
	print("ENOS_PET drag moved=", moved, " start_x=", start.x, " trace=", trace.slice(0, 40, 6), " vel=", vel)
	await get_tree().create_timer(1.2).timeout
	print("ENOS_PET after_throw pos=", pos, " win=", DisplayServer.window_get_position())
	print("ENOS_PET selftest ok")
	get_tree().quit()


func _selftest_eto() -> void:
	## Planche-contact des expressions d'ETO (PNG sur fond blanc) : python godot_eye -- --persona eto --selftest <dossier>
	get_viewport().transparent_bg = false
	RenderingServer.set_default_clear_color(Color.WHITE)
	await get_tree().create_timer(1.0).timeout
	mouse_override = Vector2(-4000.0, -4000.0)
	var names: Array = (face.idx["expr"] as Dictionary).keys()                 # toutes les émotions (57)
	var sheet := Image.create(8 * 300, ((names.size() + 7) / 8) * 300, false, Image.FORMAT_RGBA8)
	sheet.fill(Color.WHITE)
	for i in names.size():
		face.set_expression(names[i])
		face.tick(0.0)
		await get_tree().create_timer(0.8).timeout
		await RenderingServer.frame_post_draw
		var img := get_viewport().get_texture().get_image()
		var crop := img.get_region(Rect2i(30, 195, 300, 300))
		crop.convert(Image.FORMAT_RGBA8)
		sheet.blend_rect(crop, Rect2i(0, 0, 300, 300), Vector2i((i % 8) * 300, (i / 8) * 300))
	sheet.save_png(selftest_dir.path_join("eto_sheet.png"))
	print("ENOS_PET eto sheet ok")
	get_tree().quit()


func _fake_button(pressed: bool) -> InputEventMouseButton:
	var e := InputEventMouseButton.new()
	e.button_index = MOUSE_BUTTON_LEFT
	e.pressed = pressed
	return e
