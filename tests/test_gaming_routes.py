"""Routes gaming de nasko_server (Windows-only à l'import) : le bloc de routes est extrait et exécuté dans une mini-application."""
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
for _n in ("DETACHED_PROCESS", "CREATE_NEW_PROCESS_GROUP", "CREATE_NO_WINDOW"):
    if not hasattr(subprocess, _n):
        setattr(subprocess, _n, 0)
from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from pydantic import BaseModel  # noqa: E402

import nasko_babel  # noqa: E402
import nasko_brb  # noqa: E402
import nasko_clipper  # noqa: E402
import nasko_core  # noqa: E402
import nasko_pet  # noqa: E402
import nasko_tilt  # noqa: E402
import nasko_roles  # noqa: E402

SRC = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "nasko_server.py"), encoding="utf-8").read()
BLOCK = SRC[SRC.index("# ----------------------------------------------------------------------------- GAMING"):SRC.index("# ----------------------------------------------------------------------------- DÉPÔT INTRANET")]


class Routes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls._cp, cls._dd = nasko_core.config_path, nasko_core.data_dir
        nasko_core.config_path = lambda: os.path.join(cls.tmp, "c.json")
        nasko_core.data_dir = lambda: cls.tmp
        app = FastAPI()
        ns = dict(app=app, _LOCAL=[], BaseModel=BaseModel, HTTPException=HTTPException, FileResponse=FileResponse, load_config=nasko_core.load_config,
                  nasko_babel=nasko_babel, nasko_brb=nasko_brb, nasko_clipper=nasko_clipper, nasko_core=nasko_core, nasko_pet=nasko_pet, nasko_tilt=nasko_tilt, __name__="gm")
        exec("from __future__ import annotations\n" + BLOCK, ns)
        cls.c = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        nasko_core.config_path, nasko_core.data_dir = cls._cp, cls._dd

    def test_all_gaming_paths_are_role_gated(self):
        for p in ("/api/clipper/status", "/api/babel/say", "/api/tilt/death", "/api/brb/start", "/api/pet/options"):
            self.assertFalse(nasko_roles.allowed("friends", p)[0] and p != "/api/pet/options", p)
            self.assertTrue(nasko_roles.allowed("dev", p)[0], p)

    def test_configs_and_validation(self):
        self.assertFalse(self.c.get("/api/clipper/config").json()["clipper_enabled"])
        self.assertEqual(self.c.post("/api/clipper/config", json={"values": {"clipper_mode": "xx"}}).status_code, 400)
        self.assertEqual(self.c.post("/api/babel/config", json={"values": {"babel_dst": "klingon"}}).status_code, 400)
        self.assertFalse(self.c.get("/api/tilt/config").json()["tilt_enabled"])
        self.assertEqual(self.c.get("/api/babel/config").json().get("eleven_configured") in (True, False), True)

    def test_traversal_and_clone_consent(self):
        self.assertIn(self.c.get("/api/clipper/file/..%2Fx").status_code, (400, 404))
        self.assertEqual(self.c.get("/api/tilt/replay/..%2F..%2Fc.json").status_code, 404)
        r = self.c.post("/api/babel/clone", json={"consent": False})
        self.assertEqual(r.status_code, 400)

    def test_brb(self):
        self.assertTrue(self.c.post("/api/brb/start", json={"message": "x", "minutes": 0}).json()["active"])
        self.assertFalse(self.c.post("/api/brb/back").json()["active"])


if __name__ == "__main__":
    unittest.main()
