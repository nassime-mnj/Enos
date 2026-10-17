"""Liens de téléchargement à durée de vie courte.

  Cloudflare R2 (production) : URL présignée SigV4 (S3-compatible), valable quelques minutes — aucun binaire privé n'est public.
      DP_R2_ENDPOINT=https://<compte>.r2.cloudflarestorage.com  DP_R2_BUCKET  DP_R2_ACCESS_KEY  DP_R2_SECRET_KEY
  Dossier local (développement, tests) : DP_STORAGE_DIR ; lien signé HMAC servi par /launcher/v1/blob/<jeton>."""
import hashlib
import hmac
import json
import os
import time
from datetime import datetime, timezone
from urllib.parse import quote, urlsplit

from . import tokens


def _hmac(key, msg):
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def presign_get(*, endpoint, bucket, key, access_key, secret_key, expires=300, region="auto", now=None, virtual_host=False, method="GET"):
    """URL présignée AWS Signature V4 (query string) — GET par défaut, PUT pour le téléversement. Style chemin par défaut (R2) ; virtual_host=True pour le style « bucket.host » (S3 classique)."""
    u = urlsplit(endpoint)
    host = (bucket + "." + u.netloc) if virtual_host else u.netloc
    path = "/" + quote(key, safe="/~") if virtual_host else "/" + bucket + "/" + quote(key, safe="/~")
    t = now or datetime.now(timezone.utc)
    amz, day = t.strftime("%Y%m%dT%H%M%SZ"), t.strftime("%Y%m%d")
    scope = f"{day}/{region}/s3/aws4_request"
    q = {"X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": f"{access_key}/{scope}", "X-Amz-Date": amz, "X-Amz-Expires": str(int(expires)), "X-Amz-SignedHeaders": "host"}
    canon_q = "&".join(f"{quote(k, safe='~')}={quote(v, safe='~')}" for k, v in sorted(q.items()))
    canon = "\n".join([method, path, canon_q, f"host:{host}\n", "host", "UNSIGNED-PAYLOAD"])
    sts = "\n".join(["AWS4-HMAC-SHA256", amz, scope, hashlib.sha256(canon.encode()).hexdigest()])
    k = _hmac(_hmac(_hmac(_hmac(("AWS4" + secret_key).encode(), day), region), "s3"), "aws4_request")
    sig = hmac.new(k, sts.encode(), hashlib.sha256).hexdigest()
    return f"{u.scheme}://{host}{path}?{canon_q}&X-Amz-Signature={sig}"


def r2_config():
    e = {k: os.environ.get(k, "") for k in ("DP_R2_ENDPOINT", "DP_R2_BUCKET", "DP_R2_ACCESS_KEY", "DP_R2_SECRET_KEY")}
    return e if all(e.values()) else None


def local_dir():
    d = os.environ.get("DP_STORAGE_DIR", "")
    return os.path.abspath(d) if d else ""


def signed_blob_token(priv, key, ttl=300, now=None):
    return tokens.issue(priv, sub=key, role="blob", typ="blob", ttl=ttl, now=now)


def url_for(priv, key, ttl=300, base_url=""):
    """URL de téléchargement pour la clé de stockage `key`, ou None si aucun stockage n'est configuré."""
    r2 = r2_config()
    if r2:
        return presign_get(endpoint=r2["DP_R2_ENDPOINT"], bucket=r2["DP_R2_BUCKET"], key=key, access_key=r2["DP_R2_ACCESS_KEY"], secret_key=r2["DP_R2_SECRET_KEY"], expires=ttl)
    if local_dir():
        return base_url.rstrip("/") + "/launcher/v1/blob/" + signed_blob_token(priv, key, ttl)
    return None


def local_path(key):
    """Chemin réel d'une clé de stockage, confiné au dossier de stockage (jamais en dehors)."""
    base = local_dir()
    p = os.path.realpath(os.path.join(base, key))
    if not base or os.path.commonpath([base, p]) != base or not os.path.isfile(p):
        return None
    return p
