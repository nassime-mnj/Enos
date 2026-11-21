"use strict";
// MINI-GOLF — module pur (testable dans Node) : 9 trous définis par une ligne centrale lissée (Catmull-Rom) avec largeur et hauteur,
// physique 2D + pentes (la balle accélère dans les descentes, ralentit dans les montées), bandes, bumpers, moulin (bras qui balaient),
// boulets (pendules), looping (il faut assez de vitesse, sinon la balle redescend), passerelles au-dessus de l'eau (tomber = +1 coup).
//   Repère : x latéral, z vers l'avant (négatif), y hauteur du gazon. Pas fixe de 1/120 s : la simulation du bot est identique au jeu.
(function (root) {
  const G = {};
  const BALL = 0.08, CUP = 0.16, DT = 1 / 120, GRAV = 7.0, MAXV = 8.5;
  G.BALL = BALL; G.CUP = CUP; G.DT = DT; G.MAXV = MAXV; G.MAX_STROKES = 7;

  // pts : [x, z, y, largeur] ; features : at / a, b en fraction de la longueur
  G.HOLES = [
    { name: "Le départ", par: 2, pts: [[0, 0, 0, 1.7], [0, -4, 0, 1.7], [0.3, -8, -0.15, 1.7], [0, -12, -0.2, 1.7]], feat: [{ k: "bumper", at: 0.55, off: 0.42 }, { k: "bumper", at: 0.55, off: -0.42 }] },
    { name: "Le coude", par: 2, pts: [[0, 0, 0, 1.6], [0, -5, 0, 1.6], [0.6, -7.6, 0, 1.6], [2.6, -9.2, 0, 1.6], [5.5, -9.8, 0, 1.6], [9, -9.8, 0, 1.6]], feat: [{ k: "bumper", at: 0.52, off: 0.3 }] },
    { name: "Le moulin", par: 3, pts: [[0, 0, 0, 2.0], [0, -6, 0, 2.0], [0, -12, 0, 2.0], [0, -15, 0, 1.6]], feat: [{ k: "mill", at: 0.48, w: 1.3 }] },
    { name: "La bosse", par: 2, pts: [[0, 0, 0, 1.6], [0, -3, 0, 1.6], [0, -5.5, 0.8, 1.6], [0, -8, 0, 1.6], [-0.8, -11, -0.1, 1.6], [-0.8, -13, -0.1, 1.6]], feat: [] },
    { name: "Le pont", par: 3, pts: [[0, 0, 0, 1.8], [0, -3.5, 0, 1.8], [0.5, -5.5, 0, 0.85], [1.5, -8, 0, 0.85], [2, -10, 0, 1.8], [2, -14, 0, 1.8]], feat: [{ k: "water", a: 0.3, b: 0.67 }] },
    { name: "Le looping", par: 2, pts: [[0, 0, 0, 1.6], [0, -6, 0, 1.6], [0, -10, 0, 1.6], [0, -15, 0, 1.6]], feat: [{ k: "loop", at: 0.45 }] },
    { name: "Les boulets", par: 3, pts: [[0, 0, 0, 1.8], [0, -4, 0, 1.8], [1.5, -8, 0, 1.8], [1.5, -12, 0, 1.8], [0, -16, 0, 1.8]], feat: [{ k: "hammer", at: 0.32, amp: 0.68, w: 1.7 }, { k: "hammer", at: 0.64, amp: 0.68, w: 2.2, ph: 1.3 }] },
    { name: "Le serpent", par: 3, pts: [[0, 0, 0, 1.6], [0, -3, 0, 1.6], [2, -5.5, 0, 1.6], [2, -8, 0, 1.6], [-0.5, -10.5, 0, 1.6], [-0.5, -13, 0, 1.6], [1, -15.5, -0.2, 1.6], [1, -17.5, -0.2, 1.6]], feat: [{ k: "bumper", at: 0.36, off: 0 }, { k: "bumper", at: 0.66, off: 0.2 }] },
    { name: "Le grand final", par: 4, pts: [[0, 0, 0, 1.8], [0, -4, 0, 1.8], [0, -7, 0.5, 1.8], [0, -9, 0.5, 1.8], [0, -13, 0.5, 1.8], [1, -16, 0.5, 0.9], [3, -18, 0.3, 0.9], [5, -19, 0.3, 1.8], [8, -19, 0.2, 2.0], [12, -19, 0.2, 2.0], [15, -19, 0.2, 1.6]],
      feat: [{ k: "loop", at: 0.31 }, { k: "water", a: 0.45, b: 0.63 }, { k: "mill", at: 0.83, w: 1.1 }] },
  ];

  const cr = (a, b, c, d, t) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  /** construit un trou : échantillons {x, z, y, hw, tx, tz, nx, nz, s, wall}, longueur, départ, coupe, obstacles */
  G.build = (def) => {
    const P = def.pts, S = [];
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
      const n = Math.max(4, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.07));
      for (let k = 0; k < n; k++) { const t = k / n; S.push({ x: cr(p0[0], p1[0], p2[0], p3[0], t), z: cr(p0[1], p1[1], p2[1], p3[1], t), y: cr(p0[2], p1[2], p2[2], p3[2], t), hw: cr(p0[3], p1[3], p2[3], p3[3], t) / 2 }); }
    }
    const L0 = P[P.length - 1]; S.push({ x: L0[0], z: L0[1], y: L0[2], hw: L0[3] / 2 });
    let s = 0; S.forEach((q, i) => { if (i) s += Math.hypot(q.x - S[i - 1].x, q.z - S[i - 1].z); q.s = s; });
    S.forEach((q, i) => { const a = S[Math.max(0, i - 1)], b = S[Math.min(S.length - 1, i + 1)]; let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; q.tx = tx; q.tz = tz; q.nx = -tz; q.nz = tx;
      q.dy = (b.y - a.y) / ((b.s - a.s) || 1); });
    const L = s, H = { def, S, L, feat: [], cupS: L - 0.9, teeS: 2.2 };
    const at = (f) => G.sampleAt(H, f * L);
    (def.feat || []).forEach((f) => { const o = Object.assign({}, f);
      if (f.k === "water") { o.s0 = f.a * L; o.s1 = f.b * L; }
      else { o.s = f.at * L; const q = at(f.at); o.cx = q.x + q.nx * (f.off || 0) * q.hw; o.cz = q.z + q.nz * (f.off || 0) * q.hw; o.q = q; }
      if (f.k === "loop") o.R = 0.75;
      if (f.k === "mill") o.arm = o.q.hw - 0.02;
      H.feat.push(o); });
    S.forEach((q) => { q.wall = !H.feat.some((f) => f.k === "water" && q.s > f.s0 && q.s < f.s1); });
    const c = G.sampleAt(H, H.cupS); H.cup = { x: c.x, z: c.z, y: c.y }; const t0 = G.sampleAt(H, H.teeS); H.tee = { x: t0.x, z: t0.z, y: t0.y, tx: t0.tx, tz: t0.tz };
    return H;
  };
  G.sampleAt = (H, s) => { const S = H.S; let lo = 0, hi = S.length - 1; s = Math.max(0, Math.min(H.L, s)); while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].s < s) lo = m; else hi = m; } return S[s - S[lo].s < S[hi].s - s ? lo : hi]; };
  /** échantillon le plus proche (recherche locale autour de idx si fourni) */
  G.nearest = (H, x, z, idx) => { const S = H.S; let a = 0, b = S.length - 1; if (idx != null) { a = Math.max(0, idx - 30); b = Math.min(S.length - 1, idx + 30); }
    let bi = a, bd = 1e9; for (let i = a; i <= b; i++) { const d = (S[i].x - x) ** 2 + (S[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    if (idx != null && (bi === a || bi === b) && bd > 1) return G.nearest(H, x, z, null);
    return bi; };

  /** obstacles mobiles au temps t : [{x, z, r, vx, vz, e, cap: [ax, az, bx, bz]?}] */
  G.obstacles = (H, t) => { const out = [];
    H.feat.forEach((f) => {
      if (f.k === "bumper") out.push({ x: f.cx, z: f.cz, r: 0.17, vx: 0, vz: 0, e: 1.15, k: "bumper" });
      else if (f.k === "mill") { const a = (f.w || 1.2) * t, dx = Math.cos(a), dz = Math.sin(a), L = f.arm;
        out.push({ cap: [f.cx - dx * L, f.cz - dz * L, f.cx + dx * L, f.cz + dz * L], r: 0.07, w: f.w || 1.2, cx: f.cx, cz: f.cz, e: 0.6, k: "mill" });
        out.push({ x: f.cx, z: f.cz, r: 0.16, vx: 0, vz: 0, e: 0.6, k: "post" }); }
      else if (f.k === "hammer") { const w = f.w || 2, ph = f.ph || 0, A = f.amp * f.q.hw, o = A * Math.sin(w * t + ph), v = A * w * Math.cos(w * t + ph);
        out.push({ x: f.cx + f.q.nx * o, z: f.cz + f.q.nz * o, r: 0.24, vx: f.q.nx * v, vz: f.q.nz * v, e: 0.9, k: "hammer" }); }
    });
    return out; };

  /** balle au départ */
  G.ball = (H) => ({ x: H.tee.x, z: H.tee.z, y: H.tee.y, vx: 0, vz: 0, idx: G.nearest(H, H.tee.x, H.tee.z), moving: false, cup: false, loop: null, rest: { x: H.tee.x, z: H.tee.z }, t: 0 });
  G.shoot = (b, angle, power) => { const v = Math.max(0.05, Math.min(1, power)) * MAXV; b.vx = Math.sin(angle) * v; b.vz = -Math.cos(angle) * v; b.rest = { x: b.x, z: b.z }; b.moving = true; b.t = 0; };
  /** angle de tir vers un point */
  G.angleTo = (b, x, z) => Math.atan2(x - b.x, -(z - b.z));

  /** un pas de physique ; renvoie la liste des événements {k: wall|bumper|mill|hammer|loop|loopfail|lip|cup|water|stop, v} */
  G.step = (H, b, t) => {
    const ev = []; if (!b.moving) return ev;
    b.t += DT;
    if (b.loop) { b.loop.t += DT; if (b.loop.t >= b.loop.dur) { const q = G.sampleAt(H, b.loop.s + 0.08); b.x = q.x + q.nx * b.loop.d; b.z = q.z + q.nz * b.loop.d; b.vx = q.tx * b.loop.v; b.vz = q.tz * b.loop.v; b.idx = G.nearest(H, b.x, b.z); b.loop = null; } return ev; }
    const S = H.S; let q = S[b.idx];
    // pente (roulement : 5/7 g) + frottements + légère aspiration près de la coupe
    const sp0 = Math.hypot(b.vx, b.vz);
    const as = -GRAV * q.dy; b.vx += q.tx * as * DT; b.vz += q.tz * as * DT;
    const dcx = H.cup.x - b.x, dcz = H.cup.z - b.z, dc = Math.hypot(dcx, dcz);
    if (dc < 0.34 && sp0 < 1.0 && dc > 0.001) { b.vx += (dcx / dc) * 1.4 * DT; b.vz += (dcz / dc) * 1.4 * DT; }
    let sp = Math.hypot(b.vx, b.vz);
    if (sp > 0) { const ns = Math.max(0, sp - (0.75 + 0.22 * sp) * DT); b.vx *= ns / sp; b.vz *= ns / sp; sp = ns; }
    const ps = q.s;
    b.x += b.vx * DT; b.z += b.vz * DT;
    b.idx = G.nearest(H, b.x, b.z, b.idx); q = S[b.idx];
    const dx = b.x - q.x, dz = b.z - q.z; let d = dx * q.nx + dz * q.nz; const along = dx * q.tx + dz * q.tz, s = q.s + along;
    // bandes latérales (ou chute dans l'eau sur les passerelles)
    if (q.wall) { const lim = q.hw - BALL; if (Math.abs(d) > lim) { const sg = Math.sign(d), vn = b.vx * q.nx + b.vz * q.nz;
        b.x -= q.nx * (Math.abs(d) - lim) * sg; b.z -= q.nz * (Math.abs(d) - lim) * sg; d = lim * sg;
        if (vn * sg > 0) { b.vx -= (1 + 0.72) * vn * q.nx; b.vz -= (1 + 0.72) * vn * q.nz; b.vx *= 0.96; b.vz *= 0.96; ev.push({ k: "wall", v: Math.abs(vn) }); } } }
    else if (Math.abs(d) > q.hw + BALL * 0.5) { ev.push({ k: "water", v: sp }); b.moving = false; b.vx = b.vz = 0; return ev; }
    // bandes du départ et du fond
    if (s < BALL && b.vx * q.tx + b.vz * q.tz < 0) { const vt = b.vx * q.tx + b.vz * q.tz; b.vx -= 1.72 * vt * q.tx; b.vz -= 1.72 * vt * q.tz; ev.push({ k: "wall", v: Math.abs(vt) }); }
    if (s > H.L - BALL && b.vx * q.tx + b.vz * q.tz > 0) { const vt = b.vx * q.tx + b.vz * q.tz; b.vx -= 1.72 * vt * q.tx; b.vz -= 1.72 * vt * q.tz; b.x -= q.tx * (s - H.L + BALL); b.z -= q.tz * (s - H.L + BALL); ev.push({ k: "wall", v: Math.abs(vt) }); }
    // looping
    for (const f of H.feat) if (f.k === "loop" && ps < f.s && s >= f.s) { const vt = b.vx * q.tx + b.vz * q.tz;
      if (vt >= 4.1) { b.loop = { t: 0, dur: (2 * Math.PI * f.R) / (vt * 0.72), v: vt * 0.8, s: f.s, d, f }; ev.push({ k: "loop", v: vt }); return ev; }
      if (vt > 0) { b.vx -= 1.55 * vt * q.tx; b.vz -= 1.55 * vt * q.tz; b.x -= q.tx * 0.02; b.z -= q.tz * 0.02; ev.push({ k: "loopfail", v: vt }); } }
    // obstacles
    for (const o of G.obstacles(H, t)) {
      let ox, oz, ovx = o.vx || 0, ovz = o.vz || 0;
      if (o.cap) { const [ax, az, bx, bz] = o.cap, ex = bx - ax, ez = bz - az, k = Math.max(0, Math.min(1, ((b.x - ax) * ex + (b.z - az) * ez) / (ex * ex + ez * ez))); ox = ax + ex * k; oz = az + ez * k; ovx = -o.w * (oz - o.cz); ovz = o.w * (ox - o.cx); }
      else { ox = o.x; oz = o.z; }
      const ddx = b.x - ox, ddz = b.z - oz, dd = Math.hypot(ddx, ddz), min = BALL + o.r; if (dd >= min || dd === 0) continue;
      const nx = ddx / dd, nz = ddz / dd, rv = (b.vx - ovx) * nx + (b.vz - ovz) * nz; b.x = ox + nx * min; b.z = oz + nz * min;
      if (rv < 0) { b.vx -= (1 + o.e) * rv * nx; b.vz -= (1 + o.e) * rv * nz; ev.push({ k: o.k === "post" ? "wall" : o.k, v: Math.abs(rv) }); }
      const m = Math.hypot(b.vx, b.vz); if (m > MAXV) { b.vx *= MAXV / m; b.vz *= MAXV / m; }
    }
    // coupe
    const dc2 = Math.hypot(H.cup.x - b.x, H.cup.z - b.z); sp = Math.hypot(b.vx, b.vz);
    if (dc2 < CUP - BALL * 0.3) { if (sp < 1.75) { b.cup = true; b.moving = false; b.x = H.cup.x; b.z = H.cup.z; b.vx = b.vz = 0; ev.push({ k: "cup", v: sp }); return ev; }
      if (!b.lipT || b.t - b.lipT > 0.2) { b.lipT = b.t; const a = (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.5), c = Math.cos(a), sn = Math.sin(a); const vx = b.vx * c - b.vz * sn, vz = b.vx * sn + b.vz * c; b.vx = vx * 0.72; b.vz = vz * 0.72; ev.push({ k: "lip", v: sp }); } }
    // arrêt
    if (sp < 0.05 && Math.abs(GRAV * q.dy) < 0.55) { b.vx = b.vz = 0; b.moving = false; ev.push({ k: "stop" }); }
    if (b.t > 25) { b.vx = b.vz = 0; b.moving = false; ev.push({ k: "stop" }); }
    b.y = q.y;
    return ev;
  };

  /** simulation complète d'un tir depuis la balle b (copiée) à partir du temps t0 ; renvoie {cup, water, x, z, s, t} */
  G.simulate = (H, b0, angle, power, t0) => {
    const b = Object.assign({}, b0, { loop: null }); G.shoot(b, angle, power); let t = t0 || 0, water = false;
    for (let i = 0; i < 3000 && b.moving; i++) { t += DT; const ev = G.step(H, b, t); if (ev.some((e) => e.k === "water")) water = true; }
    const q = H.S[b.idx]; return { cup: b.cup, water, x: b.x, z: b.z, s: q.s, d: (b.x - q.x) * q.nx + (b.z - q.z) * q.nz, t: b.t, b };
  };
  /** coût d'une position (plus bas = mieux) */
  G.cost = (H, r) => r.cup ? -100 + r.t * 0.1 : r.water ? 60 : Math.max(0, H.cupS - r.s) + Math.abs(r.d) * 0.4 + Math.hypot(H.cup.x - r.x, H.cup.z - r.z) * 0.6;

  /** IA : cherche angle + puissance par simulation (cibles le long du parcours), puis ajoute une erreur selon le niveau. Version en tranches : think(H, b, level, t0, rnd) -> générateur */
  G.botCandidates = (H, b, level, rnd) => {
    rnd = rnd || Math.random; const n = { easy: 26, normal: 50, hard: 90, max: 140 }[level] || 50, S = H.S, q = S[b.idx], out = [];
    const remain = H.cupS - q.s, targets = [];
    for (const k of [1.2, 2, 3, 4.5, 6, 8, 11, 15]) if (k < remain) targets.push(G.sampleAt(H, q.s + k));
    targets.push({ x: H.cup.x, z: H.cup.z, hw: 0, nx: 0, nz: 0 });
    for (let i = 0; i < n; i++) { const tg = targets[Math.floor(rnd() * targets.length)], off = (rnd() - 0.5) * 1.2 * (tg.hw || 0);
      const x = tg.x + (tg.nx || 0) * off, z = tg.z + (tg.nz || 0) * off, dist = Math.hypot(x - b.x, z - b.z) + (H.feat.some((f) => f.k === "loop" && f.s > q.s) ? 4 : 0);
      const p = Math.min(1, Math.max(0.06, (Math.sqrt(1.6 * dist) * (1.0 + rnd() * 0.6) + 0.3) / MAXV));
      out.push({ angle: G.angleTo(b, x, z) + (rnd() - 0.5) * 0.03, power: rnd() < 0.15 ? 0.6 + rnd() * 0.4 : p }); }
    return out; };
  G.botNoise = (level, shot, rnd) => { rnd = rnd || Math.random; const na = { easy: 0.15, normal: 0.085, hard: 0.05, max: 0.028 }[level] || 0.085, np = { easy: 0.26, normal: 0.15, hard: 0.09, max: 0.05 }[level] || 0.15;
    return { angle: shot.angle + (rnd() - 0.5) * 2 * na, power: Math.max(0.05, Math.min(1, shot.power * (1 + (rnd() - 0.5) * 2 * np))) }; };
  G.botShot = (H, b, level, t0, rnd) => { let best = null, bc = 1e9; for (const c of G.botCandidates(H, b, level, rnd)) { const r = G.simulate(H, b, c.angle, c.power, t0), k = G.cost(H, r); if (k < bc) { bc = k; best = c; } if (r.cup && level !== "easy") break; } return G.botNoise(level, best, rnd); };

  /** score : nom du résultat d'un trou */
  G.label = (strokes, par) => strokes === 1 ? "Trou en un !" : ({ "-3": "Albatros !", "-2": "Eagle !", "-1": "Birdie", 0: "Par", 1: "Bogey", 2: "Double bogey" })[strokes - par] || "+" + (strokes - par);

  if (typeof module !== "undefined" && module.exports) module.exports = G; else (root.ENOS = root.ENOS || {}).golf = G;
})(typeof window !== "undefined" ? window : globalThis);
