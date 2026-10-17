"""Profils d'utilisation d'E.N.O.S. : CEO · Dev · Friends.

Ce profil est une SURCOUCHE qui s'applique à tout le monde, y compris à la machine locale (127.0.0.1) : la règle « le PC a toujours accès à tout »
n'ouvre plus rien tant que le profil actif ne l'autorise pas.

  CEO      accès total (seul profil ayant « API Control Panel » et « Notes de frais »).
  Dev      tout sauf API Control Panel et Notes de frais (cleaner, Google, agenda, Terna… agissent sur SON PC).
  Friends  Agenda (le leur, séparé), Éditeur PDF, Studio média, Outils rapides, Syllabus Scanner, assistant IA de base, réglages d'apparence.
           Tout le reste est refusé (liste blanche : une route inconnue est refusée).

Application côté serveur par RoleGate (middleware ASGI : HTTP ET WebSocket) d'après la table PREFIX_CAPS ci-dessous ; côté interface par des classes CSS
(`ceo-only`, `dev-ok`, `friends-ok`) posées sur <body class="role-…">. Seule la garde serveur compte : le masquage visuel est un confort.

Stockage : data/role.json (rôle SIGNÉ par HMAC avec data/role.key + codes PIN hachés PBKDF2) — propre à chaque machine, jamais partagé
(contrairement à enos_profiles.json, conçu pour être partagé entre associés). Un rôle altéré à la main est refusé (retour au choix de profil).
Limite honnête : c'est une barrière de profil, pas une protection contre quelqu'un qui contrôle la machine et le code (il peut supprimer data/role.*).
"""
import hashlib
import hmac
import json
import logging
import os
import secrets
import threading
import time

import nasko_core

log = logging.getLogger("nasko.roles")

ROLES = ("ceo", "dev", "friends")
LABELS = {"ceo": "CEO", "dev": "Dev", "friends": "Friends"}
DESCRIPTIONS = {"ceo": "Accès total", "dev": "Tout sauf API Control Panel et Notes de frais",
                "friends": "Agenda, Éditeur PDF, Studio média, Outils rapides, assistant IA"}
PIN_MIN = 4
PIN_ITER = 200_000
MAX_FAILS, LOCK_S = 5, 60

# ------------------------------------------------------------------ capacités
ALL_CAPS = ("core", "ai", "agenda", "syllabus", "pdf", "studio", "quick", "settings_basic", "update",
            "receipts", "apimon", "google", "system", "devtools", "leisure", "creator", "cloud", "mirror", "gaming")
FRIENDS_CAPS = frozenset({"core", "ai", "agenda", "syllabus", "pdf", "studio", "quick", "settings_basic", "update", "cloud"})
DEV_CAPS = frozenset(ALL_CAPS) - {"receipts", "apimon"}
CEO_CAPS = frozenset(ALL_CAPS)
ROLE_CAPS = {"ceo": CEO_CAPS, "dev": DEV_CAPS, "friends": FRIENDS_CAPS}

# Chemin -> capacité (le préfixe le plus long l'emporte). Tout chemin /api, /ws ou /ext absent de cette table est REFUSÉ au profil Friends.
PREFIX_CAPS = (
    # --- socle (tous les profils)
    ("/api/status", "core"), ("/api/edition", "core"), ("/api/ping", "core"), ("/api/app", "core"), ("/api/shutdown", "core"), ("/api/security/ticket", "core"),
    ("/api/device", "core"), ("/api/role", "core"),
    # --- assistant IA de base et voix
    ("/api/chat", "ai"), ("/api/history", "ai"), ("/api/stt", "ai"), ("/api/voice", "ai"), ("/api/tts", "ai"),
    # --- agenda (le leur) et notifications
    ("/api/agenda", "agenda"), ("/api/agent", "agenda"), ("/api/epita", "agenda"), ("/api/background", "agenda"), ("/api/notify", "agenda"),
    ("/api/syllabus", "syllabus"),
    # --- documents et média
    ("/api/pdf", "pdf"), ("/api/studio", "studio"),
    ("/api/receipts", "receipts"),
    # --- réglages
    ("/api/settings/language", "settings_basic"), ("/api/settings/persona", "settings_basic"), ("/api/settings/welcome", "settings_basic"),
    ("/api/onboarding", "settings_basic"),
    ("/api/settings", "system"),                       # profil / chemins des outils (Godot, projets…)
    ("/api/update", "update"), ("/api/ota", "update"),
    # --- clés facturées
    ("/api/apimon", "apimon"),
    # --- Google
    ("/api/tabs", "google"), ("/ext", "google"),
    # --- système et PC
    ("/api/sys", "system"), ("/api/cleaner", "system"), ("/api/power", "system"), ("/api/org", "system"), ("/api/mobile", "system"),
    ("/api/discord", "system"), ("/api/network", "system"), ("/api/trusted-ips", "system"), ("/api/devices", "system"), ("/api/pair", "system"),
    ("/api/security", "system"), ("/api/sync", "system"), ("/api/team", "system"),
    # --- développement et projet de jeu (Terna)
    ("/api/projects", "devtools"), ("/api/files", "devtools"), ("/api/file", "devtools"), ("/api/godot", "devtools"), ("/api/f6", "devtools"),
    ("/api/env", "devtools"), ("/api/tasks", "devtools"), ("/api/git", "devtools"), ("/api/godotsync", "devtools"), ("/api/pack", "devtools"),
    ("/api/colis", "devtools"), ("/api/warehouse", "devtools"), ("/api/devchat", "devtools"), ("/api/channel", "devtools"), ("/api/dev", "devtools"), ("/api/depot", "devtools"), ("/ws/depot-term", "devtools"),
    ("/api/site", "devtools"), ("/api/assistant", "devtools"), ("/api/imgproc", "devtools"), ("/api/anim", "devtools"), ("/api/audio", "devtools"),
    ("/api/screen", "devtools"), ("/api/narration", "devtools"), ("/ws/chat", "devtools"),
    # --- création avancée, jeux et loisirs
    ("/api/cloud", "cloud"), ("/api/mirror", "mirror"), ("/api/clipper", "gaming"), ("/api/babel", "gaming"), ("/api/tilt", "gaming"), ("/api/brb", "gaming"), ("/api/compress", "creator"), ("/api/youtube", "creator"),
    ("/api/chess", "leisure"), ("/api/study", "leisure"), ("/api/pet", "leisure"), ("/api/chill", "leisure"), ("/ws/chess", "leisure"), ("/ws/pet", "leisure"),
    ("/api/mobile/chess", "leisure"),
)
_SORTED = tuple(sorted(PREFIX_CAPS, key=lambda x: -len(x[0])))
GUARDED_ROOTS = ("/api", "/ws", "/ext")          # le reste (page, /static, /dl, /login…) n'est pas une donnée : non gardé


def capability_for(path):
    """Capacité requise pour `path` (None : chemin non mappé). Un préfixe ne correspond qu'à une frontière de segment (/api/pdf, pas /api/pdfx)."""
    for pre, cap in _SORTED:
        if path == pre or path.startswith(pre + "/"):
            return cap
    return None


def is_guarded(path):
    return any(path == r or path.startswith(r + "/") for r in GUARDED_ROOTS)


def allowed(role, path):
    """(autorisé, capacité). `role` None (aucun profil choisi) = Friends."""
    if not is_guarded(path):
        return True, None
    if "//" in path or "/./" in path or "/../" in path or path.endswith(("/..", "/.")):
        return role in ("ceo", "dev"), None                      # chemin tordu : jamais pour Friends (il ne correspondrait de toute façon à aucune route)
    cap = capability_for(path)
    eff = role if role in ROLES else "friends"
    if cap is None:
        return eff != "friends", None                            # inconnu : refusé à Friends (liste blanche), toléré aux profils complets
    return cap in ROLE_CAPS[eff], cap


# ------------------------------------------------------------------ état persistant (rôle signé + codes PIN)
_lock = threading.RLock()
_cache = {"mtime": None, "path": None, "data": None}
_fails = {}                      # role -> (échecs, verrouillé jusqu'à)
_hooks = []                      # callbacks(old, new) appelés après un changement de profil (nettoyage des sessions)


def _path(name):
    return os.path.join(nasko_core.data_dir(), name)


_keys = {}


def _key():
    p = _path("role.key")
    if p in _keys:
        return _keys[p]
    try:
        with open(p, "rb") as f:
            k = f.read()
        if len(k) >= 32:
            _keys[p] = k
            return k
    except OSError:
        pass
    k = secrets.token_bytes(32)
    with open(p, "wb") as f:
        f.write(k)
    try:
        os.chmod(p, 0o600)
    except OSError:
        pass
    _keys[p] = k
    return k


def _sig(role):
    return hmac.new(_key(), f"enos-role:{role}".encode(), hashlib.sha256).hexdigest()


def _load():
    """role.json (mis en cache tant que le fichier ne change pas : appelé à chaque requête). Ajoute la clé « _role » = rôle dont la signature est valide, sinon None."""
    p = _path("role.json")
    try:
        m = os.path.getmtime(p)
    except OSError:
        return {"_role": None}
    with _lock:
        if _cache["mtime"] == m and _cache["path"] == p and _cache["data"] is not None:
            return _cache["data"]
        try:
            with open(p, encoding="utf-8") as f:
                d = json.load(f)
            d = d if isinstance(d, dict) else {}
        except (OSError, ValueError):
            d = {}
        r = d.get("role")
        d["_role"] = r if r in ROLES and hmac.compare_digest(str(d.get("sig", "")), _sig(r)) else None
        _cache.update(mtime=m, path=p, data=d)
        return d


def _save(d):
    p = _path("role.json")
    tmp = p + ".tmp"
    with _lock:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({k: v for k, v in d.items() if k != "_role"}, f, ensure_ascii=False, indent=1)
        os.replace(tmp, p)
        _cache["mtime"] = None


_ED = {"mtime": None, "path": None, "val": "ceo"}


def _edition_path():
    try:
        import nasko_core
        return nasko_core.resource_path("enos_edition.json")
    except Exception:                                          # noqa: BLE001 — hors application (tests…) : pas de plafond
        return ""


def edition():
    """Édition livrée : 'friends' | 'dev' | 'ceo' (fichier enos_edition.json écrit par build_release.py --edition). Absent = arborescence de travail = 'ceo'."""
    p = _edition_path()
    try:
        m = os.path.getmtime(p)
    except OSError:
        return "ceo"
    if _ED["mtime"] != m or _ED["path"] != p:
        try:
            with open(p, encoding="utf-8") as f:
                v = json.load(f).get("edition")
        except (OSError, ValueError, AttributeError):
            v = None
        _ED.update(mtime=m, path=p, val=v if v in ROLES else "friends")      # fichier illisible / inconnu : on prend l'édition la plus restrictive
    return _ED["val"]


def available_roles():
    """Profils possibles dans CETTE édition : jamais au-dessus du plafond (un build Friends ne peut pas devenir CEO, même avec un role.json copié)."""
    top = ROLES.index(edition())                                # ROLES est classé du plus fort (ceo) au plus faible (friends)
    return tuple(r for r in ROLES if ROLES.index(r) >= top)


def current():
    """Profil actif : 'ceo' | 'dev' | 'friends' ; None si aucun n'a été choisi OU si le fichier a été altéré (signature invalide)."""
    av = available_roles()
    if len(av) == 1:                                           # édition à profil unique : pas de choix à faire
        return av[0]
    r = _load().get("_role")
    return r if r in av else (av[0] if r else None)           # profil enregistré au-dessus du plafond : ramené au plafond


def effective():
    """Profil appliqué : celui choisi, sinon Friends (le plus restrictif) en attendant le choix."""
    return current() or "friends"


def pins_set():
    d = _load().get("pins", {})
    return {r: bool(isinstance(d.get(r), dict) and d[r].get("hash")) for r in ("ceo", "dev")}


def caps(role=None):
    return sorted(ROLE_CAPS[role or effective()])


def can(cap, role=None):
    return cap in ROLE_CAPS[role or effective()]


class RoleError(Exception):
    """Message lisible, affiché tel quel."""


def _hash(pin, salt):
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), PIN_ITER).hex()


def _check_lock(role):
    n, until = _fails.get(role, (0, 0))
    if until > time.time():
        raise RoleError(f"Trop d'essais : réessayez dans {int(until - time.time()) + 1} s.")


def _set_pin(d, role, pin):
    if not isinstance(pin, str) or len(pin) < PIN_MIN or len(pin) > 64:
        raise RoleError(f"Le code doit contenir au moins {PIN_MIN} caractères.")
    salt = secrets.token_hex(16)
    d.setdefault("pins", {})[role] = {"salt": salt, "hash": _hash(pin, salt), "iter": PIN_ITER}


def _verify_pin(role, pin):
    _check_lock(role)
    rec = (_load().get("pins") or {}).get(role) or {}
    ok = bool(rec.get("hash") and isinstance(pin, str) and hmac.compare_digest(_hash(pin, rec["salt"]), rec["hash"]))
    with _lock:
        if ok:
            _fails.pop(role, None)
        else:
            n = _fails.get(role, (0, 0))[0] + 1
            _fails[role] = (n, time.time() + LOCK_S if n >= MAX_FAILS else 0)
            if n >= MAX_FAILS:
                _fails[role] = (0, time.time() + LOCK_S)
    if not ok:
        raise RoleError("Code incorrect.")


def select(role, pin="", new_pin=""):
    """Choisit le profil. Friends : libre. CEO / Dev : code requis ; au tout premier usage (aucun code défini) `new_pin` le crée."""
    if role not in ROLES:
        raise RoleError("Profil inconnu.")
    if role not in available_roles():
        raise RoleError("Ce profil n'existe pas dans cette édition d'E.N.O.S.")
    old = current()
    with _lock:
        d = {k: v for k, v in _load().items() if k != "_role"}
        if role in ("ceo", "dev"):
            if pins_set()[role]:
                _verify_pin(role, pin)
            else:
                _set_pin(d, role, new_pin)                    # première fois : l'utilisateur définit son code
        d["role"], d["sig"] = role, _sig(role)
        _save(d)
    log.info("Profil actif : %s", role)
    for fn in list(_hooks):
        try:
            fn(old, role)
        except Exception:                                      # noqa: BLE001 — un nettoyage raté ne doit pas bloquer le changement
            log.exception("Nettoyage au changement de profil")
    return role


def change_pin(role, pin, new_pin):
    if role not in ("ceo", "dev"):
        raise RoleError("Ce profil n'a pas de code.")
    if not pins_set()[role]:
        raise RoleError("Aucun code défini pour ce profil.")
    _verify_pin(role, pin)
    with _lock:
        d = {k: v for k, v in _load().items() if k != "_role"}
        _set_pin(d, role, new_pin)
        _save(d)


def on_switch(fn):
    _hooks.append(fn)


def info():
    return {"role": current(), "effective": effective(), "label": LABELS.get(current(), ""), "needs_setup": current() is None, "pins_set": pins_set(),
            "caps": caps(), "edition": edition(),
            "roles": [{"id": r, "label": LABELS[r], "description": DESCRIPTIONS[r], "pin": r != "friends"} for r in available_roles()]}


# ------------------------------------------------------------------ données personnelles séparées par profil
PRIVATE_CONFIG_KEYS = ("zeus_ics_url", "moodle_ics_url", "moodle_token", "moodle_base_url", "cloud_url", "cloud_refresh", "cloud_user", "depot_forge_ics")


def data_name(name):
    """Nom de fichier de données personnelles : celui du CEO / Dev (inchangé), un fichier PROPRE pour Friends (« agenda.friends.json »),
    afin qu'un profil n'hérite jamais de l'agenda, de l'historique ou des liens Zeus / Moodle d'un autre sur la même machine."""
    if effective() != "friends":
        return name
    base, ext = os.path.splitext(name)
    return f"{base}.friends{ext}"


def apply_config_overlay(cfg):
    """Friends : les liens scolaires du CEO ne lui sont jamais montrés ; il a ses propres clés (préfixe « friends_ »)."""
    if effective() == "friends":
        for k in PRIVATE_CONFIG_KEYS:
            cfg[k] = cfg.get("friends_" + k, "")
    return cfg


def remap_config_update(values):
    if effective() != "friends":
        return values
    return {("friends_" + k if k in PRIVATE_CONFIG_KEYS else k): v for k, v in values.items()}


# ------------------------------------------------------------------ garde ASGI (HTTP + WebSocket)
class RoleGate:
    """Refuse (403 / fermeture 1008) toute requête dont la capacité n'est pas accordée au profil actif — local ou distant, sans exception."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            ok, cap = allowed(current(), scope.get("path", ""))
            if not ok:
                role = effective()
                if scope["type"] == "websocket":
                    await send({"type": "websocket.close", "code": 1008})
                    return
                body = json.dumps({"detail": f"Module non disponible avec le profil « {LABELS[role]} ».", "role": role, "capability": cap}, ensure_ascii=False).encode()
                await send({"type": "http.response.start", "status": 403, "headers": [(b"content-type", b"application/json; charset=utf-8"), (b"content-length", str(len(body)).encode()),
                                                                                       (b"cache-control", b"no-store")]})
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)
