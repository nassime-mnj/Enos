"use strict";
// DAMES — règles internationales (10×10) et variante 8×8 aux mêmes règles. Module pur (testable dans Node) : plateau, coups, IA.
//   - pions : avancent d'une case en diagonale ; PRISE OBLIGATOIRE, en avant ET en arrière ; rafles enchaînées ; règle de la PRISE MAJORITAIRE
//     (on doit jouer la rafle qui prend le plus de pièces) ; une pièce prise reste sur le plateau jusqu'à la fin de la rafle (pas de double saut).
//   - dames : longue portée (diagonale entière), prise à distance ; promotion si le pion TERMINE son coup sur la dernière rangée.
//   - fin : un camp sans coup légal perd ; nulle après 50 demi-coups sans prise ni mouvement de pion, ou triple répétition.
//   Cases : index r * n + c ; seules les cases foncées ((r + c) impair) sont jouables. 1 / 2 = pion / dame blancs (en bas), -1 / -2 = noirs.
(function (root) {
  function factory() {
  const D = {};
  const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  D.newGame = (n) => {
    n = n === 8 ? 8 : 10; const b = new Array(n * n).fill(0), rows = n === 10 ? 4 : 3;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if ((r + c) % 2 === 1) { if (r < rows) b[r * n + c] = -1; else if (r >= n - rows) b[r * n + c] = 1; }
    return { n, b, turn: 1, quiet: 0, hist: {}, ply: 0, over: null };
  };
  const key = (s) => s.b.join("") + s.turn;
  D.clone = (s) => ({ n: s.n, b: s.b.slice(), turn: s.turn, quiet: s.quiet, hist: Object.assign({}, s.hist), ply: s.ply, over: s.over });

  /** toutes les rafles possibles depuis `from` (DFS). La case de départ est vide pendant la rafle ; les pièces prises restent (elles bloquent) jusqu'à la fin. */
  function captures(s, from) {
    const n = s.n, b = s.b.slice(), p = b[from], side = Math.sign(p), king = Math.abs(p) === 2, out = [];
    b[from] = 0;
    const inside = (r, c) => r >= 0 && r < n && c >= 0 && c < n;
    const rec = (r, c, path, caps) => {
      let ext = false;
      for (const [dr, dc] of DIRS) {
        let rr = r + dr, cc = c + dc;
        if (king) while (inside(rr, cc) && b[rr * n + cc] === 0) { rr += dr; cc += dc; }
        if (!inside(rr, cc)) continue;
        const v = rr * n + cc;
        if (Math.sign(b[v]) !== -side || caps.includes(v)) continue;
        let lr = rr + dr, lc = cc + dc;
        while (inside(lr, lc) && b[lr * n + lc] === 0) {
          ext = true; const t = lr * n + lc; rec(lr, lc, path.concat([t]), caps.concat([v]));
          if (!king) break;
          lr += dr; lc += dc;
        }
      }
      if (!ext && caps.length) out.push({ from, to: path[path.length - 1], path, caps });
    };
    rec(Math.floor(from / n), from % n, [from], []);
    return out;
  }
  /** coups légaux du camp au trait : {from, to, path, caps} */
  D.moves = (s) => {
    const n = s.n, b = s.b, side = s.turn; let caps = [], max = 0;
    for (let i = 0; i < b.length; i++) if (Math.sign(b[i]) === side) { const c = captures(s, i); c.forEach((m) => { if (m.caps.length > max) { max = m.caps.length; caps = [m]; } else if (m.caps.length === max && max > 0) caps.push(m); }); }
    if (max > 0) return dedupe(caps);
    const out = [];
    for (let i = 0; i < b.length; i++) {
      const p = b[i]; if (Math.sign(p) !== side) continue; const r = Math.floor(i / n), c = i % n;
      for (const [dr, dc] of DIRS) {
        if (Math.abs(p) === 2) { let rr = r + dr, cc = c + dc; while (rr >= 0 && rr < n && cc >= 0 && cc < n && b[rr * n + cc] === 0) { out.push({ from: i, to: rr * n + cc, path: [i, rr * n + cc], caps: [] }); rr += dr; cc += dc; } }
        else if (dr === -side) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < n && cc >= 0 && cc < n && b[rr * n + cc] === 0) out.push({ from: i, to: rr * n + cc, path: [i, rr * n + cc], caps: [] }); }
      }
    }
    return out;
  };
  const dedupe = (l) => { const seen = new Set(); return l.filter((m) => { const k = m.from + ">" + m.to + ":" + m.caps.slice().sort((a, b) => a - b).join(","); if (seen.has(k)) return false; seen.add(k); return true; }); };

  /** joue un coup (nouvel état) */
  D.play = (s, m) => {
    const t = D.clone(s), n = t.n, p = t.b[m.from];
    t.b[m.from] = 0; m.caps.forEach((c) => (t.b[c] = 0));
    const r = Math.floor(m.to / n), promote = Math.abs(p) === 1 && ((p > 0 && r === 0) || (p < 0 && r === n - 1));
    t.b[m.to] = promote ? p * 2 : p;
    t.quiet = m.caps.length || Math.abs(p) === 1 ? 0 : t.quiet + 1;
    t.turn = -t.turn; t.ply++;
    const k = key(t); t.hist[k] = (t.hist[k] || 0) + 1;
    if (!D.moves(t).length) t.over = { winner: -t.turn, why: "bloqué" };
    else if (t.quiet >= 50) t.over = { winner: 0, why: "50 coups sans prise" };
    else if (t.hist[k] >= 3) t.over = { winner: 0, why: "répétition" };
    return t;
  };

  // ------------------------------------------------------------------ IA : alpha-bêta + approfondissement itératif + tri des coups
  function evaluate(s) {
    const n = s.n, b = s.b; let v = 0, wm = 0, bm = 0;
    for (let i = 0; i < b.length; i++) {
      const p = b[i]; if (!p) continue; const r = Math.floor(i / n), c = i % n, side = Math.sign(p);
      let x = Math.abs(p) === 2 ? 320 : 100;
      if (Math.abs(p) === 1) { const adv = side > 0 ? n - 1 - r : r; x += adv * 4 + (adv >= n - 3 ? 8 : 0); if ((side > 0 && r === n - 1) || (side < 0 && r === 0)) x += 6; }
      const centre = 2 - Math.min(Math.abs(c - (n - 1) / 2), 2) * 1; x += centre * 2;
      if (c === 0 || c === n - 1) x -= 3;
      v += side * x; if (side > 0) wm++; else bm++;
    }
    if (!wm) return -1e5; if (!bm) return 1e5;
    return v;
  }
  D.evaluate = evaluate;
  D.bestMove = (s, o) => {
    o = o || {}; const side = s.turn, list = D.moves(s); if (!list.length) return null; if (list.length === 1) return list[0];
    const level = o.level || "normal", deadline = Date.now() + (o.ms || { easy: 150, normal: 500, hard: 1200, max: 2200 }[level] || 600);
    const maxDepth = o.depth || { easy: 2, normal: 4, hard: 7, max: 12 }[level] || 4;
    let stop = false;
    const search = (st, d, a, bta) => {
      if (Date.now() > deadline) { stop = true; return 0; }
      if (st.over) return st.over.winner === 0 ? 0 : st.over.winner * st.turn * -1 === -1 ? -1e5 - d : 1e5 + d;
      const ms = D.moves(st);
      if (d <= 0 && !ms[0].caps.length) return evaluate(st) * st.turn;
      if (d <= -6) return evaluate(st) * st.turn;                                   // extension des prises bornée
      ms.sort((x, y) => y.caps.length - x.caps.length);
      let best = -Infinity;
      for (const m of ms) { const v = -search(D.play(st, m), d - 1, -bta, -a); if (stop) return 0; if (v > best) best = v; if (v > a) a = v; if (a >= bta) break; }
      return best;
    };
    let best = list[0], bestV = -Infinity;
    for (let d = 1; d <= maxDepth; d++) {
      let cur = null, curV = -Infinity, a = -Infinity;
      const ord = list.slice().sort((x, y) => (x === best ? -1 : y === best ? 1 : y.caps.length - x.caps.length));
      for (const m of ord) { const v = -search(D.play(s, m), d - 1, -Infinity, -a); if (stop) break; if (v > curV) { curV = v; cur = m; } if (v > a) a = v; }
      if (stop) break; best = cur; bestV = curV;
      if (Math.abs(bestV) > 9e4) break;
    }
    if (level === "easy" && Math.random() < 0.35) return list[Math.floor(Math.random() * list.length)];
    void side;
    return best;
  };
  D.sq = (n, r, c) => r * n + c;
  return D;
  }
  const D = factory(); D.factory = factory;
  /** IA dans un Worker (le rendu 3D reste fluide pendant la réflexion) : D.think(state, opts) -> Promise<coup> */
  if (typeof Worker !== "undefined" && typeof Blob !== "undefined" && typeof URL !== "undefined" && URL.createObjectURL) {
    let w = null, seq = 0; const wait = new Map();
    D.think = (s, o) => new Promise((res) => {
      try {
        if (!w) { w = new Worker(URL.createObjectURL(new Blob(["const D=(" + factory.toString() + ")();onmessage=(e)=>{const m=D.bestMove(e.data.s,e.data.o);postMessage({id:e.data.id,m});};"], { type: "text/javascript" }))); w.onmessage = (e) => { const f = wait.get(e.data.id); wait.delete(e.data.id); if (f) f(e.data.m); }; }
        const id = ++seq; wait.set(id, res); w.postMessage({ id, s: { n: s.n, b: s.b, turn: s.turn, quiet: s.quiet, hist: {}, ply: s.ply, over: null }, o });
      } catch (e) { res(D.bestMove(s, o)); }
    });
  } else D.think = (s, o) => Promise.resolve(D.bestMove(s, o));
  if (typeof module !== "undefined" && module.exports) module.exports = D; else (root.ENOS = root.ENOS || {}).dames = D;
})(typeof window !== "undefined" ? window : globalThis);
