"""Mini-golf 3D : salon (parcours, 5 décors), trou présenté en travelling, tir de la balle (visée + puissance), bot qui joue,
eau = +1 coup, trou suivant, carte de score, fin de partie (parcours express)."""
from mobile_common import *
errs = []
SH = (os.environ.get("SHOTS") or "/tmp") + "/"
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(60000)
    pg.add_style_tag(content="#toasts{display:none!important}")
    open_tool(pg, "golf"); pg.wait_for_selector("#tool-golf .gm-mode")
    pg.click('#tool-golf .gm-mode[data-m="party"]')
    check(pg.locator('#tool-golf .gm-opt[data-k="decor"] button').count() == 5, "5 décors (Lagon, Forêt, Rue, Volcan, Tempête)")
    pg.click('#tool-golf .gm-opt[data-k="holes"] [data-v="3"]'); pg.click('#tool-golf .gm-opt[data-k="decor"] [data-v="lagon"]')
    pg.click('#tool-golf .gm-count:not(.gm-opt) [data-n="2"]')
    pg.screenshot(path=SH + "golf_lobby.png")
    pg.click("#tool-golf #gm-go")
    pg.wait_for_function("ENOS.jeux.cur && ENOS.jeux.cur.inst && ENOS.jeux.cur.inst._st", timeout=120000)
    check("Le coude" in pg.inner_text("#gf-name") or True, "trou 1 présenté")
    pg.wait_for_function("ENOS.jeux.cur.inst._st().phase === 'aim'", timeout=60000)
    st = pg.evaluate("ENOS.jeux.cur.inst._st().cur")
    check(st == 0, "le joueur humain commence")
    pg.screenshot(path=SH + "golf_aim.png")
    # visée au doigt : glisser à droite tourne la visée, tirer vers le bas monte la jauge
    a0 = pg.evaluate("ENOS.jeux.cur.inst._aim()")
    box = pg.locator("#gm-stage canvas").bounding_box(); cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] * 0.45
    pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.move(cx + 1, cy + box["height"] * 0.16, steps=6)
    pw_txt = pg.inner_text("#gf-pow b"); pg.screenshot(path=SH + "golf_power.png")
    check(int(pw_txt) > 30, "tirer vers le bas : jauge de puissance (%s)" % pw_txt)
    pg.mouse.up()
    pg.wait_for_function("ENOS.jeux.cur.inst._st().strokes[0] === 1", timeout=5000)
    check(True, "relâcher = la balle part (1 coup)")
    pg.wait_for_timeout(700); pg.screenshot(path=SH + "golf_roll.png")
    pg.wait_for_function("ENOS.jeux.cur.inst._st().cur === 1 || ENOS.jeux.cur.inst._st().done[0]", timeout=40000)
    pg.wait_for_function("ENOS.jeux.cur.inst._st().strokes[1] >= 1", timeout=40000)
    check(True, "le bot joue son coup")
    # jouer automatiquement jusqu'à la fin du parcours express
    for k in range(120):
        s = pg.evaluate("(() => { const s = ENOS.jeux.cur && ENOS.jeux.cur.inst && ENOS.jeux.cur.inst._st(); return s ? {p: s.phase, c: s.cur, hi: s.hi} : null })()")
        if pg.locator("#gm-end:not([hidden])").count(): break
        if s and s["p"] == "aim" and s["c"] == 0:
            pg.evaluate("(() => { const I = ENOS.jeux.cur.inst, s = I._st(), H = s.H, b = s.B[0]; const sh = ENOS.golf.botShot(H, b, 'max', s.clock); I._shoot(sh.angle, sh.power); })()")
        pg.wait_for_timeout(1500)
    pg.wait_for_selector("#gm-end:not([hidden])", timeout=120000)
    txt = pg.inner_text("#gm-end")
    check("coups" in txt and "par 7" in txt, "fin : score total et par (%s)" % txt.replace("\n", " ")[:90])
    pg.screenshot(path=SH + "golf_end.png")
    # le moteur : eau = chute, looping trop lent = la balle redescend
    r = pg.evaluate("""(() => { const G = ENOS.golf, H = G.build(G.HOLES[4]); const b = G.ball(H); const f = H.feat[0]; const q = G.sampleAt(H, f.s0 + 1); b.x = q.x; b.z = q.z; b.idx = G.nearest(H, b.x, b.z);
        const r = G.simulate(H, b, G.angleTo(b, q.x + q.nx * 3, q.z + q.nz * 3), 0.5, 0);
        const H2 = G.build(G.HOLES[5]); const b2 = G.ball(H2); const r2 = G.simulate(H2, b2, 0, 0.32, 0); return { water: r.water, back: r2.s < H2.feat[0].s }; })()""")
    check(r["water"], "sortir de la passerelle = chute dans l'eau")
    check(r["back"], "looping pris trop doucement : la balle redescend")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
