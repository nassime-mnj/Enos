# Enos CodeLab — API d'exécution de code sandboxée

Routeur monté par `codelab_api.install(app)` (idempotent) sous `/launcher/v1/codelab`. Authentification : `Authorization: Bearer <jeton d'accès>` ; tout rôle connecté (friends, dev, ceo). Langages serveur : `c`, `cpp`, `java`, `python`, `sql`, `shell` (HTML/CSS/JS tournent sur le téléphone).

## Contrat
`GET /languages` → `{"languages":[{"id","label","version","available"}],"sandbox":{"mode","strong"},"limits":{"timeout_s","output_bytes","code_bytes","stdin_bytes"}}`

`POST /run` `{"language","code","stdin":""}` → 200
`{"ok","phase":"compile"|"run","exit_code":int|null,"stdout","stderr","timed_out","truncated","duration_ms"}`
Une erreur de compilation est un 200 avec `ok=false`, `phase="compile"`, stderr nettoyé des chemins temporaires. `exit_code` vaut `null` au timeout.

Erreurs (`{"detail": "..."}`) : 400 langage inconnu / code vide / code > 64 Ko / stdin > 16 Ko / « Langage indisponible sur ce serveur. » ; 401 sans jeton valide ; 429 > 20 exécutions/min, une exécution déjà en cours pour le compte, ou serveur occupé ; 503 aucun bac à sable fort (ou Piston injoignable).

## Bac à sable (ordre de préférence, détecté puis mis en cache)
1. `bwrap` (`mode:"bwrap"`, strong) : `--unshare-all` (user, pid, net, ipc, uts, cgroup), `--die-with-parent`, `--new-session`, `--cap-drop ALL`, uid/gid 65534, racine en tmpfs remontée en lecture seule, `/usr`, `/bin`, `/lib*`, `/etc/alternatives`… en lecture seule, `/proc` et `/dev` minimaux, `/tmp` tmpfs, répertoire de travail unique monté sur `/work`, environnement vidé (PATH, HOME, TMPDIR, LANG seulement).
2. `unshare -r -n -m -p -f --mount-proc` (`mode:"unshare"`, strong d'après le contrat) : réseau et PID isolés, **mais le système de fichiers de l'hôte reste visible** (lecture) — protection nettement plus faible que bwrap.
3. Piston distant (`mode:"remote"`) si `DP_CODELAB_REMOTE` est défini.
4. rlimit seul (`mode:"rlimit"`, strong=false) : **refusé (503)** sauf `DP_CODELAB_ALLOW_WEAK=1` (développement local uniquement).

Dans tous les modes locaux : répertoire 0700 jetable supprimé dans un `finally`, `setrlimit` (CPU = timeout+1, AS 512 Mo [Java 3 Go], FSIZE 5 Mo, NPROC 512, NOFILE 64, CORE 0), nouvelle session + kill de tout le groupe au timeout, sortie plafonnée à 64 Ko par flux lue en flux (dépassement → arrêt du programme, `truncated=true`), code ≤ 64 Ko, stdin ≤ 16 Ko. Si le serveur tourne en root, les exécutions passent en uid `nobody` avant exec (sinon RLIMIT_NPROC est ignoré : constaté, fork bomb non bornée). Journal : user_id, langage, durée, issue — jamais le code ni la sortie.

## Variables d'environnement
| Variable | Défaut | Rôle |
|---|---|---|
| `DP_CODELAB_TIMEOUT` | 10 | timeout mur d'exécution, borné 1–30 s |
| `DP_CODELAB_COMPILE_TIMEOUT` | 15 | budget de compilation (1–60 s) |
| `DP_CODELAB_CONCURRENCY` | 3 | exécutions simultanées au total (1–16) |
| `DP_CODELAB_RATE` | 20 | exécutions / minute / utilisateur |
| `DP_CODELAB_REMOTE` | — | URL d'un Piston (`POST {url}/api/v2/execute`) |
| `DP_CODELAB_ALLOW_WEAK` | — | `1` autorise le mode rlimit seul (dev) |
| `DP_CODELAB_NPROC` | 512 | RLIMIT_NPROC |
| `DP_CODELAB_TMPDIR` | tempdir système | base des répertoires de travail (doit être traversable par l'uid d'exécution) |
| `DP_CODELAB_KEEP_ROOT` | — | `1` : ne pas passer en `nobody` quand le serveur est root |

## Modèle de menace
Protégé (bwrap) : pas de réseau (loopback compris, pas d'accès aux services de l'hôte) ; fichiers de l'hôte, `/home`, `/root`, dossier du serveur, variables `DP_*` et jetons invisibles ; écriture impossible hors `/work` et `/tmp` (tous deux éphémères et privés à l'exécution) ; processus orphelins/fork bombs tués avec l'espace de noms PID ; CPU, mémoire, taille de fichier, nombre de processus et durée bornés ; SQL : `ATTACH`, `load_extension` et PRAGMA hors liste blanche refusés.

Limites honnêtes :
- **Pas de cgroups** : la mémoire est bornée par RLIMIT_AS (par processus, pas globalement) et NPROC par uid ; une charge agrégée (plusieurs processus à 512 Mo) n'est pas plafonnée. Posez `--pids-limit`/`--memory` sur le conteneur.
- Même noyau que l'hôte : une faille noyau/bwrap permet l'évasion. Pas de filtre seccomp propre (celui du conteneur s'applique).
- Pas de quota disque global : `/tmp` tmpfs et `/work` sont bornés seulement par FSIZE 5 Mo par fichier.
- Le mode `unshare` n'isole pas le système de fichiers ; `remote` dépend entièrement de la sécurité du Piston.
- Le déni de service par saturation reste possible dans la limite du débit et de la concurrence.

## Hébergement
- **Render offre gratuite, service Python natif** : pas de namespaces utilisateur ni de droits pour bwrap/unshare (non garanti, à vérifier : `/languages` indiquera `mode:"none"` et `/run` répondra 503). Ne pas utiliser `DP_CODELAB_ALLOW_WEAK` en production. Options : un Piston auto-hébergé (`DP_CODELAB_REMOTE`) sur une machine à part, ou `Dockerfile.codelab` sur une VM (options Docker documentées dans le fichier : seccomp assoupli, `--pids-limit`, `--memory`).
- Piston : les langages et versions installés côté Piston déterminent ce qui marche ; `available` est supposé vrai en mode remote.

## Tests
`python3 tests/test_codelab.py` (ou pytest). Les tests d'isolation fichiers exigent bwrap ; les langages absents sont ignorés.
