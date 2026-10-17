"""Routes /api/pdf/* : le bloc de nasko_server.py est chargé dans une mini-application (le serveur complet ne s'importe que sous Windows)."""
import io
import os
import re
import secrets
import shutil
import sys
import tempfile
import types
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pymupdf  # noqa: E402
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile  # noqa: E402
from fastapi.responses import Response  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from pydantic import BaseModel  # noqa: E402

import nasko_pdf  # noqa: E402

SRC = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "nasko_server.py"), encoding="utf-8").read()
BLOCK = SRC[SRC.index("class PdfOpen(BaseModel)"):SRC.index("# =============================================================================== YOUTUBE UPLOADER")]


def pdf_bytes(texts):
    d = pymupdf.open()
    for t in texts:
        d.new_page().insert_text((72, 100), t, fontsize=18)
    return d.tobytes()


class Routes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        nasko_pdf.ROOT = os.path.join(self.tmp, "Editeur PDF")
        nasko_pdf.WORK = os.path.join(nasko_pdf.ROOT, ".work")
        nasko_pdf.OUT = os.path.join(nasko_pdf.ROOT, "Livraison")
        nasko_pdf.S.update(name="", path="", hist=[], ver=0)
        nasko_pdf.JOB.update(busy=False, result=None, error="", cancel=False)
        nasko_pdf.ensure_dirs()
        shares = {}
        sync = types.SimpleNamespace(
            make_share=lambda p, kind="manual", ttl_min=None: shares.setdefault(p, {"token": secrets.token_hex(4), "name": os.path.basename(p)}),
            share_path=lambda sh: f"/dl/{sh['token']}/{sh['name']}")
        ns = {"app": FastAPI(), "_LOCAL": [], "BaseModel": BaseModel, "HTTPException": HTTPException, "File": File, "Form": Form, "UploadFile": UploadFile,
              "Response": Response, "os": os, "shutil": shutil, "secrets": secrets, "nasko_pdf": nasko_pdf, "nasko_sync": sync, "log": __import__("logging").getLogger("t"),
              "state": {"window": None}, "sec": types.SimpleNamespace(grant=lambda p: None), "nasko_paths": types.SimpleNamespace(user_dir=lambda n: self.tmp),
              "_safe": lambda p, k="any": p}
        exec(compile(BLOCK, "nasko_server_block", "exec"), ns)
        self.c = TestClient(ns["app"])

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def up(self, names_texts, **data):
        files = [("files", (n, io.BytesIO(pdf_bytes(t)), "application/pdf")) for n, t in names_texts]
        return self.c.post("/api/pdf/upload", files=files, data=data)

    def test_flow(self):
        self.assertFalse(self.c.get("/api/pdf/state").json()["has_doc"])
        r = self.up([("a.pdf", ["un", "deux", "trois"]), ("b.pdf", ["quatre"])])
        self.assertEqual(r.status_code, 200, r.text)
        st = r.json()
        self.assertEqual(len(st["pages"]), 4)
        img = self.c.get("/api/pdf/page", params={"n": 0, "z": 0.4})
        self.assertEqual(img.headers["content-type"], "image/jpeg")
        self.assertEqual(self.c.get("/api/pdf/page", params={"n": 99}).status_code, 400)
        self.assertEqual(self.c.get("/api/pdf/lines", params={"n": 0}).json()["lines"][0]["text"], "un")
        st = self.c.post("/api/pdf/arrange", json={"pages": [{"src": 3}, {"src": 0, "rot": 180}]}).json()
        self.assertEqual([p["rot"] for p in st["pages"]], [0, 180])
        ex = self.c.post("/api/pdf/extract", json={"pages": "2"}).json()["files"][0]
        self.assertTrue(ex["link"].startswith("/dl/") and ex["size"] > 0)
        self.assertEqual(self.c.post("/api/pdf/extract", json={"pages": "9"}).status_code, 400)
        sp = self.c.post("/api/pdf/split", json={"mode": "each"}).json()["files"]
        self.assertEqual(len(sp), 3)                                       # zip + 2 fichiers
        self.assertEqual(self.c.post("/api/pdf/annotate", json={"ops": [{"type": "redact", "page": 0, "rect": [0, 0, 1, 1]}]}).status_code, 200)
        self.assertEqual(self.c.post("/api/pdf/annotate", json={"ops": []}).status_code, 400)
        self.assertTrue(self.c.post("/api/pdf/undo").json()["can_undo"])
        self.assertEqual(self.c.post("/api/pdf/watermark", json={"opts": {"text": "X"}}).status_code, 200)
        self.assertEqual(self.c.post("/api/pdf/numbers", json={"opts": {}}).status_code, 200)
        self.assertTrue(self.c.post("/api/pdf/protect", json={"user_pw": "pw"}).json()["files"][0]["name"].endswith("_protege.pdf"))
        self.assertEqual(self.c.post("/api/pdf/export").status_code, 200)

    def test_job_endpoints(self):
        import time
        self.up([("a.pdf", ["un", "deux"])])
        r = self.c.post("/api/pdf/job/compress", json={"level": "medium"})
        self.assertEqual(r.status_code, 200, r.text)
        for _ in range(100):
            j = self.c.get("/api/pdf/job").json()
            if not j["busy"]:
                break
            time.sleep(0.05)
        self.assertEqual(j["error"], "")
        self.assertEqual(j["result"]["kind"], "compress")
        self.c.post("/api/pdf/job/convert", json={"fmt": "docx"})
        for _ in range(200):
            j = self.c.get("/api/pdf/job").json()
            if not j["busy"]:
                break
            time.sleep(0.05)
        self.assertTrue(j["result"]["files"][0]["link"].startswith("/dl/"))
        self.assertEqual(self.c.post("/api/pdf/job/nope", json={}).status_code, 404)
        self.assertEqual(self.c.post("/api/pdf/job/summarize", json={}).status_code, 400)       # IA non configurée

    def test_upload_rules(self):
        r = self.c.post("/api/pdf/upload", files=[("files", ("virus.exe", io.BytesIO(b"MZ"), "application/octet-stream"))])
        self.assertEqual(r.status_code, 400)
        enc = self.c.post("/api/pdf/protect", json={"user_pw": "x"})                  # sans document : message clair
        self.assertEqual(enc.status_code, 400)
        self.up([("a.pdf", ["un"])])
        p = self.c.post("/api/pdf/protect", json={"user_pw": "secret"}).json()["files"][0]
        path = os.path.join(nasko_pdf.OUT, p["name"])
        nasko_pdf.new_session()
        r = self.c.post("/api/pdf/upload", files=[("files", ("p.pdf", open(path, "rb"), "application/pdf"))])
        self.assertEqual(r.status_code, 400)
        self.assertTrue(r.json()["detail"].startswith("PASSWORD:"))
        r = self.c.post("/api/pdf/upload", files=[("files", ("p.pdf", open(path, "rb"), "application/pdf"))], data={"password": "secret"})
        self.assertEqual(r.status_code, 200)


if __name__ == "__main__":
    unittest.main()
