"""Serveur local E.N.O.S. (FastAPI) : logique, automatisation, ElevenLabs, interface web sur localhost."""
import asyncio
import ipaddress
import json
import logging
import os
import secrets
import shutil
import socket
import sys
import subprocess
import zipfile
import re
import atexit
import threading
import time
import urllib.request
from datetime import datetime

import segno
import uvicorn
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response, StreamingResponse
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel

import nasko_actions
import nasko_anim
import nasko_audio
import nasko_cert
import nasko_compress
import nasko_pdf
import nasko_receipts
import nasko_studio
import nasko_syllabus
import subs_analyzer
import nasko_roles
import nasko_cloud
import nasko_mirror
import nasko_toast
import nasko_tray
import nasko_autostart
import nasko_cleaner
import nasko_organizer
import nasko_paths
import nasko_youtube
import nasko_eleven
import nasko_persona
import nasko_env
import nasko_imagefactory
import nasko_llm
import nasko_memory
import nasko_mobile
import nasko_chess
import nasko_embed
import nasko_chessbridge
import opening_manager
import nasko_visualtheme
import nasko_notify
import nasko_agenda
import nasko_agent
import nasko_epita
import nasko_mobchess
import nasko_train
import nasko_onboarding
import nasko_pairing
import nasko_ota
import nasko_update_signal
import nasko_pet
import nasko_babel
import nasko_brb
import nasko_afk
import nasko_clipper
import nasko_tilt
import nasko_power
import nasko_screen
import nasko_security as sec
import nasko_stt
import nasko_loopback
import nasko_apimon
import nasko_sysctl
import nasko_sysmon
import nasko_diag
import nasko_godotdiag
import nasko_sync
import nasko_tabs
import nasko_ext
import nasko_cache
import nasko_team
import nasko_chat
import nasko_git
import nasko_devmanager
import nasko_depot
import nasko_depot_forge
import nasko_depot_git
import nasko_depot_study
import nasko_depot_term
import nasko_godotsync
import nasko_trust
import nasko_tasks
import nasko_voice
from nasko_core import GREETINGS, data_dir, find_asset, read_stats, ensure_config_file, find_logo, load_config, resource_path, update_config
import nasko_core

# Plus de jeton par lancement dans la page : l'authentification repose sur la clé d'API persistante (nasko_security),
# fournie à la fenêtre native par le pont pywebview, jamais par HTTP à un client local.
log = logging.getLogger("nasko")
app = FastAPI(title="E.N.O.S.", docs_url=None, redoc_url=None, openapi_url=None)
recorder = nasko_stt.Recorder()   # micro physique du PC : un enregistrement a la fois
state = {"window": None, "port": 8765, "https_port": None, "network": False, "shutdown": None,
         "https_srv": None, "servers": []}
VIEWERS = {}                # flux de visu ouverts : id -> {name, ip, since, preset}
SCREEN = {"reason": ""}     # derniere raison d'absence d'image (aucune_fenetre, noir, ...)
MAX_VIEWERS = 3
devices = nasko_trust.DeviceStore()   # appareils de confiance (jetons permanents, empreintes uniquement)
FAILS = {}                # ip -> (echecs, verrouille_jusqu_a)
lock = threading.Lock()


# ----------------------------------------------------------------------------- securite
def _hostname(header):
    h = header.strip()
    return h[1:h.index("]")] if h.startswith("[") and "]" in h else h.split(":")[0]


def _is_ip(host):
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


def is_local(request: Request):
    return (request.client.host if request.client else "") in ("127.0.0.1", "::1")


PUBLIC_REMOTE = ("/login", "/login-token", "/nasko-ca.crt", "/nasko.apk", "/api/app/version")      # accessibles avant toute authentification
PUBLIC_PREFIXES = ("/dl/",)          # liens de téléchargement temporaires : la clé est le jeton aléatoire de l'URL (expire, révocable)
UPLOAD_PATHS = ("/api/sync/upload", "/api/compress/upload")


def _client_ip(request: Request):
    return request.client.host if request.client else "?"


def authenticate(request: Request):
    """Appareil authentifie : cookie de confiance valide, ou IP figurant dans `trusted_ips`. None sinon."""
    ip = _client_ip(request)
    rec = devices.verify(request.cookies.get(nasko_trust.COOKIE), ip)
    if rec:
        return {**rec, "via": "token"}
    cfg = load_config()
    if nasko_trust.ip_trusted(ip, cfg.get("trusted_ips"), bool(cfg.get("allow_vpn_ranges"))):
        return {"id": "ip", "name": f"IP de confiance ({ip})", "ip": ip, "via": "ip"}
    if sec.check_bearer(request.headers.get("authorization", "")):          # application mobile appairée : sa clé d'API (256 bits, comparée en temps constant) vaut cookie de connexion
        dev = request.headers.get("x-eto-device", "").strip()
        return {"id": dev or "key", "name": (nasko_team.device_name(dev) if dev else "") or "Téléphone appairé", "ip": ip, "via": "key"}
    return None


@app.middleware("http")
async def guard(request: Request, call_next):
    """Anti DNS-rebinding (Host = localhost ou IP) + authentification des clients distants (acces reseau)."""
    host = _hostname(request.headers.get("host", ""))
    if not (host == "localhost" or _is_ip(host)):
        return JSONResponse({"detail": "forbidden"}, status_code=403)
    request.state.device = None
    if not is_local(request):
        if not state["network"]:
            return JSONResponse({"detail": "forbidden"}, status_code=403)
        request.state.device = authenticate(request)
        path = request.url.path
        if request.state.device is None and path not in PUBLIC_REMOTE and not path.startswith(PUBLIC_PREFIXES):
            if path == "/":
                with open(resource_path("static", "login.html"), encoding="utf-8") as f:
                    return HTMLResponse(f.read(), headers={"Cache-Control": "no-store"})
            return JSONResponse({"detail": "authentification requise"}, status_code=401)
    if request.method == "POST" and request.url.path in UPLOAD_PATHS:        # refus AVANT de lire le corps : pas de disque rempli pour rien
        cl = request.headers.get("content-length", "")
        if cl.isdigit() and int(cl) > nasko_sync.max_bytes() + 2 * 1048576:
            return JSONResponse({"detail": f"Fichier trop volumineux (maximum {nasko_sync.max_bytes() // 1048576} Mo)."}, status_code=413)
    resp = await call_next(request)
    dev = request.state.device
    if dev and dev.get("via") == "key" and request.url.path == "/" and not request.cookies.get(nasko_trust.COOKIE):
        token, _rec = devices.create(request.headers.get("user-agent", ""), _client_ip(request))      # application mobile : la page « interface complète » charge ensuite ses fichiers avec ce cookie
        _set_device_cookie(resp, token, request)
    return resp


def need_token(request: Request):
    """Dépendance des routes : la requête a déjà été authentifiée (Bearer ou ticket) par SecurityMiddleware."""
    if not request.scope.get("state", {}).get("authed"):
        raise HTTPException(401, "Unauthorized")


# =============================================================================== SÉCURITÉ : middlewares ASGI
import json as _json_mod  # noqa: E402
from urllib.parse import parse_qs  # noqa: E402

PUBLIC_EXACT = ("/", "/login", "/login-token", "/nasko-ca.crt", "/nasko.apk", "/api/app/version", "/api/ping", "/manifest.webmanifest", "/logo.png")
PUBLIC_PREFIX = ("/static/", "/logo-", "/dl/", "/dle/")                       # ressources publiques ; /dl/ et /dle/ : jeton aléatoire dans l'URL
TICKET_PREFIX = ("/api/voice/", "/api/tts/", "/api/screen/", "/api/chill/file")   # <img>/<audio> : pas d'en-tête possible -> ticket HMAC court
_cfg_cache = {"t": 0.0, "v": {}}


def _cfg_fast():
    """Configuration relue au plus toutes les 2 s (les middlewares s'exécutent à CHAQUE requête)."""
    now = time.time()
    if now - _cfg_cache["t"] > 2:
        _cfg_cache.update(t=now, v=load_config())
    return _cfg_cache["v"]


async def _send_json(send, status, body, extra=()):
    data = _json_mod.dumps(body).encode()
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(data)).encode()),
                            (b"cache-control", b"no-store"), (b"connection", b"close"),
                            (b"x-nasko-time", str(int(time.time() * 1000)).encode()), *extra]})      # l'heure du PC permet à un appareil désynchronisé de se recaler
    await send({"type": "http.response.body", "body": data})


class SecurityMiddleware:
    """Zero-trust : limiteur de débit (>50 requêtes API/s -> coupure), refus 401 immédiat de toute requête sans clé d'API valide
    (liste blanche de ressources publiques ; tout le reste est refusé par défaut), détection d'URL hostiles (../, %00, System32…)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "websocket":
            return await self._ws(scope, receive, send)
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path, ip = scope["path"], (scope.get("client") or ("?", 0))[0]
        hdr = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        qs = scope.get("query_string", b"").decode("latin-1")
        public = path in PUBLIC_EXACT or path.startswith(PUBLIC_PREFIX)
        authed = sec.check_bearer(hdr.get("authorization", ""))
        if not authed and path.startswith("/ext/") and ip in sec.LOOPBACK and nasko_ext.check(hdr.get("x-enos-ext", "")):
            authed = True                                         # extension Chrome « E.N.O.S. Onglets » : jeton dédié, boucle locale, routes /ext/* uniquement
        if not authed and path.startswith(TICKET_PREFIX):
            authed = sec.check_ticket((parse_qs(qs).get("k") or [""])[0])
        counted = path.startswith("/api/") or path in ("/login", "/login-token")
        if counted:
            if sec.blocked(ip, authed) or (sec.hit(ip, authed) and sec.blocked(ip, authed)):
                sec.STATS["blocked"] += 1
                return await _send_json(send, 429, {"detail": "Trop de requêtes : connexion coupée temporairement."}, [(b"retry-after", b"30")])
        if sec.looks_hostile(path, qs):
            sec.STATS["hostile_paths"] += 1
            sec.event("chemin hostile", ip, path + ("?" + qs if qs else ""), "tentative de traversée de répertoire")
            log.warning("Chemin hostile bloqué depuis %s : %s", ip, path)
            return await _send_json(send, 400, {"detail": "Chemin interdit."})
        if not public and not authed:
            sec.fail(ip, f"{scope['method']} {path} · {hdr.get('user-agent', '?')[:70]}")
            if sec.STATS["unauthorized"] <= 3 or sec.STATS["unauthorized"] % 50 == 0:
                sec.event("401", ip, path, "requête sans clé d'API valide")
            return await _send_json(send, 401, {"detail": "Unauthorized"}, [(b"www-authenticate", b"Bearer")])
        st = scope.setdefault("state", {})
        st["authed"] = authed
        local = ip in sec.LOOPBACK
        uuid = hdr.get("x-eto-device", "").strip()
        if authed and not local and nasko_team.valid_uuid(uuid) and path.startswith("/api/"):
            nasko_team.touch(uuid, ip, hdr.get("user-agent", ""))
        st["device_uuid"] = uuid if nasko_team.valid_uuid(uuid) else ""
        st["edition"] = nasko_team.edition(uuid, local) if authed else "eto"

        async def send2(msg):
            if msg["type"] == "http.response.start" and counted:
                msg = {**msg, "headers": [*msg.get("headers", []), (b"x-nasko-time", str(int(time.time() * 1000)).encode())]}
            await send(msg)
        return await self.app(scope, receive, send2)


async def _ws(self, scope, receive, send):
    """WebSocket : un seul point d'entrée (/ws/chat). Origine identique à l'hôte (anti détournement de navigateur), clé Bearer ou ticket,
    édition « dev » (ce PC ou appareil de confiance), mêmes compteurs d'échecs que HTTP."""
    path, ip = scope["path"], (scope.get("client") or ("?", 0))[0]
    hdr = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
    q = parse_qs(scope.get("query_string", b"").decode("latin-1"))
    why = ""
    if path in ("/ws/chess", "/ws/pet"):                                 # plateau Godot encastré / Œil de bureau : boucle locale + jeton de session, jamais un navigateur
        check = nasko_chessbridge.check_token if path == "/ws/chess" else nasko_pet.check_token
        if ip in sec.LOOPBACK and not hdr.get("origin") and check((q.get("t") or [""])[0]):
            scope.setdefault("state", {})["authed"] = True
            return await self.app(scope, receive, send)
        sec.event("websocket refusé", ip, path, "plateau Godot : jeton ou origine invalide")
        await receive()
        return await send({"type": "websocket.close", "code": 1008})
    if path == "/ws/depot-term":                                         # terminal du Dépôt : ce PC uniquement, même origine, ticket court (le profil est vérifié par RoleGate)
        origin = hdr.get("origin", "")
        if ip in sec.LOOPBACK and (not origin or _hostname(origin.split("://", 1)[-1].split("/")[0]) == _hostname(hdr.get("host", ""))) and sec.check_ticket((q.get("k") or [""])[0]):
            scope.setdefault("state", {})["authed"] = True
            return await self.app(scope, receive, send)
        sec.event("websocket refusé", ip, path, "terminal : ticket, origine ou boucle locale invalide")
        await receive()
        return await send({"type": "websocket.close", "code": 1008})
    if path != "/ws/chat":
        why = "route WebSocket inconnue"
    elif sec.blocked(ip, False):
        why = "trop de tentatives"
    else:
        origin = hdr.get("origin", "")
        if origin and _hostname(origin.split("://", 1)[-1].split("/")[0]) != _hostname(hdr.get("host", "")):
            why = "origine refusée"
        elif nasko_chat.check_channel(hdr.get("x-enos-channel", "")):
            pass                                                         # associé relié par « OUVRIR LE CANAL » : accès limité au chat
        elif not (sec.check_bearer(hdr.get("authorization", "")) or sec.check_ticket((q.get("k") or [""])[0])):
            why = "clé absente ou invalide"
            sec.fail(ip, "WS " + path)
        else:
            uuid = (q.get("d") or [hdr.get("x-eto-device", "")])[0].strip()
            if nasko_team.edition(uuid, ip in sec.LOOPBACK) != "dev":
                why = "appareil non approuvé (Eto)"
    if why:
        sec.event("websocket refusé", ip, path, why)
        await receive()
        return await send({"type": "websocket.close", "code": 1008})
    scope.setdefault("state", {})["authed"] = True
    return await self.app(scope, receive, send)


SecurityMiddleware._ws = _ws


class CryptoMiddleware:
    """AES-256-GCM sur les échanges API des appareils qui possèdent la clé de chiffrement (APK appairée) : en-tête X-Nasko-Enc.
    Corps de requête déchiffré, réponse JSON rechiffrée. Les fichiers (multipart / flux) ont leur propre chiffrement par blocs."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope["path"]
        if scope["type"] != "http" or not path.startswith("/api/") or path.startswith(TICKET_PREFIX):
            return await self.app(scope, receive, send)
        hdr = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        enc = hdr.get("x-nasko-enc", "")
        ip = (scope.get("client") or ("?", 0))[0]
        ctype = hdr.get("content-type", "")
        if not enc:
            if _cfg_fast().get("enc_required_remote") and ip not in sec.LOOPBACK and not ctype.startswith("multipart/"):
                sec.event("clair refusé", ip, path, "chiffrement exigé pour les appareils distants")
                return await _send_json(send, 400, {"detail": "Chiffrement requis : appairez l'appareil avec le jeton complet (SÉCURITÉ)."})
            return await self.app(scope, receive, send)
        qs = scope.get("query_string", b"").decode("latin-1")
        body, more = b"", True
        while more:
            m = await receive()
            if m["type"] == "http.disconnect":
                return
            body += m.get("body", b"")
            more = m.get("more_body", False)
            if len(body) > 16 * 1024 * 1024:
                return await _send_json(send, 413, {"detail": "Charge utile trop volumineuse."})
        try:
            plain = sec.env_open(enc, body, scope["method"], path + ("?" + qs if qs else ""))
        except sec.CryptoError as e:
            sec.STATS["crypto_errors"] += 1
            sec.event("chiffrement", ip, path, str(e))
            return await _send_json(send, 400, {"detail": f"Échange chiffré refusé : {e}"})
        heads = [(k, v) for k, v in scope["headers"] if k.lower() not in (b"content-length", b"content-type")]
        heads.append((b"content-length", str(len(plain)).encode()))
        if plain:
            heads.append((b"content-type", (hdr.get("x-nasko-enc-ct") or "application/json").encode()))
        scope = {**scope, "headers": heads}
        sent = {"done": False}

        async def receive2():
            if sent["done"]:
                return {"type": "http.disconnect"}
            sent["done"] = True
            return {"type": "http.request", "body": plain, "more_body": False}

        state = {"start": None, "chunks": [], "seal": False}

        async def send2(msg):
            if msg["type"] == "http.response.start":
                ct = next((v.decode("latin-1") for k, v in msg.get("headers", []) if k.lower() == b"content-type"), "")
                state["seal"] = ct.startswith("application/json") or ct.startswith("text/")
                if not state["seal"]:
                    return await send(msg)
                state["start"] = msg
                state["ct"] = ct
                return
            if not state["seal"]:
                return await send(msg)
            state["chunks"].append(msg.get("body", b""))
            if msg.get("more_body", False):
                return
            sealed = sec.env_seal(b"".join(state["chunks"]), enc, state["start"]["status"])
            keep = [(k, v) for k, v in state["start"].get("headers", []) if k.lower() not in (b"content-length", b"content-type")]
            keep += [(b"content-type", b"application/octet-stream"), (b"content-length", str(len(sealed)).encode()),
                     (b"x-nasko-enc", b"1"), (b"x-nasko-enc-ct", state["ct"].encode("latin-1"))]
            await send({**state["start"], "headers": keep})
            await send({"type": "http.response.body", "body": sealed})
        return await self.app(scope, receive2, send2)


app.add_middleware(CryptoMiddleware)
app.add_middleware(nasko_roles.RoleGate)            # PROFIL (CEO / Dev / Friends) : s'applique aussi au PC local ; s'exécute après l'authentification
app.add_middleware(SecurityMiddleware)          # dernier ajouté = le plus externe : il s'exécute avant tout le reste


def _safe(path, kind="any", must_exist=True):
    """Chemin fourni par un client : confiné aux dossiers autorisés (jamais System32/AppData…), sinon HTTP 403."""
    try:
        return sec.safe_path(path, kind, must_exist)
    except sec.PathMissing as e:
        raise HTTPException(404, f"Introuvable : {e}")
    except sec.PathDenied as e:
        sec.STATS["path_denied"] += 1
        sec.event("chemin refusé", "local", str(path)[:90], str(e))
        log.warning("Chemin refusé (%s) : %s", e, str(path)[:120])
        raise HTTPException(403, f"Chemin refusé : {e}")


def _require_enc(request: Request, enc):
    """Envois de fichiers : chiffrement obligatoire pour les appareils distants si `enc_required_remote` est activé."""
    if not enc and not is_local(request) and load_config().get("enc_required_remote"):
        raise HTTPException(400, "Chiffrement requis : appairez l'appareil avec le jeton complet (SÉCURITÉ).")


def dev_only(request: Request):
    """Outils premium : ce PC, ou un appareil dont l'UUID figure dans la liste « Appareils de confiance » (édition Eto Dev / E.N.O.S.)."""
    if not is_local(request) and request.scope.get("state", {}).get("edition") != "dev":
        raise HTTPException(403, "Fonction premium : réservée à E.N.O.S. / Eto Dev (appareil non approuvé).")


def local_only(request: Request):
    """Actions sensibles (lancer des programmes, lire les fichiers) : uniquement depuis ce PC."""
    if not is_local(request):
        raise HTTPException(403, "action réservée au PC où tourne E.N.O.S.")


class Login(BaseModel):
    code: str


class TokenBody(BaseModel):
    token: str


def _set_device_cookie(resp, token, request: Request):
    resp.set_cookie(nasko_trust.COOKIE, token, httponly=True, samesite="strict",
                    max_age=nasko_trust.COOKIE_MAX_AGE, secure=request.url.scheme == "https")


def _check_lock(ip):
    if time.time() < FAILS.get(ip, (0, 0))[1]:
        raise HTTPException(429, "Trop d'essais, patientez une minute.")


def _register_failure(ip, what):
    fails = FAILS.get(ip, (0, 0))[0] + 1
    FAILS[ip] = (fails, time.time() + 60 if fails >= 5 else 0)
    log.warning("%s refuse depuis %s (%d)", what, ip, fails)


@app.post("/login")
def login(body: Login, request: Request):
    """Code PIN valide -> l'appareil devient de confiance de façon permanente (jeton renvoyé une seule fois)."""
    ip = _client_ip(request)
    _check_lock(ip)
    expected = (load_config().get("network_access_code") or "").strip().upper()
    if expected and secrets.compare_digest(body.code.strip().upper(), expected):
        FAILS.pop(ip, None)
        token, rec = devices.create(request.headers.get("user-agent", ""), ip)
        resp = JSONResponse({"ok": True, "token": token, "name": rec["name"]})
        _set_device_cookie(resp, token, request)
        return resp
    _register_failure(ip, "Code d'acces")
    raise HTTPException(403, "Code invalide.")


@app.post("/login-token")
def login_token(body: TokenBody, request: Request):
    """Rétablit le cookie à partir du jeton conservé dans le localStorage de l'appli (cookie perdu ou expiré)."""
    ip = _client_ip(request)
    _check_lock(ip)
    if devices.verify(body.token, ip):
        resp = JSONResponse({"ok": True})
        _set_device_cookie(resp, body.token, request)
        return resp
    _register_failure(ip, "Jeton d'appareil")
    raise HTTPException(403, "Appareil non reconnu.")


@app.post("/api/device/backup", dependencies=[Depends(need_token)])
def device_backup(request: Request):
    """Appareil déjà connecté par cookie : remet un nouveau jeton à ranger dans le localStorage (l'ancien est remplacé)."""
    token, dev = request.cookies.get(nasko_trust.COOKIE), request.state.device
    new = devices.rotate(token) if (token and dev and dev.get("via") == "token") else None
    if not new:
        raise HTTPException(400, "Pas d'appareil de confiance à sauvegarder.")
    resp = JSONResponse({"ok": True, "token": new})
    _set_device_cookie(resp, new, request)
    return resp


@app.post("/api/device/forget", dependencies=[Depends(need_token)])
def device_forget(request: Request):
    """« Oublier cet appareil » : révoque le jeton de ce téléphone (il devra ressaisir le code)."""
    dev = request.state.device
    if not dev or dev.get("via") != "token":
        raise HTTPException(400, "Cet appareil n'est pas enregistré par jeton.")
    devices.revoke(dev["id"])
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(nasko_trust.COOKIE)
    return resp


# --- gestion des appareils (PC uniquement)
@app.get("/api/devices", dependencies=[Depends(need_token), Depends(local_only)])
def list_devices():
    cfg = load_config()
    trusted, vpn = cfg.get("trusted_ips") or [], bool(cfg.get("allow_vpn_ranges"))
    return {"devices": [{**d, "ip_trusted": nasko_trust.ip_trusted(d["ip"], trusted, vpn)} for d in devices.listing()],
            "trusted_ips": trusted}


@app.delete("/api/devices/{device_id}", dependencies=[Depends(need_token), Depends(local_only)])
def revoke_device(device_id: str):
    if not devices.revoke(device_id):
        raise HTTPException(404, "appareil inconnu")
    return list_devices()


@app.post("/api/devices/revoke-all", dependencies=[Depends(need_token), Depends(local_only)])
def revoke_all_devices():
    devices.revoke_all()
    return list_devices()


class TrustIP(BaseModel):
    ip: str
    trusted: bool


@app.post("/api/trusted-ips", dependencies=[Depends(need_token), Depends(local_only)])
def set_trusted_ip(body: TrustIP):
    """Ajoute/retire une IP locale de la liste `trusted_ips` (accès sans code ni jeton depuis cette adresse)."""
    ip = body.ip.strip()
    if not nasko_trust.valid_trusted_entry(ip, bool(load_config().get("allow_vpn_ranges"))):
        raise HTTPException(400, "Seules les adresses locales (192.168.x, 10.x, 172.16-31.x) ou VPN autorisées peuvent être de confiance.")
    current = [e for e in (load_config().get("trusted_ips") or []) if e != ip]
    if body.trusted:
        current.append(ip)
    update_config({"trusted_ips": current})
    return list_devices()


# ----------------------------------------------------------------------------- stockage JSON
def _path(name):
    return os.path.join(data_dir(), name)


def _read(name, default):
    try:
        with open(_path(name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _write(name, obj):
    with lock, open(_path(name), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)


def _add_history(role, text, **extra):
    name = nasko_roles.data_name("history.json")
    hist = _read(name, [])
    hist.append({"role": role, "text": text, "t": datetime.now().isoformat(timespec="seconds"), **extra})
    _write(name, hist[-500:])


# ----------------------------------------------------------------------------- pages / statiques
@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    with open(resource_path("static", "index.html"), encoding="utf-8") as f:
        html = f.read()
    # Client LOCAL : aucune clé dans la page (un autre processus qui ferait GET / ne la verrait pas) ; la fenêtre native la reçoit
    # par le pont pywebview. Appareil distant déjà authentifié (cookie/IP de confiance) : la clé d'API est fournie à la page,
    # sauf si `api_key_inject_remote` est désactivé (alors seule l'APK appairée à la main peut parler à l'API).
    key_meta = ""
    if not is_local(request) and request.state.device and load_config().get("api_key_inject_remote", True):
        key_meta = f'<meta name="nasko-key" content="{sec.api_key()}">'
    role = nasko_roles.current()
    html = html.replace("<body>", f'<body class="role-{role or "pending"}" data-role="{role or ""}">', 1)           # profil connu dès le 1er affichage : aucun module restreint n'apparaît
    resp = HTMLResponse(html.replace("__TOKEN__", "").replace("<!--NASKO-KEY-->", key_meta), headers={"Cache-Control": "no-store"})
    token, dev = request.cookies.get(nasko_trust.COOKIE), request.state.device
    if token and dev and dev.get("via") == "token":
        _set_device_cookie(resp, token, request)             # chaque ouverture repousse l'expiration du cookie
    return resp


@app.get("/static/app.js")
def app_js():
    # no-cache : le navigateur revalide à chaque ouverture (sans cet en-tête, WebView2 gardait une ancienne copie et ignorait les mises à jour)
    return FileResponse(resource_path("static", "app.js"), media_type="text/javascript", headers={"Cache-Control": "no-cache"})


AVATAR_IMGS = ("avatar_idle.png", "avatar_listening.png", "avatar_thinking.png", "avatar_speaking.png",
               "enos_eye_idle.png", "enos_eye_thinking.png", "enos_eye_speaking.png")


@app.get("/static/img/{name}")
def static_img(name: str):
    if name not in ("nasko_background.jpg", *AVATAR_IMGS):
        raise HTTPException(404)
    custom = os.path.join(nasko_core.app_dir(), "img", name)          # vos propres créations : posez-les dans <dossier de ENOS.exe>\img\ (aucune recompilation)
    path = custom if os.path.isfile(custom) else resource_path("static", "img", name)
    return FileResponse(path, media_type="image/png" if name.endswith(".png") else "image/jpeg",
                        headers={"Cache-Control": "no-cache" if path == custom else "public, max-age=86400"})


@app.get("/nasko-ca.crt")
def ca_certificate():
    """Certificat de l'autorite locale (public) : à installer une fois sur le téléphone."""
    if not state["network"]:
        raise HTTPException(404)
    return Response(nasko_cert.ca_der(os.path.join(data_dir(), "certs"), bool(load_config().get("allow_vpn_ranges"))), media_type="application/x-x509-ca-cert",
                    headers={"Content-Disposition": 'attachment; filename="nasko-ca.crt"'})


@app.get("/nasko.apk")
def android_app():
    """Application Android (ENOS.apk, fabriquee par construire_apk.py) : publique, elle ne contient aucun secret."""
    path = find_asset("ENOS.apk") or find_asset("NASKO.apk")                  # NASKO.apk : ancien nom, encore accepté
    if not state["network"] or not path:
        raise HTTPException(404)
    return FileResponse(path, media_type="application/vnd.android.package-archive", filename="ENOS.apk",
                        headers={"Cache-Control": "no-cache"})


@app.get("/api/app/version")
def android_version():
    """Version de ENOS.apk (versionCode, versionName, sha256) : l'application Android s'en sert pour se mettre à jour."""
    path = find_asset("ENOS.apk.json") or find_asset("NASKO.apk.json")
    if not path:
        raise HTTPException(404)
    with open(path, encoding="utf-8") as f:
        return JSONResponse(json.load(f), headers={"Cache-Control": "no-cache"})


@app.get("/manifest.webmanifest")
def manifest():
    return JSONResponse({
        "name": "E.N.O.S. AI", "short_name": "E.N.O.S.", "description": "Assistant E.N.O.S.",
        "start_url": "/", "scope": "/", "display": "standalone", "orientation": "portrait",
        "background_color": "#000000", "theme_color": "#000000", "lang": "fr",
        "icons": [{"src": "/logo-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
                  {"src": "/logo-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"}],
    }, media_type="application/manifest+json")


@app.get("/logo-{size}.png")
def logo_sized(size: str):
    p = find_asset(f"logo-{size}.png") if size in ("192", "512") else None
    if not p:
        raise HTTPException(404)
    return FileResponse(p, headers={"Cache-Control": "public, max-age=86400"})


@app.get("/logo.png")
def logo():
    p = find_logo("png")
    if not p:
        raise HTTPException(404)
    return FileResponse(p)


@app.get("/api/voice/{vid}")
def static_voice(vid: str):
    entry = nasko_voice.BY_ID.get(vid)          # identifiant de la table uniquement (jamais un chemin libre)
    path = nasko_voice._find_file(entry) if entry else None
    if not path:
        raise HTTPException(404)
    return FileResponse(nasko_voice.deepen(path), media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=3600"})


@app.get("/api/tts/{digest}")
def tts_cached(digest: str):
    if not digest.isalnum():
        raise HTTPException(404)
    p = os.path.join(data_dir(), "tts_cache", digest + ".mp3")
    if not os.path.isfile(p):
        p = nasko_cache.audio_path(digest) or p                         # audio mémorisé des commentaires d'ETO (data/audio_cache)
    if not os.path.isfile(p):
        raise HTTPException(404)
    return FileResponse(p if digest.startswith("eto") else nasko_voice.deepen(p), media_type="audio/mpeg")   # la voix d'ETO reste naturelle : pas de pitch grave


# ----------------------------------------------------------------------------- API
_welcome = {"done": False}


def _eto_welcome(cfg):
    """Accueil d'ETO : texte propre + voix d'ETO (ElevenLabs v3, sa clé) ; chaque phrase n'est synthétisée qu'une fois (cache audio). Jamais la voix d'E.N.O.S."""
    spoken = _welcome.get("spoken") or nasko_persona.welcome_text(cfg)
    if not spoken:
        return None
    _welcome["spoken"] = spoken                                 # même phrase pour la voix et pour l'en-tête
    audio = None
    if cfg.get("tts_dynamic", True) and nasko_eleven.configured(cfg, "eto"):
        try:
            audio = "/api/tts/" + os.path.splitext(os.path.basename(nasko_eleven.synthesize(spoken, cfg, "eto")))[0]
        except nasko_eleven.ElevenError as e:
            log.warning("Accueil ETO : %s", e)
    return {"text": nasko_persona.clean(spoken), "audio": audio, "tags": nasko_persona.tags(spoken), "persona": "eto"}


@app.get("/api/status", dependencies=[Depends(need_token)])
def status(request: Request):
    cfg = load_config()
    welcome = None
    if is_local(request) and not _welcome["done"]:          # une seule fois par lancement, sur ce PC, quand l'interface est prête
        _welcome["done"] = True
        try:
            welcome = _eto_welcome(cfg) if nasko_persona.current(cfg) == "eto" else nasko_voice.welcome(cfg)
        except Exception as e:                              # noqa: BLE001 — jamais bloquer le démarrage pour une phrase
            log.warning("Phrase d'accueil indisponible : %s", e)
    greeting = (nasko_core.GREETINGS_EN if nasko_core.language(cfg) == "en" else GREETINGS)[int(time.time()) % len(GREETINGS)]
    if nasko_persona.current(cfg) == "eto":                 # en-tête : salut d'ETO, pas le jargon de console d'E.N.O.S.
        _welcome.setdefault("spoken", nasko_persona.welcome_text(cfg))
        greeting = nasko_persona.clean(_welcome.get("spoken") or "") or greeting
    return {"welcome": welcome,
        "greeting": greeting,
        "local": is_local(request),
        "device": ({"name": request.state.device["name"], "via": request.state.device["via"]}
                   if request.state.device else None),
        "mic": nasko_stt.default_input_name() if is_local(request) else None,
        "eleven": nasko_eleven.configured(cfg),
        "persona": nasko_persona.current(cfg),
        "eto_voice": nasko_eleven.configured(cfg, "eto"),
        "llm": nasko_llm.configured(cfg),
        "voice_stats": read_stats(),
        "logo": find_logo("png") is not None,
        "default_project": cfg["project_dir"],
        "edition": "dev" if is_local(request) else request.scope.get("state", {}).get("edition", "eto"),
        "user": ({"id": cfg.get("profile_id", "nassime"), "label": cfg.get("user_label", "Nassime")}
                 if is_local(request) or request.scope.get("state", {}).get("edition") == "dev" else {"id": "", "label": ""}),
    }


class Chat(BaseModel):
    text: str


@app.post("/api/chat", dependencies=[Depends(need_token)])
def chat(body: Chat, request: Request):
    """Pipeline : texte -> LLM -> [actions locales] -> ElevenLabs -> reponse complete (texte + audio)."""
    text = body.text.strip()[:2000]
    if not text:
        raise HTTPException(400, "message vide")
    cfg = load_config()
    persona = nasko_persona.current(cfg)
    try:
        raw = nasko_llm.generate(cfg, _read("history.json", []), text, persona)
    except nasko_llm.LLMError as e:
        log.warning("LLM : %s", e)
        return {"error": str(e)}
    if persona == "eto":
        return _chat_eto(cfg, text, raw, request)
    # Les balises [ACTION: ...] sont executees (liste blanche) puis retirees : ni affichees, ni prononcees.
    reply, tags = nasko_actions.extract(raw)
    actions = nasko_actions.execute(tags, cfg) if tags else []
    if not reply:
        reply = ("Done." if actions else "Got it.") if nasko_core.language(cfg) == "en" else ("C'est fait." if actions else "Reçu.")
    audio, notice = None, None
    reply, reflex = nasko_voice.extract_reflex(reply)      # [REFLEX: TYPE] : le LLM désigne un type, le serveur choisit la phrase
    if not reply and not reflex:                           # balise inconnue seule : jamais de texte vide vers la synthèse
        reply = ("Done." if actions else "Got it.") if nasko_core.language(cfg) == "en" else ("C'est fait." if actions else "Reçu.")
    if not reflex and not tags:
        reflex = nasko_voice.match(reply)                  # sinon : réponse libre qui reprend quand même une phrase connue
    if reflex:
        # phrase réflexe : texte canonique + voix locale, sans appel ElevenLabs si le fichier existe
        reply = nasko_voice.text_of(reflex)
        try:
            if nasko_voice.audio_path(reflex, cfg):
                audio = "/api/voice/" + reflex["id"]
                log.info("Voix statique « %s » (%d caractères économisés)", reflex["id"], len(reply))
        except nasko_eleven.ElevenError as e:
            notice = str(e)
            log.warning("TTS (génération unique) : %s", e)
    elif cfg.get("tts_dynamic", True):
        if nasko_eleven.configured(cfg):
            try:
                p = nasko_eleven.synthesize(reply, cfg)
                audio = "/api/tts/" + os.path.splitext(os.path.basename(p))[0]
            except nasko_eleven.ElevenError as e:
                notice = str(e)
                log.warning("TTS : %s", e)
        else:
            notice = "ElevenLabs non configuré : réponse en texte seul (voir GUIDE.md)."
    _add_history("user", text)
    _add_history("nasko", reply)
    nasko_memory.log_interaction(request.client.host if request.client else None, text, reply, actions)
    return {"text": reply, "audio": audio, "notice": notice, "actions": actions}


def _chat_eto(cfg, text, raw, request):
    """Réponse d'ETO : le texte affiché est nettoyé des Audio Tags, la synthèse (eleven_v3, voix d'ETO) les reçoit."""
    reply, tags = nasko_actions.extract(raw)
    actions = nasko_actions.execute(tags, cfg) if tags else []
    spoken = nasko_persona.ensure_tags(reply or ("[exhales] C'est fait." if actions else "[hmm] Reçu."))
    shown = nasko_persona.clean(spoken)
    audio, notice = None, None
    if cfg.get("tts_dynamic", True):
        if nasko_eleven.configured(cfg, "eto"):
            try:
                p = nasko_eleven.synthesize(spoken, cfg, "eto")
                audio = "/api/tts/" + os.path.splitext(os.path.basename(p))[0]
            except nasko_eleven.ElevenError as e:
                notice = str(e)
                log.warning("TTS ETO : %s", e)
        else:
            notice = "Voix d'ETO non configurée (elevenlabs_eto_api_key) : réponse en texte seul."
    _add_history("user", text)
    _add_history("nasko", shown)
    nasko_memory.log_interaction(request.client.host if request.client else None, text, shown, actions)
    return {"text": shown, "audio": audio, "notice": notice, "actions": actions, "persona": "eto", "tags": nasko_persona.tags(spoken)}


@app.get("/api/history", dependencies=[Depends(need_token)])
def history():
    return _read(nasko_roles.data_name("history.json"), [])


@app.delete("/api/history", dependencies=[Depends(need_token)])
def clear_history():
    _write(nasko_roles.data_name("history.json"), [])
    return {"ok": True}


# --- projets : liste (historique) + projet actif memorise dans nasko_config.json (project_dir)
class Project(BaseModel):
    path: str
    create: bool = False


def _norm(p):
    return os.path.normcase(os.path.abspath(p.strip().strip('"')))


def _projects():
    return _read("projects.json", [])


def _active():
    return (load_config().get("project_dir") or "").strip()


def _listing():
    """Historique + marqueurs active/missing ; le projet actif de la config y figure toujours."""
    lst = _projects()
    act = _active()
    if act and not any(_norm(x["path"]) == _norm(act) for x in lst):
        lst.insert(0, {"name": os.path.basename(act.rstrip("\\/")) or act, "path": act,
                       "last": datetime.now().isoformat(timespec="seconds")})
        if os.path.isdir(act):          # un projet actif introuvable est affiché (⚠) mais pas mémorisé dans l'historique
            _write("projects.json", lst[:30])
    return [{**x, "active": bool(act) and _norm(x["path"]) == _norm(act), "missing": not os.path.isdir(x["path"])}
            for x in lst]


@app.get("/api/projects", dependencies=[Depends(need_token), Depends(local_only)])
def projects():
    return _listing()


@app.post("/api/projects", dependencies=[Depends(need_token), Depends(local_only)])
def add_project(p: Project):
    """Ajoute un projet et le rend actif (memorise). Dossier absent : 404, ou creation si create=true."""
    path = _safe(p.path, "dir", must_exist=False)                       # jamais System32/AppData ; hors racines : passer par le sélecteur natif
    if not os.path.isdir(path):
        if not p.create:
            raise HTTPException(404, f"Dossier introuvable : {path}")
        try:
            os.makedirs(path, exist_ok=True)
        except OSError as e:
            raise HTTPException(400, f"Création impossible : {e.strerror or e}")
        log.info("Dossier de projet cree : %s", path)
    lst = [x for x in _projects() if _norm(x["path"]) != _norm(path)]
    lst.insert(0, {"name": os.path.basename(path.rstrip("\\/")) or path, "path": path,
                   "last": datetime.now().isoformat(timespec="seconds")})
    _write("projects.json", lst[:30])
    update_config({"project_dir": path})
    return _listing()


@app.post("/api/projects/select", dependencies=[Depends(need_token), Depends(local_only)])
def select_project(p: Project):
    path = _known_project(p.path)
    update_config({"project_dir": path})
    return _listing()


@app.post("/api/projects/browse", dependencies=[Depends(need_token), Depends(local_only)])
def browse_project():
    """Selecteur de dossier natif Windows (via la fenetre pywebview)."""
    win = state.get("window")
    if win is None:
        return {"path": None, "error": "Le sélecteur de dossier n'est disponible que dans la fenêtre E.N.O.S."}
    import webview
    kind = getattr(getattr(webview, "FileDialog", None), "FOLDER", None) or webview.FOLDER_DIALOG
    start = _active() if os.path.isdir(_active()) else os.path.expanduser("~")
    res = win.create_file_dialog(kind, directory=start)
    if res:
        sec.grant(res[0])                                          # choix fait dans la boîte de dialogue native de Windows : autorisé
    return {"path": res[0] if res else None}


@app.delete("/api/projects", dependencies=[Depends(need_token), Depends(local_only)])
def del_project(path: str):
    lst = [x for x in _projects() if _norm(x["path"]) != _norm(path)]
    _write("projects.json", lst)
    if _active() and _norm(_active()) == _norm(path):      # le projet actif est retire : on bascule sur un autre
        nxt = next((x["path"] for x in lst if os.path.isdir(x["path"])), "")
        update_config({"project_dir": nxt})
    return _listing()


def _known_project(path):
    for x in _projects():
        if _norm(x["path"]) == _norm(path):
            return x["path"]
    if _active() and _norm(path) == _norm(_active()):
        return _active()
    raise HTTPException(403, "projet inconnu")


@app.get("/api/files", dependencies=[Depends(need_token), Depends(local_only)])
def files(project: str, rel: str = ""):
    """Liste un dossier d'un projet enregistre (jamais en dehors de celui-ci)."""
    root = os.path.realpath(_known_project(project))
    target = os.path.realpath(os.path.join(root, rel))
    if not sec._inside(os.path.normcase(target), os.path.normcase(root)) or not os.path.isdir(target):
        sec.STATS["path_denied"] += 1
        raise HTTPException(400, "chemin invalide")
    out = []
    for name in sorted(os.listdir(target), key=lambda n: (not os.path.isdir(os.path.join(target, n)), n.lower())):
        full = os.path.join(target, name)
        is_dir = os.path.isdir(full)
        out.append({"name": name, "dir": is_dir, "size": None if is_dir else os.path.getsize(full)})
    rel_out = "" if target == root else os.path.relpath(target, root).replace("\\", "/")
    return {"rel": rel_out, "entries": out}


@app.get("/api/file", dependencies=[Depends(need_token), Depends(local_only)])
def file_preview(project: str, rel: str):
    root = os.path.realpath(_known_project(project))
    target = os.path.realpath(os.path.join(root, rel))
    if not sec._inside(os.path.normcase(target), os.path.normcase(root)) or not os.path.isfile(target):
        sec.STATS["path_denied"] += 1
        raise HTTPException(400, "chemin invalide")
    if os.path.getsize(target) > 200_000:
        return {"text": "[fichier trop volumineux pour l'aperçu]"}
    with open(target, "rb") as f:
        raw = f.read()
    if b"\0" in raw:
        return {"text": "[fichier binaire]"}
    return {"text": raw.decode("utf-8", errors="replace")}


# --- taches
class Launch(BaseModel):
    path: str | None = None


@app.post("/api/tasks/env/start", dependencies=[Depends(need_token), Depends(local_only)])
def env_start(body: Launch):
    """Plan commenté de l'environnement (rien n'est lancé) : phrases locales + étapes à enchaîner par l'interface."""
    cfg = load_config()
    path = _known_project(body.path) if body.path else None
    plan = nasko_tasks.plan_environnement(cfg, path)
    if not plan["ok"]:
        return {**plan, "say": nasko_voice.ref("nar_nodir", cfg)}
    done = _norm(plan["path"])
    _write("projects.json", [{**x, "last": datetime.now().isoformat(timespec="seconds")} if _norm(x["path"]) == done else x
                             for x in _projects()])
    return {"ok": True, "path": plan["path"], "intro": nasko_voice.ref("nar_env_intro", cfg),
            "done": nasko_voice.ref("nar_env_done", cfg),
            "steps": [{"id": s["id"], "ready": s["ready"],
                       "already": s["open"],
                       "say": nasko_voice.ref(f"nar_env_deja_{s['id']}" if s["open"] else f"nar_env_{s['id']}", cfg) if s["ready"] else None,
                       "fail": nasko_voice.ref(f"nar_fail_{s['id']}", cfg)} for s in plan["steps"]]}


class Step(BaseModel):
    id: str
    path: str | None = None


# --- SESSION DE TRAVAIL (sous-menu « ENVIRONNEMENT ») : outils au choix, lancement échelonné, écran de destination
class EnvLaunch(BaseModel):
    tools: list[str]
    screen: int | None = None
    path: str | None = None


@app.get("/api/env/info", dependencies=[Depends(need_token), Depends(local_only)])
def env_info(path: str | None = None):
    """Données du sous-menu (rien n'est lancé) : outils, écrans détectés, phrases locales pour la narration."""
    cfg = load_config()
    res = nasko_env.info(cfg, _known_project(path) if path else None)
    if not res["ok"]:
        return {**res, "say": nasko_voice.ref("nar_nodir", cfg)}
    done = _norm(res["path"])
    _write("projects.json", [{**x, "last": datetime.now().isoformat(timespec="seconds")} if _norm(x["path"]) == done else x
                             for x in _projects()])
    voice = {"intro": nasko_voice.ref("nar_env_intro", cfg), "done": nasko_voice.ref("nar_env_done", cfg)}
    for t in res["tools"]:
        if t["id"] in ("claude", "godot", "aseprite"):
            voice[t["id"]] = {"say": nasko_voice.ref(f"nar_env_deja_{t['id']}" if t["open"] else f"nar_env_{t['id']}", cfg),
                              "fail": nasko_voice.ref(f"nar_fail_{t['id']}", cfg)}
    return {**res, "voice": voice}


@app.post("/api/env/launch", dependencies=[Depends(need_token), Depends(local_only)])
def env_launch(body: EnvLaunch):
    cfg = load_config()
    res = nasko_env.start(cfg, body.tools, body.screen, _known_project(body.path) if body.path else None)
    if not res["ok"] and res.get("code") == "busy":
        raise HTTPException(409, res["message"])
    return res


@app.get("/api/env/status", dependencies=[Depends(need_token), Depends(local_only)])
def env_status():
    return nasko_env.status()


@app.post("/api/tasks/env/step", dependencies=[Depends(need_token), Depends(local_only)])
def env_step(body: Step):
    """Lance UN outil (claude | godot | aseprite) ; appelé par l'interface au moment où la phrase correspondante démarre."""
    path = _known_project(body.path) if body.path else None
    return nasko_tasks.lancer_outil(load_config(), body.id, path)


def _who(request: Request):
    return request.state.device["name"] if getattr(request.state, "device", None) else "PC"


@app.get("/api/godot/scenes", dependencies=[Depends(need_token)])
def godot_scenes(request: Request, project: str | None = None):
    """Liste dynamique des scènes .tscn du projet actif. Un appareil distant utilise toujours le projet actif du PC."""
    path = _known_project(project) if (project and is_local(request)) else None
    return nasko_tasks.lister_scenes(load_config(), path)


class SceneRun(BaseModel):
    rel: str
    project: str | None = None


@app.post("/api/godot/run", dependencies=[Depends(need_token)])
def godot_run(body: SceneRun, request: Request):
    """Lance une scène avec Godot en ligne de commande (sans éditeur) : équivalent de F6. Ouvert aux appareils de confiance."""
    path = _known_project(body.project) if (body.project and is_local(request)) else None
    return nasko_tasks.lancer_scene(load_config(), body.rel, path, by=_who(request))


@app.post("/api/godot/stop", dependencies=[Depends(need_token)])
def godot_stop():
    """Ferme la scène lancée par E.N.O.S. (utile à distance : on ne peut pas fermer sa fenêtre soi-même)."""
    return {"ok": True, "stopped": nasko_tasks.stop_scenes()}


@app.get("/api/narration/godot", dependencies=[Depends(need_token)])
def narration_godot():
    cfg = load_config()
    return {"run": nasko_voice.ref("nar_godot_scene", cfg), "fail": nasko_voice.ref("nar_godot_fail", cfg),
            "notfound": nasko_voice.ref("nar_fail_godot", cfg)}


@app.get("/api/f6/state", dependencies=[Depends(need_token)])
def f6_state(request: Request):
    """État du panel F6 : projet, scènes en cours, visu, spectateurs. Appelé en boucle par le panel."""
    cfg, local = load_config(), is_local(request)
    path, err = nasko_tasks.check_project(cfg)
    viewers = [{"name": v["name"], "ip": v["ip"], "since": v["since"], "preset": v["preset"]} for v in VIEWERS.values()]
    return {"ok": err is None, "code": (err or {}).get("code"), "message": (err or {}).get("message"),
            "project": os.path.basename(path.rstrip("\\/")) if path else "",
            "godot": nasko_tasks.tool_exe(cfg, "godot") is not None, "running": nasko_tasks.running_scenes(),
            "screen": {"mode": cfg.get("screen_share", "window"), "available": nasko_screen.AVAILABLE, "signal": SCREEN["reason"]},
            "viewers": viewers if local else len(viewers), "local": local, "keep_awake": nasko_power.keep.active,
            "host": socket.gethostname(), "now": time.time()}


# --- visu à distance (flux MJPEG de la fenêtre de la scène) ; le jeton passe par l'URL car <img> n'envoie pas d'en-tête
def _check_k(k: str):
    """Authentification par ticket (?k=) : déjà vérifiée par SecurityMiddleware, conservée pour les appels existants."""
    return None


@app.get("/api/screen/frame")
def screen_frame(k: str = "", q: str = "normal"):
    """Une seule image JPEG (diagnostic / vignette). 204 si rien à montrer."""
    _check_k(k)
    mode = load_config().get("screen_share", "window")
    data, reason = nasko_screen.frame(mode, nasko_tasks.running_pids(), q)
    SCREEN["reason"] = reason
    if data is None:
        return Response(status_code=204, headers={"X-Nasko-Reason": reason})
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/api/screen/stream")
async def screen_stream(request: Request, k: str = "", q: str = "normal"):
    _check_k(k)
    cfg = load_config()
    if cfg.get("screen_share", "window") == "off":
        raise HTTPException(403, "Le partage d'écran est désactivé sur le PC.")
    if len(VIEWERS) >= MAX_VIEWERS:
        raise HTTPException(429, "Trop de spectateurs simultanés.")
    preset = q if q in nasko_screen.PRESETS else "normal"
    vid = secrets.token_hex(4)
    VIEWERS[vid] = {"id": vid, "name": _who(request), "ip": _client_ip(request), "since": time.time(), "preset": preset}
    log.info("Visu ouverte par %s (%s)", VIEWERS[vid]["name"], preset)

    async def gen():
        last, last_t, mode, mode_t = None, 0.0, cfg.get("screen_share", "window"), time.time()
        fps = nasko_screen.PRESETS[preset][2]
        try:
            while not await request.is_disconnected():
                t0 = time.time()
                if t0 - mode_t > 1.0:                                    # le PC peut couper/changer le partage en cours de route
                    mode, mode_t = load_config().get("screen_share", "window"), t0
                if mode == "off":
                    break
                data, reason = await run_in_threadpool(nasko_screen.frame, mode, nasko_tasks.running_pids(), preset)
                SCREEN["reason"] = reason
                if data is None:
                    data = nasko_screen.black_frame()
                if data != last or t0 - last_t > 1.0:                    # image identique : on n'envoie qu'un battement par seconde
                    last, last_t = data, t0
                    yield b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n" % len(data) + data + b"\r\n"
                await asyncio.sleep(max(0.01, (1.0 if reason else 1.0 / fps) - (time.time() - t0)))
        finally:
            VIEWERS.pop(vid, None)
            log.info("Visu fermee")

    return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=frame",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


class ScreenMode(BaseModel):
    mode: str


@app.post("/api/screen/mode", dependencies=[Depends(need_token), Depends(local_only)])
def screen_mode(body: ScreenMode):
    """Réglage du partage d'écran (PC uniquement) : window | full | off."""
    if body.mode not in ("window", "full", "off"):
        raise HTTPException(400, "mode inconnu")
    update_config({"screen_share": body.mode})
    log.info("Partage d'ecran : %s", body.mode)
    return {"ok": True, "mode": body.mode}


class Toggle2(BaseModel):
    enabled: bool


@app.post("/api/power/keep-awake", dependencies=[Depends(need_token), Depends(local_only)])
def power_keep_awake(body: Toggle2):
    update_config({"keep_awake": body.enabled})
    nasko_power.keep.apply(body.enabled)
    time.sleep(0.2)
    return {"ok": True, "enabled": body.enabled, "active": nasko_power.keep.active}


# --- arret / veille du PC : jeton + (a distance) code d'acces re-saisi + compte a rebours annulable + journal
POWER_FAILS = {}            # appareil/ip -> (echecs, verrouille_jusqu_a)


class PowerReq(BaseModel):
    action: str
    pin: str = ""


def _power_actor(request: Request):
    return _who(request) if not is_local(request) else "PC"


@app.get("/api/power/state", dependencies=[Depends(need_token)])
def power_state(request: Request):
    cfg = load_config()
    local = is_local(request)
    return {**nasko_power.plan.status(), "delay": int(cfg.get("power_delay", 20) or 20), "local": local,
            "allowed": local or bool(cfg.get("remote_power", True)), "needs_pin": not local}


@app.post("/api/power/request", dependencies=[Depends(need_token)])
def power_request(body: PowerReq, request: Request):
    cfg = load_config()
    local, who = is_local(request), _power_actor(request)
    if body.action not in nasko_power.ACTIONS:
        raise HTTPException(400, "action inconnue")
    if not local:
        if not cfg.get("remote_power", True):
            raise HTTPException(403, "arrêt à distance désactivé (remote_power)")
        key = who + "|" + _client_ip(request)
        fails, until = POWER_FAILS.get(key, (0, 0))
        if time.time() < until:
            raise HTTPException(429, "trop d'essais : patientez 5 minutes")
        expected = (cfg.get("network_access_code") or "").strip().upper()
        if not expected or not secrets.compare_digest(body.pin.strip().upper(), expected):
            fails += 1
            POWER_FAILS[key] = (fails, time.time() + 300 if fails >= 3 else 0)
            log.warning("Arrêt/veille refusé (code faux) depuis %s", key)
            raise HTTPException(403, "code d'accès incorrect")
        POWER_FAILS.pop(key, None)
    try:
        info = nasko_power.plan.request(body.action, int(cfg.get("power_delay", 20) or 20), who, before=nasko_tasks.stop_scenes)
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    return {"ok": True, **info, "label": nasko_power.ACTIONS[body.action], "now": time.time()}


@app.post("/api/power/cancel", dependencies=[Depends(need_token)])
def power_cancel(request: Request):
    return {"ok": True, "cancelled": nasko_power.plan.cancel(_power_actor(request))}


@app.get("/api/ping")
def ping():
    """Permet a un 2e lancement de reconnaitre une instance deja active (aucune donnee sensible)."""
    return {"app": "nasko"}


_VENDOR = {"codemirror.bundle.js": "codemirror.bundle.js", "wavesurfer.min.js": "wavesurfer.min.js", "wavesurfer.regions.min.js": "wavesurfer.regions.min.js"}
_STATIC_FILES = {"subs.js": "text/javascript", "subs.css": "text/css", "roles.js": "text/javascript", "cloud.js": "text/javascript", "gaming.js": "text/javascript", "depot.js": "text/javascript", "depot.css": "text/css", "updatebar.js": "text/javascript", "updatebar.css": "text/css", "roles.css": "text/css", "accent.css": "text/css", "tour.js": "text/javascript", "tour.css": "text/css", "deeplink.js": "text/javascript", "pair.js": "text/javascript", "pair.css": "text/css", "onboarding.js": "text/javascript", "onboarding.css": "text/css", "home.js": "text/javascript", "home.css": "text/css", "agenda.js": "text/javascript", "agenda.css": "text/css", "study.js": "text/javascript", "learn_launch.js": "text/javascript", "study.css": "text/css", "cm_base.css": "text/css", "theme.js": "text/javascript", "team.js": "text/javascript", "team.css": "text/css", "themes.css": "text/css", "theme_coreboard.css": "text/css", "sysdash.js": "text/javascript", "sysdash.css": "text/css", "sysdiag.js": "text/javascript", "motion.js": "text/javascript", "motion.css": "text/css", "sec.js": "text/javascript", "security.js": "text/javascript", "security.css": "text/css", "f6.js": "text/javascript", "f6.css": "text/css", "power.js": "text/javascript",
                 "imgproc.js": "text/javascript", "imgproc.css": "text/css", "anim.js": "text/javascript", "anim.css": "text/css",
                 "sync.js": "text/javascript", "sync.css": "text/css", "chill.js": "text/javascript", "chill.css": "text/css",
                 "tabs.js": "text/javascript", "tabs.css": "text/css", "env.js": "text/javascript", "env.css": "text/css", "audio.js": "text/javascript", "audio.css": "text/css", "compress.js": "text/javascript", "compress.css": "text/css", "pdfed.js": "text/javascript", "pdfed.css": "text/css", "studio.js": "text/javascript", "studio.css": "text/css", "syllabus.js": "text/javascript", "syllabus.css": "text/css", "quick.js": "text/javascript", "background.js": "text/javascript", "background.css": "text/css", "quick.css": "text/css", "quicklib.js": "text/javascript", "talk.js": "text/javascript", "talk.css": "text/css", "colis.js": "text/javascript", "colis.css": "text/css", "search.js": "text/javascript", "search.css": "text/css",
                 "youtube.js": "text/javascript", "youtube.css": "text/css", "cleaner.js": "text/javascript", "cleaner.css": "text/css", "organizer.js": "text/javascript", "organizer.css": "text/css",
                 "notify.js": "text/javascript", "pet.js": "text/javascript", "devmanager.js": "text/javascript", "devmanager.css": "text/css", "mobile.js": "text/javascript", "mobile.css": "text/css", "defi.js": "text/javascript", "defi.css": "text/css", "train.js": "text/javascript", "train.css": "text/css",
                 "persona.js": "text/javascript", "stockfish.png": "image/png", "apimon.js": "text/javascript", "apimon.css": "text/css", "eto8_atlas.png": "image/png", "eto8_index.json": "application/json", "persona.css": "text/css", "eto_face.js": "text/javascript", "eto_expressions.json": "application/json"}


# --- TRAITEMENT D'IMAGE : PhotoRoom + Sprite Slicer (automatisation web), colis, livraison
class ImgCat(BaseModel):
    cat: str


class ImgPick(BaseModel):
    cat: str
    task: str
    names: list[str]


class ImgTask(BaseModel):
    task: str


class ColisRename(BaseModel):
    name: str
    new_name: str


class ImgDeliver(BaseModel):
    colis: str
    dest: str


def _imgcat(cat):
    if cat not in nasko_imagefactory.CATS:
        raise HTTPException(400, "catégorie inconnue")
    return cat


_IMG = [Depends(need_token), Depends(dev_only)]          # premium : PC ou appareil de confiance (Eto Dev)
_LOCAL = [Depends(need_token), Depends(local_only)]      # strictement ce PC
_REMOTE = [Depends(need_token)]          # routes utilisables depuis un appareil de confiance (téléphone), pas seulement depuis le PC


@app.get("/api/imgproc/state", dependencies=_IMG)
def imgproc_state():
    return nasko_imagefactory.state()


@app.get("/api/imgproc/tasks", dependencies=_IMG)
def imgproc_tasks(cat: str):
    return {"items": nasko_imagefactory.tasks(_imgcat(cat))}


@app.get("/api/imgproc/files", dependencies=_IMG)
def imgproc_files(cat: str, task: str):
    try:
        return {"items": nasko_imagefactory.files(_imgcat(cat), task)}
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(404, str(e))


@app.post("/api/imgproc/clean", dependencies=_IMG)
def imgproc_clean(b: ImgCat):
    return {"removed": nasko_imagefactory.clean(_imgcat(b.cat))}


@app.post("/api/imgproc/open", dependencies=_LOCAL)
def imgproc_open(b: ImgCat):
    nasko_imagefactory.open_folder(b.cat, "todo")
    return {"ok": True}


@app.get("/api/imgproc/downloads", dependencies=_LOCAL)
def imgproc_downloads():
    return nasko_imagefactory.list_downloads()


class ImgImport(BaseModel):
    cat: str
    names: list[str]


@app.post("/api/imgproc/import", dependencies=_LOCAL)
def imgproc_import(b: ImgImport):
    try:
        return {"ok": True, "count": nasko_imagefactory.import_downloads(_imgcat(b.cat), b.names)}
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))


@app.post("/api/imgproc/open-downloads", dependencies=_LOCAL)
def imgproc_open_downloads():
    try:
        nasko_imagefactory.open_downloads()
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    return {"ok": True}


@app.post("/api/imgproc/retry", dependencies=_IMG)
def imgproc_retry():
    nasko_imagefactory.retry()
    return {"ok": True}


@app.post("/api/imgproc/zip", dependencies=_IMG)
def imgproc_zip(b: ImgPick):
    try:
        return nasko_imagefactory.make_colis(_imgcat(b.cat), b.task, b.names)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(400, str(e))


class ImgPickTasks(BaseModel):
    cat: str
    tasks: list[str]


@app.post("/api/imgproc/zip-tasks", dependencies=_IMG)
def imgproc_zip_tasks(b: ImgPickTasks):
    try:
        return nasko_imagefactory.make_colis_tasks(_imgcat(b.cat), b.tasks)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(400, str(e))


class ImgFolderImport(BaseModel):
    cat: str
    path: str


class ImgBatch(BaseModel):
    id: str
    folder: str | None = None          # None = « Non » ; sinon nom du Dossier Principal à créer


class ImgFolderSub(BaseModel):
    folder: str
    sub: str


class ImgFolderMove(BaseModel):
    folder: str
    files: list[dict]
    to: str = ""


class ImgFolderExport(BaseModel):
    folder: str
    dest: str = ""


def _img_call(fn, *a):
    """Erreurs métier de la gestion de dossiers -> codes HTTP lisibles par l'interface."""
    try:
        return fn(*a)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except (FileExistsError, RuntimeError) as e:
        raise HTTPException(409, str(e))
    except (ValueError, OSError, zipfile.BadZipFile) as e:
        raise HTTPException(400, str(e))


@app.post("/api/imgproc/import-folder", dependencies=_LOCAL)
def imgproc_import_folder(b: ImgFolderImport):
    return {"ok": True, **_img_call(nasko_imagefactory.import_folder, _imgcat(b.cat), _safe(b.path, "dir"))}


@app.post("/api/imgproc/batch", dependencies=_IMG)
def imgproc_batch(b: ImgBatch):
    return _img_call(nasko_imagefactory.batch_resolve, b.id, b.folder)


@app.get("/api/imgproc/folders", dependencies=_IMG)
def imgproc_folders():
    return {"items": nasko_imagefactory.folders()}


@app.get("/api/imgproc/folder", dependencies=_IMG)
def imgproc_folder(name: str, sub: str = ""):
    return {**_img_call(nasko_imagefactory.folder_tree, name), "items": _img_call(nasko_imagefactory.folder_files, name, sub)}


@app.post("/api/imgproc/folder/sub", dependencies=_IMG)
def imgproc_folder_sub(b: ImgFolderSub):
    return _img_call(nasko_imagefactory.folder_add_sub, b.folder, b.sub)


@app.post("/api/imgproc/folder/sub-delete", dependencies=_IMG)
def imgproc_folder_sub_delete(b: ImgFolderSub):
    _img_call(nasko_imagefactory.folder_del_sub, b.folder, b.sub)
    return {"ok": True}


@app.post("/api/imgproc/folder/move", dependencies=_IMG)
def imgproc_folder_move(b: ImgFolderMove):
    return {"moved": _img_call(nasko_imagefactory.folder_move, b.folder, b.files, b.to)}


class ImgFolderName(BaseModel):
    folder: str


@app.post("/api/imgproc/folder/repair", dependencies=_IMG)
def imgproc_folder_repair(b: ImgFolderName):
    """Reprise : ne traite que les images restées dans « A faire » et les AJOUTE au Dossier Principal (aucun écrasement)."""
    try:
        return {"ok": True, **nasko_imagefactory.repair_folder(b.folder)}
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    except (FileNotFoundError, ValueError, OSError) as e:
        raise HTTPException(400, str(e))


@app.post("/api/imgproc/queue/dismiss", dependencies=_IMG)
def imgproc_queue_dismiss():
    nasko_imagefactory.queue_dismiss()
    return {"ok": True}


@app.get("/api/imgproc/folder/export-dest", dependencies=_IMG)
def imgproc_folder_export_dest():
    return {"path": nasko_imagefactory.default_export_dest()}


@app.post("/api/imgproc/folder/export", dependencies=_IMG)
def imgproc_folder_export(b: ImgFolderExport):
    dest = b.dest or nasko_imagefactory.default_export_dest()
    if not dest:
        raise HTTPException(404, "Dossier « BIN A JEU » introuvable : choisissez une destination.")
    return _img_call(nasko_imagefactory.folder_export, b.folder, _safe(dest, "dir"))


@app.post("/api/imgproc/to-multiple", dependencies=_IMG)
def imgproc_to_multiple(b: ImgTask):
    """Corrige une erreur de dossier : découpe (Sprite Slicer) le PNG détouré d'une tâche Simple, sans repasser par PhotoRoom."""
    try:
        nasko_imagefactory.convert_to_multiple(b.task)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(404, str(e))
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    return {"ok": True}


# --- LABORATOIRE AUDIO : extraction WAV (FFmpeg), détection des SFX (pydub), export au sample près
class AuStart(BaseModel):
    path: str


class AuAnalyze(BaseModel):
    name: str
    offset_db: float | None = None
    min_silence_ms: float | None = None
    keep_ms: float | None = None
    min_sfx_ms: float | None = None


class AuRegion(BaseModel):
    start: float
    end: float


class AuExport(BaseModel):
    name: str
    regions: list[AuRegion]
    fmt: str = "wav"
    bitrate: int = 192


class AuMp3(BaseModel):
    name: str
    bitrate: int = 192


class AuColis(BaseModel):
    folder: str
    files: list[str] | None = None


def _au(fn, *a, **k):
    try:
        return fn(*a, **k)
    except nasko_audio.AudioError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    except Exception as e:                       # WAV illisible, pydub, disque…
        raise HTTPException(400, f"{e.__class__.__name__}: {e}")


@app.get("/api/audio/state", dependencies=_IMG)
def audio_state():
    return nasko_audio.state()


@app.get("/api/audio/playlist", dependencies=_IMG)
def audio_playlist():
    return _au(nasko_audio.playlist)


@app.get("/api/audio/todo", dependencies=_IMG)
def audio_todo():
    return {"items": _au(nasko_audio.list_todo), "defaults": nasko_audio.DEFAULTS, "ffmpeg": bool(nasko_compress.ffmpeg_exe())}


@app.post("/api/audio/start", dependencies=_IMG)
def audio_start(b: AuStart):
    _au(nasko_audio.start, _safe(b.path, "file"))
    return {"ok": True}


@app.post("/api/audio/cancel", dependencies=_IMG)
def audio_cancel():
    nasko_audio.cancel()
    return {"ok": True}


@app.post("/api/audio/open", dependencies=_LOCAL)
def audio_open(b: AuAnalyze):
    return _au(nasko_audio.open_wav, b.name, offset_db=b.offset_db, min_silence_ms=b.min_silence_ms, keep_ms=b.keep_ms, min_sfx_ms=b.min_sfx_ms)


@app.post("/api/audio/analyze", dependencies=_IMG)
def audio_analyze(b: AuAnalyze):
    return _au(lambda: nasko_audio.analyze(nasko_audio.work_path(b.name), offset_db=b.offset_db, min_silence_ms=b.min_silence_ms,
                                           keep_ms=b.keep_ms, min_sfx_ms=b.min_sfx_ms))


@app.get("/api/audio/file", dependencies=_IMG)
def audio_file(scope: str, path: str):
    p = _au(nasko_audio.file_path, scope, path)
    return FileResponse(p, media_type="audio/mpeg" if p.lower().endswith(".mp3") else "audio/wav", headers={"Cache-Control": "private, max-age=60"})


@app.post("/api/audio/export", dependencies=_IMG)
def audio_export(b: AuExport):
    return _au(nasko_audio.export, b.name, [r.model_dump() for r in b.regions], b.fmt, b.bitrate)


@app.post("/api/audio/mp3", dependencies=_IMG)
def audio_mp3(b: AuMp3):
    return _au(nasko_audio.convert_full, b.name, b.bitrate)


@app.post("/api/audio/colis", dependencies=_IMG)
def audio_colis(b: AuColis):
    return _au(nasko_audio.make_colis, b.folder, b.files)


@app.post("/api/audio/open-folder", dependencies=_LOCAL)
def audio_open_folder():
    nasko_audio.open_folder()
    return {"ok": True}


@app.post("/api/audio/pick", dependencies=_LOCAL)
def audio_pick():
    win = state.get("window")
    if win is None:
        return {"path": None, "error": "Le sélecteur de fichier n'est disponible que dans la fenêtre E.N.O.S. : collez le chemin à la place."}
    import webview
    kind = getattr(getattr(webview, "FileDialog", None), "OPEN", None) or webview.OPEN_DIALOG
    exts = nasko_audio.AUDIO_EXTS + nasko_audio.VIDEO_EXTS
    res = win.create_file_dialog(kind, allow_multiple=False, file_types=(f"Audio et Video ({';'.join('*' + e for e in exts)})", "Tous les fichiers (*.*)"))
    if res:
        sec.grant(res[0])
    return {"path": res[0] if res else None}


# --- SÉCURITÉ : clé d'appairage, état, tickets
@app.get("/api/security/ticket", dependencies=_REMOTE)
def security_ticket():
    t, exp = sec.make_ticket()
    return {"ticket": t, "exp": exp}


@app.get("/api/security/status", dependencies=_REMOTE)
def security_status(request: Request):
    cfg = load_config()
    st = sec.status()
    out = {"alert": st["alert"], "fingerprint": sec.fingerprint(), "enc_required_remote": bool(cfg.get("enc_required_remote")),
           "inject_remote": bool(cfg.get("api_key_inject_remote", True)), "limit": sec.RL_LIMIT}
    if is_local(request):                                   # IP, chemins et journal : visibles seulement sur le PC
        out.update(stats=st["stats"], events=st["events"], blocked=st["blocked"], roots=sec.allowed_roots(), key_file=sec.key_path(),
                   created=sec.keys().get("created", ""))
    return out


@app.get("/api/security/pairing", dependencies=_LOCAL)
def security_pairing():
    tok = sec.pairing_token()
    return {"token": tok, "qr": _qr(tok), "fingerprint": sec.fingerprint(), "created": sec.keys().get("created", "")}


@app.post("/api/security/rotate", dependencies=_LOCAL)
def security_rotate():
    sec.rotate()
    return {"ok": True, "token": sec.pairing_token(), "fingerprint": sec.fingerprint()}


@app.post("/api/security/dismiss", dependencies=_REMOTE)
def security_dismiss():
    sec.dismiss_alert()
    return {"ok": True}


class SecConfig(BaseModel):
    enc_required_remote: bool | None = None
    api_key_inject_remote: bool | None = None


@app.post("/api/security/config", dependencies=_LOCAL)
def security_config(b: SecConfig):
    vals = {k: v for k, v in b.model_dump().items() if v is not None}
    if vals:
        update_config(vals)
        _cfg_cache["t"] = 0
    return {"ok": True, **vals}


# --- SYNC : PC <-> mobile
def _abs_urls(path):
    if not state["network"] or not state["https_port"]:
        return []
    return [f"https://{ip}:{state['https_port']}{path}" for ip in lan_ips()]


def _share_json(sh, local):
    path = nasko_sync.share_path(sh)
    d = {"token": sh["token"], "name": sh["name"], "size": sh["size"], "expires": sh["expires"], "created": sh["created"],
         "kind": sh["kind"], "path": path, "hits": sh["hits"]}
    if local:
        urls = _abs_urls(path)
        d.update(urls=urls, qr=_qr(urls[0]) if urls else None, network=bool(urls))
    return d


class ShareReq(BaseModel):
    path: str
    ttl_min: float | None = None


@app.post("/api/sync/pick", dependencies=_LOCAL)
def sync_pick():
    win = state.get("window")
    if win is None:
        return {"path": None, "error": "Le sélecteur de fichier n'est disponible que dans la fenêtre E.N.O.S. : collez le chemin à la place."}
    import webview
    kind = getattr(getattr(webview, "FileDialog", None), "OPEN", None) or webview.OPEN_DIALOG
    res = win.create_file_dialog(kind, allow_multiple=False)
    if res:
        sec.grant(res[0])
    return {"path": res[0] if res else None}


@app.post("/api/sync/share", dependencies=_LOCAL)
def sync_share(b: ShareReq):
    """PC -> mobile : expose un fichier du PC sur un lien temporaire (QR code + lien)."""
    p = _safe(b.path, "file")                                           # le PC n'expose jamais un fichier hors des dossiers autorisés
    return _share_json(nasko_sync.make_share(p, "manual", b.ttl_min), True)


@app.get("/api/sync/shares", dependencies=_REMOTE)
def sync_shares(request: Request):
    """Fichiers préparés sur le PC (le téléphone les télécharge depuis cette liste)."""
    local = is_local(request)
    return {"items": [_share_json(s, local) for s in nasko_sync.list_shares("manual")], "network": bool(state["network"] and state["https_port"])}


@app.delete("/api/sync/share/{token}", dependencies=_LOCAL)
def sync_unshare(token: str):
    return {"ok": nasko_sync.revoke(token)}


@app.post("/api/sync/upload", dependencies=_REMOTE)
def sync_upload(request: Request, files: list[UploadFile] = File(...), enc: str = Form(""), meta: str = Form("")):
    """Mobile -> PC : enregistre chaque fichier reçu dans Stockage/Réception_Mobile (flux par blocs de 1 Mo).
    Avec enc=1 : le fichier est un flux AES-256-GCM (NKE1) et son nom voyage chiffré dans `meta`."""
    _require_enc(request, enc)
    if enc:
        try:
            m = sec.meta_open(meta, "/api/sync/upload")
            path, size = nasko_sync.save_upload(files[0], nasko_sync.RECV, name=m.get("name"), decrypt=True)
        except sec.CryptoError as e:
            sec.STATS["crypto_errors"] += 1
            raise HTTPException(400, f"Envoi chiffré refusé : {e}")
        except nasko_sync.TooLarge as e:
            raise HTTPException(413, str(e))
        except nasko_sync.SyncError as e:
            raise HTTPException(400, str(e))
        log.info("Reçu du mobile (chiffré) : %s (%d o)", path, size)
        return {"ok": True}                                           # réponse volontairement muette : aucun nom de fichier en clair
    saved = []
    for f in files:
        try:
            path, size = nasko_sync.save_upload(f, nasko_sync.RECV)
        except nasko_sync.TooLarge as e:
            raise HTTPException(413, str(e))
        except nasko_sync.SyncError as e:
            raise HTTPException(400, f"{f.filename} : {e}")
        saved.append({"name": os.path.basename(path), "size": size})
        log.info("Reçu du mobile : %s (%d o)", path, size)
    return {"ok": True, "saved": saved}


@app.get("/api/sync/received", dependencies=_REMOTE)
def sync_received():
    return {"items": nasko_sync.list_received(), "folder": "Stockage/Réception_Mobile", "max_mb": nasko_sync.max_bytes() // 1048576}


@app.post("/api/sync/open-folder", dependencies=_LOCAL)
def sync_open_folder():
    nasko_sync.ensure_dirs()
    os.startfile(nasko_sync.RECV)
    return {"ok": True}


@app.get("/dl/{token}/{name}")
def download_share(token: str, name: str):
    """Téléchargement par lien temporaire (sans connexion : le jeton aléatoire est la clé). Flux Range-compatible."""
    sh = nasko_sync.get_share(token)
    if not sh:
        raise HTTPException(404, "Lien expiré ou introuvable.")
    return FileResponse(sh["path"], filename=sh["name"], media_type="application/octet-stream", headers={"Cache-Control": "no-store"})


@app.get("/dle/{token}/{name}")
def download_share_encrypted(token: str, name: str):
    """Même lien temporaire que /dl/, mais le contenu est un flux AES-256-GCM (NKE1) : illisible sans la clé (déchiffré par l'APK appairée)."""
    sh = nasko_sync.get_share(token)
    if not sh:
        raise HTTPException(404, "Lien expiré ou introuvable.")
    f = open(sh["path"], "rb")

    def gen():
        try:
            yield from sec.encrypt_stream(f.read)
        finally:
            f.close()
    from urllib.parse import quote as _q
    return StreamingResponse(gen(), media_type="application/octet-stream",
                             headers={"Content-Length": str(sec.encrypted_size(sh["size"])), "Cache-Control": "no-store", "X-Nasko-Enc": "stream",
                                      "Content-Disposition": "attachment; filename*=UTF-8''" + _q(sh["name"])})


# --- MODE CHILL : lecteur ambiant (Stockage/Ambiance_Audio)
@app.get("/api/chill/tracks", dependencies=_REMOTE)
def chill_tracks():
    return {"items": nasko_sync.chill_tracks(), "folder": "Stockage/Ambiance_Audio"}


@app.get("/api/chill/file")
def chill_file(name: str, k: str = ""):
    _check_k(k)                                            # <audio src> n'envoie pas d'en-tête : le jeton passe par l'URL
    try:
        p = nasko_sync.chill_file(name)
    except nasko_sync.SyncError as e:
        raise HTTPException(404, str(e))
    return FileResponse(p, headers={"Cache-Control": "private, max-age=3600"})        # Range géré : la barre de lecture peut chercher


@app.post("/api/chill/open-folder", dependencies=_LOCAL)
def chill_open_folder():
    nasko_sync.ensure_dirs()
    os.startfile(nasko_sync.AMBI)
    return {"ok": True}


# --- GESTION GOOGLE : onglets Chrome (CDP)
class TabClose(BaseModel):
    id: str


@app.get("/api/tabs", dependencies=_LOCAL)
def tabs_list():
    try:
        return nasko_tabs.list_tabs()
    except nasko_tabs.TabsError as e:
        return {"ok": False, "code": e.code, "message": str(e)}
    except Exception as e:
        log.exception("Liste des onglets")
        return {"ok": False, "code": "error", "message": f"{e.__class__.__name__}: {str(e)[:150]}"}


@app.get("/api/tabs/thumb", dependencies=_LOCAL)
def tabs_thumb(id: str):
    return nasko_tabs.thumb(id)


@app.post("/api/tabs/close", dependencies=_LOCAL)
def tabs_close(b: TabClose):
    return nasko_tabs.close_tab(b.id)


@app.post("/api/tabs/ext-install", dependencies=_LOCAL)
def tabs_ext_install():
    """Génère l'extension Chrome (data/chrome_ext), ouvre le dossier et chrome://extensions : il reste à « Charger l'extension non empaquetée »."""
    try:
        import nasko_webauto
        return {"ok": True, "folder": nasko_ext.open_installer(state["port"], nasko_webauto._chrome_exe())}
    except Exception as e:
        return {"ok": False, "message": str(e)[:200]}


class ExtTabs(BaseModel):
    tabs: list
    thumbs: dict = {}


@app.get("/ext/ping", dependencies=[Depends(need_token)])
def ext_ping():
    nasko_ext.seen()
    return {"ok": True}


@app.post("/ext/tabs", dependencies=[Depends(need_token)])
def ext_tabs(b: ExtTabs):
    nasko_ext.put_tabs(b.tabs, b.thumbs)
    return {"ok": True}


@app.get("/ext/poll", dependencies=[Depends(need_token)])
def ext_poll(wait: float = 15.0):
    return {"commands": nasko_ext.poll(wait)}


@app.post("/api/tabs/open-chrome", dependencies=_LOCAL)
def tabs_open_chrome():
    try:
        return {"ok": True, "port": nasko_tabs.open_chrome()}
    except Exception as e:
        return {"ok": False, "message": str(e)[:200]}


# --- COMPRESSION MÉDIA : images (Pillow) et vidéos (FFmpeg), sorties dans Compression/Livraison
class CpPath(BaseModel):
    path: str


class CpStart(BaseModel):
    path: str
    mode: str
    value: str | float


class CpKind(BaseModel):
    kind: str
    where: str = "media"            # "media" : dossier Vidéos / Images de Windows · "other" : navigation libre (dernier dossier utilisé)


_CP_LAST = {}          # dernier dossier ouvert via « Chercher un autre fichier… »


def _cp(fn, *a):
    try:
        return fn(*a)
    except nasko_compress.CompressError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(409, str(e))


@app.get("/api/compress/state", dependencies=_REMOTE)
def compress_state(request: Request):
    st = nasko_compress.state()
    if not is_local(request) and st.get("result"):              # un téléphone n'a pas à connaître les chemins du PC
        st["result"] = {k: v for k, v in st["result"].items() if k != "out"}
    return st


@app.post("/api/compress/upload", dependencies=_REMOTE)
def compress_upload(request: Request, file: UploadFile = File(...), mode: str = Form(""), value: str = Form(""), enc: str = Form(""), meta: str = Form("")):
    """Compression d'un fichier ENVOYÉ (galerie du téléphone) : le PC compresse, puis un lien de téléchargement du résultat est fourni.
    Avec enc=1 : fichier AES-256-GCM (NKE1) ; nom, mode et valeur voyagent chiffrés dans `meta`."""
    _require_enc(request, enc)
    if nasko_compress.state()["busy"]:
        raise HTTPException(409, "Une compression est déjà en cours.")
    shown = file.filename
    name = None
    if enc:
        try:
            m = sec.meta_open(meta, "/api/compress/upload")
        except sec.CryptoError as e:
            sec.STATS["crypto_errors"] += 1
            raise HTTPException(400, f"Envoi chiffré refusé : {e}")
        mode, value, name = str(m.get("mode", "")), str(m.get("value", "")), m.get("name")
        shown = name
    dest = os.path.join(nasko_compress.UPLOADS, secrets.token_hex(4))     # un dossier par envoi : le nom du fichier reste propre
    try:
        path, size = nasko_sync.save_upload(file, dest, name=name, decrypt=bool(enc))
    except sec.CryptoError as e:
        shutil.rmtree(dest, ignore_errors=True)
        sec.STATS["crypto_errors"] += 1
        raise HTTPException(400, f"Envoi chiffré refusé : {e}")
    except nasko_sync.TooLarge as e:
        shutil.rmtree(dest, ignore_errors=True)
        raise HTTPException(413, str(e))
    except nasko_sync.SyncError as e:
        shutil.rmtree(dest, ignore_errors=True)
        raise HTTPException(400, str(e))
    try:
        nasko_compress.start(path, mode, value, uploaded=True, shown_name=shown)
    except nasko_compress.CompressError as e:
        shutil.rmtree(dest, ignore_errors=True)
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        shutil.rmtree(dest, ignore_errors=True)
        raise HTTPException(409, str(e))
    return {"ok": True} if enc else {"ok": True, "size": size}


@app.get("/api/compress/files", dependencies=_IMG)
def compress_files():
    return {"items": nasko_compress.list_todo(), "ffmpeg": bool(nasko_compress.ffmpeg_exe())}


@app.post("/api/compress/info", dependencies=_IMG)
def compress_info(b: CpPath):
    return _cp(nasko_compress.info, _safe(b.path, "file"))


@app.post("/api/compress/start", dependencies=_IMG)
def compress_start(b: CpStart):
    _cp(nasko_compress.start, _safe(b.path, "file"), b.mode, b.value)
    return {"ok": True}


@app.post("/api/compress/cancel", dependencies=_REMOTE)
def compress_cancel():
    nasko_compress.cancel()
    return {"ok": True}


@app.post("/api/compress/open", dependencies=_LOCAL)
def compress_open():
    nasko_compress.open_folder()
    return {"ok": True}


@app.post("/api/compress/pick", dependencies=_LOCAL)
def compress_pick(b: CpKind):
    """Sélecteur de fichier natif Windows (fenêtre pywebview)."""
    win = state.get("window")
    if win is None:
        return {"path": None, "error": "Le sélecteur de fichier n'est disponible que dans la fenêtre E.N.O.S. : collez le chemin à la place."}
    import webview
    kind = getattr(getattr(webview, "FileDialog", None), "OPEN", None) or webview.OPEN_DIALOG
    exts = nasko_compress.IMG_EXTS if b.kind == "image" else nasko_compress.VID_EXTS
    label = "Images" if b.kind == "image" else "Vidéos"
    if b.where == "other":
        start = _CP_LAST.get("dir") or os.path.expanduser("~")
    else:
        start = nasko_paths.pictures_dir() if b.kind == "image" else nasko_paths.videos_dir()       # le bouton principal s'ouvre directement dans ~\Videos
    res = win.create_file_dialog(kind, directory=start, allow_multiple=False, file_types=(f"{label} ({';'.join('*' + e for e in exts)})", "Tous les fichiers (*.*)"))
    if res:
        sec.grant(res[0])
        _CP_LAST["dir"] = os.path.dirname(res[0])
    return {"path": res[0] if res else None}


# =============================================================================== NOTES DE FRAIS (ticket / facture -> tableau Excel)
class RcExport(BaseModel):
    rows: list[dict]


def _rc(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except nasko_receipts.ReceiptError as e:
        raise HTTPException(400, str(e))


@app.post("/api/receipts/analyze", dependencies=_LOCAL)
def receipts_analyze(files: list[UploadFile] = File(...)):
    """Photos / PDF de tickets : lues une à une par le modèle de vision du LLM (tâche de fond). Les images ne sont pas conservées."""
    if not files or len(files) > nasko_receipts.MAX_FILES:
        raise HTTPException(400, f"Entre 1 et {nasko_receipts.MAX_FILES} fichiers à la fois.")
    if not nasko_llm.configured(load_config()):
        raise HTTPException(400, "L'IA n'est pas configurée : ajoutez llm_api_key dans nasko_config.json (voir GUIDE.md).")
    ref = nasko_receipts.new_ref()
    d = os.path.join(nasko_receipts.UP, ref)
    total = 0
    try:
        for i, f in enumerate(files):
            shown = nasko_receipts.safe_name(f.filename, f"ticket{i}")
            if os.path.splitext(shown)[1].lower() not in nasko_receipts.EXTS:
                raise HTTPException(400, f"Format non géré : {shown} (photo ou PDF).")
            with open(os.path.join(d, f"{i:03d}_{shown}"), "wb") as out:
                while True:
                    chunk = f.file.read(1 << 20)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > 300 * 1048576:
                        raise HTTPException(413, "Fichiers trop volumineux (300 Mo maximum).")
                    out.write(chunk)
        _rc(nasko_receipts.start, ref)
    except BaseException:
        shutil.rmtree(d, ignore_errors=True)
        raise
    return nasko_receipts.job()


@app.get("/api/receipts/job", dependencies=_LOCAL)
def receipts_job():
    return nasko_receipts.job()


@app.post("/api/receipts/export", dependencies=_LOCAL)
def receipts_export(b: RcExport):
    path = _rc(nasko_receipts.export_xlsx, b.rows)
    sh = nasko_sync.make_share(path, kind="receipts", ttl_min=120)
    return {"name": os.path.basename(path), "size": os.path.getsize(path), "link": nasko_sync.share_path(sh)}


@app.post("/api/receipts/open-folder", dependencies=_LOCAL)
def receipts_open_folder():
    nasko_receipts.ensure_dirs()
    os.startfile(nasko_receipts.OUT)
    return {"ok": True}


# =============================================================================== SYLLABUS SCANNER (plan de cours -> agenda)
class SyImport(BaseModel):
    events: list[dict]


class SyUndo(BaseModel):
    batch: str


def _sy(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except nasko_syllabus.SyllabusError as e:
        raise HTTPException(400, str(e))


@app.post("/api/syllabus/analyze", dependencies=_LOCAL)
def syllabus_analyze(file: UploadFile = File(...)):
    """Dépose un plan de cours (PDF, Word, texte) : l'analyse tourne en tâche de fond ; le document n'est pas conservé."""
    name = os.path.basename(file.filename or "plan")
    ext = os.path.splitext(name)[1].lower()
    if ext not in (".pdf", ".docx", ".txt", ".md", ".csv"):
        raise HTTPException(400, "Format non géré : PDF, Word (.docx) ou texte (.txt).")
    if not nasko_llm.configured(load_config()):
        raise HTTPException(400, "L'IA n'est pas configurée : ajoutez llm_api_key dans nasko_config.json (voir GUIDE.md).")
    path = os.path.join(nasko_syllabus.upload_dir(), secrets.token_hex(6) + ext)
    total = 0
    try:
        with open(path, "wb") as out:
            while True:
                chunk = file.file.read(1 << 20)
                if not chunk:
                    break
                total += len(chunk)
                if total > 40 * 1048576:
                    raise HTTPException(413, "Document trop volumineux (40 Mo maximum).")
                out.write(chunk)
        _sy(nasko_syllabus.start, path)
    except BaseException:
        try:
            os.remove(path)
        except OSError:
            pass
        raise
    return nasko_syllabus.job()


@app.get("/api/syllabus/job", dependencies=_LOCAL)
def syllabus_job():
    return nasko_syllabus.job()


@app.post("/api/syllabus/import", dependencies=_LOCAL)
def syllabus_import(b: SyImport):
    res = _sy(nasko_syllabus.import_events, b.events)
    nasko_agent.poke()                                                # l'IA proactive voit tout de suite les nouvelles échéances
    return res


@app.post("/api/syllabus/undo", dependencies=_LOCAL)
def syllabus_undo(b: SyUndo):
    res = _sy(nasko_syllabus.undo_import, b.batch)
    nasko_agent.poke()
    return res


# =============================================================================== STUDIO MÉDIA (conversion, GIF/MP3, agrandissement, débruitage, floutage, EXIF, transcription, sous-titres) — strictement local
class StRun(BaseModel):
    ref: str
    opts: dict = {}


def _st(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except nasko_studio.StudioError as e:
        raise HTTPException(400, str(e))
    except HTTPException:
        raise
    except Exception as e:                                           # jamais d'erreur muette côté interface
        log.exception("Studio média : échec inattendu")
        raise HTTPException(500, f"Échec inattendu : {e}")


def _st_view():
    j = nasko_studio.job()
    r = j.get("result")
    if isinstance(r, dict) and r.get("paths"):
        files = []
        for p in r["paths"]:
            sh = nasko_sync.make_share(p, kind="studio", ttl_min=120)
            files.append({"name": os.path.basename(p), "size": os.path.getsize(p), "link": nasko_sync.share_path(sh)})
        r = {**{k: v for k, v in r.items() if k != "paths"}, "files": files}
    return {**j, "result": r}


@app.get("/api/studio/caps", dependencies=_LOCAL)
def studio_caps():
    return nasko_studio.capabilities()


@app.post("/api/studio/upload", dependencies=_LOCAL)
def studio_upload(files: list[UploadFile] = File(...)):
    """Dépose les fichiers à traiter (un « ref » par envoi) ; une image reçoit aussi un aperçu JPEG affichable (HEIC, TIFF…)."""
    ref = nasko_studio.new_ref()
    d = os.path.join(nasko_studio.UP, ref)
    total, names = 0, []
    try:
        for i, f in enumerate(files):
            shown = nasko_studio.safe_name(f.filename, f"fichier{i}")
            if not nasko_studio.kind_of(shown):
                raise HTTPException(400, f"Format non géré : {shown}.")
            path = os.path.join(d, f"{i:03d}_{shown}")
            with open(path, "wb") as out:
                while True:
                    chunk = f.file.read(1 << 20)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > nasko_studio.MAX_UPLOAD:
                        raise HTTPException(413, "Fichiers trop volumineux (4 Go maximum).")
                    out.write(chunk)
            names.append(shown)
        first = sorted(nasko_studio.ref_files(ref))[0]
        preview = nasko_studio.kind_of(first) == "image" and bool(_st(nasko_studio.make_preview, first, os.path.join(d, "_preview.jpg")))
        return {"ref": ref, "names": names, "kind": nasko_studio.kind_of(first), "preview": preview}
    except BaseException:
        shutil.rmtree(d, ignore_errors=True)
        raise


@app.get("/api/studio/preview", dependencies=_LOCAL)
def studio_preview(ref: str):
    p = os.path.join(_st(nasko_studio.ref_dir, ref), "_preview.jpg")
    if not os.path.isfile(p):
        raise HTTPException(404, "Pas d'aperçu.")
    return FileResponse(p, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.post("/api/studio/run/{tool}", dependencies=_LOCAL)
def studio_run(tool: str, b: StRun):
    _st(nasko_studio.start, tool, b.ref, b.opts)
    return _st_view()


@app.get("/api/studio/job", dependencies=_LOCAL)
def studio_job():
    return _st_view()


@app.post("/api/studio/job/cancel", dependencies=_LOCAL)
def studio_cancel():
    nasko_studio.cancel()
    return {"ok": True}


@app.post("/api/studio/open-folder", dependencies=_LOCAL)
def studio_open_folder():
    nasko_studio.ensure_dirs()
    os.startfile(nasko_studio.OUT)
    return {"ok": True}


# =============================================================================== ÉDITEUR PDF (PyMuPDF) — strictement local : les documents ne quittent jamais ce PC (sauf l'IA, qui envoie le texte au LLM configuré)
class PdfOpen(BaseModel):
    paths: list[str]
    password: str = ""
    replace: bool = False


class PdfArrange(BaseModel):
    pages: list[dict]


class PdfSpec(BaseModel):
    pages: str = ""


class PdfSplit(BaseModel):
    mode: str
    value: str = ""


class PdfOps(BaseModel):
    ops: list[dict]


class PdfOpts(BaseModel):
    opts: dict = {}


class PdfProtect(BaseModel):
    user_pw: str = ""
    owner_pw: str = ""
    allow_print: bool = True
    allow_copy: bool = True
    allow_modify: bool = True


class PdfJob(BaseModel):
    level: str = ""            # compress : light | medium | strong
    lang: str = ""             # ocr : fra+eng · translate : fr | en | …
    fmt: str = ""              # convert : docx | xlsx | pptx
    length: str = "standard"   # summarize : short | standard | detailed
    force: bool = False


class PdfChat(BaseModel):
    question: str
    history: list[dict] = []


def _pdf(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except nasko_pdf.PdfError as e:
        raise HTTPException(400, str(e))
    except Exception as e:                                           # jamais d'erreur muette côté interface
        log.exception("PDF : échec inattendu")
        raise HTTPException(500, f"Échec inattendu : {e}")


def _pdf_files(paths):
    out = []
    for p in paths:
        sh = nasko_sync.make_share(p, kind="pdf", ttl_min=120)
        out.append({"name": os.path.basename(p), "size": os.path.getsize(p), "link": nasko_sync.share_path(sh)})
    return out


@app.get("/api/pdf/state", dependencies=_LOCAL)
def pdf_state():
    return _pdf(nasko_pdf.state)


@app.post("/api/pdf/new", dependencies=_LOCAL)
def pdf_new():
    _pdf(nasko_pdf.new_session)
    return _pdf(nasko_pdf.state)


@app.post("/api/pdf/upload", dependencies=_LOCAL)
def pdf_upload(files: list[UploadFile] = File(...), password: str = Form(""), replace: str = Form("")):
    """Fichiers déposés / choisis dans la page : copiés dans un dossier temporaire, puis fusionnés (PDF, images, documents Office)."""
    nasko_pdf.ensure_dirs()
    scratch = os.path.join(nasko_pdf.WORK, ".up_" + secrets.token_hex(4))
    os.makedirs(scratch, exist_ok=True)
    items, total = [], 0
    try:
        for i, f in enumerate(files):
            shown = nasko_pdf.safe_name(f.filename, f"fichier{i}")
            ext = os.path.splitext(shown)[1].lower()
            if ext not in (".pdf",) + nasko_pdf.IMG_EXTS + nasko_pdf.OFFICE_EXTS:
                raise HTTPException(400, f"Format non géré : {shown} (PDF, images ou documents Office).")
            path = os.path.join(scratch, f"{i:03d}_{shown}")
            with open(path, "wb") as out:
                while True:
                    chunk = f.file.read(1 << 20)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > nasko_pdf.MAX_UPLOAD:
                        raise HTTPException(413, f"Fichiers trop volumineux (maximum {nasko_pdf.MAX_UPLOAD // 1048576} Mo).")
                    out.write(chunk)
            items.append((path, shown))
        return _pdf(nasko_pdf.add_files, items, password, bool(replace))
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


@app.post("/api/pdf/pick", dependencies=_LOCAL)
def pdf_pick():
    """Sélecteur de fichiers natif (plusieurs fichiers) : renvoie les chemins choisis (autorisés pour 8 h)."""
    win = state.get("window")
    if win is None:
        return {"paths": [], "error": "Le sélecteur n'est disponible que dans la fenêtre E.N.O.S. : déposez vos fichiers dans la page."}
    import webview
    kind = getattr(getattr(webview, "FileDialog", None), "OPEN", None) or webview.OPEN_DIALOG
    exts = (".pdf",) + nasko_pdf.IMG_EXTS + nasko_pdf.OFFICE_EXTS
    res = win.create_file_dialog(kind, directory=nasko_paths.user_dir("downloads"), allow_multiple=True,
                                 file_types=(f"PDF, images, documents ({';'.join('*' + e for e in exts)})", "Tous les fichiers (*.*)"))
    for p in res or []:
        sec.grant(p)
    return {"paths": list(res or [])}


@app.post("/api/pdf/open", dependencies=_LOCAL)
def pdf_open(b: PdfOpen):
    items = [(_safe(p, "file"), os.path.basename(p)) for p in b.paths]
    if not items:
        raise HTTPException(400, "Aucun fichier.")
    return _pdf(nasko_pdf.add_files, items, b.password, b.replace)


@app.post("/api/pdf/undo", dependencies=_LOCAL)
def pdf_undo():
    return _pdf(nasko_pdf.undo)


@app.get("/api/pdf/page", dependencies=_LOCAL)
def pdf_page(n: int, z: float = 1.0, fmt: str = "jpg"):
    data, mime = _pdf(nasko_pdf.render, n, z, "png" if fmt == "png" else "jpg")
    return Response(data, media_type=mime, headers={"Cache-Control": "no-store"})


@app.get("/api/pdf/lines", dependencies=_LOCAL)
def pdf_lines(n: int):
    return {"lines": _pdf(nasko_pdf.text_lines, n)}


@app.post("/api/pdf/arrange", dependencies=_LOCAL)
def pdf_arrange(b: PdfArrange):
    return _pdf(nasko_pdf.arrange, b.pages)


@app.post("/api/pdf/extract", dependencies=_LOCAL)
def pdf_extract(b: PdfSpec):
    return {"files": _pdf_files(_pdf(nasko_pdf.extract, b.pages))}


@app.post("/api/pdf/split", dependencies=_LOCAL)
def pdf_split(b: PdfSplit):
    return {"files": _pdf_files(_pdf(nasko_pdf.split, b.mode, b.value))}


@app.post("/api/pdf/annotate", dependencies=_LOCAL)
def pdf_annotate(b: PdfOps):
    return _pdf(nasko_pdf.annotate, b.ops)


@app.post("/api/pdf/watermark", dependencies=_LOCAL)
def pdf_watermark(b: PdfOpts):
    return _pdf(nasko_pdf.watermark, b.opts)


@app.post("/api/pdf/numbers", dependencies=_LOCAL)
def pdf_numbers(b: PdfOpts):
    return _pdf(nasko_pdf.page_numbers, b.opts)


@app.post("/api/pdf/protect", dependencies=_LOCAL)
def pdf_protect(b: PdfProtect):
    return {"files": _pdf_files(_pdf(nasko_pdf.protect, b.user_pw, b.owner_pw, b.allow_print, b.allow_copy, b.allow_modify))}


@app.post("/api/pdf/export", dependencies=_LOCAL)
def pdf_export():
    return {"files": _pdf_files(_pdf(nasko_pdf.export_current))}


@app.post("/api/pdf/open-folder", dependencies=_LOCAL)
def pdf_open_folder():
    nasko_pdf.ensure_dirs()
    os.startfile(nasko_pdf.OUT)
    return {"ok": True}


@app.post("/api/pdf/chat", dependencies=_LOCAL)
def pdf_chat(b: PdfChat):
    return {"answer": _pdf(nasko_pdf.chat, b.question, b.history)}


def _pdf_job_view():
    j = nasko_pdf.job()
    r = j.get("result")
    if isinstance(r, dict) and r.get("paths"):
        r = {**{k: v for k, v in r.items() if k != "paths"}, "files": _pdf_files(r["paths"])}
    return {**j, "result": r}


@app.get("/api/pdf/job", dependencies=_LOCAL)
def pdf_job():
    return _pdf_job_view()


@app.post("/api/pdf/job/cancel", dependencies=_LOCAL)
def pdf_job_cancel():
    nasko_pdf.cancel()
    return {"ok": True}


@app.post("/api/pdf/job/{kind}", dependencies=_LOCAL)
def pdf_job_start(kind: str, b: PdfJob):
    """Opérations longues en tâche de fond : compress · ocr · convert · summarize · translate. L'interface suit l'avancement avec GET /api/pdf/job."""
    P = nasko_pdf
    if kind == "compress":
        fn = lambda: {"kind": "compress", **P.compress(b.level)}                                      # noqa: E731
    elif kind == "ocr":
        fn = lambda: {"kind": "ocr", **P.ocr(b.lang or "fra+eng", b.force)}                           # noqa: E731
    elif kind == "convert":
        fn = lambda: {"kind": "files", "paths": P.convert_from_pdf(b.fmt)}                            # noqa: E731
    elif kind == "summarize":
        fn = lambda: {"kind": "text", "text": P.summarize(b.length)}                                  # noqa: E731
    elif kind == "translate":
        def fn():
            r = P.translate(b.lang)
            return {"kind": "files", "paths": r["files"], "skipped_rotated": r["skipped_rotated"], "blocks": r["blocks"]}
    else:
        raise HTTPException(404, "Opération inconnue.")
    if kind in ("summarize", "translate") and not nasko_pdf.capabilities()["llm"]:
        raise HTTPException(400, "L'IA n'est pas configurée : ajoutez llm_api_key dans nasko_config.json (voir GUIDE.md).")
    _pdf(P.start_job, kind, fn)
    return _pdf_job_view()


# =============================================================================== YOUTUBE UPLOADER (API YouTube Data v3, OAuth2)
class YtUpload(BaseModel):
    path: str
    title: str
    visibility: str                 # public | unlisted | private  (« Conçu pour les enfants » n'est PAS un paramètre : toujours False, voir nasko_youtube.build_body)


def _yt(fn, *a):
    try:
        return fn(*a)
    except nasko_youtube.YouTubeError as e:
        raise HTTPException(400, str(e))


@app.get("/api/youtube/state", dependencies=_LOCAL)
def youtube_state():
    return nasko_youtube.state()


@app.post("/api/youtube/pick", dependencies=_LOCAL)
def youtube_pick():
    """Sélecteur natif Windows, ouvert directement dans le dossier Vidéos de Windows."""
    win = state.get("window")
    if win is None:
        return {"path": None, "error": "Le sélecteur n'est disponible que dans la fenêtre E.N.O.S. : collez le chemin à la place."}
    import webview
    kind = getattr(getattr(webview, "FileDialog", None), "OPEN", None) or webview.OPEN_DIALOG
    exts = nasko_youtube.VIDEO_EXTS
    res = win.create_file_dialog(kind, directory=nasko_paths.videos_dir(), allow_multiple=False,
                                 file_types=(f"Vidéos ({';'.join('*' + e for e in exts)})", "Tous les fichiers (*.*)"))
    if res:
        sec.grant(res[0])
    return {"path": res[0] if res else None, "size": os.path.getsize(res[0]) if res and os.path.isfile(res[0]) else 0}


@app.post("/api/youtube/import-secret", dependencies=_LOCAL)
def youtube_import_secret():
    """Sélecteur natif : choisir le client_secret.json téléchargé depuis Google Cloud (copié dans le dossier de configuration)."""
    win = state.get("window")
    if win is None:
        raise HTTPException(400, "Le sélecteur n'est disponible que dans la fenêtre E.N.O.S. : copiez le fichier dans le dossier de configuration.")
    import webview
    kind = getattr(getattr(webview, "FileDialog", None), "OPEN", None) or webview.OPEN_DIALOG
    res = win.create_file_dialog(kind, directory=nasko_paths.user_dir("downloads"), allow_multiple=False,
                                 file_types=("JSON (*.json)", "Tous les fichiers (*.*)"))
    if not res:
        return {"ok": False}
    _yt(nasko_youtube.import_secret, res[0])
    return {"ok": True}


@app.post("/api/youtube/connect", dependencies=_LOCAL)
def youtube_connect():
    _yt(nasko_youtube.start_connect)                 # configuration automatique si besoin, puis connexion Google
    return {"ok": True}


@app.post("/api/youtube/disconnect", dependencies=_LOCAL)
def youtube_disconnect():
    nasko_youtube.disconnect()
    return {"ok": True}


@app.post("/api/youtube/upload", dependencies=_LOCAL)
def youtube_upload(b: YtUpload):
    _yt(nasko_youtube.start_upload, _safe(b.path, "file"), b.title, b.visibility)
    return {"ok": True}


@app.post("/api/youtube/cancel", dependencies=_LOCAL)
def youtube_cancel():
    nasko_youtube.cancel()
    return {"ok": True}


@app.post("/api/youtube/open-config", dependencies=_LOCAL)
def youtube_open_config():
    os.startfile(nasko_youtube.config_dir())
    return {"ok": True}


# =============================================================================== DEEP SYSTEM CLEANER (analyse de disque)
class ClScan(BaseModel):
    min_mb: int = 100
    scope: str = "system"           # "system" : disque système · "all" : tous les disques fixes


class ClDelete(BaseModel):
    ids: list[int]
    permanent: bool = False         # False : Corbeille de Windows (réversible)
    allow_risky: bool = False       # confirmation explicite pour les fichiers 🟠 ; les 🔴 sont refusés quoi qu'il arrive


class ClId(BaseModel):
    id: int


@app.get("/api/cleaner/state", dependencies=_LOCAL)
def cleaner_state():
    return nasko_cleaner.state()


@app.post("/api/cleaner/scan", dependencies=_LOCAL)
def cleaner_scan(b: ClScan):
    if b.scope not in ("system", "all"):
        raise HTTPException(400, "portée inconnue")
    try:
        nasko_cleaner.start(max(10, min(b.min_mb, 20480)), b.scope)
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    return {"ok": True}


@app.post("/api/cleaner/cancel", dependencies=_LOCAL)
def cleaner_cancel():
    nasko_cleaner.cancel()
    return {"ok": True}


@app.get("/api/cleaner/results", dependencies=_LOCAL)
def cleaner_results():
    return nasko_cleaner.results()


@app.post("/api/cleaner/delete", dependencies=_LOCAL)
def cleaner_delete(b: ClDelete):
    if not b.ids or len(b.ids) > 2000:
        raise HTTPException(400, "sélection vide ou trop grande")
    res = nasko_cleaner.delete(b.ids, permanent=b.permanent, allow_risky=b.allow_risky)
    sec.event("nettoyage disque", "local", f"{sum(r['ok'] for r in res['results'])} fichier(s)", "corbeille" if not b.permanent else "définitif")
    return res


@app.post("/api/cleaner/reveal", dependencies=_LOCAL)
def cleaner_reveal(b: ClId):
    try:
        nasko_cleaner.reveal(b.id)
    except RuntimeError as e:
        raise HTTPException(404, str(e))
    return {"ok": True}


# =============================================================================== ORGANISATEUR DE DOSSIERS ET DE FICHIERS
class OrgPath(BaseModel):
    path: str
    hidden: bool = False


class OrgName(BaseModel):
    parent: str
    name: str


class OrgRename(BaseModel):
    path: str
    name: str


class OrgPaths(BaseModel):
    paths: list[str]
    dest: str = ""
    parent: str = ""
    name: str = ""


class OrgImport(BaseModel):
    dest: str
    kind: str = "files"             # files | folder


def _org(fn, *a):
    try:
        return fn(*a)
    except nasko_organizer.OrgError as e:
        raise HTTPException(400, str(e))


nasko_organizer.set_projects_provider(lambda: [x for x in _projects() if isinstance(x, dict) and x.get("path")])


@app.get("/api/org/roots", dependencies=_LOCAL)
def org_roots():
    return {"roots": nasko_organizer.default_roots([x for x in _projects() if isinstance(x, dict) and x.get("path")])}


@app.post("/api/org/pick", dependencies=_LOCAL)
def org_pick():
    """Sélecteur de dossier natif : le dossier choisi devient une racine de l'organisateur."""
    win = state.get("window")
    if win is None:
        return {"path": None, "error": "Le sélecteur de dossier n'est disponible que dans la fenêtre E.N.O.S."}
    import webview
    kind = getattr(getattr(webview, "FileDialog", None), "FOLDER", None) or webview.FOLDER_DIALOG
    res = win.create_file_dialog(kind, directory=os.path.expanduser("~"))
    if not res:
        return {"path": None}
    _org(nasko_organizer.grant, res[0])
    return {"path": os.path.abspath(res[0])}


@app.post("/api/org/list", dependencies=_LOCAL)
def org_list(b: OrgPath):
    return _org(nasko_organizer.list_dir, b.path, b.hidden)


@app.post("/api/org/mkdir", dependencies=_LOCAL)
def org_mkdir(b: OrgName):
    return _org(nasko_organizer.mkdir, b.parent, b.name)


@app.post("/api/org/newfile", dependencies=_LOCAL)
def org_newfile(b: OrgName):
    return _org(nasko_organizer.newfile, b.parent, b.name)


@app.post("/api/org/rename", dependencies=_LOCAL)
def org_rename(b: OrgRename):
    return _org(nasko_organizer.rename, b.path, b.name)


def _org_batch(b: OrgPaths):
    if not b.paths or len(b.paths) > 5000:
        raise HTTPException(400, "sélection vide ou trop grande")


class OrgBulk(BaseModel):
    paths: list[str]
    opts: dict = {}


@app.post("/api/org/rename-plan", dependencies=_LOCAL)
def org_rename_plan(b: OrgBulk):
    plan = _org(nasko_organizer.rename_plan, b.paths, b.opts)
    return {"plan": [{k: v for k, v in x.items() if k != "path"} for x in plan]}


@app.post("/api/org/rename-batch", dependencies=_LOCAL)
def org_rename_batch(b: OrgBulk):
    return _org(nasko_organizer.rename_batch, b.paths, b.opts)


@app.post("/api/org/move", dependencies=_LOCAL)
def org_move(b: OrgPaths):
    _org_batch(b)
    return _org(nasko_organizer.move, b.paths, b.dest)


@app.post("/api/org/copy", dependencies=_LOCAL)
def org_copy(b: OrgPaths):
    _org_batch(b)
    return _org(nasko_organizer.copy, b.paths, b.dest)


@app.post("/api/org/group", dependencies=_LOCAL)
def org_group(b: OrgPaths):
    _org_batch(b)
    return _org(nasko_organizer.group, b.paths, b.parent, b.name)


@app.post("/api/org/extract", dependencies=_LOCAL)
def org_extract(b: OrgPaths):
    _org_batch(b)
    return _org(nasko_organizer.extract, b.paths)


@app.post("/api/org/flatten", dependencies=_LOCAL)
def org_flatten(b: OrgPath):
    return _org(nasko_organizer.flatten, b.path)


@app.post("/api/org/delete", dependencies=_LOCAL)
def org_delete(b: OrgPaths):
    _org_batch(b)
    res = _org(nasko_organizer.delete, b.paths)
    sec.event("organisateur", "local", f"{len(res['done'])} élément(s)", "corbeille")
    return res


@app.post("/api/org/undo", dependencies=_LOCAL)
def org_undo():
    return {"label": _org(nasko_organizer.undo)}


@app.post("/api/org/open", dependencies=_LOCAL)
def org_open(b: OrgPath):
    _org(nasko_organizer.open_item, b.path)
    return {"ok": True}


@app.get("/api/org/thumb", dependencies=_LOCAL)
async def org_thumb(path: str, size: int = 256):
    data = await run_in_threadpool(_org, nasko_organizer.thumbnail, path, size)
    return Response(data, media_type="image/png", headers={"Cache-Control": "private, max-age=300"})


@app.post("/api/org/reveal", dependencies=_LOCAL)
def org_reveal(b: OrgPath):
    _org(nasko_organizer.reveal, b.path)
    return {"ok": True}


@app.post("/api/org/autosort/plan", dependencies=_LOCAL)
def org_autosort_plan(b: OrgPath):
    return {"plan": _org(nasko_organizer.autosort_plan, b.path)}


@app.post("/api/org/autosort", dependencies=_LOCAL)
def org_autosort(b: OrgPath):
    return _org(nasko_organizer.autosort, b.path)


@app.post("/api/org/import", dependencies=_LOCAL)
def org_import(b: OrgImport):
    """Ajouter des éléments : sélecteur natif (fichiers ou dossier) puis copie dans le dossier courant."""
    win = state.get("window")
    if win is None:
        return {"done": [], "fails": [], "error": "Le sélecteur n'est disponible que dans la fenêtre E.N.O.S."}
    import webview
    fd = getattr(webview, "FileDialog", None)
    if b.kind == "folder":
        kind, multi = getattr(fd, "FOLDER", None) or webview.FOLDER_DIALOG, False
    else:
        kind, multi = getattr(fd, "OPEN", None) or webview.OPEN_DIALOG, True
    res = win.create_file_dialog(kind, directory=nasko_paths.user_dir("downloads"), allow_multiple=multi)
    if not res:
        return {"done": [], "fails": []}
    return _org(nasko_organizer.import_into, b.dest, list(res))


@app.get("/api/colis", dependencies=_IMG)
def colis_list():
    """Gestionnaire de colis : colis .zip en attente avec poids et contenu."""
    return {"items": nasko_imagefactory.list_colis(details=True)}


@app.post("/api/colis/rename", dependencies=_IMG)
def colis_rename(b: ColisRename):
    try:
        return nasko_imagefactory.rename_colis(b.name, b.new_name)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except FileExistsError as e:
        raise HTTPException(409, str(e))
    except (ValueError, OSError) as e:
        raise HTTPException(400, str(e))


@app.get("/api/imgproc/colis", dependencies=_IMG)
def imgproc_colis():
    return {"items": nasko_imagefactory.list_colis()}


@app.get("/api/imgproc/destinations", dependencies=_IMG)
def imgproc_destinations():
    return {"items": nasko_imagefactory.destinations()}



# =============================================================================== E.N.O.S. : ÉQUIPE (réglages, appareils, entrepôt, git, chat)
def _me(cfg=None):
    cfg = cfg or load_config()
    return cfg.get("profile_id", "nassime"), cfg.get("user_label", "Nassime")


def _wh_root():
    try:
        return nasko_team.root_of(load_config())
    except nasko_team.TeamError as e:
        raise HTTPException(400, str(e))


def _team(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except nasko_team.TeamError as e:
        raise HTTPException(400, str(e))
    except PermissionError as e:
        raise HTTPException(403, "accès refusé : " + str(e))
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except OSError as e:
        raise HTTPException(500, str(e))


@app.get("/api/edition", dependencies=_REMOTE)
def edition(request: Request):
    """Édition de CET appareil : « dev » (E.N.O.S. / Eto Dev : ce PC ou appareil de confiance) ou « eto » (grand public, limitée)."""
    cfg = load_config()
    local = is_local(request)
    ed = "dev" if local else request.scope.get("state", {}).get("edition", "eto")
    pid, label = _me(cfg)
    return {"edition": ed, "local": local, "user": {"id": pid, "label": label if ed == "dev" else ""},
            "brand": "E.N.O.S." if local else ("Eto Dev" if ed == "dev" else "Eto"),
            "language": nasko_core.language(cfg), "welcome_language": str(cfg.get("welcome_language", "fr")).lower(),
            "uuid_known": bool(request.scope.get("state", {}).get("device_uuid")),
            "trusted": (not local) and nasko_team.is_dev(request.scope.get("state", {}).get("device_uuid", "")),
            "preview": (not local) and nasko_team.preview(request.scope.get("state", {}).get("device_uuid", ""))}


class PreviewReq(BaseModel):
    on: bool


@app.post("/api/edition/preview", dependencies=_REMOTE)
def edition_preview(b: PreviewReq, request: Request):
    """Bascule « aperçu grand public » <-> « Eto Dev » pour CET appareil de confiance (menu caché : 5 appuis sur le logo)."""
    if is_local(request):
        raise HTTPException(400, "Ce PC est toujours en édition développeur.")
    uuid = request.scope.get("state", {}).get("device_uuid", "")
    if not nasko_team.set_preview(uuid, b.on):                      # appareil non approuvé : même réponse que si la route n'existait pas
        raise HTTPException(404)
    return {"ok": True, "preview": b.on}


# --- réglages : langue de l'assistant (français / anglais)
class LangReq(BaseModel):
    language: str


@app.post("/api/settings/language", dependencies=_LOCAL)
def settings_language(b: LangReq):
    if b.language not in ("fr", "en"):
        raise HTTPException(400, "Langue inconnue (fr ou en).")
    update_config({"language": b.language})
    return {"language": b.language}


# --- réglages : personnalité active (E.N.O.S. antagoniste / ETO zen)
class PersonaReq(BaseModel):
    persona: str


@app.get("/api/settings/persona", dependencies=_LOCAL)
def settings_persona_get():
    cfg = load_config()
    return {"persona": nasko_persona.current(cfg), "eto_voice": nasko_eleven.configured(cfg, "eto"), "enos_voice": nasko_eleven.configured(cfg)}


@app.post("/api/settings/persona", dependencies=_LOCAL)
def settings_persona_set(b: PersonaReq):
    if b.persona not in ("enos", "eto"):
        raise HTTPException(400, "Personnalité inconnue (enos ou eto).")
    nasko_persona.set_current(b.persona)
    nasko_chessbridge.push_persona(b.persona)                      # plateau Godot encastré
    nasko_pet.set_persona(b.persona)                               # Œil / visage de bureau
    return settings_persona_get()


class WelcomeReq(BaseModel):
    welcome_language: str


@app.post("/api/settings/welcome", dependencies=_LOCAL)
def settings_welcome(b: WelcomeReq):
    if b.welcome_language not in ("fr", "en", "off"):
        raise HTTPException(400, "Choix inconnu (fr, en ou off).")
    update_config({"welcome_language": b.welcome_language})
    return {"welcome_language": b.welcome_language}


@app.get("/api/settings/welcome/preview", dependencies=_LOCAL)
def settings_welcome_preview(lang: str = ""):
    if lang not in ("fr", "en"):
        raise HTTPException(400, "Langue inconnue.")
    try:
        return nasko_voice.ref("welcome_" + lang, load_config())
    except KeyError:
        raise HTTPException(404)


# --- réglages : profil
_PATH_LABELS = {"godot_path": ("Godot", "file"), "aseprite_path": ("Aseprite", "file"), "chrome_path": ("Chrome", "file"),
                "ffmpeg_path": ("FFmpeg", "file"), "project_dir": ("Projet Godot", "dir"), "warehouse_dir": ("Entrepôt partagé", "dir")}


def _profile_view():
    data = nasko_core.load_profiles()
    pid, pr = nasko_core.current_profile(data)
    return {"active": pid, "label": pr.get("label") or pid.capitalize(),
            "profiles": [{"id": k, "label": v.get("label") or k.capitalize()} for k, v in data["profiles"].items()],
            "paths": [{"key": k, "label": _PATH_LABELS[k][0], "kind": _PATH_LABELS[k][1], "value": (pr.get("paths") or {}).get(k, "")}
                      for k in nasko_core.PROFILE_PATH_KEYS if k in _PATH_LABELS],
            "windows_users": pr.get("windows_users", []), "file": nasko_core.profiles_path()}


def _check_profile_path(key, value):
    if not value:
        return ""
    value = value.strip().strip('"')
    kind = _PATH_LABELS[key][1]
    if "\0" in value or not os.path.exists(value):
        raise HTTPException(400, f"{_PATH_LABELS[key][0]} : chemin introuvable.")
    if (kind == "dir" and not os.path.isdir(value)) or (kind == "file" and not os.path.isfile(value)):
        raise HTTPException(400, f"{_PATH_LABELS[key][0]} : {'un dossier' if kind == 'dir' else 'un fichier'} est attendu.")
    real = sec._norm(value)
    win = sec._norm(os.environ.get("SystemRoot", r"C:\Windows"))
    if sec._inside(real, win):
        raise HTTPException(400, "Dossier système Windows refusé.")
    if kind == "dir" and any(sec._inside(real, d) or sec._inside(d, real) for d in sec.sensitive_dirs()):
        raise HTTPException(400, "Dossier sensible (système / identifiants) refusé.")
    if kind == "file" and not value.lower().endswith((".exe", ".bat", ".cmd")):
        raise HTTPException(400, f"{_PATH_LABELS[key][0]} : un exécutable (.exe) est attendu.")
    return os.path.abspath(value)


class ProfileReq(BaseModel):
    active: str | None = None
    label: str | None = None
    paths: dict[str, str] | None = None


@app.get("/api/settings/profile", dependencies=_LOCAL)
def settings_profile():
    return _profile_view()


@app.post("/api/settings/profile", dependencies=_LOCAL)
def settings_profile_save(b: ProfileReq):
    data = nasko_core.load_profiles()
    if b.active is not None:
        if b.active not in data["profiles"]:
            raise HTTPException(400, "profil inconnu")
        data["active"] = b.active
        nasko_core.save_profiles(data)
    pid, pr = nasko_core.current_profile(data)
    if b.label is not None:
        lab = b.label.strip()[:30]
        if not lab or not all(c.isalnum() or c in " -_'" for c in lab):
            raise HTTPException(400, "nom invalide")
        data["profiles"][pid]["label"] = lab
    if b.paths:
        for k, v in b.paths.items():
            if k not in _PATH_LABELS:
                raise HTTPException(400, "clé inconnue : " + k)
            data["profiles"][pid].setdefault("paths", {})[k] = _check_profile_path(k, v)
    nasko_core.save_profiles(data)
    _cfg_cache["t"] = 0
    return _profile_view()


class PickKey(BaseModel):
    key: str


@app.post("/api/settings/pick", dependencies=_LOCAL)
def settings_pick(b: PickKey):
    if b.key not in _PATH_LABELS:
        raise HTTPException(400, "clé inconnue")
    win = state.get("window")
    if win is None:
        return {"path": None, "error": "Le sélecteur n'est disponible que dans la fenêtre E.N.O.S. : collez le chemin à la place."}
    import webview
    fd = getattr(webview, "FileDialog", None)
    if _PATH_LABELS[b.key][1] == "dir":
        res = win.create_file_dialog(getattr(fd, "FOLDER", None) or webview.FOLDER_DIALOG)
    else:
        res = win.create_file_dialog(getattr(fd, "OPEN", None) or webview.OPEN_DIALOG, allow_multiple=False,
                                     file_types=("Programmes (*.exe)", "Tous les fichiers (*.*)"))
    return {"path": res[0] if res else None}


# --- appareils de confiance
class DeviceApprove(BaseModel):
    uuid: str
    name: str = ""


@app.get("/api/team/devices", dependencies=_LOCAL)
def team_devices():
    return nasko_team.snapshot()


@app.post("/api/team/devices", dependencies=_LOCAL)
def team_device_approve(b: DeviceApprove):
    _team(nasko_team.approve, b.uuid.strip(), b.name)
    return nasko_team.snapshot()


@app.delete("/api/team/devices/{uuid}", dependencies=_LOCAL)
def team_device_remove(uuid: str):
    if not nasko_team.remove(uuid):
        raise HTTPException(404, "appareil inconnu")
    return nasko_team.snapshot()


# --- entrepôt partagé
class WhItem(BaseModel):
    owner: str
    kind: str = "colis"
    name: str


class WhPublish(BaseModel):
    kind: str = "colis"          # colis | fichiers
    name: str = ""               # colis : nom dans « Colis en attente »
    path: str = ""               # fichiers : chemin (dossiers autorisés ou choisi dans le sélecteur natif)


class WhDeliver(BaseModel):
    owner: str
    name: str
    dest: str


@app.get("/api/warehouse", dependencies=_IMG)
def warehouse_list():
    cfg = load_config()
    root = _wh_root()
    me, label = _me(cfg)
    _team(nasko_team.ensure, root, me, label)
    items = _team(nasko_team.list_items, root, me)
    return {"me": me, "root_name": os.path.basename(root) or root, "peers": nasko_team.peers(root, me), "items": items,
            "new": sum(1 for i in items if i["new"])}


@app.get("/api/warehouse/badge", dependencies=_IMG)
def warehouse_badge():
    try:
        root = nasko_team.root_of(load_config())
    except nasko_team.TeamError:
        return {"configured": False, "new": 0}
    return {"configured": True, "new": _team(nasko_team.new_count, root, _me()[0])}


@app.post("/api/warehouse/seen", dependencies=_IMG)
def warehouse_seen():
    _team(nasko_team.mark_seen, _wh_root(), _me()[0])
    return {"ok": True}


@app.post("/api/warehouse/publish", dependencies=_IMG)
def warehouse_publish(b: WhPublish):
    cfg = load_config()
    root = _wh_root()
    me, label = _me(cfg)
    if b.kind == "colis":
        if not b.name or b.name != os.path.basename(b.name):
            raise HTTPException(400, "nom de colis invalide")
        src = os.path.join(nasko_imagefactory.PENDING, b.name)
    else:
        src = _safe(b.path, "file")
    return _team(nasko_team.publish, root, me, label, src, b.kind if b.kind in nasko_team.KINDS else None)


@app.post("/api/warehouse/fetch", dependencies=_IMG)
def warehouse_fetch(b: WhItem):
    """Récupère l'élément de l'associé chez moi : un colis arrive dans « Colis en attente » (GÉRER LES COLIS), un fichier dans Stockage/Entrepôt."""
    root = _wh_root()
    dest = nasko_imagefactory.PENDING if b.kind == "colis" else os.path.join(nasko_core.app_dir(), "Stockage", "Entrepôt")
    out = _team(nasko_team.fetch, root, b.owner, b.kind, b.name, dest)
    return {"name": os.path.basename(out)}


@app.post("/api/warehouse/deliver", dependencies=_IMG)
def warehouse_deliver(b: WhDeliver):
    """Livre directement le colis (de l'associé ou le mien) dans un dossier : extrait dans un sous-dossier portant le nom du colis."""
    root = _wh_root()
    src = _team(nasko_team.item_path, root, b.owner, "colis", b.name)
    dest = _safe(b.dest, "dir")
    try:
        return nasko_imagefactory.deliver_zip(src, dest, os.path.splitext(b.name)[0])
    except Exception as e:                                       # zip corrompu / pas encore entièrement synchronisé / dossier introuvable
        raise HTTPException(400, str(e) or "colis illisible")


@app.post("/api/warehouse/contents", dependencies=_IMG)
def warehouse_contents(b: WhItem):
    return _team(nasko_team.contents, _wh_root(), b.owner, b.name)


@app.post("/api/warehouse/archive", dependencies=_IMG)
def warehouse_archive(b: WhItem):
    _team(nasko_team.archive, _wh_root(), b.owner, b.kind, b.name)
    return {"ok": True}


@app.post("/api/warehouse/remove", dependencies=_IMG)
def warehouse_remove(b: WhItem):
    me = _me()[0]
    if b.owner != me:
        raise HTTPException(403, "vous ne pouvez supprimer que vos propres envois (l'archivage est possible pour tous)")
    _team(nasko_team.remove_mine, _wh_root(), me, b.kind, b.name)
    return {"ok": True}


# --- synchronisation Git (ce PC uniquement : lance git sur le dossier du projet)
@app.get("/api/git/status", dependencies=_LOCAL)
def git_status():
    path = load_config().get("project_dir", "")
    return {"info": nasko_git.info(path), "run": {k: nasko_git.STATE[k] for k in ("running", "steps", "ok", "message", "conflicts", "needs_choice", "other", "t")}}


class GitSync(BaseModel):
    resolve: str = ""          # "" | "ours" (garder mes versions) | "theirs" (prendre celles de l'autre) — choisi par bouton après une alerte


class GitSetup(BaseModel):
    url: str = ""


@app.post("/api/git/sync", dependencies=_LOCAL)
def git_sync(b: GitSync | None = None):
    path = load_config().get("project_dir", "")
    if not path or not os.path.isdir(path):
        raise HTTPException(400, "Dossier du projet Godot introuvable (RÉGLAGES → PROFIL).")
    if not nasko_git.start(path, (b.resolve if b else "")):
        raise HTTPException(409, "Une synchronisation est déjà en cours.")
    return {"started": True}


@app.post("/api/git/setup", dependencies=_LOCAL)
def git_setup(b: GitSetup):
    path = load_config().get("project_dir", "")
    try:
        return nasko_git.setup(path, b.url)
    except RuntimeError as e:
        raise HTTPException(400, str(e))


@app.post("/api/git/abort", dependencies=_LOCAL)
def git_abort():
    return {"result": nasko_git.abort(load_config().get("project_dir", ""))}


# --- DEV MANAGER : dépôts de l'espace de travail WSL (\\\\wsl.localhost\\Ubuntu\\home\\nasko, voir nasko_wsl.py), clonage, VS Code distant, zone de dépôt des scripts .sh (ce PC uniquement)
class DevClone(BaseModel):
    url: str


class DevRepo(BaseModel):
    repo: str


def _dev(fn, *a):
    try:
        return fn(*a, load_config())
    except nasko_devmanager.DevError as e:
        raise HTTPException(400, str(e))


@app.get("/api/dev/status", dependencies=_LOCAL)
def dev_status():
    return nasko_devmanager.status()


class DevRun(BaseModel):
    repo: str
    cmd: str


class DevScript(BaseModel):
    repo: str
    script: str
    args: str = ""


class DevImport(BaseModel):
    repo: str
    name: str
    content: str
    overwrite: bool = False


class DevDrop(BaseModel):
    name: str
    content: str
    overwrite: bool = False


class DevJob(BaseModel):
    id: str


@app.get("/api/dev/repos", dependencies=_LOCAL)
def dev_repos(full: bool = False):
    return _dev(lambda cfg: nasko_devmanager.list_repos(cfg, full))


@app.get("/api/dev/repo", dependencies=_LOCAL)
def dev_repo(name: str):
    return _dev(nasko_devmanager.repo_info, name)


@app.post("/api/dev/clone", dependencies=_LOCAL)
def dev_clone(b: DevClone):
    jid, name = _dev(nasko_devmanager.clone, b.url)
    return {"id": jid, "repo": name}


class DevUninstall(BaseModel):
    confirm: bool = False
    silent: bool = True


@app.post("/api/dev/uninstall-launcher", dependencies=_LOCAL)
def dev_uninstall_launcher(b: DevUninstall):
    """Désinstalle la version de test (E.N.O.S. + Launcher : un seul désinstalleur Inno). Lance et rend la main : l'UAC s'affiche à l'écran. `confirm` obligatoire."""
    if not b.confirm:
        raise HTTPException(400, "Confirmation requise.")
    return _dev(lambda cfg: nasko_devmanager.uninstall_launcher(b.silent))


@app.post("/api/dev/open", dependencies=_LOCAL)
def dev_open(b: DevRepo):
    return {"path": _dev(nasko_devmanager.open_vscode, b.repo)}


@app.post("/api/dev/explorer", dependencies=_LOCAL)
def dev_explorer(b: DevRepo):
    return {"path": _dev(nasko_devmanager.open_explorer, b.repo)}


@app.post("/api/dev/run", dependencies=_LOCAL)
def dev_run(b: DevRun):
    return {"id": _dev(lambda cfg: nasko_devmanager.start_job("cmd", b.repo, b.cmd, cfg))}


@app.post("/api/dev/script", dependencies=_LOCAL)
def dev_script(b: DevScript):
    return {"id": _dev(lambda cfg: nasko_devmanager.run_script(b.repo, b.script, b.args, cfg))}


@app.post("/api/dev/import", dependencies=_LOCAL)
def dev_import(b: DevImport):
    try:
        nasko_devmanager.import_script(b.repo, b.name, b.content, b.overwrite, load_config())
    except nasko_devmanager.DevError as e:
        raise HTTPException(409 if str(e) == "exists" else 400, str(e))
    return {"ok": True}


@app.post("/api/dev/drop", dependencies=_LOCAL)
def dev_drop(b: DevDrop):
    """Zone de dépôt : un .sh glissé est enregistré dans l'espace de travail WSL (LF, exécutable), prêt à être lancé côté Linux. Jamais exécuté ici."""
    try:
        return {"ok": True, **nasko_devmanager.drop_script(b.name, b.content, b.overwrite, load_config())}
    except nasko_devmanager.DevError as e:
        raise HTTPException(409 if str(e) == "exists" else 400, str(e))


@app.get("/api/dev/jobs", dependencies=_LOCAL)
def dev_jobs():
    return {"jobs": nasko_devmanager.jobs()}


@app.get("/api/dev/job", dependencies=_LOCAL)
def dev_job(id: str, since: int = 0):
    return _dev(lambda cfg: nasko_devmanager.job_output(id, since))


class DevFile(BaseModel):
    repo: str
    path: str
    content: str = ""


class DevEntry(BaseModel):
    repo: str
    path: str
    kind: str = "file"


@app.get("/api/dev/tree", dependencies=_LOCAL)
def dev_tree(repo: str, path: str = "."):
    return {"items": _dev(lambda cfg: nasko_devmanager.tree(repo, path, cfg))}


@app.get("/api/dev/file", dependencies=_LOCAL)
def dev_file(repo: str, path: str):
    return _dev(lambda cfg: nasko_devmanager.read_file(repo, path, cfg))


@app.post("/api/dev/file/save", dependencies=_LOCAL)
def dev_file_save(b: DevFile):
    return {"ok": _dev(lambda cfg: nasko_devmanager.write_file(b.repo, b.path, b.content, cfg))}


@app.post("/api/dev/fs/create", dependencies=_LOCAL)
def dev_fs_create(b: DevEntry):
    return {"ok": _dev(lambda cfg: nasko_devmanager.create_entry(b.repo, b.path, b.kind, cfg))}


@app.post("/api/dev/fs/delete", dependencies=_LOCAL)
def dev_fs_delete(b: DevEntry):
    return {"ok": _dev(lambda cfg: nasko_devmanager.delete_entry(b.repo, b.path, cfg))}


@app.post("/api/dev/stop", dependencies=_LOCAL)
def dev_stop(b: DevJob):
    return {"ok": nasko_devmanager.stop_job(b.id)}


# --- MODE APPRENTISSAGE : ETO enseigne une ouverture (arbres PGN, démonstration animée sur le plateau Godot, puis pratique)
def _op(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except opening_manager.OpeningError as e:
        raise HTTPException(400, str(e))


class StudyStart(BaseModel):
    id: str
    detail: str = "key"
    voice: bool = True


class StudyBack(BaseModel):
    plies: int = 1


class StudyForward(BaseModel):
    idx: int = 0


class StudyOptions(BaseModel):
    detail: str | None = None
    voice: bool | None = None


class StudyMove(BaseModel):
    uci: str
    promo: str | None = None


@app.get("/api/study/openings", dependencies=_LOCAL)
def study_openings():
    return {"openings": opening_manager.list_openings(), "dirs": opening_manager.openings_dirs(), "active": opening_manager.active()}


@app.get("/api/study/state", dependencies=_LOCAL)
def study_state():
    return opening_manager.state()


@app.post("/api/study/start", dependencies=_LOCAL)
def study_start(b: StudyStart):
    return _op(opening_manager.start, b.id, b.detail, b.voice)


@app.post("/api/study/stop", dependencies=_LOCAL)
def study_stop():
    return opening_manager.stop()


@app.post("/api/study/next", dependencies=_LOCAL)
def study_next():
    return _op(opening_manager.next_step)


@app.post("/api/study/back", dependencies=_LOCAL)
def study_back(b: StudyBack):
    return _op(opening_manager.go_back, b.plies)


@app.post("/api/study/forward", dependencies=_LOCAL)
def study_forward(b: StudyForward):
    return _op(opening_manager.go_forward, b.idx)


@app.post("/api/study/resume", dependencies=_LOCAL)
def study_resume():
    return _op(opening_manager.resume_demo)


@app.post("/api/study/restart", dependencies=_LOCAL)
def study_restart():
    return _op(opening_manager.restart_demo)


@app.post("/api/study/practice", dependencies=_LOCAL)
def study_practice():
    return _op(opening_manager.begin_practice)


@app.post("/api/study/explain", dependencies=_LOCAL)
def study_explain():
    return _op(opening_manager.explain_here)


@app.post("/api/study/options", dependencies=_LOCAL)
def study_options(b: StudyOptions):
    return _op(opening_manager.set_options, b.detail, b.voice)


@app.post("/api/study/move", dependencies=_LOCAL)
def study_move(b: StudyMove):
    if not re.fullmatch(r"[a-h][1-8][a-h][1-8][qrbn]?", b.uci) or (b.promo or "q") not in ("q", "r", "b", "n"):
        raise HTTPException(400, "coup invalide")
    return _op(opening_manager.user_move, b.uci, "http", b.promo)


@app.get("/api/study/events", dependencies=_LOCAL)
def study_events(since: int = 0):
    return opening_manager.events(since)


# --- assistant Claude : vraie fenêtre PowerShell indépendante, ouverte dans le dossier racine d'E.N.O.S.
@app.post("/api/assistant/call", dependencies=_LOCAL)
def assistant_call():
    root = nasko_core.app_dir()
    cmd = f"Set-Location -LiteralPath '{root.replace(chr(39), chr(39) * 2)}'; claude"
    try:
        subprocess.Popen(["powershell.exe", "-NoExit", "-Command", cmd], cwd=root, creationflags=subprocess.CREATE_NEW_CONSOLE)
    except OSError as e:
        raise HTTPException(500, f"Impossible d'ouvrir PowerShell ({e.strerror or e}).")
    return {"ok": True}


# --- site web Dual Pulse (local) : état du serveur, démarrage discret de lancer_site.bat, ouverture dans le navigateur
SITE_URL = "http://127.0.0.1:8000"
_site = {"t": 0.0}


def _site_dir():
    return os.path.join(nasko_core.app_dir(), "dualpulse_site")


def _site_online():
    try:
        with socket.create_connection(("127.0.0.1", 8000), timeout=1):
            return True
    except OSError:
        return False


@app.get("/api/site/status", dependencies=_LOCAL)
def site_status():
    online = _site_online()
    starting = (not online) and time.time() - _site["t"] < 90
    t = _tun
    alive = bool(t["proc"] and t["proc"].poll() is None)
    return {"online": online, "starting": starting, "url": SITE_URL, "tunnel": {"active": alive, "url": t["url"] if alive else "", "error": t["err"]}, "installed": os.path.isfile(os.path.join(_site_dir(), "lancer_site.bat"))}


@app.post("/api/site/start", dependencies=_LOCAL)
def site_start():
    d = _site_dir()
    bat = os.path.join(d, "lancer_site.bat")
    if not os.path.isfile(bat):
        raise HTTPException(404, "dualpulse_site/lancer_site.bat introuvable à côté de ENOS.exe.")
    if _site_online():
        return {"ok": True, "already": True}
    try:
        log = open(os.path.join(d, "serveur.log"), "ab")
        subprocess.Popen(["cmd", "/c", bat], cwd=d, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                         creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP)
    except OSError as e:
        raise HTTPException(500, f"Impossible de démarrer le serveur ({e.strerror or e}).")
    _site["t"] = time.time()
    return {"ok": True}


_tun = {"proc": None, "url": "", "err": ""}


def _tun_reader(proc):
    for raw in proc.stdout:
        m = re.search(r"https://[a-z0-9-]+\.lhr\.life", raw.decode("utf-8", "replace"))
        if m:
            _tun["url"] = m.group(0)
    if proc is _tun["proc"] and not _tun["url"]:
        _tun["err"] = "Le tunnel s'est fermé avant de fournir un lien (pas de connexion internet ?)."


def _tun_stop():
    p = _tun["proc"]
    if p and p.poll() is None:
        p.terminate()
    _tun.update(proc=None, url="")


atexit.register(_tun_stop)


# --- CONTRÔLE MOBILE (adb / scrcpy) : strictement local, jamais via l'entrepôt ni un appareil distant (_LOCAL)
class MobileDev(BaseModel):
    device_id: str = ""


class MobileAct(BaseModel):
    action: str


def _mob(fn, *a):
    try:
        return fn(*a)
    except nasko_mobile.MobileError as e:
        raise HTTPException(400, str(e))


@app.get("/api/mobile/status", dependencies=_LOCAL)
def mobile_status():
    return _mob(nasko_mobile.status)


@app.post("/api/mobile/device", dependencies=_LOCAL)
def mobile_device(b: MobileDev):
    _mob(nasko_mobile.set_device_id, b.device_id)
    _cfg_cache["t"] = 0
    return _mob(nasko_mobile.status)


@app.post("/api/mobile/install", dependencies=_LOCAL)
def mobile_install():
    _mob(nasko_mobile.install_adb)
    return _mob(nasko_mobile.status)


@app.post("/api/mobile/action", dependencies=_LOCAL)
def mobile_action(b: MobileAct):
    return _mob(nasko_mobile.run_action, b.action)


@app.post("/api/mobile/mirror", dependencies=_LOCAL)
def mobile_mirror():
    return _mob(nasko_mobile.mirror)


# --- DÉFI · CHESS (python-chess + Stockfish)
class ChessNew(BaseModel):
    color: str = "w"
    power: int = 100                 # jauge de puissance 1–100 % (→ Elo, voir nasko_chess.power_to_elo)
    elo: int | None = None           # Elo exact du bot (mode cours)
    challenger: str = "eto"          # mode « boss » : eto · enos · duo (les deux en équipe) contre Stockfish
    opponent: str = ""               # duel (mode « enos ») : enos · eto · eto_brillant (3200 Elo, cherche le sacrifice brillant)
    mode: str = "enos"               # « enos » : défi contre E.N.O.S. · « coach » : cours, bot virtuel à l'Elo choisi commenté par ETO
    fen: str | None = None           # MISE EN CONDITION : position de départ libre (validée côté serveur)


class ChessVoice(BaseModel):
    text: str
    kind: str = "normal"
    persona: str | None = None       # « eto » : voix du coach, même pendant un duel contre E.N.O.S.


class EmbedRect(BaseModel):
    x: float
    y: float
    w: float
    h: float
    shown: bool = True


class ChessMove(BaseModel):
    uci: str
    promotion: str | None = None


def _chs(fn, *a):
    try:
        return fn(*a)
    except nasko_chess.ChessError as e:
        raise HTTPException(400, str(e))


@app.get("/api/chess/state", dependencies=_LOCAL)
def chess_state():
    return nasko_chess.current()


@app.post("/api/chess/new", dependencies=_LOCAL)
def chess_new(b: ChessNew):
    return _chs(nasko_chess.new_game, "b" if b.color == "b" else "w", max(1, min(100, b.power)), b.mode if b.mode in ("coach", "speedrun", "titans", "boss") else "enos", b.elo, b.fen, b.challenger, b.opponent)


def _push_arrows(c):
    """Flèches de l'explication d'ETO sur le plateau Godot. Les flèches « timed » (ancrées sur les phrases) sont envoyées une à une par l'interface, au moment où la voix les prononce."""
    if c and c.get("arrows") and not c.get("timed"):
        nasko_chessbridge.arrows(c["arrows"], max(4.0, min(14.0, 2.0 + len(c.get("text", "")) * 0.075)))


class SrStep(BaseModel):
    voice: bool = True
    defer: bool = False              # true : l'animation du coup est retenue jusqu'à /api/chess/stage {release: true} (ETO annonce son coup avant qu'il ne se joue)


class Stage(BaseModel):
    arrows: list[dict] = []
    secs: float = 7.0
    append: bool = True
    say: str | None = None
    release: bool = False


@app.post("/api/chess/stage", dependencies=_LOCAL)
def chess_stage(b: Stage):
    """Régie du plateau Godot, pilotée par l'interface au rythme de la VOIX : flèches ajoutées une à une, sous-titre, libération de l'animation du coup retenu."""
    if b.release:
        nasko_chess.release_deferred()
    if b.arrows:
        nasko_chessbridge._send({"t": "arrows", "list": [{k: a.get(k) for k in ("from", "to", "kind", "knight") if a.get(k) is not None} for a in b.arrows[:6]],
                                 "secs": max(2.0, min(20.0, b.secs)), "append": b.append})
    if b.say and nasko_persona.current() == "eto":
        nasko_chessbridge.say(b.say[:600], "normal")
    return {"ok": True}


@app.post("/api/chess/speedrun/step", dependencies=_LOCAL)
def chess_speedrun_step(b: SrStep):
    """Un demi-coup du SPEEDRUN (ETO contre le bot) + commentaire d'ETO déjà parlé (audio prêt) ; le plateau s'anime au retour."""
    cfg = load_config()

    def tts(spoken, key=None):
        if not b.voice:
            return None
        cached = nasko_cache.audio_for(key)                              # audio déjà mémorisé pour cette situation : aucun appel ElevenLabs
        if cached:
            return "/api/tts/" + cached
        if not (cfg.get("tts_dynamic", True) and nasko_eleven.configured(cfg, "eto")):
            return None
        try:
            p = nasko_eleven.synthesize(spoken, cfg, "eto")
        except nasko_eleven.ElevenError as e:
            log.warning("TTS speedrun : %s", e)
            return None
        name = nasko_cache.store_audio(key, p) if key else None
        return "/api/tts/" + (name or os.path.splitext(os.path.basename(p))[0])
    out = _chs(nasko_chess.speedrun_step, tts, b.defer)
    c = out.get("coach")
    if c and not b.defer and nasko_persona.current(cfg) == "eto":
        nasko_chessbridge.say(c["text"], "normal")                    # sous-titre + visage qui parle sur le plateau Godot (mode différé : l'interface le déclenche avec la voix)
    _push_arrows(c)
    return out


# --- LE CHOC DES TITANS : E.N.O.S. vs ETO (spectateur). Chaque réplique est synthétisée avec la VOIX de son locuteur : E.N.O.S. (grave, lente), ETO (rapide, audio tags).
_TTS_NOTICE = {"msg": ""}


def _titans_tts(voice):
    cfg = load_config()
    _TTS_NOTICE["msg"] = ""

    def tts(spoken, persona):
        if not voice or not (cfg.get("tts_dynamic", True) and nasko_eleven.configured(cfg, persona)):
            return None
        try:
            p = nasko_eleven.synthesize(spoken, cfg, persona)               # E.N.O.S. : sa clé + deepen() au service ; ETO : sa clé, eleven_v3, accélérée
        except nasko_eleven.ElevenError as e:
            log.warning("TTS Titans (%s) : %s", persona, e)
            _TTS_NOTICE["msg"] = str(e)                                      # l'interface bascule sur la voix du navigateur et prévient l'utilisateur
            return None
        return "/api/tts/" + os.path.splitext(os.path.basename(p))[0]
    return tts


class TiStep(BaseModel):
    voice: bool = True


class TiEvent(BaseModel):
    event: str = "start"             # start : E.N.O.S. ouvre, ETO réplique · end : bilan croisé
    voice: bool = True


class TiSpeak(BaseModel):
    persona: str
    text: str


@app.post("/api/chess/titans/step", dependencies=_LOCAL)
def chess_titans_step(b: TiStep):
    """Un demi-coup du match + la guerre des commentaires (répliques déjà synthétisées) ; le plateau s'anime au retour."""
    out = _chs(nasko_chess.titans_step, _titans_tts(b.voice))
    out["tts_notice"] = _TTS_NOTICE["msg"]
    return out


@app.post("/api/chess/titans/event", dependencies=_LOCAL)
def chess_titans_event(b: TiEvent):
    if b.event not in ("start", "end"):
        raise HTTPException(400, "événement inconnu")
    out = _chs(nasko_chess.titans_event, b.event, _titans_tts(b.voice))
    out["tts_notice"] = _TTS_NOTICE["msg"]
    return out


# --- LE BOSS FINAL : E.N.O.S. et/ou ETO contre STOCKFISH (muet : il annonce son coup sur le plateau). Mêmes voix et même mécanique que le Choc des Titans.
@app.post("/api/chess/boss/step", dependencies=_LOCAL)
def chess_boss_step(b: TiStep):
    """Un demi-coup du combat (le boss annonce son coup ~1,7 s avant de le jouer) + répliques déjà synthétisées des challengers."""
    out = _chs(nasko_chess.boss_step, _titans_tts(b.voice))
    out["tts_notice"] = _TTS_NOTICE["msg"]
    return out


@app.post("/api/chess/boss/event", dependencies=_LOCAL)
def chess_boss_event(b: TiEvent):
    if b.event not in ("start", "end"):
        raise HTTPException(400, "événement inconnu")
    out = _chs(nasko_chess.boss_event, b.event, _titans_tts(b.voice))
    out["tts_notice"] = _TTS_NOTICE["msg"]
    return out


@app.post("/api/chess/titans/speak", dependencies=_LOCAL)
def chess_titans_speak(b: TiSpeak):
    """Appelé par l'interface JUSTE AVANT que la voix démarre : bascule instantanée de la personnalité (œil rouge 3D ou visage ETO) sur le plateau Godot et le widget de bureau,
    puis sous-titre. Réservé au match Titans en cours."""
    st = nasko_chess.current()
    if not (st.get("active") and st.get("mode") in ("titans", "boss")):
        raise HTTPException(409, "Aucun match Titans / combat de boss en cours.")
    if b.persona not in ("enos", "eto"):
        raise HTTPException(400, "Personnalité inconnue.")
    if nasko_persona.current() != b.persona:
        nasko_persona.set_current(b.persona)
        nasko_chessbridge.push_persona(b.persona)
        nasko_pet.set_persona(b.persona)
    nasko_chessbridge.say(b.text[:600], "normal")
    return {"ok": True}


class ChessCoach(BaseModel):
    event: str = "turn"            # turn : commentaire des derniers coups · start : accueil · end : bilan


@app.post("/api/chess/coach", dependencies=_LOCAL)
def chess_coach(b: ChessCoach):
    """Commentaire pédagogique d'ETO (texte + balises audio). La voix est demandée ensuite à /api/chess/voice avec persona « eto »."""
    if b.event in ("start", "end"):
        c = _chs(nasko_chess.coach_event, b.event)
        _push_arrows(c)
        return c
    c = _chs(nasko_chess.coach_turn)
    _push_arrows(c)
    return {"coach": c}


class ChessDecision(BaseModel):
    choice: str


class ChessTrash(BaseModel):
    text: str
    guest: bool = False              # voix de l'invité Discord (écoute Discord) : ETO s'adresse directement à lui


class ChessTheme(BaseModel):
    name: str


# --- MISE EN CONDITION : position libre, analyse avec ETO, puis on réveille E.N.O.S. ou ETO pour la jouer (démarrage : POST /api/chess/new avec `fen`)
class SetupPos(BaseModel):
    board: dict[str, str] = {}
    turn: str = "w"
    castling: str = ""
    fen: str | None = None
    side: str = "w"                  # camp de l'élève (pour le point de vue de l'analyse)


class SetupMoves(SetupPos):
    moves: str = ""


class SetupAsk(SetupPos):
    question: str = ""


@app.post("/api/chess/setup/check", dependencies=_LOCAL)
def chess_setup_check(b: SetupPos):
    return nasko_chess.setup_check(b.model_dump())


@app.post("/api/chess/setup/moves", dependencies=_LOCAL)
def chess_setup_moves(b: SetupMoves):
    return _chs(nasko_chess.setup_play, b.model_dump(), b.moves)


@app.post("/api/chess/setup/ask", dependencies=_LOCAL)
def chess_setup_ask(b: SetupAsk):
    """Question libre à ETO sur la position posée. Synchrone (Stockfish ~1 s + LLM) : exécuté dans le pool de threads de FastAPI."""
    return _chs(nasko_chess.setup_ask, b.model_dump(), b.question)


@app.post("/api/chess/decision", dependencies=_LOCAL)
def chess_decision(b: ChessDecision):
    return _chs(nasko_chess.decide, "takeback" if b.choice == "takeback" else "continue")


@app.post("/api/chess/trash", dependencies=_LOCAL)
def chess_trash(b: ChessTrash):
    r = _chs(nasko_chess.trash, b.text, b.guest)
    _push_arrows(r)
    return r


# --- ÉCOUTE DISCORD : audio de sortie du PC (loopback WASAPI) -> Whisper -> ETO répond à l'invité. Réservé au PC local.
class DiscordStart(BaseModel):
    mix_mic: bool = False            # fusionner aussi le micro du PC


class DiscordMute(BaseModel):
    secs: float = 0.0


# --- TABLEAU DE BORD SYSTÈME : profils de performance, Turbo Boost, préférence énergie (powercfg) + capteurs. Tout est réservé à ce PC.
class SysProfile(BaseModel):
    profile: str
    create_if_missing: bool = False


class SysTurbo(BaseModel):
    enabled: bool


class SysEpp(BaseModel):
    value: int | None = None
    preset: str | None = None


def _sys(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except nasko_sysctl.SysError as e:
        raise HTTPException(409, str(e))


def _sys_forced():
    return load_config().get("sysctl_profiles") or {}


@app.get("/api/sys/state", dependencies=_LOCAL)
def sys_state():
    return nasko_sysctl.state(_sys_forced())


@app.post("/api/sys/profile", dependencies=_LOCAL)
def sys_profile(b: SysProfile):
    _sys(nasko_sysctl.set_profile, b.profile, _sys_forced(), b.create_if_missing)
    return nasko_sysctl.state(_sys_forced())


@app.post("/api/sys/turbo", dependencies=_LOCAL)
def sys_turbo(b: SysTurbo):
    _sys(nasko_sysctl.set_turbo, b.enabled)
    return nasko_sysctl.state(_sys_forced())


# --- historique (graphes), diagnostic RAM / stockage / GPU / CPU, analyse Godot : tout en LECTURE SEULE, réservé à ce PC
class GodotProject(BaseModel):
    project: str | None = None


@app.get("/api/sys/history", dependencies=_LOCAL)
def sys_history(seconds: int = 300):
    return nasko_sysmon.sampler.history(seconds)


@app.post("/api/sys/diag", dependencies=_LOCAL)
def sys_diag():
    return nasko_diag.run()


@app.post("/api/sys/storage/scan", dependencies=_LOCAL)
def sys_storage_scan():
    return {"started": nasko_diag.storage_job.start(), **nasko_diag.storage_job.status()}


@app.get("/api/sys/storage/scan", dependencies=_LOCAL)
def sys_storage_status():
    return nasko_diag.storage_job.status()


@app.get("/api/sys/godot/projects", dependencies=_LOCAL)
def sys_godot_projects():
    return {"projects": nasko_godotdiag.projects(), "godot": nasko_godotdiag.godot_exe()}


@app.get("/api/sys/godot/live", dependencies=_LOCAL)
def sys_godot_live():
    return nasko_godotdiag.live()


@app.post("/api/sys/godot/analyze", dependencies=_LOCAL)
def sys_godot_analyze(b: GodotProject):
    known = {os.path.normcase(p["path"]) for p in nasko_godotdiag.projects()}
    if b.project and os.path.normcase(os.path.normpath(b.project)) not in known:
        raise HTTPException(400, "projet inconnu : choisissez-en un dans la liste")
    return {"started": nasko_godotdiag.analyze_job.start(b.project), **nasko_godotdiag.analyze_job.status()}


@app.get("/api/sys/godot/analyze", dependencies=_LOCAL)
def sys_godot_status():
    return nasko_godotdiag.analyze_job.status()


@app.post("/api/sys/epp", dependencies=_LOCAL)
def sys_epp(b: SysEpp):
    _sys(nasko_sysctl.set_epp, b.value, b.preset)
    return nasko_sysctl.state(_sys_forced())


# --- API CONTROL PANEL : quotas et consommation des clés API (aucune clé n'est renvoyée) ; chaque carte porte son propre état (ok / hors ligne / erreur de clé)
@app.get("/api/apimon", dependencies=_LOCAL)
def apimon_snapshot(force: int = 0):
    try:
        cards = nasko_apimon.snapshot(bool(force))
    except Exception as e:                                           # noqa: BLE001 — le panneau ne doit jamais planter
        log.warning("API Control Panel : %s", e)
        return {"cards": [], "error": "Impossible de lire les quotas : " + e.__class__.__name__, "at": time.time()}
    return {"cards": cards, "error": "", "at": time.time()}


@app.post("/api/discord/start", dependencies=_LOCAL)
def discord_start(b: DiscordStart):
    try:
        dev = nasko_loopback.listener.start(load_config, nasko_chess.recent_lines, b.mix_mic)
    except RuntimeError as e:
        return {"ok": False, "error": str(e)}
    nasko_persona.set_guest(True)                                    # les prompts d'ETO / d'E.N.O.S. savent qu'un invité distant joue
    return {"ok": True, "device": dev}


@app.post("/api/discord/stop", dependencies=_LOCAL)
def discord_stop():
    nasko_loopback.listener.stop()
    nasko_persona.set_guest(False)
    return {"ok": True}


@app.get("/api/discord/poll", dependencies=_LOCAL)
def discord_poll(after: int = 0):
    return nasko_loopback.listener.poll(after)


@app.post("/api/discord/mute", dependencies=_LOCAL)
def discord_mute(b: DiscordMute):
    nasko_loopback.listener.mute(min(60.0, max(0.0, b.secs)))      # ETO parle : sa voix sort dans le même casque
    return {"ok": True}


@app.get("/api/chess/themes", dependencies=_LOCAL)
def chess_themes():
    return {"themes": nasko_chess.themes(), "current": nasko_chess.get_theme()}


@app.post("/api/chess/theme", dependencies=_LOCAL)
def chess_set_theme(b: ChessTheme):
    return _chs(nasko_chess.set_theme, b.name)


@app.get("/api/chess/boards", dependencies=_LOCAL)
def chess_boards():
    return {"boards": nasko_chess.boards(), "current": nasko_chess.get_board()}


@app.post("/api/chess/board", dependencies=_LOCAL)
def chess_set_board(b: ChessTheme):
    return _chs(nasko_chess.set_board, b.name)


class VisualGen(BaseModel):
    mood: str = ""
    hint: str = ""


class VisualAnger(BaseModel):
    level: float = 0.0


@app.get("/api/chess/visual", dependencies=_LOCAL)
def chess_visual():
    return {"theme": nasko_visualtheme.current()}


class VisualPreset(BaseModel):
    name: str


@app.get("/api/chess/visual/presets", dependencies=_LOCAL)
def chess_visual_presets():
    cur = nasko_visualtheme.current()
    return {"presets": [{"id": k, "label": v["theme_id"]} for k, v in nasko_visualtheme.PRESETS.items()], "current": cur["theme_id"] if cur else ""}


@app.post("/api/chess/visual/preset", dependencies=_LOCAL)
def chess_visual_preset(b: VisualPreset):
    if b.name not in nasko_visualtheme.PRESETS:
        raise HTTPException(400, "Style inconnu.")
    return {"theme": nasko_visualtheme.apply(nasko_visualtheme.PRESETS[b.name])}


@app.post("/api/chess/visual/generate", dependencies=_LOCAL)
def chess_visual_generate(b: VisualGen):
    """E.N.O.S. compose son thème (LLM -> JSON validé) et Godot le joue en direct. Synchrone : exécuté dans le pool de threads de FastAPI."""
    return nasko_visualtheme.generate(b.mood, b.hint)


@app.post("/api/chess/visual/anger", dependencies=_LOCAL)
def chess_visual_anger(b: VisualAnger):
    return nasko_visualtheme.set_anger(b.level)


@app.post("/api/chess/visual/reset", dependencies=_LOCAL)
def chess_visual_reset():
    return nasko_visualtheme.reset()


@app.get("/static/badges/{name}")
def static_badge(name: str):
    if not re.fullmatch(r"[a-z]{3,12}\.png", name):
        raise HTTPException(404)
    p = resource_path("static", "badges", name)
    if not os.path.isfile(p):
        raise HTTPException(404)
    return FileResponse(p, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


@app.post("/api/chess/resign", dependencies=_LOCAL)
def chess_resign():
    return _chs(nasko_chess.resign)


@app.post("/api/chess/voice", dependencies=_LOCAL)
def chess_voice(b: ChessVoice):
    """Synthèse ElevenLabs d'une provocation. Uniquement les phrases des banques d'E.N.O.S. (jamais de texte libre)."""
    if not nasko_chess.taunt_allowed(b.text):
        raise HTTPException(400, "phrase inconnue")
    cfg = load_config()
    persona = "eto" if b.persona == "eto" else nasko_persona.current(cfg)
    show = persona == nasko_persona.current(cfg)                  # sous-titre du plateau Godot : seulement pour la personnalité active
    ckey = nasko_chess.key_of(b.text) if persona == "eto" else None
    cached = nasko_cache.audio_for(ckey)
    if cached:                                                    # même situation déjà commentée : audio relu depuis le cache, zéro appel ElevenLabs
        if show:
            nasko_chessbridge.say(b.text, b.kind)
        return {"text": b.text, "audio": "/api/tts/" + cached, "cached": True}
    if not (cfg.get("tts_dynamic", True) and nasko_eleven.configured(cfg, persona)):
        if show:
            nasko_chessbridge.say(b.text, b.kind)
        return {"text": b.text, "audio": None}
    try:
        p = nasko_eleven.synthesize(nasko_chess.spoken_for(b.text), cfg, persona)       # ETO : version avec Audio Tags ; l'écran garde le texte propre
    except nasko_eleven.ElevenError as e:
        log.warning("TTS provocation : %s", e)
        if show:
            nasko_chessbridge.say(b.text, b.kind)
        return {"text": b.text, "audio": None, "notice": str(e)}
    if show:
        nasko_chessbridge.say(b.text, b.kind)                     # le sous-titre démarre avec la voix
    name = nasko_cache.store_audio(ckey, p) if ckey else None
    return {"text": b.text, "audio": "/api/tts/" + (name or os.path.splitext(os.path.basename(p))[0])}


@app.get("/api/chess/cache", dependencies=_LOCAL)
def chess_cache_stats():
    """Économie d'API : entrées mémorisées, succès / échecs du cache des commentaires d'ETO."""
    return nasko_cache.stats()


# --- plateau externe encastré (fenêtre du jeu rattachée au conteneur #cs-embed ; aucune fenêtre visible)
@app.get("/api/chess/embed", dependencies=_LOCAL)
def chess_embed_status():
    return nasko_embed.status()


@app.post("/api/chess/embed/start", dependencies=_LOCAL)
def chess_embed_start():
    try:
        nasko_embed.start(port=state["port"])
    except nasko_embed.EmbedError as e:
        raise HTTPException(400, str(e))
    return nasko_embed.status()


@app.post("/api/chess/embed/rect", dependencies=_LOCAL)
def chess_embed_rect(b: EmbedRect):
    nasko_embed.set_rect(b.x, b.y, b.w, b.h, b.shown)
    return nasko_embed.status()


@app.post("/api/chess/embed/stop", dependencies=_LOCAL)
def chess_embed_stop():
    nasko_embed.stop()
    return nasko_embed.status()


@app.post("/api/chess/move", dependencies=_LOCAL)
def chess_move(b: ChessMove):
    if not re.fullmatch(r"[a-h][1-8][a-h][1-8][qrbn]?", b.uci) or (b.promotion or "q") not in ("q", "r", "b", "n"):
        raise HTTPException(400, "coup invalide")
    return _chs(nasko_chess.move, b.uci, b.promotion)


@app.get("/api/chess/review", dependencies=_LOCAL)
def chess_review():
    return _chs(nasko_chess.current_review)


@app.get("/api/chess/history", dependencies=_LOCAL)
def chess_history():
    return {"games": nasko_chess.history(), "max": nasko_chess.HIST_MAX}


@app.get("/api/chess/history/{game_id}/position", dependencies=_LOCAL)
def chess_history_position(game_id: str, ply: int = 0):
    if not re.fullmatch(r"[0-9a-f]{10}", game_id):
        raise HTTPException(400, "identifiant invalide")
    return _chs(nasko_chess.position_at, game_id, ply)


# --- SUPER ENOS : entraînement en arrière-plan (LLM) contre E.N.O.S., Stockfish et ETO. Le thread vit dans ce serveur : fermer la fenêtre ne l'arrête pas.
class TrainStart(BaseModel):
    opponents: list[str] = []
    games: int = 0               # 0 : sans fin, jusqu'à l'arrêt
    secs: float = 0.6            # réflexion par coup
    llm: bool = True
    threads: int = 1


class TrainAuto(BaseModel):
    on: bool = False


@app.get("/api/train/status", dependencies=_LOCAL)
def train_status():
    return nasko_train.status()


@app.post("/api/train/start", dependencies=_LOCAL)
def train_start(b: TrainStart):
    return _chs(nasko_train.start, b.opponents, b.games, b.secs, b.llm, b.threads)


@app.post("/api/train/stop", dependencies=_LOCAL)
def train_stop():
    return nasko_train.stop()


@app.post("/api/train/reset", dependencies=_LOCAL)
def train_reset():
    return _chs(nasko_train.reset)


@app.post("/api/train/autostart", dependencies=_LOCAL)
def train_autostart(b: TrainAuto):
    return nasko_train.set_autostart(b.on)


@app.post("/api/chess/install", dependencies=_LOCAL)
def chess_install():
    _chs(nasko_chess.install_stockfish)
    return nasko_chess.current()


# --- WIDGET DE BUREAU « Œil d'E.N.O.S. » (Godot flottant)
@app.get("/api/pet/status", dependencies=_LOCAL)
def pet_status():
    return nasko_pet.status()


@app.post("/api/pet/start", dependencies=_LOCAL)
def pet_start():
    try:
        nasko_pet.start(port=state["port"])
    except nasko_pet.PetError as e:
        raise HTTPException(400, str(e))
    return nasko_pet.status()


# ----------------------------------------------------------------------------- GAMING : Auto-Clipper, Babel Voice, Anti-Tilt, BRB
def _tilt_speaker(raw):
    """Intervention d'ETO : dite par l'Œil (bulle + voix selon les options) s'il est affiché, sinon voix par défaut du module."""
    import re
    if not nasko_pet.comment(re.sub(r"\[[^\]]*\]", "", raw).strip() or raw, persona="eto"):
        nasko_tilt._default_speaker(load_config)(raw)


def _tilt_boot():
    nasko_tilt.get()._speaker = _tilt_speaker


def _gaming(fn, *a, **k):
    try:
        return fn(*a, **k)
    except nasko_babel.BabelError as e:
        raise HTTPException(400, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


class GamingConfig(BaseModel):
    values: dict


@app.get("/api/clipper/status", dependencies=_LOCAL)
def clipper_status():
    return nasko_clipper.status()


@app.get("/api/clipper/config", dependencies=_LOCAL)
def clipper_config():
    return nasko_clipper.config()


@app.post("/api/clipper/config", dependencies=_LOCAL)
def clipper_set_config(b: GamingConfig):
    return _gaming(nasko_clipper.set_config, b.values)


class ClipTrigger(BaseModel):
    label: str = "manuel"


@app.post("/api/clipper/trigger", dependencies=_LOCAL)
def clipper_trigger(b: ClipTrigger | None = None):
    return nasko_clipper.trigger((b.label if b else "manuel")[:40])


@app.get("/api/clipper/clips", dependencies=_LOCAL)
def clipper_clips():
    return {"items": nasko_clipper.list_clips()}


@app.get("/api/clipper/file/{name}", dependencies=_LOCAL)
def clipper_file(name: str):
    p = _gaming(nasko_clipper.clip_path, name)
    if not p:
        raise HTTPException(404, "Clip introuvable.")
    return FileResponse(p, media_type="video/mp4" if p.endswith(".mp4") else "image/jpeg")


@app.delete("/api/clipper/clips/{name}", dependencies=_LOCAL)
def clipper_delete(name: str):
    return {"ok": bool(_gaming(nasko_clipper.delete_clip, name))}


# Smart AFK : simule souris/clavier (micro-mouvements, ZQSD) avec kill-switch absolu. Réservé à ce PC, jamais lancé sans action explicite (Palette Ctrl+K).
@app.get("/api/afk/status", dependencies=_LOCAL)
def afk_status():
    return nasko_afk.afk.status()


@app.post("/api/afk/{action}", dependencies=_LOCAL)
def afk_action(action: str):
    if action not in ("start", "stop", "toggle"):
        raise HTTPException(404, "Action inconnue")
    try:
        st = {"start": nasko_afk.afk.start, "stop": nasko_afk.afk.stop, "toggle": nasko_afk.afk.toggle}[action]()
    except nasko_afk.AFKError as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, **st}


@app.get("/api/babel/status", dependencies=_LOCAL)
def babel_status():
    return nasko_babel.status()


@app.get("/api/babel/config", dependencies=_LOCAL)
def babel_config():
    return nasko_babel.config()


@app.post("/api/babel/config", dependencies=_LOCAL)
def babel_set_config(b: GamingConfig):
    return _gaming(nasko_babel.set_config, b.values)


@app.get("/api/babel/devices", dependencies=_LOCAL)
def babel_devices():
    return nasko_babel.list_devices()


@app.get("/api/babel/voices", dependencies=_LOCAL)
def babel_voices():
    return {"items": _gaming(nasko_babel.list_voices)}


@app.post("/api/babel/start", dependencies=_LOCAL)
def babel_start():
    return _gaming(nasko_babel.start)


@app.post("/api/babel/stop", dependencies=_LOCAL)
def babel_stop():
    nasko_babel.stop()
    return nasko_babel.status()


class BabelSay(BaseModel):
    text: str


@app.post("/api/babel/say", dependencies=_LOCAL)
def babel_say(b: BabelSay):
    return _gaming(nasko_babel.say, b.text[:500])


@app.post("/api/babel/ptt/{state}", dependencies=_LOCAL)
def babel_ptt(state: str):
    (nasko_babel.ptt_down if state == "down" else nasko_babel.ptt_up)()
    return {"ok": True}


class BabelClone(BaseModel):
    name: str = "Ma voix"
    seconds: int = 45
    consent: bool = False


@app.post("/api/babel/clone", dependencies=_LOCAL)
def babel_clone(b: BabelClone):
    """Enregistre un échantillon au micro puis crée le clone. Refusé sans l'attestation explicite « c'est ma propre voix » (vérifiée AVANT d'enregistrer)."""
    if b.consent is not True:
        raise HTTPException(400, "Le clone vocal doit être celui de ta propre voix : coche l'attestation pour continuer.")
    wav = _gaming(nasko_babel.record_sample, b.seconds)
    return _gaming(nasko_babel.create_clone, wav, b.name[:60], True)


@app.get("/api/tilt/status", dependencies=_LOCAL)
def tilt_status():
    return nasko_tilt.status()


@app.get("/api/tilt/config", dependencies=_LOCAL)
def tilt_config():
    return nasko_tilt.config()


@app.post("/api/tilt/config", dependencies=_LOCAL)
def tilt_set_config(b: GamingConfig):
    r = _gaming(nasko_tilt.set_config, b.values)
    if r.get("tilt_enabled"):
        _tilt_boot()
        nasko_tilt.start()
    elif "tilt_enabled" in b.values:
        nasko_tilt.stop()
    return r


@app.post("/api/tilt/death", dependencies=_LOCAL)
def tilt_death():
    return nasko_tilt.mark_death()


@app.post("/api/tilt/test", dependencies=_LOCAL)
def tilt_test():
    _tilt_boot()
    return nasko_tilt.test_intervention()


@app.post("/api/tilt/reset", dependencies=_LOCAL)
def tilt_reset():
    return nasko_tilt.reset()


@app.get("/api/tilt/replays", dependencies=_LOCAL)
def tilt_replays():
    return {"items": nasko_tilt.replays()}


@app.get("/api/tilt/replay/{name}", dependencies=_LOCAL)
def tilt_replay(name: str):
    p = nasko_tilt.replay_path(name)
    if not p:
        raise HTTPException(404, "Replay introuvable.")
    return FileResponse(p, media_type="video/mp4")


class BrbStart(BaseModel):
    message: str = ""
    minutes: int = 0


@app.get("/api/brb/status", dependencies=_LOCAL)
def brb_status():
    return nasko_brb.status()


@app.post("/api/brb/start", dependencies=_LOCAL)
def brb_start(b: BrbStart | None = None):
    b = b or BrbStart()
    return nasko_brb.start(b.message, b.minutes)


@app.post("/api/brb/back", dependencies=_LOCAL)
def brb_back():
    return nasko_brb.back()


# ----------------------------------------------------------------------------- DÉPÔT INTRANET : Git « zéro friction », Forge, sujets PDF, entraînements, Dépôt Shell, terminal
def _depot(fn, *a, **k):
    errs = (nasko_depot.DepotError, nasko_depot_git.GitError, nasko_depot_study.StudyError, nasko_depot_forge.ForgeError, nasko_depot_term.TermError, ValueError, nasko_devmanager.DevError)
    try:
        return fn(*a, **k)
    except errs as e:
        raise HTTPException(400, str(e))


def _drepo(repo):
    return _depot(nasko_depot.git_repo, repo)


@app.get("/api/depot/state", dependencies=_LOCAL)
def depot_state():
    st = _depot(nasko_depot.state)
    st["term"] = nasko_depot_term.backends(load_config())
    return st


class DepotRepo(BaseModel):
    name: str = ""


@app.post("/api/depot/repo", dependencies=_LOCAL)
def depot_repo(b: DepotRepo):
    _depot(nasko_depot.remember_repo, b.name)
    return {"ok": True}


class DepotClone(BaseModel):
    url: str
    name: str = ""


@app.post("/api/depot/clone", dependencies=_LOCAL)
def depot_clone(b: DepotClone):
    return _depot(nasko_depot.clone, b.url.strip(), b.name.strip())


@app.get("/api/depot/git/status", dependencies=_LOCAL)
def depot_git_status(repo: str):
    return _depot(_drepo(repo).status)


@app.get("/api/depot/git/log", dependencies=_LOCAL)
def depot_git_log(repo: str, n: int = 30):
    return {"items": _depot(_drepo(repo).log, max(1, min(n, 200)))}


@app.get("/api/depot/git/branches", dependencies=_LOCAL)
def depot_git_branches(repo: str):
    return _depot(_drepo(repo).branches)


@app.get("/api/depot/git/tags", dependencies=_LOCAL)
def depot_git_tags(repo: str):
    return {"items": _depot(_drepo(repo).tags)}


@app.get("/api/depot/git/next-tag", dependencies=_LOCAL)
def depot_git_next_tag(repo: str, prefix: str = ""):
    return {"tag": _depot(_drepo(repo).next_tag, prefix)}


class DepotGit(BaseModel):
    repo: str
    paths: list[str] = []
    message: str = ""
    allow_empty: bool = False
    rebase: bool = False
    folder: str = "."
    tag: str = ""
    push: bool = True
    action: str = ""
    name: str = ""
    start_point: str | None = None
    force: bool = False
    no_ff: bool = False
    remote: bool = False


@app.post("/api/depot/git/add", dependencies=_LOCAL)
def depot_git_add(b: DepotGit):
    _depot(_drepo(b.repo).add, b.paths)
    return {"ok": True}


@app.post("/api/depot/git/commit", dependencies=_LOCAL)
def depot_git_commit(b: DepotGit):
    return _depot(_drepo(b.repo).commit, b.message, b.allow_empty)


@app.post("/api/depot/git/push", dependencies=_LOCAL)
def depot_git_push(b: DepotGit):
    return _depot(_drepo(b.repo).push)


@app.post("/api/depot/git/pull", dependencies=_LOCAL)
def depot_git_pull(b: DepotGit):
    return _depot(_drepo(b.repo).pull, b.rebase)


@app.post("/api/depot/git/fetch", dependencies=_LOCAL)
def depot_git_fetch(b: DepotGit):
    return _depot(_drepo(b.repo).fetch)


@app.post("/api/depot/git/send", dependencies=_LOCAL)
def depot_git_send(b: DepotGit):
    """Bouton ENVOYER : git add <dossier> → commit → tag annoté <nom>V<n+1> → push --follow-tags."""
    return _depot(_drepo(b.repo).send, b.folder or ".", b.message, b.tag, b.push, b.allow_empty)


@app.post("/api/depot/git/branch", dependencies=_LOCAL)
def depot_git_branch(b: DepotGit):
    g = _drepo(b.repo)
    if b.action == "create":
        return _depot(g.create_branch, b.name, b.start_point, True)
    if b.action == "switch":
        return _depot(g.switch, b.name)
    if b.action == "delete":
        return _depot(g.delete_branch, b.name, b.force)
    if b.action == "merge":
        return _depot(g.merge, b.name, b.no_ff)
    if b.action == "merge_abort":
        return _depot(g.merge_abort)
    raise HTTPException(400, "Action de branche inconnue.")


@app.post("/api/depot/git/tag/delete", dependencies=_LOCAL)
def depot_git_tag_delete(b: DepotGit):
    return _depot(_drepo(b.repo).delete_tag, b.name, b.remote)


@app.get("/api/depot/fs/tree", dependencies=_LOCAL)
def depot_fs_tree(repo: str, path: str = "."):
    return {"items": _depot(nasko_depot.fs_tree, repo, path)}


@app.get("/api/depot/fs/file", dependencies=_LOCAL)
def depot_fs_file(repo: str, path: str):
    return _depot(nasko_depot.fs_read, repo, path)


class DepotFile(BaseModel):
    repo: str
    path: str
    content: str = ""
    kind: str = "file"


@app.post("/api/depot/fs/file", dependencies=_LOCAL)
def depot_fs_write(b: DepotFile):
    return {"ok": bool(_depot(nasko_depot.fs_write, b.repo, b.path, b.content))}


@app.post("/api/depot/fs/create", dependencies=_LOCAL)
def depot_fs_create(b: DepotFile):
    return {"ok": bool(_depot(nasko_depot.fs_create, b.repo, b.path, b.kind))}


@app.get("/api/depot/forge", dependencies=_LOCAL)
def depot_forge(force: int = 0):
    """Rendus / piscines de la Forge, lus dans son lien d'agenda .ics (échéances absolues pour le compte à rebours)."""
    r = nasko_depot_forge.forge_fetch(force=bool(force))
    r["config"] = nasko_depot_forge.forge_status()
    return r


class DepotForgeCfg(BaseModel):
    ics: str | None = None
    refresh_s: int | None = None


@app.post("/api/depot/forge/config", dependencies=_LOCAL)
def depot_forge_config(b: DepotForgeCfg):
    return _depot(nasko_depot_forge.forge_set_config, b.model_dump(exclude_none=True))


@app.post("/api/depot/forge/clear", dependencies=_LOCAL)
def depot_forge_clear():
    return nasko_depot_forge.forge_clear()


_PDF_MAX = 25 * 1024 * 1024


def _read_upload(f: UploadFile, limit=_PDF_MAX):
    data = f.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, "Fichier trop gros (25 Mo maximum).")
    return data


@app.post("/api/depot/subject/analyze", dependencies=_LOCAL)
def depot_subject_analyze(file: UploadFile = File(...), key: str = Form(...)):
    data = _read_upload(file)
    analysis = _depot(nasko_depot_study.analyze_subject, data=data, filename=file.filename or "sujet.pdf")
    return {"roadmap": _depot(nasko_depot_study.save_roadmap, key, analysis, file.filename or "")}


@app.get("/api/depot/roadmap", dependencies=_LOCAL)
def depot_roadmap(key: str):
    return {"roadmap": _depot(nasko_depot_study.get_roadmap, key)}


@app.delete("/api/depot/roadmap", dependencies=_LOCAL)
def depot_roadmap_delete(key: str):
    return {"ok": bool(_depot(nasko_depot_study.delete_roadmap, key))}


class DepotStep(BaseModel):
    key: str = ""
    step: str
    done: bool


@app.post("/api/depot/roadmap/step", dependencies=_LOCAL)
def depot_roadmap_step(b: DepotStep):
    return {"roadmap": _depot(nasko_depot_study.set_step, b.key, b.step, b.done)}


@app.get("/api/depot/trainings", dependencies=_LOCAL)
def depot_trainings():
    return {"items": nasko_depot_study.training_list()}


@app.post("/api/depot/trainings", dependencies=_LOCAL)
def depot_training_add(file: UploadFile = File(...), title: str = Form("")):
    data = _read_upload(file)
    return {"training": _depot(nasko_depot_study.training_add, data=data, filename=file.filename or "sujet.pdf", title=title.strip()[:120] or None)}


@app.get("/api/depot/trainings/{tid}", dependencies=_LOCAL)
def depot_training_get(tid: str):
    t = _depot(nasko_depot_study.training_get, tid)
    if not t:
        raise HTTPException(404, "Entraînement introuvable.")
    return {"training": t}


@app.delete("/api/depot/trainings/{tid}", dependencies=_LOCAL)
def depot_training_delete(tid: str):
    return {"ok": bool(_depot(nasko_depot_study.training_delete, tid))}


@app.post("/api/depot/trainings/{tid}/step", dependencies=_LOCAL)
def depot_training_step(tid: str, b: DepotStep):
    return {"training": _depot(nasko_depot_study.training_set_step, tid, b.step, b.done)}


class DepotAttempt(BaseModel):
    minutes: int | None = None
    note: str = ""


@app.post("/api/depot/trainings/{tid}/attempt", dependencies=_LOCAL)
def depot_training_attempt(tid: str, b: DepotAttempt):
    return _depot(nasko_depot_study.training_mark_attempt, tid, b.minutes, b.note[:300])


class DepotAsk(BaseModel):
    question: str
    step: str | None = None
    code: str = ""
    history: list[dict] = []


@app.post("/api/depot/trainings/{tid}/ask", dependencies=_LOCAL)
def depot_training_ask(tid: str, b: DepotAsk):
    return {"text": _depot(nasko_depot_study.tutor_ask, tid, b.question[:1500], b.step, b.history[-8:], b.code[:6000])}


@app.post("/api/depot/shell-drop", dependencies=_LOCAL)
def depot_shell_drop(file: UploadFile = File(...), repo: str = Form(...), target: str = Form("root"), overwrite: str = Form("")):
    """Dépôt Shell : un script .sh glissé est déposé à la racine du dépôt courant (ou dans son dossier parent), rendu exécutable, jamais lancé."""
    data = _read_upload(file, 1_000_000)
    if target not in ("root", "parent"):
        raise HTTPException(400, "Destination inconnue.")
    r = _depot(nasko_depot_git.drop_shell, _drepo(repo), os.path.basename(file.filename or ""), data, target, bool(overwrite))
    if not r.get("ok"):
        raise HTTPException(409, "Un fichier de ce nom existe déjà.")
    return r


class DepotClang(BaseModel):
    repo: str
    folder: str = ""


@app.post("/api/depot/inject_clang_format", dependencies=_LOCAL)
def depot_inject_clang_format(b: DepotClang):
    """Copie « clang-format » (racine de l'espace WSL) vers <dépôt>/.clang-format, en écrasant l'existant. Source fixe : rien n'est choisi par la requête."""
    return _depot(nasko_depot_git.inject_clang_format, _drepo(b.repo))


@app.post("/api/depot/format_c", dependencies=_LOCAL)
def depot_format_c(b: DepotClang):
    """`clang-format -i` sur les .c/.h du dossier cible (racine du dépôt si vide). Dossier validé, chemin résolu côté WSL, aucune commande fournie par la requête."""
    return _depot(nasko_depot_git.format_c, _drepo(b.repo), b.folder)


class DepotWorkspace(BaseModel):
    unc: str = ""


@app.get("/api/depot/workspace", dependencies=_LOCAL)
def depot_workspace_get():
    return nasko_devmanager.workspace_state()


@app.post("/api/depot/workspace", dependencies=_LOCAL)
def depot_workspace_set(b: DepotWorkspace):
    """Règle le dossier de travail WSL (\\\\wsl.localhost\\<distribution>\\home\\<toi>). Forme validée, existence vérifiée dans WSL, vide = dossier par défaut."""
    r = _dev(lambda cfg: nasko_devmanager.set_workspace(b.unc))
    nasko_depot_term.close_all()                          # un shell resté ouvert serait encore dans l'ancien dossier
    return r


@app.post("/api/depot/workspace/pick", dependencies=_LOCAL)
def depot_workspace_pick():
    """Bouton « Choisir le dossier d'espace de travail » : boîte de dialogue NATIVE (sur ce PC), puis enregistrement du dossier choisi. Rend la main quand la boîte est fermée."""
    r = _dev(lambda cfg: nasko_devmanager.pick_workspace())
    if not r.get("cancelled"):
        nasko_depot_term.close_all()                      # un shell resté ouvert serait encore dans l'ancien dossier
    return r


@app.post("/api/depot/workspace/detect", dependencies=_LOCAL)
def depot_workspace_detect():
    return _dev(lambda cfg: nasko_devmanager.detect_workspace())


class DepotTermReset(BaseModel):
    repo: str = ""


@app.post("/api/depot/terminal/reset", dependencies=_LOCAL)
def depot_terminal_reset(b: DepotTermReset):
    """PURGER TERMINAL : ferme de force les shells pty ouverts (arbre de processus entier, WSL compris). Le terminal neuf naît à la reconnexion du WebSocket /ws/depot-term.
    Vérifie d'abord qu'un nouveau terminal pourra démarrer, pour ne pas laisser l'utilisateur sans shell."""
    if b.repo:
        _depot(nasko_depot_term._check_repo, b.repo)
    info = nasko_depot_term.backends(load_config())
    if not (info.get("wsl") or info.get("local")):
        raise HTTPException(400, "Aucun terminal disponible sur cette machine : le shell actuel est conservé.")
    n = sum(1 for s in nasko_depot_term.list_sessions())
    nasko_depot_term.close_all()
    return {"ok": True, "closed": n}


@app.websocket("/ws/depot-term")
async def ws_depot_term(ws: WebSocket, repo: str = "", cols: int = 100, rows: int = 30):
    """Terminal Linux interactif (WSL / shell local) : octets bruts = frappes et sortie, JSON {"t":"resize"} / {"t":"exit"}. Authentification et profil : middlewares."""
    cfg = load_config()
    try:
        sess = nasko_depot_term.open_session("auto", repo or None, cols, rows, cfg, root=(nasko_depot.local_root(cfg) if nasko_depot.mode(cfg) == "local" else None))
    except nasko_depot_term.TermError as e:
        await ws.accept()
        await ws.send_text(json.dumps({"t": "error", "message": str(e)}, ensure_ascii=False))
        await ws.close()
        return
    await ws.accept()

    async def _send(x):
        if isinstance(x, (bytes, bytearray)):
            await ws.send_bytes(bytes(x))
        else:
            await ws.send_text(x)

    async def _recv():
        try:
            m = await ws.receive()
        except (WebSocketDisconnect, RuntimeError):
            return None
        if m.get("type") == "websocket.disconnect":
            return None
        return m.get("bytes") if m.get("bytes") is not None else m.get("text")

    try:
        await nasko_depot_term.pump(_send, _recv, sess)
    finally:
        sess.close()


class PetOptions(BaseModel):
    pet_voice: bool | None = None
    pet_bubble: bool | None = None
    pet_typing: bool | None = None


@app.get("/api/pet/options", dependencies=_LOCAL)
def pet_options():
    return nasko_pet.options()


@app.post("/api/pet/options", dependencies=_LOCAL)
def pet_set_options(b: PetOptions):
    return nasko_pet.set_options(b.model_dump(exclude_none=True))


@app.post("/api/pet/interrupt", dependencies=_LOCAL)
def pet_interrupt():
    nasko_pet.stop_voice()
    return {"ok": True}


class PetVacuum(BaseModel):
    dir: str = "auto"          # "auto" (vers l'autre écran) | "right" | "left"


@app.post("/api/pet/vacuum", dependencies=_LOCAL)
def pet_vacuum(b: PetVacuum | None = None):
    if not nasko_pet.status()["connected"]:
        raise HTTPException(409, "L'Œil de bureau n'est pas lancé (bouton ŒIL DE BUREAU).")
    nasko_pet.vacuum(b.dir if b else "auto")
    return {"ok": True}


@app.post("/api/pet/stop", dependencies=_LOCAL)
def pet_stop():
    nasko_pet.stop()
    return nasko_pet.status()


@app.get("/api/notify/poll", dependencies=_LOCAL)
def notify_poll(since: int = 0):
    """Fins de tâche récentes (l'interface joue la phrase réflexe ; la notification Windows est déjà partie)."""
    return {"events": nasko_notify.poll(since)}


# =============================================================================== AGENDA (Zeus + Moodle + tâches) et IA proactive — réservé à ce PC
class AgendaTask(BaseModel):
    title: str
    due: str = ""
    notes: str = ""
    duration_min: int = 0


class AgendaTaskPatch(BaseModel):
    title: str | None = None
    due: str | None = None
    notes: str | None = None
    done: bool | None = None
    duration_min: int | None = None


class EpitaConfig(BaseModel):
    zeus_ics_url: str | None = None
    moodle_ics_url: str | None = None
    moodle_base_url: str | None = None
    moodle_token: str | None = None


@app.get("/api/agenda/overview", dependencies=_LOCAL)
async def agenda_overview(days: int = 7, start: str | None = None, refresh: bool = False):
    try:
        return await nasko_agenda.overview(days, start, refresh)
    except ValueError:
        raise HTTPException(400, "date de début invalide (AAAA-MM-JJ)")


@app.get("/api/epita/agenda", dependencies=_LOCAL)
async def epita_agenda(refresh: bool = False):
    """Emploi du temps Zeus brut (tous les cours du fichier .ics)."""
    return await nasko_epita.fetch("zeus", None, refresh)


@app.get("/api/epita/moodle", dependencies=_LOCAL)
async def epita_moodle(refresh: bool = False):
    return await nasko_epita.fetch("moodle", None, refresh)


@app.get("/api/epita/config", dependencies=_LOCAL)
def epita_config_get():
    return nasko_epita.public_status()            # jamais les liens : ils contiennent le jeton d'accès


@app.post("/api/epita/config", dependencies=_LOCAL)
def epita_config_set(b: EpitaConfig):
    vals = {k: v.strip() for k, v in b.model_dump().items() if v is not None}
    for k in ("zeus_ics_url", "moodle_ics_url", "moodle_base_url"):
        if vals.get(k) and not vals[k].startswith("https://"):
            raise HTTPException(400, "le lien doit commencer par https://")
    nasko_core.update_config(vals)
    nasko_epita._mem.clear()
    nasko_agent.poke()
    return nasko_epita.public_status()


@app.get("/api/agenda/tasks", dependencies=_LOCAL)
def agenda_tasks():
    return {"tasks": nasko_agenda.list_tasks()}


@app.post("/api/agenda/tasks", dependencies=_LOCAL)
def agenda_task_add(b: AgendaTask):
    try:
        t = nasko_agenda.add_task(b.title, b.due, b.notes, b.duration_min)
    except ValueError as e:
        raise HTTPException(400, str(e))
    nasko_agent.poke()
    return t


@app.patch("/api/agenda/tasks/{tid}", dependencies=_LOCAL)
def agenda_task_patch(tid: str, b: AgendaTaskPatch):
    try:
        return nasko_agenda.update_task(tid, **b.model_dump())
    except KeyError:
        raise HTTPException(404, "tâche introuvable")
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/agenda/tasks/{tid}", dependencies=_LOCAL)
def agenda_task_del(tid: str):
    try:
        nasko_agenda.delete_task(tid)
    except KeyError:
        raise HTTPException(404, "tâche introuvable")
    return {"ok": True}


# =============================================================================== PROFILS (CEO / Dev / Friends)
class RoleSelect(BaseModel):
    role: str
    pin: str = ""
    new_pin: str = ""


class RolePin(BaseModel):
    role: str
    pin: str
    new_pin: str


@app.get("/api/role", dependencies=_REMOTE)
def role_info():
    """Profil actif de CETTE machine (un appareil distant suit celui du PC) et ses capacités : l'interface masque en conséquence."""
    return nasko_roles.info()


@app.post("/api/role/select", dependencies=_LOCAL)
def role_select(b: RoleSelect):
    try:
        nasko_roles.select(b.role, b.pin, b.new_pin)
    except nasko_roles.RoleError as e:
        raise HTTPException(400, str(e))
    sec.event("profil", "local", nasko_roles.LABELS[b.role], "changé")
    return nasko_roles.info()


@app.post("/api/role/pin", dependencies=_LOCAL)
def role_pin(b: RolePin):
    try:
        nasko_roles.change_pin(b.role, b.pin, b.new_pin)
    except nasko_roles.RoleError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


def _on_role_switch(old, new):
    """Un autre profil ne doit pas hériter des sessions du précédent : caches scolaires, document PDF ouvert, dépôts de fichiers, tâches en cours."""
    nasko_epita._mem.clear()
    try:                                                             # la session cloud et le miroir appartiennent au profil précédent
        nasko_cloud._access.update(token="", at=0.0)
        nasko_cloud.sync.stop()
        if new == "friends":
            nasko_mirror.stop()
    except Exception:                                                # noqa: BLE001
        pass
    try:
        nasko_pdf.new_session()
    except Exception:                                                # noqa: BLE001 — une opération longue peut tourner : le nettoyage se fera au prochain changement
        pass
    for mod in (nasko_studio, nasko_receipts):
        try:
            shutil.rmtree(mod.UP, ignore_errors=True)
        except Exception:                                            # noqa: BLE001
            pass
    nasko_pdf.JOB.update(result=None, error="")
    nasko_studio.JOB.update(result=None, error="")
    nasko_syllabus.JOB.update(result=None, error="")
    nasko_receipts.JOB.update(result=None, error="")


nasko_roles.on_switch(_on_role_switch)


# ----------------------------------------------------------------------------- Cloud Dual Pulse (presse-papiers universel, appareils) et miroir du téléphone (scrcpy)
class CloudLogin(BaseModel):
    url: str
    email: str
    password: str
    totp: str = ""


class CloudSync(BaseModel):
    up: bool | None = None
    down: bool | None = None
    agenda: bool | None = None


class MirrorCfg(BaseModel):
    auto: bool | None = None
    host: str | None = None
    port: int | None = None
    dock: bool | None = None
    adb_path: str | None = None
    scrcpy_path: str | None = None


class MirrorPair(BaseModel):
    host: str
    port: int
    code: str


def _cloud_call(fn, *a, **k):
    try:
        return fn(*a, **k)
    except nasko_cloud.CloudError as e:
        raise HTTPException(e.status if 400 <= e.status < 600 else 400, str(e))


@app.get("/api/cloud/status", dependencies=_LOCAL)
def cloud_status():
    return nasko_cloud.status()


@app.post("/api/cloud/login", dependencies=_LOCAL)
def cloud_login(b: CloudLogin):
    try:
        return nasko_cloud.login(b.url, b.email, b.password, b.totp)
    except nasko_cloud.CloudError as e:
        raise HTTPException(e.status if 400 <= e.status < 600 else 400, {"detail": str(e), **e.extra} if e.extra.get("mfa_required") else str(e))


@app.post("/api/cloud/logout", dependencies=_LOCAL)
def cloud_logout():
    return nasko_cloud.logout()


@app.post("/api/cloud/sync", dependencies=_LOCAL)
def cloud_sync(b: CloudSync):
    return nasko_cloud.set_sync(b.up, b.down, b.agenda)


@app.get("/api/cloud/devices", dependencies=_LOCAL)
def cloud_devices():
    return {"items": _cloud_call(nasko_cloud.devices)}


@app.get("/api/mirror/status", dependencies=_LOCAL)
def mirror_status():
    return nasko_mirror.status()


@app.post("/api/mirror/config", dependencies=_LOCAL)
def mirror_config(b: MirrorCfg):
    vals = {}
    if b.auto is not None:
        vals["mirror_auto"] = b.auto
    if b.host is not None:
        if b.host and not nasko_mirror.valid_target(b.host.strip(), b.port or 5555):
            raise HTTPException(400, "Adresse IP invalide.")
        vals["mirror_host"] = b.host.strip()
    if b.port is not None:
        if not 1 <= b.port <= 65535:
            raise HTTPException(400, "Port invalide.")
        vals["mirror_port"] = b.port
    if b.dock is not None:
        vals["mirror_dock"] = b.dock
    for k, v in (("adb_path", b.adb_path), ("scrcpy_path", b.scrcpy_path)):
        if v is not None:
            vals[k] = v.strip()
    nasko_core.update_config(vals)
    if vals.get("mirror_auto"):
        nasko_mirror.autostart(nasko_cloud.devices)
    return nasko_mirror.status()


@app.post("/api/mirror/start", dependencies=_LOCAL)
def mirror_start():
    try:
        nasko_mirror.connect_and_start(nasko_cloud.devices)
    except nasko_mirror.MirrorError as e:
        nasko_mirror.set_state("error", str(e))
        raise HTTPException(400, str(e))
    return nasko_mirror.status()


@app.post("/api/mirror/stop", dependencies=_LOCAL)
def mirror_stop():
    nasko_mirror.stop()
    return nasko_mirror.status()


@app.post("/api/mirror/pair", dependencies=_LOCAL)
def mirror_pair(b: MirrorPair):
    try:
        nasko_mirror.pair(b.host.strip(), b.port, b.code.strip())
    except nasko_mirror.MirrorError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


class AgendaAction(BaseModel):
    verb: str
    id: str = ""


@app.post("/api/agenda/action", dependencies=_LOCAL)
def agenda_action(b: AgendaAction):
    """Boutons d'un toast de l'interface (« Fait », « Reporter à demain ») : même traitement que ceux de la notification native."""
    try:
        res = nasko_toast.handle_action(nasko_toast.uri(b.verb, b.id))
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not res["ok"]:
        raise HTTPException(404, res["message"])
    nasko_agent.poke()
    return res


class BgSettings(BaseModel):
    tray_enabled: bool | None = None
    briefing_enabled: bool | None = None
    briefing_time: str | None = None
    autostart: bool | None = None
    pause_minutes: int | None = None           # > 0 : ne pas déranger pendant N minutes ; 0 : réactiver


def _bg_state():
    cfg = load_config()
    paused = float(cfg.get("notify_paused_until") or 0)
    win = os.name == "nt"
    return {"windows": win, "tray_available": nasko_tray.available(), "tray_active": nasko_tray.active(), "tray_enabled": bool(cfg.get("tray_enabled", True)),
            "autostart": nasko_autostart.is_enabled() if win else None, "briefing_enabled": bool(cfg.get("briefing_enabled", True)),
            "briefing_time": str(cfg.get("briefing_time") or "08:00"), "paused_until": paused if paused > time.time() else 0}


@app.get("/api/background/settings", dependencies=_LOCAL)
def background_get():
    return _bg_state()


@app.post("/api/background/settings", dependencies=_LOCAL)
def background_set(b: BgSettings):
    vals = {}
    if b.tray_enabled is not None:
        vals["tray_enabled"] = b.tray_enabled
    if b.briefing_enabled is not None:
        vals["briefing_enabled"] = b.briefing_enabled
    if b.briefing_time is not None:
        if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", b.briefing_time):
            raise HTTPException(400, "Heure invalide (format HH:MM).")
        vals["briefing_time"] = b.briefing_time
    if b.pause_minutes is not None:
        vals["notify_paused_until"] = time.time() + min(max(b.pause_minutes, 0), 7 * 1440) * 60 if b.pause_minutes > 0 else 0
    if vals:
        update_config(vals)
    if b.autostart is not None:
        if os.name != "nt":
            raise HTTPException(400, "Le démarrage automatique n'existe que sous Windows.")
        nasko_autostart.set_enabled(b.autostart)
    nasko_agent.poke()
    return _bg_state()


@app.post("/api/background/test", dependencies=_LOCAL)
def background_test():
    """Envoie une carte de test (avec boutons) pour vérifier l'affichage des notifications natives."""
    nasko_notify.toast("E.N.O.S. — TEST", "Si vous voyez cette carte, les notifications fonctionnent.", [{"label": "Ouvrir l'agenda", "verb": "open"}], True, tag="test")
    return {"ok": True}


@app.get("/api/agent/status", dependencies=_LOCAL)
def agent_status():
    return {**nasko_agent.status, "feed": nasko_agent.feed()}


@app.post("/api/agent/run", dependencies=_LOCAL)
def agent_run(brief: bool = False):
    """Force un passage de l'IA proactive (brief=true : renvoie aussi le briefing du jour)."""
    return {"sent": nasko_agent.run_once(force_brief=brief), "feed": nasko_agent.feed()}


# =============================================================================== PREMIER DÉMARRAGE (assistant) et MISE À JOUR OTA — réservé à ce PC
class OnbEleven(BaseModel):
    key: str
    persona: str = "enos"
    voice_id: str = ""


class OnbKey(BaseModel):
    key: str


class OnbAgenda(BaseModel):
    zeus: str = ""
    moodle: str = ""


class OnbDone(BaseModel):
    done: bool = True


async def _onb(coro):
    try:
        return await coro
    except nasko_onboarding.StepError as e:
        raise HTTPException(400, str(e))


@app.get("/api/onboarding/state", dependencies=_LOCAL)
def onboarding_state():
    return nasko_onboarding.state()


@app.post("/api/onboarding/eleven/voices", dependencies=_LOCAL)
async def onboarding_voices(b: OnbKey):
    return {"voices": await _onb(nasko_onboarding.eleven_voices(b.key))}


@app.post("/api/onboarding/eleven/save", dependencies=_LOCAL)
async def onboarding_eleven(b: OnbEleven):
    if b.persona not in ("enos", "eto"):
        raise HTTPException(400, "personnalité inconnue")
    return await _onb(nasko_onboarding.save_eleven(b.persona, b.key, b.voice_id))


@app.post("/api/onboarding/groq", dependencies=_LOCAL)
async def onboarding_groq(b: OnbKey):
    r = await _onb(nasko_onboarding.save_groq(b.key))
    _cfg_cache["t"] = 0
    return r


@app.post("/api/onboarding/agenda", dependencies=_LOCAL)
async def onboarding_agenda(b: OnbAgenda):
    r = await _onb(nasko_onboarding.save_agenda(b.zeus, b.moodle))
    nasko_agent.poke()
    return r


class OnbName(BaseModel):
    name: str


@app.post("/api/onboarding/name", dependencies=_LOCAL)
def onboarding_name(b: OnbName):
    try:
        return nasko_onboarding.save_name(b.name)
    except nasko_onboarding.StepError as e:
        raise HTTPException(400, str(e))


@app.post("/api/onboarding/finish", dependencies=_LOCAL)
def onboarding_finish(b: OnbDone):
    nasko_onboarding.finish(b.done)
    return {"ok": True}


@app.post("/api/pair/start", dependencies=_LOCAL)
async def pair_start():
    """Bouton « APPAIRER LE TÉLÉPHONE » : paquet chiffré + QR code + code à 10 caractères (voir nasko_pairing)."""
    try:
        return await run_in_threadpool(nasko_pairing.start)
    except Exception as e:                                          # noqa: BLE001
        log.exception("appairage")
        raise HTTPException(500, "Appairage impossible : " + str(e)[:160])


@app.get("/api/pair/status", dependencies=_LOCAL)
def pair_status():
    return nasko_pairing.status()


@app.post("/api/pair/cancel", dependencies=_LOCAL)
def pair_cancel():
    return {"ok": True, "was_active": nasko_pairing.cancel()}


def _managed_gone():
    raise HTTPException(410, "Les mises à jour sont gérées par le Dual Pulse Launcher.")


@app.get("/api/ota/status", dependencies=_LOCAL)
def ota_status():
    if nasko_update_signal.managed():
        return {"managed": True, **nasko_update_signal.status()}
    return nasko_ota.status()


@app.post("/api/ota/check", dependencies=_LOCAL)
async def ota_check():
    if nasko_update_signal.managed():
        _managed_gone()
    try:
        return await run_in_threadpool(nasko_ota.check)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:                                          # noqa: BLE001 — hors ligne, hébergement indisponible
        raise HTTPException(502, "serveur de mise à jour injoignable : " + e.__class__.__name__)


@app.post("/api/ota/install", dependencies=_LOCAL)
def ota_install():
    if nasko_update_signal.managed():
        _managed_gone()
    try:
        nasko_ota.install(lambda: (state["shutdown"] or (lambda: os._exit(0)))())
    except ValueError as e:
        raise HTTPException(400, str(e))
    return nasko_ota.status()


# =============================================================================== APPLICATION MOBILE : télémétrie du PC + synchro d'agenda (appareils de confiance « Eto Dev » ou ce PC)
_MOBILE = [Depends(need_token), Depends(dev_only)]
_BOOT = time.time()


class AgendaSync(BaseModel):
    since: float = 0
    tasks: list[dict] = []


_MOBILE_PROFILE = {"v": None, "t": 0.0, "busy": False}


def _mobile_profile():
    """Nom du profil d'alimentation : powercfg est lent (plusieurs secondes à froid), donc lu en tâche de fond ; la réponse du téléphone ne l'attend jamais."""
    def work():
        try:
            p = (nasko_sysctl.state(_sys_forced()).get("profiles") or {})
            _MOBILE_PROFILE["v"] = p.get("active_name") or p.get("current")
        except Exception:                                              # noqa: BLE001
            pass
        finally:
            _MOBILE_PROFILE.update(t=time.time(), busy=False)
    if time.time() - _MOBILE_PROFILE["t"] > 60 and not _MOBILE_PROFILE["busy"]:
        _MOBILE_PROFILE["busy"] = True
        threading.Thread(target=work, daemon=True, name="mobile-profile").start()
    return _MOBILE_PROFILE["v"]


class MobPlay(BaseModel):
    fen: str = ""
    uci: str = ""
    power: int = 60
    answer: bool = True


class MobFen(BaseModel):
    fen: str = ""
    power: int = 60


class MobReview(BaseModel):
    pgn: str
    me: str = "auto"
    username: str = ""


def _mob(fn, *a):
    try:
        return fn(*a)
    except nasko_chess.ChessError as e:
        raise HTTPException(400, str(e))


@app.post("/api/mobile/chess/play", dependencies=_MOBILE)
def mobile_chess_play(b: MobPlay):
    """Échecs du téléphone (sans état) : le joueur joue `uci` sur `fen`, le PC répond à la force réglée."""
    return _mob(nasko_mobchess.play, b.fen, b.uci, max(1, min(100, b.power)), b.answer)


@app.post("/api/mobile/chess/engine", dependencies=_MOBILE)
def mobile_chess_engine(b: MobFen):
    return _mob(nasko_mobchess.engine_first, b.fen, max(1, min(100, b.power)))


@app.post("/api/mobile/chess/state", dependencies=_MOBILE)
def mobile_chess_state(b: MobFen):
    return _mob(nasko_mobchess.state_of, b.fen)


@app.post("/api/mobile/chess/hint", dependencies=_MOBILE)
def mobile_chess_hint(b: MobFen):
    return _mob(nasko_mobchess.hint, b.fen)


@app.post("/api/mobile/chess/review", dependencies=_MOBILE)
def mobile_chess_review(b: MobReview):
    """Bilan d'une partie TERMINÉE collée en PGN (ex. contre un bot de Chess.com) : tâche de fond, suivie par /review/{job}."""
    return _mob(nasko_mobchess.start_review, b.pgn, b.me if b.me in ("w", "b") else "auto", b.username[:40])


@app.get("/api/mobile/chess/review/{job}", dependencies=_MOBILE)
def mobile_chess_review_status(job: str):
    return _mob(nasko_mobchess.review_status, job)


# Le téléphone pilote l'entraînement de Super Enos qui tourne SUR LE PC (le PC calcule, le téléphone suit en direct)
@app.get("/api/mobile/train/status", dependencies=_MOBILE)
def mobile_train_status():
    return nasko_train.status()


@app.post("/api/mobile/train/start", dependencies=_MOBILE)
def mobile_train_start(b: TrainStart):
    return _mob(nasko_train.start, b.opponents, b.games, b.secs, b.llm, b.threads)


@app.post("/api/mobile/train/stop", dependencies=_MOBILE)
def mobile_train_stop():
    return nasko_train.stop()


@app.get("/api/mobile/pc", dependencies=_MOBILE)
def mobile_pc():
    """Instantané léger pour l'onglet PC du téléphone : jauges, ventilateurs (lecture seule), batterie, scène en cours, profil d'alimentation."""
    s = nasko_sysctl.sensors()
    return {"host": socket.gethostname(), "now": time.time(), "uptime_s": int(time.time() - _BOOT), "version": nasko_ota.current_version(),
            "cpu": s.get("cpu"), "ram": s.get("ram"), "gpu": s.get("gpu"), "battery": s.get("battery"), "disk": s.get("disk"), "fans": s.get("fans"),
            "profile": _mobile_profile(), "running": nasko_tasks.running_scenes(),
            "agent": {"running": nasko_agent.status["running"], "sent": nasko_agent.status["sent_total"]},
            "caps": {"fans_write": False, "power": bool(load_config().get("remote_power", True))}}


@app.post("/api/agenda/sync", dependencies=_MOBILE)
def agenda_sync(b: AgendaSync):
    changed, now = nasko_agenda.sync(b.tasks, b.since)
    nasko_agent.poke()
    return {"tasks": changed, "now": now}


atexit.register(nasko_chess.close)
atexit.register(nasko_mirror.shutdown)
atexit.register(nasko_embed.stop)
atexit.register(nasko_pet.stop)
atexit.register(nasko_depot_term.close_all)
for _m in (nasko_clipper, nasko_babel, nasko_tilt):
    atexit.register(_m.stop)
atexit.register(nasko_agent.stop)
atexit.register(nasko_afk.afk.stop)
atexit.register(nasko_mobchess.close)
atexit.register(nasko_train.stop)
atexit.register(nasko_devmanager.stop_all)


@app.post("/api/site/tunnel", dependencies=_LOCAL)
def site_tunnel_start():
    """Lien public sans inscription : tunnel SSH inversé vers localhost.run (ssh.exe fourni avec Windows)."""
    if not _site_online():
        raise HTTPException(409, "Démarrez d'abord le serveur du site.")
    if _tun["proc"] and _tun["proc"].poll() is None:
        return {"ok": True}
    ssh = shutil.which("ssh")
    if not ssh:
        raise HTTPException(500, "ssh.exe introuvable (Paramètres Windows → Fonctionnalités facultatives → Client OpenSSH).")
    _tun.update(url="", err="")
    proc = subprocess.Popen([ssh, "-T", "-o", "StrictHostKeyChecking=accept-new", "-o", "ServerAliveInterval=30", "-o", "ExitOnForwardFailure=yes",
                             "-R", "80:127.0.0.1:8000", "nokey@localhost.run"],
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
    _tun["proc"] = proc
    threading.Thread(target=_tun_reader, args=(proc,), daemon=True).start()
    return {"ok": True}


@app.delete("/api/site/tunnel", dependencies=_LOCAL)
def site_tunnel_stop():
    _tun_stop()
    return {"ok": True}


def _secure_cloud_url():
    """URL du cloud sécurisé (réglage secure_cloud_url, https uniquement : jamais un fichier local ni un autre schéma)."""
    from urllib.parse import urlparse
    url = str(load_config().get("secure_cloud_url") or "https://drive.proton.me/").strip()
    p = urlparse(url)
    if p.scheme != "https" or not p.hostname:
        raise HTTPException(400, "secure_cloud_url doit être une adresse https:// valide (nasko_config.json).")
    return url


@app.post("/api/cloud/open", dependencies=_LOCAL)
def cloud_open():
    """Bouton « OUVRIR MON CLOUD SÉCURISÉ » : nouvel onglet du navigateur par défaut de CE PC."""
    import webbrowser
    url = _secure_cloud_url()
    if not webbrowser.open(url, new=2):
        raise HTTPException(500, "Aucun navigateur n'a pu être ouvert.")
    return {"ok": True, "url": url}


@app.post("/api/site/open", dependencies=_LOCAL)
def site_open():
    if not _site_online():
        raise HTTPException(409, "Le serveur du site est hors ligne : démarrez-le d'abord.")
    import webbrowser
    webbrowser.open(SITE_URL)
    return {"ok": True}


# --- CinePulse (montage vidéo local, stdlib + ffmpeg) : démarre backend/server.py au besoin puis l'ouvre dans le navigateur
CINEPULSE_PORT = 8790


def _cinepulse_online():
    try:
        with socket.create_connection(("127.0.0.1", CINEPULSE_PORT), timeout=1):
            return True
    except OSError:
        return False


@app.post("/api/cinepulse/open", dependencies=_LOCAL)
def cinepulse_open():
    d = os.path.join(nasko_core.app_dir(), "CinePulse")
    script = os.path.join(d, "backend", "server.py")
    if not os.path.isfile(script):
        raise HTTPException(404, "Dossier CinePulse introuvable à côté de ENOS.exe.")
    if not _cinepulse_online():
        py = shutil.which("pyw") or shutil.which("pythonw") or shutil.which("py") or shutil.which("python")
        if not py:
            raise HTTPException(500, "Python est introuvable : CinePulse ne peut pas démarrer.")
        try:
            subprocess.Popen([py, script, "--port", str(CINEPULSE_PORT)], cwd=d, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP)
        except OSError as e:
            raise HTTPException(500, f"Impossible de démarrer CinePulse ({e.strerror or e}).")
        for _ in range(30):                                          # jusqu'à ~6 s pour que le serveur écoute
            if _cinepulse_online():
                break
            time.sleep(0.2)
        else:
            raise HTTPException(504, "CinePulse n'a pas démarré à temps.")
    import webbrowser
    webbrowser.open(f"http://127.0.0.1:{CINEPULSE_PORT}/")
    return {"ok": True}


# --- GESTIONNAIRE D'ABONNEMENTS (subs_analyzer) : boîtes mail et scan réservés à ce PC ; liste, résiliation et statuts lisibles par le PC et les appareils « Eto Dev »
class SubsAccount(BaseModel):
    email: str
    password: str
    server: str = ""
    port: int = 993
    username: str = ""


class SubsScan(BaseModel):
    accounts: list[str] | None = None


class SubsState(BaseModel):
    hidden: bool | None = None
    cancelled: bool | None = None


def _sub(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except subs_analyzer.SubsError as e:
        raise HTTPException(400, str(e))


@app.get("/api/subs/accounts", dependencies=_LOCAL)
def subs_accounts():
    return {"accounts": subs_analyzer.list_accounts()}


@app.post("/api/subs/accounts", dependencies=_LOCAL)
def subs_account_add(b: SubsAccount):
    return {"accounts": _sub(subs_analyzer.add_account, b.email, b.password, b.server, b.port, b.username)}


@app.delete("/api/subs/accounts/{acc_id}", dependencies=_LOCAL)
def subs_account_del(acc_id: str):
    return {"accounts": subs_analyzer.remove_account(acc_id)}


@app.post("/api/subs/scan", dependencies=_LOCAL)
def subs_scan(b: SubsScan | None = None):
    _sub(subs_analyzer.start_scan, b.accounts if b else None)
    return subs_analyzer.job()


@app.get("/api/subs/job", dependencies=[Depends(need_token), Depends(dev_only)])
def subs_job():
    return subs_analyzer.job()


@app.get("/api/subs/list", dependencies=[Depends(need_token), Depends(dev_only)])
def subs_list():
    return subs_analyzer.build_list()


@app.get("/api/subs/cancel/{key}", dependencies=[Depends(need_token), Depends(dev_only)])
def subs_cancel(key: str):
    return _sub(subs_analyzer.cancel_info, key)


@app.post("/api/subs/state/{key}", dependencies=[Depends(need_token), Depends(dev_only)])
def subs_state(key: str, b: SubsState):
    if not re.fullmatch(r"[a-z0-9]{1,60}", key):
        raise HTTPException(400, "Clé invalide.")
    subs_analyzer.set_state(key, b.hidden, b.cancelled)
    return {"ok": True}


# --- CONSTRUIRE UN COLIS : zip d'un dossier (export Godot…) sans toucher à la source, puis copie vers le dossier du projet / de l'entrepôt
def _pack_dir():
    d = os.path.join(nasko_core.app_dir(), "Stockage", "Colis_Construits")
    os.makedirs(d, exist_ok=True)
    return d


_pack = {"running": False, "src": "", "name": "", "ok": None, "message": ""}


def _pack_check_src(path):
    path = (path or "").strip().strip('"')
    if not path or "\0" in path or not os.path.isdir(path):
        raise HTTPException(400, "Dossier source introuvable.")
    real = sec._norm(path)
    if sec._inside(real, sec._norm(os.environ.get("SystemRoot", r"C:\Windows"))):
        raise HTTPException(400, "Dossier système Windows refusé.")
    if any(sec._inside(real, d) or sec._inside(d, real) for d in sec.sensitive_dirs()):
        raise HTTPException(400, "Dossier sensible (système / identifiants) refusé.")
    if sec._inside(sec._norm(_pack_dir()), real):
        raise HTTPException(400, "Ce dossier contient le dossier des colis construits d'E.N.O.S. : choisissez le dossier d'export lui-même.")
    return os.path.abspath(path)


def _pack_run(src, name):
    final = os.path.join(_pack_dir(), name)
    part = final[:-4] + ".part"
    try:
        shutil.make_archive(part, "zip", root_dir=os.path.dirname(src) or src, base_dir=os.path.basename(src))     # lecture seule sur la source
        os.replace(part + ".zip", final)
        _pack.update(ok=True, message=f"Colis créé : {name} ({os.path.getsize(final) / 1048576:.1f} Mo).")
        nasko_notify.task_done("pack", name)
    except Exception as e:                                                                                          # noqa: BLE001 — remonté à l'interface
        try:
            if os.path.exists(part + ".zip"):
                os.remove(part + ".zip")
        except OSError:
            pass
        _pack.update(ok=False, message=f"Échec de la compression : {e}")
        nasko_notify.task_done("pack", name, False, str(e))
    finally:
        _pack["running"] = False


class PackBuild(BaseModel):
    src: str


class PackSend(BaseModel):
    name: str
    dest: str = "project_dir"


def _pack_name(name):
    if not name or os.path.basename(name) != name or not name.lower().endswith(".zip"):
        raise HTTPException(400, "Nom de colis invalide.")
    f = os.path.join(_pack_dir(), name)
    if not os.path.isfile(f):
        raise HTTPException(404, "Colis introuvable.")
    return f


@app.post("/api/pack/pick", dependencies=_LOCAL)
def pack_pick():
    win = state.get("window")
    if win is None:
        return {"path": None, "error": "Le sélecteur n'est disponible que dans la fenêtre E.N.O.S. : collez le chemin à la place."}
    import webview
    res = win.create_file_dialog(getattr(getattr(webview, "FileDialog", None), "FOLDER", None) or webview.FOLDER_DIALOG)
    return {"path": res[0] if res else None}


@app.post("/api/pack/build", dependencies=_LOCAL)
def pack_build(b: PackBuild):
    src = _pack_check_src(b.src)
    if _pack["running"]:
        raise HTTPException(409, "Une compression est déjà en cours.")
    base = re.sub(r"[^\w.\- ]", "_", os.path.basename(src.rstrip("\\/")) or "colis").strip() or "colis"
    name = f"{base}_{datetime.now().strftime('%Y%m%d-%H%M%S')}.zip"
    _pack.update(running=True, src=src, name=name, ok=None, message="Compression en cours…")
    threading.Thread(target=_pack_run, args=(src, name), daemon=True).start()
    return {"started": True, "name": name}


def _pack_dests():
    cfg = load_config()
    out = []
    for key, label in (("project_dir", "Dossier du projet"), ("warehouse_dir", "Entrepôt")):
        v = (cfg.get(key) or "").strip()
        out.append({"key": key, "label": label, "path": v, "ok": bool(v) and os.path.isdir(v)})
    return out


@app.get("/api/pack/status", dependencies=_LOCAL)
def pack_status():
    items = []
    for f in os.scandir(_pack_dir()):
        if f.is_file() and f.name.lower().endswith(".zip"):
            st = f.stat()
            items.append({"name": f.name, "size": st.st_size, "t": st.st_mtime})
    items.sort(key=lambda x: -x["t"])
    return {"job": dict(_pack), "items": items, "dests": _pack_dests(), "folder": _pack_dir()}


@app.post("/api/pack/send", dependencies=_LOCAL)
def pack_send(b: PackSend):
    f = _pack_name(b.name)
    dest = next((d for d in _pack_dests() if d["key"] == b.dest), None)
    if not dest:
        raise HTTPException(400, "Destination inconnue.")
    if not dest["ok"]:
        raise HTTPException(400, f"{dest['label']} non défini ou introuvable (RÉGLAGES → PROFIL).")
    target = os.path.join(dest["path"], b.name)
    stem, n = b.name[:-4], 1
    while os.path.exists(target):                                       # ne jamais écraser un fichier existant
        n += 1
        target = os.path.join(dest["path"], f"{stem} ({n}).zip")
    tmp = target + ".part"
    try:
        shutil.copy2(f, tmp)
        os.replace(tmp, target)
    except OSError as e:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise HTTPException(500, f"Copie impossible : {e.strerror or e}")
    nasko_notify.task_done("pack_send", b.name)
    return {"ok": True, "path": target}


@app.delete("/api/pack/item", dependencies=_LOCAL)
def pack_delete(name: str):
    os.remove(_pack_name(name))
    return {"ok": True}


# --- SYNC GODOT INVISIBLE : Git transfère, le chat partagé (relais par dossier d'entrepôt) prévient l'associé
def _gs_relay_on():
    """Écoute permanente : démarre le relais du chat par dossier partagé (local, sans ouvrir le réseau) s'il ne tourne pas. True si actif."""
    if nasko_chat.relay_status()["state"] == "on":
        return True
    try:
        cfg = load_config()
        root = nasko_team.root_of(cfg)
        me, label = _me(cfg)
        nasko_team.ensure(root, me, label)
        nasko_chat.start_relay(root, me)
        return True
    except Exception:                                                    # noqa: BLE001 — entrepôt non configuré / injoignable
        return False


def _gs_signal():
    """Appelée quand le push a réussi : poste le message système dans le chat partagé."""
    root = nasko_git.repo_root(load_config().get("project_dir", ""))
    if not root:
        return
    _gs_relay_on()
    pid, label = _me()
    m = nasko_chat.make(pid, label, nasko_godotsync.make_text(root))
    if m:
        nasko_chat.post(m)


def _gs_dir_state(path):
    if not path:
        return "unset"
    if not os.path.isdir(path):
        return "missing"
    root = nasko_git.repo_root(path)
    if root and os.path.normcase(os.path.abspath(root)) == os.path.normcase(os.path.abspath(path)):
        return "repo"
    return "empty" if nasko_godotsync._is_empty(path) else "other"


def _gs_pending():
    return nasko_godotsync.pending(nasko_chat.history(200), _me()[0], data_dir())


class GsBroadcast(BaseModel):
    resolve: str = ""


@app.get("/api/godotsync/status", dependencies=_LOCAL)
def godotsync_status():
    path = load_config().get("project_dir", "")
    pend = _gs_pending()
    return {"dir": path, "dir_state": _gs_dir_state(path), "pending": pend,
            "recv": dict(nasko_godotsync.RECV), "relay": nasko_chat.relay_status()["state"],
            "git": {k: nasko_git.STATE[k] for k in ("running", "steps", "ok", "message", "conflicts", "needs_choice", "other", "t")}}


@app.post("/api/godotsync/broadcast", dependencies=_LOCAL)
def godotsync_broadcast(b: GsBroadcast | None = None):
    path = load_config().get("project_dir", "")
    if not path or not os.path.isdir(path):
        raise HTTPException(400, "Dossier du projet Godot introuvable : définissez-le ci-dessus.")
    relay = _gs_relay_on()
    if not nasko_git.start(path, (b.resolve if b else ""), on_ok=_gs_signal):
        raise HTTPException(409, "Une synchronisation est déjà en cours.")
    return {"started": True, "relay": relay}


@app.post("/api/godotsync/accept", dependencies=_LOCAL)
def godotsync_accept():
    path = load_config().get("project_dir", "")
    if not path:
        raise HTTPException(400, "Dossier du projet Godot non défini (profil).")
    pend = _gs_pending()
    if not nasko_godotsync.receive(path, pend):
        raise HTTPException(409, "Un téléchargement est déjà en cours.")
    if pend:
        nasko_godotsync.mark_seen(data_dir(), pend["t"])         # l'alerte ne revient pas ; en cas d'échec le bouton manuel reste disponible
    return {"started": True}


@app.post("/api/godotsync/dismiss", dependencies=_LOCAL)
def godotsync_dismiss():
    pend = _gs_pending()
    if pend:
        nasko_godotsync.mark_seen(data_dir(), pend["t"])
    return {"ok": True}


# --- chat développeurs
class ChatMsg(BaseModel):
    text: str


@app.get("/api/devchat/history", dependencies=_IMG)
def devchat_history(after: float = 0):
    return {"items": nasko_chat.history(200, after), "me": _me()[0], "peer": nasko_chat.bridge_status(), "t": time.time()}


@app.post("/api/devchat/send", dependencies=_IMG)
def devchat_send(b: ChatMsg, request: Request):
    pid, label = _me()
    if not is_local(request):
        label = nasko_team.device_name(request.scope.get("state", {}).get("device_uuid", "")) or "Mobile"
        pid = pid + "-mobile"
    m = nasko_chat.make(pid, label, b.text)
    if not m:
        raise HTTPException(400, "message vide")
    nasko_chat.post(m)
    return {"ok": True, "id": m["id"]}


# --- CANAL : un seul bouton « OUVRIR LE CANAL »
def _chan_card(cfg):
    ips = lan_ips() if (cfg.get("chat_direct", True) and state["network"] and state["https_port"]) else []
    fp = nasko_cert.fingerprint(os.path.join(data_dir(), "certs")).replace(":", "").lower() if ips else ""
    return {"urls": [f"wss://{ip}:{state['https_port']}/ws/chat" for ip in ips], "token": nasko_chat.channel_token(), "fp": fp}


def _channel_target():
    """Cible de la liaison directe : fiche de l'associé, relue à chaque tentative."""
    cfg = load_config()
    root = nasko_team.root_of(cfg)
    for pc in nasko_team.peer_channels(root, _me(cfg)[0]):
        if pc["urls"]:
            return {"urls": pc["urls"], "token": pc["token"], "fp": pc["fp"], "peer": pc["label"]}
    return None


def _channel_open():
    cfg = load_config()
    root = nasko_team.root_of(cfg)
    me, label = _me(cfg)
    nasko_team.ensure(root, me, label)
    direct_err = ""
    if cfg.get("chat_direct", True) and not state["network"]:
        try:
            enable_network()                                       # nécessaire pour la liaison directe (HTTPS sur le réseau local)
        except Exception as e:                                     # noqa: BLE001
            direct_err = str(e)[:120]
    card = _chan_card(cfg)
    nasko_team.publish_channel(root, me, {"id": me, "label": label, **card, "t": time.time()})
    nasko_chat.start_relay(root, me)
    nasko_chat.start_bridge(_channel_target)
    nasko_core.update_config({"chat_channel_open": True})
    return direct_err


def _channel_status():
    cfg = load_config()
    out = {"open": bool(cfg.get("chat_channel_open")), "configured": bool((cfg.get("warehouse_dir") or "").strip()), "peers": [], "direct": nasko_chat.bridge_status(),
           "relay": nasko_chat.relay_status()["state"], "headline": "", "level": "off"}
    if not out["configured"]:
        out["headline"] = "Choisissez d'abord le dossier partagé (RÉGLAGES → PROFIL → Entrepôt partagé) : c'est lui qui relie vos deux PC."
        return out
    if not out["open"]:
        out["headline"] = "Canal fermé."
        return out
    try:
        root = nasko_team.root_of(cfg)
        me = _me(cfg)[0]
        chans = {c["id"]: c for c in nasko_team.peer_channels(root, me)}
        out["peers"] = [{"id": p["id"], "label": p["label"], "open": p["id"] in chans, "online": time.time() - p.get("last_online", 0) < 600} for p in nasko_team.peers(root, me)]
    except Exception:
        pass
    d = out["direct"]
    peer = d.get("peer") or (out["peers"][0]["label"] if out["peers"] else "l'associé")
    if d["state"] == "on":
        out.update(level="good", headline=f"Connecté en direct avec {peer}.")
    elif out["relay"] == "on" and any(p["open"] for p in out["peers"]):
        out.update(level="ok", headline=f"Canal ouvert avec {peer} (par le dossier partagé, quelques secondes de délai).")
    elif out["relay"] == "on":
        out.update(level="wait", headline="Canal ouvert de votre côté. En attente : votre associé doit cliquer sur OUVRIR LE CANAL sur son PC.")
    return out


@app.get("/api/channel", dependencies=_LOCAL)
def channel_status():
    return _channel_status()


@app.post("/api/channel/open", dependencies=_LOCAL)
def channel_open():
    try:
        err = _channel_open()
    except nasko_team.TeamError as e:
        raise HTTPException(400, str(e))
    except OSError as e:
        raise HTTPException(500, "Dossier partagé inaccessible : " + str(e))
    return {**_channel_status(), "direct_error": err}


@app.post("/api/channel/close", dependencies=_LOCAL)
def channel_close():
    nasko_chat.stop_bridge()
    nasko_chat.stop_relay()
    try:
        nasko_team.unpublish_channel(nasko_team.root_of(load_config()), _me()[0])
    except nasko_team.TeamError:
        pass
    nasko_core.update_config({"chat_channel_open": False})
    return _channel_status()


from fastapi import WebSocket, WebSocketDisconnect  # noqa: E402


@app.websocket("/ws/chess")
async def ws_chess(ws: WebSocket):
    await nasko_chessbridge.handle(ws)


@app.websocket("/ws/pet")
async def ws_pet(ws: WebSocket):
    await nasko_pet.handle(ws)


@app.websocket("/ws/chat")
async def ws_chat(ws: WebSocket):
    """Authentification, origine et édition déjà contrôlées par SecurityMiddleware._ws."""
    await ws.accept()
    pid, label = _me()
    external = ws.headers.get("authorization") is not None or ws.headers.get("x-enos-channel") is not None   # PC associé (client sortant) : messages déjà identifiés
    if ws.client and ws.client.host not in sec.LOOPBACK:
        pid, label = pid + "-mobile", "Mobile"
    nasko_chat.add_client(ws, asyncio.get_running_loop())
    last = 0.0
    try:
        while True:
            raw = await asyncio.wait_for(ws.receive_text(), timeout=120)
            if len(raw) > 8192:
                await ws.close(code=1009)
                break
            now = time.time()
            if now - last < 0.15:                                # anti-inondation
                continue
            last = now
            try:
                fr = json.loads(raw)
            except ValueError:
                continue
            if fr.get("type") == "msg" and isinstance(fr.get("msg"), dict):
                if external:
                    nasko_chat.post(fr["msg"], relay=False)       # diffusé aussi à mes autres clients (dédoublonné par identifiant)
                else:
                    m = nasko_chat.make(pid, label, str(fr["msg"].get("text", "")))   # navigateur/mobile : identité imposée par le serveur
                    if m:
                        nasko_chat.post(m)
            elif fr.get("type") == "ping":
                await ws.send_text('{"type":"pong"}')
    except (WebSocketDisconnect, asyncio.TimeoutError, RuntimeError):
        pass
    finally:
        nasko_chat.remove_client(ws)


_chat_started = {"v": False}


@app.on_event("startup")
async def _chat_startup():
    if _chat_started["v"]:
        return
    _chat_started["v"] = True
    nasko_chat.trim()
    nasko_chat.prime_seen()
    threading.Thread(target=nasko_train.autostart_if_enabled, daemon=True).start()   # Super Enos : relance de l'entraînement si l'option « au démarrage » est cochée
    threading.Thread(target=_gs_relay_on, daemon=True).start()   # écoute permanente des alertes de mise à jour (relais par dossier partagé, local)
    if load_config().get("chat_channel_open"):                  # le canal était ouvert : il se rouvre tout seul
        def reopen():
            try:
                _channel_open()
            except Exception:
                log.warning("Canal : réouverture impossible (dossier partagé indisponible ?)")
        threading.Thread(target=reopen, daemon=True).start()


# --- VISUALISEUR D'ANIMATION : explorateur (Binageux / Jeu Projet) + frames triees par nombre
def _anim(fn, *a):
    try:
        return fn(*a)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except (FileNotFoundError, ValueError, OSError) as e:
        raise HTTPException(404, str(e))


@app.get("/api/anim/roots", dependencies=_IMG)
def anim_roots():
    return {"items": nasko_anim.roots()}


@app.get("/api/anim/browse", dependencies=_IMG)
def anim_browse(path: str):
    return _anim(nasko_anim.browse, path)


@app.get("/api/anim/frames", dependencies=_IMG)
def anim_frames(path: str):
    return _anim(nasko_anim.frames, path)


@app.get("/api/anim/frame", dependencies=_IMG)
def anim_frame(path: str, name: str):
    return FileResponse(_anim(nasko_anim.frame_file, path, name), headers={"Cache-Control": "private, max-age=300"})


@app.post("/api/imgproc/deliver", dependencies=_IMG)
def imgproc_deliver(b: ImgDeliver):
    try:
        return nasko_imagefactory.deliver(b.colis, _safe(b.dest, "dir"))
    except (FileNotFoundError, OSError) as e:
        raise HTTPException(400, str(e))


_EXT_LIBS = ("monaco", "xterm")                                  # bibliothèques lourdes (arborescence) : Monaco (moteur de VS Code), xterm.js
_EXT_MIME = {".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf", ".woff2": "font/woff2", ".json": "application/json", ".txt": "text/plain", ".svg": "image/svg+xml"}


@app.get("/static/ext/{lib}/{path:path}")
def static_ext(lib: str, path: str):
    """Fichiers vendorisés de static/vendor/<lib>/… : liste blanche de bibliothèques, extensions connues, chemin résolu strictement dans le dossier (pas de .., pas de lien)."""
    if lib not in _EXT_LIBS or not path or "\x00" in path or "\\" in path:
        raise HTTPException(404)
    base = os.path.realpath(resource_path("static", "vendor", lib))
    full = os.path.realpath(os.path.join(base, path))
    ext = os.path.splitext(full)[1].lower()
    if not full.startswith(base + os.sep) or ext not in _EXT_MIME or not os.path.isfile(full):
        raise HTTPException(404)
    return FileResponse(full, media_type=_EXT_MIME[ext], headers={"Cache-Control": "public, max-age=86400"})


_LEARN_MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png"}


@app.get("/static/learn/{path:path}")
def static_learn(path: str):
    """Page « Apprendre les échecs » de la version PC (puzzles, ouvertures, leçons, conseils) : fichiers de static/learn/, chemin résolu strictement dans le dossier."""
    path = path or "index.html"
    if "\x00" in path or "\\" in path:
        raise HTTPException(404)
    base = os.path.realpath(resource_path("static", "learn"))
    full = os.path.realpath(os.path.join(base, path))
    ext = os.path.splitext(full)[1].lower()
    if not full.startswith(base + os.sep) or ext not in _LEARN_MIME or not os.path.isfile(full):
        raise HTTPException(404)
    return FileResponse(full, media_type=_LEARN_MIME[ext], headers={"Cache-Control": "no-cache"})


@app.get("/static/vendor/{name}")
def static_vendor(name: str):
    if name not in _VENDOR:
        raise HTTPException(404)
    return FileResponse(resource_path("static", "vendor", name), media_type="text/javascript", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/static/{name}")
def static_file(name: str):
    if name not in _STATIC_FILES:
        raise HTTPException(404)
    return FileResponse(resource_path("static", name), media_type=_STATIC_FILES[name], headers={"Cache-Control": "no-cache"})


@app.get("/api/narration/pixellab", dependencies=[Depends(need_token), Depends(local_only)])
def narration_pixellab():
    cfg = load_config()
    return {"ok": nasko_tasks._trouver_chrome(cfg) is not None, "open": nasko_voice.ref("nar_px_open", cfg),
            "info": nasko_voice.ref("nar_px_info", cfg), "fail": nasko_voice.ref("nar_px_fail", cfg),
            "already": bool(nasko_tasks.detect_private_chrome(cfg)), "deja": nasko_voice.ref("nar_px_deja", cfg)}


@app.post("/api/tasks/env", dependencies=[Depends(need_token), Depends(local_only)])
def task_env(body: Launch):
    cfg = load_config()
    path = _known_project(body.path) if body.path else None
    res = nasko_tasks.lancer_environnement(cfg, path)
    if res["ok"]:
        done = _norm(res["path"])
        _write("projects.json", [{**x, "last": datetime.now().isoformat(timespec="seconds")} if _norm(x["path"]) == done else x
                                 for x in _projects()])
    return res


@app.post("/api/tasks/elevenlabs-prive", dependencies=[Depends(need_token), Depends(local_only)])
def task_elevenlabs_prive():
    """Menu : fenêtre de navigation privée (Chrome / Firefox / Edge) avec l'inscription ElevenLabs et un e-mail temporaire. Aucune automatisation."""
    ok, msg = nasko_tasks.ouvrir_elevenlabs_prive(load_config())
    return {"ok": ok, "message": msg}


@app.post("/api/tasks/pixellab", dependencies=[Depends(need_token), Depends(local_only)])
def task_pixellab():
    ok, msg = nasko_tasks.ouvrir_navigation_privee(load_config())
    return {"ok": ok, "message": msg}


# --- dictee : micro du PC (reserve au PC local : un client distant ne doit jamais pouvoir ecouter le micro)
@app.post("/api/stt/start", dependencies=[Depends(need_token), Depends(local_only)])
def stt_start():
    try:
        recorder.start()
    except nasko_stt.STTError as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True}


@app.get("/api/stt/status", dependencies=[Depends(need_token), Depends(local_only)])
def stt_status():
    return recorder.status()


@app.post("/api/stt/stop", dependencies=[Depends(need_token), Depends(local_only)])
def stt_stop():
    """Arrete l'enregistrement (clic ou fin de phrase detectee) et renvoie la transcription."""
    audio, heard, peak = recorder.stop()
    try:
        return {"ok": True, "text": nasko_stt.transcribe(audio, heard, peak, load_config())}
    except nasko_stt.STTError as e:
        log.warning("STT : %s", e)
        return {"ok": False, "error": str(e)}


@app.post("/api/stt/cancel", dependencies=[Depends(need_token), Depends(local_only)])
def stt_cancel():
    recorder.cancel()
    return {"ok": True}


@app.post("/api/shutdown", dependencies=[Depends(need_token), Depends(local_only)])
def shutdown():
    threading.Timer(0.3, lambda: (state["shutdown"] or (lambda: os._exit(0)))()).start()
    return {"ok": True}


@app.get("/api/update/launcher", dependencies=_LOCAL)
def update_launcher_status():
    """Signal du Launcher : une mise à jour est-elle prête ? (bannière discrète de l'interface, interrogée toutes les 30 s)."""
    return nasko_update_signal.status()


@app.post("/api/update/launcher/apply", dependencies=_LOCAL)
def update_launcher_apply():
    """« Redémarrer pour appliquer » : flag « apply » puis fermeture VOLONTAIRE d'E.N.O.S. ; le Launcher remplace les fichiers et relance l'application."""
    try:
        r = nasko_update_signal.request_apply(lambda: (state["shutdown"] or (lambda: os._exit(0)))())
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "version": r["version"]}


@app.post("/api/update/launcher/applied/seen", dependencies=_LOCAL)
def update_launcher_applied_seen():
    nasko_update_signal.consume_applied()
    return {"ok": True}


class UpdateReq(BaseModel):
    hue: float = 356            # teinte du thème courant : la fenêtre de mise à jour reprend les couleurs d'E.N.O.S.


@app.post("/api/update", dependencies=[Depends(need_token), Depends(local_only)])
def self_update(b: UpdateReq | None = None):
    """MISE À JOUR : ouvre la fenêtre updater.py (progression du build, puis relance sur OK) et ferme E.N.O.S.
    Repli : mise_a_jour.bat (console classique) si pythonw / updater.py sont introuvables."""
    if nasko_update_signal.managed():                                # installation gérée par le Dual Pulse Launcher : aucune mise à jour autonome
        st = nasko_update_signal.status()
        return {"ok": True, "managed": True, **st, "message": "Mise à jour prête : redémarre pour l'appliquer." if st["ready"] else "Les mises à jour sont gérées par le Dual Pulse Launcher."}
    root = nasko_core.app_dir()
    if not os.path.isfile(os.path.join(root, "build.bat")):          # version INSTALLÉE (pas de sources) : mise à jour OTA signée
        try:
            info = nasko_ota.check()
        except Exception as e:                                       # noqa: BLE001
            raise HTTPException(502, "Mise à jour impossible : " + str(e)[:160])
        if not info["available"]:
            return {"ok": True, "ota": True, "available": False, **info}
        nasko_ota.install(lambda: (state["shutdown"] or (lambda: os._exit(0)))())
        return {"ok": True, "ota": True, "available": True, **info}
    upd = os.path.join(root, "updater.py")
    pyw = None if getattr(sys, "frozen", False) else os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    if not (pyw and os.path.isfile(pyw)):
        pyw = shutil.which("pyw") or shutil.which("pythonw")
    if os.path.isfile(upd) and os.path.isfile(os.path.join(root, "updater_ui.html")) and pyw:
        cmd, flags = [pyw, upd, "--hue", str(int((b.hue if b else 356)) % 360)], 0x00000008 | 0x00000200
    elif os.path.isfile(os.path.join(root, "mise_a_jour.bat")):
        cmd, flags = ["cmd", "/c", os.path.join(root, "mise_a_jour.bat")], 0x00000010 | 0x00000200
    else:
        raise HTTPException(404, "updater.py / mise_a_jour.bat introuvables dans le dossier d'E.N.O.S.")
    env = {k: v for k, v in os.environ.items() if not k.startswith("_PYI") and k != "_MEIPASS2"}
    env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"                                  # sinon le nouvel ENOS.exe réutilise le dossier d'extraction de l'ANCIEN et sert l'ancienne interface
    subprocess.Popen(cmd, cwd=root, creationflags=flags, close_fds=True, env=env)        # processus indépendant : survit à la fermeture d'E.N.O.S.
    threading.Timer(0.8, lambda: (state["shutdown"] or (lambda: os._exit(0)))()).start()
    return {"ok": True}


def lan_ips():
    ips = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:   # aucune donnee envoyee : donne l'IP de la carte active
            s.connect(("10.255.255.255", 1))
            ips.append(s.getsockname()[0])
    except OSError:
        pass
    try:
        ips += socket.gethostbyname_ex(socket.gethostname())[2]
    except OSError:
        pass
    seen = []
    for ip in ips:
        if ip not in seen and not ip.startswith(("127.", "169.254.")):
            seen.append(ip)
    return seen


def _qr(url):
    return segno.make(url, error="m").svg_data_uri(scale=6, border=2, dark="#000000", light="#ffffff")


_ADAPTERS = {}


def adapter_info(ip):
    """Carte reseau portant `ip` : {mac, name, wired}. Le réveil par le réseau (WoL) ne marche en pratique qu'en filaire."""
    if ip in _ADAPTERS:
        return _ADAPTERS[ip]
    info = {"mac": None, "name": None, "wired": None}
    try:
        ipaddress.ip_address(ip)                                             # jamais de texte libre dans la commande
        ps = (f"$a = Get-NetIPAddress -IPAddress '{ip}' -ErrorAction Stop | Select-Object -First 1; "
              "$n = Get-NetAdapter -InterfaceIndex $a.InterfaceIndex; '{0}|{1}|{2}' -f $n.MacAddress, $n.Name, $n.PhysicalMediaType")
        out = subprocess.run(["powershell.exe", "-NoProfile", "-Command", ps], capture_output=True, text=True, timeout=20,
                             creationflags=subprocess.CREATE_NO_WINDOW).stdout.strip()
        mac, name, media = out.split("|")
        info = {"mac": mac.replace("-", ":").lower(), "name": name, "wired": "802.3" in media}
    except Exception as e:
        log.info("Carte reseau illisible : %s", e)
    _ADAPTERS[ip] = info
    return info


def _network_info():
    if not state["network"] or not state["https_port"]:
        return {"enabled": False, "keep_awake": nasko_power.keep.active}
    ips = lan_ips()
    urls = [f"https://{ip}:{state['https_port']}/" for ip in ips]
    return {"enabled": True, "urls": urls, "code": load_config().get("network_access_code", ""),
            "qr": _qr(urls[0]) if urls else None, "ca": "/nasko-ca.crt", "warning": nasko_cert.BROWSER_WARNING,
            "adapter": adapter_info(ips[0]) if ips else None, "keep_awake": nasko_power.keep.active,
            "host": socket.gethostname(), "port": state["https_port"],
            "fingerprint": nasko_cert.fingerprint(os.path.join(data_dir(), "certs")), "apk": find_asset("NASKO.apk") is not None,
            "vpn_ips": [ip for ip in ips if ipaddress.ip_address(ip) in nasko_trust.VPN_NET],
            "vpn_enabled": bool(load_config().get("allow_vpn_ranges"))}


@app.get("/api/network", dependencies=[Depends(need_token), Depends(local_only)])
def network():
    return _network_info()


class Toggle(BaseModel):
    enabled: bool


@app.post("/api/network/toggle", dependencies=[Depends(need_token), Depends(local_only)])
def network_toggle(body: Toggle):
    """Active/désactive l'accès téléphone à chaud (sans relancer) et mémorise le choix dans nasko_config.json."""
    try:
        if body.enabled:
            enable_network()
        else:
            disable_network()
    except Exception as e:
        log.exception("Bascule reseau impossible")
        return {"ok": False, "error": f"Impossible de modifier l'accès téléphone : {e}"}
    return {"ok": True, **_network_info()}


# ----------------------------------------------------------------------------- lancement
def free_port(start, host="127.0.0.1"):
    """Premier port libre >= start. On tente de LIER le port : instantane (connect_ex vers un port ferme coute ~2 s sous Windows)."""
    for port in range(start, start + 20):
        with socket.socket() as s:
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    raise RuntimeError("aucun port libre")


def fatal(message):
    """Boite de dialogue Windows native puis arret force du processus."""
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, message, "E.N.O.S.", 0x10)   # MB_ICONERROR
    except Exception:
        pass
    os._exit(1)


def webview2_installed():
    """Detecte le runtime WebView2 (inclus dans Windows 11) avant que pywebview ne propose de le telecharger."""
    try:
        import winreg
    except ImportError:
        return False
    guid = r"Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    for hive, path in ((winreg.HKEY_LOCAL_MACHINE, "SOFTWARE\\WOW6432Node\\" + guid),
                       (winreg.HKEY_LOCAL_MACHINE, "SOFTWARE\\" + guid),
                       (winreg.HKEY_CURRENT_USER, "Software\\" + guid)):
        try:
            with winreg.OpenKey(hive, path) as k:
                version, _ = winreg.QueryValueEx(k, "pv")
                if version and version != "0.0.0.0":
                    return True
        except OSError:
            continue
    return False


def _wait_started(server, timeout=20):
    t0 = time.time()
    while not server.started and time.time() - t0 < timeout:
        time.sleep(0.05)
    return server.started


def _launch(host, port, **ssl):
    srv = uvicorn.Server(uvicorn.Config(app, host=host, port=port, log_config=None, timeout_graceful_shutdown=2, **ssl))
    srv.install_signal_handlers = lambda: None                 # le serveur tourne dans un thread
    th = threading.Thread(target=srv.run, name=f"uvicorn-{port}", daemon=True)
    th.start()
    return srv, th


def _start_https(cfg):
    cert, key = nasko_cert.ensure_cert(lan_ips(), socket.gethostname(), os.path.join(data_dir(), "certs"), bool(cfg.get("allow_vpn_ranges")))
    port = free_port(int(cfg.get("https_port", 8443)), "0.0.0.0")
    srv, th = _launch("0.0.0.0", port, ssl_certfile=cert, ssl_keyfile=key)
    if not _wait_started(srv):
        raise RuntimeError("Le serveur HTTPS n'a pas démarré")
    state["https_port"], state["https_srv"] = port, (srv, th)
    state["servers"].append((srv, th))


def enable_network():
    cfg = load_config()
    if not (cfg.get("network_access_code") or "").strip():
        update_config({"network_access_code": secrets.token_hex(4).upper()})   # code d'acces genere une fois
    if state["https_srv"] is None:
        _start_https(load_config())
    state["network"] = True
    update_config({"allow_network_access": True})
    log.info("Accès téléphone activé (HTTPS :%s)", state["https_port"])


def disable_network():
    state["network"] = False
    update_config({"allow_network_access": False})
    srv_th = state["https_srv"]
    if srv_th:
        srv, th = srv_th
        srv.should_exit = True
        th.join(5)
        state["servers"][:] = [x for x in state["servers"] if x[0] is not srv]     # en place : main() garde la meme liste
        state["https_srv"], state["https_port"] = None, None
    log.info("Accès téléphone désactivé")


def start_servers(cfg):
    """HTTP sur 127.0.0.1 (fenêtre native, jamais exposé au réseau) ; si accès téléphone : HTTPS sur 0.0.0.0.
    Retourne la liste (vivante) des serveurs : [(server, thread)]."""
    http_port = free_port(int(cfg.get("server_port", 8765)))
    state.update(port=http_port, network=False, https_port=None, https_srv=None, servers=[])
    srv, th = _launch("127.0.0.1", http_port)
    state["servers"].append((srv, th))
    if not _wait_started(srv):
        raise RuntimeError("Le serveur n'a pas demarre")
    if cfg.get("allow_network_access"):
        enable_network()
    return state["servers"]


def _existing_instance(cfg):
    """Port d'une instance de E.N.O.S. deja active sur ce PC (ex. lancee au demarrage de Windows), ou None."""
    base = int(cfg.get("server_port", 8765))
    for port in range(base, base + 20):
        with socket.socket() as sk:
            try:
                sk.bind(("127.0.0.1", port))
                return None                                     # premier port libre : pas d'instance au-dela
            except OSError:
                pass
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=1.5) as r:
                if json.load(r).get("app") == "nasko":
                    return port
        except Exception:
            continue
    return None


class _NativeApi:
    """Pont pywebview : la clé d'appairage est remise à la fenêtre native (ce processus) sans jamais transiter par HTTP."""

    def get_key(self):
        return sec.pairing_token()

    def toggle_fullscreen(self):
        """F11 : bascule plein écran réel <-> fenêtre maximisée (barre de titre et barre des tâches conservées)."""
        w = state.get("window")
        if w is not None:
            w.toggle_fullscreen()
        return True


def _open_window_process():
    """Ouvre une fenêtre E.N.O.S. sur le serveur déjà actif : nouveau processus (il détecte l'instance et n'ouvre que la fenêtre)."""
    cmd = [sys.executable] if getattr(sys, "frozen", False) else [sys.executable, os.path.abspath(__file__)]
    flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    subprocess.Popen(cmd, creationflags=flags, close_fds=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _handle_action_arg():
    """« ENOS.exe --action enos-action://done/<id> » (bouton d'une notification). Retourne True si le lancement normal doit continuer (ouvrir la fenêtre)."""
    i = sys.argv.index("--action")
    res = nasko_toast.handle_action(sys.argv[i + 1] if len(sys.argv) > i + 1 else "")
    if res["ok"] and res["verb"] == "open":
        return True
    if res["ok"] and res["verb"] == "briefing":
        nasko_agent.run_once(force_brief=True)
        time.sleep(3)                                            # laisse partir la carte (thread de notification)
        return False
    if res["message"]:
        nasko_notify.toast("E.N.O.S.", res["message"], silent=True)
        time.sleep(2)
    return False


def main():
    ensure_config_file()
    if "--action" in sys.argv and not _handle_action_arg():
        return
    cfg = load_config()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s",
                        handlers=[logging.FileHandler(_path("nasko.log"), encoding="utf-8")]
                        + ([logging.StreamHandler()] if sys.stdout else []))
    headless = "--server-only" in sys.argv or "--background" in sys.argv      # --background : demarrage de Windows, sans fenetre
    tray_on = False
    quit_evt = state["quit_evt"] = threading.Event()
    existing = None if "--server-only" in sys.argv else _existing_instance(cfg)
    if existing and headless:
        log.info("E.N.O.S. deja actif (port %s) : rien a demarrer", existing)
        return
    nasko_memory.init_db()
    servers = []
    if existing:                                                # un serveur tourne deja (arriere-plan) : on lui ouvre juste une fenetre
        state["port"] = existing
        log.info("Instance existante sur le port %s : ouverture de la fenetre seule", existing)
    else:
        try:
            servers = start_servers(load_config())
        except Exception as e:
            log.error("Demarrage impossible : %s", e)
            sys.exit(1)
        nasko_power.keep.apply(load_config().get("keep_awake"))
        if load_config().get("pet_autostart"):                  # Œil de bureau au démarrage (Godot + godot_path requis)
            def _pet_boot():
                try:
                    nasko_pet.start(port=state["port"])
                except nasko_pet.PetError as e:
                    log.info("Œil de bureau non lancé : %s", e)
            threading.Timer(4.0, _pet_boot).start()
        nasko_imagefactory.start()                              # surveillance des dossiers « Traitement d'image »
        nasko_agent.start()                                     # IA proactive : surveille l'agenda en tâche de fond
        nasko_update_signal.mark_running()                       # le Launcher sait qu'E.N.O.S. tourne (et quel processus attendre avant de remplacer les fichiers)
        nasko_cloud.autostart()                                 # presse-papiers universel (si activé dans Réglages)
        _tilt_boot()
        for _m in (nasko_clipper, nasko_babel, nasko_tilt):      # fonctions gaming : strictement opt-in, inertes tant qu'elles ne sont pas activées dans Réglages
            try:
                _m.autostart()
            except Exception:
                log.info("autostart %s impossible", _m.__name__, exc_info=True)
        nasko_mirror.autostart(nasko_cloud.devices)             # miroir scrcpy du téléphone (si activé) : s'allume tout seul avec E.N.O.S.
        if os.name == "nt":
            try:
                nasko_autostart.register_notifications(find_logo("ico") or "")     # nom / icône « E.N.O.S. » et boutons des notifications
            except Exception:
                log.info("Enregistrement des notifications impossible", exc_info=True)
        if load_config().get("tray_enabled", True):
            tray_on = nasko_tray.start(_open_window_process, lambda: threading.Thread(target=nasko_agent.run_once, kwargs={"force_brief": True}, daemon=True).start(),
                                       lambda: state["shutdown"](), lambda: nasko_autostart.is_enabled() if os.name == "nt" else False,
                                       lambda on: nasko_autostart.set_enabled(on) if os.name == "nt" else False)
        log.info("E.N.O.S. : HTTP 127.0.0.1:%s | HTTPS reseau : %s", state["port"], state["https_port"] or "desactive")
        if state["network"]:
            log.warning(nasko_cert.BROWSER_WARNING)
            if sys.stdout:
                print("\n/!\\ " + nasko_cert.BROWSER_WARNING + "\n")

    window = None

    def stop():
        for srv, _ in list(state["servers"]):
            srv.should_exit = True
        nasko_tasks.stop_scenes()
        nasko_tray.stop()
        if window is not None:
            try:
                window.destroy()
            except Exception:
                pass
        quit_evt.set()

    state["shutdown"] = stop
    url = f"http://127.0.0.1:{state['port']}/"
    if headless:                                             # sans fenetre (demarrage Windows, tests)
        pass
    else:
        # E.N.O.S. est un logiciel de bureau : fenetre native WebView2 exclusivement, jamais de navigateur.
        if not webview2_installed():
            log.error("WebView2 Runtime introuvable")
            fatal("Erreur Critique : WebView2 introuvable pour lancer l'interface native")
        try:
            import webview
            try:   # identite propre dans la barre des taches (sinon regroupee sous « python »)
                import ctypes
                ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("ENOS.AI.Desktop")
            except Exception:
                pass
            window = state["window"] = webview.create_window("E.N.O.S. AI", url + "?desktop=1", width=1200, height=800,
                                           min_size=(900, 600), resizable=True, background_color="#000000", js_api=_NativeApi(),
                                           maximized=True)       # semi-fenêtré : occupe tout l'écran mais garde barre de titre / barre des tâches
            webview.start(gui="edgechromium", private_mode=False, storage_path=os.path.join(data_dir(), "webview"),
                          icon=find_logo("ico"))   # logo.ico : barre de titre + barre des taches
            if not existing:
                if tray_on:
                    log.info("Fenetre fermee : E.N.O.S. reste actif dans la zone de notification")
                else:
                    stop()                                   # fenetre fermee -> les serveurs s'arretent
        except Exception as e:
            log.exception("Interface native impossible")
            fatal("Erreur Critique : impossible de lancer l'interface native.\n\n" + str(e)[:300])
    if not existing and not quit_evt.is_set():               # serveur sans fenetre (arriere-plan / icone de notification) : on reste en vie jusqu'a « Quitter »
        try:
            quit_evt.wait()
        except KeyboardInterrupt:
            stop()
    for _, th in list(state["servers"]):                     # attend l'arret de tous les serveurs
        th.join(10)
    log.info("E.N.O.S. arrete")
    os._exit(0)                                              # garantit la fin du processus (connexions orphelines)


if __name__ == "__main__":
    main()

