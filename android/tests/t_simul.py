"""Simultanée : 4 plateaux, adversaire qui fait le tour, victoire d'équipe dès qu'un membre gagne, enregistrement pour Chess Edit."""
from mobile_common import *

errs = []
API = "document.querySelector('#tool-simul .suite-body')._api"
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(180000)
    pg.evaluate("ENOS.modules.open('simul')"); pg.wait_for_selector("#sm-go")
    check(pg.evaluate("ENOS.hub.has('simul')"), "rangée dans Échecs › Affronter")
    check(pg.locator("#sm-mem select").count() == 4 and pg.locator("#sm-n button").count() == 3, "réglage : 4 plateaux par défaut, 2 à 4 possibles")
    pg.click('#sm-n [data-n="3"]'); check(pg.locator("#sm-mem select").count() == 3, "3 plateaux : 3 joueurs")
    pg.click('#sm-n [data-n="4"]')
    pg.evaluate("[...document.querySelectorAll('#sm-mem select')].forEach((s) => { s.value = 'bot:400'; }); document.querySelector('#sm-boss').value = 'bot:600'")
    pg.click("#sm-go"); pg.wait_for_selector("#sm-game:not([hidden]) #sm-board .cb-sq")
    check(pg.locator("#sm-th .sm-t").count() == 4, "4 vignettes de plateaux")
    pg.wait_for_function("%s.S.boards.reduce((a, b) => a + b.moves.length, 0) >= 10" % API, timeout=150000)
    s1 = pg.evaluate("(() => { const S = %s.S; return { n: S.boards.map((b) => b.moves.length), order: S.order.length, boss: S.bossAt, byBoss: S.boards[0].moves.map((m) => m.color).join('') }; })()" % API)
    print(s1)
    check(all(n >= 1 for n in s1["n"]) and 0 <= s1["order"] - sum(s1["n"]) <= 4, "l'adversaire a joué sur chaque plateau (%s) ; ordre enregistré : %d coups" % (s1["n"], s1["order"]))
    check(s1["byBoss"][:2] == "wb", "Blancs = adversaire, Noirs = le joueur du plateau")
    # un membre gagne (mat du berger inversé) : toute l'équipe gagne
    pg.evaluate("(() => { const S = %s.S; S.boards[1].ch.load('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2'); S.boards[1].busy = false; })()" % API)
    pg.evaluate("%s.applyMove(1, 'd8h4', 'b')" % API)
    pg.wait_for_function("%s.S.over" % API, timeout=60000)
    over = pg.evaluate("%s.S.over" % API); check("équipe gagne" in over.lower(), "il suffit qu'un seul gagne : %s" % over)
    rec = pg.evaluate("ENOS.settings.get('simul.hist', []).pop()")
    check(rec and rec["simul"]["boards"] and len(rec["simul"]["boards"]) == 4 and rec["simul"]["team"] == 1 and rec["result"] == "L'équipe gagne", "partie enregistrée : %s" % (rec and rec["title"]))
    check(rec["simul"]["order"] and rec["mv"] and rec["plies"] >= 4, "ordre des coups + coups du plus long plateau")
    pg.evaluate("ENOS.ui.closeSheet(true)")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
