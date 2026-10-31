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
