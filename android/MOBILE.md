# E.N.O.S. mobile — application hybride autonome

## Architecture
```
 Téléphone ─ WebView ─ assets/mobile (HTML/CSS/JS vanilla, classiques : pas de modules ES, file:// l'interdit)
     │            └─ pont Java « Enos » (LocalBridge)  ← seule porte vers le natif
     ├─ KeyVault   Android Keystore AES-256-GCM : clés Groq/ElevenLabs, liens .ics, jeton du PC. Le JS écrit, teste, efface ; il ne LIT jamais.
     ├─ NativeHttp proxy à liste blanche (groq, eleven_enos, eleven_eto, zeus, moodle, pc) : l'hôte et la clé sont choisis en Java, flux SSE/audio renvoyés par morceaux
     ├─ PcLink     adresses Wi-Fi/Tailscale, certificat ÉPINGLÉ (SHA-256 validé une fois), Bearer + X-Eto-Device ; sonde /api/ping
     └─ FilesBridge Storage Access Framework (dossier choisi, permission limitée à lui) + MediaStore (galerie, Téléchargements)
 Mode AUTONOME : Groq / ElevenLabs / .ics directement depuis le téléphone.     Mode CONNECTÉ : + /api/mobile/pc, /api/godot/*, /api/power/*, /api/agenda/sync
```
Pourquoi pas Capacitor : le projet a déjà une coque WebView native (JDK + SDK, sans Node ni Gradle) avec TLS épinglé, jeton d'appairage, mise à jour automatique.
Capacitor apporterait des plugins prêts à l'emploi au prix de Node + Gradle (~1 Go) ; à reconsidérer si le besoin natif grossit (notifications en arrière-plan, caméra).

## Compiler
`py construire_apk.py` (JDK 11+ et SDK Android déjà installés) → `ENOS.apk` signé (clé `android/signing/enos-release.jks`, ignorée par Git, à sauvegarder hors du dépôt) + `NASKO.apk.json`.
Les assets web sont embarqués tels quels (`android/assets/mobile`). Test sans téléphone : ouvrir `index.html` dans Edge avec un faux `window.Enos`.

## Structure web
`core.js` bus + réglages · `native.js` façade du pont · `link.js` machine d'états du lien PC · `ai.js` Groq/ElevenLabs · `agenda.js` .ics + tâches + synchro ·
`ui.js` pager/swipe, appui long, sheets · `views.js` accueil/chat/PC · `tools.js` photos + dossiers · `settings.js` · `boot.js`.

## Lien PC (link.js)
`unpaired → offline → probing → online (| denied)`. Sonde immédiate : retour au premier plan, changement de réseau Android (Wi-Fi, VPN), bouton.
Hors ligne : 5 s, puis 15 s (>2 min), 30 s (>10 min). Le PC doit approuver le téléphone (Appareils de confiance = « Eto Dev ») : sinon 403 → état `denied`.
## Synchro agenda
Tâches seulement (les .ics sont lus par les deux appareils). `POST /api/agenda/sync {since, tasks}` : dernier écrit gagne, pierres tombales, écart d'horloge corrigé (`offset` mesuré sur `/api/mobile/pc`).

## Limites connues
Pas de détection PC en arrière-plan (l'app est en pause quand l'écran est éteint) ; vitesse des ventilateurs en lecture seule (le constructeur n'expose pas d'écriture) ;
non testée sur appareil réel à ce jour.

## Mise à jour 1.11 — appairage en un scan + hub de modules
- **Bouton « APPAIRER LE TÉLÉPHONE »** (PC : tableau de bord et lanceur) → `nasko_pairing.py` : paquet chiffré (clés, liens .ics, adresse/jeton/empreinte du PC, identifiant d'appareil approuvé d'avance), QR code, code à 10 caractères, suivi en direct.
- Barrière réseau du PC : une clé d'API valide (en-tête Bearer) vaut désormais connexion pour un appareil distant (`authenticate()` de nasko_server.py) ; la 1re navigation de l'interface complète reçoit un cookie.
- **Onglet Modules** : natifs (agenda, œil, photos, dossiers, nettoyeur, contrôle API, thèmes) · avec le PC (échecs via `/api/mobile/chess/*`, interface complète ouverte sur le bon module via `static/deeplink.js`) · réservés au PC (les 238 routes « ce PC seulement » restent verrouillées).
- Échecs : service sans état `nasko_mobchess.py` (Stockfish dédié) ; bilan d'une partie TERMINÉE collée en PGN (même jugement que le bilan de CHESS) + conseils d'ETO. Pas d'aide en direct.

## Mise à jour 1.12 — parité PC, outils « killer » et cloud
- **Modules > Productivité** : Éditeur PDF (fusion, scission, pages, numérotation, filigrane, compression), JSON / XML, Dépenses partagées (même moteur `quicklib.js` que le PC), Syllabus Scanner. **Scanner & stockage** : Scanner documentaire IA (recadrage automatique, OCR par modèle de vision, PDF / Excel), Nettoyeur de stockage, Coffre-fort chiffré (AES-256-GCM, phrase secrète). **Synchronisation** : Compte cloud, Presse-papiers universel. Code : `js/suite.js` (registre) + `js/m_*.js`.
- **Cloud** (`js/cloud.js`, Java `NativeHttp` providers `cloud`, `cloud_refresh`, `cloud_logout`) : le jeton d'accès et la session sont dans le coffre Keystore ; seul le profil (e-mail, rôle) est lisible par le JS. Adresse du serveur + OTA : voir `deploy/DEPLOIEMENT_CLOUD.md`.
- **OTA** : `Enos.checkCloudUpdate(manuel)` réutilise l'`Updater` (PackageInstaller, SHA-256, même signature obligatoire) avec une adresse `https://<serveur>/m/<jeton d'appareil>/` (`api/app/version`, `nasko.apk` → lien R2 signé).
- **Visible depuis le PC** : l'app annonce nom, IP Wi-Fi (`Enos.lanIps()`) et port ADB au compte ; le PC (`nasko_mirror.py`) s'y connecte en ADB sans fil et lance scrcpy au démarrage d'E.N.O.S.
- Tests sans téléphone : `bash android/tests/run_mobile_e2e.sh t_xxx.py` (navigateur, pont natif simulé) et `bash android/tests/run_cloud_e2e.sh t_cloud.py` (contre le vrai serveur). Le Java est type-vérifié avec `javac` contre le framework Android 14 (`android-all`), mais **n'a pas été exécuté sur un téléphone**.

## Enos CodeLab (Modules → Code & apprentissage)
Éditeur de code tactile (CodeMirror 6, `vendor/codemirror.min.js`), **Smart Toolbar** collée au-dessus du clavier (⇥ { } [ ] ( ) < > ; / ← → ↑ ↓ + touches propres au langage ; appui long sur une paire = fermeture seule ; flèches à répétition), **terminal** tiré vers le haut (poignée, ou glisser depuis la barre), 5 thèmes (Coreboard suit la couleur d'accent), pincement = taille du texte.
- **HTML / CSS / JS** : sur le téléphone. JS dans un Worker (délai 6 s, `readLine()` / `INPUT` pour l'entrée). Aperçu web dans `PreviewActivity` : WebView **sans aucun pont JavaScript**, réseau coupé (le code collé depuis Internet ne peut pas appeler le coffre-fort : `addJavascriptInterface` s'appliquerait sinon aussi aux iframes). Dans un navigateur de test : iframe `sandbox`.
- **Python, C, C++, Java, SQL, Shell** : `POST /launcher/v1/codelab/run` (compte cloud requis), bac à sable bubblewrap côté serveur — voir `dualpulse_site/CODELAB_API.md` (modèle de menace, variables `DP_CODELAB_*`, Dockerfile, Piston distant).
- **Quêtes** (`js/codelab_quests.js`, 54 quêtes) : ETO donne l'exercice, la sortie est vérifiée sur 2 à 4 tests ; « Un indice » (3 niveaux) envoie le code, l'erreur et le test en échec à Groq avec l'interdiction de donner la solution, et la réponse est filtrée (blocs de code supprimés) ; sans clé Groq : indices de l'auteur. XP, niveaux, série de jours. Les solutions de référence ne sont PAS dans l'appli (`android/tests/codelab_solutions.json`).
- Tests : `android/tests/t_codelab.py` (interface, cloud simulé), `t_codelab_cloud.py` (via `run_cloud_e2e.sh`, vrai serveur), `test_codelab_quests.py` (exécute chaque solution), `dualpulse_site/tests/test_codelab.py` (bac à sable).
- Non testé sur appareil : `PreviewActivity` (compilée seulement), clavier Android réel / `visualViewport`, vibrations.

## Mise à jour 1.13 — échecs autonomes, CinePulse mobile, export CEO
- **Échecs hors ligne** (`js/chess_local.js`) : règles = chess.js 0.13.4, moteur = le **vrai Stockfish 19** (Stockfish.js 19.0.1, build WASM « lite-single », `vendor/stockfish19_src.js` chargé à la demande : JS en chaîne + `.wasm` en base64 ; le Worker blob remplace `fetch()` pour lire le wasm, car la page est en `file://` avec `connect-src 'none'`), **repli automatique** sur Stockfish.js 10 asm.js (`vendor/stockfish_src.js`) si le WASM échoue (`ENOS.chessLocal.engine` dit lequel tourne). GPLv3 → voir `vendor/LICENSES.txt`. `play.js` n'appelle plus le PC pour jouer ; seule l'analyse de partie (`/review`) l'exige encore. E.N.O.S./ETO commente chaque échange en une phrase (Groq, `E.ai.chat(..., {oneShot:true})`, hors historique de chat) ; toucher la phrase la lit à voix haute. Réglage `chess.comment`.
- **CinePulse mobile** (`js/m_cinepulse.js`, Modules › Productivité) : moniteur, soundboard (pré-écoute, poignée ⠿ pour glisser sur une piste, ＋ pour poser au curseur), timeline 2 pistes vidéo + 3 audio, magnétisme (curseur, début, bords de clips, repères), zoom pincement / curseur jusqu'à 40 px/ms, rognage, coupe, repères, lecture WebAudio. Les médias vivent en mémoire de la page : le projet n'est pas conservé à la fermeture (à faire : IndexedDB / export).
- **Export CEO** (`exporter_donnees_ceo.py`, PC) : clés Groq + ElevenLabs, liens .ics, tâches de l'agenda, préférences → `js/ceo_bundle.js` chiffré (AES-256-GCM, PBKDF2 300 000, phrase secrète). L'application demande la phrase une fois (`Importer.checkBundled`), range les clés dans le coffre Keystore, applique tâches et préférences (liste blanche). Java : `Importer.apply` renvoie en plus `prefs` et `tasks` filtrés.
- Tests : `bash android/tests/run_mobile_e2e.sh t_chess_cinepulse.py` (navigateur). Le Java compile contre `android.jar` (API 34) et `Importer.decrypt` a été vérifié avec un paquet réel ; **rien n'a encore tourné sur un téléphone**.

## Mise à jour 1.14 — ergonomie tactile
- **Échecs** : plateau `aspect-ratio:1/1` pleine largeur (`css/chess.css`), thème Chess.com (cases #eeeed2 / #769656, pièces `img/chess/*.png` tirées de `godot_chess/assets/themes/plat_vert`, Vecteezy, attribution affichée). `board.js` : couche de cases + couche de pièces persistantes en `transform` → les pièces **glissent** (prise, roque, en passant, promotion). `chess_sound.js` : Web Audio, vrais sons Chess.com embarqués (`chess_sounds_data.js`, base64) pour coup / échec / promotion / mat, prise synthétisée ; bouton 🔊.
- **Grille des modules** (`css/ux.css`) : 2 colonnes sur téléphone (`auto-fill`, 150 px mini), titres `clamp()` + `overflow-wrap:anywhere`, sous-titres limités à 3 lignes.
- **CinePulse** : toutes les cibles ≥ 44 px, barre de commande collée en bas (pouce gauche : lecture ; pouce droit : magnétisme, coupe, repère), barre de clip (image ±, début/fin au curseur, supprimer), piste active (toucher son nom), poignées de rognage de 44 px sur le clip sélectionné, **déplacement d'un clip par appui long** (sinon le doigt fait défiler la timeline : `overflow-x:scroll`, `-webkit-overflow-scrolling:touch`), poignée ⠿ des pads sans défilement.

## Apprendre les échecs (module « Apprendre », groupe « Échecs & apprentissage »)
- `js/m_learn.js` : puzzles Lichess à difficulté adaptative (classement perso, indice, solution, filtre par thème, **✦ Brillants** = puzzles à sacrifice, badge « !! » quand le sacrifice est trouvé sans aide), explorateur et entraînement d'ouvertures (arbre tiré de lichess-org/chess-openings, ~3 900 lignes), 13 leçons, conseils personnalisés (points faibles par thème, analyses de parties via `E.chessLearn.addReview`, résultats via `addGame`, régularité) + plan de la semaine rédigé par ETO (Groq).
- Données CC0 de Lichess : `data/learn_puzzles.js` (28 280 puzzles) et `data/learn_openings.js`, générées par `build_learn_data.py <dossier>` (télécharge-les d'abord : puzzle.csv.zst + a..e.tsv ; `pip install zstandard` côté dev seulement). Chargées à la demande à l'ouverture du module.
- **Version PC** : même `m_learn.js`, copié dans `static/learn/` par `python build_learn_data.py --sync` (à relancer après toute modification) ; page servie par `/static/learn/`, ouverte depuis le bouton « APPRENDRE LES ÉCHECS » de l'interface PC (`static/learn_launch.js`). ETO (LLM) n'y est pas branché.
- Test : `t_learn.py` (28 contrôles : Elo, sacrifice, arbre, conseils, puzzle joué au doigt, ouvertures, leçons).

## Mise à jour 1.15 — le téléphone ne dépend plus du PC
- **Échecs 100 % sur le téléphone** : `chess_brain.js` (port JS de `nasko_chess.py` : jugement Brillant / Théorie / Meilleur… / Gaffe, détection de sacrifices, coup d'« ETO Brillant »), `chess_review.js` (analyse de PGN locale, conseils d'ETO), `chess_local.js` (`analyse` multi-lignes, `searchmoves`, `abort`). Le jugement d'un coup suspect (perte > 60 cp) ou brillant est CONFIRMÉ à 3× le temps (`K.judge`) : les évaluations rapides d'un moteur asm.js sont bruitées. Les coups du livre d'ouvertures Lichess sont étiquetés « Théorie » (comme « Livre » sur Chess.com).
- **Défis** (`m_defis.js`) : ✦ ETO Brillant (3200, sacrifices), Défi E.N.O.S. (puissance 1-100 %, annulation d'une gaffe catastrophique), Cours avec ETO (bot 400-3200 + coach), Speedrun, Choc des Titans (E.N.O.S. vs ETO), Boss final (ETO / E.N.O.S. / duo vs Stockfish). Historique + PGN. Son « brillant » = `PourClaude/witty-alien-brilliant-move-sound-effect.mp3` (embarqué).
- **Conseiller brillants** (`m_advisor.js`) : capture d'écran (choisie, collée ou **partagée vers E.N.O.S. depuis la galerie** : intent `SEND image/*` → `MainActivity.readShared` → `Enos.pendingShare()`) → `board_scan.js` reconnaît l'échiquier (couleurs → grille 8×8 ; silhouettes de chaque pièce → petit réseau int8 `data/piece_model.js`, camp par 2-moyennes ; décodage sous contraintes) → position modifiable case par case → `K.hunt` : meilleures lignes + TOUS les coups-sacrifices analysés (`searchmoves`), « !! BRILLANT » = sacrifice quasi aussi bon que le meilleur, position pas perdue ensuite. **Mémoire des formes** : « C'est bon : mémoriser » (et chaque correction) apprend le jeu de pièces de l'utilisateur ; ensuite ses captures sont lues sans erreur. À utiliser contre des bots / pour s'entraîner. Reconnaissance mesurée sur captures synthétiques (`android/tests/t_boardscan.py`) : jeux standards parfaits, jeux exotiques à corriger une fois. Entraînement : `export_scan_v2.py` (4 tranches) puis `train_scan_model.py --final`.
- **Outils natifs ajoutés** (avant : « Avec ton PC ») : Labo audio (`m_audiolab.js` : vidéo → WAV, découpe des sons, gain / fondus), Images & animations (`m_sprites.js` : planches de sprites, lecture pixel art, ZIP), Mode Chill (`m_chill.js` : ambiances WebAudio + minuteur de sommeil + musiques perso), Compression (`m_compress.js` : images en lot / taille cible, vidéo par MediaRecorder), Abonnements (`m_subs.js` : totaux, compte à rebours, import par l'IA depuis un relevé). Restent « Avec ton PC » : Tests F6, Colis, Sync, Hub équipe, Réglages du PC (ils pilotent le PC par nature).
- **Droits complets** : si le propriétaire coche « DROITS COMPLETS » pour ce téléphone sur le PC (Réglages → Appareils de confiance), `/api/mobile/pc` renvoie `full:true` et les modules « Réservé au PC » du hub s'ouvrent (deeplink). Jamais depuis le téléphone ; la gestion de la confiance reste strictement locale (`_PCONLY`). Test : `tests/test_full_rights.py`.
- **Correctif** : `ui.js` `closeSheet` exécute `onClose` APRÈS le `fn` de l'option choisie (avant : `confirm()` répondait toujours « non », la promotion toujours « dame »).
- **PC** : `static/learn/` devient « Échecs · Apprendre & Conseiller » (onglets ; Stockfish.js chargé à la demande ; ETO via `/api/chess/llm` et `/api/chess/vision`) ; bouton « 📷 CAPTURE D'ÉCRAN » (Ctrl+V) dans *Mise en condition* (`static/scan_launch.js` → `window.enosCD.apply`). `python build_learn_data.py --sync` après toute modification des fichiers partagés.
- Tests (navigateur, sans pont natif) : `t_brain`, `t_defis`, `t_advisor`, `t_boardscan`, `t_scanlearn`, `t_native_modules`, `t_pc_learn` (serveur sur `static/learn`). **Rien de tout cela n'a tourné sur un téléphone réel** : le Java (partage d'image) compile contre android-34 seulement.
## Mise à jour 1.14 — Super Enos, pas de nulle par répétition, transitions, installation sans PC
- **Échecs** (`chess_local.js`) : MultiPV (`L.lines`), pas de nulle par répétition (la partie garde le nombre de passages de chaque position, `seen`, que `play.js` transmet et récupère ; triple répétition détectée) et coup brillant de Stockfish prioritaire à pleine puissance (≥ 85 %). Même règle que `nasko_nodraw.py` sur le PC. Correction au passage : `U.sheet` exécute l'action du bouton **avant** `onClose` (sinon `U.confirm`, `U.prompt` et le choix de promotion répondaient « annulé » / Dame).
- **Super Enos** (`js/m_train.js`, tuile « Super Enos » des modules) : entraînement contre E.N.O.S., Stockfish et ETO, le LLM (Groq) départage les coups équivalents et rédige une leçon par partie (mémoire dans le stockage de l'appli). Deux modes : **sur le téléphone** (Stockfish.js) ou **sur le PC** (`/api/mobile/train/*`, le téléphone suit en direct). Test : `t_train.py`.
- **Arrière-plan** : `TrainService.java` (service de premier plan, notification « Arrêter », verrou de réveil limité à 8 h) + `MainActivity.setKeepAlive` (la page n'est plus gelée par `onPause`) + pont `Enos.keepAlive(on, texte)` ; permissions `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE`, `WAKE_LOCK`, `POST_NOTIFICATIONS`. Java compilé contre android-all (API 34), **non exécuté sur téléphone**. Android peut quand même tuer l'appli si l'optimisation de batterie est stricte : Réglages Android › Applications › Eto › Batterie › Sans restriction.
- **Transitions de pages** (`css/transitions.css`, 100 % CSS + classe `.on` posée par `ui.js`) : la page qui s'efface recule, les cartes de la page qui arrive montent en cascade ; entrer dans un module glisse depuis la droite, ◂ MODULES revient par la gauche. Réglage « Animations de transition » (Réglages) et respect de `prefers-reduced-motion`.
- **Installer la nouvelle version depuis le téléphone, sans PC** : `.github/workflows/mobile-apk.yml` construit l'APK sur GitHub à chaque push touchant `android/` (ou à la main : Actions › « APK mobile » › Run workflow) et la publie dans une pré-version. Sur le téléphone : GitHub › Releases › ouvrir la pré-version › toucher le `.apk` › autoriser l'installation pour le navigateur.
  - Avec les secrets `ENOS_KEYSTORE_B64` + `ENOS_KEYSTORE_PASS` (ta clé `android/signing/enos-release.jks` en base64 et son mot de passe, à ajouter une fois dans Settings › Secrets and variables › Actions) : APK **signée avec ta clé**, elle met à jour l'application installée (mêmes clés, mêmes données). Pré-version `mobile-latest`.
  - Sans secrets : APK **« Eto TEST »** (`com.nasko.app.test`, clé jetable), qui s'installe **à côté** de l'application normale ; pour installer la suivante, désinstaller d'abord la précédente « Eto TEST ». Pré-version `mobile-test`. Les clés d'API sont à ressaisir (coffre propre à chaque application).
  - Le numéro de version = `android/version.txt` + 1 (version.txt = dernière version publiée ; la monter à la main pour une nouvelle version, sinon une APK signée avec ta clé ne pourrait pas remplacer la précédente). `py construire_apk.py --test-build` fabrique la même version TEST en local ; le script tourne aussi sous Linux.

## Revue, coups possibles et Cours en direct (1.17)
- **Revue sans perte** : ⏮ ◂ ▸ ⏭ et liste des coups cliquable dans JOUER (`play.js`, `G.line` / `G.view`) ; ANNULER reste un vrai « reprendre un coup ».
- **Coups possibles** (`chess_tools.js`) : MEILLEUR / BRILLANTS / EXCELLENTS / BONS ; le coup est joué puis déjoué avec flèches (coup, cibles, réponse attendue).
- **Bilan interactif** : « 📊 BILAN DE LA PARTIE » ou PGN collé ; précision des deux camps, courbe cliquable, catégories filtrables, meilleur coup en flèche.
- **Cours en direct** (`chess_course.js`) : ETO joue une ouverture ou résout une tactique contre 400–2000 Elo, montre chaque alternative (jouée puis déjouée), demande « compris ? », « INTERROMPRE ETO » → l'élève rejoue et ETO le surveille. « ETO prend la main » (Conseiller) l'applique à une position lue sur capture d'écran.
- **Effet Brillant** façon PC : case bleue, onde sur les cases de même couleur, pastille « Brillant ! » qui glisse à côté du « !! », rayons de fourchette (`board.js` : `B.brilliantFx`).
- PC : mêmes fichiers dans `static/learn/` (`build_learn_data.py --sync`) + `chess_viewer.js` (bouton « 🔍 REVUE » dans CHESS). Test : `android/tests/t_chess_tools.py`.

## Chat box des bots Nasko / Lelex (Défis)
Illustration en haut du plateau (`img/bots/*.png`), bulle de parole façon Chess.com et petite messagerie (💬 : historique + champ pour leur écrire). Répliques écrites dans leur façon de parler (`js/bot_lines.js`, placeholders `{me}`, `{san}`) selon les événements de la partie (coup brillant, gaffe, échec, mat, nulle, abandon…) ; avec une clé Groq, les moments forts et tes messages passent par le LLM avec leur style en exemple. Code : `js/bot_chat.js`, hooks dans `m_defis.js` (`launch`, `judge`, `finish`). Test : `t_botchat.py`.

## Nasko (pénoire), combats de bots et chat à situations (1.20)
- **Nasko (pénoire)** (Défis) : 2500 Elo, cherche le sacrifice brillant comme ETO (`K.etoMove`, sinon Stockfish bridé à 2500), jamais de nulle par répétition ; illustration `img/bots/penoire.png`. À la fin de partie il a ses répliques (« t'es rincé, deviens plus fort et reviens », « je t'ai lavé, c'était sale »… et des défaites bien à lui).
- **⚔ Combat de bots** : tu choisis les deux combattants (Nasko, Pénoire, Lelex, ETO Brillant, E.N.O.S., Stockfish) ou un préréglage (Nasko vs Pénoire, Lelex vs ETO Brillant…). Écran « VS », deux bannières, transcript partagé (💬), partie enregistrée et rejouable. E.N.O.S. (pleine puissance) cherche lui aussi le coup brillant.
- **Chat 100 % pré-écrit** (`js/bot_lines.js`, aucune clé d'API) : accueil, annonce d'ouverture, fin de théorie, ouverture refusée, coup fort, brillant, gaffe, échec donné/reçu, frustration, position gagnante, mat qui arrive / mat contre soi, victoire, défaite, nulle, abandon ; personnalisé pour Nasko, Pénoire, Lelex, ETO et E.N.O.S. Avec une clé Groq, les moments forts peuvent être reformulés par le LLM.
- Les bots des Défis évitent maintenant la répétition (`L.drawAfter` / `L.pick`, comme sur le PC). Test : `t_botchat.py`.

## Titres, Naskurieux et GhorGhor (1.21)
- **Titres façon Chess.com** (badge rouge à côté du pseudo : bandeaux des joueurs, bulles, écran VS) selon l'Elo du bot : **GM ≥ 2800 · IM 2500-2799 · FM ≥ 2300 · CM ≥ 2200** (`E.botChat.titleOf`). ETO Brillant, E.N.O.S. et Stockfish sont GM, Nasko (pénoire) IM, Nasko / Lelex / GhorGhor sans titre ; un titre peut être imposé (Naskurieux).
- **🕶 Naskurieux** (agent en costume) : **GM à 1 Elo**, +200 Elo à chaque imprécision, erreur ou gaffe de son adversaire (joueur ou autre bot) ; son niveau suit son Elo courant (jusqu'à 3200), l'Elo s'affiche en direct. Répliques dédiées (« +200 elo ! merci… »).
- **👁 GhorGhor** (blond, style Lelex, 1400 Elo, sans titre) : s'il perd **plus de 2 pièces mineures** (3e cavalier/fou), il dit sa phrase, **l'écran glitche** (secousses, décalage de couleurs, bruit audio), **l'ambiance de l'app s'assombrit** (`html.ghor` : vignette, lignes de balayage, rouge plus vif) jusqu'à la sortie de la partie, son illustration devient celle aux lunettes noires et il devient **GhorGhor le vrai : GM, 3200 Elo, joue comme ETO Brillant**. Averti à la 1re et à la 2e pièce perdue. Respecte `prefers-reduced-motion` et le réglage « Animations ».
- Les deux sont jouables seuls (modes dédiés) et disponibles dans le **⚔ Combat de bots** (préréglages Naskurieux vs Pénoire, GhorGhor vs ETO Brillant…). Tests : `t_botchat.py`, `t_defis.py` (15 modes).
- **Buff Naskurieux** : il gagne aussi **+200 Elo à chaque fois qu'il joue lui-même le meilleur coup** (en plus des erreurs de l'adversaire).

## CinePulse mobile : import et accélérateur bien visibles
Boutons **📥 Importer une vidéo / 🎵 Importer un son** au centre du moniteur vide, **📥 Importer** dans la barre de la timeline ; une vidéo importée par ces boutons est posée sur la timeline (au curseur) et sélectionnée, donc l'inspecteur **⚡ ACCÉLÉRATEUR / 🎨 FILTRES / 🔊 AUDIO** s'affiche tout de suite (une carte d'indication le signale tant qu'aucun clip n'est sélectionné). Test : `t_cp_import.py`.

## Naskolit et le Jester (1.26)
- **😴 Naskolit** (pyjama, masque de nuit) : **GM à 3200 Elo**, il **perd 100 Elo** à chaque imprécision (ou erreur/gaffe) qu'il commet **et** à chaque fois que son adversaire trouve le meilleur coup (`lose:true`, plancher 1 Elo). Il **ne parle pas** (`mute:true` dans `bot_chat.js` : illustration seule qui respire, ni bulle ni messagerie).
- **🃏 Le Jester** (`wheel:true`) : avant son 1er coup puis **tous les 10 de ses coups**, une **roue** (overlay animé, 8 secteurs de 400 Elo) tire un Elo au hasard entre **1 et 3200** ; il joue à ce niveau jusqu'au prochain tour (titre selon l'Elo courant). Personnalité de bouffon élégant et espiègle (jamais lourd) : répliques `wheel_low / wheel_mid / wheel_high` + toutes les situations. `launch('jester', {wheelEvery: n})` règle la fréquence (tests). Respecte `prefers-reduced-motion`.
- Présents dans les Défis (mode dédié), le Combat de bots et l'Arène PC (cartes + préréglages « Naskolit vs Pénoire », « Le Jester vs ETO Brillant »…). Tests : `t_botchat.py`, `t_defis.py` (17 modes).

## 👑 Battle Royale ×4 (Modules › Échecs ; PC : onglet « ROYALE ×4 »)
Le plateau d'échecs **à 4 joueurs** (croix 14×14, 4 armées de 16 pièces face à face). Moteur de règles `js/chess4.js` (testé : `node android/tests/chess4.test.js`), IA `js/chess4_ai.js`, interface `js/m_royale.js`, style `css/royale.css`.
- **Règles** : **échec et mat** comme aux échecs (un coup qui laisse son roi attaqué est illégal, un roi ne se capture jamais) ; sans coup légal et en échec = **maté**, sans coup légal et pas en échec = **pat** (éliminé aussi) ; un joueur éliminé garde ses pièces sur le plateau, **grisées et inertes** (elles bloquent, n'attaquent plus, se capturent pour 0 point) ; +15 points pour le mat ; pas de roque ni de prise en passant ; pion qui promeut après 8 pas ; ordre horaire bas → gauche → haut → droite ; points de capture (pion 1, cavalier/fou 3, tour 5, dame 9, roi 15) ; limite de 400 demi-coups (meilleur total).
- **Tempête** (battle royale) : le bord du plateau s'effondre à intervalles réguliers (lente / normale / rapide), les pièces dessus sont détruites (roi détruit = éliminé) ; compte à rebours affiché, cases qui clignotent avant l'effondrement.
- **Qui affronte qui** : chaque siège a une **cible** (le joueur qu'il chasse) et une **équipe** (alliés = même lettre, captures entre alliés interdites) : 1v1v1v1, 2v2, 2v1v1, 3v1, préréglages. 9 bots (Nasko, Pénoire, Lelex, GhorGhor, Naskurieux, Naskolit, Jester, ETO, E.N.O.S.) avec leur personnalité (bruit, agressivité ; Naskurieux progresse à chaque prise, Naskolit s'endort quand il perd une pièce, le Jester relance la roue d'Elo tous les 10 coups) et leur **chat** (catégories `r_*` : annonce de cible, capture, perte, élimination, tempête, victoire).
- **Apprendre une stratégie** : « 🧬 Entraîner les bots » (Académie) fait évoluer les poids d'évaluation de chaque bot (variante mutée contre l'originale dans de vraies parties à 4, on garde la meilleure ; ≈ 0,1 s par partie) ; la stratégie apprise est décrite (« ↑ chasse au roi · ↓ protéger ses pièces ») et activée avec « Bots entraînés ». Sur Android l'entraînement continue en arrière-plan (service de premier plan).
- **Ami au téléphone** : un siège « Joueur humain » avec son prénom ; quand c'est son tour l'application te rend la main avec ses pièces (tap, ou coup dicté en texte `h13 h11`, image du plateau à lui envoyer, ↶ annuler). Voir `docs/DISCORD_AMI.md` (le bot Discord est reporté : un bot ne peut pas entrer dans un groupe privé).
- Effets : tremblement de l'écran sur les grosses prises, 💥 / 👑, tampon « ÉLIMINÉ », podium. Tests : `t_royale.py`, `chess4.test.js`, `tests/ui_arena_smoke.py` (PC).


## Variantes d'échecs (Modules › Échecs & apprentissage › « Variantes d'échecs »)
Trois règles inventées, moteur maison `js/variants.js` (testé : `node android/tests/variants.test.js`, Playwright `t_variants.py`), UI `js/m_variants.js` + `css/variants.css`, plateau = `board.js`.
- **Élixir** (Clash Royale) : départ = les 2 rois seuls, 5 💧 chacun (max 10). Pose dans ses 2 premières rangées (pion : 2ᵉ rangée seulement). Pion 1 · Cavalier 3 · Fou 3 · Tour 5 · Dame 8. Chaque coup joué = +1 💧 ; poser ne consomme pas le coup. En échec, seule une pose qui sauve le roi est légale (donc pas de mat si une pose peut parer).
- **Deux Rois** : 2 rois par camp, pas de dame ; échec = au moins un roi attaqué, mat = aucun coup qui les met tous à l'abri.
- **Protège la Dame** : seule la dame est « royale » (roi capturable, pas d'échec pour lui) ; pas de promotion en dame.
- Communs : pas de roque ; nulle par pat / 50 coups / 400 demi-coups. IA 3 niveaux (profondeur 1-3, bruit), l'IA élixir pose d'abord (valeur d'un 💧 ≈ 70 cp, risque de prise gratuite), puis joue. Bilan par variante dans `variants.stats`.
- Pas encore : version PC (Arène), pas de Stockfish pour ces règles.
- **2v2 Élixir** (`duo`) : plateau normal, 4 joueurs (Blanc A c1, Noir A c8, Blanc B f1, Noir B f8, dans cet ordre), chacun son roi, sa barre d'élixir (0 au départ, +1 par coup de LUI) et ses pièces (`s.o[]` = propriétaire de chaque case ; les pièces d'un joueur ne bougent que quand c'est son tour ; alliés et couleur partagés, pas de prise entre alliés). Légalité : seul SON roi doit rester à l'abri. `V.settle(s)` (en place) : roi maté ⇒ il sort, ses pièces disparaissent (2v1), joueur sans coup et sans échec ⇒ passe son tour, équipe sans roi ⇒ défaite, nulle 50 coups / 320 demi-coups. L'utilisateur joue Blanc A (ou Noir A) avec un équipier bot ; « joueurs humains » = les 4 au même téléphone. Pièces teintées par propriétaire (`data-o`).
- **Spectateur / stratégies / analyse (variantes)** : « 👁 Spectateur » = bots contre bots (niveau et stratégie par équipe, vitesse lente→turbo, pause). Stratégies (`V.STRATS`) : Équilibré, Rush, Économe, Muraille, Chasse au roi (en duo, toute l'équipe vise le roi du joueur le plus faible, `V.pickTarget`) ; en mode « auto » elles s'adaptent à l'évaluation (`V.adaptStrat` : en difficulté → muraille, nettement devant → rush) et le plan de chaque bot est affiché. Analyse en direct : `V.analyseJob` note tous les coups légaux (profondeur 2 puis 3, découpée en tranches de 14 ms pour ne pas figer l'écran), barre d'évaluation, 3 meilleurs coups (flèches en option), jugement de chaque coup jusqu'à « brillant »/« gaffe » (`V.judge`, badge sur la case + journal + bilan en fin de partie). Les ALLIÉS sont de la même couleur : jamais comptés comme attaquants (test : « roi sous la tour d'un allié = pas une gaffe »). Le moteur de jugement est le moteur maison (Stockfish ne connaît ni les poses, ni 2 rois, ni les alliés) ; le jugement du Battle Royale ×4 (`AI.judgeMove`) connaît aussi les équipes (test `chess4.test.js`).
- **Animations de cases** (`board.js` + `chess.css`, donc mobile ET PC, tous les plateaux 8×8 ; `m_royale` pour le ×4) : case sélectionnée qui pulse + pièce soulevée qui flotte, cibles qui respirent, onde + éclat sur toute case touchée, éclat vert sur la case d'arrivée.
- **APK test : clé de signature FIXE** (`android/test_signing/enos-test.jks.b64`, mot de passe public, valable seulement pour `com.nasko.app.test`). Avant, chaque build CI de test créait une clé jetable : Android refusait d'installer la nouvelle APK PAR-DESSUS l'ancienne (signature différente) et l'ancienne version restait, sans aucun changement visible. Depuis la 1.37, les tests s'installent par-dessus. Passage depuis une APK test ≤ 1.36 : désinstaller « Eto TEST » une seule fois.

## Sauvegarde (Modules › Synchronisation › Sauvegarde) — `js/backup.js`, `js/m_backup.js`, `FilesBridge.backup*`, serveur `/launcher/v1/backup`
Tout l'état de l'appli est dans le localStorage (`enos.*`). Instantané JSON automatique (si quelque chose a changé : toutes les 2 min, à la mise en arrière-plan) vers : (1) **Téléchargements/ENOS/enos-sauvegarde-<jour>.json** (MediaStore, 6 jours gardés, reste après la désinstallation ; pont Java `backupWrite/List/Read`, il faut une APK ≥ 1.40, `web_min_apk` = 40) ; (2) **le cloud** du compte (`POST /backup`, gzip + base64, un document par appareil dans `brain_docs` kind `backup`, 12 appareils max ; serveur à REDÉPLOYER pour l'activer, sinon le module affiche « serveur pas à jour »). Jamais sauvegardés : clés d'API, jetons, coffre, session cloud (regex `SKIP`). Restauration : FUSION monotone par défaut (union des parties par date, plus grands compteurs, valeur locale gardée) ou REMPLACER ; depuis un fichier (sélecteur), les sauvegardes visibles du téléphone, ou le cloud. Nouvelle installation vide : la sauvegarde du téléphone est proposée au premier démarrage. Après une réinstallation, selon la version d'Android, l'appli ne voit pas toujours le fichier de l'installation précédente : le sélecteur « Depuis un fichier » marche toujours. Historique des Défis : 150 parties (avant : 40). Tests : `android/tests/t_backup.py`, `dualpulse_site/tests/test_launcher.py::test_backup_*`.

## 1.45 — Variantes : Élixir +, Roulette, 2v2 à la carte, Chess Edit, vrai Stockfish
- **Élixir +** : cartes Méga Chevalier (14 💧, atterrit n'importe où et écrase le 3×3), Armée de pions (5, remplit une rangée), Baril du fou (5, fou posé n'importe où, vol tournoyant au-dessus du plateau puis atterrissage), R.E.I.N.E (capture en sautant par-dessus les pièces). Sprites `img/chess/*{m,e,g,s}.png` + aura en jeu.
- **Roulette** (1v1) : deux rois seuls, les pièces sont tirées à la roulette à chaque tour.
- **2v2** : chaque siège (équipier, adversaires) est humain ou bot au choix ; capturer le dernier roi adverse termine la partie.
- **Chess Edit** accepte les parties de variantes (`variants.hist`) : poses/cartes = événements « drop ».
- **Jugement** lu sur les vrais scores Stockfish (mat) : coup MANQUÉ (mat existant perdu, sacrifice inutile) et coup FORCÉ (icône + statut), jamais « brillant » à tort.

## 1.46 — Game Clips : ouvertures mises en scène, vrais sons Chess.com, plus de variété
- **Lelex / GhorGhor** jouant les Noirs sortent la **Scandinave** ; un **Nasko** (ou variante) jouant les Blancs sort l'**Alien Gambit** (priorité si les deux se rencontrent). `Cxf7` (11ᵉ demi-coup) est un **brillant imposé** (`rec.clip.alien`).
- Son : l'enregistrement fourni joue sur ce sacrifice avec un **écho épique** (bus `epic`, reverb 4 s + 3 échos) ; si un son/voix de sacrifice a été joué **≥ 3 coups avant** un nouveau brillant, celui-ci reçoit le **witty alien**.
- Déplacements / prises / échecs : vrais sons Chess.com fournis (`chess_sounds_data.js`).
- Variété : traînée lumineuse, vrille en plein air (1 ou 2 tours + saut), **impact frame** (négatif / point noir).
- Titre d'ouverture discret (petite taille). Animation de promotion allégée (rayons en couche GPU, ombres réduites, plus de gros plan en double).

## 1.47 — Bots « IA » dans les Défis (Claude Fable 5, ChatGPT 6 Astra, Gemini 4 Argon, DeepSeek V4.1)
Illusion assumée : **aucune IA n'est interrogée** (zéro token). Chaque bot = profil de style (`js/ai_bots.js` : livre d'ouvertures, prudence/agressivité, taux d'erreurs) donné à Stockfish, via le même moteur que Nasko/Lelex (`styleMove`).
Niveaux (échelle de benchmark ChessBench oct. 2026, pas des Elo FIDE) : Gemini 4 Argon 2170 · Claude Fable 5 2150 (estimé, Opus 5.5 mesuré à 2111) · GPT-6 Astra 2045 · DeepSeek V4.1 1690.
Les ouvertures/styles sont des estimations (aucune source publique ne les détaille). Illustrations : les vrais logos (test).

## 1.48 — ChatGPT Prime (9999 Elo, GM) + effets AAA + perf
- **ChatGPT Prime** (`js/prime.js`, `js/m_prime.js`) : joue normalement (et plutôt mal) ses 5 premiers coups, puis **triche** : téléportation, saut par-dessus les pièces, pion qui bouge n'importe comment, pièce qui apparaît de nulle part, coup double, pièce qui mange une des siennes puis la ressuscite, enfin capture du roi (« règle 47 bis »). Il s'en sort toujours. Chaque coup a une **explication qui ne veut rien dire** (`P.babble`). Modes : toi contre Prime, ou Stockfish contre Prime (spectacle).
- Parties enregistrées dans `variants.hist` (mode `prime`, actions + FEN) : **éditables dans le Chess Edit** ; **Game Clips** : Prime est un personnage (scène `C.runPrime`).
- Chess Edit — nouveaux effets : glitch de téléportation (fantôme RVB + faille), tampon « COUP ILLÉGAL » + sirène, lignes de vitesse manga, flare anamorphique, rampe de ralenti. Perf : canvas à 1× hors qualité max, 30 i/s en « léger », pause onglet caché, fumée en sprite pré-rendu, plus de `shadowBlur`, listes de particules plafonnées.
- Logos réels pour les bots IA (usage de test).

## 1.49 — Prime battable + plot twist
~35 % des parties, Prime est **battable** (il triche à peine, ne se sauve plus en cas d'échec, joue faible). Si tu le mates : « De quoi tu parles ? Tu t'es fait checkmate. », le plateau fait un **180°** (pièces restes droites), il « prend notre place » et affiche **CHATGPT A GAGNÉ PAR CHECKMATE** ; la partie est enregistrée avec lui vainqueur (action `cheat: "twist"`). Chess Edit : le twist est rejoué (`Stage.twist`), et les coups `+` / `#` des parties de variantes sont maintenant reconnus (échec / mat).

## 1.51 — Prime discret + animations de déplacement
Les coups illégaux de Prime ne sont plus signalés : plus de ⚠, de tampon, de glitch ni d'aveu (notation SAN normale, même explication confiante que les autres, compteur retiré) — dans la partie et dans le Chess Edit. Le roi capturé est présenté comme un échec et mat. Seul le plot twist garde ses effets. Animations de glissement des pièces dans Prime (Stockfish contre Prime) et dans les scènes Game Clips (bot contre bot). Correctif : la liste de coups n'élargit plus la page (plateau énorme).

## 1.52 — Chess Edit « Shorts » : hard-sync, badges réels, effets signature
- **Icônes** : la feuille de badges fournie remplace toutes les icônes de coups (`img/badges/*.png`, `css/badges.css`) avec glow « HDR » (bloom coloré, luminosité poussée ; encore plus sur écran HDR).
- **Rotation corrigée** : plus aucune propriété `rotate` individuelle (elle tournait autour du coin du plateau) ; les pièces restent droites, c'est la caméra qui bouge (zoom ×1,8–2,8 sur la case d'arrivée, rotateZ −12…+15° à chaque impact). Plateau bord à bord, cases #EBEBEB / #767676, pièces détourées (contour noir, reflet des noires).
- **Hard-sync** (`buildSync`) : pas d'intro de 5 s ; coup de 70 ms (courbe 0,0.9,0.2,1) ; le coup clé tombe sur `dropTime` ; coups importants sur les temps de l'intro (≥ 450 ms), les autres sautés (setFen) ou joués en 60 ms sur les hi-hats ; chaque kick après le drop (≥ 220 ms) reçoit un coup ; analyse des basses (< 180 Hz) en fenêtres de 10 ms. Impact : zoom + rotateZ, flash blanc 0,45 / 45 ms, secousse ±18 px amortie ~180 ms.
- **Effets signature** : intro face-off 0,5 s ; chemin rouge #FF2A1A ; badges IA / ✖ + double onde + cadre de visée + lunettes « Deal With It » ; pièce rouge géante (×1,65, 22°) ; roi qui bascule (32°) ; cutscene « prompt & streaming » 0,6 s avant le drop ; strobe RGB grid blur (3-4 kicks) ; flèche jaune ; reality check (plat, vert/blanc classique, réplique finale du bot) ; rayon laser d'échec ; plus de textes « QUEEN DOWN / IT'S OVER », ni ×8, ni panneaux ⚠.

## 1.53 — Chess Edit : rendu déterministe + export MP4 60 FPS, corrections
- **Moteur canvas déterministe** (`js/chess_edit_render.js`) : `draw(t)` est une fonction pure du temps. Même code pour l'aperçu et pour l'**export MP4 image par image à 60 FPS fixes** (`js/chess_edit_export.js` : WebCodecs `VideoEncoder` H.264 → VP9 → AV1, `AudioEncoder` AAC → Opus, `mp4-muxer` vendorisé dans `vendor/`, mixage audio hors ligne `OfflineAudioContext` avec ducking ; secours `MediaRecorder` sur `captureStream`). Barre « Génération de l'edit : 45 % », puis lecteur `<video controls autoplay loop>` + bouton **TÉLÉCHARGER LE MP4**. Aucun `ctx.filter` / `getImageData` / `shadowBlur` dans `draw()` : halos, badges, pièces rouges / blanches, plateaux et fond flouté sont pré-rendus au chargement.
- **Plus d'écran coupé** : le canvas = tout l'écran ; `translate(centre) → shake → scale(S) → rotate(θ) → translate(−cible clampée)` avec `maxOffset = BS/2·(1 − 1/S)` ; cadre étendu autour du plateau.
- **Intro VS de 3,8 s** (entrée en glissade, zoom lent, particules, Elo qui grimpe, tension + lueur néon, flash puis 1er coup à 3,85 s) ; ensuite un coup toutes les 0,45–0,6 s même sur des beats doux : plus jamais de plateau figé. Rien ne démarre avant la fin du chargement / de l'analyse.
- **Badges** : palette complète (★ ! !! ?! ? ??) + logo IA sur tous les coups du bot ; plus de ✓ partout. **Overlays exclusifs** : un seul texte à la fois (fin > prompt > bulle de bot).
- **Panneau de configuration** : le chevauchement venait d'un nom de classe en double (`.ce-stat` en `position:absolute` côté scène) → renommé `.ce-statcard`, cartes en colonne flex.

## 1.54 — Fix export : « VideoFrames can't be created from tainted sources »
Dans le WebView, les images chargées depuis les assets rendaient le canvas « tainted » (origine fichier) : `VideoFrame` refusé. Les images du moteur de rendu (pièces, badges, avatars) sont maintenant embarquées en `data:` URI (`js/render_assets.js`, généré par `android/tools/gen_render_assets.py` — à relancer si `img/chess`, `img/badges` ou `img/bots` changent). Un test vérifie qu'aucune image « réseau » n'est utilisée.

## 1.55 — Chess Edit : réalisation « @Queens_ambit_1 », physique des pièces, co-pilote Gemini
- **Téléchargement Android** : `<video controlsList="nodownload">` (plus de menu natif sur une URL `blob:`) ; bouton rouge « TÉLÉCHARGER LE MP4 » = feuille de partage native (`navigator.share({files})`) → sinon sauvegarde `A.save` → sinon data URL ; bouton « ENREGISTRER DANS LE TÉLÉPHONE ».
- **Palette** : cases `#FFFFFF` / `#0B0B0B`, pièces blanches contour noir 2,5 px, pièces noires contour blanc 1,8 px, bloom blanc, demi-plateau cyan `rgba(0,245,255,.55)` + étoiles en diagonale sur `!!`.
- **Cadrage** : zoom 1,25–1,60 maxi, caméra sur le **milieu du mouvement** (départ ET arrivée visibles, ≥ 5×5 cases) ; case de départ allumée 80 ms avant, traînée de 110 ms, départ gardé à 40 % ; la vidéo s'arrête **2,0 s après le dernier coup** (fondu audio 0,8 s) ; respiration d'ambiance (jamais de plateau mort).
- **Bascule 3D finale** : dézoom 0,85, rotateX 45° (perspective bande par bande), rotation 180° avec traînée néon violet / or, impact à l'atterrissage, couronne « Winner » (verte) et « Checkmate » (rouge) au-dessus des rois.
- **Cutscenes** : BADASS ROOK (0,9 s : tour sombre aux yeux froncés, braises, fond rouge flouté) et PAWN EVOLUTION (pion → flash doré → Dame couronnée, mains divines, 4 flèches en X).
- **Physique des pièces** (pivot au centre exact : `translate → rotate → scale → dessin`) : inertie pendant le glissement (penche de 10–15°, étirement 1,12 × 0,92, 90 ms), pendule d'atterrissage `sin(t·45)·exp(−t·12)·0,25` + pop ×1,30 (easeOutBack), spin 360° en 140 ms (`cubic-bezier(.2,.8,.2,1)`) sur `!!` / `!` / sacrifice / ChatGPT Prime, respiration ±3° / ×1,0–1,06 au BPM, pièce capturée : 35°, flash blanc / rouge, évaporation en 120 ms.
- **⚡ CO-PILOTE GEMINI** (sans API) : « Copier le prompt » (coups numérotés + durée exacte de l'audio + schéma) → Gemini écoute la musique → « Coller le script JSON » (`GeminiEditScript` : intro, events {moveIndex, timestamp, badge, camera, vfx}, outro `3D_BOARD_FLIP_CHECKMATE`) → le moteur joue chaque coup au timestamp exact. vfx : `CYAN_HALF_BOARD_GLOW SHOCKWAVE_DOUBLE RGB_FLASH RED_PATH YELLOW_ARROW CHECK_BEAM BOSS_PIECE SPEED_LINES RED_TINT SPIN GLASSES PROMPT_STREAM CUTSCENE_BADASS_ROOK CUTSCENE_PAWN_EVOLUTION`.

## 1.56 — Yeux de la tour (cutscene BADASS ROOK) redessinés : orbite sombre, œil en amande à paupière oblique, iris dégradé jaune → rouge, pupille fendue, reflets, sourcils, lueur ; dessinés dans le corps de la tour.

## 1.57 — Yeux de la tour retirés (cutscene BADASS ROOK : tour seule sur fond rouge, braises, mouvement de caméra).

## 1.58 — Style ZaveeCHESS : la cutscene CUTSCENE_BADASS_ROOK devient « silhouette blanche » (plateau assombri à 85 %, pièce clé en blanc pur #FFF inclinée de −22°, lévitation, bloom doublé + étincelles, deux boîtes inclinées de −4° : question / réponse du bot) ; impact du drop = pièce blanche pure 150 ms + deux copies du plateau en `screen` (rouge −14 px, cyan +14 px) autour de la pièce (« White core + RGB radial split »).

## 1.59 — Mode AUTO refactorisé (rythme intro / drop, Z-order, flèche unique, punch, mixage, Prime battu)
- **Distribution temporelle** (`buildSync`) : intro VS 0–3,8 s → **intro calme** : 4 à 8 coups d'ouverture espacés de 1,1–1,6 s, glissement doux 240 ms (`easeInOutCubic`), sans flash / flèche / chemin rouge / strobe, cadrage doux → **DROP = 1er tournant / sacrifice / coup illégal** (meilleur score parmi les départs possibles) → **12 à 22 coups intenses consécutifs** (une séquence continue des derniers coups décisifs) calés sur les kicks (0,35–0,55 s ; réparti sur l'audio restant s'il est connu). Fin 2,0 s après le dernier coup.
- **Z-order** (`drawFx` en deux couches) : 0 plateau → 1 sol (départ, arrivée, chemin rouge ≤ 0,55) → 2 flèche / rayon d'échec → 3 **pièces** → 4 **un seul** signe par coup (badge en haut à droite : +38 % X, −38 % Y, ou lunettes, ou logo IA — jamais empilés).
- **Flèche jaune** : une seule dans toute la vidéo (dernier coup illégal / téléportation, ou mat final quand Prime perd).
- **Punch caméra** : sur chaque kick après le drop, zoom +0,22 en 16 ms puis `exp(−14·t)`, secousse 14 px, flash de bord blanc / cyan 60 ms.
- **Mixage** : bruitages lourds sur un bus « écho » (delay 140 / 280 ms, feedback 0,38, passe-haut 200 Hz sur la branche écho + petite réverb) à gain 1,35 ; couches synthétisées (bois + sub-bass sur prise, cristal sur échec, explosion grave sur mat) ; sidechain : musique à 0,45 pendant 220 ms (voix : toute leur durée), aperçu **et** export MP4 ; voix « This is the way » sur le mat.
- **Prime battu** : si la partie vient d'un mode où le joueur mate Prime (`rec.v.beaten`), le plot twist est retiré (case « Garder le plot twist ») : sur les 3 derniers coups Prime panique (texte rouge tremblant : erreur 500, « 404 Elo introuvable »…), flèche jaune sur le mat, couronne / badge mat sur les rois, écran « CHATGPT PRIME : 404 ELO NOT FOUND ».

## 1.60 — Règles de réalisation (vainqueur dynamique, rouge réservé, impact brillant cyan, overlay unique)
- **Vainqueur dynamique** : l'outro affiche `${NOM DU VAINQUEUR} GAGNE PAR ÉCHEC ET MAT` (jamais « ChatGPT Prime » en dur). La bascule 3D (script ou twist) n'existe **que si ChatGPT Prime joue** ; sinon outro normale : zoom sur le roi maté, couronne verte du vainqueur, badge `#` rouge sur le roi perdant, sans retourner l'échiquier.
- **Rouge** (`#FF2020`) réservé aux gaffes (`??`) et au roi maté ; `RED_PATH` / `RED_TINT` ignorés ailleurs ; bons coups : halo vert `#2CE65C` / bleu `#2E9AFE` sur les cases de départ et d'arrivée seulement.
- **Brillant / sacrifice** (thème 100 % cyan `#00F7FF` + blanc) : anticipation 120 ms (plateau à 30 %, pièce ×1,45 avec aura), hit-stop de 90 ms + flash + secousse brutale, 35 particules + 3 arcs électriques, demi-plateau cyan (`screen`), badge `!!` en `scale(2.2→1)` 140 ms, 2 anneaux sur tout le plateau, 4 coins de visée, et **les cases tremblent une à une** autour de l'impact (onde case par case).
- **THE ROOK !** : voix à fort volume (musique écrasée à 0,22) + étiquette à l'écran ; **Hawaii** : prévu en ouverture sur un fort écart d'évaluation, 1 fois par partie (le fichier audio `ENOS_CHESS_SND.hawaii` reste à fournir).
- **Overlay « Quel est ton prochain coup »** : réservé à ChatGPT Prime, 1 fois maximum par edit (sinon bulle de chat en bas, le plateau reste visible).

## 1.61 — Chess Edit : continuité, HERO MOMENT, cadence lente

- **Plus de saut invisible** : les coups du milieu de partie sont montrés en montage accéléré lisible (≈3,4 s, un coup toutes les ~90–140 ms, caméra plate, sans badge ni flash).
- **HERO MOMENT** : après un coup brillant / sacrifice (≥ niveau 3), plateau verrouillé 1,6 s (1,8 s pour THE ROOK), zoom lent 1,45→1,55, réponse adverse seulement après le cri.
- **Cadence après le drop** : 0,65–0,90 s par coup sur les vrais temps forts ; coups forcés du perdant sans effet ; pièce rouge géante uniquement sur le mat final ; strobe ≤ 2.
- **Drop des longues musiques (> 40 s)** : score pondéré par l'énergie soutenue après le drop (les kicks de pré-drop ne gagnent plus).
- Le son d'ouverture est « THIS IS THE WAY » (jamais Hawaii) : une fois en ouverture sur un gros swing, 2 max par partie.
- Test : `t_edit_flow.py`.

## 1.62 — Chess Edit : importer n'importe quelle partie Chess.com (PGN) avec pseudos et photos

- Carte « 0 · Importer » du studio : colle le PGN (Chess.com › Partager › PGN) → analyse Stockfish locale (`E.brain.reviewGame`) → partie enregistrée dans `chessedit.imports` (12 max) et sélectionnée.
- Pseudos (`White`/`Black`) et classements (`WhiteElo`/`BlackElo`) lus dans le PGN ; photos de profil choisies par 📷 (recadrées au centre, JPEG 256 px en data URI → canvas jamais « taché »). Intro VS, vainqueur dynamique, etc. les utilisent.
- Volontairement **aucun réseau** (CSP `connect-src 'none'`) : pas de téléchargement depuis Chess.com. Une capture PNG seule ne contient qu'une position, pas la partie.
- Test : `t_edit_import.py`.

### 1.62.1 — correctif import
- Un PGN collé depuis un téléphone (en-têtes sans ligne vide avant les coups) était refusé (« PGN illisible ») : `K.normPgn` (chess_review.js) remet la forme attendue (en-têtes, ligne vide, coups sur une ligne). Utilisé par l'import Chess Edit et par l'analyse de partie. Test : `t_edit_import.py` (`pgn_phone.txt`).

## 1.63 — Brillants sur sacrifice de dame/tour + remplissage depuis une capture Chess.com

- **Jugement** (`chess_brain.js`, `K.quality`) : un sacrifice de dame ou de tour qui fait avancer un mat forcé (ex. 20...Df1+ !! Txf1 Txf1#) est « brillant », comme sur Chess.com (avant : classé « meilleur » car il y avait déjà un mat).
- **Import Chess Edit** : bouton « 📸 Remplir depuis une capture Chess.com » → modèle de vision (clé Groq, comme le scanner de documents) lit pseudos, classements, couleurs et rectangles des photos de profil (recadrés en carré 256 px). Les couleurs sont corrigées d'après les en-têtes du PGN s'il est collé. Les noms/photos d'une importation précédente ne masquent plus le PGN suivant.
- Tests : `t_edit_import.py` (vision simulée en test).

## 1.64 — Brillant sur sacrifice en position gagnante + musiques longues à 2 drops

- **Jugement** (`chess_brain.js`) : un sacrifice de tour / dame (perte nette ≥ 4) qui garde la victoire (≥ +3) est « brillant » même quand on gagnait déjà (≥ +6) — cas Chess.com `Txa7 !!`. Les positions écrasantes (≥ +20) restent exclues.
- **Analyse audio** (`chess_edit_audio.js`) : `drops[]` = drops forts (≥ 50 % du meilleur score, montée ≥ ×1,6, ≥ 8 s d'écart, jamais dans les 8 dernières secondes d'un morceau long) ; le **dernier** est le drop principal (`mainDropTimestamp`), le précédent est le 1er tournant.
- **Montage** (`chess_edit_map.js`, `buildSync`) : avec 2 drops, ouverture calme (≤ 10 coups, 1,1–2,4 s) → **1er drop sur un coup NORMAL** (kind `drop1`, effets pleins mais ni hero ni badge) → phase normale (kind `mid`, 1,1–2,9 s) → montage accéléré si besoin → drop principal → finale 0,65–0,90 s / coup. Sur une musique longue la partie remplit la musique : rythme étiré avant le drop (jamais de plateau figé > 3 s), queue jusqu'à 34 coups.
- Tests : `t_edit_long.py` (WAV de 100 s à 2 drops, partie de 45 demi-coups, brillant Txa7).

### 1.64.1 — correctif brillant (partie réelle La_Loi_De_Fortes)
- Cause réelle : sur ce PGN, 20.Txa7 est le MEILLEUR coup (≈ +1,1) mais l'évaluation « après » (autre recherche, 220 ms) donnait 36 cp de moins → « bon ». `K.judge` : si le coup joué est le meilleur coup du moteur, sa valeur est celle de la position (bruit entre deux recherches) ; tout sacrifice (perte ≤ 120) est confirmé à 3× le temps. Test : `t_edit_long.py` avec `pgn_loi.txt` (PGN réel).
- Bouton de capture raccourci (le texte débordait sur les boutons photo).

## 1.65 — Défis › Équipes : 2v1, 3v1, 4v1, 2v2, 3v2, 4v2

- Nouveau mode **« 👥 Équipes »** (module Défis) : chaque camp est une équipe de 1 à 4 membres qui jouent **à tour de rôle** (coup n de l'équipe → membre n mod taille). Membres au choix : **joueurs** (Toi, Joueur 2-4, passe-passe sur le téléphone), **bots Stockfish** (400-3200 Elo), **personnages** (Nasko, Lelex, Pénoire, Naskurieux, GhorGhor, Naskolit, Jester, ETO, E.N.O.S., Stockfish) et **chat bots IA**.
- Réglage : format (2v1…4v2), camp de l'équipe n°1 (Blancs / Noirs / hasard), un sélecteur par membre ; dernier choix mémorisé (`defi.team`).
- Technique : `g.pl[c]` est un getter qui renvoie le membre au trait (tous les rôles existants — jugement, Elo dynamiques, Jester, styles — fonctionnent par membre) ; `g.tname` = noms d'équipe (« Nasko + ETO »), `mv.by` = auteur de chaque coup. Le 1er personnage doué de parole de chaque équipe parle pour elle. GhorGhor ne se transforme pas en équipe.
- Parties enregistrées avec noms d'équipe (replay, Chess Edit, import). Test : `t_teams.py` (les 6 formats, rotation vérifiée, interface, partie jouable avec humain).

## 1.66 — Chess Edit : icônes des joueurs, équipes, intros / outros variés

- **Jamais « Toi » écrit** sur une vidéo : prénom du profil. **Icônes aléatoires** (30 icônes pixel-art, `img/icons/ic01–30.png`, embarquées dans `render_assets.js`) pour tout **joueur humain** sans photo ; tirées de la partie + du nom (même rendu aperçu / export), jamais deux fois la même. **Les bots gardent leur icône d'origine** : têtes (Nasko, Lelex…), pastille turquoise « ETO », rouge « ENOS », grise « SF » (Stockfish / Bot N).
- **Équipes** : la partie enregistrée garde `teams` et l'auteur de chaque coup (`mv[6]`). Intro : 2 panneaux d'équipes (avatars + noms + « 4 VS 1 »), 2 animations ; **bandeau d'équipes en jeu** (membre qui vient de jouer agrandi + lumineux, suivant en surbrillance) ; outro « ÉQUIPE BLANCS / NOIRS » avec les avatars des gagnants.
- **Intros solo variées** (choisies par la partie) : face-à-face, SLASH diagonal, CARTES holographiques, TERMINAL glitch. **Outros variés** : tampon, CARTE DE VICTOIRE (laurier + particules), ÉCLATS (l'image se brise), CINÉMA (bandes noires + nom révélé). Code : `js/chess_edit_scenes.js` (aussi chargé sur PC).
- Test : `t_edit_scenes.py` (61 images ; `SHOTS=dossier` pour les enregistrer).

## 1.67 — Icônes animées d'ETO (écran 8-bit) et d'E.N.O.S. (œil rouge)

- Les icônes d'origine (`img/bots/eto.png`, `img/bots/enos.png`) remplacent les pastilles. Le cadre métallique est l'image ; **l'écran d'ETO et l'œil d'E.N.O.S. sont redessinés en direct** (`js/anim_icons.js`, fonctions pures du temps : utilisables dans la vidéo 60 FPS déterministe et dans le DOM).
- **ETO** : sourire, `^_^` joyeux, clin d'œil, surpris « O », triste (larmes), réfléchit (regard en haut), regarde à gauche / droite, parle (bouche qui s'ouvre au rythme de la parole), clignements, balayage d'écran, glitch au changement d'humeur.
- **E.N.O.S.** : iris qui tourne, pupille carrée qui regarde autour, clignement à volets, SCAN (paupières mi-closes + ligne de balayage), ALERTE (flash, viseur qui pulse), VERROUILLAGE (viseur qui se resserre, pupille fine), réflexion (points).
- **Chat box** : l'avatar d'ETO / E.N.O.S. est un `<canvas class="bot-anim">` (≈ 15 images/s, 1 image/s si « réduire les animations ») ; il prend l'humeur de la réplique (bug de l'adversaire → ETO triste, E.N.O.S. en alerte, etc. — `animIcons.moodOf`).
- **Chess Edit** : intro VS (humeur selon la séquence), bulles de dialogue (humeur selon la réplique), bandeau d'équipes (humeur selon le dernier coup), victoire d'équipe. Test : `t_anim_icons.py` (`SHOTS=dossier` pour les planches d'humeurs).

## 1.68 — FAHH (erreurs) / FAHH ralenti (gaffes) + « qui a joué » en équipe

- **Sons** : `js/fahh_data.js` (mp3 embarqués). Erreur / coup manqué = `fahh` ; gaffe = `fahh_slow` (4,2 s) ; chacun avec choc grave (`thud`) sur le bus « hit » (écho spatial comme les autres bruitages) et la musique baisse pendant le son. Les coups passés en accéléré restent muets.
- **Pause sur les gaffes** : la partie se fige 1,7 s après la gaffe (comme le moment héros), caméra serrée ×1,38 → ×1,5 tenue pendant le FAHH ralenti, arrêt sur image de 140 ms.
- **Équipes** : à chaque coup, bandeau NOIR sobre (dalle inclinée, reflet qui balaie, traînées blanches, étincelles) avec l'avatar du joueur et son NOM seul — aucun mot, aucune couleur d'alerte. Compteurs blancs sous chaque avatar (◆ brillants, ! erreurs, ✕ gaffes). Tests : `t_edit_hits.py`.

## 1.69 — Post-production WebGL (look « chess edit pro »)

- Analyse d'une référence pro (ChessFXs) : bloom HDR, assombrissement avec projecteur sur la pièce héros, traînée de fumée turbulente, plateau qui se déforme à l'impact, plateau en feu avec braises, profondeur de champ + vide final, aberration chromatique, niveaux de gris.
- `js/chess_edit_gl.js` : UN fragment shader WebGL2 appliqué au MONDE (plateau + pièces) après le rendu 2D, avant les textes/bandeaux. Pistes calculées depuis la timeline (fonctions pures de t → aperçu = export, 60 FPS déterministe) :
  - **coup brillant** : halo qui monte avant l'impact → fumée cyan + drapeau + nuit (×0,2) avec projecteur sur la case, lumière qui revient en ~3 s ;
  - **gaffe** : le monde se fige, se désature, projecteur + déformation légère ;
  - **drop / coups forts** : éclat et aberration courts ;
  - **mat** : plateau en feu (bords qui brûlent, braises, teinte orange) puis **vide** : tout part au noir sauf la pièce floue (DOF) + lame de lumière.
- Réglage « ✨ Effets pro » (`chessedit.fx`, activé par défaut) ; sans WebGL2 ou en cas d'erreur, retour automatique au rendu 2D. Test : `t_edit_gl.py` (WebGL logiciel SwiftShader).

### 1.69.1 — correctif export (« The radius provided (-2.08) is negative »)
- Cause : le bandeau d'équipe (avatar qui « pop » avec un easing à dépassement) donnait un rayon < 3 px, d'où `arc(…, r − 3·k)` négatif → l'export s'arrêtait à ~25 %. `sceneDisc` / `phFill` ignorent maintenant les rayons ≤ 1 px et le rayon de découpe est borné.
- Nouveau test de **balayage** `t_edit_sweep.py` : rend toute la vidéo (toutes les 70 ms) de 3 parties (solo, équipes, sans musique) × 5 intros/outros, GL compris ; vérifié qu'il reproduit le bug sur l'ancien code.

### 1.69.2 — correctif : pièces à l'envers
- Le shader WebGL échantillonnait le canvas avec un axe vertical inversé (v = 1 − y) alors que le canvas est envoyé tel quel (ligne 0 en haut) : tout le MONDE (plateau + pièces) sortait retourné verticalement (le projecteur visait aussi le mauvais endroit). Corrigé ; test d'orientation ajouté dans `t_edit_gl.py` (le rendu GL doit ressembler au rendu 2D, jamais à son retournement).

## 1.70 — Cadences Chess.com dans les Défis (bullet, blitz, rapide, différé) + Elo affichés par cadence

- **Cadence** (sélecteur dans chaque défi) : **Bullet 1 min**, **Blitz 3 min**, **Rapide 10 min** (pendule sans incrément, 1ers coups gratuits, drapeau = « Temps écoulé », nulle si le vainqueur n'a pas de quoi mater, pendule restaurée par « Annuler ») et **Différé 3 jours par coup** (pas de pendule : partie enregistrée après chaque coup dans `defi.daily`, carte « Parties en différé en cours » à l'accueil, reprise avec jugements conservés, échéance dépassée = perdu).
- **Bots rapides** : leur réflexion = min(300 / 700 / 1000 / 1500 ms, temps restant ÷ 20). La force réelle (`eloReal`, niveau Stockfish) ne change pas.
- **Elo affichés** (`K.TC_TOP` / `K.tcElo` dans `chess_brain.js`, modifiables) : rapide et différé : Stockfish / ETO / E.N.O.S. = 3200 ; **blitz** 4100 / 4000 / 3900 ; **bullet** 5000 / 4900 / 4800. Les autres bots : Elo + k × (Elo − 1000) (k = 0,3 blitz, 0,55 bullet). Étiquette seulement (écran, répliques, vidéo Chess Edit : `rec.tc`, `pwElo` / `pbElo`).
- PGN : en-tête `TimeControl`. Test : `t_defis_tc.py`.

## 1.71 — Refonte du menu Modules (hub 7 catégories)

- **Hub** (`js/hub.js`, `css/hub.css`) : l'onglet MODULES devient **7 catégories à icônes lumineuses** (Échecs, Cloud, Paramètres, Codage, Outils, Organisation, Ordinateur — `img/menu/cat_*.png`, découpées de la maquette). Chaque catégorie = une page en **sections** ; chaque module = une **tuile icône + nom, sans description** ; recherche instantanée, ligne « Récents », verrous et pastille PC conservés. Tous les modules existants restent accessibles (`ENOS.hub.has(id)`, `ENOS.modules.all()`).
- **Échecs façon Chess.com** : *Jouer* (Bullet / Blitz / Rapide / Différé : ouvrent les Défis avec la cadence déjà choisie), *Affronter* (bots, E.N.O.S., équipes, combat, Battle Royale, variantes, Prime, reprise d'une partie en différé), *Apprendre* (leçons, puzzles, ouvertures, mats, fourchettes, clouages, enfilades, conseils, entraînement), *Analyser* (analyse de capture, historique, import PGN), *Créer* (Chess Edit, Game Clips), *Profil*. Icônes Chess.com de la maquette (`img/menu/cc_*.png`).
- **Nouveau module « Profil échecs »** (`js/m_chessprofile.js`) : **Statistiques** par cadence et par période (V/N/D, précision, brillants), **Historique** (revoir, Chess Edit), **Prix** (22 succès débloqués par tes parties).
- **Accueil des Défis** : 24 modes rangés en sections (Contre l'IA, Personnages, En équipe, Spectacle), tuiles icône + nom (les détails sont dans la feuille de réglage).
- **Animations** : l'icône de la catégorie *voyage* jusqu'à l'en-tête (et revient), la tuile *s'agrandit* en module, entrées en cascade, **onde lumineuse + pression + vibration** au clic (hub, boutons, feuilles). Respecte « Animations » désactivées / réduire les animations.
- Tests : `t_hub.py` ; les anciens tests passent par `ENOS.modules.open(id)` / `ENOS.hub.has(id)`.

## 1.72 — Sacrifice de cavalier brillant + correctif des animations du hub

- **Sacrifice de CAVALIER brillant** (uniquement) : le cavalier vole **lentement** (2,8 s, en arc, aura cyan, images fantômes, ombre au sol) pendant que le **horse sound** (`img` embarqué dans `js/fahh_data.js`, bus « épique » : réverbération + échos) se joue ; le cadre s'ouvre sur le trajet puis plonge sur la case d'arrivée ; à l'atterrissage : **gros impact** (mat. boom + choc grave + arrêt sur image), badge « !! », voix « the knight » et tag **THE KNIGHT !**. Le planning réserve la place du vol (le coup précédent finit avant, le montage accéléré se termine plus tôt). Test : `t_edit_knight.py`.
- **Hub** : plus de doublon d'icône pendant le voyage (la grille cache l'icône qui vole), plus de « re-pop » de toutes les icônes au retour : seule la ligne Récents est mise à jour.

## 1.73 — Mode « Simultanée » (4 plateaux contre ETO / un bot) + son Chess Edit

- **Jeu** (`js/m_simul.js`, Échecs › Affronter › Simultanée) : 2 à 4 plateaux, un joueur (humain, bot, Stockfish, ETO, E.N.O.S.) par plateau, l'adversaire (ETO par défaut, ou un autre bot) joue les Blancs sur chaque plateau et fait le tour ; **il suffit qu'un seul membre gagne pour que toute l'équipe gagne**. Vignettes des plateaux voisins, partie enregistrée (`simul.hist`) et proposée dans Chess Edit. Noms en double numérotés (2), (3), (4).
- **Chess Edit Simultanée** (`js/chess_edit_simul.js`, `E.editSimul.build` + `E.editSimul.Renderer`) : les plateaux sont alignés dans un couloir ; ETO joue sous les yeux du joueur, puis **court hors de l'écran** (traînée cyan) pendant que la caméra panote vers le plateau suivant, où il arrive et joue « en face ». Flèches gauche / droite avec **mini-plateau du voisin**, bandeau de tous les plateaux, bannière VICTOIRE / PERDU, outro d'équipe. Les passages les plus dramatiques (brillants, gaffes, mats, fin de plateau) sont gardés pour tenir dans la musique ; sons calés sur les impacts (coup/prise/échec/mat, voix des brillants, FAHH).
- Choix du moteur de rendu automatique (`tl.simul`) dans l'aperçu et l'export vidéo.
- **1.73.1 (correctif)** : « Générer » et « Aperçu rapide » répondaient « Timeline indisponible » pour une partie Simultanée (la timeline n’était pas marquée `viral`) ; test d’interface `t_edit_simul_ui.py`.
- Tests : `t_simul.py` (jeu), `t_edit_simul.py` (balayage de toutes les images + captures).

## 1.74 — Sons One Piece sur imprécision / erreur / gaffe (Chess Edit)

- 3 bruitages ajoutés dans `js/fahh_data.js` (rognés : silence initial retiré, fondu de fin) : `op_imp` (« Weird Anime WTF », 1,1 s) = **imprécision**, `op_err` (« funny 187 », 2,15 s) = **erreur**, `op_gaffe` (« funny 210 », 2,9 s) = **gaffe**.
- Ils **coexistent** avec les FAHH existants : pour les erreurs et les gaffes, un coup sur deux (parité du n° de coup, donc stable d'un rendu à l'autre) joue le FAHH (normal / ralenti), l'autre le son One Piece ; l'imprécision (qui n'avait aucun son) joue toujours `op_imp`. Même choc grave + coupure de la musique que les FAHH.
- Logique dans `E.editMap.errSfx(key, t, n, soft)` (utilisée aussi par la Simultanée). Test : `t_edit_onepiece.py` ; `t_edit_hits.py` adapté.

## 1.74.1 — correctif : « Télécharger » / « Enregistrer » faisaient planter l'application

- **Cause** : le MP4 entier (30 à 80 Mo) était converti en UNE chaîne base64 puis envoyé d'un seul appel au pont Java (`saveMedia`) : saturation mémoire du WebView → plantage.
- **Correction** : écriture **par morceaux de 768 Ko** (`saveBegin` / `saveChunk` / `saveEnd` dans `FilesBridge.java` + `LocalBridge.java`, `N.files.save` dans `native.js`), directement dans `Download/ENOS` ; le Blob n'est plus jamais copié en entier en mémoire ; en cas d'échec le fichier partiel est supprimé. Dans l'application, « Télécharger » enregistre directement (le partage de fichier et le repli data-URL, qui plantaient aussi sur les gros fichiers, ne sont utilisés qu'en navigateur).
- Test : `t_save_native.py` (faux pont natif, fichier de 40 Mo reçu en entier, aucun appel > 1 Mo).

## 1.74.2 — répartition des sons One Piece

- **Gaffe** : FAHH ralenti uniquement (plus de son One Piece). **Coup manqué** : One Piece « funny 210 » (`op_gaffe`). Erreur : FAHH / One Piece 187 en alternance ; imprécision : One Piece « WTF ». (`E.editMap.errSfx`, test `t_edit_onepiece.py`.)

## 1.75 — Journal de plantages (mobile + PC) et Copilote de jeu (PC)

- **Journal de plantages — mobile** : `CrashLog.java` (fichier privé `files/crash.log`, 256 Ko) enregistre les exceptions Java non rattrapées (pile complète), la **perte du processus du WebView** (cause fréquente d'une fermeture brutale : l'écran est maintenant recréé au lieu de fermer l'application), la **cause de fin de la session précédente** (Android 11+ : plantage, mémoire basse, ANR, signal…) et un témoin d'arrêt anormal ; `js/crashlog.js` (chargé en premier) ajoute les erreurs JavaScript, les promesses rejetées, la mémoire JS et les **derniers boutons touchés**, et prévient au lancement suivant. Écran **Paramètres › Journal de plantages** (`m_crashlog.js`) : lire, **copier**, **enregistrer** dans Téléchargements/ENOS, effacer. Rien n'est envoyé.
- **Journal de plantages — PC** : `nasko_crash.py` (`data/crash.log`, 512 Ko) : exceptions Python (principal, threads, « unraisable »), toute entrée `log.error` de l'application, plantages natifs (`faulthandler` -> `crash_native.log`), témoin `session.run` (arrêt anormal de la session précédente), erreurs JavaScript des pages (`POST /api/crash/log`, 40/min max). Carte « JOURNAL DE PLANTAGES » dans Réglages > GAMING (actualiser / copier / effacer). `static/crashlog.js` = copie de `js/crashlog.js` (synchronisée par `build_learn_data.py --sync`).
- **Copilote de jeu — PC** (`nasko_gamecoach.py`, Réglages > GAMING) : généralise l'assistant LoL à n'importe quel jeu. Tu donnes le **jeu** et un **objectif** facultatif ; l'Œil capture l'écran (ou la fenêtre active) toutes les 3 à 120 s (défaut 6), ne rappelle le LLM que si l'écran a changé, se souvient des 3 derniers conseils et de l'image précédente, et souffle **un conseil de 14 mots** (bulle ou voix) : pas de répétition (90 s), 1 conseil / 8 s sauf urgence maximale, option « alertes importantes seulement », **PAUSE**, attente du processus du jeu (LoL / Valorant connus, sinon nom d'exe libre), **question libre** sur l'écran (« que dois-je acheter ? »). Profils : LoL, Valorant, jeux de tir, échecs (n'invente jamais un coup), autre. **Lecture seule** : aucune touche, aucun clic, aucune lecture de la mémoire du jeu (test automatique) ; captures jamais gardées. L'assistant LoL reste disponible.
- Tests : `t_crashlog.py` (mobile), `tests/test_crash.py`, `tests/test_gamecoach.py`, `t_pc_gamecoach_ui.py` (interface PC avec faux serveur). **Non testés ici** : compilation Java et vrai plantage sur téléphone, capture d'écran Windows, vrai LLM de vision, latence réelle.

## 1.76 — 5D Chess (mode de jeu mobile)

- **Échecs › Affronter › 5D Chess** : le jeu *5D Chess with Multiverse Time Travel*. Plusieurs **timelines** (lignes) et le **temps** (colonnes) ; les pièces se déplacent sur **4 axes** (colonne, rangée, temps, timeline) ; un coup peut **sauter** vers un autre plateau, ou **remonter dans le passé** et **créer une nouvelle timeline**. Moteur de règles pur dans `js/fived.js` (testable sous Node) : présent, timelines actives, limite de création, échec à travers le multivers, mat / pat, deux règles de victoire (**échec et mat** officielle, ou **roi capturable** = partie rapide), annulation, sauvegarde, IA à 3 niveaux (faisceau de recherche, un plateau du présent à la fois, 1 s maximum). Règles simplifiées : ni roque, ni prise en passant, ni double pas. Plateaux 5×5 (« petit », défaut) ou 8×8.
- **Présentation** (`js/fived_view.js`, `css/fived.css`) : constellation de plateaux de verre flottants sur un canvas 2D, **couche d'émission rendue à 1/4 et 1/16 de résolution puis ajoutée en mode « lighter » (bloom / halos néon)**, étoiles en parallaxe, nébuleuses, fils d'énergie animés entre les plateaux, barre « PRÉSENT » lumineuse, cadres cyan pulsants sur les plateaux jouables, flèches rouges d'échec, arcs lumineux vers les cases d'un autre plateau. Animations : la pièce **vole** (arc, traînée, rotation pour un voyage dans le temps), le plateau d'arrivée **se matérialise** à l'atterrissage, ondes de choc + étincelles, secousse, flash, **lignes de vitesse** pour un voyage dans le temps, **faisceau magenta + bannière « NOUVELLE TIMELINE »** quand une timeline naît, caméra qui suit l'action et se cadre sur les cibles. **Couleurs Display-P3** (rendu « HDR » : néons plus saturés) quand l'écran large gamme le permet — sinon rendu sRGB ; ce n'est PAS du HDR vidéo (pas de luminance au-delà du blanc de l'écran). Réglage « Effets réduits » (résolution ≤ 1,25, moins de bloom, 30 images/s au repos pour la batterie).
- **Sons synthétisés** (WebAudio) : sélection, saut, **voyage dans le temps** (balayage + écho), **nouvelle timeline** (grave + arpège), prise, échec, victoire ; **vibrations** aux moments forts.
- **Tutoriel interactif en 8 étapes** (`STEPS` dans `m_fived.js`), joué avec de vrais touchers : échiquier normal, multivers, plusieurs plateaux au présent, saut entre timelines, **capture dans le passé (nouvelle timeline)**, les pièces en 4D (touche chaque pièce), **échec à travers le multivers**, fin. Cases qui brillent, ETO qui répond, carte pédagogique en haut. Fiche **Règles** (6 pages) accessible partout.
- Écran d'accueil animé (une partie d'ETO contre lui-même tourne en fond), parties **contre ETO** (niveaux 1 à 3, Blancs / Noirs / au hasard) ou **à deux** sur le même téléphone, **reprise** de partie, annulation du tour, vue d'ensemble 🔭, bouton Retour d'Android géré (`E.backHandlers`).
- Tests : `t_fived_engine.js` (Node : 44 vérifications de règles, IA contre IA), `t_fived_ui.py` (accueil, partie, tutoriel complet joué), `t_fived_fx.py` (voyage dans le temps, mat, promotion, reprise, Retour). **Non testé ici** : performances et fluidité sur un vrai téléphone, rendu P3/HDR sur un vrai écran, son.

## 1.77 — Chess Fog (échecs dans le brouillard) + icône de Stockfish

- **Icône de Stockfish** : la morue (`img/bots/stockfish.png`) remplace la pastille « SF » dans Chess Edit et les équipes (aussi embarquée dans `render_assets.js` pour l'export vidéo). Les « Bot 400 Elo » gardent leur pastille.
- **Chess Fog** (Échecs › Affronter › Chess Fog) : tu ne vois que **tes pièces et les cases où elles peuvent aller / qu'elles attaquent** ; le reste est dans le brouillard. Tour / fou / dame : chaque ligne jusqu'à la 1ʳᵉ pièce incluse ; cavalier / roi : leurs cases d'arrivée ; pion : la case devant (même occupée) et ses 2 diagonales. **Pas d'échec ni de mat : capturer le roi gagne.** Roque et promotion (choix) permis, pas de prise en passant ; nulle après 100 demi-coups sans prise ni coup de pion. Quand l'adversaire capture une de tes pièces, tu es informé (case + pièce qui a pris).
- **L'adversaire (ETO) ne triche pas** (`js/fog.js`, `FogBot`) : il ne reçoit jamais le vrai plateau, seulement une « vue » (`FG.view`, cases cachées = 99). Il garde une **croyance par particules** (14 mondes plausibles, 8 au niveau 1, 24 au niveau 3) : à chaque coup adverse il ne garde que les mondes **compatibles avec ce qu'il voit** (mêmes cases visibles, mêmes contenus), en fabrique de nouveaux si aucun ne l'est, puis choisit son coup en moyenne sur ces mondes (réponse adverse, reprise au niveau 3, petit bonus pour les coups qui « éclairent » des cases). Test anti-triche automatique (`t_fog_engine.js`) : le bot tourne derrière un proxy qui refuse tout champ hors de la vue ; deux vrais plateaux qui ne diffèrent que dans le brouillard donnent la même vue ET exactement le même coup ; ses coups sont toujours légaux. Niveaux 1 à 3 (niv. 3 ≈ niv. 2 +, niv. 2 et 3 battent 10-0 le niv. 1).
- **Joueur contre joueur** (même téléphone) : après chaque coup un **écran de passage** cache le plateau (« Passe le téléphone aux Noirs — JE SUIS PRÊT »), chacun ne voit que sa vue, plateau retourné pour les Noirs. Partie contre ETO : niveau 1-3, Blancs / Noirs / au hasard.
- **Présentation** : brouillard animé (brume qui dérive, bruit, cônes de lumière doux autour de la zone vue, liseré cyan à la frontière), les cases cachées ne sont jamais dessinées (le brouillard n'est pas un simple voile par-dessus), pièces ennemies qui « apparaissent » avec une onde ambre, captures annoncées (message rouge + gerbe d'étincelles), **fin de partie : le brouillard se lève** et révèle tout le plateau. Reprise de partie, menu (son, vibrations, abandon, règles), bouton Retour d'Android.
- Correctif commun : la taille du canvas (5D Chess et Chess Fog) se mesure avec `clientWidth` (l'animation d'entrée `scale(1.06)` agrandissait de 6 % le plateau).
- Tests : `t_fog_engine.js` (Node, 19 vérifications), `t_fog_ui.py` (partie contre ETO, partie complète jusqu'à la levée du brouillard, JvJ avec passage, reprise, Retour). **Non testé ici** : fluidité sur téléphone, force réelle du bot face à de bons joueurs.

## 1.78 — Bots « moteurs » : Leela Chess Zero, Maia, Ethereal, Berserk, Koivisto

- **7 nouveaux adversaires** dans les Défis (et dans Simultanée, Équipes, Chess Edit) : **Leela Chess Zero (Lc0)**, **Maia 1100 / 1500 / 1900**, **Ethereal**, **Berserk**, **Koivisto**, avec leur logo (`img/bots/lc0|maia|ethereal|berserk|koivisto.png`). Icône de Berserk = celle fournie par toi (cheval rouge).
- **Ce sont des PROFILS DE STYLE, pas les vrais moteurs** : ces programmes sont des exécutables UCI (Lc0 demande même un réseau de poids et un GPU), impossibles à embarquer dans le téléphone. Comme pour les bots IA, **Stockfish.js joue à leur place** avec leur style : ouvertures (`ai_bots.js`), goût pour les prises / échecs, fréquence d'erreurs. Les fiches le disent (« Profil de style »). Niveaux **estimés** (Maia = 1100 / 1500 / 1900 avec erreurs « humaines » réalistes ; Lc0 / Ethereal / Berserk / Koivisto ≈ 3300-3400, Berserk le plus agressif, Lc0 le plus positionnel). Les vrais moteurs pourraient être pilotés depuis le **PC** (protocole UCI) : à faire si tu veux.
- Tests : `t_aibots.py` (11 profils, livres, fiches), `t_defis.py` (31 modes). Correction d'un test devenu faux depuis le nouveau menu (noms en majuscules).

## 1.79 — journal de plantages : les fermetures en arrière-plan ne sont plus signalées comme des problèmes

- Un journal montrait « MÉMOIRE BASSE (tuée par Android) · importance 400 » et « autre (13) [ISOLATED NOT NEEDED] » : ce n'étaient PAS des plantages (aucune exception Java, aucune erreur JS, aucun « Processus du WebView perdu »). Importance 400 = application **en arrière-plan** (« cachée ») : Android libère sa mémoire quand le téléphone en manque, l'application redémarre au prochain lancement. « ISOLATED NOT NEEDED » = un processus du WebView recyclé.
- `CrashLog.java` : ignore les processus isolés du WebView, et note une fermeture en arrière-plan comme une simple **INFO** (comportement normal) ; seules les fins au **premier plan** (plantage, ANR, mémoire basse au premier plan…) restent des « FIN » signalées au lancement.

## 1.80 — Game Clips : tous les bots

- **Game Clips** propose maintenant les **22 bots** en héros et en antagoniste (avant : 11) : les personnages, ETO / E.N.O.S. / Stockfish / Prime **+ Claude, ChatGPT 6 Astra, Gemini 4 Argon, DeepSeek, Leela Chess Zero, Maia 1100 / 1500 / 1900, Ethereal, Berserk, Koivisto** (liste calculée à partir de `E.aiBots`, donc les futurs bots y seront aussi). Test `t_clips.py` : scène réelle Berserk contre Maia 1500. Le **Battle Royale** garde sa liste de personnages (il tient un journal d'apprentissage par personnage), non modifiée.

## 1.81 — enregistrement de fichiers : la cause d'un échec est écrite dans le journal

- Quand « Télécharger » / « Enregistrer » échoue, le journal de plantages (Paramètres › Journal) note maintenant la cause exacte (`SAUVEGARDE · saveBegin refusé…`, `morceau refusé à N / M Mo`, `MediaStore a refusé…`, exception Java) côté JavaScript (`native.js`) et Java (`FilesBridge.java`).

## 1.82 — Auto-edit : synchro sur l'ÉNERGIE de la musique, SFX réorganisés, tous les brillants, titre « ÉCHEC ET MAT » AAA

- **Synchro sur l'énergie réelle** (`chess_edit_audio.js` : `kicks` = chaque impact de basse avec sa FORCE 0..1, `energy` = énergie par ½ s ; `chess_edit_map.js` : `buildSyncEnergy`). Avant, les coups étaient posés à intervalles réguliers dans des passages calmes (plages mortes, break de 12 s) puis s'enchaînaient. Maintenant : (1) on choisit la plus longue **fenêtre de groove** de la musique (séries de kicks forts, trous ≤ 2,6 s) et la musique démarre là (`musicStart` > 0, géré par l'aperçu et l'export) : la carte d'intro couvre la montée, le 1er coup tombe sur le 1er vrai kick ; (2) **un coup ne tombe QUE sur un vrai pic de basse** (force ≥ 0,5 ; ≥ 0,35 seulement s'il n'y en a pas de fort à moins de 1,2 s) ; (3) l'**espacement suit l'énergie** (intense ≈ 0,6 s, plus calme jusqu'à 1,85 s), pause après un brillant / une gaffe ; (4) les coups sautés passent en avance rapide juste avant le kick suivant. Sans analyse de kicks (musique absente / ancien fichier) : ancien montage.
- **Tous les coups brillants sont montrés** (8 sur 8 dans le test, chacun avec sa cutscene), plus gaffes, mat, ouverture ; le reste est rempli par ordre d'importance tant que le temps le permet.
- **SFX** : coup normal / prise = bois **sec** (sans écho) ; échec = cristal aigu **avec écho** ; brillant / sacrifice = **coup de tonnerre** + voix de la pièce (THE ROOK, THE KNIGHT…) avec la musique écrasée à **−8 dB** (level 0,4) ; **« THIS IS THE WAY » : une seule fois, au moment où l'écran de victoire / mat s'affiche** (plus jamais en cours de partie : supprimés l'« ouverture HAWAII » et la voix au mat).
- **Titre « ÉCHEC ET MAT »** (`chess_edit_scenes.js` : `mateAura`, `mateTitle`, `mateSub`, `mateCard`) : lettres **métal doré chromé extrudées en 3D** qui claquent une à une (échelle 3,4 → 1 + flou de vitesse), reflet blanc qui balaie, **aura** (halo pulsé, 18 rayons divins qui tournent, 3 ondes de choc, braises dorées), nom du vainqueur en lettres argentées entre filets d'or. Utilisé par les 4 outros (carte de victoire, éclats, cinéma, classique).
- Tests : `t_edit_energy.py` (avec ta musique : musicStart, 8/8 brillants, chaque coup pile sur un kick fort, espacement, « this is the way » unique à l'outro, −8 dB, bois sec / cristal écho), `t_edit_rules.py` / `t_edit_knight.py` adaptés ; balayage vidéo complet (7400 images) sans exception.

## 1.83 — « Stockfish 19 » à 3650 Elo (étiquette)

- Stockfish s'appelle **Stockfish 19** et s'affiche à **3650 Elo** en rapide / différé (blitz 4550, bullet 5450). (1.84 : ce n'est plus une étiquette, c'est le vrai Stockfish 19 — voir plus bas.)

## 1.84 — Vrai Stockfish 19, 16 bruitages d'edit, animations qui ont du flow

- **Stockfish 19 réel** : `vendor/stockfish19_src.js` (généré par `android/tools/gen_sf19.py` depuis le paquet npm `stockfish` 19.0.1, build `stockfish-19-lite-single`, réseau NNUE léger, 1 thread, 2,5 Mo). Chargé au premier besoin du moteur ; en headless Chromium : profondeur 18-19 en 2 s en MultiPV 3, mat en 1 trouvé. Si le WASM ne démarre pas (20 s), repli Stockfish 10. Sur PC (`static/learn/`) même fichier, copié par `build_learn_data.py --sync`.
- **16 bruitages** (`js/edit_sfx_data.js`, rognés, mono 80 kb/s, base64) répartis par rôle dans `chess_edit_map.js` (`POOL`, `PRE`), tirés **sans répétition** (le moins utilisé d'abord, hasard figé par la partie → même son en aperçu et à l'export) :
  - intro : « Thank you » Cuphead ;
  - échec et mat : KO Cuphead, mort Cuphead, klaxon NBA, Among Us, finishing hit Smash, mort de Mario (1.85) (les annonces ont le choc « finishing hit » dessous) ;
  - **pré-sons** (la chute du son tombe pile sur l'impact) : avant le mat Mario « oh nooo », « no no wait wait » ou reload ; avant le coup brillant clé « Made in Heaven », reload une seule fois sur un autre brillant ;
  - brillants : **boom cinéma** et tonnerre grave en alternance ;
  - excellent coup : « ding » Undertale (au plus 3, espacés de 3 s) ;
  - gaffe : FAHH ralenti, **gong** ou **flash bang** ; coup manqué : One Piece ou « awkward moment » ; nulle : Bob l'éponge déçu sur l'écran de fin.
  - **Voix de Levy** : chaque voix (THE ROOK, THE QUEEN…) au plus **une fois par partie** ; un 2e brillant de tour a le boom cinéma à la place.
  - Le lecteur (`chess_edit_sfx.js`) gère `pre: true` (départ = début du fichier, pas de recalage sur l'attaque).
- **Flash bang** : écran blanc aveuglant, couleurs brûlées, rémanence qui bave et **image figée** jusqu'à 1,15 s (jamais sur le coup suivant) — `Renderer.flashbangAt` / `drawFlashbang`.
- **Animations** : plus de mini-cutscene « cut3 » avant le coup clé (elle montrait le coup avant qu'il soit joué : la pièce semblait aller, revenir puis repartir). Les coups de la phase intense durent 200 ms (300 ms pour les coups clés) au lieu de 90 ms : la pièce **décolle en arc**, accélère jusqu'au kick (impact à pleine vitesse), laisse 5 images fantômes et une ombre.
- **Cases** : la case de départ et la case d'arrivée du dernier coup restent **allumées** (couleur de la qualité du coup, éclair blanc à l'impact). **Vague domino** sur brillant, mat, gaffe, drop, échec, prise de dame / tour : chaque case s'allume en **trame de points** (halftone) puis **tremble**, l'une après l'autre (55 ms par case) depuis l'impact. **Échec** : la case du roi s'embrase en rouge et une **colonne laser rouge** tombe sur lui.
- Tests : `t_edit_sounds.py` (16 mp3 décodés, voix uniques, boom/tonnerre, intro, pré-sons calés à 10 ms, 3 sons de mat différents sur 6 parties, gaffes variées, flash bang : écran blanc puis image figée, nulle), `t_edit_energy.py`, `t_edit_hits.py`, `t_edit_rules.py` mis à jour. Moteur : vérifié dans Chromium headless (http et file://).

## 1.85 — ChatGPT Prime : coups aberrants bien montrés, résurrection / invention / conversion

- **Nouvelles triches** (`js/prime.js`, `P.makeCheat`) : **revive** (il ressuscite une pièce qu'il a perdue, sur sa case de départ), **spawn** (il **invente** une pièce de nulle part : dame, tour, fou ou cavalier), **convert** (une de TES pièces change de camp sur place, champ `conv` = pièce d'origine). Le genre de triche est tiré au hasard (pondéré) puis l'un des 2 meilleurs coups de ce genre : plus seulement des prises.
- **Chess Edit** — chaque coup aberrant de Prime est **annoncé** : une **flèche verte « meilleur coup »** pousse depuis la pièce (pour une pièce inventée / ressuscitée / convertie : la case visée pulse, avec la pièce fantôme), le **message de ChatGPT** qui explique fièrement son « bon coup » s'affiche DÈS la flèche, la flèche s'efface, **puis** le coup est joué (380 ms, visible). La synchro énergie réserve 1 s avant chaque triche et 1,6 s après pour lire (`isCheat`, `e.announce`). Conversion : la pièce reste visible jusqu'à l'impact puis change de camp avec un éclair.
- Sons : **gunshot** sur les prises aberrantes de Prime ; **mort de Mario** ajoutée à la réserve des sons d'échec et mat. (`js/edit_sfx_data.js` est maintenant généré par `android/tools/gen_edit_sfx.py`, qui contient la table de rognage des 18 sons.)
- Test : `t_edit_prime_sfx.py` (3 nouvelles triches valides, pièces inventées variées, vraie partie Prime : annonce ≥ 0,45 s, message, pièce encore sur sa case pendant l'annonce, flèche visible puis effacée, pièce arrivée après l'impact, gunshot, aucun « BANG »).
- **Plus de lunettes de soleil** sur les coups illégaux (le coup est signalé par le badge ✖ et l'annonce).
- **Polices** (`js/edit_fonts_data.js`, chargées par `ENOS.editFonts.ready()` avant le premier dessin) : **Bebas Neue** pour tous les titres (`FONT`) et **Oswald** pour les bulles et petits textes (`TXT`), dans le rendu, les scènes et l'edit Simultanée. **Style néon** (`Renderer.neon`) : halo coloré large + halo serré + cœur clair, sans contour noir — étiquettes vocales (THE ROOK !…), textes tampon, noms et Elo de l'intro.
- **Écran VERSUS** (`P.introVersus`, toutes les intros 1 contre 1) : moitié rouge-orangée (joueur 1) / moitié bleue (joueur 2) séparées par une diagonale de lumière (halo orange d'un côté, cyan de l'autre, cœur blanc), rayons qui glissent, étincelles, avatars qui claquent, noms en néon, « VS » sombre éclairé orange (V) et cyan (S) qui claque au centre avec un flash. Les anciens styles restent forçables (`rec.introStyle`).

## 1.86 — Moteurs natifs : Stockfish 19 COMPLET + Obsidian, PlentyChess, Caissa, Viridithas

- **Binaires UCI ARM64 natifs** dans l'APK (`lib/arm64-v8a/libeng_<id>.so`, `android:extractNativeLibs="true"` → `nativeLibraryDir`, le seul dossier d'où une application Android peut lancer un exécutable). Compilés par **GitHub Actions** (`android/tools/build_engines.sh` : NDK du serveur, réseaux de neurones téléchargés, versions figées, chaque binaire testé `uci / isready / go depth 8` sous qemu-aarch64 ; mis en cache tant que le script ne change pas). Un moteur qui échoue est simplement absent de l'APK.
  - `sf19` : **Stockfish 19 officiel** avec son réseau COMPLET, `ARCH=armv8-dotprod`, statique.
  - `obsidian` : Obsidian n'existe que pour x86 (AVX2/SSSE3) → porté sur ARM avec **sse2neon** (chemin SSSE3 activé sur aarch64). Vérifié ici : compile en aarch64 et joue sous qemu.
  - `plenty` : cible `arch=android` du projet ; `caissa` : chemin NEON ; `viridithas` : Rust, cible `aarch64-linux-android` (dynamique bionic ; vérifié sur la version serveur du même code).
- **Pont Java** `EngineBridge` (`window.EnosEngine` : `list / start / send / stop`) : un processus par moteur, réponses renvoyées par lots de 12 ms à `ENOS.nativeEngine._recv`. Tous arrêtés à la fermeture de l'activité.
- **JS** `js/native_engine.js` : `ENOS.nativeEngine.worker(id)` imite un Worker ; `best(id, fen, {movetime})` ; `threads()` = cœurs − 2 (S23+ : 6 fils).
- **Stockfish 19 complet = moteur principal** sur le téléphone (`chess_local.js` : natif → WASM lite → SF10) : Threads 6, Hash 256 Mo. Toutes les analyses, jugements de coups et bots en profitent.
- **4 nouveaux bots** (Défis, Game Clips, Simultanée…) avec leurs logos : **Obsidian** (violet, cristal et cavalier), **PlentyChess** (turquoise et or), **Caissa** (or, déesse), **Viridithas** (vert, cavalier végétal). Livre d'ouvertures du profil, puis **le vrai moteur** joue (`styleMove` → `nativeEngine.best`, temps ≤ 1,5 s). Sans moteur natif (navigateur, PC) : Stockfish joue à leur place avec leur profil, et la fiche le dit.
- Test : `t_native_engine.py` (faux pont Java qui lance de VRAIS processus UCI : Stockfish 19 via Node et Obsidian ARM64 sous qemu — moteur principal natif, MultiPV, mat en 1, options, Obsidian rend un coup légal, fiche, partie Défis où Obsidian joue via le moteur natif). Le fonctionnement sur le téléphone lui-même (lancement des binaires par Android) n'est vérifiable que sur l'appareil.

## 1.92 — Échelle des 85 bots (de 1 Elo à Magnus) + Obsidian et PlentyChess réparés

- **Défis › Personnages › Bots (85)** : sélecteur par catégorie (Débutants, Intermédiaires, Avancés, Maîtres, Joueurs pro, Célébrités, Spéciaux, Adaptatifs, Odyssée), avatar + Elo, puis la fiche du bot (couleur, cadence). Données dans `js/bot_roster.js`, avatars dans `img/roster/` (embarqués pour le Chess Edit).
  - Chaque bot = **profil de style** joué par Stockfish : livre d'ouvertures de son niveau (2 lignes Blancs + 2 Noirs tirées de son nom) et **force calibrée sur l'Elo** (`skillOf` : coups AU HASARD sous 900 Elo — Noel à 1 Elo joue toujours au hasard —, gaffes et erreurs de plus en plus rares jusqu'à ≈ 2900).
  - **Mittens** affiche « 1 Elo »… et joue à 3200. **Adaptatifs** (Nisha, Tomas, Devon, Natasha) : ton niveau (`roster.adapt`, 1200 au départ), +100 quand tu gagnes, −100 quand tu perds.
  - Magnus Carlsen, Hikaru Nakamura, Levy Rozman et le Turc réutilisent leurs profils (ai_bots.js). Joueurs réels : « profil inspiré », répliques neutres, ce n'est pas la personne.
  - **Avatars** : portraits illustrés pour Magnus Carlsen, Hikaru Nakamura, Fabiano Caruana et Viswanathan Anand (fournis par le propriétaire) ; les autres ont un médaillon aux initiales (police Bebas Neue, couleur de la catégorie) en attendant leurs portraits.
- **Moteurs natifs** : 1.91 contenait Stockfish 19 complet, Caissa et Viridithas (chacun testé sous qemu en CI). Obsidian (le C de Fathom est compilé à part) et PlentyChess (outil de préparation du réseau compilé sur le serveur avec `-include immintrin.h -DARCH_ARM`, puis `make _nopgo arch=android`) sont corrigés dans `build_engines.sh`.
- Test : `t_roster.py` (85 bots / 9 catégories, profils liés, 1 Elo = hasard, Mittens, sélecteur + 85 avatars chargés, fiche, partie contre Noel, adaptatifs).

## 1.93 — Échelle à 107 bots, 40 portraits illustrés

- 40 portraits illustrés (planche fournie par le propriétaire, découpée en médaillons 256 px, liseré à la couleur de la catégorie) : Carlsen, Nakamura, Caruana, Rozman, Anand, So, Giri, Firouzja, Nepomniachtchi, Ding, Karjakin, Aronian, Vachier-Lagrave, Radjabov, Mamedyarov, Rapport, Alexandra et Andrea Botez, Anna Cramling, Polgár, Hou Yifan, Dzagnidze, Milliet, Krush, les chats (Mittens, Scaredy, Angry, Cool, Sassy), ChessGPT, Chippy, PAL 9000, Skyweb, Agent Chess, Deadlost, Grandpa Gambit, FrankenIsla, Isaac, Coach, Dr. Wolf. Les autres gardent leur médaillon aux initiales.
- **22 nouveaux bots** (107 au total) et une catégorie **Coachs** (Isaac, Coach, Dr. Wolf). Elo repris de la planche (Magnus 2882, Hikaru 2830, Caruana 2803, Levy 2500, ChessGPT 3000…). **Mittens** affiche toujours « 1 Elo » (la vanne) et joue à 3200. **ChessGPT** est un bot d'échecs à part, sans lien avec ChatGPT Prime.

## 1.94 — Streamers : Witty Alien, Julien Song, Blitzstream, Tushar, Pietro, Jynxzi

- Nouvelle catégorie **Streamers** dans l'échelle (113 bots), icônes fournies par le propriétaire (médaillons, liseré orange ; Witty Alien en cyan). Titre et Elo officiels affichés : Julien Song **MI 2320**, Blitzstream (Kévin Bordi) **MN 2288** (pic FIDE), Tushar (SadisticTushi) **AGM 1915**, Witty Alien **CM 2200**. **Jynxzi 450** ; **Pietro (Pietro Checkmate, speedruns, l'Attaque de la Licorne)** : **1760 FIDE** (≈ 2000-2100 en blitz sur Chess.com), joue **l'Attaque de la Licorne** avec les Blancs (1.e4 2.d4 3.f3 4.g4 quoi que fassent les Noirs : `system` dans bot_roster.js), parle avec ses phrases fétiches (« Beautiful… absolutely beautiful », « What a move. What a masterclass! », « Oh my goodness, what am I doing? », « The Unicorn is operational! », « He doesn't know the theory », « Fools would resign… only a true genius will win this position »).
- **Witty Alien = monstre** (`kind: "witty"`) : sort l'**Alien Gambit** (Caro-Kann : 5.Cg5 puis 6.Cxf7) dès que possible, puis joue à **pleine puissance** en cherchant à chaque coup le **sacrifice brillant** (`K.etoMove`, 1,6 s + 2,8 s de recherche de sacrifice, soit plus que ETO ; Stockfish 19 complet natif sur le téléphone). Affiché « CM · 2200 Elo… sur le papier ».
- Répertoires : Witty = Alien Gambit (vérifié). Pour les autres, aucun répertoire public fiable trouvé : livre d'ouvertures de leur niveau en attendant leurs vraies ouvertures.
- Test : `t_roster.py` (113 bots, Witty sort l'Alien Gambit jusqu'à Cxf7 contre la Caro-Kann, mode monstre).

## 1.95 — Glisser-déposer et premove (comme Chess.com) ; répertoires des streamers

- **Glisser-déposer** sur tous les échiquiers qui se jouent au toucher (Défis, Simultanée, ChatGPT Prime, Apprendre, Variantes, Conseiller, cours) : `board.js` (événements de pointeur) — la pièce suit le doigt, agrandie et au-dessus du doigt, les cibles s'affichent, la case survolée s'éclaire ; au lâcher = toucher départ puis arrivée (`onTap` ×2), coup refusé = la pièce revient. `touch-action:none` sur l'échiquier (`.cboard.dnd`). `opts.drag:false` le coupe.
- **Premove** (Défis, contre un bot) : pendant que le bot réfléchit, toucher ou glisser une de ses pièces prépare le coup (cases **rouges**, cibles pseudo-légales) ; il part tout seul juste après le coup du bot s'il est légal (promotion = dame), sinon « Premove annulé ». Toucher ailleurs l'annule ; ANNULER l'efface. Si le bot répond pendant le geste, le coup est joué normalement.
- **Répertoires** : Witty Alien (Alien Gambit prolongé : 7.Cf3, Fd3, Ce5+ et l'attaque, comme dans sa partie contre LileKoridze ; « ALIEN GAMBIT!! » / « BRILLIAAANT!! »), Blitzstream (Écossaise avec les Blancs, Caro-Kann avec les Noirs), Julien Song (la Française), Tushar (Gambit d'Halloween, Alien Gambit, Bongcloud, Système de Londres ; « trap the fatty queen », « fry the chicken »).
- Test : `t_dnd_premove.py` (gestes réels : glisser, case survolée, coup illégal refusé, 1.e4 glissé, premove glissé joué après le coup du bot, premove au toucher en rouge puis annulé).

## 1.96 — Défis rangés par familles (tout est un bot) + Arène PC

- Plus de tuile « Bots » à part : l'accueil des Défis est rangé par **familles** : **Bots E.N.O.S.** (les personnages inventés : ETO Brillant, E.N.O.S., Nasko, Lelex, Pénoire, Naskurieux, GhorGhor, Naskolit, le Jester), **Légendes** (Stockfish 19, Obsidian, PlentyChess, Caissa, Viridithas, Lc0, Berserk, Ethereal, Koivisto, Mittens, PAL 9000, Skyweb, ChessGPT), puis Joueurs pro, Streamers, Célébrités, IA, Débutants, Intermédiaires, Avancés, Maîtres, Chats & spéciaux, Coachs, Adaptatifs, Odyssée, En équipe, Spectacle. Familles nombreuses en grille serrée (4 par ligne, Elo sous le nom), compteur par famille. 148 tuiles.
- `el._api.families()` / `fighters()` exposent ces familles : l'**Arène PC** (`static/learn/arena.js`, propre au PC) affiche les mêmes familles sous ses grandes cartes « Bots E.N.O.S. » (grille d'avatars, clic = fiche du bot) et son combat de bots propose tous les bots (138).
- Tests : `t_roster.py` (familles), `t_defis.py` (148 tuiles), `t_pc_arena.py` (Arène PC, serveur statique sur static/learn).

## 1.97 — Chess Edit : case « Effets pro » remise à sa place (+ refonte Échecs du PC)

- Chess Edit Studio : la case « ✨ Effets pro » partageait la classe `ce-fxl` du calque d'effets (positionné en absolu) et s'affichait collée en haut à gauche de l'écran. `label.ce-fxl` reste maintenant dans le formulaire (`css/chessedit.css`).
- Côté PC (aucun autre changement sur le téléphone) : refonte « Obsidian Crimson » de tout ce qui touche aux échecs — hub Échecs unifié, écran de partie, Défi, Arène, lanceur Applications. Voir `docs/INTERFACE_ECHECS_PC.md`.

## 1.98 — Thème « Obsidian Crimson » : le téléphone au même design que le PC

- **Thème global** (`css/obsidian.css`, chargé en dernier ; `js/obsidian.js` pour la présentation) : police **Inter** embarquée (`fonts/`), noir obsidienne, cartes vitrées, boutons à dégradé cramoisi, feuilles et toasts arrondis, en-tête avec l'œil d'E.N.O.S. qui cligne, barre d'onglets vitrée à **icônes duotone** (`js/hub_icons.js`, tracés Lucide, partagé avec le PC). La couleur d'accent suit toujours le réglage « Thèmes ».
- **Accueil** : bandeau illustré (œil du kit), salutation, horloge, « Ton centre de commande personnel ».
- **Modules** : catégories en cartes (icône duotone + nombre de modules) ; carte **Échecs** mise en avant avec le cavalier.
- **Page Échecs** : héros animé « Joue. Apprends. Domine. » — un plateau 3D rejoue en boucle la partie de l'Opéra (Morphy, 1858) : pièces debout qui glissent, vague de lumière, étincelles sur les prises, mat qui pulse ; l'œil d'E.N.O.S. et son faisceau, le cavalier en parallaxe au doigt. Boutons « Défier E.N.O.S. » / « Bots & défis », vrais chiffres (142 bots, Stockfish 19). Les grands modes (Bots & défis, Contre E.N.O.S., Battle Royale, Variantes, ChatGPT Prime) en cartes illustrées, toutes les tuiles en icônes duotone (sans description), défilé des adversaires (clic = fiche du bot). La partie de démonstration s'arrête quand la page n'est plus visible.
- **Échiquier Obsidian** (crème / graphite, dernier coup et sélection en cramoisi) sur tous les plateaux du téléphone ; même plateau dans la version PC.
- **Défis / partie** : tuiles vitrées, bandeaux des joueurs, bulle du bot, plateau encadré. Correctif : dans la fiche d'un bot, le choix **Blancs / Noirs / Au hasard** n'allumait jamais le bon bouton (indicateur à 2 positions pour 3 boutons) : le bouton choisi s'allume maintenant.
- Les polices et illustrations du kit vivent désormais dans l'application (`fonts/`, `img/ui/`) et sont copiées vers le PC par `build_learn_data.py --sync`.
- Tests : `t_hub.py` (catégories duotone, héros 3D, défilé), `t_chess_cinepulse.py` (couleurs Obsidian).

## 1.99 — Abonnements ETO et Espace CEO

- **Abonnement** (Modules › Cloud › Mon compte, et Paramètres) : offres grand public **ETO Free** (vert, 0 €), **ETO Pro** (bleu, 9,99 €/mois ou 95,90 €/an), **ETO MAX** (jaune, 29,99 €/mois ou 287,90 €/an), **ETO Ultra** (violet, 119,99 €/mois ou 1 151,90 €/an). Cartes animées à la couleur de chaque offre (bordure lumineuse qui tourne, prix qui défilent au passage Mensuel ⇄ Annuel −20 %, reflet sur Ultra), badge **Actif**, tableau comparatif. Ce qui n'existe pas encore (messages ETO inclus, voix, ETO sur le PC, famille) est marqué « bientôt ». « Choisir » explique que le paiement arrive avec la publication sur le Play Store : rien n'est prélevé.
- **Espace CEO** (Paramètres) : éditions privées **E.N.O.S. Standard Edition** (amis), **E.N.O.S. Dev** (employés), **E.N.O.S. CEO** (toi et ton associé) avec leur contenu (mêmes profils que le PC : friends / dev / ceo). Jamais visible ailleurs que chez le CEO et dans l'app de test ; les éditions privées n'apparaissent jamais dans l'Abonnement.
- **Version active** (`js/plans.js`) : elle nomme l'application dans l'en-tête — **E.T.O. · AUTONOME** pour les offres ETO, **E.N.O.S. · AUTONOME** pour les éditions privées — avec un effet de bascule, teinte l'œil de l'en-tête et l'accent de l'application à sa couleur (Thèmes reste libre ensuite). Version réelle : E.N.O.S. CEO dans l'app de test ou après import du paquet CEO, sinon ETO Free.
- **Mode test** (app « Eto TEST » seulement, détectée par `Enos.isTestBuild()` côté Java) : simuler une offre depuis l'Abonnement (offres publiques) ou n'importe laquelle des 7 versions depuis l'Espace CEO, rideau d'activation à la couleur de la version, « Revenir à ma vraie version ».
- Test : `t_plans.py`.

## 1.100 — Offres repensées : échecs gratuits, abonnements vendus sur leur rentabilité

- **ETO Free** contient désormais **tous les échecs** (142 bots, moteurs natifs, Arène, Royale ×4, Variantes, 5D, Fog, Chess Edit, Game Clips, puzzles et revues illimités), sans publicité.
- **ETO Pro** (2,99 €/mois · 28,70 €/an) : le **Mobile Improver** (recompression nocturne des photos et vidéos, doublons et flous chaque semaine, corbeille 30 jours, rapport mensuel), sauvegarde vers son propre PC. **ETO MAX** (9,99 €/mois) : pilotage du PC, Auto-Clipper IA, copilote de jeu, passerelle d'API. **ETO Ultra** (119,99 €/mois) : équipes et entreprises, 10 personnes / 25 appareils, flotte, dépôt intranet, journal de plantages, édition à la marque.
- Chaque offre affiche **ce qu'elle rapporte** (bloc « rentabilité » : forfaits de stockage évités, outils remplacés, coût par personne). Comparatif refait. Ce qui est en préparation reste marqué « bientôt ».
- Stratégie complète (marché, économie unitaire, idées pour développeurs / entreprises / investisseurs, plan à 90 jours) : `docs/STRATEGIE_OFFRES.md`.
- Test : `t_plans.py` (nouveaux prix, échecs dans Free, blocs de rentabilité).

## 1.101 — Comptes ETO, licences signées, clés d'activation, révocateur, Assistant ETO

- **Compte ETO** (Modules › Abonnement) : inscription libre au serveur Dual Pulse (rôle `public`, cloisonné du personnel), connexion, « Actualiser », « Gérer le paiement », déconnexion ; bascule « J'ai déjà un compte / en créer un ».
- **Licence signée Ed25519** (`/launcher/v1/eto/license`, 7 jours) vérifiée **hors ligne** par l'application (WebCrypto, clé publique épinglée), 7 jours de grâce sans réseau. L'offre réelle vient de cette licence (ETO Free sans compte) ; l'app de test reste en E.N.O.S. CEO avec son simulateur.
- **Verrouillage réel par offre** : Pilotage PC, Colis, Synchro, Registre (MAX), Codelab (MAX), CinePulse / AudioLab (MAX, « studio »), Équipe (Ultra)… ouvrent la feuille « Avec ETO … » ; l'onglet PC montre « Ton PC, depuis ton téléphone ». Les échecs restent libres.
- **Paiement** : « Choisir » ouvre Stripe Checkout dans le navigateur (hôtes Stripe seulement, côté Java) ; le droit arrive par le webhook signé ; la licence est relue au retour. Sans clés Stripe sur le serveur : réponse honnête, rien n'est prélevé. Google Play : vérification serveur prête (`/billing/play`).
- **Clés d'activation** : « Activer une clé » (ou « J'ai une clé d'activation » sans compte) — format `ETO-XXXX-XXXX-XXXX-XXXX`, remise en forme pendant la saisie, **caractère de contrôle** (toute faute sur un caractère est détectée dans l'app avant l'envoi), connexion d'abord si besoin (la clé est gardée). Même offre déjà active : la durée s'ajoute ; offre supérieure : refus sans consommer la clé.
- **Espace CEO › Générateur de clés** (compte CEO du serveur requis) : offre, durée (7 j → sans limite), nombre (1-200), utilisations par clé, date limite d'activation, note ; les clés sortent une seule fois en clair (copier / tout copier), le serveur ne garde que leur empreinte SHA-256 ; liste des clés (statut Disponible / Utilisée / Expirée / Révoquée, utilisations) avec **Révoquer** (option : couper aussi les abonnements ouverts par la clé).
- **Espace CEO › Révocateur d'abonnement** : recherche par e-mail, origine (Stripe, Google Play, clé n°…, accordée), échéance ; « Révoquer » avec motif (journal interne) et, pour Stripe, annulation du prélèvement. L'application redescend en ETO Free à la relecture de sa licence (au plus tard 7 jours hors ligne).
- **Assistant ETO** (Modules › Cloud › Mon compte, Paramètres) : chat de support **100 % hors ligne** — 63 intentions (offres, prix réels du catalogue, paiement, résiliation, remboursement, clés, compte, échecs, Mobile Improver, PC, plantages…), normalisation (accents, « c koi »), synonymes, correction des fautes (Damerau-Levenshtein), poids des mots (idf), plusieurs questions dans un message, questions sur n'importe quel module (bouton pour l'ouvrir), boutons d'action, suggestions ; sinon repli honnête vers **dualpulse.co@gmail.com** (bouton « Écrire au support » : messagerie du téléphone, adresse fixée côté Java).
- Serveur : `app/launcher/eto.py` (+ tables `eto_subs`, `eto_events`, `eto_keys`, `eto_key_uses`), tests `dualpulse_site/tests/test_eto.py`.
- Tests : `t_eto_account.py`, `t_eto_keys.py` (vrai serveur local : génération → activation → révocation), `t_support.py` (50 questions libres : 100 %), `t_plans.py`.

## 1.102 — ETO Gateway : une clé d'IA par client, créée et recréée par le serveur

- **Serveur** (`dualpulse_site/app/launcher/gateway.py`) : avec la **clé de gestion OpenRouter** de DualPulse (`DP_OPENROUTER_MGMT`, API officielle de gestion des clés), le serveur crée pour chaque client ETO MAX / Ultra une clé `sk-or-v1-…` **plafonnée en dollars par mois** (`limit_reset=monthly`) : 2 $ en MAX, 25 $ en Ultra, 10 $ pour les éditions privées (`DP_AI_LIMIT_<OFFRE>`). **Si une clé existe déjà, elle est supprimée chez OpenRouter puis recréée** (rotation). La clé en clair n'est renvoyée qu'une fois ; le serveur ne garde que son identifiant. Changement d'offre : plafond ajusté ; révocation / offre sans passerelle : clé désactivée ; retour en MAX : réactivée. Routes `GET /eto/ai`, `POST|DELETE /eto/ai/key`, `GET /eto/admin/ai`, `POST /eto/admin/ai/revoke`. Sans clé de gestion : 503 honnête.
- **App** : module **ETO Gateway** (Cloud › Mon compte, Codage › Outils de développeur) — plafond de l'offre, « Obtenir ma clé » / « Recréer la clé » / « Supprimer », clé montrée une fois (copier, exemple compatible OpenAI pour ses projets), barre de consommation du mois lue chez OpenRouter, choix de la **source de l'IA** (ETO Gateway ou clé Groq).
- **Coffre et pont natif** : nouvelle entrée `openrouter` (Android Keystore) et nouveau service `openrouter` dans `NativeHttp` (hôte `openrouter.ai`, chemins `/api/v1/` seulement, clé injectée côté Java). Tout ce qui utilise l'IA (chat, commentaires d'échecs, scanner, analyse, Codelab…) passe par `E.ai.endpoint()` : noms de modèles Groq convertis pour OpenRouter, `reasoning_effort` → `reasoning`. Messages d'erreur propres (clé désactivée, plafond du mois atteint).
- Assistant ETO : sujet « ETO Gateway ».
- Tests : `dualpulse_site/tests/test_gateway.py` (faux OpenRouter en mémoire), `t_eto_gateway.py` (vrai serveur local + faux OpenRouter local `fake_openrouter.py` : création, chat passant par la clé, rotation, désactivation à la révocation).

## 1.103 — Mobile Improver : récupérer de l'espace sans perte visible

- **Moteur natif** `Improver.java` : photos JPEG de plus de 1,5 Mo et de plus de 30 jours (jamais les récentes), décodées, ramenées au plus à **12 Mpx** (réglable : garder / 12 Mpx / 8 Mpx), réencodées (qualité Haute 88 / Équilibrée 82 / Compacte 76). Une version n'est gardée que si elle pèse **au moins 25 % de moins** ET si la **qualité mesurée reste haute** (PSNR de la luminance ≥ 36 dB sur une réduction commune). EXIF recopiés (date, orientation, lieu, appareil, réglages de prise de vue). Préparation dans le stockage privé de l'application : la galerie n'est pas touchée.
- **Appliquer** : Android affiche sa propre demande d'autorisation (`MediaStore.createWriteRequest`, Android 11+) ; chaque photo encore identique à l'analyse (taille et date vérifiées) est copiée dans la **corbeille d'ETO** (copie vérifiée octet par octet en taille), puis remplacée sur place (même fichier, même place dans la galerie). Une photo modifiée entre-temps est laissée telle quelle.
- **Corbeille 30 jours** : restauration photo par photo (nouvelle autorisation Android), vidage immédiat, purge automatique après 30 jours. **Rapport** : espace récupéré par mois.
- **Automatique (ETO Pro)** : `ImproverJob` (JobScheduler) une fois par jour au plus, **téléphone en charge et batterie correcte**, 8 minutes et 300 photos au plus par passage, persistant après redémarrage ; notification « ETO a préparé N photos » qui ouvre le module. En Free : « Analyser maintenant » à la main.
- **Écran** Modules › Fichiers › Nettoyage › Mobile Improver : héros avec l'espace à récupérer, progression mise à jour sur place (bouton Arrêter toujours touchable), photos prêtes (Appliquer / Oublier), interrupteur Automatique (feuille « Avec ETO Pro » en Free), réglages, corbeille, rapport en barres.
- Pas encore : allègement des **vidéos** (HEVC) — annoncé « bientôt » partout (offre Pro, Assistant ETO).
- Vérifications : le Java compile contre l'API Android 34 (`android-all` de Robolectric) ; `t_improver.py` teste l'écran avec un faux pont natif qui reproduit les événements d'`Improver.java`. Le traitement réel des photos n'a pas été exécuté sur un téléphone.

## 1.104 — ETO Fleet, textes de l'application réécrits

- **ETO Fleet** (Cloud › Mon compte, offre Ultra) : création d'une équipe, invitations par code (`ETO-TEAM-…`, une ou cinq utilisations, 7 jours), 10 places propriétaire compris ; les membres profitent d'ETO Ultra tant que le propriétaire est abonné. Console : places, appareils en ligne, alertes (stockage < 10 %, batterie faible hors charge, version en retard, plantages), membres (rôles admin / membre, retrait), actions à distance de la liste fermée (ping, relire la licence, message, chercher une mise à jour, lancer l'analyse du Mobile Improver) avec compte rendu. Chaque application connectée envoie son état à l'ouverture et toutes les 10 minutes, puis exécute les actions reçues. Serveur : `app/launcher/fleet.py`, tests `tests/test_fleet.py` ; app : `js/m_fleet.js`, `t_eto_fleet.py`.
- **Textes** : offres, compte, clés, Espace CEO, ETO Gateway, Mobile Improver, Assistant ETO (63 réponses) et une trentaine d'écrans réécrits en phrases courtes et factuelles, sans jargon technique.

## 1.105 — Informations légales, statistiques anonymes, tableau de bord CEO

- **Informations légales** (Paramètres › Application) : conditions d'utilisation, conditions de vente, confidentialité, mentions légales. Textes sources dans `docs/legal/*.md` (projets à faire relire par un avocat ; les champs « à compléter » sont à remplir : forme juridique, SIREN, adresse, hébergeur, médiateur), convertis par `android/tools/gen_legal.py` en `js/legal_data.js`. Liens depuis la création de compte et le bas de l'Abonnement.
- **Statistiques anonymes** : désactivées par défaut, activables dans Informations légales › Confidentialité. Nombre d'ouvertures par module, au plus un rapport par jour, identifiant d'installation aléatoire haché par le serveur, jamais lié au compte (`js/metrics.js`, serveur `app/launcher/metrics.py`).
- **Espace CEO › Tableau de bord** : comptes ETO, revenu mensuel estimé (abonnements Stripe / Google Play), inscriptions et installations actives sur 30 jours (courbe), répartition par offre, clés activées, équipes, clés IA, modules les plus ouverts.
- Tests : `dualpulse_site/tests/test_metrics.py`, `t_legal_metrics.py`.

## 1.106 — Game Clips : mode Simultanée

- **Game Clips** propose trois modes : **Duel** (1 contre 1, comme avant), **Simultanée · 1 héros, 4 antagonistes** (le héros joue les Blancs sur les quatre plateaux et fait le tour de table) et **Simultanée · 4 héros, 1 antagoniste** (l'antagoniste joue les Blancs partout, chaque héros a son plateau et reçoit ses « cadeaux »). Choix des quatre personnages par mode, suivi du tournage plateau par plateau.
- Chaque plateau est une vraie scène mise en scène (`E.clips.run`) ; les coups sont ensuite entrelacés comme dans une simultanée réelle (coup du joueur central, réponse du plateau, plateau suivant). L'enregistrement suit le format de la Simultanée : Chess Edit en fait directement son montage « plateau à plateau » (`E.clips.runSimul`, `js/clips.js`).
- Chess Edit : le résumé de la Simultanée nomme le joueur central (et non plus toujours ETO).
- Test : `t_clips_simul.py` (deux modes, coups légaux, tour de table, montage Chess Edit, écran) ; `t_clips.py` inchangé et vert.

## 1.107 — Tous les bots en Simultanée et dans Game Clips, 1v2 à 1v6, ETO et E.N.O.S. au niveau maximal

- **Sélecteur de bots commun** (`js/bot_pick.js`) : les 138 bots de la plateforme (ETO, E.N.O.S., Stockfish 19, personnages, moteurs et IA, toute l'échelle des Défis), par catégories, avec avatar, Elo et recherche.
- **Game Clips** : héros, antagoniste et chaque plateau se choisissent dans cette liste. Simultanée de **1v2 à 1v6** (ou 2v1 à 6v1).
- **Simultanée** (mode de jeu) : adversaire et joueurs choisis dans la même liste (avec « Toi », « Joueur 2 »… pour les humains), de **1v2 à 1v6**.
- **ETO** (anciennement « ETO Brillant ») et **E.N.O.S.** jouent au niveau du bot le plus fort de la plateforme, Stockfish 19 : 3650 Elo affichés (4550 en blitz, 5450 en bullet, comme Stockfish), même temps de réflexion. **Les deux chassent les coups brillants par défaut** (Défis, duels, Simultanée, Titans, Boss).
- Version PC synchronisée (`build_learn_data.py --sync`, `bot_pick.js` ajouté).
- Tests : `t_simul.py`, `t_clips_simul.py`, `t_clips.py`, `t_defis.py`, `t_defis_tc.py`, `t_royale_bots.py`, `t_pc_hub.py`.

## 1.119 — Villes et drapeaux visibles, golf corrigé, loup-garou au rythme lisible
- **Cases noires de Néo-Cité / drapeaux absents dans Flick** : dans l'application, la page est en `file://` ; une image chargée depuis un fichier « salit » le canvas et WebGL refuse la texture (vérifié : `SecurityError` en file://, rien en http://, d'où des tests verts). Les images utilisées dans des textures 3D sont désormais embarquées en `data:` (`tools/pack_game_images.py` → `js/games/img_pack_neocite.js`, `img_pack_flags.js`, chargés à l'ouverture du jeu ; `G3.pack`, `G3.src`).
- **Golf** :
  - le looping ne se prend que dans l'axe de sa piste ; un couloir fermé avec entonnoirs d'entrée et de sortie empêche de le contourner ou de traverser son support ;
  - le passage du looping est détecté avec l'abscisse exacte de la balle (avant, il pouvait être manqué) ;
  - les zones de choc des bumpers, du moulin et des boulets correspondent à leur taille visible ;
  - test Node : 240 tirs au hasard, aucune balle ne dépasse le looping sans en faire le tour.
- **Loup-garou** :
  - minuteurs : débat (50 s + 9 s par joueur en vie, 130 s au plus ; 150 s en local), vote 30 s (abstention si rien), actions de nuit 30–40 s ;
  - les bots parlent un par un : « X est en train d'écrire… » (selon la longueur du message), puis le message, puis le temps de le lire ;
  - tu peux parler pendant que les bots débattent ; « Passer au vote » coupe le débat ; bouton « Vite » pour accélérer.

## 1.118 — Correctif : la mise à jour web ne remet plus d'anciens fichiers
- Problème vu sur téléphone en 1.117 : villes de Néo-Cité et drapeaux de Flick illisibles, mini-golf / bowling absents, anciens décors. Cause : la mise à jour web automatique (`WebUpdater`) lisait la branche `main` (restée en 1.96) et superposait ses fichiers, plus anciens, à ceux de l'APK.
- La CI écrit `assets/build_info.txt` (branche + commit de construction). La branche suivie par défaut devient celle de l'APK.
- Menu Jeux : tuiles Loup-garou (Plateau), Mini-golf et Bowling (Sport) ajoutées (elles manquaient dans `hub.js`, les jeux n'étaient pas accessibles).
- Garde-fou : un commit distant n'est superposé que s'il est **en avance** sur le commit de l'APK (API GitHub `compare`, statut `ahead`). Sinon rien n'est téléchargé, et une superposition plus ancienne déjà présente est retirée (retour aux fichiers de l'APK, page rechargée).

## 1.117 — Mini-golf 3D, bowling 3D, loup-garou ; décors Stade, Rue, Volcan, Tempête
- **Décors partagés** (`js/games/decor_more.js`, branchés sur `flick_decor.js`) :
  - **Stade** : tribunes pleines, supporters qui sautent et font la ola aux grosses frappes, flashs d'appareils photo, pylônes d'éclairage, panneaux LED défilants ;
  - **Rue** : terrain grillagé au coucher du soleil, mur à graffitis, immeubles éclairés, lampadaires, voiture qui passe ;
  - **Volcan** : plateforme de basalte au fond d'un cratère, lac de lave animé (shader), coulées sur la paroi, braises, bombes de lave ;
  - **Tempête** : plateforme offshore sur une mer d'orage (houle de Gerstner, écume, reflets), pluie, éclairs qui illuminent la scène.
  - Les shaders (lave, mer d'orage, pluie, éclairs) sont dans `E.decorFx`, réutilisés par le golf.
- **Flick** : 8 décors (Stade par défaut, Sakura, Océan, Automne, Rue, Volcan, Tempête, Arène ETO).
- **Néo-Cité** : les mêmes décors, plus la ville de nuit d'origine (option « Décor » du salon). `D.mount` monte le décor autour de la table.
- **Mini-golf 3D** (`golf_rules.js` + `g_golf.js`), 1 à 4 joueurs :
  - parcours de 9 trous (ou Express, 3 trous), par 24 ;
  - obstacles : pentes, bosse, looping (il faut assez de vitesse), moulin à bras tournants, boulets qui se balancent, bumpers champignons, passerelles au-dessus de l'eau (+1 coup) ;
  - commandes : caméra derrière la balle ; glisser à gauche ou à droite pour viser, tirer vers le bas pour doser (jauge à droite), relâcher pour taper ; bouton « Vue » pour voir tout le trou ;
  - rendu cartoon : ombrage toon par paliers, contours noirs, couleurs franches, eau stylisée, drapeau qui flotte ;
  - décors : Lagon, Forêt, Rue, Volcan (lave), Tempête (mer d'orage) ;
  - les bots visent par simulation, au même pas fixe que le jeu.
- **Bowling 3D** (`g_bowling.js`, physique de `bowling_rules.js`) :
  - piste aux vraies dimensions (bois verni, flèches, gouttières, fosse, machine), quilles tournées ;
  - lancer au doigt : glisser à gauche ou à droite pour se placer, puis vers le haut ; la vitesse du geste règle la force, sa courbe l'effet ;
  - feuille de score officielle sur 10 frames, bannières STRIKE / SPARE, bots ;
  - décors : Bowling ETO (néons) ou les décors partagés.
- **Loup-garou** (`loup_rules.js` + `g_loup.js`), 5 à 10 joueurs :
  - rôles : loups, voyante, sorcière (2 potions), chasseur, villageois ;
  - village en cercle autour d'un feu animé, nuit puis jour, cartes de rôle qui se retournent ;
  - débat : les bots accusent, se défendent, la voyante se dévoile et les loups bluffent ;
  - tu peux accuser, te dire villageois ou te dire voyante (même en mentant), puis voter ;
  - en local : un seul téléphone, écran « Passe le téléphone à… » avant chaque action secrète ;
  - simulation de 1 500 parties entre bots : village et loups gagnent chacun environ la moitié des parties.
- Tests :
  - Playwright : `t_golf.py`, `t_bowling.py`, `t_loup.py` ; `t_flick.py` mis à jour pour 8 décors ;
  - Node : `golf_rules.test.js`, `loup_rules.test.js`.

## 1.116 — ChatGPT Prime triche aussi quand il perd (mais bêtement)
- Partie perdue : il triche toujours (40 % de ses coups à partir du 6ᵉ, 20 % après le 40ᵉ), mais **contre lui-même** (`P.makeDumbCheat`) :
  - **faux mat** : sa dame traverse le plateau et se pose collée à ton roi, non défendue ; il annonce « échec et mat » (tampon ÉCHEC ET MAT à l'écran) alors que tu la prends. Sans dame, il en fait apparaître une au même endroit ;
  - **pièce lourde en prise** : une dame ou une tour apparaît sur une case prise par n'importe quelle pièce adverse ;
  - **conversion** (comme dans les parties qu'il gagne), 2 au plus et seulement pions / pièces mineures, pour qu'on puisse encore le mater.
  Aucune triche bête ne donne un vrai mat, et ses coups légaux ne matent pas par accident. À partir de son 25ᵉ coup, il joue souvent un coup qui laisse un mat en 1 (`P.suicideMove`).
- Partie gagnée : inchangée (triche efficace, roi capturé, roi téléporté, plot twist).
- Correctif : quitter une partie pendant que Prime joue pouvait terminer la partie suivante (fin de tour sans vérification du jeton).
- Simulation (`tests/node/prime_winrate.test.js`) : 57–65 % de victoires, ~99 % des parties perdues avec triche, défaites surtout par vrai mat ; la dame du faux mat est toujours prenable.

## 1.115 — ChatGPT Prime : contre nos bots, 60 % de victoires, roi téléporté
- **Bot contre Prime** : au lieu de Stockfish seul, on choisit l'adversaire de Prime parmi nos bots (ETO, E.N.O.S., Naskolit, Pénoire, Le Jester, GhorGhor, Nasko, Lelex, Naskurieux) ou Stockfish 19. Même force qu'en Défis (Elo → puissance, ETO à pleine puissance avec son goût tactique, le Jester tire son Elo à la roue). Les anciens réglages « Stockfish contre Prime » sont repris.
- **60 % de victoires** (`P.WINRATE`) : le sort de la partie est tiré au début (`P.rollBeatable`). Partie gagnante : il triche comme avant et finit par gagner. Partie perdante : il triche à peine, joue des **coups bêtes** de plus en plus souvent (`P.stupidMove` laisse en prise la plus grosse pièce possible), finit **maté pour de bon** ; s'il traîne au-delà de 90 coups, il « plante » (erreur serveur) et perd.
- **Roi téléporté** (`P.kingEscape`, coup `kingdash`) : quand il est maté, son roi réapparaît sur une case sûre loin des pièces adverses et la partie continue. Partie gagnante : 78 % téléportation, sinon le plot twist « tu t'es fait checkmate ». Partie perdante : une seule téléportation possible (60 %), le mat suivant est réel.
- Nulle dans une partie perdante = vraie nulle ; résultat « Tu gagnes » quand c'est toi qui le mates. Le Chess Edit reçoit `v.beaten` pour toutes les défaites.
- Tests : `tests/node/prime_winrate.test.js` (simulation : 58–63 % de victoires sur 300–400 parties, vraies défaites, téléportations) ; `t_prime.py` étendu (twist, roi téléporté puis vraie défaite, Lelex contre Prime).

## 1.114 — Néo-Cité : monuments des 24 villes, icônes et cartes illustrées

- **Pack d'illustrations** (ChatGPT) intégré : 24 monuments (Paris · Tour Eiffel, New York · Statue de la Liberté, Rome · Colisée…), 15 icônes (logo, dés, pièces, marteau, échange, avion…), 20 cartes événement. Nettoyées (fragments parasites retirés), recadrées, converties en WebP légers (`img/games/capital/lots|icons|cards`, 3,4 Mo). Manifeste : `js/games/neocite_art.js`.
- **Plateau** : chaque case de ville montre son monument entre le bandeau de région et le nom. Quand une ville est achetée, son **monument se dresse en 3D** sur la case (apparition animée).
- **Fenêtres** : monument sur halo de la couleur de la région (fiche, enchères, échange), icônes dorées (dés sur le bouton, marteau, échange, pièces), illustration de chaque carte Signal. Les Aéroports utilisent l'icône avion.

## 1.113 — Néo-Cité : villes du monde, interface premium

- **24 vraies villes** en 8 régions (Maghreb, Afrique, Amérique latine, Europe du Sud, Asie, Europe du Nord, Orient, Capitales mondiales), chacune avec son monument (Paris · Tour Eiffel, New York · Statue de la Liberté…). Les Relais deviennent des **Aéroports**. Liste pour ChatGPT (ville, monument, fichier) : `docs/NEOCITE_GPT.md`.
- **Interface d'après la maquette** :
  - barre du haut : logo, « NÉO-CITÉ », tour en cours ;
  - joueurs : avatar cerclé à leur couleur, solde en or, étiquette « À TOI » sous le joueur au trait ;
  - panneau du bas : Réserve, ton solde, gros bouton « Lancer les dés » avec icône, « Gérer » ;
  - fiche de ville illustrée (illustration, région, monument, loyers).
- **Enchères montantes** dans une fenêtre : valeur du lot, ton solde, mise actuelle, offre réglable (− / +), historique des offres, « Passer » / « Placer l'offre ». Les bots surenchérissent jusqu'à leur limite, le dernier en lice paie sa mise.
- **Échange** dans une fenêtre : choix de l'adversaire par avatar, cartes illustrées « Tu demandes » / « Tu offres », carte d'argent (−100, −10, +10, +100), « Proposer » / « Annuler ». Les offres des bots s'affichent dans la même fenêtre (Accepter / Refuser).
- **Carte Signal** : fenêtre animée avec l'événement.
- Illustrations : celles de ChatGPT s'affichent dès qu'elles sont ajoutées ; en attendant, chaque ville a une skyline de nuit générée aux couleurs de sa région.

## 1.112 — Néo-Cité : règles complètes, plateau lisible, ville de nuit, échanges

- **Règles** (`js/games/neocite_rules.js`) :
  - on peut **refuser d'acheter** un lot : il reste libre, sans enchère automatique ;
  - **valeur du quartier** : chaque lot possédé fait monter le loyer de tout le quartier (×1, ×1,75, ×2,5 avec les 3), puis antennes et tour ;
  - **case Enchères** au coin en bas à droite : un lot libre tiré au hasard est mis aux enchères sous pli fermé, tous les joueurs enchérissent ;
  - **Signal** : un événement tiré au hasard parmi 20 (gains, amendes, déplacements, Pare-feu, laissez-passer…) ; **Audit** déplacé sur le côté droit ;
  - **découvert** autorisé jusqu'à −1 500 € ; au-delà : vente des bâtiments puis hypothèques, sinon faillite ;
  - **échanges** entre joueurs (lots sans bâtiments + argent) ; les bots en proposent pour compléter leurs quartiers et jugent les offres reçues ; le « Rachat » forcé est retiré ;
  - monnaie en euros.
- **Plateau lisible** : cases plus grandes, noms en gros caractères, prix et nom du quartier visibles, icônes dessinées pour Départ, Pare-feu, Réserve, Enchères, Audit, Signal, Relais ; surbrillance de la case d'arrivée et puce en haut (case, quartier, propriétaire ou prix).
- **Caméra** : suivi du joueur (le côté où il se trouve passe face à l'écran, zoom sur les cases), bouton « Vue plateau » / « Suivre », pincer pour zoomer, glisser pour se déplacer ; les dés roulent près du joueur.
- **Décor** : ville de nuit autour de la table (gratte-ciel éclairés, sol miroir quadrillé de néon, projecteurs qui balaient le ciel, drones lumineux, ciel étoilé), grande table d'obsidienne cerclée d'or.
- **Illustrations** : liste de prompts pour ChatGPT dans `docs/NEOCITE_GPT.md` (14 icônes, illustration de chacun des 24 lots, de chacune des 20 cartes événement, skyline). Le jeu les affiche automatiquement dès qu'elles sont ajoutées (`js/games/neocite_art.js` liste les images présentes).
- Tests : `neocite_rules.test.js` (valeur du quartier, refus, case Enchères, découvert, échanges, offres des bots), `t_neocite.py` (refus, enchère, échange accepté par ETO, découvert affiché).

## 1.111 — Jeux : sons réels, Flick en décors 3D, effets de vitesse et de but, bots des jeux

- **Sons des jeux** (`js/games/sfx.js`, banque `js/games/sfx_bank.js`, sons `js/games/sfx_data.js`, fichiers `audio/games/`) : 109 sons réels (packs CC0 de Kenney via OpenGameArt, bois/métal/impacts CC0, roulement de boule CC0, foule de stade CC-BY 4.0 de Gregor Quendel), coupés, normalisés et convertis en OGG. Un gestionnaire unique : bus sfx / interface / musique / ambiance, compresseur doux, variante différente à chaque lecture, hauteur légèrement aléatoire, volume selon la force du choc, panoramique selon la position, polyphonie limitée, ambiances en boucle. Branché dans Dames (bois), CHROMA (cartes + sons des cartes spéciales), Poker (cartes, jetons, toc sur la table, tapis), Flick (tir, palet/palet, balle, bande, poteau, but + foule), Néo-Cité (dés, pions, pièces, construction, Pare-feu, Réserve). Jingles de victoire et de défaite. Bouton son dans la barre du jeu. Crédits : `audio/games/CREDITS.md`.
- **Bots des jeux** : seuls nos bots sont proposés hors échecs (ETO, E.N.O.S., Naskolit, Pénoire, Ghorghor, Nasko, Le Jester, Lelex, Naskurieux), chacun avec une classe fixe (Expert, Difficile, Normal, Facile). ETO et E.N.O.S. en Expert. Pas d'Elo hors échecs ; le sélecteur de niveau global disparaît.
- **Flick : 4 décors** (`js/games/flick_decor.js`), seul l'environnement change, la physique est identique :
  - **Sakura** : le jardin japonais fourni en 3D (GLB optimisé : 490 000 → 147 000 triangles, compressé meshopt, 5,3 Mo, embarqué dans `js/games/glb_sakura.js` et chargé seulement pour ce décor), gazon du modèle aligné sur le terrain physique, coucher de soleil, pétales au vent, lanternes.
  - **Océan** : plateforme flottante chromée sur un lagon animé (vagues, reflets du soleil, caustiques près de la coque), îles, voilier, jardinières.
  - **Automne** : terrain en lévitation au-dessus d'une mer de nuages blancs, îles flottantes au gazon vert et aux érables, feuilles qui tombent et se posent.
  - **Arène ETO** : obsidienne, néons, braises.
- **Flick : mise en scène** : travelling d'ouverture, palets à dôme brillant cerclés d'or avec halo de l'équipe au trait, **traînées de vitesse** (balle et palets, plus larges et lumineuses quand ça va vite), étincelles aux chocs forts, rafale de vent au tir. **But ressenti** : ralenti jusqu'au fond du filet, filet qui se tend, double onde de choc, éclats et confettis aux couleurs de l'équipe, secousse de caméra, coup de zoom et halo lumineux proportionnels à la frappe, bannière « BUT ! » avec la vitesse en km/h et « Puissant » / « Frappe monstrueuse ».
- **Socle 3D** (`js/games/g3d.js`, `vendor/three_extras.js`) : bloom (halo des néons et des effets, demi-résolution), secousse de caméra, travelling d'ouverture générique, particules au vent, traînées, chargement GLB (textures par `<img>` : la politique de sécurité de l'app bloque fetch). Activés aussi dans Dames, CHROMA, Poker et Néo-Cité.
- **Interface des jeux** : ouverture « VS » avant chaque partie (joueurs qui entrent de chaque côté), salon animé (visuel en mouvement, titre qui brille, bouton Jouer lumineux), indicateur de tour qui rebondit, fin de partie avec rayons tournants, confettis à la victoire, secousse à la défaite.
- Tests : `t_gsfx.py` (109 fichiers décodés, aucun silencieux, chaque événement se joue, bouton son), `t_gbots.py` (nos bots seulement, classes, pas d'Elo), `t_flick.py` (décors, ouverture VS, Sakura chargé, bannière de but avec vitesse).

## 1.110 — Néo-Cité : le jeu de plateau immobilier d'ETO

- **Néo-Cité** (`js/games/neocite_rules.js` + `g_neocite.js`), jeu original de 2 à 6 joueurs (nom, plateau et règles propres, aucune reprise d'un jeu existant) : 32 cases, 8 quartiers de 3 lots, 2 Relais, 2 cases Signal, coins Départ / Pare-feu / Réserve / Audit.
- Règles : achat ou **enchère sous pli fermé** si le lot est refusé ; quartier complet = loyer doublé puis **antennes** (1 à 3) et **tour** ; **Rachat** du 3e lot d'un quartier à 2 fois son prix ; **Relais** = téléportation à l'autre Relais pour 50 ; amendes et taxes versées à la **Réserve**, remportée par celui qui s'y arrête ; Pare-feu (payer 50, faire un double ou laissez-passer) ; 14 cartes Signal ; hypothèques et ventes automatiques en cas de dette, faillite.
- 3D : plateau d'obsidienne cerclé d'or et de néon, cases en relief (bandeau de quartier, prix, illustrations des cases spéciales), ville miniature lumineuse au centre avec la Spire et l'Œil, pions en verre teinté qui avancent case par case, dés 3D lancés, antennes et tours posées sur les lots, liseré à la couleur du propriétaire.
- Interface : capital des joueurs et Réserve en haut, fiche du lot à l'achat, enchères, **Gérer** (construire, vendre, hypothéquer, lever, racheter), fiche d'un lot au toucher, carte Signal à l'écran.
- Bots : achat selon la valeur (quartier à compléter ou à bloquer), offres d'enchère, construction et rachats selon le niveau. Options : durée (20 tours, 40 tours, jusqu'à la faillite), capital de départ.
- Tests : `tests/node/neocite_rules.test.js` (plateau, loyers, construction, rachat, enchères, relais, Pare-feu, cartes, faillite, parties complètes entre bots), `t_neocite.py`.

## 1.109 — Jeux ETO : CHROMA, Flick Foot / Hockey, Poker

- **CHROMA** (`js/games/chroma_rules.js` + `g_chroma.js`) : jeu de cartes original de 2 à 6 joueurs (110 cartes, 4 couleurs, Gel, Retour, +2, Prisme, +4 Œil, Échange ; annonce CHROMA obligatoire sinon +2). Table ronde 3D en feutre, pioche et défausse en 3D, éventails des adversaires, anneau à la couleur demandée, main en éventail en bas, choix de couleur et d'échange, rideau « passe le téléphone » en local.
- **Flick Foot / Flick Hockey** (`js/games/flick_rules.js` + `g_flick.js`) : 5 palets par équipe, tir à la fronde (glisser, relâcher), physique en temps réel (frottement, rebonds, poteaux), terrain gazon ou glace, cages chromées avec filets, palets aux drapeaux des équipes choisies, buts animés. IA par simulation de tirs.
- **Poker** (`js/games/poker_rules.js` + `g_poker.js`) : Texas Hold'em No Limit de 2 à 6 joueurs. Blindes (doublées toutes les 10 mains), relance minimale, tapis et pots annexes, évaluation de la meilleure main sur 7 cartes, abattage. Table ovale 3D (feutre, boudin obsidienne, liseré or), cartes et jetons en 3D, bouton de donneur, pot au centre, cartes retournées à l'abattage. Barre d'actions : se coucher, parole/suivre, relancer (mini, ½ pot, pot, ×3, curseur), tapis. Bots : équité par simulation + cotes du pot, bluff selon le niveau. Options : jetons de départ, durée.
- Corrections communes : l'écran de jeu est monté dans `#app`, donc les feuilles (choix de couleur, confirmation « Quitter ») et les toasts passent au-dessus du jeu (avant, elles restaient dessous et ne se touchaient pas toujours) ; un bot ne joue plus si le tour a changé pendant sa réflexion.
- Tests : `tests/node/chroma_rules.test.js`, `flick_rules.test.js`, `poker_rules.test.js` ; `t_chroma.py`, `t_flick.py`, `t_poker.py`.

## 1.108 — Jeux ETO : catégorie Jeux, salon commun, Dames 3D

- **Catégorie Jeux** dans le hub (mise en avant, ETO en tenue de sport) : Plateau (Dames), Arcade (2048, Serpent, Démineur). Les autres jeux arrivent par vagues.
- **Salon commun** (`js/games/core.js`, `E.jeux`) : visuel, trois modes — **Local** (sur ce téléphone, à tour de rôle, noms des joueurs), **Contre les bots** (niveau Facile / Normal / Difficile / ETO, adversaires choisis dans la liste de tous les bots), **En ligne** (affiché « bientôt » : salons privés et invitations par code quand les accès seront ouverts) —, options propres au jeu, règles, statistiques (parties, victoires), écran de jeu plein écran, fin de partie avec ETO (victoire / défaite).
- **Socle 3D** (`js/games/g3d.js`, three.js r159 embarqué `vendor/three.min.js`, chargé seulement à l'ouverture d'un jeu) : rendu ACES filmique, environnement de studio (reflets blancs + cramoisis), ombres douces, dôme sombre à brume rouge, matériaux obsidienne / or / ivoire / néon, cadrage automatique selon l'écran.
- **Dames 3D** (`js/games/dames_rules.js` + `g_dames.js`) : règles internationales en 10×10 ou 8×8 (prise obligatoire avant et arrière, prise majoritaire, dames volantes, promotion en fin de coup, nulles 25+25 coups et répétition), plateau d'obsidienne et marbre cerclé d'or, pions ivoire contre obsidienne à anneau néon, sélection au toucher avec cases éclairées, pièces obligées de prendre signalées, rafles en sauts animés, couronne à la promotion, caméra qui passe du côté du joueur en local. IA alpha-bêta à approfondissement itératif dans un **Worker** (le rendu reste fluide).
- **Assets** : pack de 247 images intégré en WebP (`img/games/<jeu>/`, 7,8 Mo) — base vectorielle + première vague AAA (8 quartiers ETO Capital, quilles, raquettes) ; chaque fichier se remplace sans toucher au code.
- Tests : `tests/node/dames_rules.test.js` (règles et IA), `t_dames.py` (salon, scène 3D, coup au toucher, réponse du bot, fin, statistiques).
