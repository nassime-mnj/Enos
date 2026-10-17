"""SMART AFK (premium gaming) : empêche l'expulsion pour inactivité en simulant de légers micro-mouvements de caméra et des frappes ZQSD aléatoires
toutes les 10 à 20 s. Activation depuis la Palette Ctrl+K (« AFK »).

États : idle -> armed -> active.
  * armed  : le module attend que l'utilisateur LÂCHE clavier/souris (afk_idle_s, 5 s par défaut) : le temps de basculer sur le jeu. Échap annule.
  * active : actions aléatoires. KILL-SWITCH ABSOLU : tout mouvement manuel de la souris, clic, molette, touche ou Échap désactive le module
             instantanément, relâche toutes les touches simulées et rend la main. Un arrêt manuel (API / Palette) fait pareil.

Comment on distingue la main de l'utilisateur de nos propres événements : sous Windows, le crochet bas niveau (pynput `win32_event_filter`) lit le drapeau
LLMHF_INJECTED / LLKHF_INJECTED posé par SendInput -> nos événements sont ignorés, ceux du matériel déclenchent l'arrêt. Ailleurs (repli), on ignore les
événements pendant nos propres injections (+ une courte marge).

Garde-fous : arrêt automatique après afk_max_minutes (120 ; 0 = jamais) ; afk_only_process (ex. "VALORANT-Win64-Shipping.exe") limite les actions à la
fenêtre de ce jeu au premier plan (sinon des touches partiraient dans un autre programme) ; réservé à ce PC (routes _LOCAL).
Attention : ces entrées sont « injectées » et détectables ; beaucoup d'anti-triche / CGU de jeux interdisent l'anti-AFK. À l'utilisateur de vérifier.
"""
import logging
import math
import random
import sys
import threading
import time

import nasko_core

log = logging.getLogger("nasko.afk")

LLMHF_INJECTED = 0x01
LLKHF_INJECTED = 0x10
OPPOSITE = {"z": "s", "s": "z", "q": "d", "d": "q", "w": "s", "a": "d"}
MOVE_PX = 6.0                     # déplacement matériel cumulé (en 0,4 s) qui compte comme « l'utilisateur a repris la souris » (tolère un capteur qui vibre)
MOVE_WINDOW_S = 0.4
ARM_TIMEOUT_S = 180               # en attente d'un moment calme depuis plus de 3 min : on annule plutôt que de partir sans prévenir
DEFAULTS = {"afk_min_s": 10.0, "afk_max_s": 20.0, "afk_idle_s": 5.0, "afk_max_minutes": 120, "afk_keys": "zqsd", "afk_only_process": ""}


class AFKError(Exception):
    pass


def _cfg(cfg, key):
    return cfg.get(key, DEFAULTS[key]) if cfg else DEFAULTS[key]


class PynputBackend:
    """Sorties (souris/clavier simulés) et écouteurs globaux, via pynput (importé à la demande)."""

    def __init__(self):
        try:
            from pynput import keyboard, mouse
        except Exception as e:                                       # noqa: BLE001 — absent, ou pas d'écran (Linux sans X)
            raise AFKError("pynput indisponible (py -m pip install pynput) : " + str(e)) from e
        self._kb, self._ms = keyboard, mouse
        self.mouse, self.keyboard = mouse.Controller(), keyboard.Controller()
        self._listeners = []

    def move(self, dx, dy):
        self.mouse.move(int(dx), int(dy))                            # relatif (SendInput MOUSEEVENTF_MOVE) : fonctionne dans les jeux à souris capturée

    def press(self, key):
        self.keyboard.press(key)

    def release(self, key):
        self.keyboard.release(key)

    def listen(self, on_move, on_click, on_scroll, on_key):
        kw_m, kw_k = {}, {}
        if sys.platform == "win32":                                  # False = pynput n'appelle pas nos rappels (l'événement, lui, continue vers le jeu)
            kw_m["win32_event_filter"] = lambda msg, data: not (data.flags & LLMHF_INJECTED)
            kw_k["win32_event_filter"] = lambda msg, data: not (data.flags & LLKHF_INJECTED)
        ms = self._ms.Listener(on_move=on_move, on_click=lambda x, y, b, p: on_click(), on_scroll=lambda x, y, dx, dy: on_scroll(), **kw_m)
        kb = self._kb.Listener(on_press=lambda k: on_key(k == self._kb.Key.esc), **kw_k)
        for lst in (ms, kb):
            lst.daemon = True
            lst.start()
            self._listeners.append(lst)

    def close(self):
        for lst in self._listeners:
            try:
                lst.stop()
            except Exception:                                        # noqa: BLE001
                pass
        self._listeners = []


def foreground_process():
    """Nom (minuscules) du processus de la fenêtre au premier plan, '' si inconnu (non Windows)."""
    if sys.platform != "win32":
        return ""
    try:
        import ctypes
        import ctypes.wintypes as wt
        import psutil
        u = ctypes.windll.user32
        pid = wt.DWORD()
        u.GetWindowThreadProcessId(u.GetForegroundWindow(), ctypes.byref(pid))
        return psutil.Process(pid.value).name().lower()
    except Exception:                                                # noqa: BLE001
        return ""


class SmartAFK:
    def __init__(self, backend_factory=PynputBackend, rng=None):
        self._factory = backend_factory
        self._rng = rng or random.Random()
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._held = set()
        self._held_lock = threading.Lock()
        self._cfg = {}
        self._be = None
        self._thread = None
        self.state = "idle"
        self.reason = ""                      # pourquoi le dernier arrêt
        self.actions = 0
        self.started = 0.0
        self.next_at = 0.0
        self._last_input = 0.0
        self._ignore_until = 0.0
        self._last_pos = None
        self._moves = []                      # [(t, distance)] mouvements matériels récents

    # ---- API
    def start(self, cfg=None):
        cfg = cfg or nasko_core.load_config()
        with self._lock:
            if self.state != "idle":
                return self.status()
            be = self._factory()
            self._cfg, self._be = dict(cfg), be
            self._stop.clear()
            self.actions, self.reason, self.next_at = 0, "", 0.0
            self._last_input, self._last_pos, self._moves = time.monotonic(), None, []
            be.listen(self._on_move, self._on_click, self._on_scroll, self._on_key)
            self.state = "armed"
            self.started = time.time()
            self._thread = threading.Thread(target=self._run, daemon=True, name="smart-afk")
            self._thread.start()
        log.info("Smart AFK armé (attend %.0f s de calme)", float(_cfg(cfg, "afk_idle_s")))
        return self.status()

    def stop(self, reason="arrêt manuel"):
        """Désactivation immédiate (sûre depuis n'importe quel thread, y compris les écouteurs). Relâche toutes les touches simulées."""
        with self._lock:
            if self.state == "idle":
                return self.status()
            self.state, self.reason = "idle", reason
            self._stop.set()
            be, self._be = self._be, None
        self._release_all(be)
        if be is not None:
            threading.Thread(target=be.close, daemon=True).start()   # on ne ferme pas un écouteur depuis son propre thread
        log.info("Smart AFK désactivé : %s", reason)
        self._notify("Smart AFK désactivé", reason[:1].upper() + reason[1:] + " — tu as la main.")
        return self.status()

    def toggle(self, cfg=None):
        return self.stop() if self.state != "idle" else self.start(cfg)

    def status(self):
        now = time.time()
        return {"state": self.state, "active": self.state == "active", "armed": self.state == "armed", "reason": self.reason, "actions": self.actions,
                "next_in": round(max(0.0, self.next_at - now), 1) if self.state == "active" and self.next_at else None,
                "since": self.started if self.state != "idle" else None}

    # ---- écouteurs (thread du crochet : rester court)
    def _mine(self):
        return sys.platform != "win32" and time.monotonic() < self._ignore_until      # sous Windows le drapeau « injecté » suffit

    def _on_move(self, x, y):
        if self.state == "idle" or self._mine():
            return
        now = time.monotonic()
        last, self._last_pos = self._last_pos, (x, y)
        self._last_input = now
        if self.state != "active" or last is None:
            return
        self._moves = [m for m in self._moves if now - m[0] <= MOVE_WINDOW_S] + [(now, math.hypot(x - last[0], y - last[1]))]
        if sum(d for _t, d in self._moves) >= MOVE_PX:
            self.stop("tu as repris la souris")

    def _on_click(self):
        if self.state == "idle" or self._mine():
            return
        self._last_input = time.monotonic()
        if self.state == "active":
            self.stop("tu as cliqué")

    _on_scroll = _on_click

    def _on_key(self, is_esc):
        if self.state == "idle" or self._mine():
            return
        self._last_input = time.monotonic()
        if is_esc:
            self.stop("Échap")
        elif self.state == "active":
            self.stop("tu as repris le clavier")

    # ---- boucle principale
    def _run(self):
        cfg = self._cfg
        idle_s = float(_cfg(cfg, "afk_idle_s"))
        t_arm = time.monotonic()
        while not self._stop.wait(0.2):                              # armed : attendre que l'utilisateur lâche tout
            if time.monotonic() - self._last_input >= idle_s:
                break
            if time.monotonic() - t_arm > ARM_TIMEOUT_S:
                self.stop("aucun moment calme détecté (annulé)")
                return
        if self._stop.is_set():
            return
        with self._lock:
            if self.state != "armed":
                return
            self.state = "active"
            self._moves = []
        self._notify("Smart AFK actif", "Échap ou un mouvement de souris l'arrête instantanément.")
        t_start = time.monotonic()
        max_s = float(_cfg(cfg, "afk_max_minutes")) * 60
        while not self._stop.is_set():
            wait = self._rng.uniform(float(_cfg(cfg, "afk_min_s")), float(_cfg(cfg, "afk_max_s")))
            self.next_at = time.time() + wait
            if self._stop.wait(wait):
                return
            if max_s and time.monotonic() - t_start > max_s:
                self.stop("durée maximale atteinte")
                return
            if not self._window_ok():
                continue
            try:
                self.do_action()
            except Exception as e:                                   # noqa: BLE001 — une erreur d'entrée ne doit jamais laisser une touche enfoncée
                log.warning("Smart AFK : action échouée (%s)", e)
            finally:
                self._release_all(self._be)

    def _window_ok(self):
        want = _cfg(self._cfg, "afk_only_process")
        if not want:
            return True
        wants = {w.lower() for w in ([want] if isinstance(want, str) else want)}
        return foreground_process() in wants

    # ---- actions (chaque pas vérifie le kill-switch)
    def _sleep(self, secs):
        """Dort `secs` ; False si le kill-switch a été actionné entre-temps."""
        return not self._stop.wait(secs)

    def do_action(self):
        (self._nudge_camera if self._rng.random() < 0.5 else self._tap_keys)()
        if not self._stop.is_set():
            self.actions += 1

    def _inject(self, fn, *a):
        be = self._be
        if be is None or self._stop.is_set():
            return False
        self._ignore_until = time.monotonic() + 0.25
        fn(be, *a)
        self._ignore_until = time.monotonic() + 0.25
        return True

    def _nudge_camera(self):
        """Petit balayage (6-25 px, surtout horizontal) puis retour : la caméra bouge mais ne dérive pas."""
        r = self._rng
        dx, dy = r.choice((-1, 1)) * r.randint(6, 25), r.randint(-4, 4)
        steps = 6
        for sx, sy in ((dx / steps, dy / steps),) * steps + ((-dx / steps, -dy / steps),) * steps:
            if not self._inject(lambda be, a, b: be.move(a, b), sx, sy) or not self._sleep(0.02):
                return

    def _tap_keys(self):
        """Frappe légère (60-180 ms) d'une touche de déplacement, puis de la touche opposée : le personnage revient où il était."""
        r = self._rng
        keys = str(_cfg(self._cfg, "afk_keys")).lower() or "zqsd"
        k = r.choice(keys)
        for key in (k, OPPOSITE.get(k, k)):
            if not self._tap(key, r.uniform(0.06, 0.18)) or not self._sleep(r.uniform(0.1, 0.3)):
                return

    def _tap(self, key, hold):
        with self._held_lock:
            self._held.add(key)
        if not self._inject(lambda be, k: be.press(k), key):
            return False
        ok = self._sleep(hold)
        self._inject_release(key)
        return ok

    def _inject_release(self, key):
        be = self._be
        with self._held_lock:
            self._held.discard(key)
        if be is not None:
            self._ignore_until = time.monotonic() + 0.25
            try:
                be.release(key)
            except Exception:                                        # noqa: BLE001
                pass

    def _release_all(self, be):
        with self._held_lock:
            keys, self._held = list(self._held), set()
        for k in keys:
            try:
                if be is not None:
                    be.release(k)
            except Exception:                                        # noqa: BLE001
                pass

    def _notify(self, title, message):
        try:
            import nasko_notify
            nasko_notify.push(title, message, level="info", source="afk", speak=False)
        except Exception as e:                                       # noqa: BLE001
            log.info("Smart AFK : notification impossible (%s)", e)


afk = SmartAFK()
