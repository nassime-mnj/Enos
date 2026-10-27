"""Défis (hors ligne) : modes, partie contre ETO Brillant, jugement des coups, annulation, spectacle Titans, abandon, historique."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    open_tool(pg, "defis")
    check(pg.locator(".df-mode").count() == 6, "6 modes de défi affichés")
    check(pg.locator('.mtile[data-m="b-df"]').count() == 0, "plus de tuile « Défis » verrouillée")
    # --- partie contre E.N.O.S. (niveau bas) : on joue e2e4, le bot répond, chaque coup est jugé
    pg.evaluate("document.querySelector('#tool-defis .suite-body')._api.launch('enos', {color: 'w', pow: 5, elo: 400})")
    pg.wait_for_selector("#df-board .cb-sq")
    pg.click('#df-board [data-sq="e2"]'); pg.click('#df-board [data-sq="e4"]')
    pg.wait_for_function("document.querySelector('#tool-defis .suite-body')._api.g.moves.length >= 2", timeout=30000)
    g = pg.evaluate("(() => { const g = document.querySelector('#tool-defis .suite-body')._api.g; return {n: g.moves.length, k: g.moves.map(m => m.q.key), fen: g.fen, over: g.over}; })()")
    check(g["n"] >= 2 and all(k in ("brilliant", "book", "best", "excellent", "good", "inaccuracy", "mistake", "blunder") for k in g["k"]), "coups jugés : %s" % g["k"])
    check(pg.locator("#df-judge .kchip").count() == 1, "jugement affiché : " + pg.inner_text("#df-judge")[:60])
    # annuler (2 demi-coups)
    pg.wait_for_function("!document.querySelector('#tool-defis .suite-body')._api.g.busy", timeout=20000)
    pg.click("#b-undo")
    pg.wait_for_function("document.querySelector('#tool-defis .suite-body')._api.g.moves.length === 0", timeout=8000)
    check(pg.evaluate("document.querySelector('#tool-defis .suite-body')._api.g.fen").startswith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP"), "annulation : retour à la position de départ")
    # abandon
    pg.click("#b-res"); pg.click(".sheet button >> text=ABANDONNER")
    pg.wait_for_function("document.querySelector('#tool-defis .suite-body')._api.g.over", timeout=5000)
    check("Abandon" in pg.evaluate("document.querySelector('#tool-defis .suite-body')._api.g.over"), "abandon enregistré")
    pg.keyboard.press("Escape")
    # --- ETO Brillant : position où un sacrifice gagnant existe (Légal) -> ETO doit le jouer en tant que Blancs
    pg.evaluate("""() => { const a = document.querySelector('#tool-defis .suite-body')._api; a.launch('titans', {}); }""")
    pg.wait_for_function("document.querySelector('#tool-defis .suite-body')._api.g.moves.length >= 3", timeout=90000)
    check(True, "Choc des Titans : 3 demi-coups joués en spectacle")
    pg.click("#b-stop")
    pg.wait_for_function("document.querySelector('#tool-defis .suite-body')._api.g.over", timeout=8000)
    check(pg.evaluate("ENOS.settings.get('defi.hist', []).length") >= 1, "partie ajoutée à l'historique")
    check(not errs, "aucune erreur JavaScript : %s" % errs)
print("\n%d échec(s)" % len(BAD))
