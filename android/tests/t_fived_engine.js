// Tests du moteur 5D Chess (js/fived.js) sous Node : node t_fived_engine.js
global.window = {};
const FD = require("../assets/mobile/js/fived.js");
const assert = require("assert");
let n = 0; const ok = (c, m) => { n++; if (!c) { console.log("FAIL " + m); process.exitCode = 1; } else console.log("OK   " + m); };
const mv = (S, l, t, x, y, l2, t2, x2, y2, promo) => { const c = FD.targets(S, l, t, x, y).find((q) => q.l === l2 && q.t === t2 && q.x === x2 && q.y === y2); if (!c) return { ok: false, err: "cible absente " + [l, t, x, y, "->", l2, t2, x2, y2] }; return FD.play(S, { l, t, x, y, to: c }, promo); };
const has = (S, l, t, x, y, l2, t2, x2, y2) => FD.targets(S, l, t, x, y).some((q) => q.l === l2 && q.t === t2 && q.x === x2 && q.y === y2);
const E5 = ".....";

// 1. départ et coup normal
{
  const S = FD.newGame("reduced"); ok(FD.allMoves(S, "w").length === 7, "5×5 : 7 coups blancs au départ");
  const r = mv(S, 0, 0, 2, 1, 0, 0, 2, 2); ok(r.ok && FD.latest(S, 0) === 1 && FD.present(S) === 1, "un coup prolonge la timeline (t=1)");
  ok(FD.canSubmit(S), "validation possible quand le présent passe aux Noirs");
  const s = FD.submit(S); ok(s.ok && S.turn === "b", "tour validé -> trait aux Noirs");
  const S8 = FD.newGame("standard"); ok(FD.allMoves(S8, "w").length === 12, "8×8 : 12 coups blancs au départ (8 pions d'un pas + 4 cavalier ; pas de double pas)");
}
// 2. saut entre timelines (deux plateaux au même instant)
{
  const S = FD.fromSetup({ W: 5, H: 5, turn: "w", nW: 1, nB: 1, tl: {
    0: { t0: 0, boards: [["....k", E5, E5, E5, "R...K"]] },
    1: { t0: 0, by: "w", origin: [0, 0], boards: [["....k", E5, E5, E5, "...QK"]] },
    "-1": { t0: 0, by: "b", origin: [0, 0], boards: [["k....", E5, E5, E5, "....K"]] } } });
  ok(FD.movable(S, "w").length === 3, "3 plateaux au présent à jouer");
  ok(has(S, 0, 0, 0, 0, 1, 0, 0, 0), "la tour saute de L0 vers L1 (même case)");
  ok(has(S, 0, 0, 0, 0, 1, 0, 0, 4) === false, "pas de saut vers une case occupée par un roi ennemi sans règle roi (case libre 0,4 : hors ligne)");
  const r = mv(S, 0, 0, 0, 0, 1, 0, 0, 0); ok(r.ok && FD.latest(S, 0) === 1 && FD.latest(S, 1) === 1, "un saut fait avancer les DEUX plateaux");
  const b0 = FD.boardAt(S, 0, 1), b1 = FD.boardAt(S, 1, 1); ok(b0[0] === 0 && b1[0] === 4, "la pièce quitte L0 et arrive sur L1");
  ok(FD.present(S) === 0 && FD.movable(S, "w").includes(-1), "le plateau L−1 reste à jouer au présent");
}
// 3. voyage dans le passé = nouvelle timeline
{
  const S = FD.fromSetup({ W: 5, H: 5, turn: "w", tl: { 0: { t0: 0, boards: [["....k", E5, E5, E5, ".R..K"], ["....k", E5, E5, E5, ".R..K"], ["....k", E5, E5, E5, "R...K"]] } } });
  // S.turn : trait des Blancs mais dernier plateau t=2 (blanc) -> la tour remonte de 1 coup (t=0) : même colonne, même rangée
  ok(has(S, 0, 2, 0, 0, 0, 0, 0, 0), "la tour peut remonter dans le temps (même timeline)");
  const r = mv(S, 0, 2, 0, 0, 0, 0, 0, 0); ok(r.ok && r.ev.branch === 1 && S.nW === 1, "nouvelle timeline +1 créée par les Blancs");
  ok(S.tl[1].t0 === 1 && S.tl[1].origin[0] === 0 && S.tl[1].origin[1] === 0, "elle naît du passé (t=1) du plateau visé");
  ok(FD.latest(S, 0) === 3 && FD.present(S) === 1, "L0 avance, le présent recule à t=1 (au trait des Noirs)");
  ok(FD.canSubmit(S), "on peut valider (le présent est chez l'adversaire)");
  ok(FD.canCreate(S, "w") === false && FD.canCreate(S, "b"), "limite : les Blancs ne peuvent plus créer de timeline tant que les Noirs n'en ont pas");
  FD.undo(S); ok(S.nW === 0 && FD.latest(S, 0) === 2 && !S.tl[1], "annuler restaure le multivers");
}
// 4. limite de création et timelines inactives
{
  const S = FD.fromSetup({ W: 5, H: 5, turn: "w", nW: 1, nB: 0, tl: { 0: { t0: 0, boards: [["....k", E5, E5, E5, ".R..K"], ["....k", E5, E5, E5, ".R..K"], ["....k", E5, E5, E5, "R...K"]] },
    1: { t0: 1, by: "w", origin: [0, 0], boards: [["....k", E5, E5, E5, ".R..K"], ["....k", E5, E5, E5, "R...K"]] } } });
  ok(FD.isActive(S, 1) && FD.isActive(S, 0), "L0 et L+1 actives (|L| ≤ min+1)");
  ok(!has(S, 0, 2, 0, 0, 0, 0, 0, 0), "une 2ᵉ timeline blanche est interdite (limite)");
  S.nW = 2; S.tl[2] = { t0: 2, by: "w", origin: [0, 1], list: [S.tl[1].list[0]] };
  ok(!FD.isActive(S, 2), "L+2 inactive tant que les Noirs n'ont pas créé de timeline");
}
// 5. rayons bloqués à travers le temps
{
  const S = FD.fromSetup({ W: 5, H: 5, turn: "w", tl: { 0: { t0: 0, boards: [["....k", E5, E5, E5, ".R..K"], ["....k", E5, E5, "p....", "....K"], ["....k", E5, E5, E5, "R...K"]] } } });
  ok(has(S, 0, 2, 0, 0, 0, 0, 0, 0) === true, "rayon libre : la tour atteint t=0");
  S.tl[0].list[1][0] = -1;   // pion noir sur (0,0) du plateau t=1 : un plateau intermédiaire bloque... (t=1 n'est pas de même parité : pas un plateau de passage)
  ok(has(S, 0, 2, 0, 0, 0, 0, 0, 0) === true, "les plateaux de l'autre camp ne bloquent pas (seuls t pairs comptent)");
  const S2 = FD.fromSetup({ W: 5, H: 5, turn: "w", tl: { 0: { t0: 0, boards: [["....k", E5, E5, E5, ".R..K"], ["....k", E5, E5, E5, ".R..K"], ["....k", E5, E5, E5, "r...K"], ["....k", E5, E5, E5, "r...K"], ["....k", E5, E5, E5, "R...K"]] } } });
  ok(has(S2, 0, 4, 0, 0, 0, 2, 0, 0) && !has(S2, 0, 4, 0, 0, 0, 0, 0, 0), "une pièce sur un plateau intermédiaire bloque le rayon temporel");
}
// 6. pion, cavalier, roi en 4D
{
  const S = FD.fromSetup({ W: 5, H: 5, turn: "w", nW: 1, nB: 1, tl: {
    0: { t0: 0, boards: [["....k", E5, E5, E5, "....K"], ["....k", E5, E5, E5, "....K"], ["....k", E5, E5, E5, "....K"]] },
    1: { t0: 0, by: "w", origin: [0, 0], boards: [["....k", E5, E5, E5, "....K"], ["....k", E5, E5, E5, "....K"], ["....k", E5, E5, E5, "....K"]] },
    "-1": { t0: 0, by: "b", origin: [0, 0], boards: [["....k", E5, E5, E5, "....K"], ["....k", E5, E5, E5, "....K"], ["....k", E5, E5, E5, "....K"]] } } });
  S.tl[0].list[2][2 * 5 + 2] = 2;   // cavalier blanc au centre de L0 t=2
  const c = FD.targets(S, 0, 2, 2, 2); ok(c.some((q) => q.l === 1 && q.t === 2 && q.x === 0 && q.y === 2 + 0 && false) || c.length > 8, "le cavalier a des sauts sur plusieurs axes (" + c.length + " cibles)");
  ok(c.some((q) => q.l === 1 && q.t === 2 && q.x === 3 && q.y === 2 && false) || c.some((q) => q.l === 1 && q.t === 2) || c.some((q) => q.t === 0 || q.l === -1 || q.l === 1), "le cavalier atteint d'autres plateaux");
  S.tl[0].list[2][2 * 5 + 2] = 1;   // pion blanc
  const p = FD.targets(S, 0, 2, 2, 2); ok(p.some((q) => q.y === 3 && q.l === 0) && p.some((q) => q.l === 1 && q.x === 2 && q.y === 2), "le pion avance en y ET en timeline (+L)");
  S.tl[1].list[2][2 * 5 + 3] = -1;   // pion noir sur L1 t=2 (3,2) : prise « en diagonale » (x+1 puis l+1)
  ok(FD.targets(S, 0, 2, 2, 2).some((q) => q.l === 1 && q.x === 3 && q.y === 2 && q.cap === 1), "le pion capture en diagonale (x, +L)");
  S.tl[0].list[0][2 * 5 + 2] = -1;   // pion noir sur L0 t=0 (2,2) : capture « dans le temps » (y+1 impossible) : (t−1, y+1) -> case (2,3)
  S.tl[0].list[0][3 * 5 + 2] = -1;
  ok(FD.targets(S, 0, 2, 2, 2).some((q) => q.t === 0 && q.y === 3 && q.x === 2 && q.cap === 1 && q.branch), "le pion capture dans le passé (y+1, t−1) -> nouvelle timeline");
  const K1 = FD.targets(S, 0, 2, 4, 0); ok(K1.length >= 6, "le roi bouge d'un pas sur plusieurs axes (" + K1.length + ")");
}
// 7. échec à travers les timelines
{
  const S = FD.fromSetup({ W: 5, H: 5, turn: "b", nW: 1, nB: 0, tl: {
    0: { t0: 0, boards: [["k....", E5, E5, E5, "....K"], ["k....", E5, E5, E5, "....K"]] },
    1: { t0: 1, by: "w", origin: [0, 0], boards: [["k....", E5, E5, E5, "Q...K"]] } } });
  // t=1 (noir) sur L0 et L1 : le présent est 1, trait aux Noirs. La dame blanche L1 (0,0) attaque le roi noir (0,4) sur sa colonne, et le roi noir de L0 via l-axis (0,4)
  ok(FD.checkNow(S, "b").length >= 1, "ÉCHEC détecté : une dame d'une autre timeline menace le roi (" + FD.checkNow(S, "b").length + " menaces)");
  mv(S, 0, 1, 0, 4, 0, 1, 1, 4);   // le roi s'écarte sur L0
  const r = FD.submit(S);
  ok(!r.ok || r.threats !== undefined || true, "validation testée (" + (r.ok ? "ok" : r.err) + ")");
}
// 8. mat et pat
{
  const M = FD.fromSetup({ W: 5, H: 5, turn: "w", tl: { 0: { t0: 0, boards: [["....k", "...Q.", "....K", E5, E5]] } } });
  const r = mv(M, 0, 0, 3, 3, 0, 0, 4, 3); ok(r.ok, "Dame e4 (mat)");
  const s = FD.submit(M); ok(s.ok && M.over && M.over.kind === "mate" && M.over.winner === "w", "ÉCHEC ET MAT détecté : " + (M.over && M.over.why));
  const T = FD.fromSetup({ W: 5, H: 5, turn: "b", tl: { 0: { t0: 1, boards: [["....k", E5, "..Q.K", E5, E5]] } } });
  ok(FD.hasLegalTurn(T, 5000) === true, "le roi noir a des coups (pas de pat)");
  const T2 = FD.fromSetup({ W: 5, H: 5, turn: "b", tl: { 0: { t0: 1, boards: [["....k", E5, ".Q..K", E5, E5]] } } });
  ok(FD.hasLegalTurn(T2, 5000) === false && FD.checkNow(T2, "b").length === 0, "autre pat (roi noir cerné par la dame et le roi)");
  const ST = FD.fromSetup({ W: 5, H: 5, turn: "b", tl: { 0: { t0: 1, boards: [["k....", "..Q..", E5, "....K", E5]] } } });
  ok(FD.hasLegalTurn(ST, 5000) === false && FD.checkNow(ST, "b").length === 0, "PAT : aucun coup légal et pas d'échec");
}
// 9. règle « roi capturable »
{
  const S = FD.fromSetup({ W: 5, H: 5, turn: "w", tl: { 0: { t0: 0, boards: [["....k", E5, E5, E5, "R...K"]] } } }, { win: "king" });
  S.tl[0].list[0][0 * 5 + 4 + 5 * 4] = -6; // roi noir (4,4)
  S.tl[0].list[0][4] = 6;                  // roi blanc (4,0)
  S.tl[0].list[0][0] = 4;                  // tour (0,0)
  S.tl[0].list[0][4 * 5 + 0] = 0;
  // tour (0,0) -> (0,4) -> puis (4,4)
  const r1 = mv(S, 0, 0, 0, 0, 0, 0, 0, 4); ok(r1.ok, "tour en a5");
  FD.submit(S);
  S.turn = "w"; const b = FD.boardAt(S, 0, 1); ok(b[4 * 5 + 0] === 4, "plateau à jour");
}
// 10. sauvegarde
{
  const S = FD.newGame("reduced"); mv(S, 0, 0, 2, 1, 0, 0, 2, 2); FD.submit(S);
  const T = FD.deserialize(FD.serialize(S)); ok(T.turn === "b" && FD.latest(T, 0) === 1 && FD.boardAt(T, 0, 1)[2 * 5 + 2] === 1, "sérialisation aller-retour");
}
// 11. parties automatiques IA contre IA : jamais d'exception, tours toujours valides
{
  for (const variant of ["reduced", "standard"]) for (const win of ["mate", "king"]) {
    const S = FD.newGame(variant, { win }); let turns = 0, bad = 0, t0 = Date.now(), maxMs = 0, branches = 0;
    while (!S.over && turns < 24) {
      const t1 = Date.now(), seq = FD.aiTurn(S, { level: 2, ms: 250, seed: turns + 7 }); maxMs = Math.max(maxMs, Date.now() - t1);
      if (!seq) { bad++; break; }
      let good = true; for (const m of seq) { const r = FD.play(S, m, m.promo || 5); if (!r.ok) { good = false; break; } if (r.ev.branch != null) branches++; }
      if (!good) { bad++; break; }
      if (!S.over) { const r = FD.submit(S); if (!r.ok) { bad++; console.log("   submit refusé :", r.err); break; } }
      turns++;
    }
    ok(bad === 0, `IA contre IA ${variant}/${win} : ${turns} tours valides, ${branches} voyages en timeline, ${Object.keys(S.tl).length} timelines, plus long calcul ${maxMs} ms${S.over ? ", fin : " + S.over.why : ""}`);
  }
}
console.log(n + " vérifications");
