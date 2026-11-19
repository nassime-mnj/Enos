"""Version PC (static/learn) : Simultanée (1v2 à 1v6, adversaire et plateaux choisis parmi tous les bots) et Game Clips (duel / simultanée, sélecteur commun).
Lancer avec un serveur statique sur static/learn (port PC_PORT, 8803 par défaut)."""
import os
from mobile_common import launch, check, BAD
from playwright.sync_api import sync_playwright
PORT = os.environ.get("PC_PORT", "8803"); URL = "http://127.0.0.1:%s/index.html" % PORT; S = (os.environ.get("SHOTS") or "/tmp") + "/"
errs = []
with sync_playwright() as pw:
    b, _ctx = launch(pw); pg = b.new_page(viewport={"width": 1600, "height": 1000}); pg.set_default_timeout(60000)
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(URL + "#simul"); pg.wait_for_selector("#app-simul #sm-go", timeout=60000)
    check(pg.locator('#tabs [data-t="simul"]').count() == 1 and pg.locator("#sm-n button").count() == 5, "PC : onglet Simultanée, de 1v2 à 1v6")
    pg.click('#sm-n [data-n="6"]'); check(pg.locator("#sm-mem .bp-slot").count() == 6, "1v6 : six plateaux")
    pg.click("#sm-boss"); pg.wait_for_selector(".bp-q")
    n = pg.locator(".ro-pick .ro-bot").count(); check(n >= 130, "adversaire choisi parmi tous les bots : %d" % n)
    pg.click('.ro-pick .ro-bot[data-b="eto"]'); pg.wait_for_timeout(300)
    check("ETO" in pg.inner_text("#sm-boss") and "3650" in pg.inner_text("#sm-boss"), "ETO, 3650 Elo, en adversaire")
    pg.screenshot(path=S + "pc_simul.png")
    pg.click('#tabs [data-t="clips"]'); pg.wait_for_selector("#app-clips #cl-mode", timeout=90000)
    pg.click('#cl-mode [data-m="ant"]'); pg.click('#cl-count [data-n="5"]')
    check(pg.locator("#cl-slots .bp-slot").count() == 5 and "5v1" in pg.inner_text("#cl-count"), "Game Clips PC : 5 héros contre 1 antagoniste")
    pg.click('#cl-slots .bp-slot >> nth=0'); pg.wait_for_selector(".bp-q")
    pg.fill(".bp-q", "witty"); check(pg.locator(".ro-pick .ro-bot:not([hidden])").count() == 1, "recherche dans la liste des bots")
    pg.click(".ro-pick .ro-bot:not([hidden])"); pg.wait_for_timeout(300)
    check("Witty Alien" in pg.inner_text("#cl-slots"), "Witty Alien choisi en héros")
    pg.screenshot(path=S + "pc_clips.png")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
