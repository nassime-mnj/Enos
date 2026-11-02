"use strict";
// VARIANTES D'ÉCHECS (inventions maison) : ÉLIXIR (Clash Royale), DEUX ROIS, 2v2 ÉLIXIR, PROTÈGE LA DAME. Règles, IA, stratégies, analyse : js/variants.js. Plateau : js/board.js.
// Spectateur (bots contre bots), analyse en temps réel avec évaluation, jugement des coups (brillant … gaffe) : le moteur connaît les ÉQUIPES (alliés = même couleur, jamais des ennemis).
(() => {
  const E = window.ENOS, esc = E.esc, V = E.variants;
  const LV = { 1: "Débutant", 2: "Moyen", 3: "Fort" };
  const SPEEDS = { slow: 1500, normal: 800, fast: 300, turbo: 0 };
  const stat = () => E.settings.get("variants.stats", {});
  const bump = (mode, k) => { const s = stat(); s[mode] = s[mode] || { w: 0, l: 0, d: 0 }; s[mode][k]++; E.settings.set("variants.stats", s); };
  const ICON = { elixir: "💧", dk: "♚♚", duo: "⚔", ptq: "♛" };
  const SEATS = ["Blanc A", "Noir A", "Blanc B", "Noir B"], SEATCOL = ["#ff3b4f", "#1acfd6", "#ffc34a", "#8be04d"];
  const DROP = '<img class="elx" src="img/elixir.png" alt="💧">';                      // l'icône d'élixir (goutte violette)
  const MUSIC = "audio/clash_battle.mp3";
  const SHOUTS = ["Déploiement !", "Hee hee hee ! 😈", "Pour la gloire !", "Attention, ça arrive !", "Qui a commandé ça ?", "Tadaaa !", "Ils ne s'y attendaient pas 👀"];
  const QCOL = { brilliant: "#1acfd6", best: "#7bd64d", excellent: "#9ecc38", good: "#739e66", inaccuracy: "#f5c542", mistake: "#f5a524", blunder: "#ff4d63" };
  const STRAT_IDS = ["bal", "rush", "eco", "tank", "focus"];
  const RULES = {
    elixir: ["Départ : <b>seulement les deux rois</b> et <b>0 élixir</b> : les rois doivent d'abord faire un coup.", "Pose une pièce dans <b>tes 2 premières rangées</b> en payant de l'<b>élixir</b> " + DROP + ".", "Chaque <b>coup joué</b> rapporte <b>+1 élixir</b> (max 10). <b>Poser ne coûte pas le coup</b> : tu poses, puis tu joues.", "Pion 1 · Cavalier 3 · Fou 3 · Tour 5 · <b>Dame 8</b>. Économise en bougeant une pièce."],
    dk: ["<b>Pas de dame</b> : deux rois par camp.", "<b>Si l'un des deux rois est maté, la partie est finie.</b>", "Tu dois toujours mettre tes deux rois à l'abri de l'échec.", "Pas de roque."],
    duo: ["<b>4 rois</b> sur un plateau normal : <b>2 blancs contre 2 noirs</b>. Ton équipier joue la même couleur que toi.", "<b>Chacun sa barre d'élixir</b> (départ 0, +1 par coup joué par <b>toi</b>) et <b>chacun ses pièces</b> : celles que tu poses sont à toi, tu ne bouges pas celles de ton équipier.", "Ordre de jeu : Blanc A → Noir A → Blanc B → Noir B.", "<b>Un roi maté sort</b> avec ses pièces : l'équipe passe à 2 contre 1. Plus de roi dans une équipe = défaite. Pas de roque."],
    ptq: ["Le <b>roi est sacrifiable</b> : il peut être pris, il ne craint pas l'échec.", "<b>Si la dame est matée, la partie est finie.</b> Toute l'armée doit la protéger.", "Pas de promotion en dame (ce serait une 2ᵉ cible). Pas de roque."],
  };


  E.suite.register({
    id: "variants", group: "chess", title: "Variantes d'échecs", sub: "Élixir · 2v2 · Deux rois · Protège la dame",
    icon: '<path d="M12 2c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"/>',
    onShow() {},
    build(el) {
      const $ = (s) => el.querySelector(s);
      let cfg = Object.assign({ mode: "elixir", opp: 2, side: "w", lvW: 2, lvB: 2, speed: "normal", stW: "auto", stB: "auto", ana: true, arr: false }, E.settings.get("variants.cfg", {}));
      let G = null, token = 0, anToken = 0, sel = -1, tray = "", busy = false;

      el.innerHTML = `
        <div id="va-setup">
          <div class="card"><h3>🧪 Variantes d'échecs</h3><p class="muted">Des règles inventées. Choisis une variante, ton adversaire, et c'est parti. Les bots ont une <b>stratégie</b> et le moteur <b>analyse chaque coup en direct</b>.</p>
            <div class="va-modes" id="va-modes">${Object.values(V.MODES).map((m) => `<button data-m="${m.id}"><span class="va-ic">${ICON[m.id]}</span><b>${esc(m.name)}</b><small>${esc(m.tag)}</small></button>`).join("")}</div>
            <ul class="va-rules" id="va-rules"></ul></div>
          <div class="card va-opts">
            <label>Adversaire<select id="va-opp"><option value="1">Bot débutant</option><option value="2">Bot moyen</option><option value="3">Bot fort</option><option value="0">Joueurs humains (même téléphone)</option><option value="-1">👁 Spectateur : bots contre bots</option></select></label>
            <label id="va-sidef">Ma couleur<select id="va-side"><option value="w">Blancs</option><option value="b">Noirs</option><option value="r">Au hasard</option></select></label>
            <label>Analyse en direct<input type="checkbox" id="va-ana"></label></div>
          <div class="card va-opts" id="va-spec" hidden><h3>👁 Bots contre bots</h3>
            <label>Niveau des Blancs<select id="va-lvW"></select></label><label>Niveau des Noirs<select id="va-lvB"></select></label>
            <label>Stratégie des Blancs<select id="va-stW"></select></label><label>Stratégie des Noirs<select id="va-stB"></select></label>
            <label>Vitesse<select id="va-speed"><option value="slow">Lente</option><option value="normal">Normale</option><option value="fast">Rapide</option><option value="turbo">Turbo (sans analyse)</option></select></label></div>
          <div class="row"><button class="btn pri" id="va-go">▶ JOUER</button></div>
          <div class="card"><h3>Bilan</h3><div id="va-stats" class="muted"></div></div>
        </div>
        <div id="va-game" hidden>
          <button class="back" id="va-back">◂ MENU</button>
          <div class="va-seats" id="va-seats" hidden></div>
          <div class="va-bar va-top"><b id="va-topn"></b><span class="va-elx" id="va-topx"></span></div>
          <div class="va-stage" id="va-stage"><i class="va-deco va-k1">🏰</i><i class="va-deco va-k2">🏰</i><i class="va-deco va-t1">🌳</i><i class="va-deco va-t2">🌲</i><i class="va-deco va-t3">🌳</i><i class="va-deco va-t4">🌲</i><div id="va-board"></div></div>
          <div class="va-bar va-bot"><b id="va-botn"></b><span class="va-elx" id="va-botx"></span></div>
          <div class="va-msg" id="va-msg">&nbsp;</div>
          <div class="va-tray" id="va-tray" hidden></div>
          <div class="va-ana" id="va-ana-box"><div class="va-evb" id="va-evb" title="Évaluation (Blancs à gauche)"><i id="va-evf"></i><span id="va-evt">0.0</span></div><div class="va-evm" id="va-evm"></div><div class="va-cands" id="va-cands"></div></div>
          <div class="va-plans" id="va-plans"></div>
          <div class="row"><button class="btn" id="va-undo">↶ ANNULER</button><button class="btn" id="va-new">↻ REJOUER</button><button class="btn" id="va-pass" hidden>⏭ PASSER</button><button class="btn" id="va-pause" hidden>⏸ PAUSE</button></div>
          <div class="row"><button class="btn" id="va-anab">🔍 ANALYSE</button><button class="btn" id="va-arrb">➡ FLÈCHES</button><button class="btn" id="va-mus" hidden>🔊</button></div>
          <div class="va-log" id="va-log"></div>
          <div class="va-end" id="va-end" hidden></div>
        </div>`;

      const save = () => E.settings.set("variants.cfg", cfg);
      const fillSel = (id, opts) => { $(id).innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join(""); };
      fillSel("#va-lvW", [[1, "Débutant"], [2, "Moyen"], [3, "Fort"]]); fillSel("#va-lvB", [[1, "Débutant"], [2, "Moyen"], [3, "Fort"]]);
      const stOpts = [["auto", "🎲 Auto (adaptative)"]].concat(STRAT_IDS.map((k) => [k, V.STRATS[k].icon + " " + V.STRATS[k].name]));
      fillSel("#va-stW", stOpts); fillSel("#va-stB", stOpts);
      function paintSetup() {
        el.querySelectorAll("#va-modes button").forEach((b) => b.classList.toggle("on", b.dataset.m === cfg.mode));
        $("#va-rules").innerHTML = RULES[cfg.mode].map((r) => `<li>${r}</li>`).join("");
        $("#va-opp").value = String(cfg.opp); $("#va-side").value = cfg.side; $("#va-ana").checked = !!cfg.ana;
        $("#va-spec").hidden = cfg.opp !== -1; $("#va-sidef").hidden = cfg.opp === -1;
        $("#va-lvW").value = cfg.lvW; $("#va-lvB").value = cfg.lvB; $("#va-stW").value = cfg.stW; $("#va-stB").value = cfg.stB; $("#va-speed").value = cfg.speed;
        const s = stat(), line = (m) => { const x = s[m.id] || { w: 0, l: 0, d: 0 }; return `<div>${ICON[m.id]} <b>${esc(m.name)}</b> · ${x.w} victoire(s) · ${x.l} défaite(s) · ${x.d} nulle(s)</div>`; };
        $("#va-stats").innerHTML = Object.values(V.MODES).map(line).join("");
      }
      el.querySelectorAll("#va-modes button").forEach((b) => (b.onclick = () => { cfg.mode = b.dataset.m; save(); paintSetup(); }));
      $("#va-opp").onchange = (e) => { cfg.opp = +e.target.value; save(); paintSetup(); };
      $("#va-side").onchange = (e) => { cfg.side = e.target.value; save(); };
      $("#va-ana").onchange = (e) => { cfg.ana = e.target.checked; save(); };
      for (const [id, k, num] of [["#va-lvW", "lvW", 1], ["#va-lvB", "lvB", 1], ["#va-stW", "stW", 0], ["#va-stB", "stB", 0], ["#va-speed", "speed", 0]]) $(id).onchange = (e) => { cfg[k] = num ? +e.target.value : e.target.value; save(); };

      // ------------------------------------------------------------------ partie
      const D = () => cfg.mode === "duo", XL = () => cfg.mode === "elixir" || cfg.mode === "duo", SPEC = () => cfg.opp === -1;
      const keyOf = (s) => (D() ? s.seat : s.side === "w" ? 0 : 1);       // 0..3 en duo, 0 = Blancs / 1 = Noirs sinon
      const teamOfKey = (k) => (D() ? V.teamOf(k) : k);
      const botSide = () => (cfg.opp > 0 ? (G.me === "w" ? "b" : "w") : "");
      const humanKey = (k) => !SPEC() && (!cfg.opp || (D() ? k === G.meSeat : k === (G.me === "w" ? 0 : 1)));
      const isHuman = () => G && !G.over && humanKey(keyOf(G.s));
      const levelOf = (k) => (SPEC() ? (teamOfKey(k) ? cfg.lvB : cfg.lvW) : cfg.opp);
      const kname = (k) => (D() ? SEATS[k] : k ? "Noirs" : "Blancs");
      const seatName = (q) => SEATS[q] + (SPEC() ? " · " + LV[levelOf(q)] : cfg.opp ? (q === G.meSeat ? " · toi" : V.teamOf(q) === V.teamOf(G.meSeat) ? " · équipier" : " · bot") : "");
      const nameOf = (side) => (SPEC() ? (side === "w" ? "Blancs" : "Noirs") + " · " + LV[levelOf(side === "w" ? 0 : 1)] : !cfg.opp ? (side === "w" ? "Blancs" : "Noirs") : side === G.me ? "Toi" : "Bot " + LV[cfg.opp].toLowerCase());
      const anOn = () => cfg.ana && !(SPEC() && cfg.speed === "turbo");

      function launch() {
        token++; anToken++;
        const me = cfg.side === "r" ? (Math.random() < 0.5 ? "w" : "b") : cfg.side;
        G = { s: V.newGame(cfg.mode), me: cfg.opp > 0 ? me : "w", meSeat: me === "b" ? 1 : 0, hist: [], over: false, last: null, anim: "", mv: [], an: null, anKey: "", badge: null, q: {}, paused: false, arr: SPEC() ? true : !!cfg.arr, tgt: [-1, -1], cur: {}, base: [0, 1].map((t) => { const c = t ? cfg.stB : cfg.stW; return SPEC() && c !== "auto" ? c : STRAT_IDS[Math.floor(Math.random() * STRAT_IDS.length)]; }), auto: [0, 1].map((t) => !SPEC() || (t ? cfg.stB : cfg.stW) === "auto") };
        sel = -1; tray = ""; busy = false;
        $("#va-setup").hidden = true; $("#va-game").hidden = false; $("#va-end").hidden = true;
        $("#va-undo").style.display = SPEC() ? "none" : ""; $("#va-pause").hidden = !SPEC(); $("#va-pause").textContent = "⏸ PAUSE";
        $("#va-stage").classList.toggle("clash", XL()); $("#va-stage").style.setProperty("--bg", "url(img/clash_arena.png)");
        music(XL());
        positionChanged(); render(); if (!isHuman()) botTurn();
      }
      // OST Clash Royale (usage privé) : boucle pendant une partie Élixir, coupée au retour au menu / quand l'écran quitte le module
      let au = null, watch = 0;
      const musicOn = () => E.settings.get("variants.music", true);
      function music(on) {
        clearInterval(watch);
        const btn = $("#va-mus"); btn.hidden = !on;
        if (!on) { if (au) au.pause(); return; }
        if (!au) { au = new Audio(MUSIC); au.loop = true; au.volume = 0.55; au.preload = "auto"; }
        btn.textContent = musicOn() ? "🔊" : "🔇";
        if (musicOn()) { au.currentTime = au.currentTime || 0; au.play().catch(() => {}); }
        watch = setInterval(() => { if (el.offsetParent === null || document.hidden) au.pause(); else if (musicOn() && au.paused && G && !G.over) au.play().catch(() => {}); }, 800);
      }
      $("#va-mus").onclick = () => { const v = !musicOn(); E.settings.set("variants.music", v); $("#va-mus").textContent = v ? "🔊" : "🔇"; if (au) { if (v) au.play().catch(() => {}); else au.pause(); } };
      const snap = () => G.hist.push({ s: V.clone(G.s), last: G.last, mv: G.mv.slice() });
      const logPush = (t, q) => G.mv.push({ t, q: q || "" });

      // ------------------------------------------------------------------ analyse en temps réel
      function positionChanged() {
        G.an = null; G.anKey = G.s.ply + "/" + (G.s.seat || 0) + "/" + G.hist.length + "/" + G.mv.length;
        const my = ++anToken;
        if (!anOn() || G.over) { paintAna(); return; }
        const job = V.analyseJob(G.s, 3), key = G.anKey; let lastDepth = 0;
        const tick = () => {
          if (my !== anToken || !G || G.anKey !== key) return;
          const done = job.step(14);
          if (job.result && job.result.depth !== lastDepth) { lastDepth = job.result.depth; G.an = Object.assign({}, job.result, { key }); paintAna(true); }
          if (!done) setTimeout(tick, 6);
        };
        setTimeout(tick, 40);
      }
      const fmtEv = (an) => (an.mate ? (an.evalW > 0 ? "#" : "-#") + an.mate : (an.evalW >= 0 ? "+" : "") + (Math.max(-99, Math.min(99, an.evalW / 100))).toFixed(1));
      function paintAna(redraw) {
        const box = $("#va-ana-box"); box.hidden = !anOn(); $("#va-anab").classList.toggle("on", !!cfg.ana); $("#va-arrb").classList.toggle("on", !!G.arr);
        if (!anOn() || !G.an) { if (anOn()) { $("#va-evm").textContent = "Calcul en cours…"; } $("#va-cands").innerHTML = ""; if (G && !G.an) { $("#va-evf").style.width = "50%"; $("#va-evt").textContent = "…"; } return; }
        const an = G.an, sg = an.side === "w" ? 1 : -1;
        $("#va-evf").style.width = Math.round(E.board.winPct(an.mate ? (an.evalW > 0 ? 3000 : -3000) : an.evalW)) + "%"; $("#va-evt").textContent = fmtEv(an);
        $("#va-evm").textContent = "Moteur ENOS · profondeur " + an.depth + " · " + an.list.length + " coups examinés" + (D() ? " · alliés = même camp" : "");
        $("#va-cands").innerHTML = an.list.slice(0, 3).map((x, i) => `<div class="va-cd c${i}"><b>${i + 1}</b><span>${esc(V.moveText(x.m))}</span><em>${(x.cp * sg >= 0 ? "+" : "") + (x.cp * sg / 100).toFixed(1)}</em></div>`).join("");
        if (redraw && G.arr && !G.over) render();
      }
      const arrows = () => {
        if (!G.arr || !anOn() || !G.an || G.an.key !== G.anKey || G.over) return [];
        const col = [E.board.ARROW.best, E.board.ARROW.alt, "#9aa7ff"];
        return G.an.list.slice(0, 3).map((x, i) => ({ from: V.sqName(x.m.f), to: V.sqName(x.m.t), color: col[i], w: i ? 0.1 : 0.16 }));
      };
      function judgeNow(m) {
        if (!anOn()) return null;
        try { const an = G.an && G.an.key === G.anKey && G.an.list.length ? G.an : V.analyse(G.s, 2); return V.judge(G.s, an, m); } catch (e) { return null; }
      }
      function recordJ(J, m, who) {
        const k = keyOf(G.s);
        if (!J) { logPush(V.moveText(m) + " · " + who); G.badge = null; return; }
        (G.q[k] = G.q[k] || {})[J.key] = ((G.q[k] || {})[J.key] || 0) + 1;
        const g = E.board.BADGES[J.key] ? E.board.BADGES[J.key][0] : "";
        logPush(V.moveText(m) + (J.key === "good" ? "" : " " + g) + " · " + who, J.key);
        G.badge = J.key === "good" ? null : { sq: V.sqName(m.t), key: J.key, id: G.mv.length };
        if (J.key === "brilliant") { E.ui.toast("✦ " + who + " joue un coup BRILLANT !!", "ok", 2800); try { E.chessSound.play("brilliant"); } catch (e) { /* son facultatif */ } E.vibrate && E.vibrate([30, 40, 60]); }
        else if (J.key === "blunder") E.ui.toast("💥 Gaffe de " + who + " (−" + (J.gap / 100).toFixed(1) + ")", "warn", 2600);
      }

      // ------------------------------------------------------------------ affichage
      function elixirBar(side) {
        if (!XL()) return "";
        const x = G.s.elixir[side];
        return `<span class="va-pips">${Array.from({ length: V.ELIXIR_MAX }, (_, i) => `<i class="${i < x ? "on" : ""}"></i>`).join("")}</span><b class="va-xn">${DROP}${x}</b>`;
      }
      const settle = () => (D() ? V.settle(G.s) : V.status(G.s));
      function announce(out) {                                          // rois matés qui sortent (2v2)
        (out || []).forEach((o) => {
          logPush("☠ " + SEATS[o.seat] + " sort", "blunder");
          E.board.burst($("#va-board"), V.sqName(o.sq), "mate");
          const left = [0, 1, 2, 3].filter((q) => G.s.alive[q] && V.teamOf(q) === V.teamOf(o.seat)).length, foe = [0, 1, 2, 3].filter((q) => G.s.alive[q] && V.teamOf(q) !== V.teamOf(o.seat)).length;
          const txt = "☠ " + SEATS[o.seat] + " est maté et sort ! " + (V.teamOf(o.seat) ? "Noirs" : "Blancs") + " : " + left + " contre " + foe;
          G.note = txt; E.ui.toast(txt, "warn", 3200);
        });
      }
      function plansHtml() {
        if (G.over) return "";
        const keys = D() ? [0, 1, 2, 3].filter((q) => G.s.alive[q]) : [0, 1], out = [];
        for (const k of keys) {
          if (humanKey(k)) continue;
          const st = G.cur[k] || G.base[teamOfKey(k)], tg = D() ? G.tgt[teamOfKey(k)] : -1;
          out.push(`<div class="va-pl"><b style="color:${D() ? SEATCOL[k] : k ? "#1acfd6" : "#ffc34a"}">${esc(kname(k))}</b> <span>${esc(V.planText(G.s, D() ? k : 0, st, tg))}</span></div>`);
        }
        return out.length ? out.join("") : "";
      }
      function logHtml() {
        return G.mv.slice(-16).map((x) => `<span class="va-lg" ${x.q ? `style="--qc:${QCOL[x.q] || "#8aa"}"` : ""}>${esc(x.t)}</span>`).join("");
      }
      function render() {
        const s = G.s, flip = G.me === "b" && !SPEC(), map = V.map(s);
        const human = isHuman();
        let targets = [];
        if (human && sel >= 0) targets = V.legalFrom(s, sel).map((m) => V.sqName(m.t));
        else if (human && tray) targets = V.dropSquares(s, tray).map(V.sqName);
        const own = (i) => !s.o || s.o[i] === s.seat;
        const chk = V.inCheck(s) ? V.royals(s, s.side).filter(own) : [];
        const foeCol = s.side === "w" ? "b" : "w";
        const mateSq = !D() && G.over && G.res && G.res.why === "mate" ? V.royals(s, s.side).filter((i) => V.attacked(s.b, i, foeCol))[0] : -1;
        E.board.render($("#va-board"), map, { flip, last: G.last, sel: sel >= 0 ? V.sqName(sel) : "", targets, arrows: arrows(), badge: G.badge, check: !G.over && chk.length ? V.sqName(chk.find((i) => V.attacked(s.b, i, foeCol)) ?? chk[0]) : "", end: mateSq >= 0 ? { sq: V.sqName(mateSq), id: G.hist.length + 1 } : null, anim: G.anim, onTap });
        G.anim = "";
        const top = flip ? "w" : "b", bot = flip ? "b" : "w";
        el.querySelectorAll(".va-bar").forEach((b) => (b.hidden = D()));
        const sp = $("#va-seats"); sp.hidden = !D();
        if (D()) {                                                       // 2v2 : une ligne par joueur, avec sa barre d'élixir ; chaque pièce porte la teinte de son propriétaire
          const nodes = $("#va-board")._cb.nodes;
          nodes.forEach((n, sq) => { n.dataset.o = s.o[V.sqIdx(sq)]; });
          sp.innerHTML = [0, 1, 2, 3].map((q) => `<div class="va-seat ${s.alive[q] ? "" : "dead"} ${s.seat === q && !G.over ? "turn" : ""} t${V.teamOf(q)}" style="--sc:${SEATCOL[q]}"><i class="va-sd"></i><b>${esc(seatName(q))}</b>${s.alive[q] ? elixirBar(q) : "<span class=\"va-ko\">☠ sorti</span>"}</div>`).join("");
        } else {
          $("#va-topn").textContent = nameOf(top); $("#va-botn").textContent = nameOf(bot);
          $("#va-topx").innerHTML = elixirBar(top); $("#va-botx").innerHTML = elixirBar(bot);
          el.querySelectorAll(".va-bar").forEach((b) => b.classList.remove("turn")); (s.side === top ? $(".va-top") : $(".va-bot")).classList.toggle("turn", !G.over);
        }
        // pièces à poser (élixir)
        const tr = $("#va-tray");
        tr.hidden = !XL() || G.over || !human;
        if (!tr.hidden) {
          const W = s.side === "w", x = s.elixir[V.ek(s)];
          tr.innerHTML = ["p", "n", "b", "r", "q"].map((t) => `<button data-t="${t}" class="${tray === t ? "on" : ""}" ${x < V.COST[t] ? "disabled" : ""}><img src="img/chess/${W ? "w" : "b"}${t}.png" alt=""><b>${DROP}${V.COST[t]}</b></button>`).join("");
          tr.querySelectorAll("button").forEach((b) => (b.onclick = () => { tray = tray === b.dataset.t ? "" : b.dataset.t; sel = -1; render(); }));
        }
        const m = $("#va-msg");
        if (G.over) m.textContent = "";
        else if (G.paused) m.textContent = "⏸ En pause";
        else if (!human) m.textContent = SPEC() ? kname(keyOf(s)) + " réfléchit…" : cfg.opp > 0 ? (D() ? SEATS[s.seat] + " réfléchit…" : "Le bot réfléchit…") : "";
        else if (D() && !cfg.opp) m.textContent = (chk.length ? "⚠ Roi en échec ! " : "") + "À toi : " + SEATS[s.seat] + ".";
        else if (chk.length) m.textContent = cfg.mode === "ptq" ? "⚠ Ta dame est en échec !" : cfg.mode === "dk" ? "⚠ Un de tes rois est en échec !" : "⚠ Ton roi est en échec !";
        else if (tray) m.textContent = "Touche une case de tes 2 premières rangées pour poser.";
        else m.textContent = cfg.opp > 0 ? (D() && G.note ? G.note : "À toi de jouer.") : (s.side === "w" ? "Aux Blancs." : "Aux Noirs.");
        const pb = $("#va-pass"); pb.hidden = !(D() && human && !chk.length && !V.legal(s).length);
        $("#va-undo").disabled = !G.hist.length || busy;
        $("#va-plans").innerHTML = plansHtml(); $("#va-log").innerHTML = logHtml(); $("#va-log").scrollLeft = 1e5;
        paintAna(false);
      }

      async function onTap(name) {
        if (!isHuman() || busy) return;
        const s = G.s, i = V.sqIdx(name), p = s.b[i];
        if (tray) {
          if (V.canDrop(s, tray, i)) {
            snap(); V.drop(s, tray, i); logPush("💧" + tray.toUpperCase() + name + " · " + kname(keyOf(s))); tray = ""; sel = -1; G.badge = null; positionChanged(); render();
            E.board.burst($("#va-board"), name, "great"); $("#va-msg").textContent = SHOUTS[Math.floor(Math.random() * SHOUTS.length)]; return;
          }
          if (!p) return;
          tray = "";
        }
        if (sel >= 0) {
          const ms = V.legalFrom(s, sel).filter((m) => m.t === i);
          if (ms.length) {
            let m = ms[0];
            if (ms.length > 1) {                                       // promotion
              const letter = await new Promise((res) => E.ui.sheet({ title: "Promotion", options: ms.map((x) => ({ label: { q: "Dame", r: "Tour", b: "Fou", n: "Cavalier" }[x.promo], fn: () => res(x.promo) })), onClose: () => res(ms[0].promo) }));
              m = ms.find((x) => x.promo === letter) || ms[0];
            }
            await playMove(m); return;
          }
        }
        if (p && (p === p.toUpperCase()) === (s.side === "w") && (!s.o || s.o[i] === s.seat)) { sel = sel === i ? -1 : i; render(); } else { sel = -1; render(); }
      }

      function commit(m, who, doSnap) {                                  // juge le coup AVANT de le jouer, le joue, règle les éliminations
        const J = judgeNow(m);
        if (doSnap) snap();
        recordJ(J, m, who);
        G.last = [V.sqName(m.f), V.sqName(m.t)]; G.anim = V.sqName(m.f) + V.sqName(m.t) + (m.promo || "");
        try { E.chessSound.play(m.cap ? "capture" : "move"); } catch (e) { /* son facultatif */ }
        V.play(G.s, m); sel = -1; tray = "";
        const st = settle();
        positionChanged(); render(); announce(st.out);
        if (st.over) { finish(st); return true; }
        return false;
      }
      async function playMove(m) {
        if (commit(m, kname(keyOf(G.s)), true)) return;
        if (!isHuman()) botTurn();
      }

      function adaptFor(k) {                                            // stratégie du moment pour le joueur k (adaptation selon l'évaluation, cible d'équipe en duo)
        const team = teamOfKey(k), base = G.base[team];
        let st = base;
        if (G.auto[team] && G.an && G.an.key === G.anKey) { const ev = team ? -G.an.evalW * (G.an.side === "w" ? 1 : 1) : G.an.evalW; st = V.adaptStrat(base, ev); }
        if (G.cur[k] !== st) { if (G.cur[k]) logPush("🧠 " + kname(k) + " change : " + V.STRATS[st].icon + " " + V.STRATS[st].name, ""); G.cur[k] = st; }
        if (D()) G.tgt[team] = V.pickTarget(G.s, k);
        return st;
      }
      function botTurn() {
        const my = ++token;
        if (G.paused) { render(); return; }
        busy = true; render();
        const delay = SPEC() ? SPEEDS[cfg.speed] : 420;
        setTimeout(() => {
          if (my !== token || !G || G.over || G.paused) return;
          const k = keyOf(G.s), st = adaptFor(k);
          const a = V.think(G.s, levelOf(k), Math.random, { strat: st, target: D() ? G.tgt[teamOfKey(k)] : -1 });
          busy = false;
          if (!a.move) {
            if (D()) { V.pass(G.s); const r = settle(); positionChanged(); render(); announce(r.out); if (r.over) finish(r); else if (!isHuman()) botTurn(); return; }
            finish(V.status(G.s)); return;
          }
          // le bot pose ses pièces (on les voit apparaître), puis joue
          a.drops.forEach((d) => { V.drop(G.s, d.type, d.sq); logPush("💧" + d.type.toUpperCase() + V.sqName(d.sq) + " · " + kname(k)); });
          const go = () => { if (my !== token || !G || G.over) return; if (G.paused) { G.pending = a.move; return; } if (commit(a.move, kname(k), false)) return; if (!isHuman()) botTurn(); };
          if (a.drops.length) { positionChanged(); render(); a.drops.forEach((d) => E.board.burst($("#va-board"), V.sqName(d.sq), "great")); setTimeout(go, SPEC() && cfg.speed === "turbo" ? 0 : 650); } else go();
        }, delay);
      }

      function finish(st) {
        G.over = true; G.res = st; busy = false; sel = -1; tray = ""; anToken++;
        render();
        const win = st.result;
        let t, k;
        if (win === "draw") { t = "Partie nulle"; k = "d"; }
        else if (SPEC() || !cfg.opp) { t = (win === "w" ? "Les Blancs" : "Les Noirs") + " gagnent"; k = ""; }
        else if (win === G.me) { t = "Victoire !"; k = "w"; }
        else { t = "Défaite…"; k = "l"; }
        const why = { mate: D() ? "Les deux rois de l'équipe adverse sont sortis." : cfg.mode === "ptq" ? "Dame matée." : cfg.mode === "dk" ? "Un roi est maté." : "Échec et mat.", pat: "Pat : plus aucun coup possible.", 50: "Règle des 50 coups.", long: "Partie trop longue." }[st.why];
        if (k) bump(cfg.mode, k);
        const rec = Object.keys(G.q).map((q) => { const x = G.q[q], b = (x.brilliant || 0), g = (x.blunder || 0), m = (x.mistake || 0), best = (x.best || 0) + (x.excellent || 0); return `<div><b>${esc(kname(+q))}</b> · ✦ ${b} brillant(s) · ★ ${best} très bon(s) · ? ${m} erreur(s) · ?? ${g} gaffe(s)</div>`; }).join("");
        const e = $("#va-end"); e.hidden = false;
        e.className = "va-end " + (k === "w" ? "win" : k === "l" ? "lose" : "");
        e.innerHTML = `<h3>${t}</h3><p>${why}</p>${rec ? `<div class="va-rec">${rec}</div>` : ""}<div class="row"><button class="btn pri" id="va-again">↻ REJOUER</button><button class="btn" id="va-menu">MENU</button></div>`;
        $("#va-again").onclick = launch; $("#va-menu").onclick = back;
        $("#va-undo").style.display = "none"; $("#va-pause").hidden = true;
      }

      function undo() {
        if (!G || !G.hist.length || busy || SPEC()) return;
        token++;
        // contre un bot : on revient à la dernière position où c'est à nous de jouer
        let h; do { h = G.hist.pop(); } while (cfg.opp > 0 && G.hist.length && !humanKey(keyOf(h.s)));
        G.note = ""; G.s = h.s; G.last = h.last; G.mv = h.mv; G.over = false; G.res = null; G.anim = ""; G.badge = null; sel = -1; tray = "";
        $("#va-end").hidden = true; $("#va-undo").style.display = "";
        positionChanged(); render(); if (!isHuman()) botTurn();
      }
      function back() { token++; anToken++; music(false); G = null; $("#va-game").hidden = true; $("#va-setup").hidden = false; paintSetup(); }

      $("#va-go").onclick = launch; $("#va-new").onclick = launch; $("#va-back").onclick = back; $("#va-undo").onclick = undo;
      $("#va-pass").onclick = () => { if (!G || !isHuman()) return; snap(); V.pass(G.s); logPush("⏭ " + kname(keyOf(G.s))); const st = settle(); positionChanged(); render(); announce(st.out); if (st.over) finish(st); else if (!isHuman()) botTurn(); };
      $("#va-pause").onclick = () => {
        if (!G || G.over) return;
        G.paused = !G.paused; $("#va-pause").textContent = G.paused ? "▶ REPRENDRE" : "⏸ PAUSE";
        if (!G.paused) { if (G.pending) { const m = G.pending; G.pending = null; const k = keyOf(G.s); if (!commit(m, kname(k), false) && !isHuman()) botTurn(); } else if (!isHuman()) botTurn(); }
        render();
      };
      $("#va-anab").onclick = () => { cfg.ana = !cfg.ana; save(); if (G) { positionChanged(); render(); } };
      $("#va-arrb").onclick = () => { if (!G) return; G.arr = !G.arr; cfg.arr = G.arr; save(); render(); };
      paintSetup();
      el._api = { launch, cfg: () => cfg, get g() { return G; }, tap: onTap, undo, back, render, analysis: () => (G ? G.an : null), adaptFor };
    },
  });
})();
