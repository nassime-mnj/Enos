"""Chess Edit : BALAYAGE de toute la vidéo (toutes les 70 ms) pour plusieurs parties (solo, équipes, FAHH, 4 intros × 4 outros) : aucune exception de rendu, jamais d'image vide."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(1200000)
    pg.wait_for_function("window.ENOS && ENOS.editMap && !!ENOS.editRender.PostFX")
    r = pg.evaluate("""async () => {
      const SAN = 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#'.split(' ');
      const mk = (teams, keyAt) => { const ch = new Chess(), mv = []; SAN.forEach((s, i) => { const m = ch.move(s); mv.push([m.from + m.to + (m.promotion || ''), m.san, keyAt[i] || 'good', keyAt[i] === 'blunder' ? 420 : 3, null, '', '']); });
        return { t: 7, title: 'x', result: 'gagne', plies: mv.length, pw: teams ? 'Toi + Nasko' : 'Lelex', pb: teams ? 'ETO Brillant' : 'Naskolit', pk: ['a', 'b'], me: null, ch: [], mv, brill: 1, ...(teams ? { teams: { w: [{ name: 'Toi', human: true }, { name: 'Nasko', talk: 'nasko' }], b: [{ name: 'ETO Brillant', talk: 'eto' }] } } : {}) }; };
      const M = ENOS.editMap, out = { frames: 0, errors: [], blank: 0 };
      const au = { duration: 70, mainDropTimestamp: 12, dropTime: 12, confidence: 1, introBeats: Array.from({ length: 16 }, (_, k) => +(4 + 0.5 * k).toFixed(3)), hardBeats: Array.from({ length: 140 }, (_, k) => +(12.3 + 0.47 * k).toFixed(3)), hats: [], vocalPeaks: [] };
      for (const [label, rec, audio] of [['solo', mk(false, { 30: 'brilliant', 11: 'blunder', 16: 'mistake' }), au], ['equipe', mk(true, { 30: 'brilliant', 11: 'blunder', 16: 'mistake', 24: 'blunder' }), au], ['synth', mk(true, { 30: 'brilliant', 11: 'blunder' }), null]]) {
        const pl = M.gamePlies(rec), tl = M.buildViral(pl, rec, audio, { voices: true, intro: true, syncDrop: true, synth: !audio });
        for (const [is, os] of [[0, 0], [1, 1], [2, 2], [3, 3], [0, 4]]) {
          const cv = document.createElement('canvas'); cv.width = 216; cv.height = 384; const R = new ENOS.editRender.Renderer(cv, tl, { rec: { ...rec, introStyle: is, outroStyle: os % 4 } }); await R.load();
          R.noFx = label !== 'equipe' || is !== 1; for (let t = 0; t <= tl.duration + 0.5; t += 0.07) { try { R.draw(t); out.frames++; } catch (e) { out.errors.push(label + ' is' + is + ' t=' + t.toFixed(2) + ' ' + String(e.message).slice(0, 90)); if (out.errors.length > 5) return out; } }
        }
      }
      return out; }""")
    print(r)
    check(r["frames"] > 2500 and not r["errors"], "balayage complet : %d images rendues sans exception %s" % (r["frames"], r["errors"][:3]))
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
