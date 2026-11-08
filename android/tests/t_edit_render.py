"""Chess Edit : moteur canvas déterministe (caméra sans coupure, intro 3,8 s, badges, overlays exclusifs) + export MP4 image par image."""
import base64, os
from mobile_common import *

OUT = os.environ.get("RENDER_OUT", "/tmp/claude-0/scr/frames")
os.makedirs(OUT, exist_ok=True)
errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    ev = pg.evaluate
    ev("""async () => { window.__rec = await (async () => { const P = ENOS.prime, st = P.newState(true, false); let n = 0;
      while (!st.over && n < 80) { const ch = new Chess(st.fen);
        if (ch.turn() === 'w') { const r = await P.turn(st, {}); r.acts.forEach((a) => { if (a.say) a.say = a.say; st.acts.push(a); }); if (r.over) break; }
        else { const ms = ch.moves({ verbose: true }); if (!ms.length) break; const m = ms[Math.floor(Math.random() * ms.length)]; ch.move(m); st.acts.push({ k: 'mv', side: 'b', seat: 1, key: 'good', ev: null, from: m.from, to: m.to, piece: m.piece, cap: m.captured || '', promo: '', uci: m.from + m.to, san: m.san, fen: ch.fen(), cheat: '' }); st.fen = ch.fen(); }
        n++; }
      const acts = st.acts; return { variant: true, mode: 'prime', t: Date.now(), title: 't', result: 'ChatGPT Prime gagne · par checkmate', plies: acts.length, pw: 'ChatGPT Prime', pb: 'Toi', me: 'b', ch: [], mv: acts.map((a) => [a.uci, a.san, 'good', 0, null, '']), v: { mode: 'prime', acts, start: P.START, over: 'kill' } }; })(); }""")
    tl = ev("""() => { const M = ENOS.editMap, pl = M.gamePlies(window.__rec); window.__tl = M.buildViral(pl, window.__rec, null, { voices: true, intro: true, synth: true, syncDrop: false });
      const t = window.__tl, mv = t.events.filter((e) => e.from || e.drop), intro = t.events.find((e) => e.kind === 'intro'); const imp = mv.filter((e) => e.kind !== 'ff').map((e) => e.impact);
      let maxGapPre = 0; const D = t.stats.drop; imp.filter((x) => x < D - 0.1).forEach((v, i, a) => { if (i) maxGapPre = Math.max(maxGapPre, v - a[i - 1]); });
      return { sync: t.sync, introDur: intro && intro.dur, first: Math.min(...imp), maxGapPre, drop: D, dur: t.duration, n: mv.length, keys: [...new Set(mv.map((e) => e.badge ? e.badge.img : 'none'))], ai: mv.filter((e) => e.aiImg).length, ev: t.events.length }; }""")
    print(tl)
    check(tl["sync"] and tl["introDur"] == 3.8, "intro VS verrouillée à 3,8 s")
    check(3.8 <= tl["first"] <= 3.95, "le 1er coup claque à la fin de l'intro (%.2f s)" % tl["first"])
    check(tl["maxGapPre"] <= 1.65, "intro calme : un coup toutes les 1,1–1,6 s (écart max %.2f)" % tl["maxGapPre"])
    law = ev("""() => { const t = window.__tl, mv = t.events.filter((e) => (e.from || e.drop) && e.kind !== 'ff'), D = t.stats.drop, pre = mv.filter((e) => e.impact < D - 0.01), post = mv.filter((e) => e.impact >= D - 0.01), gaps = (a) => a.slice(1).map((e, i) => e.impact - a[i].impact);
      const arrows = mv.filter((e) => e.arrow).length, softBad = pre.filter((e) => e.redPath || e.arrow || e.strobe || e.boss || e.glasses).length, drop = mv.find((e) => e.kind === 'drop');
      return { pre: pre.length, post: post.length, gapPre: [Math.min(...gaps(pre)), Math.max(...gaps(pre))], gapPost: [Math.min(...gaps(post)), Math.max(...gaps(post))], arrows, softBad, dropAt: drop && drop.impact, D, preDur: [...new Set(pre.map((e) => e.dur))], postDur: [...new Set(post.map((e) => e.dur))], endGap: t.duration - mv[mv.length - 1].impact, n: mv.length }; }""")
    print(law)
    check(4 <= law["pre"] <= 8 and law["gapPre"][0] >= 1.05 and law["gapPre"][1] <= 1.65, "phase 1 : %d coups lents entre l'intro et le drop, espacés de %.2f à %.2f s" % (law["pre"], law["gapPre"][0], law["gapPre"][1]))
    check(law["preDur"] == [240] and law["softBad"] == 0, "intro : glissement doux de 240 ms, aucun chemin rouge / flèche / flash / strobe")
    check(law["post"] >= 11 and law["post"] <= 22 and law["gapPost"][0] >= 0.64 and law["gapPost"][1] <= 1.85, "phase 2 : %d coups intenses après le drop, sur les vrais temps forts (%.2f–%.2f s ; 1,6–1,8 s après un coup brillant)" % (law["post"], law["gapPost"][0], law["gapPost"][1]))
    check(abs(law["dropAt"] - law["D"]) < 1e-6 and law["arrows"] <= 1, "le 1er tournant tombe sur le drop ; %d flèche jaune au maximum dans toute la vidéo" % law["arrows"])
    check(len([k for k in tl["keys"] if k not in ("none", "good")]) >= 1, "palette de badges variée : %s" % tl["keys"])
    r = ev("""async () => { const cv = document.createElement('canvas'); cv.width = 360; cv.height = 640; const R = new ENOS.editRender.Renderer(cv, window.__tl, { flip: true, rec: window.__rec }); await R.load(); window.__R = R;
      const t = window.__tl, drop = t.stats.drop, imp = t.events.filter((e) => e.from && e.kind !== 'ff'), ck = imp.find((e) => e.check) || imp[5], twT = t.events.find((e) => e.kind === 'outro').t;
      const pre2 = t.events.filter((e) => e.from && e.soft)[2], rp = imp.find((e) => e.redPath) || imp[8], times = { soft: pre2 ? pre2.impact - 0.12 : 6, redpath: rp.impact + 0.25, intro1: 0.4, intro2: 2.2, intro3: 3.4, first: 3.86, preDrop: drop - 0.3, prompt: drop - 0.3, drop: drop + 0.03, afterDrop: drop + 0.6, check: ck ? ck.impact + 0.25 : 5, end: twT + 1.6 };
      const out = {}; let blank = 0; for (const [k, v] of Object.entries(times)) { R.draw(v); const d = cv.toDataURL('image/png'); out[k] = d; const g = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let s = 0; for (let i = 0; i < g.length; i += 97) s += g[i]; if (s < 2000) blank++; }
      return { frames: out, blank, times }; }""")
    for k, d in r["frames"].items():
        open(os.path.join(OUT, k + ".png"), "wb").write(base64.b64decode(d.split(",")[1]))
    check(r["blank"] == 0, "toutes les images clés se dessinent (aucune image vide) : %s" % list(r["times"].items())[:4])
    # --- coupure d'écran : la caméra clampée ne laisse jamais de vide noir sur les bords
    cut = ev("""() => { const R = window.__R, t = window.__tl, imp = t.events.filter((e) => e.from && e.kind !== 'ff'), out = []; for (const e of imp.slice(0, 40)) { const c = R.camAt(e.impact + 0.3); const maxO = (R.BS / 2) * (1 - 1 / Math.max(1, c.S)); out.push([c.S, c.th, Math.abs(c.x) <= R.BS, maxO >= 0]); } return { n: out.length, minS: Math.min(...out.map((x) => x[0])), maxS: Math.max(...out.map((x) => x[0])), maxTh: Math.max(...out.map((x) => Math.abs(x[1]))) * 180 / Math.PI }; }""")
    check(1.0 <= cut["minS"] and cut["maxS"] <= 1.6 + 1e-6 and cut["maxTh"] <= 15.5, "caméra : zoom ×%.2f–×%.2f (jamais > 1,60 : départ ET arrivée visibles), inclinaison ≤ %.1f°" % (cut["minS"], cut["maxS"], cut["maxTh"]))
    st = ev("""() => { const R = window.__R, S = ENOS.editRender.IMGSTAT; let tainted = false; try { R.ctx.getImageData(0, 0, 4, 4); R.scene.getContext('2d').getImageData(0, 0, 4, 4); } catch (e) { tainted = true; } return { net: S.net, data: S.data, tainted }; }""")
    check(st["net"] == 0 and st["data"] > 20 and not st["tainted"], "images en data: URI : canvas jamais « tainted » dans le WebView (VideoFrame OK) : %s" % st)
    # --- export MP4 image par image (60 FPS fixes) : WebCodecs + mp4-muxer
    sup = ev("ENOS.editExport.supported()")
    print("supported:", sup)
    ex = ev("""async () => { const t = window.__tl, prog = []; const r = await ENOS.editExport.render(t, { width: 270, height: 480, fps: 60, rec: window.__rec, flip: true, onProgress: (k, m) => prog.push(m) });
      const url = URL.createObjectURL(r.blob), v = document.createElement('video'); v.muted = true; v.src = url; await new Promise((ok) => { v.onloadedmetadata = ok; v.onerror = ok; });
      return { size: r.blob.size, mime: r.mime, via: r.via, frames: r.frames, w: v.videoWidth, h: v.videoHeight, dur: v.duration, expect: t.duration, msg: prog.filter((m) => /%/.test(m)).slice(-1)[0] }; }""")
    print(ex)
    check(ex["size"] > 20000 and ex["mime"] == "video/mp4", "MP4 généré en mémoire : %.1f Mo, %s" % (ex["size"] / 1048576, ex["via"]))
    check(ex["w"] == 270 and ex["h"] == 480 and abs(ex["dur"] - ex["expect"]) < 0.6, "lisible dans <video> : %dx%d, %.1f s (timeline %.1f s)" % (ex["w"], ex["h"], ex["dur"], ex["expect"]))
    check(ex["frames"] == int(-(-ex["expect"] * 60 // 1)), "60 FPS fixes : %d images" % ex["frames"])
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
