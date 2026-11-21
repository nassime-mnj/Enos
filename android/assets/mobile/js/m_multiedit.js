"use strict";
// MULTIEDIT (catégorie Clip Edit) : tu composes une série de jeux (Foot, Néo-Cité, Échecs, Mini-golf, Bowling…) contre les bots ou joueurs de ton choix,
// l'application te les fait jouer l'un après l'autre, puis monte un edit vertical (720×1280) :
//   - jeux 3D : les meilleurs moments filmés pendant la partie (js/games/highlights.js) : buts à plusieurs rebonds, trous en un, strikes, gros loyers…
//     chaque moment démarre un peu avant l'action, ralenti au moment clé, zoom « coup de poing », flash, titre animé
//   - échecs : l'edit habituel de Chess Edit (même moteur, même timeline, mêmes bruitages)
//   - cartes de transition entre les jeux (nom du jeu, joueurs, résultat), intro et récap final, musique (la tienne ou un beat généré)
// Rendu hors ligne 4K / 60 i/s calé sur la musique : js/multiedit_render.js (les temps forts sont des enregistrements de scène, rejoués hors écran).
(() => {
  const E = window.ENOS, esc = E.esc;
  const GAMES = {
    flick: { name: "Foot", art: "img/games/common/card_flick.webp", opts: { mode: "foot", goals: 3 }, decor: "stade", decors: [["stade", "Stade"], ["ocean", "Océan"], ["rue", "Rue"], ["volcan", "Volcan"], ["tempete", "Tempête"], ["sakura", "Sakura"], ["automne", "Automne"], ["eto", "Arène ETO"]], max: 1 },
    neocite: { name: "Néo-Cité", art: "img/games/common/card_capital.webp", opts: { rounds: 8, cash: 1500 }, decor: "nuit", decors: [["nuit", "Ville de nuit"], ["stade", "Stade"], ["ocean", "Océan"], ["rue", "Rue"], ["volcan", "Volcan"], ["tempete", "Tempête"]], max: 3 },
    chess: { name: "Échecs", art: "img/ui/knight.webp", max: 1 },
    golf: { name: "Mini-golf", art: "img/games/common/card_golf.webp", opts: { holes: 3 }, decor: "lagon", decors: [["lagon", "Lagon"], ["foret", "Forêt"], ["rue", "Rue"], ["volcan", "Volcan"], ["tempete", "Tempête"]], max: 3 },
    bowling: { name: "Bowling", art: "img/games/common/card_bowling.webp", opts: { frames: 3 }, decor: "eto", decors: [["eto", "Bowling ETO"], ["stade", "Stade"], ["ocean", "Océan"], ["rue", "Rue"], ["volcan", "Volcan"], ["tempete", "Tempête"]], max: 3 },
  };
  // bots des échecs : mode des Défis correspondant
  const CHESS_MODE = { eto: "brillant", enos: "enos", penoire: "penoire", nasko: "nasko", lelex: "lelex", ghorghor: "ghorghor", naskolit: "naskolit", jester: "jester", naskurieux: "naskurieux" };
  const W = 720, H = 1280, FPS = 30;
  const botName = (id) => (E.botPick ? E.botPick.name(id) : id), botImg = (id) => (E.botPick ? E.botPick.img(id) : "");
  const roster = () => ((E.jeux && E.jeux.ROSTER) || [["eto"], ["enos"], ["lelex"]]).map((r) => r[0]).filter((id) => ["eto", "enos"].includes(id) || (E.botChat && E.botChat.bots && E.botChat.bots[id]));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const loadImg = (src) => new Promise((res) => { if (!src) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

  E.suite.register({
    id: "multiedit", group: "games", title: "MultiEdit", sub: "Une série de jeux, un seul edit",
    icon: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M3 11h18M7 7l2-4M12 7l2-4M17 7l2-4"/>',
    build(el) {
      const A = E.suite.api || {};
      let steps = E.settings.get("multiedit.steps", null) || [{ g: "flick", bots: ["eto"], decor: "stade" }, { g: "neocite", bots: ["lelex", "ghorghor"], decor: "nuit" }, { g: "chess", bots: ["enos"] }, { g: "golf", bots: ["nasko"], decor: "lagon" }];
      let music = null, run = null;
      const save = () => E.settings.set("multiedit.steps", steps);
      // ------------------------------------------------------------ constructeur de série
      const paint = () => {
        el.innerHTML = `<div class="me-hero"><small>Clip Edit</small><h2>MultiEdit</h2><p>Choisis tes jeux et tes adversaires. Tu les joues à la suite, l'edit se monte tout seul avec les meilleurs moments.</p></div>
          <div class="me-steps">${steps.map((s, i) => { const G = GAMES[s.g]; return `<div class="me-step" data-i="${i}"><img class="me-art" src="${G.art}" alt=""><div class="me-sb"><small>Jeu ${i + 1}</small><b>${esc(G.name)}</b>
            <div class="me-bots">${s.bots.map((b, k) => `<button class="me-bot" data-b="${k}" title="${esc(botName(b))}">${botImg(b) ? `<img src="${esc(botImg(b))}" alt="">` : `<span>${esc(botName(b).slice(0, 2))}</span>`}<em>${esc(botName(b))}</em></button>`).join("")}${s.bots.length < G.max ? `<button class="me-add-bot" data-addb>+</button>` : ""}</div>
            ${G.decors ? `<select class="me-decor" data-d>${G.decors.map(([v, l]) => `<option value="${v}"${(s.decor || G.decor) === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>` : ""}</div>
            <div class="me-ctl"><button data-up ${i ? "" : "disabled"} aria-label="Monter">▲</button><button data-down ${i < steps.length - 1 ? "" : "disabled"} aria-label="Descendre">▼</button><button data-del aria-label="Retirer">✕</button></div></div>`; }).join("")}</div>
          <button class="btn wide me-add" id="me-add">+ Ajouter un jeu</button>
          <div class="card me-mus"><b>Musique de l'edit</b><small id="me-mus-n">${music ? esc(music.name) : "Beat ETO (généré)"}</small><div class="row"><button class="btn" id="me-mus">Choisir un fichier</button>${music ? `<button class="btn" id="me-mus-x">Beat ETO</button>` : ""}</div></div>
          <button class="btn pri wide me-go" id="me-go" ${steps.length ? "" : "disabled"}>Lancer la série · ${steps.length} jeu${steps.length > 1 ? "x" : ""}</button>
          <p class="muted me-note">Pendant les parties, les actions sont filmées pour l'edit. Les échecs reprennent le montage de Chess Edit.</p>`;
        el.querySelectorAll(".me-step").forEach((row) => { const i = +row.dataset.i, s = steps[i];
          row.querySelector("[data-up]").onclick = () => { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; save(); paint(); };
          row.querySelector("[data-down]").onclick = () => { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; save(); paint(); };
          row.querySelector("[data-del]").onclick = () => { steps.splice(i, 1); save(); paint(); };
          const d = row.querySelector("[data-d]"); if (d) d.onchange = () => { s.decor = d.value; save(); };
          row.querySelectorAll(".me-bot").forEach((b) => (b.onclick = async () => { const k = +b.dataset.b; const id = await pickBot(s.bots[k], s.bots.length > 1); if (id === "__del") s.bots.splice(k, 1); else if (id) s.bots[k] = id; save(); paint(); }));
          const ab = row.querySelector("[data-addb]"); if (ab) ab.onclick = async () => { const id = await pickBot(null, false); if (id && id !== "__del") { s.bots.push(id); save(); paint(); } }; });
        el.querySelector("#me-add").onclick = () => E.ui.sheet({ title: "Ajouter un jeu", html: `<div class="me-pick">${Object.entries(GAMES).map(([k, G]) => `<button data-g="${k}"><img src="${G.art}" alt=""><b>${esc(G.name)}</b></button>`).join("")}</div>`, options: [{ label: "Fermer" }],
          onOpen: (sh) => sh.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => { const g = b.dataset.g; steps.push({ g, bots: [roster()[steps.length % roster().length] || "eto"], decor: GAMES[g].decor }); save(); E.ui.closeSheet(); paint(); })) });
        el.querySelector("#me-mus").onclick = async () => { const f = A.pick ? (await A.pick({ accept: "audio/*" }))[0] : null; if (f) { music = f; paint(); } };
        const mx = el.querySelector("#me-mus-x"); if (mx) mx.onclick = () => { music = null; paint(); };
        el.querySelector("#me-go").onclick = () => startRun();
      };
      const pickBot = (cur, canDel) => new Promise((res) => { let done = false;
        const sh = E.ui.sheet({ title: "Adversaire", html: `<div class="me-roster">${roster().map((id) => `<button data-b="${id}" class="${id === cur ? "on" : ""}">${botImg(id) ? `<img src="${esc(botImg(id))}" alt="">` : `<span>${esc(botName(id).slice(0, 2))}</span>`}<b>${esc(botName(id))}</b></button>`).join("")}</div>`,
          options: (canDel ? [{ label: "Retirer cet adversaire", fn: () => { done = true; res("__del"); } }] : []).concat([{ label: "Fermer" }]), onClose: () => { if (!done) res(null); } });
        sh.querySelectorAll("[data-b]").forEach((b) => (b.onclick = () => { done = true; E.ui.closeSheet(true); res(b.dataset.b); })); });
      // ------------------------------------------------------------ série
      const startRun = () => { if (!steps.length) return; run = { i: 0, results: [] }; interstitial(); };
      const interstitial = () => {
        const s = steps[run.i], G = GAMES[s.g];
        el.innerHTML = `<div class="me-inter"><small>Jeu ${run.i + 1} / ${steps.length}</small><img src="${G.art}" alt=""><h2>${esc(G.name)}</h2>
          <div class="me-vs"><span>Toi</span><i>VS</i><span>${s.bots.map((b) => esc(botName(b))).join(", ")}</span></div>
          <button class="btn pri wide" id="me-play">C'est parti</button><button class="btn wide" id="me-skip">Passer ce jeu</button><button class="btn wide" id="me-quit">Arrêter la série</button></div>`;
        el.querySelector("#me-play").onclick = () => play(s);
        el.querySelector("#me-skip").onclick = () => after({ skipped: true }, []);
        el.querySelector("#me-quit").onclick = () => finishRun();
      };
      const play = (s) => {
        if (s.g === "chess") return playChess(s);
        const g = (E.jeux.list || []).find((x) => x.id === s.g); if (!g) return after({ skipped: true }, []);
        const players = [{ name: "Toi", human: true, seat: 0 }].concat(s.bots.map((id, k) => ({ name: botName(id), bot: id, img: botImg(id), human: false, seat: k + 1, level: E.jeux.clsOf ? E.jeux.clsOf(id) : "normal" })));
        const opts = Object.assign({}, GAMES[s.g].opts, { decor: s.decor || GAMES[s.g].decor });
        E.hl.start(s.g, () => document.querySelector("#gm-stage canvas"));
        E.jeux.play(g, { mode: "bots", level: players[1] ? players[1].level : "normal", players, opts,
          multi: { nextLabel: run.i < steps.length - 1 ? "Jeu suivant" : "Voir l'edit", onEnd: (res) => after(res, E.hl.stop()), onStop: (res) => { after(res, E.hl.stop(), true); } } });
      };
      const playChess = (s) => {
        const bot = s.bots[0] || "enos", mode = CHESS_MODE[bot] || "enos", n0 = E.settings.get("defi.hist", []).length;
        E.modules && E.modules.open ? E.modules.open("defis") : E.suite.open && E.suite.open("defis");
        setTimeout(() => { const api = (document.querySelector("#tool-defis .suite-body") || {})._api; if (api && api.launch) api.launch(mode, { color: "w" }); else E.ui.toast("Défis indisponible", "err"); }, 400);
        const t = setInterval(() => { const h = E.settings.get("defi.hist", []); if (h.length > n0) { clearInterval(t); const rec = h[h.length - 1];
          setTimeout(() => E.ui.sheet({ title: "Partie d'échecs terminée", html: `<p class="muted">${esc(rec.result || "")} · ${rec.mv ? rec.mv.length : 0} coups</p>`, options: [{ label: run.i < steps.length - 1 ? "Jeu suivant" : "Voir l'edit", cls: "pri", fn: () => { back(); after({ chess: rec, detail: rec.result || "" }, []); } }, { label: "Arrêter la série", fn: () => { back(); after({ chess: rec }, [], true); } }] }), 1600); } }, 800);
        run.chessTimer = t;
      };
      const back = () => { if (E.modules && E.modules.open) E.modules.open("multiedit"); };
      const after = (res, clips, stop) => { if (run.chessTimer) clearInterval(run.chessTimer); run.results.push({ step: steps[run.i], res: res || {}, clips: clips || [] }); run.i++; back();
        if (stop || run.i >= steps.length) finishRun(); else interstitial(); };
      const finishRun = () => { const usable = run.results.filter((r) => r.clips.length || (r.res && r.res.chess && r.res.chess.mv && r.res.chess.mv.length >= 2));
        el.innerHTML = `<div class="me-done"><small>Série terminée</small><h2>${usable.length ? "On monte l'edit ?" : "Rien à monter"}</h2>
          <div class="me-sum">${run.results.map((r) => `<div><b>${esc(GAMES[r.step.g].name)}</b><span>${r.res.skipped ? "passé" : r.res.chess ? esc(r.res.chess.result || "") : esc(r.res.detail || (r.res.won ? "Victoire" : "Défaite"))}</span><em>${r.res.chess ? "edit Chess Edit" : r.clips.length + " moment" + (r.clips.length > 1 ? "s" : "")}</em></div>`).join("")}</div>
          ${usable.length ? `<div class="cv-chips me-q">${[["4k", "4K 60 i/s"], ["1080", "1080p 60 i/s (plus rapide)"]].map(([v, l]) => `<button data-q="${v}" class="${E.settings.get("multiedit.quality", "4k") === v ? "on" : ""}">${l}</button>`).join("")}</div><button class="btn pri wide" id="me-make">Créer l'edit</button>` : `<p class="muted">Aucun moment enregistré.</p>`}<button class="btn wide" id="me-new">Nouvelle série</button></div>`;
        const mk = el.querySelector("#me-make"); if (mk) mk.onclick = () => montage(run.results);
        el.querySelectorAll(".me-q [data-q]").forEach((b) => (b.onclick = () => { E.settings.set("multiedit.quality", b.dataset.q); el.querySelectorAll(".me-q [data-q]").forEach((x) => x.classList.toggle("on", x === b)); }));
        el.querySelector("#me-new").onclick = () => paint(); };
      // ------------------------------------------------------------ montage
      const montage = async (results) => {
        const q = E.settings.get("multiedit.quality", "4k");
        el.innerHTML = `<div class="me-render"><div class="me-spin"><i></i></div><h3>Création de l'edit</h3><p id="me-st">Préparation…</p><div class="me-bar"><i id="me-pg"></i></div><small class="muted" id="me-eta"></small>
          <p class="muted me-note">Rendu ${q === "1080" ? "1080p" : "4K"} à 60 images par seconde, calé sur la musique. Rien n'est affiché pendant le calcul pour que le téléphone reste fluide.</p><button class="btn wide" id="me-cancel">Annuler</button></div>`;
        const st = (t) => (el.querySelector("#me-st").textContent = t), t0 = performance.now();
        const pg = (k, txt) => { el.querySelector("#me-pg").style.width = Math.round(k * 100) + "%"; if (txt) st(txt); const el2 = el.querySelector("#me-eta"); if (el2 && k > 0.08) { const left = ((performance.now() - t0) / k) * (1 - k) / 1000; el2.textContent = "Encore " + (left > 90 ? Math.round(left / 60) + " min" : Math.round(left) + " s"); } };
        const sig = { stop: false }; el.querySelector("#me-cancel").onclick = () => { sig.stop = true; };
        try { const out = await E.meRender.render(results, { music, quality: q, onProgress: pg, signal: sig }); showResult(out); }
        catch (e) { el.innerHTML = `<div class="card"><p class="pl-err">${esc(e.message || String(e))}</p><button class="btn wide" id="me-new">Retour</button></div>`; el.querySelector("#me-new").onclick = () => finishRun(); }
      };
      const showResult = (out) => {
        E.multiEdit.last = out; const url = URL.createObjectURL(out.blob), ext = out.mime.includes("mp4") ? "mp4" : "webm", name = "multiedit_" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-") + "." + ext;
        el.innerHTML = `<div class="me-res"><video src="${url}" controls playsinline loop autoplay></video><p class="muted">${out.w}×${out.h} · 60 i/s · ${Math.round(out.duration)} s · ${Math.round(out.blob.size / 1e6 * 10) / 10} Mo · ${out.codec.toUpperCase()}</p>
          <button class="btn pri wide" id="me-save">Enregistrer la vidéo</button><button class="btn wide" id="me-again">Refaire le montage</button><button class="btn wide" id="me-new">Nouvelle série</button></div>`;
        el.querySelector("#me-save").onclick = async () => { const b = new Uint8Array(await out.blob.arrayBuffer()); if (A.save) await A.save(name, out.mime, b); else { const a = document.createElement("a"); a.href = url; a.download = name; a.click(); } };
        el.querySelector("#me-again").onclick = () => montage(run.results);
        el.querySelector("#me-new").onclick = () => paint();
      };
      el._api = { get steps() { return steps; }, set steps(v) { steps = v; save(); paint(); }, startRun, get run() { return run; }, montage, finishRun };
      paint();
    },
  });

  // ================================================================== moteur de montage
  const M = (E.multiEdit = {});
  /** beat généré (128 BPM) : kick, clap, charleston, basse — pour ne dépendre d'aucune musique sous droits */
  M.beat = (ctx, dest, t0, dur) => {
    const bpm = 128, b = 60 / bpm, end = t0 + dur, notes = [43, 43, 46, 41], noise = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate), nd = noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const bus = ctx.createGain(); bus.gain.value = 0.55; bus.connect(dest);
    for (let k = 0, t = t0; t < end; k++, t += b) {
      const kk = ctx.createOscillator(), kg = ctx.createGain(); kk.frequency.setValueAtTime(150, t); kk.frequency.exponentialRampToValueAtTime(42, t + 0.14); kg.gain.setValueAtTime(1, t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.32); kk.connect(kg); kg.connect(bus); kk.start(t); kk.stop(t + 0.34);
      if (k % 2 === 1) { const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = noise; f.type = "bandpass"; f.frequency.value = 1500; g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18); s.connect(f); f.connect(g); g.connect(bus); s.start(t); }
      for (const h of [0.5]) { const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = noise; f.type = "highpass"; f.frequency.value = 7000; g.gain.setValueAtTime(0.18, t + h * b); g.gain.exponentialRampToValueAtTime(0.001, t + h * b + 0.05); s.connect(f); f.connect(g); g.connect(bus); s.start(t + h * b); }
      const o = ctx.createOscillator(), og = ctx.createGain(), lp = ctx.createBiquadFilter(); o.type = "sawtooth"; o.frequency.value = 440 * Math.pow(2, (notes[Math.floor(k / 8) % 4] - 69) / 12); lp.type = "lowpass"; lp.frequency.value = 420;
      og.gain.setValueAtTime(0, t + b * 0.5); og.gain.linearRampToValueAtTime(0.22, t + b * 0.52); og.gain.exponentialRampToValueAtTime(0.001, t + b * 0.98); o.connect(lp); lp.connect(og); og.connect(bus); o.start(t + b * 0.5); o.stop(t + b);
    }
    return bus;
  };
  M.GAMES = GAMES;
})();
