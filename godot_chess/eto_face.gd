extends Node2D
## VISAGE D'ETO — 8-BIT. Lit l'atlas de sprites 64x64 généré par preparer_eto8.py (le même que l'interface web) :
## corps perlé + calque haut (yeux, sourcils, joues, larmes ; 3 phases de clignement) + calque bouche (4 niveaux de parole) + effets animés.
## 57 émotions, chacune avec son mouvement (secousse, rebond, balancement), regard au pixel entier, « pouf » de pixels à chaque changement d'émotion.
## API (inchangée) : R (rayon de la boule en pixels écran), follow (Vector2 -1..1), speaking, level, base_name, set_expression(), react(), tick(dt).

var R := 98.0
var follow := Vector2.ZERO                     # direction du regard fournie par le propriétaire (curseur global)
var speaking := false
var level := -1.0
var base_name := "smile"

var idx: Dictionary = {}
var atlas: Texture2D
var cols := 8
var ball := [32, 33, 24]
var temp_name := ""
var temp_until := 0.0
var t := 0.0
var blink_at := 1.6
var blink_t0 := -1.0
var glance_at := 5.0
var glance_end := 0.0
var glance := Vector2.ZERO
var look_c := Vector2.ZERO
var talk_phase := 0
var talk_t := 0.0
var pop_t := -1.0
var _acc := 0.0
var _cmds: Array = []


func _ready() -> void:
	texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST                      # pixels francs, jamais de flou
	var f := FileAccess.open("res://eto8/index.json", FileAccess.READ)
	if f != null:
		var j: Variant = JSON.parse_string(f.get_as_text())
		if j is Dictionary:
			idx = j
			cols = int(idx.get("cols", 8))
			ball = idx.get("ball", ball)
	var img := Image.load_from_file(ProjectSettings.globalize_path("res://eto8/atlas.png"))   # lecture directe : fonctionne même sans cache d'import Godot
	if img != null:
		atlas = ImageTexture.create_from_image(img)


func _has(name: String) -> bool:
	return (idx.get("expr", {}) as Dictionary).has(name)


func set_expression(name: String) -> void:
	if not _has(name):
		name = "neutral"
	if name != base_name and temp_name == "":
		pop_t = 0.0
	base_name = name


func react(name: String, secs := 1.7) -> void:
	if not _has(name):
		return
	temp_name = name
	temp_until = t + secs
	pop_t = 0.0


func tick(dt: float) -> void:
	t += dt
	_acc += dt
	if idx.is_empty() or atlas == null or _acc < 0.032:                     # ~30 images / s : le rythme d'un jeu 8-bit
		return
	dt = _acc
	_acc = 0.0
	if temp_name != "" and t > temp_until:
		temp_name = ""
	var name := temp_name if temp_name != "" else base_name
	var expr: Dictionary = (idx["expr"] as Dictionary).get(name, idx["expr"]["neutral"])
	# clignement : ouvert, mi-clos, fermé, mi-clos, ouvert (55 ms par image) ; parfois double
	if blink_t0 < 0.0 and t > blink_at:
		blink_t0 = t
		blink_at = t + 2.4 + randf() * 3.8
		if randf() < 0.18:
			blink_at = t + 0.26
	var blink := 0
	if blink_t0 >= 0.0:
		var k := int((t - blink_t0) / 0.055)
		blink = [0, 1, 2, 1, 0][k] if k < 5 else 0
		if k >= 5:
			blink_t0 = -1.0
	# regard : curseur global / coups d'œil ; toujours un décalage ENTIER en pixels de sprite
	var g := follow
	if follow == Vector2.ZERO:
		if t > glance_at:
			glance = Vector2(randf() * 1.6 - 0.8, randf() * 0.8 - 0.4)
			glance_at = t + 3.5 + randf() * 5.0
			glance_end = t + 0.7 + randf() * 0.7
		if t < glance_end:
			g = glance
	look_c += (g - look_c) * (1.0 - exp(-dt * 14.0))
	var lo := Vector2(round(look_c.x * 3.0), round(look_c.y * 2.0))
	# parole : 4 niveaux de bouche, changement toutes les ~70 ms
	var phase := 0
	if speaking:
		if t - talk_t > 0.07:
			talk_t = t
			var env := level
			if env < 0.0:
				env = maxf(0.0, absf(sin(t * 9.2) * 0.55 + sin(t * 5.1 + 1.3) * 0.35 + sin(t * 13.7) * 0.18) - 0.1) * (1.0 if sin(t * 1.7) > -0.82 else 0.15)
			talk_phase = 0 if env < 0.12 else (1 if env < 0.3 else (2 if env < 0.5 else 3))
		phase = talk_phase
	# mouvement propre à l'émotion : hz >= 6 secousse, sinon rebond / balancement
	var mv := Vector2.ZERO
	var mot: Variant = expr.get("mot")
	if mot is Dictionary:
		var hz := float(mot.get("hz", 1.0))
		var ax := float(mot.get("x", 0.0))
		var ay := float(mot.get("y", 0.0))
		if hz >= 6.0:
			mv.x = ax * (1.0 if sin(t * hz * TAU) > 0.0 else -1.0)
			mv.y = ay * (-1.0 if sin(t * hz * TAU + 1.3) > 0.2 else 0.0)
		elif hz >= 2.5:
			mv.y = -round(ay * absf(sin(t * hz * PI)))
			mv.x = round(ax * sin(t * hz * TAU))
		else:
			mv.x = round(ax * sin(t * hz * TAU))
			mv.y = round(ay * sin(t * hz * TAU + 0.7))
	var breath := 1.0 if sin(t * 1.9) > 0.45 else 0.0                       # respiration : un pixel, par paliers
	var pop_y := 0.0
	var pop_frame := -1
	if pop_t >= 0.0:
		pop_t += dt
		pop_frame = int(pop_t / 0.05)
		pop_y = [-3.0, -2.0, -1.0, 0.0, 0.0][mini(pop_frame, 4)]
		if pop_frame >= 5:
			pop_t = -1.0
			pop_frame = -1
	var b := Vector2(mv.x, mv.y + breath + pop_y)
	_cmds.clear()
	_cmds.append([int(idx["shadow"][1 if b.y < 0.0 else 0]), Vector2.ZERO])
	_cmds.append([int(idx["body"]), b])
	_cmds.append([int(expr["top"][blink]), b + lo])
	_cmds.append([int(expr["mouth"][phase]), b + lo])
	var fn := int(t * 8.0)
	for fx in expr["fx"]:
		var fr: Array = (idx["fx"] as Dictionary).get(fx, [])
		if not fr.is_empty():
			_cmds.append([int(fr[fn % fr.size()]), b if (fx == "ring" or fx == "aura") else Vector2.ZERO])
	if pop_frame >= 0:
		var pf: Array = idx["fx"]["pop"]
		if pop_frame < pf.size():
			_cmds.append([int(pf[pop_frame]), b])
	queue_redraw()


func _draw() -> void:
	if atlas == null or _cmds.is_empty():
		return
	var s := maxf(1.0, floorf(R / float(ball[2]) + 0.35))                   # échelle ENTIÈRE : chaque pixel du sprite = un carré net à l écran
	var org := Vector2(-float(ball[0]) * s, -float(ball[1]) * s)
	for c in _cmds:
		var i: int = c[0]
		var o: Vector2 = c[1]
		var src := Rect2(float((i % cols) * 64), float(floori(float(i) / float(cols)) * 64), 64.0, 64.0)
		draw_texture_rect_region(atlas, Rect2(org + o * s, Vector2(64.0, 64.0) * s), src)
