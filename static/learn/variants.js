"use strict";
// VARIANTES D'ÉCHECS « inventions maison » — moteur de règles + petite IA (aucune dépendance : navigateur ET Node pour les tests).
//   elixir : CLASH ROYALE. Plateau de départ = les deux rois seuls. On POSE des pièces (dans ses 2 premières rangées) en payant de l'ÉLIXIR ;
//            chacun commence à 0 élixir (les rois doivent d'abord jouer) ; chaque coup joué rapporte +1 élixir ; poser ne consomme PAS le coup (on peut poser puis jouer, ou économiser en bougeant).
//   dk     : DEUX ROIS. Pas de dame : deux rois par camp. Si l'un des deux est maté, la partie est finie (un seul roi menacé et aucun coup qui sauve tout = mat).
//   duo    : 2 CONTRE 2 sur un plateau normal. 4 joueurs, chacun son ROI et sa barre d'élixir ; deux rois blancs (c1, f1) contre deux rois noirs (c8, f8). Ordre : B1, N1, B2, N2.
//            Chacun ne joue que SES pièces (celles qu'il a posées), les alliés ne se prennent pas. Un roi maté SORT (ses pièces disparaissent) : l'équipe passe à 2 contre 1. Équipe sans roi = défaite.
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
    elixirp: { id: "elixirp", name: "Élixir +", tag: "Méga Chevalier · Armée · Baril · R.E.I.N.E", royal: "k", start: "4k3/8/8/8/8/8/8/4K3", promo: "qrbn", desc: "L'Élixir avec 4 cartes en plus : Méga Chevalier (14), Armée de pions (5), Baril du fou (5), R.E.I.N.E (9)." },
    rnd: { id: "rnd", name: "Roulette", tag: "2 rois · pièces tirées au sort", royal: "k", start: "4k3/8/8/8/8/8/8/4K3", promo: "qrbn", desc: "Deux rois seuls. À chaque tour la roulette te donne une pièce au hasard : pose-la dans tes 2 premières rangées (gratuit), puis joue." },
    dk: { id: "dk", name: "Deux Rois", tag: "pas de dame", royal: "k", start: "rnbkkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBKKBNR", promo: "qrbn", desc: "Deux rois par camp, aucune dame. Si l'un des deux est maté, c'est fini." },
    duo: { id: "duo", name: "2v2 Élixir", tag: "4 rois · 2 équipes", royal: "k", start: "2k2k2/8/8/8/8/8/8/2K2K2", promo: "qrbn", desc: "Deux rois alliés contre deux rois ennemis sur un plateau normal, chacun sa barre d'élixir. Un roi maté sort." },
    ptq: { id: "ptq", name: "Protège la Dame", tag: "roi sacrifiable", royal: "q", start: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR", promo: "rbn", desc: "Le roi est un simple soldat. Si la dame est mate, tout s'arrête." },
  };
  V.COST = { p: 1, n: 3, b: 3, r: 5, q: 8 };                        // élixir
  V.ELIXIR_START = 0; V.ELIXIR_MAX = 10;
  // ÉLIXIR + : 4 cartes. Chaque carte pose une pièce « spéciale » (champ s.sp[case] : mk | rei | barrel | army) dont le DESSIN est celui de la pièce d'échecs de base, retouché façon carte Clash Royale + une aura.
  //   mk     MÉGA CHEVALIER (14 💧) : atterrit n'importe où sur une case vide ; ÉCRASE (capture) toutes les pièces adverses du carré 3×3 autour de son atterrissage — à la pose ET à chacun de ses sauts de cavalier. Un roi écrasé = partie perdue.
  //   army   ARMÉE DE PIONS (5 💧) : remplit d'un coup toute la rangée de pions (les cases vides) de pions-squelettes.
  //   barrel BARIL DU FOU (5 💧) : un fou qui se pose n'importe où sur le plateau (case vide).
  //   rei    R.E.I.N.E (9 💧) : une dame qui CAPTURE en sautant par-dessus les pièces (ses captures ignorent les obstacles ; ses déplacements simples restent bloqués).
  V.SPECIALS = { mk: { base: "n", name: "Méga Chevalier", cost: 14, anywhere: true }, army: { base: "p", name: "Armée de pions", cost: 5, row: true }, barrel: { base: "b", name: "Baril du fou", cost: 5, anywhere: true }, rei: { base: "q", name: "R.E.I.N.E", cost: 9 } };
  V.COSTP = Object.assign({}, V.COST, { mk: 14, army: 5, barrel: 5, rei: 9 });
  V.ELIXIR_MAXP = 15;                                               // plafond d'élixir de l'Élixir + (le Méga Chevalier coûte 14)
  V.HAND_MAX = 5; V.ROULETTE = { p: 34, n: 21, b: 21, r: 15, q: 9 };   // roulette : poids du tirage
  const SPCODE = { mk: "m", rei: "e", barrel: "g", army: "s" };      // lettre de dessin (img/chess/{w|b}{lettre}.png)
  const hasElixir = (s) => s.mode === "elixir" || s.mode === "elixirp" || s.mode === "duo";
  const hasDrops = (s) => hasElixir(s) || s.mode === "rnd";
  const emax = (s) => (s.mode === "elixirp" ? V.ELIXIR_MAXP : V.ELIXIR_MAX);
  const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  const isW = (p) => p === p.toUpperCase();

  // duo : sièges 0 = Blanc A (c1), 1 = Noir A (c8), 2 = Blanc B (f1), 3 = Noir B (f8) ; couleur = siège pair → Blancs ; équipe = siège % 2
  const DUO = mode => mode === "duo";
  V.teamOf = (seat) => seat % 2;
  V.sideOfSeat = (seat) => (seat % 2 ? "b" : "w");
  const ek = (s) => (s.mode === "duo" ? s.seat : s.side);              // clé de la barre d'élixir du joueur au trait
  V.ek = ek;
  V.newGame = (mode) => {
    const M = V.MODES[mode], b = new Array(64).fill("");
    M.start.split("/").forEach((row, r) => { let f = 0; for (const ch of row) { if (/\d/.test(ch)) f += +ch; else { b[f + 8 * (7 - r)] = ch; f++; } } });
    const s = { mode, b, side: "w", ep: -1, half: 0, ply: 0, elixir: { w: V.ELIXIR_START, b: V.ELIXIR_START }, sp: new Array(64).fill(""), hand: { w: [], b: [] }, spun: false };
    if (DUO(mode)) {
      s.seat = 0; s.alive = [true, true, true, true]; s.o = new Array(64).fill(-1); s.elixir = { 0: V.ELIXIR_START, 1: V.ELIXIR_START, 2: V.ELIXIR_START, 3: V.ELIXIR_START };
      s.o[2] = 0; s.o[5] = 2; s.o[58] = 1; s.o[61] = 3;
    }
    return s;
  };
  const clone = (s) => {
    const c = { mode: s.mode, b: s.b.slice(), side: s.side, ep: s.ep, half: s.half, ply: s.ply, elixir: Object.assign({}, s.elixir), sp: s.sp.slice(), hand: { w: s.hand.w.slice(), b: s.hand.b.slice() }, spun: s.spun };
    if (s.kingLost) c.kingLost = s.kingLost;
    if (s.o) { c.o = s.o.slice(); c.seat = s.seat; c.alive = s.alive.slice(); }
    return c;
  };
  V.clone = clone;
  V.map = (s) => { const m = {}; s.b.forEach((p, i) => { if (p) { const q = s.sp && s.sp[i]; m[sqName(i)] = q ? (isW(p) ? SPCODE[q].toUpperCase() : SPCODE[q]) : p; } }); return m; };           // les pièces spéciales ont leur propre dessin (m, e, g, s)
  V.looks = (s) => { const m = {}; s.sp.forEach((q, i) => { if (q && s.b[i]) m[sqName(i)] = q; }); return m; };
  V.fen = (s) => { const rows = []; for (let r = 7; r >= 0; r--) { let row = "", e = 0; for (let f = 0; f < 8; f++) { const i = f + 8 * r, p = s.b[i]; if (!p) { e++; continue; } if (e) { row += e; e = 0; } const q = s.sp[i]; row += q ? (isW(p) ? SPCODE[q].toUpperCase() : SPCODE[q]) : p; } if (e) row += e; rows.push(row); } return rows.join("/") + " " + (s.side === "w" ? "w" : "b") + " - - 0 1"; };

  const isRoyal = (s, p) => p && p.toLowerCase() === V.MODES[s.mode].royal;
  const KN = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]], KG = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]], BISH = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

  // la case `sq` est-elle attaquée par les pièces de la couleur `by` ('w'|'b') ?
  function attacked(b, sq, by, sp) {
    const f = sq & 7, r = sq >> 3, W = by === "w";
    if (sp) for (let i = 0; i < 64; i++) {                                                         // pièces spéciales du camp `by` qui menacent la case sans suivre les règles normales
      const q = sp[i], pc = q && b[i]; if (!pc || isW(pc) !== W) continue;
      if (q === "rei") { const df = f - (i & 7), dr = r - (i >> 3); if ((df === 0) !== (dr === 0) || (df !== 0 && Math.abs(df) === Math.abs(dr))) return true; }      // R.E.I.N.E : toute la ligne, par-dessus les pièces
      else if (q === "mk") for (const [a, c] of KN) { const ff = (i & 7) + a, rr = (i >> 3) + c; if (ff < 0 || ff > 7 || rr < 0 || rr > 7) continue; const t = ff + 8 * rr, o = b[t]; if (o && isW(o) === W) continue; if (Math.max(Math.abs(ff - f), Math.abs(rr - r)) <= 1) return true; }      // Méga Chevalier : un saut qui atterrit à ≤ 1 case l'écrase
    }
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
  V.attacked = (b, sq, by, sp) => attacked(b, sq, by, sp);

  function pseudo(s) {
    const out = [], b = s.b, W = s.side === "w";
    for (let i = 0; i < 64; i++) {
      const p = b[i]; if (!p || isW(p) !== W || (s.o && s.o[i] !== s.seat)) continue;
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
      } else if (t === "q" && s.sp[i] === "rei") {                                  // R.E.I.N.E : ses CAPTURES sautent par-dessus les pièces ; ses simples déplacements s'arrêtent au 1er obstacle
        for (const [a, c] of ROOK.concat(BISH)) { let jumped = false; for (let ff = f + a, rr = r + c; ff >= 0 && ff < 8 && rr >= 0 && rr < 8; ff += a, rr += c) { const to = ff + 8 * rr, q = b[to]; if (q) { jumped = true; if (isW(q) !== W) push(to, { cap: q }); continue; } if (!jumped) push(to); } }
      } else {
        const dirs = t === "r" ? ROOK : t === "b" ? BISH : ROOK.concat(BISH);
        for (const [a, c] of dirs) for (let ff = f + a, rr = r + c; ff >= 0 && ff < 8 && rr >= 0 && rr < 8; ff += a, rr += c) { const to = ff + 8 * rr, q = b[to]; if (q) { if (isW(q) !== W) push(to, { cap: q }); break; } push(to); }
      }
    }
    return out;
  }

  // joue le coup m (objet de pseudo()) sur s, en place. L'élixir du camp qui joue gagne 1.
  function apply(s, m) {
    const b = s.b, W = s.side === "w", spm = s.sp[m.f];
    s.ev = { smash: [] };
    b[m.f] = ""; s.sp[m.f] = "";
    if (m.ep) { b[m.t + (W ? -8 : 8)] = ""; s.sp[m.t + (W ? -8 : 8)] = ""; if (s.o) s.o[m.t + (W ? -8 : 8)] = -1; }
    if (m.cap && isRoyal(s, m.cap)) s.kcap = { sq: m.t };
    b[m.t] = m.promo ? (W ? m.promo.toUpperCase() : m.promo) : m.p;
    s.sp[m.t] = m.promo ? "" : spm;
    if (s.o) { s.o[m.t] = s.o[m.f]; s.o[m.f] = -1; }
    if (spm === "mk") smash(s, m.t, W);
    s.ep = m.dbl ? (m.f + m.t) / 2 : -1;
    s.half = m.cap || m.p.toLowerCase() === "p" ? 0 : s.half + 1;
    s.elixir[ek(s)] = Math.min(emax(s), s.elixir[ek(s)] + 1);
    s.ply++; s.spun = false;
    if (s.o) advance(s); else s.side = W ? "b" : "w";
  }
  // Méga Chevalier : écrase les pièces ADVERSES du carré 3×3 centré sur `to` (la case `to` elle-même a déjà été jouée) ; un roi écrasé = partie perdue (modes à 1 roi) / roi capturé (2v2)
  function smash(s, to, W) {
    const f0 = to & 7, r0 = to >> 3;
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
      const ff = f0 + a, rr = r0 + c; if ((!a && !c) || ff < 0 || ff > 7 || rr < 0 || rr > 7) continue;
      const i = ff + 8 * rr, p = s.b[i]; if (!p || isW(p) === W) continue;
      if (isRoyal(s, p)) { s.kcap = { sq: i }; if (!s.o && s.mode !== "dk") s.kingLost = W ? "b" : "w"; }
      s.b[i] = ""; s.sp[i] = ""; if (s.o) s.o[i] = -1; s.ev.smash.push(i); s.half = 0;
    }
  }
  function advance(s) {                                               // duo : siège suivant encore en vie
    for (let k = 1; k <= 4; k++) { const n = (s.seat + k) % 4; if (s.alive[n]) { s.seat = n; s.side = V.sideOfSeat(n); return; } }
  }

  // les royaux de `side` sont-ils tous à l'abri (aucune attaque adverse) ?
  function safe(s, side, seat) {                                      // seat (duo) : on ne regarde que le roi de ce joueur
    const foe = side === "w" ? "b" : "w";
    for (let i = 0; i < 64; i++) { const p = s.b[i]; if (p && isW(p) === (side === "w") && isRoyal(s, p) && (seat === undefined || s.o[i] === seat) && attacked(s.b, i, foe, s.sp)) return false; }
    return true;
  }
  V.inCheck = (s, side) => !safe(s, side || s.side, s.o ? s.seat : undefined);

  V.legal = (s) => {
    const out = [], side = s.side, seat = s.o ? s.seat : undefined;
    for (const m of pseudo(s)) { const c = clone(s); apply(c, m); if (safe(c, side, seat)) out.push(m); }
    return out;
  };
  V.legalFrom = (s, sq) => V.legal(s).filter((m) => m.f === sq);

  // ---- poses : élixir (Élixir, Élixir +, 2v2) ou pièce de la main (Roulette). Rangées propres (2 premières) ; pion seulement sur la 2ᵉ ; ne doit pas laisser son roi en échec.
  // Cartes de l'Élixir + : mk et barrel n'importe où (case vide), army remplit la rangée de pions, rei = dame dans ses 2 rangées.
  const spOf = (type) => V.SPECIALS[type];
  const baseOf = (type) => (spOf(type) ? spOf(type).base : type.toLowerCase());
  const costOf = (s, type) => (s.mode === "rnd" ? 0 : V.COSTP[spOf(type) ? type : type.toLowerCase()]);
  function placeOn(c, type, sq) {                                      // pose `type` sur sq dans l'état c (en place) ; retourne les cases remplies
    const W = c.side === "w", sp = spOf(type), t = baseOf(type), put = (i, pc, q) => { c.b[i] = W ? pc.toUpperCase() : pc; c.sp[i] = q || ""; if (c.o) c.o[i] = c.seat; }, filled = [];
    if (type === "army") { const row = W ? 1 : 6; for (let f = 0; f < 8; f++) { const i = f + 8 * row; if (!c.b[i]) { put(i, "p", "army"); filled.push(i); } } }
    else { put(sq, t, sp ? type : ""); filled.push(sq); if (type === "mk") { c.ev = { smash: [] }; smash(c, sq, W); } }
    return filled;
  }
  V.canDrop = (s, type, sq) => {
    if (!hasDrops(s)) return false;
    const sp = spOf(type), W = s.side === "w", t = baseOf(type);
    if (!sp && !V.COST[t]) return false;
    if (sp && s.mode !== "elixirp") return false;
    if (s.mode === "rnd") { if (!s.hand[s.side].includes(sp ? type : t)) return false; }
    else if (s.elixir[ek(s)] < costOf(s, type)) return false;
    if (type === "army") { const row = W ? 1 : 6; if ((sq >> 3) !== row || s.b[sq]) return false; }
    else {
      if (s.b[sq]) return false;
      const r = sq >> 3;
      if (!(sp && sp.anywhere)) { if (W ? r > 1 : r < 6) return false; }
      if (t === "p" && r !== (W ? 1 : 6)) return false;
    }
    const c = clone(s); if (s.o) { c.o = s.o.slice(); c.seat = s.seat; c.alive = s.alive.slice(); } placeOn(c, type, sq);
    return safe(c, s.side, s.o ? s.seat : undefined);
  };
  const dropTypes = (s) => (s.mode === "rnd" ? Array.from(new Set(s.hand[s.side])) : s.mode === "elixirp" ? Object.keys(V.COSTP) : Object.keys(V.COST));
  V.dropSquares = (s, type) => {
    const o = []; if (!hasDrops(s)) return o;
    const W = s.side === "w", sp = spOf(type);
    if (type === "army") { const row = W ? 1 : 6; for (let f = 0; f < 8; f++) if (V.canDrop(s, type, f + 8 * row)) o.push(f + 8 * row); return o; }
    if (sp && sp.anywhere) { for (let i = 0; i < 64; i++) if (V.canDrop(s, type, i)) o.push(i); return o; }
    for (let r = W ? 0 : 6; r <= (W ? 1 : 7); r++) for (let f = 0; f < 8; f++) if (V.canDrop(s, type, f + 8 * r)) o.push(f + 8 * r);
    return o;
  };
  V.drops = (s) => { const o = []; for (const t of dropTypes(s)) { const sq = V.dropSquares(s, t); if (t === "army") { if (sq.length) o.push({ type: t, sq: sq[0] }); } else for (const x of sq) o.push({ type: t, sq: x }); } return o; };
  V.drop = (s, type, sq) => {                                         // en place ; le tour ne change pas. s.ev = {smash: cases écrasées, filled: cases remplies}
    if (!V.canDrop(s, type, sq)) return false;
    const sp = spOf(type), t = baseOf(type);
    const filled = placeOn(s, type, sq); s.ev = Object.assign(s.ev || { smash: [] }, { filled });
    if (s.mode === "rnd") { const h = s.hand[s.side], k = h.indexOf(sp ? type : t); h.splice(k, 1); } else s.elixir[ek(s)] -= costOf(s, type);
    s.half = 0; s.ep = -1;
    return true;
  };

  // ---- roulette (mode « Roulette ») : au début de chaque tour on tire une pièce qui va dans la main (5 au plus ; la plus ancienne est perdue au-delà)
  V.spin = (s, rnd) => {
    rnd = rnd || Math.random; let x = rnd() * Object.values(V.ROULETTE).reduce((a, b) => a + b, 0), pick = "p";
    for (const k of Object.keys(V.ROULETTE)) { x -= V.ROULETTE[k]; if (x <= 0) { pick = k; break; } }
    const h = s.hand[s.side]; if (h.length >= V.HAND_MAX) h.shift(); h.push(pick); s.spun = true; return pick;
  };
  /** à appeler au début de chaque tour : tire la pièce de la roulette si ce n'est pas déjà fait (idempotent) ; retourne la pièce tirée ou null */
  V.beginTurn = (s, rnd) => (s.mode === "rnd" && !s.spun ? V.spin(s, rnd) : null);

  // ---- état de la partie : {over, result: 'w'|'b'|'draw', why: 'mate'|'pat'|'50'|'long'|'nul'}
  // duo : règle les éliminations à partir du joueur au trait (en place). Retourne {over, result, why, out: [{seat, sq}]} ; sq = case du roi qui sort.
  V.settle = (s) => {
    const out = [];
    for (let guard = 0; guard < 9; guard++) {
      for (let q = 0; q < 4; q++) {                                    // un ROI CAPTURÉ (par un coup adverse ou le Méga Chevalier) élimine son joueur, même s'il n'était pas « maté »
        if (!s.alive[q] || V.royals(s, V.sideOfSeat(q)).some((i) => s.o[i] === q)) continue;
        out.push({ seat: q, sq: s.kcap ? s.kcap.sq : -1, team: V.teamOf(q), why: "captured" });
        for (let i = 0; i < 64; i++) if (s.o[i] === q) { s.b[i] = ""; s.sp[i] = ""; s.o[i] = -1; }
        s.alive[q] = false; if (s.seat === q) advance(s);
      }
      const team = (t) => [0, 1, 2, 3].some((x) => x % 2 === t && s.alive[x]);
      if (!team(0)) return { over: true, result: "b", why: "mate", out };
      if (!team(1)) return { over: true, result: "w", why: "mate", out };
      const chk = V.inCheck(s);
      if (V.legal(s).length || (chk && V.drops(s).length)) break;      // en échec sans coup, une pose peut encore parer
      if (chk) {                                             // roi maté : il sort, ses pièces disparaissent
        const kings = V.royals(s, s.side).filter((i) => s.o[i] === s.seat);
        out.push({ seat: s.seat, sq: kings[0], team: V.teamOf(s.seat) });
        for (let i = 0; i < 64; i++) if (s.o[i] === s.seat) { s.b[i] = ""; s.sp[i] = ""; s.o[i] = -1; }
        s.alive[s.seat] = false;
      }
      advance(s);                                                     // mat (le suivant joue) ou pat (aucun coup : le joueur passe son tour)
      if (guard === 8) return { over: true, result: "draw", why: "pat", out };
    }
    if (s.half >= 100) return { over: true, result: "draw", why: "50", out };
    if (s.ply >= 320) return { over: true, result: "draw", why: "long", out };
    return { over: false, out };
  };
  V.status = (s) => {
    if (s.o) return V.settle(clone(s));
    if (s.kingLost) return { over: true, result: s.kingLost === "w" ? "b" : "w", why: "smash" };                           // roi écrasé par le Méga Chevalier
    const mv = V.legal(s);
    if (!mv.length && !(hasDrops(s) && V.drops(s).length)) {
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
      const spq = s.sp[i]; if (spq === "mk") x += 480; else if (spq === "rei") x += 180; else if (spq === "barrel") x += 20; else if (spq === "army") x -= 12;           // cartes spéciales : le Méga Chevalier vaut bien plus qu'un cavalier
      v += sg * x;
    }
    // sécurité des royaux : menacés = lourd malus ; « ouverture » devant eux
    for (const side of ["w", "b"]) {
      const sg = side === "w" ? 1 : -1, foe = side === "w" ? "b" : "w";
      for (const i of V.royals(s, side)) {
        if (attacked(s.b, i, foe, s.sp)) v -= sg * 45;
        let o = 0; for (const [a, c] of KG) { const f = (i & 7) + a, rr = (i >> 3) + c; if (f >= 0 && f < 8 && rr >= 0 && rr < 8 && attacked(s.b, f + 8 * rr, foe, s.sp)) o++; }
        v -= sg * o * 6;
        if (s.mode !== "ptq" && s.ply < 40) { const rr = side === "w" ? i >> 3 : 7 - (i >> 3); v -= sg * rr * 9; }   // roi : rester chez soi au début
        if (s.mode === "ptq" && s.ply < 20) { const rr = side === "w" ? i >> 3 : 7 - (i >> 3); v -= sg * Math.max(0, rr - 2) * 8; }   // dame : ne pas sortir trop tôt
      }
    }
    if (s.mode === "elixir" || s.mode === "elixirp") v += (s.elixir.w - s.elixir.b) * 70;
    else if (s.mode === "rnd") { const hv = (h) => h.reduce((a, t) => a + VAL[t], 0); v += (hv(s.hand.w) - hv(s.hand.b)) * 0.7; }
    else if (s.o) v += (s.elixir[0] * s.alive[0] + s.elixir[2] * s.alive[2] - s.elixir[1] * s.alive[1] - s.elixir[3] * s.alive[3]) * 70 + ((s.alive[0] + s.alive[2]) - (s.alive[1] + s.alive[3])) * 700;
    return v;
  }
  V.evaluate = evaluate;
  const MATE = 100000;

  function order(s, moves) {
    return moves.map((m) => ({ m, k: (m.cap ? 10 * (VAL[m.cap.toLowerCase()] || 160) - VAL[m.p.toLowerCase()] / 10 : 0) + (m.promo ? 800 : 0) + (isRoyal(s, m.p) ? -5 : 0) })).sort((a, b) => b.k - a.k).map((x) => x.m);
  }

  function search(s, depth, alpha, beta, ply, dl) {                   // négamax-like en valeur Blanc ; retourne la valeur
    if (s.kingLost) return s.kingLost === "w" ? -MATE + ply : MATE - ply;                          // roi écrasé
    const mv = V.legal(s);
    if (!mv.length) {
      if (hasDrops(s) && V.drops(s).length) return evaluate(s);
      if (s.o) return V.inCheck(s) ? (s.side === "w" ? -450 : 450) : evaluate(s);   // duo : un roi maté sort, ce n'est pas la fin de la partie
      return V.inCheck(s) ? (s.side === "w" ? -MATE + ply : MATE - ply) : 0;
    }
    if (depth <= 0) return evaluate(s);
    if (dl && Date.now() > dl) return evaluate(s);
    const W = s.side === "w";
    let best = W ? -Infinity : Infinity;
    for (const m of order(s, mv)) {
      const c = clone(s); apply(c, m);
      const v = s.o && m.cap && isRoyal(s, m.cap) ? (W ? 450 : -450) : search(c, depth - 1, alpha, beta, ply + 1, dl);     // 2v2 : capturer un roi sort son joueur
      if (W) { if (v > best) best = v; if (best > alpha) alpha = best; } else { if (v < best) best = v; if (best < beta) beta = best; }
      if (alpha >= beta) break;
    }
    return best;
  }

  // niveaux : 1 = débutant (profondeur 1 + gros bruit), 2 = moyen (2), 3 = fort (3, ~1,2 s max)
  const LEVEL = { 1: { depth: 1, noise: 90, drop: 0.55 }, 2: { depth: 2, noise: 25, drop: 0.85 }, 3: { depth: 3, noise: 0, drop: 1 } };

  // la pièce posée en `sq` est-elle capturée « gratuitement » ? (estimation : attaquée par moins cher, ou attaquée et non défendue)
  function dropRisk(s, type, sq) {
    if (type === "army") return 0;
    const W = s.side === "w", c = clone(s), bt = baseOf(type); c.b[sq] = W ? bt.toUpperCase() : bt; if (spOf(type)) c.sp[sq] = type;
    const foe = W ? "b" : "w", me = s.side;
    if (!attacked(c.b, sq, foe, c.sp)) return 0;
    let cheapest = 1e9;
    for (let i = 0; i < 64; i++) { const p = c.b[i]; if (!p || isW(p) === W || !attacksSq(c, i, sq)) continue; const t = p.toLowerCase(); cheapest = Math.min(cheapest, t === "k" ? 150 : VAL[t]); }
    const defended = attacked(c.b, sq, me, c.sp);
    const val = VAL[bt] + (type === "mk" ? 480 : type === "rei" ? 180 : 0);
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
  V.think = (s0, level, rnd, opts) => {
    rnd = rnd || Math.random;
    const strat = (opts && opts.strat) || "bal", tgt = opts && opts.target != null ? opts.target : -1;
    const L = LEVEL[level] || LEVEL[2], s = clone(s0), W = s.side === "w", sg = W ? 1 : -1;
    const plan = [];
    if (s.mode === "rnd") V.beginTurn(s, rnd);                                                     // la roulette a déjà tourné côté interface ; sinon on tire ici
    if (hasDrops(s)) {
      for (let k = 0; k < (s.mode === "rnd" ? 5 : 4); k++) {
        const base = evaluate(s) * sg;
        let best = null;
        for (const d of V.drops(s)) {
          if (d.type === "p" && rnd() > 0.5) continue;                // un peu moins de pions inutiles
          const c = clone(s); V.drop(c, d.type, d.sq);
          const risk = dropRisk(s, d.type, d.sq);
          const centre = PST_CENTER(d.sq) * (d.type === "p" ? 0.5 : 1.2);
          const sc = dropBias(s, strat, tgt, d) + evaluate(c) * sg - base - risk * 1.1 + centre + (d.type === "p" && (d.sq & 7) >= 2 && (d.sq & 7) <= 5 ? 6 : 0) + rnd() * L.noise * 0.2;
          if (V.inCheck(c, W ? "b" : "w")) { /* pose qui donne échec : petit bonus */ }
          if (!best || sc > best.sc) best = { d, sc, c };
        }
        // on dépense seulement si c'est rentable ; à plein d'élixir, on dépense à tout prix (rien ne se gagne de plus)
        const full = s.mode === "rnd" || s.elixir[ek(s)] >= emax(s) - 1, forced = !V.legal(s).length && V.inCheck(s);
        const eager = strat === "rush" ? 12 : 20, thrifty = strat === "eco" && !full && best && !["q", "r", "mk", "rei"].includes(best.d.type);   // rush : dépense vite ; économe : n'achète que les grosses pièces
        if (!best || (!forced && (thrifty || rnd() > L.drop || (best.sc < eager && !full) || (best.sc < -10)))) break;
        plan.push(best.d); V.drop(s, best.d.type, best.d.sq);
        if (forced && V.legal(s).length) break;
      }
    }
    const mv = V.legal(s);
    if (!mv.length) return { drops: plan, move: null };
    let pick = null;
    const dl = Date.now() + (L.depth >= 3 ? 1400 : 700);
    for (const m of order(s, mv)) {
      const c = clone(s); apply(c, m);
      let v = search(c, L.depth - 1, -Infinity, Infinity, 1, dl) * sg + (rnd() - 0.5) * 2 * L.noise + moveBias(s, strat, tgt, m);
      if (!pick || v > pick.v) pick = { m, v };
    }
    return { drops: plan, move: pick.m };
  };

  // ================================================================== STRATÉGIES (biais ajoutés au jugement de base) + analyse en temps réel + jugement des coups
  V.STRATS = {
    bal: { name: "Équilibré", icon: "⚖", sub: "un peu de tout" },
    rush: { name: "Rush", icon: "🔥", sub: "pose vite, attaque le roi" },
    eco: { name: "Économe", icon: "💎", sub: "garde son élixir pour les grosses pièces" },
    tank: { name: "Muraille", icon: "🛡", sub: "défend d'abord, contre-attaque ensuite" },
    focus: { name: "Chasse au roi", icon: "🎯", sub: "toute l'équipe sur un même roi" },
  };
  const distSq = (a, b) => Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 3) - (b >> 3)));
  function foeRoyals(s, side, tgtSeat) {                              // cases des rois ennemis à viser (en duo, la cible choisie par l'équipe si elle existe)
    const foe = side === "w" ? "b" : "w", all = V.royals(s, foe);
    if (s.o && tgtSeat >= 0) { const t = all.filter((i) => s.o[i] === tgtSeat); if (t.length) return t; }
    return all;
  }
  function moveBias(s, strat, tgt, m) {                               // en centipions, du point de vue du joueur au trait
    if (strat === "bal" || strat === "eco") return 0;
    const side = s.side, t = m.p.toLowerCase();
    if (strat === "tank") {
      const home = side === "w" ? m.t >> 3 : 7 - (m.t >> 3), was = side === "w" ? m.f >> 3 : 7 - (m.f >> 3);
      if (isRoyal(s, m.p) && s.mode !== "ptq") return (home - was) * -10 - (home > 1 ? 15 : 0);
      return (home <= 3 ? 6 : 0) - (t === "q" && home > 4 && s.ply < 30 ? 25 : 0);
    }
    const ks = foeRoyals(s, side, strat === "focus" ? tgt : -1);
    if (!ks.length || isRoyal(s, m.p)) return 0;
    let d0 = 99, d1 = 99; for (const k of ks) { d0 = Math.min(d0, distSq(m.f, k)); d1 = Math.min(d1, distSq(m.t, k)); }
    const k = strat === "focus" ? 7 : 5;
    let b = (d0 - d1) * k;
    if (strat === "rush" && m.cap) b += 10;
    const c = clone(s); apply(c, m);
    for (const kk of ks) if (attacksSq(c, m.t, kk)) { b += strat === "focus" ? 35 : 22; break; }    // un coup qui menace le roi visé
    return b;
  }
  function dropBias(s, strat, tgt, d) {
    const home = s.side === "w" ? d.sq >> 3 : 7 - (d.sq >> 3), t = d.type;
    if (strat === "rush") return (t === "n" || t === "b" ? 22 : t === "q" ? 14 : 0) + home * 4;
    if (strat === "eco") return t === "q" ? 40 : t === "r" ? 18 : -20;
    if (strat === "tank") { const own = V.royals(s, s.side).filter((i) => !s.o || s.o[i] === s.seat)[0]; return own !== undefined ? Math.max(0, 6 - distSq(d.sq, own)) * 4 + (t === "p" ? 12 : 0) : 0; }
    if (strat === "focus") { const ks = foeRoyals(s, s.side, tgt); let dm = 99; for (const k of ks) dm = Math.min(dm, distSq(d.sq, k)); return (t === "n" || t === "q" || t === "r" ? (8 - dm) * 3 : 0); }
    return 0;
  }
  /** Équipe (duo) : le roi ennemi à viser = celui du joueur le plus faible (peu de matériel, peu d'élixir). -1 hors duo. */
  V.pickTarget = (s, seat) => {
    if (!s.o) return -1;
    let best = -1, bv = Infinity;
    for (let q = 0; q < 4; q++) {
      if (!s.alive[q] || V.teamOf(q) === V.teamOf(seat)) continue;
      let m = s.elixir[q] * 70; for (let i = 0; i < 64; i++) if (s.o[i] === q) m += VAL[s.b[i].toLowerCase()] || 0;
      const k = V.royals(s, V.sideOfSeat(q)).find((i) => s.o[i] === q);
      if (k !== undefined) { const side = V.sideOfSeat(q); m += (side === "w" ? k >> 3 : 7 - (k >> 3)) * 14; }   // un roi qui s'est avancé est plus fragile
      if (m < bv) { bv = m; best = q; }
    }
    return best;
  };
  /** Adaptation en cours de partie : en difficulté → muraille ; nettement devant → rush ; sinon la stratégie de base. evTeam = avantage de l'équipe en cp. */
  V.adaptStrat = (base, evTeam) => (evTeam <= -220 ? "tank" : evTeam >= 260 && base !== "eco" ? "rush" : base);
  V.planText = (s, seat, strat, tgt) => {
    const info = V.STRATS[strat] || V.STRATS.bal, x = s.elixir[s.o ? seat : V.sideOfSeat(seat)];
    if (strat === "eco") return x >= V.COST.q ? "💎 Dame prête : il l'achète !" : "💎 Économise : " + x + "/" + V.COST.q + " pour la dame";
    if (strat === "rush") return "🔥 Rush : pose tout de suite, avance sur le roi";
    if (strat === "tank") return "🛡 Muraille : protège son roi avant d'attaquer";
    if (strat === "focus") return tgt >= 0 ? "🎯 Cible : " + ["Blanc A", "Noir A", "Blanc B", "Noir B"][tgt] : "🎯 Chasse au roi adverse";
    return info.icon + " " + info.name;
  };

  // ---- analyse : tous les coups légaux notés (point de vue du joueur au trait), profondeur 2 puis 3. Job découpé : step(ms) à appeler par tranches pour ne pas figer l'écran.
  V.analyseJob = (s, maxDepth) => {
    maxDepth = maxDepth || 3;
    const sg = s.side === "w" ? 1 : -1, moves = order(s, V.legal(s)), job = { depth: 2, i: 0, cur: [], done: !moves.length, result: null, t0: Date.now() };
    const fin = () => {
      const list = job.cur.slice().sort((a, b) => b.cp - a.cp);
      job.result = { list, depth: job.depth, evalW: list.length ? list[0].cp * sg : evaluate(s), side: s.side, mate: list.length && Math.abs(list[0].raw) > MATE - 1000 ? Math.ceil((MATE - Math.abs(list[0].raw)) / 2) : 0 };
    };
    if (!moves.length) job.result = { list: [], depth: 0, evalW: evaluate(s), side: s.side, mate: 0 };
    job.step = (ms) => {
      const t = Date.now();
      while (!job.done && Date.now() - t < ms) {
        const m = moves[job.i], c = clone(s); apply(c, m);
        const raw = search(c, job.depth - 1, -Infinity, Infinity, 1, 0) * sg;
        job.cur.push({ m, cp: Math.max(-1500, Math.min(1500, raw)), raw });
        if (++job.i >= moves.length) { fin(); if (job.depth >= maxDepth || Date.now() - job.t0 > 2200) job.done = true; else { job.depth++; job.i = 0; job.cur = []; } }
      }
      return job.done;
    };
    return job;
  };
  V.analyse = (s, maxDepth) => { const j = V.analyseJob(s, maxDepth || 2); while (!j.step(1000)); return j.result; };

  // un coup qui laisse une pièce lourde à une pièce plus faible, ou attaquée sans défenseur (les alliés comptent comme défenseurs : même couleur) — sans prendre de l'équivalent
  V.isSacrifice = (s, m) => {
    const t = m.p.toLowerCase(), val = VAL[t]; if (val < 300) return false;
    if (m.cap && (VAL[m.cap.toLowerCase()] || 0) >= val - 60) return false;
    const c = clone(s); apply(c, m);
    const me = isW(m.p) ? "w" : "b", foe = me === "w" ? "b" : "w";
    if (!attacked(c.b, m.t, foe, c.sp)) return false;
    for (let i = 0; i < 64; i++) { const p = c.b[i]; if (!p || isW(p) === (me === "w") || !attacksSq(c, i, m.t)) continue; if ((VAL[p.toLowerCase()] || 150) < val - 60) return true; }
    return !attacked(c.b, m.t, me, c.sp);
  };
  V.QUALITY = { brilliant: "Brillant", best: "Meilleur coup", excellent: "Excellent", good: "Bon", forced: "Coup forcé", inaccuracy: "Imprécision", mistake: "Erreur", miss: "Manqué", blunder: "Gaffe" };
  /** Juge le coup m d'après l'analyse an de la position AVANT le coup. {key, gap, best, mine} ; null si pas assez de choix. */
  V.judge = (s, an, m) => {
    if (!an || !an.list.length) return null;
    if (an.list.length === 1) return { key: "forced", gap: 0, best: Math.round(an.list[0].cp), mine: Math.round(an.list[0].cp), only: false };                  // un seul coup légal
    const e = an.list.find((x) => x.m.f === m.f && x.m.t === m.t && x.m.promo === m.promo); if (!e) return null;
    const best = an.list[0].cp, gap = best - e.cp, bestRaw = an.list[0].raw, mateB = bestRaw > MATE - 1000 ? MATE - bestRaw : 0;
    let key;
    if (mateB) {                                                       // le moteur voyait un MAT : le garder = meilleur ; sacrifier sans avancer = coup MANQUÉ (jamais « brillant »)
      const mateA = e.raw > MATE - 1000 ? MATE - e.raw : -1;
      key = mateA >= 0 && mateA <= mateB ? "best" : mateA >= 0 && mateA <= mateB + 2 ? "good" : e.cp >= 300 ? "miss" : e.cp >= -100 ? "mistake" : "blunder";
      return { key, gap: Math.round(gap), best: Math.round(best), mine: Math.round(e.cp) };
    }
    key = gap <= 6 ? "best" : gap <= 30 ? "excellent" : gap <= 70 ? "good" : gap <= 130 ? "inaccuracy" : gap <= 260 ? "mistake" : "blunder";
    if (best >= 600 && e.cp >= 200 && gap >= 120 && key !== "blunder") key = "miss";                       // déjà gagnant : le coup laisse filer l'essentiel sans tout perdre
    if (gap <= 18 && e.cp > -300 && best < 600 && V.isSacrifice(s, m)) {
      const safe = an.list.find((x) => !(x.m.f === m.f && x.m.t === m.t) && !V.isSacrifice(s, x.m));
      if (!safe || e.cp >= safe.cp + 40) key = "brilliant";
    }
    if (an.list.length >= 2 && key === "best" && an.list[1] && best - an.list[1].cp >= 350 && (an.list.length <= 4 || V.inCheck(s))) return { key: "forced", gap: 0, best: Math.round(best), mine: Math.round(e.cp), only: true };          // seul coup qui ne perd pas
    return { key, gap: Math.round(gap), best: Math.round(best), mine: Math.round(e.cp) };
  };
  V.pass = (s) => { if (s.o) advance(s); else s.side = s.side === "w" ? "b" : "w"; s.spun = false; };   // aucun coup possible (duo)
  V.perft = (s, d) => { if (d === 0) return 1; let n = 0; for (const m of V.legal(s)) { const c = clone(s); apply(c, m); n += V.perft(c, d - 1); } return n; };
  V.play = (s, m) => apply(s, m);
  V.pseudo = pseudo;

  if (typeof module !== "undefined" && module.exports) module.exports = V;
  else { root.ENOS = root.ENOS || {}; root.ENOS.variants = V; }
})(typeof window !== "undefined" ? window : globalThis);
