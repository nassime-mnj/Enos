shader_type canvas_item;
// BOULE D'ETO : sphère nacrée blanche, bord bleu glacé, lumière réfléchie en bas, reflet doux en haut à gauche (miroir du rendu SVG de static/eto_face.js).
void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float d = length(p);
	float aa = fwidth(d) * 1.2;
	float a = 1.0 - smoothstep(1.0 - aa, 1.0, d);
	// dégradé principal (centre de lumière haut-gauche)
	float r1 = length(UV - vec2(0.34, 0.27)) / 0.95;
	vec3 col = mix(vec3(1.0), vec3(0.965, 0.976, 1.0), smoothstep(0.0, 0.5, r1));
	col = mix(col, vec3(0.827, 0.886, 1.0), smoothstep(0.5, 1.0, r1));
	// liseré bleu sur le bord (volume)
	float rim = smoothstep(0.70, 1.0, d);
	col = mix(col, vec3(0.184, 0.42, 1.0), rim * 0.30);
	// lumière réfléchie par le bas
	float rb = length(UV - vec2(0.5, 1.0)) / 0.62;
	col = mix(col, vec3(0.61, 0.76, 1.0), (1.0 - clamp(rb, 0.0, 1.0)) * 0.55);
	// reflet doux + éclat net, en haut à gauche
	vec2 q = (UV - vec2(0.335, 0.235)) * vec2(1.0, 1.8);
	float h = 1.0 - smoothstep(0.0, 0.17, length(q));
	col = mix(col, vec3(1.0), h * 0.9);
	vec2 g = (UV - vec2(0.30, 0.19)) * vec2(1.0, 2.2);
	col = mix(col, vec3(1.0), (1.0 - smoothstep(0.03, 0.05, length(g))));
	COLOR = vec4(col, a);
}
