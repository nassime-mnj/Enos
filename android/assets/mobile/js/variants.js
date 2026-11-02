"use strict";
// VARIANTES D'ÉCHECS « inventions maison » — moteur de règles + petite IA (aucune dépendance : navigateur ET Node pour les tests).
//   elixir : CLASH ROYALE. Plateau de départ = les deux rois seuls. On POSE des pièces (dans ses 2 premières rangées) en payant de l'ÉLIXIR ;
//            chacun commence à 0 élixir (les rois doivent d'abord jouer) ; chaque coup joué rapporte +1 élixir ; poser ne consomme PAS le coup (on peut poser puis jouer, ou économiser en bougeant).
//   dk     : DEUX ROIS. Pas de dame : deux rois par camp. Si l'un des deux est maté, la partie est finie (un seul roi menacé et aucun coup qui sauve tout = mat).
//   ptq    : PROTÈGE LA DAME. Le roi n'est plus sacré (il peut être pris, il ne craint pas l'échec) : c'est la dame qu'on protège ; dame matée = défaite.
// Règles communes : pas de roque. Prise en passant et promotion existent (en ptq, pas de promotion en dame : une 2ᵉ dame serait une 2ᵉ cible).
// Cases : index = colonne + 8 × rangée (rangée 0 = rangée « 1 »). Pièces : lettres FEN (majuscule = Blancs).
(function (root) {
  const V = {};
  const FILES = "abcdefgh";
  const sqName = (i) => FILES[i & 7] + ((i >> 3) + 1);
  const sqIdx = (s) => FILES.indexOf(s[0]) + 8 * (+s[1] - 1);
  V.sqName = sqName; V.sqIdx = sqIdx;

  V.MODES = {
    elixir: { id: "elixir", name: "Élixir", tag: "Clash Royale", royal: "k", start: "4k3/8/8/8/8/8/8/4K3", promo: "qrbn", desc: "Départ : deux rois seuls. Pose tes pièces avec l'élixir (+1 à chaque coup joué)." },
    dk: { id: "dk", name: "Deux Rois", tag: "pas de dame", royal: "k", start: "rnbkkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBKKBNR", promo: "qrbn", desc: "Deux rois par camp, aucune dame. Si l'un des deux est maté, c'est fini." },
    ptq: { id: "ptq", name: "Protège la Dame", tag: "roi sacrifiable", royal: "q", start: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR", promo: "rbn", desc: "Le roi est un simple soldat. Si la dame est mate, tout s'arrête." },
  };
  V.COST = { p: 1, n: 3, b: 3, r: 5, q: 8 };                        // élixir
  V.ELIXIR_START = 0; V.ELIXIR_MAX = 10;
  const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  const isW = (p) => p === p.toUpperCase();

  V.newGame = (mode) => {
    const M = V.MODES[mode], b = new Array(64).fill("");
    M.start.split("/").forEach((row, r) => { let f = 0; for (const ch of row) { if (/\d/.test(ch)) f += +ch; else { b[f + 8 * (7 - r)] = ch; f++; } } });
    return { mode, b, side: "w", ep: -1, half: 0, ply: 0, elixir: { w: V.ELIXIR_START, b: V.ELIXIR_START } };
  };
  const clone = (s) => ({ mode: s.mode, b: s.b.slice(), side: s.side, ep: s.ep, half: s.half, ply: s.ply, elixir: { w: s.elixir.w, b: s.elixir.b } });
  V.clone = clone;
  V.map = (s) => { const m = {}; s.b.forEach((p, i) => { if (p) m[sqName(i)] = p; }); return m; };

  const isRoyal = (s, p) => p && p.toLowerCase() === V.MODES[s.mode].royal;
  const KN = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]], KG = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]], BISH = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

  // la case `sq` est-elle attaquée par les pièces de la couleur `by` ('w'|'b') ?
  function attacked(b, sq, by) {
    const f = sq & 7, r = sq >> 3, W = by === "w";
    const at = (ff, rr) => (ff >= 0 && ff < 8 && rr >= 0 && rr < 8 ? b[ff + 8 * rr] : "");
    const pr = W ? r - 1 : r + 1, pawn = W ? "P" : "p";
    if (at(f - 1, pr) === pawn || at(f + 1, pr) === pawn) return true;
    const n = W ? "N" : "n", k = W ? "K" : "k";
    for (const [a, c] of KN) if (at(f + a, r + c) === n) return true;
    for (const [a, c] of KG) if (at(f + a, r + c) === k) return true;
    const rq = W ? ["R", "Q"] : ["r", "q"], bq = W ? ["B", "Q"] : ["b", "q"];
    for (const [a, c] of ROOK) { for (let ff = f + a, rr = r + c; ff >= 0 && ff < 8 && rr >= 0 && rr < 8; ff += a, rr += c) { const p = b[ff + 8 * rr]; if (p) { if (rq.includes(p)) return true; break; } } }
    for (const [a, c] of BISH) { for (let ff = f + a, rr = r + c; ff >= 0 && ff < 8 && rr >= 0 && rr < 8; ff += a, rr += c) { const p = b[ff + 8 * rr]; if (p) { if (bq.includes(p)) return true; break; } } }
    return false;
  }
  V.attacked = attacked;

  function pseudo(s) {
    const out = [], b = s.b, W = s.side === "w";
    for (let i = 0; i < 64; i++) {
      const p = b[i]; if (!p || isW(p) !== W) continue;
      const t = p.toLowerCase(), f = i & 7, r = i >> 3;
      const push = (to, extra) => out.push(Object.assign({ f: i, t: to, p }, extra));
      if (t === "p") {
        const dir = W ? 1 : -1, last = W ? 7 : 0, start = W ? 1 : 6, r1 = r + dir;
        if (r1 < 0 || r1 > 7) continue;
        const addP = (to, extra) => { if (r1 === last) for (const pc of V.MODES[s.mode].promo) push(to, Object.assign({ promo: pc }, extra)); else push(to, extra); };
        if (!b[f + 8 * r1]) { addP(f + 8 * r1); if (r === start && !b[f + 8 * (r + 2 * dir)]) push(f + 8 * (r + 2 * dir), { dbl: true }); }
        for (const df of [-1, 1]) {
          const ff = f + df; if (ff < 0 || ff > 7) continue;
          const to = ff + 8 * r1, q = b[to];
          if (q && isW(q) !== W) addP(to, { cap: q });
          else if (!q && to === s.ep) push(to, { ep: true, cap: W ? "p" : "P" });
        }
      } else if (t === "n" || t === "k") {
        for (const [a, c] of t === "n" ? KN : KG) { const ff = f + a, rr = r + c; if (ff < 0 || ff > 7 || rr < 0 || rr > 7) continue; const to = ff + 8 * rr, q = b[to]; if (!q || isW(q) !== W) push(to, q ? { cap: q } : null); }
      } else {
        const dirs = t === "r" ? ROOK : t === "b" ? BISH : ROOK.concat(BISH);
        for (const [a, c] of dirs) for (let ff = f + a, rr = r + c; ff >= 0 && ff < 8 && rr >= 0 && rr < 8; ff += a, rr += c) { const to = ff + 8 * rr, q = b[to]; if (q) { if (isW(q) !== W) push(to, { cap: q }); break; } push(to); }
      }
    }
    return out;
  }

  // joue le coup m (objet de pseudo()) sur s, en place. L'élixir du camp qui joue gagne 1.
  function apply(s, m) {
    const b = s.b, W = s.side === "w";
    b[m.f] = "";
    if (m.ep) b[m.t + (W ? -8 : 8)] = "";
    b[m.t] = m.promo ? (W ? m.promo.toUpperCase() : m.promo) : m.p;
    s.ep = m.dbl ? (m.f + m.t) / 2 : -1;
    s.half = m.cap || m.p.toLowerCase() === "p" ? 0 : s.half + 1;
    s.elixir[s.side] = Math.min(V.ELIXIR_MAX, s.elixir[s.side] + 1);
    s.side = W ? "b" : "w"; s.ply++;
  }

  // les royaux de `side` sont-ils tous à l'abri (aucune attaque adverse) ?
  function safe(s, side) {
    const foe = side === "w" ? "b" : "w";
    for (let i = 0; i < 64; i++) { const p = s.b[i]; if (p && isW(p) === (side === "w") && isRoyal(s, p) && attacked(s.b, i, foe)) return false; }
    return true;
  }
  V.inCheck = (s, side) => !safe(s, side || s.side);

  V.legal = (s) => {
    const out = [], side = s.side;
    for (const m of pseudo(s)) { const c = clone(s); apply(c, m); if (safe(c, side)) out.push(m); }
    return out;
  };
  V.legalFrom = (s, sq) => V.legal(s).filter((m) => m.f === sq);

  // ---- poses (élixir) : cases vides des 2 premières rangées du camp ; pion seulement sur la 2ᵉ rangée ; ne doit pas laisser son roi en échec
  V.canDrop = (s, type, sq) => {
    if (s.mode !== "elixir" || s.b[sq]) return false;
    const W = s.side === "w", r = sq >> 3, t = type.toLowerCase();
    if (!(V.COST[t])) return false;
    if (s.elixir[s.side] < V.COST[t]) return false;
    if (W ? r > 1 : r < 6) return false;
    if (t === "p" && r !== (W ? 1 : 6)) return false;
    const c = clone(s); c.b[sq] = W ? t.toUpperCase() : t;
    return safe(c, s.side);
  };
  V.dropSquares = (s, type) => { const o = []; if (s.mode !== "elixir") return o; const W = s.side === "w"; for (let r = W ? 0 : 6; r <= (W ? 1 : 7); r++) for (let f = 0; f < 8; f++) if (V.canDrop(s, type, f + 8 * r)) o.push(f + 8 * r); return o; };
  V.drops = (s) => { const o = []; for (const t of Object.keys(V.COST)) for (const sq of V.dropSquares(s, t)) o.push({ type: t, sq }); return o; };
  V.drop = (s, type, sq) => {                                         // en place ; le tour ne change pas
    if (!V.canDrop(s, type, sq)) return false;
    const W = s.side === "w", t = type.toLowerCase();
    s.b[sq] = W ? t.toUpperCase() : t; s.elixir[s.side] -= V.COST[t]; s.half = 0; s.ep = -1;
    return true;
  };

  // ---- état de la partie : {over, result: 'w'|'b'|'draw', why: 'mate'|'pat'|'50'|'long'|'nul'}
  V.status = (s) => {
    const mv = V.legal(s);
    if (!mv.length && !(s.mode === "elixir" && V.drops(s).length)) {
      if (V.inCheck(s)) return { over: true, result: s.side === "w" ? "b" : "w", why: "mate" };
      return { over: true, result: "draw", why: "pat" };
    }
    if (s.half >= 100) return { over: true, result: "draw", why: "50" };
    if (s.ply >= 400) return { over: true, result: "draw", why: "long" };
    return { over: false };
  };
  V.royals = (s, side) => { const o = []; for (let i = 0; i < 64; i++) { const p = s.b[i]; if (p && isW(p) === (side === "w") && isRoyal(s, p)) o.push(i); } return o; };

  // notation lisible (pas de SAN officiel pour ces variantes)
  V.moveText = (m) => (m.p.toUpperCase() === "P" ? "" : m.p.toUpperCase()) + sqName(m.f) + (m.cap ? "x" : "–") + sqName(m.t) + (m.promo ? "=" + m.promo.toUpperCase() : "");

  // ================================================================== IA
  const PST_CENTER = (i) => { const f = i & 7, r = i >> 3; return 6 - (Math.abs(f - 3.5) + Math.abs(r - 3.5)) * 1.6; };
  function evaluate(s) {                                              // en centipions, du point de vue des Blancs
    let v = 0;
    const R = V.MODES[s.mode].royal;
    for (let i = 0; i < 64; i++) {
      const p = s.b[i]; if (!p) continue;
      const t = p.toLowerCase(), w = isW(p), sg = w ? 1 : -1, r = w ? i >> 3 : 7 - (i >> 3);
      let x = t === "k" && R !== "k" ? 160 : VAL[t];                  // en ptq le roi garde un peu de valeur (soldat)
      if (t === "p") x += r * 6 + (r >= 5 ? (r - 4) * 14 : 0);
      else if (t === "n" || t === "b") x += PST_CENTER(i) * 2.5;
      else if (t === "q" && s.mode !== "ptq") x += PST_CENTER(i) * 0.6;
      v += sg * x;
    }
    // sécurité des royaux : menacés = lourd malus ; « ouverture » devant eux
    for (const side of ["w", "b"]) {
      const sg = side === "w" ? 1 : -1, foe = side === "w" ? "b" : "w";
      for (const i of V.royals(s, side)) {
        if (attacked(s.b, i, foe)) v -= sg * 45;
        let o = 0; for (const [a, c] of KG) { const f = (i & 7) + a, rr = (i >> 3) + c; if (f >= 0 && f < 8 && rr >= 0 && rr < 8 && attacked(s.b, f + 8 * rr, foe)) o++; }
        v -= sg * o * 6;
        if (s.mode !== "ptq" && s.ply < 40) { const rr = side === "w" ? i >> 3 : 7 - (i >> 3); v -= sg * rr * 9; }   // roi : rester chez soi au début
        if (s.mode === "ptq" && s.ply < 20) { const rr = side === "w" ? i >> 3 : 7 - (i >> 3); v -= sg * Math.max(0, rr - 2) * 8; }   // dame : ne pas sortir trop tôt
      }
    }
    if (s.mode === "elixir") v += (s.elixir.w - s.elixir.b) * 70;
    return v;
  }
  V.evaluate = evaluate;
  const MATE = 100000;

  function order(s, moves) {
    return moves.map((m) => ({ m, k: (m.cap ? 10 * (VAL[m.cap.toLowerCase()] || 160) - VAL[m.p.toLowerCase()] / 10 : 0) + (m.promo ? 800 : 0) + (isRoyal(s, m.p) ? -5 : 0) })).sort((a, b) => b.k - a.k).map((x) => x.m);
  }

  function search(s, depth, alpha, beta, ply, dl) {                   // négamax-like en valeur Blanc ; retourne la valeur
    const mv = V.legal(s);
    if (!mv.length) {
      if (s.mode === "elixir" && V.drops(s).length) return evaluate(s);
      return V.inCheck(s) ? (s.side === "w" ? -MATE + ply : MATE - ply) : 0;
    }
    if (depth <= 0) return evaluate(s);
    if (dl && Date.now() > dl) return evaluate(s);
    const W = s.side === "w";
    let best = W ? -Infinity : Infinity;
    for (const m of order(s, mv)) {
      const c = clone(s); apply(c, m);
      const v = search(c, depth - 1, alpha, beta, ply + 1, dl);
      if (W) { if (v > best) best = v; if (best > alpha) alpha = best; } else { if (v < best) best = v; if (best < beta) beta = best; }
      if (alpha >= beta) break;
    }
    return best;
  }

  // niveaux : 1 = débutant (profondeur 1 + gros bruit), 2 = moyen (2), 3 = fort (3, ~1,2 s max)
  const LEVEL = { 1: { depth: 1, noise: 90, drop: 0.55 }, 2: { depth: 2, noise: 25, drop: 0.85 }, 3: { depth: 3, noise: 0, drop: 1 } };

  // la pièce posée en `sq` est-elle capturée « gratuitement » ? (estimation : attaquée par moins cher, ou attaquée et non défendue)
  function dropRisk(s, type, sq) {
    const W = s.side === "w", c = clone(s); c.b[sq] = W ? type.toUpperCase() : type;
    const foe = W ? "b" : "w", me = s.side;
    if (!attacked(c.b, sq, foe)) return 0;
    let cheapest = 1e9;
    for (let i = 0; i < 64; i++) { const p = c.b[i]; if (!p || isW(p) === W || !attacksSq(c, i, sq)) continue; const t = p.toLowerCase(); cheapest = Math.min(cheapest, t === "k" ? 150 : VAL[t]); }
    const defended = attacked(c.b, sq, me);
    const val = VAL[type];
    if (!defended) return val;
    return Math.max(0, val - cheapest);
  }
  function attacksSq(s, from, to) {                                   // la pièce en `from` attaque-t-elle `to` ? (pseudo, sans tenir compte des clouages)
    const p = s.b[from], t = p.toLowerCase(), f = from & 7, r = from >> 3, tf = to & 7, tr = to >> 3, df = tf - f, dr = tr - r;
    if (t === "p") return Math.abs(df) === 1 && dr === (isW(p) ? 1 : -1);
    if (t === "n") return (Math.abs(df) === 1 && Math.abs(dr) === 2) || (Math.abs(df) === 2 && Math.abs(dr) === 1);
    if (t === "k") return Math.max(Math.abs(df), Math.abs(dr)) === 1;
    const diag = Math.abs(df) === Math.abs(dr) && df !== 0, line = (df === 0) !== (dr === 0);
    if (!((t === "b" && diag) || (t === "r" && line) || (t === "q" && (diag || line)))) return false;
    const sf = Math.sign(df), sr = Math.sign(dr);
    for (let ff = f + sf, rr = r + sr; ff !== tf || rr !== tr; ff += sf, rr += sr) if (s.b[ff + 8 * rr]) return false;
    return true;
  }

  /** Choisit l'action de l'IA pour le camp au trait. Retourne {drops: [{type, sq}], move} — les poses d'abord (elles ne passent pas le tour), puis un coup. */
  V.think = (s0, level, rnd) => {
    rnd = rnd || Math.random;
    const L = LEVEL[level] || LEVEL[2], s = clone(s0), W = s.side === "w", sg = W ? 1 : -1;
    const plan = [];
    if (s.mode === "elixir") {
      for (let k = 0; k < 4; k++) {
        const base = evaluate(s) * sg;
        let best = null;
        for (const d of V.drops(s)) {
          if (d.type === "p" && rnd() > 0.5) continue;                // un peu moins de pions inutiles
          const c = clone(s); V.drop(c, d.type, d.sq);
          const risk = dropRisk(s, d.type, d.sq);
          const centre = PST_CENTER(d.sq) * (d.type === "p" ? 0.5 : 1.2);
          const sc = evaluate(c) * sg - base - risk * 1.1 + centre + (d.type === "p" && (d.sq & 7) >= 2 && (d.sq & 7) <= 5 ? 6 : 0) + rnd() * L.noise * 0.2;
          if (V.inCheck(c, W ? "b" : "w")) { /* pose qui donne échec : petit bonus */ }
          if (!best || sc > best.sc) best = { d, sc, c };
        }
        // on dépense seulement si c'est rentable ; à plein d'élixir, on dépense à tout prix (rien ne se gagne de plus)
        const full = s.elixir[s.side] >= V.ELIXIR_MAX - 1;
        if (!best || rnd() > L.drop || (best.sc < 20 && !full) || (best.sc < -10)) break;
        plan.push(best.d); V.drop(s, best.d.type, best.d.sq);
      }
    }
    const mv = V.legal(s);
    if (!mv.length) return { drops: plan, move: null };
    let pick = null;
    const dl = Date.now() + (L.depth >= 3 ? 1400 : 700);
    for (const m of order(s, mv)) {
      const c = clone(s); apply(c, m);
      let v = search(c, L.depth - 1, -Infinity, Infinity, 1, dl) * sg + (rnd() - 0.5) * 2 * L.noise;
      if (!pick || v > pick.v) pick = { m, v };
    }
    return { drops: plan, move: pick.m };
  };

  V.perft = (s, d) => { if (d === 0) return 1; let n = 0; for (const m of V.legal(s)) { const c = clone(s); apply(c, m); n += V.perft(c, d - 1); } return n; };
  V.play = (s, m) => apply(s, m);
  V.pseudo = pseudo;

  if (typeof module !== "undefined" && module.exports) module.exports = V;
  else { root.ENOS = root.ENOS || {}; root.ENOS.variants = V; }
})(typeof window !== "undefined" ? window : globalThis);
