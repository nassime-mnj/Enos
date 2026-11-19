"""ETO Fleet : équipe créée par un compte ETO Ultra, invitations (code à usage limité), places (10), les membres profitent d'ETO Ultra tant que le
propriétaire est abonné, pouls des appareils + alertes, commandes à distance de la liste fermée (envoi, récupération, compte rendu, refus des autres).
Lancer : py tests/test_fleet.py"""
import os, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
TMP = tempfile.mkdtemp(prefix="fleet_")
os.environ.update(DP_DB=os.path.join(TMP, "t.db"), DP_ADMIN_TOKEN="jeton-test-123456", DP_ADMIN_PATH="admin-dp", DP_STORAGE_DIR=os.path.join(TMP, "store"))
from fastapi.testclient import TestClient  # noqa: E402
from app import db, main  # noqa: E402
from app.launcher import limits, service  # noqa: E402

E = "/launcher/v1/eto"; F = E + "/fleet"; V = "/launcher/v1"; PW = "Un-bon-mot-de-passe-42"


def fresh():
    db.reset(); os.environ["DP_DB"] = os.path.join(tempfile.mkdtemp(dir=TMP), "t.db"); service._key_cache.clear(); limits.reset()
    c = TestClient(main.app, client=("198.51.100.11", 5000))
    c.post("/admin-dp/api/launcher/ceo", headers={"X-Admin-Token": "jeton-test-123456"}, json={"email": "ceo@example.com", "password": PW})
    hc = {"Authorization": "Bearer " + c.post(V + "/auth/login", json={"email": "ceo@example.com", "password": PW}).json()["access_token"]}
    return c, hc


def user(c, mail):
    limits.reset()                                                                                # limite d'inscriptions par IP (6 / 10 min)
    return {"Authorization": "Bearer " + c.post(E + "/signup", json={"email": mail, "password": PW}).json()["access_token"]}


def test_team_lifecycle_and_seat_plan():
    c, hc = fresh(); ho = user(c, "boss@example.com"); hm = user(c, "ana@example.com"); hx = user(c, "x@example.com")
    assert c.post(F + "/team", headers=ho, json={"name": "Studio"}).status_code == 403          # Free : pas d'équipe
    c.post(E + "/admin/grant", headers=hc, json={"email": "boss@example.com", "plan": "eto_ultra", "days": 30})
    r = c.post(F + "/team", headers=ho, json={"name": "Studio"}); assert r.status_code == 200, r.text
    assert r.json()["team"]["name"] == "Studio" and r.json()["team"]["used"] == 1 and r.json()["team"]["seats"] == 10
    assert c.post(F + "/invite", headers=hm, json={}).status_code == 404                       # pas membre
    inv = c.post(F + "/invite", headers=ho, json={"max_uses": 1, "days": 7}).json(); assert inv["code"].startswith("ETO-TEAM-")
    assert c.get(E + "/me", headers=hm).json()["subscription"]["plan"] == "eto_free"
    r = c.post(F + "/join", headers=hm, json={"code": inv["code"].lower()}); assert r.status_code == 200, r.text
    me = c.get(E + "/me", headers=hm).json(); assert me["subscription"]["plan"] == "eto_ultra" and me["subscription"]["source"] == "team" and "fleet" in me["features"]
    assert c.post(F + "/join", headers=hx, json={"code": inv["code"]}).status_code == 410       # usage unique
    assert c.post(F + "/team", headers=hm, json={"name": "Autre"}).status_code in (403, 409)      # un membre ne crée pas d'équipe avec sa place
    # le propriétaire perd Ultra -> les membres aussi
    c.post(E + "/admin/revoke", headers=hc, json={"email": "boss@example.com"})
    assert c.get(E + "/me", headers=hm).json()["subscription"]["plan"] == "eto_free"
    assert c.get(F, headers=ho).json()["team"]["active"] is False
    c.post(E + "/admin/grant", headers=hc, json={"email": "boss@example.com", "plan": "eto_ultra", "days": 30})
    assert c.get(E + "/me", headers=hm).json()["subscription"]["plan"] == "eto_ultra"
    # retrait, départ, rôles
    r = c.post(F + "/member/role", headers=ho, json={"email": "ana@example.com", "role": "admin"}); assert r.status_code == 200
    assert c.post(F + "/member/remove", headers=hm, json={"email": "boss@example.com"}).status_code == 409
    r = c.post(F + "/member/remove", headers=ho, json={"email": "ana@example.com"}); assert r.status_code == 200 and r.json()["team"]["used"] == 1
    assert c.get(E + "/me", headers=hm).json()["subscription"]["plan"] == "eto_free"
    assert c.post(F + "/leave", headers=ho).status_code == 409


def test_seats_limit():
    c, hc = fresh(); ho = user(c, "boss@example.com")
    c.post(E + "/admin/grant", headers=hc, json={"email": "boss@example.com", "plan": "eto_ultra", "days": 30})
    c.post(F + "/team", headers=ho, json={"name": "Équipe"})
    code = c.post(F + "/invite", headers=ho, json={"max_uses": 20}).json()["code"]
    codes = [c.post(F + "/join", headers=user(c, "m%d@example.com" % i), json={"code": code}).status_code for i in range(10)]
    assert codes[:9] == [200] * 9 and codes[9] == 409                                            # 10 places, propriétaire compris


def test_health_alerts_and_commands():
    c, hc = fresh(); ho = user(c, "boss@example.com"); hm = user(c, "ana@example.com")
    c.post(E + "/admin/grant", headers=hc, json={"email": "boss@example.com", "plan": "eto_ultra", "days": 30})
    c.post(F + "/team", headers=ho, json={"name": "Studio"})
    c.post(F + "/join", headers=hm, json={"code": c.post(F + "/invite", headers=ho, json={}).json()["code"]})
    b = {"device_id": "dev-ana", "name": "Pixel d'Ana", "app_version": "1.98", "battery": 0.09, "charging": False, "storage_free": 2 * 2**30, "storage_total": 128 * 2**30, "crashes_24h": 2}
    assert c.post(F + "/beat", headers=hm, json=b).json()["commands"] == []
    c.post(F + "/beat", headers=ho, json={"device_id": "dev-boss", "name": "Galaxy", "app_version": "1.104", "storage_free": 60 * 2**30, "storage_total": 256 * 2**30})
    con = c.get(F, headers=ho).json()
    ana = [d for d in con["devices"] if d["device_id"] == "dev-ana"][0]
    kinds = {a["kind"] for a in ana["alerts"]}
    assert ana["online"] and kinds == {"storage", "battery", "crash", "version"}, ana["alerts"]
    assert c.get(F, headers=hm).json()["members"] == []                                           # un membre ne voit pas la console complète
    assert c.post(F + "/cmd", headers=ho, json={"email": "ana@example.com", "device_id": "dev-ana", "cmd": "shell", "args": {}}).status_code == 400
    assert c.post(F + "/cmd", headers=hm, json={"email": "boss@example.com", "device_id": "dev-boss", "cmd": "ping"}).status_code == 403
    r = c.post(F + "/cmd", headers=ho, json={"email": "ana@example.com", "device_id": "dev-ana", "cmd": "message", "args": {"text": "Mets à jour ETO", "x": 1}}); assert r.status_code == 200
    cmds = c.post(F + "/beat", headers=hm, json=b).json()["commands"]
    assert len(cmds) == 1 and cmds[0]["cmd"] == "message" and cmds[0]["args"] == {"text": "Mets à jour ETO"}
    assert c.post(F + "/cmd/%d/done" % cmds[0]["id"], headers=ho, json={"ok": True}).json()["ok"] is False   # seul l'appareil visé rend compte
    assert c.post(F + "/cmd/%d/done" % cmds[0]["id"], headers=hm, json={"ok": True, "result": "affiché"}).json()["ok"] is True
    assert c.post(F + "/beat", headers=hm, json=b).json()["commands"] == []
    assert c.get(F, headers=ho).json()["commands"][0]["status"] == "done"


if __name__ == "__main__":
    bad = 0
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            try:
                f(); print("OK ", n)
            except Exception as e:
                import traceback; traceback.print_exc(); bad += 1; print("ÉCHEC", n, repr(e))
    print("TOUT OK" if not bad else "%d ÉCHEC(S)" % bad); sys.exit(1 if bad else 0)
