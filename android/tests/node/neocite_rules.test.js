const N = require(__dirname + "/../../assets/mobile/js/games/neocite_rules.js");
let bad = 0; const check = (c, m) => { console.log((c ? "OK  " : "FAIL") + " " + m); if (!c) bad++; };
check(N.SIZE === 32 && N.BOARD.filter((b) => b.type === "lot").length === 24 && N.RELAYS.length === 2, "plateau : 32 cases, 24 lots, 2 relais");
check([0, 8, 16, 24].map((i) => N.BOARD[i].type).join() === "start,jail,reserve,auction" && N.BOARD[20].type === "audit", "coins : Départ, Pare-feu, Réserve, Enchères (en bas à droite) ; Audit sur le côté");
let s = N.newGame(2, { seed: 3 });
let ev = N.roll(s, 1, 2); check(s.pos[0] === 3 && s.phase === "buy" && s.pending === 3, "déplacement de 3 : lot à acheter (" + N.BOARD[3].name + ")");
const c0 = s.cash[0]; N.buy(s); check(s.own[3].p === 0 && s.cash[0] === c0 - N.BOARD[3].price && s.phase === "end", "achat");
N.endTurn(s); check(s.turn === 1 && s.phase === "roll", "tour suivant");
N.roll(s, 1, 2); const r = N.rentOf(s, 3); check(s.cash[1] === 1500 - r && s.cash[0] === c0 - N.BOARD[3].price + r, "loyer payé (" + r + ")");
// quartier complet : loyer doublé, construction
s = N.newGame(2, { seed: 4 }); N.lotsOf(0).forEach((i) => (s.own[i] = { p: 0, lvl: 0, mort: false }));
check(N.rentOf(s, 1) === Math.round(N.BOARD[1].rent[0] * 2.5), "quartier complet : loyer ×2,5");
{ const t = N.newGame(2, { seed: 40 }); t.own[1] = { p: 0, lvl: 0, mort: false }; const r1 = N.rentOf(t, 1); t.own[2] = { p: 0, lvl: 0, mort: false }; const r2 = N.rentOf(t, 1);
  check(r2 > r1 && r2 === Math.round(N.BOARD[1].rent[0] * 1.75), "2 lots du quartier : tout le quartier monte (" + r1 + " → " + r2 + ")"); }
check(N.build(s, 0, 1) && !N.canBuild(s, 0, 1), "antenne posée ; construction homogène imposée");
N.build(s, 0, 2); N.build(s, 0, 3); check(N.canBuild(s, 0, 1) && N.rentOf(s, 1) === N.BOARD[1].rent[1], "loyer avec 1 antenne");
for (let k = 0; k < 9; k++) N.lotsOf(0).forEach((i) => N.build(s, 0, i));
check(N.lotsOf(0).every((i) => s.own[i].lvl === 4), "tours partout (niveau 4)");
check(!N.mortgage(s, 0, 1), "pas d'hypothèque sur un quartier bâti");
// faillite et liquidation
s = N.newGame(2, { seed: 5 }); s.own[30] = { p: 1, lvl: 0, mort: false }; N.lotsOf(7).forEach((i) => (s.own[i] = { p: 1, lvl: 4, mort: false })); s.cash[0] = 100; s.own[1] = { p: 0, lvl: 0, mort: false }; s.pos[0] = 25;
N.roll(s, 2, 3); check(s.out[0] && s.over && s.over.winner === 1, "faillite : loyer impayable, l'adversaire gagne");
s = N.newGame(2, { seed: 6 }); N.lotsOf(7).forEach((i) => (s.own[i] = { p: 1, lvl: 1, mort: false })); s.cash[0] = -1450; s.own[1] = { p: 0, lvl: 0, mort: false }; s.own[2] = { p: 0, lvl: 0, mort: false }; s.own[12] = { p: 0, lvl: 0, mort: false }; s.own[3] = { p: 0, lvl: 0, mort: false }; s.pos[0] = 27;
N.roll(s, 1, 1); check(!s.out[0] && s.own[1].mort, "liquidation : hypothèque automatique pour payer");
// échanges
s = N.newGame(2, { seed: 13 }); s.own[1] = { p: 0, lvl: 0, mort: false }; s.own[2] = { p: 0, lvl: 0, mort: false }; s.own[3] = { p: 1, lvl: 0, mort: false };
let off = { from: 0, to: 1, give: [], get: [3], cash: 150 };
check(N.tradeValid(s, off) && N.trade(s, off) && s.own[3].p === 0 && s.cash[0] === 1350 && s.cash[1] === 1650 && N.hasSet(s, 0, 0), "échange : lot contre argent, quartier complété");
s.own[1].lvl = 1; check(!N.tradable(s, 0, 2), "lot d'un quartier bâti : pas échangeable");
s = N.newGame(2, { seed: 14 }); s.own[1] = { p: 0, lvl: 0, mort: false }; s.own[2] = { p: 0, lvl: 0, mort: false }; s.own[3] = { p: 1, lvl: 0, mort: false };
check(!N.botAccepts(s, { from: 0, to: 1, give: [], get: [3], cash: 90 }, "normal") && N.botAccepts(s, { from: 0, to: 1, give: [], get: [3], cash: 260 }, "normal"), "bot : refuse une offre basse, accepte une offre juste");
const bo = N.botTradeOffer(s, 0, "normal"); check(bo && bo.get[0] === 3 && bo.to === 1, "bot : propose de racheter le lot qui lui manque");
// découvert
s = N.newGame(2, { seed: 15 }); s.cash[0] = 100; N.pay(s, 0, 1, 900); check(!s.out[0] && s.cash[0] === -800, "découvert : jusqu'à −1 500 autorisé");
N.pay(s, 0, 1, 800); check(s.out[0], "au-delà de −1 500 : faillite");
// refus et case Enchères
s = N.newGame(2, { seed: 16 }); N.roll(s, 1, 2); check(N.pass(s) && !s.own[3] && s.phase === "end", "refuser d'acheter : le lot reste libre, pas d'enchère");
s = N.newGame(2, { seed: 17 }); s.pos[0] = 21; N.roll(s, 1, 2); check(s.phase === "auction" && s.pending != null && !s.own[s.pending], "case Enchères : un lot libre est mis aux enchères");
const lotA = s.pending; check(N.auction(s, [80, 120]) === 1 && s.own[lotA].p === 1, "enchère : le plus offrant l'emporte");
// pare-feu
s = N.newGame(2, { seed: 7 }); s.pos[0] = 18; N.roll(s, 1, 1); check(s.pos[0] === N.JAIL && s.jail[0] === 0, "Audit : direction le Pare-feu");
N.endTurn(s); N.endTurn(s); check(s.phase === "jailed", "au Pare-feu au tour suivant");
N.roll(s, 1, 2); check(s.pos[0] === N.JAIL && s.phase === "end", "pas de double : on reste");
N.endTurn(s); N.endTurn(s); check(N.jailPay(s) && s.reserve === 50 && s.phase === "roll", "payer 50 : libéré (Réserve = 50)");
s.pos[0] = 13; N.roll(s, 1, 2); check(s.cash[0] === 1500 - 50 + 50, "case Réserve : on remporte la Réserve");
// trois doubles
s = N.newGame(2, { seed: 8 }); N.roll(s, 1, 1); if (s.phase === "buy") N.pass(s); N.roll(s, 2, 2); if (s.phase === "buy") N.pass(s); if (s.phase === "relay") N.relay(s, false);
N.roll(s, 3, 3); check(s.pos[0] === N.JAIL, "trois doubles : Pare-feu");
// enchère
s = N.newGame(3, { seed: 9 }); s.pos[0] = 21; N.roll(s, 1, 2); const sqA = s.pending, w = N.auction(s, [0, 70, 55]); check(w === 1 && s.own[sqA].p === 1 && s.cash[1] === 1430, "enchère : le plus offrant paie son offre");
// relais
s = N.newGame(2, { seed: 10 }); s.pos[0] = 9; N.roll(s, 1, 2); check(s.phase === "buy" && s.pending === 12, "relais à acheter"); N.buy(s);
s.dice = [1, 2]; s.phase = "relay"; s.pending = 12; const cash = s.cash[0]; N.relay(s, true); check(s.pos[0] === 28 && s.cash[0] === cash - 50 && s.phase === "buy", "téléportation vers l'autre relais (50)");
// cartes
s = N.newGame(2, { seed: 11 }); s.deck = ["jail"]; s.pos[0] = 1; N.roll(s, 1, 2); check(s.pos[0] === N.JAIL, "carte Signal : direction Pare-feu");
s = N.newGame(2, { seed: 12 }); s.deck = ["pass"]; s.pos[0] = 1; N.roll(s, 1, 2); check(s.passes[0] === 1 && !s.deck.includes("pass"), "laissez-passer gardé");
// parties complètes entre bots
const play = (n, lvl, rounds) => { const s = N.newGame(n, { seed: 100 + n, rounds }); let k = 0;
  while (!s.over && k++ < 20000) { const p = s.turn;
    if (s.phase === "jailed") { const d = N.botJail(s, lvl); if (d === "pass") N.jailPass(s); else if (d === "pay") N.jailPay(s); else { N.roll(s); continue; } }
    if (s.phase === "roll") { N.roll(s); continue; }
    if (s.phase === "buy") { if (N.botWantsBuy(s, lvl)) N.buy(s); else N.pass(s); continue; }
    if (s.phase === "auction") { N.auction(s, s.cash.map((_, j) => N.botBid(s, j, lvl))); continue; }
    if (s.phase === "relay") { N.relay(s, N.botRelay(s, lvl)); continue; }
    if (s.phase === "end") { const o = N.botTradeOffer(s, p, lvl); if (o && N.botAccepts(s, o, lvl)) N.trade(s, o); N.botManage(s, p, lvl); N.endTurn(s); } }
  return s; };
for (const n of [2, 4, 6]) { const g = play(n, "normal", 0); const money = g.cash.reduce((a, b) => a + b, 0);
  check(g.over && g.cash.every((c) => c >= -N.OVERDRAFT), n + " joueurs jusqu'à la faillite : vainqueur " + (g.over && g.over.winner) + " au tour " + g.round + ", " + Object.keys(g.own).length + " lots possédés"); void money; }
const g = play(4, "hard", 25); check(g.over && g.over.reason !== undefined, "partie limitée à 25 tours : fin au tour " + g.round + " (" + g.over.reason + ")");
console.log(bad ? bad + " ÉCHEC(S)" : "TOUT OK"); process.exit(bad ? 1 : 0);
