"use strict";
// THÈME « OBSIDIAN CRIMSON » : présentation seulement (css/obsidian.css). Icônes duotone de la barre d'onglets et des tuiles d'accueil,
// logo œil dans l'en-tête, bandeau d'accueil illustré. Aucun identifiant ni comportement n'est modifié.
(() => {
  const E = window.ENOS || {}, ic = (n) => (E.hubIcon ? E.hubIcon(n) : "");
  const $ = (s) => document.querySelector(s);
  const TAB = { home: "home", chat: "chat", tools: "grid", pc: "monitor" };
  document.querySelectorAll("#tabbar button[data-tab]").forEach((b) => { const sv = b.querySelector("svg"); if (sv && TAB[b.dataset.tab]) sv.outerHTML = ic(TAB[b.dataset.tab]); });
  const brand = $("#top .brand");
  if (brand && !brand.querySelector("span")) { const sm = brand.querySelector("small"); const sp = document.createElement("span"); sp.append(document.createTextNode("E.N.O.S."), sm || ""); brand.textContent = ""; brand.appendChild(sp); }
  document.querySelectorAll('.grid2 .tile[data-persona]').forEach((t) => { const sv = t.querySelector("svg"); if (sv) sv.outerHTML = ic(t.dataset.persona === "eto" ? "smile" : "chat"); });
  const hero = $('.view[data-v="home"] .hero');
  if (hero && !hero.classList.contains("ob-hero")) {
    hero.classList.add("ob-hero");
    const box = document.createElement("div"); box.className = "ob-hc";
    while (hero.firstChild) box.appendChild(hero.firstChild);
    const sub = document.createElement("p"); sub.className = "ob-sub"; sub.textContent = "Ton centre de commande personnel.";
    box.insertBefore(sub, $("#h-clock"));
    hero.innerHTML = '<img class="ob-hbg" src="img/ui/homeeye.webp" alt="" draggable="false">'; hero.appendChild(box);
  }
  if (E.plans) E.plans.apply(false);                                       // marque E.T.O. / E.N.O.S. et couleur de la version active
  const meta = document.querySelector("meta[name=theme-color]"); if (meta) meta.content = "#08090d";
})();
