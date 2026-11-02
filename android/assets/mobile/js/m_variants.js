"use strict";
// VARIANTES D'ÉCHECS (inventions maison) : ÉLIXIR (Clash Royale), DEUX ROIS, PROTÈGE LA DAME. Règles et IA : js/variants.js. Plateau : js/board.js.
(() => {
  const E = window.ENOS, esc = E.esc, V = E.variants;
  const LV = { 1: "Débutant", 2: "Moyen", 3: "Fort" };
  const stat = () => E.settings.get("variants.stats", {});
  const bump = (mode, k) => { const s = stat(); s[mode] = s[mode] || { w: 0, l: 0, d: 0 }; s[mode][k]++; E.settings.set("variants.stats", s); };
  const ICON = { elixir: "💧", dk: "♚♚", ptq: "♛" };
  const RULES = {
    elixir: ["Départ : <b>seulement les deux rois</b>.", "Pose une pièce dans <b>tes 2 premières rangées</b> en payant de l'<b>élixir</b> 💧.", "Chaque <b>coup joué</b> rapporte <b>+1 élixir</b> (max 10). <b>Poser ne coûte pas le coup</b> : tu poses, puis tu joues.", "Pion 1 · Cavalier 3 · Fou 3 · Tour 5 · <b>Dame 8</b>. Économise en bougeant une pièce."],
    dk: ["<b>Pas de dame</b> : deux rois par camp.", "<b>Si l'un des deux rois est maté, la partie est finie.</b>", "Tu dois toujours mettre tes deux rois à l'abri de l'échec.", "Pas de roque."],
    ptq: ["Le <b>roi est sacrifiable</b> : il peut être pris, il ne craint pas l'échec.", "<b>Si la dame est matée, la partie est finie.</b> Toute l'armée doit la protéger.", "Pas de promotion en dame (ce serait une 2ᵉ cible). Pas de roque."],
  };

  E.suite.register({
    id: "variants", group: "chess", title: "Variantes d'échecs", sub: "Élixir · Deux rois · Protège la dame",
    icon: '<path d="M12 2c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"/>',
    onShow() {},
    build(el) {
      const $ = (s) => el.querySelector(s);
      let cfg = Object.assign({ mode: "elixir", opp: 2, side: "w" }, E.settings.get("variants.cfg", {}));
      let G = null, token = 0, sel = -1, tray = "", busy = false;

      el.innerHTML = `
        <div id="va-setup">
          <div class="card"><h3>🧪 Variantes d'échecs</h3><p class="muted">Des règles inventées. Choisis une variante, ton adversaire, et c'est parti.</p>
            <div class="va-modes" id="va-modes">${Object.values(V.MODES).map((m) => `<button data-m="${m.id}"><span class="va-ic">${ICON[m.id]}</span><b>${esc(m.name)}</b><small>${esc(m.tag)}</small></button>`).join("")}</div>
            <ul class="va-rules" id="va-rules"></ul></div>
          <div class="card va-opts">
            <label>Adversaire<select id="va-opp"><option value="1">Bot débutant</option><option value="2">Bot moyen</option><option value="3">Bot fort</option><option value="0">2 joueurs (même téléphone)</option></select></label>
            <label>Ma couleur<select id="va-side"><option value="w">Blancs</option><option value="b">Noirs</option><option value="r">Au hasard</option></select></label></div>
          <div class="row"><button class="btn pri" id="va-go">▶ JOUER</button></div>
          <div class="card"><h3>Bilan</h3><div id="va-stats" class="muted"></div></div>
        </div>
        <div id="va-game" hidden>
          <button class="back" id="va-back">◂ MENU</button>
          <div class="va-bar va-top"><b id="va-topn"></b><span class="va-elx" id="va-topx"></span></div>
          <div id="va-board"></div>
          <div class="va-bar va-bot"><b id="va-botn"></b><span class="va-elx" id="va-botx"></span></div>
          <div class="va-msg" id="va-msg">&nbsp;</div>
          <div class="va-tray" id="va-tray" hidden></div>
          <div class="row"><button class="btn" id="va-undo">↶ ANNULER</button><button class="btn" id="va-new">↻ REJOUER</button></div>
          <div class="va-end" id="va-end" hidden></div>
        </div>`;

      const save = () => E.settings.set("variants.cfg", cfg);
      function paintSetup() {
        el.querySelectorAll("#va-modes button").forEach((b) => b.classList.toggle("on", b.dataset.m === cfg.mode));
        $("#va-rules").innerHTML = RULES[cfg.mode].map((r) => `<li>${r}</li>`).join("");
        $("#va-opp").value = String(cfg.opp); $("#va-side").value = cfg.side;
        const s = stat(), line = (m) => { const x = s[m.id] || { w: 0, l: 0, d: 0 }; return `<div>${ICON[m.id]} <b>${esc(m.name)}</b> · ${x.w} victoire(s) · ${x.l} défaite(s) · ${x.d} nulle(s)</div>`; };
        $("#va-stats").innerHTML = Object.values(V.MODES).map(line).join("");
      }
      el.querySelectorAll("#va-modes button").forEach((b) => (b.onclick = () => { cfg.mode = b.dataset.m; save(); paintSetup(); }));
      $("#va-opp").onchange = (e) => { cfg.opp = +e.target.value; save(); };
      $("#va-side").onchange = (e) => { cfg.side = e.target.value; save(); };

      // ------------------------------------------------------------------ partie
      const botSide = () => (cfg.opp ? (G.me === "w" ? "b" : "w") : "");
      const isHuman = () => G && !G.over && G.s.side !== botSide();
      const nameOf = (side) => (!cfg.opp ? (side === "w" ? "Blancs" : "Noirs") : side === G.me ? "Toi" : "Bot " + LV[cfg.opp].toLowerCase());

      function launch() {
        token++;
        const me = cfg.side === "r" ? (Math.random() < 0.5 ? "w" : "b") : cfg.side;
        G = { s: V.newGame(cfg.mode), me: cfg.opp ? me : "w", hist: [], over: false, last: null, anim: "", mv: [] };
        sel = -1; tray = ""; busy = false;
        $("#va-setup").hidden = true; $("#va-game").hidden = false; $("#va-end").hidden = true;
        $("#va-undo").style.display = "";
        render(); if (!isHuman()) botTurn();
      }
      const snap = () => G.hist.push({ s: V.clone(G.s), last: G.last, mv: G.mv.slice() });

      function elixirBar(side) {
        if (cfg.mode !== "elixir") return "";
        const x = G.s.elixir[side];
        return `<span class="va-pips">${Array.from({ length: V.ELIXIR_MAX }, (_, i) => `<i class="${i < x ? "on" : ""}"></i>`).join("")}</span><b class="va-xn">💧 ${x}</b>`;
      }
      function render() {
        const s = G.s, flip = G.me === "b", map = V.map(s);
        const human = isHuman();
        let targets = [];
        if (human && sel >= 0) targets = V.legalFrom(s, sel).map((m) => V.sqName(m.t));
        else if (human && tray) targets = V.dropSquares(s, tray).map(V.sqName);
        const chk = V.inCheck(s) ? V.royals(s, s.side) : [];
        const mateSq = G.over && G.res && G.res.why === "mate" ? V.royals(s, s.side).filter((i) => V.attacked(s.b, i, s.side === "w" ? "b" : "w"))[0] : -1;
        E.board.render($("#va-board"), map, { flip, last: G.last, sel: sel >= 0 ? V.sqName(sel) : "", targets, check: !G.over && chk.length ? V.sqName(chk.find((i) => V.attacked(s.b, i, s.side === "w" ? "b" : "w")) ?? chk[0]) : "", end: mateSq >= 0 ? { sq: V.sqName(mateSq), id: G.hist.length + 1 } : null, anim: G.anim, onTap });
        G.anim = "";
        const top = flip ? "w" : "b", bot = flip ? "b" : "w";
        $("#va-topn").textContent = nameOf(top); $("#va-botn").textContent = nameOf(bot);
        $("#va-topx").innerHTML = elixirBar(top); $("#va-botx").innerHTML = elixirBar(bot);
        el.querySelectorAll(".va-bar").forEach((b) => b.classList.remove("turn")); (s.side === top ? $(".va-top") : $(".va-bot")).classList.toggle("turn", !G.over);
        // pièces à poser (élixir)
        const tr = $("#va-tray");
        tr.hidden = cfg.mode !== "elixir" || G.over || !human;
        if (!tr.hidden) {
          const W = s.side === "w", x = s.elixir[s.side];
          tr.innerHTML = ["p", "n", "b", "r", "q"].map((t) => `<button data-t="${t}" class="${tray === t ? "on" : ""}" ${x < V.COST[t] ? "disabled" : ""}><img src="img/chess/${W ? "w" : "b"}${t}.png" alt=""><b>💧${V.COST[t]}</b></button>`).join("");
          tr.querySelectorAll("button").forEach((b) => (b.onclick = () => { tray = tray === b.dataset.t ? "" : b.dataset.t; sel = -1; render(); }));
        }
        const m = $("#va-msg");
        if (G.over) m.textContent = "";
        else if (!human) m.textContent = cfg.opp ? "Le bot réfléchit…" : "";
        else if (chk.length) m.textContent = cfg.mode === "ptq" ? "⚠ Ta dame est en échec !" : cfg.mode === "dk" ? "⚠ Un de tes rois est en échec !" : "⚠ Ton roi est en échec !";
        else if (tray) m.textContent = "Touche une case de tes 2 premières rangées pour poser.";
        else m.textContent = cfg.opp ? "À toi de jouer." : (s.side === "w" ? "Aux Blancs." : "Aux Noirs.");
        $("#va-undo").disabled = !G.hist.length || busy;
      }

      async function onTap(name) {
        if (!isHuman() || busy) return;
        const s = G.s, i = V.sqIdx(name), p = s.b[i];
        if (tray) {
          if (V.canDrop(s, tray, i)) { snap(); V.drop(s, tray, i); G.mv.push("💧" + tray.toUpperCase() + name); tray = ""; sel = -1; render(); return; }
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
        if (p && (p === p.toUpperCase()) === (s.side === "w")) { sel = sel === i ? -1 : i; render(); } else { sel = -1; render(); }
      }

      async function playMove(m) {
        snap();
        const uci = V.sqName(m.f) + V.sqName(m.t) + (m.promo || "");
        G.mv.push(V.moveText(m)); G.last = [V.sqName(m.f), V.sqName(m.t)]; G.anim = uci;
        V.play(G.s, m); sel = -1; tray = "";
        const st = V.status(G.s);
        if (st.over) return finish(st);
        render();
        if (!isHuman()) botTurn();
      }

      function botTurn() {
        const my = ++token;
        busy = true; render();
        setTimeout(() => {
          if (my !== token || !G || G.over) return;
          const a = V.think(G.s, cfg.opp);
          busy = false;
          if (!a.move) { finish(V.status(G.s)); return; }
          // le bot pose ses pièces (on les voit apparaître), puis joue
          a.drops.forEach((d) => { V.drop(G.s, d.type, d.sq); G.mv.push("💧" + d.type.toUpperCase() + V.sqName(d.sq)); });
          if (a.drops.length) { render(); setTimeout(() => { if (my === token && G && !G.over) botMove(a.move); }, 650); } else botMove(a.move);
        }, 420);
      }
      function botMove(m) {
        G.mv.push(V.moveText(m)); G.last = [V.sqName(m.f), V.sqName(m.t)]; G.anim = V.sqName(m.f) + V.sqName(m.t) + (m.promo || "");
        V.play(G.s, m);
        const st = V.status(G.s);
        if (st.over) return finish(st);
        render();
      }

      function finish(st) {
        G.over = true; G.res = st; busy = false; sel = -1; tray = "";
        render();
        const win = st.result;
        let t, k;
        if (win === "draw") { t = "Partie nulle"; k = "d"; }
        else if (!cfg.opp) { t = (win === "w" ? "Les Blancs" : "Les Noirs") + " gagnent"; k = ""; }
        else if (win === G.me) { t = "Victoire !"; k = "w"; }
        else { t = "Défaite…"; k = "l"; }
        const why = { mate: cfg.mode === "ptq" ? "Dame matée." : cfg.mode === "dk" ? "Un roi est maté." : "Échec et mat.", pat: "Pat : plus aucun coup possible.", 50: "Règle des 50 coups.", long: "Partie trop longue." }[st.why];
        if (k) bump(cfg.mode, k);
        const e = $("#va-end"); e.hidden = false;
        e.className = "va-end " + (k === "w" ? "win" : k === "l" ? "lose" : "");
        e.innerHTML = `<h3>${t}</h3><p>${why}</p><div class="row"><button class="btn pri" id="va-again">↻ REJOUER</button><button class="btn" id="va-menu">MENU</button></div>`;
        $("#va-again").onclick = launch; $("#va-menu").onclick = back;
        $("#va-undo").style.display = "none";
      }

      function undo() {
        if (!G || !G.hist.length || busy) return;
        token++;
        // contre un bot : on revient à la dernière position où c'est à nous de jouer
        let h; do { h = G.hist.pop(); } while (cfg.opp && G.hist.length && h.s.side === botSide());
        G.s = h.s; G.last = h.last; G.mv = h.mv; G.over = false; G.res = null; G.anim = ""; sel = -1; tray = "";
        $("#va-end").hidden = true; $("#va-undo").style.display = "";
        render(); if (!isHuman()) botTurn();
      }
      function back() { token++; G = null; $("#va-game").hidden = true; $("#va-setup").hidden = false; paintSetup(); }

      $("#va-go").onclick = launch; $("#va-new").onclick = launch; $("#va-back").onclick = back; $("#va-undo").onclick = undo;
      paintSetup();
      el._api = { launch, cfg: () => cfg, get g() { return G; }, tap: onTap, undo, back, render };
    },
  });
})();
