# Abonnements ETO et éditions privées E.N.O.S.

## Les versions

| Version | Public | Couleur | Prix | Où elle apparaît |
|---|---|---|---|---|
| ETO Free | grand public | vert | 0 € | Abonnement |
| ETO Pro | particuliers (Mobile Improver) | bleu | 2,99 €/mois · 28,70 €/an | Abonnement |
| ETO MAX | joueurs, créateurs, étudiants (PC + téléphone) | jaune | 9,99 €/mois · 95,90 €/an | Abonnement |
| ETO Ultra | équipes et entreprises (10 personnes, 25 appareils) | violet | 119,99 €/mois · 1 151,90 €/an | Abonnement |
| E.N.O.S. Standard Edition | amis (profil PC `friends`) | gris acier | privé | Espace CEO |
| E.N.O.S. Dev | employés (profil PC `dev`) | rose | privé | Espace CEO |
| E.N.O.S. CEO | toi et ton associé (profil PC `ceo`) | cramoisi | privé | Espace CEO |

L'en-tête de l'application affiche **E.T.O. · AUTONOME** quand une offre ETO est active, **E.N.O.S. · AUTONOME** pour une édition privée.

## Positionnement

Les échecs sont **entièrement gratuits** (ETO Free). Les offres payantes se vendent sur ce qu'elles font gagner (stockage, outils remplacés, temps) et tournent sur le téléphone et le PC de l'utilisateur, donc presque sans coût de serveur. Le marché, l'économie unitaire et les grandes idées pour développeurs, entreprises et investisseurs sont dans **[STRATEGIE_OFFRES.md](STRATEGIE_OFFRES.md)**.

## Tester

Dans l'app « Eto TEST » : Modules › Paramètres › Abonnement (offres publiques) ou Espace CEO (les 7 versions), bandeau « Mode test ». Code : `android/assets/mobile/js/plans.js`, `css/plans.css`. Test : `android/tests/t_plans.py`.

## Clés d'activation et révocation (serveur `app/launcher/eto.py`)

| Route (préfixe `/launcher/v1/eto`) | Qui | Rôle |
|---|---|---|
| `POST /admin/keys` `{plan, days, count, max_uses, expires_days, note}` | CEO | génère des clés `ETO-XXXX-XXXX-XXXX-XXXX` (75 bits aléatoires + 1 caractère de contrôle à poids impairs) ; seule l'empreinte SHA-256 est stockée |
| `GET /admin/keys` · `POST /admin/keys/revoke` `{id, revoke_subs}` | CEO | liste (statut, utilisations) · révocation, avec arrêt optionnel des abonnements ouverts par la clé |
| `POST /redeem` `{code}` | compte ETO | active la clé : même offre → durée ajoutée ; offre supérieure active → refus sans consommer ; 8 essais / heure / compte, 20 / heure / IP |
| `GET /admin/subs?q=` · `POST /admin/revoke` `{email, reason, cancel_billing}` | CEO | recherche des abonnés · coupe l'offre (journal `eto_events`), annule l'abonnement Stripe si demandé |

Limite connue : sans `cancel_billing`, un renouvellement Stripe ultérieur (webhook) peut rouvrir l'abonnement ; cocher l'annulation du prélèvement pour un arrêt définitif. Une révocation prend effet dans l'application à la relecture de la licence (au plus tard 7 jours hors ligne).

## ETO Gateway (`app/launcher/gateway.py`)

DualPulse possède UN compte OpenRouter et une clé de gestion (`DP_OPENROUTER_MGMT`, à créer dans les réglages OpenRouter, rubrique des clés de gestion / provisioning). Le serveur s'en sert, via l'API officielle de gestion des clés, pour créer une clé par client ETO MAX / Ultra plafonnée chaque mois (`DP_AI_LIMIT_ETO_MAX`=2, `DP_AI_LIMIT_ETO_ULTRA`=25 USD par défaut). Une demande alors qu'une clé existe supprime l'ancienne et en crée une nouvelle. Aucun compte n'est créé chez un fournisseur et aucune limite gratuite n'est contournée : DualPulse paie OpenRouter (prépayé) et facture l'abonnement. Marge : MAX 9,99 € → au plus ~1,85 € d'IA par mois et par client.
