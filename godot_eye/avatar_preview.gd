extends Node2D
## Aperçu de l'avatar 3D d'E.N.O.S.   godot --path godot_eye res://avatar_preview.tscn
## Captures : ... -- --capture <dossier>   (idle / speak / glitch / regard à droite)

var av: Control


func _ready() -> void:
	var win: Window = get_window()
	win.size = Vector2i(640, 640)
	win.borderless = false
	win.transparent = false
	get_viewport().transparent_bg = false
	RenderingServer.set_default_clear_color(Color(0.02, 0.02, 0.03))
	av = preload("res://avatar/enos_avatar.gd").new()
	av.position = Vector2(20, 20)
	av.size = Vector2(600, 600)
	add_child(av)
	var args: PackedStringArray = OS.get_cmdline_user_args()
	var i: int = args.find("--capture")
	if i >= 0 and i + 1 < args.size():
		_capture(args[i + 1])


func _shot(dir: String, name: String) -> void:
	for _f in 6:
		await get_tree().process_frame
	get_viewport().get_texture().get_image().save_png(dir.path_join(name + ".png"))


func _capture(dir: String) -> void:
	DirAccess.make_dir_recursive_absolute(dir)
	await _shot(dir, "1_idle")
	av.speak = 1.0
	av.mood = 0.7
	for _f in 40:
		await get_tree().process_frame
	await _shot(dir, "2_speak")
	av.look = Vector2(0.9, -0.4)
	await _shot(dir, "3_look")
	av.set("_glitch_left", 1.0)
	av.set("_glitch_next", 99.0)
	await _shot(dir, "4_glitch")
	get_tree().quit()
