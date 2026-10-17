"""APPAIRAGE DU TÉLÉPHONE EN UN SCAN : le bouton « APPAIRER LE TÉLÉPHONE » du PC affiche un QR code + un code à 10 caractères.

  PC  : fabrique un paquet CHIFFRÉ (clés Groq/ElevenLabs, liens .ics, adresse + jeton + empreinte du certificat du PC, identifiant d'appareil du téléphone),
        l'approuve d'avance comme « appareil de confiance » (donc Eto Dev, sans étape manuelle) et sert une page éphémère sur le Wi-Fi.
  Tél : le QR ouvre la page › « OUVRIR DANS E.N.O.S. » › l'application demande le code affiché sur le PC › elle déchiffre et range tout dans son coffre.
Le QR ne contient que l'adresse de la page ; le code n'est jamais transmis ; le paquet est AES-256-GCM (clé PBKDF2 300 000 tours). Lien actif 10 min.
Si l'appairage n'aboutit pas (annulé / expiré), l'approbation d'avance est retirée.
"""
import base64
import html
import http.server
import json
import logging
import os
import secrets
import socket
import threading
import time
import uuid

log = logging.getLogger("nasko.pairing")
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"            # sans 0/O/1/I : lisible sur un écran
ITER = 300000                                              # identique à Importer.java
LIFETIME = 600
_lock = threading.Lock()
_S = {"active": False}


# ------------------------------------------------------------------ réseau
def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def tailscale_ip():
    try:
        import psutil
        for addrs in psutil.net_if_addrs().values():
            for a in addrs:
                if a.family == socket.AF_INET:
                    p = a.address.split(".")
                    if len(p) == 4 and p[0] == "100" and 64 <= int(p[1]) <= 127:
                        return a.address
    except Exception:                                      # noqa: BLE001
        pass
    return ""


def eleven_voices(key):
    """Voix du compte si la clé fonctionne, sinon None."""
    import httpx
    import nasko_core
    try:
        r = httpx.get("https://api.elevenlabs.io/v1/voices", headers={"xi-api-key": key}, timeout=15, verify=nasko_core.ssl_context())
        return r.json().get("voices", []) if r.status_code == 200 else None
    except Exception:                                      # noqa: BLE001
        return None


# ------------------------------------------------------------------ contenu du paquet
def build_bundle(device_id=""):
    import nasko_cert
    import nasko_core
    import nasko_security as sec
    cfg = nasko_core.load_config()
    notes, vault, settings = [], {}, {}
    if cfg.get("llm_api_key"):
        vault["groq"] = cfg["llm_api_key"]
        if cfg.get("llm_model"):
            settings["model"] = cfg["llm_model"]
    else:
        notes.append("Groq : pas de clé dans la configuration du PC")
    main, backup = cfg.get("elevenlabs_api_key", ""), cfg.get("elevenlabs_backup_api_key", "")
    voices = eleven_voices(main) if main else None
    if main and voices is not None:
        vault["eleven_enos"] = main
        settings.update(voice_enos=cfg.get("elevenlabs_voice_id", "") or (voices[0]["voice_id"] if voices else ""), voice_name_enos=cfg.get("elevenlabs_voice_name", ""))
        notes.append("ElevenLabs E.N.O.S. : clé principale valide")
    elif backup:
        bv = eleven_voices(backup)
        if bv is not None:
            want = (cfg.get("elevenlabs_backup_voice_id") or "").strip()
            name = (cfg.get("elevenlabs_backup_voice_name") or "ENOS2").strip().lower()
            vid = want or next((v["voice_id"] for v in bv if v.get("name", "").strip().lower() == name), "")
            vault["eleven_enos"] = backup
            settings.update(voice_enos=vid, voice_name_enos=cfg.get("elevenlabs_backup_voice_name") or "ENOS2")
            notes.append("ElevenLabs E.N.O.S. : clé principale refusée → compte de secours envoyé")
        else:
            notes.append("ElevenLabs E.N.O.S. : clés principale ET de secours refusées")
    elif main:
        vault["eleven_enos"] = main
        notes.append("ElevenLabs E.N.O.S. : clé non vérifiée (hors ligne ?), envoyée telle quelle")
    eto = cfg.get("elevenlabs_eto_api_key", "")
    if eto:
        vault["eleven_eto"] = eto
        settings.update(voice_eto=cfg.get("elevenlabs_eto_voice_id", ""), voice_name_eto="ETO")
        notes.append("ElevenLabs ETO : " + ("clé valide" if eleven_voices(eto) is not None else "clé refusée ou injoignable"))
    for k_cfg, k_vault, label in (("zeus_ics_url", "ics_zeus", "Zeus"), ("moodle_ics_url", "ics_moodle", "Moodle")):
        if cfg.get(k_cfg):
            vault[k_vault] = cfg[k_cfg]
        else:
            notes.append(f"{label} : pas de lien .ics")
    port = int(cfg.get("https_port", 8443) or 8443)
    ts = tailscale_ip()
    addrs = [f"{lan_ip()}:{port}"] + ([f"{ts}:{port}"] if ts else [])
    if not cfg.get("allow_network_access"):
        notes.append("⚠ « Accès téléphone » désactivé sur le PC : active-le pour que le téléphone puisse s'y connecter")
    vault["pc_token"] = sec.pairing_token()
    pin = nasko_cert.fingerprint(os.path.join(nasko_core.data_dir(), "certs"))
    return {"v": 1, "name": cfg.get("user_label", ""), "device_id": device_id, "vault": vault, "settings": settings,
            "pc": {"addrs": ", ".join(addrs), "pin": pin}}, notes


def encrypt(bundle, code):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    norm = "".join(c for c in code.upper() if c.isalnum())
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(norm.encode())
    ct = AESGCM(key).encrypt(iv, json.dumps(bundle, ensure_ascii=False).encode("utf-8"), None)
    return base64.urlsafe_b64encode(b"EK1" + salt + iv + ct).decode().rstrip("=")


PAGE = """<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>E.N.O.S. · appairage</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050506;color:#ececef;font:17px/1.45 system-ui,sans-serif;padding:20px;box-sizing:border-box}
.c{max-width:440px;width:100%;background:linear-gradient(165deg,#151518,#0e0e10);border:1px solid #27272c;border-radius:18px;padding:26px}
h1{margin:0 0 6px;font:400 15px monospace;letter-spacing:3px;color:#e0243c}p{color:#9a9aa4;margin:8px 0 18px}
a.b{display:block;text-align:center;padding:16px;border-radius:14px;background:linear-gradient(120deg,#8c1328,#d71f3a);color:#fff;font-weight:700;letter-spacing:2px;text-decoration:none}
details{margin-top:18px;color:#9a9aa4}textarea{width:100%;height:90px;margin-top:10px;background:#0a0a0c;color:#ececef;border:1px solid #27272c;border-radius:10px;font:12px monospace;box-sizing:border-box}
button{margin-top:8px;padding:10px 14px;border-radius:10px;border:1px solid #27272c;background:#18181b;color:#ececef;font-weight:700}
</style></head><body><div class="c"><h1>E.N.O.S</h1><b>Appairage prêt</b>
<p>Appuie sur le bouton : l'application s'ouvre et te demande le <b>code affiché sur l'écran du PC</b>.</p>
<a class="b" href="intent://import?d=__B__#Intent;scheme=enos;package=com.nasko.app;end">OUVRIR DANS E.N.O.S.</a>
<details><summary>Le bouton ne fait rien ?</summary><p>Copie le fichier, ouvre E.N.O.S. › ⚙ Réglages › IMPORTER DEPUIS LE PC, colle-le.</p>
<textarea id="t" readonly onclick="this.select()">__B__</textarea><button onclick="navigator.clipboard&&navigator.clipboard.writeText(document.getElementById('t').value);this.textContent='Copié ✓'">COPIER LE FICHIER</button></details>
</div></body></html>"""


# ------------------------------------------------------------------ session
def _paired(device_id, since):
    """Le téléphone a-t-il contacté le PC avec son identifiant depuis le début de la session ?"""
    import nasko_team
    for d in nasko_team._load()["devices"]:
        if d["uuid"].lower() == device_id.lower() and d.get("last_seen", 0) >= since:
            return d.get("name", "Téléphone")
    return ""


def start(port=0, ip=""):
    """Prépare l'appairage. Retourne {url, code, qr, notes, expires} (le QR est un data-URI SVG)."""
    import nasko_team
    cancel()
    device_id = str(uuid.uuid4())
    bundle, notes = build_bundle(device_id)
    raw = "".join(secrets.choice(ALPHABET) for _ in range(10))
    code = raw[:5] + "-" + raw[5:]
    blob = encrypt(bundle, raw)
    token = secrets.token_urlsafe(10)
    t0 = time.time()
    nasko_team.approve(device_id, "Téléphone (appairage)")                 # approuvé d'avance : plus d'étape manuelle ; retiré si l'appairage n'aboutit pas

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            if self.path != f"/{token}/":
                self.send_error(404)
                return
            body = PAGE.replace("__B__", html.escape(blob, quote=True)).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            with _lock:
                if _S.get("active") and not _S.get("opened"):
                    _S["opened"] = time.time()

    srv = http.server.ThreadingHTTPServer(("0.0.0.0", port), H)
    host = ip or lan_ip()
    url = f"http://{host}:{srv.server_address[1]}/{token}/"
    threading.Thread(target=srv.serve_forever, daemon=True, name="pairing-http").start()
    qr = ""
    try:
        import segno
        qr = segno.make(url, error="m").svg_data_uri(scale=8, border=2, dark="#000000", light="#ffffff")       # n'encode que l'adresse de la page : aucun secret
    except ImportError:
        pass
    with _lock:
        _R.update(state="idle", name="")
        _S.clear()
        _S.update(active=True, srv=srv, device=device_id, t0=t0, opened=0.0, expires=t0 + LIFETIME, url=url, notes=notes, code=code)
    threading.Thread(target=_reaper, args=(device_id,), daemon=True, name="pairing-reaper").start()
    return {"url": url, "code": code, "qr": qr, "notes": notes, "expires": LIFETIME}


_R = {"state": "idle", "name": ""}                        # résultat de la dernière session (lu par l'interface après la fermeture du lien)


def status():
    with _lock:
        s = dict(_S)
        res = dict(_R)
    if not s.get("active"):
        return res
    who = _paired(s["device"], s["t0"])
    if who:
        return {"state": "paired", "name": who}
    left = int(s["expires"] - time.time())
    if left <= 0:
        return {"state": "expired"}
    return {"state": "opened" if s.get("opened") else "waiting", "left": left}


def cancel(keep_device=False, result="cancelled"):
    import nasko_team
    with _lock:
        srv, dev, t0 = _S.get("srv"), _S.get("device"), _S.get("t0", 0)
        was = bool(_S.get("active"))
        _S.clear()
        _S["active"] = False
        if was:
            _R.update(state=result, name="")
    if srv:
        try:
            srv.shutdown()
            srv.server_close()
        except Exception:                                  # noqa: BLE001
            pass
    if was and dev and not keep_device and not _paired(dev, t0):
        nasko_team.remove(dev)                             # appairage non abouti : l'approbation d'avance disparaît
    return was


def _reaper(device_id):
    """Ferme la page à l'expiration, ou 5 secondes après un appairage réussi."""
    while True:
        time.sleep(2)
        with _lock:
            s = dict(_S)
        if not s.get("active") or s.get("device") != device_id:
            return
        if time.time() > s["expires"]:
            cancel(result="expired")
            return
        who = _paired(device_id, s["t0"])
        if who:
            time.sleep(5)
            cancel(keep_device=True, result="paired")
            with _lock:
                _R["name"] = who
            return
