"use strict";
// NÉO-CITÉ — jeu de plateau immobilier original (module pur, testable dans Node).
//   32 cases : 4 coins (Départ, Pare-feu, Réserve, Audit), 8 quartiers de 3 lots, 2 Relais (téléportation payante), 2 cases Signal (cartes).
//   On achète des lots, on complète un quartier pour y poser des antennes (1 à 3) puis une tour, on encaisse les loyers.
//   Lot refusé : enchère sous pli fermé (chacun propose un prix une fois, le plus offrant l'emporte).
//   Amendes et taxes alimentent la Réserve, que remporte celui qui s'arrête sur la case Réserve.
(function (root) {
  const N = {};
  // 8 régions du monde, 3 villes chacune, de la moins chère à la plus chère (chaque ville est illustrée par son monument)
  const DIST = [
    { name: "Maghreb", color: "#e9dcc0", lots: ["Tunis", "Alger", "Casablanca"], landmarks: ["Mosquée Zitouna", "Monument des Martyrs", "Mosquée Hassan II"], price: 60, build: 50 },
    { name: "Afrique", color: "#e8b54a", lots: ["Dakar", "Abidjan", "Le Caire"], landmarks: ["Monument de la Renaissance africaine", "Cathédrale Saint-Paul", "Pyramides de Gizeh"], price: 90, build: 50 },
    { name: "Amérique latine", color: "#1acfd6", lots: ["Mexico", "Buenos Aires", "Rio de Janeiro"], landmarks: ["Palais des Beaux-Arts", "Obélisque", "Christ Rédempteur"], price: 120, build: 100 },
    { name: "Europe du Sud", color: "#8b5cf6", lots: ["Lisbonne", "Madrid", "Rome"], landmarks: ["Tour de Belém", "Puerta de Alcalá", "Colisée"], price: 150, build: 100 },
    { name: "Asie", color: "#14b8a6", lots: ["Bangkok", "Séoul", "Singapour"], landmarks: ["Wat Arun", "Tour N Séoul", "Marina Bay"], price: 180, build: 150 },
    { name: "Europe du Nord", color: "#ef1748", lots: ["Amsterdam", "Berlin", "Londres"], landmarks: ["Canaux et maisons étroites", "Porte de Brandebourg", "Tower Bridge"], price: 220, build: 150 },
    { name: "Orient", color: "#22c55e", lots: ["Istanbul", "Doha", "Dubaï"], landmarks: ["Sainte-Sophie", "Musée d'art islamique", "Burj Khalifa"], price: 260, build: 200 },
    { name: "Capitales mondiales", color: "#b3122f", lots: ["Tokyo", "New York", "Paris"], landmarks: ["Tokyo Tower", "Statue de la Liberté", "Tour Eiffel"], price: 320, build: 200 },
  ];
  N.DIST = DIST;
  // plateau : côté s (0..3) = coin s*8, puis 7 cases : quartier A (3 lots), case spéciale, quartier B (3 lots)
  const SPECIAL = [{ type: "signal", name: "Signal" }, { type: "relay", name: "Aéroport Nord", price: 200 }, { type: "audit", name: "Audit" }, { type: "relay", name: "Aéroport Sud", price: 200 }];
  const CORNER = [{ type: "start", name: "Départ" }, { type: "jail", name: "Pare-feu" }, { type: "reserve", name: "Réserve" }, { type: "auction", name: "Enchères" }];
  const BOARD = [];
  for (let s = 0; s < 4; s++) {
    BOARD.push(Object.assign({}, CORNER[s]));
    for (const [k, half] of [[0, 0], [1, 0], [2, 0], [-1, -1], [0, 1], [1, 1], [2, 1]]) {
      if (k < 0) { BOARD.push(Object.assign({}, SPECIAL[s])); continue; }
      const d = s * 2 + half, D = DIST[d], price = D.price + (k === 2 ? 20 : 0), base = Math.round(price / 8);
      BOARD.push({ type: "lot", d, k, name: D.lots[k], price, build: D.build, rent: [base, base * 5, base * 15, base * 40, base * 55] });
    }
  }
  N.BOARD = BOARD; N.SIZE = BOARD.length;
  N.JAIL = 8; N.RESERVE = 16; N.AUDIT = 20; N.AUCTION = 24; N.SALARY = 200; N.JAIL_FEE = 50; N.OVERDRAFT = 1500;
  N.RELAYS = BOARD.map((b, i) => (b.type === "relay" ? i : -1)).filter((i) => i >= 0);
  N.lotsOf = (d) => BOARD.map((b, i) => (b.type === "lot" && b.d === d ? i : -1)).filter((i) => i >= 0);

  // cartes Signal
  const CARDS = [
    { id: "start", text: "Mise à jour réussie : avance jusqu'au Départ.", go: 0 },
    { id: "relay", text: "Vol en correspondance : avance jusqu'au prochain Aéroport.", relay: true },
    { id: "hack", text: "Prix du hackathon : reçois 150.", gain: 150 },
    { id: "fine", text: "Amende réseau : verse 100 à la Réserve.", fine: 100 },
    { id: "jail", text: "Intrusion détectée : va directement au Pare-feu.", jail: true },
    { id: "pass", text: "Laissez-passer : sors du Pare-feu sans payer. Garde cette carte.", pass: true },
    { id: "back", text: "Bug de navigation : recule de 3 cases.", back: 3 },
    { id: "viral", text: "Stream viral : chaque joueur te verse 25.", collect: 25 },
    { id: "maint", text: "Maintenance : paie 25 par antenne et 100 par tour.", repair: [25, 100] },
    { id: "bounty", text: "Bug bounty : reçois 100.", gain: 100 },
    { id: "cloud", text: "Facture cloud : verse 50 à la Réserve.", fine: 50 },
    { id: "summit", text: "Billet d'avion offert : avance jusqu'à Tokyo.", go: -1 },
    { id: "rest", text: "Pause bien méritée : avance jusqu'à la Réserve.", go: 16 },
    { id: "round", text: "Tournée générale : verse 25 à chaque joueur.", payAll: 25 },
    { id: "dividend", text: "Dividendes de tes actions : reçois 50.", gain: 50 },
    { id: "drone", text: "Excès de vitesse en drone : verse 75 à la Réserve.", fine: 75 },
    { id: "refund", text: "Remboursement d'impôts : reçois 20.", gain: 20 },
    { id: "pixel", text: "Carnaval : avance jusqu'à Mexico.", go: -2 },
    { id: "audit2", text: "Contrôle fiscal surprise : va à l'Audit.", go: 20 },
    { id: "jackpot", text: "Concours d'architecture : reçois 200.", gain: 200 },
  ];
  N.CARDS = CARDS;
  const rng = (seed) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  const shuffle = (a, r) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  N.newGame = (n, o) => {
    o = o || {}; const seed = (o.seed || Date.now()) >>> 0, r = rng(seed);
    const s = { n, cash: Array(n).fill(o.cash || 1500), pos: Array(n).fill(0), jail: Array(n).fill(-1), passes: Array(n).fill(0), out: Array(n).fill(false),
      own: {}, turn: 0, phase: "roll", dice: null, doubles: 0, reserve: 0, round: 1, maxRounds: o.rounds || 0, deck: shuffle(CARDS.map((c) => c.id), r), seed, rolls: 0, over: null, log: [], pending: null };
    s.r = r; return s;
  };
  const log = (s, txt) => { s.log.push(txt); if (s.log.length > 60) s.log.shift(); };
  N.owner = (s, sq) => (s.own[sq] ? s.own[sq].p : -1);
  N.hasSet = (s, p, d) => N.lotsOf(d).every((i) => N.owner(s, i) === p);
  N.rentOf = (s, sq, roll) => {
    const o = s.own[sq], b = BOARD[sq]; if (!o || o.mort) return 0;
    if (b.type === "relay") return N.RELAYS.filter((i) => N.owner(s, i) === o.p).length === 2 ? 100 : 40;
    if (o.lvl > 0) return b.rent[o.lvl];
    return Math.round(b.rent[0] * N.SETMULT[N.lotsOf(b.d).filter((i) => N.owner(s, i) === o.p).length - 1]); void roll;
  };
  /** le quartier prend de la valeur à chaque lot possédé : ×1, ×1,75, ×2,5 (quartier complet) */
  N.SETMULT = [1, 1.75, 2.5];
  N.netWorth = (s, p) => s.cash[p] + Object.entries(s.own).filter(([, o]) => o.p === p).reduce((a, [sq, o]) => { const b = BOARD[sq]; return a + (o.mort ? b.price / 2 : b.price) + (o.lvl || 0) * (b.build || 0) / 2; }, 0);
  N.buildings = (s, p) => Object.entries(s.own).filter(([, o]) => o.p === p).reduce((a, [, o]) => { if (o.lvl === 4) a[1]++; else a[0] += o.lvl || 0; return a; }, [0, 0]);

  // ------------------------------------------------------------------ argent
  /** paiement ; to = index joueur, "reserve" ou null (banque). Découvert permis jusqu'à −1 500 ; au-delà on vend et hypothèque, sinon faillite. */
  N.canSpend = (s, p, amount) => s.cash[p] - amount >= -N.OVERDRAFT;
  function pay(s, from, to, amount, ev) {
    if (amount <= 0) return true;
    if (!N.canSpend(s, from, amount)) liquidate(s, from, amount, ev);
    if (!N.canSpend(s, from, amount)) { bankrupt(s, from, to, ev); return false; }
    s.cash[from] -= amount;
    if (to === "reserve") s.reserve += amount; else if (to != null && to >= 0) s.cash[to] += amount;
    return true;
  }
  N.pay = pay;
  function liquidate(s, p, need, ev) {
    const mine = () => Object.keys(s.own).map(Number).filter((i) => s.own[i].p === p);
    // 1) bâtiments (à moitié prix), les plus chers d'abord
    let guard = 0;
    while (s.cash[p] - need < -N.OVERDRAFT && guard++ < 200) { const b = mine().filter((i) => s.own[i].lvl > 0).sort((a, c) => s.own[c].lvl - s.own[a].lvl || BOARD[c].build - BOARD[a].build)[0]; if (b == null) break; N.sell(s, p, b); ev && ev.push({ t: "sell", p, sq: b }); }
    // 2) hypothèques, les moins chères d'abord
    while (s.cash[p] - need < -N.OVERDRAFT && guard++ < 400) { const m = mine().filter((i) => !s.own[i].mort && !(s.own[i].lvl > 0)).sort((a, c) => BOARD[a].price - BOARD[c].price)[0]; if (m == null) break; N.mortgage(s, p, m); ev && ev.push({ t: "mort", p, sq: m }); }
  }
  function bankrupt(s, p, to, ev) {
    const heir = typeof to === "number" && to >= 0 ? to : -1;
    if (heir >= 0) s.cash[heir] += Math.max(0, s.cash[p]);
    Object.keys(s.own).map(Number).filter((i) => s.own[i].p === p).forEach((i) => { if (heir >= 0) { s.own[i].p = heir; s.own[i].lvl = 0; } else delete s.own[i]; });
    s.cash[p] = 0; s.out[p] = true; s.passes[p] = 0; log(s, `faillite:${p}`); ev && ev.push({ t: "bankrupt", p, to: heir });
    const alive = s.out.map((o, i) => (o ? -1 : i)).filter((i) => i >= 0);
    if (alive.length === 1) s.over = { winner: alive[0], reason: "last" };
  }

  // ------------------------------------------------------------------ déplacements
  function moveTo(s, p, dest, ev, salary) {
    const from = s.pos[p];
    if (salary !== false && dest < from && dest !== from) { s.cash[p] += N.SALARY; ev.push({ t: "salary", p }); }
    s.pos[p] = dest; ev.push({ t: "move", p, from, to: dest });
  }
  function toJail(s, p, ev) { s.pos[p] = N.JAIL; s.jail[p] = 0; s.doubles = 0; ev.push({ t: "jail", p }); log(s, `pare-feu:${p}`); }
  function land(s, p, ev, roll) {
    const sq = s.pos[p], b = BOARD[sq];
    if (b.type === "lot" || b.type === "relay") {
      const o = s.own[sq];
      if (!o) { s.phase = "buy"; s.pending = sq; return; }
      if (o.p !== p && !o.mort && !s.out[o.p]) { const r = N.rentOf(s, sq, roll); ev.push({ t: "rent", p, to: o.p, sq, amount: r }); pay(s, p, o.p, r, ev); }
      if (b.type === "relay" && !s.out[p]) { s.phase = "relay"; s.pending = sq; return; }
    } else if (b.type === "signal") { drawCard(s, p, ev, roll); return; }
    else if (b.type === "audit") toJail(s, p, ev);
    else if (b.type === "auction") { const free = BOARD.map((x, i) => ((x.type === "lot" || x.type === "relay") && !s.own[i] ? i : -1)).filter((i) => i >= 0);
      if (free.length) { s.phase = "auction"; s.pending = free[Math.floor(s.r() * free.length)]; ev.push({ t: "auction", p, sq: s.pending }); return; } }
    else if (b.type === "reserve") { if (s.reserve > 0) { ev.push({ t: "reserve", p, amount: s.reserve }); s.cash[p] += s.reserve; s.reserve = 0; } }
    after(s);
  }
  function after(s) { if (s.over) { s.phase = "over"; return; } const p = s.turn; s.phase = !s.out[p] && s.dice && s.dice[0] === s.dice[1] && s.jail[p] < 0 ? "roll" : "end"; s.pending = null; }
  function drawCard(s, p, ev, roll) {
    // événement tiré au hasard (le laissez-passer reste chez son détenteur tant qu'il ne l'a pas utilisé)
    const id = s.deck[Math.floor(s.r() * s.deck.length)], c = CARDS.find((x) => x.id === id); if (c.pass) s.deck.splice(s.deck.indexOf(id), 1);
    ev.push({ t: "card", p, card: c.id, text: c.text });
    if (c.gain) s.cash[p] += c.gain;
    else if (c.fine) pay(s, p, "reserve", c.fine, ev);
    else if (c.pass) s.passes[p]++;
    else if (c.jail) { toJail(s, p, ev); return after(s); }
    else if (c.go != null) { const dest = c.go === -1 ? N.lotsOf(7)[0] : c.go === -2 ? N.lotsOf(2)[0] : c.go; moveTo(s, p, dest, ev); if (dest !== 0) return land(s, p, ev, roll); }
    else if (c.relay) { let i = s.pos[p]; do { i = (i + 1) % N.SIZE; } while (BOARD[i].type !== "relay"); moveTo(s, p, i, ev); return land(s, p, ev, roll); }
    else if (c.back) { const dest = (s.pos[p] - c.back + N.SIZE) % N.SIZE; moveTo(s, p, dest, ev, false); return land(s, p, ev, roll); }
    else if (c.collect) s.out.forEach((o, j) => { if (!o && j !== p) pay(s, j, p, c.collect, ev); });
    else if (c.payAll) s.out.forEach((o, j) => { if (!o && j !== p) pay(s, p, j, c.payAll, ev); });
    else if (c.repair) { const [a, t] = N.buildings(s, p); pay(s, p, "reserve", a * c.repair[0] + t * c.repair[1], ev); }
    after(s);
  }
  N.returnPass = (s) => { if (!s.deck.includes("pass")) s.deck.push("pass"); };

  // ------------------------------------------------------------------ actions
  /** lancer de dés (d1, d2 facultatifs pour les tests) ; renvoie la liste d'événements à animer */
  N.roll = (s, d1, d2) => {
    const p = s.turn, ev = []; if (s.over || (s.phase !== "roll" && s.phase !== "jailed")) return ev;
    d1 = d1 || 1 + Math.floor(s.r() * 6); d2 = d2 || 1 + Math.floor(s.r() * 6); s.dice = [d1, d2]; s.rolls++; ev.push({ t: "dice", p, dice: [d1, d2] });
    const dbl = d1 === d2;
    if (s.jail[p] >= 0) {
      if (dbl) { s.jail[p] = -1; ev.push({ t: "free", p }); s.dice = [d1, d2 + 0.5]; }      // sortie sur un double : on avance, sans rejouer
      else { s.jail[p]++; if (s.jail[p] >= 3) { pay(s, p, "reserve", N.JAIL_FEE, ev); s.jail[p] = -1; ev.push({ t: "free", p, paid: true }); if (s.out[p]) { after(s); return ev; } } else { s.phase = "end"; return ev; } }
    } else if (dbl) { s.doubles++; if (s.doubles >= 3) { toJail(s, p, ev); s.phase = "end"; return ev; } }
    const dest = (s.pos[p] + d1 + d2) % N.SIZE; moveTo(s, p, dest, ev); land(s, p, ev, d1 + d2);
    if (s.dice[1] % 1) s.dice = [d1, d2];
    return ev;
  };
  N.jailPay = (s) => { const p = s.turn; if (s.jail[p] < 0 || !N.canSpend(s, p, N.JAIL_FEE)) return false; pay(s, p, "reserve", N.JAIL_FEE); s.jail[p] = -1; s.phase = "roll"; return true; };
  N.jailPass = (s) => { const p = s.turn; if (s.jail[p] < 0 || !s.passes[p]) return false; s.passes[p]--; N.returnPass(s); s.jail[p] = -1; s.phase = "roll"; return true; };
  N.buy = (s) => { const p = s.turn, sq = s.pending; if (s.phase !== "buy" || !N.canSpend(s, p, BOARD[sq].price)) return false; s.cash[p] -= BOARD[sq].price; s.own[sq] = { p, lvl: 0, mort: false }; log(s, `achat:${p}:${sq}`); after(s); return true; };
  /** refuser d'acheter : le lot reste libre */
  N.pass = (s) => { if (s.phase !== "buy") return false; log(s, `refus:${s.turn}:${s.pending}`); after(s); return true; };
  /** case Enchères : bids[j] = offre sous pli fermé du joueur j (0 = passe). Le plus offrant paie son offre. Renvoie le gagnant ou -1. */
  N.auction = (s, bids) => {
    const sq = s.pending; if (s.phase !== "auction") return -1;
    let best = -1; bids.forEach((v, j) => { if (s.out[j] || !(v > 0) || v > Math.max(0, s.cash[j])) return; if (best < 0 || v > bids[best] || (v === bids[best] && j === s.turn)) best = j; });
    if (best >= 0) { s.cash[best] -= bids[best]; s.own[sq] = { p: best, lvl: 0, mort: false }; log(s, `enchère:${best}:${sq}:${bids[best]}`); }
    after(s); return best;
  };
  /** Relais : se téléporter à l'autre Relais pour 50 (ou rester) */
  N.relay = (s, go) => { const p = s.turn; if (s.phase !== "relay") return []; const ev = []; s.phase = "end";
    if (go && s.cash[p] >= 50) { pay(s, p, "reserve", 50, ev); const other = N.RELAYS.find((i) => i !== s.pos[p]); moveTo(s, p, other, ev, other < s.pos[p]); const sq = other, o = s.own[sq];
      if (o && o.p !== p && !o.mort && !s.out[o.p]) { const r = N.rentOf(s, sq); ev.push({ t: "rent", p, to: o.p, sq, amount: r }); pay(s, p, o.p, r, ev); }
      else if (!o) { s.phase = "buy"; s.pending = sq; return ev; } }
    after(s); return ev; };
  N.endTurn = (s) => {
    if (s.over) return; if (s.phase !== "end" && s.phase !== "roll") return;
    s.doubles = 0; s.dice = null; s.pending = null; const start = s.turn;
    do { s.turn = (s.turn + 1) % s.n; if (s.turn === 0) s.round++; } while (s.out[s.turn] && s.turn !== start);
    if (s.maxRounds && s.round > s.maxRounds) { let w = 0; for (let j = 0; j < s.n; j++) if (!s.out[j] && N.netWorth(s, j) > N.netWorth(s, w)) w = j; s.over = { winner: w, reason: "rounds" }; s.phase = "over"; return; }
    s.phase = s.jail[s.turn] >= 0 ? "jailed" : "roll";
  };
  // construction : quartier complet, rien d'hypothéqué, construction homogène (pas plus d'un niveau d'écart)
  N.canBuild = (s, p, sq) => { const o = s.own[sq], b = BOARD[sq]; if (!o || o.p !== p || b.type !== "lot" || o.lvl >= 4 || !N.canSpend(s, p, b.build)) return false;
    const lots = N.lotsOf(b.d); if (!N.hasSet(s, p, b.d) || lots.some((i) => s.own[i].mort)) return false; return o.lvl <= Math.min(...lots.map((i) => s.own[i].lvl)); };
  N.build = (s, p, sq) => { if (!N.canBuild(s, p, sq)) return false; s.cash[p] -= BOARD[sq].build; s.own[sq].lvl++; return true; };
  N.canSell = (s, p, sq) => { const o = s.own[sq]; if (!o || o.p !== p || !(o.lvl > 0)) return false; return o.lvl >= Math.max(...N.lotsOf(BOARD[sq].d).map((i) => s.own[i].lvl)); };
  N.sell = (s, p, sq) => { const o = s.own[sq]; if (!o || o.p !== p || !(o.lvl > 0)) return false; o.lvl--; s.cash[p] += BOARD[sq].build / 2; return true; };
  N.mortgage = (s, p, sq) => { const o = s.own[sq], b = BOARD[sq]; if (!o || o.p !== p || o.mort) return false; if (b.type === "lot" && N.lotsOf(b.d).some((i) => s.own[i] && s.own[i].lvl > 0)) return false; o.mort = true; s.cash[p] += b.price / 2; return true; };
  N.unmortgage = (s, p, sq) => { const o = s.own[sq], cost = Math.ceil(BOARD[sq].price * 0.55); if (!o || o.p !== p || !o.mort || s.cash[p] < cost) return false; o.mort = false; s.cash[p] -= cost; return true; };
  N.unmortgageCost = (sq) => Math.ceil(BOARD[sq].price * 0.55);
  // ------------------------------------------------------------------ échanges entre joueurs
  /** lot échangeable : appartient au joueur et aucun bâtiment dans son quartier (on vend d'abord les bâtiments) */
  N.tradable = (s, p, sq) => { const o = s.own[sq], b = BOARD[sq]; if (!o || o.p !== p) return false; return b.type !== "lot" || N.lotsOf(b.d).every((i) => !(s.own[i] && s.own[i].lvl > 0)); };
  /** offre {from, to, give: [lots de from], get: [lots de to], cash: somme versée par from (négative = reçue)} */
  N.tradeValid = (s, o) => o && o.from !== o.to && !s.out[o.from] && !s.out[o.to] && (o.give.length || o.get.length || o.cash) && o.give.every((sq) => N.tradable(s, o.from, sq)) && o.get.every((sq) => N.tradable(s, o.to, sq))
    && (o.cash <= 0 || s.cash[o.from] >= o.cash) && (o.cash >= 0 || s.cash[o.to] >= -o.cash);
  N.trade = (s, o) => { if (!N.tradeValid(s, o)) return false; o.give.forEach((sq) => (s.own[sq].p = o.to)); o.get.forEach((sq) => (s.own[sq].p = o.from)); s.cash[o.from] -= o.cash; s.cash[o.to] += o.cash; log(s, `échange:${o.from}:${o.to}`); return true; };

  // ------------------------------------------------------------------ IA
  const RES = { easy: 40, normal: 120, hard: 180, max: 220 };
  /** valeur d'un lot pour le joueur p (complète ou bloque un quartier ?) */
  N.value = (s, p, sq) => { const b = BOARD[sq]; let v = b.price;
    if (b.type === "lot") { const lots = N.lotsOf(b.d), mine = lots.filter((i) => N.owner(s, i) === p).length, theirs = lots.filter((i) => { const o = N.owner(s, i); return o >= 0 && o !== p; }); if (mine === 2) v *= 2.2; else if (mine === 1 && !theirs.length) v *= 1.4; if (theirs.length === 2 && new Set(theirs.map((i) => N.owner(s, i))).size === 1) v *= 1.7; }
    else if (b.type === "relay") v *= N.RELAYS.some((i) => N.owner(s, i) === p) ? 1.6 : 1.1;
    return v; };
  N.botWantsBuy = (s, level) => { const p = s.turn, sq = s.pending, b = BOARD[sq], res = RES[level] || 120; if (s.cash[p] < b.price) return false; if (level === "easy") return s.cash[p] - b.price >= res;
    return s.cash[p] - b.price >= res * (N.value(s, p, sq) > b.price * 1.3 ? 0.3 : 1); };
  N.botBid = (s, p, level, rnd) => { const sq = s.pending, b = BOARD[sq], res = RES[level] || 120; rnd = rnd || s.r; const v = N.value(s, p, sq) * ({ easy: 0.7, normal: 0.9, hard: 1.0, max: 1.08 }[level] || 0.9) * (0.85 + rnd() * 0.25);
    return Math.max(0, Math.min(Math.floor(v / 5) * 5, s.cash[p] - res)); };
  /** gestion de fin de tour : lever les hypothèques puis construire tant qu'il reste une marge */
  N.botManage = (s, p, level) => { const res = (RES[level] || 120) + 60, did = []; let guard = 0;
    for (const sq of Object.keys(s.own).map(Number)) if (s.own[sq].p === p && s.own[sq].mort && s.cash[p] - N.unmortgageCost(sq) > res * 1.5) { N.unmortgage(s, p, sq); did.push({ t: "unmort", sq }); }
    if (level === "easy" && s.r() < 0.5) return did;
    for (;;) { if (guard++ > 40) break; const opts = Object.keys(s.own).map(Number).filter((sq) => N.canBuild(s, p, sq) && s.cash[p] - BOARD[sq].build >= res).sort((a, b) => BOARD[b].d - BOARD[a].d); if (!opts.length) break; N.build(s, p, opts[0]); did.push({ t: "build", sq: opts[0] }); }
    return did; };
  /** valeur qu'un joueur perd en cédant un lot (plus s'il casse son quartier ou complète celui de l'autre) */
  const keepValue = (s, p, sq, to) => { const b = BOARD[sq]; let v = b.price * (s.own[sq] && s.own[sq].mort ? 0.6 : 1);
    if (b.type === "lot") { const lots = N.lotsOf(b.d), mine = lots.filter((i) => N.owner(s, i) === p).length, theirs = lots.filter((i) => N.owner(s, i) === to).length; v *= 1 + (mine - 1) * 0.45; if (theirs === 2) v *= 2.4; }
    return v; };
  /** un bot accepte-t-il l'offre ? (gain net selon sa valeur des lots, marge selon le niveau) */
  N.botAccepts = (s, o, level) => { if (!N.tradeValid(s, o)) return false; const b = o.to;
    const gain = o.give.reduce((a, sq) => a + N.value(s, b, sq), 0) + o.cash, loss = o.get.reduce((a, sq) => a + keepValue(s, b, sq, o.from), 0);
    const margin = { easy: 0.95, normal: 1.08, hard: 1.18, max: 1.25 }[level] || 1.08; return gain >= loss * margin && s.cash[b] + o.cash >= 0; };
  /** offre d'un bot : racheter le lot qui lui manque pour compléter un quartier (une fois tous les 4 tours par lot) */
  N.botTradeOffer = (s, p, level) => { if (level === "easy") return null; const res = (RES[level] || 120) + 40; s.asked = s.asked || {};
    for (let d = 7; d >= 0; d--) { const lots = N.lotsOf(d), mine = lots.filter((i) => N.owner(s, i) === p); if (mine.length !== 2) continue;
      const sq = lots.find((i) => N.owner(s, i) !== p); const q = N.owner(s, sq); if (q < 0 || !N.tradable(s, q, sq) || !N.tradable(s, p, mine[0])) continue;
      const key = p + ":" + sq; if (s.asked[key] && s.round - s.asked[key] < 4) continue;
      const cash = Math.floor((BOARD[sq].price * ({ normal: 2.7, hard: 3.0, max: 3.3 }[level] || 2.7)) / 10) * 10; if (s.cash[p] - cash < res) continue;
      s.asked[key] = s.round; return { from: p, to: q, give: [], get: [sq], cash }; }
    return null; };
  N.botJail = (s, level) => { const p = s.turn; if (s.passes[p]) return "pass"; const built = Object.values(s.own).some((o) => o.p !== p && o.lvl > 0); return s.cash[p] >= 300 && !(built && level !== "easy") ? "pay" : "roll"; };
  N.botRelay = (s, level) => { const p = s.turn, other = N.RELAYS.find((i) => i !== s.pos[p]), o = s.own[other]; if (s.cash[p] < 200 || level === "easy") return false; return !o || o.p === p; };
  if (typeof module !== "undefined" && module.exports) module.exports = N; else (root.ENOS = root.ENOS || {}).neocite = N;
})(typeof window !== "undefined" ? window : globalThis);
