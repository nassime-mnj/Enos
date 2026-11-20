"""Néo-Cité 3D : salon, plateau 3D, lancer de dés, achat, bots qui jouent, gestion (construction), fiche d'un lot, fin de partie."""
from mobile_common import *
errs = []
SH = (os.environ.get("SHOTS") or "/tmp") + "/"
S = "ENOS.jeux.cur.inst._st()"
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(60000)
    stacks = []; pg.on("pageerror", lambda e: stacks.append((e.stack or str(e))[:500]))
    pg.add_style_tag(content="#toasts{display:none!important}")
    open_tool(pg, "neocite"); pg.wait_for_selector("#tool-neocite .gm-mode")
    pg.click('#tool-neocite .gm-mode[data-m="bots"]'); pg.click('#tool-neocite .gm-count:not(.gm-lvl):not(.gm-opt) [data-n="4"]')
    check(pg.locator("#tool-neocite .gm-bots .bp-slot").count() == 3, "4 joueurs : 3 bots")
    pg.click("#tool-neocite #gm-go"); pg.wait_for_selector("#gm-stage canvas.g3-canvas")
    pg.wait_for_function("ENOS.jeux.cur && ENOS.jeux.cur.inst && ENOS.jeux.cur.inst._st", timeout=60000)
    pg.wait_for_selector('#nc-acts [data-a="roll"]', timeout=20000)
    check(pg.locator(".nc-pl").count() == 4, "4 joueurs affichés avec leur capital")
    pg.screenshot(path=SH + "neocite_3d.png")
    # notre tour : on force un 1+2 -> lot 3 (Phare Noir)
    pg.evaluate("(() => { const N = ENOS.neocite, s = %s; const r = N.roll; N.roll = (st) => { N.roll = r; return r(st, 1, 2); }; })()" % S)
    pg.click('#nc-acts [data-a="roll"]'); pg.wait_for_selector('#nc-acts [data-a="buy"]', timeout=20000)
    check(pg.locator("#nc-deed .nc-card").count() == 1 and "Phare Noir" in pg.inner_text("#nc-deed"), "fiche du lot proposée à l'achat")
    pg.screenshot(path=SH + "neocite_buy.png")
    pg.click('#nc-acts [data-a="buy"]'); pg.wait_for_selector('#nc-acts [data-a="end"]')
    check(pg.evaluate(S + ".own[3] && " + S + ".own[3].p") == 0, "lot acheté")
    pg.click('#nc-acts [data-a="end"]')
    # les 3 bots jouent, puis c'est de nouveau à nous
    pg.wait_for_function("(() => { const s = %s; return s.turn === 0 && !ENOS.jeux.cur.inst._busy() && s.round === 2 || s.over; })()" % S, timeout=120000)
    check(pg.evaluate(S + ".rolls") >= 4, "les bots ont joué leur tour (%d lancers)" % pg.evaluate(S + ".rolls"))
    pg.wait_for_timeout(400); pg.screenshot(path=SH + "neocite_3d_2.png")
    # refuser d'acheter : on force 1+3 -> case 4 (Signal) ... on prend plutôt un lot libre
    pg.wait_for_selector('#nc-acts [data-a="roll"]', timeout=60000)
    free = pg.evaluate("(() => { const s = %s, N = ENOS.neocite; for (let d = 3; d <= 12; d++) { const sq = (s.pos[0] + d) %% N.SIZE; if (N.BOARD[sq].type === 'lot' && !s.own[sq]) return d; } return 0; })()" % S)
    if free:
        pg.evaluate("(() => { const N = ENOS.neocite, r = N.roll; N.roll = (st) => { N.roll = r; return r(st, 1, %d); }; })()" % (free - 1))
        pg.click('#nc-acts [data-a="roll"]'); pg.wait_for_selector('#nc-acts [data-a="pass"]', timeout=30000)
        sq = pg.evaluate(S + ".pending"); pg.click('#nc-acts [data-a="pass"]'); pg.wait_for_timeout(300)
        check(not pg.evaluate(S + ".own[%d]" % sq) and pg.locator("#sheet:not([hidden])").count() == 0, "refuser d'acheter : le lot reste libre, aucune enchère")
        pg.click('#nc-acts [data-a="end"]')
        pg.wait_for_function("(() => { const s = %s; return s.turn === 0 && !ENOS.jeux.cur.inst._busy() && (s.phase === 'roll' || s.phase === 'jailed'); })()" % S, timeout=180000)
    # case Enchères (coin en bas à droite) : on y amène le joueur
    pg.evaluate("(() => { const s = %s; s.jail[0] = -1; s.phase = 'roll'; s.pos[0] = 21; const N = ENOS.neocite, r = N.roll; N.roll = (st) => { N.roll = r; return r(st, 1, 2); }; })()" % S)
    pg.click('#nc-acts [data-a="roll"]'); pg.wait_for_selector("#sheet:not([hidden]) .nc-card", timeout=30000)
    check("Enchères" in pg.inner_text("#sheet"), "case Enchères : feuille d'offre sous pli fermé")
    pg.screenshot(path=SH + "neocite_auction.png")
    pg.click("#sheet .opt >> nth=1"); pg.wait_for_selector('#nc-acts [data-a="end"]', timeout=30000)
    check(True, "enchère résolue : " + pg.inner_text("#nc-log"))
    # échange : on propose de l'argent contre un lot d'un bot
    pg.evaluate("(() => { const s = %s; s.own[30] = { p: 1, lvl: 0, mort: false }; s.cash[0] = 3000; })()" % S)
    pg.click('#nc-acts [data-a="manage"]'); pg.wait_for_selector('#sheet [data-a="trade"]'); pg.click('#sheet [data-a="trade"]')
    pg.wait_for_selector("#sheet .nc-trade [data-to]"); pg.click('#sheet .nc-trade [data-to="1"]'); pg.click('#sheet .nc-trade [data-get="30"]')
    for _ in range(9): pg.click('#sheet .nc-cash [data-c="100"]')
    pg.screenshot(path=SH + "neocite_trade.png")
    pg.click("#sheet [data-send]"); pg.wait_for_function("%s.own[30].p === 0 || document.querySelector('#nc-log').textContent.includes('refuse')" % S, timeout=20000)
    check(pg.evaluate(S + ".own[30].p") == 0, "échange : ETO accepte 900 € pour son lot")
    # découvert affiché en négatif
    pg.evaluate("(() => { const s = %s; s.cash[0] = -400; })()" % S); pg.evaluate("ENOS.jeux.cur.inst._next()"); pg.wait_for_timeout(300)
    check(pg.locator(".nc-pl.neg").count() >= 1 and "−400" in pg.inner_text(".nc-players").replace("\u00a0", " "), "découvert : solde négatif affiché en rouge")
    # gestion : on donne le quartier complet puis on construit
    pg.evaluate("(() => { const s = %s; [1,2,3].forEach((i) => s.own[i] = { p: 0, lvl: 0, mort: false }); })()" % S)
    if pg.locator('#nc-acts [data-a="manage"]').count():
        pg.click('#nc-acts [data-a="manage"]'); pg.wait_for_selector("#sheet .nc-row")
        pg.click('#sheet .nc-row [data-a="build"] >> nth=0'); pg.wait_for_timeout(400)
        check(pg.evaluate("[1,2,3].some((i) => %s.own[i].lvl === 1)" % S), "antenne construite depuis « Gérer »")
        pg.evaluate("ENOS.ui.closeSheet(true)")
    # fin : les autres font faillite
    pg.evaluate("(() => { const s = %s; s.out = s.out.map((o, i) => i !== 0); s.over = { winner: 0, reason: 'last' }; })()" % S)
    pg.evaluate("ENOS.jeux.cur.inst._next()"); pg.wait_for_selector("#gm-end:not([hidden])", timeout=15000)
    check("Victoire" in pg.inner_text("#gm-end"), "fin : Victoire")
    pg.click('#gm-end [data-a="quit"]')
    if stacks: print("PILE", stacks[:2])
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
