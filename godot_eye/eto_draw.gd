extends Node2D
## Calque de dessin des traits du visage : délègue tout au parent (eto_face.gd), qui détient l'état et les expressions.
func _draw() -> void:
	var p := get_parent()
	if p != null and p.has_method("draw_face"):
		p.draw_face(self)
