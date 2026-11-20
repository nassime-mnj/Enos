"""Poker 3D : salon, table, cartes en main, actions (parole/suivre/relancer/coucher), bots, fin de main, local avec rideau, fin de partie."""
from mobile_common import *
errs = []
SH = (os.environ.get("SHOTS") or "/tmp") + "/"
S = "ENOS.jeux.cur.inst._st()"
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(60000)
    stacks = []; pg.on("pageerror", lambda e: stacks.append((e.stack or str(e))[:500]))
    pg.add_style_tag(content="#toasts{display:none!important}")
    open_tool(pg, "poker"); pg.wait_for_selector("#tool-poker .gm-mode")
    pg.click('#tool-poker .gm-mode[data-m="bots"]'); pg.click('#tool-poker .gm-count:not(.gm-lvl):not(.gm-opt) [data-n="6"]')
    check(pg.locator("#tool-poker .gm-bots .bp-slot").count() == 5, "6 joueurs : 5 bots")
    pg.click("#tool-poker #gm-go"); pg.wait_for_selector("#gm-stage canvas.g3-canvas")
    pg.wait_for_function("ENOS.jeux.cur && ENOS.jeux.cur.inst && ENOS.jeux.cur.inst._st", timeout=60000)
    check(pg.evaluate(S + ".hole[0].length") == 2, "2 cartes distribuées")
    pg.wait_for_selector("#pk-hand img.pk-c", timeout=10000)
    check(pg.locator("#pk-hand img.pk-c").count() == 2, "tes 2 cartes affichées")
    check(pg.locator(".pk-seat").count() == 5, "5 sièges adverses autour de la table")
    acted = 0
    for _ in range(6):
        pg.wait_for_function("(() => { const s = %s; return s.over || (s.turn === 0 && !s.result && !ENOS.jeux.cur.inst._busy()) || document.querySelector('.pk-res'); })()" % S, timeout=90000)
        if pg.locator(".pk-res").count():
            check(True, "fin de main : " + pg.inner_text(".pk-res b")); pg.click(".pk-res button"); pg.wait_for_timeout(1500); continue
        pg.wait_for_selector("#pk-acts:not([hidden])", timeout=5000)
        if acted == 0: pg.screenshot(path=SH + "poker_3d.png")
        btn = pg.locator('#pk-acts [data-a="call"]'); label = btn.inner_text()
        if acted == 1 and pg.locator('#pk-acts [data-a="raise"]:not([hidden])').count():
            pg.click('#pk-acts [data-a="raise"]'); pg.wait_for_selector("#pk-raise:not([hidden])")
            ok = pg.inner_text("#pk-ok"); pg.click("#pk-ok"); check(True, "relance : " + ok)
        else:
            btn.click(); check(True, "action : " + label)
        acted += 1; pg.wait_for_timeout(400)
    pg.wait_for_timeout(800); pg.screenshot(path=SH + "poker_3d_2.png")
    tot = pg.evaluate("(() => { const s = %s; return s.chips.reduce((a,b)=>a+b,0) + (s.result ? 0 : s.total.reduce((a,b)=>a+b,0)); })()" % S)
    check(tot == 6000, "jetons conservés (%d)" % tot)
    # fin de partie : à la fin d'une main, les autres n'ont plus de jetons -> victoire
    for _ in range(40):
        pg.wait_for_function("(() => { const s = %s; return document.querySelector('.pk-res') || document.querySelector('#gm-end:not([hidden])') || (s.turn === 0 && !s.result && !ENOS.jeux.cur.inst._busy()); })()" % S, timeout=120000)
        if pg.locator(".pk-res").count() or pg.locator("#gm-end:not([hidden])").count(): break
        pg.click('#pk-acts [data-a="call"]'); pg.wait_for_timeout(300)
    if pg.locator("#gm-end:not([hidden])").count():
        check("Défaite" in pg.inner_text("#gm-end"), "plus de jetons : Défaite"); pg.click('#gm-end [data-a="again"]'); pg.wait_for_function("ENOS.jeux.cur && ENOS.jeux.cur.inst && ENOS.jeux.cur.inst._st", timeout=60000)
        pg.wait_for_timeout(1500); pg.evaluate("(() => { const s = %s; s.result = s.result || { showdown: false, won: [0,0,0,0,0,0], pots: [], hands: {} }; })()" % S)
        for _ in range(40):
            pg.wait_for_function("(() => { const s = %s; return document.querySelector('.pk-res') || (s.turn === 0 && !s.result && !ENOS.jeux.cur.inst._busy()); })()" % S, timeout=120000)
            if pg.locator(".pk-res").count(): break
            pg.click('#pk-acts [data-a="call"]'); pg.wait_for_timeout(300)
    pg.evaluate("(() => { const s = %s; s.chips = s.chips.map((c, i) => i === 0 ? 6000 : 0); })()" % S)
    pg.click(".pk-res button"); pg.wait_for_selector("#gm-end:not([hidden])", timeout=15000)
    check("Victoire" in pg.inner_text("#gm-end"), "fin : Victoire (" + pg.inner_text("#gm-end p") + ")")
    pg.click('#gm-end [data-a="quit"]')
    # local à 2 : rideau
    open_tool(pg, "poker"); pg.click('#tool-poker .gm-mode[data-m="local"]'); pg.click('#tool-poker .gm-count:not(.gm-lvl):not(.gm-opt) [data-n="2"]')
    pg.click("#tool-poker #gm-go"); pg.wait_for_selector(".ch-curtain", timeout=60000)
    check(pg.locator("#pk-hand img.pk-c").count() == 0, "local : cartes cachées derrière le rideau")
    pg.click(".ch-curtain button"); pg.wait_for_timeout(500)
    check(pg.locator("#pk-hand img.pk-c").count() == 2, "local : cartes visibles après le rideau")
    pg.screenshot(path=SH + "poker_local.png")
    pg.click(".gm-x"); pg.wait_for_selector("#sheet:not([hidden]) .opt.bad"); pg.wait_for_timeout(400); pg.click("#sheet .opt.bad")
    pg.wait_for_function("!document.getElementById('gm-stage')", timeout=5000); check(True, "quitter : la confirmation s'affiche au-dessus du jeu et se touche")
    if stacks: print("PILE", stacks[:2])
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
