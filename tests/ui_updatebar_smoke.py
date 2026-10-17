"""Bannière « mise à jour prête » (navigateur, API simulée). Lancer : python3 tests/ui_updatebar_smoke.py"""
import json, os, sys, tempfile, threading, http.server, socketserver, functools
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = tempfile.mkdtemp(prefix="upb_"); os.makedirs(D + "/static")
for f in ("updatebar.js", "updatebar.css"):
    os.symlink(os.path.join(ROOT, "static", f), D + "/static/" + f)
open(D + "/index.html", "w").write('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/static/updatebar.css"></head><body><p>E.N.O.S.</p><script src="/static/updatebar.js"></script></body></html>')
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".css": "text/css"}
srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(H, directory=D)); srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://127.0.0.1:%d/" % srv.server_address[1]
BAD = []
def check(c, m):
    print(("OK   " if c else "FAIL ") + m)
    if not c: BAD.append(m)

state = {"ready": None, "applied": None}; posts = []
with sync_playwright() as pw:
    kw = {"executable_path": "/opt/pw-browsers/chromium"} if os.path.exists("/opt/pw-browsers/chromium") else {}
    b = pw.chromium.launch(args=["--no-sandbox"], **kw); ctx = b.new_context(viewport={"width": 1200, "height": 700}); pg = ctx.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    def h(route):
        r = route.request; path = urlparse(r.url).path
        if r.method == "POST": posts.append(path); return route.fulfill(json={"ok": True})
        return route.fulfill(json={"managed": True, "ready": state["ready"], "applied": state["applied"], "pending_apply": False})
    pg.route("**/api/**", h)
    pg.goto(URL); pg.wait_for_timeout(3600)
    check(pg.locator(".upd-bar").count() == 0, "aucune bannière quand rien n'est prêt")
    state["ready"] = {"version": "3.2.0", "notes": "<b>Notes</b>"}
    pg.evaluate("window.ensureUpdateBar()"); pg.wait_for_selector(".upd-bar")
    t = pg.inner_text(".upd-bar"); check("Une mise à jour est prête" in t and "3.2.0" in t and "Redémarrer pour appliquer" in t and "Plus tard" in t, "bannière : texte et deux boutons (%r)" % t[:80])
    check(pg.evaluate("document.querySelector('.upd-msg').title") == "<b>Notes</b>" and pg.locator(".upd-msg b").count() == 1, "notes du serveur affichées en texte brut (pas de HTML injecté)")
    box = pg.locator(".upd-bar").bounding_box(); check(box["x"] > 600 and box["y"] > 500 and box["height"] < 120, "bannière discrète : coin bas-droit, petite")
    pg.click(".upd-later"); check(pg.locator(".upd-bar").count() == 0, "« Plus tard » masque la bannière")
    pg.evaluate("window.ensureUpdateBar()"); pg.wait_for_timeout(500); check(pg.locator(".upd-bar").count() == 0, "elle ne revient pas tout de suite (4 h)")
    state["ready"] = {"version": "3.3.0", "notes": ""}; pg.evaluate("window.ensureUpdateBar()"); pg.wait_for_selector(".upd-bar")
    check("3.3.0" in pg.inner_text(".upd-bar"), "une version plus récente réaffiche la bannière")
    pg.click(".upd-go"); pg.wait_for_function("document.querySelector('.upd-msg').textContent.includes('se ferme')", timeout=3000)
    check("/api/update/launcher/apply" in posts and pg.locator(".upd-go").count() == 0, "« Redémarrer » : appel apply puis message « se ferme »")
    state.update(ready=None, applied={"version": "3.3.0"}); pg2 = ctx.new_page(); pg2.route("**/api/**", h); pg2.goto(URL); pg2.wait_for_selector(".upd-done", timeout=8000)
    check("3.3.0" in pg2.inner_text(".upd-done") and "/api/update/launcher/applied/seen" in posts, "après relance : « mis à jour vers 3.3.0 » + acquittement")
    check(not errs, "aucune erreur JavaScript : %s" % errs[:3]); b.close()
print("ECHECS:", BAD or "aucun"); sys.exit(1 if BAD else 0)
