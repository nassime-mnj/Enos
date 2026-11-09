"use strict";
// CHESS EDIT — SCÈNES : intros / outros VARIÉS (choisis par la partie : même résultat dans l'aperçu et dans l'export), affichage des ÉQUIPES (intro, bandeau en jeu, victoire d'équipe).
//   Intro solo  : 0 face-à-face (d'origine) · 1 SLASH diagonal · 2 CARTES holographiques · 3 TERMINAL glitch
//   Intro équipe: 0 panneaux qui glissent · 1 panneaux qui tombent / montent
//   Outro       : 0 tampon (d'origine) · 1 CARTE DE VICTOIRE (laurier, particules dorées) · 2 ÉCLATS (l'image se brise) · 3 CINÉMA (bandes noires, nom révélé)
// Tout est une fonction pure du temps (aucun aléa non semé, pas de ctx.filter / getImageData / shadowBlur) : draw(t) reste déterministe pour l'export 60 FPS.
(() => {
  const E = window.ENOS, RR = E.editRender;
  if (!RR || !RR.Renderer) return;
  const P = RR.Renderer.prototype, EASE = RR.EASE;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, k) => a + (b - a) * k, TAU = Math.PI * 2;
  const FONT = (px) => `900 ${Math.round(px)}px Impact, "Arial Black", system-ui, sans-serif`;
  const TXT = (px, w) => `${w || 600} ${Math.round(px)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const MONO = (px) => `700 ${Math.round(px)}px ui-monospace, Menlo, Consolas, monospace`;
  const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const hashS = (s) => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const orig = { intro: P.drawIntro, end: P.drawEnd };
  const cols = { w: "#ff4a3a", b: "#3d8bff", gold: "#ffd666" };

  /** texte qui rentre dans maxW (réduit la police) */
  function fitFont(g, text, maxW, px, fn) { let s = px; g.font = fn(s); while (s > 14 && g.measureText(text).width > maxW) { s *= 0.92; g.font = fn(s); } return s; }
  /** pastille d'origine d'ETO (turquoise), d'E.N.O.S. (rouge), de Stockfish (gris) : disque de couleur + sigle ; sinon l'initiale */
  P.phFill = function (g, s, r) {
    const ph = s && s.ph, c = ph ? ph[1] : "#5b6075", txt = ph ? ph[0] : String((s && s.name) || "?").trim().charAt(0).toUpperCase();
    if (!(r > 1)) return; g.save(); g.beginPath(); g.arc(0, 0, r, 0, TAU); g.clip(); const gr = g.createRadialGradient(0, -r * 0.35, r * 0.1, 0, 0, r); gr.addColorStop(0, c); gr.addColorStop(1, "#0b0c12"); g.fillStyle = gr; g.globalAlpha *= 0.9; g.fillRect(-r, -r, r * 2, r * 2); g.globalAlpha = 1;
    g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; let px = r * (txt.length > 2 ? 0.62 : 0.95); g.font = FONT(px); while (px > 10 && g.measureText(txt).width > r * 1.55) { px *= 0.92; g.font = FONT(px); } g.lineWidth = px * 0.08; g.strokeStyle = "rgba(0,0,0,.5)"; g.strokeText(txt, 0, r * 0.05); g.fillText(txt, 0, r * 0.05); g.restore();
  };
  /** disque d'avatar : image (photo / bot / icône pixel-art) rognée en cercle, anneau de couleur, lettre si pas d'image */
  P.introMood = function (id, t) { return id === "eto" ? (t < 0.8 ? "smile" : t < 1.3 ? "wink" : t < 2.4 ? "happy" : "think") : (t < 1 ? "idle" : t < 2.5 ? "scan" : "alert"); };
  const KEYMOOD = { eto: { brilliant: "wow", best: "happy", excellent: "happy", great: "happy", blunder: "sad", mistake: "sad", miss: "think", inaccuracy: "think" }, enos: { brilliant: "alert", best: "lock", excellent: "lock", great: "lock", blunder: "alert", mistake: "alert", miss: "scan", inaccuracy: "scan" } };
  P.sceneDisc = function (g, s, cx, cy, r, rim, alpha, mood) {
    const k = this.k(), im = s && s.img && this.av[s.img]; if (!(r > 1)) return;                                    // rayon nul / négatif pendant l'apparition (easing « back ») : rien à dessiner
    if (s && s.anim && im && E.animIcons) {                                                                          // ETO / E.N.O.S. : icône d'origine ANIMÉE (écran 8-bit / œil)
      g.save(); g.globalAlpha *= alpha == null ? 1 : alpha; E.animIcons.draw(g, s.anim, im, cx, cy, r * 2.2, this._now || 0, mood || (this._inIntro ? this.introMood(s.anim, this._now || 0) : s.mood || "auto"));
      g.strokeStyle = rim; g.lineWidth = Math.max(3, r * 0.045); g.globalAlpha *= 0.85; g.beginPath(); g.arc(cx, cy, r * 1.16, 0, TAU); g.stroke(); g.restore(); return;
    }
    g.save(); g.globalAlpha *= alpha == null ? 1 : alpha; g.translate(cx, cy);
    g.fillStyle = "#0b0c12"; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
    if (im) { g.save(); g.beginPath(); g.arc(0, 0, Math.max(0.1, r - 3 * k), 0, TAU); g.clip(); g.drawImage(im, -r, -r, r * 2, r * 2); g.restore(); }
    else this.phFill(g, s, r - 3 * k);
    g.strokeStyle = rim; g.lineWidth = Math.max(3, r * 0.07); g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke();
    g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = Math.max(2, r * 0.025); g.beginPath(); g.arc(0, 0, r + r * 0.07, 0, TAU); g.stroke();
    g.restore();
  };
  P.sceneName = function (g, text, cx, y, maxW, px, color, alpha) {
    const k = this.k(); g.save(); g.globalAlpha *= alpha == null ? 1 : alpha; g.textAlign = "center"; g.textBaseline = "alphabetic"; text = String(text || "").toUpperCase();
    const s = fitFont(g, text, maxW, px, FONT); g.lineWidth = Math.max(4, s * 0.14); g.strokeStyle = "#000"; g.lineJoin = "round"; g.strokeText(text, cx, y); g.fillStyle = color || "#fff"; g.fillText(text, cx, y); g.restore(); return s;
  };
  P.sceneElo = function (g, s, cx, y, t0, t, px) {
    if (!s || s.elo == null) return; const kk = EASE.out4(clamp((t - t0) / 1.4, 0, 1)); g.save(); g.textAlign = "center"; g.font = FONT(px); g.fillStyle = cols.gold; g.lineWidth = px * 0.12; g.strokeStyle = "#000"; const txt = Math.round(s.elo * kk) + " ELO"; g.strokeText(txt, cx, y); g.fillText(txt, cx, y); g.restore();
  };
  P.sceneVignette = function (g, t, T) {
    const { W, H } = this, tension = clamp((t - (T - 1.3)) / 1.3, 0, 1); if (tension <= 0) return;
    g.save(); g.globalAlpha = tension * 0.5; const vg = g.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.7); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(255,30,30,.6)"); g.fillStyle = vg; g.fillRect(-W * 0.1, -H * 0.1, W * 1.2, H * 1.2); g.restore();
  };
  const duel = (info) => { const P1 = info.white && info.white.human ? info.white : info.black && info.black.human ? info.black : info.white; return [P1, P1 === info.white ? info.black : info.white, P1 === info.white ? "w" : "b"]; };

  // ------------------------------------------------------------------ INTRO : dispatch
  P.introStyle = function () {
    if (this._is != null) return this._is;
    const info = (this.intro && this.intro.intro) || {}, seed = info.seed != null ? info.seed : hashS((this.rec && (this.rec.t || this.rec.title)) || ""), teams = !!info.teams;
    const forced = this.rec && this.rec.introStyle != null ? +this.rec.introStyle : null;
    return (this._is = forced != null ? forced % (teams ? 2 : 4) : seed % (teams ? 2 : 4));
  };
  P.outroStyle = function () {
    if (this._os != null) return this._os;
    const info = (this.outro && this.outro.intro) || (this.intro && this.intro.intro) || {}, seed = info.seed != null ? info.seed : hashS((this.rec && (this.rec.t || this.rec.title)) || "");
    const forced = this.rec && this.rec.outroStyle != null ? +this.rec.outroStyle : null;
    return (this._os = forced != null ? forced % 4 : ((seed >>> 5) + 1) % 4);
  };
  P.drawIntro = function (t) { this._inIntro = true; try { return this.drawIntro2(t); } finally { this._inIntro = false; } };
  P.drawIntro2 = function (t) {
    const info = (this.intro && this.intro.intro) || {}, st = this.introStyle();
    if (info.teams) return this.introTeams(t, info, st);
    if (st === 1) return this.introSlash(t, info);
    if (st === 2) return this.introCards(t, info);
    if (st === 3) return this.introTerminal(t, info);
    return orig.intro.call(this, t);
  };

  // ------------------------------------------------------------------ INTRO 1 : SLASH diagonal
  P.introSlash = function (t, info) {
    const { W, H } = this, k = this.k(), g = this.ctx, T = this.introEnd, [A, B] = duel(info), tension = clamp((t - 2.5) / 1.3, 0, 1);
    g.save(); g.fillStyle = "#06070b"; g.fillRect(0, 0, W, H);
    const p = EASE.out4(clamp(t / 0.55, 0, 1)), y0 = H * 0.60, y1 = H * 0.40;                                  // la diagonale va de (0, y0) à (W, y1)
    const shake = tension * 10 * k; g.translate(Math.sin(t * 95) * shake, Math.cos(t * 83) * shake);
    [[true, cols.w, "#3a0907"], [false, cols.b, "#08183a"]].forEach(([top, c, dk]) => {
      g.save(); g.beginPath();
      if (top) { g.moveTo(-W * 0.1, -H * 0.1); g.lineTo(W * 1.1, -H * 0.1); g.lineTo(W * 1.1, y1 - H * 0.03); g.lineTo(-W * 0.1, y0 - H * 0.03); } else { g.moveTo(-W * 0.1, y0 + H * 0.03); g.lineTo(W * 1.1, y1 + H * 0.03); g.lineTo(W * 1.1, H * 1.1); g.lineTo(-W * 0.1, H * 1.1); }
      g.closePath(); g.clip(); g.translate(0, (top ? -1 : 1) * (1 - p) * H * 0.6);
      const gr = g.createLinearGradient(0, top ? 0 : H, 0, top ? H * 0.5 : H * 0.5); gr.addColorStop(0, c); gr.addColorStop(1, dk); g.globalAlpha = 0.85; g.fillStyle = gr; g.fillRect(-W * 0.2, -H * 0.2, W * 1.4, H * 1.4);
      g.globalAlpha = 0.16; g.fillStyle = "#fff"; const rn = mulberry(top ? 5 : 9); for (let i = 0; i < 14; i++) { const x = rn() * W, w = (20 + rn() * 70) * k, off = ((t * (60 + rn() * 90) * k) % (W * 1.4)); g.save(); g.translate(x + off - W * 0.2, 0); g.transform(1, 0, -0.5, 1, 0, 0); g.fillRect(0, 0, w, H); g.restore(); }
      g.restore();
    });
    const flash = clamp(1 - Math.abs(t - 0.5) / 0.18, 0, 1);                                                        // éclair de la lame
    g.save(); g.globalCompositeOperation = "lighter"; g.strokeStyle = "#fff"; g.globalAlpha = 0.35 + 0.65 * flash; g.lineWidth = (6 + 22 * flash) * k; g.beginPath(); g.moveTo(-W * 0.05, y0); g.lineTo(lerp(-W * 0.05, W * 1.05, p), lerp(y0, y1, p)); g.stroke(); g.restore();
    const ax = W * 0.5, a1 = EASE.back(clamp((t - 0.35) / 0.5, 0, 1)), a2 = EASE.back(clamp((t - 0.55) / 0.5, 0, 1)), R = W * 0.215, py = H * 0.235, qy = H * 0.765;
    if (a1 > 0) { this.glowAt(g, cols.w, ax, py, R * 2.2, 0.55 * a1); g.save(); g.translate(ax, py); g.scale(a1, a1); g.rotate((1 - a1) * -0.4); this.sceneDisc(g, A, 0, 0, R, cols.w); g.restore(); }
    if (a2 > 0) { this.glowAt(g, cols.b, ax, qy, R * 2.2, 0.55 * a2); g.save(); g.translate(ax, qy); g.scale(a2, a2); g.rotate((1 - a2) * 0.4); this.sceneDisc(g, B, 0, 0, R, cols.b); g.restore(); }
    const ribbon = (s, y, c, t0, dir) => {                                                                       // ruban incliné + nom + elo
      const u = EASE.out4(clamp((t - t0) / 0.5, 0, 1)); if (u <= 0 || !s) return; g.save(); g.translate(lerp(dir * W, 0, u), y); g.transform(1, 0, -0.18, 1, 0, 0);
      g.fillStyle = "rgba(0,0,0,.72)"; g.fillRect(-W * 0.1, -62 * k, W * 1.2, 150 * k); g.fillStyle = c; g.fillRect(-W * 0.1, -62 * k, W * 1.2, 8 * k); g.restore();
      this.sceneName(g, s.name, W / 2, y + 22 * k, W * 0.82, 82 * k, "#fff", u); this.sceneElo(g, s, W / 2, y + 78 * k, t0 + 0.2, t, 42 * k);
    };
    ribbon(A, H * 0.235 + R + 70 * k, cols.w, 0.9, -1); ribbon(B, H * 0.765 - R - 120 * k, cols.b, 1.05, 1);
    const vs = EASE.back(clamp((t - 0.95) / 0.35, 0, 1)); if (vs > 0) { g.save(); g.translate(W / 2, H / 2); g.scale(vs, vs); g.rotate(-0.1); this.glowAt(g, "#ffd666", 0, 0, W * 0.34, 0.5); g.font = FONT(230 * k); g.textAlign = "center"; g.textBaseline = "middle"; g.lineWidth = 16 * k; g.strokeStyle = "#000"; g.strokeText("VS", 0, 0); const gr = g.createLinearGradient(0, -110 * k, 0, 110 * k); gr.addColorStop(0, "#fff7c2"); gr.addColorStop(1, "#ff9a1f"); g.fillStyle = gr; g.fillText("VS", 0, 0); g.restore(); }
    this.sceneVignette(g, t, T); g.restore();
  };

  // ------------------------------------------------------------------ INTRO 2 : CARTES holographiques
  P.introCards = function (t, info) {
    const { W, H } = this, k = this.k(), g = this.ctx, T = this.introEnd, [A, B] = duel(info), tension = clamp((t - 2.5) / 1.3, 0, 1);
    g.save(); g.fillStyle = "#07080d"; g.fillRect(0, 0, W, H);
    const bg = g.createRadialGradient(W / 2, H * 0.5, 0, W / 2, H * 0.5, H * 0.65); bg.addColorStop(0, "#1b1f33"); bg.addColorStop(1, "#05060a"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.07; g.strokeStyle = "#8fb4ff"; g.lineWidth = 2 * k; for (let i = -4; i < 30; i++) { const x = ((i * 90 * k + t * 40 * k) % (W + 360 * k)) - 180 * k; g.beginPath(); g.moveTo(x, 0); g.lineTo(x - 300 * k, H); g.stroke(); } g.globalAlpha = 1;
    const shake = tension * 8 * k; g.translate(Math.sin(t * 91) * shake, Math.cos(t * 77) * shake);
    const cw = W * 0.445, ch = H * 0.6, cy = H * 0.5, rad = 34 * k;
    const card = (s, cx, c, c2, t0, dir) => {
      const u = EASE.back(clamp((t - t0) / 0.7, 0, 1)); if (u <= 0 || !s) return; const dy = (1 - clamp((t - t0) / 0.7, 0, 1)) * -H * 0.9 * dir; g.save(); g.translate(cx, cy + dy); g.rotate((1 - clamp((t - t0) / 0.7, 0, 1)) * 0.25 * dir);
      g.beginPath(); g.moveTo(-cw / 2 + rad, -ch / 2); g.arcTo(cw / 2, -ch / 2, cw / 2, ch / 2, rad); g.arcTo(cw / 2, ch / 2, -cw / 2, ch / 2, rad); g.arcTo(-cw / 2, ch / 2, -cw / 2, -ch / 2, rad); g.arcTo(-cw / 2, -ch / 2, cw / 2, -ch / 2, rad); g.closePath();
      const gr = g.createLinearGradient(0, -ch / 2, 0, ch / 2); gr.addColorStop(0, c); gr.addColorStop(1, c2); g.fillStyle = gr; g.fill(); g.save(); g.clip();
      const sh = ((t - t0) * 0.5) % 1.6 - 0.3; g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.25; const hg = g.createLinearGradient(-cw / 2 + sh * cw * 1.6, -ch / 2, -cw / 2 + sh * cw * 1.6 + cw * 0.3, ch / 2); hg.addColorStop(0, "rgba(255,255,255,0)"); hg.addColorStop(0.5, "rgba(255,255,255,1)"); hg.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = hg; g.fillRect(-cw / 2, -ch / 2, cw, ch); g.restore();
      g.strokeStyle = "rgba(255,255,255,.9)"; g.lineWidth = 6 * k; g.stroke();
      this.sceneDisc(g, s, 0, -ch * 0.16, cw * 0.36, "#fff"); this.sceneName(g, s.name, 0, ch * 0.2, cw * 0.88, 64 * k, "#fff");
      if (s.title) { g.fillStyle = "#c93a3a"; g.font = FONT(30 * k); const tw = g.measureText(s.title).width + 24 * k; g.fillRect(-tw / 2, ch * 0.235, tw, 44 * k); g.fillStyle = "#fff"; g.textAlign = "center"; g.fillText(s.title, 0, ch * 0.235 + 34 * k); }
      if (s.elo != null) { this.sceneElo(g, s, 0, ch * 0.385, t0 + 0.3, t, 56 * k); const f = clamp(s.elo / 3200, 0, 1) * EASE.out4(clamp((t - t0 - 0.3) / 1.4, 0, 1)); g.fillStyle = "rgba(0,0,0,.5)"; g.fillRect(-cw * 0.4, ch * 0.43, cw * 0.8, 14 * k); g.fillStyle = cols.gold; g.fillRect(-cw * 0.4, ch * 0.43, cw * 0.8 * f, 14 * k); }
      g.restore();
    };
    card(A, W * 0.265, "#d83a2e", "#3a0a08", 0.1, 1); card(B, W * 0.735, "#2f78ff", "#081b45", 0.35, -1);
    const vs = EASE.back(clamp((t - 1.0) / 0.4, 0, 1)); if (vs > 0) { g.save(); g.translate(W / 2, cy); g.scale(vs, vs); this.glowAt(g, "#fff", 0, 0, W * 0.2, 0.6); g.fillStyle = "#0a0b10"; g.beginPath(); g.arc(0, 0, 92 * k, 0, TAU); g.fill(); g.strokeStyle = cols.gold; g.lineWidth = 8 * k; g.stroke(); g.font = FONT(110 * k); g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#fff"; g.fillText("VS", 0, 6 * k); g.restore(); }
    this.sceneVignette(g, t, T); g.restore();
  };

  // ------------------------------------------------------------------ INTRO 3 : TERMINAL glitch
  P.introTerminal = function (t, info) {
    const { W, H } = this, k = this.k(), g = this.ctx, T = this.introEnd, [A, B] = duel(info);
    g.save(); g.fillStyle = "#020805"; g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.1; g.strokeStyle = "#35ff8a"; g.lineWidth = 1 * k; for (let x = 0; x < W; x += 60 * k) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); } for (let y = 0; y < H; y += 60 * k) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); } g.globalAlpha = 1;
    const typed = (s, t0, cps) => s.slice(0, Math.max(0, Math.min(s.length, Math.floor((t - t0) * cps))));
    g.textAlign = "left"; g.textBaseline = "alphabetic"; g.fillStyle = "#35ff8a"; g.font = MONO(40 * k);
    [["> INITIALISATION DU MATCH…", 0.05], ["> JOUEURS DÉTECTÉS : 2", 0.5], ["> ELO SYNCHRONISÉ", 0.9]].forEach(([s, t0], i) => g.fillText(typed(s, t0, 40) + (Math.floor(t * 4) % 2 && t < t0 + 0.6 && typed(s, t0, 40).length < s.length ? "█" : ""), 54 * k, 96 * k + i * 56 * k));
    const col = (s, c, cy, t0, rim) => {
      const u = clamp((t - t0) / 0.7, 0, 1); if (u <= 0 || !s) return; const R = W * 0.2, cx = W / 2, jit = (1 - u) * 26 * k * Math.sin(t * 120);
      g.save(); g.beginPath(); g.rect(0, cy - R * 1.1, W, R * 2.2 * u); g.clip();
      g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.5; this.sceneDisc(g, s, cx + jit - 8 * k * (1 - u), cy, R, "#ff2d55", 0.7); this.sceneDisc(g, s, cx + jit + 8 * k * (1 - u), cy, R, "#2dfff0", 0.7); g.restore();
      g.save(); g.globalAlpha = u; this.sceneDisc(g, s, cx + jit, cy, R, rim); g.restore();
      g.save(); g.textAlign = "center"; g.fillStyle = "#35ff8a"; g.font = MONO(44 * k); const nm = typed("> " + String(s.name).toUpperCase(), t0 + 0.3, 36); g.fillText(nm, cx, cy + R + 70 * k); g.restore();
      if (s.elo != null && t > t0 + 0.6) this.sceneElo(g, s, cx, cy + R + 130 * k, t0 + 0.6, t, 48 * k);
    };
    col(A, cols.w, H * 0.34, 1.0, cols.w); col(B, cols.b, H * 0.7, 1.5, cols.b);
    const cd = t > 2.6 ? Math.max(1, 3 - Math.floor((t - 2.6) / 0.4)) : 0; if (t > 2.6 && t < T - 0.1) { g.save(); g.globalAlpha = 0.85; g.textAlign = "center"; g.textBaseline = "middle"; g.font = FONT(300 * k * (1 + 0.15 * (1 - ((t - 2.6) % 0.4) / 0.4))); g.fillStyle = "#35ff8a"; g.fillText(String(cd), W / 2, H * 0.52); g.restore(); }
    g.save(); g.globalAlpha = 0.16; g.fillStyle = "#000"; for (let y = 0; y < H; y += 6 * k) g.fillRect(0, y, W, 2 * k); g.restore();                  // lignes de balayage
    const gl = Math.sin(t * 17) > 0.93 ? 1 : 0; if (gl) { g.save(); g.globalAlpha = 0.25; g.fillStyle = "#35ff8a"; g.fillRect(0, ((t * 523) % 1) * H, W, 14 * k); g.restore(); }
    this.sceneVignette(g, t, T); g.restore();
  };

  // ------------------------------------------------------------------ INTRO ÉQUIPES
  P.introTeams = function (t, info, st) {
    const { W, H } = this, k = this.k(), g = this.ctx, T = this.introEnd, tm = info.teams, tension = clamp((t - 2.5) / 1.3, 0, 1);
    const topW = tm.w.some((m) => m.human) || !tm.b.some((m) => m.human) ? "w" : "b", top = topW, bot = top === "w" ? "b" : "w", nT = tm[top].length, nB = tm[bot].length;
    g.save(); g.fillStyle = "#06070b"; g.fillRect(0, 0, W, H);
    const rn = mulberry(31); g.save(); g.globalCompositeOperation = "lighter"; for (let i = 0; i < 36; i++) { const x = (rn() * W + t * (10 + rn() * 30) * k) % W, y = (rn() * H - t * (20 + rn() * 40) * k + H * 2) % H, r = (2 + rn() * 5) * k; g.globalAlpha = 0.25 + 0.25 * rn(); g.fillStyle = "#9fc2ff"; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); } g.restore();
    const sh = tension * 9 * k; g.translate(Math.sin(t * 95) * sh, Math.cos(t * 83) * sh);
    const panel = (side, n, cy, t0, dirX) => {
      const c = side === "w" ? cols.w : cols.b, list = tm[side], u = EASE.out4(clamp((t - t0) / 0.6, 0, 1)), ox = st === 0 ? lerp(dirX * W, 0, u) : 0, oy = st === 1 ? lerp(dirX * H * 0.4, 0, u) : 0;
      g.save(); g.translate(ox, oy); g.globalAlpha = st === 1 ? u : 1;
      const bh = H * 0.26, gr = g.createLinearGradient(0, cy - bh / 2, 0, cy + bh / 2); gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.5, c + "55"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, cy - bh / 2, W, bh);
      const label = "ÉQUIPE " + (side === "w" ? "BLANCS" : "NOIRS") + " · " + n + (n > 1 ? " JOUEURS" : " JOUEUR"); g.textAlign = "center"; g.font = FONT(44 * k); g.lineWidth = 8 * k; g.strokeStyle = "#000"; g.strokeText(label, W / 2, cy - bh * 0.42); g.fillStyle = c; g.fillText(label, W / 2, cy - bh * 0.42);
      const R = Math.min(W * 0.115, (W * 0.92 / n) / 2.25), gap = W * 0.92 / n;
      list.forEach((m, i) => { const pu = EASE.back(clamp((t - t0 - 0.25 - i * 0.14) / 0.45, 0, 1)); if (pu <= 0) return; const x = W / 2 - W * 0.46 + gap * (i + 0.5), y = cy - bh * 0.04;
        g.save(); g.translate(x, y); g.scale(pu, pu); this.glowAt(g, c, 0, 0, R * 1.9, 0.35 * pu); this.sceneDisc(g, m, 0, 0, R, c); g.restore();
        this.sceneName(g, m.name, x, y + R + 40 * k, gap * 0.94, Math.min(40 * k, R * 0.5), "#fff", pu); });
      g.restore();
    };
    panel(top, nT, H * 0.22, 0.0, -1); panel(bot, nB, H * 0.76, 0.2, 1);
    const vs = EASE.back(clamp((t - 0.95) / 0.4, 0, 1)); if (vs > 0) { g.save(); g.translate(W / 2, H * 0.49); g.scale(vs, vs); g.rotate(-0.06); this.glowAt(g, "#ffd666", 0, 0, W * 0.32, 0.55); const txt = nT + " VS " + nB; g.font = FONT(200 * k); g.textAlign = "center"; g.textBaseline = "middle"; g.lineWidth = 16 * k; g.strokeStyle = "#000"; g.strokeText(txt, 0, 0); const gr = g.createLinearGradient(0, -100 * k, 0, 100 * k); gr.addColorStop(0, "#fff7c2"); gr.addColorStop(1, "#ff9a1f"); g.fillStyle = gr; g.fillText(txt, 0, 0); g.restore(); }
    this.sceneVignette(g, t, T); g.restore();
  };

  // ------------------------------------------------------------------ BANDEAU D'ÉQUIPES EN JEU (équipe qui joue = avatar agrandi + nom)
  P.teamHud = function (g, t) {
    const info = this.intro && this.intro.intro, tm = info && info.teams; if (!tm) return;
    if (!this._tm) { const cnt = { w: 0, b: 0 }; this._tm = this.mv.filter((e) => e.from && e.cheat !== "twist").map((e) => { const c = e.color, i = cnt[c]++; return { t: e.impact, c, i: i % Math.max(1, tm[c].length), e }; }); }
    if (this.outro && t >= this.outro.t + 0.1) return;
    const { W, H } = this, k = this.k(), flip = this.flipAt ? this.flipAt(t) : false, bot = flip ? "b" : "w", top = flip ? "w" : "b";
    let last = { w: -1, b: -1 }, cur = "", curI = -1; this._tm.forEach((m) => { if (m.t <= t + 0.001) { last[m.c] = m.i; cur = m.c; curI = m.i; } });
    const strip = (side, cy) => {
      const list = tm[side], n = list.length, R = Math.min(W * 0.062, (W * 0.8 / n) / 2.3), gap = Math.min(W * 0.8 / n, R * 3.6), c = side === "w" ? cols.w : cols.b, x0 = W / 2 - gap * (n - 1) / 2;
      g.save(); g.globalAlpha = 0.9; g.fillStyle = "rgba(0,0,0,.45)"; const bw = gap * n + R * 2, bh = R * 2 + 78 * k; g.beginPath(); const rx = W / 2 - bw / 2, ry = cy - R - 20 * k, rr = 26 * k; g.moveTo(rx + rr, ry); g.arcTo(rx + bw, ry, rx + bw, ry + bh, rr); g.arcTo(rx + bw, ry + bh, rx, ry + bh, rr); g.arcTo(rx, ry + bh, rx, ry, rr); g.arcTo(rx, ry, rx + bw, ry, rr); g.closePath(); g.fill(); g.restore();
      const lastEv = this.mv.filter((e) => e.from && e.color === side && e.impact <= t + 0.001).pop(), tal = {};
      this._tm.forEach((m) => { if (m.c === side && m.t <= t + 0.001) { const o = (tal[m.i] ||= { b: 0, m: 0, x: 0 }); if (m.e.key === "brilliant") o.b++; else if (m.e.key === "blunder") o.x++; else if (m.e.key === "mistake" || m.e.key === "miss") o.m++; } });
      list.forEach((m, i) => { const act = cur === side && curI === i, nextUp = cur !== side && ((last[side] + 1) % n) === i, a = act ? 1 : nextUp ? 0.9 : 0.5, sc = act ? 1.22 : nextUp ? 1.05 : 0.9, x = x0 + gap * i;
        g.save(); g.globalAlpha = a; if (act) this.glowAt(g, c, x, cy, R * 2.4, 0.6); g.translate(x, cy); g.scale(sc, sc); this.sceneDisc(g, m, 0, 0, R, act ? "#fff" : c, 1, act && lastEv && m.anim && KEYMOOD[m.anim] ? KEYMOOD[m.anim][lastEv.key] || (m.anim === "eto" ? "smile" : "idle") : undefined); g.restore();
        g.save(); g.globalAlpha = a; g.textAlign = "center"; const nm = String(m.name).toUpperCase(); const s = fitFont(g, nm, gap * 0.95, 24 * k, FONT); g.fillStyle = act ? "#fff" : "#cfd3e6"; g.fillText(nm, x, cy + R + 36 * k); g.restore();
        const o = tal[i]; if (o && (o.b || o.m || o.x)) {                                                       // compteurs de responsabilité : ◆ brillants, ! erreurs, ✕ gaffes
          const items = [[o.b, "#ffffff", 0], [o.m, "#ffffff", 1], [o.x, "#ffffff", 2]].filter((q) => q[0]), s = 11 * k, w = 46 * k, x1 = x - (items.length * w) / 2 + w / 2, yy = cy + R + 62 * k;
          items.forEach(([n, c, ty], j) => { const px = x1 + j * w; g.save(); g.fillStyle = c; g.strokeStyle = c; g.lineWidth = 4 * k; g.translate(px - 8 * k, yy);
            if (ty === 0) { g.beginPath(); g.moveTo(0, -s); g.lineTo(s, 0); g.lineTo(0, s); g.lineTo(-s, 0); g.closePath(); g.fill(); } else if (ty === 1) { g.fillRect(-2 * k, -s, 4 * k, s * 1.2); g.fillRect(-2 * k, s * 0.5, 4 * k, 4 * k); } else { g.beginPath(); g.moveTo(-s * 0.8, -s * 0.8); g.lineTo(s * 0.8, s * 0.8); g.moveTo(s * 0.8, -s * 0.8); g.lineTo(-s * 0.8, s * 0.8); g.stroke(); }
            g.restore(); g.save(); g.font = FONT(22 * k); g.textAlign = "left"; g.fillStyle = "#fff"; g.fillText(String(n), px + 6 * k, yy + 8 * k); g.restore(); }); } });
    };
    g.save(); strip(top, H * 0.5 - W / 2 - 78 * k - (this.W / 1080) * 12); strip(bot, H * 0.5 + W / 2 + 94 * k); g.restore();
    this.teamCredit(g, t, tm);
  };

  // ------------------------------------------------------------------ « QUI A JOUÉ ? » — bandeau NOIR sobre à chaque coup d'une équipe : l'avatar du joueur entre dans le cadre et son NOM seul s'affiche (aucun mot, aucune couleur d'alerte :
  //   le badge du coup dit déjà tout). Animation sur le calque : dalle noire inclinée qui glisse, reflet qui balaie, traînées blanches, étincelles ; une gaffe ajoute une secousse et un léger « bégaiement » monochrome du nom.
  P.teamCredit = function (g, t, tm) {
    const list = this._tm; if (!list || !list.length) return;
    let cur = -1; for (let i = 0; i < list.length; i++) { if (list[i].e.kind === "ff") continue; if (list[i].t - 0.12 <= t) cur = i; else break; }
    if (cur < 0) return; const it = list[cur], e = it.e; let nxt = Infinity; for (let j = cur + 1; j < list.length; j++) if (list[j].e.kind !== "ff") { nxt = list[j].t; break; }
    const hold = !!e.blunderHold, life = clamp(hold ? 1.9 : e.bigMove ? 1.5 : Math.min(1.3, nxt - it.t - 0.05), 0.5, 2.0), u = t - it.t + 0.12; if (u < 0 || u > life + 0.12) return;
    const { W, H } = this, k = this.k(), member = tm[it.c][it.i]; if (!member) return;
    const inK = EASE.back(clamp(u / 0.26, 0, 1)), outK = clamp((u - (life - 0.18)) / 0.22, 0, 1), dir = it.c === "w" ? -1 : 1, slide = lerp(dir * W * 1.1, 0, clamp(inK, 0, 1.15)) + dir * W * 1.1 * EASE.out3(outK);
    const sh = (hold ? 12 : 0) * k * Math.exp(-u * 4) * Math.sin(u * 90), cy = H * 0.072 + sh, bh = 170 * k;
    g.save(); g.translate(slide, 0);
    g.save(); g.transform(1, 0, -0.16, 1, 0, 0);                                                                  // dalle noire inclinée, filets blancs fins
    const gr = g.createLinearGradient(0, cy - bh / 2, 0, cy + bh / 2); gr.addColorStop(0, "#050506"); gr.addColorStop(1, "#16171c"); g.globalAlpha = 0.93; g.fillStyle = gr; g.fillRect(-W * 0.2, cy - bh / 2, W * 1.4, bh); g.globalAlpha = 1;
    g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(-W * 0.2, cy - bh / 2, W * 1.4, 3 * k); g.fillRect(-W * 0.2, cy + bh / 2 - 3 * k, W * 1.4, 3 * k);
    g.save(); g.beginPath(); g.rect(-W * 0.2, cy - bh / 2, W * 1.4, bh); g.clip(); g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 8; i++) { const x = ((i * 191 + u * (800 + i * 80)) % (W * 1.5)) - W * 0.2; g.globalAlpha = 0.07; g.fillStyle = "#fff"; g.fillRect(x, cy - bh / 2, (8 + (i % 3) * 12) * k, bh); }
    const sw = (u / 0.7) * (W * 1.6) - W * 0.3; g.globalAlpha = 0.22 * (1 - clamp(u / 0.8, 0, 1)); g.fillStyle = "#fff"; g.fillRect(sw, cy - bh / 2, 70 * k, bh);                    // reflet qui balaie
    g.restore(); g.restore();
    const ax = it.c === "w" ? W * 0.13 : W * 0.87, R = 76 * k * clamp(inK, 0, 1.12);
    g.save(); g.translate(ax, cy); g.rotate((1 - clamp(inK, 0, 1)) * dir * 0.8); g.strokeStyle = "rgba(255,255,255,.9)"; g.lineWidth = 3 * k; g.setLineDash([R * 0.2, R * 0.14]); g.lineDashOffset = -u * R * 1.5; g.beginPath(); g.arc(0, 0, R * 1.2, 0, TAU); g.stroke(); g.setLineDash([]); g.restore();
    this.sceneDisc(g, member, ax, cy, R, "#ffffff", 1, member.anim && KEYMOOD[member.anim] ? KEYMOOD[member.anim][e.key] || (member.anim === "eto" ? "smile" : "idle") : undefined);
    const tx = it.c === "w" ? W * 0.255 : W * 0.745, al = it.c === "w" ? "left" : "right", ta = clamp((u - 0.1) / 0.18, 0, 1), name = String(member.name).toUpperCase();
    g.save(); g.globalAlpha = ta; g.textBaseline = "middle"; g.textAlign = al; const ns = fitFont(g, name, W * 0.6, 96 * k, FONT), jit = hold && u < 0.5 ? Math.sin(u * 140) * 5 * k : 0;
    if (hold && u < 0.6) { g.fillStyle = "rgba(255,255,255,.28)"; g.fillText(name, tx - 7 * k + jit, cy); g.fillText(name, tx + 7 * k - jit, cy); }
    g.lineWidth = ns * 0.1; g.lineJoin = "round"; g.strokeStyle = "#000"; g.strokeText(name, tx + jit, cy); g.fillStyle = "#fff"; g.fillText(name, tx + jit, cy); g.restore();
    g.restore();
    if (u < 0.5) { const rn = mulberry(it.t * 977 | 0); g.save(); g.globalCompositeOperation = "lighter"; for (let i = 0; i < 16; i++) { const an = rn() * TAU, d = (70 + rn() * 240) * k * EASE.out3(clamp(u / 0.45, 0, 1)), sz = (3 + rn() * 6) * k; g.globalAlpha = (1 - u / 0.5) * 0.85; g.fillStyle = "#fff"; g.fillRect(ax + slide + Math.cos(an) * d, cy + Math.sin(an) * d, sz, sz); } g.restore(); }
  };

  // ------------------------------------------------------------------ OUTRO : dispatch
  const winnerSide = (o) => (o.winner && o.winner.color) || "";
  P.drawEnd = function (g, t) {
    const o = this.outro, st = this.outroStyle();
    if (!o || o.defeat || o.flip3d || !o.winner || st === 0) return orig.end.call(this, g, t);
    if (st === 1) return this.endVictory(g, t); if (st === 2) return this.endShatter(g, t); return this.endCinema(g, t);
  };
  const finalLine = function (g, o, u, y) { if (!(o.final && u > 1.1)) return; const { W } = this, k = this.k(), b = E.botChat && E.botChat.bots[o.final.bot], k2 = clamp((u - 1.1) / 0.6, 0, 1); g.save(); g.globalAlpha = k2; g.font = TXT(34 * k, 600); g.textAlign = "center"; const lines = this.wrap(g, "« " + o.final.text + " »", W * 0.82); g.fillStyle = "#fff"; lines.forEach((l, i) => g.fillText(l, W / 2, y + i * 44 * k)); if (b) { g.font = TXT(26 * k, 700); g.fillStyle = cols.gold; g.fillText(b.name, W / 2, y - 50 * k); } g.restore(); };
  P.winnerPeople = function () {
    const o = this.outro, info = (o && o.intro) || {}, c = winnerSide(o); if (!c) return [];
    if (info.teams && info.teams[c]) return info.teams[c];
    return [c === "w" ? info.white : info.black].filter(Boolean);
  };
  // OUTRO 1 : carte de victoire
  P.endVictory = function (g, t) {
    const { W, H } = this, k = this.k(), o = this.outro, u = t - o.t - 0.2, a = clamp(u / 0.4, 0, 1), people = this.winnerPeople(), n = people.length || 1, c = winnerSide(o) === "w" ? cols.w : cols.b;
    g.save(); g.globalAlpha = a * 0.68; g.fillStyle = "#04050a"; g.fillRect(0, 0, W, H); g.restore();
    const rn = mulberry(11); g.save(); g.globalCompositeOperation = "lighter"; for (let i = 0; i < 70; i++) { const x = rn() * W, sp = 80 + rn() * 220, ph = rn(), y = ((u * sp * k + ph * H * 1.3) % (H * 1.2)) - H * 0.1, sz = (3 + rn() * 7) * k; g.globalAlpha = a * (0.4 + 0.5 * rn()); g.fillStyle = rn() < 0.5 ? cols.gold : "#fff"; g.save(); g.translate(x + Math.sin(u * 2 + i) * 20 * k, y); g.rotate(u * 3 + i); g.fillRect(-sz, -sz / 2, sz * 2, sz); g.restore(); } g.restore();
    const R = n === 1 ? W * 0.2 : Math.min(W * 0.1, (W * 0.86 / n) / 2.2), cy = H * 0.36, gap = W * 0.86 / n, pop = EASE.back(clamp(u / 0.6, 0, 1));
    this.glowAt(g, cols.gold, W / 2, cy, W * 0.6, 0.35 * a);
    people.forEach((m, i) => { const x = n === 1 ? W / 2 : W / 2 - W * 0.43 + gap * (i + 0.5), pu = EASE.back(clamp((u - i * 0.12) / 0.6, 0, 1)); g.save(); g.translate(x, cy); g.scale(pu, pu);
      g.strokeStyle = cols.gold; g.lineWidth = Math.max(3, R * 0.05); g.setLineDash([R * 0.18, R * 0.12]); g.lineDashOffset = -u * R * 0.8; g.beginPath(); g.arc(0, 0, R * 1.22, 0, TAU); g.stroke(); g.setLineDash([]);
      this.sceneDisc(g, m, 0, 0, R, cols.gold, 1, m.anim === "eto" ? "happy" : "lock"); if (n > 1) { g.restore(); this.sceneName(g, m.name, x, cy + R * 1.2 + 42 * k, gap * 0.95, 34 * k, "#fff", pu); } else g.restore(); });
    const ry = H * 0.58, ru = EASE.out4(clamp((u - 0.3) / 0.5, 0, 1)); g.save(); g.translate(lerp(-W, 0, ru), ry); g.transform(1, 0, -0.12, 1, 0, 0); g.fillStyle = c; g.fillRect(-W * 0.1, -70 * k, W * 1.2, 130 * k); g.fillStyle = "rgba(255,255,255,.9)"; g.fillRect(-W * 0.1, 60 * k, W * 1.2, 8 * k); g.restore();
    g.save(); g.globalAlpha = ru; g.textAlign = "center"; g.textBaseline = "middle"; const vt = n > 1 ? "VICTOIRE D'ÉQUIPE" : "VICTOIRE", vs0 = fitFont(g, vt, W * 0.92, 120 * k, FONT); g.lineWidth = vs0 * 0.1; g.strokeStyle = "#000"; g.strokeText(vt, W / 2, ry - 6 * k); g.fillStyle = "#fff"; g.fillText(vt, W / 2, ry - 6 * k); g.restore();
    const nu = EASE.out3(clamp((u - 0.7) / 0.5, 0, 1)); g.save(); g.globalAlpha = nu; this.sceneName(g, o.winner.name, W / 2, H * 0.58 + 160 * k - (1 - nu) * 30 * k, W * 0.9, 86 * k, cols.gold, 1); g.font = TXT(36 * k, 700); g.textAlign = "center"; g.fillStyle = "#cfd3e6"; g.fillText(o.winner.mate ? "ÉCHEC ET MAT" : String(o.result || "").split("·")[0].trim().toUpperCase(), W / 2, H * 0.58 + 214 * k); g.restore();
    finalLine.call(this, g, o, u, H * 0.8);
  };
  // OUTRO 2 : l'image se brise en éclats
  P.endShatter = function (g, t) {
    const { W, H } = this, k = this.k(), o = this.outro, u = t - o.t - 0.2, p = clamp(u / 1.1, 0, 1);
    if (!this._shatter) this._shatter = document.createElement("canvas"); const sc = this._shatter; if (sc.width !== W || sc.height !== H) { sc.width = W; sc.height = H; }
    const sg = sc.getContext("2d"); sg.setTransform(1, 0, 0, 1, 0, 0); sg.clearRect(0, 0, W, H); sg.drawImage(g.canvas, 0, 0);                    // l'image DÉJÀ dessinée à cet instant (déterministe) est celle qui se brise
    const N = 9, cx = W * 0.5 + 30 * k, cy = H * 0.46, rn = mulberry(77); g.save(); g.fillStyle = "#020306"; g.fillRect(0, 0, W, H);
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * TAU + 0.3, a1 = ((i + 1) / N) * TAU + 0.3, am = (a0 + a1) / 2, d = EASE.out3(p) * (W * 0.55 + rn() * W * 0.3), rot = (rn() - 0.5) * 0.7 * p, R0 = Math.hypot(W, H);
      g.save(); g.translate(Math.cos(am) * d, Math.sin(am) * d + p * p * H * 0.25); g.translate(cx, cy); g.rotate(rot); g.translate(-cx, -cy); g.globalAlpha = 1 - clamp((p - 0.7) / 0.3, 0, 1) * 0.85;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a0) * R0, cy + Math.sin(a0) * R0); g.lineTo(cx + Math.cos(a1) * R0, cy + Math.sin(a1) * R0); g.closePath(); g.clip(); g.drawImage(sc, 0, 0); g.restore();
      g.save(); g.globalCompositeOperation = "lighter"; g.strokeStyle = "#fff"; g.globalAlpha = (1 - p) * 0.8; g.lineWidth = 3 * k; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a0) * W, cy + Math.sin(a0) * W); g.stroke(); g.restore();
    }
    const fl = clamp(1 - u / 0.2, 0, 1); if (fl > 0) { g.save(); g.globalAlpha = fl * 0.7; g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); g.restore(); }
    const tu = EASE.back(clamp((u - 0.8) / 0.5, 0, 1)); if (tu > 0) { g.save(); g.translate(W / 2, H * 0.46); g.scale(tu, tu); this.glowAt(g, cols.gold, 0, 0, W * 0.6, 0.4); g.restore(); this.stampText(g, o.winner.name.toUpperCase() + " GAGNE PAR ÉCHEC ET MAT", cols.gold, clamp((u - 0.8) / 0.3, 0, 1), 1); }
    finalLine.call(this, g, o, u - 0.4, H * 0.72); g.restore();
  };
  // OUTRO 3 : cinéma (bandes noires, nom révélé)
  P.endCinema = function (g, t) {
    const { W, H } = this, k = this.k(), o = this.outro, u = t - o.t - 0.2, a = EASE.out3(clamp(u / 0.6, 0, 1)), bh = H * 0.15 * a, people = this.winnerPeople();
    g.save(); g.globalAlpha = 0.72 * a; g.fillStyle = "#000"; g.fillRect(0, 0, W, H); g.globalAlpha = 1; g.fillStyle = "#000"; g.fillRect(0, 0, W, bh); g.fillRect(0, H - bh, W, bh);
    g.fillStyle = cols.gold; g.globalAlpha = a; g.fillRect(0, bh - 4 * k, W * a, 4 * k); g.fillRect(W - W * a, H - bh, W * a, 4 * k); g.globalAlpha = 1;
    const name = o.winner.name.toUpperCase(), reveal = EASE.out4(clamp((u - 0.5) / 0.9, 0, 1)), cy = H * 0.5;
    g.textAlign = "center"; g.textBaseline = "middle"; const s = fitFont(g, name, W * 0.9, 120 * k, FONT);
    g.save(); g.beginPath(); g.rect(W * 0.05, cy - s, W * 0.9 * reveal, s * 2); g.clip(); g.lineWidth = s * 0.12; g.strokeStyle = "#000"; g.strokeText(name, W / 2, cy); g.fillStyle = "#fff"; g.fillText(name, W / 2, cy); g.restore();
    const sx = lerp(-W * 0.3, W * 1.3, clamp((u - 0.5) / 1.2, 0, 1)); g.save(); g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.5 * (1 - Math.abs(clamp((u - 0.5) / 1.2, 0, 1) - 0.5) * 2); g.translate(sx, cy); g.transform(1, 0, -0.5, 1, 0, 0); g.fillStyle = "#fff"; g.fillRect(-30 * k, -s, 60 * k, s * 2); g.restore();
    const su = EASE.out3(clamp((u - 1.2) / 0.6, 0, 1)); g.save(); g.globalAlpha = su; g.font = TXT(40 * k, 800); g.fillStyle = cols.gold; const sub = (o.winner.mate ? "ÉCHEC ET MAT" : "VICTOIRE") + (people.length > 1 ? " · VICTOIRE D'ÉQUIPE" : ""); g.fillText(sub, W / 2, cy + s * 0.8 + (1 - su) * 20 * k); g.restore();
    if (people.length) { const R = Math.min(W * 0.07, (W * 0.8 / people.length) / 2.3), gap = Math.min(W * 0.8 / people.length, R * 3); people.forEach((m, i) => { const x = W / 2 - gap * (people.length - 1) / 2 + gap * i, pu = EASE.back(clamp((u - 1.4 - i * 0.1) / 0.5, 0, 1)); if (pu > 0) { g.save(); g.translate(x, cy + s * 0.8 + 70 * k + R); g.scale(pu, pu); this.sceneDisc(g, m, 0, 0, R, cols.gold); g.restore(); this.sceneName(g, m.name, x, cy + s * 0.8 + 70 * k + R * 2 + 34 * k, gap * 0.95, 28 * k, "#fff", pu); } }); }
    finalLine.call(this, g, o, u, H * 0.74); g.restore();
  };
})();
