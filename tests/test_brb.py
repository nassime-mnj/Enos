import os
import subprocess
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nasko_brb  # noqa: E402
import nasko_core  # noqa: E402


class BRB(unittest.TestCase):
    def setUp(self):
        self._cp = nasko_core.config_path
        nasko_core.config_path = lambda: os.path.join(tempfile.mkdtemp(), "c.json")
        nasko_brb.S.update(since=None, timer=None)
        self.said, self.com = [], []

    def tearDown(self):
        nasko_core.config_path = self._cp
        nasko_brb.back(lambda t: None, lambda t: None)

    def test_flow(self):
        t = [1000.0]
        clk = lambda: t[0]  # noqa: E731
        st = nasko_brb.start("Livreur !", 0, self.said.append, self.com.append, clk)
        self.assertTrue(st["active"])
        self.assertEqual(self.said, ["Livreur !"])
        t[0] += 185
        self.assertEqual(nasko_brb.status(clk)["elapsed"], 185)
        nasko_brb.start("autre", 0, self.said.append, self.com.append, clk)   # idempotent
        self.assertEqual(len(self.said), 1)
        r = nasko_brb.back(self.said.append, self.com.append, clk)
        self.assertEqual(r["elapsed"], 185)
        self.assertIn("3 min 5 s", self.com[-1])
        self.assertFalse(nasko_brb.status()["active"])

    def test_default_message_and_bounds(self):
        nasko_brb.start("", 9999, self.said.append, self.com.append)
        self.assertEqual(nasko_brb.status()["minutes"], 120)
        self.assertTrue(self.said[0])

    def test_no_input_simulation(self):
        src = open(nasko_brb.__file__, encoding="utf-8").read()
        for bad in ("SendInput", "keybd_event", "mouse_event", "pyautogui", "pynput", "SetCursorPos"):
            self.assertNotIn(bad, src)


if __name__ == "__main__":
    unittest.main()
