# Passation : bots, Super Enos, Arène, APK (travail fait dans la session « Claude cloud »)

Document pour le Claude qui travaille en shell sur le PC : tout ce qui a été ajouté, où c'est, comment le tester, les pièges rencontrés.
Branche de travail cloud : `ccr-a6e76697-f4pk5u` (fusionnée dans `main` par le shell PC ; elle contient tout ce qui est décrit ici).

## 1. Vue d'ensemble (par fonctionnalité)

| Fonctionnalité | Où | Notes |
|---|---|---|
| **Pas de nulle par répétition / pas de défaite offerte** | `nasko_nodraw.py` (PC), `chess_local.js` (`L.drawAfter`, `L.pick`, `L.choose`, `L.decide`, `L.lines`) | Même règle des deux côtés : un coup qui ramène une position déjà vue / pat / matériel insuffisant / 50 coups est remplacé par la meilleure alternative **sans perdre plus qu'un plancher** (gagnant : 3,5 pions ; avantage : 1,5 ; égal : 0,7 ; léger désavantage : 0,3 ; perdant : on garde la nulle). Mat forcé jamais échangé. |
| **E.N.O.S. cherche aussi le coup brillant** | `nasko_chess._eto_choose(board, taste, eng, secs)` ; mobile `L.choose` (≥ 85 % de puissance) | `taste=True` = préférence tactique d'ETO. Brillant = sacrifice forcé (MultiPV 4) ; le sacrifice « offert » (`root_moves`) n'existe qu'en Python. |
| **Super Enos (entraînement LLM en arrière-plan)** | PC : `nasko_train.py`, `static/train.js|css`, routes `/api/train/*` et `/api/mobile/train/*` ; mobile : `js/m_train.js`, `TrainService.java` | Joue contre E.N.O.S., Stockfish pur et ETO ; le LLM ne choisit que parmi les coups de Stockfish ≤ 40 cp du meilleur ; leçon après chaque partie ; mémoire `data/super_enos.json` (PC) / `enos.train.mem` (mobile). Service Android de premier plan + verrou de réveil pour l'arrière-plan. |
| **Transitions de pages mobile** | `css/transitions.css`, `ui.js` (classe `.on`), réglage `anim` | 100 % CSS (`animation-fill-mode: backwards`, jamais `both` : ça bloque les `:active`). |
| **APK installable sans PC (CI)** | `.github/workflows/mobile-apk.yml`, `construire_apk.py` (Linux + `--test-build`) | Pré-version GitHub `mobile-test` (clé jetable, appli `com.nasko.app.test`) ou `mobile-latest` si les secrets `ENOS_KEYSTORE_B64` / `ENOS_KEYSTORE_PASS` existent. Version = `android/version.txt` + 1 (le **monter à la main** pour une nouvelle version). |
| **Bots à personnalité (Défis)** | `js/m_defis.js` (FIGHT, modes, `chatEvents`, Elo dynamique, réveil de GhorGhor), `js/bot_chat.js`, `js/bot_lines.js`, `img/bots/*.png` | Voir §2. |
| **Titres GM / IM / FM / CM** | `E.botChat.titleOf` / `.badge` ; CSS `.ttl*` dans `css/chess.css` | GM ≥ 2800, IM ≥ 2500, FM ≥ 2300, CM ≥ 2200 ; un bot peut imposer son titre (Naskurieux). |
| **Arène des bots (PC)** | `static/learn/arena.js`, `arena.css`, onglet « ⚔ ARÈNE » de `static/learn/` ; bouton « ARÈNE DES BOTS » dans `static/index.html` | Voir §3. |
| **CinePulse mobile** : import vidéo + accélérateur visibles | `js/m_cinepulse.js`, `css/cinepulse.css` | `#cp-impv`, `#cp-impa`, `#cp-imp2`, carte `.cp-insp-hint`. |
| **Correctif `U.sheet`** | `js/ui.js` | L'action du bouton passe **avant** `onClose` (sinon `U.confirm`/`U.prompt`/promotion répondaient « annulé »/Dame). |

## 2. Les bots (mobile : Défis ; PC : même code dans l'Arène)

Combattants (`FIGHT` dans `m_defis.js`) :

| id | Nom | Elo | Titre | Comportement |
|---|---|---|---|---|
| `nasko` | Nasko | ≈1300 (profil mesuré, `data/style_bots.js`) | – | Livre d'ouvertures + fréquence d'erreurs réelles de La_Loi_De_Fortes, Gambit Alien contre la Caro-Kann. |
| `lelex` | Lelex | ≈1150 | – | Idem, profil Lepoissonsteve80. |
| `penoire` | Nasko (pénoire) | 2500 | IM | `K.etoMove` (chasse au brillant) sinon Stockfish bridé à 2500. À la fin : « t'es rincé, deviens plus fort et reviens », « je t'ai lavé, c'était sale »… |
| `naskurieux` | Naskurieux | 1 → 3200 | GM (imposé) | `gain:true` : **+200 Elo** à chaque inexactitude/erreur/gaffe de l'adversaire **et** à chaque fois qu'il joue le meilleur coup (`best`/`brilliant`) ; son niveau suit l'Elo courant (`p.elo`, `powerOfElo`). |
| `ghorghor` | GhorGhor | 1400 | – | Style Lelex (`style:"lelex"`, `skill` surchargé). `transform:true` : au **3e cavalier/fou perdu** (`g.lostMinor`), phrase → glitch plein écran (`glitchFx`, `glitchSound`) → `html.ghor` (ambiance sombre) → devient **GhorGhor le vrai** (GM 3200, `kind:"eto"`, image `ghorghor_vrai.png`). Averti aux 1re et 2e pièces perdues (`minor_lost`). |
| `naskolit` | Naskolit | 3200 → 1 | GM (imposé) | `lose:true` : −100 Elo à chaque inexactitude/erreur/gaffe **de lui** et à chaque `best`/`brilliant` de l'adversaire ; **muet** (`mute:true`, aucune réplique). |
| `jester` | Le Jester | 1-3200 (roue) | selon l'Elo | `wheel:true` : `spinWheel()` (overlay) tire un Elo avant son 1er coup puis tous les 10 coups (`next()`, `p.lastSpin`) ; répliques `wheel_low/mid/high`. |
| `eto` | ETO Brillant | 3200 | GM | `K.etoMove`. |
| `enos` | E.N.O.S. | 3200 | GM | `L.choose` pleine puissance (brillants + anti-répétition). |
| `stockfish` | Stockfish | 3200 | GM | `pure:true` : aucun filtre. |

Modes (liste `MODES`) : brillant, enos, coach, speedrun, titans, boss, nasko, lelex, penoire, naskurieux, ghorghor, naskolit, jester, **combat** (choix libre des deux combattants + écran « VS »), ebe/ebs/ebd. Le test `t_defis.py` attend **17** modes.

Chat (`bot_chat.js` + `bot_lines.js`) : répliques **pré-écrites** (aucune API requise) par catégorie : `greet chat open_announce open_end open_refused good super check check_received bot_brilliant bot_blunder bot_mistake h_good h_brilliant h_blunder h_mistake frustration winning mate_coming mate_danger mate_win mate_lose draw resign_win reply_*` + spéciales (`elo_up`, `elo_self` pour Naskurieux ; `minor_lost`, `transform` pour GhorGhor). Préfixe `h_` = c'est l'**adversaire** qui l'a fait. Placeholders `{me}` (adversaire), `{san}`, `{open}`, `{elo}`. Avec une clé LLM, les moments forts peuvent être reformulés (`ask`) ; sans clé, tout reste écrit. Anti-bavardage : `PROB`, `MIN_GAP`, un seul bavard par demi-coup sauf `STRONG`.
Ajouter un personnage : entrée dans `CH` (`bot_chat.js`), un bloc dans `ENOS_BOT_LINES`, un `FIGHT[...]` + éventuellement un `MODES` + une carte `ROSTER` (`arena.js`), l'image dans `img/bots/` (carré 320 px).

## 3. Arène des bots (PC)

Principe identique à « Apprendre » : **le code du téléphone est réutilisé tel quel**. `build_learn_data.py --sync` copie `m_defis.js`, `bot_chat.js`, `bot_lines.js`, `img/bots/*`, `data/style_bots.js` (+ le reste déjà partagé) du mobile vers `static/learn/` ; `pc_shim.js` fournit la petite API `window.ENOS` (`E.userName` = prénom donné aux bots, LLM via la fenêtre parente). `pc_boot.js` charge l'onglet **arena** à la demande (`need.arena`), construit le module `defis` dans `#app-arena` puis appelle `E.arena.mount()` (**propre au PC** : lobby de cartes à grands portraits, constructeur de combat à deux emplacements + 12 préréglages, partie en 3 colonnes via `arena.css`, Espace = pause, Échap = retour). Le moteur est **Stockfish.js dans le navigateur** (comme le mobile) ; piste d'amélioration : brancher le vrai Stockfish du PC (`nasko_mobchess`).
Ouvrir : bouton « ⚔ ARÈNE DES BOTS » (`#b-arena`, `static/learn_launch.js`) ou `/static/learn/#arena`. Test : `python tests/ui_arena_smoke.py`.
**Après toute modification de `m_defis.js`, `bot_chat.js`, `bot_lines.js` ou `chess.css` : `python build_learn_data.py --sync`** (sinon la copie PC est périmée).

## 4. Tests (et comment les lancer ici)

- Python : `python tests/test_nodraw.py`, `tests/test_train.py` (moteur factice, sans Stockfish), `tests/test_editions.py`, `tests/test_static_files.py`, `tests/test_roles.py` (2 échecs **préexistants** : routes `/api/cinepulse/open`, `/api/subs/*` non mappées).
- Mobile (navigateur, pont natif simulé) : `bash android/tests/run_mobile_e2e.sh t_xxx.py` — `t_chess_nodraw.py`, `t_train.py`, `t_botchat.py` (chat, titres, Naskurieux, GhorGhor), `t_defis.py`, `t_cp_import.py`, `t_chess_cinepulse.py` (échoue sur les échantillons CinePulse absents : sans rapport).
- PC UI : `python tests/ui_arena_smoke.py`, `static/train.js` testé avec `fetch` simulé.
- Java : compile avec `javac --release 8 -cp android-all.jar` (android-all 14 depuis Maven Central, `org/robolectric/android-all/14-robolectric-10818077`). **Jamais exécuté sur téléphone.**
- Environnement cloud : `pip install chess` échoue (setup.py) → `pip download chess --no-deps` puis copier le dossier `chess/` dans un `PYTHONPATH` ; Stockfish de test : `apt-get download stockfish` + `dpkg -x` ; `playwright` Python via pip (Chromium dans `/opt/pw-browsers`).

## 5. Pièges rencontrés (à ne pas refaire)

1. **`.gitignore` contient `data/`** : tout nouveau fichier sous un dossier `data/` n'est PAS commité (le fichier de répliques des bots n'était pas dans l'APK pour cette raison). Mettre les nouveaux fichiers de données dans `js/`, ou `git add -f`.
2. `static/index.html` : chaque fichier `/static/xxx.js|css` doit être dans `_STATIC_FILES` (`nasko_server.py`), sinon 404 (`tests/test_static_files.py`). `static/learn/**` est servi par la route dédiée `/static/learn/{path}`.
3. Nouveau module Python d'une capacité (leisure…) → l'ajouter à `PY_MODULES` de `release_editions.py` ; nouvelle route → `nasko_roles.PREFIX_CAPS`.
4. Collisions d'identifiants DOM entre modules mobiles (`#tr-*` était déjà pris par `m_learn.js` → Super Enos utilise `#su-*`).
5. `animation-fill-mode: both` fige `transform` et casse `:active` ; utiliser `backwards`.
6. `U.sheet` : ordre bouton → `onClose` (voir §1).
7. `titans_step`/`boss_step` : le coup d'E.N.O.S. passe par `_eto_choose(taste=False)` ; ne pas revenir à `_choose` (plus de brillants ni d'anti-répétition).

## 6. Build de l'APK

Push d'un changement sous `android/**` → le workflow construit et publie `mobile-test` (≈ 40 s). Récupérer : `gh api repos/<owner>/<repo>/releases/tags/mobile-test` puis `gh api -H "Accept: application/octet-stream" repos/.../releases/assets/<id>`. Localement : `python construire_apk.py [--test-build]`. Les clés Groq/ElevenLabs sont par application (coffre Keystore) : à ressaisir dans l'appli TEST.

## 7. Idées non faites

Voir `docs/CHESS_OPTIMISATIONS.md` (Stockfish WASM sur mobile, Syzygy, ponder…), et : brancher le Stockfish du PC dans l'Arène ; PGN des parties de Super Enos ; titres dynamiques (Naskurieux n'affiche que GM) ; son de victoire/défaite des bots (ElevenLabs).
