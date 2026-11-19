"""Comptes ETO grand public : inscription libre au rôle « public » (cloisonné du personnel), offres, licence signée vérifiable hors ligne,
webhook Stripe signé, offre accordée par un CEO, migration d'une base créée avant le rôle « public ». Lancer : py tests/test_eto.py"""
import hashlib, hmac, json, os, sqlite3, sys, tempfile, time
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
TMP = tempfile.mkdtemp(prefix="eto_")
os.environ.update(DP_DB=os.path.join(TMP, "t.db"), DP_ADMIN_TOKEN="jeton-test-123456", DP_ADMIN_PATH="admin-dp", DP_STORAGE_DIR=os.path.join(TMP, "store"))
from fastapi.testclient import TestClient  # noqa: E402
from app import db, main  # noqa: E402
from app.launcher import eto, limits, service, tokens  # noqa: E402

E = "/launcher/v1/eto"; V = "/launcher/v1"; PW = "Un-bon-mot-de-passe-42"


def fresh():
    db.reset(); os.environ["DP_DB"] = os.path.join(tempfile.mkdtemp(dir=TMP), "t.db"); service._key_cache.clear(); limits.reset()
    for k in ("DP_STRIPE_SECRET", "DP_STRIPE_WEBHOOK_SECRET"):
        os.environ.pop(k, None)
    return TestClient(main.app, client=("198.51.100.7", 5000))


def test_signup_is_public_and_walled_off():
    c = fresh()
    r = c.post(E + "/signup", json={"email": "ana@example.com", "password": PW, "name": "Ana"}); assert r.status_code == 200, r.text
    j = r.json(); assert j["role"] == "public"; h = {"Authorization": "Bearer " + j["access_token"]}
    me = c.get(E + "/me", headers=h).json(); assert me["subscription"]["plan"] == "eto_free" and "chess" in me["features"] and "improver_auto" not in me["features"]
    assert c.get(V + "/users", headers=h).status_code == 403                       # routes du personnel fermées
    assert c.post(V + "/invites", headers=h, json={"role": "friends"}).status_code == 403
    assert c.get(V + "/catalog", headers=h).status_code == 200
    assert c.post(E + "/signup", json={"email": "ANA@example.com", "password": PW}).status_code == 409


def test_license_is_signed_and_verifiable_offline():
    c = fresh(); j = c.post(E + "/signup", json={"email": "bo@example.com", "password": PW}).json(); h = {"Authorization": "Bearer " + j["access_token"]}
    lic = c.post(E + "/license", headers=h).json()
    claims = tokens.verify(lic["license"], tokens.public_from_b64(lic["public_key"]), typ="license")
    assert claims["plan"] == "eto_free" and claims["exp"] - claims["iat"] == 7 * 86400
    forged = lic["license"].rsplit(".", 1)[0] + "." + tokens.b64e(b"x" * 64)
    try:
        tokens.verify(forged, tokens.public_from_b64(lic["public_key"]), typ="license"); assert False
    except tokens.TokenError:
        pass


def test_payment_not_configured_is_honest():
    c = fresh(); j = c.post(E + "/signup", json={"email": "cy@example.com", "password": PW}).json(); h = {"Authorization": "Bearer " + j["access_token"]}
    r = c.post(E + "/billing/checkout", headers=h, json={"plan": "eto_pro", "period": "month"}); assert r.status_code == 503
    assert c.post(E + "/billing/stripe-webhook", content=b"{}").status_code == 400


def test_stripe_webhook_updates_subscription():
    c = fresh(); j = c.post(E + "/signup", json={"email": "di@example.com", "password": PW}).json(); h = {"Authorization": "Bearer " + j["access_token"]}; uid = j["user"]["id"]
    os.environ["DP_STRIPE_WEBHOOK_SECRET"] = "whsec_test"
    end = int(time.time()) + 30 * 86400
    ev = {"type": "customer.subscription.updated", "data": {"object": {"id": "sub_1", "customer": "cus_1", "status": "active", "current_period_end": end, "metadata": {"user_id": str(uid), "plan": "eto_max", "period": "month"}}}}
    body = json.dumps(ev).encode(); t = str(int(time.time()))
    sig = hmac.new(b"whsec_test", t.encode() + b"." + body, hashlib.sha256).hexdigest()
    assert c.post(E + "/billing/stripe-webhook", content=body, headers={"Stripe-Signature": "t=%s,v1=%s" % (t, "0" * 64)}).status_code == 400     # mauvaise signature
    old = str(int(time.time()) - 3600); osig = hmac.new(b"whsec_test", old.encode() + b"." + body, hashlib.sha256).hexdigest()
    assert c.post(E + "/billing/stripe-webhook", content=body, headers={"Stripe-Signature": "t=%s,v1=%s" % (old, osig)}).status_code == 400   # rejeu
    r = c.post(E + "/billing/stripe-webhook", content=body, headers={"Stripe-Signature": "t=%s,v1=%s" % (t, sig)}); assert r.status_code == 200 and r.json()["handled"]
    me = c.get(E + "/me", headers=h).json(); assert me["subscription"]["plan"] == "eto_max" and "pc_control" in me["features"] and "improver_auto" in me["features"] and "fleet" not in me["features"]
    ev["type"] = "customer.subscription.deleted"; body = json.dumps(ev).encode(); sig = hmac.new(b"whsec_test", t.encode() + b"." + body, hashlib.sha256).hexdigest()
    c.post(E + "/billing/stripe-webhook", content=body, headers={"Stripe-Signature": "t=%s,v1=%s" % (t, sig)})
    assert c.get(E + "/me", headers=h).json()["subscription"]["plan"] == "eto_free"


def test_ceo_grant_and_staff_editions():
    c = fresh(); A = {"X-Admin-Token": "jeton-test-123456"}
    assert c.post("/admin-dp/api/launcher/ceo", headers=A, json={"email": "ceo@example.com", "password": PW}).status_code == 200
    ceo = c.post(V + "/auth/login", json={"email": "ceo@example.com", "password": PW}).json(); hc = {"Authorization": "Bearer " + ceo["access_token"]}
    assert c.get(E + "/me", headers=hc).json()["subscription"]["plan"] == "enos_ceo"
    j = c.post(E + "/signup", json={"email": "pilot@example.com", "password": PW}).json(); h = {"Authorization": "Bearer " + j["access_token"]}
    assert c.post(E + "/admin/grant", headers=h, json={"email": "pilot@example.com", "plan": "eto_ultra"}).status_code == 403      # pas soi-même
    r = c.post(E + "/admin/grant", headers=hc, json={"email": "pilot@example.com", "plan": "eto_ultra", "days": 90}); assert r.status_code == 200, r.text
    me = c.get(E + "/me", headers=h).json(); assert me["subscription"]["plan"] == "eto_ultra" and me["subscription"]["seats"] == 10 and "fleet" in me["features"]


def test_old_database_is_migrated():
    db.reset(); p = os.path.join(tempfile.mkdtemp(dir=TMP), "old.db"); os.environ["DP_DB"] = p
    k = sqlite3.connect(p); k.execute("""CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL DEFAULT '', pw_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('friends','dev','ceo')), active INTEGER NOT NULL DEFAULT 1, created_at REAL NOT NULL, last_login REAL,
        token_version INTEGER NOT NULL DEFAULT 0, fails INTEGER NOT NULL DEFAULT 0, locked_until REAL NOT NULL DEFAULT 0,
        totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, totp_last INTEGER NOT NULL DEFAULT 0, invited_by INTEGER)""")
    k.execute("INSERT INTO users(email,pw_hash,role,created_at) VALUES('x@example.com','h','dev',1)"); k.commit(); k.close()
    db.conn(); service._key_cache.clear(); limits.reset()
    u = eto.signup("new@example.com", PW); assert u["role"] == "public"
    assert service.user_by_email("x@example.com")["role"] == "dev"


def _ceo(c):
    A = {"X-Admin-Token": "jeton-test-123456"}
    c.post("/admin-dp/api/launcher/ceo", headers=A, json={"email": "ceo@example.com", "password": PW})
    return {"Authorization": "Bearer " + c.post(V + "/auth/login", json={"email": "ceo@example.com", "password": PW}).json()["access_token"]}


def _public(c, mail):
    return {"Authorization": "Bearer " + c.post(E + "/signup", json={"email": mail, "password": PW}).json()["access_token"]}


def test_key_format_and_checksum():
    for _ in range(200):
        k = eto.new_code(); assert eto.valid_code(k) and eto.norm_code(eto.fmt_code(k).lower()) == k
    k = eto.new_code()
    for i in range(16):                                                            # TOUTE faute sur un caractère est détectée avant même d'interroger la base
        for ch in eto.ALPHA:
            if ch != k[i]:
                assert not eto.valid_code(k[:i] + ch + k[i + 1:]), (k, i, ch)
    assert eto.norm_code("0O1Il") == "00111" and eto.norm_code(" eto-" + k[:4] + " " + k[4:]) == k


def test_activation_keys_lifecycle():
    c = fresh(); hc = _ceo(c); h1 = _public(c, "k1@example.com"); h2 = _public(c, "k2@example.com"); h3 = _public(c, "k3@example.com")
    assert c.post(E + "/admin/keys", headers=h1, json={"plan": "eto_max", "days": 30}).status_code == 403          # réservé aux CEO
    r = c.post(E + "/admin/keys", headers=hc, json={"plan": "eto_max", "days": 30, "count": 3, "max_uses": 1, "note": "presse"}); assert r.status_code == 200, r.text
    codes = r.json()["codes"]; assert len(codes) == 3 and all(x.startswith("ETO-") and len(x) == 23 for x in codes)
    with db._lock:
        stored = [x["code_hash"] for x in db.conn().execute("SELECT code_hash FROM eto_keys").fetchall()]
    assert not any(x.replace("-", "")[3:] in "".join(stored) for x in codes)     # seule l'empreinte est gardée
    r = c.post(E + "/redeem", headers=h1, json={"code": codes[0].lower().replace("-", " ")}); assert r.status_code == 200, r.text
    lic = tokens.verify(r.json()["license"], service.signing_key().public_key(), typ="license"); assert lic["plan"] == "eto_max" and "pc_control" in lic["features"]
    end1 = r.json()["subscription"]["period_end"]; assert 29 * 86400 < end1 - time.time() <= 30 * 86400 + 5
    assert c.post(E + "/redeem", headers=h2, json={"code": codes[0]}).status_code == 410                        # une seule utilisation
    assert c.post(E + "/redeem", headers=h1, json={"code": codes[0]}).status_code == 409                        # déjà activée par ce compte
    r = c.post(E + "/redeem", headers=h1, json={"code": codes[1]}); assert r.status_code == 200                 # même offre : la durée s'ajoute
    assert r.json()["subscription"]["period_end"] - end1 > 29 * 86400
    assert c.post(E + "/redeem", headers=hc, json={"code": codes[2]}).status_code == 403                        # compte du personnel
    assert c.post(E + "/redeem", headers=h2, json={"code": "ETO-AAAA-BBBB-CCCC-DDDD"}).status_code in (400, 404)
    ks = c.get(E + "/admin/keys", headers=hc).json()["keys"]; assert [k["status"] for k in ks].count("used") == 2 and ks[0]["note"] == "presse"
    # offre supérieure déjà active : la clé n'est pas consommée
    pro = c.post(E + "/admin/keys", headers=hc, json={"plan": "eto_pro", "days": 30}).json()["codes"][0]
    assert c.post(E + "/redeem", headers=h1, json={"code": pro}).status_code == 409
    assert c.post(E + "/redeem", headers=h2, json={"code": pro}).status_code == 200
    # révocation d'une clé et des abonnements qu'elle a ouverts
    kid = [k for k in c.get(E + "/admin/keys", headers=hc).json()["keys"] if k["plan"] == "eto_pro"][0]["id"]
    assert c.post(E + "/admin/keys/revoke", headers=hc, json={"id": kid, "revoke_subs": True}).json()["subscriptions_stopped"] == 1
    assert c.get(E + "/me", headers=h2).json()["subscription"]["plan"] == "eto_free"
    assert c.post(E + "/redeem", headers=h3, json={"code": codes[2]}).status_code == 200
    fresh_key = c.post(E + "/admin/keys", headers=hc, json={"plan": "eto_ultra", "days": 7}).json()["codes"][0]
    kid = c.get(E + "/admin/keys", headers=hc).json()["keys"][0]["id"]
    c.post(E + "/admin/keys/revoke", headers=hc, json={"id": kid})
    r = c.post(E + "/redeem", headers=h2, json={"code": fresh_key}); assert r.status_code == 410 and "révoquée" in r.json()["detail"]
    # limite d'essais
    for _ in range(10):
        r = c.post(E + "/redeem", headers=h3, json={"code": "ETO-ZZZZ-ZZZZ-ZZZZ-ZZZZ"})
    assert r.status_code == 429


def test_ceo_revokes_subscription():
    c = fresh(); hc = _ceo(c); h = _public(c, "rv@example.com"); _public(c, "other@example.com")
    c.post(E + "/admin/grant", headers=hc, json={"email": "rv@example.com", "plan": "eto_ultra", "days": 90})
    subs = c.get(E + "/admin/subs?q=rv", headers=hc).json()["subscribers"]; assert len(subs) == 1 and subs[0]["plan"] == "eto_ultra"
    assert c.post(E + "/admin/revoke", headers=h, json={"email": "rv@example.com"}).status_code == 403
    r = c.post(E + "/admin/revoke", headers=hc, json={"email": "rv@example.com", "reason": "test"}); assert r.status_code == 200, r.text
    assert r.json()["previous"] == "eto_ultra" and r.json()["subscription"]["plan"] == "eto_free"
    lic = tokens.verify(c.post(E + "/license", headers=h).json()["license"], service.signing_key().public_key(), typ="license"); assert lic["plan"] == "eto_free"
    assert c.post(E + "/admin/revoke", headers=hc, json={"email": "rv@example.com"}).status_code == 409
    assert c.post(E + "/admin/revoke", headers=hc, json={"email": "ceo@example.com"}).status_code == 404       # le personnel ne se révoque pas ici
    assert len(c.get(E + "/admin/subs", headers=hc).json()["subscribers"]) == 2


if __name__ == "__main__":
    bad = 0
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            try:
                f(); print("OK ", n)
            except Exception as e:
                bad += 1; print("ÉCHEC", n, repr(e))
    print("TOUT OK" if not bad else "%d ÉCHEC(S)" % bad); sys.exit(1 if bad else 0)
