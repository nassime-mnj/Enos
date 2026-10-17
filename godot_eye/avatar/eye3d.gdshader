shader_type spatial;
render_mode cull_back, specular_schlick_ggx;
// ŒIL 3D D'E.N.O.S. — globe oculaire. Tout est calculé en espace OBJET : l'axe +Z est le regard, la pupille est donc toujours
// au bon endroit quand le globe tourne pour suivre le curseur.
//   speak : l'IA parle (iris incandescent)   flare : éblouissement   mood : colère 0..1 (pupille serrée, veines)   glitch : instabilité 0..1

uniform vec4 core_color : source_color = vec4(1.0, 0.07, 0.09, 1.0);
uniform float speak : hint_range(0.0, 1.0) = 0.0;
uniform float flare : hint_range(0.0, 1.0) = 0.0;
uniform float mood : hint_range(0.0, 1.0) = 0.25;
uniform float glitch : hint_range(0.0, 1.0) = 0.0;
uniform float pulse : hint_range(0.0, 1.0) = 0.5;      // battement lent (voix lissée + cœur)

varying vec3 lpos;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void vertex() {
	// GLITCH : des bandes horizontales du globe sont décalées de façon saccadée (24 images/s), seulement quand `glitch` monte
	float band = floor((VERTEX.y + 1.0) * 7.0);
	float h = hash(vec2(band, floor(TIME * 24.0)));
	float on = step(1.0 - glitch * 0.45, h);
	VERTEX.x += (hash(vec2(band, 3.0)) - 0.5) * 0.5 * glitch * on;
	VERTEX.z += on * glitch * 0.06;
	lpos = VERTEX;
}

void fragment() {
	vec3 n = normalize(lpos);
	float zf = clamp(n.z, -1.0, 1.0);
	vec2 q = n.xy / max(zf + 0.35, 0.2);                 // plan tangent au pôle avant (≈ angle)
	float qr = length(q);
	float qa = atan(q.y, q.x);

	// --- iris : fibres radiales + anneau limbique sombre
	float iris_r = 0.66;
	float k = qr / iris_r;
	float fib = noise(vec2(qa * 9.0, k * 7.0 - TIME * 0.1));
	float fib2 = noise(vec2(qa * 31.0, k * 15.0));
	vec3 iris_hot = vec3(0.95, 0.12, 0.05);
	vec3 iris = mix(vec3(0.28, 0.0, 0.02), iris_hot, clamp(fib * 0.65 + fib2 * 0.35, 0.0, 1.0));
	iris = mix(iris, vec3(1.0, 0.25, 0.1), smoothstep(0.55, 0.15, k) * 0.4);   // plus clair près de la pupille
	float iris_mask = 1.0 - smoothstep(0.82, 1.0, k);
	float limbal = smoothstep(0.78, 0.97, k) * (1.0 - smoothstep(0.97, 1.08, k));

	// --- pupille RONDE : large au repos, elle se resserre en un point menaçant quand E.N.O.S. parle (et avec la colère), avec un léger tremblement
	float menace = clamp(speak * 1.0 + mood * 0.35, 0.0, 1.0);
	float pr = mix(0.27, 0.085, menace) * (1.0 - 0.07 * speak * sin(TIME * 13.0));
	float pupil = 1.0 - smoothstep(0.85, 1.0, qr / pr);
	float rim = max(0.0, (1.0 - smoothstep(0.9, 1.35, qr / (pr * 1.55))) - pupil);

	// --- sclère sombre + veines rouges incandescentes (plus nombreuses quand E.N.O.S. est en colère)
	float v1 = abs(noise(vec2(qa * 6.0, qr * 5.0 + 3.0)) - 0.5);
	float v2 = abs(noise(vec2(qa * 14.0 + 7.0, qr * 9.0)) - 0.5);
	float veins = (1.0 - smoothstep(0.0, 0.045, v1)) * 0.8 + (1.0 - smoothstep(0.0, 0.03, v2)) * 0.5;
	veins *= smoothstep(0.7, 1.3, k) * (0.45 + 0.9 * mood);
	vec3 sclera = mix(vec3(0.04, 0.0, 0.01), vec3(0.16, 0.005, 0.02), 1.0 - zf * 0.5);

	vec3 albedo = mix(sclera, iris * 0.55, iris_mask);
	albedo = mix(albedo, vec3(0.0), max(pupil, limbal * 0.8));

	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.2);
	float beat = 0.55 + 0.9 * pulse;                      // la voix fait monter/descendre toute la lueur, lentement
	vec3 em = iris * iris_mask * (0.9 + 1.7 * speak + 1.4 * flare) * beat * (1.0 - pupil);
	em += core_color.rgb * rim * 1.4 * beat;
	em += core_color.rgb * veins * (0.8 + 1.2 * speak) * beat;
	em *= 1.0 - pupil * 0.97;                              // la pupille reste un trou noir
	em += core_color.rgb * fres * (0.8 + 1.2 * flare + 0.8 * speak);

	ALBEDO = albedo;
	EMISSION = em;
	ROUGHNESS = mix(mix(0.12, 0.55, iris_mask * 0.6), 1.0, pupil);
	SPECULAR = mix(0.85, 0.0, pupil);                       // aucun reflet dans la pupille : trou noir
	METALLIC = 0.0;
}
