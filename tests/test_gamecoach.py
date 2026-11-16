"""Copilote de jeu (nasko_gamecoach) : réglages, détection du jeu, écran inchangé = aucun appel, pas de répétition, alertes seulement, pause, question libre, lecture seule.
Sans réseau, sans écran, sans LLM. Lancer : python tests/test_gamecoach.py"""
import json
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from PIL import Image  # noqa: E402

import nasko_core  # noqa: E402
import nasko_gamecoach as G  # noqa: E402


def img(c):
    return Image.new("RGB", (1920, 1080), c)


def reply(advice, urgency=1, in_game=True, summary="combat au centre"):
    return json.dumps({"in_game": in_game, "summary": summary, "advice": advice, "urgency": urgency})


class Gc(unittest.TestCase):
    def setUp(self):
        self.store = {}
        self._l, self._u, self._p = nasko_core.load_config, nasko_core.update_config, G._procs
        nasko_core.load_config = lambda: dict(self.store)
        nasko_core.update_config = lambda patch: self.store.update(patch)
        G._procs = lambda: set()
        G.S.update(running=False, stop=False, paused=False, last_advice="", summary="", frames=0, calls=0, error="", waiting=False, t_advice=0.0, seen={}, history=[], latency=0.0)
        self.said, self.asks, self.systems = [], [], []

    def tearDown(self):
        nasko_core.load_config, nasko_core.update_config, G._procs = self._l, self._u, self._p

    def vision(self, *replies):
        it = iter(replies)

        def f(cfg, system, ask, jpeg, n):
            self.systems.append(system); self.asks.append(ask)
            return next(it)
        return f

    def say(self, t):
        self.said.append(t)
        return True

    def test_config_clamps_and_presets(self):
        G.set_config({"interval": 1, "game": "Valorant", "goal": "mieux placer", "mode": "voice", "focus": "window"})
        c = G.config()
        self.assertEqual((c["interval"], c["game"], c["mode"], c["focus"]), (3, "Valorant", "voice", "window"))
        G.set_config({"interval": 999, "mode": "zzz", "focus": "zzz"})
        c = G.config()
        self.assertEqual((c["interval"], c["mode"], c["focus"]), (120, "voice", "window"))
        self.assertEqual([G._preset(x) for x in ("League of Legends", "valorant", "Échecs", "CS2", "Elden Ring")], ["lol", "valorant", "echecs", "fps", "autre"])

    def test_prompt_knows_game_and_goal(self):
        G.set_config({"game": "Valorant", "goal": "mieux placer mes utilitaires"})
        p = G.system_prompt(G.config())
        self.assertIn("Valorant", p); self.assertIn("mieux placer mes utilitaires", p); self.assertIn("minimap", p); self.assertIn("tricher", p)

    def test_unchanged_screen_makes_no_call_and_no_repeat(self):
        v = self.vision(reply("Recule derrière le mur"), reply("Recule derrière le mur"), reply("Recule derrière le mur"))
        sig, ctx = G.step(None, grab_fn=lambda: img((10, 10, 10)), vision=v, say=self.say)
        self.assertEqual(ctx["advice"], "Recule derrière le mur"); self.assertEqual(self.said, ["Recule derrière le mur"])
        sig2, ctx2 = G.step(sig, grab_fn=lambda: img((10, 10, 10)), vision=v, say=self.say)
        self.assertIsNone(ctx2); self.assertEqual(G.S["calls"], 1)                      # écran identique : aucun appel
        G.step(sig, grab_fn=lambda: img((200, 40, 40)), vision=v, say=self.say)          # écran différent, même conseil : pas répété
        self.assertEqual(len(self.said), 1); self.assertEqual(G.S["calls"], 2)

    def test_previous_context_is_sent(self):
        v = self.vision(reply("Garde ton ulti", summary="équipe en retard"), reply("Reste groupé", summary="3 contre 3"))
        G.step(None, grab_fn=lambda: img((1, 1, 1)), vision=v, say=self.say)
        G.S["t_advice"] = 0
        G.step(None, grab_fn=lambda: img((90, 9, 9)), vision=v, say=self.say, force=True)
        self.assertIn("équipe en retard", self.asks[1]); self.assertIn("Garde ton ulti", self.asks[1])

    def test_gap_and_urgency(self):
        G.deliver({"in_game": True, "advice": "Un", "urgency": 1}, now=100, say=self.say)
        self.assertFalse(G.deliver({"in_game": True, "advice": "Deux", "urgency": 1}, now=103, say=self.say))   # < 8 s
        self.assertTrue(G.deliver({"in_game": True, "advice": "Trois", "urgency": 3}, now=104, say=self.say))   # urgence : passe
        self.assertTrue(G.deliver({"in_game": True, "advice": "Quatre", "urgency": 1}, now=120, say=self.say))
        self.assertFalse(G.deliver({"in_game": False, "advice": "Cinq", "urgency": 3}, now=200, say=self.say))  # pas dans le jeu
        self.assertEqual(self.said, ["Un", "Trois", "Quatre"])

    def test_alerts_only_pause_and_wait_for_game(self):
        G.set_config({"alerts_only": True})
        self.assertFalse(G.deliver({"in_game": True, "advice": "Remarque", "urgency": 1}, now=10, say=self.say))
        self.assertTrue(G.deliver({"in_game": True, "advice": "Danger derrière", "urgency": 2}, now=30, say=self.say))
        G.pause(True)
        _s, ctx = G.step(None, grab_fn=lambda: img((5, 5, 5)), vision=self.vision(), say=self.say)
        self.assertIsNone(ctx); self.assertEqual(G.S["frames"], 0)                      # en pause : aucune capture
        G.pause(False); G.set_config({"need_game": True, "process": "monjeu.exe"})
        called = []
        _s, ctx = G.step(None, grab_fn=lambda: called.append(1) or img((5, 5, 5)), vision=self.vision(), say=self.say)
        self.assertIsNone(ctx); self.assertEqual(called, []); self.assertTrue(G.S["waiting"])   # jeu absent : aucune capture
        G._procs = lambda: {"monjeu.exe"}
        self.assertTrue(G.game_running())

    def test_ask_returns_short_text(self):
        out = G.ask("Que dois-je acheter ?", grab_fn=lambda: img((3, 3, 3)), vision=self.vision("**Achète** une armure."))
        self.assertEqual(out, "Achète une armure.")

    def test_read_only_no_input_automation(self):
        src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "nasko_gamecoach.py"), encoding="utf-8").read()
        code = "\n".join(l for l in src.splitlines() if not l.strip().startswith(("#", '"""')))
        self.assertIsNone(re.search(r"^\s*(import|from)\s+(pyautogui|pynput|keyboard|mouse|win32api|win32con|pydirectinput)", code, re.M))
        self.assertNotRegex(code, r"SendInput|keybd_event|mouse_event|SetCursorPos|WriteProcessMemory|ReadProcessMemory")


if __name__ == "__main__":
    unittest.main()
