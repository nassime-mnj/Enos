shader_type canvas_item;
// POST-TRAITEMENT 2D DE L'AVATAR : lueur rouge (bloom maison, indépendante du renderer : fonctionne en Compatibility), pulsation lente
// au rythme de la voix, glitch (bandes décalées + séparation RVB), scanlines façon écran de la « Fairy ».

uniform float glow : hint_range(0.0, 3.0) = 1.0;       // force de la lueur (le script la fait pulser avec la voix)
uniform float glitch : hint_range(0.0, 1.0) = 0.0;
uniform float speak : hint_range(0.0, 1.0) = 0.0;
uniform vec4 core_color : source_color = vec4(1.0, 0.07, 0.09, 1.0);

const int DIRS = 12;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec4 tex(sampler2D t, vec2 uv) {
	vec4 c = texture(t, uv);
	return vec4(c.rgb * c.a, c.a);                      // travail en alpha pré-multiplié : pas de liseré noir autour de la silhouette
}

void fragment() {
	vec2 uv = UV;
	float step_t = floor(TIME * 20.0);
	float band = floor(uv.y * 30.0);
	float h = hash(vec2(band, step_t));
	float on = step(1.0 - glitch * 0.4, h);              // quelques bandes seulement, par à-coups
	uv.x += on * (hash(vec2(band, step_t + 9.0)) - 0.5) * 0.12 * glitch;
	float split = (0.004 + 0.014 * on) * glitch + 0.0015;

	vec4 base;
	base.r = tex(TEXTURE, uv + vec2(split, 0.0)).r;
	base.g = tex(TEXTURE, uv).g;
	base.b = tex(TEXTURE, uv - vec2(split, 0.0)).b;
	base.a = tex(TEXTURE, uv).a;

	// bloom : deux couronnes d'échantillons, seule la partie lumineuse (> seuil) déborde
	vec3 bloom = vec3(0.0);
	for (int r = 1; r <= 2; r++) {
		float rad = (r == 1 ? 0.018 : 0.05);
		float w = (r == 1 ? 1.0 : 0.7);
		for (int i = 0; i < DIRS; i++) {
			float a = 6.2831853 * float(i) / float(DIRS) + float(r) * 0.4;
			vec4 s = tex(TEXTURE, uv + vec2(cos(a), sin(a)) * rad);
			float lum = max(max(s.r, s.g), s.b);
			bloom += s.rgb * smoothstep(0.55, 1.1, lum) * w;
		}
	}
	bloom /= float(DIRS) * 1.2;
	vec3 halo = bloom * glow * mix(vec3(1.0), core_color.rgb * 1.4, 0.5);

	float scan = 0.92 + 0.08 * sin(UV.y * 700.0 + TIME * 3.0);      // scanlines fines
	vec3 rgb = base.rgb * scan + halo;
	float a = clamp(base.a + max(max(halo.r, halo.g), halo.b) * 0.9, 0.0, 1.0);
	COLOR = vec4(rgb, a);                                // sortie pré-multipliée…
	COLOR.rgb = a > 0.001 ? rgb / a : vec3(0.0);         // … convertie en alpha droit pour le canvas
}
