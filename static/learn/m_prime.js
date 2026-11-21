"use strict";
// MODULE « ChatGPT Prime » : 9999 Elo, GM, joue normalement puis TRICHE (coups illégaux) et s'en sort toujours. Logique : js/prime.js. Les parties sont enregistrées dans `variants.hist`
// (format des variantes : actions + FEN) -> le Chess Edit les monte comme les autres ; Game Clips peut aussi les mettre en scène (E.clips.runPrime).
(() => {
  const E = window.ENOS, esc = E.esc, P = E.prime;
  const ICON = '<path d="M12 2l2.4 5 5.6.8-4 4 1 5.6L12 14.6 7 17.4l1-5.6-4-4 5.6-.8z"/>';
  E.suite.register({
    id: "prime", group: "chess", title: "ChatGPT Prime", sub: "9999 Elo · GM · coups… légaux ?", icon: ICON,
    build(el, A) {
      const $ = (s) => el.querySelector(s), L = E.chessLocal, B = E.board;
      let cfg = Object.assign({ color: "w", mode: "human", opp: "stockfish" }, E.settings.get("prime.cfg", {}));
      if (cfg.mode === "sf") { cfg.mode = "bot"; cfg.opp = "stockfish"; }
      const powerOfElo = (e) => Math.max(1, Math.min(100, Math.round(e <= 1500 ? 1 + (e - 250) / 1250 * 49 : 50 + (e - 1500) / 1700 * 50)));
      // adversaires de Prime : nos bots (les mêmes niveaux qu'en Défis) + Stockfish 19
      const OPP = { eto: { name: "ETO", elo: 3650, power: 100, taste: true }, enos: { name: "E.N.O.S.", elo: 3650, power: 100 }, stockfish: { name: "Stockfish 19", short: "Stockfish", elo: 3650, power: 100, pure: true },
        naskolit: { name: "Naskolit", elo: 3200 }, penoire: { name: "Nasko (pénoire)", short: "Pénoire", elo: 2500 }, jester: { name: "Le Jester", elo: 1600, wheel: true }, ghorghor: { name: "GhorGhor", elo: 1400 },
        nasko: { name: "Nasko", elo: 1300 }, lelex: { name: "Lelex", elo: 1150 }, naskurieux: { name: "Naskurieux", elo: 1 } };
      if (!OPP[cfg.opp]) cfg.opp = "stockfish";
      const av = (id) => (E.assetBase || "") + "img/bots/" + id + ".png";
      let G = null;
      const badge = () => (E.botChat ? E.botChat.badge("GM") : "");
      el.innerHTML = `
        <div id="pr-home">
          <div class="card pr-hero"><img class="pr-av" src="${E.assetBase || ""}img/bots/prime.png" alt="ChatGPT Prime">
            <div><h3>${badge()}ChatGPT Prime <small>9999 Elo</small></h3>
              <p class="muted">Il joue normalement au début… puis il <b>triche</b> : pièces qui se téléportent, qui apparaissent de nulle part, qui sautent par-dessus les autres, le roi qui mange son fou puis le ressuscite. Il explique chaque coup avec un aplomb <b>qui ne veut rien dire</b>. Il gagne environ <b>6 parties sur 10</b> : le reste du temps il joue n'importe quoi et finit maté. Et quand il est maté, il arrive que son roi <b>se téléporte</b> ailleurs. Aucune IA n'est interrogée (zéro token).</p></div></div>
          <div class="card"><div class="seg" id="pr-mode"><button data-m="human">TOI CONTRE PRIME</button><button data-m="bot">BOT CONTRE PRIME</button><i class="seg-ind"></i></div>
            <div class="pr-opps" id="pr-opps" hidden>${Object.keys(OPP).map((id) => `<button data-o="${id}"><img src="${av(id)}" alt=""><b>${esc(OPP[id].short || OPP[id].name)}</b><small>${OPP[id].wheel ? "?" : OPP[id].elo}</small></button>`).join("")}</div>
            <p class="muted pr-cap" id="pr-cap"></p>
            <div class="seg" id="pr-col"><button data-c="w">BLANCS</button><button data-c="b">NOIRS</button><button data-c="r">AU HASARD</button><i class="seg-ind"></i></div>
            <div class="row" style="margin-top:12px"><button class="btn pri" id="pr-go">♟ JOUER</button></div></div>
          <div class="card"><h3>Parties de Prime<span class="sp" id="pr-hn"></span></h3><div id="pr-hist" class="list"></div></div>
        </div>
        <div id="pr-game" hidden>
          <button class="back" id="pr-back" style="margin-bottom:8px">◂ PRIME</button>
          <div class="card" style="padding:12px">
            <div class="pr-pl" id="pr-top"></div>
            <div id="pr-bub" class="pr-bub"><img src="${E.assetBase || ""}img/bots/prime.png" alt=""><div><small>ChatGPT Prime</small><span id="pr-say">…</span></div></div>
            <div class="pr-bw" id="pr-bw"><div id="pr-board"></div><div id="pr-stamp" class="pr-stamp" hidden></div></div>
            <div class="pr-pl" id="pr-bot"></div>
            <div class="ch-moves" id="pr-moves"></div>
            <div class="ch-top" style="margin-top:6px"><span id="pr-status" class="muted"></span></div>
            <div class="row" id="pr-btns"></div>
          </div>
        </div>`;
      const seg = (id, key, get, set) => { const s = $(id); const sync = () => { s.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset[key] === get())); const i = s.querySelector(".seg-ind"), on = s.querySelector("button.on"); if (i && on) { i.style.width = on.offsetWidth + "px"; i.style.transform = `translateX(${on.offsetLeft}px)`; } }; s.querySelectorAll("button").forEach((b) => (b.onclick = () => { set(b.dataset[key]); sync(); })); sync(); return sync; };
      const syncOpp = () => { $("#pr-opps").hidden = cfg.mode !== "bot"; $("#pr-opps").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.o === cfg.opp)); $("#pr-cap").textContent = cfg.mode === "bot" ? "Camp de " + OPP[cfg.opp].name : "Ton camp"; };
      $("#pr-opps").onclick = (e) => { const b = e.target.closest("[data-o]"); if (b) { cfg.opp = b.dataset.o; syncOpp(); } };
      const syncA = seg("#pr-mode", "m", () => cfg.mode, (v) => { cfg.mode = v; syncOpp(); }), syncB = seg("#pr-col", "c", () => cfg.color, (v) => (cfg.color = v));
      syncOpp();
      const hist = () => E.settings.get("variants.hist", []).filter((x) => x.mode === "prime");
      function paintHist() {
        const h = hist().slice().reverse(); $("#pr-hn").textContent = h.length ? h.length + " partie" + (h.length > 1 ? "s" : "") : "";
        $("#pr-hist").innerHTML = h.length ? h.map((x, i) => `<div class="it"><span class="n">${esc(x.title)}<small>${esc(x.result)} · ${x.plies} coups</small></span><button class="btn" data-edit="${i}">✂ ÉDITER</button></div>`).join("") : '<p class="muted">Aucune partie pour l\'instant.</p>';
      }
      $("#pr-hist").onclick = (e) => { const b = e.target.closest("[data-edit]"); if (b && E.chessEdit) E.chessEdit.open(hist().slice().reverse()[+b.dataset.edit]); };
      A.onShow = A.onShow || null; paintHist();

      // ------------------------------------------------------------------ partie
      const nameOf = (side) => (side === G.primeSide ? "ChatGPT Prime" : G.mode === "bot" ? G.opp.name : "Toi");
      function strip(side) {
        const prime = side === G.primeSide;
        return prime ? `<span class="df-dot ${side}"></span>${badge()}<b>ChatGPT Prime</b><small>9999 Elo</small>` : `<span class="df-dot ${side}"></span>${G.mode === "bot" ? `<img class="pr-oav" src="${av(G.oppId)}" alt="">` : ""}<b>${esc(nameOf(side))}</b>${G.mode === "bot" ? `<small>${G.opp.elo} Elo</small>` : ""}`;
      }
      function paint(last, extra) {
        const pos = B.parse(G.st.fen), flip = G.flip, turn = pos.turn;
        let targets = []; if (G.sel) { try { targets = new Chess(G.st.fen).moves({ square: G.sel, verbose: true }).map((m) => m.to); } catch (e) { targets = []; } }
                B.render($("#pr-board"), pos.m, Object.assign({ flip, last: last || G.last, sel: G.sel, targets, onTap, check: B.kingSquare(pos.m, turn) && P.inCheck(G.st.fen, turn === "w") ? B.kingSquare(pos.m, turn) : "" }, extra || {}));
        const top = flip ? "w" : "b", bot = flip ? "b" : "w";
        $("#pr-top").innerHTML = strip(top); $("#pr-bot").innerHTML = strip(bot);
        $("#pr-moves").innerHTML = G.acts.map((a, i) => `<span>${i % 2 === 0 ? i / 2 + 1 + "." : ""}${esc(a.san)}</span>`).join(" "); $("#pr-moves").scrollLeft = 1e5;
      }
      const status = (t) => { $("#pr-status").textContent = t; };
      let sayT = 0;
      function say(t) { const s = $("#pr-say"); s.textContent = ""; const id = ++sayT, chars = Array.from(t); let i = 0; const tick = () => { if (id !== sayT) return; s.textContent = chars.slice(0, (i += 2)).join(""); if (i < chars.length) setTimeout(tick, 18); else s.textContent = t; }; tick(); }
      function glitchSfx() {
        try { const S = E.chessSound, a = S && S.ac ? S.ac() : null; if (!a) return; if (a.state === "suspended") a.resume(); const t = a.currentTime, n = a.createBuffer(1, Math.floor(a.sampleRate * 0.32), a.sampleRate), d = n.getChannelData(0);
          for (let i = 0; i < d.length; i++) { const k = i / d.length; d[i] = ((Math.random() * 2 - 1) * (Math.sin(k * 90) > 0 ? 1 : 0.2)) * (1 - k) * 0.5; }
          const src = a.createBufferSource(), g = a.createGain(), f = a.createBiquadFilter(); f.type = "bandpass"; f.frequency.setValueAtTime(3400, t); f.frequency.exponentialRampToValueAtTime(380, t + 0.3); g.gain.value = 0.7; src.buffer = n; src.connect(f); f.connect(g); g.connect(a.destination); src.start(t);
          const o = a.createOscillator(), og = a.createGain(); o.type = "sawtooth"; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.28); og.gain.setValueAtTime(0.25, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(og); og.connect(a.destination); o.start(t); o.stop(t + 0.32); } catch (e) { /* son facultatif */ }
      }
      function stamp(text, long) { const s = $("#pr-stamp"); s.textContent = text; s.hidden = false; s.classList.toggle("long", !!long); s.classList.remove("go"); void s.offsetWidth; s.classList.add("go"); setTimeout(() => { s.hidden = true; }, long ? 2600 : 1100); }
      async function playAct(a) {                                                                      // anime UN coup de Prime (légal ou non)
        G.acts.push(a); G.st.fen = a.fen; const last = a.from ? [a.from, a.to] : [a.to, a.to];
        paint(last, { anim: a.from && a.from !== a.to && a.k === "mv" ? a.from + a.to : "" });
        try { E.chessSound.forSan(a.san); } catch (e) { /* son facultatif */ } B.burst($("#pr-board"), a.to, a.cap ? "capture" : "land");                       // un coup illégal est joué EXACTEMENT comme un autre : aucun avertissement
        if (a.fake) stamp("ÉCHEC ET MAT"); say(a.say); await new Promise((r) => setTimeout(r, a.fake ? 1300 : 900));
      }
      /** PLOT TWIST : Prime est maté… « De quoi tu parles ? Tu t'es fait checkmate. » : le plateau fait un 180° (il prend NOTRE place) et il déclare avoir gagné par checkmate */
      async function twist() {
        const tok = G.token; G.busy = true; const pos = B.parse(G.st.fen), a = P.twistAct(G.st.fen, G.primeSide === "w", B.kingSquare(pos.m, pos.turn)), wait = (ms) => new Promise((r) => setTimeout(r, ms));
        G.acts.push(a); G.over = { why: "twist", winner: G.primeSide }; status("Échec et mat !"); paint(); say(a.say); await wait(2200); if (!G || tok !== G.token) return;
        const bw = $("#pr-bw"); bw.classList.add("pr-spin"); glitchSfx(); E.vibrate && E.vibrate([40, 30, 90]); await wait(1450); if (!G || tok !== G.token) return;
        bw.classList.remove("pr-spin"); G.flip = !G.flip; paint(); stamp("CHATGPT A GAGNÉ PAR CHECKMATE", true); say("ChatGPT a gagné par checkmate."); try { E.chessSound.play("mate"); } catch (e) { /* son facultatif */ }
        await wait(2400); if (!G || tok !== G.token) return; finish("par checkmate (il l'a décidé)", G.over);
      }
      function record(why) {
        const prime = G.primeSide, acts = G.acts.map((a) => Object.assign({}, a)), winner = G.over && "winner" in G.over ? G.over.winner : prime;
        const names = prime === "w" ? ["ChatGPT Prime", nameOf("b")] : [nameOf("w"), "ChatGPT Prime"];
        const result = (!winner ? "Nulle" : winner === prime ? "ChatGPT Prime gagne" : G.mode === "human" ? "Tu gagnes" : nameOf(winner) + " gagne") + " · " + why;
        const rec = { variant: true, mode: "prime", t: Date.now(), title: "🤖 ChatGPT Prime · " + names[0] + " – " + names[1], result, plies: acts.length, brill: 0, acc: null, cheats: G.st.cheats, pgn: "", id: "prime", pw: names[0], pb: names[1], pk: ["variant", "variant"], bw: 0, bb: 0,
          me: G.mode === "human" ? (prime === "w" ? "b" : "w") : null, accW: null, accB: null, ch: [], mv: acts.map((a) => [a.uci, a.san, a.key || "good", 0, null, ""]), v: { mode: "prime", acts, start: P.START, over: G.over ? G.over.why : "end", duo: false, beaten: !!(G.over && G.over.why === "twist") || (!!winner && winner !== prime), primeWon: winner === prime } };
        if (acts.length >= 2) { const l = E.settings.get("variants.hist", []); l.push(rec); E.settings.set("variants.hist", l.slice(-40)); }
        return rec;
      }
      function finish(why, over) {
        G.over = over || G.over || { why: "end" }; G.busy = false; const rec = record(why); G.rec = rec; status(rec.result);
        $("#pr-btns").innerHTML = `<button class="btn pri" id="pr-again">↻ REJOUER</button><button class="btn" id="pr-edit">✂ ÉDITER CETTE PARTIE</button>`;
        $("#pr-again").onclick = () => start(); $("#pr-edit").onclick = () => E.chessEdit && E.chessEdit.open(rec); if (G.over.why === "kill") say(G.acts[G.acts.length - 1].say); else if (G.over.say) say(G.over.say);
      }
      const gameOverNow = () => { const ch = new Chess(G.st.fen); return ch.game_over() ? ch : null; };
      async function primeTurn(danger) {
        if (!G || G.over) return; G.busy = true; status("ChatGPT Prime réfléchit… (ou pas)"); await new Promise((r) => setTimeout(r, 700));
        const tok = G.token, r = await P.turn(G.st, { L, danger, weak: 18 }); if (!G || tok !== G.token) return;
        for (const a of r.acts) { if (!G || tok !== G.token) return; await playAct(a); }
        if (!G || tok !== G.token) return;                                                             // partie quittée pendant l'animation
        if (r.over) {
          if (r.over.why === "twist") return twist();
          if (r.over.why === "mated") { stamp("ÉCHEC ET MAT"); try { E.chessSound.play("mate"); } catch (e) { /* son facultatif */ } return finish("échec et mat", r.over); }
          if (r.over.why === "crash") { const bw = $("#pr-bw"); bw.classList.add("pr-glitch"); glitchSfx(); setTimeout(() => bw.classList.remove("pr-glitch"), 800); stamp("ERREUR SERVEUR"); return finish("ChatGPT Prime a planté", r.over); }
          return finish(r.over.why === "kill" ? "échec et mat" : "fin", r.over);
        }
        const go = gameOverNow(); if (go) return go.in_checkmate() ? finish("échec et mat", { why: "mate", winner: G.primeSide }) : drawEnd(go);
        if (G.acts.length > 220) return finish("fatigue (Prime déclare la victoire)", { why: "long", winner: G.primeSide });
        G.busy = false; if (G.mode === "bot") sfTurn(); else status("À toi de jouer.");
      }
      // nulle : dans une partie qu'il devait gagner, Prime la déclare gagnée ; sinon c'est une vraie nulle
      const drawEnd = (go) => (G.st.beatable ? finish(go.in_stalemate() ? "pat" : "nulle", { why: "draw", winner: "" }) : finish(go.in_stalemate() ? "pat… selon Prime, c'est une victoire" : "nulle (Prime conteste)", { why: "draw", winner: G.primeSide }));
      /** après le coup de l'adversaire : mat -> c'est Prime qui réagit (roi téléporté, plot twist ou défaite), nulle -> fin */
      const afterOpp = () => { const go = gameOverNow(); if (go && !go.in_checkmate()) return drawEnd(go); primeTurn(!!(go && go.in_checkmate())); };
      async function sfTurn() {                                                                       // mode spectateur : un de nos bots (ou Stockfish) joue l'autre camp
        if (!G || G.over) return; G.busy = true; const o = G.opp; status(o.name + " réfléchit…"); const tok = G.token; await new Promise((r) => setTimeout(r, 500));
        const fen = G.st.fen; let uci = "";
        try { const r = await L.choose(fen, o.power || powerOfElo(o.elo), L.startSeen(fen), { pure: !!o.pure, taste: !!o.taste, ms: o.power >= 100 ? 700 : undefined }); uci = r && r.uci ? r.uci : ""; } catch (e) { uci = ""; }
        if (!uci) { try { uci = (await L.think(fen, o.power || powerOfElo(o.elo), 350)).uci || ""; } catch (e) { uci = ""; } }
        if (!G || tok !== G.token) return;
        const ch = new Chess(fen), mv = ch.moves({ verbose: true }), m = mv.find((x) => x.from + x.to + (x.promotion || "") === uci) || mv[Math.floor(Math.random() * mv.length)];
        if (!m) return finish(o.name + " n'a plus de coup", { why: "end", winner: G.primeSide });
        ch.move(m); await human(m, ch);
        if (!G || tok !== G.token) return; afterOpp();
      }
      async function human(m, ch) {                                                                  // joue le coup de l'autre camp (toi / Stockfish)
        const a = { k: "mv", side: m.color, seat: m.color === "w" ? 0 : 1, key: "good", ev: null, from: m.from, to: m.to, piece: m.piece, cap: m.captured || "", promo: m.promotion || "", uci: m.from + m.to + (m.promotion || ""), san: m.san, fen: ch.fen(), cheat: "" };
        G.acts.push(a); G.st.fen = a.fen; G.sel = null; G.last = [m.from, m.to]; paint(G.last, { anim: m.from + m.to }); try { E.chessSound.forSan(m.san); } catch (e) { /* son facultatif */ }
        await new Promise((r) => setTimeout(r, 450));
      }
      async function onTap(sq) {
        if (!G || G.over || G.busy || G.mode !== "human") return; const ch = new Chess(G.st.fen); if ((ch.turn() === "w") === (G.primeSide === "w")) return;
        const mv = G.sel ? ch.moves({ square: G.sel, verbose: true }).filter((x) => x.to === sq) : [];
        if (mv.length) { G.busy = true; const m = mv.find((x) => x.promotion === "q") || mv[0]; ch.move(m); const lost = m.captured && "nbrq".includes(m.captured), tok = G.token; await human(m, ch); if (!G || tok !== G.token) return; const go = gameOverNow(); if (go && !go.in_checkmate()) return drawEnd(go); return primeTurn(!!lost || !!go); }
        const p = ch.get(sq); G.sel = p && p.color === ch.turn() ? sq : null; paint(); if (G.sel) B.burst($("#pr-board"), sq, "tap");
      }
      function start() {
        const col = cfg.color === "r" ? (Math.random() < 0.5 ? "w" : "b") : cfg.color; E.settings.set("prime.cfg", cfg);
        const humanSide = col, primeWhite = humanSide === "b";
        const opp = Object.assign({}, OPP[cfg.opp]); if (opp.wheel) opp.elo = 1 + Math.floor(Math.random() * 3200);                 // Le Jester : la roue tire son Elo
        G = { mode: cfg.mode, oppId: cfg.opp, opp, primeSide: primeWhite ? "w" : "b", st: P.newState(primeWhite, cfg.beat == null ? P.rollBeatable() : Math.random() < cfg.beat), acts: [], sel: null, last: null, busy: false, over: null, token: Math.random(), flip: cfg.mode === "human" ? humanSide === "b" : false };
        $("#pr-home").hidden = true; $("#pr-game").hidden = false; say("Je suis un Grand Maître à 9999 Elo. Les règles ? Je les connais toutes. Je les applique selon mon humeur."); paint();
        $("#pr-btns").innerHTML = `<button class="btn" id="pr-stop">ABANDONNER</button>`; $("#pr-stop").onclick = () => finish("tu abandonnes (Prime accepte avec élégance)", { why: "resign", winner: G.primeSide });
        if (primeWhite || cfg.mode === "bot") { if (primeWhite) primeTurn(false); else sfTurn(); } else status("À toi de jouer.");
      }
      $("#pr-go").onclick = start;
      $("#pr-back").onclick = () => { if (G) G.token = Math.random(); G = null; $("#pr-game").hidden = true; $("#pr-home").hidden = false; paintHist(); };
      el._api = { start, get g() { return G; }, cfg: () => cfg, onTap };
    },
  });
})();
