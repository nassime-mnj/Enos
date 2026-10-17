"""Client cloud du PC (session, presse-papiers universel) contre le VRAI serveur Dual Pulse, et miroir scrcpy (adb / scrcpy simulés). Lancer : python tests/test_cloud_mirror.py"""
import base64
import json
import os
import sys
import tempfile
import threading
import time
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "dualpulse_site"))
TMP = tempfile.mkdtemp(prefix="cm_")
os.environ.update(DP_DB=os.path.join(TMP, "dp.db"), DP_ADMIN_TOKEN="jeton-admin-test-123", DP_ADMIN_PATH="admin-dp")
os.environ.pop("DP_DATABASE_URL", None)

import httpx  # noqa: E402
import uvicorn  # noqa: E402
import nasko_core  # noqa: E402
import nasko_cloud as CL  # noqa: E402
import nasko_mirror as MI  # noqa: E402

PORT, PW = 8809, "Un-bon-mot-de-passe-42"
URL = f"http://127.0.0.1:{PORT}"
_srv = {}


def setUpModule():
    from app import main                                        # dualpulse_site
    cfg = uvicorn.Config(main.app, host="127.0.0.1", port=PORT, log_level="warning")
    srv = uvicorn.Server(cfg)
    threading.Thread(target=srv.run, daemon=True).start()
    for _ in range(100):
        try:
            httpx.get(URL + "/healthz", timeout=1); break
        except httpx.HTTPError:
            time.sleep(0.1)
    _srv["s"] = srv
    adm = {"X-Admin-Token": "jeton-admin-test-123"}
    httpx.post(URL + "/admin-dp/api/launcher/ceo", json={"email": "ceo@dp.test", "password": PW}, headers=adm)
    ceo = httpx.post(URL + "/launcher/v1/auth/login", json={"email": "ceo@dp.test", "password": PW}).json()
    inv = httpx.post(URL + "/launcher/v1/invites", json={"role": "friends"}, headers={"Authorization": "Bearer " + ceo["access_token"]}).json()
    httpx.post(URL + "/launcher/v1/auth/register", json={"invite": inv["code"], "email": "moi@dp.test", "password": PW})


def tearDownModule():
    _srv["s"].should_exit = True


class FakeClip:
    def __init__(self):
        self.text, self.image, self.sensitive, self.n = None, None, False, 1

    def seq(self): return self.n
    def is_sensitive(self): return self.sensitive
    def get_text(self): return self.text
    def get_image_jpeg(self): return self.image
    def set_text(self, t): self.text, self.image = t, None; self.n += 1; return True
    def set_image(self, b): self.image, self.text = b, None; self.n += 1; return True
    def copy(self, t): self.text, self.image = t, None; self.n += 1            # l'utilisateur copie quelque chose


class CloudClient(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._d, self._p = nasko_core.data_dir, nasko_core.config_path
        nasko_core.data_dir = lambda: self.tmp
        nasko_core.config_path = lambda: os.path.join(self.tmp, "nasko_config.json")
        CL._access.update(token="", at=0.0)

    def tearDown(self):
        nasko_core.data_dir, nasko_core.config_path = self._d, self._p

    def login(self):
        st = CL.login(URL, "moi@dp.test", PW)
        for it in CL.request("GET", "/clipboard?limit=50")["items"]:                 # chaque test part d'un presse-papiers cloud vide
            CL.request("DELETE", f"/clipboard/{it['id']}")
        return st

    def test_login_keeps_a_session_but_never_the_password(self):
        st = self.login()
        self.assertTrue(st["logged_in"] and st["user"]["email"] == "moi@dp.test" and st["user"]["role"] == "friends")
        raw = open(nasko_core.config_path(), encoding="utf-8").read()
        self.assertNotIn(PW, raw)
        self.assertIn("cloud_refresh", raw)
        with self.assertRaises(CL.CloudError) as e:
            CL.login(URL, "moi@dp.test", "mauvais-mot-de-passe")
        self.assertEqual(e.exception.status, 401)
        with self.assertRaises(CL.CloudError):
            CL.configure("http://exemple.com")                                        # http distant refusé
        with self.assertRaises(CL.CloudError):
            CL.login("ftp://x", "a@b.fr", PW)

    def test_expired_access_token_is_renewed_transparently_and_rotates_the_refresh_token(self):
        self.login()
        r1 = nasko_core.load_config()["cloud_refresh"]
        CL._access.update(token="jeton-invalide", at=time.time())                      # le jeton d'accès est rejeté par le serveur
        CL.request("GET", "/devices")
        self.assertNotEqual(nasko_core.load_config()["cloud_refresh"], r1)            # jeton de rafraîchissement renouvelé (rotation)
        CL.logout()
        self.assertFalse(CL.status()["logged_in"])
        with self.assertRaises(CL.CloudError):
            CL.request("GET", "/devices")

    def test_sync_is_off_by_default_and_each_direction_is_opt_in(self):
        self.login()
        clip, s = FakeClip(), None
        s = CL.ClipSync(clip)
        clip.copy("secret copié sur le PC")
        s.tick()
        s.tick()
        self.assertEqual(CL.request("GET", "/clipboard")["items"], [])                # rien n'est envoyé tant que rien n'est activé
        self.assertFalse(CL.status()["clip_up"] or CL.status()["clip_down"])

    def test_up_down_anti_echo_sensitive_and_limits(self):
        self.login()
        clip = FakeClip(); s = CL.ClipSync(clip)
        CL.set_sync(up=True, down=True); CL.sync.stop()                                 # active les deux sens, mais pilote la boucle à la main
        s.tick()                                                                        # 1er passage : référence de l'état courant
        clip.copy("https://exemple.fr/pc")
        s.tick()
        items = CL.request("GET", "/clipboard")["items"]
        self.assertEqual([(i["kind"], i["content"], i["device"]) for i in items], [("text", "https://exemple.fr/pc", "pc")])
        s.tick(); s.tick()
        self.assertEqual(len(CL.request("GET", "/clipboard")["items"]), 1)             # pas de renvoi (anti-écho)
        CL.request("POST", "/clipboard", {"kind": "text", "content": "venu du téléphone", "device": "phone"})
        s.tick()
        self.assertEqual(clip.text, "venu du téléphone")                                # cloud -> PC
        s.tick(); s.tick()
        self.assertEqual(len(CL.request("GET", "/clipboard")["items"]), 2)             # ce qu'on vient d'écrire n'est pas renvoyé au cloud
        clip.sensitive = True; clip.copy("mot-de-passe-du-gestionnaire"); s.tick()
        self.assertNotIn("mot-de-passe-du-gestionnaire", json.dumps(CL.request("GET", "/clipboard")["items"]))   # contenu « à exclure » : jamais envoyé
        clip.sensitive = False; clip.copy("x" * 100_001); s.tick()
        self.assertEqual(len(CL.request("GET", "/clipboard")["items"]), 2)             # trop long : ignoré
        img = b"\xff\xd8\xff" + b"0" * 300
        clip.n += 1; clip.text = None; clip.image = img; s.tick()
        last = CL.request("GET", "/clipboard")["items"][0]
        self.assertEqual((last["kind"], base64.b64decode(last["content"])), ("image", img))
        CL.request("POST", "/clipboard", {"kind": "image", "mime": "image/png", "content": base64.b64encode(b"\x89PNG" + b"1" * 90).decode(), "device": "phone"})
        s.tick()
        self.assertTrue(clip.image and clip.image.startswith(b"\x89PNG"))              # image cloud -> PC

    def test_first_pass_does_not_apply_history_and_directions_are_independent(self):
        self.login()
        CL.request("POST", "/clipboard", {"kind": "text", "content": "ancien", "device": "phone"})
        clip = FakeClip(); s = CL.ClipSync(clip)
        CL.set_sync(up=False, down=True); CL.sync.stop()
        s.tick()
        self.assertIsNone(clip.text)                                                    # l'historique n'est pas appliqué au 1er passage
        CL.request("POST", "/clipboard", {"kind": "text", "content": "nouveau", "device": "phone"})
        s.tick()
        self.assertEqual(clip.text, "nouveau")
        clip.copy("local"); s.tick()
        self.assertNotIn("local", json.dumps(CL.request("GET", "/clipboard")["items"]))   # « up » désactivé : rien ne part

    def test_agenda_sync_two_ways_with_the_pc_agenda(self):
        import nasko_agenda as AG
        self.login()
        t = AG.add_task("Rendre le rapport", "2026-10-21T10:00")
        r = CL.agenda_sync()
        self.assertEqual(r["sent"], 1)
        CL.request("POST", "/agenda/sync", {"since": 0, "tasks": [{"id": "phonetask1", "title": "Tâche du téléphone", "due": "2026-10-22T09:00", "updated": time.time()}]})
        r = CL.agenda_sync()
        self.assertEqual(r["received"], 1)
        self.assertIn("Tâche du téléphone", [x["title"] for x in AG.list_tasks()])             # cloud -> PC
        AG.update_task(t["id"], done=True)
        CL.agenda_sync()
        got = {x["id"]: x for x in CL.request("POST", "/agenda/sync", {"since": 0, "tasks": []})["tasks"]}
        self.assertTrue(got[t["id"]]["done"])                                                      # PC -> cloud
        AG.delete_task(t["id"]); CL.agenda_sync()
        got = {x["id"]: x for x in CL.request("POST", "/agenda/sync", {"since": 0, "tasks": []})["tasks"]}
        self.assertTrue(got[t["id"]].get("deleted"))                                               # la suppression se propage

    def test_devices_of_the_account(self):
        self.login()
        CL.request("POST", "/devices/beat", {"device_id": "pixel-abc123", "name": "Pixel", "lan_ips": ["192.168.1.40"], "adb_port": 40123})
        d = CL.devices()
        self.assertEqual((d[0]["name"], d[0]["lan_ips"], d[0]["adb_port"], d[0]["online"]), ("Pixel", ["192.168.1.40"], 40123, True))


class Mirror(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._d, self._p = nasko_core.data_dir, nasko_core.config_path
        nasko_core.data_dir = lambda: self.tmp
        nasko_core.config_path = lambda: os.path.join(self.tmp, "nasko_config.json")
        self.adb, self.scr = os.path.join(self.tmp, "adb"), os.path.join(self.tmp, "scrcpy")
        for f in (self.adb, self.scr):
            open(f, "w").write("")
        MI._proc["p"] = None
        MI.S.update(state="off", detail="", target="")

    def tearDown(self):
        nasko_core.data_dir, nasko_core.config_path = self._d, self._p

    def cfg(self, **kw):
        nasko_core.update_config({"adb_path": self.adb, "scrcpy_path": self.scr, **kw})

    class P:
        def __init__(self, code=None): self.code, self.terminated = code, False
        def poll(self): return self.code
        def terminate(self): self.terminated = True; self.code = 0
        def wait(self, t=None): return 0

    def test_mdns_parsing_and_validation(self):
        txt = "List of discovered mdns services\nadb-ABC123\t_adb-tls-connect._tcp.\t192.168.1.44:38041\nadb-X\t_adb-tls-pairing._tcp.\t192.168.1.44:40001\nadb-Y\t_adb-tls-connect._tcp.\t999.1.1.1:5555\n"
        self.assertEqual(MI.parse_mdns(txt), [("192.168.1.44", 38041)])                 # pairing ignoré, IP invalide rejetée
        self.assertFalse(MI.valid_target("192.168.1.1; rm -rf /", 5555) or MI.valid_target("1.2.3.4", 0) or MI.valid_target("1.2.3.4", 70000))

    def test_candidates_order_dedupe_and_offline_devices(self):
        self.cfg(mirror_host="192.168.1.10", mirror_port=5555)
        devs = [{"online": True, "adb_port": 41000, "lan_ips": ["192.168.1.10", "10.0.0.7", "pas-une-ip"]}, {"online": False, "adb_port": 5555, "lan_ips": ["192.168.1.99"]}]
        c = MI.candidates(nasko_core.load_config(), devs, "")
        self.assertEqual(c, [("192.168.1.10", 5555, "manuel"), ("192.168.1.10", 41000, "cloud"), ("10.0.0.7", 41000, "cloud")])

    def test_connect_and_start_runs_adb_connect_then_scrcpy_with_safe_arguments(self):
        self.cfg()
        calls, spawned = [], []

        def run_(cmd, t=15):
            calls.append(cmd)
            return 0, "connected to 192.168.1.40:41000" if cmd[1] == "connect" else ""
        popen = lambda args, **k: (spawned.append(args), self.P())[1]                 # noqa: E731
        t = MI.connect_and_start([{"online": True, "adb_port": 41000, "lan_ips": ["192.168.1.40"]}], run_=run_, popen=popen)
        self.assertEqual(t, "192.168.1.40:41000")
        self.assertIn([self.adb, "connect", "192.168.1.40:41000"], calls)
        a = spawned[0]
        self.assertEqual(a[0], self.scr)
        self.assertIn("--serial", a); self.assertEqual(a[a.index("--serial") + 1], "192.168.1.40:41000")
        self.assertIn(MI.TITLE, a)
        self.assertEqual(MI.status()["state"], "running")
        self.assertEqual(MI.connect_and_start([], run_=run_, popen=popen), "192.168.1.40:41000")      # déjà lancé : pas de 2e fenêtre
        self.assertEqual(len(spawned), 1)
        MI.stop(); self.assertEqual(MI.status()["state"], "off")

    def test_failures_are_explained_and_next_candidate_is_tried(self):
        MI.set_state("off")
        nasko_core.update_config({"adb_path": "", "scrcpy_path": ""})
        old = MI.find_tool; MI.find_tool = lambda n, c="": ""
        try:
            with self.assertRaises(MI.MirrorError) as e: MI.connect_and_start([])
            self.assertIn("ADB", str(e.exception))
        finally:
            MI.find_tool = old
        self.cfg()
        with self.assertRaises(MI.MirrorError) as e: MI.connect_and_start([], run_=lambda c, t=15: (0, ""))
        self.assertIn("introuvable", str(e.exception))                                  # aucun téléphone
        devs = [{"online": True, "adb_port": 1111, "lan_ips": ["10.0.0.1"]}, {"online": True, "adb_port": 2222, "lan_ips": ["10.0.0.2"]}]
        run_ = lambda cmd, t=15: (0, "failed to connect" if "10.0.0.1:1111" in cmd else "connected to 10.0.0.2:2222")       # noqa: E731
        self.assertEqual(MI.connect_and_start(devs, run_=run_, popen=lambda a, **k: self.P()), "10.0.0.2:2222")          # 1re cible morte, 2e OK
        MI.stop()
        with self.assertRaises(MI.MirrorError) as e: MI.connect_and_start(devs, run_=lambda c, t=15: (0, "connected"), popen=lambda a, **k: self.P(code=1))
        self.assertIn("s'est arrêté", str(e.exception))                                # scrcpy quitte aussitôt (téléphone non autorisé)

    def test_pairing_validates_input(self):
        self.cfg()
        for bad in (("192.168.1.2", 3000, "12345"), ("x", 3000, "123456"), ("192.168.1.2", 0, "123456")):
            with self.assertRaises(MI.MirrorError): MI.pair(*bad)
        old = MI.run
        MI.run = lambda cmd, t=15: (0, "Successfully paired to 192.168.1.2:3000")
        try: self.assertTrue(MI.pair("192.168.1.2", 3000, "123456"))
        finally: MI.run = old

    def test_auto_loop_is_silent_when_disabled_and_cooldown_after_user_closes(self):
        self.cfg(mirror_auto=False)
        calls = []
        MI.connect_and_start, orig = (lambda cd=None, **k: calls.append(1) or "x"), MI.connect_and_start
        ow = MI._stop.wait
        MI._stop.wait = lambda t=None: (time.sleep(0.02), MI._stop.is_set())[1]     # accélère les attentes
        try:
            MI._stop.clear(); MI._thread["t"] = None
            MI.autostart(None)
            time.sleep(0.3); self.assertEqual(calls, [])                                # désactivé : aucune tentative
            self.cfg(mirror_auto=True); time.sleep(0.4)
            self.assertGreaterEqual(len(calls), 1)                                      # activé : il se lance
        finally:
            MI._stop.set(); time.sleep(0.2); MI._stop.wait = ow; MI.connect_and_start = orig; MI._thread["t"] = None


class Routes(unittest.TestCase):
    def test_new_routes_are_role_gated(self):
        import nasko_roles as R
        for path in ("/api/cloud/status", "/api/cloud/sync"):
            self.assertTrue(R.allowed("friends", path)[0], path)                       # le presse-papiers est un utilitaire : Friends aussi
        for path in ("/api/mirror/status", "/api/mirror/start", "/api/mirror/pair"):
            self.assertFalse(R.allowed("friends", path)[0], path)                      # le miroir d'écran : CEO / Dev seulement
            self.assertTrue(R.allowed("dev", path)[0] and R.allowed("ceo", path)[0], path)


if __name__ == "__main__":
    unittest.main(verbosity=1)
