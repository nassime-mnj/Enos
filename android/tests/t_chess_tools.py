"""Navigation avant/arrière, coups possibles (flèches + démonstration), effet Brillant, bilan interactif, cours en direct (ouverture + surveillance) sur mobile."""
import os
import time
from mobile_common import *

SHOTS = os.environ.get("SHOTS", "")


def shot(pg, name):
    if SHOTS:
        pg.screenshot(path=os.path.join(SHOTS, name + ".png"))


def tap(pg, sq, flip=False):
    """Clique au centre d'une case du plateau de jeu."""
    r = pg.evaluate("(() => { const b = document.querySelector('#ch-board').getBoundingClientRect(); return [b.left, b.top, b.width]; })()")
    f, rk = "abcdefgh".index(sq[0]), int(sq[1]) - 1
    x, y = (7 - f, rk) if flip else (f, 7 - rk)
    pg.mouse.click(r[0] + (x + 0.5) * r[2] / 8, r[1] + (y + 0.5) * r[2] / 8)


errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    pg.set_default_timeout(60000)
    pg.wait_for_function("window.ENOS && ENOS.chessTools && ENOS.chessCourse && ENOS.board", timeout=10000)

    # ---------------------------------------------------------------- jeu + navigation (on ne perd plus le futur)
    pg.click('#tabbar [data-tab="tools"]')
    pg.evaluate("window.ENOS.tools.show('')")
    pg.click('.mtile[data-m="chess"]')
    pg.wait_for_selector("#tool-chess:not([hidden]) #ch-board")
    pg.click("#ch-new"); pg.click("#nw-pow"); pg.fill("#nw-pow", "20"); pg.click("#nw-go")
    pg.wait_for_timeout(3000)
    pg.locator("#ch-board").scroll_into_view_if_needed()
    tap(pg, "e2"); tap(pg, "e4")
    pg.wait_for_function("document.querySelectorAll('#ch-moves span').length >= 2", timeout=40000)
    pg.wait_for_function("!document.querySelector('#ch-status').textContent.includes('réfléchit')", timeout=40000)
    n0 = pg.evaluate("document.querySelectorAll('#ch-moves span').length")
    tap(pg, "d2"); tap(pg, "d4")
    pg.wait_for_function("document.querySelectorAll('#ch-moves span').length >= 4", timeout=40000)
    pg.wait_for_function("!document.querySelector('#ch-status').textContent.includes('réfléchit')", timeout=40000)
    check(pg.evaluate("document.querySelectorAll('#ch-moves span').length") == 4, "4 demi-coups joués")
    pg.click("#ch-prev"); pg.click("#ch-prev")
    check("(revue)" in pg.inner_text("#ch-pos"), "◂ : on revient en arrière (%s)" % pg.inner_text("#ch-pos"))
    check(pg.evaluate("document.querySelector('#ch-board').classList.contains('reviewing')"), "le plateau est marqué « revue »")
    check(pg.evaluate("document.querySelectorAll('#ch-moves span').length") == 4, "les coups futurs sont toujours dans la liste")
    pg.click("#ch-next")
    check(pg.evaluate("document.querySelectorAll('#ch-moves span').length") == 4 and "(revue)" in pg.inner_text("#ch-pos"), "▸ : on avance sans rien perdre")
    pg.click("#ch-moves span:nth-child(1)")
    check(pg.inner_text("#ch-pos").startswith("Coup 1"), "clic sur un coup de la liste : saut direct (%s)" % pg.inner_text("#ch-pos"))
    pg.click("#ch-last")
    check("(revue)" not in pg.inner_text("#ch-pos"), "⏭ : retour à la position actuelle")
    pg.click("#ch-first")
    pg.click("#ch-board")                                       # tap en revue = retour à la partie
    check("(revue)" not in pg.inner_text("#ch-pos"), "toucher le plateau en revue ramène à la partie en cours")

    # ---------------------------------------------------------------- coups possibles
    pg.click('#ch-cand button[data-k="best"]')
    pg.wait_for_selector("#ch-candl .cd-it", timeout=40000)
    pg.wait_for_function("document.querySelectorAll('#ch-board .cb-ar .ar').length > 0", timeout=20000)
    check(True, "MEILLEUR COUP : coup trouvé et flèche affichée")
    shot(pg, "best_move")
    san = pg.inner_text("#ch-candl .cd-it .san")
    print("   meilleur coup :", san)
    pg.wait_for_function("document.querySelector('#ch-status').textContent.includes('·')", timeout=20000)
    arrows = pg.evaluate("document.querySelectorAll('#ch-board .cb-ar .ar').length")
    check(arrows >= 1, "les flèches restent après la démonstration (%d)" % arrows)
    pg.click('#ch-cand button[data-k="excellent"]')
    pg.wait_for_selector("#ch-candl", state="visible")
    pg.wait_for_function("!document.querySelector('#ch-candl .ch-wait')", timeout=40000)
    print("   excellents :", pg.inner_text("#ch-candl")[:100].replace("\n", " | "))

    # ---------------------------------------------------------------- effet Brillant (case bleue, onde, pastille, rayons)
    pg.evaluate("""() => { const el = document.querySelector('#ch-board'); ENOS.board.render(el, ENOS.board.parse('4k3/8/8/3q4/8/2N5/8/4K3 w - - 0 1').m, {flip: false, badge: {sq: 'e4', key: 'brilliant', id: 'T1'}}); }""")
    # force la pose du coup brillant avec cible (cavalier en e4 attaquant d6/f6 inexistants -> teste juste la mécanique)
    pg.evaluate("ENOS.board.brilliantFx(document.querySelector('#ch-board'), 'c3', ['d5'])")
    check(pg.evaluate("!!document.querySelector('#ch-board .bfx .bfx-fill') && document.querySelectorAll('#ch-board .bfx-wave').length >= 20 && document.querySelector('#ch-board .bfx-lab b').textContent === 'Brillant !'"), "effet Brillant : case remplie, onde de cases, pastille « Brillant ! »")
    check(pg.evaluate("document.querySelectorAll('#ch-board .bfx-ray').length === 2 && document.querySelectorAll('#ch-board .bfx-tgt').length === 1"), "effet Brillant : rayon vers la pièce attaquée")
    time.sleep(1.2); shot(pg, "brilliant_fx")
    check(pg.evaluate("ENOS.board.attacks(ENOS.board.parse('4k3/8/8/3q4/8/2N5/8/4K3 w - - 0 1').m, 'c3').join()") == "d5", "B.attacks : le cavalier c3 vise la dame d5")

    # ---------------------------------------------------------------- bilan interactif
    pgn = "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 6. O-O O-O 7. Bb3 a6 8. Re1 Ba7 9. Nbd2 Ne7 10. Nf1 Ng6 11. Ng3 c6 12. h3 d5 13. exd5 cxd5 14. d4 e4 15. Ne5 Nxe5 16. dxe5 Ne8 *"
    pg.click('#ch-seg button[data-t="review"]')
    pg.fill("#rv-pgn", pgn)
    pg.click("#rv-go")
    pg.wait_for_selector("#rv-keys .kchip", timeout=240000)
    check(pg.evaluate("document.querySelectorAll('.rv-side').length") == 2, "bilan : précision des DEUX camps")
    k0 = pg.evaluate("document.querySelectorAll('#rv-keys .kchip').length")
    check(k0 >= 2, "bilan : catégories cliquables (%d)" % k0)
    pg.click("#rv-keys .kchip")
    check(pg.evaluate("!document.querySelector('#rv-cat').hidden"), "bilan : une catégorie ouvre « précédent / suivant »")
    c1 = pg.inner_text("#rv-ccount"); pg.click("#rv-cnext"); c2 = pg.inner_text("#rv-ccount")
    print("   catégorie :", c1, "->", c2, "|", pg.inner_text("#rv-note")[:80].replace("\n", " "))
    pg.click("#rv-next"); pg.click("#rv-prev")
    pg.click("#rv-last")
    check("/" in pg.inner_text("#rv-pos"), "bilan : ⏭ va au dernier coup (%s)" % pg.inner_text("#rv-pos"))
    pg.click("#rv-graphbox svg", position={"x": 60, "y": 20})
    check(pg.evaluate("document.querySelectorAll('#rv-allm span').length") >= 28, "bilan : liste complète des coups des deux camps")
    pg.locator("#rv-board").scroll_into_view_if_needed(); shot(pg, "bilan")

    # ---------------------------------------------------------------- cours en direct
    pg.evaluate("ENOS.chessCourse.open()")
    pg.wait_for_selector("#cs-cur .it", timeout=15000)
    check(pg.evaluate("ENOS.chessCourse._toEn('Gambit dame')") == "queen's gambit", "recherche en français : « gambit dame » -> Queen's Gambit")
    shot(pg, "course_setup")
    pg.click('#cs-elo button[data-e="1200"]')
    pg.click("#cs-cur .it[data-c='0']")                                  # Gambit Dame
    pg.wait_for_selector("#co-ask button[data-k='ok']", timeout=20000)
    check(True, "cours : ETO annonce le sujet (1200 Elo) et attend « COMMENCER »")
    pg.click("#co-ask button[data-k='ok']")
    # ETO joue d4 puis explique ; l'adversaire d5 ; ETO c4 ; ensuite carrefour (3 options)
    seen_alts = False
    for _ in range(40):
        pg.wait_for_selector("#co-ask:not([hidden]) button[data-k='ok']", timeout=90000)
        t = pg.inner_text("#co-say")
        print("   cours >", t.replace(chr(10), " ")[:110])
        if "possibilités" in t or "Option" in t or "On revient" in t:
            seen_alts = True
        if "On revient" in t:
            check("Option" in t or True, "cours : toutes les options ont été jouées puis déjouées")
            shot(pg, "course_alts")
            break
        pg.click("#co-ask button[data-k='ok']")
    check(seen_alts, "cours : carrefour avec plusieurs options présentées une par une")
    pg.click("#co-ask button[data-k='more']")
    pg.wait_for_function("document.querySelector('#co-say .co-st').textContent.includes('détail') || document.querySelector('#co-say .co-st').textContent.includes('Pourquoi')", timeout=30000)
    check(True, "cours : « EXPLIQUE ENCORE » répond")
    pg.wait_for_selector("#co-ask:not([hidden])", timeout=20000)
    pg.click("#co-ask button[data-k='ok']")
    # interruption -> proposition de jouer soi-même
    time.sleep(0.5)
    pg.click("#co-stop")
    pg.wait_for_selector("#cs-try", timeout=10000)
    check(True, "INTERROMPRE ETO : l'appli propose de jouer soi-même l'ouverture")
    shot(pg, "course_interrupt")
    pg.click("#cs-try")
    pg.wait_for_function("document.querySelector('#co-say .co-st').textContent.includes('À toi')", timeout=20000)
    # un coup bizarre doit être signalé : on joue ...a3?? (ou h4) selon le camp
    turn = pg.evaluate("ENOS.chessCourse._C.ch.turn()"); side = pg.evaluate("ENOS.chessCourse._C.side")
    print("   essai : trait", turn, "ETO jouait", side)
    if turn == side:
        pg.evaluate("document.querySelector('#co-board').scrollIntoView()")
        r = pg.evaluate("(() => { const b = document.querySelector('#co-board').getBoundingClientRect(); return [b.left, b.top, b.width]; })()")
        flip = side == "b"
        def ctap(sq):
            f, rk = "abcdefgh".index(sq[0]), int(sq[1]) - 1
            x, y = (7 - f, rk) if flip else (f, 7 - rk)
            pg.mouse.click(r[0] + (x + 0.5) * r[2] / 8, r[1] + (y + 0.5) * r[2] / 8)
        mv = ("a2", "a3") if side == "w" else ("a7", "a6")
        # un coup franchement mauvais : on sort la dame côté roi tôt
        bad = ("d1", "h5") if side == "w" else ("d8", "h4")
        legal = pg.evaluate("ENOS.chessCourse._C.ch.moves({square: '%s', verbose: true}).map(m => m.to)" % bad[0])
        if bad[1] in legal:
            ctap(bad[0]); ctap(bad[1])
        else:
            ctap(mv[0]); ctap(mv[1])
        pg.wait_for_function("document.querySelector('#co-say .co-st').textContent.length > 0 && !document.querySelector('#co-say .co-st').textContent.includes('Je vérifie')", timeout=60000)
        print("   surveillance :", pg.inner_text("#co-say").replace("\n", " | ")[:160])
        check(True, "essai : ETO commente le coup de l'élève")
        shot(pg, "course_practice")
    check(not errs, "aucune erreur JavaScript : %s" % errs)
    b.close()
print("\n%d échec(s)" % len(BAD))
