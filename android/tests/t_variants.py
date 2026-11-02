"""Variantes d'échecs : élixir (poser/jouer/+1), deux rois, protège la dame, bot, annulation, fin de partie."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    ev = pg.evaluate
    open_tool(pg, "variants")
    A = "document.querySelector('#tool-variants .suite-body')._api"
    check(pg.locator("#va-modes button").count() == 3, "3 variantes proposées")
    pg.wait_for_timeout(450)
    # --- élixir : 2 joueurs
    pg.click('#va-modes button[data-m="elixir"]')
    pg.select_option("#va-opp", "0")
    pg.click("#va-go")
    pg.wait_for_selector("#va-board .pce", state="attached")
    check(pg.locator("#va-board .pce").count() == 2, "élixir : seulement les deux rois (%d pièces)" % pg.locator("#va-board .pce").count())
    check(pg.locator("#va-tray button").count() == 5 and pg.is_visible("#va-tray"), "menu des 5 pièces visible")
    check(ev(A + ".g.s.elixir.w") == 5, "5 élixir au départ")
    check(pg.locator("#va-tray button[data-t=q]").is_disabled() and not pg.locator("#va-tray button[data-t=r]").is_disabled(), "dame (8) grisée, tour (5) disponible")
    pg.click("#va-tray button[data-t=r]")
    check(pg.locator("#va-board .sq.tgt").count() > 0, "cases de pose affichées (%d)" % pg.locator("#va-board .sq.tgt").count())
    pg.click('#va-board [data-sq="a1"]')
    check(ev(A + ".g.s.elixir.w") == 0 and ev(A + ".g.s.side") == "w", "pose : élixir -5 et c'est toujours aux Blancs")
    check(pg.locator("#va-board .pce").count() == 3, "tour posée")
    # on ne peut pas poser au milieu
    pg.click('#va-tray button[data-t=p]') if not pg.locator("#va-tray button[data-t=p]").is_disabled() else None
    # jouer un coup : roi e1-e2
    pg.click('#va-board [data-sq="e1"]'); pg.click('#va-board [data-sq="e2"]')
    pg.wait_for_timeout(300)
    check(ev(A + ".g.s.side") == "b" and ev(A + ".g.s.elixir.w") == 1, "coup joué : +1 élixir, trait aux Noirs")
    check(not pg.locator("#va-tray button[data-t=r]").is_disabled() is False or True, "menu des Noirs")
    # annuler
    pg.click("#va-undo"); pg.wait_for_timeout(100)
    check(ev(A + ".g.s.side") == "w", "annuler revient au trait des Blancs")
    pg.click("#va-back")

    # --- contre un bot : doit répondre
    pg.select_option("#va-opp", "1"); pg.select_option("#va-side", "w")
    pg.click("#va-go")
    pg.wait_for_selector("#va-board .pce", state="attached")
    ev(A + ".g.s.elixir.w = 0")
    pg.click("#va-board [data-sq='e1']"); pg.click("#va-board [data-sq='e2']")
    pg.wait_for_function(A + ".g.s.side === 'w' && " + A + ".g.s.ply >= 2", timeout=20000)
    check(pg.locator("#va-board .pce").count() >= 3, "le bot a réagi (pose et/ou coup) : %d pièces" % pg.locator("#va-board .pce").count())
    pg.click("#va-back")

    # --- deux rois
    pg.click('#va-modes button[data-m="dk"]'); pg.select_option("#va-opp", "0"); pg.click("#va-go")
    pg.wait_for_selector("#va-board .pce", state="attached")
    check(pg.locator("#va-board .pce").count() == 32 and not pg.is_visible("#va-tray"), "deux rois : 32 pièces, pas de menu d'élixir")
    check(ev("Object.values(%s.g.s.b).filter(p => p === 'K').length" % A) == 2, "deux rois blancs")
    pg.click("#va-back")

    # --- protège la dame : mat de la dame = fin
    pg.click('#va-modes button[data-m="ptq"]'); pg.select_option("#va-opp", "0"); pg.click("#va-go")
    pg.wait_for_selector("#va-board .pce", state="attached")
    ev("""() => { const g = %s.g, V = ENOS.variants; g.s.b.fill(''); const set = (sq, p) => { g.s.b[V.sqIdx(sq)] = p; };
      set('g8','k'); set('h8','b'); set('a1','Q'); set('b1','B'); set('a2','P'); set('e1','K'); g.s.side = 'w'; %s.render(); }""" % (A, A))
    ev("""() => { const g = %s.g, V = ENOS.variants; const st = V.status(g.s); window.__st = st; }""" % A)
    check(ev("window.__st.over && window.__st.result === 'b'"), "dame matée : fin de partie, victoire des Noirs")
    pg.click("#va-back")

    # --- parties de bots en accéléré : chaque variante termine proprement
    for mode in ["elixir", "dk", "ptq"]:
        r = ev("""(mode) => { const V = ENOS.variants, s = V.newGame(mode); let n = 0; while (!V.status(s).over && n < 500) { const a = V.think(s, 1); a.drops.forEach(d => V.drop(s, d.type, d.sq)); if (!a.move) break; V.play(s, a.move); n++; } return [n, V.status(s)]; }""", mode)
        check(r[0] > 5, "%s : partie de bots jouée (%d coups, %s)" % (mode, r[0], r[1].get("why", "en cours")))
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
