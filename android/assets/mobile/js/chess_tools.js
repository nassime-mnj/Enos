"use strict";
// OUTILS DE PLATEAU PARTAGÉS (téléphone + PC via static/learn/) : « coups possibles » d'une position (meilleur / brillants / excellents / bons) et DÉMONSTRATION d'un coup :
// il est joué sous tes yeux avec des flèches (coup, cibles, réponse attendue), puis déjoué pour revenir à la position de départ.
(() => {
  const E = window.ENOS, B = E.board, K = E.brain, T = (E.chessTools = {});
  const CAP = 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  T.sleep = sleep;
  T.GROUPS = {
    best: { label: "Meilleur coup", key: "best", color: "#7bd64d" },
    brilliant: { label: "Coups brillants", key: "brilliant", color: "#1acfd6" },
    excellent: { label: "Excellents coups", key: "excellent", color: "#9ecc38" },
    good: { label: "Bons coups", key: "good", color: "#739e66" },
  };
  const clampCp = (v) => Math.max(-CAP, Math.min(CAP, v));
  const whitePov = (fen, cp) => (fen.split(" ")[1] === "w" ? cp : -cp);
  /** « +0,4 » / « M3 » du point de vue des Blancs. */
  T.fmtScore = (fen, it) => {
    const w = whitePov(fen, it.cp);
    if (Math.abs(w) >= 90000) return (w > 0 ? "+" : "−") + "M" + Math.max(1, 100000 - Math.abs(w));
    return (w >= 0 ? "+" : "−") + (Math.abs(w) / 100).toFixed(1).replace(".", ",");
  };

  const cache = new Map();                                                       // fen -> {lines, hunt}
  const entry = (fen) => { let e = cache.get(fen); if (!e) { if (cache.size > 40) cache.clear(); cache.set(fen, (e = {})); } return e; };
  const item = (fen, ln, key, loss) => ({ uci: ln.uci, san: K.san(fen, ln.uci), pv: ln.pv || [ln.uci], line: K.sanLine(fen, ln.pv || [ln.uci], 6), cp: ln.cp, key, loss: Math.round(loss) });

  /** Coups possibles d'une position, groupés. kind : best | brilliant | excellent | good. Renvoie [{uci, san, pv, line, cp, key, loss}] (3 au plus, meilleur d'abord). */
  T.cands = async (fen, kind, o) => {
    o = o || {};
    const e = entry(fen), ch = new Chess(fen);
    if (ch.game_over()) return [];
    if (kind === "brilliant") {
      if (!e.hunt) e.hunt = K.hunt(fen, { multipv: 3, topMs: o.ms || 900, sacMs: o.sacMs || 1800, tolerance: 40 });
      const h = await e.hunt;
      return (h.sacrifices || []).filter((s) => s.brilliant).slice(0, 3).map((s) => ({ uci: s.uci, san: s.san, pv: s.pv, line: s.line, cp: s.score, key: "brilliant", loss: s.loss }));
    }
    if (!e.lines) e.lines = E.chessLocal.lines(fen, Math.min(8, Math.max(3, ch.moves().length)), o.ms || 1500);
    const lines = await e.lines;
    if (!lines.length) return [];
    const top = clampCp(lines[0].cp), res = lines.map((ln, i) => ({ ln, loss: Math.max(0, top - clampCp(ln.cp)), i }));
    if (kind === "best") return [item(fen, lines[0], "best", 0)];
    if (kind === "excellent") return res.filter((x) => x.i > 0 && x.loss <= 30).slice(0, 3).map((x) => item(fen, x.ln, "excellent", x.loss));
    if (kind === "good") return res.filter((x) => x.i > 0 && x.loss > 30 && x.loss <= 70).slice(0, 3).map((x) => item(fen, x.ln, "good", x.loss));
    return [];
  };

  const sqOf = (uci) => [uci.slice(0, 2), uci.slice(2, 4)];
  /** Flèches pour un coup démontré : le coup (couleur du groupe), ce qu'il vise ensuite (orange), la réponse attendue puis la suite (bleu). */
  T.arrowsFor = (fen, it) => {
    const pos = B.parse(fen), after = B.applyUci(pos, it.uci), [f, t] = sqOf(it.uci);
    const main = it.key === "brilliant" ? B.ARROW.brilliant : it.key === "best" ? B.ARROW.best : B.ARROW.alt;
    const arrows = [{ from: f, to: t, color: main }];
    B.attacks(after, t).forEach((s) => arrows.push({ from: t, to: s, color: B.ARROW.target, w: 0.1, alpha: 0.8 }));
    const pv = it.pv || [];
    if (pv[1]) { const [a, b] = sqOf(pv[1]); arrows.push({ from: a, to: b, color: B.ARROW.threat, w: 0.12, alpha: 0.75 }); }
    if (pv[2]) { const [a, b] = sqOf(pv[2]); arrows.push({ from: a, to: b, color: main, w: 0.11, alpha: 0.6 }); }
    return arrows;
  };

  let demoSeq = 0;
  T.stop = (el) => { if (el) el._demo = 0; };
  /**
   * Démonstration : position -> le coup se joue (flèches) -> pause -> le coup est déjoué (les flèches restent). Annulable (T.stop) ; renvoie false si interrompue.
   * o : {flip, hold (ms), onPhase("play"|"undo"|"done"), last}
   */
  T.demo = async (el, fen, it, o) => {
    o = o || {};
    const id = (el._demo = ++demoSeq + 1), live = () => el._demo === id;
    const pos = B.parse(fen), after = B.applyUci(pos, it.uci), [f, t] = sqOf(it.uci), arrows = T.arrowsFor(fen, it);
    const base = { flip: !!o.flip, last: o.last || null };
    B.render(el, pos.m, base);
    await sleep(o.lead == null ? 450 : o.lead); if (!live()) return false;
    if (o.onPhase) o.onPhase("play");
    if (E.chessSound) { try { E.chessSound.forSan(it.san); } catch (e) { /* son facultatif */ } }
    B.render(el, after, { ...base, last: [f, t], arrows, anim: it.uci, badge: it.key === "brilliant" ? { sq: t, key: "brilliant", id: "demo" + id } : null });
    await sleep(o.hold || (it.key === "brilliant" ? 3300 : 2000)); if (!live()) return false;
    if (o.onPhase) o.onPhase("undo");
    B.render(el, pos.m, { ...base, arrows, anim: t + f });
    await sleep(650); if (!live()) return false;
    if (o.onPhase) o.onPhase("done");
    return true;
  };
})();
