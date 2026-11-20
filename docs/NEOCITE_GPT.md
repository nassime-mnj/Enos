# Néo-Cité — icônes et illustrations à demander à ChatGPT

Envoie d'abord le bloc « STYLE E.N.O.S. » de `docs/ASSETS_JEUX.md` (section 1), puis ces prompts **un par un**. Aucun texte, aucun chiffre, aucun logo dans les images. Dépose les fichiers dans `android/assets/mobile/img/games/capital/` aux chemins indiqués (PNG ou WebP, je convertis). Le jeu les utilise **automatiquement** dès qu'ils sont présents ; sinon il garde ses visuels dessinés.

## 1. Icônes des cases et de l'interface (1024×1024, PNG transparent, icône 3D centrée, lisible en petit)

| Fichier | Prompt |
|---|---|
| `icons/start.webp` | Game icon: a glowing crimson arrow bursting forward with gold coins, obsidian base, bold simple silhouette readable at small size. |
| `icons/jail.webp` | Game icon: a red laser-grid cage (digital firewall prison) around a small glowing cube, obsidian base, bold silhouette. |
| `icons/reserve.webp` | Game icon: a stack of gold coins in an obsidian vault drawer with a soft gold glow (jackpot reserve). |
| `icons/auction.webp` | Game icon: a sleek obsidian auction gavel striking, crimson shockwave ring and gold sparks. |
| `icons/audit.webp` | Game icon: the red mechanical eye scanning with a red beam (tax audit), obsidian frame. |
| `icons/signal.webp` | Game icon: a radio antenna emitting cyan waves with a mysterious glow (random event). |
| `icons/relay.webp` | Game icon: a maglev train portal with crimson rails and a cyan teleport ring. |
| `icons/antenna.webp` | Game icon: a small glossy black antenna tower with a red light on top (level-1 building). |
| `icons/tower.webp` | Game icon: a glass and obsidian skyscraper with gold crown and red glow (top building). |
| `icons/mortgage.webp` | Game icon: a property deed card locked by a gold padlock, obsidian. |
| `icons/trade.webp` | Game icon: two hands made of light exchanging a deed card and gold coins, crimson and cyan. |
| `icons/pass.webp` | Game icon: a glowing cyan access pass card with a chip, obsidian (get-out-of-firewall pass). |
| `icons/bankrupt.webp` | Game icon: a cracked obsidian coin falling apart with red sparks. |
| `icons/overdraft.webp` | Game icon: a crimson warning gauge needle in the red zone, obsidian dial. |

## 2. Illustration de chaque lot (1024×1536 portrait, s'affiche sur la carte de propriété)

Ajoute à chaque prompt : *« Night city illustration for a property card, vertical, obsidian and crimson art direction with the district color as accent, cinematic, no text. »*

| Quartier | Fichier | Prompt |
|---|---|---|
| Vieux Port (#e9dcc0) | `lots/quai_des_grues.webp` | giant harbor cranes over black water at night, container stacks lit by crimson work lights, accent color #e9dcc0. |
| Vieux Port (#e9dcc0) | `lots/rue_des_docks.webp` | narrow dock street with wet cobblestones, warehouses with glowing amber windows, mooring ropes, accent color #e9dcc0. |
| Vieux Port (#e9dcc0) | `lots/phare_noir.webp` | a black obsidian lighthouse on rocks, its beam a crimson light ray cutting through sea fog, accent color #e9dcc0. |
| Marché des Lanternes (#e8b54a) | `lots/allee_des_lanternes.webp` | a market alley under hundreds of hanging glass lanterns in gold and crimson, accent color #e8b54a. |
| Marché des Lanternes (#e8b54a) | `lots/place_du_troc.webp` | a lively trading square with futuristic market stalls, holographic price tags without text, accent color #e8b54a. |
| Marché des Lanternes (#e8b54a) | `lots/halle_d_or.webp` | a grand covered market hall with a golden glass roof and brass pillars, warm light, accent color #e8b54a. |
| Quartier Arcade (#1acfd6) | `lots/rue_pixel.webp` | an arcade street with neon-lit cabinets glowing cyan and red, reflections on wet asphalt, accent color #1acfd6. |
| Quartier Arcade (#1acfd6) | `lots/passage_neon.webp` | a covered gallery corridor of neon tubes in crimson and cyan, glossy black floor, accent color #1acfd6. |
| Quartier Arcade (#1acfd6) | `lots/salle_des_records.webp` | a pro esports arena stage with a giant screen glow, empty seats, crimson spotlights, accent color #1acfd6. |
| Campus (#8b5cf6) | `lots/bibliotheque_de_verre.webp` | a library made of glass shelves and floating glowing books, cream and violet light, accent color #8b5cf6. |
| Campus (#8b5cf6) | `lots/labo_quantique.webp` | a quantum lab with a suspended glowing violet core, cables, clean white and black surfaces, accent color #8b5cf6. |
| Campus (#8b5cf6) | `lots/dome_central.webp` | a huge glass dome campus building at dusk, violet interior glow, accent color #8b5cf6. |
| Parc des Serveurs (#14b8a6) | `lots/baie_01.webp` | rows of black server racks with teal status lights in a cold data center aisle, accent color #14b8a6. |
| Parc des Serveurs (#14b8a6) | `lots/allee_froide.webp` | a cold-aisle corridor with frost vapor and teal cooling light between server walls, accent color #14b8a6. |
| Parc des Serveurs (#14b8a6) | `lots/n_ud_principal.webp` | the core network node: a monolith of fiber optics converging into a teal light pillar, accent color #14b8a6. |
| Boulevard Écarlate (#ef1748) | `lots/galerie_rubis.webp` | a luxury gallery with ruby glass sculptures on obsidian pedestals, crimson spotlights, accent color #ef1748. |
| Boulevard Écarlate (#ef1748) | `lots/avenue_carmin.webp` | a luxury boulevard of glass skyscrapers with crimson facade lights, car light trails, accent color #ef1748. |
| Boulevard Écarlate (#ef1748) | `lots/tour_ecarlate.webp` | a slender skyscraper wrapped in scarlet light bands, piercing low clouds, accent color #ef1748. |
| Jardins Suspendus (#22c55e) | `lots/serre_flottante.webp` | a floating greenhouse dome among clouds, lush emerald plants inside, waterfalls, accent color #22c55e. |
| Jardins Suspendus (#22c55e) | `lots/pont_des_lianes.webp` | a suspended bridge covered with emerald vines between two floating gardens, accent color #22c55e. |
| Jardins Suspendus (#22c55e) | `lots/belvedere.webp` | a garden terrace viewpoint over a glowing city below, emerald trees, sunset gold, accent color #22c55e. |
| Le Sommet (#b3122f) | `lots/esplanade.webp` | a wide marble esplanade at the foot of a colossal tower, gold inlays, red banners without text, accent color #b3122f. |
| Le Sommet (#b3122f) | `lots/la_spire.webp` | a colossal black spire with gold rings, the tallest building, crimson aircraft lights, accent color #b3122f. |
| Le Sommet (#b3122f) | `lots/l_il.webp` | the summit tower crowned by the giant glowing red mechanical eye of E.N.O.S. watching the city, accent color #b3122f. |

## 3. Illustration de chaque carte événement (1024×1024, s'affiche quand on tire une carte)

| Carte | Fichier | Prompt |
|---|---|---|
| Mise à jour réussie : avance jusqu'au Départ. | `cards/start.webp` | a crimson progress bar completing with a burst of light, update success, square card illustration, cinematic, no text. |
| Correspondance express : avance jusqu'au prochain Relais. | `cards/relay.webp` | a maglev train rushing into a glowing portal, square card illustration, cinematic, no text. |
| Prix du hackathon : reçois 150. | `cards/hack.webp` | a trophy made of light on a hackathon desk with laptops and cables, square card illustration, cinematic, no text. |
| Amende réseau : verse 100 à la Réserve. | `cards/fine.webp` | a red fine ticket hologram stamped by a mechanical arm, square card illustration, cinematic, no text. |
| Intrusion détectée : va directement au Pare-feu. | `cards/jail.webp` | red alarm lights and a firewall closing like a laser gate, square card illustration, cinematic, no text. |
| Laissez-passer : sors du Pare-feu sans payer. Garde cette carte. | `cards/pass.webp` | a cyan access pass card unlocking a red laser gate, square card illustration, cinematic, no text. |
| Bug de navigation : recule de 3 cases. | `cards/back.webp` | a glitching map arrow turning backwards, square card illustration, cinematic, no text. |
| Stream viral : chaque joueur te verse 25. | `cards/viral.webp` | a phone screen exploding with hearts made of light, square card illustration, cinematic, no text. |
| Maintenance : paie 25 par antenne et 100 par tour. | `cards/maint.webp` | robot arms repairing an antenna on a rooftop at night, square card illustration, cinematic, no text. |
| Bug bounty : reçois 100. | `cards/bounty.webp` | a glowing bug icon caught in a gold net, square card illustration, cinematic, no text. |
| Facture cloud : verse 50 à la Réserve. | `cards/cloud.webp` | a dark storm cloud raining crimson invoices, square card illustration, cinematic, no text. |
| Invitation au Sommet : avance jusqu'à l'Esplanade. | `cards/summit.webp` | an invitation of light floating toward a colossal tower, square card illustration, cinematic, no text. |
| Pause bien méritée : avance jusqu'à la Réserve. | `cards/rest.webp` | a calm lounge with a charging station and soft cyan light, square card illustration, cinematic, no text. |
| Tournée générale : verse 25 à chaque joueur. | `cards/round.webp` | glasses of glowing drinks raised at a rooftop party, square card illustration, cinematic, no text. |
| Dividendes de tes actions : reçois 50. | `cards/dividend.webp` | a gold chart arrow rising out of coins, square card illustration, cinematic, no text. |
| Excès de vitesse en drone : verse 75 à la Réserve. | `cards/drone.webp` | a speeding drone flashed by a red speed camera, square card illustration, cinematic, no text. |
| Remboursement d'impôts : reçois 20. | `cards/refund.webp` | coins flying back into an obsidian wallet, square card illustration, cinematic, no text. |
| Tournoi à la Salle des Records : avance jusqu'à la Rue Pixel. | `cards/pixel.webp` | an arcade cabinet tournament with a crowd silhouette, square card illustration, cinematic, no text. |
| Contrôle fiscal surprise : va à l'Audit. | `cards/audit2.webp` | the red eye scanning stacks of documents, square card illustration, cinematic, no text. |
| Concours d'architecture : reçois 200. | `cards/jackpot.webp` | an architectural model of a tower winning a gold medal, square card illustration, cinematic, no text. |

## 4. Décor (optionnel)

| Fichier | Taille | Prompt |
|---|---|---|
| `skyline.webp` | 2048×1024 | Panoramic night skyline of a futuristic obsidian city, crimson and gold window lights, haze, seamless left-right edges, no text. |
