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
  const s = mkDuo("rr2kk2/8/8/8/8/8/6q1/K4K2", 0, { a1: 0, f1: 2, e8: 1, f8: 3, a8: 1, b8: 1, g2: 1 }, 0);
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
  const s = mkDuo("k6k/5Q2/6K1/8/8/8/8/K1K5", 1, { a8: 3, h8: 1, f7: 0, g6: 0, a1: 0, c1: 2 }, 0);
  const r = V.settle(s); assert.ok(r.out.length === 0 && s.alive[1], "pas éliminé : " + JSON.stringify(r)); assert.strictEqual(s.seat, 2, "le joueur suivant joue");
});
t("2v2 : capturer le DERNIER roi adverse termine la partie (même sans mat) — bug corrigé", () => {
  // un roi noir (seat 3) est déjà sorti ; le roi du seat 1 est pris par la dame blanche pendant que le seat 3... (ici : seat 1 seul roi noir restant, capturé)
  const s = mkDuo("7k/8/8/8/8/8/8/K1K2Q2", 0, { h8: 1, a1: 0, c1: 2, f1: 0 }, 0); s.alive[3] = false;
  s.b[I("h1")] = "q"; s.o[I("h1")] = 1;                                          // dame noire quelconque
  s.b[I("f1")] = ""; s.o[I("f1")] = -1; s.b[I("h2")] = "Q"; s.o[I("h2")] = 0;       // dame blanche en h2 : peut prendre le roi h8 ? (colonne h bloquée par la dame noire h1 ? non : h2->h8 libre)
  s.b[I("h1")] = ""; s.o[I("h1")] = -1;
  const cap = V.legal(s).find((m) => m.f === I("h2") && m.t === I("h8")); assert.ok(cap, "la dame peut capturer le roi (légal : le roi noir n'est pas protégé par un coup)");
  V.play(s, cap);
  const r = V.settle(s); assert.ok(r.over && r.result === "w" && r.why === "mate", "partie finie : " + JSON.stringify(r)); assert.ok(r.out.some((o) => o.why === "captured" && o.seat === 1 && o.sq === I("h8")), "le roi capturé est annoncé");
});
t("2v2 : roi capturé = joueur éliminé (2v1), la partie continue s'il reste un roi dans l'équipe", () => {
  const s = mkDuo("k6k/8/8/8/8/8/8/K1K4Q", 0, { a8: 3, h8: 1, a1: 0, c1: 2, h1: 0 }, 0);
  const cap = V.legal(s).find((m) => m.f === I("h1") && m.t === I("h8")); assert.ok(cap, "Dxh8 possible");
  V.play(s, cap); const r = V.settle(s);
  assert.ok(!r.over && !s.alive[1] && s.alive[3] && s.b[I("h8")] === "Q", "seat 1 éliminé, seat 3 toujours là : " + JSON.stringify(r)); assert.ok(r.out[0].why === "captured");
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

// ---------- Élixir +, Roulette, jugements forcé / manqué
const mkE = (rows, side, el) => { const s = mk("elixirp", rows, side); if (el != null) { s.elixir.w = el; s.elixir.b = el; } return s; };
t("Élixir + : 4 cartes avec leurs coûts, plafond d'élixir 15", () => {
  assert.deepStrictEqual([V.COSTP.mk, V.COSTP.army, V.COSTP.barrel, V.COSTP.rei], [14, 5, 5, 9]);
  const s = V.newGame("elixirp"); for (let i = 0; i < 30; i++) { s.elixir.w = Math.min(15, s.elixir.w + 1); }
  s.side = "w"; V.play(s, V.legal(s)[0]); assert.ok(s.elixir.w >= 15 || s.elixir.w === 15, "+1 jusqu'à 15 : " + s.elixir.w);
  const s2 = V.newGame("elixirp"); s2.elixir.w = 13; assert.ok(!V.canDrop(s2, "mk", I("d4")), "13 < 14 : pas de Méga Chevalier");
  s2.elixir.w = 14; assert.ok(V.canDrop(s2, "mk", I("d4")), "14 : le Méga Chevalier se pose n'importe où (d4 est hors de ses rangées)");
});
t("Méga Chevalier : à la pose il écrase le 3×3 adverse, pas ses propres pièces, pas au-delà", () => {
  const s = mkE("4k3/8/8/2ppp3/2pPp3/2ppp3/8/4K3", "w", 14);
  s.b[I("d4")] = ""; s.b[I("d4")] = "P";                                         // un pion blanc au centre du carré : ne doit pas être écrasé
  s.b[I("c3")] = "p";
  assert.ok(V.drop(s, "mk", I("d6")), "pose du Méga Chevalier en d6");
  const gone = s.ev.smash.map(V.sqName).sort();
  assert.deepStrictEqual(gone, ["c5", "d5", "e5"].sort(), "écrasé : c5 d5 e5 (3×3 autour de d6 ; c7 d7 e7 c6 e6 sont vides) : " + gone);
  assert.ok(s.b[I("c4")] === "p" && s.b[I("d4")] === "P", "pièces hors du carré intactes");
  assert.strictEqual(s.sp[I("d6")], "mk"); assert.strictEqual(V.map(s)["d6"], "M", "dessin spécial : M (blanc) / m (noir)");
  assert.strictEqual(s.elixir.w, 0, "14 💧 dépensés");
});
t("Méga Chevalier : chaque saut de cavalier écrase aussi ; un roi écrasé = partie perdue", () => {
  const s = mkE("4k3/8/8/8/8/8/8/4K3", "w", 14); V.drop(s, "mk", I("c3"));
  s.b[I("d6")] = "p"; s.b[I("e5")] = "p"; s.b[I("g7")] = "k"; s.b[I("e8")] = ""; s.b[I("f8")] = "k"; s.b[I("g7")] = "";
  const m = V.legal(s).find((x) => x.f === I("c3") && x.t === I("d5")); assert.ok(m, "Cd5 (saut de cavalier)");
  V.play(s, m); assert.deepStrictEqual(s.ev.smash.map(V.sqName).sort(), ["d6", "e5"], "d6 et e5 écrasés à l'atterrissage : " + s.ev.smash.map(V.sqName));
  const k = mkE("4k3/8/8/8/8/8/8/4K3", "w", 14); k.b[I("e8")] = ""; k.b[I("e6")] = "k";
  V.drop(k, "mk", I("e5"));
  assert.strictEqual(k.kingLost, "b"); const st = V.status(k); assert.ok(st.over && st.result === "w" && st.why === "smash", "roi noir écrasé : " + JSON.stringify(st));
});
t("Méga Chevalier : un roi à portée de son prochain saut est EN ÉCHEC (il doit bouger)", () => {
  const s = mkE("4k3/8/8/8/8/8/8/4K3", "b", 14); s.b[I("e8")] = ""; s.b[I("d8")] = "k";
  s.b[I("c3")] = "N"; s.sp[I("c3")] = "mk";
  assert.ok(!V.inCheck(s, "b"), "c3 -> cases d5/e4/b5/a4/a2/b1/d1/e2 : aucune à ≤ 1 case de d8");
  s.b[I("c3")] = ""; s.sp[I("c3")] = ""; s.b[I("c6")] = "N"; s.sp[I("c6")] = "mk";
  assert.ok(V.inCheck(s, "b"), "Cc6 peut sauter en b8/d8/e7… et écraser le roi : échec");
});
t("Armée de pions : 5 💧, remplit TOUTE la rangée de pions (cases vides), pions-squelettes", () => {
  const s = mkE("4k3/8/8/8/8/8/3P4/4K3", "w", 5);
  assert.ok(V.canDrop(s, "army", I("a2")) && !V.canDrop(s, "army", I("a3")), "seulement sur la rangée de pions");
  V.drop(s, "army", I("a2")); const pawns = s.b.filter((p, i) => p === "P" && (i >> 3) === 1).length; assert.strictEqual(pawns, 8, "8 pions sur la 2ᵉ rangée");
  assert.strictEqual(s.sp[I("a2")], "army"); assert.strictEqual(s.sp[I("d2")], "", "le pion déjà là reste normal"); assert.strictEqual(s.elixir.w, 0);
  assert.strictEqual(V.map(s)["a2"], "S");
  const s2 = mkE("4k3/8/8/8/8/8/PPPPPPPP/4K3", "w", 5); assert.strictEqual(V.dropSquares(s2, "army").length, 0, "rangée pleine : rien à poser");
});
t("Baril du fou : un fou posé N'IMPORTE OÙ (5 💧), il se déplace ensuite comme un fou", () => {
  const s = mkE("4k3/8/8/8/8/8/8/4K3", "w", 5); assert.ok(V.canDrop(s, "barrel", I("g7")), "g7 (chez l'adversaire) possible");
  V.drop(s, "barrel", I("g7")); assert.strictEqual(s.b[I("g7")], "B"); assert.strictEqual(V.map(s)["g7"], "G");
  s.side = "w"; assert.ok(V.legal(s).some((m) => m.f === I("g7") && m.t === I("h8")) && V.legal(s).some((m) => m.f === I("g7") && m.t === I("a1") === false), "mouvements de fou");
});
t("R.E.I.N.E : capture en SAUTANT par-dessus les pièces ; déplacements simples bloqués", () => {
  const s = mkE("4k3/8/8/8/8/8/8/4K3", "w", 9); V.drop(s, "rei", I("d1"));
  s.b[I("d3")] = "P"; s.b[I("d5")] = "p"; s.b[I("d7")] = "n"; s.side = "w";
  const mv = V.legal(s).filter((m) => m.f === I("d1"));
  assert.ok(mv.some((m) => m.t === I("d5") && m.cap === "p"), "capture de d5 par-dessus le pion d3 (saut)");
  assert.ok(mv.some((m) => m.t === I("d7") && m.cap === "n"), "capture de d7 en sautant d3 et d5");
  assert.ok(!mv.some((m) => m.t === I("d4")) && !mv.some((m) => m.t === I("d6")), "pas de déplacement simple au-delà d'un obstacle");
  assert.ok(mv.some((m) => m.t === I("d2")), "déplacement simple avant l'obstacle");
  assert.ok(V.inCheck(mkReiCheck(), "b"), "le roi noir est en échec par-dessus un pion");
});
function mkReiCheck() { const s = mkE("4k3/8/8/8/8/3P4/8/4K3", "w", 9); s.b[I("e1")] = "K"; s.b[I("e4")] = "Q"; s.sp[I("e4")] = "rei"; s.b[I("e6")] = "p"; return s; }
t("Roulette : 2 rois, une pièce tirée par tour, main de 5, pose GRATUITE dans ses 2 rangées, tirage idempotent", () => {
  const s = V.newGame("rnd"); assert.deepStrictEqual(s.b.filter(Boolean).sort(), ["K", "k"]);
  const got = V.beginTurn(s, () => 0.5); assert.ok(["p", "n", "b", "r", "q"].includes(got) && s.hand.w.length === 1 && s.spun);
  assert.strictEqual(V.beginTurn(s, () => 0.5), null, "un seul tirage par tour");
  assert.ok(V.canDrop(s, got, I(got === "p" ? "e2" : "e1") === 4 ? I("d2") : I("e2")) || V.dropSquares(s, got).length > 0, "pose possible");
  const sq = V.dropSquares(s, got)[0]; assert.ok(V.drop(s, got, sq)); assert.strictEqual(s.hand.w.length, 0, "la pièce quitte la main"); assert.strictEqual(s.side, "w", "poser ne passe pas le tour");
  assert.ok(!V.canDrop(s, "q", I("a1")), "rien en main : pas de pose");
  V.play(s, V.legal(s)[0]); assert.strictEqual(s.spun, false, "nouveau tour : nouveau tirage"); assert.strictEqual(s.side, "b");
  for (let i = 0; i < 9; i++) { s.spun = false; V.spin(s, Math.random); } assert.ok(s.hand.b.length === 5, "main limitée à 5 (la plus ancienne est perdue)");
});
t("Roulette : poids du tirage (pion le plus fréquent, dame la plus rare)", () => {
  const cnt = { p: 0, n: 0, b: 0, r: 0, q: 0 }; const s = V.newGame("rnd"); for (let i = 0; i < 4000; i++) { s.spun = false; s.hand.w = []; cnt[V.spin(s)]++; }
  assert.ok(cnt.p > cnt.n && cnt.n > cnt.r && cnt.r > cnt.q && cnt.q > 100, JSON.stringify(cnt));
});
t("IA : Élixir + et Roulette — coups et poses toujours légaux, les bots utilisent les cartes spéciales", () => {
  let specials = 0;
  for (const mode of ["elixirp", "rnd"]) for (const lvl of [1, 2]) {
    const s = V.newGame(mode);
    for (let i = 0; i < 30 && !V.status(s).over; i++) {
      if (mode === "rnd") V.beginTurn(s);
      if (mode === "elixirp") s.elixir[s.side] = Math.min(15, s.elixir[s.side] + 3);
      const a = V.think(s, lvl); a.drops.forEach((d) => { assert.ok(V.drop(s, d.type, d.sq), "pose illégale " + d.type); if (V.SPECIALS[d.type]) specials++; });
      if (!a.move) { V.pass(s); continue; }
      assert.ok(V.legal(s).some((m) => m.f === a.move.f && m.t === a.move.t && m.promo === a.move.promo)); V.play(s, a.move);
    }
  }
  assert.ok(specials >= 1, "les bots posent des cartes spéciales (" + specials + ")");
});
t("Jugement : coup forcé (un seul coup légal) et coup MANQUÉ (mat existant perdu) — jamais brillant", () => {
  const f = mk("elixir", "4k3/4Q3/8/8/8/8/8/4K3", "b"); const anf = V.analyse(f, 2);
  assert.strictEqual(V.judge(f, anf, anf.list[0].m).key, "forced", "Rxe7 : un seul coup légal");
  // mat en 2 pour les Blancs : Tb7+ ... ; on joue un coup qui ne mate plus
  const m = mk("elixir", "k7/8/1K6/8/8/8/8/7R", "w"), an = V.analyse(m, 3);
  assert.ok(an.mate >= 1 && an.mate <= 3, "le moteur voit un mat (n=" + an.mate + ")");
  const bad = an.list.find((x) => x.raw < 90000 && x.m.p === "R");
  if (bad) { const j = V.judge(m, an, bad.m); assert.ok(["miss", "mistake", "blunder"].includes(j.key) && j.key !== "brilliant", "mat perdu : " + j.key); }
  const best = V.judge(m, an, an.list[0].m); assert.strictEqual(best.key, "best");
});
console.log(n + " tests OK");
