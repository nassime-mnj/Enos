"""ALLÈGE LA RAM d'E.N.O.S. pendant qu'on joue / qu'on filme (OBS), sans rien retirer de l'application.

Windows garde dans le « working set » d'un processus des pages qu'il n'utilise plus (tas Python fragmenté, DLL chargées une fois : OpenCV, NumPy, .NET…).
Quand la RAM du PC est sous pression, ces pages mortes font swapper le jeu et OBS. Ici, à intervalle raisonnable :
  * gc.collect() puis EmptyWorkingSet sur E.N.O.S. et sur ses processus enfants (Œil Godot, plateau Godot, scènes Chess Edit…) : Windows rend les pages
    inutilisées ; celles qui servent encore reviennent en quelques microsecondes (défauts de page « soft », sans disque) ;
  * seuil de déclenchement plus bas quand OBS tourne (obs64.exe) : c'est précisément là que la RAM sature ;
  * jamais plus d'un nettoyage par 45 s en cas de pression, ni moins d'un toutes les 5 min sinon.
Aucune donnée, aucun tampon (Auto-Clipper compris), aucune qualité ni fonctionnalité n'est touchée : seule la mémoire inutilisée est restituée.
Désactivable : `"memtrim": false` dans nasko_config.json.
"""
import gc
import logging
import os
import threading
import time

log = logging.getLogger("nasko.memtrim")
PRESSURE_PCT = 78            # % de RAM utilisée au-delà duquel on nettoie (cooldown 45 s)
PRESSURE_PCT_OBS = 62        # même chose quand OBS tourne
COOLDOWN = 45.0
PERIODIC = 300.0
_st = {"thread": None, "stop": threading.Event(), "last": 0.0, "saved_mb": 0.0, "runs": 0, "freed_total_mb": 0.0}


def _empty_ws(handle):
    import ctypes
    from ctypes import wintypes
    fn = ctypes.WinDLL("psapi", use_last_error=True).EmptyWorkingSet
    fn.argtypes = [wintypes.HANDLE]
    fn.restype = wintypes.BOOL
    return bool(fn(handle))


def _rss_mb(proc):
    try:
        return proc.memory_info().rss / 1e6
    except Exception:                                              # noqa: BLE001
        return 0.0


def trim_now(children=True):
    """Nettoie ce processus (+ ses enfants) ; retourne les Mo rendus à Windows."""
    if os.name != "nt":
        return 0.0
    import ctypes
    import psutil
    me = psutil.Process()
    before = _rss_mb(me)
    gc.collect()
    _empty_ws(ctypes.c_void_p(-1))                              # pseudo-handle du processus courant
    freed = max(0.0, before - _rss_mb(me))
    if children:
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.OpenProcess.restype = ctypes.c_void_p
        k32.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
        k32.CloseHandle.argtypes = [ctypes.c_void_p]
        for c in me.children(recursive=True):
            b = _rss_mb(c)
            h = k32.OpenProcess(0x0100 | 0x0400, False, c.pid)     # PROCESS_SET_QUOTA | PROCESS_QUERY_INFORMATION
            if not h:
                continue
            try:
                _empty_ws(h)
            finally:
                k32.CloseHandle(h)
            freed += max(0.0, b - _rss_mb(c))
    _st["runs"] += 1
    _st["saved_mb"] = round(freed, 1)
    _st["freed_total_mb"] = round(_st["freed_total_mb"] + freed, 1)
    return freed


def _obs_running():
    import psutil
    try:
        return any((p.info["name"] or "").lower() in ("obs64.exe", "obs32.exe", "streamlabs obs.exe", "streamlabs desktop.exe") for p in psutil.process_iter(["name"]))
    except Exception:                                              # noqa: BLE001
        return False


def _loop():
    import psutil
    obs_t = 0.0
    obs = False
    while not _st["stop"].wait(15.0):
        try:
            now = time.time()
            if now - obs_t > 30:                                   # la liste des processus coûte : on ne la relit que toutes les 30 s
                obs, obs_t = _obs_running(), now
            used = psutil.virtual_memory().percent
            limit = PRESSURE_PCT_OBS if obs else PRESSURE_PCT
            due = (used >= limit and now - _st["last"] >= COOLDOWN) or now - _st["last"] >= PERIODIC
            if due:
                _st["last"] = now
                mb = trim_now()
                log.info("RAM %.0f %% (OBS %s) : %.0f Mo rendus à Windows", used, "oui" if obs else "non", mb)
        except Exception:                                          # noqa: BLE001
            log.debug("nettoyage mémoire impossible", exc_info=True)


def start(enabled=True):
    if os.name != "nt" or not enabled or (_st["thread"] and _st["thread"].is_alive()):
        return False
    _st["stop"].clear()
    _st["last"] = time.time()
    t = threading.Thread(target=_loop, daemon=True, name="memtrim")
    _st["thread"] = t
    t.start()
    return True


def stop():
    _st["stop"].set()


def status():
    return {"running": bool(_st["thread"] and _st["thread"].is_alive()), "runs": _st["runs"], "last_saved_mb": _st["saved_mb"], "freed_total_mb": _st["freed_total_mb"]}


def lower_thread_priority():
    """Appelé par les threads de fond (capture d'écran, audio) : ils cèdent le CPU au jeu, à OBS et à l'interface. Sans effet hors Windows."""
    if os.name != "nt":
        return
    try:
        import ctypes
        k32 = ctypes.windll.kernel32
        k32.SetThreadPriority(k32.GetCurrentThread(), -1)          # THREAD_PRIORITY_BELOW_NORMAL
    except Exception:                                              # noqa: BLE001
        pass
