"""Accès développeur par identité Tailscale (`tailscale serve`) : autorisé pour les logins listés, refusé pour tout le reste — surtout pour un autre tunnel qui forgerait les en-têtes.
Lancer :  py -m pytest -q tests/test_tailscale_access.py"""
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
TMP = tempfile.mkdtemp(prefix="dp_ts_")
HOST = "sami.tail8e71e8.ts.net"
os.environ.update(DP_DB=os.path.join(TMP, "t.db"), DP_ADMIN_TOKEN="jeton-test-123456", DP_ADMIN_PATH="admin-dp", DP_DOWNLOAD_FILE=os.path.join(TMP, "ENOS.exe"),
                  DP_SEED_IPS="203.0.113.7=Nassime", DP_ENOS_VERSION="1.0", DP_TAILSCALE_HOST=HOST, DP_TAILSCALE_USERS="ami@example.org")
open(os.environ["DP_DOWNLOAD_FILE"], "wb").write(b"MZ" + b"\0" * 2048)

from fastapi.testclient import TestClient  # noqa: E402
from app import db, main, whitelist  # noqa: E402

LOCAL = ("127.0.0.1", 50000)
GOOD = {"Host": HOST, "X-Forwarded-For": "100.101.102.103", "Tailscale-User-Login": "ami@example.org", "Tailscale-User-Name": "Ami"}


def served(**over):
    """Client dont la connexion directe vient de 127.0.0.1, comme quand tailscaled relaie une requête du tailnet."""
    h = {**GOOD, **over}
    return TestClient(main.app, client=LOCAL, headers={k: v for k, v in h.items() if v is not None})


def test_authorised_tailnet_user_gets_the_dev_zone_and_the_download():
    c = served()
    assert "devzone" in c.get("/").text
    assert c.get("/dev/style.css").status_code == 200
    r = c.get("/dev/telecharger")
    assert r.status_code == 200 and r.content.startswith(b"MZ")
    last = db.downloads(1)[0]
    assert last["entry"] == "tailscale:ami@example.org" and last["ip"] == "100.101.102.103" and last["ok"] == 1     # le journal garde QUI et d'où


def test_download_keeps_the_real_file_name(monkeypatch):
    """DP_DOWNLOAD_FILE peut pointer vers l'installeur : le fichier téléchargé porte SON nom, pas un « ENOS.exe » codé en dur."""
    setup = Path(TMP) / "ENOS-Setup-1.0.1-dev.exe"
    setup.write_bytes(b"MZ" + b"\1" * 4096)
    monkeypatch.setenv("DP_DOWNLOAD_FILE", str(setup))
    r = served().get("/dev/telecharger")
    assert r.status_code == 200 and r.content == setup.read_bytes()
    assert "ENOS-Setup-1.0.1-dev.exe" in r.headers["content-disposition"]
    assert "filename=\"ENOS.exe\"" not in r.headers["content-disposition"]


def test_other_tailnet_user_is_refused():
    c = served(**{"Tailscale-User-Login": "intrus@example.org"})
    assert "devzone" not in c.get("/").text
    assert c.get("/dev/telecharger").status_code == 404
    assert c.get("/dev/style.css").status_code == 404


def test_login_is_case_insensitive():
    assert served(**{"Tailscale-User-Login": "Ami@Example.ORG"}).get("/dev/telecharger").status_code == 200


def test_forged_identity_through_another_tunnel_is_refused():
    """Un tunnel public (localhost.run…) arrive aussi de 127.0.0.1 mais avec SON nom d'hôte : même avec l'en-tête d'identité forgé, c'est non."""
    for host in ("evil.lhr.life", "127.0.0.1:8001", "localhost", HOST + ".evil.com", "tail8e71e8.ts.net"):
        c = served(Host=host)
        assert c.get("/dev/telecharger").status_code == 404, host
        assert "devzone" not in c.get("/").text, host


def test_forged_identity_from_a_non_loopback_peer_is_refused():
    c = TestClient(main.app, client=("192.0.2.55", 5000), headers=GOOD)
    assert c.get("/dev/telecharger").status_code == 404
    assert "devzone" not in c.get("/").text


def test_peer_rewritten_by_uvicorn_proxy_headers_is_accepted():
    """En production uvicorn remplace request.client par le 1er saut de X-Forwarded-For : le pair est alors l'adresse Tailscale de l'appelant, pas 127.0.0.1."""
    for peer in ("100.101.102.103", "fd7a:115c:a1e0::d939:6803"):
        c = TestClient(main.app, client=(peer, 5000), headers=GOOD)
        assert c.get("/dev/telecharger").status_code == 200, peer
    # …mais jamais un pair d'un autre réseau, ni via un autre tunnel (Host différent) même avec un pair « Tailscale » forgé par X-Forwarded-For
    assert TestClient(main.app, client=("198.51.100.4", 5000), headers=GOOD).get("/dev/telecharger").status_code == 404
    assert TestClient(main.app, client=("100.101.102.103", 5000), headers={**GOOD, "Host": "evil.lhr.life"}).get("/dev/telecharger").status_code == 404


def test_real_uvicorn_stack_end_to_end():
    """Même chemin que la production : vrai serveur uvicorn (proxy-headers par défaut) et requêtes qui imitent `tailscale serve`."""
    import socket
    import threading
    import time
    import uvicorn
    import httpx
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    srv = uvicorn.Server(uvicorn.Config(main.app, host="127.0.0.1", port=port, log_level="error"))
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    for _ in range(100):
        if srv.started:
            break
        time.sleep(0.1)
    try:
        base = f"http://127.0.0.1:{port}"
        assert httpx.get(base + "/dev/telecharger", headers=GOOD, timeout=10).status_code == 200                       # tailscale serve -> autorisé
        assert httpx.get(base + "/dev/telecharger", headers={**GOOD, "Host": "evil.lhr.life"}, timeout=10).status_code == 404    # autre tunnel, identité forgée
        assert httpx.get(base + "/dev/telecharger", headers={**GOOD, "Tailscale-User-Login": "intrus@example.org"}, timeout=10).status_code == 404   # login non autorisé
        assert httpx.get(base + "/dev/telecharger", timeout=10).status_code == 404                                       # appel direct sans aucun en-tête
    finally:
        srv.should_exit = True
        t.join(5)


def test_missing_or_bad_identity_pieces_are_refused():
    assert served(**{"Tailscale-User-Login": None}).get("/dev/telecharger").status_code == 404          # nœud sans utilisateur (étiqueté)
    assert served(**{"Tailscale-User-Login": "pas-un-email"}).get("/dev/telecharger").status_code == 404
    assert served(**{"X-Forwarded-For": None}).get("/dev/telecharger").status_code == 404                # pas d'appareil Tailscale identifié
    assert served(**{"X-Forwarded-For": "203.0.113.50"}).get("/dev/telecharger").status_code == 404       # adresse publique : pas du réseau Tailscale
    assert served(**{"X-Forwarded-For": "not-an-ip"}).get("/dev/telecharger").status_code == 404


def test_disabled_without_configuration(monkeypatch):
    monkeypatch.delenv("DP_TAILSCALE_USERS")
    assert served().get("/dev/telecharger").status_code == 404
    monkeypatch.setenv("DP_TAILSCALE_USERS", "ami@example.org")
    monkeypatch.delenv("DP_TAILSCALE_HOST")
    assert served().get("/dev/telecharger").status_code == 404
    monkeypatch.setenv("DP_TAILSCALE_HOST", HOST)
    assert served().get("/dev/telecharger").status_code == 200


def test_wildcard_allows_every_member_of_the_tailnet(monkeypatch):
    monkeypatch.setenv("DP_TAILSCALE_USERS", "*")
    assert served(**{"Tailscale-User-Login": "n.importe.qui@example.org"}).get("/dev/telecharger").status_code == 200
    assert served(**{"Tailscale-User-Login": None}).get("/dev/telecharger").status_code == 404        # le joker ne couvre pas l'absence d'identité


def test_ipv6_tailscale_address_is_accepted():
    assert served(**{"X-Forwarded-For": "fd7a:115c:a1e0::d939:6803"}).get("/dev/telecharger").status_code == 200


def test_existing_ip_policy_is_unchanged():
    assert TestClient(main.app, client=("203.0.113.7", 5000)).get("/dev/telecharger").status_code == 200            # IP en liste blanche
    assert TestClient(main.app, client=("192.0.2.55", 5000)).get("/dev/telecharger").status_code == 404            # inconnue
    # un tunnel public SANS identité n'est toujours pas traité comme local, même si 127.0.0.1 est en liste blanche
    db.add_ip("127.0.0.1", "local", None)
    tunnel = TestClient(main.app, client=LOCAL, headers={"Host": "evil.lhr.life", "X-Forwarded-For": "198.51.100.9"})
    assert tunnel.get("/dev/telecharger").status_code == 404
    assert TestClient(main.app, client=LOCAL, headers={"Host": "127.0.0.1:8001"}).get("/dev/telecharger").status_code == 200      # navigation locale réelle : Host=127.0.0.1
    assert TestClient(main.app, client=LOCAL).get("/dev/telecharger").status_code == 404                           # Host inconnu (testserver) : traité comme un tunnel, comme avant


def test_whitelist_unit():
    class R:
        def __init__(self, host, headers):
            self.client = type("C", (), {"host": host})()
            self.headers = headers
    ok = R("127.0.0.1", {"host": HOST, "x-forwarded-for": "100.64.0.1, 10.0.0.1", "tailscale-user-login": "ami@example.org"})
    assert whitelist.tailscale_user(ok) == "ami@example.org"
    assert whitelist.forwarded_ip(ok) == whitelist.normalize("100.64.0.1")
    assert whitelist.tailscale_user(R("127.0.0.1", {"host": HOST + ":443", "x-forwarded-for": "100.64.0.1", "tailscale-user-login": "ami@example.org"})) == "ami@example.org"
    assert whitelist.tailscale_user(R("127.0.0.1", {"host": HOST})) is None
