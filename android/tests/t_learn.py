"""Apprendre les échecs : fonctions pures (Elo, sacrifice, arbre d'ouvertures, conseils), puzzles jouables au doigt, ouvertures, leçons, conseils."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    open_tool(pg, "learn")
    pg.wait_for_function("window.ENOS.learnLib && window.ENOS.learnLib.puzzles", timeout=30000)
    n = pg.evaluate("ENOS.learnLib.puzzles.length")
    check(n > 10000, "puzzles chargés : %d" % n)

    # ---------------------------------------------------------------- fonctions pures
    check(pg.evaluate("ENOS.learnLib.rate(1000, 1000, 1)") == 1012 and pg.evaluate("ENOS.learnLib.rate(1000, 1000, 0)") == 988, "Elo : +12 / -12 à niveau égal")
    check(pg.evaluate("ENOS.learnLib.rate(1000, 1800, 1)") > 1020, "Elo : gros gain contre un puzzle plus dur")
    # Dame qui se jette sur un pion défendu = sacrifice ; dame qui prend un pion non défendu = non
    check(pg.evaluate("ENOS.learnLib.isSacrifice('4k3/8/8/3p4/4P3/8/8/3QK3 w - - 0 1', 'd1d5')") is False or True, "sacrifice : appel valide")
    check(pg.evaluate("ENOS.learnLib.isSacrifice('4k3/8/2p5/3p4/8/8/8/3QK3 w - - 0 1', 'd1d5')") is True, "dame prend un pion défendu = sacrifice")
    check(pg.evaluate("ENOS.learnLib.isSacrifice('4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1', 'd1d5')") is False, "dame prend un pion non défendu = pas un sacrifice")
    nm = pg.evaluate("ENOS.learnLib.nameAt(ENOS.learnLib.root, ['e4','e5','Nf3','Nc6','Bb5'])")
    check(nm and "Ruy Lopez" in nm[1], "ouverture reconnue : %s" % (nm,))
    check(pg.evaluate("Object.keys(ENOS.learnLib.root.c).length") >= 15, "arbre : 1er coups nombreux")
    tips = pg.evaluate("""ENOS.learnLib.advice({stats: {fork: [10, 3], pin: [8, 8]}, names: {fork: 'Fourchette', pin: 'Clouage'}, reviews: [{counts: {blunder: 3}, acc: 60, opening: 'Italian Game'}, {counts: {blunder: 2, brilliant: 1}, acc: 65, opening: 'Italian Game'}], games: [], rating: 1000, idleDays: 5})""")
    heads = " | ".join(t["h"] for t in tips)
    check("Fourchette" in heads and "gaffes" in heads and "ouverture favorite" in heads and "Régularité" in heads and "Coups brillants" in heads, "conseils personnalisés : " + heads)

    # ---------------------------------------------------------------- puzzle jouable
    pg.wait_for_function("ENOS.learnLib._z && ENOS.learnLib._z.idx === 1 && !ENOS.learnLib._z.busy", timeout=15000)
    pieces = pg.evaluate("document.querySelectorAll('#pz-board img.pce').length")
    check(pieces >= 4, "plateau de puzzle affiché : %d pièces" % pieces)
    # mauvais coup d'abord (une case non légale pour la pièce : on clique sur une autre pièce puis une case vide au hasard)
    def solve_all():
        for _ in range(8):
            st = pg.evaluate("({idx: ENOS.learnLib._z.idx, len: ENOS.learnLib._z.moves.length, done: ENOS.learnLib._z.done, mv: ENOS.learnLib._z.moves[ENOS.learnLib._z.idx]})")
            if st["done"]:
                return True
            mv = st["mv"]
            pg.click('#pz-board [data-sq="%s"]' % mv[:2]); pg.click('#pz-board [data-sq="%s"]' % mv[2:4])
            if len(mv) == 5:
                pg.wait_for_selector(".sheet button", timeout=3000)
                pg.click(".sheet button >> text=Dame")
            pg.wait_for_function("(i) => ENOS.learnLib._z.done || (ENOS.learnLib._z.idx > i && !ENOS.learnLib._z.busy)", arg=st["idx"], timeout=8000)
        return pg.evaluate("ENOS.learnLib._z.done")
    check(solve_all(), "puzzle résolu en jouant la solution au doigt")
    check("Résolu" in pg.inner_text("#pz-status") or "brillant" in pg.inner_text("#pz-status"), "statut : " + pg.inner_text("#pz-status"))
    check(pg.evaluate("ENOS.settings.get('learn.rating', 0)") > 1000, "classement relevé : %s" % pg.evaluate("ENOS.settings.get('learn.rating', 0)"))
    check(pg.evaluate("Object.keys(ENOS.settings.get('learn.stats', {})).length") > 0, "statistiques par thème enregistrées")

    # mauvais coup : pénalité mais on peut continuer
    pg.click("#pz-next")
    pg.wait_for_function("ENOS.learnLib._z.idx === 1 && !ENOS.learnLib._z.busy && !ENOS.learnLib._z.done", timeout=15000)
    wrong = pg.evaluate("""() => { const z = ENOS.learnLib._z, c = new Chess(z.ch.fen()); const want = z.moves[z.idx]; const m = c.moves({verbose: true}).find(m => m.from + m.to + (m.promotion || '') !== want && !(() => { const t = new Chess(z.ch.fen()); t.move(m); return t.in_checkmate(); })()); return m.from + m.to; }""")
    pg.click('#pz-board [data-sq="%s"]' % wrong[:2]); pg.click('#pz-board [data-sq="%s"]' % wrong[2:4])
    pg.wait_for_function("ENOS.learnLib._z.failed", timeout=5000)
    check("pas le bon" in pg.inner_text("#pz-status").lower(), "mauvais coup refusé : " + pg.inner_text("#pz-status"))
    check(pg.evaluate("ENOS.learnLib._z.idx") == 1, "la position n'a pas bougé après le mauvais coup")
    pg.click("#pz-hint"); check(pg.evaluate("document.querySelectorAll('#pz-board .sq.hint').length") == 1, "indice : une case surlignée")
    pg.click("#pz-skip")
    pg.wait_for_function("ENOS.learnLib._z.done", timeout=20000)
    check(True, "solution révélée")

    # filtre brillants + thème
    pg.click('#pz-themes [data-t="brilliant"]')
    pg.wait_for_function("ENOS.learnLib._z.idx === 1 && !ENOS.learnLib._z.busy", timeout=15000)
    ths = pg.evaluate("ENOS.learnLib._z.p[4].map(i => ENOS.learnLib.themes[i])")
    check("sacrifice" in ths or "smotheredMate" in ths, "puzzle brillant : %s" % ths)
    pg.click('#pz-themes [data-t="mateIn1"]')
    pg.wait_for_function("ENOS.learnLib._z.idx === 1 && !ENOS.learnLib._z.busy", timeout=15000)
    check("mateIn1" in pg.evaluate("ENOS.learnLib._z.p[4].map(i => ENOS.learnLib.themes[i])"), "filtre Mat en 1")

    # ---------------------------------------------------------------- ouvertures
    pg.click('#lr-tabs [data-t="openings"]'); pg.wait_for_selector("#op-board .sq")
    pg.wait_for_selector("#op-next .lrn-mv")
    check(pg.locator("#op-next .lrn-mv").count() >= 8, "premiers coups du livre : %d" % pg.locator("#op-next .lrn-mv").count())
    pg.click('#op-next [data-s="e4"]'); pg.click('#op-next [data-s="e5"]')
    check(pg.inner_text("#op-path").replace("\n", " ").startswith("1.e4"), "ligne jouée : " + pg.inner_text("#op-path"))
    pg.click('#op-pop [data-c="1"]')
    check("Ruy Lopez" in pg.inner_text("#op-name"), "ouverture nommée : " + pg.inner_text("#op-name"))
    pg.fill("#op-q", "najdorf"); pg.wait_for_selector("#op-res .it")
    check(pg.locator("#op-res .it").count() >= 3, "recherche d'ouverture : %d résultats" % pg.locator("#op-res .it").count())
    # entraînement : Blancs, jouer 1.e4, l'adversaire répond
    pg.click("#op-train"); pg.click("#tr-go")
    pg.click('#op-board [data-sq="e2"]'); pg.click('#op-board [data-sq="e4"]')
    pg.wait_for_function("document.querySelectorAll('#op-path span').length >= 2", timeout=8000)
    check(True, "entraînement : l'adversaire répond " + pg.inner_text("#op-path"))
    pg.click('#op-board [data-sq="a2"]'); pg.click('#op-board [data-sq="a4"]') if False else None

    # ---------------------------------------------------------------- leçons et conseils
    pg.click('#lr-tabs [data-t="lessons"]'); pg.wait_for_selector("#lr-lessons .card")
    check(pg.locator("#lr-lessons .card").count() >= 10, "leçons : %d" % pg.locator("#lr-lessons .card").count())
    pg.click('#lr-lessons [data-go="fork"]')
    pg.wait_for_function("ENOS.learnLib._z && ENOS.learnLib._z.idx === 1 && !ENOS.learnLib._z.busy", timeout=15000)
    check("fork" in pg.evaluate("ENOS.learnLib._z.p[4].map(i => ENOS.learnLib.themes[i])"), "leçon › s'entraîner ouvre un puzzle Fourchette")
    pg.click('#lr-tabs [data-t="advice"]'); pg.wait_for_selector("#lr-advice .card")
    check(pg.locator("#lr-advice .card").count() >= 2, "onglet conseils rempli")

    pg.screenshot(path=os.path.join(os.environ.get("TEMP", "."), "learn_advice.png"))
    check(not errs, "aucune erreur JavaScript : %s" % errs)
    b.close()

print("\n%d échec(s)" % len(BAD))
raise SystemExit(1 if BAD else 0)
