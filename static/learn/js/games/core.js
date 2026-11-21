"use strict";
// SALON DES JEUX (hors échecs) : chaque jeu s'enregistre avec E.jeux.register({...}) et devient un module (groupe « games ») avec :
//   - un salon : visuel, choix du mode (LOCAL sur ce téléphone · CONTRE LES BOTS · EN LIGNE bientôt), joueurs / niveau des bots, règles
//   - un écran de jeu plein écran (#gm-stage) : barre du haut (quitter, titre, tour), zone de jeu (3D ou canvas), bannière de fin avec ETO
//   - des statistiques par jeu (parties, victoires) ; l'en ligne passera par le serveur ETO (salles + invitations) quand les accès seront ouverts.
// Un jeu fournit : {id, title, sub, hero, icon, min, max, modes, levels, rules, start(host, setup, api) -> {destroy()}}.
(() => {
  const E = window.ENOS, esc = E.esc;
  const G = (E.jeux = { list: [] });
  const LEVELS = [["easy", "Facile"], ["normal", "Normal"], ["hard", "Difficile"], ["max", "ETO"]];
  // bots des jeux : uniquement les nôtres (ETO, E.N.O.S. et nos personnages), chacun avec sa classe de difficulté fixe ; pas d'Elo hors échecs
  const CLS = { easy: "Facile", normal: "Normal", hard: "Difficile", max: "Expert" };
  const ROSTER = [["eto", "max"], ["enos", "max"], ["naskolit", "max"], ["penoire", "hard"], ["ghorghor", "normal"], ["nasko", "normal"], ["jester", "normal"], ["lelex", "easy"], ["naskurieux", "easy"]];
  const roster = () => ROSTER.filter(([id]) => ["eto", "enos"].includes(id) || (E.botChat && E.botChat.bots && E.botChat.bots[id]));
  const clsOf = (id) => (ROSTER.find((r) => r[0] === id) || [id, "normal"])[1];
  const BOTS = ["eto", "enos", "penoire", "nasko", "ghorghor", "lelex", "jester", "naskurieux"];
  G.ROSTER = ROSTER; G.clsOf = clsOf;
  const chip = (id, label) => `<span class="bp-chip">${botImg(id) ? `<img src="${esc(botImg(id))}" alt="">` : `<span class="bp-ph">${esc(botName(id).slice(0, 2))}</span>`}<span><small>${esc(label)}</small><b>${esc(botName(id))}</b></span><i class="gm-cls ${clsOf(id)}">${CLS[clsOf(id)]}</i></span>`;
  /** choix d'un adversaire parmi nos bots, classés par difficulté */
  const pickBot = (title, current) => new Promise((res) => { let done = false;
    const list = roster(), html = ["max", "hard", "normal", "easy"].map((c) => { const it = list.filter((r) => r[1] === c); return it.length ? `<h4 class="ro-cat">${CLS[c]}</h4><div class="ro-grid gm-roster">${it.map(([id]) => `<button class="ro-bot${id === current ? " on" : ""}" data-b="${id}">${botImg(id) ? `<img src="${esc(botImg(id))}" alt="">` : `<span class="bp-ph">${esc(botName(id).slice(0, 2))}</span>`}<b>${esc(botName(id))}</b><small class="gm-cls ${c}">${CLS[c]}</small></button>`).join("")}</div>` : ""; }).join("");
    const s = E.ui.sheet({ title, html: `<div class="ro-pick">${html}</div>`, options: [{ label: "Fermer" }], onClose: () => { if (!done) res(null); } });
    s.querySelectorAll("[data-b]").forEach((b) => (b.onclick = () => { done = true; E.vibrate && E.vibrate(8); E.ui.closeSheet(true); res(b.dataset.b); })); });
  const botName = (id) => (E.botPick ? E.botPick.name(id) : id), botImg = (id) => (E.botPick ? E.botPick.img(id) : "");
  const stats = () => E.settings.get("games.stats", {});
  G.record = (id, won) => { const s = stats(), x = (s[id] = s[id] || { n: 0, w: 0 }); x.n++; if (won) x.w++; E.settings.set("games.stats", s); };

  G.register = (g) => {
    g.modes = g.modes || ["local", "bots", "online"]; g.min = g.min || 2; g.max = g.max || 2; g.levels = g.levels !== false;
    G.list.push(g);
    E.suite.register({
      id: g.id, group: "games", title: g.title, sub: g.sub || "", icon: g.icon || '<rect x="3" y="6" width="18" height="12" rx="4"/><path d="M8 12h3M9.5 10.5v3M15 11h.01M17 13h.01"/>',
      onShow() { if (this._paint) this._paint(); },
      build(el) {
        let cfg = Object.assign({ mode: "party", n: g.min, level: "normal", bots: BOTS.slice(0, 9), names: ["Toi", "Joueur 2", "Joueur 3", "Joueur 4", "Joueur 5", "Joueur 6", "Joueur 7", "Joueur 8", "Joueur 9", "Joueur 10"] }, E.settings.get("games.cfg." + g.id, {}));
        cfg.n = Math.max(g.min, Math.min(g.max, cfg.n));
        // salon unique : chaque place est un joueur (sur ce téléphone) ou un bot ; anciens réglages local / bots repris
        const canBot = g.modes.includes("bots"), canHuman = g.modes.includes("local");
        if (cfg.mode !== "online") { if (!Array.isArray(cfg.kinds)) cfg.kinds = Array.from({ length: 10 }, (_, i) => (i === 0 || cfg.mode === "local" ? "h" : "b")); cfg.mode = "party"; }
        while (cfg.names.length < 10) cfg.names.push("Joueur " + (cfg.names.length + 1));
        while ((cfg.bots || []).length < 10) cfg.bots.push(BOTS[cfg.bots.length % BOTS.length]);
        const kind = (i) => (i === 0 ? "h" : !canBot ? "h" : !canHuman ? "b" : cfg.kinds[i] || "b");
        const okIds = roster().map((r) => r[0]); cfg.bots = (cfg.bots || []).map((id, i) => (okIds.includes(id) ? id : BOTS[i % BOTS.length]));
        const save = () => E.settings.set("games.cfg." + g.id, cfg);
        cfg.opts = cfg.opts || {};
        const optv = (o) => (cfg.opts[o.key] != null ? cfg.opts[o.key] : o.def);
        const paint = () => {
          const s = stats()[g.id] || { n: 0, w: 0 };
          const MODES = [["party", "Partie", "Joueurs et bots, sur ce téléphone"], ["online", "En ligne", "Bientôt"]].filter(([m]) => m === "party" ? canBot || canHuman : g.modes.includes(m));
          el.innerHTML = `<div class="gm-hero"${g.hero ? ` style="--art:url('${g.hero}')"` : ""}><div class="gm-hero-in"><small>Jeux ETO</small><h2>${esc(g.title)}</h2><p>${esc(g.sub || "")}</p>
              ${s.n ? `<span class="gm-st">${s.n} partie${s.n > 1 ? "s" : ""} · ${s.w} victoire${s.w > 1 ? "s" : ""}</span>` : ""}</div></div>
            <div class="gm-modes${MODES.length < 3 ? " two" : ""}">${MODES.map(([m, n, d]) => `<button class="gm-mode${cfg.mode === m ? " on" : ""}${m === "online" ? " soon" : ""}" data-m="${m}"><b>${n}</b><small>${d}</small></button>`).join("")}</div>
            <div class="card gm-setup">${setupHtml()}</div>
            <button class="btn pri wide gm-go" id="gm-go">Jouer</button>
            ${g.rules ? `<details class="card gm-rules"><summary>Règles</summary><div>${g.rules}</div></details>` : ""}`;
          wire();
        };
        const setupHtml = () => {
          if (cfg.mode === "online") return `<h3>En ligne</h3><p class="muted">Parties avec tes amis à distance : salons privés et invitations par code. Ouverture prochaine, après l'activation des comptes joueurs.</p>`;
          const n = cfg.n, rng = g.max > g.min ? `<h4 class="pl-h4">Joueurs</h4><div class="gm-count">${Array.from({ length: g.max - g.min + 1 }, (_, i) => g.min + i).map((k) => `<button data-n="${k}" class="${k === n ? "on" : ""}">${k}</button>`).join("")}</div>` : "";
          const opts = (g.options || []).map((o) => `<h4 class="pl-h4">${esc(o.label)}</h4><div class="gm-count gm-opt${o.img ? " gm-imgs" : ""}" data-k="${o.key}">${o.choices.map(([v, l]) => `<button data-v="${v}" title="${esc(l)}" class="${String(optv(o)) === String(v) ? "on" : ""}">${o.img ? `<img src="${o.img(v)}" alt="">` : ""}<span>${esc(l)}</span></button>`).join("")}</div>`).join("");
          const nh = Array.from({ length: n }, (_, i) => kind(i)).filter((k) => k === "h").length;
          return `<h3>Partie</h3>${opts}${rng}<h4 class="pl-h4">Places <small class="muted">${nh} joueur${nh > 1 ? "s" : ""} · ${n - nh} bot${n - nh > 1 ? "s" : ""}</small></h4>
            <div class="gm-seats">${Array.from({ length: n }, (_, i) => { const k = kind(i), lock = i === 0 || !canBot || !canHuman;
              return `<div class="gm-seat"><span class="gm-sn">${i + 1}</span>${lock ? "" : `<div class="gm-kind"><button data-k="${i}" data-v="h" class="${k === "h" ? "on" : ""}">Joueur</button><button data-k="${i}" data-v="b" class="${k === "b" ? "on" : ""}">Bot</button></div>`}
                ${k === "h" ? `<input data-name="${i}" maxlength="16" value="${esc(cfg.names[i] || "Joueur " + (i + 1))}">` : `<button class="bp-slot" data-b="${i}">${chip(cfg.bots[i] || BOTS[i % BOTS.length], "Bot")}</button>`}</div>`; }).join("")}</div>`;
        };
        const wire = () => {
          el.querySelectorAll(".gm-mode").forEach((b) => (b.onclick = () => { if (b.classList.contains("soon") && b.dataset.m === "online") { cfg.mode = "online"; save(); return paint(); } cfg.mode = b.dataset.m; save(); paint(); }));
          el.querySelectorAll(".gm-count:not(.gm-lvl):not(.gm-opt) button").forEach((b) => (b.onclick = () => { cfg.n = +b.dataset.n; save(); paint(); }));
          el.querySelectorAll(".gm-opt button").forEach((b) => (b.onclick = () => { const o = g.options.find((x) => x.key === b.parentNode.dataset.k); cfg.opts[o.key] = typeof o.def === "number" ? +b.dataset.v : b.dataset.v; save(); paint(); }));
          el.querySelectorAll(".gm-lvl button").forEach((b) => (b.onclick = () => { cfg.level = b.dataset.l; save(); paint(); }));
          el.querySelectorAll("[data-name]").forEach((x) => (x.oninput = () => { cfg.names[+x.dataset.name] = x.value.trim().slice(0, 16); save(); }));
          el.querySelectorAll(".gm-seats [data-b]").forEach((b) => (b.onclick = async () => { const i = +b.dataset.b; const id = await pickBot("Place " + (i + 1), cfg.bots[i]); if (id) { cfg.bots[i] = id; save(); paint(); } }));
          el.querySelectorAll(".gm-kind button").forEach((b) => (b.onclick = () => { cfg.kinds[+b.dataset.k] = b.dataset.v; save(); paint(); }));
          const go = el.querySelector("#gm-go"); go.disabled = cfg.mode === "online"; go.textContent = cfg.mode === "online" ? "Bientôt disponible" : "Jouer";
          go.onclick = () => launch();
        };
        const launch = () => {
          let players = Array.from({ length: cfg.n }, (_, i) => { if (kind(i) === "h") return { name: cfg.names[i] || (i ? "Joueur " + (i + 1) : "Toi"), human: true };
            const id = cfg.bots[i] || BOTS[i % BOTS.length]; return { name: botName(id), bot: id, img: botImg(id), human: false, level: clsOf(id) }; });
          const nh = players.filter((p) => p.human).length;
          // un seul joueur humain : il prend la 1re place (les jeux le supposent en mode « bots ») et s'appelle « Toi »
          const mode = nh <= 1 ? "bots" : "local";
          players.forEach((p, i) => (p.seat = i));
          const opts = {}; (g.options || []).forEach((o) => (opts[o.key] = optv(o)));
          G.play(g, { mode, level: players.filter((p) => !p.human).map((p) => p.level)[0] || "normal", players, opts });
        };
        this._paint = paint; paint();
      },
    });
  };

  // familles de sons préchargées par jeu (js/games/sfx_bank.js)
  const SFX = { dames: ["dames"], chroma: ["card", "chroma"], poker: ["card", "chip", "table"], flick: ["flick"], neocite: ["nc", "dice", "chip"], bowling: ["bowl"], golf: ["flick", "chip", "bowl"], loup: ["card", "table"] };
  /** écran de jeu plein écran */
  G.play = (g, setup) => {
    G.close();
    const st = document.createElement("div"); st.id = "gm-stage"; st.className = "gm-stage";
    st.innerHTML = `<div class="gm-top"><button class="gm-x" aria-label="Quitter"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><b>${esc(g.title)}</b><span class="gm-turn" id="gm-turn"></span><button class="gm-snd" aria-label="Son"></button></div>
      <div class="gm-host" id="gm-host"></div><div class="gm-hud" id="gm-hud"></div><div class="gm-end" id="gm-end" hidden></div>`;
    (document.getElementById("app") || document.body).appendChild(st); document.body.classList.add("gm-on");
    const host = st.querySelector("#gm-host"); let inst = null, over = false;
    const api = {
      setup, stage: st, host, hud: st.querySelector("#gm-hud"),
      turn: (txt, who) => { const t = st.querySelector("#gm-turn"); t.textContent = txt || ""; t.dataset.who = who == null ? "" : who; },
      toast: (m, k) => E.ui && E.ui.toast(m, k || ""),
      vibrate: (p) => E.vibrate && E.vibrate(p),
      sound: (k) => { try { E.chessSound && E.chessSound.play(k); } catch (e) { /* son facultatif */ } },
      /** son du jeu (js/games/sfx.js) : api.sfx("card.place", {intensity, pan, rate, vol}) */
      sfx: (ev, o) => { try { return E.gsfx ? E.gsfx.play(ev, o) : false; } catch (e) { return false; } },
      loop: (ev, o) => { try { E.gsfx && E.gsfx.loop(ev, o); } catch (e) { /* ambiance facultative */ } },
      /** ambiance selon le décor : vagues au bord de l'eau, pluie et orage en tempête ; sinon l'ambiance du jeu (foule…) si elle a du sens */
      ambience: (theme, fallback, vol) => { const ev = { ocean: "amb.ocean", lagon: "amb.ocean", tempete: "amb.storm" }[theme] || fallback; if (ev) api.loop(ev, { vol: vol == null ? 1 : vol }); return ev || null; },
      crowd: (theme) => ["eto", "stade"].includes(theme),
      /** temps forts pour MultiEdit (js/games/highlights.js) : inactif hors d'une série */
      clip: { begin: (tag) => !!(E.hl && E.hl.begin(tag)), mark: (k) => E.hl && E.hl.mark(k), cancel: () => E.hl && E.hl.cancel(), active: () => !!(E.hl && E.hl.active),
        end: (info, delay) => { if (!E.hl) return; if (delay) setTimeout(() => E.hl.end(info), delay); else E.hl.end(info); } },
      /** fin de partie : winner = index du joueur gagnant (null = égalité) ; detail = texte */
      end: (winner, detail) => {
        if (over) return; over = true;
        const me = setup.players.find((p) => p.human), won = winner != null && setup.players[winner] && (setup.mode === "bots" ? setup.players[winner].human : true);
        G.record(g.id, setup.mode === "bots" ? !!won : true);
        const name = winner == null ? "" : setup.players[winner].name, img = winner == null ? "img/games/common/eto_sport.webp" : setup.mode === "bots" && !won ? "img/games/common/eto_lose.webp" : "img/games/common/eto_win.webp";
        const end = st.querySelector("#gm-end"); end.hidden = false;
        end.innerHTML = `<div class="gm-end-fx ${won || setup.mode !== "bots" ? "win" : "lose"}">${won || setup.mode !== "bots" ? Array.from({ length: 36 }, (_, i) => `<i style="--x:${Math.round(Math.random() * 100)};--d:${(Math.random() * 1.2).toFixed(2)}s;--r:${Math.round(Math.random() * 720 - 360)}deg;--c:${["#e8b54a", "#ff3d63", "#45d8ff", "#fff"][i % 4]}"></i>`).join("") : ""}</div><div class="gm-end-c ${won || setup.mode !== "bots" ? "win" : "lose"}"><img src="${img}" alt=""><h2>${winner == null ? "Égalité" : setup.mode === "bots" ? (won ? "Victoire" : "Défaite") : esc(name) + " gagne"}</h2>
          <p>${esc(detail || (winner == null ? "" : setup.mode === "bots" && !won ? esc(name) + " remporte la partie." : ""))}</p>
          <div class="row"><button class="btn pri" data-a="again">Rejouer</button><button class="btn" data-a="quit">Quitter</button></div></div>`;
        if (E.gsfx) E.gsfx.stopAll();
        if (won || setup.mode !== "bots") { api.vibrate([20, 40, 60]); api.sfx(winner == null ? "end.draw" : "end.win"); } else api.sfx("end.lose");
        end.querySelector('[data-a="again"]').onclick = () => G.play(g, setup);
        end.querySelector('[data-a="quit"]').onclick = () => G.close();
        // série MultiEdit : on enchaîne sur le jeu suivant au lieu de rejouer
        if (setup.multi) { const row = end.querySelector(".row"); row.innerHTML = `<button class="btn pri" data-a="next">${esc(setup.multi.nextLabel || "Suivant")}</button><button class="btn" data-a="stop">Arrêter la série</button>`;
          const res = { winner, detail: detail || "", players: setup.players, won: !!won };
          row.querySelector('[data-a="next"]').onclick = () => { G.close(); setup.multi.onEnd(res); };
          row.querySelector('[data-a="stop"]').onclick = () => { G.close(); setup.multi.onStop && setup.multi.onStop(res); }; }
        void me;
      },
    };
    st.querySelector(".gm-x").onclick = async () => { if (over || !E.ui.confirm || (await E.ui.confirm("Quitter la partie ?", "La partie en cours sera perdue.", "QUITTER", true))) G.close(); };
    // sons : préchargés à l'ouverture (familles communes + celles du jeu)
    if (E.gsfx) E.gsfx.preload(["ui", "end", "fx"].concat(SFX[g.id] || [g.id]));
    const snd = st.querySelector(".gm-snd"), paintSnd = () => { const on = !E.gsfx || E.gsfx.enabled(); snd.classList.toggle("off", !on); snd.innerHTML = on ? '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>'; };
    snd.onclick = () => { const on = !(E.gsfx && E.gsfx.enabled()); E.settings.set("games.sound", on); if (!on && E.gsfx) E.gsfx.stopAll(); paintSnd(); if (on) api.sfx("ui.click", { force: true }); };
    paintSnd();
    // ouverture : les joueurs entrent de chaque côté, « VS » claque au centre (ne bloque pas le toucher)
    { const pl = setup.players, av = (p) => p.img ? `<img src="${esc(p.img)}" alt="">` : `<span class="ph">${esc((p.name || "?").slice(0, 2))}</span>`;
      const it = document.createElement("div"); it.className = "gm-intro" + (pl.length > 2 ? " multi" : "");
      it.innerHTML = `<div class="gm-rays"></div><small>${esc(g.title)}</small>` + (pl.length === 2 ? `<div class="gm-vs"><div class="a">${av(pl[0])}<b>${esc(pl[0].name)}</b></div><i>VS</i><div class="b">${av(pl[1])}<b>${esc(pl[1].name)}</b></div></div>`
        : `<div class="gm-vs">${pl.map((p, i) => `<div style="--i:${i}">${av(p)}<b>${esc(p.name)}</b></div>`).join("")}</div>`);
      st.appendChild(it); setTimeout(() => it.classList.add("out"), 1500); setTimeout(() => it.remove(), 2100); }
    // indicateur de tour : petit rebond à chaque changement
    { const tn = st.querySelector("#gm-turn"); let prev = ""; new MutationObserver(() => { if (tn.textContent !== prev) { prev = tn.textContent; tn.classList.remove("pop"); void tn.offsetWidth; tn.classList.add("pop"); } }).observe(tn, { childList: true, characterData: true, subtree: true }); }
    G.cur = { g, inst: null, st };
    Promise.resolve(g.start(host, setup, api)).then((x) => { inst = x; if (G.cur) G.cur.inst = x; }).catch((e) => { host.innerHTML = `<div class="card" style="margin:20px"><p class="pl-err">${esc(e.message || String(e))}</p></div>`; });
    return api;
  };
  G.close = () => {
    const c = G.cur; G.cur = null;
    if (E.gsfx) E.gsfx.stopAll();
    if (c) { try { c.inst && c.inst.destroy && c.inst.destroy(); } catch (e) { /* rien */ } c.st.remove(); }
    document.body.classList.remove("gm-on");
  };
  G.LEVELS = LEVELS;
})();
