"use strict";
// Monte les modules échecs dans la page PC : « Apprendre » tout de suite, « Conseiller brillants » à la demande (le moteur Stockfish.js et le réseau de reconnaissance pèsent ~1 Mo).
// Intégrée dans l'interface d'ENOS (iframe), la page propose un bouton FERMER qui prévient la fenêtre parente. #advisor dans l'adresse ouvre directement le Conseiller.
(() => {
  const E = window.ENOS, $ = (s) => document.querySelector(s);
  const built = {};
  const load = (src) => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src + " introuvable")); document.head.appendChild(s); });
  const need = { advisor: ["stockfish_src.js", "chess_local.js", "chess_brain.js", "chess_tools.js", "chess_course.js", "board_scan.js", "m_advisor.js"], game: ["stockfish_src.js", "chess_local.js", "chess_brain.js", "chess_tools.js", "chess_viewer.js"], course: ["stockfish_src.js", "chess_local.js", "chess_brain.js", "chess_tools.js", "chess_course.js"], arena: ["stockfish_src.js", "chess_local.js", "chess_brain.js", "data/style_bots.js", "m_defis.js", "arena.js"], royale: ["chess4.js", "chess4_ai.js", "m_royale.js"], variants: ["variants.js", "m_variants.js"], prime: ["stockfish_src.js", "chess_local.js", "chess_brain.js", "levy_data.js", "fahh_data.js", "chess_edit_audio.js", "chess_edit_map.js", "chess_edit_fx.js", "chess_edit_sfx.js", "mp4-muxer.js", "render_assets.js", "chess_edit_render.js", "chess_edit_scenes.js", "chess_edit_simul.js", "chess_edit_gl.js", "chess_edit_export.js", "m_chessedit.js", "prime.js", "m_prime.js"],
    chessedit: ["stockfish_src.js", "chess_local.js", "chess_brain.js", "chess_review.js", "levy_data.js", "fahh_data.js", "chess_edit_audio.js", "chess_edit_map.js", "chess_edit_fx.js", "chess_edit_sfx.js", "mp4-muxer.js", "render_assets.js", "chess_edit_render.js", "chess_edit_scenes.js", "chess_edit_simul.js", "chess_edit_gl.js", "chess_edit_export.js", "m_chessedit.js"],
    clips: ["stockfish_src.js", "chess_local.js", "chess_brain.js", "levy_data.js", "fahh_data.js", "chess_edit_audio.js", "chess_edit_map.js", "chess_edit_fx.js", "chess_edit_sfx.js", "mp4-muxer.js", "render_assets.js", "chess_edit_render.js", "chess_edit_scenes.js", "chess_edit_simul.js", "chess_edit_gl.js", "chess_edit_export.js", "m_chessedit.js", "prime.js", "clips.js", "m_clips.js"],
    backup: ["backup.js", "m_backup.js"] };

  async function show(t) {
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    $("#tabs").dataset.p = t === "learn" ? "enos" : "eto";
    document.querySelectorAll("[id^=tool-]").forEach((d) => { d.hidden = d.id !== "tool-" + t; }); document.body.classList.toggle("arena-on", t === "arena" || t === "royale");
    if (t === "arena") {                                                       // ARÈNE DES BOTS : m_defis.js (le même code que le téléphone) + interface de bureau (arena.js)
      if (built.arena) return;
      built.arena = true;
      try {
        for (const f of need.arena) if (!built["f:" + f]) { await load(f); built["f:" + f] = true; }
        E.suite.modules.find((x) => x.id === "defis").build($("#app-arena"), E.suite.api);
        E.arena.mount($("#app-arena"));
      } catch (e) { $("#app-arena").innerHTML = `<div class="card"><p class="muted">Arène indisponible : ${E.esc(e.message)}</p></div>`; built.arena = false; }
      return;
    }
    if (t === "course") {                                                      // le cours est un écran plein page (chess_course.js) : on charge puis on l'ouvre
      try {
        for (const f of need.course) if (!built["f:" + f]) { await load(f); built["f:" + f] = true; }
        E.chessCourse.onClose = () => show("learn");
        $("#course-go").onclick = () => E.chessCourse.open();
        E.chessCourse.open();
      } catch (e) { $("#app-course").innerHTML = `<div class="card"><p class="muted">Cours indisponible : ${E.esc(e.message)}</p></div>`; }
      return;
    }
    if (t === "game") {                                                        // revue de la partie jouée dans CHESS (données écrites par defi.js)
      try {
        for (const f of need.game) if (!built["f:" + f]) { await load(f); built["f:" + f] = true; }
        E.chessViewer.mount($("#app-game"));
      } catch (e) { $("#app-game").innerHTML = `<div class="card"><p class="muted">Revue indisponible : ${E.esc(e.message)}</p></div>`; }
      return;
    }
    if (built[t]) return;
    built[t] = true;
    try {
      for (const f of need[t] || []) { if (!built["f:" + f]) { await load(f); built["f:" + f] = true; } }
      const m = E.suite.modules.find((x) => x.id === t);
      m.build($("#app-" + t), E.suite.api);
    } catch (e) { $("#app-" + t).innerHTML = `<div class="card"><p class="muted">Module indisponible : ${E.esc(e.message)}</p></div>`; built[t] = false; }
  }
  E.suite.open = (id) => show(id);                                          // E.chessEdit.open(partie) ouvre l'onglet CHESS EDIT
  $("#tabs").onclick = (e) => { const b = e.target.closest("button[data-t]"); if (b) show(b.dataset.t); };
  show(location.hash === "#advisor" ? "advisor" : location.hash === "#course" ? "course" : location.hash === "#game" ? "game" : location.hash === "#arena" ? "arena" : location.hash === "#royale" ? "royale" : location.hash === "#variants" ? "variants" : location.hash === "#chessedit" ? "chessedit" : location.hash === "#clips" ? "clips" : location.hash === "#backup" ? "backup" : "learn");
  if (window.parent !== window) {
    const b = $("#close");
    b.hidden = false; b.onclick = () => window.parent.postMessage({ enos: "learn-close" }, "*");
  }
})();
