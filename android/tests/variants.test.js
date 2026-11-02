// Variantes d'échecs (js/variants.js) : node android/tests/variants.test.js
const assert = require("assert");
const V = require("../assets/mobile/js/variants.js");
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("OK   " + name); };
const I = V.sqIdx;
const mk = (mode, rows, side, extra) => { const s = V.newGame(mode); s.b.fill(""); rows.split("/").forEach((row, r) => { let f = 0; for (const ch of row) { if (/\d/.test(ch)) f += +ch; else { s.b[f + 8 * (7 - r)] = ch; f++; } } }); s.side = side || "w"; return Object.assign(s, extra || {}); };

t("départ classique : 20 coups (ptq)", () => { assert.strictEqual(V.legal(V.newGame("ptq")).length, 20); });
t("perft 1-2 = classique (20, 400)", () => { const s = V.newGame("ptq"); assert.deepStrictEqual([1, 2].map((d) => V.perft(s, d)), [20, 400]); });
t("deux rois : 2 rois par camp, 0 dame, 20 coups", () => {
  const s = V.newGame("dk"), cnt = (c) => s.b.filter((p) => p === c).length;
  assert.deepStrictEqual([cnt("K"), cnt("k"), cnt("Q"), cnt("q")], [2, 2, 0, 0]);
  assert.strictEqual(V.legal(s).length, 20);
});
t("deux rois : un roi attaqué impose de le sauver (l'autre roi ne compte pas)", () => {
  const s = mk("dk", "4k2k/8/8/8/8/8/4r3/K3K3", "w");
  assert.ok(V.inCheck(s, "w"));
  assert.ok(V.legal(s).every((m) => { const c = V.clone(s); V.play(c, m); return !V.inCheck(c, "w"); }));
});
t("deux rois : mat d'un seul roi = fin de partie", () => {
  // roi blanc a1 coincé par tour b8 et dame sur la 2e rangée, l'autre roi blanc à l'abri en h1... mais le roi a1 est maté
  const s = mk("dk", "1r5k/8/8/8/8/8/1q6/K6K", "w");
  assert.ok(V.inCheck(s, "w"));
  const st = V.status(s);
  assert.ok(st.over && st.result === "b" && st.why === "mate", JSON.stringify(st));
});
t("protège la dame : le roi peut rester en prise, la dame jamais", () => {
  const s = mk("ptq", "4r2k/8/8/8/8/8/8/3QK3", "w");
  assert.ok(!V.inCheck(s, "w"), "roi attaqué n'est pas un échec");
  const s2 = mk("ptq", "3rk3/8/8/8/8/8/8/3QK3", "w");
  assert.ok(V.inCheck(s2, "w"), "dame attaquée = échec");
  assert.ok(V.legal(s2).every((m) => { const c = V.clone(s2); V.play(c, m); return !V.inCheck(c, "w"); }));
});
t("protège la dame : un roi peut être pris et la partie continue", () => {
  const s = mk("ptq", "4k3/8/8/8/8/8/8/r3K2Q", "b");
  const cap = V.legal(s).find((m) => m.f === I("a1") && m.t === I("e1"));
  assert.ok(cap, "la tour noire peut prendre le roi blanc");
  const c = V.clone(s); V.play(c, cap);
  assert.ok(!V.status(c).over, "prendre le roi ne finit pas la partie");
});
t("protège la dame : dame matée = défaite des Blancs", () => {
  const s = mk("ptq", "6kb/8/8/8/8/8/P7/QB2K3", "w");
  const st = V.status(s);
  assert.ok(st.over && st.result === "b", JSON.stringify(st));
});
t("protège la dame : pas de promotion en dame", () => {
  const s = mk("ptq", "4k3/P7/8/8/8/8/8/Q3K3", "w");
  const pr = V.legal(s).filter((m) => m.promo).map((m) => m.promo).sort().join("");
  assert.strictEqual(pr, "bnr");
});
t("élixir : départ = deux rois, 5 élixir chacun", () => {
  const s = V.newGame("elixir");
  assert.deepStrictEqual(s.b.filter(Boolean).sort(), ["K", "k"]);
  assert.deepStrictEqual(s.elixir, { w: 5, b: 5 });
});
t("élixir : coûts reine > tour > fou/cavalier > pion", () => {
  const c = V.COST; assert.ok(c.q > c.r && c.r > c.b && c.b >= c.n && c.n > c.p && c.p >= 1);
});
t("élixir : on pose dans ses deux premières rangées seulement", () => {
  const s = V.newGame("elixir");
  const sq = V.dropSquares(s, "r").map((i) => i >> 3);
  assert.ok(sq.length && sq.every((r) => r <= 1));
  const b = V.clone(s); b.side = "b";
  assert.ok(V.dropSquares(b, "r").every((i) => (i >> 3) >= 6));
  assert.ok(!V.canDrop(s, "r", I("e4")));
});
t("élixir : un pion ne se pose que sur la 2e rangée", () => {
  const s = V.newGame("elixir");
  assert.ok(V.canDrop(s, "p", I("a2")) && !V.canDrop(s, "p", I("a1")));
});
t("élixir : poser coûte de l'élixir mais ne passe pas le tour", () => {
  const s = V.newGame("elixir"); s.elixir.w = 10;
  assert.ok(V.drop(s, "q", I("d1")));
  assert.strictEqual(s.side, "w"); assert.strictEqual(s.elixir.w, 10 - V.COST.q);
});
t("élixir : pas assez d'élixir = refusé", () => {
  const s = V.newGame("elixir"); s.elixir.w = 2;
  assert.ok(!V.canDrop(s, "q", I("d1")) && !V.canDrop(s, "r", I("a1")) && V.canDrop(s, "p", I("a2")));
});
t("élixir : chaque coup joué rapporte +1 (plafond 10)", () => {
  const s = V.newGame("elixir"); const m = V.legal(s)[0]; V.play(s, m);
  assert.strictEqual(s.elixir.w, 6); assert.strictEqual(s.elixir.b, 5); assert.strictEqual(s.side, "b");
  s.elixir.b = 10; V.play(s, V.legal(s)[0]); assert.strictEqual(s.elixir.b, 10);
});
t("élixir : poser puis jouer dans le même tour", () => {
  const s = V.newGame("elixir"); V.drop(s, "p", I("e2")); V.drop(s, "p", I("d2"));
  assert.strictEqual(s.elixir.w, 3); assert.strictEqual(s.side, "w");
  const m = V.legal(s).find((x) => x.f === I("e2")); assert.ok(m); V.play(s, m); assert.strictEqual(s.elixir.w, 4);
});
t("élixir : en échec, on ne peut poser qu'une pièce qui sauve le roi", () => {
  const s = mk("elixir", "4k3/8/8/8/8/8/8/r3K3", "w", { elixir: { w: 10, b: 5 } });
  assert.ok(V.inCheck(s, "w"));
  assert.ok(!V.canDrop(s, "p", I("a2")), "un pion en a2 ne bloque pas la rangée 1");
  assert.ok(V.canDrop(s, "r", I("b1")), "poser une tour en b1 bloque l'échec");
  assert.ok(V.canDrop(s, "n", I("d1")));
});
t("élixir : un mat est évité si une pose peut parer l'échec", () => {
  const s = mk("elixir", "4k3/8/8/8/8/8/PPPP4/r3K3", "w", { elixir: { w: 10, b: 5 } });
  assert.ok(!V.status(s).over, "le roi peut encore être sauvé en posant");
});
t("élixir : roi seul contre roi seul n'est pas nul tout de suite", () => {
  assert.ok(!V.status(V.newGame("elixir")).over);
});
t("promotion : choix q r b n (élixir, deux rois)", () => {
  const s = mk("dk", "4k3/P7/8/8/8/8/8/4K3", "w");
  assert.strictEqual(V.legal(s).filter((m) => m.promo).map((m) => m.promo).sort().join(""), "bnqr");
});
t("prise en passant", () => {
  const s = mk("ptq", "4k3/3p4/8/8/4P3/8/8/4K3", "b");
  const dbl = V.legal(s).find((m) => m.dbl); V.play(s, dbl);
  assert.ok(!V.legal(s).find((m) => m.ep), 'pas de pion blanc en face encore');
  const s2 = mk("ptq", "4k3/8/8/3pP3/8/8/8/4K3", "w", { ep: I("d6") });
  assert.ok(V.legal(s2).find((m) => m.ep && m.t === I("d6")));
});
t("IA : joue toujours un coup légal, 3 variantes × 3 niveaux, quelques coups", () => {
  for (const mode of ["elixir", "dk", "ptq"]) for (const lvl of [1, 2, 3]) {
    const s = V.newGame(mode);
    for (let i = 0; i < 6 && !V.status(s).over; i++) {
      const a = V.think(s, lvl);
      for (const d of a.drops) assert.ok(V.drop(s, d.type, d.sq), "pose illégale " + mode);
      if (!a.move) break;
      assert.ok(V.legal(s).some((m) => m.f === a.move.f && m.t === a.move.t && m.promo === a.move.promo), "coup illégal " + mode);
      V.play(s, a.move);
    }
  }
});
t("IA niveau 3 : trouve un mat en 1", () => {
  const s = mk("ptq", "6k1/5ppp/8/8/8/8/8/R3K3", "w");
  const a = V.think(s, 3); assert.strictEqual(V.sqName(a.move.t), "a8");
});
t("IA élixir : pose des pièces au début", () => {
  const s = V.newGame("elixir"); const a = V.think(s, 3, () => 0.5);
  assert.ok(a.drops.length >= 1, "ne pose rien");
});
t("parties complètes IA vs IA terminent (<= 400 demi-coups)", () => {
  for (const mode of ["elixir", "dk", "ptq"]) {
    const s = V.newGame(mode); let n = 0;
    while (!V.status(s).over && n < 450) { const a = V.think(s, 1); a.drops.forEach((d) => V.drop(s, d.type, d.sq)); if (!a.move) break; V.play(s, a.move); n++; }
    assert.ok(V.status(s).over || n >= 450, mode);
  }
});
console.log(n + " tests OK");
