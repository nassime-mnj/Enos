# Guide E.N.O.S. (architecture hybride)

## Lancer
- `ENOS.exe` (ou `py nasko_server.py`) : démarre le serveur FastAPI et ouvre la fenêtre de bureau « E.N.O.S. AI » (1200x800, redimensionnable, PyWebView/WebView2). **Fermer la fenêtre arrête le serveur.** Le bouton QUITTER fait de même. Logs : `data\nasko.log`.
- E.N.O.S. est un **logiciel de bureau** : fenêtre native WebView2 exclusivement, jamais de navigateur. Si WebView2 est introuvable, une boîte de dialogue d'erreur native s'affiche et le programme s'arrête (aucun repli). Option de développement : `--server-only` (serveur sans fenêtre).
- Le port est `server_port` (8765) ; s'il est occupé, le suivant est utilisé.
- Raccourci Bureau : `py creer_raccourci.py` crée « E.N.O.S. » (cible `ENOS.exe`, icône `logo.ico`).
- Dictée / mode Live : le bouton micro de la fenêtre pilote directement le micro de votre PC (voir « Dictée vocale »).

## Application sur le téléphone (Samsung Galaxy S23+)
L'« appli » mobile est l'interface de E.N.O.S. servie par votre PC en HTTPS : le **PC doit être allumé, E.N.O.S. ouvert, et le téléphone sur le même Wi-Fi**. Elle s'installe sur l'écran d'accueil comme une application.

**1. Activer (sur le PC)** — panneau **[ ACCÈS TÉLÉPHONE ]** → **ACTIVER L'ACCÈS TÉLÉPHONE**. Un QR code, l'adresse (ex. `https://192.168.1.28:8443/`) et un **code** apparaissent. Au premier usage, Windows demande d'autoriser le pare-feu : cochez **réseaux privés**. (Le choix est mémorisé ; `DÉSACTIVER` coupe tout et déconnecte les téléphones.)

**2. Installer le certificat — une seule fois** (supprime définitivement l'alerte « Votre connexion n'est pas privée » et permet l'installation en appli) :
1. Sur le S23+, ouvrez **Chrome** et scannez le QR (ou tapez l'adresse). Le tout premier affichage montre l'alerte : **Avancé → Continuer vers le site**.
2. Dans la barre d'adresse, ajoutez `nasko-ca.crt` à l'adresse (ex. `https://192.168.1.28:8443/nasko-ca.crt`) : le fichier se télécharge.
3. **Paramètres → Sécurité et confidentialité → Autres paramètres de sécurité → Installer depuis la mémoire de l'appareil → Certificat d'autorité de certification** → « Installer quand même » → choisissez `nasko-ca.crt` (dossier Téléchargements). Un verrouillage d'écran est exigé par Android ; les intitulés varient légèrement selon la version One UI.
4. Fermez puis rouvrez Chrome : plus d'alerte.

**3. Se connecter — une seule fois** : entrez le code affiché sur le PC. Le téléphone devient un **appareil de confiance permanent** : un jeton cryptographique est rangé dans l'appli (cookie + `localStorage`) et n'expire jamais. Ensuite, l'icône de l'écran d'accueil ouvre **directement le chat**, sans écran de code (même après un redémarrage du PC ou de E.N.O.S.). Chrome limite un cookie à 400 jours ; le jeton du `localStorage` le rétablit automatiquement et en silence.

**4. Mettre l'icône sur l'écran d'accueil** — menu **⋮ de Chrome → Installer l'application** (ou **Ajouter à l'écran d'accueil**). L'icône de l'œil vert s'ouvre en plein écran, sans barre de navigateur.

**5. Micro** — autorisez-le quand Chrome le demande. Sur le téléphone, la dictée utilise la reconnaissance vocale du navigateur (envoyée à Google) ; le mode Live (casque) fonctionne.

À savoir :
- Depuis le téléphone vous pouvez **discuter** (texte, voix, phrases réflexes) et déclencher les actions décidées par le LLM (`OPEN_ENV`, `OPEN_PIXELLAB`) ; les boutons Environnement / Projets / Fichiers / micro du PC restent réservés au PC.
- Pas d'accès hors du Wi-Fi local. Si la box change l'adresse IP du PC, rescannez le QR (le certificat se régénère tout seul ; l'autorité déjà installée reste valable). Réserver une IP fixe dans la box évite ce cas.
- Sécurité : accès protégé par le code (5 essais ratés = blocage 1 min). L'autorité « N.A.S.K.O Local CA » est **limitée aux réseaux privés** (10.x, 172.16-31.x, 192.168.x) et à `localhost` : même si sa clé fuitait, elle ne pourrait certifier aucun site Internet. Le HTTP clair n'est jamais exposé au réseau. N'activez pas l'accès sur un Wi-Fi public. Ces réglages et la procédure Android n'ont pas été testés sur un téléphone réel.

## Scènes Godot : lanceur intégré (équivalent F6)
Le panneau **[ SCÈNES GODOT ]** (fenêtre du PC, sous [ PROJETS ]) liste toutes les scènes `.tscn` du **projet actif** et en lance une **sans ouvrir l'éditeur**.
- **Liste dynamique** : lue au démarrage et à chaque changement de projet ; le bouton ⟳ relance l'analyse (utile après avoir créé une scène). Les dossiers techniques sont ignorés : `.godot`, `.git`, `.claude`, `addons`, `build` (réglable : `godot_scene_excludes` dans `nasko_config.json`).
- **Affichage** : un bouton par scène avec **uniquement le nom du fichier** (le chemin `res://…` est dans l'info-bulle). Les scènes sont regroupées par dossier (la racine est dépliée, les autres se déplient d'un clic) ; deux scènes de même nom dans deux dossiers se distinguent par le nom du dossier. Le champ « Filtrer » cherche dans tous les dossiers (ex. `test`, `diag`) et déplie les résultats. La section se replie en cliquant sur son titre (état mémorisé).
- **Lancement** : un clic exécute `Godot --path <projet> res://<scène>.tscn` (syntaxe CLI de Godot 4, sans `--editor`) : la scène s'ouvre directement dans sa fenêtre de jeu. La scène démarre à l'instant où E.N.O.S. annonce « Lancement de la scène de test » (voix locale, **0 caractère ElevenLabs**). Un clic à la fois (pas de doublon). Scène supprimée ou Godot introuvable : « Impossible de lancer la scène » / « Godot est introuvable » + message.
- **Voir le journal et les erreurs** : mettez `"godot_console": true` dans `nasko_config.json` : les scènes se lancent alors avec la console Godot (`…_console.exe`, à côté de `godot_path`) dans une fenêtre qui affiche les `print()` et les erreurs.
- **Sécurité** : le chemin de la scène est validé (doit être un `.tscn` existant dans le projet ; `..`, chemins absolus et lecteurs sont refusés). Réservé au PC : un téléphone n'a pas ce panneau et l'API refuse (403).
- API : `GET /api/godot/scenes`, `POST /api/godot/run` (corps `{"rel": "salles/Salle1.tscn"}`).
- `nasko_config.json` est désormais lu même s'il a été enregistré avec un BOM (cas du Bloc-notes de Windows).


## Commandes rapides commentées à la voix
Les boutons **1. ENVIRONNEMENT** et **2. PIXELLAB** s'annoncent à voix haute, étape par étape, **chaque action démarrant à l'instant où E.N.O.S. annonce l'étape** :
- Environnement : « Initialisation de l'environnement de travail » → « Ouverture du shell Claude » (le shell s'ouvre) → « Lancement de Godot » → « Lancement d'Aseprite » → « Environnement prêt, Nassime ». Un outil introuvable est annoncé (« Godot est introuvable ») puis sauté, et la phrase finale n'est pas prononcée. Dossier de projet absent : « Dossier de projet introuvable… » + boutons Sélectionner / Créer.
- PixelLab : « Ouverture de la navigation privée » (Chrome s'ouvre) puis une phrase d'explication (boîte mail temporaire d'un côté, inscription PixelLab de l'autre, la suite est manuelle).
- Ces phrases sont toujours identiques : elles sont jouées depuis des **fichiers locaux** (`voix\nar_*.mp3`, embarqués dans l'exe). **0 caractère ElevenLabs** à l'usage.
- Nouvelle phrase ou nouvel outil : l'ajouter dans la table `STATIC` de `nasko_voice.py`, puis `py generer_voix.py --dry-run` (affiche le coût), `py generer_voix.py` (génère une seule fois les fichiers manquants), puis `build.bat`.

## Phrases réflexes (voix locale, 0 caractère ElevenLabs)
Pour les échanges courants, la voix vient de **fichiers locaux** : l'API ElevenLabs n'est pas appelée.
- Types gérés (table `STATIC` dans `nasko_voice.py`) : salutation (4 variantes), état (« Systèmes nominaux… »), identité, présentation, remerciement, au revoir, accusé de réception.
- Fonctionnement : le prompt système demande au LLM de répondre **uniquement** par une balise courte (`[REFLEX: SALUTATION]`, `[REFLEX: ETAT]`…) quand le message est exactement de ce type. Le serveur choisit alors la phrase (au hasard parmi les variantes), l'affiche et joue son fichier. La balise n'est jamais affichée ni prononcée. Si le LLM écrit lui-même une phrase quasi identique à une phrase de la table, elle est aussi reconnue.
- Fichiers : `voix\` (livré dans l'exe) contient un mp3 par phrase : vos audios existants (accueil_1-4, statut, identite, speech) et ceux générés une seule fois par `generer_voix.py` (merci, aurevoir, recu, nar_*). Une phrase ajoutée à la table sans fichier est générée à sa première utilisation puis conservée dans `data\voix_cache`.
- Un message qui contient autre chose qu'un simple réflexe (« Salut, peux-tu m'expliquer… ») reçoit une vraie réponse, voix ElevenLabs.
- Compteurs : `data\voice_stats.json` (`saved_chars` économisés, `api_chars` dépensés, `static_hits`).
- Ajouter une phrase : une ligne dans `STATIC` (avec ou sans `file`), puis `build.bat`.

## Appareils de confiance et mode mobile
- **Jeton permanent** : après la saisie du code, le téléphone reçoit un jeton aléatoire de 256 bits. Le PC n'en garde que l'**empreinte SHA-256** (`data/trusted_devices.json`) : lire ce fichier ne permet pas d'usurper un téléphone.
- **Révoquer** : panneau **[ APPAREILS DE CONFIANCE ]** (sur le PC) → `RÉVOQUER` (un appareil) ou `TOUT RÉVOQUER`. Effet immédiat : le téléphone retombe sur l'écran du code. Depuis le téléphone : tiroir ☰ → `OUBLIER CET APPAREIL`. Désactiver l'accès téléphone ne révoque rien (les appareils restent de confiance à la réactivation).
- **`trusted_ips`** (dans `nasko_config.json`, liste) : les adresses locales listées entrent **sans code ni jeton**. Exemple : `"trusted_ips": ["192.168.1.45"]`, ou un réseau : `"192.168.1.0/24"`. Raccourci : bouton `FAIRE CONFIANCE À L'IP` dans le panneau des appareils. Seules les adresses locales (192.168.x, 10.x, 172.16-31.x) sont acceptées ; une IP publique est ignorée. **Risque** : toute machine du Wi-Fi qui prend cette adresse (DHCP qui la réattribue, usurpation) est admise. Réservez une IP fixe au téléphone dans la box et préférez le jeton, plus sûr.
- **Mode mobile** (écran ≤ 768 px) : le terminal, l'avatar, le champ de saisie et le micro occupent 100 % de l'écran ; le panneau latéral est caché et s'ouvre en tiroir par le bouton **☰** (se ferme avec ✕, en touchant le voile, ou avec le bouton retour d'Android). Le clavier ne masque pas la barre de saisie. Dans le tiroir : Environnement et PixelLab (demandés à E.N.O.S., qui les lance sur le PC), signal vocal, effacer, et « cet appareil ». Projets, fichiers et QUITTER restent sur le PC.


## Arrière-plan, barre d'état et briefing quotidien (Réglages → « ARRIÈRE-PLAN & NOTIFICATIONS »)
E.N.O.S. peut veiller **sans fenêtre** et vous prévenir discrètement.
- **Icône de la zone de notification** (à côté de l'horloge, Windows + `pystray`) : fermer la fenêtre **ne quitte plus** E.N.O.S. ; le serveur et l'IA proactive restent actifs, WebView2 est libéré (faible consommation). Menu de l'icône : *Ouvrir E.N.O.S.* (clic par défaut) · *Briefing du jour maintenant* · *Ne pas déranger 1 h / jusqu'à demain 7 h* · *Lancer avec Windows* · *Quitter E.N.O.S.* L'infobulle affiche la prochaine échéance. Décochez l'option dans les Réglages pour retrouver l'ancien comportement (fermer la fenêtre = quitter).
- **Lancer avec Windows** : inscrit `ENOS.exe --background` dans `HKCU\…\Run` (aucun droit administrateur). Au démarrage de session, E.N.O.S. apparaît directement dans la zone de notification, sans fenêtre.
- **Briefing quotidien silencieux** : à l'heure choisie (`briefing_time`, 08:00 par défaut), une carte native **sans son** : « Bonjour Nassime. Aujourd'hui : 3 cours dès 8h30, 1 rendu (TP Physique), 2 notes en attente. Demain : rendu Projet C. Bonne journée ! ». Texte **déterministe** (pas de LLM : rapide, gratuit, jamais inventé). Si le PC était éteint à l'heure dite, il part au démarrage (jusqu'à 13 h). Un seul par jour. Bouton « Briefing maintenant » dans les Réglages et dans le menu de l'icône.
- **Cartes contextuelles à boutons** : une tâche datée (« Appeler le médecin à 14h ») déclenche à l'heure dite une carte **« C'est l'heure »** avec **Fait** et **Reporter à demain**, sans ouvrir l'application (le clic lance un petit processus qui modifie `data/agenda.json` ; « demain » = même heure, lendemain d'aujourd'hui, même pour une tâche en retard depuis plusieurs jours). Les cours et rendus (Zeus / Moodle) proposent **Ouvrir l'agenda**. Quand la fenêtre est ouverte, les mêmes boutons apparaissent dans le toast de l'interface. Les paliers 48 h / 24 h / 3 h existants sont conservés.
- **Ne pas déranger** : aucune alerte ni briefing avant l'heure de fin (les alertes encore valables partent ensuite). Heures calmes 23 h → 7 h inchangées pour les alertes.
- **Sécurité** : le protocole `enos-action://` des boutons n'accepte que `done` / `snooze` / `open` avec un identifiant hexadécimal : il ne peut qu'agir sur une tâche de l'agenda. Les enregistrements (démarrage, protocole, nom « E.N.O.S. » des cartes) sont dans `HKCU` uniquement.
- **Correctif** : le mode `--background` / `--server-only` s'arrêtait au bout de 10 s ; le processus reste maintenant en vie jusqu'à « Quitter ».
- Clés `nasko_config.json` : `tray_enabled`, `briefing_enabled`, `briefing_time`, `notify_paused_until`. API : `/api/background/settings|test`, `/api/agenda/action`. Tests : `python tests/test_tray_briefing.py`.

## Outils rapides (bouton « 24. OUTILS RAPIDES »)
Trois utilitaires dans une même fenêtre, **réservés au PC**.
- **Formateur / validateur JSON et XML** : collez un bloc illisible, « FORMATER » (2 / 4 espaces ou tabulation), « MINIFIER », « TRIER LES CLÉS » (JSON), coloration syntaxique. Une erreur est localisée (**ligne et colonne**, la ligne fautive est sélectionnée). Un JSON « presque valide » (commentaires, virgules finales, guillemets simples, clés sans guillemets, `True` / `False` / `None`) est reconnu : « RÉPARER AUTOMATIQUEMENT » le convertit en JSON strict. XML : indentation, détection des balises mal fermées. Tout est calculé localement.
- **Dépenses partagées** : saisissez les personnes puis les dépenses (qui a payé, partagé entre qui) ; E.N.O.S. calcule le solde de chacun et **le moins de virements possible** (paires exactes d'abord, puis plus grosse dette → plus grosse créance : au plus n-1 virements). Calculs **en centimes** (le reste d'un partage est réparti sans perte, la somme des soldes vaut toujours 0). Un message récapitulatif prêt à copier-coller est généré. Les données restent dans le navigateur de ce PC (rien n'est envoyé).
- **Notes de frais** : déposez des photos de tickets ou factures (JPG, PNG, HEIC, PDF ; 60 maximum). Le **modèle de vision du LLM configuré** lit date, commerçant, total TTC, TVA et catégorie ; un tableau modifiable s'affiche, les lignes douteuses (montant ou date illisible, TVA incohérente) sont signalées, **jamais corrigées en silence**. « EXPORTER EN EXCEL » crée un classeur (feuille « Notes de frais » + « Synthèse » par catégorie, totaux en **formules**). Les photos sont envoyées au LLM pour lecture puis supprimées. **Vérifiez toujours** avant de transmettre à la comptabilité : la qualité dépend du modèle de vision (`vision_model` dans `nasko_config.json`, voir plus haut) et de la netteté de la photo.
- API : `/api/receipts/analyze|job|export|open-folder`. Tests : `python tests/test_receipts.py`, `node tests/quicklib.test.js`, `python tests/test_llm_vision.py`.

## Syllabus Scanner (bouton « 23. SYLLABUS SCANNER » ou « ⚡ IMPORTER UN PLAN DE COURS » dans l'Agenda)
Déposez le planning de l'école ou le plan de cours d'un professeur (PDF, Word `.docx`, texte) : l'IA (LLM configuré) lit le document, **vous montre** ce qu'elle a trouvé (« 4 examens, 12 travaux à rendre, 20 séances ») et ne touche à l'agenda qu'après votre validation.
- **Vous gardez la main** : chaque ligne est modifiable (type, intitulé, date, heure, durée) et décochable ; filtres Examens / À rendre / Cours.
- **Fiabilité** : le LLM ne fait que lire le texte. Les dates sont validées par le programme (dates impossibles ou hors de la fenêtre -1 an / +2,5 ans rejetées) ; les cours hebdomadaires sont développés par le programme (`recurrence`, exceptions comprises, 80 séances max par règle). Un doublon avec l'agenda existant (même titre, même date et heure) est détecté et décoché.
- **Heure absente du document** : valeur par défaut (examen 9 h, cours 8 h, rendu 23 h 59) signalée « ESTIMÉE » : à vérifier.
- **Import annulable** : « ANNULER L'IMPORT » retire d'un coup tout le lot, sans toucher à vos autres tâches. Les éléments portent leur type (examen / rendu / cours) dans l'agenda ; l'IA proactive les voit immédiatement.
- **Limites** : un PDF scanné (image) doit d'abord passer par l'OCR (Éditeur PDF → OUTILS) ; un tableau très complexe peut être mal lu par le LLM, d'où la vérification. Le texte du document est envoyé au LLM configuré ; le fichier n'est pas conservé.
- API : `/api/syllabus/analyze|job|import|undo`. Tests : `python tests/test_syllabus.py`.

## Studio média (bouton « 22. STUDIO MÉDIA »)
Boîte à outils locale (PC uniquement) : déposez un fichier, réglez, lancez ; les résultats arrivent dans `Studio média\Livraison\` avec un lien de téléchargement. Seules la **transcription** et les **sous-titres** envoient l'audio au service Whisper configuré (comme la dictée) ; tout le reste reste sur le PC.
- **Convertisseur d'images** : HEIC (iPhone), WEBP, AVIF, TIFF, BMP, GIF → JPG / PNG / WEBP, par lots. Les métadonnées (GPS…) sont retirées sauf si vous cochez « conserver ». Les images animées donnent leur première image.
- **Agrandisseur net** (×2, ×3, ×4) : suppression des artefacts, interpolation Lanczos par paliers, netteté adaptative. **Ce n'est pas une IA générative** (aucun modèle de super-résolution n'est embarqué) : le résultat est propre et net, mais les détails perdus ne sont pas inventés.
- **Pipette à couleurs** : clic sur l'image → HEX, RGB, CMJN (conversion mathématique, pas un profil ICC d'impression), couleurs dominantes, historique.
- **Floutage de confidentialité** : détecte visages et plaques (détecteurs Haar d'OpenCV dans `cascades\`) et, en option, des zones de texte (heuristique). **Détection approximative** : elle oublie des visages de profil ou de petite taille et se trompe parfois ; vous validez, ignorez (clic) ou ajoutez des zones à la main avant d'appliquer. Flou, pixellisation ou aplat noir ; l'image exportée n'a aucune métadonnée.
- **Métadonnées (EXIF)** : affiche GPS, date, appareil, logiciel… puis les efface. Un JPEG non pivoté est nettoyé **sans recompression** ; sinon l'image est ré-enregistrée (qualité 95).
- **Vidéo → MP3 / WAV / M4A** (extrait possible) et **Vidéo → GIF** (30 s max, palette optimisée, boucle infinie).
- **Nettoyeur audio** : filtre passe-haut (vent) + débruitage spectral FFmpeg ; très efficace sur un bruit continu (souffle, ventilation, circulation). **L'écho n'est qu'atténué.** Une vidéo garde son image intacte.
- **Transcription** : audio ou vidéo → texte en paragraphes (coupés aux pauses), `.txt` + `.srt`, horodatage optionnel. Découpe automatique par blocs de 10 min. Configuration : `stt_api_key` / `stt_base_url` (ou LLM compatible OpenAI comme Groq), ou `stt_provider` « local » (faster-whisper).
- **Sous-titres incrustés** : transcription puis incrustation (taille, position, couleur) ; `.srt` fourni aussi.
- **Protection / déverrouillage PDF** : dans l'Éditeur PDF, onglet SÉCURITÉ (chiffrement AES-256, restrictions ; un PDF protégé se déverrouille à l'ouverture avec son mot de passe).
- Dépendances : `pillow-heif`, `opencv-python-headless<5` (OpenCV 5 n'a plus les détecteurs Haar), FFmpeg (fourni). API : `/api/studio/caps|upload|preview|run/{outil}|job|job/cancel|open-folder`. Tests : `python tests/test_studio.py`, `python tests/test_studio_routes.py`.

## Éditeur PDF (bouton « 21. ÉDITEUR PDF »)
Outil 100 % local (PC uniquement, jamais exposé au téléphone) basé sur **PyMuPDF**. On travaille sur **un document ouvert** : chaque opération crée une version, **↶ ANNULER** (Ctrl+Z) revient en arrière. Les sorties (extraits, conversions, copie protégée, traduction, export) sont écrites dans `Editeur PDF\Livraison\` avec un lien de téléchargement temporaire. Rien ne quitte le PC, **sauf le texte envoyé au LLM** quand vous utilisez l'onglet IA.
- **Ouvrir / fusionner** : déposez des fichiers dans la fenêtre (ou « + AJOUTER / FUSIONNER ») : PDF, images (une image = une page A4, orientation EXIF respectée) et documents Word / Excel / PowerPoint / ODT / TXT (via LibreOffice). Plusieurs fichiers = fusion dans l'ordre. Un PDF protégé demande son mot de passe, puis s'édite sans protection.
- **PAGES** : grille de miniatures, **glisser-déposer** pour réordonner (sélection multiple Ctrl / Maj), rotation 90° / 180°, suppression, duplication, page blanche, puis « APPLIQUER L'ORGANISATION ». Extraire une plage (`3-5, 8, 10-`, `impaires`, `paires`) ; diviser : une page par fichier, tous les N pages, par plages ou par signets (résultat en ZIP + fichiers).
- **ANNOTER** : surligner, souligner, barrer, texte libre, note adhésive, tampons (APPROUVÉ, CONFIDENTIEL…), dessin, cadre. Les modifications sont préparées sur la page puis envoyées d'un coup (« APPLIQUER ») ; ce sont de vraies annotations PDF.
- **ÉDITER · CAVIARDER** : *Modifier le texte* (clic sur une ligne, Entrée : l'ancien texte est effacé, le nouveau est écrit avec la police / taille / couleur d'origine ; limite : ligne par ligne, polices de base si l'originale n'est pas disponible). *Caviarder* (bloc noir ou **recherche** : texte exact, IBAN, e-mail, téléphone, carte, n° sécu) : le texte, les pixels des images et les métadonnées sous le bloc sont **supprimés définitivement** à l'application, pas seulement masqués.
- **SIGNER** : signature dessinée, tapée (polices manuscrites du système) ou importée (fond blanc rendu transparent), puis placée et redimensionnée sur la page. Image de signature, **sans valeur de signature électronique qualifiée** (pas de certificat).
- **OUTILS** : filigrane (texte ou logo, opacité, angle, pages), numérotation (`Page {n}/{N}`, position, début), **compression** (léger sans perte / images à 150 dpi / à 100 dpi ; si aucun gain, l'original est conservé), **OCR** (Tesseract, voir ci-dessous), conversion PDF → Word (`pdf2docx`), Excel (tableaux détectés → feuilles) et PowerPoint (fond + zones de texte modifiables).
- **SÉCURITÉ** : copie chiffrée **AES-256** avec mot de passe d'ouverture et/ou restrictions (impression, copie, modification). Conservez vos mots de passe : ils ne sont pas récupérables.
- **IA** (nécessite `llm_api_key`) : *chat avec le document* (si le document dépasse ~24 000 caractères, seules les pages les plus pertinentes sont envoyées ; réponses avec pages citées), *résumé* (court / structuré / détaillé, par lots pour les longs documents), *traduction avec mise en page conservée* (chaque bloc est effacé puis réécrit au même endroit ; images et graphiques conservés ; les pages pivotées sont ignorées et signalées).
- **Dépendances** : `pymupdf`, `pdf2docx`, `openpyxl`, `python-pptx` (pip, voir `requirements.txt`). **OCR** : installer *Tesseract OCR* avec les langues voulues (Windows : UB-Mannheim ; variable `TESSDATA_PREFIX` si besoin). **Word / Excel / PowerPoint → PDF** : installer *LibreOffice* (ou `libreoffice_path` dans `nasko_config.json`). Un outil dont la dépendance manque est grisé avec une explication.
- API (réservée au PC) : `/api/pdf/state|new|upload|pick|open|undo|page|lines|arrange|extract|split|annotate|watermark|numbers|protect|export|chat|job/{compress,ocr,convert,summarize,translate}`. Tests : `python tests/test_pdf.py` et `python tests/test_pdf_routes.py`.

## Actions décidées par le LLM (« les mains »)
Le prompt système demande au LLM d'ajouter en fin de réponse `[ACTION: OPEN_PIXELLAB]` (préparer PixelLab : Chrome privé sur temp-mail + inscription) ou `[ACTION: OPEN_ENV]` (environnement de dev) quand vous le lui demandez. Le serveur :
- n'exécute que ces deux actions (liste blanche, dans `nasko_actions.py`) ; toute autre balise est ignorée ;
- retire **toutes** les balises du texte avant l'affichage, l'historique, la base et ElevenLabs (jamais affichées ni prononcées) ;
- limite chaque action à une fois toutes les 15 s ;
- fonctionne depuis le PC comme depuis un téléphone ayant saisi le code.
Ce bloc est ajouté automatiquement au `system_prompt` de votre config (il n'est pas à recopier).

## Mémoire d'apprentissage
`data\nasko_memory.db` (SQLite), table `conversations` : `id, timestamp, ip_address, user_prompt, llm_response` (+ `actions`). Chaque échange réussi y est archivé silencieusement (PC ou téléphone). Les réponses y sont enregistrées sans balise. Les échanges en erreur ne sont pas archivés. La base est en clair : elle contient tout ce qui est dit et l'IP des appareils ; ne la partagez pas.
- Recompiler : `build.bat`. L'ancienne fenêtre Tkinter est archivée dans `archive\main_tk_ancien.py` (non maintenue).
- Dépendances : `py -m pip install -r requirements.txt`.

## Architecture
| Fichier | Rôle |
|---|---|
| `nasko_server.py` | API FastAPI + sert l'interface (`static/`). Écoute uniquement `127.0.0.1`. |
| `nasko_core.py` | Configuration, chemins. |
| `nasko_llm.py` | Client LLM (Anthropic / compatible OpenAI). |
| `nasko_eleven.py` | Synthèse vocale ElevenLabs (cache dans `data\tts_cache`). |
| `nasko_tasks.py` | Environnement (PowerShell/claude/Godot/Aseprite), ouverture PixelLab. |
| `static/index.html`, `app.js` | Interface web « hacker » (chat, projets, fichiers). |

Sécurité : un jeton secret est injecté dans la page à chaque démarrage ; toute requête sans lui (ex. depuis un autre site) est refusée, tout comme un en-tête Host autre que localhost. L'explorateur de fichiers est limité aux projets enregistrés.

## Configuration (`nasko_config.json`)
Créé/complété automatiquement au démarrage à côté de l'exe (vos valeurs existantes sont conservées). Ne partagez jamais ce fichier : il contient vos clés.

### Cerveau LLM (obligatoire pour discuter)
| Clé | Rôle |
|---|---|
| `llm_provider` | `"anthropic"` (défaut) ou `"openai"` (aussi pour tout serveur compatible OpenAI) |
| `llm_api_key` | votre clé API (ou variable d'environnement `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) |
| `llm_model` | vide = défaut (`claude-haiku-4-5-20251001` / `gpt-4o-mini`) ; mettez le modèle de votre choix |
| `llm_base_url` | vide = URL officielle ; sinon ex. `http://localhost:11434/v1` (Ollama), OpenRouter, etc. |
| `llm_max_tokens`, `llm_history_messages` | longueur max d'une réponse, nombre de messages de mémoire envoyés |
| `system_prompt` | le System Prompt de E.N.O.S. (modifiable) |

Configuration automatique : `py configurer_llm.py --provider openai --base-url https://api.groq.com/openai/v1 --model openai/gpt-oss-20b --key gsk_...` (écrit uniquement dans `nasko_config.json`, jamais dans le code ni dans l'exe). Modèles Groq disponibles : `GET https://api.groq.com/openai/v1/models`. Les anciens `llama3-8b-8192` et `llama-3.1-8b-instant` ne sont plus disponibles.
Les appels HTTPS sortants (LLM, ElevenLabs) utilisent le magasin de certificats de Windows (`truststore`) : indispensable derrière un antivirus qui inspecte le HTTPS (ex. Kaspersky). La vérification des certificats reste active.
Redémarrez ENOS.exe après modification.

### Voix ElevenLabs
Config actuelle : voix **« AI E.N.O.S. »** (ID `elBKWyuZY8uXinZoADVH`, la voix de vos fichiers `Audionew`), `tts_dynamic: true`. Chaque réponse du LLM est synthétisée par ElevenLabs puis jouée, synchronisée avec le texte, l'avatar et le fond. Les phrases déjà générées sont mises en cache (`data	ts_cache`) et ne consomment plus de quota.
- Configurer / changer : `py configurer_llm.py --eleven-key sk_... --voice-id <ID>` (ou `--voice-name "nom exact"`). Clés possibles : `elevenlabs_api_key`, `elevenlabs_voice_id`, `elevenlabs_voice_name`, `elevenlabs_model`, `tts_dynamic` (`--tts off` pour couper la voix).
- Le nom doit être exact : la voix s'appelle « AI E.N.O.S. » (sans points). Lister vos voix : `GET https://api.elevenlabs.io/v1/voices` avec l'en-tête `xi-api-key`.
- **Quota** : l'offre gratuite donne 10 000 caractères par mois. Une réponse de 150 caractères en consomme 150. Erreur de quota, clé invalide ou réseau : message rouge dans le chat, la réponse reste affichée en texte.

### Divers
`project_dir` (projet actif, mémorisé automatiquement), `godot_path`, `aseprite_path`, `launch_claude` / `launch_godot` / `launch_aseprite` (true/false), `godot_scene_excludes`, `godot_console`, `chrome_path`, `incognito_urls`.

## Projets et environnement de dev
- Panneau **[ PROJETS ]** : cliquer un projet le rend **actif** (●) et le mémorise dans `nasko_config.json` (`project_dir`) : il est retrouvé à chaque lancement. Saisir un chemin puis `Entrée` ou `+` l'ajoute et l'active ; `…` ouvre le sélecteur de dossier Windows ; `✕` le retire de la liste. Un projet dont le dossier a disparu s'affiche avec ⚠.
- **1. ENVIRONNEMENT** lance sur le projet actif : **PowerShell + `claude`** (positionné dans le dossier), **Godot** (`--editor --path <projet>`) et **Aseprite**, selon les outils actifs. VS Code n'est plus lancé. Un outil introuvable ou désactivé est signalé sans bloquer les autres. L'action LLM `[ACTION: OPEN_ENV]` lance la même chose, sans commentaire vocal.
- Dossier absent ou aucun projet : rien n'est lancé ; E.N.O.S. propose **« Sélectionner un dossier… »** ou **« Créer ce dossier »**, puis relance l'environnement tout seul. (Créer un dossier n'est proposé que depuis le PC, jamais décidé par le LLM.)

## Flux d'une réponse
Micro/clavier → `/api/chat` → LLM → ElevenLabs → texte + audio renvoyés ensemble. Pendant l'attente : « E.N.O.S. réfléchit… ». Erreurs LLM ou ElevenLabs (clé, quota, réseau) : message rouge dans le chat. Sans ElevenLabs : texte seul. Les anciens fichiers `Audionew\reponse_*.mp3` ne sont plus utilisés (laissés en place).

## Bouton PixelLab
Raccourci uniquement : ouvre Chrome en navigation privée sur `incognito_urls` (temp-mail + inscription PixelLab). Aucune automatisation.

## Dictée vocale (micro du PC) et mode Live
Dans la fenêtre native, le bouton **micro** enregistre le micro par défaut de Windows (`sounddevice`), puis Whisper transcrit la parole ; le texte apparaît dans la zone de saisie et est envoyé au chat automatiquement.
- **1er clic** : écoute (indicateur `● ÉCOUTE ▮▮▯▯▯`). L'enregistrement s'arrête **tout seul** ~1,3 s après la fin de votre phrase (seuil adapté au bruit ambiant), ou après 8 s sans parole, ou 30 s max.
- **2e clic pendant l'écoute** : arrête tout de suite et transcrit ce qui a été dit.
- **Casque (Live)** : enchaîne écoute → transcription → réponse → réécoute, micro coupé pendant la réponse. Recliquez pour quitter.
- Aucune parole détectée → rien n'est envoyé (Whisper n'est même pas appelé).
- Si le micro est introuvable ou bloqué : message dans le chat. Windows doit autoriser les applications de bureau : Paramètres > Confidentialité et sécurité > Microphone.
- Sécurité : seul le PC local peut utiliser le micro ; un téléphone connecté en réseau n'y a jamais accès (il utilise la reconnaissance vocale de son navigateur).

Transcription (`nasko_config.json`) : `stt_provider` `"api"` (défaut) ou `"local"`.
- `api` : Whisper via une API compatible OpenAI. Par défaut, réutilise `llm_base_url` + `llm_api_key` (Groq : modèle `whisper-large-v3-turbo`, ~0,6 s). Surchargeable avec `stt_base_url`, `stt_api_key`, `stt_model`. L'audio enregistré est envoyé à ce service.
- `local` : `faster-whisper` sur le processeur (`py -m pip install faster-whisper`, modèle `stt_local_model` téléchargé au premier usage). Hors ligne mais plus lent (~5 s) et moins précis ; **non inclus dans ENOS.exe** (utilisable avec `py nasko_server.py`).
- `stt_language` : `"fr"` par défaut. Le vocabulaire E.N.O.S. / Nassime / Terna / PixelLab / Godot / Aseprite est fourni à Whisper.

## Accès téléphone : micro
Depuis le téléphone (HTTPS), le micro utilise la reconnaissance vocale de son navigateur (Chrome Android) ; voir la section réseau.

## Logo
`py setup_assets.py` convertit le logo pixel art (`Gemini_Generated_Image_njcmz6njcmz6njcm.jpg`, ou un autre fichier passé en argument) en `logo.png` (512x512, fond transparent : favicon, `apple-touch-icon`, avatar du chat) et `logo.ico` (multi-tailles 16 à 256 : fenêtre native, barre des tâches, icône de `ENOS.exe`). L'image source n'est pas modifiée. `build.bat` embarque ces deux fichiers et utilise `logo.ico` comme icône de l'exécutable. Sans logo, l'icône par défaut est conservée.

L'avatar du chat (en-tête du terminal) s'illumine et pulse dès que l'audio de E.N.O.S. démarre (événement `play`), en même temps que l'ASCII et l'accélération de la respiration du fond ; tout redevient calme à la fin de l'audio.

## Interface
Modules (Environnement, Clé PixelLab), projets (historique, ajout/retrait, l'environnement se lance dans le projet sélectionné), explorateur de fichiers avec aperçu texte, chat avec voix synchronisée à la frappe, historique persistant, coupure audio.

## Panneau TESTS F6 (PC, téléphone, web)
Bouton **F6** dans l'en-tête du chat (ou touche F6, module « 3. TESTS F6 ») : transition plein écran qui masque complètement le chat et ouvre le panneau de test.
- **Un bouton par scène** du projet (filtres TOUT / RÉCENTS / TEST / DIAG, recherche). Un clic lance la scène avec Godot ; une seule scène tourne à la fois (la précédente est remplacée) et les lancements à distance s'arrêtent seuls après `f6_auto_stop_minutes` (30 par défaut).
- **Visu live** : image de la fenêtre du jeu (jamais le reste du bureau) en MJPEG. Qualité ECO / NORMAL / HD, STOP pour fermer la scène, plein écran. 3 spectateurs maximum, visibles sur le PC.
- `screen_share: "full"` (modifiable uniquement depuis le PC, panneau F6) partage tout l'écran : à n'utiliser que consciemment.
- Fonctionne depuis un téléphone/web authentifié (appareil de confiance). Retour : bouton ←, Échap, F6 ou bouton retour Android.

## Joindre le PC depuis l'extérieur
1. **PC éveillé** : bouton « PC ÉVEILLÉ » du panneau ACCÈS TÉLÉPHONE (`keep_awake`). Branchez le secteur ; fermer le capot met quand même en veille (Options d'alimentation > Action de la fermeture du capot > Ne rien faire).
2. **Démarrage automatique** : `py creer_raccourci.py --demarrage` lance E.N.O.S. sans fenêtre à l'ouverture de session (`--retirer-demarrage` pour annuler). Le serveur peut aussi être lancé à la main avec `ENOS.exe --server-only`.
3. **VPN (Tailscale)** : installez-le sur le PC et le téléphone, mettez `"allow_vpn_ranges": true` dans `nasko_config.json`, relancez E.N.O.S., puis **réinstallez `nasko-ca.crt` sur le téléphone** (nouveau certificat couvrant 100.64.0.0/10). Ne redirigez jamais un port du routeur vers Internet.

## Allumer le PC éteint (Wake-on-LAN) : limites honnêtes
- Le réveil réseau exige : PC en **Ethernet** (le Wi-Fi n'est en pratique pas réveillable), WoL activé dans le BIOS et dans Windows, démarrage rapide désactivé, et un **relais toujours allumé** (Raspberry Pi, NAS, mini-PC) sur le même réseau, joignable par VPN.
- `py diagnostic_reveil.py` : rapport en lecture seule de ce PC (carte, WoL, démarrage rapide, session auto…) avec les corrections à faire.
- `py creer_relais.py` : prépare le dossier `relais_reveil` (relais + MAC de la carte Ethernet + code d'accès) à copier sur l'appareil toujours allumé ; lisez son LISEZMOI.txt.
- Après un réveil depuis l'arrêt, Windows attend votre mot de passe tant que la session auto n'est pas activée : la **veille** est bien plus pratique que l'arrêt.
- Non testé sur du matériel réel : le paquet magique et le relais sont validés par des tests réseau locaux uniquement.

## Application Android (APK) téléchargeable
- `py construire_apk.py` fabrique **NASKO.apk** (coque WebView signée, sources dans `android/`). Premier lancement : `py construire_apk.py --installer-sdk --accepter-licences` télécharge le SDK Android minimal (≈ 300 Mo, dans `%LOCALAPPDATA%\Android\Sdk`) ; `--accepter-licences` = vous acceptez les licences du SDK de Google. Il faut un JDK 11+ (Temurin).
- La clé de signature (`android/signing/enos-release.jks` + `enos-release.pass`, ignorés par Git) : **sauvegardez-les hors du dépôt**, sans elles l'APK ne pourra plus être mise à jour par-dessus l'ancienne. `ENOS_KEYSTORE` / `ENOS_KEYSTORE_PASS` (variables d'environnement) priment sur les fichiers. L'ancienne clé `nasko.jks` est compromise : ne plus l'utiliser (l'APK doit être réinstallée une fois).
- Distribution : le PC sert l'APK sur `https://<IP du PC>:8443/nasko.apk` (lien « ⬇ INSTALLER L'APPLICATION ANDROID » sur la page de connexion et dans le panneau ACCÈS TÉLÉPHONE). Sur le téléphone, autorisez l'installation depuis cette source ; Play Protect peut avertir : l'application n'est pas publiée sur le Play Store.
- Au premier lancement : saisissez l'adresse du PC (ex. `192.168.1.28`) et, en option, celle du relais de réveil. L'application demande de **valider l'empreinte du certificat** du PC (comparez-la à celle du panneau ACCÈS TÉLÉPHONE) : aucun certificat à installer sur le téléphone. Si le certificat change, l'application le signale.
- PC éteint ou injoignable : page « PC INJOIGNABLE » avec reconnexion automatique et bouton **ALLUMER LE PC** (ouvre le relais de réveil, voir plus haut).
- Réglages modifiables ensuite : bouton « RÉGLAGES DE L'APPLICATION » dans le menu ☰ de l'interface.
- Limites : le micro du navigateur n'existe pas dans une WebView Android (la dictée vocale reste celle du PC) ; l'APK n'a pas été testée sur un appareil réel.

## Environnement : pas de doublons
Le bouton ENVIRONNEMENT (et la commande vocale/LLM) vérifie avant de lancer : Godot déjà ouvert **en éditeur sur ce projet**, Aseprite déjà ouvert, Claude déjà ouvert dans le dossier du projet (ou un sous-dossier). L'outil déjà ouvert n'est pas relancé : sa fenêtre est ramenée devant et E.N.O.S. le dit à voix haute. Même contrôle pour la navigation privée PixelLab (si Chrome a été ouvert en navigation privée avec les pages configurées). Limite : un Claude lancé dans un terminal sous un autre compte/niveau d'administrateur n'est pas visible.

## Zone TESTS F6
Un bandeau « ZONE TESTS F6 » reste visible sous l'en-tête du chat (PC et mobile) : nombre de scènes, scène en cours avec son chronomètre, accès direct au panneau ; sur PC, des boutons de catégorie ouvrent le panneau déjà filtré.


## Éteindre / mettre en veille le PC en sécurité
- Menu ☰ > **[ ALIMENTATION ]** (boutons ⏾ VEILLE et ⏻ ÉTEINDRE) et bouton ⏻ rouge du panneau TESTS F6 : sur le PC et sur le téléphone.
- Garde-fous : confirmation obligatoire, puis **compte à rebours de 20 s annulable** (`power_delay`, 5 à 300 s) visible sur tous les appareils connectés (le bouton ANNULER ou Échap l'arrête). Les scènes de test en cours sont arrêtées proprement avant ; pas d'arrêt forcé : un programme avec un travail non enregistré peut bloquer l'arrêt au lieu de le perdre.
- À distance (téléphone / web) : en plus de l'appareil de confiance, le **code d'accès est redemandé** à chaque fois ; 3 codes faux = blocage 5 minutes. `"remote_power": false` dans `nasko_config.json` désactive totalement l'arrêt à distance. Chaque demande/annulation est inscrite dans le journal avec le nom de l'appareil.
- La **veille** (et non l'arrêt) est recommandée : le PC reste rallumable par le relais de réveil et retrouve sa session.


## CONTRÔLE MOBILE et DÉFI (PC uniquement)

**CONTRÔLE MOBILE** (menu) pilote *un seul* téléphone Android via adb, en local : rien ne transite par l'entrepôt OneDrive ni par le réseau d'E.N.O.S.
- Activez « Débogage USB » sur le téléphone, branchez-le, acceptez l'empreinte RSA.
- RÉGLAGES → PROFIL → TÉLÉPHONE (ADB) : « DÉTECTER » puis choisissez l'ID, « ENREGISTRER ». L'ID est stocké dans le **profil actif** : chacun (Nassime, Raf) ne pilote que son téléphone. Sans ID, aucune commande n'est envoyée. Toutes les commandes partent en `adb -s <ID> shell …`.
- Boutons : écran on/off (keyevent 26), YouTube, balayage vers le haut, AFFICHER L'ÉCRAN (scrcpy).
- adb.exe / scrcpy.exe manquants : téléchargés automatiquement dans `%LOCALAPPDATA%\ENOS\outils` (hors OneDrive). Pour les placer à la main : `outils\adb\adb.exe` et `outils\scrcpy\scrcpy.exe` à côté d'ENOS.exe.

**DÉFI → CHESS** : partie contre Stockfish (téléchargé au premier lancement dans `%LOCALAPPDATA%\ENOS\outils\stockfish`, ou placez `stockfish*.exe` dans `outils\stockfish`). Chaque coup est jugé par la perte en centipions : Brillant, Meilleur coup, Excellent, Bon, Imprécision, Erreur, Gaffe. Le carré noir en haut à droite est réservé à l'œil 3D d'E.N.O.S.

## CHESS : plateau Godot encastré
Le dossier `godot_chess/` (à garder à côté d'ENOS.exe) est un mini-projet Godot : plateau du Colis Chess, pièces animées (trajectoire de Bézier, étirement + sillage, halo cyan à la sélection, explosion à la capture). E.N.O.S. le lance en silence avec le Godot de votre profil (`godot_path`), capture sa fenêtre et l'encastre dans le panneau CHESS. Les règles et Stockfish restent en Python ; les coups passent par un WebSocket local (`/ws/chess`, boucle locale + jeton de session). Si Godot est absent ou plante, le plateau 2D intégré reste affiché.
- Ressources : `py godot_chess\preparer_assets.py` régénère `assets/` depuis `PourClaude/` (Dame = modèle 03/17, Tour = modèle 14/22).
- Test des animations sans E.N.O.S. : `Godot --path godot_chess -- --selftest <dossier>` (écrit des captures d'écran).

## Notifications, historique CHESS et ŒIL DE BUREAU
**Fin de tâche** : compression, analyse audio, conversion d'images, colis et synchronisation tournent chacun sur leur propre thread (l'interface reste fluide, vous pouvez jouer aux échecs pendant un traitement). À la fin : notification Windows native (plyer) + phrase réflexe vocale (fichier ElevenLabs généré une fois puis conservé). Réglages dans `nasko_config.json` : `notify_enabled`, `notify_voice`.

**Historique CHESS** : bouton HISTORIQUE dans le panneau CHESS. Les 10 dernières parties (fin de partie ou abandon) sont enregistrées dans `data/chess_history.json` (coups SAN + PGN) ; la 11e supprime la plus ancienne. Relecture coup par coup et copie du PGN.

**ŒIL DE BUREAU** (menu) : lance `godot_eye/` — un œil flottant (fenêtre sans bordure, transparente, toujours au premier plan). Il regarde le curseur, se glisse avec un effet ressort, rebondit sur les bords de l'écran. **Clic** sur l'œil : capture silencieuse de l'écran principal + micro (arrêt au silence) + transcription + API Vision + réponse vocale. **Clic droit** : fermer. La capture n'est envoyée qu'au fournisseur LLM configuré, uniquement à ce moment-là, et n'est pas conservée. Modèle de vision : `vision_model` (par défaut `qwen/qwen3.8-27b` pour Groq ; le modèle de chat gpt-oss ne lit pas les images). `pet_autostart: true` lance l'œil avec E.N.O.S.

## CHESS : trash talk, takeback, review, thèmes · Traitement d'image parallèle
- **Trash talk** : bouton 🎤 dans le panneau CHESS (ou ⏹ INTERROMPRE : coupe la voix puis ouvre le micro). E.N.O.S. répond avec arrogance et sarcasme ; au 3e propos sans coup joué il vous ordonne de vous concentrer.
- **Gaffe catastrophique** (chute ≥ 25 points de probabilité de gain depuis une position jouable) : la partie se fige, E.N.O.S. se moque, montre le meilleur coup (flèche verte) et vous laisse choisir : continuer ou annuler (takeback, 2 par partie : `chess_takebacks`).
- **Bilan** : s'ouvre à la fin de la partie (aussi via BILAN et dans l'historique) : précision, Elo estimé, coups par catégorie, courbe d'avantage.
- **Thèmes de pièces** : menu dans la barre CHESS. Un thème = dossier `godot_chess/assets/themes/<nom>/` (12 PNG `wk`…`bp` + `theme.json`). « Glace & Rouge » est généré par `py godot_chess\preparer_assets.py` à partir de `PourClaude/colis new theme blancs` / `noirs` (Roi/Dame à confirmer ; sprites de 70 px agrandis ×3 : fournissez des images plus grandes pour un rendu net). Icônes de jugement : `PourClaude/Colis Chess moves image`.
- **Traitement d'image** : jusqu'à 3 images traitées en parallèle (un onglet Chrome par image, bandeau de progression non bloquant) ; bouton ⇩ TÉLÉCHARGEMENTS : choisissez plusieurs images récentes et envoyez-les en un clic ; PourClaude est dans les destinations de livraison.

## ETO : la seconde personnalité
- **Bascule** : pilule `E.N.O.S. | ETO` dans l'en-tête (et dans la barre CHESS). Le choix est mémorisé (`persona` dans `nasko_config.json`). La transition est cinématique : vers ETO, un rideau de lumière blanche part du bouton et éclaircit tout ; vers E.N.O.S., la lumière est aspirée et l'univers sombre revient.
- **Thème ETO** : blanc nacré, aurore pastel, verre dépoli (`static/persona.css`). Il s'applique à toute l'interface, au Mode discussion et aux échecs.
- **Visage d'ETO** : une boule blanche au visage bleu, ~35 expressions (`static/eto_expressions.json`, partagé avec Godot). Il remplace l'œil partout : en-tête, terminal, Mode discussion, plateau d'échecs (web **et** plateau Godot encastré : plateau clair, pièces en glace bleue) et **Œil de bureau** (même glisser / clic = micro + vision). Il suit la souris, cligne, parle, et joue les balises audio de ses réponses ([hmm] → pensif, [laugh] → éclat de rire…).
- **Voix** : `elevenlabs_eto_api_key` + `elevenlabs_eto_voice_id`, modèle `elevenlabs_eto_model` (`eleven_v3`, le seul à jouer les Audio Tags). E.N.O.S. garde `elevenlabs_api_key` / `elevenlabs_voice_id` (`eleven_multilingual_v2`).
- **Œil de bureau réduit** : un gardien relève la fenêtre de l'Œil / du visage si Windows la minimise ou lui retire le « toujours au premier plan ».
- **Onglets Chrome** : GESTION GOOGLE → « INSTALLER L'EXTENSION CHROME » génère `data\chrome_ext` (à charger dans chrome://extensions, mode développeur). Elle remonte vos vrais onglets sans port de débogage.

## CHESS : défi E.N.O.S. et cours avec ETO
- **Sélecteur de mode** (barre CHESS) : `DÉFI · E.N.O.S.` ou `COURS · ETO + BOT`. Le mode bascule la personnalité avec la transition (cours = ETO clair, défi = E.N.O.S. sombre).
- **Cours** : vous jouez contre un **bot virtuel** à l'Elo choisi (400 à 2600, Stockfish bridé ; ETO, à 3200, ne joue pas). ETO **commente chaque tour** en coach de stream : il explique vos erreurs avec bienveillance (le meilleur coup, l'idée, ce que le bot va faire pour en profiter), explique celles du bot et **comment les punir**, accueille et fait le bilan. Le micro devient « poser une question au coach ». Les lignes viennent du moteur (`nasko_chess._play` : meilleure ligne, suite après le coup, mat) ; le LLM les met en mots (`nasko_coach.py`), jamais de variante inventée.
- **Défi contre E.N.O.S.** : E.N.O.S. provoque comme avant et **annonce un mat forcé** (« Mat en 13 coups. Inévitable. »). ETO intervient dans le panneau COACH (avec sa voix) quand vous faites une erreur ou qu'E.N.O.S. attaque : il explique l'idée agressive et propose une défense. Décochez COACH pour le faire taire, VOIX pour le texte seul.
- **Plateau Godot ETO** : bleu, blanc et noir (cases blanches / bleu roi, cadre et jauge noirs, pièces argent et noires aux reflets bleus). L'échiquier E.N.O.S. reste noir et rouge.
- **Réduction** : quand la fenêtre est réduite, l'Œil / le visage apparaît sur le bureau (et disparaît à la réouverture). Désactivation : `localStorage.enos_pet_on_min = "0"`.

## ETO streamer + SPEEDRUN
- **Personnalité** : ETO n'est plus zen : c'est un **streamer d'échecs passionné, hyperactif et rapide** (esprit des grands streamers francophones). Il réfléchit à voix haute, s'emballe, enchaîne des phrases courtes, utilise le jargon échiquéen et fait des masterclass. Audio Tags dynamiques : `[excited]`, `[hmm]`, `[laugh]`, `[clears throat]`, `[gasps]`, `[sigh]`.
- **Débit** : réglages de synthèse d'ETO dans `nasko_config.json` : `elevenlabs_eto_stability` (0,25), `elevenlabs_eto_style` (0,6), `elevenlabs_eto_speed` (1,2 = maximum de l’API) + `elevenlabs_eto_tempo` (1,15 : accélération locale FFmpeg sans changer la hauteur, soit ≈ x1,38 au total ; 1,0 pour la désactiver). Stabilité 0,25. Modèle `eleven_v3`.
- **Nouvelle voix** : `py creer_voix_eto.py` génère la voix par Voice Design (prompt « young French male, fast-talking Twitch streamer… »), la sauvegarde et met à jour `elevenlabs_eto_voice_id`. Nécessite un plan ElevenLabs payant et un slot libre ; sinon, créez-la sur elevenlabs.io (Voice Design) et collez son ID dans `elevenlabs_eto_voice_id`.
- **SPEEDRUN · ETO VS BOT** (3ᵉ option du sélecteur CHESS) : choisissez l'Elo du bot ; vous êtes spectateur. ETO (3200 Elo) joue (« NOUVELLE PARTIE · BLANCS/NOIRS » = sa couleur), annonce son plan à chaque coup, commente et punit les erreurs du bot. Le plateau (Godot ou web) s'anime tout seul au moment où ETO parle ; son visage, en grand, réagit en direct. Bouton PAUSE ; le micro permet de poser une question.
- **Pédagogie (corrigée)** : ETO ne lit plus la notation. Les coups sont dits en toutes lettres (« Fe3 » → « fou en e3 », « Fxh6 » → « fou prend en h6 », « fxe4 » → « le pion f prend en e4 », « O-O » → « petit roque »), à l'écran et à la voix (`nasko_persona.say_san` / `spoken_text`). Le LLM reçoit l'analyse Stockfish complète : évaluation avant/après le coup (en mots), meilleur coup et ligne conseillée, suite probable, mat, **raisons vérifiées** (« l'adversaire peut gagner la dame en h4 », « pièce menacée »…) et intentions du coup. Si le LLM est indisponible, un texte de secours pédagogique est construit à partir des mêmes données (un avertissement s'affiche dans le panneau coach).
- **Flèches** : pendant qu'ETO parle, le plateau (Godot et web) dessine vert = meilleur coup, rouge = menace / réponse attendue, bleu = coup qui punit.

## Économie d'API : mémoire d'ETO
- **Cache des commentaires** (`nasko_cache.py`, `data/eto_commentary_cache.json`) : clé = position exacte (FEN) + coup joué + Elo du bot (+ mode et langue). Une situation déjà commentée ne rappelle **ni le LLM ni ElevenLabs** : le texte est relu et l'audio est rejoué depuis `data/audio_cache/` (copié à la première synthèse). Les textes de secours (LLM indisponible) ne sont jamais mémorisés ; les questions et bilans non plus. L'application coûte donc de moins en moins cher au fil des parties ; `/api/chess/cache` donne les statistiques (entrées, succès, taux).
- **Accueil d'ETO** : quand ETO est la personnalité active, l'ouverture d'E.N.O.S. joue un accueil de streamer avec **sa voix** (jamais celle d'E.N.O.S.), l'en-tête affiche la même phrase, et son visage réagit. Six variantes ; chacune n'est synthétisée qu'une fois (cache audio).

## ETO et le coup brillant (!!)
- **Recherche** (`nasko_chess._eto_choose`) : quand ETO joue (speedrun, ou adversaire à pleine force), Stockfish tourne en **MultiPV 4, profondeur 15+**. Chaque ligne passe par le **filtre de sacrifice** : (1) *sacrifice forcé* (`_sacrifice_of`) : on joue les 3 premiers demi-coups de la ligne et on vérifie que l'adversaire prend une pièce lourde (cavalier, fou, tour, dame), que le déficit matériel atteint ≥ 2 pions, et qu'on ne recapture pas tout de suite (déficit ≥ 1 au demi-coup 3) ; (2) *sacrifice offert* (`_offered_sacrifice`) : pour un piège où la prise n'est pas la meilleure défense, on force chaque prise (`root_moves`) et on exige que, prise acceptée, l'évaluation reste ≥ +2,0 (ou mat). La ligne doit être décisive (≥ +2,0 ou mat), sans gâcher plus de 2 pions face à la ligne 1 (et un mat n'est jamais échangé contre un simple avantage). Le meilleur candidat (mat d'abord, puis évaluation, puis taille du sacrifice) **passe avant la ligne 1**. Sans sacrifice, ETO préfère, parmi les lignes à ≤ 25 cp de la meilleure, la plus tactique (échec, prise, pièce posée en prise).
- **Hype** : le coup est marqué « Brillant » ; le LLM reçoit `[SITUATION: SACRIFICE DE PIÈCE BRILLANT]` (pièce donnée, ligne, mat ou évaluation) et passe en mode commentateur e-sport (`[shouts]`, `[excited]`, `[gasps]`, `[laugh]`). Valable aussi pour un coup brillant de l'élève.
- **Godot** : flèche **dorée** à halo, « !! » qui jaillit sur la case d'arrivée, onde de choc dorée, secousse, éblouissement et son « brilliant » (signal `brilliant` du pont).
- Le cache des commentaires est invalidé à chaque nouvelle version de prompt (`PROMPT_VERSION`).

## Recherche d'outils, sélecteur Vidéos
- **Barre de recherche** (haut du menu, au-dessus de [ MODULES ]) : filtre instantané par nom (sans accents ni casse, tous les mots doivent correspondre). Entrée = ouvre le premier outil ; Échap = efface.
- **Compression** : le bouton principal « OUVRIR MES VIDÉOS » ouvre le sélecteur directement dans le dossier Vidéos de Windows (Known Folder, même si OneDrive le redirige ; « Images » pour une image). « Chercher un autre fichier… » rouvre le sélecteur au dernier dossier utilisé.

## 16. YouTube Uploader
- **Configuration unique** : Google Cloud Console → projet → activer *YouTube Data API v3* → écran de consentement (Externe, ajoutez votre Gmail en utilisateur test) → identifiants *ID client OAuth* de type **Application de bureau** → télécharger le JSON → le renommer `client_secret.json` dans `%LOCALAPPDATA%\ENOS\youtube\` (le bouton « OUVRIR LE DOSSIER » l'ouvre). Puis « CONNECTER MA CHAÎNE » : OAuth2 dans le navigateur (boucle locale + PKCE) ; le jeton est gardé dans le même dossier, hors OneDrive.
- **Envoi** : vidéo (sélecteur ouvert dans Vidéos), titre (≤ 100 caractères, sans < >), visibilité Public / Non répertoriée / Privée. Envoi par morceaux de 8 Mo, reprise automatique après coupure réseau, barre de progression, annulation, lien final.
- **« Conçu pour les enfants »** : toujours envoyé à `False` (`selfDeclaredMadeForKids`, champ de l'API) par `nasko_youtube.build_body`, sans option d'interface.
- **À savoir** : tant que le projet Google Cloud n'a pas passé l'audit de conformité YouTube, **toutes les vidéos envoyées par l'API sont verrouillées en Privé** ; E.N.O.S. l'indique à la fin. Un envoi coûte 1600 unités de quota sur 10 000 par jour (≈ 6 vidéos/jour).

## 17. Deep System Cleaner
- **Scan** : parcourt tout le disque système (ou tous les disques fixes) et garde les 300 plus gros fichiers de chaque catégorie au-dessus du seuil (20 Mo – 1 Go). Ignore les liens/jonctions, WinSxS (liens physiques) et les fichiers OneDrive « à la demande » (0 octet local). Lancer E.N.O.S. en administrateur révèle plus de dossiers (les accès refusés sont comptés).
- **Catégories** : Vidéos, Images, Documents, Applications, Archives & disques, Autres. Filtres par catégorie, par risque, par texte ; tri par taille.
- **Risque** (par chemin) : 🟢 Ultra safe = Téléchargements, Vidéos, Documents, Images, Bureau, Musique, caches/temporaires de AppData · 🟠 Moins safe = Program Files, ProgramData, AppData, dossier d'E.N.O.S., emplacements non classés · 🔴 À risque = C:\Windows, System32, Boot, Recovery, pagefile/hiberfil et l'exécutable E.N.O.S. en cours.
- **Suppression** : Corbeille de Windows par défaut (réversible ; l'espace n'est libéré qu'au vidage), « définitive » en option. 🟠 : avertissement + case à cocher obligatoire. 🔴 : **bloqué côté serveur** (jamais supprimable). Les fichiers OneDrive sont signalés (la suppression est synchronisée au cloud). Le serveur n'accepte que des fichiers trouvés par le dernier scan, recalcule le risque et refuse un fichier modifié depuis.

## Avatar 3D d'E.N.O.S. (godot_eye/avatar)
- Œil modélisé en 3D (globe, iris à fibres, pupille-fente, veines, cornée) au centre d'anneaux concentriques (disque, coque à 4 pointes, anneau clair, anneau segmenté, monture, point orbital) inspirés de la « Fairy ». Le regard fait tourner l'œil ; la lueur rouge pulse lentement avec la voix (`speak` lissé) ; glitch par à-coups (bandes décalées, séparation RVB, scanlines), plus fréquent quand E.N.O.S. parle ou s'énerve.
- Le widget « Œil de bureau » l'utilise par défaut ; `-- --eye2d` revient à l'ancien œil 2D. Aperçu : `godot --path godot_eye res://avatar_preview.tscn` (captures : `-- --capture <dossier>`).

## Contour néon global (godot_neon)
- Kit Godot autonome (`godot_neon/addons_neon`, mode d'emploi dans `godot_neon/LISEZ_MOI.md`) : nœud `NeonOutline` enfant d'une TileMapLayer ; le néon suit la silhouette du groupe de tuiles, jamais les arêtes internes.

## ⚔ Le Choc des Titans : E.N.O.S. vs ETO (spectateur)
- **Lancement** : bouton « ⚔ ORGANISER UN 1v1 E.N.O.S. VS ETO » dans la barre des échecs (ou mode « CHOC DES TITANS » du sélecteur). Les couleurs sont tirées au sort. Les deux IA jouent à pleine puissance (3200 Elo) : ETO avec MultiPV + filtre de sacrifice (coups brillants), E.N.O.S. avec Stockfish à 100 %. Tu es spectateur ; PAUSE disponible.
- **Guerre des commentaires** (`nasko_titans.py`) : deux prompts système, chacun conscient de l'autre (« Tu es ETO, ton adversaire actuel est E.N.O.S., une IA sombre et arrogante. Il vient de jouer… »). E.N.O.S. rabaisse ETO avec un mépris glacial (1 à 3 phrases, jamais d'audio tags) ; ETO commente en caster e-sport et raille les tactiques « archaïques » d'E.N.O.S. (audio tags `[laugh]`, `[shouts]`…). Chaque réplique reçoit les faits Stockfish (jugement, évaluation du point de vue du locuteur, raisons, intentions) ET la dernière réplique de l'adversaire, à laquelle il répond.
- **Alternance** : à tour de rôle (celui qui n'a pas parlé en dernier) ; les coups anodins peuvent rester silencieux. Une **variation drastique** (coup brillant, gain ou perte ≥ 1,5 pion, mat annoncé, erreur ou gaffe) déclenche un échange à deux : le bénéficiaire jubile puis l'autre réplique, ou l'adversaire se moque de l'erreur puis le fautif réplique. Ouverture : E.N.O.S. provoque, ETO répond ; fin : le vainqueur écrase, le perdant réagit.
- **Bascule visuelle et vocale instantanée** : à chaque réplique, l'interface passe sans transition cinématique (éclair de 0,2 s) à l'œil rouge 3D + thème sombre + voix grave et lente d'E.N.O.S., ou au visage blanc/bleu + voix rapide d'ETO ; le plateau Godot et le widget de bureau suivent. À la fin du match (ou à la fermeture), la personnalité d'avant revient. Chaque personnage utilise sa propre clé et son propre Voice ID ElevenLabs.
- Sans LLM, des répliques de secours propres à chaque personnage prennent le relais (pas de silence).

## Identité : plus de « NASKO »
- Cause : `nasko_config.json` contenait l'ancien `system_prompt` (« Tu es N.A.S.K.O. A.I. ») et `history.json` renvoyait au modèle d'anciennes réponses (« Je suis N.A.S.K.O »). Corrigé : prompt remplacé, anciennes réponses purgées (historique et base mémoire), clause d'identité ajoutée aux prompts d'E.N.O.S. et d'ETO, cicatrisation automatique à la lecture de la config, et filtre qui n'envoie jamais au LLM une ancienne réponse portant l'ancien nom.
- Les noms internes (dossier `%LOCALAPPDATA%\NASKO`, certificat « N.A.S.K.O Local CA », en-têtes `X-Nasko-*`, `NASKO.apk`) sont conservés exprès : les changer casserait les clés et l'appairage des appareils.

## Thèmes de pièces
- Le sélecteur liste TOUS les dossiers de `godot_chess/assets/themes/` qui contiennent les 12 images (`wk.png` … `bp.png`) ; `theme.json` est optionnel. Thèmes actuels : Menace Rouge (classique), Glace & Rouge, **Plat vert (Vecteezy)** (extrait du zip dans PourClaude par `py godot_chess/preparer_assets.py`).

## ETO pédagogue : voix, flèches et animations synchronisées
- **Flèches calées sur la voix** : chaque flèche porte la phrase parlée correspondante (« cavalier en d2 »). Le serveur retrouve sa position dans le texte (`_anchor`), et l'interface l'AJOUTE (plateau web et Godot) à l'instant où l'audio atteint ce passage. Couleurs : ambre = le coup qu'ETO joue, vert = meilleur coup, rouge = réponse attendue / menace, bleu = coup qui punit, doré = brillant. Phrase introuvable : flèches réparties dans la parole.
- **Cavaliers en équerre** (web et Godot) : 2 cases dans le sens long, puis 1 de côté, comme sur chess.com / lichess. Les autres pièces gardent la flèche droite.
- **Speedrun : le jeu avance pendant qu'il parle** : le coup est calculé côté serveur, mais son animation est retenue (`defer`) et jouée juste après qu'ETO l'a annoncé (flèche ambre d'abord, pièce ensuite). La boucle repart aussitôt : le moteur, le LLM et la voix du coup suivant se préparent pendant la phrase en cours.
- **Plus bref** : 2 à 3 phrases (40 mots max) ; en speedrun, structure « j'annonce mon coup » puis « voici la réponse que j'attends ».
- **Animations de case (Godot)** selon la pièce : cavalier = traînée lumineuse en équerre + onde au coude puis à l'arrivée ; fou / tour = balayage case par case ; dame = balayage large + étincelles ; roi = double halo doré ; pion = onde (deux sur une poussée de deux cases). Les prises, échecs, roques et promotions gardent leurs effets.
- **Son du coup brillant** : `PourClaude/witty-alien-brilliant-move-sound-effect.mp3` est copié en `godot_chess/audio/brilliant.mp3` et prime sur l'ancien wav (un mp3 déposé dans `audio/` remplace le wav du même nom).

## ETO en 8-bit (visage) et pupille d'E.N.O.S.
- **Visage d'ETO** : boule perlée en pixel-art (sprites 64x64, dithering, reflets), **57 émotions** (les 37 d'origine + angry, furious, smug, scared, shy, bored, tired, nervous, evil, hyped, mindblown, lol, touched, pleading, victory, deadpan, sassy, disgusted, kiss, panic). Chaque émotion a ses yeux (ouverts, mi-clos, ^, cœurs, étoiles, X, pupilles de peur, yeux brillants, rouges pour la rage), ses sourcils, sa bouche (sourire, D ouvert avec dents/langue, o, ondulée…), ses joues, larmes, gouttes de sueur.
- **Animation** : clignements (parfois doubles), regard qui décale le visage au pixel entier (curseur ou coups d'œil), bouche à 4 niveaux quand il parle, respiration par paliers, **mouvement propre à chaque émotion** (secousse de rage/peur/rire, rebond d'excitation, balancement du sommeil ou du vertige), effets animés (cœurs, étincelles, zzz, ?, !, larmes, veine de colère, aura, notes, étoiles qui tournent, éclat de fierté) et un « pouf » de pixels à chaque changement d'émotion. ~30 images/s.
- **Un seul dessin pour tout** : `py godot_chess/preparer_eto8.py` génère `static/eto8_atlas.png` + `eto8_index.json` (interface web) et `godot_*/eto8/` (plateau Godot et Œil de bureau). Les émotions se règlent dans `static/eto_expressions.json` (copié dans `godot_chess/` et `godot_eye/`) : yeux, sourcils, bouche, joues, effets (`hr`, `sp`, `zz`, `q`, `ex`, `dt`, `te`, `an`, `st`, `au`, `nt`, `sh`), mouvement `mot`. Pour ajouter une émotion : une ligne dans le JSON, relancer le script.
- Les balises audio de la voix déclenchent plus d'émotions (`[sarcastic]` → smug, `[gulps]` → nervous, `[applause]` → victory, `[cheers]` → hyped…), et le texte aussi (mots de rire, colère, peur, victoire, fatigue…).
- **Pupille d'E.N.O.S.** : ronde (plus de fente) ; large au repos, elle se resserre en un point noir menaçant quand il parle (et un peu avec la colère), avec un léger tremblement. Œil 3D et ancien œil 2D.

## Organisateur de dossiers et de fichiers (bouton 19)
Explorateur de rangement, **réservé à ce PC**. Au lancement : choisissez un endroit (Projets E.N.O.S., Bureau, Documents, Téléchargements, Images, Vidéos, Musique, ou **Autre dossier…** via le sélecteur Windows). Seuls ces dossiers sont accessibles ; lecteurs entiers et dossiers système sont refusés.
- **Glisser-déposer** : déplacer vers un dossier, le fil d'Ariane, l'arborescence ou « .. » (= extraire vers le parent) ; **Ctrl + glisser** = copier.
- **Clavier** : F2 renommer · Suppr → Corbeille · Ctrl+C/X/V · Ctrl+N dossier · Ctrl+Maj+N fichier · Ctrl+G regrouper la sélection dans un nouveau dossier · Ctrl+↑ extraire vers le dossier parent · Ctrl+Z annuler · Retour arrière = dossier parent · / filtrer · taper un nom = aller dessus.
- **Renommer par modèle (bouton « Par modèle »)** : renomme la sélection (ou tout le dossier) d'un coup, avec **aperçu en direct** et conflits signalés (ignorés, jamais écrasés). Modèle : `{name}` nom actuel, `{n}` numéro (début, chiffres, ordre au choix), `{date}` / `{datetime}` / `{year}` / `{month}` (date du fichier), `{parent}` (nom du dossier). Plus : chercher / remplacer (texte ou expression régulière), casse, espaces → `_` ou `-`, retrait des accents. Exemple : `Facture_{parent}_{n}`. Un seul Ctrl+Z annule tout le lot (renommage en deux temps : les chevauchements du type 2→3, 3→4 sont sûrs).
- **Ranger par type** : trie les fichiers du dossier en Images / Vidéos / Audio / Documents… (aperçu avant validation).
- Rien n'est jamais écrasé (« nom (2) »), la suppression passe par la Corbeille, déplacements/renommages/créations/imports sont **annulables** (Ctrl+Z). Les programmes et scripts (.exe, .bat…) ne s'ouvrent pas depuis ici.

## Profils locaux : CEO, Dev, Friends

Au premier lancement (ou via Réglages → CHANGER DE PROFIL) E.N.O.S. demande qui utilise ce PC. Le profil remplace l'ancienne règle « 127.0.0.1 = accès total ».

| Profil | Accès |
|---|---|
| **CEO** | Tout, y compris API Control Panel et Notes de frais (privées). Code requis. |
| **Dev** | Tout sauf API Control Panel et Notes de frais : Deep System Cleaner, Google, Agenda, et tout le module Terna (Hub, Sync, Scènes Godot, Dev Manager). Code requis. |
| **Friends** | Agenda vierge, Éditeur PDF, Studio média, Outils rapides (dépenses partagées…), Syllabus Scanner, assistant IA. Modules Système/PC et Développement masqués. Sans code. |

- **Sans profil choisi = Friends** (le plus restrictif).
- Le profil est stocké par machine dans `data/role.json`, signé (HMAC, clé `data/role.key`) ; les codes sont hachés (PBKDF2, 200 000 itérations), 5 essais ratés = blocage 60 s. Descendre vers Friends ne demande pas de code.
- Côté interface : classes CSS `ceo-only`, `dev-ok`, `friends-ok` (`static/roles.css`) et `<body data-role>`. Côté serveur : `nasko_roles.RoleGate` refuse (403, ou fermeture WebSocket) toute route hors des droits du profil, même sur la machine locale. Toute nouvelle route doit être rangée dans `PREFIX_CAPS` (`tests/test_roles.py` échoue sinon).
- Les données sont séparées par profil (agenda, historique, clés Zeus/Moodle).
- C'est une barrière de profil, pas une protection contre quelqu'un qui modifie le code ou les fichiers sur sa propre machine.

## Agenda : timeline, glisser-déposer, urgence

- **Vues** : SEMAINE et JOUR (boutons en haut) ; ◂ ▸ avancent d'une semaine ou d'un jour. La ligne « maintenant » et les couleurs avancent toutes seules chaque minute.
- **Code couleur d'urgence** (tâches, rendus Moodle, contrôles ; les cours Zeus gardent leur rouge) : rouge pulsant = en retard, orange = moins de 2 h, jaune = moins de 24 h, vert = moins de 3 jours, bleu = plus tard, gris = fait. La liste des tâches affiche le temps restant.
- **Déplacer** : glisse une tâche perso sur la timeline (autre heure ou autre jour). Elle s'aligne sur 15 min, puis **s'aimante** sur le début ou la fin des autres éléments et sur l'heure actuelle (cible en trait plein et guide blanc). Tire le bord bas pour changer la durée. Les cours et rendus sont en lecture seule.
- **Planifier** : glisse une tâche de la liste (poignée ⠿) sur la timeline.
- **Terminer** : le rond sur la tâche (ou la case dans la liste) déclenche une gerbe de particules ; tout finir pour la journée en déclenche une grosse.
- **Clavier** : sur une tâche sélectionnée, ↑ ↓ la déplacent de 15 min, Maj + ↑ ↓ changent la durée, Espace la termine.
- « Réduire les animations » de Windows désactive les particules et les pulsations.

## Éditions physiquement isolées (build_release.py --edition)
`py build_release.py --version 3.2.0 --edition friends|dev|ceo` construit un installeur **par profil** (`ENOS-Setup-3.2.0-<édition>.exe`), dans `release\stage-<édition>` / `release\dist-<édition>` :
- **friends** (défaut) : le code Système/PC, Terna/Dev, Google, loisirs, Notes de frais et API Control Panel n'est pas livré (modules Python remplacés par des coquilles vides, scripts et feuilles de style supprimés, projets Godot des échecs retirés).
- **dev** : tout sauf API Control Panel et Notes de frais. **ceo** : tout.
- Le plafond est aussi appliqué au lancement (`enos_edition.json`) : un build Friends ne peut pas devenir Dev ni CEO, même avec un `role.json` copié d'un autre PC.
- Les scripts exclusifs d'une capacité sont déduits des routes qu'ils appellent (`nasko_roles.PREFIX_CAPS`) ; `release_editions.verify` contrôle la copie avant la compilation. Le build produit aussi le manifeste signé du Launcher (voir `dualpulse_site/LAUNCHER_API.md`).

## Couleurs d'accent, effet « shiny » et visite guidée
- **Réglages > Couleur d'accent** : Rouge (défaut), Violet, Doré, Vert, Bleu. L'accent recolore le thème rouge (Coreboard / Menace) et tous les modules (Agenda, Accueil, Profils, Syllabus…), sans redémarrage ; il est mémorisé sur l'appareil. Les modules lisent `--ac`, `--ac2`, `--acd`, `--ac3` (voir `static/accent.css`) : pour un nouveau module, utiliser ces variables au lieu d'un rouge codé en dur.
- **Effet brillant (shiny)** : case à cocher à côté des pastilles (`<html data-shiny="1">`). Un léger balayage lumineux traverse les bordures des cartes et des boutons principaux, et la marque en haut ; désactivé automatiquement si Windows est réglé sur « réduire les animations ».
- **Visite guidée** : au premier lancement (une fois le profil choisi et l'assistant de configuration terminé), un voile sombre met en lumière les éléments clés, un par un, avec une bulle explicative. **« Passer le tutoriel »** est toujours visible (Échap aussi ; ← → pour naviguer). Les étapes dont le module n'existe pas pour le profil (Friends…) sont sautées. Relançable depuis Réglages > « Revoir le tutoriel » ou `window.enosTour.start(true)`. Les textes sont dans `static/tour.js` (tableau `STEPS`).
- Tout fichier de `static/` appelé par `index.html` doit être dans `_STATIC_FILES` (`nasko_server.py`) : `tests/test_static_files.py` le vérifie.

## Gaming (Réglages > GAMING — CEO / Dev, tout désactivé par défaut)
- **Œil / ETO – accessibilité** : voix de l'IA on/off, bulle de texte au-dessus de la tête (sourds), clic sur la tête = zone de saisie au lieu du micro (muets).
- **Auto-Clipper IA** : tampon de 40 s (écran + audio) en mémoire ; un pic d'excitation audio (cri, rire, hurlement) ou le bouton « Clipper maintenant » exporte les 30 s précédentes en MP4 vertical 1080×1920 avec zoom dynamique (réticule au centre ou curseur), dossier `data/Clips`.
- **Babel Voice** : micro → transcription → traduction → voix ElevenLabs de TON clone, jouée sur un câble audio virtuel (VB-Cable à installer) que le jeu/Discord utilise comme micro. Le clone exige l'attestation « c'est ma propre voix ».
- **Anti-Tilt Coach** : mesure locale d'agrégats (souris saccadée, rythme de frappe, soupirs ; jamais quelles touches, aucun hook, aucun enregistrement), intervention d'ETO et replay des 5 s avant la mort (`data/Replays`).
- **BRB** : annonce ton absence et chronomètre. E.N.O.S. ne simule volontairement PAS le clavier/la souris (« Smart AFK ») : cela contourne la détection d'inactivité des jeux et expose au bannissement.

## Dépôt Intranet (bouton « DÉPÔT INTRANET » — CEO / Dev)
Module d'école d'informatique (piscines, rendus stricts). Windows : les dépôts sont ceux de `~/Nasko` dans WSL (comme le Dev Manager) ; ailleurs : un dossier local (`depot_local_root`, défaut `~/Nasko`).
- **Forge** : colle le lien d'agenda **.ics** de la Forge (comme Zeus/Moodle) dans l'onglet FORGE. Chaque rendu / piscine devient une carte avec compte à rebours à la seconde, barre de temps écoulé et urgence colorée (< 24 h, < 1 h) ; bandeau « prochaine échéance ». Lien secret : stocké en local, jamais réaffiché (seul l'hôte l'est), https obligatoire.
- **Éditeur Monaco** (le moteur de VS Code) : 4 espaces et auto-indentation, règle à 80 colonnes, vraies tabulations pour les Makefile, Ctrl+S.
- **Terminal Linux** (xterm.js) : WSL via ConPTY si `pywinpty` est installé (`pip install pywinpty`), sinon repli sans TTY (pas d'éditeurs plein écran). Strictement local, secrets d'Enos non hérités. Pas de terminal vers le bac à sable cloud (il exécute un programme à la fois, ce n'est pas un shell).
- **ENVOYER** : `git add <dossier>` → `git commit -m` → `git tag -a <nom>V<n+1> -m` (n = dernier tag `<nom>V<n>` local ou distant, V1 au départ) → `git push --follow-tags`. (« -ma » collé donnerait le message « a » : on utilise `-a … -m …`.) Si le push échoue, le commit et le tag restent locaux et l'état exact est affiché.
- **Git complet** : push, pull, commit seul, fetch, créer / basculer / supprimer / fusionner une branche (et annuler une fusion en conflit), supprimer un tag local ou distant, **CLONER** (`git clone`). Jamais de `--force`, `reset --hard` ni `clean`.
- **Sujet** : dépose le PDF du sujet → explication, contraintes, livrables et roadmap à cocher (liée au dépôt). **Entraînement** : les sujets sont gardés dans `data/depot.db` ; « refaire avec ETO » = un tuteur qui guide sans donner la solution.
- **Dépôt Shell** : un `.sh` glissé est déposé à la racine du dépôt courant (le dossier qui contient `.git`, à côté du code), converti en LF, rendu exécutable, jamais exécuté.

## Smart AFK (Ctrl+K → « AFK », édition gaming)
`nasko_afk.py` : armé → attend 5 s de calme (le temps de basculer sur le jeu) → toutes les 10-20 s, balayage de caméra de quelques pixels (avec retour) ou frappe légère ZQSD suivie de la touche opposée. **Kill-switch absolu** : Échap, mouvement manuel de la souris, clic, molette ou touche = arrêt instantané, touches relâchées. Sous Windows, ses propres événements sont écartés grâce au drapeau « injecté » du crochet bas niveau. Garde-fous : `afk_max_minutes` (120), `afk_only_process` (ex. `"VALORANT-Win64-Shipping.exe"`). Routes `/api/afk/*`, réservées au PC local et à la capacité « gaming ». ⚠ Les entrées simulées sont détectables : anti-triche kernel (Vanguard, EAC…) et CGU de nombreux jeux interdisent l'anti-AFK ; ne pas l'utiliser en ligne sans vérifier.

