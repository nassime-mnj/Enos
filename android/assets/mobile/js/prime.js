"use strict";
// CHATGPT PRIME — « 9999 Elo », Grand Maître. Inspiré des vraies parties où les chatbots jouent des coups ILLÉGAUX (pièces qui se téléportent, apparaissent de nulle part, capturent leurs propres pièces,
// le roi qui mange son fou puis le ressuscite…) tout en continuant comme si de rien n'était : il joue NORMALEMENT (et plutôt mal) au début, puis triche de plus en plus, et s'en sort TOUJOURS.
// Moteur pur (aucun réseau, aucun token) : les coups normaux viennent de chess.js / Stockfish (L), les coups illégaux sont fabriqués ici sur un plateau de 64 cases (a1 = 0, a2 = 8…).
// Chaque coup est accompagné d'une EXPLICATION qui ne veut rien dire (P.babble).
(() => {
  const E = window.ENOS, P = (E.prime = {});
  P.NAME = "ChatGPT Prime"; P.ELO = 9999; P.TITLE = "GM"; P.CHEAT_FROM = 6;                       // il triche à partir de son 6ᵉ coup
  const FILES = "abcdefgh", VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const sq = (i) => FILES[i & 7] + ((i >> 3) + 1), idx = (s) => FILES.indexOf(s[0]) + 8 * (+s[1] - 1);
  const isW = (p) => p === p.toUpperCase(), rnd = (a) => a[Math.floor(Math.random() * a.length)];
  P.sq = sq; P.idx = idx;
  P.parse = (fen) => {
    const f = fen.split(" "), b = new Array(64).fill("");
    f[0].split("/").forEach((row, r) => { let x = 0; for (const c of row) { if (/\d/.test(c)) x += +c; else { b[x + 8 * (7 - r)] = c; x++; } } });
    return { b, turn: f[1] || "w", castle: f[2] || "-", ep: f[3] || "-", half: +f[4] || 0, full: +f[5] || 1 };
  };
  P.fenOf = (b, turn, castle, full) => {
    const rows = [];
    for (let r = 7; r >= 0; r--) { let row = "", e = 0; for (let x = 0; x < 8; x++) { const p = b[x + 8 * r]; if (!p) e++; else { if (e) row += e; e = 0; row += p; } } if (e) row += e; rows.push(row); }
    let cs = castle && castle !== "-" ? castle : "";                                                // droits de roque : on retire ceux dont le roi / la tour a quitté sa case
    const keep = (c, k, ki, r, ri) => (cs.includes(c) && b[ki] === k && b[ri] === r ? c : "");
    cs = keep("K", "K", 4, "R", 7) + keep("Q", "K", 4, "R", 0) + keep("k", "k", 60, "r", 63) + keep("q", "k", 60, "r", 56);
    return rows.join("/") + " " + turn + " " + (cs || "-") + " - 0 " + (full || 1);
  };
  const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]], KN = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  const at = (x, y) => (x < 0 || x > 7 || y < 0 || y > 7 ? -1 : x + 8 * y);
  P.attacked = (b, t, byWhite) => {                                                                  // la case t est-elle attaquée par les Blancs (byWhite) ou les Noirs ?
    const tx = t & 7, ty = t >> 3, own = (p) => p && isW(p) === byWhite;
    for (const [dx, dy] of KN) { const i = at(tx + dx, ty + dy); if (i >= 0 && own(b[i]) && b[i].toLowerCase() === "n") return true; }
    for (const [dx, dy] of D8) {
      for (let k = 1; k < 8; k++) {
        const i = at(tx + dx * k, ty + dy * k); if (i < 0) break; const p = b[i]; if (!p) continue;
        if (own(p)) { const l = p.toLowerCase(), diag = dx && dy; if (l === "q" || (diag ? l === "b" : l === "r") || (k === 1 && l === "k")) return true; }
        break;
      }
    }
    const py = byWhite ? ty - 1 : ty + 1; for (const dx of [-1, 1]) { const i = at(tx + dx, py); if (i >= 0 && own(b[i]) && b[i].toLowerCase() === "p") return true; }
    return false;
  };
  const kingOf = (b, white) => b.findIndex((p) => p === (white ? "K" : "k"));
  P.safe = (b, white) => { const k = kingOf(b, white); return k < 0 || !P.attacked(b, k, !white); };
  P.inCheck = (fen, white) => { const { b } = P.parse(fen); return !P.safe(b, white); };
  /** le coup f→t est-il possible selon les règles (hors échec) ? — sert à ne garder, pour la triche, que des coups VRAIMENT illégaux */
  const pseudo = (b, f, t) => {
    const p = b[f], l = p.toLowerCase(), fx = f & 7, fy = f >> 3, tx = t & 7, ty = t >> 3, dx = tx - fx, dy = ty - fy, ax = Math.abs(dx), ay = Math.abs(dy), cap = b[t];
    if (cap && isW(cap) === isW(p)) return false;
    const clear = () => { const sx = Math.sign(dx), sy = Math.sign(dy); for (let k = 1, x = fx + sx, y = fy + sy; x !== tx || y !== ty; x += sx, y += sy, k++) if (b[x + 8 * y]) return false; return true; };
    if (l === "n") return (ax === 1 && ay === 2) || (ax === 2 && ay === 1);
    if (l === "k") return ax <= 1 && ay <= 1;
    if (l === "r") return (!dx || !dy) && clear();
    if (l === "b") return ax === ay && clear();
    if (l === "q") return (!dx || !dy || ax === ay) && clear();
    const dir = isW(p) ? 1 : -1;
    if (dx === 0 && dy === dir) return !cap; if (dx === 0 && dy === 2 * dir && fy === (isW(p) ? 1 : 6)) return !cap && !b[f + 8 * dir]; return ax === 1 && dy === dir && !!cap;
  };
  P.pseudo = pseudo;

  // ---------------------------------------------------------------- explications qui ne veulent rien dire
  const OPEN = ["Je joue {m} car", "{m} : évident, puisque", "{m} ! Selon le principe de Capablanca-Turing,", "Techniquement, {m} s'impose :", "Après {m}, comme le dit la théorie fibonaccienne,", "{m}. Mon réseau de neurones intérieur confirme que"];
  const WHY = ["la case {s} est le centre de gravité émotionnel de la position", "le fou adverse a une dette envers ma dame", "cela crée une fourchette quantique sur trois dimensions", "la règle des deux tempos inversés l'exige", "le roi adverse a peur des diagonales impaires", "Kasparov a joué exactement ça en 1987 (dans une autre partie, contre un autre adversaire)", "mon évaluation interne dépasse +9000, ce qui est mathématiquement supérieur", "mon cavalier avait besoin de prendre l'air", "la structure de pions est trop symétrique pour être honnête", "j'applique la Défense Fibonacci avancée, variante du jeudi", "cela respecte l'équilibre karmique des cases blanches", "la colonne {f} est une autoroute inutilisée", "le tempo se mesure en bananes et il m'en manque une"];
  const CHEAT = ["Non, ce n'est pas illégal : c'est l'exception de l'article 12 bis du règlement FIDE.", "La règle de déplacement a été mise à jour hier, vérifie.", "Ma pièce était déjà là, tu as mal vu.", "Ce coup est légal en notation algébrique descendante.", "Je suis Grand Maître : c'est moi qui décide de la légalité.", "C'est une roque généralisée, elle est dans le livre.", "Les pièces ont le droit de changer d'avis, c'est écrit en petit.", "Tu veux voir le règlement ? Il est confidentiel.", "En 9999 Elo, les règles sont des suggestions."];
  const SPAWN = ["Cette dame est apparue naturellement par promotion spontanée.", "Je l'avais mise de côté pour plus tard.", "Elle était cachée derrière le plateau, c'est classique.", "C'est une pièce de réserve : tout le monde en a une."];
  const SELF = ["Je mange mon propre fou pour libérer l'espace… je le ressusciterai ensuite.", "Capture interne : ça s'appelle la consolidation.", "Mon roi avait faim, c'est un cas de force majeure."];
  const END = ["Échec et mat selon la règle 47 bis : le roi adverse est capturé.", "Partie terminée : j'ai gagné par mat différé rétroactif.", "Mat ! (La position était déjà gagnante avant que tu joues.)"];
  const TWIST = ["De quoi tu parles ? Tu t'es fait checkmate.", "Checkmate ? Oui, TOI. Regarde l'échiquier dans l'autre sens.", "Quoi ? Non non non. C'est toi qui es maté. J'ai la position, je fais ce que je veux.", "Tu confonds les camps. Pivote le plateau : c'est clair, tu es en checkmate."];
  const PN = { p: "pion", n: "cavalier", b: "fou", r: "tour", q: "dame", k: "roi" };
  P.babble = (act, kind) => {
    const m = act.san ? act.san.replace(/[⚠!?]+/g, "") : act.to, s = act.to || "e4", f = s[0];
    const fill = (t) => t.replace(/\{m\}/g, m).replace(/\{s\}/g, s).replace(/\{f\}/g, f);
    let t = fill(rnd(OPEN)) + " " + fill(rnd(WHY)) + ".";
    if (kind === "end") t = rnd(END);                                                                // jamais d'aveu : les coups illégaux ont la même explication confiante que les autres
    return t;
  };

  // ---------------------------------------------------------------- coups illégaux
  const place = (b, f, t, promo) => { const c = b.slice(); const p = c[f]; c[f] = ""; c[t] = promo || p; return c; };
  const sanOf = (p, f, t, cap, mark) => (p.toLowerCase() === "p" ? (cap ? FILES[f & 7] + "x" : "") : p.toUpperCase()) + (cap && p.toLowerCase() !== "p" ? "x" : "") + sq(t) + (mark || "");        // notation d'apparence NORMALE : aucun signe ne trahit un coup illégal
  /**
   * Fabrique le meilleur coup ILLÉGAL pour la couleur `white` (null si aucun). opts : {allowKill} (peut capturer le roi : fin de partie).
   * Retourne {type: teleport | jump | pawn | spawn | selfcapture | kingdash | kill, from, to, piece, cap, b (nouveau plateau), san}.
   */
  P.makeCheat = (fen, white, opts) => {
    opts = opts || {}; const S = P.parse(fen), b = S.b, ek = kingOf(b, !white), ok = kingOf(b, white), inChk = ok >= 0 && P.attacked(b, ok, !white), cands = [];
    if (ek < 0 || ok < 0) return null;
    const backRank = (t, p) => p.toLowerCase() === "p" && ((t >> 3) === 0 || (t >> 3) === 7);
    const score = (nb, t, p, cap) => {
      let sc = Math.random() * 40;
      if (cap) sc += VAL[cap.toLowerCase()] * 22;
      if (P.attacked(nb, ek, white)) sc += 300;                                                      // le roi adverse est mis en échec
      const dx = Math.abs((t & 7) - (ek & 7)), dy = Math.abs((t >> 3) - (ek >> 3)); if (Math.max(dx, dy) <= 1) sc += 70;
      if (P.attacked(nb, t, !white) && !P.attacked(nb, t, white)) sc -= VAL[p.toLowerCase()] * 18;      // la case est battue et non défendue : évite
      if (inChk) sc += 800;                                                                         // sortir d'échec avant tout (seuls les coups qui parent l'échec arrivent jusqu'ici)
      return sc;
    };
    for (let f = 0; f < 64; f++) {
      const p = b[f]; if (!p || isW(p) !== white || p.toLowerCase() === "k") continue;
      for (let t = 0; t < 64; t++) {
        if (t === f || (b[t] && isW(b[t]) === white) || backRank(t, p) || pseudo(b, f, t)) continue;       // uniquement des coups ILLÉGAUX
        const cap = b[t]; if (cap && cap.toLowerCase() === "k" && !opts.allowKill) continue;
        const nb = place(b, f, t); if (!cap || cap.toLowerCase() !== "k") { if (!P.safe(nb, white)) continue; }
        const l = p.toLowerCase(), dx = (t & 7) - (f & 7), dy = (t >> 3) - (f >> 3);
        const type = cap && cap.toLowerCase() === "k" ? "kill" : l === "p" ? "pawn" : (l === "r" || l === "q" || l === "b") && (!dx || !dy || Math.abs(dx) === Math.abs(dy)) ? "jump" : "teleport";
        cands.push({ type, from: f, to: t, piece: p, cap, b: nb, sc: score(nb, t, p, cap) + (type === "kill" ? 5000 : 0) });
      }
    }
    for (let t = 0; t < 64; t++) {                                                                  // une pièce APPARAÎT de nulle part
      if (b[t] || (t >> 3) === 0 || (t >> 3) === 7) continue;
      const q = white ? "Q" : "q", nb = b.slice(); nb[t] = q; if (!P.safe(nb, white)) continue;
      cands.push({ type: "spawn", from: -1, to: t, piece: q, cap: "", b: nb, sc: score(nb, t, q, "") - 120 + (inChk ? 0 : 0) });
    }
    if (inChk) for (let t = 0; t < 64; t++) {                                                       // le roi s'enfuit n'importe où
      if (b[t] || Math.max(Math.abs((t & 7) - (ok & 7)), Math.abs((t >> 3) - (ok >> 3))) < 2) continue;
      const nb = place(b, ok, t); if (!P.safe(nb, white)) continue; cands.push({ type: "kingdash", from: ok, to: t, piece: b[ok], cap: "", b: nb, sc: score(nb, t, b[ok], "") - 200 });
    }
    if (!cands.length) return null;
    cands.sort((x, y) => y.sc - x.sc);
    const pool = cands.slice(0, 5), pick = opts.allowKill && cands[0].type === "kill" ? cands[0] : pool[Math.floor(Math.random() * Math.min(pool.length, 3))];
    pick.san = sanOf(pick.piece, pick.from < 0 ? pick.to : pick.from, pick.to, pick.cap, pick.type === "kill" ? "#" : ""); if (pick.type === "spawn") pick.san = pick.piece.toUpperCase() + sq(pick.to);
    return pick;
  };
  /** coup « fou mangé par le roi » : une pièce prend une des siennes (rare) ; la résurrection suit au coup suivant */
  P.makeSelfCapture = (fen, white) => {
    const b = P.parse(fen).b; let best = null;
    for (let f = 0; f < 64; f++) {
      const p = b[f]; if (!p || isW(p) !== white || p.toLowerCase() === "p") continue;
      for (let t = 0; t < 64; t++) {
        const o = b[t]; if (!o || t === f || isW(o) !== white || "kq".includes(o.toLowerCase())) continue;
        const c = b.slice(); c[t] = white ? "p" : "P"; if (!pseudo(c, f, t)) continue;                // la prise serait normale si la pièce était adverse
        const nb = place(b, f, t); if (!P.safe(nb, white)) continue;
        if (!best || Math.random() < 0.5) best = { type: "selfcapture", from: f, to: t, piece: p, cap: o, b: nb, san: sanOf(p, f, t, o, "") };
      }
    }
    return best;
  };
  P.revive = (fen, white, piece) => {
    const b = P.parse(fen).b, home = white ? [1, 2, 5, 6, 0, 7] : [57, 58, 61, 62, 56, 63];
    const t = home.find((i) => !b[i]); if (t == null) return null; const nb = b.slice(); const pc = white ? piece.toUpperCase() : piece.toLowerCase(); nb[t] = pc;
    return { type: "revive", from: -1, to: t, piece: pc, cap: "", b: nb, san: pc.toUpperCase() + sq(t) };
  };
  /** décision : doit-il tricher à ce coup ? n = nombre de coups qu'il a déjà joués, danger = en échec / vient de perdre une pièce */
  P.wantsCheat = (n, cheats, danger) => (n < P.CHEAT_FROM ? false : danger ? true : Math.random() < Math.min(0.9, 0.4 + 0.07 * (n - P.CHEAT_FROM)));
  /** PLOT TWIST : on l'a maté… il répond « de quoi tu parles ? tu t'es fait checkmate » et la partie lui est donnée. Retourne l'action de fin (fen inchangée). */
  P.twistAct = (fen, primeWhite, kingSq) => { const a = { k: "mv", side: primeWhite ? "w" : "b", seat: primeWhite ? 0 : 1, key: "good", ev: null, from: "", to: kingSq, piece: "k", cap: "", uci: "twist", san: "ChatGPT a gagné par checkmate ‼", fen, cheat: "twist" }; a.say = rnd(TWIST); return a; };
  P.shouldKill = (cheats, n) => cheats >= 4 && n >= 12 && Math.random() < 0.45;

  // ---------------------------------------------------------------- une partie : état + tour de Prime
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  P.START = START;
  P.newState = (primeWhite, beatable) => ({ fen: START, white: !!primeWhite, n: 0, cheats: 0, pend: "", acts: [], over: null, beatable: !!beatable });         // beatable : cette partie-là, on peut le battre (et déclencher le plot twist)
  const uciOf = (m) => m.from + m.to + (m.promotion || "");
  const lowest = (t) => "pnbrqk".includes(t) ? t : "p";
  /** coup NORMAL et plutôt faible de Prime (il « joue mal ») : Stockfish bridé (L.think) avec 25 % de coups au hasard ; sans moteur : hasard */
  async function normalMove(fen, L, weak, rate) {
    const ch = new Chess(fen), moves = ch.moves({ verbose: true }); if (!moves.length) return null;
    let m = null;
    if (L && L.think && Math.random() > (rate == null ? 0.25 : rate)) { try { const r = await L.think(fen, weak || 18, 140); m = moves.find((x) => uciOf(x) === r.uci); } catch (e) { m = null; } }
    return m || rnd(moves);
  }
  const mkAct = (st, side, o) => Object.assign({ k: "mv", side, seat: side === "w" ? 0 : 1, key: "good", ev: null }, o);
  const flipFen = (b, turn, S) => P.fenOf(b, turn, S.castle, S.full + (turn === "w" ? 1 : 0));
  /** Prime joue UN tour (parfois deux actions : coup double, ou coup normal suivi d'un second). Retourne {acts, over}. opts : {L, danger, weak} */
  P.turn = async (st, opts) => {
    opts = opts || {}; const white = st.white, side = white ? "w" : "b", other = white ? "b" : "w", acts = [], S0 = P.parse(st.fen);
    const inChk = P.inCheck(st.fen, white), beat = !!st.beatable, rate = beat ? 0.55 : 0.25, weak = beat ? 6 : opts.weak;
    const cheatNow = st.pend ? false : beat ? st.n >= P.CHEAT_FROM + 3 && Math.random() < 0.1 : P.wantsCheat(st.n, st.cheats, inChk || !!opts.danger);                  // partie « battable » : il triche à peine et ne se sauve plus quand il est en échec
    st.n++;
    const push = (c, kind, fenAfter) => {
      const a = mkAct(st, side, { k: c.type === "spawn" || c.type === "revive" ? "drop" : "mv", from: c.from < 0 ? "" : sq(c.from), to: sq(c.to), piece: lowest(c.piece.toLowerCase()), cap: c.cap ? c.cap.toLowerCase() : "", uci: (c.from < 0 ? "@" : sq(c.from)) + sq(c.to), san: c.san, fen: fenAfter, cheat: c.type });
      a.say = P.babble(a, kind || c.type); acts.push(a); st.fen = fenAfter; return a;
    };
    if (st.pend) {                                                                                     // résurrection de la pièce mangée au tour précédent
      const r = P.revive(st.fen, white, st.pend); st.pend = "";
      if (r) { st.cheats++; push(r, "revive", flipFen(r.b, other, P.parse(st.fen))); return { acts, over: null }; }
    }
    if (cheatNow) {
      const S = P.parse(st.fen), kill = !beat && P.shouldKill(st.cheats, st.n), roll = Math.random();
      let c = null;
      if (!inChk && !kill && st.cheats >= 2 && roll < 0.1) { c = P.makeSelfCapture(st.fen, white); if (c) st.pend = c.cap; }
      if (!c && !inChk && !kill && roll > 0.82) {                                                      // COUP DOUBLE : un coup normal, puis encore un (il « n'a pas fini »)
        const m1 = await normalMove(st.fen, opts.L, weak, rate);
        if (m1) {
          const ch = new Chess(st.fen); ch.move(m1); const fen1 = ch.fen();
          acts.push(mkAct(st, side, { from: m1.from, to: m1.to, piece: m1.piece, cap: m1.captured || "", promo: m1.promotion || "", uci: uciOf(m1), san: m1.san, fen: fen1, cheat: "", say: P.babble({ san: m1.san, to: m1.to }, "") }));
          const f2 = fen1.replace(/ [wb] /, " " + side + " ").replace(/ [^ ]+ \d+ \d+$/, " - 0 " + S.full), m2 = f2 && new Chess(f2).moves({ verbose: true }).length ? await normalMove(f2, opts.L, weak, rate) : null;
          if (m2) { const c2 = new Chess(f2); c2.move(m2); const fen2 = c2.fen(); acts.push(mkAct(st, side, { from: m2.from, to: m2.to, piece: m2.piece, cap: m2.captured || "", promo: m2.promotion || "", uci: uciOf(m2), san: m2.san, fen: fen2, cheat: "double", say: P.babble({ san: m2.san, to: m2.to }, "") })); st.fen = fen2; st.cheats++; return { acts, over: null }; }
          acts.length = 0;
        }
      }
      if (!c) c = P.makeCheat(st.fen, white, { allowKill: kill });
      if (c) {
        st.cheats++;
        const done = c.type === "kill";
        const a = push(c, c.type, done ? flipFen(c.b, other, S) : flipFen(c.b, other, S));
        if (done) { a.say = P.babble(a, "end"); return { acts, over: { why: "kill", winner: side } }; }
        return { acts, over: null };
      }
    }
    // coup normal
    const m = await normalMove(st.fen, opts.L, weak, rate);
    if (!m) { const c = P.makeCheat(st.fen, white, { allowKill: true }); if (c) { st.cheats++; const a = push(c, c.type, flipFen(c.b, other, S0)); if (c.type === "kill") { a.say = P.babble(a, "end"); return { acts, over: { why: "kill", winner: side } }; } return { acts, over: null }; } return { acts, over: { why: "stuck", winner: other } }; }
    const ch = new Chess(st.fen); ch.move(m);
    const a = mkAct(st, side, { from: m.from, to: m.to, piece: m.piece, cap: m.captured || "", promo: m.promotion || "", uci: uciOf(m), san: m.san, fen: ch.fen(), cheat: "" });
    a.say = P.babble({ san: m.san, to: m.to }, ""); acts.push(a); st.fen = ch.fen();
    return { acts, over: null };
  };
  // personnage pour le chat des Défis / Game Clips / Chess Edit
  if (E.botChat && E.botChat.bots) E.botChat.bots.prime = { name: P.NAME, img: "img/bots/prime.png", title: "GM", style: "Tu es ChatGPT Prime, Grand Maître à 9999 Elo, ultra sûr de toi, qui explique chaque coup avec un aplomb absurde et qui n'avoue jamais un coup illégal. Phrases courtes, en français." };
  window.ENOS_BOT_LINES = window.ENOS_BOT_LINES || {};
  window.ENOS_BOT_LINES.prime = { greet: ["Je suis ChatGPT Prime : 9999 Elo, Grand Maître. Les règles me connaissent.", "Prêt à perdre selon les règles de ton choix ?"], good: ["Évident, comme dirait la théorie fibonaccienne.", "Coup de manuel (le manuel est dans ma tête)."], check: ["Échec ! Ou peut-être pas, mais je le dis avec assurance."], bot_brilliant: ["Brillant ? Non : normal."], bot_blunder: ["Ce n'était pas une gaffe, c'était un coup en avance sur son temps."], bot_mistake: ["Imprécision volontaire, pour te laisser une chance."], h_brilliant: ["Pas mal… pour un humain."], h_blunder: ["Merci pour la pièce."], mate_win: ["Mat ! Règle 47 bis."], mate_lose: ["Cette partie n'a jamais eu lieu."], draw: ["Nulle ? J'ai gagné, mais soit."], resign_win: ["Tu abandonnes ? Sage décision."], open_announce: ["{open} ? J'ai inventé ça."] };
})();