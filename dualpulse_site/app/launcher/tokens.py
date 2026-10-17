"""Jetons signés Ed25519 (format JWT « EdDSA »). Vérifiables HORS LIGNE avec la seule clé publique : le Launcher et Enos n'ont jamais de secret.

  access  : 15 min, ouvre les routes du serveur
  attest  : 14 jours, preuve de rôle présentée par le Launcher à Enos (le serveur n'a pas besoin d'être joignable)
Ce module ne dépend pas de la base de données : il peut être copié tel quel dans Enos / le Launcher pour la vérification."""
import base64
import json
import time
import uuid

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

ISS = "dualpulse"
TTL = {"access": 15 * 60, "attest": 14 * 86400}


class TokenError(Exception):
    pass


def b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def new_private() -> Ed25519PrivateKey:
    return Ed25519PrivateKey.generate()


def private_to_b64(k: Ed25519PrivateKey) -> str:
    return base64.b64encode(k.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())).decode()


def private_from_b64(text: str) -> Ed25519PrivateKey:
    raw = base64.b64decode(text.strip())
    if len(raw) != 32:
        raise ValueError("clé privée Ed25519 invalide (32 octets attendus)")
    return Ed25519PrivateKey.from_private_bytes(raw)


def public_b64(k) -> str:
    pub = k.public_key() if isinstance(k, Ed25519PrivateKey) else k
    return base64.b64encode(pub.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()


def public_from_b64(text: str) -> Ed25519PublicKey:
    raw = base64.b64decode(text.strip())
    if len(raw) != 32:
        raise ValueError("clé publique Ed25519 invalide (32 octets attendus)")
    return Ed25519PublicKey.from_public_bytes(raw)


def kid_of(pub_b64: str) -> str:
    import hashlib
    return hashlib.sha256(pub_b64.encode()).hexdigest()[:12]


def issue(priv: Ed25519PrivateKey, *, sub, role, typ="access", tv=0, now=None, ttl=None, extra=None) -> str:
    now = int(now if now is not None else time.time())
    head = {"alg": "EdDSA", "typ": "JWT", "kid": kid_of(public_b64(priv))}
    body = {"iss": ISS, "sub": str(sub), "role": role, "typ": typ, "iat": now, "exp": now + int(ttl or TTL[typ]), "jti": uuid.uuid4().hex[:16], "tv": int(tv)}
    body.update(extra or {})
    signing = b64e(json.dumps(head, separators=(",", ":")).encode()) + "." + b64e(json.dumps(body, separators=(",", ":")).encode())
    return signing + "." + b64e(priv.sign(signing.encode("ascii")))


def verify(token: str, pub: Ed25519PublicKey, *, typ="access", now=None) -> dict:
    """Retourne les revendications ou lève TokenError. Refuse tout algorithme autre qu'EdDSA (pas de « alg: none »)."""
    try:
        h, p, s = token.split(".")
        head = json.loads(b64d(h))
        if head.get("alg") != "EdDSA":
            raise TokenError("algorithme refusé")
        pub.verify(b64d(s), (h + "." + p).encode("ascii"))
        body = json.loads(b64d(p))
    except TokenError:
        raise
    except (ValueError, InvalidSignature, KeyError, TypeError):
        raise TokenError("jeton invalide")
    now = now if now is not None else time.time()
    if body.get("iss") != ISS or body.get("typ") != typ:
        raise TokenError("jeton invalide")
    if not isinstance(body.get("exp"), (int, float)) or body["exp"] < now:
        raise TokenError("jeton expiré")
    return body
