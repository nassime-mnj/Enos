"""Projets CinePulse enregistrés côté serveur (CinePulse/backend/project_store.py + routes /api/projects) et intégration (le serveur sert directement le NLE).
Lancer : python tests/test_cinepulse_projects.py"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "CinePulse", "backend"))
import project_store as P  # noqa: E402


def project(n=2, **extra):
    p = {"version": 1, "fps": 30, "tracks": [{"id": "V2", "type": "video"}, {"id": "V1", "type": "video"}, {"id": "A1", "type": "audio"}],
         "clips": [{"id": f"c{i}", "asset": "abcdef0123", "kind": "image", "name": f"img{i}.png", "track": "V1", "start": i * 5, "dur": 5, "in": 0, "opacity": 1, "volume": 1,
                    "scale": 1, "x": 0, "y": 0, "fadeIn": 0, "fadeOut": 0} for i in range(n)]}
    p.update(extra)
    return p


class Store(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.s = P.ProjectStore(self.tmp)

    def tearDown(self):
        self.s.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_create_list_get(self):
        m = self.s.create("  Mon film  ", project(3))
        self.assertEqual((m["name"], m["rev"], m["clips"], m["duration"]), ("Mon film", 1, 3, 15.0))
        self.assertRegex(m["id"], r"^[0-9a-f]{12}$")
        got = self.s.get(m["id"])
        self.assertEqual(len(got["project"]["clips"]), 3)
        self.assertEqual(got["project"]["clips"][1]["start"], 5)
        time.sleep(0.01)
        m2 = self.s.create(None, project(0))
        self.assertEqual(m2["name"], P.DEFAULT_NAME)
        self.assertEqual([x["id"] for x in self.s.list()], [m2["id"], m["id"]], "le plus récent d'abord")
        self.assertNotIn("project", self.s.list()[0], "la liste ne transporte pas le contenu")

    def test_save_rename_and_revision(self):
        m = self.s.create("A", project(1))
        m2 = self.s.save(m["id"], project=project(4), rev=1)
        self.assertEqual((m2["rev"], m2["clips"], m2["name"]), (2, 4, "A"))
        m3 = self.s.save(m["id"], name="B")
        self.assertEqual((m3["rev"], m3["name"], m3["clips"]), (3, "B", 4), "renommer garde le contenu")
        self.assertIsNone(self.s.save("0123456789ab", name="X"))
        self.assertIsNone(self.s.save("../../etc", name="X"))

    def test_conflict_between_devices(self):
        m = self.s.create("A", project(1))
        self.s.save(m["id"], project=project(2), rev=1)                                              # l'appareil 2 enregistre
        with self.assertRaises(P.Conflict) as cm:                                                    # l'appareil 1 (rev 1) ne peut pas écraser
            self.s.save(m["id"], project=project(3), rev=1)
        self.assertEqual(cm.exception.current["rev"], 2)
        self.assertEqual(self.s.get(m["id"])["clips"], 2, "rien n'a été écrasé")
        forced = self.s.save(m["id"], project=project(3), rev=None)                                  # choix explicite : écraser
        self.assertEqual((forced["rev"], forced["clips"]), (3, 3))

    def test_create_is_replayable_with_client_id(self):
        m = self.s.create("A", project(1), pid="0123456789ab")
        again = self.s.create("A", project(1), pid="0123456789ab")
        self.assertEqual((m["id"], again["id"], len(self.s.list())), ("0123456789ab", "0123456789ab", 1), "un renvoi ne crée pas de doublon")
        for bad in ("../../x", "ABCDEFGHIJKL", "123", 5):
            with self.assertRaises(P.ProjectError):
                self.s.create("A", project(1), pid=bad)

    def test_delete(self):
        m = self.s.create("A", project())
        self.assertTrue(self.s.delete(m["id"]))
        self.assertFalse(self.s.delete(m["id"]))
        self.assertIsNone(self.s.get(m["id"]))
        self.assertEqual(self.s.list(), [])

    def test_persists_across_restart(self):
        m = self.s.create("Durable", project(2))
        self.s.close()
        self.s = P.ProjectStore(self.tmp)
        self.assertEqual(self.s.get(m["id"])["name"], "Durable")
        self.assertEqual(len(self.s.get(m["id"])["project"]["clips"]), 2)

    def test_name_rules(self):
        self.assertEqual(P.clean_name("x" * 200), "x" * 80)
        self.assertEqual(P.clean_name("a\x00b\nc"), "a b c")
        self.assertEqual(P.clean_name("   "), P.DEFAULT_NAME)
        with self.assertRaises(P.ProjectError):
            P.clean_name(12)

    def test_validation(self):
        bad = [None, [], {"version": 2, "tracks": [{"id": "V1", "type": "video"}], "clips": []}, project(1, tracks=[]), project(1, tracks=[{"id": "V1", "type": "weird"}]),
               project(1, tracks=[{"id": "V1", "type": "video"}, {"id": "V1", "type": "video"}]), project(1, clips="x"), project(1, fps=float("nan"))]
        for b in bad:
            with self.assertRaises(P.ProjectError, msg=str(b)[:50]):
                P.clean_project(b)
        for mut in ({"track": "ZZ"}, {"kind": "document"}, {"start": float("nan")}, {"dur": "5"}, {"opacity": True}, {"asset": ""}, {"kf": {"opacity": "x"}}, {"kf": {"bogus": []}},
                    {"kf": {"x": [{"t": 1}]}}):
            p = project(1)
            p["clips"][0].update(mut)
            with self.assertRaises(P.ProjectError, msg=str(mut)):
                P.clean_project(p)
        p = project(1)
        del p["clips"][0]["asset"]
        with self.assertRaises(P.ProjectError):
            P.clean_project(p)
        with self.assertRaises(P.ProjectError):
            P.clean_project(project(P.MAX_CLIPS + 1))

    def test_cleaning_keeps_only_known_fields(self):
        p = project(1)
        p["clips"][0].update({"evil": "<script>", "__proto__": {"x": 1}, "kf": {"x": [{"t": 1, "v": 0.5, "junk": 1}]}, "trIn": {"type": "crossfade", "dur": 9999, "junk": 1}})
        p["extra"] = "ignored"
        clean, n, dur = P.clean_project(p)
        c = clean["clips"][0]
        self.assertNotIn("evil", c)
        self.assertNotIn("extra", clean)
        self.assertEqual(c["kf"]["x"], [{"t": 1.0, "v": 0.5}])
        self.assertEqual(c["trIn"], {"type": "crossfade", "dur": 30.0})
        self.assertEqual((n, dur), (1, 5.0))

    def test_json_roundtrip_equals_frontend_model(self):
        p = project(2)
        p["clips"][0].update(kf={"scale": [{"t": 0, "v": 1}, {"t": 2, "v": 2}]}, trIn={"type": "crossfade", "dur": 1})
        m = self.s.create("RT", p)
        self.assertEqual(self.s.get(m["id"])["project"], P.clean_project(p)[0])
        self.assertEqual(self.s.get(m["id"])["project"]["clips"][0]["kf"], p["clips"][0]["kf"])


class Http(unittest.TestCase):
    PORT = 8794

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        env = dict(os.environ, CINEPULSE_ASSETS=os.path.join(cls.tmp, "lib"), CINEPULSE_EXPORTS=os.path.join(cls.tmp, "x"), CINEPULSE_PROJECTS=os.path.join(cls.tmp, "projects"))
        cls.proc = subprocess.Popen([sys.executable, os.path.join(ROOT, "CinePulse", "backend", "server.py"), "--port", str(cls.PORT)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        for _ in range(100):
            try:
                cls.call("GET", "/api/status")
                break
            except OSError:
                time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(10)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    @classmethod
    def call(cls, method, path, body=None, raw=False):
        data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
        req = urllib.request.Request(f"http://127.0.0.1:{cls.PORT}{path}", data=data, method=method, headers={"Content-Type": "application/json"} if data else {})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                out = r.read()
                return r.status, (out if raw else json.loads(out)), dict(r.headers)
        except urllib.error.HTTPError as e:
            out = e.read()
            e.close()
            try:
                return e.code, (out if raw else json.loads(out or b"{}")), dict(e.headers)
            except ValueError:
                return e.code, out, dict(e.headers)

    def test_save_load_cycle(self):
        st, m, _ = self.call("POST", "/api/projects", {"name": "Court métrage", "project": project(3)})
        self.assertEqual((st, m["name"], m["rev"], m["clips"]), (201, "Court métrage", 1, 3))
        st, got, _ = self.call("GET", f"/api/projects/{m['id']}")
        self.assertEqual((st, len(got["project"]["clips"]), got["rev"]), (200, 3, 1))
        st, m2, _ = self.call("PUT", f"/api/projects/{m['id']}", {"project": project(5), "rev": 1})
        self.assertEqual((st, m2["rev"], m2["clips"]), (200, 2, 5))
        st, m3, _ = self.call("PUT", f"/api/projects/{m['id']}", {"name": "Version finale"})
        self.assertEqual((st, m3["name"], m3["clips"]), (200, "Version finale", 5))
        st, lst, _ = self.call("GET", "/api/projects")
        self.assertIn("Version finale", [p["name"] for p in lst["projects"]])
        st, stale, _ = self.call("PUT", f"/api/projects/{m['id']}", {"project": project(1), "rev": 1})
        self.assertEqual((st, stale["current"]["rev"]), (409, 3))
        st, _, _ = self.call("DELETE", f"/api/projects/{m['id']}")
        self.assertEqual(st, 200)
        self.assertEqual(self.call("GET", f"/api/projects/{m['id']}")[0], 404)
        self.assertEqual(self.call("DELETE", f"/api/projects/{m['id']}")[0], 404)

    def test_errors(self):
        self.assertEqual(self.call("POST", "/api/projects", b"{pas json")[0], 400)
        self.assertEqual(self.call("POST", "/api/projects", {"name": "x"})[0], 400)
        st, r, _ = self.call("POST", "/api/projects", {"project": {"version": 1, "tracks": [], "clips": []}})
        self.assertEqual(st, 400)
        self.assertIn("invalide", r["error"])
        st, m, _ = self.call("POST", "/api/projects", {"project": project(1)})
        self.assertEqual(self.call("PUT", f"/api/projects/{m['id']}", {"rev": "1"})[0], 400)
        self.assertEqual(self.call("PUT", f"/api/projects/{m['id']}", {"rev": True})[0], 400)
        self.assertEqual(self.call("PUT", "/api/projects/0123456789ab", {"name": "x"})[0], 404)
        self.assertEqual(self.call("PUT", "/api/projects/..%2f..%2fx", {"name": "x"})[0], 404)
        self.assertEqual(self.call("GET", "/api/projects/zzzz")[0], 404)

    def test_server_serves_the_nle_directly(self):
        st, html, h = self.call("GET", "/", raw=True)
        self.assertEqual(st, 200)
        self.assertIn(b"CinePulse NLE", html)
        self.assertIn(b"js/nle/main.js", html)
        self.assertEqual(self.call("GET", "/nle.html", raw=True)[0], 200)
        for gone in ("/index.html", "/js/app.js", "/js/timeline.js", "/css/style.css", "/api/assets", "/api/import_path"):
            self.assertEqual(self.call("GET", gone, raw=True)[0], 404, gone)
        self.assertEqual(self.call("POST", "/api/import", b"x")[0], 404)

    def test_every_module_and_style_of_the_page_loads(self):
        """Parcourt le graphe d'imports de la page (nle.html -> main.js -> ...) : aucun fichier manquant, aucune importation vers l'ancienne interface."""
        st, html, _ = self.call("GET", "/", raw=True)
        todo = [m.decode() for m in re.findall(rb'(?:src|href)="([^"]+\.(?:js|css))"', html)]
        seen = set()
        while todo:
            u = todo.pop()
            if u in seen:
                continue
            seen.add(u)
            st, body, _ = self.call("GET", "/" + u, raw=True)
            self.assertEqual(st, 200, u)
            if u.endswith(".js"):
                base = u.rsplit("/", 1)[0]
                for imp in re.findall(rb'from "(\./[^"]+)"', body):
                    path = os.path.normpath(base + "/" + imp.decode()).replace("\\", "/")
                    todo.append(path)
        self.assertGreaterEqual(len(seen), 12)
        self.assertTrue({"js/nle/projects.js", "js/nle/monitor.js", "js/nle/export.js", "css/nle.css"} <= seen, seen)


class Integration(unittest.TestCase):
    """Le bouton CinePulse d'E.N.O.S. (PC) ouvre bien ce serveur, dont la page d'accueil est le NLE."""

    def test_enos_button_targets_the_nle_server(self):
        with open(os.path.join(ROOT, "nasko_server.py"), encoding="utf-8") as f:
            src = f.read()
        self.assertIn("CINEPULSE_PORT = 8790", src)
        self.assertIn('webbrowser.open(f"http://127.0.0.1:{CINEPULSE_PORT}/")', src)
        self.assertIn("backend", src[src.index("def cinepulse_open"):src.index("def cinepulse_open") + 900])
        self.assertTrue(os.path.isfile(os.path.join(ROOT, "CinePulse", "backend", "server.py")))
        self.assertTrue(os.path.isfile(os.path.join(ROOT, "CinePulse", "frontend", "nle.html")))
        self.assertFalse(os.path.exists(os.path.join(ROOT, "CinePulse", "frontend", "index.html")), "l'ancienne interface est supprimée")
        with open(os.path.join(ROOT, "static", "index.html"), encoding="utf-8") as f:
            ui = f.read()
        self.assertIn('id="b-cine"', ui)
        self.assertNotIn("bêta", ui[ui.index('id="b-cine"'):ui.index('id="b-cine"') + 300])


if __name__ == "__main__":
    unittest.main(verbosity=2)
