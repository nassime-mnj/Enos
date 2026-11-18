"""Auto-edit : synchro sur l'ÉNERGIE de la musique (kicks forts uniquement, pas de plage morte, respiration), tous les brillants montrés, « This is the way » seulement à l'outro."""
import json, os
from mobile_common import *

AN = os.environ.get("ANALYSIS", "/tmp/claude-0/aud/user_music_analysis.json")
errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(120000)
    pg.wait_for_function("window.ENOS && ENOS.editMap && !!ENOS.editMap.buildSyncEnergy")
    au = json.load(open(AN))
    r = pg.evaluate("""(au) => { try {
      const SAN = 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#'.split(' '), BR = [6, 8, 10, 14, 17, 20, 24, 28];
      const ch = new Chess(), mv = []; SAN.forEach((s, i) => { const m = ch.move(s); mv.push([m.from + m.to + (m.promotion || ''), m.san, BR.includes(i) ? 'brilliant' : 'good', 3, null, '', '']); });
      const rec = { t: 11, title: 'x', result: 'Les Blancs gagnent par mat', plies: mv.length, brill: BR.length, pw: 'Berserk', pb: 'Stockfish', pk: ['bot', 'bot'], me: null, ch: [], mv };
      const M = ENOS.editMap, pl = M.gamePlies(rec), tl = M.buildViral(pl, rec, au, { voices: true, intro: true, syncDrop: true });
      const evs = tl.events.filter((e) => e.from && e.kind !== 'ff'), ff = tl.events.filter((e) => e.kind === 'ff'), out = tl.events.find((e) => e.kind === 'outro');
      const kicks = tl.energy ? tl.energy.kicks : [];
      return { energy: tl.energy && { ms: tl.energy.musicStart, win: tl.energy.window, shown: tl.energy.shown, heroes: tl.energy.heroes }, musicStart: tl.musicStart, dur: tl.duration, n: pl.length,
        shown: evs.length, ff: ff.length, brilliantShown: evs.filter((e) => e.key === 'brilliant').length, brilliantTotal: pl.filter((p) => p.key === 'brilliant').length,
        times: evs.map((e) => e.impact), kicks, outT: out.t, way: tl.sfx.filter((x) => x.id === 'this_is_the_way').map((x) => [x.t, x.bus, x.level]),
        voices: tl.sfx.filter((x) => x.bus === 'voice' && x.id !== 'this_is_the_way').map((x) => [x.id, x.level]), dry: tl.sfx.filter((x) => (x.id === 'move' || x.id === 'capture')).every((x) => x.bus === 'sfx' || x.bus === 'echo'),
        movesDry: tl.sfx.filter((x) => x.id === 'move' && x.bus === 'sfx').length, movesEcho: tl.sfx.filter((x) => x.id === 'move' && x.bus === 'echo').length, crystalEcho: tl.sfx.filter((x) => x.id === 'crystal').every((x) => x.bus === 'echo'),
        thunder: tl.sfx.filter((x) => x.id === "mateboom" || x.id === "sx_boom").length, lastImpact: evs[evs.length - 1].impact };
    } catch (e) { return { err: String(e.stack).slice(0, 600) }; } }""", au)
    if "err" in r: print(r["err"]); raise SystemExit(1)
    print({k: v for k, v in r.items() if k not in ("times", "kicks")})
    check(r["musicStart"] > 5 and r["energy"] is not None, "la musique démarre au début d'un passage de groove (musicStart = %.1f s) : plus de plage morte" % r["musicStart"])
    check(r["brilliantShown"] == r["brilliantTotal"] == 8, "les 8 coups brillants sont TOUS montrés (%d / %d)" % (r["brilliantShown"], r["brilliantTotal"]))
    pk = {round(k[1], 2): k[2] for k in r["kicks"]}
    ons = [t for t in r["times"]]; bad = [t for t in ons if min(abs(t - k[1]) for k in r["kicks"]) > 0.015]
    check(not bad, "chaque coup tombe pile sur un kick de la musique (%d coups, écart max %.0f ms)" % (len(ons), 1000 * max(min(abs(t - k[1]) for k in r["kicks"]) for t in ons)))
    weak = [k for k in r["kicks"] if k[2] < 0.5]
    check(len(weak) <= max(1, len(r["kicks"]) // 12), "les coups sont sur des pics FORTS (force ≥ 0,5) : %d faibles sur %d" % (len(weak), len(r["kicks"])))
    gaps = [b_ - a for a, b_ in zip(ons, ons[1:])]
    check(min(gaps) >= 0.45 and max(gaps) <= 6.5, "espacement : mini %.2f s, maxi %.2f s (aucun tunnel vide, aucun enchaînement mécanique)" % (min(gaps), max(gaps)))
    check(len(r["way"]) == 1 and r["way"][0][0] >= r["outT"] and r["way"][0][1] == "voice", "« This is the way » : UNE seule fois, à l'outro (t=%.1f ≥ outro %.1f), jamais en cours de partie" % (r["way"][0][0] if r["way"] else -1, r["outT"]))
    check(all(v[1] == 0.4 for v in r["voices"]) and len(r["voices"]) >= 1, "voix des brillants : musique à −8 dB (level 0,4) : %s" % r["voices"][:3])
    check(r["movesDry"] > 0 and r["movesEcho"] == 0 and r["crystalEcho"], "coups normaux = bois sec ; échec = cristal avec écho (%d secs)" % r["movesDry"])
    check(r["thunder"] >= 8, "un tonnerre ou un boom cinéma sur chaque brillant (%d)" % r["thunder"])
    check(r["dur"] <= au["duration"] - r["musicStart"] + 0.01, "la vidéo (%.1f s) tient dans la musique restante (%.1f s)" % (r["dur"], au["duration"] - r["musicStart"]))
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
