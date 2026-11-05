"""Illustrations des bots « IA » (320x320) : emblèmes ORIGINAUX inspirés de chaque assistant (pas des logos). Usage : python gen_ai_avatars.py <dossier img/bots>"""
import math, sys, os
from PIL import Image, ImageDraw, ImageFilter
S = 320 * 3   # supersampling
def grad(c1, c2, size=S):
    im = Image.new("RGB", (size, size)); px = im.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size); px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return im
def base(c1, c2):
    bg = grad(c1, c2).convert("RGBA"); m = Image.new("L", (S, S), 0); ImageDraw.Draw(m).ellipse((S * .03, S * .03, S * .97, S * .97), fill=255)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0)); out.paste(bg, (0, 0), m); return out
def glow(im, pts_fn, color, blur):
    g = Image.new("RGBA", (S, S), (0, 0, 0, 0)); pts_fn(ImageDraw.Draw(g), color); g2 = g.filter(ImageFilter.GaussianBlur(blur)); return Image.alpha_composite(im, g2)
def finish(im, path):
    d = ImageDraw.Draw(im); d.ellipse((S * .03, S * .03, S * .97, S * .97), outline=(255, 255, 255, 120), width=int(S * .012))
    im.resize((320, 320), Image.LANCZOS).save(path)
c = S / 2
def claude(path):   # étoile à 12 rayons effilés, sur terre cuite
    im = base((226, 120, 84), (150, 58, 36))
    def draw(d, col):
        for k in range(12):
            a = k * math.pi / 6 + .1; r1, r2 = S * .06, S * (.36 if k % 2 == 0 else .27)
            pts = [(c + r1 * math.cos(a - .32), c + r1 * math.sin(a - .32)), (c + r2 * math.cos(a), c + r2 * math.sin(a)), (c + r1 * math.cos(a + .32), c + r1 * math.sin(a + .32))]
            d.polygon(pts, fill=col)
        d.ellipse((c - S * .07, c - S * .07, c + S * .07, c + S * .07), fill=col)
    im = glow(im, draw, (255, 230, 200, 255), S * .015); draw(ImageDraw.Draw(im), (255, 244, 232, 255)); finish(im, path)
def gpt(path):      # nœud hexagonal entrelacé, sur vert très sombre
    im = base((32, 150, 120), (10, 46, 44))
    def draw(d, col):
        for k in range(2):
            a0 = k * math.pi / 6; pts = [(c + S * .30 * math.cos(a0 + j * math.pi / 3), c + S * .30 * math.sin(a0 + j * math.pi / 3)) for j in range(6)]
            d.line(pts + [pts[0]], fill=col, width=int(S * .045), joint="curve")
        d.ellipse((c - S * .05, c - S * .05, c + S * .05, c + S * .05), fill=col)
    draw(ImageDraw.Draw(im), (240, 255, 250, 255)); finish(im, path)
def gemini(path):   # étoile concave à 4 branches, dégradé bleu-violet
    im = base((72, 110, 245), (150, 70, 220))
    def draw(d, col):
        pts = [(c + S * .40 * math.cos(t) ** 3, c + S * .40 * math.sin(t) ** 3) for t in [k / 120 * 2 * math.pi for k in range(120)]]
        d.polygon(pts, fill=col)
    im = glow(im, draw, (200, 220, 255, 255), S * .02); draw(ImageDraw.Draw(im), (255, 255, 255, 255)); finish(im, path)
def deepseek(path): # baleine stylisée, bleu profond
    im = base((40, 90, 235), (14, 24, 90)); d = ImageDraw.Draw(im); w = (235, 245, 255, 255)
    d.ellipse((c - S * .30, c - S * .10, c + S * .22, c + S * .26), fill=w)                           # corps
    d.polygon([(c + S * .16, c + S * .06), (c + S * .34, c - S * .16), (c + S * .40, c - S * .02), (c + S * .30, c + S * .04), (c + S * .40, c + S * .14), (c + S * .22, c + S * .18)], fill=w)  # queue
    d.polygon([(c - S * .05, c - S * .08), (c - S * .12, c - S * .24), (c + S * .04, c - S * .10)], fill=w)  # aileron
    d.ellipse((c - S * .22, c + S * .00, c - S * .17, c + S * .05), fill=(14, 24, 90, 255))           # œil
    for k in range(3): d.arc((c - S * .12 + k * S * .09, c + S * .30, c - S * .02 + k * S * .09, c + S * .38), 200, 340, fill=(190, 215, 255, 255), width=int(S * .014))
    finish(im, path)
out = sys.argv[1]
for n, f in (("claude", claude), ("gpt", gpt), ("gemini", gemini), ("deepseek", deepseek)): f(os.path.join(out, n + ".png"))
