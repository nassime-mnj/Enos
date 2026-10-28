"use strict";
// Plateau d'échecs tactile (thème Chess.com : pièces img/chess/*.png, cases vert #769656 / crème #eeeed2), pièces animées, surbrillances (dernier coup, sélection, cibles, échec, indice) et petit moteur de
// DÉPLACEMENT VISUEL (roque, prise en passant, promotion) pour que le coup du joueur s'affiche aussitôt ; la FEN renvoyée par le PC reste la référence.
(() => {
  const E = window.ENOS;
  const B = (E.board = {});

  B.parse = (fen) => {                                              // -> {sq: "P"|"p"...} + trait
    const [rows, turn] = fen.split(" ");
    const m = {};
    rows.split("/").forEach((row, r) => { let f = 0; for (const ch of row) { if (/\d/.test(ch)) f += +ch; else { m["abcdefgh"[f] + (8 - r)] = ch; f++; } } });
    return { m, turn: turn || "w", ep: (fen.split(" ")[3] || "-") };
  };

  // Applique un coup UCI sur la carte des pièces (affichage immédiat). Retourne une nouvelle carte.
  B.applyUci = (pos, uci) => {
    const m = { ...pos.m }, from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci[4];
    const p = m[from];
    if (!p) return m;
    delete m[from];
    if (p.toLowerCase() === "p" && from[0] !== to[0] && !m[to]) delete m[to[0] + from[1]];            // prise en passant
    if (p.toLowerCase() === "k" && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2) {          // roque : la tour suit
      const rank = from[1], kingSide = to[0] === "g";
      const rf = (kingSide ? "h" : "a") + rank, rt = (kingSide ? "f" : "d") + rank;
      if (m[rf]) { m[rt] = m[rf]; delete m[rf]; }
    }
    m[to] = promo ? (p === p.toUpperCase() ? promo.toUpperCase() : promo) : p;
    return m;
  };

  // el : conteneur ; opts : {flip, last:[from,to], hint:[from,to], sel, targets:[sq], check:sq, onTap(sq), anim:"e2e4"}
  // Deux couches : les CASES (fonds, surbrillances, coordonnées : reconstruites à chaque appel) et les PIÈCES (éléments persistants positionnés
  // en transform : un coup les fait GLISSER d'une case à l'autre ; prise, roque, prise en passant et promotion sont gérés).
  // anim = coup UCI qui vient d'être joué : sans lui (nouvelle partie, annulation, retournement) les pièces sont simplement replacées.
  const PIECE_URL = (p) => `img/chess/${p === p.toUpperCase() ? "w" : "b"}${p.toLowerCase()}.png`;
  const pos = (sq, flip) => { const f = sq.charCodeAt(0) - 97, r = +sq[1] - 1; return [flip ? 7 - f : f, flip ? r : 7 - r]; };
  const place = (node, sq, flip) => { const [x, y] = pos(sq, flip); node.style.transform = `translate(${x * 100}%,${y * 100}%)`; };

  // Symboles de qualité de coup (style Chess.com) posés en coin de la case d'arrivée : [glyphe, couleur]. Clés = celles de chess_brain / chess_review.
  B.BADGES = { brilliant: ["!!", "#1acfd6"], great: ["!", "#5c8bb0"], best: ["★", "#7bd64d"], excellent: ["👍", "#9ecc38"], good: ["✓", "#739e66"], book: ["📖", "#a8896c"], inaccuracy: ["?!", "#f5c542"], mistake: ["?", "#f5a524"], blunder: ["??", "#ff4d63"] };
  const fxCell = (st, sq) => { const c = document.createElement("div"); c.className = "fxs"; place(c, sq, st.flip); st.fx.append(c); return c; };
  /** Éclat d'animation sur une case. kind : brilliant (anneaux cyan + étincelles) | great | capture (onde blanche) | blunder (anneau rouge + secousse) | mate (pulsation rouge). Éphémère : s'efface seul. */
  B.burst = (el, sq, kind) => {
    const st = el && el._cb; if (!st || !sq) return;
    const c = fxCell(st, sq); c.classList.add("fx-" + kind);
    const ring = (d) => { const r = document.createElement("i"); r.className = "fx-ring"; r.style.animationDelay = d + "ms"; c.append(r); };
    const pulse = (cls, ms) => { el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); };
    if (kind === "brilliant") {
      ring(0); ring(140); ring(280);
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, d = 90 + (i % 3) * 22, sp = document.createElement("i"); sp.className = "fx-sp"; sp.style.setProperty("--dx", Math.cos(a) * d + "%"); sp.style.setProperty("--dy", Math.sin(a) * d + "%"); sp.style.animationDelay = (i % 4) * 40 + "ms"; c.append(sp); }
      pulse("fx-flash", 900);
    } else if (kind === "great") { ring(0); ring(160); }
    else if (kind === "capture") ring(0);
    else if (kind === "blunder") { ring(0); pulse("fx-shake", 450); }
    else if (kind === "mate") { ring(0); ring(220); ring(440); pulse("fx-mate", 1400); }
    setTimeout(() => c.remove(), 1500);
  };

  // ---- FLÈCHES : [{from, to, color, w}]. Le cavalier trace un « L ». Teintes du PC : joué jaune, meilleur vert, menace rouge, brillant or.
  B.ARROW = { played: "#f5b81f", best: "#34d16b", threat: "#f2405a", punish: "#3a80ff", brilliant: "#ffcb1f", alt: "#5fb3ff", target: "#ff7a45" };
  const NS = "http://www.w3.org/2000/svg";
  const ctr = (sq, flip) => { const [x, y] = pos(sq, flip); return [x + 0.5, y + 0.5]; };
  const paintArrows = (st, list, flip) => {
    const sig = (list || []).map((a) => a.from + a.to + (a.color || "")).join("|") + (flip ? "f" : "");
    if (sig === st.arSig) return;                                                // mêmes flèches : l'animation d'apparition n'est pas rejouée
    st.arSig = sig; st.ar.replaceChildren();
    (list || []).forEach((a, i) => {
      if (!a.from || !a.to || a.from === a.to) return;
      const col = a.color || B.ARROW.best, w = a.w || 0.16, [x1, y1] = ctr(a.from, flip), [x2, y2] = ctr(a.to, flip);
      const dx = x2 - x1, dy = y2 - y1, knight = (Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1);
      const pts = knight ? (Math.abs(dy) === 2 ? [[x1, y1], [x1, y2], [x2, y2]] : [[x1, y1], [x2, y1], [x2, y2]]) : [[x1, y1], [x2, y2]];
      const last = pts[pts.length - 1], prev = pts[pts.length - 2], L = Math.hypot(last[0] - prev[0], last[1] - prev[1]), ux = (last[0] - prev[0]) / L, uy = (last[1] - prev[1]) / L;
      const base = [last[0] - ux * 0.42, last[1] - uy * 0.42], px = -uy, py = ux;
      const g = document.createElementNS(NS, "g"); g.setAttribute("class", "ar"); g.style.animationDelay = i * 90 + "ms"; g.setAttribute("opacity", a.alpha || 0.88);
      const pl = document.createElementNS(NS, "polyline");
      pl.setAttribute("points", pts.slice(0, -1).concat([base]).map((q) => q.join(",")).join(" ")); pl.setAttribute("fill", "none"); pl.setAttribute("stroke", col); pl.setAttribute("stroke-width", w); pl.setAttribute("stroke-linejoin", "round"); pl.setAttribute("stroke-linecap", "round");
      const tri = document.createElementNS(NS, "polygon");
      tri.setAttribute("points", [last, [base[0] + px * 0.27, base[1] + py * 0.27], [base[0] - px * 0.27, base[1] - py * 0.27]].map((q) => q.join(",")).join(" ")); tri.setAttribute("fill", col); tri.setAttribute("stroke", "none");
      const dot = document.createElementNS(NS, "circle"); dot.setAttribute("cx", x1); dot.setAttribute("cy", y1); dot.setAttribute("r", 0.13); dot.setAttribute("fill", col); dot.setAttribute("stroke", "none");
      g.append(pl, tri, dot); st.ar.append(g);
    });
  };

  // Pièces adverses (cavalier et plus) attaquées depuis `sq` : cibles de la « fourchette » d'un coup brillant. Géométrie seule, sans règles d'échec.
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  B.attacks = (map, sq) => {
    const p = map[sq]; if (!p) return [];
    const t = p.toLowerCase(), white = p === p.toUpperCase(), f0 = sq.charCodeAt(0) - 97, r0 = +sq[1] - 1, out = [];
    const at = (f, r) => (f >= 0 && f < 8 && r >= 0 && r < 8 ? "abcdefgh"[f] + (r + 1) : null);
    const hit = (s) => { const q = map[s]; if (q && (q === q.toUpperCase()) !== white && VAL[q.toLowerCase()] >= 3) out.push(s); };
    const slide = (dirs) => dirs.forEach(([df, dr]) => { for (let f = f0 + df, r = r0 + dr; ; f += df, r += dr) { const s = at(f, r); if (!s) break; if (map[s]) { hit(s); break; } } });
    if (t === "n") [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]].forEach(([a, b]) => { const s = at(f0 + a, r0 + b); if (s) hit(s); });
    if (t === "p") [-1, 1].forEach((df) => { const s = at(f0 + df, r0 + (white ? 1 : -1)); if (s) hit(s); });
    if (t === "k") for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (a || b) { const s = at(f0 + a, r0 + b); if (s) hit(s); }
    if (t === "r" || t === "q") slide([[1, 0], [-1, 0], [0, 1], [0, -1]]);
    if (t === "b" || t === "q") slide([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
    return out.sort((a, b) => VAL[map[b].toLowerCase()] - VAL[map[a].toLowerCase()]).slice(0, 3);
  };

  /** Effet « COUP BRILLANT » du PC : case d'arrivée remplie de bleu, onde sur les cases de même couleur, pastille « Brillant ! » qui surgit puis glisse à côté du « !! », rayon vers chaque pièce attaquée. */
  B.brilliantFx = (el, sq, targets) => {
    const st = el && el._cb; if (!st || !sq) return;
    const holder = document.createElement("div"); holder.className = "bfx"; st.fx.append(holder);
    const f0 = sq.charCodeAt(0) - 97, r0 = +sq[1] - 1, [cx, cy] = pos(sq, st.flip);
    const cell = (s, cls, delay) => { const c = document.createElement("div"); c.className = "fxs " + cls; place(c, s, st.flip); if (delay) c.style.animationDelay = delay + "ms"; holder.append(c); return c; };
    for (let f = 0; f < 8; f++) for (let r = 0; r < 8; r++) if ((f + r) % 2 === (f0 + r0) % 2 && !(f === f0 && r === r0)) {
      const s = "abcdefgh"[f] + (r + 1), [x, y] = pos(s, st.flip);
      cell(s, "bfx-wave", Math.round(Math.hypot(x - cx, y - cy) * 85));
    }
    cell(sq, "bfx-fill");
    const lab = cell(sq, "bfx-lab"), b = document.createElement("b"); b.textContent = "Brillant !"; lab.append(b);
    const svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", "0 0 8 8"); svg.setAttribute("class", "bfx-rays"); holder.append(svg);
    (targets || []).forEach((t, i) => {
      const [x1, y1] = ctr(sq, st.flip), [x2, y2] = ctr(t, st.flip), d = 100 + i * 110;
      for (const [w, o, cl] of [[0.22, 0.28, "#6fdcff"], [0.1, 0.95, "#ffffff"]]) {
        const ln = document.createElementNS(NS, "line"); ln.setAttribute("x1", x1); ln.setAttribute("y1", y1); ln.setAttribute("x2", x2); ln.setAttribute("y2", y2);
        ln.setAttribute("stroke", cl); ln.setAttribute("stroke-width", w); ln.setAttribute("stroke-linecap", "round"); ln.setAttribute("opacity", o); ln.setAttribute("class", "bfx-ray"); ln.style.animationDelay = d + "ms"; svg.append(ln);
      }
      cell(t, "bfx-tgt", d + 300);
    });
    setTimeout(() => holder.remove(), 3300);
  };

  B.render = (el, map, opts) => {
    opts = opts || {};
    const flip = !!opts.flip;
    let st = el._cb;
    if (!st) {
      el.classList.add("cboard");
      el.innerHTML = '<div class="cb-sq"></div><div class="cb-pc"></div><svg class="cb-ar" viewBox="0 0 8 8"></svg><div class="cb-fx"></div>';
      st = el._cb = { sq: el.firstChild, pc: el.children[1], ar: el.children[2], fx: el.children[3], arSig: "", nodes: new Map(), flip, badgeId: null, endId: null };
      el.addEventListener("click", (e) => {
        if (!el._cb.onTap) return;
        const r = el.getBoundingClientRect(), x = Math.min(7, Math.max(0, Math.floor((e.clientX - r.left) / r.width * 8))), y = Math.min(7, Math.max(0, Math.floor((e.clientY - r.top) / r.height * 8)));
        el._cb.onTap(el._cb.flip ? "abcdefgh"[7 - x] + (y + 1) : "abcdefgh"[x] + (8 - y));
      });
    }
    st.onTap = opts.onTap || null;

    // ---- cases
    const files = flip ? "hgfedcba" : "abcdefgh", ranks = flip ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
    let h = "";
    for (const r of ranks) for (const f of files) {
      const sq = f + r, dark = (f.charCodeAt(0) - 97 + r) % 2 === 1;           // a1 est sombre
      const cls = ["sq", dark ? "d" : "l"];
      if (opts.last && opts.last.includes(sq)) cls.push("last");
      if (opts.hint && opts.hint.includes(sq)) cls.push("hint");
      if (opts.sel === sq) cls.push("sel");
      if (opts.check === sq) cls.push("chk");
      if (opts.targets && opts.targets.includes(sq)) cls.push(map[sq] ? "cap" : "tgt");
      const coord = (f === files[0] ? `<i class="rk">${r}</i>` : "") + (r === ranks[ranks.length - 1] ? `<i class="fl">${f}</i>` : "");
      h += `<div class="${cls.join(" ")}" data-sq="${sq}">${coord}</div>`;
    }
    st.sq.innerHTML = h;

    // ---- pièces
    if (st.flip !== flip) { st.pc.replaceChildren(); st.nodes.clear(); st.fx.replaceChildren(); st.flip = flip; st.badgeId = null; st.arSig = ""; }
    const nodes = st.nodes, mk = (sq, p, instant) => {
      const n = document.createElement("img");
      n.className = "pce" + (instant ? " nt" : ""); n.src = PIECE_URL(p); n.alt = ""; n.draggable = false; n.dataset.p = p;
      place(n, sq, flip); st.pc.append(n); nodes.set(sq, n); return n;
    };
    const mv = opts.anim && opts.anim.length >= 4 ? opts.anim : "";
    if (mv) {
      const from = mv.slice(0, 2), to = mv.slice(2, 4), n = nodes.get(from);
      if (n) {
        const gone = nodes.get(to) || (n.dataset.p.toLowerCase() === "p" && from[0] !== to[0] ? nodes.get(to[0] + from[1]) : null);
        if (gone) { const gs = [...nodes].find(([, v]) => v === gone)[0]; nodes.delete(gs); gone.classList.add("cap-out"); setTimeout(() => gone.remove(), 260); B.burst(el, to, "capture"); }
        nodes.delete(from); nodes.set(to, n); n.classList.remove("nt"); n.style.zIndex = 5; place(n, to, flip);
        setTimeout(() => { n.style.zIndex = ""; }, 260);
        if (n.dataset.p.toLowerCase() === "k" && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2) {     // roque : la tour glisse aussi
          const rk = from[1], king = to[0] === "g", rf = (king ? "h" : "a") + rk, rt = (king ? "f" : "d") + rk, rn = nodes.get(rf);
          if (rn) { nodes.delete(rf); nodes.set(rt, rn); place(rn, rt, flip); }
        }
      }
    }
    for (const [sq, n] of [...nodes]) {                                          // réconciliation avec la position cible
      const want = map[sq];
      if (!want) { n.remove(); nodes.delete(sq); }
      else if (want !== n.dataset.p) { n.dataset.p = want; n.src = PIECE_URL(want); }       // promotion
    }
    for (const sq of Object.keys(map)) if (!nodes.has(sq)) mk(sq, map[sq], true);

    paintArrows(st, opts.arrows, flip);

    // ---- symbole de qualité du dernier coup : {sq, key, id}. Même id = même coup : le symbole reste sans rejouer l'animation.
    const bd = opts.badge && B.BADGES[opts.badge.key] ? opts.badge : null, old = st.fx.querySelector(".fx-badge");
    if (old) old.parentNode.remove();
    if (!bd) st.badgeId = null;
    else {
      const fresh = st.badgeId !== bd.id, [g, col] = B.BADGES[bd.key], c = fxCell(st, bd.sq), b = document.createElement("b");
      b.className = "fx-badge" + (fresh ? " pop" : "") + " k-" + bd.key; b.textContent = g; b.style.setProperty("--c", col); c.append(b);
      st.badgeId = bd.id;
      if (fresh && ["brilliant", "great", "blunder"].includes(bd.key)) setTimeout(() => { B.burst(el, bd.sq, bd.key); if (bd.key === "brilliant") B.brilliantFx(el, bd.sq, B.attacks(map, bd.sq)); }, 120);
    }
    // ---- mat : pulsation sur le roi, une seule fois par fin de partie
    if (opts.end && st.endId !== opts.end.id) { st.endId = opts.end.id; B.burst(el, opts.end.sq, "mate"); }
    else if (!opts.end) st.endId = null;
  };

  B.kingSquare = (map, turn) => { const k = turn === "w" ? "K" : "k"; return Object.keys(map).find((s) => map[s] === k) || ""; };
  // probabilité de gain (Blancs) d'après les centipions : même formule que le PC
  B.winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-2000, Math.min(2000, cp)))) - 1);
  B.powerToElo = (p) => (p <= 50 ? Math.round(250 + ((p - 1) / 49) * 1250) : Math.round(1500 + ((p - 50) / 50) * 1700));
})();
