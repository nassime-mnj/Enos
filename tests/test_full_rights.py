"""Droits complets d'un téléphone : le propriétaire les accorde DEPUIS LE PC ; la gestion de la confiance reste strictement locale.
Lancer : python tests/test_full_rights.py"""
import os
import re
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from fastapi import HTTPException  # noqa: E402

import nasko_core  # noqa: E402
import nasko_team  # noqa: E402

SRC = open(os.path.join(ROOT, "nasko_server.py"), encoding="utf-8").read()


class Req:
    def __init__(self, host, state=None):
        self.client = type("C", (), {"host": host})()
        self.scope = {"state": state or {}}


def _fn(name):
    m = re.search(r"^def %s\(.*?(?=^\S)" % name, SRC, re.S | re.M)
    ns = {"HTTPException": HTTPException, "Request": Req}
    exec("def is_local(request):\n    return (request.client.host if request.client else '') in ('127.0.0.1', '::1')\n" + m.group(0), ns)
    return ns[name]


class Gates(unittest.TestCase):
    def test_local_only_lets_pc_and_full_phone_in(self):
        f = _fn("local_only")
        f(Req("127.0.0.1"))                                             # le PC
        f(Req("192.168.1.20", {"full": True}))                          # téléphone aux droits complets
        for st in ({}, {"full": False}, {"edition": "dev"}):             # un simple appareil de confiance : non
            with self.assertRaises(HTTPException) as c:
                f(Req("192.168.1.20", st))
            self.assertEqual(c.exception.status_code, 403)

    def test_pc_strict_refuses_even_full_phones(self):
        f = _fn("pc_strict")
        f(Req("127.0.0.1"))
        with self.assertRaises(HTTPException):
            f(Req("192.168.1.20", {"full": True}))

    def test_trust_management_routes_stay_pc_only(self):
        for path in ("/api/devices", "/api/devices/{device_id}", "/api/devices/revoke-all", "/api/trusted-ips", "/api/security/pairing", "/api/security/rotate", "/api/security/config",
                     "/api/team/devices", "/api/team/devices/{uuid}", "/api/team/devices/{uuid}/full", "/api/pair/start", "/api/mirror/pair", "/api/network/toggle", "/api/role/pin", "/api/ota/install"):
            m = re.search(r'@app\.(?:get|post|delete|put)\("%s", dependencies=([^)\n]*\]|_\w+)\)' % re.escape(path), SRC)
            self.assertIsNotNone(m, path)
            self.assertIn("_PCONLY", m.group(1), path + " doit rester strictement local")

    def test_middleware_grants_full_only_to_trusted_dev_devices(self):
        self.assertIn('st["full"] = bool(authed and not local and st["edition"] == "dev" and nasko_team.is_full(uuid))', SRC)


class Store(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._dd = nasko_team.data_dir
        nasko_team.data_dir = lambda: self.tmp
        self.u = "0123456789abcdef0123"

    def tearDown(self):
        nasko_team.data_dir = self._dd

    def test_full_flag_lifecycle(self):
        self.assertFalse(nasko_team.set_full(self.u, True))              # appareil inconnu : refusé
        nasko_team.approve(self.u, "Mon Galaxy")
        self.assertFalse(nasko_team.is_full(self.u))                     # approuvé ≠ droits complets
        self.assertTrue(nasko_team.set_full(self.u, True))
        self.assertTrue(nasko_team.is_full(self.u))
        self.assertTrue(nasko_team.is_full(self.u.upper()))
        self.assertTrue([d for d in nasko_team.snapshot()["devices"] if d.get("full")])
        nasko_team.set_full(self.u, False)
        self.assertFalse(nasko_team.is_full(self.u))
        nasko_team.set_full(self.u, True)
        nasko_team.remove(self.u)                                        # révoqué : plus aucun droit
        self.assertFalse(nasko_team.is_full(self.u))
        self.assertFalse(nasko_team.is_full("zzz"))



class EndToEnd(unittest.TestCase):
    """Vraie application : un appareil distant approuvé n'agit sur le PC que si le propriétaire lui a donné les droits complets, et ne gère jamais la confiance."""

    def test_remote_device_gates(self):
        import nasko_security as sec
        import nasko_server as S
        from fastapi.testclient import TestClient
        tmp = tempfile.mkdtemp()
        old_dd, old_keys, old_net = nasko_team.data_dir, dict(sec._KEYS), S.state["network"]
        S.state["network"] = True                                                                     # accès réseau (téléphone) activé
        nasko_team.data_dir = lambda: tmp
        sec._KEYS.clear()
        sec._KEYS.update({"api": b"A" * 32, "enc": b"B" * 32})
        try:
            uuid = "abcdef0123456789abcdef"
            h = {"Authorization": "Bearer " + sec.api_key(), "X-Eto-Device": uuid}
            c = TestClient(S.app, base_url="http://192.168.1.10:8443", client=("192.168.1.50", 50000))
            nasko_team.approve(uuid, "Mon Galaxy")
            self.assertEqual(c.get("/api/files", headers=h).status_code, 403)                      # approuvé : pas encore de droits complets
            self.assertFalse(c.get("/api/status", headers=h).json()["full"])
            nasko_team.set_full(uuid, True)
            self.assertNotEqual(c.get("/api/files", headers=h).status_code, 403)                    # droits complets : la porte s'ouvre
            self.assertTrue(c.get("/api/status", headers=h).json()["full"])
            self.assertTrue(c.get("/api/mobile/pc", headers=h).json()["full"])
            for path in ("/api/team/devices", "/api/devices", "/api/security/pairing"):             # la confiance reste au PC
                self.assertEqual(c.get(path, headers=h).status_code, 403, path)
            self.assertEqual(c.post("/api/team/devices/%s/full" % uuid, json={"on": False}, headers=h).status_code, 403)   # un téléphone ne se retire / s'accorde rien
            nasko_team.remove(uuid)
            self.assertEqual(c.get("/api/files", headers=h).status_code, 403)                       # révoqué : fini
        finally:
            nasko_team.data_dir = old_dd
            S.state["network"] = old_net
            sec._KEYS.clear()
            sec._KEYS.update(old_keys)


if __name__ == "__main__":
    unittest.main()
