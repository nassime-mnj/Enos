"""Logique métier du Launcher : comptes, sessions, invitations, rôles, versions. Toutes les décisions d'accès sont prises ICI, côté serveur."""
import json
import os
import re
import time

from .. import db
from . import accounts, manifests, storage, tokens

ACCESS_TTL = tokens.TTL["access"]
REFRESH_TTL = 30 * 86400
LOCK_AFTER, LOCK_FOR = 5, 900
_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,}$")
TERNA_STATES = ("wishlist", "alpha", "released")


class AuthError(Exception):
    def __init__(self, status, detail, **extra):
        super().__init__(detail)
        self.status, self.detail, self.extra = status, detail, extra


def _c():
    return db.conn()


def now():
    return time.time()


# ---------------------------------------------------------------- clés de signature des jetons
_key_cache = {}


def signing_key():
    """Clé privée Ed25519 des jetons : DP_TOKEN_KEY (base64), sinon fichier data/token_ed25519.key créé au premier démarrage (0600)."""
    env = os.environ.get("DP_TOKEN_KEY", "").strip()
    path = os.path.join(os.path.dirname(db.path()), "token_ed25519.key")
    ck = env or path
    if ck not in _key_cache:
        if env:
            _key_cache[ck] = tokens.private_from_b64(env)
        elif os.path.isfile(path):
            _key_cache[ck] = tokens.private_from_b64(open(path).read())
        else:
            k = tokens.new_private()
            os.makedirs(os.path.dirname(path), exist_ok=True)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as f:
                f.write(tokens.private_to_b64(k))
            _key_cache[ck] = k
    return _key_cache[ck]


def public_key():
    return signing_key().public_key()


def manifest_pubkey():
    return manifests.load_pubkey(os.environ.get("DP_MANIFEST_PUBKEY", ""))


# ---------------------------------------------------------------- comptes
def _public(u):
    return {"id": u["id"], "email": u["email"], "name": u["name"], "role": u["role"], "totp_enabled": bool(u["totp_enabled"])}


def get_user(uid):
    with db._lock:
        r = _c().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return dict(r) if r else None


def user_by_email(email):
    with db._lock:
        r = _c().execute("SELECT * FROM users WHERE email=?", ((email or "").strip(),)).fetchone()
    return dict(r) if r else None


def _norm_email(email):
    email = (email or "").strip()
    if not _EMAIL.match(email):
        raise ValueError("Adresse e-mail invalide.")
    return email.lower()


def create_user(email, password, role, name="", invited_by=None):
    email = _norm_email(email)
    if role not in accounts.ROLES:
        raise ValueError("Rôle inconnu.")
    accounts.check_password(password, email)
    h = accounts.hash_password(password)
    with db._lock:
        c = _c()
        if c.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
            raise ValueError("Ce compte existe déjà.")
        cur = c.execute("INSERT INTO users(email,name,pw_hash,role,created_at,invited_by) VALUES(?,?,?,?,?,?)", (email, (name or "").strip()[:60], h, role, now(), invited_by))
        c.commit()
        return cur.lastrowid


def has_ceo():
    with db._lock:
        return _c().execute("SELECT 1 FROM users WHERE role='ceo'").fetchone() is not None


def bootstrap_ceo(email, password):
    """Seul moyen de créer un CEO (jeton d'administration du serveur). Refusé dès qu'un CEO existe."""
    if has_ceo():
        raise AuthError(409, "Un compte CEO existe déjà.")
    try:
        return create_user(email, password, "ceo", "CEO")
    except ValueError as e:
        raise AuthError(400, str(e))


def authenticate(email, password, totp="", ip=""):
    u = user_by_email(email)
    if not u:
        accounts.dummy_verify(password)
        raise AuthError(401, "Identifiants incorrects.")
    if u["locked_until"] > now():
        raise AuthError(429, "Compte temporairement bloqué après trop d'essais. Réessayez plus tard.")
    ok = accounts.verify_password(password, u["pw_hash"])
    counter = None
    if ok and u["totp_enabled"]:
        if not totp:
            raise AuthError(401, "Code à 6 chiffres requis.", mfa_required=True)
        counter = accounts.totp_check(u["totp_secret"], totp, u["totp_last"])
        ok = counter is not None
    if not ok:
        with db._lock:
            fails = u["fails"] + 1
            _c().execute("UPDATE users SET fails=?, locked_until=? WHERE id=?", (0 if fails >= LOCK_AFTER else fails, now() + LOCK_FOR if fails >= LOCK_AFTER else 0, u["id"]))
            _c().commit()
        raise AuthError(401, "Identifiants incorrects.")
    if not u["active"]:
        raise AuthError(403, "Ce compte est désactivé.")
    with db._lock:
        _c().execute("UPDATE users SET fails=0, locked_until=0, last_login=?, totp_last=COALESCE(?,totp_last) WHERE id=?", (now(), counter, u["id"]))
        _c().commit()
    return get_user(u["id"])


# ---------------------------------------------------------------- sessions
def session_for(u, device="", ip="", family=None):
    access = tokens.issue(signing_key(), sub=u["id"], role=u["role"], typ="access", tv=u["token_version"])
    refresh = accounts.new_opaque()
    with db._lock:
        _c().execute("INSERT INTO refresh_tokens(user_id,token_hash,family,created_at,expires_at,device,ip) VALUES(?,?,?,?,?,?,?)",
                     (u["id"], accounts.digest(refresh), family or accounts.new_opaque()[:16], now(), now() + REFRESH_TTL, (device or "")[:60], str(ip)))
        _c().commit()
    out = {"access_token": access, "refresh_token": refresh, "token_type": "Bearer", "expires_in": ACCESS_TTL, "role": u["role"], "user": _public(u)}
    if u["role"] == "ceo" and not u["totp_enabled"]:
        out["mfa_setup_required"] = True
    return out


def refresh_session(refresh, device="", ip=""):
    h = accounts.digest(refresh or "")
    with db._lock:
        r = _c().execute("SELECT * FROM refresh_tokens WHERE token_hash=?", (h,)).fetchone()
        if not r:
            raise AuthError(401, "Session invalide.")
        if r["used"] or r["revoked"]:                       # jeton déjà consommé présenté une 2e fois : vol probable -> toute la famille est révoquée
            _c().execute("UPDATE refresh_tokens SET revoked=1 WHERE family=?", (r["family"],))
            _c().commit()
            raise AuthError(401, "Session invalide.")
        if r["expires_at"] < now():
            raise AuthError(401, "Session expirée.")
        u = get_user(r["user_id"])
        if not u or not u["active"]:
            raise AuthError(401, "Session invalide.")
        _c().execute("UPDATE refresh_tokens SET used=1 WHERE id=?", (r["id"],))
        _c().commit()
    return session_for(u, device or r["device"], ip, family=r["family"])


def logout(refresh):
    with db._lock:
        r = _c().execute("SELECT family FROM refresh_tokens WHERE token_hash=?", (accounts.digest(refresh or ""),)).fetchone()
        if r:
            _c().execute("UPDATE refresh_tokens SET revoked=1 WHERE family=?", (r["family"],))
            _c().commit()


def revoke_all(uid):
    with db._lock:
        _c().execute("UPDATE users SET token_version=token_version+1 WHERE id=?", (uid,))
        _c().execute("UPDATE refresh_tokens SET revoked=1 WHERE user_id=?", (uid,))
        _c().execute("UPDATE update_tokens SET revoked=1 WHERE user_id=?", (uid,))
        _c().commit()


def user_from_token(token, typ="access"):
    """Jeton -> utilisateur À JOUR : le rôle vient de la base (un changement de rôle ou un compte désactivé prend effet immédiatement)."""
    try:
        claims = tokens.verify(token, public_key(), typ=typ)
    except tokens.TokenError as e:
        raise AuthError(401, str(e))
    u = get_user(int(claims["sub"]))
    if not u or not u["active"] or u["token_version"] != claims.get("tv"):
        raise AuthError(401, "Session révoquée.")
    return u


def attest(u):
    """Preuve de rôle longue durée (14 j) pour Enos : vérifiable hors ligne avec la clé publique."""
    return tokens.issue(signing_key(), sub=u["id"], role=u["role"], typ="attest", tv=u["token_version"], extra={"email": u["email"]})


def change_password(u, old, new):
    if not accounts.verify_password(old, u["pw_hash"]):
        raise AuthError(401, "Mot de passe actuel incorrect.")
    try:
        accounts.check_password(new, u["email"])
    except ValueError as e:
        raise AuthError(400, str(e))
    with db._lock:
        _c().execute("UPDATE users SET pw_hash=? WHERE id=?", (accounts.hash_password(new), u["id"]))
        _c().commit()
    revoke_all(u["id"])


def totp_setup(u):
    secret = accounts.new_totp_secret()
    with db._lock:
        _c().execute("UPDATE users SET totp_secret=?, totp_enabled=0, totp_last=0 WHERE id=?", (secret, u["id"]))
        _c().commit()
    return {"secret": secret, "otpauth": accounts.otpauth_uri(secret, u["email"])}


def totp_enable(u, code):
    u = get_user(u["id"])
    counter = accounts.totp_check(u["totp_secret"] or "", code, 0) if u["totp_secret"] else None
    if counter is None:
        raise AuthError(400, "Code incorrect.")
    with db._lock:
        _c().execute("UPDATE users SET totp_enabled=1, totp_last=? WHERE id=?", (counter, u["id"]))
        _c().commit()


# ---------------------------------------------------------------- invitations (la SEULE voie d'inscription)
CODE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*[A-Za-z0-9]$")
CODE_MIN = {"friends": 8, "dev": 12}              # un code choisi se devine plus facilement qu'un code aléatoire : le rôle dev (accès aux builds dev) en exige un plus long
CODE_MAX = 40


def normalize_code(code):
    """Forme canonique d'un code choisi : sans espaces autour, en MAJUSCULES (la saisie de l'invité n'a ainsi pas à respecter la casse)."""
    return (code or "").strip().upper()


def _check_custom_code(code, role):
    if not CODE_RE.match(code) or len(code) > CODE_MAX:
        raise AuthError(400, f"Code invalide : lettres, chiffres, tirets et underscores seulement, {CODE_MAX} caractères au plus, sans commencer ni finir par un tiret.")
    if len(code) < CODE_MIN[role]:
        raise AuthError(400, f"Code trop court pour le profil {role} : {CODE_MIN[role]} caractères au moins.")
    if len(set(code.replace("-", "").replace("_", ""))) < 4:
        raise AuthError(400, "Code trop simple : varie davantage les caractères.")


def create_invite(created_by, role, days=7, note="", code=None):
    """Crée une invitation à usage unique. `code` vide : code aléatoire (DP-…). Sinon : code choisi par le CEO (ex. NASKO-VIP), stocké en MAJUSCULES."""
    if role not in accounts.INVITABLE:
        raise AuthError(400, "Une invitation ne peut donner que le rôle friends ou dev.")
    if not 1 <= days <= 90:
        raise AuthError(400, "Durée invalide (1 à 90 jours).")
    custom = bool((code or "").strip())
    if custom:
        code = normalize_code(code)
        _check_custom_code(code, role)
    else:
        code = "DP-" + accounts.new_opaque()[:16]
    with db._lock:
        if custom and _c().execute("SELECT 1 FROM invites WHERE code_hash=?", (accounts.digest(code),)).fetchone():
            raise AuthError(409, "Ce code existe déjà (même utilisé, révoqué ou expiré) : choisis-en un autre.")
        cur = _c().execute("INSERT INTO invites(code_hash,role,note,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?)",
                           (accounts.digest(code), role, (note or "")[:80], created_by, now(), now() + days * 86400))
        _c().commit()
    return {"id": cur.lastrowid, "code": code, "role": role, "expires_at": now() + days * 86400, "custom": custom}


def list_invites():
    with db._lock:
        rows = _c().execute("SELECT i.id,i.role,i.note,i.created_at,i.expires_at,i.used_by,i.used_at,i.revoked,u.email AS used_email FROM invites i LEFT JOIN users u ON u.id=i.used_by ORDER BY i.id DESC").fetchall()
    return [dict(r) for r in rows]


def revoke_invite(iid):
    with db._lock:
        n = _c().execute("UPDATE invites SET revoked=1 WHERE id=? AND used_by IS NULL", (iid,)).rowcount
        _c().commit()
    if not n:
        raise AuthError(404, "Invitation introuvable ou déjà utilisée.")


def register(code, email, password, name=""):
    """Inscription sur invitation : le code est consommé de façon atomique ; le rôle est celui de l'invitation (jamais choisi par l'inscrit)."""
    raw = (code or "").strip()
    with db._lock:
        c = _c()
        inv = c.execute("SELECT * FROM invites WHERE code_hash=?", (accounts.digest(raw),)).fetchone()          # code aléatoire : exact
        if not inv:                                                                                              # code choisi : stocké en majuscules, saisie insensible à la casse
            inv = c.execute("SELECT * FROM invites WHERE code_hash=?", (accounts.digest(normalize_code(raw)),)).fetchone()
        if not inv or inv["used_by"] or inv["revoked"] or inv["expires_at"] < now():
            raise AuthError(400, "Invitation invalide ou expirée.")
        try:
            uid = create_user(email, password, inv["role"], name, invited_by=inv["created_by"])
        except ValueError as e:
            raise AuthError(400, str(e))
        c.execute("UPDATE invites SET used_by=?, used_at=? WHERE id=? AND used_by IS NULL", (uid, now(), inv["id"]))
        c.commit()
    return get_user(uid)


# ---------------------------------------------------------------- gestion des comptes (CEO)
def list_users():
    with db._lock:
        rows = _c().execute("SELECT id,email,name,role,active,created_at,last_login,totp_enabled FROM users ORDER BY id").fetchall()
    return [dict(r) for r in rows]


def update_user(actor, uid, role=None, active=None):
    t = get_user(uid)
    if not t:
        raise AuthError(404, "Compte introuvable.")
    if t["id"] == actor["id"]:
        raise AuthError(400, "Vous ne pouvez pas modifier votre propre compte ici.")
    if t["role"] == "ceo":
        raise AuthError(403, "Un compte CEO ne se modifie pas par l'API.")
    if role is not None:
        if role not in accounts.INVITABLE:
            raise AuthError(400, "Rôle attribuable : friends ou dev.")
        with db._lock:
            _c().execute("UPDATE users SET role=? WHERE id=?", (role, uid))
            _c().commit()
    if active is not None:
        with db._lock:
            _c().execute("UPDATE users SET active=? WHERE id=?", (1 if active else 0, uid))
            _c().commit()
    revoke_all(uid)                                          # tout changement force une nouvelle connexion
    return _public(get_user(uid))


# ---------------------------------------------------------------- catalogue, manifestes, téléchargements
def setting(k, default=""):
    with db._lock:
        r = _c().execute("SELECT v FROM settings WHERE k=?", (k,)).fetchone()
    return r["v"] if r else default


def set_setting(k, v):
    with db._lock:
        _c().execute("INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, v))
        _c().commit()


def product_status(product):
    return setting("terna_status", "wishlist") if product == "terna" else "released"


def channel_allowed(role, product, channel):
    """Le rôle peut-il lire ce canal ? Hiérarchie : un rôle supérieur lit aussi les canaux inférieurs ; Terna n'est pas public tant qu'il n'est pas sorti."""
    if product not in manifests.PRODUCTS or channel not in manifests.PRODUCTS[product]["channels"]:
        return False
    if not accounts.at_least(role, manifests.CHANNEL_MIN_ROLE[channel]):
        return False
    if product == "terna" and channel == "public" and product_status(product) != "released" and not accounts.at_least(role, "dev"):
        return False
    return True


def default_channel(role, product):
    order = {"enos": ("ceo", "dev", "stable"), "enos-mobile": ("ceo", "dev", "stable"), "terna": ("public", "alpha")}[product]
    if product == "terna" and role in ("dev", "ceo") and product_status(product) != "released":
        order = ("alpha", "public")
    for ch in order:
        if channel_allowed(role, product, ch):
            return ch
    return None


def latest_release(product, channel):
    with db._lock:
        rows = _c().execute("SELECT * FROM releases WHERE product=? AND channel=? AND yanked=0", (product, channel)).fetchall()
    if not rows:
        return None
    best = max(rows, key=lambda r: manifests.vkey(r["version"]))
    return {"id": best["id"], "manifest": json.loads(best["manifest"]), "signature": best["signature"], "published_at": best["published_at"]}


def catalog(role):
    out = []
    for pid, p in manifests.PRODUCTS.items():
        ch = default_channel(role, pid)
        rel = latest_release(pid, ch) if ch else None
        item = {"id": pid, "name": p["name"], "kind": p["kind"], "status": product_status(pid), "channel": ch, "wishlist": ch is None and p["kind"] == "game",
                "can_download": bool(rel), "latest": None}
        if rel:
            m = rel["manifest"]
            item["latest"] = {"version": m["version"], "released": m["released"], "notes": m["notes"], "channel": m["channel"], "version_code": m.get("version_code")}
        out.append(item)
    return out


def publish(manifest, signature):
    pub = manifest_pubkey()
    if pub is None:
        raise AuthError(503, "Clé publique des manifestes non configurée (DP_MANIFEST_PUBKEY).")
    try:
        clean = manifests.validate(manifest)
    except ValueError as e:
        raise AuthError(400, str(e))
    if not manifests.verify(pub, manifest, signature):           # signature calculée sur le manifeste TEL QU'ENVOYÉ : rien n'est réécrit entre la signature et le stockage
        raise AuthError(400, "Signature du manifeste invalide.")
    with db._lock:
        c = _c()
        rows = c.execute("SELECT version FROM releases WHERE product=? AND channel=?", (clean["product"], clean["channel"])).fetchall()
        if rows and manifests.vkey(clean["version"]) <= max(manifests.vkey(r["version"]) for r in rows):
            raise AuthError(409, "Version déjà publiée ou plus ancienne que la dernière (protection contre le retour en arrière).")
        cur = c.execute("INSERT INTO releases(product,channel,version,manifest,signature,published_at) VALUES(?,?,?,?,?,?)",
                        (clean["product"], clean["channel"], clean["version"], json.dumps(manifest, sort_keys=True, ensure_ascii=False), signature, now()))
        c.commit()
    return cur.lastrowid


def list_releases():
    with db._lock:
        rows = _c().execute("SELECT id,product,channel,version,published_at,yanked FROM releases ORDER BY id DESC LIMIT 200").fetchall()
    return [dict(r) for r in rows]


def yank(rid, yanked=True):
    with db._lock:
        n = _c().execute("UPDATE releases SET yanked=? WHERE id=?", (1 if yanked else 0, rid)).rowcount
        _c().commit()
    if not n:
        raise AuthError(404, "Version introuvable.")


def release_manifest(role, product, channel, version=None):
    if product not in manifests.PRODUCTS or channel not in manifests.PRODUCTS[product]["channels"]:
        raise AuthError(404, "Introuvable.")
    if not channel_allowed(role, product, channel):
        raise AuthError(403, "Accès refusé pour votre profil.")
    if version:
        with db._lock:
            r = _c().execute("SELECT * FROM releases WHERE product=? AND channel=? AND version=? AND yanked=0", (product, channel, version)).fetchone()
        rel = {"manifest": json.loads(r["manifest"]), "signature": r["signature"]} if r else None
    else:
        rel = latest_release(product, channel)
    if not rel:
        raise AuthError(404, "Aucune version publiée.")
    return rel


def download_link(u, product, channel, version, index, ip, base_url=""):
    rel = release_manifest(u["role"], product, channel, version)
    files = rel["manifest"]["files"]
    if not 0 <= index < len(files):
        raise AuthError(404, "Fichier introuvable.")
    f = files[index]
    url = storage.url_for(signing_key(), f["key"], 300, base_url)
    if not url:
        raise AuthError(503, "Stockage des binaires non configuré.")
    with db._lock:
        _c().execute("INSERT INTO launcher_downloads(t,user_id,product,channel,version,file,ip) VALUES(?,?,?,?,?,?,?)", (now(), u["id"], product, channel, version, f["path"], str(ip)))
        _c().commit()
    return {"url": url, "expires_in": 300, "path": f["path"], "sha256": f["sha256"], "size": f["size"]}


# ---------------------------------------------------------------- bannières (news / annonces) et liste de souhaits
NEWS_KINDS = ("news", "release", "announcement", "event")
_URL = re.compile(r"^https://[^\s]{4,500}$")


def _clean_news(d, partial=False):
    out = {}
    if "title" in d or not partial:
        t = (d.get("title") or "").strip()
        if not t or len(t) > 120:
            raise AuthError(400, "Titre requis (120 caractères maximum).")
        out["title"] = t
    if "body" in d:
        out["body"] = (d.get("body") or "").strip()[:600]
    for k in ("image", "link"):
        if k in d:
            v = (d.get(k) or "").strip()
            if v and not _URL.match(v):
                raise AuthError(400, f"« {k} » doit être une adresse https://.")
            out[k] = v
    if "kind" in d:
        if d["kind"] not in NEWS_KINDS:
            raise AuthError(400, "Type de bannière inconnu.")
        out["kind"] = d["kind"]
    if "min_role" in d:
        if d["min_role"] not in ("public",) + accounts.ROLES:
            raise AuthError(400, "Rôle inconnu.")
        out["min_role"] = d["min_role"]
    if "priority" in d:
        out["priority"] = max(-100, min(int(d["priority"] or 0), 100))
    for k in ("starts_at", "ends_at"):
        if k in d:
            out[k] = float(d[k]) if d[k] not in (None, "") else None
    if "active" in d:
        out["active"] = 1 if d["active"] else 0
    return out


def create_news(d):
    f = _clean_news(d)
    cols = ",".join(f) + ",created_at"
    with db._lock:
        cur = _c().execute(f"INSERT INTO news({cols}) VALUES({','.join('?' * (len(f) + 1))})", (*f.values(), now()))
        _c().commit()
    return cur.lastrowid


def update_news(nid, d):
    f = _clean_news(d, partial=True)
    if not f:
        raise AuthError(400, "Rien à modifier.")
    with db._lock:
        n = _c().execute(f"UPDATE news SET {','.join(k + '=?' for k in f)} WHERE id=?", (*f.values(), nid)).rowcount
        _c().commit()
    if not n:
        raise AuthError(404, "Bannière introuvable.")


def delete_news(nid):
    with db._lock:
        n = _c().execute("DELETE FROM news WHERE id=?", (nid,)).rowcount
        _c().commit()
    if not n:
        raise AuthError(404, "Bannière introuvable.")


def list_news(role, include_all=False):
    """Bannières visibles pour ce rôle (public, friends, dev, ceo), actives et dans leur période, la plus prioritaire d'abord. include_all : vue d'administration (CEO)."""
    t = now()
    with db._lock:
        rows = [dict(r) for r in _c().execute("SELECT * FROM news ORDER BY priority DESC, id DESC").fetchall()]
    if include_all:
        return rows
    out = []
    for r in rows:
        if not r["active"] or (r["starts_at"] and r["starts_at"] > t) or (r["ends_at"] and r["ends_at"] < t):
            continue
        if r["min_role"] != "public" and not accounts.at_least(role, r["min_role"]):
            continue
        out.append({k: r[k] for k in ("id", "title", "body", "image", "link", "kind", "priority")})
    return out


def add_wishlist(email, ip=""):
    try:
        email = _norm_email(email)
    except ValueError as e:
        raise AuthError(400, str(e))
    with db._lock:
        c = _c()
        new = c.execute("INSERT OR IGNORE INTO wishlist(email,created_at,ip) VALUES(?,?,?)", (email, now(), str(ip))).rowcount
        c.commit()
    return bool(new)                                          # inscrit déjà : même réponse au client (on ne révèle pas qui est inscrit)


def wishlist_count():
    with db._lock:
        return _c().execute("SELECT COUNT(*) FROM wishlist").fetchone()[0]


# ---------------------------------------------------------------- presse-papiers universel (téléphone <-> PC) et appareils mobiles
CLIP_KEEP, CLIP_TTL = 50, 24 * 3600
CLIP_MAX_TEXT, CLIP_MAX_IMAGE = 100_000, 2_000_000                 # caractères / octets base64 : au-delà, utiliser le transfert de fichiers
_MIME_IMAGE = ("image/png", "image/jpeg", "image/webp", "image/gif")


def clip_add(uid, kind, content, mime="", device=""):
    if kind == "text":
        if not content or len(content) > CLIP_MAX_TEXT:
            raise AuthError(400, f"Texte vide ou trop long ({CLIP_MAX_TEXT} caractères maximum).")
        mime = "text/plain"
    elif kind == "image":
        if mime not in _MIME_IMAGE:
            raise AuthError(400, "Type d'image non pris en charge.")
        if not content or len(content) > CLIP_MAX_IMAGE or not re.fullmatch(r"[A-Za-z0-9+/=\r\n]+", content):
            raise AuthError(400, "Image vide, trop lourde (2 Mo maximum) ou mal encodée (base64 attendu).")
    else:
        raise AuthError(400, "Type inconnu (text ou image).")
    with db._lock:
        c = _c()
        cur = c.execute("INSERT INTO clipboard(user_id,device,kind,mime,content,created_at) VALUES(?,?,?,?,?,?)", (uid, (device or "")[:40], kind, mime, content, now()))
        new_id = cur.lastrowid
        c.execute("DELETE FROM clipboard WHERE user_id=? AND created_at<?", (uid, now() - CLIP_TTL))
        c.execute("DELETE FROM clipboard WHERE user_id=? AND id NOT IN (SELECT id FROM clipboard WHERE user_id=? ORDER BY id DESC LIMIT ?)", (uid, uid, CLIP_KEEP))
        c.commit()
    return new_id


def clip_list(uid, since_id=0, limit=20):
    with db._lock:
        rows = _c().execute("SELECT id,device,kind,mime,content,created_at FROM clipboard WHERE user_id=? AND id>? ORDER BY id DESC LIMIT ?", (uid, since_id, max(1, min(limit, 50)))).fetchall()
    return [dict(r) for r in rows]


def clip_delete(uid, cid):
    with db._lock:
        n = _c().execute("DELETE FROM clipboard WHERE id=? AND user_id=?", (cid, uid)).rowcount
        _c().commit()
    if not n:
        raise AuthError(404, "Élément introuvable.")


_DEVID = re.compile(r"^[A-Za-z0-9_\-]{6,64}$")
_IP = re.compile(r"^(\d{1,3}\.){3}\d{1,3}$")


def device_beat(uid, device_id, name="", platform="android", lan_ips=None, adb_port=0, app_version=""):
    """Le téléphone annonce son nom, ses adresses Wi-Fi et le port ADB sans fil : c'est ce que le PC lit pour se connecter automatiquement (scrcpy)."""
    if not _DEVID.match(device_id or ""):
        raise AuthError(400, "Identifiant d'appareil invalide.")
    ips = [i for i in (lan_ips or []) if isinstance(i, str) and _IP.match(i) and all(0 <= int(x) <= 255 for x in i.split("."))][:6]
    port = int(adb_port or 0)
    if not 0 <= port <= 65535:
        raise AuthError(400, "Port invalide.")
    with db._lock:
        _c().execute("INSERT INTO mobile_devices(user_id,device_id,name,platform,lan_ips,adb_port,app_version,last_seen) VALUES(?,?,?,?,?,?,?,?) "
                     "ON CONFLICT(user_id,device_id) DO UPDATE SET name=excluded.name, platform=excluded.platform, lan_ips=excluded.lan_ips, adb_port=excluded.adb_port, app_version=excluded.app_version, last_seen=excluded.last_seen",
                     (uid, device_id, (name or "")[:60], (platform or "")[:20], json.dumps(ips), port, (app_version or "")[:20], now()))
        _c().commit()


def device_list(uid):
    with db._lock:
        rows = _c().execute("SELECT device_id,name,platform,lan_ips,adb_port,app_version,last_seen FROM mobile_devices WHERE user_id=? ORDER BY last_seen DESC", (uid,)).fetchall()
    out = []
    for r in rows:
        d = dict(r); d["lan_ips"] = json.loads(d["lan_ips"] or "[]"); d["online"] = d["last_seen"] > now() - 180
        out.append(d)
    return out


# ---------------------------------------------------------------- mises à jour de l'application mobile (OTA) : jeton d'appareil + URL compatible avec l'Updater de l'APK
UPDATE_TTL = 180 * 86400


def update_token_create(uid, device=""):
    """Jeton long (180 j), propre à UN téléphone, qui ne sert qu'à lire la version et télécharger l'APK (jamais à utiliser le compte). Révoqué avec le compte."""
    tok = accounts.new_opaque()
    with db._lock:
        _c().execute("INSERT INTO update_tokens(user_id,token_hash,device,created_at,expires_at) VALUES(?,?,?,?,?)", (uid, accounts.digest(tok), (device or "")[:40], now(), now() + UPDATE_TTL))
        _c().commit()
    return tok


def update_token_user(tok):
    with db._lock:
        r = _c().execute("SELECT id,user_id,expires_at,revoked FROM update_tokens WHERE token_hash=?", (accounts.digest(tok or ""),)).fetchone()
        if not r or r["revoked"] or r["expires_at"] < now():
            return None
        u = get_user(r["user_id"])
        if not u or not u["active"]:
            return None
        _c().execute("UPDATE update_tokens SET last_used=? WHERE id=?", (now(), r["id"]))
        _c().commit()
    return u


def mobile_release(u):
    ch = default_channel(u["role"], "enos-mobile")
    return (latest_release("enos-mobile", ch) if ch else None)


def mobile_version(u):
    rel = mobile_release(u)
    if not rel:
        raise AuthError(404, "Aucune version mobile publiée.")
    m, f = rel["manifest"], rel["manifest"]["files"][0]
    return {"versionCode": int(m.get("version_code") or 0), "versionName": m["version"], "sha256": f["sha256"], "size": f["size"], "notes": m.get("notes", ""), "channel": m["channel"]}


def mobile_apk_link(u, ip, base_url=""):
    rel = mobile_release(u)
    if not rel:
        raise AuthError(404, "Aucune version mobile publiée.")
    m = rel["manifest"]
    return download_link(u, "enos-mobile", m["channel"], m["version"], 0, ip, base_url)["url"]


# ---------------------------------------------------------------- synchronisation de l'agenda (tâches) : « la dernière modification gagne », par tâche, comme sur le PC et le téléphone
_TID = re.compile(r"^[A-Za-z0-9_\-]{6,40}$")
_DUE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")
TOMB_DAYS = 30


def _sane_task(t, tnow):
    tid = str(t.get("id", ""))
    if not _TID.match(tid):
        raise ValueError("identifiant")
    upd = min(float(t.get("updated") or 0), tnow)               # jamais une date dans le futur : elle gagnerait toutes les fusions suivantes
    if t.get("deleted"):
        return tid, {"id": tid, "deleted": True, "title": "", "notes": "", "due": "", "done": False, "updated": upd}, upd, 1
    due = str(t.get("due") or "")
    if due and not _DUE.match(due[:16]):
        raise ValueError("date")
    return tid, {"id": tid, "title": (str(t.get("title", ""))[:200].strip() or "(sans titre)"), "due": due[:16], "notes": str(t.get("notes", ""))[:1000],
                 "duration_min": max(0, min(int(t.get("duration_min") or 0), 1440)), "done": bool(t.get("done")), "created": str(t.get("created", ""))[:25], "updated": upd}, upd, 0


def agenda_sync(uid, tasks, since):
    """Reçoit les tâches modifiées d'un appareil, retourne celles modifiées côté cloud depuis `since` (hors celles qu'il vient d'envoyer et qui ont gagné)."""
    tnow = now()
    accepted = set()
    with db._lock:
        c = _c()
        for raw in (tasks or [])[:500]:
            try:
                tid, d, upd, dele = _sane_task(raw, tnow)
            except (ValueError, TypeError):
                continue
            cur = c.execute("SELECT updated FROM agenda_tasks WHERE user_id=? AND task_id=?", (uid, tid)).fetchone()
            if cur is None or upd > cur["updated"]:
                c.execute("INSERT INTO agenda_tasks(user_id,task_id,data,updated,deleted) VALUES(?,?,?,?,?) ON CONFLICT(user_id,task_id) DO UPDATE SET data=excluded.data, updated=excluded.updated, deleted=excluded.deleted",
                          (uid, tid, json.dumps(d, ensure_ascii=False), upd, dele))
                accepted.add(tid)
        c.execute("DELETE FROM agenda_tasks WHERE user_id=? AND deleted=1 AND updated<?", (uid, tnow - TOMB_DAYS * 86400))
        rows = c.execute("SELECT task_id,data FROM agenda_tasks WHERE user_id=? AND updated>?", (uid, float(since or 0))).fetchall()
        c.commit()
    return [json.loads(r["data"]) for r in rows if r["task_id"] not in accepted], tnow
