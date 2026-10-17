shader_type canvas_item;
// ONDE DE CHOC : anneau rougeoyant à aberration chromatique (bords cyan/rouge décalés) + flash central. `progress` 0 → 1 par Tween.

uniform float progress : hint_range(0.0, 1.0) = 0.0;
uniform vec4  color : source_color = vec4(1.0, 0.15, 0.1, 1.0);
uniform float ring_width = 0.10;
uniform float chroma = 0.045;

float ring_at(float d, float r, float w) {
	return smoothstep(w, 0.0, abs(d - r));
}

void fragment() {
	vec2 p = UV - vec2(0.5);
	float d = length(p) * 2.0;
	float r = progress * 1.15;
	float fade = (1.0 - progress);
	float red = ring_at(d, r + chroma, ring_width) * fade;
	float grn = ring_at(d, r, ring_width) * fade;
	float blu = ring_at(d, r - chroma, ring_width) * fade;
	float core = smoothstep(0.55, 0.0, d) * fade * fade;
	vec3 c = vec3(red, grn * 0.35, blu * 0.9) * color.rgb * 1.6 + color.rgb * core * 1.2;
	float a = clamp(max(max(red, grn), max(blu, core)) * color.a, 0.0, 1.0);
	COLOR = vec4(c, a);
}
