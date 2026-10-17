# Dual Pulse Launcher — proposition d'architecture

## 1. Stack recommandée : **Tauri 2 + front web (React/Svelte + Framer Motion/GSAP)**
| Critère | Tauri | Electron | Godot |
|---|---|---|---|
| Taille installeur | ~8–15 Mo | ~100–150 Mo | ~40–60 Mo |
| RAM au repos | ~60–100 Mo (WebView2) | ~200–350 Mo | ~100 Mo |
| UI « Battle.net » (vidéo, blur, animations) | Excellent (CSS/Canvas/WebGL) | Excellent | Possible mais tout est à refaire (listes, texte, accessibilité) |
| Moteur d'install natif (hash, reprise, MAJ en tâche de fond) | Rust : rapide, sûr | Node : OK, plus lourd | À écrire à la main |
| Réutilisation de l'existant | Front web = même savoir-faire que l'UI d'Enos ; WebView2 déjà utilisé | idem | Aucune |
| Auto-MAJ du launcher | `tauri-plugin-updater` (signatures Ed25519, comme `nasko_ota.py`) | `electron-updater` | à écrire |

**Choix : Tauri.** Même moteur d'affichage qu'Enos (WebView2), installeur léger, backend Rust pour les téléchargements. Godot est tentant
(thème « jeu ») mais mauvais pour une application de gestion (listes, formulaires, mises à jour). Electron marcherait aussi,
mais pèse 10× plus pour le même rendu.

## 2. Découpage
```
Launcher (Tauri)
 ├─ UI (web) : Accueil/News · Logiciels (Enos) · Jeux (Terna) · Dev (lore, visible Dev/CEO) · Compte
 ├─ Cœur Rust : auth (stockage du jeton dans le coffre Windows), moteur d'installation, lanceur de processus
 └─ Auto-MAJ du launcher lui-même (manifeste signé)

Serveur Dual Pulse (FastAPI, existant : dualpulse_site/) — à étendre avec une API /launcher/v1
 ├─ Auth : comptes, rôles (ceo|dev|friends), jetons
 ├─ Catalogue : produits, canaux, versions, patch notes
 ├─ Distribution : manifestes signés + URL de téléchargement
 └─ News : bannières datées, ciblées par rôle
Stockage des binaires : objet stocké derrière CDN (Cloudflare R2 / GitHub Releases pour les Friends)
```

## 3. Authentification et rôles — **la décision clé**
Aujourd'hui le rôle est choisi **localement** dans Enos (`data/role.json`) : suffisant comme confort, **pas** comme sécurité.
Dans le Launcher, le rôle doit venir du **serveur** :
1. Comptes (email + mot de passe Argon2, ou lien magique ; plus tard OAuth Discord/Google pour les Friends).
2. Le serveur porte le rôle dans la base (`users.role`), attribué par le CEO via la page admin existante.
3. Connexion → **jeton d'accès court** (15 min, JWT signé) + **jeton de rafraîchissement** (30 j, révocable) conservé dans Windows Credential Manager.
4. Le serveur ne délivre l'URL d'un binaire **que** si le rôle le permet ; les liens sont **signés et expirent** (5 min).
5. Le Launcher écrit le rôle prouvé (jeton signé) pour Enos : Enos remplace son choix local par ce rôle, d'où un seul point d'autorité. Hors-ligne : dernier rôle valide en cache, durée limitée (ex. 14 j).
6. Le rôle **CEO** ne se « demande » jamais : il n'existe que sur ton compte, avec 2FA (TOTP).

## 4. Catalogue et canaux de distribution
| Produit | Canal | Qui le reçoit |
|---|---|---|
| Enos Friends (build épuré, sans Terna/Système) | `stable` | friends, dev, ceo |
| Enos Dev (build complet, sans Notes de frais/API Control Panel) | `dev` | dev, ceo |
| Enos CEO | `ceo` | ceo |
| Terna | `wishlist` (aucun binaire) puis `alpha` (dev/ceo) puis `public` | selon l'état |

Un **build par profil** est plus sûr que « un seul build qui masque » : le code Terna/Système n'est jamais sur le PC d'un Friend.
`build_release.py` (liste blanche, détection de fuites, manifeste signé) sert déjà de base ; il suffit de lui ajouter un paramètre `--edition`.

### Manifeste de version (signé Ed25519, comme `nasko_ota.py`)
```json
{ "product": "enos", "channel": "dev", "version": "3.2.0", "released": "2026-10-20",
  "notes": "- Nouveau : profils…", "min_launcher": "1.0.0",
  "files": [ { "path": "ENOS.exe", "sha256": "…", "size": 41234567, "url": "https://…" } ],
  "launch": "ENOS.exe", "signature": "base64…" }
```
Le Launcher compare les `sha256` fichier par fichier et ne télécharge que ce qui a changé (patch par fichier ; delta binaire possible plus tard).

## 5. Moteur d'installation
- Téléchargement HTTP avec **reprise** (Range), 3 flux parallèles, vérification SHA-256, écriture dans `.part` puis renommage atomique.
- Installation dans `%LOCALAPPDATA%\DualPulse\Games|Apps\<produit>` **sans droits admin** (plus d'invite UAC, contrairement à l'installeur actuel).
- Mise à jour en arrière-plan : vérification toutes les 30 min, téléchargement dans un dossier de préparation, bascule à la fermeture de l'app (le fichier verrouillé n'est jamais écrasé).
- Retour arrière : on garde la version précédente tant que la nouvelle n'a pas démarré une fois correctement.
- Lancement : le Launcher démarre `ENOS.exe` en lui passant le rôle et le jeton ; surveille le processus (bouton Lancer → En cours).
- Données utilisateur (`data/`, `nasko_config.json`) séparées du dossier d'installation : jamais écrasées.

## 6. Écrans
1. **Accueil / News** : carrousel de bannières (image/vidéo, titre, lien), venant de `/launcher/v1/news?role=…`, avec dates de début/fin et ciblage par rôle. Mise en cache locale.
2. **Logiciels** : Enos avec statut (Installer / Lancer / Mettre à jour + progression) et patch notes par version.
3. **Jeux** : Terna en mode **Coming Soon / Wishlist** : vidéo teaser en fond, pitch, galerie, bouton « Suivre le projet » (inscription e-mail ou Discord), **aucun bouton Jouer**. Le statut du jeu est un champ du catalogue (`status: wishlist|alpha|public`) : le bouton Jouer apparaîtra tout seul le jour de la sortie.
4. **Dev** (rôle dev/ceo) : lore & design doc éditable (§7), builds alpha.
5. **Compte** : profil, déconnexion, appareils.

## 7. Lore / design doc de Terna (accès Dev)
- Source : `docs/dev/terna_lore_design_doc.md` (créé).
- Dans le Launcher : l'API `/launcher/v1/docs/terna_lore` n'est servie qu'aux rôles dev/ceo ; édition en Markdown avec historique (chaque sauvegarde = une révision en base, qui l'a modifié, quand, restaurable) et verrou d'édition simple pour éviter l'écrasement à deux.
- Le fichier n'est jamais inclus dans un build ni dans la page publique.

## 8. API proposée (`/launcher/v1`)
| Route | Rôle | Rôle de la route |
|---|---|---|
| `POST /auth/login`, `/auth/refresh`, `/auth/logout` | public | jetons |
| `GET /me` | connecté | profil + rôle |
| `GET /catalog` | connecté | produits visibles pour ce rôle |
| `GET /manifest/{produit}/{canal}` | selon rôle | manifeste signé |
| `GET /download/{produit}/{version}/{fichier}` | selon rôle | redirection vers lien signé court |
| `GET /news` | public/connecté | bannières |
| `POST /wishlist` | public | e-mail pour suivre Terna (limité par IP) |
| `GET/PUT /docs/{nom}` | dev, ceo | docs internes + révisions |
| `/admin/*` (existant `ADMIN_PATH`) | ceo + IP de confiance | comptes, rôles, publication de versions, bannières |

## 9. Sécurité
- Manifestes **signés** (clé privée hors ligne chez le CEO), vérification dans le Launcher ; le Launcher lui-même se met à jour de la même façon.
- Signature de code Windows (certificat OV/EV) pour éviter SmartScreen : indispensable pour un launcher grand public.
- Secrets jamais dans le dépôt (leçon du keystore Android) ; rotation de la clé OTA si fuite.
- Limitation de débit, journal des téléchargements (déjà en base : `downloads`), révocation de compte.

## 10. Feuille de route
1. **Phase 1 – Socle serveur** : comptes + rôles + `/catalog` + manifestes signés dans `dualpulse_site` (tests FastAPI).
2. **Phase 2 – Build par édition** : `build_release.py --edition friends|dev|ceo`.
3. **Phase 3 – Launcher MVP** : connexion, onglet Logiciels (Enos), moteur d'installation, auto-MAJ.
4. **Phase 4 – Vitrine** : News, onglet Jeux (Terna Coming Soon), wishlist.
5. **Phase 5 – Dev** : lore éditable avec historique ; alpha de Terna.
6. **Phase 6 – Finitions** : signature de code, thèmes, statistiques, Discord OAuth.

## 11. Points à trancher
1. Hébergement du serveur Dual Pulse (le site tourne déjà quelque part ? VPS, domaine ?) : le Launcher en dépend.
2. Stockage des binaires : GitHub Releases (gratuit, public) ou Cloudflare R2 (privé, liens signés) — R2 recommandé dès qu'il y a un build Dev/CEO.
3. Comptes Friends : inscription libre, invitation, ou liste fermée ?
4. Windows seul au départ (cohérent avec Enos) ou Linux/Mac pour Terna plus tard.
