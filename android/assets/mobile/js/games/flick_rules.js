"use strict";
// FLICK FOOT / FLICK HOCKEY — moteur physique 2D pur (testable dans Node) : palets et balle (cercles), frottement, rebonds, buts.
//   Terrain : largeur W (x de -W/2 à W/2), longueur L (z de -L/2 à L/2). Équipe 0 (en bas, z > 0) attaque le but du haut (z = -L/2), équipe 1 l'inverse.
//   Un tir = impulsion sur un palet de l'équipe au trait ; on simule jusqu'à l'arrêt ; but si la balle franchit une ligne de but dans l'ouverture.
(function (root) {
  const F = {};
  const MODES = {
    foot: { W: 6.4, L: 10, goal: 1.9, disc: 0.36, ball: 0.2, fric: 1.25, rest: 0.82, bmass: 0.5, max: 13 },
    hockey: { W: 6.2, L: 10.4, goal: 1.6, disc: 0.34, ball: 0.17, fric: 0.55, rest: 0.88, bmass: 0.4, max: 14 },
  };
  F.MODES = MODES;
  // formation : gardien + 2 défenseurs + 2 attaquants (équipe 0 en bas)
  const FORM = [[0, 0.44], [-0.24, 0.28], [0.24, 0.28], [-0.14, 0.1], [0.14, 0.1]];
  F.newGame = (mode, goals) => {
    const m = MODES[mode] || MODES.foot, s = { mode: mode in MODES ? mode : "foot", m, score: [0, 0], goals: goals || 3, turn: 0, over: null, shots: 0 };
    F.kickoff(s, 0); return s;
  };
  F.kickoff = (s, toTeam) => {
    const m = s.m; s.bodies = [];
    for (let t = 0; t < 2; t++) FORM.forEach(([fx, fz], i) => { const sg = t === 0 ? 1 : -1; s.bodies.push({ t, i, x: fx * m.W * sg, z: fz * m.L * sg, vx: 0, vz: 0, r: m.disc, mass: 1 }); });
    s.ball = { t: -1, x: 0, z: 0, vx: 0, vz: 0, r: m.ball, mass: m.bmass }; s.turn = toTeam;
  };
  const all = (s) => s.bodies.concat([s.ball]);
  F.moving = (s) => all(s).some((b) => Math.abs(b.vx) + Math.abs(b.vz) > 0.02);
  /** tir : palet `idx` (index dans s.bodies), direction (dx, dz) normalisée * puissance 0..1 */
  F.shoot = (s, idx, dx, dz, power) => { const b = s.bodies[idx]; if (!b || b.t !== s.turn) return false; const l = Math.hypot(dx, dz) || 1, v = Math.max(0, Math.min(1, power)) * s.m.max; b.vx = (dx / l) * v; b.vz = (dz / l) * v; s.shots++; return true; };
  /** un pas de simulation ; renvoie {goal: équipe qui marque | null, hits: [...]} */
  F.step = (s, dt) => {
    const m = s.m, bs = all(s), hw = m.W / 2, hl = m.L / 2, gh = m.goal / 2, hits = [], impacts = [];
    for (const b of bs) {
      b.x += b.vx * dt; b.z += b.vz * dt;
      const sp = Math.hypot(b.vx, b.vz); if (sp > 0) { const ns = Math.max(0, sp - m.fric * dt * (b === s.ball ? 0.8 : 1) - sp * 0.15 * dt); b.vx *= ns / sp; b.vz *= ns / sp; }
      // murs latéraux
      if (b.x - b.r < -hw) { impacts.push({ k: "wall", v: Math.abs(b.vx), x: b.x }); b.x = -hw + b.r; b.vx = Math.abs(b.vx) * m.rest; hits.push("wall"); } else if (b.x + b.r > hw) { impacts.push({ k: "wall", v: Math.abs(b.vx), x: b.x }); b.x = hw - b.r; b.vx = -Math.abs(b.vx) * m.rest; hits.push("wall"); }
      // lignes de fond (ouverture du but pour la balle uniquement ; les palets restent sur le terrain)
      const inMouth = Math.abs(b.x) < gh - (b === s.ball ? b.r * 0.2 : 0);
      if (b === s.ball && inMouth) {
        if (b.z < -hl - b.r) return { goal: 0, hits, impacts };
        if (b.z > hl + b.r) return { goal: 1, hits, impacts };
        // poteaux
        for (const px of [-gh, gh]) for (const pz of [-hl, hl]) { const dx = b.x - px, dz = b.z - pz, d = Math.hypot(dx, dz); if (d < b.r && d > 0) { const nx = dx / d, nz = dz / d, vn = b.vx * nx + b.vz * nz; if (vn < 0) { impacts.push({ k: "post", v: -vn, x: b.x }); b.vx -= 1.8 * vn * nx; b.vz -= 1.8 * vn * nz; b.x = px + nx * b.r; b.z = pz + nz * b.r; hits.push("post"); } } }
        // fond des filets : on garde la balle dans la cage
        if (b.z < -hl - 0.6) { b.z = -hl - 0.6; b.vz = Math.abs(b.vz) * 0.3; } if (b.z > hl + 0.6) { b.z = hl + 0.6; b.vz = -Math.abs(b.vz) * 0.3; }
      } else {
        if (b.z - b.r < -hl) { impacts.push({ k: "wall", v: Math.abs(b.vz), x: b.x }); b.z = -hl + b.r; b.vz = Math.abs(b.vz) * m.rest; hits.push("wall"); } else if (b.z + b.r > hl) { impacts.push({ k: "wall", v: Math.abs(b.vz), x: b.x }); b.z = hl - b.r; b.vz = -Math.abs(b.vz) * m.rest; hits.push("wall"); }
      }
    }
    // collisions entre corps (élastiques, masses)
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j], dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = a.r + b.r;
      if (d >= min || d === 0) continue;
      const nx = dx / d, nz = dz / d, over = min - d, tm = a.mass + b.mass;
      a.x -= nx * over * (b.mass / tm); a.z -= nz * over * (b.mass / tm); b.x += nx * over * (a.mass / tm); b.z += nz * over * (a.mass / tm);
      const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz; if (rv > 0) continue;
      const e = 0.9, jimp = (-(1 + e) * rv) / (1 / a.mass + 1 / b.mass);
      a.vx -= (jimp / a.mass) * nx; a.vz -= (jimp / a.mass) * nz; b.vx += (jimp / b.mass) * nx; b.vz += (jimp / b.mass) * nz;
      hits.push(a === s.ball || b === s.ball ? "ball" : "disc"); impacts.push({ k: a === s.ball || b === s.ball ? "ball" : "disc", v: -rv, x: (a.x + b.x) / 2 });
    }
    for (const b of bs) if (Math.hypot(b.vx, b.vz) < 0.02) { b.vx = 0; b.vz = 0; }
    return { goal: null, hits, impacts };
  };
  /** simule jusqu'à l'arrêt (ou but) ; renvoie {goal} */
  F.settle = (s, maxT) => { let t = 0; const dt = 1 / 120; while (t < (maxT || 8)) { const r = F.step(s, dt); if (r.goal != null) return r; if (!F.moving(s)) break; t += dt; } return { goal: null }; };
  /** applique la fin d'un tir : but -> score et engagement pour l'équipe qui a encaissé ; sinon tour suivant */
  F.endShot = (s, goal) => {
    if (goal != null) { s.score[goal]++; if (s.score[goal] >= s.goals) s.over = { winner: goal }; else F.kickoff(s, 1 - goal); return; }
    s.turn = 1 - s.turn;
  };
  const clone = (s) => ({ mode: s.mode, m: s.m, score: s.score.slice(), goals: s.goals, turn: s.turn, over: null, shots: 0, bodies: s.bodies.map((b) => Object.assign({}, b)), ball: Object.assign({}, s.ball) });
  F.clone = clone;
  /** IA : essaie des tirs (palet, angle, puissance), simule, garde le meilleur */
  F.bestShot = (s, level) => {
    const t = s.turn, attackZ = t === 0 ? -s.m.L / 2 : s.m.L / 2, ownZ = -attackZ;
    const n = { easy: 24, normal: 70, hard: 160, max: 260 }[level] || 70;
    const mine = s.bodies.map((b, i) => [b, i]).filter(([b]) => b.t === t);
    let best = null, bestV = -Infinity;
    const evalPos = (x) => { const bz = x.ball.z, bx = x.ball.x; return -Math.abs(bz - attackZ) * 1.0 - Math.abs(bx) * 0.25 + (Math.sign(ownZ) * (bz - ownZ) < 0 ? 0 : 0); };
    for (let k = 0; k < n; k++) {
      const [b, idx] = mine[k % mine.length];
      // vise la balle (avec un décalage pour l'orienter vers le but) ou tire au hasard
      const tx = s.ball.x + (Math.random() - 0.5) * 0.5, tz = s.ball.z + (attackZ > 0 ? -1 : 1) * Math.random() * 0.25;
      let dx = tx - b.x, dz = tz - b.z; if (k % 7 === 6) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; }
      const power = 0.35 + Math.random() * 0.65, x = clone(s); x.turn = t; F.shoot(x, idx, dx, dz, power);
      const r = F.settle(x, 6);
      let v = r.goal === t ? 1e4 : r.goal === 1 - t ? -1e4 : evalPos(x);
      // ne pas laisser la balle trop près de notre but
      if (r.goal == null && Math.abs(x.ball.z - ownZ) < 2.2) v -= 6;
      if (v > bestV) { bestV = v; best = { idx, dx, dz, power }; }
    }
    if (level === "easy" && best) { best.power *= 0.8 + Math.random() * 0.3; best.dx += (Math.random() - 0.5) * 0.3; }
    return best;
  };
  if (typeof module !== "undefined" && module.exports) module.exports = F; else (root.ENOS = root.ENOS || {}).flick = F;
})(typeof window !== "undefined" ? window : globalThis);
