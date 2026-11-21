// Loup-garou : composition, nuit (voyante, loups, sorcière), vote, victoire ; équilibre des bots sur 1 500 parties.
// node android/tests/node/loup_rules.test.js
const W = require("../../assets/mobile/js/games/loup_rules.js"), assert = require("assert");
for (let n = 5; n <= 10; n++) { const d = W.deck(n); assert.strictEqual(d.length, n); assert(d.includes("seer") && d.includes("witch")); assert.strictEqual(d.filter((r) => r === "wolf").length, n >= 10 ? 3 : n >= 7 ? 2 : 1, "loups pour " + n); }
{ const st = W.newGame(Array.from({ length: 7 }, (_, i) => ({ name: "P" + i, bot: true })));
  const w = W.wolves(st); assert(w.every((a) => w.every((b) => a.i === b.i || a.known[b.i] === "wolf")), "les loups se connaissent");
  const seer = st.ps.find((p) => p.role === "seer"); const t = st.ps.find((p) => p.i !== seer.i); W.see(st, seer.i, t.i); assert(seer.known[t.i], "la voyante apprend un rôle");
  const victim = st.ps.find((p) => p.role !== "wolf").i; assert.deepStrictEqual(W.dawn(st, victim, { save: true }), [], "potion de vie : personne ne meurt"); assert(!st.potions.life);
  assert.deepStrictEqual(W.dawn(st, victim, { save: true }), [victim], "potion déjà utilisée");
  assert.strictEqual(W.tally({ 0: 1, 1: 2, 2: 1 }).top, 1); assert.strictEqual(W.tally({ 0: 1, 1: 2 }).top, null, "égalité = personne"); }
const res = { village: 0, wolf: 0 };
for (let g = 0; g < 1500; g++) { const n = 5 + (g % 6); const st = W.newGame(Array.from({ length: n }, (_, i) => ({ name: "P" + i, bot: true })));
  const shot = (i) => { if (st.ps[i].role !== "hunter") return; const t = W.botHunter(st, st.ps[i]); if (t != null) st.ps[t].alive = false; };
  while (!W.winner(st) && st.day < 20) { st.day++;
    const seer = W.alive(st).find((p) => p.role === "seer"); if (seer) { const t = W.botSeer(st, seer); if (t) W.see(st, seer.i, t.i); }
    const v = W.botWolfTarget(st).i, witch = W.alive(st).find((p) => p.role === "witch"); W.dawn(st, v, witch ? W.botWitch(st, witch, v) : {}).forEach(shot); if (W.winner(st)) break;
    W.alive(st).forEach((p) => W.botTalk(st, p).forEach((a) => { if (a.type === "accuse") W.accuse(st, p.i, a.to); if (a.type === "claim") W.seerClaim(st, p.i, a.to, a.wolf); }));
    const votes = {}; W.alive(st).forEach((p) => (votes[p.i] = W.botVote(st, p))); const t = W.tally(votes); if (t.top != null) { st.ps[t.top].alive = false; W.learnFromVote(st, votes, t.top); shot(t.top); } }
  res[W.winner(st) || "wolf"]++; }
console.log("1 500 parties entre bots :", res);
assert(res.village > 450 && res.wolf > 450, "aucun camp n'écrase l'autre");
assert(W.line(W.newGame([{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }, { name: "e" }]), "accuse", "Lelex").includes("Lelex"));
console.log("loup_rules : OK");
