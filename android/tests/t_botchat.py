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
    # autre mode : pas de bot
    pg.evaluate(A + ".launch('enos', {color: 'w', pow: 5, elo: 400})")
    check(pg.evaluate("document.querySelector('#df-botchat').hidden"), "pas de chat hors bots Nasko / Lelex")
    check(not errs, "aucune erreur JavaScript : %s" % errs[:2])
    b.close()
import sys
sys.exit(1 if BAD else 0)
