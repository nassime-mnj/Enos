// Tests de Chess Fog (js/fog.js) sous Node : node t_fog_engine.js
global.window = {};
const FG = require("../assets/mobile/js/fog.js");
let n = 0; const ok = (c, m) => { n++; if (!c) { console.log("FAIL " + m); process.exitCode = 1; } else console.log("OK   " + m); };
const idx = (s) => (s.charCodeAt(0) - 97) + (s[1] - 1) * 8, put = (b, s, v) => { b[idx(s)] = v; };
const empty = () => new Int8Array(64);

// 1. départ : coups et vision
{
  const S = FG.newGame(); ok(FG.gen(S.b, "w", S.castle).length === 20, "20 coups blancs au départ");
  const v = FG.visible(S.b, "w"), at = (s) => !!v[idx(s)];
  ok(at("e4") && at("a3") && at("h4") && !at("e5") && !at("d6"), "Blancs : voient jusqu'à la 4ᵉ rangée (pions), pas la 5ᵉ");
  const vb = FG.visible(S.b, "b"); ok(vb[idx("e5")] && vb[idx("a6")] && !vb[idx("e4")], "Noirs : voient la 5ᵉ rangée, pas la 4ᵉ");
  const view = FG.view(S, "w"); ok(view.cells[idx("e8")] === FG.FOG && view.cells[idx("e1")] === 6 && view.cells[idx("e4")] === 0, "la vue cache e8 (99), montre e1 (roi) et e4 vide");
}
// 2. vision : rayons jusqu'à la 1re pièce, pions
{
  const b = empty(); put(b, "a1", 4); put(b, "a5", -1); put(b, "e1", 6); put(b, "e8", -6);
  const v = FG.visible(b, "w"); ok(v[idx("a2")] && v[idx("a5")] && !v[idx("a6")], "la tour voit jusqu'au pion adverse inclus, pas derrière");
  const p = empty(); put(p, "e2", 1); put(p, "e3", -1); put(p, "e1", 6); put(p, "e8", -6);
  const vp = FG.visible(p, "w"); ok(vp[idx("e3")] && !vp[idx("e4")] && vp[idx("d3")] && vp[idx("f3")], "un pion bloqué voit la pièce devant lui, pas le double pas");
}
// 3. capture du roi, roque, promotion
{
  const S = FG.newGame(); S.b = empty(); put(S.b, "e1", 6); put(S.b, "e8", -6); put(S.b, "e4", 5); S.castle = 0;
  const r = FG.play(S, { f: idx("e4"), t: idx("e8") }); ok(r.ok && S.over && S.over.winner === "w" && S.over.why === "Roi capturé", "capturer le roi gagne");
  const C = FG.newGame(); C.b = empty(); put(C.b, "e1", 6); put(C.b, "h1", 4); put(C.b, "a1", 4); put(C.b, "e8", -6);
  const ms = FG.gen(C.b, "w", C.castle); ok(ms.some((m) => m.castle === 1) && ms.some((m) => m.castle === 2), "petit et grand roque possibles");
  FG.play(C, { f: idx("e1"), t: idx("g1") }); ok(C.b[idx("f1")] === 4 && C.b[idx("g1")] === 6 && C.b[idx("h1")] === 0, "le roque déplace la tour");
  const Pm = FG.newGame(); Pm.b = empty(); put(Pm.b, "a7", 1); put(Pm.b, "e1", 6); put(Pm.b, "h4", -6); Pm.castle = 0;
  ok(FG.gen(Pm.b, "w", 0).filter((m) => m.promo).length === 4, "promotion : 4 choix");
  FG.play(Pm, { f: idx("a7"), t: idx("a8"), promo: 5 }); ok(Pm.b[idx("a8")] === 5, "promotion en dame");
  const E = FG.newGame(); E.b = empty(); put(E.b, "e1", 6); put(E.b, "e8", -6); put(E.b, "d4", -1); put(E.b, "e5", 1); E.turn = "b"; E.castle = 0;
  ok(FG.play(E, { f: idx("d4"), t: idx("d3") }).ok, "pas d'échec : on peut jouer librement");
}
// 4. la vue ne dépend que des cases visibles ; les coups légaux aussi
{
  const S = FG.newGame(); for (const [f, t] of [["e2", "e4"], ["e7", "e5"], ["g1", "f3"], ["b8", "c6"]]) FG.play(S, { f: idx(f), t: idx(t) });
  const S2 = FG.clone(S); const vis = FG.visible(S.b, "w"); let moved = 0;
  for (let i = 0; i < 64 && moved < 3; i++) if (!vis[i] && S2.b[i] < 0 && Math.abs(S2.b[i]) === 1) { for (let j = 63; j >= 0; j--) if (!vis[j] && S2.b[j] === 0 && (j >> 3) !== 7) { S2.b[j] = S2.b[i]; S2.b[i] = 0; moved++; break; } }
  ok(moved > 0 && JSON.stringify(Array.from(FG.view(S, "w").cells)) === JSON.stringify(Array.from(FG.view(S2, "w").cells)), "deux vrais plateaux qui ne diffèrent que dans le brouillard donnent EXACTEMENT la même vue (" + moved + " pièces déplacées)");
  const flat = new Int8Array(64), vw = FG.view(S, "w"); for (let i = 0; i < 64; i++) flat[i] = vw.cells[i] === FG.FOG ? 0 : vw.cells[i];
  const a = FG.gen(flat, "w", vw.castle).map((m) => m.f + ">" + m.t).sort().join(), b2 = FG.gen(S.b, "w", S.castle).map((m) => m.f + ">" + m.t).sort().join();
  ok(a === b2, "les coups légaux se calculent à partir de la vue seule (identiques au vrai plateau)");
}
// 5. l'adversaire n'utilise QUE la vue : proxy qui refuse tout autre champ ; coup toujours légal ; même vue = même choix
{
  const allowed = new Set(["color", "cells", "turn", "ply", "castle", "quiet", "taken", "lost", "seen", "mine", "over"]);
  const strict = (v) => new Proxy(v, { get: (t, k) => { if (typeof k === "symbol" || allowed.has(k)) return t[k]; throw new Error("accès interdit : " + String(k)); } });
  let bad = 0, same = 0, total = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const S = FG.newGame(); let r = seed * 77;
    const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 6 + (seed % 5) * 2 && !S.over; i++) { const ms = FG.gen(S.b, S.turn, S.castle); const m = ms[(rnd() * ms.length) | 0]; FG.play(S, m); }
    if (S.over) continue; const col = S.turn, view = FG.view(S, col);
    const bot = new FG.Bot(col, { level: 2, seed: 5 }); let mv; try { mv = bot.move(strict(view)); } catch (e) { console.log("   erreur bot : " + e.message); bad++; continue; }
    total++; if (!mv || !FG.gen(S.b, col, S.castle).some((m) => m.f === mv.f && m.t === mv.t && (m.promo || 0) === (mv.promo || 0))) bad++;
    // même vue, vrai plateau différent dans le brouillard -> même coup
    const S2 = FG.clone(S), vis = FG.visible(S.b, col); for (let i = 0; i < 64; i++) if (!vis[i] && S2.b[i] && (S2.b[i] > 0) !== (col === "w") && Math.abs(S2.b[i]) !== 6 && Math.abs(S2.b[i]) !== 1) { for (let j = 0; j < 64; j++) if (!vis[j] && !S2.b[j]) { S2.b[j] = S2.b[i]; S2.b[i] = 0; break; } }
    const bot2 = new FG.Bot(col, { level: 2, seed: 5 }), mv2 = bot2.move(FG.view(S2, col)); if (JSON.stringify(Array.from(FG.view(S2, col).cells)) === JSON.stringify(Array.from(view.cells)) && mv2 && mv && mv2.f === mv.f && mv2.t === mv.t) same++;
  }
  ok(bad === 0 && total >= 8, `le bot ne lit que la vue (proxy strict) et joue toujours un coup légal : ${total} positions`);
  ok(same === total, `vrai plateau différent dans le brouillard, même vue -> exactement le même coup du bot (${same}/${total})`);
}
// 6. parties bot contre bot : finissent, aucun coup illégal, temps raisonnable
for (const [la, lb] of [[1, 1], [2, 2], [3, 2]]) {
  const S = FG.newGame(), bots = { w: new FG.Bot("w", { level: la, seed: 11 }), b: new FG.Bot("b", { level: lb, seed: 12 }) }; let bad = 0, maxMs = 0, plies = 0;
  while (!S.over && plies < 160) {
    const col = S.turn, t0 = Date.now(), m = bots[col].move(FG.view(S, col)); maxMs = Math.max(maxMs, Date.now() - t0);
    if (!m) break; const r = FG.play(S, m); if (!r.ok) { bad++; break; } plies++;
  }
  ok(bad === 0, `bot niv.${la} contre bot niv.${lb} : ${plies} demi-coups, ${S.over ? S.over.why + (S.over.winner ? " (" + S.over.winner + ")" : "") : "non terminée"}, plus long calcul ${maxMs} ms`);
}
console.log(n + " vérifications");
