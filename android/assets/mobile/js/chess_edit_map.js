"use strict";
// CHESS EDIT STUDIO — MAPPING PARTIE <-> AUDIO. Trois étapes, toutes pures (testables sans navigateur) :
//   1. gamePlies(rec)   : rejoue la partie enregistrée (defi.hist : mv=[uci,san,jugement,perte,éval,meilleur], ch=[[coups,bot,texte,type]]) et donne à chaque coup un dramaScore.
//   2. autoSlots / manualSlots : les « emplacements » du montage (temps + coup imposé ou libre) viennent soit de l'analyse audio (mode IA), soit des marqueurs posés à la main.
//   3. build(plies, slots)    : attribue les coups aux emplacements EN GARDANT L'ORDRE DE LA PARTIE (le drop reçoit le coup le plus dramatique, les coups passifs intermédiaires
//      sont joués en accéléré ×8 ou sautés), puis exporte la timeline (rendu mobile) et le manifeste JSON (pont Godot).
(() => {
  const E = window.ENOS;
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const STRONG_CHAT = new Set(["bot_brilliant", "h_brilliant", "bot_blunder", "h_blunder", "mate_win", "mate_lose", "elo_up", "r_target", "mate_coming", "minor_lost", "resign_win"]);
  const sqXY = (s) => ({ col: s.charCodeAt(0) - 97, row: 8 - +s[1] });                  // col 0 = colonne a ; row 0 = rangée 8 (en haut pour les Blancs)

  // ---------------------------------------------------------------- 1. les coups et leur dramaScore
  function gamePlies(rec) {
    const ch = new Chess(), out = [], chat = rec.ch || [];
    const transformAt = chat.filter((c) => c[3] === "transform").map((c) => c[0] - 1);
    (rec.mv || []).forEach((m, i) => {
      const uci = m[0], mv = ch.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (!mv) return;
      const key = m[2] || "good", loss = m[3] | 0, ev = m[4] == null ? null : m[4], prevEv = i && rec.mv[i - 1][4] != null ? rec.mv[i - 1][4] : 0;
      const lines = chat.filter((c) => c[0] - 1 === i).map((c) => ({ bot: c[1], text: c[2], kind: c[3] || "" }));
      const tags = [];
      let sac = false;                                                                  // sacrifice : pièce ≥ 3 qui arrive sur une case où elle peut être prise par moins forte, ou sans recapture possible
      if (VAL[mv.piece] >= 3 && !mv.captured || (mv.captured && VAL[mv.captured] < VAL[mv.piece] - 1 && VAL[mv.piece] >= 3)) {
        try {
          for (const c of ch.moves({ verbose: true })) {
            if (c.to !== mv.to || !c.captured) continue;
            ch.move(c); const re = ch.moves({ verbose: true }).some((x) => x.to === mv.to && x.captured); ch.undo();
            if (VAL[c.piece] < VAL[mv.piece] || !re) { sac = true; break; }
          }
        } catch (e) { sac = false; }
      }
      if (sac) tags.push("sacrifice");
      let d = 1;
      if (mv.captured) { d += 6 + VAL[mv.captured] * 4; tags.push("capture"); if (VAL[mv.captured] >= 5) tags.push("majeure"); }
      if (/#/.test(mv.san)) { d += 70; tags.push("mat"); } else if (/\+/.test(mv.san)) { d += 14; tags.push("échec"); }
      if (mv.promotion) { d += mv.promotion === "q" ? 40 : 25; tags.push("promotion"); }
      if (/^O-O/.test(mv.san)) d += 3;
      if (sac && key !== "blunder" && loss <= 120) d += 18;
      if (key === "brilliant") { d += 80; tags.push("brillant"); }
      else if (key === "blunder" || loss > 300) { d += 45 + Math.min(30, loss / 40); tags.push("gaffe"); }
      else if (key === "mistake") d += 12;
      else if (key === "best") { d += 6; tags.push("meilleur"); }
      else if (key === "excellent") d += 4;
      if (ev != null) d += Math.min(30, Math.abs(ev - prevEv) / 20);
      if (transformAt.includes(i)) { d += 55; tags.push("boss"); }
      else if (lines.some((l) => STRONG_CHAT.has(l.kind))) { d += 20; tags.push("réplique"); }
      out.push({ i, n: i + 1, color: mv.color, san: mv.san, uci, from: mv.from, to: mv.to, piece: mv.piece, captured: mv.captured || "", promo: mv.promotion || "", key, loss, ev, best: m[5] || "",
        check: /[+#]/.test(mv.san), mate: /#/.test(mv.san), sacrifice: sac, boss: transformAt.includes(i), drama: Math.round(d * 10) / 10, tags, lines, fen: ch.fen() });
    });
    return out;
  }

  // ---------------------------------------------------------------- 2. emplacements
  const argmax = (pl, lo, hi) => { let b = -1; for (let i = lo; i < hi; i++) if (b < 0 || pl[i].drama > pl[b].drama) b = i; return b; };

  /** Mode IA : introBeats -> montée (coup « boss ») -> DROP (coup le plus dramatique) -> hardBeats -> dernier coup sur le dernier impact. */
  function autoSlots(a, plies) {
    if (!plies.length) return [];
    const S = [], last = plies.length - 1;
    const D = argmax(plies, 0, plies.length), boss = plies.findIndex((p) => p.boss);
    a.introBeats.filter((t) => t < a.buildUpStart - 0.2).forEach((t) => S.push({ t, kind: "intro" }));
    if (boss >= 0 && boss < D) S.push({ t: a.buildUpStart, kind: "boss", ply: boss });
    S.push({ t: a.mainDropTimestamp, kind: "drop", ply: D });
    const hard = a.hardBeats.filter((t) => t > a.mainDropTimestamp + 0.12);
    hard.forEach((t) => S.push({ t, kind: "hard" }));
    if (D < last) {
      const tEnd = hard.length ? hard[hard.length - 1] : Math.min(a.duration - 0.5, a.mainDropTimestamp + 4);
      if (hard.length) S.pop();                                                       // le dernier impact est réservé au coup final (souvent le mat)
      S.push({ t: tEnd, kind: "end", ply: last });
    }
    return S;
  }

  /** Mode manuel : marks = [{t, type: "drop"|"boss"|"brill"|"beat", ply?}] (ply = numéro de demi-coup 1.., choisi par l'utilisateur). */
  function manualSlots(marks, plies) {
    const M = marks.slice().sort((x, y) => x.t - y.t), S = [], used = new Set();
    const brills = plies.filter((p) => p.key === "brilliant").map((p) => p.i), bosses = plies.filter((p) => p.boss).map((p) => p.i);
    M.forEach((m) => {
      const s = { t: m.t, kind: m.type === "brill" ? "brill" : m.type === "beat" ? "hard" : m.type };
      if (m.ply && plies[m.ply - 1]) s.ply = m.ply - 1;
      else if (m.type === "drop") s.ply = argmax(plies, 0, plies.length);
      else if (m.type === "boss" && bosses.length) s.ply = bosses[0];
      S.push(s);
    });
    S.filter((s) => s.kind === "brill" && s.ply == null).forEach((s) => { const k = brills.find((i) => !S.some((x) => x.ply === i)); if (k != null) s.ply = k; });
    S.forEach((s) => { if (s.ply != null) used.add(s.ply); });
    return S;
  }

  // ---------------------------------------------------------------- 3. attribution + timeline
  function assign(plies, slots) {
    const S = slots.slice().sort((a, b) => a.t - b.t);
    let lastP = -1;
    S.forEach((s) => { if (s.ply != null) { if (s.ply <= lastP) s.ply = null; else lastP = s.ply; } });          // ancres incohérentes avec le temps : libérées
    const res = [];
    let a = -1, run = [];
    const flush = (b) => {                                                                                       // run : emplacements libres entre le coup a et le coup b (exclus)
      if (!run.length) return;
      const cand = []; for (let i = a + 1; i < b; i++) cand.push(i);
      const k = Math.min(run.length, cand.length);
      if (k) {
        const pick = cand.slice().sort((x, y) => plies[y].drama - plies[x].drama || x - y).slice(0, k).sort((x, y) => x - y);
        const at = k === run.length ? run.map((_, i) => i) : pick.map((_, i) => Math.round((i * (run.length - 1)) / Math.max(1, k - 1)));
        pick.forEach((p, j) => res.push({ ...run[at[j]], ply: p }));
      }
      run = [];
    };
    S.forEach((s) => { if (s.ply == null) run.push(s); else { flush(s.ply); res.push(s); a = s.ply; } });
    flush(plies.length);
    return res.sort((x, y) => x.ply - y.ply);
  }

  const toneOf = (p) => (p.key === "brilliant" ? "cyan" : p.mate || p.check || p.key === "blunder" || p.loss > 300 ? "red" : "green");
  function fxOf(p, s) {
    if (p.boss || s.kind === "boss") return "BOSS_AWAKENING";
    if (p.promo) return "PROMOTION_CUTSCENE";
    if (p.key === "brilliant") return "BRILLIANT_SHOCKWAVE";
    if (p.mate || p.captured || p.check || s.kind === "drop" || s.kind === "end" || s.kind === "hard") return "SHAKE_HEAVY";
    if (p.key === "blunder" || p.loss > 300) return "BLUNDER_RED";
    return "BEAT";
  }
  const textOf = (p) => (p.mate ? "IT'S OVER..." : p.key === "blunder" || p.loss > 300 ? "BIG MISTAKE" : p.captured === "q" ? "QUEEN DOWN" : p.check ? "CHECK !" : "");
  const shotOf = (p, s) => (p.mate || p.key === "blunder" || p.captured === "q" || p.captured === "r" ? "macro" : s.kind === "drop" || p.promo || p.key === "brilliant" ? "hero" : "");
  function cutOf(p, s, botName) {
    if (p.promo === "q") return { text: "LA DAME !", piece: "q", color: p.color };
    if (p.boss || s.kind === "boss") return { text: botName || "LE VRAI VISAGE", piece: "k", color: p.color, boss: true };
    if ((s.kind === "drop" || s.kind === "end") && (p.piece === "r" || p.captured === "r") && (p.key === "brilliant" || p.captured)) return { text: "THE ROOK !", piece: "r", color: p.color };
    return null;
  }

  /** Construit la timeline. slots = autoSlots(...) ou manualSlots(...). Retourne {events, duration}. */
  function build(plies, slots, audio) {
    const A = assign(plies, slots), events = [], vocal = (audio && audio.vocalPeaks) || [], dur = (audio && audio.duration) || 60;
    const botName = (p) => { const l = p.lines.find((x) => x.kind === "transform") || p.lines[0]; return l ? (E.botChat && E.botChat.bots[l.bot] ? E.botChat.bots[l.bot].name : l.bot) : ""; };
    const mk = (p, s, extra) => ({ t: s.t, ply: p.i, n: p.n, san: p.san, uci: p.uci, from: p.from, to: p.to, piece: p.piece, color: p.color, captured: p.captured, promo: p.promo, key: p.key, drama: p.drama, tags: p.tags,
      lines: p.lines, fen: p.fen, kind: s.kind, fx: fxOf(p, s), text: textOf(p), shot: shotOf(p, s), tone: toneOf(p), cut: cutOf(p, s, botName(p) ? "GM " + botName(p).toUpperCase() : ""), ...extra });
    A.forEach((s) => {
      const ev = mk(plies[s.ply], s, {});
      if (ev.cut && ev.cut.text === "THE ROOK !") { const v = vocal.find((x) => x >= s.t - 0.2 && x <= s.t + 1.2); if (v != null) ev.cutT = v; }
      events.push(ev);
    });
    // coups passifs : joués en accéléré dans les creux entre deux coups clés (ou simplement sautés quand il n'y a pas la place)
    const passive = [];
    const fill = (from, to, t0, t1) => {
      const m = to - from - 1;                                                       // coups intermédiaires
      if (m <= 0) return;
      const win = t1 - t0, can = Math.max(0, Math.min(m, Math.floor(win / 0.06)));
      if (can < 1) return;
      const list = []; for (let i = to - can; i < to; i++) list.push(i);               // seuls les derniers sont animés, les premiers sont « sautés »
      const step = win / can, ff = m >= 6 ? "ff" + from : "";
      list.forEach((pi, j) => passive.push({ t: +(t0 + j * step).toFixed(3), ply: pi, n: plies[pi].n, san: plies[pi].san, uci: plies[pi].uci, from: plies[pi].from, to: plies[pi].to, piece: plies[pi].piece, color: plies[pi].color,
        captured: plies[pi].captured, fen: plies[pi].fen, kind: "ff", fx: "FASTFORWARD", tone: "green", ffGroup: ff, lines: [] }));
    };
    let prevT = 0.3, prevPly = -1;
    events.forEach((ev) => { fill(prevPly, ev.ply, prevT, ev.t - 0.1); prevT = ev.t + 0.4; prevPly = ev.ply; });
    if (events.length && prevPly < plies.length - 1) fill(prevPly, plies.length, prevT, Math.min(dur, prevT + 6));
    const all = events.concat(passive).sort((x, y) => x.t - y.t || x.ply - y.ply);
    return { events: all, key: events, duration: dur, plies: plies.length };
  }

  // ---------------------------------------------------------------- 4. RYTHME « VIRAL » : toute la partie, ouverture fluide, accéléré, ralentis + arrêts sur image sur les moments critiques
  // Badges de coup (typographie Chess.com) : gaffe ❓ rouge, erreur ? orange, inexactitude ⁈ jaune, excellent 👍 vert, brillant ‼ cyan néon
  const BADGES = {
    brilliant: { glyph: "‼", label: "BRILLANT", color: "#00f2fe" }, best: { glyph: "👍", label: "EXCELLENT", color: "#7bd64d" }, excellent: { glyph: "👍", label: "EXCELLENT", color: "#7bd64d" },
    inaccuracy: { glyph: "⁈", label: "INEXACTITUDE", color: "#ffd21f" }, mistake: { glyph: "?", label: "ERREUR", color: "#ff9a1f" }, blunder: { glyph: "❓", label: "GAFFE", color: "#ff2a44" },
  };
  const VOICE = { q: "the_queen", r: "the_rook", b: "the_bishop", n: "the_knight" };              // samples vocaux de Levy (audio/levy/*.mp3)
  const ELO_OF = { penoire: 2500, eto: 3200, enos: 3200, naskolit: 3200, ghorghor: 1400, ghorreal: 3200, naskurieux: 1 };
  /** Niveau d'importance d'un coup : 3 = moment clé (arrêt sur image long), 2 = important (ralenti), 1 = notable, 0 = passif (accéléré). */
  function lvlOf(p) {
    if (p.mate || p.key === "brilliant" || p.boss || p.key === "blunder" || p.loss > 300 || p.promo === "q" || p.captured === "q") return 3;
    if (p.check || p.sacrifice || p.promo || p.key === "mistake" || p.drama >= 45 || (p.captured && VAL[p.captured] >= 5)) return 2;
    if (p.captured || p.key === "inaccuracy" || p.key === "best" || p.key === "excellent") return 1;
    return 0;
  }
  function introInfo(rec) {
    const bots = (E.botChat && E.botChat.bots) || {}, me = (E.userName && E.userName()) || "Toi";
    const side = (name, color) => {
      const id = Object.keys(bots).find((k) => bots[k].name === name), b = id ? bots[id] : null;
      return { name: name === "Toi" ? me : name, id: id || "", img: b && b.img ? b.img : "", title: b && b.title ? b.title : "", elo: id && ELO_OF[id] != null ? ELO_OF[id] : null, human: !b, color };
    };
    return { white: side(rec.pw || "Blancs", "w"), black: side(rec.pb || "Noirs", "b"), title: rec.title || "", result: rec.result || "" };
  }

  /** Timeline « edit viral ». opts : {intro, introDur, outroDur, maxLen, voices, syncDrop}. Les temps sont ceux de la VIDÉO ; musicStart = position de la musique à t=0 (négatif : elle démarre plus tard). */
  function buildViral(plies, rec, audio, opts) {
    opts = Object.assign({ intro: true, introDur: 4.6, outroDur: 2.6, maxLen: 70, voices: true, syncDrop: true }, opts || {});
    const n = plies.length, L = plies.map(lvlOf), plan = [], ev = [];
    const firstCrit = L.findIndex((l, i) => i >= 6 && l >= 2), nOpen = Math.min(n, Math.max(8, Math.min(14, firstCrit < 0 ? 14 : firstCrit)));
    plies.forEach((p, i) => {
      const l = L[i];
      let pl;
      if (l >= 3) pl = { phase: "hero", anim: p.mate ? 1100 : 1000, freeze: p.mate ? 1.7 : p.key === "brilliant" ? 1.35 : p.key === "blunder" || p.loss > 300 ? 1.1 : 0.95 };
      else if (l === 2) pl = { phase: "crit", anim: 680, freeze: p.check ? 0.5 : 0.62 };
      else if (i < nOpen) pl = { phase: "open", anim: 330, freeze: 0, dt: 0.62 - 0.26 * (i / Math.max(1, nOpen - 1)) };
      else if (l === 1) pl = { phase: "mid", anim: 300, freeze: 0, dt: 0.42 };
      else pl = { phase: "ff", anim: 90, freeze: 0, dt: 0.17 };
      if (pl.dt == null) pl.dt = pl.anim / 1000 + pl.freeze;
      plan.push(pl);
    });
    plan.forEach((pl, i) => { if (pl.phase !== "hero" && pl.phase !== "crit" && i + 1 < n && L[i + 1] >= 3 && i >= nOpen) { pl.phase = "tension"; pl.anim = 420; pl.dt = 0.55; } });   // le calme avant le coup clé
    // budget de durée (Shorts) : on comprime d'abord les coups passifs, puis les notables, puis les arrêts sur image
    const t0 = opts.intro ? opts.introDur : 0.3, fixed = t0 + opts.outroDur, total = () => fixed + plan.reduce((a, q) => a + q.dt, 0);
    for (const phase of ["ff", "mid", "open"]) {
      if (total() <= opts.maxLen) break;
      const sum = plan.filter((q) => q.phase === phase).reduce((a, q) => a + q.dt, 0), over = total() - opts.maxLen;
      if (sum > 0) { const k = Math.max(phase === "ff" ? 0.07 / 0.17 : 0.5, (sum - over) / sum); plan.forEach((q) => { if (q.phase === phase) q.dt *= k; }); }
    }
    if (total() > opts.maxLen) { const hs = plan.filter((q) => q.freeze).reduce((a, q) => a + q.freeze, 0), over = total() - opts.maxLen, k = Math.max(0.45, (hs - over) / Math.max(hs, 0.001)); plan.forEach((q) => { if (q.freeze) { q.dt -= q.freeze * (1 - k); q.freeze *= k; } }); }
    // événements
    const botName = (p) => { const l = p.lines.find((x) => x.kind === "transform") || p.lines[0]; return l ? (E.botChat && E.botChat.bots[l.bot] ? E.botChat.bots[l.bot].name : l.bot) : ""; };
    const heroIdx = (() => { let b = -1; plies.forEach((p, i) => { if (L[i] >= 3 && (b < 0 || p.drama > plies[b].drama)) b = i; }); return b < 0 ? plies.reduce((m, p, i) => (p.drama > plies[m].drama ? i : m), 0) : b; })();
    let t = t0, ffRun = 0;
    plies.forEach((p, i) => {
      const pl = plan[i], kind = i === heroIdx ? "drop" : pl.phase === "hero" || pl.phase === "crit" ? "crit" : pl.phase === "ff" ? "ff" : pl.phase === "tension" ? "mid" : pl.phase;
      ffRun = pl.phase === "ff" ? ffRun + 1 : 0;
      const slot = { kind: kind === "ff" ? "ff" : kind }, bd = BADGES[p.key] && (L[i] >= 1 || p.key === "brilliant") ? BADGES[p.key] : null;
      const impact = +(t + (pl.anim / 1000) * 0.82).toFixed(3);
      const e = { t: +t.toFixed(3), ply: p.i, n: p.n, san: p.san, uci: p.uci, from: p.from, to: p.to, piece: p.piece, color: p.color, captured: p.captured, promo: p.promo, key: p.key, drama: p.drama, tags: p.tags,
        lines: L[i] >= 2 ? p.lines : [], fen: p.fen, kind, phase: pl.phase, lvl: L[i], dur: pl.anim, freeze: +pl.freeze.toFixed(3), impact, badge: bd, sacrifice: p.sacrifice, ffRun: kind === "ff" && ffRun >= 3, check: p.check, mate: p.mate,
        fx: kind === "ff" ? "FASTFORWARD" : fxOf(p, slot), text: kind === "ff" ? "" : textOf(p), shot: kind === "ff" ? "" : shotOf(p, slot), tone: kind === "ff" ? "green" : toneOf(p),
        cut: kind === "ff" ? null : cutOf(p, slot, botName(p) ? "GM " + botName(p).toUpperCase() : ""), invert: (p.key === "brilliant" || (p.sacrifice && L[i] >= 2 && p.key !== "blunder")) };
      ev.push(e); t += pl.dt;
    });
    const end = +(t + 0.2).toFixed(3);
    // son : les bruits de base calés à la frame sur l'impact de chaque coup, les voix de Levy sur les coups clés (jamais deux voix à moins de 2,4 s)
    const sfx = [];
    ev.forEach((e) => {
      const id = e.mate ? "mate" : e.promo ? "promote" : e.check ? "check" : e.captured ? "capture" : "move";
      sfx.push({ t: e.impact, id, gain: e.kind === "ff" ? 0.38 : e.lvl >= 2 ? 1 : 0.8, bus: "sfx", ply: e.n });
      if (e.key === "brilliant") sfx.push({ t: +(e.impact + 0.02).toFixed(3), id: "brilliant", gain: 0.9, bus: "sfx", ply: e.n });
    });
    if (opts.voices) {
      const cand = [];
      ev.forEach((e) => {
        let id = "", pr = 0;
        if (e.mate) { id = "this_is_the_way"; pr = 10; }
        else if (e.kind === "drop" && e.key === "brilliant") { id = VOICE[e.piece] || "this_is_the_way"; pr = 9; }
        else if (e.key === "brilliant") { id = VOICE[e.piece] || "this_is_the_way"; pr = 8; }
        else if (e.promo === "q") { id = "the_queen"; pr = 8; }
        else if (e.captured === "q") { id = "the_queen"; pr = 7; }
        else if (e.sacrifice && e.lvl >= 2 && VOICE[e.piece]) { id = VOICE[e.piece]; pr = 6; }
        else if (e.lvl >= 2 && (e.check || e.captured === "r" || e.captured === "b" || e.captured === "n") && VOICE[e.piece]) { id = VOICE[e.piece]; pr = 4; }
        else if (e.kind === "drop") { id = "this_is_the_way"; pr = 5; }
        if (id) cand.push({ e, id, pr });
      });
      const cap = Math.max(3, Math.round(ev.length / 9)), chosen = [];
      cand.sort((a, b) => b.pr - a.pr || a.e.t - b.e.t).forEach((c) => { if (chosen.length < cap && chosen.every((x) => Math.abs(x.e.impact - c.e.impact) >= 2.4)) chosen.push(c); });
      chosen.forEach((c) => sfx.push({ t: +(c.e.impact + 0.04).toFixed(3), id: c.id, gain: c.id === "the_rook" ? 2.3 : 1, bus: "voice", ply: c.e.n }));
    }
    sfx.sort((a, b) => a.t - b.t);
    const hero = ev[heroIdx], musicStart = audio && opts.syncDrop && hero ? +(audio.mainDropTimestamp - hero.impact).toFixed(3) : 0;
    const all = [];
    if (opts.intro) all.push({ t: 0, kind: "intro", dur: opts.introDur, intro: introInfo(rec), fx: "INTRO", ply: -1 });
    ev.forEach((e) => all.push(e));
    all.push({ t: end, kind: "outro", dur: opts.outroDur, result: rec.result || "", intro: introInfo(rec), fx: "OUTRO", ply: n });
    const dur = +(end + opts.outroDur).toFixed(3), key = ev.filter((e) => e.lvl >= 2);
    return { viral: true, events: all, key, duration: dur, plies: n, musicStart, sfx, stats: { open: nOpen, ff: ev.filter((e) => e.kind === "ff").length, crit: key.length, hero: heroIdx >= 0 ? ev[heroIdx].n : 0, freeze: +ev.reduce((a, e) => a + e.freeze, 0).toFixed(1) } };
  }

  // ---------------------------------------------------------------- manifeste JSON (pont Godot)
  function manifest(rec, tl, audio, opts) {
    opts = opts || {};
    return {
      version: tl.viral ? 2 : 1, generator: "E.N.O.S. Chess Edit Studio",
      audio: { path: opts.audioPath || "", name: opts.audioName || "", duration: audio ? audio.duration : tl.duration, mainDrop: audio ? audio.mainDropTimestamp : null, buildUpStart: audio ? audio.buildUpStart : null,
        preDropSilence: audio ? audio.preDropSilence : null, hardBeats: audio ? audio.hardBeats : [], introBeats: audio ? audio.introBeats : [], vocalPeaks: audio ? audio.vocalPeaks : [], start_offset: tl.musicStart || 0 },
      pacing: tl.viral ? { mode: "viral", duration: tl.duration, stats: tl.stats || {}, outro_t: (tl.events.find((e) => e.kind === "outro") || {}).t || tl.duration } : { mode: "music" },
      sfx: tl.viral ? tl.sfx : [],
      intro: tl.viral ? (tl.events.find((e) => e.kind === "intro") || {}).intro || null : null,
      game: { title: rec.title || "", white: rec.pw || "Blancs", black: rec.pb || "Noirs", result: rec.result || "", pgn: rec.pgn || "", plies: tl.plies, flip: rec.me === "b" },
      events: tl.events.filter((e) => e.kind !== "intro" && e.kind !== "outro").map((e) => ({
        t: +e.t.toFixed(3), ply: e.n, san: e.san, uci: e.uci, color: e.color, piece: e.piece, captured: e.captured, promotion: e.promo, from: e.from, to: e.to, from_xy: sqXY(e.from), to_xy: sqXY(e.to),
        effect: e.fx, tone: e.tone, kind: e.kind, quality: e.key || "", drama: e.drama || 0, tags: e.tags || [], cutscene: e.cut ? { text: e.cut.text, piece: e.cut.piece, t: +((e.cutT != null ? e.cutT : e.t)).toFixed(3), duration: 0.8 } : null,
        overlay_text: e.text || "", shot: e.shot || "", dur: e.dur != null ? +(e.dur / 1000).toFixed(3) : 0.3, freeze: e.freeze || 0, impact: e.impact != null ? e.impact : e.t, badge: e.badge ? { glyph: e.badge.glyph, label: e.badge.label, color: e.badge.color } : null, level: e.lvl != null ? e.lvl : 0, phase: e.phase || "", texts: (e.lines || []).map((l) => ({ bot: l.bot, text: l.text, kind: l.kind })), fast_forward: e.kind === "ff", fen_after: e.fen || "",
      })),
    };
  }

  E.editMap = { gamePlies, autoSlots, manualSlots, assign, build, buildViral, manifest, sqXY, BADGES, lvlOf, introInfo };
})();
