"use strict";
// SÉLECTEUR DE BOTS commun (Game Clips, Simultanée) : TOUS les bots de la plateforme — ETO, E.N.O.S., Stockfish, personnages, moteurs et IA,
// puis l'échelle complète (débutants → joueurs pro, streamers, spéciaux…). Recherche par nom, avatar, Elo. E.botPick.open({title, exclude}) -> id | null.
(() => {
  const E = window.ENOS, esc = E.esc;
  const TOP = 3650;                                                                     // Elo du bot le plus fort de la plateforme (Stockfish 19 complet)
  E.TOP_ELO = TOP;
  const BP = (E.botPick = {});
  const OWN = ["eto", "enos", "stockfish"], CHARS = ["nasko", "penoire", "lelex", "naskurieux", "ghorghor", "naskolit", "jester", "prime"];
  const DEF_ELO = { eto: TOP, enos: TOP, stockfish: TOP, nasko: 1300, penoire: 2500, lelex: 1150, naskurieux: 1, ghorghor: 1400, naskolit: 3200, jester: 1600, prime: 9999 };
  const chat = () => (E.botChat && E.botChat.bots) || {};
  const nameOf = (id) => (id === "stockfish" ? "Stockfish 19" : chat()[id] ? chat()[id].name : E.aiBots && E.aiBots.def[id] ? E.aiBots.def[id].name : id);
  const imgOf = (id) => { if (id === "stockfish") return "img/bots/stockfish.png"; const r = E.botRoster && E.botRoster.byId[id]; if (r) return r.img; const c = chat()[id]; if (c && c.img) return c.img; const d = E.aiBots && E.aiBots.def[id]; return (d && d.img) || ""; };
  const eloOf = (id) => { if (DEF_ELO[id] != null) return DEF_ELO[id]; const r = E.botRoster && E.botRoster.byId[id]; if (r) return r.adapt ? E.botRoster.adaptElo() : r.real || r.elo; const p = window.ENOS_AIPROF && window.ENOS_AIPROF[id]; return (p && p.eloEst) || 1500; };
  /** [{cat, title, items: [{id, name, img, elo, sub}]}] */
  BP.groups = (o) => {
    o = o || {};
    const ex = new Set(o.exclude || []), mk = (id, sub) => ({ id, name: nameOf(id), img: imgOf(id), elo: eloOf(id), sub: sub || "" });
    const roster = (E.botRoster && E.botRoster.list) || [], rIds = new Set(roster.map((b) => b.id));
    const ai = ((E.aiBots && E.aiBots.ids) || []).filter((id) => !rIds.has(id) && !OWN.includes(id) && !CHARS.includes(id));
    const out = [...(o.extra && o.extra.length ? [{ cat: "humans", title: o.extraTitle || "Joueurs", items: o.extra.map((x) => ({ id: x.id, name: x.name, img: "", elo: x.elo || 0, sub: x.sub || "" })) }] : []), { cat: "top", title: "ETO, E.N.O.S. et Stockfish", items: OWN.map((id) => mk(id)) },
      { cat: "chars", title: "Personnages", items: CHARS.filter((id) => chat()[id] && !(o.noPrime && id === "prime")).map((id) => mk(id)) },
      { cat: "ai", title: "Moteurs et IA", items: ai.map((id) => mk(id)) }];
    if (E.botRoster) E.botRoster.CATS.forEach(([c, title]) => { const items = roster.filter((b) => b.cat === c).map((b) => ({ id: b.id, name: b.name, img: b.img, elo: b.adapt ? E.botRoster.adaptElo() : b.elo, sub: b.title || "" })); if (items.length) out.push({ cat: c, title, items }); });
    out.forEach((g) => (g.items = g.items.filter((x) => !ex.has(x.id))));
    return out.filter((g) => g.items.length);
  };
  BP.all = (o) => BP.groups(o).flatMap((g) => g.items);
  BP.name = nameOf; BP.img = imgOf; BP.elo = eloOf;
  const av = (x) => (x.img ? `<img src="${esc(x.img)}" alt="" loading="lazy">` : `<span class="bp-ph">${esc(x.name.slice(0, 2).toUpperCase())}</span>`);
  BP.chip = (id, label, nm) => { const human = String(id).startsWith("h:"), n = nm || (human ? id.slice(2) : nameOf(id)), e = human ? 0 : eloOf(id);
    return `<span class="bp-chip">${av({ id, name: n, img: human ? "" : imgOf(id) })}<span><small>${esc(label || "")}</small><b>${esc(n)}</b></span><i>${e >= 9999 ? "∞" : e || ""}</i></span>`; };
  /** ouvre la liste ; résout l'id choisi (ou null si fermée) */
  BP.open = (o) => new Promise((res) => {
    o = o || {}; let done = false;
    const groups = BP.groups(o), total = groups.reduce((a, g) => a + g.items.length, 0);
    const html = `<input class="bp-q" type="search" placeholder="Rechercher parmi ${total} bots" autocomplete="off"><div class="ro-pick bp-list">${groups.map((g) => `<h4 class="ro-cat" data-g>${esc(g.title)} <small>${g.items.length}</small></h4><div class="ro-grid">${g.items.map((x) =>
      `<button class="ro-bot${x.id === o.current ? " on" : ""}" data-b="${esc(x.id)}" data-n="${esc(x.name.toLowerCase())}">${av(x)}<b>${esc(x.name)}</b><small>${x.sub ? esc(x.sub) + " · " : ""}${x.elo >= 9999 ? "∞" : x.elo ? x.elo + " Elo" : ""}</small></button>`).join("")}</div>`).join("")}</div>`;
    const s = E.ui.sheet({ title: o.title || "Choisir un bot", html, options: [{ label: "Fermer" }], onClose: () => { if (!done) res(null); } });
    const q = s.querySelector(".bp-q");
    q.oninput = () => { const v = q.value.trim().toLowerCase(); s.querySelectorAll(".ro-grid").forEach((gr) => { let n = 0; gr.querySelectorAll(".ro-bot").forEach((b) => { const ok = !v || b.dataset.n.includes(v); b.hidden = !ok; n += ok; }); gr.hidden = !n; gr.previousElementSibling.hidden = !n; }); };
    s.querySelectorAll(".ro-bot").forEach((b) => (b.onclick = () => { done = true; E.vibrate && E.vibrate(8); E.ui.closeSheet(true); res(b.dataset.b); }));
  });
})();
