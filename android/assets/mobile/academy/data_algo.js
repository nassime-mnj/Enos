"use strict";
// Vague « algorithmes » : recherche binaire et tri par insertion dans 5 langages (même trace, numéros de ligne propres à chaque langage) + 3 chapitres spécialisés.
(() => {
  const A = ACAD, X = String.raw;
  // ---- traces communes
  const binSteps = (L) => [
    S(L.tx, "Un tableau **trié** : c'est la condition de la recherche binaire.", { t: [1, 3, 5, 7, 9] }),
    S(L.init, "On cherche `7`. `lo` et `hi` encadrent la zone possible : tout le tableau (indices 0 à 4).", { x: 7, lo: 0, hi: 4 }),
    S(L.loop, "`lo <= hi` : la zone n'est pas vide, on continue.", {}),
    S(L.mid, "On regarde **au milieu** : `mid = (0 + 4) / 2 = 2`.", { mid: 2 }),
    S(L.eq, "`t[2]` vaut 5 : ce n'est pas 7.", {}),
    S(L.lt, "5 < 7 : la cible est forcément **à droite**. On peut jeter toute la moitié gauche d'un coup.", {}),
    S(L.lo, "`lo = mid + 1 = 3` : la zone possible passe de 5 à 2 cases.", { lo: 3 }),
    S(L.loop, "`3 <= 4` : on continue.", {}),
    S(L.mid, "Nouveau milieu : `(3 + 4) / 2 = 3`.", { mid: 3 }),
    S(L.eq, "`t[3]` vaut 7 : **trouvé** !", {}),
    S(L.found, "On affiche l'indice. En 2 comparaisons au lieu de 4 ; sur 1 million d'éléments il en faut ~20 seulement (**O(log n)**).", {}, "3\n"),
  ];
  const insSteps = (L) => [
    S(L.arr, "Un tableau désordonné. Le tri par insertion garde à gauche une partie **déjà triée** et y insère un élément à la fois.", { t: [3, 1, 2] }),
    S(L.outer, "`i = 1` : on prend `key = 1`, à insérer dans la partie triée `[3]`.", { i: 1, key: 1 }),
    S(L.shift, "`3 > 1` : on **décale** le 3 d'une case vers la droite pour faire de la place.", { t: [3, 3, 2], j: 0 }),
    S(L.place, "Plus rien à décaler : on dépose `key` dans le trou. Début trié : `[1, 3]`.", { t: [1, 3, 2] }),
    S(L.outer, "`i = 2` : `key = 2`.", { i: 2, key: 2 }),
    S(L.shift, "`3 > 2` : on décale le 3. Puis `1 > 2` est faux : on s'arrête.", { t: [1, 3, 3], j: 1 }),
    S(L.place, "On dépose `key` au bon endroit : tout est trié.", { t: [1, 2, 3] }),
    S(L.print, "Résultat final.", {}, "1 2 3\n"),
  ];
  const BIN = (w, h) => ({ why: "retrouver une valeur dans un tableau trié en quelques comparaisons", when: "tableaux triés, index, recherche dans de très grosses données", min: 8, lv: 4 });
  const bnotes = (n) => ({ [n.mid]: "Le milieu coupe la zone en deux : **à chaque tour on élimine la moitié** des candidats.", [n.loop]: "Tant que la zone `[lo, hi]` n'est pas vide, il reste des candidats." });
  const INS = { why: "ranger un tableau en insérant les éléments un par un", when: "petits tableaux ou presque triés (utilisé en interne par les tris de bibliothèque)", min: 8, lv: 4 };
  const inotes = (n) => ({ [n.shift]: "On **décale** les éléments plus grands que `key` pour libérer sa place.", [n.place]: "`key` est écrit à sa place définitive dans la partie triée." });
  const bq = [{ code: "t = [1, 3, 5, 7, 9, 11, 13, 15]\n# recherche binaire de 15 :\n# combien de comparaisons au maximum ?", q: "Environ combien de comparaisons pour 1 000 000 d'éléments triés ?", o: ["20", "1 000", "500 000", "1 000 000"], a: 0, why: "Chaque tour divise la zone par 2 : log₂(1 000 000) ≈ 20." }];
  const iq = [{ code: "t = [5, 4, 3, 2, 1]  # tri par insertion", q: "Quel est le pire cas pour le tri par insertion ?", o: ["Tableau trié à l'envers", "Tableau déjà trié", "Tableau vide", "Tous éléments égaux"], a: 0, why: "À l'envers, chaque élément doit être décalé au maximum : O(n²). Déjà trié : un seul passage O(n)." }];
  const PBIN = { in1: "5\n1 3 5 7 9\n7", t: [{ in: "5\n1 3 5 7 9\n7", out: "3" }, { in: "5\n1 3 5 7 9\n4", out: "-1" }, { in: "1\n5\n5", out: "0" }, { in: "6\n2 4 6 8 10 12\n12", out: "5" }] };
  const PINS = [{ in: "3\n3 1 2", out: "1 2 3" }, { in: "1\n5", out: "5" }, { in: "5\n5 4 3 2 1", out: "1 2 3 4 5" }, { in: "4\n2 2 1 1", out: "1 1 2 2" }];
  const bp = "Lis `n`, puis `n` entiers **triés** (ordre croissant), puis une valeur `x`. Affiche l'indice de `x` (à partir de 0) ou `-1` s'il est absent. Utilise la **recherche binaire**.";
  const ip = "Lis `n`, puis `n` entiers. Affiche-les **triés par ordre croissant** (séparés par des espaces) en écrivant toi-même un tri par insertion.";
  // ================================================================== PYTHON
  { const L = { tx: 1, init: 3, loop: 4, mid: 5, eq: 6, lt: 9, lo: 10, found: 7 };
    A.add("python", Object.assign({ id: "bin", t: "Recherche binaire", stages: [{ t: "Couper en deux", code: X`t = [1, 3, 5, 7, 9]
x = 7
lo, hi = 0, len(t) - 1
while lo <= hi:
    mid = (lo + hi) // 2
    if t[mid] == x:
        print(mid)
        break
    elif t[mid] < x:
        lo = mid + 1
    else:
        hi = mid - 1
`, notes: bnotes(L), steps: binSteps(L) }], quiz: bq,
    ex: { prompt: bp, starter: "n = int(input())\nt = list(map(int, input().split()))\nx = int(input())\n", solution: "n = int(input())\nt = list(map(int, input().split()))\nx = int(input())\nlo, hi, res = 0, n - 1, -1\nwhile lo <= hi:\n    mid = (lo + hi) // 2\n    if t[mid] == x:\n        res = mid\n        break\n    elif t[mid] < x:\n        lo = mid + 1\n    else:\n        hi = mid - 1\nprint(res)\n", hints: ["Garde `lo` et `hi`, calcule `mid`, puis compare `t[mid]` à `x`.", "Si `t[mid] < x`, la cible est à droite : `lo = mid + 1`."], tests: PBIN.t, checks: [["while", "while"]] } }, BIN()));
    const M = { arr: 1, outer: 3, shift: 6, place: 8, print: 9 };
    A.add("python", Object.assign({ id: "ins", t: "Tri par insertion", stages: [{ t: "Insérer un par un", code: X`t = [3, 1, 2]
for i in range(1, len(t)):
    key = t[i]
    j = i - 1
    while j >= 0 and t[j] > key:
        t[j + 1] = t[j]
        j -= 1
    t[j + 1] = key
print(*t)
`, notes: inotes(M), steps: insSteps(M) }], quiz: iq,
    ex: { prompt: ip, starter: "n = int(input())\nt = list(map(int, input().split()))\n", solution: "n = int(input())\nt = list(map(int, input().split()))\nfor i in range(1, n):\n    key = t[i]\n    j = i - 1\n    while j >= 0 and t[j] > key:\n        t[j + 1] = t[j]\n        j -= 1\n    t[j + 1] = key\nprint(*t)\n", hints: ["Pour chaque `i`, retiens `key = t[i]` puis décale les plus grands vers la droite.", "`print(*t)` affiche séparé par des espaces."], tests: PINS, checks: [["while", "while"]] } }, INS));
  }
  A.add("python", {
    id: "memo", t: "Complexité et mémoïsation", lv: 5, min: 9, why: "éviter de refaire 1000 fois le même calcul", when: "récursion avec sous-problèmes qui se répètent (programmation dynamique)",
    stages: [{ t: "fib avec cache", code: X`from functools import lru_cache

@lru_cache(maxsize=None)
def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

print(fib(4))
`, notes: { 3: "`lru_cache` mémorise le résultat de chaque appel : le même argument ne sera **jamais recalculé**.", 7: "Sans cache, cette ligne ferait ~2ⁿ appels (exponentiel). Avec cache : n appels (linéaire)." },
      steps: [S(9, "On appelle `fib(4)`.", { n: 4 }, "", { push: "fib" }), S(7, "`fib(4) = fib(3) + fib(2)` : on descend dans `fib(3)`.", { n: 3 }, "", { push: "fib" }), S(7, "`fib(3)` appelle `fib(2)`.", { n: 2 }, "", { push: "fib" }), S(7, "`fib(2)` appelle `fib(1)`.", { n: 1 }, "", { push: "fib" }), S(6, "Cas de base : `fib(1) = 1`, **rangé dans le cache**.", {}, "", { ret: 1, pop: true, h: { "cache": "{ 1: 1 }" } }), S(7, "`fib(2)` appelle ensuite `fib(0)`.", { n: 0 }, "", { push: "fib" }), S(6, "`fib(0) = 0`, mis en cache.", {}, "", { ret: 0, pop: true, h: { "cache": "{ 1: 1, 0: 0 }" } }), S(7, "`fib(2) = 1 + 0 = 1`, mis en cache.", {}, "", { ret: 1, pop: true, h: { "cache": "{ 1: 1, 0: 0, 2: 1 }" } }), S(7, "`fib(3)` a besoin de `fib(1)` : **déjà dans le cache**, aucun nouvel appel !", {}), S(7, "`fib(3) = 1 + 1 = 2`, mis en cache.", {}, "", { ret: 2, pop: true, h: { "cache": "{ 1: 1, 0: 0, 2: 1, 3: 2 }" } }), S(7, "`fib(4)` a besoin de `fib(2)` : encore dans le cache.", {}), S(7, "`fib(4) = 2 + 1 = 3`.", {}, "", { ret: 3, pop: true, h: { "cache": "{ …, 4: 3 }" } }), S(9, "Résultat. Chaque valeur n'a été calculée qu'**une fois**.", {}, "3\n")] }],
    quiz: [{ code: "# fib récursif SANS cache\nfib(40)", q: "Pourquoi fib(40) sans cache est-il très lent ?", o: ["Il recalcule les mêmes sous-problèmes des millions de fois", "Python est lent", "La pile est trop petite", "n est trop grand pour un int"], a: 0, why: "Le nombre d'appels croît comme ~1,6ⁿ : les mêmes valeurs sont recalculées sans cesse." }],
    ex: { prompt: "Lis `n` (jusqu'à 90) et affiche `fib(n)` avec `fib(0)=0`, `fib(1)=1`. Sans mémoïsation, `fib(50)` dépasserait le délai !", starter: "def fib(n):\n    pass\n\nprint(fib(int(input())))\n", solution: "from functools import lru_cache\n\n@lru_cache(maxsize=None)\ndef fib(n):\n    return n if n < 2 else fib(n - 1) + fib(n - 2)\n\nprint(fib(int(input())))\n", hints: ["`from functools import lru_cache` puis `@lru_cache(maxsize=None)` au-dessus de la fonction.", "Ou range les résultats dans un dictionnaire."], tests: [{ in: "10", out: "55" }, { in: "50", out: "12586269025" }, { in: "1", out: "1" }], checks: [["cache|memo|dict|\\{\\}", "un cache"]] },
  });
  // ================================================================== C
  { const CI = "#include <stdio.h>\n\n", L = { tx: 4, init: 5, loop: 6, mid: 7, eq: 8, lt: 11, lo: 12, found: 9 };
    A.add("c", Object.assign({ id: "bin", t: "Recherche binaire", stages: [{ t: "Couper en deux", code: CI + X`int main(void) {
    int t[] = {1, 3, 5, 7, 9};
    int x = 7, lo = 0, hi = 4;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        if (t[mid] == x) {
            printf("%d\n", mid);
            break;
        } else if (t[mid] < x) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return 0;
}
`, notes: bnotes(L), steps: binSteps(L) }], quiz: bq,
    ex: { prompt: bp, starter: CI + "int main(void) {\n    int n, x, t[1000];\n    scanf(\"%d\", &n);\n    for (int i = 0; i < n; i++) scanf(\"%d\", &t[i]);\n    scanf(\"%d\", &x);\n    return 0;\n}\n", solution: CI + X`int main(void) {
    int n, x, t[1000];
    scanf("%d", &n);
    for (int i = 0; i < n; i++) scanf("%d", &t[i]);
    scanf("%d", &x);
    int lo = 0, hi = n - 1, res = -1;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        if (t[mid] == x) { res = mid; break; }
        else if (t[mid] < x) lo = mid + 1;
        else hi = mid - 1;
    }
    printf("%d\n", res);
    return 0;
}
`, hints: ["Garde `lo` et `hi`, calcule `mid`, compare `t[mid]` à `x`."], tests: PBIN.t, checks: [["while", "while"]] } }, BIN()));
    const M = { arr: 4, outer: 6, shift: 8, place: 11, print: 13 };
    A.add("c", Object.assign({ id: "ins", t: "Tri par insertion", stages: [{ t: "Insérer un par un", code: CI + X`int main(void) {
    int t[] = {3, 1, 2};
    for (int i = 1; i < 3; i++) {
        int key = t[i], j = i - 1;
        while (j >= 0 && t[j] > key) {
            t[j + 1] = t[j];
            j--;
        }
        t[j + 1] = key;
    }
    for (int i = 0; i < 3; i++) printf("%d ", t[i]);
    printf("\n");
    return 0;
}
`, notes: inotes(M), steps: insSteps(M) }], quiz: iq,
    ex: { prompt: ip, starter: CI + "int main(void) {\n    int n, t[1000];\n    scanf(\"%d\", &n);\n    for (int i = 0; i < n; i++) scanf(\"%d\", &t[i]);\n    return 0;\n}\n", solution: CI + X`int main(void) {
    int n, t[1000];
    scanf("%d", &n);
    for (int i = 0; i < n; i++) scanf("%d", &t[i]);
    for (int i = 1; i < n; i++) {
        int key = t[i], j = i - 1;
        while (j >= 0 && t[j] > key) {
            t[j + 1] = t[j];
            j--;
        }
        t[j + 1] = key;
    }
    for (int i = 0; i < n; i++) printf("%d ", t[i]);
    printf("\n");
    return 0;
}
`, hints: ["Pour chaque `i`, retiens `key` puis décale les éléments plus grands."], tests: PINS, checks: [["while", "while"]] } }, INS));
  }
  A.add("c", {
    id: "fptr", t: "Pointeurs de fonction", lv: 5, min: 9, why: "passer un comportement en paramètre", when: "callbacks, tri personnalisé (qsort), tables de commandes, plug-ins",
    stages: [{ t: "Appeler via un pointeur", code: "#include <stdio.h>\n\n" + X`int double_(int x) { return x * 2; }
int carre(int x) { return x * x; }

int applique(int (*f)(int), int v) {
    return f(v);
}

int main(void) {
    printf("%d %d\n", applique(double_, 5), applique(carre, 5));
    return 0;
}
`, notes: { 6: "`int (*f)(int)` : `f` est un **pointeur vers une fonction** qui prend un `int` et renvoie un `int`.", 7: "`f(v)` appelle la fonction dont `f` contient l'adresse : on ne sait pas laquelle à l'écriture du code.", 11: "Le nom d'une fonction, sans parenthèses, **est** son adresse." },
      steps: [S(11, "`applique(double_, 5)` : `f` reçoit l'**adresse** de `double_` (le code vit en mémoire comme les données).", { f: "→ double_", v: "int 5" }, "", { push: "applique" }), S(7, "`f(v)` saute à l'adresse stockée : c'est `double_` qui s'exécute.", { x: "int 5" }, "", { push: "double_" }), S(3, "5 × 2 = 10.", {}, "", { ret: 10, pop: true }), S(7, "`applique` renvoie ce résultat.", {}, "", { ret: 10, pop: true }), S(11, "Deuxième appel : même fonction `applique`, mais `f` pointe vers `carre`.", { f: "→ carre", v: "int 5" }, "", { push: "applique" }), S(7, "`f(v)` appelle maintenant `carre`.", { x: "int 5" }, "", { push: "carre" }), S(4, "5 × 5 = 25.", {}, "", { ret: 25, pop: true }), S(7, "Résultat renvoyé.", {}, "", { ret: 25, pop: true }), S(11, "`printf` affiche les deux résultats.", {}, "10 25\n")] }],
    quiz: [{ code: "int (*f)(int) = carre;\nint r = f(3);", q: "Que contient r ?", o: ["9", "l'adresse de carre", "3", "Erreur"], a: 0, why: "`f` pointe vers `carre` : `f(3)` appelle `carre(3)` = 9." }],
    ex: { prompt: "Définis `double_` (×2) et `carre` (×²). Lis `n` et un caractère `op` (`d` ou `c`). Choisis la fonction avec un **pointeur de fonction** et affiche son résultat sur `n`.", starter: "#include <stdio.h>\n\nint double_(int x) { return x * 2; }\nint carre(int x) { return x * x; }\n\nint main(void) {\n    int n;\n    char op;\n    scanf(\"%d %c\", &n, &op);\n    return 0;\n}\n", solution: "#include <stdio.h>\n\nint double_(int x) { return x * 2; }\nint carre(int x) { return x * x; }\n\nint main(void) {\n    int n;\n    char op;\n    scanf(\"%d %c\", &n, &op);\n    int (*f)(int) = (op == 'd') ? double_ : carre;\n    printf(\"%d\\n\", f(n));\n    return 0;\n}\n", hints: ["Déclare `int (*f)(int)` et affecte-lui `double_` ou `carre`."], tests: [{ in: "5 d", out: "10" }, { in: "5 c", out: "25" }, { in: "-3 c", out: "9" }], checks: [["\\(\\*", "un pointeur de fonction (*f)"]] },
  });
  // ================================================================== C++
  { const L = { tx: 4, init: 5, loop: 6, mid: 7, eq: 8, lt: 11, lo: 12, found: 9 };
    A.add("cpp", Object.assign({ id: "bin", t: "Recherche binaire", stages: [{ t: "Couper en deux", code: X`#include <iostream>

int main() {
    int t[] = {1, 3, 5, 7, 9};
    int x = 7, lo = 0, hi = 4;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        if (t[mid] == x) {
            std::cout << mid << "\n";
            break;
        } else if (t[mid] < x) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
}
`, notes: bnotes(L), steps: binSteps(L) }], quiz: bq,
    ex: { prompt: bp + "\n\n(La STL propose `std::lower_bound`, mais ici écris la boucle toi-même.)", starter: "#include <iostream>\n#include <vector>\n\nint main() {\n    int n, x;\n    std::cin >> n;\n    std::vector<int> t(n);\n    for (int &v : t) std::cin >> v;\n    std::cin >> x;\n}\n", solution: "#include <iostream>\n#include <vector>\n\nint main() {\n    int n, x;\n    std::cin >> n;\n    std::vector<int> t(n);\n    for (int &v : t) std::cin >> v;\n    std::cin >> x;\n    int lo = 0, hi = n - 1, res = -1;\n    while (lo <= hi) {\n        int mid = (lo + hi) / 2;\n        if (t[mid] == x) { res = mid; break; }\n        else if (t[mid] < x) lo = mid + 1;\n        else hi = mid - 1;\n    }\n    std::cout << res << \"\\n\";\n}\n", hints: ["Même algorithme qu'en C, avec `std::vector`."], tests: PBIN.t, checks: [["while", "while"]] } }, BIN()));
    const M = { arr: 5, outer: 7, shift: 10, place: 13, print: 15 };
    A.add("cpp", Object.assign({ id: "ins", t: "Tri par insertion", stages: [{ t: "Insérer un par un", code: X`#include <iostream>
#include <vector>

int main() {
    std::vector<int> t = {3, 1, 2};
    for (size_t i = 1; i < t.size(); i++) {
        int key = t[i];
        int j = (int)i - 1;
        while (j >= 0 && t[j] > key) {
            t[j + 1] = t[j];
            j--;
        }
        t[j + 1] = key;
    }
    for (int x : t) std::cout << x << " ";
}
`, notes: inotes(M), steps: insSteps(M) }], quiz: iq,
    ex: { prompt: ip, starter: "#include <iostream>\n#include <vector>\n\nint main() {\n    int n;\n    std::cin >> n;\n    std::vector<int> t(n);\n    for (int &v : t) std::cin >> v;\n}\n", solution: "#include <iostream>\n#include <vector>\n\nint main() {\n    int n;\n    std::cin >> n;\n    std::vector<int> t(n);\n    for (int &v : t) std::cin >> v;\n    for (int i = 1; i < n; i++) {\n        int key = t[i], j = i - 1;\n        while (j >= 0 && t[j] > key) {\n            t[j + 1] = t[j];\n            j--;\n        }\n        t[j + 1] = key;\n    }\n    for (int x : t) std::cout << x << \" \";\n    std::cout << \"\\n\";\n}\n", hints: ["Même algorithme qu'en C."], tests: PINS, checks: [["while", "while"]] } }, INS));
  }
  // ================================================================== JAVA
  { const L = { tx: 3, init: 4, loop: 5, mid: 6, eq: 7, lt: 10, lo: 11, found: 8 };
    A.add("java", Object.assign({ id: "bin", t: "Recherche binaire", stages: [{ t: "Couper en deux", code: X`public class Main {
    public static void main(String[] args) {
        int[] t = {1, 3, 5, 7, 9};
        int x = 7, lo = 0, hi = t.length - 1;
        while (lo <= hi) {
            int mid = (lo + hi) / 2;
            if (t[mid] == x) {
                System.out.println(mid);
                break;
            } else if (t[mid] < x) {
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
    }
}
`, notes: bnotes(L), steps: binSteps(L) }], quiz: bq,
    ex: { prompt: bp + "\n\n(Java propose `Arrays.binarySearch`, mais écris la boucle toi-même.)", starter: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        int[] t = new int[n];\n        for (int i = 0; i < n; i++) t[i] = sc.nextInt();\n        int x = sc.nextInt();\n    }\n}\n", solution: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        int[] t = new int[n];\n        for (int i = 0; i < n; i++) t[i] = sc.nextInt();\n        int x = sc.nextInt();\n        int lo = 0, hi = n - 1, res = -1;\n        while (lo <= hi) {\n            int mid = (lo + hi) / 2;\n            if (t[mid] == x) { res = mid; break; }\n            else if (t[mid] < x) lo = mid + 1;\n            else hi = mid - 1;\n        }\n        System.out.println(res);\n    }\n}\n", hints: ["Garde `lo`, `hi`, `mid`, comme dans le cours."], tests: PBIN.t, checks: [["while", "while"]] } }, BIN()));
    const M = { arr: 3, outer: 5, shift: 7, place: 10, print: 12 };
    A.add("java", Object.assign({ id: "ins", t: "Tri par insertion", stages: [{ t: "Insérer un par un", code: X`public class Main {
    public static void main(String[] args) {
        int[] t = {3, 1, 2};
        for (int i = 1; i < t.length; i++) {
            int key = t[i], j = i - 1;
            while (j >= 0 && t[j] > key) {
                t[j + 1] = t[j];
                j--;
            }
            t[j + 1] = key;
        }
        System.out.println(t[0] + " " + t[1] + " " + t[2]);
    }
}
`, notes: inotes(M), steps: insSteps(M) }], quiz: iq,
    ex: { prompt: ip, starter: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        int[] t = new int[n];\n        for (int i = 0; i < n; i++) t[i] = sc.nextInt();\n    }\n}\n", solution: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        int[] t = new int[n];\n        for (int i = 0; i < n; i++) t[i] = sc.nextInt();\n        for (int i = 1; i < n; i++) {\n            int key = t[i], j = i - 1;\n            while (j >= 0 && t[j] > key) {\n                t[j + 1] = t[j];\n                j--;\n            }\n            t[j + 1] = key;\n        }\n        StringBuilder sb = new StringBuilder();\n        for (int x : t) sb.append(x).append(' ');\n        System.out.println(sb.toString().trim());\n    }\n}\n", hints: ["Même algorithme qu'en C ; `StringBuilder` pour assembler la sortie."], tests: PINS, checks: [["while", "while"]] } }, INS));
  }
  // ================================================================== JAVASCRIPT
  { const L = { tx: 1, init: 3, loop: 4, mid: 5, eq: 6, lt: 9, lo: 10, found: 7 };
    A.add("js", Object.assign({ id: "bin", t: "Recherche binaire", stages: [{ t: "Couper en deux", code: X`const t = [1, 3, 5, 7, 9];
const x = 7;
let lo = 0, hi = t.length - 1;
while (lo <= hi) {
  const mid = Math.floor((lo + hi) / 2);
  if (t[mid] === x) {
    console.log(mid);
    break;
  } else if (t[mid] < x) {
    lo = mid + 1;
  } else {
    hi = mid - 1;
  }
}
`, notes: bnotes(L), steps: binSteps(L) }], quiz: bq,
    ex: { prompt: bp + "\n\n(Lecture : `readline()` donne une ligne.)", starter: "const n = Number(readline());\nconst t = readline().split(' ').map(Number);\nconst x = Number(readline());\n", solution: "const n = Number(readline());\nconst t = readline().split(' ').map(Number);\nconst x = Number(readline());\nlet lo = 0, hi = n - 1, res = -1;\nwhile (lo <= hi) {\n  const mid = Math.floor((lo + hi) / 2);\n  if (t[mid] === x) { res = mid; break; }\n  else if (t[mid] < x) lo = mid + 1;\n  else hi = mid - 1;\n}\nconsole.log(res);\n", hints: ["`Math.floor((lo + hi) / 2)` pour le milieu."], tests: PBIN.t, checks: [["while", "while"]] } }, BIN()));
    const M = { arr: 1, outer: 3, shift: 6, place: 9, print: 11 };
    A.add("js", Object.assign({ id: "ins", t: "Tri par insertion", stages: [{ t: "Insérer un par un", code: X`const t = [3, 1, 2];
for (let i = 1; i < t.length; i++) {
  const key = t[i];
  let j = i - 1;
  while (j >= 0 && t[j] > key) {
    t[j + 1] = t[j];
    j--;
  }
  t[j + 1] = key;
}
console.log(t.join(" "));
`, notes: inotes(M), steps: insSteps(M) }], quiz: iq,
    ex: { prompt: ip, starter: "const n = Number(readline());\nconst t = readline().split(' ').map(Number);\n", solution: "const n = Number(readline());\nconst t = readline().split(' ').map(Number);\nfor (let i = 1; i < n; i++) {\n  const key = t[i];\n  let j = i - 1;\n  while (j >= 0 && t[j] > key) {\n    t[j + 1] = t[j];\n    j--;\n  }\n  t[j + 1] = key;\n}\nconsole.log(t.join(' '));\n", hints: ["Même algorithme qu'en Python."], tests: PINS, checks: [["while", "while"]] } }, INS));
  }
  // ================================================================== SHELL
  A.add("shell", {
    id: "read", t: "Lire un fichier ligne par ligne", lv: 3, min: 6, why: "traiter un fichier ou un flux, une ligne à la fois", when: "logs, listes, CSV, sorties de commandes",
    stages: [{ t: "while read", code: "#!/bin/bash\n" + X`printf "ada 36\nlinus 54\n" > gens.txt
while read nom age; do
  echo "$nom a $age ans"
done < gens.txt
`, notes: { 3: "`read nom age` lit **une ligne** et découpe sur les espaces : 1ᵉʳ mot dans `nom`, le reste dans `age`.", 5: "`< gens.txt` branche le fichier sur l'**entrée** de toute la boucle." },
      steps: [S(2, "Un fichier de deux lignes est créé.", {}, "", { h: { "gens.txt": "ada 36 ⏎ linus 54 ⏎" } }), S(3, "`read` consomme la 1ʳᵉ ligne et la découpe.", { nom: "ada", age: 36 }), S(4, "Le corps de la boucle s'exécute avec ces valeurs.", {}, "ada a 36 ans\n"), S(3, "Tour suivant : `read` lit la 2ᵉ ligne.", { nom: "linus", age: 54 }), S(4, "Même corps, nouvelles valeurs.", {}, "linus a 54 ans\n"), S(3, "`read` n'a plus rien à lire : il renvoie un code d'**échec** (fin de fichier) et la boucle s'arrête.", {}), S(5, "Fin de la boucle.", {})] }],
    quiz: [{ code: 'printf "a\\nb" | while read x; do echo "[$x]"; done', q: "Que s'affiche-t-il (la dernière ligne n'a pas de saut de ligne) ?", o: ["[a]", "[a] puis [b]", "[b]", "rien"], a: 0, why: "`read` renvoie un échec sur une dernière ligne sans `\\n` : elle est lue mais la boucle ne s'exécute pas. Astuce : `while read x || [ -n \"$x\" ]`." }],
    ex: { prompt: "Lis des lignes `nom note`. Pour chacune affiche `nom: OK` si la note est ≥ 10, sinon `nom: KO`.\n\nAttention : la dernière ligne peut ne pas finir par un saut de ligne !", starter: "#!/bin/bash\n", solution: "#!/bin/bash\nwhile read nom note || [ -n \"$nom\" ]; do\n  if [ \"$note\" -ge 10 ]; then echo \"$nom: OK\"; else echo \"$nom: KO\"; fi\ndone\n", hints: ["`while read nom note; do … done` lit l'entrée standard.", "Ajoute `|| [ -n \"$nom\" ]` pour ne pas perdre la dernière ligne."], tests: [{ in: "ada 12\nbob 8", out: "ada: OK\nbob: KO" }, { in: "zoe 10", out: "zoe: OK" }], checks: [["while", "while"], ["read", "read"]] },
  });
})();
