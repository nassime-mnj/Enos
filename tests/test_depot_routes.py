"""Routes du Dépôt Intranet (nasko_server est Windows-only à l'import : le bloc de routes est extrait et exécuté dans une mini-application) avec de vrais dépôts git
(espace de travail « local »), le vrai terminal pty et un PDF généré à la volée."""
import json, os, subprocess, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
for _n in ("DETACHED_PROCESS", "CREATE_NEW_PROCESS_GROUP", "CREATE_NO_WINDOW"):
    if not hasattr(subprocess, _n):
        setattr(subprocess, _n, 0)
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from pydantic import BaseModel  # noqa: E402
import nasko_core, nasko_depot, nasko_depot_forge, nasko_depot_git, nasko_depot_study, nasko_depot_term, nasko_devmanager, nasko_roles  # noqa: E402
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from platform_pin import windows  # noqa: E402

SRC = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "nasko_server.py"), encoding="utf-8").read()
BLOCK = SRC[SRC.index("# ----------------------------------------------------------------------------- DÉPÔT INTRANET"):SRC.index("class PetOptions(BaseModel):")]
GIT = lambda cwd, *a: subprocess.run(["git", "-C", cwd, *a], check=True, capture_output=True, text=True).stdout


class Routes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="dprt_")
        cls.root = os.path.join(cls.tmp, "Nasko"); os.makedirs(cls.root)
        cls._cp, cls._dd = nasko_core.config_path, nasko_core.data_dir
        nasko_core.config_path = lambda: os.path.join(cls.tmp, "c.json")
        nasko_core.data_dir = lambda: cls.tmp
        nasko_core.update_config({"depot_local_root": cls.root})
        cls.remote = os.path.join(cls.tmp, "remote.git"); subprocess.run(["git", "init", "-q", "--bare", "-b", "main", cls.remote], check=True)
        cls.repo = os.path.join(cls.root, "ex00"); subprocess.run(["git", "init", "-q", "-b", "main", cls.repo], check=True)
        for k, v in (("user.name", "T"), ("user.email", "t@t")):
            GIT(cls.repo, "config", k, v)
        GIT(cls.repo, "remote", "add", "origin", cls.remote)
        open(os.path.join(cls.repo, "a.c"), "w").write("int main(void){return 0;}\n")
        GIT(cls.repo, "add", "."); GIT(cls.repo, "commit", "-qm", "init"); GIT(cls.repo, "push", "-q", "-u", "origin", "main")
        app = FastAPI()
        ns = dict(app=app, _LOCAL=[], BaseModel=BaseModel, HTTPException=HTTPException, UploadFile=UploadFile, File=File, Form=Form, WebSocket=WebSocket, WebSocketDisconnect=WebSocketDisconnect,
                  load_config=nasko_core.load_config, json=json, os=os, nasko_depot=nasko_depot, nasko_depot_git=nasko_depot_git, nasko_depot_study=nasko_depot_study, nasko_depot_forge=nasko_depot_forge,
                  nasko_depot_term=nasko_depot_term, nasko_devmanager=nasko_devmanager, __name__="dp")
        exec("from __future__ import annotations\n" + BLOCK, ns)
        cls.c = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        nasko_depot_term.close_all()
        nasko_core.config_path, nasko_core.data_dir = cls._cp, cls._dd

    def test_paths_are_role_gated(self):
        # capacité « depot » : donnée à Friends (étudiants), à Dev et au CEO ; le reste de « devtools » reste refusé à Friends (voir test_roles.py)
        for p in ("/api/depot/git/send", "/api/depot/shell-drop", "/ws/depot-term", "/api/depot/workspace", "/api/depot/terminal/reset"):
            self.assertEqual(nasko_roles.capability_for(p), "depot", p)
            for role in ("friends", "dev", "ceo"):
                self.assertTrue(nasko_roles.allowed(role, p)[0], (role, p))
        self.assertFalse(nasko_roles.allowed("friends", "/api/dev/uninstall-launcher")[0])

    def test_state_and_status(self):
        st = self.c.get("/api/depot/state").json()
        self.assertEqual(st["mode"], "local"); self.assertEqual([r["name"] for r in st["repos"]], ["ex00"])
        g = self.c.get("/api/depot/git/status", params={"repo": "ex00"}).json()
        self.assertEqual(g["branch"], "main"); self.assertIn("clean", g)
        self.assertEqual(self.c.get("/api/depot/git/status", params={"repo": "../x"}).status_code, 400)
        self.assertEqual(self.c.get("/api/depot/git/status", params={"repo": "nope"}).status_code, 400)

    def test_send_increments_tag_and_pushes(self):
        os.makedirs(os.path.join(self.repo, "sub"), exist_ok=True)
        for i in (1, 2):
            open(os.path.join(self.repo, "sub", "f.c"), "w").write("int f%d;\n" % i)
            r = self.c.post("/api/depot/git/send", json={"repo": "ex00", "folder": "sub", "message": "rendu %d" % i, "tag": "rush"}).json()
            self.assertTrue(r["ok"], r); self.assertEqual(r["tag"], "rushV%d" % i)
        remote_tags = subprocess.run(["git", "ls-remote", "--tags", self.remote], capture_output=True, text=True).stdout
        self.assertIn("refs/tags/rushV1", remote_tags); self.assertIn("refs/tags/rushV2", remote_tags)
        self.assertEqual(self.c.get("/api/depot/git/next-tag", params={"repo": "ex00", "prefix": "rush"}).json()["tag"], "rushV3")
        bad = self.c.post("/api/depot/git/send", json={"repo": "ex00", "folder": "../..", "message": "x", "tag": "t"})
        self.assertEqual(bad.status_code, 400)

    def test_branches_and_tags(self):
        self.assertTrue(self.c.post("/api/depot/git/branch", json={"repo": "ex00", "action": "create", "name": "feat"}).json()["ok"] is not False)
        b = self.c.get("/api/depot/git/branches", params={"repo": "ex00"}).json(); self.assertEqual(b["current"], "feat")
        self.c.post("/api/depot/git/branch", json={"repo": "ex00", "action": "switch", "name": "main"})
        self.assertEqual(self.c.post("/api/depot/git/branch", json={"repo": "ex00", "action": "delete", "name": "feat"}).status_code, 200)
        self.assertEqual(self.c.post("/api/depot/git/branch", json={"repo": "ex00", "action": "bogus"}).status_code, 400)
        GIT(self.repo, "tag", "-a", "tmpT", "-m", "x")
        self.assertEqual(self.c.post("/api/depot/git/tag/delete", json={"repo": "ex00", "name": "tmpT"}).status_code, 200)

    def test_fs_confinement_and_edit(self):
        r = self.c.get("/api/depot/fs/file", params={"repo": "ex00", "path": "a.c"}).json(); self.assertIn("main", r["text"])
        self.assertEqual(self.c.post("/api/depot/fs/file", json={"repo": "ex00", "path": "a.c", "content": "int x;\n"}).json(), {"ok": True})
        self.assertEqual(open(os.path.join(self.repo, "a.c")).read(), "int x;\n")
        for bad in ("../c.json", "/etc/passwd", ".git/config", "sub/../../c.json"):
            self.assertEqual(self.c.get("/api/depot/fs/file", params={"repo": "ex00", "path": bad}).status_code, 400, bad)
        self.assertEqual(self.c.post("/api/depot/fs/create", json={"repo": "ex00", "path": "n/new.c", "kind": "file"}).json(), {"ok": True})
        names = [i["name"] for i in self.c.get("/api/depot/fs/tree", params={"repo": "ex00"}).json()["items"]]
        self.assertNotIn(".git", names); self.assertIn("a.c", names)

    def test_shell_drop(self):
        f = {"file": ("fix.sh", b"#!/bin/sh\r\necho hi\r\n", "text/x-shellscript")}
        r = self.c.post("/api/depot/shell-drop", files=f, data={"repo": "ex00", "target": "root"}); self.assertEqual(r.status_code, 200, r.text)
        p = os.path.join(self.repo, "fix.sh"); self.assertTrue(os.access(p, os.X_OK)); self.assertNotIn(b"\r", open(p, "rb").read())
        self.assertEqual(self.c.post("/api/depot/shell-drop", files=f, data={"repo": "ex00", "target": "root"}).status_code, 409)
        self.assertEqual(self.c.post("/api/depot/shell-drop", files=f, data={"repo": "ex00", "target": "root", "overwrite": "1"}).status_code, 200)
        r = self.c.post("/api/depot/shell-drop", files={"file": ("../evil.sh", b"x", "text/plain")}, data={"repo": "ex00"}); self.assertIn(r.status_code, (200, 400))
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "evil.sh")))
        self.assertEqual(self.c.post("/api/depot/shell-drop", files={"file": ("x.txt", b"x", "text/plain")}, data={"repo": "ex00"}).status_code, 400)
        self.c.post("/api/depot/shell-drop", files={"file": ("up.sh", b"echo", "text/plain")}, data={"repo": "ex00", "target": "parent"})
        self.assertTrue(os.path.exists(os.path.join(self.root, "up.sh")))

    def test_forge_ics_link(self):
        r = self.c.get("/api/depot/forge").json(); self.assertEqual(r["items"], []); self.assertFalse(r["config"]["ics_set"])
        link = "https://forge.invalid.test/cal/feed.ics?token=SECRET-TOKEN-123"
        self.assertTrue(self.c.post("/api/depot/forge/config", json={"ics": link}).json()["ics_set"])
        r = self.c.get("/api/depot/forge?force=1"); self.assertNotIn("SECRET-TOKEN-123", r.text); self.assertNotIn("feed.ics", r.text)
        self.assertEqual(r.json()["config"]["host"], "forge.invalid.test"); self.assertTrue(r.json()["error"])
        self.assertEqual(self.c.post("/api/depot/forge/config", json={"ics": "http://evil.example/a.ics"}).status_code, 400)
        self.assertFalse(self.c.post("/api/depot/forge/clear").json()["ics_set"])

    def test_subject_roadmap_and_trainings(self):
        import fitz
        d = fitz.open(); pg = d.new_page(); pg.insert_text((72, 90), "Projet Libft\n1. Écrire ft_strlen\n2. Écrire ft_strcpy\n3. Faire un Makefile")
        pdf = d.tobytes()
        r = self.c.post("/api/depot/subject/analyze", files={"file": ("sujet.pdf", pdf, "application/pdf")}, data={"key": "ex00"}); self.assertEqual(r.status_code, 200, r.text)
        steps = r.json()["roadmap"]["analysis"]["steps"]; self.assertTrue(steps)
        self.c.post("/api/depot/roadmap/step", json={"key": "ex00", "step": steps[0]["id"], "done": True})
        rm = self.c.get("/api/depot/roadmap", params={"key": "ex00"}).json()["roadmap"]; self.assertEqual(rm["done_count"], 1)
        self.assertEqual(self.c.post("/api/depot/subject/analyze", files={"file": ("s.pdf", b"not a pdf", "application/pdf")}, data={"key": "ex00"}).status_code, 400)
        t = self.c.post("/api/depot/trainings", files={"file": ("rush.pdf", pdf, "application/pdf")}, data={"title": "Rush"}).json()["training"]
        self.assertIn(t["id"], [x["id"] for x in self.c.get("/api/depot/trainings").json()["items"]])
        self.assertEqual(self.c.get("/api/depot/trainings/%s" % t["id"]).status_code, 200)
        self.assertEqual(self.c.delete("/api/depot/trainings/%s" % t["id"]).json(), {"ok": True})
        self.assertIn(self.c.get("/api/depot/trainings/zzz").status_code, (400, 404))

    @windows
    def test_terminal_websocket(self):
        with self.c.websocket_connect("/ws/depot-term?repo=ex00&cols=80&rows=24") as ws:
            ws.send_bytes(b"echo $((6*7))\n")
            buf = b""
            for _ in range(60):
                m = ws.receive()
                if m.get("bytes"):
                    buf += m["bytes"]
                    if b"42" in buf.split(b"echo")[-1]:
                        break
            self.assertIn(b"42", buf)
            ws.send_text(json.dumps({"t": "resize", "cols": 100, "rows": 30}))
            ws.send_bytes(b"exit\n")
            for _ in range(200):                                    # le serveur termine proprement quand le shell se ferme
                m = ws.receive()
                if m.get("text") and json.loads(m["text"]).get("t") == "exit":
                    break
            else:
                self.fail("pas de message exit")
        bad = self.c.websocket_connect("/ws/depot-term?repo=../x")
        with bad as ws2:
            self.assertEqual(json.loads(ws2.receive_text())["t"], "error")


if __name__ == "__main__":
    unittest.main()
