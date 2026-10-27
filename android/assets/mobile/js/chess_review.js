"use strict";
// ANALYSE D'UNE PARTIE (PGN) SUR LE TÉLÉPHONE : chaque coup est jugé par le Stockfish embarqué avec les mêmes règles que le bilan de CHESS (PC) :
// brillant / meilleur / excellent / bon / imprécision / erreur / gaffe, précision, Elo estimé, courbe d'avantage, moments clés, conseils d'ETO.
// Même forme de résultat que /api/mobile/chess/review (play.js n'a donc qu'un seul affichage). Aucun PC, aucun réseau (les conseils rédigés par ETO demandent Groq ; sinon gabarit).
(() => {
  const E = window.ENOS, K = E.brain;
  const MAX_PLIES = 160;
  const uciOf = (m) => m.from + m.to + (m.promotion || "");

  const colorOf = (headers, me, username) => {
    if (me === "w" || me === "b") return me;
    const u = (username || "").trim().toLowerCase(), w = (headers.White || "").trim().toLowerCase(), b = (headers.Black || "").trim().toLowerCase();
    if (u && b === u) return "b";
    if (u && w === u) return "w";
    if (/bot/.test(w) && !/bot/.test(b)) return "b";         // partie contre un bot de Chess.com : l'humain est l'autre camp
    if (/bot/.test(b) && !/bot/.test(w)) return "w";
    return "w";
  };

  function loadOpenings() {
    if (E.learnLib && E.learnLib.root) return Promise.resolve(E.learnLib.root);
    if (!E.learnLib || !E.learnLib.trie) return Promise.resolve(null);
    return new Promise((res) => {
      const done = () => { try { E.learnLib.root = E.learnLib.trie(window.ENOS_OPENINGS); res(E.learnLib.root); } catch (e) { res(null); } };
      if (window.ENOS_OPENINGS) return done();
      const s = document.createElement("script"); s.src = (E.assetBase || "") + "data/learn_openings.js"; s.onload = done; s.onerror = () => res(null); document.head.appendChild(s);
    });
  }

  const adviceFallback = (res) => {
    const rv = res.review, me = rv.me, worst = rv.critical[0];
    let t = `Précision ${me.accuracy} % (≈ ${me.elo} Elo). `;
    t += worst ? `Le moment décisif : coup ${Math.ceil(worst.n / 2)} (${worst.san}), ${worst.label.toLowerCase()} — il fallait jouer ${worst.best || "autre chose"}. ` : "Aucune gaffe majeure : beau travail. ";
    return t + "Avant chaque coup, vérifie ce que ton adversaire menace (échecs, captures, pièces non protégées) : c'est le réflexe qui fait le plus gagner de points.";
  };
  async function advice(res) {
    const rv = res.review, me = rv.me, crit = rv.critical.slice(0, 3), c = me.counts;
    const facts = `Résultat ${res.headers.Result || "?"}. Ouverture : ${res.opening || "non identifiée"}. Précision ${me.accuracy} %, Elo estimé ${me.elo}, perte moyenne ${me.acpl} centipions par coup. Brillants ${c.brilliant || 0}, imprécisions ${c.inaccuracy || 0}, erreurs ${c.mistake || 0}, gaffes ${c.blunder || 0}. `
      + crit.map((x) => `Coup ${Math.ceil(x.n / 2)}: ${x.san} (${x.label}, -${x.loss} cp, mieux était ${x.best || "?"}).`).join(" ");
    try {
      if (E.suite && E.suite.api && E.ai && E.ai.configured()) {
        const t = await E.suite.api.llm({ system: "Tu es ETO, coach d'échecs bienveillant et exigeant. À partir du bilan d'une partie contre un bot, écris 4 à 5 phrases en français, tutoiement : ce qui a bien marché, LES DEUX priorités de travail les plus utiles (concrètes, pas de généralités), puis un exercice à faire. Cite les coups clés. Texte brut sans markdown, sans emoji.", user: facts, maxTokens: 420 });
        if (t && t.trim()) return t.trim();
      }
    } catch (e) { /* repli */ }
    return adviceFallback(res);
  }

  /** o : {pgn, me:"auto"|"w"|"b", username, ms (réflexion par coup), onProgress(0..1)} -> résultat (voir plus haut). */
  K.reviewGame = async (o) => {
    const g = new Chess();
    const text = String(o.pgn || "").trim().slice(0, 60000);
    if (!g.load_pgn(text, { sloppy: true })) throw new Error("PGN illisible : copie la partie en entier depuis Chess.com (Partager › PGN).");
    const headers = g.header(), all = g.history({ verbose: true });
    if (!all.length) throw new Error("PGN illisible : aucun coup trouvé.");
    const meColor = colorOf(headers, o.me, o.username), moves = all.slice(0, MAX_PLIES), ms = o.ms || 320;
    const ch = headers.FEN ? new Chess(headers.FEN) : new Chess();
    const fens = [ch.fen()], judged = [], ucis = [];
    let ev = await K.evaluate(ch.fen(), ms), n = 0, inBook = await K.loadBook();
    for (const mv of moves) {
      n++;
      const color = ch.turn(), before = ch.fen(), uci = uciOf(mv);
      const m = ch.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
      fens.push(ch.fen()); ucis.push(uci);
      let after = await K.evaluate(ch.fen(), ms), j;
      try { j = await K.judge(before, uci, ev, after, color, ms); } catch (e) { j = { q: K.quality(before, uci, ev.w, after.w, color), before: ev, after }; }
      const q = j.q, bestUci = j.before.best, bestSan = bestUci && bestUci !== uci ? K.san(before, bestUci) : "";
      if (bestUci && uci === bestUci && q.key !== "brilliant" && q.loss <= 8) { q.key = "best"; q.label = K.QUALITY.best; }
      if (inBook) {                                                  // théorie : un coup du livre d'ouvertures n'est pas jugé sur une évaluation rapide
        const name = K.inBook(judged.map((x) => x.san).concat(m.san));
        if (name == null) inBook = false;
        else if (q.key !== "brilliant" && q.loss < 250) { q.key = "book"; q.label = K.QUALITY.book; q.opening = name; }
      }
      judged.push({ ...q, n, san: m.san, uci, color, best: bestSan, best_uci: bestUci && bestUci !== uci ? bestUci : "" });
      ev = j.after;
      if (o.onProgress) o.onProgress(n / moves.length);
    }
    const rev = K.buildReview(judged, meColor);
    let opening = "";
    const root = await loadOpenings();
    if (root) {
      const c2 = new Chess(), path = [];
      for (const mv of moves.slice(0, 24)) { c2.move({ from: mv.from, to: mv.to, promotion: mv.promotion }); path.push(mv.san); }
      const nm = E.learnLib.nameAt(root, path);
      if (nm) opening = nm[1];
    }
    rev.critical.forEach((x) => { x.fen_before = fens[x.n - 1]; x.fen_after = fens[x.n]; });
    const res = { review: rev, headers: { White: headers.White || "", Black: headers.Black || "", Result: headers.Result || "", Date: headers.Date || "", Event: headers.Event || "", Site: headers.Site || "" }, me: meColor, opening, fens, uci: ucis, keys: judged.map((j) => j.key), truncated: all.length > MAX_PLIES, judged };
    res.advice = await advice(res);
    return res;
  };
})();
