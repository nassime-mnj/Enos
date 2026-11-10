"use strict";
// HUB DES MODULES « pro » : 7 catégories à icônes lumineuses → pages de catégorie en sections → tuiles (icône + nom, AUCUNE description), recherche, récents, transitions animées
// (icône qui voyage vers l'en-tête, pages qui se superposent, tuile qui s'agrandit en module) et animation de clic (onde + pression + vibration).
// Les modules eux-mêmes ne changent pas : le hub ne fait que les ranger et les ouvrir (modules.js fournit open / métadonnées).
(() => {
  const E = window.ENOS, $ = E.$, esc = E.esc, H = (E.hub = {});
  const CC = (n) => `img/menu/cc_${n}.png`;

  // ------------------------------------------------------------------ L'ARBORESCENCE
  // item : [id, nom?, icône?]  — id d'un module, ou « @action:valeur » ; icône « cc:xxx » (icônes Chess.com) sinon l'icône du module.
  const CATS = [
    { id: "echecs", n: "ÉCHECS", t: "Échecs", img: "cat_echecs", sections: [
      { n: "Jouer", big: true, items: [["@tc:bullet", "Bullet · 1 min", "cc:bullet"], ["@tc:blitz", "Blitz · 3 min", "cc:blitz"], ["@tc:rapid", "Rapide · 10 min", "cc:rapid"], ["@tc:daily", "Différé · 3 jours", "cc:daily"]] },
      { n: "Affronter", items: [["defis", "Bots & défis", "cc:hand"], ["chess", "Contre E.N.O.S.", "cc:board"], ["@resume", "Reprendre", "cc:timer"], ["@team", "Équipes", "cc:users"], ["@combat", "Combat de bots", "cc:handshake"], ["royale", "Battle Royale", "cc:fourway"], ["variants", "Variantes", "cc:variants"], ["prime", "ChatGPT Prime", "cc:flag"]] },
      { n: "Apprendre", items: [["@learn:lessons", "Leçons", "cc:knight_w"], ["@puz:", "Puzzles", "cc:rush"], ["@learn:openings", "Ouvertures", "cc:bishop_w"], ["@puz:mateIn1", "Mats", "cc:mate"], ["@puz:fork", "Fourchettes", "cc:fork"], ["@puz:pin", "Clouages", "cc:pin"], ["@puz:skewer", "Enfilades", "cc:skewer"], ["@learn:advice", "Conseils", "cc:rook_w"], ["train", "Entraînement", "cc:timer"]] },
      { n: "Analyser", items: [["advisor", "Analyse", "cc:vision"], ["@prof:games", "Historique", "cc:board"], ["@import", "Importer un PGN", "cc:flag"]] },
      { n: "Créer", items: [["chessedit", "Chess Edit", "cc:medal"], ["clips", "Game Clips", "cc:pawn_w"]] },
      { n: "Profil", items: [["@prof:stats", "Statistiques", "cc:user"], ["@prof:prizes", "Prix", "cc:medal"]] },
    ] },
    { id: "cloud", n: "CLOUD", t: "Cloud", img: "cat_cloud", sections: [
      { n: "Mon compte", items: [["cloud"], ["s-upd", "Mise à jour"], ["backup"]] },
      { n: "Échanger", items: [["clip"], ["b-sy", "Sync PC"], ["vault"]] },
    ] },
    { id: "parametres", n: "PARAMÈTRES", t: "Paramètres", img: "cat_parametres", sections: [
      { n: "Application", items: [["s-set", "Réglages"], ["theme", "Thèmes"], ["api", "Contrôle API"]] },
      { n: "Mon PC", items: [["s-qr", "Appairer le PC"], ["b-rg", "Réglages du PC"]] },
    ] },
    { id: "codage", n: "CODAGE", t: "Codage", img: "cat_codage", sections: [
      { n: "Apprendre à coder", items: [["codelab"]] },
      { n: "Outils de développeur", items: [["text"], ["sprites"], ["b-dev", "Dev Manager"]] },
    ] },
    { id: "outils", n: "OUTILS", t: "Outils", img: "cat_outils", sections: [
      { n: "Documents", items: [["pdf"], ["scan", "Scanner"], ["syllabus"]] },
      { n: "Photo, audio, vidéo", items: [["img", "Photos"], ["compress"], ["audiolab"], ["cinepulse"]] },
      { n: "Nettoyage", items: [["clean", "Nettoyeur"], ["cleaner", "Stockage"]] },
      { n: "Détente", items: [["eye", "Œil"], ["chill"], ["purge"], ["g2048"], ["snake"], ["mines"]] },
    ] },
    { id: "organisation", n: "ORGANISATION", t: "Organisation", img: "cat_organisation", sections: [
      { n: "Planning", items: [["agenda"], ["syllabus"]] },
      { n: "Argent", items: [["expenses"], ["subs"]] },
      { n: "Fichiers", items: [["files", "Dossiers"], ["colis"], ["b-og", "Organisateur PC"]] },
    ] },
    { id: "ordinateur", n: "ORDINATEUR", t: "Ordinateur", img: "cat_ordinateur", sections: [
      { n: "Pilotage", items: [["pc", "Tests F6"], ["b-hb", "Hub équipe"], ["b-sys", "Système"]] },
      { n: "Maintenance", items: [["b-dc", "Deep Cleaner"], ["b-se", "Sécurité"], ["b-api", "API du PC"]] },
      { n: "Web", items: [["b-yt", "YouTube"], ["b-tb", "Google"]] },
    ] },
  ];
  H.CATS = CATS;

  let api = null, root = null, cur = null, busy = false;
  const meta = (id) => (api && api.find(id)) || null;
  const recents = () => E.settings.get("hub.recent", []);
  const MOD = { tc: "defis", team: "defis", combat: "defis", learn: "learn", puz: "learn", prof: "chessprofile", resume: "defis", import: "chessedit" }, modOf = (id) => (id.startsWith("@") ? MOD[id.slice(1).split(":")[0]] : id);
  const remember = (id) => { id = modOf(id); if (!id) return; const l = [id].concat(recents().filter((x) => x !== id)).slice(0, 8); E.settings.set("hub.recent", l); };
  const iconHtml = (m, spec) => {
    if (spec && spec.startsWith("cc:")) return `<img class="hub-cc" src="${CC(spec.slice(3))}" alt="" draggable="false">`;
    if (m && m.svg) return `<svg viewBox="0 0 24 24" class="hub-gl">${m.svg}</svg>`;
    return api.ico(m && m.i ? m.i : "gear").replace("<svg", '<svg class="hub-gl"');
  };
  // un élément de menu -> { key, name, icon, kind, off }
  const resolve = (it) => {
    const id = it[0], m = id.startsWith("@") ? null : meta(id);
    if (!id.startsWith("@") && !m) return null;
    const k = m ? api.kindOf(m) : "native";
    return { id, name: it[1] || (m ? m.n : id), icon: iconHtml(m, it[2]), cc: !!(it[2] && it[2].startsWith("cc:")), kind: k, off: k === "pc" && !api.online() };
  };
  const tile = (r, i, big) => `<button class="hub-tile${big ? " big" : ""} k-${r.kind}${r.off ? " k-off" : ""}${r.cc ? " cc" : ""}" data-id="${esc(r.id)}" style="--i:${i}"><span class="hub-ic">${r.icon}</span><b>${esc(r.name)}</b>${r.kind === "locked" ? '<i class="hub-lk"><svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></i>' : r.kind === "pc" ? '<i class="hub-pcb">PC</i>' : ""}</button>`;

  // ------------------------------------------------------------------ rendu
  function renderRoot() {
    const rec = recents().map((id) => ({ id, m: meta(id) })).filter((x) => x.m).slice(0, 5);
    root.innerHTML = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="hubg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#9aa3c4"/></linearGradient></defs></svg><div class="hub-top"><div class="hub-brand">MODULES</div>
        <label class="hub-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="hub-q" type="search" placeholder="Rechercher" autocomplete="off" enterkeyhint="search"><button type="button" class="hub-x" id="hub-qx" hidden aria-label="Effacer">✕</button></label></div>
      <div class="hub-main">
        ${rec.length ? `<div class="hub-rec"><span>RÉCENTS</span><div class="hub-recs">${rec.map((x, i) => `<button class="hub-chip" data-id="${esc(x.id)}" style="--i:${i}"><span>${iconHtml(x.m, "")}</span>${esc(x.m.n)}</button>`).join("")}</div></div>` : ""}
        <div class="hub-cats">${CATS.map((c, i) => `<button class="hub-cat" data-c="${c.id}" style="--i:${i}"><span class="hub-ci"><img src="img/menu/${c.img}.png" alt="" draggable="false"></span><span class="hub-cl">${esc(c.n)}</span></button>`).join("")}</div>
        <div class="hub-res" id="hub-res" hidden></div>
      </div>
      <div class="hub-page" id="hub-page" hidden></div>`;
  }
  function renderPage(c) {
    let n = 0;
    const secs = c.sections.map((s) => {
      const items = s.items.map(resolve).filter(Boolean); if (!items.length) return "";
      return `<section class="hub-sec"><h4><span>${esc(s.n)}</span></h4><div class="hub-grid${s.big ? " big" : ""}">${items.map((r) => tile(r, n++, s.big)).join("")}</div></section>`;
    }).join("");
    $("#hub-page").innerHTML = `<header class="hub-ph"><button class="hub-back" id="hub-back" aria-label="Retour"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><span class="hub-pi"><img src="img/menu/${c.img}.png" alt="" draggable="false"></span><h2>${esc(c.n)}</h2></header><div class="hub-body">${secs}</div>`;
  }
  function renderResults(q) {
    q = q.trim().toLowerCase(); const box = $("#hub-res"), cats = root.querySelector(".hub-cats"), rec = root.querySelector(".hub-rec");
    if (!q) { box.hidden = true; cats.hidden = false; if (rec) rec.hidden = false; return; }
    const seen = new Set(), out = [];
    CATS.forEach((c) => c.sections.forEach((s) => s.items.forEach((it) => { const r = resolve(it); if (!r) return; const hay = (r.name + " " + c.t + " " + s.n).toLowerCase(); if (hay.includes(q) && !seen.has(r.id + r.name)) { seen.add(r.id + r.name); out.push([r, c.t]); } })));
    cats.hidden = true; if (rec) rec.hidden = true; box.hidden = false;
    box.innerHTML = out.length ? `<div class="hub-grid">${out.map(([r, ct], i) => tile(r, i, false).replace("</button>", `<em>${esc(ct)}</em></button>`)).join("")}</div>` : '<p class="hub-none">Aucun résultat</p>';
  }

  // ------------------------------------------------------------------ transitions
  const EASE = "cubic-bezier(.2,.85,.2,1)";
  const rect = (el) => el.getBoundingClientRect();
  const reduced = () => document.documentElement.classList.contains("no-anim") || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  function flyIcon(fromEl, toEl, dur, back) {                                                   // l'icône voyage de la grille vers l'en-tête (et inversement)
    if (reduced() || !fromEl || !toEl || !fromEl.animate) return Promise.resolve();
    const a = rect(fromEl), b = rect(toEl), img = fromEl.querySelector("img").cloneNode(true); img.className = "hub-fly";
    Object.assign(img.style, { left: a.left + "px", top: a.top + "px", width: a.width + "px", height: a.height + "px" }); document.body.appendChild(img);
    const dx = b.left - a.left, dy = b.top - a.top, s = b.width / a.width;
    const an = img.animate([{ transform: "translate(0,0) scale(1)", }, { transform: `translate(${dx * 0.5}px,${dy * 0.5 - 18}px) scale(${(1 + s) / 2 * 1.12})`, offset: 0.55 }, { transform: `translate(${dx}px,${dy}px) scale(${s})` }], { duration: dur, easing: EASE, fill: "forwards" });
    return an.finished.catch(() => 0).then(() => img.remove());
  }
  H.openCat = async (cid) => {
    const c = CATS.find((x) => x.id === cid); if (!c || busy) return; busy = true; cur = cid; remember_cat(cid);
    renderPage(c); const page = $("#hub-page"), main = root.querySelector(".hub-main"), top = root.querySelector(".hub-top"), btn = root.querySelector(`.hub-cat[data-c="${cid}"] .hub-ci`);
    E.vibrate && E.vibrate(8); root.classList.add("in-cat");
    page.hidden = false; page.classList.remove("out"); page.classList.add("in"); const pi = page.querySelector(".hub-pi"); pi.style.visibility = "hidden";
    main.classList.add("away"); top.classList.add("away");
    await flyIcon(btn, pi, 460); pi.style.visibility = ""; page.classList.remove("in"); page.classList.add("settled"); main.hidden = true; top.hidden = true; busy = false; window.scrollTo && 0;
  };
  const remember_cat = (cid) => E.settings.set("hub.cat", cid);
  H.closeCat = async () => {
    if (busy || !cur) return; busy = true; const cid = cur; const page = $("#hub-page"), main = root.querySelector(".hub-main"), top = root.querySelector(".hub-top"), pi = page.querySelector(".hub-pi");
    E.vibrate && E.vibrate(6); page.classList.remove("settled"); main.hidden = false; top.hidden = false; main.classList.add("away"); top.classList.add("away"); void main.offsetWidth;
    const btn = root.querySelector(`.hub-cat[data-c="${cid}"] .hub-ci`); page.classList.add("out"); pi.style.visibility = "hidden"; main.classList.remove("away"); top.classList.remove("away");
    const fly = flyIcon(pi, btn, 420); await Promise.all([fly, new Promise((r) => setTimeout(r, reduced() ? 0 : 300))]);
    page.hidden = true; page.classList.remove("out"); root.classList.remove("in-cat"); cur = null; busy = false; renderRoot();
  };
  function zoomInto(el, then) {                                                                 // la tuile s'agrandit en plein écran puis laisse place au module
    if (reduced() || !el || !document.body.animate) return then();
    const r = rect(el), z = document.createElement("div"); z.className = "hub-zoom"; z.innerHTML = el.innerHTML; z.querySelector("b") && (z.querySelector("b").style.opacity = ".9");
    Object.assign(z.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" }); document.body.appendChild(z);
    const W = window.innerWidth, Hh = window.innerHeight, an = z.animate([{ left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px", borderRadius: "18px", opacity: 1 }, { left: "0px", top: "0px", width: W + "px", height: Hh + "px", borderRadius: "0px", opacity: 1 }], { duration: 300, easing: EASE, fill: "forwards" });
    an.finished.catch(() => 0).then(() => { then(); const f = z.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: "ease-out", fill: "forwards" }); f.finished.catch(() => 0).then(() => z.remove()); });
  }

  // ------------------------------------------------------------------ actions
  const deep = (id, fn, tries) => { let n = 0; const t = setInterval(() => { const el = document.querySelector(`#tool-${id} .suite-body`); if ((el && el._ready !== false && el.children.length) || ++n > (tries || 40)) { clearInterval(t); if (el) try { fn(el); } catch (e) { /* module absent */ } } }, 60); };
  function act(id) {
    const [a, v] = id.slice(1).split(":");
    if (a === "tc") { E.settings.set("defi.tc", v); api.open("defis"); deep("defis", (el) => { const g = el.querySelector("#df-home"); if (g) E.ui.toast("Cadence : " + ({ bullet: "Bullet 1 min", blitz: "Blitz 3 min", rapid: "Rapide 10 min", daily: "Différé 3 jours" })[v] + " · choisis ton adversaire", "ok", 2600); }); return; }
    if (a === "team") { api.open("defis"); deep("defis", (el) => el._api && el._api.setup("teams")); return; }
    if (a === "combat") { api.open("defis"); deep("defis", (el) => el._api && el._api.setup("combat")); return; }
    if (a === "learn") { api.open("learn"); deep("learn", (el) => { const b = el.querySelector(`#lr-tabs [data-t="${v}"]`); if (b) b.click(); }); return; }
    if (a === "puz") { api.open("learn"); deep("learn", (el) => { const b = el.querySelector('#lr-tabs [data-t="puzzles"]'); if (b) b.click(); setTimeout(() => { const c = el.querySelector(`#pz-themes [data-t="${v}"]`); if (c) c.click(); }, 120); }); return; }
    if (a === "resume") { api.open("defis"); deep("defis", (el) => { const c = el.querySelector("#df-dcard"); if (c && !c.hidden) c.scrollIntoView({ behavior: "smooth", block: "center" }); else E.ui.toast("Aucune partie en différé en cours", "warn", 2600); }); return; }
    if (a === "import") { api.open("chessedit"); deep("chessedit", (el) => { const c = el.querySelector("#ce-imp"); if (c) c.scrollIntoView({ behavior: "smooth", block: "start" }); }); return; }
    if (a === "prof") { api.open("chessprofile"); deep("chessprofile", (el) => el._api && el._api.tab(v)); return; }
  }
  function launch(id, srcEl) {
    if (id.startsWith("@")) { remember(id); return zoomInto(srcEl, () => act(id)); }
    const m = meta(id); if (!m) return;
    remember(id); zoomInto(srcEl, () => api.open(id));
  }

  // ------------------------------------------------------------------ montage
  H.init = (a, host) => {
    api = a; root = document.createElement("div"); root.className = "hub"; host.innerHTML = ""; host.appendChild(root); renderRoot();
    root.addEventListener("click", (e) => {
      const cat = e.target.closest(".hub-cat"); if (cat) return H.openCat(cat.dataset.c);
      if (e.target.closest("#hub-back")) return H.closeCat();
      const t = e.target.closest(".hub-tile, .hub-chip"); if (t) return launch(t.dataset.id, t);
      if (e.target.closest("#hub-qx")) { const i = $("#hub-q"); i.value = ""; $("#hub-qx").hidden = true; renderResults(""); i.focus(); }
    });
    root.addEventListener("input", (e) => { if (e.target.id === "hub-q") { $("#hub-qx").hidden = !e.target.value; renderResults(e.target.value); } });
  };
  // ANIMATION DE CLIC : onde lumineuse à l'endroit du doigt + vibration légère, sur les boutons du hub, des modules et des feuilles
  document.addEventListener("pointerdown", (e) => {
    const t = e.target.closest && e.target.closest(".hub-tile, .hub-chip, .hub-back, .btn, .opt, .df-mode"); if (!t || document.documentElement.classList.contains("no-anim")) return;
    const r = t.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2.1, s = document.createElement("span"); s.className = "rip";
    Object.assign(s.style, { left: e.clientX - r.left + "px", top: e.clientY - r.top + "px", width: d + "px", height: d + "px" }); t.appendChild(s); setTimeout(() => s.remove(), 650);
  }, { passive: true });
  H.refresh = () => { if (!root) return; const keep = cur; const q = ($("#hub-q") || {}).value || ""; if (!keep) { renderRoot(); const i = $("#hub-q"); if (i && q) { i.value = q; renderResults(q); } } else { renderPage(CATS.find((c) => c.id === keep)); } };
  H.show = () => { if (!root) return; if (!cur) renderRoot(); else { renderPage(CATS.find((c) => c.id === cur)); $("#hub-page").classList.add("settled"); } };                                // retour depuis un module : l'accueil (ou la catégorie) est déjà là
  H.cur = () => cur;
  H.has = (id) => CATS.some((c) => c.sections.some((s) => s.items.some((i) => modOf(i[0]) === id)));
})();
