"""Chess Edit — 18 bruitages : réserves sans répétition, pré-sons calés sur l'impact, voix de Levy une seule fois par partie, intro Cuphead, nulle Bob l'éponge, gaffe flash bang (flash blanc + image figée)."""
import json, os
from mobile_common import *

AN = os.environ.get("ANALYSIS", "/tmp/claude-0/aud/user_music_analysis.json")
OUT = os.environ.get("SHOTS", "")
errs = []
JS = """(a) => { try {
  const [au, SAN, BR, BL, t, result] = a, ch = new Chess(), mv = [];
  SAN.forEach((s, i) => { const m = ch.move(s); mv.push([m.from + m.to + (m.promotion || ''), m.san, BR.includes(i) ? 'brilliant' : BL.includes(i) ? 'blunder' : 'good', 3, null, '', '']); });
  const rec = { t, title: 'x' + t, result, plies: mv.length, brill: BR.length, pw: 'Berserk', pb: 'Stockfish 19', pk: ['bot', 'bot'], me: null, ch: [], mv };
  const M = ENOS.editMap, pl = M.gamePlies(rec), tl = M.buildViral(pl, rec, au, { voices: true, intro: true, syncDrop: true }); window._tl = tl; window._rec = rec;
  const ev = tl.events.filter((e) => e.from && e.kind !== 'ff'), mate = ev.find((e) => e.mate);
  return { sfx: tl.sfx.map((x) => [x.id, x.t, x.bus, !!x.pre]), mate: mate ? [mate.impact, mate.mateSnd || '', mate.preSnd || ''] : null, flash: ev.filter((e) => e.flashbang).map((e) => e.impact), blunders: ev.filter((e) => e.key === 'blunder').length,
    brill: ev.filter((e) => e.key === 'brilliant').map((e) => [e.impact, e.piece, e.preSnd || '']), outT: (tl.events.find((e) => e.kind === 'outro') || {}).t, intro: (tl.events.find((e) => e.kind === 'intro') || {}).dur || 0 };
} catch (e) { return { err: String(e.stack).slice(0, 600) }; } }"""
G1 = 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#'.split(' ')
G2 = 'e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#'.split(' ')            # mat du berger : la gaffe 5…Nf6
PRE = {"sx_mario": 2.1, "sx_nowait": 5.05, "sx_reload": 0.6, "sx_heaven": 4.2}
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(120000)
    pg.wait_for_function("window.ENOS && ENOS.editMap && !!ENOS.editSfx && !!window.ENOS_EDITSFX")
    au = json.load(open(AN))
    n = pg.evaluate("Object.keys(window.ENOS_EDITSFX).length"); check(n == 18, "18 bruitages embarqués (%d)" % n)
    dec = pg.evaluate("(async () => { const p = new ENOS.editSfx.Player(new OfflineAudioContext(2, 44100, 44100)); await p.load(); return Object.keys(p.bufs).filter((k) => /^sx_/.test(k) && p.bufs[k]).map((k) => [k, +p.bufs[k].duration.toFixed(2)]); })()")
    check(len(dec) == 18 and all(d > 0.9 for _, d in dec), "les 18 mp3 se décodent (Web Audio) : %s" % dec[:4])
    r = pg.evaluate(JS, [au, G1, [6, 8, 10, 14, 17, 20, 24, 28], [], 11, "Les Blancs gagnent par mat"])
    if "err" in r: print(r["err"]); raise SystemExit(1)
    S = r["sfx"]; ids = [x[0] for x in S]
    rook = ids.count("the_rook"); check(rook <= 1 and all(ids.count(v) <= 1 for v in ("the_queen", "the_bishop", "the_knight")), "chaque voix de Levy au plus UNE fois par partie (THE ROOK ×%d)" % rook)
    check(ids.count("sx_boom") >= 3 and ids.count("mateboom") >= 3, "brillants : boom cinéma et tonnerre en alternance (%d / %d)" % (ids.count("sx_boom"), ids.count("mateboom")))
    th = [x for x in S if x[0] == "sx_thankyou"]; check(len(th) == 1 and th[0][1] < r["intro"], "intro : « Thank you » de Cuphead pendant l'intro (t=%.2f)" % (th[0][1] if th else -1))
    mi, msnd, mpre = r["mate"]; check(msnd in ("sx_knockout", "sx_cupdeath", "sx_nba", "sx_amogus", "sx_finish", "sx_mariodeath") and msnd in ids, "échec et mat : son de la réserve (%s)" % msnd)
    pres = [x for x in S if x[3] and x[0] in PRE]
    ok = all(any(abs(x[1] + PRE[x[0]] - e) < 0.01 for e in [mi] + [q[0] for q in r["brill"]]) for x in pres)
    check(len(pres) >= 2 and ok, "pré-sons calés : la chute tombe pile sur l'impact (%s)" % [(x[0], round(x[1], 2)) for x in pres])
    check(mpre in ("sx_mario", "sx_nowait", "sx_reload"), "un pré-son juste avant le mat (%s)" % mpre)
    check(any(q[2] == "sx_heaven" for q in r["brill"]) or any(q[2] == "sx_reload" for q in r["brill"]), "pré-son de brillant (Made in Heaven / reload) : %s" % [q[2] for q in r["brill"] if q[2]])
    hits = sorted([x for x in S if x[2] in ("hit", "voice", "epic")], key=lambda x: x[1])
    # variété : 6 parties différentes → plusieurs sons de mat différents
    mates, gaffes, flashes = set(), set(), 0
    for k in range(6):
        q = pg.evaluate(JS, [au, G2, [], [5], 100 + k, "Les Blancs gagnent par mat"])
        mates.add(q["mate"][1]); gaffes |= {x[0] for x in q["sfx"] if x[0] in ("fahh_slow", "sx_gong", "sx_flashbang")}
        if q["flash"]: flashes += 1; fq = q
    check(len(mates) >= 3, "6 parties → %d sons de mat différents %s (pas toujours le même)" % (len(mates), sorted(mates)))
    check(len(gaffes) >= 2, "gaffes : %s" % sorted(gaffes))
    check(flashes >= 1, "au moins une gaffe « flash bang » marquée pour le flash visuel (%d / 6)" % flashes)
    d = pg.evaluate(JS, [au, 'e4 e5 Nf3 Nc6 Bb5 a6'.split(' '), [], [], 7, "Nulle (1/2-1/2)"])
    sad = [x for x in d["sfx"] if x[0] == "sx_sad"]; check(len(sad) == 1 and sad[0][1] >= d["outT"], "nulle : Bob l'éponge déçu sur l'écran de fin")
    check(not any(x[0] == "this_is_the_way" for x in d["sfx"]), "nulle : pas de « this is the way »")
    # rendu du flash bang : image blanche à l'impact, image FIGÉE pendant la pause
    if flashes:
        pg.evaluate(JS, [au, G2, [], [5], 100 + [k for k in range(6)][0], "Les Blancs gagnent par mat"])
        for k in range(6):
            q = pg.evaluate(JS, [au, G2, [], [5], 100 + k, "Les Blancs gagnent par mat"])
            if q["flash"]: break
        fi = q["flash"][0]
        res = pg.evaluate("""async (fi) => { const cv = document.createElement('canvas'); cv.width = 540; cv.height = 960; const R = new ENOS.editRender.Renderer(cv, window._tl, { rec: window._rec }); await R.load();
          const lum = (t) => { R.draw(t); const d = cv.getContext('2d').getImageData(0, 0, 540, 960).data; let s = 0; for (let i = 0; i < d.length; i += 400) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 400) / 3; };
          const fb = R.flashbangAt(fi + 0.5); return { at: lum(fi + 0.03), before: lum(fi - 0.4), late: lum(fi + 2.4), frozen: !!fb, hold: fb ? fb.hold : 0 }; }""", fi)
        check(res["at"] > 235 and res["before"] < 200 and res["late"] < 200, "flash bang : écran blanc à l'impact (%.0f), normal avant (%.0f) et après (%.0f)" % (res["at"], res["before"], res["late"]))
        check(res["frozen"] and res["hold"] >= 0.3, "flash bang : image figée %.2f s" % res["hold"])
        if OUT:
            os.makedirs(OUT, exist_ok=True)
            for dt in (0.05, 0.4, 0.9, 1.5):
                pg.evaluate("async (t) => { let cv = document.getElementById('_fbcv'); if (!cv) { cv = document.createElement('canvas'); cv.id = '_fbcv'; cv.width = 540; cv.height = 960; document.body.appendChild(cv); window._R = new ENOS.editRender.Renderer(cv, window._tl, { rec: window._rec }); await window._R.load(); } window._R.draw(t); }", fi + dt)
                pg.locator("#_fbcv").screenshot(path=os.path.join(OUT, "flashbang_%.2f.png" % dt))
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
