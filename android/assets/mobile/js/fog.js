"use strict";
// CHESS FOG (échecs « brouillard de guerre ») — MOTEUR + ADVERSAIRE HONNÊTE.
// Règles : on ne voit que ses pièces et les cases où elles peuvent aller (ou qu'elles attaquent) ; le reste est dans le brouillard. Pas d'échec ni d'échec et mat : on peut laisser son roi en prise,
// CAPTURER LE ROI ADVERSE GAGNE. Roque autorisé (cases libres, sans condition d'échec), promotion, pas de prise en passant. Nulle si 100 demi-coups sans prise ni coup de pion, ou plus aucun coup.
// Vision d'une pièce : cavalier / roi : leurs cases d'arrivée ; pion : la case devant (même occupée), 2 cases si départ libre, les 2 diagonales ; tour / fou / dame : chaque rayon jusqu'à la 1ʳᵉ pièce INCLUSE.
// Conséquence utile : les coups légaux d'un joueur ne dépendent QUE de ce qu'il voit.
// L'ADVERSAIRE (FogBot) ne reçoit jamais le vrai plateau : seulement une « vue » (FG.view) où les cases cachées valent 99. Il garde une croyance sous forme de particules (mondes plausibles) qu'il met
// à jour à chaque coup adverse en ne gardant que les mondes compatibles avec ce qu'il voit, puis choisit son coup en moyenne sur ces mondes. Test anti-triche : t_fog_engine.js.
(() => {
  const E = (window.ENOS = window.ENOS || {}), FG = (E.fog = {});
  const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6, FOG = 99, VAL = [0, 1, 3, 3.2, 5, 9, 0], SYM = ".PNBRQK";
  FG.FOG = FOG; FG.SYM = SYM; FG.VAL = VAL;
  const other = (c) => (c === "w" ? "b" : "w"), sgn = (c) => (c === "w" ? 1 : -1);
  FG.other = other;
  const KN = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]], KG = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const RD = [[1, 0], [0, 1], [-1, 0], [0, -1]], BD = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  const sq = (x, y) => y * 8 + x, inb = (x, y) => x >= 0 && y >= 0 && x < 8 && y < 8;
  FG.name = (i) => "abcdefgh"[i & 7] + ((i >> 3) + 1);
  const CA = { wK: 1, wQ: 2, bK: 4, bQ: 8 };

  // ------------------------------------------------------------------ position
  FG.startBoard = () => {
    const b = new Int8Array(64), row = [R, N, B, Q, K, B, N, R];
    for (let x = 0; x < 8; x++) { b[x] = row[x]; b[8 + x] = P; b[48 + x] = -P; b[56 + x] = -row[x]; }
    return b;
  };
  FG.newGame = () => ({ b: FG.startBoard(), turn: "w", castle: 15, ply: 0, quiet: 0, over: null, last: null, log: [] });
  FG.clone = (S) => Object.assign({}, S, { b: new Int8Array(S.b), log: S.log.slice() });

  // ------------------------------------------------------------------ génération (sur un simple tableau : une vue à cases inconnues = 0 donne les mêmes coups que le vrai plateau)
  /** coups pseudo-légaux de `color` : [{f,t,pc,cap,promo,castle}] ; castle = bits de droits */
  FG.gen = (b, color, castle) => {
    const out = [], s = sgn(color), home = color === "w" ? 0 : 7, last = color === "w" ? 7 : 0;
    const add = (f, t, pc, extra) => { const m = { f, t, pc, cap: Math.abs(b[t]) }; if (extra) Object.assign(m, extra); out.push(m); };
    for (let f = 0; f < 64; f++) {
      const v = b[f]; if (!v || (v > 0) !== (s > 0)) continue; const k = Math.abs(v), x = f & 7, y = f >> 3;
      if (k === P) {
        const y1 = y + s;
        if (inb(x, y1) && b[sq(x, y1)] === 0) {
          if (y1 === last) for (const pr of [Q, R, B, N]) add(f, sq(x, y1), k, { promo: pr }); else add(f, sq(x, y1), k);
          const start = color === "w" ? 1 : 6; if (y === start && b[sq(x, y + 2 * s)] === 0) add(f, sq(x, y + 2 * s), k);
        }
        for (const dx of [-1, 1]) { const xx = x + dx; if (!inb(xx, y1)) continue; const t = sq(xx, y1), w = b[t]; if (w && (w > 0) !== (s > 0)) { if (y1 === last) for (const pr of [Q, R, B, N]) add(f, t, k, { promo: pr }); else add(f, t, k); } }
      } else if (k === N || k === K) {
        for (const d of (k === N ? KN : KG)) { const xx = x + d[0], yy = y + d[1]; if (!inb(xx, yy)) continue; const t = sq(xx, yy), w = b[t]; if (w && (w > 0) === (s > 0)) continue; add(f, t, k); }
        if (k === K && y === home && x === 4) {
          const ks = color === "w" ? CA.wK : CA.bK, qs = color === "w" ? CA.wQ : CA.bQ;
          if ((castle & ks) && b[sq(5, home)] === 0 && b[sq(6, home)] === 0 && b[sq(7, home)] === s * R) add(f, sq(6, home), k, { castle: 1 });
          if ((castle & qs) && b[sq(3, home)] === 0 && b[sq(2, home)] === 0 && b[sq(1, home)] === 0 && b[sq(0, home)] === s * R) add(f, sq(2, home), k, { castle: 2 });
        }
      } else {
        for (const d of (k === R ? RD : k === B ? BD : RD.concat(BD))) {
          let xx = x + d[0], yy = y + d[1];
          while (inb(xx, yy)) { const t = sq(xx, yy), w = b[t]; if (w) { if ((w > 0) !== (s > 0)) add(f, t, k); break; } add(f, t, k); xx += d[0]; yy += d[1]; }
        }
      }
    }
    return out;
  };
  /** applique le coup sur le tableau (copie conseillée avant) ; retourne le code de la pièce capturée */
  FG.apply = (b, m, color) => {
    const cap = b[m.t], s = sgn(color); b[m.t] = m.promo ? s * m.promo : b[m.f]; b[m.f] = 0;
    if (m.castle) { const home = color === "w" ? 0 : 7; if (m.castle === 1) { b[sq(5, home)] = b[sq(7, home)]; b[sq(7, home)] = 0; } else { b[sq(3, home)] = b[sq(0, home)]; b[sq(0, home)] = 0; } }
    return cap;
  };
  const castleAfter = (castle, m) => { for (const i of [m.f, m.t]) { if (i === 0) castle &= ~CA.wQ; if (i === 7) castle &= ~CA.wK; if (i === 4) castle &= ~(CA.wK | CA.wQ); if (i === 56) castle &= ~CA.bQ; if (i === 63) castle &= ~CA.bK; if (i === 60) castle &= ~(CA.bK | CA.bQ); } return castle; };
  FG.castleAfter = castleAfter;

  /** joue un coup dans la partie (vérifié) -> {ok, cap, over} */
  FG.play = (S, m) => {
    if (S.over) return { ok: false, err: "Partie terminée." };
    const ms = FG.gen(S.b, S.turn, S.castle), mm = ms.find((q) => q.f === m.f && q.t === m.t && (q.promo || 0) === (m.promo || 0)); if (!mm) return { ok: false, err: "Coup impossible." };
    const color = S.turn, cap = FG.apply(S.b, mm, color), piece = Math.abs(S.b[mm.t]);
    S.castle = castleAfter(S.castle, mm); S.last = { f: mm.f, t: mm.t, by: color, piece, cap: Math.abs(cap), promo: mm.promo || 0, castle: mm.castle || 0 }; S.log.push(S.last);
    S.ply++; S.quiet = (cap || mm.pc === P) ? 0 : S.quiet + 1; S.turn = other(color);
    if (Math.abs(cap) === K) S.over = { winner: color, why: "Roi capturé" };
    else if (S.quiet >= 100) S.over = { winner: null, why: "Nulle : 50 coups sans prise ni coup de pion" };
    else if (!FG.gen(S.b, S.turn, S.castle).length) S.over = { winner: null, why: "Nulle : plus aucun coup" };
    return { ok: true, cap: Math.abs(cap), over: S.over, move: S.last };
  };

  // ------------------------------------------------------------------ vision
  /** cases visibles pour `color` : Uint8Array(64) */
  FG.visible = (b, color) => {
    const vis = new Uint8Array(64), s = sgn(color);
    for (let f = 0; f < 64; f++) {
      const v = b[f]; if (!v || (v > 0) !== (s > 0)) continue; vis[f] = 1; const k = Math.abs(v), x = f & 7, y = f >> 3;
      if (k === P) {
        const y1 = y + s; if (inb(x, y1)) { vis[sq(x, y1)] = 1; const start = color === "w" ? 1 : 6; if (y === start && b[sq(x, y1)] === 0 && inb(x, y + 2 * s)) vis[sq(x, y + 2 * s)] = 1; }
        for (const dx of [-1, 1]) if (inb(x + dx, y1)) vis[sq(x + dx, y1)] = 1;
      } else if (k === N || k === K) { for (const d of (k === N ? KN : KG)) if (inb(x + d[0], y + d[1])) vis[sq(x + d[0], y + d[1])] = 1; }
      else for (const d of (k === R ? RD : k === B ? BD : RD.concat(BD))) { let xx = x + d[0], yy = y + d[1]; while (inb(xx, yy)) { vis[sq(xx, yy)] = 1; if (b[sq(xx, yy)]) break; xx += d[0]; yy += d[1]; } }
    }
    return vis;
  };
  /** LA vue d'un joueur — tout ce qu'il a le droit de savoir. Cases cachées = 99. */
  FG.view = (S, color) => {
    const vis = FG.visible(S.b, color), cells = new Int8Array(64), taken = new Array(7).fill(0), lost = new Array(7).fill(0);
    for (let i = 0; i < 64; i++) cells[i] = vis[i] ? S.b[i] : FOG;
    for (const m of S.log) if (m.cap) { if (m.by === color) taken[m.cap]++; else lost[m.cap]++; }
    const e = S.last && S.last.by !== color ? S.last : null; let seen = null;
    if (e) { const toV = !!vis[e.t], frV = !!vis[e.f]; if (toV || frV) seen = { f: frV ? e.f : -1, t: toV ? e.t : -1, piece: toV ? e.piece : 0, cap: e.cap, castle: e.castle }; }
    const capOwn = e && e.cap ? { t: e.t, piece: e.piece, cap: e.cap } : null;                              // une prise de l'adversaire sur nos pièces est ANNONCÉE (case + type de la pièce qui prend)
    return { color, cells, capOwn, turn: S.turn, ply: S.ply, castle: S.castle & (color === "w" ? 3 : 12), quiet: S.quiet, taken, lost, seen, mine: S.last && S.last.by === color ? { f: S.last.f, t: S.last.t, cap: S.last.cap } : null, over: S.over ? { winner: S.over.winner, why: S.over.why } : null };
  };
  const popcount = (v) => { let n = 0; for (let i = 0; i < v.length; i++) n += v[i]; return n; };

  // ------------------------------------------------------------------ ADVERSAIRE : croyance par particules
  const rngMk = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const evalBoard = (b, color) => { let s = 0; for (let i = 0; i < 64; i++) { const v = b[i]; if (!v) continue; const x = i & 7, y = i >> 3, a = Math.abs(v); s += (v > 0 ? 1 : -1) * (a === K ? 1000 : VAL[a] + (a === P ? (v > 0 ? y : 7 - y) * 0.03 : 0) + 0.02 * (3.5 - Math.abs(x - 3.5))); } return color === "w" ? s : -s; };
  const INIT = [0, 8, 2, 2, 2, 1, 1];

  class FogBot {
    constructor(color, o) { o = o || {}; this.color = color; this.level = o.level || 2; this.R = rngMk(o.seed || 12345); this.n = this.level === 1 ? 8 : this.level === 2 ? 14 : 24; this.parts = null; this.lastSq = null; }
    /** un monde = {b, castle} ; au départ tous identiques (les deux camps connaissent la position initiale) */
    init() { const S = FG.newGame(); this.parts = Array.from({ length: this.n }, () => ({ b: new Int8Array(S.b), castle: S.castle })); this.started = true; }

    // monde compatible avec la vue ? (mêmes cases visibles, mêmes contenus)
    compat(w, view) {
      const vis = FG.visible(w.b, this.color); for (let i = 0; i < 64; i++) { const known = view.cells[i] !== FOG; if (!!vis[i] !== known) return false; if (known && w.b[i] !== view.cells[i]) return false; } return true;
    }
    /** met à jour la croyance après un coup adverse : on garde, pour chaque monde, un coup adverse compatible avec la vue */
    update(view) {
      if (!this.parts) this.init(); const enemy = other(this.color), next = []; let tries = 0;
      const pool = this.parts.slice();
      while (next.length < this.n && tries < this.n * 4) {
        const w = pool[(tries++) % pool.length], ms = FG.gen(w.b, enemy, w.castle); if (!ms.length) continue;
        const idx = ms.map((_, i) => i); for (let i = idx.length - 1; i > 0; i--) { const j = (this.R() * (i + 1)) | 0; [idx[i], idx[j]] = [idx[j], idx[i]]; }
        let tested = 0;
        for (const i of idx) {
          if (tested++ > 24) break; const m = ms[i], nb = new Int8Array(w.b); FG.apply(nb, m, enemy); const nw = { b: nb, castle: FG.castleAfter(w.castle, m) };
          if (this.compat(nw, view)) { next.push(nw); break; }
        }
      }
      this.parts = next.length ? next : this.regen(view);
    }
    /** aucun monde compatible : on en fabrique à partir de ce qu'on voit (+ pièces adverses restantes placées au hasard dans le brouillard) */
    regen(view) {
      const enemy = other(this.color), es = sgn(enemy), want = INIT.slice(); for (let k = 1; k <= 6; k++) want[k] = Math.max(0, INIT[k] - view.taken[k]);
      const seenCnt = new Array(7).fill(0), hidden = []; for (let i = 0; i < 64; i++) { const v = view.cells[i]; if (v === FOG) hidden.push(i); else if (v && (v > 0) === (es > 0)) seenCnt[Math.abs(v)]++; }
      const rest = []; for (let k = 6; k >= 1; k--) for (let c = Math.max(0, want[k] - seenCnt[k]); c > 0; c--) rest.push(k);
      const out = [];
      for (let w = 0; w < this.n; w++) {
        const b = new Int8Array(64); for (let i = 0; i < 64; i++) b[i] = view.cells[i] === FOG ? 0 : view.cells[i];
        const free = hidden.slice(); for (let i = free.length - 1; i > 0; i--) { const j = (this.R() * (i + 1)) | 0; [free[i], free[j]] = [free[j], free[i]]; }
        let u = 0; for (const k of rest) { let tries = 0, pos = -1; while (u < free.length && tries++ < free.length) { const p = free[u % free.length]; if (k === P && ((p >> 3) === 0 || (p >> 3) === 7)) { u++; continue; } pos = p; u++; break; } if (pos >= 0) b[pos] = es * k; }
        let castle = view.castle; const home = enemy === "w" ? 0 : 7;
        if (b[sq(4, home)] === es * K) { if (b[sq(7, home)] === es * R) castle |= enemy === "w" ? CA.wK : CA.bK; if (b[sq(0, home)] === es * R) castle |= enemy === "w" ? CA.wQ : CA.bQ; }
        out.push({ b, castle });
      }
      return out;
    }
    /** choisit un coup depuis la vue seule */
    move(view, ms) {
      if (!this.parts) this.init(); const me = this.color, enemy = other(me), t0 = Date.now(), budget = this.level === 1 ? 120 : this.level === 2 ? 500 : 1000;
      if (!this.updated || this.updated !== view.ply) { if (view.ply > 0 && !this.skip) this.update(view); this.updated = view.ply; }
      // coups légaux : à partir de la vue seulement (cases cachées = vides : sans effet sur les coups du joueur)
      const flat = new Int8Array(64); for (let i = 0; i < 64; i++) flat[i] = view.cells[i] === FOG ? 0 : view.cells[i];
      const moves = FG.gen(flat, me, view.castle); if (!moves.length) return null;
      const scored = [];
      for (const m of moves) {
        if (Date.now() - t0 > budget * 2 && scored.length) break;
        let tot = 0, worst = 1e9, n = 0;
        for (const w of this.parts) {
          const nb = new Int8Array(w.b); const cap = FG.apply(nb, m, me); let sc = evalBoard(nb, me);
          if (Math.abs(cap) === K) { sc = 5000; }
          else if (this.level >= 2) {
            const replies = FG.gen(nb, enemy, w.castle); let bestOpp = sc;
            const lim = this.level === 3 ? 40 : 60, cand = replies.length > lim ? replies.filter((r) => r.cap).concat(replies.filter((r) => !r.cap).slice(0, lim)) : replies;
            const base = evalBoard(nb, me);
            for (const r of cand) {
              if (r.cap === K) { bestOpp = -5000; break; } if (!r.cap) continue;
              let ev = base - (VAL[Math.abs(nb[r.t])] || 0);                                                          // l'adversaire prend une de nos pièces
              if (this.level === 3) { const nb2 = new Int8Array(nb); FG.apply(nb2, r, enemy); let g = 0; for (const q of FG.gen(nb2, me, w.castle)) { if (q.t === r.t) { const gain = q.cap === K ? 50 : VAL[q.cap]; if (gain > g) g = gain; } } ev += g * 0.85; }   // … mais on peut reprendre
              if (ev < bestOpp) bestOpp = ev;
            }
            sc = bestOpp;
          }
          tot += sc; worst = Math.min(worst, sc); n++;
        }
        const nbv = new Int8Array(flat); FG.apply(nbv, m, me); const info = (popcount(FG.visible(nbv, me)) - popcount(FG.visible(flat, me))) * 0.04;
        scored.push({ m, s: (this.level === 3 ? 0.6 * tot / n + 0.4 * worst : tot / n) + info + this.R() * (this.level === 1 ? 1.2 : 0.12), });
      }
      scored.sort((a, b) => b.s - a.s); const best = scored[0].m;
      // le monde continue : on applique NOTRE coup à chaque particule (les mondes restent « avant le coup adverse suivant »)
      for (const w of this.parts) { FG.apply(w.b, best, me); w.castle = FG.castleAfter(w.castle, best); }
      this.updated = view.ply + 1;
      return best;
    }
  }
  FG.Bot = FogBot;
  if (typeof module !== "undefined") module.exports = FG;
})();
