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
      let d = 1;
      if (mv.captured) { d += 6 + VAL[mv.captured] * 4; tags.push("capture"); if (VAL[mv.captured] >= 5) tags.push("majeure"); }
      if (/#/.test(mv.san)) { d += 70; tags.push("mat"); } else if (/\+/.test(mv.san)) { d += 14; tags.push("échec"); }
      if (mv.promotion) { d += mv.promotion === "q" ? 40 : 25; tags.push("promotion"); }
      if (/^O-O/.test(mv.san)) d += 3;
      if (key === "brilliant") { d += 80; tags.push("brillant"); }
      else if (key === "blunder" || loss > 300) { d += 45 + Math.min(30, loss / 40); tags.push("gaffe"); }
      else if (key === "mistake") d += 12;
      else if (key === "best") { d += 6; tags.push("meilleur"); }
      else if (key === "excellent") d += 4;
      if (ev != null) d += Math.min(30, Math.abs(ev - prevEv) / 20);
      if (transformAt.includes(i)) { d += 55; tags.push("boss"); }
      else if (lines.some((l) => STRONG_CHAT.has(l.kind))) { d += 20; tags.push("réplique"); }
      out.push({ i, n: i + 1, color: mv.color, san: mv.san, uci, from: mv.from, to: mv.to, piece: mv.piece, captured: mv.captured || "", promo: mv.promotion || "", key, loss, ev, best: m[5] || "",
        check: /[+#]/.test(mv.san), mate: /#/.test(mv.san), boss: transformAt.includes(i), drama: Math.round(d * 10) / 10, tags, lines, fen: ch.fen() });
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

  // ---------------------------------------------------------------- manifeste JSON (pont Godot)
  function manifest(rec, tl, audio, opts) {
    opts = opts || {};
    return {
      version: 1, generator: "E.N.O.S. Chess Edit Studio",
      audio: { path: opts.audioPath || "", name: opts.audioName || "", duration: audio ? audio.duration : tl.duration, mainDrop: audio ? audio.mainDropTimestamp : null, buildUpStart: audio ? audio.buildUpStart : null,
        preDropSilence: audio ? audio.preDropSilence : null, hardBeats: audio ? audio.hardBeats : [], introBeats: audio ? audio.introBeats : [], vocalPeaks: audio ? audio.vocalPeaks : [] },
      game: { title: rec.title || "", white: rec.pw || "Blancs", black: rec.pb || "Noirs", result: rec.result || "", pgn: rec.pgn || "", plies: tl.plies, flip: rec.me === "b" },
      events: tl.events.map((e) => ({
        t: +e.t.toFixed(3), ply: e.n, san: e.san, uci: e.uci, color: e.color, piece: e.piece, captured: e.captured, promotion: e.promo, from: e.from, to: e.to, from_xy: sqXY(e.from), to_xy: sqXY(e.to),
        effect: e.fx, tone: e.tone, kind: e.kind, quality: e.key || "", drama: e.drama || 0, tags: e.tags || [], cutscene: e.cut ? { text: e.cut.text, piece: e.cut.piece, t: +((e.cutT != null ? e.cutT : e.t)).toFixed(3), duration: 0.8 } : null,
        overlay_text: e.text || "", shot: e.shot || "", texts: (e.lines || []).map((l) => ({ bot: l.bot, text: l.text, kind: l.kind })), fast_forward: e.kind === "ff", fen_after: e.fen || "",
      })),
    };
  }

  E.editMap = { gamePlies, autoSlots, manualSlots, assign, build, manifest, sqXY };
})();
