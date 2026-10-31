shader_type canvas_item;
// Post-traitement plein écran : aberration chromatique RGB, screen-space shake, vignette sombre, teinte « rewind » pour les coups en accéléré.
uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap, repeat_disable;
uniform float aberration : hint_range(0.0, 0.05) = 0.0;   // décalage RGB (fraction de l'écran)
uniform vec2 shake = vec2(0.0);                              // décalage de l'image entière (fraction de l'écran)
uniform float vignette : hint_range(0.0, 1.5) = 0.85;
uniform float rewind : hint_range(0.0, 1.0) = 0.0;
uniform float flash : hint_range(0.0, 1.0) = 0.0;
uniform vec3 flash_color = vec3(1.0);

void fragment() {
	vec2 uv = SCREEN_UV + shake;
	vec2 dir = (uv - vec2(0.5)) * 1.0;
	float r = texture(screen_tex, uv + dir * aberration + vec2(aberration * 0.6, 0.0)).r;
	float g = texture(screen_tex, uv).g;
	float b = texture(screen_tex, uv - dir * aberration - vec2(aberration * 0.6, 0.0)).b;
	vec3 col = vec3(r, g, b);
	float d = distance(SCREEN_UV, vec2(0.5, 0.48));
	col *= 1.0 - smoothstep(0.30, 0.85, d) * vignette;
	float lum = dot(col, vec3(0.299, 0.587, 0.114));
	col = mix(col, vec3(lum) * vec3(0.55, 0.85, 1.0), rewind * 0.6);
	col += flash_color * flash;
	COLOR = vec4(col, 1.0);
}
