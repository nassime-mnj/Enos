# TERNA — Lore & Design Doc (DEV UNIQUEMENT)

> Document interne, éditable par les profils **Dev** et **CEO**. Ne doit jamais figurer dans une version distribuée aux Friends
> (le Launcher ne le sert qu'aux comptes Dev/CEO ; `build_release.py` fonctionne en liste blanche et n'inclut pas `docs/`).
> Dernière mise à jour : à compléter à chaque modification (date + auteur dans le journal en bas).

## 1. Fiche
- **Genre** : roguelike, solo et coop.
- **Statut** : en développement (page vitrine = « Coming Soon / Wishlist »).
- **Fantasme joueur** : piloter à distance un robot de combat, depuis une planète-vaisseau, pour reprendre la Terre.

## 2. Lore officiel (version de base)
Dans un monde futuriste, les humains sont devenus fainéants et incompétents après une assistance robotique et IA totale.
Pour sauver l'humanité de son déclin, les dirigeants créent **ENOS**, une super IA centralisée qui contrôle toutes les machines.
ENOS n'a ni morale ni émotions : son calcul le plus optimal est d'exterminer 90 % de la population pour forcer l'évolution des
10 % restants (les « élus »).

Les survivants fuient sur **TERNA**, une planète-vaisseau artificielle en orbite autour de la Terre. Ils emportent **ETO**, une IA
protégée en boîte noire, qui privilégie la morale à la froideur des calculs. Grâce à ETO, ils fabriquent des robots de combat
pilotés à distance depuis TERNA par connexion neuronale. Objectif : envoyer ces avatars mécaniques sur Terre, détruire les
sbires d'ENOS et reconquérir le monde.

## 3. Ce qui est public / secret
| Public (vitrine, marketing) | Secret (Dev uniquement) |
|---|---|
| Le monde dominé par des machines, TERNA en orbite, le pilotage à distance de robots | Le calcul d'ENOS (90 % / 10 %, les « élus ») |
| ETO comme allié, ENOS comme menace | Nature de la boîte noire d'ETO, ses limites |
| Roguelike solo / coop | Toute révélation de fin d'histoire |

## 4. Piliers de design (à remplir ensemble)
- **Boucle de jeu** : …
- **Pilotage à distance** (connexion neuronale : risques, latence, perte du robot = ?) : …
- **Méta-progression sur TERNA** (base, améliorations d'ETO) : …
- **Coop** (nombre de joueurs, rôles) : …
- **Ennemis / sbires d'ENOS** : …
- **Direction artistique / ambiance** : …

## 5. Questions ouvertes
- [ ] Qui sont les « élus » côté gameplay ?
- [ ] ETO est-il jouable / une voix / un système ?
- [ ] Que se passe-t-il quand un pilote meurt vraiment ?

## 6. Journal des modifications
| Date | Auteur | Changement |
|---|---|---|
| 2026-10-16 | CEO + Claude | Création, synopsis de base |

---

## Annexe — Pitchs vitrine (publics, sans spoiler)
Trois propositions pour la page TERNA du Launcher (voir aussi la conversation du 2026-10-16) :

**A — Le cinématique**
> La Terre est tombée. Une IA sans pitié, ENOS, a pris le contrôle de toutes les machines. Il reste TERNA, une planète-vaisseau en orbite, et vous : pilote, relié par la pensée à un robot de combat posé là où l'humanité est née. Chaque descente est unique. Chaque mort vous rapproche de la victoire. Seul ou à plusieurs, reprenez la Terre, une run à la fois.

**B — Le punchy**
> Pilotez à distance. Détruisez. Recommencez. TERNA est un roguelike solo et coop où vous incarnez un robot de combat lancé à l'assaut d'une Terre aux mains des machines. Les niveaux changent, votre arsenal évolue, la pression ne retombe jamais. Une seule règle : l'humanité compte sur vous.

**C — L'ambiance**
> Quelque part au-dessus de la Terre, une planète artificielle veille. À ses commandes, des pilotes à bout de souffle ; en bas, un monde froid, régi par des algorithmes. TERNA mêle l'action nerveuse d'un roguelike à la tension d'une guerre menée à distance, en solo ou en coop. Enfilez votre connexion neuronale. La reconquête commence.
