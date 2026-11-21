"""Embarque en base64 (data:) les images que les jeux 3D dessinent dans des textures WebGL.
Pourquoi : dans l'application, la page est servie en file:// ; une image chargée depuis un fichier « salit » le canvas
et WebGL refuse de l'envoyer à la carte graphique (texture noire : cases de Néo-Cité, drapeaux de Flick). Une image data: n'a pas ce problème.
Sortie : assets/mobile/js/games/img_pack_<nom>.js -> window.ENOS_IMG["img/..."] = "data:image/webp;base64,..."
usage : python android/tools/pack_game_images.py"""
import base64, glob, io, json, os
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "mobile")
PACKS = {
    "neocite": [("img/games/capital/icons/*.webp", 256), ("img/games/capital/lots/*.webp", 320), ("img/games/capital/card_signal_back.webp", 512)],
    "flags": [("img/games/flick/flag_*.webp", 256)],
}

def enc(path, size):
    im = Image.open(path).convert("RGBA")
    im.thumbnail((size, size), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, "WEBP", quality=82, method=6)
    return "data:image/webp;base64," + base64.b64encode(b.getvalue()).decode()

for name, specs in PACKS.items():
    data = {}
    for pat, size in specs:
        for f in sorted(glob.glob(os.path.join(ROOT, pat))):
            data[os.path.relpath(f, ROOT).replace(os.sep, "/")] = enc(f, size)
    out = os.path.join(ROOT, "js", "games", "img_pack_%s.js" % name)
    with open(out, "w", encoding="utf-8") as fh:
        fh.write('"use strict";\n// généré par android/tools/pack_game_images.py : images des textures 3D en data: (voir le script)\n')
        fh.write("window.ENOS_IMG = Object.assign(window.ENOS_IMG || {}, %s);\n" % json.dumps(data, separators=(",", ":")))
    print(name, len(data), "images", os.path.getsize(out) // 1024, "Ko")
