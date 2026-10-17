"use strict";
// Lien profond : l'application mobile ouvre cette interface avec « #open=b-ch » (identifiant du bouton du module) ; le module s'ouvre tout seul.
(() => {
  const m = /[#&]open=([A-Za-z0-9_-]{1,30})/.exec(location.hash);
  if (!m) return;
  const id = m[1];
  let tries = 0;
  const t = setInterval(() => {
    const b = id === "colis" ? document.querySelector("[data-open-colis]") : document.getElementById(id);
    if (b || ++tries > 40) {
      clearInterval(t);
      if (b) setTimeout(() => b.click(), 300);
    }
  }, 250);
})();
