"""CONTRÔLE MOBILE : pilote UN téléphone Android précis via adb (et le miroir scrcpy).

SÉCURITÉ — ce module est strictement local :
  * aucune commande ne passe par l'entrepôt partagé (OneDrive) ni par le réseau d'E.N.O.S. : adb parle au téléphone par USB (ou à l'IP
    qu'on a saisie soi-même) depuis ce PC ;
  * toute commande est émise avec `adb -s <ID>` : sans identifiant renseigné dans RÉGLAGES → PROFIL, rien n'est envoyé. L'ID est stocké
    dans le PROFIL actif (Nassime, Raf…) : chacun ne pilote que son propre téléphone ;
  * seules des actions prédéfinies sont exposées (pas de commande shell libre) ; aucun `shell=True`.
"""
import os
import re
import subprocess
import threading

import nasko_core
import nasko_tools as tools

ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:\-]{0,63}$")          # série USB ou ip:port
ADB_ZIP = "https://dl.google.com/android/repository/platform-tools-latest-windows.zip"
HOW_ADB = ("Placez adb.exe (avec AdbWinApi.dll et AdbWinUsbApi.dll) dans le dossier « outils\\adb » à côté d'ENOS.exe, ou dans "
           + "%LOCALAPPDATA%\\ENOS\\outils\\adb. Source : Android SDK Platform-Tools (developer.android.com/tools/releases/platform-tools).")

# actions autorisées : nom → (libellé, arguments après `shell`)
ACTIONS = {
    "screen": ("Écran allumé/éteint", ["input", "keyevent", "26"]),
    "youtube": ("YouTube ouvert", ["monkey", "-p", "com.google.android.youtube", "-c", "android.intent.category.LAUNCHER", "1"]),
    "swipe": ("Balayage vers le haut", ["input", "swipe", "500", "1500", "500", "500"]),
}

_lock = threading.Lock()
_scrcpy = {"proc": None}
_dl = {"busy": "", "pct": 0.0}


class MobileError(Exception):
    pass


# ----------------------------------------------------------------------------- identifiant de l'appareil (profil actif)
def device_id():
    return str(nasko_core.load_config().get("adb_device_id") or "").strip()


def set_device_id(value):
    value = (value or "").strip()
    if value and not ID_RE.match(value):
        raise MobileError("Identifiant invalide (lettres, chiffres, . _ : - ; 64 caractères max).")
    data = nasko_core.load_profiles()
    pid, _pr = nasko_core.current_profile(data)
    opts = data["profiles"][pid].setdefault("options", {})
    if value:
        opts["adb_device_id"] = value
    else:
        opts.pop("adb_device_id", None)
    nasko_core.save_profiles(data)
    return value


# ----------------------------------------------------------------------------- outils
def adb_path():
    return tools.find_exe("adb.exe", "adb")


def scrcpy_path():
    return tools.find_exe("scrcpy.exe", "scrcpy")


def _progress(name):
    def cb(p):
        _dl["pct"] = p
    _dl["busy"], _dl["pct"] = name, 0.0
    return cb


def install_adb():
    with _lock:
        try:
            tools.install_zip(ADB_ZIP, "adb", progress=_progress("adb"))
        except tools.ToolError as e:
            raise MobileError(str(e) + " " + HOW_ADB)
        finally:
            _dl["busy"] = ""
    p = adb_path()
    if not p:
        raise MobileError("adb.exe introuvable après extraction. " + HOW_ADB)
    return p


def install_scrcpy():
    with _lock:
        try:
            url, _n, sha = tools.github_asset("Genymobile/scrcpy", lambda n: n.startswith("scrcpy-win64") and n.endswith(".zip"))
            tools.install_zip(url, "scrcpy", sha, _progress("scrcpy"))
        except tools.ToolError as e:
            raise MobileError(str(e))
        finally:
            _dl["busy"] = ""
    p = scrcpy_path()
    if not p:
        raise MobileError("scrcpy.exe introuvable après extraction.")
    return p


def _run(cmd, timeout=15):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, creationflags=tools.CREATE_NO_WINDOW,
                           encoding="utf-8", errors="replace")
    except subprocess.TimeoutExpired:
        raise MobileError("adb ne répond pas (délai dépassé).")
    except OSError as e:
        raise MobileError(f"adb impossible à lancer : {e}")
    return r


# ----------------------------------------------------------------------------- appareils
def list_devices():
    """[{id, state, model}] des appareils vus par adb (aide à renseigner l'ID ; n'envoie aucune commande à un appareil)."""
    adb = adb_path()
    if not adb:
        return []
    r = _run([adb, "devices", "-l"])
    out = []
    for line in r.stdout.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2 and ID_RE.match(parts[0]):
            model = next((p.split(":", 1)[1] for p in parts[2:] if p.startswith("model:")), "")
            out.append({"id": parts[0], "state": parts[1], "model": model})
    return out


def status():
    did = device_id()
    devs = list_devices() if adb_path() else []
    mine = next((d for d in devs if d["id"] == did), None)
    scr = _scrcpy["proc"]
    return {"adb": bool(adb_path()), "scrcpy": bool(scrcpy_path()), "device_id": did, "devices": devs,
            "state": (mine or {}).get("state", "absent" if did else "non configuré"), "model": (mine or {}).get("model", ""),
            "mirroring": bool(scr and scr.poll() is None), "download": dict(_dl), "how_adb": HOW_ADB}


def _target():
    """(adb, id) prêts à l'emploi, ou erreur claire : on refuse d'agir sans ID (jamais « le premier appareil trouvé »)."""
    did = device_id()
    if not did:
        raise MobileError("Aucun appareil ciblé : renseignez l'ID ADB dans RÉGLAGES → PROFIL → TÉLÉPHONE.")
    adb = adb_path() or install_adb()
    return adb, did


def run_action(name):
    if name not in ACTIONS:
        raise MobileError("Action inconnue.")
    adb, did = _target()
    label, args = ACTIONS[name]
    r = _run([adb, "-s", did, "shell", *args])
    msg = (r.stdout + r.stderr).strip()
    if r.returncode != 0 or msg.lower().startswith("error"):
        if "unauthorized" in msg.lower():
            raise MobileError("Téléphone non autorisé : acceptez la fenêtre « Autoriser le débogage USB » sur le téléphone.")
        raise MobileError(msg or f"adb a échoué (code {r.returncode}).")
    return {"ok": True, "label": label, "output": msg[:300]}


def mirror():
    adb, did = _target()
    exe = scrcpy_path() or install_scrcpy()
    prev = _scrcpy["proc"]
    if prev and prev.poll() is None:
        return {"ok": True, "label": "Miroir déjà affiché"}
    env = dict(os.environ, ADB=adb)                                 # scrcpy utilise NOTRE adb, pas un autre serveur adb
    try:
        _scrcpy["proc"] = subprocess.Popen([exe, "--serial", did], cwd=os.path.dirname(exe), env=env,
                                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                           creationflags=tools.CREATE_NO_WINDOW)
    except OSError as e:
        raise MobileError(f"scrcpy impossible à lancer : {e}")
    return {"ok": True, "label": "Miroir lancé"}


def stop_mirror():
    p = _scrcpy["proc"]
    if p and p.poll() is None:
        p.terminate()
    _scrcpy["proc"] = None
