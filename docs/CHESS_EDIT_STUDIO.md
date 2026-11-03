# CHESS EDIT STUDIO

Partie enregistrée (Défis / Combats) + musique (.mp3 / .wav) → « chess edit » TikTok / Shorts.
Accès : MODULES › Échecs & apprentissage › **Chess Edit Studio**, ou bouton **🎬** dans « Parties récentes » et dans la feuille de fin de partie (à côté de COPIER LE PGN / REJOUER).

## Fichiers
| Fichier | Rôle |
|---|---|
| `android/assets/mobile/js/chess_edit_audio.js` | Analyse audio : `OfflineAudioContext`, passe-bas 150 Hz (kicks), bande 300-3000 Hz (voix), RMS + flux spectral (FFT) par tranches de 20 ms → `introBeats`, `buildUpStart`, `preDropSilence`, `mainDropTimestamp`, `hardBeats`, `vocalPeaks`, forme d'onde. Cœur pur : `analyse(sig, sr)`. |
| `…/js/chess_edit_map.js` | `gamePlies` (dramaScore par coup), `autoSlots` (mode IA) / `manualSlots` (marqueurs), `assign` + `build` (timeline), `manifest` (JSON Godot). |
| `…/js/chess_edit_fx.js` | Scène temps réel : CSS3D (perspective 900 px), N&B + vignette, caméra `cubic-bezier(0.16,1,0.3,1)` ±8°, poussière (2 canvas), traînées, halos, ondes `!!`, shake + aberration chromatique (filtre SVG) + flash 60 ms, cutscenes, répliques en machine à écrire glitchée. |
| `…/js/m_chessedit.js` + `css/chessedit.css` | Module : choix de la partie, musique, mode IA / manuel (forme d'onde éditable), aperçu, export. |
| `nasko_chessedit.py` + routes `/api/chessedit/*` | Reçoit manifeste + musique, lance Godot (aperçu ou rendu). |
| `godot_chess_edit/` | Projet Godot 4.7 : `ChessEditDirector.gd`, `shaders/chroma_shake.gdshader`, `pieces/`. |
| `android/tests/t_chessedit.py` | Test : musique synthétique à drop connu, mapping, scène 3D, effets. |

## Données enregistrées par les Défis
`defi.hist[i]` = `{…, mv:[[uci, san, jugement, perte, éval, meilleur]…], ch:[[nb_coups, bot, texte, type]…]}`. `ch` (répliques des bots, dont `transform` = GhorGhor le vrai) est nouveau : les parties jouées **avant** cette version n'ont pas de répliques (l'edit marche quand même).

## Mapping (mode IA)
dramaScore : capture (valeur de la pièce), échec, mat, promotion, brillant, gaffe (`??` ou perte > 300 cp), meilleur coup, écart d'évaluation, réplique forte, transformation du boss.
1. Le coup au dramaScore maximal est verrouillé sur `mainDropTimestamp` ; la transformation du boss sur `buildUpStart` ; le dernier coup (mat) sur le dernier impact.
2. Les autres emplacements (introBeats avant, hardBeats après) reçoivent les coups les plus dramatiques **en gardant l'ordre de la partie**.
3. Coups passifs entre deux coups clés : joués en accéléré ×8 (badge `▶▶ ×8`, teinte « rewind ») s'il y a la place, sinon sautés.

## Mode manuel
Rouge = DROP (coup au choix dans la liste, sinon le plus dramatique) · violet = BOSS · cyan = BRILLANT !! · jaune = BEAT. Toucher la forme d'onde ajoute un marqueur du type choisi, glisser le déplace, « IA → MANUEL » reprend les marqueurs détectés pour les retoucher.

## Pont Godot (PC)
* **RENDRE SUR LE PC** (téléphone appairé avec droits complets, ou PC) : envoie manifeste + musique ; ENOS.exe lance la scène.
* **EXPORTER LE MANIFESTE** : écrit `edit_timeline_manifest.json` ; mettre la musique dans le même dossier, puis  
  `Godot --path godot_chess_edit -- --manifest=C:\chemin\edit_timeline_manifest.json` (aperçu ; `--seek=20` pour démarrer plus loin).
* Rendu vidéo 60 FPS : `Godot --path godot_chess_edit --write-movie sortie.avi --fixed-fps 60 -- --manifest=… --movie`, puis `ffmpeg -i sortie.avi -c:v libx264 -pix_fmt yuv420p -c:a aac sortie.mp4` (fait automatiquement par `/api/chessedit/lancer` avec `render:true` si FFmpeg est dans le PATH).
* Effets du manifeste : `SHAKE_HEAVY`, `BRILLIANT_SHOCKWAVE`, `BOSS_AWAKENING`, `PROMOTION_CUTSCENE` (+ `BLUNDER_RED`, `BEAT`, `FASTFORWARD`).

## Limites connues
* Jamais testé sur téléphone réel (Chromium/Edge de bureau + Godot 4.7.1 seulement). Le filtre SVG d'aberration chromatique et les 3D CSS peuvent être lents sur un vieux téléphone.
* Pas d'export vidéo depuis le téléphone (l'aperçu est temps réel) ; la vidéo se fait via Godot sur le PC.
* Analyse limitée aux 6 premières minutes de la musique ; la détection du drop suppose un vrai creux/montée avant l'explosion (sinon `confidence` basse : passer en mode manuel).
* La musique n'est pas mémorisée entre deux sessions (les marqueurs manuels le sont, par partie).
* Après modification de `bot_chat.js` / `m_defis.js` : `python build_learn_data.py --sync` (fait). La copie PC (arène) n'a pas le studio : boutons 🎬 masqués là-bas.

## Looks et plans (inspirés des références)
Sélecteur « Style visuel » (AUTO par défaut) : **Rouge noir** (plans serrés, vignette rouge), **Galaxie** (nébuleuse + étoiles + orbes), **Acier néon** (gris plat, cases rouges), **Aura turquoise** (teal monochrome, particules, bulle « !! », arcs électriques et notes), **Noir & blanc**.
Plans : `macro` (zoom ×3-4, inclinaison ±16°, flou de profondeur sur les bords) pour mat / gaffe / prise de Dame ou Tour ; `hero` (la pièce détourée, en grand, retombe en rebondissant) pour le DROP, la promotion et le brillant ; texte néon + flèche (« IT'S OVER... », « BIG MISTAKE », « QUEEN DOWN », « CHECK ! »). En AUTO le look change selon l'action : acier (intro / accéléré) → rouge noir (mat, gaffe, boss) → galaxie (après le drop) → aura (brillant). Les champs `overlay_text` et `shot` sont aussi dans le manifeste ; la scène Godot ne les utilise pas encore.

## RYTHME « VIRAL » (défaut depuis la 1.38) — toute la partie, pas seulement quelques coups
Sélecteur « Rythme du montage » (carte 2) : **VIRAL** (défaut) ou « Calé sur la musique » (l'ancien mode, qui ne montre que les coups clés). La musique devient **facultative** en viral.
`E.editMap.buildViral(plies, rec, audio, opts)` (js/chess_edit_map.js) :
1. **Intro « VS »** (4,6 s) : les deux adversaires (portraits des bots, titre GM/IM, Elo, couleur), « VS » qui claque + shake + flash (`Stage.intro`).
2. **Ouverture fluide** : les 8 à 14 premiers coups, tous montrés, ~0,6 → 0,35 s chacun, sans ralenti (jusqu'au premier moment fort).
3. **Milieu / fin** : chaque coup a un niveau (`lvlOf`) — 0 passif : ×~6 (0,17 s, étiquette ▶▶) ; 1 notable (prise, meilleur coup…) : normal ; 2 important (échec, sacrifice, erreur, promotion, grosse prise) : **ralenti** 0,68 s + arrêt sur image 0,5-0,6 s ; 3 moment clé (BRILLANT, GAFFE, MAT, dame prise, promotion en dame, boss) : ralenti 1 s + **arrêt sur image 0,95-1,7 s**. Le coup avant un moment clé est « en tension » (plus lent). Budget de durée `maxLen` (70 s) : on comprime d'abord les passifs, puis les notables, puis les pauses ; aucun coup n'est supprimé. Le sacrifice est détecté avec chess.js (pièce ≥ 3 qui arrive sous le feu d'une pièce moins forte ou sans recapture).
4. **Outro** (résultat). Le coup du « DROP » (le plus dramatique) est ancré sur le drop de la musique : `musicStart` (= drop − instant d'impact) décale la musique (positif : on saute son début ; négatif : elle démarre plus tard).
**Badges** (`E.editMap.BADGES`, `Stage.badge`) : brillant ‼ cyan néon, gaffe ❓ rouge, erreur ? orange, inexactitude ⁈ jaune, excellent 👍 vert, pastille sur la case + libellé néon en haut.
**Effet brillant / sacrifice** (`Stage.brilliantFx`) : zoom éclair sur la case (×3,9 en 170 ms), screen shake violent, aberration chromatique, **inversion des couleurs** (filtre CSS `invert + hue-rotate`, 3 pulsations de 80 ms) et flash de lumière. `Stage.slowmo / freeze` : l'échelle de temps des particules passe à ×0,3 puis ×0,05.
**Sound design** (js/chess_edit_sfx.js, Web Audio) : bruits d'échecs (déplacement, prise synthétisée, échec, promotion, mat, cloche « brillant ») **programmés sur l'horloge audio** (`AudioContext.currentTime`, 350 ms d'avance) à l'instant d'impact de chaque coup, avec **compensation du silence initial des échantillons** (0,1 à 0,4 s dans les mp3 de coups : le départ est avancé pour que l'impact tombe pile). **Voix de Levy** (`audio/levy/*.mp3` : the_queen, the_rook, the_bishop, the_knight, this_is_the_way ; usage privé) : la voix d'une pièce se déclenche quand cette pièce est **SACRIFIÉE** (« The Queen » = il sacrifie la dame ; idem tour, fou, cavalier) ; mat ou brillant sans sacrifice → this_is_the_way ; jamais sur une simple prise ou promotion. Jamais deux voix à moins de 2,4 s, au plus ~1 par 9 coups. **Traitement « slowed + reverb »** : voix ralentie ×0,93 (plus grave), passe-haut 170 Hz, **reverb à convolution** (réponse impulsionnelle synthétique 2,6 s) + **écho** (310 ms, retours 0,38, filtré 3,6 kHz) ; la musique baisse à 40 % pendant la voix.
**Rendu PC** : manifeste **v2** (`pacing`, `sfx[]` = {t, id, gain, bus}, `intro`, `audio.start_offset`, par événement `dur`, `freeze`, `impact`, `badge`, `level`). `nasko_chessedit.build_mix` construit un graphe FFmpeg (`-filter_complex_script`) : musique calée, chaque bruitage `adelay` à (t − onset), voix `asetrate` ×0,93 + `highpass`, puis **`afir` (reverb à convolution avec une IR générée : FFmpeg n'a pas de filtre « reverb »)** + **`aecho`** + `alimiter` ; `_to_mp4` remplace alors l'audio de Godot par ce mixage (calé à la ms). Test : `python -m unittest tests.test_chessedit_mix`.
Limites : la scène Godot ne rend pas encore l'intro, les badges, le ralenti / arrêt sur image du viral (elle joue les événements à leur heure avec son propre style) ; la musique y est décalée de `start_offset`. L'aperçu téléphone, lui, rend tout. Aucun export vidéo depuis le téléphone.

### Correctifs du rythme viral (1.41)
* **La musique démarre TOUJOURS dès le début** (`musicStart = 0`) ; c'est le montage qui s'adapte : le moment clé le plus dramatique **qu'on peut caler** tombe sur le DROP (`buildViral` essaie chaque moment clé : trop tôt → un plan d'ambiance `idle` (caméra qui orbite, jusqu'à 28 s) avant le 1ᵉʳ coup ; trop tard → temps morts resserrés jusqu'à −45 %). La musique s'éteint avec le résultat. Plafond de durée = durée de la musique.
* **Rythme beaucoup plus posé** : ouverture 1,1 → 0,9 s/coup, coups ordinaires 1 s, accéléré doux 0,44 s, importants 2,5 s (ralenti 1,1 s + arrêt 1 s), moments clés 3,5 à 4,9 s (ralenti 1,5-1,7 s + arrêt 1,5-2,6 s). Caméra et « warp » de poussière adoucis (plus de boost brutal).
* **Logos seulement** : plus de texte « EXCELLENT / BRILLANT » ; ‼ ❓ ? ⁈ ; le 👍 (meilleur coup) au plus tous les 8 coups, jamais pour « excellent ».
* **Effets** : la pièce prise devient une **ombre noire qui se délite en cendres et monte en fumée** avec des braises (`Stage.dissolve`), le roi maté part en cendres (`dissolveKing`), nouveau look **Néon violet** (défaut en AUTO, comme les références).
