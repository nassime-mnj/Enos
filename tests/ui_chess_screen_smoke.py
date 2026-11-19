"""Écran CHESS + DÉFI + lanceur Applications de la fenêtre principale (refonte « Obsidian Crimson ») : la page static/index.html est servie
depuis le disque par Playwright (aucun serveur E.N.O.S.), l'API d'échecs est simulée avec une position de test.
Vérifie : tous les contrôles d'origine présents, plateau 8×8 carré avec pièces illustrées, bandeaux adversaire / joueur alimentés par l'état,
phrase d'évaluation, sélecteur de plateau distinct du plateau, Défi (4 cartes + dernières parties réelles), bandeau Échecs du lanceur.
Lancer : python tests/ui_chess_screen_smoke.py  (Playwright + Chromium)"""
import json, mimetypes, os, re
from playwright.sync_api import sync_playwright
ROOT = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "static"))
BAD = []
def check(c, m):
    print(("OK   " if c else "FAIL ") + m)
    if not c: BAD.append(m)
B = {"a1": "R", "b1": "N", "c1": "B", "d1": "Q", "e1": "K", "f1": "B", "h1": "R", "a2": "P", "b2": "P", "c2": "P", "d2": "P", "f2": "P", "g2": "P", "h2": "P", "e4": "P", "f3": "N",
     "a8": "r", "b8": "n", "c8": "b", "d8": "q", "e8": "k", "f8": "b", "g8": "n", "h8": "r", "a7": "p", "b7": "p", "c7": "p", "d7": "p", "f7": "p", "g7": "p", "h7": "p", "e5": "p"}
ST = {"active": True, "mode": "enos", "me": "w", "players": {"w": "Vous", "b": "E.N.O.S."}, "board": B, "legal": {}, "turn": "w", "last": "g1f3", "eval": 38, "seq": 4, "over": "", "check": False,
      "moves": [{"n": 1, "color": "w", "san": "e4", "key": "best", "label": "Meilleur"}, {"n": 2, "color": "b", "san": "e5", "key": "best", "label": "Meilleur"}, {"n": 3, "color": "w", "san": "Nf3", "key": "excellent", "label": "Excellent"}],
      "played": {"key": "excellent", "label": "Excellent", "san": "Nf3", "loss": 4, "best": "Nf3"}, "reply": None}
HIST = {"games": [{"id": "1", "outcome": "victoire", "me": "w", "elo": 1500, "date": "2026-11-17T20:00:00", "n_moves": 54, "player": "Vous", "result": "1-0"}], "max": 10}
def static(route):
    p = route.request.url.split("/static/", 1)[1].split("?")[0]
    f = os.path.realpath(os.path.join(ROOT, p))
    if not f.startswith(ROOT + os.sep) or not os.path.isfile(f): return route.fulfill(status=404, body="")
    data = open(f, "rb").read()
    if f == os.path.join(ROOT, "index.html"): data = data.replace(b'<html lang="fr">', b'<html lang="fr" class="os">', 1)      # mode « OS » (lanceur Applications)
    route.fulfill(status=200, body=data, content_type=mimetypes.guess_type(f)[0] or "application/octet-stream")
def api(route):
    u = route.request.url
    body = ST if "/api/chess/state" in u else HIST if "/api/chess/history" in u else {"local": True, "full": True, "greeting": ""} if "/api/status" in u else {}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
ORIG = re.findall(r'id="(cs-[^"]+|cc-[^"]+|df-[^"]+)"', open(os.path.join(ROOT, "index.html"), encoding="utf-8").read())
with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--no-sandbox"], **({"executable_path": "/opt/pw-browsers/chromium"} if os.path.exists("/opt/pw-browsers/chromium") else {}))
    pg = b.new_page(viewport={"width": 1920, "height": 1080})
    pg.route("http://enos.test/static/**", static); pg.route("http://enos.test/api/**", api)
    pg.goto("http://enos.test/static/index.html"); pg.wait_for_timeout(2000)
    for need in ["cs-pow", "cs-opp", "cs-mode", "cs-boss", "cs-elo", "cs-sr-pause", "cs-titans", "cs-w", "cs-b", "cs-hbtn", "cs-trbtn", "cs-theme", "cs-boardsel", "cs-vtheme", "cs-mic", "cs-discord", "cs-discord-mic",
                 "cs-stop", "cs-revbtn", "cs-ana", "cs-resign", "cs-cond", "cs-close", "cs-board", "cs-embed", "cs-promo", "cs-status", "cs-eye", "cs-coach", "cs-dec", "cs-judge", "cs-evalf", "cs-evalv", "cs-moves",
                 "df-chess", "df-g-menu", "df-bots", "df-cond", "df-close", "df-gmsg"]:
        if pg.evaluate("(id) => document.querySelectorAll('#' + id).length", need) != 1: check(False, "contrôle %s présent une seule fois" % need)
    check(len(set(ORIG)) == len(ORIG), "aucun identifiant en double dans CHESS / DÉFI")
    check(pg.evaluate("!!document.querySelector('[data-persona-slot]') && document.getElementById('cs-board').tagName === 'DIV' && document.getElementById('cs-boardsel').tagName === 'SELECT'"), "plateau et sélecteur de plateau distincts")
    pg.evaluate("document.getElementById('b-df').click()"); pg.wait_for_timeout(3000)
    check(pg.is_visible("#df .df-hero") and pg.locator("#df .df-card").count() == 4, "DÉFI : héros + 4 cartes")
    check("VICTOIRE" in pg.inner_text("#df-lrow"), "DÉFI : dernière partie réelle (historique)")
    pg.screenshot(path=os.environ.get("SHOTS", "/tmp") + "/ui_defi.png")
    pg.click("#df-chess"); pg.wait_for_timeout(2200)
    r = pg.evaluate("(() => { const b = document.getElementById('cs-board').getBoundingClientRect(); return [b.width, b.height, document.querySelectorAll('#cs-board .cs-sq').length, getComputedStyle(document.querySelector('#cs-board .cs-p')).backgroundImage] })()")
    check(r[2] == 64 and abs(r[0] - r[1]) < 1 and r[0] >= 600, "plateau 8×8 carré : %dx%d" % (r[0], r[1]))
    check("wk.png" in r[3] or "br.png" in r[3] or ".png" in r[3], "pièces illustrées (%s)" % r[3][:60])
    check(pg.inner_text("#cs-oname") == "E.N.O.S." and pg.inner_text("#cs-orate").startswith("3650") and pg.inner_text("#cs-mcol") == "BLANCS", "bandeaux : E.N.O.S. 3650, vous avec les Blancs")
    check(pg.inner_text("#cs-evtxt") == "Léger avantage pour les Blancs", "phrase d'évaluation : %s" % pg.inner_text("#cs-evtxt"))
    check(pg.locator("#cs-moves .cs-mv").count() == 3 and "EXCELLENT" in pg.inner_text("#cs-judge"), "coups + analyse du coup affichés")
    pg.screenshot(path=os.environ.get("SHOTS", "/tmp") + "/ui_chess.png")
    pg.click(".cs-rail [data-proxy=cs-hbtn]"); pg.wait_for_timeout(500)
    check(pg.is_visible("#cs-hist"), "barre latérale : Historique ouvre le vrai historique")
    pg.click("#cs-hclose"); pg.click("#cs-close"); pg.wait_for_timeout(300); pg.click("#df-close"); pg.wait_for_timeout(300)
    pg.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))"); pg.wait_for_timeout(1200)
    check(pg.is_visible("#lx .lx-hero") and pg.locator('#lx .lx-t[data-id="__chess"]').count() == 1, "Applications : bandeau Échecs + tuile HUB")
    check(pg.locator('#lx .lx-t[data-id="b-variants"]').count() == 0, "Applications : modules d'échecs regroupés")
    pg.fill("#lx-q", "variantes"); pg.wait_for_timeout(200)
    check(pg.locator('#lx .lx-t[data-id="b-variants"]').count() == 1, "Applications : un module d'échecs reste trouvable par la recherche")
    b.close()
raise SystemExit(1 if BAD else 0)
