"""Tests du module Agenda (durée modifiable pour le redimensionnement de la timeline). Lancer : python tests/test_agenda.py"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import nasko_core  # noqa: E402
import nasko_agenda as A  # noqa: E402


class AgendaTasks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._d = nasko_core.data_dir
        nasko_core.data_dir = lambda: self.tmp

    def tearDown(self):
        nasko_core.data_dir = self._d

    def test_duration_update_is_bounded_and_kept_with_due(self):
        t = A.add_task("Rapport", "2026-10-20T10:00")
        self.assertEqual(A.update_task(t["id"], duration_min=90)["duration_min"], 90)
        self.assertEqual(A.update_task(t["id"], duration_min=99999)["duration_min"], 1440)
        self.assertEqual(A.update_task(t["id"], duration_min=-5)["duration_min"], 0)
        u = A.update_task(t["id"], due="2026-10-21T14:15", duration_min=45)
        self.assertEqual((u["due"], u["duration_min"]), ("2026-10-21T14:15", 45))
        it = A._task_item(u)
        self.assertEqual((it["start"], it["end"]), ("2026-10-21T14:15", "2026-10-21T15:00"))

    def test_update_without_duration_leaves_it_alone(self):
        t = A.add_task("X", "2026-10-20T10:00", duration_min=30)
        self.assertEqual(A.update_task(t["id"], done=True)["duration_min"], 30)


if __name__ == "__main__":
    unittest.main(verbosity=1)
