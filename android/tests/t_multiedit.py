"""MultiEdit (catégorie Clip Edit) : constructeur de série, partie de foot filmée (temps forts), écran « Voir l'edit »,
montage (intro, carte du jeu, moment au ralenti, récap) enregistré en vidéo lisible."""
from mobile_common import *
errs = []
SH = (os.environ.get("SHOTS") or "/tmp") + "/"
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(60000)
    pg.add_style_tag(content="#toasts{display:none!important}")
    pg.evaluate("ENOS.ui.go('tools')"); pg.wait_for_selector('.hub-cat[data-c="clipedit"]')
    check(pg.locator('.hub-cat[data-c="clipedit"]').count() == 1, "hub : catégorie Clip Edit")
    pg.click('.hub-cat[data-c="clipedit"]'); pg.wait_for_timeout(800)
    txt = pg.inner_text("#hub-page") if pg.locator("#hub-page").count() else ""
    check("Chess Edit" in txt and "MultiEdit" in txt, "Clip Edit : Chess Edit (sous-catégorie) + MultiEdit")
    open_tool(pg, "multiedit"); pg.wait_for_selector("#tool-multiedit .me-step")
    check(pg.locator("#tool-multiedit .me-step").count() == 4, "série par défaut : 4 jeux (Foot, Néo-Cité, Échecs, Mini-golf)")
    pg.screenshot(path=SH + "multiedit_builder.png")
    # série courte : un match de foot contre ETO
    pg.evaluate("document.querySelector('#tool-multiedit .suite-body')._api.steps = [{ g: 'flick', bots: ['eto'], decor: 'eto' }]")
    pg.click("#tool-multiedit #me-go"); pg.wait_for_selector("#tool-multiedit #me-play"); pg.click("#tool-multiedit #me-play")
    pg.wait_for_function("ENOS.jeux.cur && ENOS.jeux.cur.inst && ENOS.jeux.cur.inst._st", timeout=120000); pg.wait_for_timeout(1500)
    check(pg.evaluate("ENOS.hl.active"), "partie filmée (temps forts actifs)")
    pg.wait_for_function("ENOS.jeux.cur.inst._st().turn === 0", timeout=30000)
    pg.evaluate("""(() => { const s = ENOS.jeux.cur.inst._st(); s.score = [2, 0]; s.bodies.forEach((b) => { if (b.t === 1) { b.x = 2.8; b.z = 1; } }); s.ball.x = 0; s.ball.z = -4.2; s.bodies[3].x = 0; s.bodies[3].z = -3.4; })()""")
    pg.evaluate("ENOS.jeux.cur.inst._shoot(3, 0, -1, 0.8)")
    pg.wait_for_selector("#gm-end:not([hidden]) [data-a='next']", timeout=90000)
    pg.wait_for_timeout(500)
    check("Voir l'edit" in pg.inner_text("#gm-end"), "fin du match : bouton « Voir l'edit » (série)")
    pg.click("#gm-end [data-a='next']")
    pg.wait_for_selector("#tool-multiedit .me-done", timeout=20000)
    n = pg.evaluate("document.querySelector('#tool-multiedit .suite-body')._api.run.results[0].clips.length")
    check(n >= 1, "moments filmés gardés : %d" % n)
    lbl = pg.evaluate("document.querySelector('#tool-multiedit .suite-body')._api.run.results[0].clips.map(c => c.label + ' (' + Math.round(c.score) + ')').join(', ')")
    check("BUT" in lbl, "le but est noté comme temps fort : " + lbl)
    pg.screenshot(path=SH + "multiedit_done.png")
    pg.click("#tool-multiedit #me-make")
    pg.wait_for_timeout(6000); pg.screenshot(path=SH + "multiedit_render.png")
    pg.wait_for_selector("#tool-multiedit .me-res video", timeout=300000)
    info = pg.evaluate("""new Promise((res) => { const v = document.querySelector('#tool-multiedit .me-res video'); const go = () => res({ w: v.videoWidth, h: v.videoHeight, txt: document.querySelector('#tool-multiedit .me-res p').textContent });
        if (v.readyState >= 1) go(); else v.onloadedmetadata = go; setTimeout(go, 8000); })""")
    check(info["w"] == 720 and info["h"] == 1280, "edit vertical 720×1280 lisible (%s)" % info)
    pg.screenshot(path=SH + "multiedit_result.png")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
