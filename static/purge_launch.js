"use strict";
// PURGE.EXE : lance le survivor d'E.N.O.S. (static/purge.js, même moteur que sur le téléphone) en plein écran par-dessus l'interface.
(() => {
  let box = null, game = null;
  const close = () => { if (game) { game.destroy(); game = null; } if (box) { box.remove(); box = null; } };
  const open = () => {
    if (box) return;
    const go = () => {
      box = document.createElement("div");
      box.style.cssText = "position:fixed;inset:0;z-index:99999;background:#06060a";
      document.body.append(box);
      game = window.ENOSPurge.mount(box, { onExit: close });
    };
    if (window.ENOSPurge) return go();
    const s = document.createElement("script"); s.src = "/static/purge.js"; s.onload = go; document.head.append(s);
  };
  window.enosOpenPurge = open;
  const b = document.getElementById("b-purge");
  if (b) b.addEventListener("click", open);
})();
