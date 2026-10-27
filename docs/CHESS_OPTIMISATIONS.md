# Échecs : pistes d'optimisation (suggestions, rien n'est activé sans toi)

Classées par gain attendu. Chacune cite l'endroit du code concerné.

## Force et vitesse du moteur
1. **Mobile : sortir de l'asm.js (≈ +400 Elo, ×10 en vitesse).** `chess_local.js` lance Stockfish.js 10 (asm.js, sans réseau neuronal) parce qu'un `.wasm` ne se charge pas depuis `file://`. Servir les assets via `WebViewAssetLoader` (`https://appassets.androidplatform.net/…`, API androidx ou petit serveur local dans `MainActivity`) autorise le WASM, donc un Stockfish 16/17 NNUE ; avec les en-têtes COOP/COEP (via `shouldInterceptRequest`) on obtient aussi les threads (`SharedArrayBuffer`).
2. **Ne pas analyser deux fois la même position (PC).** `nasko_chess._play` lance `_analyse` (0,5 s) après chaque coup, et `_eto_choose` relance une MultiPV de 2,5 s sur la même position au coup suivant. Mémoriser le résultat par FEN (LRU de ~500 entrées) et réutiliser la ligne 1 de la MultiPV comme évaluation : ≈ −40 % de temps moteur par partie.
3. **Tables de finales Syzygy** (`SyzygyPath`, 3-5 pièces ≈ 1 Go) : conversion parfaite des finales gagnées, donc plus aucune nulle des 50 coups ; c'est le complément naturel de `nasko_nodraw`.
4. **Réglages du moteur principal.** Seul le mode Boss règle `Threads`/`Hash` (`_boss_tune`). Les parties normales tournent avec les valeurs par défaut (1 thread, 16 Mo) : `Threads = cœurs/2`, `Hash = 128`, `Move Overhead = 50`, et ne pas envoyer `ucinewgame` entre deux coups (la table de transposition est conservée).
5. **`UCI_ShowWDL`** : Stockfish donne directement la probabilité de victoire/nulle/défaite. Plus fiable que la formule centipions → % (`_winpct`) pour le jugement des coups et pour la barre d'évaluation.
6. **Réflexion pendant le tour adverse (`go ponder`)** pour E.N.O.S./ETO face à un humain : la réponse arrive presque instantanément quand le coup prévu est joué.
7. **Temps adaptatif.** `LIMIT_TIME = 0,5 s` partout : donner 2-3× plus à une position tendue (deux meilleurs coups à < 20 cp, échec ou prise en jeu) et 0,15 s à un coup forcé ou de livre.

## Pas de nulle, pas de défaite (ce qui vient d'être ajouté, et la suite)
8. **Heuristique de progrès** : en position gagnante, préférer à égalité d'évaluation le coup qui pousse un pion, prend ou échange. `nasko_nodraw` esquive déjà la 2ᵉ répétition et la règle des 50 coups ; ceci évite d'en arriver là.
9. **Ne pas laisser l'adversaire provoquer la répétition.** Aujourd'hui seule NOTRE sortie de position est filtrée ; on peut aussi écarter les coups après lesquels toutes les réponses adverses de bonne évaluation ramènent une position déjà vue (recherche à 2 demi-coups, peu coûteuse).
10. **Livre d'ouvertures** (`opening_manager`, PGN déjà présents) pour les 8-10 premiers coups : zéro calcul, variété, et jamais de répétition en ouverture. Super Enos varie déjà ses 6 premiers demi-coups.
11. **Sacrifices offerts sur mobile.** Le port JS du coup brillant (`chess_local.js`) reconnaît le sacrifice forcé ; le sacrifice *offert* du PC (`_offered_sacrifice`, `root_moves`) demande `go searchmoves` et un moteur plus rapide (voir 1).

## Super Enos (entraînement)
12. **Sauvegarder les parties en PGN** (`data/super_enos.json` ne garde que les résultats et leçons) : ré-analysables dans BILAN, exportables, utilisables pour calculer un vrai répertoire d'ouvertures.
13. **Parallélisme PC** : `nasko_train` joue une partie à la fois (2 processus). Sur 8 cœurs, 3 parties en parallèle (1 thread par moteur) triplent le débit.
14. **Séances nocturnes** : lancer l'entraînement quand le PC est branché et inactif (`nasko_power` connaît déjà l'alimentation) et l'arrêter dès qu'un jeu se lance (`nasko_env`).
15. **Profil adaptatif** : après N parties, donner au LLM les deux ouvertures les plus perdantes de la mémoire et lui imposer de les rejouer contre le profil qui l'a battu (aujourd'hui seules les leçons sont rejouées).
16. **Mobile : économie de batterie** : baisser `ms` (réflexion) sous 20 % de batterie ou hors charge ; proposer « seulement branché » comme réglage.

## Qualité de jeu des bots faibles
17. Sous 1320 Elo le moteur ne descend pas : `_player`/`chess_local` tirent des coups **au hasard** (jusqu'à 60 %), ce qui donne des parties peu réalistes. Mieux : MultiPV 5 et tirage pondéré par l'évaluation (softmax, température selon l'Elo) ; les erreurs ressemblent alors à celles d'un joueur humain.

## Hygiène
18. `nasko_mobchess` (service PC pour le téléphone) travaille sans historique : plus de détection de répétition côté PC pour ces routes. Le téléphone joue maintenant en local ; supprimer `/api/mobile/chess/play|engine` ou leur passer la liste des coups.
19. Un seul `_pov_lines` / `lines_from_infos` pour tous les modules (déjà fait pour `nasko_chess`, `nasko_train` et `nasko_nodraw`) ; y migrer `nasko_mobchess._score` et `_boss`.
