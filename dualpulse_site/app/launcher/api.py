"""Routes /launcher/v1 (FastAPI). Les décisions d'accès sont prises dans service.py ; ici : validation, limitation de débit, dépendances d'authentification."""
import os

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .. import whitelist
from . import accounts, limits, manifests, service, storage, tokens

V1 = "/launcher/v1"


def _ip(request: Request):
    return whitelist.client_ip(request) or "inconnue"


def _err(e: service.AuthError):
    return JSONResponse({"detail": e.detail, **e.extra}, status_code=e.status, headers={"Cache-Control": "no-store"})


def _bearer(authorization: str):
    if not authorization.lower().startswith("bearer "):
        raise service.AuthError(401, "Authentification requise.")
    return authorization[7:].strip()


def current_user(authorization: str = Header(default="")):
    return service.user_from_token(_bearer(authorization))


def optional_user(authorization: str = Header(default="")):
    if not authorization:
        return None
    return service.user_from_token(_bearer(authorization))


def require(minimum):
    """Dépendance : rôle minimum (hiérarchie friends < dev < ceo). Le CEO peut en plus être contraint à la double authentification (DP_REQUIRE_CEO_TOTP=1)."""
    def dep(u=Depends(current_user)):
        if not accounts.at_least(u["role"], minimum):
            raise service.AuthError(403, "Accès refusé pour votre profil.")
        if minimum == "ceo" and os.environ.get("DP_REQUIRE_CEO_TOTP") == "1" and not u["totp_enabled"]:
            raise service.AuthError(403, "Activez la double authentification (TOTP) avant d'administrer.", mfa_setup_required=True)
        return u
    return dep


class Register(BaseModel):
    invite: str = Field(max_length=80)
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)
    name: str = Field(default="", max_length=60)


class Login(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)
    totp: str = Field(default="", max_length=12)
    device: str = Field(default="", max_length=60)


class Refresh(BaseModel):
    refresh_token: str = Field(max_length=200)


class PasswordChange(BaseModel):
    old: str = Field(max_length=200)
    new: str = Field(max_length=200)


class Code(BaseModel):
    code: str = Field(max_length=12)


class InviteIn(BaseModel):
    role: str = "friends"
    days: int = 7
    note: str = Field(default="", max_length=80)
    code: str | None = Field(default=None, max_length=40)     # code choisi par le CEO (ex. NASKO-VIP) ; absent / vide = code aléatoire


class UserPatch(BaseModel):
    role: str | None = None
    active: bool | None = None


class Publish(BaseModel):
    manifest: dict
    signature: str = Field(max_length=200)


class Ceo(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)


class Status(BaseModel):
    status: str


class NewsIn(BaseModel):
    title: str = Field(max_length=120)
    body: str = Field(default="", max_length=600)
    image: str = Field(default="", max_length=500)
    link: str = Field(default="", max_length=500)
    kind: str = "news"
    min_role: str = "public"
    priority: int = 0
    starts_at: float | None = None
    ends_at: float | None = None
    active: bool = True


class ClipIn(BaseModel):
    kind: str
    content: str = Field(max_length=2_100_000)
    mime: str = Field(default="", max_length=40)
    device: str = Field(default="", max_length=40)


class Beat(BaseModel):
    device_id: str = Field(max_length=64)
    name: str = Field(default="", max_length=60)
    platform: str = Field(default="android", max_length=20)
    lan_ips: list[str] = Field(default_factory=list, max_length=8)
    adb_port: int = 0
    app_version: str = Field(default="", max_length=20)


class AgendaSync(BaseModel):
    since: float = 0
    tasks: list[dict] = Field(default_factory=list, max_length=500)


class Wish(BaseModel):
    email: str = Field(max_length=254)


def build(admin_guard, admin_path):
    r = APIRouter()
    A = admin_path + "/api/launcher"

    # ------------------------------------------------------------ authentification
    @r.post(V1 + "/auth/register")
    def register(b: Register, request: Request):
        ip = _ip(request)
        if not limits.ok("lreg", ip, 8, per=600):
            raise service.AuthError(429, "Trop d'essais, réessayez plus tard.")
        u = service.register(b.invite, b.email, b.password, b.name)
        return service.session_for(u, "", ip)

    @r.post(V1 + "/auth/login")
    def login(b: Login, request: Request):
        ip = _ip(request)
        if not limits.ok("llogin", ip, 12):
            raise service.AuthError(429, "Trop d'essais, réessayez dans une minute.")
        u = service.authenticate(b.email, b.password, b.totp, ip)
        return service.session_for(u, b.device, ip)

    @r.post(V1 + "/auth/refresh")
    def refresh(b: Refresh, request: Request):
        ip = _ip(request)
        if not limits.ok("lref", ip, 60):
            raise service.AuthError(429, "Trop de requêtes.")
        return service.refresh_session(b.refresh_token, "", ip)

    @r.post(V1 + "/auth/logout")
    def logout(b: Refresh):
        service.logout(b.refresh_token)
        return {"ok": True}

    @r.post(V1 + "/auth/logout-all")
    def logout_all(u=Depends(current_user)):
        service.revoke_all(u["id"])
        return {"ok": True}

    @r.post(V1 + "/auth/attest")
    def attest(u=Depends(current_user)):
        return {"attestation": service.attest(u), "expires_in": tokens.TTL["attest"], "role": u["role"]}

    @r.post(V1 + "/auth/password")
    def password(b: PasswordChange, u=Depends(current_user)):
        service.change_password(u, b.old, b.new)
        return {"ok": True}

    @r.post(V1 + "/auth/totp/setup")
    def totp_setup(u=Depends(current_user)):
        return service.totp_setup(u)

    @r.post(V1 + "/auth/totp/enable")
    def totp_enable(b: Code, u=Depends(current_user)):
        service.totp_enable(u, b.code)
        return {"ok": True}

    @r.get(V1 + "/keys")
    def keys():
        pub = service.public_key()
        mp = os.environ.get("DP_MANIFEST_PUBKEY", "").strip()
        return {"token": {"alg": "EdDSA", "kid": tokens.kid_of(tokens.public_b64(pub)), "public_key": tokens.public_b64(pub)}, "manifest": {"alg": "Ed25519", "public_key": mp} if mp else None}

    @r.get(V1 + "/me")
    def me(u=Depends(current_user)):
        return service._public(u)

    # ------------------------------------------------------------ gestion (CEO)
    @r.post(V1 + "/invites")
    def invite_new(b: InviteIn, u=Depends(require("ceo"))):
        return service.create_invite(u["id"], b.role, b.days, b.note, b.code)

    @r.get(V1 + "/invites")
    def invite_list(u=Depends(require("ceo"))):
        return {"items": service.list_invites()}

    @r.delete(V1 + "/invites/{iid}")
    def invite_del(iid: int, u=Depends(require("ceo"))):
        service.revoke_invite(iid)
        return {"ok": True}

    @r.get(V1 + "/users")
    def users(u=Depends(require("ceo"))):
        return {"items": service.list_users()}

    @r.patch(V1 + "/users/{uid}")
    def user_patch(uid: int, b: UserPatch, u=Depends(require("ceo"))):
        return service.update_user(u, uid, b.role, b.active)

    @r.post(V1 + "/users/{uid}/revoke-sessions")
    def user_revoke(uid: int, u=Depends(require("ceo"))):
        if not service.get_user(uid):
            raise service.AuthError(404, "Compte introuvable.")
        service.revoke_all(uid)
        return {"ok": True}

    @r.put(V1 + "/products/terna/status")
    def terna_status(b: Status, u=Depends(require("ceo"))):
        if b.status not in service.TERNA_STATES:
            raise service.AuthError(400, "État inconnu (wishlist, alpha, released).")
        service.set_setting("terna_status", b.status)
        return {"status": b.status}

    # ------------------------------------------------------------ mises à jour de l'app mobile : même forme que le PC (/api/app/version + /nasko.apk), derrière un jeton d'appareil
    @r.post(V1 + "/mobile/update-token")
    def mobile_token(b: Beat, u=Depends(current_user)):
        if not limits.ok("lupt", u["id"], 10, per=3600):
            raise service.AuthError(429, "Trop de demandes.")
        return {"token": service.update_token_create(u["id"], b.device_id), "base": f"/m/", "expires_in": service.UPDATE_TTL}

    def _tok_user(token: str, request: Request):
        if not limits.ok("lmob", _ip(request), 120):
            raise service.AuthError(429, "Trop de requêtes.")
        u = service.update_token_user(token)
        if not u:
            raise HTTPException(404)                                   # indiscernable d'une page inexistante
        return u

    @r.get("/m/{token}/api/app/version")
    def mobile_version(token: str, request: Request):
        return service.mobile_version(_tok_user(token, request))

    @r.get("/m/{token}/nasko.apk")
    def mobile_apk(token: str, request: Request):
        from fastapi.responses import RedirectResponse
        u = _tok_user(token, request)
        return RedirectResponse(service.mobile_apk_link(u, _ip(request), str(request.base_url)), status_code=302, headers={"Cache-Control": "no-store"})

    # ------------------------------------------------------------ presse-papiers universel, appareils (tout profil connecté ; chaque compte ne voit QUE ses données)
    @r.post(V1 + "/clipboard")
    def clip_new(b: ClipIn, u=Depends(current_user)):
        if not limits.ok("lclip", u["id"], 90):
            raise service.AuthError(429, "Trop d'envois, réessayez dans une minute.")
        return {"id": service.clip_add(u["id"], b.kind, b.content, b.mime, b.device)}

    @r.get(V1 + "/clipboard")
    def clip_get(since_id: int = 0, limit: int = 20, u=Depends(current_user)):
        return {"items": service.clip_list(u["id"], since_id, limit)}

    @r.delete(V1 + "/clipboard/{cid}")
    def clip_del(cid: int, u=Depends(current_user)):
        service.clip_delete(u["id"], cid)
        return {"ok": True}

    @r.post(V1 + "/devices/beat")
    def device_beat(b: Beat, request: Request, u=Depends(current_user)):
        ips = list(b.lan_ips)
        service.device_beat(u["id"], b.device_id, b.name, b.platform, ips, b.adb_port, b.app_version)
        return {"ok": True}

    @r.get(V1 + "/devices")
    def devices(u=Depends(current_user)):
        return {"items": service.device_list(u["id"])}

    @r.post(V1 + "/agenda/sync")
    def agenda_sync(b: AgendaSync, u=Depends(current_user)):
        if not limits.ok("lagsync", u["id"], 120):
            raise service.AuthError(429, "Trop de synchronisations, réessayez dans une minute.")
        tasks, tnow = service.agenda_sync(u["id"], b.tasks, b.since)
        return {"tasks": tasks, "now": tnow}

    # ------------------------------------------------------------ bannières, liste de souhaits
    @r.get(V1 + "/news")
    def news(u=Depends(optional_user)):
        return {"items": service.list_news(u["role"] if u else "public")}

    @r.get(V1 + "/news/all")
    def news_all(u=Depends(require("ceo"))):
        return {"items": service.list_news("ceo", include_all=True)}

    @r.post(V1 + "/news")
    def news_new(b: NewsIn, u=Depends(require("ceo"))):
        return {"id": service.create_news(b.model_dump())}

    @r.patch(V1 + "/news/{nid}")
    def news_patch(nid: int, b: dict, u=Depends(require("ceo"))):
        service.update_news(nid, {k: v for k, v in b.items() if k in NewsIn.model_fields})
        return {"ok": True}

    @r.delete(V1 + "/news/{nid}")
    def news_del(nid: int, u=Depends(require("ceo"))):
        service.delete_news(nid)
        return {"ok": True}

    @r.post(V1 + "/wishlist")
    def wishlist(b: Wish, request: Request):
        if not limits.ok("lwish", _ip(request), 6, per=600):
            raise service.AuthError(429, "Trop d'essais, réessayez plus tard.")
        service.add_wishlist(b.email, _ip(request))
        return {"ok": True}

    @r.get(V1 + "/wishlist/count")
    def wishlist_count(u=Depends(require("ceo"))):
        return {"count": service.wishlist_count()}

    # ------------------------------------------------------------ distribution
    @r.get(V1 + "/catalog")
    def catalog(u=Depends(optional_user)):
        role = u["role"] if u else "public"
        return {"role": role, "products": service.catalog(role)}

    @r.get(V1 + "/manifest/{product}/{channel}")
    def manifest(product: str, channel: str, version: str = "", u=Depends(current_user)):
        rel = service.release_manifest(u["role"], product, channel, version or None)
        return {"manifest": rel["manifest"], "signature": rel["signature"]}

    @r.get(V1 + "/download/{product}/{channel}/{version}/{index}")
    def download(product: str, channel: str, version: str, index: int, request: Request, u=Depends(current_user)):
        ip = _ip(request)
        if not limits.ok("ldl", u["id"], 60, per=600):
            raise service.AuthError(429, "Trop de téléchargements, réessayez dans quelques minutes.")
        return service.download_link(u, product, channel, version, index, ip, str(request.base_url))

    @r.get(V1 + "/blob/{token}")
    def blob(token: str):
        try:
            claims = tokens.verify(token, service.public_key(), typ="blob")
        except tokens.TokenError:
            raise HTTPException(404)
        p = storage.local_path(claims["sub"])
        if not p:
            raise HTTPException(404)
        return FileResponse(p, media_type="application/octet-stream", headers={"X-Robots-Tag": "noindex", "Cache-Control": "private, no-store"})

    # ------------------------------------------------------------ administration serveur (jeton X-Admin-Token)
    @r.post(A + "/ceo")
    def admin_ceo(b: Ceo, request: Request):
        admin_guard(request)
        return {"ok": True, "id": service.bootstrap_ceo(b.email, b.password)}

    @r.post(A + "/releases")
    def admin_publish(b: Publish, request: Request):
        admin_guard(request)
        return {"ok": True, "id": service.publish(b.manifest, b.signature)}

    @r.get(A + "/releases")
    def admin_releases(request: Request):
        admin_guard(request)
        return {"items": service.list_releases()}

    @r.post(A + "/releases/{rid}/yank")
    def admin_yank(rid: int, request: Request):
        admin_guard(request)
        service.yank(rid)
        return {"ok": True}

    return r


def install(app, admin_guard, admin_path):
    """Branche le routeur et traduit AuthError en réponse JSON."""
    @app.exception_handler(service.AuthError)
    async def _auth_error(request, exc):
        return _err(exc)

    app.include_router(build(admin_guard, admin_path))
