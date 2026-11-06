"""Chess Edit : vainqueur dynamique (jamais « ChatGPT Prime » en dur), flip 3D réservé à Prime, rouge réservé aux gaffes / mat, impact brillant cyan, overlay « prochain coup » limité à Prime, THE ROOK, Hawaii."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    ev = pg.evaluate
    r = ev("""async () => {
      const mkRec = (sans, keys, pw, pb, evs) => { const ch = new Chess(), mv = []; sans.forEach((s, i) => { const m = ch.move(s); mv.push([m.from + m.to + (m.promotion || ''), m.san, keys[i] || 'good', 0, evs ? evs[i] : null, '']); }); return { t: 1, title: 'x', result: pw + ' gagne', plies: mv.length, pw, pb, pk: ['a', 'b'], me: null, ch: [], mv, brill: 0 }; };
      const M = ENOS.editMap, out = {};
      // 1) Lelex bat Naskolit (mat du berger) — script qui DEMANDE une bascule 3D
      const rec = mkRec(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'], { 6: 'brilliant' }, 'Lelex', 'Naskolit');
      let pl = M.gamePlies(rec); const sc = M.parseScript(JSON.stringify({ intro: { end: 3.8 }, events: pl.map((p, i) => ({ moveIndex: i, timestamp: 3.85 + i * 0.5, badge: i === 6 ? 'BRILLIANT' : 'GOOD', vfx: i === 3 ? ['RED_PATH', 'RED_TINT', 'PROMPT_STREAM'] : [] })), outro: { timestamp: 8, type: '3D_BOARD_FLIP_CHECKMATE' } }), pl.length).script;
      let tl = M.buildFromScript(pl, rec, sc, { intro: true, voices: true }); let mv = tl.events.filter((e) => e.from), o = tl.events.find((e) => e.kind === 'outro');
      out.script = { winner: o.winner && o.winner.name, mate: o.winner && o.winner.mate, flip3d: o.flip3d, king: o.winner && o.winner.king, prompts: tl.events.filter((e) => e.kind === 'prompt' || e.kind === 'cutrook').length, red: mv.filter((e) => e.redPath || e.tintRed).length };
      tl = M.buildViral(pl, rec, null, { intro: true, synth: true, voices: true }); mv = tl.events.filter((e) => e.from); o = tl.events.find((e) => e.kind === 'outro');
      out.auto = { winner: o.winner && o.winner.name, flip3d: o.flip3d, prompts: tl.events.filter((e) => e.kind === 'prompt' || e.kind === 'cutrook').length, red: mv.filter((e) => e.redPath || e.tintRed).length, tones: [...new Set(mv.map((e) => e.tone))], redTones: mv.filter((e) => e.tone === 'red').map((e) => [e.key, !!e.mate]), twistEvents: tl.events.filter((e) => e.cheat === 'twist').length };
      const cv = document.createElement('canvas'); cv.width = 270; cv.height = 480; const R = new ENOS.editRender.Renderer(cv, tl, {}); await R.load(); R.draw(o.t + 1.0); out.twists = R.twists.length; out.crowns = !!(o.winner && o.winner.mate);
      // 2) THE ROOK (brillant de tour) + Hawaii (gros écart d'évaluation en ouverture)
      const sans = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Nxd5', 'Nxf7', 'Kxf7', 'Qf3+', 'Ke6', 'Nc3', 'Nb4', 'd4', 'c6', 'Bb3', 'h6', 'O-O', 'Qf6', 'Qxd5+', 'cxd5', 'Bxd5+', 'Kd6', 'Re1', 'Ke7', 'dxe5', 'Qxe5', 'Rxe5+'];
      const keys = {}, evs = sans.map((s, i) => (i < 4 ? 20 : i === 6 ? 20 : i === 7 ? -420 : -400 + i)); keys[30] = 'brilliant';
      const rec2 = mkRec(sans, keys, 'Toi', 'Naskolit', evs); pl = M.gamePlies(rec2); tl = M.buildViral(pl, rec2, null, { intro: true, synth: true, voices: true }); mv = tl.events.filter((e) => e.from);
      const big = mv.filter((e) => e.bigMove), rk = tl.sfx.filter((x) => x.id === 'the_rook'), hw = tl.sfx.filter((x) => x.id === 'hawaii');
      out.rook = { big: big.map((e) => [e.san, e.pre, !!e.voiceTag]), voices: tl.sfx.filter((x) => x.bus === 'voice').map((x) => [x.id, x.level]), rkLevel: rk.map((x) => x.level), hawaii: hw.map((x) => x.ply), tag: mv.filter((e) => e.voiceTag).map((e) => e.voiceTag) };
      const R2 = new ENOS.editRender.Renderer(cv, tl, {}); await R2.load(); const b0 = big[0]; const rp = R2.ripples(b0.impact + 0.12), flat = R2.ripOff([], 3, 3), off = rp.length ? R2.ripOff(rp, rp[0].ci + 1, rp[0].ri) : null; out.ripple = !!rp.length && off && Math.abs(off.dy) > 0.5;
      out.hitstop = R2.hitstop(b0.impact + 0.05) === b0.impact && R2.hitstop(b0.impact + 0.2) !== b0.impact; out.frames = {}; const rk0 = big.find((e) => e.voiceTag) || b0, snap = (k, tt) => { R2.draw(tt); out.frames[k] = cv.toDataURL('image/png'); }; snap('anticip', b0.impact - 0.15); snap('hitstop', b0.impact + 0.04); snap('ripple', b0.impact + 0.17); snap('after', b0.impact + 0.45); snap('rook', rk0.impact + 0.2);
      return out; }""")
    import base64, os
    os.makedirs('/tmp/claude-0/scr/frames3', exist_ok=True)
    for k, d in r['frames'].items(): open('/tmp/claude-0/scr/frames3/' + k + '.png', 'wb').write(base64.b64decode(d.split(',')[1]))
    check(r["script"]["winner"] == "Lelex" and r["script"]["mate"] and r["script"]["king"] == "e8", "outro : vrai vainqueur « %s GAGNE PAR ÉCHEC ET MAT », roi maté %s" % (r["script"]["winner"].upper(), r["script"]["king"]))
    check(not r["script"]["flip3d"] and not r["auto"]["flip3d"] and r["twists"] == 0 and r["auto"]["twistEvents"] == 0, "pas de retournement du plateau hors ChatGPT Prime (même si le script le demande)")
    check(r["script"]["prompts"] == 0 and r["auto"]["prompts"] == 0, "pas d'overlay « Quel est ton prochain coup » pour Lelex / Naskolit")
    check(r["script"]["red"] == 0 and r["auto"]["red"] == 0 and all(k == "blunder" or m for k, m in r["auto"]["redTones"]), "rouge réservé aux gaffes et au mat (RED_PATH / RED_TINT ignorés ailleurs) : tons %s" % r["auto"]["tones"])
    check(r["crowns"], "couronne verte du vainqueur + badge # rouge sur le roi maté")
    check(r["rook"]["big"] and all(p in (0.12, 0.25) for _, p, _ in r["rook"]["big"]) and any(abs(p - 0.12) < 1e-6 for _, p, _ in r["rook"]["big"]), "coups brillants / sacrifices : 120 ms d'anticipation : %s" % r["rook"]["big"])
    check(r["rook"]["tag"] == ["THE ROOK !"] and r["rook"]["rkLevel"] and r["rook"]["rkLevel"][0] <= 0.25, "THE ROOK : étiquette à l'écran + musique écrasée à %s pendant la voix" % r["rook"]["rkLevel"])
    check(len(r["rook"]["hawaii"]) <= 1, "Hawaii : au plus une fois par partie : %s" % r["rook"]["hawaii"])
    check(r["ripple"] and r["hitstop"], "cases qui tremblent autour de l'impact + hit-stop de 90 ms")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
