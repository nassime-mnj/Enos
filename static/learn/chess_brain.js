"use strict";
// CERVEAU DES ÉCHECS (hors ligne) : jugement des coups (Brillant … Gaffe), détection des sacrifices, coup d'« ETO Brillant » et conseiller de brillants.
// Port JavaScript de la logique de nasko_chess.py (mêmes seuils), au-dessus de chess.js (règles) et de chess_local.js (Stockfish.js).
// Aucun PC, aucun réseau. Les scores sont en centipions ; « blanc » = point de vue des Blancs, « mover » = point de vue du camp qui joue.
(() => {
  const E = window.ENOS;
  const K = (E.brain = {});
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  const FR = { n: "cavalier", b: "fou", r: "tour", q: "dame" };
  const FILES = "abcdefgh";
  const MAT = 10000, CAP = 1000;
  K.QUALITY = { brilliant: "Brillant", best: "Meilleur coup", excellent: "Excellent", good: "Bon", inaccuracy: "Imprécision", mistake: "Erreur", blunder: "Gaffe" };
  K.KEYS = ["brilliant", "best", "excellent", "good", "inaccuracy", "mistake", "blunder"];
  K.MAT = MAT;

  // ------------------------------------------------------------------ plateau
  const uciOf = (m) => m.from + m.to + (m.promotion || "");
  const play = (ch, uci) => ch.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  /** {case: "P"|"p"…} depuis une instance chess.js */
  K.mapOf = (ch) => {
    const m = {};
    ch.board().forEach((row, r) => row.forEach((p, f) => { if (p) m[FILES[f] + (8 - r)] = p.color === "w" ? p.type.toUpperCase() : p.type; }));
    return m;
  };
  const material = (map, color) => { let s = 0; for (const k in map) { const p = map[k]; if (p.toLowerCase() !== "k" && (p === p.toUpperCase()) === (color === "w")) s += VAL[p.toLowerCase()]; } return s; };

  /** Types (minuscules) des pièces de `color` qui attaquent `sq` (sans tenir compte des clouages : estimation). */
  const attackers = (map, sq, color) => {
    const f = sq.charCodeAt(0) - 97, r = +sq[1] - 1, out = [];
    const at = (ff, rr) => (ff < 0 || ff > 7 || rr < 0 || rr > 7 ? "" : map[FILES[ff] + (rr + 1)] || "");
    const mine = (p) => p && (p === p.toUpperCase()) === (color === "w");
    const pr = color === "w" ? r - 1 : r + 1;
    for (const df of [-1, 1]) { const p = at(f + df, pr); if (mine(p) && p.toLowerCase() === "p") out.push("p"); }
    for (const [df, dr] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) { const p = at(f + df, r + dr); if (mine(p) && p.toLowerCase() === "n") out.push("n"); }
    for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) if (df || dr) { const p = at(f + df, r + dr); if (mine(p) && p.toLowerCase() === "k") out.push("k"); }
    for (const [df, dr, diag] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [1, 1, 1], [1, -1, 1], [-1, 1, 1], [-1, -1, 1]]) {
      for (let i = 1; i < 8; i++) {
        const p = at(f + df * i, r + dr * i);
        if (!p) continue;
        const t = p.toLowerCase();
        if (mine(p) && (t === "q" || (diag ? t === "b" : t === "r"))) out.push(t);
        break;
      }
    }
    return out;
  };
  K.attackers = attackers;

  /** Le coup abandonne-t-il ≥ 2 pions de matériel, même après l'échange ? (estimation : 1 échange évalué à la volée) */
  K.isSacrifice = (fen, uci) => {
    const ch = new Chess(fen), mover = ch.turn();
    const m = play(ch, uci);
    if (!m) return false;
    const cap = !!m.captured;
    if (!cap && (m.piece === "p" || m.piece === "k")) return false;
    const gain = cap ? VAL[m.captured] : 0, map = K.mapOf(ch), opp = mover === "w" ? "b" : "w";
    const att = attackers(map, m.to, opp);
    if (!att.length) return false;
    const defended = attackers(map, m.to, mover).length > 0, cheapest = Math.min(...att.map((t) => VAL[t])), mine = VAL[(map[m.to] || "p").toLowerCase()];
    const lost = !defended ? mine : cheapest < mine ? mine - cheapest : 0;
    return lost - gain >= 2;
  };

  /** FILTRE DE SACRIFICE sur une ligne (liste UCI) : l'adversaire prend une pièce lourde, déficit ≥ 2 pions, et on ne reprend pas aussitôt. -> {piece, deficit} | null */
  K.sacrificeOf = (fen, pv) => {
    if (!pv || pv.length < 2) return null;
    const ch = new Chess(fen), color = ch.turn(), opp = color === "w" ? "b" : "w";
    const net = () => { const m = K.mapOf(ch); return material(m, color) - material(m, opp); };
    const base = net();
    if (!play(ch, pv[0])) return null;
    const m2 = play(ch, pv[1]);
    if (!m2 || (m2.flags || "").includes("e") || !["n", "b", "r", "q"].includes(m2.captured)) return null;
    const d2 = base - net();
    let d3 = d2;
    if (pv.length >= 3 && play(ch, pv[2])) d3 = base - net();
    if (d2 >= 2 && d3 >= 1) return { piece: FR[m2.captured], piece_type: m2.captured, deficit: d2 };
    return null;
  };

  /** Coups légaux qui sont des sacrifices (statiques) : l'ensemble qu'ETO examine en plus des meilleures lignes. */
  K.sacrificeMoves = (fen) => {
    const ch = new Chess(fen);
    return ch.moves({ verbose: true }).map(uciOf).filter((u) => { try { return K.isSacrifice(fen, u); } catch (e) { return false; } });
  };

  // ------------------------------------------------------------------ jugement
  /** Jugement d'un coup : beforeW / afterW = évaluations (Blancs) AVANT et APRÈS, color = 'w'|'b'. Mêmes seuils que CHESS (PC). */
  K.quality = (fenBefore, uci, beforeW, afterW, color) => {
    const sgn = color === "w" ? 1 : -1;
    const b = Math.max(-CAP, Math.min(CAP, sgn * beforeW)), a = Math.max(-CAP, Math.min(CAP, sgn * afterW)), loss = Math.max(0, b - a);
    let key;
    if (loss <= 15 && a >= -50 && b < 600 && K.isSacrifice(fenBefore, uci)) key = "brilliant";
    else if (loss <= 8) key = "best";
    else if (loss <= 30) key = "excellent";
    else if (loss <= 70) key = "good";
    else if (loss <= 130) key = "inaccuracy";
    else if (loss < 250) key = "mistake";
    else key = "blunder";
    return { key, label: K.QUALITY[key], loss: Math.round(loss), before: Math.round(sgn * beforeW), after: Math.round(sgn * afterW) };
  };
  K.winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-2000, Math.min(2000, cp)))) - 1);
  const moveAccuracy = (wb, wa) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, wb - wa)) - 3.1669));
  const sideReview = (moves) => {
    const counts = {}; K.KEYS.forEach((k) => (counts[k] = 0));
    const accs = [], losses = [];
    moves.forEach((q) => { accs.push(moveAccuracy(K.winPct(q.before), K.winPct(q.after))); losses.push(Math.min(q.loss, 1000)); counts[q.key]++; });
    const n = accs.length;
    if (!n) return { moves: 0, accuracy: null, elo: null, acpl: null, counts };
    const mean = accs.reduce((s, x) => s + x, 0) / n, harm = n / accs.reduce((s, x) => s + 1 / Math.max(x, 1), 0), acpl = losses.reduce((s, x) => s + x, 0) / n;
    return { moves: n, accuracy: Math.round((mean + harm) / 2 * 10) / 10, elo: Math.max(100, Math.min(3200, Math.round(3100 * Math.exp(-0.01 * acpl) / 10) * 10)), acpl: Math.round(acpl * 10) / 10, counts };
  };
  /** Bilan à partir de coups jugés [{color:'w'|'b', key, loss, before, after, n, san, label, best}] ; meColor = camp du joueur. */
  K.buildReview = (moves, meColor) => {
    const mine = moves.filter((m) => m.color === meColor), theirs = moves.filter((m) => m.color !== meColor);
    const bad = mine.filter((m) => m.key === "blunder" || m.key === "mistake").sort((a, b) => b.loss - a.loss).slice(0, 4);
    const me = sideReview(mine);
    return { me, engine: sideReview(theirs), me_color: meColor, evals: moves.map((m) => (m.color === "w" ? m.after : -m.after)), keys: moves.map((m) => m.key), sans: moves.map((m) => m.san), plies: moves.length,
      confidence: me.moves < 8 ? "faible" : "correcte", critical: bad.map((m) => ({ n: m.n, san: m.san, label: m.label, key: m.key, loss: m.loss, best: m.best || "", best_uci: m.best_uci || "", uci: m.uci || "" })) };
  };

  // ------------------------------------------------------------------ analyse + sacrifices
  const moverScore = (line) => (line.mate != null ? (line.mate > 0 ? MAT - line.mate : -MAT - line.mate) : line.cp || 0);        // point de vue du camp au trait de la position analysée
  const san = (fen, uci) => { try { const c = new Chess(fen), m = play(c, uci); return m ? m.san : uci; } catch (e) { return uci; } };
  K.sanLine = (fen, pv, n) => {
    const c = new Chess(fen), out = [];
    for (const u of (pv || []).slice(0, n || 6)) { const m = play(c, u); if (!m) break; out.push(m.san); }
    return out;
  };
  K.san = san;

  /** Évaluation d'une position (Blancs) : {w, best, line}. Les positions terminales sont jugées sans moteur. */
  K.evaluate = async (fen, ms) => {
    const ch = new Chess(fen);
    if (ch.game_over()) return { w: ch.in_checkmate() ? (ch.turn() === "w" ? -MAT : MAT) : 0, best: "", line: null };
    const r = await E.chessLocal.analyse(fen, { movetime: ms || 450 });
    const ln = r.lines[0] || { cp: 0 };
    return { w: E.chessLocal.whiteScore(ln, fen), best: r.best, line: ln };
  };

  /**
   * Jugement CONFIRMÉ d'un coup. Les évaluations rapides d'un moteur JavaScript sont bruitées (±100 cp à faible profondeur) : un coup qui semble mauvais (perte > 60 cp)
   * ou brillant est donc ré-évalué 3 fois plus longtemps, avant et après, avant de recevoir son étiquette. -> {q, before:{w,best}, after:{w,best}}
   */
  K.judge = async (fenBefore, uci, evBefore, evAfter, color, ms) => {
    let q = K.quality(fenBefore, uci, evBefore.w, evAfter.w, color);
    if (q.loss > 60 || q.key === "brilliant") {
      const c = new Chess(fenBefore); play(c, uci);
      const b2 = await K.evaluate(fenBefore, (ms || 450) * 3), a2 = await K.evaluate(c.fen(), (ms || 450) * 3);
      q = K.quality(fenBefore, uci, b2.w, a2.w, color);
      return { q, before: b2, after: a2 };
    }
    return { q, before: evBefore, after: evAfter };
  };

  /**
   * Recherche des sacrifices de la position (camp au trait) : meilleures lignes + TOUS les coups-sacrifices, analysés en une recherche (searchmoves).
   * Retourne {best:{uci,san,cp,mate,line}, lines:[…], sacrifices:[{uci, san, cp, mate, loss, deficit, piece, brilliant, line:[san…]}]} (cp = point de vue du camp au trait).
   *  brilliant = le coup serait jugé « Brillant » : sacrifice, quasi aussi bon que le meilleur coup, position pas perdue ensuite, pas déjà écrasante.
   */
  K.hunt = async (fen, o) => {
    o = o || {};
    const top = await E.chessLocal.analyse(fen, { multipv: o.multipv || 3, movetime: o.topMs || 900 });
    if (!top.lines.length) return { best: null, lines: [], sacrifices: [] };
    const best = top.lines[0], bestS = moverScore(best);
    const cands = K.sacrificeMoves(fen);
    let sacs = [];
    if (cands.length) {
      const pick = cands.slice(0, 24);
      const r = await E.chessLocal.analyse(fen, { multipv: Math.min(pick.length, o.maxSac || 8), movetime: o.sacMs || 1800, searchmoves: pick });
      sacs = r.lines.map((ln) => {
        const s = moverScore(ln), sac = K.sacrificeOf(fen, ln.pv);
        const loss = Math.max(0, Math.min(CAP, bestS) - Math.min(CAP, s));
        const b = Math.min(CAP, bestS);
        return { uci: ln.uci, san: san(fen, ln.uci), cp: ln.cp != null ? ln.cp : null, mate: ln.mate != null ? ln.mate : null, score: s, loss: Math.round(loss), pv: ln.pv, line: K.sanLine(fen, ln.pv, 6), depth: ln.depth,
          forced: !!sac, deficit: sac ? sac.deficit : null, piece: sac ? sac.piece : null,
          brilliant: s >= -50 && b < 600 && loss <= (o.tolerance == null ? 40 : o.tolerance) };
      });
    }
    // un sacrifice déjà dans les meilleures lignes compte aussi
    top.lines.forEach((ln) => {
      if (sacs.some((s) => s.uci === ln.uci)) return;
      if (!K.isSacrifice(fen, ln.uci)) return;
      const s = moverScore(ln), sac = K.sacrificeOf(fen, ln.pv), loss = Math.max(0, Math.min(CAP, bestS) - Math.min(CAP, s));
      sacs.push({ uci: ln.uci, san: san(fen, ln.uci), cp: ln.cp != null ? ln.cp : null, mate: ln.mate != null ? ln.mate : null, score: s, loss: Math.round(loss), pv: ln.pv, line: K.sanLine(fen, ln.pv, 6), depth: ln.depth,
        forced: !!sac, deficit: sac ? sac.deficit : null, piece: sac ? sac.piece : null, brilliant: s >= -50 && Math.min(CAP, bestS) < 600 && loss <= (o.tolerance == null ? 40 : o.tolerance) });
    });
    sacs.sort((a, b) => (b.brilliant - a.brilliant) || (b.score - a.score));
    // une recherche ciblée plus profonde peut révéler un sacrifice meilleur que la 1re ligne : la référence devient ce coup
    const top1 = sacs.slice().sort((a, b) => b.score - a.score)[0];
    const ref = top1 && top1.score > bestS ? { uci: top1.uci, cp: top1.cp, mate: top1.mate, pv: top1.pv } : best;
    if (top1 && top1.score > bestS) sacs.forEach((s) => { s.loss = Math.max(0, Math.min(CAP, top1.score) - Math.min(CAP, s.score)); s.brilliant = s.score >= -50 && Math.min(CAP, top1.score) < 600 && s.loss <= (o.tolerance == null ? 40 : o.tolerance); });
    sacs.sort((a, b) => (b.brilliant - a.brilliant) || (b.score - a.score));
    return { best: { uci: ref.uci, san: san(fen, ref.uci), cp: ref.cp != null ? ref.cp : null, mate: ref.mate != null ? ref.mate : null, line: K.sanLine(fen, ref.pv, 6), score: moverScore(ref) },
      lines: top.lines.map((ln) => ({ uci: ln.uci, san: san(fen, ln.uci), score: moverScore(ln), cp: ln.cp, mate: ln.mate, pv: ln.pv })), sacrifices: sacs };
  };

  const tension = (fen, uci) => {
    const ch = new Chess(fen), m = play(ch, uci);
    if (!m) return 0;
    let t = 0;
    if (/[+#]/.test(m.san)) t += 2;
    if (m.captured) t += 1;
    if (m.piece !== "p" && attackers(K.mapOf(ch), m.to, ch.turn()).length) t += 1;
    return t;
  };

  /**
   * COUP D'« ETO BRILLANT » : parmi les sacrifices, celui qui gagne (mat ou ≥ +2,0) sans coûter plus de 2 pions par rapport à la meilleure ligne ;
   * sinon le meilleur coup, avec un penchant pour les lignes tactiques. -> {uci, san, brilliant: info|null, eval (Blancs)}
   */
  K.etoMove = async (fen, o) => {
    const h = await K.hunt(fen, { multipv: 4, topMs: (o && o.topMs) || 1000, sacMs: (o && o.sacMs) || 1800, tolerance: 200 });
    if (!h.best) return null;
    const best = h.best, bestMate = best.mate != null && best.mate > 0;
    const decisive = (s) => s.mate != null ? s.mate > 0 : s.score >= 200;
    const cands = h.sacrifices.filter((s) => decisive(s) && ((!bestMate && best.score - s.score <= 200) || (bestMate && s.mate != null && s.mate > 0)));
    const evalW = (score) => (fen.split(" ")[1] === "b" ? -score : score);
    if (cands.length) {
      cands.sort((a, b) => ((b.mate != null) - (a.mate != null)) || (b.score - a.score) || ((b.deficit || 0) - (a.deficit || 0)));
      const c = cands[0];
      return { uci: c.uci, san: c.san, eval: evalW(c.score), brilliant: { piece: c.piece, deficit: c.deficit, cp: c.cp, mate: c.mate, line: c.line, depth: c.depth } };
    }
    if (!bestMate && best.score > -150 && best.score < 600) {                         // pas de sacrifice : parmi les lignes quasi équivalentes, la plus tactique
      const near = h.lines.filter((ln) => best.score - ln.score <= 25 && ln.mate == null).sort((a, b) => (tension(fen, b.uci) - tension(fen, a.uci)) || (b.score - a.score));
      if (near.length) return { uci: near[0].uci, san: near[0].san, eval: evalW(near[0].score), brilliant: null };
    }
    return { uci: best.uci, san: best.san, eval: evalW(best.score), brilliant: null };
  };

  // ------------------------------------------------------------------ commentaires sans LLM (repli)
  const label = (k) => K.QUALITY[k] || k;
  K.describe = (q, sanMove, bestSan) => {
    if (q.key === "brilliant") return `${sanMove}!! Un sacrifice qui paie : l'évaluation reste bonne (${fmt(q.after)}).`;
    if (q.key === "best") return `${sanMove} : le meilleur coup de la position.`;
    if (q.key === "excellent") return `${sanMove} : excellent, presque aussi bon que le meilleur.`;
    if (q.key === "good") return `${sanMove} : un bon coup.${bestSan ? " Le moteur préférait " + bestSan + "." : ""}`;
    if (q.key === "inaccuracy") return `${sanMove} : imprécision (−${q.loss} cp).${bestSan ? " Mieux : " + bestSan + "." : ""}`;
    if (q.key === "mistake") return `${sanMove} : erreur (−${q.loss} cp).${bestSan ? " Il fallait jouer " + bestSan + "." : ""}`;
    return `${sanMove} : gaffe (−${q.loss} cp) !${bestSan ? " Il fallait jouer " + bestSan + "." : ""}`;
  };
  const fmt = (cp) => (Math.abs(cp) >= 9000 ? "mat" : (cp > 0 ? "+" : "") + (cp / 100).toFixed(1).replace(".", ","));
  K.fmt = fmt;
  K.label = label;
})();
