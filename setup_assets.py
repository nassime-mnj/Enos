"""Convertit le logo pixel art (.jpg) en logo.png (web), logo.ico (Windows) et icones d'application telephone.

Usage :  py setup_assets.py [image.jpg]
Sans argument, utilise Gemini_Generated_Image_njcmz6njcmz6njcm.jpg a la racine du projet.
Le fond noir devient transparent ; l'image source n'est jamais modifiee.
"""
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
SOURCE = "Gemini_Generated_Image_njcmz6njcmz6njcm.jpg"
CENTER = 0.4825      # centre de l'oeil dans l'image (fraction), pour un cadrage carre centre sur lui
CROP = 0.90          # part de l'image conservee (recadre un peu pour que l'oeil ressorte en petite taille)
PNG_SIZE = 512
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def black_to_alpha(img):
    """Le noir (et le bruit JPEG) devient transparent ; les traits verts restent intacts."""
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    alpha = np.clip((a.max(axis=2) - 12) / 40.0, 0, 1) * 255
    return Image.fromarray(np.dstack([a, alpha]).astype(np.uint8), "RGBA")


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, SOURCE)
    if not os.path.isfile(src):
        sys.exit(f"Image introuvable : {src}")
    img = Image.open(src).convert("RGB")
    w, h = img.size
    side = int(min(w, h) * CROP)
    cx, cy = int(w * CENTER), int(h * CENTER)
    left = min(max(cx - side // 2, 0), w - side)
    top = min(max(cy - side // 2, 0), h - side)
    sq = img.crop((left, top, left + side, top + side))

    png = black_to_alpha(sq.resize((PNG_SIZE, PNG_SIZE), Image.LANCZOS))
    png.save(os.path.join(ROOT, "logo.png"), optimize=True)

    for size in (192, 512):    # icones « appli » du telephone : fond noir OPAQUE, oeil dans la zone sure (80 %) des icones adaptatives
        base = Image.new("RGB", (size, size), (0, 0, 0))
        inner = int(size * 0.78)
        base.paste(sq.resize((inner, inner), Image.LANCZOS), ((size - inner) // 2, (size - inner) // 2))
        base.save(os.path.join(ROOT, f"logo-{size}.png"), optimize=True)

    ico_base = black_to_alpha(sq.resize((256, 256), Image.LANCZOS))
    ico_base.save(os.path.join(ROOT, "logo.ico"), format="ICO", sizes=ICO_SIZES)

    for name in ("logo.png", "logo.ico", "logo-192.png", "logo-512.png"):
        p = os.path.join(ROOT, name)
        print(f"{name:10} {os.path.getsize(p) / 1024:7.1f} Ko")
    print("OK : logo.png et logo.ico generes. Relancez build.bat pour les integrer a ENOS.exe.")


if __name__ == "__main__":
    main()
