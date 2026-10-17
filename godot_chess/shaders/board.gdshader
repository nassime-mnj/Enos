shader_type canvas_item;
// PLATEAU THÉMATIQUE (remplace board.png quand un thème visuel est actif). Dessiné sur un ColorRect 1024x1024 : l'UV couvre le plateau, 8x8 cases.
// Case en haut à gauche = claire (vrai pour les deux orientations : a8 pour les Blancs, h1 pour les Noirs).
// Cases : couleur claire / sombre + grain (reflets), biseau, reflet métallique balayant.
// Grille néon : lignes + halo + cadre, qui pulsent (valeurs > 1.0 = HDR, le Glow du WorldEnvironment fait le reste).

uniform vec4  light_color : source_color = vec4(0.82, 0.72, 0.50, 1.0);
uniform vec4  dark_color  : source_color = vec4(0.10, 0.08, 0.06, 1.0);
uniform float sheen : hint_range(0.0, 1.0) = 0.25;          // intensité du reflet balayant
uniform float grain : hint_range(0.0, 1.0) = 0.5;           // veinage / micro-relief des cases
uniform vec4  grid_color : source_color = vec4(0.0, 0.0, 0.0, 1.0);
uniform float grid_alpha : hint_range(0.0, 1.0) = 0.35;     // fine ligne de séparation « classique »

uniform float neon : hint_range(0.0, 1.0) = 0.0;            // 0 = éteint, 1 = allumé (animé par visual_theme.gd)
uniform vec4  neon_color : source_color = vec4(0.1, 0.9, 1.0, 1.0);
uniform float neon_intensity : hint_range(0.0, 12.0) = 2.5;
uniform float neon_speed = 2.2;
uniform float line_width = 0.014;                           // épaisseur du trait, en fraction de case

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void fragment() {
	vec2 g = UV * 8.0;
	vec2 cell = floor(g);
	vec2 f = fract(g);
	float dark = mod(cell.x + cell.y, 2.0);
	vec3 col = mix(light_color.rgb, dark_color.rgb, dark);

	// veinage : fines stries + bruit de grande échelle, différents par case
	float n = noise(g * 5.0 + cell * 13.7) * 0.6 + noise(vec2(g.x * 2.0, g.y * 24.0) + cell * 3.1) * 0.4;
	col *= 1.0 + (n - 0.5) * 0.35 * grain;

	// biseau de case : bord sombre, liseré clair en haut à gauche
	vec2 e = min(f, 1.0 - f);
	float edge = min(e.x, e.y);
	col *= mix(0.80, 1.0, smoothstep(0.0, 0.07, edge));
	col += vec3(0.06) * smoothstep(0.05, 0.0, min(f.x, f.y)) * (1.0 - dark * 0.5);

	// reflet métallique balayant (lent) + léger éclairage de vignette
	float sw = pow(max(sin((UV.x * 0.8 + UV.y) * 5.5 - TIME * 0.35), 0.0), 14.0);
	col += mix(col, vec3(1.0), 0.5) * sw * sheen * 0.35;
	col *= 1.0 - 0.18 * length(UV - 0.5);

	// fine grille classique (toujours là, discrète)
	vec2 dl = abs(fract(g + 0.5) - 0.5);                    // distance (en cases) à la ligne la plus proche
	float d = min(dl.x, dl.y);
	col = mix(col, grid_color.rgb, smoothstep(0.012, 0.0, d) * grid_alpha);

	// GRILLE NÉON pulsante : cœur blanc-chaud, trait coloré, halo ; onde qui parcourt le plateau
	if (neon > 0.001) {
		float core = smoothstep(line_width, 0.0, d);
		float halo = exp(-d * 22.0) * 0.55;
		float wave = 0.78 + 0.22 * sin(TIME * neon_speed) + 0.12 * sin(TIME * neon_speed * 0.6 + (UV.x + UV.y) * 9.0);
		vec3 line = mix(neon_color.rgb, vec3(1.0), 0.35 * core);
		col += line * neon_intensity * (core + halo) * wave * neon;
		// le cadre extérieur est plus lumineux
		float border = min(min(UV.x, 1.0 - UV.x), min(UV.y, 1.0 - UV.y));
		col += neon_color.rgb * neon_intensity * 0.9 * smoothstep(0.012, 0.0, border) * wave * neon;
	}
	COLOR = vec4(col, 1.0);
}
