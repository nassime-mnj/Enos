extends Node
## Thèmes visuels dynamiques : reçoit la configuration JSON générée par E.N.O.S. (Python) et recolore le plateau, les pièces et les yeux des
## cavaliers en direct (transition animée). Branché par main.gd : vt = VisualTheme.new(); vt.setup(self); vt.apply(cfg).
##
## cfg (déjà assaini côté Python, revalidé ici) :
##   theme_id, light_square_color, dark_square_color  "#RRGGBB"
##   white_pieces_color / black_pieces_color : {"color": "#RRGGBB", "material": "gold|silver|chrome|bronze|obsidian|ebony|ivory|marble|ice|neon|matte"}
##   knight_eyes_emission : {"color": "#RRGGBB", "intensity": 0..16}      board_neon_glow : {"enabled": bool, "color": "#RRGGBB"}

const BOARD_SHADER := "res://shaders/board.gdshader"
const KNIGHT_RAGE := Color(1.0, 0.02, 0.02)
# matériau -> paramètres du shader (metal : mat..poli ; gloss : netteté du reflet ; sheen : reflet du plateau n'en dépend pas)
const MATERIALS := {
	"gold": {"metal": 1.0, "gloss": 0.85}, "silver": {"metal": 0.95, "gloss": 0.8}, "chrome": {"metal": 1.0, "gloss": 1.0},
	"bronze": {"metal": 0.8, "gloss": 0.55}, "obsidian": {"metal": 0.7, "gloss": 0.95}, "ebony": {"metal": 0.25, "gloss": 0.7},
	"ivory": {"metal": 0.1, "gloss": 0.45}, "marble": {"metal": 0.2, "gloss": 0.75}, "ice": {"metal": 0.4, "gloss": 0.9},
	"neon": {"metal": 0.3, "gloss": 0.4}, "matte": {"metal": 0.0, "gloss": 0.2},
}

var main: Node2D
var board: ColorRect
var board_mat: ShaderMaterial
var world_env: WorldEnvironment
var active := false                                  # true : le plateau thématique remplace board.png
var theme_id := ""
var cur := {}                                        # état interpolé affiché (couleurs + flottants)
var goal := {}
var anger := 0.0                                     # colère d'E.N.O.S. : yeux des cavaliers rouge intense
var _tw: Tween
var _anger_tw: Tween


func setup(m: Node2D) -> void:
	main = m
	board = ColorRect.new()
	board.position = Vector2(main.BX, main.BAR)
	board.size = Vector2(main.BOARD, main.BOARD)
	board.mouse_filter = Control.MOUSE_FILTER_IGNORE
	board.z_index = -1                               # sous le _draw() de main (surbrillances, coups légaux) et sous les pièces
	board.visible = false
	board_mat = ShaderMaterial.new()
	board_mat.shader = load(BOARD_SHADER)
	board.material = board_mat
	main.add_child(board)
	# Glow HDR : WorldEnvironment (fond = canvas 2D). Activé seulement quand un thème est appliqué : l'aspect d'origine reste intact sinon.
	var env := Environment.new()
	env.background_mode = Environment.BG_CANVAS
	env.glow_enabled = false
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE      # ou GLOW_BLEND_MODE_SCREEN : plus doux, moins de saturation
	env.glow_hdr_threshold = 1.0                                     # seul ce qui dépasse 1.0 (yeux, néon) brille
	env.glow_intensity = 0.9
	env.glow_strength = 1.1
	env.glow_bloom = 0.0
	world_env = WorldEnvironment.new()
	world_env.environment = env
	main.add_child(world_env)
	cur = _neutral_from(_to_state({}))


# ----------------------------------------------------------------------------- API
func apply(cfg: Dictionary, secs := 1.4) -> void:
	## Transition animée vers la configuration `cfg`.
	goal = _to_state(cfg)
	theme_id = String(cfg.get("theme_id", "custom"))
	if not active:
		cur = _neutral_from(goal)                    # part de « aucun effet » : pas de saut de couleur au premier thème
		active = true
		board.visible = true
		_set_hdr(true)
		main.queue_redraw()
	var from := cur.duplicate()
	if _tw != null and _tw.is_valid():
		_tw.kill()
	if secs <= 0.01:
		_step(from, goal, 1.0)
		return
	_tw = create_tween().set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	_tw.tween_method(func(k: float) -> void: _step(from, goal, k), 0.0, 1.0, secs)


func clear(secs := 0.8) -> void:
	## Retour au rendu d'origine (board.png + pièces non recolorées).
	if not active:
		return
	var g := _neutral_from(cur)
	g["neon"] = 0.0
	var from := cur.duplicate()
	if _tw != null and _tw.is_valid():
		_tw.kill()
	_tw = create_tween()
	_tw.tween_method(func(k: float) -> void: _step(from, g, k), 0.0, 1.0, secs)
	_tw.tween_callback(_deactivate)


func _deactivate() -> void:
	active = false
	board.visible = false
	_set_hdr(anger > 0.01)
	main.queue_redraw()


func set_anger(level: float, secs := 0.35) -> void:
	## Colère d'E.N.O.S. (0..1) : les yeux des cavaliers passent au rouge intense et palpitent. Fonctionne même sans thème actif.
	if _anger_tw != null and _anger_tw.is_valid():
		_anger_tw.kill()
	level = clampf(level, 0.0, 1.0)
	if level > 0.01:
		_set_hdr(true)
	_anger_tw = create_tween()
	_anger_tw.tween_method(_set_anger_value, anger, level, secs)
	if level <= 0.01:
		_anger_tw.tween_callback(_anger_done)


func _set_anger_value(v: float) -> void:
	anger = v
	_push_pieces()


func _anger_done() -> void:
	if not active:
		_set_hdr(false)


func style_piece(s: Sprite2D) -> void:
	## Appelé pour chaque pièce créée (et à chaque rafraîchissement) : pousse teinte, matériau et yeux dans son ShaderMaterial.
	var m := s.material as ShaderMaterial
	if m == null:
		return
	var code: String = s.get_meta("code")
	var white := code == code.to_upper()
	var pre := "w" if white else "b"
	m.set_shader_parameter("tint_color", cur.get(pre + "col", Color.WHITE))
	m.set_shader_parameter("tint_amount", cur.get("tint", 0.0))
	m.set_shader_parameter("metal", cur.get(pre + "metal", 0.0))
	m.set_shader_parameter("gloss", cur.get(pre + "gloss", 0.5))
	if code.to_lower() == "n":
		m.set_shader_parameter("eye_color", cur.get("eye_col", Color(1.0, 0.05, 0.04)))
		m.set_shader_parameter("eye_intensity", cur.get("eye_int", 2.0))
		m.set_shader_parameter("eye_rage", anger)


# ----------------------------------------------------------------------------- interne
func _set_hdr(on: bool) -> void:
	get_viewport().use_hdr_2d = on                   # nécessaire pour que les valeurs > 1.0 atteignent le Glow
	world_env.environment.glow_enabled = on


func _hex(v: Variant, fallback: Color) -> Color:
	var s := String(v)
	return Color.html(s) if Color.html_is_valid(s) else fallback


func _mat(v: Variant) -> Dictionary:
	return MATERIALS.get(String(v).to_lower(), MATERIALS["matte"])


func _to_state(cfg: Dictionary) -> Dictionary:
	var w: Variant = cfg.get("white_pieces_color", {})
	var b: Variant = cfg.get("black_pieces_color", {})
	var eyes: Variant = cfg.get("knight_eyes_emission", {})
	var neon: Variant = cfg.get("board_neon_glow", {})
	if not (w is Dictionary): w = {"color": String(w)}
	if not (b is Dictionary): b = {"color": String(b)}
	if not (eyes is Dictionary): eyes = {}
	if not (neon is Dictionary): neon = {}
	var wm := _mat((w as Dictionary).get("material", "matte"))
	var bm := _mat((b as Dictionary).get("material", "matte"))
	return {
		"light": _hex(cfg.get("light_square_color", ""), Color("d9c9a3")),
		"dark": _hex(cfg.get("dark_square_color", ""), Color("1a1410")),
		"wcol": _hex((w as Dictionary).get("color", ""), Color("f2efe6")), "wmetal": wm["metal"], "wgloss": wm["gloss"],
		"bcol": _hex((b as Dictionary).get("color", ""), Color("1b1b1f")), "bmetal": bm["metal"], "bgloss": bm["gloss"],
		"eye_col": _hex((eyes as Dictionary).get("color", ""), Color(1.0, 0.05, 0.04)),
		"eye_int": clampf(float((eyes as Dictionary).get("intensity", 2.0)), 0.0, 16.0),
		"neon": 1.0 if bool((neon as Dictionary).get("enabled", false)) else 0.0,
		"neon_col": _hex((neon as Dictionary).get("color", ""), Color(0.1, 0.9, 1.0)),
		"tint": 1.0,
		"sheen": maxf(float(wm["metal"]), float(bm["metal"])) * 0.6 + 0.1,
	}


func _neutral_from(s: Dictionary) -> Dictionary:
	## Même couleurs que `s` mais sans aucun effet visible (tint 0, néon éteint) : point de départ / d'arrivée des fondus.
	var n := s.duplicate()
	n["tint"] = 0.0
	n["neon"] = 0.0
	n["sheen"] = 0.0
	n["eye_int"] = 0.0                               # 0 : le shader des cavaliers laisse l'œil d'origine du sprite
	return n


func _step(a: Dictionary, b: Dictionary, k: float) -> void:
	for key in b:
		var x: Variant = a.get(key, b[key])
		cur[key] = x.lerp(b[key], k) if (x is Color) else lerpf(float(x), float(b[key]), k)
	_push_board()
	_push_pieces()


func _push_board() -> void:
	board_mat.set_shader_parameter("light_color", cur["light"])
	board_mat.set_shader_parameter("dark_color", cur["dark"])
	board_mat.set_shader_parameter("sheen", cur["sheen"])
	board_mat.set_shader_parameter("neon", cur["neon"])
	board_mat.set_shader_parameter("neon_color", cur["neon_col"])
	# bloom un peu plus fort quand le néon est allumé
	world_env.environment.glow_intensity = lerpf(0.8, 1.15, cur["neon"])


func _push_pieces() -> void:
	for sq in main.pieces:
		style_piece(main.pieces[sq])
