"use strict";
// BARRE DE RECHERCHE DES OUTILS : filtre instantané (sans accents ni casse) des boutons de la liste [ MODULES ] par leur nom.
(() => {
  const $ = (id) => document.getElementById(id);
  const norm = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  // nom de l'outil = texte du bouton SANS la ligne de description (<small>) ni les pastilles
  const nameOf = (btn) => [...btn.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ");

  function init() {
    const q = $("side-q"), clear = $("side-q-x"), none = $("side-none");
    const list = document.querySelector("#side .sec");                       // première section = [ MODULES ]
    if (!q || !list) return;
    const items = [...list.querySelectorAll(":scope > button.btn")].map((b) => ({ b, key: norm(nameOf(b)) }));

    function apply() {
      const t = norm(q.value);
      let shown = 0;
      items.forEach(({ b, key }) => {
        const hit = !t || t.split(" ").every((w) => key.includes(w));          // tous les mots saisis doivent apparaître dans le nom
        b.classList.toggle("srch-off", !hit);
        if (hit) shown++;
      });
      clear.hidden = !q.value;
      none.hidden = !t || shown > 0;
    }

    q.addEventListener("input", apply);
    q.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { q.value = ""; apply(); }
      if (e.key === "Enter") {                                                // Entrée : ouvre le premier outil visible
        const first = items.find(({ b }) => !b.classList.contains("srch-off") && b.offsetParent !== null);
        if (first) first.b.click();
      }
    });
    clear.onclick = () => { q.value = ""; apply(); q.focus(); };
    apply();
  }
  init();
})();
