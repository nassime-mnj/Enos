# Stratégie des offres ETO / E.N.O.S.

> Novembre 2026. Document de travail pour les associés, à transformer en pitch pour les investisseurs.

## 1. La thèse en une phrase

**E.N.O.S. est une super-app « local-first » téléphone + PC : tout le calcul tourne chez l'utilisateur (son téléphone, son PC), donc chaque abonnement est presque sans coût de serveur.** Là où un concurrent paie des serveurs pour compresser des photos, héberger des fichiers ou faire tourner une IA, nous utilisons le matériel que l'utilisateur possède déjà. C'est l'argument de rentabilité à mettre au centre.

Ce qui existe déjà et que peu d'acteurs ont ensemble :

| Brique | Où | Pourquoi elle compte |
|---|---|---|
| Lien sécurisé téléphone ⇄ PC (Wi-Fi ou Tailscale, empreinte de certificat, appareils de confiance) | `nasko_server`, appli Android | base de tout le « pilotage à distance » |
| Éditions physiquement isolées (Standard, Dev, CEO), profils signés, mises à jour OTA | `release_editions.py`, `nasko_roles.py`, Launcher | prêt pour la marque blanche et les versions par client |
| Analyse de galerie (doublons, flous, captures, grosses vidéos) et compression image / vidéo sur le téléphone | `GalleryScan.java`, `m_cleaner.js`, `m_compress.js` | cœur du Mobile Improver |
| Moteurs de calcul natifs ARM64 dans l'APK (Stockfish 19 complet, 4 autres) | `build_engines.sh` | preuve qu'on sait embarquer du calcul lourd sur téléphone |
| Rendu vidéo déterministe et export MP4 (Chess Edit Studio) | `chess_edit_*.js` | moteur de génération vidéo réutilisable |
| Dépôt intranet : forge Git, éditeur, terminal WSL, sujets PDF, entraînement | `nasko_depot*` | produit éducation / équipes de dev |
| Copilote d'écran, Smart AFK, Auto-Clipper IA, Tests F6 Godot, journal de plantages | PC | produits pour joueurs, créateurs et studios |

## 2. Ce qu'on arrête de faire

- **Les échecs sont gratuits, entièrement.** C'est le produit d'appel : il fait venir et revenir les gens, il ne se vend pas. 142 bots, moteurs natifs, Chess Edit, tous les modes : dans ETO Free, sans publicité.
- **On ne se compare pas à ChatGPT.** ETO appelle une API (Groq) : sa valeur n'est pas « l'IA », c'est ce qu'il fait sur le téléphone et le PC.

## 3. Le marché (sources en fin de document)

- **Stockage** : Google One 100 Go = 1,99 €/mois ; iCloud+ 200 Go = 2,99 €/mois, 2 To = 9,99 €/mois. 55 % des adultes américains interrogés paient du stockage en plus pour leur téléphone (70 % sur iPhone, 31 % sur Android).
- **Nettoyeurs** : CCleaner Pro Android ≈ 20 $/an ; Avast Cleanup 10 appareils ≈ 80 $/an au renouvellement. Ils nettoient des caches, ils ne recompressent pas la galerie.
- **Clips de jeu** : Medal (enregistreur local, gratuit + Medal+), Eklipse (cloud, gratuit limité à 720p avec filigrane).
- **Gestion d'appareils (MDM)** : Intune ≈ 8 $/utilisateur/mois ; Jamf 4 à 13 $/appareil/mois ; TeamViewer ≈ 50 à 120 $/mois pour une PME.
- **Suivi des plantages** : Sentry Team 26 $/mois, Business 80 $/mois.
- **Passerelles d'API d'IA** : OpenRouter a levé 113 M$ (série B, mai 2026, valorisation ≈ 1,3 Md$) ; Portkey (15 M$ en série A) a été racheté par Palo Alto Networks. Le marché paie pour **réunir, contrôler et sécuriser** les clés d'API.
- **Éducation au code** : Codio ≈ 20 $/élève/an, Tynker 20 à 50 $/élève ou 3 600 $/école.
- **Google Play** : environ 15 % de commission sur les abonnements (10 % de service + 5 % de facturation).

## 4. Les offres grand public

| Offre | Prix | Pour qui | Ce qu'on vend | L'argument de rentabilité |
|---|---|---|---|---|
| **ETO Free** (vert) | 0 € | tout le monde | tous les échecs, outils de base, chat avec sa clé | acquisition, rétention |
| **ETO Pro** (bleu) | 2,99 €/mois · 28,70 €/an | particuliers | **Mobile Improver** : recompression nocturne des photos et vidéos, doublons et flous chaque semaine, corbeille 30 jours, rapport mensuel | se rembourse dès qu'il évite un forfait de stockage (1,99 à 2,99 €/mois) |
| **ETO MAX** (jaune) | 9,99 €/mois · 95,90 €/an | joueurs, créateurs, étudiants | pilotage du PC, Auto-Clipper IA, copilote de jeu, passerelle d'API, Codelab, Studio média | remplace 2 ou 3 outils payants |
| **ETO Ultra** (violet) | 119,99 €/mois · 1 151,90 €/an | équipes, PME, studios, écoles | 10 personnes / 25 appareils, flotte, dépôt intranet, journal de plantages, Tests F6, édition à la marque | < 12 € par personne quand MDM + suivi des plantages + accès distant coûtent chacun ce prix |

### Le Mobile Improver (produit phare d'ETO Pro)

1. **La nuit**, quand le téléphone charge, en Wi-Fi, écran éteint (JobScheduler d'Android : aucun coût de batterie perçu).
2. **Photos** : réencodage en WebP ou HEIF à qualité visuelle constante (mesure SSIM avant / après, seuil réglable) ; gain typique 40 à 60 %.
3. **Vidéos** : réencodage H.265 / HEVC 1080p avec le codec matériel du téléphone (MediaCodec) ; gain typique 50 à 70 %.
4. **Doublons, flous, vieilles captures, grosses vidéos déjà sauvegardées** : déjà détectés par le Nettoyeur ; on les propose chaque semaine.
5. **Sécurité** : les originaux vont dans une corbeille de 30 jours ; la suppression passe par la boîte de dialogue système d'Android (une seule confirmation pour tout le lot).
6. **Performance** : honnêtement, Android ne laisse pas une appli « accélérer » le téléphone. Ce qu'on fait vraiment : garder de la marge de stockage (un stockage presque plein ralentit l'écriture), signaler les applis qui vident la batterie, nettoyer nos propres caches. On le vend comme « un téléphone qui ne sature plus », pas comme un booster magique.

Ce qui existe déjà : l'analyse de galerie et la compression manuelle. À construire : le travail de nuit (Java), le réencodage HEVC matériel, la corbeille, le rapport.

### Économie unitaire (ordre de grandeur, TVA 20 %)

| Offre | Prix TTC | HT | Après Google Play (≈ 15 %) | Coût serveur | Marge brute |
|---|---|---|---|---|---|
| Pro | 2,99 € | 2,49 € | ≈ 2,12 € | ≈ 0 € (tout sur le téléphone) | ≈ 95 % |
| MAX | 9,99 € | 8,33 € | ≈ 7,08 € | ≈ 0 € (le PC de l'utilisateur sert de serveur) | ≈ 95 % |
| Ultra | 119,99 € | 100 € | ≈ 98 € (facturation directe aux entreprises) | support, relais de mise à jour | ≈ 85 % |

Point mort pour un développeur à 4 000 €/mois chargé : environ **1 900 abonnés Pro**, ou **570 MAX**, ou **41 équipes Ultra**.

## 5. Les grandes idées pour développeurs, entreprises et investisseurs

Classées de la plus réaliste à la plus ambitieuse. Pour chacune : ce qui existe, ce qui manque, comment elle rapporte.

### A. ETO Fleet — la gestion d'appareils « sans cloud » pour les PME
- **Promesse** : inventaire, santé, mises à jour et versions privées des téléphones et PC de l'entreprise, sans que les données quittent l'entreprise (le PC du patron sert de serveur).
- **Existe** : appareils de confiance, profils signés, éditions isolées, OTA, journal de plantages.
- **Manque** : console multi-appareils, politiques (code de verrouillage, applis interdites), rapports.
- **Revenu** : 3 à 5 €/appareil/mois, sous Intune et Jamf. Argument RGPD très fort en Europe.

### B. ETO Gateway — la passerelle d'API pour les développeurs
- **Promesse** : une seule clé pour toutes les IA (Groq, Mistral, etc.), quotas par utilisateur et par application, bascule automatique si un fournisseur tombe, journal local, coûts en temps réel.
- **Existe** : appels Groq / ElevenLabs côté téléphone et PC, Contrôle API (quotas), coffre de clés chiffré.
- **Manque** : le routeur lui-même, les tableaux de bord, une SDK.
- **Revenu** : abonnement développeur + petit pourcentage sur le volume. Le marché vient d'être validé (OpenRouter, Portkey).
- **Attention** : un « générateur » qui irait créer ou récupérer des clés gratuites pour contourner les limites d'un fournisseur viole ses conditions d'utilisation et ferait bannir les comptes. La version solide : **nos propres clés payées, revendues avec des quotas**, ou les clés du client (BYOK).

### C. ETO Forge Edu — l'intranet de code clé en main pour les écoles
- **Promesse** : forge Git, éditeur, terminal Linux, sujets, correction automatique, entraînement, installés dans l'école (pas de cloud, pas de données d'élèves dehors).
- **Existe** : Dépôt intranet complet, Codelab avec quêtes, éditions Friends pour étudiants.
- **Manque** : correction automatique, tableau de bord enseignant, comptes de classe.
- **Revenu** : 15 à 20 €/élève/an (prix du marché : Codio, Tynker), contrats annuels.

### D. Chess Edit Engine — la vidéo d'échecs à la demande pour les plateformes
- **Promesse** : une partie (PGN) entre, un edit vertical prêt pour TikTok / Shorts sort, à la marque du client.
- **Existe** : tout le moteur de rendu, les sons, les effets, l'export MP4.
- **Manque** : une API de rendu par lot, la marque blanche.
- **Revenu** : licence aux plateformes, clubs, streamers et écoles d'échecs (par vidéo ou par mois). Les échecs restent gratuits pour le public ; c'est le **moteur** qu'on vend aux entreprises.

### E. Godot QA — tests et plantages pour studios indépendants
- **Promesse** : lancer les tests du jeu depuis le téléphone, recevoir les plantages des joueurs, voir qui a cassé quoi.
- **Existe** : Tests F6, Sync Godot, journal de plantages, Hub équipe.
- **Manque** : SDK de plantage pour Godot, regroupement des erreurs.
- **Revenu** : 20 à 60 €/mois par studio (sous Sentry Team / Business), communauté Godot en forte croissance.

### F. La plus folle : le « téléphone qui travaille la nuit »
- **Promesse** : les téléphones dorment 8 h par nuit, branchés, sur Wi-Fi. ETO sait déjà y faire tourner du calcul lourd (moteurs natifs, compression, rendu vidéo). On propose aux entreprises de louer ce calcul (rendus vidéo, analyses), et l'utilisateur est payé en mois d'abonnement gratuits.
- **Risques** : sécurité, batterie, confiance. À ne lancer qu'après A à E, avec un cadre juridique solide. Mais c'est l'idée qui fait lever la tête d'un investisseur.

## 6. Ce qu'il faut avant de vendre

1. Comptes ETO et facturation (Google Play pour les particuliers, facturation directe pour les entreprises).
2. Vrai verrouillage des fonctions par offre (aujourd'hui l'offre change le nom, la couleur et le badge).
3. Le Mobile Improver automatique (premier produit à construire : prouve la rentabilité tout de suite).
4. Juridique : CGV, confidentialité (RGPD), TVA, mentions légales, droit de rétractation.
5. Les chiffres que demandent les investisseurs : utilisateurs actifs, rétention à 30 jours, conversion Free → Pro, coût d'acquisition.

## 7. Ordre de construction proposé (90 jours)

1. **Mois 1** — Mobile Improver automatique + rapport mensuel : la démo qui prouve le gain en gigaoctets.
2. **Mois 2** — Comptes + abonnements Google Play + verrouillage des offres ; ETO Gateway en version développeur.
3. **Mois 3** — ETO Fleet pour 3 entreprises pilotes (gratuites), puis le dossier investisseurs avec leurs chiffres.

## Sources

- Stockage : [Internxt, prix Google One](https://blog.internxt.com/google-one-pricing/), [Apfelpatient, prix iCloud+](https://www.apfelpatient.de/en/tips-tricks/icloud-costs-prices-plans-and-which-one-is-worth-it), [All About Cookies, enquête stockage 2026](https://allaboutcookies.org/cloud-storage-statistics)
- Nettoyeurs : [Walmart, CCleaner Android](https://www.walmart.ca/en/c/brand/ccleaner), [Toolradar, prix Avast](https://toolradar.com/tools/avast/pricing)
- Clips : [Eklipse vs Medal](https://eklipse.gg/compare/eklipse-vs-medal-tv)
- MDM : [AIMultiple, prix MDM](https://aimultiple.com/mobile-device-management-pricing), [Costbench, Intune vs Jamf](https://costbench.com/compare/jamf-pro-vs-microsoft-intune/), [TSplus, prix TeamViewer](https://tsplus.net/remote-support/blog/teamviewer-cost-in-2026-pricing-guide-for-it-buyers/)
- Plantages : [Bugnet, Sentry pour studios](https://bugnet.io/blog/sentry-pricing-for-game-studios), [Capterra, prix Sentry](https://www.capterra.com/p/165426/Sentry/pricing/)
- Passerelles d'API : [DevToolLab, comparatif](https://devtoollab.com/blog/best-llm-gateways), [TheRouter, prix comparés](https://therouter.ai/blog/ai-model-router-pricing-cost-comparison-2026/)
- Éducation : [Codio, prix écoles](https://www.codio.com/pricing/k12-school-pricing), [Tynker, écoles primaires](https://camps.tynker.com/elementary-school/coding-curriculum)
- Google Play : [ghacks, frais 2026](https://www.ghacks.net/2026/06/25/google-play-billing-choice-program-goes-live-june-30-with-lower-developer-fees-and-third-party-billing/), [Adapty, commissions abonnements](https://adapty.io/blog/markdown/google-play-billing-changes-subscriptions-fees.md)
