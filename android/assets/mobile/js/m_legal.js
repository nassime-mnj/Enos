"use strict";
// INFORMATIONS LÉGALES : CGU, CGV, confidentialité, mentions (textes de docs/legal, générés dans legal_data.js) + réglage des statistiques anonymes.
(() => {
  const E = window.ENOS, esc = E.esc, DOCS = window.ENOS_LEGAL || [];
  E.suite.register({
    id: "legal", group: "sync", title: "Informations légales", sub: "CGU, CGV, confidentialité",
    icon: '<path d="M12 3v18M5 7h14M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0zM8 21h8"/>',
    build(el) {
      let cur = E.settings.get("legal.tab", "cgu");
      const paint = () => {
        const d = DOCS.find((x) => x.id === cur) || DOCS[0];
        el.innerHTML = `<div class="lg-tabs">${DOCS.map((x) => `<button data-t="${x.id}" class="${x.id === d.id ? "on" : ""}">${esc(x.title)}</button>`).join("")}</div>
          ${d.id === "privacy" ? `<div class="card im-auto"><div class="im-sw"><div><h3>Statistiques anonymes</h3><p class="muted">Nombre d'ouvertures par module, sans lien avec ton compte.</p></div>
            <button class="im-tg${E.metrics && E.metrics.enabled() ? " on" : ""}" id="lg-met" role="switch" aria-checked="${!!(E.metrics && E.metrics.enabled())}"><i></i></button></div></div>` : ""}
          <article class="card lg-doc"><h3>${esc(d.title)}</h3>${d.html}</article>`;
        el.querySelectorAll(".lg-tabs button").forEach((b) => (b.onclick = () => { cur = b.dataset.t; E.settings.set("legal.tab", cur); paint(); }));
        const m = el.querySelector("#lg-met"); if (m) m.onclick = () => { E.metrics.set(!E.metrics.enabled()); E.ui.toast(E.metrics.enabled() ? "Statistiques activées." : "Statistiques désactivées.", "ok"); paint(); };
      };
      paint();
    },
  });
  document.addEventListener("click", (e) => {                               // liens « conditions », « confidentialité » partout dans l'application
    const a = e.target.closest && e.target.closest("[data-legal]"); if (!a) return;
    e.preventDefault(); if (document.querySelector("#sheet:not([hidden])")) E.ui.closeSheet(true); E.legal.open(a.dataset.legal);
  });
  E.legal = { open: (tab) => { if (tab) E.settings.set("legal.tab", tab); E.ui.go("tools"); E.modules.open("legal"); } };
})();
