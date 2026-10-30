"""APPAIRAGE DU TÉLÉPHONE EN UN SCAN : le bouton « APPAIRER LE TÉLÉPHONE » du PC affiche un QR code que l'application scanne (Réglages › SCANNER LE QR DU PC).

  PC  : fabrique un paquet CHIFFRÉ (clés Groq/ElevenLabs, liens .ics, adresses Wi-Fi + Tailscale, jeton, empreinte du certificat du PC, identifiant d'appareil),
        l'approuve d'avance comme « appareil de confiance » (donc Eto Dev, sans étape manuelle) et le place dans le QR (lien enos://pair?d=…&c=…).
  Tél : l'application scanne le QR, déchiffre en Java et range tout dans son coffre : aucune saisie d'adresse, aucun code à taper, AUCUN réseau commun requis.
Le QR n'existe que sur l'écran du PC, 10 minutes ; le paquet est AES-256-GCM (clé PBKDF2 300 000 tours). Pour joindre ensuite le PC hors du Wi-Fi (5G),
les deux appareils utilisent Tailscale : l'adresse 100.x du PC est dans le paquet et le téléphone essaie toutes les adresses dans l'ordre.
Si l'appairage n'aboutit pas (annulé / expiré), l'approbation d'avance est retirée.
"""
import base64
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
    if not ts:
        notes.append("Tailscale non détecté sur ce PC : le téléphone ne pourra le joindre qu'en Wi-Fi. Installe Tailscale (PC + téléphone) pour l'accès en 5G")
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
    t0 = time.time()
    nasko_team.approve(device_id, "Téléphone (appairage)")                 # approuvé d'avance : plus d'étape manuelle ; retiré si l'appairage n'aboutit pas
    link = f"enos://pair?d={blob}&c={raw}"
    qr = ""
    try:
        import segno
        qr = segno.make(link, error="l", micro=False).svg_data_uri(scale=6, border=3, dark="#000000", light="#ffffff")
    except ImportError:
        pass
    with _lock:
        _R.update(state="idle", name="")
        _S.clear()
        _S.update(active=True, srv=None, device=device_id, t0=t0, opened=0.0, expires=t0 + LIFETIME, notes=notes, code=code)
    threading.Thread(target=_reaper, args=(device_id,), daemon=True, name="pairing-reaper").start()
    return {"link": link, "code": code, "qr": qr, "notes": notes, "expires": LIFETIME}


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
