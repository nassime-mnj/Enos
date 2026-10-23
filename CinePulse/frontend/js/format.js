const p2 = (n) => String(n).padStart(2, "0");

/** HH:MM:SS:FF */
export function fmtTC(t, fps) {
  const f = Math.max(1, Math.round(fps));
  const total = Math.round(t * f);
  const frames = total % f;
  const s = Math.floor(total / f);
  return `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}:${p2(frames)}`;
}

/** m:ss.mmm — pour le calage à la milliseconde */
export function fmtMs(t) {
  const ms = Math.round(t * 1000);
  const m = Math.floor(ms / 60000);
  const s = Math.floor(ms / 1000) % 60;
  return `${m}:${p2(s)}.${String(ms % 1000).padStart(3, "0")}`;
}

/** Étiquette de graduation selon le pas (en secondes) */
export function fmtRuler(t, step) {
  const m = Math.floor(t / 60 + 1e-9);
  const s = t - m * 60;
  if (step >= 1) return `${m}:${p2(Math.round(s))}`;
  const dec = step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return m ? `${m}:${s.toFixed(dec).padStart(dec + 3, "0")}` : s.toFixed(dec);
}

export const fmtDur = (t) => (t == null ? "—" : t < 60 ? `${t.toFixed(2)} s` : fmtMs(t));
