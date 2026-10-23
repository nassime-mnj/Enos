"""Exporte tes données du PC vers l'application mobile, CHIFFRÉES, juste avant la compilation de l'APK.

    py exporter_donnees_ceo.py                 écrit android/assets/mobile/js/ceo_bundle.js (demande une phrase secrète)
    py exporter_donnees_ceo.py --build         exporte, compile l'APK (construire_apk.py), puis remet le paquet à vide
    py exporter_donnees_ceo.py --avec-pc       ajoute l'adresse, le jeton et l'empreinte du PC (lien PC optionnel ; sinon 100 % autonome)
    py exporter_donnees_ceo.py --test          données factices (aucun fichier personnel lu)

Contenu du paquet : clé Groq, clés ElevenLabs (le « xi-api-key » : E.N.O.S. et ETO), liens .ics de l'emploi du temps (Zeus / Moodle),
tâches de l'agenda (data/agenda.json), préférences (persona, thème, niveau d'échecs… : nasko_config.json + ceo_prefs.json facultatif).

Chiffrement : AES-256-GCM, clé = PBKDF2-HMAC-SHA256(phrase, sel aléatoire, 300 000 tours) — même format « EK1 » que envoyer_cles.py.
L'APK ne contient AUCUNE clé en clair. La sécurité repose sur ta phrase secrète : elle n'est écrite nulle part, choisis-en une longue
(4 mots au hasard). À la 1re ouverture, l'application la demande une fois, puis range tout dans le coffre Android (Keystore) — le paquet
embarqué reste dans l'APK mais n'est plus redemandé.

ceo_prefs.json (facultatif, à la racine, ignoré par Git) : {"hue": 188, "chess.power": 70, "persona": "eto", "chess.comment": true}
"""
import argparse
import getpass
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
TARGET = os.path.join(HERE, "android", "assets", "mobile", "js", "ceo_bundle.js")
EMPTY = '"use strict";\n// Emplacement du paquet CEO chiffré : exporter_donnees_ceo.py le remplit juste avant la compilation puis le remet à vide.\nwindow.ENOS_CEO = "";\n'
MIN_CHARS = 12                                   # après normalisation (lettres et chiffres seulement, comme Importer.norm côté Java)


def norm(phrase):
    return "".join(c for c in phrase.upper() if c.isalnum() and c.isascii())


def check_phrase(phrase):
    n = norm(phrase)
    if len(n) < MIN_CHARS:
        sys.exit(f"Phrase trop courte : {MIN_CHARS} lettres ou chiffres minimum (accents et espaces ne comptent pas).")
    if len(set(n)) < 6:
        sys.exit("Phrase trop répétitive : utilise plusieurs mots différents.")
    if len(n) != len(re.sub(r"\s", "", phrase)):
        print("  ⚠ Les accents, tirets et symboles sont ignorés au déchiffrement (seuls A-Z et 0-9 comptent, sans casse).")


def read_prefs(cfg):
    prefs = {"persona": cfg.get("persona") or "enos", "chess.comment": True}
    path = os.path.join(HERE, "ceo_prefs.json")
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as f:
            extra = json.load(f)
        prefs.update({k: v for k, v in extra.items() if isinstance(v, (str, int, float, bool))})
    return prefs


def build(avec_pc):
    import envoyer_cles
    import nasko_agenda
    import nasko_core
    bundle, notes = envoyer_cles.build_bundle()
    cfg = nasko_core.load_config()
    if not avec_pc:
        bundle.pop("pc", None)
        bundle["vault"].pop("pc_token", None)
        notes.append("Lien PC : non inclus (application autonome). Relance avec --avec-pc pour l'ajouter.")
    bundle["v"] = 2
    bundle["prefs"] = read_prefs(cfg)
    bundle["tasks"] = [{k: t.get(k, "") for k in ("id", "title", "due", "notes", "done", "created")} for t in nasko_agenda.list_tasks()]
    notes.append(f"Agenda : {len(bundle['tasks'])} tâche(s) ; emploi du temps = liens .ics Zeus/Moodle lus par le téléphone")
    return bundle, notes


def test_bundle():
    return {"v": 2, "name": "Test", "vault": {"groq": "gsk_TESTKEY", "eleven_enos": "xi_TESTKEY"}, "settings": {"model": "m"},
            "prefs": {"persona": "eto", "hue": 188, "chess.power": 70}, "tasks": [{"id": "abc123", "title": "Tâche test", "due": "2026-11-01T10:00", "notes": "", "done": False, "created": ""}]}, []


def write_bundle(blob):
    with open(TARGET, "w", encoding="utf-8", newline="\n") as f:
        f.write('"use strict";\n// GÉNÉRÉ par exporter_donnees_ceo.py (chiffré AES-256-GCM) : ne pas versionner.\nwindow.ENOS_CEO = "' + blob + '";\n')


def reset_bundle():
    with open(TARGET, "w", encoding="utf-8", newline="\n") as f:
        f.write(EMPTY)


def main():
    ap = argparse.ArgumentParser(description="Exporte les données CEO (chiffrées) vers l'application mobile.")
    ap.add_argument("--build", action="store_true", help="compile l'APK ensuite (construire_apk.py), puis vide le paquet")
    ap.add_argument("--keep", action="store_true", help="avec --build : laisse le paquet dans les sources")
    ap.add_argument("--avec-pc", action="store_true")
    ap.add_argument("--test", action="store_true")
    ap.add_argument("--passphrase-env", default="", help="nom d'une variable d'environnement contenant la phrase (sinon saisie masquée)")
    a = ap.parse_args()

    bundle, notes = test_bundle() if a.test else build(a.avec_pc)
    phrase = os.environ.get(a.passphrase_env, "") if a.passphrase_env else ""
    if not phrase:
        phrase = getpass.getpass("Phrase secrète (affichée nulle part) : ")
        if phrase != getpass.getpass("Confirme la phrase : "):
            sys.exit("Les deux phrases diffèrent.")
    check_phrase(phrase)

    import envoyer_cles
    blob = envoyer_cles.encrypt(bundle, norm(phrase))
    write_bundle(blob)
    print("\n  Paquet chiffré écrit :", os.path.relpath(TARGET, HERE), f"({len(blob)} caractères)")
    for n in notes:
        print("   ·", n)
    print("   · Contenu :", ", ".join(sorted(bundle["vault"])), "+", len(bundle.get("tasks", [])), "tâche(s) +", len(bundle.get("prefs", {})), "préférence(s)")
    if not a.build:
        print("\n  Compile maintenant :  py construire_apk.py   puis remets le paquet à vide :  py exporter_donnees_ceo.py --vider")
        return
    try:
        subprocess.run([sys.executable, os.path.join(HERE, "construire_apk.py")], check=True, cwd=HERE)
    finally:
        if not a.keep:
            reset_bundle()
            print("  Paquet retiré des sources (l'APK le contient, chiffré).")


if __name__ == "__main__":
    if "--vider" in sys.argv:
        reset_bundle()
        print("Paquet CEO retiré des sources.")
    else:
        main()
