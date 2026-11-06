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
      let cfg = Object.assign({ color: "w", mode: "human" }, E.settings.get("prime.cfg", {}));
      let G = null;
      const badge = () => (E.botChat ? E.botChat.badge("GM") : "");
      el.innerHTML = `
        <div id="pr-home">
          <div class="card pr-hero"><img class="pr-av" src="${E.assetBase || ""}img/bots/prime.png" alt="ChatGPT Prime">
            <div><h3>${badge()}ChatGPT Prime <small>9999 Elo</small></h3>
              <p class="muted">Il joue normalement au début… puis il <b>triche</b> : pièces qui se téléportent, qui apparaissent de nulle part, qui sautent par-dessus les autres, le roi qui mange son fou puis le ressuscite. Il explique chaque coup avec un aplomb <b>qui ne veut rien dire</b>, et il s'en sort <b>à chaque fois</b>. Aucune IA n'est interrogée (zéro token).</p></div></div>
          <div class="card"><div class="seg" id="pr-mode"><button data-m="human">TOI CONTRE PRIME</button><button data-m="sf">STOCKFISH CONTRE PRIME</button><i class="seg-ind"></i></div>
            <div class="seg" id="pr-col" style="margin-top:10px"><button data-c="w">BLANCS</button><button data-c="b">NOIRS</button><button data-c="r">AU HASARD</button><i class="seg-ind"></i></div>
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
      const syncA = seg("#pr-mode", "m", () => cfg.mode, (v) => (cfg.mode = v)), syncB = seg("#pr-col", "c", () => cfg.color, (v) => (cfg.color = v));
      const hist = () => E.settings.get("variants.hist", []).filter((x) => x.mode === "prime");
      function paintHist() {
        const h = hist().slice().reverse(); $("#pr-hn").textContent = h.length ? h.length + " partie" + (h.length > 1 ? "s" : "") : "";
        $("#pr-hist").innerHTML = h.length ? h.map((x, i) => `<div class="it"><span class="n">${esc(x.title)}<small>${esc(x.result)} · ${x.plies} coups</small></span><button class="btn" data-edit="${i}">✂ ÉDITER</button></div>`).join("") : '<p class="muted">Aucune partie pour l\'instant.</p>';
      }
      $("#pr-hist").onclick = (e) => { const b = e.target.closest("[data-edit]"); if (b && E.chessEdit) E.chessEdit.open(hist().slice().reverse()[+b.dataset.edit]); };
      A.onShow = A.onShow || null; paintHist();

      // ------------------------------------------------------------------ partie
      const nameOf = (side) => (side === G.primeSide ? "ChatGPT Prime" : G.mode === "sf" ? "Stockfish" : "Toi");
      function strip(side) {
        const prime = side === G.primeSide;
        return prime ? `<span class="df-dot ${side}"></span>${badge()}<b>ChatGPT Prime</b><small>9999 Elo</small>` : `<span class="df-dot ${side}"></span><b>${nameOf(side)}</b>`;
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
        say(a.say); await new Promise((r) => setTimeout(r, 900));
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
        const prime = G.primeSide, acts = G.acts.map((a) => Object.assign({}, a)), winner = G.over && G.over.winner ? G.over.winner : prime;
        const names = prime === "w" ? ["ChatGPT Prime", nameOf("b")] : [nameOf("w"), "ChatGPT Prime"];
        const result = (winner === prime ? "ChatGPT Prime gagne" : nameOf(winner) + " gagne") + " · " + why;
        const rec = { variant: true, mode: "prime", t: Date.now(), title: "🤖 ChatGPT Prime · " + names[0] + " – " + names[1], result, plies: acts.length, brill: 0, acc: null, cheats: G.st.cheats, pgn: "", id: "prime", pw: names[0], pb: names[1], pk: ["variant", "variant"], bw: 0, bb: 0,
          me: G.mode === "human" ? (prime === "w" ? "b" : "w") : null, accW: null, accB: null, ch: [], mv: acts.map((a) => [a.uci, a.san, a.key || "good", 0, null, ""]), v: { mode: "prime", acts, start: P.START, over: G.over ? G.over.why : "end", duo: false, beaten: !!(G.over && G.over.why === "twist") } };
        if (acts.length >= 2) { const l = E.settings.get("variants.hist", []); l.push(rec); E.settings.set("variants.hist", l.slice(-40)); }
        return rec;
      }
      function finish(why, over) {
        G.over = over || G.over || { why: "end" }; G.busy = false; const rec = record(why); G.rec = rec; status(rec.result);
        $("#pr-btns").innerHTML = `<button class="btn pri" id="pr-again">↻ REJOUER</button><button class="btn" id="pr-edit">✂ ÉDITER CETTE PARTIE</button>`;
        $("#pr-again").onclick = () => start(); $("#pr-edit").onclick = () => E.chessEdit && E.chessEdit.open(rec); if (G.over.why === "kill") say(G.acts[G.acts.length - 1].say);
      }
      const gameOverNow = () => { const ch = new Chess(G.st.fen); return ch.game_over() ? ch : null; };
      async function primeTurn(danger) {
        if (!G || G.over) return; G.busy = true; status("ChatGPT Prime réfléchit… (ou pas)"); await new Promise((r) => setTimeout(r, 700));
        const tok = G.token, r = await P.turn(G.st, { L, danger, weak: 18 }); if (!G || tok !== G.token) return;
        for (const a of r.acts) { if (!G || tok !== G.token) return; await playAct(a); }
        if (r.over) return finish(r.over.why === "kill" ? "échec et mat" : "fin", r.over);
        const go = gameOverNow(); if (go) return finish(go.in_checkmate() ? "échec et mat" : go.in_stalemate() ? "pat… selon Prime, c'est une victoire" : "nulle (Prime conteste)", { why: go.in_checkmate() ? "mate" : "draw", winner: G.primeSide });
        if (G.acts.length > 220) return finish("fatigue (Prime déclare la victoire)", { why: "long", winner: G.primeSide });
        G.busy = false; if (G.mode === "sf") sfTurn(); else status("À toi de jouer.");
      }
      async function sfTurn() {                                                                       // mode spectateur : Stockfish joue l'autre camp
        if (!G || G.over) return; G.busy = true; status("Stockfish réfléchit…"); const tok = G.token; await new Promise((r) => setTimeout(r, 500));
        const fen = G.st.fen; let uci = ""; try { const r = await L.think(fen, 100, 350); uci = r.uci; } catch (e) { uci = ""; } if (!G || tok !== G.token) return;
        const ch = new Chess(fen), mv = ch.moves({ verbose: true }), m = mv.find((x) => x.from + x.to + (x.promotion || "") === uci) || mv[0];
        if (!m) return finish("Stockfish n'a plus de coup", { why: "end", winner: G.primeSide });
        const lost = m.captured && "nbrq".includes(m.captured) ? 1 : 0; ch.move(m); await human(m, ch);
        if (!G || tok !== G.token) return; const go = gameOverNow(); if (go) return go.in_checkmate() ? twist() : finish("nulle", { why: "draw", winner: G.primeSide });
        primeTurn(false);
      }
      async function human(m, ch) {                                                                  // joue le coup de l'autre camp (toi / Stockfish)
        const a = { k: "mv", side: m.color, seat: m.color === "w" ? 0 : 1, key: "good", ev: null, from: m.from, to: m.to, piece: m.piece, cap: m.captured || "", promo: m.promotion || "", uci: m.from + m.to + (m.promotion || ""), san: m.san, fen: ch.fen(), cheat: "" };
        G.acts.push(a); G.st.fen = a.fen; G.sel = null; G.last = [m.from, m.to]; paint(G.last, { anim: m.from + m.to }); try { E.chessSound.forSan(m.san); } catch (e) { /* son facultatif */ }
        await new Promise((r) => setTimeout(r, 450));
      }
      async function onTap(sq) {
        if (!G || G.over || G.busy || G.mode !== "human") return; const ch = new Chess(G.st.fen); if ((ch.turn() === "w") === (G.primeSide === "w")) return;
        const mv = G.sel ? ch.moves({ square: G.sel, verbose: true }).filter((x) => x.to === sq) : [];
        if (mv.length) { G.busy = true; const m = mv.find((x) => x.promotion === "q") || mv[0]; ch.move(m); const lost = m.captured && "nbrq".includes(m.captured); await human(m, ch); const go = gameOverNow(); if (go) return go.in_checkmate() ? twist() : finish("nulle", { why: "draw", winner: G.primeSide }); return primeTurn(!!lost); }
        const p = ch.get(sq); G.sel = p && p.color === ch.turn() ? sq : null; paint(); if (G.sel) B.burst($("#pr-board"), sq, "tap");
      }
      function start() {
        const col = cfg.color === "r" ? (Math.random() < 0.5 ? "w" : "b") : cfg.color; E.settings.set("prime.cfg", cfg);
        const humanSide = col, primeWhite = humanSide === "b";
        G = { mode: cfg.mode, primeSide: primeWhite ? "w" : "b", st: P.newState(primeWhite, Math.random() < (cfg.beat == null ? 0.35 : cfg.beat)), acts: [], sel: null, last: null, busy: false, over: null, token: Math.random(), flip: cfg.mode === "human" ? humanSide === "b" : false };
        $("#pr-home").hidden = true; $("#pr-game").hidden = false; say("Je suis un Grand Maître à 9999 Elo. Les règles ? Je les connais toutes. Je les applique selon mon humeur."); paint();
        $("#pr-btns").innerHTML = `<button class="btn" id="pr-stop">ABANDONNER</button>`; $("#pr-stop").onclick = () => finish("tu abandonnes (Prime accepte avec élégance)", { why: "resign", winner: G.primeSide });
        if (primeWhite || cfg.mode === "sf") { if (primeWhite) primeTurn(false); else sfTurn(); } else status("À toi de jouer.");
      }
      $("#pr-go").onclick = start;
      $("#pr-back").onclick = () => { if (G) G.token = Math.random(); G = null; $("#pr-game").hidden = true; $("#pr-home").hidden = false; paintHist(); };
      el._api = { start, get g() { return G; }, cfg: () => cfg, onTap };
    },
  });
})();
