"""Version PC (static/learn) — Arène : bots rangés par familles (Bots E.N.O.S., Légendes, Joueurs pro, Streamers…), avatars, fiche de Witty Alien, combat de bots avec tous les bots.
Lancer avec un serveur statique sur static/learn (port PC_PORT, 8803 par défaut)."""
import os
from mobile_common import launch, check, BAD
from playwright.sync_api import sync_playwright
S = (os.environ.get("SHOTS") or "/tmp") + "/"; PORT = os.environ.get("PC_PORT", "8803")
errs = []
with sync_playwright() as pw:
    b, _ctx = launch(pw); pg = b.new_page(viewport={"width": 1440, "height": 900}); pg.set_default_timeout(60000)
    pg.on("pageerror", lambda e: errs.append(str(e)[:200])); pg.on("console", lambda m: errs.append("console: " + m.text[:160]) if m.type == "error" and "Failed to load resource" not in m.text else None)
    pg.goto("http://127.0.0.1:%s/index.html" % PORT); pg.wait_for_selector("#tabs")
    pg.click('#tabs [data-t="arena"]'); pg.wait_for_selector(".df-mode", state="attached", timeout=60000); pg.wait_for_timeout(2500)
    sec = pg.evaluate("[...document.querySelectorAll('#ar-lobby .ar-sec h3')].map((h) => [h.firstChild.textContent.trim(), h.parentNode.querySelectorAll('.ar-card, .ar-bot').length])")
    print(sec)
    bad = pg.evaluate("[...document.querySelectorAll('#df-home img.hub-av')].slice(0, 40).filter((i) => i.complete && i.naturalWidth === 0).length")
    check(any(t.startswith("BOTS E.N.O.S") or t.startswith("CHOISIR UN ADVERSAIRE") for t, _ in sec) and any(t == "LÉGENDES" for t, _ in sec) and sum(n for _, n in sec) >= 130, "PC : Arène rangée par familles : %s" % sec)
    bad = pg.evaluate("[...document.querySelectorAll('#ar-lobby .ar-bot img')].filter((i) => { const r = i.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0 && !(i.complete && i.naturalWidth > 0); }).length")
    check(pg.evaluate("!!(window.ENOS && ENOS.botRoster && ENOS.botRoster.list.length === 113)"), "PC : échelle des 113 bots chargée")
    pg.screenshot(path=S + "pc_arena.png")
    pg.locator('#ar-lobby .ar-sec').nth(3).scroll_into_view_if_needed(); pg.wait_for_timeout(800); pg.screenshot(path=S + "pc_families.png")
    pg.locator('.ar-bot[data-b="r_witty_alien"]').scroll_into_view_if_needed(); pg.click('.ar-bot[data-b="r_witty_alien"]'); pg.wait_for_selector(".ro-head", timeout=8000)
    check("monstre" in pg.inner_text("body"), "PC : fiche de Witty Alien")
    n = pg.evaluate("document.querySelectorAll('#ar-cw option').length"); check(n >= 130, "PC : combat de bots avec tous les bots (%d)" % n)
    pg.screenshot(path=S + "pc_witty.png")
    other = [e for e in errs if "favicon" not in e]; print("errs", other[:4])
    check(not other, "aucune erreur JS")
    b.close()
raise SystemExit(1 if BAD else 0)
