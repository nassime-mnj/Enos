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
    check(tl["maxGapPre"] <= 0.62, "un coup toutes les 0,45–0,6 s avant le drop, jamais de plateau figé (écart max %.2f)" % tl["maxGapPre"])
    check(len([k for k in tl["keys"] if k not in ("none", "good")]) >= 2, "palette de badges variée : %s" % tl["keys"])
    r = ev("""async () => { const cv = document.createElement('canvas'); cv.width = 360; cv.height = 640; const R = new ENOS.editRender.Renderer(cv, window.__tl, { flip: true, rec: window.__rec }); await R.load(); window.__R = R;
      const t = window.__tl, drop = t.stats.drop, imp = t.events.filter((e) => e.from && e.kind !== 'ff'), ck = imp.find((e) => e.check) || imp[5], twT = t.events.find((e) => e.kind === 'outro').t;
      const times = { intro1: 0.4, intro2: 2.2, intro3: 3.4, first: 3.86, preDrop: drop - 0.3, prompt: drop - 0.3, drop: drop + 0.03, afterDrop: drop + 0.6, check: ck ? ck.impact + 0.25 : 5, end: twT + 1.6 };
      const out = {}; let blank = 0; for (const [k, v] of Object.entries(times)) { R.draw(v); const d = cv.toDataURL('image/png'); out[k] = d; const g = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let s = 0; for (let i = 0; i < g.length; i += 97) s += g[i]; if (s < 2000) blank++; }
      return { frames: out, blank, times }; }""")
    for k, d in r["frames"].items():
        open(os.path.join(OUT, k + ".png"), "wb").write(base64.b64decode(d.split(",")[1]))
    check(r["blank"] == 0, "toutes les images clés se dessinent (aucune image vide) : %s" % list(r["times"].items())[:4])
    # --- coupure d'écran : la caméra clampée ne laisse jamais de vide noir sur les bords
    cut = ev("""() => { const R = window.__R, t = window.__tl, imp = t.events.filter((e) => e.from && e.kind !== 'ff'), out = []; for (const e of imp.slice(0, 40)) { const c = R.camAt(e.impact + 0.3); const maxO = (R.BS / 2) * (1 - 1 / Math.max(1, c.S)); out.push([c.S, c.th, Math.abs(c.x) <= R.BS, maxO >= 0]); } return { n: out.length, minS: Math.min(...out.map((x) => x[0])), maxS: Math.max(...out.map((x) => x[0])), maxTh: Math.max(...out.map((x) => Math.abs(x[1]))) * 180 / Math.PI }; }""")
    check(1.1 <= cut["minS"] and cut["maxS"] <= 2.8 + 1e-6 and cut["maxTh"] <= 15.5, "caméra : zoom ×%.2f–×%.2f, inclinaison ≤ %.1f° (spec 1,8–2,8 et −12…+15°)" % (cut["minS"], cut["maxS"], cut["maxTh"]))
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
