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

  B.render = (el, map, opts) => {
    opts = opts || {};
    const flip = !!opts.flip;
    let st = el._cb;
    if (!st) {
      el.classList.add("cboard");
      el.innerHTML = '<div class="cb-sq"></div><div class="cb-pc"></div>';
      st = el._cb = { sq: el.firstChild, pc: el.lastChild, nodes: new Map(), flip };
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
    if (st.flip !== flip) { st.pc.replaceChildren(); st.nodes.clear(); st.flip = flip; }
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
        if (gone) { const gs = [...nodes].find(([, v]) => v === gone)[0]; nodes.delete(gs); gone.classList.add("cap-out"); setTimeout(() => gone.remove(), 260); }
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
  };

  B.kingSquare = (map, turn) => { const k = turn === "w" ? "K" : "k"; return Object.keys(map).find((s) => map[s] === k) || ""; };
  // probabilité de gain (Blancs) d'après les centipions : même formule que le PC
  B.winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-2000, Math.min(2000, cp)))) - 1);
  B.powerToElo = (p) => (p <= 50 ? Math.round(250 + ((p - 1) / 49) * 1250) : Math.round(1500 + ((p - 50) / 50) * 1700));
})();
