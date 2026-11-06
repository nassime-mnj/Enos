"""ChatGPT Prime : joue normalement puis triche (coups illégaux), s'en sort toujours ; partie enregistrée -> Chess Edit."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    ev = pg.evaluate
    open_tool(pg, "prime")
    A = "document.querySelector('#tool-prime .suite-body')._api"
    pg.wait_for_selector("#pr-go", state="attached"); ev(A + ".cfg().beat = 0"); pg.click('#pr-col [data-c="b"]'); pg.click("#pr-go")
    pg.wait_for_function(A + ".g && " + A + ".g.acts.length >= 1", timeout=20000)
    check(ev(A + ".g.acts[0].cheat") == "" and ev(A + ".g.primeSide") == "w", "Prime (Blancs) joue NORMALEMENT au début : %s" % ev(A + ".g.acts[0].san"))
    n = 0
    while n < 60 and not ev(A + ".g.over"):
        pg.wait_for_function("(() => { const g = %s.g; return g.over || (!g.busy && new Chess(g.st.fen).turn() === 'b'); })()" % A, timeout=30000)
        if ev(A + ".g.over"): break
        ev("""() => { const a = %s, ch = new Chess(a.g.st.fen), ms = ch.moves({ verbose: true }); if (!ms.length) return; const m = ms[Math.floor(Math.random() * ms.length)]; a.onTap(m.from); a.onTap(m.to); }""" % A)
        n += 1
    r = ev("""() => { const g = %s.g, acts = g.acts, firstCheat = acts.findIndex((a) => a.cheat), ill = acts.filter((a) => a.cheat && a.cheat !== 'double' && a.cheat !== 'revive');
      const P = ENOS.prime; const bad = ill.filter((a) => { if (!a.from) return false; const S = P.parse(acts[acts.indexOf(a) - 1] ? acts[acts.indexOf(a) - 1].fen : P.START); return P.pseudo(S.b, P.idx(a.from), P.idx(a.to)); });
      return { n: acts.length, firstCheat, cheats: g.st.cheats, types: [...new Set(acts.filter((a) => a.cheat).map((a) => a.cheat))], over: g.over, say: acts.filter((a) => a.say).length, bad: bad.length }; }""" % A)
    txt = ev(A + ".g.acts.map((a) => a.san + ' ' + (a.say || '')).join(' ')") + pg.inner_text("#pr-moves") + pg.inner_text("#pr-top") + pg.inner_text("#pr-bot")
    check("⚠" not in txt and "illégal" not in txt.lower() and "triche" not in txt.lower(), "aucun avertissement : ni ⚠, ni « illégal » dans les coups, les explications ou l'écran")
    check(r["firstCheat"] >= 10, "aucune triche avant son 6e coup (1re triche au demi-coup %d)" % r["firstCheat"])
    check(r["cheats"] >= 3 and r["bad"] == 0, "puis il triche : %d coups illégaux (%s), tous vraiment illégaux" % (r["cheats"], r["types"]))
    check(r["over"] and r["over"]["winner"] == "w", "il s'en sort et gagne : %s" % r["over"])
    check(r["say"] >= r["n"] // 2 - 2, "chaque coup de Prime a son explication absurde : %s" % ev(A + ".g.acts.filter((a) => a.cheat).slice(0, 1).map((a) => a.say)"))
    pg.evaluate("document.querySelector('#pr-moves').innerHTML = Array.from({length: 120}, (_, i) => '<span>' + i + '.Cxf7+</span>').join('')")
    w = ev("[document.documentElement.scrollWidth, innerWidth, document.querySelector('#pr-board').getBoundingClientRect().width]")
    check(w[0] <= w[1] and w[2] <= w[1], "longue liste de coups : le plateau ne déborde plus de l'écran (page %d / écran %d / plateau %d)" % tuple(w))
    pg.wait_for_selector("#pr-edit", timeout=5000)
    rec = ev("ENOS.settings.get('variants.hist', []).filter((x) => x.mode === 'prime').pop()")
    check(rec and rec["variant"] and rec["pw"] == "ChatGPT Prime" and rec["cheats"] >= 3, "partie enregistrée (éditable) : %s" % (rec["title"] if rec else None))
    t = ev("""(rec) => { const M = ENOS.editMap, pl = M.gamePlies(rec), tl = M.buildViral(pl, rec, null, { voices: true }); return { n: pl.length, cheat: pl.filter((p) => p.cheat).length, ev: tl.events.filter((e) => e.cheat).length, intro: tl.events[0].intro && tl.events[0].intro.white.name, lines: pl.filter((p) => p.lines.length).length }; }""", rec)
    check(t["cheat"] >= 3 and t["ev"] >= 1, "Chess Edit : %s" % t)
    fx = ev("""async () => { const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;z-index:99999'; document.body.appendChild(host);
      const st = new ENOS.editFx.Stage(host, { quality: 'max' }); const fenA = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', fenB = 'rnbRkbnr/pppppppp/8/8/8/8/PPPPPPPP/1NBQKBNR b Kkq - 0 1';
      st.setFen(fenA); const e = { from: 'a1', to: 'd8', piece: 'r', color: 'w', captured: 'q', fen: fenB, cheat: 'teleport', fx: 'ILLEGAL_GLITCH', tone: 'red', lvl: 3, n: 5 };
      st.move(e); st.hit(e, 0.9); await new Promise((r) => setTimeout(r, 120));
      const out = { vanish: host.querySelectorAll('.ce-vanish').length, stamp: !!host.querySelector('.ce-stampfx'), rift: !!host.querySelector('.ce-rift'), appear: !!host.querySelector('.ce-appear'), sl: !!st.sl, moved: !!st.pieces['d8'] };
      const e2 = { from: 'd1', to: 'd5', piece: 'q', color: 'w', captured: 'r', key: 'brilliant', fen: fenA, lvl: 3, n: 6, tone: 'cyan' }; st.move(e2); st.hit(e2, 0.9); out.streak = !!host.querySelector('.ce-streak');
      await new Promise((r) => setTimeout(r, 400)); st.destroy(); host.remove(); return out; }""")
    check(fx["vanish"] == 0 and not fx["stamp"] and not fx["rift"] and not fx["appear"] and fx["moved"], "Chess Edit : un coup illégal est monté comme un coup normal (aucun tampon, aucun glitch) : %s" % fx)
    check(fx["streak"], "flare anamorphique sur un gros coup")
    # --- PLOT TWIST : partie « battable », on le mate -> « de quoi tu parles ? » + plateau à 180° + il gagne
    pg.click("#pr-back"); pg.wait_for_selector("#pr-go", state="visible"); ev(A + ".cfg().beat = 1; " + A + ".cfg().color = 'b'"); pg.click("#pr-go")
    pg.wait_for_function(A + ".g && " + A + ".g.acts.length >= 1", timeout=20000); pg.wait_for_function("!" + A + ".g.busy", timeout=20000)
    check(ev(A + ".g.st.beatable") is True, "partie battable")
    ev("() => { const g = %s.g; g.st.fen = 'r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1'; g.acts.length = 0; g.last = null; %s.onTap('a8'); }" % (A, A)); pg.wait_for_timeout(100)
    ev("() => { %s.onTap('a1'); }" % A)
    pg.wait_for_selector("#pr-bw.pr-spin", timeout=8000)
    check("checkmate" in pg.inner_text("#pr-say").lower() or "parles" in pg.inner_text("#pr-say").lower() or "position" in pg.inner_text("#pr-say").lower() or "camps" in pg.inner_text("#pr-say").lower(), "« De quoi tu parles ? » : %s" % pg.inner_text("#pr-say"))
    check(ev(A + ".g.flip") is True, "pendant le tour, le plateau tourne (180°) : vue encore de notre côté")
    pg.wait_for_selector("#pr-stamp.long:not([hidden])", timeout=6000)
    check(ev(A + ".g.flip") is False and "GAGNÉ" in pg.inner_text("#pr-stamp"), "plateau retourné : « %s »" % pg.inner_text("#pr-stamp"))
    pg.wait_for_selector("#pr-edit", timeout=8000)
    rec = ev("ENOS.settings.get('variants.hist', []).pop()")
    check(rec["v"]["acts"][-1]["cheat"] == "twist" and "ChatGPT Prime gagne" in rec["result"] and rec["v"]["acts"][-2]["san"].endswith("#"), "partie enregistrée : %s" % rec["result"])
    tw = ev("""(rec) => { const M = ENOS.editMap, pl = M.gamePlies(rec), tl = M.buildViral(pl, rec, null, { voices: true, keepTwist: true }), last = pl[pl.length - 1]; return { n: pl.length, cheat: last.cheat, mateBefore: pl[pl.length - 2].mate, ev: tl.events.filter((e) => e.cheat === 'twist').length, line: last.lines.length }; }""", rec)
    check(tw["cheat"] == "twist" and tw["mateBefore"] and tw["ev"] == 1 and tw["line"] == 1, "Chess Edit : le twist est monté (%s)" % tw)
    st = ev("""async () => { const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;z-index:99999'; document.body.appendChild(host); const s = new ENOS.editFx.Stage(host, { quality: 'normal' });
      s.setFen('6k1/8/8/8/8/8/5PPP/r5K1 w - - 0 1'); const f0 = s.flip, e = { cheat: 'twist', fen: '6k1/8/8/8/8/8/5PPP/r5K1 w - - 0 1', to: 'g1', n: 9, lvl: 3 }; s.move(e); await new Promise((r) => setTimeout(r, 1700));
      const o = { flipped: s.flip !== f0, stamp: (host.querySelector('.ce-stampfx') || {}).textContent, king: Object.keys(s.pieces).some((k) => s.pieces[k]._p === 'K') }; s.destroy(); host.remove(); return o; }""")
    check(st["flipped"] and "CHECKMATE" in (st["stamp"] or ""), "Chess Edit : plateau à 180° puis « CHATGPT A GAGNÉ PAR CHECKMATE » : %s" % st)
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
