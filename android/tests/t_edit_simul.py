"""Chess Edit Simultanée : 4 plateaux, ETO court d'un plateau à l'autre (sort de l'écran), flèches + mini-plateaux, victoire d'équipe."""
import base64, os
from mobile_common import *

OUT = os.environ.get("SHOTS", "")
errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(300000)
    pg.wait_for_function("window.ENOS && !!ENOS.editSimul && !!ENOS.editRender.PostFX")
    r = pg.evaluate("""async () => { try {
      const G = [
        ['e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#', 'w', [18, 24]],
        ['f3 e5 g4 Qh4#', 'b', [1]],
        ['e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7 Kxf7 Qf3+ Ke6 Nc3 Nb4 Qe4 c6', '*', []],
        ['d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6 cxd5 Nxd5 Bxe7 Qxe7', '*', []]];
      const boards = G.map(([san, res, br], i) => { const ch = new Chess(), mv = []; san.split(' ').forEach((s, k) => { const m = ch.move(s); mv.push([m.from + m.to + (m.promotion || ''), m.san, br.includes(k) ? 'brilliant' : (k === 2 && i === 2 ? 'blunder' : 'good'), 3, null, '', '']); }); return { name: ['Lina', 'Nassime', 'Omar', 'Sam'][i], talk: '', human: true, elo: 1200 + i * 50, mv, result: res }; });
      const order = []; for (let k = 0; k < 40; k += 2) { boards.forEach((bd, i) => { if (bd.mv.length > k) order.push([i, k]); }); boards.forEach((bd, i) => { if (bd.mv.length > k + 1) order.push([i, k + 1]); }); }
      const rec = { t: 9, title: 'Simultanée', result: "L'équipe gagne", plies: 33, brill: 3, pw: 'ETO', pb: 'Équipe', pk: ['team', 'team'], me: null, ch: [], mv: boards[0].mv, simul: { boss: { name: 'ETO', talk: 'eto', elo: 3000, kind: 'eto' }, boards, order, team: 1 } };
      const au = { duration: 60, mainDropTimestamp: 14, dropTime: 14, confidence: 1, introBeats: Array.from({ length: 18 }, (_, k) => +(4 + 0.5 * k).toFixed(3)), hardBeats: Array.from({ length: 140 }, (_, k) => +(14.3 + 0.47 * k).toFixed(3)) };
      const tl = ENOS.editSimul.build(rec, au, { intro: true }), S = tl.simul;
      const out = { frames: {}, dur: tl.duration, vis: S.vis.length, sfx: tl.sfx.length, bys: S.vis.map((v) => v.b), ends: S.vis.filter((v) => v.end).length };
      const cv = document.createElement('canvas'); cv.width = 540; cv.height = 960; const R = new ENOS.editSimul.Renderer(cv, tl, { rec }); await R.load();
      let bad = 0, firstErr = ''; for (let t = 0; t < tl.duration; t += 0.05) { try { R.draw(t); } catch (e) { bad++; firstErr = firstErr || (t.toFixed(2) + ' ' + String(e.stack).slice(0, 300)); } }
      out.bad = bad; out.err = firstErr;
      const v = S.vis, mid = v.find((x, i) => i > 0 && x.b !== v[i - 1].b);
      const shots = { intro: 1.5, board0: v[0].tImp + 0.3, run: mid ? mid.tPan0 - 0.25 : 5, pan: mid ? (mid.tPan0 + mid.tArrive) / 2 : 6, arrive: mid ? mid.tImp + 0.2 : 7, end: tl.duration - 1.2 };
      for (const [nm, t] of Object.entries(shots)) { R.draw(t); out.frames[nm] = cv.toDataURL('image/png'); }
      return out; } catch (e) { return { err: String(e.stack).slice(0, 600) }; } }""")
    print({k: v for k, v in r.items() if k != "frames"})
    check(not r.get("err") and r.get("bad") == 0, "toutes les images se dessinent sans exception : %s" % r.get("err"))
    check(r["vis"] >= 4 and len(set(r["bys"])) == 4, "ETO passe voir les 4 plateaux (%s)" % r["bys"])
    check(r["ends"] >= 1 and r["sfx"] > 10 and 20 < r["dur"] < 120, "fins de plateau + sons + durée plausible (%.1f s, %d sons)" % (r["dur"], r["sfx"]))
    if OUT:
        os.makedirs(OUT, exist_ok=True)
        for k, v in r["frames"].items(): open(os.path.join(OUT, "sim_" + k + ".png"), "wb").write(base64.b64decode(v.split(",")[1]))
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
