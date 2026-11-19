"""Statistiques anonymes (un rapport par installation et par jour, identifiant haché, modules filtrés) et tableau de bord du CEO. Lancer : py tests/test_metrics.py"""
import os, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
TMP = tempfile.mkdtemp(prefix="met_")
os.environ.update(DP_DB=os.path.join(TMP, "t.db"), DP_ADMIN_TOKEN="jeton-test-123456", DP_ADMIN_PATH="admin-dp", DP_STORAGE_DIR=os.path.join(TMP, "store"))
from fastapi.testclient import TestClient  # noqa: E402
from app import db, main  # noqa: E402
from app.launcher import limits, service  # noqa: E402

E = "/launcher/v1/eto"; V = "/launcher/v1"; PW = "Un-bon-mot-de-passe-42"


def test_metrics_and_dashboard():
    db.reset(); service._key_cache.clear(); limits.reset()
    c = TestClient(main.app, client=("198.51.100.21", 5000))
    c.post("/admin-dp/api/launcher/ceo", headers={"X-Admin-Token": "jeton-test-123456"}, json={"email": "ceo@example.com", "password": PW})
    hc = {"Authorization": "Bearer " + c.post(V + "/auth/login", json={"email": "ceo@example.com", "password": PW}).json()["access_token"]}
    hu = {"Authorization": "Bearer " + c.post(E + "/signup", json={"email": "a@example.com", "password": PW}).json()["access_token"]}
    c.post(E + "/signup", json={"email": "b@example.com", "password": PW})
    c.post(E + "/admin/grant", headers=hc, json={"email": "b@example.com", "plan": "eto_pro", "days": 30})
    inst = "a" * 32
    assert c.post(E + "/metrics", json={"install": inst, "version": "1.105", "plan": "eto_free", "modules": {"defis": 3, "plans": 1, "<script>": 5, "x": -2}}).status_code == 200
    assert c.post(E + "/metrics", json={"install": inst, "version": "1.105", "plan": "eto_free", "modules": {"defis": 4}}).status_code == 200   # même jour : remplacé
    assert c.post(E + "/metrics", json={"install": "b" * 32, "version": "1.104", "plan": "eto_pro", "modules": {"improver": 2}}).status_code == 200
    assert c.post(E + "/metrics", json={"install": "short"}).status_code == 422
    with db._lock:
        rows = [dict(x) for x in db.conn().execute("SELECT * FROM eto_metrics").fetchall()]
    assert len(rows) == 2 and all(inst not in r["install"] for r in rows) and "<script>" not in str(rows)
    assert c.get(E + "/admin/stats", headers=hu).status_code == 403
    s = c.get(E + "/admin/stats", headers=hc).json()
    assert s["plans"]["eto_free"] == 1 and s["plans"]["eto_pro"] == 1 and s["signups_30d"] == 2
    assert s["active_installs"][-1] == 2 and dict(s["top_modules"])["defis"] == 4 and s["mrr_eur"] == 0.0     # offre accordée : pas de revenu
    assert len(s["days"]) == 30 and sum(s["signups_daily"]) == 2


if __name__ == "__main__":
    try:
        test_metrics_and_dashboard(); print("OK  test_metrics_and_dashboard\nTOUT OK")
    except Exception as e:
        import traceback; traceback.print_exc(); print("ÉCHEC", repr(e)); sys.exit(1)
