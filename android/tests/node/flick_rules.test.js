const F = require(__dirname + "/../../assets/mobile/js/games/flick_rules.js");
let bad = 0; const check = (c, m) => { console.log((c ? "OK  " : "FAIL") + " " + m); if (!c) bad++; };
let s = F.newGame("foot", 3);
check(s.bodies.length === 10 && s.bodies.filter((b) => b.t === 0).every((b) => b.z > 0), "5 palets par équipe, équipe 0 en bas");
// tir droit dans le but vide : la balle seule devant le but du haut
s = F.newGame("foot", 3); s.bodies.forEach((b) => { b.x = 3 * (b.t ? -1 : 1) * 0.9; b.z = 4.5 * (b.t ? -1 : 1); }); s.ball.x = 0; s.ball.z = -3; s.bodies[3].x = 0; s.bodies[3].z = -2.2;
F.shoot(s, 3, 0, -1, 0.9); let r = F.settle(s, 8); check(r.goal === 0, "tir dans l'axe : but de l'équipe 0");
F.endShot(s, r.goal); check(s.score[0] === 1 && s.turn === 1 && s.ball.z === 0, "but : score 1-0, engagement pour l'équipe qui a encaissé");
// tir à côté : rebond sur le mur, pas de but
s = F.newGame("foot", 3); s.bodies[3].x = 2.5; s.bodies[3].z = 1; s.ball.x = 2.5; s.ball.z = 0.3; F.shoot(s, 3, 0.1, -1, 0.6); r = F.settle(s, 8); check(r.goal == null && !F.moving(s), "tir le long du mur : pas de but, tout s'arrête");
// conservation : les corps restent dans le terrain
const inside = s.bodies.every((b) => Math.abs(b.x) <= s.m.W / 2 + 1e-6 && Math.abs(b.z) <= s.m.L / 2 + 1e-6); check(inside, "palets toujours dans le terrain");
// mauvais camp
check(!F.shoot(s, 7, 0, 1, 1) || s.bodies[7].t === s.turn, "on ne tire qu'avec ses palets");
// hockey : glisse plus loin
const a = F.newGame("foot"), b = F.newGame("hockey"); a.ball.vz = -4; b.ball.vz = -4; for (let i = 0; i < 120; i++) { F.step(a, 1 / 120); F.step(b, 1 / 120); }
check(Math.abs(b.ball.z) > Math.abs(a.ball.z), "hockey : le palet glisse plus loin que la balle");
// partie complète entre bots
for (const mode of ["foot", "hockey"]) { s = F.newGame(mode, 3); let k = 0; const t0 = Date.now();
  while (!s.over && k < 400) { const sh = F.bestShot(s, k % 2 ? "normal" : "easy"); F.shoot(s, sh.idx, sh.dx, sh.dz, sh.power); const rr = F.settle(s, 8); F.endShot(s, rr.goal); k++; }
  check(!!s.over, mode + " : partie bot contre bot terminée " + s.score.join("-") + " en " + k + " tirs (" + (Date.now() - t0) + " ms)"); }
// l'IA marque devant un but ouvert
s = F.newGame("foot", 3); s.bodies.forEach((b) => { if (b.t === 1) { b.x = 2.8; b.z = -1; } }); s.ball.x = 0; s.ball.z = -3.4; s.bodies[3].x = 0; s.bodies[3].z = -2.4;
let goals = 0; for (let k = 0; k < 5; k++) { const x = F.clone(s); x.turn = 0; const sh = F.bestShot(x, "hard"); F.shoot(x, sh.idx, sh.dx, sh.dz, sh.power); if (F.settle(x, 8).goal === 0) goals++; }
check(goals >= 3, "IA difficile : marque devant un but ouvert (" + goals + "/5)");
console.log(bad ? bad + " ÉCHEC(S)" : "TOUT OK"); process.exit(bad ? 1 : 0);
