"use strict";
// THÈME : appliqué AVANT le premier affichage (script en <head>) pour éviter tout flash de l'ancien thème.
// Mémorisé sur cet appareil (localStorage) : le PC de Raf et le vôtre peuvent avoir chacun leur thème.
(() => {
  const THEMES = [
    { id: "menace", name: "MENACE ROUGE", sub: "Thème d'E.N.O.S. : rouge sang sur acier noir. Intelligence hostile." },
    { id: "neon", name: "NÉON VERT", sub: "Le classique : terminal CRT, vert phosphore." },
    { id: "violet", name: "VIOLET CYBER", sub: "Même terminal, teinte ultraviolet." },
    { id: "rouge", name: "ROUGE SITH", sub: "Alerte permanente. Rouge sang sur noir." },
    { id: "ambre", name: "AMBRE RÉTRO", sub: "Écran ambre des vieux mainframes." },
    { id: "glace", name: "GLACE", sub: "Bleu polaire, froid et net." },
    { id: "synthwave", name: "SYNTHWAVE", sub: "Magenta/violet, soleil couchant, années 80." },
    { id: "luxe", name: "LUXE NOIR & OR", sub: "Serif, filets dorés, sobriété haut de gamme." },
    { id: "pro", name: "PRO", sub: "Graphite, police système, interface plate sans effets." },
    { id: "entreprise", name: "ENTREPRISE", sub: "Bleu marine, cartes élevées, look dashboard SaaS." },
    { id: "coreboard", name: "COREBOARD", sub: "Noir profond, grille rouge, titres pixel-art." },
    { id: "chill", name: "CHILL", sub: "Pastel, verre dépoli, formes douces et arrondies." },
  ];
  // Couleurs d'accent (déclinaisons de la palette rouge) : teinte / saturation pour les thèmes rouges (--h, --sat), le reste passe par accent.css (--ac…)
  const ACCENTS = [
    { id: "rouge", name: "ROUGE", color: "#e0243c", h: 352, s: 1 },
    { id: "violet", name: "VIOLET", color: "#8b5cf6", h: 268, s: .85 },
    { id: "or", name: "DORÉ", color: "#f2b705", h: 43, s: .95 },
    { id: "vert", name: "VERT", color: "#22b866", h: 145, s: .8 },
    { id: "bleu", name: "BLEU", color: "#2f8cff", h: 212, s: .95 },
  ];
  let _acCache = {};
  const RED_THEMES = ["menace", "coreboard", "rouge"];
  const root = document.documentElement;
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const set = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

  function apply() {
    const id = get("enos_persona", "enos") === "eto" ? "eto" : THEMES.some((t) => t.id === get("enos_theme", "")) ? get("enos_theme", "") : "menace";   // ETO : thème blanc imposé, le thème choisi est conservé
    root.dataset.theme = id;
    let h = get("enos_hue", null), s = get("enos_sat", null);
    const ac = ACCENTS.find((a) => a.id === get("enos_accent", "rouge")) || ACCENTS[0];
    root.dataset.accent = ac.id;
    if (get("enos_shiny", null) === "1") root.dataset.shiny = "1"; else delete root.dataset.shiny;
    if (h === null && ac.id !== "rouge" && RED_THEMES.includes(id)) { h = String(ac.h); s = String(ac.s); }   // l'accent recolore aussi les thèmes rouges (sauf couleur personnalisée)
    h === null ? root.style.removeProperty("--h") : root.style.setProperty("--h", h);          // couleur personnalisée : prioritaire sur la teinte du thème
    s === null ? root.style.removeProperty("--sat") : root.style.setProperty("--sat", s);
    _acCache = {};
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = id === "eto" ? "#f6f8f7" : id === "menace" ? "#050304" : id === "chill" ? "#1b1635" : id === "entreprise" ? "#0a1020" : id === "pro" ? "#0d1015" : "#000000";
  }
  apply();

  // couleur du thème pour les dessins canvas (animation F6…) : lue à l'exécution, donc toujours à jour
  window.enosColor = (a = 1) => {
    const c = getComputedStyle(root).getPropertyValue("--neon").trim() || "#00ff41";
    return a >= 1 ? c : `color-mix(in srgb, ${c} ${Math.round(a * 100)}%, transparent)`;
  };

  // couleur d'accent résolue en rgb() pour les dessins canvas : window.enosAccent("--ac2")
  window.enosAccent = (name = "--ac") => {
    if (_acCache[name]) return _acCache[name];
    const el = document.createElement("i"); el.style.cssText = "position:absolute;visibility:hidden;color:var(" + name + ")";
    (document.body || root).appendChild(el);
    const c = getComputedStyle(el).color; el.remove();
    return (_acCache[name] = c || "#e0243c");
  };

  window.enosTheme = {
    list: THEMES,
    accents: ACCENTS,
    accent: () => get("enos_accent", "rouge"),
    setAccent(id) { set("enos_accent", ACCENTS.some((a) => a.id === id) && id !== "rouge" ? id : null); set("enos_hue", null); set("enos_sat", null); apply(); },
    shiny: () => get("enos_shiny", null) === "1",
    setShiny(on) { set("enos_shiny", on ? "1" : null); apply(); },
    refresh: apply,
    current: () => root.dataset.theme,
    hue: () => get("enos_hue", null), sat: () => get("enos_sat", null),
    setTheme(id) { set("enos_theme", id); set("enos_hue", null); set("enos_sat", null); apply(); },   // choisir un thème réinitialise la couleur personnalisée
    setHue(h) { set("enos_hue", String(h)); apply(); },
    setSat(s) { set("enos_sat", String(s)); apply(); },
    reset() { set("enos_hue", null); set("enos_sat", null); apply(); },
  };
})();
