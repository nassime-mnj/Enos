"""Mind games d'E.N.O.S. (et Mittens) : il remarque la pièce que tu touches 3 fois, scelle une prédiction avant ton coup puis la révèle avec l'heure,
annonce le coup forcé, lit tes hésitations, se souvient de toi d'une partie à l'autre ; ses phrases fixes ont une voix (ElevenLabs)."""
from mobile_common import *
errs = []
SH = (os.environ.get("SHOTS") or "/tmp") + "/"
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs)
    pg.add_init_script("") if False else None
    pg.evaluate("""(() => { window.__voices = []; const A0 = window.Audio; window.Audio = function (src) { window.__voices.push(src); const a = new A0(src); a.play = () => Promise.resolve(); return a; }; })()""")
    open_tool(pg, "defis")
    A = "document.querySelector('#tool-defis .suite-body')._api"
    pg.evaluate(A + ".launch('enos', {color: 'w'})")
    pg.wait_for_function("document.querySelector('#df-botchat .bot-t') && document.querySelector('#df-botchat .bot-t').textContent.length > 8", timeout=8000)
    check(pg.evaluate("ENOS.mind.state() && ENOS.mind.state().I.id") == "enos", "E.N.O.S. : mind games actifs (accueil : « %s »)" % pg.inner_text("#df-botchat .bot-t"))
    pg.wait_for_function("ENOS.mind.state() && ENOS.mind.state().cands && ENOS.mind.state().cands.length > 0", timeout=20000)
    c = pg.evaluate("ENOS.mind.state().cands.map(x => [x.san, +x.p.toFixed(2)])")
    check(len(c) >= 3, "position de départ analysée de ton point de vue : %s" % c)
    # 1. la main : le même cavalier touché 3 fois
    pg.wait_for_timeout(2600)
    pg.evaluate("window.__r = Math.random; Math.random = () => 0.01")
    sq = pg.evaluate("ENOS.mind.state().cands[0].from")                     # la pièce du coup le plus probable : ni « pas celle-là » ni « je savais »
    for i in range(3): pg.click('#df-board [data-sq="%s"]' % sq); pg.wait_for_timeout(150)
    pg.wait_for_function("[...document.querySelectorAll('#df-botchat .bot-m.b')].some(x => x.textContent.includes('3 fois'))", timeout=15000)
    t = [x for x in pg.evaluate("[...document.querySelectorAll('#df-botchat .bot-m.b')].map(x => x.textContent)") if "3 fois" in x][0]
    check(sq in t, "pièce touchée 3 fois : « %s »" % t)
    pg.screenshot(path=SH + "mind_touch.png")
    pg.evaluate("(() => { window.__said = []; const o = ENOS.botChat.onSay; ENOS.botChat.onSay = (...a) => { window.__said.push(a[1]); if (o) o(...a); }; })()")
    LOG = "window.__said"                                                           # l'historique affiché garde 40 messages : on compte à part
    idle = lambda: pg.evaluate("(async () => { const I = %s.g.talk.b; for (let i = 0; i < 40 && (I.pending || 0) > 0; i++) await new Promise(r => setTimeout(r, 250)); return I.pending || 0; })()" % A)
    def new_lines(n0, want=1, timeout=12000):
        pg.wait_for_function("(n) => %s.length >= n" % LOG, arg=n0 + want, timeout=timeout); return pg.evaluate(LOG)[n0:]
    idle()
    # 2. prédiction scellée puis révélée (analyse simulée : 1.e4 d5 2.exd5, la reprise Dxd5 est le réflexe humain)
    n0 = len(pg.evaluate(LOG))
    pg.evaluate("""(() => { const I = %s.g.talk.b, fen = 'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2';
      window.__g = { fen, ch: new Chess(fen), moves: [{ uci: 'e2e4' }, { uci: 'd7d5' }, { uci: 'e4d5' }], over: '', clk: null, pl: { w: {}, b: { human: true } }, me: 'b' };
      window.__an = ENOS.chessLocal.analyse; ENOS.chessLocal.analyse = async () => ({ best: 'd8d5', lines: [{ uci: 'd8d5', cp: 0, pv: ['d8d5', 'b1c3', 'd5a5'] }, { uci: 'g8f6', cp: -150 }, { uci: 'c7c6', cp: -210 }] });
      ENOS.mind.humanTurn(window.__g, I); })()""" % A)
    t1 = new_lines(n0)[0]; pr = pg.evaluate("ENOS.mind.state().pred")
    check(pr and pr["san"] == "Qxd5" and t1 in pg.evaluate("window.ENOS_BOT_LINES.enos.predict"), "prédiction scellée AVANT le coup (%s à %s) : « %s »" % (pr and pr["san"], pr and pr["at"], t1))
    n0 = len(pg.evaluate(LOG)); pg.evaluate("ENOS.mind.humanMoved(window.__g, 'd8d5', 'Qxd5')")
    t2 = new_lines(n0)[0]
    check(t2 in pg.evaluate("window.ENOS_BOT_LINES.enos.predict_hit.map(x => x.replace('{san}', 'Dxd5').replace('{time}', %s))" % repr(pr["at"])), "révélation : « %s »" % t2)
    check(pg.evaluate("ENOS.mind.state().hits") == 1, "prédiction comptée juste"); idle()
    # 3. coup forcé (la dame blanche vient de prendre en d8 avec échec : Rxd8 est le seul coup)
    n0 = len(pg.evaluate(LOG))
    pg.evaluate("""(() => { const I = %s.g.talk.b, fen = 'rnbQkbnr/ppp2ppp/8/4p3/4P3/8/PPP2PPP/RNB1KBNR b KQkq - 0 4';
      window.__g = { fen, ch: new Chess(fen), moves: [{ uci: 'e2e4' }, { uci: 'e7e5' }, { uci: 'd2d4' }, { uci: 'd7d5' }, { uci: 'd1d8' }], over: '', clk: null, pl: {}, me: 'b' };
      ENOS.chessLocal.analyse = async () => ({ best: 'e8d8', lines: [{ uci: 'e8d8', cp: 0 }] }); ENOS.mind.humanTurn(window.__g, I); })()""" % A)
    t3 = new_lines(n0)[0]
    check(t3 in pg.evaluate("window.ENOS_BOT_LINES.enos.forced"), "coup forcé : « %s »" % t3); idle()
    # 4. hésitation entre deux coups (minuteur raccourci) : il nomme les deux coups
    n0 = len(pg.evaluate(LOG))
    pg.evaluate("""(() => { const I = %s.g.talk.b, fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
      window.__g = { fen, ch: new Chess(fen), moves: [{ uci: 'e2e4' }], over: '', clk: null, pl: {}, me: 'b' };
      ENOS.chessLocal.analyse = async () => ({ best: 'e7e5', lines: [{ uci: 'e7e5', cp: -20 }, { uci: 'c7c5', cp: -25 }, { uci: 'e7e6', cp: -40 }, { uci: 'g7g5', cp: -250 }] });
      const st0 = window.setTimeout; window.setTimeout = (f, ms, ...a) => st0(f, ms >= 12000 && ms < 30000 ? 300 : ms, ...a); ENOS.mind.humanTurn(window.__g, I).then(() => { window.setTimeout = st0; }); })()""" % A)
    pg.wait_for_function("(n) => %s.slice(n).some(x => x.includes('e5') && x.includes('c5'))" % LOG, arg=n0, timeout=20000)
    t4 = [x for x in pg.evaluate(LOG)[n0:] if "e5" in x and "c5" in x][0]
    check(True, "hésitation : « %s »" % t4); idle()
    pg.evaluate("ENOS.mind.start(%s.g, %s.g.talk.b)" % (A, A))                  # retour à la vraie partie
    # 5. voix : les phrases fixes d'E.N.O.S. sont enregistrées et jouées
    nv = pg.evaluate("Object.keys((window.ENOS_VOICE || {}).enos || {}).length")
    v = pg.evaluate("window.__voices")
    check(nv >= 150 and any(x.startswith("blob:") for x in v), "voix d'E.N.O.S. : %d phrases enregistrées, jouées pendant le test : %d" % (nv, len(v)))
    ok = pg.evaluate("""(src) => new Promise((res) => { const a = document.createElement('audio'); a.oncanplaythrough = () => res(a.duration); a.onerror = () => res(-1); a.src = src; a.load(); setTimeout(() => res(-2), 5000); })""", [x for x in v if x.startswith("blob:")][0])
    check(ok > 0.5, "fichier voix lisible (%.1f s)" % ok)
    # 5b. CHESS EDIT d'une partie contre E.N.O.S. : sa phrase du moment choquant revient avec sa voix, ralentie + grande reverb
    ed = pg.evaluate("""async () => { try {
      const SAN = 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#'.split(' '), BR = [17, 24, 30];
      const ch = new Chess(), mv = []; SAN.forEach((s, i) => { const m = ch.move(s); mv.push([m.from + m.to + (m.promotion || ''), m.san, BR.includes(i) ? 'brilliant' : 'good', 3, null, '', '']); });
      const txt = "Tu viens de jouer exactement ce que j'avais écrit.", voice = ENOS.botVoice.name('enos', txt);
      const rec = { t: 12, title: 'x', result: 'Les Blancs gagnent par mat', plies: mv.length, brill: BR.length, pw: 'Toi', pb: 'E.N.O.S.', pk: ['human', 'bot'], me: 'w', ch: [[18, 'enos', txt, 'predict_hit', voice]], mv };
      const M = ENOS.editMap, pl = M.gamePlies(rec), tl = M.buildViral(pl, rec, null, { voices: true, intro: false, keepTwist: true, syncDrop: false, synth: true, opening: '' });
      const bv = tl.sfx.filter((x) => /^bv:/.test(x.id));
      const oc = new OfflineAudioContext(2, 48000 * 4, 48000), P = new ENOS.editSfx.Player(oc); await P.load(); const nb = await P.loadBot(tl.sfx);
      const out = await ENOS.editExport.mix(tl, null), d = out.getChannelData(0), t0 = Math.floor((bv[0] ? bv[0].t : 0) * 48000); let e = 0; for (let i = t0; i < Math.min(d.length, t0 + 48000 * 2); i++) e += d[i] * d[i];
      return { voice, bv: bv.map((x) => [x.t, x.bus, x.wet]), nb, rms: Math.sqrt(e / 96000), dur: tl.duration };
    } catch (e) { return { err: e.message + ' ' + (e.stack || '').slice(0, 300) }; } }""")
    print("edit :", ed)
    check(not ed.get("err") and ed["bv"] and ed["bv"][0][1] == "voice" and ed["bv"][0][2] >= 2 and ed["nb"] == 1 and ed["rms"] > 0.01,
          "Chess Edit : voix d'E.N.O.S. au moment choquant, ralentie + reverb (t=%s s, niveau %.3f)" % (ed.get("bv") and ed["bv"][0][0], ed.get("rms") or 0))
    # 6. Mittens : ses propres répliques (pas les génériques)
    pg.evaluate("Math.random = window.__r; ENOS.chessLocal.analyse = window.__an")
    m = pg.evaluate("(window.ENOS_BOT_LINES.r_mittens.predict || []).join(' | ')")
    check("patte" in m or "chat" in m.lower(), "Mittens : répliques de chaton inquiétant (« %s »)" % m[:80])
    # 7. mémoire : abandon -> la prochaine partie s'en souvient
    pg.click("#b-res"); pg.click(".sheet button >> text=ABANDONNER"); pg.wait_for_timeout(800)
    prof = pg.evaluate("ENOS.settings.get('mind.profile.enos', null)")
    check(prof and prof["games"] == 1 and prof["losses"] == 1, "mémoire d'E.N.O.S. : %s partie(s), %s défaite(s)" % (prof and prof["games"], prof and prof["losses"]))
    pg.evaluate("Math.random = () => 0.01")
    pg.evaluate(A + ".launch('enos', {color: 'w'})")
    pg.wait_for_function("[...document.querySelectorAll('#df-botchat .bot-m.b')].some(x => /Partie numéro 2|défaite/.test(x.textContent))", timeout=15000)
    check(True, "nouvelle partie : « %s »" % pg.evaluate("[...document.querySelectorAll('#df-botchat .bot-m.b')].map(x => x.textContent).find(x => /Partie numéro 2|défaite/.test(x))"))
    pg.evaluate("Math.random = window.__r")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
