// NOYAU DE LA TIMELINE NLE : modèle du projet (EDL), pistes, magnétisme, placement sans chevauchement, historique, export EDL.
// Aucune dépendance au DOM : testable seul (frontend/dev/nle_test.html) et réutilisé tel quel par le rendu Canvas.
export const MIN_DUR = 0.1;                 // durée minimale d'un clip (secondes)
export const IMAGE_DUR = 5;                 // durée par défaut d'une image déposée
export const MIN_PPS = 2, MAX_PPS = 800;    // zoom : pixels par seconde

let seq = 0;
export const newId = (p = "c") => p + Date.now().toString(36) + (seq++).toString(36);
const clone = (o) => JSON.parse(JSON.stringify(o));

// ------------------------------------------------------------------------------------------ projet / pistes
export function createProject() {
  return { version: 1, fps: 30, tracks: [{ id: "V2", type: "video" }, { id: "V1", type: "video" }, { id: "A1", type: "audio" }, { id: "A2", type: "audio" }], clips: [] };
}

/** Ajoute une piste : les vidéos s'empilent AU-DESSUS (V3 au sommet), les audios EN DESSOUS. Retourne l'id. */
export function addTrack(p, type) {
  const pre = type === "audio" ? "A" : "V";
  const n = Math.max(0, ...p.tracks.filter((t) => t.type === type).map((t) => +t.id.slice(1))) + 1;
  const t = { id: pre + n, type };
  if (type === "audio") p.tracks.push(t); else p.tracks.splice(0, 0, t);
  return t.id;
}

/** Supprime une piste vide (jamais la dernière de son type). Retourne true si supprimée. */
export function removeTrack(p, id) {
  const t = p.tracks.find((x) => x.id === id);
  if (!t || p.clips.some((c) => c.track === id) || p.tracks.filter((x) => x.type === t.type).length < 2) return false;
  p.tracks.splice(p.tracks.indexOf(t), 1);
  return true;
}

/** Une piste vidéo accueille vidéos et images ; une piste audio n'accueille que de l'audio. */
export const canHost = (track, kind) => !!track && (track.type === "audio" ? kind === "audio" : kind === "video" || kind === "image");
export const clipEnd = (c) => c.start + c.dur;
export const projectDuration = (p) => p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);

/** Clip avec toutes les propriétés de l'EDL (valeurs neutres) : l'inspecteur et le moteur FFmpeg les lisent telles quelles. */
export function makeClip(asset, trackId, start) {
  const known = asset.kind === "image" ? IMAGE_DUR : asset.duration || IMAGE_DUR;
  return { id: newId(), asset: asset.id, kind: asset.kind, name: asset.name, track: trackId, start: Math.max(0, start), dur: Math.max(MIN_DUR, known), in: 0,
           opacity: 1, volume: 1, scale: 1, x: 0, y: 0, fadeIn: 0, fadeOut: 0 };
}

// ------------------------------------------------------------------------------------------ propriétés animables + images-clés
/** Réglages d'un clip : bornes de l'interface (le moteur accepte un peu plus), valeur neutre. Seuls ces réglages s'animent. */
export const PROPS = {
  opacity: { min: 0, max: 1, def: 1, label: "Opacité", video: true },
  scale:   { min: 0.1, max: 3, def: 1, label: "Échelle", video: true },
  x:       { min: -1, max: 1, def: 0, label: "Position X", video: true },
  y:       { min: -1, max: 1, def: 0, label: "Position Y", video: true },
  volume:  { min: 0, max: 2, def: 1, label: "Volume", audio: true },
};
export const KF_EPS = 0.04;                 // deux images-clés plus proches que cela (s) n'en font qu'une
const clampProp = (prop, v) => Math.min(PROPS[prop].max, Math.max(PROPS[prop].min, v));
const r3 = (t) => Math.round(t * 1000) / 1000;

export const isAnimated = (clip, prop) => !!(clip.kf && clip.kf[prop] && clip.kf[prop].length);
export const relTime = (clip, t) => Math.min(clip.dur, Math.max(0, t - clip.start));

/** Valeur d'un réglage à l'instant `rel` (s depuis le début du clip) : interpolation linéaire entre images-clés, constante avant / après. Identique au moteur Python. */
export function valueAt(clip, prop, rel) {
  const pts = clip.kf && clip.kf[prop];
  if (!pts || !pts.length) return clip[prop];
  if (rel <= pts[0].t) return pts[0].v;
  for (let i = 1; i < pts.length; i++) if (rel < pts[i].t) { const a = pts[i - 1], b = pts[i]; return a.v + (b.v - a.v) * (rel - a.t) / (b.t - a.t); }
  return pts[pts.length - 1].v;
}

export function keyframeNear(clip, prop, rel) {
  return (clip.kf && clip.kf[prop] || []).find((k) => Math.abs(k.t - rel) < KF_EPS) || null;
}

/** Pose (ou remplace) une image-clé. Le clip devient « animé » pour ce réglage. */
export function setKeyframe(clip, prop, rel, v) {
  const t = r3(Math.min(clip.dur, Math.max(0, rel))), val = clampProp(prop, v);
  const list = ((clip.kf ||= {})[prop] ||= []);
  const near = list.find((k) => Math.abs(k.t - t) < KF_EPS);
  if (near) near.v = val; else { list.push({ t, v: val }); list.sort((a, b) => a.t - b.t); }
  return val;
}

/** Retire l'image-clé proche de `rel`. La dernière retirée fige le réglage à sa valeur (pas de saut visuel). */
export function removeKeyframe(clip, prop, rel) {
  const list = clip.kf && clip.kf[prop], k = list && keyframeNear(clip, prop, rel);
  if (!k) return false;
  list.splice(list.indexOf(k), 1);
  if (!list.length) { clip[prop] = k.v; delete clip.kf[prop]; if (!Object.keys(clip.kf).length) delete clip.kf; }
  return true;
}

/** Supprime l'animation d'un réglage : il garde sa valeur à l'instant `rel`. */
export function clearAnimation(clip, prop, rel) {
  if (!isAnimated(clip, prop)) return;
  clip[prop] = valueAt(clip, prop, rel);
  delete clip.kf[prop];
  if (!Object.keys(clip.kf).length) delete clip.kf;
}

/** Modifie un réglage : sans animation, la valeur du clip ; avec animation, l'image-clé à l'instant `rel` (comme un montage pro). */
export function setValue(clip, prop, rel, v) {
  if (isAnimated(clip, prop)) return setKeyframe(clip, prop, rel, v);
  return (clip[prop] = clampProp(prop, v));
}

/** Remet tous les réglages d'un clip à leurs valeurs neutres (fondus, animations et transition compris). */
export function resetClip(clip) {
  for (const [p, d] of Object.entries(PROPS)) clip[p] = d.def;
  clip.fadeIn = 0; clip.fadeOut = 0;
  delete clip.kf; delete clip.trIn;
}

/** Images-clés après un rognage / une coupe : `shift` = secondes retirées au DÉBUT du clip, `dur` = nouvelle durée. Les valeurs aux nouvelles bornes sont conservées. */
export function retimeKeyframes(clip, shift, dur) {
  if (!clip.kf) return undefined;
  const out = {};
  for (const [p, pts] of Object.entries(clip.kf)) {
    if (!pts.length) continue;
    const inner = pts.filter((k) => k.t - shift > KF_EPS && k.t - shift < dur - KF_EPS).map((k) => ({ t: r3(k.t - shift), v: k.v }));
    out[p] = [{ t: 0, v: valueAt(clip, p, shift) }, ...inner, { t: r3(dur), v: valueAt(clip, p, shift + dur) }];
  }
  return Object.keys(out).length ? out : undefined;
}

/** Garde cohérents fondus et images-clés après un changement de durée. */
export function normalizeClip(clip) {
  clip.fadeIn = Math.min(clip.fadeIn || 0, clip.dur); clip.fadeOut = Math.min(clip.fadeOut || 0, clip.dur);
  if (clip.fadeIn + clip.fadeOut > clip.dur + 1e-6) { const k = clip.dur / (clip.fadeIn + clip.fadeOut); clip.fadeIn *= k; clip.fadeOut *= k; }
  if (clip.kf) {
    for (const p of Object.keys(clip.kf)) { clip.kf[p] = clip.kf[p].filter((k) => k.t <= clip.dur + 1e-6); if (!clip.kf[p].length) delete clip.kf[p]; }
    if (!Object.keys(clip.kf).length) delete clip.kf;
  }
}

// ------------------------------------------------------------------------------------------ coupe
/** Coupe le clip à l'instant `t` (temps de la timeline). Retourne le nouveau clip (partie droite) ou null si `t` n'est pas franchement à l'intérieur. */
export function splitClip(p, clip, t) {
  if (t < clip.start + MIN_DUR || t > clipEnd(clip) - MIN_DUR) return null;
  const cut = t - clip.start, right = clone(clip);
  right.id = newId(); right.start = t; right.dur = clip.dur - cut;
  right.in = clip.kind === "image" ? 0 : clip.in + cut;
  right.kf = retimeKeyframes(clip, cut, right.dur); if (!right.kf) delete right.kf;
  const leftKf = retimeKeyframes(clip, 0, cut);
  clip.dur = cut; clip.fadeOut = 0; right.fadeIn = 0; delete right.trIn;
  if (leftKf) clip.kf = leftKf; else delete clip.kf;
  normalizeClip(clip); normalizeClip(right);
  p.clips.push(right);
  return right;
}

// ------------------------------------------------------------------------------------------ transitions entre deux clips collés
export const ADJ = 0.05;                    // deux clips sont « collés » si l'écart est inférieur à cela (s)
export const TRANSITIONS = [{ type: "cut", label: "Coupe" }, { type: "crossfade", label: "Fondu enchaîné" }, { type: "dip", label: "Fondu au noir" }];
export const TRANSITION_DURS = [0.25, 0.5, 1, 2];

/** Jonctions : couples (A, B) de clips d'une même piste, B commençant là où A finit. -> [{a, b, track, time}] */
export function junctions(p) {
  const out = [], by = new Map();
  for (const c of p.clips) { if (!by.has(c.track)) by.set(c.track, []); by.get(c.track).push(c); }
  for (const [track, list] of by) {
    list.sort((x, y) => x.start - y.start);
    for (let i = 1; i < list.length; i++) if (Math.abs(clipEnd(list[i - 1]) - list[i].start) <= ADJ) out.push({ a: list[i - 1], b: list[i], track, time: list[i].start });
  }
  return out;
}

/** Transition actuelle d'une jonction : coupe, fondu enchaîné (b.trIn) ou fondu au noir (fondu de sortie de A + fondu d'entrée de B). */
export function transitionOf(a, b) {
  if (b.trIn && b.trIn.type === "crossfade" && b.trIn.dur >= 0.04) return { type: "crossfade", dur: b.trIn.dur };
  if (a.fadeOut > 0.01 && b.fadeIn > 0.01) return { type: "dip", dur: Math.min(a.fadeOut, b.fadeIn) };
  return { type: "cut", dur: 0 };
}

export const maxTransitionDur = (a, b) => Math.max(0.1, Math.min(a.dur, b.dur, 5));

/** Applique une transition à une jonction. La jonction possède les fondus de ses deux bords : « coupe » les remet à zéro. */
export function setTransition(a, b, type, dur = 0.5) {
  const d = Math.min(maxTransitionDur(a, b), Math.max(0.1, dur));
  delete b.trIn; a.fadeOut = 0; b.fadeIn = 0;
  if (type === "crossfade") b.trIn = { type: "crossfade", dur: d };
  else if (type === "dip") { a.fadeOut = d; b.fadeIn = d; normalizeClip(a); normalizeClip(b); }
}

// ------------------------------------------------------------------------------------------ magnétisme
/** Points d'accroche : début de projet, tête de lecture, bords de tous les autres clips. */
export function snapPoints(p, excludeIds, playhead) {
  const pts = [0, playhead];
  for (const c of p.clips) if (!excludeIds.has(c.id)) pts.push(c.start, clipEnd(c));
  return pts;
}

/** Valeur ramenée au point le plus proche si elle est à moins de `thr` secondes. -> {value, point|null} */
export function snap(value, pts, thr) {
  let best = null, d = thr;
  for (const q of pts) { const x = Math.abs(q - value); if (x <= d) { d = x; best = q; } }
  return best == null ? { value, point: null } : { value: best, point: best };
}

/** Déplacement : colle le DÉBUT ou la FIN du clip sur un point d'accroche (le plus proche des deux). -> {start, point|null} */
export function snapMove(pts, start, dur, thr) {
  const a = snap(start, pts, thr), b = snap(start + dur, pts, thr);
  if (a.point == null && b.point == null) return { start, point: null };
  const da = a.point == null ? Infinity : Math.abs(a.point - start), db = b.point == null ? Infinity : Math.abs(b.point - (start + dur));
  return da <= db ? { start: a.value, point: a.point } : { start: b.value - dur, point: b.point };
}

// ------------------------------------------------------------------------------------------ placement sans chevauchement
const lane = (p, trackId, excludeId) => p.clips.filter((c) => c.track === trackId && c.id !== excludeId).sort((a, b) => a.start - b.start);
const overlaps = (list, s, d) => list.some((c) => s < clipEnd(c) - 1e-6 && s + d > c.start + 1e-6);

/** Position libre la plus proche de `desired` sur la piste (jamais avant 0). Les clips d'une même piste ne se chevauchent pas. */
export function nearestFreeStart(p, trackId, dur, desired, excludeId) {
  const list = lane(p, trackId, excludeId), want = Math.max(0, desired);
  if (!overlaps(list, want, dur)) return want;
  const cands = [0];
  for (const c of list) cands.push(clipEnd(c), c.start - dur);
  return cands.filter((s) => s >= 0 && !overlaps(list, s, dur)).sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
}

/** Bornes de redimensionnement : un clip ne peut ni traverser son voisin ni sortir de la timeline. -> {minStart, maxEnd} */
export function neighbours(p, clip) {
  let minStart = 0, maxEnd = Infinity;
  for (const c of lane(p, clip.track, clip.id)) {
    if (clipEnd(c) <= clip.start + 1e-6) minStart = Math.max(minStart, clipEnd(c));
    else if (c.start >= clipEnd(clip) - 1e-6) maxEnd = Math.min(maxEnd, c.start);
  }
  return { minStart, maxEnd };
}

/** Durée maximale d'un clip : médias vidéo / audio limités à ce qui reste après le point d'entrée ; les images s'étirent à l'infini (-loop 1 au rendu). */
export const maxDur = (clip, asset) => (clip.kind === "image" || !asset || !asset.duration ? Infinity : Math.max(MIN_DUR, asset.duration - clip.in));

/** Redimensionne le bord droit (étirement / rognage) : applique le magnétisme puis les bornes. Retourne les nouvelles valeurs sans modifier le clip. */
export function resizeRight(p, clip, asset, wantEnd, pts, thr) {
  const { maxEnd } = neighbours(p, clip);
  const s = pts ? snap(wantEnd, pts, thr) : { value: wantEnd, point: null };
  const end = Math.min(Math.max(s.value, clip.start + MIN_DUR), clip.start + maxDur(clip, asset), maxEnd);
  return { dur: end - clip.start, in: clip.in, start: clip.start, point: s.point != null && Math.abs(end - s.point) < 1e-6 ? s.point : null };
}

/** Redimensionne le bord gauche : le point d'entrée avance avec le début (le contenu ne glisse pas) ; impossible de reculer avant le début du média. */
export function resizeLeft(p, clip, wantStart, pts, thr) {
  const { minStart } = neighbours(p, clip);
  const s = pts ? snap(wantStart, pts, thr) : { value: wantStart, point: null };
  const lo = Math.max(minStart, clip.kind === "image" ? 0 : clip.start - clip.in);
  const start = Math.min(Math.max(s.value, lo), clipEnd(clip) - MIN_DUR);
  const delta = start - clip.start;
  return { start, dur: clip.dur - delta, in: clip.kind === "image" ? 0 : clip.in + delta, point: s.point != null && Math.abs(start - s.point) < 1e-6 ? s.point : null };
}

// ------------------------------------------------------------------------------------------ vue (temps <-> pixels)
export const clampPps = (v) => Math.min(MAX_PPS, Math.max(MIN_PPS, v));

/** Zoom centré sur un point de l'écran : le temps sous `anchorX` ne bouge pas. `anchorX` est relatif au début de la zone des clips. */
export function zoomAt(view, newPps, anchorX) {
  const pps = clampPps(newPps), t = (view.scrollX + anchorX) / view.pps;
  view.pps = pps;
  view.scrollX = Math.max(0, t * pps - anchorX);
  return view;
}

/** Pas de la règle (secondes) et sous-divisions selon le zoom : ~80 px entre deux graduations principales. */
export function rulerStep(pps) {
  const steps = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  return steps.find((s) => s * pps >= 80) || 3600;
}

export function formatTime(t, fps = 30) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60), f = Math.floor((t % 1) * fps);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

// ------------------------------------------------------------------------------------------ historique (annuler / rétablir)
export class History {
  constructor(limit = 100) { this.limit = limit; this.undo = []; this.redo = []; }
  /** À appeler AVANT une modification : mémorise l'état courant. */
  push(p) { this.pushRaw(JSON.stringify(p)); }
  /** Variante avec un état déjà sérialisé (pris au début d'un geste, enregistré seulement si le geste a changé quelque chose). */
  pushRaw(s) { this.undo.push(s); if (this.undo.length > this.limit) this.undo.shift(); this.redo.length = 0; }
  back(p) { if (!this.undo.length) return null; this.redo.push(JSON.stringify(p)); return JSON.parse(this.undo.pop()); }
  forward(p) { if (!this.redo.length) return null; this.undo.push(JSON.stringify(p)); return JSON.parse(this.redo.pop()); }
  get canUndo() { return this.undo.length > 0; }
  get canRedo() { return this.redo.length > 0; }
}

// ------------------------------------------------------------------------------------------ EDL (envoyée au moteur de rendu)
/** Décrit la timeline pour le backend (cinepulse_engine) : pistes dans l'ordre d'empilement, clips triés, durée totale. Les pistes vides sont omises. */
export function toEDL(p) {
  const used = new Set(p.clips.map((c) => c.track));
  return clone({ version: 1, fps: p.fps, duration: projectDuration(p), tracks: p.tracks.filter((t) => used.has(t.id)),
                 clips: [...p.clips].sort((a, b) => a.start - b.start || a.track.localeCompare(b.track)) });
}
