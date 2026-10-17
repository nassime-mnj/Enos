"""YouTube Uploader : envoi d'une vidéo via l'API YouTube Data v3 (OAuth2 « application de bureau » + upload resumable).

Aucune bibliothèque Google : OAuth2 (boucle locale 127.0.0.1 + PKCE) et upload par morceaux en `httpx`, déjà embarqué dans E.N.O.S.
- Identifiants : `client_secret.json` (type « Application de bureau », créé dans Google Cloud Console), posé dans %LOCALAPPDATA%\\ENOS\\youtube\\.
- Jeton (refresh token) : %LOCALAPPDATA%\\ENOS\\youtube\\token.json — jamais dans le dossier de l'application (synchronisé par OneDrive).
- « Conçu pour les enfants » : TOUJOURS envoyé à False (`selfDeclaredMadeForKids`), sans option d'interface.
"""
import base64
import hashlib
import http.server
import json
import logging
import os
import secrets
import threading
import time
import urllib.parse
import webbrowser

import httpx

from nasko_core import app_dir, ssl_context

log = logging.getLogger("nasko.youtube")

SCOPE = "https://www.googleapis.com/auth/youtube.upload"
AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URI = "https://oauth2.googleapis.com/token"
UPLOAD_URI = "https://www.googleapis.com/upload/youtube/v3/videos"
CHUNK = 8 * 1024 * 1024                                  # multiple de 256 Kio, exigé par l'upload resumable
VIDEO_EXTS = (".mp4", ".mov", ".avi", ".wmv", ".flv", ".mkv", ".webm", ".mpg", ".mpeg", ".m4v", ".3gp")
VISIBILITY = {"public": "public", "unlisted": "unlisted", "private": "private"}
LABELS = {"public": "Public", "unlisted": "Non répertoriée", "private": "Privée"}
MAX_RETRY = 6
AUTH_TIMEOUT = 240


class YouTubeError(Exception):
    """Message lisible, affichable tel quel dans l'interface."""


# ----------------------------------------------------------------------------- fichiers de configuration
def config_dir():
    base = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local")
    p = os.path.join(base, "ENOS", "youtube")
    os.makedirs(p, exist_ok=True)
    return p


def _token_path():
    return os.path.join(config_dir(), "token.json")


def secret_path():
    """Premier `client_secret.json` trouvé (dossier de config, puis à côté de l'application), sinon None."""
    for p in (os.path.join(config_dir(), "client_secret.json"), os.path.join(app_dir(), "youtube_client_secret.json"), os.path.join(app_dir(), "client_secret.json")):
        if os.path.isfile(p):
            return p
    return None


def _client_secret():
    p = secret_path()
    if not p:
        raise YouTubeError("Identifiants Google introuvables : placez `client_secret.json` (OAuth « Application de bureau ») dans " + config_dir())
    try:
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        raise YouTubeError(f"client_secret.json illisible : {e}")
    c = data.get("installed") or data.get("web") or {}
    if not c.get("client_id"):
        raise YouTubeError("client_secret.json invalide : créez un identifiant OAuth de type « Application de bureau ».")
    return c


def _load_token():
    try:
        with open(_token_path(), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _save_token(tok):
    p = _token_path()
    with open(p + ".tmp", "w", encoding="utf-8") as f:
        json.dump(tok, f)
    os.replace(p + ".tmp", p)


def import_secret(src):
    """Copie un `client_secret.json` choisi par l'utilisateur dans le dossier de configuration, après avoir vérifié qu'il s'agit d'un identifiant OAuth valide."""
    try:
        with open(src, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        raise YouTubeError("Ce fichier n'est pas un JSON lisible.")
    c = data.get("installed") or data.get("web") or {}
    if not c.get("client_id") or not c.get("client_secret"):
        raise YouTubeError("Ce n'est pas un client_secret.json valide : créez un ID client OAuth de type « Application de bureau » et téléchargez son JSON.")
    dest = os.path.join(config_dir(), "client_secret.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(data, f)
    return dest


def disconnect():
    try:
        os.remove(_token_path())
    except OSError:
        pass


def authorized():
    t = _load_token()
    return bool(t and t.get("refresh_token"))


# ----------------------------------------------------------------------------- HTTP
def _http(**kw):
    """Client httpx (point d'injection pour les tests)."""
    return httpx.Client(timeout=httpx.Timeout(30, read=120), verify=ssl_context(), **kw)


def _google_error(resp):
    try:
        e = resp.json().get("error", {})
    except ValueError:
        e = {}
    if isinstance(e, str):
        return e
    reasons = [x.get("reason", "") for x in e.get("errors", []) if isinstance(x, dict)]
    msg = e.get("message", "") or resp.text[:200]
    if "quotaExceeded" in reasons or "dailyLimitExceeded" in reasons:
        return "Quota YouTube API épuisé pour aujourd'hui (un upload coûte 1600 unités sur 10 000). Réessayez demain."
    if "uploadLimitExceeded" in reasons:
        return "Limite d'envois de la chaîne atteinte : réessayez plus tard."
    if "youtubeSignupRequired" in reasons:
        return "Ce compte Google n'a pas de chaîne YouTube : créez-en une sur youtube.com."
    if "forbidden" in reasons or resp.status_code == 403:
        return f"Accès refusé par YouTube : {msg}"
    return f"YouTube a répondu {resp.status_code} : {msg}"


# ----------------------------------------------------------------------------- OAuth2 (boucle locale + PKCE)
def authorize(on_status=None, cancelled=lambda: False):
    """Ouvre le navigateur, attend l'autorisation de l'utilisateur, échange le code contre un jeton et le conserve."""
    c = _client_secret()
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(24)
    got = {}
    done = threading.Event()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if "code" in q or "error" in q:
                got.update({k: v[0] for k, v in q.items()})
                body = "<meta charset=utf-8><body style='font:16px sans-serif;background:#05080f;color:#9fe;text-align:center;padding-top:20vh'>" \
                       "<h2>E.N.O.S. : autorisation reçue</h2><p>Vous pouvez fermer cet onglet.</p>"
                done.set()
            else:
                body = "<meta charset=utf-8>…"
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body.encode())

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), Handler)           # port éphémère, strictement local
    redirect = f"http://127.0.0.1:{srv.server_address[1]}"
    url = AUTH_URI + "?" + urllib.parse.urlencode({
        "client_id": c["client_id"], "redirect_uri": redirect, "response_type": "code", "scope": SCOPE, "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256", "access_type": "offline", "prompt": "consent"})
    srv.timeout = 1
    if on_status:
        on_status("Navigateur ouvert : autorisez E.N.O.S. à envoyer des vidéos sur votre chaîne…")
    webbrowser.open(url)
    t0 = time.time()
    try:
        while not done.is_set() and time.time() - t0 < AUTH_TIMEOUT and not cancelled():
            srv.handle_request()
    finally:
        srv.server_close()
    if cancelled():
        raise YouTubeError("Connexion annulée.")
    if not got:
        raise YouTubeError("Autorisation expirée : relancez la connexion.")
    if got.get("state") != state:
        raise YouTubeError("Réponse d'autorisation invalide (state) : opération annulée par sécurité.")
    if "error" in got:
        raise YouTubeError("Autorisation refusée dans Google." if got["error"] == "access_denied" else f"Autorisation échouée : {got['error']}")
    with _http() as h:
        r = h.post(c.get("token_uri", TOKEN_URI), data={
            "code": got["code"], "client_id": c["client_id"], "client_secret": c.get("client_secret", ""),
            "redirect_uri": redirect, "grant_type": "authorization_code", "code_verifier": verifier})
    if r.status_code != 200:
        raise YouTubeError("Échange du jeton refusé : " + _google_error(r))
    tok = r.json()
    if not tok.get("refresh_token"):
        raise YouTubeError("Google n'a pas fourni de jeton de rafraîchissement : révoquez l'accès d'E.N.O.S. sur myaccount.google.com/permissions puis recommencez.")
    tok["expires_at"] = time.time() + int(tok.get("expires_in", 3600))
    _save_token(tok)


def access_token():
    """Jeton d'accès valide (rafraîchi automatiquement) ; YouTubeError si l'utilisateur doit se reconnecter."""
    tok = _load_token()
    if not tok or not tok.get("refresh_token"):
        raise YouTubeError("Non connecté : cliquez sur « CONNECTER MA CHAÎNE ».")
    if tok.get("access_token") and tok.get("expires_at", 0) > time.time() + 60:
        return tok["access_token"]
    c = _client_secret()
    try:
        with _http() as h:
            r = h.post(c.get("token_uri", TOKEN_URI), data={"client_id": c["client_id"], "client_secret": c.get("client_secret", ""),
                                                            "refresh_token": tok["refresh_token"], "grant_type": "refresh_token"})
    except httpx.HTTPError as e:
        raise YouTubeError(f"Google injoignable : {e.__class__.__name__}. Vérifiez la connexion internet.")
    if r.status_code != 200:
        if r.status_code in (400, 401):
            disconnect()
            raise YouTubeError("Accès révoqué ou expiré : reconnectez votre chaîne.")
        raise YouTubeError("Rafraîchissement du jeton refusé : " + _google_error(r))
    new = r.json()
    tok.update(access_token=new["access_token"], expires_at=time.time() + int(new.get("expires_in", 3600)))
    _save_token(tok)
    return tok["access_token"]


# ----------------------------------------------------------------------------- validation + corps de la requête
def validate(path, title, visibility):
    """Valide la saisie ; retourne (titre nettoyé, visibilité API). Lève YouTubeError avec un message clair."""
    if not path or not os.path.isfile(path):
        raise YouTubeError("Choisissez d'abord une vidéo.")
    if not path.lower().endswith(VIDEO_EXTS):
        raise YouTubeError("Format non pris en charge (" + ", ".join(VIDEO_EXTS) + ").")
    if os.path.getsize(path) == 0:
        raise YouTubeError("Le fichier vidéo est vide.")
    title = " ".join((title or "").split())
    if not title:
        raise YouTubeError("Le titre est obligatoire.")
    if len(title) > 100:
        raise YouTubeError(f"Titre trop long ({len(title)}/100 caractères).")
    if "<" in title or ">" in title:
        raise YouTubeError("Le titre ne peut pas contenir « < » ni « > » (interdit par YouTube).")
    if visibility not in VISIBILITY:
        raise YouTubeError("Visibilité invalide : Public, Non répertoriée ou Privée.")
    return title, VISIBILITY[visibility]


def build_body(title, privacy):
    """Corps de `videos.insert`. `selfDeclaredMadeForKids` est CODÉ EN DUR à False : jamais demandé, jamais modifiable par l'interface."""
    return {
        "snippet": {"title": title, "description": "", "categoryId": "22"},
        "status": {"privacyStatus": privacy, "selfDeclaredMadeForKids": False, "embeddable": True},
    }


# ----------------------------------------------------------------------------- upload resumable
def upload(path, title, visibility, progress=None, cancelled=lambda: False):
    """Envoie `path`. `progress(fraction, texte)` est appelé après chaque morceau. Retourne {id, url, privacy}."""
    title, privacy = validate(path, title, visibility)
    size = os.path.getsize(path)
    ctype = "video/*"
    token = access_token()
    with _http() as h:
        r = h.post(UPLOAD_URI, params={"uploadType": "resumable", "part": "snippet,status"}, json=build_body(title, privacy),
                   headers={"Authorization": f"Bearer {token}", "X-Upload-Content-Length": str(size), "X-Upload-Content-Type": ctype})
        if r.status_code != 200 or not r.headers.get("location"):
            raise YouTubeError(_google_error(r))
        session = r.headers["location"]
        offset, retry = 0, 0
        with open(path, "rb") as f:
            while True:
                if cancelled():
                    raise YouTubeError("Envoi annulé.")
                f.seek(offset)
                data = f.read(CHUNK)
                end = offset + len(data) - 1
                headers = {"Authorization": f"Bearer {access_token()}", "Content-Type": ctype,
                           "Content-Range": f"bytes {offset}-{end}/{size}"}
                try:
                    r = h.put(session, content=data, headers=headers)
                except httpx.HTTPError as e:
                    r = None
                    err = e.__class__.__name__
                if r is not None and r.status_code in (200, 201):
                    vid = r.json()
                    got = (vid.get("status") or {}).get("privacyStatus", privacy)
                    if progress:
                        progress(1.0, "Envoi terminé")
                    return {"id": vid["id"], "url": "https://youtu.be/" + vid["id"], "privacy": got, "requested": privacy}
                if r is not None and r.status_code == 308:
                    retry = 0
                    offset = _next_offset(r, offset + len(data))
                    if progress:
                        progress(min(offset / size, 0.999), f"{offset / 1048576:.0f} / {size / 1048576:.0f} Mo")
                    continue
                # erreur : 5xx / réseau → on interroge le serveur sur ce qu'il a reçu, puis on reprend ; 4xx → définitif
                if r is not None and r.status_code < 500 and r.status_code != 429:
                    raise YouTubeError(_google_error(r))
                retry += 1
                if retry > MAX_RETRY:
                    raise YouTubeError("Envoi interrompu : connexion instable. Relancez l'envoi." if r is None else _google_error(r))
                if progress:
                    progress(offset / size, f"Reconnexion ({retry}/{MAX_RETRY})…")
                time.sleep(min(2 ** retry, 30))
                offset = _query_offset(h, session, size, offset)


def _next_offset(resp, fallback):
    """Octet suivant attendu, d'après l'en-tête `Range: bytes=0-N` de la réponse 308."""
    rng = resp.headers.get("range", "")
    if rng.startswith("bytes=0-"):
        try:
            return int(rng.split("-")[1]) + 1
        except ValueError:
            pass
    return fallback


def _query_offset(h, session, size, current):
    try:
        r = h.put(session, headers={"Content-Range": f"bytes */{size}", "Authorization": f"Bearer {access_token()}"})
        if r.status_code == 308:
            return _next_offset(r, 0)
    except httpx.HTTPError:
        pass
    return current


# ----------------------------------------------------------------------------- tâche d'arrière-plan (état lu par l'interface)
_lock = threading.Lock()
JOB = {"phase": "idle", "progress": 0.0, "message": "", "log": [], "result": None, "cancel": False}


def _log(msg, phase=None, progress=None):
    with _lock:
        JOB["log"].append(time.strftime("%H:%M:%S ") + msg)
        del JOB["log"][:-60]
        JOB["message"] = msg
        if phase:
            JOB["phase"] = phase
        if progress is not None:
            JOB["progress"] = progress


def state():
    with _lock:
        s = {k: (list(v) if isinstance(v, list) else v) for k, v in JOB.items() if k != "cancel"}
    s.update(configured=secret_path() is not None, authorized=authorized(), config_dir=config_dir(), busy=s["phase"] in ("auth", "uploading", "setup"))
    return s


def _start(phase, target):
    with _lock:
        if JOB["phase"] in ("auth", "uploading", "setup"):
            raise YouTubeError("Une opération YouTube est déjà en cours.")
        JOB.update(phase=phase, progress=0.0, message="", log=[], result=None, cancel=False)
    threading.Thread(target=target, daemon=True, name="enos-youtube").start()


# ----------------------------------------------------------------------------- configuration AUTOMATIQUE de l'identifiant Google
# Google exige qu'une application déclare un « ID client OAuth », créé dans SON compte Cloud (personne ne peut le faire à la place de l'utilisateur).
# E.N.O.S. automatise tout le reste : ouvre les bonnes pages, détecte le JSON dès qu'il est téléchargé, l'importe, puis enchaîne sur la connexion Google.
CLOUD_PAGES = (
    "https://console.cloud.google.com/apis/library/youtube.googleapis.com",         # 1. activer « YouTube Data API v3 »
    "https://console.cloud.google.com/apis/credentials/consent",                    # 2. écran de consentement (Externe ; ajouter son Gmail ; publier)
    "https://console.cloud.google.com/apis/credentials/oauthclient",                # 3. ID client OAuth « Application de bureau » -> TÉLÉCHARGER LE JSON
)
SETUP_TIMEOUT = 20 * 60


def find_downloaded_secret():
    """Chemin du client_secret*.json valide le plus récent dans Téléchargements (Google le nomme client_secret_<id>.apps.googleusercontent.com.json), sinon None."""
    import glob
    import nasko_paths
    cands = glob.glob(os.path.join(nasko_paths.user_dir("downloads"), "client_secret*.json"))
    for p in sorted(cands, key=os.path.getmtime, reverse=True):
        try:
            with open(p, encoding="utf-8") as f:
                c = (json.load(f).get("installed") or {})
            if c.get("client_id") and c.get("client_secret"):
                return p
        except (OSError, ValueError, AttributeError):
            continue
    return None


def start_connect():
    """Bouton « CONNECTER À YOUTUBE » : (1) identifiant déjà là -> connexion Google ; (2) JSON déjà téléchargé -> import automatique ; (3) sinon ouvre Google Cloud et ATTEND le JSON."""
    def run():
        try:
            if not secret_path():
                src = find_downloaded_secret()
                if not src:
                    _log("Configuration automatique : ouverture de Google Cloud dans votre navigateur…", "setup")
                    for u in CLOUD_PAGES:
                        webbrowser.open(u)
                        time.sleep(1.2)
                    _log("① Activez « YouTube Data API v3 » (bouton ACTIVER).  ② Écran de consentement : type EXTERNE, ajoutez votre Gmail en utilisateur test, puis PUBLIER L'APPLICATION "
                         "(évite l'expiration du jeton après 7 jours).  ③ Identifiants → ID client OAuth → « Application de bureau » → CRÉER → TÉLÉCHARGER LE JSON.  "
                         "E.N.O.S. détecte le fichier tout seul.")
                    t0 = time.time()
                    while not src and time.time() - t0 < SETUP_TIMEOUT:
                        if JOB["cancel"]:
                            raise YouTubeError("Connexion annulée.")
                        time.sleep(2)
                        src = find_downloaded_secret()
                    if not src:
                        raise YouTubeError("Aucun client_secret.json téléchargé : relancez « CONNECTER À YOUTUBE » quand il est prêt.")
                    time.sleep(1)
                import_secret(src)
                _log("Identifiant Google détecté et configuré automatiquement.")
            _log("Connexion à Google : choisissez votre compte puis autorisez E.N.O.S.", "auth")
            authorize(lambda m: _log(m), cancelled=lambda: JOB["cancel"])
            _log("Chaîne connectée : vous pouvez envoyer une vidéo.", "idle")
        except YouTubeError as e:
            _log(str(e), "cancelled" if "annulée" in str(e) else "error")
        except Exception as e:
            log.exception("connexion YouTube")
            _log(f"Erreur inattendue : {e}", "error")
    _start("setup", run)


def start_auth():
    _client_secret()                                                      # échec immédiat et clair si les identifiants manquent

    def run():
        try:
            _log("Connexion à Google…", "auth")
            authorize(lambda m: _log(m))
            _log("Chaîne connectée : vous pouvez envoyer une vidéo.", "idle")
        except YouTubeError as e:
            _log(str(e), "error")
        except Exception as e:                                           # ne jamais laisser le thread mourir en silence
            log.exception("auth YouTube")
            _log(f"Erreur inattendue : {e}", "error")
    _start("auth", run)


def start_upload(path, title, visibility):
    title, _ = validate(path, title, visibility)                         # validation synchrone : l'erreur remonte au clic
    if not authorized():
        raise YouTubeError("Non connecté : cliquez sur « CONNECTER MA CHAÎNE ».")

    def run():
        try:
            _log(f"Envoi de « {title} » ({LABELS[visibility]})…", "uploading", 0.0)
            res = upload(path, title, visibility, progress=lambda f, t: _log(t, progress=f), cancelled=lambda: JOB["cancel"])
            warn = ""
            if res["privacy"] != res["requested"]:
                warn = " ⚠ YouTube a verrouillé la vidéo en PRIVÉ : projet API non audité (voir GUIDE)."
            with _lock:
                JOB["result"] = res
            _log("Terminé : " + res["url"] + warn, "done", 1.0)
        except YouTubeError as e:
            _log(str(e), "cancelled" if "annulé" in str(e) else "error")
        except Exception as e:
            log.exception("upload YouTube")
            _log(f"Erreur inattendue : {e}", "error")
    _start("uploading", run)


def cancel():
    with _lock:
        JOB["cancel"] = True
