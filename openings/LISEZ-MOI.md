# Ouvertures du Mode Apprentissage

Chaque fichier `.pgn` de ce dossier (et du dossier `openings\` posé à côté de `ENOS.exe`, pour vos propres fichiers) est lu au vol : un fichier peut contenir plusieurs ouvertures, une partie PGN = une ouverture. Ajoutez un fichier, rouvrez le panneau : il apparaît dans la liste.

## En-têtes

| En-tête | Rôle |
|---|---|
| `[Event "Défense Française"]` | nom affiché (obligatoire) |
| `[Repertoire "white"]` ou `"black"` | camp que **vous** jouez ; il détermine la colonne (Répertoire Blanc / Noir) et l'orientation du plateau |
| `[Level "1200-1300"]` | niveau de l'adversaire simulé (affichage) |
| `[Theory "de la Française"]` | complément de la phrase finale « À toi de jouer, montre-moi si t'as compris la théorie … » |
| `[Description "…"]` | une phrase d'idée générale, donnée à ETO pour présenter l'ouverture |
| `[ECO "C00"]` | facultatif |

## Variantes et commentaires

PGN standard avec variantes entre parenthèses. L'alternative à un coup se place **juste après** ce coup :

```
3. e5 { [%name Variante d'Avance] … } ( 3. exd5 { … } 3... exd5 ) ( 3. Nc3 … ) 3... c5
```

À la démonstration, ETO montre d'abord les variantes secondaires (annonce, coups, **retour en arrière**), puis la ligne principale. En pratique, l'adversaire joue ces variantes au hasard (la ligne principale est la plus probable) : écrivez-y les coups typiques d'un joueur de 1200-1300 Elo.

Dans les commentaires `{ … }` (format Lichess) :

* `[%name Nom de la variante]` : nom annoncé par ETO ; marque aussi un point clé (réplique vocale en mode « essentiel »).
* `[%cal Ge2e4,Rd7d5,Yc1h6,Bb1c3]` : flèches (G vert, R rouge, Y jaune, B bleu).
* `[%csl Ge4,Rd5,Yf7,Bc6]` : cases surlignées (G bon, R mauvais, Y info, B idée).
* le reste du texte est la **note de référence** : ce sont les seuls faits qu'ETO a le droit d'expliquer (il n'invente ni coup ni théorie).

Une étude Lichess exportée en PGN (avec flèches et commentaires) fonctionne telle quelle.

## Gambit Alien et autres

Aucune ligne n'est écrite de mémoire pour une ouverture dont la théorie n'est pas vérifiée : exportez l'étude de votre choix depuis Lichess ou Chessable au format PGN, déposez-la ici et elle devient une leçon.
