"use strict";
// Chapitres supplémentaires. Les codes utilisent String.raw : les antislashs (\n des printf) restent littéraux.
(() => {
  const A = ACAD, X = String.raw;
  const CI = X`#include <stdio.h>
`;
  // ================================================================== PYTHON
  A.add("python", {
    id: "str", t: "Chaînes de caractères", lv: 2, min: 5, why: "manipuler du texte : découper, chercher, transformer", when: "noms, messages, fichiers, protocoles : le texte est partout",
    stages: [{ t: "Indices et tranches", code: X`mot = "Python"
print(mot[0], mot[-1])
print(mot[1:4])
print(mot.upper() + "!" * 2)
`, notes: { 2: "Les indices commencent à 0 ; `-1` désigne le **dernier** caractère.", 3: "Une **tranche** `[début:fin]` inclut le début et **exclut** la fin.", 4: "Les chaînes sont **immuables** : `upper()` fabrique une nouvelle chaîne, `mot` ne change pas." },
      steps: [S(1, "Une chaîne est une suite de caractères numérotés depuis 0.", { mot: ["P", "y", "t", "h", "o", "n"] }), S(2, "`mot[0]` = `P`, `mot[-1]` compte depuis la fin = `n`.", {}, "P n\n"), S(3, "`mot[1:4]` prend les positions 1, 2, 3 (la 4 est exclue) : `yth`.", {}, "yth\n"), S(4, "`upper()` renvoie `PYTHON` ; `\"!\" * 2` répète le texte. `mot` reste inchangé.", {}, "PYTHON!!\n")] }],
    quiz: [{ code: 's = "abcdef"\nprint(s[2:])', o: ["cdef", "ab", "cde", "abcdef"], a: 0, why: "`s[2:]` va de la position 2 jusqu'à la fin." }],
    ex: { prompt: "Lis un mot et affiche-le **à l'envers**.", starter: "mot = input()\n", solution: "print(input()[::-1])\n", hints: ["Une tranche avec un pas négatif : `[::-1]`."], tests: [{ in: "abc", out: "cba" }, { in: "a", out: "a" }, { in: "radar", out: "radar" }, { in: "Python", out: "nohtyP" }], checks: [] },
  });
  A.add("python", {
    id: "exc", t: "Exceptions : try / except", lv: 3, min: 6, why: "gérer les erreurs sans faire planter le programme", when: "entrées utilisateur, fichiers, réseau : tout ce qui peut échouer",
    stages: [{ t: "Attraper une erreur", code: X`def diviser(a, b):
    try:
        return a / b
    except ZeroDivisionError:
        return None

print(diviser(6, 3))
print(diviser(1, 0))
`, notes: { 2: "Le code **risqué** va dans `try`.", 4: "Si cette erreur précise se produit, Python saute ici. Les autres erreurs ne sont pas attrapées." },
      steps: [S(1, "On définit `diviser`.", { diviser: "ƒ diviser" }), S(7, "Premier appel : `a = 6`, `b = 3`.", { a: 6, b: 3 }, "", { push: "diviser" }), S(3, "`6 / 3` se passe bien : on renvoie 2.0.", {}, "", { ret: 2.0, pop: true }), S(7, "On affiche le résultat.", {}, "2.0\n"), S(8, "Deuxième appel : `b = 0`.", { a: 1, b: 0 }, "", { push: "diviser" }), S(3, "`1 / 0` **lève** `ZeroDivisionError` : l'exécution normale s'interrompt immédiatement.", {}), S(4, "Python cherche un `except` compatible et saute dans ce bloc.", {}), S(5, "On renvoie `None` : l'erreur est gérée, le programme continue.", {}, "", { ret: "None", pop: true }), S(8, "On affiche `None`.", {}, "None\n")] }],
    quiz: [{ code: 'try:\n    int("x")\nexcept ValueError:\n    print("non")\nprint("fin")', o: ["non puis fin", "fin", "Erreur non gérée", "non"], a: 0, why: "`int(\"x\")` lève `ValueError`, attrapée : on affiche « non », puis le programme continue." }],
    ex: { prompt: "Lis deux entiers `a b` sur une ligne. Affiche `a // b`, ou `impossible` si `b` vaut 0 (utilise `try/except`).", starter: "a, b = map(int, input().split())\n", solution: "a, b = map(int, input().split())\ntry:\n    print(a // b)\nexcept ZeroDivisionError:\n    print('impossible')\n", hints: ["Mets `print(a // b)` dans `try`.", "`except ZeroDivisionError:`"], tests: [{ in: "6 3", out: "2" }, { in: "1 0", out: "impossible" }, { in: "7 2", out: "3" }], checks: [["try", "try"], ["except", "except"]] },
  });
  A.add("python", {
    id: "gen", t: "Générateurs et yield", lv: 5, min: 8, why: "produire des valeurs à la demande, sans tout stocker", when: "gros fichiers, flux infinis, pipelines de données",
    stages: [{ t: "Une fonction qui se met en pause", code: X`def compte(n):
    i = 0
    while i < n:
        yield i
        i += 1

for x in compte(3):
    print(x)
`, notes: { 4: "`yield` **suspend** la fonction en gardant toutes ses variables, et renvoie une valeur. Au prochain tour elle reprend juste après.", 7: "`for` demande les valeurs une par une." },
      steps: [S(7, "`compte(3)` n'exécute **rien** : elle crée un objet générateur en pause.", {}, "", { h: { "@gen": "compte(n=3) · pas démarré" } }), S(2, "Premier tour : le corps démarre.", { n: 3, i: 0 }, "", { push: "compte" }), S(4, "`yield 0` : la fonction **se met en pause** (état conservé) et donne 0 à la boucle.", {}, "", { ret: 0, pop: true, h: { "@gen": "en pause · n=3, i=0" } }), S(8, "La boucle reçoit `x = 0` et l'affiche.", { x: 0 }, "0\n"), S(5, "Tour suivant : le générateur **reprend après le yield** avec ses variables intactes.", { n: 3, i: 1 }, "", { push: "compte", h: { "@gen": "actif" } }), S(4, "`yield 1`.", {}, "", { ret: 1, pop: true, h: { "@gen": "en pause · n=3, i=1" } }), S(8, "`x = 1`.", { x: 1 }, "1\n"), S(5, "Reprise : `i` devient 2.", { n: 3, i: 2 }, "", { push: "compte" }), S(4, "`yield 2`.", {}, "", { ret: 2, pop: true, h: { "@gen": "en pause · n=3, i=2" } }), S(8, "`x = 2`.", { x: 2 }, "2\n"), S(5, "Reprise : `i` devient 3.", { n: 3, i: 3 }, "", { push: "compte" }), S(3, "`3 < 3` est faux : la fonction se termine → `StopIteration`, la boucle `for` s'arrête. Une seule valeur existait en mémoire à la fois.", {}, "", { pop: true, h: { "@gen": null } })] }],
    quiz: [{ code: "g = (x * x for x in range(3))\nprint(next(g), next(g))", o: ["0 1", "1 4", "0 1 4", "Erreur"], a: 0, why: "Chaque `next` calcule la valeur suivante à la demande : 0 puis 1." }],
    ex: { prompt: "Écris un **générateur** `carres(n)` qui produit `0², 1², …, (n-1)²` avec `yield`. Lis `n` et affiche chaque carré sur une ligne.", starter: "def carres(n):\n    pass\n\nfor c in carres(int(input())):\n    print(c)\n", solution: "def carres(n):\n    for i in range(n):\n        yield i * i\n\nfor c in carres(int(input())):\n    print(c)\n", hints: ["Dans une boucle `for i in range(n)`, fais `yield i * i`."], tests: [{ in: "3", out: "0\n1\n4" }, { in: "1", out: "0" }, { in: "5", out: "0\n1\n4\n9\n16" }], checks: [["yield", "yield"]] },
  });
  A.add("python", {
    id: "deco", t: "Décorateurs", lv: 5, min: 9, why: "ajouter un comportement à une fonction sans la modifier", when: "journalisation, cache, droits d'accès, mesure du temps",
    stages: [{ t: "Une fonction qui en enveloppe une autre", code: X`def chrono(f):
    def enveloppe(x):
        print("appel", f.__name__)
        return f(x)
    return enveloppe

@chrono
def double(x):
    return x * 2

print(double(4))
`, notes: { 7: "`@chrono` est un raccourci pour `double = chrono(double)`.", 2: "`enveloppe` **retient** `f` (une closure) : c'est ce qui permet de rappeler l'original.", 4: "On appelle la fonction d'origine à l'intérieur de l'enveloppe." },
      steps: [S(1, "On définit le décorateur `chrono` : une fonction qui reçoit une fonction.", { chrono: "ƒ chrono" }), S(8, "Python crée d'abord la fonction `double` d'origine.", { double: "ƒ double (originale)" }), S(7, "`@chrono` : Python appelle `chrono(double)`.", { f: "ƒ double" }, "", { push: "chrono" }), S(2, "`chrono` fabrique `enveloppe`, qui garde `f` en mémoire.", { enveloppe: "ƒ" }), S(5, "Elle renvoie `enveloppe`.", {}, "", { ret: "ƒ enveloppe", pop: true }), S(7, "Le nom `double` désigne maintenant l'**enveloppe** (qui contient l'originale).", { double: "ƒ enveloppe → f = double d'origine" }), S(11, "`double(4)` appelle en réalité `enveloppe(4)`.", { x: 4 }, "", { push: "enveloppe" }), S(3, "L'enveloppe ajoute son comportement : elle affiche un message.", {}, "appel double\n"), S(4, "Puis elle appelle `f(4)`, la vraie fonction.", { x: 4 }, "", { push: "double" }), S(9, "`4 * 2` = 8.", {}, "", { ret: 8, pop: true }), S(4, "L'enveloppe renvoie ce résultat.", {}, "", { ret: 8, pop: true }), S(11, "On affiche 8.", {}, "8\n")] }],
    quiz: [{ code: "def d(f):\n    def g():\n        return f() + 1\n    return g\n\n@d\ndef h():\n    return 1\n\nprint(h())", o: ["1", "2", "Erreur", "None"], a: 1, why: "`h` est remplacée par `g`, qui appelle l'ancienne `h` (1) puis ajoute 1." }],
    ex: { prompt: "Écris un décorateur `fort` qui met en **majuscules** le texte renvoyé par la fonction décorée. Lis un nom et affiche `saluer(nom)`.", starter: "def saluer(nom):\n    return 'bonjour ' + nom\n\nprint(saluer(input()))\n", solution: "def fort(f):\n    def g(x):\n        return f(x).upper()\n    return g\n\n@fort\ndef saluer(nom):\n    return 'bonjour ' + nom\n\nprint(saluer(input()))\n", hints: ["`fort(f)` renvoie une fonction `g(x)` qui appelle `f(x)` puis `.upper()`.", "Place `@fort` juste au-dessus de `def saluer`."], tests: [{ in: "ada", out: "BONJOUR ADA" }, { in: "Linus", out: "BONJOUR LINUS" }], checks: [["def fort", "def fort"], ["@fort", "@fort"]] },
  });
  // ================================================================== C
  A.add("c", {
    id: "switch", t: "switch et enum", lv: 2, min: 5, why: "choisir entre plusieurs cas nommés", when: "menus, états, codes d'erreur, commandes",
    stages: [{ t: "Un cas parmi plusieurs", code: CI + X`
enum Jour { LUN, MAR, MER };

int main(void) {
    enum Jour j = MAR;
    switch (j) {
        case LUN: printf("debut\n"); break;
        case MAR: printf("milieu\n"); break;
        default: printf("autre\n");
    }
    return 0;
}
`, notes: { 3: "Un `enum` donne des **noms** à des entiers : LUN = 0, MAR = 1, MER = 2.", 7: "`switch` compare la valeur à chaque `case`.", 8: "Sans `break`, l'exécution **continue** dans le cas suivant (fall-through) : piège classique." },
      steps: [S(6, "`MAR` vaut 1 : en mémoire, `j` est un simple entier.", { j: "enum 1 (MAR)" }), S(7, "`switch` saute directement au `case` qui vaut 1.", {}), S(9, "`MAR == 1` : c'est ce cas ! On affiche.", {}, "milieu\n"), S(9, "`break` quitte le `switch`. Sans lui, « autre » s'afficherait aussi.", {}), S(12, "Fin du programme.", {})] }],
    quiz: [{ code: '#include <stdio.h>\nint main(void){\n    switch (1) {\n        case 1: printf("a");\n        case 2: printf("b");\n    }\n    return 0;\n}', o: ["a", "ab", "b", "rien"], a: 1, why: "Pas de `break` : après `a`, l'exécution continue dans `case 2` (fall-through)." }],
    ex: { prompt: "Lis `n`. Avec un `switch`, affiche `un` pour 1, `deux` pour 2, `trois` pour 3, sinon `autre`.", starter: CI + "\nint main(void) {\n    int n;\n    scanf(\"%d\", &n);\n    return 0;\n}\n", solution: CI + X`
int main(void) {
    int n;
    scanf("%d", &n);
    switch (n) {
        case 1: printf("un\n"); break;
        case 2: printf("deux\n"); break;
        case 3: printf("trois\n"); break;
        default: printf("autre\n");
    }
    return 0;
}
`, hints: ["N'oublie pas `break` après chaque cas.", "`default:` couvre tout le reste."], tests: [{ in: "1", out: "un" }, { in: "3", out: "trois" }, { in: "7", out: "autre" }], checks: [["switch", "switch"]] },
  });
  A.add("c", {
    id: "str", t: "Chaînes et string.h", lv: 3, min: 7, why: "manipuler du texte sans déborder du tampon", when: "tout programme C qui lit, copie ou assemble du texte",
    stages: [{ t: "strcat et strlen", code: CI + X`#include <string.h>

int main(void) {
    char s[16] = "abc";
    strcat(s, "de");
    printf("%s %zu\n", s, strlen(s));
    return 0;
}
`, notes: { 5: "Le tableau a 16 cases : **tu** dois garantir qu'il y a assez de place pour la suite.", 6: "`strcat` colle à la fin ; **aucune vérification** de taille : trop de texte = débordement (buffer overflow).", 7: "`strlen` compte jusqu'au `\\0` (non compté)." },
      steps: [S(5, "\"abc\" occupe 4 cases (3 lettres + `\\0`) sur 16 ; le reste est indéterminé.", { s: ["a", "b", "c", "\\0", "?", "?"] }), S(6, "`strcat` cherche le `\\0`, écrit \"de\" à partir de là et remet un `\\0` à la fin.", { s: ["a", "b", "c", "d", "e", "\\0"] }), S(7, "`strlen` parcourt jusqu'au `\\0` : 5 caractères.", {}, "abcde 5\n")] }],
    quiz: [{ code: 'char s[4] = "abcd";', o: ["OK", "Pas de place pour le \\0 : erreur/UB", "s fait 5 cases", "s est vide"], a: 1, why: "\"abcd\" a besoin de **5** octets (4 lettres + `\\0`) : un tableau de 4 est trop petit." }],
    ex: { prompt: "Lis un mot (sans espace) avec `scanf(\"%s\", …)` dans un tableau de 100 caractères et affiche sa **longueur**.", starter: CI + "#include <string.h>\n\nint main(void) {\n    char mot[100];\n    return 0;\n}\n", solution: CI + X`#include <string.h>

int main(void) {
    char mot[100];
    scanf("%99s", mot);
    printf("%zu\n", strlen(mot));
    return 0;
}
`, hints: ["`scanf(\"%99s\", mot)` : le 99 protège du débordement.", "`strlen(mot)` donne la longueur."], tests: [{ in: "hello", out: "5" }, { in: "a", out: "1" }, { in: "ENOS2026", out: "8" }], checks: [["strlen", "strlen"]] },
  });
  A.add("c", {
    id: "list", t: "Liste chaînée", lv: 5, min: 10, why: "construire une structure qui grandit nœud par nœud", when: "files, piles, tables de hachage, arbres : toutes les structures dynamiques",
    stages: [{ t: "Deux nœuds sur le tas", code: CI + X`#include <stdlib.h>

struct Noeud {
    int val;
    struct Noeud *suiv;
};

int main(void) {
    struct Noeud *a = malloc(sizeof *a);
    a->val = 1;
    a->suiv = malloc(sizeof *a);
    a->suiv->val = 2;
    a->suiv->suiv = NULL;
    printf("%d %d\n", a->val, a->suiv->val);
    free(a->suiv);
    free(a);
    return 0;
}
`, notes: { 6: "Un nœud **contient un pointeur vers un nœud du même type** : c'est ce qui forme la chaîne.", 10: "`a->val` est un raccourci pour `(*a).val`.", 14: "`NULL` marque la **fin** de la liste.", 16: "Libérer dans le bon ordre : d'abord le suivant, puis le premier, sinon on perd l'adresse." },
      steps: [S(10, "`malloc` réserve un nœud sur le **tas** ; `a` en garde l'adresse.", { a: "→ @A" }, "", { h: { "@A": "Noeud { val: ?, suiv: ? }" } }), S(11, "On remplit la valeur du premier nœud.", {}, "", { h: { "@A": "Noeud { val: 1, suiv: ? }" } }), S(12, "Un 2ᵉ nœud est alloué ; le champ `suiv` du premier **pointe** vers lui.", {}, "", { h: { "@A": "Noeud { val: 1, suiv: → @B }", "@B": "Noeud { val: ?, suiv: ? }" } }), S(13, "Valeur du 2ᵉ nœud.", {}, "", { h: { "@B": "Noeud { val: 2, suiv: ? }" } }), S(14, "Le 2ᵉ nœud ne pointe sur rien : **fin de liste**.", {}, "", { h: { "@B": "Noeud { val: 2, suiv: NULL }" } }), S(15, "On suit les pointeurs : `a->val` puis `a->suiv->val`.", {}, "1 2\n"), S(16, "On libère d'abord le 2ᵉ nœud (sinon son adresse serait perdue).", {}, "", { h: { "@B": null, "@A": "Noeud { val: 1, suiv: ⚠ libéré }" } }), S(17, "Puis le premier : plus aucune fuite.", { a: "→ ⚠ libéré" }, "", { h: { "@A": null } })] }],
    quiz: [{ code: "struct N { int v; struct N *s; };\nstruct N *p = NULL;\np->v = 3;", o: ["OK", "Déréférencement de NULL : crash", "p devient valide", "Erreur de compilation"], a: 1, why: "Écrire via un pointeur NULL provoque un crash (segmentation fault)." }],
    ex: { prompt: "Lis `n`. Construis une liste chaînée en **insérant en tête** les valeurs `1, 2, …, n`, puis affiche-la du début à la fin (séparée par des espaces) : pour `3`, on obtient `3 2 1`. Libère les nœuds.", starter: CI + "#include <stdlib.h>\n\nstruct Noeud {\n    int val;\n    struct Noeud *suiv;\n};\n\nint main(void) {\n    int n;\n    scanf(\"%d\", &n);\n    struct Noeud *tete = NULL;\n    return 0;\n}\n", solution: CI + X`#include <stdlib.h>

struct Noeud {
    int val;
    struct Noeud *suiv;
};

int main(void) {
    int n;
    scanf("%d", &n);
    struct Noeud *tete = NULL;
    for (int i = 1; i <= n; i++) {
        struct Noeud *x = malloc(sizeof *x);
        x->val = i;
        x->suiv = tete;
        tete = x;
    }
    for (struct Noeud *p = tete; p; p = p->suiv) printf("%d ", p->val);
    printf("\n");
    while (tete) {
        struct Noeud *s = tete->suiv;
        free(tete);
        tete = s;
    }
    return 0;
}
`, hints: ["Insertion en tête : `x->suiv = tete; tete = x;`", "Pour libérer, garde `tete->suiv` **avant** de faire `free(tete)`."], tests: [{ in: "3", out: "3 2 1" }, { in: "1", out: "1" }, { in: "5", out: "5 4 3 2 1" }], checks: [["malloc", "malloc"], ["free", "free"], ["->suiv", "->suiv"]] },
  });
  // ================================================================== JAVASCRIPT
  A.add("js", {
    id: "str", t: "Chaînes et template literals", lv: 2, min: 5, why: "construire et analyser du texte", when: "messages, parsing, affichage",
    stages: [{ t: "Méthodes de chaîne", code: "const mot = \"Bonjour\";\nconsole.log(mot.length, mot.toUpperCase());\nconsole.log(mot.slice(0, 3));\nconsole.log(`${mot} le monde`.split(\" \").length);\n", notes: { 2: "Une chaîne a une propriété `length` et des méthodes ; elle est **immuable**.", 4: "Les **template literals** (accents graves) insèrent des expressions avec `${…}`." },
      steps: [S(1, "Une chaîne de 7 caractères.", { mot: '"Bonjour"' }), S(2, "`length` = 7 ; `toUpperCase()` renvoie une **nouvelle** chaîne.", {}, "7 BONJOUR\n"), S(3, "`slice(0, 3)` : de l'indice 0 inclus à 3 exclu.", {}, "Bon\n"), S(4, "On construit « Bonjour le monde », on la découpe sur les espaces : 3 mots.", {}, "3\n")] }],
    quiz: [{ code: "console.log('abc'.at(-1));", o: ["c", "a", "undefined", "b"], a: 0, why: "`at(-1)` renvoie le dernier caractère." }],
    ex: { prompt: "Lis une phrase et affiche son **nombre de mots**.", starter: "const phrase = readline();\n", solution: "const phrase = readline();\nconsole.log(phrase.trim().split(' ').length);\n", hints: ["`split(' ')` découpe en tableau ; prends sa `length`."], tests: [{ in: "a b c", out: "3" }, { in: "hello", out: "1" }, { in: "un deux trois quatre", out: "4" }], checks: [["split", "split"]] },
  });
  A.add("js", {
    id: "destr", t: "Destructuration et spread", lv: 3, min: 6, why: "extraire des valeurs d'un objet ou d'un tableau en une ligne", when: "paramètres de fonctions, réponses d'API, copies d'état",
    stages: [{ t: "Extraire", code: "const user = { nom: \"Ada\", age: 36, ville: \"Paris\" };\nconst { nom, age } = user;\nconst [premier, ...reste] = [1, 2, 3];\nconsole.log(nom, age, premier, reste);\n", notes: { 2: "`{ nom, age }` crée deux variables qui portent les noms des **clés**.", 3: "`...reste` ramasse **tous les éléments restants** dans un nouveau tableau." },
      steps: [S(1, "Un objet sur le tas.", { user: "→ @1" }, "", { h: { "@1": '{ nom: "Ada", age: 36, ville: "Paris" }' } }), S(2, "La destructuration copie `user.nom` et `user.age` dans deux variables ; `ville` est ignorée.", { nom: '"Ada"', age: 36 }), S(3, "`premier` reçoit 1 ; `...reste` collecte `[2, 3]`.", { premier: 1, reste: [2, 3] }), S(4, "Affichage des quatre variables.", {}, "Ada 36 1 [2,3]\n")] }],
    quiz: [{ code: "const [a, b] = [10, 20];\nconsole.log(b);", o: ["10", "20", "undefined", "[10,20]"], a: 1, why: "Le 2ᵉ élément du tableau va dans `b`." }],
    ex: { prompt: "Lis des nombres sur une ligne (séparés par des espaces) et affiche le **plus grand** avec `Math.max(...)` et l'opérateur spread.", starter: "const nums = readline().split(' ').map(Number);\n", solution: "const nums = readline().split(' ').map(Number);\nconsole.log(Math.max(...nums));\n", hints: ["`Math.max(...nums)` éclate le tableau en arguments."], tests: [{ in: "1 5 3", out: "5" }, { in: "-4 -9", out: "-4" }, { in: "7", out: "7" }], checks: [["\\.\\.\\.", "l'opérateur ... (spread)"]] },
  });
  A.add("js", {
    id: "cls", t: "Classes et prototypes", lv: 4, min: 8, why: "créer des objets qui partagent leurs méthodes", when: "modèles métier, composants, bibliothèques",
    stages: [{ t: "class en pratique", code: "class Chien {\n  constructor(nom) {\n    this.nom = nom;\n  }\n  aboie() {\n    return this.nom + \" : Wouf\";\n  }\n}\nconst rex = new Chien(\"Rex\");\nconsole.log(rex.aboie());\n", notes: { 2: "Le `constructor` s'exécute à chaque `new`.", 5: "Les méthodes vivent **une seule fois** sur `Chien.prototype`, partagées par toutes les instances." },
      steps: [S(1, "La classe est définie. Les méthodes sont rangées sur son **prototype**.", {}, "", { h: { "Chien.prototype": "{ aboie() }" } }), S(9, "`new Chien(\"Rex\")` crée un objet vide relié au prototype, puis appelle le constructeur.", {}, "", { push: "constructor", h: { "@1": "{ } → proto Chien.prototype" } }), S(3, "`this.nom = nom` écrit dans l'objet.", { this: "→ @1", nom: '"Rex"' }, "", { pop: true, h: { "@1": '{ nom: "Rex" } → proto Chien.prototype' } }), S(9, "`rex` référence l'objet.", { rex: "→ @1" }), S(10, "`rex.aboie()` : JS ne trouve pas `aboie` dans l'objet, **remonte au prototype** et l'appelle avec `this` = l'objet.", { this: "→ @1" }, "", { push: "aboie" }), S(6, "On lit `this.nom`.", {}, "", { ret: '"Rex : Wouf"', pop: true }), S(10, "Affichage.", {}, "Rex : Wouf\n")] }],
    quiz: [{ code: "class A { constructor(){ this.x = 1; } }\nconsole.log(typeof A);", o: ["function", "class", "object", "undefined"], a: 0, why: "Une classe JS est une fonction (constructeur) avec un prototype." }],
    ex: { prompt: "Crée une classe `Compteur` avec une propriété `valeur` (0 au départ) et une méthode `inc()`. Lis `k`, appelle `inc()` `k` fois et affiche `valeur`.", starter: "const k = Number(readline());\n", solution: "class Compteur {\n  constructor() { this.valeur = 0; }\n  inc() { this.valeur++; }\n}\nconst k = Number(readline());\nconst c = new Compteur();\nfor (let i = 0; i < k; i++) c.inc();\nconsole.log(c.valeur);\n", hints: ["Initialise `this.valeur = 0` dans le constructeur."], tests: [{ in: "3", out: "3" }, { in: "0", out: "0" }, { in: "7", out: "7" }], checks: [["class Compteur", "class Compteur"]] },
  });
  // ================================================================== C++
  A.add("cpp", {
    id: "map", t: "map et string", lv: 2, min: 6, why: "associer une clé à une valeur", when: "compter, indexer, dictionnaires",
    stages: [{ t: "std::map", code: X`#include <iostream>
#include <map>
#include <string>

int main() {
    std::map<std::string, int> age;
    age["Ada"] = 36;
    age["Linus"] = 54;
    std::cout << age["Ada"] << " " << age.size() << "\n";
}
`, notes: { 6: "`map` garde les clés **triées** ; chaque entrée est un couple (clé, valeur).", 7: "`age[\"Ada\"]` crée l'entrée si elle n'existe pas (valeur 0 par défaut)." },
      steps: [S(6, "Un `map` vide : sa structure interne (arbre équilibré) vit sur le **tas**.", { age: "map" }, "", { h: { "@map": "{ }" } }), S(7, "On ajoute la clé `\"Ada\"`.", {}, "", { h: { "@map": '{ "Ada": 36 }' } }), S(8, "Seconde clé, rangée dans l'ordre alphabétique.", {}, "", { h: { "@map": '{ "Ada": 36, "Linus": 54 }' } }), S(9, "Lecture de `age[\"Ada\"]` puis `size()`.", {}, "36 2\n")] }],
    quiz: [{ code: 'std::map<std::string,int> m;\nstd::cout << m["x"] << m.size();', o: ["01", "00", "Erreur", "1"], a: 0, why: "`m[\"x\"]` crée l'entrée avec la valeur 0 : on lit 0, et la taille devient 1." }],
    ex: { prompt: "Lis `n`, puis `n` mots, puis un mot `q`. Affiche combien de fois `q` apparaît parmi les `n` mots (avec un `std::map`).", starter: X`#include <iostream>
#include <map>
#include <string>

int main() {
    int n;
    std::cin >> n;
}
`, solution: X`#include <iostream>
#include <map>
#include <string>

int main() {
    int n;
    std::cin >> n;
    std::map<std::string, int> m;
    for (int i = 0; i < n; i++) {
        std::string w;
        std::cin >> w;
        m[w]++;
    }
    std::string q;
    std::cin >> q;
    std::cout << m[q] << "\n";
}
`, hints: ["`m[w]++` compte chaque mot."], tests: [{ in: "4\na b a c\na", out: "2" }, { in: "2\nx y\nz", out: "0" }, { in: "3\nk k k\nk", out: "3" }], checks: [["map", "std::map"]] },
  });
  A.add("cpp", {
    id: "uptr", t: "unique_ptr : la mémoire sans delete", lv: 4, min: 7, why: "avoir un propriétaire clair pour chaque ressource", when: "dès qu'on aurait écrit new / delete",
    stages: [{ t: "Propriété exclusive", code: X`#include <iostream>
#include <memory>

struct Ressource {
    Ressource()  { std::cout << "acquise\n"; }
    ~Ressource() { std::cout << "liberee\n"; }
};

int main() {
    auto p = std::make_unique<Ressource>();
    std::cout << "utilisation\n";
}
`, notes: { 10: "`make_unique` alloue sur le tas **et** construit l'objet ; `p` en est le **seul propriétaire**.", 12: "À l'accolade fermante, `p` est détruit : il appelle `delete` pour toi." },
      steps: [S(10, "Allocation sur le **tas** + construction : le constructeur s'exécute. `p` possède l'objet.", { p: "unique_ptr → @1" }, "acquise\n", { h: { "@1": "Ressource" } }), S(11, "On utilise la ressource normalement.", {}, "utilisation\n"), S(12, "Fin de `main` : le destructeur de `p` libère l'objet → son destructeur s'exécute. **Aucun `delete` écrit, aucune fuite possible.**", { p: null }, "liberee\n", { h: { "@1": null } })] }],
    quiz: [{ code: "auto a = std::make_unique<int>(1);\nauto b = a;", o: ["OK : b copie a", "Erreur de compilation : unique_ptr non copiable", "a devient nul", "b est nul"], a: 1, why: "Un `unique_ptr` ne peut pas être copié (un seul propriétaire) ; il se **déplace** avec `std::move(a)`." }],
    ex: { prompt: "Lis un entier `n`, range-le dans un `std::unique_ptr<int>` (avec `make_unique`) et affiche `*p * 2`.", starter: X`#include <iostream>
#include <memory>

int main() {
    int n;
    std::cin >> n;
}
`, solution: X`#include <iostream>
#include <memory>

int main() {
    int n;
    std::cin >> n;
    auto p = std::make_unique<int>(n);
    std::cout << *p * 2 << "\n";
}
`, hints: ["`std::make_unique<int>(n)`.", "`*p` donne la valeur pointée."], tests: [{ in: "4", out: "8" }, { in: "-3", out: "-6" }], checks: [["unique_ptr|make_unique", "unique_ptr"]] },
  });
  A.add("cpp", {
    id: "lambda", t: "Lambdas et algorithmes", lv: 4, min: 7, why: "décrire une opération en une ligne, au bon endroit", when: "tri, recherche, transformation de conteneurs",
    stages: [{ t: "sort avec une lambda", code: X`#include <iostream>
#include <vector>
#include <algorithm>

int main() {
    std::vector<int> v = {3, 1, 2};
    std::sort(v.begin(), v.end(), [](int a, int b) { return a > b; });
    for (int x : v) std::cout << x << " ";
}
`, notes: { 7: "`[](int a, int b) { … }` est une fonction **anonyme** : `[]` = ce qu'elle capture de l'extérieur (ici rien).", 8: "Parcours simple du conteneur." },
      steps: [S(6, "Un vecteur de 3 entiers.", { v: [3, 1, 2] }), S(7, "`sort` compare les éléments deux à deux **avec ta lambda** : « a avant b si a > b » → ordre décroissant.", { v: [3, 2, 1] }), S(8, "Affichage dans l'ordre obtenu.", {}, "3 2 1 \n")] }],
    quiz: [{ code: "int k = 2;\nauto f = [k](int x){ return x * k; };\nstd::cout << f(5);", o: ["10", "5", "2", "Erreur"], a: 0, why: "`[k]` **capture** k par copie : la lambda l'utilise à l'intérieur." }],
    ex: { prompt: "Lis `n`, puis `n` entiers. Affiche-les triés par ordre **décroissant**, séparés par un espace (utilise `std::sort` avec une lambda).", starter: X`#include <iostream>
#include <vector>
#include <algorithm>

int main() {
    int n;
    std::cin >> n;
    std::vector<int> v(n);
    for (int &x : v) std::cin >> x;
}
`, solution: X`#include <iostream>
#include <vector>
#include <algorithm>

int main() {
    int n;
    std::cin >> n;
    std::vector<int> v(n);
    for (int &x : v) std::cin >> x;
    std::sort(v.begin(), v.end(), [](int a, int b) { return a > b; });
    for (int x : v) std::cout << x << " ";
    std::cout << "\n";
}
`, hints: ["Le 3ᵉ argument de `sort` est la lambda de comparaison."], tests: [{ in: "3\n1 3 2", out: "3 2 1" }, { in: "1\n5", out: "5" }, { in: "4\n2 9 2 7", out: "9 7 2 2" }], checks: [["\\[\\]", "une lambda [](…)"]] },
  });
  // ================================================================== JAVA
  A.add("java", {
    id: "coll", t: "ArrayList, HashMap et HashSet", lv: 3, min: 7, why: "stocker des données de taille variable avec les bons outils", when: "presque tout programme Java réel",
    stages: [{ t: "Liste et dictionnaire", code: X`import java.util.*;

public class Main {
    public static void main(String[] args) {
        List<String> noms = new ArrayList<>();
        noms.add("Ada");
        noms.add("Linus");
        Map<String, Integer> age = new HashMap<>();
        age.put("Ada", 36);
        System.out.println(noms.size() + " " + age.get("Ada"));
    }
}
`, notes: { 5: "On déclare le type par l'**interface** (`List`) et on instancie la classe (`ArrayList`).", 8: "`Map<Clé, Valeur>` : accès par clé en temps quasi constant." },
      steps: [S(5, "Une `ArrayList` vide sur le tas.", { noms: "→ @1" }, "", { h: { "@1": "ArrayList []" } }), S(6, "`add` ajoute à la fin.", {}, "", { h: { "@1": 'ArrayList ["Ada"]' } }), S(7, "Deuxième élément.", {}, "", { h: { "@1": 'ArrayList ["Ada", "Linus"]' } }), S(8, "Une `HashMap` vide.", { age: "→ @2" }, "", { h: { "@2": "HashMap {}" } }), S(9, "`put` associe la clé « Ada » à 36.", {}, "", { h: { "@2": 'HashMap { "Ada": 36 }' } }), S(10, "Taille de la liste et valeur de la clé.", {}, "2 36\n")] }],
    quiz: [{ code: "Set<Integer> s = new HashSet<>();\ns.add(1); s.add(1);\nSystem.out.println(s.size());", o: ["1", "2", "0", "Erreur"], a: 0, why: "Un `Set` ne garde **pas de doublons**." }],
    ex: { prompt: "Lis `n`, puis `n` mots. Affiche le nombre de mots **distincts** (utilise un `HashSet`).", starter: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n    }\n}\n", solution: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        Set<String> s = new HashSet<>();\n        for (int i = 0; i < n; i++) s.add(sc.next());\n        System.out.println(s.size());\n    }\n}\n", hints: ["`sc.next()` lit un mot.", "`s.add(mot)` ignore les doublons ; `s.size()` compte."], tests: [{ in: "4\na b a c", out: "3" }, { in: "2\nx x", out: "1" }, { in: "3\nun deux trois", out: "3" }], checks: [["Set", "Set"]] },
  });
  A.add("java", {
    id: "exc", t: "Exceptions : try / catch", lv: 3, min: 6, why: "réagir proprement quand quelque chose échoue", when: "E/S, saisies, réseau, conversions",
    stages: [{ t: "Attraper une exception", code: X`public class Main {
    static int diviser(int a, int b) {
        return a / b;
    }

    public static void main(String[] args) {
        try {
            System.out.println(diviser(6, 0));
        } catch (ArithmeticException e) {
            System.out.println("Division par zero");
        }
    }
}
`, notes: { 3: "Diviser un entier par 0 lève `ArithmeticException`.", 9: "Le `catch` ne s'exécute que pour ce type d'exception (ou un sous-type)." },
      steps: [S(8, "Dans le `try`, on appelle `diviser(6, 0)`.", { a: 6, b: 0 }, "", { push: "diviser" }), S(3, "`6 / 0` **lève** une `ArithmeticException` : la JVM abandonne la méthode et **remonte la pile** à la recherche d'un `catch`.", {}, "", { pop: true }), S(9, "Le `catch` correspond au type de l'exception : il s'exécute.", { e: "ArithmeticException" }), S(10, "On affiche un message au lieu de planter.", {}, "Division par zero\n")] }],
    quiz: [{ code: "try { int[] t = new int[2]; t[5] = 1; }\ncatch (ArrayIndexOutOfBoundsException e) { System.out.print(\"x\"); }\nSystem.out.print(\"y\");", o: ["xy", "y", "x", "Erreur non gérée"], a: 0, why: "L'exception est attrapée (« x »), puis le programme continue (« y »)." }],
    ex: { prompt: "Lis deux entiers `a b`. Affiche `a / b` (division entière) ou `impossible` si `b` vaut 0, grâce à `try/catch`.", starter: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int a = sc.nextInt(), b = sc.nextInt();\n    }\n}\n", solution: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int a = sc.nextInt(), b = sc.nextInt();\n        try {\n            System.out.println(a / b);\n        } catch (ArithmeticException e) {\n            System.out.println(\"impossible\");\n        }\n    }\n}\n", hints: ["Mets `System.out.println(a / b)` dans `try`."], tests: [{ in: "6 3", out: "2" }, { in: "1 0", out: "impossible" }, { in: "7 2", out: "3" }], checks: [["try", "try"], ["catch", "catch"]] },
  });
  A.add("java", {
    id: "stream", t: "Streams", lv: 4, min: 7, why: "transformer des collections de façon déclarative", when: "filtrer, trier, agréger des données",
    stages: [{ t: "filter → map → sum", code: X`import java.util.*;

public class Main {
    public static void main(String[] args) {
        List<Integer> l = List.of(1, 2, 3, 4);
        int s = l.stream().filter(x -> x % 2 == 0).mapToInt(x -> x * x).sum();
        System.out.println(s);
    }
}
`, notes: { 6: "Un **pipeline** : source → opérations intermédiaires (paresseuses) → opération terminale (`sum`) qui déclenche tout.", 5: "`List.of` crée une liste **immuable**." },
      steps: [S(5, "Une liste immuable de 4 entiers.", { l: "→ @1" }, "", { h: { "@1": "List [1, 2, 3, 4]" } }), S(6, "`filter` garde les pairs : 2 et 4.", { s: "…" }, "", { h: { "flux": "2, 4" } }), S(6, "`mapToInt` élève au carré : 4 et 16.", {}, "", { h: { "flux": "4, 16" } }), S(6, "`sum` (terminale) déclenche le calcul : 4 + 16 = 20.", { s: 20 }, "", { h: { "flux": null } }), S(7, "Affichage.", {}, "20\n")] }],
    quiz: [{ code: "List.of(1,2,3).stream().map(x -> x * 2).toList();", o: ["[2, 4, 6]", "[1, 2, 3]", "6", "Erreur"], a: 0, why: "`map` transforme chaque élément ; `toList()` collecte le résultat." }],
    ex: { prompt: "Lis `n`, puis `n` entiers. Affiche la **somme des carrés des nombres impairs** avec un stream.", starter: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        List<Integer> l = new ArrayList<>();\n        for (int i = 0; i < n; i++) l.add(sc.nextInt());\n    }\n}\n", solution: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        List<Integer> l = new ArrayList<>();\n        for (int i = 0; i < n; i++) l.add(sc.nextInt());\n        System.out.println(l.stream().filter(x -> x % 2 != 0).mapToInt(x -> x * x).sum());\n    }\n}\n", hints: ["`l.stream().filter(...).mapToInt(...).sum()`"], tests: [{ in: "3\n1 2 3", out: "10" }, { in: "2\n2 4", out: "0" }, { in: "1\n5", out: "25" }], checks: [["stream", "stream()"]] },
  });
  // ================================================================== SHELL
  const B = "#!/bin/bash\n";
  A.add("shell", {
    id: "case", t: "case : choisir selon un motif", lv: 2, min: 5, why: "aiguiller un script selon une commande ou une option", when: "scripts à sous-commandes (start, stop…), menus",
    stages: [{ t: "case / esac", code: B + 'cmd="${1:-stop}"\n' + X`case "$cmd" in
  start) echo "demarrage" ;;
  stop)  echo "arret" ;;
  *)     echo "inconnu" ;;
esac
`, notes: { 2: "`${1:-stop}` : le 1ᵉʳ argument, ou `stop` s'il est absent.", 3: "`case` compare la valeur à des **motifs** (jokers acceptés).", 6: "`*` attrape tout ce qui n'a pas correspondu avant (comme `default`)." },
      steps: [S(2, "Aucun argument n'est donné : la valeur par défaut `stop` est utilisée.", { cmd: "stop" }), S(3, "`case` teste les motifs **dans l'ordre**.", {}), S(4, "`start` ≠ `stop` : on passe.", {}), S(5, "`stop` correspond : on exécute son bloc jusqu'au `;;`.", {}, "arret\n"), S(7, "`esac` ferme le `case`. Le motif `*` n'est jamais atteint.", {})] }],
    quiz: [{ code: 'x=abc\ncase "$x" in\n  a*) echo A ;;\n  *)  echo B ;;\nesac', o: ["A", "B", "AB", "rien"], a: 0, why: "Le motif `a*` correspond à tout ce qui commence par `a`." }],
    ex: { prompt: "Lis un mot. Avec `case` : `oui` ou `o` → `ok` ; `non` → `ko` ; tout autre → `?`.", starter: B + "read mot\n", solution: B + X`read mot
case "$mot" in
  oui|o) echo ok ;;
  non)   echo ko ;;
  *)     echo "?" ;;
esac
`, hints: ["Plusieurs motifs séparés par `|` : `oui|o)`."], tests: [{ in: "oui", out: "ok" }, { in: "o", out: "ok" }, { in: "non", out: "ko" }, { in: "peut-etre", out: "?" }], checks: [["case", "case"]] },
  });
  A.add("shell", {
    id: "grep", t: "grep et sed", lv: 3, min: 6, why: "filtrer et réécrire du texte en ligne de commande", when: "logs, configuration, extraction de données",
    stages: [{ t: "Filtrer puis transformer", code: B + X`printf "erreur: disque\ninfo: ok\nerreur: reseau\n" > log.txt
grep erreur log.txt | sed 's/erreur: //'
`, notes: { 3: "`grep motif` garde les lignes qui **contiennent** le motif ; puis `sed 's/ancien/nouveau/'` remplace la **1ʳᵉ** occurrence de chaque ligne." },
      steps: [S(2, "Un fichier de log de 3 lignes est créé.", {}, "", { h: { "log.txt": "erreur: disque ⏎ info: ok ⏎ erreur: reseau" } }), S(3, "`grep` ne laisse passer que les lignes contenant « erreur » : « info: ok » est éliminée.", {}, "", { h: { "tube": "erreur: disque ⏎ erreur: reseau" } }), S(3, "`sed` supprime « erreur: » (remplacé par rien) sur chaque ligne.", {}, "disque\nreseau\n", { h: { "tube": null } })] }],
    quiz: [{ code: "echo aaa | sed 's/a/b/'", o: ["baa", "bbb", "aaa", "b"], a: 0, why: "Sans le drapeau `g`, seule la 1ʳᵉ occurrence est remplacée." }],
    ex: { prompt: "Lis des lignes. Garde celles qui contiennent `err`, en remplaçant `err` par `ERR`.\n\nExemple : `err1`, `fine`, `err2` → `ERR1`, `ERR2`.", starter: B + "", solution: B + "grep err | sed 's/err/ERR/'\n", hints: ["Enchaîne `grep` et `sed` avec un tube."], tests: [{ in: "err1\nfine\nerr2", out: "ERR1\nERR2" }, { in: "ok\nerr", out: "ERR" }], checks: [["grep", "grep"], ["sed", "sed"]] },
  });
  A.add("shell", {
    id: "exit", t: "Codes de sortie, && et ||", lv: 3, min: 6, why: "enchaîner des commandes selon leur succès", when: "scripts de déploiement, vérifications, tests rapides",
    stages: [{ t: "0 = succès", code: B + X`test -f /nexiste/pas && echo "existe" || echo "absent"
false; echo "code: $?"
true && echo "ok"
`, notes: { 2: "`A && B` : B seulement si A **réussit**. `A || B` : B seulement si A **échoue**.", 3: "`$?` contient le code de sortie de la **dernière** commande : 0 = succès, autre = échec." },
      steps: [S(2, "`test -f` vérifie qu'un fichier existe : il n'existe pas, la commande **échoue** (code 1).", {}), S(2, "`&&` est donc sauté ; `||` s'exécute car la commande précédente a échoué.", {}, "absent\n"), S(3, "`false` renvoie toujours le code 1 ; `$?` le garde en mémoire.", { "$?": 1 }, "code: 1\n"), S(4, "`true` réussit (code 0) : `&&` lance la suite.", { "$?": 0 }, "ok\n")] }],
    quiz: [{ code: "true || echo A && echo B", o: ["A B", "B", "A", "rien"], a: 1, why: "`true ||` saute `echo A`, mais le `&&` suivant voit un succès (0) : `echo B` s'exécute." }],
    ex: { prompt: "Lis `n`. Affiche `pair` ou `impair` en n'utilisant que `[ … ] && … || …` (pas de `if`).", starter: B + "read n\n", solution: B + "read n\n[ $((n % 2)) -eq 0 ] && echo pair || echo impair\n", hints: ["`[ $((n % 2)) -eq 0 ]` teste la parité."], tests: [{ in: "4", out: "pair" }, { in: "7", out: "impair" }, { in: "0", out: "pair" }], checks: [["&&", "&&"], ["\\|\\|", "||"]] },
  });
})();
