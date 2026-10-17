"""Interface Dépôt Intranet (navigateur, API simulée) : ouverture, Forge + compte à rebours, Monaco réel (auto-indentation 4 espaces), onglets Git/Sujet/Entraînement/Dépôt Shell, modale ENVOYER.
Lancer : python3 tests/ui_depot_smoke.py"""
import json, os, sys, tempfile, threading, http.server, socketserver, functools, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = tempfile.mkdtemp(prefix="dpui_")
os.makedirs(D + "/static/ext")
for lib in ("monaco", "xterm"):
    os.symlink(os.path.join(ROOT, "static", "vendor", lib), D + f"/static/ext/{lib}")
for f in ("depot.js", "depot.css"):
    os.symlink(os.path.join(ROOT, "static", f), D + f"/static/{f}")
open(D + "/index.html", "w").write('<!doctype html><html><head><meta charset="utf-8"></head><body><link rel="stylesheet" href="/static/depot.css"><style>:root{--bg:#0b0d10;--panel:#11151a;--neon:#00ff9c;--u:#dfe;--mid:#8a9;--dim:#245;--mg:#f5a;--cy:#5df}</style><button id="b-dep">DEP</button><script src="/static/depot.js"></script></body></html>')

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf"}
srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(H, directory=D)); srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://127.0.0.1:%d/" % srv.server_address[1]
BAD = []
def check(c, m):
    print(("OK   " if c else "FAIL ") + m)
    if not c: BAD.append(m)

now = time.time()
ROUTES = {
 "/api/depot/state": {"mode": "local", "repos": [{"name": "ex00", "branch": "main", "dirty": 1}], "current": "ex00", "options": {"shell_target": "root"}},
 "/api/depot/forge": {"items": [{"id": "1", "name": "Piscine C — Rush00", "kind": "pool", "status": "running", "start": "2026-01-01T10:00:00+00:00", "deadline": "2030-01-01T10:00:00+00:00", "deadline_ts": now + 3700, "remaining_s": 3700, "overdue": False, "progress": 40}], "fetched_at": now, "error": None, "config": {"ics_set": True, "host": "forge.test", "refresh_s": 300}},
 "/api/depot/git/status": {"branch": "main", "upstream": "origin/main", "ahead": 1, "behind": 0, "clean": False, "detached": False, "files": [{"path": "ex00/main.c", "index": " ", "worktree": "M"}], "last_commit": None},
 "/api/depot/git/next-tag": {"tag": "ex00V3"},
 "/api/depot/git/branches": {"current": "main", "local": [{"name": "main", "upstream": "origin/main", "ahead": 1, "behind": 0}, {"name": "dev", "upstream": None, "ahead": 0, "behind": 0}], "remote": []},
 "/api/depot/git/tags": {"items": [{"name": "ex00V2", "message": "m", "date": "2026-10-01", "commit": "abc"}]},
 "/api/depot/git/log": {"items": [{"hash": "abc", "short": "abc1234", "subject": "init", "author": "x", "date": "", "refs": "HEAD -> main"}]},
 "/api/depot/fs/tree": {"items": [{"name": "main.c", "type": "f", "size": 10}, {"name": "src", "type": "d", "size": 0}]},
 "/api/depot/fs/file": {"path": "main.c", "text": "int main(void)\n", "size": 15},
 "/api/depot/roadmap": {"roadmap": None}, "/api/depot/trainings": {"items": [{"id": "t1", "title": "Rush 00", "created": "2026-03-01T10:00:00", "last_done": None, "done_count": 1, "total": 4, "tags": ["C", "libft"]}]},
 "/api/depot/trainings/t1": {"training": {"id": "t1", "title": "Rush 00", "analysis": {"summary": "Un rush.", "steps": [{"id": "s1", "title": "Lire", "detail": "d", "done": True}, {"id": "s2", "title": "Coder", "detail": "", "done": False}], "constraints": ["norme"], "deliverables": ["ft.c"]}}},
}
calls = []
with sync_playwright() as pw:
    kw = {"executable_path": "/opt/pw-browsers/chromium"} if os.path.exists("/opt/pw-browsers/chromium") else {}
    b = pw.chromium.launch(args=["--no-sandbox"], **kw); pg = b.new_page(viewport={"width": 1400, "height": 850})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    from urllib.parse import urlparse
    def h(route):
        req = route.request; path = urlparse(req.url).path
        if req.method != "GET": calls.append((req.method, path, req.post_data)); return route.fulfill(json={"ok": True, "tag": "ex00V3", "steps": [{"name": "git add", "ok": True, "output": ""}, {"name": "git push", "ok": True, "output": "To origin"}], "path": "/home/u/ex00/x.sh", "executable": True})
        return route.fulfill(json=ROUTES.get(path, {}))
    pg.route("**/api/**", h)
    pg.goto(URL); pg.click("#b-dep"); pg.wait_for_selector("#dp:not([hidden])")
    pg.wait_for_selector(".dp-proj"); check("Rush00" in pg.inner_text(".dp-proj") and "PISCINE" in pg.inner_text(".dp-proj"), "Forge : rendu en cours affiché (type piscine)")
    check("PROCHAINE ÉCHÉANCE" in pg.inner_text(".dp-hero"), "Forge : bandeau « prochaine échéance »")
    c1 = pg.inner_text(".dp-proj .dp-count"); pg.wait_for_timeout(2300); c2 = pg.inner_text(".dp-proj .dp-count")
    check(c1 != c2 and ":" in c2, "compte à rebours qui avance (%s → %s)" % (c1, c2))
    pg.click("#dp-p-forge summary:has-text('Lien de la Forge')")
    pg.fill("#dp-p-forge input[type=text]", "https://forge.test/cal.ics?t=1"); pg.click("#dp-p-forge >> text=ENREGISTRER"); pg.wait_for_timeout(400)
    check(any(c[1] == "/api/depot/forge/config" and json.loads(c[2]) == {"ics": "https://forge.test/cal.ics?t=1"} for c in calls), "Forge : le lien .ics est envoyé au serveur")
    check("ex00" in pg.inner_text(".dp-bar select") and "main" in pg.inner_text(".dp-bar"), "barre : dépôt + branche")
    pg.click('.dp-tabs [data-t=files]'); pg.wait_for_selector(".dp-file")
    pg.click(".dp-file >> text=main.c"); pg.wait_for_selector(".monaco-editor", timeout=30000)
    check(pg.locator(".dp-ftabs button").count() == 1, "Monaco chargé, fichier ouvert dans un onglet")
    pg.evaluate("window.monaco.editor.getEditors()[0].setValue('')"); pg.click(".monaco-editor .view-lines"); pg.keyboard.type("int f(void) {"); pg.keyboard.press("Enter"); pg.keyboard.type("return 1;")
    val = pg.evaluate("window.monaco.editor.getEditors()[0].getValue()")
    check("{\n    return 1;" in val.replace("}", ""), "auto-indentation : 4 espaces après « { » (%r)" % val[:40])
    check(pg.evaluate("window.monaco.editor.getEditors()[0].getModel().getLanguageId()") == "c", "langage détecté : c")
    pg.keyboard.press("Control+s"); pg.wait_for_timeout(300)
    check(any(c[1] == "/api/depot/fs/file" for c in calls), "Ctrl+S enregistre via l'API")
    pg.click('.dp-tabs [data-t=git]'); pg.wait_for_selector("text=BRANCHES")
    check(pg.locator("text=ex00V2").count() >= 1 and pg.locator("text=FUSIONNER").count() == 1, "Git : branches, tags, boutons fusion/suppression")
    pg.click(".dp-send"); pg.wait_for_selector(".dp-modal")
    pg.fill(".dp-modal input[placeholder^='ex']", "ex00"); pg.wait_for_function("document.querySelector('.dp-tagprev').textContent.includes('ex00V3')")
    check(True, "ENVOYER : aperçu du tag auto-incrémenté (ex00V3)")
    pg.fill(".dp-modal textarea", "rendu ex00"); pg.click(".dp-modal >> text=ENVOYER >> nth=-1")
    pg.wait_for_selector(".dp-steps"); sent = [c for c in calls if c[1] == "/api/depot/git/send"]
    body = json.loads(sent[-1][2]); check(body["folder"] == "." and body["message"] == "rendu ex00" and body["tag"] == "ex00" and body["push"] is True, "ENVOYER : bon corps de requête %s" % body)
    pg.wait_for_timeout(2000)
    pg.click('.dp-tabs [data-t=shell]'); pg.set_input_files("#dp-p-shell input[type=file]", {"name": "fix.sh", "mimeType": "text/x-shellscript", "buffer": b"#!/bin/sh\necho hi\n"})
    pg.wait_for_selector("text=Déposé"); check(any(c[1] == "/api/depot/shell-drop" for c in calls), "Dépôt Shell : script envoyé")
    pg.click('.dp-tabs [data-t=subject]'); pg.wait_for_selector("#dp-p-subject .dp-drop"); check("SUJET DU PROJET" in pg.inner_text("#dp-p-subject .dp-drop"), "onglet Sujet : zone de dépôt PDF")
    pg.click('.dp-tabs [data-t=train]'); pg.wait_for_selector(".dp-tcard"); check("Rush 00" in pg.inner_text(".dp-lib") and "1/4" in pg.inner_text(".dp-lib"), "onglet Entraînement : bibliothèque avec avancement")
    pg.click(".dp-tcard"); pg.wait_for_selector(".dp-detail .dp-step"); check(pg.locator(".dp-detail .dp-step").count() == 2 and pg.locator("text=ETO").count() >= 1, "Entraînement : détail, étapes à cocher, tuteur ETO")
    pg.click(".dp-bar >> text=CLONER"); pg.wait_for_selector(".dp-modal input"); check(True, "bouton CLONER : modale git clone")
    check(not errs, "aucune erreur JavaScript : %s" % errs[:3]); b.close()
print("ECHECS:", BAD or "aucun"); sys.exit(1 if BAD else 0)
