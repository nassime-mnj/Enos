"use strict";
// CHESS EDIT STUDIO — MOTEUR DE RENDU TEMPS RÉEL (mobile) : l'échiquier passe en 3D (CSS3D, perspective 900 px), noir & blanc contrasté avec vignette ; seuls les halos, traînées
// et particules sont en couleur (vert = bon coup, cyan = brillant, rouge = gaffe / échec). Caméra qui plonge vers la case d'arrivée (cubic-bezier(0.16,1,0.3,1), ±8°),
// poussière cosmique (2 canvas : fond + avant-plan) qui accélère au zoom, shake amorti + aberration chromatique RGB (filtre SVG) + flash 60 ms sur chaque impact,
// cutscenes procédurales (« THE ROOK ! », promotion, boss) et répliques des bots en machine à écrire glitchée.
(() => {
  const E = window.ENOS;
  const TONE = { green: "#58D628", cyan: "#1CE8E8", red: "#FF2A2A", gold: "#ffd24a", blue: "#268BFF", neon: "#38FF14" };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pieceUrl = (p, raw) => (!raw && SKIN[p]) || `${E.assetBase || ""}img/chess/${p === p.toUpperCase() ? "w" : "b"}${p.toLowerCase()}.png`;
  const fenMap = (fen) => { const m = {}; fen.split(" ")[0].split("/").forEach((r, y) => { let x = 0; for (const c of r) { if (/\d/.test(c)) x += +c; else m[String.fromCharCode(97 + x++) + (8 - y)] = c; } }); return m; };
  // LOOKS : etalonnage des plans (rouge noir, galaxie, acier neon, aura turquoise, noir et blanc) ; chacun recolore l'echiquier, la vignette et les particules
  const LOOKS = {
    classic: { name: "Classique", l: "#EBECD0", d: "#739552", hi: "#1CE8E8", dust: "#fff", vig: "#000" },
    zavee: { name: "Contraste", l: "#EBEBEB", d: "#767676", hi: "#1CE8E8", dust: "#fff", vig: "#000" },
    mono: { name: "Noir & blanc", l: "#c9c9c9", d: "#3a3a3a", hi: "#2bff88", dust: "#fff", vig: "#000" },
    noir: { name: "Rouge noir", l: "#b3121c", d: "#2c070b", hi: "#ff2438", dust: "#ff9aa4", vig: "#1c0000" },
    galaxy: { name: "Galaxie", l: "rgba(238,230,255,.93)", d: "rgba(104,56,176,.62)", hi: "#2fe8cc", dust: "#fff", vig: "#05040c" },
    steel: { name: "Acier neon", l: "#a8a8a8", d: "#6a6a6a", hi: "#ff3b52", dust: "#fff", vig: "#161616" },
    blood: { name: "Sang", l: "#8f1217", d: "#1b0406", hi: "#ff2a2a", dust: "#ff8a6a", vig: "#2a0000" },
    fog: { name: "Brume", l: "#8d9097", d: "#26282c", hi: "#ffffff", dust: "#d5d9df", vig: "#040405" },
    spot: { name: "Projecteur", l: "#b8b8bd", d: "#222226", hi: "#ffd9a0", dust: "#fff2d8", vig: "#000000" },
    neon: { name: "Néon violet", l: "#f1e6ff", d: "#6b2fd1", hi: "#ff5cf0", dust: "#d9a8ff", vig: "#0a0216" },
    aura: { name: "Aura turquoise", l: "#14605a", d: "#082624", hi: "#34f5d8", dust: "#aefcf2", vig: "#010d0c" },
  };
  // DIRECTIONS ARTISTIQUES : chaque edit en reçoit une (au hasard ou au choix) -> ambiance, brouillard, projecteur, grain, braises, comportement de la caméra et intro différents
  const DIRECTIONS = {
    blood: { name: "Sang", look: "blood", fog: 0.25, fogColor: "#7a0000", spot: 0.35, grain: 0.22, embers: true, cam: { rx: [14, 24], roll: 7, sway: 2.4, s: [1.05, 1.4] }, intro: "slash", bars: true },
    fog: { name: "Brume", look: "fog", fog: 0.6, fogColor: "#a3a8b0", spot: 0.55, grain: 0.3, embers: false, cam: { rx: [10, 20], roll: 4, sway: 1.8, s: [1.0, 1.3] }, intro: "spot", bars: false },
    spot: { name: "Projecteur", look: "spot", fog: 0.3, fogColor: "#6a6a70", spot: 0.9, grain: 0.2, embers: false, cam: { rx: [12, 22], roll: 5, sway: 1.4, s: [1.1, 1.5] }, intro: "spot", bars: true },
    neon: { name: "Néon violet", look: "neon", fog: 0.12, fogColor: "#5b1fb5", spot: 0.2, grain: 0.12, embers: false, cam: { rx: [14, 26], roll: 8, sway: 3, s: [1.05, 1.45] }, intro: "versus", bars: false },
    galaxy: { name: "Galaxie", look: "galaxy", fog: 0.15, fogColor: "#3a2a7a", spot: 0.1, grain: 0.1, embers: false, cam: { rx: [16, 28], roll: 9, sway: 3.4, s: [1.0, 1.4] }, intro: "versus", bars: false },
    aura: { name: "Aura", look: "aura", fog: 0.2, fogColor: "#0a5a50", spot: 0.3, grain: 0.14, embers: false, cam: { rx: [12, 22], roll: 6, sway: 2.4, s: [1.05, 1.4] }, intro: "spot", bars: true },
  };
  // Style « edit YouTube Shorts » : plateau clair ultra-contrasté partout (cases #EBEBEB / #767676), ambiances discrètes, pas de bandes ni d'intro
  Object.values(DIRECTIONS).forEach((d) => { d.look = "zavee"; d.fog *= 0.2; d.spot *= 0.25; d.grain *= 0.4; d.bars = false; d.embers = false; d.cam = { rx: [8, 14], roll: 15, sway: 1, s: [1.8, 2.8] }; });
  const esc2 = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  const SKIN = {}; let skinBusy = false;
  /** pièces « détourées » : contour noir de 2 px (blanches) / reflet interne en haut (noires), préparés UNE fois en canvas (aucun filtre CSS par pièce -> bien moins cher) */
  function buildSkins(done) {
    if (skinBusy) return; skinBusy = true;
    const codes = "KQRBNPkqrbnpmegsMEGS".split(""); let left = codes.length;
    codes.forEach((ch) => {
      const im = new Image(); im.onload = () => {
        try {
          const N = 160, pad = 6, c = document.createElement("canvas"); c.width = c.height = N; const g = c.getContext("2d"), w = N - pad * 2, white = ch === ch.toUpperCase();
          for (let a = 0; a < 16; a++) { const t = (a / 16) * 6.2832; g.drawImage(im, pad + Math.cos(t) * 3, pad + Math.sin(t) * 3 + 1, w, w); }
          g.globalCompositeOperation = "source-in"; g.fillStyle = "#000"; g.fillRect(0, 0, N, N); g.globalCompositeOperation = "source-over";           // silhouette noire élargie = contour
          g.drawImage(im, pad, pad + 1, w, w);
          if (!white) { g.globalCompositeOperation = "source-atop"; const gr = g.createLinearGradient(0, pad, 0, N * 0.55); gr.addColorStop(0, "rgba(255,255,255,.38)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, N, N * 0.55); g.globalCompositeOperation = "source-over"; }
          SKIN[ch] = c.toDataURL("image/png");
        } catch (e) { /* canvas indisponible : on garde les PNG */ }
        if (--left === 0 && done) done();
      }; im.onerror = () => { if (--left === 0 && done) done(); };
      im.src = pieceUrl(ch, true);
    });
  }
  class Stage {
    /** host : élément plein écran (dans #app). opts : {flip, title, onClose, onToggle}. */
    constructor(host, opts) {
      this.o = opts || {}; this.host = host; this.flip = !!this.o.flip; this.timers = []; this.alive = true;
      this.shake = 0; this.chroma = 0; this.warp = 0; this.ts = 1; this.smoke = []; this.mb = { x: 0, y: 0, k: 0, t0: 0, ms: 1 }; this.outl = {}; this.burst = []; this.t0 = performance.now(); this.pieces = {}; this.ghosts = 0; this.rz = 0;
      host.classList.add("ce-stage", "ce-hdr");
      host.innerHTML = `<canvas class="ce-bg"></canvas>
        <svg width="0" height="0" style="position:absolute"><filter id="ce-ab" x="-3%" y="-3%" width="106%" height="106%" color-interpolation-filters="sRGB">
          <feColorMatrix in="SourceGraphic" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/><feOffset in="r" dx="0" dy="0" result="ro" class="ce-abr"/>
          <feColorMatrix in="SourceGraphic" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>
          <feColorMatrix in="SourceGraphic" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/><feOffset in="b" dx="0" dy="0" result="bo" class="ce-abb"/>
          <feBlend in="ro" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="bo" mode="screen"/></filter>
          <filter id="ce-mb" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur class="ce-mbg" stdDeviation="0 0"/></filter>
          <filter id="ce-pm" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur class="ce-pmg" stdDeviation="0 0"/></filter>
          <filter id="ce-sh" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.010 0.014" numOctaves="1" seed="3" result="n"/><feDisplacementMap class="ce-shd" in="SourceGraphic" in2="n" scale="0" xChannelSelector="R" yChannelSelector="G"/></filter></svg>
        <div class="ce-fxwrap"><div class="ce-shake"><div class="ce-persp"><div class="ce-drift"><div class="ce-cam"><div class="ce-board"></div><div class="ce-pcs"></div><div class="ce-fxl"></div></div></div></div></div></div>
        <canvas class="ce-fg"></canvas><div class="ce-dof"></div><div class="ce-vig"></div><div class="ce-flash"></div><div class="ce-ff" hidden>▶▶ ×8</div>
        <div class="ce-cut" hidden></div><div class="ce-cap" hidden></div><div class="ce-fog"><i></i><i></i><i></i></div><div class="ce-spot"></div><div class="ce-light"></div><div class="ce-grain"></div><div class="ce-bars"><i></i><i></i></div><div class="ce-label" hidden></div><div class="ce-eval" hidden><i class="ce-ef"></i><b class="ce-en">0.0</b></div><div class="ce-open" hidden></div><div class="ce-stat" hidden></div><div class="ce-intro" hidden></div><div class="ce-result" hidden></div>
        <div class="ce-hud"><button class="ce-x" aria-label="Fermer">✕</button><span class="ce-title"></span><button class="ce-pp" aria-label="Lecture / pause">⏸</button></div><div class="ce-prog"><i></i></div>`;
      const q = (s) => host.querySelector(s);
      this.bg = q(".ce-bg"); this.fg = q(".ce-fg"); this.wrap = q(".ce-fxwrap"); this.shk = q(".ce-shake"); this.drift = q(".ce-drift"); this.persp = q(".ce-persp"); this.cam = q(".ce-cam"); this.board = q(".ce-board"); this.pcs = q(".ce-pcs"); this.fxl = q(".ce-fxl");
      this.flash = q(".ce-flash"); this.cut = q(".ce-cut"); this.cap = q(".ce-cap"); this.ffEl = q(".ce-ff"); this.label = q(".ce-label"); this.evalEl = q(".ce-eval"); this.evF = q(".ce-ef"); this.evN = q(".ce-en"); this.openEl = q(".ce-open"); this.statEl = q(".ce-stat"); this.introEl = q(".ce-intro"); this.resEl = q(".ce-result"); this.prog = q(".ce-prog i"); this.dofEl = q(".ce-dof"); this.abr = q(".ce-abr"); this.abb = q(".ce-abb"); this.mbg = q(".ce-mbg"); this.pmg = q(".ce-pmg"); this.shd = q(".ce-shd"); this.fogEl = q(".ce-fog"); this.spotEl = q(".ce-spot"); this.lightEl = q(".ce-light"); this.barsEl = q(".ce-bars");
      q(".ce-title").textContent = this.o.title || ""; q(".ce-x").onclick = () => this.o.onClose && this.o.onClose(); q(".ce-pp").onclick = () => this.o.onToggle && this.o.onToggle();
      this.ppBtn = q(".ce-pp");
      this.setQuality(this.o.quality || "auto"); this.pm = null; this.shk2 = 0; this.frames = []; this.fps = 60;
      this.resize(); this.buildBoard(); this.setLook(this.o.look || "mono"); this.initParticles(); this.setFen(START); this.setDirection(this.o.direction || "neon");
      this.camTo({ rx: 10, rz: 0, s: 1.15 }, 0);                                                         // vue normale : plateau bord à bord, légèrement agrandi
      buildSkins(() => { Object.values(this.pieces).forEach((el) => { el.src = pieceUrl(el._p); }); });
      this.raf = requestAnimationFrame((t) => this.loop(t)); this.last = performance.now();
      this._rs = () => this.resize(); window.addEventListener("resize", this._rs);
    }
    later(fn, ms) { const id = setTimeout(() => { if (this.alive) fn(); }, ms); this.timers.push(id); return id; }
    resize() {
      const W = this.host.clientWidth || innerWidth, H = this.host.clientHeight || innerHeight, S = Math.floor(Math.min(W, H * 0.98));                                                           // 100 % de la largeur (bord à bord)
      this.S = S; this.cell = S / 8; this.W = W; this.H = H;
      [this.board, this.pcs, this.fxl].forEach((e) => { e.style.width = e.style.height = S + "px"; });
      this.cam.style.width = this.cam.style.height = S + "px"; this.cam.style.left = (W - S) / 2 + "px"; this.cam.style.top = (H - S) / 2 + "px";
      const d = this.ql >= 2 ? Math.min(devicePixelRatio || 1, 1.5) : 1;                                // canvas à 1× sur téléphone / en qualité réduite : 2× moins de pixels à remplir
      [this.bg, this.fg].forEach((c) => { c.width = Math.round(W * d); c.height = Math.round(H * d); c.style.width = W + "px"; c.style.height = H + "px"; c.getContext("2d").setTransform(d, 0, 0, d, 0, 0); });
      Object.values(this.pieces).forEach((el) => this.place(el, el._sq));
    }
    /** qualité des effets : "auto" (démarre en normal sur téléphone, max sur PC, et BAISSE toute seule si l'image saccade), "light", "normal", "max" */
    setQuality(q) {
      this.qAuto = q === "auto"; const touch = (navigator.maxTouchPoints || 0) > 0 && Math.min(screen.width, screen.height) < 700;
      this.ql = q === "light" ? 0 : q === "normal" ? 1 : q === "max" ? 2 : touch ? 1 : 2; this.applyQuality();
    }
    applyQuality() {
      const l = this.ql, h = this.host; ["ce-q0", "ce-q1", "ce-q2"].forEach((c) => h.classList.toggle(c, c === "ce-q" + l));
      this.fx = { chroma: l >= 1, mblur: l >= 1, pblur: l >= 1, shock: l >= 2, fog: l >= 1, grain: l >= 1, glow: l >= 1, part: [0.3, 0.7, 1][l], smoke: [0.35, 0.7, 1][l] };
      if (this.dustB) { this.initParticles(); this.resize(); }
    }
    /** direction artistique : ambiance, brouillard, projecteur, grain, braises, personnalité de la caméra */
    setDirection(id) {
      const D = DIRECTIONS[id] || DIRECTIONS.neon; this.dir = D; this.dirId = DIRECTIONS[id] ? id : "neon";
      this.setLook(D.look); const h = this.host; Object.keys(DIRECTIONS).forEach((k) => h.classList.toggle("ce-dir-" + k, k === this.dirId));
      this.fogEl.style.setProperty("--fa", D.fog); this.fogEl.style.setProperty("--fc", D.fogColor); this.spotEl.style.setProperty("--sa", D.spot); this.host.style.setProperty("--ga", D.grain);
      this.spotAt(0.5, 0.5);
    }
    /** projecteur : zone éclairée centrée en (fx, fy) en fraction de l'écran */
    focusSpot(sq) { const r = this.host.getBoundingClientRect(), q = this.sq[sq].getBoundingClientRect(); this.spotAt((q.left - r.left + q.width / 2) / r.width, (q.top - r.top + q.height / 2) / r.height); }
    spotAt(fx, fy) { this.spotEl.style.setProperty("--sx", (fx * 100).toFixed(1) + "%"); this.spotEl.style.setProperty("--sy", (fy * 100).toFixed(1) + "%"); }
    /** bandes de cinéma qui entrent / sortent */
    bars(on) { this.barsEl.classList.toggle("on", !!on && !!(this.dir && this.dir.bars)); }
    xy(sq) { let c = sq.charCodeAt(0) - 97, r = 8 - +sq[1]; if (this.flip) { c = 7 - c; r = 7 - r; } return { x: c * this.cell, y: r * this.cell, c, r }; }
    buildBoard() {
      this.board.innerHTML = ""; this.sq = {}; this.sqList = [];
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const d = document.createElement("i"); d.style.cssText = `left:${c * 12.5}%;top:${r * 12.5}%;background:${(r + c) % 2 ? "#3a3a3a" : "#c9c9c9"}`;
        this.board.appendChild(d); this.sqList.push({ el: d, par: (r + c) % 2 }); this.sq[this.flip ? String.fromCharCode(97 + 7 - c) + (r + 1) : String.fromCharCode(97 + c) + (8 - r)] = d;
      }
    }
    place(el, sq) { const p = this.xy(sq); el._sq = sq; el.style.width = el.style.height = this.cell + "px"; el.style.transform = `translate(${p.x}px,${p.y}px)`; }
    mkPiece(ch, sq) { const el = document.createElement("img"); el.src = pieceUrl(ch); el._p = ch; const spx = { m: "mk", e: "rei", g: "barrel", s: "army" }[ch.toLowerCase()]; if (spx) el.dataset.sp = spx; el.dataset.c = ch === ch.toUpperCase() ? "w" : "b"; el.draggable = false; this.pcs.appendChild(el); this.place(el, sq); this.pieces[sq] = el; return el; }
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
      if (ev.cheat === "twist") { if (fast) { this.setFen(ev.fen); return; } return this.twist(ev); }
      const pre = this.pieces[ev.from];
      if (!pre) { this.setFen(ev.fen); return; }
      let appear = false;
      const dur = ev.dur || (fast ? 70 : 300), slow = dur > 600, tone = TONE[ev.tone] || TONE.green, a = this.xy(ev.from), b = this.xy(ev.to);
      const cap = this.pieces[ev.to];
      if (cap) { if (fast) { cap.style.transition = "opacity .2s"; cap.style.opacity = "0"; const c2 = cap; this.later(() => c2.remove(), 220); } else this.dissolve(cap, ev.to, dur > 800); delete this.pieces[ev.to]; }
      delete this.pieces[ev.from]; this.pieces[ev.to] = pre; pre._sq = ev.to;
      pre.style.transition = `transform ${dur}ms ${slow ? "cubic-bezier(.35,.05,.2,1)" : dur <= 120 ? "cubic-bezier(0,.9,.2,1)" : "cubic-bezier(.2,.9,.2,1)"}`; pre.style.zIndex = 3; this.later(() => { pre.style.zIndex = ""; }, dur + 50);
      pre.style.transform = `translate(${b.x}px,${b.y}px)`;
      if (ev.piece === "k" && Math.abs(a.c - b.c) === 2) {                                           // roque : la tour suit
        const row = ev.from[1], short = ev.to[0] > ev.from[0], rf = (short ? "h" : "a") + row, rt = (short ? "f" : "d") + row, rk = this.pieces[rf];
        if (rk) { delete this.pieces[rf]; this.pieces[rt] = rk; rk._sq = rt; rk.style.transition = `transform ${dur}ms cubic-bezier(.2,.9,.2,1)`; const p = this.xy(rt); rk.style.transform = `translate(${p.x}px,${p.y}px)`; }
      }
      this.later(() => { const target = fenMap(ev.fen); Object.keys(this.pieces).forEach((s) => { if (target[s] !== this.pieces[s]._p) { if (s === ev.to && target[s]) { this.pieces[s]._p = target[s]; this.pieces[s].src = pieceUrl(target[s]); } else { this.pieces[s].remove(); delete this.pieces[s]; } } });
        Object.keys(target).forEach((s) => { if (!this.pieces[s]) this.mkPiece(target[s], s); }); }, dur + 20);
      if (appear) { pre.classList.add("ce-appear"); this.later(() => pre.classList.remove("ce-appear"), 520); }
      if (!fast) { this.highlight(ev); }
      if (!fast && this.fx && this.fx.pblur) {                                                           // FLOU DE DÉPLACEMENT : la pièce est floutée dans le sens du mouvement (plus d'images rémanentes)
        const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || 1;
        this.pm = { el: pre, ux: Math.abs(dx) / dist, uy: Math.abs(dy) / dist, amp: Math.min(0.55 * this.cell, (dist / Math.max(0.25, dur / 1000)) * 0.034), t0: performance.now(), ms: dur };
        pre.style.filter = "url(#ce-pm)";
      }
    }
    /** AAA : la pièce laisse un fantôme qui se découpe en tranches RVB et s'évapore (ne coûte que de l'opacité / transform : composé par le GPU) */
    vanish(pre, sq) {
      const g = pre.cloneNode(); g.className = "ce-vanish"; g.style.cssText = pre.style.cssText; g.style.transition = "none"; g.style.filter = ""; this.pcs.appendChild(g); this.later(() => g.remove(), 460);
      const p = this.xy(sq), rift = document.createElement("div"); rift.className = "ce-rift"; rift.style.cssText = `left:${p.x}px;top:${p.y}px;width:${this.cell}px;height:${this.cell}px`; this.fxl.appendChild(rift); this.later(() => rift.remove(), 600);
    }
    /** AAA : tampon « COUP ILLÉGAL » qui claque, scanlines, éclair rouge (sirène) */
    stamp(text, color, ms) {
      ms = ms || 1500; const el = document.createElement("div"); el.className = "ce-stampfx"; el.textContent = text; el.style.setProperty("--sc", color || "#ff3b52"); el.style.animationDuration = ms + "ms";
      if (text.length > 16) { el.style.fontSize = "clamp(15px,5vw,28px)"; el.style.whiteSpace = "normal"; el.style.width = "84%"; el.style.textAlign = "center"; }
      this.host.appendChild(el); this.later(() => el.remove(), ms + 100);
      this.host.classList.add("ce-siren"); this.later(() => this.host.classList.remove("ce-siren"), 900); this.flashFx(color || "#ff3b52");
    }
    /** AAA : trait de lumière anamorphique horizontal (flare de cinéma) sur une case */
    streak(sq, color) {
      const p = this.xy(sq), el = document.createElement("div"); el.className = "ce-streak"; el.style.cssText = `left:${-this.S * 0.2}px;top:${p.y + this.cell / 2 - 3}px;width:${this.S * 1.4}px;--c:${color || "#9fe9ff"}`;
      this.fxl.appendChild(el); this.later(() => el.remove(), 700);
    }
    /** AAA : lignes de vitesse (manga) rayonnant depuis une case : dessinées sur le canvas avant, quelques centaines de ms */
    speedLines(sq, ms) { const p = this.xy(sq), r = this.host.getBoundingClientRect(), q = this.sq[sq].getBoundingClientRect(); this.sl = { x: q.left - r.left + q.width / 2, y: q.top - r.top + q.height / 2, t0: performance.now(), ms: ms || 380, seed: Math.random() * 6.28 }; }
    /** AAA : ralenti (rampe de temps) : le temps des particules passe à k puis revient en douceur */
    rampSlow(ms, k) { this.ts = k || 0.3; this.later(() => { const t0 = performance.now(), up = () => { if (!this.alive) return; const f = Math.min(1, (performance.now() - t0) / 450); this.ts = (k || 0.3) + (1 - (k || 0.3)) * f; if (f < 1) requestAnimationFrame(up); }; up(); }, ms || 350); }
    /** PLOT TWIST : l'échiquier fait un 180° (les pièces restent droites) : ChatGPT a « pris notre position » et déclare avoir gagné par checkmate */
    twist(ev) {
      const dur = 1400, imgs = [...this.pcs.querySelectorAll("img")], base = this.camNow || { rx: 10, rz: 0, s: 1.15 };
      this.camTo({ rx: base.rx, rz: 180, s: Math.min(base.s, 1.0) }, dur);                                // plateau : rotateZ 180° autour de son centre
      imgs.forEach((i) => { const p = this.xy(i._sq), t = `translate(${p.x}px,${p.y}px)`; try { i.animate([{ transform: t + " rotate(0deg)" }, { transform: t + " rotate(-180deg)" }], { duration: dur, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" }); } catch (e) { /* ancien WebView */ } });   // translate AVANT rotate : la pièce tourne sur elle-même
      this.shake = Math.max(this.shake, 8); this.chroma = Math.max(this.chroma, 6); this.rampSlow(200, 0.4);
      this.later(() => {
        this.flip = !this.flip;
        this.sqList.forEach((q, i) => { const c = i & 7, r = i >> 3; this.sq[this.flip ? String.fromCharCode(97 + 7 - c) + (r + 1) : String.fromCharCode(97 + c) + (8 - r)] = q.el; });
        imgs.forEach((i) => i.getAnimations().forEach((a) => a.cancel()));
        this.camTo({ rx: base.rx, rz: 0, s: base.s }, 0);
        Object.values(this.pieces).forEach((el) => { el.style.transition = "none"; this.place(el, el._sq); });
        this.flashFx("#ffd666", 0.6, 90); this.shake = Math.max(this.shake, 14);
        this.stamp("CHATGPT A GAGNÉ PAR CHECKMATE", "#ffd666", 3200);
        if (E.vibrate) E.vibrate([40, 30, 90]);
      }, dur + 30);
    }
    /** IMPACT FRAME : une ou deux images en négatif (puis un fond noir au point blanc au centre) comme dans les anime */
    impactFrame(dark) {
      const f = document.createElement("div"); f.className = "ce-impact" + (dark ? " k" : ""); this.host.appendChild(f);
      f.animate([{ opacity: 1 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }], { duration: 110, easing: "steps(2,end)" }); this.later(() => f.remove(), 130);
      this.shake = Math.max(this.shake, 12);
    }
    /** VARIANTES — pose d'une pièce : elle tombe du ciel ; BARIL DU FOU : il DÉCOLLE au-dessus de l'échiquier en tournoyant puis ATTERRIT ; ARMÉE : les pions se déploient un à un ; MÉGA CHEVALIER : atterrissage + écrasement du 3×3 */
    drop(ev) {
      const to = ev.to, ch = ev.dropPiece || fenMap(ev.fen)[to];
      if (!ch) { this.setFen(ev.fen); return; }
      const old = this.pieces[to]; if (old) { old.remove(); delete this.pieces[to]; }
      const p = this.xy(to), c = this.cell, sp = ev.special, tone = sp === "mk" ? "255,138,31" : sp === "rei" ? "58,230,255" : sp === "barrel" ? "107,220,80" : sp === "army" ? "176,74,255" : "255,255,255";
      const ring = (sx, sy, delay) => { const r = document.createElement("div"); r.className = "ce-ring"; r.style.cssText = `left:${sx + c / 2}px;top:${sy + c / 2}px;border-color:rgb(${tone});box-shadow:0 0 18px rgb(${tone});animation-delay:${delay || 0}ms`; this.fxl.appendChild(r); this.later(() => r.remove(), 1200 + (delay || 0)); };
      const spawn = (sq, ms, delay) => {                                                           // pose directe : chute avec rebond
        const q = this.xy(sq), el = this.mkPiece(fenMap(ev.fen)[sq] || ch, sq); el.style.transition = "none"; el.style.opacity = "0";
        this.later(() => { el.style.opacity = "1"; el.animate([{ translate: "0 -320%", scale: "2.1", opacity: 0 }, { translate: "0 0", scale: "1", opacity: 1, offset: 0.7 }, { translate: "0 -8%", scale: "1.06", opacity: 1, offset: 0.85 }, { translate: "0 0", scale: "1", opacity: 1 }], { duration: ms, easing: "cubic-bezier(.3,0,.3,1)" }); this.later(() => { ring(q.x, q.y, 0); this.shake = Math.max(this.shake, 6); }, ms * 0.7); }, delay || 0);
        return el;
      };
      if (sp === "barrel") {                                                                       // le baril décolle, tournoie au-dessus du plateau, puis atterrit
        const el = this.mkPiece(ch, to); el.style.transition = "none"; el.style.opacity = "0";
        const fly = document.createElement("img"), S = this.S, sx = S / 2 - c / 2, sy = S + c * 1.2, apexY = -c * 2.4, midX = (sx + p.x) / 2;
        fly.src = el.src; fly.className = "ce-fly"; fly.style.cssText = `left:0;top:0;width:${c}px;height:${c}px;filter:drop-shadow(0 0 12px rgb(${tone})) drop-shadow(0 0 26px rgb(${tone}))`; this.fxl.appendChild(fly);
        const shadow = document.createElement("div"); shadow.className = "ce-fshadow"; shadow.style.cssText = `left:${p.x}px;top:${p.y + c * 0.7}px;width:${c}px;height:${c * 0.35}px`; this.fxl.appendChild(shadow);
        shadow.animate([{ transform: "scale(.2)", opacity: 0 }, { transform: "scale(.6)", opacity: 0.25, offset: 0.55 }, { transform: "scale(1.15)", opacity: 0.6 }], { duration: 1150, easing: "ease-in", fill: "forwards" });
        const anim = fly.animate([
          { transform: `translate(${sx}px,${sy}px) scale(.5) rotate(0deg)`, opacity: 0 },
          { transform: `translate(${sx}px,${sy - c * 0.8}px) scale(.9) rotate(120deg)`, opacity: 1, offset: 0.1 },
          { transform: `translate(${midX}px,${apexY}px) scale(2.2) rotate(560deg)`, opacity: 1, offset: 0.5 },
          { transform: `translate(${p.x + (midX - p.x) * 0.15}px,${p.y - c * 1.6}px) scale(1.6) rotate(960deg)`, opacity: 1, offset: 0.82 },
          { transform: `translate(${p.x}px,${p.y}px) scale(1) rotate(1080deg)`, opacity: 1 }], { duration: 1150, easing: "cubic-bezier(.4,.1,.3,1)", fill: "forwards" });
        this.warp = Math.max(this.warp, 0.25);
        anim.onfinish = () => { fly.remove(); shadow.remove(); el.style.opacity = "1"; el.animate([{ scale: "1.35 0.7" }, { scale: "0.92 1.1", offset: 0.4 }, { scale: "1 1" }], { duration: 380, easing: "ease-out" }); ring(p.x, p.y, 0); ring(p.x, p.y, 140); this.shake = Math.max(this.shake, 14); this.explode({ to }, "#6bdc50", 22); this.flashFx("#d7ffcf"); if (E.vibrate) E.vibrate([30, 20, 60]); };
        return;
      }
      if (sp === "army") { (ev.filled && ev.filled.length ? ev.filled : [to]).forEach((sq, k) => spawn(sq, 420, k * 90)); this.later(() => { this.shake = Math.max(this.shake, 16); this.flashFx("#e7caff"); }, 400 + (ev.filled || [1]).length * 90); return; }
      const el = spawn(to, 480, 0);
      if (sp === "mk") {                                                                           // Méga Chevalier : atterrissage, onde de choc puis écrasement du 3×3
        this.later(() => { this.shake = Math.max(this.shake, 30); this.chroma = Math.max(this.chroma, 12); this.flashFx("#ffd9a0"); ring(p.x, p.y, 0); ring(p.x, p.y, 120); ring(p.x, p.y, 260); this.shockwave(1); (ev.smash || []).forEach((sq, k) => this.later(() => this.dissolveAt(sq), 80 + k * 60)); }, 480);
      } else if (sp === "rei") this.later(() => { this.electric(p); this.flashFx("#c9faff"); }, 480);
    }
    /** une pièce disparaît en cendres (écrasement, élimination) */
    dissolveAt(sq) { const el = this.pieces[sq]; if (!el) return; delete this.pieces[sq]; this.dissolve(el, sq, true); }
    /** synchronise la scène avec une position : les pièces qui ont disparu partent en cendres (écrasements, joueur éliminé), les manquantes apparaissent */
    syncFenFx(fen) {
      const target = fenMap(fen);
      Object.keys(this.pieces).forEach((sq) => { if (target[sq] !== this.pieces[sq]._p) { if (target[sq]) { this.pieces[sq]._p = target[sq]; this.pieces[sq].src = pieceUrl(target[sq]); } else this.dissolveAt(sq); } });
      Object.keys(target).forEach((sq) => { if (!this.pieces[sq]) this.mkPiece(target[sq], sq); });
      this.fen = fen;
    }
    /** cases de départ et d'arrivée allumées (orange ; cyan pour un coup brillant ; rouge pour une gaffe) */
    highlight(ev) {
      (this.hl || []).forEach((e) => e.remove()); this.hl = []; if (!ev.from) ev = { ...ev, from: ev.to };
      const col = ev.key === "brilliant" ? "0,242,254" : ev.key === "blunder" ? "255,42,68" : "255,150,40";
      [ev.from, ev.to].forEach((sq, i) => {
        const p = this.xy(sq), d = document.createElement("div"); d.className = "ce-hl";
        d.style.cssText = `left:${p.x}px;top:${p.y}px;width:${this.cell}px;height:${this.cell}px;background:rgba(${col},${i ? 0.5 : 0.3});box-shadow:0 0 ${this.cell * 0.5}px rgba(${col},.8)`;
        this.fxl.prepend(d); this.hl.push(d);
      });
    }
    // ---------------------------------------------------------------- caméra
    camTo(c, ms, col, row) {
      const s = c.s, rx = c.rx, rz = c.rz; this.rz = rz; this.camNow = { rx, rz, s };
      let tx = 0, ty = 0;
      if (col != null) {
        let dx = (col - 3.5) * this.cell, dy = (row - 3.5) * this.cell; const a = (rz * Math.PI) / 180;
        const x2 = dx * Math.cos(a) - dy * Math.sin(a), y2 = dx * Math.sin(a) + dy * Math.cos(a);
        tx = -x2 * s * 0.75; ty = -y2 * s * Math.cos((rx * Math.PI) / 180) * 0.75;
      }
      if (ms > 120 && this.prevCam) { const dx = tx - this.prevCam.tx, dy = ty - this.prevCam.ty, mag = Math.hypot(dx, dy) + Math.abs(s - this.prevCam.s) * this.cell * 2.2; this.mb = { x: dx / (Math.hypot(dx, dy) || 1), y: dy / (Math.hypot(dx, dy) || 1), k: Math.min(7, mag / 55), t0: performance.now(), ms: Math.min(ms, 900) }; }
      this.prevCam = { tx, ty, s };
      this.cam.style.transition = ms ? `transform ${ms}ms cubic-bezier(0.16,1,0.3,1)` : "none";
      this.cam.style.transform = `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) rotateX(${rx}deg) rotateZ(${rz}deg) scale(${s})`;
    }
    // ---------------------------------------------------------------- impacts
    /** ev : événement ; power 0..1 (force de l'impact) */
    hit(ev, power) {
      const tone = TONE[ev.tone] || TONE.green, p = this.xy(ev.to), key = ev.key, big = ev.lvl >= 3 || key === "brilliant" || ev.kind === "drop", heavy = big || ev.fx === "BOSS_AWAKENING" || ev.fx === "PROMOTION_CUTSCENE";
      // ---- CAMÉRA : à chaque impact elle ZOOME (×1,8 à ×2,8) sur la case d'arrivée et s'INCLINE brusquement (rotateZ −12° … +15°) ; les pièces, elles, restent droites
      const cm = (this.dir && this.dir.cam) || { rx: [8, 14], s: [1.8, 2.8] }, s = cm.s[0] + (cm.s[1] - cm.s[0]) * Math.min(1, power), rx = rnd(cm.rx[0], cm.rx[1]), rz = Math.random() < 0.45 ? -rnd(6, 12) : rnd(8, 15);
      clearTimeout(this._camRet); this.camTo({ rx, rz, s }, 150, p.c, p.r); this.warp = Math.max(this.warp, 0.1 + power * 0.2);
      this._camRet = setTimeout(() => { if (this.alive) this.camTo({ rx: 10, rz: 0, s: 1.15 }, 480); }, Math.max(560, (ev.freeze || 0) * 700 + 300));
      if (ev.shot === "macro") this.dof(900);
      if (ev.shot === "hero" && !ev.cut) this.later(() => this.hero(ev), 300);
      // ---- éclairage de couleur : case allumée + teinte plein écran (rouge : gaffe / échec / mat ; cyan + quadrillage laser : brillant)
      const halo = document.createElement("div"); halo.className = "ce-halo"; halo.style.cssText = `left:${p.x - this.cell}px;top:${p.y - this.cell}px;width:${this.cell * 3}px;height:${this.cell * 3}px;background:radial-gradient(circle,${tone} 0%,${tone}88 28%,transparent 68%)`;
      this.fxl.appendChild(halo); this.later(() => halo.remove(), 900);
      if (this.lit) this.lit.remove();
      this.lit = document.createElement("div"); this.lit.className = "ce-lit"; this.lit.style.cssText = `left:${p.x}px;top:${p.y}px;width:${this.cell}px;height:${this.cell}px;box-shadow:0 0 ${this.cell * 0.6}px ${tone},inset 0 0 ${this.cell * 0.4}px ${tone};border-color:${tone};background:${tone}66`;
      this.fxl.appendChild(this.lit);
      if (key === "blunder" || ev.check || ev.mate || (ev.fx === "BLUNDER_RED")) this.tint("rgba(255,20,20,.35)", 900);
      if (key === "brilliant") { this.laser(ev.kind === "drop" ? "#38FF14" : "#1CE8E8", 1300); this.tint("rgba(28,232,232,.16)", 700); }
      // ---- IMPACT : flash blanc (0,45 pendant 45 ms), secousse haute fréquence ±18 px amortie sur ~180 ms, aberration chromatique, lignes radiales (flou radial)
      this.shake = Math.max(this.shake, 18); this.chroma = Math.max(this.chroma, 4 + power * 8); this.flashFx(key === "blunder" ? "#ff1a3c" : "#fff", 0.45, 45);
      if (big || power > 0.55) this.speedLines(ev.to, 260);
      if (big || (ev.captured && "rq".includes(ev.captured))) this.streak(ev.to, key === "brilliant" ? "#7ff6ff" : "#ffe9a8");
      if (ev.captured || heavy || power > 0.7) this.later(() => this.explode(ev, tone, ev.captured ? 34 : 18), 90);
      if (E.vibrate && heavy) E.vibrate(ev.kind === "drop" ? [40, 30, 90] : 18);
      if (ev.check || ev.mate) this.beam(ev.to, this.kingSq(ev.fen, ev.color));                          // rayon laser d'échec jusqu'au roi
    }
    /** case du roi qui subit l'échec : celui de la couleur opposée au joueur du coup */
    kingSq(fen, color) { const m = fenMap(fen || ""), want = color === "w" ? "k" : "K"; return Object.keys(m).find((q) => m[q] === want) || ""; }
    tint(color, ms) { const t = this.host.querySelector(".ce-tint") || (() => { const d = document.createElement("div"); d.className = "ce-tint"; this.host.insertBefore(d, this.flash); return d; })(); t.style.background = color; t.getAnimations().forEach((a) => a.cancel()); t.animate([{ opacity: 1 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], { duration: ms || 700, fill: "forwards" }); }
    laser(color, ms) { const l = this.host.querySelector(".ce-laser") || (() => { const d = document.createElement("div"); d.className = "ce-laser"; this.host.insertBefore(d, this.flash); return d; })(); l.style.setProperty("--lc", color); l.getAnimations().forEach((a) => a.cancel()); l.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0 }], { duration: ms || 1000, fill: "forwards" }); }
    /** AAA : double onde de choc + les 4 coins d'un cadre de visée [ ] qui se referment autour de la case ; sur un coup !! ou ! */
    targetFx(sq, color) {
      const p = this.xy(sq), c = this.cell, cx = p.x + c * 0.86, cy = p.y + c * 0.12;
      for (let i = 0; i < 2; i++) { const r = document.createElement("div"); r.className = "ce-ring2"; r.style.cssText = `left:${cx}px;top:${cy}px;width:${c * 0.5}px;height:${c * 0.5}px;--rc:${color};animation-delay:${i * 90}ms`; this.fxl.appendChild(r); this.later(() => r.remove(), 560); }
      const b = document.createElement("div"); b.className = "ce-brk"; b.style.cssText = `left:${p.x - c * 0.06}px;top:${p.y - c * 0.06}px;width:${c * 1.12}px;height:${c * 1.12}px;--rc:${color}`; b.innerHTML = "<i></i><i></i><i></i><i></i>"; this.fxl.appendChild(b); this.later(() => b.remove(), 950);
    }
    /** AAA : rayon laser d'échec jaune / orange (cœur blanc, halo 25 px) de la pièce attaquante jusqu'au roi, qui clignote en rouge */
    beam(from, to) {
      if (!from || !to || !this.sq[from] || !this.sq[to]) return;
      const a = this.xy(from), b = this.xy(to), h = this.cell / 2, dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), el = document.createElement("div");
      el.className = "ce-beam"; el.style.cssText = `left:${a.x + h}px;top:${a.y + h}px;width:${d}px;transform:rotate(${Math.atan2(dy, dx)}rad)`; this.fxl.appendChild(el); this.later(() => el.remove(), 950);
      const k = this.pieces[to]; if (k) { k.classList.add("ce-kflash"); this.later(() => k.classList.remove("ce-kflash"), 900); }
    }
    /** AAA : mini-cutscene (0,4 s) juste avant un sacrifice : deux grandes silhouettes au premier plan + le nom de l'ouverture / du coup en gros texte cyan et blanc */
    cut3d(ev, text) {
      const pc = (ev.color === "w" ? "w" : "b") + ev.piece, foe = (ev.captured ? (ev.color === "w" ? "b" : "w") + ev.captured : (ev.color === "w" ? "b" : "w") + "k"), base = E.assetBase || "";
      const el = document.createElement("div"); el.className = "ce-cut3";
      el.innerHTML = `<img class="l" src="${pieceUrl(ev.color === "w" ? ev.piece.toUpperCase() : ev.piece)}" alt=""><img class="r" src="${pieceUrl(foe[0] === "w" ? foe[1].toUpperCase() : foe[1])}" alt=""><b><span>${esc2(String(text || ev.san || "").toUpperCase())}</span></b>`;
      this.host.insertBefore(el, this.flash); this.later(() => el.remove(), 480); this.flashFx("#fff", 0.3, 40);
    }
    flashFx(color, op, ms) { this.flash.style.background = color; op = op == null ? 0.85 : op; this.flash.animate([{ opacity: op }, { opacity: op, offset: 0.4 }, { opacity: 0 }], { duration: ms || 150 }); }
    explode(ev, tone, n) {
      const r = this.host.getBoundingClientRect(), q = this.sq[ev.to].getBoundingClientRect(), x = q.left - r.left + q.width / 2, y = q.top - r.top + q.height / 2;
      for (let i = 0; i < n; i++) { const a = rnd(0, 6.283), v = rnd(60, 360); this.burst.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: rnd(0.5, 1.1), max: 1.1, c: Math.random() < 0.3 ? "#fff" : tone, s: rnd(1.5, 3.6) }); }
    }
    // ---------------------------------------------------------------- cutscenes / texte
    setLook(id) {
      const L = LOOKS[id] || LOOKS.mono; this.look = LOOKS[id] ? id : "mono";
      Object.keys(LOOKS).forEach((k) => this.host.classList.toggle("ce-look-" + k, k === this.look));
      (this.sqList || []).forEach((o) => { o.el.style.background = id === "zavee" ? (o.par ? "linear-gradient(135deg,#828282,#767676 55%,#6c6c6c)" : "linear-gradient(135deg,#f7f7f7,#EBEBEB 55%,#dedede)") : (o.par ? L.d : L.l); });
      this.dustColor = L.dust; this.host.style.setProperty("--vigc", L.vig);
    }
    dof(ms) { this.dofEl.classList.add("on"); this.later(() => this.dofEl.classList.remove("on"), ms); }       // flou de profondeur sur les bords du plan serre
    rectOf(sq) { const r = this.host.getBoundingClientRect(), q = this.sq[sq].getBoundingClientRect(); return { l: q.left - r.left, t: q.top - r.top, w: q.width, h: q.height }; }
    /** la piece du coup, en grand et detouree, retombe sur la case (plan « heros ») */
    hero(ev) {
      const q = this.rectOf(ev.to), size = q.w * 2.7, img = document.createElement("img");
      img.className = "ce-hero"; img.src = `${E.assetBase || ""}img/chess/${ev.color}${ev.promo || ev.piece}.png`;
      img.style.cssText = `left:${q.l + q.w / 2 - size / 2}px;top:${q.t + q.h / 2 - size / 2}px;width:${size}px;height:${size}px;--rz:${rnd(-26, 26).toFixed(1)}deg`;
      this.host.querySelector(".ce-dof").before(img); this.later(() => img.remove(), 1250);
    }
    /** texte neon (« IT'S OVER... ») avec fleche, pose a cote de la case */
    neon(text, tone, sq) {
      const q = this.rectOf(sq), col = TONE[tone] || TONE.red, words = String(text).split(" "), last = words.pop(), el = document.createElement("div");
      el.className = "ce-neon";
      el.style.cssText = `left:${Math.max(8, Math.min(q.l + q.w + 6, this.W - 150))}px;top:${q.t + q.h * 0.1}px;--nc:${col};font-size:${Math.max(17, q.h * 0.4)}px`;
      el.innerHTML = `${words.length ? `<span>${esc2(words.join(" "))}</span> ` : ""}<b>${esc2(last)}</b><svg viewBox="0 0 24 40"><path d="M12 2v28M3 22l9 12 9-12"/></svg>`;
      this.host.querySelector(".ce-dof").before(el); el.style.left = Math.max(8, Math.min(parseFloat(el.style.left), this.W - el.offsetWidth - 8)) + "px"; this.later(() => el.remove(), 1700);
    }
    /** arcs electriques + notes de musique autour du coup brillant */
    electric(p) {
      const c = this.cell, cx = p.x + c / 2, cy = p.y + c / 2, ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
      svg.setAttribute("class", "ce-elec"); svg.setAttribute("viewBox", `${-c * 3} ${-c * 3} ${c * 6} ${c * 6}`); svg.style.cssText = `left:${cx - c * 3}px;top:${cy - c * 3}px;width:${c * 6}px;height:${c * 6}px`;
      for (let k = 0; k < 4; k++) {
        const pts = []; let a = rnd(0, 6.283);
        for (let i = 0; i < 10; i++) { a += rnd(-0.35, 0.55); const r = c * (0.45 + i * 0.2) + rnd(-c * 0.12, c * 0.12); pts.push(`${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`); }
        const pl = document.createElementNS(ns, "polyline"); pl.setAttribute("points", pts.join(" ")); pl.style.animationDelay = k * 60 + "ms"; svg.appendChild(pl);
      }
      this.fxl.appendChild(svg); this.later(() => svg.remove(), 800);
      for (let i = 0; i < 6; i++) {
        const n = document.createElement("span"); n.className = "ce-note"; n.textContent = ["♪", "♫", "♬"][i % 3];
        n.style.cssText = `left:${cx}px;top:${cy}px;font-size:${c * 0.5}px;--dx:${rnd(-c * 2.4, c * 2.4).toFixed(0)}px;--dy:${rnd(-c * 2.6, -c * 0.4).toFixed(0)}px;animation-delay:${i * 70}ms`;
        this.fxl.appendChild(n); this.later(() => n.remove(), 1500);
      }
    }
    drawOrbs(ctx, dt) {                                                               // grosses bulles de lumiere floues (galaxie / aura)
      if (this.look !== "galaxy" && this.look !== "aura") return;
      if (!this.orbs) this.orbs = Array.from({ length: 7 }, () => ({ x: rnd(0, 1), y: rnd(0, 1), r: rnd(0.012, 0.035), vx: rnd(-0.01, 0.01), vy: rnd(-0.02, -0.004), ph: rnd(0, 6) }));
      for (const o of this.orbs) {
        o.x += o.vx * dt; o.y += o.vy * dt; o.ph += dt; if (o.y < -0.05) { o.y = 1.05; o.x = rnd(0, 1); }
        const R = o.r * this.W, x = o.x * this.W, y = o.y * this.H, g = ctx.createRadialGradient(x, y, 0, x, y, R);
        g.addColorStop(0, this.look === "aura" ? "rgba(120,255,235,.85)" : "rgba(255,255,255,.9)"); g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(o.ph * 1.5); ctx.fillStyle = g; ctx.fillRect(x - R, y - R, R * 2, R * 2);
      }
      ctx.globalAlpha = 1;
    }
    cutscene(c, tone) {
      const col = tone === "red" ? "#ff3a52" : TONE.gold, img = `${E.assetBase || ""}img/chess/${c.color}${c.piece}.png`;
      this.cut.hidden = false;
      this.cut.innerHTML = `<div class="ce-rays"></div><div class="ce-arrows">${Array.from({ length: 8 }, (_, i) => `<b style="transform:rotate(${i * 45}deg) translateY(-34vmin)">➤</b>`).join("")}</div>
        <img src="${img}" style="filter:brightness(0) drop-shadow(0 0 22px ${col})"><div class="ce-big" style="text-shadow:0 0 18px ${col}">${E.esc(c.text)}</div>`;
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
    /** barre d'évaluation verticale à gauche (comme Stockfish / Chess.com) : cp du point de vue des Blancs, animée */
    setEval(cp) {
      if (cp == null) return; this.evalEl.hidden = false;
      const mate = Math.abs(cp) >= 9000, v = Math.max(-99, Math.min(99, cp / 100)), pct = E.board && E.board.winPct ? E.board.winPct(cp) : 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-2000, Math.min(2000, cp)))) - 1);
      this.evF.style.height = pct + "%"; this.evN.textContent = mate ? "M" : (v > 0 ? "+" : "") + v.toFixed(1); this.evN.style.top = Math.max(2, Math.min(94, 100 - pct - 3)) + "%";
    }
    /** nom de l'ouverture, en gros caractères bruns/dorés au bas de l'écran */
    openingTitle(text, sec) {
      const el = this.openEl; el.hidden = false; el.textContent = String(text).toUpperCase(); el.classList.remove("in"); void el.offsetWidth; el.classList.add("in");
      clearTimeout(this._opT); this._opT = setTimeout(() => { if (this.alive) { el.classList.add("out"); this._opT = setTimeout(() => { el.hidden = true; el.classList.remove("out"); }, 900); } }, (sec || 4.5) * 1000);
    }
    /** flèches de menace orange (courbes) de la pièce vers les pièces qu'elle menace + panneaux ⚠ sur les cibles */
    threats(list, ms) {
      if (!list || !list.length) return;
      const S = this.S, c = this.cell, ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), els = [svg];
      svg.setAttribute("class", "ce-thr"); svg.setAttribute("viewBox", `0 0 ${S} ${S}`); svg.style.cssText = `width:${S}px;height:${S}px`;
      list.forEach((t, i) => {
        const a = this.xy(t.from), b = this.xy(t.to), x1 = a.x + c / 2, y1 = a.y + c / 2, x2 = b.x + c / 2, y2 = b.y + c / 2, mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
        const sg = i % 2 ? -1 : 1, cx = mx - (dy / L) * L * 0.32 * sg, cy = my + (dx / L) * L * 0.32 * sg, ang = Math.atan2(y2 - cy, x2 - cx), hs = c * 0.34;
        const sx = x1 + Math.cos(Math.atan2(cy - y1, cx - x1)) * c * 0.35, sy = y1 + Math.sin(Math.atan2(cy - y1, cx - x1)) * c * 0.35, ex = x2 - Math.cos(ang) * c * 0.42, ey = y2 - Math.sin(ang) * c * 0.42;
        const path = document.createElementNS(ns, "path"); path.setAttribute("d", `M${sx.toFixed(1)},${sy.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`); path.setAttribute("class", "ce-thp"); path.setAttribute("pathLength", "1"); path.style.strokeWidth = c * 0.13; path.style.animationDelay = i * 160 + "ms";
        const head = document.createElementNS(ns, "polygon"); head.setAttribute("class", "ce-thh"); head.setAttribute("points", `0,${-hs * 0.55} ${hs},0 0,${hs * 0.55}`); head.setAttribute("transform", `translate(${ex.toFixed(1)},${ey.toFixed(1)}) rotate(${(ang * 180 / Math.PI).toFixed(1)})`); head.style.animationDelay = 350 + i * 160 + "ms";
        svg.append(path, head);

      });
      this.fxl.appendChild(svg);
      this.later(() => els.forEach((e) => e.classList.add("out")), ms || 2200); this.later(() => els.forEach((e) => e.remove()), (ms || 2200) + 450);
    }
    /** contour « dessin au trait » d'une image de pièce (blanc, 3 px) : bord de son canal alpha ; mis en cache */
    outlineOf(url, size) {
      size = size || 220;
      return (this.outl[url] = this.outl[url] || new Promise((res) => {
        const im = new Image();
        im.onload = () => {
          try {
            const c = document.createElement("canvas"); c.width = c.height = size; const g = c.getContext("2d"); g.drawImage(im, 0, 0, size, size);
            const a = g.getImageData(0, 0, size, size).data, W = size, mask = new Uint8Array(W * W), out = g.createImageData(W, W), R = 3;
            for (let i = 0; i < W * W; i++) mask[i] = a[i * 4 + 3] > 100 ? 1 : 0;
            for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
              if (!mask[y * W + x]) continue; let edge = false;
              for (let dy = -R; dy <= R && !edge; dy += R) for (let dx = -R; dx <= R; dx += R) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= W || !mask[ny * W + nx]) { edge = true; break; } }
              if (edge) { const k = (y * W + x) * 4; out.data[k] = out.data[k + 1] = out.data[k + 2] = 255; out.data[k + 3] = 255; }
            }
            g.clearRect(0, 0, W, W); g.putImageData(out, 0, 0); res(c.toDataURL());
          } catch (e) { res(url); }
        };
        im.onerror = () => res(url); im.src = url;
      }));
    }
    /** fiche de la pièce maîtresse (Power / Speed / Defense / Trick), barres qui se remplissent doucement ; le plateau s'assombrit pendant ce temps */
    async statCard(st, ms) {
      if (!st) return;
      const el = this.statEl, url = pieceUrl(st.piece), rows = [["Power", st.vals.power], ["Speed", st.vals.speed], ["Defense", st.vals.defense], ["Trick", st.vals.trick]], top = Math.max(...rows.map((r) => r[1]));
      const ic = await this.outlineOf(url);
      if (!this.alive) return;
      el.hidden = false; el.classList.remove("out");
      this.shake = Math.max(this.shake, 24); this.chroma = Math.max(this.chroma, 12); this.flashFx("#ffffff"); this.warp = Math.max(this.warp, 0.5);          // IMPACT : la fiche claque
      this.camTo({ rx: 16, rz: 0, s: 0.86 }, 140); this.later(() => this.camTo({ rx: 18, rz: 0, s: 1.0 }, 700), 160);
      if (E.vibrate) E.vibrate([40, 20, 70]);
      el.innerHTML = `<div class="ce-sc slam"><div class="ce-sc-ic"><img src="${ic}" alt=""><em>${esc2(st.name.toUpperCase())}</em></div><div class="ce-sc-bars">${rows.map(([n, v], i) => `<div class="r${v === top ? " top" : ""}" style="--d:${260 + i * 90}ms"><span>${n}</span><i><u style="--v:${v}%"></u></i><b>${v}</b></div>`).join("")}</div></div>`;
      this.host.classList.add("ce-dim"); const p = this.xy(st.sq), pu = document.createElement("div"); pu.className = "ce-pulse"; pu.style.cssText = `left:${p.x}px;top:${p.y}px;width:${this.cell}px;height:${this.cell}px`; this.fxl.appendChild(pu);
      this.later(() => { this.flashFx("#c9a6ff"); }, 900);                                                        // le plus fort des 4 stats claque à son tour
      this.later(() => { el.classList.add("out"); this.host.classList.remove("ce-dim"); pu.remove(); }, ms - 380); this.later(() => { el.hidden = true; el.innerHTML = ""; }, ms);
    }
    /** la pièce prise MEURT : elle devient une ombre noire qui se délite en cendres et monte en fumée, braises qui s'élèvent (strong : plus long, plus de fumée) */
    dissolve(el, sq, strong) {
      const sec = strong ? 2.4 : 1.4, r = this.host.getBoundingClientRect(), q = this.sq[sq].getBoundingClientRect(), x = q.left - r.left + q.width / 2, y = q.top - r.top + q.height / 2;
      el.style.transition = "none"; el.style.setProperty("--ash", sec + "s"); el.classList.add("ce-ash"); this.later(() => el.remove(), sec * 1000 + 120);
      for (let i = 0, n = Math.round((strong ? 46 : 24) * this.fx.smoke); i < n; i++) this.smoke.push({ x: x + rnd(-q.width * 0.3, q.width * 0.3), y: y + rnd(-q.height * 0.2, q.height * 0.35), vx: rnd(-14, 14), vy: rnd(-46, -14), r: rnd(q.width * 0.12, q.width * 0.32), grow: rnd(10, 30), life: rnd(sec * 0.5, sec * 1.1), max: sec * 1.1, d: i * (strong ? 0.035 : 0.025) });
      for (let i = 0; i < (strong ? 22 : 10); i++) this.burst.push({ x: x + rnd(-q.width * 0.25, q.width * 0.25), y: y + rnd(0, q.height * 0.3), vx: rnd(-20, 20), vy: rnd(-120, -40), life: rnd(0.8, 1.9), max: 1.9, c: Math.random() < 0.5 ? "#ff8a2a" : "#ffd27a", s: rnd(1.2, 2.6) });
      this.shake = Math.max(this.shake, strong ? 9 : 4); if (strong) this.shockwave(0.7);
      this.outlineOf(el.src).then((u) => { if (!this.alive) return; const g = document.createElement("img"), p = this.xy(sq); g.src = u; g.className = "ce-ghostline"; g.style.cssText = `left:${p.x}px;top:${p.y}px;width:${this.cell}px;height:${this.cell}px;--gd:${(sec * 1.1).toFixed(2)}s`; this.fxl.appendChild(g); this.later(() => g.remove(), sec * 1100 + 200); });
    }
    /** le roi maté s'effondre en cendres (couleur du camp perdant : "w" ou "b") */
    dissolveKing(color) {
      const sq = Object.keys(this.pieces).find((s) => this.pieces[s]._p === (color === "w" ? "K" : "k"));
      if (!sq) return; const el = this.pieces[sq]; delete this.pieces[sq]; this.dissolve(el, sq, true);
    }
    /** plan d'ambiance (avant le premier coup, le temps que la musique arrive à son moment) : caméra qui orbite lentement */
    idle(sec) {
      const ms = Math.round(sec * 1000);
      this.camTo({ rx: 20, rz: -6, s: 1.0 }, ms * 0.5); this.later(() => this.camTo({ rx: 14, rz: 7, s: 1.15 }, ms * 0.5), ms * 0.5);
    }
    // ---------------------------------------------------------------- RYTHME VIRAL : ralenti, arrêt sur image, badges, effet brillant, intro / outro
    /** impact discret des coups ordinaires (ouverture, milieu de partie) : halo + case allumée, étincelles à la prise */
    soft(ev) {
      this.punch(0.05);
      const p = this.xy(ev.to), tone = TONE[ev.tone] || TONE.green, halo = document.createElement("div");
      halo.className = "ce-halo"; halo.style.cssText = `left:${p.x - this.cell * 0.8}px;top:${p.y - this.cell * 0.8}px;width:${this.cell * 2.6}px;height:${this.cell * 2.6}px;background:radial-gradient(circle,${tone} 0%,${tone}55 35%,transparent 70%)`;
      this.fxl.appendChild(halo); this.later(() => halo.remove(), 800);
      if (this.lit) this.lit.remove();
      this.lit = document.createElement("div"); this.lit.className = "ce-lit"; this.lit.style.cssText = `left:${p.x}px;top:${p.y}px;width:${this.cell}px;height:${this.cell}px;box-shadow:0 0 ${this.cell * 0.5}px ${tone},inset 0 0 ${this.cell * 0.3}px ${tone}`;
      this.fxl.appendChild(this.lit);
      if (ev.captured) { this.shake = Math.max(this.shake, 6); this.explode(ev, tone, 16); }
    }
    /** « dé-zoom punch » : la caméra recule d'un coup à l'impact puis revient (au lieu d'un zoom qui grossit les pièces) */
    punch(power) {
      const c = this.camNow; if (!c) return;
      this.cam.style.transition = "transform 110ms cubic-bezier(.2,.9,.2,1)"; this.cam.style.transform = this.cam.style.transform.replace(/scale\(([\d.]+)\)/, (m, v) => `scale(${(parseFloat(v) * (1 - 0.1 - power * 0.1)).toFixed(3)})`);
      this.later(() => { this.cam.style.transition = "transform 520ms cubic-bezier(.16,1,.3,1)"; this.cam.style.transform = this.cam.style.transform.replace(/scale\(([\d.]+)\)/, `scale(${c.s})`); }, 120);
    }
    /** flou « éclair » anamorphique : trait de lumière horizontal à la hauteur de la case */
    flare(sq, color) {
      const r = this.host.getBoundingClientRect(), q = this.sq[sq].getBoundingClientRect(), d = document.createElement("div"); d.className = "ce-flare";
      d.style.cssText = `top:${q.top - r.top + q.height / 2}px;--fc:${color || "#9ff6ff"}`; this.host.querySelector(".ce-dof").before(d); this.later(() => d.remove(), 1100);
    }
    /** fissures sur l'écran (gaffe, mat) depuis la case touchée */
    cracks(sq) {
      const r = this.host.getBoundingClientRect(), q = this.sq[sq].getBoundingClientRect(), cx = q.left - r.left + q.width / 2, cy = q.top - r.top + q.height / 2, ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
      svg.setAttribute("class", "ce-crack"); svg.setAttribute("viewBox", `0 0 ${this.W} ${this.H}`);
      for (let k = 0; k < 9; k++) {
        let x = cx, y = cy, a = (k / 9) * 6.283 + rnd(-0.3, 0.3); const pts = [`${x.toFixed(0)},${y.toFixed(0)}`];
        for (let i = 0; i < 6; i++) { a += rnd(-0.5, 0.5); const L = rnd(28, 85) * (1 + i * 0.12); x += Math.cos(a) * L; y += Math.sin(a) * L; pts.push(`${x.toFixed(0)},${y.toFixed(0)}`); }
        const pl = document.createElementNS(ns, "polyline"); pl.setAttribute("points", pts.join(" ")); pl.style.animationDelay = k * 18 + "ms"; svg.appendChild(pl);
      }
      this.host.querySelector(".ce-dof").before(svg); this.later(() => svg.remove(), 2200);
    }
    /** glitch numérique bref (translation + teinte qui sautent) */
    glitch(ms) { this.host.classList.add("ce-glitch"); this.later(() => this.host.classList.remove("ce-glitch"), ms || 380); }
    /** onde de choc : déformation radiale de l'image (qualité max) */
    shockwave(power) { if (this.fx && this.fx.shock) this.shk2 = Math.max(this.shk2, 18 + (power || 1) * 22); }
    /** ralenti : poussière et particules au ralenti pendant que le coup glisse */
    slowmo(on) { this.ts = on ? 0.3 : 1; }
    /** arrêt sur image : le temps (particules, poussière) se fige presque, la caméra pousse lentement vers la case ; reprend après `sec` */
    freeze(sec, ev) {
      this.ts = 0.05; this.host.classList.add("ce-frozen");
      if (ev && ev.to) { const p = this.xy(ev.to), c = this.camNow || { rx: 46, rz: 0, s: 1.9 }; this.camTo({ rx: c.rx, rz: c.rz, s: c.s + 0.1 }, Math.round(sec * 1000), p.c, p.r); }
      this.later(() => { this.ts = 1; this.host.classList.remove("ce-frozen"); }, sec * 1000);
    }
    /** pastille de qualité du coup (‼ cyan, ❓ rouge, ⁈ jaune, 👍 vert) sur la case d'arrivée + libellé néon en haut de l'écran */
    badge(ev, ms) {
      const bd = ev.badge; if (!bd) return;
      const p = this.xy(ev.to), c = this.cell, b = document.createElement("div"), big = ev.key === "brilliant" || ev.key === "blunder", sz = c * (big ? 0.62 : 0.52);
      b.className = "ce-badge2"; const src = bd.img ? `${E.assetBase || ""}img/badges/${bd.img}.png` : "";
      b.innerHTML = src ? `<img class="hdr-badge" src="${src}" alt="" style="--g:${bd.color}">` : bd.glyph;
      b.style.cssText = `left:${p.x + c - sz * 0.62}px;top:${p.y - sz * 0.38}px;width:${sz}px;height:${sz}px;font-size:${sz * 0.6}px;--bc:${bd.color}`;                   // en haut à droite de la case d'arrivée
      this.fxl.appendChild(b); this.later(() => b.classList.add("out"), (ms || 1500)); this.later(() => b.remove(), (ms || 1500) + 400);
      if (ev.key === "brilliant" || ev.key === "great" || ev.key === "excellent") this.targetFx(ev.to, ev.key === "brilliant" ? "#1CE8E8" : "#268BFF");           // double onde de choc + cadre de visée
    }
    tag(text, color, ms) {
      const L = this.label; L.hidden = false; L.textContent = text; L.style.setProperty("--lc", color); L.classList.remove("in"); void L.offsetWidth; L.classList.add("in");
      clearTimeout(this._tagT); this._tagT = setTimeout(() => { if (this.alive) L.hidden = true; }, ms || 1400);
    }
    /** coup BRILLANT / sacrifice : zoom éclair sur la case, shake violent, inversion des couleurs + flash de lumière */
    brilliantFx(ev) {
      const p = this.xy(ev.to), cm = (this.dir && this.dir.cam) || { s: [1.05, 1.4] };
      this.camTo({ rx: 18, rz: rnd(-6, 6), s: cm.s[1] * 1.1 }, 150, p.c, p.r);                                                       // petit coup de zoom...
      this.later(() => this.camTo({ rx: 16, rz: rnd(-8, 8), s: 0.9 }, 800), 200);                                                    // ...puis DÉ-ZOOM large
      this.shake = Math.max(this.shake, 38); this.chroma = Math.max(this.chroma, 18); this.warp = Math.max(this.warp, 0.4);
      let n = 0; const inv = () => { this.host.classList.add("ce-inv"); this.later(() => this.host.classList.remove("ce-inv"), 80); if (++n < 3) this.later(inv, 170); };
      inv(); this.flashFx("#d8fdff"); this.later(() => this.flashFx("#ffffff"), 120);
      this.flare(ev.to, "#9ff6ff"); this.shockwave(1); this.glitch(300);
      if (E.vibrate) E.vibrate([30, 30, 30, 30, 90]);
    }
    /** présentation des deux adversaires : portraits qui glissent, titres, Elo, « VS » qui claque */
    intro(info, dur) {
      const el = this.introEl, side = (s, k) => {
        const img = s.img ? `${E.assetBase || ""}${s.img}` : `${E.assetBase || ""}img/chess/${k === "w" ? "w" : "b"}k.png`;
        return `<div class="ce-pl ${k}"><div class="ce-port"><img src="${img}" alt=""></div><div class="ce-nm">${s.title ? `<em>${esc2(s.title)}</em>` : ""}${esc2(s.name)}</div><div class="ce-sub">${s.elo != null ? s.elo + " ELO" : s.human ? "JOUEUR" : "BOT"} · ${k === "w" ? "BLANCS" : "NOIRS"}</div></div>`;
      };
      el.hidden = false; el.style.setProperty("--d", dur + "s"); el.className = "ce-intro v-" + ((this.dir && this.dir.intro) || "versus");
      el.innerHTML = `<div class="ce-ibg"></div><div class="ce-slash"></div>${side(info.white, "w")}${side(info.black, "b")}<div class="ce-vs"><b>VS</b></div><div class="ce-ittl">${esc2(info.title.split("·")[0].trim() || "CHESS EDIT")}</div>`;
      this.later(() => { this.shake = Math.max(this.shake, 26); this.chroma = Math.max(this.chroma, 12); this.flashFx("#fff"); if (E.vibrate) E.vibrate([40, 30, 80]); }, Math.round(dur * 0.42 * 1000));
      this.later(() => { el.classList.add("out"); }, Math.round((dur - 0.5) * 1000));
      this.later(() => { el.hidden = true; el.classList.remove("out"); el.innerHTML = ""; }, Math.round(dur * 1000));
    }
    outro(info, dur) {
      const el = this.resEl; el.hidden = false;
      el.innerHTML = `<div class="ce-rbig">${esc2(info.result || "FIN")}</div><div class="ce-rsub">${esc2(info.intro.white.name)} <i>VS</i> ${esc2(info.intro.black.name)}</div>`;
      this.later(() => { el.hidden = true; el.innerHTML = ""; }, Math.round((dur || 2.6) * 1000) + 500);
    }
    // ===================== EFFETS « EDIT VIRAL » (face-off, chemins rouges, badges IA, boss, prompt, strobe, flèche, reality check) =====================
    /** INTRO « SPLIT-SCREEN FACE-OFF » (0,5 s max) : plateau flouté et incliné derrière, les deux avatars face à face (rim light), badge VS métal / néon, noms + Elo en gros, flash blanc vers le 1er coup */
    faceoff(info, ms) {
      ms = ms || 500; const el = this.introEl, base = E.assetBase || "";
      const side = (s, k) => { const img = s.img ? base + s.img : "", tag = s.title ? `<em class="gm">${esc2(s.title)}</em>` : s.human ? "" : `<em class="ai">AI</em>`; return `<div class="fo-p ${k}">${img ? `<img src="${img}" alt="">` : `<div class="fo-ph">${k === "w" ? "♔" : "♚"}</div>`}<img class="fo-bd hdr-badge" src="${base}img/badges/${k === "l" ? "best" : "brilliant"}.png" alt="" style="--g:${k === "l" ? "#96bc4b" : "#1CE8E8"}"><div class="fo-n">${esc2(String(s.human ? (s.name === "Toi" ? "TOI" : s.name) : s.name).toUpperCase())}<small>${tag}${s.elo != null ? s.elo + " ELO" : ""}</small></div></div>`; };
      el.hidden = false; el.className = "ce-intro fo"; el.style.setProperty("--d", ms + "ms");
      el.innerHTML = `<div class="fo-bg"></div>${side(info.white, "r".replace("r", "l"))}${side(info.black, "r")}<div class="fo-vs"><b>VS</b></div>`;
      this.camTo({ rx: 52, rz: -6, s: 1.25 }, 0); this.persp.style.filter = "blur(5px) grayscale(1) brightness(.7)";                       // plateau flouté et incliné en arrière-plan
      this.later(() => { this.persp.style.filter = ""; this._want = ""; this.flashFx("#fff", 0.9, 120); this.camTo({ rx: 10, rz: 0, s: 1.15 }, 140); }, Math.round(ms * 0.82));
      this.later(() => { el.hidden = true; el.innerHTML = ""; el.className = "ce-intro"; }, ms + 40);
    }
    /** CHEMIN ROUGE : toutes les cases TRAVERSÉES par la pièce (ligne, colonne, diagonale ou L du cavalier) en rouge néon #FF2A1A + halo, le reste du plateau s'assombrit */
    redPath(from, to, piece, ms) {
      if (!from || !to || from === to) return;
      const sqs = [], f = [from.charCodeAt(0) - 97, +from[1] - 1], t = [to.charCodeAt(0) - 97, +to[1] - 1], dx = t[0] - f[0], dy = t[1] - f[1], nm = (c, r) => String.fromCharCode(97 + c) + (r + 1);
      if ((piece || "").toLowerCase() === "n" || (Math.abs(dx) !== Math.abs(dy) && dx && dy)) { const sx = Math.sign(dx), sy = Math.sign(dy); const long = Math.abs(dx) >= Math.abs(dy); sqs.push(from); if (long) { for (let k = 1; k <= Math.abs(dx); k++) sqs.push(nm(f[0] + sx * k, f[1])); for (let k = 1; k <= Math.abs(dy); k++) sqs.push(nm(t[0], f[1] + sy * k)); } else { for (let k = 1; k <= Math.abs(dy); k++) sqs.push(nm(f[0], f[1] + sy * k)); for (let k = 1; k <= Math.abs(dx); k++) sqs.push(nm(f[0] + sx * k, t[1])); } }
      else { const n = Math.max(Math.abs(dx), Math.abs(dy)), sx = Math.sign(dx), sy = Math.sign(dy); for (let k = 0; k <= n; k++) sqs.push(nm(f[0] + sx * k, f[1] + sy * k)); }
      const dim = document.createElement("div"); dim.className = "ce-pathdim"; dim.style.cssText = `width:${this.S}px;height:${this.S}px`; this.fxl.prepend(dim);
      const els = [dim]; sqs.forEach((q, i) => { if (!this.sq[q]) return; const p = this.xy(q), d = document.createElement("div"); d.className = "ce-path"; d.style.cssText = `left:${p.x}px;top:${p.y}px;width:${this.cell}px;height:${this.cell}px;animation-delay:${i * 18}ms`; this.fxl.appendChild(d); els.push(d); });
      this.later(() => els.forEach((e) => e.classList.add("out")), ms || 900); this.later(() => els.forEach((e) => e.remove()), (ms || 900) + 300);
    }
    /** badges côte à côte en haut à droite de la case : [{img, color, ai}] (glow HDR) */
    badges(sq, list, ms) {
      const p = this.xy(sq), c = this.cell, sz = c * 0.5, base = E.assetBase || "";
      list.forEach((b, i) => {
        const d = document.createElement("div"); d.className = "ce-badge2 hb" + (b.ai ? " ai" : ""); d.style.cssText = `left:${p.x + c - sz * 0.62 - i * sz * 0.92}px;top:${p.y - sz * 0.38}px;width:${sz}px;height:${sz}px;--bc:${b.color || "#fff"};animation-delay:${i * 90}ms`;
        d.innerHTML = `<img class="hdr-badge" src="${base}${b.img}" alt="" style="--g:${b.color || "#fff"}">`; this.fxl.appendChild(d);
        this.later(() => d.classList.add("out"), ms || 1500); this.later(() => d.remove(), (ms || 1500) + 400);
      });
      this.targetFx(sq, "#ffffff");
    }
    /** « DEAL WITH IT » : des lunettes de soleil noires pixelisées descendent sur la pièce jouée */
    glasses(sq, ms) {
      const p = this.xy(sq), c = this.cell, w = c * 0.8; if (!this._gl) { const cv = document.createElement("canvas"); cv.width = 16; cv.height = 5; const g = cv.getContext("2d"); g.fillStyle = "#000"; [[0, 0, 16, 1], [0, 1, 7, 3], [9, 1, 7, 3], [1, 4, 5, 1], [10, 4, 5, 1], [7, 1, 2, 1]].forEach((r) => g.fillRect(...r)); g.fillStyle = "#fff"; g.fillRect(1, 1, 2, 1); g.fillRect(10, 1, 2, 1); this._gl = cv.toDataURL(); }
      const el = document.createElement("img"); el.className = "ce-gl"; el.src = this._gl; el.style.cssText = `left:${p.x + (c - w) / 2}px;top:${p.y + c * 0.16}px;width:${w}px;image-rendering:pixelated`; this.fxl.appendChild(el);
      el.animate([{ transform: `translateY(${-c * 2.4}px)`, opacity: 0 }, { transform: "translateY(0)", opacity: 1, offset: 0.7 }, { transform: `translateY(${-c * 0.06}px)`, opacity: 1 }], { duration: 420, easing: "cubic-bezier(.3,1.5,.5,1)", fill: "forwards" });
      this.later(() => { el.style.transition = "opacity .3s"; el.style.opacity = 0; }, ms || 1700); this.later(() => el.remove(), (ms || 1700) + 350);
    }
    /** GIANT RED BOSS PIECE : la pièce attaquante grossit (×1,65), s'incline de 22° SUR SON PROPRE CENTRE et passe au rouge incandescent pendant 250 ms */
    bossPiece(ev) {
      const el = this.pieces[ev.from]; if (!el) return; const p = this.xy(ev.from), t = `translate(${p.x}px,${p.y}px)`;
      el.style.zIndex = 6; el.style.filter = "brightness(1.35) sepia(1) saturate(9) hue-rotate(-52deg) drop-shadow(0 0 3px #fff) drop-shadow(0 0 10px #FF1111) drop-shadow(0 0 22px #FF1111)";
      try { el.animate([{ transform: `${t} scale(1) rotate(0deg)` }, { transform: `${t} scale(1.65) rotate(22deg)`, offset: 0.55 }, { transform: `${t} scale(1.65) rotate(22deg)` }], { duration: 250, easing: "cubic-bezier(.2,.9,.2,1)" }); } catch (e) { /* ancien WebView */ }
      this.later(() => { el.style.filter = ""; el.style.zIndex = ""; }, 300);
    }
    /** KING TILT : le roi en échec violent sur le bord bascule de 32° autour de son centre exact */
    kingTilt(sq) {
      const el = this.pieces[sq]; if (!el) return; const p = this.xy(sq), t = `translate(${p.x}px,${p.y}px)`;
      try { el.animate([{ transform: `${t} rotate(0deg)` }, { transform: `${t} rotate(32deg)`, offset: 0.3 }, { transform: `${t} rotate(26deg)`, offset: 0.7 }, { transform: `${t} rotate(0deg)` }], { duration: 900, easing: "ease-out" }); } catch (e) { /* ancien WebView */ }
    }
    /** CUTSCENE « PROMPT & STREAMING » : plateau assombri à 80 %, bulle de prompt puis le texte du bot qui s'écrit à toute vitesse (curseur lumineux), silhouette blanche qui tourne ; juste avant le drop */
    promptCut(text, piece, ms, q) {
      ms = ms || 600; const el = document.createElement("div"); el.className = "ce-prompt"; const chars = Array.from(String(text || "…")), base = E.assetBase || "";
      el.innerHTML = `<div class="pq">${esc2(q || "Quel est ton prochain coup ?")}</div><div class="pa"><span></span><i></i></div><img class="sil" src="${base}img/chess/w${(piece || "q").toLowerCase()}.png" alt="">`; this.host.insertBefore(el, this.flash);
      const out = el.querySelector(".pa span"), t0 = performance.now(), run = () => { if (!this.alive || !el.isConnected) return; const k = Math.min(1, (performance.now() - t0) / (ms * 0.8)); out.textContent = chars.slice(0, Math.ceil(chars.length * k)).join(""); if (k < 1) requestAnimationFrame(run); }; run();
      try { el.querySelector(".sil").animate([{ transform: "rotate(0deg) scale(.8)" }, { transform: "rotate(360deg) scale(1.1)" }], { duration: 250, delay: Math.max(0, ms - 280), fill: "both", easing: "ease-in" }); } catch (e) { /* ancien WebView */ }
      this.later(() => el.remove(), ms + 30);
    }
    /** FLASH STROBOSCOPIQUE « RGB GRID BLUR » (40–60 ms) : canaux rouge / bleu écartés de ±25 px, zoom ×1,35 instantané puis retour élastique, grille néon rouge / bleue / blanche */
    strobe() {
      this._strobeT = performance.now() + 55; this.chroma = 25;
      try { this.wrap.animate([{ transform: "scale(1.35)" }, { transform: "scale(1)" }], { duration: 320, easing: "cubic-bezier(.3,1.9,.4,1)" }); } catch (e) { /* ancien WebView */ }
      const g = document.createElement("div"); g.className = "ce-rgbgrid"; this.host.insertBefore(g, this.flash); this.later(() => g.remove(), 58); this.flashFx("#fff", 0.35, 50);
    }
    /** FLÈCHE LASER JAUNE / OR de la case de départ à la case d'arrivée, par-dessus les pièces (coup final, déplacement illégal) */
    arrow(from, to, ms) {
      if (!from || !to || from === to || !this.sq[from] || !this.sq[to]) return;
      const a = this.xy(from), b = this.xy(to), h = this.cell / 2, x1 = a.x + h, y1 = a.y + h, x2 = b.x + h, y2 = b.y + h, ang = Math.atan2(y2 - y1, x2 - x1), hs = this.cell * 0.55, w = this.cell * 0.2, d = Math.hypot(x2 - x1, y2 - y1) - hs * 0.9;
      const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"); svg.setAttribute("class", "ce-arr"); svg.setAttribute("viewBox", `0 0 ${this.S} ${this.S}`); svg.style.cssText = `width:${this.S}px;height:${this.S}px`;
      svg.innerHTML = `<g transform="translate(${x1},${y1}) rotate(${(ang * 180) / Math.PI})"><polygon points="0,${-w / 2} ${d},${-w / 2} ${d},${-hs * 0.5} ${d + hs},0 ${d},${hs * 0.5} ${d},${w / 2} 0,${w / 2}" fill="#FFD000" stroke="#fff3b0" stroke-width="2"/></g>`;
      this.fxl.appendChild(svg); svg.animate([{ opacity: 0, clipPath: "inset(0 100% 0 0)" }, { opacity: 1, clipPath: "inset(0 0 0 0)", offset: 0.25 }, { opacity: 1 }], { duration: ms || 1400, fill: "forwards" }); this.later(() => svg.remove(), (ms || 1400) + 100);
    }
    /** « REALITY CHECK » : à la toute fin, la caméra se met à plat, le plateau repasse en vert et blanc classiques et la réplique finale du bot s'affiche */
    reality(text, bot) {
      this.camTo({ rx: 0, rz: 0, s: 1.0 }, 700); this.setLook("classic"); this.host.classList.add("ce-reality"); if (text) this.say(bot || "prime", text);
    }
    ff(on) { this.ffEl.hidden = true; }                                                              // plus d'indicateur « ×8 » ni de filtre de rembobinage : les coups passifs sont sautés / joués en 60 ms
    setProgress(f) { this.prog.style.transform = `scaleX(${Math.max(0, Math.min(1, f))})`; }
    setPlaying(on) { this.ppBtn.textContent = on ? "⏸" : "▶"; }
    // ---------------------------------------------------------------- particules + boucle
    initParticles() {
      const mk = (n, fgl) => Array.from({ length: n }, () => ({ a: rnd(0, 6.283), r: rnd(0.02, 0.7), v: rnd(0.02, 0.09), s: fgl ? rnd(1.4, 2.8) : rnd(0.6, 1.8), al: fgl ? rnd(0.25, 0.7) : rnd(0.15, 0.55) }));
      const k = this.fx ? this.fx.part : 1; this.dustB = mk(Math.round(110 * k), false); this.dustF = mk(Math.round(34 * k), true);
    }
    drawDust(ctx, list, dt, mul) {
      const W = this.W, H = this.H, cx = W / 2, cy = H / 2, R = Math.hypot(W, H) / 2;
      for (const p of list) {
        const pr = p.r; p.r += (p.v + this.warp * 0.9 * p.v * 6) * dt * mul;
        if (p.r > 1.05) { p.r = rnd(0.01, 0.12); p.a = rnd(0, 6.283); }
        const x = cx + Math.cos(p.a) * p.r * R, y = cy + Math.sin(p.a) * p.r * R;
        ctx.globalAlpha = Math.min(1, p.al * (0.4 + p.r)); ctx.strokeStyle = ctx.fillStyle = this.dustColor || "#fff";
        if (this.warp > 0.25) { ctx.lineWidth = p.s * (0.6 + p.r); ctx.beginPath(); ctx.moveTo(cx + Math.cos(p.a) * pr * R, cy + Math.sin(p.a) * pr * R); ctx.lineTo(x, y); ctx.stroke(); }
        else { ctx.beginPath(); ctx.arc(x, y, p.s * (0.5 + p.r), 0, 6.283); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
    }
    loop(now) {
      if (!this.alive) return;
      if (document.hidden || (this.ql === 0 && (this._skip = !this._skip))) { if (document.hidden) this.last = now; this.raf = requestAnimationFrame((t) => this.loop(t)); return; }       // onglet caché : rien à dessiner ; qualité « léger » : 30 images / s
      const rdt = Math.min(0.05, (now - this.last) / 1000), dt = rdt * this.ts; this.last = now;
      const b = this.bg.getContext("2d"), f = this.fg.getContext("2d");
      b.clearRect(0, 0, this.W, this.H); f.clearRect(0, 0, this.W, this.H);
      this.drawOrbs(b, dt); this.drawDust(b, this.dustB, dt, 1); this.drawDust(f, this.dustF, dt, 1.6);
      if (this.dir && this.dir.embers && this.fx.part > 0.5 && Math.random() < 0.35) this.burst.push({ x: rnd(0, this.W), y: this.H + 6, vx: rnd(-18, 18), vy: rnd(-190, -80), life: rnd(1.4, 2.8), max: 2.8, c: Math.random() < 0.5 ? "#ff5a1a" : "#ff9a3a", s: rnd(1, 2.2) });   // braises qui montent (direction « Sang »)
      this.smoke = this.smoke.filter((p) => (p.life -= dt) > 0);
      if (this.smoke.length > 140) this.smoke.splice(0, this.smoke.length - 140);
      if (!this._spr) { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(24,18,34,.55)"); r.addColorStop(1, "rgba(24,18,34,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); this._spr = c; }
      for (const p of this.smoke) {                                                      // fumée / cendres : sprite flou PRÉ-RENDU (un drawImage au lieu d'un dégradé radial par particule et par image)
        if (p.d > 0) { p.d -= dt; p.life += dt; continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.grow * dt; f.globalAlpha = Math.max(0, p.life / p.max); f.drawImage(this._spr, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      }
      f.globalAlpha = 1;
      f.globalCompositeOperation = "lighter";
      this.burst = this.burst.filter((p) => (p.life -= dt) > 0); if (this.burst.length > 420) this.burst.splice(0, this.burst.length - 420);
      for (const p of this.burst) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.97; p.vy = p.vy * 0.97 + 120 * dt; const al = Math.max(0, p.life / p.max); f.fillStyle = p.c; f.globalAlpha = al * 0.3; f.fillRect(p.x - p.s, p.y - p.s, p.s * 3, p.s * 3); f.globalAlpha = al; f.fillRect(p.x, p.y, p.s, p.s); }      // halo = 2ᵉ carré translucide (shadowBlur coûtait très cher)
      if (this.sl) {                                                                                  // lignes de vitesse manga
        const q = this.sl, k = (now - q.t0) / q.ms;
        if (k >= 1) this.sl = null;
        else { f.globalAlpha = (1 - k) * 0.85; f.strokeStyle = "#fff"; f.lineWidth = 2; f.beginPath(); const R = Math.hypot(this.W, this.H); for (let i = 0; i < 26; i++) { const a = q.seed + i * 0.2417 * 6.28 % 6.28, r0 = R * (0.12 + 0.2 * k + (i % 5) * 0.03), r1 = r0 + R * (0.22 + (i % 3) * 0.08); f.moveTo(q.x + Math.cos(a) * r0, q.y + Math.sin(a) * r0); f.lineTo(q.x + Math.cos(a) * r1, q.y + Math.sin(a) * r1); } f.stroke(); }
      }
      f.globalCompositeOperation = "source-over"; f.globalAlpha = 1;
      this.warp *= Math.pow(0.12, rdt); if (this.warp < 0.02) this.warp = 0;
      // shake amorti + aberration chromatique (le filtre SVG n'est actif que pendant l'impact : il coûte cher)
      this.shake *= Math.pow(1e-5, rdt); this.chroma = this._strobeT && now < this._strobeT ? 25 : this.chroma * Math.pow(0.01, rdt);       // secousse amortie sur ~180 ms
      if (this.shake > 0.4) { const a = this.shake; this.shk.style.transform = `translate(${rnd(-a, a).toFixed(1)}px,${rnd(-a, a).toFixed(1)}px) rotate(${rnd(-a, a) * 0.05}deg)`; } else if (this.shk.style.transform) this.shk.style.transform = "";
      if (this.pm) {                                                                                  // flou de DÉPLACEMENT de la pièce qui glisse
        const m = this.pm, f = (now - m.t0) / m.ms;
        if (f >= 1.05 || !m.el.isConnected) { m.el.style.filter = ""; this.pm = null; }
        else { const a = m.amp * Math.sin(Math.PI * Math.min(1, f)); this.pmg.setAttribute("stdDeviation", `${(m.ux * a).toFixed(2)} ${(m.uy * a).toFixed(2)}`); }
      }
      this.shk2 *= Math.pow(0.02, rdt);                                                                // onde de choc : déformation radiale qui s'éteint
      const shOn = this.fx.shock && this.shk2 > 1.2; if (shOn) this.shd.setAttribute("scale", this.shk2.toFixed(1));
      const m = this.mb, k = Math.max(0, 1 - (now - m.t0) / m.ms), amp = this.fx.mblur ? m.k * k * k : 0, mbOn = amp > 0.35;
      if (mbOn) this.mbg.setAttribute("stdDeviation", `${Math.abs(m.x * amp).toFixed(2)} ${Math.abs(m.y * amp).toFixed(2)}`);
      const want = (mbOn ? "url(#ce-mb) " : "") + (shOn ? "url(#ce-sh)" : "");                           // un seul endroit décide du filtre de la scène (flou caméra + onde de choc)
      if (want !== this._want) { this.persp.style.filter = want; this._want = want; }
      // auto-qualité : si l'image saccade (moyenne > 30 ms sur ~1,5 s) on allège les effets d'un cran
      if (this.qAuto) { this.frames.push(rdt); if (this.frames.length >= 80) { const avg = this.frames.reduce((x, y) => x + y, 0) / this.frames.length; this.frames = []; if (avg > 0.03 && this.ql > 0) { this.ql--; this.applyQuality(); } } }
      if (this.chroma > 0.5 && this.fx.chroma) { this.abr.setAttribute("dx", this.chroma.toFixed(1)); this.abb.setAttribute("dx", (-this.chroma).toFixed(1)); this.abb.setAttribute("dy", (this.chroma * 0.4).toFixed(1)); this.wrap.style.filter = "url(#ce-ab)"; this._ab = true; }
      else if (this._ab) { this.wrap.style.filter = ""; this._ab = false; }
      this.drift.style.transform = `rotateZ(${(Math.sin((now - this.t0) / 2300) * 1.4).toFixed(2)}deg)`;                 // respiration lente entre deux impacts
      this.raf = requestAnimationFrame((t) => this.loop(t));
    }
    destroy() { this.alive = false; cancelAnimationFrame(this.raf); this.timers.forEach(clearTimeout); window.removeEventListener("resize", this._rs); this.host.classList.remove("ce-stage"); this.host.innerHTML = ""; }
  }

  E.editFx = { Stage, TONE, LOOKS, DIRECTIONS, fenMap, START };
})();
