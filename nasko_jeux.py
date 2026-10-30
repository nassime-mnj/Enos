"""JEUX E.N.O.S. en Godot (2048 Néon, Serpent, Démineur) : lance le projet godot_games (à côté d'ENOS.exe) dans sa propre fenêtre.

Le chemin de Godot est celui de RÉGLAGES → PROFIL (clé `godot_path`, comme l'Œil de bureau). Une seule fenêtre à la fois : relancer un jeu
ferme l'ancien. Aucun lien avec le serveur : les records sont gardés par Godot (user://scores.cfg).
"""
import logging
import os
import subprocess
import threading

import nasko_core

log = logging.getLogger("nasko.jeux")
CREATE_NO_WINDOW = 0x08000000
GAMES = {"2048": "2048 Néon", "snake": "Serpent", "mines": "Démineur", "menu": "Menu des jeux"}
_lock = threading.Lock()
_proc = {"p": None}


class JeuxError(Exception):
    pass


def project_dir():
    d = os.path.join(nasko_core.app_dir(), "godot_games")
    return d if os.path.isfile(os.path.join(d, "project.godot")) else ""


def godot_exe():
    p = str(nasko_core.load_config().get("godot_path") or "").strip().strip('"')
    return p if p and os.path.isfile(p) and p.lower().endswith(".exe") else ""


def status():
    p = _proc["p"]
    return {"available": bool(project_dir() and godot_exe()), "project": bool(project_dir()), "godot": bool(godot_exe()),
            "running": bool(p and p.poll() is None), "games": GAMES}


def launch(game="menu"):
    """Ouvre un jeu ('2048', 'snake', 'mines') ou le menu ('menu'). Retourne le statut."""
    if game not in GAMES:
        raise JeuxError("Jeu inconnu.")
    proj, exe = project_dir(), godot_exe()
    if not proj:
        raise JeuxError("Dossier godot_games introuvable à côté d'ENOS.exe.")
    if not exe:
        raise JeuxError("Godot introuvable : renseignez son chemin dans RÉGLAGES → PROFIL.")
    args = [exe, "--path", proj]
    if game != "menu":
        args += ["--", f"--game={game}"]
    with _lock:
        old = _proc["p"]
        if old and old.poll() is None:
            old.terminate()
        try:
            _proc["p"] = subprocess.Popen(args, cwd=os.path.dirname(exe), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                          stderr=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW)
        except OSError as e:
            raise JeuxError(f"Lancement impossible : {e}")
    return status()
