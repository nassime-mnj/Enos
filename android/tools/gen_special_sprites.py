"""Génère les dessins des cartes de l'Élixir + à partir des pièces d'échecs de base (même silhouette, retouchée façon carte Clash Royale) :
   m = Méga Chevalier (cavalier acier + cornes dorées + œil rouge), e = R.E.I.N.E (dame électrique + éclairs), g = Baril du fou (fou vert dans un tonneau), s = pion-squelette (Armée).
   Lancer : python android/tools/gen_special_sprites.py   -> android/assets/mobile/img/chess/{w,b}{m,e,g,s}.png"""
import math
import os
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "..", "assets", "mobile", "img", "chess")
S = 128


def load(n):
    return Image.open(os.path.join(DIR, n + ".png")).convert("RGBA")


def tint(im, light, dark, gamma=1.0):
    """Recolore une pièce : la luminance (0 = contour sombre, 1 = reflet) glisse de `dark` à `light`."""
    px = im.load()
    out = Image.new("RGBA", im.size)
    po = out.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            L = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
            L = L ** gamma
            po[x, y] = (int(dark[0] + (light[0] - dark[0]) * L), int(dark[1] + (light[1] - dark[1]) * L), int(dark[2] + (light[2] - dark[2]) * L), a)
    return out


def glow(base, color, radius=6, strength=1.0):
    """Halo coloré derrière la pièce (l'aura « de carte »)."""
    a = base.split()[3].filter(ImageFilter.GaussianBlur(radius))
    halo = Image.new("RGBA", base.size, color + (0,))
    halo.putalpha(a.point(lambda v: int(v * strength)))
    return Image.alpha_composite(halo, base)


def bolt(d, x, y, length, color, rnd, w=3):
    pts = [(x, y)]
    for i in range(5):
        x += rnd.uniform(-9, 9)
        y += length / 5
        pts.append((x, y))
    d.line(pts, fill=color, width=w, joint="curve")


def mega_knight(white):
    im = load(("w" if white else "b") + "n")
    light, dark = ((214, 232, 255), (28, 58, 120)) if white else ((150, 120, 230), (22, 10, 56))
    t = tint(im, light, dark, 0.9)
    d = ImageDraw.Draw(t)
    gold = (255, 204, 64, 255)
    # cornes dorées qui sortent du casque
    for sx in (-1, 1):
        cx = 52 + sx * 4
        d.polygon([(cx, 30), (cx + sx * 18, 14), (cx + sx * 26, 2), (cx + sx * 24, 20), (cx + sx * 10, 36)], fill=gold, outline=(120, 70, 0, 255))
    d.rectangle([22, 108, 106, 116], fill=gold, outline=(120, 70, 0, 255))              # liseré doré du socle
    d.ellipse([50, 32, 58, 40], fill=(255, 40, 40, 255))                                # œil rouge
    return glow(t, (255, 140, 30), 7, 1.0)


def reine(white):
    im = load(("w" if white else "b") + "q")
    light, dark = ((226, 255, 255), (10, 110, 125)) if white else ((120, 230, 235), (3, 30, 45))
    t = tint(im, light, dark, 0.9)
    d = ImageDraw.Draw(t)
    rnd = random.Random(7 if white else 8)
    for x in (22, 44, 64, 84, 106):                                                     # éclairs sur les pointes de la couronne
        bolt(d, x, 4, 26, (255, 255, 120, 255), rnd, 3)
    for i in range(10):
        x, y = rnd.randint(14, 114), rnd.randint(8, 100)
        d.line([(x, y), (x + rnd.randint(-8, 8), y + rnd.randint(6, 14))], fill=(150, 255, 255, 255), width=2)
    return glow(t, (60, 230, 255), 8, 1.1)


def barrel_bishop(white):
    im = load(("w" if white else "b") + "b")
    light, dark = ((205, 255, 170), (35, 100, 30)) if white else ((120, 200, 90), (12, 40, 12))
    t = tint(im, light, dark, 0.9)
    d = ImageDraw.Draw(t)
    wood, band, line = (150, 96, 44, 255), (70, 70, 78, 255), (92, 56, 22, 255)
    d.rounded_rectangle([16, 66, 112, 122], radius=14, fill=wood, outline=(60, 34, 10, 255), width=3)
    for x in (34, 52, 64, 76, 94):
        d.line([(x, 70), (x, 118)], fill=line, width=2)
    for y in (76, 108):
        d.rectangle([16, y, 112, y + 6], fill=band, outline=(30, 30, 36, 255))
    d.ellipse([46, 84, 82, 100], fill=(40, 24, 10, 255))
    return glow(t, (90, 220, 80), 6, 0.9)


def skeleton_pawn(white):
    im = load(("w" if white else "b") + "p")
    light, dark = ((246, 240, 218), (88, 80, 70)) if white else ((190, 176, 210), (30, 22, 40))
    t = tint(im, light, dark, 1.0)
    d = ImageDraw.Draw(t)
    glowc = (190, 70, 255, 255)
    d.ellipse([49, 26, 59, 38], fill=(20, 10, 30, 255))                                 # orbites
    d.ellipse([69, 26, 79, 38], fill=(20, 10, 30, 255))
    d.ellipse([52, 29, 56, 34], fill=glowc)
    d.ellipse([72, 29, 76, 34], fill=glowc)
    d.polygon([(60, 40), (64, 40), (66, 46), (62, 44), (58, 46)], fill=(30, 20, 36, 255))   # nez
    for x in range(54, 76, 5):                                                          # dents
        d.line([(x, 50), (x, 55)], fill=(40, 30, 40, 255), width=2)
    return glow(t, (170, 60, 255), 5, 0.9)


if __name__ == "__main__":
    for code, fn in (("m", mega_knight), ("e", reine), ("g", barrel_bishop), ("s", skeleton_pawn)):
        for white, c in ((True, "w"), (False, "b")):
            fn(white).save(os.path.join(DIR, c + code + ".png"))
            print("écrit", c + code + ".png")
