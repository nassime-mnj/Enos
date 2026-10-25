"use strict";
// Ouvre « Apprendre les échecs » (static/learn/) en plein écran par-dessus l'interface ; la page prévient (postMessage) quand on la ferme.
(() => {
  const btn = document.getElementById("b-learn");
  if (!btn) return;
  let box = null;
  const close = () => { if (box) { box.remove(); box = null; } };
  btn.addEventListener("click", () => {
    if (box) return;
    box = document.createElement("div");
    box.style.cssText = "position:fixed;inset:0;z-index:99999;background:#050506";
    const f = document.createElement("iframe");
    f.src = "/static/learn/"; f.title = "Apprendre les échecs"; f.style.cssText = "width:100%;height:100%;border:0";
    box.append(f); document.body.append(box);
  });
  window.addEventListener("message", (e) => { if (e.origin === location.origin && e.data && e.data.enos === "learn-close") close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
})();
