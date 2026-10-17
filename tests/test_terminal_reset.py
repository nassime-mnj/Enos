"""Purgeur de terminal du Dépôt Intranet : POST /api/depot/terminal/reset ferme les shells pty (jamais de processus orphelin) et refuse de purger quand aucun terminal ne pourrait redémarrer."""
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nasko_depot_term as T  # noqa: E402
import nasko_server as S  # noqa: E402
from test_depot_term import FakeBackend  # noqa: E402


class Reset(unittest.TestCase):
    def setUp(self):
        T.close_all()
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.realpath(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(T.close_all)
        p = mock.patch.object(T, "_find_shell", return_value="/bin/sh")     # pas de /bin/bash sous Windows : les sessions sont de toute façon factices (spawn injecté)
        p.start()
        self.addCleanup(p.stop)

    def open(self):
        fb = FakeBackend()
        s = T.open_session("local", root=self.root, spawn=lambda a, c, e, co, ro: fb)
        return s, fb

    def test_kills_every_live_session(self):
        (s1, b1), (s2, b2) = self.open(), self.open()
        self.assertEqual(len(T.list_sessions()), 2)
        with mock.patch.object(T, "backends", return_value={"wsl": True, "local": False}):
            r = S.depot_terminal_reset(S.DepotTermReset(repo=""))
        self.assertEqual(r, {"ok": True, "closed": 2})
        self.assertTrue(b1.killed and b2.killed)                 # arbre de processus tué, pas seulement la session retirée de la liste
        self.assertTrue(b1.closed and b2.closed)
        self.assertEqual(T.list_sessions(), [])

    def test_idempotent_without_session(self):
        with mock.patch.object(T, "backends", return_value={"wsl": False, "local": True}):
            self.assertEqual(S.depot_terminal_reset(S.DepotTermReset()), {"ok": True, "closed": 0})

    def test_refuses_when_no_terminal_could_restart(self):
        s, b = self.open()
        with mock.patch.object(T, "backends", return_value={"wsl": False, "local": False}):
            with self.assertRaises(S.HTTPException) as cm:
                S.depot_terminal_reset(S.DepotTermReset())
        self.assertEqual(cm.exception.status_code, 400)
        self.assertFalse(b.killed)                                # le shell actuel est conservé

    def test_bad_repo_name_rejected(self):
        with mock.patch.object(T, "backends", return_value={"wsl": True, "local": False}):
            for bad in ("../x", "a b", "a;b", "a/b", "$(x)"):
                with self.assertRaises(S.HTTPException, msg=bad):
                    S.depot_terminal_reset(S.DepotTermReset(repo=bad))

    def test_new_session_possible_afterwards(self):
        self.open()
        with mock.patch.object(T, "backends", return_value={"wsl": True, "local": False}):
            S.depot_terminal_reset(S.DepotTermReset())
        s, b = self.open()                                        # = ce que fait la reconnexion du WebSocket
        self.assertTrue(s.alive())
        self.assertFalse(b.killed)


if __name__ == "__main__":
    unittest.main()
