"""Chess Edit : sons One Piece sur imprécision / erreur / gaffe, qui coexistent avec les FAHH."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(200000)
    pg.wait_for_function("window.ENOS && ENOS.editMap && !!ENOS.editMap.errSfx && !!window.ENOS_FAHH && !!ENOS_FAHH.op_gaffe")
    r = pg.evaluate("""async () => {
      const E = ENOS.editMap.errSfx, ids = (k, n) => E(k, 1, n, false).map((x) => x.id).filter((i) => i !== 'thud').join(',');
      const out = { imp: [ids('inaccuracy', 4), ids('inaccuracy', 5)], err: [ids('mistake', 4), ids('mistake', 5)], gaffe: [ids('blunder', 4), ids('blunder', 5)], none: ids('good', 3) };
      const P = new ENOS.editSfx.Player(); await P.load(); out.dur = {}; ['fahh', 'fahh_slow', 'op_imp', 'op_err', 'op_gaffe'].forEach((i) => { out.dur[i] = P.bufs[i] ? +P.bufs[i].duration.toFixed(2) : null; }); P.close();
      return out; }""")
    print(r)
    check(r["imp"] == ["op_imp", "op_imp"] and r["none"] == "", "imprécision → One Piece « WTF », rien sur un coup normal")
    check(r["err"] == ["fahh", "op_err"], "erreur : FAHH et One Piece 187 en alternance : %s" % r["err"])
    check(r["gaffe"] == ["fahh_slow", "op_gaffe"], "gaffe : FAHH ralenti et One Piece 210 en alternance : %s" % r["gaffe"])
    check(all(v for v in r["dur"].values()), "les 5 sons sont décodés : %s" % r["dur"])
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
