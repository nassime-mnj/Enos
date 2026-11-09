"use strict";
// ICÔNES ANIMÉES D'ETO (écran 8-bit qui sourit) et d'E.N.O.S. (œil rouge) — le cadre métallique est l'image d'origine ; l'écran / l'œil sont REDESSINÉS en direct :
//   ETO    : sourire, clin d'œil, yeux qui regardent, « ^_^ » joyeux, surpris « O », triste, réfléchit, parle (bouche qui s'ouvre), clignements.
//   E.N.O.S: iris qui tourne, pupille qui regarde autour, clignement à volets, scan (paupières mi-closes + ligne de balayage), alerte (flash), verrouillage (viseur qui se resserre).
// Fonctions PURES du temps (aucun aléa non semé, pas de ctx.filter / getImageData / shadowBlur) : utilisables dans le rendu vidéo déterministe (60 FPS) ET dans le DOM.
// Repère de dessin : 830 × 830 px (image d'origine) ; draw() met à l'échelle.
(() => {
  const E = (window.ENOS = window.ENOS || {});
  const A = (E.animIcons = {});
  const TAU = Math.PI * 2, clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, k) => a + (b - a) * k, ease = (k) => k * k * (3 - 2 * k);
  A.IDS = { eto: { img: "img/bots/eto.png" }, enos: { img: "img/bots/enos.png" } };
  const rnd = (n) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

  // humeurs données par le type de réplique des personnages (js/bot_lines.js) ; tout le reste = « parle »
  const KIND_MOOD = {
    eto: { bot_brilliant: "wow", h_brilliant: "wow", super: "happy", good: "happy", best: "happy", mate_win: "happy", resign_win: "happy", winning: "happy", open_announce: "wink", greet: "wink", chat: "talk", check: "wow", check_received: "wow", bot_blunder: "sad", bot_mistake: "think", h_blunder: "happy", h_mistake: "wink", frustration: "sad", mate_lose: "sad", mate_danger: "wow", mate_coming: "happy", draw: "think", transform: "wow" },
    enos: { bot_brilliant: "alert", h_brilliant: "alert", super: "lock", good: "idle", best: "lock", mate_win: "lock", resign_win: "lock", winning: "scan", open_announce: "scan", greet: "scan", chat: "idle", check: "alert", check_received: "alert", bot_blunder: "alert", bot_mistake: "scan", h_blunder: "scan", h_mistake: "scan", frustration: "alert", mate_lose: "alert", mate_danger: "alert", mate_coming: "lock", draw: "scan", transform: "alert" },
  };
  A.moodOf = (id, kind) => (KIND_MOOD[id] && KIND_MOOD[id][kind]) || "talk";

  // ---------------------------------------------------------------- cycle libre (quand aucune humeur n'est imposée) : période 16 s
  A.autoMood = (id, t) => {
    const u = ((t % 16) + 16) % 16;
    if (id === "eto") return u < 3.3 ? "smile" : u < 5.2 ? "look" : u < 7.4 ? "smile" : u < 9.2 ? "happy" : u < 10.8 ? "smile" : u < 11.3 ? "wink" : u < 13.2 ? "think" : "smile";
    return u < 3.5 ? "idle" : u < 7 ? "scan" : u < 10 ? "idle" : u < 11.2 ? "alert" : u < 13.6 ? "lock" : "idle";
  };
  const blinking = (t) => { const a = t % 3.7, b = t % 9.1; return a < 0.13 || (b > 4.0 && b < 4.12) ? 1 : 0; };

  // ---------------------------------------------------------------- ETO
  function etoFace(g, t, mood, mt) {
    const CREAM = "252,246,210";
    const px = (x, y, w, h, c) => { const col = c || CREAM; g.fillStyle = `rgba(${col},.13)`; g.fillRect(x - 15, y - 15, w + 30, h + 30); g.fillStyle = `rgba(${col},.22)`; g.fillRect(x - 7, y - 7, w + 14, h + 14); g.fillStyle = `rgb(${col})`; g.fillRect(x, y, w, h); };
    g.save(); g.beginPath(); g.rect(281, 325, 288, 226); g.clip();
    g.fillStyle = "#020d13"; g.fillRect(281, 325, 288, 226);                                                    // fond de l'écran + grille d'origine
    g.fillStyle = "rgba(10,52,70,.95)"; for (let j = 0; j <= 9; j++) g.fillRect(314.5 + 31.6 * (j - 1) - 1.5, 325, 3, 226); for (let i = 1; i <= 10; i++) g.fillRect(281, 273 + 29.9 * i - 1.5, 288, 3);
    // expression
    let m = mood === "auto" ? A.autoMood("eto", t) : mood;
    const blink = blinking(t) && !["happy", "wow", "wink", "sad"].includes(m);
    const talkOpen = m === "talk" ? (rnd(Math.floor(t * 9)) > 0.42 ? (rnd(Math.floor(t * 9) + 7) > 0.5 ? 2 : 1) : 0) : 0;
    let gx = 0, gy = 0;
    if (m === "look") { const ph = ((t % 3.8) / 3.8); gx = ph < 0.3 ? -1 : ph < 0.55 ? 0 : ph < 0.85 ? 1 : 0; gy = 0; }
    if (m === "think") { gx = 0.8; gy = -1; }
    if (m === "smile" || m === "talk" || m === "happy") { gx = Math.sin(t * 0.7) * 0.25; }
    const dx = gx * 14, dy = gy * 10, EL = 348, ER = 499.5;
    const eyeBar = (cx, h, w) => { h = Math.max(9, Math.round(h / 9) * 9); px(cx - w / 2 + dx, 380 - h / 2 + dy, w, h); };
    const eyeHappy = (cx) => { for (let i = 0; i < 5; i++) px(cx - 27.5 + 11 * i, 350 + [27, 13.5, 0, 13.5, 27][i], 11, 20); };
    // yeux
    if (m === "happy") { eyeHappy(EL); eyeHappy(ER); }
    else if (m === "wink") { eyeBar(EL, 90, 36); px(ER - 22, 376, 44, 9); }
    else if (m === "wow") { eyeBar(EL, 108, 44); eyeBar(ER, 108, 44); }
    else if (m === "sad") { eyeBar(EL, 63, 36); eyeBar(ER, 63, 36); px(EL - 4, 428, 9, 18, "60,214,255"); px(ER + 2, 436, 9, 18, "60,214,255"); }
    else if (m === "think") { eyeBar(EL, 72, 36); eyeBar(ER, 99, 36); }
    else if (blink) { px(EL - 18, 376, 36, 9); px(ER - 18, 376, 36, 9); }
    else { eyeBar(EL, 90, 36); eyeBar(ER, 90, 36); }
    // bouche
    const smile = () => { px(288, 455, 34, 32); px(322, 487, 26, 28); px(347, 513, 156, 30); px(503, 487, 26, 28); px(530, 455, 33, 32); };
    if (m === "happy") { smile(); px(347, 487, 156, 26); }
    else if (m === "wow") { px(395, 472, 58, 12); px(395, 484, 14, 52); px(439, 484, 14, 52); px(395, 536, 58, 12); }
    else if (m === "sad") { px(288, 533, 34, 18); px(322, 505, 26, 28); px(347, 480, 156, 28); px(503, 505, 26, 28); px(530, 533, 33, 18); }
    else if (m === "think") { px(380, 505, 96, 24); }
    else if (m === "talk") { if (talkOpen === 0) px(347, 513, 156, 24); else if (talkOpen === 1) { px(363, 495, 124, 52); g.fillStyle = "#020d13"; g.fillRect(381, 513, 88, 16); } else { px(322, 487, 206, 26); px(347, 513, 156, 30); } }
    else if (m === "wink") { smile(); }
    else smile();
    // scintillement d'écran : une ligne balaye le visage toutes les 6 s, et un « glitch » d'une image à chaque changement d'humeur
    const sw = ((t % 6) / 6) * 1.35 - 0.15; if (sw > 0 && sw < 1) { g.fillStyle = "rgba(120,230,255,.10)"; g.fillRect(281, 325 + sw * 226, 288, 9); }
    if (mt != null && mt >= 0 && mt < 0.1) { g.fillStyle = "rgba(255,255,255,.18)"; g.fillRect(281, 325 + rnd(Math.floor(t * 60)) * 200, 288, 18); }
    g.restore();
  }

  // ---------------------------------------------------------------- E.N.O.S.
  function enosEye(g, t, mood, mt) {
    const CX = 415, CY = 418, m = mood === "auto" ? A.autoMood("enos", t) : mood;
    const k = clamp((mt == null ? 9 : mt) / 0.3, 0, 1), ek = ease(k);
    g.save(); g.beginPath(); g.arc(CX, CY, 198, 0, TAU); g.clip(); g.translate(CX, CY);
    let bg = g.createRadialGradient(0, 0, 20, 0, 0, 198); bg.addColorStop(0, "#1c0000"); bg.addColorStop(1, "#040000"); g.fillStyle = bg; g.fillRect(-200, -200, 400, 400);
    // regard
    let gx = Math.sin(t * 0.9) * 0.55 + Math.sin(t * 2.3) * 0.2, gy = Math.sin(t * 0.7 + 1) * 0.4;
    if (m === "scan") { gx = Math.sin(t * 2.2) * 0.95; gy = 0.05; }
    else if (m === "lock") { gx = 0.04 * Math.sin(t * 9); gy = 0.04 * Math.cos(t * 8); }
    else if (m === "alert") { gx = Math.sin(t * 14) * 0.08; gy = Math.cos(t * 12) * 0.08; }
    else if (m === "think") { gx = Math.cos(t * 3) * 0.5; gy = Math.sin(t * 3) * 0.5; }
    const spin = t * (m === "alert" ? 1.6 : m === "think" ? 1.1 : m === "scan" ? 0.7 : 0.25), pulse = 1 + 0.03 * Math.sin(t * 3) + (m === "alert" ? 0.07 * Math.abs(Math.sin(t * 9)) : 0);
    const lockK = m === "lock" ? ek : 0, ox = gx * 20, oy = gy * 20;
    // arcs extérieurs (rayon 168) qui tournent
    g.lineCap = "butt"; [[9, 0.28], [4, 1]].forEach(([w, a]) => { g.strokeStyle = `rgba(255,30,16,${a})`; g.lineWidth = w + (a < 1 ? 8 : 0); for (let i = 0; i < 4; i++) { const c = (i * TAU) / 4 + TAU / 8 + (m === "scan" ? Math.sin(t * 2) * 0.2 : spin * 0.3); g.beginPath(); g.arc(0, 0, lerp(168, 128, lockK), c - 0.62, c + 0.62); g.stroke(); } });
    // traits du viseur (en croix)
    const tickIn = lerp(150, 108, lockK) + (m === "alert" ? 14 * Math.abs(Math.sin(t * 9)) : 0), tickOut = lerp(192, 150, lockK);
    g.fillStyle = "#ff4a33"; for (let i = 0; i < 4; i++) { g.save(); g.rotate((i * TAU) / 4); g.fillRect(tickIn, -4.5, tickOut - tickIn, 9); g.restore(); }
    // iris
    g.save(); g.translate(ox, oy); g.scale(pulse, pulse);
    const ir = g.createRadialGradient(0, 0, 8, 0, 0, 118); ir.addColorStop(0, "#ff7a5c"); ir.addColorStop(0.2, "#e60c0c"); ir.addColorStop(0.55, "#b00000"); ir.addColorStop(0.85, "#650000"); ir.addColorStop(1, "#2a0000"); g.fillStyle = ir; g.beginPath(); g.arc(0, 0, 118, 0, TAU); g.fill();
    g.strokeStyle = "rgba(40,0,0,.8)"; g.lineWidth = 4; [62, 88, 112].forEach((r) => { g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); });
    g.save(); g.rotate(spin); g.strokeStyle = "rgba(30,0,0,.55)"; g.lineWidth = 5; for (let i = 0; i < 12; i++) { const a = (i * TAU) / 12; g.beginPath(); g.moveTo(Math.cos(a) * 38, Math.sin(a) * 38); g.lineTo(Math.cos(a) * 116, Math.sin(a) * 116); g.stroke(); } g.restore();
    g.save(); g.rotate(spin * 0.6 + 1.2); g.fillStyle = "rgba(255,170,130,.5)"; g.beginPath(); g.arc(0, 0, 100, 0.2, 0.75); g.arc(0, 0, 56, 0.75, 0.2, true); g.closePath(); g.fill(); g.restore();                              // reflet de l'iris
    g.restore();
    // pupille
    const pr = (m === "lock" ? 13 : m === "alert" ? 27 : m === "think" ? 17 : 20) * pulse + (m === "idle" ? 1.5 * Math.sin(t * 2) : 0);
    g.save(); g.translate(ox * 1.9, oy * 1.9); g.fillStyle = "rgba(255,60,40,.35)"; g.beginPath(); g.arc(0, 0, pr + 12, 0, TAU); g.fill(); g.fillStyle = "#fda278"; g.fillRect(-pr, -pr, pr * 2, pr * 2); g.fillStyle = "#fff"; g.fillRect(-pr * 0.5, -pr * 0.5, pr * 0.5, pr * 0.5); g.restore();       // pupille carrée « 8 bit »
    // flash d'alerte
    if (m === "alert") { g.fillStyle = `rgba(255,40,20,${0.12 + 0.16 * Math.abs(Math.sin(t * 9))})`; g.fillRect(-200, -200, 400, 400); }
    // ligne de balayage
    if (m === "scan") { const sy = Math.sin(t * 3.1) * 150; g.fillStyle = "rgba(255,120,90,.55)"; g.fillRect(-190, sy - 3, 380, 6); g.fillStyle = "rgba(255,60,40,.2)"; g.fillRect(-190, sy - 14, 380, 28); }
    if (m === "think") { for (let i = 0; i < 3; i++) { const on = Math.floor(t * 4) % 3 === i; g.fillStyle = on ? "#ff8a6a" : "#5a0808"; g.fillRect(-34 + i * 30, 150, 16, 16); } }
    // paupières à volets (clignement, scan = mi-clos, sommeil)
    let lid = blinking(t) ? 1 : 0; if (m === "scan") lid = Math.max(lid, 0.42 + 0.05 * Math.sin(t * 2)); if (m === "angry") lid = Math.max(lid, 0.3);
    if (mt != null && mt < 0.3 && ["alert", "wow"].includes(m)) lid = Math.max(lid, 1 - ek);                  // ouverture brusque quand l'alerte arrive
    if (lid > 0) { const h = lid * 200; g.fillStyle = "#050000"; g.fillRect(-200, -200, 400, h); g.fillRect(-200, 200 - h, 400, h); g.fillStyle = "#ff3a28"; g.fillRect(-200, -200 + h - 4, 400, 4); g.fillRect(-200, 200 - h, 400, 4); }
    g.restore();
  }

  /** Dessine l'icône animée. im = image d'origine ; size = côté en pixels (du dessin) ; t = temps (s) ; mood = humeur ('auto' = cycle libre) ; mt = secondes depuis le début de l'humeur. */
  A.draw = (g, id, im, cx, cy, size, t, mood, mt) => {
    if (!im) return;
    g.save(); g.translate(cx - size / 2, cy - size / 2); g.scale(size / 830, size / 830);
    g.drawImage(im, 0, 0, 830, 830);
    if (id === "eto") etoFace(g, t, mood || "auto", mt); else if (id === "enos") enosEye(g, t, mood || "auto", mt);
    g.restore();
  };

  // ---------------------------------------------------------------- DOM : <canvas class="bot-anim" data-bot="eto"> (avatars de la chat box), ~15 images / s
  const imgs = {}, list = new Set(); let timer = 0, last = 0;
  const base = () => E.assetBase || "";
  const need = (id) => (imgs[id] ||= (() => { const im = new Image(); im.src = base() + A.IDS[id].img; return im; })());
  A.canvas = (id, cls) => `<canvas class="bot-av bot-anim ${cls || ""}" data-bot="${id}" width="164" height="164"></canvas>`;
  A.mood = (el, mood, ms) => { if (!el || !el.dataset) return; el.dataset.mood = mood || ""; el._mt = performance.now(); clearTimeout(el._mto); if (mood && ms) el._mto = setTimeout(() => { el.dataset.mood = ""; el._mt = performance.now(); }, ms); };
  function tickAll(now) {
    if (now - last < 66) return; last = now;
    document.querySelectorAll("canvas.bot-anim").forEach((c) => {
      if (!c.isConnected || c.offsetParent === null) return;
      const id = c.dataset.bot, im = need(id); if (!im || !im.complete || !im.naturalWidth) return;
      const g = c.getContext("2d"), t = now / 1000; g.clearRect(0, 0, c.width, c.height);
      A.draw(g, id, im, c.width / 2, c.height / 2, c.width, t, c.dataset.mood || "auto", c._mt != null ? (now - c._mt) / 1000 : null);
    });
  }
  A.start = () => { if (timer) return; const loop = (now) => { timer = requestAnimationFrame(loop); if (document.hidden) return; if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) { if (now - last > 800) tickAll(now + 1000); return; } tickAll(now); }; timer = requestAnimationFrame(loop); };
  if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("DOMContentLoaded", A.start); if (typeof document !== "undefined" && document.readyState !== "loading") A.start();
})();
