"""Assistant LoL (nasko_lol) : lecture seule, détection de la partie, conseils sans répétition, mode texte/voix. Sans réseau, sans écran, sans LLM.
Lancer : python tests/test_lol.py"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from PIL import Image  # noqa: E402

import nasko_core  # noqa: E402
import nasko_lol as L  # noqa: E402


def img(c):
    return Image.new("RGB", (1920, 1080), c)


GAME = json.dumps({"in_game": True, "phase": "laning", "minimap": "bas-gauche", "gold": 1450, "items": ["Épée longue"], "can_buy": True, "hp_low": False, "advice": "Achète ton item maintenant", "urgency": 1})


class Lol(unittest.TestCase):
    def setUp(self):
        self.store = {}
        self._l, self._u, self._g = nasko_core.load_config, nasko_core.update_config, L.game_running
        nasko_core.load_config = lambda: dict(self.store)
        nasko_core.update_config = lambda d: self.store.update(d)
        L.game_running = lambda: True
        L.S.update(running=False, stop=False, last_advice="", last_ctx={}, frames=0, calls=0, error="", waiting=False, t_advice=0.0, seen={})
        self.said = []
        self.say = lambda t: (self.said.append(t), True)[1]

    def tearDown(self):
        nasko_core.load_config, nasko_core.update_config, L.game_running = self._l, self._u, self._g

    def run_step(self, color, vision, prev=None, force=False):
        return L.step(prev, grab_fn=lambda: img(color), vision=vision, say=lambda t: (self.said.append(t), True)[1], force=force)

    def test_advice_reaches_the_eye_and_extracts_context(self):
        sig, ctx = self.run_step((10, 10, 10), lambda *a: "Voici : " + GAME)
        self.assertEqual(self.said, ["Achète ton item maintenant"])
        self.assertEqual((ctx["gold"], ctx["can_buy"], ctx["phase"]), (1450, True, "laning"))
        self.assertEqual(L.status()["context"]["minimap"], "bas-gauche")

    def test_unchanged_screen_costs_no_llm_call(self):
        calls = []
        v = lambda *a: (calls.append(1), GAME)[1]
        sig, _ = self.run_step((10, 10, 10), v)
        self.run_step((10, 10, 10), v, prev=sig)                     # même image : aucun appel
        self.assertEqual(len(calls), 1)
        self.run_step((200, 40, 40), v, prev=sig)                    # écran différent : nouvel appel
        self.assertEqual(len(calls), 2)

    def test_no_repeat_and_rate_limit(self):
        ctx = {"in_game": True, "advice": "Pose une balise", "urgency": 1}
        self.assertTrue(L.deliver(ctx, now=1000, say=self.say))
        self.assertFalse(L.deliver(ctx, now=1010, say=self.say))                          # même conseil : refusé
        self.assertFalse(L.deliver({**ctx, "advice": "Autre conseil"}, now=1010, say=self.say))   # < 25 s : refusé
        self.assertTrue(L.deliver({**ctx, "advice": "Danger en haut", "urgency": 3}, now=1011, say=self.say))   # urgence maximale : passe
        self.assertTrue(L.deliver({**ctx, "advice": "Autre conseil"}, now=1100, say=self.say))
        self.assertEqual(self.said, ["Pose une balise", "Danger en haut", "Autre conseil"])
        self.assertFalse(L.deliver({"in_game": False, "advice": "x"}, now=5000, say=self.say))      # pas en partie : rien

    def test_nothing_captured_until_the_game_runs(self):
        L.game_running = lambda: False
        grabbed = []
        L.step(None, grab_fn=lambda: (grabbed.append(1), img((1, 1, 1)))[1], vision=lambda *a: GAME, say=self.say)
        self.assertEqual((grabbed, self.said), ([], []))                                          # vie privée : aucune capture hors partie
        self.assertTrue(L.status()["waiting"])

    def test_mode_drives_the_eye_options_and_is_read_only(self):
        import nasko_pet
        seen = []
        o = nasko_pet.set_options
        nasko_pet.set_options = lambda d: seen.append(d)
        try:
            L.set_config({"mode": "text"})
            L.set_config({"mode": "voice"})
        finally:
            nasko_pet.set_options = o
        self.assertEqual(seen, [{"pet_voice": False, "pet_bubble": True}, {"pet_voice": True, "pet_bubble": True}])
        src = open(L.__file__, encoding="utf-8").read()
        for banned in ("pyautogui", "keyboard", "mouse", "SendInput", "ReadProcessMemory", "pymem", "WriteProcessMemory", "ctypes"):
            self.assertNotIn(banned, src.replace("# ", ""), banned)                              # lecture seule : aucune API d'entrée ni de mémoire
        self.assertTrue(L.status()["read_only"])

    def test_bad_vision_answer_is_harmless(self):
        _, ctx = self.run_step((9, 9, 9), lambda *a: "désolé, je ne vois rien", force=True)
        self.assertFalse(ctx["in_game"])
        self.assertEqual(self.said, [])


if __name__ == "__main__":
    unittest.main()
