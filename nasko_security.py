"""Sécurité de E.N.O.S. : clé d'appairage persistante (DPAPI), tickets média, confinement des chemins, AES-256-GCM, limiteur de débit.

Modèle de menace : un script/malware local ou un appareil du réseau qui appelle l'API sans y être invité.
  - Clé d'API (Bearer) : 256 bits aléatoires, créée une fois, stockée chiffrée par Windows (DPAPI, liée à CE compte utilisateur)
    dans %LOCALAPPDATA%\\NASKO (hors du dossier OneDrive de l'application, donc jamais synchronisée dans le cloud).
  - Elle n'est JAMAIS servie par HTTP à un client local : la fenêtre native la reçoit par le pont pywebview.
  - Clé de chiffrement (AES-256-GCM) : seconde clé indépendante, jamais envoyée sur le réseau (jeton d'appairage = api + enc).
Limite honnête : un processus qui s'exécute SOUS VOTRE COMPTE peut lire des fichiers que vous lisez vous-même ; ce module protège
contre tout ce qui n'a pas cet accès (scripts réseau, pages web, autres comptes, requêtes forgées).
"""
import base64
import ctypes
import ctypes.wintypes as wt
import hmac
import json
import logging
import os
import re
import secrets
import struct
import subprocess
import threading
import time
from collections import deque
from datetime import datetime
from hashlib import sha256
from urllib.parse import unquote

from nasko_core import app_dir, data_dir, load_config

log = logging.getLogger("nasko.security")
lock = threading.RLock()
PREFIX = "NK1"


def _b64(b):
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


# ============================================================================= 1. clé d'appairage (DPAPI)
class _Blob(ctypes.Structure):
    _fields_ = [("cbData", wt.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


_ENTROPY = b"N.A.S.K.O/security/v1"            # valeur INTERNE (jamais affichée) : inchangée pour que les anciennes versions (NASKO.exe) et E.N.O.S. partagent la même clé
_ENTROPY_ALT = b"E.N.O.S./security/v1"          # lue aussi (ancienne build intermédiaire) puis réécrite avec la valeur ci-dessus


def _dpapi(data, protect, entropy=None):
    entropy = entropy or _ENTROPY
    crypt32, k32 = ctypes.WinDLL("crypt32", use_last_error=True), ctypes.WinDLL("kernel32")
    buf = ctypes.create_string_buffer(data, len(data))
    inb = _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    ent = ctypes.create_string_buffer(entropy, len(entropy))
    entb = _Blob(len(entropy), ctypes.cast(ent, ctypes.POINTER(ctypes.c_char)))
    out = _Blob()
    fn = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    if not fn(ctypes.byref(inb), None, ctypes.byref(entb), None, None, 0, ctypes.byref(out)):
        raise OSError(ctypes.get_last_error(), "DPAPI")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        k32.LocalFree(out.pbData)


def key_dir():
    base = os.environ.get("LOCALAPPDATA") or data_dir()
    d = os.path.join(base, "NASKO")
    os.makedirs(d, exist_ok=True)
    return d


def key_path():
    return os.path.join(key_dir(), "security.bin")


def _lock_acl(path):
    """Accès réservé à l'utilisateur courant (hérite supprimé). Au mieux : sans effet bloquant si icacls échoue."""
    try:
        user = os.environ.get("USERNAME", "")
        if user:
            subprocess.run(["icacls", path, "/inheritance:r", "/grant:r", f"{user}:(F)"], capture_output=True, timeout=15,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except Exception as e:
        log.info("ACL non appliquée : %s", e)


_KEYS = {}


def _generate():
    return {"api": secrets.token_bytes(32), "enc": secrets.token_bytes(32), "created": datetime.now().isoformat(timespec="seconds")}


def _save(keys):
    raw = json.dumps({"api": _b64(keys["api"]), "enc": _b64(keys["enc"]), "created": keys["created"]}).encode()
    try:
        blob, mode = _dpapi(raw, True), "dpapi"
    except OSError:
        blob, mode = raw, "clair"                                     # DPAPI indisponible (très rare) : on garde l'ACL seule
        log.warning("DPAPI indisponible : clé stockée sans chiffrement Windows (ACL utilisateur uniquement)")
    p = key_path()
    tmp = p + ".tmp"
    with open(tmp, "wb") as f:
        f.write(b"NKS1" + (b"D" if mode == "dpapi" else b"P") + blob)
    os.replace(tmp, p)
    _lock_acl(p)


def _load_file():
    with open(key_path(), "rb") as f:
        raw = f.read()
    if raw[:4] != b"NKS1":
        raise ValueError("format inconnu")
    body = raw[5:]
    migrate = False
    if raw[4:5] == b"D":
        try:
            plain = _dpapi(body, False)
        except OSError:
            plain, migrate = _dpapi(body, False, _ENTROPY_ALT), True
    else:
        plain = body
    data = json.loads(plain.decode())
    if migrate:
        _save({"api": _unb64(data["api"]), "enc": _unb64(data["enc"]), "created": data.get("created", "")})
    return {"api": _unb64(data["api"]), "enc": _unb64(data["enc"]), "created": data.get("created", "")}


def keys():
    """Clés courantes (créées au premier appel). Un fichier illisible/corrompu est régénéré : les appareils devront se ré-appairer."""
    with lock:
        if _KEYS:
            return _KEYS
        try:
            _KEYS.update(_load_file())
        except (OSError, ValueError, KeyError):
            _KEYS.update(_generate())
            _save(_KEYS)
            log.warning("Nouvelle clé d'appairage générée : %s", key_path())
        return _KEYS


def rotate():
    """Nouvelle paire de clés : tous les appareils (APK) doivent coller le nouveau jeton."""
    with lock:
        _KEYS.clear()
        _KEYS.update(_generate())
        _save(_KEYS)
        STATS["rotations"] += 1
        event("rotation", "-", "", "clé d'appairage régénérée")
        return _KEYS


def api_key():
    return _b64(keys()["api"])


def pairing_token():
    k = keys()
    return f"{PREFIX}.{_b64(k['api'])}.{_b64(k['enc'])}"


def fingerprint():
    return sha256(keys()["api"]).hexdigest()[:12].upper()


def check_bearer(header_value):
    """Authorization: Bearer <clé d'API>, comparaison en temps constant. Le jeton d'appairage complet est REFUSÉ (il contient la clé AES)."""
    if not header_value or not header_value[:7].lower() == "bearer ":
        return False
    given = header_value[7:].strip()
    return hmac.compare_digest(given.encode(), api_key().encode())


# ----------------------------------------------------------------------------- tickets (images / audio : pas d'en-tête possible)
def make_ticket(ttl=900):
    exp = int(time.time()) + ttl
    sig = _b64(hmac.new(keys()["api"], f"ticket|{exp}".encode(), sha256).digest()[:16])
    return f"{exp}.{sig}", exp


def check_ticket(t):
    try:
        exp, sig = (t or "").split(".", 1)
        if int(exp) < time.time():
            return False
        good = _b64(hmac.new(keys()["api"], f"ticket|{exp}".encode(), sha256).digest()[:16])
        return hmac.compare_digest(sig, good)
    except (ValueError, TypeError):
        return False


# ============================================================================= 2. confinement des chemins
class PathDenied(Exception):
    pass


class PathMissing(PathDenied):
    """Chemin AUTORISÉ mais inexistant (404). Jamais levée pour un chemin hors zone : l'existence d'un fichier interdit ne se devine pas."""


def _norm(p):
    return os.path.normcase(os.path.realpath(p))


def sensitive_dirs():
    e = os.environ
    cands = [e.get("WINDIR"), e.get("SystemRoot"), os.path.join(e.get("SystemRoot", r"C:\Windows"), "System32"), e.get("ProgramFiles"),
             e.get("ProgramFiles(x86)"), e.get("ProgramData"), e.get("APPDATA"), e.get("LOCALAPPDATA")]
    home = os.path.expanduser("~")
    cands += [os.path.join(home, d) for d in (".ssh", ".aws", ".gnupg", ".azure", ".kube", "NTUSER.DAT")]
    cands += [os.path.join(e.get("SystemDrive", "C:") + os.sep, "$Recycle.Bin"), os.path.join(e.get("SystemDrive", "C:") + os.sep, "System Volume Information")]
    return [_norm(c) for c in cands if c]


def _inside(child, root):
    try:
        return os.path.commonpath([child, root]) == root
    except ValueError:                                                # lecteurs différents
        return False


_GRANTS = {}                                    # chemin réel -> expiration : sélections faites dans une boîte de dialogue NATIVE


def grant(path, ttl=8 * 3600):
    """Autorise un fichier/dossier choisi par l'utilisateur dans le sélecteur natif de Windows (action impossible à forger par HTTP)."""
    if path:
        with lock:
            _GRANTS[_norm(path)] = time.time() + ttl


def _extra_roots():
    cfg = load_config()
    roots = [cfg.get("project_dir") or "", cfg.get("warehouse_dir") or ""] + list(cfg.get("allowed_roots") or [])
    try:
        with open(os.path.join(data_dir(), "projects.json"), encoding="utf-8") as f:
            roots += [x.get("path", "") for x in json.load(f)]
    except (OSError, ValueError):
        pass
    try:
        import nasko_imagefactory
        roots += [d["path"] for d in nasko_imagefactory.destinations()]       # « Binageux » et « Jeu Projet »
    except Exception:
        pass
    a = app_dir()
    roots += [os.path.join(a, d) for d in ("Traitement d'image", "Compression", "Audio", "Stockage")]
    return [r for r in roots if r]


def allowed_roots():
    out = []
    for r in _extra_roots():
        try:
            n = _norm(r)
        except (OSError, ValueError):
            continue
        if n not in out:
            out.append(n)
    return out


def safe_path(path, kind="any", must_exist=True, roots=None):
    """Chemin réel (après résolution des liens/jonctions) STRICTEMENT à l'intérieur d'un dossier autorisé, sinon PathDenied.
    Refuse : octet nul, segments « .. », flux NTFS (:), chemins UNC/préfixe \\\\?\\, et toute zone sensible de Windows (System32, AppData…)."""
    s = str(path or "").strip().strip('"')
    if not s or "\0" in s:
        raise PathDenied("chemin vide ou invalide")
    if re.search(r"(^|[\\/])\.\.([\\/]|$)", s):
        raise PathDenied("segments « .. » interdits")
    if s.startswith(("\\\\", "//")):
        raise PathDenied("chemin réseau/UNC interdit")
    if ":" in s[2:]:
        raise PathDenied("flux de données alternatif interdit")
    real = _norm(os.path.abspath(s))
    for bad in sensitive_dirs():
        if _inside(real, bad):
            raise PathDenied("zone système protégée")
    now = time.time()
    with lock:
        for g in [g for g, exp in _GRANTS.items() if exp < now]:
            _GRANTS.pop(g, None)
        granted = list(_GRANTS)
    if not any(_inside(real, r) for r in (roots if roots is not None else allowed_roots()) + granted):
        raise PathDenied("en dehors des dossiers autorisés (Binageux, Jeu Projet, projets, dossiers de travail) : utilisez le bouton PARCOURIR")
    if must_exist:
        if kind == "file" and not os.path.isfile(real):
            raise PathMissing("fichier introuvable")
        if kind == "dir" and not os.path.isdir(real):
            raise PathMissing("dossier introuvable")
        if kind == "any" and not os.path.exists(real):
            raise PathMissing("introuvable")
    return real


_TRAV = re.compile(r"(^|[\\/])\.\.([\\/]|$)|%00|\x00", re.I)
_SENS = re.compile(r"(system32|[\\/]windows[\\/]|\\appdata\\|[\\/]\.ssh|ntuser\.dat|sam\b|\\config\\system)", re.I)


def looks_hostile(raw_path, raw_query):
    """Détecteur grossier sur l'URL (chemin + requête, décodés deux fois) : ../ ou %00 combinés ou non à des zones système."""
    s = unquote(unquote(raw_path + "?" + (raw_query or "")))
    return bool(_TRAV.search(s)) or bool(_SENS.search(s))


# ============================================================================= 3. AES-256-GCM
from cryptography.exceptions import InvalidTag  # noqa: E402
from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: E402

CH = 1 << 20                                   # blocs de 1 Mio pour les fichiers
MAGIC = b"NKE1"
SKEW_MS = 15 * 60 * 1000                       # tolérance d'horloge de l'appareil (±15 min)
_SEEN = {}                                     # nonce -> expiration : rejette tout rejeu d'une requête chiffrée


class CryptoError(Exception):
    pass


def _sub(label):
    return hmac.new(keys()["enc"], label, sha256).digest()


def _aes(label):
    return AESGCM(_sub(label))


def env_open(enc_header, body, method, pathq):
    """Déchiffre le corps d'une requête (en-tête X-Nasko-Enc = '<ts_ms>.<nonce>'). Vérifie fraîcheur, rejeu et liaison à la route."""
    try:
        ts_s, nonce_s = enc_header.split(".", 1)
        ts, nonce = int(ts_s), _unb64(nonce_s)
        if len(nonce) != 12:
            raise ValueError
    except (ValueError, TypeError):
        raise CryptoError("en-tête de chiffrement invalide")
    now = int(time.time() * 1000)
    if abs(now - ts) > SKEW_MS:
        raise CryptoError("requête périmée (horloge de l'appareil ?)")
    with lock:
        for n in [n for n, e in _SEEN.items() if e < time.time()]:
            _SEEN.pop(n, None)
        if nonce_s in _SEEN:
            raise CryptoError("requête rejouée")
        _SEEN[nonce_s] = time.time() + SKEW_MS / 1000 * 2
    if not body:
        return b""
    try:
        return _aes(b"nasko-env-v1").decrypt(nonce, body, f"REQ|{ts}|{method}|{pathq}".encode())
    except InvalidTag:
        raise CryptoError("charge utile illisible (clé incorrecte ou données altérées)")


def env_seal(plain, enc_header, status):
    nonce = secrets.token_bytes(12)
    return nonce + _aes(b"nasko-env-v1").encrypt(nonce, plain, f"RES|{enc_header}|{status}".encode())


def meta_open(b64text, route):
    """Champ `meta` d'un envoi de fichier chiffré : JSON {name, mode, value, ts} protégé par la même clé."""
    try:
        raw = _unb64(b64text)
        data = _aes(b"nasko-env-v1").decrypt(raw[:12], raw[12:], f"META|{route}".encode())
        meta = json.loads(data.decode())
    except (InvalidTag, ValueError, TypeError):
        raise CryptoError("métadonnées illisibles")
    if abs(int(time.time() * 1000) - int(meta.get("ts", 0))) > SKEW_MS:
        raise CryptoError("envoi périmé")
    return meta


def _fnonce(prefix, i):
    return prefix + struct.pack(">I", i)


def _read_up_to(read, n):
    """Lit jusqu'à n octets (read() peut en rendre moins avant la fin du flux) ; b'' seulement à la fin."""
    out = b""
    while len(out) < n:
        part = read(n - len(out))
        if not part:
            break
        out += part
    return out


def encrypt_stream(read, chunk=CH):
    """Générateur : lit via read(n) et produit le flux NKE1 (en-tête + blocs AES-GCM ; le dernier bloc est marqué, donc toute troncature se détecte)."""
    aes, prefix, i = _aes(b"nasko-file-v1"), secrets.token_bytes(8), 0
    yield MAGIC + prefix
    cur = _read_up_to(read, chunk)
    while True:
        nxt = _read_up_to(read, chunk) if len(cur) == chunk else b""
        final = 0 if nxt else 1
        yield aes.encrypt(_fnonce(prefix, i), cur, bytes([70, final]) + struct.pack(">I", i))
        if final:
            return
        cur, i = nxt, i + 1


def encrypted_size(n, chunk=CH):
    return 12 + n + 16 * max(1, -(-n // chunk))


def decrypt_stream(read, write, limit=None):
    """Déchiffre un flux NKE1 vers write(). Refuse toute altération, réordonnancement ou troncature. Retourne le nombre d'octets en clair."""
    head = _read_up_to(read, 12)
    if len(head) != 12 or head[:4] != MAGIC:
        raise CryptoError("flux chiffré invalide")
    aes, prefix, i, total, block = _aes(b"nasko-file-v1"), head[4:], 0, 0, CH + 16
    cur = _read_up_to(read, block)
    while True:
        if not cur:
            raise CryptoError("flux tronqué")
        nxt = _read_up_to(read, block) if len(cur) == block else b""
        final = 0 if nxt else 1
        try:
            plain = aes.decrypt(_fnonce(prefix, i), cur, bytes([70, final]) + struct.pack(">I", i))
        except InvalidTag:
            raise CryptoError("fichier altéré, tronqué ou clé incorrecte")
        total += len(plain)
        if limit and total > limit:
            raise CryptoError("fichier trop volumineux")
        write(plain)
        if final:
            return total
        cur, i = nxt, i + 1


# ============================================================================= 4. limiteur de débit + journal
RL_LIMIT = 50                  # requêtes API par seconde et par source avant coupure
RL_WINDOW = 1.0
RL_BLOCK_REMOTE = 60           # secondes de coupure d'une adresse du réseau
RL_BLOCK_LOCAL = 30            # secondes de coupure des requêtes NON authentifiées venant de ce PC (jamais l'interface elle-même)
FAIL_LIMIT = 12                # échecs d'authentification en 10 s avant coupure (force brute)
LOOPBACK = ("127.0.0.1", "::1")

_HITS, _FAILS, _BLOCK = {}, {}, {}
STATS = {"unauthorized": 0, "blocked": 0, "hostile_paths": 0, "path_denied": 0, "crypto_errors": 0, "rotations": 0, "since": time.time()}
EVENTS = deque(maxlen=60)
ALERT = {"active": False, "kind": "", "ip": "", "rate": 0, "t": 0.0, "until": 0.0, "count": 0}


def event(kind, ip, path, detail=""):
    EVENTS.appendleft({"t": time.time(), "kind": kind, "ip": ip, "path": (path or "")[:120], "detail": detail[:160]})


def raise_alert(kind, ip, rate, block_s, info=""):
    now = time.time()
    with lock:
        ALERT.update(active=True, kind=kind, ip=ip, rate=rate, t=now, until=now + block_s, count=ALERT["count"] + 1)
    event(kind, ip, "", (f"{rate} requêtes/s" if kind == "flood" else f"{rate} échecs d'authentification") + (f" · dernier : {info}" if info else ""))
    log.warning("ALERTE SÉCURITÉ %s depuis %s (%s) : coupure %ds", kind, ip, rate, block_s)


def dismiss_alert():
    with lock:
        ALERT["active"] = False


def blocked(ip, authed):
    """True si cette requête doit être coupée. Les requêtes authentifiées de CE PC ne sont jamais coupées (sinon l'interface se bloquerait)."""
    with lock:
        until = _BLOCK.get(ip, 0)
        if until <= time.time():
            _BLOCK.pop(ip, None)
            return False
    return not (authed and ip in LOOPBACK)


def hit(ip, authed):
    """Compte une requête API ; déclenche la coupure au-delà de RL_LIMIT/s. Retourne la durée de coupure déclenchée (0 sinon)."""
    now = time.time()
    with lock:
        q = _HITS.setdefault(ip, deque())
        q.append(now)
        while q and q[0] < now - RL_WINDOW:
            q.popleft()
        if len(q) > RL_LIMIT and ip not in _BLOCK:
            dur = RL_BLOCK_LOCAL if ip in LOOPBACK else RL_BLOCK_REMOTE
            _BLOCK[ip] = now + dur
            n = len(q)
            q.clear()
        else:
            return 0
    raise_alert("flood", ip, n, dur)
    return dur


def fail(ip, info=""):
    """Compte un échec d'authentification (force brute) : coupe les requêtes non authentifiées de cette source.
    `info` (chemin + agent) est conservé dans le journal pour identifier l'émetteur."""
    now = time.time()
    with lock:
        STATS["unauthorized"] += 1
        q = _FAILS.setdefault(ip, deque())
        q.append(now)
        while q and q[0] < now - 10:
            q.popleft()
        if len(q) >= FAIL_LIMIT and ip not in _BLOCK:
            dur = RL_BLOCK_LOCAL if ip in LOOPBACK else RL_BLOCK_REMOTE
            _BLOCK[ip] = now + dur
            n = len(q)
            q.clear()
        else:
            return 0
    raise_alert("bruteforce", ip, n, dur, info)
    return dur


def status():
    now = time.time()
    with lock:
        a = dict(ALERT)
        a["live"] = a["active"] and now < a["t"] + 120
        a["remaining"] = max(0, int(a["until"] - now))
        return {"alert": a, "stats": dict(STATS), "events": list(EVENTS)[:25], "blocked": {ip: int(u - now) for ip, u in _BLOCK.items() if u > now}}
