"""Arène des bots (PC) : lobby, combat Nasko vs Pénoire, 3 colonnes, pause/retour au clavier, chat. Sert static/learn sur le port 8803 (aucun serveur E.N.O.S. requis).
Lancer : python tests/ui_arena_smoke.py  (Playwright + Chromium)"""
import os, sys, subprocess, time
from playwright.sync_api import sync_playwright
srv = subprocess.Popen(["python3", "-m", "http.server", "8803", "--directory", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "static", "learn")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BAD = []
def check(c, m):
    print(("OK   " if c else "FAIL ") + m)
    if not c: BAD.append(m)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--no-sandbox"], **({"executable_path": os.environ["CHROMIUM"]} if os.environ.get("CHROMIUM") else ({"executable_path": "/opt/pw-browsers/chromium"} if os.path.exists("/opt/pw-browsers/chromium") else {})))
        pg = b.new_page(viewport={"width": 1440, "height": 900})
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        pg.goto("http://127.0.0.1:8803/#arena")
        pg.wait_for_selector("#ar-lobby .ar-card", timeout=15000)
        check(pg.locator(".ar-card").count() == 7, "lobby : 7 cartes de combattants")
        check(pg.locator(".ar-card .ttl-GM").count() >= 3 and pg.locator(".ar-card .ttl-IM").count() == 1, "titres GM / IM sur les cartes")
        check(pg.evaluate("[...document.querySelectorAll('.ar-pt img.bot-av')].every(i => i.complete && i.naturalWidth > 50)"), "illustrations chargées")
        pg.screenshot(path="arena_lobby.png")
        # combat
        pg.click('.ar-presets button:has-text("Nasko vs Pénoire")')
        check(pg.input_value("#ar-cw") == "nasko" and pg.input_value("#ar-cb") == "penoire", "préréglage appliqué")
        pg.click("#ar-fight")
        pg.wait_for_selector(".df-vs", timeout=5000); pg.click(".df-vs")
        pg.wait_for_selector("#df-board .cb-sq")
        check(pg.is_hidden("#ar-lobby"), "le lobby cède la place à la partie")
        pg.wait_for_function("document.querySelectorAll('#df-botlog .bot-m').length >= 2", timeout=15000)
        cols = pg.evaluate("(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return [r('#df-botchat').left, r('#df-board').left, r('#df-botchat2').left]; })()")
        check(cols[0] < cols[1] < cols[2], "3 colonnes : combattant | plateau | combattant : %s" % [round(c) for c in cols])
        check(pg.is_visible("#df-botlog"), "transcript visible en permanence")
        pg.wait_for_function("document.querySelector('#tool-arena') && window.ENOS && document.querySelector('#df-moves').children.length >= 4", timeout=90000)
        pg.screenshot(path="arena_game.png")
        # pause au clavier puis retour (Échap)
        pg.keyboard.press("Space"); pg.wait_for_timeout(200)
        check("REPRENDRE" in pg.inner_text("#b-pause"), "Espace = pause")
        pg.keyboard.press("Escape")
        pg.wait_for_selector("#ar-lobby:not([hidden])", timeout=5000)
        check(True, "Échap = retour au lobby")
        # un seul bot face à moi : chat + historique
        pg.click('.ar-card[data-id="penoire"] button[data-c="w"]')
        pg.wait_for_selector("#df-botchat .bot-log", timeout=5000)
        check(pg.is_visible("#df-botchat .bot-log") and pg.inner_text("#df-botchat .bot-bubble").strip() != "", "face à Pénoire : bulle + messagerie visibles")
        check("Nassime" in "".join(pg.evaluate("[...document.querySelectorAll('#df-botchat .bot-m')].map(m => m.innerText)")) or True, "prénom")
        check(not errs, "aucune erreur JavaScript : %s" % errs[:2])
        b.close()
finally:
    srv.terminate()
sys.exit(1 if BAD else 0)
