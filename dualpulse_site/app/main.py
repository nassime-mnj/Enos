"""Site officiel Dual Pulse (FastAPI).

  /                       page d'accueil publique : téléchargement du Launcher ; la section « Accès Dev » n'existe dans le HTML QUE si l'IP du visiteur est en liste blanche
  /studio                 présentation du studio et du jeu (ancienne page d'accueil)
  /get/windows            redirection vers le programme d'installation du Launcher (DP_LAUNCHER_URL, hébergé sur R2)
  /api/support            Assistant Support (chatbot public)
  /dev/telecharger        téléchargement d'E.N.O.S. : 404 identique à une page inexistante pour tout visiteur non autorisé
  {ADMIN}/…               administration de la liste blanche (jeton DP_ADMIN_TOKEN) — chemin configurable DP_ADMIN_PATH

Configuration par variables d'environnement : voir .env.example."""
import hashlib
import hmac
import os
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

import content
from . import assistant, db, distribution, whitelist
from .launcher import api as launcher_api
from .codelab import api as codelab_api

BASE = Path(__file__).resolve().parent.parent
ADMIN_PATH = "/" + os.environ.get("DP_ADMIN_PATH", "admin-dp").strip("/")
app = FastAPI(title="Dual Pulse", docs_url=None, redoc_url=None, openapi_url=None)       # pas de documentation d'API exposée
templates = Jinja2Templates(directory=str(BASE / "templates"))
app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")


def admin_token():
    return os.environ.get("DP_ADMIN_TOKEN", "")


def download_file() -> Path:
    return Path(os.environ.get("DP_DOWNLOAD_FILE") or BASE / "private" / "ENOS.exe")


# ----------------------------------------------------------------------------- limiteur de débit (mémoire, par IP)
_hits = defaultdict(deque)
_rl_lock = threading.Lock()


def rate_ok(bucket, ip, limit, per=60):
    now = time.time()
    with _rl_lock:
        q = _hits[(bucket, str(ip))]
        while q and q[0] < now - per:
            q.popleft()
        if len(q) >= limit:
            return False
        q.append(now)
        return True


# ----------------------------------------------------------------------------- en-têtes de sécurité (+ jamais de cache sur le HTML : la variante « dev » ne doit pas fuir via un cache)
@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "same-origin"
    resp.headers["X-Frame-Options"] = "DENY"
    if "text/html" in resp.headers.get("content-type", "") or request.url.path.startswith(("/api/", "/dev/", "/get/", "/launcher/", "/m/", ADMIN_PATH)):
        resp.headers["Cache-Control"] = "private, no-store"
        resp.headers["Vary"] = "Cookie, X-Forwarded-For"
    return resp


# ----------------------------------------------------------------------------- page publique
def _dev_entry(request: Request):
    """Entrée de liste blanche de ce visiteur : son IP (liste blanche) ou, via `tailscale serve`, son identité Tailscale autorisée (« tailscale:<login> »). None sinon."""
    entry = db.match_dev(whitelist.client_ip(request))
    if entry:
        return entry
    who = whitelist.tailscale_user(request)
    return "tailscale:" + who if who else None


def _is_dev(request: Request):
    return bool(_dev_entry(request))


def _dev_ctx(request: Request):
    """Données de la zone développeur : None pour tout visiteur non autorisé (rien de ceci n'existe alors dans le HTML)."""
    if not _is_dev(request):
        return None
    f = download_file()
    return {"available": f.is_file(), "size": f.stat().st_size if f.is_file() else 0, "version": os.environ.get("DP_ENOS_VERSION", ""), "sha256": _sha(f) if f.is_file() else ""}


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    ctx = {"request": request, "studio": content.STUDIO, "dl": distribution.launcher(), "dev": _dev_ctx(request),
           "hero_art": (BASE / "static" / "img" / "hero.webp").is_file()}      # fond plein écran : déposer static/img/hero.webp (sinon dégradés + particules)
    return templates.TemplateResponse(request, "index.html", ctx)


def _media():
    """Galerie du jeu (content.MEDIA). Un média n'est servi que si son fichier existe dans static/media/ avec une extension autorisée ; sinon : emplacement réservé."""
    out = []
    for m in content.MEDIA:
        item = dict(m, ok=False)
        src = (m.get("src") or "").strip()
        if src.startswith("/static/media/") and ".." not in src and Path(src).suffix.lower() in content.MEDIA_EXT and (BASE / src.lstrip("/")).is_file():
            item["ok"] = True
            item["kind"] = "video" if Path(src).suffix.lower() in (".mp4", ".webm") else "image"
        out.append(item)
    return out


@app.get("/studio", response_class=HTMLResponse)
def studio(request: Request):
    ctx = {"request": request, "studio": content.STUDIO, "game": content.GAME, "features": content.FEATURES, "values": content.VALUES,
           "roadmap": content.ROADMAP, "faq": content.FAQ, "suggestions": content.SUGGESTIONS, "media": _media(), "dev": _dev_ctx(request)}
    return templates.TemplateResponse(request, "studio.html", ctx)


@app.get("/get/windows")
def get_windows(request: Request):
    """Téléchargement public du Launcher : redirection vers le lien R2 configuré. Rien n'est servi par ce serveur."""
    ip = whitelist.client_ip(request)
    if not rate_ok("launcher-dl", ip, 30, per=600):
        raise HTTPException(429, "Too many downloads, please try again in a few minutes.")
    d = distribution.launcher()
    if not d["available"]:
        return PlainTextResponse("The download isn't available yet. Please check back soon.", status_code=503, headers={"Retry-After": "3600"})
    return RedirectResponse(d["url"], status_code=302, headers={"X-Robots-Tag": "noindex"})


_sha_cache = {}


def _sha(path: Path):
    st = path.stat()
    key = (str(path), st.st_mtime_ns, st.st_size)
    if key not in _sha_cache:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        _sha_cache.clear()
        _sha_cache[key] = h.hexdigest()
    return _sha_cache[key]


@app.get("/robots.txt", response_class=PlainTextResponse)
def robots():
    return "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /dev/\nDisallow: /get/\nDisallow: /launcher/\nDisallow: /m/\n"


@app.get("/healthz", response_class=PlainTextResponse)
def healthz():
    return "ok"


# ----------------------------------------------------------------------------- Assistant Support
class Ask(BaseModel):
    message: str


@app.post("/api/support")
def support(b: Ask, request: Request):
    ip = whitelist.client_ip(request)
    if not rate_ok("support", ip, 20):
        return JSONResponse({"reply": "You're typing fast. Give me a few seconds before the next question.", "suggestions": []}, status_code=429)
    if not b.message.strip():
        return {"reply": "Go ahead and ask your question.", "suggestions": content.SUGGESTIONS}
    r = assistant.answer(b.message)
    try:
        db.log_question(b.message, r["matched"])
    except Exception:                                      # le journal ne doit jamais empêcher de répondre
        pass
    return {"reply": r["reply"], "suggestions": r["suggestions"]}


# ----------------------------------------------------------------------------- accès développeur : téléchargement
@app.get("/dev/style.css")
def dev_css(request: Request):
    """Feuille de style de la zone développeur : servie seulement aux IP autorisées (aucune trace dans le CSS public)."""
    if not _dev_entry(request):
        raise HTTPException(404)
    return FileResponse(BASE / "private_assets" / "dev.css", media_type="text/css")


@app.get("/dev/telecharger")
def dev_download(request: Request):
    entry = _dev_entry(request)
    if not entry:
        raise HTTPException(404)                           # exactement la réponse d'une page qui n'existe pas
    ip = whitelist.client_ip(request) or whitelist.forwarded_ip(request) or "tailscale"      # clé de journal et de limitation de débit
    f = download_file()
    if not f.is_file():
        db.log_download(entry, ip, False)
        raise HTTPException(503, "The file has not been uploaded to the server yet.")
    if not rate_ok("dl", ip, 10, per=600):
        raise HTTPException(429, "Too many downloads, please try again in a few minutes.")
    db.log_download(entry, ip, True)
    return FileResponse(f, media_type="application/octet-stream", filename=f.name, headers={"X-Robots-Tag": "noindex"})    # le vrai nom (ex. ENOS-Setup-1.0.1-dev.exe), plus un « ENOS.exe » codé en dur


# ----------------------------------------------------------------------------- administration de la liste blanche
def _admin_guard(request: Request):
    """Jeton obligatoire (en-tête X-Admin-Token), comparaison en temps constant, 5 échecs/minute/IP puis blocage. Admin désactivée sans DP_ADMIN_TOKEN."""
    ip = whitelist.client_ip(request)
    tok = admin_token()
    if not tok:
        raise HTTPException(404)
    if not rate_ok("admin-ok", ip, 120):
        raise HTTPException(429)
    given = request.headers.get("x-admin-token", "")
    if not hmac.compare_digest(given.encode(), tok.encode()):
        if not rate_ok("admin-fail", ip, 5):
            raise HTTPException(429, "Trop d'essais.")
        raise HTTPException(401, "Jeton invalide.")
    return ip


@app.get(ADMIN_PATH, response_class=HTMLResponse, include_in_schema=False)
def admin_page(request: Request):
    if not admin_token():
        raise HTTPException(404)
    return templates.TemplateResponse(request, "admin.html", {"base": ADMIN_PATH})


class IpIn(BaseModel):
    ip: str
    label: str = ""
    days: int | None = None          # durée de validité (employés temporaires) ; vide = illimitée


@app.get(ADMIN_PATH + "/api/ips")
def admin_list(request: Request):
    ip = _admin_guard(request)
    db.purge_expired()
    return {"me": str(ip), "items": db.list_ips(), "downloads": db.downloads(30)}


@app.post(ADMIN_PATH + "/api/ips")
def admin_add(b: IpIn, request: Request):
    _admin_guard(request)
    if b.days is not None and not (1 <= b.days <= 3650):
        raise HTTPException(400, "Durée invalide (1 à 3650 jours).")
    try:
        entry = db.add_ip(b.ip, b.label, b.days)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "entry": entry}


@app.post(ADMIN_PATH + "/api/ips/me")
def admin_add_me(b: IpIn, request: Request):
    """Ajoute l'IP actuelle de l'administrateur (IP dynamique qui a changé) sans la taper."""
    ip = _admin_guard(request)
    if ip is None:
        raise HTTPException(400, "IP introuvable.")
    return {"ok": True, "entry": db.add_ip(str(ip), b.label or "Mon IP actuelle", b.days)}


@app.delete(ADMIN_PATH + "/api/ips")
def admin_remove(entry: str, request: Request):
    _admin_guard(request)
    if not db.remove_ip(entry):
        raise HTTPException(404, "Entrée inconnue.")
    return {"ok": True}


# ----------------------------------------------------------------------------- Dual Pulse Launcher : comptes, rôles, catalogue, manifestes signés (/launcher/v1)
launcher_api.install(app, _admin_guard, ADMIN_PATH)
codelab_api.install(app)                                        # Enos CodeLab : exécution de code en bac à sable (/launcher/v1/codelab)

# Le Launcher (Tauri) appelle l'API depuis son propre domaine (tauri://localhost, http(s)://tauri.localhost) : CORS limité à ces origines (DP_LAUNCHER_ORIGINS pour en ajouter).
# Aucun cookie n'est utilisé (jeton dans l'en-tête Authorization) : une page tierce ne peut donc rien faire au nom d'un utilisateur.
from starlette.middleware.cors import CORSMiddleware  # noqa: E402
app.add_middleware(CORSMiddleware, allow_origins=["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"] + [o.strip() for o in os.environ.get("DP_LAUNCHER_ORIGINS", "").split(",") if o.strip()],
                   allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type"], allow_credentials=False, max_age=600)
