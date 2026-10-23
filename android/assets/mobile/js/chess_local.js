"use strict";
// ÉCHECS AUTONOMES : règles = chess.js, moteur = Stockfish.js 10 (asm.js) dans un Worker blob. Aucun PC, aucun réseau.
// Même forme de réponses que le service /api/mobile/chess/* du PC, pour que play.js n'ait qu'un seul chemin.
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
        w.postMessage("setoption name Skill Level value " + skillOf(power));
        w.postMessage("position fen " + fen);
        w.postMessage("go movetime " + (ms || timeOf(power)));
      });
    });
    queue = job.catch(() => {});
    return job;
  };

  const uciOf = (m) => m.from + m.to + (m.promotion || "");
  const legal = (ch) => ch.moves({ verbose: true }).map(uciOf);
  const evalOf = (r) => (r.mate != null ? { mate: r.mate } : { cp: r.cp == null ? 0 : r.cp });

  function overOf(ch) {
    if (ch.in_checkmate()) return "Échec et mat — " + (ch.turn() === "w" ? "les Noirs" : "les Blancs") + " gagnent";
    if (ch.in_stalemate()) return "Pat — partie nulle";
    if (ch.insufficient_material()) return "Matériel insuffisant — nulle";
    if (ch.in_threefold_repetition()) return "Triple répétition — nulle";
    if (ch.in_draw()) return "Partie nulle";
    return "";
  }

  const snapshot = (ch) => ({ fen: ch.fen(), legal: legal(ch), check: ch.in_check(), over: overOf(ch) });

  function playUci(ch, uci) {
    const m = ch.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    if (!m) throw new Error("Coup illégal");
    return m;
  }

  async function reply(ch, power) {
    const r = await L.think(ch.fen(), power);
    if (!r.uci) return null;
    const m = playUci(ch, r.uci);
    return { san: m.san, uci: uciOf(m), eval: evalOf(r) };
  }

  /** Routes imitées de /api/mobile/chess/{state,play,engine,hint} */
  L.call = async (path, body) => {
    const ch = new Chess(body.fen);
    if (path.endsWith("/state")) return snapshot(ch);
    if (path.endsWith("/hint")) {
      const r = await L.think(ch.fen(), 100, 700);
      const m = ch.move({ from: r.uci.slice(0, 2), to: r.uci.slice(2, 4), promotion: r.uci[4] });
      return { uci: r.uci, san: m.san };
    }
    if (path.endsWith("/engine")) {
      const rep = await reply(ch, body.power);
      return { ...snapshot(ch), reply: rep, eval: rep && rep.eval };
    }
    if (path.endsWith("/play")) {
      const m = playUci(ch, body.uci);
      let rep = null;
      if (body.answer && !ch.game_over()) rep = await reply(ch, body.power);
      return { san: m.san, ...snapshot(ch), reply: rep, eval: rep && rep.eval };
    }
    throw new Error("Route d'échecs inconnue");
  };
})();
