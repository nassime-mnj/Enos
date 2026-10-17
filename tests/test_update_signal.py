"""Mises à jour gérées par le Launcher, côté E.N.O.S. : fichiers-signal (contrat avec le Launcher), routes, bannière. Lancer : python3 tests/test_update_signal.py"""
import json, os, subprocess, sys, tempfile, threading, time, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
for _n in ("DETACHED_PROCESS", "CREATE_NEW_PROCESS_GROUP", "CREATE_NO_WINDOW"):
    if not hasattr(subprocess, _n):
        setattr(subprocess, _n, 0)
from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from pydantic import BaseModel  # noqa: E402
import nasko_core, nasko_roles, nasko_update_signal as U  # noqa: E402

SRC = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "nasko_server.py"), encoding="utf-8").read()
BLOCK = SRC[SRC.index('@app.get("/api/update/launcher"'):SRC.index("class UpdateReq(BaseModel):")]
READY = {"product": "enos", "channel": "stable", "version": "3.2.0", "notes": "Nouveautés <b>x</b>", "staged_at": 1700000000, "size": 12345}


class T(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(); os.environ["DP_SIGNALS_DIR"] = self.tmp
        self.cfg = {}
        self._o = nasko_core.load_config; nasko_core.load_config = lambda: dict(self.cfg)
        self.shut = []
        app = FastAPI()
        ns = dict(app=app, _LOCAL=[], BaseModel=BaseModel, HTTPException=HTTPException, nasko_update_signal=U, os=os, state={"shutdown": lambda: self.shut.append(1)}, __name__="us")
        exec("from __future__ import annotations\n" + BLOCK, ns)
        self.c = TestClient(app)

    def tearDown(self):
        nasko_core.load_config = self._o; os.environ.pop("DP_SIGNALS_DIR", None)

    def write(self, name, obj, raw=None):
        os.makedirs(os.path.join(self.tmp, "enos"), exist_ok=True)
        open(os.path.join(self.tmp, "enos", name), "w", encoding="utf-8").write(raw if raw is not None else json.dumps(obj))

    def test_paths_and_managed(self):
        self.assertEqual(U.signals_dir(), os.path.join(self.tmp, "enos"))
        with self.assertRaises(ValueError):
            U.signals_dir("../x")
        self.assertFalse(U.managed())                                       # copie de sources : mise à jour par build.bat
        self.cfg["update_managed_by_launcher"] = True; self.assertTrue(U.managed())
        sys.frozen = True
        try:
            self.cfg.clear(); self.assertTrue(U.managed())                  # exe installé : géré par le Launcher
        finally:
            del sys.frozen

    def test_ready_tolerant_reading(self):
        self.assertIsNone(U.ready())
        self.write("update-ready.json", READY); r = U.ready()
        self.assertEqual((r["version"], r["size"]), ("3.2.0", 12345))
        for bad in ('{"version": "x"}', "pas du json", "[1,2]", '{"version": "3.2.0"', ""):
            self.write("update-ready.json", None, raw=bad); self.assertIsNone(U.ready(), bad)
        self.write("update-ready.json", None, raw=json.dumps({**READY, "notes": "x" * 20000}))
        self.assertIsNone(U.ready())                                        # > 16 Ko : ignoré

    def test_running_file_contract(self):
        U.mark_running(4242)
        d = json.load(open(os.path.join(self.tmp, "enos", "running.json")))
        self.assertEqual(d["pid"], 4242); self.assertIn("exe", d); self.assertIn("started_at", d)
        U.clear_running(); self.assertFalse(os.path.exists(os.path.join(self.tmp, "enos", "running.json")))

    def test_request_apply_writes_flag_then_shuts_down_voluntarily(self):
        with self.assertRaises(ValueError):
            U.request_apply(lambda: None)                                   # rien de prêt : refusé, aucun flag
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "enos", "update-apply.json")))
        self.write("update-ready.json", READY)
        done = threading.Event(); U.request_apply(done.set, delay=0.05, pid=777)
        self.assertTrue(done.wait(2))
        d = json.load(open(os.path.join(self.tmp, "enos", "update-apply.json")))
        self.assertEqual(d["pid"], 777); self.assertLess(abs(d["requested_at"] - time.time()), 5)
        U.cancel_apply(); self.assertFalse(os.path.exists(os.path.join(self.tmp, "enos", "update-apply.json")))

    def test_routes(self):
        r = self.c.get("/api/update/launcher").json(); self.assertIsNone(r["ready"]); self.assertFalse(r["pending_apply"])
        self.assertEqual(self.c.post("/api/update/launcher/apply").status_code, 400)
        self.write("update-ready.json", READY); self.write("update-applied.json", {"version": "3.1.0", "applied_at": 1})
        r = self.c.get("/api/update/launcher").json(); self.assertEqual(r["ready"]["version"], "3.2.0"); self.assertEqual(r["applied"]["version"], "3.1.0")
        self.assertEqual(self.c.post("/api/update/launcher/applied/seen").json(), {"ok": True}); self.assertIsNone(self.c.get("/api/update/launcher").json()["applied"])
        self.assertEqual(self.c.post("/api/update/launcher/apply").json(), {"ok": True, "version": "3.2.0"})
        time.sleep(1.2); self.assertEqual(self.shut, [1]); self.assertTrue(self.c.get("/api/update/launcher").json()["pending_apply"])

    def test_role_gating(self):
        for role in ("friends", "dev", "ceo"):
            self.assertTrue(nasko_roles.allowed(role, "/api/update/launcher")[0], role)


if __name__ == "__main__":
    unittest.main()
