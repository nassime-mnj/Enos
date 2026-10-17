"""Routes /api/studio/* : le bloc de nasko_server.py est chargé dans une mini-application."""
import io
import os
import secrets
import shutil
import sys
import tempfile
import time
import types
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fastapi import FastAPI, File, HTTPException, UploadFile  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402
from pydantic import BaseModel  # noqa: E402

import nasko_studio  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = open(os.path.join(ROOT, "nasko_server.py"), encoding="utf-8").read()
BLOCK = SRC[SRC.index("class StRun(BaseModel)"):SRC.index("# =============================================================================== ÉDITEUR PDF")]


class Routes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        nasko_studio.ROOT = os.path.join(self.tmp, "Studio")
        nasko_studio.UP = nasko_studio.ROOT + "/.uploads"
        nasko_studio.OUT = nasko_studio.ROOT + "/Livraison"
        nasko_studio.JOB.update(busy=False, result=None, error="", cancel=False)
        nasko_studio.ensure_dirs()
        shares = {}
        sync = types.SimpleNamespace(make_share=lambda p, kind="manual", ttl_min=None: shares.setdefault(p, {"token": secrets.token_hex(4), "name": os.path.basename(p)}),
                                     share_path=lambda sh: f"/dl/{sh['token']}/{sh['name']}")
        ns = {"app": FastAPI(), "_LOCAL": [], "BaseModel": BaseModel, "HTTPException": HTTPException, "File": File, "UploadFile": UploadFile, "FileResponse": FileResponse,
              "os": os, "shutil": shutil, "nasko_studio": nasko_studio, "nasko_sync": sync, "log": __import__("logging").getLogger("t")}
        exec(compile(BLOCK, "block", "exec"), ns)
        self.c = TestClient(ns["app"])

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def png(self, size=(40, 30)):
        b = io.BytesIO()
        Image.new("RGB", size, (200, 50, 50)).save(b, "PNG")
        return b.getvalue()

    def wait(self):
        for _ in range(200):
            j = self.c.get("/api/studio/job").json()
            if not j["busy"]:
                return j
            time.sleep(0.05)

    def test_flow(self):
        self.assertTrue(self.c.get("/api/studio/caps").json()["ffmpeg"] in (True, False))
        r = self.c.post("/api/studio/upload", files=[("files", ("a.png", self.png(), "image/png"))]).json()
        self.assertEqual((r["kind"], r["preview"]), ("image", True))
        prev = self.c.get("/api/studio/preview", params={"ref": r["ref"]})
        self.assertEqual(prev.headers["content-type"], "image/jpeg")
        self.assertEqual(self.c.post("/api/studio/run/convert_image", json={"ref": r["ref"], "opts": {"fmt": "webp"}}).status_code, 200)
        j = self.wait()
        self.assertEqual(j["error"], "")
        f = j["result"]["files"][0]
        self.assertTrue(f["link"].startswith("/dl/") and f["name"].endswith(".webp"))
        self.c.post("/api/studio/run/exif_read", json={"ref": r["ref"]})
        self.assertEqual(self.wait()["result"]["kind"], "exif")

    def test_rejections(self):
        self.assertEqual(self.c.post("/api/studio/upload", files=[("files", ("x.exe", io.BytesIO(b"MZ"), "application/octet-stream"))]).status_code, 400)
        self.assertEqual(self.c.post("/api/studio/run/convert_image", json={"ref": "../../etc"}).status_code, 400)
        self.assertEqual(self.c.post("/api/studio/run/nope", json={"ref": "0" * 12}).status_code, 400)
        r = self.c.post("/api/studio/upload", files=[("files", ("a.png", self.png(), "image/png"))]).json()
        self.assertEqual(self.c.post("/api/studio/run/video_gif", json={"ref": r["ref"]}).status_code, 400)           # image donnée à un outil vidéo
        self.assertEqual(self.c.get("/api/studio/preview", params={"ref": "zz"}).status_code, 400)
        left = os.listdir(nasko_studio.UP)
        self.c.post("/api/studio/upload", files=[("files", ("x.exe", io.BytesIO(b"MZ"), "x"))])
        self.assertEqual(sorted(os.listdir(nasko_studio.UP)), sorted(left))                                           # dépôt refusé = rien ne traîne


if __name__ == "__main__":
    unittest.main()
