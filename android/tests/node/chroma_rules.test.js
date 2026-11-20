const C = require(__dirname + "/../../assets/mobile/js/games/chroma_rules.js");
let bad = 0; const check = (c, m) => { console.log((c ? "OK  " : "FAIL") + " " + m); if (!c) bad++; };
check(C.deck().length === 110, "paquet de 110 cartes");
let s = C.newGame(4, 42);
check(s.hands.every((h) => h.length === 7) && s.discard.length === 1 && s.discard[0].c !== "k", "7 cartes chacun, première carte colorée");
const total = (s) => s.deck.length + s.discard.length + s.hands.reduce((a, h) => a + h.length, 0);
check(total(s) === 110, "aucune carte perdue");
// effets
s = C.newGame(3, 7); s.discard = [{ id: 900, c: "c", k: "n", v: 5 }]; s.color = "c"; s.turn = 0; s.dir = 1;
s.hands[0] = [{ id: 1, c: "c", k: "skip" }, { id: 2, c: "y", k: "n", v: 1 }, { id: 3, c: "y", k: "n", v: 2 }];
C.act(s, { type: "play", id: 1 }); check(s.turn === 2, "Gel : le joueur suivant passe");
s.hands[2] = [{ id: 4, c: "c", k: "rev" }, { id: 5, c: "g", k: "n", v: 3 }, { id: 6, c: "g", k: "n", v: 4 }]; C.act(s, { type: "play", id: 4 }); check(s.dir === -1 && s.turn === 1, "Retour : sens inverse");
s.hands[1] = [{ id: 7, c: "c", k: "p2" }, { id: 8, c: "g", k: "n", v: 3 }, { id: 9, c: "g", k: "n", v: 9 }]; const n0 = s.hands[0].length; C.act(s, { type: "play", id: 7 }); check(s.hands[0].length === n0 + 2 && s.turn === 2, "+2 : le suivant pioche 2 et passe");
s.hands[2] = [{ id: 10, c: "k", k: "p4" }, { id: 11, c: "g", k: "n", v: 1 }, { id: 12, c: "g", k: "n", v: 2 }]; const n1 = s.hands[1].length; C.act(s, { type: "play", id: 10, color: "g" }); check(s.hands[1].length === n1 + 4 && s.color === "g" && s.turn === 0, "+4 Œil : pioche 4, couleur choisie");
check(C.act(s, { type: "play", id: s.hands[0].find((c) => c.c === "y").id }).ok === false, "carte d'une autre couleur refusée");
// CHROMA non annoncé
s = C.newGame(2, 3); s.discard = [{ id: 900, c: "c", k: "n", v: 5 }]; s.color = "c"; s.turn = 0; s.hands[0] = [{ id: 1, c: "c", k: "n", v: 1 }, { id: 2, c: "y", k: "n", v: 1 }];
C.act(s, { type: "play", id: 1 }); check(s.hands[0].length === 3, "pas d'annonce CHROMA : +2");
s = C.newGame(2, 3); s.discard = [{ id: 900, c: "c", k: "n", v: 5 }]; s.color = "c"; s.turn = 0; s.hands[0] = [{ id: 1, c: "c", k: "n", v: 1 }, { id: 2, c: "y", k: "n", v: 1 }];
C.act(s, { type: "say" }); C.act(s, { type: "play", id: 1 }); check(s.hands[0].length === 1, "annonce CHROMA : pas de pénalité");
// échange
s = C.newGame(3, 9); s.discard = [{ id: 900, c: "c", k: "n", v: 5 }]; s.color = "c"; s.turn = 0; s.hands[0] = [{ id: 1, c: "k", k: "swap" }, { id: 2, c: "y", k: "n", v: 1 }, { id: 3, c: "y", k: "n", v: 1 }]; s.hands[1] = [{ id: 4, c: "g", k: "n", v: 1 }];
C.act(s, { type: "play", id: 1, color: "y", target: 1 }); check(s.hands[0].length === 1 && s.hands[1].length === 2, "Échange : mains échangées");
// partie complète entre bots
for (const n of [2, 4, 6]) {
  s = C.newGame(n, 1234 + n); let k = 0;
  while (!s.over && k < 3000) { const a = C.botTurn(s, k % 2 ? "hard" : "normal"); if (a.say) C.act(s, { type: "say" }); const r = C.act(s, a); if (!r.ok) { console.log("refusé", a, r); break; } k++; }
  check(s.over && total(s) === 110, n + " joueurs : partie complète entre bots en " + k + " actions, aucune carte perdue");
}
console.log(bad ? bad + " ÉCHEC(S)" : "TOUT OK"); process.exit(bad ? 1 : 0);
