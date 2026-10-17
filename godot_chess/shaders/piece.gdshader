shader_type canvas_item;
#include "res://shaders/recolor.gdshaderinc"
#include "res://shaders/motion_blur.gdshaderinc"
// PIÈCE : mouvement (squash & stretch + léger sillage rouge) + SÉLECTION (halo néon cyan pulsé, scintillement holographique).
// Un seul matériau par pièce (un canvas_item n'accepte qu'un shader). GDScript pilote : velocity, stretch, trail pendant le Tween ;
// glow à la sélection. Le long sillage est fait d'images fantômes (main.gd), car un shader ne dessine pas hors du rectangle du sprite.

uniform vec2  velocity = vec2(0.0);
uniform float stretch : hint_range(0.0, 1.0) = 0.0;
uniform float trail   : hint_range(0.0, 1.0) = 0.0;
uniform vec4  trail_color : source_color = vec4(1.0, 0.12, 0.18, 1.0);
uniform float trail_length = 0.12;

uniform float glow : hint_range(0.0, 1.0) = 0.0;
uniform vec4  glow_color : source_color = vec4(0.08, 0.95, 1.0, 1.0);
uniform float radius = 20.0;                   // épaisseur du halo en pixels de texture
uniform float pulse_speed = 5.0;
uniform float holo = 0.35;
uniform float hue_shift : hint_range(0.0, 1.0) = 0.0;   // ETO : les reflets rouges deviennent vert lime (rotation de teinte)

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
		// étire le long de la vitesse et pince en travers (volume conservé) ; l'origine du nœud (les pieds) reste le centre de la déformation
		vec2 along = v_dir * dot(VERTEX, v_dir);
		VERTEX = along * (1.0 + 0.45 * stretch) + (VERTEX - along) * (1.0 - 0.20 * stretch);
	}
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

	vec3 rgb = apply_tint(base.rgb, UV);                       // thème visuel dynamique (tint_amount = 0 : sans effet)
	if (holo > 0.001 && glow > 0.001) {
		float r = texture(TEXTURE, UV + vec2(px.x * 2.0, 0.0)).r;
		float b = texture(TEXTURE, UV - vec2(px.x * 2.0, 0.0)).b;
		rgb = mix(rgb, vec3(r, rgb.g, b), holo * glow);
		float scan = 0.5 + 0.5 * sin(UV.y / max(px.y, 0.0001) * 0.5 - TIME * 8.0);
		rgb *= 1.0 + (scan - 0.5) * 0.25 * holo * glow;
	}
	if (hue_shift > 0.001) {
		float sat = max(rgb.r, max(rgb.g, rgb.b)) - min(rgb.r, min(rgb.g, rgb.b));       // seuls les tons saturés (le rouge) tournent : le blanc glacé reste blanc
		rgb = mix(rgb, clamp(hue_rot(rgb, hue_shift), 0.0, 1.0), smoothstep(0.12, 0.32, sat));
		float lum_p = dot(rgb, vec3(0.299, 0.587, 0.114));           // tons peu saturés (le blanc glacé bleuté) -> blanc nacré légèrement lime
		rgb = mix(rgb, lum_p * vec3(0.985, 1.0, 0.95), (1.0 - smoothstep(0.10, 0.30, sat)) * 0.85);
	}
	rgb += glow_color.rgb * 0.22 * glow * pulse * base.a;     // éclat interne cyan

	float under_a = clamp(outer + tr * (1.0 - base.a), 0.0, 1.0);
	vec3 under_c = (glow_color.rgb * 1.5 * outer + trail_color.rgb * tr) / max(outer + tr, 0.0001);
	COLOR = vec4(mix(under_c, rgb, base.a), max(base.a, under_a));
}
