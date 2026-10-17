extends Node2D
## Scène de démonstration : plateformes en tuiles (carré 2x2, forme en L, tuile isolée, sol) + fond sombre + contour néon global.
## Lancer avec `--capture chemin.png` pour sauvegarder une capture d'écran puis quitter (utilisé pour vérifier le rendu).

const T: int = 32


func _ready() -> void:
	var fond: CanvasLayer = CanvasLayer.new()
	fond.layer = -10
	var rect: ColorRect = ColorRect.new()
	rect.color = Color(0.05, 0.06, 0.1)
	rect.size = Vector2(4000, 4000)
	fond.add_child(rect)
	add_child(fond)

	var layer: TileMapLayer = TileMapLayer.new()
	layer.tile_set = _make_tileset()
	add_child(layer)
	for x in range(2, 4):                                   # groupe 2x2
		for y in range(5, 7):
			layer.set_cell(Vector2i(x, y), 0, Vector2i.ZERO)
	for c in [Vector2i(8, 6), Vector2i(9, 6), Vector2i(10, 6), Vector2i(10, 5), Vector2i(10, 4)]:   # forme en L
		layer.set_cell(c, 0, Vector2i.ZERO)
	layer.set_cell(Vector2i(14, 5), 0, Vector2i.ZERO)       # tuile isolée
	for x in range(0, 22):                                  # sol
		layer.set_cell(Vector2i(x, 10), 0, Vector2i.ZERO)
		layer.set_cell(Vector2i(x, 11), 0, Vector2i.ZERO)

	var neon: Node2D = preload("res://addons_neon/neon_outline.gd").new()
	neon.epaisseur_px = 10.0
	layer.add_child(neon)

	var cam: Camera2D = Camera2D.new()
	cam.position = Vector2(352, 200)
	if OS.get_cmdline_user_args().has("--cam"):                # test d alignement : caméra décalée + zoom non entier
		cam.position += Vector2(37.3, -21.7)
		cam.zoom = Vector2(1.5, 1.5)
	add_child(cam)

	var env: WorldEnvironment = WorldEnvironment.new()      # le Glow rend le néon HDR lumineux
	var e: Environment = Environment.new()
	e.background_mode = Environment.BG_CANVAS
	e.glow_enabled = true
	e.glow_hdr_threshold = 1.0
	e.glow_intensity = 0.9
	env.environment = e
	add_child(env)

	var args: PackedStringArray = OS.get_cmdline_user_args()
	var i: int = args.find("--capture")
	if i >= 0 and i + 1 < args.size():
		for _f in 8:
			await get_tree().process_frame
		get_viewport().get_texture().get_image().save_png(args[i + 1])
		neon.silhouette_image().save_png(args[i + 1].replace(".png", "_sil.png"))
		get_tree().quit()


func _make_tileset() -> TileSet:
	# Tuile 32x32 avec une BORDURE CLAIRE visible : si le contour néon traçait les arêtes internes, on le verrait immédiatement.
	var img: Image = Image.create(T, T, false, Image.FORMAT_RGBA8)
	img.fill(Color(0.32, 0.34, 0.4))
	for k in T:
		for b in 2:
			img.set_pixel(k, b, Color(0.55, 0.58, 0.66))
			img.set_pixel(k, T - 1 - b, Color(0.2, 0.21, 0.26))
			img.set_pixel(b, k, Color(0.55, 0.58, 0.66))
			img.set_pixel(T - 1 - b, k, Color(0.2, 0.21, 0.26))
	var src: TileSetAtlasSource = TileSetAtlasSource.new()
	src.texture = ImageTexture.create_from_image(img)
	src.texture_region_size = Vector2i(T, T)
	src.create_tile(Vector2i.ZERO)
	var ts: TileSet = TileSet.new()
	ts.tile_size = Vector2i(T, T)
	ts.add_source(src)
	return ts
