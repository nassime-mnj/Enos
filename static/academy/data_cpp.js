"use strict";
(() => {
  const A = ACAD, H = "#include <iostream>\n";
  A.add("cpp", {
    id: "hello", t: "cout, variables et auto", lv: 1, min: 5, why: "écrire du C moderne avec flux et inférence de type", when: "dès le premier programme C++",
    stages: [{ t: "Flux et types", code: H + "#include <string>\n\nint main() {\n    std::string nom = \"Ada\";\n    auto age = 36;\n    std::cout << nom << \" a \" << age << \" ans\\n\";\n    return 0;\n}\n", notes: { 5: "`std::string` gère la mémoire du texte pour toi.", 6: "`auto` : le compilateur déduit le type (`int` ici).", 7: "`<<` envoie des valeurs vers le flux de sortie." },
      steps: [S(5, "`std::string` copie le texte et gère sa mémoire (pas de `\\0` à surveiller).", { nom: '"Ada"' }), S(6, "`auto` : le type est **déduit à la compilation** (`int`), pas à l'exécution.", { age: "int 36" }), S(7, "Chaque `<<` ajoute un morceau au flux `cout`.", {}, "Ada a 36 ans\n")] }],
    quiz: [{ code: "auto x = 3 / 2;\nstd::cout << x;", o: ["1.5", "1", "2", "Erreur"], a: 1, why: "`3 / 2` est une division entière : `auto` déduit `int`, valeur 1." }],
    ex: { prompt: "Lis deux entiers avec `std::cin` et affiche leur somme.", starter: H + "int main() {\n    int a, b;\n    std::cin >> a >> b;\n    return 0;\n}\n", solution: H + "int main() {\n    int a, b;\n    std::cin >> a >> b;\n    std::cout << a + b << \"\\n\";\n    return 0;\n}\n", hints: ["`std::cout << a + b << \"\\n\";`"], tests: [{ in: "3 4", out: "7" }, { in: "10 -2", out: "8" }], checks: [["cout", "std::cout"]] },
  });
  A.add("cpp", {
    id: "vec", t: "vector et boucles for-range", lv: 2, min: 6, why: "un tableau dynamique sûr et pratique", when: "chaque fois qu'on aurait mis un tableau C",
    stages: [{ t: "vector", code: H + "#include <vector>\n\nint main() {\n    std::vector<int> v = {1, 2, 3};\n    v.push_back(4);\n    int somme = 0;\n    for (int x : v) somme += x;\n    std::cout << somme << \"\\n\";\n}\n", notes: { 5: "`vector` possède un tampon sur le **tas** et le libère tout seul.", 8: "`for (int x : v)` : une copie de chaque élément à tour de rôle." },
      steps: [S(5, "Le `vector` est un petit objet sur la pile qui **pointe vers un tampon sur le tas**.", { v: "→ @buf" }, "", { h: { "@buf": "int[3] = 1 2 3" } }), S(6, "`push_back` : si le tampon est plein, il est **réalloué** plus grand, les valeurs sont copiées.", {}, "", { h: { "@buf": "int[4] = 1 2 3 4" } }), S(7, "Accumulateur.", { somme: "int 0" }), S(8, "La boucle parcourt 1, 2, 3, 4 et additionne.", { somme: "int 10" }), S(9, "Affichage. À la sortie de `main`, le destructeur de `v` libère le tas **automatiquement** (RAII).", {}, "10\n", { h: { "@buf": null } })] }],
    quiz: [{ code: "std::vector<int> v(3);\nstd::cout << v[0];", o: ["0", "indéfini", "3", "Erreur"], a: 0, why: "`vector<int>(3)` crée 3 éléments initialisés à 0, contrairement à un tableau C brut." }],
    ex: { prompt: "Lis `n`, puis `n` entiers. Affiche leur maximum (utilise un `std::vector`).", starter: H + "#include <vector>\n\nint main() {\n    int n;\n    std::cin >> n;\n    std::vector<int> v(n);\n    for (int &x : v) std::cin >> x;\n    return 0;\n}\n", solution: H + "#include <vector>\n#include <algorithm>\n\nint main() {\n    int n;\n    std::cin >> n;\n    std::vector<int> v(n);\n    for (int &x : v) std::cin >> x;\n    std::cout << *std::max_element(v.begin(), v.end()) << \"\\n\";\n}\n", hints: ["`std::max_element(v.begin(), v.end())` renvoie un itérateur : déréférence-le avec `*`."], tests: [{ in: "3\n1 5 3", out: "5" }, { in: "1\n-7", out: "-7" }, { in: "4\n2 2 9 1", out: "9" }], checks: [["vector", "std::vector"]] },
  });
  A.add("cpp", {
    id: "ref", t: "Références et const", lv: 3, min: 6, why: "passer sans copier, modifier sans pointeur", when: "arguments de fonctions, gros objets",
    stages: [{ t: "Passage par référence", code: H + "void inc(int &n) {\n    n++;\n}\n\nint main() {\n    int v = 1;\n    inc(v);\n    std::cout << v << \"\\n\";\n}\n", notes: { 2: "`int &n` : `n` est un **autre nom** pour la variable de l'appelant (pas de copie).", 8: "On écrit `inc(v)`, pas `inc(&v)` : la référence est implicite." },
      steps: [S(7, "`v` = 1.", { v: "int 1" }), S(8, "`n` est une **référence** : alias de `v`.", { n: "& → v" }, "", { push: "inc" }), S(3, "`n++` modifie directement `v` dans `main`.", { "main.v": "int 2" }), S(4, "La référence disparaît, la modification reste.", {}, "", { pop: true }), S(9, "`v` vaut 2.", {}, "2\n")] }],
    quiz: [{ code: "void f(const std::string &s);", o: ["copie s", "lit s sans copier ni modifier", "modifie s", "libère s"], a: 1, why: "`const &` : passage sans copie et sans droit de modification : la forme idéale pour lire un gros objet." }],
    ex: { prompt: "Écris `void doubler(int &x)` qui double `x`. Lis `n`, appelle la fonction et affiche `n`.", starter: H + "void doubler(int &x) {\n}\n\nint main() {\n    int n;\n    std::cin >> n;\n    doubler(n);\n    std::cout << n << \"\\n\";\n}\n", solution: H + "void doubler(int &x) {\n    x *= 2;\n}\n\nint main() {\n    int n;\n    std::cin >> n;\n    doubler(n);\n    std::cout << n << \"\\n\";\n}\n", hints: ["`x *= 2;`"], tests: [{ in: "4", out: "8" }, { in: "-3", out: "-6" }], checks: [["&", "une référence &"]] },
  });
  A.add("cpp", {
    id: "raii", t: "Classes, constructeurs et RAII", lv: 4, min: 8, why: "lier la durée de vie d'une ressource à celle d'un objet", when: "fichiers, mémoire, verrous : tout ce qu'il faut libérer",
    stages: [{ t: "Constructeur / destructeur", code: H + "struct Garde {\n    Garde()  { std::cout << \"ouvre\\n\"; }\n    ~Garde() { std::cout << \"ferme\\n\"; }\n};\n\nint main() {\n    {\n        Garde g;\n        std::cout << \"travail\\n\";\n    }\n    std::cout << \"fin\\n\";\n}\n", notes: { 3: "Le **constructeur** s'exécute à la création de l'objet.", 4: "Le **destructeur** s'exécute à la sortie de la portée, même en cas d'exception." },
      steps: [S(9, "L'objet `g` est créé : son constructeur est appelé.", { g: "Garde" }, "ouvre\n"), S(10, "On travaille tranquillement avec la ressource.", {}, "travail\n"), S(11, "Accolade fermante : `g` sort de sa portée → le destructeur est appelé **automatiquement**.", { g: null }, "ferme\n"), S(12, "Le programme continue : rien à nettoyer à la main. C'est **RAII** (`unique_ptr`, `vector`, `fstream` fonctionnent ainsi).", {}, "fin\n")] }],
    quiz: [{ code: "{ std::vector<int> v(1000); }\n/* fuite mémoire ? */", o: ["Oui", "Non : le destructeur libère", "Seulement si exception", "Dépend du compilateur"], a: 1, why: "Le destructeur de `vector` libère le tas à la fermeture du bloc." }],
    ex: { prompt: "Crée `struct Compteur` avec un champ `n` initialisé à 0 et une méthode `inc()`. Lis `k` et appelle `inc()` `k` fois ; affiche `n`.", starter: H + "struct Compteur {\n};\n\nint main() {\n    int k;\n    std::cin >> k;\n}\n", solution: H + "struct Compteur {\n    int n = 0;\n    void inc() { n++; }\n};\n\nint main() {\n    int k;\n    std::cin >> k;\n    Compteur c;\n    for (int i = 0; i < k; i++) c.inc();\n    std::cout << c.n << \"\\n\";\n}\n", hints: ["`int n = 0;` dans la struct, et `void inc() { n++; }`."], tests: [{ in: "3", out: "3" }, { in: "0", out: "0" }, { in: "7", out: "7" }], checks: [["Compteur", "struct Compteur"], ["inc", "inc()"]] },
  });
  A.add("cpp", {
    id: "tpl", t: "Templates et STL", lv: 5, min: 8, why: "écrire du code générique aussi rapide que du code spécialisé", when: "conteneurs, algorithmes, bibliothèques",
    stages: [{ t: "Un template, trois types", code: H + "template <typename T>\nT plus_grand(T a, T b) {\n    return a > b ? a : b;\n}\n\nint main() {\n    std::cout << plus_grand(3, 9) << \" \" << plus_grand(2.5, 1.5) << \"\\n\";\n}\n", notes: { 2: "`T` est un **paramètre de type** : le compilateur fabrique une version par type utilisé.", 8: "Chaque appel force l'**instanciation** d'une fonction concrète (`int`, puis `double`)." },
      steps: [S(8, "À la **compilation**, `plus_grand<int>` est générée pour `(3, 9)`. Zéro coût à l'exécution.", { a: "int 3", b: "int 9" }, "", { push: "plus_grand<int>" }), S(4, "Le plus grand est 9.", {}, "", { ret: 9, pop: true }), S(8, "Autre appel : une 2ᵉ version, `plus_grand<double>`, est générée.", { a: "double 2.5", b: "double 1.5" }, "", { push: "plus_grand<double>" }), S(4, "2.5.", {}, "", { ret: 2.5, pop: true }), S(8, "Affichage des deux résultats.", {}, "9 2.5\n")] }],
    quiz: [{ code: "template<typename T> T f(T x){ return x; }\nauto r = f(2.0);", o: ["int", "double", "T", "Erreur"], a: 1, why: "`T` est déduit de l'argument : 2.0 est un `double`." }],
    ex: { prompt: "Écris un template `T carre(T x)`. Lis un entier `n` et affiche `carre(n)`.", starter: H + "int main() {\n    int n;\n    std::cin >> n;\n}\n", solution: H + "template <typename T>\nT carre(T x) {\n    return x * x;\n}\n\nint main() {\n    int n;\n    std::cin >> n;\n    std::cout << carre(n) << \"\\n\";\n}\n", hints: ["`template <typename T>` juste avant la fonction."], tests: [{ in: "5", out: "25" }, { in: "-4", out: "16" }], checks: [["template", "template"]] },
  });
  A.templates = A.templates || {};
  A.templates.cpp = [{ n: "Hello", code: H + 'int main() {\n    std::cout << "Hello, ENOS !\\n";\n}\n' }, { n: "STL", code: H + "#include <vector>\n#include <algorithm>\n\nint main() {\n    std::vector<int> v = {5, 2, 8, 1};\n    std::sort(v.begin(), v.end());\n    for (int x : v) std::cout << x << ' ';\n}\n" }];
  A.sheets.cpp = `### C++ en 1 page
- Flux : \`std::cout << x\`, \`std::cin >> x\`
- Texte : \`std::string\`, \`s.size()\`, \`s + "x"\`
- Conteneurs : \`vector\`, \`map\`, \`unordered_map\`, \`set\`, \`array\`
- Algorithmes : \`sort\`, \`find\`, \`accumulate\`, \`max_element\`
- Pointeurs intelligents : \`unique_ptr\`, \`shared_ptr\` (évite \`new/delete\`)
- Compiler : \`g++ -std=c++20 -Wall -Wextra -O2 main.cpp\`
### Réflexes d'expert
- RAII partout, \`const &\` pour les arguments en lecture
- Préférer \`vector\` et \`string\` aux tableaux C
- \`auto\` quand le type est évident, types explicites sinon`;
})();
