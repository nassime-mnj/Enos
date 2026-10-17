# Dual Pulse Launcher (Tauri 2)

Application de bureau Windows : **connexion** (comptes sur invitation, rôles CEO / Dev / Friends), **catalogue** des logiciels avec **bannières**, **installation / mise à jour / lancement** d'E.N.O.S., vitrine **TERNA** (« Coming Soon », liste de souhaits, jamais de bouton Jouer).
Le serveur est `dualpulse_site` (API `/launcher/v1`, voir `dualpulse_site/LAUNCHER_API.md`).

```
launcher/
  ui/          interface (HTML / CSS / modules JS, sans bundler ni dépendance npm) — chargée telle quelle par Tauri
  engine/      moteur Rust sans Tauri (testable seul) : manifeste signé, téléchargement reprenable, installation, lancement
  src-tauri/   coque native Tauri 2 : coffre d'identifiants Windows, commandes install/lancement, fenêtre sans bordure
  tests/e2e/   test de bout en bout : vrai serveur Dual Pulse + vraie interface (navigateur), 3 profils
```

## Lancer en développement
Prérequis : Rust (rustup), WebView2 (déjà présent sous Windows 11), `cargo install tauri-cli --version "^2"`.
```
cd launcher
cargo tauri dev          # fenêtre native, interface lue dans ui/
```
Dans un simple navigateur (aperçu) : `py -m http.server 8801 --directory ui` puis http://127.0.0.1:8801 — secrets en sessionStorage, téléchargement + vérification SHA-256 réels, **sans** installeur ni lancement.

## Configuration avant la mise en production
1. `ui/js/config.js` : `DEFAULT_SERVER` = domaine du serveur Dual Pulse (modifiable ensuite depuis l'écran de connexion).
2. `src-tauri/manifest_pubkey.txt` : clé publique Ed25519 des manifestes (= `ota_pubkey.txt` = `DP_MANIFEST_PUBKEY` du serveur). Elle est compilée dans le Launcher : **un manifeste non signé par cette clé est refusé**, même si le serveur est compromis.
3. Serveur : `DP_LAUNCHER_ORIGINS` si vous changez l'origine de la fenêtre (par défaut `tauri://localhost`, `http(s)://tauri.localhost`).
4. Icône : `src-tauri/icons/` (générée depuis `ui/logo.svg`).

## Construire l'installeur du Launcher
```
cd launcher
cargo tauri build        # -> target/release/bundle/nsis/Dual Pulse Launcher_0.1.0_x64-setup.exe  (installation « utilisateur », sans droits admin)
```
Pour éviter SmartScreen : signer l'exécutable (certificat de signature de code) — pas encore configuré.

## Distribution : le Launcher est embarqué dans l'installeur d'E.N.O.S.
`py build_release.py --version X.Y.Z` (à la racine du dépôt, sous Windows) fait désormais tout d'un coup :
1. compile E.N.O.S. (PyInstaller) **puis le Launcher** : `cargo tauri build --no-bundle` (exécutable seul, dans `release/launcher-target`) ;
2. **synchronise `src-tauri/manifest_pubkey.txt` sur `ota_pubkey.txt`** (la clé publique est compilée dans le Launcher : s'il en avait une autre, il refuserait tous les manifestes) ;
3. vérifie le binaire (exécutable Windows valide, aucune donnée personnelle : les chemins locaux sont masqués à la compilation) ;
4. passe `/DLauncherExe=…` à Inno Setup : `installer/enos.iss` installe le Launcher dans `Program Files\Dual Pulse Launcher` (dossier protégé), **crée les raccourcis Menu Démarrer / Bureau vers le Launcher** (plus vers `ENOS.exe`) et propose de le lancer en fin d'installation. La tâche de fond d'E.N.O.S. (option « démarrage de Windows ») reste lancée directement.
Prérequis : Rust (`rustup`), `cargo install tauri-cli --version "^2"`, WebView2, Inno Setup 6. Sans eux le build s'arrête avec un message clair (jamais d'installeur sans Launcher par accident) ; `--skip-launcher` produit un build de **développement** sans Launcher, à ne pas distribuer.
Mises à jour : quand le Launcher lance l'installeur en silence (mode « installer »), l'installeur **ne remplace pas le Launcher s'il tourne** (il serait sinon en train de s'écraser lui-même) ; le nouveau Launcher est posé à l'installation suivante, Launcher fermé. L'`AppId` Inno ne doit JAMAIS changer : c'est lui que le Launcher cherche dans le registre pour retrouver E.N.O.S.
L'installeur est en **anglais ou français** selon la langue de Windows. Tests : `python3 tests/test_installer.py` (le script `.iss` est contrôlé par un préprocesseur simulé ; la compilation réelle demande Windows).

## Tests
```
cd launcher && cargo test -p dp-engine        # 15 tests : compatibilité JSON canonique + signature avec le serveur Python, reprise de téléchargement, corruption, annulation, lien expiré…
bash launcher/tests/e2e/start.sh e2e.py       # interface + serveur réels (Playwright), CEO / Friends / Dev
```

## Mises à jour automatiques (E.N.O.S., Eto, TERNA)
Les applications ne se mettent plus à jour elles-mêmes : c'est le Launcher (Réglages › Compte › « Mises à jour automatiques »).
1. **Arrière-plan** : toutes les 30 min (et au démarrage), l'interface interroge l'API (R2 via liens présignés) ; si un manifeste `mode: "files"` plus récent existe, le moteur Rust le télécharge **en silence** dans `staging/<produit>/<version>/` — seuls les fichiers dont l'empreinte a changé — même si l'application ou le jeu tourne. Option activée : fermer la fenêtre cache le Launcher dans la zone de notification.
2. **Signal non intrusif** : quand le staging est complet et vérifié (signature Ed25519 + SHA-256), le Launcher écrit `update-ready.json` dans `%LOCALAPPDATA%\DualPulse\signals\<produit>\` ; E.N.O.S. l'interroge et affiche une bannière discrète « Une mise à jour est prête. [Redémarrer pour appliquer] [Plus tard] ». **Le Launcher ne ferme jamais une application de force.**
3. **Application** : « Redémarrer » → E.N.O.S. écrit `update-apply.json` puis se ferme volontairement ; le Launcher voit la fermeture (`running.json` + PID), re-vérifie les fichiers, remplace (journal + retour arrière automatique en cas d'échec, données de l'utilisateur intouchables), puis relance l'application. « Plus tard » : rien n'est touché ; si l'application est lancée depuis le Launcher avec une mise à jour prête, elle est appliquée avant le lancement.
Contrat des fichiers-signal : `engine/src/signals.rs` et `nasko_update_signal.py` (côté E.N.O.S.).

## Sécurité (résumé)
- Le jeton d'accès reste en mémoire ; le jeton de rafraîchissement est dans le **Gestionnaire d'identifiants Windows** (crate `keyring`), jamais dans un fichier.
- Le Launcher **re-vérifie** chaque manifeste (signature Ed25519 + chemins sûrs + SHA-256) avant d'installer ; seuls les liens `https://` (ou 127.0.0.1) sont téléchargés ; un fichier au nom définitif est toujours complet et conforme.
- La page n'affiche jamais de HTML venant du serveur (tout passe par `textContent`) ; CSP stricte (`script-src 'self'`).
- Seuls les liens `https://` s'ouvrent dans le navigateur ; les exécutables lancés sont limités au dossier d'installation.

## Pas encore fait
Mise à jour automatique du Launcher lui-même (`tauri-plugin-updater` + manifeste signé), signature de code Windows, installation sans UAC (l'installeur d'E.N.O.S. demande aujourd'hui les droits administrateur), TERNA jouable (jeu en développement), lore éditable (Phase 5).
