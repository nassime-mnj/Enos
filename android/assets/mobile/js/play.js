"use strict";
// ÉCHECS SUR LE TÉLÉPHONE : jouer contre le Stockfish embarqué (niveau réglable) et analyser tes parties (PGN collé depuis Chess.com) avec les conseils d'ETO.
// Tout est local (chess_local.js + chess_review.js) : aucun PC requis. Les contre-ETO / Titans / Boss sont dans le module « Défis » (m_defis.js).
(() => {
  const E = window.ENOS, $ = E.$, esc = E.esc, U = E.ui, B = E.board, L = E.link;
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const G = { fen: START, me: "w", power: 55, hist: [], busy: false, last: null, sel: "", hint: null, legal: [], over: "", flip: false, ev: null, badge: null, arrows: null, view: -1, line: { fens: [START], ucis: [], sans: [], keys: [] }, seen: E.chessLocal.startSeen(START) };    // seen : passages de chaque position (pas de nulle par répétition)
  const KEYLAB = { brilliant: ["Brillant", "#1acfd6"], book: ["Théorie", "#a8896c"], best: ["Meilleur", "#7bd64d"], excellent: ["Excellent", "#9ecc38"], good: ["Bon", "#739e66"], inaccuracy: ["Imprécision", "#f5c542"], mistake: ["Erreur", "#f5a524"], blunder: ["Gaffe", "#ff4d63"] };

  // Parties ET analyse de partie : moteur local (chess_local.js / chess_review.js), sans PC.
  const api = (path, body) => E.chessLocal.call(path, body);

  // ------------------------------------------------------------------ structure
  function build() {
    const sv = document.createElement("div");
    sv.id = "tool-chess"; sv.className = "subview"; sv.hidden = true;
    sv.innerHTML = `<button class="back" data-back>◂ MODULES</button>
      <div id="ch-main">
        <div class="seg" id="ch-seg" data-p="enos"><button data-t="play" class="on">JOUER</button><button data-t="review">ANALYSER</button><i class="seg-ind"></i></div>
        <div id="ch-play">
          <div class="card" style="padding:12px">
            <div class="ch-top"><span id="ch-status" class="muted">À toi de jouer</span><span id="ch-lvl" class="chip"></span><button class="chip" id="ch-snd" aria-label="Son des coups" style="min-width:44px;min-height:34px">🔊</button></div>
            <div class="ch-evalbar"><i id="ch-eval"></i><b id="ch-evtxt">0,0</b></div>
            <div id="ch-board"></div>
            <div class="ch-nav"><button id="ch-first" aria-label="Début">⏮</button><button id="ch-prev" aria-label="Coup précédent">◂</button><span id="ch-pos">Début</span><button id="ch-next" aria-label="Coup suivant">▸</button><button id="ch-last" aria-label="Position actuelle">⏭</button></div>
            <div class="ch-moves" id="ch-moves"></div>
            <div class="ch-cand" id="ch-cand"><div class="ch-candb"><button data-k="best">★ MEILLEUR</button><button data-k="brilliant">!! BRILLANTS</button><button data-k="excellent">EXCELLENTS</button><button data-k="good">BONS</button></div><div class="ch-candl" id="ch-candl" hidden></div></div>
            <div class="ch-say" id="ch-say" hidden title="Toucher pour écouter"></div>
            <div class="ch-credit">Pièces : Vecteezy « Chess board with pieces set »</div>
            <div class="row"><button class="btn" id="ch-new">NOUVELLE PARTIE</button><button class="btn" id="ch-hint">INDICE</button></div>
            <div class="row" style="margin-top:8px"><button class="btn" id="ch-undo">ANNULER</button><button class="btn" id="ch-flip">RETOURNER</button></div>
            <div class="row" style="margin-top:8px"><button class="btn" id="ch-defis">✦ ETO BRILLANT &amp; DÉFIS</button><button class="btn" id="ch-adv">📷 CONSEILLER</button></div>
            <div class="row" style="margin-top:8px"><button class="btn" id="ch-bilan">📊 BILAN DE LA PARTIE</button><button class="btn" id="ch-course">🎓 COURS EN DIRECT</button></div>
          </div>
        </div>
        <div id="ch-review" hidden>
          <div class="card">
            <h3>Analyser une partie</h3>
            <p class="muted" style="margin-bottom:10px;font-size:14px">Joue contre un bot sur Chess.com, puis <b>Partager › PGN › copier</b> et colle ici. Chaque coup est jugé sur ton téléphone, ETO t'explique comment progresser.</p>
            <textarea id="rv-pgn" class="ta" rows="5" placeholder="Colle le PGN de la partie ici…" spellcheck="false"></textarea>
            <label class="fld" style="padding:10px 0 0">Ton pseudo Chess.com<input id="rv-user" type="text" style="max-width:48%;height:40px;padding:0 10px;border-radius:10px;border:1px solid var(--line);background:#0a0a0c;color:var(--text);font:600 15px var(--ui)" autocapitalize="off" spellcheck="false"></label>
            <div class="row"><button class="btn pri" id="rv-go">ANALYSER LA PARTIE</button></div>
            <div class="rv-prog" id="rv-prog" hidden><i></i></div>
          </div>
          <div id="rv-out"></div>
        </div>
      </div>`;
    $(".view[data-v=tools] .scroll").insertBefore(sv, $(".view[data-v=tools] .foot-pad"));
  }

  // ------------------------------------------------------------------ jouer
  const turnOf = () => B.parse(G.fen).turn;
  const myTurn = () => !G.over && !G.busy && turnOf() === G.me;
  const status = (t) => { $("#ch-status").textContent = t; };

  /** Revue d'un coup passé : G.view = indice dans G.line.fens (-1 = position en direct). */
  const viewing = () => G.view >= 0 && G.view < G.line.fens.length - 1;
  const shown = () => (viewing() ? G.line.fens[G.view] : G.fen);
  function goView(i) {
    const n = G.line.fens.length - 1, prev = G.view < 0 ? n : G.view;
    G.view = i >= n ? -1 : Math.max(0, i); G.sel = ""; G.hint = null; G.arrows = null; G.demoBadge = null; B.stopDemo && B.stopDemo($("#ch-board")); E.chessTools.stop($("#ch-board"));
    $("#ch-candl").hidden = true;
    const at = G.view < 0 ? n : G.view, u = at > 0 ? G.line.ucis[at - 1] : "";
    const fwd = (G.view < 0 ? n : G.view) === prev + 1;                              // l'animation de glissement seulement en avançant d'un coup
    paint(u && fwd && !G.busy ? u : "");
    if (u && fwd) { try { E.chessSound.forSan(G.line.sans[at - 1]); } catch (e) { /* son facultatif */ } }
  }

  function paint(anim) {
    const rev = viewing(), fen = shown(), pos = B.parse(fen), at = rev ? G.view : G.line.fens.length - 1, u = at > 0 ? G.line.ucis[at - 1] : "";
    const last = rev ? (u ? [u.slice(0, 2), u.slice(2, 4)] : null) : G.last, key = at > 0 ? G.line.keys[at - 1] : "";
    const badge = rev ? (key && B.BADGES[key] ? { sq: u.slice(2, 4), key, id: "v" + at } : null) : G.badge;
    const targets = !rev && G.sel ? G.legal.filter((v) => v.startsWith(G.sel)).map((v) => v.slice(2, 4)) : [];
    const chk = rev ? new Chess(fen).in_check() : G.check;
    B.render($("#ch-board"), pos.m, { flip: G.flip, last, hint: rev ? null : G.hint, sel: rev ? "" : G.sel, targets, check: chk ? B.kingSquare(pos.m, pos.turn) : "", badge, arrows: G.arrows, end: !rev && G.over && G.check ? { sq: B.kingSquare(pos.m, pos.turn), id: G.hist.length } : null, onTap, anim });
    $("#ch-pos").textContent = at === 0 ? "Début" : `Coup ${Math.ceil(at / 2)}${at % 2 ? "" : "…"} · ${G.line.sans[at - 1]}` + (rev ? " (revue)" : "");
    $("#ch-first").disabled = $("#ch-prev").disabled = at === 0; $("#ch-next").disabled = $("#ch-last").disabled = !rev;
    $("#ch-board").classList.toggle("reviewing", rev);
    $("#ch-lvl").textContent = `Niveau ${B.powerToElo(G.power)} Elo`;
    const e = G.ev;
    if (e) {
      const w = e.mate != null ? (e.mate > 0 ? 100 : 0) : B.winPct(e.cp);
      $("#ch-eval").style.setProperty("--w", (G.me === "w" ? w : 100 - w) + "%");
      $("#ch-evtxt").textContent = e.mate != null ? "M" + Math.abs(e.mate) : (e.cp / 100 * (G.me === "w" ? 1 : -1)).toFixed(1).replace(".", ",").replace(/^(\d)/, "+$1");
    }
    $("#ch-moves").innerHTML = G.line.sans.map((sn, i) => { const k = G.line.keys[i], bd = k && B.BADGES[k] ? `<em style="color:${B.BADGES[k][1]}">${B.BADGES[k][0]}</em>` : ""; return `<span data-i="${i + 1}"${i + 1 === at ? ' class="cur"' : ""}>${i % 2 === 0 ? (i / 2 + 1) + "." : ""}${esc(sn)}${bd}</span>`; }).join("");
    const cur = $("#ch-moves .cur"); if (cur) cur.scrollIntoView({ block: "nearest", inline: "center" }); else $("#ch-moves").scrollLeft = 1e5;
  }

  function onTap(sq) {
    E.chessTools.stop($("#ch-board")); if (G.arrows) { G.arrows = null; $("#ch-candl").querySelectorAll(".cd-it.on").forEach((x) => x.classList.remove("on")); paint(); }
    if (viewing()) { goView(G.line.fens.length); U.toast("Retour à la partie en cours", "ok", 1400); return; }
    if (!myTurn()) return;
    const pos = B.parse(G.fen), p = pos.m[sq];
    if (G.sel && G.legal.some((u) => u.startsWith(G.sel) && u.slice(2, 4) === sq)) return move(G.sel, sq, pos);
    if (p && (p === p.toUpperCase()) === (G.me === "w")) { G.sel = sq; G.hint = null; E.vibrate(6); } else G.sel = "";
    paint();
  }

  /** Jugement de mon coup (Brillant, Meilleur, Gaffe…) : évalue la position avant et après avec le moteur du téléphone. null si indisponible. */
  async function judgeMine(fenBefore, uci) {
    try {
      const K = E.brain, color = fenBefore.split(" ")[1], ch = new Chess(fenBefore);
      const m = ch.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (!m) return null;
      const before = await K.evaluate(fenBefore, 450), after = await K.evaluate(ch.fen(), 450);
      const j = await K.judge(fenBefore, uci, before, after, color, 450);
      let q = j.q;
      if (before.best && uci === before.best && q.key !== "brilliant" && q.loss <= 8) q = { ...q, key: "best" };
      return q && KEYLAB[q.key] ? { key: q.key, loss: q.loss } : null;
    } catch (e) { return null; }
  }

  async function move(from, to, pos) {
    const isPromo = pos.m[from].toLowerCase() === "p" && (to[1] === "8" || to[1] === "1");
    let uci = from + to;
    if (isPromo) {
      uci += await new Promise((res) => U.sheet({ title: "Promotion", options: [["q", "Dame"], ["r", "Tour"], ["b", "Fou"], ["n", "Cavalier"]].map(([c, n]) => ({ label: n, fn: () => res(c) })), onClose: () => res("q") }));
    }
    G.busy = true; G.sel = ""; G.hint = null; G.arrows = null; G.view = -1; $("#ch-candl").hidden = true; E.chessTools.stop($("#ch-board"));
    const fenBefore = G.fen;
    G.last = [from, to]; G.badge = null;
    let san0 = "", anim = "";
    try { const m0 = new Chess(fenBefore).move({ from, to, promotion: uci[4] }); san0 = m0 ? m0.san : ""; } catch (e) { /* le moteur dira si le coup est illégal */ }
    B.render($("#ch-board"), B.applyUci(pos, uci), { flip: G.flip, last: G.last, onTap, anim: uci });      // la pièce glisse aussitôt (la FEN officielle arrive avec la réponse)
    E.chessSound.forSan(san0 || uci);
    status(`${E.settings.get("persona", "enos") === "eto" ? "ETO" : "E.N.O.S."} réfléchit…`);
    E.vibrate(10);
    let mine = null, replied = false;                                           // jugement de MON coup (affiché dès qu'il est prêt, pendant que l'adversaire réfléchit)
    const judged = judgeMine(fenBefore, uci).then((j) => {
      mine = j;
      if (j && !replied) B.render($("#ch-board"), B.applyUci(pos, uci), { flip: G.flip, last: [from, to], onTap, badge: { sq: to, key: j.key, id: "m" + G.hist.length } });
      return j;
    });
    try {
      const r = await api("/api/mobile/chess/play", { fen: fenBefore, uci, power: G.power, answer: true, seen: G.seen });
      replied = true; await Promise.race([judged, new Promise((res) => setTimeout(res, 2500))]);
      G.hist.push({ fen: fenBefore, san: r.san, seen: G.seen, key: mine ? mine.key : "" });
      if (r.seen) G.seen = r.seen;
      { const c1 = new Chess(fenBefore); c1.move({ from, to, promotion: uci[4] }); G.line.fens.push(c1.fen()); G.line.ucis.push(uci); G.line.sans.push(r.san); G.line.keys.push(mine ? mine.key : ""); }
      if (r.reply) { G.hist.push({ fen: null, san: r.reply.san }); G.line.fens.push(r.fen); G.line.ucis.push(r.reply.uci); G.line.sans.push(r.reply.san); G.line.keys.push(r.reply.brilliant ? "brilliant" : ""); }
      else G.line.fens[G.line.fens.length - 1] = r.fen;
      G.fen = r.fen; G.legal = r.legal; G.check = r.check; G.over = r.over; G.ev = r.eval;
      G.last = r.reply ? [r.reply.uci.slice(0, 2), r.reply.uci.slice(2, 4)] : [from, to];
      if (r.reply) { anim = r.reply.uci; E.chessSound.forSan(r.reply.san); G.badge = r.reply.brilliant ? { sq: r.reply.uci.slice(2, 4), key: "brilliant", id: G.hist.length } : null; }
      const verdict = mine ? "Ton coup : " + KEYLAB[mine.key][0] + " · " : "";
      status(r.over || verdict + (r.reply && r.reply.brilliant ? "✨ Coup brillant !! " + (r.check ? "Échec !" : "À toi de jouer") : r.check ? "Échec !" : "À toi de jouer"));
      if (mine && mine.key === "brilliant") E.vibrate([30, 40, 30]);
      if (r.reply && r.reply.brilliant) E.vibrate([30, 40, 30]);
      if (r.over) { E.vibrate(40); if (E.chessLearn) E.chessLearn.addGame(G.me, r.over, G.power); }
      comment(r);
    } catch (e) { G.fen = fenBefore; G.last = null; anim = ""; status("✕ " + e.message); }
    G.busy = false;
    paint(anim);
  }

  // E.N.O.S. commente la partie (Groq, une phrase) ; toucher la phrase la fait lire à voix haute. Sans clé Groq : silence.
  let cmtSeq = 0;
  function comment(r) {
    const box = $("#ch-say");
    if (!box || !E.ai.configured() || !E.settings.get("chess.comment", true) || !r.reply) { if (box) box.hidden = true; return; }
    const seq = ++cmtSeq, persona = E.settings.get("persona", "enos") === "eto" ? "eto" : "enos";
    const moves = G.hist.slice(-6).map((h) => h.san).join(" ");
    const ev = r.eval ? (r.eval.mate != null ? "mat en " + Math.abs(r.eval.mate) + (r.eval.mate > 0 ? " pour les Blancs" : " pour les Noirs") : "évaluation " + (r.eval.cp / 100).toFixed(1) + " (positif = avantage Blancs)") : "";
    const q = `Partie d'échecs. Tu joues les ${G.me === "w" ? "Noirs" : "Blancs"}, ${E.ai.name()} les ${G.me === "w" ? "Blancs" : "Noirs"}. Derniers coups : ${moves}. Ton coup : ${r.reply.san}. ${ev}. ${r.over ? "La partie est finie : " + r.over + "." : ""} Commente en UNE phrase courte, dans ton style, sans notation en liste.`;
    box.hidden = false; box.textContent = "…";
    E.ai.chat(persona, q, () => {}, { oneShot: true, system: E.ai.PERSONAS[persona].system(E.ai.name()) + " Tu es en pleine partie d'échecs : une seule phrase." })
      .then((t) => { if (seq === cmtSeq) { box.textContent = t; box.onclick = () => E.ai.speak(persona, t); } })
      .catch(() => { if (seq === cmtSeq) box.hidden = true; });
  }

  async function newGame(color, power) {
    G.me = color; G.power = power; G.fen = START; G.hist = []; G.line = { fens: [START], ucis: [], sans: [], keys: [] }; G.view = -1; G.arrows = null; G.seen = E.chessLocal.startSeen(START); G.last = null; G.badge = null; G.sel = ""; G.hint = null; G.over = ""; G.check = false; G.ev = null; G.flip = color === "b";
    E.settings.set("chess.power", power);
    G.busy = true; paint(); status("Préparation…");
    let anim = "";
    try {
      if (color === "b") {
        const r = await api("/api/mobile/chess/engine", { fen: START, power, seen: G.seen });
        G.hist.push({ fen: START, san: r.reply.san }); G.line.fens.push(r.fen); G.line.ucis.push(r.reply.uci); G.line.sans.push(r.reply.san); G.line.keys.push(r.reply.brilliant ? "brilliant" : ""); if (r.seen) G.seen = r.seen; G.fen = r.fen; G.legal = r.legal; G.last = [r.reply.uci.slice(0, 2), r.reply.uci.slice(2, 4)]; G.ev = r.eval;
        anim = r.reply.uci; E.chessSound.forSan(r.reply.san);
      } else {
        G.legal = (await api("/api/mobile/chess/state", { fen: START })).legal;
      }
      status("À toi de jouer");
    } catch (e) { status("✕ " + e.message); }
    G.busy = false; paint(anim);
  }

  function newSheet() {
    let color = "w", power = E.settings.get("chess.power", 55);
    const s = U.sheet({ title: "Nouvelle partie", html: `
      <div class="seg" id="nw-seg" style="margin-bottom:14px"><button data-c="w" class="on">BLANCS</button><button data-c="b">NOIRS</button><i class="seg-ind"></i></div>
      <label class="fld">Niveau de l'adversaire <b id="nw-elo"></b></label><input type="range" id="nw-pow" min="1" max="100" value="${power}" style="width:100%;accent-color:var(--red);margin-bottom:12px">
      <div class="row"><button class="btn pri" id="nw-go">JOUER</button></div>` });
    const seg = s.querySelector("#nw-seg"), el = s.querySelector("#nw-elo"), pw = s.querySelector("#nw-pow");
    const upd = () => { power = +pw.value; el.textContent = B.powerToElo(power) + " Elo" + (power >= 100 ? " (max)" : ""); };
    pw.oninput = upd; upd();
    seg.querySelectorAll("button").forEach((b) => (b.onclick = () => { color = b.dataset.c; seg.dataset.p = color === "w" ? "enos" : "eto"; seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); }));
    s.querySelector("#nw-go").onclick = () => { U.closeSheet(); newGame(color, power); };
  }

  // ------------------------------------------------------------------ analyser
  let revRes = null, step = 0;
  async function startReview(meColor) {
    const pgn = $("#rv-pgn").value.trim();
    if (pgn.length < 20) return U.toast("Colle d'abord le PGN de la partie.", "warn");
    E.settings.set("chesscom", $("#rv-user").value.trim());
    $("#rv-go").disabled = true; $("#rv-prog").hidden = false; $("#rv-prog i").style.width = "4%"; $("#rv-out").innerHTML = "";
    try {
      revRes = await E.brain.reviewGame({ pgn, me: meColor === "w" || meColor === "b" ? meColor : "auto", username: $("#rv-user").value.trim(), onProgress: (p) => { $("#rv-prog i").style.width = Math.max(4, Math.round(p * 100)) + "%"; } });
      step = 0; showReview(); if (E.chessLearn) E.chessLearn.addReview(revRes); E.vibrate(25);
    } catch (e) { U.toast(e.message, "warn", 7000); }
    $("#rv-go").disabled = false; $("#rv-prog").hidden = true;
  }

  // Bilan INTERACTIF (façon Chess.com) : précision des deux camps, courbe cliquable, catégories filtrables (Brillants, Meilleurs… Gaffes), plateau avec flèches, liste complète des coups.
  const RV = { step: 0, side: "all", key: "" };
  function graph(evals, step) {
    if (!evals.length) return "";
    const W = 300, H = 70, n = evals.length;
    const pts = evals.map((v, i) => `${(i / Math.max(1, n - 1) * W).toFixed(1)},${(H - B.winPct(v) / 100 * H).toFixed(1)}`).join(" ");
    const cx = step > 0 ? ((step - 1) / Math.max(1, n - 1) * W).toFixed(1) : -5;
    return `<svg viewBox="0 0 ${W} ${H}" class="rv-graph" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#2a2a30" stroke-dasharray="3 3"/><polyline points="${pts}" fill="none" stroke="var(--red2)" stroke-width="2" stroke-linejoin="round"/><line x1="${cx}" x2="${cx}" y1="0" y2="${H}" stroke="#fff" stroke-width="1.5" opacity=".8"/></svg>`;
  }
  const sideOf = (r, j) => (j.color === r.me ? "me" : "op");
  const visible = (r) => r.judged.map((j, i) => i).filter((i) => { const j = r.judged[i]; return (RV.side === "all" || sideOf(r, j) === RV.side) && (!RV.key || j.key === RV.key); });

  function showReview() {
    const r = revRes, rv = r.review, me = rv.me, op = rv.engine, h = r.headers, bot = E.settings.get("persona", "enos") === "eto" ? "ETO" : "Adversaire";
    RV.step = 0; RV.side = "all"; RV.key = "";
    const crit = rv.critical.map((c, i) => `<div class="it crit" data-i="${i}"><span class="n">Coup ${Math.ceil(c.n / 2)} · ${esc(c.san)}<small>${esc(c.label)} · −${c.loss} cp${c.best ? " · mieux : " + esc(c.best) : ""}</small></span><span class="tag hot">VOIR</span></div>`).join("");
    const panel = (title, s, tone) => `<div class="rv-side ${tone}"><small>${title}</small><b>${s.accuracy == null ? "—" : s.accuracy + "%"}</b><span>≈ ${s.elo || "—"} Elo · perte moy. ${s.acpl == null ? "—" : s.acpl}</span></div>`;
    $("#rv-out").innerHTML = `
      <div class="card"><h3>${esc(h.White)} vs ${esc(h.Black)}<span class="sp">${esc(h.Result)}</span></h3>
        <div class="muted" style="margin-bottom:10px;font-size:14px">${r.opening ? esc(r.opening) + " · " : ""}Tu jouais les ${r.me === "w" ? "Blancs" : "Noirs"}${r.truncated ? " · partie tronquée à 160 demi-coups" : ""}</div>
        <div class="rv-sides">${panel("TOI", me, "me")}${panel(bot.toUpperCase(), op, "op")}</div>
        <div id="rv-graphbox"></div><p class="muted" style="font-size:12px;margin-top:4px">Touche la courbe pour aller à ce moment.</p></div>
      <div class="card"><h3>Catégories<span class="sp" id="rv-who"></span></h3>
        <div class="seg" id="rv-sidesel" data-p="enos" style="margin-bottom:10px"><button data-s="all" class="on">LES DEUX</button><button data-s="me">MOI</button><button data-s="op">${esc(bot.toUpperCase())}</button><i class="seg-ind"></i></div>
        <div class="kchips rv-keys" id="rv-keys"></div>
        <div class="rv-cat" id="rv-cat" hidden><button class="btn" id="rv-cprev">◂ PRÉCÉDENT</button><span id="rv-ccount"></span><button class="btn" id="rv-cnext">SUIVANT ▸</button></div></div>
      <div class="card"><h3>Revoir la partie<span class="sp" id="rv-step"></span></h3>
        <div class="ch-evalbar"><i id="rv-eval"></i><b id="rv-evtxt">0,0</b></div>
        <div id="rv-board"></div>
        <div class="ch-nav"><button id="rv-first">⏮</button><button id="rv-prev">◂</button><span id="rv-pos"></span><button id="rv-next">▸</button><button id="rv-last">⏭</button></div>
        <div class="rv-note" id="rv-note"></div>
        <div class="row"><button class="btn" id="rv-show" hidden>▶ VOIR LE MEILLEUR COUP</button></div>
        <div class="rv-allm" id="rv-allm"></div></div>
      <div class="card"><h3>Conseils d'ETO<button class="mini" id="rv-say">🔊 ÉCOUTER</button></h3><p class="rv-advice">${esc(r.advice)}</p></div>
      ${crit ? `<div class="card"><h3>Moments clés</h3><div class="list" id="rv-crit">${crit}</div></div>` : ""}`;
    $("#rv-say").onclick = () => E.ai.speak("eto", r.advice);
    $("#rv-first").onclick = () => setStep(0); $("#rv-last").onclick = () => setStep(r.fens.length - 1);
    $("#rv-prev").onclick = () => setStep(RV.step - 1); $("#rv-next").onclick = () => setStep(RV.step + 1);
    $("#rv-cprev").onclick = () => hop(-1); $("#rv-cnext").onclick = () => hop(1);
    $("#rv-allm").onclick = (e) => { const sp = e.target.closest("[data-i]"); if (sp) setStep(+sp.dataset.i); };
    $("#rv-graphbox").onclick = (e) => { const g = e.target.closest("svg"); if (!g) return; const b = g.getBoundingClientRect(); setStep(Math.max(1, Math.min(r.fens.length - 1, Math.round((e.clientX - b.left) / b.width * (rv.evals.length - 1)) + 1))); };
    $("#rv-sidesel").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; RV.side = b.dataset.s; $("#rv-sidesel").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); RV.key = ""; keyChips(); };
    $("#rv-keys").onclick = (e) => { const c = e.target.closest("[data-k]"); if (!c) return; RV.key = RV.key === c.dataset.k ? "" : c.dataset.k; keyChips(); if (RV.key) hop(1); };
    $("#rv-show").onclick = showBest;
    const cr = $("#rv-crit");
    if (cr) cr.onclick = (e) => { const it = e.target.closest(".crit"); if (!it) return; const c = rv.critical[+it.dataset.i]; setStep(c.n - 1); $("#rv-board").scrollIntoView({ behavior: "smooth", block: "center" }); };
    keyChips(); setStep(0);
  }
  function keyChips() {
    const r = revRes, cnt = {};
    r.judged.forEach((j) => { if (RV.side === "all" || sideOf(r, j) === RV.side) cnt[j.key] = (cnt[j.key] || 0) + 1; });
    $("#rv-keys").innerHTML = ["brilliant", "best", "excellent", "good", "book", "inaccuracy", "mistake", "blunder"].filter((k) => cnt[k]).map((k) => `<button class="kchip${RV.key === k ? " on" : ""}" data-k="${k}" style="--c:${KEYLAB[k][1]}">${KEYLAB[k][0]} <b>${cnt[k]}</b></button>`).join("") || '<span class="muted">Aucun coup.</span>';
    $("#rv-cat").hidden = !RV.key;
    $("#rv-who").textContent = RV.key ? KEYLAB[RV.key][0] : "";
    catCount();
  }
  function catCount() {
    if (!RV.key) return;
    const v = visible(revRes), k = v.indexOf(RV.step - 1);
    $("#rv-ccount").textContent = v.length ? `${k >= 0 ? k + 1 : "–"} / ${v.length}` : "0";
  }
  /** Coup suivant (dir 1) ou précédent (dir -1) de la catégorie choisie ; boucle en fin de liste. */
  function hop(dir) {
    const v = visible(revRes); if (!v.length) return;
    const k = v.indexOf(RV.step - 1);
    let to;
    if (k < 0) to = dir > 0 ? (v.find((i) => i >= RV.step - 1) ?? v[0]) : ([...v].reverse().find((i) => i < RV.step - 1) ?? v[v.length - 1]);
    else to = v[(k + dir + v.length) % v.length];
    setStep(to + 1);
  }
  function setStep(s) {
    RV.step = Math.max(0, Math.min(revRes.fens.length - 1, s));
    E.chessTools.stop($("#rv-board"));
    paintStep();
  }
  function paintStep() {
    const r = revRes, rv = r.review, step = RV.step, fen = r.fens[step], pos = B.parse(fen), j = step > 0 ? r.judged[step - 1] : null;
    const u = step > 0 ? r.uci[step - 1] : "", k = j ? j.key : "";
    const arrows = j && j.best_uci && ["inaccuracy", "mistake", "blunder"].includes(k) ? [{ from: u.slice(0, 2), to: u.slice(2, 4), color: B.ARROW.threat, w: 0.13 }] : [];
    B.render($("#rv-board"), pos.m, { flip: r.me === "b", last: u ? [u.slice(0, 2), u.slice(2, 4)] : null, badge: u && B.BADGES[k] ? { sq: u.slice(2, 4), key: k, id: "r" + step } : null, arrows, check: new Chess(fen).in_check() ? B.kingSquare(pos.m, pos.turn) : "" });
    const cp = step > 0 ? rv.evals[step - 1] : 0;
    $("#rv-eval").style.setProperty("--w", (r.me === "w" ? B.winPct(cp) : 100 - B.winPct(cp)) + "%");
    $("#rv-evtxt").textContent = Math.abs(cp) >= 9000 ? "M" : ((cp / 100) * (r.me === "w" ? 1 : -1)).toFixed(1).replace(".", ",").replace(/^(\d)/, "+$1");
    $("#rv-step").innerHTML = step === 0 ? "position de départ" : `coup ${Math.ceil(step / 2)}${step % 2 ? "" : "…"} <span class="kchip" style="--c:${KEYLAB[k][1]}">${KEYLAB[k][0]}</span>`;
    $("#rv-pos").textContent = step === 0 ? "Début" : `${step} / ${r.fens.length - 1}`;
    $("#rv-first").disabled = $("#rv-prev").disabled = step === 0; $("#rv-next").disabled = $("#rv-last").disabled = step >= r.fens.length - 1;
    $("#rv-graphbox").innerHTML = graph(rv.evals, step);
    const who = j ? (sideOf(r, j) === "me" ? "Ton coup" : "Coup de l'adversaire") : "";
    $("#rv-note").innerHTML = j ? `<b style="color:${KEYLAB[k][1]}">${who} · ${KEYLAB[k][0]}</b><br>${esc(E.brain.describe(j, j.san, j.best))}` : '<span class="muted">Utilise ◂ ▸, la courbe, les catégories ou la liste des coups.</span>';
    $("#rv-show").hidden = !(j && j.best_uci);
    $("#rv-allm").innerHTML = r.judged.map((x, i) => { const bd = B.BADGES[x.key]; return `<span data-i="${i + 1}" class="${i + 1 === step ? "cur " : ""}${sideOf(r, x) === "me" ? "mine" : ""}">${i % 2 === 0 ? (i / 2 + 1) + "." : ""}${esc(x.san)}${bd ? `<em style="color:${bd[1]}">${bd[0]}</em>` : ""}</span>`; }).join("");
    const cur = $("#rv-allm .cur"); if (cur) cur.scrollIntoView({ block: "nearest" });
    catCount();
  }
  /** Joue le meilleur coup de la position AVANT le coup jugé (puis le déjoue), avec ses flèches. */
  async function showBest() {
    const r = revRes, j = r.judged[RV.step - 1]; if (!j || !j.best_uci) return;
    const bd = $("#rv-board"), before = r.fens[RV.step - 1], lu = RV.step > 1 ? r.uci[RV.step - 2] : "";
    const it = { uci: j.best_uci, san: j.best, pv: [j.best_uci], key: "best" };
    $("#rv-show").disabled = true;
    await E.chessTools.demo(bd, before, it, { flip: r.me === "b", last: lu ? [lu.slice(0, 2), lu.slice(2, 4)] : null, onPhase: (ph) => { if (ph === "play") $("#rv-note").innerHTML = `<b style="color:#7bd64d">Meilleur coup : ${esc(j.best)}</b>`; } });
    $("#rv-show").disabled = false; paintStep();
  }

  // ------------------------------------------------------------------ coups possibles (meilleur / brillants / excellents / bons)
  const SING = { best: "Meilleur coup", brilliant: "Coup brillant", excellent: "Excellent coup", good: "Bon coup" };
  let candSeq = 0;
  async function showCands(kind) {
    const T = E.chessTools, box = $("#ch-candl"), fen = shown(), grp = T.GROUPS[kind];
    if (G.busy) return;
    if (new Chess(fen).game_over()) { box.hidden = false; box.innerHTML = '<div class="muted">La partie est terminée dans cette position.</div>'; return; }
    document.querySelectorAll("#ch-cand .ch-candb button").forEach((b) => b.classList.toggle("on", b.dataset.k === kind));
    G.arrows = null; T.stop($("#ch-board")); paint();
    const seq = ++candSeq; box.hidden = false;
    box.innerHTML = `<div class="muted ch-wait"><i></i> Recherche : ${grp.label.toLowerCase()}…</div>`;
    let items = [];
    try { items = await T.cands(fen, kind, { ms: kind === "brilliant" ? 900 : 1500 }); } catch (e) { box.innerHTML = `<div class="muted">✕ ${esc(e.message)}</div>`; return; }
    if (seq !== candSeq) return;
    if (!items.length) { box.innerHTML = `<div class="muted">Aucun ${SING[kind].toLowerCase()} dans cette position${kind === "brilliant" ? " (un brillant est un sacrifice qui rapporte : il n'y en a pas ici)" : ""}.</div>`; return; }
    box.innerHTML = items.map((it, i) => `<div class="cd-it" data-i="${i}" style="--c:${grp.color}"><b>${SING[kind]} n°${i + 1}</b><span class="san">${esc(it.san)}</span><small>${T.fmtScore(fen, it)} · suite : ${esc(it.line.slice(1, 5).join(" ") || "—")}</small><button>▶ REVOIR</button></div>`).join("");
    box.onclick = (e) => { const r = e.target.closest(".cd-it"); if (r) demoCand(items[+r.dataset.i], fen, r, grp); };
    demoCand(items[0], fen, box.querySelector(".cd-it"), grp);
  }
  async function demoCand(it, fen, row, grp) {
    const T = E.chessTools, bd = $("#ch-board");
    $("#ch-candl").querySelectorAll(".cd-it").forEach((x) => x.classList.toggle("on", x === row));
    G.arrows = null; G.sel = ""; G.hint = null;
    const at = viewing() ? G.view : G.line.fens.length - 1, u = at > 0 ? G.line.ucis[at - 1] : "";
    const ok = await T.demo(bd, fen, it, { flip: G.flip, last: u ? [u.slice(0, 2), u.slice(2, 4)] : null, onPhase: (ph) => status(ph === "play" ? `${grp.label} : ${it.san}` : ph === "undo" ? "…on revient à la position" : `${it.san} · ${T.fmtScore(fen, it)}`) });
    if (ok) { G.arrows = T.arrowsFor(fen, it); paint(); }
  }

  // ------------------------------------------------------------------ bilan de MA partie (même écran interactif que l'analyse d'un PGN)
  function pgnOfGame() {
    const c = new Chess();
    G.line.ucis.forEach((u) => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }));
    const nm = E.settings.get("persona", "enos") === "eto" ? "ETO" : "E.N.O.S.", mine = "Toi";
    c.header("Event", "Partie ENOS", "White", G.me === "w" ? mine : nm, "Black", G.me === "w" ? nm : mine, "Result", G.over ? (/les Blancs gagnent/.test(G.over) ? "1-0" : /les Noirs gagnent/.test(G.over) ? "0-1" : "1/2-1/2") : "*", "Date", new Date().toISOString().slice(0, 10).replace(/-/g, "."));
    return c.pgn();
  }
  function bilan() {
    if (G.line.ucis.length < 4) return U.toast("Joue au moins quelques coups avant le bilan.", "warn");
    document.querySelector('#ch-seg button[data-t="review"]').click();
    $("#rv-pgn").value = pgnOfGame();
    startReview(G.me);
  }

  // ------------------------------------------------------------------ branchement
  function init() {
    build();
    const seg = $("#ch-seg");
    seg.querySelectorAll("button").forEach((b) => (b.onclick = () => {
      seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      seg.dataset.p = b.dataset.t === "play" ? "enos" : "eto";
      $("#ch-play").hidden = b.dataset.t !== "play"; $("#ch-review").hidden = b.dataset.t !== "review";
    }));
    $("#ch-new").onclick = newSheet;
    $("#ch-first").onclick = () => goView(0);
    $("#ch-prev").onclick = () => goView((viewing() ? G.view : G.line.fens.length - 1) - 1);
    $("#ch-next").onclick = () => goView((viewing() ? G.view : G.line.fens.length - 1) + 1);
    $("#ch-last").onclick = () => goView(G.line.fens.length);
    $("#ch-moves").onclick = (e) => { const sp = e.target.closest("span[data-i]"); if (sp) goView(+sp.dataset.i); };
    $("#ch-cand .ch-candb").onclick = (e) => { const b = e.target.closest("button[data-k]"); if (b) showCands(b.dataset.k); };
    $("#ch-bilan").onclick = bilan;
    $("#ch-course").onclick = () => (E.chessCourse ? E.chessCourse.open() : U.toast("Cours indisponible.", "warn"));
    const snd = () => { $("#ch-snd").textContent = E.settings.get("chess.sound", true) ? "🔊" : "🔇"; };
    $("#ch-snd").onclick = () => { E.settings.set("chess.sound", !E.settings.get("chess.sound", true)); snd(); E.chessSound.play("move"); };
    snd();
    $("#ch-flip").onclick = () => { G.flip = !G.flip; paint(); };
    $("#ch-hint").onclick = async () => {
      if (!myTurn()) return;
      try { const h = await api("/api/mobile/chess/hint", { fen: G.fen, seen: G.seen }); G.hint = [h.uci.slice(0, 2), h.uci.slice(2, 4)]; G.sel = ""; status("Indice : " + h.san); paint(); } catch (e) { status("✕ " + e.message); }
    };
    $("#ch-undo").onclick = () => {
      if (G.busy || G.hist.length < 2) return;
      const target = G.hist.length % 2 === 0 ? G.hist[G.hist.length - 2] : G.hist[G.hist.length - 1];
      if (!target || !target.fen) return;
      const cut = G.hist.length % 2 === 0 ? 2 : 1;
      G.hist.length -= cut; for (const k of Object.keys(G.line)) G.line[k].length -= cut; G.view = -1; G.arrows = null;
      G.fen = target.fen; G.seen = target.seen || E.chessLocal.startSeen(target.fen); G.last = null; G.sel = ""; G.hint = null; G.over = ""; G.ev = null;
      api("/api/mobile/chess/state", { fen: G.fen }).then((r) => { G.legal = r.legal; }).catch(() => {});
      status("Coup annulé"); paint();
    };
    $("#ch-defis").onclick = () => E.modules.open("defis");
    $("#ch-adv").onclick = () => E.modules.open("advisor");
    $("#rv-go").onclick = () => startReview();
    $("#rv-user").value = E.settings.get("chesscom", "");
    paint();
  }
  E.chessUi = { init, open() { if (!G.hist.length && G.fen === START) { paint(); } } };
})();
