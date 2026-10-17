"""VISAGE 8-BIT D'ETO : génère l'atlas de sprites (pixel-art 64x64) partagé par l'interface web et les plateaux Godot.

    py godot_chess/preparer_eto8.py            -> static/eto8_{atlas.png,index.json} + copies dans godot_chess/eto8 et godot_eye/eto8
    py godot_chess/preparer_eto8.py --sheet X  -> planche-contact de toutes les expressions (X = chemin du png)

Un seul dessinateur (ce fichier) pour les deux moteurs : les expressions sont décrites par les paramètres de static/eto_expressions.json
(yeux, sourcils, bouche, joues, larmes, effets…), le moteur (JS / GDScript) ne fait que choisir et poser des sprites :
  corps (boule perlée) + calque HAUT (yeux, sourcils, joues, larmes ; 3 phases de clignement) + calque BOUCHE (4 niveaux de parole)
  + effets animés (cœurs, étincelles, zzz, ?, !, …) ; le regard décale les calques d'un pixel entier, jamais de flou.
"""
import json
import math
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
S = 64                                   # taille d'un sprite (pixels logiques)
CX, CY, R = 32, 33, 24                   # boule

# ---------------------------------------------------------------- palette (16 couleurs + nuances, style NES/GBA)
NAVY = (16, 48, 10, 255)
BLUE_T = (190, 255, 96, 255)
BLUE_M = (124, 214, 20, 255)
BLUE_L = (66, 146, 14, 255)
SKY = (208, 255, 150, 255)
WHITE = (255, 255, 255, 255)
ROSE = (255, 140, 178, 255)
PINK_D = (226, 86, 138, 255)
RED = (236, 52, 76, 255)
RED_D = (150, 20, 50, 255)
RED_T = (255, 120, 120, 255)
YELLOW = (255, 214, 77, 255)
ORANGE = (255, 152, 56, 255)
MOUTH = (12, 40, 8, 255)
TONGUE = (255, 112, 146, 255)
TEAR = (170, 240, 110, 255)
BODY = [(255, 255, 255), (245, 252, 236), (228, 245, 208), (196, 226, 160), (158, 200, 112)]
BAYER = [[0, 2], [3, 1]]


def new():
    return Image.new("RGBA", (S, S), (0, 0, 0, 0))


def px(img, x, y, col):
    if 0 <= x < S and 0 <= y < S:
        img.putpixel((int(x), int(y)), col)


def pattern(img, rows, x0, y0, pal):
    """Colle un motif ASCII : chaque caractère est une clé de `pal` ('.' = transparent)."""
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch != "." and ch in pal:
                px(img, x0 + i, y0 + j, pal[ch])


def line(img, pts, col, thick=1):
    for (x, y) in pts:
        for t in range(thick):
            px(img, x, y + t, col)


# ---------------------------------------------------------------- corps : boule perlée dithérée
def body():
    img = new()
    lx, ly, lz = -0.52, -0.66, 0.54
    n = math.sqrt(lx * lx + ly * ly + lz * lz)
    lx, ly, lz = lx / n, ly / n, lz / n
    for y in range(S):
        for x in range(S):
            dx, dy = x + 0.5 - CX, y + 0.5 - CY                          # centre des pixels : cercle parfaitement symétrique (pas d ergots aux 4 points cardinaux)
            d = math.hypot(dx, dy)
            if d > R:
                continue
            if d > R - 1.2:
                px(img, x, y, (26, 66, 14, 255))                       # contour vert forêt
                continue
            nz = math.sqrt(max(0.0, 1 - (d / R) ** 2))
            lum = (dx / R) * lx + (dy / R) * ly + nz * lz               # -1..1
            v = (1 - (lum + 0.25) / 1.25) * 4                            # 0 (clair) .. 4 (sombre)
            v = max(0.0, min(4.0, v * 0.92 + 0.2))
            band = int(v)
            frac = v - band
            frac = max(0.0, min(1.0, (frac - 0.3) / 0.4))                # dithering de Bayer seulement à la frontière entre deux teintes : le grain « 8-bit », sans bruit
            if frac > (BAYER[y % 2][x % 2] + 0.5) / 4:
                band = min(4, band + 1)
            px(img, x, y, BODY[band] + (255,))
    # reflet principal (gros) + petit reflet + liseré de lumière en bas
    pattern(img, ["..XXXXX..", ".XXXXXXXX.", "XXXXX....."[:9], "XXXX.....", "XXX......", "XX......."], 17, 15, {"X": WHITE})
    pattern(img, ["XX", "XX"], 29, 14, {"X": WHITE})
    pattern(img, [".XX", "XX."], 41, 47, {"X": (238, 252, 224, 255)})
    return img


def shadow(wide=1.0):
    img = new()
    w = int(14 * wide)
    for y, k, a in ((58, 0.72, 90), (59, 1.0, 130), (60, 0.88, 120), (61, 0.5, 80)):
        for x in range(CX - int(w * k), CX + int(w * k) + 1):
            px(img, x, y, (140, 190, 110, a))
    return img


# ---------------------------------------------------------------- yeux
def eye_palette(red):
    return (RED_T, RED, RED_D) if red else (BLUE_T, BLUE_M, BLUE_L)


def draw_open_eye(img, cx, cy, bh, a, side, p, glint=1.0):
    """Œil ouvert : contour bleu nuit, dégradé en trois bandes, deux reflets. bh = demi-hauteur, a = demi-largeur, côté side (-1 gauche, +1 droite)."""
    top, mid, low = eye_palette(p.get("rd", 0) > 0.5)
    ang = p.get("ang", 0)
    pu = p.get("pu", 0)
    for y in range(-bh, bh + 1):
        t = y / max(1, bh)
        half = a * math.sqrt(max(0.0, 1 - t * t))
        for x in range(-a, a + 1):
            if abs(x) > half + 0.35:
                continue
            xx = x * -side                                            # xx > 0 : côté intérieur (vers le nez)
            if ang > 0 and y < -bh + 1 + (xx + a) * ang * 0.55:      # paupière en colère : le haut de l'œil est coupé en biais
                continue
            edge = abs(x) > half - 0.75 or abs(y) == bh or (ang > 0 and y < -bh + 2 + (xx + a) * ang * 0.55)
            if pu > 0.5:
                inner = abs(x) <= 1 and abs(y) <= 1
                px(img, cx + x, cy + y, NAVY if edge else (BLUE_M if inner else WHITE))
                continue
            if edge:
                px(img, cx + x, cy + y, NAVY)
            else:
                f = (y + bh) / max(1, 2 * bh)
                px(img, cx + x, cy + y, top if f < 0.38 else (mid if f < 0.7 else low))
    if pu > 0.5:
        px(img, cx - 1, cy - 1, WHITE)
        return
    if p.get("hl", 0) > 0.5 and bh >= 4:                                 # yeux humides / brillants : gros reflet + petits reflets
        for dx in range(3):
            for dy in range(3):
                px(img, cx - a + 2 + dx, cy - bh + 2 + dy, WHITE)
        px(img, cx + a - 2, cy + bh - 3, WHITE)
        px(img, cx + a - 3, cy + bh - 4, WHITE)
        px(img, cx, cy + bh - 2, SKY)
    elif bh >= 3:
        hx, hy = cx - a + 2, cy - bh + 2
        for (dx, dy) in ((0, 0), (1, 0), (0, 1), (1, 1)):
            px(img, hx + dx, hy + dy, WHITE)
        if bh >= 4 and glint > 0.5:
            px(img, cx + a - 2, cy + bh - 3, WHITE)
            for dx in (-1, 0, 1):
                px(img, cx + dx, cy + bh - 1, SKY)
    elif bh == 2:
        px(img, cx - a + 2, cy - bh + 1, WHITE)


def draw_closed_eye(img, cx, cy, mode, col=NAVY):
    """mode 'u' : ‿ (yeux fermés, sommeil) · 'a' : ^ (joie) · 'l' : trait droit (clignement) · '>' : œil qui fait un clin d'œil."""
    if mode == "u":
        pts = [(cx - 4, cy - 1), (cx - 3, cy), (cx - 2, cy + 1), (cx - 1, cy + 1), (cx, cy + 1), (cx + 1, cy + 1), (cx + 2, cy + 1), (cx + 3, cy), (cx + 4, cy - 1)]
        line(img, pts, col)
        line(img, [(cx - 3, cy + 1), (cx + 3, cy + 1)], col) if False else None
    elif mode == "a":
        pts = [(cx - 5, cy + 2), (cx - 4, cy + 1), (cx - 3, cy), (cx - 2, cy - 1), (cx - 1, cy - 2), (cx, cy - 2), (cx + 1, cy - 2), (cx + 2, cy - 1), (cx + 3, cy), (cx + 4, cy + 1), (cx + 5, cy + 2)]
        line(img, pts, col, 2)
    elif mode == "l":
        line(img, [(x, cy + 1) for x in range(cx - 5, cx + 6)], col, 2)
    elif mode == ">":
        pattern(img, ["XX...", ".XXX.", "...XX", ".XXX.", "XX..."][::1], cx - 2, cy - 2, {"X": col}) if False else None
        pts = [(cx - 3, cy - 2), (cx - 2, cy - 1), (cx - 1, cy), (cx, cy + 1), (cx - 1, cy + 2), (cx - 2, cy + 3), (cx - 3, cy + 4)]
        line(img, pts, col)
        line(img, [(x + 1, y) for (x, y) in pts], col)


HEART = ["..XX...XX..", ".XXXX.XXXX.", "XXXXXXXXXXX", "XXXXXXXXXXX", ".XXXXXXXXX.", "..XXXXXXX..", "...XXXXX...", "....XXX....", ".....X....."]
STAR = ["....X....", "....X....", "...XXX...", "XXXXXXXXX", ".XXXXXXX.", "..XXXXX..", "..XXXXX..", ".XXX.XXX.", ".XX...XX."]
CROSS = ["XX.....XX", ".XX...XX.", "..XX.XX..", "...XXX...", "....X....", "...XXX...", "..XX.XX..", ".XX...XX.", "XX.....XX"]


def draw_special_eye(img, cx, cy, kind, t):
    if kind == "hrt":
        for j, row in enumerate(HEART):
            for i, ch in enumerate(row):
                if ch == "X":
                    px(img, cx - 5 + i, cy - 4 + j, (255, 78, 120, 255) if j < 5 else (214, 40, 92, 255))
        for (i, j) in ((1, 1), (2, 1), (1, 2)):
            px(img, cx - 5 + i + 1, cy - 4 + j, WHITE)
    elif kind == "str":
        for j, row in enumerate(STAR):
            for i, ch in enumerate(row):
                if ch == "X":
                    px(img, cx - 4 + i, cy - 4 + j, YELLOW if j < 6 else ORANGE)
        px(img, cx - 1, cy - 1, WHITE)
        px(img, cx, cy - 1, WHITE)
    elif kind == "xx":
        for k in range(-3, 4):
            px(img, cx + k, cy + k, NAVY)
            px(img, cx + k + 1, cy + k, NAVY)
            px(img, cx + k, cy - k, NAVY)
            px(img, cx + k + 1, cy - k, NAVY)


# ---------------------------------------------------------------- calque HAUT : yeux + sourcils + joues + larmes + sueur
def top_layer(p, blink):
    img = new()
    sx = round(p.get("fx", 0) * 0.27)
    sy = round(p.get("yo", 0) * 0.27)
    tl = round(p.get("tilt", 0) * 0.14)                                  # inclinaison de tête : l'œil gauche monte, le droit descend (et inversement)
    ey_base = 31 + sy
    kinds = []
    for side in (-1, 1):
        wk = p.get("wkL" if side < 0 else "wkR", 0)
        if p.get("hrt", 0) > 0.5:
            kinds.append("hrt")
        elif p.get("str", 0) > 0.5:
            kinds.append("str")
        elif p.get("xx", 0) > 0.5:
            kinds.append("xx")
        elif wk > 0.5:
            kinds.append(">")
        elif p.get("arc", 0) > 0.5:
            kinds.append("a")
        elif p.get("slp", 0) > 0.5:
            kinds.append("u")
        else:
            kinds.append("o")
    eo = max(0.0, min(1.25, p.get("eo", 1))) * p.get("es", 1)
    for i, side in enumerate((-1, 1)):
        cx = 32 + sx + side * 11
        cy = ey_base + (-tl if side < 0 else tl)
        k = kinds[i]
        if k == "o":
            bh = round(7 * eo)
            a = 5
            if blink == 1:
                bh = max(1, round(bh * 0.45))
            elif blink == 2:
                bh = 0
            if bh <= 0 or (bh <= 1 and eo < 0.2):
                draw_closed_eye(img, cx, cy, "l" if blink == 2 and eo > 0.5 else "u")
            else:
                draw_open_eye(img, cx, cy, bh, a, side, p)
                if eo < 0.78 and blink == 0 and p.get("ang", 0) < 0.3:       # œil mi-clos : paupière supérieure marquée
                    line(img, [(cx + k, cy - bh - 1) for k in range(-a - 1, a + 2)], NAVY)
        elif k in ("hrt", "str", "xx"):
            draw_special_eye(img, cx, cy, k, blink)
        elif k == "a":
            draw_closed_eye(img, cx, cy, "a")
        elif k == "u":
            draw_closed_eye(img, cx, cy, "u")
        elif k == ">":
            draw_closed_eye(img, cx - 1 if side > 0 else cx, cy, ">") if side > 0 else draw_closed_eye(img, cx, cy, "u")
    # sourcils : 7 px, hauteur bh, inclinaison bt (extrémité extérieure plus basse quand bt > 0 : triste / inquiet)
    for side in (-1, 1):
        bh = p.get("bl" if side < 0 else "br", 0)
        bt = p.get("blt" if side < 0 else "brt", 0)
        if abs(bh) < 0.001 and abs(bt) < 0.001 and p.get("eo", 1) >= 0.85:
            continue                                                       # sourcils neutres : discrets (rien)
        cx = 32 + sx + side * 11
        yb = 20 + sy - round(bh * 3) + (-tl if side < 0 else tl)
        dy = round(bt * 3)
        pts = []
        for i in range(-4, 5):
            outer = (i * side) < 0                                        # i * side < 0 : moitié extérieure
            frac = i / 4.0 * side                                           # + : extrémité EXTÉRIEURE (plus basse quand bt > 0)                                      # -1 (intérieur) .. +1 (extérieur) pour side=-1/1 croisés
            y = yb + round(dy * (frac))
            pts.append((cx + i, y))
        line(img, pts, (22, 70, 12, 255), 2)
    # joues
    bu = p.get("bu", 0)
    if bu > 0.08:
        for side in (-1, 1):
            cx = 32 + sx + side * 18
            cy = 40 + sy
            for dy in range(-1, 2):
                for dx in range(-3, 4):
                    if (dx / 3.4) ** 2 + (dy / 1.7) ** 2 > 1:
                        continue
                    dither = (dx + dy) % 2 == 0
                    if bu > 0.55 or (bu > 0.25 and dither) or (bu <= 0.25 and dither and dx % 2 == 0):
                        px(img, cx + dx, cy + dy, ROSE)
    # larmes (traînées) et larmes de joie
    if p.get("te", 0) > 0.3:
        for side in (-1, 1):
            cx = 32 + sx + side * 14
            for j in range(0, 8):
                px(img, cx, ey_base + 8 + j, TEAR)
                if j % 3 == 0:
                    px(img, cx - side, ey_base + 8 + j, WHITE)
    if p.get("tj", 0) > 0.3:
        for side in (-1, 1):
            cx = 32 + sx + side * 19
            pattern(img, [".X.", "XXX", ".X."], cx - 1, ey_base - 4, {"X": TEAR})
    if p.get("sw", 0) > 0.3:
        pattern(img, ["..X..", "..X..", ".XXX.", "XXWXX", ".XXX."], 49, 14, {"X": TEAR, "W": WHITE})
    return img


# ---------------------------------------------------------------- calque BOUCHE
def mouth_layer(p, phase):
    img = new()
    d = ImageDraw.Draw(img)
    sx = round(p.get("fx", 0) * 0.27)
    sy = round(p.get("yo", 0) * 0.27)
    cx = 32 + sx
    cy = 45 + sy + round(p.get("mh", 0) * 0.27)
    W = max(4, min(20, round(p.get("mw", 34) * 0.31)))
    mc = p.get("mc", 0.35)
    mo = p.get("mo", 0)
    ms = p.get("ms", 0)
    talk = [0.0, 0.28, 0.52, 0.85][phase]
    if phase:
        mo = max(mo, talk)
        W = max(5, W + (2 if phase == 2 else 0) - (2 if phase == 3 and mc < 0.5 else 0))
    h = W / 2.0
    curve = mc * 3.4

    def ytop(x):
        r = x / h if h else 0
        return cy - curve * (r * r - 0.35) - ms * 2.0 * r

    wv = p.get("wv", 0)
    if wv > 0.5:                                                         # bouche ondulée (nerveux)
        pts = [(cx + x, round(cy + (1 if (x // 2) % 2 else -1) * 1)) for x in range(-int(h), int(h) + 1)]
        line(img, pts, NAVY, 1)
        return img
    openpx = round(mo * 9)
    cols = range(-int(h), int(h) + 1)
    if openpx <= 0:
        pts = [(cx + x, round(ytop(x))) for x in cols]
        line(img, pts, NAVY, 1)
        if mc > 0.5 and W >= 8:                                          # fossettes
            px(img, cx - int(h) - 1, round(ytop(-h)) - 1, NAVY)
            px(img, cx + int(h) + 1, round(ytop(h)) - 1, NAVY)
        if p.get("mt", 0) > 0.7 and mc > 0.4:                            # langue tirée (« silly »)
            pattern(img, ["XXXX", "XXXX", ".XX."], cx + 1, round(ytop(2)) + 1, {"X": TONGUE})
        return img
    teeth = p.get("teeth", 1 if (mc > 0.3 and mo > 0.3) else 0)
    round_mouth = abs(mc) < 0.2 and mo > 0.3
    for x in cols:
        r = x / h if h else 0
        if round_mouth:
            yt = cy - openpx / 2.0 * math.sqrt(max(0, 1 - r * r))
            yb = cy + openpx / 2.0 * math.sqrt(max(0, 1 - r * r))
        else:
            yt = ytop(x)
            yb = yt + openpx * math.sqrt(max(0.0, 1 - r * r)) + (1 if mc < 0 else 0)
        y0, y1 = int(round(yt)), int(round(yb))
        for y in range(y0, y1 + 1):
            edge = y in (y0, y1) or abs(x) >= int(h)
            col = NAVY if edge else MOUTH
            if not edge and teeth and y <= y0 + 2 and openpx >= 3 and (not round_mouth):
                col = WHITE
            px(img, cx + x, y, col)
        if p.get("mt", 0) > 0.2 and openpx >= 4 and not round_mouth:    # langue au fond
            for y in range(max(y0 + 1, y1 - 2), y1):
                if abs(x) <= max(1, int(h * 0.55)):
                    px(img, cx + x, y, TONGUE)
    if round_mouth and openpx >= 5:
        for x in range(-1, 2):
            px(img, cx + x, cy + openpx // 2 - 1, TONGUE)
    return img


# ---------------------------------------------------------------- effets animés
def fx_frames(name):
    """Liste d'images 64x64 pour chaque effet (boucle)."""
    out = []
    if name == "hearts":
        h5 = [".X.X.", "XXXXX", "XXXXX", ".XXX.", "..X.."]
        for f in range(8):
            im = new()
            for k, (x, off, sc) in enumerate(((47, 0.0, 1), (10, 0.33, 1), (52, 0.66, 0))):
                ph = (f / 8 + off) % 1
                y = 40 - ph * 34
                x2 = x + round(math.sin(ph * 6.28 + k) * 2)
                if sc:
                    pattern(im, h5, x2, int(y), {"X": (255, 100, 140, 255)})
                    px(im, x2 + 1, int(y) + 1, WHITE)
                else:
                    pattern(im, ["X.X", "XXX", ".X."], x2, int(y), {"X": (255, 130, 165, 255)})
            out.append(im)
    elif name == "sparks":
        for f in range(6):
            im = new()
            for k, (x, y) in enumerate(((8, 14), (54, 20), (56, 46), (6, 44))):
                ph = (f + k * 1.5) % 6
                sz = [0, 1, 2, 1, 0, 0][int(ph)]
                col = YELLOW if k % 2 == 0 else (255, 255, 255, 255)
                if sz == 2:
                    pattern(im, ["..X..", "..X..", "XXXXX", "..X..", "..X.."], x - 2, y - 2, {"X": col})
                elif sz == 1:
                    pattern(im, [".X.", "XXX", ".X."], x - 1, y - 1, {"X": col})
            out.append(im)
    elif name == "zzz":
        z = {5: ["XXXXX", "...X.", "..X..", ".X...", "XXXXX"], 3: ["XXX", "..X", ".X.", "X..", "XXX"]}
        for f in range(8):
            im = new()
            for k, (sz, off) in enumerate(((5, 0.0), (3, 0.34), (3, 0.67))):
                ph = (f / 8 + off) % 1
                x = 46 + ph * 12
                y = 16 - ph * 12
                if ph < 0.85:
                    pattern(im, z[sz], int(x), int(y), {"X": BLUE_M if sz == 5 else SKY})
            out.append(im)
    elif name == "q":
        g = [".XXX.", "X...X", "....X", "...X.", "..X..", ".....", "..X.."]
        for f in range(6):
            im = new()
            pattern(im, g, 49, 5 + [0, 0, 1, 1, 0, -1][f] + 1, {"X": NAVY})
            pattern(im, g, 48, 4 + [0, 0, 1, 1, 0, -1][f] + 1, {"X": BLUE_M})
            out.append(im)
    elif name == "ex":
        g = ["XX", "XX", "XX", "XX", "..", "XX"]
        for f in range(6):
            im = new()
            bump = [0, -1, 0, 0, 0, 0][f]
            pattern(im, g, 52, 6 + bump, {"X": RED})
            pattern(im, g, 51, 5 + bump, {"X": RED_T})
            out.append(im)
    elif name == "dots":
        for f in range(6):
            im = new()
            n = [1, 2, 3, 3, 2, 1][f]
            for k in range(n):
                sz = [2, 3, 4][k]
                x, y = 46 + k * 5, 15 - k * 4
                ImageDraw.Draw(im).ellipse([x, y, x + sz - 1, y + sz - 1], fill=SKY, outline=BLUE_M)
            out.append(im)
    elif name == "ring":
        for f in range(6):
            im = new()
            d = ImageDraw.Draw(im)
            r = R + 2 + f * 0.8
            a = [255, 230, 190, 140, 90, 50][f]
            for ang in range(0, 360, 5):
                if (ang // 5) % 2:
                    continue
                x = CX + round(math.cos(math.radians(ang)) * r)
                y = CY + round(math.sin(math.radians(ang)) * r)
                px(im, x, y, (120, 230, 30, a))
            out.append(im)
    elif name == "tears":
        for f in range(6):
            im = new()
            for k, x in enumerate((19, 45)):
                ph = (f / 6 + k * 0.5) % 1
                y = 38 + ph * 14
                pattern(im, [".X.", "XXX", "XXX", ".X."][:3 if ph > 0.7 else 4], x - 1, int(y), {"X": TEAR})
                px(im, x - 1, int(y) + 1, WHITE)
            out.append(im)
    elif name == "anger":
        v = [".XX.XX.", "XX...XX", "X.....X", ".......", "X.....X", "XX...XX", ".XX.XX."]
        for f in range(4):
            im = new()
            sc = [0, 1, 0, -1][f]
            pattern(im, v, 49 + sc // 1, 8, {"X": RED})
            if f in (1, 2):                                              # petit éclair rouge : la veine bat
                pattern(im, ["..X..", ".XXX.", "XXXXX", ".XXX.", "..X.."], 44, 3, {"X": (255, 170, 170, 200)})
            out.append(im)
    elif name == "stars":
        for f in range(8):
            im = new()
            for k in range(3):
                ang = f / 8 * 6.283 + k * 2.094
                x = 32 + math.cos(ang) * 19
                y = 8 + math.sin(ang) * 4
                pattern(im, [".X.", "XXX", ".X."], int(x) - 1, int(y) - 1, {"X": YELLOW if k else WHITE})
            out.append(im)
    elif name == "aura":
        import random
        for f in range(6):
            im = new()
            rnd = random.Random(40 + f)
            for ang in range(0, 360, 8):
                r = R + 2 + rnd.choice((0, 2, 4, 6)) if ang % 16 == 0 else R + 2 + rnd.choice((0, 1))
                for rr in range(R + 1, r + 1):
                    x = CX + round(math.cos(math.radians(ang)) * rr)
                    y = CY + round(math.sin(math.radians(ang)) * rr)
                    px(im, x, y, SKY if rr < r else (255, 255, 255, 255) if rr == r else BLUE_M)
            out.append(im)
    elif name == "notes":
        g = ["...XX.", "...X.X", "...X..", "...X..", ".XXX..", "XXXX..", "XXX..."]
        for f in range(8):
            im = new()
            for k, (x, off) in enumerate(((8, 0.0), (52, 0.5))):
                ph = (f / 8 + off) % 1
                pattern(im, g, x + round(math.sin(ph * 6.28) * 2), int(34 - ph * 28), {"X": BLUE_M if k else (160, 240, 60, 255)})
            out.append(im)
    elif name == "shine":
        for f in range(8):
            im = new()
            x0 = 8 + f * 6
            for k in range(-3, 4):
                for j in range(0, 36):
                    x, y = x0 + j * 0.5 + k * 0, 14 + j
                    xx = int(x0 + j * 0.5 - j * 0.0)
            for j in range(36):
                x = int(x0 - j * 0.35)
                y = 12 + j
                if (x - CX) ** 2 + (y - CY) ** 2 < (R - 2) ** 2:
                    px(im, x, y, (255, 255, 255, 235))
                    px(im, x + 1, y, (255, 255, 255, 150))
            out.append(im)
    elif name == "pop":
        for f in range(5):
            im = new()
            r = R + 3 + f * 3
            a = [255, 230, 180, 110, 50][f]
            for ang in range(0, 360, 30):
                c, s = math.cos(math.radians(ang)), math.sin(math.radians(ang))
                for rr in range(r, r + 3 + (1 if f < 3 else 0)):
                    px(im, CX + round(c * rr), CY + round(s * rr), (255, 255, 255, a))
            for ang in range(15, 360, 30):
                px(im, CX + round(math.cos(math.radians(ang)) * (r - 1)), CY + round(math.sin(math.radians(ang)) * (r - 1)), (150, 255, 80, a))
            out.append(im)
    return out


FX_NAMES = ["hearts", "sparks", "zzz", "q", "ex", "dots", "ring", "tears", "anger", "stars", "aura", "notes", "shine", "pop"]
FX_KEYS = {"hr": "hearts", "sp": "sparks", "zz": "zzz", "q": "q", "ex": "ex", "dt": "dots", "ring": "ring", "te": "tears", "an": "anger", "st": "stars", "au": "aura", "nt": "notes", "sh": "shine"}


def expr_fx(p):
    return [FX_NAMES_MAP for k, FX_NAMES_MAP in FX_KEYS.items() if p.get(k, 0) > 0.3]


# ---------------------------------------------------------------- assemblage de l'atlas
def build(table):
    defaults = table["defaults"]
    frames = []                                   # (clé, image)
    index = {"size": S, "cols": 8, "body": None, "shadow": None, "fx": {}, "expr": {}, "ball": [CX, CY, R]}

    def add(img):
        frames.append(img)
        return len(frames) - 1

    index["body"] = add(body())
    index["shadow"] = [add(shadow(1.0)), add(shadow(0.9))]
    for name in FX_NAMES:
        fr = fx_frames(name)
        index["fx"][name] = [add(f) for f in fr]
    for name, e in table["expressions"].items():
        p = {**defaults, **e}
        entry = {"top": [add(top_layer(p, b)) for b in range(3)], "mouth": [add(mouth_layer(p, ph)) for ph in range(4)], "fx": expr_fx(p)}
        if "mot" in e:
            entry["mot"] = e["mot"]
        index["expr"][name] = entry
    cols = index["cols"]
    rows = (len(frames) + cols - 1) // cols
    atlas = Image.new("RGBA", (cols * S, rows * S), (0, 0, 0, 0))
    for i, im in enumerate(frames):
        atlas.alpha_composite(im, ((i % cols) * S, (i // cols) * S))
    return atlas, index, frames


def compose(index, frames, name, blink=0, phase=0, fx=None, fxf=0):
    e = index["expr"][name]
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    im.alpha_composite(frames[index["shadow"][0]])
    im.alpha_composite(frames[index["body"]])
    im.alpha_composite(frames[e["top"][blink]])
    im.alpha_composite(frames[e["mouth"][phase]])
    for f in (e["fx"] if fx is None else fx):
        fr = index["fx"][f]
        im.alpha_composite(frames[fr[fxf % len(fr)]])
    return im


def contact_sheet(index, frames, path, cell=3, cols=8, bg=(32, 40, 70, 255)):
    names = list(index["expr"].keys())
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * S * cell, rows * (S * cell + 14)), bg)
    d = ImageDraw.Draw(sheet)
    for i, n in enumerate(names):
        im = compose(index, frames, n, 0, 0, fxf=2).resize((S * cell, S * cell), Image.NEAREST)
        x, y = (i % cols) * S * cell, (i // cols) * (S * cell + 14)
        sheet.alpha_composite(im, (x, y))
        d.text((x + 4, y + S * cell), n, fill=(255, 255, 255, 255))
    sheet.save(path)


def main():
    src = os.path.join(ROOT, "static", "eto_expressions.json")
    table = json.load(open(src, encoding="utf-8"))
    atlas, index, frames = build(table)
    if "--sheet" in sys.argv:
        contact_sheet(index, frames, sys.argv[sys.argv.index("--sheet") + 1])
        return
    js = json.dumps(index, separators=(",", ":"))
    atlas.save(os.path.join(ROOT, "static", "eto8_atlas.png"), optimize=True)             # web : fichiers à plat dans static/ (le serveur n'expose pas les sous-dossiers)
    open(os.path.join(ROOT, "static", "eto8_index.json"), "w", encoding="utf-8").write(js)
    for d in (os.path.join(ROOT, "godot_chess", "eto8"), os.path.join(ROOT, "godot_eye", "eto8")):
        os.makedirs(d, exist_ok=True)
        atlas.save(os.path.join(d, "atlas.png"), optimize=True)
        open(os.path.join(d, "index.json"), "w", encoding="utf-8").write(js)
    print(f"atlas {atlas.size} · {len(frames)} sprites · {len(index['expr'])} expressions")


if __name__ == "__main__":
    main()
