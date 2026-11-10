"use strict";
// CHESS EDIT — SIMULTANÉE : « ETO contre ton équipe, un plateau chacun ». Le montage est un long couloir de plateaux : la caméra suit ETO qui, après avoir joué, COURT hors de l'écran vers le plateau suivant
// (il sort par un bord, la caméra le rejoint), arrive en face du joueur et joue son coup sous ses yeux. Des flèches et des mini-plateaux montrent en permanence où en sont les autres membres de l'équipe.
// build(rec, audio, opts) -> timeline compatible avec l'export / l'aperçu ; Renderer = sous-classe du moteur canvas (intro d'équipe, outro, bloom WebGL réutilisés).
(() => {
  const E = window.ENOS, RR = E.editRender; if (!RR || !RR.Renderer) return;
  const SM = (E.editSimul = {}), EASE = RR.EASE, fenMapOf = RR.fenMapOf, clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, k) => a + (b - a) * k, TAU = Math.PI * 2;
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", VOICE = { q: "the_queen", r: "the_rook", b: "the_bishop", n: "the_knight" };
  const FONT = (px) => `900 ${Math.round(px)}px Impact, "Arial Black", system-ui, sans-serif`, TXT = (px, w) => `${w || 600} ${Math.round(px)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const TONE = { brilliant: "#00F7FF", best: "#2CE65C", great: "#2CE65C", excellent: "#2CE65C", good: "#8fd16b", blunder: "#ff2020", mistake: "#ff9a1f", miss: "#ff9a1f", inaccuracy: "#f7c631" };
  const MOVE_DUR = 0.62, REPLY_DUR = 0.5;

  // ------------------------------------------------------------------ TIMELINE
  SM.build = (rec, audio, opts) => {
    opts = opts || {}; const M = E.editMap, sim = rec.simul, nB = sim.boards.length, boss = sim.boss, real = !!(audio && audio.duration && !audio.synthetic), INTRO = opts.intro === false ? 0 : 3.8;
    const bds = sim.boards.map((bd, b) => ({ b, name: bd.name, talk: bd.talk, human: bd.human, elo: bd.elo, result: bd.result, plies: M.gamePlies({ t: rec.t, mv: bd.mv, ch: [], pw: boss.name, pb: bd.name }) }));
    // --- les « visites » d'ETO : un coup d'ETO + la réponse du joueur, dans l'ordre réel de la partie
    const all = []; (sim.order || []).forEach(([b, k]) => { const P = bds[b] && bds[b].plies; if (!P || k % 2 || !P[k]) return; const r = P[k + 1], last = (r ? k + 1 : k) === P.length - 1, fin = last && bds[b].result !== "*";
      const bonus = (p) => (p ? (p.key === "brilliant" ? 70 : p.key === "blunder" ? 45 : p.key === "mistake" ? 25 : 0) + (p.mate ? 60 : p.check ? 12 : 0) + (p.captured ? 10 : 0) : 0);
      all.push({ b, kB: k, kR: r ? k + 1 : -1, end: fin, score: P[k].drama + (r ? r.drama : 0) + bonus(P[k]) + bonus(r) + (fin ? 60 : 0) }); });
    if (!all.length) throw new Error("Partie simultanée vide");
    const T = real ? Math.min(audio.duration - 1.4, 110) : 62, per = 3.3, V = Math.max(nB, Math.min(all.length, Math.floor((T - INTRO - 3.8) / per))), req = new Set([0]);
    bds.forEach((bd) => { let f = -1, l = -1; all.forEach((v, i) => { if (v.b === bd.b) { if (f < 0) f = i; l = i; } }); if (f >= 0) { req.add(f); req.add(l); } });
    let pick = all.map((v, i) => i); if (all.length > V) { const rest = pick.filter((i) => !req.has(i)).sort((a, b) => all[b].score - all[a].score).slice(0, Math.max(0, V - req.size)); pick = [...req, ...rest].sort((a, b) => a - b); }
    const vis = pick.map((i) => ({ ...all[i] })), beats = real ? (audio.introBeats || []).concat(audio.hardBeats || []).sort((a, b) => a - b) : [];
    // --- horaire : caméra, ETO, coups sautés (avance rapide), coup d'ETO, réponse
    const seq = bds.map(() => []), applied = bds.map(() => -1); let t = INTRO + 0.35, prevB = vis[0].b;
    vis.forEach((v, j) => {
      const dist = Math.abs(v.b - prevB), pan = j === 0 ? 0 : 0.85 + 0.3 * Math.min(3, dist); v.tPan0 = t; v.tArrive = t + pan; v.dir = Math.sign(v.b - prevB) || 1; v.prevB = prevB; v.pan = pan;
      const skip = []; for (let k = applied[v.b] + 1; k < v.kB; k++) skip.push(k); const inst = Math.max(0, skip.length - 4);
      skip.forEach((k, i) => seq[v.b].push({ k, t0: i < inst ? v.tPan0 + 0.0005 * i : v.tArrive + 0.1 + (i - inst) * 0.17, dur: i < inst ? 0.001 : 0.15, ff: true }));
      const ffEnd = v.tArrive + 0.1 + (skip.length - inst) * 0.17; let imp = Math.max(v.tArrive + 0.45 + MOVE_DUR, ffEnd + 0.15 + MOVE_DUR);
      const bt = beats.find((x) => x >= imp - 0.2 && x <= imp + 0.45); if (bt != null) imp = Math.max(imp, bt);
      v.tMove0 = imp - MOVE_DUR; v.tImp = imp; seq[v.b].push({ k: v.kB, t0: v.tMove0, dur: MOVE_DUR, imp: true });
      if (v.kR >= 0) { v.tR0 = imp + 0.5; v.tRImp = v.tR0 + REPLY_DUR; seq[v.b].push({ k: v.kR, t0: v.tR0, dur: REPLY_DUR, imp: true, reply: true }); }
      v.tOut = (v.kR >= 0 ? v.tRImp : imp) + 0.6 + (v.end ? 1.5 : 0); t = v.tOut; prevB = v.b; applied[v.b] = v.kR >= 0 ? v.kR : v.kB;
    });
    seq.forEach((s) => s.sort((a, b) => a.t0 - b.t0 || a.k - b.k));
    const lastOut = vis[vis.length - 1].tOut, outT = +(lastOut + 0.5).toFixed(3), duration = +(outT + 3.4).toFixed(3);
    // --- infos d'intro / d'outro (intro d'équipe « 4 VS 1 » du moteur)
    const team = sim.team >= 0 ? sim.team : -1, trec = { t: rec.t, title: rec.title, pw: bds.map((b) => b.name).join(" + "), pb: boss.name, result: rec.result, tc: "", teams: { w: bds.map((b) => ({ name: b.name, talk: b.talk, human: b.human, elo: b.elo })), b: [{ name: boss.name, talk: boss.talk, human: false, elo: boss.elo }] } };
    const info = M.introInfo(trec), teamWon = team >= 0, bossWon = !teamWon && bds.every((b) => b.result === "b" || b.result === "w") && bds.every((b) => b.result === "w");
    const events = []; if (INTRO > 0) events.push({ t: 0, kind: "intro", dur: INTRO, intro: info, fx: "INTRO", ply: -1 });
    events.push({ t: outT, kind: "outro", dur: 1.8, result: rec.result || "", intro: info, fx: "OUTRO", ply: -1, winner: teamWon ? { name: "Équipe", color: "w", team: true, mate: true } : bossWon ? { name: boss.name, color: "b", team: false, mate: true } : null, defeat: null });
    // --- sons : un bruitage par coup montré (comme les edits classiques), voix des brillants, FAHH des erreurs / gaffes, « whoosh » à chaque déplacement d'ETO
    const sfx = []; vis.forEach((v, j) => {
      if (j > 0) sfx.push({ t: +(v.tPan0 + 0.05).toFixed(3), id: "whoosh", gain: 0.9, bus: "sfx", ply: -1 });
      [[v.kB, v.tImp], [v.kR, v.tRImp]].forEach(([k, ti]) => { if (k < 0 || ti == null) return; const p = bds[v.b].plies[k], id = p.mate ? "mate" : p.promo ? "promote" : p.check ? "check" : p.captured ? "capture" : "move";
        sfx.push({ t: +ti.toFixed(3), id, gain: 1.3, bus: "echo", ply: k });
        if (id === "capture") sfx.push({ t: +ti.toFixed(3), id: "thud", gain: 1.3, bus: "echo", ply: k }); else if (id === "check") sfx.push({ t: +ti.toFixed(3), id: "crystal", gain: 1.1, bus: "echo", ply: k }); else if (id === "mate") sfx.push({ t: +ti.toFixed(3), id: "mateboom", gain: 1.4, bus: "echo", ply: k });
        if (p.key === "brilliant") { sfx.push({ t: +(ti + 0.02).toFixed(3), id: "brilliant", gain: 0.9, bus: "sfx", ply: k }); sfx.push({ t: +(ti + 0.04).toFixed(3), id: VOICE[p.piece] || "this_is_the_way", gain: 1.3, bus: "voice", level: 0.45, ply: k }); }
        else if (p.key === "blunder") { sfx.push({ t: +ti.toFixed(3), id: "fahh_slow", gain: 1.6, bus: "hit", level: 0.28, ply: k }); sfx.push({ t: +ti.toFixed(3), id: "thud", gain: 1.4, bus: "echo", ply: k }); }
        else if (p.key === "mistake" || p.key === "miss") sfx.push({ t: +ti.toFixed(3), id: "fahh", gain: 1.4, bus: "hit", level: 0.34, ply: k }); });
    });
    sfx.sort((a, b) => a.t - b.t);
    const best = vis.reduce((a, v) => (v.score > a.score ? v : a), vis[0]);
    return { events, sfx, duration, stats: { drop: best.tImp, hero: best.tImp }, plies: [], simul: { boards: bds, vis, seq, nB, boss, info, outT, teamIdx: team, winnerTeam: teamWon }, keys: [] };
  };

  // ------------------------------------------------------------------ RENDU
  class SimulRenderer extends RR.Renderer {
    constructor(canvas, tl, o) { super(canvas, tl, o); this.sim = tl.simul; const W = this.W; this.BW = W * 0.78; this.GAP = W * 0.34; this.R0 = W * 0.092; }
    X(b) { return b * (this.BW + this.GAP); }
    // position d'ETO : il court d'un plateau à l'autre (il sort de l'écran avant la caméra)
    etoPose(t) {
      const vs = this.sim.vis; let x = this.X(vs[0].b), run = 0, dir = 1, hop = 0;
      for (let j = 0; j < vs.length; j++) {
        const v = vs[j], nx = vs[j + 1]; x = this.X(v.b);
        if (t >= v.tArrive && t < v.tArrive + 0.35) hop = Math.sin(clamp((t - v.tArrive) / 0.35, 0, 1) * Math.PI);
        if (nx && t >= v.tOut) { const d = Math.abs(nx.b - v.b), rd = 0.5 + 0.1 * d, p = clamp((t - v.tOut) / rd, 0, 1); x = lerp(this.X(v.b), this.X(nx.b), EASE.out3(p)); dir = Math.sign(nx.b - v.b) || 1; run = p > 0 && p < 1 ? 1 : 0; if (t < nx.tArrive) continue; } else break;
      }
      return { x, run, dir, hop };
    }
    cam(t) {
      const vs = this.sim.vis; let cx = this.X(vs[0].b), z = 1, th = 0;
      for (let j = 0; j < vs.length - 1; j++) { const v = vs[j], nx = vs[j + 1], a = v.tOut + 0.15, b = nx.tArrive; if (t >= b) { cx = this.X(nx.b); continue; } if (t >= a) { const p = clamp((t - a) / Math.max(0.2, b - a), 0, 1), e = EASE.io3(p); cx = lerp(this.X(v.b), this.X(nx.b), e); z = 1 - 0.17 * Math.sin(p * Math.PI); th = 0.035 * Math.sin(p * Math.PI) * (Math.sign(nx.b - v.b) || 1); } break; }
      const ph = vs.find((v) => t >= v.tImp - 0.0 && t < v.tImp + 0.3); if (ph) { const u = t - ph.tImp; z += 0.06 * Math.exp(-u * 9) * Math.sin(u * 40 + 1.2) + 0.03 * Math.exp(-u * 8); }
      return { cx, z, th, bob: Math.sin(t * 0.8) * 4 };
    }
    // état d'un plateau à l'instant t : carte des pièces, pièce en vol, dernier coup
    boardAt(b, t) {
      const S = this.sim, P = S.boards[b].plies, sq = S.seq[b]; let i = -1; for (let k = 0; k < sq.length; k++) { if (sq[k].t0 <= t) i = k; else break; }
      if (i < 0) return { map: fenMapOf(START), mover: null, last: null, ply: null, e: null };
      const e = sq[i], p = P[e.k], done = t >= e.t0 + e.dur; if (done || !p.from) return { map: fenMapOf(p.fen), mover: null, last: [p.from, p.to], ply: p, e };
      const map = fenMapOf(p.fenBefore); delete map[p.from]; return { map, mover: { from: p.from, to: p.to, ch: fenMapOf(p.fenBefore)[p.from], k: EASE.io3(clamp((t - e.t0) / e.dur, 0, 1)), p }, last: [p.from, p.to], ply: p, e };
    }
    sqXY(sq) { const c = 7 - (sq.charCodeAt(0) - 97), r = 7 - (8 - +sq[1]), cell = this.BW / 8; return { x: -this.BW / 2 + (c + 0.5) * cell, y: -this.BW / 2 + (r + 0.5) * cell }; }      // plateau retourné : les Noirs (le joueur) en bas, ETO en face
    draw(t) {
      if (!this.loaded) return; this._now = t; const { ctx, W, H } = this;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
      if (t < this.introEnd - 0.3) { this.drawIntro(t); return; }
      this.drawSimul(ctx, t); if (this.glPost) this.glPost(t);
      this.drawHud(ctx, t);
      if (this.outro && t >= this.outro.t + 0.2) this.drawEnd(ctx, t);
      if (t < this.introEnd) { const k = (t - (this.introEnd - 0.3)) / 0.3; ctx.save(); ctx.globalAlpha = 1 - EASE.out3(clamp(k, 0, 1)); this.drawIntro(this.introEnd - 0.3); ctx.restore(); }
    }
    drawSimul(g, t) {
      const { W, H } = this, S = this.sim, c = this.cam(t), k = this.k(), post = this.outro && t >= this.outro.t;
      g.fillStyle = "#07080c"; g.fillRect(0, 0, W, H); const bg = g.createRadialGradient(W / 2, H * 0.5, W * 0.1, W / 2, H * 0.5, H * 0.75); bg.addColorStop(0, "#1a1e2b"); bg.addColorStop(1, "#05060a"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
      // petits faisceaux de lumière qui défilent avec la caméra (profondeur)
      g.save(); g.globalCompositeOperation = "lighter"; for (let i = -4; i < 14; i++) { const x = (((i * 0.37 * W) - c.cx * 0.25) % (W * 1.6) + W * 1.6) % (W * 1.6) - W * 0.3; g.globalAlpha = 0.045; g.fillStyle = "#9fc2ff"; g.fillRect(x, 0, 4 * k, H); } g.restore();
      g.save(); g.translate(W / 2, H / 2 + c.bob); g.rotate(c.th); g.scale(c.z, c.z); g.translate(-c.cx, 0);
      const shake = this.shakeAt(t); g.translate(shake.x, shake.y);
      for (let b = 0; b < S.nB; b++) this.drawBoardOne(g, b, t, c);
      this.drawEto(g, t); g.restore();
    }
    shakeAt(t) { let x = 0, y = 0; this.sim.vis.forEach((v) => { const u = t - v.tImp; if (u >= 0 && u < 0.2) { const a = (v.end ? 16 : 9) * this.k() * Math.exp(-u / 0.05); x += Math.sin(u * 190) * a; y += Math.cos(u * 170) * a; } }); return { x, y }; }
    drawBoardOne(g, b, t, c) {
      const S = this.sim, BW = this.BW, cell = BW / 8, k = this.k(), st = this.boardAt(b, t), X = this.X(b), foc = clamp(1 - Math.abs(X - c.cx) / (BW + this.GAP), 0, 1), sc = lerp(0.84, 1, foc), bd = S.boards[b];
      g.save(); g.translate(X, 0); g.scale(sc, sc);
      // socle + cadre lumineux
      const fr = BW * 0.045; this.glowAt(g, "#8fb4ff", 0, 0, BW * 0.95, 0.12 + 0.18 * foc); g.fillStyle = "#0e1016"; g.fillRect(-BW / 2 - fr, -BW / 2 - fr, BW + fr * 2, BW + fr * 2); g.strokeStyle = foc > 0.7 ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.18)"; g.lineWidth = 3 * k; g.strokeRect(-BW / 2 - fr, -BW / 2 - fr, BW + fr * 2, BW + fr * 2);
      g.save(); g.translate(0, 0); g.scale(-1, -1); g.drawImage(this.boards.contrast, -BW / 2, -BW / 2, BW, BW); g.restore();                    // plateau retourné (180°)
      // dernier coup + éclat du coup d'ETO / de la réponse
      if (st.last && st.last[0]) { const tone = (st.ply && TONE[st.ply.key]) || "#8fd16b"; st.last.forEach((q, i) => { const P = this.sqXY(q); g.save(); g.globalAlpha = 0.5; g.fillStyle = tone; g.fillRect(P.x - cell / 2, P.y - cell / 2, cell, cell); g.restore(); this.glowAt(g, tone, P.x, P.y, cell * 1.7, 0.35); }); }
      // pièces
      Object.keys(st.map).sort((a, q) => (a[1] === q[1] ? 0 : +q[1] - +a[1])).forEach((sq) => { const P = this.sqXY(sq); g.save(); g.globalAlpha = 0.28; g.fillStyle = "#000"; g.beginPath(); g.ellipse(P.x, P.y + cell * 0.36, cell * 0.3, cell * 0.08, 0, 0, TAU); g.fill(); g.restore(); this.piece(g, st.map[sq], P.x, P.y, cell * 1.02, {}); });
      if (st.mover) { const m = st.mover, A = this.sqXY(m.from), Bq = this.sqXY(m.to), x = lerp(A.x, Bq.x, m.k), y = lerp(A.y, Bq.y, m.k), kn = m.ch && m.ch.toLowerCase() === "n", lift = kn ? Math.sin(m.k * Math.PI) * cell * 0.9 : Math.sin(m.k * Math.PI) * cell * 0.22;
        this.glowAt(g, "#ffffff", x, y - lift, cell * 0.9, 0.25 * Math.sin(m.k * Math.PI)); this.piece(g, m.ch, x, y - lift, cell * 1.02, { scale: 1 + (kn ? 0.3 : 0.1) * Math.sin(m.k * Math.PI), rot: 0.18 * Math.sin(m.k * Math.PI) * (Math.sign(Bq.x - A.x) || 1) }); }
      // impact : onde + badge du coup
      const e = st.e; if (e && e.imp && st.ply) { const u = t - (e.t0 + e.dur); if (u >= 0 && u < 0.9) { const P = this.sqXY(st.ply.to), tone = TONE[st.ply.key] || "#ffffff";
        for (let i = 0; i < 2; i++) { const kk = (u - i * 0.1) / 0.5; if (kk > 0 && kk < 1) { g.save(); g.globalAlpha = (1 - kk) * 0.9; g.strokeStyle = i ? "#fff" : tone; g.lineWidth = cell * 0.09 * (1 - kk * 0.6); g.beginPath(); g.arc(P.x, P.y, cell * (0.4 + 1.5 * EASE.out3(kk)), 0, TAU); g.stroke(); g.restore(); } }
        const spr = this.badgeSpr["img/badges/" + st.ply.key + ".png"]; if (spr && ["brilliant", "blunder", "mistake", "miss", "best", "great", "excellent", "inaccuracy"].includes(st.ply.key)) { const bk = EASE.back(clamp(u / 0.22, 0, 1)), fade = u > 0.7 ? 1 - (u - 0.7) / 0.2 : 1, sz = cell * 0.62 * bk; g.save(); g.globalAlpha = clamp(fade, 0, 1); g.drawImage(spr, P.x + cell * 0.22, P.y - cell * 0.78, sz, sz); g.restore(); } } }
      // joueur du plateau (bas) : avatar, nom, résultat
      const info = S.info.teams.w[b] || {}, ay = BW / 2 + this.R0 * 1.55, win = bd.result === "b", lose = bd.result === "w", ring = win ? "#2CE65C" : lose ? "#6d7388" : "#ffffff";
      g.save(); g.globalAlpha = lerp(0.55, 1, foc); this.sceneDisc(g, info, 0, ay, this.R0 * 0.82, ring, 1, win ? "happy" : lose ? "sad" : undefined); this.sceneName(g, info.name || bd.name, 0, ay + this.R0 * 1.55, BW * 0.9, 46 * k, "#fff", 1);
      g.font = TXT(26 * k, 700); g.textAlign = "center"; g.fillStyle = "#8d93ab"; g.fillText("PLATEAU " + (b + 1), 0, ay + this.R0 * 1.55 + 40 * k); g.restore();
      // bannière de fin de plateau
      const fin = S.vis.filter((v) => v.b === b && v.end).pop(); if (fin) { const u = t - (fin.kR >= 0 ? fin.tRImp : fin.tImp) - 0.25; if (u > 0) { const a = EASE.out3(clamp(u / 0.35, 0, 1)); g.save(); g.globalAlpha = a * 0.8; g.fillStyle = "#04050a"; g.fillRect(-BW / 2, -BW * 0.11, BW, BW * 0.22); g.globalAlpha = a; g.fillStyle = win ? "#2CE65C" : "#cfd3e6"; g.fillRect(-BW / 2, -BW * 0.11, BW, 5 * k); g.fillRect(-BW / 2, BW * 0.11 - 5 * k, BW, 5 * k);
        g.font = FONT(BW * 0.1); g.textAlign = "center"; g.textBaseline = "middle"; g.lineWidth = 8 * k; g.strokeStyle = "#000"; const lab = win ? "VICTOIRE !" : bd.result === "d" ? "NULLE" : "PERDU"; g.strokeText(lab, 0, -BW * 0.02); g.fillStyle = "#fff"; g.fillText(lab, 0, -BW * 0.02); g.font = TXT(BW * 0.045, 700); g.fillStyle = "#cfd3e6"; g.fillText(win ? (bd.name + " bat " + S.boss.name).toUpperCase() : "", 0, BW * 0.06); g.restore(); } }
      // plateau pas encore / plus au premier plan : voile
      g.fillStyle = "rgba(4,5,10," + (0.55 * (1 - foc)).toFixed(3) + ")"; g.fillRect(-BW / 2 - fr, -BW / 2 - fr, BW + fr * 2, BW + fr * 2 + this.R0 * 4);
      g.restore();
    }
    drawEto(g, t) {
      const S = this.sim, pose = this.etoPose(t), k = this.k(), R = this.R0 * 1.15, boss = S.info.teams.b[0] || {}, vs = S.vis, thinking = vs.find((v) => t >= v.tArrive && t < v.tImp), cur = vs.find((v) => t >= v.tImp - 0.1 && t < v.tOut);
      const mood = pose.run ? "alert" : thinking ? "think" : cur ? (S.boards[cur.b].plies[cur.kB].key === "brilliant" ? "wow" : /blunder|mistake/.test(S.boards[cur.b].plies[cur.kB].key) ? "sad" : "happy") : "smile";
      const bob = pose.run ? Math.abs(Math.sin(t * 22)) * 26 * k : pose.hop * 40 * k, y = -this.BW / 2 - R * 1.5 - bob, lean = pose.run ? 0.22 * pose.dir : 0;
      if (pose.run) for (let i = 5; i >= 1; i--) { g.save(); g.globalAlpha = 0.08 * (6 - i); this.glowAt(g, "#00F7FF", pose.x - pose.dir * i * R * 0.45, y, R * 1.25, 0.5); g.restore(); }
      g.save(); g.globalAlpha = 0.35; g.fillStyle = "#000"; g.beginPath(); g.ellipse(pose.x, -this.BW / 2 - R * 0.25, R * (0.9 - bob / (R * 6)), R * 0.18, 0, 0, TAU); g.fill(); g.restore();
      g.save(); g.translate(pose.x, y); g.rotate(lean); this.glowAt(g, "#ffffff", 0, 0, R * 2.1, 0.22); this.sceneDisc(g, boss, 0, 0, R, "#ffffff", 1, mood); g.restore();
      this.sceneName(g, boss.name || S.boss.name, pose.x, y - R * 1.45, this.BW, 50 * k, "#fff", 1);
    }
    // ---- HUD : flèches vers les plateaux voisins (avec mini-plateau), tableau de bord de tous les plateaux
    drawHud(g, t) {
      if (this.outro && t >= this.outro.t + 0.1) return; const { W, H } = this, S = this.sim, k = this.k(), c = this.cam(t), foc = Math.round(c.cx / (this.BW + this.GAP)), cur = clamp(foc, 0, S.nB - 1);
      // flèches gauche / droite
      [-1, 1].forEach((d) => { const nb = cur + d; if (nb < 0 || nb >= S.nB) return; const pulse = 0.5 + 0.5 * Math.sin(t * 4 + d), sz = 168 * k, x = d < 0 ? 18 * k : W - 18 * k - sz, y = H * 0.5 - sz / 2 - 30 * k;
        g.save(); g.globalAlpha = 0.9; g.fillStyle = "rgba(8,10,16,.72)"; this.rr(g, x, y, sz, sz + 52 * k, 22 * k); g.fill(); g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 2 * k; g.stroke(); g.restore();
        this.drawMini(g, nb, x + 10 * k, y + 10 * k, sz - 20 * k, t, true); g.save(); g.font = TXT(24 * k, 700); g.textAlign = "center"; g.fillStyle = "#e6e9f5"; const nm = String(S.info.teams.w[nb].name || "").toUpperCase(); g.fillText(nm.length > 12 ? nm.slice(0, 11) + "…" : nm, x + sz / 2, y + sz + 36 * k); g.restore();
        g.save(); g.translate(d < 0 ? x + sz + 22 * k + pulse * 8 * k * -1 : x - 22 * k + pulse * 8 * k, y + sz / 2); g.scale(d, 1); g.globalAlpha = 0.7 + 0.3 * pulse; g.strokeStyle = "#fff"; g.lineWidth = 9 * k; g.lineCap = "round"; g.lineJoin = "round"; g.beginPath(); g.moveTo(-14 * k, -34 * k); g.lineTo(14 * k, 0); g.lineTo(-14 * k, 34 * k); g.stroke(); this.glowAt(g, "#ffffff", 0, 0, 60 * k, 0.4 * pulse); g.restore(); });
      // tableau de bord en bas : tous les plateaux
      const ms = Math.min(150 * k, (W - 60 * k) / S.nB - 14 * k), tot = S.nB * ms + (S.nB - 1) * 14 * k, x0 = (W - tot) / 2, y0 = H - ms - 120 * k;
      g.save(); g.fillStyle = "rgba(6,8,13,.7)"; this.rr(g, x0 - 16 * k, y0 - 14 * k, tot + 32 * k, ms + 28 * k, 24 * k); g.fill(); g.restore();
      for (let b = 0; b < S.nB; b++) { const x = x0 + b * (ms + 14 * k); this.drawMini(g, b, x, y0, ms, t, b === cur); }
      // score d'équipe + titre
      const done = S.boards.filter((b, i) => { const lastV = S.vis.filter((v) => v.b === i && v.end).pop(); return b.result !== "*" && lastV && t >= (lastV.kR >= 0 ? lastV.tRImp : lastV.tImp); }), wins = done.filter((b) => b.result === "b").length;
      g.save(); g.textAlign = "center"; g.font = TXT(28 * k, 800); g.fillStyle = "#aab1c9"; g.fillText("SIMULTANÉE · " + String(S.boss.name).toUpperCase(), W / 2, 74 * k); g.font = TXT(22 * k, 700); g.fillStyle = wins ? "#2CE65C" : "#7d8399"; g.fillText(wins ? "L'ÉQUIPE A GAGNÉ UN PLATEAU !" : "IL SUFFIT QU'UN SEUL GAGNE", W / 2, 108 * k); g.restore();
    }
    rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
    drawMini(g, b, x, y, size, t, focus) {
      const st = this.boardAt(b, t), cell = size / 8, S = this.sim; g.save(); g.translate(x, y);
      g.drawImage(this.boards.contrast, 0, 0, size, size); g.save(); g.translate(size, size); g.scale(-1, -1); g.restore();
      if (st.last && st.last[0]) st.last.forEach((q) => { const c = 7 - (q.charCodeAt(0) - 97), r = 7 - (8 - +q[1]); g.fillStyle = "rgba(0,247,255,.45)"; g.fillRect(c * cell, r * cell, cell, cell); });
      Object.keys(st.map).forEach((sq) => { const c = 7 - (sq.charCodeAt(0) - 97), r = 7 - (8 - +sq[1]); this.piece(g, st.map[sq], (c + 0.5) * cell, (r + 0.5) * cell, cell * 1.05, {}); });
      const bd = S.boards[b], lastV = S.vis.filter((v) => v.b === b && v.end).pop(), over = lastV && t >= (lastV.kR >= 0 ? lastV.tRImp : lastV.tImp);
      if (over) { g.fillStyle = bd.result === "b" ? "rgba(44,230,92,.35)" : "rgba(20,22,30,.55)"; g.fillRect(0, 0, size, size); g.font = FONT(size * 0.42); g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#fff"; g.fillText(bd.result === "b" ? "✔" : bd.result === "d" ? "=" : "✕", size / 2, size / 2); }
      if (focus) { g.strokeStyle = "#fff"; g.lineWidth = 4; g.strokeRect(-2, -2, size + 4, size + 4); } else { g.strokeStyle = "rgba(255,255,255,.25)"; g.lineWidth = 2; g.strokeRect(0, 0, size, size); }
      const act = st.e && st.e.imp && t - st.e.t0 < 1.0 && t >= st.e.t0; if (act && !focus) { g.fillStyle = "rgba(255,255,255," + (0.35 * (1 - (t - st.e.t0))).toFixed(3) + ")"; g.fillRect(0, 0, size, size); }
      g.restore();
    }
  }
  SM.Renderer = SimulRenderer;
})();
