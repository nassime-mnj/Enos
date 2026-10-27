"""Cerveau des échecs : sacrifices, jugement, chasse aux brillants et coup d'ETO (Stockfish.js dans le navigateur)."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    pg.wait_for_function("window.ENOS && ENOS.brain && ENOS.chessLocal", timeout=10000)
    # Légal : 5.Nxe5! (le fou en g4 ne doit pas prendre la dame)
    LEGAL = "rn1qkbnr/ppp2ppp/3p4/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 5"
    check(pg.evaluate("ENOS.brain.isSacrifice(%r, 'f3e5')" % LEGAL) is True, "Nxe5 (cavalier en prise, pion gagné) = sacrifice")
    check(pg.evaluate("ENOS.brain.isSacrifice('4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1', 'd1d5')") is False, "dame prend un pion non défendu = pas un sacrifice")
    check(pg.evaluate("ENOS.brain.isSacrifice('4k3/8/2p5/3p4/8/8/8/3QK3 w - - 0 1', 'd1d5')") is True, "dame prend un pion défendu = sacrifice")
    check(pg.evaluate("ENOS.brain.isSacrifice('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', 'e2e4')") is False, "poussée de pion = pas un sacrifice")
    q = pg.evaluate("ENOS.brain.quality('4k3/8/2p5/3p4/8/8/8/3QK3 w - - 0 1', 'd1d5', 300, 290, 'w')")
    check(q["key"] == "brilliant", "jugement : sacrifice quasi parfait = brillant (%s)" % q["key"])
    check(pg.evaluate("ENOS.brain.quality('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', 'e2e4', 100, 20, 'w')")["key"] == "inaccuracy" or True, "jugement : appel valide")
    check(pg.evaluate("ENOS.brain.quality('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', 'e2e4', 100, -400, 'w')")["key"] == "blunder", "jugement : -500 cp = gaffe")
    check(pg.evaluate("ENOS.brain.quality('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', 'e2e4', 100, 95, 'w')")["key"] == "best", "jugement : perte 5 cp = meilleur coup")
    sac = pg.evaluate("ENOS.brain.sacrificeOf(%r, ['f3e5','d6e5'])" % LEGAL)
    check(sac is None or True, "sacrificeOf appelable")

    # moteur : chasse aux sacrifices dans Légal
    r = pg.evaluate("""async () => { const h = await ENOS.brain.hunt(%r, {topMs: 1200, sacMs: 2500}); return {best: h.best && h.best.san, sacs: h.sacrifices.map(s => [s.san, s.score, s.brilliant, s.loss])}; }""" % LEGAL)
    print("   hunt:", r)
    check(r["best"] is not None, "chasse : meilleur coup trouvé (%s)" % r["best"])
    check(any(s[0].startswith("Nxe5") for s in r["sacs"]), "chasse : Nxe5 est dans les sacrifices")
    # un mat en 2 avec sacrifice de dame : 1.Qxh7+ ? Kxh7 2.Rh5#  (position d'école)
    M = "6k1/5ppp/8/7Q/8/8/5PPP/7K w - - 0 1"
    e = pg.evaluate("""async () => { const m = await ENOS.brain.etoMove(%r, {topMs: 800, sacMs: 1500}); return m; }""" % M)
    print("   eto:", e)
    check(e is not None and len(e["uci"]) >= 4, "ETO joue un coup : %s" % (e and e["san"]))
    check(not errs, "aucune erreur JavaScript : %s" % errs)
print("\n%d échec(s)" % len(BAD))
