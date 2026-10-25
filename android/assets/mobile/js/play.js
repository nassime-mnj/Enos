"use strict";
// ÉCHECS SUR LE TÉLÉPHONE : jouer contre le Stockfish du PC (niveau réglable) et analyser tes parties (PGN collé depuis Chess.com) avec les conseils d'ETO.
// Le PC fait tout le calcul (service sans état /api/mobile/chess/*) ; le téléphone dessine le plateau. Hors ligne : écran verrouillé avec « reconnecter ».
// Analyse d'une partie TERMINÉE seulement : pas d'aide en direct (contre des humains ce serait de la triche).
(() => {
  const E = window.ENOS, $ = E.$, esc = E.esc, U = E.ui, B = E.board, L = E.link;
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const G = { fen: START, me: "w", power: 55, hist: [], busy: false, last: null, sel: "", hint: null, legal: [], over: "", flip: false, ev: null };
  const KEYLAB = { brilliant: ["Brillant", "#1acfd6"], best: ["Meilleur", "#7bd64d"], excellent: ["Excellent", "#9ecc38"], good: ["Bon", "#739e66"], inaccuracy: ["Imprécision", "#f5c542"], mistake: ["Erreur", "#f5a524"], blunder: ["Gaffe", "#ff4d63"] };

  // Parties : moteur local (chess_local.js), sans PC. Seule l'ANALYSE de partie (review) passe par le PC.
  const api = async (path, body) => {
    if (!/\/review/.test(path)) return E.chessLocal.call(path, body);
    const r = await L.api(path, { method: "POST", body });
    const j = r.json() || {};
    if (r.status !== 200) throw new Error(j.detail || "Erreur " + r.status);
    return j;
  };

  // ------------------------------------------------------------------ structure
  function build() {
    const sv = document.createElement("div");
    sv.id = "tool-chess"; sv.className = "subview"; sv.hidden = true;
    sv.innerHTML = `<button class="back" data-back>◂ MODULES</button>
      <div id="ch-lock" class="card locked" hidden><h2>PC hors ligne</h2><p>Les échecs utilisent le Stockfish de ton PC. Allume-le et reste sur le même Wi-Fi.</p><div class="row"><button class="btn" id="ch-retry">RECONNECTER</button></div></div>
      <div id="ch-main">
        <div class="seg" id="ch-seg" data-p="enos"><button data-t="play" class="on">JOUER</button><button data-t="review">ANALYSER</button><i class="seg-ind"></i></div>
        <div id="ch-play">
          <div class="card" style="padding:12px">
            <div class="ch-top"><span id="ch-status" class="muted">À toi de jouer</span><span id="ch-lvl" class="chip"></span><button class="chip" id="ch-snd" aria-label="Son des coups" style="min-width:44px;min-height:34px">🔊</button></div>
            <div class="ch-evalbar"><i id="ch-eval"></i><b id="ch-evtxt">0,0</b></div>
            <div id="ch-board"></div>
            <div class="ch-moves" id="ch-moves"></div>
            <div class="ch-say" id="ch-say" hidden title="Toucher pour écouter"></div>
            <div class="ch-credit">Pièces : Vecteezy « Chess board with pieces set »</div>
            <div class="row"><button class="btn" id="ch-new">NOUVELLE PARTIE</button><button class="btn" id="ch-hint">INDICE</button></div>
            <div class="row" style="margin-top:8px"><button class="btn" id="ch-undo">ANNULER</button><button class="btn" id="ch-flip">RETOURNER</button></div>
          </div>
        </div>
        <div id="ch-review" hidden>
          <div class="card">
            <h3>Analyser une partie</h3>
            <p class="muted" style="margin-bottom:10px;font-size:14px">Joue contre un bot sur Chess.com, puis <b>Partager › PGN › copier</b> et colle ici. Le PC juge chaque coup, ETO t'explique comment progresser.</p>
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

  function paint(anim) {
    const pos = B.parse(G.fen);
    const targets = G.sel ? G.legal.filter((u) => u.startsWith(G.sel)).map((u) => u.slice(2, 4)) : [];
    B.render($("#ch-board"), pos.m, { flip: G.flip, last: G.last, hint: G.hint, sel: G.sel, targets, check: G.check ? B.kingSquare(pos.m, pos.turn) : "", onTap, anim });
    $("#ch-lvl").textContent = `Niveau ${B.powerToElo(G.power)} Elo`;
    const e = G.ev;
    if (e) {
      const w = e.mate != null ? (e.mate > 0 ? 100 : 0) : B.winPct(e.cp);
      $("#ch-eval").style.setProperty("--w", (G.me === "w" ? w : 100 - w) + "%");
      $("#ch-evtxt").textContent = e.mate != null ? "M" + Math.abs(e.mate) : (e.cp / 100 * (G.me === "w" ? 1 : -1)).toFixed(1).replace(".", ",").replace(/^(\d)/, "+$1");
    }
    $("#ch-moves").innerHTML = G.hist.map((h, i) => `<span>${i % 2 === 0 ? (i / 2 + 1) + "." : ""}${esc(h.san)}</span>`).join("");
    $("#ch-moves").scrollLeft = 1e5;
  }

  function onTap(sq) {
    if (!myTurn()) return;
    const pos = B.parse(G.fen), p = pos.m[sq];
    if (G.sel && G.legal.some((u) => u.startsWith(G.sel) && u.slice(2, 4) === sq)) return move(G.sel, sq, pos);
    if (p && (p === p.toUpperCase()) === (G.me === "w")) { G.sel = sq; G.hint = null; E.vibrate(6); } else G.sel = "";
    paint();
  }

  async function move(from, to, pos) {
    const isPromo = pos.m[from].toLowerCase() === "p" && (to[1] === "8" || to[1] === "1");
    let uci = from + to;
    if (isPromo) {
      uci += await new Promise((res) => U.sheet({ title: "Promotion", options: [["q", "Dame"], ["r", "Tour"], ["b", "Fou"], ["n", "Cavalier"]].map(([c, n]) => ({ label: n, fn: () => res(c) })), onClose: () => res("q") }));
    }
    G.busy = true; G.sel = ""; G.hint = null;
    const fenBefore = G.fen;
    G.last = [from, to];
    let san0 = "", anim = "";
    try { const m0 = new Chess(fenBefore).move({ from, to, promotion: uci[4] }); san0 = m0 ? m0.san : ""; } catch (e) { /* le moteur dira si le coup est illégal */ }
    B.render($("#ch-board"), B.applyUci(pos, uci), { flip: G.flip, last: G.last, onTap, anim: uci });      // la pièce glisse aussitôt (la FEN officielle arrive avec la réponse)
    E.chessSound.forSan(san0 || uci);
    status(`${E.settings.get("persona", "enos") === "eto" ? "ETO" : "E.N.O.S."} réfléchit…`);
    E.vibrate(10);
    try {
      const r = await api("/api/mobile/chess/play", { fen: fenBefore, uci, power: G.power, answer: true });
      G.hist.push({ fen: fenBefore, san: r.san });
      if (r.reply) G.hist.push({ fen: null, san: r.reply.san });
      G.fen = r.fen; G.legal = r.legal; G.check = r.check; G.over = r.over; G.ev = r.eval;
      G.last = r.reply ? [r.reply.uci.slice(0, 2), r.reply.uci.slice(2, 4)] : [from, to];
      if (r.reply) { anim = r.reply.uci; E.chessSound.forSan(r.reply.san); }
      status(r.over || (r.check ? "Échec !" : "À toi de jouer"));
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
    G.me = color; G.power = power; G.fen = START; G.hist = []; G.last = null; G.sel = ""; G.hint = null; G.over = ""; G.check = false; G.ev = null; G.flip = color === "b";
    E.settings.set("chess.power", power);
    G.busy = true; paint(); status("Préparation…");
    let anim = "";
    try {
      if (color === "b") {
        const r = await api("/api/mobile/chess/engine", { fen: START, power });
        G.hist.push({ fen: START, san: r.reply.san }); G.fen = r.fen; G.legal = r.legal; G.last = [r.reply.uci.slice(0, 2), r.reply.uci.slice(2, 4)]; G.ev = r.eval;
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
  function startReview() {
    const pgn = $("#rv-pgn").value.trim();
    if (pgn.length < 20) return U.toast("Colle d'abord le PGN de la partie.", "warn");
    E.settings.set("chesscom", $("#rv-user").value.trim());
    if (L.state !== "online") return U.toast("L'analyse de partie utilise le PC : allume-le et reste sur le même Wi-Fi.", "warn", 5000);
    $("#rv-go").disabled = true; $("#rv-prog").hidden = false; $("#rv-prog i").style.width = "4%"; $("#rv-out").innerHTML = "";
    api("/api/mobile/chess/review", { pgn, me: "auto", username: $("#rv-user").value.trim() }).then((j) => poll(j.job)).catch((e) => { U.toast(e.message, "warn", 6000); $("#rv-go").disabled = false; $("#rv-prog").hidden = true; });
  }
  async function poll(job) {
    for (let i = 0; i < 200; i++) {
      await E.sleep(1100);
      let s;
      try { const r = await L.api("/api/mobile/chess/review/" + job); s = r.json(); } catch (e) { continue; }
      if (!s) continue;
      $("#rv-prog i").style.width = Math.max(4, Math.round((s.progress || 0) * 100)) + "%";
      if (s.state === "done") { $("#rv-go").disabled = false; $("#rv-prog").hidden = true; revRes = s.result; step = 0; showReview(); if (E.chessLearn) E.chessLearn.addReview(s.result); E.vibrate(25); return; }
      if (s.state === "error") { U.toast("Analyse impossible : " + s.error, "warn", 7000); break; }
    }
    $("#rv-go").disabled = false; $("#rv-prog").hidden = true;
  }

  function graph(evals) {
    if (!evals.length) return "";
    const W = 300, H = 70, n = evals.length;
    const pts = evals.map((v, i) => `${(i / Math.max(1, n - 1) * W).toFixed(1)},${(H - B.winPct(v) / 100 * H).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 ${W} ${H}" class="rv-graph" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#2a2a30" stroke-dasharray="3 3"/><polyline points="${pts}" fill="none" stroke="var(--red2)" stroke-width="2" stroke-linejoin="round"/></svg>`;
  }

  function showReview() {
    const r = revRes, rv = r.review, me = rv.me, h = r.headers;
    const counts = Object.entries(me.counts).filter(([, v]) => v).map(([k, v]) => `<span class="kchip" style="--c:${KEYLAB[k][1]}">${KEYLAB[k][0]} <b>${v}</b></span>`).join("");
    const crit = rv.critical.map((c, i) => `<div class="it crit" data-i="${i}"><span class="n">Coup ${Math.ceil(c.n / 2)} · ${esc(c.san)}<small>${esc(c.label)} · −${c.loss} cp${c.best ? " · mieux : " + esc(c.best) : ""}</small></span><span class="tag hot">VOIR</span></div>`).join("");
    $("#rv-out").innerHTML = `
      <div class="card"><h3>${esc(h.White)} vs ${esc(h.Black)}<span class="sp">${esc(h.Result)}</span></h3>
        <div class="muted" style="margin-bottom:10px;font-size:14px">${r.opening ? esc(r.opening) + " · " : ""}Tu jouais les ${r.me === "w" ? "Blancs" : "Noirs"}${r.truncated ? " · partie tronquée à 160 demi-coups" : ""}</div>
        <div class="rv-stats"><div><small>PRÉCISION</small><b>${me.accuracy == null ? "—" : me.accuracy + "%"}</b></div><div><small>NIVEAU ESTIMÉ</small><b>${me.elo || "—"}</b></div><div><small>PERTE MOY.</small><b>${me.acpl == null ? "—" : me.acpl}</b></div></div>
        <div class="kchips">${counts}</div>${graph(rv.evals)}</div>
      <div class="card"><h3>Conseils d'ETO<button class="mini" id="rv-say">🔊 ÉCOUTER</button></h3><p class="rv-advice">${esc(r.advice)}</p></div>
      ${crit ? `<div class="card"><h3>Moments clés</h3><div class="list" id="rv-crit">${crit}</div></div>` : ""}
      <div class="card"><h3>Revoir la partie<span class="sp" id="rv-step"></span></h3><div id="rv-board"></div>
        <div class="row"><button class="btn" id="rv-prev">◂</button><button class="btn" id="rv-next">▸</button></div></div>`;
    $("#rv-say").onclick = () => E.ai.speak("eto", r.advice);
    $("#rv-prev").onclick = () => { step = Math.max(0, step - 1); paintStep(); };
    $("#rv-next").onclick = () => { step = Math.min(r.fens.length - 1, step + 1); paintStep(); };
    const cr = $("#rv-crit");
    if (cr) cr.onclick = (e) => { const it = e.target.closest(".crit"); if (!it) return; const c = rv.critical[+it.dataset.i]; step = c.n - 1; paintStep(c); $("#rv-board").scrollIntoView({ behavior: "smooth", block: "center" }); };
    paintStep();
  }
  function paintStep(c) {
    const r = revRes, fen = r.fens[step], pos = B.parse(fen);
    const u = step > 0 ? r.uci[step - 1] : "";
    const hint = c && c.best_uci && c.n - 1 === step ? [c.best_uci.slice(0, 2), c.best_uci.slice(2, 4)] : null;
    B.render($("#rv-board"), pos.m, { flip: r.me === "b", last: u ? [u.slice(0, 2), u.slice(2, 4)] : null, hint });
    const k = step > 0 ? r.keys[step - 1] : "";
    $("#rv-step").innerHTML = step === 0 ? "position de départ" : `coup ${Math.ceil(step / 2)}${step % 2 ? "" : "…"} <span class="kchip" style="--c:${KEYLAB[k][1]}">${KEYLAB[k][0]}</span>`;
  }

  // ------------------------------------------------------------------ branchement
  function applyLink() {
    $("#ch-lock").hidden = true; $("#ch-main").hidden = false;                 // jouer ne demande plus le PC
  }
  function init() {
    build();
    const seg = $("#ch-seg");
    seg.querySelectorAll("button").forEach((b) => (b.onclick = () => {
      seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      seg.dataset.p = b.dataset.t === "play" ? "enos" : "eto";
      $("#ch-play").hidden = b.dataset.t !== "play"; $("#ch-review").hidden = b.dataset.t !== "review";
    }));
    $("#ch-new").onclick = newSheet;
    const snd = () => { $("#ch-snd").textContent = E.settings.get("chess.sound", true) ? "🔊" : "🔇"; };
    $("#ch-snd").onclick = () => { E.settings.set("chess.sound", !E.settings.get("chess.sound", true)); snd(); E.chessSound.play("move"); };
    snd();
    $("#ch-flip").onclick = () => { G.flip = !G.flip; paint(); };
    $("#ch-hint").onclick = async () => {
      if (!myTurn()) return;
      try { const h = await api("/api/mobile/chess/hint", { fen: G.fen }); G.hint = [h.uci.slice(0, 2), h.uci.slice(2, 4)]; G.sel = ""; status("Indice : " + h.san); paint(); } catch (e) { status("✕ " + e.message); }
    };
    $("#ch-undo").onclick = () => {
      if (G.busy || G.hist.length < 2) return;
      const target = G.hist.length % 2 === 0 ? G.hist[G.hist.length - 2] : G.hist[G.hist.length - 1];
      if (!target || !target.fen) return;
      G.hist.length = G.hist.length - (G.hist.length % 2 === 0 ? 2 : 1);
      G.fen = target.fen; G.last = null; G.sel = ""; G.hint = null; G.over = ""; G.ev = null;
      api("/api/mobile/chess/state", { fen: G.fen }).then((r) => { G.legal = r.legal; }).catch(() => {});
      status("Coup annulé"); paint();
    };
    $("#ch-retry").onclick = () => L.probeNow();
    $("#rv-go").onclick = startReview;
    $("#rv-user").value = E.settings.get("chesscom", "");
    E.on("link", applyLink); applyLink();
    paint();
  }
  E.chessUi = { init, open() { if (!G.hist.length && G.fen === START) { paint(); } } };
})();
