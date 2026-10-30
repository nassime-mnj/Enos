// Moteur des échecs ×4 (js/chess4.js) : node android/tests/chess4.test.js
const assert = require("assert");
const C4 = require("../assets/mobile/js/chess4.js");
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("OK   " + name); };
const sq = C4.SQI;

t("160 cases jouables (coins retirés)", () => { assert.strictEqual(C4.VALID.reduce((a, b) => a + b, 0), 160); });
t("4 armées de 16 pièces, 1 roi chacune", () => {
  const s = C4.newGame();
  for (let o = 0; o < 4; o++) {
    let c = 0, k = 0, p = 0;
    for (let i = 0; i < C4.SQ; i++) if (s.b[i] && C4.ownerOf(s.b[i]) === o) { c++; if (C4.typeOf(s.b[i]) === C4.K) k++; if (C4.typeOf(s.b[i]) === C4.P) p++; }
    assert.deepStrictEqual([c, k, p], [16, 1, 8], "joueur " + o);
  }
  for (let i = 0; i < C4.SQ; i++) if (s.b[i]) assert.ok(C4.VALID[i], "pièce hors plateau");
});
t("20 coups au départ pour chaque joueur (comme aux échecs)", () => {
  const s = C4.newGame();
  for (let o = 0; o < 4; o++) assert.strictEqual(C4.moves(s, o).length, 20, "joueur " + o);
});
t("les armées sont face à face (rois ni alignés avec leur voisin ni dans un coin)", () => {
  const s = C4.newGame();
  const ks = [0, 1, 2, 3].map((o) => C4.XY(C4.kingSq(s, o)));
  assert.deepStrictEqual(ks, [[7, 13], [0, 7], [6, 0], [13, 6]]);
});
t("pion : un pas, double pas au départ, prise en diagonale, pas de prise de face", () => {
  const s = C4.newGame();
  s.b.fill(0); s.b[sq(5, 12)] = C4.cell(0, C4.P); s.b[sq(5, 10)] = C4.cell(1, C4.P);
  let m = C4.moves(s, 0).map((x) => C4.XY(C4.to(x)).join(","));
  assert.ok(m.includes("5,11") && !m.includes("5,10"), "double pas bloqué par la pièce en 5,10 : " + m);
  s.b[sq(5, 10)] = 0; m = C4.moves(s, 0).map((x) => C4.XY(C4.to(x)).join(","));
  assert.ok(m.includes("5,11") && m.includes("5,10"));
  s.b[sq(6, 11)] = C4.cell(2, C4.N === 14 ? C4.R : 4);
  m = C4.moves(s, 0).map((x) => C4.XY(C4.to(x)).join(","));
  assert.ok(m.includes("6,11"), "prise en diagonale");
});
t("pion du joueur 1 avance vers la droite", () => {
  const s = C4.newGame(); s.b.fill(0); s.b[sq(1, 5)] = C4.cell(1, C4.P);
  const m = C4.moves(s, 1).map((x) => C4.XY(C4.to(x)).join(","));
  assert.ok(m.includes("2,5") && m.includes("3,5"), m);
});
t("promotion en dame après 8 pas", () => {
  const s = C4.newGame(); s.b.fill(0); s.b[sq(5, 5)] = C4.cell(0, C4.P); s.b[sq(7, 13)] = C4.cell(0, C4.K); s.b[sq(0, 7)] = C4.cell(1, C4.K);
  s.turn = 0;
  const m = C4.moves(s, 0).find((x) => C4.to(x) === sq(5, 4));
  assert.ok(m && C4.isPromo(m), "arrive en y=4 : promotion");
  C4.play(s, m); assert.strictEqual(C4.typeOf(s.b[sq(5, 4)]), C4.Q);
});
t("bords du plateau en croix : le fou ne traverse pas un coin coupé, le cavalier perd les sauts vers le vide", () => {
  const s = C4.newGame(); s.b.fill(0); s.b[sq(3, 3)] = C4.cell(0, C4.B);
  let m = C4.moves(s, 0).map((x) => C4.XY(C4.to(x)).join(","));
  assert.ok(!m.includes("2,2") && !m.includes("1,1"), "pas de diagonale vers le coin coupé");
  assert.ok(m.includes("10,10") && m.includes("4,2") && m.includes("6,0"));
  s.b.fill(0); s.b[sq(3, 3)] = C4.cell(0, C4.KN);
  assert.strictEqual(C4.moves(s, 0).length, 6, "cavalier en 3,3 : 6 cases (2 sauts tombent dans le coin coupé)");
  s.b.fill(0); s.b[sq(3, 3)] = C4.cell(0, C4.R);
  m = C4.moves(s, 0).map((x) => C4.XY(C4.to(x)).join(","));
  assert.ok(m.includes("0,3") && m.includes("3,0") && m.includes("10,3") && m.includes("3,10"), "les bras de la croix sont atteignables");
});
t("capturer le roi élimine le joueur et retire ses pièces", () => {
  const s = C4.newGame(); s.b.fill(0);
  s.b[sq(7, 13)] = C4.cell(0, C4.K); s.b[sq(0, 7)] = C4.cell(1, C4.K); s.b[sq(0, 5)] = C4.cell(1, C4.P); s.b[sq(6, 0)] = C4.cell(2, C4.K); s.b[sq(13, 6)] = C4.cell(3, C4.K);
  s.b[sq(4, 7)] = C4.cell(0, C4.R); s.turn = 0;
  const m = C4.moves(s, 0).find((x) => C4.to(x) === sq(0, 7));
  const r = C4.play(s, m);
  assert.deepStrictEqual(r.eliminated, [1]); assert.ok(!s.alive[1]); assert.strictEqual(s.b[sq(0, 5)], 0, "pièces du vaincu retirées");
  assert.strictEqual(s.pts[0], 15); assert.strictEqual(s.turn, 2, "le tour passe au joueur suivant vivant");
  assert.strictEqual(C4.over(s), false);
});
t("alliés : captures interdites, équipe gagnante quand les autres sont éliminés", () => {
  const s = C4.newGame({ teams: [0, 1, 0, 1] }); s.b.fill(0);
  s.b[sq(7, 13)] = C4.cell(0, C4.K); s.b[sq(6, 0)] = C4.cell(2, C4.K); s.b[sq(0, 7)] = C4.cell(1, C4.K); s.b[sq(13, 6)] = C4.cell(3, C4.K);
  s.b[sq(7, 7)] = C4.cell(0, C4.R); s.b[sq(7, 5)] = C4.cell(2, C4.P);
  let m = C4.moves(s, 0).map((x) => C4.to(x));
  assert.ok(!m.includes(sq(7, 5)), "le pion allié n'est pas capturable");
  assert.ok(m.includes(sq(7, 6)));
  s.alive[1] = false; s.out.push(1); s.b[sq(0, 7)] = 0; s.alive[3] = false; s.out.push(3); s.b[sq(13, 6)] = 0;
  assert.ok(C4.over(s), "il ne reste que l'équipe 0");
});
t("tempête : le bord s'effondre, les pièces sont détruites, un roi détruit = éliminé", () => {
  const s = C4.newGame({ storm: { first: 1, every: 1 } }); s.b.fill(0);
  s.b[sq(7, 13)] = C4.cell(0, C4.K); s.b[sq(5, 13)] = C4.cell(0, C4.R); s.b[sq(0, 7)] = C4.cell(1, C4.K); s.b[sq(6, 5)] = C4.cell(2, C4.K); s.b[sq(13, 6)] = C4.cell(3, C4.K);
  s.turn = 0;
  const m = C4.moves(s, 0).find((x) => C4.to(x) === sq(5, 12));        // la tour quitte le bord
  const r = C4.play(s, m);
  assert.ok(r.storm && s.level === 1);
  assert.ok(!s.alive[0] && !s.alive[1] && !s.alive[3] && s.alive[2], "rois du bord détruits, celui du centre survit");
  assert.strictEqual(C4.stormIn(C4.newGame({ storm: { first: 100, every: 40 } })), 100);
});
t("classement : survivant, puis éliminés du dernier au premier", () => {
  const s = C4.newGame(); s.alive = [true, false, false, false]; s.out = [2, 3, 1]; s.pts = [30, 0, 5, 9];
  assert.deepStrictEqual(C4.ranking(s).map((r) => r.o), [0, 1, 3, 2]);
});
t("make / unmake restituent la position", () => {
  const s = C4.newGame(), before = s.b.slice();
  for (const m of C4.moves(s, 0)) { const u = C4.make(s, m); C4.unmake(s, u); }
  assert.deepStrictEqual(Array.from(s.b), Array.from(before));
});
t("cases attaquées : le pion attaque en diagonale, la tour s'arrête sur le premier obstacle", () => {
  const s = C4.newGame(); s.b.fill(0); s.b[sq(5, 12)] = C4.cell(0, C4.P); s.b[sq(7, 7)] = C4.cell(0, C4.R); s.b[sq(7, 4)] = C4.cell(2, C4.P);
  const a = C4.attackedBy(s, 0);
  assert.ok(a[sq(4, 11)] && a[sq(6, 11)] && !a[sq(5, 11)]);
  assert.ok(a[sq(7, 4)] && !a[sq(7, 3)]);
});
console.log(n + " tests OK");
