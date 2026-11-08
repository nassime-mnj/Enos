"use strict";
(() => {
  const A = ACAD, B = "#!/bin/bash\n";
  A.add("shell", {
    id: "vars", t: "Variables et affichage", lv: 1, min: 4, why: "automatiser des commandes avec des valeurs", when: "tout script : noms de fichiers, compteurs, options",
    stages: [{ t: "Variables et calcul", code: B + 'nom="Ada"\nn=$((3 + 4))\necho "Salut $nom, n=$n"\n', notes: { 1: "Le **shebang** dit au système quel interpréteur lance le script.", 2: "**Aucun espace** autour du `=` : `nom = \"Ada\"` serait vu comme une commande `nom`.", 3: "`$(( … ))` fait un calcul **entier**.", 4: "Les guillemets doubles laissent `$variable` se développer." },
      steps: [S(2, "`nom` reçoit le **texte** `Ada` : en shell tout est du texte.", { nom: "Ada" }), S(3, "`$((3 + 4))` est calculé par bash : `n` vaut `7` (texte « 7 »).", { n: 7 }), S(4, "Bash remplace `$nom` et `$n` **avant** de lancer `echo` (« expansion »).", {}, "Salut Ada, n=7\n")] }],
    quiz: [{ code: "x=5\necho '$x'", o: ["5", "$x", "x", "rien"], a: 1, why: "Les apostrophes **empêchent** l'expansion : le texte est affiché tel quel." }],
    ex: { prompt: "Lis deux entiers sur **une ligne** (avec `read a b`) et affiche leur somme.", starter: B + "read a b\n", solution: B + "read a b\necho $((a + b))\n", hints: ["`echo $((a + b))`"], tests: [{ in: "3 4", out: "7" }, { in: "10 -2", out: "8" }], checks: [["echo", "echo"]] },
  });
  A.add("shell", {
    id: "pipes", t: "Tubes et redirections", lv: 2, min: 6, why: "assembler de petits outils en chaînes puissantes", when: "traiter du texte, des logs, des listes de fichiers",
    stages: [{ t: "Fichier + pipe", code: B + 'printf "b\\na\\nb\\n" > mots.txt\nsort mots.txt | uniq -c\n', notes: { 2: "`>` **écrase** le fichier avec la sortie de la commande (`>>` ajoute).", 3: "`|` branche la **sortie** d'une commande sur l'**entrée** de la suivante." },
      steps: [S(2, "`printf` écrit 3 lignes ; `>` les envoie dans le fichier plutôt qu'à l'écran.", {}, "", { h: { "mots.txt": "b ⏎ a ⏎ b" } }), S(3, "`sort` trie les lignes… et son flux part dans un **tube** (mémoire tampon du noyau) vers `uniq -c`.", {}, "", { h: { "tube": "a ⏎ b ⏎ b" } }), S(3, "`uniq -c` compte les lignes consécutives identiques.", {}, "      1 a\n      2 b\n", { h: { "tube": null } })] }],
    quiz: [{ code: "echo salut > f\necho monde > f\ncat f", o: ["salut", "monde", "salut monde", "rien"], a: 1, why: "Le second `>` a **écrasé** le fichier. Il aurait fallu `>>`." }],
    ex: { prompt: "Lis des mots (un par ligne) sur l'entrée standard. Affiche-les **triés, sans doublons**.", starter: B + "", solution: B + "sort -u\n", hints: ["`sort` lit l'entrée standard par défaut.", "L'option `-u` supprime les doublons."], tests: [{ in: "b\na\nb", out: "a\nb" }, { in: "z\nz", out: "z" }], checks: [["sort", "sort"]] },
  });
  A.add("shell", {
    id: "ctrl", t: "Conditions et boucles", lv: 3, min: 6, why: "décider et répéter dans un script", when: "tester un fichier, parcourir une liste, valider des arguments",
    stages: [{ t: "for + if", code: B + 'total=0\nfor i in 1 2 3; do\n  total=$((total + i))\ndone\nif [ "$total" -gt 5 ]; then\n  echo "grand: $total"\nfi\n', notes: { 6: "`[ … ]` est la commande `test` : **espaces obligatoires** de chaque côté des crochets." },
      steps: [S(2, "Compteur à 0.", { total: 0 }), S(3, "Tour 1 : `i` = 1.", { i: 1 }), S(4, "`total = 0 + 1`.", { total: 1 }), S(3, "Tour 2 : `i` = 2.", { i: 2 }), S(4, "`total = 1 + 2`.", { total: 3 }), S(3, "Tour 3 : `i` = 3.", { i: 3 }), S(4, "`total = 3 + 3`.", { total: 6 }), S(6, "`-gt` = « supérieur à » (comparaison **numérique**). 6 > 5 : vrai.", {}), S(7, "On affiche.", {}, "grand: 6\n")] }],
    quiz: [{ code: 'if [ "a" = "a" ]; then echo oui; fi', o: ["oui", "rien", "Erreur", "a"], a: 0, why: "`=` compare deux **chaînes** (avec `[ ]`)." }],
    ex: { prompt: "Lis `n` et affiche la somme `1 + … + n`.", starter: B + "read n\n", solution: B + "read n\ns=0\nfor ((i = 1; i <= n; i++)); do\n  s=$((s + i))\ndone\necho $s\n", hints: ["Boucle arithmétique : `for ((i = 1; i <= n; i++)); do … done`."], tests: [{ in: "3", out: "6" }, { in: "10", out: "55" }, { in: "1", out: "1" }], checks: [["for|while", "une boucle"]] },
  });
  A.add("shell", {
    id: "func", t: "Fonctions et arguments", lv: 3, min: 6, why: "réutiliser des morceaux de script", when: "scripts de plus de quelques lignes",
    stages: [{ t: "$1 et appel", code: B + 'salue() {\n  echo "Salut $1 !"\n  return 0\n}\nsalue "Ada"\nsalue "Linus"\n', notes: { 2: "Une fonction shell reçoit ses arguments dans `$1`, `$2`… comme un script.", 4: "`return` ne renvoie qu'un **code de sortie** (0 = succès). Pour renvoyer du texte : `echo`." },
      steps: [S(2, "La fonction est enregistrée (rien ne s'exécute).", { salue: "ƒ" }), S(6, "Appel : un nouveau contexte avec `$1` = `Ada`.", { $1: "Ada" }, "", { push: "salue" }), S(3, "`echo` affiche avec `$1` développé.", {}, "Salut Ada !\n"), S(4, "`return 0` : fin avec succès.", {}, "", { ret: 0, pop: true }), S(7, "Deuxième appel avec un autre argument.", { $1: "Linus" }, "", { push: "salue" }), S(3, "Même fonction, autre argument.", {}, "Salut Linus !\n", { pop: true })] }],
    quiz: [{ code: "f() { echo \"$1-$2\"; }\nf a", o: ["a-", "a-a", "-", "Erreur"], a: 0, why: "`$2` n'existe pas : il se développe en chaîne vide." }],
    ex: { prompt: "Écris la fonction `double` qui affiche son argument ×2. Lis `n` et appelle `double \"$n\"`.", starter: B + "read n\n", solution: B + "double() {\n  echo $(( $1 * 2 ))\n}\nread n\ndouble \"$n\"\n", hints: ["`echo $(( $1 * 2 ))`"], tests: [{ in: "4", out: "8" }, { in: "-3", out: "-6" }], checks: [["double\\(\\)|function double", "function double"]] },
  });
  A.add("shell", {
    id: "pro", t: "Pipelines d'expert : awk, set -euo pipefail", lv: 5, min: 8, why: "transformer des données et fiabiliser un script", when: "logs, CSV, scripts de déploiement et d'administration",
    stages: [{ t: "Agréger avec awk", code: B + "set -euo pipefail\nprintf \"a 1\\nb 2\\na 3\\n\" | awk '{s[$1]+=$2} END {for (k in s) print k, s[k]}' | sort\n", notes: { 2: "`-e` stoppe à la 1ʳᵉ erreur, `-u` refuse les variables non définies, `pipefail` fait échouer un pipeline si **n'importe quelle** étape échoue.", 3: "`awk` lit ligne par ligne : `$1` et `$2` = colonnes ; `s[...]` est un tableau associatif." },
      steps: [S(2, "Mode strict : le script s'arrête dès qu'une commande échoue.", {}), S(3, "`printf` produit 3 lignes qui entrent dans le tube.", {}, "", { h: { "tube 1": "a 1 ⏎ b 2 ⏎ a 3" } }), S(3, "`awk` additionne par clé : `s[a]` = 1 + 3 = 4, `s[b]` = 2. À la fin (`END`) il affiche les totaux.", {}, "", { h: { "tube 1": null, "tube 2": "a 4 ⏎ b 2" } }), S(3, "`sort` met le résultat en ordre (awk ne garantit pas l'ordre).", {}, "a 4\nb 2\n", { h: { "tube 2": null } })] }],
    quiz: [{ code: "set -e\nfalse\necho suite", o: ["suite", "rien (script arrêté)", "false", "Erreur de syntaxe"], a: 1, why: "`false` renvoie 1 : avec `set -e` le script s'arrête immédiatement." }],
    ex: { prompt: "Lis des lignes `clé valeur`. Affiche pour chaque clé la **somme** de ses valeurs (`clé somme`), triée par clé. Utilise `awk`.", starter: B + "", solution: B + "awk '{s[$1]+=$2} END {for (k in s) print k, s[k]}' | sort\n", hints: ["Un tableau associatif awk : `s[$1] += $2`.", "Bloc `END { … }` pour afficher à la fin."], tests: [{ in: "a 1\nb 2\na 3", out: "a 4\nb 2" }, { in: "x 5", out: "x 5" }], checks: [["awk", "awk"]] },
  });
  A.templates = A.templates || {};
  A.templates.shell = [{ n: "Hello", code: B + 'echo "Hello, ENOS !"\n' }, { n: "Boucle + calcul", code: B + 'for i in 1 2 3 4 5; do\n  echo "$i au carré = $((i * i))"\ndone\n' }];
  A.sheets.shell = `### Shell (bash) en 1 page
- Variables : \`x=5\` (sans espace) · \`$x\` · \`"$x"\` (toujours entre guillemets)
- Sous-commande : \`$(commande)\` · calcul : \`$((a + b))\`
- Redirections : \`>\` écrase, \`>>\` ajoute, \`<\` entrée, \`2>&1\` erreurs → sortie
- Tests : \`[ -f fichier ]\`, \`[ "$a" = "$b" ]\`, \`[ "$n" -gt 3 ]\`
- Outils : \`grep\`, \`sed\`, \`awk\`, \`sort\`, \`uniq\`, \`cut\`, \`wc\`, \`xargs\`, \`find\`
### Réflexes d'expert
- Commence les scripts par \`set -euo pipefail\`
- Cite toujours tes variables : \`"$f"\`
- \`shellcheck\` détecte la plupart des pièges`;
})();
