"""Chat box des bots Nasko / Lelex : illustration, bulle de parole, historique, réponse à un message, fin de partie."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    open_tool(pg, "defis")
    A = "document.querySelector('#tool-defis .suite-body')._api"
    for bot, color in (("nasko", "w"), ("lelex", "b")):
        pg.evaluate(A + ".launch('%s', {color: '%s'})" % (bot, color))
        pg.wait_for_selector("#df-botchat .bot-av")
        check(pg.evaluate("document.querySelector('#df-botchat .bot-av').complete && document.querySelector('#df-botchat .bot-av').naturalWidth > 100"), "%s : illustration chargée" % bot)
        pg.wait_for_function("document.querySelector('#df-botchat .bot-t') && document.querySelector('#df-botchat .bot-t').textContent.length > 8", timeout=5000)
        check(True, "%s : bulle de parole : « %s »" % (bot, pg.inner_text("#df-botchat .bot-t")))
        check(pg.locator("#df-botchat .bot-m.b").count() >= 1, "%s : message dans l'historique" % bot)
    # écrire au bot (sans clé Groq : réponse écrite à la main)
    pg.click("#df-botchat .bot-chatbtn")
    check(pg.is_visible("#df-botchat .bot-log"), "messagerie ouverte")
    pg.fill("#df-botchat .bot-in input", "gg tu joues mal non ?")
    pg.press("#df-botchat .bot-in input", "Enter")
    pg.wait_for_function("document.querySelectorAll('#df-botchat .bot-m.b').length >= 2", timeout=6000)
    check(pg.locator("#df-botchat .bot-m.u").count() == 1, "mon message affiché, le bot répond : « %s »" % pg.locator("#df-botchat .bot-m.b").last.inner_text())
    pg.screenshot(path="/tmp/claude-0/botchat.png")
    # fin de partie : abandon -> réplique
    pg.keyboard.press("Escape") if False else None
    pg.click("#b-res"); pg.click(".sheet button >> text=ABANDONNER")
    pg.wait_for_function("document.querySelectorAll('#df-botchat .bot-m.b').length >= 3", timeout=6000)
    check(True, "réplique à la fin de partie")
    # --- Nasko pénoire (humain vs bot) : illustration + accueil
    pg.evaluate(A + ".launch('penoire', {color: 'w'})")
    pg.wait_for_function("document.querySelector('#df-botchat .bot-t') && document.querySelector('#df-botchat .bot-t').textContent.length > 8", timeout=5000)
    check(pg.evaluate("document.querySelector('#df-botchat .bot-av').src.includes('penoire.png') && document.querySelector('#df-botchat .bot-av').naturalWidth > 100"), "pénoire : illustration + bulle : « %s »" % pg.inner_text("#df-botchat .bot-t"))
    check(pg.evaluate(A + ".g.pl.b.elo") == 2500 and pg.evaluate(A + ".g.pl.b.kind") == "penoire", "pénoire : 2500 Elo, chasseur de brillants")
    # --- toutes les situations ont des répliques écrites pour chaque personnage principal
    need = "greet chat open_announce open_end open_refused good super check check_received bot_brilliant bot_blunder bot_mistake h_good h_brilliant h_blunder h_mistake frustration winning mate_coming mate_danger mate_win mate_lose draw resign_win reply_gg reply_insult reply_q reply".split()
    miss = pg.evaluate("(need) => ['nasko','penoire','lelex'].flatMap(id => need.filter(k => !((window.ENOS_BOT_LINES[id] || {})[k] || []).length).map(k => id + ':' + k))", need)
    check(not miss, "répliques écrites pour toutes les situations (Nasko, Pénoire, Lelex) : manque %s" % miss)
    pg.evaluate(A + ".launch('penoire', {color: 'w'})")
    ends = pg.evaluate("window.ENOS_BOT_LINES.penoire.mate_win.join('|')")
    check("rincé" in ends.lower() and "lavé" in ends.lower(), "pénoire vainqueur : « t'es rincé… » / « je t'ai lavé… »")
    # --- combat de bots : écran VS, deux bannières, transcript partagé
    pg.evaluate(A + ".launch('combat', {color: 'w', cw: 'nasko', cb: 'penoire'})")
    pg.wait_for_selector(".df-vs")
    check("Nasko" in pg.inner_text(".df-vs") and "pénoire" in pg.inner_text(".df-vs"), "écran VS : " + pg.inner_text(".df-vs").replace("\n", " ")[:70])
    pg.click(".df-vs")
    pg.wait_for_function("!document.querySelector('.df-vs')", timeout=3000)
    check(pg.locator("#df-botchat .bot-av").count() == 1 and pg.locator("#df-botchat2 .bot-av").count() == 1, "deux bannières de combattants")
    pg.wait_for_function("document.querySelectorAll('#df-botlog .bot-m').length >= 2", timeout=9000)
    check(True, "les deux se parlent : « %s »" % pg.locator("#df-botlog .bot-m").first.inner_text()[:60])
    pg.evaluate(A + ".launch('combat', {color: 'w', cw: 'lelex', cb: 'eto'})")
    pg.click(".df-vs")
    check(pg.locator("#df-botchat2 .bot-av.ph, #df-botchat .bot-av.ph").count() == 1, "ETO Brillant : avatar sans illustration (initiales)")
    pg.evaluate(A + ".launch('combat', {color: 'w', cw: 'nasko', cb: 'nasko'})")
    check(pg.evaluate(A + ".g.pl.w.name") != pg.evaluate(A + ".g.pl.b.name"), "Nasko vs Nasko : noms distincts")
    pg.click(".df-vs")
    pg.click("#b-stop") if pg.locator("#b-stop").count() else None
    # --- titres façon Chess.com selon l'Elo
    T = "([e, s]) => ENOS.botChat.titleOf(e, s)"
    got = [pg.evaluate(T, [e, None]) for e in (1300, 2299, 2200, 2300, 2499, 2500, 2799, 2800, 3200)]
    check(got == ["", "CM", "CM", "FM", "FM", "IM", "IM", "GM", "GM"], "titres : GM ≥ 2800, IM 2500-2799, FM ≥ 2300, CM ≥ 2200 : %s" % got)
    check(pg.evaluate(T, [1, "GM"]) == "GM", "Naskurieux : GM même à 1 Elo")
    pg.evaluate(A + ".launch('combat', {color: 'w', cw: 'penoire', cb: 'eto'})"); pg.click(".df-vs")
    check(pg.locator("#df-top .ttl-GM, #df-bot .ttl-GM").count() == 1 and pg.locator("#df-top .ttl-IM, #df-bot .ttl-IM").count() == 1, "badges IM (Pénoire) et GM (ETO Brillant) à côté des pseudos")
    pg.evaluate(A + ".launch('combat', {color: 'w', cw: 'nasko', cb: 'lelex'})"); pg.click(".df-vs")
    check(pg.locator("#df-top .ttl, #df-bot .ttl").count() == 0, "Nasko et Lelex : aucun titre")
    # --- Naskurieux : 1 Elo, GM, +200 Elo à chaque erreur adverse
    pg.evaluate(A + ".launch('naskurieux', {color: 'w'})")
    check(pg.evaluate(A + ".g.pl.b.elo") == 1 and "GM" in pg.inner_text("#df-top"), "Naskurieux : 1 Elo, badge GM : " + pg.inner_text("#df-top").replace("\n", " ")[:40])
    pg.click('#df-board [data-sq="f2"]'); pg.click('#df-board [data-sq="f3"]')
    pg.wait_for_function(A + ".g.moves.length >= 2", timeout=40000)
    pg.wait_for_function("!" + A + ".g.busy", timeout=20000)
    pg.click('#df-board [data-sq="g2"]'); pg.click('#df-board [data-sq="g4"]')
    try:                                                                  # g4 est une gaffe : la fenêtre « Gaffe catastrophique » propose de continuer
        pg.wait_for_selector("#sheet .opt >> text=CONTINUER", timeout=25000); pg.click("#sheet .opt >> text=CONTINUER")
    except Exception:
        pass
    pg.wait_for_function(A + ".g.moves.length >= 4", timeout=40000)
    e1 = pg.evaluate(A + ".g.pl.b.elo")
    check(e1 >= 201 and (e1 - 1) % 200 == 0, "Naskurieux gagne +200 Elo par erreur adverse (f3, g4) : %d Elo" % e1)
    miss2 = pg.evaluate("() => ['elo_up', 'elo_self'].filter(k => !(window.ENOS_BOT_LINES.naskurieux[k] || []).length)")
    check(not miss2, "Naskurieux : répliques d'Elo gagné (erreur adverse / meilleur coup) : manque %s" % miss2)
    # --- GhorGhor : perd 3 pièces mineures -> GhorGhor le vrai
    pg.wait_for_function("!" + A + ".g.busy", timeout=20000)
    pg.evaluate(A + ".launch('ghorghor', {color: 'w'})")
    check(pg.evaluate(A + ".g.pl.b.elo") == 1400 and pg.locator("#df-top .ttl").count() == 0, "GhorGhor : 1400 Elo, pas de titre")
    check("ghorghor.png" in pg.evaluate("document.querySelector('#df-botchat .bot-av').src"), "GhorGhor : illustration normale")
    pg.evaluate("""() => { const g = %s.g; const fen = 'rnbqkb1r/pppppppp/8/8/8/5n2/PPPPPPPP/RNBQKBNR w KQkq - 0 1'; g.ch.load(fen); g.fen = fen; g.moves = []; g.snaps = []; g.inBook = false; g.lostMinor = {w: 0, b: 2}; }""" % A)
    pg.click('#df-board [data-sq="e2"]'); pg.click('#df-board [data-sq="f3"]')
    pg.wait_for_selector(".glitch-ov", timeout=30000)
    check(True, "l'écran glitche")
    pg.wait_for_function("document.documentElement.classList.contains('ghor')", timeout=15000)
    check(pg.evaluate(A + ".g.pl.b.elo") == 3200 and pg.evaluate(A + ".g.pl.b.name") == "GhorGhor le vrai", "GhorGhor devient le vrai : 3200 Elo")
    check("ghorghor_vrai.png" in pg.evaluate("document.querySelector('#df-botchat .bot-av').src") and pg.locator("#df-top .ttl-GM").count() == 1, "nouvelle illustration (lunettes) + badge GM")
    pg.click("#df-back")
    check(not pg.evaluate("document.documentElement.classList.contains('ghor')"), "ambiance rétablie en quittant la partie")
    # autre mode : pas de bot
    pg.evaluate(A + ".launch('enos', {color: 'w', pow: 5, elo: 400})")
    check(pg.evaluate("document.querySelector('#df-botchat').hidden"), "pas de chat hors bots Nasko / Lelex")
    check(not errs, "aucune erreur JavaScript : %s" % errs[:2])
    b.close()
import sys
sys.exit(1 if BAD else 0)
