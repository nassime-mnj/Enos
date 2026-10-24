// MODÈLE D'APERÇU (pur, sans DOM) : quels calques et quels sons sont audibles / visibles à l'instant t, avec leur transparence et leur transformation.
// Mêmes règles que le moteur d'export (cinepulse_engine.py) pour l'ordre des calques, les images-clés, les fondus et le fondu enchaîné ; l'aperçu n'est qu'une
// approximation fluide, l'export FFmpeg reste la référence. En mode « allégé » les fondus et le fondu enchaîné sont ignorés (coupe, position, échelle, opacité restent).
import * as core from "./core.js";

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Fondu enchaîné : { [idClipA]: durée (prolongement de A), [idClipB]: durée }. Même validité que le moteur : clips collés, durée ≥ 0,04 s. */
export function crossfades(project) {
  const out = { a: {}, b: {} };
  for (const j of core.junctions(project)) {
    const t = core.transitionOf(j.a, j.b);
    if (t.type !== "crossfade") continue;
    const d = Math.min(t.dur, j.a.dur, j.b.dur);
    if (d >= 0.04) { out.a[j.a.id] = d; out.b[j.b.id] = d; }
  }
  return out;
}

/**
 * @param {object} project  @param {number} t  temps de la timeline
 * @param {{lite?: boolean, hasAudio?: (clip) => boolean}} opts
 * @returns {{video: object[], audio: object[]}}  video : du plus bas au plus haut {clip, srcTime, alpha, scale, x, y, tail} ; audio : {clip, srcTime, vol}
 */
export function layersAt(project, t, opts = {}) {
  const lite = !!opts.lite, xf = lite ? { a: {}, b: {} } : crossfades(project), video = [], audio = [];
  const rank = new Map(project.tracks.map((tr, i) => [tr.id, project.tracks.length - 1 - i]));
  for (const c of project.clips) {
    const tail = xf.a[c.id] || 0, end = c.start + c.dur;
    if (t < c.start - 1e-9 || t >= end + tail - 1e-9) continue;
    const rel = t - c.start, inTail = rel >= c.dur - 1e-9, r = Math.min(rel, c.dur);
    // facteur de fondu commun image / son : fondu d'entrée, fondu de sortie, fondu enchaîné (sortie de A prolongée, entrée de B)
    let fade = 1;
    if (!lite) {
      if (!xf.b[c.id] && c.fadeIn > 0.01 && rel < c.fadeIn) fade *= clamp01(rel / c.fadeIn);
      if (xf.b[c.id] && rel < xf.b[c.id]) fade *= clamp01(rel / xf.b[c.id]);                     // (le son de B entre en fondu ; l'image de B reste opaque, voir plus bas)
      if (tail) { if (inTail) fade *= clamp01(1 - (rel - c.dur) / tail); }
      else if (c.fadeOut > 0.01 && rel > c.dur - c.fadeOut) fade *= clamp01((c.dur - rel) / c.fadeOut);
    }
    const srcTime = c.kind === "image" ? 0 : c.in + rel;
    if (c.kind !== "audio") {
      let alpha = core.valueAt(c, "opacity", r);
      if (!lite) {                                                                               // image : B est opaque pendant le fondu enchaîné, c'est A (au-dessus) qui s'efface
        let f = 1;
        if (!xf.b[c.id] && c.fadeIn > 0.01 && rel < c.fadeIn) f *= clamp01(rel / c.fadeIn);
        if (tail) { if (inTail) f *= clamp01(1 - (rel - c.dur) / tail); }
        else if (c.fadeOut > 0.01 && rel > c.dur - c.fadeOut) f *= clamp01((c.dur - rel) / c.fadeOut);
        alpha *= f;
      }
      video.push({ clip: c, srcTime, alpha: clamp01(alpha), scale: core.valueAt(c, "scale", r), x: core.valueAt(c, "x", r), y: core.valueAt(c, "y", r), tail: inTail,
                   key: [rank.get(c.track), tail ? end + 1e-6 : c.start] });
    }
    if (c.kind === "audio" || (c.kind === "video" && opts.hasAudio && opts.hasAudio(c))) {
      audio.push({ clip: c, srcTime, vol: clamp01(core.valueAt(c, "volume", r) * fade) });
    }
  }
  video.sort((p, q) => p.key[0] - q.key[0] || p.key[1] - q.key[1]);
  return { video, audio };
}

/**
 * Gouverneur de fluidité : mesure l'intervalle entre images pendant la lecture. Trop lent (téléphone dépassé) -> mode allégé ; revient à l'aperçu complet
 * seulement après une longue période fluide (hystérésis, pour éviter de clignoter).
 */
export class FpsGovernor {
  constructor({ slowMs = 26, fastMs = 19, slowFrames = 40, fastFrames = 150 } = {}) {
    Object.assign(this, { slowMs, fastMs, slowFrames, fastFrames }); this.lite = false; this.reset();
  }
  reset() { this.win = []; this.calm = 0; }
  /** @returns {boolean|null} nouvel état (true = allégé) si l'état change, sinon null. dt en ms. Les pauses (> 250 ms) sont ignorées. */
  push(dt) {
    if (!(dt > 0) || dt > 250) { this.win = []; return null; }
    this.win.push(dt); if (this.win.length > this.slowFrames) this.win.shift();
    const avg = this.win.reduce((a, b) => a + b, 0) / this.win.length;
    if (!this.lite) {
      if (this.win.length >= this.slowFrames && avg > this.slowMs) { this.lite = true; this.calm = 0; this.win = []; return true; }
      return null;
    }
    this.calm = avg < this.fastMs && this.win.length >= Math.min(20, this.slowFrames) ? this.calm + 1 : 0;
    if (this.calm >= this.fastFrames) { this.lite = false; this.reset(); return false; }
    return null;
  }
}
