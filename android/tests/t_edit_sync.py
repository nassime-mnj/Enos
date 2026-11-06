"""Chess Edit : hard-sync (impacts sur les kicks), intro face-off 0,5 s, effets signatures (chemin rouge, boss, prompt, strobe, badges IA, flèche, reality check)."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    ev = pg.evaluate
    rec = ev("""async () => { const P = ENOS.prime, st = P.newState(true, false); let n = 0;
      while (!st.over && n < 80) { const ch = new Chess(st.fen);
        if (ch.turn() === 'w') { const r = await P.turn(st, {}); r.acts.forEach((a) => st.acts.push(a)); if (r.over) break; }
        else { const ms = ch.moves({ verbose: true }); if (!ms.length) break; const m = ms[Math.floor(Math.random() * ms.length)]; ch.move(m); st.acts.push({ k: 'mv', side: 'b', seat: 1, key: 'good', ev: null, from: m.from, to: m.to, piece: m.piece, cap: m.captured || '', promo: '', uci: m.from + m.to, san: m.san, fen: ch.fen(), cheat: '' }); st.fen = ch.fen(); }
        n++; }
      const acts = st.acts; return { variant: true, mode: 'prime', t: Date.now(), title: 't', result: 'ChatGPT Prime gagne', plies: acts.length, pw: 'ChatGPT Prime', pb: 'Toi', me: 'b', ch: [], mv: acts.map((a) => [a.uci, a.san, 'good', 0, null, '']), v: { mode: 'prime', acts, start: P.START, over: 'kill' } }; }""")
    audio = {"duration": 40, "mainDropTimestamp": 12.0, "dropTime": 12.0, "confidence": 1, "introBeats": [round(0.7 + 0.5 * k, 3) for k in range(22)], "hardBeats": [round(12.3 + 0.25 * k, 3) for k in range(60)], "hats": [round(0.9 + 0.25 * k, 3) for k in range(40)], "vocalPeaks": [], "buildUpStart": 8, "preDropSilence": 11.5}
    tl = ev("""([rec, audio]) => { const M = ENOS.editMap, pl = M.gamePlies(rec), t = M.buildViral(pl, rec, audio, { voices: true, intro: true, syncDrop: true }); const evs = t.events, hero = evs.find((e) => e.kind === 'drop');
      const moves = evs.filter((e) => e.from || e.drop), kinds = [...new Set(evs.map((e) => e.kind))];
      return { sync: !!t.sync, n: pl.length, kinds, heroImpact: hero && hero.impact, durs: [...new Set(moves.map((e) => e.dur))], firstMove: Math.min(...moves.map((e) => e.impact)), minGapPre: Math.min(...moves.filter((e) => e.kind === 'crit' && e.impact < 12).map((e) => e.impact).sort((a, b) => a - b).map((v, i, a) => (i ? v - a[i - 1] : 9))),
        strobes: moves.filter((e) => e.strobe).length, texts: moves.filter((e) => e.text).length, prompt: evs.filter((e) => e.kind === 'prompt' || e.kind === 'cut3').map((e) => [e.kind, e.t]), intro: evs.filter((e) => e.kind === 'intro').map((e) => e.dur), setup: evs.filter((e) => e.kind === 'setup').length,
        outro: evs.filter((e) => e.kind === 'outro').map((e) => !!e.final), illegal: moves.filter((e) => e.illegal).length, glasses: moves.filter((e) => e.glasses).length, ai: moves.filter((e) => e.aiImg).length, arrow: moves.filter((e) => e.arrow).length, red: moves.filter((e) => e.redPath).length, boss: moves.filter((e) => e.boss).length,
        sfxOnImpact: moves.filter((e) => e.kind !== 'ff').every((e) => t.sfx.some((x) => Math.abs(x.t - e.impact) < 0.001 && (x.id === 'move' || x.id === 'capture' || x.id === 'check' || x.id === 'mate'))), skipped: t.stats.skipped, snaps: moves.filter((e) => e.snap).length, ids: moves.map((e) => e.impact), tHero: hero && hero.t }; }""", [rec, audio])
    check(tl["sync"] and "setup" in tl["kinds"] and tl["intro"] == [3.8] and tl["setup"] == 1, "montage hard-sync : plateau dès 0,0 s (setup) + intro VS de 3,8 s : %s" % tl["kinds"])
    check(abs(tl["heroImpact"] - 12.0) < 0.001, "le coup clé tombe EXACTEMENT sur le drop (%.3f s)" % tl["heroImpact"])
    check(set(tl["durs"]) <= {90, 60, 240} and tl["firstMove"] >= 3.8, "glissement doux de 240 ms pendant l'intro, 90 ms sur le drop ; le 1er coup après l'intro (%.2f s)" % tl["firstMove"])
    check(tl["minGapPre"] >= 1.05, "avant le drop : coups lents et lisibles, ≥ 1,1 s d'écart (%.2f)" % tl["minGapPre"])
    check(1 <= tl["strobes"] <= 4, "flash RGB sur les 3-4 kicks les plus violents (%d)" % tl["strobes"])
    check(tl["texts"] == 0, "aucun texte « QUEEN DOWN / IT'S OVER »")
    check(tl["outro"] == [True] or tl["outro"] == [False], "outro prévue (reality check si le bot a une réplique)")
    check(tl["sfxOnImpact"], "chaque son de coup est calé sur l'impact, à la milliseconde")
    check(tl["illegal"] >= 1 and tl["ai"] >= 1 and tl["arrow"] <= 1 and tl["red"] >= 1, "effets de triche : badges IA / ✖, UNE seule flèche jaune, chemin rouge : %s" % {k: tl[k] for k in ("illegal", "glasses", "ai", "arrow", "red", "boss")})
    print("prompt/cut3:", tl["prompt"], "skipped:", tl["skipped"], "snaps:", tl["snaps"])
    # --- effets de scène
    fx = ev("""async () => { const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;z-index:99999'; document.body.appendChild(host); const s = new ENOS.editFx.Stage(host, { quality: 'max' });
      const fenA = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'; s.setFen(fenA); const o = {};
      s.faceoff({ white: { name: 'Toi', human: true }, black: { name: 'ChatGPT Prime', img: 'img/bots/prime.png', elo: 9999 } }, 500); o.fo = !!host.querySelector('.fo-vs') && host.querySelectorAll('.fo-p').length === 2 && host.textContent.includes('9999');
      s.redPath('a1', 'a5', 'r', 900); o.path = host.querySelectorAll('.ce-path').length; s.beam('a1', 'e1'); o.beam = !!host.querySelector('.ce-beam'); s.arrow('b1', 'c3', 800); o.arrow = !!host.querySelector('.ce-arr');
      s.badges('d4', [{ img: 'img/badges/miss.png', color: '#f33' }, { img: 'img/bots/gpt.png', color: '#fff', ai: true }], 800); o.badges = host.querySelectorAll('.ce-badge2.hb').length; o.brk = !!host.querySelector('.ce-brk'); o.ring = host.querySelectorAll('.ce-ring2').length; s.glasses('d4', 800); o.gl = !!host.querySelector('.ce-gl');
      s.promptCut('Après axc5, comme le dit la théorie fibonaccienne…', 'q', 600); o.prompt = !!host.querySelector('.ce-prompt .pa'); s.strobe(); o.grid = !!host.querySelector('.ce-rgbgrid'); o.chroma = s.chroma >= 25;
      s.bossPiece({ from: 'd1' }); const q = s.pieces['d1']; o.boss = !!q && q.getAnimations().length > 0; s.kingTilt('e1'); o.tilt = s.pieces['e1'].getAnimations().length > 0;
      s.reality('Tu confonds les camps.', 'prime'); o.reality = s.look === 'classic' && host.classList.contains('ce-reality');
      await new Promise((r) => setTimeout(r, 120)); o.pcs = s.pcs.querySelector('img').src.startsWith('data:') || s.pcs.querySelector('img').src.includes('.png'); s.destroy(); host.remove(); return o; }""")
    check(fx["fo"], "intro face-off : 2 avatars + VS + Elo")
    check(fx["path"] >= 5 and fx["beam"] and fx["arrow"], "chemin rouge (%d cases), rayon d'échec, flèche jaune" % fx["path"])
    check(fx["badges"] == 2 and fx["brk"] and fx["ring"] == 2 and fx["gl"], "badges ✖/IA côte à côte + double onde + cadre de visée + lunettes")
    check(fx["prompt"] and fx["grid"] and fx["chroma"], "cutscene prompt & streaming, flash RGB grid blur")
    check(fx["boss"] and fx["tilt"], "pièce géante rouge + roi qui bascule (animations sur leur propre centre)")
    check(fx["reality"], "reality check : plateau vert et blanc classiques")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
