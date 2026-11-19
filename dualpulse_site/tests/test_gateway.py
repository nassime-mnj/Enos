"""ETO Gateway : clés OpenRouter par client via l'API officielle de gestion (simulée ici par un faux OpenRouter en mémoire) — création, ROTATION si une
clé existe déjà, plafond par offre, consommation, désactivation quand l'offre ne l'inclut plus, honnêteté sans clé de gestion. Lancer : py tests/test_gateway.py"""
import os, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
TMP = tempfile.mkdtemp(prefix="gw_")
os.environ.update(DP_DB=os.path.join(TMP, "t.db"), DP_ADMIN_TOKEN="jeton-test-123456", DP_ADMIN_PATH="admin-dp", DP_STORAGE_DIR=os.path.join(TMP, "store"))
from fastapi.testclient import TestClient  # noqa: E402
from app import db, main  # noqa: E402
from app.launcher import gateway, limits, service  # noqa: E402

E = "/launcher/v1/eto"; V = "/launcher/v1"; PW = "Un-bon-mot-de-passe-42"


class FakeOR:
    """Faux OpenRouter : mêmes routes et formes de réponse que l'API de gestion des clés (POST/GET/PATCH/DELETE /keys)."""
    def __init__(self):
        self.keys, self.n, self.calls = {}, 0, []

    def __call__(self, method, path, body=None):
        gateway._mgmt(); self.calls.append((method, path))
        if method == "POST" and path == "/keys":
            self.n += 1; h = "h%03d" % self.n
            self.keys[h] = {"hash": h, "name": body["name"], "limit": body["limit"], "limit_reset": body.get("limit_reset"), "disabled": False, "usage": 0.25 * self.n, "limit_remaining": body["limit"] - 0.25 * self.n}
            return {"data": dict(self.keys[h]), "key": "sk-or-v1-%064d" % self.n}
        h = path.rsplit("/", 1)[-1]
        if h not in self.keys:
            return None
        if method == "GET":
            return {"data": dict(self.keys[h])}
        if method == "PATCH":
            self.keys[h].update(body); return {"data": dict(self.keys[h])}
        if method == "DELETE":
            del self.keys[h]; return {"deleted": True}


def fresh():
    db.reset(); os.environ["DP_DB"] = os.path.join(tempfile.mkdtemp(dir=TMP), "t.db"); service._key_cache.clear(); limits.reset()
    os.environ["DP_OPENROUTER_MGMT"] = "mgmt-test"
    fake = FakeOR(); gateway._or = fake
    c = TestClient(main.app, client=("198.51.100.9", 5000))
    c.post("/admin-dp/api/launcher/ceo", headers={"X-Admin-Token": "jeton-test-123456"}, json={"email": "ceo@example.com", "password": PW})
    hc = {"Authorization": "Bearer " + c.post(V + "/auth/login", json={"email": "ceo@example.com", "password": PW}).json()["access_token"]}
    h = {"Authorization": "Bearer " + c.post(E + "/signup", json={"email": "dev@example.com", "password": PW}).json()["access_token"]}
    return c, fake, hc, h


def test_free_plan_has_no_key():
    c, fake, hc, h = fresh()
    assert c.get(E + "/ai", headers=h).json()["allowed"] is False
    assert c.post(E + "/ai/key", headers=h).status_code == 403 and not fake.keys


def test_create_rotate_usage_and_downgrade():
    c, fake, hc, h = fresh()
    c.post(E + "/admin/grant", headers=hc, json={"email": "dev@example.com", "plan": "eto_max", "days": 30})
    r = c.post(E + "/ai/key", headers=h); assert r.status_code == 200, r.text
    k1 = r.json(); assert k1["key"].startswith("sk-or-v1-") and k1["limit_usd"] == 2.0 and not k1["rotated"]
    assert fake.keys["h001"]["limit"] == 2.0 and fake.keys["h001"]["limit_reset"] == "monthly"
    with db._lock:
        row = dict(db.conn().execute("SELECT * FROM eto_ai_keys").fetchone())
    assert "sk-or" not in str(row)                                               # la clé en clair n'est jamais stockée
    st = c.get(E + "/ai", headers=h).json(); assert st["key"]["usage_usd"] == 0.25 and st["key"]["remaining_usd"] == 1.75
    # une clé existe déjà -> supprimée chez OpenRouter puis recréée
    k2 = c.post(E + "/ai/key", headers=h).json()
    assert k2["rotated"] and k2["key"] != k1["key"] and list(fake.keys) == ["h002"] and ("DELETE", "/keys/h001") in fake.calls
    # passage à Ultra : plafond relevé ; révocation : clé désactivée
    c.post(E + "/admin/grant", headers=hc, json={"email": "dev@example.com", "plan": "eto_ultra", "days": 30})
    assert fake.keys["h002"]["limit"] == 25.0
    c.post(E + "/admin/revoke", headers=hc, json={"email": "dev@example.com"})
    assert fake.keys["h002"]["disabled"] is True and c.get(E + "/ai", headers=h).json()["key"]["disabled"] is True
    # retour en MAX : réactivée
    c.post(E + "/admin/grant", headers=hc, json={"email": "dev@example.com", "plan": "eto_max", "days": 30})
    assert fake.keys["h002"]["disabled"] is False and fake.keys["h002"]["limit"] == 2.0
    assert len(c.get(E + "/admin/ai", headers=hc).json()["keys"]) == 1
    assert c.delete(E + "/ai/key", headers=h).json()["deleted"] and not fake.keys


def test_not_configured_is_honest():
    c, fake, hc, h = fresh(); os.environ.pop("DP_OPENROUTER_MGMT")
    c.post(E + "/admin/grant", headers=hc, json={"email": "dev@example.com", "plan": "eto_max", "days": 30})
    r = c.post(E + "/ai/key", headers=h); assert r.status_code == 503 and "non configurée" in r.json()["detail"]
    assert c.get(E + "/ai", headers=h).json()["configured"] is False


def test_staff_and_rate_limit():
    c, fake, hc, h = fresh()
    assert c.post(E + "/ai/key", headers=hc).json()["limit_usd"] == 10.0          # éditions privées : plafond 10 $
    codes = [c.post(E + "/ai/key", headers=hc).status_code for _ in range(7)]
    assert codes[-1] == 429 and len(fake.keys) == 1                              # une seule clé vivante à la fois


if __name__ == "__main__":
    bad = 0
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            try:
                f(); print("OK ", n)
            except Exception as e:
                import traceback; traceback.print_exc(); bad += 1; print("ÉCHEC", n, repr(e))
    print("TOUT OK" if not bad else "%d ÉCHEC(S)" % bad); sys.exit(1 if bad else 0)
