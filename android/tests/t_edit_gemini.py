"""Chess Edit : co-pilote Gemini (prompt + script JSON), cutscenes, flip 3D, physique des pièces, cadrage départ+arrivée, durée = dernier coup + 2 s."""
import base64, os
from mobile_common import *

OUT = os.environ.get("RENDER_OUT", "/tmp/claude-0/scr/frames2")
os.makedirs(OUT, exist_ok=True)
errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    ev = pg.evaluate
    rec = ev("""() => { const ch = new Chess(); const acts = []; const sans = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Nxd5', 'Nxf7', 'Kxf7', 'Qf3+', 'Ke6', 'Nc3', 'Nb4', 'd4', 'c6', 'Bb3', 'h6', 'O-O', 'Qf6', 'Qxd5+', 'cxd5'];
      sans.forEach((s, i) => { const m = ch.move(s); acts.push({ k: 'mv', side: m.color, seat: i % 2, key: i === 10 ? 'brilliant' : 'good', ev: null, from: m.from, to: m.to, piece: m.piece, cap: m.captured || '', promo: '', uci: m.from + m.to, san: m.san, fen: ch.fen(), cheat: '' }); });
      acts[22].say = 'Qxd5+ : évident, puisque la colonne d est une autoroute inutilisée.'; acts[22].cheat = '';
      return { variant: true, mode: 'prime', t: Date.now(), title: 'g', result: 'ChatGPT Prime gagne', plies: acts.length, pw: 'Toi', pb: 'ChatGPT Prime', me: 'w', ch: [], mv: acts.map((a) => [a.uci, a.san, a.key, 0, null, '']), v: { mode: 'prime', acts, start: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', over: 'end' } }; }""")
    r = ev("""(rec) => { const M = ENOS.editMap, pl = M.gamePlies(rec), prompt = M.geminiPrompt(rec, pl, 28.5);
      const script = { totalDuration: 28, intro: { start: 0, end: 3.8, style: 'SPLIT_VS_OR_CHESS_TUNNEL' }, events: [
        { moveIndex: 0, timestamp: 3.85, badge: 'BOOK', camera: { zoom: 1.35, tiltDeg: -5, shake: 0.3 }, vfx: ['NONE'] },
        { moveIndex: 2, timestamp: 4.4, badge: 'GOOD', camera: { zoom: 1.3, tiltDeg: 6, shake: 0.4 }, vfx: [] },
        { moveIndex: 6, timestamp: 5.6, badge: 'EXCELLENT', camera: { zoom: 1.4, tiltDeg: 8, shake: 0.5 }, vfx: ['YELLOW_ARROW'] },
        { moveIndex: 10, timestamp: 12.0, badge: 'BRILLIANT', camera: { zoom: 1.55, tiltDeg: 12, shake: 1.0 }, vfx: ['CYAN_HALF_BOARD_GLOW', 'SHOCKWAVE_DOUBLE', 'RGB_FLASH', 'CUTSCENE_BADASS_ROOK', 'PROMPT_STREAM'] },
        { moveIndex: 12, timestamp: 12.5, badge: 'GREAT', camera: { zoom: 1.5, tiltDeg: -8, shake: 0.8 }, vfx: ['CHECK_BEAM', 'RED_PATH'] },
        { moveIndex: 22, timestamp: 18.2, badge: 'BEST', camera: { zoom: 1.45, tiltDeg: 10, shake: 0.9 }, vfx: ['SPEED_LINES'] },
        { moveIndex: 23, timestamp: 18.8, badge: 'MISTAKE', camera: { zoom: 1.4, tiltDeg: -10, shake: 0.7 }, vfx: ['GLASSES'] } ], outro: { timestamp: 22.0, type: '3D_BOARD_FLIP_CHECKMATE' } };
      const txt = '```json\\n' + JSON.stringify(script) + '\\n```';
      const bad = M.parseScript('pas du json', pl.length), ok = M.parseScript(txt, pl.length), tl = M.buildFromScript(pl, rec, ok.script, { voices: true, intro: true });
      window.__tl = tl; window.__rec = rec; const mv = tl.events.filter((e) => e.from), last = mv[mv.length - 1], outro = tl.events.find((e) => e.kind === 'outro');
      return { promptOk: prompt.includes('0|e4|e2|e4|') && prompt.includes('DURÉE EXACTE DE L\\'AUDIO : 28.50 s') && prompt.includes('GeminiEdit') === false && prompt.includes('"moveIndex": 14'), plen: prompt.length, bad: bad.error, okEvents: ok.script && ok.script.events.length, impacts: mv.map((e) => [e.n, e.impact]), cam: mv.map((e) => e.cam && e.cam.zoom), kinds: [...new Set(tl.events.map((e) => e.kind))], flip3d: outro.flip3d, outroT: outro.t, dur: tl.duration, lastImpact: last.impact, drop: tl.stats.drop,
        flags: { glow: mv.some((e) => e.glow), shock2: mv.some((e) => e.shock2), strobe: mv.some((e) => e.strobe), arrow: mv.some((e) => e.arrow), redPath: mv.some((e) => e.redPath), speed: mv.some((e) => e.speed), glasses: mv.some((e) => e.glasses) }, badges: mv.map((e) => e.badge && e.badge.img) }; }""", rec)
    print({k: r[k] for k in ("plen", "okEvents", "kinds", "flip3d", "outroT", "dur", "lastImpact", "drop", "badges")})
    check(r["promptOk"] and r["plen"] > 1500, "prompt Gemini : coups numérotés (index|san|from|to|fen|eval|tag|bot), durée exacte de l'audio, schéma JSON (%d caractères)" % r["plen"])
    check("JSON" in r["bad"] and r["okEvents"] == 7, "script collé : erreur claire si invalide, ```json``` toléré (%s événements)" % r["okEvents"])
    check(all(abs(t - w) < 1e-6 for (n, t), w in zip(r["impacts"], [3.85, 4.4, 5.6, 12.0, 12.5, 18.2, 18.8])), "chaque coup tombe EXACTEMENT au timestamp du script : %s" % [round(t, 2) for n, t in r["impacts"]])
    check(abs(r["drop"] - 12.0) < 1e-6 and r["cam"][3] == 1.55, "le BRILLANT est le drop (12.00 s), caméra du script (zoom 1.55)")
    check(all(v for k, v in r["flags"].items() if k != "redPath") and not r["flags"]["redPath"], "vfx du script appliqués (RED_PATH ignoré hors gaffe) : %s" % r["flags"])
    check({"cutrook", "prompt"} & set(r["kinds"]) and r["flip3d"], "cutscene Badass Rook / prompt + outro 3D_BOARD_FLIP_CHECKMATE : %s" % r["kinds"])
    check(r["badges"][0] == "book" and "brilliant" in r["badges"] and "mistake" in r["badges"] and "excellent" in r["badges"], "badges du script : %s" % r["badges"])
    # --- rendu : cadrage, cutscenes, flip 3D, physique
    fr = ev("""async () => { const cv = document.createElement('canvas'); cv.width = 360; cv.height = 640; const R = new ENOS.editRender.Renderer(cv, window.__tl, { flip: false, rec: window.__rec }); await R.load(); window.__R = R;
      const t = window.__tl, mv = t.events.filter((e) => e.from), out = {}, T = {}; const hero = mv.find((e) => e.kind === 'drop'), ck = mv.find((e) => e.n === 13), cr = t.events.find((e) => e.kind === 'cutrook'), outro = t.events.find((e) => e.kind === 'outro');
      T.anticipation = mv[2].impact - 0.1; T.trail = mv[2].impact - 0.045; T.wobble = mv[2].impact + 0.04; T.glow = hero.impact + 0.25; T.dropimpact = hero.impact + 0.05; T.capture = mv.find((e) => e.captured).impact + 0.04; T.beam = ck.impact + 0.3;
      if (cr) T.cutrook = cr.t + cr.dur * 0.6; T.flip1 = outro.t + 0.35; T.flip2 = outro.t + 0.9; T.flip3 = outro.t + 1.45; T.crowns = outro.t + 1.8; T.end = outro.t + 3.0;
      const ph = (u) => Math.sin(u * 45) * Math.exp(-u * 12) * 0.25; const e0 = mv[2], pf = R.pieceFx(e0.impact + 0.02)[e0.to];
      const cam = mv.map((e) => { const c = R.camAt(e.impact + 0.3), A = R.sq(e.from, false), B = R.sq(e.to, false), vw = R.W / c.S, vh = R.H / c.S; return { S: c.S, vis: Math.abs(A.x - B.x) < vw * 0.95 && Math.abs(A.y - B.y) < vh * 0.95 }; });
      for (const [k, v] of Object.entries(T)) { R.draw(v); out[k] = cv.toDataURL('image/png'); }
      return { frames: out, wob: pf && Math.abs(pf.rot - ph(0.02)) < 1e-6 && Math.abs(pf.sx - (1.3 + (1 - 1.3) * ENOS.editRender.EASE.back(0.02 / 0.28))) < 1e-6, camS: cam.map((c) => c.S), camVis: cam.every((c) => c.vis), flipSw: R.flipAt(outro.t + 1.5) !== R.flipAt(outro.t + 1.3), twists: R.twists.length, hasCut: !!cr }; }""")
    for k, d in fr["frames"].items():
        open(os.path.join(OUT, k + ".png"), "wb").write(base64.b64decode(d.split(",")[1]))
    check(fr["wob"], "pendule d'atterrissage = sin(t·45)·exp(−t·12)·0,25 et pop ×1,30 → ×1,0 (easeOutBack)")
    check(max(fr["camS"]) <= 1.6 + 1e-6 and fr["camVis"], "cadrage : zoom ≤ ×1,60 (%.2f max), départ ET arrivée toujours visibles" % max(fr["camS"]))
    check(fr["flipSw"] and fr["twists"] == 1, "bascule 3D : le plateau se retourne à la fin de la rotation (flip logique unique)")
    check(abs(r["dur"] - (r["outroT"] + 1.8 + 1.8)) < 0.01, "durée = outro + bascule (pas de plateau figé) : %.1f s" % r["dur"])
    # durée = dernier coup + 2,0 s (sans flip 3D)
    d2 = ev("""() => { const M = ENOS.editMap, pl = M.gamePlies(window.__rec); const s = M.parseScript(JSON.stringify({ intro: { end: 3.8 }, events: [{ moveIndex: 0, timestamp: 3.85, badge: 'BOOK' }, { moveIndex: 9, timestamp: 9.0, badge: 'BRILLIANT' }, { moveIndex: 23, timestamp: 14.0, badge: 'BEST' }], outro: { timestamp: 14.2, type: 'FADE' } }), pl.length).script; const t = M.buildFromScript(pl, window.__rec, s, { intro: true }); const last = t.events.filter((e) => e.from).pop(); return [t.duration, last.impact]; }""")
    check(abs(d2[0] - d2[1] - 2.0) < 0.05, "la vidéo s'arrête 2,0 s après le dernier coup (%.2f → %.2f)" % (d2[1], d2[0]))
    # --- Prime battu : mise en scène de la défaite + flèche jaune unique + punch caméra sur les kicks + z-order
    lo = ev("""async () => { const P = ENOS.prime; const ch = new Chess(); const acts = []; const sans = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];
      sans.forEach((s, i) => { const m = ch.move(s); acts.push({ k: 'mv', side: m.color, seat: i % 2, key: 'good', ev: null, from: m.from, to: m.to, piece: m.piece, cap: m.captured || '', promo: '', uci: m.from + m.to, san: m.san, fen: ch.fen(), cheat: '', say: i % 2 ? 'Je joue ça car évident.' : '' }); });
      acts.push({ k: 'mv', side: 'w', seat: 0, key: 'good', ev: null, from: '', to: 'e8', piece: 'k', cap: '', promo: '', uci: 'twist', san: 'ChatGPT a gagné par checkmate ‼', fen: ch.fen(), cheat: 'twist', say: 'De quoi tu parles ?' });
      const rec = { variant: true, mode: 'prime', t: 5, title: 'b', result: 'Toi gagne', plies: acts.length, pw: 'Toi', pb: 'ChatGPT Prime', me: 'w', ch: [], mv: acts.map((a) => [a.uci, a.san, 'good', 0, null, '']), v: { mode: 'prime', acts, start: P.START, over: 'twist', beaten: true } };
      const M = ENOS.editMap, pl = M.gamePlies(rec), tl = M.buildViral(pl, rec, null, { voices: true, intro: true, synth: true }), tw = M.buildViral(pl, rec, null, { voices: true, intro: true, synth: true, keepTwist: true }), mv = tl.events.filter((e) => e.from && e.kind !== 'ff');
      const out = { loses: tl.primeLoses, twist: tl.events.some((e) => e.cheat === 'twist'), twKeep: tw.events.some((e) => e.cheat === 'twist'), panic: mv.filter((e) => e.panic).map((e) => e.lines[0].text), arrows: mv.filter((e) => e.arrow).map((e) => e.san), defeat: !!tl.events.find((e) => e.kind === 'outro').defeat, voice: tl.sfx.filter((x) => x.bus === 'voice').map((x) => x.id), echo: tl.sfx.filter((x) => x.bus === 'echo').length, layers: ['thud', 'crystal', 'mateboom'].map((id) => tl.sfx.some((x) => x.id === id) || (window.__tl && window.__tl.sfx.some((x) => x.id === id))), gain: Math.max(...tl.sfx.filter((x) => x.bus === 'echo').map((x) => x.gain)) };
      const cv = document.createElement('canvas'); cv.width = 270; cv.height = 480; const R = new ENOS.editRender.Renderer(cv, tl, {}); await R.load(); const ks = mv.filter((e) => e.impact >= tl.stats.drop && !e.soft), k0 = ks[1] || ks[0]; R.draw(k0.impact + 0.016); const a1 = R._S; R.draw(k0.impact + 0.3); const a2 = R._S; out.punch = [a1, a2];
      R.draw(mv[mv.length - 1].impact + 0.4); out.endFrame = true; return out; }""")
    check(lo["loses"] and not lo["twist"] and lo["twKeep"], "Prime battu : le plot twist est retiré (et gardé si la case est cochée)")
    check(len(lo["panic"]) == 3 and any("404" in t or "500" in t for t in lo["panic"]), "3 derniers coups : Prime panique (texte rouge tremblant, excuses d'erreur serveur) : %s" % lo["panic"][:2])
    check(len(lo["arrows"]) == 1 and lo["arrows"][0].endswith("#") and lo["defeat"], "flèche jaune UNIQUE sur le mat final (%s) + écran de défaite 404 ELO NOT FOUND" % lo["arrows"])
    check(lo["punch"][0] - lo["punch"][1] >= 0.15, "punch caméra : zoom +0,22 au kick puis retombée exponentielle (%.3f → %.3f)" % tuple(lo["punch"]))
    check(all(lo["layers"]) and lo["echo"] >= 7 and lo["gain"] >= 1.35 and "this_is_the_way" in lo["voice"], "mixage : bruitages lourds avec écho à gain 1,35 (+3 dB), couches bois / cristal / explosion, voix « This is the way » sur le mat : %s" % lo["layers"])
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
