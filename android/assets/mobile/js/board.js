"use strict";
// Plateau d'échecs tactile : rendu depuis une FEN (grille CSS, pièces Unicode), surbrillances (dernier coup, sélection, cibles, échec, indice) et petit moteur de
// DÉPLACEMENT VISUEL (roque, prise en passant, promotion) pour que le coup du joueur s'affiche aussitôt ; la FEN renvoyée par le PC reste la référence.
(() => {
  const E = window.ENOS;
  const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
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

  // el : conteneur ; opts : {flip, last:[from,to], hint:[from,to], sel, targets:[sq], check:sq, onTap(sq)}
  B.render = (el, map, opts) => {
    opts = opts || {};
    if (!el.classList.contains("cboard")) el.classList.add("cboard");
    const files = opts.flip ? "hgfedcba" : "abcdefgh", ranks = opts.flip ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
    let h = "";
    for (const r of ranks) for (const f of files) {
      const sq = f + r, p = map[sq], dark = (f.charCodeAt(0) - 97 + r) % 2 === 1;      // a1 est sombre
      const cls = ["sq", dark ? "d" : "l"];
      if (opts.last && opts.last.includes(sq)) cls.push("last");
      if (opts.hint && opts.hint.includes(sq)) cls.push("hint");
      if (opts.sel === sq) cls.push("sel");
      if (opts.check === sq) cls.push("chk");
      if (opts.targets && opts.targets.includes(sq)) cls.push(p ? "cap" : "tgt");
      const coord = (f === files[0] ? `<i class="rk">${r}</i>` : "") + (r === ranks[ranks.length - 1] ? `<i class="fl">${f}</i>` : "");
      h += `<div class="${cls.join(" ")}" data-sq="${sq}">${coord}${p ? `<b class="pc ${p === p.toUpperCase() ? "w" : "b"}">${GLYPH[p.toLowerCase()]}</b>` : ""}</div>`;
    }
    el.innerHTML = h;
    if (opts.onTap) el.onclick = (e) => { const s = e.target.closest(".sq"); if (s) opts.onTap(s.dataset.sq); };
  };

  B.kingSquare = (map, turn) => { const k = turn === "w" ? "K" : "k"; return Object.keys(map).find((s) => map[s] === k) || ""; };
  // probabilité de gain (Blancs) d'après les centipions : même formule que le PC
  B.winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-2000, Math.min(2000, cp)))) - 1);
  B.powerToElo = (p) => (p <= 50 ? Math.round(250 + ((p - 1) / 49) * 1250) : Math.round(1500 + ((p - 50) / 50) * 1700));
})();
