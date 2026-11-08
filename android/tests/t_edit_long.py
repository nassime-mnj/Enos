"""Chess Edit : musique longue à 2 drops -> 1er drop sur un coup normal (ouverture calme avant), 2e drop = principal ; la partie remplit la musique (pas de plateau figé) ; brillant sur sacrifice de tour même en position gagnante."""
import math, os, random, struct, tempfile, wave
from mobile_common import *
from playwright.sync_api import sync_playwright

SR, DUR, D1, D2 = 22050, 100.0, 24.0, 58.0

def make_wav(path):
    random.seed(5); n = int(SR * DUR); buf = [0.0] * n
    def kick(t0, amp):
        i0 = int(t0 * SR)
        for k in range(int(0.12 * SR)):
            if i0 + k < n:
                t = k / SR; buf[i0 + k] += amp * math.sin(2 * math.pi * (50 + 60 * math.exp(-t * 30)) * t) * math.exp(-t * 22)
    for i in range(n):
        t = i / SR
        if t < D1 - 6: buf[i] += 0.04 * math.sin(2 * math.pi * 220 * t)
        elif t < D1: buf[i] += (0.03 + 0.4 * ((t - (D1 - 6)) / 6) ** 2) * (random.random() * 2 - 1)
        elif t < D1 + 16: buf[i] += 0.25 * math.sin(2 * math.pi * 55 * t) + 0.12 * math.sin(2 * math.pi * 1000 * t)
        elif t < D2 - 6: buf[i] += 0.03 * math.sin(2 * math.pi * 330 * t)
        elif t < D2: buf[i] += (0.03 + 0.4 * ((t - (D2 - 6)) / 6) ** 2) * (random.random() * 2 - 1)
        else: buf[i] += 0.25 * math.sin(2 * math.pi * 55 * t) + 0.12 * math.sin(2 * math.pi * 1000 * t)
    t = 0.5
    while t < D1 - 6: kick(t, 0.25); t += 0.5
    t = D1
    while t < D1 + 16: kick(t, 0.9); t += 0.46875
    t = D2
    while t < DUR - 0.2: kick(t, 0.9); t += 0.46875
    pk = max(abs(x) for x in buf) or 1
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, x / pk)) * 30000)) for x in buf))

errs = []; tmp = tempfile.mkdtemp(); wav = os.path.join(tmp, "two_drops.wav"); make_wav(wav)
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(300000)
    pg.wait_for_function("window.ENOS && ENOS.editAudio && ENOS.editMap")
    # 1) analyse audio : 2 drops
    pg.evaluate("() => { window.__f = null; }")
    a = pg.evaluate("""async (b64) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), f = new File([bin], 'two.wav', { type: 'audio/wav' }); const r = await ENOS.editAudio.analyseFile(f, () => {}); return { drops: r.drops, main: r.mainDropTimestamp, dur: r.duration }; }""", __import__("base64").b64encode(open(wav, "rb").read()).decode())
    print(a)
    check(len(a["drops"]) == 2 and abs(a["drops"][0] - D1) < 2.0 and abs(a["drops"][1] - D2) < 2.0 and abs(a["main"] - D2) < 2.0, "analyse : 2 drops trouvés (%s), le dernier est le principal" % a["drops"])
    # 2) montage : partie de 45 demi-coups, musique de 100 s
    r = pg.evaluate("""async (A) => { let seed = 777; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); const ch = new Chess(), mv = [];
      while (mv.length < 45 && !ch.game_over()) { const ms = ch.moves({ verbose: true }); const m = ms[Math.floor(rnd() * ms.length)]; ch.move(m); mv.push([m.from + m.to + (m.promotion || ''), m.san, 'good', 0, null, '']); }
      const rec = { t: 1, title: 'x', result: 'Lelex gagne', plies: mv.length, pw: 'Lelex', pb: 'Naskolit', pk: ['a', 'b'], me: null, ch: [], mv, brill: 0 };
      const M = ENOS.editMap, pl = M.gamePlies(rec), au = { duration: A.dur, mainDropTimestamp: A.main, dropTime: A.main, drops: A.drops, confidence: 1, introBeats: Array.from({ length: Math.floor((A.main - 4) / 0.5) }, (_, k) => +(4 + 0.5 * k).toFixed(3)), hardBeats: Array.from({ length: 140 }, (_, k) => +(A.main + 0.3 + 0.47 * k).toFixed(3)), hats: [], vocalPeaks: [] };
      const tl = M.buildViral(pl, rec, au, { voices: true, intro: true, syncDrop: true }), evs = tl.events.filter((e) => e.from || e.drop), shown = evs.map((e) => e.impact), idx = evs.map((e) => e.ply);
      const gaps = shown.slice(1).map((t, i) => t - shown[i]), d1 = evs.find((e) => e.kind === 'drop1'), dm = evs.find((e) => e.kind === 'drop');
      const calm = evs.filter((e) => e.soft && e.kind !== 'ff' && !e.forced && e.impact < (d1 ? d1.impact : 1e9));
      return { n: pl.length, jumps: idx.slice(1).map((v, i) => v - idx[i]).filter((d) => d !== 1).length, maxGapNoFF: Math.max(...gaps.filter((g, i) => evs[i].kind !== 'ff' && evs[i + 1].kind !== 'ff')), d1: d1 && [d1.impact, d1.soft, d1.minor, d1.bigMove], dm: dm && dm.impact, calm: calm.length, calmEnd: calm.length ? calm[calm.length - 1].impact : 0, mid: evs.filter((e) => e.kind === 'mid').length, ff: evs.filter((e) => e.kind === 'ff').length, last: evs[evs.length - 1].impact, dur: tl.duration, ffDur: (() => { const f = evs.filter((e) => e.kind === 'ff'); return f.length ? f[f.length - 1].impact - f[0].impact : 0; })() }; }""", a)
    print(r)
    check(r["jumps"] == 0, "toute la partie est montrée, aucun saut invisible")
    check(r["d1"] and abs(r["d1"][0] - D1) < 2.0 and not r["d1"][1] and not r["d1"][2], "1er drop = un coup NORMAL (effets pleins) tombant sur le 1er drop de la musique : %s" % (r["d1"],))
    check(r["calm"] >= 8 and r["calmEnd"] < D1, "ouverture calme AVANT le 1er drop : %d coups lents (fin %.1f s)" % (r["calm"], r["calmEnd"]))
    check(r["dm"] is not None and abs(r["dm"] - D2) < 2.0, "drop principal sur le 2e drop (%.1f s)" % (r["dm"] or 0))
    check(r["maxGapNoFF"] <= 3.1, "plateau jamais figé plus de 3 s (écart max entre coups : %.2f s)" % r["maxGapNoFF"])
    check(r["last"] >= D2 + 10 and r["dur"] >= 60, "l'edit remplit la musique : dernier coup à %.1f s, durée %.1f s (musique %.0f s)" % (r["last"], r["dur"], DUR))
    # 3) brillant sur sacrifice de tour : PGN réel Chess.com (La_Loi_De_Fortes - Lepoissonsteve80, 20.Txa7 !! jugé brillant par Chess.com)
    q = pg.evaluate("""async (t) => { const r = await ENOS.brain.reviewGame({ pgn: ENOS.brain.normPgn(t), me: 'auto', ms: 220 }); return r.judged.slice(38, 41).map((x) => [x.n, x.san, x.key]); }""", open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pgn_loi.txt")).read())
    print(q)
    check(q[0][1] == "Rxa7" and q[0][2] == "brilliant", "20.Txa7 (sacrifice de tour, partie réelle Chess.com) = BRILLANT : %s" % q)
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
