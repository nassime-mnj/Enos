"use strict";
// DÉFIS : tous les modes de CHESS (PC) sur le téléphone, sans PC. Le moteur (Stockfish.js dans un Worker) joue, juge chaque coup et ETO hunte les sacrifices.
//   ✦ ETO Brillant  · Défi E.N.O.S. (niveau réglable) · Cours avec ETO (un bot + coach) · Speedrun (ETO vs bot) · Choc des Titans (E.N.O.S. vs ETO) · Boss final (Stockfish)
// Chaque coup reçoit un jugement (Brillant … Gaffe) calculé comme sur le PC (chess_brain.js). Tout est local.
(() => {
  const E = window.ENOS, esc = E.esc;
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const COL = { brilliant: "#1acfd6", book: "#a8896c", best: "#7bd64d", excellent: "#9ecc38", good: "#739e66", inaccuracy: "#f5c542", mistake: "#f5a524", blunder: "#ff4d63" };
  const powerOfElo = (e) => Math.max(1, Math.min(100, Math.round(e <= 1500 ? 1 + (e - 250) / 1250 * 49 : 50 + (e - 1500) / 1700 * 50)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ELOS = [400, 600, 800, 1000, 1200, 1500, 1800, 2200, 2600, 3200];

  const MODES = [
    { id: "brillant", t: "✦ ETO Brillant", s: "3200 Elo · il cherche le sacrifice !!", human: true },
    { id: "enos", t: "Défi E.N.O.S.", s: "Ton niveau, de 250 à 3200 Elo", human: true },
    { id: "coach", t: "Cours avec ETO", s: "Toi contre un bot · ETO commente", human: true },
    { id: "speedrun", t: "Speedrun", s: "ETO contre un bot", human: false },
    { id: "titans", t: "⚔ Choc des Titans", s: "E.N.O.S. contre ETO", human: false, duel: true },
    { id: "boss", t: "👑 Boss final", s: "Stockfish plein régime", human: false },
    { id: "nasko", t: "🎭 Nasko", s: "Le bot qui joue comme La_Loi_De_Fortes", human: true, style: true },
    { id: "lelex", t: "🎭 Lelex", s: "Le bot qui joue comme Lepoissonsteve80", human: true, style: true },
    { id: "penoire", t: "🎭 Nasko (pénoire)", s: "2500 Elo · chasseur de brillants !!", human: true },
    { id: "naskurieux", t: "🕶 Naskurieux", s: "GM à 1 Elo · +200 Elo par erreur adverse ou meilleur coup", human: true },
    { id: "ghorghor", t: "👁 GhorGhor", s: "1400 Elo… tant qu'il garde ses pièces", human: true },
    { id: "combat", t: "⚔ Combat de bots", s: "Nasko vs Pénoire, Lelex vs ETO… tu choisis", human: false, duel: true },
    { id: "ebe", t: "✦ ETO Brillant vs E.N.O.S.", s: "Combat spectateur · enregistré", human: false, duel: true },
    { id: "ebs", t: "✦ ETO Brillant vs Stockfish", s: "Combat spectateur · enregistré", human: false, duel: true },
    { id: "ebd", t: "✦ ETO Brillant + E.N.O.S. vs Stockfish", s: "Duo contre le boss · enregistré", human: false, duel: true },
  ];

  const TAUNT = {
    brilliant: ["%s sacrifie sans trembler… ça va faire mal.", "Un sacrifice ! %s voit plus loin que tout le monde.", "!! %s sort la pièce que personne n'attendait."],
    blunder: ["%s vient de gaffer. Je ne dis rien. Si, je dis tout.", "Aïe : %s offre la partie sur un plateau.", "Erreur grave de %s. Ça se paie."],
    mistake: ["%s lâche un peu de terrain.", "Pas terrible, ce coup de %s."],
    mate: ["Mat. Fin de la discussion.", "C'est plié : échec et mat."],
    draw: ["Nulle. Personne ne gagne, tout le monde a appris."],
    best: ["Le coup juste, sans bavure.", "Précis."],
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  E.suite.register({
    id: "defis", group: "chess", title: "Défis", sub: "ETO, E.N.O.S., Titans, Boss",
    icon: '<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M14.5 6.5L18 3h3v3l-3.5 3.5M5 14l4 4"/>',
    build(el, A) {
      const B = E.board, K = E.brain, L = E.chessLocal, $ = (s) => el.querySelector(s);
      const name = (who) => (who === "eto" ? "ETO" : who === "enos" ? "E.N.O.S." : who);
      let g = null;                                                        // partie en cours
      let STY = window.ENOS_STYLE || null;                                  // profils de style (data/style_bots.js)
      const ALIEN = { "": "e2e4", "e2e4 c7c6": "d2d4", "e2e4 c7c6 d2d4 d7d5": "b1c3", "e2e4 c7c6 d2d4 d7d5 b1c3 d5e4": "c3e4", "e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 g8f6": "e4g5",
        "e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 g8f6 e4g5 h7h6": "g5f7" };
      if (!STY) { const sc = document.createElement("script"); sc.src = (E.assetBase || "") + "data/style_bots.js"; sc.onload = () => { STY = window.ENOS_STYLE; }; document.head.appendChild(sc); }

      // combattants : modèle de joueur (talk = personnage qui parle dans la chat box)
      const eloOf = (id) => (STY && STY[id] ? STY[id].eloEst : 1000);
      const FIGHT = {
        nasko: () => ({ kind: "style", style: "nasko", elo: eloOf("nasko"), name: "Nasko", talk: "nasko" }),
        penoire: () => ({ kind: "penoire", elo: 2500, name: "Nasko (pénoire)", talk: "penoire" }),
        lelex: () => ({ kind: "style", style: "lelex", elo: eloOf("lelex"), name: "Lelex", talk: "lelex" }),
        eto: () => ({ kind: "eto", elo: 3200, name: "ETO Brillant", talk: "eto" }),
        enos: () => ({ kind: "sf", elo: 3200, power: 100, name: "E.N.O.S.", talk: "enos" }),
        stockfish: () => ({ kind: "sf", elo: 3200, power: 100, pure: true, name: "Stockfish" }),
        naskurieux: () => ({ kind: "sf", elo: 1, name: "Naskurieux", talk: "naskurieux", title: "GM", gain: true }),       // GM à 1 Elo : +200 à chaque inexactitude / erreur / gaffe de l'adversaire
        ghorghor: () => ({ kind: "style", style: "lelex", elo: 1400, skill: { mistake: 0.12, blunder: 0.05 }, name: "GhorGhor", talk: "ghorghor", transform: true }),   // style Lelex ; 3 pièces mineures perdues -> GhorGhor le vrai
      };
      const FIGHT_HUMAN = ["nasko", "lelex", "penoire", "naskurieux", "ghorghor"];
      const tt = (p) => (E.botChat && p && p.elo ? E.botChat.titleOf(p.elo, p.title) : "");
      const tbadge = (p) => (E.botChat ? E.botChat.badge(tt(p)) : "");
      const FIGHT_NAMES = { nasko: "Nasko", penoire: "Nasko (pénoire)", lelex: "Lelex", ghorghor: "GhorGhor", naskurieux: "Naskurieux", eto: "ETO Brillant", enos: "E.N.O.S.", stockfish: "Stockfish" };
      const PRESETS = [["nasko", "penoire", "Nasko vs Pénoire"], ["lelex", "eto", "Lelex vs ETO Brillant"], ["penoire", "eto", "Pénoire vs ETO Brillant"], ["lelex", "penoire", "Lelex vs Pénoire"], ["nasko", "lelex", "Nasko vs Lelex"],
        ["penoire", "enos", "Pénoire vs E.N.O.S."], ["naskurieux", "penoire", "Naskurieux vs Pénoire"], ["ghorghor", "eto", "GhorGhor vs ETO Brillant"], ["ghorghor", "nasko", "GhorGhor vs Nasko"], ["nasko", "nasko", "Nasko vs Nasko"], ["penoire", "penoire", "Pénoire vs Pénoire"], ["eto", "stockfish", "ETO Brillant vs Stockfish"]];

      el.innerHTML = `
        <div id="df-home">
          <div class="card"><h3>Choisis ton défi</h3><div class="df-modes">${MODES.map((m) => `<button class="df-mode" data-m="${m.id}"><b>${m.t}</b><small>${m.s}</small></button>`).join("")}</div>
            <p class="muted" style="font-size:12.5px;margin-top:10px">Chaque coup est jugé (Brillant, Meilleur, Gaffe…) comme sur le PC. Aucun ordinateur nécessaire.</p></div>
          <div class="card"><h3>Parties récentes<span class="sp" id="df-hn"></span></h3><div id="df-hist" class="list"></div></div>
        </div>
        <div id="df-game" hidden>
          <button class="back" id="df-back" style="margin-bottom:8px">◂ DÉFIS</button>
          <div class="card" style="padding:12px">
            <div id="df-botchat" hidden></div>
            <div id="df-botlog" hidden></div>
            <div class="df-pl" id="df-top"></div>
            <div class="ch-evalbar"><i id="df-eval"></i><b id="df-evt">0,0</b></div>
            <div id="df-board"></div>
            <div class="df-pl" id="df-bot"></div>
            <div id="df-botchat2" hidden></div>
            <div class="df-judge" id="df-judge" hidden></div>
            <div class="ch-say" id="df-say" hidden></div>
            <div class="ch-moves" id="df-moves"></div>
            <div class="ch-top" style="margin-top:6px"><span id="df-status" class="muted"></span></div>
            <div class="row" id="df-btns"></div>
          </div>
        </div>`;

      // ------------------------------------------------------------------ accueil
      const hist = () => E.settings.get("defi.hist", []);
      function paintHist() {
        const h = hist().slice().reverse();
        $("#df-hn").textContent = h.length ? h.length + " partie" + (h.length > 1 ? "s" : "") : "";
        $("#df-hist").innerHTML = h.length ? h.map((x, i) => `<div class="it"><span class="n">${esc(x.title)}<small>${esc(x.result)} · ${x.plies} coups · ✦ ${x.brill} brillant${x.brill > 1 ? "s" : ""}${x.acc != null ? " · précision " + x.acc + " %" : ""} · ${new Date(x.t).toLocaleDateString("fr-FR")}</small></span>${x.mv ? `<button class="mini" data-rev="${h.length - 1 - i}">▶ REVOIR</button>` : ""}<button class="mini" data-pgn="${h.length - 1 - i}">PGN</button></div>`).join("") : '<p class="muted">Aucune partie pour l\'instant.</p>';
      }
      $("#df-hist").onclick = (e) => {
        const r = e.target.closest("[data-rev]"); if (r) return replay(hist()[+r.dataset.rev]);
        const b = e.target.closest("[data-pgn]"); if (b) A.copy(hist()[+b.dataset.pgn].pgn || "");
      };
      el.querySelectorAll(".df-mode").forEach((b) => (b.onclick = () => setup(b.dataset.m)));

      function setup(id) {
        const m = MODES.find((x) => x.id === id);
        let color = "w", elo = E.settings.get("defi.elo", 1200), pow = E.settings.get("chess.power", 55), boss = "eto";
        const colorSeg = `<div class="seg" id="su-col" style="margin-bottom:14px"><button data-c="w" class="on">BLANCS</button><button data-c="b">NOIRS</button><button data-c="r">AU HASARD</button><i class="seg-ind"></i></div>`;
        let body = "";
        if (id === "brillant") body = `<p class="muted" style="margin-bottom:12px;line-height:1.5">ETO joue à 3200 Elo et <b>cherche chaque sacrifice gagnant</b> pour le jouer. Essaie de faire aussi bien : un sacrifice qui garde l'avantage est un coup <b style="color:#1acfd6">brillant !!</b></p>` + colorSeg;
        else if (id === "enos") body = colorSeg + `<label class="fld">Puissance d'E.N.O.S. <b id="su-pe"></b></label><input type="range" id="su-pw" min="1" max="100" value="${pow}" style="width:100%;accent-color:var(--red);margin-bottom:8px">`;
        else if (id === "coach") body = colorSeg + `<label class="fld">Niveau du bot</label><select id="su-elo" class="sel">${ELOS.map((e) => `<option value="${e}" ${e === elo ? "selected" : ""}>Bot ${e} Elo</option>`).join("")}</select>`;
        else if (id === "speedrun") body = `<label class="fld">Niveau du bot</label><select id="su-elo" class="sel">${ELOS.map((e) => `<option value="${e}" ${e === elo ? "selected" : ""}>Bot ${e} Elo</option>`).join("")}</select>`;
        else if (id === "titans") body = `<p class="muted" style="line-height:1.5">Spectacle : E.N.O.S. (Stockfish pur) joue les Blancs, ETO (chasseur de sacrifices) les Noirs. Ils se répondent en direct.</p>`;
        else if (id === "penoire") body = `<p class="muted" style="margin-bottom:12px;line-height:1.5">La version <b>pénoire</b> de Nasko : <b>2500 Elo</b>, il <b style="color:#1acfd6">cherche chaque sacrifice brillant !!</b> comme ETO, ne répète jamais et ne t'épargne pas… Il a toujours un mot pour toi à la fin.</p>` + colorSeg;
        else if (id === "naskurieux") body = `<p class="muted" style="margin-bottom:12px;line-height:1.5">L'agent <b>Naskurieux</b> est <b>Grand Maître</b>… mais il démarre à <b>1 Elo</b>. À chaque <b>imprécision, erreur ou gaffe</b> de ton adversaire il gagne <b style="color:#1acfd6">+200 Elo</b>, et autant <b>chaque fois qu'il joue lui-même le meilleur coup</b>. Il joue de mieux en mieux : ne lui fais aucun cadeau.</p>` + colorSeg;
        else if (id === "ghorghor") body = `<p class="muted" style="margin-bottom:12px;line-height:1.5"><b>GhorGhor</b> joue comme Lelex, niveau <b>1400</b>. Mais s'il perd <b>plus de 2 pièces mineures</b> (cavaliers, fous)… quelque chose se réveille.</p>` + colorSeg;
        else if (id === "combat") {
          const opt = (v) => Object.entries(FIGHT_NAMES).map(([k, n]) => `<option value="${k}" ${k === v ? "selected" : ""}>${n}</option>`).join(""), last = E.settings.get("defi.combat", ["nasko", "penoire"]);
          body = `<p class="muted" style="margin-bottom:10px;line-height:1.5">Spectacle : choisis les deux combattants, ils se parlent pendant la partie (chat), s'affrontent à fond et la partie est <b>enregistrée</b> pour le replay.</p>
            <div class="df-presets">${PRESETS.map((p, i) => `<button data-p="${i}">${p[2]}</button>`).join("")}</div>
            <div class="df-pick"><label>Blancs<select id="su-cw" class="sel">${opt(last[0])}</select></label><label>Noirs<select id="su-cb" class="sel">${opt(last[1])}</select></label></div>`;
        }
        else if (m.style) body = `<p class="muted" style="margin-bottom:12px;line-height:1.5">${m.t.slice(3)} reprend <b>les ouvertures</b>, <b>le niveau</b> et <b>la fréquence d'erreurs</b> mesurés sur ses vraies parties Chess.com (${STY && STY[id] ? STY[id].games + " parties analysées, " + STY[id].skill.acpl + " cp de perte moyenne" : "profil en chargement"}). Il tombe dans les mêmes pièges que lui${id === "nasko" ? " et sort le Gambit Alien contre la Caro-Kann" : ""}.</p>` + colorSeg;
        else if (m.duel && id !== "titans") body = `<p class="muted" style="margin-bottom:12px;line-height:1.5">Match spectateur, 3200 Elo de chaque côté. La partie est <b>enregistrée en entier</b> : tu pourras la revoir coup par coup, avec les mêmes jugements et accélérer la lecture.</p><label class="fld">Camp d'${id === "ebd" ? "ETO + E.N.O.S." : "ETO Brillant"}</label>` + colorSeg;
        else if (id === "boss") body = `<label class="fld">Qui affronte le boss ?</label><select id="su-boss" class="sel"><option value="eto">ETO vs Stockfish</option><option value="enos">E.N.O.S. vs Stockfish</option><option value="duo">E.N.O.S. + ETO vs Stockfish</option></select>`;
        const s = E.ui.sheet({ title: m.t, html: body, options: [{ label: "COMMENCER", cls: "pri", fn: () => {
          if (id === "enos") E.settings.set("chess.power", pow);
          if (s.querySelector("#su-elo")) { elo = +s.querySelector("#su-elo").value; E.settings.set("defi.elo", elo); }
          if (s.querySelector("#su-boss")) boss = s.querySelector("#su-boss").value;
          let cw, cb;
          if (s.querySelector("#su-cw")) { cw = s.querySelector("#su-cw").value; cb = s.querySelector("#su-cb").value; E.settings.set("defi.combat", [cw, cb]); }
          const c = color === "r" ? (Math.random() < 0.5 ? "w" : "b") : color;
          launch(id, { color: c, elo, pow, boss, cw, cb });
        } }, { label: "ANNULER" }] });
        const seg = s.querySelector("#su-col");
        if (seg) seg.querySelectorAll("button").forEach((b) => (b.onclick = () => { color = b.dataset.c; seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); }));
        s.querySelectorAll(".df-presets button").forEach((b) => (b.onclick = () => { const p = PRESETS[+b.dataset.p]; s.querySelector("#su-cw").value = p[0]; s.querySelector("#su-cb").value = p[1]; E.vibrate(8); }));
        const pw = s.querySelector("#su-pw");
        if (pw) { const u = () => { pow = +pw.value; s.querySelector("#su-pe").textContent = B.powerToElo(pow) + " Elo"; }; pw.oninput = u; u(); }
      }

      // ------------------------------------------------------------------ partie
      function players(id, o) {
        const hu = { human: true, name: "Toi" };
        if (FIGHT_HUMAN.includes(id)) { const op = FIGHT[id](); return o.color === "w" ? [hu, op] : [op, hu]; }
        if (id === "combat") { const a = FIGHT[o.cw || "nasko"](), b = FIGHT[o.cb || "penoire"](); if (o.cw === o.cb) { a.name += " (Blancs)"; b.name += " (Noirs)"; } return [a, b]; }
        if (id === "brillant") return o.color === "w" ? [hu, { kind: "eto", elo: 3200, name: "ETO Brillant" }] : [{ kind: "eto", elo: 3200, name: "ETO Brillant" }, hu];
        if (id === "enos") { const op = { kind: "sf", elo: B.powerToElo(o.pow), power: o.pow, name: "E.N.O.S." }; return o.color === "w" ? [hu, op] : [op, hu]; }
        if (id === "coach") { const op = { kind: "sf", elo: o.elo, power: powerOfElo(o.elo), name: "Bot " + o.elo }; return o.color === "w" ? [hu, op] : [op, hu]; }
        if (id === "speedrun") return [{ kind: "eto", elo: 3200, name: "ETO" }, { kind: "sf", elo: o.elo, power: powerOfElo(o.elo), name: "Bot " + o.elo }];
        if (id === "titans") return [{ kind: "sf", elo: 3200, power: 100, name: "E.N.O.S." }, { kind: "eto", elo: 3200, name: "ETO" }];
        const boss = { kind: "sf", elo: 3200, power: 100, name: "Stockfish" };
        const ch = o.boss === "duo" ? { kind: "duo", elo: 3200, power: 100, name: "E.N.O.S. + ETO" } : o.boss === "enos" ? { kind: "sf", elo: 3200, power: 100, name: "E.N.O.S." } : { kind: "eto", elo: 3200, name: "ETO" };
        const EB = { kind: "eto", elo: 3200, name: "ETO Brillant" }, EN = { kind: "sf", elo: 3200, power: 100, name: "E.N.O.S." }, duo = { kind: "duo", elo: 3200, power: 100, name: "ETO Brillant + E.N.O.S." };
        if (id === "ebe" || id === "ebs" || id === "ebd") { const a = id === "ebd" ? duo : EB, b = id === "ebe" ? EN : boss; return o.color === "b" ? [b, a] : [a, b]; }
        return [ch, boss];
      }

      function launch(id, o) {
        const m = MODES.find((x) => x.id === id), pl = players(id, o);
        if (g) g.token++;
        const me = m.human ? (pl[0].human ? "w" : "b") : null;
        g = { id, mode: m, pl: { w: pl[0], b: pl[1] }, me, token: (g ? g.token : 0) + 1, ch: new Chess(), fen: START, evalW: 0, bestUci: "", moves: [], snaps: [], over: "", busy: false, paused: false, sel: "", hint: null, last: null,
          brill: { w: 0, b: 0 }, inBook: true, seen: L.startSeen(START), talk: {}, fr: {}, wn: {}, lostMinor: { w: 0, b: 0 }, flip: me === "b", delay: id === "speedrun" ? 250 : id === "boss" || id === "ebs" || id === "ebd" ? 700 : 900, o, started: Date.now(), sayN: 0, duoTurn: 0 };
        g.ch.header("Event", m.t.replace(/[^\p{L}\p{N} .]/gu, "").trim(), "White", pl[0].name, "Black", pl[1].name, "Date", new Date().toISOString().slice(0, 10).replace(/-/g, "."));
        $("#df-home").hidden = true; $("#df-game").hidden = false;
        document.documentElement.classList.remove("ghor");
        $("#df-judge").hidden = true; $("#df-say").hidden = true; $("#df-moves").innerHTML = "";
        K.loadBook().then((ok) => { if (!ok && g) g.inBook = false; });
        chatSetup();
        buttons(); paint();
        const tok = g.token;
        (async () => {
          if (id === "combat") await vsIntro(tok);                       // écran « VS » : les deux combattants entrent
          if (!g || tok !== g.token) return;
          Object.values(g.talk).forEach((I, i) => setTimeout(() => { if (g && tok === g.token) I.say("greet"); }, 300 + i * 1500));
          next(tok);
        })();
      }
      // résumé de la partie donné au LLM d'un personnage (une phrase)
      const chatCtx = (c) => g ? { summary: `coups joués : ${g.moves.slice(-8).map((m) => m.san).join(" ") || "aucun"} ; évaluation ${(g.evalW / 100).toFixed(1)} (positif = avantage Blancs) ; tu as les ${c === "w" ? "Blancs" : "Noirs"}` } : {};
      // personnages qui parlent : un seul bot (face à toi) avec historique + saisie, ou deux combattants avec transcript partagé
      function chatSetup() {
        const bc = E.botChat;
        if (!bc) return;
        bc.unmountAll(); g.talk = {};
        const opp = (c) => () => { const n = g.pl[c === "w" ? "b" : "w"].name; return n === "Toi" ? ((E.userName && E.userName()) || E.ai.name() || "toi") : n; };
        if (g.mode.human) {
          const c = g.pl.w.human ? "b" : "w", p = g.pl[c];
          if (p.talk && bc.has(p.talk)) g.talk[c] = bc.mount($("#df-botchat"), p.talk, { opp: opp(c), ctx: () => chatCtx(c), log: true });
        } else {
          const top = g.flip ? "w" : "b", bot = top === "w" ? "b" : "w";
          if ([top, bot].some((c) => g.pl[c].talk && bc.has(g.pl[c].talk))) bc.mountTranscript($("#df-botlog"));
          [[top, "#df-botchat"], [bot, "#df-botchat2"]].forEach(([c, h]) => { const p = g.pl[c]; if (p.talk && bc.has(p.talk)) g.talk[c] = bc.mount($(h), p.talk, { opp: opp(c), ctx: () => chatCtx(c), shared: true }); });
        }
      }
      function vsAvatar(p) { return p.talk && E.botChat ? E.botChat.avatar(p.talk) : `<div class="bot-av ph" style="--c:#8d8d97">SF</div>`; }
      async function vsIntro(tok) {
        const o = document.createElement("div");
        o.className = "df-vs";
        o.innerHTML = `<div class="row2"><div class="vp l">${vsAvatar(g.pl.w)}<span>${tbadge(g.pl.w)}${esc(g.pl.w.name)}</span><small>${g.pl.w.elo} Elo · Blancs</small></div><div class="vs">VS</div><div class="vp r">${vsAvatar(g.pl.b)}<span>${tbadge(g.pl.b)}${esc(g.pl.b.name)}</span><small>${g.pl.b.elo} Elo · Noirs</small></div></div><div class="go">PRÉPAREZ-VOUS</div>`;
        document.body.appendChild(o);
        E.vibrate([20, 40, 20]);
        await new Promise((res) => { const t = setTimeout(res, 2600); o.onclick = () => { clearTimeout(t); res(); }; });
        o.remove();
      }

      const sideName = (c) => g.pl[c].name;
      function buttons() {
        const h = g.mode.human;
        $("#df-btns").innerHTML = h
          ? `<button class="btn" id="b-undo">ANNULER</button>${g.id === "coach" ? '<button class="btn" id="b-hint">INDICE</button>' : ""}<button class="btn" id="b-flip">RETOURNER</button><button class="btn" id="b-res">ABANDONNER</button>`
          : `<button class="btn" id="b-pause">⏸ PAUSE</button><button class="btn" id="b-flip">RETOURNER</button><button class="btn" id="b-stop">ARRÊTER</button>`;
        const on = (id, f) => { const b = $("#" + id); if (b) b.onclick = f; };
        on("b-flip", () => { g.flip = !g.flip; paint(); });
        on("b-undo", undo); on("b-hint", hint); on("b-res", resign);
        on("b-pause", () => { g.paused = !g.paused; $("#b-pause").textContent = g.paused ? "▶ REPRENDRE" : "⏸ PAUSE"; if (!g.paused) next(g.token); });
        on("b-stop", () => { g.token++; finish("Partie arrêtée", true); });
      }
      const backHome = () => { if (g) { g.token++; L.abort && L.abort(); } if (E.botChat) E.botChat.unmountAll(); document.documentElement.classList.remove("ghor"); $("#df-game").hidden = true; $("#df-home").hidden = false; paintHist(); };
      $("#df-back").onclick = backHome;

      function paint(anim) {
        const pos = B.parse(g.fen), turn = pos.turn;
        const targets = g.sel ? new Chess(g.fen).moves({ square: g.sel, verbose: true }).map((m) => m.to) : [];
        B.render($("#df-board"), pos.m, { flip: g.flip, last: g.last, hint: g.hint, sel: g.sel, targets, check: g.ch.in_check() ? B.kingSquare(pos.m, turn) : "", badge: (() => { const m = g.moves[g.moves.length - 1]; return m && m.uci && m.q && B.BADGES[m.q.key] ? { sq: m.uci.slice(2, 4), key: m.q.key, id: g.moves.length } : null; })(), end: g.ch.in_checkmate() ? { sq: B.kingSquare(pos.m, turn), id: g.moves.length } : null, onTap, anim });
        const strip = (c) => `<span class="df-dot ${c}"></span>${tbadge(g.pl[c])}<b>${esc(sideName(c))}</b><small>${g.pl[c].elo ? g.pl[c].elo + " Elo" : ""}</small><span class="df-br" title="Coups brillants">✦ ${g.brill[c]}</span>`;
        const top = g.flip ? "w" : "b", bot = g.flip ? "b" : "w";
        $("#df-top").innerHTML = strip(top); $("#df-bot").innerHTML = strip(bot);
        const w = Math.abs(g.evalW) >= 9000 ? (g.evalW > 0 ? 100 : 0) : B.winPct(g.evalW);
        $("#df-eval").style.setProperty("--w", (g.flip ? 100 - w : w) + "%");
        $("#df-evt").textContent = Math.abs(g.evalW) >= 9000 ? "MAT" : (g.evalW / 100 * (g.flip ? -1 : 1)).toFixed(1).replace(".", ",").replace(/^(\d)/, "+$1");
        $("#df-moves").innerHTML = g.moves.map((m, i) => `<span style="${m.q.key === "brilliant" || m.q.key === "blunder" || m.q.key === "mistake" ? "color:" + COL[m.q.key] : ""}">${i % 2 === 0 ? (i / 2 + 1) + "." : ""}${esc(m.san)}${m.q.key === "brilliant" ? "!!" : m.q.key === "blunder" ? "??" : m.q.key === "mistake" ? "?" : ""}</span>`).join("");
        $("#df-moves").scrollLeft = 1e5;
      }
      const status = (t) => { $("#df-status").textContent = t; };

      // ---- entrée du joueur
      function onTap(sq) {
        if (!g || g.over || g.busy || g.paused || g.pl[g.ch.turn()].human !== true) return;
        const turn = g.ch.turn();
        if (g.sel && g.ch.moves({ square: g.sel, verbose: true }).some((m) => m.to === sq)) return humanMove(g.sel, sq);
        const p = g.ch.get(sq);
        g.sel = p && p.color === turn ? sq : ""; g.hint = null; if (g.sel) E.vibrate(6);
        paint();
      }
      async function humanMove(from, to) {
        const mv = g.ch.moves({ square: from, verbose: true }).find((m) => m.to === to);
        let promo;
        if (mv && mv.promotion) promo = await new Promise((res) => E.ui.sheet({ title: "Promotion", options: [["q", "Dame"], ["r", "Tour"], ["b", "Fou"], ["n", "Cavalier"]].map(([c, n]) => ({ label: n, fn: () => res(c) })), onClose: () => res("q") }));
        g.sel = ""; g.hint = null;
        await commit(from + to + (promo || ""), {}, g.token);
      }

      // ---- boucle
      async function next(tok) {
        if (!g || tok !== g.token || g.over) return;
        if (g.ch.game_over()) return finish(overText());
        const turn = g.ch.turn(), p = g.pl[turn];
        if (p.human) { status("À toi de jouer"); return; }
        if (g.paused) return;
        g.busy = true; status(`${p.kind === "duo" ? name(g.duoTurn++ % 2 ? "eto" : "enos") : p.name} réfléchit…`); paint();
        let mv;
        try { mv = await botMove(g.fen, p, g.duoTurn - 1); } catch (e) { g.busy = false; return status("✕ " + e.message); }
        if (tok !== g.token) return;
        await commit(mv.uci, mv, tok);
      }
      function overText() {
        const c = g.ch;
        if (c.in_checkmate()) return "Échec et mat — " + (c.turn() === "w" ? "les Noirs" : "les Blancs") + " gagnent";
        if (c.in_stalemate()) return "Pat — partie nulle";
        if (c.insufficient_material()) return "Matériel insuffisant — nulle";
        if (c.in_threefold_repetition()) return "Triple répétition — nulle";
        return "Partie nulle";
      }

      // pas de nulle par répétition : si le coup ramène une position déjà vue (ou mène à un pat…), on le remplace tant que la partie est tenue (même règle que PC : nasko_nodraw)
      async function nodraw(fen, uci) {
        if (!g || !g.seen || !L.drawAfter(fen, uci, g.seen)) return uci;
        const lines = await L.lines(fen, 6, 500);
        return (await L.pick(fen, lines, uci, g.seen, () => L.lines(fen, 10, 800))).uci;
      }
      async function botMove(fen, p, duo) {
        const ch = new Chess(fen);
        if (p.kind === "style") { const r = await styleMove(fen, p); return { ...r, uci: await nodraw(fen, r.uci) }; }
        if (p.kind === "penoire") {                                          // 2500 Elo, mais cherche le sacrifice brillant comme ETO
          const m = await K.etoMove(fen, { topMs: 500, sacMs: 800 });
          if (m.brilliant) { const u = await nodraw(fen, m.uci); return u === m.uci ? { uci: m.uci, brilliant: m.brilliant } : { uci: u }; }
          const r = await L.choose(fen, powerOfElo(2500), g.seen, { ms: 700 });
          if (!r || !r.uci) throw new Error("Le moteur n'a pas répondu.");
          return { uci: r.uci };
        }
        if (p.kind === "eto" || (p.kind === "duo" && duo % 2 === 1)) {
          const m = await K.etoMove(fen, { topMs: 900, sacMs: 1500 });
          const u = await nodraw(fen, m.uci);
          return u === m.uci ? { uci: m.uci, brilliant: m.brilliant } : { uci: u };
        }
        if (p.elo < 1300 && Math.random() < Math.max(0, (1300 - p.elo) / 1050 * 0.6)) { const l = ch.moves({ verbose: true }); const m = l[Math.floor(Math.random() * l.length)]; return { uci: m.from + m.to + (m.promotion || "") }; }
        const r = await L.choose(fen, p.power || powerOfElo(p.elo), g.seen, { pure: !!p.pure, ms: p.power >= 100 ? 1000 : undefined });   // E.N.O.S. (pleine puissance) cherche lui aussi le coup brillant
        if (!r || !r.uci) throw new Error("Le moteur n'a pas répondu.");
        return { uci: r.uci, brilliant: r.brilliant ? { piece: r.brilliant.piece, cp: r.brilliant.cp, mate: r.brilliant.mate, line: [] } : undefined };
      }

      // ---- bots de style (Nasko, Lelex) : livre d'ouvertures du joueur, puis Stockfish + fréquence d'erreurs mesurée sur ses parties
      const wpick = (items) => { let t = items.reduce((a, x) => a + x[1], 0), r = Math.random() * t; for (const [v, w] of items) { if ((r -= w) <= 0) return v; } return items[items.length - 1][0]; };
      async function styleMove(fen, p) {
        const S = STY && STY[p.style], ch = new Chess(fen), turn = ch.turn();
        const hist = g.ch.history({ verbose: true }), path = hist.map((m) => m.from + m.to + (m.promotion || "")).join(" ");
        const legal = new Set(ch.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || "")));
        const alien = p.style === "nasko" && turn === "w" ? ALIEN[path] : null;                     // le Gambit Alien contre la Caro-Kann reste son arme favorite
        if (alien && legal.has(alien)) return { uci: alien };
        const node = S && S.book[turn][path];
        if (node) { const ok = Object.entries(node).filter(([u]) => legal.has(u)); if (ok.length) return { uci: wpick(ok) }; }
        const lines = await L.lines(fen, 6, 450);
        if (!lines.length) { const r = await L.think(fen, powerOfElo(p.elo)); return { uci: r.uci }; }
        const top = lines[0], k = p.skill || (S ? S.skill : { mistake: 0.15, blunder: 0.08 }), roll = Math.random();
        const cand = lines.filter((l) => !top.mate || l.mate);
        let pool;
        if (!top.mate && roll < k.blunder) pool = lines.filter((l) => top.cp - l.cp >= 250 && !l.mate);
        else if (!top.mate && roll < k.blunder + k.mistake) pool = lines.filter((l) => top.cp - l.cp >= 100 && top.cp - l.cp < 250 && !l.mate);
        if (!pool || !pool.length) pool = cand.filter((l) => top.cp - l.cp <= 30);
        const w = (l) => { const m = ch.move({ from: l.uci.slice(0, 2), to: l.uci.slice(2, 4), promotion: l.uci[4] }); if (!m) return 1; ch.undo(); return 1 + (m.captured ? (S ? S.capRate : 0.2) * 3 : 0) + (/[+#]/.test(m.san) ? (S ? S.checkRate : 0.12) * 4 : 0); };
        return { uci: wpick(pool.map((l) => [l.uci, w(l)])) };
      }

      // joue le coup, le juge, met à jour l'écran puis passe la main
      async function commit(uci, meta, tok) {
        g.busy = true;
        const turn = g.ch.turn(), before = g.fen, evalBefore = g.evalW, bestUci = g.bestUci;
        g.snaps.push({ fen: before, evalW: evalBefore, bestUci, n: g.moves.length, last: g.last, brill: { ...g.brill }, inBook: g.inBook, seen: g.seen, lostMinor: { ...g.lostMinor }, elos: { w: g.pl.w.elo, b: g.pl.b.elo } });
        const m = g.ch.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
        if (!m) { g.busy = false; return status("Coup illégal"); }
        g.fen = g.ch.fen(); g.last = [m.from, m.to]; g.seen = L.addSeen(g.seen, g.fen);
        E.chessSound && E.chessSound.forSan(m.san);
        paint(uci);
        let ev;
        try { ev = await K.evaluate(g.fen, 420); } catch (e) { ev = { w: evalBefore, best: "" }; }
        if (tok !== g.token) return;
        let j;
        try { j = await K.judge(before, uci, { w: evalBefore, best: bestUci }, ev, turn, 420); } catch (e) { j = { q: K.quality(before, uci, evalBefore, ev.w, turn), before: { w: evalBefore, best: bestUci }, after: ev }; }
        if (tok !== g.token) return;
        const q = j.q, bu = j.before.best || bestUci, bestSan = bu && bu !== uci ? K.san(before, bu) : "";
        if (meta.brilliant && q.loss <= 60) { q.key = "brilliant"; q.label = K.QUALITY.brilliant; }
        if (bu && uci === bu && q.key !== "brilliant" && q.loss <= 8) { q.key = "best"; q.label = K.QUALITY.best; }
        let bookExit = false;
        if (g.inBook) {                                               // livre d'ouvertures : un coup de théorie n'est jamais jugé sur une évaluation superficielle (comme « Livre » sur Chess.com)
          const path = g.moves.map((x) => x.san).concat(m.san), name = K.inBook(path);
          if (name == null) { g.inBook = false; bookExit = true; }
          else if (q.key !== "brilliant" && q.loss < 250) { q.key = "book"; q.label = K.QUALITY.book; q.opening = name; }
        }
        ev = j.after; g.evalW = ev.w; g.bestUci = ev.best; g.moves.push({ ew: ev.w, san: m.san, uci, color: turn, q, bestSan, n: g.moves.length + 1, before: q.before, after: q.after, loss: q.loss, key: q.key, label: q.label, best: bestSan, best_uci: bu && bu !== uci ? bu : "", bookExit });
        const victim = turn === "w" ? "b" : "w", mvRec = g.moves[g.moves.length - 1];
        if (g.pl[victim].gain && ["inaccuracy", "mistake", "blunder"].includes(q.key)) {          // Naskurieux : +200 Elo à chaque inexactitude, erreur ou gaffe de l'adversaire
          g.pl[victim].elo = Math.min(3200, g.pl[victim].elo + 200); mvRec.eloUp = g.pl[victim].elo;
          E.ui.toast(`${g.pl[victim].name} : +200 Elo → ${g.pl[victim].elo}`, "ok", 2600); E.vibrate(20);
        }
        if (g.pl[turn].gain && (q.key === "best" || q.key === "brilliant")) {                   // buff : Naskurieux gagne aussi +200 Elo quand LUI joue le meilleur coup
          g.pl[turn].elo = Math.min(3200, g.pl[turn].elo + 200); mvRec.eloSelf = g.pl[turn].elo;
          E.ui.toast(`${g.pl[turn].name} : meilleur coup, +200 Elo → ${g.pl[turn].elo}`, "ok", 2600);
        }
        if (m.captured && (m.captured === "n" || m.captured === "b")) { g.lostMinor[victim]++; mvRec.minorLost = { col: victim, n: g.lostMinor[victim] }; }
        if (q.key === "brilliant") { g.brill[turn]++; E.vibrate(30); setTimeout(() => E.chessSound && E.chessSound.play("brilliant"), 250); }
        judge(g.moves[g.moves.length - 1], meta);
        g.busy = false;
        paint();
        // gaffe catastrophique du joueur : continuer ou annuler ?
        if (g.mode.human && g.pl[turn].human && q.key === "blunder" && g.id !== "coach" && !g.ch.game_over()) {
          const cancel = await new Promise((res) => E.ui.sheet({ title: "Gaffe catastrophique", html: `<p class="muted" style="margin-bottom:14px;line-height:1.5">Ton coup <b>${esc(m.san)}</b> te coûte ${q.loss} cp.${bestSan ? ` Il fallait jouer <b style="color:#7bd64d">${esc(bestSan)}</b>.` : ""}</p>`, options: [{ label: "ANNULER LE COUP", fn: () => res(true) }, { label: "CONTINUER", fn: () => res(false) }], onClose: () => res(false) }));
          if (cancel && tok === g.token) { rewind(1); return; }
        }
        if (g.ch.game_over()) return finish(overText());
        for (const col of ["w", "b"]) { if (g.pl[col].transform && !g.pl[col].done && g.lostMinor[col] >= 3) { await ghorTransform(col, tok); if (tok !== g.token) return; } }   // plus de 2 pièces mineures perdues : GhorGhor se réveille
        if (!g.mode.human) await sleep(g.delay);
        next(tok);
      }

      function judge(mv, meta) {
        const c = COL[mv.q.key] || "#999", box = $("#df-judge");
        const who = g.pl[mv.color].name;
        const txt = K.describe(mv.q, mv.san, mv.bestSan);
        box.hidden = false;
        box.innerHTML = `<span class="kchip" style="--c:${c}">${esc(mv.q.label.toUpperCase())}</span><span>${esc(who)} · ${esc(txt)}</span>`;
        const humanMove = g.mode.human && g.pl[mv.color].human;
        let say = "";
        if (meta && meta.brilliant) say = `${who} sacrifie ${meta.brilliant.piece} — ${meta.brilliant.mate ? "mat forcé en " + meta.brilliant.mate : "évaluation " + K.fmt(meta.brilliant.cp || 0)} (${(meta.brilliant.line || []).slice(0, 4).join(" ")}).`;
        else if (mv.q.key === "brilliant") say = pick(TAUNT.brilliant).replace("%s", who);
        else if (mv.q.key === "blunder") say = pick(TAUNT.blunder).replace("%s", who);
        else if (mv.q.key === "mistake" && !g.mode.human) say = pick(TAUNT.mistake).replace("%s", who);
        if (g.ch.in_checkmate()) say = pick(TAUNT.mate);
        if (g.id === "coach" && humanMove && mv.q.key !== "best") say = txt;
        if (say) { const box2 = $("#df-say"); box2.hidden = false; box2.textContent = say; box2.onclick = () => E.ai && E.ai.speak && E.ai.speak(g.pl[mv.color].kind === "eto" ? "eto" : "enos", say); }
        if (humanMove || g.mode.duel) llm(mv, humanMove);
        chatEvents(mv);
      }
      // la chat box réagit à chaque coup : ouverture (annonce, sortie de livre, refus), coups forts, brillants, gaffes, échecs, menaces de mat, frustration
      function chatEvents(mv) {
        const bc = E.botChat;
        if (!bc || !bc.count() || !g.talk) return;
        bc.tick();
        const c = mv.color, o = c === "w" ? "b" : "w", T = g.talk[c], O = g.talk[o], k = mv.q.key, d = { san: mv.san, open: g.openName };
        const prev = g.moves.length >= 2 ? g.moves[g.moves.length - 2].ew : 0, swing = (mv.ew - prev) * (c === "w" ? 1 : -1);
        const say = (I, kind) => !!I && I.say(kind, { ...d, elo: g.pl[I === g.talk.w ? "w" : "b"].elo });
        // ce que l'ADVERSAIRE du joueur qui vient de jouer répond : Elo gagné (Naskurieux) et pièces mineures perdues (GhorGhor) priment sur la réaction habituelle
        const ml = mv.minorLost, oOverride = mv.eloUp ? "elo_up" : ml && g.talk[ml.col] && g.pl[ml.col].transform && ml.n < 3 ? "minor_lost" : "";
        if (mv.q.opening) { if (g.openName !== mv.q.opening) g.openName = mv.q.opening; d.open = g.openName; if (!g.openSaid && g.moves.length >= 3) { g.openSaid = true; say(T, "open_announce") || say(O, "open_announce"); } }
        if (mv.bookExit) { if (g.moves.length <= 10) say(O, "open_refused") || say(T, "open_end"); else say(T, "open_end") || say(O, "open_end"); }
        else if (k === "brilliant") { say(T, "bot_brilliant"); say(O, oOverride || "h_brilliant"); }
        else if (k === "blunder") { say(T, "bot_blunder"); say(O, oOverride || "h_blunder"); }
        else if (k === "mistake") { say(T, "bot_mistake"); say(O, oOverride || "h_mistake"); }
        else if (k === "inaccuracy" && oOverride) say(O, oOverride);
        else if (k === "best" && mv.eloSelf) say(T, "elo_self");
        else if (k === "best" || k === "excellent") { if (swing >= 120) { say(T, "super"); if (!say(O, oOverride || "h_good")) { /* silence */ } } else say(T, "good") || say(O, oOverride || "h_good"); }
        else if (g.ch.in_check()) { say(T, "check"); say(O, oOverride || "check_received"); }
        else if (oOverride) say(O, oOverride);
        else say(T, "chat") || say(O, "chat");
        const ew = mv.ew, win = Math.abs(ew) >= 9000 ? (ew > 0 ? "w" : "b") : "";
        if (win && !g.mateSaid) { g.mateSaid = true; say(g.talk[win], "mate_coming"); say(g.talk[win === "w" ? "b" : "w"], "mate_danger"); }
        else if (!win) ["w", "b"].forEach((col) => {
          const I = g.talk[col];
          if (!I) return;
          const pov = ew * (col === "w" ? 1 : -1), n = g.moves.length;
          if (pov <= -300 && n - (g.fr[col] || -99) >= 8) { g.fr[col] = n; say(I, "frustration"); }
          else if (pov >= 500 && n - (g.wn[col] || -99) >= 10) { g.wn[col] = n; say(I, "winning"); }
        });
      }

      // ---- GhorGhor se réveille : il dit sa phrase, l'écran glitche, l'ambiance s'assombrit, l'illustration change et il devient GhorGhor le vrai (GM, 3200 Elo, joue comme ETO Brillant)
      function glitchSound() {
        try {
          if (!E.settings.get("chess.sound", true)) return;
          const ac = (glitchSound.ac = glitchSound.ac || new (window.AudioContext || window.webkitAudioContext)()), t = ac.currentTime;
          if (ac.state === "suspended") ac.resume();
          const n = ac.createBuffer(1, Math.floor(ac.sampleRate * 1.4), ac.sampleRate), data = n.getChannelData(0);
          for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (Math.random() < 0.35 ? 1 : 0.15) * (1 - i / data.length);
          const src = ac.createBufferSource(), g1 = ac.createGain(), o = ac.createOscillator(), g2 = ac.createGain();
          src.buffer = n; g1.gain.value = 0.5; src.connect(g1); g1.connect(ac.destination); src.start(t);
          o.type = "sawtooth"; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(32, t + 1.6); g2.gain.setValueAtTime(0.35, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 1.7); o.connect(g2); g2.connect(ac.destination); o.start(t); o.stop(t + 1.7);
        } catch (e) { /* audio indisponible */ }
      }
      function glitchFx(ms) {
        const app = document.getElementById("app");
        if (!app || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !E.settings.get("anim", true)) return sleep(Math.min(ms, 600));
        const ov = document.createElement("div");
        ov.className = "glitch-ov";
        document.body.appendChild(ov);
        glitchSound();
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
      async function ghorTransform(col, tok) {
        const p = g.pl[col], bc = E.botChat, old = g.talk[col];
        p.done = true;
        if (old) old.say("transform");
        await sleep(2000);
        if (!g || tok !== g.token) return;
        E.vibrate([60, 40, 60, 40, 140]);
        await glitchFx(1700);
        if (!g || tok !== g.token) return;
        Object.assign(p, { kind: "eto", elo: 3200, name: "GhorGhor le vrai", title: "GM", talk: "ghorreal" });
        delete p.style; delete p.skill;
        document.documentElement.classList.add("ghor");                          // l'ambiance de l'application s'assombrit
        if (bc && old) { const n = bc.replace(old, "ghorreal", "awake"); g.talk[col] = n; setTimeout(() => { if (g && tok === g.token && n) n.say("greet", { elo: 3200 }); }, 500); }
        paint();
      }

      // commentaire facultatif d'ETO (Groq) pour les coups marquants
      async function llm(mv, humanMove) {
        if (!E.ai || !E.ai.configured() || !E.settings.get("chess.comment", true)) return;
        if (!["brilliant", "blunder", "mistake"].includes(mv.q.key) && !(g.mode.duel && g.moves.length % 6 === 0)) return;
        const seq = ++g.sayN, tok = g.token, persona = (g.mode.duel ? (g.pl[mv.color].kind === "eto" ? "eto" : "enos") : E.settings.get("persona", "enos") === "eto" ? "eto" : "enos");
        const q = `Partie d'échecs${g.mode.duel ? ` entre ${g.pl.w.name} (Blancs) et ${g.pl.b.name} (Noirs)` : ""}. Dernier coup : ${mv.san} par ${g.pl[mv.color].name}, jugé ${mv.q.label} (${mv.q.loss} cp de perte). ${mv.bestSan ? "Le meilleur était " + mv.bestSan + "." : ""} Évaluation : ${K.fmt(g.evalW)} (Blancs). Réagis en UNE phrase courte, dans ton style.`;
        try {
          const t = await E.ai.chat(persona, q, () => {}, { oneShot: true, system: E.ai.PERSONAS[persona].system(E.ai.name()) + " Tu commentes une partie d'échecs : une seule phrase." });
          if (seq === g.sayN && tok === g.token) { const b = $("#df-say"); b.hidden = false; b.textContent = t; b.onclick = () => E.ai.speak(persona, t); }
        } catch (e) { /* le gabarit reste affiché */ }
      }

      // ---- retour en arrière, indice, abandon
      function rewind(n) {
        let s = null;
        for (let i = 0; i < n && g.snaps.length; i++) { s = g.snaps.pop(); g.ch.undo(); }
        if (!s) return;
        g.fen = s.fen; g.evalW = s.evalW; g.bestUci = s.bestUci; g.moves.length = s.n; g.last = s.last; g.brill = s.brill; g.inBook = s.inBook; g.seen = s.seen || L.startSeen(s.fen); if (s.lostMinor) g.lostMinor = s.lostMinor; if (s.elos) { if (g.pl.w.gain) g.pl.w.elo = s.elos.w; if (g.pl.b.gain) g.pl.b.elo = s.elos.b; } g.sel = ""; g.hint = null; g.over = ""; g.busy = false;
        $("#df-judge").hidden = true; $("#df-say").hidden = true;
        paint(); status("Coup annulé"); next(g.token);
      }
      function undo() {
        if (!g || g.busy || g.over) return;
        const n = g.pl[g.ch.turn()].human ? 2 : 1;
        if (g.snaps.length < n) return;
        g.token++; const t = g.token; rewind(n); g.token = t;
      }
      async function hint() {
        if (!g || g.busy || g.over || !g.pl[g.ch.turn()].human) return;
        status("Recherche d'un indice…");
        const r = await L.analyse(g.fen, { movetime: 700 });
        if (r.best) { g.hint = [r.best.slice(0, 2), r.best.slice(2, 4)]; g.sel = ""; status("Indice : " + K.san(g.fen, r.best)); paint(); }
      }
      function resign() {
        if (!g || g.over) return;
        E.ui.confirm("Abandonner ?", "La partie sera perdue.", "ABANDONNER", true).then((ok) => { if (ok && g && !g.over) doResign(); });
      }
      function doResign() { g.token++; L.abort && L.abort(); const c = g.me; finish("Abandon — " + (c === "w" ? "les Noirs" : "les Blancs") + " gagnent"); }

      // ---- fin
      function finish(result, stopped) {
        if (!g) return;
        g.over = result; g.busy = false; g.token++;
        paint(); status(result);
        if (E.botChat && E.botChat.count() && !stopped && g.talk) {                // la chat box a le dernier mot
          const win = /Blancs gagnent/.test(result) ? "w" : /Noirs gagnent/.test(result) ? "b" : "", lose = win === "w" ? "b" : "w";
          if (!win) Object.values(g.talk).forEach((I) => I.say("draw"));
          else {
            const resign = /Abandon/.test(result);
            if (g.talk[win]) g.talk[win].say(resign ? "resign_win" : "mate_win");
            if (g.talk[lose] && !resign) g.talk[lose].say("mate_lose");
            E.botChat.result(g.talk[win] || null);
          }
        }
        const rev = K.buildReview(g.moves, g.me || "w");
        const accW = K.buildReview(g.moves, "w").me.accuracy, accB = K.buildReview(g.moves, "b").me.accuracy;
        if (g.mode.human && g.me && !stopped && E.chessLearn) E.chessLearn.addGame(g.me, result, g.pl[g.me === "w" ? "b" : "w"].power || 100);
        if (g.moves.length >= 2) {
          const list = hist(); list.push({ t: Date.now(), title: g.mode.t.replace(/[^\p{L}\p{N} .'-]/gu, "").trim() + " · " + g.pl.w.name + " – " + g.pl.b.name, result, plies: g.moves.length, brill: g.brill.w + g.brill.b, acc: g.me ? (g.me === "w" ? accW : accB) : null, pgn: g.ch.pgn(),
            id: g.id, pw: g.pl.w.name, pb: g.pl.b.name, pk: [g.pl.w.kind || "", g.pl.b.kind || ""], bw: g.brill.w, bb: g.brill.b, me: g.me, accW, accB,
            mv: g.moves.map((m) => [m.uci, m.san, m.q.key, m.q.loss | 0, m.ew === undefined ? null : m.ew, m.bestSan || ""]) });   // enregistrement complet : [uci, san, jugement, perte, éval Blancs, meilleur coup]
          E.settings.set("defi.hist", list.slice(-40));
        }
        const row = (c) => `<div class="df-sum"><b>${esc(sideName(c))}</b><span>précision ${(c === "w" ? accW : accB) == null ? "—" : (c === "w" ? accW : accB) + " %"}</span><span style="color:#1acfd6">✦ ${g.brill[c]} brillant${g.brill[c] > 1 ? "s" : ""}</span></div>`;
        E.vibrate(40);
        if (g.moves.length >= 2) E.ui.sheet({ title: result, html: `${row("w")}${row("b")}<p class="muted" style="margin-top:10px;font-size:13px">${rev.critical.length ? "Moments clés : " + rev.critical.map((c) => `coup ${Math.ceil(c.n / 2)} (${c.san} ${c.label.toLowerCase()})`).join(", ") + "." : "Aucune gaffe majeure."}</p>`, options: [{ label: "COPIER LE PGN", fn: () => A.copy(g.ch.pgn()) }, { label: "REJOUER", fn: () => launch(g.id, g.o) }, { label: "FERMER" }] });
      }

      // ------------------------------------------------------------------ replay d'une partie enregistrée (même plateau, mêmes jugements)
      function replay(rec) {
        if (!rec || !rec.mv || !rec.mv.length) return;
        if (g) { g.token++; L.abort && L.abort(); }
        if (E.botChat) E.botChat.unmountAll(); document.documentElement.classList.remove("ghor");
        const fens = [START], c = new Chess();
        rec.mv.forEach((m) => { c.move({ from: m[0].slice(0, 2), to: m[0].slice(2, 4), promotion: m[0][4] }); fens.push(c.fen()); });
        const R = { rec, fens, k: 0, speed: 1, playing: false };
        const base = { id: rec.id || "replay", mode: { human: false, t: rec.title }, pl: { w: { name: rec.pw || "Blancs", elo: 3200 }, b: { name: rec.pb || "Noirs", elo: 3200 } }, me: null,
          token: (g ? g.token : 0) + 1, ch: new Chess(), fen: START, evalW: 0, bestUci: "", moves: [], snaps: [], over: "", busy: false, paused: false, sel: "", hint: null, last: null,
          brill: { w: 0, b: 0 }, flip: rec.me === "b", R };
        g = base;
        $("#df-home").hidden = true; $("#df-game").hidden = false; $("#df-judge").hidden = true; $("#df-say").hidden = true;
        const draw = (anim) => {
          const k = R.k, mvs = rec.mv.slice(0, k);
          g.ch = new Chess(fens[k]); g.fen = fens[k];
          g.moves = mvs.map((m, i) => ({ san: m[1], uci: m[0], color: i % 2 ? "b" : "w", q: { key: m[2], label: K.QUALITY[m[2]] || m[2], loss: m[3] }, bestSan: m[5], n: i + 1 }));
          g.brill = { w: g.moves.filter((m) => m.color === "w" && m.q.key === "brilliant").length, b: g.moves.filter((m) => m.color === "b" && m.q.key === "brilliant").length };
          g.evalW = k ? (mvs[k - 1][4] == null ? 0 : mvs[k - 1][4]) : 0;
          g.last = k ? [mvs[k - 1][0].slice(0, 2), mvs[k - 1][0].slice(2, 4)] : null;
          paint(anim && k ? mvs[k - 1][0] : undefined);
          const cur = k ? g.moves[k - 1] : null, box = $("#df-judge");
          box.hidden = !cur;
          if (cur) box.innerHTML = `<span class="kchip" style="--c:${COL[cur.q.key] || "#999"}">${esc(cur.q.label.toUpperCase())}</span><span>${esc(g.pl[cur.color].name)} · ${esc(K.describe(cur.q, cur.san, cur.bestSan))}</span>`;
          $("#df-say").hidden = true;
          status(`Coup ${k} / ${rec.mv.length}` + (k === rec.mv.length ? " · " + rec.result : ""));
          const sl = $("#rp-seek"); if (sl) sl.value = k;
          const pb = $("#rp-play"); if (pb) pb.textContent = R.playing ? "⏸" : "▶";
          const sp = $("#rp-speed"); if (sp) sp.textContent = R.speed + "×";
        };
        const go = (k, anim) => { R.k = Math.max(0, Math.min(rec.mv.length, k)); draw(anim); };
        const stop = () => { R.playing = false; clearTimeout(R.timer); };
        const tick = () => {
          if (!R.playing || g !== base) return;
          if (R.k >= rec.mv.length) { stop(); return draw(); }
          go(R.k + 1, true);
          R.timer = setTimeout(tick, 900 / R.speed);
        };
        $("#df-btns").innerHTML = `<div class="rp-bar"><button class="btn" id="rp-first">⏮</button><button class="btn" id="rp-prev">◂</button><button class="btn" id="rp-play">▶</button><button class="btn" id="rp-next">▸</button><button class="btn" id="rp-last">⏭</button><button class="btn" id="rp-speed">1×</button><button class="btn" id="b-flip">⟲</button></div><input type="range" id="rp-seek" min="0" max="${rec.mv.length}" value="0" style="width:100%;accent-color:var(--red);margin-top:8px">`;
        const on = (id, f) => { $("#" + id).onclick = f; };
        on("rp-first", () => { stop(); go(0); }); on("rp-prev", () => { stop(); go(R.k - 1); }); on("rp-next", () => { stop(); go(R.k + 1, true); }); on("rp-last", () => { stop(); go(rec.mv.length); });
        on("rp-play", () => { if (R.playing) return stop(), draw(); if (R.k >= rec.mv.length) go(0); R.playing = true; draw(); R.timer = setTimeout(tick, 400 / R.speed); });
        on("rp-speed", () => { R.speed = R.speed >= 8 ? 1 : R.speed * 2; draw(); });
        on("b-flip", () => { g.flip = !g.flip; draw(); });
        $("#rp-seek").oninput = (e) => { stop(); go(+e.target.value); };
        $("#df-back").onclick = () => { stop(); g.token++; $("#df-game").hidden = true; $("#df-home").hidden = false; paintHist(); $("#df-back").onclick = backHome; };
        go(0);
      }

      el._api = { launch, replay, get g() { return g; }, setup };
      paintHist();
    },
  });
})();
