"use strict";
// MODE APPRENTISSAGE : tableau de bord d'ouvertures (répertoires Blanc / Noir), plateau (Godot encastré, sinon plateau intégré avec flèches et cases surlignées)
// et coach ETO. Python (opening_manager) joue la démonstration pas à pas : l'interface enchaîne les étapes (/api/study/next), joue la voix d'ETO, puis
// lui rend la main (pratique : l'élève joue, son coup est comparé à l'arbre PGN).
(() => {
  const $ = (id) => document.getElementById(id);
  if (!$("b-st") || !$("st")) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (p, o = {}) => {
    const r = await fetch(p, { ...o, headers: { "Content-Type": "application/json" } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(typeof j.detail === "string" ? j.detail : r.statusText); e.status = r.status; throw e; }
    return j;
  };
  const post = (p, b) => api(p, { method: "POST", body: JSON.stringify(b || {}) });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const msg = (kind, text) => { $("st-msg").innerHTML = text ? `<div class="gt-msg ${kind}">${kind === "ok" ? "✔" : kind === "bad" ? "✕" : "…"} ${esc(text)}</div>` : ""; };
  const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
  const ARROW_COL = { best: "#3cc85a", threat: "#eb3c46", played: "#ffd23c", punish: "#46aaff" };
  const PACE = { fast: 450, normal: 950, slow: 1700 };
  const S = { openings: [], st: null, running: false, busy: false, sel: "", audio: null, marksAt: 0, lastSeq: -1, evLast: 0, evTimer: 0, pace: "normal", emb: false, loopId: 0 };

  // ------------------------------------------------------------------ liste des ouvertures
  function renderList() {
    const card = (o) => `<button class="st-op ${o.color === "white" ? "w" : "b"}${S.st && S.st.opening && S.st.opening.id === o.id ? " on" : ""}" data-id="${esc(o.id)}"><b><i></i>${esc(o.name)}</b><small>${esc(o.description || "")}<br>${o.lines} ligne${o.lines > 1 ? "s" : ""} · ${o.moves} coups · adversaire ${esc(o.level)} Elo${o.warnings && o.warnings.length ? " · ⚠ PGN à vérifier" : ""}</small></button>`;
    $("st-list-w").innerHTML = S.openings.filter((o) => o.color === "white").map(card).join("") || '<div class="st-dirs">Aucune ouverture.</div>';
    $("st-list-b").innerHTML = S.openings.filter((o) => o.color === "black").map(card).join("") || '<div class="st-dirs">Aucune ouverture.</div>';
  }
  async function loadOpenings() {
    try {
      const r = await api("/api/study/openings");
      S.openings = r.openings; renderList();
      $("st-dirs").textContent = "Vos fichiers PGN : " + (r.dirs.length ? r.dirs[r.dirs.length - 1] : "dossier « openings » à côté de ENOS.exe") + " (variantes, [%cal] [%csl], export d'étude Lichess).";
      if (r.active) apply(await api("/api/study/state"));
    } catch (e) { msg("bad", e.message); }
  }

  // ------------------------------------------------------------------ plateau intégré (repli quand Godot n'est pas encastré) + flèches
  const sqName = (f, r) => "abcdefgh"[f] + (r + 1);
  function renderBoard() {
    const st = S.st; if (!st) { $("st-board").innerHTML = ""; $("st-arrows").innerHTML = ""; return; }
    const flip = st.user === "b", fresh = Date.now() - S.marksAt < 8500;
    const marks = fresh ? st.squares || [] : [], arrows = fresh ? st.arrows || [] : [];
    const mk = new Map(marks.map((m) => [m.sq, m.kind]));
    const last = st.last ? [st.last.slice(0, 2), st.last.slice(2, 4)] : [];
    const targets = S.sel && st.legal[S.sel] ? st.legal[S.sel] : [];
    let h = "";
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const f = flip ? 7 - col : col, r = flip ? row : 7 - row, n = sqName(f, r), p = st.board[n];
      const cls = ["st-sq", (f + r) % 2 ? "l" : "d", last.includes(n) ? "last" : "", S.sel === n ? "sel" : "", targets.includes(n) ? "mv" : "", (st.legal[n] || targets.includes(n)) ? "can" : ""].join(" ");
      h += `<div class="${cls}" data-sq="${n}">${mk.has(n) ? `<i class="st-mk ${mk.get(n)}"></i>` : ""}${p ? `<span class="p ${p === p.toUpperCase() ? "w" : "b"}">${GLYPH[p.toLowerCase()]}</span>` : ""}${col === 0 ? `<span class="co">${r + 1}</span>` : ""}${row === 7 ? `<span class="co" style="left:auto;right:3px">${"abcdefgh"[f]}</span>` : ""}</div>`;
    }
    $("st-board").innerHTML = h;
    const pos = (n) => { const f = "abcdefgh".indexOf(n[0]), r = +n[1] - 1; return [(flip ? 7 - f : f) + 0.5, (flip ? r : 7 - r) + 0.5]; };
    $("st-arrows").innerHTML = arrows.map((a) => {
      const [x1, y1] = pos(a.from), [x2, y2] = pos(a.to), dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      const col = ARROW_COL[a.kind] || ARROW_COL.best, bx = x2 - ux * 0.36, by = y2 - uy * 0.36, px = -uy * 0.2, py = ux * 0.2;
      return `<g opacity=".85"><line x1="${x1}" y1="${y1}" x2="${bx}" y2="${by}" stroke="${col}" stroke-width=".16" stroke-linecap="round"/><polygon points="${x2 - ux * 0.05},${y2 - uy * 0.05} ${bx + px},${by + py} ${bx - px},${by - py}" fill="${col}"/><circle cx="${x1}" cy="${y1}" r=".09" fill="${col}"/></g>`;
    }).join("");
    if (marks.length || arrows.length) { clearTimeout(S.mkT); S.mkT = setTimeout(renderBoard, Math.max(200, 8600 - (Date.now() - S.marksAt))); }
  }
  $("st-board").onclick = async (e) => {
    const sq = e.target.closest(".st-sq"); const st = S.st;
    if (!sq || !st || st.mode !== "practice" || S.busy || st.over) return;
    const n = sq.dataset.sq;
    if (S.sel && (st.legal[S.sel] || []).includes(n)) {
      const uci = S.sel + n; S.sel = ""; S.busy = true;
      try { const r = await post("/api/study/move", { uci }); handleResult(r); } catch (err) { msg("bad", err.message); }
      S.busy = false; return;
    }
    S.sel = st.legal[n] ? n : ""; renderBoard();
  };

  // ------------------------------------------------------------------ état → interface
  function apply(st) {
    if (!st || !st.active) { S.st = null; renderAll(); return; }
    if (!S.st || st.seq !== S.lastSeq) { S.marksAt = Date.now(); S.lastSeq = st.seq; S.sel = ""; }
    S.st = st; renderAll();
  }
  function renderAll() {
    const st = S.st;
    renderList(); renderBoard();
    $("st-title").textContent = st ? st.opening.name.toUpperCase() : "CHOISIS UNE OUVERTURE";
    $("st-var").textContent = st ? (st.variation || "Ligne principale") + (st.opening.color === "white" ? " · tu joues les Blancs" : " · tu joues les Noirs") : "";
    $("st-line").textContent = st ? (st.sans.length ? st.sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : "") + s).join(" ") : "Position de départ") : "";
    const pill = $("st-pill");
    pill.className = "st-pill" + (st ? " " + st.mode : "");
    pill.textContent = !st ? "EN ATTENTE" : st.mode === "demo" ? (S.running ? "🔒 ETO A LA MAIN · " + st.progress[0] + "/" + st.progress[1] : "⏸ DÉMO EN PAUSE · " + st.progress[0] + "/" + st.progress[1])
      : st.mode === "practice" ? (st.over ? "✔ LIGNE TERMINÉE" : "✋ À TOI DE JOUER") : "🧭 EXPLORATION";
    const demo = st && st.mode === "demo", prac = st && st.mode === "practice", explore = st && st.mode === "explore";
    $("st-pause").textContent = demo && S.running ? "⏸ PAUSE" : "▶ LECTURE";
    $("st-pause").disabled = !st || prac; $("st-back").disabled = !st || prac || !st.ply; $("st-fwd").disabled = !st || prac || (explore && !st.variations.length);
    $("st-explain").disabled = !st || prac; $("st-restart").disabled = !st; $("st-practice").disabled = !st;
    $("st-vars").hidden = !st || prac;
    $("st-vars").innerHTML = st && !prac ? st.variations.map((v) => `<button class="btn" data-i="${v.idx}" title="Jouer ce coup">${esc(v.san)}${v.name ? `<small>${esc(v.name)}</small>` : ""}</button>`).join("") : "";
    $("st-varsh").hidden = !st || prac;
    $("st-hint").textContent = prac ? (st.over ? "Bravo ! Relance une ligne ou revois la démo." : `Joue ton coup (${st.user === "w" ? "Blancs" : "Noirs"}) sur l'échiquier. Erreurs : ${st.errors}.`) : "";
    $("st-opts-n").textContent = st ? `≈ ${st.speeches} répliques vocales dans cette démo` : "";
    $("st-voice").checked = st ? st.voice : $("st-voice").checked;
    if (st) $("st-detail").value = st.detail;
  }

  // ------------------------------------------------------------------ voix d'ETO
  function stopAudio() { if (S.audio) { try { S.audio.pause(); } catch (e) {} S.audio = null; } if ("speechSynthesis" in window) speechSynthesis.cancel(); }
  function logSay(text) {
    if (!text) return;
    $("st-say").textContent = text;
    const p = document.createElement("p"); p.innerHTML = `<b>ETO</b> ${esc(text)}`; $("st-log").append(p); $("st-log").scrollTop = $("st-log").scrollHeight;
    while ($("st-log").children.length > 40) $("st-log").firstChild.remove();
  }
  function sayIt(sp) {
    if (!sp) return Promise.resolve();
    logSay(sp.text);
    if (sp.notice) msg("bad", sp.notice + " (voix du navigateur utilisée)");
    const readMs = window.__stFast ? 40 : Math.max(1800, (sp.text || "").length * 58);   // __stFast : tests automatisés uniquement
    if (sp.audio) {
      return new Promise((done) => {
        const a = S.audio = new Audio(sp.audio); let ended = false;
        const fin = () => { if (!ended) { ended = true; clearTimeout(t); done(); } };
        const t = setTimeout(fin, readMs + 12000);
        a.onended = fin; a.onerror = () => { ended = true; clearTimeout(t); setTimeout(done, readMs); };
        a.play().catch(() => { ended = true; clearTimeout(t); setTimeout(done, readMs); });
      });
    }
    if (!window.__stFast && S.st && S.st.voice && "speechSynthesis" in window && sp.text) {
      return new Promise((done) => {
        const u = new SpeechSynthesisUtterance(sp.text); u.lang = "fr-FR"; u.rate = 1.15;
        const t = setTimeout(done, readMs + 6000); u.onend = u.onerror = () => { clearTimeout(t); done(); };
        speechSynthesis.cancel(); speechSynthesis.speak(u);
      });
    }
    return sleep(S.st && S.st.voice === false ? Math.min(readMs, 2600) : readMs);
  }

  // ------------------------------------------------------------------ démonstration (boucle pilotée par l'interface)
  async function stepOnce() {
    const r = await post("/api/study/next");
    apply(r.state);
    if (r.speech) await sayIt(r.speech); else await sleep(window.__stFast ? 30 : PACE[S.pace] || 950);
    return r;
  }
  async function loop() {
    if (S.running) return;
    const my = ++S.loopId;
    S.running = true; renderAll();
    try {
      while (S.running && my === S.loopId && S.st && S.st.mode === "demo") {
        const r = await stepOnce();
        if (r.done) { S.running = false; startEvents(); break; }
      }
    } catch (e) { msg("bad", e.message); }
    if (my === S.loopId) S.running = false;
    renderAll();
  }
  function pause() { S.running = false; S.loopId++; stopAudio(); renderAll(); }

  // ------------------------------------------------------------------ pratique : résultats des coups joués sur le plateau Godot
  function handleResult(r) {
    apply(r.state);
    const res = r.result || {};
    if (res.ok === false) msg("bad", `Hors théorie : ${res.san}. Attendu : ${res.expected.join(" ou ")}.`); else msg("", "");
    if (r.speech) sayIt(r.speech);
  }
  function startEvents() {
    clearInterval(S.evTimer);
    S.evTimer = setInterval(async () => {
      if ($("st").hidden || !S.st || S.st.mode !== "practice") return;
      try {
        const e = await api("/api/study/events?since=" + S.evLast); S.evLast = e.last;
        if (!e.events.length) return;
        apply(await api("/api/study/state"));
        for (const ev of e.events) { if (ev.result && ev.result.ok === false) msg("bad", `Hors théorie : ${ev.result.san}. Attendu : ${(ev.result.expected || []).join(" ou ")}.`); if (ev.speech) await sayIt(ev.speech); }
      } catch (err) { /* hors ligne : on réessaie */ }
    }, 800);
  }

  // ------------------------------------------------------------------ plateau Godot encastré
  const EM = { on: false, ro: null, tick: null, last: "", n: 0, t0: 0 };
  const EMB_RATIO = 1080 / 1264;
  function covered() {
    const r = $("st-embed").getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !(el && $("st-embed").contains(el));
  }
  function sendRect(force) {
    if (!EM.on) return;
    const r = $("st-embed").getBoundingClientRect(), d = window.devicePixelRatio || 1;
    const body = { x: Math.round(r.left * d), y: Math.round(r.top * d), w: Math.round(r.width * d), h: Math.round(r.height * d), shown: !covered() && !$("st").hidden };
    const key = JSON.stringify(body);
    if (force !== true && key === EM.last) return;
    EM.last = key; post("/api/chess/embed/rect", body).catch(() => {});
  }
  async function health() {
    try {
      const s = await api("/api/chess/embed");
      if (EM.on && (!s.running || (!s.attached && Date.now() - EM.t0 > 15000))) embedStop(true);
    } catch (e) {}
  }
  async function embedStart() {
    try {
      const s = await api("/api/chess/embed");
      if (!s.supported || !s.configured) return;
      await post("/api/chess/embed/start");
      EM.on = true; S.emb = true; $("st-embed").hidden = false; $("st-board").hidden = true; $("st-arrows").hidden = true; document.querySelector(".st-boardwrap").classList.add("emb");
      EM.ro = EM.ro || new ResizeObserver(() => sendRect()); EM.ro.observe($("st-embed"));
      EM.t0 = Date.now(); EM.n = 0;
      EM.tick = setInterval(() => { sendRect(); if (++EM.n % 6 === 0) health(); }, 500); sendRect(true);
    } catch (e) { /* plateau intégré */ }
  }
  function embedStop(fallback) {
    if (!EM.on) return;
    EM.on = false; S.emb = false; if (EM.ro) EM.ro.disconnect(); clearInterval(EM.tick);
    $("st-embed").hidden = true; $("st-board").hidden = false; $("st-arrows").hidden = false; document.querySelector(".st-boardwrap").classList.remove("emb");
    post("/api/chess/embed/stop").catch(() => {});
    if (fallback) msg("bad", "Plateau Godot indisponible : plateau intégré affiché.");
    renderBoard();
  }

  // ------------------------------------------------------------------ branchements
  async function startOpening(id) {
    pause(); S.evLast = 0; $("st-log").innerHTML = ""; msg("", "");
    try {
      apply(await post("/api/study/start", { id, detail: $("st-detail").value, voice: $("st-voice").checked }));
      await sleep(500); loop();
    } catch (e) { msg("bad", e.message); }
  }
  async function act(path, body) {
    pause();
    try { const r = await post(path, body); if (r.speech) { apply(r.state); await sayIt(r.speech); } else apply(r.state || r); } catch (e) { msg("bad", e.message); }
  }
  function open() {
    $("st").hidden = false; document.body.classList.remove("menu-open");
    loadOpenings(); embedStart(); renderAll(); startEvents();
  }
  async function close() {
    pause(); clearInterval(S.evTimer); embedStop(); $("st").hidden = true;
    try { await post("/api/study/stop"); } catch (e) {}
    S.st = null; renderAll();
  }
  $("b-st").onclick = open;
  $("st-close").onclick = close;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("st").hidden) close(); });
  document.addEventListener("click", (e) => { const b = e.target.closest("#st .st-op"); if (b) startOpening(b.dataset.id); });
  $("st-pause").onclick = async () => {
    if (!S.st) return;
    if (S.running) return pause();
    try { if (S.st.mode === "explore") apply(await post("/api/study/resume")); } catch (e) { return msg("bad", e.message); }
    loop();
  };
  $("st-back").onclick = () => act("/api/study/back", { plies: 1 });
  $("st-fwd").onclick = async () => {
    if (!S.st) return; pause();
    try { if (S.st.mode === "demo") await stepOnce(); else apply(await post("/api/study/forward", { idx: 0 })); } catch (e) { msg("bad", e.message); }
  };
  $("st-vars").onclick = (e) => { const b = e.target.closest("[data-i]"); if (b) act("/api/study/forward", { idx: +b.dataset.i }); };
  $("st-explain").onclick = () => act("/api/study/explain");
  $("st-restart").onclick = async () => { pause(); try { apply(await post("/api/study/restart")); await sleep(300); loop(); } catch (e) { msg("bad", e.message); } };
  $("st-practice").onclick = () => act("/api/study/practice");
  $("st-voice").onchange = () => { if (S.st) post("/api/study/options", { voice: $("st-voice").checked }).then(apply).catch((e) => msg("bad", e.message)); };
  $("st-detail").onchange = () => { if (S.st) post("/api/study/options", { detail: $("st-detail").value }).then(apply).catch((e) => msg("bad", e.message)); };
  $("st-pace").onchange = () => { S.pace = $("st-pace").value; };
})();
