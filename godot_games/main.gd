extends Control
# Menu des jeux E.N.O.S. : trois cartes (1/2/3 ou clic). Argument de lancement : -- --game=2048|snake|mines  (et --demo pour une partie automatique).

const Neon = preload("res://neon.gd")
const GAMES := [
	{"id": "2048", "name": "2048 NÉON", "tag": "Fusionne les tuiles", "key": "1", "col": Color("22e6ff"), "script": "res://g2048.gd"},
	{"id": "snake", "name": "SERPENT", "tag": "Mange, grandis, survis", "key": "2", "col": Color("3dff9a"), "script": "res://snake.gd"},
	{"id": "mines", "name": "DÉMINEUR", "tag": "Trois niveaux, chrono", "key": "3", "col": Color("ff3df0"), "script": "res://mines.gd"},
]

var bg: Control
var current: Control = null
var hover := -1
var pulse: Array[float] = [0.0, 0.0, 0.0]
var t := 0.0
var font: Font = ThemeDB.fallback_font
var bests := {}


func _ready() -> void:
	get_window().title = "E.N.O.S. · Jeux"
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	focus_mode = Control.FOCUS_ALL
	var env := Environment.new()
	env.background_mode = Environment.BG_CANVAS
	env.glow_enabled = true
	env.glow_intensity = 0.8
	env.glow_strength = 1.0
	env.glow_bloom = 0.0
	env.glow_hdr_threshold = 1.05
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	for lv in 7:                                    # flou serré (niveaux 1 à 3) : évite les gros halos baveux des niveaux larges
		env.set_glow_level(lv, 1.0 if lv >= 1 and lv <= 3 else 0.0)
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	bg = preload("res://bg.gd").new()
	add_child(bg)
	move_child(bg, 0)
	_load_bests()
	var args := OS.get_cmdline_user_args()
	for a in args:
		if a.begins_with("--game="):
			_start(a.substr(7))
	if current == null:
		grab_focus()


func _load_bests() -> void:
	var cfg := ConfigFile.new()
	bests.clear()
	if cfg.load("user://scores.cfg") == OK:
		for g in GAMES:
			bests[g.id] = int(cfg.get_value("scores", g.id, 0))


func _start(id: String) -> void:
	for g in GAMES:
		if g.id == id:
			Sfx.play("click")
			current = Control.new()
			current.set_script(load(g.script))
			add_child(current)
			current.modulate.a = 0.0
			create_tween().tween_property(current, "modulate:a", 1.0, 0.25)
			current.back.connect(_back)
			queue_redraw()
			return


func _back() -> void:
	if current:
		current.queue_free()
		current = null
	_load_bests()
	grab_focus()


func _process(d: float) -> void:
	t += d
	for i in 3:
		pulse[i] = lerpf(pulse[i], 1.0 if (hover == i and current == null) else 0.0, minf(1.0, d * 12.0))
	if current == null:
		queue_redraw()


func _card_rect(i: int) -> Rect2:
	var r := size
	var w := minf(330.0, r.x * 0.27)
	var h := w * 1.18
	var gap := w * 0.14
	var total := w * 3.0 + gap * 2.0
	var x0 := (r.x - total) * 0.5
	var y0 := r.y * 0.5 - h * 0.45
	return Rect2(Vector2(x0 + i * (w + gap), y0), Vector2(w, h))


func _draw() -> void:
	if current != null:
		return
	var r := size
	var tw := font.get_string_size("E.N.O.S  ·  JEUX", HORIZONTAL_ALIGNMENT_LEFT, -1, 46).x
	draw_string(font, Vector2((r.x - tw) * 0.5, r.y * 0.14 + 40.0), "E.N.O.S  ·  JEUX", HORIZONTAL_ALIGNMENT_LEFT, -1, 46, Neon.glow(Neon.ACCENT, 1.5))
	draw_string(font, Vector2(0, r.y * 0.14 + 78.0), "Choisis un jeu — 1 · 2 · 3", HORIZONTAL_ALIGNMENT_CENTER, r.x, 20, Neon.DIM)
	for i in GAMES.size():
		var g: Dictionary = GAMES[i]
		var rc := _card_rect(i)
		var k: float = pulse[i]
		rc = rc.grow(8.0 * k)
		rc.position.y -= 6.0 * k + 3.0 * sin(t * 1.5 + i)
		var col: Color = g.col
		draw_style_box(Neon.box(Color(0.06, 0.05, 0.12, 0.94), Neon.glow(col, 1.0 + 0.8 * k), 22, 2 + int(2 * k)), rc)
		_draw_icon(g.id, rc, col, k)
		draw_string(font, Vector2(rc.position.x, rc.position.y + rc.size.y * 0.70), g.name, HORIZONTAL_ALIGNMENT_CENTER, rc.size.x, 30, Neon.glow(col, 1.4))
		draw_string(font, Vector2(rc.position.x, rc.position.y + rc.size.y * 0.79), g.tag, HORIZONTAL_ALIGNMENT_CENTER, rc.size.x, 17, Neon.DIM)
		var b: int = bests.get(g.id, 0)
		var bs := "Record : " + str(b) if g.id != "mines" else ("Meilleur temps : " + str(b) + " s" if b > 0 else "Pas encore gagné")
		draw_string(font, Vector2(rc.position.x, rc.position.y + rc.size.y * 0.89), bs, HORIZONTAL_ALIGNMENT_CENTER, rc.size.x, 16, Neon.TEXT)
		draw_string(font, Vector2(rc.position.x + 14.0, rc.position.y + 28.0), g.key, HORIZONTAL_ALIGNMENT_LEFT, -1, 20, Neon.DIM)
	draw_string(font, Vector2(0, r.y - 28.0), "Échap : quitter", HORIZONTAL_ALIGNMENT_CENTER, r.x, 16, Neon.DIM)


func _draw_icon(id: String, rc: Rect2, col: Color, k: float) -> void:
	var c := rc.position + Vector2(rc.size.x * 0.5, rc.size.y * 0.32)
	var s := rc.size.x * 0.16
	var gc := Neon.glow(col, 1.8)
	match id:
		"2048":
			for iy in 2:
				for ix in 2:
					var p := c + Vector2((ix - 0.5) * s * 1.15, (iy - 0.5) * s * 1.15)
					var a := 0.45 + 0.55 * (0.5 + 0.5 * sin(t * 2.0 + ix * 1.7 + iy * 0.9))
					draw_style_box(Neon.box(Color(col.r * 0.25, col.g * 0.25, col.b * 0.25, 0.9), Color(gc.r, gc.g, gc.b, a), 8, 2), Rect2(p - Vector2(s, s) * 0.5, Vector2(s, s)))
		"snake":
			var pts := PackedVector2Array()
			for i in 22:
				var f := float(i) / 21.0
				pts.append(c + Vector2((f - 0.5) * s * 4.2, sin(f * 7.0 - t * 3.0) * s * 0.7))
			draw_polyline(pts, gc, s * 0.42, true)
			draw_circle(pts[pts.size() - 1], s * 0.34, Neon.glow(Color.WHITE, 1.4))
		"mines":
			draw_circle(c, s * 0.62, Color(0.1, 0.05, 0.14))
			draw_arc(c, s * 0.62, 0.0, TAU, 40, gc, 3.0, true)
			for i in 8:
				var a := TAU * i / 8.0 + t * 0.6
				draw_line(c + Vector2.from_angle(a) * s * 0.62, c + Vector2.from_angle(a) * s * (0.95 + 0.12 * k), gc, 3.0, true)
			draw_circle(c + Vector2(-s * 0.2, -s * 0.2), s * 0.12, Neon.glow(Color.WHITE, 1.6))


func _gui_input(e: InputEvent) -> void:
	if current != null:
		return
	if e is InputEventMouseMotion:
		hover = -1
		for i in 3:
			if _card_rect(i).grow(8.0).has_point(e.position):
				hover = i
	elif e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
		for i in 3:
			if _card_rect(i).has_point(e.position):
				_start(GAMES[i].id)
	elif e is InputEventKey and e.pressed and not e.echo:
		match e.keycode:
			KEY_1, KEY_KP_1, KEY_AMPERSAND:
				_start("2048")
			KEY_2, KEY_KP_2:
				_start("snake")
			KEY_3, KEY_KP_3, KEY_QUOTEDBL:
				_start("mines")
			KEY_ESCAPE:
				get_tree().quit()
