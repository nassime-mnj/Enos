"use strict";
// HUB ÉCHECS (PC) — accueil unifié de tous les modes d'échecs d'E.N.O.S. : partie contre E.N.O.S., Arène des bots, Royale ×4, Variantes, Prime,
// Apprendre, Cours, Conseiller, Revue, Chess Edit, Clips, Sauvegarde… Les modules gardent leur code ; ce fichier ne fait que la présentation :
// héros 3D (vraie partie de Morphy rejouée sur un plateau en perspective, œil d'E.N.O.S. qui suit la souris, cavalier en parallaxe), cartes animées,
// défilé des bots, palette de commandes (Ctrl+K), en-tête de page des modules. Les modes qui vivent dans la fenêtre principale (partie contre E.N.O.S.,
// mise en condition, ouvertures avec ETO, Super ENOS, historique) sont demandés à la fenêtre parente par postMessage (learn_launch.js).
(() => {
  const E = window.ENOS, esc = E.esc, ic = (n, c) => E.hubIcon(n, c);
  const RM = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const PARENT = window.parent !== window;
  const G = {
    jouer: ["01", "Jouer", "Affronte E.N.O.S., plus d'une centaine de bots, le plateau à quatre et les règles inventées."],
    apprendre: ["02", "Apprendre & progresser", "Puzzles, ouvertures, cours commentés par ETO, conseils sur tes propres parties."],
    creer: ["03", "Analyser & créer", "Revois tes parties, monte des edits viraux, garde tout en sécurité."],
  };
  const MODES = [
    { id: "play", act: "play", g: "jouer", icon: "eye", title: "Jouer contre E.N.O.S.", desc: "Stockfish jusqu'à 3650 Elo, chaque coup jugé en direct, trash talk et voix. Choisis ton défi.", art: "img/ui/eyeking.webp", size: "xl", tags: ["Stockfish", "Jugement des coups", "Voix"],
      subs: [["enos", "Défi E.N.O.S.", "eye"], ["coach", "Cours avec ETO", "grad"], ["speedrun", "Speedrun", "zap"], ["titans", "Choc des titans", "swords"], ["boss", "Boss final", "skull"]] },
    { id: "arena", t: "arena", g: "jouer", icon: "swords", title: "Arène des bots", desc: "Bots E.N.O.S., légendes, joueurs pro, streamers : affronte-les ou fais-les combattre entre eux.", size: "wide", art: "@bots", tags: ["Chat", "Titres GM/IM", "Combats"] },
    { id: "simul", t: "simul", g: "jouer", icon: "grid4", title: "Simultanée", desc: "Un adversaire contre 2 à 6 plateaux. N'importe quel bot de la plateforme, ou toi.", tags: ["1v2 à 1v6", "Tous les bots"] },
    { id: "royale", t: "royale", g: "jouer", icon: "crown", title: "Royale ×4", desc: "Le plateau à quatre joueurs : chacun pour soi ou 2v2, tempête, alliances et trahisons.", size: "wide", art: "img/ui/arena.webp", tags: ["4 joueurs", "Tempête"] },
    { id: "variants", t: "variants", g: "jouer", icon: "flask", title: "Variantes", desc: "Élixir façon Clash Royale, Deux Rois, Protège la Dame : des règles inventées.", art: "img/clash_arena.png", tags: ["Contre un bot", "À deux"] },
    { id: "prime", t: "prime", g: "jouer", icon: "bot", title: "ChatGPT Prime", desc: "Il triche avec aplomb : coups aberrants annoncés, pièces ressuscitées, edits goofy.", art: "img/bots/prime.png", tags: ["Goofy", "Edits"] },
    { id: "cond", act: "cond", g: "jouer", icon: "target", title: "Mise en condition", desc: "Plateau libre : pose tes pièces, colle une capture, réveille E.N.O.S. ou ETO.", tags: ["Position libre", "Capture d'écran"] },
    { id: "learn", t: "learn", g: "apprendre", icon: "grad", title: "Apprendre", desc: "Puzzles, ouvertures, coups brillants, leçons et conseils personnalisés.", tags: ["Puzzles", "Ouvertures"] },
    { id: "course", t: "course", g: "apprendre", icon: "radio", title: "Cours en direct", desc: "ETO commente chaque coup pendant que tu joues, flèches à l'appui.", tags: ["Coach ETO"] },
    { id: "study", act: "study", g: "apprendre", icon: "book", title: "Ouvertures avec ETO", desc: "ETO enseigne les ouvertures : flèches, retour en arrière, pratique guidée.", tags: ["Répertoire"] },
    { id: "advisor", t: "advisor", g: "apprendre", icon: "bulb", title: "Conseiller brillants", desc: "Colle une capture d'écran : les pièces sont reconnues, ETO cherche les « !! ».", tags: ["Vision", "Sacrifices"] },
    { id: "chessedit", t: "chessedit", g: "creer", icon: "clapper", title: "Chess Edit Studio", desc: "Partie + musique → edit viral : intro VS, ralentis, effets, voix. Export MP4.", size: "wide", art: "@film", tags: ["Vidéo", "Effets", "Export"] },
    { id: "clips", t: "clips", g: "creer", icon: "drama", title: "Game Clips", desc: "Scènes mises en scène : duel ou simultanée de 1v2 à 1v6, avec tous les bots.", tags: ["Duel", "Simultanée"] },
    { id: "game", t: "game", g: "creer", icon: "scan", title: "Revue de partie", desc: "Ta dernière partie coup par coup : meilleur coup, brillants, erreurs.", tags: ["Analyse"] },
    { id: "hist", act: "hist", g: "creer", icon: "history", title: "Historique & bilan", desc: "Tes dix dernières parties contre E.N.O.S., rejouables, PGN copiable.", tags: ["PGN"] },
    { id: "train", act: "train", g: "creer", icon: "brain", title: "Super ENOS", desc: "E.N.O.S. s'entraîne en arrière-plan contre Stockfish et ETO et tire des leçons.", tags: ["Arrière-plan"] },
    { id: "backup", t: "backup", g: "creer", icon: "database", title: "Sauvegarde", desc: "Retrouve tes parties et entraînements du téléphone : fusion ou remplacement.", tags: ["Téléphone"] },
  ];
  const BY = Object.fromEntries(MODES.map((m) => [m.id, m]));
  const byTab = (t) => MODES.find((m) => m.t === t);
  const toast = (m) => (E.ui && E.ui.toast ? E.ui.toast(m) : console.log(m));

  /** lance un mode : onglet de cette page, ou action de la fenêtre principale d'E.N.O.S. */
  function act(id, mode) {
    const m = BY[id]; if (!m) return;
    remember(id);
    if (m.t) return E.suite.open(m.t);
    if (!PARENT) return toast("Ouvre les échecs depuis E.N.O.S. pour lancer « " + m.title + " ».");
    window.parent.postMessage({ enos: "learn-act", act: m.act, mode: mode || "" }, "*");
  }
  const RK = "hub.recent";
  function remember(id) { try { const r = (E.settings.get(RK, []) || []).filter((x) => x !== id); r.unshift(id); E.settings.set(RK, r.slice(0, 6)); } catch (e) { /* stockage indisponible */ } }

  // ------------------------------------------------------------------ portraits (défilé + carte Arène)
  function faces() {
    const own = ["enos", "eto", "nasko", "penoire", "lelex", "ghorghor", "naskurieux", "naskolit", "jester"].map((id) => ({ id, name: { enos: "E.N.O.S.", eto: "ETO", penoire: "Nasko (pénoire)", ghorghor: "GhorGhor", naskurieux: "Naskurieux", naskolit: "Naskolit", jester: "Le Jester", lelex: "Lelex", nasko: "Nasko" }[id], img: "img/bots/" + id + ".png", elo: { enos: 3650, eto: 3650, nasko: 1300, penoire: 2500, lelex: 1150, ghorghor: 1400, naskurieux: 1, naskolit: 3200, jester: "?" }[id], own: true }));
    const ros = E.botRoster ? E.botRoster.list.filter((b) => b.img) : [];
    return { own, ros };
  }
  const botCount = () => (E.botRoster ? E.botRoster.list.length : 0) + 9 + (E.aiBots ? E.aiBots.ids.length : 0) + 1;     // échelle + 9 bots E.N.O.S. + moteurs/IA/joueurs (ai_bots) + Stockfish

  // ------------------------------------------------------------------ rendu du hub
  function art(m) {
    if (m.art === "@bots") {
      const f = faces(), pick = [f.own[2], f.own[3], f.own[0], f.own[4], f.own[6]].filter(Boolean);
      return `<div class="mc-art mc-fan">${pick.map((b, i) => `<img src="${b.img}" alt="" style="--i:${i}" loading="lazy">`).join("")}</div>`;
    }
    if (m.art === "@film") return `<div class="mc-art mc-film"><div class="fl-strip">${Array.from({ length: 6 }, (_, i) => `<i style="--i:${i}"><img src="${["img/ui/knight.webp", "img/bots/enos.png", "img/ui/arena.webp", "img/bots/prime.png", "img/ui/eyeking.webp", "img/bots/eto.png"][i]}" alt="" loading="lazy"></i>`).join("")}</div><b class="fl-rec">REC</b></div>`;
    if (m.art) return `<div class="mc-art"><img src="${m.art}" alt="" loading="lazy"></div>`;
    return `<div class="mc-art mc-ghost">${ic(m.icon, "ghost")}</div>`;
  }
  function card(m, i) {
    const subs = m.subs ? `<div class="mc-subs">${m.subs.map(([k, l, n]) => `<button class="mc-sub" data-mode="${k}" title="${esc(l)}">${ic(n)}<span>${esc(l)}</span></button>`).join("")}</div>` : "";
    return `<article class="mc ${m.size || ""}" data-id="${m.id}" tabindex="0" role="button" aria-label="${esc(m.title)}" style="--d:${i}">
      ${art(m)}<div class="mc-shade"></div><i class="mc-glare"></i>
      <div class="mc-body"><div class="mc-ico">${ic(m.icon)}</div>
        <h3>${esc(m.title)}</h3><p>${esc(m.desc)}</p>
        <div class="mc-tags">${(m.tags || []).map((t) => `<span>${esc(t)}</span>`).join("")}</div>${subs}</div>
      <span class="mc-go">${ic("arrow")}</span></article>`;
  }
  function render(host) {
    const f = faces();
    const strip = (list, rev) => `<div class="mq${rev ? " rev" : ""}"><div class="mq-t">${[...list, ...list].map((b, i) => `<button class="mq-b" data-bot="${esc(b.id)}" ${i >= list.length ? 'aria-hidden="true" tabindex="-1"' : ""}><img src="${b.img}" alt="" loading="lazy"><b>${esc(b.name)}</b><small>${esc(String(b.elo))}${typeof b.elo === "number" ? " Elo" : ""}</small></button>`).join("")}</div></div>`;
    const ros = f.ros, half = Math.ceil(ros.length / 2);
    host.innerHTML = `
      <section class="hero" id="hero">
        <div class="hero-copy">
          <div class="kicker"><span class="kdot"></span>E.N.O.S. · ÉCHECS</div>
          <h1 class="hero-t"><span class="ln">Joue.</span> <span class="ln">Apprends.</span> <span class="ln red">Domine.</span></h1>
          <p class="hero-s">Tous les modes d'échecs d'E.N.O.S. réunis : la partie contre l'œil, l'arène des bots, le plateau à quatre, les variantes, l'apprentissage et le studio d'edits.</p>
          <div class="hero-cta"><button class="hb pri" data-go="play">${ic("play")}<span>Jouer contre E.N.O.S.</span></button><button class="hb" data-go="arena">${ic("swords")}<span>Arène des bots</span></button><button class="hb ghost" data-go="learn">${ic("grad")}<span>Apprendre</span></button></div>
          <div class="hero-stats"><div><b data-count="${botCount()}">0</b><small>bots à affronter</small></div><div><b data-count="${MODES.length}">0</b><small>modes réunis</small></div><div><b>SF 19</b><small>moteur hors ligne</small></div></div>
        </div>
        <div class="hero-scene" id="scene" aria-hidden="true">
          <div class="sc-glow"></div><div class="sc-rays"></div>
          <div class="sc-board" id="lb"><div class="lb-sq"></div><div class="lb-pc"></div><div class="lb-fx"></div></div>
          <img class="sc-knight" src="img/ui/knight.webp" alt="">
          <div class="sc-beam"></div><div class="sc-eye"><img src="img/ui/eye.webp" alt=""></div>
          <div class="sc-cap" id="lb-cap"><b>Opéra de Paris, 1858</b><span>Morphy contre le duc de Brunswick et le comte Isouard</span><em id="lb-san"></em></div>
        </div>
      </section>
      ${Object.entries(G).map(([g, [n, t, s]]) => `<section class="grp" data-g="${g}"><div class="grp-h"><span class="grp-n">${n}</span><div><h2>${esc(t)}</h2><p>${esc(s)}</p></div><i class="grp-line"></i></div>
        <div class="bento b-${g}">${MODES.filter((m) => m.g === g).map(card).join("")}</div></section>`).join("")}
      <section class="grp bots-grp"><div class="grp-h"><span class="grp-n">04</span><div><h2>Les adversaires</h2><p>De Noel (1 Elo) à Magnus Carlsen, en passant par Witty Alien et les bots inventés pour E.N.O.S. Clique pour voir la fiche.</p></div><i class="grp-line"></i></div>
        ${strip(f.own.concat(ros.slice(0, half)))}${strip(ros.slice(half), true)}</section>
      <footer class="hub-foot">${ic("knight")}<span>Stockfish 19 · ${botCount()} bots · tout tourne sur ce PC, hors ligne.</span></footer>`;
    wire(host);
  }

  // ------------------------------------------------------------------ interactions
  function wire(host) {
    host.addEventListener("click", (e) => {
      const sub = e.target.closest(".mc-sub"); if (sub) { e.stopPropagation(); return act("play", sub.dataset.mode); }
      const go = e.target.closest("[data-go]"); if (go) return act(go.dataset.go);
      const bot = e.target.closest(".mq-b"); if (bot) return openBot(bot.dataset.bot);
      const c = e.target.closest(".mc"); if (c) act(c.dataset.id);
    });
    host.addEventListener("keydown", (e) => { const c = e.target.closest(".mc"); if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); act(c.dataset.id); } });
    // cartes : inclinaison 3D + reflet qui suit le curseur
    host.addEventListener("pointermove", (e) => {
      const c = e.target.closest(".mc"); if (!c || RM()) return;
      const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      c.style.setProperty("--mx", (x * 100).toFixed(1) + "%"); c.style.setProperty("--my", (y * 100).toFixed(1) + "%");
      c.style.setProperty("--rx", ((0.5 - y) * 7).toFixed(2) + "deg"); c.style.setProperty("--ry", ((x - 0.5) * 9).toFixed(2) + "deg");
    });
    host.addEventListener("pointerout", (e) => { const c = e.target.closest(".mc"); if (c && !c.contains(e.relatedTarget)) { c.style.setProperty("--rx", "0deg"); c.style.setProperty("--ry", "0deg"); } });
    // apparition en cascade au défilement
    const io = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.add("in"); io.unobserve(x.target); } }), { threshold: 0.12 });
    host.querySelectorAll(".mc, .grp-h, .mq").forEach((n) => io.observe(n));
    countUp(host);
    scene(host.querySelector("#scene"));
  }
  function openBot(id) {
    E.suite.open("arena");
    const tryOpen = (n) => {
      const api = document.querySelector("#app-arena") && document.querySelector("#app-arena")._api;
      const tile = document.querySelector('#ar-lobby .ar-bot[data-b="' + CSS.escape(id) + '"]');
      if (tile) { tile.scrollIntoView({ block: "center", behavior: RM() ? "auto" : "smooth" }); setTimeout(() => tile.click(), RM() ? 0 : 450); return; }
      const card = document.querySelector('#ar-lobby .ar-card[data-id="' + CSS.escape(id === "eto" ? "brillant" : id) + '"]');
      if (card) { card.scrollIntoView({ block: "center", behavior: RM() ? "auto" : "smooth" }); card.classList.add("flash"); setTimeout(() => card.classList.remove("flash"), 1600); return; }
      if (n < 40 && !api) setTimeout(() => tryOpen(n + 1), 150);
    };
    tryOpen(0);
  }
  function countUp(host) {
    host.querySelectorAll("[data-count]").forEach((b) => {
      const to = +b.dataset.count, t0 = performance.now(), D = RM() ? 1 : 1400;
      const step = (t) => { const k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 4); b.textContent = Math.round(to * e); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }

  // ------------------------------------------------------------------ scène du héros : plateau 3D + partie de l'Opéra
  const OPERA = ["e4", "e5", "Nf3", "d6", "d4", "Bg4", "dxe5", "Bxf3", "Qxf3", "dxe5", "Bc4", "Nf6", "Qb3", "Qe7", "Nc3", "c6", "Bg5", "b5", "Nxb5", "cxb5", "Bxb5+", "Nbd7", "O-O-O", "Rd8", "Rxd7", "Rxd7", "Rd1", "Qe6", "Bxd7+", "Nxd7", "Qb8+", "Nxb8", "Rd8#"];
  const SC = { timer: 0, raf: 0, on: false };
  function scene(el) {
    if (!el) return;
    const lb = el.querySelector("#lb"), sqL = lb.querySelector(".lb-sq"), pcL = lb.querySelector(".lb-pc"), fxL = lb.querySelector(".lb-fx");
    sqL.innerHTML = Array.from({ length: 64 }, (_, i) => { const x = i % 8, y = 7 - Math.floor(i / 8); return `<i class="${(x + y) % 2 ? "l" : "d"}" data-s="${"abcdefgh"[x] + (y + 1)}" style="--x:${x};--y:${y}"></i>`; }).join("");
    const pos = (s) => [s.charCodeAt(0) - 97, +s[1] - 1];
    let ch = null, pieces = {}, ply = 0;
    const place = (n, s) => { const [x, y] = pos(s); n.style.setProperty("--x", x); n.style.setProperty("--y", y); n.dataset.s = s; };
    function setup() {
      if (typeof Chess !== "function") return false;
      ch = new Chess(); pcL.innerHTML = ""; pieces = {}; ply = 0;
      lb.classList.remove("mate");
      for (const row of ch.board()) for (const p of row) if (p) {
        const n = document.createElement("i"); n.className = "pc"; n.innerHTML = `<b><img src="img/chess/${p.color}${p.type}.png" alt=""></b>`; place(n, p.square); pcL.appendChild(n); pieces[p.square] = n;
      }
      const cap = el.querySelector("#lb-san"); if (cap) cap.textContent = "";
      return true;
    }
    function light(s, cls, ms) { const q = sqL.querySelector(`[data-s="${s}"]`); if (!q) return; q.classList.remove(cls); void q.offsetWidth; q.classList.add(cls); if (ms) setTimeout(() => q.classList.remove(cls), ms); }
    function wave(s) {                                                         // vague de lumière en domino depuis la case d'arrivée
      if (RM()) return; const [x0, y0] = pos(s);
      sqL.querySelectorAll("i").forEach((q) => { const d = Math.hypot(+q.style.getPropertyValue("--x") - x0, +q.style.getPropertyValue("--y") - y0); q.style.setProperty("--w", (d * 55).toFixed(0) + "ms"); q.classList.remove("wv"); void q.offsetWidth; q.classList.add("wv"); });
    }
    function burst(s, big) {
      if (RM()) return; const [x, y] = pos(s);
      for (let k = 0; k < (big ? 26 : 12); k++) {
        const p = document.createElement("b"); p.className = "spk"; const a = Math.random() * Math.PI * 2, r = (big ? 90 : 50) + Math.random() * 60;
        p.style.cssText = `--x:${x};--y:${y};--dx:${(Math.cos(a) * r).toFixed(0)}px;--dy:${(Math.sin(a) * r).toFixed(0)}px;--t:${(450 + Math.random() * 500).toFixed(0)}ms`;
        fxL.appendChild(p); setTimeout(() => p.remove(), 1100);
      }
    }
    function step() {
      if (!SC.on) return;
      if (!ch || ply >= OPERA.length) { if (!setup()) return; SC.timer = setTimeout(step, 900); return; }
      const mv = ch.move(OPERA[ply++]); if (!mv) { ply = OPERA.length; SC.timer = setTimeout(step, 400); return; }
      sqL.querySelectorAll(".from,.to").forEach((q) => q.classList.remove("from", "to"));
      const cap = mv.flags.includes("e") ? mv.to[0] + mv.from[1] : mv.captured ? mv.to : null;
      if (cap && pieces[cap]) { const v = pieces[cap]; v.classList.add("dead"); setTimeout(() => v.remove(), 600); delete pieces[cap]; burst(mv.to, false); }
      const n = pieces[mv.from]; delete pieces[mv.from]; if (n) { place(n, mv.to); pieces[mv.to] = n; n.classList.remove("hop"); void n.offsetWidth; n.classList.add("hop"); }
      if (mv.flags.includes("k") || mv.flags.includes("q")) {                  // roque : la tour suit
        const r = mv.color === "w" ? "1" : "8", [rf, rt] = mv.flags.includes("k") ? ["h" + r, "f" + r] : ["a" + r, "d" + r], t = pieces[rf];
        if (t) { delete pieces[rf]; place(t, rt); pieces[rt] = t; }
      }
      light(mv.from, "from"); light(mv.to, "to"); wave(mv.to);
      const san = el.querySelector("#lb-san"); if (san) { san.textContent = (mv.color === "w" ? Math.ceil(ply / 2) + ". " : Math.ceil(ply / 2) + "… ") + mv.san + (ch.in_checkmate && ch.in_checkmate() ? "  échec et mat" : ""); san.classList.remove("pop"); void san.offsetWidth; san.classList.add("pop"); }
      if (ch.in_check && ch.in_check()) { const k = Object.keys(pieces).find((s) => ch.get(s) && ch.get(s).type === "k" && ch.get(s).color === ch.turn()); if (k) light(k, "chk", 900); }
      if (ch.in_checkmate && ch.in_checkmate()) { lb.classList.add("mate"); burst(mv.to, true); SC.timer = setTimeout(() => { lb.classList.add("fade"); setTimeout(() => { lb.classList.remove("fade"); setup(); SC.timer = setTimeout(step, 900); }, 700); }, 3800); return; }
      SC.timer = setTimeout(step, mv.captured ? 1500 : 1150);
    }
    // parallaxe : le plateau, le cavalier et l'œil réagissent à la souris (et respirent tout seuls)
    let tx = 0, ty = 0, cx = 0, cy = 0;
    const hero = el.closest(".hero");
    hero.addEventListener("pointermove", (e) => { const r = hero.getBoundingClientRect(); tx = (e.clientX - r.left) / r.width - 0.5; ty = (e.clientY - r.top) / r.height - 0.5; });
    hero.addEventListener("pointerleave", () => { tx = 0; ty = 0; });
    function frame(t) {
      if (!SC.on) return;
      cx += (tx - cx) * 0.06; cy += (ty - cy) * 0.06;
      const idle = RM() ? 0 : Math.sin(t / 2600) * 0.5;
      el.style.setProperty("--px", cx.toFixed(4)); el.style.setProperty("--py", cy.toFixed(4)); el.style.setProperty("--idle", idle.toFixed(4));
      SC.raf = requestAnimationFrame(frame);
    }
    SC.start = () => { if (SC.on) return; SC.on = true; SC.raf = requestAnimationFrame(frame); if (!ch && !setup()) return; SC.timer = setTimeout(step, 700); };
    SC.stop = () => { SC.on = false; clearTimeout(SC.timer); cancelAnimationFrame(SC.raf); };
    if (!document.hidden) SC.start();
  }
  document.addEventListener("visibilitychange", () => { if (!SC.start) return; if (document.hidden || !visible()) SC.stop(); else SC.start(); });
  const visible = () => { const h = document.getElementById("hub"); return !!(h && !h.hidden); };

  // ------------------------------------------------------------------ braises (canvas) : uniquement quand le hub est affiché
  const EM = { on: false, raf: 0 };
  function embers() {
    const c = document.getElementById("fx-embers"); if (!c || RM()) return;
    const g = c.getContext("2d"); let W = 0, H = 0, P = [];
    const size = () => { const d = Math.min(2, devicePixelRatio || 1); W = c.width = innerWidth * d; H = c.height = innerHeight * d; c.style.width = innerWidth + "px"; c.style.height = innerHeight + "px"; };
    size(); addEventListener("resize", size);
    const mk = (y) => ({ x: Math.random() * W, y: y == null ? Math.random() * H : y, r: (0.6 + Math.random() * 2.2) * (devicePixelRatio || 1), v: 0.25 + Math.random() * 0.8, s: Math.random() * 6.28, a: 0.25 + Math.random() * 0.6 });
    for (let i = 0; i < 70; i++) P.push(mk());
    function tick(t) {
      if (!EM.on) return;
      g.clearRect(0, 0, W, H); g.globalCompositeOperation = "lighter";
      for (const p of P) {
        p.y -= p.v; p.x += Math.sin(t / 1400 + p.s) * 0.35; if (p.y < -10) Object.assign(p, mk(H + 10));
        const fl = p.a * (0.6 + 0.4 * Math.sin(t / 300 + p.s * 3));
        const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 5);
        gr.addColorStop(0, `rgba(255,${90 + (p.s * 20 | 0)},90,${fl})`); gr.addColorStop(0.35, `rgba(239,23,72,${fl * 0.45})`); gr.addColorStop(1, "rgba(239,23,72,0)");
        g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.r * 5, 0, 6.283); g.fill();
      }
      EM.raf = requestAnimationFrame(tick);
    }
    EM.start = () => { if (EM.on) return; EM.on = true; c.classList.add("on"); EM.raf = requestAnimationFrame(tick); };
    EM.stop = () => { EM.on = false; c.classList.remove("on"); cancelAnimationFrame(EM.raf); };
  }

  // ------------------------------------------------------------------ palette de commandes (Ctrl+K)
  function palette() {
    let box = document.getElementById("pal");
    if (!box) {
      box = document.createElement("div"); box.id = "pal"; box.hidden = true; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Rechercher un mode");
      box.innerHTML = `<div class="pal-in"><label>${ic("search")}<input id="pal-q" placeholder="Rechercher un mode, un module…" autocomplete="off" spellcheck="false"><kbd>Échap</kbd></label><div id="pal-l" role="listbox"></div></div>`;
      document.body.appendChild(box);
      box.addEventListener("mousedown", (e) => { if (e.target === box) close(); });
      const q = box.querySelector("#pal-q");
      q.oninput = () => list(); q.onkeydown = (e) => {
        const its = [...box.querySelectorAll(".pal-it")], i = its.findIndex((x) => x.classList.contains("on"));
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const j = (i + (e.key === "ArrowDown" ? 1 : -1) + its.length) % its.length; its.forEach((x, k) => x.classList.toggle("on", k === j)); its[j] && its[j].scrollIntoView({ block: "nearest" }); }
        else if (e.key === "Enter") { const o = its[Math.max(0, i)]; if (o) o.click(); }
        else if (e.key === "Escape") close();
      };
      box.querySelector("#pal-l").onclick = (e) => { const it = e.target.closest(".pal-it"); if (it) { close(); act(it.dataset.id); } };
    }
    const close = () => { box.classList.add("out"); setTimeout(() => { box.hidden = true; box.classList.remove("out"); }, 160); };
    const list = () => {
      const q = box.querySelector("#pal-q").value.trim().toLowerCase(), rec = E.settings.get(RK, []) || [];
      const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      const ms = MODES.filter((m) => !q || norm(m.title + " " + m.desc + " " + (m.tags || []).join(" ")).includes(norm(q))).sort((a, b) => (q ? 0 : (rec.indexOf(a.id) + 1 || 99) - (rec.indexOf(b.id) + 1 || 99)));
      box.querySelector("#pal-l").innerHTML = ms.length ? ms.map((m, i) => `<button class="pal-it${i ? "" : " on"}" data-id="${m.id}" role="option">${ic(m.icon)}<span><b>${esc(m.title)}</b><small>${esc(G[m.g][1])}${rec.includes(m.id) ? " · récent" : ""}</small></span>${ic("arrow", "go")}</button>`).join("") : `<div class="pal-none">Aucun mode ne correspond.</div>`;
    };
    E.hub.palette = () => { box.hidden = false; box.querySelector("#pal-q").value = ""; list(); setTimeout(() => box.querySelector("#pal-q").focus(), 30); };
    E.hub.palette.close = close;
  }

  // ------------------------------------------------------------------ en-tête des pages de module
  function head(t) {
    const h = document.getElementById("page-head"); if (!h) return;
    const m = byTab(t);
    if (!m || t === "hub") { h.hidden = true; h.innerHTML = ""; return; }
    h.hidden = false;
    h.innerHTML = `<button class="ph-back" data-t="hub" title="Retour à l'accueil Échecs">${ic("back")}</button><div class="ph-ico">${ic(m.icon)}</div>
      <div class="ph-t"><small>${esc(G[m.g][1])}</small><h1>${esc(m.title)}</h1><p>${esc(m.desc)}</p></div>
      ${m.art && m.art[0] !== "@" ? `<img class="ph-art" src="${m.art}" alt="">` : `<div class="ph-art ghost">${ic(m.icon, "ghost")}</div>`}`;
    h.classList.remove("in"); void h.offsetWidth; h.classList.add("in");
    h.querySelector(".ph-back").onclick = () => E.suite.open("hub");
  }
  /** appelé par pc_boot à chaque changement d'onglet */
  function shown(t) {
    head(t);
    const on = t === "hub";
    document.body.classList.toggle("on-hub", on);
    const top = document.getElementById("top-t");
    if (top) { const m = byTab(t); top.innerHTML = on ? `<b>Échecs</b>` : `<button data-t="hub">Échecs</button>${ic("arrow", "sep")}<b>${esc(m ? m.title : t)}</b>`; }
    if (on) { if (SC.start) SC.start(); if (EM.start) EM.start(); } else { if (SC.stop) SC.stop(); if (EM.stop) EM.stop(); }
  }

  E.hub = { MODES, BY, act, render, shown, head, openBot, groups: G };
  E.hub.init = () => {
    const host = document.getElementById("hub"); if (host && !host.dataset.built) { host.dataset.built = "1"; render(host); }
    embers(); palette();
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); const p = document.getElementById("pal"); if (p && !p.hidden) p.querySelector("#pal-q").focus(); else E.hub.palette(); }
    });
    addEventListener("message", (e) => { if (e.data && e.data.enos === "learn-toast") toast(String(e.data.msg || "")); });
    addEventListener("scroll", () => document.body.classList.toggle("scrolled", scrollY > 8), { passive: true });
    const sb = document.getElementById("top-search"); if (sb) sb.onclick = () => E.hub.palette();
    const tp = document.getElementById("top-play"); if (tp) tp.onclick = () => act("play");
    document.getElementById("top-t").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) E.suite.open(b.dataset.t); });
  };
})();
