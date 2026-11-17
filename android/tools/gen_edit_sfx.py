"""Régénère js/edit_sfx_data.js (bruitages d'edit fournis par le propriétaire) : rognage du silence initial, fondu de fin 250 ms, mono 44,1 kHz 80 kb/s, base64.
Usage : python3 gen_edit_sfx.py <dossier des mp3 d'origine>   (ffmpeg requis). Colonnes : id, fichier (sans préfixe d'upload), début (s), fin (s ou -)."""
import base64, glob, json, os, subprocess, sys, tempfile
SPEC = """sx_thankyou cuphead_thank_you 0.11 -
sx_knockout cuphead-knockout 0 -
sx_cupdeath cup-head-death-sfx 0.08 -
sx_nba nba-horn-sfx 0.03 -
sx_amogus among-us-impostor-kill-music_01 0.04 -
sx_finish finishing-hit-super-smash-bros-ultimate 0 -
sx_mario mario-ohhh-nooo 0.27 -
sx_nowait no-no-wait-wait 0.03 -
sx_reload reload-gun-sound_CpHCnmK 0.23 -
sx_heaven made-in-heaven-sfx 0.69 5.1
sx_boom cinematic-boom-hq 0.17 -
sx_undertale undertale-sfx-rare-to-find 0.18 -
sx_gong gong-sfx 0.83 -
sx_flashbang flash-bang-sfx 1.47 5.3
sx_awkward awkward-moment 0.02 -
sx_sad sad-disappointed-spongebob-sfx 0.15 -
sx_mariodeath super-mario-death-sound-sound-effect 0.80 3.6
sx_gunshot gunshot-meme 0.41 2.9"""
src = sys.argv[1]; out = {}
tmp = tempfile.mkdtemp()
for line in SPEC.splitlines():
    sid, name, a, e = line.split()
    f = [p for p in glob.glob(os.path.join(src, "*" + name + ".mp3"))][0]
    o = os.path.join(tmp, sid + ".mp3")
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", a] + ([] if e == "-" else ["-to", e]) + ["-i", f, "-ac", "1", "-ar", "44100", "-af", "afade=t=in:d=0.004,areverse,afade=t=in:d=0.25,areverse", "-b:a", "80k", o]
    subprocess.run(cmd, check=True); out[sid] = base64.b64encode(open(o, "rb").read()).decode()
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "mobile", "js", "edit_sfx_data.js")
with open(dst, "w") as fh:
    fh.write('"use strict";\n// Bruitages d\'edit fournis par le propriétaire (Cuphead, NBA, Among Us, Smash, Mario, JoJo, Undertale, Bob l\'éponge, gunshot…) : rognés (silence initial retiré, fondu de fin), mono 80 kb/s, en base64 (aucun fetch).\n// Généré par android/tools/gen_edit_sfx.py. Répartition : voir chess_edit_map.js (POOL / PRE) et android/MOBILE.md.\n')
    fh.write("window.ENOS_EDITSFX = " + json.dumps(out) + ";\n")
print(dst, len(out), os.path.getsize(dst))
