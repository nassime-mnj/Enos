"""MISES À JOUR GÉRÉES PAR LE DUAL PULSE LAUNCHER — côté E.N.O.S. (les installations d'E.N.O.S. ne se mettent plus à jour elles-mêmes).

Le Launcher télécharge la nouvelle version en arrière-plan dans un dossier de staging (même si E.N.O.S. tourne) puis le signale par un fichier flag ; E.N.O.S. affiche
une bannière discrète « Une mise à jour est prête. [Redémarrer pour appliquer] [Plus tard] ». Le Launcher ne ferme JAMAIS l'application de force : si l'utilisateur clique
« Redémarrer », E.N.O.S. écrit un flag « apply » puis se ferme volontairement ; le Launcher voit la fermeture, remplace les fichiers et relance E.N.O.S.

Fichiers (JSON UTF-8, écrits atomiquement) dans <base>/enos/ — base = DP_SIGNALS_DIR, sinon %LOCALAPPDATA%\\DualPulse\\signals (Windows) ou ~/.local/share/DualPulse/signals :
  update-ready.json    Launcher → E.N.O.S. : {product, channel, version, notes, staged_at, size}
  running.json         E.N.O.S. → Launcher : {pid, started_at, exe}  (écrit au démarrage, supprimé à la sortie propre)
  update-apply.json    E.N.O.S. → Launcher : {requested_at, pid}     (clic sur « Redémarrer »)
  update-applied.json  Launcher → E.N.O.S. : {version, applied_at}   (informatif : « mis à jour vers X »)
Ces fichiers ne contiennent aucun secret ; la lecture est tolérante (absent / corrompu / trop gros = absent).
"""
import atexit
import json
import os
import re
import sys
import threading
import time

import nasko_core

PRODUCT = "enos"
MAX_BYTES = 16 * 1024
APPLY_STALE_S = 600
_PRODUCT_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,30}$")
_VER_RE = re.compile(r"^\d+(\.\d+){0,3}$")


def managed(cfg=None):
    """Vrai : les mises à jour sont l'affaire du Launcher. Installation (exe) : oui par défaut ; copie de sources (build.bat) : non (mise à jour par build.bat).
    Forçable avec `update_managed_by_launcher` dans la config."""
    cfg = cfg if cfg is not None else nasko_core.load_config()
    v = cfg.get("update_managed_by_launcher")
    return bool(v) if v is not None else bool(getattr(sys, "frozen", False))


def base_dir():
    b = os.environ.get("DP_SIGNALS_DIR")
    if b:
        return b
    if os.name == "nt":
        return os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "DualPulse", "signals")
    return os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "DualPulse", "signals")


def signals_dir(product=PRODUCT):
    if not _PRODUCT_RE.match(product):
        raise ValueError("produit invalide")
    return os.path.join(base_dir(), product)


def _path(name):
    return os.path.join(signals_dir(), name)


def _read(name):
    try:
        p = _path(name)
        if os.path.getsize(p) > MAX_BYTES:
            return None
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else None
    except (OSError, ValueError):
        return None


def _write(name, obj):
    d = signals_dir()
    os.makedirs(d, exist_ok=True)
    p = _path(name)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp, p)                                   # jamais de fichier à moitié écrit côté Launcher


def _remove(name):
    try:
        os.remove(_path(name))
    except OSError:
        pass


# ---------------------------------------------------------------------------- application en cours d'exécution
def mark_running(pid=None):
    """À appeler au démarrage du serveur : le Launcher sait ainsi que l'application tourne (et quel processus attendre)."""
    try:
        _write("running.json", {"pid": int(pid or os.getpid()), "started_at": int(time.time()), "exe": os.path.basename(sys.executable)})
    except OSError:
        pass


def clear_running():
    _remove("running.json")


# ---------------------------------------------------------------------------- mise à jour prête
def _clean_ready(d):
    if not d or not isinstance(d.get("version"), str) or not _VER_RE.match(d["version"]):
        return None
    return {"product": str(d.get("product", PRODUCT))[:31], "channel": str(d.get("channel", ""))[:20], "version": d["version"], "notes": str(d.get("notes", ""))[:2000],
            "staged_at": int(d["staged_at"]) if isinstance(d.get("staged_at"), (int, float)) else None, "size": int(d["size"]) if isinstance(d.get("size"), (int, float)) else None}


def ready():
    """Mise à jour téléchargée et vérifiée par le Launcher, ou None."""
    return _clean_ready(_read("update-ready.json"))


def applied():
    """Dernière application réussie ({version, applied_at}) ; `consume_applied()` l'efface une fois montrée."""
    d = _read("update-applied.json")
    if d and isinstance(d.get("version"), str) and _VER_RE.match(d["version"]):
        return {"version": d["version"], "applied_at": int(d["applied_at"]) if isinstance(d.get("applied_at"), (int, float)) else None}
    return None


def consume_applied():
    _remove("update-applied.json")


def status(cfg=None):
    return {"managed": managed(cfg), "ready": ready(), "applied": applied(), "pending_apply": _read("update-apply.json") is not None}


# ---------------------------------------------------------------------------- « Redémarrer pour appliquer »
def request_apply(shutdown, delay=0.8, pid=None):
    """Écrit le flag « apply » puis ferme l'application VOLONTAIREMENT (après `delay` s, pour laisser partir la réponse HTTP). Refuse s'il n'y a rien de prêt.
    `shutdown` : fonction d'arrêt propre du serveur."""
    r = ready()
    if not r:
        raise ValueError("Aucune mise à jour prête.")
    _write("update-apply.json", {"requested_at": int(time.time()), "pid": int(pid or os.getpid())})
    t = threading.Timer(delay, shutdown)
    t.daemon = True
    t.start()
    return r


def cancel_apply():
    _remove("update-apply.json")


atexit.register(clear_running)
