"use strict";
// CHROMA — jeu de cartes « défausse » original d'ETO. Module pur (testable dans Node).
//   Paquet de 110 cartes : 4 couleurs (c cramoisi, y cyan, g or, v violet) × [0 ×1, 1–9 ×2, Gel ×2, Retour ×2, +2 ×2] + noires : Prisme ×4, +4 Œil ×4, Échange ×2.
//   Pose une carte de même couleur, même chiffre ou même symbole ; les noires se posent toujours (on choisit la couleur).
//   Gel : le suivant passe. Retour : sens inverse (à 2 joueurs : rejoue). +2 : le suivant pioche 2 et passe. +4 Œil : pioche 4 et passe. Échange : échange ta main avec un joueur.
//   Pas de carte posable : on pioche 1 ; si elle est posable on peut la jouer, sinon on passe. Annonce « CHROMA » avant de passer à 1 carte, sinon +2.
(function (root) {
  const C = {};
  const COLORS = ["c", "y", "g", "v"];
  C.COLORS = COLORS;
  C.deck = () => {
    const d = [];
    COLORS.forEach((c) => {
      d.push({ c, k: "n", v: 0 });
      for (let v = 1; v <= 9; v++) d.push({ c, k: "n", v }, { c, k: "n", v });
      ["skip", "rev", "p2"].forEach((k) => d.push({ c, k }, { c, k }));
    });
    for (let i = 0; i < 4; i++) d.push({ c: "k", k: "wild" }, { c: "k", k: "p4" });
    d.push({ c: "k", k: "swap" }, { c: "k", k: "swap" });
    return d.map((x, i) => Object.assign({ id: i }, x));
  };
  const rng = (seed) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  const shuffle = (a, r) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  C.newGame = (n, seed) => {
    const r = rng(seed || Date.now()), deck = shuffle(C.deck(), r), hands = Array.from({ length: n }, () => deck.splice(0, 7));
    let top = deck.shift(); while (top.c === "k") { deck.push(top); top = deck.shift(); }
    const s = { n, deck, discard: [top], hands, turn: 0, dir: 1, color: top.c, said: Array(n).fill(false), over: null, log: [], seed: (seed || 1) >>> 0, drawn: null };
    // effet de la première carte retournée
    if (top.k === "skip") s.turn = nextIdx(s, 0);
    else if (top.k === "rev") { s.dir = -1; if (n === 2) s.turn = 1; }
    else if (top.k === "p2") { draw(s, 0, 2); s.turn = nextIdx(s, 0); }
    return s;
  };
  const nextIdx = (s, i, k) => (((i + (k || 1) * s.dir) % s.n) + s.n) % s.n;
  C.next = nextIdx;
  const top = (s) => s.discard[s.discard.length - 1];
  C.top = top;
  C.canPlay = (s, card) => card.c === "k" || card.c === s.color || (card.k === "n" ? top(s).k === "n" && top(s).v === card.v : card.k === top(s).k);
  C.playable = (s, i) => s.hands[i].filter((c) => C.canPlay(s, c));
  function refill(s) { if (s.deck.length) return; const keep = s.discard.pop(); s.deck = shuffle(s.discard.splice(0), rng(s.seed++ * 7919 + 1)); s.discard = [keep]; }
  function draw(s, i, k) { const got = []; for (let j = 0; j < k; j++) { refill(s); if (!s.deck.length) break; const c = s.deck.shift(); s.hands[i].push(c); got.push(c); } s.said[i] = false; return got; }
  C.draw = draw;
  /** action du joueur au trait : {type:"play", id, color?, target?} | {type:"draw"} | {type:"pass"} | {type:"say"} */
  C.act = (s, a) => {
    if (s.over) return { ok: false, err: "fini" };
    const i = s.turn, hand = s.hands[i];
    if (a.type === "say") { s.said[i] = true; return { ok: true }; }
    if (a.type === "draw") {
      if (s.drawn) return { ok: false, err: "déjà pioché" };
      const got = draw(s, i, 1); s.drawn = got[0] || null; s.log.push([i, "draw"]);
      if (!s.drawn || !C.canPlay(s, s.drawn)) { s.drawn = null; s.turn = nextIdx(s, i); }
      return { ok: true, drawn: got[0], playable: !!s.drawn };
    }
    if (a.type === "pass") { if (!s.drawn) return { ok: false, err: "pioche d'abord" }; s.drawn = null; s.turn = nextIdx(s, i); return { ok: true }; }
    const k = hand.findIndex((c) => c.id === a.id); if (k < 0) return { ok: false, err: "carte absente" };
    const card = hand[k];
    if (s.drawn && card.id !== s.drawn.id) return { ok: false, err: "joue la carte piochée ou passe" };
    if (!C.canPlay(s, card)) return { ok: false, err: "carte non jouable" };
    hand.splice(k, 1); s.discard.push(card); s.drawn = null; s.log.push([i, "play", card.id]);
    s.color = card.c === "k" ? (COLORS.includes(a.color) ? a.color : bestColor(hand)) : card.c;
    let penalty = 0;
    if (hand.length === 1 && !s.said[i]) { draw(s, i, 2); penalty = 2; }                 // pas annoncé : +2
    if (!hand.length) { s.over = { winner: i }; return { ok: true, win: true }; }
    let skip = 1;
    if (card.k === "skip") skip = 2;
    else if (card.k === "rev") { s.dir = -s.dir; if (s.n === 2) skip = 2; }
    else if (card.k === "p2") { draw(s, nextIdx(s, i), 2); skip = 2; }
    else if (card.k === "p4") { draw(s, nextIdx(s, i), 4); skip = 2; }
    else if (card.k === "swap") { const t = a.target != null && a.target !== i ? a.target : C.mostCards(s, i); const tmp = s.hands[i]; s.hands[i] = s.hands[t]; s.hands[t] = tmp; s.said[i] = s.said[t] = false; }
    s.turn = nextIdx(s, i, skip);
    return { ok: true, penalty };
  };
  C.mostCards = (s, i) => { let best = -1, t = nextIdx(s, i); for (let j = 0; j < s.n; j++) if (j !== i && s.hands[j].length > best) { best = s.hands[j].length; t = j; } return t; };
  C.fewestCards = (s, i) => { let best = 1e9, t = nextIdx(s, i); for (let j = 0; j < s.n; j++) if (j !== i && s.hands[j].length < best) { best = s.hands[j].length; t = j; } return t; };
  function bestColor(hand) { const n = { c: 0, y: 0, g: 0, v: 0 }; hand.forEach((c) => { if (n[c.c] != null) n[c.c]++; }); return Object.keys(n).sort((a, b) => n[b] - n[a])[0]; }
  C.bestColor = bestColor;

  /** IA : liste d'actions à faire pour le joueur au trait (say?, puis play ou draw [+ play/pass]) */
  C.botTurn = (s, level) => {
    const i = s.turn, hand = s.hands[i], nx = nextIdx(s, i), threat = s.hands[nx].length <= 2;
    let list = C.playable(s, i);
    if (s.drawn) list = list.filter((c) => c.id === s.drawn.id);
    if (!list.length) return s.drawn ? { type: "pass" } : { type: "draw" };
    if (level === "easy") { const c = list[Math.floor(Math.random() * list.length)]; return { type: "play", id: c.id, color: bestColor(hand.filter((x) => x.id !== c.id)) }; }
    const score = (c) => {
      let v = 0;
      if (c.c === "k") v -= hand.length > 2 ? 30 : -5;                         // garde les noires pour la fin
      if (c.k === "p4") v += threat ? 60 : -10;
      if (c.k === "p2") v += threat ? 45 : 8;
      if (c.k === "skip" || c.k === "rev") v += threat ? 35 : 6;
      if (c.k === "swap") v += hand.length >= 5 && s.hands[C.fewestCards(s, i)].length <= 3 ? 70 : -40;
      if (c.k === "n") v += c.v * 1.5;                                          // se débarrasser des gros chiffres
      const sameColor = hand.filter((x) => x.c === c.c).length; v += sameColor * 3;
      return v;
    };
    list.sort((a, b) => score(b) - score(a));
    const c = list[0];
    const rest = hand.filter((x) => x.id !== c.id);
    return { type: "play", id: c.id, color: bestColor(rest), target: c.k === "swap" ? C.fewestCards(s, i) : undefined, say: hand.length === 2 && (level !== "normal" || Math.random() < 0.85) };
  };
  C.LABEL = { skip: "Gel", rev: "Retour", p2: "+2", wild: "Prisme", p4: "+4", swap: "Échange" };
  C.COLOR_NAME = { c: "Cramoisi", y: "Cyan", g: "Or", v: "Violet", k: "Noir" };
  if (typeof module !== "undefined" && module.exports) module.exports = C; else (root.ENOS = root.ENOS || {}).chroma = C;
})(typeof window !== "undefined" ? window : globalThis);
