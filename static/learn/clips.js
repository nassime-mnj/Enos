"use strict";
// GAME CLIPS — « scènes de théâtre » : une partie MISE EN SCÈNE entre un HÉROS et un ANTAGONISTE, faite pour le Chess Edit.
//   Le héros joue comme ETO Brillant (chasse aux sacrifices brillants, K.etoMove). L'antagoniste joue des coups plausibles (parmi les 5 meilleurs lignes de Stockfish, jamais une gaffe grossière
//   dans l'ouverture) mais choisit, à chaque fois, celui qui OFFRE AU HÉROS le plus beau coup : pour chaque candidat on demande à Stockfish (K.hunt) ce que le héros peut y trouver
//   (sacrifices brillants, mat, dame/tour sacrifiée) et on garde le « cadeau » le plus spectaculaire pour le moins de perte. Quand le héros a gagné assez de spectacle, l'antagoniste joue
//   les meilleurs coups et le héros conclut. La partie est enregistrée comme une partie des Défis (defi.hist, clip: {…}) : le Chess Edit la prend comme n'importe quelle autre.
(() => {
  const E = window.ENOS;
  const C = (E.clips = {});
  const FALL = { nasko: "Nasko", penoire: "Nasko (pénoire)", lelex: "Lelex", naskurieux: "Naskurieux", ghorghor: "GhorGhor", naskolit: "Naskolit", jester: "Le Jester", eto: "ETO Brillant", enos: "E.N.O.S.", stockfish: "Stockfish" };
  C.BOTS = Object.keys(FALL);
  C.nameOf = (id) => (E.botChat && E.botChat.bots[id] ? E.botChat.bots[id].name : FALL[id] || id);
  C.INTENSITY = { subtle: { tol: 120, goal: 2, label: "Subtil" }, normal: { tol: 260, goal: 3, label: "Normal" }, theatre: { tol: 480, goal: 5, label: "Théâtral" } };
  C.LENGTH = { short: 36, normal: 56, long: 84 };
  C.TIMES = {
    fast: { think: 250, heroTop: 350, heroSac: 700, antLines: 350, antTop: 200, antSac: 350, evalMs: 200 },
    careful: { think: 600, heroTop: 1000, heroSac: 1800, antLines: 800, antTop: 450, antSac: 800, evalMs: 450 },
  };
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
    const K = E.brain, L = E.chessLocal; ctl = ctl || {};
    if (!K || !L) throw new Error("Stockfish n'est pas disponible ici.");
    const T = o.times || C.TIMES[o.quality || "fast"], I = C.INTENSITY[o.intensity || "normal"], maxPlies = o.maxPlies || C.LENGTH[o.length || "normal"];
    const hero = o.hero, ant = o.ant, hc = o.heroColor || "w", names = { [hc]: C.nameOf(hero), [hc === "w" ? "b" : "w"]: C.nameOf(ant) };
    const ch = new Chess(), mv = [], chat = [];
    let brilliants = 0, gifts = 0, lastTalk = -9, heroEval = 0;
    await K.loadBook().catch(() => false);
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
      if (isHero) {
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
      bw: hc === "w" ? heroBrill : 0, bb: hc === "b" ? heroBrill : 0, me: null, accW: null, accB: null, ch: chat, mv, clip: { hero, ant, heroColor: hc, intensity: o.intensity || "normal", gifts, brilliants: heroBrill } };
  };

  /** enregistre la scène dans l'historique des Défis (où le Chess Edit la trouve) */
  C.save = (rec) => { const list = E.settings.get("defi.hist", []); list.push(rec); E.settings.set("defi.hist", list.slice(-150)); return rec; };
  C.list = () => E.settings.get("defi.hist", []).filter((x) => x.clip);
})();
