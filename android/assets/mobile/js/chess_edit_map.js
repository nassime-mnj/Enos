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
  /** Parties des VARIANTES (Élixir, Élixir +, Roulette, 2v2…) : pas de règles standard (poses, cartes, écrasements) -> on lit les actions enregistrées (rec.v.acts) au lieu de rejouer avec chess.js. */
  function variantPlies(rec) {
    const V = rec.v || {}, acts = (V.acts || []).filter((a) => a.k !== "spin" && a.k !== "pass"), out = [], VALX = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0, m: 9, e: 9, g: 3, s: 1 };
    const START = V.start || "4k3/8/8/8/8/8/8/4K3 w - - 0 1", SPN2 = { mk: "mk", rei: "rei", barrel: "barrel", army: "army" };
    acts.forEach((a, i) => {
      const prevFen = i ? out[i - 1].fen : START, drop = a.k === "drop", smash = a.smash || [], special = a.special || "", key = a.key || "good", tags = [];
      let d = 1;
      if (a.cap) { d += 6 + (VALX[a.cap] || 1) * 4; tags.push("capture"); }
      if (smash.length) { d += 22 * smash.length; tags.push("écrasement"); }
      if (special) { d += { mk: 40, rei: 25, army: 30, barrel: 20 }[special] || 15; tags.push(special); }
      if (drop && !special) d += 3;
      if (a.elim && a.elim.length) { d += 90 * a.elim.length; tags.push("élimination"); }
      const last = i === acts.length - 1, over = last && (V.over === "mate" || V.over === "smash" || /mate|smash/.test(V.over || ""));
      if (over) { d += 70; tags.push("mat"); }
      if (key === "brilliant") { d += 80; tags.push("brillant"); } else if (key === "blunder") { d += 45; tags.push("gaffe"); } else if (key === "mistake") d += 12; else if (key === "miss") { d += 30; tags.push("manqué"); } else if (key === "forced") tags.push("forcé");
      const prevEv = i ? acts[i - 1].ev : 0; if (a.ev != null) d += Math.min(30, Math.abs(a.ev - (prevEv || 0)) / 20);
      const to = a.to, piece = (a.piece || "p"), color = a.side || "w", fen = a.fen, mapAfter = mapOf(fen);
      out.push({ i, n: i + 1, pid: a.n + ":" + to, fenBefore: prevFen, color, san: a.san || "", uci: a.uci || "@" + to, from: drop ? "" : a.from, to, piece, captured: a.cap || (smash.length ? "p" : ""), promo: a.promo || "", key, loss: a.loss || 0, ev: a.ev == null ? null : a.ev, best: "",
        check: false, mate: over, sacrifice: false, boss: special === "mk" && smash.length >= 2, drama: Math.round(d * 10) / 10, tags, lines: [], fen, drop, special: SPN2[special] || "", smash, filled: a.filled || [], elim: a.elim || [], variant: true, dropPiece: mapAfter[to] || "" });
    });
    return out;
  }
  function gamePlies(rec) {
    if (rec.variant) return variantPlies(rec);
    const ch = new Chess(), out = [], chat = rec.ch || [], ids = {};
    "abcdefgh".split("").forEach((f) => ["1", "2", "7", "8"].forEach((r) => { ids[f + r] = f + r; }));                          // identité d'une pièce = sa case de départ, suivie coup après coup
    const transformAt = chat.filter((c) => c[3] === "transform").map((c) => c[0] - 1);
    (rec.mv || []).forEach((m, i) => {
      const uci = m[0], mv = ch.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (!mv) return;
      const pid = ids[mv.from] || mv.from;
      delete ids[mv.from];
      if (mv.flags && mv.flags.indexOf("e") >= 0) delete ids[mv.to[0] + mv.from[1]];
      if (/^O-O/.test(mv.san)) { const rk = mv.from[1], short = mv.to[0] === "g", rf = (short ? "h" : "a") + rk, rt = (short ? "f" : "d") + rk; ids[rt] = ids[rf] || rf; delete ids[rf]; }
      ids[mv.to] = pid;
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
      else if (key === "miss") { d += 30; tags.push("manqué"); }
      else if (key === "forced") tags.push("forcé");
      else if (key === "best") { d += 6; tags.push("meilleur"); }
      else if (key === "excellent") d += 4;
      if (ev != null) d += Math.min(30, Math.abs(ev - prevEv) / 20);
      if (transformAt.includes(i)) { d += 55; tags.push("boss"); }
      else if (lines.some((l) => STRONG_CHAT.has(l.kind))) { d += 20; tags.push("réplique"); }
      const fenBefore = i ? out[i - 1].fen : "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
      out.push({ i, n: i + 1, pid, fenBefore, color: mv.color, san: mv.san, uci, from: mv.from, to: mv.to, piece: mv.piece, captured: mv.captured || "", promo: mv.promotion || "", key, loss, ev, best: m[5] || "",
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
  const SPCUT = { mk: ["MÉGA CHEVALIER !", "m"], rei: ["R.E.I.N.E !", "e"], barrel: ["BARIL DU FOU !", "g"], army: ["L'ARMÉE !", "s"] };
  function cutOf(p, s, botName) {
    if (p.variant && p.special && (p.special === "mk" || p.drop)) return { text: SPCUT[p.special][0], piece: SPCUT[p.special][1], color: p.color, boss: p.special === "mk" };
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

  // ---------------------------------------------------------------- géométrie légère (sans règles d'échec) : portées, attaquants, menaces, fiche « Power / Speed / Defense / Trick »
  const PV = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  const mapOf = (fen) => { const m = {}; fen.split(" ")[0].split("/").forEach((r, y) => { let x = 0; for (const c of r) { if (/\d/.test(c)) x += +c; else m[String.fromCharCode(97 + x++) + (8 - y)] = c; } }); return m; };
  const isW = (c) => c === c.toUpperCase();
  /** cases atteintes depuis sq : {moves: cases atteignables (vides ou ennemies), attacks: cases attaquées (pièces ennemies), protects: pièces amies protégées} */
  function reach(map, sq) {
    const pc = map[sq], out = { moves: [], attacks: [], protects: [] };
    if (!pc) return out;
    const t = pc.toLowerCase(), w = isW(pc), f0 = sq.charCodeAt(0) - 97, r0 = +sq[1] - 1, at = (f, r) => (f >= 0 && f < 8 && r >= 0 && r < 8 ? String.fromCharCode(97 + f) + (r + 1) : null);
    const land = (s2) => { if (!s2) return false; const o = map[s2]; if (!o) { out.moves.push(s2); return true; } if (isW(o) !== w) { out.moves.push(s2); out.attacks.push(s2); } else out.protects.push(s2); return false; };
    const slide = (dirs) => dirs.forEach(([a, b]) => { for (let f = f0 + a, r = r0 + b; ; f += a, r += b) if (!land(at(f, r))) break; });
    if (t === "n") [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]].forEach(([a, b]) => land(at(f0 + a, r0 + b)));
    else if (t === "k") { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (a || b) land(at(f0 + a, r0 + b)); }
    else if (t === "p") { const d = w ? 1 : -1; [-1, 1].forEach((a) => { const s2 = at(f0 + a, r0 + d); if (!s2) return; const o = map[s2]; if (o && isW(o) !== w) { out.attacks.push(s2); out.moves.push(s2); } else if (o) out.protects.push(s2); }); const f1 = at(f0, r0 + d); if (f1 && !map[f1]) { out.moves.push(f1); const f2 = at(f0, r0 + 2 * d); if (f2 && !map[f2] && (w ? r0 === 1 : r0 === 6)) out.moves.push(f2); } }
    else { if (t === "r" || t === "q") slide([[1, 0], [-1, 0], [0, 1], [0, -1]]); if (t === "b" || t === "q") slide([[1, 1], [1, -1], [-1, 1], [-1, -1]]); }
    return out;
  }
  /** pièces de la couleur `white` qui attaquent / protègent la case sq */
  function coverers(map, sq, white) { const o = []; for (const s2 of Object.keys(map)) { const p = map[s2]; if (isW(p) !== white || s2 === sq) continue; const r = reach(map, s2); if (r.attacks.includes(sq) || r.protects.includes(sq)) o.push(s2); } return o; }
  /** menaces créées par la pièce arrivée en `to` : pièces ennemies de valeur ≥ 3 attaquées ET (plus fortes qu'elle, ou sans défenseur) ; le roi attaqué (échec) compte toujours. Au plus 3, les plus grosses d'abord. */
  function threatsFrom(fenAfter, to) {
    const map = mapOf(fenAfter), pc = map[to]; if (!pc) return [];
    const w = isW(pc), me = PV[pc.toLowerCase()], r = reach(map, to), list = [];
    r.attacks.forEach((t) => {
      const tp = map[t], tv = PV[tp.toLowerCase()];
      if (tv === 100) { list.push({ from: to, to: t, v: 100 }); return; }
      if (tv < 3) return;
      if (tv > me || coverers(map, t, !w).length === 0) list.push({ from: to, to: t, v: tv });
    });
    return list.sort((a, b) => b.v - a.v).slice(0, 3).map((x) => ({ from: x.from, to: x.to }));
  }
  const NAME_FR = { p: "Pion", n: "Cavalier", b: "Fou", r: "Tour", q: "Dame", k: "Roi" };
  const MOB = { p: 4, n: 8, b: 13, r: 14, q: 27, k: 8 }, BASE = { p: 15, n: 55, b: 60, r: 75, q: 100, k: 35 };
  const r5 = (x) => Math.max(5, Math.min(100, Math.round(x / 5) * 5));
  /** fiche d'une pièce AVANT son coup : Power (valeur + pièces qu'elle menace), Speed (mobilité), Defense (protecteurs), Trick (cibles / fourchette / sacrifice) */
  function pieceStats(fenBefore, sq, sacrifice) {
    const map = mapOf(fenBefore), pc = map[sq]; if (!pc) return null;
    const t = pc.toLowerCase(), w = isW(pc), r = reach(map, sq), tg = r.attacks.filter((s2) => PV[map[s2].toLowerCase()] >= 3 || PV[map[s2].toLowerCase()] === 100);
    const defenders = coverers(map, sq, w).length;
    const power = BASE[t] + Math.min(35, tg.reduce((a, s2) => a + Math.min(9, PV[map[s2].toLowerCase()]) * 4, 0)), speed = (r.moves.length / MOB[t]) * 100 * 1.25, defense = 25 + defenders * 22, trick = 10 + tg.length * 25 + (tg.length >= 2 ? 25 : 0) + (sacrifice ? 30 : 0);
    return { piece: pc, type: t, color: w ? "w" : "b", sq, name: NAME_FR[t], vals: { power: r5(power), speed: r5(speed), defense: r5(defense), trick: r5(trick) } };
  }

  // ---------------------------------------------------------------- 4. RYTHME « VIRAL » : toute la partie, ouverture fluide, accéléré, ralentis + arrêts sur image sur les moments critiques
  // Badges de coup (typographie Chess.com) : gaffe ❓ rouge, erreur ? orange, inexactitude ⁈ jaune, excellent 👍 vert, brillant ‼ cyan néon
  const BADGES = {
    brilliant: { glyph: "‼", label: "BRILLANT", color: "#00f2fe" }, best: { glyph: "👍", label: "EXCELLENT", color: "#7bd64d" }, excellent: { glyph: "👍", label: "EXCELLENT", color: "#7bd64d" },
    inaccuracy: { glyph: "⁈", label: "INEXACTITUDE", color: "#ffd21f" }, miss: { glyph: "✖", label: "MANQUÉ", color: "#ff6b7d" }, forced: { glyph: "»", label: "FORCÉ", color: "#9aa7bd" }, mistake: { glyph: "?", label: "ERREUR", color: "#ff9a1f" }, blunder: { glyph: "❓", label: "GAFFE", color: "#ff2a44" },
  };
  const VOICE = { q: "the_queen", r: "the_rook", b: "the_bishop", n: "the_knight" };              // samples vocaux de Levy (audio/levy/*.mp3)
  const ELO_OF = { penoire: 2500, eto: 3200, enos: 3200, naskolit: 3200, ghorghor: 1400, ghorreal: 3200, naskurieux: 1 };
  /** Niveau d'importance d'un coup : 3 = moment clé (arrêt sur image long), 2 = important (ralenti), 1 = notable, 0 = passif (accéléré). */
  function lvlOf(p) {
    if (p.variant) { if (p.mate || p.key === "brilliant" || p.key === "blunder" || (p.elim && p.elim.length) || (p.smash && p.smash.length >= 2) || p.special === "mk") return 3; if (p.special || (p.smash && p.smash.length) || p.captured || p.key === "miss" || p.key === "mistake") return 2; return p.drop ? 1 : p.drama >= 14 ? 1 : 0; }
    if (p.mate || p.key === "brilliant" || p.boss || p.key === "blunder" || p.loss > 300 || p.promo === "q" || p.captured === "q") return 3;
    if (p.check || p.sacrifice || p.promo || p.key === "mistake" || p.key === "miss" || p.drama >= 45 || (p.captured && VAL[p.captured] >= 5)) return 2;
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

  /** Timeline « edit viral ». opts : {intro, introDur, outroDur, maxLen, voices, syncDrop}. Les temps sont ceux de la VIDÉO ; la musique démarre TOUJOURS à t = 0 (musicStart = 0) et c'est le montage qui s'adapte à elle :
   *  le moment clé choisi (le plus dramatique qu'on peut caler) tombe sur le DROP de la musique, en allongeant ou resserrant un peu les temps morts avant lui et, si la partie est « trop tôt », en ajoutant un
   *  plan d'ambiance (kind "idle") avant le premier coup. Rythme POSÉ : on ne cherche pas à aller vite, chaque chose a son temps. */
  function buildViral(plies, rec, audio, opts) {
    opts = Object.assign({ intro: true, introDur: 5.2, outroDur: 3.2, voices: true, syncDrop: true }, opts || {});
    if (opts.maxLen == null) opts.maxLen = audio && audio.duration ? Math.max(40, audio.duration - 1.5) : 170;
    const n = plies.length, L = plies.map(lvlOf), plan = [], ev = [], statSeen = new Set();
    const firstCrit = L.findIndex((l, i) => i >= 6 && l >= 2), nOpen = Math.min(n, Math.max(8, Math.min(14, firstCrit < 0 ? 14 : firstCrit)));
    plies.forEach((p, i) => {
      const l = L[i];
      let pl;
      if (l >= 3) pl = { phase: "hero", anim: p.mate ? 1700 : 1500, freeze: p.mate ? 2.6 : p.key === "brilliant" ? 2.4 : p.key === "blunder" || p.loss > 300 ? 1.9 : 1.7, gap: 0.5, pre: p.key === "brilliant" || p.sacrifice || p.boss ? 2.2 : 0 };
      else if (l === 2) pl = { phase: "crit", anim: 1100, freeze: p.check ? 1.2 : 1.5, gap: 0.4, pre: p.sacrifice ? 2.4 : 0 };
      else if (i < nOpen) pl = { phase: "open", anim: 520, freeze: 0, gap: 0.6 - 0.2 * (i / Math.max(1, nOpen - 1)) };
      else if (l === 1) pl = { phase: "mid", anim: 520, freeze: 0, gap: 0.45 };
      else pl = { phase: "ff", anim: 260, freeze: 0, gap: 0.18 };
      if (p.drop) pl.anim = p.special === "barrel" ? 1600 : p.special === "army" ? 1300 : p.special === "mk" ? 1200 : Math.max(pl.anim, 800);                 // le baril décolle et tournoie (1,15 s) avant d'atterrir
      pl.pre = pl.pre || 0;
      pl.base = { gap: pl.gap };
      plan.push(pl);
    });
    {                                                                                                 // fiches Power/Speed/Defense/Trick : DEUX au maximum par edit (les plus dramatiques), jamais deux fois la même pièce
      const cand = plan.map((pl, i) => ({ i, pl, d: plies[i].drama })).filter((x) => x.pl.pre > 0).sort((a, b) => b.d - a.d), keep = new Set(), seen = new Set();
      cand.forEach((c) => { if (keep.size >= 2 || seen.has(plies[c.i].pid)) return; seen.add(plies[c.i].pid); keep.add(c.i); });
      plan.forEach((pl, i) => { if (pl.pre > 0 && !keep.has(i)) pl.pre = 0; });
    }
    plan.forEach((pl, i) => { if (pl.phase !== "hero" && pl.phase !== "crit" && i + 1 < n && L[i + 1] >= 3 && i >= nOpen) { pl.phase = "tension"; pl.anim = 760; pl.gap = 0.55; pl.base.gap = 0.55; } });   // le calme avant le coup clé
    const dt = (q) => q.pre + q.anim / 1000 + q.freeze + q.gap, t0 = opts.intro ? opts.introDur : 0.4, fixed = () => t0 + (opts.idle || 0) + opts.outroDur;
    const total = () => fixed() + plan.reduce((a, q) => a + dt(q), 0);
    // budget de durée : on resserre d'abord les coups passifs, puis les notables, puis l'ouverture (jamais au point d'aller vite : plancher 55 % du rythme posé)
    for (const phase of ["ff", "mid", "open"]) {
      if (total() <= opts.maxLen) break;
      const sum = plan.filter((q) => q.phase === phase).reduce((a, q) => a + dt(q), 0), over = total() - opts.maxLen;
      if (sum > 0) { const k = Math.max(0.55, (sum - over) / sum); plan.forEach((q) => { if (q.phase === phase) { q.anim *= k; q.gap *= k; } }); }
    }
    if (total() > opts.maxLen) { const hs = plan.filter((q) => q.freeze).reduce((a, q) => a + q.freeze, 0), over = total() - opts.maxLen, k = Math.max(0.6, (hs - over) / Math.max(hs, 0.001)); plan.forEach((q) => { q.freeze *= k; }); }
    const heroIdx0 = (() => { let b = -1; plies.forEach((p, i) => { if (L[i] >= 3 && (b < 0 || p.drama > plies[b].drama)) b = i; }); return b < 0 ? plies.reduce((m, p, i) => (p.drama > plies[m].drama ? i : m), 0) : b; })();
    // ---- adaptation à la musique : quel moment tombe sur le DROP ?
    const impactOf = (i) => t0 + (opts.idle || 0) + plan.slice(0, i).reduce((a, q) => a + dt(q), 0) + plan[i].pre + (plan[i].anim / 1000) * 0.82;
    let heroIdx = heroIdx0, idle = 0, align = null;
    if (audio && opts.syncDrop && audio.mainDropTimestamp > 2) {
      const drop = audio.mainDropTimestamp, cands = plies.map((p, i) => i).filter((i) => L[i] >= 3);
      const list = cands.length ? cands : plies.map((p, i) => i).filter((i) => L[i] >= 2);
      let best = null;
      list.forEach((i) => {
        const T = impactOf(i), gapsBefore = plan.slice(0, i).reduce((a, q) => a + q.gap, 0);
        // feasible : trop tôt -> plan d'ambiance (jusqu'à 28 s) ; trop tard -> on resserre les temps morts (jusqu'à -45 %)
        let how = null, cost = 0;
        if (T <= drop) { const pad = drop - T; if (pad <= 28) { how = { pad }; cost = pad * 0.5; } }
        else { const can = gapsBefore * 0.45; if (T - drop <= can) { how = { shrink: 1 - (T - drop) / Math.max(gapsBefore, 0.001) }; cost = (T - drop) * 1.5; } }
        if (!how) return;
        const score = plies[i].drama - cost + (plies[i].key === "brilliant" ? 30 : 0);
        if (!best || score > best.score) best = { i, how, score };
      });
      if (best) { heroIdx = best.i; align = best.how; if (align.pad) idle = +align.pad.toFixed(3); else plan.slice(0, heroIdx).forEach((q) => { q.gap = Math.max(0.08, q.gap * align.shrink); }); }
    }
    opts.idle = idle;
    // événements
    const botName = (p) => { const l = p.lines.find((x) => x.kind === "transform") || p.lines[0]; return l ? (E.botChat && E.botChat.bots[l.bot] ? E.botChat.bots[l.bot].name : l.bot) : ""; };
    let t = t0 + idle, ffRun = 0, lastThumb = -99;
    plies.forEach((p, i) => {
      const pl = plan[i], kind = i === heroIdx ? "drop" : pl.phase === "hero" || pl.phase === "crit" ? "crit" : pl.phase === "ff" ? "ff" : pl.phase === "tension" ? "mid" : pl.phase;
      ffRun = pl.phase === "ff" ? ffRun + 1 : 0;
      const slot = { kind }, key = p.key;
      // logos seulement, pas de texte ; 👍 rare (un « meilleur coup » toutes les 8 coups au plus), le reste = logos d'alerte et brillant
      let bd = null;
      if (BADGES[key] && key !== "excellent") { if (key !== "best" || (L[i] >= 1 && i - lastThumb >= 8)) { bd = BADGES[key]; if (key === "best") lastThumb = i; } }
      const impact = +(t + pl.pre + (pl.anim / 1000) * 0.82).toFixed(3);
      const th = kind === "ff" ? [] : threatsFrom(p.fen, p.to), stats = pl.pre > 0 && p.from ? pieceStats(p.fenBefore, p.from, p.sacrifice) : null;
      const e = { t: +t.toFixed(3), ply: p.i, n: p.n, pid: p.pid, san: p.san, uci: p.uci, from: p.from, to: p.to, piece: p.piece, color: p.color, captured: p.captured, promo: p.promo, key, drama: p.drama, tags: p.tags,
        lines: L[i] >= 2 ? p.lines : [], fen: p.fen, drop: !!p.drop, special: p.special || "", smash: p.smash || [], filled: p.filled || [], elim: p.elim || [], dropPiece: p.dropPiece || "", kind, phase: pl.phase, lvl: L[i], dur: Math.round(pl.anim), pre: pl.pre, freeze: +pl.freeze.toFixed(3), impact, ev: p.ev, threats: pl.phase === "ff" || pl.phase === "open" ? [] : th, stats, badge: bd, sacrifice: p.sacrifice, ffRun: kind === "ff" && ffRun >= 6, check: p.check, mate: p.mate,
        fx: kind === "ff" ? "FASTFORWARD" : fxOf(p, slot), text: kind === "ff" ? "" : textOf(p), shot: kind === "ff" ? "" : shotOf(p, slot), tone: kind === "ff" ? "green" : toneOf(p),
        cut: kind === "ff" ? null : cutOf(p, slot, botName(p) ? "GM " + botName(p).toUpperCase() : ""), invert: (key === "brilliant" || (p.sacrifice && L[i] >= 2 && key !== "blunder")) };
      ev.push(e); t += dt(pl);
    });
    const end = +(t + 0.2).toFixed(3);
    // son : les bruits de base calés à la frame sur l'impact de chaque coup, les voix de Levy sur le SACRIFICE d'une pièce (jamais deux voix à moins de 2,4 s)
    const sfx = [];
    ev.forEach((e) => {
      const id = e.mate ? "mate" : e.promo ? "promote" : e.check ? "check" : e.captured ? "capture" : "move";
      sfx.push({ t: e.impact, id, gain: e.kind === "ff" ? 0.38 : e.lvl >= 2 ? 1 : 0.8, bus: "sfx", ply: e.n });
      if (e.key === "brilliant") sfx.push({ t: +(e.impact + 0.02).toFixed(3), id: "brilliant", gain: 0.9, bus: "sfx", ply: e.n });
    });
    ev.forEach((e) => {                                                                              // impact sonore de la fiche de stats : coup grave puis « whoosh » de sortie
      if (e.stats && e.pre > 0) { sfx.push({ t: +e.t.toFixed(3), id: "boom", gain: 1.1, bus: "sfx", ply: e.n }); sfx.push({ t: +(e.t + e.pre - 0.3).toFixed(3), id: "whoosh", gain: 0.7, bus: "sfx", ply: e.n }); }
    });
    if (opts.voices) {                                                                               // VOIX DE LEVY : UNIQUEMENT sur les coups BRILLANTS (jamais sur une erreur, une gaffe, un mat…), une seule par coup
      const chosen = [];
      ev.filter((e) => e.key === "brilliant").forEach((e) => { if (chosen.every((x) => Math.abs(x.impact - e.impact) >= 2.4)) chosen.push(e); });
      chosen.forEach((e) => { const id = VOICE[e.piece] || "this_is_the_way"; sfx.push({ t: +(e.impact + 0.04).toFixed(3), id, gain: id === "the_rook" ? 3.2 : 1.3, wet: id === "the_rook" ? 2.2 : 1, bus: "voice", ply: e.n }); });
    }
    sfx.sort((a, b) => a.t - b.t);
    const all = [];
    if (opts.intro) all.push({ t: 0, kind: "intro", dur: opts.introDur, intro: introInfo(rec), fx: "INTRO", ply: -1 });
    if (idle > 0.5) all.push({ t: t0, kind: "idle", dur: idle, fx: "IDLE", ply: -1 });
    ev.forEach((e) => all.push(e));
    const firstOpen = ev.find((e) => e.phase === "open");
    if (opts.opening && firstOpen) all.push({ t: +(firstOpen.t + 0.4).toFixed(3), kind: "title", dur: 4.5, text: opts.opening, fx: "TITLE", ply: -1 });
    all.sort((a, b) => a.t - b.t);
    all.push({ t: end, kind: "outro", dur: opts.outroDur, result: rec.result || "", intro: introInfo(rec), fx: "OUTRO", ply: n });
    const dur = +(end + opts.outroDur).toFixed(3), key = ev.filter((e) => e.lvl >= 2), hero = ev[heroIdx];
    return { viral: true, events: all, key, duration: dur, plies: n, musicStart: 0, sfx, align, stats: { open: nOpen, ff: ev.filter((e) => e.kind === "ff").length, crit: key.length, hero: hero ? hero.n : 0, freeze: +ev.reduce((a, e) => a + e.freeze, 0).toFixed(1), idle,
      heroT: hero ? hero.impact : 0, drop: audio && audio.mainDropTimestamp ? audio.mainDropTimestamp : 0 } };
  }

  // ---------------------------------------------------------------- manifeste JSON (pont Godot)
  function manifest(rec, tl, audio, opts) {
    opts = opts || {};
    return {
      version: tl.viral ? 2 : 1, variant: !!rec.variant, generator: "E.N.O.S. Chess Edit Studio",
      audio: { path: opts.audioPath || "", name: opts.audioName || "", duration: audio ? audio.duration : tl.duration, mainDrop: audio ? audio.mainDropTimestamp : null, buildUpStart: audio ? audio.buildUpStart : null,
        preDropSilence: audio ? audio.preDropSilence : null, hardBeats: audio ? audio.hardBeats : [], introBeats: audio ? audio.introBeats : [], vocalPeaks: audio ? audio.vocalPeaks : [], start_offset: tl.musicStart || 0 },
      pacing: tl.viral ? { mode: "viral", opening: (tl.events.find((e) => e.kind === "title") || {}).text || "", duration: tl.duration, stats: tl.stats || {}, outro_t: (tl.events.find((e) => e.kind === "outro") || {}).t || tl.duration } : { mode: "music" },
      sfx: tl.viral ? tl.sfx : [],
      intro: tl.viral ? (tl.events.find((e) => e.kind === "intro") || {}).intro || null : null,
      game: { title: rec.title || "", white: rec.pw || "Blancs", black: rec.pb || "Noirs", result: rec.result || "", pgn: rec.pgn || "", plies: tl.plies, flip: rec.me === "b" },
      events: tl.events.filter((e) => e.from || e.drop).map((e) => ({
        t: +e.t.toFixed(3), ply: e.n, san: e.san, uci: e.uci, color: e.color, piece: e.piece, captured: e.captured, promotion: e.promo, from: e.from, to: e.to, from_xy: sqXY(e.from || e.to), to_xy: sqXY(e.to), drop: !!e.drop, special: e.special || "", smash: e.smash || [],
        effect: e.fx, tone: e.tone, kind: e.kind, quality: e.key || "", drama: e.drama || 0, tags: e.tags || [], cutscene: e.cut ? { text: e.cut.text, piece: e.cut.piece, t: +((e.cutT != null ? e.cutT : e.t)).toFixed(3), duration: 0.8 } : null,
        overlay_text: e.text || "", shot: e.shot || "", dur: e.dur != null ? +(e.dur / 1000).toFixed(3) : 0.3, freeze: e.freeze || 0, impact: e.impact != null ? e.impact : e.t, badge: e.badge ? { glyph: e.badge.glyph, label: e.badge.label, color: e.badge.color } : null, level: e.lvl != null ? e.lvl : 0, phase: e.phase || "", pre: e.pre || 0, eval_cp: e.ev == null ? null : e.ev, threats: e.threats || [], stats: e.stats ? { piece: e.stats.name, color: e.stats.color, square: e.stats.sq, ...e.stats.vals } : null, texts: (e.lines || []).map((l) => ({ bot: l.bot, text: l.text, kind: l.kind })), fast_forward: e.kind === "ff", fen_after: e.fen || "",
      })),
    };
  }

  E.editMap = { gamePlies, autoSlots, manualSlots, assign, build, buildViral, manifest, sqXY, BADGES, lvlOf, introInfo, reach, threatsFrom, pieceStats, mapOf };
})();
