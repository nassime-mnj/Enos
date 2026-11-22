"use strict";
// MIND GAMES (E.N.O.S. et Mittens) : le bot « rentre dans la tête » du joueur. Rien n'est inventé : chaque phrase s'appuie sur un FAIT réel
// que le joueur ne s'attend pas à voir remarqué, d'où le « comment il sait ? ».
//   1. Prédiction humaine : à chaque tour du joueur, Stockfish analyse SA position (MultiPV 4) ; un modèle « humain » pondère les coups
//      (perte en centipions, reprise immédiate, échecs, prises, pièce attaquée qui s'enfuit, part « autre coup » selon le nombre de coups légaux).
//      Au-delà de ~60 % : prédiction SCELLÉE avant que tu joues (heure notée à la seconde), révélée après : « Écrit à 21:14:07, avant ton coup : Fxe5. »
//      Parfois il scelle tes DEUX prochains coups (ligne principale : toi, lui, toi) et les révèle un par un, dans l'ordre.
//   2. Ta main : les pièces que tu touches puis reposes, combien de fois, dans quel ordre (« Ton cavalier en f3. Tu l'as touché 3 fois. »),
//      la pièce que tu prends avant même de jouer (« Oui. Ce fou. Je savais que tu le prendrais. » / « Pas cette tour. »).
//   3. Ton temps : il connaît ta vitesse habituelle (mémorisée partie après partie) et remarque quand tu ralentis.
//   4. Le plateau vu de ton côté : pièce attaquée sans défenseur, gaffe que tu ressasses, mat qu'il voit, position perdue, pendule basse.
//   5. Sa mémoire : nombre de parties contre lui, défaites, ton ouverture fétiche (« Tu vas ouvrir avec e4. Comme les 4 dernières fois. »), l'heure tardive.
//   6. Pression : points de suspension qui apparaissent puis s'effacent sans message, silences, phrases d'ambiance.
// Les textes sont dans js/mind_lines.js ; les phrases fixes d'E.N.O.S. ont leur voix (js/voice_index.js, lue par js/bot_chat.js).
(() => {
  const E = window.ENOS;
  const M = (E.mind = { bots: new Set(["enos", "r_mittens"]) });
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const NAME = { p: "pion", n: "cavalier", b: "fou", r: "tour", q: "dame", k: "roi" }, CE = { p: "ce pion", n: "ce cavalier", b: "ce fou", r: "cette tour", q: "ta dame", k: "ton roi" };
  const TON = { p: "ton pion", n: "ton cavalier", b: "ton fou", r: "ta tour", q: "ta dame", k: "ton roi" };
  let st = null;
  const FR = { K: "R", Q: "D", R: "T", B: "F", N: "C" }, fr = (san) => String(san || "").replace(/^[KQRBN]/, (x) => FR[x]).replace(/=([QRBN])/, (x, y) => "=" + FR[y]);
  M.fr = fr;
  const now = () => performance.now(), hms = () => new Date().toTimeString().slice(0, 8), rnd = () => Math.random();
  const scoreOf = (l) => (l.mate != null ? (l.mate > 0 ? 10000 - l.mate : -10000 - l.mate) : l.cp || 0);
  const uciOf = (m) => m.from + m.to + (m.promotion || "");

  // ---------------------------------------------------------------- mémoire d'une partie à l'autre (par bot)
  const profKey = (id) => "mind.profile." + id;
  const loadProf = (id) => { try { return Object.assign({ games: 0, wins: 0, losses: 0, draws: 0, first: {}, thinkS: 0, thinkN: 0, hits: 0, total: 0, last: null }, E.settings.get(profKey(id), null) || {}); } catch (e) { return { games: 0, wins: 0, losses: 0, draws: 0, first: {}, thinkS: 0, thinkN: 0, hits: 0, total: 0, last: null }; } };
  const saveProf = (id, p) => { try { E.settings.set(profKey(id), p); } catch (e) { /* stockage indisponible */ } };
  const avgThink = () => { const p = st && st.prof; if (!p) return 0; const s = p.thinkS + st.thinkS, n = p.thinkN + st.thinkN; return n >= 4 ? s / n : 0; };

  // ---------------------------------------------------------------- échiquier vu du joueur
  function attackedBy(fen, by) {
    try { const f = fen.split(" "); f[1] = by; f[3] = "-"; const c = new Chess(); if (!c.load(f.join(" "))) return new Set(); return new Set(c.moves({ verbose: true }).filter((m) => m.captured).map((m) => m.to)); } catch (e) { return new Set(); }
  }
  /** pièces du joueur (valeur ≥ 3) attaquées par l'adversaire et défendues par personne */
  function hanging(fen) {
    const c0 = new Chess(fen), me = c0.turn(), opp = me === "w" ? "b" : "w", att = attackedBy(fen, opp), out = [];
    for (const sq of att) {
      const p = c0.get(sq); if (!p || p.color !== me || VAL[p.type] < 3) continue;
      try { const c = new Chess(fen); c.remove(sq); c.put({ type: "n", color: opp }, sq); const f = c.fen().split(" "); f[1] = me; f[3] = "-"; const c2 = new Chess(); if (!c2.load(f.join(" "))) continue;
        if (!c2.moves({ verbose: true }).some((m) => m.to === sq && m.captured)) out.push({ sq, type: p.type }); } catch (e) { /* position spéciale */ }
    }
    return out.sort((a, b) => VAL[b.type] - VAL[a.type]);
  }
  /** Probabilités « humaines » des coups candidats (MultiPV du point de vue du joueur au trait) : [{uci, san, p, loss, pv}] trié. */
  M.model = (fen, lines, lastTo) => {
    const ch = new Chess(fen), legal = ch.moves({ verbose: true }), me = ch.turn(), opp = me === "w" ? "b" : "w";
    if (!legal.length) return [];
    if (legal.length === 1) return [{ uci: uciOf(legal[0]), san: legal[0].san, from: legal[0].from, p: 1, loss: 0, forced: true, pv: [] }];
    const att = attackedBy(fen, opp), best = Math.max(...lines.map(scoreOf)), out = [];
    for (const l of lines) {
      const m = legal.find((x) => uciOf(x) === l.uci || (x.from + x.to === l.uci.slice(0, 4) && !x.promotion));
      if (!m) continue;
      const loss = Math.min(1000, best - scoreOf(l));
      let w = Math.exp(-loss / 70);
      if (m.captured && lastTo && m.to === lastTo) w *= 3;
      else if (m.captured) w *= 1 + VAL[m.captured] * 0.12;
      if (/\+/.test(m.san)) w *= 1.3;
      if (att.has(m.from) && VAL[m.piece] >= 3) w *= 1.7;
      out.push({ uci: uciOf(m), san: m.san, from: m.from, w, loss, pv: l.pv || [] });
    }
    if (!out.length) return [];
    const other = legal.length > 8 ? 0.3 : legal.length > 4 ? 0.18 : 0.08, Z = out.reduce((a, x) => a + x.w, 0) * (1 + other);
    out.forEach((x) => (x.p = x.w / Z));
    return out.sort((a, b) => b.p - a.p);
  };
  const sansOf = (fen, pv, n) => { const c = new Chess(fen), s = []; for (const u of pv.slice(0, n)) { const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); if (!m) break; s.push(m.san); } return s; };

  // ---------------------------------------------------------------- parole
  const say = (k, d) => { if (!st || !st.I || !st.I.alive) return false; st.spoke = st.ply; return st.I.say(k, d || {}, true); };
  const once = (key) => { if (st.done[key]) return false; st.done[key] = 1; return true; };

  /** Début de partie : la mémoire d'abord (nombre de parties, défaites, ouverture fétiche). */
  M.start = (g, I) => {
    if (!I || !M.bots.has(I.id)) { st = null; return; }
    if (st && st.timer) clearTimeout(st.timer);
    st = { g, I, prof: loadProf(I.id), ply: -1, done: {}, touches: [], thinkS: 0, thinkN: 0, hits: 0, total: 0, streak: 0, spoke: -9, saidDoom: -99, saidMate: 99, saidHang: {}, lastTouchSay: -9 };
    const p = st.prof, fav = Object.entries(p.first).sort((a, b) => b[1] - a[1])[0];
    st.timer = setTimeout(() => {
      if (!st || st.g !== g) return;
      if (p.games >= 1 && p.losses >= 1 && rnd() < 0.85) say("memory_greet", { games: p.games + 1, losses: p.losses });
      else if (p.last && p.last.lost && p.last.moves) say("memory_last", { m: Math.ceil(p.last.moves / 2) });
      if (fav && fav[1] >= 2 && g.me === "w") { st.fav = { san: fav[0], k: fav[1] }; setTimeout(() => { if (st && st.g === g && g.moves.length === 0) say("memory_fav", { fav: fr(fav[0]), k: fav[1] }); }, 2600); }
    }, 2400);
  };
  M.end = (g, res) => {                                             // res : "win" (le joueur gagne) | "lose" | "draw" | "" (arrêt)
    if (!st || st.g !== g) return;
    if (st.timer) clearTimeout(st.timer);
    if (res) { const p = st.prof; p.games++; if (res === "win") p.wins++; else if (res === "lose") p.losses++; else p.draws++; p.thinkS += st.thinkS; p.thinkN += st.thinkN; p.hits += st.hits; p.total += st.total;
      const f = g.moves.find((m) => g.pl[m.color] && g.pl[m.color].human); if (f && g.me === "w") p.first[f.san] = (p.first[f.san] || 0) + 1;
      p.last = { lost: res === "lose", moves: g.moves.length, at: Date.now() }; saveProf(st.I.id, p); }
    st = null;
  };
  M.undo = (g) => { if (!st || st.g !== g) return; st.pred = null; st.seq = null; if (rnd() < 0.7 && once("undo")) say("undo"); };

  /** Le joueur prend une pièce en main (sélection d'une case). */
  M.touch = (g, sq) => {
    if (!st || st.g !== g || !sq) return;
    const p = g.ch.get(sq); if (!p) return;
    st.touches.push({ sq, type: p.type, t: now() });
    if (st.ply - st.lastTouchSay < 3 || st.touchSaid) return;
    const T = st.touches, same = T.filter((x) => x.sq === sq).length, distinct = [...new Set(T.map((x) => x.sq))];
    const c = st.cands, top = c && c[0];
    const fire = (k, d) => { st.touchSaid = true; st.lastTouchSay = st.ply; say(k, d); };
    if (same >= 3 && rnd() < 0.85) return fire("touch_many", { piece: NAME[p.type], ton: TON[p.type], sq, n: same });
    if (distinct.length >= 3 && rnd() < 0.7) { const a = T[0]; return fire("touch_switch", { p1: TON[a.type], p2: TON[p.type], n: distinct.length }); }
    if (top && T.length === 1 && top.from === sq && top.p >= 0.45 && rnd() < 0.3 && once("tright" + st.ply)) return fire("touch_right", { ce: CE[p.type], piece: NAME[p.type] });
    if (c && c.length >= 3 && T.length === 1 && !c.some((x) => x.from === sq && x.loss <= 150) && c[0].loss === 0 && rnd() < 0.3) return fire("touch_wrong", { ce: CE[p.type], piece: NAME[p.type] });
  };

  /** Début du tour du joueur. */
  M.humanTurn = async (g, I) => {
    if (!I || !I.alive || !M.bots.has(I.id) || g.over) return;
    if (!st || st.g !== g) M.start(g, I);
    if (st.timer2) clearTimeout(st.timer2); if (st.timer3) clearTimeout(st.timer3);
    const ply = g.moves.length, fen = g.fen, last = g.moves[ply - 1], me = g.ch.turn();
    st.ply = ply; st.pred = null; st.cands = null; st.I = I; st.touches = []; st.touchSaid = false; st.turnStart = now();
    if (st.seq && st.seq.stage === 1 && (!last || last.uci.slice(0, 4) !== st.seq.u[1].slice(0, 4))) st.seq = null;      // le bot a dévié de la ligne : la suite scellée tombe
    let r = null;
    try { r = await E.chessLocal.analyse(fen, { multipv: 4, movetime: 650 }); } catch (e) { r = null; }
    if (!st || st.g !== g || st.ply !== ply || g.moves.length !== ply || g.over || !r || !r.lines || !r.lines.length) return;
    const cands = M.model(fen, r.lines, last && last.uci ? last.uci.slice(2, 4) : ""); st.cands = cands;
    const top = cands[0], best = Math.max(...r.lines.map(scoreOf));
    // le temps : il connaît ta vitesse habituelle
    const avg = avgThink(), slowAt = Math.max(12, Math.min(40, avg ? avg * 2.2 : 15)) * 1000;
    st.timer2 = setTimeout(() => {
      if (!st || st.ply !== ply || g.moves.length !== ply || g.over) return;
      const sec = Math.round((now() - st.turnStart) / 1000), a = cands[0], b = cands[1];
      if (a && b && b.loss <= 80 && !st.pred && !st.seq && rnd() < 0.7) { st.pred = { uci: a.uci, san: a.san, sealed: false, at: hms() }; say("hesitate_pair", { a: fr(a.san), b: fr(b.san) }); }
      else if (avg >= 2 && rnd() < 0.75) say("slow", { avg: Math.max(1, Math.round(avg)), sec });
      else if (rnd() < 0.5) st.I.ghost && st.I.ghost(); else say("hesitate", { sec });
    }, slowAt);
    st.timer3 = setTimeout(() => { if (st && st.ply === ply && g.moves.length === ply && !g.over) { if (rnd() < 0.5) st.I.ghost && st.I.ghost(); else say("pressure"); } }, slowAt + 20000);
    if (st.seq && st.seq.stage === 1) return;                       // une suite scellée est en cours : il attend
    if (top && top.forced) { if (rnd() < 0.75) say("forced"); return; }
    if (best <= -9000) { const n = Math.max(1, Math.round(10000 + best)); if (n < st.saidMate && n <= 7) { st.saidMate = n; say("mate_seen", { n }); return; } }
    if (top && top.p >= 0.6 && top.loss <= 40) {
      const pv = top.pv && top.pv[0] && top.pv[0].slice(0, 4) === top.uci.slice(0, 4) ? top.pv : null;
      if (pv && pv.length >= 3 && ply >= 6 && rnd() < 0.35) { const s = sansOf(fen, pv, 3); if (s.length === 3) { st.seq = { u: pv.slice(0, 3), s: s.map(fr), stage: 0, at: hms() }; say("seq_predict"); return; } }
      if (rnd() < 0.6) { st.pred = { uci: top.uci, san: top.san, sealed: true, at: hms() }; say("predict"); return; }
    }
    if (last && g.moves[ply - 2] && g.moves[ply - 2].key === "blunder" && g.pl[g.moves[ply - 2].color].human && rnd() < 0.6 && once("haunt" + (ply - 2))) { say("haunt"); return; }
    const hg = hanging(fen).find((h) => !st.saidHang[h.sq + h.type]);
    if (hg && rnd() < 0.45) { st.saidHang[hg.sq + hg.type] = 1; say("hanging", { piece: NAME[hg.type], ton: TON[hg.type], sq: hg.sq }); return; }
    if (best <= -400 && ply - st.saidDoom >= 8 && rnd() < 0.4) { st.saidDoom = ply; say("doom"); return; }
    if (g.clk && g.clk[me] < 20000 && g.clk[me] > 0 && once("clock")) { say("clock_low", { sec: Math.round(g.clk[me] / 1000) }); return; }
    { const h = new Date().getHours(); if (h >= 0 && h < 5 && ply >= 8 && once("late")) { say("late", { h }); return; } }
    if (ply - st.spoke >= 4 && rnd() < 0.18) { say("mind"); return; }
    if (rnd() < 0.08) st.I.ghost && st.I.ghost();
  };

  /** Le joueur vient de jouer `uci` (avant l'analyse du coup) : révélation des prédictions. */
  M.humanMoved = (g, uci, san0) => {
    if (!st || st.g !== g) return;
    const san = fr(san0);
    [st.timer2, st.timer3].forEach((t) => t && clearTimeout(t));
    const sec = (now() - (st.turnStart || now())) / 1000; if (sec > 0.5 && sec < 600) { st.thinkS += sec; st.thinkN++; }
    if (st.fav && g.moves.length === 0) { const f = st.fav; st.fav = null; if (san0 === f.san) { say("memory_fav_hit", { fav: san, k: f.k + 1 }); return; } }
    const u = uci.slice(0, 4);
    if (st.seq) {
      const q = st.seq;
      if (q.stage === 0) { if (u === q.u[0].slice(0, 4)) { q.stage = 1; say("seq_hit1", { san, time: q.at }); } else { st.seq = null; if (rnd() < 0.4) say("predict_miss", { san }); } return; }
      if (q.stage === 1) { st.seq = null; st.total++; if (u === q.u[2].slice(0, 4)) { st.hits++; st.streak++; say("seq_hit2", { s1: q.s[0], s2: q.s[1], s3: q.s[2], time: q.at }); } else { st.streak = 0; if (rnd() < 0.4) say("predict_miss", { san }); } return; }
    }
    const p = st.pred; st.pred = null;
    if (!p) return;
    st.total++;
    const hit = u === p.uci.slice(0, 4);
    if (hit) { st.hits++; st.streak++; } else st.streak = 0;
    if (!p.sealed && !hit) return;
    const d = { san, n: st.hits, t: st.total, time: p.at, all: st.prof.hits + st.hits, allT: st.prof.total + st.total };
    if (hit) say(st.streak >= 3 && st.streak % 2 === 1 ? "predict_streak" : "predict_hit", d);
    else if (rnd() < 0.5) say("predict_miss", d);
  };
  M.state = () => st;
})();
