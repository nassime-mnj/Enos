"use strict";
// ÉCHECS ×4 « BATTLE ROYALE » — moteur de règles (aucune dépendance : tourne dans le navigateur ET sous Node pour les tests).
//
// Plateau en croix 14×14 (coins 3×3 retirés = 160 cases), 4 armées de 16 pièces face à face :
//     joueur 0 = BAS (monte)    joueur 1 = GAUCHE (va vers la droite)    joueur 2 = HAUT (descend)    joueur 3 = DROITE (va vers la gauche)
// Ordre de jeu : sens horaire 0 → 1 → 2 → 3. Coordonnées (x, y) avec y = 0 en haut de l'écran.
// Règles de cette variante (« chacun pour soi », comme sur le vrai plateau 4Chess) :
//   - pièces et déplacements des échecs ; PAS de roque, PAS de prise en passant ;
//   - ÉCHEC ET MAT : un coup qui laisserait son propre roi attaqué (par un adversaire, pas par un allié) est illégal ; un roi ne se capture jamais ;
//     un joueur dont c'est le tour, sans coup légal et en échec, est maté ; sans coup légal et pas en échec (pat), il est éliminé aussi ;
//   - ÉLIMINÉ = ses pièces restent sur le plateau mais GRISÉES et INERTES (elles bloquent le jeu, n'attaquent plus, se capturent pour 0 point) ;
//   - pion : double pas depuis sa ligne de départ, prise en diagonale « devant », promotion en dame après 8 pas ;
//   - ALLIANCES : deux alliés ne peuvent pas se capturer (leurs pièces se bloquent) et ne se mettent pas en échec ; la partie se termine quand il ne reste qu'une équipe ;
//   - TEMPÊTE (option) : à intervalles réguliers le bord du plateau s'effondre ; les pièces qui s'y trouvent sont détruites (un roi détruit = joueur éliminé) ;
//   - points : pion 1, cavalier 3, fou 3, tour 5, dame 9 ; échec et mat +15 pour celui qui le donne ; à la limite de coups le meilleur total gagne.
(() => {
  const C4 = {};
  const N = 14, SQ = N * N;
  const P = 1, KN = 2, B = 3, R = 4, Q = 5, K = 6;                                 // types
  const LETTER = ["", "p", "n", "b", "r", "q", "k"];
  const VALUE = [0, 1, 3, 3, 5, 9, 15];                                            // points de capture
  const MATV = [0, 100, 300, 320, 500, 900, 0];                                    // valeur d'évaluation (centipions) ; le roi est géré à part
  const FWD = [[0, -1], [1, 0], [0, 1], [-1, 0]];                                  // sens d'avance des pions de chaque joueur
  const NAMES = ["Bas", "Gauche", "Haut", "Droite"];
  const VALID = new Uint8Array(SQ);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) VALID[y * N + x] = (x < 3 || x > 10) && (y < 3 || y > 10) ? 0 : 1;
  const XY = (s) => [s % N, (s / N) | 0];
  const SQI = (x, y) => y * N + x;
  const cell = (owner, type) => (owner + 1) * 8 + type;                             // 0 = vide
  const DEAD = 4;                                                                  // propriétaire des pièces des joueurs éliminés (grisées, inertes)
  const ownerOf = (v) => (v >> 3) - 1;
  const typeOf = (v) => v & 7;
  const KDIR = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const NDIR = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  const BDIR = KDIR.slice(4), RDIR = KDIR.slice(0, 4);
  Object.assign(C4, { DEAD, N, SQ, P, KN, B, R, Q, K, LETTER, VALUE, MATV, FWD, NAMES, VALID, XY, SQI, cell, ownerOf, typeOf });

  // ligne de départ des pions / ligne de promotion de chaque joueur
  const pawnStart = (o, x, y) => (o === 0 ? y === 12 : o === 1 ? x === 1 : o === 2 ? y === 1 : x === 12);
  const promoRow = (o, x, y) => (o === 0 ? y <= 4 : o === 1 ? x >= 9 : o === 2 ? y >= 9 : x <= 4);

  /** Position de départ. teams : tableau de 4 numéros d'équipe (alliés = même numéro), par défaut chacun pour soi. */
  C4.newGame = (opts) => {
    opts = opts || {};
    const b = new Int8Array(SQ);
    const back = [R, KN, B, Q, K, B, KN, R];                                         // de gauche à droite VU DU JOUEUR
    for (let i = 0; i < 8; i++) {
      b[SQI(3 + i, 13)] = cell(0, back[i]); b[SQI(3 + i, 12)] = cell(0, P);              // bas
      b[SQI(0, 3 + i)] = cell(1, back[i]); b[SQI(1, 3 + i)] = cell(1, P);                // gauche (regarde vers la droite : sa gauche = le haut de l'écran)
      b[SQI(10 - i, 0)] = cell(2, back[i]); b[SQI(10 - i, 1)] = cell(2, P);              // haut
      b[SQI(13, 10 - i)] = cell(3, back[i]); b[SQI(12, 10 - i)] = cell(3, P);            // droite
    }
    const teams = (opts.teams || [0, 1, 2, 3]).slice();
    return { b, turn: 0, alive: [true, true, true, true], out: [], pts: [0, 0, 0, 0], ply: 0, level: 0, teams, last: null, captured: [[], [], [], []],
      storm: opts.storm || null /* {first, every} */, log: [] };
  };
  C4.clone = (s) => ({ ...s, b: s.b.slice(), alive: s.alive.slice(), out: s.out.slice(), pts: s.pts.slice(), teams: s.teams.slice(), captured: s.captured.map((a) => a.slice()), log: [] });
  C4.allied = (s, a, b2) => a === b2 || s.teams[a] === s.teams[b2];
  const playable = (s, x, y) => x >= s.level && x <= N - 1 - s.level && y >= s.level && y <= N - 1 - s.level && VALID[y * N + x] === 1;
  C4.playable = playable;

  // ------------------------------------------------------------------ génération des coups (pseudo-légaux : pas de notion d'échec)
  // coup = from | (to << 8) | (promotion << 16)
  const mv = (f, t, pr) => f | (t << 8) | (pr ? 1 << 16 : 0);
  C4.from = (m) => m & 255; C4.to = (m) => (m >> 8) & 255; C4.isPromo = (m) => (m >> 16) & 1;

  /** Appelle cb(from, to, promo) pour chaque coup pseudo-légal de `o`. capturesOnly : seulement les prises. */
  function gen(s, o, cb, capturesOnly) {
    const b = s.b;
    for (let f = 0; f < SQ; f++) {
      const v = b[f];
      if (!v || ownerOf(v) !== o) continue;
      const t = typeOf(v), x = f % N, y = (f / N) | 0;
      const tryTo = (nx, ny) => {                                                    // true : on peut continuer à glisser
        if (!playable(s, nx, ny)) return false;
        const d = nx + ny * N, tv = b[d];
        if (!tv) { if (!capturesOnly) cb(f, d, 0); return true; }
        if (!C4.allied(s, o, ownerOf(tv)) && !(typeOf(tv) === K && ownerOf(tv) !== DEAD)) cb(f, d, 0);          // un roi vivant ne se capture pas : il se mate
        return false;
      };
      if (t === P) {
        const [fx, fy] = FWD[o], px = -fy, py = fx;
        const nx = x + fx, ny = y + fy;
        if (!capturesOnly && playable(s, nx, ny) && !b[nx + ny * N]) {
          cb(f, nx + ny * N, promoRow(o, nx, ny) ? 1 : 0);
          const n2x = nx + fx, n2y = ny + fy;
          if (pawnStart(o, x, y) && playable(s, n2x, n2y) && !b[n2x + n2y * N]) cb(f, n2x + n2y * N, 0);
        }
        for (const sg of [1, -1]) {
          const cx = nx + px * sg, cy = ny + py * sg;
          if (!playable(s, cx, cy)) continue;
          const tv = b[cx + cy * N];
          if (tv && !C4.allied(s, o, ownerOf(tv)) && !(typeOf(tv) === K && ownerOf(tv) !== DEAD)) cb(f, cx + cy * N, promoRow(o, cx, cy) ? 1 : 0);
        }
      } else if (t === KN) { for (const [dx, dy] of NDIR) tryTo(x + dx, y + dy); }
      else if (t === K) { for (const [dx, dy] of KDIR) tryTo(x + dx, y + dy); }
      else {
        const dirs = t === B ? BDIR : t === R ? RDIR : KDIR;
        for (const [dx, dy] of dirs) { let nx = x + dx, ny = y + dy; while (tryTo(nx, ny)) { nx += dx; ny += dy; } }
      }
    }
  }
  C4.gen = gen;
  C4.pseudo = (s, o, capturesOnly) => { const out = []; gen(s, o, (f, t, pr) => out.push(mv(f, t, pr)), capturesOnly); return out; };

  // ------------------------------------------------------------------ jouer / défaire (pour la recherche : ne gère ni élimination ni tempête)
  /** Joue le coup sur s.b ; renvoie l'info d'annulation. */
  C4.make = (s, m) => {
    const f = m & 255, t = (m >> 8) & 255, v = s.b[f], cap = s.b[t];
    s.b[t] = (m >> 16) & 1 ? cell(ownerOf(v), Q) : v; s.b[f] = 0;
    return { f, t, v, cap };
  };
  C4.unmake = (s, u) => { s.b[u.f] = u.v; s.b[u.t] = u.cap; };

  // ------------------------------------------------------------------ échec / mat
  /** Case du roi vivant de `o` (-1 s'il n'y en a pas). */
  C4.kingSq = (s, o) => { for (let i = 0; i < SQ; i++) if (s.b[i] === cell(o, K)) return i; return -1; };
  /** Numéro du joueur adverse qui attaque le roi de `o` (premier trouvé), sinon -1. Les alliés ne comptent pas. */
  C4.inCheck = (s, o, ksq) => {
    const k = ksq === undefined ? C4.kingSq(s, o) : ksq;
    if (k < 0) return -1;
    for (let e = 0; e < 4; e++) if (e !== o && s.alive[e] && !C4.allied(s, o, e) && C4.attackedBy(s, e)[k]) return e;
    return -1;
  };
  /** Coups LÉGAUX de `o` : pseudo-légaux qui ne laissent pas son roi attaqué. */
  C4.moves = (s, o, capturesOnly) => {
    const out = [], ks = C4.kingSq(s, o), foes = [];
    for (let e = 0; e < 4; e++) if (e !== o && s.alive[e] && !C4.allied(s, o, e)) foes.push(e);
    gen(s, o, (f, t, pr) => {
      const m = mv(f, t, pr);
      if (ks < 0) { out.push(m); return; }
      const u = C4.make(s, m), k = f === ks ? t : ks;
      let bad = false;
      for (let i = 0; i < foes.length && !bad; i++) if (C4.attackedBy(s, foes[i])[k]) bad = true;
      C4.unmake(s, u);
      if (!bad) out.push(m);
    }, capturesOnly);
    return out;
  };

  // ------------------------------------------------------------------ partie : jouer un coup avec tout ce que ça entraîne
  const nextAlive = (s, from) => { for (let i = 1; i <= 4; i++) { const o = (from + i) % 4; if (s.alive[o]) return o; } return from; };
  /** Élimine `o` : ses pièces RESTENT, grisées et inertes (propriétaire DEAD). why : "mate" | "stalemate" | "storm". */
  function eliminate(s, o, by, why) {
    if (!s.alive[o]) return;
    s.alive[o] = false; s.out.push(o);
    for (let i = 0; i < SQ; i++) if (s.b[i] && ownerOf(s.b[i]) === o) s.b[i] = cell(DEAD, typeOf(s.b[i]));
    s.log.push({ k: "out", o, by: by == null ? -1 : by, why: why || "mate" });
  }
  /** Joue `m` pour le joueur au trait. Renvoie {ok, captured, promo, eliminated:[…], elim:[{o, why, by}], check:{by, who}|null, storm}. */
  C4.play = (s, m) => {
    const o = s.turn, f = m & 255, t = (m >> 8) & 255, v = s.b[f];
    if (!v || ownerOf(v) !== o || !s.alive[o]) return { ok: false };
    const cap = s.b[t], res = { ok: true, from: f, to: t, piece: typeOf(v), captured: null, promo: false, eliminated: [], elim: [], check: null, storm: false, owner: o };
    s.b[f] = 0;
    if ((m >> 16) & 1) { s.b[t] = cell(o, Q); res.promo = true; } else s.b[t] = v;
    if (cap) {
      const co = ownerOf(cap), ct = typeOf(cap);
      res.captured = { owner: co, type: ct };
      if (co !== DEAD) { s.pts[o] += VALUE[ct]; s.captured[o].push(cap); }              // les pièces grisées ne rapportent rien
    }
    s.last = [f, t]; s.ply++;
    s.log.push({ k: "move", o, f, t });
    // tempête : le bord s'effondre à intervalles réguliers
    const st = s.storm;
    if (st && s.ply >= st.first && (s.ply - st.first) % st.every === 0 && s.level < 5) {
      s.level++; res.storm = true;
      for (let i = 0; i < SQ; i++) {
        if (!s.b[i] || playable(s, i % N, (i / N) | 0)) continue;
        const po = ownerOf(s.b[i]);
        if (typeOf(s.b[i]) === K && po !== DEAD) { eliminate(s, po, null, "storm"); res.eliminated.push(po); res.elim.push({ o: po, why: "storm", by: -1 }); } else s.b[i] = 0;
      }
      for (let i = 0; i < SQ; i++) if (s.b[i] && !playable(s, i % N, (i / N) | 0)) s.b[i] = 0;          // pièces (même grisées) qui restaient hors de la zone
    }
    // joueur suivant : s'il n'a aucun coup légal il est maté (en échec) ou pat (pas en échec) -> éliminé ; on passe au suivant
    let nxt = nextAlive(s, o);
    for (let g = 0; g < 4 && teamsAlive(s) > 1; g++) {
      const mvs = C4.moves(s, nxt);
      if (mvs.length) break;
      const by = C4.inCheck(s, nxt), why = by >= 0 ? "mate" : "stalemate";
      if (by >= 0) s.pts[by] += 15;
      eliminate(s, nxt, by, why); res.eliminated.push(nxt); res.elim.push({ o: nxt, why, by });
      nxt = nextAlive(s, nxt);
    }
    s.turn = nxt;
    if (teamsAlive(s) > 1) { const by = C4.inCheck(s, nxt); if (by >= 0) res.check = { by, who: nxt }; }
    return res;
  };
  const teamsAlive = (s) => new Set([0, 1, 2, 3].filter((i) => s.alive[i]).map((i) => s.teams[i])).size;
  C4.teamsAlive = teamsAlive;
  C4.over = (s) => teamsAlive(s) <= 1;
  /** Classement final : [{o, rank, pts}] du meilleur au dernier (survivants d'abord, puis éliminés en sens inverse de l'élimination). */
  C4.ranking = (s) => {
    const alive = [0, 1, 2, 3].filter((i) => s.alive[i]).sort((a, b2) => s.pts[b2] - s.pts[a]);
    const order = alive.concat(s.out.slice().reverse());
    return order.map((o, i) => ({ o, rank: i + 1, pts: s.pts[o], alive: s.alive[o] }));
  };
  /** Cases attaquées par `o` : Uint8Array de 0/1. `val` (Int16Array facultatif) reçoit en plus la valeur du PLUS PETIT attaquant de chaque case (le roi compte 250). */
  C4.attackedBy = (s, o, val) => {
    const a = new Uint8Array(SQ), b = s.b;
    const mark = (d, av) => { a[d] = 1; if (val && (!val[d] || av < val[d])) val[d] = av; };
    for (let f = 0; f < SQ; f++) {
      const v = b[f];
      if (!v || ownerOf(v) !== o) continue;
      const t = typeOf(v), x = f % N, y = (f / N) | 0, av = t === K ? 250 : MATV[t];
      if (t === P) {
        const [fx, fy] = FWD[o], px = -fy, py = fx;
        for (const sg of [1, -1]) { const cx = x + fx + px * sg, cy = y + fy + py * sg; if (playable(s, cx, cy)) mark(cx + cy * N, av); }
      } else if (t === KN || t === K) {
        for (const [dx, dy] of t === KN ? NDIR : KDIR) { const nx = x + dx, ny = y + dy; if (playable(s, nx, ny)) mark(nx + ny * N, av); }
      } else {
        for (const [dx, dy] of t === B ? BDIR : t === R ? RDIR : KDIR) {
          let nx = x + dx, ny = y + dy;
          while (playable(s, nx, ny)) { const d = nx + ny * N; mark(d, av); if (b[d]) break; nx += dx; ny += dy; }
        }
      }
    }
    return a;
  };
  C4.material = (s, o) => { let m = 0; for (let i = 0; i < SQ; i++) if (s.b[i] && ownerOf(s.b[i]) === o) m += VALUE[typeOf(s.b[i])]; return m; };
  /** Parties après-tempête : prochaine chute dans combien de demi-coups (Infinity sans tempête). */
  C4.stormIn = (s) => { const st = s.storm; if (!st || s.level >= 5) return Infinity; const nxt = s.ply < st.first ? st.first : s.ply + (st.every - ((s.ply - st.first) % st.every)); return nxt - s.ply; };

  if (typeof window !== "undefined") { window.ENOS = window.ENOS || {}; window.ENOS.c4 = C4; }
  if (typeof module !== "undefined" && module.exports) module.exports = C4;
})();
