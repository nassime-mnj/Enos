# Interface Échecs du PC — « Obsidian Crimson »

Refonte graphique de tout ce qui touche aux échecs dans la version PC, d'après le kit `ENOS_UI_Kit_Claude` et le pack `ENOS_3_Pages_Claude`.
Aucune logique de jeu n'a été modifiée : les modules gardent leur code et leurs identifiants, seule la présentation change.

## Hub Échecs (`static/learn/`)

Avant, Apprendre, Arène, Royale, Variantes, Chess Edit… étaient des boutons séparés. Tout est maintenant réuni dans **une seule page Échecs** :

| Fichier | Rôle |
|---|---|
| `index.html` | barre latérale (`#tabs`, une entrée par mode), barre du haut (fil d'Ariane, recherche, « Jouer »), `#hub`, en-tête de page `#page-head` |
| `hub.js` | accueil : héros 3D, 16 cartes de modes en grille « bento », défilé des adversaires, palette Ctrl+K, en-têtes de module |
| `hub.css` | thème (couleurs du kit, police Inter embarquée), animations, responsive 1920 / 1440 / 1280 / étroit |
| `hub_icons.js` | icônes duotone (tracés Lucide, licence ISC) : `ENOS.hubIcon(nom)` |
| `pc_boot.js` | l'accueil par défaut est le hub ; `#arena`, `#royale`… dans l'adresse ouvrent directement un module |
| `fonts/`, `img/ui/` | Inter + Rajdhani (licence OFL), œil, cavalier, bannières du kit (WebP) |

**Le héros** rejoue en boucle une vraie partie (l'Opéra de Paris, Morphy 1858) sur un plateau en perspective : pièces debout qui glissent,
cases qui s'allument en vague, étincelles sur les prises, plateau qui pulse au mat. L'œil d'E.N.O.S. et le cavalier suivent la souris.
Les braises et le plateau s'arrêtent dès qu'on quitte l'accueil (aucun coût pendant une partie ou un export Chess Edit).
`prefers-reduced-motion` coupe toutes les animations.

**Chiffres affichés** : seulement des données réelles (nombre de bots calculé depuis `bot_roster.js` + `ai_bots.js`, nombre de modes).

**Modes qui vivent dans la fenêtre principale** (partie contre E.N.O.S., mise en condition, ouvertures avec ETO, Super ENOS, historique) :
le hub envoie `postMessage({ enos: "learn-act", act, mode })` ; `static/learn_launch.js` ferme le hub, ouvre le bon écran (avec le
sous-mode choisi : Défi, Cours ETO, Speedrun, Choc des titans, Boss final) et **revient au hub** quand on le referme.

**Arène** (`arena.js`, `arena.css`) : bannière « Quatre joueurs. Une seule victoire. » avec les 3 modes ×4, cartes « Choisir un adversaire »
(Défier → Blancs / Noirs / Au hasard, Détails → fiche du bot), puis toutes les familles de bots comme avant.

## Écran de partie CHESS (`static/index.html` `#cs`, `chess_ui.css`, `chess_ui.js`)

Maquette 02-chess : barre du haut (mode de jeu, Analyse, Entraînement, Nouvelle partie Blancs / Noirs, Fermer), raccourcis à gauche,
bandeau de l'adversaire (œil, nom, Elo réel du réglage de puissance) au-dessus du plateau carré, bandeau du joueur dessous,
colonne Analyse : évaluation chiffrée + phrase, coups sur deux colonnes, analyse du coup, actions (historique, bilan, 1v1 E.N.O.S. vs ETO,
trash talk, Discord, interrompre, mise en condition, abandon), réglages (puissance, adversaire, pièces, plateau, style, personnalité).
Toutes les commandes de l'ancien écran sont conservées ; `tests/ui_chess_screen_smoke.py` le vérifie.

Corrigé au passage : le sélecteur « Plateau » portait le même identifiant que le plateau (`cs-board`) ; il s'appelle maintenant `cs-boardsel`.
Le plateau 2D affiche les pièces illustrées (`img/chess/*.png`) ; le plateau Godot encastré se cale sur la nouvelle colonne centrale.

## Défi et Applications

- **Défi** (`#df`) : grande carte « Repousse tes limites », cartes Chess / Jeux Néon / Bots / Mise en condition, pastilles d'accès direct,
  bouton « Tous les modes d'échecs » (hub) et bandeau des dernières parties **réelles** (`/api/chess/history`, vide s'il n'y en a pas).
- **Applications** (Ctrl+K, `home.js`) : bandeau « Échecs E.N.O.S. » avec le cavalier, tuile **Échecs · HUB** ; les 9 tuiles d'échecs séparées
  sont regroupées derrière le hub (elles restent trouvables par la recherche).

## Tests

- `android/tests/t_pc_hub.py` : hub, palette, en-têtes, actions envoyées à E.N.O.S., Arène (Défier / Détails), aucune erreur JS.
- `android/tests/t_pc_arena.py`, `t_pc_learn.py`, `tests/ui_arena_smoke.py` : mis à jour pour le hub.
- `tests/ui_chess_screen_smoke.py` : écran CHESS, Défi et lanceur avec l'API simulée.
