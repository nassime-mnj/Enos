const D = require(__dirname + "/../../assets/mobile/js/games/dames_rules.js");
let ok = 0, bad = 0; const check = (c, m) => { if (c) { ok++; console.log("OK  ", m); } else { bad++; console.log("FAIL", m); } };
const empty = (n) => { const s = D.newGame(n); s.b.fill(0); return s; };
const sq = (n, r, c) => r * n + c;
// position de départ
let s = D.newGame(10); check(s.b.filter((x) => x === 1).length === 20 && s.b.filter((x) => x === -1).length === 20, "10×10 : 20 pions de chaque côté");
check(D.moves(s).length === 9, "blancs : 9 coups au départ (" + D.moves(s).length + ")");
s = D.newGame(8); check(s.b.filter((x) => x === 1).length === 12 && D.moves(s).length === 7, "8×8 : 12 pions, 7 coups");
// prise obligatoire
s = empty(10); s.b[sq(10, 6, 3)] = 1; s.b[sq(10, 5, 4)] = -1; s.b[sq(10, 9, 0)] = 1; s.b[sq(10, 0, 1)] = -1;
let m = D.moves(s); check(m.length === 1 && m[0].caps.length === 1 && m[0].to === sq(10, 4, 5), "prise obligatoire");
// prise en arrière par un pion
s = empty(10); s.b[sq(10, 4, 3)] = 1; s.b[sq(10, 5, 4)] = -1; s.b[sq(10, 0, 1)] = -1;
m = D.moves(s); check(m.length === 1 && m[0].to === sq(10, 6, 5), "un pion prend en arrière");
// prise majoritaire : une rafle de 2 doit être préférée à une prise simple
s = empty(10); s.b[sq(10, 6, 1)] = 1; s.b[sq(10, 5, 2)] = -1; s.b[sq(10, 3, 4)] = -1; s.b[sq(10, 6, 7)] = 1; s.b[sq(10, 5, 8)] = -1; s.b[sq(10, 0, 9)] = -1;
m = D.moves(s); check(m.length === 1 && m[0].caps.length === 2 && m[0].to === sq(10, 2, 5), "prise majoritaire (rafle de 2)");
// dame volante : prise à distance et atterrissages multiples
s = empty(10); s.b[sq(10, 9, 0)] = 2; s.b[sq(10, 6, 3)] = -1; s.b[sq(10, 0, 1)] = -1;
m = D.moves(s); check(m.length === 6 && m.every((x) => x.caps[0] === sq(10, 6, 3)), "dame : prise à distance, 6 cases d'arrivée (" + m.length + ")");
// pas de double saut d'une même pièce
s = empty(10); s.b[sq(10, 5, 4)] = 2; s.b[sq(10, 4, 5)] = -1; s.b[sq(10, 0, 9)] = -1;
m = D.moves(s); check(m.every((x) => x.caps.length === 1), "une pièce prise ne se reprend pas dans la même rafle");
// promotion
s = empty(10); s.b[sq(10, 1, 2)] = 1; s.b[sq(10, 9, 8)] = -1;
s = D.play(s, D.moves(s).find((x) => x.to === sq(10, 0, 1))); check(s.b[sq(10, 0, 1)] === 2, "promotion en dame sur la dernière rangée");
// fin de partie
s = empty(10); s.b[sq(10, 6, 3)] = 1; s.b[sq(10, 5, 4)] = -1;
s = D.play(s, D.moves(s)[0]); check(s.over && s.over.winner === 1, "plus de pièce : victoire");
// IA : trouve la prise gagnante et joue une partie complète sans erreur
s = empty(10); s.b[sq(10, 6, 3)] = 1; s.b[sq(10, 5, 4)] = -1; s.b[sq(10, 0, 1)] = -1; s.b[sq(10, 9, 0)] = 1;
check(D.bestMove(s, { level: "hard" }).caps.length === 1, "IA : joue la prise");
s = D.newGame(10); let plies = 0; const t0 = Date.now();
while (!s.over && plies < 400) { const mv = D.bestMove(s, { level: s.turn === 1 ? "normal" : "easy", ms: 80 }); s = D.play(s, mv); plies++; }
check(s.over, "partie IA contre IA terminée en " + plies + " demi-coups (" + (s.over && s.over.why) + ", " + (Date.now() - t0) + " ms)");
console.log(bad ? bad + " ÉCHEC(S)" : "TOUT OK"); process.exit(bad ? 1 : 0);
