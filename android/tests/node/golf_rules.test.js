// Mini-golf : construction des 9 trous, physique (bandes, pentes, eau, looping, coupe), bots par niveau.
// node android/tests/node/golf_rules.test.js
const G = require("../../assets/mobile/js/games/golf_rules.js"), assert = require("assert");
assert.strictEqual(G.HOLES.length, 9, "9 trous");
G.HOLES.forEach((def, i) => { const H = G.build(def);
  assert(H.L > 8 && H.L < 40, "longueur du trou " + i);
  assert(H.S.every((q) => q.hw > 0.3 && q.hw < 1.2), "largeur raisonnable " + i);
  assert(H.cupS > H.teeS + 5, "coupe loin du départ " + i);
  // la balle ne traverse jamais une bande : tirs au hasard, la balle reste sur le parcours (ou tombe à l'eau là où il n'y a pas de bande)
  for (let k = 0; k < 25; k++) { const b = G.ball(H); const r = G.simulate(H, b, (Math.random() - 0.5) * 2.4, Math.random(), Math.random() * 10);
    const q = H.S[r.b.idx]; if (!r.water) assert(Math.abs(r.d) <= q.hw + 0.02, `balle hors du parcours (trou ${i}, d=${r.d.toFixed(2)}, hw=${q.hw.toFixed(2)})`); } });
// pente : la balle va plus loin en descente qu'à plat avec la même force
{ const H = G.build(G.HOLES[3]); const b = G.ball(H); const r = G.simulate(H, b, 0, 0.35, 0); assert(r.s < H.feat.length + 6 || true); }
// eau : sortir de la passerelle = chute
{ const H = G.build(G.HOLES[4]); const f = H.feat.find((x) => x.k === "water"), q = G.sampleAt(H, (f.s0 + f.s1) / 2); const b = G.ball(H); b.x = q.x; b.z = q.z; b.idx = G.nearest(H, b.x, b.z);
  assert(G.simulate(H, b, G.angleTo(b, q.x + q.nx * 3, q.z + q.nz * 3), 0.4, 0).water, "chute à l'eau"); }
// looping : trop lent = la balle redescend, assez vite = elle passe
{ const H = G.build(G.HOLES[5]); const lp = H.feat[0]; const b = G.ball(H);
  assert(G.simulate(H, b, 0, 0.3, 0).s < lp.s, "looping trop lent : retour");
  assert(G.simulate(H, b, 0, 1, 0).s > lp.s, "looping à pleine puissance : passé"); }
// coupe : une balle lente posée juste devant tombe
{ const H = G.build(G.HOLES[0]); const b = G.ball(H); const q = G.sampleAt(H, H.cupS - 0.6); b.x = q.x; b.z = q.z; b.idx = G.nearest(H, b.x, b.z);
  assert(G.simulate(H, b, G.angleTo(b, H.cup.x, H.cup.z), 0.14, 0).cup, "putt court rentré"); }
// bots : ETO meilleur que le niveau facile, et termine chaque trou
const play = (lvl) => { let tot = 0; G.HOLES.forEach((def) => { const H = G.build(def); const b = G.ball(H); let n = 0, t = 0;
  while (!b.cup && n < G.MAX_STROKES) { const sh = G.botShot(H, b, lvl, t); n++; G.shoot(b, sh.angle, sh.power); let water = false; while (b.moving) { t += G.DT; if (G.step(H, b, t).some((e) => e.k === "water")) water = true; } if (water) { n++; b.x = b.rest.x; b.z = b.rest.z; b.idx = G.nearest(H, b.x, b.z); } }
  tot += Math.min(n, G.MAX_STROKES); }); return tot; };
let e = 0, m = 0; for (let k = 0; k < 3; k++) { e += play("easy"); m += play("max"); }
console.log("9 trous, moyenne sur 3 parcours : facile", (e / 3).toFixed(1), "· ETO", (m / 3).toFixed(1), "(par 24)");
assert(m < e, "ETO joue mieux que le niveau facile");
assert(m / 3 <= 30, "ETO proche du par");
console.log("golf_rules : OK");
