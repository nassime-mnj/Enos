"""Échanges PC <-> mobile : réception d'uploads (flux, sans tout charger en mémoire), liens de téléchargement temporaires,
dossiers Stockage/Réception_Mobile et Stockage/Ambiance_Audio. Brique commune : les outils (compression…) l'utilisent
pour accepter un fichier envoyé par le téléphone au lieu d'un chemin local."""
import os
import re
import secrets
import shutil
import threading
import time
from urllib.parse import quote

from nasko_core import app_dir, load_config

STOCK = os.path.join(app_dir(), "Stockage")
RECV = os.path.join(STOCK, "Réception_Mobile")
AMBI = os.path.join(STOCK, "Ambiance_Audio")
AUDIO_EXTS = (".mp3", ".wav", ".ogg", ".oga", ".flac", ".m4a", ".aac", ".opus", ".wma")
CHUNK = 1024 * 1024
DEFAULT_MAX_MB = 4096
DEFAULT_TTL_MIN = 30
_RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}

lock = threading.Lock()
SHARES = {}                       # token -> {token, path, name, size, created, expires, kind, hits}
_up_slots = threading.Semaphore(2)    # au plus 2 uploads simultanés : un téléphone qui envoie 3 vidéos ne doit pas saturer le disque/CPU


class SyncError(Exception):
    pass


class TooLarge(SyncError):
    pass


def ensure_dirs():
    for d in (RECV, AMBI):
        os.makedirs(d, exist_ok=True)


def max_bytes():
    return int(float(load_config().get("sync_max_mb", DEFAULT_MAX_MB)) * 1024 * 1024)


# ----------------------------------------------------------------------------- noms de fichiers
def safe_filename(name):
    """Nom de fichier Windows sûr : jamais de chemin, de caractère interdit ni de nom réservé."""
    base = os.path.basename((name or "").replace("\\", "/"))
    base = "".join(c for c in base if c not in '<>:"/\\|?*' and ord(c) >= 32).strip().rstrip(". ")
    stem, ext = os.path.splitext(base)
    if not stem or stem.lower() in _RESERVED:
        stem = "fichier" if not stem else stem + "_"
    return (stem[:120] + ext[:12]) if base else "fichier"


def unique_path(folder, name):
    base, ext = os.path.splitext(name)
    out, n = os.path.join(folder, name), 2
    while os.path.exists(out):
        out = os.path.join(folder, f"{base} ({n}){ext}")
        n += 1
    return out


# ----------------------------------------------------------------------------- réception
def save_upload(upload, dest_dir, limit=None, name=None, decrypt=False):
    """Enregistre un fastapi UploadFile par blocs de 1 Mo dans `dest_dir` ; refuse au-delà de `limit` octets.
    Écrit d'abord en .part puis renomme : un envoi interrompu ne laisse jamais de fichier tronqué visible.
    `decrypt` : le fichier reçu est un flux AES-256-GCM (NKE1), déchiffré à la volée ; `name` = nom réel (transmis chiffré)."""
    limit = limit or max_bytes()
    os.makedirs(dest_dir, exist_ok=True)
    dst = unique_path(dest_dir, safe_filename(name or upload.filename))
    part, size = dst + ".part", 0
    with _up_slots:
        try:
            with open(part, "wb") as f:
                if decrypt:
                    import nasko_security
                    size = nasko_security.decrypt_stream(upload.file.read, f.write, limit)       # lève CryptoError si altéré / tronqué
                    if size > limit:
                        raise TooLarge(f"Fichier trop volumineux (maximum {limit // 1048576} Mo, réglable avec sync_max_mb).")
                while not decrypt:
                    chunk = upload.file.read(CHUNK)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > limit:
                        raise TooLarge(f"Fichier trop volumineux (maximum {limit // 1048576} Mo, réglable avec sync_max_mb).")
                    f.write(chunk)
            if size == 0:
                raise SyncError("Fichier vide.")
            os.replace(part, dst)
        except BaseException:
            try:
                os.remove(part)
            except OSError:
                pass
            raise
    return dst, size


def list_received(limit=200):
    ensure_dirs()
    out = []
    for n in os.listdir(RECV):
        p = os.path.join(RECV, n)
        if os.path.isfile(p) and not n.endswith(".part"):
            out.append({"name": n, "size": os.path.getsize(p), "t": os.path.getmtime(p)})
    return sorted(out, key=lambda x: -x["t"])[:limit]


# ----------------------------------------------------------------------------- liens de téléchargement temporaires
def _purge():
    now = time.time()
    for t in [t for t, s in SHARES.items() if s["expires"] < now]:
        SHARES.pop(t, None)


def make_share(path, kind="manual", ttl_min=None):
    """Expose `path` sur /dl/<jeton>/<nom> pendant `ttl_min` minutes. Le jeton aléatoire est la seule clé d'accès."""
    if not os.path.isfile(path):
        raise SyncError("Fichier introuvable.")
    ttl = float(ttl_min or load_config().get("share_ttl_min", DEFAULT_TTL_MIN))
    name = safe_filename(os.path.basename(path))
    token = secrets.token_urlsafe(18)
    now = time.time()
    with lock:
        _purge()
        SHARES[token] = {"token": token, "path": os.path.abspath(path), "name": name, "size": os.path.getsize(path), "created": now,
                         "expires": now + ttl * 60, "kind": kind, "hits": 0}
    return SHARES[token]


def get_share(token):
    with lock:
        _purge()
        s = SHARES.get(token)
        if s and not os.path.isfile(s["path"]):
            SHARES.pop(token, None)
            return None
        if s:
            s["hits"] += 1
        return dict(s) if s else None


def list_shares(kind=None):
    with lock:
        _purge()
        return [dict(s) for s in sorted(SHARES.values(), key=lambda x: -x["created"]) if kind is None or s["kind"] == kind]


def revoke(token):
    with lock:
        return SHARES.pop(token, None) is not None


def share_path(share):
    return f"/dl/{share['token']}/{quote(share['name'])}"


# ----------------------------------------------------------------------------- Mode Chill
def chill_tracks():
    ensure_dirs()
    out = []
    for dp, dn, fs in os.walk(AMBI):
        dn[:] = [d for d in dn if not d.startswith(".")]
        for n in fs:
            if n.lower().endswith(AUDIO_EXTS):
                p = os.path.join(dp, n)
                rel = os.path.relpath(p, AMBI).replace("\\", "/")
                out.append({"id": rel, "name": os.path.splitext(n)[0], "folder": os.path.dirname(rel), "size": os.path.getsize(p)})
    key = lambda t: [int(x) if x.isdigit() else x.lower() for x in re.split(r"(\d+)", t["id"])]       # tri naturel : 2 avant 10
    return sorted(out, key=key)


def chill_file(rel):
    p = os.path.realpath(os.path.join(AMBI, rel))
    root = os.path.realpath(AMBI)
    if not os.path.normcase(p).startswith(os.path.normcase(root) + os.sep) or not p.lower().endswith(AUDIO_EXTS) or not os.path.isfile(p):
        raise SyncError("piste introuvable")
    return p
