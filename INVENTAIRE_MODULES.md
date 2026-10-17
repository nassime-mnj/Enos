# Inventaire des modules, accès et outils d'E.N.O.S.

*Document de référence pour définir un système de permissions par profil (CEO / Dev / Friends) et masquer dynamiquement des modules.
Établi à partir du code du dépôt : boutons du menu (`static/index.html`), routes de `nasko_server.py`, docstrings des modules, clés de `nasko_config.json`, application Android. Aucun code n'a été modifié pour produire ce document.*

## Contexte pour le lecteur

E.N.O.S. est un logiciel de bureau Windows : un serveur local (Python / FastAPI) affiché dans une fenêtre native (WebView2). Il sert aussi une interface web à un téléphone (Wi-Fi local, HTTPS) et une application Android. Il combine un assistant IA (LLM + voix), un agenda étudiant, des outils de création et d'organisation, des outils de développement pour un jeu Godot nommé « Terna », et des utilitaires système.

**Légende de l'accès actuel**
- 🖥 **PC seul** : classe `local-only` et/ou route `_LOCAL` (uniquement la machine qui exécute Enos).
- ⭐ **Premium** : classes `prem` / `dev-only`, routes `_IMG` / `_MOBILE` (le PC + les appareils « Eto Dev » approuvés).
- 🌐 **Ouvert** : tout appareil authentifié (route `_REMOTE` ou simple authentification).

---

## 0. Ce qui existe déjà pour contrôler les accès

| Mécanisme actuel | Où | Effet |
|---|---|---|
| Réseau : PC ou appareil distant | `is_local()` | Le PC (127.0.0.1) a toujours accès à tout. |
| Édition `dev` / `eto` | `nasko_team.edition()`, `/api/edition` | `dev` pour le PC et les appareils de confiance approuvés ; `eto` (grand public) pour tous les autres appareils distants. |
| Classes CSS | `local-only`, `remote-only`, `dev-only`, `prem` | Masquent les boutons **uniquement sur un appareil distant non approuvé**. Sur le PC, tout s'affiche toujours. |
| Dépendances d'API | `_LOCAL`, `_IMG`, `_MOBILE`, `_REMOTE` | Blocage réel côté serveur. Certaines routes ont leur garde à l'intérieur (`local_only`, `is_local`). |
| Aperçu grand public | `/api/edition/preview` | Bascule Eto Dev ↔ Eto sur un appareil approuvé (5 appuis sur le logo). |
| Profil Nassime / Raf | `profile_id`, `enos_profiles.json` | **Ne concerne que les chemins** (Godot, projet, entrepôt…), pas des droits. |
| Persona ENOS / ETO | `persona` | Personnalité et voix, pas des droits. |
| Racines de fichiers autorisées | `nasko_security.safe_path` | Dossiers utilisateur, projets, Binageux, Jeu Projet, dossiers accordés par le sélecteur natif. |

### Constats utiles pour concevoir les permissions
1. Il n'existe **que deux niveaux** : PC propriétaire / appareil approuvé `dev`, contre `eto`. Rien de plus fin.
2. **Sur le PC, rien n'est masquable aujourd'hui** : un profil « Friends » sur la même machine verrait tout.
3. Les modules récents (Éditeur PDF, Studio média, Syllabus Scanner, Outils rapides, notes de frais, barre d'état) sont **tous PC seul** et jamais proposés aux appareils distants.
4. Le lanceur d'accueil a déjà 5 catégories (École, Développement, Création, Système, IA & Loisirs) réutilisables comme grille de permissions.
5. **Point de sécurité** : `android/signing/nasko.jks` et `android/signing/mot_de_passe.txt` (clé de signature de l'APK et son mot de passe) ont été retirés du suivi Git ; l'ancienne clé est considérée comme compromise et remplacée par `enos-release.jks` (ignorée par Git).

---

## 1. Assistant IA, voix et personnalité

| Fonction | Détail | Accès |
|---|---|---|
| Chat texte | `/api/chat`, WebSocket `/ws/chat`, historique `/api/history`, mémoire (`nasko_memory`, SQLite) | 🌐 |
| LLM | `nasko_llm` : Anthropic ou tout serveur compatible OpenAI (Groq, etc.) | 🌐 |
| Personnalités | ENOS (antagoniste) et ETO (zen / streamer), `nasko_persona` | 🌐 |
| Filtre « sans religion » | `nasko_safe`, appliqué à toutes les sorties | auto |
| Phrases réflexes | `nasko_voice` : réponses vocales locales sans appel d'API | 🌐 |
| Voix | ElevenLabs (compte principal, compte de secours, compte ETO), cache `tts_cache` | 🌐 |
| Dictée / mode Live | `nasko_stt` : Whisper (API ou local), micro du PC | 🖥 |
| « Mains » du LLM | `nasko_actions` : seulement `OPEN_PIXELLAB` et `OPEN_ENV` (liste blanche) | 🌐 (exécuté sur le PC) |
| Vision | `vision`, `vision_raw` (Œil, notes de frais) | 🖥 |
| Mode discussion (6) | L'Œil d'E.N.O.S. en plein écran | 🌐 |
| Narration | `/api/narration/*` (voix pendant les tâches) | mixte |
| Mémoire d'apprentissage | Dataset d'échanges pour un futur fine-tuning | auto |

## 2. Agenda et vie étudiante

| Fonction | Détail | Accès |
|---|---|---|
| Agenda | Semaine Zeus + Moodle + tâches manuelles (`nasko_agenda`, `nasko_epita`) | 🖥 |
| IA proactive | `nasko_agent` : alertes à 48 h / 24 h / 3 h, cours à 15 min, carte « C'est l'heure » pour une tâche datée | 🖥 |
| Briefing quotidien | Silencieux, à l'heure choisie, texte déterministe | 🖥 |
| Syllabus Scanner (23) | PDF / Word / texte → examens, rendus, cours ; import annulable | 🖥 |
| Assistant de premier démarrage | `nasko_onboarding` : valide réellement les clés et liens avant écriture | 🖥 |
| Synchro agenda PC ⇄ mobile | `/api/agenda/sync` | ⭐ |

## 3. Arrière-plan et notifications

| Fonction | Détail | Accès |
|---|---|---|
| Icône de la zone de notification | `nasko_tray` (pystray) | 🖥 |
| Lancer avec Windows | `nasko_autostart` (clé HKCU Run) | 🖥 |
| Cartes natives à boutons | `nasko_toast`, protocole `enos-action://` (Fait / Reporter / Ouvrir) | 🖥 |
| Notifications de fin de tâche | `nasko_notify`, avec phrases vocales | 🖥 |
| Ne pas déranger | Réglages et menu de l'icône | 🖥 |
| Carte « Arrière-plan & notifications » | Dans les Réglages | 🖥 |

## 4. Documents et bureautique

| Fonction | Détail | Accès |
|---|---|---|
| Éditeur PDF (21) | Fusion, division, extraction, glisser-déposer, rotation, suppression | 🖥 |
| | Annotation, caviardage définitif, édition de texte, signature | 🖥 |
| | Filigrane, numérotation, compression, OCR, conversion Word / Excel / PowerPoint | 🖥 |
| | Chiffrement AES-256 et permissions, IA (chat, résumé, traduction) | 🖥 |
| Outils rapides (24) | Formateur JSON/XML, dépenses partagées, notes de frais (tickets → Excel) | 🖥 |
| Organisateur (19) | Explorateur annulable, ranger par type, **renommage par modèle** | 🖥 |
| Compression média (8) | Images (Pillow) et vidéos (FFmpeg) ; envoi possible depuis le téléphone | ⭐ (+ 🌐 pour le téléversement) |

## 5. Média, image, audio, vidéo

| Fonction | Détail | Accès |
|---|---|---|
| Studio média (22) | Conversion HEIC / WEBP, vidéo → MP3 / GIF, agrandissement net, débruitage audio | 🖥 |
| | Floutage de confidentialité, EXIF, pipette à couleurs, transcription, sous-titres | 🖥 |
| Traitement d'image (4) | Usine : PhotoRoom, Sprite Slicer (Playwright), colis, livraison | ⭐ |
| Visualiseur d'animation (5) | Explorateur borné à Binageux / Jeu Projet | ⭐ |
| Laboratoire audio (9) | Vidéo → WAV, détection de SFX par silences, éditeur d'onde | ⭐ (3 routes 🖥) |
| Gérer les colis (7) | Colis en attente | ⭐ |
| Mode Chill (11) | Lecteur ambiant (Stockage/Ambiance_Audio) | 🌐 (1 route 🖥) |
| YouTube Uploader (16) | API YouTube v3 (OAuth) | 🖥 |

## 6. Développement et projet de jeu (Terna)

« Terna » n'est pas un dépôt codé en dur : c'est le **projet Godot actif** (`project_dir`). Il est cité dans le prompt système, le vocabulaire Whisper et `godot_neon/LISEZ_MOI.md`. L'accès passe par le dossier du projet, le dépôt Git que l'utilisateur configure et l'entrepôt partagé.

| Fonction | Détail | Accès |
|---|---|---|
| Projets (liste active) | `/api/projects`, `/api/files`, explorateur limité aux projets | 🖥 |
| Scènes Godot / F6 (3) | Lancement sans éditeur, visu à distance, arrêt automatique | 🌐 (lancement depuis le téléphone autorisé) |
| Environnement (1) | PowerShell + Claude + Godot + Aseprite, lancement échelonné | 🖥 (déclenchable via le chat) |
| PixelLab (2) | Chrome privé + inscription temporaire | 🖥 (déclenchable via le chat) |
| ElevenLabs session privée | Navigation privée + inscription | 🖥 |
| Synchroniser le projet | `nasko_git` : add → commit → pull → push, résolution de conflits, branche de sauvegarde | 🖥 |
| Sync Godot | `nasko_godotsync` : diffusion de mise à jour à l'associé, accepter / cloner / pull | 🖥 |
| Hub équipe (14) | Entrepôt partagé (colis, fichiers), chat développeurs (pont WebSocket vers le PC de l'associé), git | ⭐ (`dev-only`) |
| Construire un colis | Dossier d'export → zip, envoi vers le projet | 🖥 |
| Dev Manager | WSL Ubuntu, dépôts WSL, git clone, VS Code, scripts `.sh` | 🖥 |
| Appeler l'assistant | PowerShell + Claude dans le dossier d'Enos | 🖥 |
| Diagnostic Godot | `nasko_godotdiag` : FPS et réglages sans dégrader l'image | 🖥 |
| Site Web | Serveur Dual Pulse : démarrage, état, accès | 🖥 |
| Encastrement d'un jeu | `nasko_embed` : plateau 3D Godot encastré (`chess_board_exe`) | 🖥 |

## 7. Jeux, loisirs et compagnon

| Fonction | Détail | Accès |
|---|---|---|
| Défi : échecs (Stockfish) | `nasko_chess` (37 routes), `nasko_boss`, `nasko_coach` | 🖥 |
| Choc des Titans | `nasko_titans` : match ENOS contre ETO, « guerre des commentaires » | 🖥 |
| Apprentissage échecs | `opening_manager`, `/api/study`, ouvertures PGN animées par ETO | 🖥 |
| Thèmes visuels du plateau | `nasko_visualtheme` : le LLM choisit une esthétique | 🖥 |
| Échecs sur téléphone | `nasko_mobchess` : le Stockfish du PC prêté au mobile | ⭐ |
| Œil de bureau | Widget Godot flottant (`nasko_pet`, WebSocket `/ws/pet`) | 🖥 |
| Aspirateur | L'Œil bascule vers l'autre écran | 🖥 |
| Écoute Discord | `nasko_loopback` : capture l'audio de sortie du PC | 🖥 |

## 8. Système et PC

| Fonction | Détail | Accès |
|---|---|---|
| Système (20) | Profils de performance, Turbo Boost, capteurs CPU / GPU / RAM, diagnostic | 🖥 |
| Deep System Cleaner (17) | Scan disque, niveaux de risque, suppression guidée | 🖥 |
| API Control Panel (18) | Quotas et consommation des clés (ElevenLabs, Groq, OpenAI, Anthropic) | 🖥 |
| Gestion Google (12) | Onglets Chrome, miniatures, fermeture (CDP + extension) | 🖥 |
| Contrôle mobile | adb + scrcpy, un seul téléphone Android | 🖥 |
| Alimentation | Veille, éteindre, rester éveillé, Wake-on-LAN, relais de réveil | mixte |
| Mise à jour | OTA signée (`nasko_ota`) et reconstruction locale (`updater`) | 🖥 |
| Outils externes | Téléchargement d'adb, scrcpy, Stockfish (`nasko_tools`) | 🖥 |
| Quitter, veille, éteindre | Boutons du menu | 🖥 |

## 9. Accès distant, mobile et sécurité

| Fonction | Détail | Accès |
|---|---|---|
| Accès téléphone | HTTPS local, autorité « N.A.S.K.O Local CA », QR code, code d'accès | 🖥 |
| Appairage en un scan | `nasko_pairing` : paquet chiffré (clés, liens, empreinte) | 🖥 |
| Appareils de confiance | Jetons permanents (empreinte SHA-256), IP de confiance, révocation | 🖥 |
| Éditions Eto / Eto Dev | Approuver un appareil = lui donner l'édition `dev` | 🖥 |
| Sécurité (13) | Clé d'appairage (DPAPI), chemins autorisés, journal, limiteur de débit, AES-256-GCM | 🖥 (3 routes 🌐) |
| Sync PC ⇄ mobile (10) | Envoi de fichiers, liens temporaires `/dl`, QR | 🖥 (envoi : 🌐) |
| Visu à distance | `nasko_screen` : fenêtre des scènes Godot | 🌐 |
| Application Android | Mode autonome (Groq, ElevenLabs, .ics) et mode connecté au PC ; coffre Android Keystore | — |
| Modules mobiles | Agenda, Œil, photos, dossiers, nettoyeur, contrôle API, thèmes, échecs | — |

## 10. Réglages et profils

| Onglet | Contenu | Accès |
|---|---|---|
| Thèmes | Langue, phrase d'accueil, thème, animations, couleur principale | 🌐 (langue et accueil : 🖥) |
| Profil | Nassime / Raf, chemins, nom affiché | 🖥 |
| Appareils | Appareils de confiance | 🖥 |
| Cet appareil | Édition, oublier l'appareil | 🌐 |
| Arrière-plan et notifications | Icône, démarrage, briefing, ne pas déranger | 🖥 |

## 11. Clés, comptes et accès externes

Les secrets vivent dans `nasko_config.json` (ignoré par Git), sauf indication contraire.

| Catégorie | Clés / accès | Utilisé par |
|---|---|---|
| LLM | `llm_api_key`, `llm_provider`, `llm_base_url` ; clés suivies : `anthropic_api_key`, `openai_api_key`, `groq_api_key` | Chat, Syllabus, PDF-IA, notes de frais, résumés |
| Transcription | `stt_api_key`, `stt_base_url`, `stt_model` | Dictée, Studio (transcription, sous-titres) |
| Voix | `elevenlabs_api_key`, `elevenlabs_backup_api_key`, `elevenlabs_eto_api_key`, identifiants de voix | Voix ENOS, secours, ETO |
| Scolaire | `zeus_ics_url`, `moodle_ics_url`, `moodle_token`, `moodle_base_url` | Agenda |
| Vidéo | OAuth YouTube (fichiers de jeton locaux) | YouTube Uploader |
| Réseau | `network_access_code`, clé d'appairage (DPAPI), jetons d'appareils (empreintes) | Accès téléphone |
| Appareils | `adb_device_id`, `trusted_ips` | Contrôle mobile, IP de confiance |
| Équipe | `warehouse_dir`, canal du chat (`chat_channel_open`, `chat_direct`) | Hub équipe, Sync Godot |
| Mise à jour | `update_manifest_url`, clé publique `ota_pubkey.txt` | OTA |
| Outils locaux | `godot_path`, `aseprite_path`, `chrome_path`, `ffmpeg_path`, `libreoffice_path` | Divers |
| Hors configuration | Comptes web PhotoRoom, Sprite Slicer, PixelLab (via Chrome) ; identifiants Git du poste | Traitement d'image, projet |
| **À risque** | `android/signing/nasko.jks` et `mot_de_passe.txt` **retirés du suivi ; clé remplacée** | Signature de l'APK |

## 12. Projets annexes et scripts

| Élément | Rôle |
|---|---|
| `dualpulse_site/` | Site web FastAPI avec administration et assistant |
| `godot_chess/`, `godot_eye/`, `godot_neon/` | Plateau d'échecs, Œil de bureau, effet néon pour Terna |
| `installer/`, `build.bat`, `build_release.py`, `construire_apk.py` | Construction de l'exe et de l'APK |
| `generer_voix.py`, `creer_voix_eto.py`, `renommer_audio.py` | Voix locales |
| `configurer_llm.py`, `envoyer_cles.py`, `envoyer_apk.py` | Configuration et déploiement |
| `wake_relay.py`, `diagnostic_reveil.py` | Réveil à distance |
| `creer_raccourci.py` | Raccourcis Bureau et démarrage avec Windows |

## 13. Prévu, pas encore intégré

Refonte visuelle de l'Agenda (timeline, glisser-déposer magnétique, particules, code couleur de l'urgence) · Sondages et listes collaboratives sur Vercel + Supabase/Firebase (structure côté Enos seulement) · Time-blocking IA · Jauge de charge mentale · Mode Focus · Mode Lecture.

---

## Limites de ce document

Les niveaux d'accès sont déduits des décorateurs et des gardes dans le code, pas d'un test sur appareil distant. Les boutons sans classe de restriction (Environnement, PixelLab, Tests F6, Mode discussion, Chill, Compression, Réglages) restent visibles sur un téléphone ; leurs routes sensibles sont verrouillées côté serveur.
