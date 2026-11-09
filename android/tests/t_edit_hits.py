"""Chess Edit : FAHH (erreur) et FAHH ralenti (gaffe) qui frappent, pause sur les gaffes, et affichage épique « qui est responsable de quel coup » en équipe."""
import base64, os
from mobile_common import *

OUT = os.environ.get("SHOTS", "")
errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(300000)
    pg.wait_for_function("window.ENOS && ENOS.editMap && ENOS.editSfx && window.ENOS_FAHH")
    r = pg.evaluate("""async () => {
      let seed = 4242; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); const ch = new Chess(), mv = [];
      while (mv.length < 50 && !ch.game_over()) { const ms = ch.moves({ verbose: true }); const m = ms[Math.floor(rnd() * ms.length)]; ch.move(m); const i = mv.length; mv.push([m.from + m.to + (m.promotion || ''), m.san, i === 10 ? 'mistake' : i === 24 ? 'blunder' : i === 33 ? 'mistake' : i === 38 ? 'blunder' : 'good', i === 24 || i === 38 ? 420 : i === 10 || i === 33 ? 160 : 5, null, '', i % 2 ? 'Bot 400' : ['Toi', 'Nasko', 'Lelex'][(i >> 1) % 3]]); }
      const rec = { t: 5151, title: 'x', result: 'gagne', plies: mv.length, pw: 'Toi + Nasko + Lelex', pb: 'Bot 400', pk: ['t', 't'], me: null, ch: [], mv, brill: 0, teams: { w: [{ name: 'Toi', human: true }, { name: 'Nasko', talk: 'nasko', elo: 1500 }, { name: 'Lelex', talk: 'lelex', elo: 1500 }], b: [{ name: 'Bot 400', kind: 'sf', elo: 400 }] } };
      const M = ENOS.editMap, pl = M.gamePlies(rec), au = { duration: 80, mainDropTimestamp: 14, dropTime: 14, confidence: 1, introBeats: Array.from({ length: 20 }, (_, k) => +(4 + 0.5 * k).toFixed(3)), hardBeats: Array.from({ length: 140 }, (_, k) => +(14.3 + 0.47 * k).toFixed(3)), hats: [], vocalPeaks: [] };
      const tl = M.buildViral(pl, rec, au, { voices: true, intro: true, syncDrop: true }), evs = tl.events.filter((e) => e.from), out = {};
      const bl = evs.filter((e) => e.key === 'blunder'), mi = evs.filter((e) => e.key === 'mistake'), sl = tl.sfx.filter((x) => x.id === 'fahh_slow'), sn = tl.sfx.filter((x) => x.id === 'fahh');
      out.n = [bl.length, mi.length, sl.length, sn.length]; out.slowAt = sl.map((x) => x.t); out.blAt = bl.map((e) => e.impact); out.bus = [sl[0] && sl[0].bus, sn[0] && sn[0].bus]; out.thud = tl.sfx.filter((x) => x.id === 'thud' && bl.some((e) => Math.abs(e.impact - x.t) < 0.01)).length;
      out.hold = bl.map((e) => { const nx = evs.filter((x) => x.impact > e.impact + 0.001 && x.kind !== 'ff')[0]; return [!!e.blunderHold, e.soft, e.kind, nx ? +(nx.impact - e.impact).toFixed(2) : null]; });
      // le son se charge et se décode
      const P = new ENOS.editSfx.Player(); await P.load(); out.buf = [!!P.bufs.fahh, !!P.bufs.fahh_slow, P.bufs.fahh_slow && +P.bufs.fahh_slow.duration.toFixed(1)]; P.close();
      // rendu : bandeau « qui a joué »
      const cv = document.createElement('canvas'); cv.width = 540; cv.height = 960; const R = new ENOS.editRender.Renderer(cv, tl, { rec }); await R.load(); out.frames = {};
      const pick = (e, dt, nm) => { R.draw(e.impact + dt); out.frames[nm] = cv.toDataURL('image/png'); };
      const normal = evs.filter((e) => !e.soft && e.kind !== 'ff' && e.key === 'good' && e.impact > 14.5 && !e.blunderHold)[3]; if (normal) { pick(normal, 0.25, 'credit_normal'); }
      if (bl[1]) { pick(bl[1], 0.1, 'blunder_a'); pick(bl[1], 0.6, 'blunder_b'); pick(bl[1], 1.4, 'blunder_c'); }
      if (mi[1]) pick(mi[1], 0.3, 'mistake_a');
      out.px = Array.from(cv.getContext('2d').getImageData(0, 0, 4, 4).data).length;
      out.diff = out.frames.blunder_a !== out.frames.blunder_b && out.frames.blunder_b !== out.frames.credit_normal;
      return out; }""")
    print({k: v for k, v in r.items() if k != "frames"})
    check(r["n"][2] == r["n"][0] and r["n"][3] >= 1 and r["n"][3] <= r["n"][1], "1 FAHH ralenti par gaffe montrée, 1 FAHH par erreur montrée (%s ; les coups passés en accéléré restent muets)" % r["n"])
    check(r["bus"] == ["hit", "hit"] and r["thud"] >= r["n"][0], "ça frappe : bus d'impact + choc grave sous chaque gaffe (%s, thud %d)" % (r["bus"], r["thud"]))
    check(r["buf"][0] and r["buf"][1] and r["buf"][2] > 4, "les deux mp3 se décodent (FAHH ralenti %s s)" % r["buf"][2])
    check(all(h[0] for h in r["hold"] if not h[1]) or all(h[3] is None or h[3] >= 1.5 for h in r["hold"] if h[2] != 'ff' and not h[1]), "gaffe = PAUSE : le coup suivant tombe ≥ 1,5 s plus tard : %s" % r["hold"])
    check(r["diff"] and r["px"] == 64, "bandeau « responsable » animé (images différentes), canvas propre")
    if OUT:
        os.makedirs(OUT, exist_ok=True)
        for k, v in r["frames"].items(): open(os.path.join(OUT, k + ".png"), "wb").write(base64.b64decode(v.split(",")[1]))
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
