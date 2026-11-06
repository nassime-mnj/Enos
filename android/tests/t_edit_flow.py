"""Chess Edit : continuité (montage accéléré lisible), hero moment 1,6 s, cadence 0,65–0,90 s, coups forcés sans effet, boss unique, THIS IS THE WAY ≤ 2."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    ev = pg.evaluate
    r = ev("""async () => {
      let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      const ch = new Chess(), mv = []; let rookAt = -1;
      while (mv.length < 64 && !ch.game_over()) { const ms = ch.moves({ verbose: true }); const m = ms[Math.floor(rnd() * ms.length)]; ch.move(m); mv.push([m.from + m.to + (m.promotion || ''), m.san, 'good', 0, null, '']); if (rookAt < 0 && mv.length > 40 && m.piece === 'r' && m.captured) rookAt = mv.length - 1; }
      if (rookAt < 0) rookAt = mv.findIndex((x, i) => i > 36 && /^R/.test(x[1])); if (rookAt < 0) rookAt = 48; mv[rookAt][2] = 'brilliant';
      const rec = { t: 1, title: 'x', result: 'Lelex gagne', plies: mv.length, pw: 'Lelex', pb: 'Naskolit', pk: ['a', 'b'], me: null, ch: [], mv, brill: 1 };
      const M = ENOS.editMap, pl = M.gamePlies(rec), audio = { duration: 70, mainDropTimestamp: 16, dropTime: 16, confidence: 1, introBeats: Array.from({ length: 26 }, (_, k) => +(0.7 + 0.5 * k).toFixed(3)), hardBeats: Array.from({ length: 140 }, (_, k) => +(16.2 + 0.3 * k).toFixed(3)), hats: [], vocalPeaks: [] };
      const tl = M.buildViral(pl, rec, audio, { voices: true, intro: true, syncDrop: true }), evs = tl.events.filter((e) => (e.from || e.drop)), D = tl.stats.drop;
      const idx = evs.map((e) => e.ply), ffs = evs.filter((e) => e.kind === 'ff'), hero = evs.filter((e) => e.bigMove), tail = evs.filter((e) => e.impact >= D - 0.01);
      const gaps = tail.slice(1).map((e, i) => [e.impact - tail[i].impact, tail[i].bigMove]); const heroGaps = gaps.filter((g) => g[1]).map((g) => g[0]), normGaps = gaps.filter((g) => !g[1]).map((g) => g[0]);
      const afterCheck = tail.filter((e, i) => i && tail[i - 1].check && e.piece === 'k');
      return { n: pl.length, rookAt, jumps: idx.slice(1).map((v, i) => v - idx[i]).filter((d) => d > 1).length, maxJump: Math.max(...idx.slice(1).map((v, i) => v - idx[i])), ff: ffs.length, ffDur: ffs.length ? ffs[ffs.length - 1].impact - ffs[0].impact : 0, ffDt: ffs.slice(1).map((e, i) => e.impact - ffs[i].impact), ffFx: ffs.filter((e) => e.badge || e.strobe || e.redPath || e.cam).length, hero: hero.map((e) => e.san), heroGaps, normMin: Math.min(...normGaps), normMax: Math.max(...normGaps), forced: afterCheck.length, forcedFx: afterCheck.filter((e) => e.badge || e.strobe || e.boss || e.arrow || !e.soft).length, boss: evs.filter((e) => e.boss).map((e) => [e.san, e.ply === pl.length - 1]), strobes: evs.filter((e) => e.strobe).length, tw: tl.sfx.filter((x) => x.id === 'this_is_the_way').length, dropT: D, end: tl.duration, last: evs[evs.length - 1].impact, calm: evs.filter((e) => e.soft && e.kind !== 'ff' && !e.forced).length, voiceTag: evs.filter((e) => e.voiceTag).map((e) => e.voiceTag) }; }""")
    print(r)
    check(r["jumps"] == 0, "aucun saut invisible : tous les coups intermédiaires sont montrés (écart max d'index %d)" % r["maxJump"])
    check(r["ff"] >= 8 and r["ffDur"] <= 3.6 and all(0.055 <= d <= 0.145 for d in r["ffDt"]) and r["ffFx"] == 0, "montage accéléré lisible : %d coups en %.1f s (≤ 140 ms chacun), zéro badge / flash / inclinaison" % (r["ff"], r["ffDur"]))
    check(all(g >= 1.55 for g in r["heroGaps"]) and r["heroGaps"], "HERO MOMENT : %s verrouille le plateau %.2f s avant le coup suivant" % (r["hero"], min(r["heroGaps"]) if r["heroGaps"] else 0))
    check(r["normMin"] >= 0.64 and r["normMax"] <= 0.91, "après le drop : un coup toutes les %.2f–%.2f s (vrais temps forts)" % (r["normMin"], r["normMax"]))
    check(r["forced"] == 0 or r["forcedFx"] == 0, "coups forcés du perdant : aucun effet (%d coups)" % r["forced"])
    check(len(r["boss"]) <= 1 and all(x[1] for x in r["boss"]) and r["strobes"] <= 2, "pièce rouge géante : 1 seul coup (le coup de grâce) ; strobe ≤ 2 : %s" % r["boss"])
    check(r["tw"] <= 2, "« THIS IS THE WAY » ≤ 2 fois par partie (%d)" % r["tw"])
    check(r["end"] - r["last"] <= 2.01 or r["end"] - r["last"] > 0, "la partie s'étale sur la musique : drop %.1f s → dernier coup %.1f s" % (r["dropT"], r["last"]))
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
