"use strict";
// MULTIEDIT (catégorie Clip Edit) : tu composes une série de jeux (Foot, Néo-Cité, Échecs, Mini-golf, Bowling…) contre les bots ou joueurs de ton choix,
// l'application te les fait jouer l'un après l'autre, puis monte un edit vertical (720×1280) :
//   - jeux 3D : les meilleurs moments filmés pendant la partie (js/games/highlights.js) : buts à plusieurs rebonds, trous en un, strikes, gros loyers…
//     chaque moment démarre un peu avant l'action, ralenti au moment clé, zoom « coup de poing », flash, titre animé
//   - échecs : l'edit habituel de Chess Edit (même moteur, même timeline, mêmes bruitages)
//   - cartes de transition entre les jeux (nom du jeu, joueurs, résultat), intro et récap final, musique (la tienne ou un beat généré)
// Rendu en temps réel sur un canvas + MediaRecorder (les extraits des jeux sont des vidéos WebM).
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
          ${usable.length ? `<button class="btn pri wide" id="me-make">Créer l'edit</button>` : `<p class="muted">Aucun moment filmé (cet appareil ne sait peut-être pas filmer un canvas).</p>`}<button class="btn wide" id="me-new">Nouvelle série</button></div>`;
        const mk = el.querySelector("#me-make"); if (mk) mk.onclick = () => montage(run.results);
        el.querySelector("#me-new").onclick = () => paint(); };
      // ------------------------------------------------------------ montage
      const montage = async (results) => {
        el.innerHTML = `<div class="me-render"><canvas id="me-cv" width="${W}" height="${H}"></canvas><p id="me-st">Préparation…</p><div class="me-bar"><i id="me-pg"></i></div><button class="btn wide" id="me-cancel">Annuler</button></div>`;
        const cv = el.querySelector("#me-cv"), st = (t) => (el.querySelector("#me-st").textContent = t), pg = (k) => (el.querySelector("#me-pg").style.width = Math.round(k * 100) + "%");
        const sig = { stop: false }; el.querySelector("#me-cancel").onclick = () => { sig.stop = true; };
        try {
          const out = await E.multiEdit.render(cv, results, { music, onStatus: st, onProgress: pg, signal: sig });
          showResult(out);
        } catch (e) { el.innerHTML = `<div class="card"><p class="pl-err">${esc(e.message || String(e))}</p><button class="btn wide" id="me-new">Retour</button></div>`; el.querySelector("#me-new").onclick = () => paint(); }
      };
      const showResult = (out) => {
        const url = URL.createObjectURL(out.blob), ext = out.mime.includes("mp4") ? "mp4" : "webm", name = "multiedit_" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-") + "." + ext;
        el.innerHTML = `<div class="me-res"><video src="${url}" controls playsinline loop autoplay></video><p class="muted">${Math.round(out.duration)} s · ${Math.round(out.blob.size / 1e6 * 10) / 10} Mo</p>
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
  /** bruitages d'edit synthétisés : impact (boum + souffle) et whoosh de transition */
  const sfx = (ctx, dest, kind, t) => {
    const n = ctx.createBuffer(1, ctx.sampleRate * 0.8, ctx.sampleRate), d = n.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, kind === "whoosh" ? 1 : 3);
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = n; s.connect(f); f.connect(g); g.connect(dest);
    if (kind === "whoosh") { f.type = "bandpass"; f.Q.value = 2; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(5000, t + 0.45); g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.3); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6); s.start(t); return; }
    f.type = "lowpass"; f.frequency.value = 900; g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7); s.start(t);
    const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.6); og.gain.setValueAtTime(1, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.7); o.connect(og); og.connect(dest); o.start(t); o.stop(t + 0.75);
  };
  /** vidéo d'un moment : URL, durée réparée (WebM de MediaRecorder sans index), prête à démarrer à `start` */
  const prepVideo = (blob) => new Promise((res) => {
    const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = URL.createObjectURL(blob);
    let done = false; const ok = () => { if (!done) { done = true; res(v); } }; const to = setTimeout(ok, 6000);
    v.onloadedmetadata = () => { if (v.duration === Infinity || isNaN(v.duration)) { v.currentTime = 1e101; v.ontimeupdate = () => { v.ontimeupdate = null; v.currentTime = 0; v.onseeked = () => { v.onseeked = null; clearTimeout(to); ok(); }; }; } else { clearTimeout(to); ok(); } };
    v.onerror = () => { clearTimeout(to); ok(); };
  });
  const seek = (v, t) => new Promise((res) => { if (Math.abs(v.currentTime - t) < 0.02) return res(); const to = setTimeout(res, 1500); v.onseeked = () => { v.onseeked = null; clearTimeout(to); res(); }; try { v.currentTime = t; } catch (e) { clearTimeout(to); res(); } });

  /** construit la liste des segments à partir des résultats de la série */
  M.plan = (results) => {
    const segs = [{ k: "intro", d: 2.6, results }];
    results.forEach((r, gi) => {
      const G = GAMES[r.step.g]; if (r.res.skipped) return;
      const clips = r.clips.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0)).slice(0, 4);
      const hasChess = r.res.chess && r.res.chess.mv && r.res.chess.mv.length >= 2;
      if (!clips.length && !hasChess) return;
      segs.push({ k: "title", d: 1.4, G, r, gi });
      if (hasChess) segs.push({ k: "chess", d: 0, rec: r.res.chess, G });
      clips.forEach((c) => { const s0 = Math.max(0, c.at - 2.4), s1 = Math.min(c.dur || c.at + 1.6, c.at + 1.5), slow = [Math.max(s0, c.at - 0.25), Math.min(s1, c.at + 0.45)], R = 0.45;
        const d = (slow[0] - s0) + (slow[1] - slow[0]) / R + (s1 - slow[1]); segs.push({ k: "clip", d: Math.max(1.2, d), c, s0, s1, slow, R, G }); });
    });
    segs.push({ k: "outro", d: 2.8, results });
    return segs;
  };
  const font = (px, w) => `${w || 900} ${px}px Inter, "Arial Black", Arial`;
  const txt = (g, s, x, y, px, col, o) => { o = o || {}; g.font = font(px, o.w); g.textAlign = o.align || "center"; g.textBaseline = "middle"; g.lineJoin = "round"; g.lineWidth = o.stroke || px * 0.16; g.strokeStyle = o.sc || "rgba(0,0,0,0.85)"; g.strokeText(s, x, y); g.fillStyle = col || "#fff"; g.fillText(s, x, y); };
  const cover = (g, src, sw, sh, zoom, ox, oy) => { const k = Math.max(W / sw, H / sh) * (zoom || 1), w = sw * k, h = sh * k; g.drawImage(src, (W - w) / 2 + (ox || 0), (H - h) / 2 + (oy || 0), w, h); };
  const ease = (k) => 1 - Math.pow(1 - Math.max(0, Math.min(1, k)), 3);

  /** rendu : dessine chaque image en temps réel sur `cv` et enregistre (MediaRecorder) ; renvoie {blob, mime, duration} */
  M.render = async (cv, results, o) => {
    o = o || {}; const st = o.onStatus || (() => {}), prog = o.onProgress || (() => {}), g = cv.getContext("2d");
    if (typeof MediaRecorder !== "function" || !cv.captureStream) throw new Error("Cet appareil ne sait pas enregistrer de vidéo depuis l'application.");
    let segs = M.plan(results); if (segs.length <= 2) throw new Error("Aucun moment à monter.");
    st("Chargement des moments…");
    for (const s of segs) if (s.k === "clip") { s.v = await prepVideo(s.c.blob); await seek(s.v, s.s0); }
    const imgs = {}; for (const s of segs) { if (s.G && !imgs[s.G.art]) imgs[s.G.art] = await loadImg(s.G.art); }
    for (const r of results) for (const b of r.step.bots || []) if (!imgs["b:" + b]) imgs["b:" + b] = await loadImg(botImg(b));
    // échecs : timeline Chess Edit (même moteur que le studio)
    for (const s of segs) if (s.k === "chess") { try { st("Montage de la partie d'échecs…"); const Mp = E.editMap, plies = Mp.gamePlies(s.rec); s.tl = Mp.buildViral(plies, s.rec, null, { voices: true, intro: false, keepTwist: true, syncDrop: false, synth: true, opening: "" });
        s.cc = document.createElement("canvas"); s.cc.width = 1080; s.cc.height = 1920; s.R = new E.editRender.Renderer(s.cc, s.tl, { rec: s.rec }); await s.R.load(); s.d = Math.min(s.tl.duration, 32); } catch (e) { s.d = 0; s.err = e; } }
    segs = segs.filter((s) => s.d > 0);
    let T0 = 0; segs.forEach((s) => { s.t0 = T0; T0 += s.d; }); const total = T0;
    // audio : musique (fichier ou beat généré) + bruitages, vers l'enregistrement et vers le haut-parleur
    const C = window.AudioContext || window.webkitAudioContext, ctx = new C(); if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    const dest = ctx.createMediaStreamDestination(), mix = ctx.createGain(); mix.gain.value = 0.9; mix.connect(dest); mix.connect(ctx.destination);
    const at0 = ctx.currentTime + 0.35;
    if (o.music) { try { const buf = await ctx.decodeAudioData(await o.music.arrayBuffer()); const src = ctx.createBufferSource(), mg = ctx.createGain(); src.buffer = buf; mg.gain.setValueAtTime(0.85, at0); mg.gain.setValueAtTime(0.85, at0 + total - 1); mg.gain.linearRampToValueAtTime(0, at0 + total); src.connect(mg); mg.connect(mix); src.start(at0); } catch (e) { M.beat(ctx, mix, at0, total); } }
    else M.beat(ctx, mix, at0, total);
    segs.forEach((s) => { if (s.k === "title") sfx(ctx, mix, "whoosh", at0 + s.t0 - 0.2); if (s.k === "clip") sfx(ctx, mix, "boom", at0 + s.t0 + (s.slow[0] - s.s0) + 0.05); });
    let chessPlayer = null; if (segs.some((s) => s.k === "chess") && E.editSfx) { try { chessPlayer = new E.editSfx.Player(ctx); await chessPlayer.load(); chessPlayer.master.disconnect(); chessPlayer.master.connect(mix); } catch (e) { chessPlayer = null; } }
    // enregistrement
    const vs = cv.captureStream(FPS), stream = new MediaStream([...vs.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = ["video/mp4;codecs=avc1,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } }) || "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6000000 } : {}), chunks = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((r) => (rec.onstop = r));
    st("Rendu de l'edit…"); while (ctx.currentTime < at0) await wait(10);
    rec.start(500);
    let cur = -1;
    await new Promise((resolve) => {
      const frame = () => {
        if (o.signal && o.signal.stop) return resolve();
        const t = ctx.currentTime - at0; if (t >= total) return resolve();
        const i = segs.findIndex((s) => t >= s.t0 && t < s.t0 + s.d), s = segs[i]; if (!s) return resolve();
        const lt = t - s.t0;
        if (i !== cur) { const p = segs[cur]; if (p && p.v) p.v.pause(); cur = i; if (s.v) { s.v.playbackRate = 1; s.v.play().catch(() => {}); } if (s.k === "chess" && chessPlayer && s.tl.sfx) chessPlayer.arm(s.tl.sfx.filter((x) => x.t <= s.d), at0 + s.t0); }
        g.save(); g.fillStyle = "#06070a"; g.fillRect(0, 0, W, H);
        drawSeg(g, s, lt, imgs, segs, chessPlayer);
        g.restore();
        // transitions : flash blanc à chaque coupe, rideau en début de jeu
        if (lt < 0.12) { g.fillStyle = `rgba(255,255,255,${(1 - lt / 0.12) * 0.75})`; g.fillRect(0, 0, W, H); }
        prog(t / total); requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    segs.forEach((s) => { if (s.v) { s.v.pause(); URL.revokeObjectURL(s.v.src); } });
    rec.stop(); await stopped; ctx.close().catch(() => {});
    if (o.signal && o.signal.stop) throw new Error("Montage annulé.");
    const type = (rec.mimeType || mime || "video/webm").split(";")[0];
    return { blob: new Blob(chunks, { type }), mime: type, duration: total };
  };

  function drawSeg(g, s, lt, imgs, segs, chessPlayer) {
    if (s.k === "intro") {
      const k = ease(lt / 0.6); g.fillStyle = "#0a0b10"; g.fillRect(0, 0, W, H);
      const gr = g.createRadialGradient(W / 2, H * 0.42, 20, W / 2, H * 0.42, H * 0.6); gr.addColorStop(0, "rgba(239,23,72,0.45)"); gr.addColorStop(1, "rgba(239,23,72,0)"); g.fillStyle = gr; g.fillRect(0, 0, W, H);
      txt(g, "MULTI", W / 2, H * 0.34 - (1 - k) * 80, 150, "#fff"); txt(g, "EDIT", W / 2, H * 0.34 + 140 + (1 - k) * 80, 150, "#ff3d63");
      const list = s.results.filter((r) => !r.res.skipped), n = list.length, sz = 120;
      list.forEach((r, i) => { const a = ease((lt - 0.5 - i * 0.18) / 0.4), im = imgs[GAMES[r.step.g].art], x = W / 2 + (i - (n - 1) / 2) * (sz + 18); if (a <= 0) return;
        g.save(); g.globalAlpha = a; g.translate(x, H * 0.68 + (1 - a) * 60); g.fillStyle = "#15161d"; g.beginPath(); g.roundRect(-sz / 2, -sz / 2, sz, sz, 24); g.fill(); if (im) { g.save(); g.clip(); cover2(g, im, -sz / 2, -sz / 2, sz, sz); g.restore(); }
        g.strokeStyle = "#ff3d63"; g.lineWidth = 4; g.stroke(); txt(g, GAMES[r.step.g].name.toUpperCase(), 0, sz / 2 + 34, 26, "#fff"); g.restore(); });
      return;
    }
    if (s.k === "title") {
      const k = ease(lt / 0.35), out = lt > s.d - 0.25 ? ease((lt - (s.d - 0.25)) / 0.25) : 0, im = imgs[s.G.art];
      if (im) { g.save(); g.globalAlpha = 0.5; cover(g, im, im.width, im.height, 1.15 + lt * 0.05); g.restore(); }
      g.fillStyle = "rgba(6,7,10,0.55)"; g.fillRect(0, 0, W, H);
      g.save(); g.translate((1 - k) * W - out * W, 0);
      g.fillStyle = "#ff3d63"; g.fillRect(0, H * 0.4, W, 8);
      txt(g, `JEU ${s.gi + 1}`, W / 2, H * 0.33, 40, "#ffcf7a");
      txt(g, s.G.name.toUpperCase(), W / 2, H * 0.47, 120, "#fff");
      const bots = s.r.step.bots || []; txt(g, "TOI  VS  " + bots.map((b) => botName(b).toUpperCase()).join(" · "), W / 2, H * 0.57, 34, "#fff", { w: 800 });
      bots.forEach((b, i) => { const im2 = imgs["b:" + b]; if (!im2) return; const x = W / 2 + (i - (bots.length - 1) / 2) * 120, y = H * 0.67; g.save(); g.beginPath(); g.arc(x, y, 48, 0, 7); g.clip(); g.drawImage(im2, x - 48, y - 48, 96, 96); g.restore(); g.strokeStyle = "#fff"; g.lineWidth = 4; g.beginPath(); g.arc(x, y, 48, 0, 7); g.stroke(); });
      const res = s.r.res; txt(g, res.chess ? (res.chess.result || "") : res.detail ? res.detail.slice(0, 42) : res.won ? "VICTOIRE" : "", W / 2, H * 0.78, 30, res.won ? "#4ade80" : "#ffcf7a", { w: 700 });
      g.restore(); return;
    }
    if (s.k === "chess") { s.R.draw(Math.min(lt, s.tl.duration)); if (chessPlayer) chessPlayer.pump(lt); cover(g, s.cc, 1080, 1920, 1); return; }
    if (s.k === "clip") {
      const v = s.v, c = s.c, inSlow = lt >= (s.slow[0] - s.s0) && lt < (s.slow[0] - s.s0) + (s.slow[1] - s.slow[0]) / s.R;
      if (v) { const want = inSlow ? s.R : 1; if (Math.abs(v.playbackRate - want) > 0.01) v.playbackRate = want; }
      const kt = (s.slow[0] - s.s0) + (c.at - s.slow[0]) / s.R, dk = lt - kt, punch = dk > 0 ? Math.exp(-dk * 4) : 0;
      const shake = dk > 0 && dk < 0.4 ? (1 - dk / 0.4) * 14 : 0, zoom = 1.06 + punch * 0.18 + lt * 0.015;
      if (v && v.videoWidth) cover(g, v, v.videoWidth, v.videoHeight, zoom, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      // vignette + bandeau du jeu
      const vg = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.55)"); g.fillStyle = vg; g.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(6,7,10,0.7)"; g.beginPath(); g.roundRect(24, 40, 230, 54, 27); g.fill(); txt(g, s.G.name.toUpperCase(), 139, 67, 26, "#fff", { w: 800, stroke: 0.01 });
      if (inSlow) txt(g, "RALENTI", W - 110, 67, 22, "#ffcf7a", { w: 800 });
      if (dk > 0) { const a = ease(dk / 0.25), sc = 1 + (1 - a) * 0.8; g.save(); g.translate(W / 2, H * 0.74); g.scale(sc, sc); g.globalAlpha = Math.min(1, dk / 0.15);
        txt(g, c.label || "", 0, 0, c.label && c.label.length > 12 ? 70 : 96, c.label && c.label[0] === "−" ? "#ff3d63" : "#fff");
        if (c.sub) txt(g, c.sub, 0, 78, 30, "#ffcf7a", { w: 700 });
        g.restore(); }
      if (punch > 0.6) { g.fillStyle = `rgba(255,255,255,${(punch - 0.6) * 0.9})`; g.fillRect(0, 0, W, H); }
      return;
    }
    if (s.k === "outro") {
      g.fillStyle = "#0a0b10"; g.fillRect(0, 0, W, H); const k = ease(lt / 0.5);
      txt(g, "RÉSULTATS", W / 2, H * 0.2, 70, "#ffcf7a");
      s.results.filter((r) => !r.res.skipped).forEach((r, i) => { const a = ease((lt - 0.2 - i * 0.15) / 0.35), y = H * 0.32 + i * 110; if (a <= 0) return; g.save(); g.globalAlpha = a; g.translate((1 - a) * 80, 0);
        g.fillStyle = "#15161d"; g.beginPath(); g.roundRect(70, y - 44, W - 140, 88, 20); g.fill(); txt(g, GAMES[r.step.g].name, 100, y, 38, "#fff", { align: "left", w: 800, stroke: 0.01 });
        const t = r.res.chess ? (r.res.chess.result || "") : r.res.won ? "Victoire" : r.res.detail ? "Défaite" : ""; txt(g, t, W - 100, y, 34, r.res.won ? "#4ade80" : "#ff6d88", { align: "right", w: 800, stroke: 0.01 }); g.restore(); });
      g.globalAlpha = k; txt(g, "E.N.O.S.", W / 2, H * 0.88, 64, "#ff3d63"); g.globalAlpha = 1;
    }
  }
  const cover2 = (g, im, x, y, w, h) => { const k = Math.max(w / im.width, h / im.height), iw = im.width * k, ih = im.height * k; g.drawImage(im, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); };
  M.GAMES = GAMES;
})();
