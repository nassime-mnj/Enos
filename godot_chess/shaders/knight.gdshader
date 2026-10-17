shader_type canvas_item;
#include "res://shaders/recolor.gdshaderinc"
#include "res://shaders/motion_blur.gdshaderinc"
// CAVALIER : tout le matériau de piece.gdshader (squash & stretch, sillage, halo de sélection, recoloration par thème)
// + ÉMISSION HDR DES YEUX. Le masque d'émission ne touche que l'œil du cheval :
//   - soit une texture `eye_mask` (canal rouge, blanc = œil) alignée sur le sprite -> use_eye_mask = true ;
//   - soit, par défaut, une ellipse douce placée par `eye_uv` (UV du sprite), `eye_size` (demi-axes en pixels de texture) et `eye_angle`.
// Couleur et puissance : eye_color + eye_intensity (multiplicateur HDR : > 1.0 dépasse le blanc, et c'est le Glow du WorldEnvironment
// qui en fait un halo). eye_rage 0..1 : colère -> rouge intense, puissance x2.5, palpitation rapide.
// (Le bloc mouvement/sillage/halo est volontairement identique à piece.gdshader : un canvas_item n'accepte qu'un seul shader.)

uniform vec2  velocity = vec2(0.0);
uniform float stretch : hint_range(0.0, 1.0) = 0.0;
uniform float trail   : hint_range(0.0, 1.0) = 0.0;
uniform vec4  trail_color : source_color = vec4(1.0, 0.12, 0.18, 1.0);
uniform float trail_length = 0.12;

uniform float glow : hint_range(0.0, 1.0) = 0.0;
uniform vec4  glow_color : source_color = vec4(0.08, 0.95, 1.0, 1.0);
uniform float radius = 20.0;
uniform float pulse_speed = 5.0;
uniform float holo = 0.35;
uniform float hue_shift : hint_range(0.0, 1.0) = 0.0;

// --- émission des yeux ---
uniform sampler2D eye_mask : hint_default_black, filter_linear;
uniform bool  use_eye_mask = false;
uniform vec2  eye_uv = vec2(0.61, 0.30);                   // position de l'œil (sprites 352x500 du thème « classic »)
uniform vec2  eye_size = vec2(9.0, 5.0);                   // demi-axes de l'œil, en pixels de texture
uniform float eye_angle = -0.35;                           // inclinaison (radians)
uniform vec4  eye_color : source_color = vec4(1.0, 0.05, 0.04, 1.0);
uniform float eye_intensity : hint_range(0.0, 16.0) = 2.0; // multiplicateur HDR
uniform float eye_halo : hint_range(0.0, 1.0) = 0.5;       // halo intégré (visible même sans Glow)
uniform float eye_rage : hint_range(0.0, 1.0) = 0.0;

vec3 hue_rot(vec3 c, float h) {
	float a = h * 6.2831853;
	vec3 k = vec3(0.57735026);
	return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

varying vec2 v_dir;

void vertex() {
	float len = length(velocity);
	v_dir = len > 0.001 ? velocity / len : vec2(0.0);
	if (len > 0.001) {
		vec2 along = v_dir * dot(VERTEX, v_dir);
		VERTEX = along * (1.0 + 0.45 * stretch) + (VERTEX - along) * (1.0 - 0.20 * stretch);
	}
}

// Masque d'émission 0..1 (px = TEXTURE_PIXEL_SIZE)
float eye_emission_mask(vec2 uv, vec2 px) {
	if (use_eye_mask) {
		return texture(eye_mask, uv).r;
	}
	vec2 d = (uv - eye_uv) / px;
	float c = cos(eye_angle);
	float s = sin(eye_angle);
	d = vec2(c * d.x + s * d.y, -s * d.x + c * d.y);
	return 1.0 - smoothstep(0.55, 1.0, length(d / eye_size));
}

void fragment() {
	vec2 px = TEXTURE_PIXEL_SIZE;
	vec4 base = motion_blur_sample(TEXTURE, UV, v_dir, px);       // flou de mouvement directionnel (inactif hors déplacement)

	float tr = 0.0;
	if (trail > 0.001 && length(v_dir) > 0.0) {
		for (int i = 1; i <= 8; i++) {
			float k = float(i) / 8.0;
			tr += texture(TEXTURE, UV - v_dir * trail_length * k * trail).a * (1.0 - k);
		}
		tr = clamp(tr / 8.0 * 2.2, 0.0, 0.8);
	}

	float halo = 0.0;
	if (glow > 0.001) {
		for (int i = 0; i < 16; i++) {
			float ang = float(i) * 0.3926991;
			vec2 dir = vec2(cos(ang), sin(ang));
			halo = max(halo, texture(TEXTURE, UV + dir * px * radius).a);
			halo = max(halo, texture(TEXTURE, UV + dir * px * radius * 0.5).a);
		}
	}
	float pulse = 0.75 + 0.25 * sin(TIME * pulse_speed);
	float outer = halo * (1.0 - base.a) * glow * pulse;

	vec3 rgb = apply_tint(base.rgb, UV);
	if (holo > 0.001 && glow > 0.001) {
		float r = texture(TEXTURE, UV + vec2(px.x * 2.0, 0.0)).r;
		float b = texture(TEXTURE, UV - vec2(px.x * 2.0, 0.0)).b;
		rgb = mix(rgb, vec3(r, rgb.g, b), holo * glow);
		float scan = 0.5 + 0.5 * sin(UV.y / max(px.y, 0.0001) * 0.5 - TIME * 8.0);
		rgb *= 1.0 + (scan - 0.5) * 0.25 * holo * glow;
	}
	if (hue_shift > 0.001) {
		float sat = max(rgb.r, max(rgb.g, rgb.b)) - min(rgb.r, min(rgb.g, rgb.b));
		rgb = mix(rgb, clamp(hue_rot(rgb, hue_shift), 0.0, 1.0), smoothstep(0.12, 0.32, sat));
		float lum_p = dot(rgb, vec3(0.299, 0.587, 0.114));           // tons peu saturés (le blanc glacé bleuté) -> blanc nacré légèrement lime
		rgb = mix(rgb, lum_p * vec3(0.985, 1.0, 0.95), (1.0 - smoothstep(0.10, 0.30, sat)) * 0.85);
	}
	rgb += glow_color.rgb * 0.22 * glow * pulse * base.a;

	// ÉMISSION HDR : l'œil remplace la couleur du sprite (non clampée) ; cœur plus blanc ; halo doux autour
	float beat = 1.0 + eye_rage * 0.35 * sin(TIME * 16.0);
	float power = max(eye_intensity * mix(1.0, 2.5, eye_rage), eye_rage * 6.0) * beat;
	float m = power > 0.001 ? clamp(eye_emission_mask(UV, px), 0.0, 1.0) * base.a : 0.0;   // puissance 0 : l'œil d'origine du sprite reste intact
	vec3 hot = mix(eye_color.rgb, vec3(1.0), 0.30 * m * m * m);
	vec3 rage_col = mix(hot, vec3(1.0, 0.02, 0.02), eye_rage);
	rgb = mix(rgb, rage_col * power, m);
	vec2 dh = (UV - eye_uv) / px;
	float halo_e = exp(-dot(dh, dh) / (2.0 * 22.0 * 22.0));
	rgb += rage_col * power * 0.22 * eye_halo * halo_e * base.a;

	float under_a = clamp(outer + tr * (1.0 - base.a), 0.0, 1.0);
	vec3 under_c = (glow_color.rgb * 1.5 * outer + trail_color.rgb * tr) / max(outer + tr, 0.0001);
	COLOR = vec4(mix(under_c, rgb, base.a), max(base.a, under_a));
}
