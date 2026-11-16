"""Interface PC : cartes COPILOTE DE JEU et JOURNAL DE PLANTAGES (static/gaming.js) avec un faux serveur ; sans erreur JS, réglages et question envoyés."""
import json, os, threading, http.server
from mobile_common import *

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "static"))
posts = []
state = {"enabled": False, "game": "", "goal": "", "mode": "text", "focus": "screen", "interval": 6, "process": "", "need_game": False, "alerts_only": False, "running": False, "paused": False, "waiting": False,
         "last_advice": "", "summary": "vu : combat", "frames": 3, "calls": 2, "error": "", "latency": 1.4, "history": [{"t": 1, "advice": "Recule derrière le mur", "urgency": 2}]}


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass
    def _j(self, o): b = json.dumps(o).encode(); self.send_response(200); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.startswith("/api/gamecoach/status"): return self._j(state)
        if self.path.startswith("/api/crash/log"): return self._j({"text": "[2026-01-02 10:00:00] PYTHON · boum\n", "count": 1})
        if self.path.startswith("/api/"): return self._j({})
        if self.path == "/t.html": b = b'<!doctype html><meta name="nasko-token" content="tok"><div id="rg"><div data-p="th"></div></div><script src="/crashlog.js"></script><script src="/gaming.js"></script>'; self.send_response(200); self.send_header("content-type", "text/html"); self.end_headers(); return self.wfile.write(b)
        return super().do_GET()
    def do_POST(self):
        n = int(self.headers.get("content-length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); posts.append((self.path, body))
        if self.path.endswith("/ask"): return self._j({"answer": "Achète une armure."})
        state.update({k: v for k, v in body.items() if k in state}); return self._j(state)


srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)[:200])); pg.set_default_timeout(20000)
    pg.goto("http://127.0.0.1:%d/t.html" % srv.server_address[1]); pg.wait_for_selector("#gm-root")
    pg.wait_for_function("document.body.innerText.includes('COPILOTE DE JEU') && document.body.innerText.includes('Recule derrière le mur') && document.body.innerText.includes('boum')")
    check(True, "cartes Copilote de jeu et Journal de plantages affichées (historique + journal)")
    pg.fill('input[placeholder^="Jeu"]', "Valorant"); pg.press('input[placeholder^="Jeu"]', "Tab")
    pg.fill('input[placeholder^="Pose une question"]', "Que dois-je acheter ?"); pg.click("text=DEMANDER")
    pg.wait_for_function("document.body.innerText.includes('Achète une armure.')")
    check(any(p == "/api/gamecoach/config" and b_.get("game") == "Valorant" for p, b_ in posts), "le nom du jeu est enregistré : %s" % [x for x in posts][:2])
    check(any(p == "/api/gamecoach/ask" for p, _ in posts), "la question part au copilote et la réponse s'affiche")
    pg.click("text=PAUSE"); pg.wait_for_timeout(300)
    check(any(p == "/api/gamecoach/pause" and b_.get("paused") is True for p, b_ in posts), "bouton PAUSE")
    pg.evaluate("setTimeout(() => { throw new Error('erreur de page test'); }, 5)"); pg.wait_for_timeout(600)
    check(any(p == "/api/crash/log" and "erreur de page test" in b_.get("msg", "") for p, b_ in posts), "une erreur de page est envoyée au journal du PC")
    other = [e for e in errs if "erreur de page test" not in e and "reading 'slice'" not in e]   # les autres cartes (clipper…) lisent des réponses que le faux serveur ne fournit pas
    check(not other, "aucune erreur JS inattendue : %s" % other[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
