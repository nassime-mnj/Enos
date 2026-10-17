// Recoloration d'une pièce par la luminance de son sprite (fonctionne sur un sprite gris neutre comme sur l'art déjà coloré).
// Inclus par piece.gdshader et knight.gdshader. Piloté par visual_theme.gd :
//   tint_color  : teinte du matériau (or, argent, obsidienne…)     tint_amount : 0 = art d'origine, 1 = entièrement recoloré
//   metal       : 0 mat … 1 métal poli (contraste + reflet balayant)  gloss : netteté du reflet

uniform vec4  tint_color : source_color = vec4(1.0);
uniform float tint_amount : hint_range(0.0, 1.0) = 0.0;
uniform float metal : hint_range(0.0, 1.0) = 0.0;
uniform float gloss : hint_range(0.0, 1.0) = 0.5;

vec3 apply_tint(vec3 rgb, vec2 uv) {
	float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
	float shade = mix(0.28, 1.3, smoothstep(0.04, 0.95, lum));
	vec3 base = tint_color.rgb * shade;
	// métal : tons moyens plus sombres, hautes lumières plus vives (courbe en S)
	base = mix(base, pow(base, vec3(1.0 + 0.7 * metal)) * (1.0 + 0.6 * metal), metal);
	// reflet qui balaye la pièce en diagonale
	float sweep = pow(max(sin((uv.x * 1.3 + uv.y * 0.9) * 7.0 - TIME * 0.9), 0.0), mix(6.0, 30.0, gloss));
	vec3 spec = mix(vec3(1.0), tint_color.rgb, 0.45) * sweep * (0.12 + 0.5 * metal) * smoothstep(0.30, 0.9, lum);
	return mix(rgb, base + spec, tint_amount);
}
