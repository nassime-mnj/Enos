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
    { id: "titans", t: "⚔ Choc des Titans", s: "E.N.O.S. contre ETO", human: false },
    { id: "boss", t: "👑 Boss final", s: "Stockfish plein régime", human: false },
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

      el.innerHTML = `
        <div id="df-home">
          <div class="card"><h3>Choisis ton défi</h3><div class="df-modes">${MODES.map((m) => `<button class="df-mode" data-m="${m.id}"><b>${m.t}</b><small>${m.s}</small></button>`).join("")}</div>
            <p class="muted" style="font-size:12.5px;margin-top:10px">Chaque coup est jugé (Brillant, Meilleur, Gaffe…) comme sur le PC. Aucun ordinateur nécessaire.</p></div>
          <div class="card"><h3>Parties récentes<span class="sp" id="df-hn"></span></h3><div id="df-hist" class="list"></div></div>
        </div>
        <div id="df-game" hidden>
          <button class="back" id="df-back" style="margin-bottom:8px">◂ DÉFIS</button>
          <div class="card" style="padding:12px">
            <div class="df-pl" id="df-top"></div>
            <div class="ch-evalbar"><i id="df-eval"></i><b id="df-evt">0,0</b></div>
            <div id="df-board"></div>
            <div class="df-pl" id="df-bot"></div>
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
        $("#df-hist").innerHTML = h.length ? h.map((x, i) => `<div class="it"><span class="n">${esc(x.title)}<small>${esc(x.result)} · ${x.plies} coups · ✦ ${x.brill} brillant${x.brill > 1 ? "s" : ""}${x.acc != null ? " · précision " + x.acc + " %" : ""} · ${new Date(x.t).toLocaleDateString("fr-FR")}</small></span><button class="mini" data-pgn="${h.length - 1 - i}">PGN</button></div>`).join("") : '<p class="muted">Aucune partie pour l\'instant.</p>';
      }
      $("#df-hist").onclick = (e) => { const b = e.target.closest("[data-pgn]"); if (b) A.copy(hist()[+b.dataset.pgn].pgn || ""); };
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
        else if (id === "boss") body = `<label class="fld">Qui affronte le boss ?</label><select id="su-boss" class="sel"><option value="eto">ETO vs Stockfish</option><option value="enos">E.N.O.S. vs Stockfish</option><option value="duo">E.N.O.S. + ETO vs Stockfish</option></select>`;
        const s = E.ui.sheet({ title: m.t, html: body, options: [{ label: "COMMENCER", cls: "pri", fn: () => {
          if (id === "enos") E.settings.set("chess.power", pow);
          if (s.querySelector("#su-elo")) { elo = +s.querySelector("#su-elo").value; E.settings.set("defi.elo", elo); }
          if (s.querySelector("#su-boss")) boss = s.querySelector("#su-boss").value;
          const c = color === "r" ? (Math.random() < 0.5 ? "w" : "b") : color;
          launch(id, { color: c, elo, pow, boss });
        } }, { label: "ANNULER" }] });
        const seg = s.querySelector("#su-col");
        if (seg) seg.querySelectorAll("button").forEach((b) => (b.onclick = () => { color = b.dataset.c; seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); }));
        const pw = s.querySelector("#su-pw");
        if (pw) { const u = () => { pow = +pw.value; s.querySelector("#su-pe").textContent = B.powerToElo(pow) + " Elo"; }; pw.oninput = u; u(); }
      }

      // ------------------------------------------------------------------ partie
      function players(id, o) {
        const hu = { human: true, name: "Toi" };
        if (id === "brillant") return o.color === "w" ? [hu, { kind: "eto", elo: 3200, name: "ETO Brillant" }] : [{ kind: "eto", elo: 3200, name: "ETO Brillant" }, hu];
        if (id === "enos") { const op = { kind: "sf", elo: B.powerToElo(o.pow), power: o.pow, name: "E.N.O.S." }; return o.color === "w" ? [hu, op] : [op, hu]; }
        if (id === "coach") { const op = { kind: "sf", elo: o.elo, power: powerOfElo(o.elo), name: "Bot " + o.elo }; return o.color === "w" ? [hu, op] : [op, hu]; }
        if (id === "speedrun") return [{ kind: "eto", elo: 3200, name: "ETO" }, { kind: "sf", elo: o.elo, power: powerOfElo(o.elo), name: "Bot " + o.elo }];
        if (id === "titans") return [{ kind: "sf", elo: 3200, power: 100, name: "E.N.O.S." }, { kind: "eto", elo: 3200, name: "ETO" }];
        const boss = { kind: "sf", elo: 3200, power: 100, name: "Stockfish" };
        const ch = o.boss === "duo" ? { kind: "duo", elo: 3200, power: 100, name: "E.N.O.S. + ETO" } : o.boss === "enos" ? { kind: "sf", elo: 3200, power: 100, name: "E.N.O.S." } : { kind: "eto", elo: 3200, name: "ETO" };
        return [ch, boss];
      }

      function launch(id, o) {
        const m = MODES.find((x) => x.id === id), pl = players(id, o);
        if (g) g.token++;
        const me = m.human ? (pl[0].human ? "w" : "b") : null;
        g = { id, mode: m, pl: { w: pl[0], b: pl[1] }, me, token: (g ? g.token : 0) + 1, ch: new Chess(), fen: START, evalW: 0, bestUci: "", moves: [], snaps: [], over: "", busy: false, paused: false, sel: "", hint: null, last: null,
          brill: { w: 0, b: 0 }, inBook: true, flip: me === "b", delay: id === "speedrun" ? 250 : id === "boss" ? 700 : 900, o, started: Date.now(), sayN: 0, duoTurn: 0 };
        g.ch.header("Event", m.t.replace(/[^\p{L}\p{N} .]/gu, "").trim(), "White", pl[0].name, "Black", pl[1].name, "Date", new Date().toISOString().slice(0, 10).replace(/-/g, "."));
        $("#df-home").hidden = true; $("#df-game").hidden = false;
        $("#df-judge").hidden = true; $("#df-say").hidden = true; $("#df-moves").innerHTML = "";
        K.loadBook().then((ok) => { if (!ok && g) g.inBook = false; });
        buttons(); paint(); next(g.token);
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
      $("#df-back").onclick = () => { if (g) { g.token++; L.abort && L.abort(); } $("#df-game").hidden = true; $("#df-home").hidden = false; paintHist(); };

      function paint(anim) {
        const pos = B.parse(g.fen), turn = pos.turn;
        const targets = g.sel ? new Chess(g.fen).moves({ square: g.sel, verbose: true }).map((m) => m.to) : [];
        B.render($("#df-board"), pos.m, { flip: g.flip, last: g.last, hint: g.hint, sel: g.sel, targets, check: g.ch.in_check() ? B.kingSquare(pos.m, turn) : "", badge: (() => { const m = g.moves[g.moves.length - 1]; return m && m.uci && m.q && B.BADGES[m.q.key] ? { sq: m.uci.slice(2, 4), key: m.q.key, id: g.moves.length } : null; })(), end: g.ch.in_checkmate() ? { sq: B.kingSquare(pos.m, turn), id: g.moves.length } : null, onTap, anim });
        const strip = (c) => `<span class="df-dot ${c}"></span><b>${esc(sideName(c))}</b><small>${g.pl[c].elo ? g.pl[c].elo + " Elo" : ""}</small><span class="df-br" title="Coups brillants">✦ ${g.brill[c]}</span>`;
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

      async function botMove(fen, p, duo) {
        const ch = new Chess(fen);
        if (p.kind === "eto" || (p.kind === "duo" && duo % 2 === 1)) {
          const m = await K.etoMove(fen, { topMs: 900, sacMs: 1500 });
          return { uci: m.uci, brilliant: m.brilliant };
        }
        if (p.elo < 1300 && Math.random() < Math.max(0, (1300 - p.elo) / 1050 * 0.6)) { const l = ch.moves({ verbose: true }); const m = l[Math.floor(Math.random() * l.length)]; return { uci: m.from + m.to + (m.promotion || "") }; }
        const r = await L.think(fen, p.power || powerOfElo(p.elo), p.power >= 100 ? 1000 : undefined);
        if (!r.uci) throw new Error("Le moteur n'a pas répondu.");
        return { uci: r.uci };
      }

      // joue le coup, le juge, met à jour l'écran puis passe la main
      async function commit(uci, meta, tok) {
        g.busy = true;
        const turn = g.ch.turn(), before = g.fen, evalBefore = g.evalW, bestUci = g.bestUci;
        g.snaps.push({ fen: before, evalW: evalBefore, bestUci, n: g.moves.length, last: g.last, brill: { ...g.brill }, inBook: g.inBook });
        const m = g.ch.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
        if (!m) { g.busy = false; return status("Coup illégal"); }
        g.fen = g.ch.fen(); g.last = [m.from, m.to];
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
        if (g.inBook) {                                               // livre d'ouvertures : un coup de théorie n'est jamais jugé sur une évaluation superficielle (comme « Livre » sur Chess.com)
          const path = g.moves.map((x) => x.san).concat(m.san), name = K.inBook(path);
          if (name == null) g.inBook = false;
          else if (q.key !== "brilliant" && q.loss < 250) { q.key = "book"; q.label = K.QUALITY.book; q.opening = name; }
        }
        ev = j.after; g.evalW = ev.w; g.bestUci = ev.best; g.moves.push({ san: m.san, uci, color: turn, q, bestSan, n: g.moves.length + 1, before: q.before, after: q.after, loss: q.loss, key: q.key, label: q.label, best: bestSan, best_uci: bu && bu !== uci ? bu : "" });
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
        if (humanMove || g.id === "titans") llm(mv, humanMove);
      }
      // commentaire facultatif d'ETO (Groq) pour les coups marquants
      async function llm(mv, humanMove) {
        if (!E.ai || !E.ai.configured() || !E.settings.get("chess.comment", true)) return;
        if (!["brilliant", "blunder", "mistake"].includes(mv.q.key) && !(g.id === "titans" && g.moves.length % 6 === 0)) return;
        const seq = ++g.sayN, tok = g.token, persona = (g.id === "titans" ? (mv.color === "b" ? "eto" : "enos") : E.settings.get("persona", "enos") === "eto" ? "eto" : "enos");
        const q = `Partie d'échecs${g.id === "titans" ? " entre E.N.O.S. (Blancs) et ETO (Noirs)" : ""}. Dernier coup : ${mv.san} par ${g.pl[mv.color].name}, jugé ${mv.q.label} (${mv.q.loss} cp de perte). ${mv.bestSan ? "Le meilleur était " + mv.bestSan + "." : ""} Évaluation : ${K.fmt(g.evalW)} (Blancs). Réagis en UNE phrase courte, dans ton style.`;
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
        g.fen = s.fen; g.evalW = s.evalW; g.bestUci = s.bestUci; g.moves.length = s.n; g.last = s.last; g.brill = s.brill; g.inBook = s.inBook; g.sel = ""; g.hint = null; g.over = ""; g.busy = false;
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
        const rev = K.buildReview(g.moves, g.me || "w");
        const accW = K.buildReview(g.moves, "w").me.accuracy, accB = K.buildReview(g.moves, "b").me.accuracy;
        if (g.mode.human && g.me && !stopped && E.chessLearn) E.chessLearn.addGame(g.me, result, g.pl[g.me === "w" ? "b" : "w"].power || 100);
        if (g.moves.length >= 2) {
          const list = hist(); list.push({ t: Date.now(), title: g.mode.t.replace(/[^\p{L}\p{N} .'-]/gu, "").trim() + " · " + g.pl.w.name + " – " + g.pl.b.name, result, plies: g.moves.length, brill: g.brill.w + g.brill.b, acc: g.me ? (g.me === "w" ? accW : accB) : null, pgn: g.ch.pgn() });
          E.settings.set("defi.hist", list.slice(-20));
        }
        const row = (c) => `<div class="df-sum"><b>${esc(sideName(c))}</b><span>précision ${(c === "w" ? accW : accB) == null ? "—" : (c === "w" ? accW : accB) + " %"}</span><span style="color:#1acfd6">✦ ${g.brill[c]} brillant${g.brill[c] > 1 ? "s" : ""}</span></div>`;
        E.vibrate(40);
        if (g.moves.length >= 2) E.ui.sheet({ title: result, html: `${row("w")}${row("b")}<p class="muted" style="margin-top:10px;font-size:13px">${rev.critical.length ? "Moments clés : " + rev.critical.map((c) => `coup ${Math.ceil(c.n / 2)} (${c.san} ${c.label.toLowerCase()})`).join(", ") + "." : "Aucune gaffe majeure."}</p>`, options: [{ label: "COPIER LE PGN", fn: () => A.copy(g.ch.pgn()) }, { label: "REJOUER", fn: () => launch(g.id, g.o) }, { label: "FERMER" }] });
      }

      el._api = { launch, get g() { return g; }, setup };
      paintHist();
    },
  });
})();
