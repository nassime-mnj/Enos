"""Cree le raccourci « E.N.O.S.lnk » sur le Bureau Windows (cible : ENOS.exe, icone : logo.ico).

Usage :
    py creer_raccourci.py                  raccourci du Bureau
    py creer_raccourci.py --demarrage      E.N.O.S. demarre avec Windows, SANS fenetre (serveur seul : telephone / web / F6)
    py creer_raccourci.py --retirer-demarrage
Le Bureau est lu via Windows (il peut etre redirige par OneDrive ou se nommer « Bureau »).
Option --dossier <chemin> : cree le raccourci dans ce dossier (tests).
"""
import argparse
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
EXE = os.path.join(ROOT, "ENOS.exe")
ICON = os.path.join(ROOT, "logo.ico")
STARTUP_NAME = "E.N.O.S. (demarrage).lnk"

PS = r"""
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($env:NASKO_LNK)
$lnk.TargetPath = $env:NASKO_EXE
$lnk.WorkingDirectory = $env:NASKO_DIR
$lnk.IconLocation = $env:NASKO_ICON
$lnk.Arguments = $env:NASKO_ARGS
$lnk.WindowStyle = 7
$lnk.Description = $env:NASKO_DESC
$lnk.Save()
"""


def known_folder(name):
    out = subprocess.run(["powershell.exe", "-NoProfile", "-Command", f"[Environment]::GetFolderPath('{name}')"],
                         capture_output=True, text=True, encoding="utf-8")
    path = out.stdout.strip()
    if not path or not os.path.isdir(path):
        sys.exit(f"Impossible de localiser le dossier Windows « {name} ».")
    return path


def make_shortcut(lnk, args="", desc="E.N.O.S. AI"):
    icon = f"{ICON},0" if os.path.isfile(ICON) else f"{EXE},0"   # sans logo.ico : icone integree a l'exe
    env = {**os.environ, "NASKO_LNK": lnk, "NASKO_EXE": EXE, "NASKO_DIR": ROOT, "NASKO_ICON": icon, "NASKO_ARGS": args, "NASKO_DESC": desc}
    res = subprocess.run(["powershell.exe", "-NoProfile", "-Command", PS], env=env, capture_output=True, text=True)
    if res.returncode != 0 or not os.path.isfile(lnk):
        sys.exit("Echec de creation du raccourci : " + (res.stderr.strip() or "erreur inconnue"))
    return icon


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--demarrage", action="store_true")
    ap.add_argument("--retirer-demarrage", action="store_true")
    ap.add_argument("--dossier", help="dossier de destination (defaut : Bureau, ou Demarrage avec --demarrage)")
    a = ap.parse_args()

    if a.retirer_demarrage:
        lnk = os.path.join(a.dossier or known_folder("Startup"), STARTUP_NAME)
        if os.path.isfile(lnk):
            os.remove(lnk)
            print(f"Demarrage automatique retire : {lnk}")
        else:
            print("Aucun demarrage automatique a retirer.")
        return
    if not os.path.isfile(EXE):
        sys.exit(f"ENOS.exe introuvable dans {ROOT} : lancez d'abord build.bat.")
    if a.demarrage:
        lnk = os.path.join(a.dossier or known_folder("Startup"), STARTUP_NAME)
        icon = make_shortcut(lnk, "--background", "E.N.O.S. AI (serveur en arriere-plan)")
        print(f"Demarrage automatique active : {lnk}\n  E.N.O.S. se lance sans fenetre a l'ouverture de session Windows.\n  Pour l'enlever : py creer_raccourci.py --retirer-demarrage")
        return
    lnk = os.path.join(a.dossier or known_folder("Desktop"), "E.N.O.S.lnk")
    icon = make_shortcut(lnk)
    print(f"Raccourci cree : {lnk}")
    print(f"  cible : {EXE}")
    print(f"  icone : {icon}")


if __name__ == "__main__":
    main()
