"""Profils CEO / Dev / Friends (nasko_roles). Lancer : python tests/test_roles.py"""
import json
import os
import re
import shutil
import sys
import tempfile
import time
import types
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
for name, attrs in {"nasko_llm": {"configured": lambda cfg: False, "complete": lambda *a, **k: "", "LLMError": type("LLMError", (Exception,), {})}}.items():
    sys.modules.setdefault(name, types.ModuleType(name)).__dict__.update(attrs)
import nasko_agenda as A  # noqa: E402
import nasko_core  # noqa: E402
import nasko_roles as R  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = open(os.path.join(ROOT, "nasko_server.py"), encoding="utf-8").read()


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._dd, self._cp = nasko_core.data_dir, nasko_core.config_path
        nasko_core.data_dir = lambda: self.tmp
        nasko_core.config_path = lambda: os.path.join(self.tmp, "nasko_config.json")
        R._cache.update(mtime=None, path=None, data=None)
        R._fails.clear()
        R._keys.clear()
        R._hooks.clear()

    def tearDown(self):
        nasko_core.data_dir, nasko_core.config_path = self._dd, self._cp
        shutil.rmtree(self.tmp, ignore_errors=True)

    def become(self, role):
        R.select(role, "1234", "1234")
        return role


class Matrix(Base):
    ALLOWED_FRIENDS = ["/api/agenda/tasks", "/api/agenda/overview", "/api/agent/status", "/api/epita/config", "/api/background/settings", "/api/syllabus/analyze", "/api/pdf/state",
                       "/api/pdf/job/ocr", "/api/studio/upload", "/api/chat", "/api/history", "/api/stt/start", "/api/voice/x", "/api/tts/abc", "/api/settings/language", "/api/settings/persona",
                       "/api/settings/welcome/preview", "/api/status", "/api/edition", "/api/role", "/api/role/select", "/api/security/ticket", "/api/update", "/api/ota/check", "/api/shutdown",
                       "/", "/static/pdfed.js", "/dl/abc/file.pdf", "/login", "/api/onboarding/agenda", "/api/notify/poll"]
    DENIED_FRIENDS = ["/api/sys/history", "/api/cleaner/scan", "/api/org/list", "/api/power/request", "/api/tabs", "/ext/poll", "/api/git/sync", "/api/dev/repos", "/api/godot/run", "/api/godotsync/accept",
                      "/api/projects", "/api/files", "/api/env/launch", "/api/tasks/env", "/api/warehouse/list", "/api/team/devices", "/api/devchat/send", "/api/channel/open", "/api/apimon/state",
                      "/api/receipts/analyze", "/api/mobile/pc", "/api/mobile/chess/play", "/api/security/status", "/api/security/config", "/api/network", "/api/devices", "/api/pair/start",
                      "/api/sync/upload", "/api/compress/state", "/api/youtube/upload", "/api/chess/state", "/api/study/x", "/api/pet/start", "/api/chill/tracks", "/api/discord/start",
                      "/api/settings/profile", "/api/settings/pick", "/api/imgproc/state", "/api/anim/list", "/api/audio/list", "/api/screen/frame", "/api/site/start", "/api/assistant/call",
                      "/api/narration/godot", "/api/f6/state", "/api/pack/x", "/api/colis", "/ws/chess", "/ws/pet", "/ws/chat", "/api/inconnu", "/ws/inconnu", "/ext/inconnu", "/api/pdfx/state",
                      "/api//pdf/state", "/api/pdf/../sys/history"]

    def test_friends_whitelist(self):
        for p in self.ALLOWED_FRIENDS:
            self.assertTrue(R.allowed("friends", p)[0], "Friends devrait pouvoir : " + p)
        for p in self.DENIED_FRIENDS:
            self.assertFalse(R.allowed("friends", p)[0], "Friends ne devrait PAS pouvoir : " + p)

    def test_no_role_chosen_behaves_like_friends(self):
        for p in self.DENIED_FRIENDS:
            self.assertFalse(R.allowed(None, p)[0], p)
        self.assertTrue(R.allowed(None, "/api/agenda/tasks")[0])

    def test_dev_is_everything_except_receipts_and_apimon(self):
        for p in self.ALLOWED_FRIENDS + self.DENIED_FRIENDS:
            if p in ("/api/receipts/analyze", "/api/apimon/state"):
                continue
            ok, cap = R.allowed("dev", p)
            self.assertTrue(ok, "Dev devrait pouvoir : " + p)
        for p in ("/api/receipts/analyze", "/api/receipts/job", "/api/receipts/export", "/api/apimon/state", "/api/apimon"):
            self.assertFalse(R.allowed("dev", p)[0], "Dev ne devrait PAS pouvoir : " + p)
        # le module Terna et les outils « machine » doivent être fluides pour Dev
        for p in ("/api/git/sync", "/api/godotsync/push", "/api/dev/repos", "/api/warehouse/list", "/api/devchat/send", "/ws/chat", "/api/godot/run", "/api/cleaner/scan", "/api/tabs", "/ext/poll"):
            self.assertTrue(R.allowed("dev", p)[0], p)

    def test_ceo_has_everything(self):
        for p in self.ALLOWED_FRIENDS + self.DENIED_FRIENDS + ["/api/receipts/job", "/api/apimon/state"]:
            self.assertTrue(R.allowed("ceo", p)[0], p)
        self.assertEqual(set(R.caps("ceo")), set(R.ALL_CAPS))
        self.assertNotIn("receipts", R.caps("dev"))
        self.assertNotIn("apimon", R.caps("dev"))
        self.assertEqual(set(R.caps("friends")), set(R.FRIENDS_CAPS))

    def test_every_server_route_is_mapped_explicitly(self):
        """Garde-fou : aucune route /api, /ws ou /ext du serveur ne peut échapper à la table (sinon elle serait refusée à Friends par défaut, sans qu'on l'ait décidé)."""
        paths = set(re.findall(r'@app\.(?:get|post|put|patch|delete|websocket)\("(/[^"]*)"', SERVER))
        guarded = sorted(p for p in paths if R.is_guarded(p))
        self.assertGreater(len(guarded), 250)
        unmapped = [p for p in guarded if R.capability_for(p) is None]
        self.assertEqual(unmapped, [], "routes sans capacité : " + ", ".join(unmapped))

    def test_sensitive_new_modules_are_not_open_to_friends_by_mistake(self):
        for p in ("/api/receipts/analyze", "/api/apimon/state", "/api/cleaner/results", "/api/tabs/close"):
            self.assertFalse(R.allowed("friends", p)[0], p)


class State(Base):
    def test_default_is_pending_then_friends_without_pin(self):
        self.assertIsNone(R.current())
        self.assertEqual(R.effective(), "friends")
        self.assertTrue(R.info()["needs_setup"])
        R.select("friends")
        self.assertEqual((R.current(), R.info()["needs_setup"]), ("friends", False))

    def test_first_use_sets_the_pin_then_requires_it(self):
        with self.assertRaises(R.RoleError):
            R.select("ceo")                                                   # aucun code défini et aucun nouveau code fourni
        with self.assertRaises(R.RoleError):
            R.select("ceo", new_pin="12")                                     # trop court
        R.select("ceo", new_pin="s3cret")
        self.assertEqual(R.current(), "ceo")
        self.assertTrue(R.pins_set()["ceo"] and not R.pins_set()["dev"])
        R.select("friends")                                                   # redescendre ne demande rien
        with self.assertRaises(R.RoleError):
            R.select("ceo", pin="mauvais")
        with self.assertRaises(R.RoleError):
            R.select("ceo")                                                   # sans code
        self.assertEqual(R.select("ceo", pin="s3cret"), "ceo")
        self.assertNotIn("s3cret", open(os.path.join(self.tmp, "role.json"), encoding="utf-8").read())      # code jamais en clair

    def test_lockout_after_five_failures(self):
        R.select("dev", new_pin="abcd")
        R.select("friends")
        for _ in range(R.MAX_FAILS):
            with self.assertRaises(R.RoleError):
                R.select("dev", pin="nope")
        with self.assertRaises(R.RoleError) as cm:
            R.select("dev", pin="abcd")                                       # même le bon code est refusé pendant le blocage
        self.assertIn("Trop d'essais", str(cm.exception))
        R._fails.clear()
        self.assertEqual(R.select("dev", pin="abcd"), "dev")

    def test_change_pin(self):
        R.select("ceo", new_pin="old1")
        with self.assertRaises(R.RoleError):
            R.change_pin("ceo", "wrong", "new22")
        R.change_pin("ceo", "old1", "new22")
        R.select("friends")
        with self.assertRaises(R.RoleError):
            R.select("ceo", pin="old1")
        self.assertEqual(R.select("ceo", pin="new22"), "ceo")
        with self.assertRaises(R.RoleError):
            R.change_pin("friends", "x", "yyyy")

    def test_tampering_with_role_json_is_rejected(self):
        R.select("friends")
        p = os.path.join(self.tmp, "role.json")
        d = json.load(open(p, encoding="utf-8"))
        d["role"] = "ceo"                                                     # on triche en éditant le fichier
        json.dump(d, open(p, "w", encoding="utf-8"))
        R._cache["mtime"] = None
        self.assertIsNone(R.current())
        self.assertEqual(R.effective(), "friends")
        self.assertFalse(R.allowed(R.current(), "/api/receipts/job")[0])
        open(p, "w").write("pas du json")
        R._cache["mtime"] = None
        self.assertIsNone(R.current())
        # copier le fichier d'une autre machine (autre clé) ne donne rien non plus
        R.select("friends")
        good = open(p, encoding="utf-8").read()
        os.remove(os.path.join(self.tmp, "role.key"))
        R._keys.clear()
        R._cache["mtime"] = None
        open(p, "w", encoding="utf-8").write(good)
        self.assertIsNone(R.current())

    def test_switch_hooks_and_persistence_across_restart(self):
        seen = []
        R.on_switch(lambda old, new: seen.append((old, new)))
        R.on_switch(lambda old, new: 1 / 0)                                   # un nettoyage qui plante ne bloque pas le changement
        R.select("friends")
        R.select("dev", new_pin="abcd")
        self.assertEqual(seen, [(None, "friends"), ("friends", "dev")])
        R._cache.update(mtime=None, data=None)                                # « redémarrage » : relecture du disque
        R._keys.clear()
        self.assertEqual(R.current(), "dev")

    def test_unknown_role(self):
        with self.assertRaises(R.RoleError):
            R.select("root")
        with self.assertRaises(R.RoleError):
            R.select("")


class DataSeparation(Base):
    def test_data_name(self):
        self.assertEqual(R.data_name("agenda.json"), "agenda.friends.json")        # aucun profil choisi = Friends
        R.select("friends")
        self.assertEqual(R.data_name("history.json"), "history.friends.json")
        self.become("ceo")
        self.assertEqual(R.data_name("agenda.json"), "agenda.json")
        self.become("dev")
        self.assertEqual(R.data_name("agenda.json"), "agenda.json")

    def test_agenda_is_separate_between_ceo_and_friends(self):
        self.become("ceo")
        A.add_task("Mon rendez-vous privé", "2026-05-01T10:00")
        R.select("friends")
        self.assertEqual(A.list_tasks(), [])                                       # agenda vierge
        A.add_task("Réviser les maths", "2026-05-02T09:00")
        self.assertEqual([t["title"] for t in A.list_tasks()], ["Réviser les maths"])
        R.select("ceo", pin="1234")
        self.assertEqual([t["title"] for t in A.list_tasks()], ["Mon rendez-vous privé"])
        self.assertTrue(os.path.isfile(os.path.join(self.tmp, "agenda.friends.json")))

    def test_school_links_of_the_ceo_are_not_visible_to_friends(self):
        json.dump({"zeus_ics_url": "https://zeus.example/secret-token", "moodle_ics_url": "https://moodle.example/auth=abc", "llm_api_key": "k"}, open(nasko_core.config_path(), "w"))
        self.become("ceo")
        self.assertEqual(nasko_core.load_config()["zeus_ics_url"], "https://zeus.example/secret-token")
        R.select("friends")
        cfg = nasko_core.load_config()
        self.assertEqual((cfg["zeus_ics_url"], cfg["moodle_ics_url"]), ("", ""))
        nasko_core.update_config({"zeus_ics_url": "https://zeus.example/friend"})     # ses propres liens : rangés à part
        self.assertEqual(nasko_core.load_config()["zeus_ics_url"], "https://zeus.example/friend")
        raw = json.load(open(nasko_core.config_path()))
        self.assertEqual(raw["zeus_ics_url"], "https://zeus.example/secret-token")      # celui du CEO n'a pas bougé
        self.assertEqual(raw["friends_zeus_ics_url"], "https://zeus.example/friend")
        R.select("ceo", pin="1234")
        self.assertEqual(nasko_core.load_config()["zeus_ics_url"], "https://zeus.example/secret-token")


class Gate(Base):
    def make_app(self):
        from fastapi import FastAPI, WebSocket
        app = FastAPI()
        for p in ("/api/pdf/state", "/api/sys/history", "/api/receipts/job", "/api/apimon/state", "/api/git/sync", "/api/cleaner/scan", "/api/agenda/tasks", "/api/unknown/x"):
            app.add_api_route(p, (lambda path: lambda: {"ok": path})(p), methods=["GET"])
        app.add_api_route("/static/x.js", lambda: {"ok": "static"}, methods=["GET"])

        @app.websocket("/ws/chess")
        async def wc(ws: WebSocket):
            await ws.accept()
            await ws.send_text("hello")
            await ws.close()

        @app.websocket("/ws/chat")
        async def wh(ws: WebSocket):
            await ws.accept()
            await ws.send_text("hello")
            await ws.close()
        app.add_middleware(R.RoleGate)
        from fastapi.testclient import TestClient
        return TestClient(app)

    def test_http_and_websocket_enforcement_for_each_role(self):
        from starlette.websockets import WebSocketDisconnect
        c = self.make_app()
        # aucun profil choisi : se comporte comme Friends, y compris pour le chemin d'une machine locale
        self.assertEqual(c.get("/api/pdf/state").status_code, 200)
        r = c.get("/api/sys/history")
        self.assertEqual(r.status_code, 403)
        self.assertEqual((r.json()["role"], r.json()["capability"]), ("friends", "system"))
        self.assertIn("Friends", r.json()["detail"])
        self.assertEqual(c.get("/static/x.js").status_code, 200)
        for p in ("/api/git/sync", "/api/cleaner/scan", "/api/receipts/job", "/api/apimon/state", "/api/unknown/x"):
            self.assertEqual(c.get(p).status_code, 403, p)
        with self.assertRaises(WebSocketDisconnect) as cm:
            with c.websocket_connect("/ws/chess"):
                pass
        self.assertEqual(cm.exception.code, 1008)
        with self.assertRaises(WebSocketDisconnect):
            with c.websocket_connect("/ws/chat"):
                pass
        # Dev : tout sauf Notes de frais et API Control Panel
        self.become("dev")
        for p in ("/api/pdf/state", "/api/sys/history", "/api/git/sync", "/api/cleaner/scan", "/api/agenda/tasks", "/api/unknown/x"):
            self.assertEqual(c.get(p).status_code, 200, p)
        for p in ("/api/receipts/job", "/api/apimon/state"):
            self.assertEqual(c.get(p).status_code, 403, p)
        with c.websocket_connect("/ws/chat") as ws:
            self.assertEqual(ws.receive_text(), "hello")
        # CEO : tout
        R.select("ceo", new_pin="9999")
        for p in ("/api/receipts/job", "/api/apimon/state", "/api/sys/history", "/api/git/sync"):
            self.assertEqual(c.get(p).status_code, 200, p)
        # retour à Friends : le blocage reprend immédiatement, sans redémarrage
        R.select("friends")
        self.assertEqual(c.get("/api/receipts/job").status_code, 403)
        self.assertEqual(c.get("/api/agenda/tasks").status_code, 200)

    def test_role_routes_of_the_real_server(self):
        """Le bloc /api/role du vrai nasko_server.py, chargé dans une mini-application."""
        from fastapi import FastAPI, HTTPException
        from fastapi.testclient import TestClient
        from pydantic import BaseModel
        block = SERVER[SERVER.index("class RoleSelect(BaseModel)"):SERVER.index("class AgendaAction(BaseModel)")]
        ns = {"app": FastAPI(), "_REMOTE": [], "_LOCAL": [], "BaseModel": BaseModel, "HTTPException": HTTPException, "nasko_roles": R, "sec": types.SimpleNamespace(event=lambda *a: None),
              "nasko_epita": types.SimpleNamespace(_mem={"zeus": 1}), "nasko_pdf": types.SimpleNamespace(new_session=lambda: None, JOB={}), "nasko_studio": types.SimpleNamespace(UP=self.tmp + "/x", JOB={}),
              "nasko_receipts": types.SimpleNamespace(UP=self.tmp + "/y", JOB={}), "nasko_syllabus": types.SimpleNamespace(JOB={}), "shutil": shutil}
        exec(compile(block, "block", "exec"), ns)
        ns["app"].add_middleware(R.RoleGate)
        c = TestClient(ns["app"])
        i = c.get("/api/role").json()
        self.assertTrue(i["needs_setup"] and i["effective"] == "friends" and "receipts" not in i["caps"])
        self.assertEqual([r["id"] for r in i["roles"]], ["ceo", "dev", "friends"])
        self.assertEqual(c.post("/api/role/select", json={"role": "ceo"}).status_code, 400)
        r = c.post("/api/role/select", json={"role": "ceo", "new_pin": "azerty"})
        self.assertEqual((r.status_code, r.json()["role"], "receipts" in r.json()["caps"]), (200, "ceo", True))
        self.assertEqual(c.post("/api/role/select", json={"role": "friends"}).json()["role"], "friends")
        self.assertEqual(c.post("/api/role/select", json={"role": "ceo", "pin": "faux"}).status_code, 400)
        self.assertEqual(c.post("/api/role/pin", json={"role": "ceo", "pin": "azerty", "new_pin": "qwerty"}).status_code, 200)
        self.assertEqual(ns["nasko_epita"]._mem, {})                                                  # les caches du profil précédent sont vidés au changement


if __name__ == "__main__":
    unittest.main()
