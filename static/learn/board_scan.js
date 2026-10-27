"use strict";
// CAPTURE D'ÉCRAN -> POSITION. Colle la capture d'un échiquier (Chess.com, Lichess, …) : l'échiquier est localisé, chaque case est lue, la position (FEN) est reconstruite.
// 100 % local (canvas), aucun réseau : 1) l'échiquier = grille 8×8 de deux couleurs alternées, retrouvée par l'analyse des couleurs dominantes ;
// 2) pour chaque case, la silhouette de la pièce (tout ce qui diffère du fond de la case, intérieur rempli) est comparée à une bibliothèque de silhouettes
// de 35 jeux de pièces (réseau de data/piece_model.js) ; 3) la couleur de la pièce vient de la luminosité de son intérieur.
// Le résultat est une proposition : l'interface montre le plateau lu et laisse corriger case par case.
(() => {
  const E = (window.ENOS = window.ENOS || {});
  const S = (E.boardScan = {});
  const N = 20;                                                       // résolution des silhouettes comparées (N×N)
  const FILES = "abcdefgh";
  const TYPES = ["p", "n", "b", "r", "q", "k"];

  // ------------------------------------------------------------------ outils d'image
  const mk = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  /** File | Blob | HTMLImageElement | canvas | dataURL -> canvas (taille d'origine) */
  S.toCanvas = async (src) => {
    if (src instanceof HTMLCanvasElement) return src;
    let bmp;
    if (typeof src === "string") { const im = new Image(); im.src = src; await im.decode(); bmp = im; }
    else if (src instanceof HTMLImageElement) { if (!src.complete) await src.decode(); bmp = src; }
    else if (window.createImageBitmap) bmp = await createImageBitmap(src);
    else { const im = new Image(); im.src = URL.createObjectURL(src); await im.decode(); bmp = im; }
    const w = bmp.naturalWidth || bmp.width, h = bmp.naturalHeight || bmp.height, c = mk(w, h);
    c.getContext("2d").drawImage(bmp, 0, 0);
    if (bmp.close) bmp.close();
    return c;
  };
  const pixels = (c) => c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  const median = (arr) => { const s = Array.from(arr).sort((x, y) => x - y); return s[s.length >> 1]; };

  // ------------------------------------------------------------------ silhouettes
  /** Coverage w×h (0..1) -> grille N×N de la boîte englobante (moyenne par zone) + mesures. */
  S.normalize = (cov, w, h) => {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (cov[y * w + x] > 0.5) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, out = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const sx0 = x0 + i * bw / N, sx1 = x0 + (i + 1) * bw / N, sy0 = y0 + j * bh / N, sy1 = y0 + (j + 1) * bh / N;
      let sum = 0, wsum = 0;
      for (let y = Math.floor(sy0); y < Math.ceil(sy1); y++) for (let x = Math.floor(sx0); x < Math.ceil(sx1); x++) {
        const wx = Math.min(x + 1, sx1) - Math.max(x, sx0), wy = Math.min(y + 1, sy1) - Math.max(y, sy0);
        if (wx <= 0 || wy <= 0) continue;
        sum += (cov[y * w + x] > 0 ? Math.min(1, cov[y * w + x]) : 0) * wx * wy; wsum += wx * wy;
      }
      out[j * N + i] = wsum ? sum / wsum : 0;
    }
    return { g: out, bw, bh, aspect: bw / bh };
  };

  // Classifieur de pièces : petit réseau (silhouette 20×20 + proportions -> p, n, b, r, q, k) entraîné sur 35 jeux de pièces et leurs déformations
  // (android/tests/train_scan_model.py), poids int8 dans data/piece_model.js.
  let PM = null;
  S.model = () => {
    if (PM) return PM;
    const m = window.ENOS_PM;
    if (!m) return null;
    PM = { types: m.types, lumCut: m.lumCut, layers: m.layers.map((l) => {
      const raw = atob(l.w), w = new Float32Array(l.i * l.o);
      for (let o = 0; o < l.o; o++) for (let i = 0; i < l.i; i++) { let v = raw.charCodeAt(o * l.i + i); if (v > 127) v -= 256; w[i * l.o + o] = v * l.s[o]; }
      return { i: l.i, o: l.o, w, b: Float32Array.from(l.b) };
    }) };
    return PM;
  };
  /** Probabilités [p, n, b, r, q, k] d'une silhouette. relH = hauteur / plus grande pièce de l'échiquier ; area = part de la case couverte. */
  S.predict = (norm, relH, area) => {
    const pm = S.model();
    let h = new Float32Array(N * N + 3);
    for (let k = 0; k < N * N; k++) h[k] = Math.round(norm.g[k] * 9) / 9;
    h[N * N] = Math.log(norm.aspect) * 2; h[N * N + 1] = Math.min(1.05, relH == null ? 1 : relH) * 2 - 1; h[N * N + 2] = Math.min(1, area * 3) - 0.5;
    pm.layers.forEach((L, li) => {
      const out = new Float32Array(L.o);
      for (let o = 0; o < L.o; o++) out[o] = L.b[o];
      for (let i = 0; i < L.i; i++) { const x = h[i]; if (!x) continue; const base = i * L.o; for (let o = 0; o < L.o; o++) out[o] += x * L.w[base + o]; }
      if (li < pm.layers.length - 1) for (let o = 0; o < L.o; o++) if (out[o] < 0) out[o] = 0;
      h = out;
    });
    let mx = -1e9; for (const v of h) if (v > mx) mx = v;
    let sum = 0; const p = Array.from(h, (v) => { const e = Math.exp(v - mx); sum += e; return e; });
    return p.map((e) => e / sum);
  };
  /** Camp de chaque pièce : 2-moyennes sur (luminosité intérieure, luminosité moyenne, 75e centile) — robuste aux jeux colorés ou très détaillés ; repli sur un seuil appris
   *  si les deux groupes sont mal séparés (partie avec un seul camp visible, par ex.). -> tableau de booléens « blanc » */
  const colourSplit = (pcs, dflt) => {
    const V = pcs.map((q) => [q.lum, q.lmean, q.lq[3]]);
    const lums = V.map((v) => v[0]);
    if (pcs.length < 4 || Math.max(...lums) - Math.min(...lums) < 45) return pcs.map((q) => q.lum >= dflt);
    let a = V[lums.indexOf(Math.min(...lums))].slice(), b = V[lums.indexOf(Math.max(...lums))].slice(), lo = [];
    const d2 = (x, c) => (x[0] - c[0]) ** 2 + (x[1] - c[1]) ** 2 + (x[2] - c[2]) ** 2;
    for (let it = 0; it < 20; it++) {
      lo = V.map((v) => d2(v, a) <= d2(v, b));
      const A = V.filter((_, i) => lo[i]), B = V.filter((_, i) => !lo[i]);
      if (!A.length || !B.length) break;
      a = [0, 1, 2].map((k) => A.reduce((s, v) => s + v[k], 0) / A.length); b = [0, 1, 2].map((k) => B.reduce((s, v) => s + v[k], 0) / B.length);
    }
    if (b[0] - a[0] < 45) return pcs.map((q) => q.lum >= dflt);
    return lo.map((dark) => !dark);
  };

  // ------------------------------------------------------------------ 1) localiser l'échiquier
  /**
   * Retourne {x, y, s, light, dark, score} (coordonnées de la capture d'origine ; s = côté d'une case) ou null.
   * Principe : les deux couleurs des cases sont parmi les couleurs dominantes de l'image ; pour chaque paire plausible, la zone qu'elles couvrent
   * (projections lignes / colonnes) doit être un carré qui, découpé en 8×8, alterne les deux couleurs aux coins de chaque case.
   */
  S.detect = (canvas) => {
    const W = canvas.width, H = canvas.height, k = Math.min(1, 1100 / Math.max(W, H));
    const wc = k < 1 ? mk(W * k, H * k) : canvas;
    if (k < 1) { const x = wc.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(canvas, 0, 0, wc.width, wc.height); }
    const w = wc.width, h = wc.height, px = pixels(wc).data;
    // couleurs dominantes (3 bits par canal, moyennes affinées)
    const bins = new Map();
    for (let i = 0; i < w * h; i++) {
      const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2], key = (r >> 5) << 6 | (g >> 5) << 3 | (b >> 5);
      let e = bins.get(key); if (!e) { e = [0, 0, 0, 0]; bins.set(key, e); }
      e[0]++; e[1] += r; e[2] += g; e[3] += b;
    }
    const total = w * h;
    const cands = [...bins.values()].filter((e) => e[0] > total * 0.004).sort((a, b) => b[0] - a[0]).slice(0, 14).map((e) => [e[1] / e[0], e[2] / e[0], e[3] / e[0]]);
    if (cands.length < 2) return null;
    let best = null;
    for (const tol of [22, 40]) {
      // étiquette (candidat le plus proche, s'il est à moins de `tol`) ; projections par étiquette
      const lab = new Int8Array(w * h).fill(-1), col = cands.map(() => new Uint32Array(w)), row = cands.map(() => new Uint32Array(h));
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
        let bi = -1, bd = tol + 1;
        for (let c = 0; c < cands.length; c++) { const d = Math.max(Math.abs(r - cands[c][0]), Math.abs(g - cands[c][1]), Math.abs(b - cands[c][2])); if (d < bd) { bd = d; bi = c; } }
        if (bi >= 0) { lab[y * w + x] = bi; col[bi][x]++; row[bi][y]++; }
      }
      for (let a = 0; a < cands.length; a++) for (let b2 = a + 1; b2 < cands.length; b2++) {
        const la = lum(...cands[a]), lb = lum(...cands[b2]);
        if (Math.abs(la - lb) < 14 || Math.abs(la - lb) > 150) continue;
        const cs = new Uint32Array(w), rs = new Uint32Array(h);
        for (let x = 0; x < w; x++) cs[x] = col[a][x] + col[b2][x];
        for (let y = 0; y < h; y++) rs[y] = row[a][y] + row[b2][y];
        const xr = run(cs), yr = run(rs);
        if (!xr || !yr) continue;
        const bw = xr[1] - xr[0] + 1, bh = yr[1] - yr[0] + 1;
        if (bw < 64 || bh < 64 || Math.abs(bw - bh) > 0.12 * Math.max(bw, bh)) {
          // projections gênées (pièces, texte) : si la zone est presque carrée on tente quand même le côté le plus plausible
          if (bw < 64 || bh < 64) continue;
        }
        const light = la > lb ? cands[a] : cands[b2], dark = la > lb ? cands[b2] : cands[a];
        const sz = (bw + bh) / 2;
        const r = refine(px, w, h, xr[0], yr[0], sz / 8, light, dark, tol + 8);
        if (r && (!best || r.score > best.score)) best = { ...r, light, dark, tol };
      }
      if (best && best.score >= 0.9) break;
    }
    if (!best || best.score < 0.72) return null;
    return { x: best.x / k, y: best.y / k, s: best.s / k, light: best.light, dark: best.dark, score: best.score };
  };

  /** Plus longue plage où la projection dépasse 40 % de son maximum (les trous courts sont tolérés). */
  function run(p) {
    let mx = 0; for (let i = 0; i < p.length; i++) if (p[i] > mx) mx = p[i];
    if (mx < 40) return null;
    const thr = mx * 0.4;
    let bestA = -1, bestB = -1, a = -1, gap = 0;
    for (let i = 0; i < p.length; i++) {
      if (p[i] >= thr) { if (a < 0) a = i; gap = 0; if (i - a > bestB - bestA) { bestA = a; bestB = i; } }
      else if (a >= 0) { gap++; if (gap > 4) { a = -1; gap = 0; } }
    }
    return bestA < 0 ? null : [bestA, bestB];
  }

  /** Score d'une grille (x0, y0, côté de case s) : points proches des coins de chaque case = couleur attendue ET points juste hors de la case (case voisine) = autre couleur
   *  (sans le second test, une grille décalée de quelques pixels aurait le même score). */
  function gridScore(px, w, h, x0, y0, s, light, dark, tol) {
    let ok = 0, n = 0;
    const ins = Math.max(2, s * 0.03), out = 2.5;
    const near = (x, y, want) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= w || y >= h) return null; const i = (y * w + x) * 4; return Math.max(Math.abs(px[i] - want[0]), Math.abs(px[i + 1] - want[1]), Math.abs(px[i + 2] - want[2])) <= tol; };
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const want = (r + c) % 2 === 0 ? light : dark, X = x0 + c * s, Y = y0 + r * s;
      for (const fy of [ins, s - ins]) {
        for (const fx of [ins, s - ins]) { const m = near(X + fx, Y + fy, want); n++; if (m) ok++; }
        for (const fx of [-out, s + out]) { const m = near(X + fx, Y + fy, want); n++; if (m === false) ok++; }
      }
    }
    return ok / n;
  }
  /** Recherche locale (grossière puis fine) de la grille autour de l'hypothèse issue des projections ; parmi les grilles de score maximal on prend le centre du plateau d'égalité. */
  function refine(px, w, h, x0, y0, s, light, dark, tol) {
    let best = null, ties = [];
    const try1 = (x, y, ss) => {
      const sc = gridScore(px, w, h, x, y, ss, light, dark, tol);
      if (!best || sc > best.score + 1e-9) { best = { x, y, s: ss, score: sc }; ties = [best]; }
      else if (sc >= best.score - 1e-9) ties.push({ x, y, s: ss, score: sc });
    };
    const span = Math.max(4, Math.round(s * 0.13)), st = Math.max(1, Math.round(s / 36));
    for (let k = -4; k <= 4; k++) for (let dx = -span; dx <= span; dx += st) for (let dy = -span; dy <= span; dy += st) try1(x0 + dx, y0 + dy, s * (1 + k * 0.015));
    const c = best;
    best = null; ties = [];
    for (let k = -3; k <= 3; k++) for (let dx = -st; dx <= st; dx += 0.5) for (let dy = -st; dy <= st; dy += 0.5) try1(c.x + dx, c.y + dy, c.s * (1 + k * 0.004));
    const m = (key) => ties.reduce((t, q) => t + q[key], 0) / ties.length;
    return { x: m("x"), y: m("y"), s: m("s"), score: best.score };
  }

  // ------------------------------------------------------------------ 2) lire les cases
  const Q = 40;                                                         // taille de travail d'une case
  /** Composante connexe la plus grande d'un masque Q×Q (4-voisinage). Retourne {idx[], x0,y0,x1,y1}. */
  function biggest(mask) {
    const seen = new Uint8Array(Q * Q); let best = null;
    for (let s = 0; s < Q * Q; s++) {
      if (!mask[s] || seen[s]) continue;
      const stack = [s], idx = []; seen[s] = 1;
      let x0 = Q, y0 = Q, x1 = 0, y1 = 0;
      while (stack.length) {
        const p = stack.pop(), x = p % Q, y = (p / Q) | 0; idx.push(p);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
        if (x < Q - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
        if (y > 0 && mask[p - Q] && !seen[p - Q]) { seen[p - Q] = 1; stack.push(p - Q); }
        if (y < Q - 1 && mask[p + Q] && !seen[p + Q]) { seen[p + Q] = 1; stack.push(p + Q); }
      }
      if (!best || idx.length > best.idx.length) best = { idx, x0, y0, x1, y1 };
    }
    return best;
  }

  /** Analyse d'une case (Q×Q RGBA) : fond, silhouette, luminosité intérieure. */
  function readSquare(d) {
    const at = (x, y) => (y * Q + x) * 4;
    const cs = [];
    for (const [cx, cy] of [[3, 3], [Q - 7, 3], [3, Q - 7], [Q - 7, Q - 7]]) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) cs.push(at(cx + x, cy + y));
    const bg = [0, 1, 2].map((ch) => median(cs.map((i) => d[i + ch])));
    // masque de différence avec le fond, épaissi d'un pixel, puis remplissage du fond depuis les bords : ce qui n'est pas atteint = pièce (intérieur compris)
    const fg = new Uint8Array(Q * Q);
    for (let y = 0; y < Q; y++) for (let x = 0; x < Q; x++) { const i = at(x, y); fg[y * Q + x] = x >= 2 && y >= 2 && x < Q - 2 && y < Q - 2 && Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2])) > 34 ? 1 : 0; }   // anneau de 2 px ignoré : un décalage d'1 px de la grille y fait entrer la case voisine
    const fat = new Uint8Array(fg);                                  // épaissi d'1 px : referme les contours interrompus et relie les parties d'une pièce séparées par un trait fin
    for (let y = 0; y < Q; y++) for (let x = 0; x < Q; x++) if (fg[y * Q + x]) { for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < Q && yy < Q) fat[yy * Q + xx] = 1; } }
    const reach = new Uint8Array(Q * Q), st = [];
    for (let i = 0; i < Q; i++) for (const p of [i, (Q - 1) * Q + i, i * Q, i * Q + Q - 1]) if (!fat[p] && !reach[p]) { reach[p] = 1; st.push(p); }
    while (st.length) {
      const p = st.pop(), x = p % Q, y = (p / Q) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= Q || yy >= Q) continue; const q = yy * Q + xx; if (!fat[q] && !reach[q]) { reach[q] = 1; st.push(q); } }
    }
    const mask = new Uint8Array(Q * Q);
    for (let i = 0; i < Q * Q; i++) mask[i] = reach[i] ? 0 : 1;
    const comp = biggest(mask);
    const res = { bg, area: 0, piece: false };
    if (!comp) return res;
    const bw = comp.x1 - comp.x0 + 1, bh = comp.y1 - comp.y0 + 1, area = comp.idx.length;
    res.area = area / (Q * Q);
    if (area < Q * Q * 0.075) return res;                                // taches, coordonnées, points
    // superposition translucide (point d'aide au coup, anneau de prise, flèche, ombre) : aucun pixel ne contraste franchement avec le fond de la case, alors qu'une pièce a un contour net
    let peak = 0;
    for (const p of comp.idx) { const c = Math.max(Math.abs(d[p * 4] - bg[0]), Math.abs(d[p * 4 + 1] - bg[1]), Math.abs(d[p * 4 + 2] - bg[2])); if (c > peak) peak = c; }
    if (peak < 78) return res;
    // point d'aide au coup : disque plein, petit, de couleur uniforme
    if (area < Q * Q * 0.16 && bw / bh > 0.78 && bw / bh < 1.28 && area / (bw * bh) > 0.7) {
      const cc = comp.idx.map((p) => lum(d[p * 4], d[p * 4 + 1], d[p * 4 + 2])), m = cc.reduce((s, x) => s + x, 0) / cc.length;
      if (Math.sqrt(cc.reduce((s, x) => s + (x - m) * (x - m), 0) / cc.length) < 14) return res;
    }
    const inComp = new Uint8Array(Q * Q); comp.idx.forEach((p) => (inComp[p] = 1));
    // intérieur = pixels de la pièce à ≥ 2 px du bord (sinon ≥ 1)
    const lums = [], lums1 = [];
    for (const p of comp.idx) {
      const x = p % Q, y = (p / Q) | 0, L = lum(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]);
      let e1 = true, e2 = true;
      for (let dy = -2; dy <= 2 && e2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= Q || yy >= Q || !inComp[yy * Q + xx]) { e2 = false; if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) e1 = false; break; } }
      if (e2) lums.push(L); else if (e1) lums1.push(L);
    }
    const inner = lums.length >= 12 ? lums : lums1.length >= 6 ? lums1.concat(lums) : comp.idx.map((p) => lum(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]));
    // valeur représentative : les pixels du remplissage dominent ; on prend la médiane (le contour sombre minoritaire n'y pèse pas)
    const all = comp.idx.map((p) => lum(d[p * 4], d[p * 4 + 1], d[p * 4 + 2])).sort((x, y) => x - y), qa = (f) => all[Math.min(all.length - 1, Math.floor(all.length * f))];
    res.lq = [qa(0.1), qa(0.25), qa(0.5), qa(0.75), qa(0.9)]; res.lmean = all.reduce((s2, x) => s2 + x, 0) / all.length;
    res.piece = true; res.lum = median(inner); res.bw = bw; res.bh = bh; res.mask = mask; res.comp = comp;
    const cov = new Float32Array(Q * Q); comp.idx.forEach((p) => (cov[p] = 1));
    res.norm = S.normalize(cov, Q, Q);
    return res;
  }

  const shapeDist = (a, b) => {
    let mn = 0, mx = 0;
    for (let k = 0; k < a.norm.g.length; k++) { const x = a.norm.g[k], y = b.norm.g[k]; mn += x < y ? x : y; mx += x > y ? x : y; }
    return (1 - mn / mx) + 0.4 * Math.abs(Math.log(a.norm.aspect / b.norm.aspect)) + 0.8 * Math.abs(a.rel - b.rel);
  };
  // ---- mémoire : formes de pièces CONFIRMÉES par l'utilisateur (son jeu de pièces : celui de son application). La forme est comparée à ses exemplaires (même camp) :
  // le plus proche gagne, à condition d'être net (distance faible, et nettement plus proche que tout exemplaire d'un autre type).
  const memGet = () => (E.settings ? E.settings.get("scan.mem", []) : []);
  const gStr = (g) => { let t = ""; for (let k = 0; k < g.length; k++) t += Math.round(g[k] * 9); return t; };
  const gArr = (t) => { const g = new Float32Array(t.length); for (let k = 0; k < t.length; k++) g[k] = (t.charCodeAt(k) - 48) / 9; return g; };
  const memDist = (m, q) => {
    const a = m.G || (m.G = gArr(m.g)), b = q.norm.g;
    let mn = 0, mx = 0;
    for (let k = 0; k < a.length; k++) { const x = a[k], y = b[k]; mn += x < y ? x : y; mx += x > y ? x : y; }
    return (1 - mn / mx) + 0.4 * Math.abs(Math.log(m.a / q.norm.aspect)) + 1.0 * Math.abs(m.h - q.bh / Q);
  };
  /** Mémorise les pièces d'une lecture, avec leur type confirmé : read = résultat de S.read, map = position finale {case: pièce} (après corrections). */
  S.learn = (read, map) => {
    if (!E.settings) return 0;
    let mem = memGet(), added = 0;
    for (const q of read.squares) {
      if (!q.piece || !q.norm || !q.sq) continue;
      const P = map[q.sq]; if (!P) continue;
      const t = P.toLowerCase(), w = P === P.toUpperCase() ? 1 : 0;
      if (mem.some((m) => m.t === t && m.w === w && memDist(m, q) < 0.04)) continue;
      mem.push({ t, w, g: gStr(q.norm.g), a: +q.norm.aspect.toFixed(3), h: +(q.bh / Q).toFixed(3) }); added++;
    }
    const per = {}; mem = mem.reverse().filter((m) => (per[m.t + m.w] = (per[m.t + m.w] || 0) + 1) <= 10).reverse();      // 10 exemplaires par type et par camp au plus
    E.settings.set("scan.mem", mem.map((m) => ({ t: m.t, w: m.w, g: m.g, a: m.a, h: m.h })));
    return added;
  };
  S.forget = () => E.settings && E.settings.set("scan.mem", []);
  S.memorySize = () => memGet().length;
  const fromMemory = (q) => {
    const mem = memGet().filter((m) => m.w === (q.white ? 1 : 0));
    if (mem.length < 6) return null;
    let best = null, other = 9;
    for (const m of mem) { const d = memDist(m, q); if (!best || d < best.d) { if (best) other = Math.min(other, best.d); best = { d, t: m.t }; } else if (m.t !== best.t) other = Math.min(other, d); }
    if (best && mem.some((m) => m.t !== best.t) && other < 9) { /* marge déjà calculée */ }
    return best && best.d < 0.2 && other - best.d > 0.03 ? best : null;
  };

  /**
   * Lit un échiquier : rect {x, y, s} (case = s px). Retourne
   *  { squares: [{r, c, piece:"P"|"n"|""…, conf, alt:[…], hl}], flipped, fen (placement), turn (devinée), castling, last: [cases surlignées] }
   */
  S.read = (canvas, rect, opts) => {
    opts = opts || {};
    const sq = mk(Q, Q), sx = sq.getContext("2d", { willReadFrequently: true }), res = [];
    sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = "high";
    const light = rect.light, dark = rect.dark;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      sx.clearRect(0, 0, Q, Q);
      sx.drawImage(canvas, rect.x + c * rect.s, rect.y + r * rect.s, rect.s, rect.s, 0, 0, Q, Q);
      const info = readSquare(sx.getImageData(0, 0, Q, Q).data);
      const want = (r + c) % 2 === 0 ? light : dark;
      info.r = r; info.c = c; info.hl = !!(want && dist(info.bg, want) > 26);
      res.push(info);
    }
    // hauteur de référence : la plus grande pièce de l'image (≈ le roi) -> hauteur relative de chaque pièce
    const hs = res.filter((q) => q.piece).map((q) => q.bh).sort((a, b) => b - a);
    const hmax = hs.length ? hs[Math.min(1, hs.length - 1)] : 0;               // 2e plus grande (évite une pièce aberrante)
    const pm = S.model();
    res.forEach((q) => { q.pc = ""; });
    const pcs = opts.noClassify || !pm ? [] : res.filter((q) => q.piece && q.norm);
    if (pcs.length) {
      const whites = colourSplit(pcs, opts.lumCut || pm.lumCut || 128);
      pcs.forEach((q, qi) => {
        q.rel = hmax ? Math.min(1.05, q.bh / hmax) : 1; q.p = S.predict(q.norm, q.rel, q.area); q.white = whites[qi];
        const mm = fromMemory(q);
        if (mm) { const t = pm.types.indexOf(mm.t); q.p = q.p.map((v, i) => (i === t ? 0.985 : 0.003)); q.known = true; }             // forme déjà confirmée par l'utilisateur
      });
      // décodage sous contraintes d'un échiquier : un roi par camp, pas de pion en 1re / 8e rangée, au plus 8 pions par camp
      const best = (q, ban) => { let bi = -1; q.p.forEach((v, i) => { if (!ban.includes(i) && (bi < 0 || v > q.p[bi])) bi = i; }); return bi; };
      pcs.forEach((q) => { q.t = best(q, []); });
      for (const white of [true, false]) {
        const mine = pcs.filter((q) => q.white === white);
        if (!mine.length) continue;
        mine.forEach((q) => { if (q.t === 0 && (q.r === 0 || q.r === 7)) q.t = best(q, [0]); });
        const kings = mine.filter((q) => q.t === 5);
        if (!kings.length) { const k = mine.slice().sort((a, b) => b.p[5] - a.p[5])[0]; k.t = 5; }
        else if (kings.length > 1) { kings.sort((a, b) => b.p[5] - a.p[5]); kings.slice(1).forEach((q) => { q.t = best(q, [5]); }); }
        const pawns = mine.filter((q) => q.t === 0).sort((a, b) => b.p[0] - a.p[0]);
        pawns.slice(8).forEach((q) => { q.t = best(q, [0]); });
      }
      pcs.forEach((q) => {
        const T = pm.types[q.t];
        q.pc = q.white ? T.toUpperCase() : T;
        q.conf = q.p[q.t];
        q.alt = q.p.map((v, i) => [v, i]).filter(([, i]) => i !== q.t).sort((a, b) => b[0] - a[0]).slice(0, 2).map(([, i]) => (q.white ? pm.types[i].toUpperCase() : pm.types[i]));
        q.margin = q.p[q.t] - Math.max(...q.p.filter((_, i) => i !== q.t));
      });
    }
    // orientation : les Blancs sont en bas, sauf si leurs pièces sont plutôt en haut
    const wr = res.filter((q) => q.pc && q.pc === q.pc.toUpperCase()).map((q) => q.r), br = res.filter((q) => q.pc && q.pc === q.pc.toLowerCase()).map((q) => q.r);
    const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
    let flipped = wr.length && br.length ? mean(wr) < mean(br) : false;
    if (opts.flipped != null) flipped = !!opts.flipped;
    const map = {};
    res.forEach((q) => { q.sq = flipped ? FILES[7 - q.c] + (q.r + 1) : FILES[q.c] + (8 - q.r); if (q.pc) map[q.sq] = q.pc; });
    const hlSq = res.filter((q) => q.hl).map((q) => (flipped ? FILES[7 - q.c] + (q.r + 1) : FILES[q.c] + (8 - q.r)));
    // trait : la pièce posée sur une case surlignée vient de jouer -> c'est à l'autre camp de jouer
    let turn = "w";
    if (hlSq.length >= 1 && hlSq.length <= 3) {
      const mover = hlSq.map((s) => map[s]).filter(Boolean);
      if (mover.length) turn = mover[0] === mover[0].toUpperCase() ? "b" : "w";
    }
    return { squares: res, flipped, map, last: hlSq, turn, hmax };
  };
  /** Vignette d'une case de la capture (pour afficher une forme à corriger). */
  S.crop = (canvas, rect, r, c, size) => {
    const o = mk(size, size), x = o.getContext("2d");
    x.imageSmoothingQuality = "high"; x.drawImage(canvas, rect.x + c * rect.s, rect.y + r * rect.s, rect.s, rect.s, 0, 0, size, size);
    return o;
  };

  // ------------------------------------------------------------------ 3) FEN
  /** {case: pièce} + options -> FEN complète (droits de roque devinés d'après les rois / tours sur leur case d'origine). */
  S.fenOf = (map, turn, o) => {
    o = o || {};
    const rows = [];
    for (let r = 8; r >= 1; r--) {
      let row = "", n = 0;
      for (let f = 0; f < 8; f++) { const p = map[FILES[f] + r]; if (p) { if (n) { row += n; n = 0; } row += p; } else n++; }
      rows.push(row + (n || ""));
    }
    let cast = "";
    if (map.e1 === "K") { if (map.h1 === "R") cast += "K"; if (map.a1 === "R") cast += "Q"; }
    if (map.e8 === "k") { if (map.h8 === "r") cast += "k"; if (map.a8 === "r") cast += "q"; }
    return `${rows.join("/")} ${turn || "w"} ${o.castling != null ? o.castling || "-" : cast || "-"} - 0 1`;
  };
  /** Vérifie qu'une position est jouable : 1 roi par camp, pas de pion en 1re/8e rangée, camp qui n'a pas le trait pas en échec. -> message d'erreur ou "" */
  S.validate = (fen) => {
    const m = {}; let k = 0, K = 0;
    fen.split(" ")[0].split("/").forEach((row, r) => { let f = 0; for (const ch of row) { if (/\d/.test(ch)) f += +ch; else { m[FILES[f] + (8 - r)] = ch; if (ch === "k") k++; if (ch === "K") K++; f++; } } });
    if (K !== 1) return K ? "Il y a plusieurs rois blancs." : "Il manque le roi blanc.";
    if (k !== 1) return k ? "Il y a plusieurs rois noirs." : "Il manque le roi noir.";
    if (Object.keys(m).some((s) => /p/i.test(m[s]) && (s[1] === "1" || s[1] === "8"))) return "Un pion est sur la 1re ou la 8e rangée.";
    try {
      const ch = new Chess(fen);
      const other = new Chess(fen.replace(/ [wb] /, ch.turn() === "w" ? " b " : " w ").replace(/ [KQkq-]+ [a-h36-]+ /, " - - "));
      if (other.in_check && other.in_check() && !ch.in_check()) return "Le camp qui n'a pas le trait est en échec : inverse le trait.";
    } catch (e) { return "Position invalide."; }
    return "";
  };

  /** Raccourci : capture -> {rect, read, fen}. Retourne null si aucun échiquier n'est trouvé. */
  S.scan = async (src, opts) => {
    const canvas = await S.toCanvas(src);
    if (!S.model()) throw new Error("Modèle de reconnaissance absent (data/piece_model.js).");
    const rect = (opts && opts.rect) || S.detect(canvas);
    if (!rect) return { canvas, rect: null };
    const rd = S.read(canvas, rect, opts);
    return { canvas, rect, read: rd, fen: S.fenOf(rd.map, rd.turn) };
  };
})();
