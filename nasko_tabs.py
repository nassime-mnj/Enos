"""Gestion Google : liste, miniatures et fermeture des onglets du Chrome connecté en CDP (Playwright).

Optimisations (des dizaines d'onglets, sans faire ramer le PC) :
  - une SEULE connexion CDP persistante, dans un thread dédié (l'API sync de Playwright est liée à son thread) ;
  - la liste (titre + URL) vient de Target.getTargets : ~30 ms, aucun onglet n'est touché ni réveillé ;
  - les miniatures sont demandées une par une (l'interface ne demande que les cartes visibles), réduites PAR CHROME
    (Page.captureScreenshot avec clip.scale -> 320 px de large, JPEG qualité 45 : 1 à 15 Ko au lieu de 100 Ko et plus) ;
  - cache à durée limitée (LRU) : une miniature n'est recalculée qu'après expiration ou changement d'URL/titre.
"""
import base64
import logging
import queue
import threading
import time
from collections import OrderedDict
from urllib.parse import urlparse

import nasko_ext
import nasko_webauto

log = logging.getLogger("nasko.tabs")

THUMB_WIDTH = 320            # largeur cible (px) de la miniature
THUMB_QUALITY = 45
THUMB_TTL = 90               # secondes avant qu'une miniature soit redemandée
CACHE_MAX = 120
CAPTURE_TIMEOUT = 6          # secondes max pour capturer UN onglet (onglet gelé / en veille)
CALL_TIMEOUT = 30


class TabsError(Exception):
    def __init__(self, msg, code="error"):
        super().__init__(msg)
        self.code = code


class _Manager:
    def __init__(self):
        self.q = queue.Queue()
        self.thread = None
        self.pw = None
        self.browser = None
        self.pages = {}                          # targetId -> Page (objets Playwright de la connexion courante)
        self.cache = OrderedDict()               # targetId -> {t, sig, thumb}
        self.guard = threading.Lock()

    # ---- thread dédié ---------------------------------------------------------------------------
    def _loop(self, q):
        while True:
            fn, args, box, done = q.get()
            try:
                box["v"] = fn(*args)
            except BaseException as e:           # transmis à l'appelant
                box["e"] = e
            finally:
                done.set()

    def call(self, fn, *args, timeout=CALL_TIMEOUT):
        with self.guard:
            if self.thread is None or not self.thread.is_alive():
                self.thread = threading.Thread(target=self._loop, args=(self.q,), daemon=True, name="tabs-cdp")
                self.thread.start()
        box, done = {}, threading.Event()
        self.q.put((fn, args, box, done))
        if not done.wait(timeout):
            # un onglet gelé peut bloquer l'appel CDP indéfiniment : on abandonne ce thread et on repart d'une connexion neuve
            with self.guard:
                self.q, self.thread, self.pw, self.browser, self.pages = queue.Queue(), None, None, None, {}
            raise TabsError("Chrome ne répond pas (onglet gelé ?) : connexion réinitialisée.", "timeout")
        if "e" in box:
            raise box["e"]
        return box.get("v")

    # ---- connexion (exécuté dans le thread dédié) ------------------------------------------------
    def _connect(self):
        if self.browser is not None:
            try:
                if self.browser.is_connected():
                    return self.browser
            except Exception:
                pass
            self.browser, self.pages = None, {}
        port = nasko_webauto.cdp_port()
        if not port:
            if nasko_webauto.chrome_running():
                raise TabsError("Chrome est ouvert, mais sans port de débogage : E.N.O.S. ne peut piloter que le Chrome lancé avec "
                                "--remote-debugging-port (depuis Chrome 136 le profil habituel l'ignore). Cliquez sur « OUVRIR LE CHROME E.N.O.S. » : "
                                "un Chrome au profil dédié s'ouvre à côté du vôtre.", "no_cdp")
            raise TabsError(f"Aucun Chrome n'est ouvert (port de débogage {nasko_webauto._port()}).", "no_cdp")
        from playwright.sync_api import sync_playwright
        if self.pw is None:
            self.pw = sync_playwright().start()
        try:
            self.browser = self.pw.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
        except Exception as e:
            raise TabsError("Connexion CDP impossible : " + str(e)[:150], "no_cdp")
        return self.browser

    def _page_map(self, br):
        """targetId -> Page pour tous les contextes (ids obtenus une fois par page puis mémorisés)."""
        live = {}
        for ctx in br.contexts:
            for pg in ctx.pages:
                tid = getattr(pg, "_nasko_tid", None)
                if tid is None:
                    cd = ctx.new_cdp_session(pg)
                    try:
                        tid = cd.send("Target.getTargetInfo")["targetInfo"]["targetId"]
                    finally:
                        cd.detach()
                    try:
                        pg._nasko_tid = tid
                    except Exception:
                        pass
                live[tid] = (pg, ctx)
        return live

    # ---- opérations -----------------------------------------------------------------------------
    def _list(self):
        br = self._connect()
        bs = br.new_browser_cdp_session()
        try:
            infos = [t for t in bs.send("Target.getTargets")["targetInfos"] if t.get("type") == "page"]
        finally:
            bs.detach()
        out, alive = [], set()
        for t in infos:
            tid, url, title = t["targetId"], t.get("url", ""), t.get("title", "") or ""
            alive.add(tid)
            host = urlparse(url).netloc or url.split(":")[0]
            c = self.cache.get(tid)
            fresh = c and time.time() - c["t"] < THUMB_TTL and c["sig"] == url
            out.append({"id": tid, "title": title or "(sans titre)", "url": url, "host": host.replace("www.", ""),
                        "internal": url.startswith(("chrome://", "devtools://", "chrome-extension://", "about:", "chrome-untrusted://")),
                        "thumb": c["thumb"] if fresh else None})
        for tid in [k for k in self.cache if k not in alive]:
            self.cache.pop(tid, None)
        return out

    def _thumb(self, tid):
        br = self._connect()
        live = self._page_map(br)
        if tid not in live:
            raise TabsError("Onglet introuvable (déjà fermé ?).", "gone")
        pg, ctx = live[tid]
        cd = ctx.new_cdp_session(pg)
        try:
            m = cd.send("Page.getLayoutMetrics")["cssVisualViewport"]
            vw, vh = max(1, m["clientWidth"]), max(1, m["clientHeight"])
            r = cd.send("Page.captureScreenshot", {"format": "jpeg", "quality": THUMB_QUALITY, "fromSurface": True,
                                                  "clip": {"x": 0, "y": 0, "width": vw, "height": vh, "scale": min(1.0, THUMB_WIDTH / vw)}})
        finally:
            try:
                cd.detach()
            except Exception:
                pass
        thumb = "data:image/jpeg;base64," + r["data"]
        self.cache[tid] = {"t": time.time(), "sig": pg.url, "thumb": thumb}
        self.cache.move_to_end(tid)
        while len(self.cache) > CACHE_MAX:
            self.cache.popitem(last=False)
        return thumb

    def _close(self, tid):
        br = self._connect()
        live = self._page_map(br)
        self.cache.pop(tid, None)
        if tid in live:
            live[tid][0].close(run_before_unload=False)               # page.close() : ferme précisément cet onglet
            return True
        bs = br.new_browser_cdp_session()                               # onglet non rattaché à un contexte Playwright : repli CDP
        try:
            return bool(bs.send("Target.closeTarget", {"targetId": tid}).get("success"))
        finally:
            bs.detach()

    def _reset(self):
        try:
            if self.browser:
                self.browser.close()
        except Exception:
            pass
        self.browser, self.pages = None, {}


M = _Manager()


# ----------------------------------------------------------------------------- API publique
def list_tabs():
    if nasko_ext.connected():                              # extension Chrome : vos vrais onglets, sans port de débogage
        tabs = nasko_ext.list_tabs()
        return {"ok": True, "tabs": tabs, "count": len(tabs), "source": "extension"}
    try:
        tabs = M.call(M._list)
    except TabsError as e:
        if e.code == "no_cdp":
            return {"ok": False, "code": "no_cdp", "message": str(e), "port": nasko_webauto._port(), "chrome_running": nasko_webauto.chrome_running()}
        raise
    return {"ok": True, "tabs": tabs, "count": len(tabs)}


def thumb(tab_id):
    if str(tab_id).startswith("x:"):
        t = nasko_ext.thumb(tab_id)
        return {"ok": True, "id": tab_id, "thumb": t, "ms": 0} if t else {"ok": False, "id": tab_id, "reason": "capture", "message": "pas de miniature (onglet en arrière-plan)"}
    try:
        t0 = time.time()
        data = M.call(M._thumb, tab_id, timeout=CAPTURE_TIMEOUT + 4)
        return {"ok": True, "id": tab_id, "thumb": data, "ms": int((time.time() - t0) * 1000)}
    except TabsError as e:
        return {"ok": False, "id": tab_id, "reason": e.code, "message": str(e)}
    except Exception as e:                      # onglet gelé, page interne sans rendu, etc. : l'interface affiche un visuel de repli
        return {"ok": False, "id": tab_id, "reason": "capture", "message": str(e)[:120]}


def close_tab(tab_id):
    if str(tab_id).startswith("x:"):
        ok = nasko_ext.close_tab(tab_id)
        return {"ok": ok, "id": tab_id} if ok else {"ok": False, "id": tab_id, "message": "L'extension n'a pas confirmé la fermeture (Chrome fermé ou extension inactive ?)."}
    try:
        return {"ok": bool(M.call(M._close, tab_id)), "id": tab_id}
    except TabsError as e:
        return {"ok": False, "id": tab_id, "message": str(e)}
    except Exception as e:
        return {"ok": False, "id": tab_id, "message": str(e)[:150]}


def open_chrome():
    """Lance (si besoin) le Chrome E.N.O.S. avec le port de débogage. Retourne le port."""
    return nasko_webauto.ensure_chrome()
