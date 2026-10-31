"use strict";
// CHESS EDIT STUDIO — MOTEUR DE RENDU TEMPS RÉEL (mobile) : l'échiquier passe en 3D (CSS3D, perspective 900 px), noir & blanc contrasté avec vignette ; seuls les halos, traînées
// et particules sont en couleur (vert = bon coup, cyan = brillant, rouge = gaffe / échec). Caméra qui plonge vers la case d'arrivée (cubic-bezier(0.16,1,0.3,1), ±8°),
// poussière cosmique (2 canvas : fond + avant-plan) qui accélère au zoom, shake amorti + aberration chromatique RGB (filtre SVG) + flash 60 ms sur chaque impact,
// cutscenes procédurales (« THE ROOK ! », promotion, boss) et répliques des bots en machine à écrire glitchée.
(() => {
  const E = window.ENOS;
  const TONE = { green: "#2bff88", cyan: "#00f2fe", red: "#ff0044", gold: "#ffd24a" };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pieceUrl = (p) => `${E.assetBase || ""}img/chess/${p === p.toUpperCase() ? "w" : "b"}${p.toLowerCase()}.png`;
  const fenMap = (fen) => { const m = {}; fen.split(" ")[0].split("/").forEach((r, y) => { let x = 0; for (const c of r) { if (/\d/.test(c)) x += +c; else m[String.fromCharCode(97 + x++) + (8 - y)] = c; } }); return m; };
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  class Stage {
    /** host : élément plein écran (dans #app). opts : {flip, title, onClose, onToggle}. */
    constructor(host, opts) {
      this.o = opts || {}; this.host = host; this.flip = !!this.o.flip; this.timers = []; this.alive = true;
      this.shake = 0; this.chroma = 0; this.warp = 0; this.burst = []; this.t0 = performance.now(); this.pieces = {}; this.ghosts = 0; this.rz = 0;
      host.classList.add("ce-stage");
      host.innerHTML = `<canvas class="ce-bg"></canvas>
        <svg width="0" height="0" style="position:absolute"><filter id="ce-ab" x="-3%" y="-3%" width="106%" height="106%" color-interpolation-filters="sRGB">
          <feColorMatrix in="SourceGraphic" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/><feOffset in="r" dx="0" dy="0" result="ro" class="ce-abr"/>
          <feColorMatrix in="SourceGraphic" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>
          <feColorMatrix in="SourceGraphic" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/><feOffset in="b" dx="0" dy="0" result="bo" class="ce-abb"/>
          <feBlend in="ro" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="bo" mode="screen"/></filter></svg>
        <div class="ce-fxwrap"><div class="ce-shake"><div class="ce-persp"><div class="ce-drift"><div class="ce-cam"><div class="ce-board"></div><div class="ce-pcs"></div><div class="ce-fxl"></div></div></div></div></div></div>
        <canvas class="ce-fg"></canvas><div class="ce-vig"></div><div class="ce-flash"></div><div class="ce-ff" hidden>▶▶ ×8</div>
        <div class="ce-cut" hidden></div><div class="ce-cap" hidden></div>
        <div class="ce-hud"><button class="ce-x" aria-label="Fermer">✕</button><span class="ce-title"></span><button class="ce-pp" aria-label="Lecture / pause">⏸</button></div><div class="ce-prog"><i></i></div>`;
      const q = (s) => host.querySelector(s);
      this.bg = q(".ce-bg"); this.fg = q(".ce-fg"); this.wrap = q(".ce-fxwrap"); this.shk = q(".ce-shake"); this.drift = q(".ce-drift"); this.cam = q(".ce-cam"); this.board = q(".ce-board"); this.pcs = q(".ce-pcs"); this.fxl = q(".ce-fxl");
      this.flash = q(".ce-flash"); this.cut = q(".ce-cut"); this.cap = q(".ce-cap"); this.ffEl = q(".ce-ff"); this.prog = q(".ce-prog i"); this.abr = q(".ce-abr"); this.abb = q(".ce-abb");
      q(".ce-title").textContent = this.o.title || ""; q(".ce-x").onclick = () => this.o.onClose && this.o.onClose(); q(".ce-pp").onclick = () => this.o.onToggle && this.o.onToggle();
      this.ppBtn = q(".ce-pp");
      this.resize(); this.buildBoard(); this.initParticles(); this.setFen(START);
      this.camTo({ rx: 28, rz: 0, s: 0.92 }, 0);
      this.raf = requestAnimationFrame((t) => this.loop(t)); this.last = performance.now();
      this._rs = () => this.resize(); window.addEventListener("resize", this._rs);
    }
    later(fn, ms) { const id = setTimeout(() => { if (this.alive) fn(); }, ms); this.timers.push(id); return id; }
    resize() {
      const W = this.host.clientWidth || innerWidth, H = this.host.clientHeight || innerHeight, S = Math.floor(Math.min(W - 20, H * 0.56));
      this.S = S; this.cell = S / 8; this.W = W; this.H = H;
      [this.board, this.pcs, this.fxl].forEach((e) => { e.style.width = e.style.height = S + "px"; });
      this.cam.style.width = this.cam.style.height = S + "px"; this.cam.style.left = (W - S) / 2 + "px"; this.cam.style.top = (H - S) / 2 - H * 0.04 + "px";
      const d = Math.min(devicePixelRatio || 1, 1.5);
      [this.bg, this.fg].forEach((c) => { c.width = Math.round(W * d); c.height = Math.round(H * d); c.style.width = W + "px"; c.style.height = H + "px"; c.getContext("2d").setTransform(d, 0, 0, d, 0, 0); });
      Object.values(this.pieces).forEach((el) => this.place(el, el._sq));
    }
    xy(sq) { let c = sq.charCodeAt(0) - 97, r = 8 - +sq[1]; if (this.flip) { c = 7 - c; r = 7 - r; } return { x: c * this.cell, y: r * this.cell, c, r }; }
    buildBoard() {
      this.board.innerHTML = ""; this.sq = {};
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const d = document.createElement("i"); d.style.cssText = `left:${c * 12.5}%;top:${r * 12.5}%;background:${(r + c) % 2 ? "#3a3a3a" : "#c9c9c9"}`;
        this.board.appendChild(d); this.sq[this.flip ? String.fromCharCode(97 + 7 - c) + (r + 1) : String.fromCharCode(97 + c) + (8 - r)] = d;
      }
    }
    place(el, sq) { const p = this.xy(sq); el._sq = sq; el.style.width = el.style.height = this.cell + "px"; el.style.transform = `translate(${p.x}px,${p.y}px)`; }
    mkPiece(ch, sq) { const el = document.createElement("img"); el.src = pieceUrl(ch); el._p = ch; el.draggable = false; this.pcs.appendChild(el); this.place(el, sq); this.pieces[sq] = el; return el; }
    /** pose directe d'une position (aucune animation) */
    setFen(fen) {
      const m = fenMap(fen);
      Object.keys(this.pieces).forEach((s) => { if (m[s] !== this.pieces[s]._p) { this.pieces[s].remove(); delete this.pieces[s]; } });
      Object.keys(m).forEach((s) => { if (!this.pieces[s]) this.mkPiece(m[s], s); });
      this.pcs.querySelectorAll("img").forEach((e) => { e.style.transition = "none"; });
      this.fen = fen;
    }
    /** joue un coup avec animation + traînée ; ev : événement de timeline (from, to, fen, color, tone) */
    move(ev, fast) {
      const pre = this.pieces[ev.from];
      if (!pre) { this.setFen(ev.fen); return; }
      const dur = fast ? 70 : 300, tone = TONE[ev.tone] || TONE.green, a = this.xy(ev.from), b = this.xy(ev.to);
      const cap = this.pieces[ev.to];
      if (cap) { cap.style.transition = "opacity .25s, transform .25s"; cap.style.opacity = "0"; cap.style.transform += " scale(1.6)"; const c2 = cap; this.later(() => c2.remove(), 260); delete this.pieces[ev.to]; }
      delete this.pieces[ev.from]; this.pieces[ev.to] = pre; pre._sq = ev.to;
      pre.style.transition = `transform ${dur}ms cubic-bezier(.2,.9,.2,1)`; pre.style.zIndex = 3; this.later(() => { pre.style.zIndex = ""; }, dur + 50);
      pre.style.transform = `translate(${b.x}px,${b.y}px)`;
      if (ev.piece === "k" && Math.abs(a.c - b.c) === 2) {                                           // roque : la tour suit
        const row = ev.from[1], short = ev.to[0] > ev.from[0], rf = (short ? "h" : "a") + row, rt = (short ? "f" : "d") + row, rk = this.pieces[rf];
        if (rk) { delete this.pieces[rf]; this.pieces[rt] = rk; rk._sq = rt; rk.style.transition = `transform ${dur}ms cubic-bezier(.2,.9,.2,1)`; const p = this.xy(rt); rk.style.transform = `translate(${p.x}px,${p.y}px)`; }
      }
      this.later(() => { const target = fenMap(ev.fen); Object.keys(this.pieces).forEach((s) => { if (target[s] !== this.pieces[s]._p) { if (s === ev.to && target[s]) { this.pieces[s]._p = target[s]; this.pieces[s].src = pieceUrl(target[s]); } else { this.pieces[s].remove(); delete this.pieces[s]; } } });
        Object.keys(target).forEach((s) => { if (!this.pieces[s]) this.mkPiece(target[s], s); }); }, dur + 20);
      if (!fast) {                                                                                   // traînée lumineuse : silhouettes fantômes le long du trajet
        for (let i = 1; i <= 5; i++) {
          const g = document.createElement("img"), f = i / 6; g.src = pre.src; g.className = "ce-ghost"; g.style.cssText = `width:${this.cell}px;height:${this.cell}px;left:${a.x + (b.x - a.x) * f}px;top:${a.y + (b.y - a.y) * f}px;filter:brightness(0) invert(1) drop-shadow(0 0 7px ${tone}) drop-shadow(0 0 16px ${tone});animation-delay:${i * 35}ms`;
          this.fxl.appendChild(g); this.later(() => g.remove(), 700);
        }
      }
    }
    // ---------------------------------------------------------------- caméra
    camTo(c, ms, col, row) {
      const s = c.s, rx = c.rx, rz = c.rz; this.rz = rz;
      let tx = 0, ty = 0;
      if (col != null) {
        let dx = (col - 3.5) * this.cell, dy = (row - 3.5) * this.cell; const a = (rz * Math.PI) / 180;
        const x2 = dx * Math.cos(a) - dy * Math.sin(a), y2 = dx * Math.sin(a) + dy * Math.cos(a);
        tx = -x2 * s * 0.75; ty = -y2 * s * Math.cos((rx * Math.PI) / 180) * 0.75;
      }
      this.cam.style.transition = ms ? `transform ${ms}ms cubic-bezier(0.16,1,0.3,1)` : "none";
      this.cam.style.transform = `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) rotateX(${rx}deg) rotateZ(${rz}deg) scale(${s})`;
    }
    // ---------------------------------------------------------------- impacts
    /** ev : événement ; power 0..1 (force de l'impact) */
    hit(ev, power) {
      const tone = TONE[ev.tone] || TONE.green, p = this.xy(ev.to), heavy = ev.fx === "SHAKE_HEAVY" || ev.fx === "BOSS_AWAKENING" || ev.fx === "PROMOTION_CUTSCENE" || ev.kind === "drop";
      const s = 1.3 + power * 0.7 + (ev.kind === "drop" ? 0.25 : 0), rx = rnd(38, 54) + power * 4, rz = rnd(-8, 8);
      this.camTo({ rx, rz, s }, ev.kind === "drop" ? 1100 : 850, p.c, p.r);
      this.warp = Math.max(this.warp, 0.5 + power * 0.8);
      // halo radial + case d'arrivée allumée
      const halo = document.createElement("div"); halo.className = "ce-halo"; halo.style.cssText = `left:${p.x - this.cell}px;top:${p.y - this.cell}px;width:${this.cell * 3}px;height:${this.cell * 3}px;background:radial-gradient(circle,${tone} 0%,${tone}88 28%,transparent 68%)`;
      this.fxl.appendChild(halo); this.later(() => halo.remove(), 1000);
      if (this.lit) this.lit.remove();
      this.lit = document.createElement("div"); this.lit.className = "ce-lit"; this.lit.style.cssText = `left:${p.x}px;top:${p.y}px;width:${this.cell}px;height:${this.cell}px;box-shadow:0 0 ${this.cell * 0.6}px ${tone},inset 0 0 ${this.cell * 0.4}px ${tone};border-color:${tone}`;
      this.fxl.appendChild(this.lit);
      if (ev.fx === "BRILLIANT_SHOCKWAVE" || ev.key === "brilliant") {
        for (let i = 0; i < 2; i++) { const r = document.createElement("div"); r.className = "ce-ring"; r.style.cssText = `left:${p.x + this.cell / 2}px;top:${p.y + this.cell / 2}px;border-color:${TONE.cyan};box-shadow:0 0 18px ${TONE.cyan};animation-delay:${i * 140}ms`; this.fxl.appendChild(r); this.later(() => r.remove(), 1200); }
        const b = document.createElement("div"); b.className = "ce-bang"; b.textContent = "!!"; b.style.cssText = `left:${p.x + this.cell * 0.55}px;top:${p.y - this.cell * 0.55}px;font-size:${this.cell * 0.9}px`; this.fxl.appendChild(b); this.later(() => b.remove(), 1300);
      } else if (ev.fx === "BLUNDER_RED" || ev.check || ev.key === "blunder") {
        const b = document.createElement("div"); b.className = "ce-bang red"; b.textContent = ev.key === "blunder" ? "??" : "+"; b.style.cssText = `left:${p.x + this.cell * 0.55}px;top:${p.y - this.cell * 0.55}px;font-size:${this.cell * 0.9}px`; this.fxl.appendChild(b); this.later(() => b.remove(), 1100);
      }
      if (heavy || ev.captured || power > 0.7) {
        this.shake = Math.max(this.shake, 10 + power * 16); this.chroma = Math.max(this.chroma, 5 + power * 9);
        this.flashFx(ev.tone === "red" || ev.fx === "BLUNDER_RED" ? "#ff1a3c" : "#fff");
        this.later(() => this.explode(ev, tone, ev.captured ? 46 : 24), 160);
      }
      if (E.vibrate && heavy) E.vibrate(ev.kind === "drop" ? [40, 30, 90] : 18);
    }
    flashFx(color) { this.flash.style.background = color; this.flash.animate([{ opacity: 0.85 }, { opacity: 0.85, offset: 0.4 }, { opacity: 0 }], { duration: 150 }); }
    explode(ev, tone, n) {
      const r = this.host.getBoundingClientRect(), q = this.sq[ev.to].getBoundingClientRect(), x = q.left - r.left + q.width / 2, y = q.top - r.top + q.height / 2;
      for (let i = 0; i < n; i++) { const a = rnd(0, 6.283), v = rnd(60, 360); this.burst.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: rnd(0.5, 1.1), max: 1.1, c: Math.random() < 0.3 ? "#fff" : tone, s: rnd(1.5, 3.6) }); }
    }
    // ---------------------------------------------------------------- cutscenes / texte
    cutscene(c, tone) {
      const col = tone === "red" ? "#ff3a52" : TONE.gold, img = `${E.assetBase || ""}img/chess/${c.color}${c.piece}.png`;
      this.cut.hidden = false;
      this.cut.innerHTML = `<div class="ce-rays"></div><div class="ce-arrows">${Array.from({ length: 8 }, (_, i) => `<b style="transform:rotate(${i * 45}deg) translateY(-34vmin)">➤</b>`).join("")}</div>
        <img src="${img}" style="filter:brightness(0) drop-shadow(0 0 10px ${col}) drop-shadow(0 0 30px ${col}) drop-shadow(0 0 60px #fff8)"><div class="ce-big" style="text-shadow:0 0 14px ${col},0 0 40px ${col}">${E.esc(c.text)}</div>`;
      this.cut.animate([{ opacity: 0, transform: "scale(1.5)" }, { opacity: 1, transform: "scale(1)", offset: 0.18 }, { opacity: 1, transform: "scale(1.04)", offset: 0.82 }, { opacity: 0, transform: "scale(1.15)" }], { duration: 800, easing: "ease-out" });
      this.shake = Math.max(this.shake, 14); this.chroma = Math.max(this.chroma, 10); this.flashFx(col === TONE.gold ? "#ffe9a8" : "#ff3a52");
      this.later(() => { this.cut.hidden = true; this.cut.innerHTML = ""; }, 800);
    }
    /** réplique d'un bot : machine à écrire avec glitch */
    say(bot, text) {
      const B = E.botChat && E.botChat.bots[bot], name = B ? B.name : bot, id = ++this.sayId || (this.sayId = 1);
      this.cap.hidden = false; this.cap.classList.remove("out");
      this.cap.innerHTML = `${B && B.img ? `<img src="${E.assetBase || ""}${B.img}">` : ""}<div><small>${E.esc(name)}</small><span></span></div>`;
      const sp = this.cap.querySelector("span"), G = "▒░#%&@$?/", chars = Array.from(text);
      let i = 0;
      const tick = () => {
        if (!this.alive || id !== this.sayId) return;
        if (i < chars.length) {
          const glitch = Math.random() < 0.16 && i > 0;
          sp.textContent = chars.slice(0, ++i).join("") + (glitch ? G[Math.floor(Math.random() * G.length)] : "");
          this.cap.classList.toggle("jit", glitch); this.later(tick, glitch ? 55 : 24);
        } else { sp.textContent = text; this.cap.classList.remove("jit"); this.later(() => { if (id === this.sayId) { this.cap.classList.add("out"); this.later(() => { if (id === this.sayId) this.cap.hidden = true; }, 350); } }, Math.max(1500, text.length * 45)); }
      };
      tick();
    }
    ff(on) { this.ffEl.hidden = !on; this.host.classList.toggle("ce-rew", on); }
    setProgress(f) { this.prog.style.transform = `scaleX(${Math.max(0, Math.min(1, f))})`; }
    setPlaying(on) { this.ppBtn.textContent = on ? "⏸" : "▶"; }
    // ---------------------------------------------------------------- particules + boucle
    initParticles() {
      const mk = (n, fgl) => Array.from({ length: n }, () => ({ a: rnd(0, 6.283), r: rnd(0.02, 0.7), v: rnd(0.02, 0.09), s: fgl ? rnd(1.4, 2.8) : rnd(0.6, 1.8), al: fgl ? rnd(0.25, 0.7) : rnd(0.15, 0.55) }));
      this.dustB = mk(110, false); this.dustF = mk(34, true);
    }
    drawDust(ctx, list, dt, mul) {
      const W = this.W, H = this.H, cx = W / 2, cy = H / 2, R = Math.hypot(W, H) / 2;
      for (const p of list) {
        const pr = p.r; p.r += (p.v + this.warp * 0.9 * p.v * 6) * dt * mul;
        if (p.r > 1.05) { p.r = rnd(0.01, 0.12); p.a = rnd(0, 6.283); }
        const x = cx + Math.cos(p.a) * p.r * R, y = cy + Math.sin(p.a) * p.r * R;
        ctx.globalAlpha = Math.min(1, p.al * (0.4 + p.r)); ctx.strokeStyle = ctx.fillStyle = "#fff";
        if (this.warp > 0.25) { ctx.lineWidth = p.s * (0.6 + p.r); ctx.beginPath(); ctx.moveTo(cx + Math.cos(p.a) * pr * R, cy + Math.sin(p.a) * pr * R); ctx.lineTo(x, y); ctx.stroke(); }
        else { ctx.beginPath(); ctx.arc(x, y, p.s * (0.5 + p.r), 0, 6.283); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
    }
    loop(now) {
      if (!this.alive) return;
      const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
      const b = this.bg.getContext("2d"), f = this.fg.getContext("2d");
      b.clearRect(0, 0, this.W, this.H); f.clearRect(0, 0, this.W, this.H);
      this.drawDust(b, this.dustB, dt, 1); this.drawDust(f, this.dustF, dt, 1.6);
      f.globalCompositeOperation = "lighter";
      this.burst = this.burst.filter((p) => (p.life -= dt) > 0);
      for (const p of this.burst) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.97; p.vy = p.vy * 0.97 + 120 * dt; f.globalAlpha = Math.max(0, p.life / p.max); f.fillStyle = p.c; f.shadowColor = p.c; f.shadowBlur = 8; f.fillRect(p.x, p.y, p.s, p.s); }
      f.globalCompositeOperation = "source-over"; f.shadowBlur = 0; f.globalAlpha = 1;
      this.warp *= Math.pow(0.12, dt); if (this.warp < 0.02) this.warp = 0;
      // shake amorti + aberration chromatique (le filtre SVG n'est actif que pendant l'impact : il coûte cher)
      this.shake *= Math.pow(0.004, dt); this.chroma *= Math.pow(0.01, dt);
      if (this.shake > 0.4) { const a = this.shake; this.shk.style.transform = `translate(${rnd(-a, a).toFixed(1)}px,${rnd(-a, a).toFixed(1)}px) rotate(${rnd(-a, a) * 0.05}deg)`; } else if (this.shk.style.transform) this.shk.style.transform = "";
      if (this.chroma > 0.5) { this.abr.setAttribute("dx", this.chroma.toFixed(1)); this.abb.setAttribute("dx", (-this.chroma).toFixed(1)); this.abb.setAttribute("dy", (this.chroma * 0.4).toFixed(1)); this.wrap.style.filter = "url(#ce-ab)"; this._ab = true; }
      else if (this._ab) { this.wrap.style.filter = ""; this._ab = false; }
      this.drift.style.transform = `rotateZ(${(Math.sin((now - this.t0) / 2300) * 1.4).toFixed(2)}deg)`;                 // respiration lente entre deux impacts
      this.raf = requestAnimationFrame((t) => this.loop(t));
    }
    destroy() { this.alive = false; cancelAnimationFrame(this.raf); this.timers.forEach(clearTimeout); window.removeEventListener("resize", this._rs); this.host.classList.remove("ce-stage"); this.host.innerHTML = ""; }
  }

  E.editFx = { Stage, TONE, fenMap, START };
})();
