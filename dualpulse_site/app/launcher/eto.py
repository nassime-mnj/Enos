"""COMPTES ETO GRAND PUBLIC : inscription libre (rôle « public », le plus bas : aucun canal privé, aucune route du personnel), abonnements,
licence signée Ed25519 vérifiable HORS LIGNE par l'application, paiement.

  Offres : eto_free (0 €), eto_pro (2,99 €), eto_max (9,99 €), eto_ultra (119,99 €, équipes). Les éditions privées (friends / dev / ceo) restent liées au rôle.
  Paiement web : Stripe Checkout + portail client + webhook signé (HMAC SHA-256). Variables : DP_STRIPE_SECRET, DP_STRIPE_WEBHOOK_SECRET,
                 DP_STRIPE_PRICE_<OFFRE>_<PERIODE> (ex. DP_STRIPE_PRICE_ETO_PRO_MONTH), DP_PUBLIC_URL (retour après paiement).
  Google Play  : vérification d'un achat d'abonnement (purchases.subscriptionsv2) avec un compte de service : DP_PLAY_PACKAGE, DP_PLAY_SA (JSON).
  Sans ces variables, les routes de paiement répondent 503 « paiement non configuré » : rien n'est simulé.
  Clés d'activation : un CEO génère des clés (offre + durée + nombre d'utilisations), seule leur empreinte SHA-256 est gardée ; un compte ETO l'active dans l'application.
  Révocation : d'une clé (et, au choix, des abonnements qu'elle a ouverts) ou de l'abonnement d'un compte ; la licence suivante redescend en ETO Free.
Le serveur est la seule autorité : l'application ne fait que lire la licence signée."""
import secrets
import base64
import hashlib
import hmac
import json
import os
import time
import urllib.parse

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from fastapi import Depends, Header, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

from .. import db
from . import accounts, limits, service, tokens

V1 = "/launcher/v1/eto"
PLANS = ("eto_free", "eto_pro", "eto_max", "eto_ultra")
PRICES = {"eto_pro": (2.99, 28.70), "eto_max": (9.99, 95.90), "eto_ultra": (119.99, 1151.90)}       # TTC (mois, an) : affichage seulement, Stripe fait foi
SEATS = {"eto_free": 1, "eto_pro": 1, "eto_max": 1, "eto_ultra": 10}
# droits par offre : chaque offre contient les précédentes ; les échecs sont TOUJOURS gratuits
FEATURES = {
    "eto_free": ["chess", "tools", "chat_byok"],
    "eto_pro": ["improver_auto", "cleaner_auto", "backup_pc", "report"],
    "eto_max": ["pc_control", "clipper", "copilot", "gateway", "studio", "codelab"],
    "eto_ultra": ["team", "fleet", "depot", "qa", "white_label", "chess_engine"],
}
STAFF_PLAN = {"friends": "enos_std", "dev": "enos_dev", "ceo": "enos_ceo"}
ACTIVE = ("active", "trialing", "past_due")                    # past_due : délai de grâce de Stripe avant la coupure


def features_of(plan):
    if plan in STAFF_PLAN.values():                           # éditions privées : tout ce que l'offre la plus haute ouvre
        plan = "eto_ultra"
    out = []
    for p in PLANS:
        out += FEATURES[p]
        if p == plan:
            break
    return out


def _c():
    return db.conn()


def now():
    return time.time()


def log(uid, kind, data=None):
    with db._lock:
        _c().execute("INSERT INTO eto_events(t,user_id,kind,data) VALUES(?,?,?,?)", (now(), uid, kind, json.dumps(data or {})[:2000]))
        _c().commit()


# ---------------------------------------------------------------- comptes
def signup(email, password, name=""):
    """Inscription libre au grand public : rôle « public » (aucun accès au personnel), offre ETO Free."""
    email = service._norm_email(email)
    accounts.check_password(password, email)
    with db._lock:
        c = _c()
        if c.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
            raise service.AuthError(409, "Un compte existe déjà avec cette adresse.")
        cur = c.execute("INSERT INTO users(email,name,pw_hash,role,created_at) VALUES(?,?,?,?,?)", (email, (name or "").strip()[:60], accounts.hash_password(password), "public", now()))
        c.commit()
        uid = cur.lastrowid
    log(uid, "signup")
    return service.get_user(uid)


def subscription(u):
    """Offre effective : rôle du personnel -> édition privée ; sinon abonnement actif et non expiré, sinon ETO Free."""
    if u["role"] in STAFF_PLAN:
        return {"plan": STAFF_PLAN[u["role"]], "status": "active", "period_end": 0, "source": "staff", "seats": 0, "period": ""}
    with db._lock:
        r = _c().execute("SELECT * FROM eto_subs WHERE user_id=?", (u["id"],)).fetchone()
    if r and r["plan"] in PLANS and r["status"] in ACTIVE and (r["period_end"] == 0 or r["period_end"] > now()):
        return {"plan": r["plan"], "status": r["status"], "period_end": r["period_end"], "source": r["source"], "seats": r["seats"], "period": r["period"]}
    return {"plan": "eto_free", "status": "active", "period_end": 0, "source": "free", "seats": 1, "period": ""}


def set_subscription(uid, plan, status, period_end=0, source="manual", period="month", ext_customer="", ext_sub="", seats=None):
    if plan not in PLANS:
        raise service.AuthError(400, "Offre inconnue.")
    with db._lock:
        _c().execute("""INSERT INTO eto_subs(user_id,plan,period,status,period_end,source,ext_customer,ext_sub,seats,updated) VALUES(?,?,?,?,?,?,?,?,?,?)
                        ON CONFLICT(user_id) DO UPDATE SET plan=excluded.plan, period=excluded.period, status=excluded.status, period_end=excluded.period_end, source=excluded.source,
                        ext_customer=CASE WHEN excluded.ext_customer<>'' THEN excluded.ext_customer ELSE eto_subs.ext_customer END,
                        ext_sub=CASE WHEN excluded.ext_sub<>'' THEN excluded.ext_sub ELSE eto_subs.ext_sub END, seats=excluded.seats, updated=excluded.updated""",
                     (uid, plan, period, status, float(period_end or 0), source, ext_customer, ext_sub, int(seats or SEATS[plan]), now()))
        _c().commit()
    log(uid, "subscription", {"plan": plan, "status": status, "source": source})


def license_token(u):
    """Licence signée (7 jours) : l'application la vérifie avec la clé publique de GET /keys, sans réseau ; elle la renouvelle quand elle peut."""
    s = subscription(u)
    return tokens.issue(service.signing_key(), sub=u["id"], role=u["role"], typ="license", tv=u["token_version"],
                        extra={"plan": s["plan"], "status": s["status"], "seats": s["seats"], "features": features_of(s["plan"]), "period_end": int(s["period_end"]), "email": u["email"]})


# ---------------------------------------------------------------- clés d'activation
#   Format : ETO-XXXX-XXXX-XXXX-XXXX (alphabet de Crockford, sans I L O U) : 15 caractères aléatoires (75 bits) + 1 caractère de contrôle.
#   Seule l'empreinte SHA-256 est stockée : une fuite de la base ne donne aucune clé utilisable. La clé en clair n'est montrée qu'une fois, à sa création.
ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
RANK = {p: i for i, p in enumerate(PLANS)}


def _check_char(body):
    return ALPHA[sum((2 * i + 1) * ALPHA.index(ch) for i, ch in enumerate(body)) % 32]       # poids impairs : toute faute sur UN caractère change le contrôle


def norm_code(code):
    """« eto-abcd efgh… » -> « ABCDEFGH… » (16 caractères) ; les confusions courantes (O/0, I/L/1) sont corrigées."""
    c = "".join(ch for ch in str(code or "").upper() if ch.isalnum())
    if c.startswith("ETO") and len(c) == 19:
        c = c[3:]
    return c.translate(str.maketrans({"O": "0", "I": "1", "L": "1", "U": "V"}))


def valid_code(c):
    return len(c) == 16 and all(ch in ALPHA for ch in c) and _check_char(c[:15]) == c[15]


def fmt_code(c):
    return "ETO-" + "-".join(c[i:i + 4] for i in range(0, 16, 4))


def new_code():
    body = "".join(secrets.choice(ALPHA) for _ in range(15))
    return body + _check_char(body)


def _hash_code(c):
    return hashlib.sha256(("eto-key:" + c).encode()).hexdigest()


def create_keys(by_uid, plan, days, count=1, max_uses=1, expires_days=0, note=""):
    if plan not in PLANS or plan == "eto_free":
        raise service.AuthError(400, "Offre inconnue (Pro, MAX ou Ultra).")
    batch, out, t = secrets.token_hex(4), [], now()
    with db._lock:
        c = _c()
        for _ in range(count):
            code = new_code()
            c.execute("INSERT INTO eto_keys(code_hash,hint,plan,days,max_uses,note,batch,created_by,created,expires) VALUES(?,?,?,?,?,?,?,?,?,?)",
                      (_hash_code(code), code[-4:], plan, days, max_uses, (note or "").strip()[:120], batch, by_uid, t, t + expires_days * 86400 if expires_days else 0))
            out.append(fmt_code(code))
        c.commit()
    log(by_uid, "keys_created", {"plan": plan, "days": days, "count": count, "max_uses": max_uses, "batch": batch})
    return {"batch": batch, "plan": plan, "days": days, "max_uses": max_uses, "codes": out}


def _key_row(k):
    st = "revoked" if k["revoked"] else "expired" if k["expires"] and k["expires"] < now() else "used" if k["uses"] >= k["max_uses"] else "active"
    return {"id": k["id"], "hint": k["hint"], "plan": k["plan"], "days": k["days"], "max_uses": k["max_uses"], "uses": k["uses"], "note": k["note"], "batch": k["batch"],
            "created": int(k["created"]), "expires": int(k["expires"]), "revoked": int(k["revoked"]), "status": st}


def list_keys(limit=200):
    with db._lock:
        rows = _c().execute("SELECT * FROM eto_keys ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [_key_row(k) for k in rows]


def revoke_key(by_uid, key_id, revoke_subs=False):
    """Révoque une clé : plus personne ne peut l'activer ; avec revoke_subs, les abonnements qu'elle a ouverts (et pas renouvelés autrement) s'arrêtent."""
    with db._lock:
        c = _c()
        k = c.execute("SELECT * FROM eto_keys WHERE id=?", (key_id,)).fetchone()
        if not k:
            raise service.AuthError(404, "Clé introuvable.")
        c.execute("UPDATE eto_keys SET revoked=? WHERE id=? AND revoked=0", (now(), key_id))
        n = 0
        if revoke_subs:
            n = c.execute("UPDATE eto_subs SET status='revoked', updated=? WHERE source=? AND status<>'revoked'", (now(), "key:%d" % key_id)).rowcount
        c.commit()
    log(by_uid, "key_revoked", {"key": key_id, "subs": n})
    return {"revoked": True, "subscriptions_stopped": n}


def redeem(u, code):
    """Active une clé sur un compte ETO. Même offre déjà active : la durée s'ajoute. Offre supérieure déjà active : refus (la clé n'est pas consommée)."""
    if u["role"] != "public":
        raise service.AuthError(403, "Les comptes du personnel ont déjà toutes les fonctions : active la clé avec un compte ETO.")
    c = norm_code(code)
    if not valid_code(c):
        raise service.AuthError(400, "Clé invalide : vérifie les caractères (format ETO-XXXX-XXXX-XXXX-XXXX).")
    cur = subscription(u)
    with db._lock:
        con = _c()
        k = con.execute("SELECT * FROM eto_keys WHERE code_hash=?", (_hash_code(c),)).fetchone()
        if not k:
            raise service.AuthError(404, "Clé inconnue.")
        if k["revoked"]:
            raise service.AuthError(410, "Cette clé a été révoquée.")
        if k["expires"] and k["expires"] < now():
            raise service.AuthError(410, "Cette clé a expiré.")
        if con.execute("SELECT 1 FROM eto_key_uses WHERE key_id=? AND user_id=?", (k["id"], u["id"])).fetchone():
            raise service.AuthError(409, "Tu as déjà activé cette clé.")
        if cur["source"] != "free" and RANK[cur["plan"]] > RANK[k["plan"]]:
            raise service.AuthError(409, "Ton offre actuelle est déjà supérieure : la clé n'a pas été utilisée, garde-la ou offre-la.")
        if cur["source"] != "free" and cur["plan"] == k["plan"] and cur["period_end"] == 0:
            raise service.AuthError(409, "Cette offre est déjà active sans limite de durée sur ton compte.")
        if con.execute("UPDATE eto_keys SET uses=uses+1 WHERE id=? AND uses<max_uses", (k["id"],)).rowcount != 1:
            raise service.AuthError(410, "Cette clé a déjà été utilisée.")
        con.execute("INSERT INTO eto_key_uses(key_id,user_id,t) VALUES(?,?,?)", (k["id"], u["id"], now()))
        con.commit()
    base = cur["period_end"] if cur["plan"] == k["plan"] and cur["period_end"] > now() else now()
    set_subscription(u["id"], k["plan"], "active", base + k["days"] * 86400 if k["days"] else 0, "key:%d" % k["id"], "key")
    log(u["id"], "key_redeemed", {"key": k["id"], "plan": k["plan"], "days": k["days"]})
    return subscription(service.get_user(u["id"]))


def revoke_subscription(by_uid, email, reason="", cancel_billing=False):
    """Coupe l'abonnement d'un compte ETO (fraude, remboursement, fin de partenariat). Avec cancel_billing, l'abonnement Stripe est aussi annulé tout de suite."""
    t = service.user_by_email(email)
    if not t or t["role"] != "public":
        raise service.AuthError(404, "Compte ETO introuvable.")
    with db._lock:
        r = _c().execute("SELECT * FROM eto_subs WHERE user_id=?", (t["id"],)).fetchone()
    if not r or r["status"] == "revoked":
        raise service.AuthError(409, "Aucun abonnement actif sur ce compte.")
    billing = "none"
    if cancel_billing and r["ext_sub"].startswith("sub_"):
        try:
            _stripe("DELETE", "/subscriptions/" + r["ext_sub"]); billing = "cancelled"
        except service.AuthError as e:
            billing = "error: " + str(getattr(e, "detail", e))[:120]
    with db._lock:
        _c().execute("UPDATE eto_subs SET status='revoked', updated=? WHERE user_id=?", (now(), t["id"]))
        _c().commit()
    log(t["id"], "subscription_revoked", {"by": by_uid, "reason": (reason or "")[:200], "plan": r["plan"], "billing": billing})
    return {"email": t["email"], "previous": r["plan"], "billing": billing, "subscription": subscription(service.get_user(t["id"]))}


def list_subscribers(q="", limit=100):
    like = "%" + (q or "").strip().lower() + "%"
    with db._lock:
        rows = _c().execute("""SELECT u.email, u.name, u.created_at, s.plan, s.status, s.period_end, s.source, s.period FROM users u LEFT JOIN eto_subs s ON s.user_id=u.id
                               WHERE u.role='public' AND lower(u.email) LIKE ? ORDER BY COALESCE(s.updated, u.created_at) DESC LIMIT ?""", (like, limit)).fetchall()
    out = []
    for r in rows:
        live = r["plan"] and r["status"] in ACTIVE and (not r["period_end"] or r["period_end"] > now())
        out.append({"email": r["email"], "name": r["name"], "plan": r["plan"] if live else "eto_free", "status": r["status"] or "free", "period_end": int(r["period_end"] or 0),
                    "source": r["source"] or "", "since": int(r["created_at"] or 0)})
    return out


# ---------------------------------------------------------------- Stripe (API REST, sans SDK)
def _stripe_key():
    k = os.environ.get("DP_STRIPE_SECRET", "").strip()
    if not k:
        raise service.AuthError(503, "Paiement en ligne non configuré sur ce serveur.")
    return k


def _stripe(method, path, data=None):
    r = httpx.request(method, "https://api.stripe.com/v1" + path, data=data, auth=(_stripe_key(), ""), timeout=20)
    if r.status_code >= 400:
        raise service.AuthError(502, "Stripe a refusé la demande.")
    return r.json()


def price_id(plan, period):
    pid = os.environ.get(f"DP_STRIPE_PRICE_{plan.upper()}_{period.upper()}", "").strip()
    if not pid:
        raise service.AuthError(503, "Cette offre n'est pas encore en vente.")
    return pid


def checkout(u, plan, period, base_url):
    if plan not in PRICES or period not in ("month", "year"):
        raise service.AuthError(400, "Offre ou période inconnue.")
    if u["role"] != "public":
        raise service.AuthError(400, "Les comptes du personnel ont déjà leur édition.")
    pub = (os.environ.get("DP_PUBLIC_URL", "") or base_url).rstrip("/")
    s = _stripe("POST", "/checkout/sessions", {
        "mode": "subscription", "line_items[0][price]": price_id(plan, period), "line_items[0][quantity]": "1",
        "client_reference_id": str(u["id"]), "customer_email": u["email"], "allow_promotion_codes": "true",
        "subscription_data[metadata][user_id]": str(u["id"]), "subscription_data[metadata][plan]": plan, "subscription_data[metadata][period]": period,
        "success_url": pub + "/eto/merci?session={CHECKOUT_SESSION_ID}", "cancel_url": pub + "/eto/offres"})
    log(u["id"], "checkout", {"plan": plan, "period": period})
    return {"url": s["url"]}


def portal(u, base_url):
    with db._lock:
        r = _c().execute("SELECT ext_customer FROM eto_subs WHERE user_id=? AND source='stripe'", (u["id"],)).fetchone()
    if not r or not r["ext_customer"]:
        raise service.AuthError(404, "Aucun abonnement payé en ligne pour ce compte.")
    pub = (os.environ.get("DP_PUBLIC_URL", "") or base_url).rstrip("/")
    return {"url": _stripe("POST", "/billing_portal/sessions", {"customer": r["ext_customer"], "return_url": pub + "/eto/offres"})["url"]}


def verify_stripe_signature(payload: bytes, header: str, secret: str, tolerance=300, now_t=None):
    """En-tête Stripe-Signature : t=…,v1=… ; HMAC SHA-256 de « t.payload » ; refuse un horodatage trop vieux (rejeu)."""
    parts = dict(p.split("=", 1) for p in (header or "").split(",") if "=" in p)
    t, sig = parts.get("t", ""), [v for k, v in (p.split("=", 1) for p in (header or "").split(",") if "=" in p) if k == "v1"]
    if not t.isdigit() or not sig:
        return False
    if abs((now_t or now()) - int(t)) > tolerance:
        return False
    exp = hmac.new(secret.encode(), t.encode() + b"." + payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(exp, s) for s in sig)


def stripe_event(ev):
    """Abonnement créé / modifié / supprimé chez Stripe -> table eto_subs (le webhook est la seule source de vérité du paiement en ligne)."""
    typ, obj = ev.get("type", ""), (ev.get("data") or {}).get("object") or {}
    if typ in ("customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"):
        md = obj.get("metadata") or {}
        uid, plan = int(md.get("user_id") or 0), md.get("plan", "")
        if not uid or plan not in PRICES or not service.get_user(uid):
            return False
        status = "canceled" if typ.endswith("deleted") else obj.get("status", "incomplete")
        set_subscription(uid, plan, status, obj.get("current_period_end") or 0, "stripe", md.get("period", "month"), obj.get("customer", ""), obj.get("id", ""))
        return True
    return False


# ---------------------------------------------------------------- Google Play (achats faits dans l'application publiée sur le Play Store)
def _play_token():
    raw = os.environ.get("DP_PLAY_SA", "").strip()
    if not raw or not os.environ.get("DP_PLAY_PACKAGE"):
        raise service.AuthError(503, "Vérification Google Play non configurée sur ce serveur.")
    sa = json.loads(raw)
    t = int(now())
    head = base64.urlsafe_b64encode(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()).rstrip(b"=")
    body = base64.urlsafe_b64encode(json.dumps({"iss": sa["client_email"], "scope": "https://www.googleapis.com/auth/androidpublisher", "aud": "https://oauth2.googleapis.com/token", "iat": t, "exp": t + 600}).encode()).rstrip(b"=")
    key = serialization.load_pem_private_key(sa["private_key"].encode(), password=None)
    sig = base64.urlsafe_b64encode(key.sign(head + b"." + body, padding.PKCS1v15(), hashes.SHA256())).rstrip(b"=")
    r = httpx.post("https://oauth2.googleapis.com/token", data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": (head + b"." + body + b"." + sig).decode()}, timeout=20)
    if r.status_code != 200:
        raise service.AuthError(502, "Google a refusé le compte de service.")
    return r.json()["access_token"]


PLAY_PRODUCTS = {"eto_pro": "eto_pro", "eto_max": "eto_max", "eto_ultra": "eto_ultra"}         # identifiant d'abonnement dans la Play Console -> offre


def play_verify(u, product_id, purchase_token):
    plan = PLAY_PRODUCTS.get(product_id)
    if not plan or not purchase_token:
        raise service.AuthError(400, "Achat inconnu.")
    pkg = os.environ.get("DP_PLAY_PACKAGE", "")
    r = httpx.get(f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{urllib.parse.quote(pkg)}/purchases/subscriptionsv2/tokens/{urllib.parse.quote(purchase_token)}",
                  headers={"Authorization": "Bearer " + _play_token()}, timeout=20)
    if r.status_code != 200:
        raise service.AuthError(400, "Achat introuvable chez Google Play.")
    j = r.json()
    state = j.get("subscriptionState", "")
    items = j.get("lineItems") or [{}]
    exp = items[0].get("expiryTime", "")
    end = 0
    if exp:
        from datetime import datetime
        end = datetime.fromisoformat(exp.replace("Z", "+00:00")).timestamp()
    status = "active" if state in ("SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD") else "canceled"
    set_subscription(u["id"], plan, status, end, "play", "month", "", purchase_token[:120])
    return subscription(u)


# ---------------------------------------------------------------- routes
class SignupIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)
    name: str = Field(default="", max_length=60)
    device: str = Field(default="", max_length=60)


class CheckoutIn(BaseModel):
    plan: str = Field(max_length=20)
    period: str = Field(default="month", max_length=10)


class PlayIn(BaseModel):
    product_id: str = Field(max_length=60)
    purchase_token: str = Field(max_length=4000)


class KeysIn(BaseModel):
    plan: str = Field(max_length=20)
    days: int = Field(default=30, ge=0, le=3660)
    count: int = Field(default=1, ge=1, le=200)
    max_uses: int = Field(default=1, ge=1, le=1000)
    expires_days: int = Field(default=0, ge=0, le=3660)
    note: str = Field(default="", max_length=120)


class RedeemIn(BaseModel):
    code: str = Field(max_length=40)


class KeyRevokeIn(BaseModel):
    id: int
    revoke_subs: bool = False


class RevokeIn(BaseModel):
    email: str = Field(max_length=254)
    reason: str = Field(default="", max_length=200)
    cancel_billing: bool = False


class GrantIn(BaseModel):
    email: str = Field(max_length=254)
    plan: str = Field(max_length=20)
    days: int = Field(default=30, ge=0, le=3660)


def routes(r, current_user, require, ip_of):
    @r.get(V1 + "/plans")
    def plans():
        """Catalogue public (prix TTC indicatifs, droits par offre)."""
        return {"plans": [{"id": p, "month": PRICES.get(p, (0, 0))[0], "year": PRICES.get(p, (0, 0))[1], "seats": SEATS[p], "features": features_of(p)} for p in PLANS]}

    @r.post(V1 + "/signup")
    def signup_route(b: SignupIn, request: Request):
        ip = ip_of(request)
        if not limits.ok("etosign", ip, 6, per=600):
            raise service.AuthError(429, "Trop de tentatives, réessaie plus tard.")
        try:
            u = signup(b.email, b.password, b.name)
        except ValueError as e:
            raise service.AuthError(400, str(e))
        return service.session_for(u, b.device, ip)

    @r.get(V1 + "/me")
    def me(u=Depends(current_user)):
        return {"user": service._public(u), "subscription": subscription(u), "features": features_of(subscription(u)["plan"])}

    @r.post(V1 + "/license")
    def license(u=Depends(current_user)):
        return {"license": license_token(u), "kid": tokens.kid_of(tokens.public_b64(service.signing_key())), "public_key": tokens.public_b64(service.signing_key())}

    @r.post(V1 + "/billing/checkout")
    def checkout_route(b: CheckoutIn, request: Request, u=Depends(current_user)):
        if not limits.ok("etopay", u["id"], 10, per=600):
            raise service.AuthError(429, "Trop de demandes.")
        return checkout(u, b.plan, b.period, str(request.base_url))

    @r.post(V1 + "/billing/portal")
    def portal_route(request: Request, u=Depends(current_user)):
        return portal(u, str(request.base_url))

    @r.post(V1 + "/billing/stripe-webhook")
    async def stripe_hook(request: Request, stripe_signature: str = Header(default="")):
        secret = os.environ.get("DP_STRIPE_WEBHOOK_SECRET", "")
        payload = await request.body()
        if not secret or not verify_stripe_signature(payload, stripe_signature, secret):
            return JSONResponse({"detail": "signature invalide"}, status_code=400)
        try:
            ev = json.loads(payload)
        except ValueError:
            return JSONResponse({"detail": "corps invalide"}, status_code=400)
        return {"handled": stripe_event(ev)}

    @r.post(V1 + "/billing/play")
    def play_route(b: PlayIn, u=Depends(current_user)):
        return play_verify(u, b.product_id, b.purchase_token)

    # pages de retour du paiement Stripe (le droit arrive par le webhook ; l'application relit sa licence au retour)
    PAGE = """<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ETO</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08090d;color:#f6f3f5;font:16px/1.5 system-ui,sans-serif}main{max-width:440px;padding:32px;border-radius:24px;border:1px solid #25262e;background:linear-gradient(165deg,#17181e,#0c0d11);text-align:center}
h1{margin:0 0 8px;font-size:26px}b{color:%s}p{color:#a8a6af}</style></head><body><main><h1>%s</h1><p>%s</p></main></body></html>"""

    @r.get("/eto/merci", response_class=HTMLResponse)
    def merci():
        return PAGE % ("#3b82f6", "Merci, ton abonnement <b>ETO</b> est en route", "Retourne dans l'application : elle se met à jour toute seule dans quelques secondes (Modules › Abonnement).")

    @r.get("/eto/offres", response_class=HTMLResponse)
    def offres():
        return PAGE % ("#34d399", "Paiement annulé", "Rien n'a été prélevé. Tu peux revenir dans l'application et choisir une offre quand tu veux. Les échecs restent gratuits.")

    @r.post(V1 + "/admin/grant")
    def grant(b: GrantIn, u=Depends(require("ceo"))):
        """Offre accordée à la main par un CEO (partenaires, presse, comptes pilotes d'entreprises)."""
        t = service.user_by_email(b.email)
        if not t or t["role"] != "public":
            raise service.AuthError(404, "Compte ETO introuvable.")
        set_subscription(t["id"], b.plan, "active", now() + b.days * 86400 if b.days else 0, "manual")
        return subscription(service.get_user(t["id"]))

    @r.post(V1 + "/redeem")
    def redeem_route(b: RedeemIn, request: Request, u=Depends(current_user)):
        if not limits.ok("etokey", u["id"], 8, per=3600) or not limits.ok("etokeyip", ip_of(request), 20, per=3600):
            raise service.AuthError(429, "Trop d'essais de clés : réessaie dans une heure.")
        return {"subscription": redeem(u, b.code), "license": license_token(service.get_user(u["id"]))}

    @r.post(V1 + "/admin/keys")
    def keys_create(b: KeysIn, u=Depends(require("ceo"))):
        return create_keys(u["id"], b.plan, b.days, b.count, b.max_uses, b.expires_days, b.note)

    @r.get(V1 + "/admin/keys")
    def keys_list(u=Depends(require("ceo"))):
        return {"keys": list_keys()}

    @r.post(V1 + "/admin/keys/revoke")
    def keys_revoke(b: KeyRevokeIn, u=Depends(require("ceo"))):
        return revoke_key(u["id"], b.id, b.revoke_subs)

    @r.get(V1 + "/admin/subs")
    def subs_list(q: str = "", u=Depends(require("ceo"))):
        return {"subscribers": list_subscribers(q[:254])}

    @r.post(V1 + "/admin/revoke")
    def revoke_route(b: RevokeIn, u=Depends(require("ceo"))):
        return revoke_subscription(u["id"], b.email, b.reason, b.cancel_billing)
