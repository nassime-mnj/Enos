"use strict";
// MODULE « Game Clips » : tourner une scène (héros contre antagoniste) et l'envoyer au Chess Edit. Logique : js/clips.js.
(() => {
  const E = window.ENOS, esc = E.esc;
  const ICON = '<path d="M4 4h16v16H4zM4 9h16M9 4l-3 5M15 4l-3 5M20 4l-3 5"/>';

  E.suite.register({
    id: "clips", group: "chess", title: "Game Clips", sub: "Scènes mises en scène", icon: ICON,
    onShow() { if (E.clipsUI) E.clipsUI.paint(); },
    build(el, A) {
      const $ = (s) => el.querySelector(s), C = E.clips;
      let cfg = Object.assign({ mode: "duel", hero: "eto", ant: "lelex", color: "w", intensity: "normal", length: "short", quality: "fast" }, E.settings.get("clips.cfg", {}));
      const DEF_MANY = { hero: ["lelex", "ghorghor", "jester", "naskurieux"], ant: ["eto", "nasko", "penoire", "stockfish"] };
      cfg.manyBy = Object.assign({}, DEF_MANY, cfg.manyBy || {});
      ["hero", "ant"].forEach((m) => { if (!Array.isArray(cfg.manyBy[m]) || cfg.manyBy[m].length !== 4) cfg.manyBy[m] = DEF_MANY[m].slice(); });
      const many = () => cfg.manyBy[cfg.mode === "ant" ? "ant" : "hero"];
      let ctl = null, running = false;
      const opts = (list) => list.map((id) => `<option value="${id}">${esc(C.nameOf(id))}</option>`).join("");

      el.innerHTML = `
        <div id="cl-setup">
          <div class="card"><h3>Game Clips</h3>
            <p class="muted">Une partie mise en scène pour Chess Edit : l'antagoniste offre au héros ses plus beaux coups.</p>
            <div class="cl-modes" id="cl-mode">${[["duel", "Duel", "1 contre 1"], ["hero", "Simultanée", "1 héros, 4 antagonistes"], ["ant", "Simultanée", "4 héros, 1 antagoniste"]].map(([v, n, d]) => `<button data-m="${v}"><b>${n}</b><small>${d}</small></button>`).join("")}</div>
            <div class="cl-grid">
              <label id="cl-herol">Héros<select id="cl-hero">${opts(C.BOTS)}</select></label>
              <label id="cl-antl">Antagoniste<select id="cl-ant">${opts(C.BOTS)}</select></label>
              <label id="cl-colorl">Le héros joue<select id="cl-color"><option value="w">Blancs</option><option value="b">Noirs</option></select></label>
            </div>
            <div class="cl-many" id="cl-many"><h4 class="pl-h4" id="cl-manyt"></h4><div class="cl-grid">${[0, 1, 2, 3].map((i) => `<label><span>Plateau ${i + 1}</span><select data-many="${i}">${opts(C.BOTS.filter((id) => id !== "prime"))}</select></label>`).join("")}</div></div>
            <div class="cl-grid">
              <label>Intensité<select id="cl-int"><option value="subtle">Subtile</option><option value="normal">Normale</option><option value="theatre">Théâtrale</option></select></label>
              <label>Longueur<select id="cl-len"><option value="short">Courte · 36 coups</option><option value="normal">Normale · 56 coups</option><option value="long">Longue · 84 coups</option></select></label>
              <label>Calcul<select id="cl-q"><option value="fast">Rapide</option><option value="careful">Soigné (plus long)</option></select></label>
            </div>
            <div class="row"><button class="btn pri" id="cl-go">Tourner la scène</button></div></div>
          <div class="card"><h3>Mes scènes</h3><div id="cl-list" class="list"></div></div>
        </div>
        <div id="cl-live" hidden>
          <div class="card"><h3 id="cl-ttl">Tournage…</h3><div class="cl-boards" id="cl-boards" hidden></div><div id="cl-board"></div>
            <div class="cl-stat" id="cl-stat"></div><div class="cl-say" id="cl-say"></div>
            <div class="ro-bar"><i id="cl-bar" style="width:0%"></i></div>
            <div class="row"><button class="btn" id="cl-stop">Terminer ici</button></div></div>
        </div>
        <div id="cl-done" hidden></div>`;

      const save = () => E.settings.set("clips.cfg", cfg);
      const fields = [["#cl-hero", "hero"], ["#cl-ant", "ant"], ["#cl-color", "color"], ["#cl-int", "intensity"], ["#cl-len", "length"], ["#cl-q", "quality"]];
      fields.forEach(([id, k]) => { $(id).value = cfg[k]; $(id).onchange = (e) => { cfg[k] = e.target.value; save(); }; });
      el.querySelectorAll("[data-many]").forEach((x) => { x.onchange = () => { many()[+x.dataset.many] = x.value; save(); }; });
      const mode = () => {
        el.querySelectorAll("#cl-mode button").forEach((b) => b.classList.toggle("on", b.dataset.m === cfg.mode));
        const sim = cfg.mode !== "duel";
        $("#cl-many").hidden = !sim; $("#cl-colorl").hidden = sim;
        $("#cl-herol").hidden = cfg.mode === "ant"; $("#cl-antl").hidden = cfg.mode === "hero";
        $("#cl-manyt").textContent = cfg.mode === "hero" ? "Antagonistes" : "Héros";
        if (sim) el.querySelectorAll("[data-many]").forEach((x) => (x.value = many()[+x.dataset.many]));
      };
      el.querySelectorAll("#cl-mode button").forEach((b) => (b.onclick = () => { cfg.mode = b.dataset.m; save(); mode(); }));
      mode();

      function paint() {
        const list = C.list().slice().reverse();
        $("#cl-list").innerHTML = list.length ? list.map((r) => `<div class="cl-item"><div><b>${esc(r.title)}</b><small>${r.clip.simul ? (r.simul ? r.simul.boards.length : 4) + " plateaux · " : ""}${r.plies} coups · ${r.clip.brilliants} brillant${r.clip.brilliants > 1 ? "s" : ""} · ${new Date(r.t).toLocaleDateString("fr-FR")}</small></div><button class="btn pri" data-t="${r.t}">Chess Edit</button></div>`).join("") : '<p class="muted">Aucune scène pour l\'instant : lance un tournage.</p>';
        $("#cl-list").querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { const r = list.find((x) => String(x.t) === b.dataset.t); if (r) E.chessEdit.open(r); }));
      }
      E.clipsUI = { paint };

      async function go() {
        if (running) return;
        const sim = cfg.mode !== "duel", center = cfg.mode === "ant" ? cfg.ant : cfg.hero;
        if (!sim && cfg.hero === cfg.ant) return A.toast("Choisis deux personnages différents.", "warn");
        if (sim && (center === "prime" || many().includes(center))) return A.toast("Le personnage central doit être différent des quatre autres.", "warn");
        running = true; ctl = { stop: false };
        $("#cl-setup").hidden = true; $("#cl-done").hidden = true; $("#cl-live").hidden = false;
        const total = C.LENGTH[cfg.length], B = E.board, N = sim ? 4 : 1;
        const flip = sim ? cfg.mode === "ant" : cfg.color === "b";
        $("#cl-ttl").textContent = sim ? (cfg.mode === "hero" ? `${C.nameOf(cfg.hero)} contre 4 antagonistes` : `4 héros contre ${C.nameOf(cfg.ant)}`) : `${C.nameOf(cfg.hero)} contre ${C.nameOf(cfg.ant)}`;
        $("#cl-say").textContent = ""; $("#cl-bar").style.width = "0%";
        const tabs = $("#cl-boards"); tabs.hidden = !sim;
        if (sim) tabs.innerHTML = many().map((id, i) => `<span data-b="${i}">${i + 1} · ${esc(C.nameOf(id))}</span>`).join("");
        const draw = (fen, last, key) => { const pos = B.parse(fen); B.render($("#cl-board"), pos.m, { flip, last, anim: last && last[0] && last[1] && last[0] !== last[1] ? last[0] + last[1] : "", badge: key && B.BADGES[key] ? { sq: last[1], key, id: Math.random() } : null }); };
        draw("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", []);
        let rec = null, done = [];
        const step = async (st) => {
          const b = st.board || 0;
          if (sim) tabs.querySelectorAll("span").forEach((x) => { const k = +x.dataset.b; x.classList.toggle("on", k === b); x.classList.toggle("done", k < b); });
          draw(st.fen, st.last, st.key === "brilliant" || st.key === "blunder" || st.key === "mistake" ? st.key : "");
          const heroName = sim && cfg.mode === "ant" ? C.nameOf(st.playerId) : C.nameOf(cfg.hero), antName = sim && cfg.mode === "hero" ? C.nameOf(st.playerId) : C.nameOf(cfg.ant);
          $("#cl-stat").innerHTML = `${sim ? `Plateau <b>${b + 1}/${N}</b> · ` : ""}Coup <b>${st.ply}</b> · <b>${st.brilliants}</b> brillant${st.brilliants > 1 ? "s" : ""}`;
          if (st.say) $("#cl-say").textContent = (st.role === "hero" ? heroName : antName) + " : « " + st.say + " »";
          $("#cl-bar").style.width = Math.min(100, Math.round(((b + Math.min(1, st.ply / total)) / N) * 100)) + "%";
          if (st.key === "brilliant") { try { E.chessSound.play("brilliant"); } catch (e) { /* son facultatif */ } E.vibrate && E.vibrate([20, 30, 40]); }
          await new Promise((r) => setTimeout(r, 30));
        };
        try {
          rec = sim ? await C.runSimul({ mode: cfg.mode, hero: cfg.hero, ant: cfg.ant, many: many().slice(), intensity: cfg.intensity, length: cfg.length, quality: cfg.quality }, step, ctl)
            : await C.run({ hero: cfg.hero, ant: cfg.ant, heroColor: cfg.color, intensity: cfg.intensity, length: cfg.length, quality: cfg.quality }, step, ctl);
        } catch (e) { A.toast(e.message, "err"); }
        running = false; $("#cl-live").hidden = true;
        if (!rec) { $("#cl-setup").hidden = false; return A.toast("Scène trop courte. Relance le tournage.", "warn"); }
        C.save(rec); finish(rec);
      }
      function finish(rec) {
        const box = $("#cl-done"); box.hidden = false;
        box.innerHTML = `<div class="card cl-fin"><h3>Scène terminée</h3><p><b>${esc(rec.title)}</b><br>${esc(rec.result)} · ${rec.plies} coups · ${rec.clip.brilliants} brillant${rec.clip.brilliants > 1 ? "s" : ""}</p>
          <div class="row"><button class="btn pri" id="cl-edit">Ouvrir dans Chess Edit</button><button class="btn" id="cl-again">Nouvelle scène</button></div></div>`;
        $("#cl-edit").onclick = () => E.chessEdit.open(rec);
        $("#cl-again").onclick = () => { box.hidden = true; $("#cl-setup").hidden = false; paint(); };
      }
      $("#cl-go").onclick = go; $("#cl-stop").onclick = () => { if (ctl) ctl.stop = true; };
      paint();
      el._api = { go, cfg: () => cfg, paint, get running() { return running; } };
    },
  });
})();
