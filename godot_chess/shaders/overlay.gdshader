shader_type canvas_item;
// Voile holographique du plateau : lignes de balayage très discrètes, bande cyan qui descend lentement, vignettage.

uniform vec4  band_color : source_color = vec4(0.08, 0.95, 1.0, 1.0);
uniform float intensity : hint_range(0.0, 1.0) = 0.5;

void fragment() {
	float scan = 0.5 + 0.5 * sin(UV.y * 900.0);
	float band_pos = fract(TIME * 0.12);
	float band = smoothstep(0.06, 0.0, abs(UV.y - band_pos)) * 0.10;
	vec2 c = UV - 0.5;
	float vig = smoothstep(0.45, 0.78, length(c)) * 0.55;
	float a = (scan * 0.035 + band) * intensity;
	COLOR = vec4(mix(band_color.rgb, vec3(0.0), vig), a + vig * 0.6 * intensity);
}
