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
    info = pg.evaluate("""(() => { const r = document.querySelector('#tool-multiedit .suite-body')._api.run.results[0]; return r.clips.map(c => ({ label: c.label, score: Math.round(c.score), frames: c.rp ? c.rp.frames.length : 0, n: c.rp ? c.rp.n : 0, ev: c.rp ? c.rp.events.map(e => e.k).join(',') : '', meta: !!c.meta })); })()""")
    print("moments :", info)
    check(len(info) >= 1 and any("BUT" in c["label"] for c in info), "le but est gardé comme temps fort")
    import base64, subprocess, json
    pl = pg.evaluate("""(() => { const r = document.querySelector('#tool-multiedit .suite-body')._api.run.results; const beats = []; for (let t = 0.25; t < 60; t += 0.469) beats.push(t);
      const p = ENOS.meRender.plan(r, { D: 60, beats, drop: 3, gen: false }); return p.segs.map(s => [s.k, +s.t0.toFixed(2), +s.t1.toFixed(2), s.cam || '', !!s.outro]); })()""")
    print("plan 60 s :", pl)
    check(abs(pl[-1][2] - 60) < 0.01 and pl[-1][4] and sum(1 for s in pl if s[0] == "replay") >= 4, "plan : reprises jusqu'à la fin (60 s), final au ralenti")
    b64 = base64.b64encode(open(SH + "mus26.mp3", "rb").read()).decode()
    out = pg.evaluate("""async (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const file = new File([u], 'mus.mp3', { type: 'audio/mpeg' });
      const r = document.querySelector('#tool-multiedit .suite-body')._api.run.results; const o = await ENOS.meRender.render(r, { music: file, quality: '540' });
      const buf = new Uint8Array(await o.blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); return { b: btoa(s), d: o.duration, beats: o.beats }; }""", b64)
    p = SH + "multiedit_long.mp4"; open(p, "wb").write(base64.b64decode(out["b"])); print("durée", out["d"], "temps", out["beats"])
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", p, "-vf", "fps=2,scale=135:-1,tile=10x6", "-frames:v", "1", SH + "multiedit_long.png"])
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
