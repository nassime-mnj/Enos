"""ETO GATEWAY : une clé d'IA par client, créée et recréée par le serveur avec l'API OFFICIELLE de gestion des clés d'OpenRouter.

  Principe (autorisé par OpenRouter) : DualPulse a UN compte OpenRouter et une clé de gestion (« management / provisioning key », variable
  DP_OPENROUTER_MGMT). Avec elle, le serveur crée pour chaque client une clé « sk-or-v1-… » plafonnée en dollars par mois selon son offre
  (limit + limit_reset=monthly). C'est DualPulse qui paie OpenRouter et qui facture l'abonnement : aucun compte n'est créé chez un fournisseur,
  aucune limite gratuite n'est contournée.
  - « Obtenir ma clé » : s'il en existe déjà une, elle est SUPPRIMÉE chez OpenRouter puis une nouvelle est créée (rotation) ; la clé en clair
    n'est renvoyée qu'une fois (le serveur ne garde que son identifiant OpenRouter, « hash »).
  - Changement d'offre / révocation : sync() ajuste le plafond ou désactive la clé.
  - Plafonds par défaut (USD / mois, coût réel OpenRouter) : DP_AI_LIMIT_ETO_MAX=2, DP_AI_LIMIT_ETO_ULTRA=25, éditions privées 10.
  Sans DP_OPENROUTER_MGMT : 503 « passerelle non configurée », rien n'est simulé."""
import os
import time

import httpx
from fastapi import Depends, Request
from pydantic import BaseModel, Field

from .. import db
from . import eto, limits, service

BASE = os.environ.get("DP_OPENROUTER_BASE", "https://openrouter.ai/api/v1")
DEFAULT_LIMITS = {"eto_max": 2.0, "eto_ultra": 25.0, "enos_std": 10.0, "enos_dev": 10.0, "enos_ceo": 10.0}
MODELS = ["openai/gpt-oss-120b", "meta-llama/llama-3.3-70b-instruct", "deepseek/deepseek-chat", "google/gemini-2.0-flash-001", "mistralai/mistral-small-3.2-24b-instruct"]


def limit_for(plan):
    v = os.environ.get("DP_AI_LIMIT_" + plan.upper())
    try:
        return float(v) if v else DEFAULT_LIMITS.get(plan, 0.0)
    except ValueError:
        return DEFAULT_LIMITS.get(plan, 0.0)


def _mgmt():
    k = os.environ.get("DP_OPENROUTER_MGMT", "").strip()
    if not k:
        raise service.AuthError(503, "Passerelle d'IA non configurée sur ce serveur (clé de gestion OpenRouter manquante).")
    return k


def _or(method, path, body=None):
    """Appel à l'API de gestion des clés d'OpenRouter (remplaçable dans les tests)."""
    r = httpx.request(method, os.environ.get("DP_OPENROUTER_BASE", BASE) + path, json=body, headers={"Authorization": "Bearer " + _mgmt()}, timeout=20)
    if r.status_code == 404 and method in ("DELETE", "GET", "PATCH"):
        return None
    if r.status_code >= 400:
        raise service.AuthError(502, "OpenRouter a refusé la demande (%d)." % r.status_code)
    return r.json() if r.content else {}


def _row(uid):
    with db._lock:
        r = db.conn().execute("SELECT * FROM eto_ai_keys WHERE user_id=?", (uid,)).fetchone()
    return dict(r) if r else None


def _plan(u):
    return eto.subscription(u)["plan"]


def allowed(u):
    return "gateway" in eto.features_of(_plan(u)) and limit_for(_plan(u)) > 0


def provision(u):
    """Crée la clé du client ; s'il en a déjà une, elle est supprimée chez OpenRouter et remplacée (rotation)."""
    if not allowed(u):
        raise service.AuthError(403, "La passerelle d'IA fait partie d'ETO MAX et d'ETO Ultra.")
    _mgmt()
    old = _row(u["id"])
    if old and old["hash"]:
        _or("DELETE", "/keys/" + old["hash"])
    plan, lim = _plan(u), limit_for(_plan(u))
    j = _or("POST", "/keys", {"name": "eto-%d-%d" % (u["id"], int(time.time())), "limit": lim, "limit_reset": "monthly"}) or {}
    data = j.get("data") or {}
    key, h = j.get("key") or data.get("key") or "", data.get("hash") or j.get("hash") or ""
    if not key.startswith("sk-or-") or not h:
        raise service.AuthError(502, "Réponse inattendue d'OpenRouter.")
    t = time.time()
    with db._lock:
        db.conn().execute("""INSERT INTO eto_ai_keys(user_id,hash,plan,limit_usd,created,rotated,disabled) VALUES(?,?,?,?,?,?,0)
                             ON CONFLICT(user_id) DO UPDATE SET hash=excluded.hash, plan=excluded.plan, limit_usd=excluded.limit_usd, rotated=excluded.rotated, disabled=0""",
                          (u["id"], h, plan, lim, t, t))
        db.conn().commit()
    eto.log(u["id"], "ai_key_rotated" if old else "ai_key_created", {"plan": plan, "limit": lim})
    return {"key": key, "rotated": bool(old), "limit_usd": lim, "reset": "monthly", "base_url": "https://openrouter.ai/api/v1", "models": MODELS}


def status(u):
    r = _row(u["id"])
    out = {"allowed": allowed(u), "plan": _plan(u), "limit_usd": limit_for(_plan(u)), "configured": bool(os.environ.get("DP_OPENROUTER_MGMT")), "key": None, "models": MODELS}
    if r:
        out["key"] = {"created": int(r["created"]), "rotated": int(r["rotated"]), "disabled": bool(r["disabled"]), "limit_usd": r["limit_usd"], "usage_usd": None, "remaining_usd": None}
        if out["configured"]:
            try:
                d = (_or("GET", "/keys/" + r["hash"]) or {}).get("data") or {}
                out["key"].update(usage_usd=d.get("usage"), remaining_usd=d.get("limit_remaining"), disabled=bool(d.get("disabled", r["disabled"])))
            except service.AuthError:
                pass                                                     # consommation momentanément illisible : on renvoie le reste
    return out


def revoke(uid, reason="user"):
    r = _row(uid)
    if not r:
        return False
    try:
        _or("DELETE", "/keys/" + r["hash"])
    except service.AuthError:
        pass
    with db._lock:
        db.conn().execute("DELETE FROM eto_ai_keys WHERE user_id=?", (uid,))
        db.conn().commit()
    eto.log(uid, "ai_key_deleted", {"reason": reason})
    return True


def sync(uid):
    """Après un changement d'offre : plafond ajusté, ou clé désactivée si l'offre n'inclut plus la passerelle. Ne lève jamais."""
    try:
        r = _row(uid)
        u = service.get_user(uid)
        if not r or not u or not os.environ.get("DP_OPENROUTER_MGMT"):
            return
        ok = allowed(u)
        lim = limit_for(_plan(u))
        if ok and (r["disabled"] or r["limit_usd"] != lim):
            _or("PATCH", "/keys/" + r["hash"], {"disabled": False, "limit": lim, "limit_reset": "monthly"})
        elif not ok and not r["disabled"]:
            _or("PATCH", "/keys/" + r["hash"], {"disabled": True})
        with db._lock:
            db.conn().execute("UPDATE eto_ai_keys SET disabled=?, limit_usd=?, plan=? WHERE user_id=?", (0 if ok else 1, lim if ok else r["limit_usd"], _plan(u), uid))
            db.conn().commit()
    except Exception:                                                    # la facturation ne doit jamais casser à cause d'OpenRouter
        pass


def overview():
    with db._lock:
        rows = db.conn().execute("SELECT k.*, u.email FROM eto_ai_keys k JOIN users u ON u.id=k.user_id ORDER BY k.rotated DESC LIMIT 200").fetchall()
    return [{"email": r["email"], "plan": r["plan"], "limit_usd": r["limit_usd"], "disabled": bool(r["disabled"]), "rotated": int(r["rotated"])} for r in rows]


class RevokeAiIn(BaseModel):
    email: str = Field(max_length=254)


def routes(r, current_user, require, ip_of):
    V1 = eto.V1

    @r.get(V1 + "/ai")
    def ai_status(u=Depends(current_user)):
        return status(u)

    @r.post(V1 + "/ai/key")
    def ai_key(request: Request, u=Depends(current_user)):
        if not limits.ok("etoai", u["id"], 6, per=3600):
            raise service.AuthError(429, "Trop de clés demandées : réessaie dans une heure.")
        return provision(u)

    @r.delete(V1 + "/ai/key")
    def ai_del(u=Depends(current_user)):
        return {"deleted": revoke(u["id"])}

    @r.get(V1 + "/admin/ai")
    def ai_admin(u=Depends(require("ceo"))):
        return {"keys": overview(), "configured": bool(os.environ.get("DP_OPENROUTER_MGMT")), "limits": {p: limit_for(p) for p in ("eto_max", "eto_ultra", "enos_ceo")}}

    @r.post(V1 + "/admin/ai/revoke")
    def ai_admin_revoke(b: RevokeAiIn, u=Depends(require("ceo"))):
        t = service.user_by_email(b.email)
        if not t:
            raise service.AuthError(404, "Compte introuvable.")
        return {"deleted": revoke(t["id"], "ceo")}
