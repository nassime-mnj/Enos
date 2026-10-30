# Jouer avec un ami « au téléphone » : état actuel et piste Discord (à faire plus tard)

## Ce qui marche déjà (sans Discord)
Battle Royale ×4 (`m_royale.js`) permet de mettre un siège en **« Joueur humain »** avec le prénom de l'ami. Quand c'est son tour, l'application te redonne la main avec **ses pièces** (message « 🎙 Joue le coup de Karim (pièces haut) ») et tu joues le coup qu'il te dicte :
- au doigt / à la souris sur le plateau, ou en **texte** : champ « Coup dicté » (ex. `h13 h11`, `h13-h11`) ; les cases sont nommées sur le plateau (a1 en bas à gauche du plateau affiché, colonnes a-n, rangées 1-14) ;
- bouton **📸 PLATEAU** : image du plateau (cases nommées, pièces du joueur au trait entourées) + liste de ses coups possibles, à envoyer à l'ami dans l'appel ou le groupe ;
- bouton **↶ ANNULER** si le coup entendu était faux.
Équipes libres : 1v1v1v1, 2v2, 2v1v1 (« moi + 1 bot contre 2 bots »), 3v1.

## Discord : ce qui est possible
- **Un bot ne peut PAS être ajouté à un groupe privé (group DM).** Un bot Discord vit dans des serveurs (guildes) ou en message privé 1-à-1 avec un utilisateur qui partage un serveur avec lui. Utiliser un compte utilisateur à la place d'un bot (« self-bot ») est interdit par les conditions de Discord (risque de bannissement) : à écarter.
- **Piste A — un mini-serveur à deux (le plus simple et fiable)** : créer un serveur privé avec seulement toi et l'ami (2 minutes : « Ajouter un serveur » › « Créer le mien » › « Pour moi et mes amis »), y inviter le bot. Le bot poste l'image du plateau (embed + pièces du joueur au trait), un menu déroulant liste les coups possibles (ou boutons par pièce), l'ami clique, le bot renvoie le coup à l'application. Ce n'est pas un « vrai serveur » à gérer : aucun salon à animer, aucune modération.
- **Piste B — application « installée sur le compte »** (user-installable app, 2024) : le bot s'ajoute aux comptes de toi et de l'ami et fonctionne par **commandes slash dans n'importe quel message privé ou groupe** (`/royale`). Pas de serveur du tout, mais : l'application ne peut pas lire les messages, elle répond seulement aux commandes, et il faut une **adresse HTTPS publique** pour recevoir les interactions (ou une connexion Gateway permanente depuis le PC).
- **Piste C — sans bot** (déjà en place) : tu envoies l'image à l'ami toi-même.

## Ce qu'il faudrait construire (piste A, ~1 jour)
1. Application Discord (portail développeur) + jeton du bot, stocké dans le coffre (jamais lu par le JavaScript).
2. Côté PC : petit service (`nasko_discord.py`, bibliothèque `discord.py` ou appels REST + Gateway) qui relaie : `POST /api/royale/ask {seat, board_png, moves}` → message Discord avec menu ; `GET /api/royale/answer` → coup choisi.
3. Côté mobile : même service via le PC (`/api/mobile/...`), ou connexion directe depuis l'application si la clé est dans le coffre Keystore.
4. Sécurité : seul l'ami désigné (son identifiant Discord) peut répondre ; coups validés par le moteur de règles (`chess4.js`) avant d'être joués.
Décision à prendre avec toi avant de coder : piste A (serveur à deux) ou B (HTTPS public).
