"""Loup-garou : salon (5 à 10 joueurs), carte de rôle qui se retourne, nuit (actions selon le rôle), aube et morts révélés,
débat (les bots parlent et accusent), vote, fin de partie ; mode local avec écran de passage."""
from mobile_common import *
errs = []
SH = (os.environ.get("SHOTS") or "/tmp") + "/"

def drive(pg, maxit=500, shots=None):
    talked = False
    for k in range(maxit):
        if pg.locator("#gm-end:not([hidden])").count(): return True
        if pg.locator("#lg-fx:not([hidden]) #lg-ok").count():
            if shots is not None and "card" not in shots: pg.wait_for_timeout(900); pg.screenshot(path=SH + "loup_card.png"); shots.add("card")
            pg.click("#lg-fx #lg-ok"); continue
        if pg.locator('#lg-act [data-a="vote"]').count():
            if shots is not None and "day" not in shots: pg.screenshot(path=SH + "loup_day.png"); shots.add("day")
            if not talked:
                talked = True; pg.click('#lg-act [data-a="vil"]'); pg.wait_for_timeout(300); continue
            pg.click('#lg-act [data-a="vote"]'); continue
        if pg.locator("#lg-act #lg-val").count():
            can = pg.locator(".lg-p.can")
            if can.count():
                if shots is not None and "pick" not in shots: pg.screenshot(path=SH + "loup_pick.png"); shots.add("pick")
                can.first.click(); pg.click("#lg-act #lg-val"); continue
            elif pg.locator("#lg-act #lg-skip").count(): pg.click("#lg-act #lg-skip"); continue
        if pg.locator("#lg-act .lg-opts [data-k]").count(): pg.locator("#lg-act .lg-opts [data-k]").first.click(); continue
        if pg.locator("#lg-act #lg-go").count(): pg.click("#lg-act #lg-go"); continue
        pg.wait_for_timeout(250)
    return False

with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(30000)
    pg.add_style_tag(content="#toasts{display:none!important}")
    open_tool(pg, "loup"); pg.wait_for_selector("#tool-loup .gm-mode")
    pg.click('#tool-loup .gm-mode[data-m="bots"]')
    check(pg.locator('#tool-loup .gm-count:not(.gm-opt) button').count() == 6, "5 à 10 joueurs")
    pg.click('#tool-loup .gm-count:not(.gm-opt) [data-n="7"]')
    pg.click("#tool-loup #gm-go")
    pg.wait_for_selector(".lg-flip.on", timeout=20000); pg.wait_for_timeout(1000)
    role = pg.inner_text(".lg-front b"); check(role in ["Loup-garou", "Voyante", "Sorcière", "Chasseur", "Villageois"], "carte de rôle retournée : " + role)
    pg.screenshot(path=SH + "loup_role.png")
    check(pg.locator(".lg-p").count() == 7, "7 joueurs autour du feu")
    pg.evaluate("ENOS.jeux.cur.inst._fast()")
    shots = set()
    ok = drive(pg, 900, shots)
    check(ok, "partie menée jusqu'au bout")
    check(pg.locator(".lg-msg").count() >= 3, "les bots ont parlé pendant le débat (%d messages)" % pg.locator(".lg-msg").count())
    txt = pg.inner_text("#gm-end"); check("Rôles" in txt and ("village gagne" in txt or "loups gagnent" in txt), "fin : camp gagnant et rôles révélés")
    st = pg.evaluate("(() => { const s = ENOS.jeux.cur.inst._st(); return { w: ENOS.loup.winner(s), alive: s.ps.filter(p => p.alive).length, wolves: s.ps.filter(p => p.role === 'wolf').length }; })()")
    check(st["w"] in ["village", "wolf"] and st["wolves"] == 2, "7 joueurs = 2 loups, victoire cohérente (%s)" % st["w"])
    pg.screenshot(path=SH + "loup_end.png")
    pg.click('#gm-end [data-a="quit"]')
    # mode local : écran de passage
    open_tool(pg, "loup"); pg.click('#tool-loup .gm-mode[data-m="local"]'); pg.click('#tool-loup .gm-count:not(.gm-opt) [data-n="5"]'); pg.click("#tool-loup #gm-go")
    pg.wait_for_selector(".lg-pass", timeout=20000)
    check("passe le téléphone" in pg.inner_text(".lg-pass").lower(), "local : écran de passage avant chaque carte")
    pg.screenshot(path=SH + "loup_pass.png")
    pg.evaluate("ENOS.jeux.cur.inst._fast()")
    check(drive(pg, 900), "local : partie complète")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
