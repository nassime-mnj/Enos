"use strict";
// MODULE « Chess Fog » : échecs avec brouillard de guerre. Règles + adversaire honnête : js/fog.js. Ici : rendu du brouillard, partie contre ETO, JOUEUR CONTRE JOUEUR sur le même téléphone (écran de passage), règles.
(() => {
  const E = window.ENOS, FG = E.fog, esc = E.esc, $c = (t) => document.createElement(t);
  const SAVE = "fog.save", PREF = "fog.prefs", FOG = FG.FOG, NAMES = ["", "pion", "cavalier", "fou", "tour", "dame", "roi"], TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const P3 = (() => { try { return !!(CSS.supports("color", "color(display-p3 1 0 0)") && matchMedia("(color-gamut: p3)").matches); } catch (e) { return false; } })();
  const rgb = (c, a) => (P3 ? `color(display-p3 ${c[0]} ${c[1]} ${c[2]} / ${a == null ? 1 : a})` : `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a == null ? 1 : a})`);
  const C = { cyan: [0.1, 1, 0.95], amber: [1, 0.72, 0.14], red: [1, 0.2, 0.3], green: [0.3, 1, 0.6], ice: [0.8, 0.95, 1] };
  const vib = (p) => { try { if (E.settings.get("fog.haptic", true) !== false && navigator.vibrate) navigator.vibrate(p); } catch (e) { /* rien */ } };
  const snd = (k) => { try { if (E.settings.get("fog.sound", true) !== false && E.chessSound) E.chessSound.play(k); } catch (e) { /* rien */ } };

  // ------------------------------------------------------------------ le plateau dans le brouillard (canvas)
  class FogView {
    constructor(canvas, o) {
      o = o || {}; this.cv = canvas; this.ctx = canvas.getContext("2d"); this.flip = false; this.view = null; this.sel = -1; this.targets = []; this.visA = new Float32Array(64); this.alive = true; this.demo = !!o.demo;
      this.pc = {}; this.anims = []; this.parts = []; this.rings = []; this.hide = {}; this.t0 = performance.now(); this.now = 0; this.onTap = null; this.reveal = 0; this.truth = null; this.spot = {}; this.lastEnemy = null; this.lastMine = null;
      this.fogC = document.createElement("canvas"); this.maskC = document.createElement("canvas"); this.maskC.width = this.maskC.height = 8; this.noise = this.mkNoise();
      this.resize(); this.assets = this.load(); this.tick = this.tick.bind(this); requestAnimationFrame(this.tick);
      this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(canvas.parentElement);
      canvas.addEventListener("pointerup", (e) => { if (this.onTap && !this.demo) { const s = this.hit(e.offsetX, e.offsetY); if (s >= 0) this.onTap(s); } });
    }
    mkNoise() { const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d"), d = g.createImageData(128, 128); let s = 7; for (let i = 0; i < d.data.length; i += 4) { s = (s * 1664525 + 1013904223) >>> 0; const v = 150 + (s >>> 24) % 90; d.data[i] = v; d.data[i + 1] = v + 20; d.data[i + 2] = v + 30; d.data[i + 3] = 40 + ((s >>> 16) & 31); } g.putImageData(d, 0, 0); return c; }
    async load() {
      const A = E.assetBase || ""; await Promise.all(["w", "b"].flatMap((c) => ["p", "n", "b", "r", "q", "k"].map((k) => new Promise((res) => { const key = "img/chess/" + c + k + ".png", i = new Image(), emb = (window.ENOS_IMG || {})[key]; i.onload = () => { this.pc[c + k] = i; res(); }; i.onerror = () => res(); i.src = emb || A + key; }))));
    }
    resize() {
      const p = this.cv.parentElement, dpr = Math.min(window.devicePixelRatio || 1, 2.5), s = Math.max(120, Math.round(Math.min(p.clientWidth, p.clientHeight)));                    // clientWidth : insensible à l'animation d'entrée (transform: scale)
      if (s === this.S && dpr === this.dpr) return; this.S = s; this.dpr = dpr; this.cv.width = Math.round(s * dpr); this.cv.height = Math.round(s * dpr); this.cv.style.width = s + "px"; this.cv.style.height = s + "px"; this.fogC.width = this.fogC.height = Math.round(s * dpr);
    }
    destroy() { this.alive = false; if (this._ro) this._ro.disconnect(); }
    // case <-> écran
    pos(i) { const x = i & 7, y = i >> 3, c = this.flip ? 7 - x : x, r = this.flip ? y : 7 - y, cs = this.S / 8; return { x: c * cs, y: r * cs, cs }; }
    hit(px, py) { const cs = this.S / 8, c = Math.floor(px / cs), r = Math.floor(py / cs); if (c < 0 || r < 0 || c > 7 || r > 7) return -1; const x = this.flip ? 7 - c : c, y = this.flip ? r : 7 - r; return y * 8 + x; }
    setView(v, o) { o = o || {}; this.view = v; if (o.reset) this.visA.fill(0); this.dirty = true; }
    burst(i, col, n, spd) { const p = this.pos(i); for (let k = 0; k < n; k++) { const a = Math.random() * TAU, v = (0.4 + Math.random()) * spd; this.parts.push({ x: p.x + p.cs / 2, y: p.y + p.cs / 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: 0.5 + Math.random() * 0.5, col, size: 2 + Math.random() * 3 }); } }
    ring(i, col) { const p = this.pos(i); this.rings.push({ x: p.x + p.cs / 2, y: p.y + p.cs / 2, col, t0: this.now }); }
    slide(from, to, code, done) { this.hide[to] = true; this.anims.push({ from, to, code, t0: this.now, dur: 0.3, done }); }
    tick(ts) {
      if (!this.alive) return; requestAnimationFrame(this.tick); const n0 = this.now; this.now = (ts - this.t0) / 1000; this.dt = clamp(this.now - n0, 0.001, 0.1);
      if (!this.view || !this.cv.isConnected || document.hidden || !this.cv.getClientRects().length) return; this.draw();
    }
    visTarget() { const t = new Float32Array(64); if (this.reveal > 0) { for (let i = 0; i < 64; i++) t[i] = 1; return t; } for (let i = 0; i < 64; i++) t[i] = this.view.cells[i] !== FOG ? 1 : 0; return t; }
    draw() {
      const ctx = this.ctx, d = this.dpr, S = this.S, cs = S / 8, now = this.now, view = this.view, tgt = this.visTarget(), k = 1 - Math.exp(-7 * this.dt);
      for (let i = 0; i < 64; i++) this.visA[i] += (tgt[i] - this.visA[i]) * k;
      ctx.setTransform(d, 0, 0, d, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = "#070b12"; ctx.fillRect(0, 0, S, S);
      const cells = this.reveal > 0 && this.truth ? this.truth : view.cells;
      for (let i = 0; i < 64; i++) {                                                                                      // cases
        const p = this.pos(i), x = i & 7, y = i >> 3, light = (x + y) % 2 === 1; const g = ctx.createLinearGradient(p.x, p.y, p.x + cs, p.y + cs);
        g.addColorStop(0, light ? "#e9f0f7" : "#35506b"); g.addColorStop(1, light ? "#c6d4e2" : "#243a52"); ctx.fillStyle = g; ctx.fillRect(p.x, p.y, cs + 0.6, cs + 0.6);
        if (this.visA[i] > 0.5 && !this.reveal) { ctx.fillStyle = rgb(C.cyan, 0.05); ctx.fillRect(p.x, p.y, cs, cs); }
      }
      const hl = (i, col, a) => { if (i < 0) return; const p = this.pos(i); ctx.fillStyle = rgb(col, a); ctx.fillRect(p.x, p.y, cs, cs); };
      if (this.lastMine) { hl(this.lastMine.f, C.green, 0.22); hl(this.lastMine.t, C.green, 0.3); }
      if (this.lastEnemy) { if (this.lastEnemy.f >= 0 && this.visA[this.lastEnemy.f] > 0.5) hl(this.lastEnemy.f, C.amber, 0.2); if (this.lastEnemy.t >= 0) hl(this.lastEnemy.t, C.amber, 0.34); }
      if (this.sel >= 0) hl(this.sel, C.cyan, 0.42);
      // pièces (visibles seulement : les cases cachées ne sont JAMAIS dessinées, le brouillard n'est qu'un décor)
      for (let i = 0; i < 64; i++) {
        const v = cells[i]; if (!v || v === FOG || this.hide[i]) continue; const a = this.reveal > 0 ? 1 : clamp(this.visA[i] * 1.3, 0, 1); if (a < 0.03) continue;
        const code = (v > 0 ? "w" : "b") + "pnbrqk"[Math.abs(v) - 1], im = this.pc[code]; if (!im) continue; const p = this.pos(i), sp = this.spot[i] ? clamp((now - this.spot[i]) / 0.4, 0, 1) : 1, sc = 0.82 + 0.2 * (1 - Math.pow(1 - sp, 3)) + (i === this.sel ? 0.1 : 0);
        ctx.globalAlpha = a * 0.3; ctx.fillStyle = "#000"; ctx.beginPath(); ctx.ellipse(p.x + cs / 2, p.y + cs * 0.88, cs * 0.3, cs * 0.07, 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = a; ctx.drawImage(im, p.x + cs * (1 - sc) / 2, p.y + cs * (1 - sc) / 2 - (i === this.sel ? cs * 0.05 : 0), cs * sc, cs * sc);
      }
      ctx.globalAlpha = 1;
      for (const t of this.targets) { const p = this.pos(t.t), cap = t.cap, pulse = 0.5 + 0.5 * Math.sin(now * 6); ctx.fillStyle = rgb(cap ? C.red : C.cyan, cap ? 0.85 : 0.9); ctx.strokeStyle = rgb(cap ? C.red : C.cyan, 1); ctx.lineWidth = 3; ctx.beginPath(); if (cap) { ctx.arc(p.x + cs / 2, p.y + cs / 2, cs * (0.4 + 0.04 * pulse), 0, TAU); ctx.stroke(); } else { ctx.arc(p.x + cs / 2, p.y + cs / 2, cs * (0.13 + 0.015 * pulse), 0, TAU); ctx.fill(); } }
      // pièce en vol
      for (const a of this.anims) { const u = clamp((now - a.t0) / a.dur, 0, 1), e = 1 - Math.pow(1 - u, 3), A = this.pos(a.from), B = this.pos(a.to), im = this.pc[a.code]; if (im) ctx.drawImage(im, A.x + (B.x - A.x) * e, A.y + (B.y - A.y) * e - Math.sin(u * Math.PI) * cs * 0.12, cs, cs); if (u >= 1 && !a.over) { a.over = true; delete this.hide[a.to]; if (a.done) a.done(); } }
      this.anims = this.anims.filter((a) => !a.over);
      // étincelles et ondes
      ctx.globalCompositeOperation = "lighter";
      for (const q of this.parts) { q.age += this.dt; q.x += q.vx * this.dt; q.y += q.vy * this.dt; q.vx *= 0.97; q.vy *= 0.97; const u = q.age / q.life; if (u < 1) { ctx.fillStyle = rgb(q.col, 1 - u); ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (1 - u * 0.5), 0, TAU); ctx.fill(); } }
      this.parts = this.parts.filter((q) => q.age < q.life);
      for (const r of this.rings) { const u = (now - r.t0) / 0.7; if (u < 1) { ctx.strokeStyle = rgb(r.col, 1 - u); ctx.lineWidth = 4 * (1 - u * 0.6); ctx.beginPath(); ctx.arc(r.x, r.y, cs * (0.3 + 1.3 * u), 0, TAU); ctx.stroke(); } }
      this.rings = this.rings.filter((r) => now - r.t0 < 0.7); ctx.globalCompositeOperation = "source-over";
      this.drawFog(ctx, now);
      // coordonnées discrètes
      ctx.font = `700 ${Math.round(cs * 0.17)}px system-ui,sans-serif`; ctx.textAlign = "left"; ctx.fillStyle = "rgba(220,235,255,.55)";
      for (let c = 0; c < 8; c++) ctx.fillText("abcdefgh"[this.flip ? 7 - c : c], c * cs + cs * 0.06, S - cs * 0.05);
      ctx.textAlign = "right"; for (let r = 0; r < 8; r++) ctx.fillText(String(this.flip ? r + 1 : 8 - r), S - cs * 0.05, r * cs + cs * 0.2);
    }
    drawFog(ctx, t) {
      const S = this.S, d = this.dpr, fg = this.fogC.getContext("2d"), all = this.reveal > 0, ra = all ? clamp(1 - (this.now - this.revealT0) * 1.2, 0, 1) : 1; if (ra <= 0.01) return;
      fg.setTransform(d, 0, 0, d, 0, 0); fg.globalCompositeOperation = "source-over"; fg.globalAlpha = 1; fg.clearRect(0, 0, S, S);
      const base = fg.createLinearGradient(0, 0, S, S); base.addColorStop(0, "rgba(8,16,24,.95)"); base.addColorStop(1, "rgba(14,26,38,.95)"); fg.fillStyle = base; fg.fillRect(0, 0, S, S);
      for (let i = 0; i < 7; i++) { const x = S * (0.5 + 0.55 * Math.sin(t * 0.09 * (i + 1) + i * 2.3)), y = S * (0.5 + 0.55 * Math.cos(t * 0.07 * (i + 2) + i * 1.7)), r = S * (0.35 + 0.1 * (i % 3)), g = fg.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, "rgba(120,190,210,.20)"); g.addColorStop(1, "rgba(120,190,210,0)"); fg.fillStyle = g; fg.fillRect(0, 0, S, S); }
      fg.globalAlpha = 0.55; const ox = (t * 6) % 128, oy = (t * 3.5) % 128, pat = fg.createPattern(this.noise, "repeat"); fg.save(); fg.translate(-ox, -oy); fg.fillStyle = pat; fg.fillRect(0, 0, S + 128, S + 128); fg.restore(); fg.globalAlpha = 1;
      // trous : carte de visibilité 8×8 agrandie en lissé = cônes de lumière doux
      const mg = this.maskC.getContext("2d"), md = mg.createImageData(8, 8); for (let i = 0; i < 64; i++) { const p = this.pos(i), c = Math.round(p.x / (S / 8)), r = Math.round(p.y / (S / 8)), o = (r * 8 + c) * 4, a = this.reveal > 0 ? 1 : this.visA[i]; md.data[o] = md.data[o + 1] = md.data[o + 2] = 255; md.data[o + 3] = Math.round(clamp(a, 0, 1) * 255); }
      mg.putImageData(md, 0, 0); fg.globalCompositeOperation = "destination-out"; fg.imageSmoothingEnabled = true; fg.imageSmoothingQuality = "high";
      for (let k = 0; k < 3; k++) fg.drawImage(this.maskC, 0, 0, S, S);
      fg.globalCompositeOperation = "source-over";
      ctx.globalAlpha = ra; ctx.drawImage(this.fogC, 0, 0, S, S); ctx.globalAlpha = 1;
      // liseré de lumière à la frontière : reflète la zone vue
      if (!all) { ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = rgb(C.cyan, 0.5); ctx.lineWidth = 1.5; for (let i = 0; i < 64; i++) { if (this.visA[i] < 0.7) continue; const p = this.pos(i), x = i & 7, y = i >> 3; const edge = (dx, dy) => { const xx = x + dx, yy = y + dy; return xx < 0 || yy < 0 || xx > 7 || yy > 7 ? false : this.visA[yy * 8 + xx] < 0.3; }; const cs = S / 8; ctx.beginPath(); const fx = this.flip ? -1 : 1; void fx; if (edge(1, 0)) { const px = this.flip ? p.x : p.x + cs; ctx.moveTo(px, p.y); ctx.lineTo(px, p.y + cs); } if (edge(-1, 0)) { const px = this.flip ? p.x + cs : p.x; ctx.moveTo(px, p.y); ctx.lineTo(px, p.y + cs); } if (edge(0, 1)) { const py = this.flip ? p.y + cs : p.y; ctx.moveTo(p.x, py); ctx.lineTo(p.x + cs, py); } if (edge(0, -1)) { const py = this.flip ? p.y : p.y + cs; ctx.moveTo(p.x, py); ctx.lineTo(p.x + cs, py); } ctx.stroke(); } ctx.globalCompositeOperation = "source-over"; }
    }
  }

  // ------------------------------------------------------------------ la partie
  let CUR = null; (E.backHandlers = E.backHandlers || []).push(() => (CUR && CUR.alive ? CUR.onBack() : false));
  class Game {
    constructor(host, o) {
      CUR = this; this.o = o; this.mode = o.mode; this.level = o.level || 2; this.human = o.human || "w"; this.alive = true; this.busy = false; this.S = o.S || FG.newGame(); this.sel = -1; this.prev = null;
      this.bot = this.mode === "ai" ? new FG.Bot(FG.other(this.human), { level: this.level, seed: (Date.now() & 0xffff) + 1 }) : null; this.viewer = this.mode === "duo" ? this.S.turn : this.human;
      this.root = $c("div"); this.root.className = "fg-game"; host.appendChild(this.root);
      this.root.innerHTML = `<div class="fg-top"><button class="fd-ib" data-a="quit" aria-label="Quitter">✕</button><div class="fg-chip" id="fg-chip"><i></i><b></b><small></small></div><button class="fd-ib" data-a="menu" aria-label="Menu">☰</button></div>
        <div class="fg-mid"><div class="fg-board"><canvas class="fg-cv"></canvas></div></div>
        <div class="fg-info"><div class="fg-msg" id="fg-msg"></div><div class="fg-caps"><div id="fg-taken"></div><div id="fg-lost"></div></div></div>
        <div class="fg-think" id="fg-think" hidden>ETO cherche dans le brouillard<i>.</i><i>.</i><i>.</i></div>
        <div class="fg-pass" id="fg-pass" hidden></div><div class="fd-over" id="fg-over" hidden></div><div class="fd-menu" id="fg-menu" hidden></div><div class="fd-promo" id="fg-promo" hidden></div>`;
      this.q = (s) => this.root.querySelector(s); this.v = new FogView(this.q(".fg-cv")); this.v.onTap = (s) => this.tap(s);
      this.root.addEventListener("click", (e) => { const b = e.target.closest("[data-a]"); if (b) this.act(b.dataset.a); });
      if (this.mode === "duo") this.passScreen(); else this.showView(true);
      if (this.mode === "ai" && this.S.turn !== this.human && !this.S.over) this.botTurn();
    }
    destroy() { this.alive = false; if (CUR === this) CUR = null; this.v.destroy(); this.root.remove(); }
    onBack() {
      const m = this.q("#fg-menu"); if (!m.hidden) { m.hidden = true; return true; } const r = document.querySelector(".fd-rules"); if (r) { r.remove(); return true; }
      const p = this.q("#fg-promo"); if (!p.hidden) { p.hidden = true; return true; } if (!this.q("#fg-over").hidden) { this.quit(); return true; } this.menu(); return true;
    }
    act(a) { if (a === "quit") return this.quit(); if (a === "menu") return this.menu(); }
    quit(again) { const cb = this.o.onQuit; this.destroy(); if (cb) cb(again); }
    msg(html, cls) { const m = this.q("#fg-msg"); m.className = "fg-msg " + (cls || ""); m.innerHTML = html || ""; m.classList.remove("pop"); void m.offsetWidth; m.classList.add("pop"); }
    showView(reset) {
      const S = this.S, v = FG.view(S, this.viewer), me = this.viewer; this.v.flip = me === "b"; this.view = v; this.v.setView(v, { reset });
      const chip = this.q("#fg-chip"); chip.className = "fg-chip " + S.turn; chip.querySelector("b").textContent = S.over ? "PARTIE TERMINÉE" : (this.mode === "ai" ? (S.turn === this.human ? "À TOI" : "ETO JOUE") : (S.turn === "w" ? "BLANCS" : "NOIRS") + " JOUENT"); chip.querySelector("small").textContent = "demi-coup " + S.ply + " · tu vois " + v.cells.reduce((n, c) => n + (c !== FOG ? 1 : 0), 0) + " / 64 cases";
      this.q("#fg-taken").innerHTML = this.capHtml(v.taken, "prises", me === "w" ? "b" : "w"); this.q("#fg-lost").innerHTML = this.capHtml(v.lost, "perdues", me);
      const mine = S.last && S.last.by === me ? S.last : null; this.v.lastMine = mine ? { f: mine.f, t: mine.t } : null; this.v.lastEnemy = v.seen ? { f: v.seen.f, t: v.seen.t } : null;
    }
    capHtml(arr, lab, col) { let h = ""; for (let k = 5; k >= 1; k--) for (let i = 0; i < arr[k]; i++) h += `<img src="${E.assetBase || ""}img/chess/${col}${"pnbrqk"[k - 1]}.png" alt="">`; return h ? `<small>${lab}</small>${h}` : ""; }

    // ---- toucher
    tap(sq) {
      const S = this.S; if (this.busy || S.over || this.q("#fg-pass") && !this.q("#fg-pass").hidden) return; if (this.mode === "ai" && S.turn !== this.human) return; const me = this.viewer, v = this.view;
      const flat = new Int8Array(64); for (let i = 0; i < 64; i++) flat[i] = v.cells[i] === FOG ? 0 : v.cells[i];
      const ms = FG.gen(flat, me, v.castle), t = this.v.targets.find((q) => q.t === sq);
      if (this.sel >= 0 && t) { const m = ms.filter((q) => q.f === this.sel && q.t === sq); if (m.some((q) => q.promo)) return this.askPromo(m, (pr) => this.doMove(m.find((q) => q.promo === pr))); return this.doMove(m[0]); }
      const val = v.cells[sq]; if (val && val !== FOG && (val > 0) === (me === "w")) { this.sel = sq; this.v.sel = sq; this.v.targets = ms.filter((q) => q.f === sq).map((q) => ({ t: q.t, cap: q.cap })).filter((q, i, a) => a.findIndex((z) => z.t === q.t) === i); snd("move"); vib(8); if (!this.v.targets.length) this.msg("Cette pièce ne peut pas bouger.", "dim"); }
      else { this.sel = -1; this.v.sel = -1; this.v.targets = []; }
    }
    askPromo(ms, cb) { const p = this.q("#fg-promo"); p.hidden = false; p.innerHTML = `<div><b>Promotion</b><div class="row">${[5, 4, 3, 2].map((k) => `<button data-k="${k}"><img src="${E.assetBase || ""}img/chess/${this.viewer}${"pnbrqk"[k - 1]}.png" alt=""><span>${NAMES[k]}</span></button>`).join("")}</div></div>`; p.onclick = (e) => { const b = e.target.closest("[data-k]"); if (!b) return; p.hidden = true; cb(+b.dataset.k); }; }
    doMove(m) {
      const S = this.S, me = this.viewer, code = (me === "w" ? "w" : "b") + "pnbrqk"[m.pc - 1]; this.sel = -1; this.v.sel = -1; this.v.targets = []; this.busy = true;
      const r = FG.play(S, { f: m.f, t: m.t, promo: m.promo }); if (!r.ok) { this.busy = false; return; }
      snd(r.cap ? "capture" : "move"); vib(r.cap ? 30 : 10); this.view = FG.view(S, me); this.v.setView(this.view);
      this.v.slide(m.f, m.t, code, () => { if (r.cap) { this.v.burst(m.t, C.amber, 26, 110); this.v.ring(m.t, C.amber); } });
      this.after(r, "mine", m);
    }
    after(r, who, m) {
      const S = this.S; if (who === "mine") this.msg(r.cap ? `Tu as capturé <b>${NAMES[r.cap]}</b> en <b>${FG.name(m.t)}</b> !` : "", r.cap ? "good" : "");
      setTimeout(() => {
        if (!this.alive) return; this.busy = false; this.showView();
        if (S.over) return this.finish();
        if (this.mode === "ai") { if (who === "mine") this.botTurn(); } else if (who === "mine") this.passScreen();
      }, 520);
    }
    botTurn() {
      if (!this.alive || this.S.over) return; this.busy = true; this.q("#fg-think").hidden = false; this.showView();
      setTimeout(() => {
        if (!this.alive) return; const S = this.S, bc = S.turn; let m = null; try { m = this.bot.move(FG.view(S, bc)); } catch (e) { m = null; }
        this.q("#fg-think").hidden = true;
        if (!m) { S.over = { winner: null, why: "Nulle : ETO ne peut plus jouer" }; this.busy = false; return this.finish(); }
        const before = this.view, r = FG.play(S, m); if (!r.ok) { this.busy = false; return; }
        const me = this.human, vw = FG.view(S, me), seen = vw.seen, code = (bc === "w" ? "w" : "b") + "pnbrqk"[Math.abs(S.b[m.t]) - 1];
        const hv = (i) => i >= 0 && vw.cells[i] !== FOG;
        // ce que le joueur a le droit de remarquer
        if (vw.capOwn) { const o = vw.capOwn; this.msg(`ETO a capturé ta <b>${NAMES[o.cap]}</b> en <b>${FG.name(o.t)}</b> avec ${["", "un pion", "un cavalier", "un fou", "une tour", "une dame", "son roi"][o.piece]} !`, "bad"); snd("capture"); vib([40, 40, 40]); this.v.ring(o.t, C.red); this.v.burst(o.t, C.red, 30, 120); }
        else if (seen && seen.t >= 0) { this.msg(`Une pièce ennemie (<b>${NAMES[seen.piece]}</b>) est apparue en <b>${FG.name(seen.t)}</b>.`, "warn"); snd("move"); this.v.spot[seen.t] = this.v.now; this.v.ring(seen.t, C.amber); vib(15); }
        else if (seen && seen.f >= 0) { this.msg(`Une pièce ennemie a quitté <b>${FG.name(seen.f)}</b> et a disparu dans le brouillard.`, "warn"); snd("move"); }
        else this.msg("ETO a joué… tu n'as rien vu.", "dim");
        this.view = vw; this.v.flip = me === "b"; this.v.setView(vw);
        if (seen && seen.t >= 0 && seen.f >= 0 && hv(seen.f)) this.v.slide(seen.f, seen.t, code, null);
        this.busy = false; this.showView(); if (S.over) return this.finish();
      }, 380);
    }

    // ---- JvJ : écran de passage (chacun ne doit voir que SA vue)
    passScreen() {
      const S = this.S, p = this.q("#fg-pass"), who = S.turn === "w" ? "BLANCS" : "NOIRS"; this.busy = true; this.view = { cells: new Int8Array(64).fill(FOG), taken: [], lost: [], seen: null, castle: 0 }; this.v.setView(this.view); this.v.visA.fill(0); this.v.lastEnemy = this.v.lastMine = null; this.v.flip = S.turn === "b";
      this.q("#fg-taken").innerHTML = this.q("#fg-lost").innerHTML = ""; p.hidden = false;
      p.innerHTML = `<div class="fd-card"><h2 class="${S.turn}">${who}</h2><p>Passe le téléphone aux <b>${who.toLowerCase()}</b>.<br>L'autre joueur ne doit <b>pas regarder</b> l'écran.</p><button class="fd-b pri big" data-p="go">JE SUIS PRÊT</button></div>`;
      p.onclick = (e) => { if (!e.target.closest("[data-p]")) return; p.hidden = true; this.busy = false; this.viewer = S.turn; this.showView(true); this.reportSeen(); this.save(); };
    }
    reportSeen() { const v = this.view; if (!v || !v.seen) return this.msg(this.S.ply ? "L'adversaire a joué… tu n'as rien vu." : "À toi : explore ce que tu vois.", "dim"); const s = v.seen; if (s.t >= 0) { this.msg(`Une pièce ennemie (<b>${NAMES[s.piece]}</b>) est en <b>${FG.name(s.t)}</b>.`, "warn"); this.v.spot[s.t] = this.v.now; } else this.msg(`Une pièce ennemie a quitté <b>${FG.name(s.f)}</b>.`, "warn"); }

    // ---- fin : le brouillard se lève
    finish() {
      const S = this.S, o = S.over, el = this.q("#fg-over"); this.busy = true; this.v.truth = S.b; this.v.reveal = 1; this.v.revealT0 = this.v.now; try { E.settings.set(SAVE, ""); } catch (e) { /* rien */ }
      const won = !o.winner ? 0 : (this.mode === "duo" || o.winner === this.human) ? 1 : -1; snd(won ? "mate" : "move"); vib(won ? [40, 60, 40, 60, 120] : 40);
      this.q("#fg-chip").querySelector("b").textContent = "PARTIE TERMINÉE";
      setTimeout(() => {
        el.hidden = false; const who = o.winner === "w" ? "Blancs" : o.winner === "b" ? "Noirs" : "";
        el.innerHTML = `<div class="fd-card ${won > 0 ? "win" : won < 0 ? "lose" : ""}"><h2>${o.winner ? (this.mode === "duo" ? "Victoire des " + who : won > 0 ? "VICTOIRE" : "DÉFAITE") : "NULLE"}</h2><p>${esc(o.why)}</p><p class="m">${S.ply} demi-coups · le brouillard est levé : regarde où étaient les pièces</p><div class="row"><button class="fd-b pri" data-o="again">REJOUER</button><button class="fd-b" data-o="look">REVOIR</button><button class="fd-b" data-o="quit">MENU</button></div></div>`;
        el.onclick = (e) => { const b = e.target.closest("[data-o]"); if (!b) return; if (b.dataset.o === "quit") this.quit(); else if (b.dataset.o === "again") this.quit(true); else el.hidden = true; };
      }, 1600);
    }
    save() { try { if (!this.S.over) E.settings.set(SAVE, JSON.stringify({ mode: this.mode, level: this.level, human: this.human, S: { b: Array.from(this.S.b), turn: this.S.turn, castle: this.S.castle, ply: this.S.ply, quiet: this.S.quiet, last: this.S.last, log: this.S.log.slice(-300) } })); } catch (e) { /* rien */ } }
    menu() {
      const m = this.q("#fg-menu"); m.hidden = false; const sd = E.settings.get("fog.sound", true) !== false, hp = E.settings.get("fog.haptic", true) !== false;
      m.innerHTML = `<div class="fd-card"><h3>Menu</h3><div class="row col"><button class="fd-b" data-m="resume">REPRENDRE</button><button class="fd-b" data-m="sound">Son : ${sd ? "activé" : "coupé"}</button><button class="fd-b" data-m="haptic">Vibrations : ${hp ? "activées" : "coupées"}</button><button class="fd-b" data-m="rules">RÈGLES</button><button class="fd-b" data-m="resign">ABANDONNER</button><button class="fd-b" data-m="quit">QUITTER</button></div></div>`;
      m.onclick = (e) => { const b = e.target.closest("[data-m]"); if (!b) { if (e.target === m) m.hidden = true; return; } const a = b.dataset.m; if (a === "resume") m.hidden = true; else if (a === "sound") { E.settings.set("fog.sound", !sd); this.menu(); } else if (a === "haptic") { E.settings.set("fog.haptic", !hp); this.menu(); } else if (a === "rules") { m.hidden = true; showRules(this.root); } else if (a === "quit") { m.hidden = true; this.save(); this.quit(); } else if (a === "resign") { m.hidden = true; this.S.over = { winner: FG.other(this.mode === "duo" ? this.S.turn : this.human), why: "Abandon" }; this.finish(); } };
    }
  }

  function showRules(host) {
    const o = $c("div"); o.className = "fd-rules"; host.appendChild(o);
    const pages = [
      ["Le brouillard", "Tu ne vois que <b>tes pièces</b> et les <b>cases où elles peuvent aller</b> (ou qu'elles attaquent). Tout le reste est dans le brouillard : tu ne sais pas ce que l'adversaire y prépare."],
      ["Ce que voit une pièce", "<b>Tour, fou, dame</b> : chaque ligne jusqu'à la première pièce <u>incluse</u> · <b>Cavalier, roi</b> : leurs cases d'arrivée · <b>Pion</b> : la case devant lui (même occupée) et ses deux diagonales."],
      ["Gagner", "<b>Capturer le roi adverse</b>. Quand l'adversaire capture une de tes pièces, tu en es informé (case et pièce qui a pris). Il n'y a ni échec ni mat : tu peux laisser ton roi en prise… à tes risques ! Roque et promotion permis ; pas de prise en passant. Nulle après 100 demi-coups sans prise ni coup de pion."],
      ["Un adversaire honnête", "ETO n'a pas le droit de tricher : il ne voit <b>que</b> les cases qui lui sont visibles, comme toi. Il imagine ce qui se cache dans le brouillard et choisit son coup en conséquence."],
      ["À deux", "Joueur contre joueur sur <b>un seul téléphone</b> : après chaque coup, un écran de passage cache le plateau. Passe l'appareil, l'autre appuie sur « Je suis prêt »."],
    ];
    let i = 0; const draw = () => { o.innerHTML = `<div class="fd-card"><div class="fd-dots">${pages.map((p, k) => `<i class="${k === i ? "c" : k < i ? "d" : ""}"></i>`).join("")}</div><h3>${pages[i][0]}</h3><p>${pages[i][1]}</p><div class="row"><button class="fd-b" data-r="prev" ${i ? "" : "disabled"}>◂</button><button class="fd-b pri" data-r="next">${i === pages.length - 1 ? "OK" : "▸"}</button></div></div>`; };
    o.onclick = (e) => { const b = e.target.closest("[data-r]"); if (!b) { if (e.target === o) o.remove(); return; } if (b.dataset.r === "prev") i = Math.max(0, i - 1); else if (i === pages.length - 1) { o.remove(); return; } else i++; draw(); }; draw();
  }

  // ------------------------------------------------------------------ module
  E.suite.register({
    id: "fog", group: "chess", title: "Chess Fog", sub: "Échecs dans le brouillard",
    icon: '<path d="M4 9h12a3 3 0 1 0-3-3"/><path d="M3 13h16a3 3 0 1 1-3 3"/><path d="M6 17h6"/>',
    onShow() { if (this._refresh) this._refresh(); },
    build(el, A) {
      const prefs = Object.assign({ level: 2, side: "w" }, E.settings.get(PREF, {}) || {}), $ = (s) => el.querySelector(s);
      el.innerHTML = `<div class="fd-home"><div class="fd-hero fg-hero"><canvas id="fg-hero"></canvas><div class="fd-title"><small>ÉCHECS DANS LE BROUILLARD</small><b>CHESS FOG</b><span>tu ne vois que ce que tes pièces voient</span></div></div>
        <div class="fd-menu-b"><button class="fd-b big pri" id="fg-play">JOUER CONTRE ETO</button><div class="row"><button class="fd-b" id="fg-duo">JOUEUR CONTRE JOUEUR</button><button class="fd-b" id="fg-rules">RÈGLES</button></div><button class="fd-b" id="fg-resume" hidden>REPRENDRE LA PARTIE</button></div>
        <div class="card fd-opts"><h3>Partie contre ETO</h3><div class="fd-row"><span>Niveau</span><div class="seg" data-k="level"><button data-v="1">1</button><button data-v="2">2</button><button data-v="3">3</button></div></div>
        <div class="fd-row"><span>Tu joues</span><div class="seg" data-k="side"><button data-v="w">Blancs</button><button data-v="b">Noirs</button><button data-v="r">Au hasard</button></div></div>
        <p class="muted">ETO ne triche pas : il ne reçoit que les cases qu'il voit. « Joueur contre joueur » se joue à deux sur le même téléphone, avec un écran de passage entre les coups.</p></div></div>`;
      const paint = () => el.querySelectorAll(".seg[data-k]").forEach((s) => s.querySelectorAll("button").forEach((b) => b.classList.toggle("on", String(prefs[s.dataset.k]) === b.dataset.v)));
      el.querySelectorAll(".seg[data-k]").forEach((s) => (s.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; prefs[s.dataset.k] = s.dataset.k === "level" ? +b.dataset.v : b.dataset.v; E.settings.set(PREF, prefs); paint(); })); paint();
      let hero = null; const startHero = () => { if (hero) return; hero = new FogView($("#fg-hero"), { demo: true }); this._hero = hero; const S = FG.newGame(); for (const [f, t] of [[12, 28], [52, 36], [6, 21], [57, 42]]) FG.play(S, { f, t }); const v = FG.view(S, "w"); hero.setView(v, { reset: true }); };
      const stopHero = () => { if (hero) { hero.destroy(); hero = this._hero = null; } };
      setTimeout(startHero, 60); const refresh = () => { try { const s = E.settings.get(SAVE, ""); $("#fg-resume").hidden = !s; } catch (e) { /* rien */ } }; this._refresh = refresh; refresh();
      const launch = (o) => {
        if (this._game && this._game.alive) this._game.destroy(); stopHero();
        const human = prefs.side === "r" ? (Math.random() < 0.5 ? "w" : "b") : prefs.side;
        this._game = new Game(document.getElementById("app") || document.body, Object.assign({ mode: "ai", level: prefs.level, human, onQuit: (again) => { this._game = null; if (again === true) { launch(o); return; } setTimeout(startHero, 100); refresh(); } }, o));
      };
      $("#fg-play").onclick = () => launch({ mode: "ai" }); $("#fg-duo").onclick = () => launch({ mode: "duo", human: "w" }); $("#fg-rules").onclick = () => showRules(el.closest(".subview") || document.body);
      $("#fg-resume").onclick = () => { try { const s = JSON.parse(E.settings.get(SAVE, "")); const S = FG.newGame(); S.b = Int8Array.from(s.S.b); Object.assign(S, { turn: s.S.turn, castle: s.S.castle, ply: s.S.ply, quiet: s.S.quiet, last: s.S.last, log: s.S.log }); launch({ mode: s.mode, level: s.level, human: s.human, S }); } catch (e) { A.toast("Sauvegarde illisible.", "err"); E.settings.set(SAVE, ""); refresh(); } };
      el._api = { launch, FG, Game, FogView, game: () => this._game, prefs };
    },
  });
})();
