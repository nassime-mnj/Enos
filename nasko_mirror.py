"""Miroir du téléphone sur le PC : scrcpy par Wi-Fi (ADB sans fil), lancé AUTOMATIQUEMENT au démarrage d'E.N.O.S. si `mirror_auto` est activé.

Le téléphone est trouvé, dans l'ordre : 1) adresse saisie (mirror_host / mirror_port) ; 2) le cloud (le téléphone annonce son IP Wi-Fi et son port ADB : voir nasko_cloud.devices) ;
3) la découverte réseau d'ADB (`adb mdns services`, « Débogage sans fil » d'Android 11+). Le premier appairage (`adb pair`, code à 6 chiffres affiché sur le téléphone) se fait une fois.
Si l'utilisateur ferme la fenêtre, on ne la rouvre pas tout de suite (pause de 10 minutes) : le miroir ne doit jamais s'imposer.
La fenêtre de scrcpy est une fenêtre à part (« E.N.O.S. · Téléphone ») ; sous Windows elle peut être collée à côté d'E.N.O.S. (mirror_dock)."""
import logging
import os
import re
import shutil
import subprocess
import threading
import time

import nasko_core

log = logging.getLogger("nasko.mirror")
TITLE = "E.N.O.S. · Téléphone"
COOLDOWN_S = 600
_ADDR = re.compile(r"^(\d{1,3}\.){3}\d{1,3}$")
_lock = threading.RLock()
S = {"state": "off", "detail": "", "target": "", "since": 0.0}
_proc = {"p": None}
_stop = threading.Event()
_thread = {"t": None}


class MirrorError(Exception):
    """Message lisible, affiché tel quel."""


def _cfg():
    return nasko_core.load_config()


def find_tool(name, configured=""):
    """adb / scrcpy : chemin configuré, PATH, puis emplacements habituels de Windows."""
    if configured and os.path.isfile(configured):
        return configured
    p = shutil.which(name)
    if p:
        return p
    lad = os.environ.get("LOCALAPPDATA", "")
    pf = os.environ.get("ProgramFiles", "")
    for c in (os.path.join(lad, "Android", "Sdk", "platform-tools", name + ".exe"), os.path.join(lad, "scrcpy", name + ".exe"), os.path.join(pf, "scrcpy", name + ".exe"),
              os.path.join(os.path.expanduser("~"), "scrcpy", name + ".exe"), os.path.join(os.path.expanduser("~"), "scoop", "shims", name + ".exe")):
        if c and os.path.isfile(c):
            return c
    return ""


def run(cmd, timeout=15):
    """Exécute une commande (injectable pour les tests) -> (code, sortie)."""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace",
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except FileNotFoundError:
        raise MirrorError("Outil introuvable : " + os.path.basename(cmd[0]))
    except subprocess.TimeoutExpired:
        raise MirrorError("Délai dépassé : " + " ".join(os.path.basename(c) for c in cmd[:2]))


def valid_target(host, port):
    try:
        return bool(_ADDR.match(host)) and all(0 <= int(x) <= 255 for x in host.split(".")) and 1 <= int(port) <= 65535
    except (TypeError, ValueError):
        return False


def parse_mdns(text):
    """`adb mdns services` -> [(ip, port)] des services « _adb-tls-connect._tcp » (Débogage sans fil)."""
    out = []
    for line in text.splitlines():
        if "_adb-tls-connect" in line:
            m = re.search(r"(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})\s*$", line.strip())
            if m and valid_target(m.group(1), m.group(2)):
                out.append((m.group(1), int(m.group(2))))
    return out


def candidates(cfg=None, cloud_devices=None, adb="", run_=None):
    """Cibles possibles (ip, port, origine), de la plus sûre à la moins sûre."""
    cfg = cfg or _cfg()
    out = []
    if cfg.get("mirror_host") and valid_target(cfg["mirror_host"], cfg.get("mirror_port") or 5555):
        out.append((cfg["mirror_host"], int(cfg.get("mirror_port") or 5555), "manuel"))
    try:
        devs = cloud_devices() if callable(cloud_devices) else (cloud_devices or [])
    except Exception:                                      # noqa: BLE001 — cloud absent / hors ligne : on essaie la suite
        devs = []
    for d in devs:
        if d.get("online") and d.get("adb_port"):
            for ip in d.get("lan_ips", []):
                if valid_target(ip, d["adb_port"]):
                    out.append((ip, int(d["adb_port"]), "cloud"))
    if adb:
        try:
            code, txt = (run_ or run)([adb, "mdns", "services"], 8)
            out += [(ip, p, "réseau") for ip, p in parse_mdns(txt)]
        except MirrorError:
            pass
    seen, uniq = set(), []
    for c in out:
        if c[:2] not in seen:
            seen.add(c[:2]); uniq.append(c)
    return uniq


def set_state(state, detail="", target=""):
    with _lock:
        S.update(state=state, detail=detail, target=target or S.get("target", ""), since=time.time())


def status():
    with _lock:
        p = _proc["p"]
        running = bool(p and p.poll() is None)
        out = dict(S)
    c = _cfg()
    out.update(running=running, auto=bool(c.get("mirror_auto")), host=c.get("mirror_host", ""), port=c.get("mirror_port") or 5555, dock=bool(c.get("mirror_dock")),
               adb=bool(find_tool("adb", c.get("adb_path", ""))), scrcpy=bool(find_tool("scrcpy", c.get("scrcpy_path", ""))))
    return out


def pair(host, port, code):
    """Premier appairage (Android 11+ : Options pour développeurs > Débogage sans fil > Associer avec un code)."""
    if not valid_target(host, port):
        raise MirrorError("Adresse ou port invalides.")
    if not re.fullmatch(r"\d{6}", str(code or "")):
        raise MirrorError("Le code d'association comporte 6 chiffres.")
    adb = find_tool("adb", _cfg().get("adb_path", ""))
    if not adb:
        raise MirrorError("ADB est introuvable : installez « Android platform-tools » ou renseignez adb_path.")
    rc, out = run([adb, "pair", f"{host}:{port}", str(code)], 25)
    if rc != 0 or "success" not in out.lower():
        raise MirrorError("Association refusée : " + out.strip()[-160:])
    return True


def connect_and_start(cloud_devices=None, run_=None, popen=None):
    """Trouve le téléphone, `adb connect`, lance scrcpy. Lève MirrorError (message lisible) sinon. Retourne la cible « ip:port »."""
    run_ = run_ or run
    popen = popen or subprocess.Popen
    c = _cfg()
    adb, scr = find_tool("adb", c.get("adb_path", "")), find_tool("scrcpy", c.get("scrcpy_path", ""))
    if not adb:
        raise MirrorError("ADB est introuvable (Android platform-tools).")
    if not scr:
        raise MirrorError("scrcpy est introuvable (github.com/Genymobile/scrcpy) : placez-le dans le PATH ou renseignez scrcpy_path.")
    with _lock:
        if _proc["p"] and _proc["p"].poll() is None:
            return S.get("target", "")
    set_state("searching", "Recherche du téléphone…")
    cands = candidates(c, cloud_devices, adb, run_)
    if not cands:
        raise MirrorError("Téléphone introuvable : ouvrez l'application mobile (compte cloud) avec « Débogage sans fil » activé, ou saisissez son adresse.")
    last = ""
    for ip, port, origin in cands:
        target = f"{ip}:{port}"
        set_state("connecting", f"Connexion à {target} ({origin})…", target)
        try:
            rc, out = run_([adb, "connect", target], 12)
        except MirrorError as e:
            last = str(e); continue
        if "connected" not in out.lower() or "unable" in out.lower() or "failed" in out.lower():
            last = out.strip()[-140:]; continue
        args = [scr, "--serial", target, "--window-title", TITLE, "--stay-awake", "--max-size", str(int(c.get("mirror_max_size") or 1280)), "--max-fps", "30"]
        if c.get("mirror_no_audio", False):
            args.append("--no-audio")
        p = popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        time.sleep(0.6)
        if p.poll() is not None:
            last = "scrcpy s'est arrêté aussitôt (téléphone non autorisé ? vérifiez l'invite « Autoriser le débogage »)."; continue
        with _lock:
            _proc["p"] = p
        set_state("running", f"Écran de {target} affiché", target)
        if c.get("mirror_dock"):
            threading.Timer(2.0, dock).start()
        return target
    raise MirrorError("Connexion impossible : " + (last or "aucune réponse"))


def stop():
    with _lock:
        p, _proc["p"] = _proc["p"], None
    if p and p.poll() is None:
        p.terminate()
        try:
            p.wait(5)
        except Exception:                                  # noqa: BLE001
            p.kill()
    set_state("off", "Miroir arrêté")


def dock():
    """Windows : colle la fenêtre du miroir contre le bord droit de la fenêtre E.N.O.S. (best effort, silencieux en cas d'échec)."""
    if os.name != "nt":
        return False
    try:
        import ctypes
        from ctypes import wintypes
        u = ctypes.windll.user32
        mine = u.FindWindowW(None, TITLE)
        enos = 0
        for name in ("E.N.O.S.", "E.N.O.S", "ENOS"):
            enos = enos or u.FindWindowW(None, name)
        if not (mine and enos):
            return False
        r = wintypes.RECT(); u.GetWindowRect(enos, ctypes.byref(r))
        u.SetWindowPos(mine, 0, r.right, r.top, 0, r.bottom - r.top, 0x0001 | 0x0004)      # SWP_NOSIZE | SWP_NOZORDER : déplacement seul
        return True
    except Exception:                                      # noqa: BLE001
        return False


# ----------------------------------------------------------------------------- démarrage automatique
def _loop(cloud_devices, delay0=8.0):
    _stop.wait(delay0)                                     # laisse E.N.O.S. et le réseau démarrer
    wait = 15.0
    while not _stop.is_set():
        c = _cfg()
        if not c.get("mirror_auto"):
            set_state("off", "Miroir automatique désactivé"); _stop.wait(10.0); continue
        with _lock:
            p = _proc["p"]
        if p and p.poll() is None:
            _stop.wait(5.0); continue
        if p and p.poll() == 0:                            # fenêtre fermée par l'utilisateur : pause
            with _lock:
                _proc["p"] = None
            set_state("off", "Fermé : le miroir ne se rouvrira pas avant 10 minutes")
            _stop.wait(COOLDOWN_S); continue
        try:
            connect_and_start(cloud_devices)
            wait = 15.0
        except MirrorError as e:
            set_state("error", str(e)); wait = min(wait * 2, 300.0)
        _stop.wait(wait)


def autostart(cloud_devices=None):
    """Lance la tâche de fond (appelée au démarrage du serveur) ; ne fait rien tant que mirror_auto est faux."""
    with _lock:
        if _thread["t"] and _thread["t"].is_alive():
            return
        _stop.clear()
        t = threading.Thread(target=_loop, args=(cloud_devices,), daemon=True, name="mirror-auto")
        _thread["t"] = t
        t.start()


def shutdown():
    _stop.set()
    stop()
