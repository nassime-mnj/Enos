// FLOU DE MOUVEMENT directionnel, partagé par piece.gdshader et knight.gdshader.
// main.gd pilote `blur` (0..1, intensité pendant le déplacement) et `blur_px` (longueur du flou en pixels de texture, selon la vitesse réelle).
// Le flou est calculé en alpha pré-multiplié (aucun liseré sombre) : ~16 prises le long de la direction, surtout DERRIÈRE la pièce, un peu devant.

uniform float blur : hint_range(0.0, 1.0) = 0.0;
uniform float blur_px = 0.0;

vec4 motion_blur_sample(sampler2D tex, vec2 uv, vec2 dir, vec2 px) {
	vec4 sharp = texture(tex, uv);
	if (blur < 0.001 || blur_px < 0.5 || length(dir) < 0.001) {
		return sharp;
	}
	vec4 acc = vec4(0.0);
	float wsum = 0.0;
	for (int i = 0; i < 16; i++) {
		float k = float(i) / 15.0;
		float t = mix(0.25, -1.0, k);
		float w = 1.0 - 0.55 * k;
		vec4 c = texture(tex, uv + dir * px * blur_px * t);
		acc += vec4(c.rgb * c.a, c.a) * w;
		wsum += w;
	}
	acc /= wsum;
	vec4 ps = vec4(sharp.rgb * sharp.a, sharp.a);
	vec4 pm = mix(ps, acc, clamp(blur * 0.92, 0.0, 1.0));
	return vec4(pm.a > 0.0001 ? pm.rgb / pm.a : vec3(0.0), pm.a);
}
