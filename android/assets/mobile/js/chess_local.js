"use strict";
// ÉCHECS AUTONOMES : règles = chess.js, moteur = Stockfish.js 10 (asm.js) dans un Worker blob. Aucun PC, aucun réseau.
// Même forme de réponses que le service /api/mobile/chess/* du PC, pour que play.js n'ait qu'un seul chemin.
// PAS DE NULLE PAR RÉPÉTITION, PAS DE DÉFAITE OFFERTE (même règle que nasko_nodraw.py sur le PC) :
//   - `seen` = {position: nombre de passages} de la partie (clé = FEN sans les compteurs) ; un coup qui ramène une position déjà vue est écarté tant qu'une alternative tient la partie ;
//   - à pleine puissance, un COUP BRILLANT trouvé par Stockfish (sacrifice de pièce qui rapporte, en MultiPV) passe avant tout.
(() => {
  const E = window.ENOS;
  const L = (E.chessLocal = {});
  let worker = null, ready = null, queue = Promise.resolve();

  function start() {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      try {
        worker = new Worker(URL.createObjectURL(new Blob([window.ENOS_SF], { type: "text/javascript" })));
      } catch (e) { ready = null; return reject(new Error("Moteur d'échecs indisponible : " + e.message)); }
      worker.onerror = (e) => { ready = null; reject(new Error("Moteur d'échecs : " + (e.message || "erreur"))); };
      const onMsg = (e) => { if (String(e.data).trim() === "readyok") { worker.removeEventListener("message", onMsg); resolve(worker); } };
      worker.addEventListener("message", onMsg);
      worker.postMessage("uci");
      worker.postMessage("isready");
    });
    return ready;
  }

  // power 1..100 -> Skill Level 0..20 et temps de réflexion
  const skillOf = (power) => Math.max(0, Math.min(20, Math.round(((power || 50) - 1) / 99 * 20)));
  const timeOf = (power) => Math.round(250 + (power || 50) * 9);
  const MAT = 10000;

  /** Meilleur coup pour `fen`. Retourne {uci, cp (point de vue des Blancs) | mate}. Les requêtes sont sérialisées. */
  L.think = (fen, power, ms) => {
    const job = queue.then(async () => {
      const w = await start();
      return new Promise((resolve) => {
        const white = fen.split(" ")[1] !== "b";
        let score = null;
        const onMsg = (e) => {
          const line = String(e.data);
          const m = line.match(/score (cp|mate) (-?\d+)/);
          if (m && !/lowerbound|upperbound/.test(line)) score = { kind: m[1], v: +m[2] * (white ? 1 : -1) };
          if (line.startsWith("bestmove")) {
            w.removeEventListener("message", onMsg);
            const uci = line.split(" ")[1];
            resolve({ uci: uci === "(none)" ? "" : uci, cp: score && score.kind === "cp" ? score.v : null, mate: score && score.kind === "mate" ? score.v : null });
          }
        };
        w.addEventListener("message", onMsg);
        w.postMessage("setoption name MultiPV value 1");
        w.postMessage("setoption name Skill Level value " + skillOf(power));
        w.postMessage("position fen " + fen);
        w.postMessage("go movetime " + (ms || timeOf(power)));
      });
    });
    queue = job.catch(() => {});
    return job;
  };

  /** Les `n` meilleures lignes (MultiPV, pleine puissance), du point de vue du camp au trait, meilleure d'abord : [{uci, pv:[uci…], cp, mate}] (mate > 0 : le camp au trait mate). */
  L.lines = (fen, n, ms) => {
    const job = queue.then(async () => {
      const w = await start();
      return new Promise((resolve) => {
        const best = {};
        const onMsg = (e) => {
          const line = String(e.data);
          if (line.startsWith("info") && / score (cp|mate) /.test(line) && !/lowerbound|upperbound/.test(line) && / pv /.test(line)) {
            const k = +((line.match(/ multipv (\d+)/) || [0, 1])[1]), d = +((line.match(/ depth (\d+)/) || [0, 0])[1]);
            const m = line.match(/ score (cp|mate) (-?\d+)/), pv = line.split(" pv ")[1].trim().split(/\s+/);
            if (!best[k] || d >= best[k].d) {
              const v = +m[2], mate = m[1] === "mate" ? v : null;
              best[k] = { d, uci: pv[0], pv, mate: mate !== null && mate > 0 ? mate : null, cp: mate === null ? v : (mate > 0 ? MAT - mate : -MAT - mate) };
            }
          }
          if (line.startsWith("bestmove")) {
            w.removeEventListener("message", onMsg);
            w.postMessage("setoption name MultiPV value 1");
            resolve(Object.keys(best).map(Number).sort((a, b) => a - b).map((k) => best[k]));
          }
        };
        w.addEventListener("message", onMsg);
        w.postMessage("setoption name Skill Level value 20");
        w.postMessage("setoption name MultiPV value " + Math.max(1, n));
        w.postMessage("position fen " + fen);
        w.postMessage("go movetime " + (ms || 900));
      });
    });
    queue = job.catch(() => {});
    return job;
  };

  const uciOf = (m) => m.from + m.to + (m.promotion || "");
  const legal = (ch) => ch.moves({ verbose: true }).map(uciOf);
  const keyOf = (fen) => fen.split(" ").slice(0, 4).join(" ");
  const asMove = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  L.keyOf = keyOf;
  L.addSeen = (seen, fen) => { const k = keyOf(fen), s = { ...seen }; s[k] = (s[k] || 0) + 1; return s; };
  L.startSeen = (fen) => L.addSeen({}, fen);

  function overOf(ch, seen) {
    if (ch.in_checkmate()) return "Échec et mat — " + (ch.turn() === "w" ? "les Noirs" : "les Blancs") + " gagnent";
    if (ch.in_stalemate()) return "Pat — partie nulle";
    if (ch.insufficient_material()) return "Matériel insuffisant — nulle";
    if (seen && (seen[keyOf(ch.fen())] || 0) >= 3) return "Triple répétition — nulle";
    if (ch.in_threefold_repetition()) return "Triple répétition — nulle";
    if (ch.in_draw()) return "Partie nulle";
    return "";
  }

  const snapshot = (ch, seen) => ({ fen: ch.fen(), legal: legal(ch), check: ch.in_check(), over: overOf(ch, seen) });

  // ------------------------------------------------------------------ pas de nulle, pas de défaite (port de nasko_nodraw.py)
  const FIFTY_GUARD = 88;
  /** Raison pour laquelle `uci` mène à une nulle (ou s'en approche), sinon "". */
  const drawAfter = (fen, uci, seen) => {
    const ch = new Chess(fen);
    if (!ch.move(asMove(uci))) return "illégal";
    if (ch.in_checkmate()) return "";
    if (ch.in_stalemate()) return "pat";
    if (ch.insufficient_material()) return "matériel insuffisant";
    const after = ch.fen();
    if ((seen[keyOf(after)] || 0) >= 1) return "répétition";
    if (+after.split(" ")[4] >= FIFTY_GUARD) return "50 coups";
    return "";
  };
  const slack = (cp) => (cp >= 500 ? 350 : cp >= 150 ? 150 : cp >= -50 ? 70 : cp >= -150 ? 30 : 0);
  L.drawAfter = drawAfter;
  L.slack = slack;

  /** Coup à jouer : {uci, why} (why non vide = `def` remplacé pour éviter une nulle). `more` : renfort de lignes (async), appelé seulement si toutes les lignes connues mènent à une nulle. */
  async function pick(fen, lines, def, seen, more) {
    if (!lines.length) return { uci: def, why: "" };
    const top = lines[0];
    def = def || top.uci;
    if (top.mate) return { uci: top.uci, why: "" };                               // un mat forcé n'est jamais échangé
    const why = drawAfter(fen, def, seen);
    if (!why) return { uci: def, why: "" };
    const floor = top.cp - slack(top.cp);
    let pool = lines;
    for (let attempt = 0; attempt < 2; attempt++) {
      const alt = pool.slice().sort((a, b) => b.cp - a.cp).find((ln) => ln.uci !== def && ln.cp >= floor && !drawAfter(fen, ln.uci, seen));
      if (alt) return { uci: alt.uci, why };
      if (attempt === 0 && more) {
        try { const extra = await more(); pool = lines.concat(extra.filter((x) => !lines.some((l) => l.uci === x.uci))); } catch (e) { break; }
      } else break;
    }
    return { uci: def, why: "" };                                                   // aucune alternative qui tienne la partie : la nulle vaut mieux que perdre
  }
  L.pick = pick;

  // ------------------------------------------------------------------ coup brillant : sacrifice qui rapporte (port de nasko_chess._sacrifice_of)
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const PIECE_FR = { n: "cavalier", b: "fou", r: "tour", q: "dame" };
  const material = (ch, color) => ch.board().flat().reduce((s, p) => s + (p && p.color === color ? VAL[p.type] : 0), 0);
  const net = (ch, color) => material(ch, color) - material(ch, color === "w" ? "b" : "w");
  function sacrificeOf(fen, pv) {
    if (pv.length < 2) return null;
    const ch = new Chess(fen), color = ch.turn(), base = net(ch, color);
    if (!ch.move(asMove(pv[0]))) return null;
    const lost = (ch.get(pv[1].slice(2, 4)) || {}).type;
    const m2 = ch.move(asMove(pv[1]));
    if (!m2 || m2.flags.includes("e") || !PIECE_FR[lost]) return null;
    const d2 = base - net(ch, color);
    let d3 = d2;
    if (pv.length >= 3 && ch.move(asMove(pv[2]))) d3 = base - net(ch, color);
    return d2 >= 2 && d3 >= 1 ? { piece: PIECE_FR[lost], deficit: d2 } : null;
  }
  L.sacrificeOf = sacrificeOf;
  const BRILL_MIN_CP = 200, BRILL_MAX_LOSS = 200;

  function tension(fen, uci) {
    const ch = new Chess(fen), m = ch.move(asMove(uci));
    return m ? (ch.in_check() ? 2 : 0) + (m.flags.includes("c") || m.flags.includes("e") ? 1 : 0) : 0;
  }

  /**
   * Coup de l'ordinateur. opts : {brilliant (def. vrai à pleine puissance), taste (ETO : préfère la ligne tactique), pure (Stockfish brut : aucun filtre), ms}.
   * Retourne {uci, cp, mate (point de vue des Blancs), brilliant:{piece,deficit,cp,mate}|null, dodged:"répétition"|…|""} ou null (aucun coup légal).
   */
  const outFor = (fen) => {                                                         // lignes (point de vue du camp au trait) -> résultat (point de vue des Blancs)
    const sg = fen.split(" ")[1] !== "b" ? 1 : -1;
    return (uci, cp, mate, extra) => ({ uci, cp: mate ? null : cp * sg, mate: mate ? mate * sg : null, brilliant: null, dodged: "", ...extra });
  };

  L.choose = async (fen, power, seen, opts) => {
    opts = opts || {};
    const out = outFor(fen);
    const strong = (power || 50) >= 85 && !opts.pure;
    if (opts.pure || !strong) {
      const r = await L.think(fen, opts.pure ? 100 : power, opts.ms);
      if (!r.uci) return null;
      const mv = { uci: r.uci, cp: r.cp, mate: r.mate };                             // think(): déjà du point de vue des Blancs
      if (opts.pure) return { ...mv, brilliant: null, dodged: "" };
      const why = drawAfter(fen, r.uci, seen);
      if (!why) return { ...mv, brilliant: null, dodged: "" };
      const lines = await L.lines(fen, 6, 700);
      const p = await pick(fen, lines, r.uci, seen, () => L.lines(fen, 10, 900));
      return p.uci === r.uci ? { ...mv, brilliant: null, dodged: "" } : out(p.uci, (lines.find((l) => l.uci === p.uci) || {}).cp || 0, 0, { dodged: p.why });
    }
    return L.decide(fen, await L.lines(fen, 4, opts.ms || Math.max(900, timeOf(power))), seen, opts);
  };

  /** Même choix à partir de lignes MultiPV DÉJÀ calculées (entraînement : évite une 2e recherche). opts : {brilliant, taste}. */
  L.decide = async (fen, lines, seen, opts) => {
    opts = opts || {};
    const out = outFor(fen);
    if (!lines.length) return null;
    const top = lines[0];
    let uci = top.uci, brilliant = null, cp = top.cp, mate = top.mate;
    if (opts.brilliant !== false) {
      const cands = [];
      for (const ln of lines) {
        const sac = sacrificeOf(fen, ln.pv);
        if (!sac || drawAfter(fen, ln.uci, seen)) continue;
        const decisive = ln.mate || ln.cp >= BRILL_MIN_CP, keeps = (!top.mate && top.cp - ln.cp <= BRILL_MAX_LOSS) || (top.mate && ln.mate);
        if (decisive && keeps) cands.push({ ln, sac });
      }
      cands.sort((a, b) => (b.ln.mate ? 1 : 0) - (a.ln.mate ? 1 : 0) || b.ln.cp - a.ln.cp || b.sac.deficit - a.sac.deficit);
      if (cands.length) { const c = cands[0]; uci = c.ln.uci; cp = c.ln.cp; mate = c.ln.mate; brilliant = { ...c.sac, cp: c.ln.cp, mate: c.ln.mate }; }
    }
    if (!brilliant && opts.taste && !top.mate && top.cp > -150 && top.cp < 600) {
      const near = lines.filter((l) => top.cp - l.cp <= 25 && !l.mate);
      near.sort((a, b) => tension(fen, b.uci) - tension(fen, a.uci) || b.cp - a.cp);
      if (near.length) { uci = near[0].uci; cp = near[0].cp; mate = null; }
    }
    const p = await pick(fen, lines, uci, seen, () => L.lines(fen, 10, 900));
    if (p.uci !== uci) {                                                            // coup remplacé : plus le sacrifice annoncé
      const ln = lines.find((l) => l.uci === p.uci);
      return out(p.uci, ln ? ln.cp : cp, ln ? ln.mate : 0, { dodged: p.why });
    }
    return out(uci, cp, mate, { brilliant });
  };

  const evalOf = (r) => (r.mate != null ? { mate: r.mate } : { cp: r.cp == null ? 0 : r.cp });

  function playUci(ch, uci) {
    const m = ch.move(asMove(uci));
    if (!m) throw new Error("Coup illégal");
    return m;
  }

  async function reply(ch, power, seen) {
    const r = await L.choose(ch.fen(), power, seen);
    if (!r || !r.uci) return null;
    const m = playUci(ch, r.uci);
    return { san: m.san, uci: uciOf(m), eval: evalOf(r), brilliant: r.brilliant, dodged: r.dodged };
  }

  /** Routes imitées de /api/mobile/chess/{state,play,engine,hint}. body.seen : passages de chaque position de la partie (play.js) ; la réponse renvoie `seen` mis à jour. */
  L.call = async (path, body) => {
    const ch = new Chess(body.fen);
    let seen = body.seen || L.startSeen(body.fen);
    if (path.endsWith("/state")) return { ...snapshot(ch, seen), seen };
    if (path.endsWith("/hint")) {
      const lines = await L.lines(ch.fen(), 3, 800);
      const p = await pick(ch.fen(), lines, null, seen, null);
      const m = ch.move(asMove(p.uci));
      return { uci: p.uci, san: m.san };
    }
    if (path.endsWith("/engine")) {
      const rep = await reply(ch, body.power, seen);
      if (rep) seen = L.addSeen(seen, ch.fen());
      return { ...snapshot(ch, seen), reply: rep, eval: rep && rep.eval, seen };
    }
    if (path.endsWith("/play")) {
      const m = playUci(ch, body.uci);
      seen = L.addSeen(seen, ch.fen());
      let rep = null;
      if (body.answer && !overOf(ch, seen)) { rep = await reply(ch, body.power, seen); if (rep) seen = L.addSeen(seen, ch.fen()); }
      return { san: m.san, ...snapshot(ch, seen), reply: rep, eval: rep && rep.eval, seen };
    }
    throw new Error("Route d'échecs inconnue");
  };
})();
