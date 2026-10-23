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
`py construire_apk.py` (JDK 11+ et SDK Android déjà installés) → `NASKO.apk` signé (clé `android/signing/enos-release.jks`, ignorée par Git, à sauvegarder hors du dépôt) + `NASKO.apk.json`.
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
- **Échecs hors ligne** (`js/chess_local.js`) : règles = chess.js 0.13.4, moteur = Stockfish.js 10 (**asm.js**, pas WASM : un `.wasm` ne se charge pas depuis `file://`) lancé dans un Worker blob (le source est dans `vendor/stockfish_src.js`, GPLv3 → voir `vendor/LICENSES.txt`). `play.js` n'appelle plus le PC pour jouer ; seule l'analyse de partie (`/review`) l'exige encore. E.N.O.S./ETO commente chaque échange en une phrase (Groq, `E.ai.chat(..., {oneShot:true})`, hors historique de chat) ; toucher la phrase la lit à voix haute. Réglage `chess.comment`.
- **CinePulse mobile** (`js/m_cinepulse.js`, Modules › Productivité) : moniteur, soundboard (pré-écoute, poignée ⠿ pour glisser sur une piste, ＋ pour poser au curseur), timeline 2 pistes vidéo + 3 audio, magnétisme (curseur, début, bords de clips, repères), zoom pincement / curseur jusqu'à 40 px/ms, rognage, coupe, repères, lecture WebAudio. Les médias vivent en mémoire de la page : le projet n'est pas conservé à la fermeture (à faire : IndexedDB / export).
- **Export CEO** (`exporter_donnees_ceo.py`, PC) : clés Groq + ElevenLabs, liens .ics, tâches de l'agenda, préférences → `js/ceo_bundle.js` chiffré (AES-256-GCM, PBKDF2 300 000, phrase secrète). L'application demande la phrase une fois (`Importer.checkBundled`), range les clés dans le coffre Keystore, applique tâches et préférences (liste blanche). Java : `Importer.apply` renvoie en plus `prefs` et `tasks` filtrés.
- Tests : `bash android/tests/run_mobile_e2e.sh t_chess_cinepulse.py` (navigateur). Le Java compile contre `android.jar` (API 34) et `Importer.decrypt` a été vérifié avec un paquet réel ; **rien n'a encore tourné sur un téléphone**.
