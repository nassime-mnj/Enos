"""Copie la page Code Academy de la version PC (static/academy/) vers l'application mobile (android/assets/mobile/academy/).
La source reste static/academy ; à relancer après chaque modification de cours ou du moteur :  py sync_academy.py
(m_academy.js, le module mobile qui ouvre cette page et fournit l'exécution cloud, vit dans android/assets/mobile/js/.)"""
import os
import shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "static", "academy")
DST = os.path.join(ROOT, "android", "assets", "mobile", "academy")
EXT = (".html", ".js", ".css")


def main() -> int:
    os.makedirs(DST, exist_ok=True)
    n = 0
    for name in sorted(os.listdir(SRC)):
        if name.startswith("_") or not name.endswith(EXT):
            continue
        shutil.copyfile(os.path.join(SRC, name), os.path.join(DST, name))
        n += 1
    print(f"{n} fichiers copiés vers {DST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
