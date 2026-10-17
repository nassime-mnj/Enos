"""Tests des éditions physiquement isolées (release_editions + plafond de profil de nasko_roles). Lancer : python tests/test_editions.py"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, ROOT)
import nasko_core  # noqa: E402
import nasko_roles as R  # noqa: E402
import release_editions as E  # noqa: E402
import build_release as B  # noqa: E402


def stage_for(edition):
    d = tempfile.mkdtemp(prefix=f"stage_{edition}_")
    B.STAGE = B.Path(d) / "stage"
    B.REL = B.Path(d)
    B.make_stage("9.9.9", edition)
    return str(B.STAGE)


class Isolation(unittest.TestCase):
    def test_friends_build_has_no_trace_of_restricted_code(self):
        s = stage_for("friends")
        self.assertEqual(E.verify(s, "friends"), [])
        for cap in E.EXCLUDED_CAPS["friends"]:
            for mod in E.PY_MODULES.get(cap, []):
                src = open(os.path.join(s, mod + ".py"), encoding="utf-8").read()
                self.assertIn(E.MARK, src)
                self.assertLess(len(src), 1500, mod)                       # coquille, pas le vrai code
        for gone in ("static/cleaner.js", "static/env.js", "static/f6.js", "static/sync.js", "static/apimon.js", "static/tabs.js", "static/compress.js", "godot_chess", "openings"):
            self.assertFalse(os.path.exists(os.path.join(s, gone)), gone)
        for kept in ("static/agenda.js", "static/pdfed.js", "static/studio.js", "static/quick.js", "static/syllabus.js", "static/roles.js", "nasko_agenda.py", "nasko_pdf.py", "nasko_studio.py"):
            self.assertTrue(os.path.exists(os.path.join(s, kept)), kept)
        html = open(os.path.join(s, "static", "index.html"), encoding="utf-8").read()
        for gone in ("cleaner.js", "env.js", "f6.js", "apimon.js", "youtube.js"):
            self.assertNotIn("/static/" + gone, html)
        self.assertEqual(json.loads(open(os.path.join(s, "enos_edition.json")).read()), {"edition": "friends"})
        self.assertFalse(os.path.exists(os.path.join(s, "release_editions.py")) or os.path.exists(os.path.join(s, "build_release.py")))

    def test_dev_build_drops_only_receipts_and_apimon(self):
        s = stage_for("dev")
        self.assertEqual(E.verify(s, "dev"), [])
        self.assertFalse(os.path.exists(os.path.join(s, "static", "apimon.js")))
        self.assertIn(E.MARK, open(os.path.join(s, "nasko_receipts.py"), encoding="utf-8").read())
        self.assertIn(E.MARK, open(os.path.join(s, "nasko_apimon.py"), encoding="utf-8").read())
        for kept in ("static/cleaner.js", "static/env.js", "static/f6.js", "static/quick.js", "godot_chess", "nasko_git.py", "nasko_cleaner.py"):
            self.assertTrue(os.path.exists(os.path.join(s, kept)), kept)
        self.assertNotIn(E.MARK, open(os.path.join(s, "nasko_git.py"), encoding="utf-8").read())

    def test_ceo_build_is_complete(self):
        s = stage_for("ceo")
        self.assertEqual(E.verify(s, "ceo"), [])
        for kept in ("static/apimon.js", "nasko_apimon.py", "nasko_receipts.py", "static/cleaner.js", "godot_chess"):
            self.assertTrue(os.path.exists(os.path.join(s, kept)), kept)
        self.assertNotIn(E.MARK, open(os.path.join(s, "nasko_apimon.py"), encoding="utf-8").read())

    def test_friends_gets_the_depot_but_not_the_rest_of_devtools(self):
        s = stage_for("friends")
        self.assertEqual(E.verify(s, "friends"), [])
        for kept in ("nasko_depot.py", "nasko_depot_git.py", "nasko_depot_term.py", "nasko_devmanager.py", "nasko_wsl.py", "static/depot.js", "static/devmanager.js",
                     "static/vendor/monaco", "static/vendor/xterm", "static/assets/epita.clang-format"):
            self.assertTrue(os.path.exists(os.path.join(s, kept)), kept)
        for mod in E.PY_MODULES["depot"]:
            self.assertNotIn(E.MARK, open(os.path.join(s, mod + ".py"), encoding="utf-8").read(), mod)       # vrai code, pas une coquille
        for mod in E.PY_MODULES["devtools"]:                                                             # le reste de devtools reste exclu
            self.assertIn(E.MARK, open(os.path.join(s, mod + ".py"), encoding="utf-8").read(), mod)
        self.assertNotIn("depot", E.EXCLUDED_CAPS["friends"])
        self.assertIn("devtools", E.EXCLUDED_CAPS["friends"])

    def test_owner_home_is_neutralised_outside_the_ceo_edition(self):
        for ed in ("friends", "dev"):
            s = stage_for(ed)
            self.assertEqual(E.verify(s, ed), [])
            for mod in E.PY_MODULES["depot"]:
                src = open(os.path.join(s, mod + ".py"), encoding="utf-8").read()
                self.assertIsNone(E.OWNER_HOME.search(src), f"{ed}/{mod}")
            wsl = open(os.path.join(s, "nasko_wsl.py"), encoding="utf-8").read()
            self.assertIn("home\\\\utilisateur", wsl)
        ceo = open(os.path.join(stage_for("ceo"), "nasko_wsl.py"), encoding="utf-8").read()
        self.assertIn("home\\\\nasko", ceo)                                                              # le CEO garde son dossier par défaut

    def test_verify_detects_owner_home_leak(self):
        s = stage_for("friends")
        p = os.path.join(s, "nasko_wsl.py")
        open(p, "a", encoding="utf-8").write('\nX = "/home/nasko/ex00"\n')
        self.assertTrue(any("home/nasko" in b for b in E.verify(s, "friends")))

    def test_unknown_edition_is_refused(self):
        with self.assertRaises(ValueError):
            E.excluded_caps("admin")

    def test_verify_detects_a_leak(self):
        s = stage_for("friends")
        shutil.copy(os.path.join(ROOT, "nasko_env.py"), os.path.join(s, "nasko_env.py"))
        os.makedirs(os.path.join(s, "godot_chess"), exist_ok=True)
        bad = E.verify(s, "friends")
        self.assertTrue(any("nasko_env" in b for b in bad) and any("godot_chess" in b for b in bad), bad)

    def test_friends_build_still_imports_and_keeps_working_modules(self):
        """Tous les modules importables sur ce système doivent l'être aussi dans le build Friends (les coquilles ne cassent aucun import)."""
        s = stage_for("friends")
        mods = sorted(f[:-3] for f in os.listdir(s) if f.endswith(".py") and f.startswith(("nasko_", "opening")) and f != "nasko_server.py")
        code = "import importlib,sys\nbad=[]\nfor m in sys.argv[1:]:\n    try: importlib.import_module(m)\n    except Exception as e: bad.append((m, type(e).__name__, str(e)[:80]))\nprint(repr(bad))"
        base = subprocess.run([sys.executable, "-I", "-c", code, *mods], cwd=ROOT, capture_output=True, text=True, env={**os.environ, "PYTHONPATH": ROOT, "ENOS_NO_TRAY": "1"}, timeout=120)
        new = subprocess.run([sys.executable, "-I", "-c", code, *mods], cwd=s, capture_output=True, text=True, env={**os.environ, "PYTHONPATH": s, "ENOS_NO_TRAY": "1"}, timeout=120)
        b0, b1 = eval(base.stdout.strip() or "[]"), eval(new.stdout.strip() or "[]")
        self.assertEqual({m for m, *_ in b1} - {m for m, *_ in b0}, set(), f"imports cassés par l'isolation : {b1}")

    def test_stub_behaves_as_null_object(self):
        ns = {}
        exec(E.STUB.format(edition="friends", mark=E.MARK), ns)
        m = type(sys)("x"); m.__dict__.update(ns)
        self.assertFalse(m.anything)
        self.assertEqual(list(m.some.deep.call(1, k=2)), [])
        self.assertEqual(os.fspath(m.UP), "/enos-module-absent")
        self.assertEqual(len(m.x), 0)
        with m.lock:
            pass


class Ceiling(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._d, self._r = nasko_core.data_dir, nasko_core.resource_path
        nasko_core.data_dir = lambda: self.tmp
        nasko_core.resource_path = lambda *p: os.path.join(self.tmp, "res", *p)
        os.makedirs(os.path.join(self.tmp, "res"))
        R._cache.update(mtime=None, path=None, data=None)
        R._ED.update(mtime=None, path=None, val="ceo")

    def tearDown(self):
        nasko_core.data_dir, nasko_core.resource_path = self._d, self._r

    def edition(self, name):
        open(os.path.join(self.tmp, "res", "enos_edition.json"), "w").write(json.dumps({"edition": name}))
        R._ED.update(mtime=None)

    def test_no_file_means_work_tree_everything_available(self):
        self.assertEqual(R.edition(), "ceo")
        self.assertEqual(R.available_roles(), ("ceo", "dev", "friends"))

    def test_friends_edition_cannot_become_dev_or_ceo(self):
        R.select("ceo", new_pin="abcd")                                   # profil CEO enregistré (ex. role.json copié d'un autre PC)
        self.edition("friends")
        self.assertEqual(R.available_roles(), ("friends",))
        self.assertEqual((R.current(), R.effective()), ("friends", "friends"))
        self.assertFalse(R.allowed(R.effective(), "/api/receipts/job")[0] or R.allowed(R.effective(), "/api/cleaner/scan")[0])
        for r in ("ceo", "dev"):
            with self.assertRaises(R.RoleError):
                R.select(r, new_pin="abcd")
        info = R.info()
        self.assertEqual([x["id"] for x in info["roles"]], ["friends"])
        self.assertFalse(info["needs_setup"])
        self.assertEqual(info["edition"], "friends")

    def test_dev_edition_is_capped_at_dev(self):
        R.select("ceo", new_pin="abcd")
        self.edition("dev")
        self.assertEqual(R.available_roles(), ("dev", "friends"))
        self.assertEqual(R.current(), "dev")                              # CEO enregistré -> ramené au plafond
        with self.assertRaises(R.RoleError):
            R.select("ceo", pin="abcd")
        R.select("friends")
        self.assertEqual(R.current(), "friends")
        self.assertEqual([x["id"] for x in R.info()["roles"]], ["dev", "friends"])

    def test_corrupted_edition_file_falls_back_to_most_restrictive(self):
        open(os.path.join(self.tmp, "res", "enos_edition.json"), "w").write("pas du json")
        R._ED.update(mtime=None)
        self.assertEqual(R.edition(), "friends")
        open(os.path.join(self.tmp, "res", "enos_edition.json"), "w").write(json.dumps({"edition": "root"}))
        R._ED.update(mtime=None)
        self.assertEqual(R.edition(), "friends")


if __name__ == "__main__":
    unittest.main(verbosity=1)
