# ENOS — notes de passation pour Claude

Projet du propriétaire (francophone) : **E.N.O.S.**, application Android (WebView) + version PC, avec échecs, jeux 3D, montages vidéo (Chess Edit, MultiEdit), bots à personnalité, et le site du studio **DualPulse**.
Réponds et rédige en **français** (interface, commentaires, rapports). Livre l'APK à chaque version.

## Où en est le code
- Tout le travail récent est sur la branche **`ccr-a6e76697-f4pk5u`** (pas encore fusionnée dans `main`) :
  `git fetch origin && git checkout ccr-a6e76697-f4pk5u`
- Version : `android/version.txt` (= n° de build ; l'APK s'appelle 1.(n+1)). Journal détaillé de chaque version : **`android/MOBILE.md`** (lire les entrées 1.117 → 1.130 pour le contexte récent).
- APK : construit par la CI à chaque push (`.github/workflows/mobile-apk.yml`), publié en pré-release `mobile-test` → `ENOS-test.apk` ; `assets/build_info.txt` (généré par la CI) contient la branche et le commit.
- Mise à jour web sans réinstaller : `WebUpdater.java` superpose les fichiers web depuis GitHub (compare le commit de l'APK à celui de la branche).

## Structure
- `android/assets/mobile/` : l'application web (index.html, `js/`, `css/`, `img/`, `audio/`, `vendor/`). Java : `android/src/com/nasko/app/`.
- `static/learn/` : version PC ; **après toute modification mobile partagée, lancer `python build_learn_data.py --sync`** (liste des fichiers copiés dans `sync_pc()`).
- `dualpulse_site/` : site public du studio (FastAPI). Public **en anglais et anonyme** (aucun nom, aucune mention d'E.N.O.S. : voir l'en-tête de `content.py`) ; CSP stricte (pas de script/style inline). Tests : `python -m pytest dualpulse_site/tests` (le test `test_metrics` échoue seulement en suite complète, déjà avant).

## Tests
- Playwright : `android/tests/t_*.py`. Serveur statique requis : `python -m http.server 8802 --bind 127.0.0.1` dans `android/assets/mobile` (et 8803 dans `static/learn` pour les tests PC). Chromium : `/opt/pw-browsers/chromium` en cloud (variable `CHROMIUM` pour `t_chessedit.py`).
- Node : `node android/tests/node/*.test.js`.
- Échec connu et ancien : `t_botchat.py` « ETO Brillant : avatar sans illustration ».

## Règles techniques à retenir
- Canvas « tainted » dans le WebView : toute image dessinée dans un rendu vidéo doit être en data: URI → si on ajoute une image dans `img/bots`, `img/badges`, `img/chess`, `img/icons`, `img/roster` : relancer `python android/tools/gen_render_assets.py`.
- `fetch` est interdit par la CSP de l'app (`connect-src 'none'`) : les voix sont des scripts base64 chargés à la demande (`audio/voice/enos/*.js`, `js/voice_index.js`).
- Le « cortex d'E.N.O.S. » (`js/enos_mind_view.js`) ne doit **jamais nommer le moteur** (illusion voulue).

## Fonctionnalités récentes (fichiers clés)
- Mind games E.N.O.S./Mittens : `js/mind_games.js`, `js/mind_lines.js` ; voix ElevenLabs d'E.N.O.S. (194 phrases + 2 en v3).
- Bot Raph (800 → 1200 → E.N.O.S. prend le relais) : `raphCheck`/`raphTakeover` dans `js/m_defis.js`.
- Thèmes de partie : E.N.O.S. (HUD rouge + OST) et ETO (blanc, bleu cyan ciel, nuages + OST) : `css/enos_theme.css`, `enosMode`/`etoMode` dans `js/m_defis.js` ; pensée d'ETO + « Pourquoi ? » sur les gaffes : `js/eto_mind.js`.
- Chess Edit : rendu cinéma (profondeur de champ, projecteur, étalonnage) dans `js/chess_edit_gl.js` / `js/chess_edit_render.js`.
- MultiEdit (rendu hors ligne 4K, série sauvegardée en IndexedDB, montage en arrière-plan) : `js/multiedit_render.js`, `js/m_multiedit.js`.

## En attente
- Pack « The complete pack for starting chess editing » (icônes HD, sons de plateau, pièces) : **archive chiffrée**, attendre le mot de passe du propriétaire puis l'intégrer au Chess Edit.
- ElevenLabs : compte gratuit (≈ 1 400 caractères restants sur le mois en cours). La clé est sur le PC du propriétaire (`nasko_config.json`) ; ne jamais lancer de génération payante sans son accord.
- Les musiques fournies (Rocket League, FNAF, Chainsaw Man, « fish ») sont pour un usage perso : à remplacer avant toute diffusion publique.
- Site DualPulse : nouvelle version « machine qui se construit seule » (`static/js/assembly.js`) poussée mais **pas encore déployée**.
- Anciens chantiers : jeux vague 2 (ping-pong, basket), lot 6 (Forge Edu, Chess Edit Engine, Godot QA).
