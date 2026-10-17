# Contour néon GLOBAL pour TileMapLayer (Godot 4.x)

Le néon suit la **silhouette du groupe entier** de tuiles collées. Aucune arête interne n'est tracée.

## Installer dans ton jeu (Terna)
1. Copie le dossier `addons_neon/` à la racine du projet (à côté de `project.godot`).
2. Dans l'éditeur, sélectionne ta `TileMapLayer` (les plateformes) → clic droit → **Ajouter un nœud enfant** → cherche **NeonOutline** → Créer.
3. C'est tout. Règle la couleur / l'épaisseur dans l'Inspecteur du nœud `NeonOutline`.
4. Pour un halo qui « brille » : ton projet a déjà `viewport/hdr_2d=true`. Ajoute un `WorldEnvironment` avec `Background → Mode = Canvas` et `Glow → Enabled`, `HDR Threshold = 1.0`. Les valeurs > 1 du néon (intensité halo / cœur) accrochent alors le Glow.

Si tu as plusieurs `TileMapLayer` de plateformes, mets un `NeonOutline` sous chacune (les silhouettes de deux calques différents ne fusionnent pas).

## Comment ça marche (SubViewport)
1. La TileMapLayer est rendue **seule** dans un `SubViewport` transparent (même monde 2D, isolée par `visibility_layer` / `canvas_cull_mask`).
2. L'alpha de cette image = silhouette globale. Deux tuiles collées = alpha continu → pas d'arête interne possible.
3. Le shader `neon_outline.gdshader` cherche, pour chaque pixel **vide**, la distance au pixel plein le plus proche (16 directions × `rings` anneaux) et n'allume que l'extérieur.
4. Le résultat est un `Sprite2D` recalé sur la caméra à chaque image, placé **derrière** la TileMap (`z_index = -1`) : joueur, ennemis et décor passent devant le néon.

Vérifié dans Godot 4.7.1 (Forward+) avec `demo.tscn` : groupe 2×2, forme en L, tuile isolée et sol, caméra décalée + zoom 1,5 → contour aligné au pixel.

## Limites à connaître
- **Couche de visibilité n°20** réservée au composant (`ISOLATION_BIT`). Change-la dans `neon_outline.gd` si ton jeu l'utilise.
- Le bit est posé aussi sur les **parents** de la TileMapLayer (exigence de Godot). Si un parent dessine lui-même (ex. un `Sprite2D` parent), il apparaîtrait dans la silhouette : garde des parents « vides » (`Node2D`).
- Si l'art de tes tuiles a des **coins transparents** (tuiles arrondies), ces coins sont « vides » : le néon s'y glisse. Utilise des tuiles pleines sur les bords collés.
- Ne gère que le canvas par défaut : une TileMapLayer placée dans un `CanvasLayer` n'est pas rendue (même `world_2d`, mais autre canvas).
- Coût : un second rendu de la TileMap + 16×`rings` lectures par pixel vide. `rings = 6` suffit jusqu'à 12 px d'épaisseur ; baisse-le si besoin. `supersample = 2` pour écrans 4K.
- Terna possède déjà `ContourNeonTuiles` (contour géométrique par arêtes de cellules, très léger). Les deux approches donnent la même règle d'or ; celle-ci gère aussi les formes non rectangulaires et les tuiles « grignotées ».

## Tester
`Godot --path godot_neon` (ou ouvrir le dossier et F5). Capture : `-- --capture sortie.png`.
