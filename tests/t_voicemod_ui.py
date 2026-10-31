"""Voice Changer (interface PC) : ouverture, 54 cartes, catégories, recherche, favoris, curseurs, voix perso, API (sans démarrer l'audio). Serveur de dev sur 8792."""
import json
import os
import re
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import nasko_voicemod as vm

vm._file = lambda: os.path.join(tempfile.gettempdir(), "voicemod_test.json")      # ne touche jamais aux vraies donnees
if os.path.exists(vm._file()):
    os.remove(vm._file())
INDEX = open(os.path.join(ROOT, "static", "index.html"), encoding="utf-8").read()
SECTION = re.search(r'<section id="vm".*?</section>', INDEX, re.S).group(0)
PAGE = ('<!doctype html><meta charset="utf-8"><meta name="nasko-token" content="t"><link rel="stylesheet" href="/static/voicemod.css"><body style="margin:0;background:#000;--h:356">'
        '<button id="b-vm">open</button>' + SECTION + '<script src="/static/voicemod.js"></script>')


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

    def do_GET(self):
        if self.path == "/":
            return self._send(200, PAGE.encode(), "text/html; charset=utf-8")
        if self.path.startswith("/static/"):
            f = open(os.path.join(ROOT, self.path[1:]), "rb").read()
            return self._send(200, f, "text/css" if self.path.endswith(".css") else "text/javascript")
        if self.path == "/api/voicemod/catalog":
            return self._send(200, vm.catalog())
        if self.path == "/api/voicemod/devices":
            return self._send(200, vm.Engine.devices())
        if self.path == "/api/voicemod/state":
            return self._send(200, vm.ENGINE.state())
        self._send(404, {})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        b = json.loads(self.rfile.read(n) or b"{}")
        try:
            if self.path == "/api/voicemod/user":
                return self._send(200, {"user": vm.save_user(b["name"], b["params"])})
            if self.path == "/api/voicemod/user/delete":
                return self._send(200, {"user": vm.delete_user(b["id"])})
            if self.path == "/api/voicemod/prefs":
                vm.remember(**{k: v for k, v in b.items() if v is not None})
                return self._send(200, {"ok": True})
            if self.path == "/api/voicemod/params":
                vm.ENGINE.set_params(preset=b.get("preset", ""), params=b.get("params"), bypass=b.get("bypass"))
                return self._send(200, vm.ENGINE.state())
        except vm.VoiceModError as e:
            return self._send(400, {"detail": str(e)})
        self._send(404, {})


srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://127.0.0.1:%d/" % srv.server_address[1]

BAD = []
SHOTS = os.environ.get("SHOTS", "")


def check(c, m):
    print(("OK   " if c else "FAIL ") + m)
    if not c:
        BAD.append(m)


errs = []
with sync_playwright() as pw:
    kw = {"executable_path": os.environ["CHROMIUM"]} if os.environ.get("CHROMIUM") else {}
    b = pw.chromium.launch(args=["--no-sandbox"], **kw)
    pg = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(URL)
    pg.wait_for_selector("#b-vm", state="attached", timeout=20000)
    pg.evaluate("document.getElementById('b-vm').click()")
    pg.wait_for_selector("#vm:not([hidden]) .vm-card", timeout=15000)
    check(pg.locator(".vm-card").count() >= 54, "%d cartes de voix" % pg.locator(".vm-card").count())
    check(pg.locator(".vm-cat").count() == 10, "10 onglets (toutes, favoris, 7 catégories, mes voix)")
    check(pg.locator(".vm-sl").count() >= 28, "%d curseurs de réglage" % pg.locator(".vm-sl").count())
    check(pg.locator("#vm-in option").count() >= 1, "micros listés : %d" % pg.locator("#vm-in option").count())
    check(pg.inner_text("#vm-cable").strip() != "", "bandeau câble virtuel : " + pg.inner_text("#vm-cable")[:60].replace("\n", " "))
    # catégorie + recherche
    pg.click('.vm-cat[data-t="robot"]')
    n = pg.locator(".vm-card").count()
    check(n == 8, "catégorie ROBOT & SF : %d voix" % n)
    pg.click('.vm-cat[data-t="all"]')
    pg.fill("#vm-q", "dalek")
    check(pg.locator(".vm-card").count() == 1, "recherche « dalek »")
    pg.fill("#vm-q", "")
    # sélection : les curseurs prennent les valeurs de la voix
    pg.click('.vm-card[data-id="chipmunk"]')
    check(pg.locator('.vm-card[data-id="chipmunk"].on').count() == 1, "voix Tamia sélectionnée")
    check(pg.input_value('.vm-sl[data-k="pitch"] input') == "10", "curseur Hauteur = +10 st")
    check("Tamia" in pg.inner_text("#vm-now-n"), "titre : " + pg.inner_text("#vm-now-n"))
    # modifier un curseur -> voix « personnalisée » -> enregistrement
    pg.evaluate("""() => { const i = document.querySelector('.vm-sl[data-k="echo_ms"] input'); i.value = 300; i.dispatchEvent(new Event('input', {bubbles: true})); }""")
    check(pg.locator(".vm-card.on").count() == 0 and "personnalisée" in pg.inner_text("#vm-now-n"), "curseur modifié : voix personnalisée")
    pg.fill("#vm-name", "Ma voix test")
    pg.click("#vm-saveb")
    pg.wait_for_selector('.vm-cat[data-t="user"].on')
    check(pg.locator(".vm-card").count() == 1 and "Ma voix test" in pg.inner_text(".vm-card .nm"), "voix perso enregistrée et affichée dans MES VOIX")
    # favoris
    pg.click('.vm-cat[data-t="all"]')
    pg.click('.vm-card[data-id="ghost"] .st')
    pg.click('.vm-cat[data-t="fav"]')
    check(pg.locator(".vm-card").count() == 1, "favori ajouté")
    pg.click('.vm-card[data-id="ghost"] .st')
    # nettoyage de la voix perso
    pg.click('.vm-cat[data-t="user"]')
    pg.click(".vm-del")
    pg.wait_for_function("document.querySelectorAll('.vm-card').length === 0")
    check(True, "voix perso supprimée")
    pg.click('.vm-cat[data-t="all"]')
    pg.wait_for_timeout(600)
    if SHOTS:
        pg.click('.vm-card[data-id="demon"]')
        pg.wait_for_timeout(500)
        pg.screenshot(path=os.path.join(SHOTS, "vm_ui.png"))
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
print("ECHECS :", BAD if BAD else "aucun")
sys.exit(1 if BAD else 0)
