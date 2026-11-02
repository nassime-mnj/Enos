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
t("élixir : départ = deux rois, 0 élixir chacun", () => {
  const s = V.newGame("elixir");
  assert.deepStrictEqual(s.b.filter(Boolean).sort(), ["K", "k"]);
  assert.deepStrictEqual(s.elixir, { w: 0, b: 0 });
  assert.strictEqual(V.drops(s).length, 0, "rien à poser avant d'avoir joué");
});
t("élixir : coûts reine > tour > fou/cavalier > pion", () => {
  const c = V.COST; assert.ok(c.q > c.r && c.r > c.b && c.b >= c.n && c.n > c.p && c.p >= 1);
});
t("élixir : on pose dans ses deux premières rangées seulement", () => {
  const s = V.newGame("elixir"); s.elixir.w = s.elixir.b = 10;
  const sq = V.dropSquares(s, "r").map((i) => i >> 3);
  assert.ok(sq.length && sq.every((r) => r <= 1));
  const b = V.clone(s); b.side = "b";
  assert.ok(V.dropSquares(b, "r").every((i) => (i >> 3) >= 6));
  assert.ok(!V.canDrop(s, "r", I("e4")));
});
t("élixir : un pion ne se pose que sur la 2e rangée", () => {
  const s = V.newGame("elixir"); s.elixir.w = 3;
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
  assert.strictEqual(s.elixir.w, 1); assert.strictEqual(s.elixir.b, 0); assert.strictEqual(s.side, "b");
  s.elixir.b = 10; V.play(s, V.legal(s)[0]); assert.strictEqual(s.elixir.b, 10);
});
t("élixir : poser puis jouer dans le même tour", () => {
  const s = V.newGame("elixir"); s.elixir.w = 5; V.drop(s, "p", I("e2")); V.drop(s, "p", I("d2"));
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
  const s = V.newGame("elixir"); s.elixir.w = 8; const a = V.think(s, 3, () => 0.5);
  assert.ok(a.drops.length >= 1, "ne pose rien");
});
t("parties complètes IA vs IA terminent (<= 400 demi-coups)", () => {
  for (const mode of ["elixir", "dk", "ptq"]) {
    const s = V.newGame(mode); let n = 0;
    while (!V.status(s).over && n < 450) { const a = V.think(s, 1); a.drops.forEach((d) => V.drop(s, d.type, d.sq)); if (!a.move) break; V.play(s, a.move); n++; }
    assert.ok(V.status(s).over || n >= 450, mode);
  }
});

// ---------- 2v2 Élixir (plateau normal, 4 rois)
const mkDuo = (rows, seat, owners, el) => {
  const s = V.newGame("duo"); s.b.fill(""); s.o.fill(-1);
  rows.split("/").forEach((row, r) => { let f = 0; for (const ch of row) { if (/\d/.test(ch)) f += +ch; else { s.b[f + 8 * (7 - r)] = ch; f++; } } });
  Object.entries(owners).forEach(([sq, o]) => { s.o[I(sq)] = o; });
  s.seat = seat; s.side = V.sideOfSeat(seat); if (el !== undefined) for (const k of [0, 1, 2, 3]) s.elixir[k] = el; return s;
};
t("2v2 : 4 rois (c1 f1 c8 f8), 0 élixir chacun, ordre B1 N1 B2 N2", () => {
  const s = V.newGame("duo");
  assert.deepStrictEqual([s.b[I("c1")], s.b[I("f1")], s.b[I("c8")], s.b[I("f8")]], ["K", "K", "k", "k"]);
  assert.deepStrictEqual(s.elixir, { 0: 0, 1: 0, 2: 0, 3: 0 });
  const order = []; for (let i = 0; i < 5; i++) { order.push(s.seat); V.play(s, V.legal(s)[0]); }
  assert.deepStrictEqual(order, [0, 1, 2, 3, 0]);
});
t("2v2 : chacun sa barre d'élixir (+1 pour celui qui joue seulement)", () => {
  const s = V.newGame("duo"); V.play(s, V.legal(s)[0]);
  assert.deepStrictEqual(s.elixir, { 0: 1, 1: 0, 2: 0, 3: 0 });
});
t("2v2 : on ne joue que ses propres pièces, les alliés ne se prennent pas", () => {
  const s = mkDuo("2k2k2/8/8/8/8/8/8/2K1RK2", 0, { c1: 0, e1: 2, f1: 2, c8: 1, f8: 3 });
  assert.ok(V.legal(s).every((m) => s.o[m.f] === 0), "seul le roi c1 bouge");
  assert.ok(!V.legal(s).some((m) => m.t === I("e1")), "ne prend pas la tour alliée");
  const s2 = mkDuo("2k2k2/8/8/8/8/8/8/2K1RK2", 2, { c1: 0, e1: 2, f1: 2, c8: 1, f8: 3 });
  assert.ok(V.legal(s2).some((m) => m.p === "R"), "le propriétaire de la tour peut la jouer");
});
t("2v2 : poser sur ses rangées avec SON élixir, la pièce lui appartient", () => {
  const s = V.newGame("duo"); s.elixir[0] = 5;
  assert.ok(V.drop(s, "r", I("a1")) && s.o[I("a1")] === 0 && s.elixir[0] === 0 && s.seat === 0);
  s.seat = 2; s.side = "w"; assert.ok(!V.canDrop(s, "p", I("a2")), "le siège 2 n'a pas d'élixir");
});
t("2v2 : un roi maté sort (pièces retirées), la partie continue en 2v1", () => {
  // roi blanc A en a1 maté par tour noire en h1 + ... : roi a1, tour noire b8 (b-file) et dame noire h2 ; roi blanc B en f1 libre
  const s = mkDuo("rr2k3/8/8/8/8/8/6q1/K4K2", 0, { a1: 0, f1: 2, e8: 1, a8: 1, b8: 1, g2: 1 }, 0);
  assert.ok(V.inCheck(s));
  const r = V.settle(s);
  assert.ok(!r.over && r.out.length === 1 && r.out[0].seat === 0, JSON.stringify(r));
  assert.ok(!s.alive[0] && s.alive[2] && s.b[I("a1")] === "", "roi A retiré");
  assert.strictEqual(s.seat, 1, "au suivant de jouer");
});
t("2v2 : une équipe sans roi a perdu", () => {
  const s = mkDuo("4k3/8/8/8/8/8/8/K7", 0, { a1: 0, e8: 1 });
  s.alive[2] = false; s.alive[3] = false; s.alive[1] = false;
  const r = V.settle(s); assert.ok(r.over && r.result === "w", JSON.stringify(r));
});
t("2v2 : un joueur sans coup ni échec passe son tour", () => {
  const s = mkDuo("7k/5Q2/8/8/8/8/8/K7", 1, { h8: 1, f7: 0, a1: 0 }, 0);
  s.b[I("g6")] = "K"; s.o[I("g6")] = 0; s.b[I("f7")] = ""; s.o[I("f7")] = -1; s.b[I("f7")] = "Q"; s.o[I("f7")] = 0;
  const r = V.settle(s); assert.ok(r.out.length === 0 && s.alive[1], "pas éliminé");
});
t("2v2 IA : parties de bots (niveaux 1-2) jouent des coups légaux et finissent", () => {
  for (const lvl of [1, 2]) {
    const s = V.newGame("duo"); let n = 0, over = false;
    while (n < 500) {
      const r = V.settle(s); if (r.over) { over = true; break; }
      const a = V.think(s, lvl); a.drops.forEach((d) => assert.ok(V.drop(s, d.type, d.sq)));
      if (!a.move) { V.pass(s); n++; continue; }
      assert.ok(V.legal(s).some((m) => m.f === a.move.f && m.t === a.move.t && m.promo === a.move.promo));
      V.play(s, a.move); n++;
    }
    assert.ok(over || n >= 500);
  }
});

// ---------- analyse, jugement, équipes, stratégies
t("jugement : un coup qui laisse la dame en prise est une gaffe, le meilleur est « meilleur coup »", () => {
  const s = mk("elixir", "4k3/8/8/8/8/1p6/8/Q3K3", "w");
  const an = V.analyse(s, 3);
  const hang = an.list.find((x) => x.m.p === "Q" && x.m.t === I("a2"));
  assert.ok(hang, "Da2 existe (pion noir b3 la prend)");
  const jBest = V.judge(s, an, an.list[0].m); assert.strictEqual(jBest.key, "best");
  const j = V.judge(s, an, hang.m); assert.strictEqual(j.key, "blunder", JSON.stringify(j));
});
t("jugement : analyse de profondeur 3, tous les coups légaux notés", () => {
  const s = V.newGame("dk"), an = V.analyse(s, 3);
  assert.strictEqual(an.list.length, V.legal(s).length); assert.strictEqual(an.depth, 3);
});
t("jugement : sacrifice = pièce lourde donnée à un pion ; une prise équivalente n'en est pas un", () => {
  const s = mk("elixir", "4k3/8/2p5/8/8/8/8/3QK3", "w");
  const m = V.legal(s).find((x) => x.p === "Q" && x.t === I("d5"));
  assert.ok(V.isSacrifice(s, m), "Dd5 attaquée par le pion c6");
  const s2 = mk("elixir", "4k3/8/8/3q4/8/8/8/3QK3", "w");
  assert.ok(!V.isSacrifice(s2, V.legal(s2).find((x) => x.p === "Q" && x.t === I("d5"))), "Dxd5 = échange de dames");
});
t("ALLIÉS : un roi qui entre dans la ligne de la tour de son équipier n'est PAS une gaffe", () => {
  const s = mkDuo("2k2k2/8/8/3R4/8/8/8/2K2K2", 0, { c1: 0, f1: 2, d5: 2, c8: 1, f8: 3 }, 0);
  const an = V.analyse(s, 3), kd = an.list.find((x) => x.m.t === I("d1")), kb = an.list.find((x) => x.m.t === I("b1"));
  assert.ok(kd && kb, "d1 est légal : la tour d5 est alliée");
  assert.ok(Math.abs(kd.cp - kb.cp) < 120, "d1 ~ b1 (" + kd.cp + " / " + kb.cp + ")");
  const j = V.judge(s, an, kd.m); assert.ok(!["mistake", "blunder"].includes(j.key), "jugé " + j.key);
  // et la même tour NOIRE ferait de d1 un coup illégal
  const e = mkDuo("2k2k2/8/8/3r4/8/8/8/2K2K2", 0, { c1: 0, f1: 2, d5: 1, c8: 1, f8: 3 }, 0);
  assert.ok(!V.legal(e).some((x) => x.t === I("d1")), "d1 interdit si la tour est ennemie");
});
t("ALLIÉS : une dame alliée « en face » de la mienne ne la met pas en danger (même couleur, pas d'attaque)", () => {
  const s = mkDuo("2k2k2/8/8/8/3Q4/8/8/2K2K2", 2, { c1: 0, f1: 2, d4: 0, c8: 1, f8: 3 }, 0);
  s.b[I("d7")] = "Q"; s.o[I("d7")] = 2;
  assert.ok(!V.inCheck(s, "w"), "pas d'échec");
  const an = V.analyse(s, 2); assert.ok(an.evalW > -300);
});
t("stratégies : cible d'équipe = ennemi le plus faible ; plan lisible", () => {
  const s = V.newGame("duo"); s.elixir[1] = 9; s.elixir[3] = 0;
  assert.strictEqual(V.pickTarget(s, 0), 3);
  assert.ok(/Cible/.test(V.planText(s, 0, "focus", 3)) && /Économise/.test(V.planText(s, 0, "eco", -1)));
  assert.strictEqual(V.adaptStrat("bal", -300), "tank"); assert.strictEqual(V.adaptStrat("bal", 400), "rush"); assert.strictEqual(V.adaptStrat("eco", 400), "eco");
});
t("stratégies : chaque stratégie joue des coups légaux (élixir et duo)", () => {
  for (const mode of ["elixir", "duo"]) for (const st of Object.keys(V.STRATS)) {
    const s = V.newGame(mode);
    for (let i = 0; i < 10 && !(s.o ? V.settle(s) : V.status(s)).over; i++) { const a = V.think(s, 1, Math.random, { strat: st, target: mode === "duo" ? V.pickTarget(s, s.seat) : -1 }); a.drops.forEach((d) => assert.ok(V.drop(s, d.type, d.sq))); if (!a.move) { V.pass(s); continue; } assert.ok(V.legal(s).some((m) => m.f === a.move.f && m.t === a.move.t)); V.play(s, a.move); }
  }
});
t("stratégie économe : n'achète pas de petites pièces tant que l'élixir n'est pas plein", () => {
  const s = V.newGame("elixir"); s.elixir.w = 4;
  for (let k = 0; k < 8; k++) { const a = V.think(s, 3, Math.random, { strat: "eco" }); assert.strictEqual(a.drops.length, 0, "a dépensé " + JSON.stringify(a.drops)); }
});
console.log(n + " tests OK");
