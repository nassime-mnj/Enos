"""PLATEAUX À COULEURS UNIES : génère assets/boards/<id>.png (1024x1024, 8x8 cases) + boards.json depuis le plateau plat Vecteezy (plat_vert/board.png).

    py godot_chess/preparer_boards.py

Le plateau Vecteezy n'a que deux couleurs (case claire, case foncée) : on remplace simplement ces deux couleurs, la géométrie reste identique
(a1 sombre, a8 clair). Pour ajouter un plateau : une ligne dans PALETTES, puis relancer ce script ; il apparaît dans le sélecteur « Plateau ».
"""
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "assets", "themes", "plat_vert", "board.png")
OUT = os.path.join(HERE, "assets", "boards")
SRC_LIGHT, SRC_DARK = (239, 238, 210), (119, 149, 85)

# id, intitulé, case claire, case foncée
PALETTES = [
    ("vecteezy_vert", "Vecteezy · Vert (original)", (239, 238, 210), (119, 149, 85)),
    ("gris_noir", "Gris & Noir", (196, 198, 201), (52, 55, 60)),
    ("noir_blanc", "Noir & Blanc", (236, 236, 236), (30, 30, 30)),
    ("ardoise", "Ardoise", (225, 229, 232), (98, 112, 126)),
    ("acier", "Bleu acier", (213, 225, 232), (120, 152, 176)),
    ("glace", "Glace", (246, 250, 253), (160, 196, 226)),
    ("ocean", "Océan", (226, 238, 245), (60, 118, 168)),
    ("bleu_nuit", "Bleu nuit", (176, 188, 214), (34, 48, 92)),
    ("neon_cyan", "Néon cyan (sombre)", (46, 66, 84), (14, 24, 34)),
    ("neon_violet", "Néon violet (sombre)", (84, 54, 124), (26, 16, 44)),
    ("violet", "Violet", (238, 232, 246), (134, 115, 170)),
    ("rose", "Rose", (252, 236, 240), (214, 128, 158)),
    ("rouge_sang", "Rouge sang", (240, 220, 215), (160, 40, 45)),
    ("noir_rouge", "Noir & Rouge (E.N.O.S.)", (96, 30, 36), (24, 8, 10)),
    ("orange", "Orange", (255, 236, 205), (226, 140, 60)),
    ("sable", "Sable", (247, 240, 205), (214, 180, 70)),
    ("noir_or", "Noir & Or", (222, 200, 140), (28, 28, 28)),
    ("bois_clair", "Bois classique", (240, 217, 181), (181, 136, 99)),
    ("noyer", "Noyer", (238, 213, 176), (140, 92, 60)),
    ("chocolat", "Crème & Chocolat", (245, 230, 205), (94, 60, 40)),
    ("turquoise", "Turquoise", (225, 245, 240), (60, 160, 150)),
    ("menthe", "Menthe", (232, 247, 236), (110, 190, 140)),
    ("lime", "Lime (ETO)", (246, 252, 230), (120, 190, 30)),
    ("foret", "Beige & Forêt", (232, 225, 200), (46, 92, 62)),
    ("corail", "Corail & Marine", (252, 232, 222), (32, 64, 100)),
    ("papier", "Papier", (245, 245, 245), (190, 190, 190)),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    src = Image.open(SRC).convert("RGB")
    px = src.load()
    assert px[10, 10] == SRC_LIGHT and px[10, 1000] == SRC_DARK or px[10, 1000] == SRC_LIGHT, "plateau source inattendu"
    meta = []
    for bid, label, light, dark in PALETTES:
        im = Image.new("RGB", src.size)
        out = im.load()
        for y in range(src.height):
            for x in range(src.width):
                out[x, y] = light if px[x, y] == SRC_LIGHT else dark
        im.save(os.path.join(OUT, bid + ".png"), optimize=True)
        meta.append({"id": bid, "label": label, "light": "#%02x%02x%02x" % light, "dark": "#%02x%02x%02x" % dark})
    with open(os.path.join(OUT, "boards.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    print(len(meta), "plateaux générés dans", OUT)


if __name__ == "__main__":
    main()
