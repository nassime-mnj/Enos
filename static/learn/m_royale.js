"use strict";
// BATTLE ROYALE ×4 : le plateau d'échecs à 4 joueurs (en croix 14×14), 4 bots ou joueurs face à face, alliances, cibles au choix, tempête qui rétrécit le terrain.
// Règles : js/chess4.js · IA, personnalités et apprentissage : js/chess4_ai.js · Chat des bots : js/bot_chat.js + js/bot_lines.js (catégories r_*).
// Même fichier sur le téléphone (Modules › Échecs) et sur le PC (static/learn, onglet ROYALE ×4).
(() => {
  const E = window.ENOS, esc = E.esc, C4 = E.c4, AI = E.c4ai;
  const COLORS = ["#ff3b4f", "#ffc34a", "#1acfd6", "#8be04d"];                      // bas, gauche, haut, droite
  const SEAT = ["Bas", "Gauche", "Haut", "Droite"];
  const PERSONAS = ["nasko", "penoire", "lelex", "ghorghor", "naskurieux", "naskolit", "jester", "eto", "enos"];
  const STORMS = { off: null, slow: { first: 160, every: 50 }, normal: { first: 120, every: 36 }, fast: { first: 80, every: 24 } };
  const SPEEDS = { slow: 900, normal: 450, fast: 160, turbo: 0 };
  const MAX_PLIES = 400;
  // équipes : numéro d'équipe de chaque siège (mêmes numéros = alliés) ; cible : le premier ennemi dans l'ordre de jeu
  const TEAMLET = ["A", "B", "C", "D"];
  const PRESETS = [
    ["1v1v1v1 · chacun pour soi", [0, 1, 2, 3]],
    ["2 contre 2 · opposés alliés", [0, 1, 0, 1]],
    ["2 contre 2 · voisins alliés", [0, 0, 2, 2]],
    ["Moi + 1 bot contre 2 bots (2v1v1)", [0, 1, 0, 3]],
    ["Bas + Gauche contre Haut et Droite en solo (2v1v1)", [0, 0, 2, 3]],
    ["3 contre 1 · tous contre le Bas", [0, 1, 1, 1]],
  ];
  const WLAB = { cap: "les prises", foe: "affaiblir l'adversaire", hang: "protéger ses pièces", threat: "les menaces", king: "la sécurité du roi", adv: "l'avance", center: "le centre", hunt: "la chasse au roi", storm: "fuir la tempête" };
  const pname = (id) => (id === "human" ? (E.userName ? E.userName() : "Toi") : E.botChat && E.botChat.bots[id] ? E.botChat.bots[id].name : id);
  let PENDING = () => {};
  const learned = () => E.settings.get("royale.learned", {});
  const stat = () => E.settings.get("royale.stats", { games: 0, wins: {} });

  E.suite.register({
    id: "royale", group: "chess", title: "Battle Royale ×4", sub: "4 bots ou joueurs · alliances · tempête",
    icon: '<path d="M12 2l2.6 6.2 6.4.5-4.9 4.2 1.5 6.3L12 15.8 6.4 19.2 7.9 13 3 8.7l6.4-.5z"/>',
    onShow() { PENDING(); },
    build(el, A) {
      const $ = (s) => el.querySelector(s);
      let cfg = E.settings.get("royale.cfg", null) || { seats: [{ who: "human", name: "", target: 1, team: 0 }, { who: "penoire", name: "", target: 2, team: 1 }, { who: "nasko", name: "", target: 3, team: 2 }, { who: "lelex", name: "", target: 0, team: 3 }], storm: "normal", speed: "normal", learned: false };
      let G = null;                                                               // partie en cours
      let training = null;

      el.innerHTML = `
        <div id="ro-setup">
          <div class="card ro-hero"><h3>⚔ Battle Royale ×4</h3>
            <p class="muted">Le plateau à 4 joueurs : chaque armée attaque depuis un bord. <b>Roi capturé = éliminé</b> (pas d'échec ni de mat). Choisis <b>qui affronte qui</b>, qui est <b>allié</b>, et laisse la <b>tempête</b> rétrécir le terrain jusqu'au dernier survivant.</p>
            <div class="ro-modes" id="ro-modes"><button data-p="0"><b>1v1v1v1</b><small>chacun pour soi</small></button><button data-p="1"><b>2v2</b><small>opposés alliés</small></button><button data-p="2"><b>2v2</b><small>voisins alliés</small></button></div>
            <div class="ro-presets" id="ro-presets">${PRESETS.map((p, i) => `<button data-p="${i}">${esc(p[0])}</button>`).join("")}</div></div>
          <div class="ro-seats" id="ro-seats">${[0, 1, 2, 3].map((s) => `<div class="ro-seat" data-s="${s}" style="--pc:${COLORS[s]}"><div class="ro-sav"></div><b>${SEAT[s]}</b><small class="ro-sinfo"></small>
            <label>Joueur<select data-f="who"></select></label><label class="ro-nmf">Nom<input data-f="name" type="text" maxlength="14" placeholder="ex. Karim (au téléphone)"></label><label>Équipe<select data-f="team"></select></label><label>Attaque →<select data-f="target"></select></label></div>`).join("")}</div>
          <div class="card ro-duo" id="ro-duo" hidden><h3>⚔ 2 CONTRE 2 · qui affronte qui ?</h3>
            <div class="seg ro-dm" id="ro-dm"><button data-dm="opp">Partenaires en face</button><button data-dm="nei">Partenaires côte à côte</button><i class="seg-ind"></i></div>
            <div class="ro-duo-teams"><div class="ro-duo-t" style="--tc:#ff3b4f"><b>ÉQUIPE A</b><select data-ds="a0"></select><select data-ds="a1"></select></div><span class="ro-vs">VS</span><div class="ro-duo-t" style="--tc:#1acfd6"><b>ÉQUIPE B</b><select data-ds="b0"></select><select data-ds="b1"></select></div></div>
            <div class="row"><button class="btn" id="ro-duo-swap">⇄ ÉCHANGER LES ÉQUIPES</button><button class="btn" id="ro-duo-mix">🎲 MÉLANGER</button></div></div>
          <p class="muted ro-teams" id="ro-teams"></p>
          <p class="muted ro-hint">🎙 <b>Un ami au téléphone ?</b> Mets son siège en « Joueur humain » (avec son prénom) : quand c'est son tour, l'appli te redonne la main avec <b>ses pièces</b> et tu joues le coup qu'il te dicte. Un bouton ↶ permet d'annuler si tu t'es trompé.</p>
          <div class="card ro-opts"><label>Tempête<select id="ro-storm"><option value="off">Aucune</option><option value="slow">Lente</option><option value="normal">Normale</option><option value="fast">Rapide</option></select></label>
            <label>Vitesse des bots<select id="ro-speed"><option value="slow">Lente</option><option value="normal">Normale</option><option value="fast">Rapide</option><option value="turbo">Turbo</option></select></label>
            <label>Bots entraînés<input type="checkbox" id="ro-learned"></label></div>
          <div class="row"><button class="btn pri" id="ro-start">⚔ LANCER LA BATAILLE</button><button class="btn" id="ro-train-btn">🧬 ENTRAÎNER LES BOTS</button></div>
          <div class="card" id="ro-train" hidden><h3>🧬 Académie des bots<span class="sp" id="ro-tstat"></span></h3>
            <p class="muted" style="font-size:13.5px;margin-bottom:8px">Chaque bot invente une variante de sa stratégie, l'affronte dans de vraies parties à 4 et garde la meilleure. Laisse tourner : ça continue en arrière-plan.</p>
            <label class="fld">Générations<select id="ro-gens"><option>5</option><option selected>20</option><option>60</option><option>200</option></select></label>
            <label class="fld">Parties par génération<select id="ro-ggames"><option>2</option><option selected>4</option><option>8</option></select></label>
            <div class="ro-bar"><i id="ro-tbar"></i></div><div id="ro-tlog" class="ro-tlog"></div>
            <div class="row"><button class="btn pri" id="ro-tgo">▶ LANCER L'ENTRAÎNEMENT</button><button class="btn" id="ro-tstop" hidden>⏹ ARRÊTER</button><button class="btn" id="ro-treset">TOUT RÉINITIALISER</button></div></div>
          <div class="card"><h3>Palmarès<span class="sp" id="ro-ngames"></span></h3><div id="ro-wins" class="list"></div></div>
        </div>
        <div id="ro-game" hidden>
          <button class="back" id="ro-back">◂ MENU</button>
          <div class="ro-hud"><span id="ro-turn"></span><span id="ro-stormhud"></span></div>
          <div class="ro-arena" id="ro-arena">
            ${[0, 1, 2, 3].map((s) => `<div class="ro-ban" data-s="${s}" style="--pc:${COLORS[s]}"><div class="ro-hd"><span class="ro-dot"></span><span class="ro-ttl"></span><b class="nm"></b><small class="ro-elo"></small><span class="ro-t"></span><span class="ro-pts">✦ 0</span><span class="ro-ko" hidden>💀</span></div><div class="ro-chat"></div><div class="ro-q" hidden></div><div class="ro-cap"></div></div>`).join("")}
            <div class="ro-boardwrap"><div class="ro-board" id="ro-board"><div class="ro-sqs"></div><div class="ro-pcs"></div><div class="ro-fx"></div></div></div>
          </div>
          <div class="ro-ticker" id="ro-ticker">&nbsp;</div>
          <form class="ro-say" id="ro-say" hidden><input id="ro-sayin" type="text" maxlength="14" autocomplete="off" autocapitalize="off" placeholder="Coup dicté : ex. h2 h4" enterkeyhint="go"><button class="btn pri" type="submit">▶ JOUER</button><button class="btn" type="button" id="ro-share">📸 PLATEAU</button></form>
          <div class="row"><button class="btn" id="ro-undo" hidden>↶ ANNULER</button><button class="btn" id="ro-pause">⏸ PAUSE</button><button class="btn" id="ro-spd">VITESSE</button><button class="btn" id="ro-redo">↻ REJOUER</button></div>
          <div class="ro-end" id="ro-end" hidden></div>
        </div>`;

      // ------------------------------------------------------------------ préparation
      const seatEls = () => Array.from(el.querySelectorAll(".ro-seat"));
      function fillSeats() {
        seatEls().forEach((box, s) => {
          const c = cfg.seats[s];
          box.querySelector('[data-f="who"]').innerHTML = `<option value="human">Joueur humain</option>` + PERSONAS.map((p) => `<option value="${p}">${esc(pname(p))}</option>`).join("");
          box.querySelector('[data-f="who"]').value = c.who;
          const nm = box.querySelector('[data-f="name"]'); nm.value = c.name || ""; box.querySelector(".ro-nmf").hidden = c.who !== "human";
          const label = (i) => `${SEAT[i]} (${esc(seatName(i))})`;
          const tm = box.querySelector('[data-f="team"]');
          tm.innerHTML = TEAMLET.map((l, i) => `<option value="${i}">Équipe ${l}</option>`).join(""); tm.value = String(c.team);
          const tgt = box.querySelector('[data-f="target"]');
          tgt.innerHTML = [0, 1, 2, 3].filter((i) => i !== s && cfg.seats[i].team !== c.team).map((i) => `<option value="${i}">${label(i)}</option>`).join("");
          tgt.value = String(c.target);
          const who = c.who, av = box.querySelector(".ro-sav");
          av.innerHTML = who === "human" ? `<div class="bot-av ph" style="--c:${COLORS[s]}">${esc(seatName(s).slice(0, 3).toUpperCase())}</div>` : E.botChat.avatar(who);
          box.querySelector(".ro-sinfo").innerHTML = who === "human" ? "Joueur" : `${E.botChat.badge(titleOf(who))}${esc(eloLabel(who))}`;
        });
        drawDuo();
        const groups = {}; cfg.seats.forEach((c, s) => (groups[c.team] = groups[c.team] || []).push(SEAT[s]));
        $("#ro-teams").innerHTML = Object.entries(groups).map(([t, l]) => `<b>${TEAMLET[t]}</b> ${l.join(" + ")}`).join(" &nbsp;vs&nbsp; ");
        $("#ro-storm").value = cfg.storm; $("#ro-speed").value = cfg.speed; $("#ro-learned").checked = !!cfg.learned;
      }
      // ---- Elo / titre affichés (départ : AI.ELO ; Naskurieux, Naskolit et le Jester évoluent pendant la partie)
      const titleOf = (id, elo) => (E.botChat ? E.botChat.titleOf(elo == null ? AI.ELO[id] || 0 : elo, AI.TITLE[id]) : "");
      const eloLabel = (id) => (id === "jester" ? " · roue 1-3200" : id === "naskurieux" ? " · 1 Elo (+200 par erreur adverse)" : " · " + AI.ELO[id] + " Elo");
      // ---- 2 contre 2 : choisir qui est partenaire de qui (siège -> équipe) selon l'organisation « en face » ou « côte à côte »
      const DUO = { opp: { a: [0, 2], b: [1, 3] }, nei: { a: [0, 1], b: [2, 3] } };
      const duoMode = () => { const t = cfg.seats.map((c) => c.team); if (new Set(t).size !== 2 || t.filter((x) => x === t[0]).length !== 2) return ""; return t[0] === t[2] ? "opp" : t[0] === t[1] ? "nei" : ""; };
      function drawDuo() {
        const m = duoMode(), box = $("#ro-duo");
        box.hidden = !m;
        if (!m) return;
        const lay = DUO[m], opts = (v) => `<option value="human">Joueur humain</option>` + PERSONAS.map((p) => `<option value="${p}">${esc(pname(p))} · ${AI.ELO[p]} Elo</option>`).join("");
        box.querySelectorAll("[data-ds]").forEach((sel) => { const [g, i] = [sel.dataset.ds[0], +sel.dataset.ds[1]], seat = lay[g][i]; sel.innerHTML = opts(); sel.value = cfg.seats[seat].who; sel.title = SEAT[seat]; });
        box.querySelectorAll("#ro-dm button").forEach((b) => b.classList.toggle("on", b.dataset.dm === m));
      }
      function setDuo(mode, keep) {                                               // réorganise les sièges : l'équipe A garde ses joueurs, la B les siens
        const m0 = duoMode() || "opp", old = DUO[m0], who = { a: old.a.map((s) => cfg.seats[s].who), b: old.b.map((s) => cfg.seats[s].who) };
        if (keep) { who.a = keep.a; who.b = keep.b; }
        const lay = DUO[mode];
        ["a", "b"].forEach((g, gi) => lay[g].forEach((s, i) => { cfg.seats[s].who = who[g][i]; cfg.seats[s].team = gi; cfg.seats[s].name = ""; }));
        cfg.seats.forEach((c, s) => { c.target = [1, 2, 3].map((d) => (s + d) % 4).find((i) => cfg.seats[i].team !== c.team); });
        save(); fillSeats();
      }
      el.querySelector("#ro-duo").addEventListener("change", (e) => {
        const sel = e.target.closest("[data-ds]");
        if (!sel) return;
        const m = duoMode(), seat = DUO[m][sel.dataset.ds[0]][+sel.dataset.ds[1]];
        cfg.seats[seat].who = sel.value; save(); fillSeats();
      });
      el.querySelector("#ro-duo").addEventListener("click", (e) => {
        const dm = e.target.closest("[data-dm]"), m = duoMode();
        if (dm && m && dm.dataset.dm !== m) return setDuo(dm.dataset.dm);
        if (e.target.closest("#ro-duo-swap") && m) { const l = DUO[m]; return setDuo(m, { a: l.b.map((s) => cfg.seats[s].who), b: l.a.map((s) => cfg.seats[s].who) }); }
        if (e.target.closest("#ro-duo-mix") && m) { const pool = PERSONAS.slice().sort(() => Math.random() - 0.5).slice(0, 4); return setDuo(m, { a: pool.slice(0, 2), b: pool.slice(2) }); }
      });
      const seatName = (i) => { const c = cfg.seats[i]; return c.who === "human" ? (c.name || (cfg.seats.filter((x) => x.who === "human").length > 1 ? "Joueur " + SEAT[i] : pname("human"))) : pname(c.who); };
      const save = () => E.settings.set("royale.cfg", cfg);
      // il faut au moins deux équipes ; la cible d'un siège est toujours un ennemi
      function normalise() {
        const s2 = cfg.seats;
        if (new Set(s2.map((c) => c.team)).size < 2) s2.forEach((c, i) => (c.team = i));
        s2.forEach((c, s) => { if (c.target === s || s2[c.target].team === c.team) c.target = [1, 2, 3].map((d) => (s + d) % 4).find((i) => s2[i].team !== c.team); });
      }
      el.querySelector("#ro-seats").onchange = (e) => {
        const box = e.target.closest(".ro-seat"), f = e.target.dataset.f;
        if (!box || !f) return;
        const s = +box.dataset.s;
        cfg.seats[s][f] = f === "target" || f === "team" ? +e.target.value : e.target.value;
        normalise(); save(); fillSeats();
      };
      el.querySelector("#ro-seats").oninput = (e) => { if (e.target.dataset.f === "name") { cfg.seats[+e.target.closest(".ro-seat").dataset.s].name = e.target.value; save(); } };
      $("#ro-storm").onchange = (e) => { cfg.storm = e.target.value; save(); };
      $("#ro-speed").onchange = (e) => { cfg.speed = e.target.value; save(); };
      $("#ro-learned").onchange = (e) => { cfg.learned = e.target.checked; save(); };
      function applyPreset(i) {
        const teams = PRESETS[i][1];
        cfg.seats.forEach((c, s) => { c.team = teams[s]; });
        normalise(); fillSeats();
        cfg.seats.forEach((c, s) => { c.target = [1, 2, 3].map((d) => (s + d) % 4).find((j) => cfg.seats[j].team !== c.team); });
        save(); fillSeats(); E.vibrate(8);
        el.querySelectorAll("#ro-modes button, #ro-presets button").forEach((b) => b.classList.toggle("on", +b.dataset.p === i));
      }
      $("#ro-modes").onclick = $("#ro-presets").onclick = (e) => { const b = e.target.closest("button[data-p]"); if (b) applyPreset(+b.dataset.p); };
      PENDING = () => { const p = E.settings.get("royale.pending", null); if (p != null) { E.settings.set("royale.pending", null); applyPreset(+p); } };
      PENDING();

      function palmares() {
        const st = stat(), rows = Object.entries(st.wins).sort((a, b) => b[1] - a[1]);
        $("#ro-ngames").textContent = st.games ? st.games + " bataille" + (st.games > 1 ? "s" : "") : "";
        $("#ro-wins").innerHTML = rows.length ? rows.map(([id, n]) => `<div class="it"><span class="n">${esc(pname(id))}</span><span class="tag">${n} victoire${n > 1 ? "s" : ""}</span></div>`).join("") : '<div class="empty muted">Aucune bataille terminée pour le moment.</div>';
      }

      // ------------------------------------------------------------------ plateau
      const ROT = [(x, y) => [x, y], (x, y) => [y, 13 - x], (x, y) => [13 - x, 13 - y], (x, y) => [13 - y, x]];            // tourne le plateau pour que le siège `view` soit en bas
      const UNROT = [(x, y) => [x, y], (x, y) => [13 - y, x], (x, y) => [13 - x, 13 - y], (x, y) => [y, 13 - x]];
      const FILES = "abcdefghijklmn";
      const sqName = (sq) => { const [vx, vy] = toView(sq); return FILES[vx] + (14 - vy); };                    // nom d'une case vu du plateau affiché (a1 = en bas à gauche)
      const fromName = (t) => { const m = /^([a-n])(\d{1,2})$/i.exec(t); if (!m) return -1; const vx = FILES.indexOf(m[1].toLowerCase()), vy = 14 - +m[2]; if (vy < 0 || vy > 13) return -1; const [x, y] = UNROT[G.view](vx, vy); return C4.VALID[x + y * 14] ? x + y * 14 : -1; };
      const toView = (sq) => { const [x, y] = C4.XY(sq); return ROT[G.view](x, y); };
      const CELL = 100 / 14;
      const place = (node, sq) => { const [vx, vy] = toView(sq); node.style.left = vx * CELL + "%"; node.style.top = vy * CELL + "%"; };
      const spriteOf = (v) => { const o = C4.ownerOf(v), t = C4.typeOf(v); return `img/chess/${o === 1 || o === 2 ? "w" : "b"}${C4.LETTER[t]}.png`; };       // 4 = pièces grisées d'un joueur éliminé

      function buildBoard() {
        const sqs = $(".ro-sqs"), pcs = $(".ro-pcs");
        sqs.innerHTML = ""; pcs.innerHTML = ""; G.sqEl = {}; G.pc = new Map();
        for (let i = 0; i < C4.SQ; i++) {
          if (!C4.VALID[i]) continue;
          const [x, y] = C4.XY(i), d = document.createElement("div");
          d.className = "ro-sq " + ((x + y) % 2 ? "d" : "l"); d.dataset.sq = i; d.style.width = d.style.height = CELL + "%"; place(d, i); sqs.appendChild(d); G.sqEl[i] = d;
          const [vx, vy] = toView(i), below = ROT[G.view](...C4.XY(i)), vOk = (ax, ay) => ax >= 0 && ay >= 0 && ax < 14 && ay < 14 && C4.VALID[UNROT[G.view](ax, ay)[0] + UNROT[G.view](ax, ay)[1] * 14];
          if (!vOk(vx, vy + 1)) d.insertAdjacentHTML("beforeend", `<i class="co f">${FILES[vx]}</i>`);
          if (!vOk(vx - 1, vy)) d.insertAdjacentHTML("beforeend", `<i class="co r">${14 - vy}</i>`);
        }
        for (let i = 0; i < C4.SQ; i++) if (G.st.b[i]) makePiece(i);
      }
      function makePiece(sq) {
        const v = G.st.b[sq], n = document.createElement("img");
        n.className = "pc c" + C4.ownerOf(v); n.src = spriteOf(v); n.alt = ""; n.draggable = false; n.style.width = n.style.height = CELL + "%"; n.dataset.v = v; place(n, sq);
        $(".ro-pcs").appendChild(n); G.pc.set(sq, n); return n;
      }
      function drawSquares() {
        const st = G.st, danger = new Set(), soon = C4.stormIn(st);
        for (let o = 0; o < 4; o++) {                                               // rois menacés (pulsation rouge)
          if (!st.alive[o]) continue;
          const k = C4.kingSq(st, o);
          for (let e = 0; e < 4; e++) if (e !== o && st.alive[e] && !C4.allied(st, o, e) && C4.attackedBy(st, e)[k]) danger.add(k);
        }
        for (const i in G.sqEl) {
          const d = G.sqEl[i], x = i % 14, y = (i / 14) | 0, out = !C4.playable(st, x, y), ring = !out && soon <= 8 && (x === st.level || x === 13 - st.level || y === st.level || y === 13 - st.level);
          d.classList.toggle("storm", out); d.classList.toggle("warn", ring);
          d.classList.toggle("last", !!st.last && (st.last[0] == i || st.last[1] == i));
          d.classList.toggle("sel", G.sel === +i); { const pn = G.pc && G.pc.get(+i); if (pn) pn.classList.toggle("liftsel", G.sel === +i); } d.classList.toggle("tgt", G.legal.has(+i) && !st.b[i]); d.classList.toggle("cap", G.legal.has(+i) && !!st.b[i]);
          d.classList.toggle("chk", danger.has(+i));
        }
      }
      function hud() {
        const st = G.st, o = st.turn;
        const hs = G.seats.filter((x) => x.human), multi = hs.length > 1, ck = !G.over && C4.inCheck(st, o) >= 0;
        $("#ro-turn").innerHTML = G.over ? "Bataille terminée" : `<i class="ro-dot" style="background:${COLORS[o]}"></i>${G.seats[o].human ? (multi ? "🎙 Joue le coup de " : "À toi, ") : ""}<b>${esc(G.seats[o].name)}</b>${G.seats[o].human ? (multi ? ` <small>(pièces ${SEAT[o].toLowerCase()})</small>` : "") : " réfléchit…"}${ck ? ' <span class="ro-chk">♚ ÉCHEC !</span>' : ""}`;
        const sayBox = $("#ro-say"); sayBox.hidden = G.over || !G.seats[o].human;
        const t = C4.stormIn(st);
        $("#ro-stormhud").textContent = !st.storm ? "" : t === Infinity ? "🌪 tempête terminée" : t <= 8 ? `🌪 effondrement dans ${t} coups !` : `🌪 dans ${t} coups`;
        $("#ro-stormhud").classList.toggle("hot", t <= 8);
        el.querySelectorAll(".ro-ban").forEach((b) => {
          const s = +b.dataset.s, seat = G.seats[s];
          b.classList.toggle("turn", !G.over && st.turn === s); b.classList.toggle("dead", !st.alive[s]); b.classList.toggle("ko", !st.alive[s]);
          b.querySelector(".ro-pts").textContent = "✦ " + st.pts[s];
          b.querySelector(".ro-ko").hidden = st.alive[s];
          b.querySelector(".ro-cap").innerHTML = st.captured[s].slice(-10).map((v) => `<img src="${spriteOf(v)}" class="c${C4.ownerOf(v)}" alt="">`).join("");
        });
      }
      const ticker = (t) => { $("#ro-ticker").textContent = t; };

      // ------------------------------------------------------------------ nouvelle partie
      function seatsFromCfg() {
        const L = learned();
        return cfg.seats.map((c, s) => {
          const human = c.who === "human", foes = [0, 1, 2, 3].map((i) => i !== s && cfg.seats[i].team !== c.team);
          const ai = human ? null : AI.make({ persona: c.who, w: cfg.learned && L[c.who] ? L[c.who].w : null, target: c.target, foes, royale: true });
          if (ai && (ai.eloGrow || ai.eloDrowsy)) AI.setElo(ai, AI.ELO[c.who]);
          return { s, human, id: c.who, name: seatName(s), target: c.target, team: c.team, ai, elo: human ? null : AI.ELO[c.who], title: human ? "" : titleOf(c.who) };
        });
      }
      function launch() {
        normalise();
        const seats = seatsFromCfg(), teams = seats.map((x) => x.team);
        const firstHuman = seats.find((x) => x.human);
        G = { st: C4.newGame({ teams, storm: STORMS[cfg.storm] }), seats, view: firstHuman ? firstHuman.s : 0, sel: -1, legal: new Set(), legalMoves: [], paused: false, over: false, token: (G ? G.token : 0) + 1, speed: cfg.speed, sqEl: {}, pc: new Map(), hist: [], warned: [false, false, false, false] };
        G.lostMinor = [0, 0, 0, 0]; G.q = [0, 1, 2, 3].map(() => ({ brilliant: 0, best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 })); G.busy = false; document.documentElement.classList.remove("ghor");
        G.sleep = [0, 0, 0, 0]; G.skCd = [0, 0, 0, 0]; G.rt = [0, 0, 0, 0]; G.badge = [];
        $(".ro-fx").innerHTML = ""; $("#ro-board").classList.remove("ghorfx"); el.querySelectorAll(".ro-ban").forEach((b) => b.classList.remove("ghorfx", "sleep"));
        $("#ro-setup").hidden = true; $("#ro-game").hidden = false; $("#ro-end").hidden = true;
        el.querySelectorAll(".ro-ban").forEach((b) => { const s = +b.dataset.s, pos = (s - G.view + 4) % 4; b.dataset.pos = pos; b.classList.remove("ko"); b.querySelector(".nm").textContent = G.seats[s].name; b.querySelector(".ro-t").textContent = teamTag(s); });
        $("#ro-arena").dataset.view = G.view;
        buildBoard();
        mountChats();
        for (let s = 0; s < 4; s++) renderBan(s);
        $("#ro-pause").textContent = "⏸ PAUSE"; $("#ro-spd").textContent = "VITESSE : " + ({ slow: "LENTE", normal: "NORMALE", fast: "RAPIDE", turbo: "TURBO" }[G.speed]);
        $("#ro-undo").hidden = !G.seats.some((x) => x.human);
        drawSquares(); hud(); ticker("La bataille commence !");
        const tok = G.token;
        setTimeout(() => { if (G && tok === G.token) greetAll(); }, 400);
        loop(tok);
      }
      const teamTag = (s) => { const mates = G.seats.filter((x) => x.team === G.seats[s].team).length; return mates > 1 ? "Équipe " + TEAMLET[G.seats[s].team] : ""; };
      function mountChats() {
        const bc = E.botChat;
        bc.unmountAll(); G.chat = {};
        el.querySelectorAll(".ro-ban").forEach((b) => {
          const s = +b.dataset.s, seat = G.seats[s], host = b.querySelector(".ro-chat");
          host.hidden = false;
          if (seat.human) { host.innerHTML = `<div class="bot-banner"><div class="bot-av ph" style="--c:${COLORS[s]}">${esc(pname("human").slice(0, 3).toUpperCase())}</div></div>`; return; }
          G.chat[s] = bc.mount(host, seat.id, { opp: () => G.seats[seat.target].name, ctx: () => ({ summary: `bataille à 4, tu attaques ${G.seats[seat.target].name} ; points ${G.st.pts[s]}` }), shared: false });
        });
      }
      const say = (s, kind, d, fallback) => { const I = G && G.chat && G.chat[s]; if (!I) return false; return I.say(kind, d) || (fallback ? I.say(fallback, d) : false); };
      function greetAll() {
        let i = 0;
        for (const s of [2, 3, 1, 0].map((p) => (p + G.view) % 4)) { if (!G.chat[s]) continue; setTimeout(() => { if (G && !G.over) say(s, "r_target", { elo: 0 }, "greet"); }, 250 + (i++) * 1100); }
      }

      // ------------------------------------------------------------------ tour par tour
      const sleep = E.sleep;
      async function loop(tok) {
        while (G && tok === G.token && !G.over) {
          const st = G.st, o = st.turn, seat = G.seats[o];
          if (C4.over(st) || st.ply >= MAX_PLIES) return finish();
          hud();
          if (G.paused || G.busy) { await sleep(120); continue; }
          if (G.sleep[o] > 0) { await napSkip(o); continue; }                                   // endormi par Naskolit : il passe son tour
          if (seat.human) { G.legalMoves = C4.moves(st, o); await sleep(80); continue; }          // en attente d'un clic (voir onTap)
          const d = SPEEDS[G.speed];
          if (d) await sleep(d + Math.random() * d * 0.25);
          if (!G || tok !== G.token || G.paused || G.st !== st || st.turn !== o) continue;
          if (seat.ai.wheel && seat.ai.moves % 10 === 0 && seat.ai.spun !== seat.ai.moves) {      // la roue du Jester tourne AVANT son coup : il attend de connaître son Elo
            seat.ai.spun = seat.ai.moves; await jesterWheel(o, !d); continue;
          }
          if (++G.rt[o] % 3 === 1) {                                                          // analyse : qui me menace le plus ? qui est à ma portée ? faut-il changer de cible ?
            let rt = null; try { rt = AI.retarget(st, o, seat.ai); } catch (e) { rt = null; }
            if (rt) retargeted(o, rt);
          }
          const m = AI.choose(st, o, seat.ai);
          if (m < 0) { st.turn = (o + 1) % 4; continue; }
          apply(m, !!d);
          if (!d && st.ply % 6 === 0) await sleep(0);                               // turbo : rend la main de temps en temps
        }
      }
      function apply(m, animate) {
        G.hist.push(C4.clone(G.st)); if (G.hist.length > 500) G.hist.shift();
        const st = G.st, o = st.turn;
        let J = null;
        if (G.speed !== "turbo") { try { J = AI.judgeMove(st, o, m, G.neutral || (G.neutral = AI.neutral())); } catch (e) { J = null; } }     // jugé AVANT le coup (comparé aux autres coups légaux)
        const r = C4.play(st, m);
        if (!r.ok) return;
        const from = r.from, to = r.to;
        // pièce prise
        const victim = G.pc.get(to);
        if (victim && r.captured) { G.pc.delete(to); victim.classList.add("out"); setTimeout(() => victim.remove(), 320); boom(to, r.captured.owner === C4.DEAD ? 1 : r.captured.type); }
        // pièce qui bouge
        const mover = G.pc.get(from);
        if (mover) { G.pc.delete(from); G.pc.set(to, mover); place(mover, to); mover.classList.add("lift"); setTimeout(() => mover.classList.remove("lift"), 260); if (r.promo) { mover.src = spriteOf(st.b[to]); mover.dataset.v = st.b[to]; } }
        // éliminations / tempête : les pièces d'un joueur éliminé se GRISENT (elles restent), celles détruites par la tempête disparaissent
        if (r.eliminated.length || r.storm) {
          for (const [sq, n] of Array.from(G.pc)) {
            const cur = st.b[sq], was = +n.dataset.v;
            if (!cur) { G.pc.delete(sq); n.classList.add("out"); setTimeout(() => n.remove(), 450); }
            else if (cur !== was && C4.ownerOf(cur) === C4.DEAD && C4.typeOf(cur) === C4.typeOf(was)) { n.dataset.v = cur; n.src = spriteOf(cur); n.className = "pc c4 greyed"; }
          }
        }
        if (r.storm) { quake(); ticker("🌪 La tempête dévore le bord du plateau !"); E.vibrate([40, 40, 80]); for (const s of Object.keys(G.chat)) say(+s, "r_storm", {}); }
        if (G.over === false) { E.chessSound && E.chessSound.play(r.captured ? "capture" : "move"); }
        // icônes et effets du coup
        moveFx(o, from, to, r);
        // commentaires
        if (J) judged(o, J, r);
        events(r, o);
        if (G.skCd[o] > 0) G.skCd[o]--;
        if (r.captured && r.captured.owner < 4 && G.seats[o].id === "naskolit" && G.skCd[o] <= 0 && C4.VALUE[r.captured.type] >= 3 && G.st.alive[r.captured.owner] && !C4.allied(G.st, o, r.captured.owner) && G.sleep[r.captured.owner] <= 0) putToSleep(o, r.captured.owner);
        if (r.captured && r.captured.owner < 4 && G.seats[r.captured.owner].id === "ghorghor" && [C4.KN, C4.B].includes(r.captured.type) && ++G.lostMinor[r.captured.owner] === minorNeed(r.captured.owner)) ghorTransform(r.captured.owner);
        const info = AI.afterMove(G.seats[o].ai || { moves: 0 }, { captured: !!r.captured });
        if (r.captured && r.captured.owner < 4 && G.seats[r.captured.owner].ai) AI.afterMove(G.seats[r.captured.owner].ai, { lost: true });
        if (info && info.elo != null) { renderBan(o); ticker(`🎡 La roue donne ${info.elo} Elo au Jester !`); say(o, info.elo < 800 ? "wheel_low" : info.elo < 2400 ? "wheel_mid" : "wheel_high", { elo: info.elo }); }
        G.sel = -1; G.legal = new Set();
        if (E.botChat) E.botChat.tick();
        drawSquares(); hud();
      }
      // ------------------------------------------------------------------ jugement des coups, Elo vivant, titres, transformation de GhorGhor
      const QCOL = { brilliant: "#1acfd6", best: "#8be04d", excellent: "#8be04d", good: "#9bb0a0", inaccuracy: "#f5b042", mistake: "#ff8a3d", blunder: "#ff3b4f" };
      function renderBan(s) {
        const b = el.querySelector(`.ro-ban[data-s="${s}"]`), seat = G.seats[s];
        if (!b) return;
        b.querySelector(".nm").textContent = seat.name;
        b.querySelector(".ro-ttl").innerHTML = E.botChat && seat.title ? E.botChat.badge(seat.title) : "";
        b.querySelector(".ro-elo").textContent = seat.human ? "" : String(seat.ai && seat.ai.elo ? seat.ai.elo : seat.elo);
      }
      function judged(o, J, r) {
        const q = G.q[o], seat = G.seats[o], label = AI.QUALITY[J.key];
        q[J.key]++;
        if (r && r.to != null) badge(o, r.to, J.key);
        const chip = el.querySelector(`.ro-ban[data-s="${o}"] .ro-q`);
        if (chip && J.key !== "good") { chip.hidden = false; chip.style.setProperty("--qc", QCOL[J.key]); chip.textContent = (J.key === "brilliant" ? "✦ " : "") + label.toUpperCase() + (J.key === "brilliant" ? " !!" : J.key === "blunder" ? " ??" : ""); clearTimeout(chip._t); chip._t = setTimeout(() => { chip.hidden = true; }, 2600); }
        const bad = ["inaccuracy", "mistake", "blunder"].includes(J.key), great = J.key === "best" || J.key === "brilliant";
        if (J.key === "brilliant") { ticker(`✦ ${seat.name} joue un coup BRILLANT !!`); E.chessSound && E.chessSound.play("brilliant"); E.vibrate([30, 40, 60]); }
        else if (J.key === "blunder") ticker(`💥 Gaffe de ${seat.name} !`);
        // réactions des personnages : le joueur lui-même, puis ses adversaires
        say(o, J.key === "brilliant" ? "bot_brilliant" : J.key === "blunder" ? "bot_blunder" : J.key === "mistake" ? "bot_mistake" : great || J.key === "excellent" ? "super" : "good", { san: "ce coup" });
        for (let e = 0; e < 4; e++) {
          if (e === o || !G.st.alive[e] || C4.allied(G.st, o, e)) continue;
          if (J.key === "brilliant") say(e, "h_brilliant", {}); else if (J.key === "blunder") say(e, "h_blunder", {}); else if (J.key === "mistake") say(e, "h_mistake", {});
        }
        // Elo vivant : Naskurieux +200 par erreur adverse (ou meilleur coup à lui), Naskolit −100 par imprécision (ou meilleur coup adverse)
        for (let s = 0; s < 4; s++) {
          const ai = G.seats[s].ai;
          if (!ai || !G.st.alive[s]) continue;
          const mine = s === o, foe = !mine && !C4.allied(G.st, o, s);
          let d = 0;
          if (ai.eloGrow) d = (foe && bad) || (mine && great) ? 200 : 0;
          else if (ai.eloDrowsy) d = (mine && bad) || (foe && great) ? -100 : 0;
          if (d) { AI.setElo(ai, ai.elo + d); renderBan(s); if (d > 0) { ticker(`📈 ${G.seats[s].name} passe à ${ai.elo} Elo`); say(s, "elo_up", { elo: ai.elo }); } }
        }
      }
      // GhorGhor se réveille après 3 pièces mineures perdues, mais une seule si un de ses ennemis est ETO ou E.N.O.S.
      const minorNeed = (s) => (G.seats.some((x, i) => i !== s && !C4.allied(G.st, s, i) && (x.id === "eto" || x.id === "enos")) ? 1 : 3);
      function glitchFx(ms) {
        const app = document.getElementById("app");
        if (!app || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !E.settings.get("anim", true)) return sleep(Math.min(ms, 600));
        const ov = document.createElement("div"); ov.className = "glitch-ov"; document.body.appendChild(ov);
        return new Promise((res) => {
          const t0 = Date.now(), j = (x) => (Math.random() - 0.5) * x;
          const iv = setInterval(() => {
            if (Date.now() - t0 > ms) { clearInterval(iv); app.style.transform = ""; app.style.filter = ""; ov.remove(); return res(); }
            app.style.transform = `translate(${j(18)}px,${j(8)}px) skewX(${j(9)}deg)`;
            app.style.filter = `hue-rotate(${Math.round(j(200))}deg) contrast(${(1 + Math.random() * 0.9).toFixed(2)}) saturate(${(1 + Math.random() * 2).toFixed(2)})`;
            ov.innerHTML = Array.from({ length: 6 }, () => `<i style="top:${(Math.random() * 100).toFixed(1)}%;height:${(1 + Math.random() * 9).toFixed(1)}%;left:${j(40).toFixed(0)}px;background:${["#ff0033aa", "#00ffeeaa", "#ffffff88"][Math.floor(Math.random() * 3)]}"></i>`).join("");
          }, 55);
        });
      }
      /** GhorGhor perd sa 3e pièce mineure : écran qui glitche, il devient « GhorGhor le vrai » (GM 3200 Elo) pour le reste de la bataille. */
      async function ghorTransform(s) {
        const tok = G.token, seat = G.seats[s], old = G.chat && G.chat[s];
        G.busy = true;
        ticker(`👁 ${seat.name} vacille… quelque chose se réveille`);
        if (old) old.say("transform");
        await sleep(2000);
        if (!G || tok !== G.token) return;
        E.vibrate([60, 40, 60, 40, 140]);
        ghorSound(); ghorOverlay(2300);
        await glitchFx(1700);
        if (!G || tok !== G.token) return;
        const c = cfg.seats[s], foes = [0, 1, 2, 3].map((i) => i !== s && G.seats[i].team !== seat.team);
        Object.assign(seat, { id: "ghorreal", name: "GhorGhor le vrai", elo: 3200, title: "GM", ai: AI.make({ persona: "ghorreal", target: seat.target, foes, royale: true }) });
        document.documentElement.classList.add("ghor");
        $("#ro-board").classList.add("ghorfx"); el.querySelector(`.ro-ban[data-s="${s}"]`).classList.add("ghorfx");
        G.pc.forEach((n) => { if (C4.ownerOf(+n.dataset.v) === s) n.classList.add("ghorpc"); });
        { const ks = C4.kingSq(G.st, s); if (ks >= 0) { fxCell(ks, "ring big", "").style.setProperty("--c", "#ff1a3c"); setTimeout(() => ks >= 0 && G && fxCell(ks, "ring big", "").style.setProperty("--c", "#ff4d63"), 250); } }
        if (E.botChat && old) { const n = E.botChat.replace(old, "ghorreal", "awake"); G.chat[s] = n; setTimeout(() => { if (G && tok === G.token && n) n.say("greet", { elo: 3200 }); }, 500); }
        renderBan(s); ticker("👁 GHORGHOR LE VRAI est réveillé : GM · 3200 Elo");
        G.busy = false;
      }
      function events(r, o) {
        const nm = (s) => G.seats[s].name, TY = ["", "pion", "cavalier", "fou", "tour", "dame", "roi"];
        if (r.captured) {
          const c = r.captured;
          if (c.owner === C4.DEAD) ticker(`${nm(o)} détruit une pièce grisée`);
          else if (C4.VALUE[c.type] >= 5 || c.type === C4.K) ticker(`${nm(o)} capture ${c.type === C4.K ? "le ROI" : "la " + TY[c.type]} de ${nm(c.owner)} !`);
          else ticker(`${nm(o)} prend ${c.type === C4.P ? "un pion" : "un " + TY[c.type]} de ${nm(c.owner)}`);
          if (c.owner !== C4.DEAD && C4.VALUE[c.type] >= 3) { say(o, "r_capture", { san: TY[c.type] }, "super"); say(c.owner, "r_lost", { san: TY[c.type] }, "bot_blunder"); }
        }
        for (const e of r.elim) {
          const why = e.why, by = e.by;
          ticker(why === "mate" ? `♚ ÉCHEC ET MAT ! ${nm(e.o)} est éliminé par ${nm(by)} : ses pièces sont grisées` : why === "stalemate" ? `🤝 PAT : ${nm(e.o)} n'a plus aucun coup, il est éliminé (pièces grisées)` : `💀 ${nm(e.o)} est emporté par la tempête !`);
          E.vibrate([30, 40, 30, 40, 120]); koFx(e.o); E.chessSound && E.chessSound.play("mate");
          say(e.o, "r_elim_lose", {}, "mate_lose");
          if (why === "mate" && by >= 0) say(by, "r_elim_win", {}, "mate_win");
        }
        if (r.check && !r.elim.length) {
          ticker(`♚ Échec à ${nm(r.check.who)} !`); E.chessSound && E.chessSound.play("check");
          say(r.check.by, "check", {}); say(r.check.who, "check_received", {});
        }
      }

      // ------------------------------------------------------------------ icônes et effets des coups
      const animOn = () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches && E.settings.get("anim", true);
      const soundOn = () => E.settings.get("chess.sound", true);
      const BADGE = { brilliant: ["!!", "#1acfd6"], best: ["★", "#7bd64d"], excellent: ["👍", "#9ecc38"], good: ["✓", "#739e66"], inaccuracy: ["?!", "#f5c542"], mistake: ["?", "#f5a524"], blunder: ["??", "#ff4d63"] };
      function fxCell(sq, cls, html) {
        const d = document.createElement("i"); d.className = "rfx " + cls; if (html) d.innerHTML = html;
        d.style.width = d.style.height = CELL + "%"; place(d, sq); $(".ro-fx").appendChild(d);
        if (!/badgecell/.test(cls)) setTimeout(() => d.remove(), 1500);
        return d;
      }
      function lineFx(a, b, col, cls) {
        const [x1, y1] = toView(a), [x2, y2] = toView(b), dx = (x2 - x1) * CELL, dy = (y2 - y1) * CELL;
        const t = document.createElement("i"); t.className = "rfx-trail " + (cls || "");
        t.style.cssText = `left:${(x1 + 0.5) * CELL}%;top:${(y1 + 0.5) * CELL}%;width:${Math.hypot(dx, dy)}%;--c:${col};transform:rotate(${Math.atan2(dy, dx)}rad)`;
        $(".ro-fx").appendChild(t); setTimeout(() => t.remove(), 1300);
      }
      function moveFx(o, from, to, r) {
        if (G.speed === "turbo" || !animOn()) return;
        const col = COLORS[o];
        lineFx(from, to, col);                                                                // traînée lumineuse du coup
        fxCell(from, "ghostsq").style.setProperty("--c", col);
        fxCell(to, "ring").style.setProperty("--c", col);
        if (G.badge) G.badge.forEach((c, i) => { if (c && c.dataset.sq == to && i !== o) { c.remove(); G.badge[i] = null; } });   // la pièce prise emporte son icône
        if (r.captured) {
          const big = C4.VALUE[r.captured.type] >= 5 || r.captured.type === C4.K, n = big ? 14 : 8;
          const sp = fxCell(to, "sparks", Array.from({ length: n }, (_, i) => `<s style="--a:${(i / n * 360 + Math.random() * 20).toFixed(0)}deg;--d:${(big ? 2.2 : 1.5) + Math.random() * 0.8}"></s>`).join(""));
          sp.style.setProperty("--c", r.captured.owner === C4.DEAD ? "#9aa" : COLORS[r.captured.owner] || col);
          fxCell(to, "ring wave").style.setProperty("--c", COLORS[r.captured.owner] || "#9aa");
          if (r.captured.owner !== C4.DEAD) fxCell(to, "pts", `<b>+${C4.VALUE[r.captured.type]}</b>`).style.setProperty("--c", col);
          if (big) { const bd = $("#ro-board"); bd.classList.remove("flash"); void bd.offsetWidth; bd.classList.add("flash"); }
        }
        if (r.promo) { fxCell(to, "promo", "<b>♛</b>").style.setProperty("--c", "#ffd24a"); fxCell(to, "ring big").style.setProperty("--c", "#ffd24a"); }
        if (r.check && !r.elim.length) { const ks = C4.kingSq(G.st, r.check.who); if (ks >= 0) { fxCell(ks, "ring big").style.setProperty("--c", "#ff3b4f"); lineFx(to, ks, "#ff3b4f", "chk"); } }
      }
      function badge(o, sq, key) {
        const b = BADGE[key]; if (!b || !G.badge) return;
        if (G.badge[o]) G.badge[o].remove();
        const c = fxCell(sq, "badgecell", `<b class="rfx-badge k-${key}" style="--c:${b[1]}">${b[0]}</b>`); c.dataset.sq = sq; G.badge[o] = c;
      }
      // changement de cible après analyse (menace, occasion, faiblesse, meneur)
      function retargeted(o, rt) {
        const seat = G.seats[o], ko = C4.kingSq(G.st, o), kt = C4.kingSq(G.st, rt.to);
        seat.target = rt.to;
        ticker(`🎯 ${seat.name} change de cible : ${G.seats[rt.to].name} (${rt.why})`);
        if (ko >= 0 && kt >= 0 && G.speed !== "turbo" && animOn()) { lineFx(ko, kt, COLORS[o], "tgt"); fxCell(kt, "ring").style.setProperty("--c", COLORS[o]); }
        const ban = el.querySelector(`.ro-ban[data-s="${o}"]`), q = ban && ban.querySelector(".ro-q");
        if (q) { q.hidden = false; q.style.setProperty("--qc", COLORS[rt.to]); q.textContent = "🎯 " + G.seats[rt.to].name.toUpperCase(); clearTimeout(q._t); q._t = setTimeout(() => { q.hidden = true; }, 2200); }
        say(o, "r_target", {});
      }
      // ---- Naskolit : capacité spéciale, il endort un adversaire pendant 1 tour (après une capture de pièce mineure ou plus, recharge 4 coups)
      function nextAlive(from) { for (let i = 1; i <= 4; i++) { const q = (from + i) % 4; if (G.st.alive[q]) return q; } return from; }
      function zzzSound() {
        try {
          if (!soundOn()) return;
          const ac = (zzzSound.ac = zzzSound.ac || new (window.AudioContext || window.webkitAudioContext)()), t = ac.currentTime;
          if (ac.state === "suspended") ac.resume();
          [523, 392, 294].forEach((f, i) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = "sine"; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + i * 0.16); g.gain.exponentialRampToValueAtTime(0.12, t + i * 0.16 + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.5); o.connect(g); g.connect(ac.destination); o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.55); });
        } catch (e) { /* audio indisponible */ }
      }
      function putToSleep(o, v) {
        G.sleep[v] = 1; G.skCd[o] = 4;
        ticker(`💤 ${G.seats[o].name} endort ${G.seats[v].name} : il passe son prochain tour !`);
        const ban = el.querySelector(`.ro-ban[data-s="${v}"]`); if (ban) ban.classList.add("sleep");
        const ks = C4.kingSq(G.st, v);
        if (ks >= 0 && animOn()) { fxCell(ks, "ring big").style.setProperty("--c", "#8aa4ff"); fxCell(ks, "zzz", "<b>Z</b><b>z</b><b>z</b>"); }
        G.pc.forEach((n) => { if (C4.ownerOf(+n.dataset.v) === v) n.classList.add("asleep"); });
        zzzSound(); E.vibrate([20, 40, 20]);
        say(v, "r_sleep", {}, "check_received");
      }
      async function napSkip(o) {
        G.sleep[o]--;
        const seat = G.seats[o], ban = el.querySelector(`.ro-ban[data-s="${o}"]`), ks = C4.kingSq(G.st, o);
        ticker(`😴 ${seat.name} dort… son tour est sauté`);
        if (ks >= 0 && animOn() && G.speed !== "turbo") fxCell(ks, "zzz", "<b>Z</b><b>z</b><b>z</b>");
        await sleep(SPEEDS[G.speed] ? Math.max(500, SPEEDS[G.speed]) : 60);
        if (ban) ban.classList.remove("sleep");
        G.pc.forEach((n) => { if (C4.ownerOf(+n.dataset.v) === o) n.classList.remove("asleep"); });
        G.st.turn = nextAlive(o); hud();
      }
      // ---- GhorGhor le vrai : cinématique plein écran
      function ghorSound() {
        try {
          if (!soundOn()) return;
          const ac = (ghorSound.ac = ghorSound.ac || new (window.AudioContext || window.webkitAudioContext)()), t = ac.currentTime;
          if (ac.state === "suspended") ac.resume();
          const n = ac.createBuffer(1, Math.floor(ac.sampleRate * 1.4), ac.sampleRate), data = n.getChannelData(0);
          for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (Math.random() < 0.35 ? 1 : 0.15) * (1 - i / data.length);
          const src = ac.createBufferSource(), g1 = ac.createGain(), o = ac.createOscillator(), g2 = ac.createGain();
          src.buffer = n; g1.gain.value = 0.5; src.connect(g1); g1.connect(ac.destination); src.start(t);
          o.type = "sawtooth"; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(32, t + 1.6); g2.gain.setValueAtTime(0.35, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 1.7); o.connect(g2); g2.connect(ac.destination); o.start(t); o.stop(t + 1.8);
        } catch (e) { /* audio indisponible */ }
      }
      function ghorOverlay(ms) {
        if (!animOn()) return;
        const ov = document.createElement("div"); ov.className = "ro-ghorov";
        ov.innerHTML = `<div class="rg-eye"><i></i></div><div class="rg-txt" data-t="GHORGHOR LE VRAI">GHORGHOR LE VRAI</div><div class="rg-sub">GM · 3200 Elo</div>`;
        document.body.appendChild(ov);
        setTimeout(() => { ov.classList.add("out"); setTimeout(() => ov.remove(), 600); }, ms);
      }
      // ---- la roue du Jester : roue HDR dessinée en canvas (reflets, ampoules, éclats), tirée AVANT son coup
      function wheelTick() {
        try {
          if (!soundOn()) return;
          const ac = (wheelTick.ac = wheelTick.ac || new (window.AudioContext || window.webkitAudioContext)()), t = ac.currentTime;
          if (ac.state === "suspended") ac.resume();
          const o = ac.createOscillator(), g = ac.createGain(); o.type = "triangle"; o.frequency.setValueAtTime(2100, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.04);
          g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.06);
        } catch (e) { /* audio indisponible */ }
      }
      function wheelFx(name, elo, fast) {
        return new Promise((done) => {
          const ov = document.createElement("div"); ov.className = "ro-wheel";
          ov.innerHTML = `<div class="rw-rays"></div><div class="rw-box"><div class="rw-title">🃏 LA ROUE DU JESTER</div><div class="rw-sub">${esc(name)} attend son futur niveau…</div><div class="rw-stage"><canvas></canvas></div><div class="rw-res"><b>…</b></div></div>`;
          document.body.appendChild(ov);
          const cv = ov.querySelector("canvas"), res = ov.querySelector(".rw-res"), SZ = Math.max(240, Math.min(Math.round(Math.min(innerWidth, innerHeight) * 0.74), 470)), dpr = Math.min(2, window.devicePixelRatio || 1);
          cv.width = cv.height = Math.round(SZ * dpr); cv.style.width = cv.style.height = SZ + "px";
          const g = cv.getContext("2d"), R = SZ / 2, SEG = 16, A = Math.PI * 2 / SEG, TAU = Math.PI * 2;
          const f = (elo - 1) / 3200, final = TAU * (fast ? 0 : 6) + TAU * (1 - f), DUR = fast ? 1 : 4800;
          const hueOf = (i) => 355 - i / (SEG - 1) * 235 + (i / (SEG - 1) > 0.5 ? 0 : 0);        // rouge (bas niveau) -> or -> vert -> cyan (niveau monstre)
          const sparks = []; let theta = 0, flap = 0, lastSeg = -1, lastTick = 0, t0 = performance.now(), phase = "spin", tEnd = 0;
          const label = (i) => (i === 0 ? "1" : String(i * 200));
          const tier = elo < 800 ? ["NIVEAU DÉBUTANT 😴", "#ff6a5a"] : elo < 1800 ? ["NIVEAU CORRECT 🙂", "#ffd24a"] : elo < 2600 ? ["NIVEAU FORT 🔥", "#8be04d"] : ["NIVEAU MONSTRE ⚡", "#1acfd6"];
          function draw(now) {
            const t = (now - t0) / 1000;
            g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, SZ, SZ);
            g.save(); g.translate(R, R);
            // halo HDR derrière la roue
            const halo = g.createRadialGradient(0, 0, R * 0.7, 0, 0, R * 1.02); halo.addColorStop(0, "rgba(255,190,60,0)"); halo.addColorStop(0.8, "rgba(255,170,40,.28)"); halo.addColorStop(1, "rgba(255,120,20,0)");
            g.fillStyle = halo; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
            const RR = R * 0.9;
            for (let i = 0; i < SEG; i++) {                                                     // quartiers
              const a0 = -Math.PI / 2 + theta + i * A, h = hueOf(i), gr = g.createRadialGradient(0, 0, RR * 0.18, 0, 0, RR);
              gr.addColorStop(0, `hsl(${h},80%,${i % 2 ? 12 : 18}%)`); gr.addColorStop(0.65, `hsl(${h},88%,${i % 2 ? 30 : 38}%)`); gr.addColorStop(1, `hsl(${h},100%,${i % 2 ? 46 : 56}%)`);
              g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, RR, a0, a0 + A); g.closePath(); g.fillStyle = gr; g.fill();
              g.save(); g.rotate(a0); g.strokeStyle = "rgba(255,235,170,.55)"; g.lineWidth = 2; g.beginPath(); g.moveTo(RR * 0.2, 0); g.lineTo(RR, 0); g.stroke(); g.restore();
              g.save(); g.rotate(a0 + A / 2); g.translate(RR * 0.66, 0); g.rotate(Math.PI / 2);
              g.font = `900 ${Math.round(R * 0.095)}px system-ui,sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
              g.shadowColor = `hsl(${h},100%,60%)`; g.shadowBlur = 12; g.fillStyle = "#fff"; g.fillText(label(i), 0, 0); g.restore();
            }
            // reflet vitré qui ne tourne pas (effet RTX)
            g.save(); g.beginPath(); g.arc(0, 0, RR, 0, TAU); g.clip();
            const gl = g.createLinearGradient(-RR, -RR, RR * 0.6, RR); gl.addColorStop(0, "rgba(255,255,255,.28)"); gl.addColorStop(0.35, "rgba(255,255,255,.04)"); gl.addColorStop(0.5, "rgba(255,255,255,0)"); gl.addColorStop(1, "rgba(0,0,0,.35)");
            g.fillStyle = gl; g.fillRect(-RR, -RR, RR * 2, RR * 2); g.restore();
            // jante métal doré
            let rim = "#d9a93a";
            if (g.createConicGradient) { const cg = g.createConicGradient(-0.6, 0, 0); [[0, "#fff1b8"], [0.12, "#b98512"], [0.28, "#ffe08a"], [0.45, "#8a5d08"], [0.6, "#ffefb0"], [0.78, "#a87410"], [1, "#fff1b8"]].forEach(([p, c]) => cg.addColorStop(p, c)); rim = cg; }
            g.strokeStyle = rim; g.lineWidth = R * 0.1; g.shadowColor = "rgba(255,190,60,.9)"; g.shadowBlur = 22; g.beginPath(); g.arc(0, 0, R * 0.945, 0, TAU); g.stroke(); g.shadowBlur = 0;
            g.strokeStyle = "rgba(0,0,0,.55)"; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, R * 0.895, 0, TAU); g.stroke();
            // ampoules qui chassent
            const bulbs = 32, flashAll = phase === "done" && Math.floor(t * 8) % 2 === 0;
            g.save(); g.globalCompositeOperation = "lighter";
            for (let i = 0; i < bulbs; i++) {
              const an = i / bulbs * TAU - Math.PI / 2, on = flashAll || (i + Math.floor(t * (phase === "spin" ? 16 : 6))) % 4 === 0;
              g.shadowColor = on ? "#fff3b0" : "transparent"; g.shadowBlur = on ? 16 : 0; g.fillStyle = on ? "#fff3b0" : "rgba(120,80,10,.7)";
              g.beginPath(); g.arc(Math.cos(an) * R * 0.945, Math.sin(an) * R * 0.945, R * 0.02, 0, TAU); g.fill();
            }
            g.restore();
            // moyeu
            const hub = g.createRadialGradient(-R * 0.04, -R * 0.05, R * 0.01, 0, 0, R * 0.2); hub.addColorStop(0, "#fff7d0"); hub.addColorStop(0.35, "#e0a92b"); hub.addColorStop(1, "#4d3205");
            g.shadowColor = "#000"; g.shadowBlur = 14; g.fillStyle = hub; g.beginPath(); g.arc(0, 0, R * 0.19, 0, TAU); g.fill(); g.shadowBlur = 0;
            g.font = `${Math.round(R * 0.18)}px system-ui,sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#fff"; g.fillText("🃏", 0, R * 0.01);
            // pointeur à ressort
            g.save(); g.translate(0, -R * 0.99); g.rotate(flap);
            g.shadowColor = "#ff3b4f"; g.shadowBlur = 18; const pg = g.createLinearGradient(0, 0, 0, R * 0.2); pg.addColorStop(0, "#fff"); pg.addColorStop(1, "#ff3b4f");
            g.fillStyle = pg; g.beginPath(); g.moveTo(-R * 0.055, -R * 0.02); g.lineTo(R * 0.055, -R * 0.02); g.lineTo(0, R * 0.19); g.closePath(); g.fill(); g.restore();
            // éclats
            g.save(); g.globalCompositeOperation = "lighter";
            for (let i = sparks.length - 1; i >= 0; i--) { const s = sparks[i]; s.x += s.vx; s.y += s.vy; s.vy += 0.12; s.l -= 0.018; if (s.l <= 0) { sparks.splice(i, 1); continue; } g.fillStyle = s.c; g.globalAlpha = Math.max(0, s.l); g.shadowColor = s.c; g.shadowBlur = 10; g.beginPath(); g.arc(s.x, s.y, s.r, 0, TAU); g.fill(); }
            g.restore(); g.restore();
          }
          const burst = () => { const c = tier[1]; for (let i = 0; i < 90; i++) { const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, v = 2 + Math.random() * 6; sparks.push({ x: 0, y: -R * 0.9, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 1.2 + Math.random() * 2.6, l: 0.7 + Math.random() * 0.6, c: Math.random() < 0.5 ? c : "#fff3b0" }); } };
          function frame(now) {
            if (!ov.isConnected) return;
            if (phase === "spin") {
              const k = Math.min(1, (now - t0) / DUR), e = 1 - Math.pow(1 - k, 4);
              theta = final * e;
              const seg = Math.floor((((theta % TAU) + TAU) % TAU) / A);
              if (seg !== lastSeg) { if (lastSeg >= 0) { flap = -0.55; if (now - lastTick > 28) { wheelTick(); lastTick = now; } } lastSeg = seg; }
              if (k >= 1) { phase = "done"; tEnd = now; theta = final; res.innerHTML = `<b style="color:${tier[1]}">${elo}</b> Elo<small>${tier[0]}</small>`; res.classList.add("pop"); burst(); E.vibrate([20, 30, 40]); zzzSoundWin(); }
            }
            flap += (0 - flap) * 0.22;
            draw(now);
            if (phase === "done" && now - tEnd > (fast ? 700 : 1500)) { ov.classList.add("out"); setTimeout(() => { ov.remove(); done(); }, 320); return; }
            requestAnimationFrame(frame);
          }
          function zzzSoundWin() { try { if (!soundOn()) return; const ac = wheelTick.ac || new (window.AudioContext || window.webkitAudioContext)(); wheelTick.ac = ac; const t = ac.currentTime; [523, 659, 784, 1047].forEach((fq, i) => { const o = ac.createOscillator(), gg = ac.createGain(); o.type = "triangle"; o.frequency.value = fq; gg.gain.setValueAtTime(0.0001, t + i * 0.07); gg.gain.exponentialRampToValueAtTime(0.1, t + i * 0.07 + 0.03); gg.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.07 + 0.6); o.connect(gg); gg.connect(ac.destination); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.65); }); } catch (e) { /* audio indisponible */ } }
          requestAnimationFrame(frame);
          setTimeout(() => { if (ov.isConnected) { ov.remove(); done(); } }, DUR + 6000);        // filet de sécurité (onglet en arrière-plan : requestAnimationFrame est suspendu)
        });
      }
      async function jesterWheel(o, turbo) {
        const seat = G.seats[o], ai = seat.ai, tok = G.token, elo = 1 + Math.floor(Math.random() * 3200);
        G.busy = true; ticker(`🎡 ${seat.name} lance la roue… son Elo se décide avant qu'il joue`);
        await wheelFx(seat.name, elo, turbo || !animOn());
        if (!G || tok !== G.token) return;
        AI.setElo(ai, elo); seat.elo = elo; renderBan(o);
        ticker(`🎡 La roue donne ${elo} Elo à ${seat.name} !`); say(o, elo < 800 ? "wheel_low" : elo < 2400 ? "wheel_mid" : "wheel_high", { elo });
        G.busy = false;
      }

      // ------------------------------------------------------------------ effets
      function boom(sq, type) {
        const fx = $(".ro-fx"), b = document.createElement("i");
        b.className = "boom"; b.textContent = type === C4.K ? "👑" : C4.VALUE[type] >= 5 ? "💥" : "✦"; b.style.width = b.style.height = CELL + "%"; place(b, sq); fx.appendChild(b); setTimeout(() => b.remove(), 700);
        if (C4.VALUE[type] >= 5) { const bd = $("#ro-board"); bd.classList.remove("shake"); void bd.offsetWidth; bd.classList.add("shake"); E.vibrate(C4.VALUE[type] >= 9 ? [30, 30, 60] : 18); }
      }
      function quake() { const bd = $("#ro-board"); bd.classList.remove("quake"); void bd.offsetWidth; bd.classList.add("quake"); }
      function koFx(s) { const b = el.querySelector(`.ro-ban[data-s="${s}"]`); if (b) { b.classList.add("ko"); } }

      // ------------------------------------------------------------------ clic d'un joueur humain
      $("#ro-board").addEventListener("click", (e) => {
        if (!G || G.over || G.paused || G.busy) return;
        const st = G.st, o = st.turn, seat = G.seats[o];
        if (!seat.human) return;
        const r = $("#ro-board").getBoundingClientRect();
        const vx = Math.min(13, Math.max(0, Math.floor((e.clientX - r.left) / r.width * 14))), vy = Math.min(13, Math.max(0, Math.floor((e.clientY - r.top) / r.height * 14)));
        const [x, y] = UNROT[G.view](vx, vy), sq = x + y * 14;
        if (!C4.VALID[sq]) return;
        { const c = G.sqEl[sq]; if (c) { c.classList.remove("tap"); void c.offsetWidth; c.classList.add("tap"); setTimeout(() => c.classList.remove("tap"), 600); } }        // onde au clic
        G.legalMoves = C4.moves(st, o);                                         // toujours à jour (aucune attente de la boucle)
        if (G.sel >= 0 && G.legal.has(sq)) {
          const m = G.legalMoves.find((q) => C4.from(q) === G.sel && C4.to(q) === sq);
          if (m) { apply(m, true); return; }
        }
        const v = st.b[sq];
        if (v && C4.ownerOf(v) === o) { G.sel = sq; G.legal = new Set(G.legalMoves.filter((q) => C4.from(q) === sq).map((q) => C4.to(q))); E.vibrate(6); } else { G.sel = -1; G.legal = new Set(); }
        drawSquares();
      });

      // ------------------------------------------------------------------ fin de partie
      function finish() {
        if (!G || G.over) return;
        G.over = true;
        const st = G.st, rank = C4.ranking(st), win = rank[0];
        const S = stat(); S.games++; const wid = G.seats[win.o].id; if (wid !== "human") S.wins[wid] = (S.wins[wid] || 0) + 1; else S.wins.human = (S.wins.human || 0) + 1; E.settings.set("royale.stats", S);
        hud(); ticker(`👑 ${G.seats[win.o].name} remporte la bataille !`);
        say(win.o, "r_win", {}, "mate_win");
        for (const r of rank.slice(1)) say(r.o, "mate_lose", {});
        E.vibrate([60, 40, 60, 40, 200]);
        const medals = ["🥇", "🥈", "🥉", "4"];
        const box = $("#ro-end");
        setTimeout(() => {
          if (!G || !G.over) return;
          box.innerHTML = `<div class="ro-podium"><h3>👑 BATAILLE TERMINÉE</h3>${rank.map((r, i) => `<div class="ro-pod p${i}" style="--pc:${COLORS[r.o]}"><span class="md">${medals[i]}</span><b>${esc(G.seats[r.o].name)}</b><span class="pt">${r.pts} pts${r.alive ? "" : " · éliminé"}</span></div>`).join("")}
            <div class="row"><button class="btn pri" id="ro-again">↻ REJOUER</button><button class="btn" id="ro-menu">MENU</button></div></div>`;
          box.hidden = false;
          box.querySelector("#ro-again").onclick = () => launch(); box.querySelector("#ro-menu").onclick = () => back();
        }, 1600);
      }
      function back() {
        if (G) { G.token++; G.over = true; }
        E.botChat && E.botChat.unmountAll(); document.documentElement.classList.remove("ghor");
        $("#ro-board").classList.remove("ghorfx"); el.querySelectorAll(".ro-ban").forEach((b) => b.classList.remove("ghorfx", "sleep")); document.querySelectorAll(".ro-wheel,.ro-ghorov").forEach((n) => n.remove());
        $("#ro-game").hidden = true; $("#ro-setup").hidden = false; $("#ro-end").hidden = true; palmares(); fillSeats();
      }
      // coup dicté (ex. « h2 h4 », « h2-h4 », « h2xh4 ») : joue pour le siège au trait
      function playText(txt) {
        if (!G || G.over || !G.seats[G.st.turn].human) return A.toast("Ce n'est pas le tour d'un joueur humain.", "warn");
        const m = /([a-n]\s*\d{1,2})\s*[-x:>→ ]*\s*([a-n]\s*\d{1,2})/i.exec(txt.replace(/\s+/g, " "));
        if (!m) return A.toast("Format : case de départ puis d'arrivée, ex. h2 h4", "warn");
        const f = fromName(m[1].replace(/\s/g, "")), t = fromName(m[2].replace(/\s/g, ""));
        const mv = f >= 0 && t >= 0 ? C4.moves(G.st, G.st.turn).find((q) => C4.from(q) === f && C4.to(q) === t) : null;
        if (!mv) return A.toast(`Coup impossible pour ${G.seats[G.st.turn].name} : ${m[1]} → ${m[2]}`, "warn");
        apply(mv, true);
      }
      $("#ro-say").onsubmit = (e) => { e.preventDefault(); const i = $("#ro-sayin"); if (i.value.trim()) { playText(i.value); i.value = ""; } };
      // image du plateau (à envoyer à l'ami dans l'appel / le groupe) : cases nommées, pièces du joueur au trait entourées, + liste de ses coups
      function boardImage() {
        const SZ = 840, c = document.createElement("canvas"), g2 = c.getContext("2d"), cs = SZ / 14, st = G.st, o = st.turn;
        c.width = c.height = SZ; g2.fillStyle = "#0a0a0c"; g2.fillRect(0, 0, SZ, SZ);
        const imgs = {};
        const load = (src) => imgs[src] || (imgs[src] = new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; }));
        const FILTER = ["drop-shadow(0 0 3px #ff3b4f)", "sepia(1) saturate(2.4) drop-shadow(0 0 3px #ffc34a)", "hue-rotate(150deg) saturate(2.4) drop-shadow(0 0 3px #1acfd6)", "brightness(2.1) drop-shadow(0 0 3px #8be04d)"];
        return (async () => {
          for (let i = 0; i < C4.SQ; i++) {
            if (!C4.VALID[i]) continue;
            const [x, y] = C4.XY(i), [vx, vy] = ROT[G.view](x, y), out = !C4.playable(st, x, y);
            g2.fillStyle = out ? "#3d0a10" : (x + y) % 2 ? "#6f8a5c" : "#e4e6d4"; g2.fillRect(vx * cs, vy * cs, cs, cs);
            g2.font = "bold 11px sans-serif"; g2.fillStyle = "#0008";
            if (vy === 13 || !C4.VALID[UNROT[G.view](vx, vy + 1 > 13 ? 13 : vy + 1)[0] + UNROT[G.view](vx, Math.min(13, vy + 1))[1] * 14] || vy === 13) g2.fillText(FILES[vx], vx * cs + cs - 11, vy * cs + cs - 4);
          }
          for (let i = 0; i < C4.SQ; i++) {
            const v = st.b[i]; if (!v) continue;
            const [x, y] = C4.XY(i), [vx, vy] = ROT[G.view](x, y), ow = C4.ownerOf(v);
            if (ow === o) { g2.strokeStyle = COLORS[o]; g2.lineWidth = 4; g2.strokeRect(vx * cs + 3, vy * cs + 3, cs - 6, cs - 6); }
            const im = await load(spriteOf(v));
            if (im) { g2.save(); g2.filter = FILTER[ow]; g2.drawImage(im, vx * cs, vy * cs, cs, cs); g2.restore(); }
          }
          g2.fillStyle = "#000a"; g2.fillRect(0, 0, SZ, 34); g2.fillStyle = COLORS[o]; g2.font = "bold 20px sans-serif"; g2.fillText(`Tour de ${G.seats[o].name} (${SEAT[o]})`, 10, 24);
          return c.toDataURL("image/png");
        })();
      }
      function movesText() {
        const st = G.st, o = st.turn, by = {};
        for (const m of C4.moves(st, o)) (by[C4.from(m)] = by[C4.from(m)] || []).push(sqName(C4.to(m)));
        const N = ["", "pion", "cavalier", "fou", "tour", "dame", "roi"];
        return Object.entries(by).map(([f, l]) => `${N[C4.typeOf(st.b[+f])]} ${sqName(+f)} → ${l.join(" ")}`).join("\n");
      }
      $("#ro-share").onclick = async () => {
        if (!G) return;
        const url = await boardImage(), txt = movesText();
        E.ui.sheet({ title: `Plateau · tour de ${G.seats[G.st.turn].name}`, html: `<img src="${url}" style="width:100%;border-radius:10px;margin-bottom:10px" alt="plateau"><p class="muted" style="font-size:13px;margin-bottom:8px">Enregistre / capture cette image et envoie-la à ton ami, puis entre le coup qu'il te dicte (ex. <b>h2 h4</b>).</p>`,
          options: [{ label: "COPIER LA LISTE DES COUPS", fn: () => A.copy(txt) }, { label: "TÉLÉCHARGER L'IMAGE", fn: () => { const a = document.createElement("a"); a.href = url; a.download = "plateau-royale.png"; a.click(); } }, { label: "FERMER" }] });
      };
      // ↶ revient au dernier tour d'un joueur humain (ou d'un coup en arrière s'il n'y en a pas)
      function undo() {
        if (!G || !G.hist.length || !G.seats.some((x) => x.human)) return;
        let snap = null;
        while (G.hist.length) { snap = G.hist.pop(); if (G.seats[snap.turn].human) break; }
        if (!snap) return;
        G.st = snap; G.over = false; G.sel = -1; G.legal = new Set(); G.token++;
        $("#ro-end").hidden = true; buildBoard(); drawSquares(); hud(); ticker("↶ Coup annulé"); E.vibrate(10);
        loop(G.token);
      }
      $("#ro-undo").onclick = undo;
      $("#ro-back").onclick = back;
      $("#ro-redo").onclick = () => { if (G) launch(); };
      $("#ro-pause").onclick = () => { if (!G) return; G.paused = !G.paused; $("#ro-pause").textContent = G.paused ? "▶ REPRENDRE" : "⏸ PAUSE"; };
      $("#ro-spd").onclick = () => { if (!G) return; const k = Object.keys(SPEEDS); G.speed = k[(k.indexOf(G.speed) + 1) % k.length]; cfg.speed = G.speed; save(); $("#ro-spd").textContent = "VITESSE : " + ({ slow: "LENTE", normal: "NORMALE", fast: "RAPIDE", turbo: "TURBO" }[G.speed]); };
      $("#ro-start").onclick = () => launch();
      document.addEventListener("keydown", (e) => {
        if (!G || $("#ro-game").hidden || el.closest("[hidden]") || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName || "")) return;
        if (e.key === " ") { e.preventDefault(); $("#ro-pause").click(); } else if (e.key === "Escape") { e.stopPropagation(); back(); }
      });

      // ------------------------------------------------------------------ académie : évolution des stratégies
      const describe = (persona, w) => {
        const d = AI.defaultWeights(persona), diff = AI.KEYS.map((k) => [k, w[k] / d[k]]).filter(([, r]) => Math.abs(Math.log(r)) > 0.2).sort((a, b) => Math.abs(Math.log(b[1])) - Math.abs(Math.log(a[1]))).slice(0, 3);
        return diff.length ? diff.map(([k, r]) => (r > 1 ? "↑ " : "↓ ") + WLAB[k]).join(" · ") : "stratégie de départ";
      };
      function tlog() {
        const L = learned();
        $("#ro-tlog").innerHTML = PERSONAS.filter((p) => p !== "naskolit" || true).map((p) => { const x = L[p]; return `<div class="ro-tl"><b>${esc(pname(p))}</b><span>${x ? `génération ${x.gens} · ${describe(p, x.w)}` : "pas encore entraîné"}</span></div>`; }).join("");
      }
      $("#ro-train-btn").onclick = () => { const t = $("#ro-train"); t.hidden = !t.hidden; tlog(); };
      $("#ro-treset").onclick = () => { if (training) return; E.settings.set("royale.learned", {}); tlog(); A.toast("Stratégies réinitialisées.", "ok"); };
      $("#ro-tstop").onclick = () => { if (training) training.stop = true; };
      $("#ro-tgo").onclick = async () => {
        if (training) return;
        const gens = +$("#ro-gens").value, games = +$("#ro-ggames").value;
        training = { stop: false };
        $("#ro-tgo").hidden = true; $("#ro-tstop").hidden = false;
        if (E.native && E.native.keepAlive) E.native.keepAlive(true, "Entraînement des bots (Battle Royale ×4)");
        const L = learned(), total = gens * PERSONAS.length;
        let done = 0, acc = 0;
        try {
          for (let g = 1; g <= gens && !training.stop; g++) {
            for (const p of PERSONAS) {
              if (training.stop) break;
              const cur = (L[p] && L[p].w) || AI.defaultWeights(p);
              const r = await AI.evolve(p, cur, { games, maxPlies: 150, shouldStop: () => training.stop });
              L[p] = { w: r.w, gens: ((L[p] && L[p].gens) || 0) + (r.played ? 1 : 0), updated: Date.now() };
              if (r.accepted) acc++;
              done++;
              $("#ro-tbar").style.width = Math.round(done / total * 100) + "%";
              $("#ro-tstat").textContent = `gén. ${g}/${gens} · ${acc} améliorations`;
              if (done % PERSONAS.length === 0) { E.settings.set("royale.learned", L); tlog(); }
            }
          }
        } catch (e) { A.toast("Entraînement interrompu : " + e.message, "warn"); }
        E.settings.set("royale.learned", L); tlog();
        training = null; $("#ro-tgo").hidden = false; $("#ro-tstop").hidden = true;
        if (E.native && E.native.keepAlive) E.native.keepAlive(false, "");
        A.toast("Entraînement terminé : coche « Bots entraînés » pour les utiliser.", "ok", 5000);
      };

      el._api = { moveFx, badge, putToSleep, napSkip, wheelFx, retargeted, rebuild() { buildBoard(); drawSquares(); hud(); }, launch, get g() { return G; }, cfg: () => cfg, back, apply: (m) => apply(m, false), ghorTransform, minorNeed: (s) => minorNeed(s), judged, renderBan, setDuo, duoMode };
      fillSeats(); palmares();
    },
  });
  /** Ouvre le Battle Royale ×4 avec un préréglage (0 = 1v1v1v1, 1 = 2v2 opposés, 2 = 2v2 voisins) : appelé par les modes de l'Arène. */
  E.royale = { open(i) { E.settings.set("royale.pending", i); if (E.suite && E.suite.open && !document.getElementById("tabs")) E.suite.open("royale"); else { location.hash = "#royale"; location.reload(); } } };
})();
