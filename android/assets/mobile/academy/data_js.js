"use strict";
(() => {
  const A = ACAD;
  A.add("js", {
    id: "vars", t: "let, const et console.log", lv: 1, min: 4, why: "nommer et afficher des valeurs", when: "partout : c'est la base de tout script",
    stages: [{ t: "Déclarer", code: 'const nom = "Ada";\nlet age = 36;\nage = age + 1;\nconsole.log(nom, age);\n', notes: { 1: "`const` : la variable ne pourra pas être **réaffectée**.", 2: "`let` : réaffectable. On évite `var` (portée piégeuse).", 3: "Le type est dynamique : c'est la **valeur** qui a un type." },
      steps: [S(1, "`const nom` : liaison **constante** vers la chaîne `\"Ada\"`.", { nom: '"Ada"' }), S(2, "`let age` : modifiable plus tard.", { age: 36 }), S(3, "On calcule 36 + 1 puis on réaffecte `age`. Réaffecter `nom` lèverait une erreur.", { age: 37 }), S(4, "`console.log` écrit dans la console.", {}, "Ada 37\n")] }],
    quiz: [{ code: "const x = 1;\nx = 2;\nconsole.log(x);", o: ["1", "2", "TypeError", "undefined"], a: 2, why: "Une variable `const` ne peut pas être réaffectée : `TypeError: Assignment to constant variable`." }],
    ex: { prompt: "Lis deux nombres (`readline()` lit une ligne) et affiche leur somme.", starter: "const a = Number(readline());\nconst b = Number(readline());\n", solution: "const a = Number(readline());\nconst b = Number(readline());\nconsole.log(a + b);\n", hints: ["`readline()` renvoie du texte ; `Number(...)` le convertit.", "`console.log(a + b)`."], tests: [{ in: "3\n4", out: "7" }, { in: "10\n-2", out: "8" }], checks: [["console\\.log", "console.log"]] },
  });
  A.add("js", {
    id: "func", t: "Fonctions et fonctions fléchées", lv: 2, min: 6, why: "réutiliser et composer du code", when: "toujours : les fonctions sont des valeurs en JS",
    stages: [{ t: "function et =>", code: "function carre(x) {\n  return x * x;\n}\nconst double = (n) => n * 2;\nconsole.log(carre(3), double(4));\n", notes: { 4: "Une **fonction fléchée** : syntaxe courte ; le résultat de l'expression est renvoyé." },
      steps: [S(1, "La déclaration crée la fonction `carre` (sans l'exécuter).", { carre: "ƒ" }), S(4, "Une fonction est une **valeur** : on la range dans `double`.", { double: "ƒ" }), S(5, "Premier appel : `carre(3)` empile un cadre, `x = 3`.", { x: 3 }, "", { push: "carre" }), S(2, "`3 * 3` → 9.", {}, "", { ret: 9, pop: true }), S(5, "Deuxième appel : `double(4)`.", { n: 4 }, "", { push: "double" }), S(4, "`4 * 2` → 8.", {}, "", { ret: 8, pop: true }), S(5, "`console.log` affiche les deux valeurs.", {}, "9 8\n")] }],
    quiz: [{ code: "const f = (a, b) => a + b;\nconsole.log(f(2, 3));", o: ["5", "23", "undefined", "NaN"], a: 0, why: "Avec des nombres, `+` additionne." }],
    ex: { prompt: "Écris `estPair(n)` qui renvoie un booléen. Lis `n` et affiche `oui` si pair, sinon `non`.", starter: "const n = Number(readline());\n", solution: "const estPair = (n) => n % 2 === 0;\nconst n = Number(readline());\nconsole.log(estPair(n) ? 'oui' : 'non');\n", hints: ["`n % 2 === 0`.", "`condition ? 'oui' : 'non'`."], tests: [{ in: "4", out: "oui" }, { in: "7", out: "non" }, { in: "0", out: "oui" }], checks: [["estPair", "estPair"]] },
  });
  A.add("js", {
    id: "arr", t: "Tableaux : map, filter, reduce", lv: 2, min: 7, why: "transformer des données sans boucle manuelle", when: "traiter des listes, des réponses d'API",
    stages: [{ t: "Chaîne de transformations", code: "const nombres = [1, 2, 3, 4];\nconst pairs = nombres.filter((n) => n % 2 === 0);\nconst carres = pairs.map((n) => n * n);\nconsole.log(carres);\n", notes: { 2: "`filter` garde les éléments pour lesquels la fonction renvoie vrai.", 3: "`map` applique la fonction à chaque élément et renvoie un **nouveau** tableau." },
      steps: [S(1, "Un tableau de 4 nombres.", { nombres: [1, 2, 3, 4] }), S(2, "`filter` teste chaque nombre : 1 ✗, 2 ✓, 3 ✗, 4 ✓.", { pairs: [2, 4] }), S(3, "`map` calcule le carré de chaque élément restant.", { carres: [4, 16] }), S(4, "Affichage.", {}, "[ 4, 16 ]\n")] }],
    quiz: [{ code: "console.log([1,2,3].map(x => x * 2));", o: ["[2, 4, 6]", "[1, 2, 3]", "6", "undefined"], a: 0, why: "`map` renvoie un nouveau tableau avec chaque valeur doublée." }],
    ex: { prompt: "Lis une ligne de nombres séparés par des espaces. Affiche la **somme des carrés des nombres impairs** (utilise `filter`, `map`, `reduce`).\n\nExemple : `1 2 3` → `10`", starter: "const nums = readline().split(' ').map(Number);\n", solution: "const nums = readline().split(' ').map(Number);\nconsole.log(nums.filter(n => n % 2 !== 0).map(n => n * n).reduce((a, b) => a + b, 0));\n", hints: ["`filter(n => n % 2 !== 0)` garde les impairs.", "`reduce((a, b) => a + b, 0)` somme tout."], tests: [{ in: "1 2 3", out: "10" }, { in: "2 4", out: "0" }, { in: "5", out: "25" }], checks: [["filter", "filter"], ["map", "map"]] },
  });
  A.add("js", {
    id: "obj", t: "Objets et références", lv: 3, min: 7, why: "comprendre quand on copie… et quand on partage", when: "quasi tous les bugs JS d'état partagé",
    stages: [
      { t: "Deux noms, un objet", code: 'const a = { nom: "Ada", pv: 10 };\nconst b = a;\nb.pv = 5;\nconsole.log(a.pv);\n', notes: { 2: "`b = a` copie la **référence**, pas l'objet." },
        steps: [S(1, "L'objet vit sur le **tas** ; `a` contient sa référence.", { a: "→ @1" }, "", { h: { "@1": '{ nom: "Ada", pv: 10 }' } }), S(2, "`b` reçoit la même référence : **un seul objet, deux noms**.", { b: "→ @1" }), S(3, "Modifier via `b`… modifie l'objet vu par `a`.", {}, "", { h: { "@1": '{ nom: "Ada", pv: 5 }' } }), S(4, "`a.pv` vaut 5 !", {}, "5\n")] },
      { t: "Vraie copie", code: "const a = { pv: 10 };\nconst c = { ...a };\nc.pv = 1;\nconsole.log(a.pv, c.pv);\n", notes: { 2: "`{ ...a }` crée un **nouvel** objet avec les mêmes champs (copie superficielle)." },
        steps: [S(1, "Objet n°1.", { a: "→ @1" }, "", { h: { "@1": "{ pv: 10 }" } }), S(2, "L'opérateur spread crée un **nouvel** objet n°2.", { c: "→ @2" }, "", { h: { "@2": "{ pv: 10 }" } }), S(3, "On ne modifie que le n°2.", {}, "", { h: { "@2": "{ pv: 1 }" } }), S(4, "Les deux objets sont indépendants.", {}, "10 1\n")] },
    ],
    quiz: [{ code: "const a = [1];\nconst b = a;\nb.push(2);\nconsole.log(a.length);", o: ["1", "2", "0", "undefined"], a: 1, why: "`a` et `b` désignent le même tableau." }],
    ex: { prompt: "Lis un nom puis un âge. Crée un objet `{ nom, age }` et affiche `NOM a AGE ans`.", starter: "const nom = readline();\nconst age = Number(readline());\n", solution: "const nom = readline();\nconst age = Number(readline());\nconst o = { nom, age };\nconsole.log(`${o.nom} a ${o.age} ans`);\n", hints: ["Raccourci : `{ nom, age }`.", "Chaîne modèle : `${o.nom} a ${o.age} ans`."], tests: [{ in: "Ada\n36", out: "Ada a 36 ans" }, { in: "Bob\n5", out: "Bob a 5 ans" }], checks: [["\\{", "un objet { }"]] },
  });
  A.add("js", {
    id: "clo", t: "Closures", lv: 4, min: 7, why: "garder un état privé dans une fonction", when: "compteurs, mémoïsation, modules, callbacks",
    stages: [{ t: "L'état qui survit", code: "function compteur() {\n  let n = 0;\n  return () => ++n;\n}\nconst c = compteur();\nc();\nconsole.log(c());\n", notes: { 3: "La fonction renvoyée **se souvient** de `n` : c'est une closure." },
      steps: [S(5, "On appelle `compteur()` : un cadre est empilé.", {}, "", { push: "compteur" }), S(2, "`n` = 0 vit dans ce cadre.", { n: 0 }), S(3, "On renvoie la fonction. Normalement `n` disparaîtrait avec le cadre… mais la fonction en a besoin : JS **déplace `n` dans un environnement sur le tas**.", {}, "", { ret: "ƒ", pop: true, h: { "@env": "{ n: 0 }" } }), S(5, "`c` = la fonction, reliée à l'environnement `@env`.", { c: "ƒ → @env" }), S(6, "`c()` : `++n` fait passer n à 1 (résultat ignoré).", {}, "", { push: "c", ret: 1, pop: true, h: { "@env": "{ n: 1 }" } }), S(7, "Deuxième appel : n passe à 2 et il est affiché.", {}, "2\n", { h: { "@env": "{ n: 2 }" } })] }],
    quiz: [{ code: "function f(){ let x = 0; return () => x++; }\nconst g = f();\ng(); g();\nconsole.log(g());", o: ["0", "1", "2", "3"], a: 2, why: "`x++` renvoie l'ancienne valeur : 0, 1, puis 2." }],
    ex: { prompt: "Écris `makeAdder(k)` qui renvoie une fonction ajoutant `k`. Lis `k` puis `x` et affiche `makeAdder(k)(x)`.", starter: "const k = Number(readline());\nconst x = Number(readline());\n", solution: "const makeAdder = (k) => (x) => x + k;\nconst k = Number(readline());\nconst x = Number(readline());\nconsole.log(makeAdder(k)(x));\n", hints: ["La fonction externe reçoit `k` et renvoie une fonction de `x`."], tests: [{ in: "2\n3", out: "5" }, { in: "10\n-4", out: "6" }], checks: [["makeAdder", "makeAdder"]] },
  });
  A.add("js", {
    id: "async", t: "Boucle d'événements et async", lv: 5, min: 9, why: "comprendre dans quel ordre le code s'exécute vraiment", when: "réseau, timers, interfaces : tout ce qui attend",
    stages: [{ t: "A D C B ?", code: 'console.log("A");\nsetTimeout(() => console.log("B"), 0);\nPromise.resolve().then(() => console.log("C"));\nconsole.log("D");\n', notes: { 2: "`setTimeout` envoie son callback dans la file des **macrotâches**.", 3: "`then` envoie son callback dans la file des **microtâches** (prioritaire)." },
      steps: [S(1, "Code **synchrone** : on exécute tout de suite.", {}, "A\n"), S(2, "Le timer est confié au navigateur. Son callback attendra dans la file des **macrotâches**, même avec 0 ms.", {}, "", { h: { "@macro": "callback → B" } }), S(3, "La promesse est déjà résolue : son `then` va dans la file des **microtâches**.", {}, "", { h: { "@micro": "callback → C" } }), S(4, "Toujours du synchrone : D passe **avant** B et C.", {}, "D\n"), S(3, "La pile est vide : l'event loop vide **d'abord les microtâches** → C.", {}, "C\n", { h: { "@micro": null } }), S(2, "Puis une macrotâche → B.", {}, "B\n", { h: { "@macro": null } })] }],
    quiz: [{ code: 'setTimeout(() => console.log(1), 0);\nconsole.log(2);', o: ["1 puis 2", "2 puis 1", "seulement 2", "Erreur"], a: 1, why: "Le callback du timer attend que la pile soit vide : « 2 » s'affiche d'abord." }],
    ex: { prompt: "Lis `n`. Avec une promesse (`Promise.resolve(n).then(...)`) ou `async/await`, affiche `n * 2`.", starter: "const n = Number(readline());\n", solution: "const n = Number(readline());\nPromise.resolve(n).then((v) => console.log(v * 2));\n", hints: ["`Promise.resolve(n).then(v => …)`."], tests: [{ in: "4", out: "8" }, { in: "21", out: "42" }], checks: [["then|await", "then ou await"]] },
  });
  A.templates = A.templates || {};
  A.templates.js = [{ n: "Hello", code: 'console.log("Hello, ENOS !");\n' }, { n: "map/filter", code: "const n = [1, 2, 3, 4, 5, 6];\nconsole.log(n.filter(x => x % 2).map(x => x * x));\n" }];
  A.sheets.js = `### JavaScript en 1 page
- Variables : \`const\` (par défaut), \`let\`. Évite \`var\`.
- Égalité : toujours \`===\`
- Tableaux : \`map\`, \`filter\`, \`reduce\`, \`find\`, \`some\`, \`every\`, \`[...a, x]\`
- Objets : \`{ a, b }\`, \`{ ...o }\`, \`Object.entries(o)\`, \`o?.x ?? 0\`
- Async : \`async/await\`, \`Promise.all([...])\`, \`fetch(url)\`
- Dans cette appli : \`readline()\` lit une ligne d'entrée.
### Réflexes d'expert
- Comprendre l'event loop : microtâches avant macrotâches
- Immutabilité : copie plutôt que mutation pour les états partagés`;
})();
