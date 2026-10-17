# Médias du jeu (galerie de la page /studio)

Déposer ici les images, GIF et vidéos **du jeu** (jamais l'interface de l'outil développeur), puis renseigner leur `src` dans `content.py` (liste `MEDIA`) :

    {"slot": "hero", "kind": "image", "src": "/static/media/boss-01.webp", "alt": "Combat contre un gardien rouillé", "caption": "Gardien 01", "pixel": True, ...}

- Formats : `.webp` / `.png` / `.jpg` / `.gif` / `.avif` ; vidéos `.mp4` / `.webm` (lues en boucle, muettes).
- Poids : viser < 1,5 Mo par image, < 4 Mo par vidéo (le site doit rester rapide).
- Ratios conseillés : `hero` 16:9 · `a` 5:2 · `b`, `e`, `f` 3:2 · `c` 2:3 (vertical) · `d` 2:1 — l'image est recadrée au centre (`object-fit: cover`).
- Anonymat : aucun visage, aucun nom, aucune ville ; retirer les métadonnées EXIF avant dépôt.
- Un `src` vide, un fichier absent ou une extension non autorisée : le site affiche le placeholder.
