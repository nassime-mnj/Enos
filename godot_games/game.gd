extends Control
# Base commune des jeux : meilleur score enregistré (user://scores.cfg), texte, particules, vibration d'écran, textes flottants.

const Neon = preload("res://neon.gd")
signal back

var game_id := "jeu"
var best := 0
var t := 0.0
var shake := 0.0
var demo := false
var font: Font = ThemeDB.fallback_font
var rng := RandomNumberGenerator.new()
var floaters: Array = []   # textes flottants {txt, pos, col, age}


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	focus_mode = Control.FOCUS_ALL
	mouse_filter = Control.MOUSE_FILTER_STOP
	grab_focus()
	rng.randomize()
	demo = "--demo" in OS.get_cmdline_user_args()
	var cfg := ConfigFile.new()
	if cfg.load("user://scores.cfg") == OK:
		best = int(cfg.get_value("scores", game_id, 0))


func save_best(v: int) -> void:
	if v <= best:
		return
	best = v
	var cfg := ConfigFile.new()
	cfg.load("user://scores.cfg")
	cfg.set_value("scores", game_id, best)
	cfg.save("user://scores.cfg")


func _process(d: float) -> void:
	t += d
	shake = maxf(0.0, shake - d * 28.0)
	for f in floaters:
		f.age += d
	floaters = floaters.filter(func(f): return f.age < 1.1)
	queue_redraw()


func shake_offset() -> Vector2:
	if shake <= 0.01:
		return Vector2.ZERO
	return Vector2(rng.randf_range(-1.0, 1.0), rng.randf_range(-1.0, 1.0)) * shake


# pos = coin haut-gauche d'une ligne de largeur w (texte centré dans w)
func text_c(pos: Vector2, s: String, size: int, col: Color, w: float = -1.0, align: int = HORIZONTAL_ALIGNMENT_CENTER) -> void:
	var asc := font.get_ascent(size)
	draw_string(font, Vector2(pos.x, pos.y + asc), s, align, w, size, col)


func text_w(s: String, size: int) -> float:
	return font.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x


func floater(s: String, pos: Vector2, col: Color) -> void:
	floaters.append({"txt": s, "pos": pos, "col": col, "age": 0.0})


func draw_floaters() -> void:
	for f in floaters:
		var k: float = f.age / 1.1
		var c: Color = f.col
		c.a = 1.0 - k * k
		text_c(Vector2(f.pos.x - 80.0, f.pos.y - 50.0 * k), f.txt, 26, c, 160.0)


func burst(pos: Vector2, col: Color, n: int = 24, speed: float = 220.0) -> void:
	var p := CPUParticles2D.new()
	p.position = pos
	p.emitting = true
	p.one_shot = true
	p.amount = n
	p.lifetime = 0.8
	p.explosiveness = 1.0
	p.spread = 180.0
	p.direction = Vector2.UP
	p.initial_velocity_min = speed * 0.4
	p.initial_velocity_max = speed
	p.gravity = Vector2(0, 260)
	p.scale_amount_min = 2.0
	p.scale_amount_max = 5.0
	p.color = Neon.glow(col, 2.0)
	var curve := Curve.new()
	curve.add_point(Vector2(0, 1))
	curve.add_point(Vector2(1, 0))
	p.scale_amount_curve = curve
	add_child(p)
	get_tree().create_timer(1.2).timeout.connect(p.queue_free)


func panel(r: Rect2, border: Color, fill: Color = Neon.PANEL, radius: int = 14) -> void:
	draw_style_box(Neon.box(fill, border, radius, 2), r)


func overlay(title: String, sub: String, col: Color) -> void:
	var r := get_rect().size
	draw_rect(Rect2(Vector2.ZERO, r), Color(0, 0, 0, 0.55))
	text_c(Vector2(0, r.y * 0.38), title, 64, Neon.glow(col, 1.6), r.x)
	text_c(Vector2(0, r.y * 0.38 + 84.0), sub, 24, Neon.TEXT, r.x)


func _gui_input(e: InputEvent) -> void:
	if e is InputEventKey and e.pressed and not e.echo and e.keycode == KEY_ESCAPE:
		back.emit()
		accept_event()
