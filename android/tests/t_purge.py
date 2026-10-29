"""PURGE.EXE : tuile Jeux, partie plein écran, centaines de virus, FPS, boucle roguelike (pause + 3 mises à jour), mort et rejeu."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    pg.click('#tabbar [data-tab="tools"]'); pg.evaluate("ENOS.tools.show('')"); pg.wait_for_selector('.mtile[data-m="purge"]')
    check(True, "tuile PURGE.EXE dans le groupe « Jeux »")
    pg.click('.mtile[data-m="purge"]'); pg.wait_for_selector("#tool-purge #pg-play")
    pg.click("#pg-play"); pg.wait_for_selector("#purge-full canvas")
    pg.evaluate("window.__g = document.querySelector('#tool-purge .suite-body')._api.game")
    # le mode tactile affiche un écran d'accueil ; le mode souris non
    if pg.locator("#pg-go").count(): pg.click("#pg-go")
    pg.mouse.move(250, 400)
    pg.wait_for_timeout(1500)
    check(pg.evaluate("__g.state.t") > 0.5, "la partie tourne")
    # 600 virus + mesure des images par seconde réelles
    pg.evaluate("__g._debug.spawnMany(600, 0)")
    pg.evaluate("__g.state.hp = 1e9; __g.state.hpMax = 1e9")
    pg.wait_for_timeout(2500)
    n = pg.evaluate("__g.enemies"); fps = pg.evaluate("__g.state.fps")
    check(n >= 300, "des centaines de virus à l'écran : %d" % n)
    check(fps >= 30, "fluidité mesurée (navigateur de test, sans GPU) : %d fps avec %d virus" % (fps, n))
    # armes automatiques : des virus sont détruits sans aucun clic
    check(pg.evaluate("__g.state.kills") > 0, "lasers / ondes tuent tout seuls : %d virus purgés" % pg.evaluate("__g.state.kills"))
    # l'œil suit la souris
    pg.mouse.move(60, 120); pg.wait_for_timeout(1500)
    x = pg.evaluate("__g.state.x")
    check(x < 200, "l'œil suit le pointeur (x=%d)" % x)
    # boucle roguelike : XP pleine -> pause + 3 cartes
    pg.evaluate("__g._debug.giveXp(6)")
    pg.wait_for_selector(".pg-card")
    check(pg.locator(".pg-card").count() == 3, "3 mises à jour système proposées : " + " | ".join(pg.locator(".pg-card b").all_inner_texts()))
    t0 = pg.evaluate("__g.state.t"); pg.wait_for_timeout(600)
    check(abs(pg.evaluate("__g.state.t") - t0) < 0.01, "le jeu est en pause pendant le choix")
    lvl = pg.evaluate("__g.state.lvl")
    pg.locator(".pg-card").first.click()
    pg.wait_for_function("__g.state.t > %f + 0.2" % t0, timeout=5000)
    check(pg.locator(".pg-card").count() == 0 and sum(pg.evaluate("Object.values(__g.state.up)")) == 1, "choix appliqué, le jeu reprend")
    # mort puis rejouer
    pg.evaluate("__g.state.hp = -1")
    pg.wait_for_selector("#pg-again")
    pg.click("#pg-again")
    pg.wait_for_function("__g.state.t > 0.3 && !__g.state.over", timeout=5000)
    check(pg.evaluate("__g.state.kills") < 50 and pg.evaluate("__g.state.lvl") == 1, "rejouer : partie remise à zéro")
    pg.click("#pg-exit")
    check(pg.locator("#purge-full").count() == 0, "sortie du jeu")
    check(not errs, "aucune erreur JavaScript : %s" % errs)
print("\n%d échec(s)" % len(BAD))
