"use strict";
// TEMPS FORTS (pour MultiEdit) : pendant une série, chaque action d'un jeu 3D est ENREGISTRÉE (pas filmée) :
//   positions / rotations des objets suivis (balle, palets, quilles, bras du moulin…) et de la caméra, image par image, + les chocs (rebonds, but, coupe, strike)
//   avec leur instant et leur position. Au montage, la scène est reconstruite hors écran et recalculée en 4K à 60 i/s, avec ralentis, caméra et effets
//   calés sur la musique (js/m_multiedit.js). Aucune vidéo pendant la partie : le téléphone ne rame pas.
//   - le jeu déclare ce qu'il faut suivre : api.clip.track(objets, caméra, réglagesDeReconstruction)
//   - api.clip.begin() juste avant l'action, api.clip.event(type, position, intensité) à chaque choc, api.clip.mark() au moment clé,
//     api.clip.end({score, label, sub}, délai) une fois l'action retombée ; api.clip.cancel() si rien de spectaculaire
//   - seuls les meilleurs moments de chaque partie sont gardés
(() => {
  const E = window.ENOS;
  const H = (E.hl = { active: false, clips: [], game: null, keep: 6 });
  let cur = null, objs = [], cam = null, meta = null, seq = 0, raf = 0;
  const MAXF = 60 * 16;                                          // 16 s au plus par moment
  H.supported = () => true;
  H.start = (game) => { H.cancel(); H.active = true; H.game = game; H.clips = []; objs = []; cam = null; meta = null; };
  H.stop = () => { H.cancel(); H.active = false; objs = []; cam = null; return H.clips.slice(); };
  H.recording = () => !!cur;
  /** objets suivis (dans un ordre que le mode « rejeu » du jeu reproduit à l'identique), caméra, et de quoi reconstruire la scène */
  H.track = (list, camera, m) => { objs = list.filter(Boolean); cam = camera || null; meta = m || null; };
  const snap = () => {
    if (!cur) return; const t = (performance.now() - cur.t0) / 1000, n = objs.length, d = new Float32Array(n * 9 + 8);
    for (let i = 0; i < n; i++) { const o = objs[i], k = i * 9; o.updateMatrixWorld && o.updateMatrixWorld(); const p = o.position, q = o.quaternion; d[k] = p.x; d[k + 1] = p.y; d[k + 2] = p.z; d[k + 3] = q.x; d[k + 4] = q.y; d[k + 5] = q.z; d[k + 6] = q.w; d[k + 7] = o.scale.x; d[k + 8] = o.visible ? 1 : 0; }
    if (cam) { const k = n * 9, p = cam.position, q = cam.quaternion; d[k] = p.x; d[k + 1] = p.y; d[k + 2] = p.z; d[k + 3] = q.x; d[k + 4] = q.y; d[k + 5] = q.z; d[k + 6] = q.w; d[k + 7] = cam.fov || 40; }
    cur.frames.push({ t, d }); if (cur.frames.length > MAXF) cur.frames.shift();
  };
  const loop = () => { snap(); raf = requestAnimationFrame(loop); };
  H.begin = (tag) => {
    if (!H.active || cur || !objs.length) return false;
    cur = { tag: tag || "", t0: performance.now(), frames: [], events: [], marks: [] }; cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); return true;
  };
  H.event = (k, pos, v) => { if (!cur) return; cur.events.push({ k, t: (performance.now() - cur.t0) / 1000, p: pos ? [pos.x || 0, pos.y || 0, pos.z || 0] : null, v: v == null ? 1 : v }); };
  H.mark = (k) => { if (!cur) return; const t = (performance.now() - cur.t0) / 1000; cur.marks.push({ k: k || "", t }); cur.events.push({ k: "key", t, v: 1, label: k || "" }); };
  H.cancel = () => { cur = null; cancelAnimationFrame(raf); };
  /** termine le moment ; info : {score, label, sub, ...} ; score <= 0 : jeté */
  H.end = (info) => new Promise((res) => {
    const c = cur; cur = null; cancelAnimationFrame(raf); if (!c) return res(null);
    info = info || {}; if (!(info.score > 0) || c.frames.length < 8) return res(null);
    const t0 = c.frames[0].t; c.frames.forEach((f) => (f.t -= t0)); c.events.forEach((e) => (e.t -= t0)); c.marks.forEach((m) => (m.t -= t0));
    const dur = c.frames[c.frames.length - 1].t, at = info.at != null ? info.at - t0 : c.marks.length ? c.marks[c.marks.length - 1].t : dur * 0.7;
    const clip = Object.assign({ rp: { frames: c.frames, events: c.events, n: objs.length, cam: !!cam }, meta: meta ? JSON.parse(JSON.stringify(meta)) : null, dur, at: Math.max(0, Math.min(dur, at)), tag: c.tag, game: H.game, seq: seq++ }, info);
    H.clips.push(clip); H.clips.sort((a, b) => b.score - a.score); if (H.clips.length > H.keep) H.clips.length = H.keep;
    res(clip);
  });
  /** moment sans scène 3D (Néo-Cité) : seulement l'information */
  H.note = (info) => { if (!H.active || !(info && info.score > 0)) return; H.clips.push(Object.assign({ rp: null, meta: null, dur: 0, at: 0, game: H.game, seq: seq++ }, info)); H.clips.sort((a, b) => b.score - a.score); if (H.clips.length > H.keep) H.clips.length = H.keep; };
})();
