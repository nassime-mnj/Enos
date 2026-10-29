"use strict";
// PURGE.EXE : survivor-roguelike d'E.N.O.S. Tu déplaces l'œil d'E.N.O.S. (souris, doigt, ZQSD/flèches) ; lasers, ondes de choc, antivirus et pare-feu partent tout seuls.
// Des centaines de virus convergent vers l'œil. Jauge d'XP pleine -> pause + 3 « mises à jour système » tirées au hasard.
// Moteur : un seul <canvas>, ennemis en tableaux typés (aucune allocation dans la boucle), un tracé groupé par type d'ennemi, pas de shadowBlur -> 60 FPS même sur téléphone.
// Même fichier sur PC (static/games/purge.js) et sur mobile (android/assets/mobile/js/purge.js). API : ENOSPurge.mount(élément, {onExit}) -> {destroy(), state, pause()}.
(() => {
  const TAU = Math.PI * 2, RED = "#ff4d63", CYAN = "#1acfd6", GOLD = "#f5c542";
  const MAXE = 700, MAXG = 600, MAXP = 260;
  const TYPES = [                                                    // 0 bit · 1 ver · 2 trojan · 3 spectre (rapide) · 4 rootkit (élite)
    { n: "Bit", r: 7, hp: 3, sp: 62, dmg: 6, xp: 1, col: "#ff6b81", sides: 3 },
    { n: "Ver", r: 10, hp: 9, sp: 46, dmg: 9, xp: 2, col: "#ffa94d", sides: 4 },
    { n: "Trojan", r: 15, hp: 34, sp: 32, dmg: 14, xp: 5, col: "#c77dff", sides: 6 },
    { n: "Spectre", r: 8, hp: 5, sp: 105, dmg: 7, xp: 2, col: "#4dd0e1", sides: 3 },
    { n: "Rootkit", r: 34, hp: 700, sp: 28, dmg: 26, xp: 60, col: "#ff2d55", sides: 8 },
  ];

  // ---------------------------------------------------------------- mises à jour système (3 tirées au hasard à chaque niveau)
  // [id, titre, description (par niveau), niveau max, nouveau ?]
  const UPG = [
    ["rate", "Surcharge CPU", "Cadence de tir +20 %", 8],
    ["dmg", "Compilateur optimisé", "Dégâts des lasers +25 %", 8],
    ["multi", "Multithread", "+1 laser simultané", 4],
    ["pierce", "Rayon perforant", "Les lasers traversent +1 virus", 4],
    ["wave", "Onde de choc+", "Rayon des ondes +20 %", 6],
    ["waverate", "Résonance", "Ondes de choc 20 % plus fréquentes", 6],
    ["av", "Antivirus", "Aura qui détruit les virus proches (dégâts de zone)", 8],
    ["fw", "Pare-feu", "+1 lame orbitale protectrice", 6],
    ["speed", "Overclock GPU", "Vitesse de l'œil +12 %", 5],
    ["magnet", "Cache L3", "Portée de collecte de l'XP +35 %", 5],
    ["hp", "Sauvegarde système", "+25 PV max et soin complet", 6],
    ["regen", "Refroidissement liquide", "Régénère 0,6 PV/s", 5],
    ["xp", "Compression de données", "XP gagnée +15 %", 5],
  ];

  const css = `.pg-root{position:relative;width:100%;height:100%;background:#06060a;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#fff}
.pg-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.pg-top{position:absolute;left:0;right:0;top:0;display:flex;gap:8px;align-items:center;padding:8px 10px;pointer-events:none;font:700 12px system-ui;letter-spacing:.06em}
.pg-top .pg-sp{flex:1}.pg-x{pointer-events:auto;background:#14141a;color:#fff;border:1px solid #333;border-radius:8px;padding:6px 10px;font:700 12px system-ui}
.pg-over{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(4,4,8,.82);padding:16px;text-align:center}
.pg-over h2{margin:0;font:800 22px system-ui;letter-spacing:.08em;color:${CYAN}}.pg-over p{margin:0;color:#9a9aa6;font-size:13px}
.pg-cards{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;max-width:760px}
.pg-card{width:210px;min-height:120px;background:linear-gradient(160deg,#14141c,#0b0b10);border:1px solid #2c2c38;border-radius:14px;padding:14px;text-align:left;cursor:pointer;color:#fff;font:inherit;transition:transform .12s,border-color .12s}
.pg-card:hover,.pg-card:focus-visible{border-color:${CYAN};transform:translateY(-3px);outline:none}.pg-card b{display:block;font:800 15px system-ui;margin-bottom:6px;color:${CYAN}}.pg-card small{display:block;color:#b8b8c4;font-size:13px;line-height:1.35}
.pg-card i{display:block;font-style:normal;color:${GOLD};font-size:11px;margin-top:8px;letter-spacing:.08em}
.pg-btn{background:${RED};color:#fff;border:0;border-radius:12px;padding:12px 22px;font:800 15px system-ui;letter-spacing:.06em;cursor:pointer}
.pg-btn.alt{background:#1b1b24;border:1px solid #333}
@media (max-width:560px){.pg-card{width:100%;min-height:0}}`;

  function mount(host, opt) {
    opt = opt || {};
    const root = document.createElement("div"); root.className = "pg-root";
    const st = document.createElement("style"); st.textContent = css; root.appendChild(st);
    const cv = document.createElement("canvas"); root.appendChild(cv);
    const top = document.createElement("div"); top.className = "pg-top"; top.innerHTML = '<span id="pg-lv"></span><span class="pg-sp"></span><span id="pg-fps" style="opacity:.5"></span><button class="pg-x" id="pg-pause">⏸</button>' + (opt.onExit ? '<button class="pg-x" id="pg-exit">✕</button>' : "");
    root.appendChild(top); host.appendChild(root);
    const ctx = cv.getContext("2d", { alpha: false });
    const touch = matchMedia("(pointer:coarse)").matches;
    const cap = touch ? 380 : MAXE;
    let W = 0, H = 0, dpr = 1;
    const resize = () => { dpr = Math.min(2, window.devicePixelRatio || 1); W = host.clientWidth || 360; H = host.clientHeight || 640; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize(); const ro = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null; if (ro) ro.observe(host);

    // ---- état (tableaux typés : zéro allocation par image)
    const ex = new Float32Array(MAXE), ey = new Float32Array(MAXE), ehp = new Float32Array(MAXE), et = new Uint8Array(MAXE), eflash = new Float32Array(MAXE), ewave = new Int32Array(MAXE), ea = new Float32Array(MAXE);
    const gx = new Float32Array(MAXG), gy = new Float32Array(MAXG), gv = new Float32Array(MAXG);
    const px = new Float32Array(MAXP), py = new Float32Array(MAXP), pvx = new Float32Array(MAXP), pvy = new Float32Array(MAXP), pl = new Float32Array(MAXP), pc = new Uint8Array(MAXP);
    let ne = 0, ng = 0, np = 0;
    const beams = [];                                                              // lasers visibles (courte durée)
    const waves = [];                                                              // ondes de choc {r, max, id}
    const S = { running: true, paused: false, over: false, choosing: false, t: 0, kills: 0, lvl: 1, xp: 0, need: 6, hp: 100, hpMax: 100, x: 0, y: 0, tx: 0, ty: 0, face: 0, inv: 0,
      up: {}, fireT: 0, waveT: 0, avT: 0, spawnAcc: 0, eliteT: 45, waveId: 0, shake: 0, best: 0, fps: 60 };
    UPG.forEach((u) => (S.up[u[0]] = 0));
    S.x = S.tx = W / 2; S.y = S.ty = H / 2;
    try { S.best = +localStorage.getItem("enos.purge.best") || 0; } catch (e) { /* stockage indisponible */ }

    // ---- statistiques dérivées des mises à jour
    const lv = (k) => S.up[k] || 0;
    const fireEvery = () => 0.85 / (1 + 0.2 * lv("rate"));
    const laserDmg = () => 5 * (1 + 0.25 * lv("dmg"));
    const beamCount = () => 1 + lv("multi");
    const waveEvery = () => 3.4 / (1 + 0.2 * lv("waverate"));
    const waveMax = () => 120 * (1 + 0.2 * lv("wave"));
    const speed = () => 175 * (1 + 0.12 * lv("speed"));
    const magnet = () => 70 * (1 + 0.35 * lv("magnet"));
    const avR = () => 70 + 14 * lv("av");
    const blades = () => lv("fw");

    // ---- apparition
    function spawn(type, ang) {
      if (ne >= cap) return;
      const T = TYPES[type], d = Math.hypot(W, H) / 2 + 30, i = ne++;
      ex[i] = S.x + Math.cos(ang) * d; ey[i] = S.y + Math.sin(ang) * d; et[i] = type; ewave[i] = -1; eflash[i] = 0; ea[i] = Math.random() * TAU;
      ehp[i] = T.hp * (1 + S.t / 150) * (type === 4 ? 1 + S.t / 240 : 1);
    }
    const kill = (i, byWave) => {
      const T = TYPES[et[i]];
      if (ng < MAXG) { gx[ng] = ex[i]; gy[ng] = ey[i]; gv[ng] = T.xp; ng++; }
      else gv[(Math.random() * MAXG) | 0] += T.xp;
      for (let k = 0; k < (T.r > 12 ? 7 : 3) && np < MAXP; k++) { const a = Math.random() * TAU, s = 40 + Math.random() * 110; px[np] = ex[i]; py[np] = ey[i]; pvx[np] = Math.cos(a) * s; pvy[np] = Math.sin(a) * s; pl[np] = 0.35; pc[np] = et[i]; np++; }
      S.kills++; if (et[i] === 4) S.shake = 0.5;
      ne--; ex[i] = ex[ne]; ey[i] = ey[ne]; ehp[i] = ehp[ne]; et[i] = et[ne]; eflash[i] = eflash[ne]; ewave[i] = ewave[ne]; ea[i] = ea[ne];   // retrait en O(1) (le dernier prend la place)
    };
    const hit = (i, dmg) => { ehp[i] -= dmg; eflash[i] = 0.08; };

    function spawner(dt) {
      const rate = (1.6 + S.t / 11) * (touch ? 0.8 : 1);                           // virus par seconde : croît avec le temps
      S.spawnAcc += rate * dt;
      while (S.spawnAcc >= 1) {
        S.spawnAcc -= 1;
        const r = Math.random(), m = S.t;
        const type = r < 0.55 ? 0 : r < 0.55 + Math.min(0.3, m / 300) ? 1 : r < 0.9 && m > 50 ? 2 : m > 25 ? 3 : 0;
        const base = Math.random() * TAU, pack = type === 3 ? 3 : 1;
        for (let k = 0; k < pack; k++) spawn(type, base + (Math.random() - 0.5) * 0.5);
      }
      S.eliteT -= dt; if (S.eliteT <= 0) { S.eliteT = 55; spawn(4, Math.random() * TAU); }
    }

    // ---- armes automatiques
    function fire() {
      if (!ne) return;
      const used = new Set();                                                       // chaque laser vise un virus différent (le plus proche non visé)
      for (let b = 0; b < beamCount(); b++) {
        let bi = -1, bd = 1e12;
        for (let i = 0; i < ne; i++) { if (used.has(i)) continue; const dx = ex[i] - S.x, dy = ey[i] - S.y, d = dx * dx + dy * dy; if (d < bd) { bd = d; bi = i; } }
        if (bi < 0) break;
        used.add(bi);
        const a = Math.atan2(ey[bi] - S.y, ex[bi] - S.x), ca = Math.cos(a), sa = Math.sin(a), L = Math.hypot(W, H), dmg = laserDmg();
        let pierce = 1 + lv("pierce");
        const hits = [];
        for (let i = 0; i < ne; i++) {                                              // virus proches du segment (distance à la droite)
          const dx = ex[i] - S.x, dy = ey[i] - S.y, along = dx * ca + dy * sa;
          if (along < 0 || along > L) continue;
          if (Math.abs(-dx * sa + dy * ca) < TYPES[et[i]].r + 4) hits.push([along, i]);
        }
        hits.sort((p, q) => p[0] - q[0]);
        for (let k = 0; k < hits.length && pierce > 0; k++, pierce--) hit(hits[k][1], dmg);
        beams.push({ a, len: hits.length && pierce <= 0 ? hits[Math.min(hits.length, 1 + lv("pierce")) - 1][0] : L, t: 0.09 });
      }
    }
    function shock() { waves.push({ r: 8, max: waveMax(), id: ++S.waveId }); }
    function auraTick() {
      const R = avR(), dmg = 2.2 + 1.3 * lv("av");
      for (let i = 0; i < ne; i++) { const dx = ex[i] - S.x, dy = ey[i] - S.y; if (dx * dx + dy * dy < (R + TYPES[et[i]].r) * (R + TYPES[et[i]].r)) hit(i, dmg); }
    }

    // ---- boucle de simulation
    function update(dt) {
      S.t += dt;
      // déplacement de l'œil vers la cible (souris/doigt) + clavier
      const kx = (keys.d || keys.arrowright ? 1 : 0) - (keys.q || keys.a || keys.arrowleft ? 1 : 0), ky = (keys.s || keys.arrowdown ? 1 : 0) - (keys.z || keys.w || keys.arrowup ? 1 : 0);
      if (kx || ky) { const n = Math.hypot(kx, ky); S.x += kx / n * speed() * dt; S.y += ky / n * speed() * dt; S.tx = S.x; S.ty = S.y; }
      else { const dx = S.tx - S.x, dy = S.ty - S.y, d = Math.hypot(dx, dy); if (d > 3) { const m = Math.min(d, speed() * dt); S.x += dx / d * m; S.y += dy / d * m; S.face = Math.atan2(dy, dx); } }
      S.x = Math.max(14, Math.min(W - 14, S.x)); S.y = Math.max(14, Math.min(H - 14, S.y));
      if (S.inv > 0) S.inv -= dt;
      S.hp = Math.min(S.hpMax, S.hp + 0.6 * lv("regen") * dt);
      spawner(dt);
      S.fireT -= dt; if (S.fireT <= 0) { S.fireT = fireEvery(); fire(); }
      S.waveT -= dt; if (S.waveT <= 0) { S.waveT = waveEvery(); shock(); }
      if (lv("av")) { S.avT -= dt; if (S.avT <= 0) { S.avT = 0.25; auraTick(); } }
      for (let b = beams.length - 1; b >= 0; b--) if ((beams[b].t -= dt) <= 0) beams.splice(b, 1);
      for (let w = waves.length - 1; w >= 0; w--) {                                  // l'onde touche chaque virus UNE fois, au passage
        const o = waves[w]; o.r += 330 * dt;
        const lo = o.r - 16, dmg = 9 + 2 * lv("wave");
        for (let i = 0; i < ne; i++) { if (ewave[i] === o.id) continue; const d = Math.hypot(ex[i] - S.x, ey[i] - S.y); if (d <= o.r + TYPES[et[i]].r && d >= lo - TYPES[et[i]].r) { ewave[i] = o.id; hit(i, dmg); const k = 14 / (d + 1); ex[i] += (ex[i] - S.x) * k; ey[i] += (ey[i] - S.y) * k; } }
        if (o.r >= o.max) waves.splice(w, 1);
      }
      // lames du pare-feu
      const nb = blades();
      if (nb) for (let k = 0; k < nb; k++) {
        const a = S.t * 3.2 + k * TAU / nb, bx = S.x + Math.cos(a) * 52, by = S.y + Math.sin(a) * 52;
        for (let i = 0; i < ne; i++) { const dx = ex[i] - bx, dy = ey[i] - by, rr = TYPES[et[i]].r + 9; if (dx * dx + dy * dy < rr * rr) hit(i, 60 * dt * 4); }
      }
      // virus : ils convergent vers l'œil ; contact = dégâts
      for (let i = 0; i < ne; i++) {
        const T = TYPES[et[i]], dx = S.x - ex[i], dy = S.y - ey[i], d = Math.hypot(dx, dy) || 1;
        const wob = Math.sin(S.t * 3 + ea[i]) * 0.35, c = Math.cos(wob), s = Math.sin(wob);
        const vx = (dx / d * c - dy / d * s) * T.sp, vy = (dx / d * s + dy / d * c) * T.sp;
        ex[i] += vx * dt; ey[i] += vy * dt;
        if (eflash[i] > 0) eflash[i] -= dt;
        if (d < T.r + 11 && S.inv <= 0) { S.hp -= T.dmg; S.inv = 0.5; S.shake = Math.max(S.shake, 0.18); }
      }
      for (let i = ne - 1; i >= 0; i--) if (ehp[i] <= 0) kill(i);
      // XP : aimant puis ramassage
      const mg = magnet();
      for (let i = ng - 1; i >= 0; i--) {
        const dx = S.x - gx[i], dy = S.y - gy[i], d = Math.hypot(dx, dy);
        if (d < mg) { const k = Math.min(1, (260 + (mg - d) * 4) * dt / (d || 1)); gx[i] += dx * k; gy[i] += dy * k; }
        if (d < 14) { S.xp += gv[i] * (1 + 0.15 * lv("xp")); ng--; gx[i] = gx[ng]; gy[i] = gy[ng]; gv[i] = gv[ng]; }
      }
      for (let i = np - 1; i >= 0; i--) { px[i] += pvx[i] * dt; py[i] += pvy[i] * dt; if ((pl[i] -= dt) <= 0) { np--; px[i] = px[np]; py[i] = py[np]; pvx[i] = pvx[np]; pvy[i] = pvy[np]; pl[i] = pl[np]; pc[i] = pc[np]; } }
      if (S.shake > 0) S.shake -= dt;
      if (S.hp <= 0) return gameOver();
      if (S.xp >= S.need) levelUp();
    }

    // ---- rendu
    function draw() {
      const sh = S.shake > 0 ? (Math.random() - 0.5) * 6 * Math.min(1, S.shake * 3) : 0;
      ctx.setTransform(dpr, 0, 0, dpr, sh * dpr, sh * dpr);
      ctx.fillStyle = "#06060a"; ctx.fillRect(-10, -10, W + 20, H + 20);
      ctx.strokeStyle = "rgba(26,207,214,.07)"; ctx.lineWidth = 1; ctx.beginPath();
      const off = (S.t * 12) % 48;
      for (let x = -off; x < W; x += 48) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = -off; y < H; y += 48) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
      // XP
      ctx.fillStyle = CYAN; ctx.beginPath();
      for (let i = 0; i < ng; i++) ctx.rect(gx[i] - 2.5, gy[i] - 2.5, 5, 5);
      ctx.fill();
      // virus : un seul tracé par type
      for (let t = 0; t < TYPES.length; t++) {
        const T = TYPES[t]; ctx.fillStyle = T.col; ctx.beginPath();
        for (let i = 0; i < ne; i++) {
          if (et[i] !== t || eflash[i] > 0) continue;
          const a = Math.atan2(S.y - ey[i], S.x - ex[i]);
          for (let k = 0; k < T.sides; k++) { const aa = a + k * TAU / T.sides, X = ex[i] + Math.cos(aa) * T.r, Y = ey[i] + Math.sin(aa) * T.r; k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
          ctx.closePath();
        }
        ctx.fill();
      }
      ctx.fillStyle = "#fff"; ctx.beginPath();                                      // virus touchés : flash blanc
      for (let i = 0; i < ne; i++) if (eflash[i] > 0) ctx.rect(ex[i] - TYPES[et[i]].r * 0.8, ey[i] - TYPES[et[i]].r * 0.8, TYPES[et[i]].r * 1.6, TYPES[et[i]].r * 1.6);
      ctx.fill();
      // particules
      for (let i = 0; i < np; i++) { ctx.globalAlpha = Math.max(0, pl[i] / 0.35); ctx.fillStyle = TYPES[pc[i]].col; ctx.fillRect(px[i] - 1.5, py[i] - 1.5, 3, 3); }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "lighter";
      // aura antivirus
      if (lv("av")) { ctx.strokeStyle = "rgba(26,207,214,.28)"; ctx.fillStyle = "rgba(26,207,214,.05)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(S.x, S.y, avR(), 0, TAU); ctx.fill(); ctx.stroke(); }
      // ondes de choc
      ctx.lineWidth = 5;
      for (const o of waves) { ctx.strokeStyle = `rgba(255,77,99,${Math.max(0, 0.75 * (1 - o.r / o.max))})`; ctx.beginPath(); ctx.arc(S.x, S.y, o.r, 0, TAU); ctx.stroke(); }
      // lasers
      for (const b of beams) {
        ctx.strokeStyle = `rgba(255,255,255,${b.t / 0.09})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(S.x, S.y); ctx.lineTo(S.x + Math.cos(b.a) * b.len, S.y + Math.sin(b.a) * b.len); ctx.stroke();
        ctx.strokeStyle = `rgba(255,77,99,${0.5 * b.t / 0.09})`; ctx.lineWidth = 9; ctx.stroke();
      }
      // lames
      const nb = blades(); ctx.fillStyle = GOLD;
      for (let k = 0; k < nb; k++) { const a = S.t * 3.2 + k * TAU / nb; ctx.beginPath(); ctx.arc(S.x + Math.cos(a) * 52, S.y + Math.sin(a) * 52, 8, 0, TAU); ctx.fill(); }
      ctx.globalCompositeOperation = "source-over";
      // l'œil d'E.N.O.S.
      const blink = S.inv > 0 && ((S.t * 20) | 0) % 2 === 0;
      if (!blink) {
        ctx.fillStyle = "#f4f4f8"; ctx.beginPath(); ctx.ellipse(S.x, S.y, 16, 11, 0, 0, TAU); ctx.fill();
        const ix = S.x + Math.cos(S.face) * 5, iy = S.y + Math.sin(S.face) * 3.5;
        ctx.fillStyle = RED; ctx.beginPath(); ctx.arc(ix, iy, 6.5, 0, TAU); ctx.fill();
        ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(ix, iy, 2.8, 0, TAU); ctx.fill();
      }
      // HUD
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#1a1a22"; ctx.fillRect(0, H - 8, W, 8);
      ctx.fillStyle = CYAN; ctx.fillRect(0, H - 8, W * Math.min(1, S.xp / S.need), 8);
      const bw = Math.min(220, W * 0.5);
      ctx.fillStyle = "#1a1a22"; ctx.fillRect(W / 2 - bw / 2, H - 24, bw, 8);
      ctx.fillStyle = S.hp / S.hpMax < 0.3 ? RED : "#7bd64d"; ctx.fillRect(W / 2 - bw / 2, H - 24, bw * Math.max(0, S.hp / S.hpMax), 8);
      const el = top.firstChild; const tt = `NIV ${S.lvl} · ${Math.floor(S.t / 60)}:${String(Math.floor(S.t % 60)).padStart(2, "0")} · ✖ ${S.kills}`;
      if (el.textContent !== tt) el.textContent = tt;
    }

    // ---- niveau / fin / menus
    function overlay(html) { const o = document.createElement("div"); o.className = "pg-over"; o.innerHTML = html; root.appendChild(o); return o; }
    function levelUp() {
      S.xp -= S.need; S.lvl++; S.need = Math.round(S.need * 1.28 + 3); S.choosing = true;
      const pool = UPG.filter((u) => lv(u[0]) < u[3]);
      const pick = []; while (pick.length < 3 && pool.length) pick.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
      if (!pick.length) { S.choosing = false; return; }
      const o = overlay(`<h2>MISE À JOUR SYSTÈME</h2><p>Niveau ${S.lvl} · choisis une amélioration</p><div class="pg-cards">${pick.map((u, i) => `<button class="pg-card" data-i="${i}"><b>${u[1]}</b><small>${u[2]}</small><i>NIVEAU ${lv(u[0]) + 1} / ${u[3]}</i></button>`).join("")}</div>`);
      o.onclick = (e) => {
        const b = e.target.closest(".pg-card"); if (!b) return;
        const u = pick[+b.dataset.i]; S.up[u[0]]++;
        if (u[0] === "hp") { S.hpMax += 25; S.hp = S.hpMax; }
        o.remove(); S.choosing = false; last = performance.now();
      };
      const first = o.querySelector(".pg-card"); if (first) first.focus({ preventScroll: true });
    }
    function gameOver() {
      S.over = true; S.running = false;
      const score = S.kills + Math.floor(S.t) * 2, isBest = score > S.best;
      if (isBest) { S.best = score; try { localStorage.setItem("enos.purge.best", String(score)); } catch (e) { /* ignoré */ } }
      const o = overlay(`<h2 style="color:${RED}">SYSTÈME COMPROMIS</h2><p>Survécu ${Math.floor(S.t / 60)} min ${Math.floor(S.t % 60)} s · ${S.kills} virus purgés · niveau ${S.lvl}</p><p>Score ${score}${isBest ? " · NOUVEAU RECORD ✦" : " · record " + S.best}</p><div><button class="pg-btn" id="pg-again">REJOUER</button> ${opt.onExit ? '<button class="pg-btn alt" id="pg-quit">QUITTER</button>' : ""}</div>`);
      o.querySelector("#pg-again").onclick = () => { o.remove(); reset(); };
      const q = o.querySelector("#pg-quit"); if (q) q.onclick = () => opt.onExit();
    }
    function reset() {
      ne = ng = np = 0; beams.length = waves.length = 0;
      Object.assign(S, { running: true, paused: false, over: false, choosing: false, t: 0, kills: 0, lvl: 1, xp: 0, need: 6, hp: 100, hpMax: 100, x: W / 2, y: H / 2, tx: W / 2, ty: H / 2, inv: 0, fireT: 0, waveT: 1, avT: 0, spawnAcc: 0, eliteT: 45, shake: 0 });
      UPG.forEach((u) => (S.up[u[0]] = 0)); last = performance.now();
    }
    let pauseBox = null;
    function setPause(on) {
      if (S.over || S.choosing) return;
      S.paused = on; top.querySelector("#pg-pause").textContent = on ? "▶" : "⏸";
      if (on && !pauseBox) { pauseBox = overlay(`<h2>PAUSE</h2><p>Déplace l'œil avec la souris, le doigt ou ZQSD / flèches. Les armes partent toutes seules.</p><button class="pg-btn" id="pg-res">REPRENDRE</button>`); pauseBox.querySelector("#pg-res").onclick = () => setPause(false); }
      if (!on && pauseBox) { pauseBox.remove(); pauseBox = null; last = performance.now(); }
    }

    // ---- entrées
    const keys = {};
    const kd = (e) => { const k = e.key.toLowerCase(); if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault(); if (k === "escape" || k === "p") return setPause(!S.paused); keys[k] = true; };
    const ku = (e) => { delete keys[e.key.toLowerCase()]; };
    const pm = (e) => { const r = cv.getBoundingClientRect(); S.tx = (e.clientX - r.left) * (W / r.width); S.ty = (e.clientY - r.top) * (H / r.height); };
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);
    cv.addEventListener("pointermove", pm); cv.addEventListener("pointerdown", (e) => { pm(e); try { cv.setPointerCapture(e.pointerId); } catch (x) { /* ignoré */ } });
    top.querySelector("#pg-pause").onclick = () => setPause(!S.paused);
    const ex_ = top.querySelector("#pg-exit"); if (ex_) ex_.onclick = () => opt.onExit();
    const vis = () => { if (document.hidden) setPause(true); }; document.addEventListener("visibilitychange", vis);

    // ---- boucle 60 FPS (pas variable plafonné ; le rendu ne dépend pas du nombre de virus au-delà d'un tracé par type)
    let last = performance.now(), raf = 0, fpsAcc = 0, fpsN = 0, dead = false;
    function frame(now) {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!S.paused && !S.choosing && !S.over) update(dt);
      draw();
      fpsAcc += dt; fpsN++; if (fpsAcc >= 0.5) { S.fps = Math.round(fpsN / fpsAcc); fpsAcc = fpsN = 0; const f = top.querySelector("#pg-fps"); f.textContent = ne + " virus · " + S.fps + " fps"; }
    }
    S.waveT = 1; raf = requestAnimationFrame(frame);
    if (touch) { const h = overlay(`<h2>PURGE.EXE</h2><p>Glisse ton doigt : l'œil d'E.N.O.S. te suit.<br>Lasers et ondes de choc partent tout seuls.</p><button class="pg-btn" id="pg-go">JOUER</button>`); S.paused = true; h.querySelector("#pg-go").onclick = () => { h.remove(); S.paused = false; last = performance.now(); }; }

    return {
      state: S, get enemies() { return ne; }, pause: setPause, reset,
      // tests : force un état précis
      _debug: { spawnMany(n, type) { for (let i = 0; i < n; i++) spawn(type || 0, Math.random() * TAU); }, giveXp(n) { S.xp += n; }, step(dt) { update(dt); draw(); }, lv, UPG },
      destroy() { dead = true; cancelAnimationFrame(raf); window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); document.removeEventListener("visibilitychange", vis); if (ro) ro.disconnect(); root.remove(); },
    };
  }
  window.ENOSPurge = { mount };
})();
