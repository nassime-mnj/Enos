// Pics de forme d'onde : calculés par FFmpeg côté serveur, ou décodés dans le navigateur à défaut.
import { api } from "./api.js";
import { getBuffer } from "./engine.js";

const cache = new Map();

export function getPeaks(asset) {
  if (!cache.has(asset.id)) cache.set(asset.id, load(asset));
  return cache.get(asset.id);
}

export function forgetPeaks(id) {
  cache.delete(id);
}

async function load(asset) {
  const n = Math.min(40000, Math.max(500, Math.ceil((asset.duration || 10) * 200)));
  try {
    const r = await api.waveform(asset.id, n);
    if (r.peaks?.length) return r.peaks;
  } catch { /* FFmpeg absent : repli navigateur */ }
  const buf = await getBuffer(asset);
  if (!buf) return [];
  const ch = buf.getChannelData(0);
  const step = Math.max(1, Math.floor(ch.length / n));
  const out = [];
  for (let i = 0; i < ch.length; i += step) {
    let m = 0;
    for (let j = i, e = Math.min(i + step, ch.length); j < e; j++) {
      const v = Math.abs(ch[j]);
      if (v > m) m = v;
    }
    out.push(m);
  }
  return out;
}

/** Dessine la portion [f0, f1] (fractions de la durée du média) des pics, en barres symétriques. */
export function drawPeaks(canvas, peaks, f0, f1, color) {
  const g = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  g.clearRect(0, 0, w, h);
  if (!peaks.length) return;
  g.fillStyle = color;
  const i0 = f0 * peaks.length;
  const span = (f1 - f0) * peaks.length;
  for (let x = 0; x < w; x++) {
    const a = Math.floor(i0 + (span * x) / w);
    const b = Math.max(a + 1, Math.floor(i0 + (span * (x + 1)) / w));
    let m = 0;
    for (let i = a; i < b && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
    const amp = Math.max(1, Math.min(1, m) * h * 0.46);
    g.fillRect(x, h / 2 - amp, 1, amp * 2);
  }
}
