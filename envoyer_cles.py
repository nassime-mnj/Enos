"""Envoie ta configuration du PC (clés d'API, liens .ics, jumelage) à l'application E.N.O.S. du téléphone — chiffrée, avec un code affiché sur CET écran.

    py envoyer_cles.py          (ou double-clic sur « Envoyer mes cles au telephone.bat »)

  1. Ce script lit nasko_config.json (jamais modifié) et fabrique un fichier CHIFFRÉ (AES-256-GCM, clé dérivée d'un code de 10 caractères tiré au hasard).
  2. Il affiche le code ICI et ouvre un QR code. Scanne-le : la page s'ouvre sur le téléphone avec un bouton « Ouvrir dans E.N.O.S. ».
  3. L'application demande le code ; elle déchiffre et range tout dans son coffre Android. Rien ne circule en clair, rien n'est stocké sur le PC.
Envoyés : Groq, ElevenLabs (E.N.O.S. et ETO, avec le compte de secours si le principal est refusé), voix, liens Zeus/Moodle, adresse du PC (Wi-Fi + Tailscale),
jeton d'appairage et empreinte du certificat. Le téléphone doit ensuite être approuvé sur le PC (Réglages › Appareils de confiance).
"""
import argparse
import base64
import html
import http.server
import json
import os
import secrets
import socket
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"            # sans 0/O/1/I : le code se lit sur un écran puis se tape
ITER = 300000                                              # identique à Importer.java
LIFETIME = 600


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
    except Exception:
        pass
    return ""


def eleven_ok(key):
    import httpx
    import nasko_core
    try:
        r = httpx.get("https://api.elevenlabs.io/v1/voices", headers={"xi-api-key": key}, timeout=15, verify=nasko_core.ssl_context())
        return r.json().get("voices", []) if r.status_code == 200 else None
    except Exception:
        return None


def build_bundle():
    import nasko_cert
    import nasko_core
    import nasko_security as sec
    cfg = nasko_core.load_config()
    notes = []
    vault, settings = {}, {}
    if cfg.get("llm_api_key"):
        vault["groq"] = cfg["llm_api_key"]
        if cfg.get("llm_model"):
            settings["model"] = cfg["llm_model"]
    else:
        notes.append("Groq : pas de clé dans la config du PC")

    # ElevenLabs E.N.O.S. : clé principale si elle fonctionne, sinon le compte de secours (voix retrouvée par son nom)
    main, backup = cfg.get("elevenlabs_api_key", ""), cfg.get("elevenlabs_backup_api_key", "")
    voices = eleven_ok(main) if main else None
    if main and voices is not None:
        vault["eleven_enos"] = main
        settings.update(voice_enos=cfg.get("elevenlabs_voice_id", "") or (voices[0]["voice_id"] if voices else ""), voice_name_enos=cfg.get("elevenlabs_voice_name", ""))
        notes.append("ElevenLabs E.N.O.S. : clé principale valide")
    elif backup:
        bv = eleven_ok(backup)
        if bv is not None:
            want = (cfg.get("elevenlabs_backup_voice_id") or "").strip()
            name = (cfg.get("elevenlabs_backup_voice_name") or "ENOS2").strip().lower()
            vid = want or next((v["voice_id"] for v in bv if v.get("name", "").strip().lower() == name), "")
            vault["eleven_enos"] = backup
            settings.update(voice_enos=vid, voice_name_enos=cfg.get("elevenlabs_backup_voice_name") or "ENOS2")
            notes.append("ElevenLabs E.N.O.S. : clé principale refusée → compte de secours envoyé" + ("" if vid else " (voix introuvable : à choisir sur le téléphone)"))
        else:
            notes.append("ElevenLabs E.N.O.S. : clés principale ET de secours refusées")
    elif main:
        vault["eleven_enos"] = main
        notes.append("ElevenLabs E.N.O.S. : clé non vérifiée (hors ligne ?), envoyée telle quelle")
    eto = cfg.get("elevenlabs_eto_api_key", "")
    if eto:
        vault["eleven_eto"] = eto
        settings.update(voice_eto=cfg.get("elevenlabs_eto_voice_id", ""), voice_name_eto="ETO")
        notes.append("ElevenLabs ETO : " + ("clé valide" if eleven_ok(eto) is not None else "clé refusée ou injoignable (envoyée quand même)"))
    for k_cfg, k_vault, label in (("zeus_ics_url", "ics_zeus", "Zeus"), ("moodle_ics_url", "ics_moodle", "Moodle")):
        if cfg.get(k_cfg):
            vault[k_vault] = cfg[k_cfg]
        else:
            notes.append(f"{label} : pas de lien .ics dans la config")
    port = int(cfg.get("https_port", 8443) or 8443)
    addrs = [f"{lan_ip()}:{port}"] + ([f"{tailscale_ip()}:{port}"] if tailscale_ip() else [])
    pin = nasko_cert.fingerprint(os.path.join(nasko_core.data_dir(), "certs"))
    if not cfg.get("allow_network_access"):
        notes.append("⚠ « Accès téléphone » est désactivé sur le PC : active-le (panneau ACCÈS TÉLÉPHONE) pour que le téléphone puisse s'y connecter")
    vault["pc_token"] = sec.pairing_token()
    return {"v": 1, "name": cfg.get("user_label", ""), "vault": vault, "settings": settings, "pc": {"addrs": ", ".join(addrs), "pin": pin}}, notes


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
<title>E.N.O.S. · import</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050506;color:#ececef;font:17px/1.45 system-ui,sans-serif;padding:20px;box-sizing:border-box}
.c{max-width:440px;width:100%;background:linear-gradient(165deg,#151518,#0e0e10);border:1px solid #27272c;border-radius:18px;padding:26px}
h1{margin:0 0 6px;font:400 15px monospace;letter-spacing:3px;color:#e0243c}p{color:#9a9aa4;margin:8px 0 18px}
a.b{display:block;text-align:center;padding:16px;border-radius:14px;background:linear-gradient(120deg,#8c1328,#d71f3a);color:#fff;font-weight:700;letter-spacing:2px;text-decoration:none}
details{margin-top:18px;color:#9a9aa4}textarea{width:100%;height:90px;margin-top:10px;background:#0a0a0c;color:#ececef;border:1px solid #27272c;border-radius:10px;font:12px monospace;box-sizing:border-box}
button{margin-top:8px;padding:10px 14px;border-radius:10px;border:1px solid #27272c;background:#18181b;color:#ececef;font-weight:700}
</style></head><body><div class="c"><h1>E.N.O.S</h1><b>Configuration prête</b>
<p>Appuie sur le bouton : l'application s'ouvre et te demande le <b>code affiché sur l'écran du PC</b>.</p>
<a class="b" href="intent://import?d=__B__#Intent;scheme=enos;package=com.nasko.app;end">OUVRIR DANS E.N.O.S.</a>
<details><summary>Le bouton ne fait rien ?</summary><p>Copie le fichier, ouvre E.N.O.S. › ⚙ Réglages › IMPORTER DEPUIS LE PC, colle-le.</p>
<textarea id="t" readonly onclick="this.select()">__B__</textarea><button onclick="navigator.clipboard&&navigator.clipboard.writeText(document.getElementById('t').value);this.textContent='Copié ✓'">COPIER LE FICHIER</button></details>
</div></body></html>"""


def main():
    ap = argparse.ArgumentParser(description="Envoie la configuration du PC au téléphone (chiffrée).")
    ap.add_argument("--ip", default="")
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--test", action="store_true", help="données factices (tests), rien n'est lu dans ta configuration")
    a = ap.parse_args()

    if a.test:
        bundle, notes = {"v": 1, "name": "Test", "vault": {"groq": "gsk_TESTKEY", "pc_token": "NK1." + "A" * 43 + "." + "B" * 43}, "settings": {"model": "m"},
                         "pc": {"addrs": "192.168.1.2:8443", "pin": ":".join(["AB"] * 32)}}, []
    else:
        print("\n  Lecture de ta configuration et vérification des clés ElevenLabs…")
        bundle, notes = build_bundle()
    raw_code = "".join(secrets.choice(ALPHABET) for _ in range(10))
    code = raw_code[:5] + "-" + raw_code[5:]
    blob = encrypt(bundle, raw_code)
    token = secrets.token_urlsafe(10)
    first = {"t": 0.0}

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
            if not first["t"]:
                first["t"] = time.time()
                print("  Le téléphone a ouvert la page : tape le code dans l'application.")

    srv = http.server.ThreadingHTTPServer(("0.0.0.0", a.port), H)
    ip = a.ip or lan_ip()
    url = f"http://{ip}:{srv.server_address[1]}/{token}/"
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    for n in notes:
        print("   · " + n)
    print(f"\n  ┌──────────────────────────────────────┐\n  │   CODE À TAPER SUR LE TÉLÉPHONE :  {code}  │\n  └──────────────────────────────────────┘")
    try:
        import segno
        png = os.path.join(tempfile.gettempdir(), "enos_cles_qr.png")
        segno.make(url, error="m").save(png, scale=12, border=3, dark="#000000", light="#ffffff")       # le QR ne contient que l'adresse de la page : aucun secret
        if not a.no_open and hasattr(os, "startfile"):
            os.startfile(png)
        print("\n  1) Scanne le QR code (image ouverte sur le PC) avec l'appareil photo du téléphone.")
    except ImportError:
        print(f"\n  1) Ouvre ce lien sur le téléphone : {url}")
    print("  2) Appuie sur « OUVRIR DANS E.N.O.S. » — l'application demande le code ci-dessus.")
    print(f"  (Lien actif {LIFETIME // 60} min, ou 2 min après l'ouverture de la page. Ctrl+C pour annuler.)\n")
    if a.test:
        print("TESTINFO", url, code, flush=True)
    try:
        end = time.time() + LIFETIME
        while time.time() < end and not (first["t"] and time.time() - first["t"] > 120):
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    srv.shutdown()
    try:
        os.remove(os.path.join(tempfile.gettempdir(), "enos_cles_qr.png"))
    except OSError:
        pass
    print("  Terminé : le lien est fermé.")


if __name__ == "__main__":
    main()
