extends "res://game.gd"
# DÉMINEUR : clic gauche = creuser, clic droit (ou F) = drapeau, clic sur un chiffre satisfait = creuser autour. 1/2/3 = niveau, R = rejouer.
# Le premier clic est toujours sûr. Révélation en cascade animée, explosions en chaîne, confettis à la victoire.

const LEVELS := [
	{"name": "FACILE", "cols": 9, "rows": 9, "mines": 10},
	{"name": "MOYEN", "cols": 16, "rows": 16, "mines": 40},
	{"name": "EXPERT", "cols": 30, "rows": 16, "mines": 99},
]
const NUM_COL := [Color.WHITE, Color("22e6ff"), Color("3dff9a"), Color("ff4d6a"), Color("a56bff"), Color("ffa43d"), Color("3dffe0"), Color("ffffff"), Color("9a9aa8")]

var level := 1
var cols := 16
var rows := 16
var nmines := 40
var mine: Array = []         # bool
var count: Array = []        # int
var shown: Array = []        # bool
var flag: Array = []         # bool
var at: Array = []           # float : instant (t) où la case apparaît révélée (animation)
var started := false
var state := "play"          # play | won | lost
var t0 := 0.0
var elapsed := 0.0
var hover := -1
var booms: Array = []        # {i, at}
var demo_t := 0.0
var best_time := 0


func _ready() -> void:
	game_id = "mines"
	super._ready()
	var cfg := ConfigFile.new()
	if cfg.load("user://scores.cfg") == OK:
		best_time = int(cfg.get_value("scores", "mines_l" + str(level), 0))
	new_game(1 if not demo else 0)


func new_game(lv: int) -> void:
	level = lv
	cols = LEVELS[lv].cols
	rows = LEVELS[lv].rows
	nmines = LEVELS[lv].mines
	var n := cols * rows
	mine = []
	count = []
	shown = []
	flag = []
	at = []
	for i in n:
		mine.append(false)
		count.append(0)
		shown.append(false)
		flag.append(false)
		at.append(0.0)
	booms.clear()
	started = false
	state = "play"
	elapsed = 0.0
	var cfg := ConfigFile.new()
	best_time = int(cfg.get_value("scores", "mines_l" + str(level), 0)) if cfg.load("user://scores.cfg") == OK else 0


func _nbrs(i: int) -> Array:
	var out: Array = []
	var x := i % cols
	var y := i / cols
	for dy in [-1, 0, 1]:
		for dx in [-1, 0, 1]:
			if dx == 0 and dy == 0:
				continue
			var nx: int = x + dx
			var ny: int = y + dy
			if nx >= 0 and ny >= 0 and nx < cols and ny < rows:
				out.append(ny * cols + nx)
	return out


func _place_mines(safe: int) -> void:
	var banned := _nbrs(safe)
	banned.append(safe)
	var cells: Array = []
	for i in cols * rows:
		if not banned.has(i):
			cells.append(i)
	cells.shuffle()
	for k in nmines:
		mine[cells[k]] = true
	for i in cols * rows:
		var c := 0
		for nb in _nbrs(i):
			if mine[nb]:
				c += 1
		count[i] = c


func _reveal(i: int) -> void:
	if state != "play" or shown[i] or flag[i]:
		return
	if not started:
		started = true
		t0 = t
		_place_mines(i)
	if mine[i]:
		_lose(i)
		return
	# cascade par vagues (largeur d'abord) : le délai croît avec la distance au clic
	var q: Array = [i]
	var dist := {i: 0}
	var opened := 0
	while not q.is_empty():
		var c: int = q.pop_front()
		if shown[c] or flag[c]:
			continue
		shown[c] = true
		at[c] = t + dist[c] * 0.022
		opened += 1
		if count[c] == 0:
			for nb in _nbrs(c):
				if not shown[nb] and not mine[nb] and not dist.has(nb):
					dist[nb] = dist[c] + 1
					q.append(nb)
	Sfx.play("reveal")
	_check_win()


func _chord(i: int) -> void:
	if not shown[i] or count[i] == 0:
		return
	var f := 0
	for nb in _nbrs(i):
		if flag[nb]:
			f += 1
	if f != count[i]:
		return
	for nb in _nbrs(i):
		if not flag[nb] and not shown[nb]:
			_reveal(nb)


func _toggle_flag(i: int) -> void:
	if state != "play" or shown[i]:
		return
	flag[i] = not flag[i]
	Sfx.play("flag")


func _lose(i: int) -> void:
	state = "lost"
	shake = 14.0
	var order: Array = []
	var ci := Vector2(i % cols, i / cols)
	for k in cols * rows:
		if mine[k]:
			order.append(k)
	order.sort_custom(func(a, b): return Vector2(a % cols, a / cols).distance_to(ci) < Vector2(b % cols, b / cols).distance_to(ci))
	var delay := 0.0
	for k in order:
		booms.append({"i": k, "at": t + delay})
		delay += 0.06
	shown[i] = true
	at[i] = t
	Sfx.play("boom")


func _check_win() -> void:
	for i in cols * rows:
		if not mine[i] and not shown[i]:
			return
	state = "won"
	elapsed = t - t0
	for i in cols * rows:
		if mine[i]:
			flag[i] = true
	Sfx.play("win")
	var secs := int(elapsed)
	if best_time == 0 or secs < best_time:
		best_time = secs
		var cfg := ConfigFile.new()
		cfg.load("user://scores.cfg")
		cfg.set_value("scores", "mines_l" + str(level), secs)
		cfg.set_value("scores", "mines", secs)
		cfg.save("user://scores.cfg")
	var r := size
	for k in 7:
		get_tree().create_timer(0.15 * k).timeout.connect(func(): burst(Vector2(rng.randf_range(0.15, 0.85) * r.x, rng.randf_range(0.2, 0.6) * r.y), Color.from_hsv(rng.randf(), 0.8, 1.0), 36, 320.0))


func _layout() -> Dictionary:
	var r := size
	var cs := floorf(minf((r.x - 60.0) / cols, (r.y - 210.0) / rows))
	cs = maxf(cs, 12.0)
	var w := cs * cols
	var h := cs * rows
	return {"origin": Vector2((r.x - w) * 0.5, 150.0 + (r.y - 210.0 - h) * 0.5 + 10.0), "cell": cs, "w": w, "h": h}


func _cell_at(p: Vector2) -> int:
	var l := _layout()
	var q: Vector2 = (p - l.origin) / l.cell
	if q.x < 0.0 or q.y < 0.0 or q.x >= cols or q.y >= rows:
		return -1
	return int(q.y) * cols + int(q.x)


func _process(d: float) -> void:
	super._process(d)
	if state == "play" and started:
		elapsed = t - t0
	var keep: Array = []
	for b in booms:
		if t >= b.at:
			shown[b.i] = true
			at[b.i] = b.at
			var l := _layout()
			burst(l.origin + (Vector2(b.i % cols, b.i / cols) + Vector2(0.5, 0.5)) * l.cell, Neon.ACCENT, 14, 240.0)
			shake = maxf(shake, 5.0)
		else:
			keep.append(b)
	booms = keep
	if demo and state == "play":
		demo_t += d
		if demo_t > 0.12:
			demo_t = 0.0
			var tries := 0
			while tries < 40:
				var i := rng.randi() % (cols * rows)
				if not shown[i] and not flag[i]:
					_reveal(i)
					break
				tries += 1
	elif demo and state != "play":
		demo_t += d
		if demo_t > 2.5:
			demo_t = 0.0
			new_game(rng.randi() % 3)


func _draw() -> void:
	var r := size
	var l := _layout()
	var cs: float = l.cell
	var o: Vector2 = l.origin + shake_offset()
	text_c(Vector2(0, 20), "DÉMINEUR", 42, Neon.glow(Neon.MAGENTA, 1.5), r.x)
	# niveaux (cliquables)
	for k in 3:
		var rc := _level_rect(k)
		var on := k == level
		draw_style_box(Neon.box(Color(0.1, 0.06, 0.16, 0.9) if on else Color(0.05, 0.04, 0.1, 0.8), Neon.glow(Neon.MAGENTA, 1.4) if on else Color(0.3, 0.2, 0.4, 0.6), 10, 2), rc)
		text_c(rc.position + Vector2(0, 8), str(k + 1) + " · " + LEVELS[k].name, 16, Neon.TEXT if on else Neon.DIM, rc.size.x)
	var flags := 0
	for f in flag:
		if f:
			flags += 1
	text_c(Vector2(24, 84), "MINES  " + str(nmines - flags), 26, Neon.glow(Neon.ACCENT, 1.4), 260.0, HORIZONTAL_ALIGNMENT_LEFT)
	text_c(Vector2(r.x - 284.0, 84), "TEMPS  " + str(int(elapsed)), 26, Neon.glow(Neon.CYAN, 1.4), 260.0, HORIZONTAL_ALIGNMENT_RIGHT)
	if best_time > 0:
		text_c(Vector2(r.x - 284.0, 114), "meilleur  " + str(best_time) + " s", 16, Neon.GOLD, 260.0, HORIZONTAL_ALIGNMENT_RIGHT)
	draw_style_box(Neon.box(Color(0.04, 0.03, 0.08, 0.96), Neon.glow(Neon.MAGENTA, 0.9), 14, 3), Rect2(o - Vector2(8, 8), Vector2(l.w + 16.0, l.h + 16.0)))
	var pad := maxf(1.0, cs * 0.04)
	for i in cols * rows:
		var cx := i % cols
		var cy := i / cols
		var rc := Rect2(o + Vector2(cx, cy) * cs + Vector2(pad, pad), Vector2(cs - pad * 2.0, cs - pad * 2.0))
		if shown[i]:
			var k := clampf((t - at[i]) / 0.22, 0.0, 1.0)
			if t < at[i]:
				_draw_hidden(rc, i)
				continue
			var e := 1.0 - pow(1.0 - k, 3.0)
			var rr := rc.grow(-(1.0 - e) * cs * 0.4)
			if mine[i]:
				draw_style_box(Neon.box(Color(0.25, 0.04, 0.08, 0.95), Neon.glow(Neon.ACCENT, 1.4), 6, 2), rr)
				_draw_mine(rr.get_center(), cs * 0.3 * e)
			else:
				draw_style_box(Neon.box(Color(0.1, 0.09, 0.18, 0.55 + 0.4 * e), Color(0.25, 0.22, 0.4, 0.5), 6, 1), rr)
				if count[i] > 0:
					var c: Color = NUM_COL[count[i]]
					var fs := int(cs * 0.6)
					var ty := rr.get_center().y - font.get_height(fs) * 0.5
					draw_string(font, Vector2(rr.position.x, ty + font.get_ascent(fs)), str(count[i]), HORIZONTAL_ALIGNMENT_CENTER, rr.size.x, fs, Neon.glow(c, 1.4) * Color(1, 1, 1, e))
		else:
			_draw_hidden(rc, i)
			if state == "lost" and flag[i] and not mine[i]:
				draw_line(rc.position, rc.end, Neon.glow(Neon.ACCENT, 1.5), 3.0, true)
				draw_line(Vector2(rc.position.x, rc.end.y), Vector2(rc.end.x, rc.position.y), Neon.glow(Neon.ACCENT, 1.5), 3.0, true)
	draw_floaters()
	text_c(Vector2(0, r.y - 38.0), "Clic gauche : creuser · Clic droit / F : drapeau · 1-2-3 : niveau · R : rejouer · Échap : menu", 16, Neon.DIM, r.x)
	if state == "won":
		overlay("DÉSAMORCÉ !", "Temps " + str(int(elapsed)) + " s  ·  R pour rejouer", Neon.GREEN)
	elif state == "lost":
		var done := booms.is_empty()
		if done:
			overlay("BOUM", "R pour rejouer", Neon.ACCENT)


func _level_rect(k: int) -> Rect2:
	var w := 150.0
	var gap := 12.0
	var x0 := (size.x - (w * 3.0 + gap * 2.0)) * 0.5
	return Rect2(x0 + k * (w + gap), 80.0, w, 34.0)


func _draw_hidden(rc: Rect2, i: int) -> void:
	var hot := i == hover and state == "play"
	var base := Color(0.16, 0.12, 0.3, 0.95) if not hot else Color(0.24, 0.17, 0.42, 1.0)
	draw_style_box(Neon.box(base, Neon.glow(Neon.MAGENTA, 0.8 if not hot else 1.5) * Color(1, 1, 1, 0.5 if not hot else 1.0), 6, 2), rc)
	if flag[i]:
		var c := rc.get_center()
		var s := rc.size.x
		draw_line(c + Vector2(-s * 0.1, s * 0.3), c + Vector2(-s * 0.1, -s * 0.3), Neon.TEXT, maxf(2.0, s * 0.07), true)
		draw_colored_polygon(PackedVector2Array([c + Vector2(-s * 0.1, -s * 0.3), c + Vector2(s * 0.3, -s * 0.12), c + Vector2(-s * 0.1, s * 0.06)]), Neon.glow(Neon.MAGENTA, 1.7))


func _draw_mine(c: Vector2, r: float) -> void:
	draw_circle(c, r, Color(0.05, 0.02, 0.06))
	for k in 8:
		var a := TAU * k / 8.0
		draw_line(c + Vector2.from_angle(a) * r * 0.8, c + Vector2.from_angle(a) * r * 1.5, Color(0.05, 0.02, 0.06), maxf(2.0, r * 0.3), true)
	draw_circle(c + Vector2(-r * 0.3, -r * 0.3), r * 0.25, Neon.glow(Color.WHITE, 1.4))
	draw_arc(c, r * 1.05, 0.0, TAU, 32, Neon.glow(Neon.ACCENT, 1.8), 2.0, true)


func _gui_input(e: InputEvent) -> void:
	super._gui_input(e)
	if e is InputEventMouseMotion:
		hover = _cell_at(e.position)
	elif e is InputEventMouseButton and e.pressed:
		if e.button_index == MOUSE_BUTTON_LEFT:
			for k in 3:
				if _level_rect(k).has_point(e.position):
					new_game(k)
					Sfx.play("click")
					return
			if state != "play":
				return
			var i := _cell_at(e.position)
			if i >= 0:
				if shown[i]:
					_chord(i)
				else:
					_reveal(i)
		elif e.button_index == MOUSE_BUTTON_RIGHT:
			var i := _cell_at(e.position)
			if i >= 0:
				_toggle_flag(i)
	elif e is InputEventKey and e.pressed and not e.echo:
		match e.keycode:
			KEY_1, KEY_KP_1, KEY_AMPERSAND:
				new_game(0)
			KEY_2, KEY_KP_2:
				new_game(1)
			KEY_3, KEY_KP_3, KEY_QUOTEDBL:
				new_game(2)
			KEY_R:
				new_game(level)
			KEY_F:
				if hover >= 0:
					_toggle_flag(hover)
