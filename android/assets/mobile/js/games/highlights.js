"use strict";
// TEMPS FORTS (pour MultiEdit) : pendant une série MultiEdit, chaque action d'un jeu 3D est filmée depuis son canvas (MediaRecorder), puis notée.
//   - le jeu appelle api.clip.begin() juste avant l'action (visée, élan), api.clip.mark() au moment clé (but, coupe, strike, loyer),
//     puis api.clip.end({score, label, sub}, délai) une fois l'action retombée ; api.clip.cancel() si rien de spectaculaire
//   - seuls les 5 meilleurs moments de chaque partie sont gardés (les autres vidéos sont jetées tout de suite)
//   - hors série MultiEdit, tout est inactif : aucun enregistrement, aucun coût
(() => {
  const E = window.ENOS;
  const H = (E.hl = { active: false, clips: [], game: null, keep: 5 });
  let cur = null, getCanvas = null, seq = 0;
  H.supported = () => typeof MediaRecorder === "function" && !!HTMLCanvasElement.prototype.captureStream;
  const mime = () => ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } }) || "";
  /** début d'une partie filmée ; canvasFn() rend le canvas du jeu */
  H.start = (game, canvasFn) => { H.cancel(); H.active = true; H.game = game; H.clips = []; getCanvas = canvasFn; };
  /** fin de la partie : renvoie les meilleurs moments */
  H.stop = () => { H.cancel(); H.active = false; getCanvas = null; return H.clips.slice(); };
  H.recording = () => !!cur;
  H.begin = (tag) => {
    if (!H.active || cur || !H.supported()) return false;
    const cv = getCanvas && getCanvas(); if (!cv || !cv.captureStream) return false;
    try {
      const stream = cv.captureStream(30), m = mime(), r = new MediaRecorder(stream, m ? { mimeType: m, videoBitsPerSecond: 4000000 } : { videoBitsPerSecond: 4000000 });
      const c = { tag: tag || "", t0: performance.now(), chunks: [], r, stream, marks: [] };
      r.ondataavailable = (e) => { if (e.data && e.data.size) c.chunks.push(e.data); };
      r.start(250); cur = c; return true;
    } catch (e) { cur = null; return false; }
  };
  H.mark = (k) => { if (cur) cur.marks.push({ k: k || "", t: (performance.now() - cur.t0) / 1000 }); };
  H.cancel = () => { const c = cur; cur = null; if (!c) return; try { c.r.onstop = null; c.r.stop(); } catch (e) { /* déjà arrêté */ } try { c.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* rien */ } };
  /** termine le moment en cours ; info : {score, label, sub, ...} ; score <= 0 : jeté */
  H.end = (info) => new Promise((res) => {
    const c = cur; cur = null; if (!c) return res(null);
    info = info || {}; const dur = (performance.now() - c.t0) / 1000;
    if (!(info.score > 0)) { try { c.r.stop(); c.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* rien */ } return res(null); }
    c.r.onstop = () => {
      try { c.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* rien */ }
      const blob = new Blob(c.chunks, { type: (c.r.mimeType || "video/webm").split(";")[0] });
      const at = info.at != null ? info.at : c.marks.length ? c.marks[c.marks.length - 1].t : dur * 0.7;
      const clip = Object.assign({ blob, dur, at: Math.max(0, Math.min(dur, at)), tag: c.tag, game: H.game, marks: c.marks, seq: seq++ }, info);
      if (blob.size > 2000) { H.clips.push(clip); H.clips.sort((a, b) => b.score - a.score); if (H.clips.length > H.keep) H.clips.length = H.keep; }
      res(clip);
    };
    try { c.r.stop(); } catch (e) { res(null); }
  });
})();
