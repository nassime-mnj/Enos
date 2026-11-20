# Néo-Cité — villes, monuments et icônes à demander à ChatGPT

Le plateau compte **24 villes réelles** réparties en **8 régions** (3 villes par région, de la moins chère à la plus chère), plus les cases spéciales. Chaque ville est illustrée par son **monument**.

Envoie d'abord le bloc « STYLE E.N.O.S. » de `docs/ASSETS_JEUX.md`, puis ce document. Aucun texte, aucun chiffre, aucun logo dans les images. Range les fichiers dans `android/assets/mobile/img/games/capital/` aux chemins indiqués (PNG ou WebP, je convertis). Le jeu les affiche automatiquement dès qu'ils sont là.

## 1. Les villes (une illustration par ville)

Format : **1024×1024**, le monument en **miniature isométrique sur un socle sombre** (comme une maquette de luxe), éclairé de nuit, petits arbres, lumières chaudes, accent de la couleur de la région, fond sombre uni ou transparent. Même cadrage pour toutes les villes.

Ajoute à chaque prompt : *« Isometric miniature diorama of the landmark on a dark obsidian base, night lighting, warm windows, subtle accent color, premium mobile game asset, centered, no text. »*

| Région (couleur) | Prix | Ville | Monument | Fichier |
|---|---|---|---|---|
| Maghreb (#e9dcc0) | 60 € | **Tunis** | Mosquée Zitouna | `lots/tunis.webp` |
| Maghreb (#e9dcc0) | 60 € | **Alger** | Monument des Martyrs | `lots/alger.webp` |
| Maghreb (#e9dcc0) | 80 € | **Casablanca** | Mosquée Hassan II | `lots/casablanca.webp` |
| Afrique (#e8b54a) | 90 € | **Dakar** | Monument de la Renaissance africaine | `lots/dakar.webp` |
| Afrique (#e8b54a) | 90 € | **Abidjan** | Cathédrale Saint-Paul | `lots/abidjan.webp` |
| Afrique (#e8b54a) | 110 € | **Le Caire** | Pyramides de Gizeh | `lots/le_caire.webp` |
| Amérique latine (#1acfd6) | 120 € | **Mexico** | Palais des Beaux-Arts | `lots/mexico.webp` |
| Amérique latine (#1acfd6) | 120 € | **Buenos Aires** | Obélisque | `lots/buenos_aires.webp` |
| Amérique latine (#1acfd6) | 140 € | **Rio de Janeiro** | Christ Rédempteur | `lots/rio_de_janeiro.webp` |
| Europe du Sud (#8b5cf6) | 150 € | **Lisbonne** | Tour de Belém | `lots/lisbonne.webp` |
| Europe du Sud (#8b5cf6) | 150 € | **Madrid** | Puerta de Alcalá | `lots/madrid.webp` |
| Europe du Sud (#8b5cf6) | 170 € | **Rome** | Colisée | `lots/rome.webp` |
| Asie (#14b8a6) | 180 € | **Bangkok** | Wat Arun | `lots/bangkok.webp` |
| Asie (#14b8a6) | 180 € | **Séoul** | Tour N Séoul | `lots/seoul.webp` |
| Asie (#14b8a6) | 200 € | **Singapour** | Marina Bay | `lots/singapour.webp` |
| Europe du Nord (#ef1748) | 220 € | **Amsterdam** | Canaux et maisons étroites | `lots/amsterdam.webp` |
| Europe du Nord (#ef1748) | 220 € | **Berlin** | Porte de Brandebourg | `lots/berlin.webp` |
| Europe du Nord (#ef1748) | 240 € | **Londres** | Tower Bridge | `lots/londres.webp` |
| Orient (#22c55e) | 260 € | **Istanbul** | Sainte-Sophie | `lots/istanbul.webp` |
| Orient (#22c55e) | 260 € | **Doha** | Musée d'art islamique | `lots/doha.webp` |
| Orient (#22c55e) | 280 € | **Dubaï** | Burj Khalifa | `lots/dubai.webp` |
| Capitales mondiales (#b3122f) | 320 € | **Tokyo** | Tokyo Tower | `lots/tokyo.webp` |
| Capitales mondiales (#b3122f) | 320 € | **New York** | Statue de la Liberté | `lots/new_york.webp` |
| Capitales mondiales (#b3122f) | 340 € | **Paris** | Tour Eiffel | `lots/paris.webp` |

## 2. Icônes (1024×1024, PNG transparent, objet 3D doré/obsidienne centré, lisible en petit)

| Fichier | Prompt |
|---|---|
| `icons/logo.webp` | Game logo emblem: a glossy obsidian square tile with a crimson neon frame and a gold four-pointed star in the center. |
| `icons/dice.webp` | Two glossy white dice with crimson pips tumbling, slight motion, isolated. |
| `icons/coins.webp` | A small stack of gold coins with a star engraved, glossy, warm glow (money). |
| `icons/gavel.webp` | A gold and dark-wood auction gavel on its round gold sound block, premium (auction). |
| `icons/trade.webp` | Two curved gold arrows forming an exchange loop, glossy metal (trade). |
| `icons/start.webp` | A glowing crimson arrow bursting forward with gold coins (start tile). |
| `icons/jail.webp` | A red laser-grid cage around a small glowing cube (firewall prison tile). |
| `icons/reserve.webp` | An obsidian treasure chest half open, full of gold coins, gold glow (jackpot reserve). |
| `icons/audit.webp` | A red mechanical eye scanning with a red beam (tax audit tile). |
| `icons/signal.webp` | A cyan antenna emitting waves with a mysterious glow (random event tile). |
| `icons/airport.webp` | A sleek white and gold airliner taking off with a crimson light trail (airport tile). |
| `icons/antenna.webp` | A small black antenna tower with a red light on top (level-1 building). |
| `icons/tower.webp` | A glass and obsidian skyscraper with gold crown and red glow (top building). |
| `icons/mortgage.webp` | A property card locked by a gold padlock. |
| `icons/bankrupt.webp` | A cracked obsidian coin falling apart with red sparks. |

## 3. Cartes événement (case Signal, 1024×1024)

| Carte | Fichier | Prompt |
|---|---|---|
| Mise à jour réussie : avance jusqu'au Départ. | `cards/start.webp` | a crimson progress bar completing with a burst of light, square card illustration, cinematic, no text. |
| Vol en correspondance : avance jusqu'au prochain Aéroport. | `cards/relay.webp` | an airliner taking off at night above city lights, square card illustration, cinematic, no text. |
| Prix du hackathon : reçois 150. | `cards/hack.webp` | a trophy of light on a hackathon desk, square card illustration, cinematic, no text. |
| Amende réseau : verse 100 à la Réserve. | `cards/fine.webp` | a red fine ticket hologram being stamped, square card illustration, cinematic, no text. |
| Intrusion détectée : va directement au Pare-feu. | `cards/jail.webp` | red alarm lights and a laser gate closing, square card illustration, cinematic, no text. |
| Laissez-passer : sors du Pare-feu sans payer. Garde cette carte. | `cards/pass.webp` | a cyan access pass card unlocking a red laser gate, square card illustration, cinematic, no text. |
| Bug de navigation : recule de 3 cases. | `cards/back.webp` | a glitching map arrow turning backwards, square card illustration, cinematic, no text. |
| Stream viral : chaque joueur te verse 25. | `cards/viral.webp` | a phone exploding with hearts made of light, square card illustration, cinematic, no text. |
| Maintenance : paie 25 par antenne et 100 par tour. | `cards/maint.webp` | robot arms repairing an antenna on a rooftop at night, square card illustration, cinematic, no text. |
| Bug bounty : reçois 100. | `cards/bounty.webp` | a glowing bug caught in a gold net, square card illustration, cinematic, no text. |
| Facture cloud : verse 50 à la Réserve. | `cards/cloud.webp` | a dark storm cloud raining crimson invoices, square card illustration, cinematic, no text. |
| Billet d'avion offert : avance jusqu'à Tokyo. | `cards/summit.webp` | a boarding pass floating toward Tokyo Tower at night, square card illustration, cinematic, no text. |
| Pause bien méritée : avance jusqu'à la Réserve. | `cards/rest.webp` | a calm VIP lounge with soft cyan light, square card illustration, cinematic, no text. |
| Tournée générale : verse 25 à chaque joueur. | `cards/round.webp` | glasses raised at a rooftop party at night, square card illustration, cinematic, no text. |
| Dividendes de tes actions : reçois 50. | `cards/dividend.webp` | a gold chart arrow rising out of coins, square card illustration, cinematic, no text. |
| Excès de vitesse en drone : verse 75 à la Réserve. | `cards/drone.webp` | a speeding drone flashed by a red camera, square card illustration, cinematic, no text. |
| Remboursement d'impôts : reçois 20. | `cards/refund.webp` | coins flying back into an obsidian wallet, square card illustration, cinematic, no text. |
| Carnaval : avance jusqu'à Mexico. | `cards/pixel.webp` | a colorful carnival parade at night in Mexico City, square card illustration, cinematic, no text. |
| Contrôle fiscal surprise : va à l'Audit. | `cards/audit2.webp` | a red eye scanning stacks of documents, square card illustration, cinematic, no text. |
| Concours d'architecture : reçois 200. | `cards/jackpot.webp` | a tower model winning a gold medal, square card illustration, cinematic, no text. |

## 4. Cases spéciales du plateau (pour info)

Départ (coin bas gauche), Pare-feu (coin haut gauche), Réserve (coin haut droit), **Enchères** (coin bas droit), Audit, 2 Aéroports (Nord et Sud), Signal.
