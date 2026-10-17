extends Node2D
## Visualiseur d'échecs E.N.O.S. : dessine, anime, parle. Les règles et Stockfish restent côté Python (pont WebSocket local).
##   Python -> Godot : state / update{steps,state,say} / say{text,kind} / sfx{name} / embedded / error / idle
##   Godot -> Python : hello / move{from,to,promo} / ping
## Mise en page : bandeau du boss (œil + sous-titres) de BAR px au-dessus du plateau 1024×1024. Le tout est mis à l'échelle (canvas_items, keep)
## pour remplir la fenêtre encastrée ; les pièces vivent sur un calque au-dessus du bandeau et débordent librement de leur case.
## Lancement : godot --path godot_chess -- --port <P> --token <T>      (test hors E.N.O.S. : -- --selftest <dossier>)

const BAR := 240.0
const BX := 56.0                                    # décalage du plateau : place de la barre d'évaluation (à gauche)
const SQ := 128.0
const BOARD := 1024.0
const VIEW := Vector2(1080.0, 1264.0)
const STRIP := 210.0                                  # mode BOSS : bande sous le plateau pour les avatars des challengers (le plateau est réduit pour tout faire tenir)
const FOOT := 0.40
const CYAN := Color(0.08, 0.95, 1.0)
const RED := Color(1.0, 0.16, 0.2)
const BG := Color(0.0039, 0.0039, 0.0039, 1.0)

const NAMES := {"K": "wk", "Q": "wq", "R": "wr", "B": "wb", "N": "wn", "P": "wp",
		"k": "bk", "q": "bq", "r": "br", "b": "bb", "n": "bn", "p": "bp"}
const SFX := ["move", "capture", "check", "checkmate", "castle", "promote", "select", "illegal", "start", "victory", "defeat",
		"brilliant", "excellent", "mistake", "blunder", "shockwave", "fahh1", "fahh2"]          # « shockwave » : grondement cinématographique mixé avec « brilliant » sur un coup brillant
# icône de jugement : couleur du badge (le symbole est dessiné dans _draw_badge)
const BADGE := {"book": Color(0.80, 0.65, 0.40), "brilliant": Color(0.10, 0.80, 0.84), "best": Color(0.48, 0.84, 0.30), "excellent": Color(0.62, 0.80, 0.22),
		"good": Color(0.45, 0.62, 0.40), "inaccuracy": Color(0.98, 0.78, 0.18), "mistake": Color(0.98, 0.54, 0.14), "blunder": Color(0.92, 0.18, 0.20)}
const KIND_COLOR := {"blunder": "#ff6070", "brilliant": "#40f4ff", "victory": "#ff2438", "defeat": "#ffd060", "opening": "#ffb0b8"}

# palettes : E.N.O.S. (noir / rouge sang) et ETO (blanc nacré / vert lime)
const PAL_ENOS := {"bg": Color(0.0039, 0.0039, 0.0039, 1.0), "bar": Color(0.025, 0.006, 0.01, 1.0), "line": Color(1.0, 0.1, 0.18, 0.035), "edge": Color(1.0, 0.12, 0.2, 0.75),
		"hl": Color(0.08, 0.95, 1.0, 0.13), "chk": Color(1.0, 0.16, 0.2), "selfill": Color(0.08, 0.95, 1.0, 0.20), "selline": Color(0.08, 0.95, 1.0, 0.95),
		"atk": Color(1.0, 0.16, 0.2, 0.95), "tgta": Color(0.08, 0.95, 1.0, 0.18), "tgtb": Color(0.08, 0.95, 1.0, 0.9), "coord": Color(1.0, 0.55, 0.58, 0.8),
		"ev_frame": Color(0.55, 0.06, 0.12, 0.9), "ev_bg": Color(0.05, 0.015, 0.025, 1.0), "ev_fill": Color(0.94, 0.89, 0.90, 1.0), "ev_tick": Color(1.0, 0.15, 0.2),
		"ev_light": Color(0.1, 0.02, 0.04), "ev_dark": Color(1.0, 0.85, 0.87), "dec_veil": Color(0.02, 0.0, 0.0, 0.62), "dec_title": Color(1.0, 0.2, 0.25),
		"dec_text": Color(1.0, 0.82, 0.84), "dec_best": Color(0.55, 0.95, 0.4), "dec_sub": Color(0.9, 0.7, 0.72), "dec_btn": Color(0.05, 0.01, 0.02, 0.95),
		"dec_c0": Color(0.9, 0.16, 0.2), "dec_c1": Color(0.12, 0.8, 0.86), "dec_hint": Color(0.7, 0.5, 0.52)}
const PAL_ETO := {"bg": Color("f7fbf1"), "bar": Color(1.0, 1.0, 1.0, 1.0), "line": Color(0.42, 0.82, 0.05, 0.06), "edge": Color(0.06, 0.12, 0.03, 0.85),
		"hl": Color(1.0, 0.82, 0.25, 0.42), "chk": Color("ff4d6d"), "selfill": Color(1.0, 0.82, 0.25, 0.40), "selline": Color("ffd23f"),
		"atk": Color(0.86, 0.14, 0.30, 0.95), "tgta": Color(0.06, 0.12, 0.03, 0.16), "tgtb": Color(0.06, 0.12, 0.03, 0.55), "coord": Color(0.06, 0.12, 0.03, 0.62),
		"ev_frame": Color(0.06, 0.12, 0.03, 1.0), "ev_bg": Color(0.06, 0.12, 0.03, 1.0), "ev_fill": Color(1.0, 1.0, 1.0, 1.0), "ev_tick": Color(0.40, 0.78, 0.05),
		"ev_light": Color(0.06, 0.12, 0.03), "ev_dark": Color(1.0, 1.0, 1.0), "dec_veil": Color(0.96, 0.99, 0.93, 0.84), "dec_title": Color("e0567a"),
		"dec_text": Color("0e1a08"), "dec_best": Color("2f9e6e"), "dec_sub": Color("5c7a3a"), "dec_btn": Color(1.0, 1.0, 1.0, 0.97),
		"dec_c0": Color("0e1a08"), "dec_c1": Color("4fb000"), "dec_hint": Color("94b070")}
const KIND_COLOR_ETO := {"blunder": "#e0567a", "brilliant": "#4fb000", "victory": "#2f9e6e", "defeat": "#4fb000", "opening": "#6f9a45"}
const LIME := Color(0.55, 1.0, 0.10)                # couleur des effets d'ETO (sillage, ondes de choc, halo de sélection)
const ETO_HUE := 0.24                                # rotation de teinte des pièces : les reflets rouges deviennent vert lime
const PIECE_FIT := 0.87                              # échelle globale des pièces : marge respirable dans la case (réf. Chess.com) ; surchargeable par "fit" dans theme.json
const TAG_FACE := {"excited": "excited", "gasps": "surprised", "shouts": "excited", "hmm": "hmm", "sigh": "sigh", "laugh": "laugh", "chuckles": "chuckle", "chuckle": "chuckle", "clears throat": "awkward", "exhales": "relieved"}
const KIND_FACE := {"blunder": "smug", "brilliant": "impressed", "victory": "victory", "defeat": "impressed", "opening": "focused", "check": "determined", "good": "cool"}

var pad := 48.0                                     # marge transparente des sprites du thème courant
var piece_h := {"k": 1.35, "q": 1.25, "r": 0.95, "b": 1.1, "n": 1.05, "p": 0.82}      # hauteur visée (en cases) par type de pièce, selon le thème
var theme_name := ""
var piece_fit := PIECE_FIT                          # multiplicateur d'échelle des pièces du thème courant
var tex := {}
var imgs := {}
var badge_tex := {}                                 # icônes de jugement (colis « moves image »)
var decision: Dictionary = {}                       # gaffe catastrophique en attente d'un choix (continuer / takeback)
var decision_node: Node2D
var mono_font: SystemFont                           # police unique (recréer une SystemFont à chaque dessin produit des glyphes corrompus)
var board_tex: Texture2D
var piece_shader: Shader
var knight_shader: Shader                           # pièce + émission HDR des yeux (thème visuel)
var vt: Node                                        # visual_theme.gd : thème visuel dynamique (plateau, matériaux, yeux, néon, glow)
var shock_shader: Shader
var add_mat := CanvasItemMaterial.new()

var pieces := {}
var me := "w"
var turn := "w"
var legal := {}
var over := ""
var in_check := false
var check_a := 0.0
var last := ""
var selected := ""
var busy := false
var awaiting := false
var pending_local: Dictionary = {}
var queue: Array = []
var promo_ui: Node2D
var promo_from := ""
var promo_to := ""
var layer_pieces: Node2D
var layer_fx: Node2D
var flash_rect: ColorRect
var banner_label: Label                                    # ancien bandeau (conservé invisible : l'affichage de fin de partie passe par banner_node)
var banner_node: Node2D
var banner_t := -1.0
var banner_title := ""
var banner_tag := "FIN DE PARTIE"
var banner_sub := ""
var dec_t := 0.0                                           # temps depuis l'apparition de la fenêtre de décision (animation d'entrée)
var f_title: Font                                          # polices de l'interface plateau (créées une fois : recréer une SystemFont à chaque dessin corrompt les glyphes)
var f_head: Font
var f_body: Font
var f_small: Font
var frags: Array = []
var badge_node: Node2D
var badge_sq := ""
var badge_key := ""
var badge_s := 0.0
var titans := false                                      # Choc des Titans : plateau et pièces FIGÉS (aucune teinte ni texture qui change à chaque réplique)
var side_names: Dictionary = {}                             # {"w": nom des Blancs, "b": nom des Noirs}
var board_skin: Texture2D                                 # plateau à couleurs unies choisi dans le sélecteur « Plateau » (prioritaire), sinon plateau du thème / board.png
var theme_board: Texture2D                               # plateau propre au thème de pièces (ex. Plat vert / Vecteezy), sinon board.png
var eval_cp := 0
var eval_goal := 0.5                                # probabilité de gain des Blancs (0–1) visée par la jauge
var eval_disp := 0.5                                # valeur affichée (animée)

# caméra (tremblement + coup de zoom)
var shake := 0.0
var zoom := 1.0

# personnalité : E.N.O.S. (l'œil rouge) ou ETO (la boule blanche au visage vert lime)
var eto := false
var theme_cfg := "classic"                          # thème de pièces demandé par Python (ETO impose « glace_rouge » teinté vert lime)
var board_tex_enos: Texture2D
var board_tex_eto: Texture2D
var ov_rect: ColorRect
var sub_box: StyleBoxFlat
var ui_font: SystemFont
var eto_wrap: Node2D
var boss_logo: TextureRect                                 # logo de Stockfish : remplace l'œil / le visage pendant que le boss annonce son coup
var boss_on := false
var boss_layout := false                                   # mode boss : Stockfish EN HAUT, challengers (E.N.O.S. / ETO / les deux) EN BAS
var boss_cfg := ""                                         # eto · enos · duo
var boss_move := ""                                        # dernier coup annoncé par Stockfish
var boss_hdr: Node2D                                       # carte de Stockfish dans l'en-tête
var boss_deco: Node2D                                      # noms et anneau « celui qui parle » sur les avatars du bas
var lay := 1.0                                             # échelle de mise en page (boss : < 1)
var lay_pos := Vector2.ZERO
var _clear_default := Color(0.0039, 0.0039, 0.0039, 1.0)
var eto_face: Node2D

# flèches pédagogiques (ETO les dessine pendant qu'il explique : meilleur coup, menace, coup qui punit)
var arrows: Array = []
var arrow_t := 0.0
var arrow_clock := 0.0                                                   # horloge propre aux flèches : chaque flèche porte son instant de naissance (t0)
var arrow_hold := 0.0
var arrow_node: Node2D
var study_node: Node2D                                                   # OpeningStudy.tscn : cases surlignées + bandeau du mode apprentissage
const ARROW_COL := {"played": Color(0.98, 0.72, 0.15), "best": Color(0.20, 0.82, 0.42), "threat": Color(0.95, 0.25, 0.35), "punish": Color(0.22, 0.50, 1.0), "brilliant": Color(1.0, 0.80, 0.12)}
const GOLD := Color(1.0, 0.80, 0.12)

# œil
var eye: ColorRect
var eye_mat: ShaderMaterial
var eye_speak := 0.0
var eye_flare := 0.0
var eye_look := Vector2.ZERO
var eye_look_target := Vector2.ZERO
var eye_look_hold := 0.0

# sous-titres
var sub_panel: PanelContainer
var sub_label: RichTextLabel
var sub_tag: Label
var sub_len := 0
var sub_t := 0.0
var sub_dur := 1.0
var sub_active := false
var sub_hold := 0.0

# audio
var players := {}

# réseau
var ws := WebSocketPeer.new()
var url := ""
var was_open := false
var lost_since := -1.0
var retry_at := 0.0
var ping_at := 0.0
var started := 0.0
var selftest_dir := ""
var studytest := false
var theme_arg := ""
var autoplay := false
var autoplayed := false


func _ready() -> void:
	started = Time.get_ticks_msec() / 1000.0
	mono_font = _mono()
	get_viewport().transparent_bg = true
	visible = false                                                     # fenêtre transparente et VIDE tant que le rattachement à E.N.O.S. n'est pas confirmé
	add_mat.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	piece_shader = load("res://shaders/piece.gdshader")
	knight_shader = load("res://shaders/knight.gdshader")
	vt = preload("res://visual_theme.gd").new()
	add_child(vt)
	vt.setup(self)
	shock_shader = load("res://shaders/shockwave.gdshader")
	board_tex = _load_tex("res://assets/board.png")
	load_theme("classic")
	for k in BADGE.keys():
		var bt := _tex_only("res://assets/badges/%s.png" % k)
		if bt != null:
			badge_tex[k] = bt
	_build_layers()
	_build_eye()
	_build_subtitles()
	_build_audio()
	board_tex_enos = board_tex
	board_tex_eto = _load_tex("res://assets/board_eto.png")
	ui_font = SystemFont.new()
	ui_font.font_names = PackedStringArray(["Segoe UI Variable Text", "Segoe UI", "Arial"])

	var port := ""
	var token := ""
	var args := OS.get_cmdline_user_args()
	for i in args.size():
		match args[i]:
			"--port": port = args[i + 1] if i + 1 < args.size() else ""
			"--token": token = args[i + 1] if i + 1 < args.size() else ""
			"--persona": set_persona(args[i + 1] if i + 1 < args.size() else "enos")
			"--show": visible = true
			"--visual":                                                      # test hors E.N.O.S. : applique un thème visuel JSON (voir nasko_visualtheme.py)
				var vcfg: Variant = JSON.parse_string(FileAccess.get_file_as_string(args[i + 1])) if i + 1 < args.size() else null
				if vcfg is Dictionary:
					vt.apply(vcfg, 0.0)
			"--autoplay": autoplay = true
			"--selftest": selftest_dir = args[i + 1] if i + 1 < args.size() else "."
			"--studytest": selftest_dir = args[i + 1] if i + 1 < args.size() else "."; studytest = true
			"--theme": theme_arg = args[i + 1] if i + 1 < args.size() else ""
	url = "ws://127.0.0.1:%s/ws/chess?t=%s" % [port, token]
	queue_redraw()
	if selftest_dir != "":
		visible = true
		if studytest:
			_studytest()
		else:
			_selftest()


func _load_tex(path: String) -> Texture2D:
	var img := Image.load_from_file(ProjectSettings.globalize_path(path))      # sans import : fonctionne dès le premier lancement
	if img == null:
		push_error("image introuvable : " + path)
		return null
	imgs[path.get_file().get_basename()] = img
	img.generate_mipmaps()                                                     # mipmaps : les grandes images réduites à l'écran restent lisses (plus d'escaliers ni de bruit)
	return ImageTexture.create_from_image(img)


func _tex_only(path: String) -> Texture2D:
	var img := Image.load_from_file(ProjectSettings.globalize_path(path))
	if img == null:
		return null
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


func boss_show(text: String, frm: String, to: String) -> void:
	## STOCKFISH (muet) ANNONCE son prochain coup : son logo remplace l'œil / le visage, le coup s'affiche en grand dans la bulle, une flèche verte le montre sur le plateau.
	if boss_logo == null or eye == null:
		return
	boss_on = true
	boss_move = text
	if boss_layout:                                                   # Stockfish a sa place en haut : les challengers restent en bas
		boss_logo.scale = Vector2(1.18, 1.18)
		boss_logo.pivot_offset = boss_logo.size / 2.0
		create_tween().tween_property(boss_logo, "scale", Vector2.ONE, 0.35).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		if frm.length() == 2 and to.length() == 2:
			show_arrows([{"from": frm, "to": to, "kind": "best"}], 3.0)
		sfx("select", 0.8, -2.0)
		shake = maxf(shake, 4.0)
		return
	eye.visible = false
	eto_wrap.visible = false
	boss_logo.visible = true
	boss_logo.scale = Vector2(1.18, 1.18)
	boss_logo.pivot_offset = boss_logo.size / 2.0
	create_tween().tween_property(boss_logo, "scale", Vector2.ONE, 0.35).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	sub_tag.text = "STOCKFISH  //  PROCHAIN COUP"
	var col := "#2f9e6e" if eto else "#7fe0a8"
	sub_label.text = "[font_size=52][b][color=%s]▸ %s[/color][/b][/font_size]" % [col, text.replace("[", "(")]
	sub_len = sub_label.text.length()
	sub_label.visible_characters = -1
	sub_active = false
	sub_hold = 6.0
	if frm.length() == 2 and to.length() == 2:
		show_arrows([{"from": frm, "to": to, "kind": "best"}], 3.0)
	sfx("select", 0.8, -2.0)
	shake = maxf(shake, 4.0)


func _study_layout(on: bool) -> void:
	## Mode apprentissage : le panneau de sous-titres d'ETO raccourcit pour laisser la place au bandeau d'étude (opening_study.gd) dans l'en-tête.
	if boss_layout:
		return
	sub_panel.size = Vector2(VIEW.x - BAR - 30.0, BAR - 52.0 - (study_node.get("HUD_H") if on else 0.0))


func _boss_layout(on: bool, cfg: String) -> void:
	## MODE BOSS : STOCKFISH en haut (logo + carte de son coup), E.N.O.S. et/ou ETO en bas, dans une bande sous le plateau. Le tout est réduit pour tenir dans la fenêtre.
	if on == boss_layout and (not on or cfg == boss_cfg):
		return
	boss_layout = on
	boss_cfg = cfg if on else ""
	boss_hdr.visible = on
	boss_deco.visible = on
	if on:
		var content := Vector2(VIEW.x, VIEW.y + STRIP)
		lay = minf(VIEW.x / content.x, VIEW.y / content.y)
		lay_pos = Vector2((VIEW.x - content.x * lay) / 2.0, 0.0)
		_clear_default = ProjectSettings.get_setting("rendering/environment/defaults/default_clear_color", _clear_default)
		RenderingServer.set_default_clear_color(P("bg"))                                 # bandes latérales (fenêtre plus large que le contenu réduit)
		var has_enos := boss_cfg == "enos" or boss_cfg == "duo"
		var has_eto := boss_cfg == "eto" or boss_cfg == "duo"
		var side := STRIP - 28.0
		var y := BAR + BOARD + 14.0
		eye.position = Vector2(18.0, y)
		eye.size = Vector2(side, side)
		var slot := 1 if (has_enos and has_eto) else 0
		eto_wrap.position = Vector2(18.0 + slot * STRIP, y) + Vector2(side, side) / 2.0
		eto_face.R = side * 0.44
		eye.visible = has_enos
		eto_wrap.visible = has_eto
		var x := 18.0 + (2 if (has_enos and has_eto) else 1) * STRIP + 4.0
		sub_panel.position = Vector2(x, y)
		sub_panel.size = Vector2(VIEW.x - x - 18.0, side)
		boss_logo.position = Vector2(18.0, 10.0)
		boss_logo.size = Vector2(BAR - 20.0, BAR - 20.0)
		boss_logo.pivot_offset = boss_logo.size / 2.0
		boss_logo.visible = true
	else:
		lay = 1.0
		lay_pos = Vector2.ZERO
		RenderingServer.set_default_clear_color(_clear_default)
		eye.position = Vector2(18.0, 10.0)
		eye.size = Vector2(BAR - 20.0, BAR - 20.0)
		eto_wrap.position = eye.position + eye.size / 2.0
		eto_face.R = (BAR - 20.0) * 0.44
		eye.modulate = Color.WHITE
		eto_wrap.modulate = Color.WHITE
		sub_panel.position = Vector2(BAR + 6.0, 26.0)
		sub_panel.size = Vector2(VIEW.x - BAR - 30.0, BAR - 52.0)
		boss_logo.visible = false
		boss_logo.position = eye.position
		boss_logo.size = eye.size
		eye.visible = not eto
		eto_wrap.visible = eto
	queue_redraw()


func _boss_dim() -> void:
	## Duo : celui qui parle est lumineux, son coéquipier est atténué.
	if boss_cfg != "duo":
		eye.modulate = Color.WHITE
		eto_wrap.modulate = Color.WHITE
		return
	eye.modulate = Color(1, 1, 1, 0.45) if eto else Color.WHITE
	eto_wrap.modulate = Color.WHITE if eto else Color(1, 1, 1, 0.45)


func _draw_boss_hdr() -> void:
	## Carte de Stockfish (en haut, à la place des bulles des challengers) : annonce de son prochain coup.
	if not boss_layout:
		return
	_ensure_fonts()
	var n := boss_hdr
	var r := Rect2(BAR + 6.0, 26.0, VIEW.x - BAR - 30.0, BAR - 52.0)
	var dark := not eto
	var bg := Color(0.04, 0.008, 0.014, 0.95) if dark else Color(1, 1, 1, 0.97)
	var edge := Color(0.30, 0.82, 0.55, 0.95)                                          # vert Stockfish
	_sbox(n, r, bg, 18.0 if not dark else 4.0, edge, 3, Color(0.2, 0.9, 0.5, 0.20), 22)
	var thinking := turn != me and not boss_on
	var tag := "STOCKFISH  //  PROCHAIN COUP" if boss_on else ("STOCKFISH  //  RÉFLÉCHIT" if thinking else "STOCKFISH  //  DERNIER COUP")
	n.draw_string(f_small, Vector2(r.position.x + 28.0, r.position.y + 40.0), tag, HORIZONTAL_ALIGNMENT_LEFT, -1, 20, Color(0.25, 0.70, 0.45, 0.95))
	var ink := Color(0.10, 0.45, 0.30) if not dark else Color(0.55, 0.95, 0.72)
	var txt := "▸ " + boss_move if boss_move != "" and not thinking else ("…" if boss_move == "" and not thinking else "")
	if thinking:
		var dots := ".".repeat(1 + int(Time.get_ticks_msec() / 350.0) % 3)
		n.draw_string(f_head, Vector2(r.position.x + 28.0, r.position.y + 112.0), "Calcul en cours" + dots, HORIZONTAL_ALIGNMENT_LEFT, -1, 40, Color(ink, 0.8))
	else:
		n.draw_string(f_title, Vector2(r.position.x + 28.0, r.position.y + 122.0), txt, HORIZONTAL_ALIGNMENT_LEFT, -1, 78, ink)


func _draw_boss_deco() -> void:
	## Bande du bas : noms sous les avatars (pastille) et anneau lumineux autour de celui qui parle.
	if not boss_layout:
		return
	_ensure_fonts()
	var n := boss_deco
	var has_enos := boss_cfg == "enos" or boss_cfg == "duo"
	var has_eto := boss_cfg == "eto" or boss_cfg == "duo"
	var side := STRIP - 28.0
	var y := BAR + BOARD + 14.0
	var slots: Array = []
	if has_enos:
		slots.append(["E.N.O.S.", 0, not eto, Color(1.0, 0.25, 0.30)])
	if has_eto:
		slots.append(["ETO", 1 if has_enos else 0, eto, Color(0.40, 0.80, 0.05)])
	for sl in slots:
		var x: float = 18.0 + float(sl[1]) * STRIP
		var active: bool = bool(sl[2]) or boss_cfg != "duo"
		var col: Color = sl[3]
		n.draw_rect(Rect2(x - 2.0, y - 2.0, side + 4.0, side + 4.0), Color(col, 0.9 if active else 0.25), false, 3.0)
		var w: float = f_small.get_string_size(String(sl[0]), HORIZONTAL_ALIGNMENT_LEFT, -1, 20).x + 26.0
		_sbox(n, Rect2(x + 8.0, y + side - 34.0, w, 28.0), Color(0, 0, 0, 0.72), 14.0)
		n.draw_string(f_small, Vector2(x + 21.0, y + side - 13.0), String(sl[0]), HORIZONTAL_ALIGNMENT_LEFT, -1, 20, Color(1, 1, 1, 0.95 if active else 0.6))


func boss_hide() -> void:
	boss_on = false
	if boss_layout:
		return
	if boss_logo != null:
		boss_logo.visible = false
	if eye != null:
		eye.visible = not eto
		eto_wrap.visible = eto


func set_board_skin(name: String) -> void:
	## Plateau à couleurs unies (assets/boards/<nom>.png, générés par preparer_boards.py). Nom vide ou inconnu : retour au plateau du thème.
	board_skin = null
	if name != "" and name == name.get_file().get_basename():
		var path := "res://assets/boards/%s.png" % name
		if FileAccess.file_exists(ProjectSettings.globalize_path(path)):
			board_skin = _load_tex(path)
	queue_redraw()


func load_theme(name: String) -> void:
	# thème = dossier assets/themes/<nom> : 12 PNG (wk…bp) + theme.json {pad, heights}. Les pièces déjà posées sont recréées avec les nouvelles images.
	var base := "res://assets/themes/%s/" % name
	var meta_path := ProjectSettings.globalize_path(base + "theme.json")
	var has_pieces := FileAccess.file_exists(ProjectSettings.globalize_path(base + "wk.png")) and FileAccess.file_exists(ProjectSettings.globalize_path(base + "bp.png"))
	if not has_pieces:                                                  # dossier absent ou incomplet : thème classique
		name = "classic"
		base = "res://assets/themes/classic/"
		meta_path = ProjectSettings.globalize_path(base + "theme.json")
	# theme.json est optionnel (hauteurs du thème classique par défaut) : tout dossier de 12 images est un thème valide
	var meta: Variant = JSON.parse_string(FileAccess.get_file_as_string(meta_path)) if FileAccess.file_exists(meta_path) else {}
	if meta is Dictionary:
		pad = float(meta.get("pad", 48.0))
		piece_fit = float(meta.get("fit", PIECE_FIT))
		var h: Variant = meta.get("heights", {})
		if h is Dictionary:
			for k in h:
				piece_h[k] = float(h[k])
	imgs.clear()
	for k in NAMES.values():
		tex[k] = _load_tex(base + "%s.png" % k)
	theme_board = _load_tex(base + "board.png") if FileAccess.file_exists(ProjectSettings.globalize_path(base + "board.png")) else null      # échiquier fourni par le thème
	theme_name = name
	if layer_pieces != null:
		var keep := {}
		for sq in pieces:
			keep[sq] = pieces[sq].get_meta("code")
			pieces[sq].queue_free()
		pieces.clear()
		for sq in keep:
			pieces[sq] = make_piece(keep[sq], sq)
		queue_redraw()


func _build_layers() -> void:
	layer_pieces = Node2D.new()
	add_child(layer_pieces)
	layer_fx = Node2D.new()
	layer_fx.z_index = 80
	add_child(layer_fx)
	var ov := ColorRect.new()                                           # voile holographique sur le plateau
	ov.position = Vector2(BX, BAR)
	ov.size = Vector2(BOARD, BOARD)
	ov.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ov.z_index = 90
	var om := ShaderMaterial.new()
	om.shader = load("res://shaders/overlay.gdshader")
	ov.material = om
	ov_rect = ov
	add_child(ov)
	flash_rect = ColorRect.new()                                        # flash plein cadre des impacts
	flash_rect.size = VIEW
	flash_rect.color = Color(1.0, 0.85, 0.8, 0.0)
	flash_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	flash_rect.z_index = 100
	add_child(flash_rect)
	banner_label = Label.new()
	banner_label.z_index = 105
	banner_label.size = Vector2(BOARD, 120)
	banner_label.position = Vector2(BX, BAR + BOARD / 2.0 - 60.0)
	banner_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	banner_label.add_theme_font_size_override("font_size", 76)
	banner_label.add_theme_color_override("font_color", Color(1.0, 0.2, 0.25))
	banner_label.add_theme_color_override("font_outline_color", Color(0, 0, 0, 1))
	banner_label.add_theme_constant_override("outline_size", 14)
	banner_label.modulate.a = 0.0
	add_child(banner_label)
	banner_node = Node2D.new()                                          # bandeau de fin de partie (carte vitrée, titre + sous-titre)
	banner_node.z_index = 110
	banner_node.draw.connect(_draw_banner)
	add_child(banner_node)
	decision_node = Node2D.new()                                         # gaffe catastrophique : voile, flèche du meilleur coup, deux boutons
	decision_node.z_index = 108
	decision_node.visible = false
	decision_node.draw.connect(_draw_decision)
	add_child(decision_node)
	badge_node = Node2D.new()                                           # icône de jugement (Brillant, Gaffe…) sur la case d'arrivée
	badge_node.z_index = 70
	badge_node.draw.connect(_draw_badge)
	add_child(badge_node)
	arrow_node = Node2D.new()                                           # flèches d'explication d'ETO, au-dessus des pièces
	arrow_node.z_index = 85
	arrow_node.draw.connect(_draw_arrows)
	add_child(arrow_node)
	promo_ui = Node2D.new()
	promo_ui.z_index = 110
	promo_ui.visible = false
	add_child(promo_ui)
	study_node = (load("res://OpeningStudy.tscn") as PackedScene).instantiate()      # mode apprentissage : cases surlignées SOUS les pièces (premier enfant), bandeau au-dessus
	add_child(study_node)
	move_child(study_node, 0)
	study_node.call("setup", self)


func _mono() -> SystemFont:
	var f := SystemFont.new()
	f.font_names = PackedStringArray(["Consolas", "Cascadia Mono", "Courier New", "monospace"])
	return f


func _build_eye() -> void:
	eye = ColorRect.new()
	eye.position = Vector2(18, 10)
	eye.size = Vector2(BAR - 20.0, BAR - 20.0)
	eye.mouse_filter = Control.MOUSE_FILTER_IGNORE
	eye_mat = ShaderMaterial.new()
	eye_mat.shader = load("res://shaders/eye.gdshader")
	eye.material = eye_mat
	add_child(eye)
	eto_wrap = Node2D.new()                                             # visage d'ETO : même emplacement que l'œil
	eto_wrap.position = eye.position + eye.size / 2.0
	eto_wrap.visible = false
	add_child(eto_wrap)
	eto_face = Node2D.new()
	eto_face.set_script(load("res://eto_face.gd"))
	eto_face.R = (BAR - 20.0) * 0.44
	eto_wrap.add_child(eto_face)
	boss_logo = TextureRect.new()                                       # logo Stockfish (assets/stockfish.png), même emplacement que l'œil
	boss_logo.expand_mode = TextureRect.EXPAND_IGNORE_SIZE                  # AVANT la taille : sinon la texture impose sa taille d'origine
	boss_logo.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	boss_logo.texture = _tex_only("res://assets/stockfish.png")
	boss_logo.position = eye.position
	boss_logo.size = eye.size
	boss_logo.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	boss_logo.mouse_filter = Control.MOUSE_FILTER_IGNORE
	boss_logo.visible = false
	add_child(boss_logo)
	boss_hdr = Node2D.new()
	boss_hdr.z_index = 20
	boss_hdr.visible = false
	boss_hdr.draw.connect(_draw_boss_hdr)
	add_child(boss_hdr)
	boss_deco = Node2D.new()
	boss_deco.z_index = 30
	boss_deco.visible = false
	boss_deco.draw.connect(_draw_boss_deco)
	add_child(boss_deco)


func _build_subtitles() -> void:
	sub_panel = PanelContainer.new()
	sub_panel.position = Vector2(BAR + 6.0, 26.0)
	sub_panel.size = Vector2(VIEW.x - BAR - 30.0, BAR - 52.0)
	sub_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.04, 0.008, 0.014, 0.93)
	sb.border_color = Color(0.95, 0.12, 0.2, 0.95)
	sb.set_border_width_all(2)
	sb.border_width_left = 6
	sb.set_corner_radius_all(2)
	sb.shadow_color = Color(1.0, 0.1, 0.15, 0.38)
	sb.shadow_size = 18
	sb.set_content_margin_all(16)
	sub_panel.add_theme_stylebox_override("panel", sb)
	sub_box = sb
	var box := VBoxContainer.new()
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	sub_panel.add_child(box)
	sub_tag = Label.new()
	sub_tag.text = "E.N.O.S.  //  EN ATTENTE"
	sub_tag.add_theme_font_override("font", _mono())
	sub_tag.add_theme_font_size_override("font_size", 17)
	sub_tag.add_theme_color_override("font_color", Color(1.0, 0.25, 0.32, 0.9))
	box.add_child(sub_tag)
	sub_label = RichTextLabel.new()
	sub_label.bbcode_enabled = true
	sub_label.fit_content = false
	sub_label.scroll_active = false
	sub_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	sub_label.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sub_label.add_theme_font_override("normal_font", _mono())
	sub_label.add_theme_font_size_override("normal_font_size", 29)
	sub_label.add_theme_color_override("default_color", Color(1.0, 0.86, 0.88))
	box.add_child(sub_label)
	add_child(sub_panel)


func _build_audio() -> void:
	for n in SFX:
		var p := AudioStreamPlayer.new()
		p.bus = "Master"
		var st := _load_audio(n)
		if st != null:
			p.stream = st
		add_child(p)
		players[n] = p
	var loaded := 0
	for n in SFX:
		if players[n].stream != null:
			loaded += 1
	print("ENOS_AUDIO ", loaded, "/", SFX.size(), " sons chargés")


func _load_audio(name: String) -> AudioStream:
	for ext in ["mp3", "ogg", "wav"]:                                          # un mp3 déposé dans audio/ remplace le wav du même nom
		var path := ProjectSettings.globalize_path("res://audio/%s.%s" % [name, ext])
		if not FileAccess.file_exists(path):
			continue
		match ext:
			"wav": return AudioStreamWAV.load_from_file(path)
			"ogg": return AudioStreamOggVorbis.load_from_file(path)
			"mp3": return AudioStreamMP3.load_from_file(path)
	return null


func sfx(name: String, pitch := 1.0, db := 0.0) -> void:
	var p: AudioStreamPlayer = players.get(name)
	if p == null or p.stream == null:
		return
	p.pitch_scale = pitch * randf_range(0.96, 1.04)
	p.volume_db = db
	p.play()


# ----------------------------------------------------------------------------- géométrie
func sq_center(s: String) -> Vector2:
	var f := s.unicode_at(0) - 97
	var r := s.unicode_at(1) - 49
	if me == "w":
		return Vector2(BX + (f + 0.5) * SQ, BAR + (7 - r + 0.5) * SQ)
	return Vector2(BX + (7 - f + 0.5) * SQ, BAR + (r + 0.5) * SQ)


func sq_feet(s: String) -> Vector2:
	return sq_center(s) + Vector2(0.0, SQ * FOOT)


func sq_at(p: Vector2) -> String:
	var y := p.y - BAR
	var x := p.x - BX
	if x < 0.0 or y < 0.0 or x >= BOARD or y >= BOARD:
		return ""
	var cx := int(x / SQ)
	var cy := int(y / SQ)
	var f := cx if me == "w" else 7 - cx
	var r := 7 - cy if me == "w" else cy
	return char(97 + f) + str(r + 1)


# ----------------------------------------------------------------------------- pièces
func make_piece(code: String, sq: String) -> Sprite2D:
	var s := Sprite2D.new()
	var t: Texture2D = tex[NAMES[code]]
	s.texture = t
	s.centered = false
	s.offset = Vector2(-t.get_width() / 2.0, -(t.get_height() - pad))
	var sc: float = piece_h[code.to_lower()] * SQ / (t.get_height() - 2.0 * pad) * piece_fit
	s.scale = Vector2.ONE * sc
	s.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	s.set_meta("sc", sc)
	var m := ShaderMaterial.new()
	m.shader = knight_shader if code.to_lower() == "n" else piece_shader
	m.set_shader_parameter("hue_shift", ETO_HUE if (eto and not titans) else 0.0)
	if eto and not titans:
		m.set_shader_parameter("trail_color", LIME)
		m.set_shader_parameter("glow_color", Color(0.45, 0.90, 0.05, 1.0))
	s.material = m
	s.set_meta("code", code)
	vt.style_piece(s)                                                       # teinte / matériau / yeux du thème visuel courant
	s.position = sq_feet(sq)
	s.z_index = 1 + int((s.position.y - BAR) / SQ)
	s.set_meta("code", code)
	layer_pieces.add_child(s)
	return s


func apply_state(st: Dictionary, entrance := false) -> void:
	me = st.get("me", "w")
	side_names = st.get("players", side_names)
	var was_titans := titans
	titans = String(st.get("mode", "")) == "titans"
	if titans != was_titans and layer_pieces != null:
		for sq in pieces:                                                    # la teinte des pièces dépend du mode : on la remet à jour sans recréer les sprites
			var mm: Variant = (pieces[sq] as Sprite2D).material
			if mm is ShaderMaterial:
				(mm as ShaderMaterial).set_shader_parameter("hue_shift", ETO_HUE if (eto and not titans) else 0.0)
	turn = st.get("turn", "w")
	if layer_pieces != null:
		var who := String(st.get("challenger", ""))
		if who == "":                                                       # repli : déduit des noms des camps ("E.N.O.S. + ETO", "ETO", "E.N.O.S.")
			var nm := String(side_names.get("w", "")) + "|" + String(side_names.get("b", ""))
			who = "duo" if nm.contains("+") else ("enos" if nm.replace("STOCKFISH", "").contains("E.N.O.S.") else "eto")
		_boss_layout(String(st.get("mode", "")) == "boss", who)
	legal = st.get("legal", {})
	over = st.get("over", "")
	in_check = st.get("check", false)
	last = st.get("last", "")
	eval_cp = int(st.get("eval", 0))
	eval_goal = _winpct(eval_cp)
	var dec: Variant = st.get("decision")
	if dec is Dictionary:
		show_decision(dec)
	else:
		hide_decision()
	var board: Dictionary = st.get("board", {})
	for sq in pieces.keys():
		var p: Sprite2D = pieces[sq]
		if not board.has(sq) or p.get_meta("code") != board[sq]:
			p.queue_free()
			pieces.erase(sq)
	var n := 0
	for sq in board:
		if not pieces.has(sq):
			var p := make_piece(board[sq], sq)
			pieces[sq] = p
			_entrance(p, n * 0.018 if entrance else 0.0)
			n += 1
	for sq in pieces:
		var p: Sprite2D = pieces[sq]
		if not entrance or p.modulate.a >= 0.99:
			p.position = sq_feet(sq)
			p.z_index = 1 + int((p.position.y - BAR) / SQ)
	queue_redraw()


func show_decision(d: Dictionary) -> void:
	if not decision.is_empty():
		return
	decision = d
	dec_t = 0.0
	decision_node.visible = true
	decision_node.queue_redraw()
	_fahh()
	zoom_punch(1.03)
	eye_flare = 1.0
	shake = maxf(shake, 10.0)


func hide_decision() -> void:
	decision = {}
	if decision_node != null:
		decision_node.visible = false


func _ensure_fonts() -> void:
	if f_title != null:
		return
	f_title = _make_font(800, 5)
	f_head = _make_font(700, 2)
	f_body = _make_font(500, 0)
	f_small = _make_font(600, 1)


func _make_font(weight: int, spacing: int) -> Font:
	var sf := SystemFont.new()
	sf.font_names = PackedStringArray(["Segoe UI Variable Display", "Segoe UI", "Bahnschrift", "Arial"])
	sf.font_weight = weight
	sf.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	sf.hinting = TextServer.HINTING_NONE                          # pas de hinting : contours nets à toutes les tailles après mise à l'échelle
	sf.subpixel_positioning = TextServer.SUBPIXEL_POSITIONING_AUTO
	sf.generate_mipmaps = true
	if spacing == 0:
		return sf
	var fv := FontVariation.new()
	fv.base_font = sf
	fv.spacing_glyph = spacing                                    # approche (letter-spacing) : titres plus aérés et plus « pro »
	return fv


func _sbox(n: Node2D, r: Rect2, bg: Color, radius: float, border := Color(0, 0, 0, 0), bw := 0, shadow := Color(0, 0, 0, 0), shadow_size := 0, soff := Vector2.ZERO) -> void:
	## Rectangle arrondi anti-aliasé (fond, liseré, ombre portée) : base de toutes les cartes et boutons.
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.set_corner_radius_all(int(radius))
	sb.anti_aliasing = true
	sb.anti_aliasing_size = 1.2
	if bw > 0:
		sb.border_color = border
		sb.set_border_width_all(bw)
	if shadow_size > 0:
		sb.shadow_color = shadow
		sb.shadow_size = shadow_size
		sb.shadow_offset = soff
	n.draw_style_box(sb, r)


func _fa(c: Color, k: float) -> Color:
	return Color(c.r, c.g, c.b, c.a * k)


func _dec_card() -> Rect2:
	return Rect2(BX + 112.0, BAR + 162.0, 800.0, 700.0)


func _decision_rects() -> Array:
	var c := _dec_card()
	return [Rect2(c.position.x + 44.0, c.end.y - 168.0, 340.0, 96.0), Rect2(c.end.x - 44.0 - 340.0, c.end.y - 168.0, 340.0, 96.0)]       # [continuer, takeback]


func _chip(n: Node2D, cx: float, cy: float, text: String, font: Font, size: int, fg: Color, bg: Color, k: float, pad := 30.0, hgt := 68.0) -> float:
	## Pastille centrée sur (cx, cy) ; retourne sa largeur.
	var w := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x + pad * 2.0
	_sbox(n, Rect2(cx - w / 2.0, cy - hgt / 2.0, w, hgt), _fa(bg, k), hgt / 2.0)
	n.draw_string(font, Vector2(cx - w / 2.0 + pad, cy + size * 0.35), text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, _fa(fg, k))
	return w


func _draw_decision() -> void:
	if decision.is_empty():
		return
	_ensure_fonts()
	var n := decision_node
	var k := _eo(dec_t / 0.35)
	var dark := not eto
	var veil: Color = P("dec_veil")
	n.draw_rect(Rect2(BX, BAR, BOARD, BOARD), _fa(veil, k))
	var bu: String = decision.get("best_uci", "")
	if bu.length() >= 4:                                                             # meilleur coup : cases de départ / d'arrivée et flèche (sous la carte)
		var a := sq_center(bu.substr(0, 2))
		var b := sq_center(bu.substr(2, 2))
		var dir := (b - a).normalized()
		var gc := Color(0.40, 0.88, 0.30, 0.95 * k)
		n.draw_rect(Rect2(a - Vector2(SQ, SQ) / 2.0, Vector2(SQ, SQ)), Color(gc, 0.30 * k))
		n.draw_rect(Rect2(b - Vector2(SQ, SQ) / 2.0, Vector2(SQ, SQ)), Color(gc, 0.30 * k))
		n.draw_line(a, b - dir * 26.0, gc, 14.0, true)
		n.draw_colored_polygon(PackedVector2Array([b, b - dir * 44.0 + dir.orthogonal() * 24.0, b - dir * 44.0 - dir.orthogonal() * 24.0]), gc)
		n.draw_circle(a, 12.0, gc)
	var card := _dec_card()
	var cc := card.get_center()
	var s := lerpf(0.93, 1.0, k)
	n.draw_set_transform(cc - cc * s, 0.0, Vector2(s, s))                          # entrée : léger zoom depuis le centre de la carte
	var card_bg := Color(0.045, 0.012, 0.02, 0.97) if dark else Color(1.0, 1.0, 1.0, 0.985)
	var ink: Color = P("dec_text")
	var accent: Color = P("dec_title")
	var edge: Color = P("dec_c1") if not dark else Color(1.0, 0.2, 0.25)
	_sbox(n, card, _fa(card_bg, k), 30.0, _fa(edge, k * 0.9), 3, Color(0, 0, 0, 0.45 * k), 46, Vector2(0, 14))
	n.draw_rect(Rect2(card.position.x + 34.0, card.position.y + 1.0, card.size.x - 68.0, 6.0), _fa(accent, k))   # liseré d'accent
	var cx := card.get_center().x
	var cy0 := card.position.y
	n.draw_circle(Vector2(cx, cy0 + 4.0), 84.0, _fa(card_bg, k))                    # médaillon : icône de gaffe à cheval sur le bord de la carte
	n.draw_arc(Vector2(cx, cy0 + 4.0), 84.0, 0.0, TAU, 72, _fa(accent, k), 5.0, true)
	if badge_tex.has("blunder"):
		n.draw_texture_rect(badge_tex["blunder"], Rect2(Vector2(cx - 62.0, cy0 + 4.0 - 62.0), Vector2(124, 124)), false, Color(1, 1, 1, k))
	n.draw_string(f_title, Vector2(card.position.x, cy0 + 160.0), "UNE ERREUR IMPORTANTE" if eto else "GAFFE CATASTROPHIQUE", HORIZONTAL_ALIGNMENT_CENTER, card.size.x, 46, _fa(accent, k))
	n.draw_string(f_small, Vector2(card.position.x, cy0 + 216.0), "VOTRE COUP", HORIZONTAL_ALIGNMENT_CENTER, card.size.x, 19, _fa(P("dec_sub"), k))
	var chip_bg := Color(1, 1, 1, 0.09) if dark else Color(0.06, 0.12, 0.03, 0.07)
	var w1 := f_head.get_string_size(str(decision.get("san", "")), HORIZONTAL_ALIGNMENT_LEFT, -1, 40).x + 60.0
	var loss_txt := "−%s cp" % str(decision.get("loss", 0))
	var w2 := f_head.get_string_size(loss_txt, HORIZONTAL_ALIGNMENT_LEFT, -1, 30).x + 56.0
	var x0 := cx - (w1 + w2 + 16.0) / 2.0
	_chip(n, x0 + w1 / 2.0, cy0 + 272.0, str(decision.get("san", "")), f_head, 40, ink, chip_bg, k, 30.0, 68.0)
	_chip(n, x0 + w1 + 16.0 + w2 / 2.0, cy0 + 272.0, loss_txt, f_head, 30, Color(1, 1, 1), Color(0.88, 0.22, 0.30), k, 28.0, 56.0)
	n.draw_string(f_small, Vector2(card.position.x, cy0 + 352.0), "IL FALLAIT JOUER", HORIZONTAL_ALIGNMENT_CENTER, card.size.x, 19, _fa(P("dec_sub"), k))
	_chip(n, cx, cy0 + 408.0, str(decision.get("best", "")), f_head, 40, Color(1, 1, 1), P("dec_best") if not dark else Color(0.22, 0.62, 0.20), k, 38.0, 68.0)
	n.draw_string(f_body, Vector2(card.position.x, cy0 + 486.0), ("ETO vous laisse le choix." if eto else "E.N.O.S. vous laisse le choix."), HORIZONTAL_ALIGNMENT_CENTER, card.size.x, 25, _fa(P("dec_sub"), k))
	var labels := ["CONTINUER", "ANNULER LE COUP"]
	var subs := ["garder cette erreur", "reprendre (takeback)"]
	var rects := _decision_rects()
	var mp := get_local_mouse_position()
	for i in 2:
		var r: Rect2 = rects[i]
		var hot := r.has_point(mp)
		var rr := Rect2(r.position + Vector2(0, -4 if hot else 0), r.size)
		var col: Color = P("dec_c0") if i == 0 else (P("dec_c1") if not dark else Color(0.10, 0.80, 0.86))
		if i == 0:
			col = ink if not dark else Color(1.0, 0.45, 0.50)
		if i == 1:                                                                  # bouton principal : plein
			_sbox(n, rr, _fa(col.lightened(0.12) if hot else col, k), 22.0, Color(0, 0, 0, 0), 0, Color(col.r, col.g, col.b, 0.40 * k), 18 if hot else 10, Vector2(0, 6))
			var tc := Color(0.02, 0.05, 0.08) if dark else Color(1, 1, 1)
			n.draw_string(f_head, Vector2(rr.position.x, rr.position.y + 44.0), labels[i], HORIZONTAL_ALIGNMENT_CENTER, rr.size.x, 26, _fa(tc, k))
			n.draw_string(f_body, Vector2(rr.position.x, rr.position.y + 74.0), subs[i], HORIZONTAL_ALIGNMENT_CENTER, rr.size.x, 18, _fa(tc, k * 0.78))
		else:                                                                       # bouton secondaire : contour
			_sbox(n, rr, _fa(Color(col.r, col.g, col.b, 0.16 if hot else 0.05), k), 22.0, _fa(col, k * (1.0 if hot else 0.75)), 3)
			n.draw_string(f_head, Vector2(rr.position.x, rr.position.y + 44.0), labels[i], HORIZONTAL_ALIGNMENT_CENTER, rr.size.x, 26, _fa(col, k))
			n.draw_string(f_body, Vector2(rr.position.x, rr.position.y + 74.0), subs[i], HORIZONTAL_ALIGNMENT_CENTER, rr.size.x, 18, _fa(col, k * 0.75))
	n.draw_string(f_body, Vector2(card.position.x, card.end.y - 30.0), "Le jeu est en pause tant que vous n'avez pas choisi.", HORIZONTAL_ALIGNMENT_CENTER, card.size.x, 18, _fa(P("dec_hint"), k))
	n.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


func _decision_click(pos: Vector2) -> void:
	var rects := _decision_rects()
	var choice := ""
	if (rects[0] as Rect2).has_point(pos):
		choice = "continue"
	elif (rects[1] as Rect2).has_point(pos):
		choice = "takeback"
	if choice == "":
		return
	hide_decision()
	awaiting = true
	sfx("select")
	_send({"t": "decision", "choice": choice})


func _winpct(cp: int) -> float:
	var c := clampf(float(cp), -2000.0, 2000.0)
	return 0.5 + 0.5 * (2.0 / (1.0 + exp(-0.00368208 * c)) - 1.0)


func _entrance(p: Sprite2D, delay: float) -> void:
	p.modulate.a = 0.0
	var target := p.scale
	p.scale = target * 0.2
	var tw := create_tween().set_parallel(true)
	tw.tween_property(p, "modulate:a", 1.0, 0.25).set_delay(delay)
	tw.tween_property(p, "scale", target, 0.45).set_delay(delay).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


# ----------------------------------------------------------------------------- dessin
func _draw() -> void:
	if vt != null and vt.active:                                                       # plateau thématique (ColorRect shader, en dessous) : on laisse un trou dans le fond
		draw_rect(Rect2(0, 0, VIEW.x, BAR), P("bg"))
		draw_rect(Rect2(0, BAR, BX, VIEW.y - BAR), P("bg"))
	else:
		draw_rect(Rect2(0, 0, VIEW.x, VIEW.y), P("bg"))
	draw_rect(Rect2(0, 0, VIEW.x, BAR), P("bar"))                                       # bandeau du boss
	if boss_layout:                                                                  # bande des challengers sous le plateau
		draw_rect(Rect2(0, BAR + BOARD, VIEW.x, STRIP), P("bar"))
		draw_line(Vector2(0, BAR + BOARD + 1.0), Vector2(VIEW.x, BAR + BOARD + 1.0), P("edge"), 2.0)
	for i in 14:                                                                       # lignes de circuit discrètes
		var y := 14.0 + i * 16.0
		draw_line(Vector2(BAR + 10.0, y), Vector2(VIEW.x - 12.0, y), P("line"), 1.0)
	draw_line(Vector2(0, BAR - 1.0), Vector2(VIEW.x, BAR - 1.0), P("edge"), 2.0)
	var bt: Texture2D = board_skin if (board_skin != null and not titans) else (theme_board if theme_board != null else board_tex)
	if bt and not (vt != null and vt.active):
		draw_texture_rect(bt, Rect2(BX, BAR, BOARD, BOARD), false)
	if eto:
		draw_rect(Rect2(BX - 3.0, BAR - 3.0, BOARD + 6.0, BOARD + 6.0), Color(0.04, 0.07, 0.13, 1.0), false, 6.0)      # cadre noir : bleu, blanc et noir
	_draw_eval_bar()
	_draw_side_tags()
	var cell := Vector2(SQ, SQ)
	if last.length() >= 4:
		for s in [last.substr(0, 2), last.substr(2, 2)]:
			draw_rect(Rect2(sq_center(s) - cell / 2.0, cell), P("hl"))
	if in_check:
		var king := "K" if turn == "w" else "k"
		for s in pieces:
			if pieces[s].get_meta("code") == king:
				draw_rect(Rect2(sq_center(s) - cell / 2.0, cell), Color(P("chk"), 0.35 + 0.3 * check_a))
	if selected != "":
		var r := Rect2(sq_center(selected) - cell / 2.0, cell)
		draw_rect(r, P("selfill"))
		draw_rect(r.grow(-2.0), P("selline"), false, 3.0)
		for t in legal.get(selected, []):
			var c := sq_center(t)
			if pieces.has(t):
				draw_arc(c, SQ * 0.43, 0.0, TAU, 48, P("atk"), 5.0, true)
			else:
				draw_circle(c, 15.0, P("tgta"))
				draw_circle(c, 9.0, P("tgtb"))
	var font := ThemeDB.fallback_font
	for i in 8:
		var fs := char(97 + (i if me == "w" else 7 - i))
		var rs := str((8 - i) if me == "w" else (i + 1))
		draw_string(font, Vector2(BX + i * SQ + SQ - 20.0, BAR + BOARD - 8.0), fs, HORIZONTAL_ALIGNMENT_LEFT, -1, 20, P("coord"))
		draw_string(font, Vector2(BX + 8.0, BAR + i * SQ + 26.0), rs, HORIZONTAL_ALIGNMENT_LEFT, -1, 20, P("coord"))


func _draw_side_tags() -> void:
	## QUI TIENT QUELLE COULEUR : deux étiquettes verticales à gauche du plateau (camp du haut / camp du bas), pastille blanche ou noire + nom.
	if side_names.is_empty():
		return
	_ensure_fonts()
	var font: Font = f_small
	var top_c := "b" if me == "w" else "w"
	for k in 2:
		var col := top_c if k == 0 else me
		var nm := String(side_names.get(col, "")) + "  " + ("BLANCS" if col == "w" else "NOIRS")
		var sz := 22
		var wd := font.get_string_size(nm, HORIZONTAL_ALIGNMENT_LEFT, -1, sz).x
		var cx := 28.0                                                         # centre de la colonne de la jauge
		var hh := wd + 58.0
		var y1 := (BAR + 14.0 + hh) if k == 0 else (BAR + BOARD - 14.0)        # bas de l'étiquette
		var plate := Rect2(cx - 22.0, y1 - hh, 44.0, hh)
		draw_rect(plate, Color(0.02, 0.02, 0.05, 0.78))
		draw_rect(plate, Color(1, 1, 1, 0.4), false, 2.0)
		var chip := Rect2(cx - 11.0, y1 - 34.0, 22.0, 22.0)                    # pastille de couleur du camp
		draw_rect(chip, Color(1, 1, 1) if col == "w" else Color(0.04, 0.04, 0.06))
		draw_rect(chip, Color(0.5, 0.5, 0.55) if col == "w" else Color(0.9, 0.9, 1.0), false, 2.0)
		draw_set_transform(Vector2(cx + 8.0, y1 - 44.0), -PI / 2.0, Vector2.ONE)   # texte vertical, lu de bas en haut
		draw_string_outline(font, Vector2.ZERO, nm, HORIZONTAL_ALIGNMENT_LEFT, -1, sz, 5, Color(0, 0, 0, 0.9))
		draw_string(font, Vector2.ZERO, nm, HORIZONTAL_ALIGNMENT_LEFT, -1, sz, Color(1, 1, 1) if col == "w" else Color(0.85, 0.9, 1.0))
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


func _draw_eval_bar() -> void:
	# jauge verticale façon Stockfish : les Blancs en clair, les Noirs en sombre ; le côté des Blancs suit l'orientation du plateau
	var x := 11.0
	var w := 34.0
	var h := BOARD
	draw_rect(Rect2(x - 3.0, BAR - 3.0, w + 6.0, h + 6.0), P("ev_frame"))
	draw_rect(Rect2(x, BAR, w, h), P("ev_bg"))
	var wh := h * eval_disp
	var wy := BAR + h - wh if me == "w" else BAR
	draw_rect(Rect2(x, wy, w, wh), P("ev_fill"))
	for i in range(1, 10):                                                           # graduations tous les 10 %
		var ty := BAR + h * i / 10.0
		draw_line(Vector2(x, ty), Vector2(x + (14.0 if i == 5 else 7.0), ty), Color(P("ev_tick"), 0.8 if i == 5 else 0.45), 2.0 if i == 5 else 1.0)
	var mate := absi(eval_cp) >= 9000
	var txt := "#" if mate else ("%+.1f" % (eval_cp / 100.0))
	var white_ahead := eval_cp >= 0
	var at_bottom := (me == "w") == white_ahead                                      # le texte se place à l'extrémité du camp qui domine
	var ty2 := BAR + h * 0.5 + 6.0                                                   # valeur au CENTRE de la jauge (les étiquettes de camp occupent les extrémités)
	draw_rect(Rect2(x - 3.0, ty2 - 17.0, w + 6.0, 24.0), Color(0.02, 0.02, 0.05, 0.8))
	draw_string(ThemeDB.fallback_font, Vector2(x - 3.0, ty2), txt, HORIZONTAL_ALIGNMENT_CENTER, w + 6.0, 14, Color(1, 1, 1))


func _draw_badge() -> void:
	if badge_sq == "" or badge_s <= 0.01 or not BADGE.has(badge_key):
		return
	var c := sq_center(badge_sq) + Vector2(SQ * 0.34, -SQ * 0.34)                    # coin supérieur droit de la case d'arrivée
	var r := 22.0 * badge_s
	var col: Color = BADGE[badge_key]
	if badge_tex.has(badge_key):                                                     # vraie icône (Brillant, Gaffe, Livre…)
		badge_node.draw_circle(c + Vector2(0.0, 3.0), r + 2.0, Color(0, 0, 0, 0.45))
		badge_node.draw_texture_rect(badge_tex[badge_key], Rect2(c - Vector2(r, r), Vector2(r, r) * 2.0), false)
		return
	badge_node.draw_circle(c + Vector2(0.0, 3.0), r + 3.0, Color(0, 0, 0, 0.5))
	badge_node.draw_circle(c, r + 2.5, Color(1, 1, 1, 0.96))
	badge_node.draw_circle(c, r, col)
	var white := Color(1, 1, 1, 1)
	match badge_key:
		"best":                                                                          # étoile
			var pts := PackedVector2Array()
			for i in 10:
				var rr := r * (0.68 if i % 2 == 0 else 0.30)
				pts.append(c + Vector2.from_angle(-PI / 2.0 + i * PI / 5.0) * rr)
			badge_node.draw_colored_polygon(pts, white)
		"good":                                                                          # coche
			badge_node.draw_polyline(PackedVector2Array([c + Vector2(-0.42, 0.02) * r * 1.4, c + Vector2(-0.1, 0.34) * r * 1.4, c + Vector2(0.45, -0.3) * r * 1.4]), white, 4.0 * badge_s, true)
		_:
			var t: String = {"brilliant": "!!", "excellent": "!", "inaccuracy": "?!", "mistake": "?", "blunder": "??"}.get(badge_key, "")
			var fs := int(24.0 * badge_s)
			var font := ThemeDB.fallback_font
			var sz := font.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
			badge_node.draw_string(font, c + Vector2(-sz.x / 2.0, fs * 0.34), t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, white)


func set_badge(sq: String, key: String) -> void:
	badge_sq = sq
	badge_key = key
	badge_s = 0.0
	var tw := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_method(func(v: float) -> void:
		badge_s = v
		badge_node.queue_redraw(), 0.0, 1.0, 0.32)
	if key == "blunder":
		shockwave(sq_center(sq), RED, 1.0)


func clear_badge() -> void:
	badge_sq = ""
	badge_node.queue_redraw()


var _fahh_at := -10.0
const FAHH_DB := {"fahh1": 9.0, "fahh2": -0.5}              # niveaux alignés : « fahhhhh-3 » est ~3x plus faible que « fahhh-slowed »


func _fahh() -> void:
	## Son de GAFFE : l'un des deux « FAHH » au hasard (anti-doublon : la gaffe et la fenêtre de décision le déclenchent au même moment).
	var now := Time.get_ticks_msec() / 1000.0
	if now - _fahh_at < 2.0:
		return
	_fahh_at = now
	var name: String = ["fahh1", "fahh2"].pick_random()
	var p: AudioStreamPlayer = players.get(name)
	if p == null or p.stream == null:
		sfx("blunder", 0.9, 2.0)                                # repli : fichier absent
		return
	p.pitch_scale = 1.0
	p.volume_db = float(FAHH_DB[name])
	p.play()


func _quality_sfx(key: String, code: String) -> void:
	# sons de jugement : uniquement pour les coups du JOUEUR (E.N.O.S. joue « meilleur coup » en permanence)
	if code == "" or (code == code.to_upper()) != (me == "w"):
		return
	var name := ""
	match key:
		"mistake": name = "mistake"
		"blunder": name = "fahh"                                       # coup catastrophique : le « FAHH » remplace l'ancien son
	if name == "fahh":
		get_tree().create_timer(0.12).timeout.connect(_fahh)
	elif name != "":
		get_tree().create_timer(0.12).timeout.connect(func() -> void: sfx(name, 1.0, 2.0))


func _process(dt: float) -> void:
	if banner_t >= 0.0:
		banner_t += dt
		if banner_t > BANNER_DUR:
			banner_t = -1.0
		banner_node.queue_redraw()
	if not decision.is_empty():
		dec_t += dt
		decision_node.queue_redraw()                                                   # survol des boutons + animation d'entrée
	if absf(eval_disp - eval_goal) > 0.0008:
		eval_disp = lerpf(eval_disp, eval_goal, clampf(dt * 5.0, 0.0, 1.0))
		queue_redraw()
	# caméra : tremblement + coup de zoom autour du centre
	var off := Vector2.ZERO
	if shake > 0.2:
		off = Vector2(randf_range(-shake, shake), randf_range(-shake, shake))
		shake *= 0.86
	scale = Vector2(zoom, zoom) * lay
	position = off + VIEW / 2.0 * (1.0 - zoom) + lay_pos * zoom
	if boss_layout:
		boss_hdr.queue_redraw()
		boss_deco.queue_redraw()
		_boss_dim()
	# œil : regard (souris ou dernier coup), parole, éblouissement
	if eye_look_hold > 0.0:
		eye_look_hold -= dt
	else:
		var m := get_local_mouse_position() - (eye.position + eye.size / 2.0)
		eye_look_target = (m / 500.0).limit_length(1.0)
	eye_look = eye_look.lerp(eye_look_target, clampf(dt * 6.0, 0.0, 1.0))
	var speak_goal := (0.55 + 0.45 * absf(sin(Time.get_ticks_msec() / 70.0))) if sub_active else 0.0
	eye_speak = lerpf(eye_speak, speak_goal, clampf(dt * 10.0, 0.0, 1.0))
	eye_flare = maxf(0.0, eye_flare - dt * 1.8)
	eye_mat.set_shader_parameter("speak", eye_speak)
	eye_mat.set_shader_parameter("flare", eye_flare)
	eye_mat.set_shader_parameter("look", eye_look)
	eye_mat.set_shader_parameter("mood", clampf(0.25 + 0.5 * eye_speak + 0.6 * eye_flare, 0.0, 1.0))
	if eto:                                                              # ETO : le visage suit la souris, parle avec les sous-titres, s'inquiète devant une gaffe
		eto_face.follow = eye_look
		eto_face.speaking = sub_active
		var want := "smile"                                                  # sourire en coin, regard mi-clos : l'attitude par défaut d'ETO
		if sub_active:
			want = "speaking"
		elif not decision.is_empty():
			want = "sassy"
		elif in_check and turn == me:
			want = "focused"
		if want != eto_face.base_name and selftest_dir == "":
			eto_face.set_expression(want)
		eto_face.tick(dt)
	# sous-titres : machine à écrire, maintien, extinction
	if sub_active:
		sub_t += dt
		sub_label.visible_characters = int(sub_len * clampf(sub_t / sub_dur, 0.0, 1.0))
		if sub_t >= sub_dur:
			sub_active = false
			sub_hold = 3.5
	elif sub_hold > 0.0:
		sub_hold -= dt
		if sub_hold <= 0.0:
			sub_tag.text = _name() + "  //  EN ATTENTE"
	# éclats de pixels
	for f in frags.duplicate():
		var n: ColorRect = f["n"]
		f["t"] += dt
		f["v"].y += 1500.0 * dt
		n.position += f["v"] * dt
		n.modulate.a = clampf(1.0 - f["t"] / f["life"], 0.0, 1.0)
		if f["t"] >= f["life"]:
			n.queue_free()
			frags.erase(f)
	if in_check:
		check_a = 0.5 + 0.5 * sin(Time.get_ticks_msec() / 160.0)
		queue_redraw()
	if not arrows.is_empty():                                            # flèches : apparition fluide, puis disparition à la fin de l'explication
		arrow_clock += dt
		arrow_hold -= dt
		if arrow_hold <= 0.0:
			clear_arrows()
		else:
			arrow_node.queue_redraw()
	if selftest_dir == "":
		_net()


# ----------------------------------------------------------------------------- sous-titres / œil
func show_subtitle(text: String, kind := "normal", ms := 0, tags: Array = []) -> void:
	print("ENOS_SAY ", kind, " | ", text)
	var col: String = KIND_COLOR_ETO.get(kind, "#14260c") if eto else KIND_COLOR.get(kind, "#ffdadd")
	sub_label.text = "[color=%s]%s[/color]" % [col, text.replace("[", "(")]
	sub_len = text.length()
	sub_label.visible_characters = 0
	sub_t = 0.0
	sub_dur = clampf(float(ms) / 1000.0 if ms > 0 else 0.5 + sub_len * 0.062, 0.8, 14.0)
	sub_active = true
	sub_hold = 0.0
	if eto:
		sub_tag.text = "ETO  //  %s" % {"blunder": "PETITE ERREUR", "brilliant": "BRAVO", "victory": "BELLE PARTIE", "defeat": "BIEN JOUÉ", "opening": "OUVERTURE"}.get(kind, "EN DISCUSSION")
		var names: Array = []
		for tg in tags:
			if TAG_FACE.has(String(tg)):
				names.append(TAG_FACE[String(tg)])
		if names.is_empty() and KIND_FACE.has(kind):
			names.append(KIND_FACE[kind])
		for i in names.size():
			get_tree().create_timer(i * 1.4).timeout.connect(func() -> void: eto_face.react(String(names[i]), 1.9))
	else:
		sub_tag.text = "E.N.O.S.  //  %s" % {"blunder": "ERREUR DÉTECTÉE", "brilliant": "ANOMALIE", "victory": "VERDICT", "defeat": "ERREUR CRITIQUE",
				"opening": "ANALYSE D'OUVERTURE"}.get(kind, "TRANSMISSION")
	if kind == "victory" or kind == "defeat":
		eye_flare = 1.0


func P(k: String) -> Color:
	return (PAL_ETO if eto else PAL_ENOS)[k]


func _name() -> String:
	return "ETO" if eto else "E.N.O.S."


func set_persona(p: String) -> void:
	## Bascule E.N.O.S. <-> ETO : plateau, bandeau, sous-titres, jauge, pièces (teinte), œil <-> visage.
	eto = p == "eto"
	if eye == null or eto_wrap == null:
		return
	if not boss_layout:                                                  # mode boss : les avatars du bas ne changent pas de place
		eye.visible = not eto and not boss_on
		eto_wrap.visible = eto and not boss_on
	if ov_rect != null and not titans:
		ov_rect.visible = not eto
	if board_tex_enos != null and not titans:
		board_tex = board_tex_eto if (eto and board_tex_eto != null) else board_tex_enos
	if sub_box != null:
		if eto:
			sub_box.bg_color = Color(1.0, 1.0, 1.0, 0.96)
			sub_box.border_color = Color(0.52, 0.85, 0.18, 0.95)
			sub_box.shadow_color = Color(0.40, 0.80, 0.05, 0.25)
			sub_box.set_corner_radius_all(22)
			sub_tag.add_theme_font_override("font", ui_font if ui_font != null else _mono())
			sub_tag.add_theme_color_override("font_color", Color(0.30, 0.62, 0.02, 0.9))
			sub_label.add_theme_font_override("normal_font", ui_font if ui_font != null else _mono())
			sub_label.add_theme_font_size_override("normal_font_size", 31)
			sub_label.add_theme_color_override("default_color", Color(0.07, 0.13, 0.04))
			banner_label.add_theme_color_override("font_color", Color("4fb000"))
			banner_label.add_theme_color_override("font_outline_color", Color(1, 1, 1, 1))
		else:
			sub_box.bg_color = Color(0.04, 0.008, 0.014, 0.93)
			sub_box.border_color = Color(0.95, 0.12, 0.2, 0.95)
			sub_box.shadow_color = Color(1.0, 0.1, 0.15, 0.38)
			sub_box.set_corner_radius_all(2)
			sub_tag.add_theme_font_override("font", _mono())
			sub_tag.add_theme_color_override("font_color", Color(1.0, 0.25, 0.32, 0.9))
			sub_label.add_theme_font_override("normal_font", _mono())
			sub_label.add_theme_font_size_override("normal_font_size", 29)
			sub_label.add_theme_color_override("default_color", Color(1.0, 0.86, 0.88))
			banner_label.add_theme_color_override("font_color", Color(1.0, 0.2, 0.25))
			banner_label.add_theme_color_override("font_outline_color", Color(0, 0, 0, 1))
		sub_tag.text = _name() + "  //  EN ATTENTE"
	if not titans:
		load_theme(theme_cfg)                                                # (Titans : pièces et plateau ne bougent pas quand la parole change de camp)
	queue_redraw()


const BANNER_DUR := 4.8                                  # durée du bandeau de fin de partie
const BFX_DUR := 3.2                                  # durée de l'effet « coup brillant » (secondes)
const BFX_BLUE := Color(0.10, 0.62, 0.92)              # bleu « brillant » : remplissage de la case et vague sur les cases de même couleur
var quiet_move := false                               # vrai pendant un coup qui joue déjà son propre son (échec, mat, promotion)
var _fork_cache: Dictionary = {}                      # cases attaquées par la pièce qui vient d'arriver (calculé à l'atterrissage)
var _sw_tween: Tween
var _bfx_font: SystemFont                              # police en cache (recréer une SystemFont à chaque dessin corrompt les glyphes)
var _bfx_box: StyleBoxFlat


func brilliant_fx(to_sq: String) -> void:
	## COUP BRILLANT (!!) : 1) la case d'arrivée se remplit ENTIÈREMENT de bleu ; 2) toutes les cases de la même couleur s'illuminent en bleu
	## en partant d'elle, comme une onde de choc ; 3) « Brillant ! » apparaît sur la case puis monte dans le coin supérieur droit, à côté de l'icône « !! ».
	## Fourchette : un rayon part vers chaque pièce attaquée. Son « brilliant » + « shockwave » joués en même temps que le début de l'animation.
	if to_sq.length() != 2 or layer_fx == null:
		return
	var targets: Array = _fork_cache.get("targets", []) if _fork_cache.get("sq", "") == to_sq else _fork_targets(to_sq)
	var tcs: Array = []
	for t in targets:
		tcs.append(sq_center(String(t)))
	var c := sq_center(to_sq)
	var tf := to_sq.unicode_at(0) - 97
	var tr := to_sq.unicode_at(1) - 49
	var wave: Array = []                                                            # cases de la même couleur : [centre, retard] (retard = distance au centre de l'onde)
	for f in 8:
		for r in 8:
			if (f + r) % 2 == (tf + tr) % 2 and not (f == tf and r == tr):
				var sc := sq_center(char(97 + f) + str(r + 1))
				wave.append([sc, c.distance_to(sc) / SQ * 0.085])
	var d := {"c": c, "t": 0.0, "cols": _bfx_cols(), "targets": tcs, "seed": float(hash(to_sq) % 997), "wave": wave}
	var under := Node2D.new()                                                       # sous les pièces : remplissage et vague (z absolu 0 ; les pièces sont à z >= 1)
	under.z_as_relative = false
	under.z_index = 0
	layer_fx.add_child(under)
	under.draw.connect(func() -> void: _bfx_draw_under(under, d))
	var over := Node2D.new()                                                        # au-dessus : ondes, halo, rayons, étincelles, étiquette
	over.z_index = 100
	layer_fx.add_child(over)
	over.draw.connect(func() -> void: _bfx_draw(over, d))
	var tw := create_tween()
	tw.tween_method(func(v: float) -> void:
		d["t"] = v
		under.queue_redraw()
		over.queue_redraw(), 0.0, BFX_DUR, BFX_DUR)
	tw.tween_callback(under.queue_free)
	tw.tween_callback(over.queue_free)
	_brilliant_audio()                                                              # même image que le premier tour de l'animation : son et visuel sont synchronisés
	shake = 10.0 + 3.0 * tcs.size()
	eye_flare = 1.6
	zoom_punch(1.025)
	var hc: Dictionary = d["cols"]
	flash(0.14, hc["hot"])
	if eto and eto_face != null:
		eto_face.react("smug" if not tcs.is_empty() else "impressed", 2.4)


func _brilliant_audio() -> void:
	## Mixage : l'ancien « brilliant » (+4 dB) et le « shockwave » (-12 dB : il est ~8x plus fort) partent EXACTEMENT ensemble.
	## Le shockwave dure 16 s : son pic est à t = 0,05 s (calé sur l'éclat visuel), sa traîne est coupée en fondu après ~2,6 s.
	sfx("brilliant", 1.0, 4.0)
	var p: AudioStreamPlayer = players.get("shockwave")
	if p == null or p.stream == null:
		return
	if _sw_tween != null and _sw_tween.is_valid():
		_sw_tween.kill()
	p.pitch_scale = 1.0
	p.volume_db = -12.0
	p.play()
	_sw_tween = create_tween()
	_sw_tween.tween_interval(2.6)
	_sw_tween.tween_property(p, "volume_db", -60.0, 2.0)
	_sw_tween.tween_callback(p.stop)


func _bfx_cols() -> Dictionary:
	# bleu « brillant » pour les deux personnalités ; ETO (plateau clair) ajoute un contour marine pour rester lisible
	return {"core": Color(0.10, 0.66, 0.96), "glow": Color(0.10, 0.55, 1.0), "hot": Color(0.90, 0.98, 1.0),
			"edge": Color(0.0, 0.10, 0.30, 0.80) if eto else Color(0.0, 0.0, 0.0, 0.0)}


func _eo(x: float) -> float:
	return 1.0 - pow(1.0 - clampf(x, 0.0, 1.0), 3.0)


func _bfx_rect_glow(n: Node2D, c: Vector2, half: float, a: float, col: Dictionary) -> void:
	## Contour de case net, avec halo : traits superposés (large et doux -> fin et blanc).
	if a <= 0.01:
		return
	var r := Rect2(c - Vector2(half, half), Vector2(half, half) * 2.0)
	n.draw_rect(r, Color(col["glow"], 0.10 * a), false, 26.0, true)
	n.draw_rect(r, Color(col["glow"], 0.22 * a), false, 13.0, true)
	n.draw_rect(r, Color(col["edge"], col["edge"].a * a), false, 9.0, true)
	n.draw_rect(r, Color(col["core"], 0.95 * a), false, 5.0, true)
	n.draw_rect(r, Color(col["hot"], 0.90 * a), false, 1.8, true)


func _bfx_ring(n: Node2D, c: Vector2, r: float, a: float, w: float, col: Dictionary) -> void:
	if a <= 0.01:
		return
	n.draw_arc(c, r, 0.0, TAU, 110, Color(col["glow"], a * 0.16), w * 3.4, true)
	n.draw_arc(c, r, 0.0, TAU, 110, Color(col["glow"], a * 0.34), w * 1.9, true)
	n.draw_arc(c, r, 0.0, TAU, 110, Color(col["edge"], col["edge"].a * a), w + 4.0, true)
	n.draw_arc(c, r, 0.0, TAU, 110, Color(col["core"], a), w, true)
	n.draw_arc(c, r, 0.0, TAU, 110, Color(col["hot"], a * 0.9), maxf(1.2, w * 0.35), true)


func _bfx_draw_under(n: Node2D, d: Dictionary) -> void:
	## Sous les pièces : case d'arrivée ENTIÈREMENT bleue, puis vague bleue sur toutes les cases de même couleur.
	var T: float = d["t"]
	var c: Vector2 = d["c"]
	var fa := clampf(T / 0.10, 0.0, 1.0) * (1.0 - smoothstep(2.3, 3.1, T))                # plein en 0,1 s, tenu, puis s'éteint
	if fa > 0.01:
		n.draw_rect(Rect2(c - Vector2(SQ, SQ) / 2.0, Vector2(SQ, SQ)), Color(BFX_BLUE, 0.88 * fa))
	for w in d["wave"]:
		var u := (T - float(w[1])) / 0.80
		if u > 0.0 and u < 1.0:
			var a := pow(sin(PI * u), 1.3) * 0.62
			n.draw_rect(Rect2((w[0] as Vector2) - Vector2(SQ, SQ) / 2.0, Vector2(SQ, SQ)), Color(BFX_BLUE, a))


func _bfx_label(n: Node2D, d: Dictionary) -> void:
	## « Brillant ! » : surgit au centre de la case, puis glisse dans son coin supérieur droit, à côté de l'icône « !! ».
	var T: float = d["t"]
	var c: Vector2 = d["c"]
	if _bfx_font == null:
		_bfx_font = SystemFont.new()
		_bfx_font.font_names = PackedStringArray(["Segoe UI Variable Text", "Segoe UI", "Arial"])
		_bfx_font.font_weight = 800
		_bfx_box = StyleBoxFlat.new()
		_bfx_box.bg_color = Color(1, 1, 1, 0.98)
		_bfx_box.set_corner_radius_all(40)
	var txt := "Brillant !"
	var fs := 30
	var sz := _bfx_font.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
	var box := sz + Vector2(34.0, 18.0)
	var pop := clampf((T - 0.12) / 0.26, 0.0, 1.0)
	if pop <= 0.0:
		return
	var move := smoothstep(0.0, 1.0, clampf((T - 1.0) / 0.55, 0.0, 1.0))
	var badge_c := c + Vector2(SQ * 0.34, -SQ * 0.34)
	var anchor := Vector2(badge_c.x - 22.0 - 10.0 - box.x * 0.78 / 2.0, badge_c.y)
	var pos := c.lerp(anchor, move)
	var sc := lerpf(0.5 + 0.7 * _eo(pop), 0.78, move)
	var alpha := pop * (1.0 - smoothstep(2.8, 3.2, T))
	n.draw_set_transform(pos, 0.0, Vector2(sc, sc))
	var sh := _bfx_box.duplicate() as StyleBoxFlat
	sh.bg_color = Color(0, 0.1, 0.25, 0.28 * alpha)
	n.draw_style_box(sh, Rect2(-box / 2.0 + Vector2(0, 5), box))
	var bx := _bfx_box.duplicate() as StyleBoxFlat
	bx.bg_color = Color(1, 1, 1, 0.98 * alpha)
	n.draw_style_box(bx, Rect2(-box / 2.0, box))
	n.draw_string(_bfx_font, Vector2(-sz.x / 2.0, fs * 0.36), txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(0.05, 0.50, 0.78, alpha))
	n.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


func _bfx_draw(n: Node2D, d: Dictionary) -> void:
	var T: float = d["t"]
	var c: Vector2 = d["c"]
	var col: Dictionary = d["cols"]
	var fade := 1.0 - smoothstep(1.0, 2.0, T)
	# 1) éclat central
	var fl := exp(-T * 7.5)
	if fl > 0.02:
		for k in 5:
			n.draw_circle(c, SQ * (0.20 + k * 0.17), Color(col["glow"], fl * 0.20 / (1.0 + k * 0.45)))
		n.draw_circle(c, SQ * 0.17, Color(col["hot"], fl * 0.95))
	# 2) deux ondes de choc nettes
	for ring in 2:
		var u := (T - ring * 0.16) / (0.95 - ring * 0.12)
		if u > 0.0 and u < 1.0:
			_bfx_ring(n, c, SQ * (0.32 + _eo(u) * (2.7 - ring * 0.8)), pow(1.0 - u, 1.5), lerpf(13.0, 2.0, u), col)
	# 3) halo de la case d'arrivée
	var pulse := 1.0 + 0.035 * sin(T * 17.0) * fade
	_bfx_rect_glow(n, c, SQ * 0.5 * pulse, clampf(T / 0.08, 0.0, 1.0) * fade, col)
	# 4) étincelles à quatre branches
	for i in 18:
		var r1 := fposmod(sin(float(i) * 12.9898 + float(d["seed"])) * 43758.5453, 1.0)
		var r2 := fposmod(sin(float(i) * 78.233 + float(d["seed"])) * 12543.7531, 1.0)
		var life := 0.7 + r2 * 0.6
		var u := T / life
		if u >= 1.0:
			continue
		var pos := c + Vector2.from_angle(r1 * TAU) * SQ * (0.35 + (0.7 + r2 * 1.3) * _eo(u))
		var sz := (5.0 + r2 * 9.0) * (1.0 - u)
		var a := 1.0 - u
		if sz < 0.8:
			continue
		n.draw_colored_polygon(PackedVector2Array([pos + Vector2(0, -sz * 1.8), pos + Vector2(sz * 0.4, 0), pos + Vector2(0, sz * 1.8), pos + Vector2(-sz * 0.4, 0)]), Color(col["hot"], a))
		n.draw_colored_polygon(PackedVector2Array([pos + Vector2(-sz * 1.8, 0), pos + Vector2(0, -sz * 0.4), pos + Vector2(sz * 1.8, 0), pos + Vector2(0, sz * 0.4)]), Color(col["hot"], a))
	# 5) FOURCHETTE : un rayon vers chaque pièce attaquée, puis ces cases s'illuminent à leur tour
	var tcs: Array = d["targets"]
	for idx in tcs.size():
		var tc: Vector2 = tcs[idx]
		var t0 := 0.10 + idx * 0.11
		var u := clampf((T - t0) / 0.30, 0.0, 1.0)
		if u <= 0.0:
			continue
		var head := c.lerp(tc, _eo(u))
		var ba := fade * (1.0 - 0.3 * u)
		n.draw_line(c, head, Color(col["glow"], 0.12 * ba), 22.0, true)
		n.draw_line(c, head, Color(col["glow"], 0.28 * ba), 11.0, true)
		n.draw_line(c, head, Color(col["edge"], col["edge"].a * ba), 8.5, true)
		n.draw_line(c, head, Color(col["core"], 0.95 * ba), 4.5, true)
		n.draw_line(c, head, Color(col["hot"], 0.9 * ba), 1.6, true)
		n.draw_circle(head, 11.0, Color(col["glow"], 0.45 * ba))
		n.draw_circle(head, 5.5, Color(col["hot"], ba))
		if u >= 1.0:
			var tt := T - (t0 + 0.30)
			var ha := clampf(tt / 0.07, 0.0, 1.0) * fade
			_bfx_rect_glow(n, tc, SQ * 0.5 * (1.0 + 0.03 * sin(tt * 17.0)), ha, col)
			var ru := tt / 0.65
			if ru > 0.0 and ru < 1.0:
				_bfx_ring(n, tc, SQ * (0.25 + _eo(ru) * 1.1), pow(1.0 - ru, 1.4), lerpf(8.0, 1.5, ru), col)
	_bfx_label(n, d)


const _KN := [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]
const _ORTH := [[1, 0], [-1, 0], [0, 1], [0, -1]]
const _DIAG := [[1, 1], [1, -1], [-1, 1], [-1, -1]]
const _VAL := {"p": 1, "n": 3, "b": 3, "r": 5, "q": 9, "k": 100}


func _fork_targets(sq: String) -> Array:
	## Cases des pièces ADVERSES de valeur >= 3 (ou du roi) attaquées par la pièce posée sur `sq`. Une fourchette = au moins deux d'entre elles.
	var p: Sprite2D = pieces.get(sq)
	if p == null:
		return []
	var code := String(p.get_meta("code"))
	var white := code == code.to_upper()
	var kind := code.to_lower()
	var f0 := sq.unicode_at(0) - 97
	var r0 := sq.unicode_at(1) - 49
	var dirs: Array = []
	var slide := false
	match kind:
		"n": dirs = _KN
		"k": dirs = _ORTH + _DIAG
		"p": dirs = [[-1, 1 if white else -1], [1, 1 if white else -1]]
		"b": dirs = _DIAG; slide = true
		"r": dirs = _ORTH; slide = true
		"q": dirs = _ORTH + _DIAG; slide = true
	var out: Array = []
	for dv in dirs:
		var f: int = f0
		var r: int = r0
		while true:
			f += int(dv[0])
			r += int(dv[1])
			if f < 0 or f > 7 or r < 0 or r > 7:
				break
			var t := char(97 + f) + str(r + 1)
			if pieces.has(t):
				var tc := String((pieces[t] as Sprite2D).get_meta("code"))
				if (tc == tc.to_upper()) != white and int(_VAL.get(tc.to_lower(), 0)) >= 3:
					out.append(t)
				break
			if not slide:
				break
	return out if out.size() >= 2 else []


func show_arrows(list: Array, secs := 6.0, append := false) -> void:
	## append = true : les flèches s'AJOUTENT à celles déjà affichées (ETO les fait apparaître au moment où il prononce le coup).
	if not append:
		arrows = []
	for a in list:
		if a is Dictionary and String(a.get("kind", "")) == "brilliant":
			continue                                                       # l'ancienne flèche dorée est remplacée par l'effet de la case (brilliant_fx)
		if a is Dictionary and String(a.get("from", "")).length() == 2 and String(a.get("to", "")).length() == 2:
			var b: Dictionary = (a as Dictionary).duplicate()
			b["t0"] = arrow_clock
			arrows.append(b)
	arrow_hold = maxf(arrow_hold, clampf(secs, 2.0, 20.0)) if append else clampf(secs, 2.0, 20.0)
	if arrow_node != null:
		arrow_node.queue_redraw()


func clear_arrows() -> void:
	arrows = []
	if arrow_node != null:
		arrow_node.queue_redraw()


func _is_knight_arrow(a: Dictionary) -> bool:
	## Flèche de cavalier : indiquée par le serveur (`knight`), ou géométrie en « L » + cavalier réellement posé sur la case de départ.
	if a.has("knight"):
		return bool(a["knight"])
	var f := String(a["from"])
	var t := String(a["to"])
	var df := absi(t.unicode_at(0) - f.unicode_at(0))
	var dr := absi(t.unicode_at(1) - f.unicode_at(1))
	if not ((df == 1 and dr == 2) or (df == 2 and dr == 1)):
		return false
	var pc: Variant = pieces.get(f)
	return pc != null and String((pc as Sprite2D).get_meta("code")).to_lower() == "n"


func _knight_corner(f: String, t: String) -> Vector2:
	## Coude de l'équerre : on avance de DEUX cases dans le sens long, puis d'une case de côté (comme sur chess.com / lichess).
	var df := absi(t.unicode_at(0) - f.unicode_at(0))
	if df == 2:
		return sq_center(String.chr(t.unicode_at(0)) + String.chr(f.unicode_at(1)))
	return sq_center(String.chr(f.unicode_at(0)) + String.chr(t.unicode_at(1)))


func _path_len(pts: PackedVector2Array) -> float:
	var l := 0.0
	for i in range(1, pts.size()):
		l += pts[i - 1].distance_to(pts[i])
	return l


func _path_at(pts: PackedVector2Array, d: float) -> Array:
	## Point et direction à la distance d le long de la polyligne.
	var left := d
	for i in range(1, pts.size()):
		var seg := pts[i].distance_to(pts[i - 1])
		var dir := (pts[i] - pts[i - 1]).normalized()
		if left <= seg or i == pts.size() - 1:
			return [pts[i - 1] + dir * minf(left, seg), dir]
		left -= seg
	return [pts[0], Vector2.RIGHT]


func _sub_path(pts: PackedVector2Array, d0: float, d1: float) -> PackedVector2Array:
	var out := PackedVector2Array()
	if d1 <= d0:
		return out
	out.append(_path_at(pts, d0)[0])
	var acc := 0.0
	for i in range(1, pts.size()):
		acc += pts[i - 1].distance_to(pts[i])
		if acc > d0 and acc < d1:
			out.append(pts[i])
	out.append(_path_at(pts, d1)[0])
	return out


func _draw_arrows() -> void:
	var n := arrow_node
	for i in arrows.size():
		var a: Dictionary = arrows[i]
		var p0 := sq_center(String(a["from"]))
		var p1 := sq_center(String(a["to"]))
		var age := arrow_clock - float(a.get("t0", 0.0))
		var at := minf(1.0, age * 2.6)                                    # progression d'apparition de CETTE flèche
		var k := clampf(at * 1.4, 0.0, 1.0)
		k = 1.0 - pow(1.0 - k, 3.0)
		if k <= 0.01:
			continue
		var col: Color = ARROW_COL.get(String(a.get("kind", "best")), ARROW_COL["best"])
		col.a = 0.86 * (0.82 + 0.18 * sin(Time.get_ticks_msec() / 220.0 + i))
		var pts := PackedVector2Array([p0, p1])
		if _is_knight_arrow(a):                                           # cavalier : flèche en équerre (deux segments), pas une diagonale directe
			pts = PackedVector2Array([p0, _knight_corner(String(a["from"]), String(a["to"])), p1])
		var total := _path_len(pts)
		var want := total * k
		var tp: Array = _path_at(pts, want)
		var tip: Vector2 = tp[0]
		var dir: Vector2 = tp[1]
		var base := tip - dir * 46.0
		var gold: bool = String(a.get("kind", "")) == "brilliant"
		var body := _sub_path(pts, 20.0, maxf(want - 46.0, 0.0))
		if body.size() >= 2:
			if gold:                                                       # coup brillant : halo doré, flèche plus épaisse
				n.draw_polyline(body, Color(1.0, 0.9, 0.4, 0.28), 44.0, true)
			n.draw_polyline(body, Color(col.r, col.g, col.b, col.a), 18.0, true)
			if pts.size() > 2 and want > _path_len(PackedVector2Array([pts[0], pts[1]])):      # coude arrondi : un disque comble l'angle de l'équerre
				n.draw_circle(pts[1], 9.0, Color(col.r, col.g, col.b, col.a))
		if gold:
			n.draw_colored_polygon(PackedVector2Array([tip + dir * 10.0, base - dir * 6.0 + dir.orthogonal() * 46.0, base - dir * 6.0 - dir.orthogonal() * 46.0]), Color(1.0, 0.9, 0.4, 0.28))
		n.draw_colored_polygon(PackedVector2Array([tip, base + dir.orthogonal() * (38.0 if gold else 30.0), base - dir.orthogonal() * (38.0 if gold else 30.0)]), col)
		n.draw_circle(p0, 13.0, Color(col.r, col.g, col.b, col.a))
		if gold and k > 0.85:                                            # « !! » sur la case d'arrivée, qui jaillit
			var pop := clampf((at - 0.55) * 3.0, 0.0, 1.0)
			var sz := int(30.0 + 56.0 * (1.0 - pow(1.0 - pop, 3.0)) + 4.0 * sin(Time.get_ticks_msec() / 90.0))
			var lp := p1 + Vector2(-SQ * 0.45, -SQ * 0.36)
			n.draw_string_outline(ThemeDB.fallback_font, lp, "!!", HORIZONTAL_ALIGNMENT_CENTER, SQ * 0.9, sz, 14, Color(0.25, 0.1, 0.0, 0.95))
			n.draw_string(ThemeDB.fallback_font, lp, "!!", HORIZONTAL_ALIGNMENT_CENTER, SQ * 0.9, sz, GOLD)


func eye_look_at(p: Vector2, hold := 1.0) -> void:
	eye_look_target = ((p - (eye.position + eye.size / 2.0)) / 600.0).limit_length(1.0)
	eye_look_hold = hold


func banner(text: String, sub := "", tag := "FIN DE PARTIE") -> void:
	## Bandeau de fin de partie : bande vitrée en travers du plateau, titre en grand, sous-titre, étiquette. Remplace l'ancien texte brut.
	banner_title = text
	banner_sub = sub
	banner_tag = tag
	banner_t = 0.0
	banner_node.queue_redraw()


func _banner_end(over_s: String) -> void:
	var title := over_s.to_upper()
	var sub := ""
	if over_s.begins_with("Échec et mat"):
		title = "ÉCHEC ET MAT"
		var wc := "b" if over_s.contains("Noirs") else "w"
		sub = "%s l'emporte" % String(side_names.get(wc, "Les Blancs" if wc == "w" else "Les Noirs"))
	elif over_s.begins_with("Abandon"):
		title = "ABANDON"
		sub = over_s.get_slice(":", 1).strip_edges()
		sub = sub.substr(0, 1).to_upper() + sub.substr(1)
	elif over_s.begins_with("Pat"):
		title = "PAT"
		sub = "Partie nulle"
	elif over_s.begins_with("Nulle"):
		title = "PARTIE NULLE"
		sub = "Aucun vainqueur"
	banner(title, sub)


func _draw_banner() -> void:
	if banner_t < 0.0:
		return
	_ensure_fonts()
	var n := banner_node
	var t := banner_t
	var k_in := _eo(t / 0.5)
	var k_out := 1.0 - smoothstep(BANNER_DUR - 0.9, BANNER_DUR, t)
	var dark := not eto
	var cy := BAR + BOARD / 2.0
	var h := 250.0 * k_in
	var band := Rect2(BX, cy - h / 2.0, BOARD, h)
	var bg := Color(0.025, 0.004, 0.01, 0.95) if dark else Color(1.0, 1.0, 1.0, 0.965)
	var accent: Color = P("dec_c1") if not dark else Color(1.0, 0.22, 0.28)
	var ink: Color = P("dec_text") if not dark else Color(1.0, 0.86, 0.88)
	n.draw_rect(Rect2(BX, BAR, BOARD, BOARD), Color(0, 0, 0, 0.35 * k_in * k_out))                    # le plateau s'assombrit derrière le bandeau
	_sbox(n, band, _fa(bg, k_out), 0.0, Color(0, 0, 0, 0), 0, Color(accent.r, accent.g, accent.b, 0.35 * k_out), 40, Vector2.ZERO)
	n.draw_rect(Rect2(band.position.x, band.position.y, band.size.x, 5.0), _fa(accent, k_out))        # liserés d'accent haut et bas
	n.draw_rect(Rect2(band.position.x, band.end.y - 5.0, band.size.x, 5.0), _fa(accent, k_out))
	var ta := clampf((k_in - 0.55) / 0.45, 0.0, 1.0) * k_out
	if ta <= 0.01:
		return
	var s := lerpf(1.22, 1.0, _eo(t / 0.55))
	var c := Vector2(BX + BOARD / 2.0, cy)
	n.draw_set_transform(c - c * s, 0.0, Vector2(s, s))
	n.draw_string(f_small, Vector2(BX, cy - 66.0), banner_tag, HORIZONTAL_ALIGNMENT_CENTER, BOARD, 20, _fa(P("dec_sub") if not dark else Color(1.0, 0.55, 0.60), ta * 0.85))
	n.draw_string(f_title, Vector2(BX, cy + 20.0), banner_title, HORIZONTAL_ALIGNMENT_CENTER, BOARD, 96, Color(0, 0, 0, 0.22 * ta))     # ombre
	n.draw_string(f_title, Vector2(BX, cy + 16.0), banner_title, HORIZONTAL_ALIGNMENT_CENTER, BOARD, 96, _fa(accent, ta))
	if banner_sub != "":
		n.draw_string(f_head, Vector2(BX, cy + 76.0), banner_sub, HORIZONTAL_ALIGNMENT_CENTER, BOARD, 36, _fa(ink, ta))
	n.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


# ----------------------------------------------------------------------------- réseau
func _net() -> void:
	var now := Time.get_ticks_msec() / 1000.0
	ws.poll()
	match ws.get_ready_state():
		WebSocketPeer.STATE_OPEN:
			if not was_open:
				was_open = true
				lost_since = -1.0
				_send({"t": "hello"})
			while ws.get_available_packet_count() > 0:
				var j: Variant = JSON.parse_string(ws.get_packet().get_string_from_utf8())
				if j is Dictionary:
					_handle(j)
			if now > ping_at:
				ping_at = now + 15.0
				_send({"t": "ping"})
		WebSocketPeer.STATE_CLOSED:
			if was_open:
				was_open = false
				lost_since = now
			if (lost_since > 0.0 and now - lost_since > 20.0) or (lost_since < 0.0 and now - started > 120.0):
				get_tree().quit()                                       # E.N.O.S. n'est plus là : ne jamais rester orphelin
			if now > retry_at:
				retry_at = now + 1.0
				ws = WebSocketPeer.new()
				ws.connect_to_url(url)


func _send(d: Dictionary) -> void:
	if ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
		ws.send_text(JSON.stringify(d))


func _handle(m: Dictionary) -> void:
	match m.get("t", ""):
		"embedded":
			visible = true
			sfx("start")
		"say":
			show_subtitle(String(m.get("text", "")), String(m.get("kind", "normal")), int(m.get("ms", 0)), m.get("tags", []))
		"sfx":
			sfx(String(m.get("name", "")))
		"theme":
			theme_cfg = String(m.get("name", "classic"))
			load_theme(theme_cfg)
		"boss":
			boss_show(String(m.get("text", "")), String(m.get("from", "")), String(m.get("to", "")))
		"boss_end":
			boss_hide()
		"board":
			set_board_skin(String(m.get("name", "")))
		"persona":
			set_persona(String(m.get("p", "enos")))
		"visual":                                                                  # thème visuel généré par E.N.O.S. (JSON assaini côté Python)
			var vcfg: Variant = m.get("cfg", {})
			if vcfg is Dictionary:
				if (vcfg as Dictionary).is_empty():
					vt.clear()
				else:
					vt.apply(vcfg, float(m.get("secs", 1.4)))
		"visual_mood":
			vt.set_anger(float(m.get("anger", 0.0)))
		"arrows":
			show_arrows(m.get("list", []), float(m.get("secs", 6.0)), bool(m.get("append", false)))
		"squares":
			study_node.call("show_squares", m.get("list", []), float(m.get("secs", 6.0)))
		"study":
			study_node.call("set_hud", m)
			_study_layout(bool(m.get("on", false)))
		"brilliant":
			var to_sq := String(m.get("to", ""))
			get_tree().create_timer(0.85).timeout.connect(func() -> void: brilliant_fx(to_sq))
		"state", "update", "undo":
			clear_arrows()
			study_node.call("clear_squares")
			queue.append(m)
			_pump()
		"error":
			awaiting = false
			pending_local = {}
			sfx("illegal")
			_send({"t": "hello"})


func _pump() -> void:
	if busy:
		return
	busy = true
	while queue.size() > 0:
		var m: Dictionary = queue.pop_front()
		if m["t"] == "state":
			selected = ""
			awaiting = false
			pending_local = {}
			apply_state(m["state"], true)
		elif m["t"] == "undo":
			await _run_undo(m)
		else:
			await _run_update(m)
	busy = false
	queue_redraw()
	if autoplay and not autoplayed and turn == me and legal.has("e2"):
		autoplayed = true
		await get_tree().create_timer(0.8).timeout
		_select("e2")
		await get_tree().create_timer(0.4).timeout
		_try_move("e2", "e4")


func _run_undo(m: Dictionary) -> void:
	# takeback : la pièce revient à sa case d'origine (vol inverse), puis le plateau se recale (une pièce prise réapparaît)
	hide_decision()
	var say: Variant = m.get("say")
	if say is Dictionary and not bool(say.get("voice", false)):
		show_subtitle(String(say.get("text", "")), String(say.get("kind", "normal")), 0, say.get("tags", []))
	var from: String = m.get("from", "")
	var to: String = m.get("to", "")
	if pieces.has(from) and to != "":
		var p: Sprite2D = pieces[from]
		pieces.erase(from)
		clear_badge()
		sfx("select")
		await fly(p, from, to, null, String(p.get_meta("code")).to_lower() == "n")
		pieces[to] = p
	pending_local = {}
	awaiting = false
	apply_state(m["state"])


func _run_update(m: Dictionary) -> void:
	var steps: Array = m.get("steps", [])
	var say: Variant = m.get("say")
	if say is Dictionary and not bool(say.get("voice", false)):         # réplique muette : sous-titre immédiat (les répliques parlées arrivent avec la voix)
		show_subtitle(String(say.get("text", "")), String(say.get("kind", "normal")), 0, say.get("tags", []))
	for i in steps.size():
		var st: Dictionary = steps[i]
		var skip: bool = i == 0 and not pending_local.is_empty() and pending_local.get("from") == st.get("from") and pending_local.get("to") == st.get("to")
		await animate_step(st, skip)
	pending_local = {}
	awaiting = false
	apply_state(m["state"])
	if over != "":
		_banner_end(str(over))
		if str(over).begins_with("Abandon"):
			sfx("defeat")
			eye_flare = 1.2


# ----------------------------------------------------------------------------- animation d'un coup
func animate_step(st: Dictionary, skip_main: bool) -> void:
	var from: String = st.get("from", "")
	var to: String = st.get("to", "")
	var cap: Variant = st.get("capture")
	var code := String(st.get("piece", ""))
	if not skip_main:
		var p: Sprite2D = pieces.get(from)
		if p == null:
			return
		pieces.erase(from)
		var victim: Sprite2D = null
		if cap is String and pieces.has(cap):
			victim = pieces[cap]
			pieces.erase(cap)
		last = from + to
		clear_badge()
		queue_redraw()
		eye_look_at(sq_center(to), 1.1)
		quiet_move = bool(st.get("check", false)) or bool(st.get("mate", false)) or st.get("promo") is String      # échec / mat / promotion : leur propre son remplace « move »
		await fly(p, from, to, victim, String(p.get_meta("code")).to_lower() == "n")
		quiet_move = false
		pieces[to] = p
		_fork_cache = {"sq": to, "targets": _fork_targets(to)}
		move_fx(from, to, String(p.get_meta("code")), victim != null)
	elif cap is String and cap != to and pieces.has(cap):               # prise en passant
		impact(sq_center(cap), 1.0, pieces[cap])
		pieces.erase(cap)
	var extra: Variant = st.get("extra")
	if extra is Dictionary and pieces.has(extra["from"]):               # roque : la tour suit le roi
		var rook: Sprite2D = pieces[extra["from"]]
		pieces.erase(extra["from"])
		sfx("castle")
		await fly(rook, extra["from"], extra["to"], null, false)
		pieces[extra["to"]] = rook
	var promo: Variant = st.get("promo")
	if promo is String and pieces.has(to):
		var old: Sprite2D = pieces[to]
		var oc := String(old.get_meta("code"))
		var np := String(promo).to_upper() if oc == oc.to_upper() else String(promo).to_lower()
		if np != oc:
			old.queue_free()
			pieces[to] = make_piece(np, to)
			shockwave(sq_center(to), CYAN, 0.9)
			sfx("promote")
	var qkey := String(st.get("quality", ""))
	if qkey != "" and BADGE.has(qkey):
		set_badge(to, qkey)
		_quality_sfx(qkey, code)
	if st.get("mate", false):
		mate_fx(code)
	elif st.get("check", false):
		sfx("check")
		eye_flare = maxf(eye_flare, 0.6)
		in_check = true
		turn = "b" if code == code.to_upper() else "w"

# ----------------------------------------------------------------------------- animations de case : une signature par type de pièce
func _later(delay: float, fn: Callable) -> void:
	get_tree().create_timer(delay, true, false, true).timeout.connect(fn)


func _trail(pts: PackedVector2Array, col: Color, width: float) -> void:
	## Traînée lumineuse qui s'estompe le long du trajet (équerre pour le cavalier).
	var ln := Line2D.new()
	ln.points = pts
	ln.width = width
	ln.default_color = col
	ln.joint_mode = Line2D.LINE_JOINT_ROUND
	ln.begin_cap_mode = Line2D.LINE_CAP_ROUND
	ln.end_cap_mode = Line2D.LINE_CAP_ROUND
	var cm := CanvasItemMaterial.new()
	cm.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	ln.material = cm
	layer_fx.add_child(ln)
	var tw := create_tween()
	tw.tween_property(ln, "modulate:a", 0.0, 0.6).from(1.0)
	tw.tween_callback(ln.queue_free)


func move_fx(from: String, to: String, code: String, captured: bool) -> void:
	## Animation de la case selon le coup :
	##  cavalier : traînée en équerre + onde au coude puis à l'arrivée · fou / tour : balayage case par case le long de la ligne ·
	##  dame : balayage + gerbe d'étincelles · roi : double halo doré · pion : petite onde (deux sur une poussée de deux cases).
	var kind := code.to_lower()
	var white := code == code.to_upper()
	var col: Color = CYAN if white else RED
	var a := sq_center(from)
	var b := sq_center(to)
	var df := to.unicode_at(0) - from.unicode_at(0)
	var dr := to.unicode_at(1) - from.unicode_at(1)
	var steps := maxi(absi(df), absi(dr))
	match kind:
		"n":
			var corner := _knight_corner(from, to)
			_trail(PackedVector2Array([a, corner, b]), Color(col.r, col.g, col.b, 0.75), 16.0)
			shockwave(corner, col, 0.32)
			if not captured:
				_later(0.12, func() -> void: shockwave(b, col, 0.85))
		"b", "r", "q":
			_trail(PackedVector2Array([a, b]), Color(col.r, col.g, col.b, 0.6), 14.0 if kind != "q" else 22.0)
			for i in range(1, steps + 1):
				var sq := String.chr(from.unicode_at(0) + signi(df) * i) + String.chr(from.unicode_at(1) + signi(dr) * i)
				var last_sq := i == steps
				if last_sq and captured:
					continue
				var c := sq_center(sq)
				_later(0.05 * i, func() -> void: shockwave(c, col, 0.85 if last_sq else 0.3))
			if kind == "q" and not captured:
				_later(0.05 * steps, func() -> void: burst(b, 0.35))
		"k":
			if not captured:
				shockwave(b, GOLD, 0.95)
				_later(0.1, func() -> void: shockwave(b, col, 0.55))
		_:
			if not captured:
				shockwave(b, col, 0.5)
				if steps == 2:
					shockwave(sq_center(String.chr(from.unicode_at(0)) + String.chr(from.unicode_at(1) + signi(dr))), col, 0.3)


func fly(p: Sprite2D, from: String, to: String, victim: Sprite2D, knight: bool) -> void:
	var a := sq_feet(from)
	var b := sq_feet(to)
	var d := a.distance_to(b)
	var dirs := 1.0 if (hash(from + to) % 2) == 0 else -1.0
	var side := (b - a).orthogonal().normalized() * d * 0.18 * dirs
	var ctrl := (a + b) * 0.5 + side - Vector2(0.0, d * (0.62 if knight else 0.30))        # Bézier quadratique : arc dynamique
	var mat := p.material as ShaderMaterial
	var sc: float = p.get_meta("sc")
	var dur := clampf(0.15 + d / 3400.0, 0.18, 0.30)                                      # foudroyant
	p.z_index = 60
	var run := {"acc": 0.0, "hit": victim == null, "victim": victim}                 # le sprite pris est lu via ce dictionnaire : une capture directe dans la lambda planterait quand il est libéré
	var tw := create_tween().set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_OUT)
	tw.tween_method(func(t: float) -> void:
		var q := a.lerp(ctrl, t).lerp(ctrl.lerp(b, t), t)
		var dq: Vector2 = q - p.position
		if dq.length() > 0.01:
			mat.set_shader_parameter("velocity", dq.normalized())
		var k := sin(PI * minf(t * 1.15, 1.0))
		mat.set_shader_parameter("stretch", k)
		mat.set_shader_parameter("trail", k)
		mat.set_shader_parameter("blur", k)                                               # flou de mouvement : plein pendant la course, nul au départ et à l'arrivée
		mat.set_shader_parameter("blur_px", clampf(dq.length() / maxf(sc, 0.01) * 1.8, 0.0, 120.0))   # longueur = vitesse réelle de cette image
		p.scale = Vector2.ONE * sc * (1.0 + 0.16 * k)
		run["acc"] += dq.length()
		if run["acc"] > 12.0:
			run["acc"] = 0.0
			spawn_ghost(p)
		p.position = q
		if not run["hit"] and t > 0.86:
			run["hit"] = true
			impact(sq_center(to), 1.0, run["victim"])
			run["victim"] = null
	, 0.0, 1.0, dur)
	await tw.finished
	p.position = b
	p.z_index = 1 + int((b.y - BAR) / SQ)
	mat.set_shader_parameter("stretch", 0.0)
	mat.set_shader_parameter("trail", 0.0)
	mat.set_shader_parameter("blur", 0.0)
	mat.set_shader_parameter("blur_px", 0.0)
	mat.set_shader_parameter("velocity", Vector2.ZERO)
	p.scale = Vector2(1.22, 0.78) * sc                                  # impact : écrasement puis rebond élastique
	create_tween().set_trans(Tween.TRANS_ELASTIC).set_ease(Tween.EASE_OUT).tween_property(p, "scale", Vector2.ONE * sc, 0.34)
	if victim == null and not quiet_move:
		sfx("move")
		shockwave(sq_center(to), LIME if eto else CYAN, 0.45)
		shake = maxf(shake, 3.0)


func spawn_ghost(p: Sprite2D) -> void:
	var g := Sprite2D.new()
	g.texture = p.texture
	g.centered = false
	g.offset = p.offset
	g.position = p.position
	g.scale = p.scale
	g.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	g.modulate = Color(LIME.r, LIME.g, LIME.b, 0.42) if eto else Color(1.0, 0.1, 0.2, 0.55)
	g.material = add_mat
	g.z_index = 59
	layer_pieces.add_child(g)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(g, "modulate:a", 0.0, 0.30)
	tw.tween_property(g, "scale", p.scale * 1.10, 0.30)
	tw.chain().tween_callback(g.queue_free)


# ----------------------------------------------------------------------------- effets d'impact
func impact(c: Vector2, power: float, victim: Sprite2D) -> void:
	if victim != null:
		shatter(victim)
		victim.queue_free()
	sfx("capture", 1.0, 2.0)
	flash(0.55 * power, Color(1.0, 0.78, 0.7))
	shockwave(c, Color(1.0, 0.18, 0.1, 1.0), 1.15 * power)
	get_tree().create_timer(0.07).timeout.connect(func() -> void: shockwave(c, Color(1.0, 0.45, 0.2, 1.0), 1.7 * power))
	burst(c, power)
	for i in 9:
		lightning(c, power)
	shake = 22.0 * power
	zoom_punch(1.05)
	eye_flare = 1.0
	eye_look_at(c, 1.4)
	hitstop(0.10, 0.12)


func hitstop(dur: float, scale_to: float) -> void:
	Engine.time_scale = scale_to
	get_tree().create_timer(dur, true, false, true).timeout.connect(func() -> void: Engine.time_scale = 1.0)


func zoom_punch(z: float) -> void:
	var tw := create_tween()
	tw.tween_property(self, "zoom", z, 0.05)
	tw.tween_property(self, "zoom", 1.0, 0.5).set_trans(Tween.TRANS_ELASTIC).set_ease(Tween.EASE_OUT)


func flash(a: float, col: Color) -> void:
	flash_rect.color = Color(col, a)
	create_tween().tween_property(flash_rect, "color:a", 0.0, 0.28)


func shatter(p: Sprite2D, n := 90) -> void:
	var name: String = NAMES[String(p.get_meta("code"))]
	var img: Image = imgs.get(name)
	if img == null:
		return
	var sc: float = p.get_meta("sc")
	var center := p.position + Vector2(0.0, -SQ * 0.5)
	for i in n:
		var ix := randi_range(0, img.get_width() - 1)
		var iy := randi_range(0, img.get_height() - 1)
		var col := img.get_pixel(ix, iy)
		var tries := 0
		while col.a < 0.5 and tries < 8:
			ix = randi_range(0, img.get_width() - 1)
			iy = randi_range(0, img.get_height() - 1)
			col = img.get_pixel(ix, iy)
			tries += 1
		if col.a < 0.5:
			continue
		var f := ColorRect.new()
		f.size = Vector2.ONE * randf_range(5.0, 11.0)
		f.color = col.lerp(RED, 0.4)
		f.mouse_filter = Control.MOUSE_FILTER_IGNORE
		f.position = p.position + (Vector2(ix, iy) + p.offset) * sc
		layer_fx.add_child(f)
		var dirv := (f.position - center).normalized()
		frags.append({"n": f, "v": dirv * randf_range(260.0, 880.0) + Vector2(randf_range(-80.0, 80.0), -220.0), "t": 0.0, "life": randf_range(0.55, 1.1)})


func shockwave(c: Vector2, col: Color, power: float) -> void:
	var r := ColorRect.new()
	var s := SQ * 2.6 * power
	r.size = Vector2(s, s)
	r.position = c - r.size / 2.0
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var m := ShaderMaterial.new()
	m.shader = shock_shader
	m.set_shader_parameter("color", col)
	m.set_shader_parameter("progress", 0.0)
	r.material = m
	layer_fx.add_child(r)
	var tw := create_tween()
	tw.tween_method(func(v: float) -> void: m.set_shader_parameter("progress", v), 0.0, 1.0, 0.55)
	tw.tween_callback(r.queue_free)


func _emitter(c: Vector2, amount: int, life: float, vmin: float, vmax: float, smin: float, smax: float, grav: float, gradient: Gradient, additive := true) -> void:
	var pr := CPUParticles2D.new()
	pr.position = c
	pr.one_shot = true
	pr.explosiveness = 1.0
	pr.amount = amount
	pr.lifetime = life
	pr.direction = Vector2.UP
	pr.spread = 180.0
	pr.initial_velocity_min = vmin
	pr.initial_velocity_max = vmax
	pr.gravity = Vector2(0.0, grav)
	pr.damping_min = 40.0
	pr.damping_max = 160.0
	pr.scale_amount_min = smin
	pr.scale_amount_max = smax
	pr.color_ramp = gradient
	if additive:
		pr.material = add_mat
	layer_fx.add_child(pr)
	pr.emitting = true
	get_tree().create_timer(life + 0.5).timeout.connect(pr.queue_free)


func burst(c: Vector2, power: float) -> void:
	var hot := Gradient.new()
	hot.colors = PackedColorArray([Color(1.0, 0.97, 0.8, 1.0), Color(1.0, 0.25, 0.1, 0.95), Color(0.4, 0.0, 0.05, 0.0)])
	hot.offsets = PackedFloat32Array([0.0, 0.3, 1.0])
	var ember := Gradient.new()
	ember.colors = PackedColorArray([Color(1.0, 0.55, 0.2, 1.0), Color(0.9, 0.1, 0.05, 0.8), Color(0.2, 0.0, 0.0, 0.0)])
	ember.offsets = PackedFloat32Array([0.0, 0.5, 1.0])
	var debris := Gradient.new()
	debris.colors = PackedColorArray([Color(1.0, 0.2, 0.15, 1.0), Color(0.55, 0.02, 0.05, 1.0), Color(0.15, 0.0, 0.02, 0.0)])
	debris.offsets = PackedFloat32Array([0.0, 0.6, 1.0])
	_emitter(c, int(130 * power), 0.7, 260.0, 760.0, 4.0, 11.0, 0.0, hot)                    # étincelles
	_emitter(c, int(60 * power), 1.3, 90.0, 380.0, 6.0, 14.0, -260.0, ember)                  # braises qui montent
	_emitter(c, int(70 * power), 1.0, 220.0, 620.0, 5.0, 12.0, 1500.0, debris, false)         # débris de pixels rouges qui retombent


func lightning(c: Vector2, power: float) -> void:
	var ln := Line2D.new()
	ln.width = randf_range(3.0, 6.0)
	ln.default_color = Color(1.0, 0.62, 0.55)
	ln.material = add_mat
	var ang := randf() * TAU
	var length := randf_range(120.0, 330.0) * power
	var pts := PackedVector2Array()
	for k in 10:
		var f := k / 9.0
		var base := c + Vector2.from_angle(ang) * length * f
		pts.append(base + Vector2.from_angle(ang + PI / 2.0) * randf_range(-24.0, 24.0) * sin(PI * f))
	ln.points = pts
	layer_fx.add_child(ln)
	var tw := create_tween()
	tw.tween_property(ln, "modulate:a", 0.0, randf_range(0.2, 0.45))
	tw.tween_callback(ln.queue_free)


func mate_fx(mover_code: String) -> void:
	var king := "k" if mover_code == mover_code.to_upper() else "K"           # le roi du camp maté
	var sq := ""
	for s in pieces:
		if pieces[s].get_meta("code") == king:
			sq = s
	sfx("checkmate", 1.0, 3.0)
	if sq == "":
		return
	var c := sq_center(sq)
	hitstop(0.45, 0.15)
	flash(0.9, Color(1.0, 0.9, 0.9))
	for i in 3:
		get_tree().create_timer(0.12 * i, true, false, true).timeout.connect(func() -> void: shockwave(c, Color(1.0, 0.1, 0.08, 1.0), 2.4 + i * 0.7))
	burst(c, 2.2)
	for i in 22:
		lightning(c, 1.9)
	shatter(pieces[sq], 160)
	pieces[sq].queue_free()
	pieces.erase(sq)
	shake = 42.0
	zoom_punch(1.09)
	eye_flare = 1.6


# ----------------------------------------------------------------------------- interaction
func _unhandled_input(ev: InputEvent) -> void:
	if ev is InputEventMouseButton and ev.pressed and ev.button_index == MOUSE_BUTTON_LEFT:
		var local := make_input_local(ev) as InputEventMouseButton        # position portée par l'événement (pas le curseur global)
		_click(local.position)


func _click(pos: Vector2) -> void:
	if not decision.is_empty():
		_decision_click(pos)
		return
	if promo_ui.visible:
		_promo_click(pos)
		return
	if busy or awaiting or over != "" or turn != me:
		return
	var s := sq_at(pos)
	if s == "":
		return
	if selected != "" and (legal.get(selected, []) as Array).has(s):
		_try_move(selected, s)
	elif legal.has(s):
		_select(s)
	else:
		_select("")


func _select(s: String) -> void:
	if selected != "" and pieces.has(selected):
		_glow(pieces[selected], false)
	selected = s
	if s != "" and pieces.has(s):
		_glow(pieces[s], true)
		sfx("select", 1.0, -6.0)
	queue_redraw()


func _glow(p: Sprite2D, on: bool) -> void:
	var m := p.material as ShaderMaterial
	var cur: Variant = m.get_shader_parameter("glow")
	create_tween().tween_method(func(v: float) -> void: m.set_shader_parameter("glow", v), float(cur) if cur != null else 0.0, 1.0 if on else 0.0, 0.18)


func _try_move(from: String, to: String) -> void:
	var code := String(pieces[from].get_meta("code"))
	if code.to_lower() == "p" and (to.ends_with("8") or to.ends_with("1")):
		promo_from = from
		promo_to = to
		_show_promo(code == code.to_upper())
		return
	_do_move(from, to, "")


func _do_move(from: String, to: String, promo: String) -> void:
	_select("")
	awaiting = true
	pending_local = {"from": from, "to": to}
	busy = true
	_send({"t": "move", "from": from, "to": to, "promo": promo})
	var cap: Variant = to if pieces.has(to) else null
	await animate_step({"from": from, "to": to, "capture": cap, "promo": promo if promo != "" else null}, false)
	busy = false
	_pump()


func _show_promo(white: bool) -> void:
	for c in promo_ui.get_children():
		c.queue_free()
	var bg := ColorRect.new()
	bg.position = Vector2(BX, BAR)
	bg.size = Vector2(BOARD, BOARD)
	bg.color = Color(0.0, 0.0, 0.0, 0.72)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	promo_ui.add_child(bg)
	var i := 0
	for k in ["q", "r", "b", "n"]:
		var code: String = k.to_upper() if white else k
		var t: Texture2D = tex[NAMES[code]]
		var s := Sprite2D.new()
		s.texture = t
		s.centered = false
		s.offset = Vector2(-t.get_width() / 2.0, -(t.get_height() - pad))
		s.scale = Vector2.ONE * (piece_h[k] * SQ * 1.5 / (t.get_height() - 2.0 * pad))
		s.position = Vector2(BX + BOARD / 2.0 + (i - 1.5) * 200.0, BAR + BOARD / 2.0 + 120.0)
		promo_ui.add_child(s)
		i += 1
	promo_ui.visible = true


func _promo_click(pos: Vector2) -> void:
	var idx := int(round((pos.x - BX - BOARD / 2.0) / 200.0 + 1.5))
	if idx < 0 or idx > 3 or absf(pos.y - (BAR + BOARD / 2.0)) > 260.0:
		return
	promo_ui.visible = false
	_do_move(promo_from, promo_to, ["q", "r", "b", "n"][idx])


# ----------------------------------------------------------------------------- auto-test (captures d'écran, sans E.N.O.S.)
func _shot(name: String) -> void:
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(selftest_dir.path_join(name + ".png"))


func _selftest() -> void:
	var start := {"a1": "R", "b1": "N", "c1": "B", "d1": "Q", "e1": "K", "f1": "B", "g1": "N", "h1": "R",
		"a7": "p", "b7": "p", "c7": "p", "d7": "p", "e7": "p", "f7": "p", "g7": "p", "h7": "p",
		"a8": "r", "b8": "n", "c8": "b", "d8": "q", "e8": "k", "f8": "b", "g8": "n", "h8": "r"}
	for f in "abcdefgh":
		start[f + "2"] = "P"
	apply_state({"board": start, "me": "w", "turn": "w", "legal": {"g1": ["f3", "h3"]}, "last": "", "eval": 180}, true)
	await get_tree().create_timer(1.6).timeout
	show_subtitle("La Défense Sicilienne ? Quel manque d'originalité.", "opening", 2600)
	await get_tree().create_timer(2.0).timeout
	await _shot("1_depart")
	_select("g1")
	await get_tree().create_timer(0.4).timeout
	await _shot("2_selection")
	_select("")
	animate_step({"from": "g1", "to": "f3", "capture": null, "piece": "N"}, false)
	await get_tree().create_timer(0.07).timeout
	await _shot("3_vol")
	await get_tree().create_timer(0.5).timeout
	set_badge("f3", "brilliant")
	eval_cp = 640
	eval_goal = _winpct(640)
	await get_tree().create_timer(0.7).timeout
	await _shot("3b_icone_jauge")
	show_arrows([{"from": "d1", "to": "d4", "kind": "best"}, {"from": "g8", "to": "f6", "kind": "threat"}, {"from": "f1", "to": "c4", "kind": "punish"}], 5.0)
	await get_tree().create_timer(0.9).timeout
	await _shot("3c_fleches")
	clear_arrows()
	apply_state({"board": {"f7": "N", "d8": "q", "h8": "r", "e1": "K", "e8": "k", "a2": "P", "c8": "b"}, "me": "w", "turn": "b", "legal": {}, "last": "d6f7", "eval": 640}, false)
	await get_tree().create_timer(0.3).timeout
	_fork_cache = {}
	set_board_skin("gris_noir")
	set_badge("f7", "brilliant")
	brilliant_fx("f7")                                                              # fourchette Cf7 : roi + dame + tour
	await get_tree().create_timer(0.35).timeout
	await _shot("3d_brillant_0")
	await get_tree().create_timer(0.55).timeout
	await _shot("3d_brillant_1")
	await get_tree().create_timer(0.75).timeout
	await _shot("3d_brillant_2")
	await get_tree().create_timer(0.9).timeout
	await _shot("3d_brillant_3")
	set_board_skin("")
	apply_state({"board": {"e5": "N", "d1": "Q", "e1": "K", "e8": "k", "a7": "p"}, "me": "w", "turn": "b", "legal": {}, "last": "c4e5", "eval": 300}, false)
	await get_tree().create_timer(0.4).timeout
	brilliant_fx("e5")                                                              # coup brillant simple (pas de fourchette)
	await get_tree().create_timer(0.3).timeout
	await _shot("3d_brillant_simple")
	clear_arrows()
	await get_tree().create_timer(0.7).timeout
	apply_state({"board": {"d4": "P", "e5": "p", "e1": "K", "e8": "k", "a2": "P", "h7": "p", "d8": "q"}, "me": "w", "turn": "w", "legal": {}, "last": ""}, false)
	await get_tree().create_timer(0.2).timeout
	show_subtitle("Tu perds ta Reine alors que Cf3 était là. Décevant.", "blunder", 2200)
	animate_step({"from": "d4", "to": "e5", "capture": "e5", "piece": "P"}, false)
	await get_tree().create_timer(0.30).timeout
	await _shot("4_capture")
	await get_tree().create_timer(0.35).timeout
	await _shot("5_capture_suite")
	await get_tree().create_timer(1.2).timeout
	apply_state({"board": start, "me": "w", "turn": "w", "legal": {}, "last": "g1f3", "eval": -480,
			"decision": {"san": "Cf3", "best": "Cc3", "best_uci": "b1c3", "loss": 520, "from": "g1", "to": "f3"}}, false)
	await get_tree().create_timer(0.6).timeout
	await _shot("6_decision")
	hide_decision()
	load_theme(theme_arg if theme_arg != "" else "glace_rouge")
	side_names = {"w": "ETO", "b": "E.N.O.S."}
	set_badge("e2", "blunder")
	await get_tree().create_timer(0.8).timeout
	await _shot("7_theme_glace_rouge")
	# flèches en équerre (cavaliers) ajoutées une par une, comme quand ETO prononce chaque coup
	apply_state({"board": start, "me": "w", "turn": "w", "legal": {}, "last": "", "eval": 0}, true)
	clear_arrows()
	show_arrows([{"from": "g1", "to": "f3", "kind": "played"}], 8.0, true)
	await get_tree().create_timer(0.5).timeout
	show_arrows([{"from": "b8", "to": "c6", "kind": "threat"}, {"from": "f1", "to": "b5", "kind": "punish"}], 8.0, true)
	await get_tree().create_timer(0.6).timeout
	await _shot("8_fleches_equerre")
	clear_arrows()
	animate_step({"from": "b1", "to": "c3", "capture": null, "piece": "N"}, false)
	await get_tree().create_timer(0.30).timeout
	await _shot("9_fx_cavalier")
	apply_state({"board": start, "me": "w", "turn": "b", "legal": {}, "last": "", "eval": 0}, false)
	side_names = {"w": "ETO", "b": "E.N.O.S."}
	_banner_end("Abandon : E.N.O.S. gagne")
	await get_tree().create_timer(1.3).timeout
	await _shot("9b_banner_abandon")
	await get_tree().create_timer(3.8).timeout
	_banner_end("Échec et mat : les Blancs gagnent")
	await get_tree().create_timer(1.3).timeout
	await _shot("9c_banner_mat")
	await get_tree().create_timer(3.8).timeout
	apply_state({"board": start, "me": "w", "turn": "b", "legal": {}, "last": "", "eval": 0, "mode": "boss", "challenger": "duo", "players": {"w": "E.N.O.S. + ETO", "b": "STOCKFISH"}}, false)
	await get_tree().create_timer(0.5).timeout
	await _shot("10a_boss_reflechit")
	boss_show("Cf6", "g8", "f6")                                                    # Stockfish annonce son coup
	await get_tree().create_timer(0.7).timeout
	await _shot("10_boss_annonce")
	boss_hide()
	await get_tree().create_timer(0.3).timeout
	await _shot("11_boss_fin")
	await get_tree().create_timer(0.6).timeout
	Engine.time_scale = 1.0
	print("selftest ok")
	get_tree().quit()


func _studytest() -> void:
	# Mode apprentissage (hors E.N.O.S.) : cases surlignées, flèches, bandeau, puis retour en arrière (undo) animé
	set_persona("eto")
	var pos := {"a1": "R", "b1": "N", "c1": "B", "d1": "Q", "e1": "K", "f1": "B", "g1": "N", "h1": "R", "a7": "p", "b7": "p", "c7": "p", "f7": "p", "g7": "p", "h7": "p",
		"a8": "r", "b8": "n", "c8": "b", "d8": "q", "e8": "k", "f8": "b", "g8": "n", "h8": "r", "a2": "P", "b2": "P", "c2": "P", "f2": "P", "g2": "P", "h2": "P",
		"e4": "P", "d4": "P", "e6": "p", "d5": "p"}
	apply_state({"board": pos, "me": "b", "turn": "w", "legal": {}, "last": "d7d5", "eval": 0, "mode": "study", "players": {"w": "ETO", "b": "ETO"}}, true)
	await get_tree().create_timer(1.4).timeout
	_handle({"t": "study", "on": true, "title": "Défense Française", "variation": "Variante d'Avance", "mode": "demo", "step": "6/78", "user": "b"})
	_handle({"t": "squares", "list": [{"sq": "e4", "kind": "bad"}, {"sq": "d5", "kind": "good"}, {"sq": "e6", "kind": "idea"}], "secs": 8.0})
	_handle({"t": "arrows", "list": [{"from": "d5", "to": "e4", "kind": "best"}, {"from": "e6", "to": "d5", "kind": "punish"}], "secs": 8.0})
	await get_tree().create_timer(1.0).timeout
	await _shot("study_1_cases_fleches")
	_handle({"t": "study", "on": true, "title": "Défense Française", "variation": "Variante d'Avance", "mode": "practice", "step": "", "user": "b"})
	_handle({"t": "undo", "from": "e4", "to": "e2", "state": {"board": pos, "me": "b", "turn": "w", "legal": {}, "last": "", "mode": "study"}})
	await get_tree().create_timer(1.6).timeout
	await _shot("study_2_pratique")
	print("studytest ok")
	get_tree().quit()

