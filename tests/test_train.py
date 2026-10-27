"""Super Enos (nasko_train) : boucle d'entraînement, mémoire, leçons, LLM limité aux candidats de Stockfish. Moteur factice : aucun Stockfish requis.
Lancer : python tests/test_train.py"""
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
for _n in ("DETACHED_PROCESS", "CREATE_NEW_PROCESS_GROUP", "CREATE_NO_WINDOW"):
    if not hasattr(subprocess, _n):
        setattr(subprocess, _n, 0)
import chess  # noqa: E402
import chess.engine  # noqa: E402

import nasko_chess as C  # noqa: E402
import nasko_core  # noqa: E402
import nasko_train as T  # noqa: E402


class FakeEngine:
    """Évalue tout à 0 et propose les coups légaux dans l'ordre : de quoi faire tourner la boucle sans Stockfish."""
    options = {}

    def analyse(self, board, limit, multipv=None, root_moves=None, **kw):
        legal = list(root_moves or board.legal_moves)
        n = multipv or 1
        infos = [{"pv": [m], "score": chess.engine.PovScore(chess.engine.Cp(0), board.turn), "depth": 8, "multipv": i + 1} for i, m in enumerate(legal[:n])]
        return infos if multipv else infos[0]

    def play(self, board, limit, **kw):
        return chess.engine.PlayResult(next(iter(board.legal_moves)), None)

    def configure(self, o):
        pass

    def quit(self):
        pass


class Train(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._dd, self._oe, self._sp, self._rd = nasko_core.data_dir, C._open_engine, C.stockfish_path, T._llm_ready
        nasko_core.data_dir = lambda: self.tmp
        C._open_engine = lambda: (FakeEngine(), "fake")
        C.stockfish_path = lambda: "fake"
        T._llm_ready = lambda: False
        T.S.update(running=False, stop=False)

    def tearDown(self):
        T.stop(wait=True)
        nasko_core.data_dir, C._open_engine, C.stockfish_path, T._llm_ready = self._dd, self._oe, self._sp, self._rd
        shutil.rmtree(self.tmp, ignore_errors=True)

    def wait(self, secs=60):
        t = time.time()
        while T.S["running"] and time.time() - t < secs:
            time.sleep(0.1)
        self.assertFalse(T.S["running"], "l'entraînement ne s'est pas terminé")

    def test_three_profiles_two_colours(self):
        T.start(games=6, secs=0.2, llm=False)
        self.wait()
        st = T.status()
        self.assertEqual(st["error"], "")
        self.assertEqual(st["games_done"], 6)
        m = T.memory()
        self.assertEqual([m["profiles"][o]["g"] for o in T.OPPONENTS], [2, 2, 2])
        self.assertEqual({g["color"] for g in m["games"]}, {"w", "b"})
        self.assertEqual(len(m["lessons"]), 6)
        self.assertEqual(sum(sum(p[k] for k in "wdl") for p in m["profiles"].values()), 6)

    def test_stop(self):
        T.start(games=0, secs=0.2, llm=False)
        time.sleep(0.4)
        self.assertTrue(T.status()["running"])
        T.stop(wait=True)
        self.assertFalse(T.status()["running"])

    def test_already_running(self):
        T.start(games=0, secs=0.2, llm=False)
        with self.assertRaises(C.ChessError):
            T.start()

    def test_reset_refused_while_running(self):
        T.start(games=0, secs=0.2, llm=False)
        with self.assertRaises(C.ChessError):
            T.reset()

    def test_llm_only_picks_stockfish_candidates(self):
        asked = []

        def fake(system, user, max_tokens=140, clean=True):
            asked.append(user)
            if "leçon" in system:
                return "Je garde l'initiative."
            return '{"move": "Zz9", "why": "coup inventé"}' if len(asked) % 2 else '{"move": "%s", "why": "ok"}' % user.split("- ")[2].split(" ")[0]
        T._llm_ready, T._complete = (lambda: True), fake
        T.start(opponents=["enos"], games=1, secs=0.2, llm=True)
        self.wait()
        self.assertEqual(T.status()["error"], "")
        self.assertTrue(any("Candidats" in u for u in asked))
        self.assertIn("Je garde l'initiative.", [x["text"] for x in T.memory()["lessons"]])

    def test_llm_failures_disable_it(self):
        def boom(*a, **k):
            raise RuntimeError("quota")
        T._llm_ready, T._complete = (lambda: True), boom
        T.start(opponents=["enos"], games=1, secs=0.2, llm=True)
        self.wait()
        st = T.status()
        self.assertEqual(st["error"], "")
        self.assertFalse(st["llm"])
        self.assertIn("quota", st["llm_error"])
        self.assertEqual(len(T.memory()["lessons"]), 1)          # leçon de secours

    def test_autostart_flag(self):
        T.set_autostart(True)
        self.assertTrue(T.memory()["autostart"])
        T.reset()
        self.assertTrue(T.memory()["autostart"])                 # l'effacement de la mémoire garde le réglage


if __name__ == "__main__":
    unittest.main()
