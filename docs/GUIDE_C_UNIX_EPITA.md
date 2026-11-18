# Guide C / Unix — les 5 exercices (insertion_sort, fctptr_cmd, sed, 80cols.sh, 80cols_grep)

Ce guide t'apprend les **notions** nécessaires. Il ne donne **pas** les solutions des sujets : les exemples ci-dessous
utilisent d'autres cibles (autres motifs, autres commandes) pour que tu fasses toi-même le dernier pas.
Les extraits de code ont été compilés/exécutés avec `gcc -std=c99 -pedantic -Werror -Wall -Wextra -Wvla`, `sed`, `grep`, `bash`.

---------------------------------------------------------------------------------------------------------------------

## 0. Méthode de travail (valable pour les 5)

1. **Lis le sujet en entier**, puis recopie les exemples du sujet dans un fichier de test : ce sont tes premiers tests.
2. **Obligations** (elles reviennent sur chaque sujet) : pas de triche ni de partage de code, pas de variable globale,
   coding-style respecté, rendu avant l'heure limite, **tout ce qui n'est pas autorisé est interdit** (fonctions, en-têtes, commandes),
   fichiers en ASCII/UTF-8 sans BOM, dépôt propre (pas de `*.o`, `*~`, `*.swp`, binaires, `a.out`…).
3. **Respecte l'arborescence exacte** du sujet (`insertion_sort/insertion_sort.c`, etc.). Un fichier mal nommé = 0 au test.
4. **Scripts** : `chmod +x` avant de pousser (« Grant execution permission »). Vérifie avec `ls -l`.
5. **Commit petit et souvent**, vérifie `git status` avant de pousser (rien en trop).
6. Teste les **cas limites** : fichier vide, ligne vide, une seule entrée, entrée déjà triée, entrée triée à l'envers, pas d'argument.

Commandes de diagnostic à connaître :

| Besoin | Commande |
|---|---|
| Voir les fins de ligne et espaces cachés | `cat -e fichier` (`$` = fin de ligne) |
| Code de retour de la dernière commande | `echo "$?"` |
| Comparer deux sorties | `diff <(./prog) attendu.txt` |
| Compiler comme le correcteur | `gcc -std=c99 -pedantic -Werror -Wall -Wextra -Wvla -o prog *.c` |
| Fuites / accès mémoire invalides | `valgrind ./prog` ou `gcc -fsanitize=address,undefined -g …` |
| Voir les appels système | `strace ./prog` |

---------------------------------------------------------------------------------------------------------------------

## 1. Rappels C indispensables

### 1.1 Pointeurs et tableaux
- `int *p` = « adresse d'un `int` ». `&x` donne l'adresse de `x`, `*p` lit/écrit la valeur pointée.
- Un tableau passé à une fonction **devient un pointeur** vers son premier élément : on perd la taille. Il faut la transmettre
  (`size_t n`) **ou** utiliser une **sentinelle** (ici : `NULL` en fin de tableau).
- `a[i]` ≡ `*(a + i)` (l'arithmétique de pointeurs tient compte de la taille du type).
- Utilise `size_t` pour les tailles/indices (non signé). Attention aux boucles du type `j >= 0` avec un non signé : `j` ne devient jamais négatif.

### 1.2 `void *` : le pointeur générique
- Un `void *` peut pointer vers n'importe quoi, mais on ne peut **ni le déréférencer ni faire d'arithmétique dessus**.
  Pour lire la valeur il faut **caster** vers le vrai type : `*(int *)p`.
- Un « tableau générique » est un tableau de `void *` : chaque case contient l'adresse d'un objet quelconque
  (c'est la case qui est copiée/déplacée quand on trie, pas l'objet).
- `const void *` : on promet de ne pas modifier l'objet pointé (c'est le type des arguments d'un comparateur).

### 1.3 Tableau terminé par `NULL` (sentinelle)
Exemple à compiler et à lire (parcours, **pas** de tri) :

```c
#include <stdio.h>
#include <stddef.h>

static size_t count(void **a)
{
    size_t n = 0;
    while (a[n])
        n++;
    return n;
}

int main(void)
{
    int x = 1, y = 2;
    void *p[] = { &x, &y, NULL };          /* le dernier élément est NULL */
    printf("%zu %d\n", count(p), *(int *)p[1]);   /* affiche : 2 2 */
    return 0;
}
```

Question de réflexion : que se passe-t-il si tu oublies le `NULL` final ? (indice : `valgrind`).

### 1.4 Pointeurs de fonction
- Une fonction a une adresse. On déclare un **type** avec `typedef` pour garder le code lisible :

```c
typedef int (*op_f)(int, int);        /* « pointeur vers fonction (int,int) -> int » */
static int add(int a, int b) { return a + b; }
static int mul(int a, int b) { return a * b; }

op_f ops[] = { add, mul };            /* un tableau de fonctions */
int r = ops[1](3, 4);                 /* appel via le pointeur : 12 */
```

- On les utilise pour **séparer ce que l'on fait de la façon de le décider** : par exemple une fonction de tri qui ne sait pas comparer
  reçoit en paramètre une fonction de comparaison (même principe que `qsort(3)`).
- **Convention des comparateurs** (comme `strcmp`) : renvoie `< 0` si le 1er est « plus petit », `0` si égaux, `> 0` si le 1er est « plus grand ».
  Lire la page `man 3 qsort` et `man 3 strcmp`.
- Pour un tableau de `void *` qui pointent vers des `int`, le comparateur reçoit **les valeurs des cases** (des adresses) : à toi de
  caster pour retrouver les `int`.

### 1.5 Structures et table de dispatch
Une structure regroupe des champs. Une **table de structures** associant un **nom** à une **fonction** permet de choisir une
commande **sans enchaîner des `if/else`** : on parcourt la table, on compare le nom, on appelle le pointeur trouvé.

```c
struct entry { const char *name; int (*fn)(const char *); };   /* le sujet fournit sa propre structure : respecte-la */
```

Notions utiles : tableau de structures initialisé en dur, sentinelle de fin ou taille calculée avec `sizeof t / sizeof t[0]`,
`strcmp` / `strncmp` pour comparer des chaînes (en-tête `<string.h>`).

---------------------------------------------------------------------------------------------------------------------

## 2. Exercice `insertion_sort` — ce qu'il faut maîtriser

**Compétences** : tableau de `void *` terminé par `NULL`, pointeur de fonction (`f_cmp`), tri par insertion, séparation `.h` / `.c`.

### 2.1 L'algorithme (version simple sur des `int`, avec la taille)
Idée : on garde la partie gauche **déjà triée**. Pour chaque nouvel élément, on le **fait reculer** (en décalant les plus grands vers la droite)
jusqu'à sa place. Compilé et testé :

```c
static void ins_int(int *a, size_t n)
{
    for (size_t i = 1; i < n; i++)
    {
        int key = a[i];
        size_t j = i;
        while (j > 0 && a[j - 1] > key)   /* on décale tant que l'élément de gauche est plus grand */
        {
            a[j] = a[j - 1];
            j--;
        }
        a[j] = key;
    }
}
```

Pourquoi ce n'est **pas** un tri à bulles : l'insertion **décale** au lieu d'échanger à chaque pas, et elle est très rapide sur
des données presque triées. Le sujet précise que la **performance sera testée** : pas d'algorithme en `O(n³)`, pas de recopie du tableau dans un autre à chaque itération.

### 2.2 Ce que tu dois toi-même adapter
- Le tableau n'a pas de taille : **calcule-la** avec la sentinelle (voir §1.3) ou arrête-toi au premier `NULL`.
- Les éléments sont des **`void *`** : tu déplaces des **pointeurs**, tu ne déréférences jamais toi-même.
- La **comparaison** ne se fait plus avec `>` mais en **appelant `comp`** et en regardant le signe du résultat (§1.4).
- `NULL` ne doit jamais être décalé ni comparé : il reste en dernière case.
- Cas limites : tableau vide (`array[0] == NULL`), un seul élément, éléments égaux (le tri est-il **stable** ? c'est à toi de décider `>` ou `>=` en connaissance de cause), tableau déjà trié.
- Le sujet n'autorise que `err.h errno.h assert.h stddef.h` : pas de `stdlib.h`, donc pas de `qsort` ni de `malloc` ici. Tu n'en as pas besoin.

### 2.3 `.h` et `.c`
- Le `.h` contient le `typedef`, le prototype, et une **garde d'inclusion** :
  ```c
  #ifndef INSERTION_SORT_H
  #define INSERTION_SORT_H
  /* typedef + prototype fournis par le sujet */
  #endif
  ```
- Le `.c` fait `#include "insertion_sort.h"`. **Pas de `main`** dans le rendu (le correcteur fournit le sien).
- Pour tester, écris **ton propre `main` dans un fichier séparé hors du rendu** (ex. `/tmp/test_sort.c`) et compile les deux ensemble.

### 2.4 Tests à faire
Tri de `char *` avec `strcmp` comme comparateur ; tri d'`int` via un comparateur à toi ; tableau vide ; 1 élément ; doublons ; ordre inverse ;
et un gros tableau (ex. 50 000 éléments) pour vérifier que le temps reste raisonnable (`time ./test`).

---------------------------------------------------------------------------------------------------------------------

## 3. Exercice `fctptr_cmd` — ce qu'il faut maîtriser

**Compétences** : appels système `open/read/write/close`, lecture de `stdin` jusqu'à EOF, découpe d'une ligne en commande + argument,
table de dispatch avec pointeurs de fonction, messages d'erreur sur `stderr`, codes de retour.

### 3.1 Appels système (autorisés : `open`, `read`, `write`, `close`)
- Descripteurs standards : `0` = entrée, `1` = sortie, `2` = erreur.
- `ssize_t read(int fd, void *buf, size_t n)` : renvoie le nombre d'octets lus, `0` à la fin (**EOF**), `-1` en cas d'erreur.
- `ssize_t write(int fd, const void *buf, size_t n)` : peut écrire **moins** que demandé ; renvoie `-1` en cas d'erreur.
- `int open(const char *path, int flags)` renvoie un descripteur ou `-1` (`errno` est alors renseigné) ; `close(fd)` à la fin.
- En-têtes : `<fcntl.h>` pour `open`, `<unistd.h>` pour `read/write/close`. **Vérifie** que le sujet les autorise : la liste des en-têtes autorisés est donnée sur le sujet, lis-la.

Exemple complet (copie de l'entrée vers la sortie jusqu'à EOF — **c'est le squelette de ton `cat`**, pas de ton interpréteur) :

```c
#include <unistd.h>
int main(void)
{
    char buf[64];
    ssize_t r;
    while ((r = read(0, buf, sizeof buf)) > 0)
        write(1, buf, (size_t)r);          /* on écrit exactement r octets, pas 64 */
    return 0;
}
```

Essaie : `printf 'abc\ndef\n' | ./a.out`.

### 3.2 Lire des lignes avec `read`
`read` ne te donne **pas** des lignes : il remplit un tampon. Il faut donc :
1. accumuler les octets, 2. repérer `'\n'`, 3. traiter une commande, 4. conserver ce qui reste dans le tampon.
Sujet à penser : une ligne plus longue que ton tampon, une dernière ligne **sans** `\n` avant l'EOF, une ligne vide, des espaces multiples.
Le sujet demande de lire **jusqu'à EOF** (Ctrl-D dans un terminal). Le prompt `cmd$ ` fait partie de ce que le programme affiche : suis l'exemple **à la lettre** (Obligation #7), en testant avec `| cat -e`.

### 3.3 Découper une commande
- Isole le **premier mot** (nom de commande) et le **reste** (argument). Réfléchis à ce qui se passe avec `print` sans argument, ou `hello truc`.
- `string.h` est autorisé : `strcmp`, `strlen`, `strchr`, `strncmp`. Pas de `strtok` si tu ne maîtrises pas son état global caché.
- Le sujet impose le type `handler` (`int (*)(const char *arg1)`) : **tous** tes gestionnaires ont donc la **même signature**,
  même ceux qui n'utilisent pas leur argument. Un paramètre inutilisé déclenche `-Wextra -Werror` : sache comment l'indiquer proprement (`(void)arg1;`).

### 3.4 Gestion des erreurs
- Commande inconnue, mauvais nombre d'arguments, fichier illisible → **message sur `stderr`** (descripteur 2), pas sur `stdout`.
- Ton gestionnaire renvoie un `int` : décide ce qu'il signifie (succès / erreur) et utilise-le pour piloter la boucle principale (par ex. pour `exit`).
- `exit` doit terminer avec le **code 0** après avoir libéré/fermé ce que tu as ouvert.
- `err.h` (`warnx`, `errx`, `err`) est autorisé : lis `man 3 err` pour savoir ce qu'ils affichent et ce qu'ils font ensuite (certains **quittent** le programme).

### 3.5 Tests à faire
- Les 5 exemples du sujet, avec `| cat -e`.
- Entrée vide (EOF immédiat), `cat` sur fichier inexistant, sur répertoire, sur fichier vide, `print` avec plusieurs mots, commande en majuscules, lignes vides.
- `./fctptr_cmd < commandes.txt ; echo $?`.
- `valgrind` : aucun fichier laissé ouvert, aucune lecture hors tampon.

---------------------------------------------------------------------------------------------------------------------

## 4. Les expressions régulières (pour `sed` et `grep`)

Les deux exercices reposent sur les **regex**. Deux dialectes :
- **BRE** (basique, défaut de `grep` et `sed`) : `\{n,m\}`, `\(`…`\)`, `+` et `?` sont littéraux sauf s'ils sont précédés de `\` (GNU).
- **ERE** (étendue, `-E`) : `{n,m}`, `( )`, `+`, `?`, `|` fonctionnent directement. C'est celle du sujet `sed` (`-E`).

Brique par brique :

| Motif | Signification |
|---|---|
| `.` | un caractère quelconque |
| `^` / `$` | début / fin de ligne |
| `x*` `x+` `x?` | 0 ou plus / 1 ou plus / 0 ou 1 |
| `x{n}` `x{n,}` `x{n,m}` | exactement n / au moins n / entre n et m |
| `[abc]` `[^abc]` `[a-z]` | ensemble / complément / intervalle |
| `[[:space:]]` `[[:blank:]]` | classes POSIX (espace, tabulation… vs espace/tab seulement) |

**Travaille ces deux idées séparément, avec des exemples qui ne sont pas ceux des sujets :**

```bash
# 1) accrocher un motif à la FIN de la ligne : supprimer des « ; » en fin de ligne
printf 'a;;\nb;\nc\n' | sed -E 's/;+$//'
# résultat : a  b  c

# 2) compter des répétitions avec un intervalle : lignes d'au moins 5 caractères
printf 'xxxxxxx\nab\n' | grep -E '^.{5,}$'
# résultat : xxxxxxx
```

Pièges classiques :
- La **fin de ligne n'est pas un caractère de la ligne** pour `grep`/`sed` : le `\n` est retiré avant de faire correspondre. Relis attentivement la consigne sur la façon de **compter** (« en comptant les retours à la ligne »…).
- La **tabulation** est un caractère comme un autre (`.` la reconnaît).
- `grep -f fichier` lit **un motif par ligne** dans le fichier : un fichier de motifs contient donc des motifs, pas une commande. Le sujet précise le dialecte (pas de `-E` dans la commande donnée : lis bien la commande d'exécution).
- Un motif « un peu trop permissif » (ligne vide, ligne sans `\n` final) est le défaut le plus fréquent : teste-le sur des lignes de **longueurs 79, 80, 81**, et sur des lignes de tabulations.
- Doc : `man 7 regex`, `man grep`, `info sed`.

### 4.1 `sed` — ce qu'il faut savoir pour l'exercice
- Un script `sed` est un **fichier de commandes**, une par ligne ; `-f script` le charge, `-E` active l'ERE, `-i` modifie le fichier **en place**.
- Substitution : `s/motif/remplacement/` (avec `g` pour toutes les occurrences d'une ligne ; sans `g`, seulement la première).
- Le **script ne contient pas la commande `sed` elle-même** : seulement les commandes `sed` (le sujet donne la commande d'appel).
- Une « espace » à supprimer inclut-elle la tabulation ? Relis la consigne et teste les deux cas.
- Teste : `cat -e` avant/après pour vérifier que seuls les espaces **de fin** ont disparu et pas ceux du milieu.
- Le script doit être **exécutable** si le sujet le demande (rappel en tête du sujet).

---------------------------------------------------------------------------------------------------------------------

## 5. Scripts shell (`80cols.sh`)

**Compétences** : paramètres de position, tests de fichiers, lecture ligne par ligne, longueur d'une chaîne, `printf`, codes de retour, **builtins seulement** (+ `wc` ici) : pas de `grep`.

### 5.1 Éléments à connaître (exemple complet, mais sur un autre problème : afficher la longueur de chaque ligne)
```sh
#!/bin/sh
if [ $# -ne 1 ] || [ ! -r "$1" ]; then      # un seul argument, lisible
    exit 1
fi
while IFS= read -r line; do                 # IFS= et -r : lire la ligne telle quelle
    echo "${#line}"                         # ${#var} = longueur de la chaîne
done < "$1"                                 # on redirige le fichier dans la boucle
exit 0
```
Testé : `./t.sh f` affiche `2` puis `4` pour un fichier `ab` / `abcd` et renvoie `0` ; sans argument, il renvoie `1`.

Notions à retenir :
- `$#` (nombre d'arguments), `$1` (1er argument), **toujours entre guillemets** : `"$1"`.
- `[ -r f ]` : lisible ; `[ -f f ]` : fichier ordinaire ; `[ -d f ]` : répertoire.
- `IFS= read -r line` : sans `IFS=`, les espaces de début/fin sont **supprimés** ; sans `-r`, les `\` sont interprétés.
  Un fichier dont la **dernière ligne n'a pas de `\n`** fait échouer `read` alors que `line` contient quand même du texte : le sujet dit qu'une ligne finit toujours par un retour à la ligne, vérifie cette phrase dans **chaque** sujet.
- `echo` interprète parfois des séquences (`-n`, `\n` selon le shell) : le sujet recommande **`printf`** : `printf '%s\n' "$line"`.
- **Compter le retour à la ligne** : si le sujet dit « strictement plus de 80 caractères, retour à la ligne compris », compare `${#line}` avec la **bonne** valeur (la ligne lue n'a plus son `\n`) — fais le calcul sur papier avec une ligne de 79, 80 et 81 caractères.
- Les **builtins** du shell (`read`, `printf`, `test`/`[`, `echo`, `exit`, `cd`…) sont autorisés ; les commandes externes (`grep`, `awk`, `cut`…) ne le sont **que** si le sujet les liste. `wc` est cité dans ce sujet : réfléchis à ce qu'il peut t'apporter (`man wc`) **ou** si tu peux t'en passer.
- **Code de retour** : `exit 0` / `exit 1` ; le sujet exige 0 uniquement pour « exactement un fichier lisible », et 1 dans **tous** les autres cas (aucun argument, deux arguments, fichier illisible ou inexistant…). Teste chacun avec `echo "$?"`.
- Fichier illisible : `chmod -r f` puis teste, **et pense à remettre** `chmod +r f` ensuite.
- Si tu es root (certains conteneurs), `-r` renvoie vrai même après `chmod -r` : teste avec un utilisateur normal.
- Utilise `#!/bin/sh` si tu veux du POSIX pur (évite les « bashismes » : `[[ ]]`, tableaux, `<<<`) ; vérifie avec `shellcheck` s'il est installé.

---------------------------------------------------------------------------------------------------------------------

## 6. Check-list finale avant de pousser

- [ ] L'arborescence est **identique** au sujet (noms, dossiers, extension `.sed` / `.sh` / `.grep`).
- [ ] C : compile **sans aucun warning** avec `-std=c99 -pedantic -Werror -Wall -Wextra -Wvla`.
- [ ] C : seulement les **fonctions et en-têtes autorisés** (relis la liste du sujet). Pas de `main` si le sujet dit « Main function : None ».
- [ ] Pas de variable globale, pas de `VLA`, pas de fuite (`valgrind`).
- [ ] Coding-style respecté (indentation, accolades, longueur de ligne, noms).
- [ ] Scripts : **exécutables** (`ls -l`), commandes **autorisées uniquement**.
- [ ] Tous les exemples du sujet donnent **exactement** la même sortie (`| cat -e`).
- [ ] Les cas limites (vide, un élément, EOF, pas d'argument, fichier illisible) sont testés.
- [ ] `git status` propre : aucun fichier temporaire, binaire, `*.o`, `a.out`, `*~`.

## 7. Ordre de travail conseillé (du plus rapide au plus long)

1. `sed_trailing_whitespaces` (regex, 15 min une fois le concept compris).
2. `80cols_grep` (même base de regex + comptage).
3. `80cols.sh` (shell : arguments, lecture, test des cas d'erreur).
4. `insertion_sort` (pointeurs, void *, pointeur de fonction).
5. `fctptr_cmd` (le plus long : appels système + dispatch + erreurs).

## 8. Pour aller plus loin
`man 2 read`, `man 2 write`, `man 2 open`, `man 3 qsort`, `man 3 strcmp`, `man 7 regex`, `man grep`, `info sed`, `man 1 printf`, `man 1 test`, `man 3 err`.
