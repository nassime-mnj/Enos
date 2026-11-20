// ChatGPT Prime : ~60 % de victoires, roi téléporté quand il est maté, vraies défaites possibles.
// node android/tests/node/prime_winrate.test.js
const path = require("path"), fs = require("fs"), vm = require("vm");
const root = path.join(__dirname, "../../assets/mobile");
global.window = global; window.ENOS = {};
vm.runInThisContext(fs.readFileSync(path.join(root, "vendor/chess.js"), "utf8"));
global.Chess = window.Chess;
vm.runInThisContext(fs.readFileSync(path.join(root, "js/prime.js"), "utf8"));
const P = window.ENOS.prime, assert = require("assert");
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
// adversaire simple : mat en 1, sinon la meilleure prise, sinon au hasard (strong = joue toujours la prise / le mat)
function opp(fen, strong) {
  const ch = new Chess(fen), mv = ch.moves({ verbose: true }); if (!mv.length) return null;
  for (const m of mv) { const c = new Chess(fen); c.move(m); if (c.in_checkmate()) return m; }
  if (strong || Math.random() < 0.7) { const caps = mv.filter((m) => m.captured).sort((a, b) => VAL[b.captured] - VAL[a.captured]); if (caps.length) return caps[0]; }
  return mv[Math.floor(Math.random() * mv.length)];
}
async function game(primeWhite, strong) {
  const st = P.newState(primeWhite, P.rollBeatable()); let turnPrime = primeWhite, plies = 0, tps = 0;
  while (plies < 400) {
    if (turnPrime) {
      const r = await P.turn(st, {});
      tps += r.acts.filter((a) => a.cheat === "kingdash").length;
      if (r.over) return { prime: r.over.winner === (primeWhite ? "w" : "b"), why: r.over.why, beat: st.beatable, tps };
      const ch = new Chess(st.fen); if (ch.game_over()) return { prime: ch.in_checkmate() || !st.beatable, why: ch.in_checkmate() ? "mate" : "draw", beat: st.beatable, tps };
    } else {
      const m = opp(st.fen, strong); if (!m) return { prime: !st.beatable, why: "draw", beat: st.beatable, tps };
      const ch = new Chess(st.fen); ch.move(m); st.fen = ch.fen();
      if (!ch.in_checkmate() && ch.game_over()) return { prime: !st.beatable, why: "draw", beat: st.beatable, tps };
    }
    turnPrime = !turnPrime; plies++;
  }
  return { prime: !st.beatable, why: "long", beat: st.beatable, tps };
}
(async () => {
  const N = +process.argv[2] || 400, res = [];
  for (let i = 0; i < N; i++) res.push(await game(i % 2 === 0, i % 4 < 2));
  const wins = res.filter((r) => r.prime).length, rate = wins / N, why = {};
  res.forEach((r) => (why[(r.prime ? "W:" : "L:") + r.why] = (why[(r.prime ? "W:" : "L:") + r.why] || 0) + 1));
  const lostMated = res.filter((r) => !r.prime && r.why === "mated").length, tp = res.filter((r) => r.tps > 0).length;
  console.log("parties", N, "victoires Prime", (rate * 100).toFixed(1) + " %", JSON.stringify(why), "parties avec roi téléporté", tp);
  assert(rate > 0.5 && rate < 0.7, "taux de victoire hors 50-70 %");
  assert(lostMated > 0, "Prime doit pouvoir être vraiment maté");
  assert(tp > 0, "le roi doit se téléporter au moins une fois");
  // roi téléporté : position légale pour chess.js, roi hors d'échec
  const fen = "7k/8/8/8/8/8/5PPP/r5K1 w - - 0 1"; assert(new Chess(fen).in_checkmate());
  const c = P.kingEscape(fen, true); assert(c && c.type === "kingdash"); assert(P.safe(c.b, true));
  console.log("ok");
})();
