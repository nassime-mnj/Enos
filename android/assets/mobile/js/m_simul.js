"use strict";
// SIMULTANÉE : N plateaux (2 à 4) en même temps. Un adversaire (ETO par défaut) joue les Blancs sur TOUS les plateaux et fait le tour de table ; chaque plateau a son joueur (toi, un ami sur le téléphone, un bot,
// un personnage ou un chat bot) qui joue les Noirs. Il suffit qu'UN SEUL membre batte l'adversaire pour que toute l'équipe gagne ; si l'adversaire gagne tous les plateaux, c'est lui qui gagne.
// La partie est enregistrée (ordre des coups sur chaque plateau) : Chess Edit en fait un montage « ETO va d'un plateau à l'autre » (js/chess_edit_simul.js).
(() => {
  const E = window.ENOS, esc = E.esc;
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const powerOfElo = (e) => Math.max(1, Math.min(100, Math.round(e <= 1500 ? 1 + (e - 250) / 1250 * 49 : 50 + (e - 1500) / 1700 * 50)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ELOS = [400, 600, 800, 1000, 1200, 1500, 1800, 2200, 2600, 3200];
  const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
  const bots = () => (E.botChat && E.botChat.bots) || {};
  const prof = (id) => (window.ENOS_AIPROF && window.ENOS_AIPROF[id]) || (window.ENOS_STYLE && window.ENOS_STYLE[id]) || null;
  const DEF_ELO = { penoire: 2500, naskolit: 3200, naskurieux: 1500, jester: 1600, ghorghor: 1400, nasko: 1200, lelex: 1300 };

  /** clé de roster -> joueur */
  function player(key) {
    if (key.startsWith("h:")) return { human: true, name: key.slice(2) };
    if (key.startsWith("bot:")) { const e = +key.slice(4); return { kind: "sf", elo: e, power: powerOfElo(e), name: "Bot " + e }; }
    if (key === "stockfish") return { kind: "sf", elo: 3200, power: 100, pure: true, name: "Stockfish" };
    if (key === "eto") return { kind: "eto", elo: 3200, name: (bots().eto && bots().eto.name) || "ETO Brillant", talk: "eto" };
    if (key === "enos") return { kind: "sf", elo: 3200, power: 100, name: "E.N.O.S.", talk: "enos" };
    const b = bots()[key], e = (prof(key) && prof(key).eloEst) || DEF_ELO[key] || 1200;
    return { kind: "sf", elo: e, power: powerOfElo(e), name: b ? b.name : key, talk: b ? key : "" };
  }
  const rosterGroups = () => {
    const ids = Object.keys(bots()).filter((k) => !["eto", "enos", "prime"].includes(k)), ai = E.aiBots ? E.aiBots.ids : [];
    const g = (label, items) => `<optgroup label="${label}">${items.map(([v, n]) => `<option value="${v}">${esc(n)}</option>`).join("")}</optgroup>`;
    return g("Joueurs (à tour de rôle sur le téléphone)", [["h:Toi", "Toi"], ["h:Joueur 2", "Joueur 2"], ["h:Joueur 3", "Joueur 3"], ["h:Joueur 4", "Joueur 4"]])
      + g("Personnages", [["eto", "ETO Brillant"], ["enos", "E.N.O.S."], ["stockfish", "Stockfish"], ...ids.filter((k) => !ai.includes(k)).map((k) => [k, bots()[k].name])])
      + g("Bots Stockfish", ELOS.map((e) => ["bot:" + e, "Bot " + e + " Elo"])) + (ai.length ? g("Chat bots IA", ai.map((k) => [k, bots()[k].name])) : "");
  };

  E.suite.register({
    id: "simul", group: "chess", title: "Simultanée", sub: "4 plateaux · 1 adversaire · un seul doit gagner",
    icon: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
    build(el, A) {
      const $ = (s) => el.querySelector(s), B = E.board, K = E.brain, L = E.chessLocal;
      let S = null;                                                                                    // partie en cours
      el.innerHTML = `<div id="sm-setup"><div class="card"><h3>Simultanée</h3>
          <p class="muted" style="line-height:1.5;margin-bottom:12px">Ton équipe affronte <b>un seul adversaire</b> sur <b>plusieurs plateaux en même temps</b>. Chacun joue son plateau ; <b>il suffit qu'un seul batte l'adversaire</b> pour que toute l'équipe gagne.</p>
          <label class="fld">Adversaire (il joue les Blancs partout)</label><select id="sm-boss" class="sel">${rosterGroups()}</select>
          <label class="fld" style="margin-top:12px">Nombre de plateaux</label><div class="seg" id="sm-n" data-i="2"><button data-n="2">2</button><button data-n="3">3</button><button data-n="4" class="on">4</button><i class="seg-ind"></i></div>
          <div id="sm-mem"></div>
          <div class="row" style="margin-top:14px"><button class="btn pri" id="sm-go">COMMENCER</button></div>
          <p class="ce-stat" id="sm-hist" style="margin-top:10px"></p></div></div>
        <div id="sm-game" hidden>
          <button class="back" id="sm-back">◂ SIMULTANÉE</button>
          <div class="card sm-card"><div class="sm-head"><div class="sm-boss" id="sm-bossav"></div><div class="sm-bn"><b id="sm-bname"></b><small id="sm-bst"></small></div><div class="sm-sc" id="sm-sc"></div></div>
            <div class="sm-thumbs" id="sm-th"></div>
            <div class="df-pl" id="sm-top"></div><div id="sm-board"></div><div class="df-pl" id="sm-bot"></div>
            <div class="ch-moves" id="sm-moves"></div><p class="muted" id="sm-st" style="margin:6px 2px"></p>
            <div class="row"><button class="btn" id="sm-res">ABANDONNER CE PLATEAU</button><button class="btn" id="sm-stop">ARRÊTER</button></div></div></div>`;
      let nB = 4, defMem = E.settings.get("simul.mem", ["h:Toi", "nasko", "lelex", "bot:800"]);
      const drawMem = () => { const keep = [...el.querySelectorAll("#sm-mem select")].map((x) => x.value); $("#sm-mem").innerHTML = Array.from({ length: nB }, (_, i) => `<label class="fld" style="margin-top:8px">Plateau ${i + 1} · joueur</label><select class="sel" data-i="${i}">${rosterGroups()}</select>`).join("");
        el.querySelectorAll("#sm-mem select").forEach((x, i) => { const v = keep[i] || defMem[i] || "bot:800"; x.value = [...x.options].some((o) => o.value === v) ? v : "bot:800"; }); };
      $("#sm-n").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; nB = +b.dataset.n; $("#sm-n").dataset.i = nB - 2; $("#sm-n").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); drawMem(); };
      $("#sm-boss").value = E.settings.get("simul.boss", "eto"); drawMem();
      const paintHist = () => { const h = E.settings.get("simul.hist", []); $("#sm-hist").textContent = h.length ? h.length + " partie(s) enregistrée(s) · ouvre Chess Edit pour en faire un montage" : ""; }; paintHist();

      // ---------------------------------------------------------------- partie
      const mkBoard = (i, member) => ({ i, member, ch: new Chess(), moves: [], over: "", winner: "", busy: false, waiting: false, evalW: 0, bestUci: "", sel: "", last: null, seen: L.startSeen(START) });
      function start(cfg) {
        if (S) S.token++;
        const boss = player(cfg.boss), mem = cfg.members.map(player);
        { const base = mem.map((m) => m.name); mem.forEach((m, i) => { const dup = base.slice(0, i).filter((x) => x === base[i]).length; if (dup) m.name = base[i] + " (" + (dup + 1) + ")"; }); }
        S = { token: (S ? S.token : 0) + 1, boss, boards: mem.map((m, i) => mkBoard(i, m)), order: [], view: 0, over: "", t0: Date.now(), bossAt: -1, id: Date.now() };
        E.settings.set("simul.boss", cfg.boss); E.settings.set("simul.mem", cfg.members);
        $("#sm-setup").hidden = true; $("#sm-game").hidden = false; $("#sm-bossav").innerHTML = E.botChat && boss.talk ? E.botChat.avatar(boss.talk) : '<div class="bot-av ph" style="--c:#8d8d97">SF</div>'; $("#sm-bname").textContent = boss.name;
        paint(); loop(S.token);
      }
      const cur = () => S.boards[S.view];
      function paint() {
        if (!S) return; const b = cur(), pos = B.parse(b.ch.fen());
        const targets = b.sel ? b.ch.moves({ square: b.sel, verbose: true }).map((m) => m.to) : [];
        B.render($("#sm-board"), pos.m, { flip: !!b.member.human, last: b.last, sel: b.sel, targets, check: b.ch.in_check() ? B.kingSquare(pos.m, pos.turn) : "", onTap });
        $("#sm-top").innerHTML = b.member.human ? `<b>${esc(S.boss.name)}</b><small>Blancs</small>` : `<b>${esc(b.member.name)}</b><small>Noirs · plateau ${b.i + 1}</small>`;
        $("#sm-bot").innerHTML = b.member.human ? `<b>${esc(b.member.name)}</b><small>Noirs · plateau ${b.i + 1}</small>` : `<b>${esc(S.boss.name)}</b><small>Blancs</small>`;
        $("#sm-moves").innerHTML = b.moves.map((m, i) => `<span style="${["brilliant", "blunder", "mistake"].includes(m.key) ? "color:" + ({ brilliant: "#1acfd6", blunder: "#ff4a3a", mistake: "#ff9a1f" })[m.key] : ""}">${i % 2 === 0 ? (i / 2 + 1) + "." : ""}${esc(m.san)}${m.key === "brilliant" ? "!!" : ""}</span>`).join(" "); $("#sm-moves").scrollLeft = 1e5;
        $("#sm-th").innerHTML = S.boards.map((x) => `<button class="sm-t${x.i === S.view ? " on" : ""}${x.waiting ? " wait" : ""}${x.over ? " done" : ""}" data-i="${x.i}"><canvas width="96" height="96" data-f="${x.ch.fen()}"></canvas><span>${esc(x.member.name)}</span><i class="${x.over ? (x.winner === "b" ? "w" : x.winner === "w" ? "l" : "d") : x.waiting ? "t" : ""}"></i></button>`).join("");
        $("#sm-th").querySelectorAll("canvas").forEach((c) => thumb(c, c.dataset.f));
        const won = S.boards.filter((x) => x.winner === "b").length, lost = S.boards.filter((x) => x.winner === "w").length;
        $("#sm-sc").innerHTML = `<span class="g">${won}</span><span class="r">${lost}</span>`;
        $("#sm-bst").textContent = S.over ? S.over : S.bossAt >= 0 ? "plateau " + (S.bossAt + 1) : "";
        $("#sm-st").textContent = status(b);
      }
      function status(b) { if (S.over) return S.over; if (b.over) return b.over; if (b.member.human && b.ch.turn() === "b") return "À " + (b.member.name === "Toi" ? "toi" : b.member.name) + " de jouer"; return b.busy ? S.boss.name + " réfléchit…" : "En attente"; }
      function thumb(c, fen) {
        const g = c.getContext("2d"), m = B.parse(fen).m, s = c.width / 8; g.clearRect(0, 0, c.width, c.height);
        for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) { g.fillStyle = (r + f) % 2 ? "#4a5068" : "#cfd3e6"; g.fillRect(f * s, r * s, s, s); }
        g.textAlign = "center"; g.textBaseline = "middle"; g.font = (s * 0.95) + "px serif"; Object.keys(m).forEach((sq) => { const f = sq.charCodeAt(0) - 97, r = 8 - +sq[1]; g.fillStyle = m[sq] === m[sq].toUpperCase() ? "#fff" : "#10131c"; g.strokeStyle = m[sq] === m[sq].toUpperCase() ? "#10131c" : "#fff"; g.lineWidth = 1.4; const ch = GLYPH[m[sq].toLowerCase()] || "?"; g.strokeText(ch, f * s + s / 2, r * s + s / 2 + 1); g.fillText(ch, f * s + s / 2, r * s + s / 2 + 1); });
      }
      $("#sm-th").onclick = (e) => { const t = e.target.closest(".sm-t"); if (!t || !S) return; S.view = +t.dataset.i; cur().sel = ""; paint(); };
      function onTap(sq) {
        if (!S || S.over) return; const b = cur(); if (!b.member.human || b.over || b.busy || b.ch.turn() !== "b") return;
        if (b.sel && b.ch.moves({ square: b.sel, verbose: true }).some((m) => m.to === sq)) { const from = b.sel; b.sel = ""; return applyMove(b, from + sq + (b.ch.get(from).type === "p" && sq[1] === "1" ? "q" : ""), "b"); }
        const p = b.ch.get(sq); b.sel = p && p.color === "b" ? sq : ""; if (b.sel) E.vibrate(6); paint();
      }

      // jouer un coup sur un plateau, le juger, enregistrer l'ordre
      async function applyMove(b, uci, color, meta) {
        const tok = S.token, before = b.ch.fen(), evBefore = b.evalW, bestUci = b.bestUci; b.busy = true; if (color === "b") b.waiting = false;
        const m = b.ch.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); if (!m) { b.busy = false; return false; }
        b.last = [m.from, m.to]; b.seen = L.addSeen(b.seen, b.ch.fen()); E.chessSound && E.chessSound.forSan(m.san); S.order.push([b.i, b.moves.length]);
        if (S.view !== b.i && color === "b" && b.member.human) S.view = b.i;
        paint(); let ev; try { ev = await K.evaluate(b.ch.fen(), 220); } catch (e) { ev = { w: evBefore, best: "" }; } if (tok !== S.token) return false;
        let j; try { j = await K.judge(before, uci, { w: evBefore, best: bestUci }, ev, color, 220); } catch (e) { j = { q: K.quality(before, uci, evBefore, ev.w, color), before: { w: evBefore, best: bestUci }, after: ev }; } if (tok !== S.token) return false;
        const q = j.q, bu = j.before.best || bestUci, bestSan = bu && bu !== uci ? K.san(before, bu) : "";
        if (meta && meta.brilliant && q.loss <= 60) { q.key = "brilliant"; q.label = K.QUALITY.brilliant; } if (bu && uci === bu && q.key !== "brilliant" && q.loss <= 8) { q.key = "best"; q.label = K.QUALITY.best; }
        b.evalW = j.after.w; b.bestUci = j.after.best; b.moves.push({ uci, san: m.san, color, key: q.key, loss: q.loss | 0, ew: j.after.w, best: bestSan, by: color === "w" ? S.boss.name : b.member.name });
        b.busy = false;
        if (b.ch.game_over()) { b.over = b.ch.in_checkmate() ? "Échec et mat — " + (color === "w" ? S.boss.name : b.member.name) + " gagne" : "Nulle"; b.winner = b.ch.in_checkmate() ? color : "d"; E.vibrate([20, 30, 20]); }
        paint(); checkEnd(); return true;
      }
      function checkEnd() {
        if (S.over) return; const team = S.boards.find((x) => x.winner === "b");
        if (team) return finish("team", team); if (S.boards.every((x) => x.over)) return finish(S.boards.every((x) => x.winner === "w") ? "boss" : "draw");
      }
      async function botMove(p, b) {
        const fen = b.ch.fen(), ch = new Chess(fen);
        if (p.kind === "eto") { const m = await K.etoMove(fen, { topMs: 600, sacMs: 900 }); return { uci: m.uci, brilliant: m.brilliant }; }
        if (p.elo < 1300 && Math.random() < Math.max(0, (1300 - p.elo) / 1050 * 0.6)) { const l = ch.moves({ verbose: true }); const m = l[Math.floor(Math.random() * l.length)]; return { uci: m.from + m.to + (m.promotion || "") }; }
        const r = await L.choose(fen, p.power || powerOfElo(p.elo), b.seen, { pure: !!p.pure, ms: p.power >= 100 ? 700 : undefined }); if (!r || !r.uci) throw new Error("Le moteur n'a pas répondu."); return { uci: r.uci };
      }
      // l'adversaire fait le tour de table ; les bots répondent aussitôt, les humains quand ils veulent
      async function loop(tok) {
        while (S && tok === S.token && !S.over) {
          let k = -1; for (let d = 1; d <= S.boards.length; d++) { const i = (Math.max(S.bossAt, -1) + d) % S.boards.length, b = S.boards[i]; if (!b.over && !b.busy && b.ch.turn() === "w") { k = i; break; } }
          if (k < 0) { S.boards.forEach((b) => { b.waiting = !b.over && b.member.human && b.ch.turn() === "b"; }); const w = S.boards.find((b) => b.waiting); if (w && S.boards[S.view].over) S.view = w.i; paint(); await sleep(300); continue; }
          const b = S.boards[k]; S.bossAt = k; b.busy = true; paint(); let mv;
          try { mv = await botMove(S.boss, b); } catch (e) { b.busy = false; $("#sm-st").textContent = "✕ " + e.message; return; } if (tok !== S.token) return;
          b.busy = false; await applyMove(b, mv.uci, "w", mv); if (tok !== S.token || S.over) return; await sleep(250);
          if (!b.over && !b.member.human && b.ch.turn() === "b") { b.busy = true; let r; try { r = await botMove(b.member, b); } catch (e) { b.busy = false; return; } if (tok !== S.token) return; b.busy = false; await applyMove(b, r.uci, "b", r); if (tok !== S.token || S.over) return; }
          else if (!b.over && b.member.human) { b.waiting = true; if (S.boards.filter((x) => !x.over).length) S.view = k; paint(); }
        }
      }
      $("#sm-res").onclick = () => { if (!S || S.over) return; const b = cur(); if (b.over) return; E.ui.confirm("Abandonner ce plateau ?", "L'adversaire gagne ce plateau.", "ABANDONNER", true).then((ok) => { if (ok && S && !b.over) { b.over = "Abandon — " + S.boss.name + " gagne"; b.winner = "w"; paint(); checkEnd(); } }); };
      $("#sm-stop").onclick = () => { if (S) { S.token++; S.over = "Partie arrêtée"; paint(); save(null); } };
      $("#sm-back").onclick = () => { if (S) S.token++; $("#sm-game").hidden = true; $("#sm-setup").hidden = false; paintHist(); };
      $("#sm-go").onclick = () => { const mem = [...el.querySelectorAll("#sm-mem select")].map((x) => x.value); start({ boss: $("#sm-boss").value, members: mem }); };

      // ---------------------------------------------------------------- fin + enregistrement
      function save(kind, team) {
        const boards = S.boards.map((b) => ({ name: b.member.name, talk: b.member.talk || "", human: !!b.member.human, elo: b.member.elo || 0, mv: b.moves.map((m) => [m.uci, m.san, m.key, m.loss, m.ew, m.best, m.by]), result: b.over ? b.winner : "*" }));
        const total = boards.reduce((a, b) => a + b.mv.length, 0); if (total < 4) return null;
        const longest = boards.slice().sort((a, b) => b.mv.length - a.mv.length)[0], names = S.boards.map((b) => b.member.name);
        const rec = { t: S.id, title: "Simultanée · " + S.boss.name + " vs " + names.join(", "), result: kind === "team" ? "L'équipe gagne" : kind === "boss" ? S.boss.name + " gagne" : kind === "draw" ? "Nulle" : "Partie arrêtée", plies: total, brill: S.boards.reduce((a, b) => a + b.moves.filter((m) => m.key === "brilliant").length, 0),
          pw: names.join(" + "), pb: S.boss.name, pk: ["team", "team"], me: null, ch: [], mv: longest.mv, simul: { boss: { name: S.boss.name, talk: S.boss.talk || "", elo: S.boss.elo || 0, kind: S.boss.kind || "" }, boards, order: S.order.slice(), team: kind === "team" ? team.i : -1 } };
        const list = E.settings.get("simul.hist", []).filter((x) => x.t !== rec.t); list.push(rec); E.settings.set("simul.hist", list.slice(-8)); return rec;
      }
      function finish(kind, team) {
        S.over = kind === "team" ? "L'équipe gagne ! " + team.member.name + " a battu " + S.boss.name : kind === "boss" ? S.boss.name + " gagne tous les plateaux" : "Nulle";
        S.token++; const rec = save(kind, team); paint(); E.vibrate([30, 40, 30]);
        E.ui.sheet({ title: kind === "team" ? "L'ÉQUIPE GAGNE !" : kind === "boss" ? S.boss.name.toUpperCase() + " GAGNE" : "NULLE", html: `<p class="muted" style="line-height:1.5;margin-bottom:12px">${esc(S.over)}</p>`, options: [...(rec && E.chessEdit ? [{ label: "🎬 CRÉER L'EDIT", cls: "pri", fn: () => E.chessEdit.open(rec) }] : []), { label: "FERMER" }] });
      }
      el._api = { start, get S() { return S; }, applyMove: (i, uci, color) => applyMove(S.boards[i], uci, color), finish, save: (k, t) => save(k, t), paint };
    },
  });
})();
