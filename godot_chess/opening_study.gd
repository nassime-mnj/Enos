extends Node2D
## OpeningStudy : calque pédagogique du MODE APPRENTISSAGE, posé sur le plateau (main.gd).
##   * cases surlignées (vert = bon, rouge = mauvais, jaune = info, bleu = idée) dessinées SOUS les pièces, sur ordre de Python ;
##   * bandeau d'étude (ouverture, variante, qui a la main : ETO / toi, avancement de la démonstration).
## Les flèches pédagogiques existent déjà dans main.gd (show_arrows) : Python envoie les deux en même temps. Python reste seul juge des coups.

const SQ := 128.0
const BX := 56.0
const BAR := 240.0
const VIEW_W := 1080.0
const HUD_H := 84.0                         # hauteur reprise au panneau de sous-titres (main.gd/_study_layout)
const KIND_COL := {
	"good": Color(0.24, 0.80, 0.35),
	"bad": Color(0.92, 0.24, 0.28),
	"info": Color(1.0, 0.80, 0.24),
	"idea": Color(0.27, 0.67, 1.0),
}

var main: Node2D
var squares: Array = []                     # [{sq, kind, t0}]
var hold := 0.0
var clock := 0.0
var hud: Dictionary = {}
var hud_node: Node2D


func setup(m: Node2D) -> void:
	main = m
	hud_node = Node2D.new()
	hud_node.z_index = 112
	hud_node.draw.connect(_draw_hud)
	add_child(hud_node)


func show_squares(list: Array, secs := 6.0) -> void:
	squares = []
	for s in list:
		if s is Dictionary and String(s.get("sq", "")).length() == 2:
			var d: Dictionary = (s as Dictionary).duplicate()
			d["t0"] = clock
			squares.append(d)
	hold = clampf(secs, 2.0, 20.0)
	queue_redraw()


func clear_squares() -> void:
	squares = []
	queue_redraw()


func set_hud(h: Dictionary) -> void:
	if not bool(h.get("on", false)):
		hud = {}
		clear_squares()
	else:
		hud = h.duplicate()
	if hud_node != null:
		hud_node.queue_redraw()


func _process(dt: float) -> void:
	clock += dt
	if not squares.is_empty():
		hold -= dt
		if hold <= 0.0:
			clear_squares()
		else:
			queue_redraw()
	if not hud.is_empty() and String(hud.get("mode", "")) == "practice" and hud_node != null:
		hud_node.queue_redraw()                                            # le bandeau « À TOI DE JOUER » pulse


func _draw() -> void:
	if main == null:
		return
	for i in squares.size():
		var s: Dictionary = squares[i]
		var c: Vector2 = main.sq_center(String(s["sq"]))
		var age := clock - float(s.get("t0", 0.0))
		var k := clampf(age * 3.5, 0.0, 1.0)
		var col: Color = KIND_COL.get(String(s.get("kind", "info")), KIND_COL["info"])
		var pulse := 0.80 + 0.20 * sin(clock * 4.0 + float(i))
		var r := Rect2(c - Vector2(SQ, SQ) * 0.5, Vector2(SQ, SQ))
		draw_rect(r, Color(col.r, col.g, col.b, 0.42 * k * pulse))
		draw_rect(r.grow(-3.0), Color(col.r, col.g, col.b, 0.95 * k), false, 6.0)
		draw_circle(r.position + Vector2(18.0, 18.0), 7.0 * k, Color(col.r, col.g, col.b, 0.95))


func _font() -> Font:
	if main != null and main.has_method("_ensure_fonts"):
		main.call("_ensure_fonts")
		return main.f_head
	return ThemeDB.fallback_font


func _fit(text: String, f: Font, size: int, maxw: float) -> String:
	var t := text
	while t.length() > 4 and f.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x > maxw:
		t = t.substr(0, t.length() - 2)
	return t if t == text else t.strip_edges() + "…"


func _draw_hud() -> void:
	if hud.is_empty() or main == null:
		return
	var f := _font()
	var mode := String(hud.get("mode", ""))
	var title := String(hud.get("title", "")).to_upper()
	var variation := String(hud.get("variation", ""))
	var who := "ETO A LA MAIN"
	var col := Color(0.55, 1.0, 0.10)
	if mode == "practice":
		who = "À TOI DE JOUER"
		col = Color(0.08, 0.95, 1.0)
		col.a = 0.75 + 0.25 * sin(clock * 5.0)
	elif mode == "explore":
		who = "EXPLORATION"
	var step := String(hud.get("step", ""))
	var x := BAR + 6.0
	var w := VIEW_W - BAR - 30.0
	var h := HUD_H + 10.0
	var y := BAR - h - 6.0                                                      # sous le panneau de sous-titres, au-dessus du plateau
	hud_node.draw_rect(Rect2(x, y, w, h), Color(0.0, 0.0, 0.0, 0.66))
	hud_node.draw_rect(Rect2(x, y, 6.0, h), col)
	hud_node.draw_string(f, Vector2(x + 20.0, y + 30.0), _fit("MODE ÉTUDE · " + title, f, 25, w - 36.0), HORIZONTAL_ALIGNMENT_LEFT, -1, 25, Color(1, 1, 1, 0.96))
	hud_node.draw_string(f, Vector2(x + 20.0, y + 58.0), who + ("  ·  " + step if step != "" else ""), HORIZONTAL_ALIGNMENT_LEFT, -1, 23, col)
	if variation != "":
		hud_node.draw_string(f, Vector2(x + 20.0, y + 83.0), _fit(variation, f, 21, w - 36.0), HORIZONTAL_ALIGNMENT_LEFT, -1, 21, Color(1, 1, 1, 0.80))
