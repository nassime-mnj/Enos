"use strict";
// MODULE « Game Clips » : tourner une scène (héros contre antagoniste) et l'envoyer au Chess Edit. Logique : js/clips.js.
(() => {
  const E = window.ENOS, esc = E.esc;
  const ICON = '<path d="M4 4h16v16H4zM4 9h16M9 4l-3 5M15 4l-3 5M20 4l-3 5"/>';

  E.suite.register({
    id: "clips", group: "chess", title: "Game Clips", sub: "Scènes : un héros, un antagoniste", icon: ICON,
    onShow() { if (E.clipsUI) E.clipsUI.paint(); },
    build(el, A) {
      const $ = (s) => el.querySelector(s), C = E.clips;
      let cfg = Object.assign({ hero: "eto", ant: "lelex", color: "w", intensity: "normal", length: "normal", quality: "fast" }, E.settings.get("clips.cfg", {}));
      let ctl = null, running = false;
      const opts = (list) => list.map((id) => `<option value="${id}">${esc(C.nameOf(id))}</option>`).join("");

      el.innerHTML = `
        <div id="cl-setup">
          <div class="card"><h3>🎭 Game Clips · scène de théâtre</h3>
            <p class="muted">Une partie <b>mise en scène</b> pour le Chess Edit : le <b>héros</b> joue comme ETO Brillant (il cherche les sacrifices brillants) et l'<b>antagoniste</b> lui <b>offre sur un plateau d'argent</b> les coups les plus spectaculaires. Stockfish vérifie chaque coup : les coups restent plausibles, le héros n'a plus qu'à les saisir.</p>
            <div class="cl-grid">
              <label>Héros<select id="cl-hero">${opts(C.BOTS)}</select></label>
              <label>Antagoniste<select id="cl-ant">${opts(C.BOTS)}</select></label>
              <label>Le héros joue<select id="cl-color"><option value="w">Blancs</option><option value="b">Noirs</option></select></label>
              <label>Intensité<select id="cl-int"><option value="subtle">Subtil · peu de cadeaux</option><option value="normal">Normal</option><option value="theatre">Théâtral · cadeaux énormes</option></select></label>
              <label>Longueur<select id="cl-len"><option value="short">Courte · ~36 coups</option><option value="normal">Normale · ~56 coups</option><option value="long">Longue · ~84 coups</option></select></label>
              <label>Calcul<select id="cl-q"><option value="fast">Rapide</option><option value="careful">Soigné (plus long)</option></select></label>
            </div>
            <div class="row"><button class="btn pri" id="cl-go">🎬 TOURNER LA SCÈNE</button></div></div>
          <div class="card"><h3>Mes scènes</h3><div id="cl-list" class="list"></div></div>
        </div>
        <div id="cl-live" hidden>
          <div class="card"><h3 id="cl-ttl">🎬 Tournage…</h3><div id="cl-board"></div>
            <div class="cl-stat" id="cl-stat"></div><div class="cl-say" id="cl-say"></div>
            <div class="ro-bar"><i id="cl-bar" style="width:0%"></i></div>
            <div class="row"><button class="btn" id="cl-stop">⏹ TERMINER ICI</button></div></div>
        </div>
        <div id="cl-done" hidden></div>`;

      const save = () => E.settings.set("clips.cfg", cfg);
      const fields = [["#cl-hero", "hero"], ["#cl-ant", "ant"], ["#cl-color", "color"], ["#cl-int", "intensity"], ["#cl-len", "length"], ["#cl-q", "quality"]];
      fields.forEach(([id, k]) => { $(id).value = cfg[k]; $(id).onchange = (e) => { cfg[k] = e.target.value; save(); }; });

      function paint() {
        const list = C.list().slice().reverse();
        $("#cl-list").innerHTML = list.length ? list.map((r) => `<div class="cl-item"><div><b>${esc(r.title)}</b><small>${r.plies} coups · ✦ ${r.clip.brilliants} brillant(s) · 🎁 ${r.clip.gifts} cadeau(x) · ${new Date(r.t).toLocaleDateString("fr-FR")}</small></div><button class="btn pri" data-t="${r.t}">🎬 EDIT</button></div>`).join("") : '<p class="muted">Aucune scène pour l\'instant : lance un tournage.</p>';
        $("#cl-list").querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { const r = list.find((x) => String(x.t) === b.dataset.t); if (r) E.chessEdit.open(r); }));
      }
      E.clipsUI = { paint };

      async function go() {
        if (running) return;
        if (cfg.hero === cfg.ant) return A.toast("Choisis deux personnages différents.", "warn");
        running = true; ctl = { stop: false };
        $("#cl-setup").hidden = true; $("#cl-done").hidden = true; $("#cl-live").hidden = false;
        const total = C.LENGTH[cfg.length], B = E.board;
        $("#cl-ttl").textContent = "🎬 " + C.nameOf(cfg.hero) + " (héros) contre " + C.nameOf(cfg.ant);
        $("#cl-say").textContent = ""; $("#cl-bar").style.width = "0%";
        const draw = (fen, last, key) => { const pos = B.parse(fen); B.render($("#cl-board"), pos.m, { flip: cfg.color === "b", last, anim: last && last[0] && last[1] && last[0] !== last[1] ? last[0] + last[1] : "", badge: key && B.BADGES[key] ? { sq: last[1], key, id: Math.random() } : null }); };
        draw("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", []);
        let rec = null;
        try {
          rec = await C.run({ hero: cfg.hero, ant: cfg.ant, heroColor: cfg.color, intensity: cfg.intensity, length: cfg.length, quality: cfg.quality }, async (st) => {
            draw(st.fen, st.last, st.key === "brilliant" || st.key === "blunder" || st.key === "mistake" ? st.key : "");
            $("#cl-stat").innerHTML = `Coup <b>${st.ply}</b> · ✦ <b>${st.brilliants}</b> brillant(s) du héros · 🎁 <b>${st.gifts}</b> cadeau(x) de l'antagoniste`;
            if (st.say) $("#cl-say").textContent = (st.role === "hero" ? C.nameOf(cfg.hero) : C.nameOf(cfg.ant)) + " : « " + st.say + " »";
            $("#cl-bar").style.width = Math.min(100, Math.round((st.ply / total) * 100)) + "%";
            if (st.key === "brilliant") { try { E.chessSound.play("brilliant"); } catch (e) { /* son facultatif */ } E.vibrate && E.vibrate([20, 30, 40]); }
            await new Promise((r) => setTimeout(r, 30));
          }, ctl);
        } catch (e) { A.toast(e.message, "err"); }
        running = false; $("#cl-live").hidden = true;
        if (!rec) { $("#cl-setup").hidden = false; return A.toast("Scène trop courte : relance un tournage.", "warn"); }
        C.save(rec); finish(rec);
      }
      function finish(rec) {
        const box = $("#cl-done"); box.hidden = false;
        box.innerHTML = `<div class="card cl-fin"><h3>🎞 C'est dans la boîte !</h3><p><b>${esc(rec.title)}</b><br>${esc(rec.result)} · ${rec.plies} coups · ✦ ${rec.clip.brilliants} coup(s) brillant(s) du héros · 🎁 ${rec.clip.gifts} cadeau(x) offert(s)</p>
          <div class="row"><button class="btn pri" id="cl-edit">🎬 OUVRIR DANS CHESS EDIT</button><button class="btn" id="cl-again">↻ UNE AUTRE SCÈNE</button></div></div>`;
        $("#cl-edit").onclick = () => E.chessEdit.open(rec);
        $("#cl-again").onclick = () => { box.hidden = true; $("#cl-setup").hidden = false; paint(); };
      }
      $("#cl-go").onclick = go; $("#cl-stop").onclick = () => { if (ctl) ctl.stop = true; };
      paint();
      el._api = { go, cfg: () => cfg, paint, get running() { return running; } };
    },
  });
})();
