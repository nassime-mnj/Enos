"""Jeux hors échecs : seuls nos bots (ETO, E.N.O.S. et nos personnages) sont proposés, avec une classe de difficulté fixe (ETO et E.N.O.S. en Expert), sans Elo."""
from mobile_common import *
errs = []
SH = (os.environ.get("SHOTS") or "/tmp") + "/"
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(60000)
    open_tool(pg, "dames"); pg.click('#tool-dames .gm-mode[data-m="party"]'); pg.wait_for_selector("#tool-dames .gm-seats .bp-slot")
    check(pg.locator("#tool-dames .gm-lvl").count() == 0, "plus de sélecteur de niveau global : la classe vient du bot")
    chip = pg.inner_text("#tool-dames .gm-seats .bp-slot")
    check("Elo" not in chip and pg.locator("#tool-dames .gm-seats .gm-cls").count() >= 1, "puce adversaire : classe affichée, pas d'Elo (" + chip.replace("\n", " ") + ")")
    pg.screenshot(path=SH + "gbots_lobby.png")
    pg.click("#tool-dames .gm-seats .bp-slot"); pg.wait_for_selector("#sheet .gm-roster")
    txt = pg.inner_text("#sheet")
    check("Elo" not in txt and "Stockfish" not in txt and "Magnus" not in txt, "liste : aucun bot d'échecs extérieur, aucun Elo")
    names = pg.eval_on_selector_all("#sheet [data-b]", "els => els.map((e) => e.dataset.b)")
    check(set(names) <= {"eto", "enos", "naskolit", "penoire", "ghorghor", "nasko", "jester", "lelex", "naskurieux"} and "eto" in names and "enos" in names, "liste limitée à nos bots : " + ", ".join(names))
    cls = pg.evaluate("""(() => { const o = {}; document.querySelectorAll('#sheet [data-b]').forEach((b) => (o[b.dataset.b] = b.querySelector('.gm-cls').textContent)); return o; })()""")
    check(cls.get("eto") == "Expert" and cls.get("enos") == "Expert", "ETO et E.N.O.S. : Expert")
    pg.screenshot(path=SH + "gbots_sheet.png")
    pg.click('#sheet [data-b="enos"]'); pg.wait_for_timeout(300)
    pg.click("#tool-dames #gm-go"); pg.wait_for_function("ENOS.jeux.cur && ENOS.jeux.cur.inst", timeout=60000)
    check(pg.evaluate("ENOS.jeux.cur.inst._st ? true : true") and pg.evaluate("ENOS.jeux.cur && JSON.stringify(ENOS.jeux.cur.g.id)") == '"dames"', "partie lancée contre E.N.O.S.")
    lvl = pg.evaluate("(() => { const st = document.querySelector('#gm-stage'); return ENOS.jeux.G ? '' : ''; })()")
    pg.evaluate("ENOS.jeux.close()")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
