"use strict";
// POKER — Texas Hold'em No Limit, module pur (testable dans Node) : distribution, enchères (blindes, suivre, relancer, tapis), pots annexes,
// évaluation des mains (meilleure combinaison de 5 cartes parmi 7), abattage, IA (équité par simulation + cotes du pot).
//   Carte = rang (2..14) * 4 + couleur (0 ♠, 1 ♥, 2 ♦, 3 ♣).
(function (root) {
  const P = {};
  const RN = { 11: "V", 12: "D", 13: "R", 14: "A" };                  // Valet, Dame, Roi, As
  P.rank = (c) => c >> 2; P.suit = (c) => c & 3;
  P.label = (c) => (RN[c >> 2] || String(c >> 2)) + "♠♥♦♣"[c & 3];
  P.HANDS = ["Hauteur", "Paire", "Double paire", "Brelan", "Quinte", "Couleur", "Full", "Carré", "Quinte flush"];
  const rng = (seed) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  const deck = (r) => { const d = []; for (let rk = 2; rk <= 14; rk++) for (let su = 0; su < 4; su++) d.push(rk * 4 + su); for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } return d; };

  /** valeur comparable d'une main de 5 à 7 cartes : [catégorie, départages...] */
  P.evaluate = (cards) => {
    const ranks = cards.map(P.rank).sort((a, b) => b - a), cnt = {}, bySuit = [[], [], [], []];
    cards.forEach((c) => { cnt[P.rank(c)] = (cnt[P.rank(c)] || 0) + 1; bySuit[P.suit(c)].push(P.rank(c)); });
    const straightHigh = (rs) => { const u = [...new Set(rs)].sort((a, b) => b - a); if (u.includes(14)) u.push(1); for (let i = 0; i + 4 < u.length; i++) if (u[i] - u[i + 4] === 4) return u[i]; return 0; };
    const flushSuit = bySuit.findIndex((s) => s.length >= 5);
    if (flushSuit >= 0) { const sf = straightHigh(bySuit[flushSuit]); if (sf) return [8, sf]; }
    const groups = Object.entries(cnt).map(([r, n]) => [n, +r]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    if (groups[0][0] === 4) return [7, groups[0][1], Math.max(...ranks.filter((r) => r !== groups[0][1]))];
    if (groups[0][0] === 3 && groups[1] && groups[1][0] >= 2) return [6, groups[0][1], groups[1][1]];
    if (flushSuit >= 0) return [5].concat(bySuit[flushSuit].sort((a, b) => b - a).slice(0, 5));
    const st = straightHigh(ranks); if (st) return [4, st];
    if (groups[0][0] === 3) return [3, groups[0][1]].concat(ranks.filter((r) => r !== groups[0][1]).slice(0, 2));
    if (groups[0][0] === 2 && groups[1] && groups[1][0] === 2) { const hi = groups[0][1], lo = groups[1][1]; return [2, hi, lo, Math.max(...ranks.filter((r) => r !== hi && r !== lo))]; }
    if (groups[0][0] === 2) return [1, groups[0][1]].concat(ranks.filter((r) => r !== groups[0][1]).slice(0, 3));
    return [0].concat(ranks.slice(0, 5));
  };
  P.cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; };

  /** nouvelle partie : n joueurs, jetons de départ, blindes */
  P.newGame = (n, o) => {
    o = o || {}; const s = { n, chips: Array(n).fill(o.stack || 1000), sb: o.sb || 10, bb: o.bb || 20, dealer: Math.floor((o.seed || 1) % n), hand: 0, maxHands: o.hands || 0, seed: (o.seed || Date.now()) >>> 0, over: null, log: [] };
    P.newHand(s); return s;
  };
  const alive = (s) => s.chips.map((c, i) => [c, i]).filter(([c]) => c > 0).map(([, i]) => i);
  const nextSeat = (s, i, pred) => { for (let k = 1; k <= s.n; k++) { const j = (i + k) % s.n; if (pred(j)) return j; } return -1; };
  P.newHand = (s) => {
    const live = alive(s);
    if (live.length <= 1 || (s.maxHands && s.hand >= s.maxHands)) { const w = s.chips.indexOf(Math.max(...s.chips)); s.over = { winner: w }; return; }
    s.hand++; const r = rng(s.seed + s.hand * 7919); s.deck = deck(r);
    s.dealer = nextSeat(s, s.dealer, (j) => s.chips[j] > 0);
    s.hole = Array.from({ length: s.n }, () => []); s.board = []; s.bets = Array(s.n).fill(0); s.total = Array(s.n).fill(0); s.folded = s.chips.map((c) => c <= 0); s.allin = Array(s.n).fill(false);
    live.forEach((i) => (s.hole[i] = [s.deck.pop(), s.deck.pop()]));
    s.street = 0; s.result = null;
    const two = live.length === 2;
    s.sbSeat = two ? s.dealer : nextSeat(s, s.dealer, (j) => s.chips[j] > 0); s.bbSeat = nextSeat(s, s.sbSeat, (j) => s.chips[j] > 0);
    post(s, s.sbSeat, s.sb); post(s, s.bbSeat, s.bb);
    s.toCall = s.bb; s.minRaise = s.bb; s.acted = Array(s.n).fill(false);
    s.turn = nextSeat(s, s.bbSeat, (j) => canAct(s, j));
    if (s.turn < 0) return runout(s);
  };
  const canAct = (s, i) => !s.folded[i] && !s.allin[i] && s.chips[i] > 0;
  function post(s, i, amt) { const a = Math.min(amt, s.chips[i]); s.chips[i] -= a; s.bets[i] += a; s.total[i] += a; if (!s.chips[i]) s.allin[i] = true; return a; }
  /** actions possibles du joueur au trait */
  P.options = (s) => { const i = s.turn; if (i < 0 || s.over || s.result) return null; const need = s.toCall - s.bets[i], stack = s.chips[i];
    return { check: need <= 0, call: Math.min(need, stack), minRaiseTo: Math.min(s.toCall + s.minRaise, s.bets[i] + stack), maxTo: s.bets[i] + stack, canRaise: stack > need }; };
  /** action : {type: "fold"|"check"|"call"|"raise"|"allin", to?} (to = mise totale de la manche) */
  P.act = (s, a) => {
    const i = s.turn; if (i < 0 || s.result || s.over) return false;
    const need = s.toCall - s.bets[i];
    if (a.type === "fold") { s.folded[i] = true; s.log.push([s.hand, i, "fold"]); }
    else if (a.type === "check") { if (need > 0) return false; s.log.push([s.hand, i, "check"]); }
    else if (a.type === "call") { post(s, i, need); s.log.push([s.hand, i, "call"]); }
    else { let to = a.type === "allin" ? s.bets[i] + s.chips[i] : Math.max(a.to || 0, s.toCall + s.minRaise); to = Math.min(to, s.bets[i] + s.chips[i]);
      if (to <= s.toCall) { post(s, i, to - s.bets[i]); s.log.push([s.hand, i, "call"]); }
      else { const inc = to - s.toCall; if (inc >= s.minRaise) { s.minRaise = inc; s.acted = s.acted.map((x, j) => j === i); } s.toCall = to; post(s, i, to - s.bets[i]); s.log.push([s.hand, i, "raise", to]); } }
    s.acted[i] = true;
    advance(s); return true;
  };
  function advance(s) {
    const inHand = s.folded.map((f, j) => !f && (s.hole[j] || []).length).reduce((a, x, j) => (x ? a.concat(j) : a), []);
    if (inHand.length === 1) return finish(s, [inHand[0]]);
    const pending = (j) => canAct(s, j) && (!s.acted[j] || s.bets[j] < s.toCall);
    const nx = nextSeat(s, s.turn, pending);
    if (nx >= 0) { s.turn = nx; return; }
    // fin de la manche d'enchères
    const actors = inHand.filter((j) => canAct(s, j));
    if (s.street === 3 || actors.length <= 1 && inHand.filter((j) => s.bets[j] < s.toCall && canAct(s, j)).length === 0 && actors.length <= 1) {
      if (s.street === 3) return showdown(s);
      return runout(s);
    }
    nextStreet(s);
  }
  function nextStreet(s) {
    s.street++; s.bets = Array(s.n).fill(0); s.toCall = 0; s.minRaise = s.bb; s.acted = Array(s.n).fill(false);
    if (s.street === 1) s.board.push(s.deck.pop(), s.deck.pop(), s.deck.pop()); else s.board.push(s.deck.pop());
    s.turn = nextSeat(s, s.dealer, (j) => canAct(s, j));
    const actors = s.folded.map((f, j) => !f && canAct(s, j)).filter(Boolean).length;
    if (actors <= 1) return runout(s);
  }
  function runout(s) { while (s.board.length < 5) s.board.push(s.deck.pop()); s.street = 3; showdown(s); }
  function showdown(s) {
    const inHand = s.folded.map((f, j) => (!f && (s.hole[j] || []).length ? j : -1)).filter((j) => j >= 0);
    const val = {}; inHand.forEach((j) => (val[j] = P.evaluate(s.hole[j].concat(s.board))));
    // pots annexes
    const levels = [...new Set(s.total.filter((t) => t > 0))].sort((a, b) => a - b); let prev = 0; const won = Array(s.n).fill(0), pots = [];
    for (const L of levels) {
      const contrib = s.total.map((t) => Math.max(0, Math.min(t, L) - prev)), amount = contrib.reduce((a, b) => a + b, 0);
      const elig = inHand.filter((j) => s.total[j] >= L); prev = L; if (!amount) continue;
      if (!elig.length) { pots.push({ amount, winners: [] }); continue; }
      let best = elig[0]; elig.forEach((j) => { if (P.cmp(val[j], val[best]) > 0) best = j; });
      const winners = elig.filter((j) => P.cmp(val[j], val[best]) === 0), share = Math.floor(amount / winners.length);
      winners.forEach((j, k) => (won[j] += share + (k === 0 ? amount - share * winners.length : 0))); pots.push({ amount, winners });
    }
    won.forEach((w, j) => (s.chips[j] += w));
    s.result = { showdown: true, won, pots, hands: Object.fromEntries(inHand.map((j) => [j, P.HANDS[val[j][0]]])), board: s.board.slice() }; s.turn = -1;
  }
  function finish(s, [w]) { const pot = s.total.reduce((a, b) => a + b, 0); s.chips[w] += pot; const won = Array(s.n).fill(0); won[w] = pot; s.result = { showdown: false, won, pots: [{ amount: pot, winners: [w] }], hands: {} }; s.turn = -1; }
  P.pot = (s) => s.total.reduce((a, b) => a + b, 0);

  // ------------------------------------------------------------------ IA
  /** équité (chance de gagner) par simulation contre `opp` adversaires */
  P.equity = (hole, board, opp, sims, seed) => {
    const r = rng(seed || 12345), used = new Set(hole.concat(board)); let win = 0;
    const rest = []; for (let rk = 2; rk <= 14; rk++) for (let su = 0; su < 4; su++) { const c = rk * 4 + su; if (!used.has(c)) rest.push(c); }
    for (let k = 0; k < sims; k++) {
      const d = rest.slice(); for (let i = d.length - 1; i > d.length - 1 - (2 * opp + 5 - board.length) && i > 0; i--) { const j = Math.floor(r() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
      let p = d.length; const bd = board.concat(d.slice(p - (5 - board.length))); p -= 5 - board.length;
      const me = P.evaluate(hole.concat(bd)); let res = 1;
      for (let o = 0; o < opp; o++) { const oh = [d[p - 1], d[p - 2]]; p -= 2; const c = P.cmp(me, P.evaluate(oh.concat(bd))); if (c < 0) { res = 0; break; } if (c === 0) res = Math.min(res, 0.5); }
      win += res;
    }
    return win / sims;
  };
  P.botAct = (s, level) => {
    const i = s.turn, o = P.options(s), opp = s.folded.filter((f, j) => !f && j !== i && (s.hole[j] || []).length).length;
    const sims = { easy: 60, normal: 220, hard: 500, max: 900 }[level] || 220;
    const eq = P.equity(s.hole[i], s.board, Math.max(1, opp), sims, s.seed + s.hand * 31 + s.board.length * 7 + i), pot = P.pot(s), need = o.call;
    const odds = need > 0 ? need / (pot + need) : 0, rnd = ((s.seed * 9301 + s.hand * 49297 + i * 233 + s.board.length * 17) % 1000) / 1000;
    const loose = { easy: 0.12, normal: 0.04, hard: 0.02, max: 0.015 }[level] || 0.04, bluff = { easy: 0.02, normal: 0.06, hard: 0.1, max: 0.12 }[level] || 0.06;
    const strong = eq > 0.72 + (opp > 2 ? -0.08 : 0), good = eq > 0.5 - opp * 0.04;
    if (strong && o.canRaise) { const to = Math.min(o.maxTo, Math.max(o.minRaiseTo, s.toCall + Math.round(pot * (0.6 + rnd * 0.5)))); return eq > 0.88 && rnd > 0.6 ? { type: "allin" } : { type: "raise", to }; }
    if (good && o.canRaise && rnd < 0.35) return { type: "raise", to: Math.min(o.maxTo, Math.max(o.minRaiseTo, s.toCall + Math.round(pot * 0.5))) };
    if (o.check) return rnd < bluff && o.canRaise ? { type: "raise", to: Math.min(o.maxTo, Math.max(o.minRaiseTo, Math.round(pot * 0.6))) } : { type: "check" };
    if (eq + loose >= odds || (need <= s.bb && eq > 0.25)) return { type: "call" };
    return { type: "fold" };
  };
  if (typeof module !== "undefined" && module.exports) module.exports = P; else (root.ENOS = root.ENOS || {}).poker = P;
})(typeof window !== "undefined" ? window : globalThis);
