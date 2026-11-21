"""Bowling 3D : salon (8 décors), piste, geste de lancer (glisser vers le haut), quilles qui tombent, feuille de score,
tour du bot, strike / spare, fin de partie après 10 frames."""
from mobile_common import *
errs = []
SH = (os.environ.get("SHOTS") or "/tmp") + "/"
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(60000)
    pg.add_style_tag(content="#toasts{display:none!important}")
    open_tool(pg, "bowling"); pg.wait_for_selector("#tool-bowling .gm-mode")
    pg.click('#tool-bowling .gm-mode[data-m="bots"]')
    check(pg.locator('#tool-bowling .gm-opt[data-k="decor"] button').count() == 8, "8 décors proposés")
    pg.click('#tool-bowling .gm-opt[data-k="decor"] [data-v="eto"]'); pg.click('#tool-bowling .gm-count:not(.gm-opt) [data-n="2"]')
    pg.click("#tool-bowling #gm-go")
    pg.wait_for_function("ENOS.jeux.cur && ENOS.jeux.cur.inst && ENOS.jeux.cur.inst._st && ENOS.jeux.cur.inst._st().phase === 'aim'", timeout=120000)
    pg.wait_for_timeout(1200)
    # geste : glisser vers le haut = lancer
    box = pg.locator("#gm-stage canvas").bounding_box(); cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] * 0.8
    pg.mouse.move(cx, cy); pg.mouse.down()
    for k in range(1, 9): pg.mouse.move(cx + k * 2, cy - k * 45); pg.wait_for_timeout(12)
    pg.mouse.up()
    pg.wait_for_function("ENOS.jeux.cur.inst._st().phase !== 'aim'", timeout=8000)
    check(True, "glisser vers le haut : la boule part")
    pg.wait_for_timeout(1500); pg.screenshot(path=SH + "bowling_roll.png")
    pg.wait_for_function("ENOS.jeux.cur.inst._st().rolls[0].length >= 1", timeout=150000)
    r0 = pg.evaluate("ENOS.jeux.cur.inst._st().rolls[0][0]")
    check(0 <= r0 <= 10, "1re boule comptée : %d quille(s)" % r0)
    pg.wait_for_timeout(1600); pg.screenshot(path=SH + "bowling_pins.png")
    # 1re frame de chacun : on lance des boules réglées par le bot ETO
    for k in range(160):
        s = pg.evaluate("ENOS.jeux.cur.inst._st()")
        if all(len(r) >= 2 or (len(r) == 1 and r[0] == 10) for r in s["rolls"]) and s["phase"] == "aim" and s["cur"] == 0: break
        if pg.locator("#gm-end:not([hidden])").count(): break
        s = pg.evaluate("ENOS.jeux.cur && ENOS.jeux.cur.inst && ENOS.jeux.cur.inst._st()")
        if s and s["phase"] == "aim" and s["cur"] == 0:
            pg.evaluate("(() => { const I = ENOS.jeux.cur.inst, s = I._st(); const t = ENOS.bowling.botThrow(s.standing, 'max'); I._throw(t.x0, t.angle, t.speed, t.hook); })()")
        pg.wait_for_timeout(700)
    st0 = pg.evaluate("ENOS.jeux.cur.inst._st()")
    check(len(st0["rolls"][1]) >= 1, "le bot a lancé sa frame (%s)" % st0["rolls"][1])
    # fin de partie : on complète les feuilles (10 frames) pour ne pas attendre 40 lancers dans un navigateur sans GPU
    pg.evaluate("ENOS.jeux.cur.inst._finish([[10,10,10,10,10,10,10,10,10,10,10,10],[9,1,8,2,7,3,10,10,6,3,9,0,8,1,7,2,9,1,8]])")
    pg.wait_for_selector("#gm-end:not([hidden])", timeout=60000)
    st = pg.evaluate("ENOS.jeux.cur.inst._st()")
    tot = pg.evaluate("ENOS.bowling.score(%s).total" % st["rolls"][0])
    check(pg.evaluate("ENOS.bowling.cursor(%s).done" % st["rolls"][0]) and pg.evaluate("ENOS.bowling.cursor(%s).done" % st["rolls"][1]), "10 frames jouées par chacun")
    check(str(tot) in pg.inner_text("#gm-end"), "fin : score affiché (%d)" % tot)
    check(pg.locator(".bw-row").count() == 2 and pg.locator(".bw-row").first.locator("i").count() == 10, "feuille de score : 2 joueurs × 10 frames")
    pg.screenshot(path=SH + "bowling_end.png")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
