extends RefCounted
# Palette et petits outils de dessin communs aux jeux. Les couleurs « glow » dépassent 1.0 : avec le HDR 2D, le WorldEnvironment les fait rayonner.

const BG_TOP := Color("0b0618")
const BG_BOT := Color("04101c")
const ACCENT := Color("e0243c")
const CYAN := Color("22e6ff")
const MAGENTA := Color("ff3df0")
const GOLD := Color("ffc94a")
const GREEN := Color("3dff9a")
const TEXT := Color("ececef")
const DIM := Color("8a8a9c")
const PANEL := Color(0.07, 0.06, 0.13, 0.92)


static func glow(c: Color, k: float = 1.7) -> Color:
	return Color(c.r * k, c.g * k, c.b * k, c.a)


static func box(fill: Color, border: Color, radius: int, bw: int = 2) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = fill
	s.border_color = border
	s.set_border_width_all(bw)
	s.set_corner_radius_all(radius)
	s.anti_aliasing = true
	return s
