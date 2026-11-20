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
  const BOTS = ["eto", "enos", "nasko", "lelex", "penoire", "ghorghor", "jester", "naskurieux"];
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
        let cfg = Object.assign({ mode: g.modes.includes("bots") ? "bots" : "local", n: g.min, level: "normal", bots: BOTS.slice(0, 6), names: ["Toi", "Joueur 2", "Joueur 3", "Joueur 4", "Joueur 5", "Joueur 6", "Joueur 7", "Joueur 8"] }, E.settings.get("games.cfg." + g.id, {}));
        cfg.n = Math.max(g.min, Math.min(g.max, cfg.n));
        const save = () => E.settings.set("games.cfg." + g.id, cfg);
        cfg.opts = cfg.opts || {};
        const optv = (o) => (cfg.opts[o.key] != null ? cfg.opts[o.key] : o.def);
        const paint = () => {
          const s = stats()[g.id] || { n: 0, w: 0 };
          const MODES = [["local", "Local", "Sur ce téléphone, à tour de rôle"], ["bots", "Contre les bots", "Seul contre l'IA"], ["online", "En ligne", "Bientôt"]].filter(([m]) => g.modes.includes(m));
          el.innerHTML = `<div class="gm-hero"${g.hero ? ` style="--art:url('${g.hero}')"` : ""}><div class="gm-hero-in"><small>Jeux ETO</small><h2>${esc(g.title)}</h2><p>${esc(g.sub || "")}</p>
              ${s.n ? `<span class="gm-st">${s.n} partie${s.n > 1 ? "s" : ""} · ${s.w} victoire${s.w > 1 ? "s" : ""}</span>` : ""}</div></div>
            <div class="gm-modes">${MODES.map(([m, n, d]) => `<button class="gm-mode${cfg.mode === m ? " on" : ""}${m === "online" ? " soon" : ""}" data-m="${m}"><b>${n}</b><small>${d}</small></button>`).join("")}</div>
            <div class="card gm-setup">${setupHtml()}</div>
            <button class="btn pri wide gm-go" id="gm-go">Jouer</button>
            ${g.rules ? `<details class="card gm-rules"><summary>Règles</summary><div>${g.rules}</div></details>` : ""}`;
          wire();
        };
        const setupHtml = () => {
          if (cfg.mode === "online") return `<h3>En ligne</h3><p class="muted">Parties avec tes amis à distance : salons privés et invitations par code. Ouverture prochaine, après l'activation des comptes joueurs.</p>`;
          const n = cfg.n, rng = g.max > g.min ? `<h4 class="pl-h4">Joueurs</h4><div class="gm-count">${Array.from({ length: g.max - g.min + 1 }, (_, i) => g.min + i).map((k) => `<button data-n="${k}" class="${k === n ? "on" : ""}">${k}</button>`).join("")}</div>` : "";
          const opts = (g.options || []).map((o) => `<h4 class="pl-h4">${esc(o.label)}</h4><div class="gm-count gm-opt${o.img ? " gm-imgs" : ""}" data-k="${o.key}">${o.choices.map(([v, l]) => `<button data-v="${v}" title="${esc(l)}" class="${String(optv(o)) === String(v) ? "on" : ""}">${o.img ? `<img src="${o.img(v)}" alt="">` : ""}<span>${esc(l)}</span></button>`).join("")}</div>`).join("");
          if (cfg.mode === "local") return `<h3>Local</h3>${opts}${rng}<div class="gm-pl">${Array.from({ length: n }, (_, i) => `<label><span>Joueur ${i + 1}</span><input data-name="${i}" maxlength="16" value="${esc(cfg.names[i] || "Joueur " + (i + 1))}"></label>`).join("")}</div>`;
          return `<h3>Contre les bots</h3>${opts}${rng}${g.levels ? `<h4 class="pl-h4">Niveau</h4><div class="gm-count gm-lvl">${LEVELS.map(([v, l]) => `<button data-l="${v}" class="${cfg.level === v ? "on" : ""}">${l}</button>`).join("")}</div>` : ""}
            <h4 class="pl-h4">Adversaires</h4><div class="gm-bots">${Array.from({ length: n - 1 }, (_, i) => `<button class="bp-slot" data-b="${i}">${E.botPick ? E.botPick.chip(cfg.bots[i] || BOTS[i % BOTS.length], "Adversaire " + (i + 1)) : esc(botName(cfg.bots[i]))}</button>`).join("")}</div>`;
        };
        const wire = () => {
          el.querySelectorAll(".gm-mode").forEach((b) => (b.onclick = () => { if (b.classList.contains("soon") && b.dataset.m === "online") { cfg.mode = "online"; save(); return paint(); } cfg.mode = b.dataset.m; save(); paint(); }));
          el.querySelectorAll(".gm-count:not(.gm-lvl):not(.gm-opt) button").forEach((b) => (b.onclick = () => { cfg.n = +b.dataset.n; save(); paint(); }));
          el.querySelectorAll(".gm-opt button").forEach((b) => (b.onclick = () => { const o = g.options.find((x) => x.key === b.parentNode.dataset.k); cfg.opts[o.key] = typeof o.def === "number" ? +b.dataset.v : b.dataset.v; save(); paint(); }));
          el.querySelectorAll(".gm-lvl button").forEach((b) => (b.onclick = () => { cfg.level = b.dataset.l; save(); paint(); }));
          el.querySelectorAll("[data-name]").forEach((x) => (x.oninput = () => { cfg.names[+x.dataset.name] = x.value.trim().slice(0, 16); save(); }));
          el.querySelectorAll(".gm-bots [data-b]").forEach((b) => (b.onclick = async () => { const i = +b.dataset.b; const id = E.botPick && (await E.botPick.open({ title: "Adversaire " + (i + 1), current: cfg.bots[i], noPrime: true })); if (id) { cfg.bots[i] = id; save(); paint(); } }));
          const go = el.querySelector("#gm-go"); go.disabled = cfg.mode === "online"; go.textContent = cfg.mode === "online" ? "Bientôt disponible" : "Jouer";
          go.onclick = () => launch();
        };
        const launch = () => {
          const players = cfg.mode === "local" ? Array.from({ length: cfg.n }, (_, i) => ({ name: cfg.names[i] || "Joueur " + (i + 1), human: true, seat: i }))
            : [{ name: "Toi", human: true, seat: 0 }].concat(Array.from({ length: cfg.n - 1 }, (_, i) => { const id = cfg.bots[i] || BOTS[i % BOTS.length]; return { name: botName(id), bot: id, img: botImg(id), human: false, seat: i + 1, level: cfg.level }; }));
          const opts = {}; (g.options || []).forEach((o) => (opts[o.key] = optv(o)));
          G.play(g, { mode: cfg.mode, level: cfg.level, players, opts });
        };
        this._paint = paint; paint();
      },
    });
  };

  /** écran de jeu plein écran */
  G.play = (g, setup) => {
    G.close();
    const st = document.createElement("div"); st.id = "gm-stage"; st.className = "gm-stage";
    st.innerHTML = `<div class="gm-top"><button class="gm-x" aria-label="Quitter"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><b>${esc(g.title)}</b><span class="gm-turn" id="gm-turn"></span></div>
      <div class="gm-host" id="gm-host"></div><div class="gm-hud" id="gm-hud"></div><div class="gm-end" id="gm-end" hidden></div>`;
    (document.getElementById("app") || document.body).appendChild(st); document.body.classList.add("gm-on");
    const host = st.querySelector("#gm-host"); let inst = null, over = false;
    const api = {
      setup, stage: st, host, hud: st.querySelector("#gm-hud"),
      turn: (txt, who) => { const t = st.querySelector("#gm-turn"); t.textContent = txt || ""; t.dataset.who = who == null ? "" : who; },
      toast: (m, k) => E.ui && E.ui.toast(m, k || ""),
      vibrate: (p) => E.vibrate && E.vibrate(p),
      sound: (k) => { try { E.chessSound && E.chessSound.play(k); } catch (e) { /* son facultatif */ } },
      /** fin de partie : winner = index du joueur gagnant (null = égalité) ; detail = texte */
      end: (winner, detail) => {
        if (over) return; over = true;
        const me = setup.players.find((p) => p.human), won = winner != null && setup.players[winner] && (setup.mode === "bots" ? setup.players[winner].human : true);
        G.record(g.id, setup.mode === "bots" ? !!won : true);
        const name = winner == null ? "" : setup.players[winner].name, img = winner == null ? "img/games/common/eto_sport.webp" : setup.mode === "bots" && !won ? "img/games/common/eto_lose.webp" : "img/games/common/eto_win.webp";
        const end = st.querySelector("#gm-end"); end.hidden = false;
        end.innerHTML = `<div class="gm-end-c ${won || setup.mode !== "bots" ? "win" : "lose"}"><img src="${img}" alt=""><h2>${winner == null ? "Égalité" : setup.mode === "bots" ? (won ? "Victoire" : "Défaite") : esc(name) + " gagne"}</h2>
          <p>${esc(detail || (winner == null ? "" : setup.mode === "bots" && !won ? esc(name) + " remporte la partie." : ""))}</p>
          <div class="row"><button class="btn pri" data-a="again">Rejouer</button><button class="btn" data-a="quit">Quitter</button></div></div>`;
        if (won || setup.mode !== "bots") { api.vibrate([20, 40, 60]); api.sound("brilliant"); }
        end.querySelector('[data-a="again"]').onclick = () => G.play(g, setup);
        end.querySelector('[data-a="quit"]').onclick = () => G.close();
        void me;
      },
    };
    st.querySelector(".gm-x").onclick = async () => { if (over || !E.ui.confirm || (await E.ui.confirm("Quitter la partie ?", "La partie en cours sera perdue.", "QUITTER", true))) G.close(); };
    G.cur = { g, inst: null, st };
    Promise.resolve(g.start(host, setup, api)).then((x) => { inst = x; if (G.cur) G.cur.inst = x; }).catch((e) => { host.innerHTML = `<div class="card" style="margin:20px"><p class="pl-err">${esc(e.message || String(e))}</p></div>`; });
    return api;
  };
  G.close = () => {
    const c = G.cur; G.cur = null;
    if (c) { try { c.inst && c.inst.destroy && c.inst.destroy(); } catch (e) { /* rien */ } c.st.remove(); }
    document.body.classList.remove("gm-on");
  };
  G.LEVELS = LEVELS;
})();
