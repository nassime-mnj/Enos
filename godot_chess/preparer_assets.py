"""Prépare les ressources du Colis Chess pour le visualiseur Godot (relancer si le colis change) :  py preparer_assets.py
  * damier : rogné sur les 64 cases, repères a–h / 1–8 effacés (Godot les redessine, donc ils suivent le retournement du plateau), 1024×1024 ;
  * pièces : une image par type/couleur, marge transparente de 48 px (pour le halo et la traînée des shaders).
Choix retenus : Dame = modèle le plus haut (03 / 17) ; Tour = modèle classique (14 / 22) ; pion = un seul sprite par couleur."""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
COLIS = os.path.join(HERE, "..", "PourClaude")
BOARD_SRC = os.path.join(COLIS, "Gemini_Generated_Image_nnz3vmnnz3vmnnz3.jpg")
SPR = os.path.join(COLIS, "Colis Chess", "sprite_%02d.png")
PIECES = {"wk": 1, "wq": 3, "wr": 14, "wb": 9, "wn": 11, "wp": 4, "bk": 15, "bq": 17, "br": 22, "bb": 20, "bn": 21, "bp": 23}
X0, Y0, X1, Y1 = 8, 157, 1887, 2038          # cases a8..h1 dans l'image source (lignes néon mesurées)
PAD = 48


def _patch(im, dst, src):
    """Remplace la zone `dst` par la zone `src` (même couleur de case) : teinte raccordée sur l'anneau voisin + bord fondu."""
    import numpy as np
    from PIL import ImageFilter
    a = np.asarray(im).astype(float)
    src = (src[0], src[1], src[0] + dst[2] - dst[0], src[1] + dst[3] - dst[1])
    m = 14
    def ring_mean(box):
        x0, y0, x1, y1 = box
        big = a[max(0, y0 - m):y1 + m, max(0, x0 - m):x1 + m].copy()
        mask = np.ones(big.shape[:2], bool)
        ox, oy = x0 - max(0, x0 - m), y0 - max(0, y0 - m)
        mask[oy:oy + (y1 - y0), ox:ox + (x1 - x0)] = False
        return big[mask].mean(axis=0)
    shift = ring_mean(dst) - ring_mean(src)
    x0, y0, x1, y1 = dst
    sx, sy = src[0], src[1]
    patch = a[sy:sy + (y1 - y0), sx:sx + (x1 - x0)] + shift
    mask = Image.new("L", (x1 - x0, y1 - y0), 0)
    inner = Image.new("L", (x1 - x0 - 16, y1 - y0 - 16), 255)
    mask.paste(inner, (8, 8))
    alpha = np.asarray(mask.filter(ImageFilter.GaussianBlur(5))).astype(float)[:, :, None] / 255
    a[y0:y1, x0:x1] = a[y0:y1, x0:x1] * (1 - alpha) + patch * alpha
    return Image.fromarray(np.clip(a, 0, 255).astype("uint8"))


def board():
    im = Image.open(BOARD_SRC).convert("RGB").crop((X0, Y0, X1, Y1))
    w, h = im.size
    sw, sh = w / 8, h / 8
    # numéros (coin haut-gauche des cases de la colonne a) : repris de la colonne c (même couleur de case)
    for r in range(8):
        dst = (8, int(r * sh + 10), 118, int(r * sh + 125))
        im = _patch(im, dst, (dst[0] + int(2 * sw), dst[1]))
    # lettres (coin bas-droit des cases de la rangée 1) : reprises deux rangées plus haut
    for c in range(8):
        dst = (int((c + 1) * sw - 125), int(8 * sh - 130), int((c + 1) * sw - 8), int(8 * sh - 3))
        im = _patch(im, dst, (dst[0], dst[1] - int(2 * sh)))
    return im.resize((1024, 1024), Image.LANCZOS)


# ---- thèmes de pièces : assets/themes/<nom>/{wk,wq,…,bp}.png + theme.json (hauteurs en cases, marge, filtrage)
THEME_HEIGHTS_CLASSIC = {"k": 1.35, "q": 1.25, "r": 0.95, "b": 1.1, "n": 1.05, "p": 0.82}
# Colis « colis new theme blancs » (glace, pièces blanches) et « colis new theme noirs » (fil de fer rouge, pièces noires). Sprites très petits
# (~70 px) : agrandis ×3 (Lanczos) pour que le halo et les shaders restent propres. Attribution déduite de la planche-contact (K/Q à confirmer).
THEME_GLACE_ROUGE = {
    "white": ("colis new theme blancs", {"k": 3, "q": 2, "r": 20, "b": 4, "n": 19, "p": 6}),
    "black": ("colis new theme noirs", {"k": 5, "q": 4, "r": 8, "b": 6, "n": 2, "p": 9}),
}
THEME_HEIGHTS_GLACE = {"k": 1.15, "q": 1.12, "r": 0.95, "b": 1.0, "n": 1.0, "p": 0.82}
# icônes de jugement (colis « Colis Chess moves image »)
BADGES = {"brilliant": 1, "blunder": 2, "book": 3, "mistake": 8, "inaccuracy": 7, "good": 9, "excellent": 10, "best": 11, "great": 12}


def _pad_save(im, path):
    im = im.convert("RGBA").crop(im.convert("RGBA").getchannel("A").getbbox())
    canvas = Image.new("RGBA", (im.width + 2 * PAD, im.height + 2 * PAD), (0, 0, 0, 0))
    canvas.paste(im, (PAD, PAD))
    canvas.save(path)
    return canvas.size


def themes(out):
    import json
    base = os.path.join(out, "themes")
    classic = os.path.join(base, "classic")
    os.makedirs(classic, exist_ok=True)
    for name, n in PIECES.items():
        _pad_save(Image.open(SPR % n), os.path.join(classic, name + ".png"))
    json.dump({"label": "Menace Rouge (classique)", "pad": PAD, "heights": THEME_HEIGHTS_CLASSIC}, open(os.path.join(classic, "theme.json"), "w", encoding="utf-8"), indent=1)
    gr = os.path.join(base, "glace_rouge")
    if all(os.path.isdir(os.path.join(COLIS, d)) for d, _ in THEME_GLACE_ROUGE.values()):
        os.makedirs(gr, exist_ok=True)
        for side, (folder, mp) in THEME_GLACE_ROUGE.items():
            for t, n in mp.items():
                im = Image.open(os.path.join(COLIS, folder, "sprite_%02d.png" % n)).convert("RGBA")
                im = im.resize((im.width * 3, im.height * 3), Image.LANCZOS)
                _pad_save(im, os.path.join(gr, ("w" if side == "white" else "b") + t + ".png"))
        json.dump({"label": "Glace & Rouge (nouveau)", "pad": PAD, "heights": THEME_HEIGHTS_GLACE}, open(os.path.join(gr, "theme.json"), "w", encoding="utf-8"), indent=1)
        print("thème glace_rouge prêt")


# ---- thème « Plat vert » : pièces vectorielles Vecteezy (zip dans PourClaude), extraites case par case du plateau JPG
VECTEEZY_ZIP = os.path.join(COLIS, "vecteezy_chess-board-with-pieces-set-for-strategy-games-and_85633439.zip")
FLAT_CELLS = {"wr": (0, 7), "wn": (1, 7), "wb": (2, 7), "wk": (3, 7), "wq": (4, 7), "wp": (0, 6),
              "br": (0, 0), "bn": (1, 0), "bb": (2, 0), "bk": (3, 0), "bq": (4, 0), "bp": (0, 1)}      # (colonne, rangée) sur l'image : a1 = (0, 7)
FLAT_GRID = (87.0, 87.0, 1833.0, 1833.0)
THEME_HEIGHTS_FLAT = {"k": 1.05, "q": 1.02, "r": 0.9, "b": 0.97, "n": 0.95, "p": 0.8}


def _cut_cell(im, col, row):
    """Une pièce détourée : la couleur de la case (lue dans le coin) devient transparente, partout dans la case (trous du fou, de la couronne…)."""
    import numpy as np
    x0, y0, x1, y1 = FLAT_GRID
    cw, ch = (x1 - x0) / 8, (y1 - y0) / 8
    box = (int(x0 + col * cw) + 3, int(y0 + row * ch) + 3, int(x0 + (col + 1) * cw) - 3, int(y0 + (row + 1) * ch) - 3)
    cell = np.asarray(im.crop(box).convert("RGB")).astype(float)
    bg = cell[2:8, 2:8].reshape(-1, 3).mean(axis=0)
    dist = np.sqrt(((cell - bg) ** 2).sum(axis=2))
    alpha = np.clip((dist - 10.0) / 22.0, 0.0, 1.0)
    edge = (alpha > 0) & (alpha < 1)
    cell[edge] = (34.0, 34.0, 34.0)                                         # pixels de bord = mélange contour/case : on garde le contour sombre, sans liseré de la couleur de case
    out = np.dstack([cell, alpha * 255.0]).astype("uint8")
    return Image.fromarray(out, "RGBA")


def theme_flat(out):
    import json
    import zipfile
    if not os.path.isfile(VECTEEZY_ZIP):
        return
    from io import BytesIO
    with zipfile.ZipFile(VECTEEZY_ZIP) as z:
        jpg = next(n for n in z.namelist() if n.lower().endswith(".jpg"))
        im = Image.open(BytesIO(z.read(jpg))).convert("RGB")
    d = os.path.join(out, "themes", "plat_vert")
    os.makedirs(d, exist_ok=True)
    for name, (c, r) in FLAT_CELLS.items():
        piece = _cut_cell(im, c, r)
        piece = piece.resize((piece.width * 2, piece.height * 2), Image.LANCZOS)           # ×2 : le halo et les shaders restent propres
        _pad_save(piece, os.path.join(d, name + ".png"))
    # échiquier du thème : cases reconstruites avec les VRAIES couleurs du jeu Vecteezy (échantillonnées sur des cases vides), 8x8 cases de 128 px
    x0, y0, x1, y1 = FLAT_GRID
    cw, ch = (x1 - x0) / 8, (y1 - y0) / 8
    def sample(col, row):
        return im.getpixel((int(x0 + (col + 0.5) * cw), int(y0 + (row + 0.5) * ch)))
    light, dark = sample(0, 4), sample(1, 4)                                  # a4 (claire) et b4 (verte) : rangée vide
    if sum(light) < sum(dark):
        light, dark = dark, light
    bd = Image.new("RGB", (1024, 1024))
    for r in range(8):
        for c in range(8):
            bd.paste(light if (r + c) % 2 == 0 else dark, (c * 128, r * 128, c * 128 + 128, r * 128 + 128))
    bd.save(os.path.join(d, "board.png"))
    json.dump({"label": "Plat vert (Vecteezy)", "pad": PAD, "heights": THEME_HEIGHTS_FLAT}, open(os.path.join(d, "theme.json"), "w", encoding="utf-8"), indent=1)
    with open(os.path.join(d, "CREDITS.txt"), "w", encoding="utf-8") as f:
        f.write("Pièces : Vecteezy « Chess board with pieces set for strategy games » (#85633439). Licence : voir Vecteezy-License-Information.pdf dans le zip (attribution requise en licence gratuite).\n")
    print("thème plat_vert prêt")


def badges(out):
    os.makedirs(os.path.join(out, "badges"), exist_ok=True)
    web = os.path.join(HERE, "..", "static", "badges")
    os.makedirs(web, exist_ok=True)
    src = os.path.join(COLIS, "Colis Chess moves image", "sprite_%02d.png")
    if not os.path.isfile(src % 1):
        return
    for key, n in BADGES.items():
        im = Image.open(src % n).convert("RGBA")
        im.resize((128, 128), Image.LANCZOS).save(os.path.join(out, "badges", key + ".png"))
        im.resize((96, 96), Image.LANCZOS).save(os.path.join(web, key + ".png"))
    print("icônes de jugement prêtes :", ", ".join(BADGES))


def main():
    out = os.path.join(HERE, "assets")
    os.makedirs(out, exist_ok=True)
    board().save(os.path.join(out, "board.png"))
    themes(out)
    theme_flat(out)
    badges(out)
    os.makedirs(os.path.join(out, "pieces"), exist_ok=True)
    for name, n in PIECES.items():
        im = Image.open(SPR % n).convert("RGBA")
        im = im.crop(im.getchannel("A").getbbox())
        canvas = Image.new("RGBA", (im.width + 2 * PAD, im.height + 2 * PAD), (0, 0, 0, 0))
        canvas.paste(im, (PAD, PAD))
        canvas.save(os.path.join(out, "pieces", name + ".png"))
        print(name, canvas.size)


if __name__ == "__main__":
    sys.exit(main())
