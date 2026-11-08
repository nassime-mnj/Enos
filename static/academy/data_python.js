"use strict";
(() => {
  const A = ACAD;
  A.add("python", {
    id: "vars", t: "Variables et affichage", lv: 1, min: 4, why: "stocker et montrer une valeur", when: "dès qu'un programme doit retenir quelque chose",
    stages: [
      { t: "Créer une variable", code: 'nom = "Ada"\nage = 36\nprint("Bonjour", nom)\n', notes: { 1: "`=` n'est pas « égal » : c'est une **affectation**. On range la valeur de droite dans le nom de gauche.", 2: "Python devine le type tout seul : ici un entier (`int`).", 3: "`print` écrit dans le terminal ; les virgules ajoutent un espace." },
        steps: [S(1, "On crée la variable `nom` et on y range le texte `\"Ada\"`. Python choisit le type (`str`) tout seul.", { nom: '"Ada"' }), S(2, "Nouvelle variable `age` : un entier. Les deux variables vivent maintenant dans la **pile** de `main`.", { age: 36 }), S(3, "`print` lit `nom` en mémoire et l'écrit à l'écran, séparé de `\"Bonjour\"` par un espace.", {}, "Bonjour Ada\n")] },
      { t: "Modifier une variable", code: 'nom = "Ada"\nage = 36\nage = age + 1\nprint(f"{nom} aura bientôt {age} ans")\n', notes: { 3: "À droite on **calcule** avec l'ancienne valeur, puis on range le résultat : l'ancienne est écrasée.", 4: "Une **f-string** (`f\"…\"`) insère des variables entre accolades." },
        steps: [S(1, "`nom` reçoit `\"Ada\"`.", { nom: '"Ada"' }), S(2, "`age` reçoit 36.", { age: 36 }), S(3, "On calcule d'abord `age + 1` = 37, **puis** on range 37 dans `age` : la case change de valeur.", { age: 37 }), S(4, "La f-string remplace `{nom}` et `{age}` par leurs valeurs actuelles.", {}, "Ada aura bientôt 37 ans\n")] },
    ],
    quiz: [{ code: "x = 5\nx = x * 2\nprint(x)", o: ["5", "10", "x * 2", "Erreur"], a: 1, why: "`x * 2` est calculé avec l'ancienne valeur (5) puis rangé dans `x`." }],
    ex: { prompt: "Lis **deux entiers** (un par ligne) et affiche leur **somme**.\n\nExemple : `3` puis `4` → `7`", starter: "a = int(input())\nb = int(input())\n# affiche la somme\n", solution: "a = int(input())\nb = int(input())\nprint(a + b)\n", hints: ["`input()` renvoie du texte : `int(...)` le convertit en nombre.", "Utilise `print(a + b)`."], tests: [{ in: "3\n4", out: "7" }, { in: "10\n-2", out: "8" }, { in: "0\n0", out: "0" }], checks: [["print", "print(...)"]] },
  });
  A.add("python", {
    id: "if", t: "Conditions : if / elif / else", lv: 1, min: 4, why: "prendre une décision", when: "quand le programme doit se comporter différemment selon une valeur",
    stages: [{ t: "Brancher le code", code: 'note = 14\nif note >= 16:\n    print("Excellent")\nelif note >= 10:\n    print("Reçu")\nelse:\n    print("Rattrapage")\n', notes: { 2: "Python teste les conditions **de haut en bas** et exécute le premier bloc vrai.", 3: "L'indentation (4 espaces) définit le bloc : c'est la syntaxe, pas du décor.", 4: "`elif` n'est testé que si les précédents étaient faux.", 6: "`else` : tout le reste." },
      steps: [S(1, "`note` vaut 14.", { note: 14 }), S(2, "`14 >= 16` ? **Faux** : on saute le bloc.", {}), S(4, "`14 >= 10` ? **Vrai** : on entre dans ce bloc.", {}), S(5, "On affiche « Reçu ». Le `else` est ignoré : un seul bloc s'exécute.", {}, "Reçu\n")] }],
    quiz: [{ code: "n = 7\nif n % 2 == 0:\n    print('pair')\nelse:\n    print('impair')", o: ["pair", "impair", "rien", "Erreur"], a: 1, why: "7 % 2 vaut 1, donc `== 0` est faux : on passe au `else`." }],
    ex: { prompt: "Lis un entier `n`. Affiche `pair` s'il est pair, sinon `impair`.", starter: "n = int(input())\n", solution: "n = int(input())\nif n % 2 == 0:\n    print('pair')\nelse:\n    print('impair')\n", hints: ["`n % 2` donne le reste de la division par 2.", "Teste `n % 2 == 0`."], tests: [{ in: "4", out: "pair" }, { in: "7", out: "impair" }, { in: "0", out: "pair" }], checks: [["if ", "if …:"]] },
  });
  A.add("python", {
    id: "loops", t: "Boucles : for et while", lv: 2, min: 6, why: "répéter sans copier-coller", when: "traiter une liste, compter, attendre une condition",
    stages: [
      { t: "for … in range", code: "total = 0\nfor i in range(1, 4):\n    total += i\nprint(total)\n", notes: { 2: "`range(1, 4)` produit 1, 2, 3 (la borne haute est **exclue**).", 3: "`+=` = « ajoute à ». Exécuté à chaque tour." },
        steps: [S(1, "L'accumulateur `total` part de 0.", { total: 0 }), S(2, "Tour 1 : `i` prend la valeur **1**.", { i: 1 }), S(3, "`total = 0 + 1`.", { total: 1 }), S(2, "Tour 2 : `i` = **2**.", { i: 2 }), S(3, "`total = 1 + 2`.", { total: 3 }), S(2, "Tour 3 : `i` = **3**, dernier tour.", { i: 3 }), S(3, "`total = 3 + 3`.", { total: 6 }), S(4, "La boucle est finie : on affiche le total.", {}, "6\n")] },
      { t: "while : tant que…", code: "n = 4\netapes = 0\nwhile n != 1:\n    n = n // 2\n    etapes += 1\nprint(etapes)\n", notes: { 3: "La condition est vérifiée **avant chaque tour**. Attention aux boucles infinies !", 4: "`//` : division entière." },
        steps: [S(1, "`n` = 4.", { n: 4 }), S(2, "Compteur à 0.", { etapes: 0 }), S(3, "`4 != 1` : vrai, on entre.", {}), S(4, "n devient 2.", { n: 2 }), S(5, "1 étape.", { etapes: 1 }), S(3, "`2 != 1` : vrai encore.", {}), S(4, "n devient 1.", { n: 1 }), S(5, "2 étapes.", { etapes: 2 }), S(3, "`1 != 1` : **faux** → on sort de la boucle.", {}), S(6, "Affiche le nombre de tours.", {}, "2\n")] },
    ],
    quiz: [{ code: "for i in range(3):\n    print(i)", o: ["1 2 3", "0 1 2", "0 1 2 3", "3"], a: 1, why: "`range(3)` commence à 0 et s'arrête **avant** 3." }],
    ex: { prompt: "Lis `n` et affiche la somme `1 + 2 + … + n`.", starter: "n = int(input())\n", solution: "n = int(input())\ns = 0\nfor i in range(1, n + 1):\n    s += i\nprint(s)\n", hints: ["Pars de `s = 0` puis ajoute chaque `i`.", "`range(1, n + 1)` inclut `n`."], tests: [{ in: "3", out: "6" }, { in: "10", out: "55" }, { in: "1", out: "1" }], checks: [["for |while ", "une boucle"]] },
  });
  A.add("python", {
    id: "coll", t: "Listes et dictionnaires", lv: 2, min: 6, why: "ranger plusieurs valeurs ensemble", when: "dès qu'il y a plus d'une donnée du même genre",
    stages: [{ t: "Liste + dict", code: 'fruits = ["pomme", "kiwi"]\nfruits.append("mangue")\nstock = {"pomme": 3}\nstock["kiwi"] = 5\nprint(len(fruits), stock["kiwi"])\n', notes: { 1: "Une **liste** garde l'ordre ; on accède aux éléments par position (0, 1, 2…).", 3: "Un **dict** associe une **clé** à une **valeur** : accès instantané par clé." },
      steps: [S(1, "La liste est un objet en mémoire ; `fruits` contient ses éléments indexés à partir de 0.", { fruits: ["pomme", "kiwi"] }), S(2, "`append` ajoute à la fin : la liste grandit sur place.", { fruits: ["pomme", "kiwi", "mangue"] }), S(3, "Un dictionnaire : la clé `\"pomme\"` pointe vers 3.", { stock: { k: "dict", v: [["pomme", 3]] } }), S(4, "On ajoute la clé `\"kiwi\"` associée à 5.", { stock: { k: "dict", v: [["pomme", 3], ["kiwi", 5]] } }), S(5, "`len(fruits)` = 3 et `stock[\"kiwi\"]` = 5.", {}, "3 5\n")] }],
    quiz: [{ code: "l = [10, 20, 30]\nprint(l[1])", o: ["10", "20", "30", "Erreur"], a: 1, why: "Les indices commencent à 0 : `l[1]` est le deuxième élément." }],
    ex: { prompt: "Lis une ligne de mots séparés par des espaces. Affiche le nombre de mots **distincts**.\n\nExemple : `a b a c` → `3`", starter: "mots = input().split()\n", solution: "mots = input().split()\nprint(len(set(mots)))\n", hints: ["`set(...)` supprime les doublons.", "`len(set(mots))`."], tests: [{ in: "a b a c", out: "3" }, { in: "x x x", out: "1" }, { in: "un deux trois", out: "3" }], checks: [] },
  });
  A.add("python", {
    id: "func", t: "Fonctions", lv: 3, min: 7, why: "donner un nom à un bloc réutilisable", when: "dès qu'un morceau de code sert deux fois ou mérite un nom",
    stages: [{ t: "Appel et pile", code: "def carre(x):\n    return x * x\n\na = carre(3)\nb = carre(a)\nprint(b)\n", notes: { 1: "`def` crée la fonction ; rien ne s'exécute encore.", 2: "`return` renvoie la valeur et **détruit** le cadre de la fonction.", 4: "Appeler une fonction empile un **cadre** avec ses paramètres." },
      steps: [S(1, "`def` enregistre la fonction `carre` : son corps n'est **pas** exécuté.", { carre: "ƒ carre" }), S(4, "On appelle `carre(3)` : un nouveau **cadre** est empilé, avec le paramètre `x = 3`.", { x: 3 }, "", { push: "carre" }), S(2, "`3 * 3` = 9 : la fonction renvoie 9 et son cadre va disparaître.", {}, "", { ret: 9, pop: true }), S(4, "De retour dans `main` : `a` reçoit 9.", { a: 9 }), S(5, "Deuxième appel avec `a` (9) : nouveau cadre, `x = 9`.", { x: 9 }, "", { push: "carre" }), S(2, "`9 * 9` = 81.", {}, "", { ret: 81, pop: true }), S(5, "`b` reçoit 81.", { b: 81 }), S(6, "On affiche `b`.", {}, "81\n")] }],
    quiz: [{ code: "def f(x):\n    x = x + 1\n    return x\n\ny = 5\nf(y)\nprint(y)", o: ["5", "6", "None", "Erreur"], a: 0, why: "`x` est une **copie locale** dans le cadre de `f` : `y` n'est pas modifié (et on ignore la valeur renvoyée)." }],
    ex: { prompt: "Écris une fonction `plus_grand(a, b)` qui renvoie le plus grand des deux, puis lis deux entiers (un par ligne) et affiche `plus_grand(a, b)`.", starter: "def plus_grand(a, b):\n    pass\n\nx = int(input())\ny = int(input())\nprint(plus_grand(x, y))\n", solution: "def plus_grand(a, b):\n    return a if a > b else b\n\nx = int(input())\ny = int(input())\nprint(plus_grand(x, y))\n", hints: ["Une fonction qui n'a pas de `return` renvoie `None`.", "`if a > b: return a`."], tests: [{ in: "3\n9", out: "9" }, { in: "9\n3", out: "9" }, { in: "-1\n-5", out: "-1" }], checks: [["def plus_grand", "def plus_grand"], ["return", "return"]] },
  });
  A.add("python", {
    id: "rec", t: "Récursivité", lv: 3, min: 8, why: "résoudre un problème en le réduisant à un plus petit", when: "arbres, découpages, structures qui se contiennent elles-mêmes",
    stages: [{ t: "La pile qui se remplit", code: "def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\n\nprint(fact(3))\n", notes: { 2: "Le **cas de base** : sans lui, la fonction s'appellerait à l'infini (RecursionError).", 4: "Le **cas récursif** : on réduit le problème (n - 1) et on se rappelle." },
      steps: [S(1, "On définit `fact`.", { fact: "ƒ fact" }), S(6, "Appel `fact(3)` : premier cadre empilé.", { n: 3 }, "", { push: "fact" }), S(2, "`3 <= 1` ? Non : il faut descendre.", {}), S(4, "`fact(3)` a besoin de `fact(2)` : on **empile** un 2ᵉ cadre.", { n: 2 }, "", { push: "fact" }), S(2, "`2 <= 1` ? Non.", {}), S(4, "`fact(2)` a besoin de `fact(1)` : 3ᵉ cadre.", { n: 1 }, "", { push: "fact" }), S(3, "Cas de base : `1 <= 1`. On renvoie 1 et on **dépile**.", {}, "", { ret: 1, pop: true }), S(4, "`fact(2)` reprend : 2 × 1 = 2, il renvoie 2.", {}, "", { ret: 2, pop: true }), S(4, "`fact(3)` reprend : 3 × 2 = 6.", {}, "", { ret: 6, pop: true }), S(6, "Tous les cadres sont dépilés ; on affiche 6.", {}, "6\n")] }],
    quiz: [{ code: "def f(n):\n    if n == 0:\n        return 0\n    return n + f(n - 1)\n\nprint(f(3))", o: ["3", "6", "0", "Erreur"], a: 1, why: "f(3) = 3 + f(2) = 3 + 2 + f(1) = 3 + 2 + 1 + f(0) = 6." }],
    ex: { prompt: "Lis `n` (≥ 0) et affiche `n!` (factorielle). `0! = 1`.", starter: "def fact(n):\n    pass\n\nprint(fact(int(input())))\n", solution: "def fact(n):\n    return 1 if n <= 1 else n * fact(n - 1)\n\nprint(fact(int(input())))\n", hints: ["Cas de base : `n <= 1` renvoie 1.", "Sinon `n * fact(n - 1)`."], tests: [{ in: "5", out: "120" }, { in: "0", out: "1" }, { in: "10", out: "3628800" }], checks: [["def fact", "def fact"]] },
  });
  A.add("python", {
    id: "oop", t: "Classes et objets", lv: 4, min: 8, why: "regrouper données et comportements", when: "modéliser des entités : joueur, fichier, connexion…",
    stages: [{ t: "Un objet sur le tas", code: 'class Chien:\n    def __init__(self, nom):\n        self.nom = nom\n\n    def aboie(self):\n        return self.nom + " : Wouf"\n\nrex = Chien("Rex")\nprint(rex.aboie())\n', notes: { 1: "Une **classe** est un plan de construction.", 2: "`__init__` : le constructeur, appelé à la création de l'objet.", 3: "`self.nom` : un attribut stocké **dans l'objet**.", 8: "Appeler `Chien(...)` crée l'objet sur le **tas** (heap)." },
      steps: [S(1, "La classe `Chien` est définie : c'est un plan, aucun chien n'existe encore.", {}), S(8, "`Chien(\"Rex\")` : Python réserve un objet vide sur le **tas**.", {}, "", { h: { "@1": "Chien{ }" } }), S(2, "Python appelle `__init__` avec `self` = l'objet fraîchement créé.", { self: "→ @1", nom: '"Rex"' }, "", { push: "__init__" }), S(3, "`self.nom = nom` écrit l'attribut dans l'objet du tas.", {}, "", { h: { "@1": 'Chien{ nom: "Rex" }' }, pop: true }), S(8, "La variable `rex` ne contient qu'une **référence** vers l'objet.", { rex: "→ @1" }), S(9, "`rex.aboie()` : méthode appelée avec `self` = l'objet.", { self: "→ @1" }, "", { push: "aboie" }), S(6, "On lit `self.nom` dans le tas et on construit le texte.", {}, "", { ret: '"Rex : Wouf"', pop: true }), S(9, "On affiche le texte renvoyé.", {}, "Rex : Wouf\n")] }],
    quiz: [{ code: "class A:\n    def __init__(self):\n        self.v = 1\n\na = A()\nb = a\nb.v = 5\nprint(a.v)", o: ["1", "5", "Erreur", "None"], a: 1, why: "`b = a` copie la **référence** : les deux noms désignent le même objet du tas." }],
    ex: { prompt: "Crée une classe `Rect` (`__init__(self, w, h)` + méthode `aire()`). Lis `w` puis `h` (une ligne chacun) et affiche l'aire.", starter: "class Rect:\n    pass\n\nw = int(input())\nh = int(input())\n", solution: "class Rect:\n    def __init__(self, w, h):\n        self.w = w\n        self.h = h\n    def aire(self):\n        return self.w * self.h\n\nw = int(input())\nh = int(input())\nprint(Rect(w, h).aire())\n", hints: ["Dans `__init__`, range `w` et `h` dans `self`.", "`aire` renvoie `self.w * self.h`."], tests: [{ in: "3\n4", out: "12" }, { in: "5\n5", out: "25" }], checks: [["class Rect", "class Rect"], ["def aire", "def aire"]] },
  });
  A.add("python", {
    id: "pro", t: "Python expert : compréhensions et lambdas", lv: 5, min: 7, why: "écrire court, lisible et rapide", when: "transformer, filtrer ou trier des collections",
    stages: [
      { t: "Compréhension de liste", code: "carres = [n * n for n in range(1, 5) if n % 2 == 0]\nprint(carres)\n", notes: { 1: "Lecture : « n × n **pour** chaque n de 1 à 4 **si** n est pair »." },
        steps: [S(1, "Un seul tour par valeur de `n` : on filtre avec `if`, on transforme avec `n * n`. n = 1 → impair, ignoré.", { n: 1, carres: [] }), S(1, "n = 2 → pair : on garde 4.", { n: 2, carres: [4] }), S(1, "n = 3 → ignoré.", { n: 3 }), S(1, "n = 4 → pair : on garde 16.", { n: 4, carres: [4, 16] }), S(2, "La liste finale est affichée.", {}, "[4, 16]\n")] },
      { t: "Trier avec une lambda", code: 'mots = ["kiwi", "ananas", "fig"]\nmots.sort(key=lambda m: len(m))\nprint(mots)\n', notes: { 2: "`key` reçoit une fonction qui donne la **clé de tri** de chaque élément. `lambda` = mini-fonction anonyme." },
        steps: [S(1, "Trois mots.", { mots: ["kiwi", "ananas", "fig"] }), S(2, "`sort` calcule `len(m)` pour chaque mot (4, 6, 3) puis trie d'après ces nombres.", { mots: ["fig", "kiwi", "ananas"] }), S(3, "Affichage de la liste triée sur place.", {}, "['fig', 'kiwi', 'ananas']\n")] },
    ],
    quiz: [{ code: "print([x for x in range(5) if x > 2])", o: ["[3, 4]", "[2, 3, 4]", "[0, 1, 2]", "[5]"], a: 0, why: "On garde seulement x > 2 parmi 0..4." }],
    ex: { prompt: "Lis `n` et affiche, séparés par des espaces, les carrés des **pairs** de 1 à `n`. Utilise une **compréhension de liste**.\n\nExemple : `6` → `4 16 36`", starter: "n = int(input())\n", solution: "n = int(input())\nprint(*[i * i for i in range(1, n + 1) if i % 2 == 0])\n", hints: ["Crée la liste avec `[ … for i in range(…) if … ]`.", "`print(*liste)` affiche les éléments séparés par un espace."], tests: [{ in: "6", out: "4 16 36" }, { in: "4", out: "4 16" }, { in: "1", out: "" }], checks: [["\\[.*for .* in .*\\]", "une compréhension [ … for … in … ]"]] },
  });
  A.templates = A.templates || {};
  A.templates.python = [{ n: "Hello", code: 'print("Hello, ENOS !")\n' }, { n: "Fibonacci", code: "def fib(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a\n\nfor i in range(8):\n    print(fib(i))\n" }, { n: "Classe + liste", code: "class Joueur:\n    def __init__(self, nom, pv=100):\n        self.nom, self.pv = nom, pv\n\nequipe = [Joueur('Ada'), Joueur('Linus', 80)]\nfor j in equipe:\n    print(j.nom, j.pv)\n" }];
  A.sheets.python = `### Python en 1 page
- Types : \`int\`, \`float\`, \`str\`, \`bool\`, \`list\`, \`dict\`, \`set\`, \`tuple\`
- Texte : \`f"{x:.2f}"\`, \`s.split()\`, \`" ".join(l)\`, \`s[1:4]\`
- Boucles : \`for x in l:\`, \`for i, x in enumerate(l):\`, \`while cond:\`
- Fonctions : \`def f(a, b=1, *args, **kw):\` · \`lambda x: x*2\`
- Listes : \`append\`, \`pop\`, \`sort(key=…)\`, \`sorted(l)\`, \`l[::-1]\`
- Dicts : \`d.get(k, 0)\`, \`d.items()\`, \`{k: v for …}\`
- Fichiers : \`with open(p) as f: data = f.read()\`
- Erreurs : \`try: … except ValueError as e: …\`
### Réflexes d'expert
- Mesurer avant d'optimiser : \`timeit\`, \`cProfile\`
- Préférer les compréhensions et \`set\` pour tester l'appartenance
- Typer : \`def f(x: int) -> str:\``;
})();
