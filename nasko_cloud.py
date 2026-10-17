"""Client cloud d'E.N.O.S. (PC) : session Dual Pulse (compte invité), PRESSE-PAPIERS UNIVERSEL téléphone <-> PC, liste des appareils du compte.

Sécurité et vie privée :
  * le mot de passe n'est JAMAIS enregistré : seule la session (jeton de rafraîchissement rotatif, révocable) est gardée dans nasko_config.json (profil courant) ;
  * la synchronisation du presse-papiers est DÉSACTIVÉE par défaut, dans chaque sens séparément (cloud_clip_up : PC -> cloud, cloud_clip_down : cloud -> PC) ;
  * un contenu marqué « à exclure » par un gestionnaire de mots de passe (format Windows ExcludeClipboardContentFromMonitorProcessing) n'est jamais envoyé ;
  * les textes de plus de 100 000 caractères et les images de plus de 2 Mo (base64) ne sont pas envoyés."""
import base64
import hashlib
import io
import logging
import os
import threading
import time

import httpx

import nasko_core

log = logging.getLogger("nasko.cloud")
V1 = "/launcher/v1"
MAX_TEXT, MAX_IMG_B64 = 100_000, 1_900_000
_lock = threading.RLock()
_access = {"token": "", "at": 0.0}


class CloudError(Exception):
    """Message lisible, affiché tel quel."""

    def __init__(self, msg, status=0, extra=None):
        super().__init__(msg)
        self.status, self.extra = status, extra or {}


def cfg():
    return nasko_core.load_config()


def base_url():
    return (cfg().get("cloud_url") or "").rstrip("/")


def valid_url(u):
    return bool(u) and (u.startswith("https://") or u.startswith("http://127.0.0.1") or u.startswith("http://localhost"))


def status():
    c = cfg()
    u = c.get("cloud_user") or {}
    return {"url": c.get("cloud_url", ""), "logged_in": bool(c.get("cloud_refresh")), "user": {"email": u.get("email", ""), "role": u.get("role", ""), "name": u.get("name", "")} if u else None,
            "clip_up": bool(c.get("cloud_clip_up", False)), "clip_down": bool(c.get("cloud_clip_down", False)), "agenda": bool(c.get("cloud_agenda", False)), "sync": sync.state()}


# ----------------------------------------------------------------------------- HTTP
def _client():
    return httpx.Client(timeout=httpx.Timeout(90.0, connect=15.0))          # l'hébergeur gratuit peut mettre une minute à se réveiller


def _raw(method, path, json=None, token=""):
    url = base_url()
    if not valid_url(url):
        raise CloudError("Adresse du serveur cloud non configurée.")
    headers = {"Authorization": "Bearer " + token} if token else {}
    try:
        with _client() as c:
            r = c.request(method, url + V1 + path, json=json, headers=headers)
    except httpx.HTTPError:
        raise CloudError("Serveur cloud injoignable.")
    try:
        data = r.json()
    except ValueError:
        data = {}
    return r.status_code, data


def _adopt(data):
    with _lock:
        _access.update(token=data["access_token"], at=time.time())
    nasko_core.update_config({"cloud_refresh": data["refresh_token"], "cloud_user": data.get("user") or {}})


def configure(url):
    url = (url or "").strip().rstrip("/")
    if not valid_url(url):
        raise CloudError("Adresse invalide : https:// obligatoire.")
    nasko_core.update_config({"cloud_url": url})
    return url


def login(url, email, password, totp=""):
    configure(url)
    st, d = _raw("POST", "/auth/login", {"email": email, "password": password, "totp": totp or "", "device": "PC"})
    if st != 200:
        raise CloudError(d.get("detail") or "Connexion refusée.", st, d)
    _adopt(d)
    return status()


def logout():
    rt = cfg().get("cloud_refresh")
    if rt:
        try:
            _raw("POST", "/auth/logout", {"refresh_token": rt})
        except CloudError:
            pass
    with _lock:
        _access.update(token="", at=0.0)
    nasko_core.update_config({"cloud_refresh": "", "cloud_user": {}})
    sync.stop()
    return status()


def _refresh():
    rt = cfg().get("cloud_refresh")
    if not rt:
        raise CloudError("Non connecté au cloud.", 401)
    st, d = _raw("POST", "/auth/refresh", {"refresh_token": rt})
    if st != 200:
        if st == 401:
            nasko_core.update_config({"cloud_refresh": "", "cloud_user": {}})        # session morte (révoquée / expirée) : il faut se reconnecter
        raise CloudError("Session cloud expirée : reconnectez-vous.", st)
    _adopt(d)


def request(method, path, json=None):
    """Appel authentifié ; renouvelle la session une fois si le jeton d'accès a expiré."""
    with _lock:
        token = _access["token"] if time.time() - _access["at"] < 600 else ""
    if not token:
        with _lock:
            _refresh()
            token = _access["token"]
    st, d = _raw(method, path, json, token)
    if st == 401:
        with _lock:
            _refresh()
            token = _access["token"]
        st, d = _raw(method, path, json, token)
    if st >= 400:
        raise CloudError(d.get("detail") or f"Erreur {st}", st, d)
    return d


def agenda_sync():
    """Agenda (tâches) <-> cloud, « la dernière modification gagne » par tâche. Les tâches sont mises dans la base du compte (Supabase) : option explicite (cloud_agenda)."""
    import nasko_agenda
    since = float(cfg().get("cloud_agenda_since") or 0)
    mine = nasko_agenda.changed_since(since)
    d = request("POST", "/agenda/sync", {"since": since, "tasks": mine[:500]})
    if d.get("tasks"):
        nasko_agenda.sync(d["tasks"], 0)                     # fusionne les tâches du cloud dans le fichier du PC (même règle)
    nasko_core.update_config({"cloud_agenda_since": float(d.get("now") or time.time())})
    return {"sent": len(mine), "received": len(d.get("tasks", []))}


def devices():
    return request("GET", "/devices").get("items", [])


# ----------------------------------------------------------------------------- presse-papiers du PC
class WinClipboard:
    """Presse-papiers Windows (ctypes + Pillow pour les images). Hors Windows : inerte."""
    EXCLUDE = "ExcludeClipboardContentFromMonitorProcessing"

    def available(self):
        return os.name == "nt"

    def _u(self):
        import ctypes
        from ctypes import wintypes
        u, k = ctypes.windll.user32, ctypes.windll.kernel32
        u.OpenClipboard.argtypes = [wintypes.HWND]; u.OpenClipboard.restype = wintypes.BOOL
        u.GetClipboardData.argtypes = [wintypes.UINT]; u.GetClipboardData.restype = wintypes.HANDLE
        u.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]; u.SetClipboardData.restype = wintypes.HANDLE
        u.RegisterClipboardFormatW.argtypes = [wintypes.LPCWSTR]; u.RegisterClipboardFormatW.restype = wintypes.UINT
        u.IsClipboardFormatAvailable.argtypes = [wintypes.UINT]; u.IsClipboardFormatAvailable.restype = wintypes.BOOL
        u.GetClipboardSequenceNumber.restype = wintypes.DWORD
        k.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]; k.GlobalAlloc.restype = wintypes.HGLOBAL
        k.GlobalLock.argtypes = [wintypes.HGLOBAL]; k.GlobalLock.restype = ctypes.c_void_p
        k.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
        return ctypes, u, k

    def seq(self):
        if not self.available():
            return 0
        _, u, _ = self._u()
        return int(u.GetClipboardSequenceNumber())

    def _open(self, u):
        for _ in range(10):                                  # le presse-papiers peut être tenu un instant par une autre application
            if u.OpenClipboard(None):
                return True
            time.sleep(0.05)
        return False

    def is_sensitive(self):
        if not self.available():
            return False
        _, u, _ = self._u()
        return bool(u.IsClipboardFormatAvailable(u.RegisterClipboardFormatW(self.EXCLUDE)))

    def get_text(self):
        if not self.available():
            return None
        ctypes, u, k = self._u()
        if not self._open(u):
            return None
        try:
            h = u.GetClipboardData(13)                      # CF_UNICODETEXT
            if not h:
                return None
            p = k.GlobalLock(h)
            try:
                return ctypes.wstring_at(p)
            finally:
                k.GlobalUnlock(h)
        finally:
            u.CloseClipboard()

    def get_image_jpeg(self):
        if not self.available():
            return None
        try:
            from PIL import Image, ImageGrab
            im = ImageGrab.grabclipboard()
            if not isinstance(im, Image.Image):
                return None
            im = im.convert("RGB")
            for side, q in ((1600, 82), (1280, 75), (1024, 68), (800, 60)):
                c = im.copy(); c.thumbnail((side, side))
                b = io.BytesIO(); c.save(b, "JPEG", quality=q)
                if len(base64.b64encode(b.getvalue())) <= MAX_IMG_B64:
                    return b.getvalue()
        except Exception:                                    # noqa: BLE001 — pas d'image, ou Pillow absent
            log.debug("lecture d'image du presse-papiers impossible", exc_info=True)
        return None

    def set_text(self, text):
        if not self.available():
            return False
        ctypes, u, k = self._u()
        data = (text + "\0").encode("utf-16-le")
        h = k.GlobalAlloc(0x0002, len(data))                # GMEM_MOVEABLE
        p = k.GlobalLock(h)
        ctypes.memmove(p, data, len(data))
        k.GlobalUnlock(h)
        if not self._open(u):
            return False
        try:
            u.EmptyClipboard()
            return bool(u.SetClipboardData(13, h))
        finally:
            u.CloseClipboard()

    def set_image(self, raw):
        if not self.available():
            return False
        from PIL import Image
        ctypes, u, k = self._u()
        out = io.BytesIO(); Image.open(io.BytesIO(raw)).convert("RGB").save(out, "BMP")
        dib = out.getvalue()[14:]                           # CF_DIB = BMP sans l'en-tête de fichier
        h = k.GlobalAlloc(0x0002, len(dib))
        p = k.GlobalLock(h)
        ctypes.memmove(p, dib, len(dib))
        k.GlobalUnlock(h)
        if not self._open(u):
            return False
        try:
            u.EmptyClipboard()
            return bool(u.SetClipboardData(8, h))           # CF_DIB
        finally:
            u.CloseClipboard()


class ClipSync:
    """Deux sens indépendants, chacun activé explicitement. Anti-écho : le contenu qu'on vient d'écrire / d'envoyer n'est jamais renvoyé."""

    def __init__(self, io_=None, get_cfg=None, req=None):
        self.io = io_ or WinClipboard()
        self.cfg = get_cfg or cfg
        self.req = req or request
        self.last_seq = None
        self.last_hash = ""
        self.last_agenda = 0.0
        self.since = None
        self.thread = None
        self._stop = threading.Event()
        self.info = {"running": False, "last_up": 0.0, "last_down": 0.0, "error": ""}

    def state(self):
        return dict(self.info)

    @staticmethod
    def _h(kind, content):
        return hashlib.sha256((kind + ":" + (content if isinstance(content, str) else base64.b64encode(content).decode())).encode()).hexdigest()

    def tick(self):
        c = self.cfg()
        if c.get("cloud_clip_down"):
            self._down()
        if c.get("cloud_clip_up"):
            self._up()
        if c.get("cloud_agenda") and time.time() - self.last_agenda > 60:
            self.last_agenda = time.time()
            agenda_sync()

    def _up(self):
        seq = self.io.seq()
        if seq == self.last_seq:
            return
        self.last_seq = seq
        if self.io.is_sensitive():                           # gestionnaire de mots de passe : jamais envoyé
            return
        text = self.io.get_text()
        if text and text.strip():
            if len(text) > MAX_TEXT:
                return
            h = self._h("text", text)
            if h == self.last_hash:
                return
            self.req("POST", "/clipboard", {"kind": "text", "content": text, "mime": "text/plain", "device": "pc"})
            self.last_hash = h; self.info["last_up"] = time.time()
            return
        img = self.io.get_image_jpeg()
        if img:
            h = self._h("image", img)
            if h == self.last_hash:
                return
            self.req("POST", "/clipboard", {"kind": "image", "mime": "image/jpeg", "content": base64.b64encode(img).decode(), "device": "pc"})
            self.last_hash = h; self.info["last_up"] = time.time()

    def _down(self):
        d = self.req("GET", "/clipboard?limit=10&since_id=" + str(self.since or 0))
        items = d.get("items", [])
        if self.since is None:                               # 1er passage : on repart de l'état actuel, on n'applique pas l'historique
            self.since = max([i["id"] for i in items] or [0])
            if not items:
                self.since = 0
            return
        for it in sorted(items, key=lambda i: i["id"]):
            self.since = max(self.since, it["id"])
        for it in sorted(items, key=lambda i: -i["id"]):     # le plus récent venant d'un autre appareil gagne
            if it.get("device") == "pc":
                continue
            if it["kind"] == "text":
                self.last_hash = self._h("text", it["content"])
                ok = self.io.set_text(it["content"])
            else:
                raw = base64.b64decode(it["content"])
                self.last_hash = self._h("image", raw)
                ok = self.io.set_image(raw)
            if ok:
                self.last_seq = self.io.seq()                # notre propre écriture n'est pas un nouveau contenu local
                self.info["last_down"] = time.time()
            break

    # ---- tâche de fond
    def start(self):
        if self.thread and self.thread.is_alive():
            return
        self._stop.clear()
        self.thread = threading.Thread(target=self._run, daemon=True, name="cloud-clip")
        self.thread.start()

    def stop(self):
        self._stop.set()
        self.info["running"] = False

    def _run(self):
        self.info["running"] = True
        delay = 2.0
        while not self._stop.is_set():
            c = self.cfg()
            if not c.get("cloud_refresh") or not (c.get("cloud_clip_up") or c.get("cloud_clip_down") or c.get("cloud_agenda")):
                self._stop.wait(3.0)
                continue
            try:
                self.tick(); self.info["error"] = ""; delay = 2.0
            except CloudError as e:
                self.info["error"] = str(e); delay = min(delay * 2, 60.0)
            except Exception as e:                          # noqa: BLE001 — la synchro ne doit jamais faire tomber le serveur
                log.warning("synchro presse-papiers : %s", e); self.info["error"] = "erreur interne"; delay = min(delay * 2, 60.0)
            self._stop.wait(delay)
        self.info["running"] = False


sync = ClipSync()


def set_sync(up=None, down=None, agenda=None):
    vals = {}
    if agenda is not None:
        vals["cloud_agenda"] = bool(agenda)
        if agenda:
            vals["cloud_agenda_since"] = 0.0                 # première synchro : échange complet
    if up is not None:
        vals["cloud_clip_up"] = bool(up)
    if down is not None:
        vals["cloud_clip_down"] = bool(down)
    nasko_core.update_config(vals)
    sync.since = None                                        # une réactivation repart de l'état courant
    if any(cfg().get(k) for k in ("cloud_clip_up", "cloud_clip_down", "cloud_agenda")) and cfg().get("cloud_refresh"):
        sync.start()
    return status()


def autostart():
    """Au démarrage du serveur : relance la synchro si elle était activée."""
    if cfg().get("cloud_refresh") and (cfg().get("cloud_clip_up") or cfg().get("cloud_clip_down") or cfg().get("cloud_agenda")):
        sync.start()
