extends "res://game.gd"
# 2048 NÉON : flèches / ZQSD / glisser à la souris. Tuiles animées (glissement, fusion « pop »), halo néon par valeur, record enregistré.

class Tile extends RefCounted:
	var v := 2
	var cell := Vector2i.ZERO
	var vis := Vector2.ZERO      # position dessinée (en cases, flottante)
	var s := 1.0                 # échelle
	var dead := false
	var merged := false

const N := 4
var tiles: Array = []
var score := 0
var over := false
var won := false
var busy := false
var drag_from := Vector2.ZERO
var demo_t := 0.0
var last_gain := 0


func _ready() -> void:
	game_id = "2048"
	super._ready()
	new_game()


func new_game() -> void:
	for tl in tiles:
		tl.dead = true
	tiles.clear()
	score = 0
	over = false
	won = false
	busy = false
	_spawn()
	_spawn()


func _grid() -> Dictionary:
	var g := {}
	for tl in tiles:
		if not tl.dead:
			g[tl.cell] = tl
	return g


func _spawn() -> void:
	var g := _grid()
	var free: Array = []
	for y in N:
		for x in N:
			if not g.has(Vector2i(x, y)):
				free.append(Vector2i(x, y))
	if free.is_empty():
		return
	var tl := Tile.new()
	tl.cell = free[rng.randi() % free.size()]
	tl.v = 2 if rng.randf() < 0.9 else 4
	tl.vis = Vector2(tl.cell)
	tl.s = 0.0
	tiles.append(tl)
	create_tween().tween_property(tl, "s", 1.0, 0.18).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


func _can_move() -> bool:
	var g := _grid()
	if g.size() < N * N:
		return true
	for c in g:
		for d in [Vector2i(1, 0), Vector2i(0, 1)]:
			var o: Vector2i = c + d
			if g.has(o) and g[o].v == g[c].v:
				return true
	return false


func move(dir: Vector2i) -> void:
	if busy or over:
		return
	var g := _grid()
	var xs: Array = range(N)
	var ys: Array = range(N)
	if dir.x > 0:
		xs.reverse()
	if dir.y > 0:
		ys.reverse()
	var moved := false
	var merges: Array = []
	for tl in tiles:
		tl.merged = false
	for y in ys:
		for x in xs:
			var c := Vector2i(x, y)
			if not g.has(c):
				continue
			var tl: Tile = g[c]
			var pos := c
			var into: Tile = null
			while true:
				var nx := pos + dir
				if nx.x < 0 or nx.y < 0 or nx.x >= N or nx.y >= N:
					break
				if not g.has(nx):
					pos = nx
					continue
				var o: Tile = g[nx]
				if o.v == tl.v and not o.merged and into == null:
					into = o
					pos = nx
				break
			if pos == c:
				continue
			moved = true
			g.erase(c)
			tl.cell = pos
			if into != null:
				tl.dead = true
				into.v *= 2
				into.merged = true
				score += into.v
				merges.append(into)
			else:
				g[pos] = tl
	if not moved:
		shake = 3.0
		return
	busy = true
	Sfx.play("merge" if not merges.is_empty() else "move")
	var tw := create_tween().set_parallel(true)
	for tl in tiles:
		tw.tween_property(tl, "vis", Vector2(tl.cell), 0.11).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.chain().tween_callback(_after_move.bind(merges))


func _after_move(merges: Array) -> void:
	tiles = tiles.filter(func(tl): return not tl.dead)
	for m in merges:
		var tw := create_tween()
		tw.tween_property(m, "s", 1.22, 0.07)
		tw.tween_property(m, "s", 1.0, 0.12).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		var p := _cell_center(m.cell)
		burst(p, _tile_color(m.v), 10 + int(log(m.v) / log(2.0)), 150.0)
		floater("+" + str(m.v), p, Neon.glow(_tile_color(m.v), 1.6))
		if m.v >= 128:
			Sfx.play("big")
		if m.v == 2048 and not won:
			won = true
	save_best(score)
	_spawn()
	busy = false
	if not _can_move():
		over = true
		shake = 10.0
		Sfx.play("die")


func _tile_color(v: int) -> Color:
	var e := log(float(v)) / log(2.0)
	return Color.from_hsv(fmod(0.52 + (e - 1.0) * 0.075, 1.0), 0.85, 1.0)


func _layout() -> Dictionary:
	var r := size
	var side := minf(r.x * 0.9, r.y - 190.0)
	side = maxf(side, 200.0)
	var origin := Vector2((r.x - side) * 0.5, 150.0 + (r.y - 190.0 - side) * 0.5)
	return {"origin": origin, "side": side, "cell": side / N}


func _cell_center(c: Vector2i) -> Vector2:
	var l := _layout()
	return l.origin + (Vector2(c) + Vector2(0.5, 0.5)) * l.cell


func _process(d: float) -> void:
	super._process(d)
	if demo and not over:
		demo_t += d
		if demo_t > 0.18:
			demo_t = 0.0
			move([Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0), Vector2i(0, -1)][rng.randi() % 4])


func _draw() -> void:
	var r := size
	var l := _layout()
	var o: Vector2 = l.origin + shake_offset()
	var cs: float = l.cell
	var gap := cs * 0.06
	# en-tête
	text_c(Vector2(0, 26), "2048  NÉON", 44, Neon.glow(Neon.CYAN, 1.5), r.x)
	var bw := 150.0
	panel(Rect2(r.x * 0.5 - bw - 8.0, 84.0, bw, 52.0), Neon.CYAN)
	panel(Rect2(r.x * 0.5 + 8.0, 84.0, bw, 52.0), Neon.GOLD)
	text_c(Vector2(r.x * 0.5 - bw - 8.0, 88.0), "SCORE", 13, Neon.DIM, bw)
	text_c(Vector2(r.x * 0.5 - bw - 8.0, 104.0), str(score), 26, Neon.TEXT, bw)
	text_c(Vector2(r.x * 0.5 + 8.0, 88.0), "RECORD", 13, Neon.DIM, bw)
	text_c(Vector2(r.x * 0.5 + 8.0, 104.0), str(maxi(best, score)), 26, Neon.GOLD, bw)
	# plateau
	draw_style_box(Neon.box(Color(0.04, 0.035, 0.09, 0.95), Neon.glow(Neon.CYAN, 0.9), 20, 3), Rect2(o - Vector2(10, 10), Vector2(l.side + 20.0, l.side + 20.0)))
	for y in N:
		for x in N:
			draw_style_box(Neon.box(Color(0.09, 0.08, 0.17, 0.8), Color(0.2, 0.18, 0.35, 0.5), 12, 1), Rect2(o + Vector2(x, y) * cs + Vector2(gap, gap), Vector2(cs - gap * 2.0, cs - gap * 2.0)))
	for tl in tiles:
		_draw_tile(tl, o, cs, gap)
	draw_floaters()
	text_c(Vector2(0, r.y - 38.0), "Flèches / ZQSD ou glisser · R : rejouer · Échap : menu", 16, Neon.DIM, r.x)
	if over:
		overlay("PLUS DE COUPS", "Score " + str(score) + "  ·  R pour rejouer", Neon.ACCENT)
	elif won and not busy and score > 0 and tiles.any(func(tl): return tl.v >= 2048):
		text_c(Vector2(0, 142), "2048 atteint ! Continue…", 18, Neon.GOLD, r.x)


func _draw_tile(tl: Tile, o: Vector2, cs: float, gap: float) -> void:
	var col := _tile_color(tl.v)
	var sz := (cs - gap * 2.0) * tl.s
	if sz < 6.0:
		return
	var c := o + (tl.vis + Vector2(0.5, 0.5)) * cs
	var rc := Rect2(c - Vector2(sz, sz) * 0.5, Vector2(sz, sz))
	var k := minf(1.0, log(float(tl.v)) / log(2.0) / 11.0)
	draw_style_box(Neon.box(Color(col.r * 0.22, col.g * 0.22, col.b * 0.22, 0.96), Neon.glow(col, 1.2 + 0.9 * k), 12, 3), rc)
	var digits := str(tl.v).length()
	var fs := int(sz * (0.46 if digits <= 2 else (0.36 if digits == 3 else 0.28)))
	var ty := c.y - font.get_height(fs) * 0.5
	draw_string(font, Vector2(rc.position.x, ty + font.get_ascent(fs)), str(tl.v), HORIZONTAL_ALIGNMENT_CENTER, sz, fs, Neon.glow(col, 1.5 + k))


func _gui_input(e: InputEvent) -> void:
	super._gui_input(e)
	if e is InputEventKey and e.pressed and not e.echo:
		match e.keycode:
			KEY_UP, KEY_W, KEY_Z:
				move(Vector2i(0, -1))
			KEY_DOWN, KEY_S:
				move(Vector2i(0, 1))
			KEY_LEFT, KEY_A, KEY_Q:
				move(Vector2i(-1, 0))
			KEY_RIGHT, KEY_D:
				move(Vector2i(1, 0))
			KEY_R:
				new_game()
	elif e is InputEventMouseButton and e.button_index == MOUSE_BUTTON_LEFT:
		if e.pressed:
			drag_from = e.position
		else:
			var dlt: Vector2 = e.position - drag_from
			if maxf(absf(dlt.x), absf(dlt.y)) > 30.0:
				if absf(dlt.x) > absf(dlt.y):
					move(Vector2i(1 if dlt.x > 0.0 else -1, 0))
				else:
					move(Vector2i(0, 1 if dlt.y > 0.0 else -1))
