"""Tests du backend Dual Pulse Launcher (/launcher/v1). Lancer :  py tests/test_launcher.py   (ou : py -m pytest -q)"""
import base64
import hashlib
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
TMP = tempfile.mkdtemp(prefix="dpl_")
ADM = {"X-Admin-Token": "jeton-test-123456"}
os.environ.update(DP_DB=os.path.join(TMP, "t.db"), DP_ADMIN_TOKEN="jeton-test-123456", DP_ADMIN_PATH="admin-dp", DP_STORAGE_DIR=os.path.join(TMP, "store"))
os.makedirs(os.environ["DP_STORAGE_DIR"], exist_ok=True)

from fastapi.testclient import TestClient  # noqa: E402
from app import db, main  # noqa: E402
from app.launcher import accounts, limits, manifests, service, storage, tokens  # noqa: E402

MPRIV = tokens.new_private()
os.environ["DP_MANIFEST_PUBKEY"] = tokens.public_b64(MPRIV)
V = "/launcher/v1"
PW = "Un-bon-mot-de-passe-42"


def fresh():
    """Base vierge + clés vierges + compteurs vierges pour chaque test."""
    db.reset()
    if db.database_url():                                   # PostgreSQL (DP_DATABASE_URL) : schéma vierge à chaque test
        db.conn().execute("DROP SCHEMA public CASCADE"); db.conn().execute("CREATE SCHEMA public"); db.conn().commit(); db.reset()
    os.environ["DP_DB"] = os.path.join(tempfile.mkdtemp(dir=TMP), "t.db")
    service._key_cache.clear()
    limits.reset()
    os.environ.pop("DP_REQUIRE_CEO_TOTP", None)
    os.environ.pop("DP_R2_ENDPOINT", None)
    return TestClient(main.app, client=("198.51.100.9", 5000))


def H(tok):
    return {"Authorization": "Bearer " + tok}


def make_ceo(c, email="ceo@dualpulse.test"):
    r = c.post(main.ADMIN_PATH + "/api/launcher/ceo", json={"email": email, "password": PW}, headers=ADM)
    assert r.status_code == 200, r.text
    return login(c, email)


def login(c, email, pw=PW, **kw):
    r = c.post(V + "/auth/login", json={"email": email, "password": pw, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def invited(c, ceo, role="friends", email="ami@x.fr"):
    inv = c.post(V + "/invites", json={"role": role}, headers=H(ceo["access_token"])).json()
    r = c.post(V + "/auth/register", json={"invite": inv["code"], "email": email, "password": PW})
    assert r.status_code == 200, r.text
    return r.json()


def manifest(product="enos", channel="stable", version="1.0.0", files=None):
    return {"product": product, "channel": channel, "version": version, "released": "2026-10-20", "notes": "Patch notes", "min_launcher": "1.0.0", "launch": "ENOS.exe",
            "files": files or [{"path": "ENOS.exe", "sha256": "a" * 64, "size": 11, "key": f"{product}/{channel}/{version}/ENOS.exe"}]}


def publish(c, m, priv=MPRIV, sig=None):
    return c.post(main.ADMIN_PATH + "/api/launcher/releases", json={"manifest": m, "signature": sig or manifests.sign(priv, m)}, headers=ADM)


# ---------------------------------------------------------------- briques
def test_tokens_roundtrip_tamper_expiry_and_alg_none():
    k = tokens.new_private()
    t = tokens.issue(k, sub=7, role="dev")
    c = tokens.verify(t, k.public_key())
    assert (c["sub"], c["role"], c["typ"]) == ("7", "dev", "access")
    h, p, s = t.split(".")
    forged = tokens.b64e(b'{"alg":"none","typ":"JWT"}') + "." + p + "."
    for bad in (forged, h + "." + tokens.b64e(b'{"sub":"1","role":"ceo","typ":"access","iss":"dualpulse","exp":9999999999}') + "." + s, t[:-3] + "AAA", "x.y", ""):
        try:
            tokens.verify(bad, k.public_key()); assert False, bad
        except tokens.TokenError:
            pass
    try:
        tokens.verify(t, tokens.new_private().public_key()); assert False
    except tokens.TokenError:
        pass
    old = tokens.issue(k, sub=1, role="friends", now=time.time() - 3600)
    try:
        tokens.verify(old, k.public_key()); assert False
    except tokens.TokenError as e:
        assert "expir" in str(e)
    try:
        tokens.verify(tokens.issue(k, sub=1, role="friends", typ="attest"), k.public_key(), typ="access"); assert False     # un jeton d'un type ne vaut pas pour l'autre
    except tokens.TokenError:
        pass


def test_password_policy_hash_and_timing_dummy():
    for bad in ("court", "motdepasse1", "aaaaaaaaaaaa", "ami@x.fr"):
        try:
            accounts.check_password(bad, "ami@x.fr"); assert False, bad
        except ValueError:
            pass
    accounts.check_password(PW)
    h = accounts.hash_password(PW)
    assert h.startswith("scrypt$") and accounts.verify_password(PW, h) and not accounts.verify_password(PW + "x", h)
    assert not accounts.verify_password(PW, "nimporte") and accounts.hash_password(PW) != h          # sel aléatoire
    accounts.dummy_verify("x")


def test_totp_rfc6238_vector_and_replay():
    secret = base64.b32encode(b"12345678901234567890").decode().rstrip("=")
    assert accounts.totp_at(secret, 1) == "287082"                           # vecteur de test RFC 6238 (T=59 s)
    assert accounts.totp_check(secret, "287082", 0, now=59) == 1
    assert accounts.totp_check(secret, "287082", 1, now=59) is None            # même code rejoué
    assert accounts.totp_check(secret, "000000", 0, now=59) is None
    assert accounts.totp_check(secret, "28708", 0, now=59) is None
    assert accounts.totp_check(secret, "287082", 0, now=59 + 30 * 5) is None   # trop ancien


def test_sigv4_presign_matches_aws_reference_vector():
    u = storage.presign_get(endpoint="https://s3.amazonaws.com", bucket="examplebucket", key="test.txt", access_key="AKIAIOSFODNN7EXAMPLE",
                            secret_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", expires=86400, region="us-east-1", now=datetime(2013, 5, 24, tzinfo=timezone.utc), virtual_host=True)
    assert "X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404" in u


def test_manifest_signature_and_validation():
    m = manifest()
    sig = manifests.sign(MPRIV, m)
    assert manifests.verify(MPRIV.public_key(), m, sig)
    assert manifests.verify(MPRIV.public_key(), dict(reversed(list(m.items()))), sig)        # l'ordre des clés ne compte pas (JSON canonique)
    assert not manifests.verify(MPRIV.public_key(), {**m, "version": "9.9.9"}, sig)
    assert not manifests.verify(tokens.new_private().public_key(), m, sig)
    assert not manifests.verify(MPRIV.public_key(), m, "pas-du-base64")
    for bad in ({**m, "product": "x"}, {**m, "channel": "ceo", "product": "terna"}, {**m, "version": "latest"}, {**m, "files": []}, {**m, "launch": "autre.exe"},
                {**m, "files": [{**m["files"][0], "path": "../evil.exe"}]}, {**m, "files": [{**m["files"][0], "path": "/etc/passwd"}]},
                {**m, "files": [{**m["files"][0], "sha256": "zz"}]}, {**m, "files": [{**m["files"][0], "key": "a/../../b"}]}, {**m, "files": [{**m["files"][0], "size": -1}]}):
        try:
            manifests.validate(bad); assert False, bad
        except ValueError:
            pass


# ---------------------------------------------------------------- comptes, invitations, rôles
def test_no_free_registration_and_ceo_only_via_admin_token():
    c = fresh()
    assert c.post(V + "/auth/register", json={"invite": "DP-inconnu", "email": "a@b.fr", "password": PW}).status_code == 400
    assert c.post(V + "/auth/register", json={"invite": "", "email": "a@b.fr", "password": PW}).status_code == 400
    assert c.post(main.ADMIN_PATH + "/api/launcher/ceo", json={"email": "c@d.fr", "password": PW}).status_code in (401, 404)          # sans jeton d'admin
    ceo = make_ceo(c)
    assert ceo["role"] == "ceo" and ceo["mfa_setup_required"] is True
    assert c.post(main.ADMIN_PATH + "/api/launcher/ceo", json={"email": "autre@d.fr", "password": PW}, headers=ADM).status_code == 409     # un seul bootstrap


def test_invite_flow_single_use_expiry_revocation_and_no_ceo_invite():
    c = fresh()
    ceo = make_ceo(c)
    T = H(ceo["access_token"])
    assert c.post(V + "/invites", json={"role": "ceo"}, headers=T).status_code == 400            # une invitation ne crée jamais un CEO
    assert c.post(V + "/invites", json={"role": "friends", "days": 0}, headers=T).status_code == 400
    inv = c.post(V + "/invites", json={"role": "friends", "days": 3, "note": "Léo"}, headers=T).json()
    s = c.post(V + "/auth/register", json={"invite": inv["code"], "email": "Leo@X.fr", "password": PW, "name": "Léo", "role": "ceo"})
    assert s.status_code == 200 and s.json()["role"] == "friends"                                   # le champ « role » envoyé par l'inscrit est ignoré
    assert c.post(V + "/auth/register", json={"invite": inv["code"], "email": "autre@x.fr", "password": PW}).status_code == 400   # usage unique
    login(c, "leo@x.fr")                                                                             # e-mail insensible à la casse
    inv2 = c.post(V + "/invites", json={"role": "dev"}, headers=T).json()
    iid = [i for i in c.get(V + "/invites", headers=T).json()["items"] if not i["used_by"]][0]["id"]
    assert c.delete(V + f"/invites/{iid}", headers=T).status_code == 200
    assert c.post(V + "/auth/register", json={"invite": inv2["code"], "email": "d@x.fr", "password": PW}).status_code == 400      # révoquée
    inv3 = c.post(V + "/invites", json={"role": "dev"}, headers=T).json()
    db.conn().execute("UPDATE invites SET expires_at=? WHERE code_hash=?", (time.time() - 1, accounts.digest(inv3["code"]))); db.conn().commit()
    assert c.post(V + "/auth/register", json={"invite": inv3["code"], "email": "e@x.fr", "password": PW}).status_code == 400      # expirée
    assert c.post(V + "/auth/register", json={"invite": c.post(V + "/invites", json={"role": "friends"}, headers=T).json()["code"], "email": "f@x.fr", "password": "court"}).status_code == 400
    assert "code_hash" not in c.get(V + "/invites", headers=T).text and inv["code"] not in c.get(V + "/invites", headers=T).text      # le code n'est montré qu'une fois


def test_role_hierarchy_enforced_on_every_management_route():
    c = fresh()
    ceo = make_ceo(c)
    friend, dev = invited(c, ceo, "friends", "f@x.fr"), invited(c, ceo, "dev", "d@x.fr")
    routes = [("post", "/invites", {"role": "friends"}), ("get", "/invites", None), ("delete", "/invites/1", None), ("get", "/users", None), ("patch", "/users/1", {"role": "dev"}),
              ("post", "/users/1/revoke-sessions", None), ("put", "/products/terna/status", {"status": "alpha"})]
    for who in (friend, dev):
        for m, p, body in routes:
            r = getattr(c, m)(V + p, headers=H(who["access_token"]), **({"json": body} if body is not None else {}))
            assert r.status_code == 403, (who["role"], m, p, r.status_code)
    for m, p, body in routes:                                                       # sans jeton : 401
        r = getattr(c, m)(V + p, **({"json": body} if body is not None else {}))
        assert r.status_code == 401, (m, p)
    assert c.get(V + "/me", headers={"Authorization": "Basic abc"}).status_code == 401
    assert c.get(V + "/me", headers=H("n.importe.quoi")).status_code == 401
    assert c.get(V + "/me", headers=H(dev["access_token"])).json()["role"] == "dev"


def test_login_failures_lockout_and_generic_errors():
    c = fresh()
    ceo = make_ceo(c)
    invited(c, ceo, "friends", "f@x.fr")
    a = c.post(V + "/auth/login", json={"email": "f@x.fr", "password": "mauvais-mot-de-passe"})
    b = c.post(V + "/auth/login", json={"email": "inconnu@x.fr", "password": "mauvais-mot-de-passe"})
    assert a.status_code == b.status_code == 401 and a.json() == b.json()                 # même réponse : pas de découverte de comptes
    for _ in range(4):
        c.post(V + "/auth/login", json={"email": "f@x.fr", "password": "mauvais-mot-de-passe"})
    r = c.post(V + "/auth/login", json={"email": "f@x.fr", "password": PW})
    assert r.status_code == 429                                                             # verrouillé : même le bon mot de passe est refusé
    db.conn().execute("UPDATE users SET locked_until=0 WHERE email='f@x.fr'"); db.conn().commit()
    assert c.post(V + "/auth/login", json={"email": "f@x.fr", "password": PW}).status_code == 200


def test_ip_rate_limit_on_login_and_register():
    c = fresh()
    codes = [c.post(V + "/auth/login", json={"email": "x@y.fr", "password": "mauvais-mot-de-passe"}).status_code for _ in range(14)]
    assert codes[0] == 401 and codes[-1] == 429
    limits.reset()
    codes = [c.post(V + "/auth/register", json={"invite": "DP-x", "email": "x@y.fr", "password": PW}).status_code for _ in range(10)]
    assert codes[0] == 400 and codes[-1] == 429


def test_refresh_rotation_reuse_detection_and_logout():
    c = fresh()
    ceo = make_ceo(c)
    f = invited(c, ceo, "friends", "f@x.fr")
    r1 = c.post(V + "/auth/refresh", json={"refresh_token": f["refresh_token"]})
    assert r1.status_code == 200 and r1.json()["refresh_token"] != f["refresh_token"]
    assert c.post(V + "/auth/refresh", json={"refresh_token": f["refresh_token"]}).status_code == 401        # l'ancien jeton rejoué : refusé…
    assert c.post(V + "/auth/refresh", json={"refresh_token": r1.json()["refresh_token"]}).status_code == 401    # …et toute la famille est révoquée
    s = login(c, "f@x.fr")
    c.post(V + "/auth/logout", json={"refresh_token": s["refresh_token"]})
    assert c.post(V + "/auth/refresh", json={"refresh_token": s["refresh_token"]}).status_code == 401
    assert c.post(V + "/auth/refresh", json={"refresh_token": "n-importe-quoi"}).status_code == 401
    s2 = login(c, "f@x.fr")
    db.conn().execute("UPDATE refresh_tokens SET expires_at=? WHERE token_hash=?", (time.time() - 1, accounts.digest(s2["refresh_token"]))); db.conn().commit()
    assert c.post(V + "/auth/refresh", json={"refresh_token": s2["refresh_token"]}).status_code == 401


def test_role_change_disable_and_logout_all_take_effect_immediately():
    c = fresh()
    ceo = make_ceo(c)
    T = H(ceo["access_token"])
    d = invited(c, ceo, "dev", "d@x.fr")
    uid = d["user"]["id"]
    assert c.get(V + "/me", headers=H(d["access_token"])).status_code == 200
    assert c.patch(V + f"/users/{uid}", json={"role": "ceo"}, headers=T).status_code == 400            # on n'attribue pas « ceo » par l'API
    assert c.patch(V + f"/users/{uid}", json={"role": "friends"}, headers=T).json()["role"] == "friends"
    assert c.get(V + "/me", headers=H(d["access_token"])).status_code == 401                           # ancien jeton (rôle dev) mort tout de suite
    assert c.post(V + "/auth/refresh", json={"refresh_token": d["refresh_token"]}).status_code == 401
    d2 = login(c, "d@x.fr")
    assert d2["role"] == "friends"
    c.patch(V + f"/users/{uid}", json={"active": False}, headers=T)
    assert c.post(V + "/auth/login", json={"email": "d@x.fr", "password": PW}).status_code == 403
    assert c.patch(V + f"/users/{ceo['user']['id']}", json={"role": "dev"}, headers=T).status_code == 400   # pas de modification de soi
    c.patch(V + f"/users/{uid}", json={"active": True}, headers=T)
    s = login(c, "d@x.fr"); c.post(V + "/auth/logout-all", headers=H(s["access_token"]))
    assert c.get(V + "/me", headers=H(s["access_token"])).status_code == 401
    assert c.patch(V + "/users/999", json={"active": False}, headers=T).status_code == 404


def test_password_change_revokes_sessions():
    c = fresh()
    ceo = make_ceo(c)
    f = invited(c, ceo, "friends", "f@x.fr")
    assert c.post(V + "/auth/password", json={"old": "faux-mot-de-passe", "new": "Autre-mot-de-passe-77"}, headers=H(f["access_token"])).status_code == 401
    assert c.post(V + "/auth/password", json={"old": PW, "new": "court"}, headers=H(f["access_token"])).status_code == 400
    assert c.post(V + "/auth/password", json={"old": PW, "new": "Autre-mot-de-passe-77"}, headers=H(f["access_token"])).status_code == 200
    assert c.get(V + "/me", headers=H(f["access_token"])).status_code == 401
    login(c, "f@x.fr", "Autre-mot-de-passe-77")


def test_totp_login_flow_and_ceo_mfa_requirement():
    c = fresh()
    ceo = make_ceo(c)
    T = H(ceo["access_token"])
    os.environ["DP_REQUIRE_CEO_TOTP"] = "1"
    r = c.get(V + "/users", headers=T)
    assert r.status_code == 403 and r.json().get("mfa_setup_required")                              # administration bloquée tant que le TOTP n'est pas activé
    sec = c.post(V + "/auth/totp/setup", headers=T).json()
    assert sec["otpauth"].startswith("otpauth://totp/") and sec["secret"] in sec["otpauth"]
    assert c.post(V + "/auth/totp/enable", json={"code": "000000"}, headers=T).status_code == 400
    code = accounts.totp_at(sec["secret"], int(time.time() // 30))
    assert c.post(V + "/auth/totp/enable", json={"code": code}, headers=T).status_code == 200
    assert c.get(V + "/users", headers=T).status_code == 200
    r = c.post(V + "/auth/login", json={"email": "ceo@dualpulse.test", "password": PW})
    assert r.status_code == 401 and r.json()["mfa_required"] is True                               # mot de passe seul : insuffisant
    assert c.post(V + "/auth/login", json={"email": "ceo@dualpulse.test", "password": PW, "totp": code}).status_code == 401      # code déjà utilisé : pas de rejeu
    nxt = accounts.totp_at(sec["secret"], int(time.time() // 30) + 1)
    ok = c.post(V + "/auth/login", json={"email": "ceo@dualpulse.test", "password": PW, "totp": nxt})
    assert ok.status_code == 200 and "mfa_setup_required" not in ok.json()


def test_attestation_is_verifiable_offline_and_bound_to_user_state():
    c = fresh()
    ceo = make_ceo(c)
    d = invited(c, ceo, "dev", "d@x.fr")
    a = c.post(V + "/auth/attest", headers=H(d["access_token"])).json()
    pub = tokens.public_from_b64(c.get(V + "/keys").json()["token"]["public_key"])                 # clé publique seule : aucun appel au serveur ensuite
    claims = tokens.verify(a["attestation"], pub, typ="attest")
    assert claims["role"] == "dev" and claims["exp"] - claims["iat"] == 14 * 86400
    try:
        tokens.verify(a["attestation"], pub, typ="access"); assert False                          # une attestation n'ouvre pas l'API
    except tokens.TokenError:
        pass
    assert c.get(V + "/me", headers=H(a["attestation"])).status_code == 401


# ---------------------------------------------------------------- catalogue, manifestes, téléchargements
def test_catalog_per_role_and_terna_stays_wishlist():
    c = fresh()
    ceo = make_ceo(c)
    f, d = invited(c, ceo, "friends", "f@x.fr"), invited(c, ceo, "dev", "d@x.fr")
    assert publish(c, manifest("enos", "stable", "1.0.0")).status_code == 200
    assert publish(c, manifest("enos", "dev", "1.1.0")).status_code == 200
    assert publish(c, manifest("enos", "ceo", "1.2.0")).status_code == 200
    assert publish(c, manifest("terna", "alpha", "0.1.0")).status_code == 200
    pick = lambda body, pid: next(p for p in body["products"] if p["id"] == pid)                  # noqa: E731
    pub = c.get(V + "/catalog").json()
    assert pub["role"] == "public" and pick(pub, "enos")["latest"] is None and pick(pub, "terna")["wishlist"] is True      # public : vitrine seulement
    fc = c.get(V + "/catalog", headers=H(f["access_token"])).json()
    assert pick(fc, "enos")["channel"] == "stable" and pick(fc, "enos")["latest"]["version"] == "1.0.0"
    assert pick(fc, "terna")["channel"] is None and pick(fc, "terna")["wishlist"] and not pick(fc, "terna")["can_download"] and pick(fc, "terna")["latest"] is None
    dc = c.get(V + "/catalog", headers=H(d["access_token"])).json()
    assert pick(dc, "enos")["channel"] == "dev" and pick(dc, "enos")["latest"]["version"] == "1.1.0"
    assert pick(dc, "terna")["channel"] == "alpha" and pick(dc, "terna")["can_download"] and pick(dc, "terna")["wishlist"] is False
    cc = c.get(V + "/catalog", headers=H(ceo["access_token"])).json()
    assert pick(cc, "enos")["latest"]["version"] == "1.2.0"
    assert c.put(V + "/products/terna/status", json={"status": "n-importe-quoi"}, headers=H(ceo["access_token"])).status_code == 400
    c.put(V + "/products/terna/status", json={"status": "released"}, headers=H(ceo["access_token"]))
    assert pick(c.get(V + "/catalog").json(), "terna")["status"] == "released"


def test_manifest_access_by_role_and_channel():
    c = fresh()
    ceo = make_ceo(c)
    f, d = invited(c, ceo, "friends", "f@x.fr"), invited(c, ceo, "dev", "d@x.fr")
    for ch, v in (("stable", "1.0.0"), ("dev", "1.1.0"), ("ceo", "1.2.0")):
        publish(c, manifest("enos", ch, v))
    publish(c, manifest("terna", "alpha", "0.1.0")); publish(c, manifest("terna", "public", "1.0.0"))
    get = lambda who, p, ch: c.get(V + f"/manifest/{p}/{ch}", headers=H(who["access_token"])).status_code       # noqa: E731
    assert [get(f, "enos", ch) for ch in ("stable", "dev", "ceo")] == [200, 403, 403]
    assert [get(d, "enos", ch) for ch in ("stable", "dev", "ceo")] == [200, 200, 403]
    assert [get(ceo, "enos", ch) for ch in ("stable", "dev", "ceo")] == [200, 200, 200]                         # le rôle supérieur lit les canaux inférieurs
    assert [get(f, "terna", ch) for ch in ("alpha", "public")] == [403, 403]                                    # Terna non sorti : aucun binaire pour les Friends
    assert [get(d, "terna", ch) for ch in ("alpha", "public")] == [200, 200]
    c.put(V + "/products/terna/status", json={"status": "released"}, headers=H(ceo["access_token"]))
    assert get(f, "terna", "public") == 200 and get(f, "terna", "alpha") == 403
    assert get(f, "inconnu", "stable") == 404 and get(f, "enos", "inconnu") == 404
    assert c.get(V + "/manifest/enos/stable").status_code == 401
    body = c.get(V + "/manifest/enos/stable", headers=H(f["access_token"])).json()
    assert manifests.verify(MPRIV.public_key(), body["manifest"], body["signature"])                           # le client peut re-vérifier la signature


def test_publish_rules_signature_downgrade_yank():
    c = fresh()
    ceo = make_ceo(c)
    f = invited(c, ceo, "friends", "f@x.fr")
    m = manifest(version="2.0.0")
    URL = main.ADMIN_PATH + "/api/launcher/releases"
    assert c.post(URL, json={"manifest": m, "signature": manifests.sign(MPRIV, m)}).status_code in (401, 404)          # sans jeton d'admin
    assert c.post(URL, json={"manifest": m, "signature": manifests.sign(tokens.new_private(), m)}, headers=ADM).status_code == 400   # mauvaise clé
    assert c.post(URL, json={"manifest": m, "signature": "AAAA"}, headers=ADM).status_code == 400
    assert c.post(URL, json={"manifest": {**m, "files": [{**m["files"][0], "path": "../x"}]}, "signature": manifests.sign(MPRIV, m)}, headers=ADM).status_code == 400
    assert publish(c, m).status_code == 200
    assert publish(c, m).status_code == 409                                       # même version
    assert publish(c, manifest(version="1.9.0")).status_code == 409               # retour en arrière interdit
    assert publish(c, manifest(version="2.0.1")).status_code == 200
    assert c.get(V + "/manifest/enos/stable", headers=H(f["access_token"])).json()["manifest"]["version"] == "2.0.1"
    rid = [r for r in c.get(URL, headers=ADM).json()["items"] if r["version"] == "2.0.1"][0]["id"]
    assert c.post(URL + f"/{rid}/yank", headers=ADM).status_code == 200
    assert c.get(V + "/manifest/enos/stable", headers=H(f["access_token"])).json()["manifest"]["version"] == "2.0.0"     # la version retirée n'est plus servie
    assert c.post(URL + "/999/yank", headers=ADM).status_code == 404
    os.environ["DP_MANIFEST_PUBKEY"] = ""
    try:
        assert publish(c, manifest(version="3.0.0")).status_code == 503              # pas de clé de manifeste configurée : publication désactivée
    finally:
        os.environ["DP_MANIFEST_PUBKEY"] = tokens.public_b64(MPRIV)


def test_download_links_local_blob_expiry_and_role_check():
    c = fresh()
    ceo = make_ceo(c)
    f, d = invited(c, ceo, "friends", "f@x.fr"), invited(c, ceo, "dev", "d@x.fr")
    store = os.environ["DP_STORAGE_DIR"]
    for key, data in (("enos/stable/1.0.0/ENOS.exe", b"MZ-stable"), ("enos/dev/1.1.0/ENOS.exe", b"MZ-dev")):
        os.makedirs(os.path.dirname(os.path.join(store, key)), exist_ok=True)
        open(os.path.join(store, key), "wb").write(data)
    publish(c, manifest("enos", "stable", "1.0.0")); publish(c, manifest("enos", "dev", "1.1.0"))
    r = c.get(V + "/download/enos/stable/1.0.0/0", headers=H(f["access_token"]))
    assert r.status_code == 200 and r.json()["sha256"] == "a" * 64 and r.json()["expires_in"] == 300
    got = c.get(r.json()["url"].replace("http://testserver", ""))
    assert got.status_code == 200 and got.content == b"MZ-stable"
    assert c.get(V + "/download/enos/dev/1.1.0/0", headers=H(f["access_token"])).status_code == 403          # pas son canal : pas de lien
    assert c.get(V + "/download/enos/dev/1.1.0/0", headers=H(d["access_token"])).status_code == 200
    assert c.get(V + "/download/enos/stable/1.0.0/5", headers=H(f["access_token"])).status_code == 404
    assert c.get(V + "/download/enos/stable/9.9.9/0", headers=H(f["access_token"])).status_code == 404
    assert c.get(V + "/download/enos/stable/1.0.0/0").status_code == 401
    tok = r.json()["url"].rsplit("/", 1)[1]
    assert c.get(V + "/blob/" + tok[:-4] + "AAAA").status_code == 404                                         # jeton falsifié
    expired = storage.signed_blob_token(service.signing_key(), "enos/stable/1.0.0/ENOS.exe", ttl=60, now=time.time() - 3600)
    assert c.get(V + "/blob/" + expired).status_code == 404
    esc = storage.signed_blob_token(service.signing_key(), "../../etc/passwd")
    assert c.get(V + "/blob/" + esc).status_code == 404                                                       # impossible de sortir du dossier de stockage
    other = tokens.issue(service.signing_key(), sub=1, role="friends", typ="access")
    assert c.get(V + "/blob/" + other).status_code == 404                                                     # un jeton d'accès n'ouvre pas les fichiers
    assert db.conn().execute("SELECT COUNT(*) FROM launcher_downloads").fetchone()[0] == 2                    # journal des téléchargements


def test_download_with_r2_returns_presigned_url_and_503_without_storage():
    c = fresh()
    ceo = make_ceo(c)
    f = invited(c, ceo, "friends", "f@x.fr")
    publish(c, manifest("enos", "stable", "1.0.0"))
    os.environ.update(DP_R2_ENDPOINT="https://acc123.r2.cloudflarestorage.com", DP_R2_BUCKET="dp-binaires", DP_R2_ACCESS_KEY="AK", DP_R2_SECRET_KEY="SK")
    try:
        url = c.get(V + "/download/enos/stable/1.0.0/0", headers=H(f["access_token"])).json()["url"]
        assert url.startswith("https://acc123.r2.cloudflarestorage.com/dp-binaires/enos/stable/1.0.0/ENOS.exe?") and "X-Amz-Signature=" in url and "X-Amz-Expires=300" in url
        assert "SK" not in url.replace("X-Amz-Signature", "")
    finally:
        for k in ("DP_R2_ENDPOINT", "DP_R2_BUCKET", "DP_R2_ACCESS_KEY", "DP_R2_SECRET_KEY"):
            os.environ.pop(k, None)
    saved = os.environ.pop("DP_STORAGE_DIR")
    try:
        assert c.get(V + "/download/enos/stable/1.0.0/0", headers=H(f["access_token"])).status_code == 503
    finally:
        os.environ["DP_STORAGE_DIR"] = saved


def test_launcher_responses_are_not_cached_and_hidden_from_robots():
    c = fresh()
    ceo = make_ceo(c)
    r = c.get(V + "/me", headers=H(ceo["access_token"]))
    assert "no-store" in r.headers["cache-control"]
    assert "Disallow: /launcher/" in c.get("/robots.txt").text
    assert "token_ed25519" not in c.get("/").text
    k = c.get(V + "/keys").json()
    assert k["token"]["alg"] == "EdDSA" and "private" not in str(k).lower()


def test_news_banners_visibility_by_role_dates_and_validation():
    c = fresh()
    ceo = make_ceo(c)
    f, d = invited(c, ceo, "friends", "f@x.fr"), invited(c, ceo, "dev", "d@x.fr")
    T = H(ceo["access_token"])
    ok = lambda body: c.post(V + "/news", json=body, headers=T)                                  # noqa: E731
    assert ok({"title": "Public", "kind": "announcement", "image": "https://cdn.example/a.jpg", "priority": 5}).status_code == 200
    assert ok({"title": "Pour les amis", "min_role": "friends"}).status_code == 200
    assert ok({"title": "Équipe Dev", "min_role": "dev", "priority": 9}).status_code == 200
    assert ok({"title": "CEO seulement", "min_role": "ceo"}).status_code == 200
    assert ok({"title": "Programmée", "starts_at": time.time() + 3600}).status_code == 200
    assert ok({"title": "Expirée", "ends_at": time.time() - 3600}).status_code == 200
    assert ok({"title": "Désactivée", "active": False}).status_code == 200
    titles = lambda who: [n["title"] for n in c.get(V + "/news", **({"headers": H(who["access_token"])} if who else {})).json()["items"]]      # noqa: E731
    assert titles(None) == ["Public"]
    assert titles(f) == ["Pour les amis", "Public"] or set(titles(f)) == {"Public", "Pour les amis"}
    assert titles(d)[0] == "Équipe Dev" and set(titles(d)) == {"Public", "Pour les amis", "Équipe Dev"}          # priorité décroissante
    assert set(titles(ceo)) == {"Public", "Pour les amis", "Équipe Dev", "CEO seulement"}
    assert len(c.get(V + "/news/all", headers=T).json()["items"]) == 7
    for bad in ({"title": ""}, {"title": "x" * 121}, {"title": "A", "image": "http://non-https.example/a.jpg"}, {"title": "A", "link": "javascript:alert(1)"}, {"title": "A", "kind": "zzz"}, {"title": "A", "min_role": "root"}):
        assert ok(bad).status_code in (400, 422), bad
    for who in (f, d):                                                                                  # gestion : CEO seulement
        assert c.post(V + "/news", json={"title": "x"}, headers=H(who["access_token"])).status_code == 403
        assert c.delete(V + "/news/1", headers=H(who["access_token"])).status_code == 403
    assert c.post(V + "/news", json={"title": "x"}).status_code == 401
    nid = c.get(V + "/news/all", headers=T).json()["items"][-1]["id"]
    assert c.patch(V + f"/news/{nid}", json={"title": "Renommée", "min_role": "friends"}, headers=T).status_code == 200
    assert c.patch(V + f"/news/{nid}", json={"link": "ftp://x"}, headers=T).status_code == 400
    assert c.delete(V + f"/news/{nid}", headers=T).status_code == 200 and c.delete(V + f"/news/{nid}", headers=T).status_code == 404


def test_wishlist_is_public_rate_limited_and_does_not_reveal_subscribers():
    c = fresh()
    ceo = make_ceo(c)
    a = c.post(V + "/wishlist", json={"email": "Joueur@Example.com"})
    b = c.post(V + "/wishlist", json={"email": "joueur@example.com"})
    assert a.status_code == b.status_code == 200 and a.json() == b.json()                                # déjà inscrit : réponse identique
    assert c.post(V + "/wishlist", json={"email": "pas-un-mail"}).status_code == 400
    assert c.get(V + "/wishlist/count", headers=H(ceo["access_token"])).json()["count"] == 1
    assert c.get(V + "/wishlist/count").status_code == 401
    codes = [c.post(V + "/wishlist", json={"email": f"x{i}@example.com"}).status_code for i in range(8)]
    assert codes[-1] == 429


def test_cors_only_for_the_launcher_origins():
    c = fresh()
    pre = lambda origin: c.options(V + "/auth/login", headers={"Origin": origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type"})      # noqa: E731
    for o in ("tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"):
        r = pre(o)
        assert r.status_code == 200 and r.headers["access-control-allow-origin"] == o and "access-control-allow-credentials" not in r.headers, o
    r = pre("https://evil.example")
    assert "access-control-allow-origin" not in r.headers
    assert "access-control-allow-origin" not in c.get("/healthz", headers={"Origin": "https://evil.example"}).headers


def test_clipboard_is_private_bounded_and_rate_limited():
    c = fresh()
    ceo = make_ceo(c)
    a, b2 = invited(c, ceo, "friends", "a@x.fr"), invited(c, ceo, "friends", "b@x.fr")
    A, B = H(a["access_token"]), H(b2["access_token"])
    assert c.post(V + "/clipboard", json={"kind": "text", "content": "bonjour"}).status_code == 401
    i1 = c.post(V + "/clipboard", json={"kind": "text", "content": "https://exemple.fr/lien", "device": "phone"}, headers=A).json()["id"]
    png = base64.b64encode(b"\x89PNG" + b"\0" * 200).decode()
    i2 = c.post(V + "/clipboard", json={"kind": "image", "mime": "image/png", "content": png, "device": "pc"}, headers=A).json()["id"]
    got = c.get(V + "/clipboard", headers=A).json()["items"]
    assert [x["id"] for x in got] == [i2, i1] and got[1]["content"] == "https://exemple.fr/lien" and got[0]["kind"] == "image"      # le plus récent d'abord
    assert [x["id"] for x in c.get(V + f"/clipboard?since_id={i1}", headers=A).json()["items"]] == [i2]                          # le PC ne lit que le nouveau
    assert c.get(V + "/clipboard", headers=B).json()["items"] == []                                                                # un autre compte ne voit rien
    assert c.delete(V + f"/clipboard/{i1}", headers=B).status_code == 404                                                          # ni ne supprime
    assert c.delete(V + f"/clipboard/{i1}", headers=A).status_code == 200
    for bad in ({"kind": "text", "content": ""}, {"kind": "text", "content": "x" * 100_001}, {"kind": "image", "mime": "text/html", "content": png}, {"kind": "image", "mime": "image/png", "content": "<script>"},
                {"kind": "fichier", "content": "x"}):
        assert c.post(V + "/clipboard", json=bad, headers=A).status_code in (400, 422), bad
    for n in range(60):
        c.post(V + "/clipboard", json={"kind": "text", "content": f"t{n}"}, headers=A)
    assert len(c.get(V + "/clipboard?limit=50", headers=A).json()["items"]) == 50                                                 # conservation limitée à 50
    db.conn().execute("UPDATE clipboard SET created_at=? ", (time.time() - 90000,)); db.conn().commit()
    c.post(V + "/clipboard", json={"kind": "text", "content": "récent"}, headers=A)
    assert [x["content"] for x in c.get(V + "/clipboard", headers=A).json()["items"]] == ["récent"]                                 # > 24 h : purgé
    codes = [c.post(V + "/clipboard", json={"kind": "text", "content": "x"}, headers=A).status_code for _ in range(95)]
    assert 429 in codes


def test_mobile_device_beat_for_the_pc_to_find_the_phone():
    c = fresh()
    ceo = make_ceo(c)
    a, b2 = invited(c, ceo, "friends", "a@x.fr"), invited(c, ceo, "friends", "b@x.fr")
    A = H(a["access_token"])
    r = c.post(V + "/devices/beat", json={"device_id": "pixel-8-abc123", "name": "Pixel 8", "lan_ips": ["192.168.1.42", "pas-une-ip", "999.1.1.1"], "adb_port": 5555, "app_version": "1.12"}, headers=A)
    assert r.status_code == 200
    d = c.get(V + "/devices", headers=A).json()["items"]
    assert len(d) == 1 and d[0]["lan_ips"] == ["192.168.1.42"] and d[0]["adb_port"] == 5555 and d[0]["online"] is True
    c.post(V + "/devices/beat", json={"device_id": "pixel-8-abc123", "name": "Pixel 8 Pro", "lan_ips": ["192.168.1.50"]}, headers=A)
    d = c.get(V + "/devices", headers=A).json()["items"]
    assert len(d) == 1 and d[0]["name"] == "Pixel 8 Pro" and d[0]["lan_ips"] == ["192.168.1.50"]                                   # mise à jour, pas de doublon
    assert c.get(V + "/devices", headers=H(b2["access_token"])).json()["items"] == []
    assert c.post(V + "/devices/beat", json={"device_id": "x", "lan_ips": []}, headers=A).status_code == 400
    assert c.post(V + "/devices/beat", json={"device_id": "abcdef", "adb_port": 70000}, headers=A).status_code == 400
    db.conn().execute("UPDATE mobile_devices SET last_seen=?", (time.time() - 600,)); db.conn().commit()
    assert c.get(V + "/devices", headers=A).json()["items"][0]["online"] is False


def test_mobile_app_is_a_product_with_the_same_role_channels():
    c = fresh()
    ceo = make_ceo(c)
    f, d = invited(c, ceo, "friends", "f@x.fr"), invited(c, ceo, "dev", "d@x.fr")
    for ch, v, code in (("stable", "1.12.0", 112), ("dev", "1.13.0", 113)):
        m = manifest("enos-mobile", ch, v, files=[{"path": "NASKO.apk", "sha256": "b" * 64, "size": 9, "key": f"enos-mobile/{ch}/{v}/NASKO.apk"}]); m["launch"] = ""; m["version_code"] = code
        assert publish(c, m).status_code == 200
    pick = lambda who: next(p for p in c.get(V + "/catalog", headers=H(who["access_token"])).json()["products"] if p["id"] == "enos-mobile")      # noqa: E731
    assert pick(f)["channel"] == "stable" and pick(f)["latest"]["version_code"] == 112
    assert pick(d)["channel"] == "dev" and pick(d)["latest"]["version_code"] == 113
    assert c.get(V + "/manifest/enos-mobile/dev", headers=H(f["access_token"])).status_code == 403


def test_mobile_ota_endpoints_match_the_apk_updater_and_respect_roles():
    c = fresh()
    ceo = make_ceo(c)
    f, d = invited(c, ceo, "friends", "f@x.fr"), invited(c, ceo, "dev", "d@x.fr")
    store = os.environ["DP_STORAGE_DIR"]
    for ch, v, code, body in (("stable", "1.12.0", 112, b"APK-STABLE"), ("dev", "1.13.0", 113, b"APK-DEV-BUILD")):
        key = f"enos-mobile/{ch}/{v}/NASKO.apk"; os.makedirs(os.path.dirname(os.path.join(store, key)), exist_ok=True); open(os.path.join(store, key), "wb").write(body)
        m = manifest("enos-mobile", ch, v, files=[{"path": "NASKO.apk", "sha256": hashlib.sha256(body).hexdigest(), "size": len(body), "key": key}]); m["launch"] = ""; m["version_code"] = code
        assert publish(c, m).status_code == 200
    tf = c.post(V + "/mobile/update-token", json={"device_id": "pixel-8-abc123"}, headers=H(f["access_token"])).json()["token"]
    td = c.post(V + "/mobile/update-token", json={"device_id": "pixel-8-abc123"}, headers=H(d["access_token"])).json()["token"]
    v1 = c.get(f"/m/{tf}/api/app/version").json()
    assert v1["versionCode"] == 112 and v1["versionName"] == "1.12.0" and v1["sha256"] == hashlib.sha256(b"APK-STABLE").hexdigest() and v1["channel"] == "stable"     # champs lus par Updater.java
    assert c.get(f"/m/{td}/api/app/version").json()["versionCode"] == 113                                                               # Dev : canal dev
    r = c.get(f"/m/{tf}/nasko.apk", follow_redirects=False)
    assert r.status_code == 302 and "/launcher/v1/blob/" in r.headers["location"]
    assert c.get(r.headers["location"].replace("http://testserver", "")).content == b"APK-STABLE"                                       # le Friend reçoit SON build
    assert c.get(f"/m/{td}/nasko.apk", follow_redirects=False).headers["location"] != r.headers["location"]
    assert c.get("/m/jeton-inconnu/api/app/version").status_code == 404 and c.get("/m/jeton-inconnu/nasko.apk", follow_redirects=False).status_code == 404
    assert "no-store" in c.get(f"/m/{tf}/api/app/version").headers["cache-control"]
    assert c.post(V + "/mobile/update-token", json={"device_id": "pixel-8-abc123"}).status_code == 401                                   # créer un jeton exige d'être connecté
    c.post(V + "/auth/logout-all", headers=H(f["access_token"]))
    assert c.get(f"/m/{tf}/api/app/version").status_code == 404                                                                         # jeton révoqué avec la session
    c.patch(V + f"/users/{d['user']['id']}", json={"active": False}, headers=H(ceo["access_token"]))
    assert c.get(f"/m/{td}/api/app/version").status_code == 404                                                                         # compte désactivé : plus de mises à jour


def test_agenda_sync_last_write_wins_per_task_and_is_private():
    c = fresh()
    ceo = make_ceo(c)
    a, b2 = invited(c, ceo, "friends", "a@x.fr"), invited(c, ceo, "friends", "b@x.fr")
    A, B = H(a["access_token"]), H(b2["access_token"])
    now = time.time()
    t1 = {"id": "task000001", "title": "Rendre le TP", "due": "2026-10-20T18:00", "notes": "", "done": False, "updated": now - 100}
    r = c.post(V + "/agenda/sync", json={"since": 0, "tasks": [t1]}, headers=A).json()
    assert r["tasks"] == [] and r["now"] > now - 1                                    # ce qu'on envoie n'est pas renvoyé
    other = c.post(V + "/agenda/sync", json={"since": 0, "tasks": []}, headers=A).json()["tasks"]
    assert [x["title"] for x in other] == ["Rendre le TP"]                              # un 2e appareil (since=0) récupère tout
    stale = dict(t1, title="Ancienne version", updated=now - 500)
    c.post(V + "/agenda/sync", json={"since": 0, "tasks": [stale]}, headers=A)
    assert c.post(V + "/agenda/sync", json={"since": 0, "tasks": []}, headers=A).json()["tasks"][0]["title"] == "Rendre le TP"    # plus ancien : refusé
    c.post(V + "/agenda/sync", json={"since": 0, "tasks": [dict(t1, done=True, updated=now - 10)]}, headers=A)
    got = c.post(V + "/agenda/sync", json={"since": now - 50, "tasks": []}, headers=A).json()["tasks"]
    assert len(got) == 1 and got[0]["done"] is True                                     # seules les modifications récentes
    fut = dict(t1, title="Futur", updated=now + 99999)
    c.post(V + "/agenda/sync", json={"since": 0, "tasks": [fut]}, headers=A)
    assert c.post(V + "/agenda/sync", json={"since": 0, "tasks": []}, headers=A).json()["tasks"][0]["updated"] <= time.time() + 5     # date future ramenée à maintenant
    c.post(V + "/agenda/sync", json={"since": 0, "tasks": [{"id": "task000001", "deleted": True, "updated": time.time() + 1}]}, headers=A)
    g = c.post(V + "/agenda/sync", json={"since": 0, "tasks": []}, headers=A).json()["tasks"]
    assert g[0].get("deleted") is True and g[0]["title"] == ""                          # pierre tombale : la suppression se propage
    assert c.post(V + "/agenda/sync", json={"since": 0, "tasks": []}, headers=B).json()["tasks"] == []                                # l'autre compte ne voit rien
    bad = [{"id": "x"}, {"id": "task000002", "due": "demain"}, {"id": "../../etc", "title": "x"}, "pas un objet"]
    assert c.post(V + "/agenda/sync", json={"since": 0, "tasks": bad[:3]}, headers=A).status_code == 200
    assert c.post(V + "/agenda/sync", json={"since": 0, "tasks": []}, headers=A).json()["tasks"][0]["id"] == "task000001"            # entrées invalides ignorées
    assert c.post(V + "/agenda/sync", json={"since": 0, "tasks": []}).status_code == 401


if __name__ == "__main__":
    import traceback
    bad = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            try:
                fn(); print("OK ", name)
            except Exception:
                bad += 1; print("!! ", name); traceback.print_exc()
    print("\nTOUT OK" if not bad else f"\n{bad} ÉCHEC(S)")
    sys.exit(1 if bad else 0)
