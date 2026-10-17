shader_type canvas_item;
// CONTOUR NEON GLOBAL — appliqué sur la texture du SubViewport qui contient UNIQUEMENT la TileMap.
//
// Principe : la TileMap est rendue seule sur une texture transparente. Son canal alpha est la SILHOUETTE GLOBALE :
// deux tuiles collées forment une zone d'alpha continue, il n'existe donc AUCUNE arête interne à détecter.
// Pour chaque pixel VIDE, on cherche la distance au pixel plein le plus proche (anneaux d'échantillons) ;
// le néon n'est dessiné qu'à l'EXTÉRIEUR de la silhouette, jamais sur/entre les tuiles.

uniform vec4 neon_color : source_color = vec4(0.1, 0.95, 1.0, 1.0);
uniform float width_px = 8.0;               // épaisseur du halo, en pixels du viewport
uniform float core_px = 1.6;                // épaisseur du trait lumineux collé à la forme
uniform float falloff : hint_range(0.5, 6.0) = 2.2;   // chute du halo (plus grand = halo plus serré)
uniform float glow_intensity : hint_range(0.0, 8.0) = 1.4;   // luminosité du halo (>1 = HDR, accroche le Glow)
uniform float core_intensity : hint_range(0.0, 8.0) = 3.5;   // luminosité du trait central (HDR)
uniform float pulse_speed = 1.4;
uniform float pulse_amount : hint_range(0.0, 1.0) = 0.15;
uniform int rings : hint_range(2, 12) = 6;  // qualité (échantillons radiaux) : 6 suffit pour width_px <= 12
uniform float supersample = 1.0;            // doit valoir le supersample du SubViewport (le script le règle)

const int DIRS = 16;
const float TAU_F = 6.28318530718;

float solid(sampler2D tex, vec2 uv) {
	return texture(tex, uv).a;
}

void fragment() {
	float inside = solid(TEXTURE, UV);
	if (inside > 0.02) {
		COLOR = vec4(0.0);                  // sur la plateforme : rien (la TileMap normale reste visible par-dessus)
	} else {
		float reach = width_px * supersample;
		float dist = reach + 1.0;
		for (int r = 1; r <= rings; r++) {
			float rad = reach * float(r) / float(rings);
			for (int i = 0; i < DIRS; i++) {
				float ang = TAU_F * (float(i) + 0.5 * float(r & 1)) / float(DIRS);   // anneaux décalés : moins de crénelage
				vec2 off = vec2(cos(ang), sin(ang)) * rad * TEXTURE_PIXEL_SIZE;
				if (solid(TEXTURE, UV + off) > 0.5) {
					dist = min(dist, rad);
				}
			}
		}
		if (dist > reach) {
			COLOR = vec4(0.0);
		} else {
			float t = dist / reach;
			float halo = pow(1.0 - t, falloff);
			float core = 1.0 - smoothstep(0.0, core_px * supersample, dist);
			float pulse = 1.0 + pulse_amount * sin(TIME * pulse_speed);
			vec3 rgb = neon_color.rgb * (halo * glow_intensity + core * core_intensity) * pulse;
			COLOR = vec4(rgb, clamp(halo + core, 0.0, 1.0));
		}
	}
}
