"use strict";
// ARÈNE DES BOTS (version PC) : le même moteur de Défis que sur le téléphone (m_defis.js : Nasko, Nasko pénoire, Lelex, Naskurieux, GhorGhor, ETO Brillant, E.N.O.S., Stockfish, combats…),
// avec une interface de bureau : lobby de cartes à grands portraits, constructeur de combat (deux emplacements + préréglages), partie en 3 colonnes (combattant · plateau · combattant + transcript),
// raccourcis clavier (Espace = pause, Échap = retour). Aucune logique de jeu ici : tout passe par l'API de m_defis (el._api.launch / setup).
(() => {
  const E = window.ENOS, esc = E.esc;
  const ROSTER = [
    { id: "nasko", name: "Nasko", elo: 1300, text: "Joue comme La_Loi_De_Fortes : Scandinave, Gambit Alien, une gaffe de temps en temps. Ironique, il commente tout." },
    { id: "lelex", name: "Lelex", elo: 1150, text: "Joue comme Lepoissonsteve80. Phrases courtes, « XDDD », « vrm mdrr ». Tombe dans les mêmes pièges que lui." },
    { id: "ghorghor", name: "GhorGhor", elo: 1400, text: "Style Lelex, 1400 Elo. S'il perd plus de 2 pièces mineures, l'écran glitche : GhorGhor le vrai (GM 3200) se réveille." },
    { id: "penoire", name: "Nasko (pénoire)", elo: 2500, text: "2500 Elo, chasseur de coups brillants comme ETO. Sûr de lui, il a toujours un mot pour toi à la fin." },
    { id: "naskurieux", name: "Naskurieux", elo: 1, title: "GM", text: "Agent GM à 1 Elo : +200 Elo à chaque erreur de son adversaire et à chaque meilleur coup qu'il joue lui-même." },
    { id: "naskolit", name: "Naskolit", elo: 3200, title: "GM", text: "Il dort, mais il est GM à 3200 Elo. Il perd 100 Elo à chaque imprécision et chaque fois que tu trouves le meilleur coup. Il ne dit pas un mot." },
    { id: "jester", name: "Le Jester", elo: 1600, eloText: "roue 1-3200", text: "Une roue tire son Elo au hasard (1 à 3200) avant son 1er coup puis tous les 10 coups. Bouffon élégant : il commente avec esprit." },
    { id: "brillant", fighter: "eto", name: "ETO Brillant", elo: 3200, text: "3200 Elo, traque le sacrifice gagnant. Essaie de faire aussi bien : un « !! » ne se refuse pas." },
    { id: "enos", fighter: "enos", name: "E.N.O.S.", elo: 3200, text: "Stockfish pleine puissance, froid et précis. Cherche lui aussi le coup brillant, ne répète jamais." },
  ];
  const FIGHTERS = { nasko: "Nasko", penoire: "Nasko (pénoire)", lelex: "Lelex", ghorghor: "GhorGhor", naskurieux: "Naskurieux", naskolit: "Naskolit", jester: "Le Jester", eto: "ETO Brillant", enos: "E.N.O.S.", stockfish: "Stockfish" };
  const PRESETS = [["nasko", "penoire", "Nasko vs Pénoire"], ["lelex", "eto", "Lelex vs ETO Brillant"], ["penoire", "eto", "Pénoire vs ETO Brillant"], ["lelex", "penoire", "Lelex vs Pénoire"], ["nasko", "lelex", "Nasko vs Lelex"],
    ["penoire", "enos", "Pénoire vs E.N.O.S."], ["naskurieux", "penoire", "Naskurieux vs Pénoire"], ["naskolit", "penoire", "Naskolit vs Pénoire"], ["jester", "eto", "Le Jester vs ETO Brillant"], ["jester", "naskolit", "Le Jester vs Naskolit"], ["ghorghor", "eto", "GhorGhor vs ETO Brillant"], ["ghorghor", "nasko", "GhorGhor vs Nasko"], ["nasko", "nasko", "Nasko vs Nasko"], ["penoire", "penoire", "Pénoire vs Pénoire"], ["eto", "stockfish", "ETO Brillant vs Stockfish"]];
  const tbadge = (elo, title) => (E.botChat ? E.botChat.badge(E.botChat.titleOf(elo, title)) : "");
  const portrait = (id, cls) => {
    const k = id === "brillant" ? "eto" : id;
    return E.botChat && E.botChat.has(k) ? E.botChat.avatar(k, cls) : `<div class="bot-av ph ${cls || ""}" style="--c:#8d8d97">${k === "stockfish" ? "SF" : esc(k.slice(0, 3).toUpperCase())}</div>`;
  };

  function mount(host) {
    const api = host.querySelector(".suite-body") ? host.querySelector(".suite-body")._api : host._api;
    const main = host.closest("main");
    if (main) main.id = "app";                                                   // cible du glitch / de l'ambiance sombre de GhorGhor
    host.classList.add("arena");
    const home = host.querySelector("#df-home"), game = host.querySelector("#df-game");
    const last = E.settings.get("defi.combat", ["nasko", "penoire"]);
    const lobby = document.createElement("div");
    lobby.id = "ar-lobby";
    const FAM = api.families ? api.families().filter(([t]) => !["Bots E.N.O.S.", "En équipe", "Spectacle"].includes(t)) : [];     // familles partagées avec le téléphone
    const ALLF = { ...FIGHTERS, ...(api.fighters ? api.fighters() : {}) };                                   // le combat de bots accepte TOUS les bots
    const opts = (v) => Object.entries(ALLF).map(([k, n]) => `<option value="${k}" ${k === v ? "selected" : ""}>${esc(n)}</option>`).join("");
    const I = (n) => (E.hubIcon ? E.hubIcon(n) : "");
    const big = ROSTER.slice(0, 5), small = ROSTER.slice(5);
    const pick = `<div class="ar-pick" hidden><small>Tu joues avec…</small><button class="btn" data-c="w"><i class="kw"></i>BLANCS</button><button class="btn" data-c="b"><i class="kb"></i>NOIRS</button><button class="btn pri" data-c="r">🎲 AU HASARD</button></div>`;
    lobby.innerHTML = `
      <section class="ar-hero"><img class="ar-hero-bg" src="img/ui/arena.webp" alt=""><div class="ar-hero-c">
        <div class="ar-kick">ARÈNE ×4</div><h2>Quatre joueurs. Une seule victoire.</h2><p>Le plateau d'échecs à 4 joueurs : alliances, trahisons et stratégie totale. 4 bots, tempête, équipes.</p>
        <div class="ar-others ar-x4"><button class="btn pri" data-x4="0">${I("swords")}1v1v1v1 · CHACUN POUR SOI</button><button class="btn" data-x4="1">${I("users")}2v2 · OPPOSÉS ALLIÉS</button><button class="btn" data-x4="2">${I("grid4")}2v2 · VOISINS ALLIÉS</button></div></div></section>
      <section class="ar-sec ar-own"><h3>CHOISIR UN ADVERSAIRE<span>les bots E.N.O.S. : affronte-les en duel, ils te parlent pendant la partie</span></h3>
        <div class="ar-cards">${big.map((r, i) => `
        <article class="ar-card" data-id="${r.id}" style="--d:${i}">
          <div class="ar-pt">${portrait(r.fighter || r.id)}</div>
          <div class="ar-nm">${tbadge(r.elo, r.title)}<b>${esc(r.name)}</b><span class="ar-elo">${I("chart")}${r.eloText || r.elo}</span></div>
          <p>${esc(r.text)}</p>
          <div class="ar-go2"><button class="btn pri ar-defy">${I("swords")}DÉFIER</button><button class="btn ar-info">${I("search")}DÉTAILS</button></div>${pick}
        </article>`).join("")}</div>
        <div class="ar-cards ar-small">${small.map((r, i) => `
        <article class="ar-card compact" data-id="${r.id}" style="--d:${i + 5}">
          <div class="ar-pt">${portrait(r.fighter || r.id)}</div>
          <div class="ar-cc"><div class="ar-nm">${tbadge(r.elo, r.title)}<b>${esc(r.name)}</b><span class="ar-elo">${r.eloText || r.elo + " Elo"}</span></div><p>${esc(r.text)}</p>
          <div class="ar-go2"><button class="btn pri ar-defy">${I("swords")}DÉFIER</button><button class="btn ar-info">${I("search")}DÉTAILS</button></div></div>${pick}
        </article>`).join("")}</div></section>
      ${FAM.map(([t, list]) => `<section class="ar-sec"><h3>${esc(t.toUpperCase())}<span>${list.length} bot${list.length > 1 ? "s" : ""}</span></h3><div class="ar-mini">${list.map((b) => `
        <button class="ar-bot" data-b="${b.id}">${b.img ? `<img src="${b.img}" alt="" loading="lazy">` : `<span class="ar-ini">${esc(b.name.slice(0, 2).toUpperCase())}</span>`}<b>${esc(b.name)}</b><small>${b.elo !== "" ? esc(String(b.elo)) + (typeof b.elo === "number" ? " Elo" : "") : ""}</small></button>`).join("")}</div></section>`).join("")}
      <section class="ar-sec ar-fight"><h3>⚔ COMBAT DE BOTS<span>choisis qui affronte qui : ils se parlent pendant la partie, elle est enregistrée et rejouable</span></h3>
        <div class="ar-presets">${PRESETS.map((p, i) => `<button data-p="${i}">${esc(p[2])}</button>`).join("")}</div>
        <div class="ar-slots">
          <div class="ar-slot"><div class="ar-pt" id="ar-pw"></div><label>BLANCS<select id="ar-cw" class="sel">${opts(last[0])}</select></label></div>
          <div class="ar-vs"><b>VS</b><button class="mini" id="ar-swap" title="Inverser">⇄</button></div>
          <div class="ar-slot"><div class="ar-pt" id="ar-pb"></div><label>NOIRS<select id="ar-cb" class="sel">${opts(last[1])}</select></label></div>
        </div>
        <div class="row"><button class="btn pri big" id="ar-fight">⚔ COMBATTRE</button></div></section>
      <section class="ar-sec"><h3>AUTRES DÉFIS</h3><div class="ar-others">
        <button class="btn" data-m="coach">COURS · TOI VS BOT + COACH ETO</button><button class="btn" data-m="speedrun">SPEEDRUN · ETO VS BOT</button><button class="btn" data-m="titans">⚔ CHOC DES TITANS</button><button class="btn" data-m="boss">👑 BOSS FINAL · STOCKFISH</button></div></section>`;
    host.insertBefore(lobby, host.firstChild);

    const slots = () => {
      const cw = lobby.querySelector("#ar-cw").value, cb = lobby.querySelector("#ar-cb").value;
      lobby.querySelector("#ar-pw").innerHTML = portrait(cw); lobby.querySelector("#ar-pb").innerHTML = portrait(cb);
      return [cw, cb];
    };
    slots();
    lobby.querySelector("#ar-cw").onchange = lobby.querySelector("#ar-cb").onchange = slots;
    lobby.querySelector("#ar-swap").onclick = () => { const w = lobby.querySelector("#ar-cw"), b = lobby.querySelector("#ar-cb"), t = w.value; w.value = b.value; b.value = t; slots(); };
    lobby.querySelector(".ar-presets").onclick = (e) => { const b = e.target.closest("button[data-p]"); if (!b) return; const p = PRESETS[+b.dataset.p]; lobby.querySelector("#ar-cw").value = p[0]; lobby.querySelector("#ar-cb").value = p[1]; slots(); };
    lobby.querySelectorAll("[data-x4]").forEach((b) => (b.onclick = () => E.royale ? E.royale.open(+b.dataset.x4) : (location.hash = "#royale", location.reload())));
    lobby.querySelector("#ar-fight").onclick = () => { const [cw, cb] = slots(); E.settings.set("defi.combat", [cw, cb]); api.launch("combat", { color: "w", cw, cb }); };
    lobby.querySelector(".ar-own").onclick = (e) => {
      const card = e.target.closest(".ar-card"); if (!card) return;
      if (e.target.closest(".ar-defy")) { const p = card.querySelector(".ar-pick"), was = !p.hidden; lobby.querySelectorAll(".ar-pick").forEach((x) => (x.hidden = true)); lobby.querySelectorAll(".ar-card.picking").forEach((x) => x.classList.remove("picking")); p.hidden = was; card.classList.toggle("picking", !was); return; }
      if (e.target.closest(".ar-info")) return api.setup(card.dataset.id);                                  // fiche du bot (couleur, cadence, Elo)
      const b = e.target.closest("button[data-c]");
      if (!b) return;
      const c = b.dataset.c === "r" ? (Math.random() < 0.5 ? "w" : "b") : b.dataset.c, id = card.dataset.id;
      api.launch(id, { color: c, elo: 1200, pow: 100, boss: "eto" });
    };
    document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".ar-card.picking")) { lobby.querySelectorAll(".ar-pick").forEach((x) => (x.hidden = true)); lobby.querySelectorAll(".ar-card.picking").forEach((x) => x.classList.remove("picking")); } });   // clic ailleurs : le choix de couleur se referme
    lobby.querySelectorAll(".ar-mini").forEach((g) => (g.onclick = (e) => { const b = e.target.closest(".ar-bot"); if (b) api.setup(b.dataset.b); }));     // fiche du bot (couleur, cadence)
    lobby.querySelectorAll(".ar-others").forEach((g) => (g.onclick = (e) => { const b = e.target.closest("button[data-m]"); if (b) api.setup(b.dataset.m); }));

    // le lobby est visible quand la liste des défis de m_defis l'est (retour d'une partie) ; la partie occupe tout l'écran
    const sync = () => { const inGame = !game.hidden; lobby.hidden = inGame; host.classList.toggle("in-game", inGame); document.body.classList.toggle("arena-game", inGame); };
    new MutationObserver(sync).observe(game, { attributes: true, attributeFilter: ["hidden"] });
    sync();
    document.addEventListener("keydown", (e) => {
      if (host.hidden || host.closest("[hidden]") || /INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ""))) return;
      if (e.key === " " && game && !game.hidden) { const p = host.querySelector("#b-pause"); if (p) { e.preventDefault(); p.click(); } }
      else if (e.key === "Escape" && game && !game.hidden) { const b = host.querySelector("#df-back"); if (b) { e.stopPropagation(); b.click(); } }
    });
  }
  E.arena = { mount };
})();
