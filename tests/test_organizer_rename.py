"""Renommage par modèle de l'Organisateur. Lancer : python tests/test_organizer_rename.py"""
import os
import shutil
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nasko_organizer as O  # noqa: E402


class Rename(unittest.TestCase):
    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp())
        self._root = O._root_of
        O._root_of = lambda p: (self.tmp, O._real(self.tmp)) if O._real(p).startswith(O._real(self.tmp)) else None
        O._UNDO.clear()

    def tearDown(self):
        O._root_of = self._root
        shutil.rmtree(self.tmp, ignore_errors=True)

    def mk(self, *names, delay=0):
        out = []
        for n in names:
            p = os.path.join(self.tmp, n)
            open(p, "w").write(n)
            out.append(p)
            if delay:
                time.sleep(delay)
        return out

    def names(self):
        return sorted(os.listdir(self.tmp))

    def test_pattern_numbering_and_extension(self):
        ps = self.mk("IMG_0001.jpg", "IMG_0002.jpg", "notes.txt")
        r = O.rename_batch(ps, {"pattern": "Facture_{parent}_{n}", "start": 1, "pad": 3})
        self.assertEqual(len(r["done"]), 3)
        parent = os.path.basename(self.tmp)
        self.assertEqual(self.names(), [f"Facture_{parent}_001.jpg", f"Facture_{parent}_002.jpg", f"Facture_{parent}_003.txt"])

    def test_find_replace_case_spaces_accents(self):
        ps = self.mk("Mon Résumé FINAL.PDF")
        plan = O.rename_plan(ps, {"find": "FINAL", "replace": "v2", "case": "lower", "spaces": "underscore", "accents": True})
        self.assertEqual(plan[0]["new"], "mon_resume_v2.pdf")
        plan = O.rename_plan(ps, {"find": r"\s+(\w+)$", "replace": r"-\1", "regex": True, "keep_ext": True})
        self.assertEqual(plan[0]["new"], "Mon Résumé-FINAL.PDF")
        self.assertEqual(O.rename_plan(ps, {"case": "title"})[0]["new"], "Mon Résumé Final.PDF")
        with self.assertRaises(O.OrgError):
            O.rename_plan(ps, {"find": "(", "regex": True})

    def test_date_token_and_order(self):
        ps = self.mk("b.txt", "a.txt", "c.txt", delay=0.02)
        plan = O.rename_plan(ps, {"pattern": "{n}_{name}", "order": "name"})
        self.assertEqual([(x["old"], x["new"]) for x in plan], [("a.txt", "1_a.txt"), ("b.txt", "2_b.txt"), ("c.txt", "3_c.txt")])
        plan = O.rename_plan(ps, {"pattern": "{date}_{name}"})
        self.assertRegex(plan[0]["new"], r"^\d{4}-\d{2}-\d{2}_b\.txt$")

    def test_conflicts_are_reported_and_skipped(self):
        ps = self.mk("a.txt", "b.txt", "c.txt")
        plan = O.rename_plan(ps[:2], {"pattern": "same"})
        self.assertEqual([x["error"] != "" for x in plan], [False, True])             # doublon dans le lot
        plan = O.rename_plan(ps[:1], {"pattern": "c"})
        self.assertIn("existe déjà", plan[0]["error"])                                # collision avec un élément hors lot
        r = O.rename_batch(ps[:2], {"pattern": "same"})
        self.assertEqual((len(r["done"]), len(r["fails"])), (1, 1))
        self.assertEqual(self.names(), ["b.txt", "c.txt", "same.txt"])
        bad = O.rename_plan(ps[2:], {"pattern": "a:b"})
        self.assertIn("Caractères interdits", bad[0]["error"])

    def test_swap_cycle_and_undo(self):
        a, b = self.mk("a.txt", "b.txt")
        open(a, "w").write("AAA")
        open(b, "w").write("BBB")
        plan = O.rename_plan([a, b], {"find": "a", "replace": "TMP"})           # sanity : plan lisible
        self.assertEqual(plan[0]["new"], "TMP.txt")
        # échange a <-> b via deux lots successifs impossible ; on teste un vrai cycle avec une pile
        c = self.mk("c.txt")[0]
        r = O.rename_batch([a, b, c], {"pattern": "{n}", "start": 2, "order": "selection"})        # 2.txt 3.txt 4.txt
        self.assertEqual(self.names(), ["2.txt", "3.txt", "4.txt"])
        r = O.rename_batch([os.path.join(self.tmp, "2.txt"), os.path.join(self.tmp, "3.txt"), os.path.join(self.tmp, "4.txt")], {"pattern": "{n}", "start": 3})    # 3 4 5 : chevauchement
        self.assertEqual(self.names(), ["3.txt", "4.txt", "5.txt"])
        self.assertEqual(open(os.path.join(self.tmp, "3.txt")).read(), "AAA")                      # le contenu a suivi le fichier
        O.undo()
        self.assertEqual(self.names(), ["2.txt", "3.txt", "4.txt"])
        self.assertEqual(open(os.path.join(self.tmp, "2.txt")).read(), "AAA")
        O.undo()
        self.assertEqual(self.names(), ["a.txt", "b.txt", "c.txt"])
        self.assertEqual(open(os.path.join(self.tmp, "b.txt")).read(), "BBB")

    def test_folders_and_outside_root(self):
        d = os.path.join(self.tmp, "Dossier 1")
        os.mkdir(d)
        self.assertEqual(O.rename_plan([d], {"spaces": "dash"})[0]["new"], "Dossier-1")
        with self.assertRaises(O.OrgError):
            O.rename_plan([os.path.join(os.path.dirname(self.tmp), "autre.txt")], {})
        with self.assertRaises(O.OrgError):
            O.rename_plan([], {})
        self.assertEqual(O.rename_batch([d], {})["done"], [])                                       # rien à changer : pas d'entrée d'annulation
        self.assertEqual(O._UNDO, [])


if __name__ == "__main__":
    unittest.main()
