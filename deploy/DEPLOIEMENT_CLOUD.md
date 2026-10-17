# Déploiement cloud gratuit — Render + Supabase + Cloudflare R2

Objectif : un serveur Dual Pulse joignable 24 h/24 (comptes, presse-papiers universel, mises à jour de l'app mobile) **sans dépendre de l'IP de ton PC**.
Tout le code est prêt : `render.yaml` (racine), `dualpulse_site/` (serveur), `dualpulse_site/tools/publish_apk.py` (publication de l'APK). Il reste les **comptes et clés, que toi seul peux créer** (une vingtaine de minutes).

## 1. Supabase (base de données PostgreSQL, offre gratuite)
1. supabase.com → New project (région proche, ex. Paris/Frankfurt). Note le mot de passe de la base.
2. Project Settings → Database → **Connection string** → onglet **URI**, mode **Transaction pooler** (port 6543) → copie l'URI (`postgresql://postgres.xxxx:MOT_DE_PASSE@aws-0-….pooler.supabase.com:6543/postgres`). C'est `DP_DATABASE_URL`.
3. Rien à créer à la main : le serveur crée ses tables au premier démarrage (extension `citext` activée automatiquement).
> Les comptes et les rôles restent gérés par **notre serveur** (invitation CEO, TOTP, rôles stricts) : Supabase ne sert que de base PostgreSQL hébergée. Active la **sécurité de ligne (RLS)** n'est pas nécessaire : seule l'URI serveur accède aux tables ; ne publie jamais cette URI ni la clé « service role ».

## 2. Cloudflare R2 (stockage des APK et installeurs)
1. dash.cloudflare.com → R2 → créer un bucket **privé** (ex. `dp-binaires`).
2. R2 → Manage API tokens → créer un jeton **Object Read & Write** limité à ce bucket → note `Access Key ID` et `Secret Access Key`. L'endpoint est `https://<ID_COMPTE>.r2.cloudflarestorage.com`.
3. Rien à rendre public : le serveur délivre des liens signés de 5 minutes.

## 3. Render (serveur Python gratuit)
1. render.com → New → **Blueprint** → choisis ce dépôt (`render.yaml` est lu automatiquement) → Apply.
2. Renseigne les variables marquées « sync: false » (voir `dualpulse_site/.env.example`) :
   `DP_ADMIN_TOKEN` (32+ caractères aléatoires), `DP_DATABASE_URL` (Supabase), `DP_TOKEN_KEY` (`py -c "from app.launcher import tokens as t; print(t.private_to_b64(t.new_private()))"` dans `dualpulse_site`), `DP_MANIFEST_PUBKEY` (contenu de `ota_pubkey.txt`), `DP_R2_*`.
3. Attends « Live » → `https://<nom>.onrender.com/healthz` doit répondre `ok`.
4. Crée ton compte CEO (une seule fois) :
   `curl -X POST https://<nom>.onrender.com/admin-dp/api/launcher/ceo -H "X-Admin-Token: <DP_ADMIN_TOKEN>" -H "Content-Type: application/json" -d "{\"email\":\"toi@exemple.fr\",\"password\":\"un mot de passe long\"}"`
> Offre gratuite Render : le service **s'endort après 15 min sans requête** (réveil ≈ 50 s). L'application mobile « réveille » le serveur avant ses appels. Pour l'éviter : un moniteur gratuit (UptimeRobot) qui appelle `/healthz` toutes les 5 minutes. Railway : `railway.json` est fourni (même variables).

## 4. Publier l'application mobile (depuis ton PC)
```
py construire_apk.py                                  # → NASKO.apk + NASKO.apk.json (nouvelle clé de signature : android/signing/enos-release.jks)
set DP_ADMIN_TOKEN=...   &  set DP_R2_ENDPOINT=...  &  set DP_R2_BUCKET=...  &  set DP_R2_ACCESS_KEY=...  &  set DP_R2_SECRET_KEY=...
py dualpulse_site\tools\publish_apk.py --apk NASKO.apk --server https://<nom>.onrender.com --channel stable --notes "Parité PC, scanner, coffre…"
```
Le script téléverse l'APK dans R2, signe le manifeste avec ta clé OTA (jamais envoyée au serveur) et le publie.

## 5. Installer l'app sur le téléphone et recevoir les mises à jour
1. Première installation : `Envoyer l'APK au telephone.bat` (PC) ou l'adresse `https://<PC>:8443/nasko.apk` existante.
2. Dans l'app → **Modules → Compte cloud** : adresse du serveur, e-mail, mot de passe (ou **J'ai une invitation**) → **Vérifier les mises à jour**. Android propose l'installation (autorise « sources inconnues » une fois). Ensuite l'app vérifie seule toutes les 6 h.
3. **Presse-papiers** et **Visible depuis le PC** (miroir) utilisent le même compte.

## Sécurité
- Les mises à jour exigent la **même signature Android** que l'app installée : un APK d'une autre origine est refusé par le système. Un jeton d'appareil (180 j) ne sert qu'à lire la version et télécharger l'APK ; il est révoqué avec la session.
- Garde `android/signing/enos-release.jks` + son mot de passe **hors du dépôt** : sans eux, plus aucune mise à jour possible.

## CodeLab : exécution de code (important)
`/launcher/v1/codelab/run` exécute du code arbitraire : le serveur **refuse** (503) tant qu'aucun bac à sable fort n'est disponible. L'offre gratuite Render en Python « natif » n'autorise probablement pas les namespaces nécessaires à bubblewrap : `/launcher/v1/codelab/languages` indiquera `sandbox.mode = "none"`. Deux solutions : (1) déployer `dualpulse_site/Dockerfile.codelab` sur une VM / un service Docker (voir `CODELAB_API.md` pour les options de sécurité) ; (2) définir `DP_CODELAB_REMOTE` vers un Piston auto-hébergé. Ne jamais activer `DP_CODELAB_ALLOW_WEAK=1` en production.
