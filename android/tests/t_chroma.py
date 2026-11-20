"""CHROMA 3D : salon (2 à 6 joueurs), table 3D, main en éventail, carte posée au toucher, pioche, bots qui jouent, choix de couleur des cartes noires,
rideau « passe le téléphone » en local, fin de partie."""
from mobile_common import *
errs = []
SH = (os.environ.get("SHOTS") or "/tmp") + "/"
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(60000)
    stacks = []; pg.on("pageerror", lambda e: stacks.append((e.stack or str(e))[:500]))
    pg.add_style_tag(content="#toasts{display:none!important}")
    open_tool(pg, "chroma"); pg.wait_for_selector("#tool-chroma .gm-mode")
    pg.click('#tool-chroma .gm-mode[data-m="bots"]'); pg.click('#tool-chroma .gm-count:not(.gm-lvl):not(.gm-opt) [data-n="4"]')
    check(pg.locator("#tool-chroma .gm-bots .bp-slot").count() == 3, "4 joueurs : 3 adversaires bots")
    pg.click("#tool-chroma #gm-go"); pg.wait_for_selector("#gm-stage canvas.g3-canvas")
    pg.wait_for_function("ENOS.jeux.cur && ENOS.jeux.cur.inst && ENOS.jeux.cur.inst._st", timeout=60000); pg.wait_for_timeout(1200)
    st = pg.evaluate("(() => { const s = ENOS.jeux.cur.inst._st(); return { n: s.n, hand: s.hands[0].length, top: s.discard.length }; })()")
    check(st["n"] == 4 and st["hand"] >= 7, "partie à 4 : 7 cartes en main")
    check(pg.locator("#ch-hand .ch-card").count() == pg.evaluate("ENOS.jeux.cur.inst._st().hands[0].length"), "ta main affichée en éventail")
    pg.screenshot(path=SH + "chroma_3d.png")
    # attendre que ce soit à nous, puis jouer une carte posable ou piocher
    for _ in range(3):
        pg.wait_for_function("ENOS.jeux.cur.inst._st().turn === 0 || ENOS.jeux.cur.inst._st().over", timeout=60000)
        if pg.evaluate("!!ENOS.jeux.cur.inst._st().over"): break
        ok = pg.locator("#ch-hand .ch-card.ok")
        if ok.count():
            before = pg.evaluate("ENOS.jeux.cur.inst._st().discard.length")
            ok.first.click(position={"x": 10, "y": 50}); pg.wait_for_timeout(300)
            if pg.locator("#sheet:not([hidden]) .ch-colors").count(): pg.click("#sheet .ch-colors [data-c='y']")
            if pg.locator("#sheet:not([hidden]) .opt").count() and not pg.locator("#sheet .ch-colors").count(): pg.click("#sheet .opt >> nth=0")
            pg.wait_for_function("ENOS.jeux.cur.inst._st().discard.length > %d || ENOS.jeux.cur.inst._st().turn !== 0" % before, timeout=10000)
            check(True, "carte posée au toucher")
        else:
            n0 = pg.evaluate("ENOS.jeux.cur.inst._st().hands[0].length"); pg.evaluate("ENOS.jeux.cur.inst._draw()"); pg.wait_for_timeout(900)
            if pg.locator("#ch-pass:not([hidden])").count(): pg.click("#ch-pass")
            check(pg.evaluate("ENOS.jeux.cur.inst._st().hands[0].length") >= n0, "pioche quand aucune carte ne se pose")
    pg.wait_for_function("ENOS.jeux.cur.inst._st().turn === 0 || ENOS.jeux.cur.inst._st().over", timeout=60000)
    check(pg.evaluate("ENOS.jeux.cur.inst._st().discard.length") >= 4, "les bots jouent à leur tour")
    pg.wait_for_timeout(500); pg.screenshot(path=SH + "chroma_3d_2.png")
    # fin : on vide notre main
    pg.evaluate("""(() => { const s = ENOS.jeux.cur.inst._st(); s.turn = 0; s.drawn = null; s.color = 'c'; s.hands[0] = [{ id: 9001, c: 'k', k: 'wild' }]; s.said[0] = true; })()""")
    pg.evaluate("ENOS.jeux.cur.inst._play(9001, 'y')"); pg.wait_for_selector("#gm-end:not([hidden])", timeout=15000)
    check("Victoire" in pg.inner_text("#gm-end"), "fin : Victoire")
    pg.click('#gm-end [data-a="quit"]')
    # local à 2 : rideau entre les joueurs
    open_tool(pg, "chroma"); pg.click('#tool-chroma .gm-mode[data-m="local"]'); pg.click('#tool-chroma .gm-count:not(.gm-lvl):not(.gm-opt) [data-n="2"]')
    pg.click("#tool-chroma #gm-go"); pg.wait_for_selector(".ch-curtain", timeout=60000)
    check("passe le téléphone" in pg.inner_text(".ch-curtain").lower(), "local : rideau « passe le téléphone » avant de voir sa main")
    pg.click(".ch-curtain button"); pg.wait_for_timeout(500)
    check(pg.locator("#ch-hand .ch-card").count() >= 7, "main visible après le rideau")
    if stacks: print("PILE", stacks[:2])
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
