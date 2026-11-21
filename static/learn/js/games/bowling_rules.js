"use strict";
// BOWLING — module pur (testable dans Node) : piste aux dimensions réelles, boule avec effet (hook après la zone huilée),
// quilles en corps rigides 2D (chocs boule/quille et quille/quille), gouttières, fosse ; feuille de score officielle (10 frames, strike, spare, 10e frame).
//   Repère : x latéral (0 = centre, ±W/2 = bords), z le long de la piste (0 = ligne de faute, z négatif vers les quilles).
(function (root) {
  const B = {};
  const L = { W: 1.054, len: 18.29, oil: 12.2, pitZ: -18.29 - 0.95, ball: 0.109, pin: 0.061, ballM: 6.8, pinM: 1.55, gutter: 0.12 };
  B.LANE = L;
  // positions des quilles (1 en tête, triangle de 30,48 cm)
  const S = 0.3048, H = S * Math.sqrt(3) / 2;
  B.PINS = [[0, 0], [-S / 2, -H], [S / 2, -H], [-S, -2 * H], [0, -2 * H], [S, -2 * H], [-1.5 * S, -3 * H], [-S / 2, -3 * H], [S / 2, -3 * H], [1.5 * S, -3 * H]].map(([x, dz]) => [x, -L.len + dz]);

  // ------------------------------------------------------------------ score
  /** rolls = quilles abattues par lancer ; renvoie {frames: [{rolls, score (cumul) | null}], total} */
  B.score = (rolls) => {
    const frames = []; let i = 0, total = 0;
    for (let f = 0; f < 10; f++) {
      if (i >= rolls.length) { frames.push({ rolls: [], score: null }); continue; }
      if (f === 9) { const r = rolls.slice(i, i + 3); const done = r.length === 3 || (r.length === 2 && r[0] + r[1] < 10);
        if (done) total += r.reduce((a, b) => a + b, 0); frames.push({ rolls: r, score: done ? total : null }); i += r.length; continue; }
      if (rolls[i] === 10) { const b = rolls.slice(i + 1, i + 3); if (b.length === 2) { total += 10 + b[0] + b[1]; frames.push({ rolls: [10], score: total }); } else frames.push({ rolls: [10], score: null }); i += 1; continue; }
      const r = rolls.slice(i, i + 2);
      if (r.length < 2) { frames.push({ rolls: r, score: null }); i += 1; continue; }
      if (r[0] + r[1] === 10) { if (rolls.length > i + 2) { total += 10 + rolls[i + 2]; frames.push({ rolls: r, score: total }); } else frames.push({ rolls: r, score: null }); }
      else { total += r[0] + r[1]; frames.push({ rolls: r, score: total }); }
      i += 2;
    }
    return { frames, total: frames.reduce((a, fr) => (fr.score != null ? fr.score : a), 0) };
  };
  /** état d'un joueur : frame en cours, lancer dans la frame, quilles à relever ? */
  /** lecture d'une suite de lancers : symboles (X, /, -, chiffres), rack frais ou non, quilles debout */
  const walk = (rolls) => { const out = []; let fresh = true, left = 10, bonus = false;
    for (const r of rolls) {
      if (fresh && r === 10) { out.push("X"); left = 10; bonus = true; continue; }
      if (!fresh && r === left) { out.push("/"); fresh = true; left = 10; bonus = true; continue; }
      out.push(r === 0 ? "-" : String(r));
      if (fresh) { fresh = false; left = 10 - r; } else { fresh = true; left = 10; }
    }
    return { out, fresh, left, bonus }; };
  B.label = (rolls) => walk(rolls).out;
  /** où en est un joueur : frame (0..9, 10 = fini), lancer dans la frame, quilles debout, rack à relever */
  B.cursor = (rolls) => {
    let i = 0;
    for (let f = 0; f < 9; f++) {
      if (i >= rolls.length) return { frame: f, ball: 0, fresh: true, standing: 10 };
      if (rolls[i] === 10) { i += 1; continue; }
      if (i + 1 >= rolls.length) return { frame: f, ball: 1, fresh: false, standing: 10 - rolls[i] };
      i += 2;
    }
    const r = rolls.slice(i), w = walk(r), n = r.length;
    if (n === 3 || (n === 2 && !w.bonus)) return { frame: 10, done: true };
    return { frame: 9, ball: n, fresh: w.fresh, standing: w.left };
  };

  // ------------------------------------------------------------------ physique
  /** nouveau rack : `standing` = liste des quilles debout (indices) */
  B.rack = (standing) => (standing || [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).map((i) => ({ i, x: B.PINS[i][0], z: B.PINS[i][1], vx: 0, vz: 0, down: false, gone: false, tilt: 0, dir: 0, spin: 0 }));
  /** lancer : position de départ x0, angle (rad, 0 = tout droit), vitesse (m/s), effet (-1..1, + = vers la droite en fin de piste) */
  B.throwBall = (x0, angle, speed, hook) => ({ x: Math.max(-L.W / 2 + L.ball, Math.min(L.W / 2 - L.ball, x0)), z: -0.4, vx: Math.sin(angle) * speed, vz: -Math.cos(angle) * speed, hook: Math.max(-1, Math.min(1, hook || 0)), gutter: false, done: false, t: 0 });
  /** avance la simulation de dt ; renvoie la liste des événements ("pin", "gutter", "hit") */
  B.step = (ball, pins, dt) => {
    const ev = [];
    if (!ball.done) {
      ball.t += dt;
      // effet : la boule glisse sur l'huile puis accroche le bois sec
      if (!ball.gutter && ball.z < -L.oil + 2 && ball.z > -L.len + 0.3) ball.vx += ball.hook * 1.25 * dt * Math.min(1, (-L.oil + 2 - ball.z) / 3);
      ball.x += ball.vx * dt; ball.z += ball.vz * dt;
      if (!ball.gutter && Math.abs(ball.x) > L.W / 2) { ball.gutter = true; ball.x = Math.sign(ball.x) * (L.W / 2 + L.gutter / 2); ball.vx = 0; ev.push("gutter"); }
      if (ball.z < L.pitZ) ball.done = true;
    }
    // quilles
    for (const p of pins) {
      if (p.gone) continue;
      p.x += p.vx * dt; p.z += p.vz * dt;
      const sp = Math.hypot(p.vx, p.vz); if (sp > 0) { const ns = Math.max(0, sp - 2.2 * dt); p.vx *= ns / sp; p.vz *= ns / sp; }
      if (p.down) { p.tilt = Math.min(Math.PI / 2, p.tilt + dt * 9); p.spin += sp * dt * 3; }
      if (Math.abs(p.x) > L.W / 2 + 0.25) { p.vx *= -0.3; p.x = Math.sign(p.x) * (L.W / 2 + 0.25); }       // parois latérales du pin deck
      if (p.z < L.pitZ) p.gone = true;
    }
    const rP = L.pin;
    // boule / quilles
    if (!ball.gutter && !ball.done) for (const p of pins) {
      if (p.gone) continue; const dx = p.x - ball.x, dz = p.z - ball.z, d = Math.hypot(dx, dz), min = L.ball + (p.down ? rP * 1.2 : rP);
      if (d >= min || d === 0) continue;
      const nx = dx / d, nz = dz / d, rv = (p.vx - ball.vx) * nx + (p.vz - ball.vz) * nz; p.x = ball.x + nx * min; p.z = ball.z + nz * min;
      if (rv < 0) { const j = (-(1 + 0.75) * rv) / (1 / L.ballM + 1 / L.pinM); ball.vx -= (j / L.ballM) * nx; ball.vz -= (j / L.ballM) * nz; p.vx += (j / L.pinM) * nx; p.vz += (j / L.pinM) * nz; }
      if (!p.down) { p.down = true; p.dir = Math.atan2(p.vx, -p.vz); ev.push("hit"); }
    }
    // quilles / quilles
    for (let a = 0; a < pins.length; a++) for (let b = a + 1; b < pins.length; b++) {
      const p = pins[a], q = pins[b]; if (p.gone || q.gone) continue;
      const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz), min = (p.down ? rP * 1.6 : rP) + (q.down ? rP * 1.6 : rP);
      if (d >= min || d === 0) continue;
      const nx = dx / d, nz = dz / d, over = (min - d) / 2; p.x -= nx * over; p.z -= nz * over; q.x += nx * over; q.z += nz * over;
      const rv = (q.vx - p.vx) * nx + (q.vz - p.vz) * nz; if (rv >= 0) continue;
      const j = (-(1 + 0.6) * rv) / 2; p.vx -= j * nx; p.vz -= j * nz; q.vx += j * nx; q.vz += j * nz;
      const hard = Math.abs(rv) > 0.35;
      if (hard && !p.down) { p.down = true; p.dir = Math.atan2(p.vx, -p.vz); ev.push("pin"); }
      if (hard && !q.down) { q.down = true; q.dir = Math.atan2(q.vx, -q.vz); ev.push("pin"); }
    }
    return ev;
  };
  B.moving = (ball, pins) => !ball.done || pins.some((p) => !p.gone && Math.hypot(p.vx, p.vz) > 0.03);
  /** simule un lancer complet ; renvoie {knocked: [indices], pins} */
  B.simulate = (standing, x0, angle, speed, hook) => {
    const pins = B.rack(standing), ball = B.throwBall(x0, angle, speed, hook); let t = 0;
    while (t < 9 && (B.moving(ball, pins) || t < 0.2)) { B.step(ball, pins, 1 / 240); t += 1 / 240; }
    return { knocked: pins.filter((p) => p.down || p.gone).map((p) => p.i), pins, ball };
  };
  /** IA : cherche le meilleur lancer (position, angle, vitesse, effet), puis ajoute une erreur selon le niveau */
  B.botThrow = (standing, level, rnd) => {
    rnd = rnd || Math.random; const tries = { easy: 10, normal: 26, hard: 50, max: 80 }[level] || 26;
    const noise = { easy: 1, normal: 0.55, hard: 0.28, max: 0.12 }[level] || 0.55;
    let best = null, bestN = -1;
    const pinsXY = standing.map((i) => B.PINS[i]); const cx = pinsXY.reduce((a, p) => a + p[0], 0) / pinsXY.length;
    for (let k = 0; k < tries; k++) {
      const hook = (rnd() - 0.5) * 1.2, x0 = (rnd() - 0.5) * 0.7, speed = 7 + rnd() * 2.5;
      // vise le centre des quilles restantes (entre 1 et 3 pour un rack complet)
      const target = standing.length === 10 ? 0.06 * Math.sign(hook || 1) : cx;
      const angle = Math.atan2(target - x0 - hook * 0.9, L.len) + (rnd() - 0.5) * 0.01;
      const r = B.simulate(standing, x0, angle, speed, hook); if (r.knocked.length > bestN) { bestN = r.knocked.length; best = { x0, angle, speed, hook }; }
      if (bestN === standing.length) break;
    }
    return { x0: best.x0 + (rnd() - 0.5) * 0.08 * noise, angle: best.angle + (rnd() - 0.5) * 0.02 * noise, speed: best.speed * (1 + (rnd() - 0.5) * 0.1 * noise), hook: best.hook + (rnd() - 0.5) * 0.4 * noise };
  };
  if (typeof module !== "undefined" && module.exports) module.exports = B; else (root.ENOS = root.ENOS || {}).bowling = B;
})(typeof window !== "undefined" ? window : globalThis);
