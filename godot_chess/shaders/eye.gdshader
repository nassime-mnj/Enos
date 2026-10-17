shader_type canvas_item;
// L'ŒIL D'E.N.O.S. : orbe cybernétique rouge. Sphère vitrée (fresnel), iris à fibres radiales, trois anneaux techniques segmentés
// en rotation inverse, pupille ronde qui se resserre, couronne de rayons. Uniforms pilotés par main.gd :
//   speak : l'IA parle (battement rapide, iris incandescent)    flare : impact / capture / mat (éblouissement)
//   mood  : colère 0..1 (pupille serrée, anneaux plus rapides)  look  : direction du regard (-1..1)

uniform float speak : hint_range(0.0, 1.0) = 0.0;
uniform float flare : hint_range(0.0, 1.0) = 0.0;
uniform float mood  : hint_range(0.0, 1.0) = 0.25;
uniform vec2  look = vec2(0.0);
uniform vec4  core_color : source_color = vec4(1.0, 0.08, 0.1, 1.0);

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void fragment() {
	vec2 p = (UV - 0.5) * 2.0;
	float t = TIME;
	float beat = 1.0 + 0.035 * sin(t * 2.2) + 0.05 * speak * sin(t * 17.0) + 0.09 * flare;
	float R = 0.58 * beat;
	float r = length(p);
	float ang = atan(p.y, p.x);

	vec3 col = vec3(0.0);
	float alpha = 0.0;

	// halo + rayons de la couronne
	float out_d = max(r - R, 0.0);
	float halo = exp(-out_d * 4.5) * (0.5 + 0.35 * speak + 0.7 * flare);
	float rays = pow(noise(vec2(ang * 5.0 + t * 0.6, t * 0.8)), 3.0) * exp(-out_d * 3.0) * step(R, r);
	col += core_color.rgb * (halo * 0.7 + rays * (0.6 + flare));
	alpha = clamp(halo * 0.8 + rays, 0.0, 1.0);

	if (r < R) {
		float k = r / R;
		float z = sqrt(max(1.0 - k * k, 0.0));
		vec2 q = (p - look * 0.16 * z) / R;
		float qr = length(q);
		float qa = atan(q.y, q.x);

		vec3 body = mix(vec3(0.02, 0.0, 0.01), vec3(0.20, 0.0, 0.035), z);
		float fib = noise(vec2(qa * 7.0 + t * 0.15, qr * 9.0 - t * 0.4));
		float fib2 = noise(vec2(qa * 22.0 - t * 0.2, qr * 18.0));
		vec3 iris = mix(vec3(0.35, 0.0, 0.03), vec3(1.0, 0.28, 0.1), fib * 0.7 + fib2 * 0.3);
		float iris_mask = smoothstep(0.8, 0.7, qr) * smoothstep(0.08, 0.2, qr);

		float spin = t * (0.5 + mood * 2.4);
		float ring1 = smoothstep(0.035, 0.0, abs(qr - 0.64));
		float seg1 = step(0.5, fract((qa / 6.2831853) * 36.0 + spin));
		float ring2 = smoothstep(0.03, 0.0, abs(qr - 0.48));
		float seg2 = step(0.35, fract((qa / 6.2831853) * 12.0 - spin * 1.6));
		float ring3 = smoothstep(0.012, 0.0, abs(qr - 0.35));
		vec3 tech = core_color.rgb * (ring1 * seg1 * 1.4 + ring2 * seg2 * 1.1 + ring3 * 0.9);

		float menace = clamp(speak + mood * 0.35, 0.0, 1.0);                       // pupille RONDE : se resserre quand E.N.O.S. parle
		float pr = mix(0.21, 0.07, menace);
		float pupil = smoothstep(1.0, 0.85, length(q) / pr);
		float rim = max(0.0, smoothstep(1.0, 0.8, length(q) / (pr * 1.55)) - pupil);

		vec3 c = body + iris * iris_mask * (0.9 + 0.6 * speak + 0.9 * flare);
		c += tech;
		c += core_color.rgb * rim * 1.6;
		c = mix(c, vec3(0.0), pupil);

		float fres = pow(1.0 - z, 2.5);
		c += core_color.rgb * fres * (0.9 + flare);
		float spec = smoothstep(0.14, 0.0, length(p - vec2(-0.21, -0.24)));
		c += vec3(1.0, 0.85, 0.85) * spec * 0.6;
		c *= 0.93 + 0.07 * sin(UV.y * 260.0 + t * 6.0);

		col = c;
		alpha = 1.0;
	}
	COLOR = vec4(col, alpha);
}
