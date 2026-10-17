class_name EnosAvatar
extends Control
## AVATAR D'E.N.O.S. — IA technologique à cercles concentriques (structure inspirée de la « Fairy » de Zenless Zone Zero) dont l'œil central
## est modélisé EN 3D : globe oculaire (iris à fibres, pupille-fente, veines), coque à quatre pointes, anneaux clairs, point orbital.
## Teintes rouge sombre ; lueur qui pulse lentement au rythme de la voix ; glitch d'instabilité par à-coups.
##
## Interface identique à l'ancien œil 2D (ShaderMaterial) pour remplacer `eye`/`mat` sans toucher au reste :
##   set_shader_parameter("speak" | "flare" | "mood" | "look" | "core_color", valeur)
## Rendu : un SubViewport 3D transparent (monde 3D privé) affiché par un TextureRect passant par avatar_post.gdshader.
## Fonctionne en Forward+ comme en Compatibility (la lueur est calculée par le shader de post-traitement, pas par le Glow du moteur).

const EYE_SHADER: Shader = preload("res://avatar/eye3d.gdshader")
const POST_SHADER: Shader = preload("res://avatar/avatar_post.gdshader")
const VIEW: int = 512

var speak: float = 0.0
var flare: float = 0.0
var mood: float = 0.25
var look: Vector2 = Vector2.ZERO
var core_color: Color = Color(1.0, 0.07, 0.09)

var _vp: SubViewport
var _rig: Node3D
var _eye: MeshInstance3D
var _shell: MeshInstance3D
var _ring_pale: Node3D
var _ring_mid: Node3D
var _orbit: Node3D
var _eye_mat: ShaderMaterial
var _post_mat: ShaderMaterial
var _emissive: Array[StandardMaterial3D] = []
var _light: OmniLight3D
var _voice: float = 0.0                 # voix lissée (enveloppe lente) : fait pulser la lueur sans scintillement
var _glitch: float = 0.0
var _glitch_left: float = 0.0
var _glitch_next: float = 2.0
var _t: float = 0.0
var _rng: RandomNumberGenerator = RandomNumberGenerator.new()


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_rng.randomize()
	_build_viewport()
	_build_scene()
	var tr: TextureRect = TextureRect.new()
	tr.texture = _vp.get_texture()
	tr.set_anchors_preset(Control.PRESET_FULL_RECT)
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_SCALE
	tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	tr.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	_post_mat = ShaderMaterial.new()
	_post_mat.shader = POST_SHADER
	tr.material = _post_mat
	add_child(tr)


## Compatibilité avec ShaderMaterial : pet.gd continue d'appeler `mat.set_shader_parameter(...)`.
func set_shader_parameter(param: StringName, value: Variant) -> void:
	match param:
		&"speak": speak = float(value)
		&"flare": flare = float(value)
		&"mood": mood = float(value)
		&"look": look = value as Vector2
		&"core_color": core_color = value as Color


# ------------------------------------------------------------------------------------------------ construction
func _build_viewport() -> void:
	_vp = SubViewport.new()
	_vp.size = Vector2i(VIEW, VIEW)
	_vp.transparent_bg = true
	_vp.own_world_3d = true                              # monde 3D privé : n'interfère avec rien d'autre
	_vp.msaa_3d = Viewport.MSAA_4X
	_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(_vp)


func _std(color: Color, metallic: float, rough: float, emit: Color, emit_energy: float) -> StandardMaterial3D:
	var m: StandardMaterial3D = StandardMaterial3D.new()
	m.albedo_color = color
	m.metallic = metallic
	m.roughness = rough
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	if emit_energy > 0.0:
		m.emission_enabled = true
		m.emission = emit
		m.emission_energy_multiplier = emit_energy
		m.set_meta("base_energy", emit_energy)
		_emissive.append(m)
	m.rim_enabled = true
	m.rim = 0.25
	m.rim_tint = 0.6
	return m


func _build_scene() -> void:
	var env: Environment = Environment.new()
	env.background_mode = Environment.BG_CLEAR_COLOR
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.2, 0.03, 0.04)
	env.ambient_light_energy = 0.35
	var we: WorldEnvironment = WorldEnvironment.new()
	we.environment = env
	_vp.add_child(we)

	var cam: Camera3D = Camera3D.new()
	cam.fov = 26.0
	cam.position = Vector3(0, 0, 11.8)
	_vp.add_child(cam)

	_rig = Node3D.new()
	_vp.add_child(_rig)

	var red: Color = Color(1.0, 0.07, 0.09)
	var blood: Color = Color(0.45, 0.0, 0.03)
	# 1. disque extérieur sombre à liseré rouge (le « cercle » bleu de la Fairy)
	var disc: MeshInstance3D = MeshInstance3D.new()
	var cyl: CylinderMesh = CylinderMesh.new()
	cyl.top_radius = 2.18
	cyl.bottom_radius = 2.18
	cyl.height = 0.12
	cyl.radial_segments = 96
	disc.mesh = cyl
	disc.rotation.x = PI / 2.0
	disc.position.z = -0.25
	disc.material_override = _std(Color(0.04, 0.0, 0.012), 0.6, 0.5, blood, 0.15)
	_rig.add_child(disc)
	_rig.add_child(_flat_ring(2.02, 2.2, 0.14, 0, 0.0, -0.2, _std(Color(0.1, 0.0, 0.02), 0.8, 0.3, red, 1.3)))
	# 2. coque sombre à quatre pointes (la forme « engrenage » à quatre coins de la Fairy)
	_rig.add_child(_flat_ring(1.46, 1.95, 0.3, 4, 0.12, -0.05, _std(Color(0.05, 0.0, 0.015), 0.85, 0.4, blood, 0.12)))
	# 3. grand anneau clair (le blanc de la Fairy devient un os rougeâtre éclairé de l'intérieur)
	_ring_pale = Node3D.new()
	_ring_pale.add_child(_flat_ring(1.14, 1.42, 0.2, 0, 0.0, 0.05, _std(Color(0.34, 0.12, 0.13), 0.35, 0.4, Color(0.9, 0.08, 0.1), 0.35)))
	_rig.add_child(_ring_pale)
	# 4. anneau moyen segmenté, tourne lentement
	_ring_mid = Node3D.new()
	for i in 6:
		var seg: MeshInstance3D = _arc_segment(0.95, 1.1, 0.18, i * TAU / 6.0, TAU / 6.0 * 0.78, _std(Color(0.3, 0.04, 0.06), 0.7, 0.4, red, 0.7))
		_ring_mid.add_child(seg)
	_ring_mid.position.z = 0.12
	_rig.add_child(_ring_mid)
	# 5. anneau intérieur (monture de l'œil)
	_rig.add_child(_flat_ring(0.76, 0.91, 0.26, 0, 0.0, 0.16, _std(Color(0.12, 0.0, 0.02), 0.9, 0.3, red, 0.5)))

	# 6. LE GLOBE OCULAIRE 3D
	_eye = MeshInstance3D.new()
	var sph: SphereMesh = SphereMesh.new()
	sph.radius = 0.8
	sph.height = 1.6
	sph.radial_segments = 96
	sph.rings = 48
	_eye.mesh = sph
	_eye_mat = ShaderMaterial.new()
	_eye_mat.shader = EYE_SHADER
	_eye.material_override = _eye_mat
	_eye.position.z = 0.14
	_eye.rotation.y = 0.0
	_rig.add_child(_eye)
	# cornée : coque de verre au fresnel rouge
	_shell = MeshInstance3D.new()
	var sh: SphereMesh = SphereMesh.new()
	sh.radius = 0.83
	sh.height = 1.66
	sh.radial_segments = 64
	sh.rings = 32
	_shell.mesh = sh
	var gm: StandardMaterial3D = StandardMaterial3D.new()
	gm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	gm.albedo_color = Color(1.0, 0.1, 0.1, 0.07)
	gm.roughness = 0.03
	gm.metallic_specular = 1.0
	gm.rim_enabled = true
	gm.rim = 1.0
	gm.rim_tint = 0.0
	gm.emission_enabled = true
	gm.emission = Color(0.8, 0.02, 0.04)
	gm.emission_energy_multiplier = 0.08
	_shell.material_override = gm
	_shell.position.z = 0.14
	_rig.add_child(_shell)

	# 7. point orbital brillant (le petit disque blanc de la Fairy)
	_orbit = Node3D.new()
	var dot: MeshInstance3D = MeshInstance3D.new()
	var ds: SphereMesh = SphereMesh.new()
	ds.radius = 0.085
	ds.height = 0.17
	dot.mesh = ds
	dot.material_override = _std(Color(1.0, 0.7, 0.7), 0.0, 0.2, Color(1.0, 0.45, 0.4), 3.0)
	dot.position = Vector3(1.03, 0, 0.3)
	_orbit.add_child(dot)
	_rig.add_child(_orbit)

	# éclairage : une lueur rouge venant de l'œil + une clé froide très faible pour décoller les volumes
	_light = OmniLight3D.new()
	_light.light_color = red
	_light.omni_range = 5.0
	_light.light_energy = 1.0
	_light.position = Vector3(0, 0, 1.3)
	_vp.add_child(_light)
	var key: DirectionalLight3D = DirectionalLight3D.new()
	key.light_color = Color(0.7, 0.55, 0.6)
	key.light_energy = 0.5
	key.rotation = Vector3(deg_to_rad(-35), deg_to_rad(30), 0)
	_vp.add_child(key)


## Anneau plat extrudé ; `lobes` > 0 : le bord extérieur forme `lobes` pointes (amplitude `amp`, relative).
func _flat_ring(r_in: float, r_out: float, depth: float, lobes: int, amp: float, z: float, mat: Material) -> MeshInstance3D:
	var mi: MeshInstance3D = MeshInstance3D.new()
	mi.mesh = _ring_mesh(r_in, r_out, depth, lobes, amp, 0.0, TAU)
	mi.material_override = mat
	mi.position.z = z
	return mi


func _arc_segment(r_in: float, r_out: float, depth: float, a0: float, span: float, mat: Material) -> MeshInstance3D:
	var mi: MeshInstance3D = MeshInstance3D.new()
	mi.mesh = _ring_mesh(r_in, r_out, depth, 0, 0.0, a0, span)
	mi.material_override = mat
	return mi


func _ring_mesh(r_in: float, r_out: float, depth: float, lobes: int, amp: float, a_start: float, span: float) -> ArrayMesh:
	var st: SurfaceTool = SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var seg: int = maxi(8, int(96.0 * span / TAU))
	var h: float = depth * 0.5
	var full: bool = absf(span - TAU) < 0.001
	for i in seg:
		var a0: float = a_start + span * float(i) / float(seg)
		var a1: float = a_start + span * float(i + 1) / float(seg)
		var d0: Vector2 = Vector2(cos(a0), sin(a0))
		var d1: Vector2 = Vector2(cos(a1), sin(a1))
		var ro0: float = r_out * (1.0 + amp * _spike(a0, lobes))
		var ro1: float = r_out * (1.0 + amp * _spike(a1, lobes))
		var o0: Vector2 = d0 * ro0
		var o1: Vector2 = d1 * ro1
		var i0: Vector2 = d0 * r_in
		var i1: Vector2 = d1 * r_in
		_quad(st, Vector3(i0.x, i0.y, h), Vector3(o0.x, o0.y, h), Vector3(o1.x, o1.y, h), Vector3(i1.x, i1.y, h), Vector3(0, 0, 1))
		_quad(st, Vector3(i0.x, i0.y, -h), Vector3(i1.x, i1.y, -h), Vector3(o1.x, o1.y, -h), Vector3(o0.x, o0.y, -h), Vector3(0, 0, -1))
		var n_out: Vector3 = Vector3((d0.x + d1.x) * 0.5, (d0.y + d1.y) * 0.5, 0).normalized()
		_quad(st, Vector3(o0.x, o0.y, h), Vector3(o0.x, o0.y, -h), Vector3(o1.x, o1.y, -h), Vector3(o1.x, o1.y, h), n_out)
		_quad(st, Vector3(i0.x, i0.y, h), Vector3(i1.x, i1.y, h), Vector3(i1.x, i1.y, -h), Vector3(i0.x, i0.y, -h), -n_out)
		if not full and (i == 0 or i == seg - 1):                      # tranches d'un arc ouvert
			var d: Vector2 = d0 if i == 0 else d1
			var io: Vector2 = d * r_in
			var oo: Vector2 = d * (ro0 if i == 0 else ro1)
			var tan_n: Vector3 = Vector3(sin(a0), -cos(a0), 0) * (1.0 if i == 0 else -1.0)
			if i == seg - 1:
				tan_n = Vector3(-sin(a1), cos(a1), 0)
			_quad(st, Vector3(io.x, io.y, h), Vector3(oo.x, oo.y, h), Vector3(oo.x, oo.y, -h), Vector3(io.x, io.y, -h), tan_n)
	return st.commit()


func _spike(a: float, lobes: int) -> float:
	if lobes <= 0:
		return 0.0
	return pow(absf(cos(float(lobes) * 0.5 * a)), 7.0)


## Quadrilatère orienté automatiquement : Godot veut des triangles HORAIRES vus de l'extérieur.
func _quad(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3, d: Vector3, n: Vector3) -> void:
	for tri: Array in [[a, b, c], [a, c, d]]:
		var p0: Vector3 = tri[0]
		var p1: Vector3 = tri[1]
		var p2: Vector3 = tri[2]
		if (p1 - p0).cross(p2 - p0).dot(n) > 0.0:
			var tmp: Vector3 = p1
			p1 = p2
			p2 = tmp
		for p: Vector3 in [p0, p1, p2]:
			st.set_normal(n)
			st.add_vertex(p)


# ------------------------------------------------------------------------------------------------ animation
func _process(delta: float) -> void:
	if _vp == null:
		return
	_t += delta
	_voice = lerpf(_voice, speak, clampf(delta * 4.0, 0.0, 1.0))      # enveloppe lente (~0,25 s) : pulsation « au rythme de la voix »
	var heart: float = 0.5 + 0.5 * sin(_t * 1.7)                       # battement de veille
	var pulse: float = clampf(0.25 + 0.2 * heart + 0.75 * _voice, 0.0, 1.0)

	# --- glitch : à-coups aléatoires, plus fréquents et plus forts quand E.N.O.S. est en colère ou parle
	_glitch_next -= delta
	if _glitch_next <= 0.0:
		_glitch_left = _rng.randf_range(0.07, 0.28)
		_glitch_next = _rng.randf_range(1.2, 4.5) * (1.0 - 0.55 * maxf(mood, _voice))
	_glitch_left = maxf(_glitch_left - delta, 0.0)
	var target: float = (_rng.randf_range(0.55, 1.0) if _glitch_left > 0.0 else 0.0) + 0.05 + 0.1 * mood * _voice
	_glitch = lerpf(_glitch, minf(target, 1.0), clampf(delta * 40.0, 0.0, 1.0))

	# --- globe : le regard fait réellement tourner l'œil en 3D ; la monture penche légèrement (parallaxe entre anneaux)
	_eye.rotation.y = lerp_angle(_eye.rotation.y, look.x * 0.55, clampf(delta * 14.0, 0.0, 1.0))
	_eye.rotation.x = lerp_angle(_eye.rotation.x, look.y * 0.45, clampf(delta * 14.0, 0.0, 1.0))
	_shell.rotation = _eye.rotation
	_rig.rotation.y = lerp_angle(_rig.rotation.y, look.x * 0.16, clampf(delta * 6.0, 0.0, 1.0))
	_rig.rotation.x = lerp_angle(_rig.rotation.x, look.y * 0.14, clampf(delta * 6.0, 0.0, 1.0))
	_ring_pale.rotation.z += delta * 0.12
	_ring_mid.rotation.z -= delta * (0.5 + 1.4 * mood + 1.2 * _voice)
	_orbit.rotation.z -= delta * (0.7 + 0.8 * mood)

	# --- teintes / lueurs
	_eye_mat.set_shader_parameter("core_color", core_color)
	_eye_mat.set_shader_parameter("speak", _voice)
	_eye_mat.set_shader_parameter("flare", flare)
	_eye_mat.set_shader_parameter("mood", mood)
	_eye_mat.set_shader_parameter("glitch", _glitch)
	_eye_mat.set_shader_parameter("pulse", pulse)
	for m: StandardMaterial3D in _emissive:
		m.emission_energy_multiplier = float(m.get_meta("base_energy")) * (0.6 + 0.9 * pulse + 0.8 * flare)
		m.emission = m.emission.lerp(core_color, 0.05)
	_light.light_color = core_color
	_light.light_energy = 0.5 + 1.4 * pulse + 1.5 * flare

	_post_mat.set_shader_parameter("glow", 0.45 + 0.9 * pulse + 0.8 * flare)
	_post_mat.set_shader_parameter("glitch", _glitch)
	_post_mat.set_shader_parameter("speak", _voice)
	_post_mat.set_shader_parameter("core_color", core_color)
