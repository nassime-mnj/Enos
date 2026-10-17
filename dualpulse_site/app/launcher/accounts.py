"""Mots de passe (scrypt), TOTP (RFC 6238), règles de rôles. Aucune dépendance à la base."""
import base64
import hashlib
import hmac
import os
import secrets
import struct
import time

ROLES = ("friends", "dev", "ceo")                  # du plus faible au plus fort : hiérarchie STRICTE
RANK = {"public": 0, "friends": 1, "dev": 2, "ceo": 3}
INVITABLE = ("friends", "dev")                      # un jeton d'invitation ne peut JAMAIS créer un CEO
PW_MIN = 10
_COMMON = {"password123", "motdepasse1", "1234567890", "azertyuiop", "qwertyuiop", "dualpulse1", "enos123456"}


def at_least(role, minimum) -> bool:
    return RANK.get(role, 0) >= RANK[minimum]


def check_password(pw: str, email: str = ""):
    if len(pw) < PW_MIN:
        raise ValueError(f"The password must be at least {PW_MIN} characters long.")
    if len(pw) > 200:
        raise ValueError("Password too long.")
    low = pw.lower()
    if low in _COMMON or (email and low == email.lower()) or len(set(pw)) < 4:
        raise ValueError("Password too easy to guess.")


_N, _R, _P = 2 ** 15, 8, 1


def hash_password(pw: str) -> str:
    salt = os.urandom(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=_N, r=_R, p=_P, maxmem=96 * 1024 * 1024, dklen=32)
    return "scrypt$%d$%d$%d$%s$%s" % (_N, _R, _P, base64.b64encode(salt).decode(), base64.b64encode(h).decode())


def verify_password(pw: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, h = stored.split("$")
        if algo != "scrypt":
            return False
        calc = hashlib.scrypt(pw.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), maxmem=96 * 1024 * 1024, dklen=32)
        return hmac.compare_digest(calc, base64.b64decode(h))
    except (ValueError, TypeError):
        return False


_DUMMY = None


def dummy_verify(pw: str):
    """Compte inconnu : on dépense le même temps qu'une vraie vérification (pas de découverte des comptes par chronométrage)."""
    global _DUMMY
    if _DUMMY is None:
        _DUMMY = hash_password("dummy-password-for-timing")
    verify_password(pw, _DUMMY)


# ---------------------------------------------------------------- TOTP
def new_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def totp_at(secret: str, counter: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    d = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    o = d[-1] & 15
    return "%06d" % ((struct.unpack(">I", d[o:o + 4])[0] & 0x7FFFFFFF) % 1000000)


def totp_check(secret: str, code: str, last_counter: int = 0, now=None):
    """Retourne le compteur accepté (±1 pas de 30 s) ou None. Un code déjà utilisé (compteur <= last_counter) est refusé : pas de rejeu."""
    code = (code or "").strip().replace(" ", "")
    if not (code.isdigit() and len(code) == 6):
        return None
    c0 = int((now if now is not None else time.time()) // 30)
    for c in (c0 - 1, c0, c0 + 1):
        if c > last_counter and hmac.compare_digest(totp_at(secret, c), code):
            return c
    return None


def otpauth_uri(secret: str, email: str) -> str:
    from urllib.parse import quote
    return f"otpauth://totp/Dual%20Pulse:{quote(email)}?secret={secret}&issuer=Dual%20Pulse&digits=6&period=30"


def new_opaque() -> str:
    return secrets.token_urlsafe(32)


def digest(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()
