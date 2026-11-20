const P = require(__dirname + "/../../assets/mobile/js/games/poker_rules.js");
let bad = 0; const check = (c, m) => { console.log((c ? "OK  " : "FAIL") + " " + m); if (!c) bad++; };
const c = (s) => { const r = { A: 14, R: 13, K: 13, D: 12, Q: 12, V: 11, J: 11, T: 10 }[s[0]] || +s.slice(0, -1), su = "shdc".indexOf(s.slice(-1)); return r * 4 + su; };
const ev = (l) => P.evaluate(l.split(" ").map(c));
check(ev("As Ks Qs Js Ts 2d 3c")[0] === 8, "quinte flush royale");
check(ev("9h 9d 9s 9c 2d 3c 4h")[0] === 7, "carré");
check(ev("9h 9d 9s 4c 4d 3c 2h")[0] === 6, "full");
check(ev("2h 7h 9h Jh Kh 3c 4d")[0] === 5, "couleur");
check(ev("Ah 2d 3s 4c 5h 9c Kd")[0] === 4 && ev("Ah 2d 3s 4c 5h 9c Kd")[1] === 5, "quinte blanche (As-5)");
check(ev("7h 7d 7s Kc 2d 3c 9h")[0] === 3 && ev("7h 7d Ks Kc 2d 3c 9h")[0] === 2 && ev("7h 7d 4s Kc 2d 3c 9h")[0] === 1, "brelan, double paire, paire");
check(P.cmp(ev("Ah Ad Ks 2c 3d 7c 9h"), ev("Ah Ad Qs 2c 3d 7c 9h")) > 0, "départage au kicker");
// une main : blindes, pot, abattage, conservation des jetons
let s = P.newGame(4, { seed: 5, stack: 1000 });
check(P.pot(s) === 30 && s.chips.reduce((a, b) => a + b, 0) === 3970, "blindes 10/20 postées");
const total = (s) => s.chips.reduce((a, b) => a + b, 0) + (s.result ? 0 : P.pot(s));
while (!s.result) { const o = P.options(s); P.act(s, o.check ? { type: "check" } : { type: "call" }); }
check(s.result.showdown && s.board.length === 5 && total(s) === 4000, "tout le monde suit : abattage, 5 cartes au tableau, jetons conservés");
// coucher : le dernier joueur gagne le pot
s = P.newGame(3, { seed: 9 }); while (!s.result) P.act(s, { type: "fold" });
check(!s.result.showdown && s.chips.reduce((a, b) => a + b, 0) === 3000, "tous se couchent : le dernier remporte le pot sans abattage");
// tapis et pot annexe
s = P.newGame(3, { seed: 11, stack: 1000 }); s.chips = [100, 1000, 1000]; P.newHand(s); s.hand--;
let guard = 0; while (!s.result && guard++ < 50) { const o = P.options(s); P.act(s, s.turn === s.chips.indexOf(Math.min(...s.chips)) ? { type: "allin" } : o.check ? { type: "check" } : { type: "call" }); }
check(s.result && s.chips.reduce((a, b) => a + b, 0) === 2100 + 0 && s.result.pots.length >= 1, "tapis : pots calculés, jetons conservés (" + s.result.pots.map((p) => p.amount).join("+") + ")");
// relance minimale
s = P.newGame(2, { seed: 13 }); const o = P.options(s); check(o.minRaiseTo === 40, "relance minimale = blinde x2 (" + o.minRaiseTo + ")");
// équité
const eqAA = P.equity([c("Ah"), c("Ad")], [], 1, 2000, 7), eq72 = P.equity([c("7h"), c("2d")], [], 1, 2000, 7);
check(eqAA > 0.8 && eq72 < 0.4, "équité : AA " + eqAA.toFixed(2) + " contre 72o " + eq72.toFixed(2));
// partie complète entre bots
for (const n of [2, 4, 6]) { s = P.newGame(n, { seed: 100 + n, hands: 30 }); let k = 0, hands = 0;
  while (!s.over && k < 20000) { if (s.result) { P.newHand(s); hands++; continue; } P.act(s, P.botAct(s, k % 3 === 0 ? "easy" : "normal")); k++; }
  check(s.over && s.chips.reduce((a, b) => a + b, 0) === 1000 * n, n + " joueurs : partie terminée en " + hands + " mains, jetons conservés"); }
console.log(bad ? bad + " ÉCHEC(S)" : "TOUT OK"); process.exit(bad ? 1 : 0);
