"""Thème ETO : application blanche, rayons azur, ciel nuageux, son thème musical ; sa pensée visible (idées, main hologramme, corbeille) ;
« Pourquoi ? » : les mains hologrammes rejouent la gaffe, la réponse et la suite, puis ramènent la partie avant la gaffe."""
from mobile_common import *
errs = []
SH = (os.environ.get("SHOTS") or "/tmp") + "/"
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs)
    pg.evaluate("""(() => { window.__aud = []; const A0 = window.Audio; window.Audio = function (src) { window.__aud.push(String(src)); const a = new A0(src); a.play = () => Promise.resolve(); return a; }; })()""")
    open_tool(pg, "defis"); A = "document.querySelector('#tool-defis .suite-body')._api"
    pg.evaluate(A + ".launch('brillant', {color: 'w'})"); pg.wait_for_timeout(2500)
    check(pg.evaluate("document.documentElement.classList.contains('etotheme')"), "thème ETO actif (blanc, rayons azur, nuages)")
    check(any("audio/eto/ost.mp3" in x for x in pg.evaluate("window.__aud")), "son thème musical se lance")
    check(pg.locator("#eto-mind").count() == 1 and pg.locator("#df-botchat canvas.bot-anim[data-bot='eto']").count() == 1, "portrait animé d'ETO + panneau « Pensée d'ETO »")
    pg.screenshot(path=SH + "eto_theme.png")
    pg.click('#df-board [data-sq="e2"]'); pg.click('#df-board [data-sq="e4"]')
    pg.wait_for_function("document.querySelectorAll('#eto-mind .em2-idea').length >= 2", timeout=30000)
    n0 = pg.locator("#eto-mind .em2-idea").count(); pg.wait_for_timeout(500); pg.screenshot(path=SH + "eto_think.png")
    pg.wait_for_function("document.querySelector('#eto-mind .em2-idea.keep')", timeout=40000)
    thrown = int(pg.inner_text("#eto-mind .em2-bin span"))
    check(thrown >= 1 and pg.locator("#eto-mind .em2-idea").count() == 1, "ses idées (%d) : la main en jette %d à la corbeille, il garde « %s »" % (n0, thrown, pg.inner_text("#eto-mind .em2-idea.keep b")))
    pg.wait_for_function("!document.querySelector('#tool-defis .suite-body')._api.g.busy", timeout=30000)
    # « Pourquoi ? » sur une gaffe : la dame blanche se jette en f5 (le fou c8 la prend)
    before = "rnbqkbnr/ppp2ppp/8/3pp3/4P3/5Q2/PPPP1PPP/RNB1KBNR w KQkq - 0 3"
    pg.evaluate("""(before) => { const c = new Chess(before); c.move({ from: 'f3', to: 'f5' }); const B = ENOS.board, el = document.querySelector('#df-board');
      window.__caps = []; new MutationObserver(() => { const k = el.querySelector('.eh-cap'); if (k && k.textContent && window.__caps[window.__caps.length - 1] !== k.textContent) window.__caps.push(k.textContent); }).observe(el, { subtree: true, childList: true, characterData: true });
      window.__why = ENOS.etoWhy({ board: el, before, after: c.fen(), uci: 'f3f5', mover: 'w', render: (fen, last) => B.render(el, B.parse(fen).m, { last }) }).then(() => 'fini'); }""", before)
    pg.wait_for_function("document.querySelectorAll('#df-board .eh-hand.on').length === 2", timeout=10000)
    pg.wait_for_timeout(2600); pg.screenshot(path=SH + "eto_why.png")
    pg.wait_for_function("window.__caps.some(x => /retour|revient/i.test(x))", timeout=40000)
    caps = pg.evaluate("window.__caps")
    check(any("Tu joues" in x for x in caps) and any("Réponse" in x for x in caps), "« Pourquoi ? » : tes mains refont ton coup, puis sa réponse : %s" % " | ".join(caps[:4]))
    check(any("Bilan" in x or "mat" in x for x in caps), "les conséquences sont montrées (« %s »)" % [x for x in caps if "Bilan" in x or "mat" in x][:1])
    pg.wait_for_timeout(1500)
    check(pg.locator("#df-board .eh-hand").count() == 0, "les mains s'en vont")
    pg.click("#df-back"); pg.wait_for_timeout(500)
    check(not pg.evaluate("document.documentElement.classList.contains('etotheme')") and not pg.evaluate("!!ENOS._fish"), "en quittant : thème et musique coupés")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
