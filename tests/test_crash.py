"""Journal de plantages PC (nasko_crash) : écriture, rotation, exceptions de threads, journalisation ERROR, témoin d'arrêt anormal, limite de débit des pages.
Lancer : python tests/test_crash.py"""
import logging
import os
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nasko_crash as C  # noqa: E402


class Crash(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        C._state.update(dir=self.d, installed=False, rate=[0.0, 0])

    def test_add_read_clear(self):
        self.assertTrue(C.add("PYTHON", "boum"))
        self.assertIn("PYTHON · boum", C.text())
        self.assertEqual(C.count(), 1)
        C.clear()
        self.assertEqual(C.text().strip(), "")

    def test_rotation_keeps_recent_half(self):
        for i in range(700):
            C.add("JS", f"ligne {i} " + "x" * 1000)
        self.assertLess(os.path.getsize(os.path.join(self.d, "crash.log")), C.MAX_BYTES + 3000)
        self.assertIn("ligne 699", C.text())
        self.assertNotIn("ligne 0 ", C.text())

    def test_web_rate_limit(self):
        ok = [C.add_web("JS", f"e{i}") for i in range(60)]
        self.assertEqual(sum(ok), 40)

    def test_unclean_exit_marker_and_hooks(self):
        open(os.path.join(self.d, "session.run"), "w").write("2026-01-01 10:00:00")
        old = (sys.excepthook, threading.excepthook, sys.unraisablehook, list(logging.getLogger().handlers))
        try:
            C.install()
            self.assertIn("ARRÊT · session précédente interrompue", C.text())
            t = threading.Thread(target=lambda: 1 / 0, name="tester")
            t.start(); t.join()
            self.assertIn("THREAD · exception dans le thread « tester »", C.text())
            self.assertIn("ZeroDivisionError", C.text())
            logging.getLogger("nasko.x").error("échec simulé", exc_info=False)
            self.assertIn("ERREUR · nasko.x : échec simulé", C.text())
        finally:
            sys.excepthook, threading.excepthook, sys.unraisablehook = old[:3]
            logging.getLogger().handlers[:] = old[3]
            import faulthandler
            faulthandler.disable()
            if C._state["native"]:
                C._state["native"].close()


if __name__ == "__main__":
    unittest.main()
