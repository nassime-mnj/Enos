"""Garde le PC eveille : E.N.O.S. reste joignable (telephone / web) tant qu'il tourne.

Windows : SetThreadExecutionState(ES_SYSTEM_REQUIRED | ES_CONTINUOUS), applique par un thread dedie. Empeche la mise en
veille automatique ; l'ecran peut s'eteindre. N'empeche PAS la veille declenchee par la fermeture du capot ou par le menu
Demarrer (reglez « Fermeture du capot : ne rien faire » dans les options d'alimentation de Windows si besoin).
"""
import ctypes
import logging
import threading

log = logging.getLogger("nasko.power")

ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001


class KeepAwake:
    def __init__(self):
        self._stop = threading.Event()
        self._thread = None
        self.active = False

    def _run(self):
        try:
            prev = ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
        except (AttributeError, OSError):
            return
        self.active = prev != 0 or True
        log.info("PC maintenu eveille (veille automatique bloquee)")
        self._stop.wait()
        ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS)
        self.active = False
        log.info("Veille automatique de nouveau autorisee")

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="keep-awake", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(2)

    def apply(self, enabled):
        self.start() if enabled else self.stop()


keep = KeepAwake()


# ---------------------------------------------------------------- arret / veille du PC (avec compte a rebours annulable)
import subprocess
import time

ACTIONS = {"shutdown": "Arrêt du PC", "sleep": "Mise en veille du PC"}


def _do_shutdown():
    # pas de /f : les programmes avec des travaux non enregistres peuvent demander confirmation au lieu de perdre les donnees
    subprocess.run(["shutdown", "/s", "/t", "0", "/c", "Arrêt demandé via E.N.O.S."], creationflags=subprocess.CREATE_NO_WINDOW, timeout=20)


def _do_sleep():
    # SetSuspendState(hibernate=False, force=False, wakeupEventsDisabled=False) : veille, jamais d'hibernation
    ctypes.windll.powrprof.SetSuspendState(0, 0, 0)


class PowerPlan:
    """Une seule action programmee a la fois ; annulable tant que le compte a rebours n'est pas ecoule."""

    def __init__(self, shutdown=_do_shutdown, sleep=_do_sleep):
        self._exec = {"shutdown": shutdown, "sleep": sleep}
        self._lock = threading.Lock()
        self._timer = None
        self.pending = None            # {action, by, at, delay}

    def request(self, action, delay, by, before=None):
        """Programme `action` dans `delay` secondes. `before` (facultatif) est appele juste avant l'execution."""
        if action not in ACTIONS:
            raise ValueError("action inconnue")
        delay = max(5, min(300, int(delay)))
        with self._lock:
            if self.pending:
                raise RuntimeError("une action est déjà programmée")
            self.pending = {"action": action, "by": by, "at": time.time() + delay, "delay": delay}
            self._timer = threading.Timer(delay, self._fire, args=(action, before))
            self._timer.daemon = True
            self._timer.start()
        log.warning("%s programmé dans %ss par %s", ACTIONS[action], delay, by)
        return dict(self.pending)

    def cancel(self, by="?"):
        with self._lock:
            if not self.pending:
                return False
            self._timer.cancel()
            was, self.pending, self._timer = self.pending, None, None
        log.warning("%s annulé par %s", ACTIONS[was["action"]], by)
        return True

    def _fire(self, action, before):
        with self._lock:
            if not self.pending or self.pending["action"] != action:
                return
            self.pending = None
        try:
            if before:
                before()
            self._exec[action]()
        except Exception as e:                                   # noqa: BLE001 - jamais de plantage du thread
            log.error("%s impossible : %s", ACTIONS[action], e)

    def status(self):
        with self._lock:
            p = dict(self.pending) if self.pending else None
        return {"pending": p, "now": time.time()}


plan = PowerPlan()
