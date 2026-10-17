"""Genere UNE FOIS les fichiers audio des phrases locales qui n'en ont pas encore (dossier voix\\).

    py generer_voix.py --dry-run    # affiche les phrases manquantes et le cout en caracteres, sans rien generer
    py generer_voix.py              # genere les fichiers manquants avec la voix ElevenLabs configuree

Les fichiers sont ensuite embarques dans ENOS.exe (build.bat) : a l'usage, ces phrases ne coutent plus
aucun caractere. Les phrases deja presentes ne sont jamais regenerees.
"""
import os
import shutil
import sys

import nasko_eleven
import nasko_voice
from nasko_core import load_config

DOSSIER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "voix")


def manquantes():
    out = []
    for e in nasko_voice.STATIC:
        names = [e.get("file"), e["id"] + ".mp3"]
        if not any(n and os.path.isfile(os.path.join(DOSSIER, n)) for n in names):
            out.append(e)
    return out


def main():
    todo = manquantes()
    total = sum(len(nasko_eleven.speakable(e["text"])) for e in todo)
    if not todo:
        print("Toutes les phrases locales ont deja leur fichier audio. Rien a generer.")
        return
    print(f"{len(todo)} phrase(s) sans fichier, {total} caracteres ElevenLabs au total :")
    for e in todo:
        print(f"  {len(nasko_eleven.speakable(e['text'])):4d} car. | {e['id']:18} | {e['text'][:70]}")
    if "--dry-run" in sys.argv:
        return
    cfg = load_config()
    os.makedirs(DOSSIER, exist_ok=True)
    for e in todo:
        try:
            src = nasko_eleven.synthesize(e["text"], cfg)
        except nasko_eleven.ElevenError as err:
            sys.exit(f"Arret sur « {e['id']} » : {err}")
        shutil.copyfile(src, os.path.join(DOSSIER, e["id"] + ".mp3"))
        print(f"  genere : voix\\{e['id']}.mp3")
    print("Termine. Relancez build.bat pour embarquer ces fichiers dans ENOS.exe.")


if __name__ == "__main__":
    main()
