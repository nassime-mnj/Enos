"use strict";
// GAME CLIPS — « scènes de théâtre » : une partie MISE EN SCÈNE entre un HÉROS et un ANTAGONISTE, faite pour le Chess Edit.
//   Le héros joue comme ETO Brillant (chasse aux sacrifices brillants, K.etoMove). L'antagoniste joue des coups plausibles (parmi les 5 meilleurs lignes de Stockfish, jamais une gaffe grossière
//   dans l'ouverture) mais choisit, à chaque fois, celui qui OFFRE AU HÉROS le plus beau coup : pour chaque candidat on demande à Stockfish (K.hunt) ce que le héros peut y trouver
//   (sacrifices brillants, mat, dame/tour sacrifiée) et on garde le « cadeau » le plus spectaculaire pour le moins de perte. Quand le héros a gagné assez de spectacle, l'antagoniste joue
//   les meilleurs coups et le héros conclut. La partie est enregistrée comme une partie des Défis (defi.hist, clip: {…}) : le Chess Edit la prend comme n'importe quelle autre.
(() => {
  const E = window.ENOS;
  const C = (E.clips = {});
  const FALL = { nasko: "Nasko", penoire: "Nasko (pénoire)", lelex: "Lelex", naskurieux: "Naskurieux", ghorghor: "GhorGhor", naskolit: "Naskolit", jester: "Le Jester", eto: "ETO", enos: "E.N.O.S.", stockfish: "Stockfish 19", prime: "ChatGPT Prime" };
  // TOUS les bots : personnages, ETO / E.N.O.S. / Stockfish / Prime + bots IA et moteurs (Claude, GPT, Gemini, DeepSeek, Lc0, Maia ×3, Ethereal, Berserk, Koivisto) — liste calculée à l'usage
  Object.defineProperty(C, "BOTS", { get: () => Object.keys(FALL).concat(((E.aiBots && E.aiBots.ids) || []).filter((id) => !(id in FALL))) });
  C.nameOf = (id) => (E.botChat && E.botChat.bots[id] ? E.botChat.bots[id].name : (E.aiBots && E.aiBots.def[id] ? E.aiBots.def[id].name : FALL[id] || id));
  /** TOUS les bots de la plateforme (sélecteur commun) */
  C.ALL = () => (E.botPick ? E.botPick.all().map((x) => x.id) : C.BOTS);
  C.INTENSITY = { subtle: { tol: 120, goal: 2, label: "Subtil" }, normal: { tol: 260, goal: 3, label: "Normal" }, theatre: { tol: 480, goal: 5, label: "Théâtral" } };
  C.LENGTH = { short: 36, normal: 56, long: 84 };
  C.TIMES = {
    fast: { think: 250, heroTop: 350, heroSac: 700, antLines: 350, antTop: 200, antSac: 350, evalMs: 200 },
    careful: { think: 600, heroTop: 1000, heroSac: 1800, antLines: 800, antTop: 450, antSac: 800, evalMs: 450 },
  };
  /** OUVERTURES MISES EN SCÈNE : un bot « Nasko » (ou variante) jouant les Blancs sort l'ALIEN GAMBIT (Caro-Kann, 5.Cg5 h6 6.Cxf7 : le sacrifice du cavalier = coup BRILLANT) ; Lelex / GhorGhor jouant les Noirs sortent la SCANDINAVE. */
  const NASKO = new Set(["nasko", "penoire", "naskurieux", "naskolit"]), SCAND_BOTS = new Set(["lelex", "ghorghor"]);
  C.ALIEN = ["e2e4", "c7c6", "d2d4", "d7d5", "b1c3", "d5e4", "c3e4", "g8f6", "e4g5", "h7h6", "g5f7"];          // le 11e demi-coup (Cxf7) est le sacrifice brillant
  C.SCAND = ["e2e4", "d7d5", "e4d5", "d8d5", "b1c3", "d5a5"];
  C.openingFor = (whiteId, blackId) => (NASKO.has(whiteId) ? { id: "alien", name: "Alien Gambit", moves: C.ALIEN, brilliantAt: 11 } : SCAND_BOTS.has(blackId) ? { id: "scand", name: "Défense scandinave", moves: C.SCAND } : null);
  const MAT = 10000, pick = (a) => a[Math.floor(Math.random() * a.length)];
  const line = (id, cat, d) => {
    const L = (window.ENOS_BOT_LINES || {})[id === "ghorghor" && d && d.real ? "ghorreal" : id] || null, list = L && L[cat];
    if (!list || !list.length) return "";
    return String(pick(list)).replace(/\{me\}/g, (d && d.me) || "toi").replace(/\{san\}/g, (d && d.san) || "ce coup").replace(/\{elo\}/g, "").replace(/\{open\}/g, (d && d.open) || "cette ouverture");
  };
  const scoreOf = (ln) => (ln.mate != null ? (ln.mate > 0 ? MAT - ln.mate : -MAT - ln.mate) : ln.cp || 0);       // point de vue du camp au trait

  /**
   * Tourne une scène. o : {hero, ant, heroColor: "w"|"b", intensity, length, quality: "fast"|"careful", times?, maxPlies?}
   * onStep({fen, san, ply, uci, role: "hero"|"ant", key, gift, ev, brilliants, gifts, say}) après chaque coup ; ctl = {stop: bool} (stop = terminer maintenant).
   * Retourne l'enregistrement (même format que defi.hist) ou null si moins de 2 coups.
   */
  C.run = async (o, onStep, ctl) => {
    if (o.hero === "prime" || o.ant === "prime") return C.runPrime(o, onStep, ctl);
    const K = E.brain, L = E.chessLocal; ctl = ctl || {};
    if (!K || !L) throw new Error("Stockfish n'est pas disponible ici.");
    const T = o.times || C.TIMES[o.quality || "fast"], I = C.INTENSITY[o.intensity || "normal"], maxPlies = o.maxPlies || C.LENGTH[o.length || "normal"];
    const hero = o.hero, ant = o.ant, hc = o.heroColor || "w", names = { [hc]: C.nameOf(hero), [hc === "w" ? "b" : "w"]: C.nameOf(ant) };
    const ch = new Chess(), mv = [], chat = [];
    let brilliants = 0, gifts = 0, lastTalk = -9, heroEval = 0;
    await K.loadBook().catch(() => false);
    const opn = C.openingFor(hc === "w" ? hero : ant, hc === "w" ? ant : hero); let alienPly = 0;
    const say = (bot, cat, ply, d, force) => {                                                      // réplique pré-écrite (jamais plus d'une tous les 3 coups, sauf moments forts)
      if (!force && ply - lastTalk < 3) return "";
      const t = line(bot, cat, d); if (!t) return "";
      chat.push([ply, bot, t, cat]); lastTalk = ply; return t;
    };
    say(hero, "greet", 1, { me: C.nameOf(ant) }, true);
    while (!ch.game_over() && ch.history().length < maxPlies + 30 && !ctl.stop) {
      const fen = ch.fen(), n = ch.history().length, turn = ch.turn(), isHero = turn === hc;
      if (n >= maxPlies && heroEval < 900) break;
      let uci = "", key = "good", loss = 0, gift = false, bestSan = "";
      const scripted = opn && n < opn.moves.length ? opn.moves[n] : "";
      if (scripted && ch.moves({ verbose: true }).some((x) => x.from + x.to + (x.promotion || "") === scripted)) {
        uci = scripted; key = "book";
        if (opn.brilliantAt === n + 1) { key = "brilliant"; alienPly = n + 1; if (isHero) brilliants++; }                // sacrifice du cavalier de l'Alien Gambit : brillant imposé
      } else if (isHero) {
        if (n < 6) { const r = await L.think(fen, 100, T.think); uci = r.uci; key = "book"; }
        else { const r = await K.etoMove(fen, { topMs: T.heroTop, sacMs: T.heroSac }); if (!r) break; uci = r.uci; key = r.brilliant ? "brilliant" : "best"; if (r.brilliant) brilliants++; }
      } else {
        const lines = await L.lines(fen, 8, Math.round(T.antLines * 1.4));
        if (!lines.length) break;
        const bestS = scoreOf(lines[0]), heroEvalNow = -bestS, heroWinning = heroEval >= 900 || gifts >= I.goal * 2 || (brilliants >= I.goal && heroEval >= 300);
        const tol = n < 6 ? 25 : I.tol;
        let cands = lines.filter((l) => bestS - scoreOf(l) <= tol && !(l.mate != null && l.mate < 0));
        if (!cands.length) cands = [lines[0]];
        let chosen = cands[0], bestSpec = -1e9;
        if (n >= 6 && !heroWinning && cands.length > 1) {
          for (const c of cands.slice(0, 7)) {
            const c2 = new Chess(fen); c2.move({ from: c.uci.slice(0, 2), to: c.uci.slice(2, 4), promotion: c.uci[4] });
            if (c2.game_over()) continue;
            let spec = 0;
            try {                                                                                      // que peut trouver le héros après ce coup ?
              const h = await K.hunt(c2.fen(), { multipv: 2, topMs: T.antTop, sacMs: T.antSac, maxSac: 6, tolerance: 120 });
              const bril = h.sacrifices.filter((s) => s.brilliant), swing = (h.best ? h.best.score : 0) - heroEvalNow;                 // gain du héros par rapport à maintenant
              spec = 110 * Math.min(2, bril.length) + (h.sacrifices.some((s) => s.mate != null && s.mate > 0) ? 70 : 0) + Math.min(90, Math.max(0, swing / 4)) + (bril.some((s) => (s.deficit || 0) >= 5) ? 80 : 0);
            } catch (e) { spec = 0; }
            const sc = spec - 0.18 * (bestS - scoreOf(c));
            if (sc > bestSpec) { bestSpec = sc; chosen = c; gift = spec >= 100; }
            if (spec >= 220) break;                                                                      // cadeau en or (dame / tour sacrifiée, mat) : inutile de chercher plus loin
          }
        }
        uci = chosen.uci; loss = Math.max(0, bestS - scoreOf(chosen));
        key = loss >= 250 ? "blunder" : loss >= 130 ? "mistake" : loss >= 70 ? "inaccuracy" : "good";
        const b0 = new Chess(fen); const bm = b0.move({ from: lines[0].uci.slice(0, 2), to: lines[0].uci.slice(2, 4), promotion: lines[0].uci[4] }); bestSan = bm ? bm.san : "";
        if (gift) gifts++;
      }
      const m = ch.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (!m) break;
      const ev = await K.evaluate(ch.fen(), T.evalMs), ew = ch.game_over() && ch.in_checkmate() ? (turn === "w" ? MAT : -MAT) : ev.w;
      heroEval = hc === "w" ? ew : -ew;
      mv.push([uci, m.san, key, Math.round(loss), ew, bestSan]);
      const ply = ch.history().length, mover = isHero ? hero : ant, other = isHero ? ant : hero, d = { san: m.san, me: C.nameOf(other) };
      let text = "";
      if (isHero && key === "brilliant") text = say(mover, "bot_brilliant", ply, d, true);
      else if (!isHero && gift && (key === "mistake" || key === "blunder" || key === "inaccuracy")) { text = say(mover, key === "blunder" ? "bot_blunder" : "bot_mistake", ply, d, true); say(hero, "h_blunder", ply + 1, { me: C.nameOf(ant), san: m.san }, true); }
      else if (!isHero && key === "good") text = say(mover, "good", ply, d, false);
      else if (isHero && ch.in_check()) text = say(mover, "check", ply, d, false);
      if (isHero && brilliants && key === "brilliant") say(ant, "h_brilliant", ply + 1, { me: C.nameOf(hero), san: m.san }, true);
      if (onStep) await onStep({ fen: ch.fen(), san: m.san, ply, uci, role: isHero ? "hero" : "ant", key, gift, ev: ew, brilliants, gifts, say: text, last: [m.from, m.to] });
      else await new Promise((r) => setTimeout(r, 0));
    }
    if (mv.length < 2) return null;
    const heroWon = ch.in_checkmate() ? ch.turn() !== hc : true;
    if (ch.in_checkmate()) { say(hero, "mate_win", mv.length, { me: C.nameOf(ant) }, true); say(ant, "mate_lose", mv.length, { me: C.nameOf(hero) }, true); }
    else say(hero, "resign_win", mv.length, { me: C.nameOf(ant) }, true);
    const wName = names.w, bName = names.b, result = (heroWon ? C.nameOf(hero) : C.nameOf(ant)) + " gagne" + (ch.in_checkmate() ? "" : " (l'antagoniste abandonne)");
    const heroBrill = mv.filter((m, i) => m[2] === "brilliant").length;
    return { t: Date.now(), title: "🎭 " + C.nameOf(hero) + " – " + C.nameOf(ant) + " · Scène", result, plies: mv.length, brill: heroBrill, acc: null, pgn: ch.pgn(), id: "clip", pw: wName, pb: bName, pk: ["clip", "clip"],
      bw: hc === "w" ? heroBrill : 0, bb: hc === "b" ? heroBrill : 0, me: null, accW: null, accB: null, ch: chat, mv, clip: { opening: opn ? opn.id : "", alien: alienPly || 0, hero, ant, heroColor: hc, heroWon, mate: ch.in_checkmate(), intensity: o.intensity || "normal", gifts, brilliants: heroBrill } };
  };


  /** Scène avec CHATGPT PRIME (9999 Elo, GM) : il joue normalement au début, puis triche (coups illégaux) et s'en sort toujours ; l'autre personnage joue de vrais coups (Stockfish). Enregistré au format des variantes (actions + FEN). */
  C.runPrime = async (o, onStep, ctl) => {
    const P = E.prime, L = E.chessLocal, T = o.times || C.TIMES[o.quality || "fast"]; ctl = ctl || {};
    if (!P || !L) throw new Error("Stockfish n'est pas disponible ici.");
    const hc = o.heroColor || "w", primeHero = o.hero === "prime", pc = primeHero ? hc : hc === "w" ? "b" : "w", other = primeHero ? o.ant : o.hero, maxPlies = o.maxPlies || C.LENGTH[o.length || "normal"];
    const st = P.newState(pc === "w"), acts = [], chat = [], names = { [pc]: P.NAME, [pc === "w" ? "b" : "w"]: C.nameOf(other) };
    let over = null, lastTalk = -9;
    const talk = (bot, cat, ply, d) => { const t = line(bot, cat, d); if (t) { chat.push([ply, bot, t, cat]); lastTalk = ply; } return t; };
    talk("prime", "greet", 1, { me: C.nameOf(other) });
    while (!over && acts.length < maxPlies + 24 && !ctl.stop) {
      const ch = new Chess(st.fen); if (ch.game_over() && !ch.in_checkmate()) break;
      if (ch.turn() === pc) {
        const r = await P.turn(st, { L, weak: 18, danger: false });
        for (const a of r.acts) {
          acts.push(a); const ply = acts.length;
          if (a.cheat) { chat.push([ply, "prime", a.say, a.cheat === "kill" ? "mate_win" : "bot_blunder"]); talk(other, "h_blunder", ply + 1, { me: P.NAME, san: a.san }); } else if (ply - lastTalk >= 4 && Math.random() < 0.5) chat.push([ply, "prime", a.say, "good"]);
          if (onStep) await onStep({ fen: a.fen, san: a.san, ply, uci: a.uci, role: primeHero ? "hero" : "ant", key: "good", gift: !!a.cheat, ev: 0, brilliants: 0, gifts: st.cheats, say: a.cheat ? a.say : "", last: [a.from || a.to, a.to] });
        }
        over = r.over;
      } else {
        const mv = ch.moves({ verbose: true }); if (!mv.length) break;
        let uci = ""; try { uci = (await L.think(st.fen, 100, T.think)).uci; } catch (e) { uci = ""; }
        const m = mv.find((x) => x.from + x.to + (x.promotion || "") === uci) || mv[0]; ch.move(m);
        const a = { k: "mv", side: m.color, seat: m.color === "w" ? 0 : 1, key: "good", ev: null, from: m.from, to: m.to, piece: m.piece, cap: m.captured || "", promo: m.promotion || "", uci: m.from + m.to + (m.promotion || ""), san: m.san, fen: ch.fen(), cheat: "" };
        acts.push(a); st.fen = a.fen; if (onStep) await onStep({ fen: a.fen, san: a.san, ply: acts.length, uci: a.uci, role: primeHero ? "ant" : "hero", key: "good", gift: false, ev: 0, brilliants: 0, gifts: st.cheats, say: "", last: [a.from, a.to] });
      }
    }
    if (acts.length < 2) return null;
    const heroWon = primeHero ? (!over || over.winner === pc) : false, result = (over && over.why === "kill" ? P.NAME + " gagne (roi capturé, règle 47 bis)" : P.NAME + " gagne (il conteste le reste)");
    return { variant: true, mode: "prime", t: Date.now(), title: "🎭 " + C.nameOf(o.hero) + " – " + C.nameOf(o.ant) + " · Scène", result, plies: acts.length, brill: 0, acc: null, cheats: st.cheats, pgn: "", id: "clip", pw: names.w, pb: names.b, pk: ["clip", "clip"], bw: 0, bb: 0, me: null, accW: null, accB: null, ch: chat,
      mv: acts.map((a) => [a.uci, a.san, a.key || "good", 0, null, ""]), v: { mode: "prime", acts: acts.map((a) => Object.assign({}, a)), start: P.START, over: over ? over.why : "end", duo: false }, clip: { hero: o.hero, ant: o.ant, heroColor: hc, intensity: o.intensity || "normal", gifts: st.cheats, brilliants: 0, opening: "", alien: 0, prime: true } };
  };

  /**
   * SCÈNE SIMULTANÉE : 4 plateaux. mode "hero" = 1 héros contre 4 antagonistes (le héros fait le tour des plateaux, Blancs partout) ;
   * mode "ant" = 4 héros contre 1 antagoniste (l'antagoniste joue les Blancs partout, chaque héros a son plateau).
   * Chaque plateau est une scène complète (C.run) ; les coups sont ensuite entrelacés comme dans une vraie simultanée (le joueur central joue,
   * le joueur du plateau répond, puis plateau suivant). Enregistrement au format de la Simultanée : le Chess Edit en fait son montage « plateau à plateau ».
   * o : {mode, hero, ant, many: [4 ids], intensity, length, quality} ; onStep(st) reçoit en plus {board, boards}.
   */
  C.runSimul = async (o, onStep, ctl) => {
    ctl = ctl || {};
    const oneHero = o.mode !== "ant", many = (o.many || []).filter((id) => id && id !== "prime").slice(0, 6);
    const center = oneHero ? o.hero : o.ant;
    if (!center || center === "prime" || many.length < 2) throw new Error("Choisis un personnage central et au moins deux adversaires.");
    const boards = [];
    for (let b = 0; b < many.length && !ctl.stop; b++) {
      const sub = { stop: false }, rec = await C.run({ hero: oneHero ? center : many[b], ant: oneHero ? many[b] : center, heroColor: oneHero ? "w" : "b", intensity: o.intensity, length: o.length, quality: o.quality, times: o.times, maxPlies: o.maxPlies },
        onStep ? (st) => onStep(Object.assign({ board: b, boards: many.length, playerId: many[b] }, st)) : null, new Proxy(sub, { get: (t, k) => (k === "stop" ? !!ctl.stop || t.stop : t[k]) }));
      if (rec && rec.mv.length >= 2) boards.push({ id: many[b], rec });
    }
    if (!boards.length) return null;
    const centerName = C.nameOf(center), names = boards.map((x) => C.nameOf(x.id));
    { const seen = {}; names.forEach((n, i) => { seen[n] = (seen[n] || 0) + 1; if (seen[n] > 1) names[i] = n + " (" + seen[n] + ")"; }); }
    const sb = boards.map((x, i) => {
      const r = x.rec, heroWon = r.clip.heroWon !== false, centerWon = oneHero ? heroWon : !heroWon;
      return { name: names[i], talk: x.id, human: false, elo: 0, mv: r.mv.map((m, k) => m.slice(0, 6).concat([k % 2 === 0 ? centerName : names[i]])), result: centerWon ? "w" : "b",
        brilliants: r.clip.brilliants || 0, gifts: r.clip.gifts || 0, chat: r.ch || [] };
    });
    // tour de table : coup du joueur central sur le plateau b, réponse du plateau b, puis plateau suivant
    const order = [], maxLen = Math.max(...sb.map((x) => x.mv.length));
    for (let k = 0; k < maxLen; k += 2) sb.forEach((x, b) => { if (k < x.mv.length) order.push([b, k]); if (k + 1 < x.mv.length) order.push([b, k + 1]); });
    const centerWins = sb.filter((x) => x.result === "w").length, teamWin = centerWins < sb.length;
    const brill = sb.reduce((a, x) => a + x.brilliants, 0), gifts = sb.reduce((a, x) => a + x.gifts, 0), longest = sb.slice().sort((a, b) => b.mv.length - a.mv.length)[0];
    const result = oneHero ? (centerWins === sb.length ? centerName + " gagne tous les plateaux" : centerName + " gagne " + centerWins + " plateau" + (centerWins > 1 ? "x" : "") + " sur " + sb.length)
      : (teamWin ? "Les héros gagnent " + (sb.length - centerWins) + " plateau" + (sb.length - centerWins > 1 ? "x" : "") + " sur " + sb.length : centerName + " gagne tous les plateaux");
    return { t: Date.now(), title: "Simultanée · " + (oneHero ? centerName + " contre " + names.join(", ") : names.join(", ") + " contre " + centerName), result,
      plies: sb.reduce((a, x) => a + x.mv.length, 0), brill, acc: null, pgn: "", id: "clip", pw: centerName, pb: names.join(" + "), pk: ["team", "team"], me: null, ch: [], mv: longest.mv,
      simul: { boss: { name: centerName, talk: center, elo: 0, kind: "clip" }, boards: sb.map(({ name, talk, human, elo, mv, result }) => ({ name, talk, human, elo, mv, result })), order, team: teamWin ? sb.findIndex((x) => x.result === "b") : -1 },
      clip: { simul: true, mode: oneHero ? "hero" : "ant", hero: oneHero ? center : "", ant: oneHero ? "" : center, many: boards.map((x) => x.id), intensity: o.intensity || "normal", gifts, brilliants: brill } };
  };

  /** enregistre la scène dans l'historique des Défis (où le Chess Edit la trouve) */
  C.save = (rec) => { const list = E.settings.get("defi.hist", []); list.push(rec); E.settings.set("defi.hist", list.slice(-150)); return rec; };
  C.list = () => E.settings.get("defi.hist", []).filter((x) => x.clip);
})();
