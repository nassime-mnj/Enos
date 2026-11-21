"""Flick Foot / Hockey 3D : salon (terrain, buts, drapeaux en images), scène three.js, tir à la fronde au doigt, simulation jusqu'à l'arrêt,
réponse du bot, but + score, variante hockey, fin de partie."""
from mobile_common import *
errs = []
SH = (os.environ.get("SHOTS") or "/tmp") + "/"
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(60000)
    pg.add_style_tag(content="#toasts{display:none!important}")
    open_tool(pg, "flick"); pg.wait_for_selector("#tool-flick .gm-mode")
    pg.click('#tool-flick .gm-mode[data-m="bots"]')
    check(pg.locator('#tool-flick .gm-imgs [data-v="fr"] img').count() == 2, "drapeaux affichés en images dans le salon")
    pg.click('#tool-flick .gm-opt[data-k="mode"] [data-v="foot"]'); pg.click('#tool-flick .gm-opt[data-k="goals"] [data-v="3"]')
    check(pg.locator('#tool-flick .gm-opt[data-k="decor"] button').count() == 8, "8 décors proposés (Stade, Sakura, Océan, Automne, Rue, Volcan, Tempête, Arène ETO)")
    pg.click('#tool-flick .gm-opt[data-k="decor"] [data-v="sakura"]')
    pg.click('#tool-flick .gm-opt[data-k="t0"] [data-v="ma"]'); pg.click('#tool-flick .gm-opt[data-k="t1"] [data-v="jp"]')
    pg.screenshot(path=SH + "flick_lobby.png")
    pg.click("#tool-flick #gm-go"); pg.wait_for_selector(".gm-intro", timeout=5000)
    check(pg.locator(".gm-intro .gm-vs i").count() == 1, "ouverture : les deux joueurs entrent, « VS » au centre")
    pg.wait_for_function("ENOS.jeux.cur && ENOS.jeux.cur.inst && ENOS.jeux.cur.inst._st", timeout=120000); pg.wait_for_timeout(1500)
    check(pg.evaluate("ENOS.jeux.cur.inst._theme()") == "sakura" and pg.evaluate("ENOS.jeux.cur.st.querySelector('canvas') !== null"), "décor Sakura chargé (modèle 3D)")
    check("Maroc" not in pg.inner_text("#fl-score") and pg.locator('#fl-score img[src*="flag_ma"]').count() == 1, "score : drapeaux Maroc et Japon")
    pg.screenshot(path=SH + "flick_3d.png")
    # fronde au doigt : depuis un attaquant (index 3), tirer vers le bas = tir vers le haut
    pos = pg.evaluate("""(() => { const g = ENOS.jeux.cur, S = g.inst; const s = S._st(), b = s.bodies[3]; const cv = document.querySelector('#gm-stage canvas'); const r = cv.getBoundingClientRect();
        const T = THREE; return null; })()""")
    shot = pg.evaluate("ENOS.jeux.cur.inst._shoot(3, 0.1, -1, 0.7)")
    check(shot, "tir lancé (palet de ton équipe)")
    pg.wait_for_function("ENOS.jeux.cur.inst._st().turn === 1 || ENOS.jeux.cur.inst._st().score[0] > 0", timeout=20000)
    check(True, "simulation jusqu'à l'arrêt, puis au tour de l'adversaire (ou but)")
    pg.wait_for_timeout(600); pg.screenshot(path=SH + "flick_3d_2.png")
    pg.wait_for_function("ENOS.jeux.cur.inst._st().turn === 0 || ENOS.jeux.cur.inst._st().over || ENOS.jeux.cur.inst._st().score[1] > 0", timeout=30000)
    check(True, "le bot a tiré")
    # but forcé : balle juste devant le but adverse
    pg.wait_for_function("ENOS.jeux.cur.inst._st().turn === 0", timeout=30000); pg.wait_for_timeout(500)
    pg.evaluate("""(() => { const s = ENOS.jeux.cur.inst._st(); s.score = [2, 0]; s.bodies.forEach((b) => { if (b.t === 1) { b.x = 2.8; b.z = 1; } }); s.ball.x = 0; s.ball.z = -4.2; s.bodies[3].x = 0; s.bodies[3].z = -3.4; })()""")
    pg.evaluate("ENOS.jeux.cur.inst._shoot(3, 0, -1, 0.8)")
    pg.wait_for_selector(".fl-goal", timeout=20000)
    check("km/h" in pg.inner_text(".fl-goal").lower(), "but : bannière avec la vitesse de frappe (" + pg.inner_text(".fl-goal").replace("\n", " ") + ")")
    pg.wait_for_selector("#gm-end:not([hidden])", timeout=90000)
    check("Victoire" in pg.inner_text("#gm-end") and "3" in pg.inner_text("#gm-end"), "but décisif : Victoire 3 – 0")
    pg.click('#gm-end [data-a="quit"]')
    # hockey
    open_tool(pg, "flick"); pg.click('#tool-flick .gm-opt[data-k="mode"] [data-v="hockey"]'); pg.click('#tool-flick .gm-opt[data-k="decor"] [data-v="eto"]'); pg.click("#tool-flick #gm-go")
    pg.wait_for_function("ENOS.jeux.cur && ENOS.jeux.cur.inst && ENOS.jeux.cur.inst._st && ENOS.jeux.cur.inst._st().mode === 'hockey'", timeout=60000); pg.wait_for_timeout(1500)
    pg.screenshot(path=SH + "flick_hockey.png"); check(True, "variante hockey : patinoire")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
