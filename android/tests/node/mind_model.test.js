// Mind games (E.N.O.S. / Mittens) : modèle « humain » de prédiction et mise en forme des répliques.
// node android/tests/node/mind_model.test.js
const assert = require("assert"), vm = require("vm"), fs = require("fs"), path = require("path");
const base = path.join(__dirname, "../../assets/mobile");
const ctx = { window: {}, console, performance: { now: () => Date.now() } }; ctx.window.ENOS = { settings: { get: (k, d) => d, set() {} } }; ctx.ENOS = ctx.window.ENOS; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(base + "/vendor/chess.js", "utf8") + "\n;this.Chess = typeof Chess !== 'undefined' ? Chess : this.window.Chess;", ctx);
vm.runInContext("var window = this.window; var Chess = this.Chess;" + fs.readFileSync(base + "/js/mind_games.js", "utf8"), ctx);
const M = ctx.window.ENOS.mind;
// 1. reprise immédiate : les Blancs viennent de prendre en d5 (exd5) ; les Noirs reprennent naturellement (Cxd5 / Dxd5)
{ const fen = "rnbqkb1r/ppp2ppp/5n2/3Pp3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 3";
  const lines = [{ uci: "f6d5", cp: 0 }, { uci: "d8d5", cp: -20 }, { uci: "e5e4", cp: -60 }, { uci: "f8c5", cp: -40 }];
  const c = M.model(fen, lines, "d5"); assert.strictEqual(c[0].uci, "f6d5", "la reprise immédiate est la plus probable"); assert(c[0].p > 0.3 && c[0].p < 0.9, "probabilité réaliste : " + c[0].p.toFixed(2));
  assert(Math.abs(c.reduce((a, x) => a + x.p, 0) - 1) > 0.05, "une part reste à « un autre coup »"); }
// 2. coup unique : prédiction certaine (« aucun libre arbitre »)
{ const fen = "k7/2Q5/1K6/8/8/8/8/8 b - - 0 1"; assert.strictEqual(M.model(fen, [], "").length, 0, "pat : aucun coup"); }
{ const fen = "7k/8/6KQ/8/8/8/8/8 b - - 0 1"; const c = M.model(fen, [{ uci: "h8g8", cp: -9000 }], ""); assert(c.length === 1 && c[0].forced && c[0].p === 1, "un seul coup légal : forcé"); }
{ const fen = "4k3/8/8/8/8/8/3q4/4K3 w - - 0 1"; const c = M.model(fen, [{ uci: "e1d2", cp: 0 }, { uci: "e1f1", cp: -900 }], "d2"); assert.strictEqual(c[0].uci, "e1d2", "le roi prend la dame"); assert(c[0].p > 0.75); }
// 3. un coup qui perd beaucoup est peu probable
{ const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
  const c = M.model(fen, [{ uci: "e7e5", cp: -20 }, { uci: "c7c5", cp: -25 }, { uci: "g7g5", cp: -260 }], ""); const g5 = c.find((x) => x.uci === "g7g5"); assert(g5.p < 0.06, "g5 (−240 cp) improbable : " + g5.p.toFixed(3)); assert(c[0].p < 0.6, "position ouverte : pas de prédiction sûre"); }
// 4. répliques : chaque catégorie de mind games existe pour E.N.O.S. et Mittens, sans placeholder inconnu
global.window = { ENOS_BOT_LINES: {} }; require(base + "/js/mind_lines.js");
const KNOWN = /\{(me|san|time|a|b|piece|ton|ce|sq|n|t|sec|avg|s1|s2|s3|games|losses|m|fav|k|h|p1|p2|open|elo)\}/g;
for (const id of ["enos", "r_mittens"]) { const L = window.ENOS_BOT_LINES[id];
  for (const k of ["predict", "predict_hit", "predict_streak", "predict_miss", "seq_predict", "seq_hit1", "seq_hit2", "touch_many", "touch_switch", "touch_right", "touch_wrong", "hesitate", "hesitate_pair", "slow", "pressure", "forced", "hanging", "haunt", "doom", "mate_seen", "clock_low", "late", "undo", "memory_greet", "memory_last", "memory_fav", "memory_fav_hit", "mind", "sting"]) {
    assert(L[k] && L[k].length, id + " : catégorie " + k);
    L[k].forEach((t) => assert(!/\{/.test(t.replace(KNOWN, "")), id + " : placeholder inconnu dans « " + t + " »")); } }
console.log("mind_model : OK");
