import os
import random
import sys
import threading
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nasko_afk as na

FAST = {"afk_min_s": 0.05, "afk_max_s": 0.1, "afk_idle_s": 0.3, "afk_keys": "zqsd"}
QUIET = {**FAST, "afk_min_s": 30, "afk_max_s": 31}      # aucune injection pendant le test : seuls les événements simulés comptent


class FakeBackend:
    def __init__(self):
        self.log, self.down, self.cb, self.closed = [], set(), None, False

    def move(self, dx, dy):
        self.log.append(("move", dx, dy))

    def press(self, k):
        self.down.add(k)
        self.log.append(("press", k))

    def release(self, k):
        self.down.discard(k)
        self.log.append(("release", k))

    def listen(self, *cb):
        self.cb = cb

    def close(self):
        self.closed = True


@pytest.fixture
def afk():
    be = FakeBackend()
    a = na.SmartAFK(lambda: be, rng=random.Random(1))
    a._notify = lambda *x: None
    a.be = be
    yield a
    a.stop()


def wait(cond, t=3.0):
    end = time.time() + t
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    return False


def test_arms_then_activates_after_idle(afk):
    afk.start(FAST)
    assert afk.state == "armed"
    assert wait(lambda: afk.state == "active")
    assert wait(lambda: afk.actions >= 2)
    assert any(e[0] == "press" for e in afk.be.log) or any(e[0] == "move" for e in afk.be.log)


def test_input_while_armed_delays_activation_but_does_not_kill(afk):
    afk.start(FAST)
    for _ in range(8):
        afk.be.cb[3](False)                                           # touche pendant l'attente
        time.sleep(0.1)
    assert afk.state == "armed"
    assert wait(lambda: afk.state == "active")


def test_escape_cancels_when_armed(afk):
    afk.start(FAST)
    afk.be.cb[3](True)
    assert afk.state == "idle" and afk.reason == "Échap"


def test_escape_kills_when_active_and_releases_keys(afk):
    afk.start(FAST)
    assert wait(lambda: afk.state == "active")
    afk.be.cb[3](True)
    assert afk.state == "idle" and afk.reason == "Échap"
    assert not afk.be.down
    n = len(afk.be.log)
    time.sleep(0.4)
    assert len(afk.be.log) == n                                       # plus aucune injection après l'arrêt


def test_manual_mouse_move_kills(afk):
    afk.start(QUIET)
    assert wait(lambda: afk.state == "active")
    afk.be.cb[0](100, 100)                                            # première position : référence
    assert afk.state == "active"
    afk.be.cb[0](104, 100)                                            # 4 px : sous le seuil (vibration du capteur)
    assert afk.state == "active"
    afk.be.cb[0](112, 100)
    assert afk.state == "idle" and "souris" in afk.reason


def test_click_and_key_kill(afk):
    afk.start(QUIET)
    assert wait(lambda: afk.state == "active")
    afk.be.cb[1]()
    assert afk.state == "idle"
    afk.start(QUIET)
    assert wait(lambda: afk.state == "active")
    afk.be.cb[3](False)
    assert afk.state == "idle"


def test_own_events_are_ignored_off_windows(afk, monkeypatch):
    monkeypatch.setattr(na.sys, "platform", "linux")
    afk.start(FAST)
    assert wait(lambda: afk.state == "active")
    afk._ignore_until = time.monotonic() + 5                          # pendant une injection de notre part
    afk.be.cb[0](0, 0)
    afk.be.cb[0](500, 500)
    assert afk.state == "active"


def test_max_duration(afk):
    afk.start({**FAST, "afk_max_minutes": 0.02})
    assert wait(lambda: afk.state == "idle", 4)
    assert "maximale" in afk.reason


def test_actions_are_light(afk):
    afk.start(FAST)
    assert wait(lambda: afk.actions >= 8, 8)
    afk.stop()
    pressed = {e[1] for e in afk.be.log if e[0] == "press"}
    assert pressed <= set("zqsd")
    moves = [e for e in afk.be.log if e[0] == "move"]
    assert moves and max(abs(e[1]) for e in moves) <= 5
    for i in range(0, len(moves) - 11, 12):                           # chaque balayage revient à son point de départ
        assert abs(sum(m[1] for m in moves[i:i + 12])) < 1e-6
