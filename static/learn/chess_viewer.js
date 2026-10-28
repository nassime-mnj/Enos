"use strict";
// REVUE DE PARTIE (PC) : la partie jouée dans CHESS (plateau Godot) s'ouvre ici pour être parcourue et étudiée sans rien perdre : ⏮ ◂ ▸ ⏭, liste des coups cliquable avec leurs symboles,
// catégories filtrables (Brillants, Meilleurs… Gaffes), « coups possibles » de n'importe quelle position (meilleur / brillants / excellents / bons : le coup est joué puis déjoué avec flèches),
// meilleur coup d'une erreur. Même moteur et mêmes composants que sur le téléphone (board.js, chess_tools.js, Stockfish.js).
// Données : localStorage "enos_game_view" = {sans:[…], ucis?:[…], judged?:[{key, loss, best, best_uci, label, color, san, after}], me:"w"|"b", startFen?, title?} écrit par static/defi.js.
(() => {
  const E = window.ENOS, esc = E.esc, B = E.board, T = E.chessTools, K = E.brain, $ = (s, r) => (r || document).querySelector(s);
  const KEYLAB = { brilliant: ["Brillant", "#1acfd6"], book: ["Théorie", "#a8896c"], best: ["Meilleur", "#7bd64d"], excellent: ["Excellent", "#9ecc38"], good: ["Bon", "#739e66"], inaccuracy: ["Imprécision", "#f5c542"], mistake: ["Erreur", "#f5a524"], blunder: ["Gaffe", "#ff4d63"] };
  const SING = { best: "Meilleur coup", brilliant: "Coup brillant", excellent: "Excellent coup", good: "Bon coup" };
  const V = { d: null, fens: [], ucis: [], sans: [], keys: [], step: 0, key: "", cand: 0, arrows: null };

  function load() {
    let d = null; try { d = JSON.parse(localStorage.getItem("enos_game_view") || "null"); } catch (e) { d = null; }
    if (!d || !d.sans || !d.sans.length) return null;
    const ch = d.startFen ? new Chess(d.startFen) : new Chess(), fens = [ch.fen()], ucis = [], sans = [];
    for (const s of d.sans) { const m = ch.move(s); if (!m) break; fens.push(ch.fen()); ucis.push(m.from + m.to + (m.promotion || "")); sans.push(m.san); }
    const keys = sans.map((_, i) => (d.judged && d.judged[i] && d.judged[i].key) || (d.keys && d.keys[i]) || "");
    return { d, fens, ucis, sans, keys };
  }

  function mount(el) {
    const g = load();
    if (!g) { el.innerHTML = '<div class="card"><p class="muted">Aucune partie à revoir : joue une partie dans CHESS, puis ouvre la revue.</p></div>'; return; }
    Object.assign(V, g, { step: g.sans.length, key: "", cand: 0, arrows: null });
    const me = g.d.me || "w";
    el.innerHTML = `<div class="card"><h3>${esc(g.d.title || "Revue de la partie")}<span class="sp" id="vw-step"></span></h3>
        <div class="ch-evalbar"><i id="vw-eval"></i><b id="vw-evtxt">0,0</b></div>
        <div id="vw-board"></div>
        <div class="ch-nav"><button id="vw-first">⏮</button><button id="vw-prev">◂</button><span id="vw-pos"></span><button id="vw-next">▸</button><button id="vw-last">⏭</button></div>
        <div class="rv-note" id="vw-note"></div>
        <div class="row"><button class="btn" id="vw-show" hidden>▶ VOIR LE MEILLEUR COUP</button></div>
        <div class="rv-allm" id="vw-all"></div></div>
      <div class="card"><h3>Coups possibles<span class="sp">de la position affichée</span></h3>
        <div class="ch-candb" id="vw-candb"><button data-k="best">★ MEILLEUR</button><button data-k="brilliant">!! BRILLANTS</button><button data-k="excellent">EXCELLENTS</button><button data-k="good">BONS</button></div>
        <div class="ch-candl" id="vw-candl" hidden></div></div>
      <div class="card" id="vw-catcard"><h3>Catégories<span class="sp" id="vw-who"></span></h3><div class="kchips rv-keys" id="vw-keys"></div>
        <div class="rv-cat" id="vw-cat" hidden><button class="btn" id="vw-cprev">◂ PRÉCÉDENT</button><span id="vw-ccount"></span><button class="btn" id="vw-cnext">SUIVANT ▸</button></div></div>`;
    $("#vw-first").onclick = () => go(0); $("#vw-last").onclick = () => go(V.fens.length - 1);
    $("#vw-prev").onclick = () => go(V.step - 1); $("#vw-next").onclick = () => go(V.step + 1);
    $("#vw-all").onclick = (e) => { const s = e.target.closest("[data-i]"); if (s) go(+s.dataset.i); };
    $("#vw-candb").onclick = (e) => { const b = e.target.closest("button[data-k]"); if (b) cands(b.dataset.k); };
    $("#vw-keys").onclick = (e) => { const c = e.target.closest("[data-k]"); if (!c) return; V.key = V.key === c.dataset.k ? "" : c.dataset.k; chips(); if (V.key) hop(1); };
    $("#vw-cprev").onclick = () => hop(-1); $("#vw-cnext").onclick = () => hop(1);
    $("#vw-show").onclick = showBest;
    document.addEventListener("keydown", (e) => { if ($("#tool-game") && $("#tool-game").hidden) return; if (e.key === "ArrowLeft") go(V.step - 1); else if (e.key === "ArrowRight") go(V.step + 1); });
    chips(); go(V.fens.length - 1);
  }
  const me = () => V.d.me || "w";
  const judged = (i) => (V.d.judged && V.d.judged[i]) || null;
  const mineKeys = () => V.keys.map((k, i) => ({ k, i })).filter((x) => x.k && (!V.key || x.k === V.key));
  function chips() {
    const cnt = {}; V.keys.forEach((k) => { if (k) cnt[k] = (cnt[k] || 0) + 1; });
    $("#vw-keys").innerHTML = ["brilliant", "best", "excellent", "good", "book", "inaccuracy", "mistake", "blunder"].filter((k) => cnt[k]).map((k) => `<button class="kchip${V.key === k ? " on" : ""}" data-k="${k}" style="--c:${KEYLAB[k][1]}">${KEYLAB[k][0]} <b>${cnt[k]}</b></button>`).join("") || '<span class="muted">Aucun jugement disponible pour cette partie.</span>';
    $("#vw-cat").hidden = !V.key; $("#vw-who").textContent = V.key ? KEYLAB[V.key][0] : ""; count();
  }
  function count() { if (!V.key) return; const v = mineKeys().map((x) => x.i), k = v.indexOf(V.step - 1); $("#vw-ccount").textContent = v.length ? `${k >= 0 ? k + 1 : "–"} / ${v.length}` : "0"; }
  function hop(dir) {
    const v = mineKeys().map((x) => x.i); if (!v.length) return;
    const k = v.indexOf(V.step - 1);
    go((k < 0 ? (dir > 0 ? (v.find((i) => i >= V.step - 1) ?? v[0]) : ([...v].reverse().find((i) => i < V.step - 1) ?? v[v.length - 1])) : v[(k + dir + v.length) % v.length]) + 1);
  }
  function go(s) { V.step = Math.max(0, Math.min(V.fens.length - 1, s)); V.arrows = null; T.stop($("#vw-board")); $("#vw-candl").hidden = true; paint(); }
  function paint() {
    const step = V.step, fen = V.fens[step], pos = B.parse(fen), u = step > 0 ? V.ucis[step - 1] : "", k = step > 0 ? V.keys[step - 1] : "", j = step > 0 ? judged(step - 1) : null;
    B.render($("#vw-board"), pos.m, { flip: me() === "b", last: u ? [u.slice(0, 2), u.slice(2, 4)] : null, badge: u && B.BADGES[k] ? { sq: u.slice(2, 4), key: k, id: "v" + step } : null, arrows: V.arrows, check: new Chess(fen).in_check() ? B.kingSquare(pos.m, pos.turn) : "" });
    const cp = j && j.after != null ? (j.color === "w" ? j.after : -j.after) : null;
    if (cp != null) { $("#vw-eval").style.setProperty("--w", (me() === "w" ? B.winPct(cp) : 100 - B.winPct(cp)) + "%"); $("#vw-evtxt").textContent = Math.abs(cp) >= 9000 ? "M" : ((cp / 100) * (me() === "w" ? 1 : -1)).toFixed(1).replace(".", ",").replace(/^(\d)/, "+$1"); }
    $("#vw-step").innerHTML = step === 0 ? "position de départ" : `coup ${Math.ceil(step / 2)}${step % 2 ? "" : "…"} · ${esc(V.sans[step - 1])}${KEYLAB[k] ? ` <span class="kchip" style="--c:${KEYLAB[k][1]}">${KEYLAB[k][0]}</span>` : ""}`;
    $("#vw-pos").textContent = step === 0 ? "Début" : `${step} / ${V.fens.length - 1}`;
    $("#vw-first").disabled = $("#vw-prev").disabled = step === 0; $("#vw-next").disabled = $("#vw-last").disabled = step >= V.fens.length - 1;
    const who = j ? ((j.color || (step % 2 ? "w" : "b")) === me() ? "Ton coup" : "Coup de l'adversaire") : "";
    $("#vw-note").innerHTML = j && KEYLAB[k] ? `<b style="color:${KEYLAB[k][1]}">${who} · ${KEYLAB[k][0]}</b><br>${esc(K.describe({ key: k, loss: j.loss || 0, after: j.after || 0 }, V.sans[step - 1], j.best || ""))}` : '<span class="muted">Utilise ◂ ▸ (ou les flèches du clavier), la liste des coups ou les catégories.</span>';
    $("#vw-show").hidden = !(j && j.best_uci);
    $("#vw-all").innerHTML = V.sans.map((x, i) => { const bd = B.BADGES[V.keys[i]]; return `<span data-i="${i + 1}" class="${i + 1 === step ? "cur " : ""}${(judged(i) ? judged(i).color : (i % 2 ? "b" : "w")) === me() ? "mine" : ""}">${i % 2 === 0 ? (i / 2 + 1) + "." : ""}${esc(x)}${bd ? `<em style="color:${bd[1]}">${bd[0]}</em>` : ""}</span>`; }).join("");
    const cur = $("#vw-all .cur"); if (cur) cur.scrollIntoView({ block: "nearest" }); count();
  }
  async function showBest() {
    const j = judged(V.step - 1); if (!j || !j.best_uci) return;
    const lu = V.step > 1 ? V.ucis[V.step - 2] : "";
    $("#vw-show").disabled = true;
    await T.demo($("#vw-board"), V.fens[V.step - 1], { uci: j.best_uci, san: j.best, pv: [j.best_uci], key: "best" }, { flip: me() === "b", last: lu ? [lu.slice(0, 2), lu.slice(2, 4)] : null });
    $("#vw-show").disabled = false; paint();
  }
  let seq = 0;
  async function cands(kind) {
    const box = $("#vw-candl"), fen = V.fens[V.step], grp = T.GROUPS[kind];
    if (new Chess(fen).game_over()) { box.hidden = false; box.innerHTML = '<div class="muted">La partie est terminée dans cette position.</div>'; return; }
    document.querySelectorAll("#vw-candb button").forEach((b) => b.classList.toggle("on", b.dataset.k === kind));
    V.arrows = null; T.stop($("#vw-board")); paint();
    const my = ++seq; box.hidden = false; box.innerHTML = `<div class="muted ch-wait"><i></i> Recherche : ${grp.label.toLowerCase()}…</div>`;
    let items = []; try { items = await T.cands(fen, kind, { ms: kind === "brilliant" ? 900 : 1500 }); } catch (e) { box.innerHTML = `<div class="muted">✕ ${esc(e.message)}</div>`; return; }
    if (my !== seq) return;
    if (!items.length) { box.innerHTML = `<div class="muted">Aucun ${SING[kind].toLowerCase()} dans cette position.</div>`; return; }
    box.innerHTML = items.map((it, i) => `<div class="cd-it" data-i="${i}" style="--c:${grp.color}"><b>${SING[kind]} n°${i + 1}</b><span class="san">${esc(it.san)}</span><small>${T.fmtScore(fen, it)} · suite : ${esc(it.line.slice(1, 5).join(" ") || "—")}</small><button>▶ REVOIR</button></div>`).join("");
    const play = async (it, row) => {
      box.querySelectorAll(".cd-it").forEach((x) => x.classList.toggle("on", x === row)); V.arrows = null;
      const u = V.step > 0 ? V.ucis[V.step - 1] : "";
      const ok = await T.demo($("#vw-board"), fen, it, { flip: me() === "b", last: u ? [u.slice(0, 2), u.slice(2, 4)] : null });
      if (ok) { V.arrows = T.arrowsFor(fen, it); paint(); }
    };
    box.onclick = (e) => { const r = e.target.closest(".cd-it"); if (r) play(items[+r.dataset.i], r); };
    play(items[0], box.querySelector(".cd-it"));
  }
  E.chessViewer = { mount };
})();
