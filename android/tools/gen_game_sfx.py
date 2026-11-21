"""Régénère les sons des jeux : js/games/sfx_bank.js (banque d'événements) et les données base64 (file:// interdit fetch) :
  js/games/sfx_data.js      sons courts, chargés à l'ouverture d'un jeu
  js/games/sfx_amb_data.js  ambiances longues (vagues, pluie et orage), chargées seulement quand un décor les demande
Source : audio/games/bank.json (clé "bank" : événement -> {bus, vol, rate, poly, files, pack?}).
usage : python android/tools/gen_game_sfx.py"""
import base64, json, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "mobile")
bank = json.load(open(os.path.join(ROOT, "audio", "games", "bank.json"), encoding="utf-8"))
ev = bank["bank"]
packs = {}
for k, e in ev.items():
    for f in e["files"]:
        packs.setdefault(e.get("pack", ""), {})[f] = None
with open(os.path.join(ROOT, "js", "games", "sfx_bank.js"), "w", encoding="utf-8") as fh:
    fh.write('"use strict";\n// Banque des sons des jeux (générée par android/tools/gen_game_sfx.py depuis audio/games/bank.json).\n')
    fh.write("window.ENOS_GSFX_BANK = %s;\n" % json.dumps(ev, ensure_ascii=False, separators=(",", ":")))
for name, files in packs.items():
    data = {f: base64.b64encode(open(os.path.join(ROOT, f), "rb").read()).decode() for f in sorted(files)}
    out = os.path.join(ROOT, "js", "games", "sfx_%sdata.js" % (name + "_" if name else ""))
    with open(out, "w", encoding="utf-8") as fh:
        fh.write('"use strict";\n// Sons des jeux en base64 (OGG Vorbis), générés par android/tools/gen_game_sfx.py depuis audio/games/.\n')
        fh.write("window.ENOS_GSFX_DATA = Object.assign(window.ENOS_GSFX_DATA || {}, %s);\n" % json.dumps(data, separators=(",", ":")))
    print(os.path.basename(out), len(data), "sons", os.path.getsize(out) // 1024, "Ko")
