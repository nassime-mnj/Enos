"use strict";
// Ouvre « Échecs · Apprendre & Conseiller » (static/learn/) en plein écran par-dessus l'interface ; la page prévient (postMessage) quand on la ferme.
// Trois boutons : APPRENDRE LES ÉCHECS (puzzles, ouvertures…), CONSEILLER BRILLANTS (capture d'écran → coups brillants) et ARÈNE DES BOTS (#arena).
(() => {
  let box = null;
  const close = () => { if (box) { box.remove(); box = null; } };
  const open = (hash) => {
    if (box) return;
    box = document.createElement("div");
    box.style.cssText = "position:fixed;inset:0;z-index:99999;background:#050506";
    const f = document.createElement("iframe");
    f.src = "/static/learn/" + (hash || ""); f.title = "Échecs"; f.style.cssText = "width:100%;height:100%;border:0";
    box.append(f); document.body.append(box);
  };
  window.enosOpenLearn = open;
  const learn = document.getElementById("b-learn"), adv = document.getElementById("b-adv");
  if (learn) learn.addEventListener("click", () => open(""));
  if (adv) adv.addEventListener("click", () => open("#advisor"));
  const arena = document.getElementById("b-arena");
  if (arena) arena.addEventListener("click", () => open("#arena"));
  window.addEventListener("message", (e) => { if (e.origin === location.origin && e.data && e.data.enos === "learn-close") close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
})();
