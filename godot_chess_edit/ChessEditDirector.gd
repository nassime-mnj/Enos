extends Node3D
## CHESS EDIT STUDIO — pont PC. Lit edit_timeline_manifest.json (généré par l'application : mobile ou PC) et rejoue la partie en 3D, calée sur la musique.
##   - synchro : AudioStreamPlayer.get_playback_position() + AudioServer.get_time_since_last_mix() (- latence de sortie), donc précise à l'échantillon près
##   - WorldEnvironment : Glow / Bloom HDR (seuil > 1.0), tonemap filmique ; post-shader chroma_shake.gdshader (aberration chromatique + screen-space shake + vignette)
##   - GPUParticles3D : explosions de pièces (captures), onde de choc « !! », poussière cosmique
##   - rendu vidéo : godot --path godot_chess_edit --write-movie sortie.avi --fixed-fps 60 -- --manifest=PATH --movie   (puis ffmpeg -> .mp4, voir nasko_chessedit.py)
## Arguments (après « -- ») : --manifest=chemin.json  --movie (horloge image par image, quitte à la fin)  --seek=SECONDES (aperçu : démarre plus loin)

const CELL := 1.0
const HDR := 3.2                                    # multiplicateur d'émission > 1 : c'est ce qui fait « bloomer » les couleurs
const TONES := {"green": Color(0.17, 1.0, 0.53), "cyan": Color(0.0, 0.95, 1.0), "red": Color(1.0, 0.0, 0.27), "gold": Color(1.0, 0.82, 0.29)}
const PIECE_TEX := "res://pieces/%s%s.png"

var manifest: Dictionary = {}
var events: Array = []
var idx := 0
var flip := false
var movie := false
var clock := 0.0
var seek_to := 0.0
var duration := 0.0

var player: AudioStreamPlayer
var cam: Camera3D
var rig: Node3D
var env: Environment
var post_mat: ShaderMaterial
var board_root: Node3D
var fx_root: Node3D
var squares := {}                                    # "e4" -> MeshInstance3D
var pieces := {}                                     # "e4" -> Sprite3D
var lit: MeshInstance3D

var cam_pitch := 62.0
var cam_dist := 11.5
var cam_roll := 0.0
var shake := 0.0
var chroma := 0.0
var flash := 0.0
var rewind := 0.0
var rewind_hold := 0.0
var rng := RandomNumberGenerator.new()

var ui: CanvasLayer
var cap_label: Label
var cap_name: Label
var cap_text := ""
var cap_pos := 0.0
var cap_hold := 0.0

func _ready() -> void:
	rng.randomize()
	var path := "res://edit_timeline_manifest.json"
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--manifest="):
			path = a.substr(11)
		elif a == "--movie":
			movie = true
		elif a.begins_with("--seek="):
			seek_to = float(a.substr(7))
	if "--write-movie" in OS.get_cmdline_args() or OS.has_feature("movie"):
		movie = true
	if not _load_manifest(path):
		push_error("[ChessEdit] manifeste introuvable ou illisible : " + path)
		get_tree().quit(1)
		return
	_build_environment()
	_build_board()
	_build_post()
	_build_ui()
	_build_dust()
	_load_audio(path.get_base_dir())
	_sync_position("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
	_cam_to(Vector3.ZERO, 62.0, 11.5, 0.0, 0.0)
	if seek_to > 0.0:
		while idx < events.size() and float(events[idx]["t"]) < seek_to:
			idx += 1
		clock = seek_to
		if player and player.stream:
			player.play(seek_to)
	elif player and player.stream:
		player.play()

# ---------------------------------------------------------------- chargement
func _load_manifest(path: String) -> bool:
	if not FileAccess.file_exists(path):
		return false
	var data = JSON.parse_string(FileAccess.get_file_as_string(path))
	if typeof(data) != TYPE_DICTIONARY:
		return false
	manifest = data
	events = manifest.get("events", [])
	events.sort_custom(func(a, b): return float(a["t"]) < float(b["t"]))
	flip = bool(manifest.get("game", {}).get("flip", false))
	duration = float(manifest.get("audio", {}).get("duration", 0.0))
	return true

func _load_audio(dir: String) -> void:
	player = AudioStreamPlayer.new()
	add_child(player)
	var au: Dictionary = manifest.get("audio", {})
	var cands: Array = []
	for k in ["path", "name"]:
		var p := String(au.get(k, ""))
		if p != "":
			cands.append(p if p.is_absolute_path() else dir.path_join(p))
	for p in cands:
		if FileAccess.file_exists(p):
			var s := _stream_from_file(p)
			if s:
				player.stream = s
				if duration <= 0.0:
					duration = s.get_length()
				return
	push_warning("[ChessEdit] audio introuvable (%s) : l'edit joue sans musique." % str(cands))

func _stream_from_file(p: String) -> AudioStream:
	var bytes := FileAccess.get_file_as_bytes(p)
	var ext := p.get_extension().to_lower()
	if ext == "mp3":
		var m := AudioStreamMP3.new()
		m.data = bytes
		return m
	if ext == "ogg":
		return AudioStreamOggVorbis.load_from_buffer(bytes)
	if ext == "wav":
		return _wav_from_bytes(bytes)
	return null

func _wav_from_bytes(b: PackedByteArray) -> AudioStreamWAV:       # WAV PCM 8/16 bits, mono ou stéréo
	var pos := 12
	var channels := 1
	var rate := 44100
	var bits := 16
	var data := PackedByteArray()
	while pos + 8 <= b.size():
		var id := b.slice(pos, pos + 4).get_string_from_ascii()
		var size := b.decode_u32(pos + 4)
		if id == "fmt ":
			channels = b.decode_u16(pos + 10)
			rate = b.decode_u32(pos + 12)
			bits = b.decode_u16(pos + 22)
		elif id == "data":
			data = b.slice(pos + 8, min(b.size(), pos + 8 + size))
			break
		pos += 8 + size + (size & 1)
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS if bits == 16 else AudioStreamWAV.FORMAT_8_BITS
	w.stereo = channels == 2
	w.mix_rate = rate
	w.data = data
	return w

# ---------------------------------------------------------------- scène 3D
func _build_environment() -> void:
	env = Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color.BLACK
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.22, 0.22, 0.25)
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.glow_enabled = true                          # Bloom HDR : seules les valeurs > glow_hdr_threshold (1.0) rayonnent
	env.glow_hdr_threshold = 1.0
	env.glow_intensity = 0.95
	env.glow_strength = 1.1
	env.glow_bloom = 0.12
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	env.set_glow_level(2, 1.0)
	env.set_glow_level(4, 1.0)
	env.set_glow_level(6, 0.8)
	env.adjustment_enabled = true
	env.adjustment_contrast = 1.25
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	rig = Node3D.new()
	add_child(rig)
	cam = Camera3D.new()
	cam.keep_aspect = Camera3D.KEEP_WIDTH
	cam.fov = 58.0
	cam.current = true
	rig.add_child(cam)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-55, 25, 0)
	sun.light_energy = 0.75
	add_child(sun)
	fx_root = Node3D.new()
	add_child(fx_root)

func _sq_pos(c: int, r: int) -> Vector3:
	if flip:
		c = 7 - c
		r = 7 - r
	return Vector3((c - 3.5) * CELL, 0.0, (r - 3.5) * CELL)

func _name_pos(sq: String) -> Vector3:
	return _sq_pos(sq.unicode_at(0) - 97, 8 - int(sq.substr(1, 1)))

func _build_board() -> void:
	board_root = Node3D.new()
	add_child(board_root)
	for r in 8:
		for c in 8:
			var m := MeshInstance3D.new()
			var box := BoxMesh.new()
			box.size = Vector3(CELL, 0.12, CELL)
			m.mesh = box
			var mat := StandardMaterial3D.new()
			var g := 0.46 if (r + c) % 2 == 0 else 0.07                # noir & blanc contrasté
			mat.albedo_color = Color(g, g, g)
			mat.roughness = 0.55
			m.material_override = mat
			var sq := char(97 + c) + str(8 - r)
			m.position = Vector3((c - 3.5) * CELL, -0.06, (r - 3.5) * CELL)
			board_root.add_child(m)
			squares[sq] = m
	lit = MeshInstance3D.new()                                          # case d'arrivée allumée (émission HDR -> glow)
	var q := QuadMesh.new()
	q.size = Vector2(CELL, CELL)
	q.orientation = PlaneMesh.FACE_Y
	lit.mesh = q
	lit.visible = false
	lit.position.y = 0.01
	add_child(lit)

func _build_post() -> void:
	var cl := CanvasLayer.new()
	cl.layer = 10
	var rect := ColorRect.new()
	rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	post_mat = ShaderMaterial.new()
	post_mat.shader = load("res://shaders/chroma_shake.gdshader")
	rect.material = post_mat
	cl.add_child(rect)
	add_child(cl)

func _build_ui() -> void:
	ui = CanvasLayer.new()
	ui.layer = 20
	add_child(ui)
	var box := VBoxContainer.new()
	box.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	box.offset_left = 40
	box.offset_right = -40
	box.offset_top = -420
	box.offset_bottom = -120
	box.alignment = BoxContainer.ALIGNMENT_END
	ui.add_child(box)
	cap_name = Label.new()
	cap_name.add_theme_font_size_override("font_size", 34)
	cap_name.add_theme_color_override("font_color", TONES["cyan"] * 1.4)
	box.add_child(cap_name)
	cap_label = Label.new()
	cap_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	cap_label.add_theme_font_size_override("font_size", 56)
	cap_label.add_theme_color_override("font_outline_color", Color.BLACK)
	cap_label.add_theme_constant_override("outline_size", 12)
	box.add_child(cap_label)

func _build_dust() -> void:                                              # poussière cosmique : particules blanches flottantes autour du plateau
	var p := GPUParticles3D.new()
	p.amount = 220
	p.lifetime = 6.0
	p.preprocess = 6.0
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(9, 5, 9)
	pm.gravity = Vector3(0, 0.05, 0)
	pm.initial_velocity_min = 0.05
	pm.initial_velocity_max = 0.25
	pm.direction = Vector3(0, 1, 0)
	pm.spread = 180.0
	pm.scale_min = 0.5
	pm.scale_max = 1.4
	p.process_material = pm
	var sph := SphereMesh.new()
	sph.radius = 0.025
	sph.height = 0.05
	sph.radial_segments = 6
	sph.rings = 3
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = Color(1, 1, 1, 0.9)
	mat.emission_enabled = true
	mat.emission = Color.WHITE
	mat.emission_energy_multiplier = 1.5
	sph.material = mat
	p.draw_pass_1 = sph
	p.position.y = 3.0
	add_child(p)

# ---------------------------------------------------------------- pièces
func _fen_map(fen: String) -> Dictionary:
	var m := {}
	var rows := fen.split(" ")[0].split("/")
	for y in rows.size():
		var x := 0
		for ch in rows[y]:
			if ch >= "1" and ch <= "8":
				x += int(ch)
			else:
				m[char(97 + x) + str(8 - y)] = ch
				x += 1
	return m

var _tex_cache := {}

func _tex(color: String, kind: String) -> Texture2D:                       # chargé à l'exécution : fonctionne même si le projet n'a jamais été ouvert dans l'éditeur (pas de .import)
	var key := color + kind
	if not _tex_cache.has(key):
		var path := PIECE_TEX % [color, kind]
		var img := Image.load_from_file(ProjectSettings.globalize_path(path))
		_tex_cache[key] = ImageTexture.create_from_image(img) if img else null
	return _tex_cache[key]

func _piece_sprite(ch: String) -> Sprite3D:
	var s := Sprite3D.new()
	var color := "w" if ch == ch.to_upper() else "b"
	s.texture = _tex(color, ch.to_lower())
	s.pixel_size = 0.0078
	s.billboard = BaseMaterial3D.BILLBOARD_FIXED_Y
	s.shaded = false
	s.alpha_cut = SpriteBase3D.ALPHA_CUT_OPAQUE_PREPASS
	s.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	s.set_meta("p", ch)
	board_root.add_child(s)
	return s

func _place(s: Sprite3D, sq: String) -> void:
	s.position = _name_pos(sq) + Vector3(0, 0.55, 0)
	s.set_meta("sq", sq)

func _sync_position(fen: String) -> void:                                # pose directe (coups sautés, départ, rattrapage)
	var m := _fen_map(fen)
	for sq in pieces.keys():
		if not m.has(sq) or pieces[sq].get_meta("p") != m[sq]:
			pieces[sq].queue_free()
			pieces.erase(sq)
	for sq in m.keys():
		if not pieces.has(sq):
			var s := _piece_sprite(m[sq])
			_place(s, sq)
			pieces[sq] = s

func _move_piece(ev: Dictionary, fast: bool) -> void:
	var from := String(ev["from"])
	var to := String(ev["to"])
	if not pieces.has(from):
		_sync_position(String(ev.get("fen_after", "")))
		return
	var s: Sprite3D = pieces[from]
	if pieces.has(to):
		var cap: Sprite3D = pieces[to]
		pieces.erase(to)
		var tw := create_tween()
		tw.tween_property(cap, "scale", Vector3.ONE * 1.8, 0.2)
		tw.parallel().tween_property(cap, "modulate:a", 0.0, 0.2)
		tw.tween_callback(cap.queue_free)
	pieces.erase(from)
	pieces[to] = s
	s.set_meta("sq", to)
	var dest := _name_pos(to) + Vector3(0, 0.55, 0)
	var dur := 0.06 if fast else 0.28
	var tw2 := create_tween().set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_OUT)
	tw2.tween_property(s, "position", dest, dur)
	if not fast:
		var hop := create_tween()
		hop.tween_property(s, "position:y", 1.3, dur * 0.4).set_ease(Tween.EASE_OUT)
		hop.tween_property(s, "position:y", 0.55, dur * 0.6).set_ease(Tween.EASE_IN)
		_trail(_name_pos(from), _name_pos(to), TONES.get(String(ev.get("tone", "green")), TONES["green"]))
	if String(ev.get("piece", "")) == "k" and abs(to.unicode_at(0) - from.unicode_at(0)) == 2:   # roque : la tour suit
		var short := to.unicode_at(0) > from.unicode_at(0)
		var rf := ("h" if short else "a") + from.substr(1, 1)
		var rt := ("f" if short else "d") + from.substr(1, 1)
		if pieces.has(rf):
			var rk: Sprite3D = pieces[rf]
			pieces.erase(rf)
			pieces[rt] = rk
			create_tween().tween_property(rk, "position", _name_pos(rt) + Vector3(0, 0.55, 0), dur)
	get_tree().create_timer(dur + 0.03).timeout.connect(func(): _sync_position(String(ev.get("fen_after", ""))))

# ---------------------------------------------------------------- effets
func _emissive(c: Color, a := 1.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.albedo_color = Color(c.r, c.g, c.b, a)
	m.emission_enabled = true
	m.emission = c
	m.emission_energy_multiplier = HDR
	return m

func _trail(a: Vector3, b: Vector3, c: Color) -> void:                   # traînée lumineuse : silhouettes fantômes le long du coup
	for i in 5:
		var q := MeshInstance3D.new()
		var qm := QuadMesh.new()
		qm.size = Vector2(0.8, 0.8)
		q.mesh = qm
		q.material_override = _emissive(c, 0.55)
		var f := float(i + 1) / 6.0
		q.position = a.lerp(b, f) + Vector3(0, 0.6, 0)
		fx_root.add_child(q)
		var tw := create_tween()
		tw.tween_interval(0.035 * i)
		tw.tween_property(q, "scale", Vector3.ONE * 0.2, 0.45)
		tw.parallel().tween_property(q.material_override, "albedo_color:a", 0.0, 0.45)
		tw.tween_callback(q.queue_free)

func _light_square(sq: String, c: Color) -> void:
	lit.visible = true
	lit.position = _name_pos(sq) + Vector3(0, 0.01, 0)
	lit.material_override = _emissive(c, 0.8)

func _shockwave(pos: Vector3, c: Color) -> void:                         # onde de choc « !! » : anneaux HDR qui s'étendent
	for i in 2:
		var t := MeshInstance3D.new()
		var tm := TorusMesh.new()
		tm.inner_radius = 0.46
		tm.outer_radius = 0.5
		t.mesh = tm
		t.material_override = _emissive(c, 1.0)
		t.position = pos + Vector3(0, 0.05, 0)
		t.scale = Vector3.ONE * 0.2
		fx_root.add_child(t)
		var tw := create_tween().set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_OUT)
		tw.tween_interval(0.14 * i)
		tw.tween_property(t, "scale", Vector3(8, 1, 8), 1.0)
		tw.parallel().tween_property(t.material_override, "albedo_color:a", 0.0, 1.0)
		tw.tween_callback(t.queue_free)

func _burst(pos: Vector3, c: Color, amount: int) -> void:                # explosion de particules GPU (capture / impact)
	var p := GPUParticles3D.new()
	p.amount = amount
	p.lifetime = 1.1
	p.one_shot = true
	p.explosiveness = 1.0
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3(0, 1, 0)
	pm.spread = 180.0
	pm.initial_velocity_min = 2.5
	pm.initial_velocity_max = 8.0
	pm.gravity = Vector3(0, -7, 0)
	pm.damping_min = 1.0
	pm.damping_max = 2.5
	pm.scale_min = 0.5
	pm.scale_max = 1.6
	var grad := Gradient.new()
	grad.set_color(0, Color(1, 1, 1, 1))
	grad.set_color(1, Color(c.r, c.g, c.b, 0.0))
	var gt := GradientTexture1D.new()
	gt.gradient = grad
	pm.color_ramp = gt
	p.process_material = pm
	var sm := SphereMesh.new()
	sm.radius = 0.06
	sm.height = 0.12
	sm.radial_segments = 6
	sm.rings = 3
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.vertex_color_use_as_albedo = true
	mat.emission_enabled = true
	mat.emission = c
	mat.emission_energy_multiplier = HDR
	sm.material = mat
	p.draw_pass_1 = sm
	p.position = pos + Vector3(0, 0.6, 0)
	fx_root.add_child(p)
	p.emitting = true
	get_tree().create_timer(2.0).timeout.connect(p.queue_free)

func _cam_to(focus: Vector3, pitch: float, dist: float, roll: float, dur: float) -> void:
	if dur <= 0.0:
		rig.position = focus
		cam_pitch = pitch
		cam_dist = dist
		cam_roll = roll
		return
	var tw := create_tween().set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_OUT).set_parallel(true)   # ≈ cubic-bezier(0.16, 1, 0.3, 1)
	tw.tween_property(rig, "position", focus, dur)
	tw.tween_property(self, "cam_pitch", pitch, dur)
	tw.tween_property(self, "cam_dist", dist, dur)
	tw.tween_property(self, "cam_roll", roll, dur)

func _hit(ev: Dictionary, power: float) -> void:
	var tone := String(ev.get("tone", "green"))
	var c: Color = TONES.get(tone, TONES["green"])
	var to := String(ev["to"])
	var p := _name_pos(to)
	var kind := String(ev.get("kind", ""))
	var fx := String(ev.get("effect", "BEAT"))
	var drop := kind == "drop"
	_cam_to(p * 0.55, rng.randf_range(42.0, 56.0), (6.5 - power * 2.2) - (1.0 if drop else 0.0), rng.randf_range(-8.0, 8.0), 1.1 if drop else 0.85)
	_light_square(to, c)
	var heavy := fx == "SHAKE_HEAVY" or fx == "BOSS_AWAKENING" or fx == "PROMOTION_CUTSCENE" or drop
	if fx == "BRILLIANT_SHOCKWAVE" or String(ev.get("quality", "")) == "brilliant":
		_shockwave(p, TONES["cyan"])
		_burst(p, TONES["cyan"], 120)
	if heavy or String(ev.get("captured", "")) != "" or power > 0.7:
		shake = max(shake, 0.5 + power * 0.9)
		chroma = max(chroma, 0.012 + power * 0.02)
		flash = 0.55
		post_mat.set_shader_parameter("flash_color", Vector3(1, 0.1, 0.2) if tone == "red" else Vector3(1, 1, 1))
		_burst(p, c, 160 if String(ev.get("captured", "")) != "" else 70)

func _cutscene(cut: Dictionary, tone: String) -> void:                   # overlay 0,8 s : silhouette + aura + rayons + flèches + texte
	var col: Color = TONES["red"] if tone == "red" else TONES["gold"]
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.add_child(root)
	var center := Control.new()
	center.position = Vector2(540, 880)
	root.add_child(center)
	var rays := Node2D.new()
	center.add_child(rays)
	for i in 14:
		var poly := Polygon2D.new()
		var a0 := TAU * i / 14.0
		poly.polygon = PackedVector2Array([Vector2.ZERO, Vector2(cos(a0), sin(a0)) * 1500.0, Vector2(cos(a0 + 0.12), sin(a0 + 0.12)) * 1500.0])
		poly.color = Color(col.r * 1.6, col.g * 1.6, col.b * 1.6, 0.35)
		rays.add_child(poly)
	var arrows := Node2D.new()
	center.add_child(arrows)
	for i in 8:
		var l := Label.new()
		l.text = "➤"
		l.add_theme_font_size_override("font_size", 90)
		l.add_theme_color_override("font_color", col * 1.8)
		var a := TAU * i / 8.0
		l.position = Vector2(cos(a), sin(a)) * 360.0 - Vector2(40, 50)
		l.rotation = a + PI
		l.pivot_offset = Vector2(40, 50)
		arrows.add_child(l)
	var tr := TextureRect.new()
	tr.texture = _tex(String(cut.get("color", "w")), String(cut.get("piece", "r")))
	tr.custom_minimum_size = Vector2(520, 520)
	tr.size = Vector2(520, 520)
	tr.position = Vector2(-260, -260)
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	tr.modulate = Color(0.02, 0.02, 0.02) + col * 0.0
	center.add_child(tr)
	var glow := tr.duplicate() as TextureRect                              # aura dorée / électrique derrière la silhouette
	glow.modulate = Color(col.r * 2.2, col.g * 2.2, col.b * 2.2, 0.9)
	glow.scale = Vector2(1.12, 1.12)
	glow.pivot_offset = Vector2(260, 260)
	center.add_child(glow)
	center.move_child(glow, tr.get_index())
	var big := Label.new()
	big.text = String(cut.get("text", ""))
	big.add_theme_font_size_override("font_size", 150)
	big.add_theme_color_override("font_color", Color(1, 1, 1))
	big.add_theme_color_override("font_outline_color", col * 1.8)
	big.add_theme_constant_override("outline_size", 24)
	big.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	big.position = Vector2(-540, 330)
	big.size = Vector2(1080, 200)
	center.add_child(big)
	var tw := create_tween().set_parallel(true)
	root.modulate.a = 0.0
	center.scale = Vector2(1.5, 1.5)
	tw.tween_property(root, "modulate:a", 1.0, 0.12)
	tw.tween_property(center, "scale", Vector2.ONE, 0.18).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_property(rays, "rotation", 1.2, 0.8)
	tw.tween_property(arrows, "rotation", -1.6, 0.8)
	tw.chain().tween_property(root, "modulate:a", 0.0, 0.14).set_delay(0.5)
	tw.chain().tween_callback(root.queue_free)
	shake = max(shake, 1.2)
	chroma = max(chroma, 0.03)
	flash = 0.7

func _say(bot: String, text: String) -> void:                           # machine à écrire glitchée
	cap_name.text = bot.to_upper()
	cap_text = text
	cap_pos = 0.0
	cap_hold = 1.6 + text.length() * 0.045

# ---------------------------------------------------------------- horloge + événements
func _now() -> float:
	if movie or not player or not player.playing:
		return clock
	# position audio + temps depuis le dernier mixage, moins la latence de sortie : synchro au sample près
	return player.get_playback_position() + AudioServer.get_time_since_last_mix() - AudioServer.get_output_latency()

func _fire(ev: Dictionary) -> void:
	var kind := String(ev.get("kind", ""))
	if bool(ev.get("fast_forward", false)):
		_move_piece(ev, true)
		rewind_hold = 0.4
		_cam_to(_name_pos(String(ev["to"])) * 0.3, 50.0, 10.0, rng.randf_range(-3.0, 3.0), 0.25)
		return
	var power: float = 1.0 if kind == "drop" else clamp(float(ev.get("drama", 0.0)) / 80.0, 0.3, 1.0)
	_move_piece(ev, false)
	_hit(ev, power)
	var cut = ev.get("cutscene", null)
	if typeof(cut) == TYPE_DICTIONARY:
		var delay: float = max(0.0, float(cut.get("t", ev["t"])) - float(ev["t"]))
		get_tree().create_timer(delay + 0.2).timeout.connect(func(): _cutscene(cut, String(ev.get("tone", "green"))))
	var texts: Array = ev.get("texts", [])
	if texts.size() > 0:
		var tx: Dictionary = texts[0]
		get_tree().create_timer(0.35 + (0.9 if cut != null else 0.0)).timeout.connect(func(): _say(String(tx.get("bot", "")), String(tx.get("text", ""))))

func _process(delta: float) -> void:
	if movie:
		clock += delta
	var t := _now()
	while idx < events.size() and float(events[idx]["t"]) <= t:
		_fire(events[idx])
		idx += 1
	if (duration > 0.0 and t > duration + 1.0) or (idx >= events.size() and t > float(events[events.size() - 1]["t"]) + 6.0 and movie):
		if movie or (player and not player.playing):
			get_tree().quit()
	# caméra
	var pr := deg_to_rad(cam_pitch)
	cam.position = Vector3(0.0, sin(pr) * cam_dist, cos(pr) * cam_dist)
	cam.rotation_degrees = Vector3(-cam_pitch, 0.0, cam_roll)
	rig.rotation_degrees.y = sin(t * 0.45) * 1.6                          # respiration lente entre deux impacts
	# shake amorti + post-traitement
	shake *= pow(0.004, delta)
	chroma *= pow(0.01, delta)
	flash *= pow(0.000001, delta)
	var sh := Vector2(rng.randf_range(-1.0, 1.0), rng.randf_range(-1.0, 1.0)) * shake * 0.012
	post_mat.set_shader_parameter("shake", sh)
	post_mat.set_shader_parameter("aberration", chroma)
	post_mat.set_shader_parameter("flash", flash)
	rewind_hold = max(0.0, rewind_hold - delta)
	rewind = move_toward(rewind, 1.0 if rewind_hold > 0.0 else 0.0, delta * 5.0)
	post_mat.set_shader_parameter("rewind", rewind)
	# réplique : frappe + glitch
	if cap_text != "":
		cap_pos += delta * 42.0
		var n := int(min(cap_pos, cap_text.length()))
		var s := cap_text.substr(0, n)
		if n < cap_text.length() and rng.randf() < 0.15:
			s += "▒░#%&@?".substr(rng.randi() % 7, 1)
			cap_label.position.x = rng.randf_range(-4, 4)
		else:
			cap_label.position.x = 0
		cap_label.text = s
		if n >= cap_text.length():
			cap_hold -= delta
			if cap_hold <= 0.0:
				cap_text = ""
				cap_label.text = ""
				cap_name.text = ""
