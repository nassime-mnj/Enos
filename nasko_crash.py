"""JOURNAL DE PLANTAGES du PC : un fichier texte (data/crash.log, 512 Ko max, la moitié récente est gardée) qui reçoit
  * les exceptions Python non rattrapées (thread principal, threads, hooks « unraisable »), avec la pile complète ;
  * les erreurs de journalisation de niveau ERROR / CRITICAL de tous les modules (un `log.error(..., exc_info=True)` y laisse sa pile) ;
  * les plantages natifs (faulthandler : segfault, accès mémoire interdit) dans data/crash_native.log ;
  * les erreurs JavaScript des pages de l'interface (POST /api/crash/log depuis static/crashlog.js) ;
  * un témoin « session.run » : s'il existe au lancement, la session précédente s'est arrêtée anormalement (plantage, coupure, kill) -> une ligne l'indique ;
  * la mémoire du processus au démarrage (psutil, si disponible).
Rien n'est envoyé hors du PC. Lisible dans l'interface (Réglages > Journal de plantages) ; le même format que le journal Android."""
import atexit
import faulthandler
import logging
import os
import sys
import threading
import time
import traceback

MAX_BYTES = 512 * 1024
_lock = threading.RLock()
_state = {"dir": None, "installed": False, "native": None, "rate": [0.0, 0]}


def _dir():
    if not _state["dir"]:
        import nasko_core
        _state["dir"] = nasko_core.data_dir()
    return _state["dir"]


def _file(name):
    return os.path.join(_dir(), name)


def _stamp(t=None):
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(t))


def add(kind, msg):
    """Ajoute une entrée « [date] TYPE · message ». Ne lève jamais d'exception."""
    try:
        msg = str(msg or "").replace("\r", "")[:8000]
        line = f"[{_stamp()}] {str(kind)[:12]} · {msg}\n"
        with _lock:
            p = _file("crash.log")
            if os.path.exists(p) and os.path.getsize(p) > MAX_BYTES:
                with open(p, encoding="utf-8", errors="replace") as f:
                    txt = f.read()
                cut = txt.find("\n", len(txt) // 2)
                with open(p, "w", encoding="utf-8") as f:
                    f.write(txt[cut + 1:] if cut >= 0 else "")
            with open(p, "a", encoding="utf-8") as f:
                f.write(line)
        return True
    except Exception:                                                    # noqa: BLE001 — le journal ne doit jamais faire planter
        return False


def add_web(kind, msg):
    """Erreur venue d'une page : au plus 40 lignes par minute (boucle d'erreurs)."""
    now = time.time()
    with _lock:
        r = _state["rate"]
        if now - r[0] > 60:
            r[0], r[1] = now, 0
        r[1] += 1
        if r[1] > 40:
            return False
    return add(kind if str(kind).isalpha() or len(str(kind)) <= 12 else "JS", msg)


def text(max_chars=200000):
    try:
        with open(_file("crash.log"), encoding="utf-8", errors="replace") as f:
            t = f.read()
        nat = ""
        try:
            with open(_file("crash_native.log"), encoding="utf-8", errors="replace") as f:
                nat = f.read().strip()
        except OSError:
            pass
        if nat:
            t += f"\n[plantage natif — faulthandler]\n{nat[-6000:]}\n"
        return t[-max_chars:]
    except OSError:
        return ""


def clear():
    try:
        for n in ("crash.log", "crash_native.log"):
            p = _file(n)
            if os.path.exists(p):
                open(p, "w").close()
        return True
    except OSError:
        return False


def count():
    return sum(1 for l in text().splitlines() if l.startswith("[20"))


# ----------------------------------------------------------------------------- crochets Python
def _fmt(exc_type, exc, tb):
    return "".join(traceback.format_exception(exc_type, exc, tb))[-6000:]


class _Handler(logging.Handler):
    """Toute entrée ERROR / CRITICAL du journal applicatif est aussi écrite dans crash.log (avec la pile quand il y en a une)."""
    def emit(self, record):
        try:
            if record.name.startswith("nasko.crash"):
                return
            msg = self.format(record)
            add("ERREUR", f"{record.name} : {msg}")
        except Exception:                                                # noqa: BLE001
            pass


def install():
    """À appeler une fois au démarrage (idempotent)."""
    if _state["installed"]:
        return
    _state["installed"] = True
    marker = _file("session.run")
    try:
        if os.path.exists(marker):
            with open(marker, encoding="utf-8") as f:
                last = f.read().strip()
            add("ARRÊT", f"session précédente interrompue anormalement (plantage, coupure ou arrêt forcé) · lancée le {last}")
        with open(marker, "w", encoding="utf-8") as f:
            f.write(_stamp())
    except OSError:
        pass
    atexit.register(lambda: os.path.exists(marker) and os.remove(marker))

    prev = sys.excepthook

    def hook(t, e, tb):
        add("PYTHON", "exception non rattrapée (thread principal) :\n" + _fmt(t, e, tb))
        prev(t, e, tb)
    sys.excepthook = hook

    if hasattr(threading, "excepthook"):
        prev_t = threading.excepthook

        def thook(a):
            add("THREAD", f"exception dans le thread « {getattr(a.thread, 'name', '?')} » :\n" + _fmt(a.exc_type, a.exc_value, a.exc_traceback))
            prev_t(a)
        threading.excepthook = thook
    if hasattr(sys, "unraisablehook"):
        prev_u = sys.unraisablehook

        def uhook(a):
            add("PYTHON", f"exception ignorée ({a.err_msg}) : {a.exc_type.__name__}: {a.exc_value}")
            prev_u(a)
        sys.unraisablehook = uhook

    h = _Handler(level=logging.ERROR)
    h.setFormatter(logging.Formatter("%(message)s"))
    logging.getLogger().addHandler(h)
    try:
        _state["native"] = open(_file("crash_native.log"), "a", encoding="utf-8")
        faulthandler.enable(file=_state["native"], all_threads=True)
    except Exception:                                                    # noqa: BLE001
        pass
    try:
        import psutil
        p = psutil.Process()
        vm = psutil.virtual_memory()
        add("INFO", f"Démarrage · Python {sys.version.split()[0]} · {sys.platform} · RAM libre {vm.available >> 20} / {vm.total >> 20} Mo · processus {p.memory_info().rss >> 20} Mo")
    except Exception:                                                    # noqa: BLE001
        add("INFO", f"Démarrage · Python {sys.version.split()[0]} · {sys.platform}")
