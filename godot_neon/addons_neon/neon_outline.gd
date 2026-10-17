class_name NeonOutline
extends Node2D
## CONTOUR NEON GLOBAL d'une TileMapLayer (ou de tout CanvasItem) : le néon suit la silhouette du GROUPE de tuiles collées,
## aucune arête interne n'est tracée.
##
## Utilisation : ajouter ce noeud comme ENFANT de la TileMapLayer (ou lui assigner `cible`). Rien d'autre.
##
## Comment ça marche :
##  1. la cible est marquée sur une couche de visibilité dédiée (en plus de la couche 1, elle reste affichée normalement) ;
##  2. un SubViewport qui partage le monde 2D du jeu ne rend QUE cette couche : une texture transparente avec la TileMap seule ;
##  3. un Sprite2D affiche cette texture avec `neon_outline.gdshader`, qui n'ajoute de lumière qu'à l'EXTÉRIEUR de la silhouette ;
##  4. le Sprite2D est calé sur la caméra à chaque image et placé juste DERRIÈRE la cible (z_index -1) : joueur et décor passent devant.

const SHADER: Shader = preload("res://addons_neon/neon_outline.gdshader")
const ISOLATION_BIT: int = 1 << 19      # couche de visibilité réservée à l'isolation (change-la si ton jeu l'utilise déjà)

@export var cible: CanvasItem                          ## vide = le parent
@export_group("Néon")
@export var couleur: Color = Color(0.1, 0.95, 1.0)
@export_range(1.0, 24.0, 0.5) var epaisseur_px: float = 8.0
@export_range(0.0, 8.0, 0.1) var intensite_halo: float = 2.2     ## > 1 : HDR, accroche le Glow du WorldEnvironment
@export_range(0.0, 8.0, 0.1) var intensite_coeur: float = 4.0
@export_range(0.0, 1.0, 0.01) var pulsation: float = 0.15
@export_group("Qualité")
@export_range(1, 3) var supersample: int = 1           ## 2 = contour plus net sur écran haute résolution (coût ×4)
@export var z_derriere_cible: int = -1

var _vp: SubViewport
var _sprite: Sprite2D
var _mat: ShaderMaterial


func _ready() -> void:
	if cible == null:
		cible = get_parent() as CanvasItem
	if cible == null:
		push_error("NeonOutline : aucune cible (CanvasItem) — place ce noeud sous la TileMapLayer.")
		return
	_marquer(true)

	_vp = SubViewport.new()
	_vp.transparent_bg = true
	_vp.disable_3d = true
	_vp.world_2d = get_viewport().world_2d                 # même monde que le jeu : la TileMap n'est pas dupliquée
	_vp.canvas_cull_mask = ISOLATION_BIT                   # ... mais seule la couche isolée est rendue
	_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	_vp.size = Vector2i(2, 2)
	add_child(_vp)

	_mat = ShaderMaterial.new()
	_mat.shader = SHADER
	_sprite = Sprite2D.new()
	_sprite.centered = false
	_sprite.texture = _vp.get_texture()
	_sprite.material = _mat
	_sprite.z_index = z_derriere_cible
	_sprite.top_level = true                               # indépendant de la transformation de la TileMap : calé sur l'écran
	_sprite.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	add_child(_sprite)
	_appliquer_parametres()
	process_priority = 1000                                # après la Camera2D : aucune image de retard
	process_mode = Node.PROCESS_MODE_ALWAYS


func _exit_tree() -> void:
	_marquer(false)


## Un Viewport ne rend un CanvasItem que si LUI et TOUS SES PARENTS partagent une couche avec son `canvas_cull_mask` :
## le bit d'isolation est donc posé sur la cible ET sur ses ancêtres CanvasItem (les noeuds qui ne dessinent rien n'y changent rien).
## Attention : un ancêtre qui dessine lui-même (Sprite2D parent d'une TileMap...) apparaîtrait dans la silhouette.
func _marquer(actif: bool) -> void:
	var n: Node = cible
	while n != null:
		var ci: CanvasItem = n as CanvasItem
		if ci != null:
			if actif:
				ci.visibility_layer |= ISOLATION_BIT
			else:
				ci.visibility_layer &= ~ISOLATION_BIT
		n = n.get_parent()


func _appliquer_parametres() -> void:
	_mat.set_shader_parameter("neon_color", couleur)
	_mat.set_shader_parameter("width_px", epaisseur_px)
	_mat.set_shader_parameter("glow_intensity", intensite_halo)
	_mat.set_shader_parameter("core_intensity", intensite_coeur)
	_mat.set_shader_parameter("pulse_amount", pulsation)
	_mat.set_shader_parameter("supersample", float(supersample))


func _process(_delta: float) -> void:
	if _vp == null:
		return
	_appliquer_parametres()
	var vp: Viewport = get_viewport()
	var ct: Transform2D = vp.get_canvas_transform()                       # monde -> écran (caméra, zoom, shake)
	var taille: Vector2i = Vector2i(vp.get_visible_rect().size) * supersample
	if _vp.size != taille:
		_vp.size = taille
	var ss: Vector2 = Vector2.ONE * float(supersample)
	_vp.canvas_transform = Transform2D.IDENTITY.scaled(ss) * ct           # le SubViewport voit exactement la même zone que l'écran
	_sprite.global_transform = ct.affine_inverse() * Transform2D.IDENTITY.scaled(Vector2.ONE / ss)   # ... et son image est replacée au pixel près
	_sprite.visible = cible.is_visible_in_tree()


## Image actuelle du SubViewport (la TileMap isolée) : utile pour déboguer.
func silhouette_image() -> Image:
	return _vp.get_texture().get_image() if _vp else null
