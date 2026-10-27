"use strict";
// Monte les modules échecs dans la page PC : « Apprendre » tout de suite, « Conseiller brillants » à la demande (le moteur Stockfish.js et le réseau de reconnaissance pèsent ~1 Mo).
// Intégrée dans l'interface d'ENOS (iframe), la page propose un bouton FERMER qui prévient la fenêtre parente. #advisor dans l'adresse ouvre directement le Conseiller.
(() => {
  const E = window.ENOS, $ = (s) => document.querySelector(s);
  const built = {};
  const load = (src) => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src + " introuvable")); document.head.appendChild(s); });
  const need = { advisor: ["stockfish_src.js", "chess_local.js", "chess_brain.js", "board_scan.js", "m_advisor.js"] };

  async function show(t) {
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    $("#tabs").dataset.p = t === "learn" ? "enos" : "eto";
    $("#tool-learn").hidden = t !== "learn"; $("#tool-advisor").hidden = t !== "advisor";
    if (built[t]) return;
    built[t] = true;
    try {
      for (const f of need[t] || []) await load(f);
      const m = E.suite.modules.find((x) => x.id === t);
      m.build($("#app-" + t), E.suite.api);
    } catch (e) { $("#app-" + t).innerHTML = `<div class="card"><p class="muted">Module indisponible : ${E.esc(e.message)}</p></div>`; built[t] = false; }
  }
  $("#tabs").onclick = (e) => { const b = e.target.closest("button[data-t]"); if (b) show(b.dataset.t); };
  show(location.hash === "#advisor" ? "advisor" : "learn");
  if (window.parent !== window) {
    const b = $("#close");
    b.hidden = false; b.onclick = () => window.parent.postMessage({ enos: "learn-close" }, "*");
  }
})();
