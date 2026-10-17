"use strict";
/* Enos CodeLab - catalogue des Quêtes (données publiées dans l'appli, SANS solutions).
 * Chaque quête : { id, lang, level, xp, title, story, goal, starter, tests:[{stdin, expected}], concepts, hints:[3], compare? }
 * Comparaison de la sortie : fins de ligne \r\n normalisées, espaces/retours en fin de ligne et de texte supprimés, sensible à la casse.
 * compare:"lines" (défaut) = comparaison ligne à ligne telle quelle.
 * compare:"tokens" (sql) = on ignore les en-têtes et la ligne de séparation (---) du tableau aligné produit par le runner
 *   (tout ce qui précède et inclut la 1re ligne faite uniquement de tirets/+/|) puis on compare la suite des valeurs
 *   séparées par des espaces ou des « | ». expected ne contient donc QUE les valeurs (une ligne par ligne de résultat).
 * JavaScript : console.log capturé ; INPUT (string) = entrée standard, readLine() = ligne suivante (null à la fin). */
window.CODELAB_QUESTS = {
 "version": 1,
 "languages": {
  "python": {
   "label": "Python",
   "intro": "Python, c'est le langage le plus doux pour commencer : lisible comme une phrase. Ton code est lu et exécuté ligne par ligne ; input() lit le clavier, print() affiche."
  },
  "js": {
   "label": "JavaScript",
   "intro": "JavaScript tourne directement sur ton téléphone. console.log() affiche à l'écran ; la variable INPUT contient tout le texte saisi en entrée et readLine() renvoie la ligne suivante de INPUT (null quand il n'y en a plus)."
  },
  "c": {
   "label": "C",
   "intro": "Le C est le grand-père de beaucoup de langages : proche de la machine, précis, exigeant. Ici, des programmes complets avec main ; printf affiche et scanf lit l'entrée."
  },
  "cpp": {
   "label": "C++",
   "intro": "Le C++ prolonge le C avec des outils plus confortables. Écris des programmes complets avec main ; cout affiche, cin lit l'entrée."
  },
  "java": {
   "label": "Java",
   "intro": "Java aime l'ordre : tout est rangé dans une classe. Écris un programme complet (classe Main avec sa méthode main) ; System.out affiche et Scanner lit l'entrée."
  },
  "sql": {
   "label": "SQL",
   "intro": "SQL, c'est l'art de poser des questions à une base de données. Les tables sont déjà créées dans le code de départ : à toi d'écrire les SELECT. Seules les valeurs affichées comptent, pas les en-têtes."
  },
  "shell": {
   "label": "Shell",
   "intro": "Le shell (bash) est la porte d'entrée du terminal : de petites commandes qu'on assemble. read lit l'entrée, echo affiche."
  }
 },
 "quests": [
  {
   "id": "py-01-hello",
   "lang": "python",
   "level": 1,
   "xp": 10,
   "title": "Premier mot",
   "story": "Bienvenue, voyageur. Tout grand périple commence par un mot : fais parler ton programme.",
   "goal": "Affiche exactement : Bonjour ETO",
   "starter": "# Ton premier programme Python\n# TODO : fais afficher le message demandé\n",
   "tests": [
    {
     "stdin": "",
     "expected": "Bonjour ETO\n"
    },
    {
     "stdin": "",
     "expected": "Bonjour ETO\n"
    }
   ],
   "concepts": [
    "print",
    "afficher",
    "texte"
   ],
   "hints": [
    "Cherche l'instruction qui affiche du texte à l'écran, puis recopie le message demandé à l'identique (majuscules comprises).",
    "En Python, une fonction toute prête affiche du texte à l'écran.",
    "Elle s'appelle print ; le texte se place entre guillemets, à l'intérieur des parenthèses : print(\"ton texte\")."
   ]
  },
  {
   "id": "py-02-vars",
   "lang": "python",
   "level": 2,
   "xp": 15,
   "title": "Les boîtes magiques",
   "story": "Une variable, c'est une petite boîte qui garde une valeur. Remplis-en deux et laisse la machine calculer.",
   "goal": "Un lot contient 8 paquets de 12 cartes. Range ces deux nombres dans deux variables (paquets et cartes) et affiche le nombre total de cartes.",
   "starter": "paquets = 8\n# TODO : crée la variable cartes, puis affiche le total\n",
   "tests": [
    {
     "stdin": "",
     "expected": "96\n"
    },
    {
     "stdin": "",
     "expected": "96\n"
    }
   ],
   "concepts": [
    "variable",
    "multiplication",
    "calcul"
   ],
   "hints": [
    "Garde chaque nombre dans une variable au nom clair, puis laisse le langage faire le calcul à ta place.",
    "Crée une seconde variable avec le signe =, comme pour la première.",
    "Multiplie avec l'opérateur * et passe le résultat à print : print(a * b). Pas de guillemets autour des variables, sinon tu afficherais leur nom."
   ]
  },
  {
   "id": "py-03-greet",
   "lang": "python",
   "level": 3,
   "xp": 20,
   "title": "Salut, voyageur",
   "story": "Un bon guide demande ton nom avant de partir. Écoute ce que le clavier lui envoie.",
   "goal": "Lis un prénom au clavier et affiche : Bonjour, <prénom> !  (exemple pour Lea : Bonjour, Lea !)",
   "starter": "nom = input()\n# TODO : affiche le message de salutation\n",
   "tests": [
    {
     "stdin": "Lea\n",
     "expected": "Bonjour, Lea !\n"
    },
    {
     "stdin": "Omar\n",
     "expected": "Bonjour, Omar !\n"
    },
    {
     "stdin": "ETO\n",
     "expected": "Bonjour, ETO !\n"
    }
   ],
   "concepts": [
    "input",
    "lecture",
    "entrée",
    "concaténation"
   ],
   "hints": [
    "Le prénom arrive par l'entrée standard : commence par le lire dans une variable, puis assemble le message avec le texte fixe.",
    "input() a déjà rangé le prénom dans la variable nom. Il reste à fabriquer la phrase.",
    "Une f-string (texte précédé de la lettre f) accepte des variables entre accolades. Attention à la virgule et à l'espace avant le point d'exclamation."
   ]
  },
  {
   "id": "py-04-pairs",
   "lang": "python",
   "level": 4,
   "xp": 25,
   "title": "Le sentier des nombres pairs",
   "story": "Répéter, c'est le secret de la patience. Marche sur le sentier en sautant une pierre sur deux.",
   "goal": "Fais une boucle qui affiche les nombres pairs de 0 à 20 (inclus), un par ligne.",
   "starter": "# TODO : affiche les nombres pairs de 0 à 20, un par ligne\nfor i in range(3):\n    print(i)\n",
   "tests": [
    {
     "stdin": "",
     "expected": "0\n2\n4\n6\n8\n10\n12\n14\n16\n18\n20\n"
    },
    {
     "stdin": "",
     "expected": "0\n2\n4\n6\n8\n10\n12\n14\n16\n18\n20\n"
    }
   ],
   "concepts": [
    "boucle",
    "for",
    "range",
    "pas",
    "pair"
   ],
   "hints": [
    "Une boucle répète un bloc : réfléchis à la valeur de départ, à la valeur d'arrêt (incluse !) et à la façon d'avancer à chaque tour.",
    "range peut compter de deux en deux : regarde ses paramètres optionnels.",
    "range(début, fin, pas) : la fin est exclue, donc pour atteindre 20 il faut aller jusqu'à 21. Le pas vaut 2."
   ]
  },
  {
   "id": "py-05-parity",
   "lang": "python",
   "level": 5,
   "xp": 30,
   "title": "Pair ou impair",
   "story": "Le yin et le yang des nombres : certains vont par deux, d'autres restent seuls. À toi de les départager.",
   "goal": "Lis un entier n. Affiche pair s'il est pair, sinon impair (en minuscules).",
   "starter": "n = int(input())\n# TODO : affiche pair ou impair\n",
   "tests": [
    {
     "stdin": "4\n",
     "expected": "pair\n"
    },
    {
     "stdin": "7\n",
     "expected": "impair\n"
    },
    {
     "stdin": "0\n",
     "expected": "pair\n"
    },
    {
     "stdin": "-3\n",
     "expected": "impair\n"
    }
   ],
   "concepts": [
    "condition",
    "if",
    "else",
    "modulo",
    "reste"
   ],
   "hints": [
    "Un nombre est pair quand la division par 2 ne laisse aucun reste. Quel opérateur donne ce reste ?",
    "L'opérateur % donne le reste de la division entière. Compare ce reste à 0 avec ==.",
    "Structure : if condition: ... else: ... ; chaque bloc est indenté de 4 espaces et la condition se termine par deux-points."
   ]
  },
  {
   "id": "py-06-fact",
   "lang": "python",
   "level": 6,
   "xp": 35,
   "title": "La fabrique de factorielles",
   "story": "Les grands nombres naissent de petits : multiplie-les tous, un à un, et range ce savoir-faire dans une fonction.",
   "goal": "Écris une fonction factorielle(n), lis un entier n (0 ≤ n ≤ 12) et affiche n!  (1 × 2 × … × n ; rappel : 0! = 1).",
   "starter": "def factorielle(n):\n    # TODO : renvoie n! (0! vaut 1)\n    return 0\n\n\nn = int(input())\nprint(factorielle(n))\n",
   "tests": [
    {
     "stdin": "5\n",
     "expected": "120\n"
    },
    {
     "stdin": "0\n",
     "expected": "1\n"
    },
    {
     "stdin": "1\n",
     "expected": "1\n"
    },
    {
     "stdin": "10\n",
     "expected": "3628800\n"
    }
   ],
   "concepts": [
    "fonction",
    "return",
    "boucle",
    "factorielle"
   ],
   "hints": [
    "n! = 1 × 2 × … × n, et 0! vaut 1. Isole ce calcul dans une fonction qui reçoit n et renvoie le résultat.",
    "Pars d'un cumul qui vaut 1, puis multiplie-le successivement par chaque entier de 2 à n.",
    "Une boucle for sur range(2, n + 1) fait l'affaire ; termine la fonction en renvoyant le cumul. Si n vaut 0 ou 1, la boucle ne tourne pas et 1 est renvoyé."
   ]
  },
  {
   "id": "py-07-array",
   "lang": "python",
   "level": 7,
   "xp": 40,
   "title": "Le grimoire de nombres",
   "story": "Une liste, c'est un grimoire où chaque case garde un secret. Feuillette-le et fais-en le bilan.",
   "goal": "Première ligne : le nombre N de valeurs. Deuxième ligne : les N entiers séparés par des espaces. Affiche leur somme, puis sur la ligne suivante le plus grand.",
   "starter": "n = int(input())\nnombres = list(map(int, input().split()))\n# TODO : affiche la somme, puis le maximum (chacun sur sa ligne)\n",
   "tests": [
    {
     "stdin": "5\n3 9 2 7 4\n",
     "expected": "25\n9\n"
    },
    {
     "stdin": "1\n42\n",
     "expected": "42\n42\n"
    },
    {
     "stdin": "4\n-5 -2 -8 -1\n",
     "expected": "-16\n-1\n"
    }
   ],
   "concepts": [
    "liste",
    "tableau",
    "somme",
    "maximum",
    "boucle"
   ],
   "hints": [
    "Lis d'abord combien il y a de nombres, puis les nombres eux-mêmes ; garde un cumul pour la somme et retiens le plus grand vu jusqu'ici.",
    "Python possède des fonctions intégrées qui travaillent directement sur une liste entière.",
    "sum(liste) additionne tous les éléments et max(liste) renvoie le plus grand. Utilise un print pour chacun."
   ]
  },
  {
   "id": "py-08-rev",
   "lang": "python",
   "level": 8,
   "xp": 45,
   "title": "Le miroir de lettres",
   "story": "Dans le miroir de l'étang, les mots se lisent à l'envers. Montre-moi ce que l'eau reflète.",
   "goal": "Lis un mot (sans espace) et affiche-le à l'envers (ETO devient OTE).",
   "starter": "mot = input()\n# TODO : affiche le mot à l'envers\n",
   "tests": [
    {
     "stdin": "ETO\n",
     "expected": "OTE\n"
    },
    {
     "stdin": "radar\n",
     "expected": "radar\n"
    },
    {
     "stdin": "bonjour\n",
     "expected": "ruojnob\n"
    },
    {
     "stdin": "Python\n",
     "expected": "nohtyP\n"
    }
   ],
   "concepts": [
    "chaîne",
    "inverser",
    "reverse",
    "string"
   ],
   "hints": [
    "Pour inverser un mot, il suffit de le parcourir de la fin vers le début en lisant chaque lettre.",
    "Les chaînes se découpent comme les listes, avec des crochets.",
    "Le découpage chaine[début:fin:pas] accepte un pas négatif, qui parcourt le texte à l'envers. Laisse début et fin vides."
   ]
  },
  {
   "id": "py-09-dict",
   "lang": "python",
   "level": 9,
   "xp": 50,
   "title": "Le registre des mots",
   "story": "Un bon archiviste sait combien de fois chaque mot revient. Ouvre ton registre et tiens les comptes.",
   "goal": "Lis une ligne de mots séparés par des espaces. Pour chaque mot distinct, dans l'ordre alphabétique, affiche « mot: nombre » (nombre d'apparitions). Exemple : a b a donne a: 2 puis b: 1.",
   "starter": "mots = input().split()\ncompteur = {}\n# TODO : compte combien de fois chaque mot apparaît,\n# puis affiche « mot: nombre » pour chaque mot, dans l'ordre alphabétique\n",
   "tests": [
    {
     "stdin": "a b a c b a\n",
     "expected": "a: 3\nb: 2\nc: 1\n"
    },
    {
     "stdin": "ETO ETO\n",
     "expected": "ETO: 2\n"
    },
    {
     "stdin": "zen ami zen ami zen\n",
     "expected": "ami: 2\nzen: 3\n"
    }
   ],
   "concepts": [
    "dictionnaire",
    "dict",
    "split",
    "sorted",
    "compteur"
   ],
   "hints": [
    "Compter des occurrences, c'est associer chaque mot à un nombre : quelle structure de données associe une clé à une valeur ?",
    "Un dictionnaire associe une clé (le mot) à une valeur (son nombre d'apparitions). Parcours la liste mots et mets-le à jour.",
    "dico.get(cle, 0) renvoie 0 quand la clé n'existe pas encore, ce qui permet d'écrire dico[cle] = dico.get(cle, 0) + 1. Pour l'ordre alphabétique, boucle sur sorted(dico)."
   ]
  },
  {
   "id": "js-01-hello",
   "lang": "js",
   "level": 1,
   "xp": 10,
   "title": "Premier mot",
   "story": "Bienvenue, voyageur. Tout grand périple commence par un mot : fais parler ton programme.",
   "goal": "Affiche exactement : Bonjour ETO",
   "starter": "// Ton premier programme JavaScript\n// TODO : fais afficher le message demandé\n",
   "tests": [
    {
     "stdin": "",
     "expected": "Bonjour ETO\n"
    },
    {
     "stdin": "",
     "expected": "Bonjour ETO\n"
    }
   ],
   "concepts": [
    "print",
    "afficher",
    "texte"
   ],
   "hints": [
    "Cherche l'instruction qui affiche du texte à l'écran, puis recopie le message demandé à l'identique (majuscules comprises).",
    "En JavaScript, console.log écrit une ligne dans la console.",
    "console.log(\"ton texte\"); — le texte est entre guillemets et la ligne se termine par un point-virgule."
   ]
  },
  {
   "id": "js-02-vars",
   "lang": "js",
   "level": 2,
   "xp": 15,
   "title": "Les boîtes magiques",
   "story": "Une variable, c'est une petite boîte qui garde une valeur. Remplis-en deux et laisse la machine calculer.",
   "goal": "Un lot contient 8 paquets de 12 cartes. Range ces deux nombres dans deux variables (paquets et cartes) et affiche le nombre total de cartes.",
   "starter": "const paquets = 8;\n// TODO : crée la constante cartes, puis affiche le total\n",
   "tests": [
    {
     "stdin": "",
     "expected": "96\n"
    },
    {
     "stdin": "",
     "expected": "96\n"
    }
   ],
   "concepts": [
    "variable",
    "multiplication",
    "calcul"
   ],
   "hints": [
    "Garde chaque nombre dans une variable au nom clair, puis laisse le langage faire le calcul à ta place.",
    "Déclare une seconde variable avec const (ou let), comme pour la première.",
    "L'opérateur * multiplie. Passe le résultat à console.log sans guillemets autour des variables."
   ]
  },
  {
   "id": "js-03-greet",
   "lang": "js",
   "level": 3,
   "xp": 20,
   "title": "Salut, voyageur",
   "story": "Un bon guide demande ton nom avant de partir. Écoute ce que le clavier lui envoie.",
   "goal": "Lis un prénom au clavier et affiche : Bonjour, <prénom> !  (exemple pour Lea : Bonjour, Lea !)",
   "starter": "const nom = readLine();\n// TODO : affiche le message de salutation\n",
   "tests": [
    {
     "stdin": "Lea\n",
     "expected": "Bonjour, Lea !\n"
    },
    {
     "stdin": "Omar\n",
     "expected": "Bonjour, Omar !\n"
    },
    {
     "stdin": "ETO\n",
     "expected": "Bonjour, ETO !\n"
    }
   ],
   "concepts": [
    "input",
    "lecture",
    "entrée",
    "concaténation"
   ],
   "hints": [
    "Le prénom arrive par l'entrée standard : commence par le lire dans une variable, puis assemble le message avec le texte fixe.",
    "readLine() a déjà lu la ligne tapée par l'utilisateur et l'a rangée dans nom.",
    "Les gabarits de texte (backticks) acceptent des variables dans des ${ } ; sinon, concatène avec +. Attention à la virgule et à l'espace avant le point d'exclamation."
   ]
  },
  {
   "id": "js-04-mult3",
   "lang": "js",
   "level": 4,
   "xp": 25,
   "title": "La spirale des multiples",
   "story": "Chaque tour de spirale ajoute trois pas. Compte-les à voix haute, doucement.",
   "goal": "Affiche les multiples de 3 de 3 à 30 inclus, un par ligne (3, 6, 9, …, 30).",
   "starter": "// TODO : affiche les multiples de 3 de 3 à 30\nfor (let i = 1; i <= 3; i++) {\n  console.log(i);\n}\n",
   "tests": [
    {
     "stdin": "",
     "expected": "3\n6\n9\n12\n15\n18\n21\n24\n27\n30\n"
    },
    {
     "stdin": "",
     "expected": "3\n6\n9\n12\n15\n18\n21\n24\n27\n30\n"
    }
   ],
   "concepts": [
    "boucle",
    "for",
    "pas",
    "multiple"
   ],
   "hints": [
    "Une boucle répète un bloc : réfléchis à la valeur de départ, à la valeur d'arrêt (incluse !) et à la façon d'avancer à chaque tour.",
    "Tu peux faire avancer le compteur d'une autre valeur que 1 à chaque tour.",
    "for (début; condition; avance) : pars de 3, continue tant que i <= 30 et ajoute 3 à chaque tour avec i += 3."
   ]
  },
  {
   "id": "js-05-parity",
   "lang": "js",
   "level": 5,
   "xp": 30,
   "title": "Pair ou impair",
   "story": "Le yin et le yang des nombres : certains vont par deux, d'autres restent seuls. À toi de les départager.",
   "goal": "Lis un entier n. Affiche pair s'il est pair, sinon impair (en minuscules).",
   "starter": "const n = Number(readLine());\n// TODO : affiche pair ou impair\n",
   "tests": [
    {
     "stdin": "4\n",
     "expected": "pair\n"
    },
    {
     "stdin": "7\n",
     "expected": "impair\n"
    },
    {
     "stdin": "0\n",
     "expected": "pair\n"
    },
    {
     "stdin": "-3\n",
     "expected": "impair\n"
    }
   ],
   "concepts": [
    "condition",
    "if",
    "else",
    "modulo",
    "reste"
   ],
   "hints": [
    "Un nombre est pair quand la division par 2 ne laisse aucun reste. Quel opérateur donne ce reste ?",
    "L'opérateur % donne le reste de la division. Compare-le à 0.",
    "Structure : if (condition) { ... } else { ... }. Pour tester l'égalité, utilise === (trois signes)."
   ]
  },
  {
   "id": "js-06-fact",
   "lang": "js",
   "level": 6,
   "xp": 35,
   "title": "La fabrique de factorielles",
   "story": "Les grands nombres naissent de petits : multiplie-les tous, un à un, et range ce savoir-faire dans une fonction.",
   "goal": "Écris une fonction factorielle(n), lis un entier n (0 ≤ n ≤ 12) et affiche n!  (1 × 2 × … × n ; rappel : 0! = 1).",
   "starter": "function factorielle(n) {\n  // TODO : renvoie n! (0! vaut 1)\n  return 0;\n}\n\nconst n = Number(readLine());\nconsole.log(factorielle(n));\n",
   "tests": [
    {
     "stdin": "5\n",
     "expected": "120\n"
    },
    {
     "stdin": "0\n",
     "expected": "1\n"
    },
    {
     "stdin": "1\n",
     "expected": "1\n"
    },
    {
     "stdin": "10\n",
     "expected": "3628800\n"
    }
   ],
   "concepts": [
    "fonction",
    "return",
    "boucle",
    "factorielle"
   ],
   "hints": [
    "n! = 1 × 2 × … × n, et 0! vaut 1. Isole ce calcul dans une fonction qui reçoit n et renvoie le résultat.",
    "Pars d'un cumul qui vaut 1, puis multiplie-le successivement par chaque entier de 2 à n.",
    "Une boucle for avec i de 2 à n inclus, une multiplication du cumul par i dans le corps, et renvoie le cumul à la fin. Si n vaut 0 ou 1 la boucle ne tourne pas."
   ]
  },
  {
   "id": "js-07-array",
   "lang": "js",
   "level": 7,
   "xp": 40,
   "title": "Le grimoire de nombres",
   "story": "Une liste, c'est un grimoire où chaque case garde un secret. Feuillette-le et fais-en le bilan.",
   "goal": "Première ligne : le nombre N de valeurs. Deuxième ligne : les N entiers séparés par des espaces. Affiche leur somme, puis sur la ligne suivante le plus grand.",
   "starter": "const n = Number(readLine());\nconst nombres = readLine().split(\" \").map(Number);\n// TODO : affiche la somme, puis le maximum (chacun sur sa ligne)\n",
   "tests": [
    {
     "stdin": "5\n3 9 2 7 4\n",
     "expected": "25\n9\n"
    },
    {
     "stdin": "1\n42\n",
     "expected": "42\n42\n"
    },
    {
     "stdin": "4\n-5 -2 -8 -1\n",
     "expected": "-16\n-1\n"
    }
   ],
   "concepts": [
    "liste",
    "tableau",
    "somme",
    "maximum",
    "boucle"
   ],
   "hints": [
    "Lis d'abord combien il y a de nombres, puis les nombres eux-mêmes ; garde un cumul pour la somme et retiens le plus grand vu jusqu'ici.",
    "Un tableau possède des méthodes pour le réduire à une seule valeur ; Math propose aussi des outils.",
    "tableau.reduce((cumul, x) => ..., départ) calcule la somme ; Math.max accepte plusieurs nombres, et l'opérateur de décomposition ... étale un tableau en arguments."
   ]
  },
  {
   "id": "js-08-rev",
   "lang": "js",
   "level": 8,
   "xp": 45,
   "title": "Le miroir de lettres",
   "story": "Dans le miroir de l'étang, les mots se lisent à l'envers. Montre-moi ce que l'eau reflète.",
   "goal": "Lis un mot (sans espace) et affiche-le à l'envers (ETO devient OTE).",
   "starter": "const mot = readLine();\n// TODO : affiche le mot à l'envers\n",
   "tests": [
    {
     "stdin": "ETO\n",
     "expected": "OTE\n"
    },
    {
     "stdin": "radar\n",
     "expected": "radar\n"
    },
    {
     "stdin": "bonjour\n",
     "expected": "ruojnob\n"
    },
    {
     "stdin": "Python\n",
     "expected": "nohtyP\n"
    }
   ],
   "concepts": [
    "chaîne",
    "inverser",
    "reverse",
    "string"
   ],
   "hints": [
    "Pour inverser un mot, il suffit de le parcourir de la fin vers le début en lisant chaque lettre.",
    "Une chaîne n'a pas de méthode reverse, mais un tableau, si.",
    "Enchaîne trois méthodes : split pour obtenir un tableau de lettres, reverse pour l'inverser, join pour recoller le tout en texte."
   ]
  },
  {
   "id": "c-01-hello",
   "lang": "c",
   "level": 1,
   "xp": 10,
   "title": "Premier mot",
   "story": "Bienvenue, voyageur. Tout grand périple commence par un mot : fais parler ton programme.",
   "goal": "Affiche exactement : Bonjour ETO",
   "starter": "#include <stdio.h>\n\nint main(void) {\n    // TODO : affiche le message demandé\n    return 0;\n}\n",
   "tests": [
    {
     "stdin": "",
     "expected": "Bonjour ETO\n"
    },
    {
     "stdin": "",
     "expected": "Bonjour ETO\n"
    }
   ],
   "concepts": [
    "print",
    "afficher",
    "texte"
   ],
   "hints": [
    "Cherche l'instruction qui affiche du texte à l'écran, puis recopie le message demandé à l'identique (majuscules comprises).",
    "En C, printf (déclarée dans <stdio.h>) affiche du texte. Pense au caractère \\n pour terminer la ligne.",
    "printf(\"texte\\n\"); — à placer dans main, avant le return."
   ]
  },
  {
   "id": "c-02-vars",
   "lang": "c",
   "level": 2,
   "xp": 15,
   "title": "Les boîtes magiques",
   "story": "Une variable, c'est une petite boîte qui garde une valeur. Remplis-en deux et laisse la machine calculer.",
   "goal": "Un lot contient 8 paquets de 12 cartes. Range ces deux nombres dans deux variables (paquets et cartes) et affiche le nombre total de cartes.",
   "starter": "#include <stdio.h>\n\nint main(void) {\n    int paquets = 8;\n    // TODO : crée la variable cartes, puis affiche le total\n    return 0;\n}\n",
   "tests": [
    {
     "stdin": "",
     "expected": "96\n"
    },
    {
     "stdin": "",
     "expected": "96\n"
    }
   ],
   "concepts": [
    "variable",
    "multiplication",
    "calcul"
   ],
   "hints": [
    "Garde chaque nombre dans une variable au nom clair, puis laisse le langage faire le calcul à ta place.",
    "Déclare une seconde variable de type int, puis multiplie avec *.",
    "Pour afficher un entier, printf utilise le code de format %d dans le texte, suivi de la valeur : printf(\"%d\\n\", valeur);"
   ]
  },
  {
   "id": "c-03-greet",
   "lang": "c",
   "level": 3,
   "xp": 20,
   "title": "Salut, voyageur",
   "story": "Un bon guide demande ton nom avant de partir. Écoute ce que le clavier lui envoie.",
   "goal": "Lis un prénom au clavier et affiche : Bonjour, <prénom> !  (exemple pour Lea : Bonjour, Lea !)",
   "starter": "#include <stdio.h>\n\nint main(void) {\n    char nom[64];\n    scanf(\"%63s\", nom);\n    // TODO : affiche le message de salutation\n    return 0;\n}\n",
   "tests": [
    {
     "stdin": "Lea\n",
     "expected": "Bonjour, Lea !\n"
    },
    {
     "stdin": "Omar\n",
     "expected": "Bonjour, Omar !\n"
    },
    {
     "stdin": "ETO\n",
     "expected": "Bonjour, ETO !\n"
    }
   ],
   "concepts": [
    "input",
    "lecture",
    "entrée",
    "concaténation"
   ],
   "hints": [
    "Le prénom arrive par l'entrée standard : commence par le lire dans une variable, puis assemble le message avec le texte fixe.",
    "scanf a déjà rangé le prénom dans le tableau de caractères nom. Il faut un code de format pour l'afficher.",
    "Le code %s de printf insère une chaîne de caractères : printf(\"... %s ...\\n\", variable); n'oublie ni la virgule ni l'espace avant le point d'exclamation."
   ]
  },
  {
   "id": "c-04-mult3",
   "lang": "c",
   "level": 4,
   "xp": 25,
   "title": "La spirale des multiples",
   "story": "Chaque tour de spirale ajoute trois pas. Compte-les à voix haute, doucement.",
   "goal": "Affiche les multiples de 3 de 3 à 30 inclus, un par ligne (3, 6, 9, …, 30).",
   "starter": "#include <stdio.h>\n\nint main(void) {\n    // TODO : affiche les multiples de 3 de 3 à 30\n    for (int i = 1; i <= 3; i++) {\n        printf(\"%d\\n\", i);\n    }\n    return 0;\n}\n",
   "tests": [
    {
     "stdin": "",
     "expected": "3\n6\n9\n12\n15\n18\n21\n24\n27\n30\n"
    },
    {
     "stdin": "",
     "expected": "3\n6\n9\n12\n15\n18\n21\n24\n27\n30\n"
    }
   ],
   "concepts": [
    "boucle",
    "for",
    "pas",
    "multiple"
   ],
   "hints": [
    "Une boucle répète un bloc : réfléchis à la valeur de départ, à la valeur d'arrêt (incluse !) et à la façon d'avancer à chaque tour.",
    "Tu peux faire avancer le compteur d'une autre valeur que 1 à chaque tour.",
    "for (départ; condition; avance) : pars de 3, continue tant que i <= 30 et ajoute 3 à chaque tour avec i += 3."
   ]
  },
  {
   "id": "c-05-parity",
   "lang": "c",
   "level": 5,
   "xp": 30,
   "title": "Pair ou impair",
   "story": "Le yin et le yang des nombres : certains vont par deux, d'autres restent seuls. À toi de les départager.",
   "goal": "Lis un entier n. Affiche pair s'il est pair, sinon impair (en minuscules).",
   "starter": "#include <stdio.h>\n\nint main(void) {\n    int n;\n    scanf(\"%d\", &n);\n    // TODO : affiche pair ou impair\n    return 0;\n}\n",
   "tests": [
    {
     "stdin": "4\n",
     "expected": "pair\n"
    },
    {
     "stdin": "7\n",
     "expected": "impair\n"
    },
    {
     "stdin": "0\n",
     "expected": "pair\n"
    },
    {
     "stdin": "-3\n",
     "expected": "impair\n"
    }
   ],
   "concepts": [
    "condition",
    "if",
    "else",
    "modulo",
    "reste"
   ],
   "hints": [
    "Un nombre est pair quand la division par 2 ne laisse aucun reste. Quel opérateur donne ce reste ?",
    "L'opérateur % donne le reste de la division entière. Compare-le à 0 avec ==.",
    "Structure : if (condition) { ... } else { ... }. Attention : en C, -3 % 2 vaut -1, donc teste « == 0 » plutôt que « == 1 »."
   ]
  },
  {
   "id": "c-06-fact",
   "lang": "c",
   "level": 6,
   "xp": 35,
   "title": "La fabrique de factorielles",
   "story": "Les grands nombres naissent de petits : multiplie-les tous, un à un, et range ce savoir-faire dans une fonction.",
   "goal": "Écris une fonction factorielle(n), lis un entier n (0 ≤ n ≤ 12) et affiche n!  (1 × 2 × … × n ; rappel : 0! = 1).",
   "starter": "#include <stdio.h>\n\nlong long factorielle(int n) {\n    // TODO : renvoie n! (0! vaut 1)\n    return 0;\n}\n\nint main(void) {\n    int n;\n    scanf(\"%d\", &n);\n    printf(\"%lld\\n\", factorielle(n));\n    return 0;\n}\n",
   "tests": [
    {
     "stdin": "5\n",
     "expected": "120\n"
    },
    {
     "stdin": "0\n",
     "expected": "1\n"
    },
    {
     "stdin": "1\n",
     "expected": "1\n"
    },
    {
     "stdin": "10\n",
     "expected": "3628800\n"
    }
   ],
   "concepts": [
    "fonction",
    "return",
    "boucle",
    "factorielle"
   ],
   "hints": [
    "n! = 1 × 2 × … × n, et 0! vaut 1. Isole ce calcul dans une fonction qui reçoit n et renvoie le résultat.",
    "Pars d'un cumul qui vaut 1, puis multiplie-le successivement par chaque entier de 2 à n.",
    "Une boucle for avec i de 2 à n inclus, une multiplication du cumul par i dans le corps, et renvoie le cumul à la fin. Si n vaut 0 ou 1, la boucle ne tourne pas."
   ]
  },
  {
   "id": "c-07-array",
   "lang": "c",
   "level": 7,
   "xp": 40,
   "title": "Le grimoire de nombres",
   "story": "Une liste, c'est un grimoire où chaque case garde un secret. Feuillette-le et fais-en le bilan.",
   "goal": "Première ligne : le nombre N de valeurs. Deuxième ligne : les N entiers séparés par des espaces. Affiche leur somme, puis sur la ligne suivante le plus grand.",
   "starter": "#include <stdio.h>\n\nint main(void) {\n    int n;\n    scanf(\"%d\", &n);\n    // TODO : lis les n nombres, puis affiche la somme et le maximum (une ligne chacun)\n    return 0;\n}\n",
   "tests": [
    {
     "stdin": "5\n3 9 2 7 4\n",
     "expected": "25\n9\n"
    },
    {
     "stdin": "1\n42\n",
     "expected": "42\n42\n"
    },
    {
     "stdin": "4\n-5 -2 -8 -1\n",
     "expected": "-16\n-1\n"
    }
   ],
   "concepts": [
    "liste",
    "tableau",
    "somme",
    "maximum",
    "boucle"
   ],
   "hints": [
    "Lis d'abord combien il y a de nombres, puis les nombres eux-mêmes ; garde un cumul pour la somme et retiens le plus grand vu jusqu'ici.",
    "Lis les nombres un par un dans une boucle de n tours, en mettant à jour deux variables au fil de l'eau.",
    "À chaque tour : scanf dans une variable x, ajoute x au cumul, et remplace le maximum si x le dépasse (le premier nombre lu sert de maximum de départ)."
   ]
  },
  {
   "id": "c-08-rev",
   "lang": "c",
   "level": 8,
   "xp": 45,
   "title": "Le miroir de lettres",
   "story": "Dans le miroir de l'étang, les mots se lisent à l'envers. Montre-moi ce que l'eau reflète.",
   "goal": "Lis un mot (sans espace) et affiche-le à l'envers (ETO devient OTE).",
   "starter": "#include <stdio.h>\n#include <string.h>\n\nint main(void) {\n    char mot[100];\n    scanf(\"%99s\", mot);\n    int taille = (int)strlen(mot);\n    // TODO : affiche le mot à l'envers\n    return 0;\n}\n",
   "tests": [
    {
     "stdin": "ETO\n",
     "expected": "OTE\n"
    },
    {
     "stdin": "radar\n",
     "expected": "radar\n"
    },
    {
     "stdin": "bonjour\n",
     "expected": "ruojnob\n"
    },
    {
     "stdin": "Python\n",
     "expected": "nohtyP\n"
    }
   ],
   "concepts": [
    "chaîne",
    "inverser",
    "reverse",
    "string"
   ],
   "hints": [
    "Pour inverser un mot, il suffit de le parcourir de la fin vers le début en lisant chaque lettre.",
    "Une boucle peut aussi compter à rebours : part du dernier indice et descends jusqu'à 0.",
    "Les indices d'un mot de taille t vont de 0 à t - 1. Affiche chaque lettre avec putchar ou printf(\"%c\", ...), puis termine par un retour à la ligne."
   ]
  },
  {
   "id": "cpp-01-hello",
   "lang": "cpp",
   "level": 1,
   "xp": 10,
   "title": "Premier mot",
   "story": "Bienvenue, voyageur. Tout grand périple commence par un mot : fais parler ton programme.",
   "goal": "Affiche exactement : Bonjour ETO",
   "starter": "#include <iostream>\nusing namespace std;\n\nint main() {\n    // TODO : affiche le message demandé\n    return 0;\n}\n",
   "tests": [
    {
     "stdin": "",
     "expected": "Bonjour ETO\n"
    },
    {
     "stdin": "",
     "expected": "Bonjour ETO\n"
    }
   ],
   "concepts": [
    "print",
    "afficher",
    "texte"
   ],
   "hints": [
    "Cherche l'instruction qui affiche du texte à l'écran, puis recopie le message demandé à l'identique (majuscules comprises).",
    "En C++, le flux cout (de <iostream>) affiche du texte avec l'opérateur <<.",
    "cout << \"ton texte\" << endl; — endl termine la ligne."
   ]
  },
  {
   "id": "cpp-02-vars",
   "lang": "cpp",
   "level": 2,
   "xp": 15,
   "title": "Les boîtes magiques",
   "story": "Une variable, c'est une petite boîte qui garde une valeur. Remplis-en deux et laisse la machine calculer.",
   "goal": "Un lot contient 8 paquets de 12 cartes. Range ces deux nombres dans deux variables (paquets et cartes) et affiche le nombre total de cartes.",
   "starter": "#include <iostream>\nusing namespace std;\n\nint main() {\n    int paquets = 8;\n    // TODO : crée la variable cartes, puis affiche le total\n    return 0;\n}\n",
   "tests": [
    {
     "stdin": "",
     "expected": "96\n"
    },
    {
     "stdin": "",
     "expected": "96\n"
    }
   ],
   "concepts": [
    "variable",
    "multiplication",
    "calcul"
   ],
   "hints": [
    "Garde chaque nombre dans une variable au nom clair, puis laisse le langage faire le calcul à ta place.",
    "Déclare une seconde variable de type int, puis multiplie avec *.",
    "cout accepte directement un nombre ou un calcul : cout << expression << endl; — pas de code de format ni de guillemets autour des variables."
   ]
  },
  {
   "id": "cpp-03-greet",
   "lang": "cpp",
   "level": 3,
   "xp": 20,
   "title": "Salut, voyageur",
   "story": "Un bon guide demande ton nom avant de partir. Écoute ce que le clavier lui envoie.",
   "goal": "Lis un prénom au clavier et affiche : Bonjour, <prénom> !  (exemple pour Lea : Bonjour, Lea !)",
   "starter": "#include <iostream>\n#include <string>\nusing namespace std;\n\nint main() {\n    string nom;\n    cin >> nom;\n    // TODO : affiche le message de salutation\n    return 0;\n}\n",
   "tests": [
    {
     "stdin": "Lea\n",
     "expected": "Bonjour, Lea !\n"
    },
    {
     "stdin": "Omar\n",
     "expected": "Bonjour, Omar !\n"
    },
    {
     "stdin": "ETO\n",
     "expected": "Bonjour, ETO !\n"
    }
   ],
   "concepts": [
    "input",
    "lecture",
    "entrée",
    "concaténation"
   ],
   "hints": [
    "Le prénom arrive par l'entrée standard : commence par le lire dans une variable, puis assemble le message avec le texte fixe.",
    "cin >> nom a déjà rangé le prénom dans la variable nom.",
    "Enchaîne plusieurs << : du texte, la variable, puis encore du texte. Attention à la virgule et à l'espace avant le point d'exclamation."
   ]
  },
  {
   "id": "cpp-04-mult3",
   "lang": "cpp",
   "level": 4,
   "xp": 25,
   "title": "La spirale des multiples",
   "story": "Chaque tour de spirale ajoute trois pas. Compte-les à voix haute, doucement.",
   "goal": "Affiche les multiples de 3 de 3 à 30 inclus, un par ligne (3, 6, 9, …, 30).",
   "starter": "#include <iostream>\nusing namespace std;\n\nint main() {\n    // TODO : affiche les multiples de 3 de 3 à 30\n    for (int i = 1; i <= 3; i++) {\n        cout << i << endl;\n    }\n    return 0;\n}\n",
   "tests": [
    {
     "stdin": "",
     "expected": "3\n6\n9\n12\n15\n18\n21\n24\n27\n30\n"
    },
    {
     "stdin": "",
     "expected": "3\n6\n9\n12\n15\n18\n21\n24\n27\n30\n"
    }
   ],
   "concepts": [
    "boucle",
    "for",
    "pas",
    "multiple"
   ],
   "hints": [
    "Une boucle répète un bloc : réfléchis à la valeur de départ, à la valeur d'arrêt (incluse !) et à la façon d'avancer à chaque tour.",
    "Tu peux faire avancer le compteur d'une autre valeur que 1 à chaque tour.",
    "for (départ; condition; avance) : pars de 3, continue tant que i <= 30 et ajoute 3 à chaque tour avec i += 3."
   ]
  },
  {
   "id": "cpp-05-parity",
   "lang": "cpp",
   "level": 5,
   "xp": 30,
   "title": "Pair ou impair",
   "story": "Le yin et le yang des nombres : certains vont par deux, d'autres restent seuls. À toi de les départager.",
   "goal": "Lis un entier n. Affiche pair s'il est pair, sinon impair (en minuscules).",
   "starter": "#include <iostream>\nusing namespace std;\n\nint main() {\n    int n;\n    cin >> n;\n    // TODO : affiche pair ou impair\n    return 0;\n}\n",
   "tests": [
    {
     "stdin": "4\n",
     "expected": "pair\n"
    },
    {
     "stdin": "7\n",
     "expected": "impair\n"
    },
    {
     "stdin": "0\n",
     "expected": "pair\n"
    },
    {
     "stdin": "-3\n",
     "expected": "impair\n"
    }
   ],
   "concepts": [
    "condition",
    "if",
    "else",
    "modulo",
    "reste"
   ],
   "hints": [
    "Un nombre est pair quand la division par 2 ne laisse aucun reste. Quel opérateur donne ce reste ?",
    "L'opérateur % donne le reste de la division entière. Compare-le à 0 avec ==.",
    "Structure : if (condition) { ... } else { ... }. Attention : en C++, -3 % 2 vaut -1, donc teste « == 0 » plutôt que « == 1 »."
   ]
  },
  {
   "id": "cpp-06-fact",
   "lang": "cpp",
   "level": 6,
   "xp": 35,
   "title": "La fabrique de factorielles",
   "story": "Les grands nombres naissent de petits : multiplie-les tous, un à un, et range ce savoir-faire dans une fonction.",
   "goal": "Écris une fonction factorielle(n), lis un entier n (0 ≤ n ≤ 12) et affiche n!  (1 × 2 × … × n ; rappel : 0! = 1).",
   "starter": "#include <iostream>\nusing namespace std;\n\nlong long factorielle(int n) {\n    // TODO : renvoie n! (0! vaut 1)\n    return 0;\n}\n\nint main() {\n    int n;\n    cin >> n;\n    cout << factorielle(n) << endl;\n    return 0;\n}\n",
   "tests": [
    {
     "stdin": "5\n",
     "expected": "120\n"
    },
    {
     "stdin": "0\n",
     "expected": "1\n"
    },
    {
     "stdin": "1\n",
     "expected": "1\n"
    },
    {
     "stdin": "10\n",
     "expected": "3628800\n"
    }
   ],
   "concepts": [
    "fonction",
    "return",
    "boucle",
    "factorielle"
   ],
   "hints": [
    "n! = 1 × 2 × … × n, et 0! vaut 1. Isole ce calcul dans une fonction qui reçoit n et renvoie le résultat.",
    "Pars d'un cumul qui vaut 1, puis multiplie-le successivement par chaque entier de 2 à n.",
    "Une boucle for avec i de 2 à n inclus, une multiplication du cumul par i dans le corps, et renvoie le cumul à la fin. Si n vaut 0 ou 1, la boucle ne tourne pas."
   ]
  },
  {
   "id": "cpp-07-array",
   "lang": "cpp",
   "level": 7,
   "xp": 40,
   "title": "Le grimoire de nombres",
   "story": "Une liste, c'est un grimoire où chaque case garde un secret. Feuillette-le et fais-en le bilan.",
   "goal": "Première ligne : le nombre N de valeurs. Deuxième ligne : les N entiers séparés par des espaces. Affiche leur somme, puis sur la ligne suivante le plus grand.",
   "starter": "#include <iostream>\n#include <vector>\nusing namespace std;\n\nint main() {\n    int n;\n    cin >> n;\n    vector<int> v(n);\n    // TODO : lis les n nombres, puis affiche la somme et le maximum (une ligne chacun)\n    return 0;\n}\n",
   "tests": [
    {
     "stdin": "5\n3 9 2 7 4\n",
     "expected": "25\n9\n"
    },
    {
     "stdin": "1\n42\n",
     "expected": "42\n42\n"
    },
    {
     "stdin": "4\n-5 -2 -8 -1\n",
     "expected": "-16\n-1\n"
    }
   ],
   "concepts": [
    "liste",
    "tableau",
    "somme",
    "maximum",
    "boucle"
   ],
   "hints": [
    "Lis d'abord combien il y a de nombres, puis les nombres eux-mêmes ; garde un cumul pour la somme et retiens le plus grand vu jusqu'ici.",
    "Remplis le vector avec cin dans une boucle de n tours, puis calcule la somme et le maximum.",
    "Le maximum : pars du premier élément v[0], parcours tout le vecteur et remplace-le dès qu'un élément le dépasse. Affiche chaque résultat sur sa propre ligne."
   ]
  },
  {
   "id": "cpp-08-rev",
   "lang": "cpp",
   "level": 8,
   "xp": 45,
   "title": "Le miroir de lettres",
   "story": "Dans le miroir de l'étang, les mots se lisent à l'envers. Montre-moi ce que l'eau reflète.",
   "goal": "Lis un mot (sans espace) et affiche-le à l'envers (ETO devient OTE).",
   "starter": "#include <iostream>\n#include <string>\nusing namespace std;\n\nint main() {\n    string mot;\n    cin >> mot;\n    // TODO : affiche le mot à l'envers\n    return 0;\n}\n",
   "tests": [
    {
     "stdin": "ETO\n",
     "expected": "OTE\n"
    },
    {
     "stdin": "radar\n",
     "expected": "radar\n"
    },
    {
     "stdin": "bonjour\n",
     "expected": "ruojnob\n"
    },
    {
     "stdin": "Python\n",
     "expected": "nohtyP\n"
    }
   ],
   "concepts": [
    "chaîne",
    "inverser",
    "reverse",
    "string"
   ],
   "hints": [
    "Pour inverser un mot, il suffit de le parcourir de la fin vers le début en lisant chaque lettre.",
    "Une boucle peut compter à rebours : part du dernier indice et descends jusqu'à 0. mot.size() donne la taille.",
    "Les indices d'un mot de taille t vont de 0 à t - 1. Affiche chaque lettre avec cout << mot[i], puis termine par endl. (Variante : la bibliothèque <algorithm> propose reverse.)"
   ]
  },
  {
   "id": "java-01-hello",
   "lang": "java",
   "level": 1,
   "xp": 10,
   "title": "Premier mot",
   "story": "Bienvenue, voyageur. Tout grand périple commence par un mot : fais parler ton programme.",
   "goal": "Affiche exactement : Bonjour ETO",
   "starter": "import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        // TODO : affiche le message demandé\n    }\n}\n",
   "tests": [
    {
     "stdin": "",
     "expected": "Bonjour ETO\n"
    },
    {
     "stdin": "",
     "expected": "Bonjour ETO\n"
    }
   ],
   "concepts": [
    "print",
    "afficher",
    "texte"
   ],
   "hints": [
    "Cherche l'instruction qui affiche du texte à l'écran, puis recopie le message demandé à l'identique (majuscules comprises).",
    "En Java, tout vit dans une classe. L'affichage passe par System.out.",
    "System.out.println(\"ton texte\"); ajoute un retour à la ligne après le texte."
   ]
  },
  {
   "id": "java-02-vars",
   "lang": "java",
   "level": 2,
   "xp": 15,
   "title": "Les boîtes magiques",
   "story": "Une variable, c'est une petite boîte qui garde une valeur. Remplis-en deux et laisse la machine calculer.",
   "goal": "Un lot contient 8 paquets de 12 cartes. Range ces deux nombres dans deux variables (paquets et cartes) et affiche le nombre total de cartes.",
   "starter": "import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        int paquets = 8;\n        // TODO : crée la variable cartes, puis affiche le total\n    }\n}\n",
   "tests": [
    {
     "stdin": "",
     "expected": "96\n"
    },
    {
     "stdin": "",
     "expected": "96\n"
    }
   ],
   "concepts": [
    "variable",
    "multiplication",
    "calcul"
   ],
   "hints": [
    "Garde chaque nombre dans une variable au nom clair, puis laisse le langage faire le calcul à ta place.",
    "Déclare une seconde variable de type int, puis multiplie avec *.",
    "println accepte directement un calcul entre ses parenthèses ; pas de guillemets autour des variables."
   ]
  },
  {
   "id": "java-03-greet",
   "lang": "java",
   "level": 3,
   "xp": 20,
   "title": "Salut, voyageur",
   "story": "Un bon guide demande ton nom avant de partir. Écoute ce que le clavier lui envoie.",
   "goal": "Lis un prénom au clavier et affiche : Bonjour, <prénom> !  (exemple pour Lea : Bonjour, Lea !)",
   "starter": "import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        String nom = sc.nextLine();\n        // TODO : affiche le message de salutation\n    }\n}\n",
   "tests": [
    {
     "stdin": "Lea\n",
     "expected": "Bonjour, Lea !\n"
    },
    {
     "stdin": "Omar\n",
     "expected": "Bonjour, Omar !\n"
    },
    {
     "stdin": "ETO\n",
     "expected": "Bonjour, ETO !\n"
    }
   ],
   "concepts": [
    "input",
    "lecture",
    "entrée",
    "concaténation"
   ],
   "hints": [
    "Le prénom arrive par l'entrée standard : commence par le lire dans une variable, puis assemble le message avec le texte fixe.",
    "Le Scanner a déjà lu le prénom dans la variable nom.",
    "Assemble le texte avec l'opérateur + entre des morceaux de texte et la variable. Attention à la virgule et à l'espace avant le point d'exclamation."
   ]
  },
  {
   "id": "java-04-mult3",
   "lang": "java",
   "level": 4,
   "xp": 25,
   "title": "La spirale des multiples",
   "story": "Chaque tour de spirale ajoute trois pas. Compte-les à voix haute, doucement.",
   "goal": "Affiche les multiples de 3 de 3 à 30 inclus, un par ligne (3, 6, 9, …, 30).",
   "starter": "import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        // TODO : affiche les multiples de 3 de 3 à 30\n        for (int i = 1; i <= 3; i++) {\n            System.out.println(i);\n        }\n    }\n}\n",
   "tests": [
    {
     "stdin": "",
     "expected": "3\n6\n9\n12\n15\n18\n21\n24\n27\n30\n"
    },
    {
     "stdin": "",
     "expected": "3\n6\n9\n12\n15\n18\n21\n24\n27\n30\n"
    }
   ],
   "concepts": [
    "boucle",
    "for",
    "pas",
    "multiple"
   ],
   "hints": [
    "Une boucle répète un bloc : réfléchis à la valeur de départ, à la valeur d'arrêt (incluse !) et à la façon d'avancer à chaque tour.",
    "Tu peux faire avancer le compteur d'une autre valeur que 1 à chaque tour.",
    "for (départ; condition; avance) : pars de 3, continue tant que i <= 30 et ajoute 3 à chaque tour avec i += 3."
   ]
  },
  {
   "id": "java-05-parity",
   "lang": "java",
   "level": 5,
   "xp": 30,
   "title": "Pair ou impair",
   "story": "Le yin et le yang des nombres : certains vont par deux, d'autres restent seuls. À toi de les départager.",
   "goal": "Lis un entier n. Affiche pair s'il est pair, sinon impair (en minuscules).",
   "starter": "import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        // TODO : affiche pair ou impair\n    }\n}\n",
   "tests": [
    {
     "stdin": "4\n",
     "expected": "pair\n"
    },
    {
     "stdin": "7\n",
     "expected": "impair\n"
    },
    {
     "stdin": "0\n",
     "expected": "pair\n"
    },
    {
     "stdin": "-3\n",
     "expected": "impair\n"
    }
   ],
   "concepts": [
    "condition",
    "if",
    "else",
    "modulo",
    "reste"
   ],
   "hints": [
    "Un nombre est pair quand la division par 2 ne laisse aucun reste. Quel opérateur donne ce reste ?",
    "L'opérateur % donne le reste de la division entière. Compare-le à 0 avec ==.",
    "Structure : if (condition) { ... } else { ... }. Attention : en Java, -3 % 2 vaut -1, donc teste « == 0 » plutôt que « == 1 »."
   ]
  },
  {
   "id": "java-06-fact",
   "lang": "java",
   "level": 6,
   "xp": 35,
   "title": "La fabrique de factorielles",
   "story": "Les grands nombres naissent de petits : multiplie-les tous, un à un, et range ce savoir-faire dans une fonction.",
   "goal": "Écris une fonction factorielle(n), lis un entier n (0 ≤ n ≤ 12) et affiche n!  (1 × 2 × … × n ; rappel : 0! = 1).",
   "starter": "import java.util.Scanner;\n\npublic class Main {\n    static long factorielle(int n) {\n        // TODO : renvoie n! (0! vaut 1)\n        return 0;\n    }\n\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        System.out.println(factorielle(n));\n    }\n}\n",
   "tests": [
    {
     "stdin": "5\n",
     "expected": "120\n"
    },
    {
     "stdin": "0\n",
     "expected": "1\n"
    },
    {
     "stdin": "1\n",
     "expected": "1\n"
    },
    {
     "stdin": "10\n",
     "expected": "3628800\n"
    }
   ],
   "concepts": [
    "fonction",
    "return",
    "boucle",
    "factorielle"
   ],
   "hints": [
    "n! = 1 × 2 × … × n, et 0! vaut 1. Isole ce calcul dans une fonction qui reçoit n et renvoie le résultat.",
    "Pars d'un cumul qui vaut 1, puis multiplie-le successivement par chaque entier de 2 à n.",
    "Une boucle for avec i de 2 à n inclus, une multiplication du cumul par i dans le corps, et renvoie le cumul à la fin. Si n vaut 0 ou 1, la boucle ne tourne pas."
   ]
  },
  {
   "id": "java-07-array",
   "lang": "java",
   "level": 7,
   "xp": 40,
   "title": "Le grimoire de nombres",
   "story": "Une liste, c'est un grimoire où chaque case garde un secret. Feuillette-le et fais-en le bilan.",
   "goal": "Première ligne : le nombre N de valeurs. Deuxième ligne : les N entiers séparés par des espaces. Affiche leur somme, puis sur la ligne suivante le plus grand.",
   "starter": "import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        // TODO : lis les n nombres, puis affiche la somme et le maximum (une ligne chacun)\n    }\n}\n",
   "tests": [
    {
     "stdin": "5\n3 9 2 7 4\n",
     "expected": "25\n9\n"
    },
    {
     "stdin": "1\n42\n",
     "expected": "42\n42\n"
    },
    {
     "stdin": "4\n-5 -2 -8 -1\n",
     "expected": "-16\n-1\n"
    }
   ],
   "concepts": [
    "liste",
    "tableau",
    "somme",
    "maximum",
    "boucle"
   ],
   "hints": [
    "Lis d'abord combien il y a de nombres, puis les nombres eux-mêmes ; garde un cumul pour la somme et retiens le plus grand vu jusqu'ici.",
    "Lis les nombres un par un dans une boucle de n tours, en mettant à jour deux variables au fil de l'eau.",
    "À chaque tour : nextInt() dans une variable x, ajoute x au cumul, et remplace le maximum si x le dépasse (Integer.MIN_VALUE est un bon maximum de départ)."
   ]
  },
  {
   "id": "java-08-rev",
   "lang": "java",
   "level": 8,
   "xp": 45,
   "title": "Le miroir de lettres",
   "story": "Dans le miroir de l'étang, les mots se lisent à l'envers. Montre-moi ce que l'eau reflète.",
   "goal": "Lis un mot (sans espace) et affiche-le à l'envers (ETO devient OTE).",
   "starter": "import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        String mot = sc.next();\n        // TODO : affiche le mot à l'envers\n    }\n}\n",
   "tests": [
    {
     "stdin": "ETO\n",
     "expected": "OTE\n"
    },
    {
     "stdin": "radar\n",
     "expected": "radar\n"
    },
    {
     "stdin": "bonjour\n",
     "expected": "ruojnob\n"
    },
    {
     "stdin": "Python\n",
     "expected": "nohtyP\n"
    }
   ],
   "concepts": [
    "chaîne",
    "inverser",
    "reverse",
    "string"
   ],
   "hints": [
    "Pour inverser un mot, il suffit de le parcourir de la fin vers le début en lisant chaque lettre.",
    "Une String ne s'inverse pas toute seule, mais une autre classe de texte sait le faire.",
    "StringBuilder possède une méthode reverse() ; construis-en un à partir du mot, inverse-le, puis reconvertis-le en String avec toString()."
   ]
  },
  {
   "id": "sql-01-select",
   "lang": "sql",
   "level": 1,
   "xp": 10,
   "title": "Appel des élèves",
   "story": "Une base de données, c'est une grande bibliothèque bien rangée. Commence par lire un seul rayon.",
   "goal": "Affiche le nom de tous les élèves (table eleves), dans l'ordre de la table.",
   "starter": "-- Deux tables sont déjà prêtes :\n--   eleves(id, nom, classe, note)\n--   clubs(eleve_id, club)\nCREATE TABLE eleves (id INTEGER PRIMARY KEY, nom TEXT, classe TEXT, note INTEGER);\nINSERT INTO eleves VALUES (1, 'Alice', 'A', 15), (2, 'Bruno', 'B', 9), (3, 'Chloe', 'A', 18),\n  (4, 'David', 'B', 12), (5, 'Emma', 'C', 7), (6, 'Farid', 'C', 14);\nCREATE TABLE clubs (eleve_id INTEGER, club TEXT);\nINSERT INTO clubs VALUES (1, 'Echecs'), (3, 'Echecs'), (3, 'Theatre'), (4, 'Theatre'), (6, 'Echecs');\n\n-- TODO : affiche les noms des élèves\n",
   "tests": [
    {
     "stdin": "",
     "expected": "Alice\nBruno\nChloe\nDavid\nEmma\nFarid\n"
    },
    {
     "stdin": "",
     "expected": "Alice\nBruno\nChloe\nDavid\nEmma\nFarid\n"
    }
   ],
   "concepts": [
    "select",
    "from"
   ],
   "hints": [
    "Pour lire des données, on pose une question à la table : quelles colonnes, et depuis quelle table ?",
    "Le mot-clé SELECT choisit les colonnes, FROM désigne la table.",
    "Structure : SELECT colonne FROM table; — sans oublier le point-virgule final."
   ],
   "compare": "tokens"
  },
  {
   "id": "sql-02-where",
   "lang": "sql",
   "level": 2,
   "xp": 15,
   "title": "Les bons élèves",
   "story": "Trier le bon grain, c'est poser la bonne condition.",
   "goal": "Affiche le nom et la note des élèves qui ont une note supérieure ou égale à 12 (ordre de la table).",
   "starter": "-- Deux tables sont déjà prêtes :\n--   eleves(id, nom, classe, note)\n--   clubs(eleve_id, club)\nCREATE TABLE eleves (id INTEGER PRIMARY KEY, nom TEXT, classe TEXT, note INTEGER);\nINSERT INTO eleves VALUES (1, 'Alice', 'A', 15), (2, 'Bruno', 'B', 9), (3, 'Chloe', 'A', 18),\n  (4, 'David', 'B', 12), (5, 'Emma', 'C', 7), (6, 'Farid', 'C', 14);\nCREATE TABLE clubs (eleve_id INTEGER, club TEXT);\nINSERT INTO clubs VALUES (1, 'Echecs'), (3, 'Echecs'), (3, 'Theatre'), (4, 'Theatre'), (6, 'Echecs');\n\n-- TODO : affiche nom et note des élèves ayant au moins 12\n",
   "tests": [
    {
     "stdin": "",
     "expected": "Alice 15\nChloe 18\nDavid 12\nFarid 14\n"
    },
    {
     "stdin": "",
     "expected": "Alice 15\nChloe 18\nDavid 12\nFarid 14\n"
    }
   ],
   "concepts": [
    "where",
    "condition",
    "comparaison"
   ],
   "hints": [
    "Tu veux garder seulement certaines lignes : il faut un filtre.",
    "La clause WHERE se place après FROM et contient une condition de comparaison.",
    "Structure : SELECT col1, col2 FROM table WHERE colonne >= valeur; — deux colonnes se séparent par une virgule."
   ],
   "compare": "tokens"
  },
  {
   "id": "sql-03-order",
   "lang": "sql",
   "level": 3,
   "xp": 20,
   "title": "Le podium",
   "story": "Chaque effort mérite son rang. Dresse le podium, du meilleur au plus modeste.",
   "goal": "Affiche le nom et la note de tous les élèves, de la meilleure note à la moins bonne.",
   "starter": "-- Deux tables sont déjà prêtes :\n--   eleves(id, nom, classe, note)\n--   clubs(eleve_id, club)\nCREATE TABLE eleves (id INTEGER PRIMARY KEY, nom TEXT, classe TEXT, note INTEGER);\nINSERT INTO eleves VALUES (1, 'Alice', 'A', 15), (2, 'Bruno', 'B', 9), (3, 'Chloe', 'A', 18),\n  (4, 'David', 'B', 12), (5, 'Emma', 'C', 7), (6, 'Farid', 'C', 14);\nCREATE TABLE clubs (eleve_id INTEGER, club TEXT);\nINSERT INTO clubs VALUES (1, 'Echecs'), (3, 'Echecs'), (3, 'Theatre'), (4, 'Theatre'), (6, 'Echecs');\n\n-- TODO : affiche nom et note, du meilleur au moins bon\n",
   "tests": [
    {
     "stdin": "",
     "expected": "Chloe 18\nAlice 15\nFarid 14\nDavid 12\nBruno 9\nEmma 7\n"
    },
    {
     "stdin": "",
     "expected": "Chloe 18\nAlice 15\nFarid 14\nDavid 12\nBruno 9\nEmma 7\n"
    }
   ],
   "concepts": [
    "order by",
    "desc",
    "tri"
   ],
   "hints": [
    "L'ordre d'affichage n'est garanti que si tu le demandes explicitement.",
    "La clause ORDER BY trie les résultats ; un mot-clé permet d'inverser le sens du tri (décroissant).",
    "Structure : SELECT ... FROM table ORDER BY colonne DESC; (ASC pour croissant, valeur par défaut)."
   ],
   "compare": "tokens"
  },
  {
   "id": "sql-04-agg",
   "lang": "sql",
   "level": 4,
   "xp": 25,
   "title": "Le bilan",
   "story": "Un sage ne regarde pas chaque arbre, il regarde la forêt. Résume toute la classe en une ligne.",
   "goal": "En une seule ligne, affiche : le nombre d'élèves, la moyenne des notes, puis la note maximale.",
   "starter": "-- Deux tables sont déjà prêtes :\n--   eleves(id, nom, classe, note)\n--   clubs(eleve_id, club)\nCREATE TABLE eleves (id INTEGER PRIMARY KEY, nom TEXT, classe TEXT, note INTEGER);\nINSERT INTO eleves VALUES (1, 'Alice', 'A', 15), (2, 'Bruno', 'B', 9), (3, 'Chloe', 'A', 18),\n  (4, 'David', 'B', 12), (5, 'Emma', 'C', 7), (6, 'Farid', 'C', 14);\nCREATE TABLE clubs (eleve_id INTEGER, club TEXT);\nINSERT INTO clubs VALUES (1, 'Echecs'), (3, 'Echecs'), (3, 'Theatre'), (4, 'Theatre'), (6, 'Echecs');\n\n-- TODO : affiche effectif, moyenne et note maximale\n",
   "tests": [
    {
     "stdin": "",
     "expected": "6 12.5 18\n"
    },
    {
     "stdin": "",
     "expected": "6 12.5 18\n"
    }
   ],
   "concepts": [
    "count",
    "avg",
    "max",
    "agrégation"
   ],
   "hints": [
    "Tu veux un résumé de plusieurs lignes en une seule : il existe des fonctions d'agrégation.",
    "COUNT(*) compte les lignes, AVG(colonne) fait la moyenne, MAX(colonne) donne le maximum.",
    "Mets les trois fonctions dans un même SELECT, séparées par des virgules, avec FROM eleves."
   ],
   "compare": "tokens"
  },
  {
   "id": "sql-05-group",
   "lang": "sql",
   "level": 5,
   "xp": 30,
   "title": "Bilan par classe",
   "story": "Chaque classe a son caractère. Regroupe les élèves et fais le point sur chaque tribu.",
   "goal": "Pour chaque classe, affiche la classe, le nombre d'élèves et la moyenne des notes, dans l'ordre alphabétique des classes.",
   "starter": "-- Deux tables sont déjà prêtes :\n--   eleves(id, nom, classe, note)\n--   clubs(eleve_id, club)\nCREATE TABLE eleves (id INTEGER PRIMARY KEY, nom TEXT, classe TEXT, note INTEGER);\nINSERT INTO eleves VALUES (1, 'Alice', 'A', 15), (2, 'Bruno', 'B', 9), (3, 'Chloe', 'A', 18),\n  (4, 'David', 'B', 12), (5, 'Emma', 'C', 7), (6, 'Farid', 'C', 14);\nCREATE TABLE clubs (eleve_id INTEGER, club TEXT);\nINSERT INTO clubs VALUES (1, 'Echecs'), (3, 'Echecs'), (3, 'Theatre'), (4, 'Theatre'), (6, 'Echecs');\n\n-- TODO : affiche classe, effectif et moyenne par classe\n",
   "tests": [
    {
     "stdin": "",
     "expected": "A 2 16.5\nB 2 10.5\nC 2 10.5\n"
    },
    {
     "stdin": "",
     "expected": "A 2 16.5\nB 2 10.5\nC 2 10.5\n"
    }
   ],
   "concepts": [
    "group by",
    "count",
    "avg",
    "agrégation"
   ],
   "hints": [
    "Le bilan doit être refait pour chaque classe séparément : il faut former des groupes.",
    "GROUP BY colonne regroupe les lignes qui ont la même valeur, et les fonctions d'agrégation s'appliquent à chaque groupe.",
    "Structure : SELECT classe, fonction(...), fonction(...) FROM eleves GROUP BY classe ORDER BY classe;"
   ],
   "compare": "tokens"
  },
  {
   "id": "sql-06-join",
   "lang": "sql",
   "level": 6,
   "xp": 35,
   "title": "Les clubs de l'école",
   "story": "Les informations voyagent en couples : relie deux tables par ce qu'elles ont en commun.",
   "goal": "Affiche le nom de chaque élève suivi du club auquel il est inscrit (tables eleves et clubs), trié par nom puis par club.",
   "starter": "-- Deux tables sont déjà prêtes :\n--   eleves(id, nom, classe, note)\n--   clubs(eleve_id, club)\nCREATE TABLE eleves (id INTEGER PRIMARY KEY, nom TEXT, classe TEXT, note INTEGER);\nINSERT INTO eleves VALUES (1, 'Alice', 'A', 15), (2, 'Bruno', 'B', 9), (3, 'Chloe', 'A', 18),\n  (4, 'David', 'B', 12), (5, 'Emma', 'C', 7), (6, 'Farid', 'C', 14);\nCREATE TABLE clubs (eleve_id INTEGER, club TEXT);\nINSERT INTO clubs VALUES (1, 'Echecs'), (3, 'Echecs'), (3, 'Theatre'), (4, 'Theatre'), (6, 'Echecs');\n\n-- TODO : affiche chaque élève avec son club\n",
   "tests": [
    {
     "stdin": "",
     "expected": "Alice Echecs\nChloe Echecs\nChloe Theatre\nDavid Theatre\nFarid Echecs\n"
    },
    {
     "stdin": "",
     "expected": "Alice Echecs\nChloe Echecs\nChloe Theatre\nDavid Theatre\nFarid Echecs\n"
    }
   ],
   "concepts": [
    "join",
    "on",
    "clé"
   ],
   "hints": [
    "Les noms sont dans une table, les clubs dans l'autre : il faut les relier par une colonne commune.",
    "JOIN ... ON associe les lignes de deux tables ; ici, eleves.id correspond à clubs.eleve_id.",
    "Structure : SELECT t1.col, t2.col FROM t1 JOIN t2 ON t1.cle = t2.cle ORDER BY ... ; préfixe les colonnes par le nom de leur table."
   ],
   "compare": "tokens"
  },
  {
   "id": "sh-01-hello",
   "lang": "shell",
   "level": 1,
   "xp": 10,
   "title": "Premier mot",
   "story": "Le terminal est ton carnet de voyage. Écris-y ton premier mot.",
   "goal": "Affiche exactement : Bonjour ETO",
   "starter": "#!/bin/bash\n# TODO : fais afficher le message demandé\n",
   "tests": [
    {
     "stdin": "",
     "expected": "Bonjour ETO\n"
    },
    {
     "stdin": "",
     "expected": "Bonjour ETO\n"
    }
   ],
   "concepts": [
    "echo",
    "afficher"
   ],
   "hints": [
    "Dans un script shell, une commande très simple écrit du texte à l'écran.",
    "La commande s'appelle echo ; elle est suivie du texte, de préférence entre guillemets.",
    "Forme : echo \"ton texte\" — recopie le message à l'identique."
   ]
  },
  {
   "id": "sh-02-vars",
   "lang": "shell",
   "level": 2,
   "xp": 15,
   "title": "Les boîtes magiques",
   "story": "En shell aussi, on range les choses dans des variables. Attention : pas d'espace autour du signe égal !",
   "goal": "Un lot contient 8 paquets de 12 cartes. Range ces nombres dans deux variables (paquets et cartes) et affiche le total.",
   "starter": "#!/bin/bash\npaquets=8\n# TODO : crée la variable cartes, puis affiche le total\n",
   "tests": [
    {
     "stdin": "",
     "expected": "96\n"
    },
    {
     "stdin": "",
     "expected": "96\n"
    }
   ],
   "concepts": [
    "variable",
    "arithmétique",
    "echo"
   ],
   "hints": [
    "Une variable shell se crée sans espace autour du signe =, et se relit avec un $ devant son nom.",
    "Pour calculer, utilise l'expansion arithmétique, qui s'écrit avec deux parenthèses précédées d'un dollar.",
    "Forme : echo $(( a * b )) où a et b sont tes variables (avec un $ ou sans, dans les doubles parenthèses)."
   ]
  },
  {
   "id": "sh-03-greet",
   "lang": "shell",
   "level": 3,
   "xp": 20,
   "title": "Salut, voyageur",
   "story": "Un bon guide demande ton nom avant de partir. Écoute ce que le clavier lui envoie.",
   "goal": "Lis un prénom au clavier et affiche : Bonjour, <prénom> !  (exemple pour Lea : Bonjour, Lea !)",
   "starter": "#!/bin/bash\nread nom\n# TODO : affiche le message de salutation\n",
   "tests": [
    {
     "stdin": "Lea\n",
     "expected": "Bonjour, Lea !\n"
    },
    {
     "stdin": "Omar\n",
     "expected": "Bonjour, Omar !\n"
    },
    {
     "stdin": "ETO\n",
     "expected": "Bonjour, ETO !\n"
    }
   ],
   "concepts": [
    "read",
    "variable",
    "echo"
   ],
   "hints": [
    "La commande read lit une ligne de l'entrée et la range dans une variable.",
    "Après read nom, relis la variable avec $nom, à l'intérieur de guillemets doubles pour insérer sa valeur dans le texte.",
    "Forme : echo \"texte $variable texte\" — attention à la virgule et à l'espace avant le point d'exclamation."
   ]
  },
  {
   "id": "sh-04-loop",
   "lang": "shell",
   "level": 4,
   "xp": 25,
   "title": "Les carrés du jardin",
   "story": "Dans le jardin zen, chaque parterre est un carré. Compte-les un à un.",
   "goal": "Affiche les carrés des nombres de 1 à 5 (1, 4, 9, 16, 25), un par ligne.",
   "starter": "#!/bin/bash\n# TODO : affiche les carrés de 1 à 5\nfor i in 1 2; do\n  echo $i\ndone\n",
   "tests": [
    {
     "stdin": "",
     "expected": "1\n4\n9\n16\n25\n"
    },
    {
     "stdin": "",
     "expected": "1\n4\n9\n16\n25\n"
    }
   ],
   "concepts": [
    "for",
    "boucle",
    "seq",
    "arithmétique"
   ],
   "hints": [
    "Une boucle for peut parcourir une liste de valeurs ; calcule le carré à chaque tour.",
    "for i in (liste de valeurs); do ... done — ou for i in $(seq 1 5). Le corps de la boucle se place entre do et done.",
    "À l'intérieur, echo $(( i * i )) affiche le carré du nombre courant."
   ]
  },
  {
   "id": "sh-05-cond",
   "lang": "shell",
   "level": 5,
   "xp": 30,
   "title": "Au carrefour des signes",
   "story": "Positif, négatif, ou juste au milieu : le zéro est un point d'équilibre.",
   "goal": "Lis un entier. Affiche positif s'il est > 0, negatif s'il est < 0, zero sinon (sans accent, en minuscules).",
   "starter": "#!/bin/bash\nread n\n# TODO : affiche positif, negatif ou zero\n",
   "tests": [
    {
     "stdin": "5\n",
     "expected": "positif\n"
    },
    {
     "stdin": "-3\n",
     "expected": "negatif\n"
    },
    {
     "stdin": "0\n",
     "expected": "zero\n"
    },
    {
     "stdin": "12\n",
     "expected": "positif\n"
    }
   ],
   "concepts": [
    "if",
    "elif",
    "test",
    "condition"
   ],
   "hints": [
    "Trois cas possibles : pense à une condition avec un cas intermédiaire.",
    "En shell, les comparaisons numériques s'écrivent dans des crochets avec -gt (plus grand que) et -lt (plus petit que). Structure : if ... then ... elif ... else ... fi.",
    "Forme : if [ \"$variable\" -gt 0 ]; then ... elif [ ... ]; then ... else ... fi — les espaces autour des crochets sont obligatoires."
   ]
  },
  {
   "id": "sh-06-sum",
   "lang": "shell",
   "level": 6,
   "xp": 35,
   "title": "La rivière de nombres",
   "story": "Les nombres coulent un à un comme l'eau d'une rivière. Recueille-les tous avant qu'ils ne s'écoulent.",
   "goal": "L'entrée contient plusieurs lignes, chacune avec un entier. Affiche la somme de tous ces entiers.",
   "starter": "#!/bin/bash\ntotal=0\n# TODO : lis chaque ligne et additionne-la à total\necho \"$total\"\n",
   "tests": [
    {
     "stdin": "1\n2\n3\n",
     "expected": "6\n"
    },
    {
     "stdin": "10\n-4\n7\n",
     "expected": "13\n"
    },
    {
     "stdin": "5\n",
     "expected": "5\n"
    }
   ],
   "concepts": [
    "while",
    "read",
    "somme",
    "boucle"
   ],
   "hints": [
    "Il faut relire l'entrée ligne après ligne jusqu'à ce qu'elle soit vide, en gardant un total.",
    "while read x; do ... done lit tant qu'il reste des lignes. Initialise total=0 avant la boucle.",
    "Dans la boucle, mets à jour avec l'expansion arithmétique : total=$(( total + x )) (la variable d'accumulation puis la valeur lue). Affiche total après done."
   ]
  },
  {
   "id": "sh-07-upper",
   "lang": "shell",
   "level": 7,
   "xp": 40,
   "title": "Le chuchoteur",
   "story": "Parfois il faut élever la voix. Mets un mot en majuscules et compte ses lettres.",
   "goal": "Lis un mot (lettres sans accent). Affiche-le en MAJUSCULES, puis sur la ligne suivante le nombre de ses caractères.",
   "starter": "#!/bin/bash\nread mot\n# TODO : affiche le mot en majuscules puis sa longueur\n",
   "tests": [
    {
     "stdin": "ETO\n",
     "expected": "ETO\n3\n"
    },
    {
     "stdin": "bonjour\n",
     "expected": "BONJOUR\n7\n"
    },
    {
     "stdin": "zen\n",
     "expected": "ZEN\n3\n"
    }
   ],
   "concepts": [
    "majuscules",
    "longueur",
    "expansion",
    "read"
   ],
   "hints": [
    "Bash sait transformer la casse et mesurer la longueur d'une variable à l'aide d'une expansion de paramètre.",
    "${variable^^} donne la version en majuscules ; ${#variable} donne le nombre de caractères.",
    "Fais deux echo : un avec l'expansion des majuscules, l'autre avec celle de la longueur, chacune entre ${ }."
   ]
  }
 ]
};
