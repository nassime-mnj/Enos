// Lancer : node tests/quicklib.test.js
const assert = require("assert");
const Q = require("../static/quicklib.js");
let n = 0; const t = (name, fn) => { fn(); n++; console.log("OK  ", name); };

t("JSON strict valide", () => { const r = Q.parseJson('{"a":[1,2,{"b":null}]}'); assert(r.ok && !r.repaired && r.value.a[2].b === null); });
t("JSON invalide : erreur localisée (ligne / colonne), non réparable", () => { const r = Q.parseJson('{\n  "a": 1,\n  "b": @,\n}', false); assert(!r.ok && r.error.line === 3 && r.error.col === 8 && !r.error.repairable, JSON.stringify(r)); });
t("JSON presque valide : signalé réparable puis réparé", () => {
  const r = Q.parseJson('{"a": 1,}', false); assert(!r.ok && r.error.repairable);
  const f = Q.parseJson('{"a": 1,}', true); assert(f.ok && f.repaired && f.value.a === 1);
});
t("réparation : commentaires, virgules finales, quotes simples, clés nues, Python", () => {
  const src = `// config du bot\n{ name: 'Enos', /* bloc */ "tags": ['a', 'b',], debug: True, owner: None, n: 0x10, 'x-y': 1.5e2, }`;
  const r = Q.parseJson(src, true);
  assert(r.ok && r.repaired, JSON.stringify(r));
  assert.deepStrictEqual(r.value, { name: "Enos", tags: ["a", "b"], debug: true, owner: null, n: 16, "x-y": 150 });
});
t("réparation : chaînes avec échappements et unicode", () => { assert.strictEqual(Q.parseLoose(`'l\\'ami \\u00e9 \\n'`), "l'ami é \n"); });
t("réparation : erreurs précises (ligne/colonne)", () => {
  const cases = [['{"a": 1', "manquante"], ['{"a" 1}', "« : » attendu"], ['[1, 2', "manquant"], ['{"a": "abc', "non fermée"], ['{"a": 1} x', "en trop"], ['{"a": NaN}', "NaN"], ['{"a": foo}', "foo"]];
  for (const [src, frag] of cases) { const r = Q.parseJson(src, false); assert(!r.ok && r.error.message.includes(frag) && r.error.line >= 1, src + " -> " + JSON.stringify(r)); }
  const r = Q.parseJson('{\n"a": 1,\n"b": @\n}', true); assert.strictEqual(r.error.line, 3);
});
t("tri des clés récursif", () => { assert.strictEqual(JSON.stringify(Q.sortKeys({ b: 1, a: { d: 1, c: [{ z: 1, y: 2 }] } })), '{"a":{"c":[{"y":2,"z":1}],"d":1},"b":1}'); });
t("coloration : échappe le HTML et distingue clés / valeurs", () => {
  const h = Q.highlightJson('{"<b>": "x", "n": 12, "t": true, "z": null}');
  assert(h.includes('<span class="k">"&lt;b&gt;"</span>') && h.includes('<span class="s">"x"</span>') && h.includes('<span class="d">12</span>') && h.includes('<span class="b">true</span>') && h.includes('<span class="n">null</span>') && !h.includes("<b>"));
});
t("centimes", () => { assert.strictEqual(Q.toCents("12,5"), 1250); assert.strictEqual(Q.toCents("0.1") + Q.toCents("0.2"), 30); assert(Number.isNaN(Q.toCents("abc"))); assert.strictEqual(Q.toCents("1 234,56"), 123456); });
t("dépenses : part égale et reste réparti au centime", () => {
  const people = ["Ana", "Ben", "Cléo"];
  const b = Q.balances(people, [{ label: "Resto", amount: 10000, payer: "Ana", split: people }]);
  assert.deepStrictEqual(b.owed, { Ana: 3334, Ben: 3333, "Cléo": 3333 });
  assert.strictEqual(Object.values(b.balance).reduce((a, c) => a + c, 0), 0);                    // somme nulle : aucun centime perdu
  assert.deepStrictEqual(b.balance, { Ana: 6666, Ben: -3333, "Cléo": -3333 });
});
t("dépenses : participants partiels et plusieurs payeurs", () => {
  const people = ["Ana", "Ben", "Cléo", "Dan"];
  const ex = [{ amount: 12000, payer: "Ana", split: people }, { amount: 6000, payer: "Ben", split: ["Ben", "Cléo"] }, { amount: 4000, payer: "Dan", split: ["Ana", "Dan"] }];
  const b = Q.balances(people, ex);
  assert.strictEqual(b.total, 22000);
  assert.deepStrictEqual(b.balance, { Ana: 12000 - 3000 - 2000 - 0, Ben: 6000 - 3000 - 3000, "Cléo": -3000 - 3000, Dan: 4000 - 3000 - 2000 });
  const tr = Q.settle(b.balance);
  const after = { ...b.balance }; tr.forEach((x) => { after[x.from] += x.amount; after[x.to] -= x.amount; });
  assert(Object.values(after).every((v) => v === 0), "tous les comptes soldés");
  assert(tr.length <= people.length - 1);
});
t("remboursements : paires exactes d'abord, jamais plus de n-1 virements, aucun virement nul", () => {
  const tr = Q.settle({ A: 500, B: -500, C: 300, D: -100, E: -200 });
  assert.strictEqual(tr.length, 3); assert(tr.every((x) => x.amount > 0));
  assert(tr.some((x) => x.from === "B" && x.to === "A" && x.amount === 500));
  for (let k = 0; k < 200; k++) {                                                                  // aléatoire : toujours soldé, ≤ n-1
    const n = 2 + Math.floor(Math.random() * 7), bal = {}; let s = 0;
    for (let i = 0; i < n - 1; i++) { const v = Math.floor(Math.random() * 20001) - 10000; bal["P" + i] = v; s += v; } bal["P" + (n - 1)] = -s;
    const t2 = Q.settle(bal), a = { ...bal }; t2.forEach((x) => { a[x.from] += x.amount; a[x.to] -= x.amount; });
    assert(Object.values(a).every((v) => v === 0) && t2.length <= n - 1);
  }
});
t("message à envoyer", () => {
  const m = Q.summary("Week-end", ["Ana", "Ben"], [{ amount: 9000, payer: "Ana", split: ["Ana", "Ben"] }]);
  assert(m.includes("Week-end") && m.includes("Ben doit 45,00 € à Ana") && m.includes("90,00 €"));
  assert(Q.summary("x", ["A", "B"], [{ amount: 1000, payer: "A", split: ["A"] }]).includes("équilibrés"));
});
console.log(`\n${n} tests passés`);
