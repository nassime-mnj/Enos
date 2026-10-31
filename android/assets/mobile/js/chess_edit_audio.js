"use strict";
// CHESS EDIT STUDIO — ANALYSEUR AUDIO. Décode la musique en entier AVANT la lecture (OfflineAudioContext), isole les basses (passe-bas < 150 Hz) et la voix
// (passe-bande 300-3000 Hz), puis calcule par tranches de 20 ms l'énergie RMS et le flux spectral (FFT) pour trouver :
//   introBeats[] (temps faibles de l'intro), buildUpStart, preDropSilence (le creux avant l'explosion), mainDropTimestamp (le Drop principal),
//   hardBeats[] (impacts de basse après le drop), vocalPeaks[] (pics de voix : « THE ROOK ! »).
// Le cœur (analyse(sig, sr)) est du calcul pur sur des Float32Array : il se teste sans navigateur audio.
(() => {
  const E = window.ENOS;
  const HOP = 0.02, MAX_SEC = 360, SR = 22050;

  // ---------------------------------------------------------------- outils de signal
  const smooth = (a, w) => {                                                  // moyenne glissante centrée (somme préfixe)
    const n = a.length, p = new Float64Array(n + 1), o = new Float32Array(n), h = w >> 1;
    for (let i = 0; i < n; i++) p[i + 1] = p[i] + a[i];
    for (let i = 0; i < n; i++) { const lo = Math.max(0, i - h), hi = Math.min(n, i + h + 1); o[i] = (p[hi] - p[lo]) / (hi - lo); }
    return o;
  };
  const mean = (a, i, j) => { i = Math.max(0, i); j = Math.min(a.length, j); if (j <= i) return 0; let s = 0; for (let k = i; k < j; k++) s += a[k]; return s / (j - i); };
  const stat = (a, i, j) => { i = Math.max(0, i); j = Math.min(a.length, j); const m = mean(a, i, j); let v = 0; for (let k = i; k < j; k++) v += (a[k] - m) * (a[k] - m); return { m, sd: Math.sqrt(v / Math.max(1, j - i)) }; };
  const rmsFrames = (x, sr) => {
    const n = Math.max(1, Math.floor(sr * HOP)), cnt = Math.floor(x.length / n), o = new Float32Array(cnt);
    for (let f = 0; f < cnt; f++) { let s = 0; for (let k = f * n, e = k + n; k < e; k++) s += x[k] * x[k]; o[f] = Math.sqrt(s / n); }
    return o;
  };
  // pics d'une courbe : maxima locaux > seuil, espacés d'au moins minGap secondes (le plus fort gagne)
  const peaks = (c, i0, i1, thr, minGap, cap) => {
    const g = Math.max(1, Math.round(minGap / HOP)), cand = [];
    for (let i = Math.max(2, i0); i < Math.min(c.length - 2, i1); i++) if (c[i] >= thr && c[i] >= c[i - 1] && c[i] > c[i + 1] && c[i] >= c[i - 2] && c[i] >= c[i + 2]) cand.push(i);
    cand.sort((a, b) => c[b] - c[a]);
    const acc = [];
    for (const i of cand) { if (acc.length >= (cap || 999)) break; if (!acc.some((j) => Math.abs(j - i) < g)) acc.push(i); }
    return acc.sort((a, b) => a - b).map((i) => +(i * HOP).toFixed(3));
  };
  const onset = (rms) => { const s = smooth(rms, 3), o = new Float32Array(s.length); for (let i = 1; i < s.length; i++) o[i] = Math.max(0, s[i] - s[i - 1]); return o; };

  // flux spectral : somme des hausses positives du spectre (compressé en log) entre deux fenêtres FFT consécutives
  function fluxCurve(x, sr, frameCount) {
    const N = 1024, hop = Math.max(1, Math.floor(sr * HOP)), half = N / 2, cos = new Float32Array(half), sin = new Float32Array(half), win = new Float32Array(N);
    for (let i = 0; i < half; i++) { cos[i] = Math.cos((2 * Math.PI * i) / N); sin[i] = -Math.sin((2 * Math.PI * i) / N); }
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    const re = new Float32Array(N), im = new Float32Array(N), rev = new Uint16Array(N);
    for (let i = 0, bits = Math.log2(N); i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
    let prev = new Float32Array(half), cur = new Float32Array(half);
    const out = new Float32Array(frameCount);
    for (let f = 0; f < frameCount; f++) {
      const s = f * hop;
      for (let i = 0; i < N; i++) { re[rev[i]] = (x[s + i] || 0) * win[i]; im[rev[i]] = 0; }
      for (let size = 2; size <= N; size <<= 1) {
        const hs = size >> 1, step = N / size;
        for (let i = 0; i < N; i += size) for (let j = 0, k = 0; j < hs; j++, k += step) {
          const a = i + j, b = a + hs, tr = re[b] * cos[k] - im[b] * sin[k], ti = re[b] * sin[k] + im[b] * cos[k];
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
      let fl = 0;
      for (let b = 1; b < half; b++) { cur[b] = Math.log1p(10 * Math.hypot(re[b], im[b]) / N * 8); const d = cur[b] - prev[b]; if (d > 0) fl += d; }
      out[f] = fl; const t = prev; prev = cur; cur = t;
    }
    return out;
  }

  /**
   * sig : {full, low, voc} (Float32Array mono à `sr` Hz). Retourne l'analyse complète (temps en secondes).
   */
  function analyse(sig, sr) {
    const rf = rmsFrames(sig.full, sr), rl = rmsFrames(sig.low, sr), rv = rmsFrames(sig.voc, sr), n = rf.length, dur = sig.full.length / sr;
    const res = { duration: +dur.toFixed(3), introBeats: [], hardBeats: [], vocalPeaks: [], buildUpStart: 0, preDropSilence: 0, mainDropTimestamp: 0, confidence: 0, wave: [] };
    if (n < 100) return res;
    const flux = fluxCurve(sig.full, sr, n), env = smooth(rf, 25), env2 = smooth(rf, 50);       // enveloppes 0,5 s et 1 s
    let max = 0; for (let i = 0; i < n; i++) if (env[i] > max) max = env[i];
    max = max || 1e-6;
    // --- MAIN DROP : plus forte montée d'énergie moyenne (2 s après / 1,5 s avant), pondérée par le niveau atteint
    const pre = new Float64Array(n + 1); for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + env[i];
    const avg = (i, j) => { i = Math.max(0, i); j = Math.min(n, j); return j > i ? (pre[j] - pre[i]) / (j - i) : 0; };
    let best = -1, bi = Math.min(n - 1, 50);
    for (let i = 50; i < n - 25; i++) {
      const after = avg(i, i + 100), before = avg(i - 75, i - 5), sc = (after / (before + 0.03 * max)) * (after / max);
      if (sc > best) { best = sc; bi = i; }
    }
    const lowOn = onset(rl), lowMax = Math.max(1e-9, ...lowOn.slice(Math.max(0, bi - 15), bi + 16));
    let di = bi, dv = -1;                                                                   // recale sur l'attaque de basse la plus proche
    for (let i = Math.max(1, bi - 15); i <= Math.min(n - 1, bi + 15); i++) if (lowOn[i] > dv) { dv = lowOn[i]; di = i; }
    if (dv < lowMax * 0.2) di = bi;
    res.mainDropTimestamp = +(di * HOP).toFixed(3);
    res.confidence = +Math.min(1, best / 4).toFixed(2);
    // --- creux juste avant le drop, puis début de la montée (on remonte tant que l'énergie lissée baisse en reculant)
    let pi = Math.max(0, di - 3), pv = Infinity;
    for (let i = Math.max(0, di - 200); i < Math.max(1, di - 2); i++) if (env[i] < pv) { pv = env[i]; pi = i; }
    res.preDropSilence = +(pi * HOP).toFixed(3);
    let bu = pi, pk = 0, pkI = pi;                                                          // montée : on remonte depuis le pic juste avant le creux jusqu'à ce que l'énergie retombe sous 20 % de ce pic (16 s max)
    for (let i = Math.max(0, pi - 800); i <= pi; i++) if (env2[i] > pk) { pk = env2[i]; pkI = i; }
    for (bu = pkI; bu > Math.max(1, pi - 800) && env2[bu] > 0.2 * pk; bu--);
    if ((di - bu) * HOP < 2) bu = Math.max(0, di - 150);
    res.buildUpStart = +(bu * HOP).toFixed(3);
    // --- hardBeats : impacts de basse après le drop ; introBeats : temps faibles avant la montée (basse + flux normalisés)
    const st = stat(lowOn, di, n);
    res.hardBeats = peaks(lowOn, di + 2, n, st.m + 0.8 * st.sd, 0.18, 90);
    const fN = (() => { const s = stat(flux, 0, n); return flux.map((v) => v / (s.m + 2 * s.sd + 1e-9)); })(), lN = lowOn.map((v) => v / (lowMax + 1e-9));
    const mix = new Float32Array(n); for (let i = 0; i < n; i++) mix[i] = 0.5 * fN[i] + 0.5 * lN[i];
    const si = stat(mix, 0, Math.max(10, bu));
    res.introBeats = peaks(mix, 10, Math.max(11, bu - 15), si.m + 0.4 * si.sd, 0.3, 30);
    // --- pics de voix : bande 300-3000 Hz, au-dessus de sa propre moyenne sur 1 s
    const vs = smooth(rv, 5), vl = smooth(rv, 50), vc = new Float32Array(n); for (let i = 0; i < n; i++) vc[i] = Math.max(0, vs[i] - vl[i]);
    const sv = stat(vc, 0, n);
    res.vocalPeaks = peaks(vc, 5, n - 5, sv.m + 1.5 * sv.sd, 0.5, 30);
    // --- forme d'onde (pour l'éditeur de timeline)
    const B = 1000, per = Math.max(1, Math.floor(sig.full.length / B)); res.wave = [];
    for (let b = 0; b < B; b++) { let m = 0; for (let k = b * per, e = Math.min(sig.full.length, k + per); k < e; k += 3) { const v = Math.abs(sig.full[k]); if (v > m) m = v; } res.wave.push(+m.toFixed(3)); }
    const wm = Math.max(1e-6, ...res.wave); res.wave = res.wave.map((v) => +(v / wm).toFixed(3));
    return res;
  }

  // ---------------------------------------------------------------- navigateur : décodage + filtres
  const OAC = () => window.OfflineAudioContext || window.webkitOfflineAudioContext;
  async function decode(file) {
    const Ctx = OAC();
    if (!Ctx) throw new Error("Cette version du navigateur ne sait pas décoder l'audio.");
    const ab = await file.arrayBuffer();
    return new Promise((res, rej) => {
      const ctx = new Ctx(1, 1, SR), p = ctx.decodeAudioData(ab, res, () => rej(new Error("Audio illisible (utilise un .mp3 ou .wav).")));
      if (p && p.then) p.then(res, () => rej(new Error("Audio illisible (utilise un .mp3 ou .wav).")));
    });
  }
  async function band(buf, kind) {
    const Ctx = OAC(), sec = Math.min(MAX_SEC, buf.duration), oc = new Ctx(1, Math.ceil(sec * SR), SR), src = oc.createBufferSource();
    src.buffer = buf;
    let last = src;
    const f = (type, hz, q) => { const b = oc.createBiquadFilter(); b.type = type; b.frequency.value = hz; b.Q.value = q || 0.707; last.connect(b); last = b; };
    if (kind === "low") { f("lowpass", 150); f("lowpass", 150); }                          // 2 étages : pente plus raide, kick et sub seuls
    else if (kind === "voc") { f("highpass", 300); f("lowpass", 3000); }
    last.connect(oc.destination); src.start(0);
    return (await oc.startRendering()).getChannelData(0);
  }
  /** Fichier audio -> analyse complète. onProgress(0..1) facultatif. */
  async function analyseFile(file, onProgress) {
    const p = (v) => { if (onProgress) onProgress(v); };
    p(0.05); const buf = await decode(file); p(0.2);
    const full = await band(buf, "full"); p(0.4);
    const low = await band(buf, "low"); p(0.55);
    const voc = await band(buf, "voc"); p(0.7);
    await new Promise((r) => setTimeout(r, 0));
    const r = analyse({ full, low, voc }, SR); p(1);
    r.truncated = buf.duration > MAX_SEC; r.fullDuration = +buf.duration.toFixed(3);
    return r;
  }

  E.editAudio = { analyse, analyseFile, HOP, SR };
})();
