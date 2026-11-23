"""Bot Raph (co-fondateur de DualPulse) : 800 Elo détendu -> 1200 concentré s'il perd l'avantage -> E.N.O.S. apparaît dans son dos (phrase en voix v3),
transition oppressante, Raph devient E.N.O.S. (pleine puissance, mind games), « fish » se lance ; tout s'arrête en quittant la partie."""
from mobile_common import *
errs = []
SH = (os.environ.get("SHOTS") or "/tmp") + "/"
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs)
    pg.evaluate("""(() => { window.__voices = []; window.__aud = []; const A0 = window.Audio; window.Audio = function (src) { const a = new A0(src); (String(src).startsWith('blob:') ? window.__voices : window.__aud).push(src); a.play = () => Promise.resolve(); return a; }; })()""")
    open_tool(pg, "defis")
    check(pg.locator('#tool-defis [data-m="raph"]').count() >= 1, "Raph dans les Défis (Bots E.N.O.S.)")
    A = "document.querySelector('#tool-defis .suite-body')._api"
    pg.evaluate(A + ".launch('raph', {color: 'w'})")
    pg.wait_for_function("document.querySelector('#df-botchat .bot-av') && document.querySelector('#df-botchat .bot-t') && document.querySelector('#df-botchat .bot-t').textContent.length > 3", timeout=10000)
    check(pg.evaluate("document.querySelector('#df-botchat .bot-av').src.includes('raph.png')") and pg.evaluate(A + ".g.pl.b.elo") == 800, "phase 1 : Raph détendu, 800 Elo (« %s »)" % pg.inner_text("#df-botchat .bot-t"))
    pg.screenshot(path=SH + "raph_1.png")
    # il perd l'avantage
    pg.evaluate("(() => { " + A + ".g.evalW = 160; " + A + ".raphCheck('b'); })()"); pg.wait_for_timeout(2500)
    check(pg.evaluate("document.querySelector('#df-botchat .bot-av').src.includes('raph2.png')") and pg.evaluate(A + ".g.pl.b.elo") == 1200, "phase 2 : Raph concentré, 1200 Elo (« %s »)" % pg.inner_text("#df-botchat .bot-t"))
    pg.screenshot(path=SH + "raph_2.png")
    # il est en train de perdre : E.N.O.S. dans son dos
    pg.evaluate("(() => { " + A + ".g.evalW = 520; " + A + ".raphCheck('b'); })()"); pg.wait_for_timeout(3000)
    t = pg.inner_text("#df-botchat .bot-t")
    check(pg.evaluate("document.querySelector('#df-botchat .bot-av').src.includes('raph3.png')") and "PUNIR" in t, "phase 3 : E.N.O.S. dans le dos de Raph : « %s »" % t)
    check(any("blob:" in x for x in pg.evaluate("window.__voices")), "sa phrase est dite (voix ElevenLabs v3)")
    pg.screenshot(path=SH + "raph_3.png")
    pg.wait_for_timeout(8500); pg.screenshot(path=SH + "raph_trans.png")
    check(pg.evaluate("document.documentElement.classList.contains('enosmode')"), "transition oppressante : l'ambiance devient terne et rouge")
    pg.wait_for_function("document.querySelector('#df-botchat .bot-t').textContent.includes('MOI')", timeout=12000)
    p = pg.evaluate(A + ".g.pl.b")
    check(p["name"] == "E.N.O.S." and p["power"] == 100 and p["talk"] == "enos", "Raph est devenu E.N.O.S. (pleine puissance) : « %s »" % pg.inner_text("#df-botchat .bot-t"))
    check(pg.evaluate("ENOS.mind.state() && ENOS.mind.state().I.id") == "enos", "mind games d'E.N.O.S. actifs")
    check(any("fish.mp3" in x for x in pg.evaluate("window.__aud")) and pg.evaluate("!!ENOS._fish"), "« fish » (ralenti) se lance")
    ok = pg.evaluate("""() => new Promise((res) => { const a = document.createElement('audio'); a.oncanplaythrough = () => res(a.duration); a.onerror = () => res(-1); a.src = 'audio/raph/fish.mp3'; a.load(); setTimeout(() => res(-2), 6000); })""")
    check(ok > 60, "fichier « fish » lisible (%.0f s)" % ok)
    pg.screenshot(path=SH + "raph_enos.png")
    pg.evaluate(A + ".g.evalW = 0"); pg.click("#b-res"); pg.click(".sheet button >> text=ABANDONNER"); pg.wait_for_timeout(1500)
    pg.evaluate("document.querySelector('#tool-defis .suite-body')._api.launch('nasko', {color: 'w'})"); pg.wait_for_timeout(1500)
    check(not pg.evaluate("document.documentElement.classList.contains('enosmode')") and not pg.evaluate("!!ENOS._fish"), "nouvelle partie : ambiance normale, musique coupée")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
