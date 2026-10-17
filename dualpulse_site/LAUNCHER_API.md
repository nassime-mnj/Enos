# Dual Pulse Launcher — backend (Phase 1)

API `/launcher/v1` du site Dual Pulse (`dualpulse_site`). Tests : `py tests/test_launcher.py`.

## Configuration (variables d'environnement)
| Variable | Rôle |
|---|---|
| `DP_ADMIN_TOKEN`, `DP_ADMIN_PATH` | jeton et chemin d'administration (existants) : création du CEO, publication des versions |
| `DP_MANIFEST_PUBKEY` | clé publique Ed25519 (base64) des manifestes = contenu de `ota_pubkey.txt`. Sans elle, la publication est désactivée |
| `DP_TOKEN_KEY` | clé privée Ed25519 (base64) des jetons ; sinon `data/token_ed25519.key` est créé au premier démarrage (0600) |
| `DP_REQUIRE_CEO_TOTP=1` | l'administration CEO exige la double authentification activée |
| `DP_R2_ENDPOINT`, `DP_R2_BUCKET`, `DP_R2_ACCESS_KEY`, `DP_R2_SECRET_KEY` | Cloudflare R2 : liens présignés SigV4 de 5 min |
| `DP_STORAGE_DIR` | stockage local (développement) : liens signés servis par `/launcher/v1/blob/…` |

## Rôles (hiérarchie stricte `friends < dev < ceo`)
- **Aucune inscription libre** : on s'inscrit avec un code d'invitation généré par le CEO (usage unique, 1 à 90 jours, rôle `friends` ou `dev`). Le rôle vient de l'invitation, jamais de l'inscrit.
- **Le CEO n'existe que par le jeton d'administration du serveur** (`POST <admin>/api/launcher/ceo`, une seule fois). L'API ne peut ni créer, ni modifier, ni rétrograder un CEO.
- Le rôle est relu en base à chaque requête : changement de rôle, désactivation, déconnexion globale ou changement de mot de passe prennent effet immédiatement.
- Mots de passe : scrypt, 10 caractères minimum ; 5 échecs = compte bloqué 15 min ; limitation par IP ; réponses identiques pour compte inconnu / mauvais mot de passe.
- Sessions : jeton d'accès Ed25519 de 15 min + jeton de rafraîchissement de 30 j, rotatif (un jeton rejoué révoque toute la session). TOTP (RFC 6238) avec refus du rejeu.
- **Attestation de rôle** (`POST /auth/attest`, 14 j) : preuve signée que le Launcher donne à Enos ; vérifiable hors ligne avec `GET /keys` (le module `app/launcher/tokens.py` est copiable tel quel dans Enos).

## Routes
| Route | Accès | Rôle |
|---|---|---|
| `POST /auth/register` `/login` `/refresh` `/logout` | public | sessions |
| `POST /auth/logout-all` `/attest` `/password` `/totp/setup` `/totp/enable` · `GET /me` | connecté | compte |
| `GET /keys` | public | clés publiques (jetons, manifestes) |
| `POST/GET/DELETE /invites` · `GET /users` · `PATCH /users/{id}` · `POST /users/{id}/revoke-sessions` · `PUT /products/terna/status` | **ceo** | gestion |
| `GET /catalog` | public (vitrine) ou connecté (selon le rôle) | produits, version, patch notes |
| `GET /manifest/{produit}/{canal}` | selon le canal | manifeste signé |
| `GET /download/{produit}/{canal}/{version}/{n}` | selon le canal | lien R2 présigné (5 min) + SHA-256 |
| `POST <admin>/api/launcher/releases` · `…/{id}/yank` · `GET` | jeton d'administration | publication |

## Distribution
- `enos` : canaux `stable` (friends), `dev` (dev), `ceo` (ceo) ; chaque rôle lit son canal et les inférieurs. `terna` : `alpha` (dev) et `public` (friends, seulement quand le statut passe à `released`) ; tant que Terna est en `wishlist`/`alpha`, le catalogue le présente comme « à venir » et aucun binaire n'est accessible aux Friends.
- Manifeste = JSON canonique signé Ed25519 par le CEO (`build_release.py`) ; le serveur vérifie la signature, la forme (chemins sûrs, SHA-256) et **refuse un retour en arrière de version** avant de l'accepter. Il ne détient jamais la clé privée.

## Deux modes de manifeste
- `"mode": "installer"` (défaut) : `launch` = installeur silencieux exécuté par le Launcher (bouton METTRE À JOUR, invite UAC).
- `"mode": "files"` : les `files` sont les fichiers de l'application elle-même (chemins relatifs à son dossier d'installation) et `run` = son exécutable. Le Launcher les télécharge **en arrière-plan** dans un dossier de staging (seuls les fichiers modifiés), signale la mise à jour à l'application par un fichier flag, et ne remplace les fichiers qu'après la fermeture volontaire de l'application (voir `launcher/README.md`, « Mises à jour automatiques »). Le serveur refuse `launch` dans ce mode, exige que `run` soit un des fichiers, et refuse les chemins protégés (`data/…`, `nasko_config.json`, `.update-…`). Construction : `py build_release.py --version 3.2.0 --edition dev --files-manifest`, puis `rclone sync <dossier> r2:<bucket>/enos/<canal>/<version>/files/` et `publish_release.py`.

## Publier une édition
1. `py build_release.py --version 3.2.0 --edition dev --base-url …` → `release\installer\ENOS-Setup-3.2.0-dev.exe` + `launcher-enos-dev-3.2.0.manifest.json` / `.sig`.
2. Téléverser l'installeur dans R2 sous la clé du manifeste (`enos/dev/3.2.0/ENOS-Setup-3.2.0-dev.exe`).
3. `set DP_ADMIN_TOKEN=…` puis `py dualpulse_site\tools\publish_release.py --server https://… --manifest release\installer\launcher-enos-dev-3.2.0.manifest.json`.

## Pas encore fait (phases suivantes)
Launcher Tauri (Phase 3), news / wishlist (Phase 4), lore éditable avec historique (Phase 5), Discord OAuth. Côté Enos, brancher la vérification de l'attestation à la place du choix local de profil.
