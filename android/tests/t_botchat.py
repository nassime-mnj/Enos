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
    # autre mode : pas de bot
    pg.keyboard.press("Escape")
    pg.evaluate(A + ".launch('enos', {color: 'w', pow: 5, elo: 400})")
    check(pg.evaluate("document.querySelector('#df-botchat').hidden"), "pas de chat hors bots Nasko / Lelex")
    check(not errs, "aucune erreur JavaScript : %s" % errs[:2])
    b.close()
import sys
sys.exit(1 if BAD else 0)
