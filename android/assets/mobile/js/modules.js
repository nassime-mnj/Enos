"use strict";
// HUB DES MODULES : tous les modules d'E.N.O.S. sur le téléphone, classés selon ce qui est possible.
//   NATIF       fonctionne sur le téléphone, avec ou sans PC (agenda, photos, dossiers, nettoyeur, contrôle API, œil, thèmes, chat)
//   AVEC LE PC  utilise le PC quand il est connecté : échecs (Stockfish du PC), et les modules de l'interface complète (ouverts directement sur le bon module)
//   RÉSERVÉ PC  modules qui pilotent les fichiers / programmes du PC : volontairement non accessibles à distance (un téléphone perdu ne doit pas pouvoir s'en servir)
// + THÈMES : couleur d'accent (Coreboard rouge, cyan, vert, ambre, violet…) appliquée à toute l'application.
(() => {
  const E = window.ENOS, $ = E.$, esc = E.esc, U = E.ui, L = E.link;
  const IC = {
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>', eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
    chess: '<path d="M8 21h8M9 21c0-4 1-6 1-9-2-1-3-3-3-5a5 5 0 0 1 10 0c0 2-1 4-3 5 0 3 1 5 1 9"/>', img: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
    folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
    gauge: '<path d="M4 18a9 9 0 1 1 16 0M12 18l4-7"/>', palette: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="16" cy="10" r="1.2"/><path d="M12 21a2.5 2.5 0 0 1 0-5h2a2 2 0 0 0 0-4"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>', box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
    sync: '<path d="M21 12a9 9 0 0 0-15-6.7L3 8M3 3v5h5M3 12a9 9 0 0 0 15 6.7L21 16M21 21v-5h-5"/>', play: '<path d="M6 4l14 8-14 8z"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4M4.2 4.2l2.8 2.8M17 17l2.8 2.8M4.2 19.8L7 17M17 7l2.8-2.8"/>',
    film: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 4v16M17 4v16M2 12h20"/>', users: '<circle cx="9" cy="8" r="4"/><path d="M1 21a8 8 0 0 1 16 0M17 4a4 4 0 0 1 0 8M23 21a8 8 0 0 0-5-7"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/>',
    yt: '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l5 3-5 3z"/>', globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>', term: '<path d="M4 17l6-6-6-6M12 19h8"/>', shield: '<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/>',
  };
  const ico = (k) => `<svg viewBox="0 0 24 24">${IC[k] || IC.gear}</svg>`;

  // kind : native | pc (a besoin du PC connecté) | locked (réservé au PC)
  const GROUPS = [
    ["Sur ton téléphone", [
      { id: "agenda", n: "Agenda", s: "Cours, rendus, tâches", i: "cal", k: "native" },
      { id: "chess", n: "Échecs", s: "Contre E.N.O.S. · hors ligne", i: "chess", k: "native", sub: true },
      { id: "eye", n: "Œil", s: "E.N.O.S. · ETO en face à face", i: "eye", k: "native" },
      { id: "img", n: "Photos", s: "Compresser la pellicule", i: "img", k: "native" },
      { id: "files", n: "Dossiers", s: "Ranger Téléchargements, documents", i: "folder", k: "native" },
      { id: "clean", n: "Nettoyeur", s: "Gros fichiers, doublons", i: "trash", k: "native" },
      { id: "api", n: "Contrôle API", s: "Quotas ElevenLabs · Groq", i: "gauge", k: "native" },
      { id: "theme", n: "Thèmes", s: "Couleur de l'application", i: "palette", k: "native" },
    ]],
    ["Avec ton PC", [
      { id: "pc", n: "Tests F6", s: "Lancer ton jeu à distance", i: "play", k: "pc", tab: "pc" },
      { id: "colis", n: "Colis", s: "Gérer les colis en attente", i: "box", k: "pc" },
      { id: "b-sy", n: "Sync", s: "PC ⇄ mobile · fichiers", i: "sync", k: "pc" },
      { id: "b-hb", n: "Hub équipe", s: "Entrepôt · chat", i: "users", k: "pc" },
      { id: "b-rg", n: "Réglages du PC", s: "Thèmes du PC, profil, appareils", i: "gear", k: "pc" },
    ]],
    ["Réservé au PC (sécurité)", [
      { id: "b-sys", n: "Système", s: "Profils, Turbo, capteurs", i: "cpu", k: "locked", why: "Il pilote l'alimentation et les réglages de Windows." },
      { id: "b-dc", n: "Deep Cleaner PC", s: "Supprime des fichiers du PC", i: "trash", k: "locked", why: "Il supprime des fichiers du PC : trop risqué à distance.", alt: "clean", altn: "Ouvrir le Nettoyeur du téléphone" },
      { id: "b-og", n: "Organisateur", s: "Fichiers du PC", i: "folder", k: "locked", why: "Il déplace et supprime des fichiers du PC." },
      { id: "b-yt", n: "YouTube Uploader", s: "Envoi de vidéos", i: "yt", k: "locked", why: "Il utilise ta connexion Google et les vidéos du PC." },
      { id: "b-tb", n: "Gestion Google", s: "Onglets Chrome du PC", i: "globe", k: "locked", why: "Il contrôle le navigateur du PC." },
      { id: "b-dev", n: "Dev Manager", s: "WSL, dépôts, scripts", i: "term", k: "locked", why: "Il exécute des commandes sur le PC." },
      { id: "b-se", n: "Sécurité", s: "Clé, chemins, alertes", i: "shield", k: "locked", why: "Il gère les accès au PC : à régler depuis le PC." },
      { id: "b-api", n: "API du PC", s: "Quotas côté PC", i: "gauge", k: "locked", why: "Compteurs du PC, lisibles seulement sur le PC.", alt: "api", altn: "Ouvrir le Contrôle API du téléphone" },
    ]],
  ];
  let ALL = GROUPS.flatMap((g) => g[1]);
  // outils de la suite (suite.js : JSON/XML, dépenses, PDF, scanner…) : groupes ajoutés après « Sur ton téléphone »
  function addSuiteGroups() {
    if (!E.suite) return;
    const NAMES = { chess: "Échecs & apprentissage", dev: "Code & apprentissage", pro: "Productivité (comme sur le PC)", scan: "Scanner & stockage", sync: "Synchronisation" };
    let at = 1;
    Object.keys(NAMES).forEach((g) => {
      const list = E.suite.modules.filter((m) => (m.group || "pro") === g).map((m) => ({ id: m.id, n: m.title, s: m.sub || "", svg: m.icon, k: "native", suite: true }));
      if (list.length) GROUPS.splice(at++, 0, [NAMES[g], list]);
    });
    ALL = GROUPS.flatMap((g) => g[1]);
  }

  // DROITS COMPLETS : si le propriétaire les a accordés à ce téléphone (sur le PC : Réglages → Appareils de confiance), les modules « réservés au PC » s'ouvrent comme les autres
  const full = () => !!(L.state === "online" && L.snap && L.snap.full);
  const kindOf = (m) => (m.k === "locked" && full() ? "pc" : m.k);
  function grid() {
    const online = L.state === "online";
    $("#mod-grid").innerHTML = GROUPS.map(([title, mods]) => `<h4 class="mg-h">${esc(title === "Réservé au PC (sécurité)" && full() ? "Pilotage du PC · droits complets" : title)}</h4><div class="mod-grid">${mods.map((m) => {
      const k = kindOf(m), off = k === "pc" && !online;
      return `<button class="mtile ${k}${off ? " off" : ""}" data-m="${m.id}">${k === "locked" ? `<i class="lk">${ico("lock")}</i>` : ""}<span class="ic">${m.svg ? `<svg viewBox="0 0 24 24">${m.svg}</svg>` : ico(m.i)}</span><b>${esc(m.n)}</b><small>${esc(m.s)}</small></button>`;
    }).join("")}</div>`).join("");
  }

  function open(id) {
    const m = ALL.find((x) => x.id === id);
    if (!m) return;
    if (kindOf(m) === "locked") {
      return U.sheet({ title: m.n + " · réservé au PC", html: `<p class="muted" style="margin-bottom:14px;line-height:1.5">${esc(m.why)} Pour le piloter depuis ce téléphone (qui t'appartient comme le PC), donne-lui les <b>droits complets</b> : sur le PC, <b>Réglages du PC → Appareils de confiance → DROITS COMPLETS</b>. Ça ne se règle que depuis le PC, jamais depuis un téléphone.</p>`,
        options: m.alt ? [{ label: m.altn, fn: () => open(m.alt) }] : [] });
    }
    if (kindOf(m) === "pc" && L.state !== "online") { U.toast("Ce module pilote ton PC : il doit être allumé (même Wi-Fi ou Tailscale).", "warn"); E.link.probeNow(); return; }
    if (m.suite) return E.suite.open(id);
    if (m.tab) return U.go(m.tab);
    if (id === "theme") return themeSheet();
    if (kindOf(m) === "pc" && !m.sub) return E.native.openPcModule(id);
    E.tools.show(id);
    E.apps.enter(id);
    if (id === "chess") E.chessUi.open();
  }

  // ------------------------------------------------------------------ thèmes
  const PRESETS = [["Coreboard", 352], ["Cyan", 188], ["ETO vert", 128], ["Ambre", 38], ["Violet", 272], ["Rose", 320]];
  const T = (E.theme = {
    apply(h) {
      h = Math.max(0, Math.min(360, Math.round(h)));
      const r = document.documentElement.style;
      r.setProperty("--red", `hsl(${h} 78% 52%)`); r.setProperty("--red2", `hsl(${h} 100% 65%)`); r.setProperty("--red-dim", `hsl(${h} 62% 20%)`);
      r.setProperty("--red-deep", `hsl(${h} 70% 11%)`); r.setProperty("--red-a", `hsl(${h} 78% 52% / `); r.setProperty("--grid", `hsl(${h} 80% 30% / .15)`); r.setProperty("--halo", `hsl(${h} 90% 24% / .42)`);
      r.setProperty("--btn1", `hsl(${h} 82% 30%)`); r.setProperty("--btn2", `hsl(${h} 74% 48%)`);
      E.settings.set("hue", h);
      const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = "#050506";
    },
    init() { T.apply(E.settings.get("hue", 352)); },
  });
  function themeSheet() {
    const cur = E.settings.get("hue", 352);
    const s = U.sheet({ title: "Thèmes", html: `<div class="presets">${PRESETS.map(([n, h]) => `<button class="preset${Math.abs(h - cur) < 3 ? " on" : ""}" data-h="${h}" style="--c:hsl(${h} 78% 52%)"><i></i>${esc(n)}</button>`).join("")}</div>
      <label class="fld" style="margin-top:14px">Teinte personnalisée<b id="th-v">${cur}°</b></label><input type="range" id="th-h" min="0" max="360" value="${cur}" class="hue">
      <p class="muted" style="font-size:13px;margin-top:8px">Le thème du PC se règle dans « Réglages du PC ».</p>` });
    s.querySelectorAll(".preset").forEach((b) => (b.onclick = () => { T.apply(+b.dataset.h); s.querySelector("#th-h").value = b.dataset.h; s.querySelector("#th-v").textContent = b.dataset.h + "°"; s.querySelectorAll(".preset").forEach((x) => x.classList.toggle("on", x === b)); E.vibrate(8); }));
    s.querySelector("#th-h").oninput = (e) => { T.apply(+e.target.value); s.querySelector("#th-v").textContent = e.target.value + "°"; s.querySelectorAll(".preset").forEach((x) => x.classList.remove("on")); };
  }

  // Partage Android : une capture envoyée à E.N.O.S. ouvre le Conseiller brillants avec la position déjà lue
  function takeShared() {
    const b64 = E.native.pendingShare && E.native.pendingShare();
    if (!b64) return;
    U.go("tools"); open("advisor");
    const t0 = Date.now(), wait = setInterval(() => {
      const el = document.querySelector("#tool-advisor .suite-body");
      if ((el && el._loadShot) || Date.now() - t0 > 4000) { clearInterval(wait); if (el && el._loadShot) el._loadShot("data:image/png;base64," + b64); }
    }, 60);
  }
  E.native._shared = takeShared;

  E.modules = {
    init() {
      const home = $("#tools-home");
      home.innerHTML = '<div id="mod-grid"></div><p class="hint">Tout ce qui est « Sur ton téléphone » marche sans le PC. Les modules « Avec ton PC » pilotent ton ordinateur : ils se débloquent quand il est connecté.</p>';
      addSuiteGroups();
      grid();
      $("#mod-grid").addEventListener("click", (e) => { const t = e.target.closest(".mtile"); if (t) open(t.dataset.m); });
      E.on("link", grid);
      setTimeout(takeShared, 700);                                                    // l'application vient d'être lancée par « Partager »
      E.on("settings", (k) => { if (k === "hue") { /* déjà appliqué */ } });
    },
    open,
  };
})();
