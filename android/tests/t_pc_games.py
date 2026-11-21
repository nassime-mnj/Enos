"""Version PC (static/learn) — JEUX : rail « Jeux », salon commun (joueurs + bots), partie 3D lancée à la souris (Mini-golf, Flick).
Lancer avec un serveur statique sur static/learn (port PC_PORT, 8803 par défaut)."""
import os
from mobile_common import launch, check, BAD
from playwright.sync_api import sync_playwright
S = (os.environ.get("SHOTS") or "/tmp") + "/"; PORT = os.environ.get("PC_PORT", "8803")
URL = "http://127.0.0.1:%s/index.html" % PORT
errs = []
with sync_playwright() as pw:
    b, _ctx = launch(pw)
    pg = b.new_page(viewport={"width": 1600, "height": 900}); pg.set_default_timeout(60000)
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(URL); pg.wait_for_selector("#tabs")
    check(pg.locator('#tabs button[data-t="golf"]').count() == 1 and pg.locator('#tabs button[data-t="flick"]').count() == 1, "rail : section Jeux (Flick, Mini-golf, Bowling, Néo-Cité, Loup-garou…)")
    pg.click('#tabs button[data-t="golf"]'); pg.wait_for_selector("#app-golf .gm-mode", timeout=60000)
    check(pg.locator("#app-golf .gm-seat").count() >= 1, "salon commun joueurs + bots sur PC")
    pg.screenshot(path=S + "pc_golf_lobby.png")
    pg.click("#app-golf #gm-go"); pg.wait_for_function("ENOS.jeux.cur && ENOS.jeux.cur.inst && ENOS.jeux.cur.inst._st && ENOS.jeux.cur.inst._st().phase === 'aim'", timeout=120000)
    pg.wait_for_timeout(1500); pg.screenshot(path=S + "pc_golf.png")
    box = pg.locator("#gm-stage canvas").bounding_box(); cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] * 0.45
    pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.move(cx + 1, cy + box["height"] * 0.14, steps=6); pg.mouse.up()
    pg.wait_for_function("ENOS.jeux.cur.inst._st().strokes[0] === 1", timeout=8000); check(True, "golf à la souris : tirer vers le bas puis relâcher")
    pg.evaluate("ENOS.jeux.close()")
    pg.click('#tabs button[data-t="flick"]'); pg.wait_for_selector("#app-flick .gm-mode", timeout=60000); pg.click("#app-flick #gm-go")
    pg.wait_for_function("ENOS.jeux.cur && ENOS.jeux.cur.inst && ENOS.jeux.cur.inst._st", timeout=120000); pg.wait_for_timeout(3000)
    check(pg.evaluate("ENOS.jeux.cur.inst._theme()") in ("stade", "sakura", "eto", "ocean", "automne", "rue", "volcan", "tempete"), "Flick sur PC (décor %s)" % pg.evaluate("ENOS.jeux.cur.inst._theme()"))
    pg.screenshot(path=S + "pc_flick.png")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
