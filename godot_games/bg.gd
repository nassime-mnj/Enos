extends Control
# Fond animé : dégradé sombre, étoiles qui scintillent, grille néon qui défile lentement.

const Neon = preload("res://neon.gd")
var t := 0.0
var stars: Array = []


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	var r := RandomNumberGenerator.new()
	r.seed = 42
	for i in 90:
		stars.append(Vector3(r.randf(), r.randf(), r.randf_range(0.4, 1.6)))


func _process(d: float) -> void:
	t += d
	queue_redraw()


func _draw() -> void:
	var r := get_rect().size
	var bands := 48                                  # dégradé vertical en bandes (un polygone à 4 couleurs laisse une diagonale visible)
	for i in bands:
		var f := float(i) / (bands - 1)
		draw_rect(Rect2(0.0, r.y * i / bands, r.x, r.y / bands + 1.0), Neon.BG_TOP.lerp(Neon.BG_BOT, f))
	var step := 64.0
	var off := fmod(t * 6.0, step)
	var gc := Color(0.35, 0.25, 0.8, 0.07)
	var x := -off
	while x < r.x:
		draw_line(Vector2(x, 0), Vector2(x, r.y), gc, 1.0)
		x += step
	var y := -off
	while y < r.y:
		draw_line(Vector2(0, y), Vector2(r.x, y), gc, 1.0)
		y += step
	for s in stars:
		var a := 0.25 + 0.5 * (0.5 + 0.5 * sin(t * s.z + s.x * 40.0))
		draw_circle(Vector2(s.x * r.x, fmod(s.y * r.y + t * 4.0 * s.z, r.y)), 0.9 + s.z * 0.5, Color(0.7, 0.8, 1.0, a * 0.6))
