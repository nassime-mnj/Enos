"use strict";
// JEUX (téléphone, hors ligne) : 2048 NÉON (glisse pour fusionner les tuiles), SERPENT (glisse pour tourner) et DÉMINEUR (appui = creuser, appui long = drapeau).
// Chaque jeu garde son record sur le téléphone ; tout est dessiné en DOM / canvas, sans fichier ni réseau.
(() => {
  const E = window.ENOS;
  const best = (k, v) => { try { const o = +localStorage.getItem("enos.game." + k) || 0; if (v != null && v > o) { localStorage.setItem("enos.game." + k, String(v)); return v; } return o; } catch (e) { return v || 0; } };
  // détection d'un glissement (haut/bas/gauche/droite) sur un élément
  function swipe(node, cb) {
    let x0 = 0, y0 = 0;
    node.addEventListener("pointerdown", (e) => { x0 = e.clientX; y0 = e.clientY; });
    node.addEventListener("pointerup", (e) => {
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      cb(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : (dy > 0 ? "D" : "U"));
    });
    node.style.touchAction = "none";
  }
  const keyDir = { arrowup: "U", arrowdown: "D", arrowleft: "L", arrowright: "R", z: "U", s: "D", q: "L", d: "R", w: "U", a: "L" };

  // ------------------------------------------------------------------ 2048 NÉON
  const G2048 = {
    new() { const b = Array(16).fill(0); G2048.add(b); G2048.add(b); return b; },
    add(b) { const e = b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0); if (e.length) b[e[Math.floor(Math.random() * e.length)]] = Math.random() < 0.9 ? 2 : 4; },
    // pousse une ligne vers sa 1re case : fusionne une fois par paire. -> {line, gain}
    slide(line) { const v = line.filter(Boolean), out = []; let gain = 0; for (let i = 0; i < v.length; i++) { if (v[i] === v[i + 1]) { out.push(v[i] * 2); gain += v[i] * 2; i++; } else out.push(v[i]); } while (out.length < 4) out.push(0); return { line: out, gain }; },
    move(b, d) {
      const nb = b.slice(); let gain = 0;
      for (let k = 0; k < 4; k++) {
        const idx = d === "L" ? [0, 1, 2, 3].map((j) => k * 4 + j) : d === "R" ? [3, 2, 1, 0].map((j) => k * 4 + j) : d === "U" ? [0, 1, 2, 3].map((j) => j * 4 + k) : [3, 2, 1, 0].map((j) => j * 4 + k);
        const r = G2048.slide(idx.map((i) => b[i])); gain += r.gain; idx.forEach((i, j) => (nb[i] = r.line[j]));
      }
      return { b: nb, gain, moved: nb.some((v, i) => v !== b[i]) };
    },
    over(b) { return ["L", "R", "U", "D"].every((d) => !G2048.move(b, d).moved); },
  };
  const C2048 = { 2: "#1b2a3a", 4: "#1f3a4d", 8: "#ff8c42", 16: "#ff6b3d", 32: "#ff4d6d", 64: "#e8294f", 128: "#f5c542", 256: "#e6b800", 512: "#7bd64d", 1024: "#1acfd6", 2048: "#a56bff" };

  E.suite.register({
    id: "g2048", group: "games", title: "2048 Néon", sub: "Glisse · fusionne · atteins 2048",
    icon: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
    build(el) {
      let b = G2048.new(), score = 0, over = false;
      el.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between;margin-bottom:10px"><b id="g-sc" style="font-size:20px"></b><span class="muted" id="g-best"></span><button class="btn" id="g-new">NOUVELLE PARTIE</button></div>
        <div id="g-bd" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:8px;background:#0c0c12;border-radius:14px;aspect-ratio:1;max-width:420px;margin:auto"></div>
        <p class="muted" style="text-align:center;margin-top:10px;font-size:13px">Glisse dans une direction (ou flèches / ZQSD). Deux tuiles identiques fusionnent.</p></div>`;
      const paint = () => {
        el.querySelector("#g-bd").innerHTML = b.map((v) => `<div style="display:grid;place-items:center;border-radius:10px;font:800 ${v >= 1024 ? 20 : 26}px system-ui;background:${v ? C2048[v] || "#a56bff" : "#16161e"};color:${v >= 8 ? "#fff" : "#7fdcff"};box-shadow:${v >= 128 ? "0 0 14px " + (C2048[v] || "#a56bff") : "none"}">${v || ""}</div>`).join("");
        el.querySelector("#g-sc").textContent = "Score " + score; el.querySelector("#g-best").textContent = "Record " + best("2048");
      };
      const play = (d) => {
        if (over) return;
        const r = G2048.move(b, d); if (!r.moved) return;
        b = r.b; score += r.gain; G2048.add(b); best("2048", score); E.vibrate && E.vibrate(8); paint();
        if (G2048.over(b)) { over = true; E.ui.sheet({ title: "Partie terminée", html: `<p class="muted">Score ${score}</p>`, options: [{ label: "REJOUER", cls: "pri", fn: () => reset() }, { label: "FERMER" }] }); }
      };
      const reset = () => { b = G2048.new(); score = 0; over = false; paint(); };
      swipe(el.querySelector("#g-bd"), play);
      el.querySelector("#g-new").onclick = reset;
      document.addEventListener("keydown", (e) => { const d = keyDir[e.key.toLowerCase()]; if (d && !el.closest("[hidden]")) { e.preventDefault(); play(d); } });
      el._api = { get board() { return b; }, play, set board(v) { b = v; paint(); }, get score() { return score; }, reset };
      paint();
    },
  });

  // ------------------------------------------------------------------ SERPENT
  E.suite.register({
    id: "snake", group: "games", title: "Serpent", sub: "Mange, grandis, ne te mords pas",
    icon: '<path d="M4 16c0-4 4-4 4-8a3 3 0 0 1 6 0c0 4-4 4-4 8a3 3 0 0 0 6 0V8"/><circle cx="17" cy="6" r="1"/>',
    build(el) {
      const N = 18;
      let snake, dir, nextDir, food, score, alive, timer = 0, speed = 140;
      el.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between;margin-bottom:10px"><b id="s-sc" style="font-size:20px">0</b><span class="muted" id="s-best"></span><button class="btn pri" id="s-go">▶ JOUER</button></div>
        <canvas id="s-cv" width="360" height="360" style="width:100%;max-width:420px;display:block;margin:auto;background:#0a0a10;border-radius:14px"></canvas>
        <p class="muted" style="text-align:center;margin-top:10px;font-size:13px">Glisse pour tourner (ou flèches / ZQSD).</p></div>`;
      const cv = el.querySelector("#s-cv"), g = cv.getContext("2d"), cs = cv.width / N;
      const place = () => { let p; do { p = [Math.floor(Math.random() * N), Math.floor(Math.random() * N)]; } while (snake.some((s) => s[0] === p[0] && s[1] === p[1])); return p; };
      const V = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] }, OPP = { U: "D", D: "U", L: "R", R: "L" };
      function draw() {
        g.fillStyle = "#0a0a10"; g.fillRect(0, 0, cv.width, cv.height);
        g.fillStyle = "#ff4d6d"; g.beginPath(); g.arc(food[0] * cs + cs / 2, food[1] * cs + cs / 2, cs * 0.35, 0, 7); g.fill();
        snake.forEach((s, i) => { g.fillStyle = i ? `hsl(${170 + i * 3},80%,${55 - Math.min(20, i)}%)` : "#1acfd6"; g.fillRect(s[0] * cs + 1, s[1] * cs + 1, cs - 2, cs - 2); });
        el.querySelector("#s-sc").textContent = score; el.querySelector("#s-best").textContent = "Record " + best("snake");
      }
      function tick() {
        dir = nextDir; const h = [snake[0][0] + V[dir][0], snake[0][1] + V[dir][1]];
        if (h[0] < 0 || h[1] < 0 || h[0] >= N || h[1] >= N || snake.some((s) => s[0] === h[0] && s[1] === h[1])) return die();
        snake.unshift(h);
        if (h[0] === food[0] && h[1] === food[1]) { score++; best("snake", score); food = place(); speed = Math.max(60, 140 - score * 3); clearInterval(timer); timer = setInterval(tick, speed); E.vibrate && E.vibrate(10); } else snake.pop();
        draw();
      }
      function die() { alive = false; clearInterval(timer); draw(); E.ui.sheet({ title: "Perdu", html: `<p class="muted">Score ${score}</p>`, options: [{ label: "REJOUER", cls: "pri", fn: start }, { label: "FERMER" }] }); }
      function start() { snake = [[9, 9], [8, 9], [7, 9]]; dir = nextDir = "R"; score = 0; alive = true; food = place(); clearInterval(timer); speed = 140; timer = setInterval(tick, speed); draw(); }
      const turn = (d) => { if (alive && d !== OPP[dir]) nextDir = d; };
      swipe(cv, turn);
      el.querySelector("#s-go").onclick = start;
      document.addEventListener("keydown", (e) => { const d = keyDir[e.key.toLowerCase()]; if (d && !el.closest("[hidden]") && alive) { e.preventDefault(); turn(d); } });
      new MutationObserver(() => { if (el.closest("[hidden]")) clearInterval(timer); }).observe(el.closest(".subview") || el, { attributes: true, attributeFilter: ["hidden"] });   // pause quand on quitte l'écran
      el._api = { start, tick, get snake() { return snake; }, set snake(v) { snake = v; }, get food() { return food; }, set food(v) { food = v; }, turn, get alive() { return alive; }, get score() { return score; }, stop: () => clearInterval(timer) };
      snake = [[9, 9], [8, 9], [7, 9]]; food = [3, 3]; score = 0; alive = false; dir = nextDir = "R"; draw();
    },
  });

  // ------------------------------------------------------------------ DÉMINEUR
  const MINES = {
    // grille w×h ; les mines sont placées au 1er clic (jamais sur la case jouée ni autour)
    make(w, h) { return { w, h, mine: Array(w * h).fill(false), open: Array(w * h).fill(false), flag: Array(w * h).fill(false), placed: false, over: false, won: false }; },
    around(G, i) { const x = i % G.w, y = Math.floor(i / G.w), r = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if ((dx || dy) && x + dx >= 0 && y + dy >= 0 && x + dx < G.w && y + dy < G.h) r.push((y + dy) * G.w + x + dx); } return r; },
    place(G, n, safe) { const ban = new Set([safe, ...MINES.around(G, safe)]); let k = 0; while (k < n) { const i = Math.floor(Math.random() * G.w * G.h); if (!G.mine[i] && !ban.has(i)) { G.mine[i] = true; k++; } } G.placed = true; },
    count(G, i) { return MINES.around(G, i).filter((j) => G.mine[j]).length; },
    reveal(G, i, n) {
      if (G.over || G.open[i] || G.flag[i]) return;
      if (!G.placed) MINES.place(G, n, i);
      if (G.mine[i]) { G.over = true; G.open[i] = true; return; }
      const st = [i];
      while (st.length) { const c = st.pop(); if (G.open[c] || G.flag[c]) continue; G.open[c] = true; if (!MINES.count(G, c)) MINES.around(G, c).forEach((j) => { if (!G.open[j]) st.push(j); }); }
      if (G.open.filter(Boolean).length === G.w * G.h - n) { G.over = true; G.won = true; }
    },
  };
  const NUMCOL = ["", "#4da3ff", "#7bd64d", "#ff4d6d", "#a56bff", "#ff8c42", "#1acfd6", "#fff", "#999"];

  E.suite.register({
    id: "mines", group: "games", title: "Démineur", sub: "Appui = creuser · appui long = drapeau",
    icon: '<circle cx="12" cy="13" r="6"/><path d="M12 7V4M5 6l2 2M19 6l-2 2M3 13h3M18 13h3"/>',
    build(el) {
      const LV = { easy: [8, 10, 10], mid: [10, 14, 22], hard: [12, 16, 36] };
      let lvl = "easy", G = null, t0 = 0, tm = 0;
      el.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between;margin-bottom:10px"><b id="m-info"></b><select id="m-lv" class="sel"><option value="easy">Facile 8×10</option><option value="mid">Moyen 10×14</option><option value="hard">Difficile 12×16</option></select><button class="btn" id="m-new">NOUVELLE</button></div>
        <div id="m-bd" style="display:grid;gap:3px;max-width:430px;margin:auto"></div></div>`;
      function newGame() { const [w, h] = LV[lvl]; G = MINES.make(w, h); clearInterval(tm); t0 = 0; paint(); }
      function paint() {
        const [w, h, n] = LV[lvl], bd = el.querySelector("#m-bd"); bd.style.gridTemplateColumns = `repeat(${w},1fr)`;
        bd.innerHTML = G.open.map((o, i) => {
          const c = o && !G.mine[i] ? MINES.count(G, i) : 0;
          const txt = G.flag[i] && !o ? "🚩" : o ? (G.mine[i] ? "💣" : c || "") : G.over && G.mine[i] ? "💣" : "";
          return `<button data-i="${i}" style="aspect-ratio:1;border:0;border-radius:6px;font:800 16px system-ui;color:${NUMCOL[c] || "#fff"};background:${o ? (G.mine[i] ? "#b3263e" : "#15151c") : "#2a2a38"};padding:0">${txt}</button>`;
        }).join("");
        const left = n - G.flag.filter(Boolean).length;
        el.querySelector("#m-info").textContent = G.won ? "🏆 Gagné !" : G.over ? "💥 Perdu" : `💣 ${left}`;
      }
      function finish() {
        clearInterval(tm);
        if (G.won) { const s = Math.round((Date.now() - t0) / 1000), b0 = best("mines." + lvl + ".t"); if (!b0 || s < b0) { try { localStorage.setItem("enos.game.mines." + lvl + ".t", String(s)); } catch (e) { /* ignoré */ } } E.ui.sheet({ title: "Gagné !", html: `<p class="muted">Temps ${s} s</p>`, options: [{ label: "REJOUER", cls: "pri", fn: newGame }, { label: "FERMER" }] }); }
        else E.ui.sheet({ title: "Boum !", options: [{ label: "REJOUER", cls: "pri", fn: newGame }, { label: "FERMER" }] });
      }
      const dig = (i) => { if (!G.placed) t0 = Date.now(); MINES.reveal(G, i, LV[lvl][2]); paint(); if (G.over) finish(); };
      const flag = (i) => { if (G.over || G.open[i]) return; G.flag[i] = !G.flag[i]; E.vibrate && E.vibrate(15); paint(); };
      let hold = 0, held = false;
      const bd = el.querySelector("#m-bd");
      bd.addEventListener("pointerdown", (e) => { const b = e.target.closest("[data-i]"); if (!b) return; held = false; hold = setTimeout(() => { held = true; flag(+b.dataset.i); }, 380); });
      bd.addEventListener("pointerup", (e) => { clearTimeout(hold); const b = e.target.closest("[data-i]"); if (b && !held) dig(+b.dataset.i); });
      bd.addEventListener("pointerleave", () => clearTimeout(hold));
      bd.addEventListener("contextmenu", (e) => { e.preventDefault(); });
      el.querySelector("#m-lv").onchange = (e) => { lvl = e.target.value; newGame(); };
      el.querySelector("#m-new").onclick = newGame;
      el._api = { get G() { return G; }, dig, flag, newGame, get lvl() { return lvl; }, MINES, set lvl(v) { lvl = v; } };
      newGame();
    },
  });
  E.games = { G2048, MINES };
})();
