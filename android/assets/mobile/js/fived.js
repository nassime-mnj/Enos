"use strict";
// 5D CHESS — MOTEUR DE RÈGLES (échecs à plusieurs timelines et voyage dans le temps), sans interface : testable seul (Node) et utilisé par js/m_fived.js.
//
// Modèle : un « multivers » = plusieurs timelines (axe L, entier : 0 = la partie d'origine, +1, +2… créées par les Blancs, −1, −2… par les Noirs). Chaque timeline est une suite de plateaux,
// un par demi-coup (axe T : t pair = les Blancs jouent, t impair = les Noirs). Un plateau est un tableau de W×H cases (0 vide ; +1 P, +2 N, +3 B, +4 R, +5 Q, +6 K = Blancs ; négatifs = Noirs).
// Une pièce se déplace sur 4 axes : x (colonne), y (rangée), t (temps, 1 pas = 1 coup complet = 2 demi-coups), l (timeline).
//   Tour : 1 axe · Fou : 2 axes à pas égaux · Dame : 1 à 4 axes à pas égaux (tour + fou + « licorne » + « dragon ») · Roi : 1 pas dans n'importe quelle direction (80) ·
//   Cavalier : 2 pas sur un axe + 1 pas sur un autre (saute) · Pion : avance d'1 en y OU en l (Blancs : +, Noirs : −) ; prend en diagonale (avant en y ou l + 1 pas en x ou t).
// Jouer un coup sur un plateau le prolonge d'un plateau. Si la pièce change de plateau : le plateau de départ avance (sans la pièce) ET le plateau d'arrivée avance (avec la pièce) ;
// si le plateau d'arrivée est dans le PASSÉ de sa timeline, une NOUVELLE TIMELINE naît de ce passé. Le « présent » = le plus ancien des derniers plateaux des timelines actives :
// on doit jouer sur chaque plateau du présent, puis valider. Un joueur ne peut créer une timeline que s'il en a créé au plus autant que l'adversaire ; une timeline est active si |L| ≤ min(nB, nN) + 1.
// Règles simplifiées par rapport au jeu original : ni roque, ni prise en passant, ni double pas de pion. Deux règles de victoire : « mat » (officielle : on ne peut pas valider un tour qui laisse un
// roi capturable) ou « roi capturable » (rapide : capturer un roi gagne).
(() => {
  const E = (window.ENOS = window.ENOS || {}), FD = (E.fived = {});
  const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6, SYM = ".PNBRQK", VAL = [0, 1, 3, 3, 5, 9, 0];
  FD.SYM = SYM; FD.VAL = VAL;
  const colorAt = (t) => (t % 2 === 0 ? "w" : "b"), other = (c) => (c === "w" ? "b" : "w");
  FD.colorAt = colorAt; FD.other = other;

  // ------------------------------------------------------------------ départs
  const ROW5 = [R, N, B, Q, K], ROW8 = [R, N, B, Q, K, B, N, R];
  FD.VARIANTS = { reduced: { W: 5, H: 5, row: ROW5, pawns: 5, name: "Petit 5×5" }, standard: { W: 8, H: 8, row: ROW8, pawns: 8, name: "Standard 8×8" } };

  function startBoard(v) {
    const { W, H, row } = FD.VARIANTS[v], b = new Int8Array(W * H);
    for (let x = 0; x < W; x++) { b[x] = row[x]; b[W + x] = P; b[(H - 1) * W + x] = -row[x]; b[(H - 2) * W + x] = -P; }
    return b;
  }

  function mkState(W, H, rules) {
    return { W, H, tl: {}, nW: 0, nB: 0, turn: "w", turnNo: 1, turnMoves: [], stack: [], over: null, rules: Object.assign({ win: "mate" }, rules || {}), log: [] };
  }

  FD.newGame = (variant, rules) => {
    const v = FD.VARIANTS[variant] || FD.VARIANTS.reduced, S = mkState(v.W, v.H, rules);
    S.variant = variant in FD.VARIANTS ? variant : "reduced";
    S.tl[0] = { t0: 0, list: [startBoard(S.variant)], origin: null, by: null };
    return S;
  };

  /** position personnalisée (tutoriel, tests) : {W,H,turn,nW,nB,tl:{L:{t0,by,origin,boards:[[lignes du haut vers le bas]…]}}} ; majuscule = Blancs, minuscule = Noirs, « . » = vide. */
  FD.fromSetup = (cfg, rules) => {
    const S = mkState(cfg.W, cfg.H, rules); S.turn = cfg.turn || "w"; S.nW = cfg.nW || 0; S.nB = cfg.nB || 0; S.variant = cfg.variant || "reduced";
    for (const l of Object.keys(cfg.tl)) {
      const d = cfg.tl[l];
      S.tl[l] = { t0: d.t0, by: d.by || null, origin: d.origin || null, list: d.boards.map((rows) => parse(rows, cfg.W, cfg.H)) };
    }
    return S;
  };
  function parse(rows, W, H) {
    const b = new Int8Array(W * H);
    rows.forEach((line, i) => { const y = H - 1 - i; for (let x = 0; x < W; x++) { const ch = line[x] || "."; if (ch === ".") continue; const k = SYM.indexOf(ch.toUpperCase()); b[y * W + x] = (ch === ch.toUpperCase() ? 1 : -1) * k; } });
    return b;
  }
  FD.boardRows = (b, W, H) => { const rows = []; for (let y = H - 1; y >= 0; y--) { let s = ""; for (let x = 0; x < W; x++) { const v = b[y * W + x]; s += v === 0 ? "." : v > 0 ? SYM[v] : SYM[-v].toLowerCase(); } rows.push(s); } return rows; };

  // ------------------------------------------------------------------ accès
  const lt = (S, l) => S.tl[l], latest = (S, l) => S.tl[l].t0 + S.tl[l].list.length - 1;
  FD.latest = latest;
  const boardAt = (S, l, t) => { const d = S.tl[l]; if (!d) return null; const i = t - d.t0; return i >= 0 && i < d.list.length ? d.list[i] : null; };
  FD.boardAt = boardAt;
  FD.lines = (S) => Object.keys(S.tl).map(Number).sort((a, b) => b - a);                                  // du haut (Blancs) vers le bas (Noirs)
  const isActive = (S, l) => S.tl[l] != null && Math.abs(l) <= Math.min(S.nW, S.nB) + 1;
  FD.isActive = isActive;
  FD.canCreate = (S, color) => (color === "w" ? S.nW <= S.nB : S.nB <= S.nW);
  /** présent = plus ancien dernier plateau des timelines actives */
  FD.present = (S) => { let m = Infinity; for (const l of Object.keys(S.tl)) { if (isActive(S, +l)) m = Math.min(m, latest(S, +l)); } return m; };
  /** timelines (actives) où le joueur `color` peut jouer : dernier plateau au présent et au trait de `color` */
  FD.movable = (S, color) => { const p = FD.present(S); if (colorAt(p) !== color) return []; return FD.lines(S).filter((l) => isActive(S, l) && latest(S, l) === p); };
  FD.canSubmit = (S) => S.turnMoves.length > 0 && colorAt(FD.present(S)) === other(S.turn);

  // ------------------------------------------------------------------ directions
  const AX = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  const DIRS = { 1: [], 2: [], 3: [], 4: [], all: [] };
  (function () {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (let d = -1; d <= 1; d++) {
      const n = (a ? 1 : 0) + (b ? 1 : 0) + (c ? 1 : 0) + (d ? 1 : 0); if (!n) continue;
      DIRS[n].push([a, b, c, d]); DIRS.all.push([a, b, c, d]);
    }
  })();
  const KN = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (i !== j) for (const si of [-2, 2]) for (const sj of [-1, 1]) { const v = [0, 0, 0, 0]; v[i] = si; v[j] = sj; KN.push(v); }

  // ------------------------------------------------------------------ coups
  /** cibles d'une pièce : [{l,t,x,y,cap,branch,jump,promo}]. Un rayon s'arrête sur un plateau absent, une pièce alliée ou la première prise ; une case interdite
   *  (timeline inactive, limite de création, roi non capturable) est ignorée SANS couper le rayon, sauf si elle est occupée. */
  FD.targets = (S, l, t, x, y, opt) => {
    const W = S.W, H = S.H, b0 = boardAt(S, l, t); if (!b0) return [];
    const pc = b0[y * W + x]; if (!pc) return [];
    const col = pc > 0 ? "w" : "b", kind = Math.abs(pc), out = [], kingOk = S.rules.win === "king" || !!(opt && opt.kingCap), can = FD.canCreate(S, col);
    // état d'une case : null = hors du multivers ; sinon {v : contenu, ok : peut-on s'y poser ?, c : la cible}
    const probe = (dx, dy, dt, dl) => {
      const x2 = x + dx, y2 = y + dy, t2 = t + 2 * dt, l2 = l + dl;
      if (x2 < 0 || y2 < 0 || x2 >= W || y2 >= H) return null;
      const bd = boardAt(S, l2, t2); if (!bd) return null;
      const v = bd[y2 * W + x2], same = l2 === l && t2 === t, branch = !same && t2 !== latest(S, l2);
      let ok = isActive(S, l2);
      if (v !== 0 && (v > 0) === (pc > 0)) ok = false;
      if (v !== 0 && Math.abs(v) === K && !kingOk) ok = false;
      if (branch && !can) ok = false;
      return { v, ok, ally: v !== 0 && (v > 0) === (pc > 0), c: { l: l2, t: t2, x: x2, y: y2, cap: v !== 0 ? Math.abs(v) : 0, branch, jump: !same, promo: false } };
    };
    const slide = (dirs) => {
      for (const d of dirs) for (let k = 1; k < 64; k++) {
        const r = probe(d[0] * k, d[1] * k, d[2] * k, d[3] * k);
        if (!r || r.ally) break;
        if (r.ok) out.push(r.c);
        if (r.v !== 0) break;                                                                                  // une pièce ennemie (capturable ou non) arrête le rayon
      }
    };
    if (kind === R) slide(DIRS[1]);
    else if (kind === B) slide(DIRS[2]);
    else if (kind === Q) slide(DIRS.all);
    else if (kind === K) { for (const d of DIRS.all) { const r = probe(d[0], d[1], d[2], d[3]); if (r && r.ok) out.push(r.c); } }
    else if (kind === N) { for (const v of KN) { const r = probe(v[0], v[1], v[2], v[3]); if (r && r.ok) out.push(r.c); } }
    else if (kind === P) {
      const f = col === "w" ? 1 : -1;
      for (const m of [[0, f, 0, 0], [0, 0, 0, f]]) { const r = probe(m[0], m[1], m[2], m[3]); if (r && r.ok && r.v === 0) out.push(r.c); }
      for (const m of [[1, f, 0, 0], [-1, f, 0, 0], [0, f, 1, 0], [0, f, -1, 0], [1, 0, 0, f], [-1, 0, 0, f], [0, 0, 1, f], [0, 0, -1, f]]) { const r = probe(m[0], m[1], m[2], m[3]); if (r && r.ok && r.v !== 0) out.push(r.c); }
      for (const c of out) c.promo = (col === "w" && c.y === H - 1) || (col === "b" && c.y === 0);
    }
    return out;
  };

  /** coups d'un seul plateau jouable (timeline l) */
  FD.movesOn = (S, color, l, opt) => {
    const res = [], t = latest(S, l), b = boardAt(S, l, t);
    for (let y = 0; y < S.H; y++) for (let x = 0; x < S.W; x++) {
      const v = b[y * S.W + x]; if (!v || (v > 0) !== (color === "w")) continue;
      for (const c of FD.targets(S, l, t, x, y, opt)) res.push({ l, t, x, y, to: c, pc: Math.abs(v) });
    }
    return res;
  };
  /** tous les coups possibles d'un joueur (depuis les plateaux jouables du présent) : [{l,t,x,y,to:{…}}] */
  FD.allMoves = (S, color, opt) => {
    const res = [];
    for (const l of FD.movable(S, color)) {
      const t = latest(S, l), b = boardAt(S, l, t);
      for (let y = 0; y < S.H; y++) for (let x = 0; x < S.W; x++) {
        const v = b[y * S.W + x]; if (!v || (v > 0) !== (color === "w")) continue;
        for (const c of FD.targets(S, l, t, x, y, opt)) res.push({ l, t, x, y, to: c, pc: Math.abs(v) });
      }
    }
    return res;
  };

  // ------------------------------------------------------------------ jouer un coup
  const snap = (S) => ({ tl: Object.fromEntries(Object.keys(S.tl).map((l) => [l, { t0: S.tl[l].t0, list: S.tl[l].list.slice(), origin: S.tl[l].origin, by: S.tl[l].by }])), nW: S.nW, nB: S.nB, turnMoves: S.turnMoves.slice(), over: S.over });
  const restore = (S, s) => { S.tl = s.tl; S.nW = s.nW; S.nB = s.nB; S.turnMoves = s.turnMoves; S.over = s.over; };
  FD.clone = (S) => { const c = Object.assign({}, S, { rules: Object.assign({}, S.rules), stack: [], turnMoves: S.turnMoves.slice(), log: [] }); const s = snap(S); c.tl = s.tl; return c; };

  /** applique un coup (déjà validé par FD.targets). promo : 2..5 (défaut dame). -> {ok, ev:{…}} ; ev décrit l'animation : plateaux créés, capture, nouvelle timeline. */
  FD.play = (S, mv, promo) => {
    if (S.over) return { ok: false, err: "Partie terminée." };
    const W = S.W, H = S.H, col = S.turn, b1 = boardAt(S, mv.l, mv.t);
    if (!b1 || mv.t !== latest(S, mv.l) || !FD.movable(S, col).includes(mv.l)) return { ok: false, err: "Ce plateau n'est pas jouable maintenant." };
    const pc = b1[mv.y * W + mv.x]; if (!pc || (pc > 0) !== (col === "w")) return { ok: false, err: "Ce n'est pas ta pièce." };
    const to = FD.targets(S, mv.l, mv.t, mv.x, mv.y).find((c) => c.l === mv.to.l && c.t === mv.to.t && c.x === mv.to.x && c.y === mv.to.y);
    if (!to) return { ok: false, err: "Coup impossible." };
    S.stack.push(snap(S));
    const same = to.l === mv.l && to.t === mv.t, ev = { from: { l: mv.l, t: mv.t, x: mv.x, y: mv.y }, to: { l: to.l, t: to.t, x: to.x, y: to.y }, piece: pc, cap: 0, boards: [], branch: null, color: col, time: to.t !== mv.t, jump: !same };
    let np = pc; if (to.promo) { const k = promo >= 2 && promo <= 5 ? promo : Q; np = (pc > 0 ? 1 : -1) * k; ev.promo = k; }
    const target = boardAt(S, to.l, to.t);
    ev.cap = Math.abs(target[to.y * W + to.x]);
    if (same) {
      const nb = new Int8Array(b1); nb[mv.y * W + mv.x] = 0; nb[to.y * W + to.x] = np; S.tl[mv.l].list.push(nb); ev.boards.push({ l: mv.l, t: mv.t + 1, role: "dest" });
    } else {
      const src = new Int8Array(b1); src[mv.y * W + mv.x] = 0; S.tl[mv.l].list.push(src); ev.boards.push({ l: mv.l, t: mv.t + 1, role: "src" });
      const nb = new Int8Array(target); nb[to.y * W + to.x] = np;
      if (to.t === latest(S, to.l)) { S.tl[to.l].list.push(nb); ev.boards.push({ l: to.l, t: to.t + 1, role: "dest" }); }
      else {
        const nl = col === "w" ? S.nW + 1 : -(S.nB + 1);
        if (col === "w") S.nW++; else S.nB++;
        S.tl[nl] = { t0: to.t + 1, list: [nb], origin: [to.l, to.t], by: col };
        ev.boards.push({ l: nl, t: to.t + 1, role: "dest" }); ev.branch = nl;
      }
    }
    S.turnMoves.push({ mv: { l: mv.l, t: mv.t, x: mv.x, y: mv.y, to: { l: to.l, t: to.t, x: to.x, y: to.y } }, ev });
    if (S.rules.win === "king" && ev.cap === K) { S.over = { winner: col, why: "Roi capturé", kind: "king" }; ev.kingCapture = true; }
    return { ok: true, ev };
  };
  FD.undo = (S) => { if (!S.stack.length) return false; restore(S, S.stack.pop()); return true; };

  // ------------------------------------------------------------------ échec
  /** coups de `by` qui capturent un roi adverse, joués depuis ses plateaux jouables (= le présent s'il est au trait de `by`) */
  FD.threats = (S, by) => {
    const res = [], opt = { kingCap: true }, W = S.W;
    for (const l of FD.movable(S, by)) {
      const t = latest(S, l), b = boardAt(S, l, t);
      for (let y = 0; y < S.H; y++) for (let x = 0; x < W; x++) {
        const v = b[y * W + x]; if (!v || (v > 0) !== (by === "w")) continue;
        for (const c of FD.targets(S, l, t, x, y, opt)) if (c.cap === K) res.push({ from: { l, t, x, y }, to: { l: c.l, t: c.t, x: c.x, y: c.y }, piece: Math.abs(v) });
      }
    }
    return res;
  };
  /** menaces contre `me` si le tour passait : on suppose un coup « passer » sur chaque plateau du présent de `me` (utile pour afficher ÉCHEC au début du tour) */
  FD.checkNow = (S, me) => {
    const c = FD.clone(S), mv = FD.movable(c, me);
    if (!mv.length) return FD.threats(c, other(me));
    for (const l of mv) c.tl[l].list.push(new Int8Array(c.tl[l].list[c.tl[l].list.length - 1]));
    return FD.threats(c, other(me));
  };
  /** valider le tour : présent chez l'adversaire + aucun roi capturable (règle du mat). -> {ok, err?, threats?} */
  FD.submit = (S) => {
    if (S.over) return { ok: false, err: "Partie terminée." };
    if (!S.turnMoves.length) return { ok: false, err: "Joue d'abord un coup." };
    if (colorAt(FD.present(S)) !== other(S.turn)) return { ok: false, err: "Il reste des plateaux du présent à jouer." };
    const me = S.turn, opp = other(me);
    if (S.rules.win !== "king") { const th = FD.threats(S, opp); if (th.length) return { ok: false, err: "Ton roi serait capturable : tu es en échec.", threats: th }; }
    S.log.push({ no: S.turnNo, by: me, moves: S.turnMoves.map((m) => m.mv) });
    S.turn = opp; if (opp === "w") S.turnNo++; S.turnMoves = []; S.stack = [];
    const res = { ok: true, status: null };
    if (S.rules.win !== "king") {
      const chk = FD.checkNow(S, opp).length > 0, has = FD.hasLegalTurn(S, 25000);
      res.check = chk;
      if (has === false) { S.over = chk ? { winner: me, why: "Échec et mat", kind: "mate" } : { winner: null, why: "Pat : aucun coup légal", kind: "stalemate" }; res.status = S.over.kind; }
    } else if (!FD.allMoves(S, opp, { kingCap: true }).length) { S.over = { winner: null, why: "Plus aucun coup", kind: "stalemate" }; res.status = "stalemate"; }
    return res;
  };

  /** existe-t-il un tour complet légal pour le joueur au trait ? true / false / null (budget dépassé : inconnu). Recherche en profondeur avec budget de nœuds. */
  FD.hasLegalTurn = (S, budget) => {
    let nodes = 0, cut = false;
    const dfs = (st) => {
      if (FD.canSubmit(st) && (st.rules.win === "king" || !FD.threats(st, other(st.turn)).length)) return true;
      const col = st.turn;
      for (const m of FD.allMoves(st, col)) {
        if (++nodes > budget) { cut = true; return false; }
        const c = FD.clone(st); c.stack = []; const r = FD.play(c, m, Q); if (!r.ok) continue;
        if (dfs(c)) return true;
        if (cut) return false;
      }
      return false;
    };
    const root = FD.clone(S); root.turnMoves = S.turnMoves.slice();
    const found = dfs(root);
    return found ? true : cut ? null : false;
  };

  // ------------------------------------------------------------------ évaluation et IA
  FD.evalState = (S, me) => {
    let s = 0;
    for (const l of Object.keys(S.tl)) {
      if (!isActive(S, +l)) continue;
      const b = S.tl[l].list[S.tl[l].list.length - 1];
      for (let i = 0; i < b.length; i++) { const v = b[i]; if (!v) continue; const x = i % S.W, y = (i / S.W) | 0, cen = 0.04 * (2 - Math.abs(x - (S.W - 1) / 2) - Math.abs(y - (S.H - 1) / 2) / 2); s += (v > 0 ? 1 : -1) * (VAL[Math.abs(v)] + cen); }
    }
    return me === "w" ? s : -s;
  };
  const rnd = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  /** choisit un tour complet pour le joueur au trait : [{l,t,x,y,to,promo}] ; level 1..3 ; budget en ms (recherche à faisceau). */
  FD.aiTurn = (S0, o) => {
    o = o || {}; const level = o.level || 2, me = S0.turn, opp = other(me), t0 = Date.now(), limit = o.ms || (level === 1 ? 150 : level === 2 ? 450 : 900), R = rnd(o.seed || (Date.now() & 0xffff) + 1);
    const beam = level === 1 ? 4 : level === 2 ? 6 : 9;
    const cands = [];
    const order = (st, ms) => ms.map((m) => ({ m, k: (m.to.cap ? VAL[m.to.cap] * 3 + 3 : 0) + (m.to.jump ? 0.1 : 0) - (m.to.branch ? (level >= 3 ? 0.1 : 0.9) : 0) + (m.to.promo ? 8 : 0) + R() * (level === 1 ? 6 : 1.6) - (m.pc === K ? 0.7 : 0) })).sort((a, b) => b.k - a.k).map((x) => x.m);
    const hard = limit * 3;
    const dfs = (st, seq, depth) => {
      if (Date.now() - t0 > limit && cands.length) return;
      if (Date.now() - t0 > hard) return;
      if (FD.canSubmit(st)) {
        if (st.rules.win !== "king" && FD.threats(st, opp).length) return;
        cands.push({ seq, st }); return;
      }
      const mvb = FD.movable(st, me);
      const ms = order(st, mvb.length ? FD.movesOn(st, me, mvb[0]) : []).slice(0, depth === 0 ? beam * 2 : beam);        // un plateau du présent à la fois (l'ordre des plateaux n'a pas d'importance pour l'IA)
      for (const m of ms) {
        if (Date.now() - t0 > limit && cands.length) return;
        const c = FD.clone(st); c.stack = []; const r = FD.play(c, m, Q); if (!r.ok) continue;
        dfs(c, seq.concat([{ l: m.l, t: m.t, x: m.x, y: m.y, to: m.to, promo: m.to.promo ? Q : 0 }]), depth + 1);
      }
    };
    dfs(FD.clone(S0), [], 0);
    if (!cands.length) {                                                                                      // repli : n'importe quel tour légal (recherche exhaustive limitée)
      const found = (function rec(st, seq, n) {
        if (n.v++ > 40000) return null;
        if (FD.canSubmit(st) && (st.rules.win === "king" || !FD.threats(st, opp).length)) return seq;
        const mvb = FD.movable(st, me); if (!mvb.length) return null;
        for (const m of FD.movesOn(st, me, mvb[0])) { const c = FD.clone(st); c.stack = []; if (!FD.play(c, m, Q).ok) continue; const r = rec(c, seq.concat([{ l: m.l, t: m.t, x: m.x, y: m.y, to: m.to, promo: m.to.promo ? Q : 0 }]), n); if (r) return r; }
        return null;
      })(FD.clone(S0), [], { v: 0 });
      return found;
    }
    for (const c of cands) {                                                                                    // note : matériel + bonus d'échec - meilleure prise adverse au coup suivant
      let sc = FD.evalState(c.st, me), th = 0;
      if (c.st.rules.win === "king" && c.seq.some((m) => m.to.cap === K)) sc += 1000;
      if (level >= 2) {
        const cc = FD.clone(c.st); cc.turn = opp; if (cc.turnMoves.length) cc.turnMoves = [];
        const reply = []; for (const l of FD.movable(cc, opp).slice(0, 3)) for (const m of FD.movesOn(cc, opp, l, { kingCap: true })) reply.push(m); let best = 0; for (const m of reply) { const g = m.to.cap === K ? 50 : VAL[m.to.cap]; if (g > best) best = g; }
        th = best; sc -= best * (level === 3 ? 1.0 : 0.7);
        if (c.st.rules.win !== "king") { const chk = FD.checkNow(c.st, opp).length; if (chk) sc += level === 3 ? 2.5 : 1.2; }
      }
      c.score = sc + R() * (level === 1 ? 3 : level === 2 ? 0.5 : 0.15) - c.seq.filter((m) => m.to.branch).length * (level >= 3 ? 0.1 : 0.6);
    }
    cands.sort((a, b) => b.score - a.score);
    return cands[0].seq;
  };

  // ------------------------------------------------------------------ sauvegarde
  FD.serialize = (S) => JSON.stringify({ W: S.W, H: S.H, variant: S.variant, turn: S.turn, turnNo: S.turnNo, nW: S.nW, nB: S.nB, rules: S.rules, over: S.over, log: S.log.slice(-200),
    tl: Object.fromEntries(Object.keys(S.tl).map((l) => [l, { t0: S.tl[l].t0, by: S.tl[l].by, origin: S.tl[l].origin, list: S.tl[l].list.map((b) => Array.from(b)) }])) });
  FD.deserialize = (txt) => {
    const o = JSON.parse(txt), S = mkState(o.W, o.H, o.rules); S.variant = o.variant; S.turn = o.turn; S.turnNo = o.turnNo; S.nW = o.nW; S.nB = o.nB; S.over = o.over; S.log = o.log || [];
    for (const l of Object.keys(o.tl)) S.tl[l] = { t0: o.tl[l].t0, by: o.tl[l].by, origin: o.tl[l].origin, list: o.tl[l].list.map((a) => Int8Array.from(a)) };
    return S;
  };
  if (typeof module !== "undefined") module.exports = FD;
})();
