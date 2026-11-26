"""Thème E.N.O.S. : HUD rouge + thème musical dès qu'E.N.O.S. est l'adversaire, regard qui passe de pièce en pièce, vue « Voir ce que pense E.N.O.S. »
(six lignes jouées en ×4, compteur de positions en millions, suite retenue, moteur jamais nommé) ; tout s'arrête en quittant la partie."""
from mobile_common import *
errs = []
SH = (os.environ.get("SHOTS") or "/tmp") + "/"
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs)
    pg.evaluate("""(() => { window.__aud = []; const A0 = window.Audio; window.Audio = function (src) { window.__aud.push(String(src)); const a = new A0(src); a.play = () => Promise.resolve(); return a; }; })()""")
    open_tool(pg, "defis"); A = "document.querySelector('#tool-defis .suite-body')._api"
    pg.evaluate(A + ".launch('enos', {color: 'w', pow: 100})"); pg.wait_for_timeout(2500)
    check(pg.evaluate("document.documentElement.classList.contains('enostheme')"), "thème E.N.O.S. actif")
    check(any("audio/enos/ost.mp3" in x for x in pg.evaluate("window.__aud")), "son thème musical se lance")
    ok = pg.evaluate("""() => new Promise((res) => { const a = document.createElement('audio'); a.oncanplaythrough = () => res(a.duration); a.onerror = () => res(-1); a.src = 'audio/enos/ost.mp3'; a.load(); setTimeout(() => res(-2), 6000); })""")
    check(ok > 60, "fichier du thème lisible (%.0f s)" % ok)
    g = [pg.evaluate("(() => { const c = document.querySelector(\"#df-botchat canvas.bot-anim[data-bot='enos']\"); return c && c._gaze ? 1 : 0; })()") for _ in range(10) if not pg.wait_for_timeout(300)]
    check(sum(g) >= 4, "son regard se pose sur les pièces (%d/10)" % sum(g))
    pg.screenshot(path=SH + "enos_theme.png")
    pg.wait_for_function("!document.querySelector('#tool-defis .suite-body')._api.g.busy", timeout=30000)
    check(pg.locator("#b-mind").count() == 1, "bouton « Voir ce que pense E.N.O.S. »")
    pg.click("#b-mind"); pg.wait_for_timeout(5000)
    n = int(pg.inner_text("#em-n").replace(" ", "").replace(" ", "").replace(" ", "") or 0)
    check(n > 1000000, "positions évaluées : %s" % pg.inner_text("#em-n"))
    check(len(pg.inner_text("#em-best")) > 8 and pg.locator("#em-flow p").count() > 10, "suite retenue + flux de combinaisons (« %s »)" % pg.inner_text("#em-best"))
    check("stockfish" not in pg.inner_text(".em-ov").lower(), "le moteur n'est jamais nommé")
    pg.screenshot(path=SH + "enos_mind.png")
    pg.click(".em-x"); pg.wait_for_timeout(400)
    # Raph : quand E.N.O.S. prend sa place, le thème et la musique d'E.N.O.S. arrivent aussi
    pg.evaluate(A + ".launch('raph', {color: 'w'})"); pg.wait_for_timeout(1500)
    check(not pg.evaluate("document.documentElement.classList.contains('enostheme')"), "contre Raph : thème normal")
    pg.evaluate("(() => { " + A + ".g.evalW = 520; " + A + ".raphCheck('b'); })()")
    pg.wait_for_function("document.documentElement.classList.contains('enostheme')", timeout=20000)
    check(pg.locator("#b-mind").count() == 1, "Raph devenu E.N.O.S. : thème, musique et bouton de sa pensée")
    pg.click("#df-back"); pg.wait_for_timeout(500)
    check(not pg.evaluate("document.documentElement.classList.contains('enostheme')") and not pg.evaluate("!!ENOS._fish"), "en quittant : thème et musique coupés")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
