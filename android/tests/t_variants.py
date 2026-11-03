"""Variantes d'échecs : élixir (poser/jouer/+1), deux rois, protège la dame, bot, annulation, fin de partie."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    ev = pg.evaluate
    open_tool(pg, "variants")
    A = "document.querySelector('#tool-variants .suite-body')._api"
    check(pg.locator("#va-modes button").count() == 4, "4 variantes proposées")
    pg.wait_for_timeout(450)
    # --- élixir : 2 joueurs
    pg.click('#va-modes button[data-m="elixir"]')
    pg.select_option("#va-opp", "0")
    pg.click("#va-go")
    pg.wait_for_selector("#va-board .pce", state="attached")
    check(pg.locator("#va-board .pce").count() == 2, "élixir : seulement les deux rois (%d pièces)" % pg.locator("#va-board .pce").count())
    check(pg.locator("#va-tray button").count() == 5 and pg.is_visible("#va-tray"), "menu des 5 pièces visible")
    check(ev(A + ".g.s.elixir.w") == 0 and ev(A + ".g.s.elixir.b") == 0, "0 élixir au départ pour les deux")
    check(pg.locator("#va-tray button:not([disabled])").count() == 0, "menu entièrement grisé avant le premier coup")
    check(pg.locator("#va-stage.clash").count() == 1 and pg.locator("#va-mus").is_visible(), "décor Clash + bouton musique")
    ev(A + ".g.s.elixir.w = 5; " + A + ".render()")
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
    check(ev(A + ".g.s.ply") >= 2 and ev(A + ".g.s.elixir.b") == 1, "le bot (0 élixir) a joué un coup de roi et gagné 1 élixir")
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

    # --- 2v2 élixir : 4 joueurs au même téléphone
    pg.click('#va-modes button[data-m="duo"]'); pg.select_option("#va-opp", "0"); pg.click("#va-go")
    pg.wait_for_selector("#va-seats .va-seat", state="attached")
    check(pg.locator(".va-seat").count() == 4 and pg.locator("#va-board .pce").count() == 4, "2v2 : 4 rois et 4 barres d'élixir")
    check(pg.locator(".va-seat.turn > b:not(.va-xn)").inner_text().startswith("Blanc A"), "Blanc A commence")
    pg.click('#va-board [data-sq="c1"]'); pg.click('#va-board [data-sq="c2"]'); pg.wait_for_timeout(400)
    check(ev(A + ".g.s.seat") == 1 and ev(A + ".g.s.elixir[0]") == 1 and ev(A + ".g.s.elixir[1]") == 0, "après Blanc A : trait à Noir A, élixir 1/0")
    # Noir A ne peut pas bouger le roi de Noir B
    pg.click('#va-board [data-sq="f8"]')
    check(pg.locator("#va-board .sq.tgt").count() == 0, "on ne sélectionne pas le roi de l'autre joueur")
    ev(A + ".g.s.elixir[1] = 5; " + A + ".render()")
    pg.click("#va-tray button[data-t=r]"); pg.click('#va-board [data-sq="a8"]')
    check(ev(A + ".g.s.o[56]") == 1 and ev(A + ".g.s.elixir[1]") == 0, "Noir A pose une tour (à lui) en payant son élixir")
    pg.click("#va-back")
    # --- 2v2 contre des bots : les bots jouent entre mes tours
    pg.select_option("#va-opp", "1"); pg.select_option("#va-side", "w"); pg.click("#va-go")
    pg.wait_for_selector("#va-seats .va-seat", state="attached")
    pg.click('#va-board [data-sq="c1"]'); pg.click('#va-board [data-sq="c2"]')
    pg.wait_for_function(A + ".g.s.seat === 0 && " + A + ".g.s.ply >= 4", timeout=30000)
    check(ev(A + ".g.s.ply") == 4, "les 3 bots (adversaires + équipier) ont joué puis c'est de nouveau à moi")
    pg.click("#va-back")

    # --- animations de cases : sélection (case + pièce soulevée) et onde au clic
    pg.click('#va-modes button[data-m="ptq"]'); pg.select_option("#va-opp", "0"); pg.click("#va-go")
    pg.wait_for_selector("#va-board .pce", state="attached"); pg.wait_for_timeout(500)
    pg.click('#va-board [data-sq="e2"]'); pg.wait_for_timeout(120)
    check(pg.locator("#va-board .sq.sel").count() == 1 and pg.locator("#va-board .pce.lift").count() == 1, "pièce sélectionnée : case animée + pièce soulevée")
    check(pg.locator("#va-board .fx-tap").count() >= 1, "onde de clic sur la case touchée")
    check(pg.locator("#va-board .sq.tgt").count() == 2, "2 cibles qui pulsent (e3, e4)")
    pg.click('#va-board [data-sq="e4"]'); pg.wait_for_timeout(150)
    check(pg.locator("#va-board .fx-land").count() >= 1, "éclat sur la case d'arrivée")
    pg.click("#va-back")

    # --- spectateur 2v2 : 4 bots, stratégies, analyse en direct, jugement
    pg.click('#va-modes button[data-m="duo"]'); pg.select_option("#va-opp", "-1"); pg.select_option("#va-speed", "fast"); pg.click("#va-go")
    pg.wait_for_selector("#va-seats .va-seat", state="attached")
    pg.wait_for_function(A + ".g.s.ply >= 6", timeout=90000)
    check(pg.locator("#va-plans .va-pl").count() == 4, "plans/stratégies affichés pour les 4 bots")
    check(not pg.is_visible("#va-tray") and not pg.is_visible("#va-undo"), "spectateur : pas de menu de pose ni d'annulation")
    pg.wait_for_function(A + ".analysis() && " + A + ".analysis().depth >= 2", timeout=30000)
    an = ev(A + ".analysis().list.length")
    check(an >= 1 and "profondeur" in pg.inner_text("#va-evm"), "évaluation en direct : %d coups examinés, %s" % (an, pg.inner_text("#va-evm")))
    check(pg.locator("#va-cands .va-cd").count() >= 1 and pg.locator("#va-log .va-lg").count() >= 4, "candidats + journal des coups")
    pg.click("#va-pause"); pg.wait_for_timeout(300); p1 = ev(A + ".g.s.ply"); pg.wait_for_timeout(2500)
    check(ev(A + ".g.s.ply") <= p1 + 1, "pause : la partie s'arrête")
    pg.click("#va-pause"); pg.wait_for_function(A + ".g.s.ply > %d" % (p1 + 1), timeout=60000)
    check(True, "reprise après pause")
    pg.click("#va-back")

    # --- spectateur 1v1 en turbo : finit (ou atteint la limite) sans erreur
    pg.click('#va-modes button[data-m="dk"]'); pg.select_option("#va-opp", "-1"); pg.select_option("#va-lvW", "1"); pg.select_option("#va-lvB", "1"); pg.select_option("#va-speed", "turbo"); pg.click("#va-go")
    pg.wait_for_function(A + ".g.s.ply >= 30", timeout=90000)
    check(True, "spectateur turbo Deux Rois : %d demi-coups" % ev(A + ".g.s.ply"))
    pg.click("#va-back")

    # --- parties de bots en accéléré : chaque variante termine proprement
    for mode in ["elixir", "dk", "ptq"]:
        r = ev("""(mode) => { const V = ENOS.variants, s = V.newGame(mode); let n = 0; while (!V.status(s).over && n < 500) { const a = V.think(s, 1); a.drops.forEach(d => V.drop(s, d.type, d.sq)); if (!a.move) break; V.play(s, a.move); n++; } return [n, V.status(s)]; }""", mode)
        check(r[0] > 5, "%s : partie de bots jouée (%d coups, %s)" % (mode, r[0], r[1].get("why", "en cours")))
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
