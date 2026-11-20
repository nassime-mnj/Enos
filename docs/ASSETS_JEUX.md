# Assets des nouveaux jeux ETO — liste de génération (ChatGPT / générateur d'images)

Jeux : **ETO Capital** (jeu de plateau immobilier, original), **Bowling**, **Ping-pong**, **Basket**, **Flick Foot / Flick Hockey** (équipes de palets sur un terrain, vue du dessus), **Mini-golf**, **CHROMA** (jeu de cartes « défausse », original), **Poker**, **Dames**, **Loup-garou**.

---

## 0. Mode d'emploi

1. Dans une conversation ChatGPT, **envoie d'abord le bloc « STYLE E.N.O.S. »** (section 1), plus deux images de référence de l'app pour qu'il cale la DA :
   `android/assets/mobile/img/ui/eyeking.webp` et `android/assets/mobile/img/ui/arena.webp`.
2. Puis envoie les prompts **un par un** (ou par lots de 4 maximum), en recopiant la ligne entière.
3. Pour chaque image :
   - la **taille** indiquée (1024×1024, 1024×1536 portrait, 1536×1024 paysage) ;
   - **fond transparent** quand c'est marqué `PNG transparent` ;
   - **aucun texte, aucun logo, aucune marque** dans l'image (les textes sont ajoutés par l'app).
4. Enregistre chaque fichier sous le **nom indiqué**, rangé dans `android/assets/mobile/img/games/<jeu>/`. Je convertis tout en WebP et je redimensionne.
5. Si une image ne colle pas à la DA, renvoie : « Même image, plus sombre, néon cramoisi plus présent, matériaux obsidienne brillants, pas de texte. »

> Règles : aucune reprise de jeux existants (pas de Monopoly, UNO, Plato, Thiercelieux : ni noms, ni plateaux, ni cartes, ni personnages). Tout est original, dans notre DA.

---

## 1. Bloc « STYLE E.N.O.S. » (à envoyer en premier)

```
You are generating game assets for a premium mobile/PC game suite called ETO (brand universe E.N.O.S.).
Art direction for EVERY image of this conversation:
- Mood: dark, cinematic, luxurious, "AAA esports" — high contrast, HDR glow, volumetric light.
- Palette: obsidian black and graphite (#08090d, #14151b, #1b1c23) as the base; crimson red neon (#ef1748, #ff3d63) as the main accent;
  secondary accents: ETO cyan (#1acfd6), gold (#e8b54a), soft cream (#e5dfd6). Very little saturated color besides these.
- Materials: glossy black obsidian, brushed dark metal, smoked glass, polished gold trims, subtle carbon fiber. Clean, premium, no clutter.
- Lighting: red rim lights, volumetric crimson haze/smoke in the background, soft reflections on glossy floors, bloom on light sources.
- Rendering: semi-realistic stylized 3D render (like a high-end mobile game key art), sharp details, smooth gradients, no grain, no noise.
- Characters: E.N.O.S. is a giant glowing red mechanical eye (iris made of concentric red light rings); ETO is a friendly robot head with a black glossy
  visor face and a cyan glowing smile + two cyan eyes, round, sleek.
- Absolutely NO text, NO letters, NO numbers (unless asked), NO logos, NO watermarks, NO real brands.
- Sprites marked "transparent PNG": isolated object, transparent background, no shadow box, centered, slight soft contact shadow only if asked.
- Backgrounds: leave a calm darker area where UI will sit (center for game boards, bottom third for portraits).
Reply only with the image.
```

---

## 2. Communs à tous les jeux (`img/games/common/`)

| # | Fichier | Taille | Prompt |
|---|---|---|---|
| C1 | `hub_bg.png` | 1536×1024 | Wide key art of an obsidian game lounge at night: glossy black floor reflecting crimson neon lines, floating holographic silhouettes of a bowling pin, a basketball, a playing card, a golf flag, a checkers piece and a ping-pong paddle orbiting a giant red mechanical eye in the haze. Dark center for UI. |
| C2 | `hub_bg_portrait.png` | 1024×1536 | Same scene as C1, vertical composition for a phone, the red eye at the top, objects floating below, dark lower half for UI. |
| C3 | `card_capital.png` | 1536×1024 | Game cover: a miniature futuristic obsidian city on a game board, crimson neon streets, gold rooftops, two glossy dice mid-air, red haze. |
| C4 | `card_bowling.png` | 1536×1024 | Game cover: a bowling ball of black obsidian with red glowing veins smashing glossy white pins with red stripes, sparks and red light streaks, dark lane. |
| C5 | `card_pingpong.png` | 1536×1024 | Game cover: a black and crimson ping-pong paddle hitting a glowing white ball, motion trail of red light, obsidian table edge, dark arena. |
| C6 | `card_basket.png` | 1536×1024 | Game cover: a basketball with dark leather and subtle red seams swishing through a chrome hoop with a crimson neon backboard, dark arena with light beams. |
| C7 | `card_flick.png` | 1536×1024 | Game cover: top-down tilted view of glossy round player discs on a dark green-black pitch with crimson neon lines, one disc flicked toward a ball with a light trail. |
| C8 | `card_golf.png` | 1536×1024 | Game cover: mini-golf hole on an obsidian island floating in red mist, glossy dark green turf, gold flag pin, a white golf ball rolling with a cyan trail. |
| C9 | `card_chroma.png` | 1536×1024 | Game cover: a fan of five original game cards in crimson, cyan, gold, violet and black, glossy, flying over a dark table with red haze. Cards show only abstract symbols. |
| C10 | `card_poker.png` | 1536×1024 | Game cover: obsidian poker table with crimson felt, stacks of black-and-gold chips, two cards face down, the red eye reflected in the table, cinematic. |
| C11 | `card_dames.png` | 1536×1024 | Game cover: a checkers board of glossy black and cream squares with obsidian and crimson round pieces, one crowned piece glowing gold, dramatic low angle. |
| C12 | `card_loup.png` | 1536×1024 | Game cover: a medieval village at night under a huge crimson moon, silhouette of a werewolf on a rooftop, warm windows, fog, dark and atmospheric. |
| C13 | `eto_sport.png` | 1024×1024, PNG transparent | ETO robot head (black glossy visor, cyan smile and eyes) wearing a sporty headband with a red stripe, cheerful, 3/4 view. |
| C14 | `eto_win.png` | 1024×1024, PNG transparent | ETO robot head celebrating, cyan eyes as happy arcs, small cyan sparkles around, golden confetti. |
| C15 | `eto_lose.png` | 1024×1024, PNG transparent | ETO robot head disappointed, cyan eyes as sad curves, a small cyan sweat drop. |
| C16 | `enos_eye.png` | 1024×1024, PNG transparent | Giant red mechanical eye of E.N.O.S., concentric red light rings, obsidian metal shell, front view, glowing. |
| C17 | `enos_win.png` | 1024×1024, PNG transparent | E.N.O.S. red eye glowing intensely with red lightning arcs around it, menacing and victorious. |
| C18 | `fx_victory.png` | 1024×1024, PNG transparent | Golden victory burst: radial light rays, gold and crimson sparkles, laurel-like abstract shape, no text. |
| C19 | `fx_defeat.png` | 1024×1024, PNG transparent | Shattered dark glass burst with crimson cracks and dim red sparks, no text. |
| C20 | `fx_confetti.png` | 1024×1024, PNG transparent | Scattered confetti pieces in crimson, gold, cyan and cream, various shapes, for overlay. |
| C21 | `fx_spark_red.png` | 1024×1024, PNG transparent | Single crimson energy spark/flare with bloom, for particle effects. |
| C22 | `fx_spark_cyan.png` | 1024×1024, PNG transparent | Single cyan energy spark/flare with bloom, for particle effects. |
| C23 | `fx_ring.png` | 1024×1024, PNG transparent | Thin glowing crimson shockwave ring, for impacts. |
| C24 | `coin.png` | 1024×1024, PNG transparent | Premium coin of black obsidian with a gold rim and an engraved stylized eye, slight tilt. |
| C25 | `trophy.png` | 1024×1024, PNG transparent | Trophy cup of black obsidian and gold with a red glowing gem, premium. |
| C26 | `medal_gold.png` / `medal_silver.png` / `medal_bronze.png` | 1024×1024 each, PNG transparent | Medal with a crimson ribbon, (gold / silver / bronze) disc engraved with an abstract eye. Three separate images. |
| C27 | `table_wood_dark.png` | 1024×1024 | Seamless top-down texture of very dark smoked wood with subtle grain, tileable. |
| C28 | `felt_crimson.png` | 1024×1024 | Seamless top-down texture of deep crimson felt with fine fibers, tileable. |
| C29 | `felt_obsidian.png` | 1024×1024 | Seamless top-down texture of near-black felt with a faint red sheen, tileable. |
| C30 | `stadium_crowd.png` | 1536×1024 | Dark stadium stands full of blurred silhouettes, crimson spotlights, phone flashes like stars, no faces visible, no text. |

---

## 3. ETO Capital — jeu de plateau immobilier original (`img/games/capital/`)

Concept : une ville néon (« Néo-Cité ») en 8 quartiers de 3 lots, plus des cases spéciales : Départ, Pare-feu (prison), Recharge (parking), Audit (aller au pare-feu), Signal et Archive (cartes), Taxe réseau, 4 Relais (gares), 2 Services.

| # | Fichier | Taille | Prompt |
|---|---|---|---|
| K1 | `board_bg.png` | 1024×1024 | Top-down view of a square game board made of black obsidian with a crimson neon border and gold inlays, the center shows a miniature night city skyline seen from above in red haze; the outer ring is 40 empty glossy tiles (no text). |
| K2 | `table_bg.png` | 1536×1024 | Dark luxurious room, the game board on an obsidian table lit by a crimson ceiling light, depth of field, empty space around for UI. |
| K3–K10 | `district_1.png` … `district_8.png` | 1024×1024 | 8 separate images, isometric miniature city district on an obsidian base, each with its own identity and color stripe: (1) old harbor with cranes, cream; (2) street market with lanterns, gold; (3) arcade quarter with neon signs, cyan; (4) university campus with glass domes, violet; (5) data-center park with server towers, teal; (6) luxury boulevard with glass skyscrapers, crimson; (7) floating gardens, emerald; (8) the summit tower with a giant red eye on top, deep red and gold. No text. |
| K11 | `tile_start.png` | 1024×1024 | Corner tile art: a glowing crimson arrow on obsidian with gold coins bursting, no text. |
| K12 | `tile_firewall.png` | 1024×1024 | Corner tile art: a red laser grid cage (digital jail) around a small glowing cube, obsidian base. |
| K13 | `tile_recharge.png` | 1024×1024 | Corner tile art: a charging station with cyan energy, calm lounge, obsidian base. |
| K14 | `tile_audit.png` | 1024×1024 | Corner tile art: the red mechanical eye scanning with a red beam pointing toward the jail, obsidian base. |
| K15 | `tile_signal.png` | 1024×1024 | Tile art: a radio antenna emitting cyan waves, obsidian base. |
| K16 | `tile_archive.png` | 1024×1024 | Tile art: a stack of glowing gold data cards in a vault drawer, obsidian base. |
| K17 | `tile_tax.png` | 1024×1024 | Tile art: a red glowing coin being sliced by a laser, obsidian base. |
| K18 | `tile_relay.png` | 1024×1024 | Tile art: a maglev train station portal with crimson rails, obsidian base. |
| K19 | `tile_power.png` | 1024×1024 | Tile art: a sleek energy reactor with red core. |
| K20 | `tile_water.png` | 1024×1024 | Tile art: a futuristic water tower with cyan liquid glowing. |
| K21–K28 | `pawn_eye.png`, `pawn_eto.png`, `pawn_knight.png`, `pawn_rocket.png`, `pawn_crown.png`, `pawn_cat.png`, `pawn_car.png`, `pawn_drone.png` | 1024×1024 each, PNG transparent | Game token figurines in polished obsidian with gold trims, one per image: a red eye orb; the ETO robot head; a chess knight; a small rocket; a crown; a sitting cat; a sports car; a hovering drone. Each on a small round base, 3/4 view. |
| K29 | `dice.png` | 1024×1024, PNG transparent | Two glossy black dice with crimson glowing pips, tumbling. |
| K30 | `die_faces.png` | 1536×1024, PNG transparent | Six separate die faces in a row (1 to 6 pips), black glossy cube faces with crimson pips, front view, evenly spaced. |
| K31 | `antenna.png` | 1024×1024, PNG transparent | Small building piece: a glossy black antenna tower with a red light (level 1 upgrade, like a "house"). |
| K32 | `tower.png` | 1024×1024, PNG transparent | Bigger building piece: a glass and obsidian skyscraper with gold crown and red glow (top upgrade, like a "hotel"). |
| K33 | `deed_frame.png` | 1024×1536, PNG transparent | Empty title-deed card frame: obsidian card, gold border, empty color band on top, empty space for text, no text. |
| K34 | `card_signal_back.png` | 1024×1536 | Card back: obsidian with cyan radio-wave emblem, gold border. |
| K35 | `card_archive_back.png` | 1024×1536 | Card back: obsidian with gold vault emblem, crimson border. |
| K36 | `bill_set.png` | 1536×1024, PNG transparent | Six fantasy banknotes fanned out, black and crimson with gold guilloche patterns and an abstract eye, different colors per value (cream, cyan, gold, violet, crimson, black), no numbers, no text. |
| K37 | `auction_bg.png` | 1024×1536 | Dark auction hall with a crimson spotlight on an empty pedestal, red haze. |
| K38 | `bankrupt.png` | 1024×1024, PNG transparent | Cracked obsidian coin falling apart with red sparks. |

---

## 4. Bowling (`img/games/bowling/`)

| # | Fichier | Taille | Prompt |
|---|---|---|---|
| B1 | `lane_bg.png` | 1024×1536 | First-person view down a bowling lane: glossy dark wood with crimson neon gutters, pins at the far end under a red spotlight, dark arena with red haze, empty foreground. |
| B2 | `lane_top.png` | 1024×1536 | Top-down orthographic view of a single bowling lane, dark polished wood, crimson gutter lights, arrows and dots inlaid in gold (no text). |
| B3 | `pin.png` | 1024×1024, PNG transparent | Single bowling pin, glossy white with two crimson stripes, front view, upright. |
| B4 | `pin_fallen.png` | 1024×1024, PNG transparent | Same bowling pin lying on its side, slight angle. |
| B5–B10 | `ball_obsidian.png`, `ball_crimson.png`, `ball_cyan.png`, `ball_gold.png`, `ball_galaxy.png`, `ball_eye.png` | 1024×1024 each, PNG transparent | Bowling ball (one per image, finger holes visible): black obsidian with red veins; glossy crimson pearl; cyan swirl; brushed gold; dark galaxy with red nebula; black with a glowing red eye pattern. |
| B11 | `fx_strike.png` | 1024×1024, PNG transparent | Explosive impact burst of crimson and gold light with pin fragments silhouettes, no text. |
| B12 | `fx_spare.png` | 1024×1024, PNG transparent | Clean cyan light burst, elegant, no text. |
| B13 | `return_machine.png` | 1024×1024, PNG transparent | Futuristic ball return machine, obsidian with crimson light strip. |
| B14 | `alley_wide.png` | 1536×1024 | Wide view of a luxury bowling alley at night, multiple lanes, crimson neon, black glossy floor reflections. |

---

## 5. Ping-pong (`img/games/pingpong/`)

| # | Fichier | Taille | Prompt |
|---|---|---|---|
| P1 | `table_top.png` | 1024×1536 | Top-down orthographic view of a ping-pong table: matte obsidian surface, thin cream lines, crimson net with gold posts, glossy edges, on a dark floor. |
| P2 | `arena_bg.png` | 1024×1536 | Dark sports hall with spotlights on a ping-pong table from a high angle, crimson light beams, blurred crowd, empty center. |
| P3–P6 | `paddle_crimson.png`, `paddle_obsidian.png`, `paddle_cyan.png`, `paddle_gold.png` | 1024×1024 each, PNG transparent | Ping-pong paddle (one per image): crimson rubber with black handle; black rubber with carbon handle and red edge; cyan rubber with white handle; black rubber with gold handle. Slight 3/4 view. |
| P7 | `ball.png` | 1024×1024, PNG transparent | White ping-pong ball, subtle shading. |
| P8 | `fx_smash.png` | 1024×1024, PNG transparent | Ball impact flash with crimson speed lines, no text. |
| P9 | `net_side.png` | 1536×1024, PNG transparent | Side view of a crimson net with gold posts, isolated. |

---

## 6. Basket (`img/games/basket/`)

| # | Fichier | Taille | Prompt |
|---|---|---|---|
| A1 | `court_view.png` | 1024×1536 | Player's view of a basketball hoop in a dark arena: chrome rim, smoked glass backboard with a crimson neon square, spotlights, red haze, empty lower half. |
| A2 | `court_top.png` | 1024×1536 | Top-down view of a half basketball court: dark polished wood, crimson three-point line, gold key area lines, no text. |
| A3 | `hoop.png` | 1024×1024, PNG transparent | Basketball hoop front view: smoked glass backboard with crimson neon square, chrome rim, white net. |
| A4 | `net_swish.png` | 1024×1024, PNG transparent | White basketball net swaying as if a ball just passed, isolated. |
| A5–A7 | `ball_classic.png`, `ball_obsidian.png`, `ball_gold.png` | 1024×1024 each, PNG transparent | Basketball (one per image): dark orange leather with black seams; black leather with crimson seams; gold leather with black seams. |
| A8 | `fx_swish.png` | 1024×1024, PNG transparent | Golden ring burst with sparkles for a perfect shot, no text. |
| A9 | `fx_fire.png` | 1024×1024, PNG transparent | Stylized crimson and orange flame trail for an "on fire" streak. |
| A10 | `arena_wide.png` | 1536×1024 | Wide dark arena with a lit court, crimson light beams, crowd silhouettes, no text. |

---

## 7. Flick Foot / Flick Hockey — équipes de palets (`img/games/flick/`)

Concept : chaque équipe a 5 à 7 palets ronds (comme sur ta capture), on vise et on lance, but = faire entrer la balle / le palet.

| # | Fichier | Taille | Prompt |
|---|---|---|---|
| F1 | `pitch.png` | 1024×1536 | Top-down orthographic football pitch for a flick game: dark green-black striped turf, crimson neon lines and circle, goals at top and bottom with chrome posts, black glossy borders, no text, no flags. |
| F2 | `rink.png` | 1024×1536 | Top-down orthographic ice hockey rink: glossy pale ice with subtle scratches, crimson center line and circles, cyan blue lines, goals at top and bottom, black boards, no text. |
| F3 | `pitch_night.png` | 1024×1536 | Variant of F1 at night under spotlights, stronger red haze at the borders. |
| F4 | `stands_left.png` | 1024×1536 | Vertical strip of dark stadium stands with tiny blurred crowd and crimson lights, to place on the left side. |
| F5 | `stands_right.png` | 1024×1536 | Same as F4, mirrored, for the right side. |
| F6 | `ball.png` | 1024×1024, PNG transparent | Football: glossy black and white panels with thin crimson seams, top-down. |
| F7 | `puck.png` | 1024×1024, PNG transparent | Hockey puck: black rubber with a crimson glowing rim, top-down. |
| F8 | `disc_base.png` | 1024×1024, PNG transparent | Empty round player disc seen from above: glossy domed glass cap over an empty center, chrome rim, for placing team emblems. |
| F9–F24 | `team_01.png` … `team_16.png` | 1024×1024 each, PNG transparent | 16 ORIGINAL team emblems (round badges, top-down, glossy domed, chrome rim), one per image, no text: (1) crimson eye; (2) cyan robot face; (3) gold crown; (4) black knight; (5) red phoenix; (6) blue shark; (7) green viper; (8) violet comet; (9) orange tiger; (10) white wolf; (11) gold lion; (12) teal kraken; (13) pink lotus; (14) silver falcon; (15) brown bear; (16) yellow lightning. |
| F25–F40 | `flag_fr.png`, `flag_br.png`, `flag_ar.png`, `flag_de.png`, `flag_es.png`, `flag_it.png`, `flag_pt.png`, `flag_gb.png`, `flag_nl.png`, `flag_be.png`, `flag_ma.png`, `flag_dz.png`, `flag_sn.png`, `flag_jp.png`, `flag_us.png`, `flag_mx.png` | 1024×1024 each, PNG transparent | Round player disc seen from above with the national flag of (France / Brazil / Argentina / Germany / Spain / Italy / Portugal / United Kingdom / Netherlands / Belgium / Morocco / Algeria / Senegal / Japan / USA / Mexico) printed under a glossy domed glass cap, chrome rim. One per image. |
| F41 | `aim_arrow.png` | 1024×1024, PNG transparent | Aiming arrow: tapered crimson glowing arrow with cyan core, pointing up. |
| F42 | `power_ring.png` | 1024×1024, PNG transparent | Translucent dark circular power gauge ring with a crimson gradient fill, top-down. |
| F43 | `fx_goal.png` | 1024×1024, PNG transparent | Goal celebration burst: crimson and gold fireworks, net silhouette, no text. |
| F44 | `goal_top.png` | 1024×1024, PNG transparent | Goal seen from above: chrome posts, white net grid, isolated. |

---

## 8. Mini-golf (`img/games/golf/`)

| # | Fichier | Taille | Prompt |
|---|---|---|---|
| G1–G9 | `hole_01.png` … `hole_09.png` | 1024×1536 each | Top-down orthographic mini-golf hole on an obsidian island floating in crimson mist, glossy dark green turf with black glossy borders, a gold-rimmed cup, no ball, no text. One per image with a different layout and theme: (1) straight warm-up; (2) L-shaped dogleg; (3) zigzag with bumpers; (4) small red lava pond; (5) ramp and bridge; (6) windmill tower made of obsidian with red blades; (7) loop of light rails; (8) moving block gates; (9) giant red eye statue at the center as the final hole. |
| G10 | `ball.png` | 1024×1024, PNG transparent | White golf ball with dimples, top-down, subtle shadow. |
| G11 | `flag.png` | 1024×1024, PNG transparent | Golf flag: gold pole with a crimson flag, isolated, side view. |
| G12 | `cup.png` | 1024×1024, PNG transparent | Golf cup seen from above: dark hole with a gold rim. |
| G13 | `club.png` | 1024×1024, PNG transparent | Putter club: black shaft, chrome head with a crimson line. |
| G14 | `bumper.png` | 1024×1024, PNG transparent | Round bumper seen from above: chrome ring with crimson glowing center. |
| G15 | `windmill.png` | 1024×1024, PNG transparent | Obsidian windmill with four red blades, slight isometric, isolated. |
| G16 | `water_tile.png` | 1024×1024 | Seamless top-down texture of dark water with red reflections, tileable. |
| G17 | `turf_tile.png` | 1024×1024 | Seamless top-down texture of short dark green synthetic turf, tileable. |
| G18 | `sky_bg.png` | 1024×1536 | Dark sky with crimson nebula and floating obsidian rocks, for behind the islands. |
| G19 | `fx_holeinone.png` | 1024×1024, PNG transparent | Golden starburst with a small white ball trail, no text. |

---

## 9. CHROMA — jeu de cartes « défausse » original (`img/games/chroma/`)

Règles originales à poser : 4 couleurs de l'univers (Cramoisi, Cyan, Or, Violet) + cartes noires spéciales. Cartes spéciales (noms à nous) : **Gel** (passe le tour), **Retour** (sens inverse), **+2 Surcharge**, **Prisme** (choisir la couleur), **+4 Œil d'E.N.O.S.** (choisir la couleur, le suivant pioche 4), **Échange** (échanger sa main).

| # | Fichier | Taille | Prompt |
|---|---|---|---|
| U1 | `card_back.png` | 1024×1536 | Card back: glossy black card with rounded corners, a central abstract prism made of four colored light beams (crimson, cyan, gold, violet), thin gold border, no text. |
| U2–U5 | `card_crimson.png`, `card_cyan.png`, `card_gold.png`, `card_violet.png` | 1024×1536 each, PNG transparent | Blank card face template with rounded corners: glossy obsidian card with a large tilted oval panel in (crimson / cyan / gold / violet) with a soft inner glow, empty center for a big number, small empty corners, no text, no numbers. One per color. |
| U6 | `card_black.png` | 1024×1536, PNG transparent | Blank black special card face, rounded corners, four tiny color dots in the corners, empty center, no text. |
| U7 | `icon_freeze.png` | 1024×1024, PNG transparent | Icon for "skip turn": a crystal ice snowflake inside a circle with a slash, white with soft glow. |
| U8 | `icon_reverse.png` | 1024×1024, PNG transparent | Icon for "reverse": two curved arrows forming a circle, white glossy. |
| U9 | `icon_plus2.png` | 1024×1024, PNG transparent | Icon: two stacked mini cards with a lightning bolt, white glossy, no numbers. |
| U10 | `icon_prism.png` | 1024×1024, PNG transparent | Icon: a glass prism splitting light into crimson, cyan, gold and violet beams. |
| U11 | `icon_eye4.png` | 1024×1024, PNG transparent | Icon: the red mechanical eye of E.N.O.S. surrounded by four small floating cards. |
| U12 | `icon_swap.png` | 1024×1024, PNG transparent | Icon: two hands of cards exchanging with circular arrows, white glossy. |
| U13 | `table_bg.png` | 1024×1536 | Top-down view of a round obsidian table with crimson felt center, soft spotlight, empty center for the discard pile. |
| U14 | `fx_chroma.png` | 1024×1024, PNG transparent | Burst of four colored light beams (crimson, cyan, gold, violet) from the center. |
| U15 | `fx_last_card.png` | 1024×1024, PNG transparent | Dramatic single glowing card silhouette with crimson aura, no text. |

---

## 10. Poker (`img/games/poker/`)

| # | Fichier | Taille | Prompt |
|---|---|---|---|
| R1 | `table_top.png` | 1536×1024 | Top-down view of an oval poker table: crimson felt with a subtle eye pattern watermark, black glossy leather rail with gold studs, 6 seat areas, empty center, no text. |
| R2 | `table_portrait.png` | 1024×1536 | Same table seen from above in portrait orientation for a phone. |
| R3 | `room_bg.png` | 1536×1024 | Exclusive dark casino lounge, crimson lamps above the table, smoke, obsidian walls, blurred, no text. |
| R4 | `card_back.png` | 1024×1536 | Playing card back: black with a fine gold guilloche pattern and the red eye in the center, thin crimson border, no text. |
| R5 | `card_face_blank.png` | 1024×1536, PNG transparent | Blank cream playing card face with rounded corners and a very subtle paper texture, empty. |
| R6–R9 | `suit_spade.png`, `suit_heart.png`, `suit_diamond.png`, `suit_club.png` | 1024×1024 each, PNG transparent | Elegant playing card suit symbol (spade / heart / diamond / club), glossy, spade and club in obsidian black with gold edge, heart and diamond in crimson with gold edge. |
| R10–R21 | `face_jack_spade.png` … `face_king_club.png` (12 images) | 1024×1536 each | Original court card portraits for (Jack / Queen / King) × (spades / hearts / diamonds / clubs): stylized premium illustration, half-body, symmetric mirrored layout like a real playing card, dark-cream background, crimson and gold costume accents, futuristic-baroque style, no letters. |
| R22–R27 | `chip_white.png`, `chip_red.png`, `chip_blue.png`, `chip_green.png`, `chip_black.png`, `chip_gold.png` | 1024×1024 each, PNG transparent | Casino chip (one per image) with edge stripes and a small engraved eye, in (cream / crimson / cyan / emerald / obsidian / gold), 3/4 view, no numbers. |
| R28 | `chip_stack.png` | 1024×1024, PNG transparent | Mixed tall stacks of the chips above, glossy. |
| R29 | `dealer_button.png` | 1024×1024, PNG transparent | Dealer button: white glossy disc with a gold rim and a crimson eye, no text. |
| R30 | `fx_allin.png` | 1024×1024, PNG transparent | Explosion of chips flying with crimson light, no text. |
| R31 | `fx_royal.png` | 1024×1024, PNG transparent | Golden crown with light rays for the best hand, no text. |

---

## 11. Dames (`img/games/dames/`)

| # | Fichier | Taille | Prompt |
|---|---|---|---|
| D1 | `board_10.png` | 1024×1024 | Top-down 10×10 checkers board: alternating glossy obsidian and cream squares, thin gold frame, crimson inner border, no coordinates. |
| D2 | `board_8.png` | 1024×1024 | Same style, 8×8 board. |
| D3 | `room_bg.png` | 1536×1024 | Dark elegant study room, the board lit by a crimson lamp, depth of field, empty sides. |
| D4 | `piece_dark.png` | 1024×1024, PNG transparent | Checkers piece seen from slightly above: glossy black obsidian disc with grooved edge and a crimson inner glow. |
| D5 | `piece_light.png` | 1024×1024, PNG transparent | Checkers piece: cream ivory disc with grooved edge and a gold inner ring. |
| D6 | `king_dark.png` | 1024×1024, PNG transparent | Two stacked black obsidian checkers pieces with a small glowing red crown emblem on top (promoted piece). |
| D7 | `king_light.png` | 1024×1024, PNG transparent | Two stacked cream checkers pieces with a small gold crown emblem on top. |
| D8 | `fx_capture.png` | 1024×1024, PNG transparent | Shattering disc fragments with crimson sparks. |
| D9 | `fx_crown.png` | 1024×1024, PNG transparent | Golden crown light burst for promotion, no text. |

---

## 12. Loup-garou (`img/games/loup/`)

Rôles (art original, aucun personnage existant) : Loup-garou, Villageois, Voyante, Sorcière, Chasseur, Cupidon, Petite fille, Garde, Ancien, Idiot du village, Corbeau, Loup blanc, Maire (badge).

| # | Fichier | Taille | Prompt |
|---|---|---|---|
| L1 | `village_night.png` | 1024×1536 | Dark medieval village square at night, a huge crimson full moon, fog, warm candle-lit windows, ominous silhouettes, empty center for UI. |
| L2 | `village_day.png` | 1024×1536 | Same village square at dawn, golden light, mist lifting, villagers' silhouettes gathering, empty center. |
| L3 | `village_wide.png` | 1536×1024 | Wide version of L1 for PC. |
| L4 | `council_fire.png` | 1024×1536 | Villagers' council around a fire at dusk, faces hidden in shadow, crimson embers. |
| L5 | `card_back.png` | 1024×1536 | Role card back: dark wood and black iron frame, a crimson moon with a wolf silhouette, gold filigree, no text. |
| L6–L17 | `role_wolf.png`, `role_villager.png`, `role_seer.png`, `role_witch.png`, `role_hunter.png`, `role_cupid.png`, `role_girl.png`, `role_guard.png`, `role_elder.png`, `role_fool.png`, `role_raven.png`, `role_whitewolf.png` | 1024×1536 each | Original role card illustration, half-body portrait in a dark painterly style, framed by black iron and gold filigree, crimson moonlight, no text. One per image: werewolf with glowing red eyes; humble villager with a lantern; seer with a glowing crystal ball (cyan light); witch holding two potions (one cyan, one crimson); hunter with a crossbow; cupid as a young archer with a crimson arrow; little girl peeking through fingers; guard with a shield; old elder with a staff; village fool with a jester hat; raven perched on a skull lantern; pure white werewolf with gold eyes. |
| L18 | `badge_mayor.png` | 1024×1024, PNG transparent | Mayor badge: gold medallion with a crimson ribbon and a tower emblem, no text. |
| L19 | `fx_death.png` | 1024×1024, PNG transparent | Eliminated effect: a crimson slash with dark smoke. |
| L20 | `fx_vote.png` | 1024×1024, PNG transparent | Voting effect: a pointing hand silhouette with a red glow. |
| L21 | `fx_moon_rise.png` | 1024×1024, PNG transparent | Crimson moon rising with mist, for night transition. |
| L22 | `fx_sun_rise.png` | 1024×1024, PNG transparent | Golden sun rays bursting through mist, for day transition. |
| L23 | `potion_life.png` / `potion_death.png` | 1024×1024 each, PNG transparent | Glass potion bottle with glowing (cyan life / crimson poison) liquid, two separate images. |
| L24 | `arrow_love.png` | 1024×1024, PNG transparent | Crimson heart-tipped arrow linking two small hearts. |
| L25 | `avatar_frame.png` | 1024×1024, PNG transparent | Round player avatar frame of black iron with gold filigree and a small crimson moon at the top, empty center. |

---

## 13. Récapitulatif

| Jeu | Images |
|---|---|
| Communs | 32 |
| ETO Capital | 38 |
| Bowling | 14 |
| Ping-pong | 9 |
| Basket | 10 |
| Flick Foot / Hockey | 44 |
| Mini-golf | 19 |
| CHROMA | 15 |
| Poker | 31 |
| Dames | 9 |
| Loup-garou | 26 |
| **Total** | **247** |

Priorité conseillée si tu veux commencer petit : Communs (C1–C12) → Flick Foot (F1, F6, F8, F25–F40, F41–F44) → Dames → CHROMA → Poker → Bowling → le reste.
Les sons (chocs, foule, cartes, dés…) se feront ensuite, à part.
