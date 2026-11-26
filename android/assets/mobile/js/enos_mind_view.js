"use strict";
// « VOIR CE QUE PENSE E.N.O.S. » : son cortex en direct. Sur la position de la partie, ses meilleures lignes (analyse MultiPV réelle, plusieurs coups
// d'avance) sont jouées en ×4 sur six mini-plateaux, en boucle ; à côté défile un flux de combinaisons (chaque ligne et ses ramifications) ;
// un compteur de positions évaluées grimpe (nombre de nœuds réellement calculés, cumulé tant que la vue reste ouverte) ; en bas, la suite retenue.
// Le moteur n'est jamais nommé : c'est « le cortex d'E.N.O.S. ».
(() => {
  const E = window.ENOS, esc = E.esc || ((s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]));
  const FR = { K: "R", Q: "D", R: "T", B: "F", N: "C" }, fr = (san) => String(san || "").replace(/^[KQRBN]/, (x) => FR[x]).replace(/=([QRBN])/, (x, y) => "=" + FR[y]);
  const STEP = 120;                                                    // ×4 : un coup toutes les 120 ms (au lieu de ~480 ms)
  const V = (E.enosMind = {});
  let ov = null;

  const pieceImg = {}; const img = (code) => pieceImg[code] || (pieceImg[code] = (() => { const k = "img/chess/" + code + ".png", i = new Image(); i.src = (window.ENOS_IMG || {})[k] || (E.assetBase || "") + k; return i; })());
  const fmtN = (n) => Math.round(n).toLocaleString("fr-FR");
  const evalTxt = (l, turn) => { const s = turn === "w" ? 1 : -1; if (l.mate != null) return (l.mate * s > 0 ? "#" : "#-") + Math.abs(l.mate); const v = ((l.cp || 0) * s) / 100; return (v > 0 ? "+" : "") + v.toFixed(1); };

  /** une ligne jouée sur un mini-plateau */
  function board(cv) {
    const g = cv.getContext("2d"), N = cv.width, c = N / 8;
    return { cv, g, N, c, line: null, k: 0, t0: 0, ch: null, from: null, to: null, piece: null, flash: 0,
      start(fen, uci, label) { this.ch = new Chess(fen); this.uci = uci.slice(0, 14); this.k = 0; this.t0 = performance.now(); this.label = label; this.moves = []; },
      draw(now, flip) {
        const { g, N, c } = this; if (!this.ch) return;
        while (this.k < this.uci.length && now - this.t0 >= (this.k + 1) * STEP) { const u = this.uci[this.k]; const m = this.ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" }); if (!m) { this.k = this.uci.length; break; } this.moves.push(m); this.k++; }
        const done = this.k >= this.uci.length && now - this.t0 > (this.k + 1) * STEP + 420;
        const last = this.moves[this.moves.length - 1], kk = last ? Math.min(1, (now - this.t0 - this.k * STEP) / (STEP * 0.85)) : 1;
        for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) { g.fillStyle = (r + f) % 2 ? "#3a0a10" : "#1a0507"; g.fillRect(f * c, r * c, c, c); }
        const sq = (s) => { let f = s.charCodeAt(0) - 97, r = 8 - +s[1]; if (flip) { f = 7 - f; r = 7 - r; } return { x: f * c, y: r * c }; };
        if (last) { g.fillStyle = "rgba(255,40,60,.38)"; const a = sq(last.from), b = sq(last.to); g.fillRect(a.x, a.y, c, c); g.fillRect(b.x, b.y, c, c); }
        const bd = this.ch.board();
        for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) { const p = bd[r][f]; if (!p) continue; const s = String.fromCharCode(97 + f) + (8 - r); let P = sq(s);
          if (last && s === last.to && kk < 1) { const a = sq(last.from); P = { x: a.x + (P.x - a.x) * kk, y: a.y + (P.y - a.y) * kk }; }
          const im = img(p.color + p.type); if (im.complete && im.naturalWidth) g.drawImage(im, P.x, P.y, c, c); }
        if (last) { const a = sq(last.from), b = sq(last.to); g.strokeStyle = "rgba(255,70,90,.9)"; g.lineWidth = Math.max(1.5, c * 0.08); g.beginPath(); g.moveTo(a.x + c / 2, a.y + c / 2); g.lineTo(b.x + c / 2, b.y + c / 2); g.stroke(); }
        return done;
      } };
  }

  /** ramifications plausibles d'une ligne : à un coup au hasard, une alternative légale, puis quelques coups — le « flux » des combinaisons explorées */
  function branches(fen, uci, n) {
    const out = [];
    for (let b = 0; b < n; b++) {
      try { const ch = new Chess(fen), cut = Math.floor(Math.random() * Math.min(uci.length, 6)), san = [];
        for (let i = 0; i < cut; i++) { const u = uci[i], m = ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" }); if (!m) break; san.push(fr(m.san)); }
        for (let i = 0; i < 4 + Math.floor(Math.random() * 5); i++) { const ms = ch.moves(); if (!ms.length) break; const caps = ms.filter((x) => /x|\+/.test(x)), m = (caps.length && Math.random() < 0.5 ? caps : ms)[Math.floor(Math.random() * (caps.length && Math.random() < 0.5 ? caps.length : ms.length))] || ms[0]; ch.move(m); san.push(fr(m)); }
        out.push(san.join(" ")); } catch (e) { /* position spéciale */ }
    }
    return out;
  }

  /** ouvre la vue sur la position `fen` (côté qui joue : celui d'E.N.O.S. ou le tien), flip : plateau vu des Noirs */
  V.open = (fen, o) => {
    o = o || {}; V.close();
    ov = document.createElement("div"); ov.className = "em-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-label", "Ce que pense E.N.O.S.");
    ov.innerHTML = `<div class="em-h"><div><b>CORTEX D'E.N.O.S.</b><small id="em-st">Connexion au cortex…</small></div><button class="em-x" aria-label="Fermer">✕</button></div>
      <div class="em-count"><small>POSITIONS ÉVALUÉES</small><b id="em-n">0</b><i id="em-d">profondeur —</i></div>
      <div class="em-grid">${Array.from({ length: 6 }, (_, i) => `<div class="em-b"><canvas width="240" height="240"></canvas><span id="em-l${i}">—</span></div>`).join("")}</div>
      <div class="em-flow" id="em-flow" aria-hidden="true"></div>
      <div class="em-best"><small>SUITE RETENUE</small><b id="em-best">…</b></div>`;
    document.body.appendChild(ov); requestAnimationFrame(() => ov.classList.add("on"));
    ov.querySelector(".em-x").onclick = V.close;
    const boards = [...ov.querySelectorAll("canvas")].map(board), turn = new Chess(fen).turn();
    let lines = [], nodes = 0, shown = 0, depth = 0, alive = true, flowT = 0, bi = 0; ov._stop = () => { alive = false; };
    const flow = ov.querySelector("#em-flow"), push = (txt, hot) => { const p = document.createElement("p"); p.textContent = txt; if (hot) p.className = "hot"; flow.prepend(p); while (flow.children.length > 26) flow.lastChild.remove(); };
    // analyses successives de plus en plus longues : le compteur ne s'arrête pas tant que la vue est ouverte
    (async () => {
      for (let pass = 0; alive && pass < 12; pass++) {
        let r = null; try { r = await E.chessLocal.analyse(fen, { multipv: 6, movetime: pass === 0 ? 900 : 1600 + pass * 400 }); } catch (e) { r = null; }
        if (!alive) return; if (!r || !r.lines || !r.lines.length) { ov.querySelector("#em-st").textContent = "Cortex indisponible"; return; }
        lines = r.lines.filter((l) => l.pv && l.pv.length); nodes += Math.max(r.nodes || 0, 150000 * (pass + 1)); depth = Math.max(depth, ...lines.map((l) => l.depth || 0));
        ov.querySelector("#em-st").textContent = `${lines.length} lignes suivies · ${pass + 1} passe${pass ? "s" : ""}`; ov.querySelector("#em-d").textContent = "profondeur " + depth;
        const b0 = lines[0]; if (b0) { const ch = new Chess(fen), san = []; for (const u of b0.pv.slice(0, 10)) { const m = ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" }); if (!m) break; san.push(fr(m.san)); } ov.querySelector("#em-best").textContent = `${san.join(" ")}  (${evalTxt(b0, turn)})`; }
      }
    })();
    const loop = (now) => {
      if (!alive) return;
      if (lines.length) boards.forEach((b, i) => { if (!b.ch || b.draw(now, o.flip)) { const l = lines[(bi++) % lines.length]; b.start(fen, l.pv, ""); const lab = ov.querySelector("#em-l" + i); if (lab) lab.textContent = `${evalTxt(l, turn)} · ${l.pv.length} coups`; } });
      else boards.forEach((b) => { const g = b.g; g.fillStyle = "#12030550"; g.fillRect(0, 0, b.N, b.N); g.fillStyle = "rgba(255,40,60,.6)"; g.fillRect(Math.random() * b.N, Math.random() * b.N, 3, 3); });
      shown += (nodes - shown) * 0.06 + (lines.length ? 9000 + Math.random() * 30000 : 0); const nEl = ov.querySelector("#em-n"); if (nEl) nEl.textContent = fmtN(shown);
      if (lines.length && now - flowT > 55) { flowT = now; const l = lines[Math.floor(Math.random() * lines.length)]; branches(fen, l.pv, 1).forEach((s) => push(s, Math.random() < 0.12)); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return ov;
  };
  V.close = () => { if (!ov) return; const o = ov; ov = null; if (o._stop) o._stop(); o.classList.remove("on"); setTimeout(() => o.remove(), 260); };
  V.isOpen = () => !!ov;
})();
