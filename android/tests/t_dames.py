"""Dames 3D : salon (modes Local / Contre les bots / En ligne bientôt, plateau 10×10 ou 8×8), scène three.js, coup joué au toucher,
réponse du bot (IA dans un Worker), prise obligatoire signalée, fin de partie, catégorie Jeux du hub."""
from mobile_common import *
errs = []
SH = (os.environ.get("SHOTS") or "/tmp") + "/"
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(60000)
    pg.add_style_tag(content="#toasts{display:none!important}")
    pg.evaluate("ENOS.ui.go('tools')"); pg.wait_for_selector('.hub-cat[data-c="jeux"]')
    check(pg.locator('.hub-cat.feat[data-c="jeux"]').count() == 1, "hub : catégorie Jeux mise en avant")
    open_tool(pg, "dames"); pg.wait_for_selector("#tool-dames .gm-mode")
    modes = pg.evaluate("[...document.querySelectorAll('#tool-dames .gm-mode b')].map((b) => b.textContent)")
    check(modes == ["Local", "Contre les bots", "En ligne"], "trois modes : %s" % modes)
    pg.click('#tool-dames .gm-mode[data-m="online"]'); check(pg.is_disabled("#tool-dames #gm-go"), "en ligne : bientôt (bouton désactivé)")
    pg.click('#tool-dames .gm-mode[data-m="bots"]'); pg.click('#tool-dames .gm-opt [data-v="10"]')
    pg.screenshot(path=SH + "dames_lobby.png")
    pg.click("#tool-dames #gm-go"); pg.wait_for_selector("#gm-stage canvas.g3-canvas", timeout=60000)
    pg.wait_for_function("ENOS.jeux.cur && ENOS.jeux.cur.inst && ENOS.jeux.cur.inst._st", timeout=60000); pg.wait_for_timeout(1500)
    st = pg.evaluate("(() => { const s = ENOS.jeux.cur.inst._st(); return { n: s.n, w: s.b.filter((x) => x > 0).length, b: s.b.filter((x) => x < 0).length, turn: s.turn }; })()")
    check(st == {"n": 10, "w": 20, "b": 20, "turn": 1}, "partie 10×10 : 20 pions de chaque côté, les Blancs commencent")
    pg.screenshot(path=SH + "dames_3d.png")
    # coup au toucher : pion (6,1) -> (5,0)
    pg.evaluate("ENOS.jeux.cur.inst._tap(6, 1)"); pg.wait_for_timeout(400); pg.evaluate("ENOS.jeux.cur.inst._tap(5, 0)")
    pg.wait_for_function("ENOS.jeux.cur.inst._st().turn === -1", timeout=10000)
    check(True, "coup joué au toucher (sélection puis case d'arrivée)")
    pg.wait_for_function("ENOS.jeux.cur.inst._st().turn === 1", timeout=30000)
    check(pg.evaluate("ENOS.jeux.cur.inst._st().ply") == 2, "le bot a répondu (IA dans un Worker)")
    pg.wait_for_timeout(800); pg.screenshot(path=SH + "dames_3d_2.png")
    # fin de partie forcée : position gagnante
    pg.evaluate("""(() => { const b = new Array(100).fill(0); b[6 * 10 + 3] = 1; b[5 * 10 + 4] = -1; ENOS.jeux.cur.inst._load(b, 1); })()"""); pg.wait_for_timeout(300)
    pg.evaluate("ENOS.jeux.cur.inst._tap(6, 3)"); pg.wait_for_timeout(300); pg.evaluate("ENOS.jeux.cur.inst._tap(4, 5)")
    pg.wait_for_selector("#gm-end:not([hidden])", timeout=15000)
    check("Victoire" in pg.inner_text("#gm-end"), "fin : Victoire, avec ETO")
    pg.wait_for_timeout(700); pg.screenshot(path=SH + "dames_end.png")
    pg.click('#gm-end [data-a="quit"]'); pg.wait_for_function("!document.querySelector('#gm-stage')")
    check(pg.evaluate("ENOS.settings.get('games.stats', {}).dames.w") == 1, "statistiques : 1 victoire")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
