"use strict";
// CHESS EDIT STUDIO — MOTEUR DE RENDU CANVAS DÉTERMINISTE. Une seule fonction pure du temps : draw(t) dessine l'image exacte de la vidéo à l'instant t (secondes) à partir de la timeline.
//   Même code pour l'aperçu (horloge audio) et pour l'EXPORT MP4 image par image à 60 FPS fixes (chess_edit_export.js) : plus aucune dépendance au framerate du téléphone.
//   Règles de perf : AUCUN ctx.filter, getImageData ni shadowBlur dans draw() ; halos, badges, pièces rouges / blanches, plateaux et fond flouté sont PRÉ-RENDUS une seule fois (load()).
//   Caméra (corrigée) : le canvas fait toute la taille de l'écran ; translate(centre écran) → shake → scale(S) → rotate(θ) → translate(−cible clampée) → plateau centré ; cadre étendu autour du plateau (jamais de vide).
(() => {
  const E = window.ENOS, TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, k) => a + (b - a) * k;
  const EASE = { lin: (k) => k, out3: (k) => 1 - Math.pow(1 - k, 3), out4: (k) => 1 - Math.pow(1 - k, 4), io: (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2), back: (k) => 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2) };
  const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const fenMapOf = (fen) => { const m = {}; (fen || "").split(" ")[0].split("/").forEach((row, r) => { let c = 0; for (const ch of row) { if (/\d/.test(ch)) c += +ch; else { m[String.fromCharCode(97 + c) + (8 - r)] = ch; c++; } } }); return m; };
  const FONT = (px) => `900 ${Math.round(px)}px Impact, "Arial Black", system-ui, sans-serif`;
  const TXT = (px, w) => `${w || 600} ${Math.round(px)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const PALETTE = { contrast: { l: ["#f7f7f7", "#EBEBEB", "#dedede"], d: ["#828282", "#767676", "#6a6a6a"] }, classic: { l: ["#f2f3da", "#EBECD0", "#dcddc2"], d: ["#7fa05c", "#739552", "#678748"] } };
  const imgCache = {};
  const IMGSTAT = { data: 0, net: 0 };
  /** images en data: URI (window.ENOS_IMG, js/render_assets.js) : un canvas qui a dessiné une image « réseau / fichier » est TAINTED dans le WebView (VideoFrame, captureStream, getImageData refusés) */
  const loadImg = (src) => (imgCache[src] ||= new Promise((res) => { const key = String(src).replace(E.assetBase || "", ""), emb = (window.ENOS_IMG || {})[key], i = new Image(); if (emb) IMGSTAT.data++; else IMGSTAT.net++; i.onload = () => res(i); i.onerror = () => res(null); i.src = emb || src; }));
  const mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

  class Renderer {
    /** canvas : taille interne = taille de la vidéo (ex. 1080×1920) ; tl : timeline (buildViral / buildSync) ; o : {flip, rec, base} */
    constructor(canvas, tl, o) {
      o = o || {}; this.cv = canvas; this.ctx = canvas.getContext("2d"); this.tl = tl; this.W = canvas.width; this.H = canvas.height; this.BS = this.W; this.cell = this.BS / 8; this.flip0 = !!o.flip; this.rec = o.rec || {}; this.base = o.base || E.assetBase || "";
      const evs = tl.events; this.intro = evs.find((e) => e.kind === "intro") || null; this.introEnd = this.intro ? this.intro.dur : 0; this.outro = evs.find((e) => e.kind === "outro") || null; this.setup = evs.find((e) => e.kind === "setup") || null;
      this.mv = evs.filter((e) => (e.from || e.drop || e.cheat === "twist") && e.fen).sort((a, b) => a.t - b.t); this.prompts = evs.filter((e) => e.kind === "prompt"); this.cut3s = evs.filter((e) => e.kind === "cut3");
      this.imp = this.mv.filter((e) => e.kind !== "ff"); this.twists = this.mv.filter((e) => e.cheat === "twist");
      this.scene = mk(this.W, this.H); this.tmp = mk(this.W, this.H); this.pc = {}; this.red = {}; this.sil = {}; this.glow = {}; this.badgeSpr = {}; this.av = {};
      this.buildCamera();
    }
    flipAt(t) { let f = this.flip0; this.twists.forEach((e) => { if (t >= e.impact + 0.7) f = !f; }); return f; }
    sq(name, flip) { let c = name.charCodeAt(0) - 97, r = 8 - +name[1]; if (flip) { c = 7 - c; r = 7 - r; } return { x: -this.BS / 2 + (c + 0.5) * this.cell, y: -this.BS / 2 + (r + 0.5) * this.cell, c, r }; }

    // ------------------------------------------------------------------ chargement (images + sprites pré-rendus)
    async load() {
      const A = this.base, codes = "KQRBNPkqrbnpMEGSmegs".split(""), imgs = await Promise.all(codes.map((ch) => loadImg(`${A}img/chess/${ch === ch.toUpperCase() ? "w" : "b"}${ch.toLowerCase()}.png`)));
      codes.forEach((ch, i) => { const im = imgs[i]; if (!im) return; this.pc[ch] = this.skin(im, ch === ch.toUpperCase()); this.red[ch] = this.tint(this.pc[ch], "#FF1111", true); this.sil[ch.toLowerCase()] = this.sil[ch.toLowerCase()] || this.tint(this.pc[ch], "#ffffff", false); });
      const need = new Set(["miss", "blunder", "brilliant", "best", "great", "excellent", "inaccuracy", "mistake", "good", "next", "mate"]);
      this.tl.events.forEach((e) => { if (e.badge && e.badge.img) need.add(e.badge.img); });
      await Promise.all([...need].map(async (n) => { const im = await loadImg(`${A}img/badges/${n}.png`); if (im) this.badgeSpr["img/badges/" + n + ".png"] = this.badgeSprite(im, ({ brilliant: "#1CE8E8", best: "#96bc4b", great: "#1bb3ad", excellent: "#96bc4b", inaccuracy: "#f7c631", mistake: "#e58f2a", blunder: "#CA3431", miss: "#ff2a2a", good: "#96bc4b", next: "#9aa7bd", mate: "#e8604c" })[n] || "#fff"); }));
      const srcs = new Set(); this.tl.events.forEach((e) => { if (e.aiImg) srcs.add(e.aiImg); if (e.intro) [e.intro.white, e.intro.black].forEach((s) => s && s.img && srcs.add(s.img)); (e.lines || []).forEach((l) => { const b = E.botChat && E.botChat.bots[l.bot]; if (b && b.img) srcs.add(b.img); }); if (e.final) { const b = E.botChat && E.botChat.bots[e.final.bot]; if (b && b.img) srcs.add(b.img); } });
      await Promise.all([...srcs].map(async (s) => { const im = await loadImg(A + s); if (im) { this.av[s] = im; this.badgeSpr[s] = this.badgeSprite(im, "#ffffff", true); } }));
      this.boards = { contrast: this.boardSprite("contrast"), classic: this.boardSprite("classic") }; this.bgBoard = this.blurredBoard(); this.loaded = true; return this;
    }
    /** pièce détourée : contour noir net de 2 px (blanches) / reflet interne en haut (noires) — pré-rendue */
    skin(im, white) {
      const N = 160, pad = 8, c = mk(N, N), g = c.getContext("2d"), w = N - pad * 2;
      for (let a = 0; a < 16; a++) { const t = (a / 16) * TAU; g.drawImage(im, pad + Math.cos(t) * 3, pad + Math.sin(t) * 3 + 1, w, w); }
      g.globalCompositeOperation = "source-in"; g.fillStyle = "#000"; g.fillRect(0, 0, N, N); g.globalCompositeOperation = "source-over"; g.drawImage(im, pad, pad + 1, w, w);
      if (!white) { g.globalCompositeOperation = "source-atop"; const gr = g.createLinearGradient(0, pad, 0, N * 0.55); gr.addColorStop(0, "rgba(255,255,255,.4)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, N, N * 0.55); }
      return c;
    }
    /** silhouette unie (blanc lumineux) ou rouge incandescent (cœur blanc-rose, contour rouge fluo) */
    tint(src, color, hot) {
      const c = mk(src.width, src.height), g = c.getContext("2d"); g.drawImage(src, 0, 0); g.globalCompositeOperation = "source-in"; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
      if (hot) { const c2 = mk(c.width, c.height), g2 = c2.getContext("2d"); g2.drawImage(c, 0, 0); g2.globalCompositeOperation = "source-atop"; const gr = g2.createRadialGradient(c.width / 2, c.height / 2, 4, c.width / 2, c.height / 2, c.width * 0.42); gr.addColorStop(0, "rgba(255,225,235,.95)"); gr.addColorStop(1, "rgba(255,17,17,0)"); g2.fillStyle = gr; g2.fillRect(0, 0, c.width, c.height); return c2; }
      return c;
    }
    badgeSprite(im, color, ring) {
      const N = 192, c = mk(N, N), g = c.getContext("2d"), gr = g.createRadialGradient(N / 2, N / 2, N * 0.18, N / 2, N / 2, N / 2); gr.addColorStop(0, color + "cc"); gr.addColorStop(1, color + "00"); g.fillStyle = gr; g.fillRect(0, 0, N, N);
      const s = N * 0.56; if (ring) { g.fillStyle = "#000"; g.beginPath(); g.arc(N / 2, N / 2, s / 2 + 3, 0, TAU); g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 4; g.stroke(); g.save(); g.beginPath(); g.arc(N / 2, N / 2, s / 2, 0, TAU); g.clip(); g.drawImage(im, N / 2 - s / 2, N / 2 - s / 2, s, s); g.restore(); } else g.drawImage(im, N / 2 - s / 2, N / 2 - s / 2, s, s);
      return c;
    }
    boardSprite(look) {
      const BS = this.BS, c = mk(BS, BS), g = c.getContext("2d"), P = PALETTE[look], cell = this.cell;
      for (let r = 0; r < 8; r++) for (let q = 0; q < 8; q++) { const pal = (r + q) % 2 ? P.d : P.l, gr = g.createLinearGradient(q * cell, r * cell, (q + 1) * cell, (r + 1) * cell); gr.addColorStop(0, pal[0]); gr.addColorStop(0.55, pal[1]); gr.addColorStop(1, pal[2]); g.fillStyle = gr; g.fillRect(q * cell, r * cell, cell + 1, cell + 1); }
      return c;
    }
    blurredBoard() { const c = mk(this.W, this.H), g = c.getContext("2d"); g.filter = "blur(14px) grayscale(1) brightness(.55)"; g.drawImage(this.boards.contrast, 0, (this.H - this.BS) / 2, this.BS, this.BS); g.filter = "none"; return c; }          // (au chargement seulement)
    glowSpr(color) { return (this.glow[color] ||= (() => { const c = mk(128, 128), g = c.getContext("2d"), r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, color); r.addColorStop(0.35, color + "99"); r.addColorStop(1, color + "00"); g.fillStyle = r; g.fillRect(0, 0, 128, 128); return c; })()); }

    // ------------------------------------------------------------------ caméra : images clés déterministes
    buildCamera() {
      const base = { S: 1.15, th: 0, x: 0, y: 0 }; this.camBase = base; let kf = [{ t: -1, s: base, ease: "lin" }];
      const at = (list, t) => { let i = list.length - 1; while (i > 0 && list[i].t > t) i--; const a = list[i], b = list[i + 1]; if (!b || t >= b.t) return a.s; const k = EASE[b.ease || "lin"]((t - a.t) / Math.max(1e-6, b.t - a.t)); return { S: lerp(a.s.S, b.s.S, k), th: lerp(a.s.th, b.s.th, k), x: lerp(a.s.x, b.s.x, k), y: lerp(a.s.y, b.s.y, k) }; };
      this.imp.forEach((e) => {
        if (e.cheat === "twist") return; const ti = e.impact, cur = at(kf, ti), rnd = mulberry((e.n || 1) * 9301 + 49297), power = e.kind === "drop" ? 1 : clamp((e.drama || 0) / 80, 0.35, 1), S = lerp(1.8, 2.8, power), sg = rnd() < 0.45 ? -1 : 1, th = ((sg < 0 ? -(6 + rnd() * 6) : 8 + rnd() * 7) * Math.PI) / 180;
        const p = this.sq(e.to, this.flipAt(ti)), hold = Math.max(0.56, (e.freeze || 0) * 0.7 + 0.3), tgt = { S, th, x: p.x, y: p.y };
        kf = kf.filter((k) => k.t < ti); kf.push({ t: ti, s: cur, ease: "lin" }, { t: ti + 0.15, s: tgt, ease: "out3" }, { t: ti + hold, s: tgt, ease: "lin" }, { t: ti + hold + 0.48, s: base, ease: "out3" });
      });
      kf.sort((a, b) => a.t - b.t); this.kf = kf; this.camAt = (t) => at(this.kf, t);
    }

    // ------------------------------------------------------------------ état du plateau à l'instant t
    stateAt(t) {
      let i = -1; for (let k = 0; k < this.mv.length; k++) { if (this.mv[k].t <= t) i = k; else break; }
      if (i < 0) return { map: fenMapOf(this.setup ? this.setup.fen : (this.mv[0] ? (this.mv[0].snap || this.mv[0].fenBefore) : "")), mover: null };
      const e = this.mv[i], mt = e.t + (e.pre || 0), dur = Math.max(0.001, (e.dur || 70) / 1000), p = (t - mt) / dur;
      if (e.cheat === "twist") return { map: fenMapOf(e.fen), mover: null, e };
      if (p >= 1 || (!e.from && !e.drop)) return { map: fenMapOf(e.fen), mover: null, e };
      const before = fenMapOf(e.snap || e.fenBefore);
      if (e.drop) { const after = fenMapOf(e.fen), map = t >= e.impact ? after : Object.assign({}, before), ch = after[e.to]; if (t < e.impact) delete map[e.to]; return { map, mover: ch && t >= mt ? { sq: e.to, ch, scale: EASE.back(clamp((t - mt) / 0.28, 0, 1)), drop: true } : null, e }; }
      const ch = before[e.from]; if (!ch) return { map: fenMapOf(e.fen), mover: null, e };
      const map = Object.assign({}, before); delete map[e.from];
      return { map, mover: { from: e.from, to: e.to, ch, k: p < 0 ? 0 : EASE.out4(clamp(p, 0, 1)), boss: t < mt && e.boss }, e };
    }

    // ------------------------------------------------------------------ dessin
    piece(g, ch, x, y, size, o) {
      const spr = (o && o.red ? this.red[ch] : this.pc[ch]); if (!spr) return; o = o || {};
      g.save(); g.translate(x, y); if (o.rot) g.rotate(o.rot); if (o.scale != null) g.scale(o.scale, o.scale); if (o.alpha != null) g.globalAlpha = o.alpha; g.drawImage(spr, -size / 2, -size / 2, size, size); g.restore();
    }
    glowAt(g, color, x, y, r, a) { g.save(); g.globalCompositeOperation = "lighter"; g.globalAlpha = a; g.drawImage(this.glowSpr(color), x - r, y - r, r * 2, r * 2); g.restore(); }

    /** image complète à l'instant t (secondes) */
    draw(t) {
      if (!this.loaded) return; const { ctx, W, H } = this;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
      if (t < this.introEnd - 0.3) { this.drawIntro(t); return; }
      const strobe = this.imp.find((e) => e.strobe && t >= e.impact && t < e.impact + 0.055), chromaAmp = this.chromaAt(t, strobe), needChroma = chromaAmp > 0.8, tg = needChroma ? this.scene.getContext("2d") : ctx;
      this.drawWorld(tg, t, strobe);
      if (needChroma) this.composeChroma(chromaAmp);
      this.drawScreenFx(ctx, t);
      this.drawOverlays(ctx, t);
      if (t < this.introEnd) { const k = (t - (this.introEnd - 0.3)) / 0.3; ctx.save(); ctx.globalAlpha = 1 - EASE.out3(clamp(k, 0, 1)); this.drawIntro(this.introEnd - 0.3); ctx.restore(); }
      if (this.introEnd && t >= this.introEnd && t < this.introEnd + 0.14) { ctx.fillStyle = "#fff"; ctx.globalAlpha = 0.9 * (1 - (t - this.introEnd) / 0.14); ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    }
    chromaAt(t, strobe) { if (strobe) return 25 * this.k(); let a = 0; for (const e of this.imp) { const u = t - e.impact; if (u >= 0 && u < 0.14) a = Math.max(a, (4 + 6 * clamp((e.drama || 0) / 80, 0.3, 1)) * this.k() * (1 - u / 0.14)); } return a; }
    k() { return this.W / 1080; }
    composeChroma(amp) {
      const g = this.ctx, W = this.W, H = this.H, tg = this.tmp.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, W, H); g.save(); g.globalCompositeOperation = "lighter";
      [["#ff0000", -amp, 0], ["#00ff00", 0, 0], ["#0000ff", amp, amp * 0.3]].forEach(([c, dx, dy]) => { tg.globalCompositeOperation = "source-over"; tg.clearRect(0, 0, W, H); tg.drawImage(this.scene, 0, 0); tg.globalCompositeOperation = "multiply"; tg.fillStyle = c; tg.fillRect(0, 0, W, H); g.drawImage(this.tmp, dx, dy); });
      g.restore();
    }
    drawWorld(g, t, strobe) {
      const { W, H, BS } = this, st = this.stateAt(t), flip = this.flipAt(t), cam = this.camAt(t), k = this.k(); let { S, th } = cam;
      let tx = cam.x, ty = cam.y;
      const tw = this.twists.find((e) => t >= e.impact && t < e.impact + 1.4); if (tw) { const kk = EASE.out4((t - tw.impact) / 1.4); th += Math.PI * kk; S = Math.min(S, 1.0); tx = 0; ty = 0; }
      if (this.outro && t >= this.outro.t) { const kk = EASE.out3(clamp((t - this.outro.t) / 0.7, 0, 1)); S = lerp(S, 1.0, kk); th = lerp(th, 0, kk); tx = lerp(tx, 0, kk); ty = lerp(ty, 0, kk); }
      if (strobe) { const kk = (t - strobe.impact) / 0.055; S *= lerp(1.35, 1.12, kk); }
      else { const sb = this.imp.find((e) => e.strobe && t >= e.impact + 0.055 && t < e.impact + 0.4); if (sb) { const kk = (t - sb.impact - 0.055) / 0.345, el = 1 + Math.sin(kk * 9) * Math.exp(-kk * 5) * 0.12; S *= el; } }
      const maxO = (BS / 2) * (1 - 1 / Math.max(1, S)), cx = clamp(-tx, -maxO, maxO), cy = clamp(-ty, -maxO, maxO);
      let sx = 0, sy = 0; for (const e of this.imp) { const u = t - e.impact; if (u >= 0 && u < 0.18) { const a = 18 * k * Math.exp(-u / 0.05); sx += Math.sin(u * 190 + e.n) * a; sy += Math.cos(u * 173 + e.n * 2) * a; } }
      const intro = this.introEnd && t >= this.introEnd && t < this.introEnd + 0.3 ? lerp(0.78, 1, EASE.out3((t - this.introEnd) / 0.3)) : 1;
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; g.fillStyle = "#0b0c10"; g.fillRect(0, 0, W, H);
      g.save(); g.translate(W / 2, H / 2); g.translate(sx, sy); g.scale(S * intro, S * intro); g.rotate(th); g.translate(cx, cy);
      this.drawBoard(g, t, st, flip); this.drawFx(g, t, st, flip); g.restore();
    }
    drawBoard(g, t, st, flip) {
      const BS = this.BS, cell = this.cell, classic = this.outro && t >= this.outro.t + 0.35, fr = BS * 0.55;
      const gr = g.createRadialGradient(0, 0, BS * 0.3, 0, 0, BS * 1.6); gr.addColorStop(0, "#23252d"); gr.addColorStop(1, "#08090c"); g.fillStyle = gr; g.fillRect(-BS * 1.9, -BS * 1.9, BS * 3.8, BS * 3.8);       // cadre étendu : aucune coupure franche, même à 15° de rotation
      g.fillStyle = "#15161b"; g.fillRect(-BS / 2 - fr, -BS / 2 - fr, BS + fr * 2, BS + fr * 2); g.strokeStyle = "#3b3e49"; g.lineWidth = BS * 0.012; g.strokeRect(-BS / 2 - BS * 0.02, -BS / 2 - BS * 0.02, BS * 1.04, BS * 1.04);
      g.drawImage(this.boards[classic ? "classic" : "contrast"], -BS / 2, -BS / 2);
      // ombre portée des pièces (une ellipse floue pré-rendue par pièce serait plus chère : un seul voile)
      const draw = (sq, ch, o) => { const p = this.sq(sq, flip); this.piece(g, ch, p.x, p.y, cell * 1.02, o); };
      const kingSqNow = st.e && st.e.kingSq, tilt = st.e && (st.e.check || st.e.mate) && st.e.kingEdge && t >= st.e.impact && t < st.e.impact + 0.9 ? Math.sin(clamp((t - st.e.impact) / 0.9, 0, 1) * Math.PI) * 0.56 : 0;
      for (const sq of Object.keys(st.map)) { const ch = st.map[sq], o = {}; if (tilt && sq === kingSqNow) o.rot = tilt; g.save(); g.globalAlpha = 0.28; const p = this.sq(sq, flip); g.fillStyle = "#000"; g.beginPath(); g.ellipse(p.x, p.y + cell * 0.36, cell * 0.3, cell * 0.08, 0, 0, TAU); g.fill(); g.restore(); draw(sq, ch, o); }
      const m = st.mover;
      if (m) {
        if (m.drop) { const p = this.sq(m.sq, flip); this.piece(g, m.ch, p.x, p.y, cell * 1.02, { scale: m.scale, alpha: clamp(m.scale, 0, 1) }); }
        else {
          const a = this.sq(m.from, flip), b = this.sq(m.to, flip), x = lerp(a.x, b.x, m.k), y = lerp(a.y, b.y, m.k), e = st.e;
          if (m.boss) this.piece(g, m.ch, a.x, a.y, cell * 1.02, { red: true, scale: 1.65, rot: (22 * Math.PI) / 180 });           // GIANT RED BOSS PIECE : ×1,65, 22° sur son propre centre
          else { if (m.k < 1 && m.k > 0) this.glowAt(g, "#ffffff", x, y, cell * 0.9, 0.25); this.piece(g, m.ch, x, y, cell * 1.02, { scale: 1 + 0.08 * Math.sin(m.k * Math.PI) }); }
        }
      }
    }
    drawFx(g, t, st, flip) {
      const cell = this.cell, BS = this.BS;
      for (const e of this.imp) {
        const u = t - e.impact; if (u < -0.001 || u > 2.2 || e.cheat === "twist") continue; const P = this.sq(e.to, flip), tone = ({ cyan: "#1CE8E8", red: "#FF2A2A", green: "#58D628", blue: "#268BFF", gold: "#ffd24a" })[e.tone] || "#58D628";
        // chemin rouge : toutes les cases traversées, le reste du plateau s'assombrit
        if (e.redPath && e.from && u < 0.95) {
          const al = u < 0.15 ? u / 0.15 : u > 0.65 ? 1 - (u - 0.65) / 0.3 : 1; g.save(); g.globalAlpha = 0.5 * al; g.fillStyle = "#000"; g.fillRect(-BS / 2, -BS / 2, BS, BS); g.restore();
          this.pathSquares(e).forEach((q, i) => { const p = this.sq(q, flip), a = clamp((u - i * 0.018) / 0.18, 0, 1) * al; g.save(); g.globalAlpha = 0.88 * a; g.fillStyle = "#FF2A1A"; g.fillRect(p.x - cell / 2, p.y - cell / 2, cell, cell); g.restore(); this.glowAt(g, "#FF2A1A", p.x, p.y, cell * 1.25, 0.8 * a); });
        } else if (u < 0.9) {                                                                       // case d'arrivée allumée + halo
          const al = 1 - clamp(u / 0.9, 0, 1); g.save(); g.globalAlpha = 0.4 * al; g.fillStyle = tone; g.fillRect(P.x - cell / 2, P.y - cell / 2, cell, cell); g.restore(); this.glowAt(g, tone, P.x, P.y, cell * 1.6, 0.9 * al);
        }
        if (e.check || e.mate) this.beam(g, e, u, flip);
        if (e.arrow && e.from && u < 1.6) this.arrow(g, e, u, flip);
        // double onde de choc + cadre de visée sur !! / ! et sur les badges IA
        const shock = e.key === "brilliant" || e.key === "great" || e.key === "excellent" || e.illegal;
        if (shock && u < 0.95) { const bx = P.x + cell * 0.36, by = P.y - cell * 0.36, col = e.key === "brilliant" ? "#1CE8E8" : e.illegal ? "#ffffff" : "#268BFF";
          for (let i = 0; i < 2; i++) { const kk = (u - i * 0.09) / 0.35; if (kk > 0 && kk < 1) { g.save(); g.globalAlpha = 1 - kk; g.strokeStyle = col; g.lineWidth = cell * 0.05; g.beginPath(); g.arc(bx, by, cell * 0.25 * lerp(0.5, 3, kk), 0, TAU); g.stroke(); g.restore(); } }
          const bk = clamp(u / 0.3, 0, 1), sc = lerp(2.6, 1, EASE.out3(bk)), al = u > 0.7 ? 1 - (u - 0.7) / 0.25 : bk; g.save(); g.globalAlpha = al; g.strokeStyle = col; g.lineWidth = cell * 0.05; const s = (cell * 0.56) * sc, L = s * 0.32;
          [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => { const x0 = P.x + sx * s, y0 = P.y + sy * s; g.beginPath(); g.moveTo(x0, y0 - sy * L); g.lineTo(x0, y0); g.lineTo(x0 - sx * L, y0); g.stroke(); }); g.restore(); }
        // badges (palette complète + logo IA) côte à côte, en haut à droite de la case
        const bl = this.badgeList(e); if (bl.length && u < 1.8) bl.forEach((b, i) => { const spr = this.badgeSpr[b.img]; if (!spr) return; const bk = clamp((u - i * 0.09) / 0.22, 0, 1), sc = EASE.back(bk), fade = u > 1.5 ? 1 - (u - 1.5) / 0.3 : 1, sz = cell * 0.98 * sc, hdr = 0.85 + 0.35 * Math.sin(u * 9 + i); g.save(); g.globalAlpha = clamp(fade, 0, 1); g.drawImage(spr, P.x + cell * 0.5 - cell * 0.62 * 0.75 - i * cell * 0.52 - sz / 2 + cell * 0.15, P.y - cell * 0.42 - sz / 2 + cell * 0.1, sz, sz); this.glowAt(g, b.glow, P.x + cell * 0.5 - cell * 0.35 - i * cell * 0.52, P.y - cell * 0.32, cell * 0.8 * sc, 0.35 * hdr * clamp(fade, 0, 1)); g.restore(); });
        if (e.glasses && u > 0 && u < 1.9) this.glasses(g, P, u);
        if (e.captured && u < 0.7 && !e.drop) this.burst(g, e, P, u);
        if (e.kingEdge && e.kingSq && u > 0.14 && u < 0.2) { /* le basculement du roi est dessiné dans drawBoard */ }
      }
    }
    badgeList(e) {
      const out = [], key = e.illegal ? (e.glasses ? "img/badges/blunder.png" : "img/badges/miss.png") : e.badge && e.badge.img ? "img/badges/" + e.badge.img + ".png" : "";
      if (key) out.push({ img: key, glow: e.illegal ? (e.glasses ? "#CA3431" : "#ff2a2a") : (e.badge && e.badge.color) || "#fff" }); if (e.aiImg) out.push({ img: e.aiImg, glow: "#ffffff" }); return out;
    }
    pathSquares(e) {
      const from = e.from, to = e.to, f = [from.charCodeAt(0) - 97, +from[1] - 1], t = [to.charCodeAt(0) - 97, +to[1] - 1], dx = t[0] - f[0], dy = t[1] - f[1], nm = (c, r) => String.fromCharCode(97 + c) + (r + 1), sqs = [];
      if ((e.piece || "").toLowerCase() === "n" || (dx && dy && Math.abs(dx) !== Math.abs(dy))) { const sx = Math.sign(dx), sy = Math.sign(dy); sqs.push(from); if (Math.abs(dx) >= Math.abs(dy)) { for (let k = 1; k <= Math.abs(dx); k++) sqs.push(nm(f[0] + sx * k, f[1])); for (let k = 1; k <= Math.abs(dy); k++) sqs.push(nm(t[0], f[1] + sy * k)); } else { for (let k = 1; k <= Math.abs(dy); k++) sqs.push(nm(f[0], f[1] + sy * k)); for (let k = 1; k <= Math.abs(dx); k++) sqs.push(nm(f[0] + sx * k, t[1])); } }
      else { const n = Math.max(Math.abs(dx), Math.abs(dy)), sx = Math.sign(dx), sy = Math.sign(dy); for (let k = 0; k <= n; k++) sqs.push(nm(f[0] + sx * k, f[1] + sy * k)); }
      return sqs;
    }
    beam(g, e, u, flip) {
      if (u > 0.95 || !e.kingSq) return; const a = this.sq(e.to, flip), b = this.sq(e.kingSq, flip), grow = clamp(u / 0.18, 0, 1), fade = u > 0.7 ? 1 - (u - 0.7) / 0.25 : 1, x2 = lerp(a.x, b.x, grow), y2 = lerp(a.y, b.y, grow), c = this.cell;
      g.save(); g.lineCap = "round"; g.globalAlpha = fade; [[c * 0.5, "rgba(255,150,0,.18)"], [c * 0.3, "rgba(255,170,0,.4)"], [c * 0.14, "#ffb300"], [c * 0.06, "#ffffff"]].forEach(([w, col]) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(x2, y2); g.stroke(); });
      g.restore(); if (u > 0.15 && u < 0.9 && Math.floor(u * 33) % 2 === 0) { g.save(); g.globalAlpha = 0.55; g.fillStyle = "#ff1010"; g.fillRect(b.x - c / 2, b.y - c / 2, c, c); g.restore(); }       // le roi clignote en rouge vif
    }
    arrow(g, e, u, flip) {
      const a = this.sq(e.from, flip), b = this.sq(e.to, flip), c = this.cell, ang = Math.atan2(b.y - a.y, b.x - a.x), len = Math.hypot(b.x - a.x, b.y - a.y), grow = EASE.out3(clamp(u / 0.35, 0, 1)), fade = u > 1.3 ? 1 - (u - 1.3) / 0.3 : 1, hs = c * 0.55, w = c * 0.2, d = Math.max(0, len * grow - hs * 0.9);
      g.save(); g.globalAlpha = clamp(fade, 0, 1); g.translate(a.x, a.y); g.rotate(ang);
      const path = () => { g.beginPath(); g.moveTo(0, -w / 2); g.lineTo(d, -w / 2); g.lineTo(d, -hs * 0.5); g.lineTo(d + hs, 0); g.lineTo(d, hs * 0.5); g.lineTo(d, w / 2); g.lineTo(0, w / 2); g.closePath(); };
      g.lineJoin = "round"; g.strokeStyle = "rgba(255,150,0,.22)"; g.lineWidth = c * 0.42; path(); g.stroke(); g.strokeStyle = "rgba(255,160,0,.45)"; g.lineWidth = c * 0.22; path(); g.stroke(); g.fillStyle = "#FFD000"; path(); g.fill(); g.strokeStyle = "#fff3b0"; g.lineWidth = c * 0.03; path(); g.stroke(); g.restore();
    }
    glasses(g, P, u) {
      if (!this._gl) { const cv = mk(16, 5), x = cv.getContext("2d"); x.fillStyle = "#000"; [[0, 0, 16, 1], [0, 1, 7, 3], [9, 1, 7, 3], [1, 4, 5, 1], [10, 4, 5, 1], [7, 1, 2, 1]].forEach((r) => x.fillRect(...r)); x.fillStyle = "#fff"; x.fillRect(1, 1, 2, 1); x.fillRect(10, 1, 2, 1); this._gl = cv; }
      const c = this.cell, w = c * 0.8, k = EASE.back(clamp(u / 0.42, 0, 1)), y = lerp(-c * 2.4, 0, k), al = u > 1.6 ? 1 - (u - 1.6) / 0.3 : clamp(u / 0.1, 0, 1); g.save(); g.imageSmoothingEnabled = false; g.globalAlpha = clamp(al, 0, 1); g.drawImage(this._gl, P.x - w / 2, P.y - c * 0.32 + y, w, w * 5 / 16); g.restore();
    }
    burst(g, e, P, u) {
      const rnd = mulberry((e.n || 1) * 31 + 7), n = 22; g.save(); g.globalCompositeOperation = "lighter"; for (let i = 0; i < n; i++) { const a = rnd() * TAU, sp = (0.4 + rnd() * 1.6) * this.cell, d = sp * u * 2, al = clamp(1 - u / 0.7, 0, 1); g.globalAlpha = al; g.fillStyle = rnd() < 0.5 ? "#ff8a2a" : "#ffd27a"; const s = this.cell * (0.03 + rnd() * 0.03); g.fillRect(P.x + Math.cos(a) * d, P.y + Math.sin(a) * d + 30 * u * u, s, s); } g.restore();
    }

    // ------------------------------------------------------------------ effets plein écran (après la caméra)
    drawScreenFx(g, t) {
      const { W, H } = this;
      for (const e of this.imp) {
        const u = t - e.impact; if (u < 0 || u > 1.4) continue;
        if (u < 0.045) { g.fillStyle = e.key === "blunder" ? "#ff1a3c" : "#fff"; g.globalAlpha = 0.45; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }                       // flash blanc 0,45 pendant 45 ms
        if ((e.key === "blunder" || e.check || e.mate) && u < 0.9) { g.save(); g.globalCompositeOperation = "overlay"; g.globalAlpha = 0.9 * (u > 0.35 ? 1 - (u - 0.35) / 0.55 : 1); g.fillStyle = "rgba(255,20,20,.35)"; g.fillRect(0, 0, W, H); g.restore(); }
        if (e.key === "brilliant" && u < 1.3) { const col = e.kind === "drop" ? "#38FF14" : "#1CE8E8", al = u < 0.2 ? u / 0.2 : u > 1 ? 1 - (u - 1) / 0.3 : 1, off = (u * 64) % 64; g.save(); g.globalCompositeOperation = "screen"; g.globalAlpha = 0.5 * al; g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); for (let x = -64 + off; x < W; x += 64 * this.k() + 1) { g.moveTo(x, 0); g.lineTo(x, H); } for (let y = -64 + off; y < H; y += 64 * this.k() + 1) { g.moveTo(0, y); g.lineTo(W, y); } g.stroke(); g.restore(); }
        if (e.strobe && u < 0.055) { g.save(); g.globalCompositeOperation = "screen"; g.globalAlpha = 0.8; const step = 58 * this.k(); g.lineWidth = 3 * this.k(); g.strokeStyle = "rgba(255,40,60,.9)"; g.beginPath(); for (let y = 0; y < H; y += step) { g.moveTo(0, y); g.lineTo(W, y); } g.stroke(); g.strokeStyle = "rgba(50,90,255,.9)"; g.beginPath(); for (let x = 0; x < W; x += step) { g.moveTo(x, 0); g.lineTo(x, H); } g.stroke(); g.restore(); }
        if ((e.kind === "drop" || e.strobe || e.mate) && u < 0.26) {                                                                                        // lignes de vitesse radiales (flou radial)
          const rnd = mulberry((e.n || 1) * 17), al = 1 - u / 0.26, R = Math.hypot(W, H); g.save(); g.globalAlpha = al * 0.8; g.strokeStyle = "#fff"; g.lineWidth = 2 * this.k(); g.beginPath(); for (let i = 0; i < 28; i++) { const a = rnd() * TAU, r0 = R * (0.14 + u * 0.8 + rnd() * 0.05), r1 = r0 + R * (0.2 + rnd() * 0.12); g.moveTo(W / 2 + Math.cos(a) * r0, H / 2 + Math.sin(a) * r0); g.lineTo(W / 2 + Math.cos(a) * r1, H / 2 + Math.sin(a) * r1); } g.stroke(); g.restore();
        }
      }
      const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.55)"); g.fillStyle = vg; g.fillRect(0, 0, W, H);
    }

    // ------------------------------------------------------------------ overlays : UN SEUL à la fois (fin > prompt > bulle de bot > mini-cutscene)
    drawOverlays(g, t) {
      const { W, H } = this, k = this.k(); let did = false;
      if (this.outro && t >= this.outro.t + 0.2) { this.drawEnd(g, t); did = true; }
      const tw = this.twists.find((e) => t >= e.impact + 0.9 && t < e.impact + 4.2);
      if (!did && tw) { this.stampText(g, "CHATGPT A GAGNÉ PAR CHECKMATE", "#ffd666", clamp((t - tw.impact - 0.9) / 0.35, 0, 1), (t - tw.impact - 0.9) > 2.6 ? 1 - ((t - tw.impact - 0.9) - 2.6) / 0.5 : 1); did = true; }
      const pr = this.prompts.find((e) => t >= e.t && t < e.t + e.dur + 0.04);
      if (!did && pr) { this.drawPrompt(g, pr, t); did = true; }
      const c3 = this.cut3s.find((e) => t >= e.t && t < e.t + e.dur);
      if (!did && c3) { this.drawCut3(g, c3, t); did = true; }
      if (!did) { const hid = this.prompts.some((e) => t >= e.t - 0.25 && t < e.t + e.dur + 0.5); if (!hid) this.drawSay(g, t); }
    }
    stampText(g, text, color, a, fade) {
      const { W, H } = this, k = this.k(), sc = lerp(2.4, 1, EASE.out3(a)); g.save(); g.translate(W / 2, H * 0.42); g.rotate(-0.12); g.scale(sc, sc); g.globalAlpha = clamp(a * fade, 0, 1); g.font = FONT(64 * k); g.textAlign = "center"; g.textBaseline = "middle";
      const lines = this.wrap(g, text, W * 0.8), lh = 70 * k, hh = lines.length * lh + 28 * k, ww = Math.min(W * 0.86, Math.max(...lines.map((l) => g.measureText(l).width)) + 50 * k);
      g.fillStyle = "rgba(0,0,0,.62)"; g.fillRect(-ww / 2, -hh / 2, ww, hh); g.strokeStyle = color; g.lineWidth = 6 * k; g.strokeRect(-ww / 2, -hh / 2, ww, hh); g.fillStyle = color; lines.forEach((l, i) => g.fillText(l, 0, (i - (lines.length - 1) / 2) * lh)); g.restore();
    }
    wrap(g, text, maxW) { const words = String(text).split(" "), lines = []; let cur = ""; words.forEach((w) => { const tt = cur ? cur + " " + w : w; if (g.measureText(tt).width > maxW && cur) { lines.push(cur); cur = w; } else cur = tt; }); if (cur) lines.push(cur); return lines; }
    drawEnd(g, t) {
      const { W, H } = this, k = this.k(), o = this.outro, u = t - o.t, a = clamp((u - 0.2) / 0.35, 0, 1);
      g.save(); g.fillStyle = "rgba(0,0,0,.45)"; g.globalAlpha = a; g.fillRect(0, 0, W, H); g.restore();
      const main = String(o.result || "FIN").split("·")[0].trim().toUpperCase(), tw = this.twists.length ? "CHATGPT PRIME GAGNE PAR CHECKMATE" : main;
      this.stampText(g, tw, "#ffd666", a, 1);
      if (o.final && u > 0.9) { const b = E.botChat && E.botChat.bots[o.final.bot], k2 = clamp((u - 0.9) / 0.6, 0, 1); g.save(); g.globalAlpha = k2; g.font = TXT(34 * k, 600); g.textAlign = "center"; const lines = this.wrap(g, "« " + o.final.text + " »", W * 0.82); g.fillStyle = "#fff"; lines.forEach((l, i) => g.fillText(l, W / 2, H * 0.66 + i * 44 * k)); if (b) { g.font = TXT(26 * k, 700); g.fillStyle = "#ffd666"; g.fillText(b.name, W / 2, H * 0.66 - 50 * k); } g.restore(); }
    }
    drawPrompt(g, e, t) {
      const { W, H } = this, k = this.k(), u = (t - e.t) / e.dur; g.save(); g.fillStyle = "#000"; g.globalAlpha = 0.8 * clamp(u / 0.2, 0, 1); g.fillRect(0, 0, W, H); g.restore();
      const sil = this.sil[(e.piece || "q").toLowerCase()]; if (sil) { const rot = u > 0.55 ? ((u - 0.55) / 0.45) * TAU : 0, s = W * 0.34; this.glowAt(g, "#ffffff", W / 2, H * 0.36, s * 0.9, 0.7); g.save(); g.translate(W / 2, H * 0.36); g.rotate(rot); g.drawImage(sil, -s / 2, -s / 2, s, s); g.restore(); }
      const q = e.q || "Quel est ton prochain coup ?"; g.save(); g.translate(W * 0.5, H * 0.58); g.rotate(-0.1); g.font = TXT(34 * k, 600); const ql = this.wrap(g, q, W * 0.6), bw = Math.min(W * 0.72, Math.max(...ql.map((l) => g.measureText(l).width)) + 50 * k), bh = ql.length * 44 * k + 30 * k;
      g.globalAlpha = clamp(u / 0.15, 0, 1); g.fillStyle = "rgba(255,255,255,.08)"; g.fillRect(-bw / 2 + W * 0.08, -bh / 2, bw, bh); g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 3 * k; g.strokeRect(-bw / 2 + W * 0.08, -bh / 2, bw, bh); g.fillStyle = "#fff"; g.textAlign = "left"; ql.forEach((l, i) => g.fillText(l, -bw / 2 + W * 0.08 + 25 * k, -bh / 2 + 46 * k + i * 44 * k)); g.restore();
      const full = "« " + (e.text || "…") + " »", shown = full.slice(0, Math.ceil(full.length * clamp((u - 0.1) / 0.7, 0, 1))); g.save(); g.translate(W * 0.5, H * 0.74); g.rotate(-0.06); g.font = TXT(32 * k, 500); const al = this.wrap(g, full, W * 0.78), ah = al.length * 42 * k + 34 * k, aw = W * 0.84;
      g.fillStyle = "rgba(255,255,255,.06)"; g.fillRect(-aw / 2, -ah / 2, aw, ah); g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 3 * k; g.strokeRect(-aw / 2, -ah / 2, aw, ah); g.fillStyle = "#fff"; g.textAlign = "left"; this.wrap(g, shown, W * 0.78).forEach((l, i) => g.fillText(l, -aw / 2 + 28 * k, -ah / 2 + 50 * k + i * 42 * k));
      if (Math.floor(t * 8) % 2 === 0) { g.fillStyle = "#fff"; g.fillRect(aw / 2 - 40 * k, ah / 2 - 40 * k, 10 * k, 26 * k); } g.restore();
    }
    drawCut3(g, e, t) {
      const { W, H } = this, k = this.k(), u = (t - e.t) / e.dur, r = e.ref, a = u < 0.12 ? u / 0.12 : u > 0.85 ? (1 - u) / 0.15 : 1; g.save(); g.globalAlpha = clamp(a, 0, 1) * 0.62; g.fillStyle = "#000"; g.fillRect(0, 0, W, H); g.globalAlpha = clamp(a, 0, 1);
      const own = (r.color === "w" ? r.piece.toUpperCase() : r.piece), foe = r.captured ? (r.color === "w" ? r.captured : r.captured.toUpperCase()) : (r.color === "w" ? "k" : "K"), s = W * 0.66, sl = lerp(-s, W * 0.05, EASE.out3(clamp(u / 0.5, 0, 1))), sr = lerp(W + s * 0.1, W * 0.95 - s, EASE.out3(clamp(u / 0.5, 0, 1)));
      g.save(); g.translate(sl + s / 2, H * 0.46); g.rotate(-0.12); if (this.pc[own]) g.drawImage(this.pc[own], -s / 2, -s / 2, s, s); g.restore(); g.save(); g.translate(sr + s / 2, H * 0.46); g.rotate(0.12); if (this.pc[foe]) g.drawImage(this.pc[foe], -s / 2, -s / 2, s, s); g.restore();
      g.font = FONT(78 * k); g.textAlign = "center"; g.lineWidth = 8 * k; g.strokeStyle = "#0a6a6a"; g.strokeText(String(e.text || "").toUpperCase(), W / 2, H * 0.82); g.fillStyle = "#fff"; g.fillText(String(e.text || "").toUpperCase(), W / 2, H * 0.82); g.restore();
    }
    drawSay(g, t) {
      const { W, H } = this, k = this.k(); let cur = null;
      for (const e of this.imp) { const u = t - e.impact - 0.25; if (u >= 0 && u < 2.4 && e.lines && e.lines.length) cur = { l: e.lines[0], u }; }
      if (!cur) return; const b = E.botChat && E.botChat.bots[cur.l.bot], text = cur.l.text, shown = text.slice(0, Math.ceil(text.length * clamp(cur.u / 0.7, 0, 1))), fade = cur.u > 2.1 ? 1 - (cur.u - 2.1) / 0.3 : clamp(cur.u / 0.15, 0, 1);
      g.save(); g.globalAlpha = clamp(fade, 0, 1); const bh = 150 * k, y = H - bh - 120 * k, x = 40 * k, w = W - 80 * k; g.fillStyle = "rgba(0,0,0,.78)"; g.fillRect(x, y, w, bh); g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 2 * k; g.strokeRect(x, y, w, bh);
      const av = b && b.img && this.av[b.img]; if (av) { g.save(); g.beginPath(); g.arc(x + 70 * k, y + bh / 2, 50 * k, 0, TAU); g.clip(); g.drawImage(av, x + 20 * k, y + bh / 2 - 50 * k, 100 * k, 100 * k); g.restore(); }
      g.fillStyle = "#ffd666"; g.font = TXT(24 * k, 700); g.textAlign = "left"; g.fillText(b ? b.name : cur.l.bot, x + 140 * k, y + 38 * k); g.fillStyle = "#fff"; g.font = TXT(28 * k, 500); this.wrap(g, shown, w - 170 * k).slice(0, 3).forEach((l, i) => g.fillText(l, x + 140 * k, y + 76 * k + i * 34 * k)); g.restore();
    }

    // ------------------------------------------------------------------ INTRO « face-off » (3,8 s) : mise en scène dynamique
    drawIntro(t) {
      const { W, H } = this, k = this.k(), g = this.ctx, T = this.introEnd, info = this.intro.intro || {}, bot = (s) => !!(s && !s.human), P1 = info.white && info.white.human ? info.white : info.black && info.black.human ? info.black : info.white, P2 = P1 === info.white ? info.black : info.white;
      g.save(); g.fillStyle = "#07080c"; g.fillRect(0, 0, W, H);
      const zoom = 1 + 0.08 * clamp(t / T, 0, 1); g.save(); g.translate(W / 2, H / 2); g.rotate(-0.06 + t * 0.004); g.scale(zoom * 1.1, zoom * 1.1); g.drawImage(this.bgBoard, -W / 2, -H / 2); g.restore();      // plateau flouté, sombre, en mouvement lent
      const rnd = mulberry(77); g.save(); g.globalCompositeOperation = "lighter"; for (let i = 0; i < 40; i++) { const x = (rnd() * W + t * (10 + rnd() * 30) * k) % W, y = (rnd() * H - t * (20 + rnd() * 40) * k + H * 2) % H, r = (2 + rnd() * 5) * k; g.globalAlpha = 0.25 + 0.25 * Math.sin(t * 2 + i); g.fillStyle = i % 3 ? "#9fe9ff" : "#ff8a7a"; g.fillRect(x, y, r, r); } g.restore();
      const tension = clamp((t - 2.5) / 1.3, 0, 1), sh = tension * 10 * k; g.translate(Math.sin(t * 95) * sh, Math.cos(t * 83) * sh);
      const R = W * 0.23, pulse = 1 + 0.03 * Math.sin(t * TAU * 2), slide = (t0, dir) => lerp(dir * W * 0.8, 0, EASE.out3(clamp((t - t0) / 0.6, 0, 1)));
      const avatar = (s, cx, cy, rim, boss) => {
        const gl = boss ? 0.55 + 0.45 * tension + 0.15 * Math.sin(t * 12) : 0.5; this.glowAt(g, rim, cx, cy, R * 2.1, gl); g.save(); g.translate(cx, cy); g.scale(pulse, pulse); g.fillStyle = "#111"; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
        const im = s && s.img && this.av[s.img]; if (im) { g.save(); g.beginPath(); g.arc(0, 0, R - 4 * k, 0, TAU); g.clip(); g.drawImage(im, -R, -R, R * 2, R * 2); g.restore(); } else { g.fillStyle = "#fff"; g.font = FONT(R * 0.9); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(s && s.human ? "TOI" : "?", 0, 0); }
        g.strokeStyle = rim; g.lineWidth = 8 * k; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.stroke(); g.strokeStyle = "#fff"; g.lineWidth = 3 * k; g.beginPath(); g.arc(0, 0, R + 9 * k, 0, TAU); g.stroke(); g.restore();
      };
      const x1 = W * 0.30 + slide(0, -1), y1 = H * 0.205, x2 = W * 0.70 + slide(0.05, 1), y2 = H * 0.665; avatar(P1, x1, y1, "#ff4a3a", false); avatar(P2, x2, y2, "#3d8bff", bot(P2));
      const vs = EASE.back(clamp((t - 0.6) / 0.4, 0, 1)); if (vs > 0) { g.save(); g.translate(W / 2, H * 0.475); g.scale(vs, vs); g.rotate(-0.05); this.glowAt(g, "#38e8ff", 0, 0, W * 0.3, 0.6); g.font = FONT(220 * k); g.textAlign = "center"; g.textBaseline = "middle"; const gr = g.createLinearGradient(0, -110 * k, 0, 110 * k); gr.addColorStop(0, "#ffffff"); gr.addColorStop(0.45, "#9aa0b0"); gr.addColorStop(0.5, "#e8ecff"); gr.addColorStop(1, "#6a7088"); g.lineWidth = 12 * k; g.strokeStyle = "#000"; g.strokeText("VS", 0, 0); g.fillStyle = gr; g.fillText("VS", 0, 0); g.restore(); }
      const nm = (s, cx, cy, side) => {
        const a = clamp((t - 0.9) / 0.4, 0, 1); if (a <= 0 || !s) return; g.save(); g.globalAlpha = a; g.textAlign = "center"; const name = String(s.human ? (s.name === "Toi" ? "TOI" : s.name) : s.name).toUpperCase();
        g.font = FONT(64 * k); g.lineWidth = 9 * k; g.strokeStyle = "#000"; g.strokeText(name, cx, cy + R + 86 * k); g.fillStyle = "#fff"; g.fillText(name, cx, cy + R + 86 * k);
        const tag = s.title ? s.title : s.human ? "" : "AI", y = cy + R + 150 * k; g.font = FONT(34 * k); const tw = tag ? g.measureText(tag).width + 26 * k : 0; let eloTxt = ""; if (s.elo != null) { const kk = EASE.out4(clamp((t - 0.9) / 1.5, 0, 1)); eloTxt = Math.round(s.elo * kk) + " ELO"; }
        g.font = FONT(44 * k); const ew = eloTxt ? g.measureText(eloTxt).width : 0, total = tw + (tw && ew ? 16 * k : 0) + ew; let x = cx - total / 2;
        if (tag) { g.fillStyle = tag === "AI" ? "#ff9a1f" : "#c93a3a"; g.fillRect(x, y - 38 * k, tw, 52 * k); g.fillStyle = "#fff"; g.font = FONT(34 * k); g.textAlign = "left"; g.fillText(tag, x + 13 * k, y); x += tw + 16 * k; }
        if (eloTxt) { g.font = FONT(44 * k); g.fillStyle = "#ffd666"; g.textAlign = "left"; g.fillText(eloTxt, x, y + 2 * k); } g.restore();
      };
      nm(P1, x1, y1, -1); nm(P2, x2, y2, 1);
      if (tension > 0) { g.save(); g.globalAlpha = tension * 0.5; const vg = g.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.7); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(255,30,30,.6)"); g.fillStyle = vg; g.fillRect(-W * 0.1, -H * 0.1, W * 1.2, H * 1.2); g.restore(); }
      g.restore();
    }
  }
  E.editRender = { Renderer, fenMapOf, EASE, IMGSTAT };
})();
