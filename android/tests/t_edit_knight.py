"""Chess Edit : sacrifice de CAVALIER brillant = vol très lent (le temps du horse sound), puis gros impact « THE KNIGHT »."""
import base64, os
from mobile_common import *

OUT = os.environ.get("SHOTS", "")
errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(300000)
    pg.wait_for_function("window.ENOS && ENOS.editMap && !!ENOS.editRender.PostFX && window.ENOS_FAHH && !!ENOS_FAHH.horse")
    r = pg.evaluate("""async () => { try {
      const SAN = 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#'.split(' ');
      const mk = (at) => { const ch = new Chess(), mv = []; SAN.forEach((s, i) => { const m = ch.move(s); mv.push([m.from + m.to + (m.promotion || ''), m.san, at.includes(i) ? 'brilliant' : 'good', 3, null, '', '']); }); return { t: 7, title: 'x', result: 'gagne', plies: mv.length, pw: 'Lelex', pb: 'Naskolit', pk: ['a', 'b'], me: null, ch: [], mv, brill: 1 }; };
      const M = ENOS.editMap, au = { duration: 60, mainDropTimestamp: 14, dropTime: 14, confidence: 1, introBeats: Array.from({ length: 18 }, (_, k) => +(4 + 0.5 * k).toFixed(3)), hardBeats: Array.from({ length: 140 }, (_, k) => +(14.3 + 0.47 * k).toFixed(3)), hats: [], vocalPeaks: [] };
      const out = { frames: {} };
      for (const [label, at] of [['drop', [18]], ['later', [31]]]) {
        const rec = mk(at), tl = M.buildViral(M.gamePlies(rec), rec, au, { voices: true, intro: true, syncDrop: true }), evs = tl.events.filter((e) => e.from && e.kind !== 'ff'), kn = evs.find((e) => e.slowKnight);
        if (!kn) { out[label] = null; continue; }
        const prev = evs.filter((e) => e.impact < kn.impact - 0.01).pop(), horse = tl.sfx.filter((x) => x.id === 'horse'), tag = kn.voiceTag;
        out[label] = { dur: kn.dur, impact: kn.impact, gap: prev ? +(kn.impact - kn.dur / 1000 - prev.impact).toFixed(2) : null, horse: horse.map((x) => [x.t, x.bus, x.gain]), tag, kind: kn.kind, boom: tl.sfx.filter((x) => x.id === 'mateboom' && Math.abs(x.t - kn.impact) < 0.01).length, voice: tl.sfx.filter((x) => x.id === 'the_knight').length, san: kn.san };
        if (label === 'drop') { const cv = document.createElement('canvas'); cv.width = 540; cv.height = 960; const R = new ENOS.editRender.Renderer(cv, tl, { rec }); await R.load();
          [[-0.2, 'pre'], [0.15, 'start'], [1.0, 'fly1'], [1.6, 'fly2'], [2.4, 'fly3'], [2.9, 'land'], [3.4, 'after']].forEach(([dt, nm]) => { R.draw(kn.impact - kn.dur / 1000 + dt); out.frames[nm] = cv.toDataURL('image/png'); }); }
      }
      const P = new ENOS.editSfx.Player(); await P.load(); out.horseBuf = P.bufs.horse && +P.bufs.horse.duration.toFixed(2); P.close();
      return out; } catch (e) { return { err: String(e.stack).slice(0, 500) }; } }""")
    if "err" in r: print(r["err"]); raise SystemExit(1)
    print({k: v for k, v in r.items() if k != "frames"})
    for lab in ("drop", "later"):
        x = r[lab]
        check(x is not None and x["dur"] == 2800 and x["san"] and x["horse"] and x["horse"][0][1] == "epic", "%s : vol de 2,8 s + horse sound (bus épique) au départ du vol : %s" % (lab, x and x["horse"]))
        check(abs(x["horse"][0][0] - (x["impact"] - 2.8)) < 0.01, "%s : le hennissement part avec le cheval (%.2f) et l'impact tombe à l'atterrissage (%.2f)" % (lab, x["horse"][0][0], x["impact"]))
        check(x["gap"] is not None and x["gap"] >= 0.1, "%s : le coup précédent est fini avant le départ du vol (marge %s s)" % (lab, x["gap"]))
        check(x["tag"] == "THE KNIGHT !" and x["boom"] == 1 and x["voice"] >= 1, "%s : gros impact + voix « the knight » + tag" % lab)
    check(r["horseBuf"] and r["horseBuf"] > 2.9, "horse-sound décodé (%s s)" % r["horseBuf"])
    if OUT:
        os.makedirs(OUT, exist_ok=True)
        for k, v in r["frames"].items(): open(os.path.join(OUT, "kn_" + k + ".png"), "wb").write(base64.b64decode(v.split(",")[1]))
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
