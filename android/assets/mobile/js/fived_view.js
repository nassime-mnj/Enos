"use strict";
// 5D CHESS — RENDU : le multivers vu comme une constellation de plateaux de verre flottants (timelines en lignes, temps en colonnes).
// Canvas 2D + couche d'émission (« glow ») rendue à 1/4 puis 1/16 de résolution et ajoutée en mode « lighter » : halos néon / bloom sans WebGL.
// Couleurs en espace Display-P3 quand l'écran le permet (OLED large gamme) : néons plus saturés, rendu « HDR » ; repli sRGB sinon.
// Le rendu ne contient AUCUNE règle : il lit l'état du moteur (js/fived.js), anime les coups déjà joués et renvoie les touchers au contrôleur (m_fived.js).
(() => {
  const E = window.ENOS, FD = E.fived, V = (E.fivedView = {});
  const TAU = Math.PI * 2, clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, k) => a + (b - a) * k;
  const ease = { out3: (k) => 1 - Math.pow(1 - k, 3), io3: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2), back: (k) => 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2), out5: (k) => 1 - Math.pow(1 - k, 5) };
  const P3 = (() => { try { return !!(CSS.supports("color", "color(display-p3 1 0 0)") && matchMedia("(color-gamut: p3)").matches); } catch (e) { return false; } })();
  V.wideGamut = P3;
  const rgb = (c, a) => (P3 ? `color(display-p3 ${c[0]} ${c[1]} ${c[2]} / ${a == null ? 1 : a})` : `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a == null ? 1 : a})`);
  const COL = { cyan: [0.1, 1, 1], magenta: [1, 0.2, 0.85], amber: [1, 0.72, 0.14], red: [1, 0.14, 0.3], green: [0.25, 1, 0.55], violet: [0.62, 0.38, 1], gold: [1, 0.86, 0.5], ice: [0.82, 0.95, 1], white: [1, 1, 1] };
  V.COL = COL; V.rgb = rgb;
  const BS = 200, GX = 275, GY = 275;                                                                 // taille d'un plateau et espacement (unités du monde)
  const mkc = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
  const rnd = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  class View {
    constructor(canvas, o) {
      o = o || {}; this.cv = canvas; this.ctx = this.mkCtx(canvas); this.o = o; this.S = null; this.human = "w"; this.demo = !!o.demo;
      this.cam = { x: 0, y: 0, z: 0.6 }; this.camT = { x: 0, y: 0, z: 0.6 }; this.free = false; this.shake = { a: 0, t0: 0 };
      this.sel = null; this.targets = []; this.threats = []; this.hint = null; this.lock = null;
      this.anims = []; this.parts = []; this.rings = []; this.appear = {}; this.hide = {}; this.flash = { t0: -9, a: 0, col: COL.white }; this.streak = { t0: -9, seed: 1 };
      this.pc = {}; this.sil = {}; this.tiles = {}; this.glow = mkc(8, 8); this.gctx = this.glow.getContext("2d"); this.glow2 = mkc(8, 8); this.g2 = this.glow2.getContext("2d");
      this.now = 0; this.t0 = performance.now(); this.alive = true; this.dirty = true; this.ptrs = new Map(); this.onTap = null; this.onCamera = null; this.stars = null; this.reduce = false;
      this.resize(); this.bind(); this.assets = this.load(); this.tick = this.tick.bind(this); requestAnimationFrame(this.tick);
    }
    mkCtx(cv) { let c = null; try { c = cv.getContext("2d", { colorSpace: P3 ? "display-p3" : "srgb", alpha: false, desynchronized: true }); } catch (e) { /* repli */ } return c || cv.getContext("2d"); }

    // ------------------------------------------------------------------ ressources
    async load() {
      const A = E.assetBase || "", names = []; for (const c of ["w", "b"]) for (const k of ["p", "n", "b", "r", "q", "k"]) names.push(c + k);
      await Promise.all(names.map((n) => new Promise((res) => {
        const key = "img/chess/" + n + ".png", i = new Image(), emb = (window.ENOS_IMG || {})[key]; i.onload = () => { this.pc[n] = i; res(); }; i.onerror = () => res(); i.src = emb || A + key;
      })));
      for (const n of names) { const im = this.pc[n]; if (!im) continue; const c = mkc(128, 128), g = c.getContext("2d"); g.drawImage(im, 0, 0, 128, 128); g.globalCompositeOperation = "source-in"; g.fillStyle = "#fff"; g.fillRect(0, 0, 128, 128); this.sil[n] = c; }
      this.dirty = true;
    }
    bind() {
      const cv = this.cv; cv.style.touchAction = "none";
      const down = (e) => { cv.setPointerCapture && cv.setPointerCapture(e.pointerId); this.ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY, x0: e.offsetX, y0: e.offsetY, t0: performance.now() }); this.pinch = null; };
      const move = (e) => {
        const p = this.ptrs.get(e.pointerId); if (!p) return; const dx = e.offsetX - p.x, dy = e.offsetY - p.y; p.x = e.offsetX; p.y = e.offsetY;
        if (this.demo || this.lock === "all") return;
        if (this.ptrs.size === 1) { if (Math.hypot(p.x - p.x0, p.y - p.y0) > 8) { p.moved = true; this.free = true; this.cam.x -= dx / this.cam.z; this.cam.y -= dy / this.cam.z; this.camT.x = this.cam.x; this.camT.y = this.cam.y; this.dirty = true; } }
        else if (this.ptrs.size === 2) {
          const [a, b] = [...this.ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          if (this.pinch) { const k = d / this.pinch.d; this.zoomAt(mx, my, this.cam.z * k); this.cam.x -= (mx - this.pinch.mx) / this.cam.z; this.cam.y -= (my - this.pinch.my) / this.cam.z; this.camT.x = this.cam.x; this.camT.y = this.cam.y; }
          this.pinch = { d, mx, my }; p.moved = true; this.free = true;
        }
      };
      const up = (e) => {
        const p = this.ptrs.get(e.pointerId); this.ptrs.delete(e.pointerId); if (!p) return; this.pinch = null;
        if (!p.moved && performance.now() - p.t0 < 450 && this.onTap) this.onTap(e.offsetX, e.offsetY);
      };
      cv.addEventListener("pointerdown", down); cv.addEventListener("pointermove", move); cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", (e) => this.ptrs.delete(e.pointerId));
      cv.addEventListener("wheel", (e) => { if (this.demo) return; e.preventDefault(); this.free = true; this.zoomAt(e.offsetX, e.offsetY, this.cam.z * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
      this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(cv.parentElement || cv);
    }
    zoomAt(px, py, z) {
      z = clamp(z, this.minZ || 0.1, 3.2); const w = this.s2w(px, py); this.cam.z = this.camT.z = z; const w2 = this.s2w(px, py); this.cam.x += w.x - w2.x; this.cam.y += w.y - w2.y; this.camT.x = this.cam.x; this.camT.y = this.cam.y; this.dirty = true;
    }
    setQuality(low) { this.reduce = !!low; this.dpr = 0; this.resize(); }                                           // « Effets réduits » : résolution ≤ 1,25 et moins de bloom
    destroy() { this.alive = false; if (this._ro) this._ro.disconnect(); }
    resize() {
      const pe = this.cv.parentElement || this.cv, r = { width: pe.clientWidth, height: pe.clientHeight }, dpr = Math.min(window.devicePixelRatio || 1, this.reduce ? 1.25 : 2.5), w = Math.max(120, Math.round(r.width)), h = Math.max(120, Math.round(r.height));
      if (w === this.W && h === this.H && dpr === this.dpr) return; this.W = w; this.H = h; this.dpr = dpr; this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr); this.cv.style.width = w + "px"; this.cv.style.height = h + "px";
      this.glow.width = Math.max(8, Math.round(w * dpr / 4)); this.glow.height = Math.max(8, Math.round(h * dpr / 4)); this.glow2.width = Math.max(4, Math.round(w * dpr / 16)); this.glow2.height = Math.max(4, Math.round(h * dpr / 16));
      this.dirty = true; if (this.S && !this.free) this.fitPresent(true);
    }

    // ------------------------------------------------------------------ géométrie
    pos(l, t) { return { x: t * GX, y: -l * GY }; }                                                         // centre du plateau
    cellSize() { return BS / Math.max(this.S.W, this.S.H); }
    cellPos(l, t, x, y) { const p = this.pos(l, t), c = this.cellSize(); return { x: p.x - BS / 2 + (x + 0.5) * c, y: p.y + BS / 2 - (y + 0.5) * c }; }
    s2w(px, py) { return { x: this.cam.x + (px - this.W / 2) / this.cam.z, y: this.cam.y + (py - this.H / 2) / this.cam.z }; }
    w2s(wx, wy) { return { x: (wx - this.cam.x) * this.cam.z + this.W / 2, y: (wy - this.cam.y) * this.cam.z + this.H / 2 }; }
    bounds(list) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const b of list) { const p = this.pos(b.l, b.t); x0 = Math.min(x0, p.x - BS / 2); x1 = Math.max(x1, p.x + BS / 2); y0 = Math.min(y0, p.y - BS / 2); y1 = Math.max(y1, p.y + BS / 2); }
      return { x0, y0, x1, y1 };
    }
    allBoards() { const out = []; if (!this.S) return out; for (const l of Object.keys(this.S.tl)) { const d = this.S.tl[l]; for (let i = 0; i < d.list.length; i++) out.push({ l: +l, t: d.t0 + i }); } return out; }
    frame(list, o) {
      o = o || {}; if (!list.length) return; const b = this.bounds(list); b.x0 -= 70; b.y0 -= 30;                                        // marge pour la barre du présent et l'étiquette de timeline
      const pad = o.pad == null ? 70 : o.pad, top = o.top == null ? (this.topInset || 74) : o.top, bot = o.bottom == null ? (this.botInset || 150) : o.bottom;
      const w = b.x1 - b.x0 + pad * 2, h = b.y1 - b.y0 + pad * 2, z = clamp(Math.min((this.W - 8) / w, (this.H - top - bot) / h), 0.08, o.maxZ || 1.25);
      this.camT = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 - (top - bot) / 2 / z, z }; if (o.snap) this.cam = Object.assign({}, this.camT); this.free = false; this.dirty = true; this.minZ = Math.min(this.minZ || 1, z * 0.6);
    }
    fitAll(snap) { this.minZ = 0.06; this.frame(this.allBoards(), { snap, maxZ: 0.9 }); }
    fitPresent(snap) {
      if (!this.S) return; const p = FD.present(this.S), list = []; for (const l of Object.keys(this.S.tl)) { const t = FD.latest(this.S, +l); if (FD.isActive(this.S, +l) && t <= p + 2) list.push({ l: +l, t }); }
      const l0 = this.allBoards().filter((b) => b.t === FD.latest(this.S, b.l) && FD.isActive(this.S, b.l)); this.frame(l0.length > 4 ? list : l0, { snap, maxZ: 1.7, pad: l0.length > 1 ? 70 : 34 }); if (this.cam.z < 0.2 && !snap) this.cam.z = 0.2;
    }
    focusOn(wx, wy, z) { this.camT = { x: wx, y: wy, z: z || this.camT.z }; this.free = false; this.dirty = true; }

    // ------------------------------------------------------------------ effets
    burst(wx, wy, col, n, spd, size, life) {
      const R = Math.random; for (let i = 0; i < n; i++) { const a = R() * TAU, v = (0.3 + R()) * spd; this.parts.push({ x: wx, y: wy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: (life || 0.8) * (0.6 + R() * 0.8), col, size: (size || 3) * (0.5 + R()), g: 0 }); }
      this.dirty = true;
    }
    ring(wx, wy, col, r1, dur, w) { this.rings.push({ x: wx, y: wy, col, r1, t0: this.now, dur: dur || 0.7, w: w || 5 }); this.dirty = true; }
    doShake(a) { this.shake = { a: Math.max(this.shake.a * 0.6, a), t0: this.now }; this.dirty = true; }
    doFlash(col, a) { this.flash = { t0: this.now, a: a || 0.4, col: col || COL.white }; this.dirty = true; }
    doStreak() { this.streak = { t0: this.now, seed: (Math.random() * 1e6) | 0 }; this.dirty = true; }
    /** anime un coup DÉJÀ joué dans le moteur : le plateau d'arrivée « se matérialise » quand la pièce atterrit ; fini() est rappelé à la fin. */
    playMove(ev, fini) {
      const S = this.S, c = this.cellSize(), from = this.cellPos(ev.from.l, ev.from.t, ev.from.x, ev.from.y);
      const dest = ev.boards.find((b) => b.role === "dest"), src = ev.boards.find((b) => b.role === "src"), to = dest ? this.cellPos(dest.l, dest.t, ev.to.x, ev.to.y) : from;
      const dist = Math.hypot(to.x - from.x, to.y - from.y), dur = this.reduce ? 0.25 : clamp(0.42 + dist / 1500, 0.45, 1.35) * (ev.time ? 1.25 : 1), key = `${dest.l}|${dest.t}|${ev.to.x}|${ev.to.y}`;
      const code = (ev.color === "w" ? "w" : "b") + "pnbrqk"[Math.abs(ev.piece) - 1];
      this.hide[key] = true; const t0 = this.now;
      if (src) this.appear[`${src.l}|${src.t}`] = t0 - 0.2;
      for (const b of ev.boards) if (b.role === "dest") this.appear[`${b.l}|${b.t}`] = t0 + dur * 0.55;
      this.anims.push({ type: "fly", t0, dur, from, to, code, ev, key, c, dist, done: fini, spin: ev.time, kn: Math.abs(ev.piece) === 2 });
      if (ev.time) { this.doStreak(); this.doFlash(ev.branch != null ? COL.magenta : COL.violet, 0.28); }
      this.free = false; const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      if (dist > 420) { const b = this.bounds([{ l: ev.from.l, t: ev.from.t }, { l: dest.l, t: dest.t }]); this.frame([{ l: ev.from.l, t: ev.from.t }, { l: dest.l, t: dest.t }].concat(src ? [{ l: src.l, t: src.t }] : []), { pad: 90, maxZ: 1.0 }); }
      else this.focusOn(mid.x, mid.y, clamp(this.camT.z, 0.5, 1.0));
      this.dirty = true;
    }
    landed(a) {
      delete this.hide[a.key]; const ev = a.ev, p = a.to, col = ev.cap ? COL.amber : ev.branch != null ? COL.magenta : ev.time ? COL.violet : ev.jump ? COL.cyan : COL.ice;
      this.ring(p.x, p.y, col, a.c * (ev.cap ? 3.2 : 2.2), ev.cap ? 0.75 : 0.55, ev.cap ? 6 : 4); if (ev.cap || ev.time) this.ring(p.x, p.y, COL.white, a.c * 1.6, 0.4, 3);
      this.burst(p.x, p.y, col, ev.cap ? 46 : 22, ev.cap ? 150 : 90, ev.cap ? 4 : 3, ev.cap ? 1.0 : 0.7);
      this.doShake(ev.cap ? 7 + Math.abs(ev.cap) : ev.time ? 5 : 2.5); if (ev.cap) this.doFlash(COL.amber, 0.14);
      if (ev.branch != null) { const o = this.S.tl[ev.branch] && this.S.tl[ev.branch].origin; if (o) this.beams.push({ l0: o[0], t0: o[1], l1: ev.branch, t1: this.S.tl[ev.branch].t0, born: this.now }); this.doFlash(COL.magenta, 0.32); this.doShake(9); }
      if (this.onLand) this.onLand(ev);
    }
  }
  View.prototype.beams = null;

  // ------------------------------------------------------------------ boucle
  View.prototype.tick = function (ts) {
    if (!this.alive) return; requestAnimationFrame(this.tick);
    const n0 = this.now; this.now = (ts - this.t0) / 1000; this.dt = clamp(this.now - n0, 0.001, 0.12); if (!this.S || document.hidden || !this.cv.isConnected || !this.W || !this.cv.getClientRects().length) return;                       // onglet / sous-écran caché : aucun dessin
    const busy = this.anims.length || this.parts.length || this.rings.length || this.flash.a > 0 || this.demo || true;                       // décor animé en permanence (fils, étoiles, présent)
    // caméra : ressort amorti vers la cible
    const k = 1 - Math.exp(-5.5 * this.dt), c = this.cam, t = this.camT; if (!this.free) { c.x += (t.x - c.x) * k; c.y += (t.y - c.y) * k; c.z += (t.z - c.z) * k; }
    if (!this.beams) this.beams = [];
    const act = this.anims.length || this.parts.length || this.rings.length || this.beams.length || this.now - this.flash.t0 < 0.6 || this.now - this.streak.t0 < 0.8 || this.ptrs.size || this.dirty;
    if (!act && this.now - (this.lastDraw || 0) < (this.reduce ? 0.14 : 0.034)) return;                       // au repos : 30 images/s (batterie)
    this.lastDraw = this.now; this.dirty = false; this.update(); if (busy) this.draw();
  };
  View.prototype.update = function () {
    const now = this.now, dt = this.dt || 0.016;
    for (const a of this.anims) {
      const u = (now - a.t0) / a.dur;
      if (u >= 1 && !a.over) { a.over = true; this.landed(a); if (a.done) setTimeout(a.done, 60); }
      else if (u < 1 && u > 0) { const p = this.flyPos(a, u), n = a.ev.time ? 4 : 2, col = a.ev.cap ? COL.amber : a.ev.time ? COL.violet : COL.cyan; for (let i = 0; i < n; i++) this.parts.push({ x: p.x + (Math.random() - 0.5) * 6, y: p.y + (Math.random() - 0.5) * 6, vx: (Math.random() - 0.5) * 24, vy: (Math.random() - 0.5) * 24, age: 0, life: 0.5, col, size: 2.6, g: 0 }); }
    }
    this.anims = this.anims.filter((a) => !a.over || now - a.t0 < a.dur + 0.05);
    for (const p of this.parts) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985; p.vy *= 0.985; }
    this.parts = this.parts.filter((p) => p.age < p.life); if (this.parts.length > 900) this.parts.splice(0, this.parts.length - 900);
    this.rings = this.rings.filter((r) => now - r.t0 < r.dur);
    this.beams = this.beams.filter((b) => now - b.born < 3.2);
  };
  View.prototype.flyPos = function (a, u) {
    const e = ease.io3(u), x = lerp(a.from.x, a.to.x, e), y = lerp(a.from.y, a.to.y, e), arc = Math.min(a.dist * 0.18, 140) * Math.sin(e * Math.PI) * (a.dist > a.c * 2 ? 1 : 0.35) + (a.kn ? Math.sin(e * Math.PI) * a.c * 0.6 : 0);
    return { x, y: y - arc, e, lift: Math.sin(e * Math.PI) };
  };

  // ------------------------------------------------------------------ dessin
  View.prototype.tileSpr = function (W, H, dark) {
    const key = W + "x" + H + (dark ? "d" : ""); if (this.tiles[key]) return this.tiles[key];
    const N = 420, c = mkc(N, N), g = c.getContext("2d"), cs = N / Math.max(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const li = (x + y) % 2 === 1, X = x * cs, Y = (H - 1 - y) * cs, gr = g.createLinearGradient(X, Y, X + cs, Y + cs);
      if (li) { gr.addColorStop(0, dark ? "#aab6cf" : "#eef3fb"); gr.addColorStop(1, dark ? "#8f9db9" : "#cdd8ea"); } else { gr.addColorStop(0, dark ? "#1d2742" : "#33426b"); gr.addColorStop(1, dark ? "#121a30" : "#222d4d"); }
      g.fillStyle = gr; g.fillRect(X, Y, cs + 1, cs + 1);
    }
    g.globalAlpha = 0.18; const sh = g.createLinearGradient(0, 0, N, N); sh.addColorStop(0, "#fff"); sh.addColorStop(0.5, "#fff0"); sh.addColorStop(1, "#0008"); g.fillStyle = sh; g.globalAlpha = 0.35; g.fillRect(0, 0, N, N);
    return (this.tiles[key] = c);
  };
  View.prototype.background = function (ctx, t) {
    const { W, H } = this, g = ctx.createRadialGradient(W * 0.5, H * 0.42, 20, W * 0.5, H * 0.5, Math.max(W, H) * 0.8); g.addColorStop(0, "#161d3a"); g.addColorStop(0.55, "#0a0f22"); g.addColorStop(1, "#04060f"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // nébuleuses lentes
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < (this.reduce ? 1 : 3); i++) { const a = t * 0.05 + i * 2.1, x = W * (0.5 + 0.45 * Math.cos(a + i)) - this.cam.x * 0.02 * this.cam.z, y = H * (0.5 + 0.35 * Math.sin(a * 1.3)) - this.cam.y * 0.02 * this.cam.z, r = Math.max(W, H) * (0.5 + 0.1 * i), gr = ctx.createRadialGradient(x, y, 0, x, y, r); const cc = [COL.violet, COL.cyan, COL.magenta][i]; gr.addColorStop(0, rgb(cc, 0.11)); gr.addColorStop(1, rgb(cc, 0)); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
    // étoiles (parallaxe)
    if (!this.stars) { const R = rnd(7); this.stars = Array.from({ length: 170 }, () => ({ x: R(), y: R(), z: 0.2 + R() * 0.8, s: 0.6 + R() * 1.6, p: R() * TAU })); }
    for (const s of this.stars) {
      const px = ((s.x * W * 1.6 - this.cam.x * this.cam.z * 0.06 * s.z - t * 3 * s.z) % (W * 1.6) + W * 1.6) % (W * 1.6) - W * 0.3, py = ((s.y * H * 1.6 - this.cam.y * this.cam.z * 0.06 * s.z) % (H * 1.6) + H * 1.6) % (H * 1.6) - H * 0.3;
      ctx.globalAlpha = 0.25 + 0.5 * s.z * (0.6 + 0.4 * Math.sin(t * 1.5 + s.p)); ctx.fillStyle = "#cfe0ff"; ctx.fillRect(px, py, s.s, s.s);
    }
    ctx.globalAlpha = 1;
  };
  View.prototype.draw = function () {
    const S = this.S, ctx = this.ctx, gc = this.gctx, dpr = this.dpr, now = this.now, W = this.W, H = this.H;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; this.background(ctx, now);
    gc.setTransform(1, 0, 0, 1, 0, 0); gc.clearRect(0, 0, this.glow.width, this.glow.height);
    const sh = this.shake, su = now - sh.t0, sa = su < 0.45 ? sh.a * Math.exp(-su * 7) : 0, sx = Math.sin(now * 90) * sa, sy = Math.cos(now * 77) * sa, z = this.cam.z;
    const T = (c, k) => c.setTransform(dpr * k * z, 0, 0, dpr * k * z, dpr * (W / 2 - this.cam.x * z + sx), dpr * (H / 2 - this.cam.y * z + sy));
    this.T = T;
    const vis = (l, t) => { const p = this.pos(l, t), s = this.w2s(p.x, p.y), r = BS * z * 0.75; return s.x > -r && s.x < W + r && s.y > -r && s.y < H + r; };
    T(ctx, 1); T(gc, 0.25);
    this.drawThreads(ctx, gc, vis); this.drawPresent(ctx, gc);
    const pres = FD.present(S), cur = S.turn, mv = this.mine ? new Set(FD.movable(S, cur).map((l) => l)) : new Set();
    const order = []; for (const l of Object.keys(S.tl)) { const d = S.tl[l]; for (let i = 0; i < d.list.length; i++) { const t = d.t0 + i; if (vis(+l, t)) order.push({ l: +l, t, b: d.list[i], last: i === d.list.length - 1 }); } }
    order.sort((a, b) => (a.last === b.last ? 0 : a.last ? 1 : -1));                                                      // les plateaux jouables par-dessus
    for (const o of order) this.drawBoard(ctx, gc, o, pres, mv);
    this.drawBeams(ctx, gc); this.drawTargets(ctx, gc); this.drawThreats(ctx, gc); this.drawFx(ctx, gc); this.drawFly(ctx, gc);
    // composition : bloom
    ctx.setTransform(1, 0, 0, 1, 0, 0); this.g2.setTransform(1, 0, 0, 1, 0, 0); this.g2.clearRect(0, 0, this.glow2.width, this.glow2.height); this.g2.drawImage(this.glow, 0, 0, this.glow2.width, this.glow2.height);
    ctx.globalCompositeOperation = "lighter"; ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 0.95; ctx.drawImage(this.glow, 0, 0, this.cv.width, this.cv.height); ctx.globalAlpha = 0.85; ctx.drawImage(this.glow2, 0, 0, this.cv.width, this.cv.height); ctx.drawImage(this.glow2, 0, 0, this.cv.width, this.cv.height);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawScreen(ctx);
  };
  View.prototype.drawScreen = function (ctx) {
    const { W, H } = this, now = this.now, fu = now - this.flash.t0;
    if (fu < 0.5) { ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = this.flash.a * Math.pow(1 - fu / 0.5, 2); ctx.fillStyle = rgb(this.flash.col); ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; }
    const su = now - this.streak.t0;
    if (su < 0.7) {                                                                                                         // lignes de vitesse : voyage dans le temps
      const R = rnd(this.streak.seed), k = su / 0.7; ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.translate(W / 2, H / 2); ctx.lineCap = "round";
      for (let i = 0; i < 90; i++) { const a = R() * TAU, r0 = (0.1 + R() * 0.5) * Math.min(W, H) * (0.3 + 1.4 * ease.out3(k)), len = (0.15 + R() * 0.5) * Math.min(W, H) * (1 - k * 0.5); ctx.strokeStyle = rgb(i % 3 ? COL.violet : COL.cyan, (1 - k) * (0.12 + R() * 0.4)); ctx.lineWidth = 1 + R() * 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * (r0 + len), Math.sin(a) * (r0 + len)); ctx.stroke(); }
      ctx.restore();
    }
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75); g.addColorStop(0, "#0000"); g.addColorStop(1, "#000c"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  };

  // fils entre plateaux, branches
  View.prototype.drawThreads = function (ctx, gc, vis) {
    const S = this.S, now = this.now;
    for (const l of Object.keys(S.tl)) {
      const d = S.tl[l], act = FD.isActive(S, +l);
      for (let i = 0; i + 1 < d.list.length; i++) {
        const t = d.t0 + i; if (!vis(+l, t) && !vis(+l, t + 1)) continue;
        const a = this.pos(+l, t), b = this.pos(+l, t + 1), x0 = a.x + BS / 2, x1 = b.x - BS / 2, y = a.y;
        const col = act ? COL.cyan : COL.ice;
        ctx.strokeStyle = rgb(col, act ? 0.5 : 0.2); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        gc.strokeStyle = rgb(col, act ? 0.55 : 0.15); gc.lineWidth = 9; gc.beginPath(); gc.moveTo(x0, y); gc.lineTo(x1, y); gc.stroke();
        const k = (now * 0.6 + i * 0.37) % 1, px = lerp(x0, x1, k); ctx.fillStyle = rgb(COL.white, act ? 0.9 : 0.3); ctx.beginPath(); ctx.arc(px, y, 4.5, 0, TAU); ctx.fill(); gc.fillStyle = rgb(col, 0.9); gc.beginPath(); gc.arc(px, y, 12, 0, TAU); gc.fill();
      }
      if (d.origin) {
        const o = this.pos(d.origin[0], d.origin[1]), n = this.pos(+l, d.t0), up = +l > d.origin[0], col = d.by === "w" ? COL.gold : COL.violet;
        const sx = o.x, sy = o.y + (up ? -BS / 2 : BS / 2), ex = n.x - BS / 2, ey = n.y, cx1 = sx, cy1 = (sy + ey) / 2 + (up ? -60 : 60) * 0;
        ctx.strokeStyle = rgb(col, 0.55); ctx.lineWidth = 3; ctx.setLineDash([14, 10]); ctx.lineDashOffset = -now * 40; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.bezierCurveTo(cx1, ey, sx + 40, ey, ex, ey); ctx.stroke(); ctx.setLineDash([]);
        gc.strokeStyle = rgb(col, 0.5); gc.lineWidth = 10; gc.beginPath(); gc.moveTo(sx, sy); gc.bezierCurveTo(cx1, ey, sx + 40, ey, ex, ey); gc.stroke();
      }
    }
  };
  View.prototype.drawPresent = function (ctx, gc) {
    const S = this.S, now = this.now, p = FD.present(S), ls = Object.keys(S.tl).map(Number), y0 = -Math.max(...ls) * GY - BS / 2 - 90, y1 = -Math.min(...ls) * GY + BS / 2 + 90, x = p * GX - BS / 2 - (GX - BS) / 2, col = FD.colorAt(p) === "w" ? COL.gold : COL.violet;
    const gr = ctx.createLinearGradient(x, y0, x, y1); gr.addColorStop(0, rgb(col, 0)); gr.addColorStop(0.15, rgb(col, 0.95)); gr.addColorStop(0.85, rgb(col, 0.95)); gr.addColorStop(1, rgb(col, 0));
    ctx.fillStyle = gr; ctx.fillRect(x - 2.5, y0, 5, y1 - y0); const w = (now * 0.5) % 1; ctx.fillStyle = rgb(COL.white, 0.9); ctx.fillRect(x - 3.5, lerp(y0, y1, w) - 30, 7, 60);
    const g2 = gc.createLinearGradient(x, y0, x, y1); g2.addColorStop(0, rgb(col, 0)); g2.addColorStop(0.2, rgb(col, 1)); g2.addColorStop(0.8, rgb(col, 1)); g2.addColorStop(1, rgb(col, 0)); gc.fillStyle = g2; gc.fillRect(x - 12, y0, 24, y1 - y0);
    ctx.save(); ctx.translate(x - 14, y0 + 30); ctx.rotate(-Math.PI / 2); ctx.font = "800 24px system-ui, sans-serif"; ctx.textAlign = "right"; ctx.fillStyle = rgb(col, 0.95); ctx.fillText("PRÉSENT", 0, 0); ctx.restore();
    const gl = (this.glowText ||= {}); void gl;
  };

  View.prototype.drawBoard = function (ctx, gc, o, pres, mv) {
    const S = this.S, now = this.now, { l, t, b, last } = o, p = this.pos(l, t), W = S.W, H = S.H, cs = this.cellSize(), key = l + "|" + t;
    const ap = this.appear[key] == null ? 1 : clamp((now - this.appear[key]) / 0.55, 0, 1); if (ap <= 0) return;
    const sc = this.appear[key] == null ? 1 : 0.86 + 0.14 * ease.back(ap), act = FD.isActive(S, l), parity = FD.colorAt(t), playable = last && mv.has(l) && t === pres && act;
    const past = !last, a = ap * (act ? (past ? 0.62 : 1) : 0.28), z = this.cam.z, px = BS * z;
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(sc, sc); ctx.globalAlpha = a;
    // halo / ombre
    if (last && act) { const gr = ctx.createRadialGradient(0, 0, BS * 0.35, 0, 0, BS * 0.95); const col = playable ? COL.cyan : parity === "w" ? COL.gold : COL.violet; gr.addColorStop(0, rgb(col, playable ? 0.28 : 0.12)); gr.addColorStop(1, rgb(col, 0)); ctx.fillStyle = gr; ctx.fillRect(-BS, -BS, BS * 2, BS * 2); }
    ctx.drawImage(this.tileSpr(W, H, parity === "b"), -BS / 2, -BS / 2, BS, BS);
    if (parity === "b") { ctx.fillStyle = "rgba(10,12,40,.28)"; ctx.fillRect(-BS / 2, -BS / 2, BS, BS); }
    // cases clés : sélection, dernier coup
    if (this.sel && this.sel.l === l && this.sel.t === t) { const q = this.cellOff(this.sel.x, this.sel.y); ctx.fillStyle = rgb(COL.cyan, 0.38); ctx.fillRect(q.x, q.y, cs, cs); }
    if (this.hint && this.hint.l === l && this.hint.t === t) { const q = this.cellOff(this.hint.x, this.hint.y), k = 0.5 + 0.5 * Math.sin(now * 5); ctx.strokeStyle = rgb(COL.gold, 0.6 + 0.4 * k); ctx.lineWidth = 4; ctx.strokeRect(q.x + 2, q.y + 2, cs - 4, cs - 4); gc.save(); }
    if (this.hint && this.hint.l === l && this.hint.t === t) gc.restore();
    // pièces
    const small = px < 70;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = b[y * W + x]; if (!v) continue; if (this.hide[`${l}|${t}|${x}|${y}`]) continue;
      const code = (v > 0 ? "w" : "b") + "pnbrqk"[Math.abs(v) - 1], q = this.cellOff(x, y), cx = q.x + cs / 2, cy = q.y + cs / 2;
      if (small) { ctx.fillStyle = v > 0 ? "#f4f7ff" : "#06080f"; ctx.beginPath(); ctx.arc(cx, cy, cs * 0.3, 0, TAU); ctx.fill(); ctx.strokeStyle = v > 0 ? "#79a" : "#8ad"; ctx.lineWidth = 2; ctx.stroke(); continue; }
      const im = this.pc[code]; if (!im) continue; const mineP = playable && (v > 0) === (this.human === "w") && (v > 0) === (S.turn === "w");
      ctx.globalAlpha = a * 0.28; ctx.fillStyle = "#000"; ctx.beginPath(); ctx.ellipse(cx, cy + cs * 0.34, cs * 0.3, cs * 0.075, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = a;
      const isSel = this.sel && this.sel.l === l && this.sel.t === t && this.sel.x === x && this.sel.y === y, bob = isSel ? Math.sin(now * 6) * cs * 0.04 - cs * 0.06 : 0, sz = cs * (isSel ? 1.16 : 1.02);
      if (this.sil[code] && (v < 0 || mineP || isSel)) { ctx.globalAlpha = a * (isSel ? 0.9 : v < 0 ? 0.28 : 0.2); ctx.globalCompositeOperation = "lighter"; ctx.drawImage(this.sil[code], cx - sz * 0.56, cy - sz * 0.56 + bob, sz * 1.12, sz * 1.12); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = a; }
      ctx.drawImage(im, cx - sz / 2, cy - sz / 2 + bob, sz, sz);
      if (isSel || (mineP && this.pulse)) { gc.save(); gc.translate(p.x * 0.25 * 0 + 0, 0); gc.restore(); }
    }
    ctx.globalAlpha = a;
    // cadre
    const fcol = playable ? COL.cyan : !act ? COL.ice : last ? (parity === "w" ? COL.gold : COL.violet) : COL.ice, fa = playable ? 0.75 + 0.25 * Math.sin(now * 4) : last ? 0.75 : 0.35;
    ctx.strokeStyle = rgb(fcol, fa); ctx.lineWidth = playable ? 5 : 3; ctx.strokeRect(-BS / 2, -BS / 2, BS, BS);
    ctx.fillStyle = rgb(fcol, 0.9); ctx.fillRect(-BS / 2 - 1, -BS / 2 - 1, 22, 4); ctx.fillRect(-BS / 2 - 1, -BS / 2 - 1, 4, 22); ctx.fillRect(BS / 2 - 21, BS / 2 - 3, 22, 4); ctx.fillRect(BS / 2 - 3, BS / 2 - 21, 4, 22);
    if (last || playable) { gc.save(); gc.translate(0, 0); }
    // étiquette
    if (px > 45) { ctx.font = "800 22px system-ui, sans-serif"; ctx.textAlign = "left"; ctx.fillStyle = rgb(COL.ice, 0.9); ctx.fillText("T" + (Math.floor(t / 2) + 1), -BS / 2, -BS / 2 - 12); ctx.fillStyle = parity === "w" ? "#fff" : "#10131f"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(BS / 2 - 11, -BS / 2 - 20, 8, 0, TAU); ctx.fill(); ctx.stroke(); }
    if (px > 45 && (t === S.tl[l].t0 || t === S.tl[l].t0 + 0)) { ctx.font = "900 30px ui-monospace, Menlo, Consolas, monospace"; ctx.textAlign = "right"; ctx.fillStyle = rgb(l === 0 ? COL.ice : l > 0 ? COL.gold : COL.violet, 0.95); ctx.fillText("L" + (l > 0 ? "+" + l : l), -BS / 2 - 16, 10); }
    ctx.restore(); if (last || playable) gc.restore();
    if (playable || (last && act)) { const g = this.gctx; g.save(); this.T(g, 0.25); g.translate(p.x, p.y); g.scale(sc, sc); g.strokeStyle = rgb(playable ? COL.cyan : parity === "w" ? COL.gold : COL.violet, playable ? 0.9 : 0.35); g.lineWidth = playable ? 12 : 8; g.strokeRect(-BS / 2, -BS / 2, BS, BS); g.restore(); }
  };
  View.prototype.cellOff = function (x, y) { const cs = this.cellSize(); return { x: -BS / 2 + x * cs, y: BS / 2 - (y + 1) * cs }; };

  // cibles d'un coup
  View.prototype.drawTargets = function (ctx, gc) {
    if (!this.sel || !this.targets.length) return; const now = this.now, cs = this.cellSize(), s = this.cellPos(this.sel.l, this.sel.t, this.sel.x, this.sel.y), z = this.cam.z, minR = 10 / z;
    const jumps = this.targets.filter((c) => c.jump).length;
    for (let i = 0; i < this.targets.length; i++) {
      const c = this.targets[i], p = this.cellPos(c.l, c.t, c.x, c.y), k = 0.5 + 0.5 * Math.sin(now * 5 + i * 0.7), col = c.branch ? COL.magenta : c.cap ? COL.amber : c.jump ? COL.violet : COL.cyan;
      if (c.jump && jumps <= 36) {                                                                                       // arc lumineux jusqu'à l'autre plateau
        const mx = (s.x + p.x) / 2, my = (s.y + p.y) / 2 - Math.min(160, Math.hypot(p.x - s.x, p.y - s.y) * 0.25);
        ctx.strokeStyle = rgb(col, 0.55); ctx.lineWidth = 2.5; ctx.setLineDash([10, 9]); ctx.lineDashOffset = -now * 60; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.quadraticCurveTo(mx, my, p.x, p.y); ctx.stroke(); ctx.setLineDash([]);
        gc.strokeStyle = rgb(col, 0.5); gc.lineWidth = 8; gc.beginPath(); gc.moveTo(s.x, s.y); gc.quadraticCurveTo(mx, my, p.x, p.y); gc.stroke();
      }
      const r = Math.max(cs * (c.cap ? 0.42 : 0.2), minR) * (1 + 0.12 * k);
      ctx.fillStyle = rgb(col, c.cap ? 0.22 : 0.9); ctx.strokeStyle = rgb(col, 0.95); ctx.lineWidth = Math.max(3, 2.2 / z * 0.8);
      ctx.beginPath(); if (c.jump && !c.cap) { ctx.moveTo(p.x, p.y - r * 1.15); ctx.lineTo(p.x + r * 1.15, p.y); ctx.lineTo(p.x, p.y + r * 1.15); ctx.lineTo(p.x - r * 1.15, p.y); ctx.closePath(); } else ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill(); if (c.cap || c.branch || c.promo) ctx.stroke();
      if (c.branch) { ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.7, now * 3 + i, now * 3 + i + 4.2); ctx.stroke(); }
      gc.fillStyle = rgb(col, 0.95); gc.beginPath(); gc.arc(p.x, p.y, r * 2.2, 0, TAU); gc.fill();
    }
  };
  View.prototype.drawThreats = function (ctx, gc) {
    if (!this.threats || !this.threats.length) return; const now = this.now;
    for (const th of this.threats) {
      const a = this.cellPos(th.from.l, th.from.t, th.from.x, th.from.y), b = this.cellPos(th.to.l, th.to.t, th.to.x, th.to.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - Math.min(150, Math.hypot(b.x - a.x, b.y - a.y) * 0.28), k = 0.5 + 0.5 * Math.sin(now * 7);
      ctx.strokeStyle = rgb(COL.red, 0.85); ctx.lineWidth = 4.5; ctx.setLineDash([16, 9]); ctx.lineDashOffset = -now * 90; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx, my, b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      gc.strokeStyle = rgb(COL.red, 0.9); gc.lineWidth = 12; gc.beginPath(); gc.moveTo(a.x, a.y); gc.quadraticCurveTo(mx, my, b.x, b.y); gc.stroke();
      for (const p of [a, b]) { ctx.strokeStyle = rgb(COL.red, 0.9); ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(p.x, p.y, this.cellSize() * (0.55 + 0.1 * k), 0, TAU); ctx.stroke(); gc.fillStyle = rgb(COL.red, 0.55 + 0.4 * k); gc.beginPath(); gc.arc(p.x, p.y, this.cellSize() * 1.2, 0, TAU); gc.fill(); }
    }
  };
  View.prototype.drawBeams = function (ctx, gc) {
    for (const bm of this.beams) {
      const k = (this.now - bm.born) / 3.2, e = ease.out5(clamp(k * 3, 0, 1)), a = this.pos(bm.l0, bm.t0), b = this.pos(bm.l1, bm.t1), x = lerp(a.x, b.x, e), y = lerp(a.y, b.y, e), fade = 1 - clamp((k - 0.5) / 0.5, 0, 1);
      ctx.strokeStyle = rgb(COL.magenta, 0.9 * fade); ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(x, y); ctx.stroke(); gc.strokeStyle = rgb(COL.magenta, fade); gc.lineWidth = 28; gc.beginPath(); gc.moveTo(a.x, a.y); gc.lineTo(x, y); gc.stroke();
    }
  };
  View.prototype.drawFx = function (ctx, gc) {
    const now = this.now;
    for (const r of this.rings) { const k = (now - r.t0) / r.dur, rr = r.r1 * ease.out3(k); ctx.strokeStyle = rgb(r.col, 1 - k); ctx.lineWidth = r.w * (1 - k * 0.6); ctx.beginPath(); ctx.arc(r.x, r.y, rr, 0, TAU); ctx.stroke(); gc.strokeStyle = rgb(r.col, 1 - k); gc.lineWidth = r.w * 3 * (1 - k); gc.beginPath(); gc.arc(r.x, r.y, rr, 0, TAU); gc.stroke(); }
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.parts) { const k = p.age / p.life; ctx.fillStyle = rgb(p.col, 1 - k); ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - k * 0.6), 0, TAU); ctx.fill(); gc.fillStyle = rgb(p.col, (1 - k) * 0.8); gc.beginPath(); gc.arc(p.x, p.y, p.size * 3 * (1 - k * 0.5), 0, TAU); gc.fill(); }
    ctx.globalCompositeOperation = "source-over";
  };
  View.prototype.drawFly = function (ctx, gc) {
    for (const a of this.anims) {
      const u = (this.now - a.t0) / a.dur; if (u < 0 || u >= 1) continue; const p = this.flyPos(a, u), im = this.pc[a.code]; if (!im) continue;
      const sz = a.c * (1.08 + 0.55 * p.lift), rot = a.spin ? ease.io3(u) * TAU * 1 : 0, col = a.ev.cap ? COL.amber : a.ev.branch != null ? COL.magenta : a.ev.time ? COL.violet : COL.cyan;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(rot); ctx.globalAlpha = 0.35 * p.lift; ctx.fillStyle = "#000"; ctx.restore();
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(rot); if (this.sil[a.code]) { ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.85; ctx.drawImage(this.sil[a.code], -sz * 0.7, -sz * 0.7, sz * 1.4, sz * 1.4); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; } ctx.drawImage(im, -sz / 2, -sz / 2, sz, sz); ctx.restore();
      gc.fillStyle = rgb(col, 0.9); gc.beginPath(); gc.arc(p.x, p.y, sz * 1.1, 0, TAU); gc.fill();
    }
  };

  // ------------------------------------------------------------------ interrogation
  /** touche écran -> {l,t,x,y} d'un plateau (cases d'un plateau visible) ou null ; `target` si un marqueur de cible est assez proche */
  View.prototype.hit = function (px, py) {
    if (!this.S) return null; const w = this.s2w(px, py), cs = this.cellSize(), z = this.cam.z; let cellHit = null;
    for (const l of Object.keys(this.S.tl)) {
      const d = this.S.tl[l], p0 = this.pos(+l, d.t0), ty = p0.y; if (Math.abs(w.y - ty) > BS / 2) continue;
      const t = Math.round(w.x / GX); if (t < d.t0 || t > d.t0 + d.list.length - 1) continue; const p = this.pos(+l, t); if (Math.abs(w.x - p.x) > BS / 2) continue;
      const x = Math.floor((w.x - (p.x - BS / 2)) / cs), y = Math.floor((p.y + BS / 2 - w.y) / cs); if (x < 0 || y < 0 || x >= this.S.W || y >= this.S.H) continue;
      cellHit = { kind: "cell", l: +l, t, x, y }; break;
    }
    if (this.sel && this.targets.length) {
      if (cellHit) { const ex = this.targets.find((c) => c.l === cellHit.l && c.t === cellHit.t && c.x === cellHit.x && c.y === cellHit.y); if (ex) return { kind: "target", c: ex }; }
      const occ = cellHit && this.S.tl[cellHit.l].list[cellHit.t - this.S.tl[cellHit.l].t0][cellHit.y * this.S.W + cellHit.x];
      if (occ) return cellHit;                                                                                       // un toucher exact sur une pièce choisit la pièce (pas le marqueur voisin)
      let best = null, bd = 1e9; for (const c of this.targets) { const q = this.cellPos(c.l, c.t, c.x, c.y), d = Math.hypot(q.x - w.x, q.y - w.y) * z; if (d < bd) { bd = d; best = c; } }
      if (best && bd < Math.max(26, cs * z * 0.55)) return { kind: "target", c: best };                              // marqueurs de cible : tolérance 26 px écran
    }
    return cellHit;
  };
  V.View = View; V.BS = BS; V.GX = GX; V.GY = GY;
})();
