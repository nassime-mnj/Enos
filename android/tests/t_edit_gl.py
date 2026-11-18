"""Chess Edit : post-production WebGL (bloom, projecteur sur la pièce héros, fumée, déformation, feu, vide final) — rendu déterministe et différent du rendu 2D."""
import base64, os
from mobile_common import *

OUT = os.environ.get("SHOTS", "")
errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(600000)
    pg.wait_for_function("window.ENOS && ENOS.editMap && ENOS.editRender && !!ENOS.editRender.PostFX")
    r = pg.evaluate("""async () => { try {
      const ch = new Chess(), san = 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#'.split(' '), mv = [];
      san.forEach((s, i) => { const m = ch.move(s); mv.push([m.from + m.to + (m.promotion || ''), m.san, i === 30 ? 'brilliant' : i === 11 ? 'blunder' : i === 32 ? 'best' : 'good', i === 11 ? 420 : 3, null, '']); });
      const rec = { t: 99, title: 'x', result: 'gagne', plies: mv.length, pw: 'Lelex', pb: 'Naskolit', pk: ['a', 'b'], me: null, ch: [], mv, brill: 1 };
      const M = ENOS.editMap, pl = M.gamePlies(rec), au = { duration: 60, mainDropTimestamp: 12, dropTime: 12, confidence: 1, introBeats: Array.from({ length: 16 }, (_, k) => +(4 + 0.5 * k).toFixed(3)), hardBeats: Array.from({ length: 140 }, (_, k) => +(12.3 + 0.47 * k).toFixed(3)), hats: [], vocalPeaks: [] };
      const tl = M.buildViral(pl, rec, au, { voices: true, intro: true, syncDrop: true }), evs = tl.events.filter((e) => e.from && e.kind !== 'ff'), out = { frames: {} };
      const cv = document.createElement('canvas'); cv.width = 540; cv.height = 960; const R = new ENOS.editRender.Renderer(cv, tl, { rec: { ...rec, outroStyle: 3 } }); await R.load();
      const hero = evs.find((e) => e.bigMove), bl = evs.find((e) => e.blunderHold), o = tl.events.find((e) => e.kind === 'outro');
      const shot = (nm, t) => { R.draw(t); out.frames[nm] = cv.toDataURL('image/png'); };
      out.hasHero = !!hero; out.hasBl = !!bl; out.gl = !!(R._post === undefined ? (R.draw(5), R._post) : R._post); out.glErr = R._glErr || '';
      if (hero) { [[-0.3, 'hero_pre'], [0.08, 'hero_hit'], [0.3, 'hero_dim'], [0.9, 'hero_hold'], [2.2, 'hero_relight'], [4.0, 'hero_after']].forEach(([dt, n]) => shot(n, hero.impact + dt)); R.noFx = true; shot('hero_flat', hero.impact + 0.3); R.noFx = false; }
      if (bl) { shot('blunder_a', bl.impact + 0.2); shot('blunder_b', bl.impact + 1.0); }
      [[0.2, 'out_a'], [0.9, 'out_b'], [1.6, 'out_c'], [2.1, 'out_d'], [2.8, 'out_e']].forEach(([dt, n]) => shot(n, o.t + dt));
      const a = (nm) => out.frames[nm]; out.diff = hero ? a('hero_hit') !== a('hero_flat') && a('hero_dim') !== a('hero_hold') : false;
      out.px = Array.from(cv.getContext('2d').getImageData(0, 0, 4, 4).data).length;
      shot('det1', hero ? hero.impact + 0.3 : 6); const d1 = out.frames.det1; shot('det2', hero ? hero.impact + 0.3 : 6); out.det = d1 === out.frames.det2;
      // ORIENTATION : à un instant calme, le rendu GL doit RESSEMBLER au rendu 2D (jamais retourné)
      { const tc = 7.7; const grab = () => { const d = cv.getContext('2d').getImageData(0, 0, 540, 960).data; return d; };
        R.noFx = true; R.draw(tc); const flat = grab(); R.noFx = false; R.draw(tc); const gl = grab(); let same = 0, flip = 0, n = 0;
        for (let y = 100; y < 860; y += 7) for (let x = 0; x < 540; x += 7) { const i = (y * 540 + x) * 4, j = ((959 - y) * 540 + x) * 4; same += Math.abs(flat[i] - gl[i]) + Math.abs(flat[i + 1] - gl[i + 1]); flip += Math.abs(flat[i] - gl[j]) + Math.abs(flat[i + 1] - gl[j + 1]); n++; }
        out.orient = [Math.round(same / n), Math.round(flip / n)]; }
      return out; } catch (e) { return { err: String(e.stack || e).slice(0, 600) }; } }""")
    if 'err' in r: print(r['err']); raise SystemExit(1)
    print({k: v for k, v in r.items() if k != "frames"})
    check(r["gl"] and not r["glErr"], "WebGL2 disponible : %s" % (r["glErr"] or "ok"))
    if r["gl"]:
        check(r["diff"], "le rendu GL diffère du rendu 2D et évolue (impact → projecteur → retour de la lumière)")
        check(r["det"], "rendu déterministe (même t = même image)")
        check(r["px"] == 64, "canvas non « tainted »")
    if OUT:
        os.makedirs(OUT, exist_ok=True)
        for k, v in r["frames"].items(): open(os.path.join(OUT, k + ".png"), "wb").write(base64.b64decode(v.split(",")[1]))
    if r["gl"]: check(r["orient"][0] * 2 < r["orient"][1], "le rendu GL n'est PAS retourné (écart au rendu 2D %d, écart retourné %d)" % tuple(r["orient"]))
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
