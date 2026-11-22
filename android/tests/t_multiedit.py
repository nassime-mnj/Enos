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
    g = [c for c in info if "BUT" in c["label"]][0]
    check(g["frames"] >= 8 and g["n"] == 11 and "goal" in g["ev"] and "shot" in g["ev"] and g["meta"], "enregistrement de scène : %d images, 10 palets + balle, chocs %s" % (g["frames"], g["ev"]))
    pg.screenshot(path=SH + "multiedit_done.png")
    pl = pg.evaluate("""(() => { const r = document.querySelector('#tool-multiedit .suite-body')._api.run.results; const beats = []; for (let t = 0.25; t < 60; t += 0.469) beats.push(t);
      const p = ENOS.meRender.plan(r, { D: 60, beats, drop: 3, gen: false }); return p.segs.map(s => [s.k, s.t0, s.t1, s.cam || '', !!s.outro]); })()""")
    check(abs(pl[-1][2] - 60) < 0.01 and pl[-1][4] and sum(1 for x in pl if x[0] == "replay") >= 4 and len({x[3] for x in pl if x[0] == "replay"}) >= 3,
          "musique de 60 s : les moments reviennent (caméras jeu / poursuite / orbite) jusqu'à la fin, final au ralenti")
    # rendu hors ligne (petite résolution pour le banc de test : même moteur que le 4K)
    pg.evaluate("ENOS.settings.set('multiedit.quality', '540')")
    pg.click("#tool-multiedit #me-make")
    pg.wait_for_timeout(4000); pg.screenshot(path=SH + "multiedit_render.png")
    check(pg.locator("#tool-multiedit .me-render canvas").count() == 0 and pg.locator("#tool-multiedit .me-bar").count() == 1, "pendant le rendu : barre de progression seulement, aucun aperçu")
    # l'application est tuée pendant le montage (notification, Android qui libère la mémoire…) : rien n'est perdu
    sv = pg.evaluate("ENOS.meStore.get('run').then(r => r && { state: r.state, n: r.results.length, typed: r.results[0].clips[0].rp.frames[0].d instanceof Float32Array, att: r.attempts })")
    check(sv and sv["state"] == "rendering" and sv["n"] == 1 and sv["typed"], "série sauvegardée sur le téléphone pendant le montage : %s" % sv)
    pg.reload(); pg.wait_for_selector("#tabbar")
    pg.wait_for_selector("#tool-multiedit #me-re", timeout=15000)
    check("interrompu" in pg.inner_text("#tool-multiedit").lower(), "après la relance : MultiEdit se rouvre tout seul sur « Montage interrompu »")
    pg.screenshot(path=SH + "multiedit_resume.png")
    pg.wait_for_selector("#tool-multiedit .me-bar", timeout=12000)
    check(True, "le montage repart tout seul (compte à rebours de 5 s)")
    pg.wait_for_selector("#tool-multiedit .me-res video, #tool-multiedit .pl-err", timeout=3000000)
    if pg.locator("#tool-multiedit .pl-err").count(): check(False, "montage : " + pg.inner_text("#tool-multiedit .pl-err")); raise SystemExit(1)
    b64 = pg.evaluate("""(async () => { const b = ENOS.multiEdit.last.blob; const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); return btoa(s); })()""")
    import base64, subprocess, json
    p = SH + "multiedit_out.mp4"; open(p, "wb").write(base64.b64decode(b64))
    pr = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", p], capture_output=True, text=True).stdout or "{}")
    vs = [x for x in pr.get("streams", []) if x["codec_type"] == "video"]; au = [x for x in pr.get("streams", []) if x["codec_type"] == "audio"]
    dur = float(pr.get("format", {}).get("duration", 0)); fps = vs[0]["avg_frame_rate"] if vs else "?"
    check(vs and au and fps in ("60/1", "60000/1001") and dur > 8, "edit : %sx%s, %s i/s, %.1f s, son %s" % (vs[0]["width"] if vs else "?", vs[0]["height"] if vs else "?", fps, dur, au[0]["codec_name"] if au else "aucun"))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", p, "-vf", "fps=3,scale=135:-1,tile=10x5", "-frames:v", "1", SH + "multiedit_frames.png"])
    pg.screenshot(path=SH + "multiedit_result.png")
    ed = pg.evaluate("Promise.all([ENOS.meStore.get('run'), ENOS.meStore.get('edits')]).then(([r, e]) => ({ state: r && r.state, n: e ? e.length : 0, size: e && e[0] ? e[0].blob.size : 0 }))")
    check(ed["state"] == "done" and ed["n"] == 1 and ed["size"] > 100000, "edit terminé gardé dans « Mes edits » (%d Ko)" % (ed["size"] // 1000))
    pg.reload(); pg.wait_for_selector("#tabbar"); pg.wait_for_timeout(2600)
    open_tool(pg, "multiedit"); pg.wait_for_selector("#tool-multiedit .me-edits", timeout=8000)
    check(pg.locator("#tool-multiedit .me-resume").count() == 0, "série montée : plus de bandeau « reprendre », l'edit est dans « Mes edits »")
    pg.click("#tool-multiedit .me-edits [data-ed='0']"); pg.wait_for_selector("#tool-multiedit .me-res video", timeout=8000)
    check(True, "« Mes edits » : la vidéo se rouvre après relance")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
