extends "res://game.gd"
# SERPENT : flèches / ZQSD (ou glisser), Espace = pause, R = rejouer. Mouvement interpolé, corps dégradé, bonus doré, particules.

const COLS := 30
const ROWS := 18

var body: Array = []         # Vector2i, la tête en [0]
var prev: Array = []         # positions au pas précédent (pour l'interpolation)
var dir := Vector2i(1, 0)
var queue: Array = []        # directions en attente (2 max)
var food := Vector2i.ZERO
var gold := Vector2i(-1, -1)
var gold_left := 0.0
var step_t := 0.0
var eaten := 0
var score := 0
var state := "ready"         # ready | play | pause | dead
var grow := 0
var drag_from := Vector2.ZERO
var demo_t := 0.0


func _ready() -> void:
	game_id = "snake"
	super._ready()
	reset()


func reset() -> void:
	body = [Vector2i(8, ROWS / 2), Vector2i(7, ROWS / 2), Vector2i(6, ROWS / 2), Vector2i(5, ROWS / 2)]
	prev = body.duplicate()
	dir = Vector2i(1, 0)
	queue.clear()
	gold = Vector2i(-1, -1)
	eaten = 0
	score = 0
	grow = 0
	step_t = 0.0
	state = "ready"
	_place_food()


func _free_cell() -> Vector2i:
	for i in 400:
		var c := Vector2i(rng.randi() % COLS, rng.randi() % ROWS)
		if not body.has(c) and c != food and c != gold:
			return c
	return Vector2i(0, 0)


func _place_food() -> void:
	food = _free_cell()


func _dur() -> float:
	return maxf(0.055, 0.125 - eaten * 0.0022)


func _turn(d: Vector2i) -> void:
	var last: Vector2i = queue.back() if not queue.is_empty() else dir
	if d == last or d == -last or queue.size() >= 2:
		return
	queue.append(d)
	if state == "ready":
		state = "play"


func _process(d: float) -> void:
	super._process(d)
	if demo:
		demo_t += d
		if demo_t > 0.05:
			demo_t = 0.0
			_demo_steer()
	if state != "play":
		return
	if gold.x >= 0:
		gold_left -= d
		if gold_left <= 0.0:
			gold = Vector2i(-1, -1)
	step_t += d
	var dur := _dur()
	while step_t >= dur and state == "play":
		step_t -= dur
		_step()


func _demo_steer() -> void:
	if state == "dead":
		reset()
		return
	if state == "ready":
		state = "play"
	var head: Vector2i = body[0]
	var want := food
	var best_d := Vector2i.ZERO
	var best_s := 1e9
	for cand in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
		if cand == -dir:
			continue
		var nx: Vector2i = head + cand
		if nx.x < 0 or nx.y < 0 or nx.x >= COLS or nx.y >= ROWS or body.has(nx):
			continue
		var sc := float((nx - want).length_squared()) + rng.randf() * 0.5
		if sc < best_s:
			best_s = sc
			best_d = cand
	if best_d != Vector2i.ZERO and best_d != dir:
		queue.clear()
		queue.append(best_d)


func _step() -> void:
	if not queue.is_empty():
		dir = queue.pop_front()
	prev = body.duplicate()
	var nh: Vector2i = body[0] + dir
	var tail_moves := grow == 0
	var hit := nh.x < 0 or nh.y < 0 or nh.x >= COLS or nh.y >= ROWS
	if not hit:
		var chk := body.duplicate()
		if tail_moves:
			chk.pop_back()
		hit = chk.has(nh)
	if hit:
		_die()
		return
	body.push_front(nh)
	if grow > 0:
		grow -= 1
		prev.append(prev.back())
	else:
		body.pop_back()
	if nh == food:
		eaten += 1
		score += 10
		grow += 1
		Sfx.play("eat")
		burst(_cell_center(nh), Neon.GREEN, 18, 200.0)
		floater("+10", _cell_center(nh), Neon.glow(Neon.GREEN, 1.6))
		_place_food()
		if eaten % 5 == 0 and gold.x < 0:
			gold = _free_cell()
			gold_left = 7.0
	elif nh == gold:
		score += 50
		grow += 2
		Sfx.play("gold")
		burst(_cell_center(nh), Neon.GOLD, 34, 280.0)
		floater("+50", _cell_center(nh), Neon.glow(Neon.GOLD, 1.6))
		gold = Vector2i(-1, -1)
	save_best(score)


func _die() -> void:
	state = "dead"
	shake = 12.0
	Sfx.play("die")
	for i in range(0, body.size(), 2):
		burst(_cell_center(body[i]), Neon.MAGENTA, 6, 220.0)


func _layout() -> Dictionary:
	var r := size
	var cs := floorf(minf((r.x - 60.0) / COLS, (r.y - 190.0) / ROWS))
	cs = maxf(cs, 10.0)
	var w := cs * COLS
	var h := cs * ROWS
	return {"origin": Vector2((r.x - w) * 0.5, 130.0 + (r.y - 190.0 - h) * 0.5 + 20.0), "cell": cs, "w": w, "h": h}


func _cell_center(c: Vector2i) -> Vector2:
	var l := _layout()
	return l.origin + (Vector2(c) + Vector2(0.5, 0.5)) * l.cell


func _draw() -> void:
	var r := size
	var l := _layout()
	var cs: float = l.cell
	var o: Vector2 = l.origin + shake_offset()
	text_c(Vector2(0, 22), "SERPENT", 42, Neon.glow(Neon.GREEN, 1.5), r.x)
	text_c(Vector2(24, 34), "SCORE  " + str(score), 24, Neon.TEXT, 300.0, HORIZONTAL_ALIGNMENT_LEFT)
	text_c(Vector2(r.x - 324.0, 34), "RECORD  " + str(maxi(best, score)), 24, Neon.GOLD, 300.0, HORIZONTAL_ALIGNMENT_RIGHT)
	draw_style_box(Neon.box(Color(0.03, 0.04, 0.08, 0.96), Neon.glow(Neon.GREEN, 0.9), 16, 3), Rect2(o - Vector2(8, 8), Vector2(l.w + 16.0, l.h + 16.0)))
	var dc := Color(0.3, 0.9, 0.6, 0.07)
	for y in ROWS + 1:
		draw_line(o + Vector2(0, y * cs), o + Vector2(l.w, y * cs), dc, 1.0)
	for x in COLS + 1:
		draw_line(o + Vector2(x * cs, 0), o + Vector2(x * cs, l.h), dc, 1.0)
	# nourriture
	var fp := o + (Vector2(food) + Vector2(0.5, 0.5)) * cs
	var pu := 1.0 + 0.14 * sin(t * 6.0)
	draw_circle(fp, cs * 0.62 * pu, Color(1.0, 0.2, 0.4, 0.14))
	draw_circle(fp, cs * 0.34 * pu, Neon.glow(Color("ff3d6e"), 1.8))
	draw_circle(fp + Vector2(-cs * 0.1, -cs * 0.1), cs * 0.1, Color(1, 1, 1, 0.8))
	if gold.x >= 0:
		var gp := o + (Vector2(gold) + Vector2(0.5, 0.5)) * cs
		var blink := 1.0 if gold_left > 2.0 else (0.5 + 0.5 * sin(t * 18.0))
		draw_circle(gp, cs * 0.75 * (1.0 + 0.2 * sin(t * 8.0)), Color(1.0, 0.8, 0.2, 0.16 * blink))
		var star := PackedVector2Array()
		for i in 10:
			var rad := cs * (0.46 if i % 2 == 0 else 0.2)
			star.append(gp + Vector2.from_angle(-PI / 2.0 + TAU * i / 10.0 + t * 1.5) * rad)
		draw_colored_polygon(star, Neon.glow(Neon.GOLD, 1.9 * blink))
	_draw_snake(o, cs)
	draw_floaters()
	text_c(Vector2(0, r.y - 38.0), "Flèches / ZQSD ou glisser · Espace : pause · R : rejouer · Échap : menu", 16, Neon.DIM, r.x)
	match state:
		"ready":
			overlay("PRÊT ?", "Appuie sur une direction", Neon.GREEN)
		"pause":
			overlay("PAUSE", "Espace pour reprendre", Neon.CYAN)
		"dead":
			overlay("GAME OVER", "Score " + str(score) + "  ·  R pour rejouer", Neon.ACCENT)


func _draw_snake(o: Vector2, cs: float) -> void:
	var a := clampf(step_t / _dur(), 0.0, 1.0) if state == "play" else 1.0
	var n := body.size()
	var pts := PackedVector2Array()
	for i in n:
		var cur: Vector2 = o + (Vector2(body[i]) + Vector2(0.5, 0.5)) * cs
		var pv: Vector2i = prev[i] if i < prev.size() else body[i]
		var pp: Vector2 = o + (Vector2(pv) + Vector2(0.5, 0.5)) * cs
		pts.append(pp.lerp(cur, a))
	# corps : du bout de la queue vers la tête, couleur qui glisse du cyan au vert vif
	for i in range(n - 1, -1, -1):
		var f := 1.0 - float(i) / maxf(1.0, n - 1.0)
		var col := Color.from_hsv(lerpf(0.52, 0.38, f), 0.85, 1.0)
		var rad := cs * lerpf(0.26, 0.46, f)
		if i < n - 1:
			draw_line(pts[i], pts[i + 1], Neon.glow(col, 1.5), rad * 1.7, true)
		draw_circle(pts[i], rad, Neon.glow(col, 1.5))
	var hp := pts[0]
	var dv := Vector2(dir)
	draw_circle(hp, cs * 0.5, Neon.glow(Color.from_hsv(0.38, 0.5, 1.0), 1.5))
	var side := dv.orthogonal()
	for s in [-1.0, 1.0]:
		var ep: Vector2 = hp + dv * cs * 0.16 + side * cs * 0.2 * s
		draw_circle(ep, cs * 0.12, Color.WHITE)
		draw_circle(ep + dv * cs * 0.04, cs * 0.06, Color(0.02, 0.02, 0.06))


func _gui_input(e: InputEvent) -> void:
	super._gui_input(e)
	if e is InputEventKey and e.pressed and not e.echo:
		match e.keycode:
			KEY_UP, KEY_W, KEY_Z:
				_turn(Vector2i(0, -1))
			KEY_DOWN, KEY_S:
				_turn(Vector2i(0, 1))
			KEY_LEFT, KEY_A, KEY_Q:
				_turn(Vector2i(-1, 0))
			KEY_RIGHT, KEY_D:
				_turn(Vector2i(1, 0))
			KEY_SPACE:
				if state == "play":
					state = "pause"
				elif state == "pause":
					state = "play"
			KEY_R:
				reset()
	elif e is InputEventMouseButton and e.button_index == MOUSE_BUTTON_LEFT:
		if e.pressed:
			drag_from = e.position
		else:
			var dlt: Vector2 = e.position - drag_from
			if maxf(absf(dlt.x), absf(dlt.y)) > 30.0:
				if absf(dlt.x) > absf(dlt.y):
					_turn(Vector2i(1 if dlt.x > 0.0 else -1, 0))
				else:
					_turn(Vector2i(0, 1 if dlt.y > 0.0 else -1))
			elif state == "dead":
				reset()
