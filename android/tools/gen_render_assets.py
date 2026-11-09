"""Embarque les images du moteur de rendu Chess Edit en data: URI (js/render_assets.js).
Pourquoi : dans le WebView Android les images chargées depuis les assets rendent le canvas « tainted » -> VideoFrame / captureStream / getImageData refusés.
Un data: URI ne salit jamais le canvas. À relancer si img/chess, img/badges ou img/bots changent :  python android/tools/gen_render_assets.py"""
import base64, io, json, os
from PIL import Image
M = os.path.join(os.path.dirname(__file__), "..", "assets", "mobile")
out = {}
def add(rel, size=None):
    im = Image.open(os.path.join(M, rel)).convert("RGBA")
    if size and max(im.size) > size: im.thumbnail((size, size), Image.LANCZOS)
    if rel.startswith("img/icons"): im = im.convert("RGB").quantize(64, method=Image.Quantize.MEDIANCUT)       # icônes pixel-art : 64 couleurs suffisent
    b = io.BytesIO(); im.save(b, "PNG", optimize=True); out[rel.replace(os.sep, "/")] = "data:image/png;base64," + base64.b64encode(b.getvalue()).decode()
for d, size in (("img/chess", 192), ("img/badges", 160), ("img/bots", 256), ("img/icons", 128)):
    for n in sorted(os.listdir(os.path.join(M, d))):
        if n.endswith(".png"): add(d + "/" + n, size)
open(os.path.join(M, "js", "render_assets.js"), "w").write('"use strict";\n// généré par android/tools/gen_render_assets.py — ne pas éditer\nwindow.ENOS_IMG = ' + json.dumps(out) + ";\n")
print(len(out), "images,", round(os.path.getsize(os.path.join(M, "js", "render_assets.js")) / 1024), "Ko")
