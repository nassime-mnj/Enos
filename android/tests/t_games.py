"""Jeux : 2048 Néon (fusions, fin de partie), Serpent (croissance, mort), Démineur (1er clic sûr, drapeau, victoire)."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    pg.click('#tabbar [data-tab="tools"]'); pg.evaluate("ENOS.tools.show('')")
    for m in ("purge", "g2048", "snake", "mines"):
        check(pg.locator('.mtile[data-m="%s"]' % m).count() == 1, "tuile « %s » dans le groupe Jeux" % m)
    # ---- 2048
    check(pg.evaluate("JSON.stringify(ENOS.games.G2048.slide([2,2,4,4]).line)") == "[4,8,0,0]", "2048 : [2,2,4,4] -> [4,8,0,0]")
    check(pg.evaluate("JSON.stringify(ENOS.games.G2048.slide([2,2,2,0]).line)") == "[4,2,0,0]", "2048 : trois 2 -> 4 puis 2 (une fusion par paire)")
    check(pg.evaluate("ENOS.games.G2048.slide([2,2,4,4]).gain") == 12, "2048 : gain de score 12")
    open_tool(pg, "g2048")
    api = "document.querySelector('#tool-g2048 .suite-body')._api"
    check(pg.evaluate(f"{api}.board.filter(Boolean).length") == 2, "2048 : deux tuiles au départ")
    pg.evaluate(f"{api}.board = [2,2,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]")
    pg.evaluate(f"{api}.play('L')")
    check(pg.evaluate(f"{api}.board[0]") == 4 and pg.evaluate(f"{api}.score") == 4, "2048 : glisser à gauche fusionne et marque 4")
    pg.evaluate(f"{api}.board = [2,4,2,4, 4,2,4,2, 2,4,2,4, 4,2,4,8]")
    check(pg.evaluate("ENOS.games.G2048.over([2,4,2,4,4,2,4,2,2,4,2,4,4,2,4,8])") is True, "2048 : plateau bloqué = fin de partie")
    # ---- Serpent
    open_tool(pg, "snake")
    sn = "document.querySelector('#tool-snake .suite-body')._api"
    pg.evaluate(f"{sn}.start(); {sn}.stop()")
    pg.evaluate(f"{sn}.food = [{sn}.snake[0][0] + 1, {sn}.snake[0][1]]; {sn}.tick()")
    check(pg.evaluate(f"{sn}.score") == 1 and pg.evaluate(f"{sn}.snake.length") == 4, "Serpent : manger fait grandir (score 1, longueur 4)")
    pg.evaluate(f"{sn}.snake = [[17, 5], [16, 5], [15, 5]]; {sn}.tick()")
    check(pg.evaluate(f"{sn}.alive") is False, "Serpent : le mur tue")
    pg.wait_for_selector("#sheet .opt"); pg.click("#sheet .opt >> text=FERMER")
    # ---- Démineur
    open_tool(pg, "mines")
    mn = "document.querySelector('#tool-mines .suite-body')._api"
    pg.evaluate(f"{mn}.dig(44)")
    G = pg.evaluate(f"({{over: {mn}.G.over, mine44: {mn}.G.mine[44], opened: {mn}.G.open.filter(Boolean).length}})")
    check(not G["over"] and not G["mine44"] and G["opened"] >= 1, "Démineur : le 1er clic ne tombe jamais sur une mine (%d cases ouvertes)" % G["opened"])
    nmines = pg.evaluate(f"{mn}.G.mine.filter(Boolean).length")
    check(nmines == 10, "Démineur : 10 mines en facile")
    pg.evaluate(f"{mn}.flag(0)")
    check(pg.evaluate(f"{mn}.G.flag[0]") or pg.evaluate(f"{mn}.G.open[0]"), "Démineur : drapeau posé")
    # victoire : on ouvre toutes les cases sans mine
    pg.evaluate(f"(() => {{ const G = {mn}.G; for (let i = 0; i < G.w * G.h; i++) if (!G.mine[i]) {mn}.dig(i); }})()")
    check(pg.evaluate(f"{mn}.G.won") is True, "Démineur : toutes les cases sûres ouvertes = gagné")
    # défaite
    pg.wait_for_selector("#sheet .opt"); pg.click("#sheet .opt >> text=FERMER")
    pg.evaluate(f"{mn}.newGame(); {mn}.dig(44)")
    pg.evaluate(f"(() => {{ const G = {mn}.G, i = G.mine.indexOf(true); {mn}.dig(i); }})()")
    check(pg.evaluate(f"{mn}.G.over && !{mn}.G.won"), "Démineur : une mine = perdu")
    check(not errs, "aucune erreur JavaScript : %s" % errs)
print("\n%d échec(s)" % len(BAD))
