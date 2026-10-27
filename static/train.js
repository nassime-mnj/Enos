"use strict";
// SUPER ENOS : panneau d'entraînement (backend : nasko_train.py). Le thread tourne dans le serveur : fermer ce panneau ne l'arrête pas.
(() => {
  const $ = (id) => document.getElementById(id);
  if (!$("cs-train")) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (p, o = {}) => {
    const r = await fetch(p, { ...o, headers: { "Content-Type": "application/json" } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || r.statusText);
    return j;
  };
  const post = (p, b) => api(p, { method: "POST", body: JSON.stringify(b || {}) });
  const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
  const NAMES = { enos: "E.N.O.S.", stockfish: "STOCKFISH", eto: "ETO" };
  const RES = { w: "V", d: "N", l: "D" };
  let timer = 0, lastFen = "", running = false;

  function board(fen, last, flip) {
    const rows = fen.split(" ")[0].split("/"), grid = {};
    rows.forEach((row, i) => { let c = 0; for (const ch of row) { if (/\d/.test(ch)) c += +ch; else { grid[String.fromCharCode(97 + c) + (8 - i)] = ch; c++; } } });
    const el = $("tr-board"); el.innerHTML = "";
    for (let i = 0; i < 64; i++) {
      const row = Math.floor(i / 8), col = i % 8, r = flip ? row : 7 - row, c = flip ? 7 - col : col, name = String.fromCharCode(97 + c) + (r + 1), pc = grid[name];
      const d = document.createElement("div");
      d.className = "cs-sq" + ((r + c) % 2 ? " l" : "") + (last && (last.slice(0, 2) === name || last.slice(2, 4) === name) ? " last" : "");
      if (pc) d.insertAdjacentHTML("beforeend", `<span class="cs-p ${pc === pc.toUpperCase() ? "w" : "b"}">${GLYPH[pc.toLowerCase()]}</span>`);
      el.appendChild(d);
    }
  }

  function paint(st) {
    const run = running = st.running, m = st.memory;
    $("cs-trbtn").classList.toggle("on", run);
    $("tr-go").hidden = run; $("tr-stop").hidden = !run;
    ["tr-enos", "tr-sf", "tr-eto", "tr-games", "tr-secs", "tr-llm"].forEach((id) => ($(id).disabled = run));
    $("tr-reset").disabled = run;
    $("tr-auto").checked = !!m.autostart;
    $("tr-sub").textContent = run ? `PARTIE ${st.game} · ${NAMES[st.opp] || ""} · ${Math.floor(st.elapsed / 60)} MIN` : "ARRÊTÉ";
    $("tr-live").textContent = run ? `${st.results.w}V ${st.results.d}N ${st.results.l}D` : "";
    const err = $("tr-err"), msg = st.error || (run && !st.llm && st.cfg.llm ? st.llm_error : "") || (!st.stockfish ? "Stockfish est introuvable : lancez une partie CHESS une fois (téléchargement automatique)." : "");
    err.hidden = !msg; err.textContent = msg; err.classList.toggle("bad", !!st.error);
    if (st.fen !== lastFen) { lastFen = st.fen; board(st.fen, st.last, st.color === "b"); }
    const cp = Math.max(-1000, Math.min(1000, st.eval)) * (st.color === "b" ? -1 : 1);
    $("tr-eval").style.width = (50 + cp / 20) + "%";
    $("tr-evtxt").textContent = (cp / 100).toFixed(1).replace(".", ",").replace(/^(\d)/, "+$1");
    $("tr-say").textContent = st.say || "";
    $("tr-moves").textContent = st.san.join(" ");
    const rows = Object.entries(m.profiles).map(([o, p]) => `<tr><td>${NAMES[o]}</td><td>${p.g}</td><td>${p.w}/${p.d}/${p.l}</td><td>${p.score == null ? "—" : p.score + " %"}</td><td>${p.acpl == null ? "—" : p.acpl}</td><td>${p.brilliants}</td><td>${p.dodged}</td></tr>`).join("");
    $("tr-prof").innerHTML = `<table class="tr-tbl"><tr><th>ADVERSAIRE</th><th>PARTIES</th><th>V/N/D</th><th>SCORE</th><th>PERTE MOY.</th><th>!!</th><th>RÉP. ÉVITÉES</th></tr>${rows}</table>`;
    $("tr-lessons").innerHTML = m.lessons.length ? m.lessons.slice().reverse().map((l) => `<p class="tr-les">${esc(l.text)}<small>contre ${NAMES[l.opp] || ""} · ${RES[l.result] === "V" ? "victoire" : RES[l.result] === "N" ? "nulle" : "défaite"}</small></p>`).join("") : '<div class="tm-empty">Aucune leçon pour le moment.</div>';
    $("tr-open").innerHTML = m.openings.length ? `<table class="tr-tbl">${m.openings.map((o) => `<tr><td>${esc(o.name)}</td><td>${o.w}/${o.d}/${o.l}</td></tr>`).join("")}</table>` : '<div class="tm-empty">—</div>';
    $("tr-games-list").innerHTML = m.games.length ? `<table class="tr-tbl">${m.games.slice().reverse().map((g) => `<tr><td>${NAMES[g.opp]} (${g.color === "w" ? "B" : "N"})</td><td>${RES[g.result]} · ${esc(g.why)}</td><td>${g.plies}</td><td>${g.acpl == null ? "" : g.acpl + " cp"}</td></tr>`).join("")}</table>` : '<div class="tm-empty">—</div>';
  }

  async function refresh() {
    try { paint(await api("/api/train/status")); } catch (e) { $("tr-err").hidden = false; $("tr-err").textContent = e.message; }
  }
  // interrogation du serveur seulement si le panneau est ouvert ou si un entraînement tourne (le bouton clignote alors)
  function loop() { clearTimeout(timer); refresh().finally(() => { if (!$("cs-train").hidden || running) timer = setTimeout(loop, $("cs-train").hidden ? 8000 : 1500); }); }

  $("cs-trbtn").onclick = () => { $("cs-train").hidden = false; loop(); };
  $("tr-close").onclick = () => ($("cs-train").hidden = true);
  $("tr-go").onclick = async () => {
    const opponents = [["tr-enos", "enos"], ["tr-sf", "stockfish"], ["tr-eto", "eto"]].filter(([id]) => $(id).checked).map(([, o]) => o);
    if (!opponents.length) { $("tr-err").hidden = false; $("tr-err").textContent = "Choisissez au moins un adversaire."; return; }
    try { paint(await post("/api/train/start", { opponents, games: +$("tr-games").value, secs: +$("tr-secs").value, llm: $("tr-llm").checked })); loop(); } catch (e) { $("tr-err").hidden = false; $("tr-err").textContent = e.message; }
  };
  $("tr-stop").onclick = async () => { try { paint(await post("/api/train/stop")); } catch (e) { /* déjà arrêté */ } };
  $("tr-auto").onchange = () => post("/api/train/autostart", { on: $("tr-auto").checked }).catch(() => {});
  $("tr-reset").onclick = async () => {
    if (!confirm("Effacer toute la mémoire de Super Enos (parties, profils, leçons) ?")) return;
    try { await post("/api/train/reset"); lastFen = ""; refresh(); } catch (e) { $("tr-err").hidden = false; $("tr-err").textContent = e.message; }
  };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("cs-train").hidden) { e.stopPropagation(); $("tr-close").click(); } }, true);
  refresh().then(() => { if (running) loop(); });
})();
