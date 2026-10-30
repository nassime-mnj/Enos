"use strict";
// ÉCHECS ×4 — IA des bots, personnalités et APPRENTISSAGE (évolution de stratégie). Tourne dans le navigateur et sous Node (tests).
//
// Un bot évalue chacun de ses coups (1 coup + menaces) avec un vecteur de poids `w` :
//   cap     prise immédiate                    foe     importance du matériel adverse (la CIBLE du bot compte plus)
//   hang    ne pas laisser une pièce en prise   threat  menacer des pièces adverses
//   king    sécurité du roi (cases autour attaquées, roi menacé = très mauvais)     adv  avance des pions / développement
//   center  occupation du centre                hunt    rapprocher ses pièces lourdes du roi de sa CIBLE
//   storm   fuir le bord quand la tempête approche
// `target` = le joueur que ce bot a décidé d'attaquer (choisi par l'utilisateur) ; `foes` = ceux qu'il considère comme ennemis.
// « Apprendre une stratégie » = faire ÉVOLUER ces poids : on teste une variante mutée contre l'originale dans de vraies parties à 4 et on garde la meilleure (evolve()).
(() => {
  const C4 = (typeof window !== "undefined" && window.ENOS && window.ENOS.c4) || require("./chess4.js");
  const AI = {};
  const { N, SQ, K, P, KN, B, R, Q, MATV, FWD, cell, ownerOf, typeOf } = C4;
  const KEYS = ["cap", "foe", "hang", "threat", "king", "adv", "center", "hunt", "storm"];
  const BASE = { cap: 1, foe: 1, hang: 1, threat: 1, king: 1, adv: 1, center: 1, hunt: 1, storm: 1 };
  // personnalités : multiplicateurs de départ + bruit (plus il est grand, plus le bot est imprévisible)
  const PERSONA = {
    nasko: { noise: 0.22, mul: { adv: 1.2, center: 1.1 } },
    lelex: { noise: 0.5, mul: { threat: 1.2, hang: 0.8 } },                          // joueur de chaos : imprécis mais mordant
    ghorghor: { noise: 0.3, mul: { cap: 1.2, hunt: 1.2 } },
    penoire: { noise: 0.08, mul: { cap: 1.3, threat: 1.4, hunt: 1.6, foe: 1.3 } },     // chasseur : fonce sur sa cible
    naskurieux: { noise: 0.9, mul: { hang: 1.1 }, grow: true },                        // démarre nul, progresse à chaque prise
    naskolit: { noise: 0.04, mul: { king: 1.2, hang: 1.2 }, drowsy: true },            // très fort, s'endort à chaque pièce perdue
    jester: { noise: 0.4, mul: {}, wheel: true },                                      // la roue tire son niveau tous les 10 coups
    eto: { noise: 0.1, mul: { threat: 1.5, cap: 1.2, adv: 1.2 } },                      // aime les tactiques
    enos: { noise: 0.02, mul: { hang: 1.3, king: 1.3, foe: 1.1 } },                     // froid et précis
  };
  const clampW = (v) => Math.max(0.05, Math.min(3.5, v));
  /** Crée un joueur IA. opts : {persona, w (poids appris), target, foes (tableau de 4 booléens), noise} */
  AI.make = (opts) => {
    const per = PERSONA[opts.persona] || PERSONA.nasko;
    const w = {};
    for (const k of KEYS) w[k] = clampW((opts.w && opts.w[k] != null ? opts.w[k] : BASE[k] * (per.mul[k] || 1)));
    return { persona: opts.persona, w, noise: opts.noise != null ? opts.noise : per.noise, base: per.noise, target: opts.target == null ? -1 : opts.target, foes: opts.foes || null, grow: !!per.grow, drowsy: !!per.drowsy, wheel: !!per.wheel, moves: 0, skill: 1 };
  };
  AI.PERSONA = PERSONA; AI.KEYS = KEYS; AI.BASE = BASE;
  AI.defaultWeights = (persona) => { const per = PERSONA[persona] || PERSONA.nasko, w = {}; for (const k of KEYS) w[k] = clampW(BASE[k] * (per.mul[k] || 1)); return w; };

  const noiseOf = () => Math.random() + Math.random() + Math.random() - 1.5;     // ≈ gaussienne centrée, écart ≈ 0,5

  /** Score d'un coup (point de vue de `o`). */
  function scoreMove(st, o, m, ai, ctx) {
    const w = ai.w, b = st.b, f = m & 255, t = (m >> 8) & 255, piece = b[f], pt = typeOf(piece), cap = b[t];
    const u = C4.make(st, m);
    let sc = 0;
    if (cap) {
      const co = ownerOf(cap), ct = typeOf(cap), val = ct === K ? 5000 : MATV[ct];
      sc += val * w.cap * (co === ai.target ? 1.5 : ai.foes && !ai.foes[co] ? 0.6 : 1);
    }
    if ((m >> 16) & 1) sc += 700;
    // cases attaquées par les ennemis après le coup (matrices partagées par tous les calculs de ce coup)
    const foeVal = new Int16Array(SQ), foeAtt = new Uint8Array(SQ);
    for (const e of ctx.enemies) { const val = new Int16Array(SQ), a = C4.attackedBy(st, e, val); for (let i = 0; i < SQ; i++) if (a[i]) { foeAtt[i] = 1; if (!foeVal[i] || val[i] < foeVal[i]) foeVal[i] = val[i]; } }
    const myAtt = new Uint8Array(SQ);
    for (const a2 of ctx.team) { const a = C4.attackedBy(st, a2); for (let i = 0; i < SQ; i++) if (a[i]) myAtt[i] = 1; }
    const ringLevel = st.level, soon = C4.stormIn(st);
    let kSq = -1;
    for (let i = 0; i < SQ; i++) {
      const v = b[i];
      if (!v) continue;
      const po = ownerOf(v), ty = typeOf(v), x = i % N, y = (i / N) | 0;
      if (po === o) {
        if (ty === K) {
          kSq = i;
          if (foeAtt[i]) sc -= 4000;                                              // roi capturable au prochain tour : à éviter à tout prix
          let ring = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { const nx = x + dx, ny = y + dy; if (C4.playable(st, nx, ny) && foeAtt[nx + ny * N]) ring++; }
          sc -= ring * 35 * w.king;
        } else {
          const mv = MATV[ty];
          if (foeAtt[i]) { const lowAtt = foeVal[i] < mv - 10; sc -= (myAtt[i] ? (lowAtt ? mv * 0.5 : mv * 0.05) : mv * 0.9) * w.hang; }
          if (ty === P) { const fx = FWD[o], steps = o === 0 ? 12 - y : o === 1 ? x - 1 : o === 2 ? y - 1 : 12 - x; sc += Math.min(8, steps) * 3.5 * w.adv; }
          else if (ty === KN || ty === B) { const back = o === 0 ? y === 13 : o === 1 ? x === 0 : o === 2 ? y === 0 : x === 13; if (!back) sc += 18 * w.adv; }
          if (ty === KN || ty === B || ty === Q) sc -= (Math.abs(x - 6.5) + Math.abs(y - 6.5)) * 2.2 * w.center;
        }
        if (soon <= 10 && (x === ringLevel || x === N - 1 - ringLevel || y === ringLevel || y === N - 1 - ringLevel)) sc -= (ty === K ? 3500 : MATV[ty] * 0.7) * w.storm;
        else if (soon <= 24 && ty === K && (x <= ringLevel + 1 || x >= N - 2 - ringLevel || y <= ringLevel + 1 || y >= N - 2 - ringLevel)) sc -= 60 * w.storm;
      } else if (!C4.allied(st, o, po)) {
        // pièces adverses : menacées par nous = bon ; le matériel de la cible pèse plus
        const mv = ty === K ? 800 : MATV[ty], hostile = po === ai.target ? 1.5 : ai.foes && !ai.foes[po] ? 0.5 : 1;
        sc -= mv * 0.04 * w.foe * hostile;                                          // moins ils en ont, mieux c'est
        if (myAtt[i]) sc += (foeAtt[i] ? mv * 0.12 : mv * 0.3) * w.threat * hostile;
        if (ty === K) {                                                              // roi adverse : échec (= capture au prochain tour si rien ne change), cases de fuite attaquées
          if (myAtt[i]) sc += (foeAtt[i] ? 120 : 420) * w.threat * hostile;
          let esc = 0, safe = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { const nx = x + dx, ny = y + dy; if (!C4.playable(st, nx, ny)) continue; const bb = b[nx + ny * N]; if (bb && ownerOf(bb) === po) continue; esc++; if (myAtt[nx + ny * N]) safe++; }
          if (esc) sc += (safe / esc) * 160 * w.threat * hostile;
          if (po === ai.target && ctx.hunters) for (const h of ctx.hunters) sc -= (Math.abs(h % N - x) + Math.abs(((h / N) | 0) - y)) * 1.6 * w.hunt;
        }
      }
    }
    C4.unmake(st, u);
    return sc;
  }

  /** Choisit un coup pour `o` avec l'IA `ai`. Renvoie le coup (entier) ou -1 s'il n'y en a aucun. */
  AI.choose = (st, o, ai) => {
    const list = C4.moves(st, o);
    if (!list.length) return -1;
    const enemies = [], team = [];
    for (let i = 0; i < 4; i++) { if (!st.alive[i]) continue; if (C4.allied(st, o, i)) team.push(i); else enemies.push(i); }
    const hunters = [];
    for (let i = 0; i < SQ; i++) { const v = st.b[i]; if (v && ownerOf(v) === o && [Q, R, KN].includes(typeOf(v))) hunters.push(i); }
    const ctx = { enemies, team, hunters };
    let best = -1, bs = -Infinity;
    const k = Math.max(0, ai.noise) * 100 * ai.skill;
    for (const m of list) {
      const s = scoreMove(st, o, m, ai, ctx) + noiseOf() * k;
      if (s > bs) { bs = s; best = m; }
    }
    return best;
  };

  /** Mise à jour de la personnalité après chaque coup joué (Naskurieux progresse, Naskolit s'endort, le Jester relance la roue). */
  AI.afterMove = (ai, info) => {
    ai.moves++;
    if (ai.grow && info.captured) ai.noise = Math.max(0.02, ai.noise - 0.12);
    if (ai.drowsy && info.lost) ai.noise = Math.min(1.1, ai.noise + 0.1);
    if (ai.wheel && ai.moves % 10 === 0) { const elo = 1 + Math.floor(Math.random() * 3200); ai.noise = 1.3 - elo / 3200 * 1.28; ai.elo = elo; return { elo }; }
    return null;
  };

  // ------------------------------------------------------------------ parties automatiques + apprentissage
  /** Joue une partie complète entre 4 IA. Renvoie {ranking, plies, scores:[score par joueur : 3 / 1.5 / 0.5 / 0 + points/100]}. */
  AI.playGame = (seats, opts) => {
    opts = opts || {};
    const st = C4.newGame({ teams: opts.teams, storm: opts.storm === undefined ? { first: 56, every: 18 } : opts.storm });
    const cap = opts.maxPlies || 200;
    while (!C4.over(st) && st.ply < cap) {
      const o = st.turn, ai = seats[o], m = AI.choose(st, o, ai);
      if (m < 0) break;
      const r = C4.play(st, m);
      AI.afterMove(ai, { captured: !!r.captured });
      if (r.captured) { const v = seats[r.captured.owner]; if (v) AI.afterMove(v, { lost: true }); }
    }
    const ranking = C4.ranking(st), PT = [3, 1.5, 0.5, 0], scores = [0, 0, 0, 0];
    ranking.forEach((r, i) => { scores[r.o] = PT[i] + st.pts[r.o] / 100; });
    return { ranking, plies: st.ply, scores, st };
  };
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  AI.mutate = (w, sigma) => { const n = {}; for (const k of KEYS) n[k] = clampW(w[k] * Math.exp(noiseOf() * 2 * sigma)); return n; };

  /**
   * Évolution (1+1) de la stratégie d'une personnalité : une variante mutée affronte l'originale (+ 2 adversaires de référence) dans `games` parties à 4 sièges tournants ;
   * si la variante fait mieux, elle devient la nouvelle stratégie. Asynchrone (rend la main entre les parties). Renvoie {w, accepted, gain}.
   */
  AI.evolve = async (persona, w, o) => {
    o = o || {};
    const games = o.games || 4, sigma = o.sigma || 0.18, cand = AI.mutate(w, sigma);
    const refs = shuffle(Object.keys(PERSONA).filter((p) => p !== persona)).slice(0, 2);
    let sa = 0, sb = 0, played = 0;
    for (let g = 0; g < games; g++) {
      if (o.shouldStop && o.shouldStop()) break;
      const order = shuffle([0, 1, 2, 3]);                                         // sièges tirés au sort : aucun avantage de position
      const seats = [];
      seats[order[0]] = AI.make({ persona, w }); seats[order[1]] = AI.make({ persona, w: cand });
      seats[order[2]] = AI.make({ persona: refs[0] }); seats[order[3]] = AI.make({ persona: refs[1] });
      seats.forEach((s, i) => { s.target = (i + 1) % 4; });
      const r = AI.playGame(seats, { maxPlies: o.maxPlies || 160 });
      sa += r.scores[order[0]]; sb += r.scores[order[1]]; played++;
      if (o.onGame) o.onGame({ persona, game: g + 1, games, plies: r.plies, a: r.scores[order[0]], b: r.scores[order[1]] });
      await new Promise((res) => setTimeout(res, 0));
    }
    const accepted = played > 0 && sb > sa;
    return { w: accepted ? cand : w, accepted, gain: played ? (sb - sa) / played : 0, scoreOld: sa, scoreNew: sb, played };
  };

  if (typeof window !== "undefined") { window.ENOS = window.ENOS || {}; window.ENOS.c4ai = AI; }
  if (typeof module !== "undefined" && module.exports) module.exports = AI;
})();
