"use strict";
// Monte le module « Apprendre » dans la page. Intégrée dans l'interface d'ENOS (iframe), la page propose un bouton FERMER qui prévient la fenêtre parente.
(() => {
  const E = window.ENOS, m = E.suite.modules.find((x) => x.id === "learn");
  m.build(document.getElementById("app"), {});
  if (window.parent !== window) {
    const b = document.getElementById("close");
    b.hidden = false; b.onclick = () => window.parent.postMessage({ enos: "learn-close" }, "*");
  }
})();
