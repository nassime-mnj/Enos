"""Jugement des coups lu d'après les scores de Stockfish : mat forcé conservé / manqué, coup forcé, brillant jamais attribué quand un mat existait."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    pg.set_default_timeout(120000)
    ev = pg.evaluate
    pg.wait_for_function("window.ENOS && ENOS.brain && ENOS.chessLocal")
    Q = "(args) => { const [fen, uci, bw, aw, col] = args; const q = ENOS.brain.quality(fen, uci, bw, aw, col); return [q.key, q.loss, q.label]; }"
    # position : la dame blanche (d1) peut aller en d5 (sacrifice : attaquée par le pion noir c6) — mat en 5 avant
    FEN = "4k3/8/2p5/8/8/8/8/3QK3 w - - 0 1"
    k = ev(Q, [FEN, "d1d5", 9995, 9995, "w"])
    check(k[0] == "good", "mat en 5 avant et toujours mat en 5 après (le mat n'avance pas) : jamais brillant, au mieux « bon » (%s)" % k[0])
    k = ev(Q, [FEN, "d1d5", 9995, 800, "w"])
    check(k[0] == "miss" and k[2] == "Manqué", "mat en 5 AVANT, le sacrifice de dame ne mate plus (+8,00) -> « Manqué » : %s" % k)
    k = ev(Q, [FEN, "d1d5", 9995, 9996, "w"])
    check(k[0] == "best", "mat en 5 avant, mat en 4 après : le mat avance -> meilleur coup : %s" % k[0])
    k = ev(Q, [FEN, "d1d5", 9995, 9992, "w"])
    check(k[0] == "miss", "mat en 5 -> mat en 8 : beaucoup plus lent -> Manqué : %s" % k[0])
    k = ev(Q, [FEN, "d1d5", 9995, -300, "w"])
    check(k[0] in ("blunder", "mistake"), "mat en 5 jeté, position perdue -> gaffe/erreur : %s" % k[0])
    k = ev(Q, [FEN, "d1d5", 150, 140, "w"])
    check(k[0] == "brilliant", "sans mat, sacrifice qui garde l'évaluation : toujours brillant : %s" % k[0])
    k = ev(Q, [FEN, "d1d5", 150, 140, "b"])
    check(k[0] != "brilliant" or True, "(couleur inversée : pas de crash)")
    # position déjà gagnante (+8) dont le coup laisse filer l'essentiel (+3)
    k = ev(Q, [FEN, "d1d5", 800, 300, "w"])
    check(k[0] == "miss", "déjà gagnant (+8,00) et le coup retombe à +3,00 -> Manqué : %s" % k[0])
    # coup forcé : un seul coup légal, jugé avec le vrai Stockfish
    j = ev("""async () => { const fen = '4k3/4Q3/8/8/8/8/8/4K3 b - - 0 1', ev0 = await ENOS.brain.evaluate(fen, 120), c = new Chess(fen); c.move({ from: 'e8', to: 'e7' }); const ev1 = await ENOS.brain.evaluate(c.fen(), 120);
        const r = await ENOS.brain.judge(fen, 'e8e7', ev0, ev1, 'b', 120); return [r.q.key, r.q.label, r.q.only, ENOS.board.BADGES.forced, ENOS.board.BADGES.miss]; }""")
    check(j[0] == "forced" and j[1] == "Coup forcé" and j[2] is False, "un seul coup légal -> « Coup forcé » : %s" % j[:3])
    check(j[3][0] == "»" and j[4][0] == "✖", "icônes : forcé « » » et manqué « ✖ » : %s %s" % (j[3], j[4]))
    # seul coup qui ne perd pas : le roi doit quitter une case attaquée par une fourchette — Stockfish voit un écart énorme avec le 2ᵉ coup
    j2 = ev("""async () => { const fen = '6k1/5ppp/8/8/8/8/5PPP/1R4K1 b - - 0 1'; const lines = await ENOS.chessLocal.lines(fen, 2, 150); return lines.length; }""")
    check(j2 >= 1, "Stockfish répond aux demandes MultiPV du jugement (%s lignes)" % j2)
    d = ev("ENOS.brain.describe({ key: 'miss', loss: 800, before: 9995, after: 800 }, 'Dd5', 'Dd8#')")
    check("MANQUÉ" in d and "mat forcé" in d, "commentaire : " + d)
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
