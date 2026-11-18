"""Hub des modules : 7 catégories, tuiles sans description, tous les modules rangés, recherche, récents, transitions et animation de clic, profil échecs, accueil des Défis."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(60000)
    pg.evaluate("ENOS.ui.go('tools')"); pg.wait_for_selector(".hub-cat"); pg.wait_for_timeout(1500)
    labs = pg.evaluate("[...document.querySelectorAll('.hub-cl')].map((x) => x.textContent)")
    check(labs == ["ÉCHECS", "CLOUD", "PARAMÈTRES", "CODAGE", "OUTILS", "ORGANISATION", "ORDINATEUR"], "7 catégories dans l'ordre de ta maquette : %s" % labs)
    check(pg.evaluate("[...document.querySelectorAll('.hub-cat img')].every((i) => i.complete && i.naturalWidth > 100)"), "icônes lumineuses chargées")
    # tous les modules sont rangés quelque part
    miss = pg.evaluate("ENOS.modules.all().filter((id) => !ENOS.hub.has(id) && !['chess','learn'].includes(id) || false)")
    miss = [m for m in miss if m not in ("chess",)]
    print("non rangés :", miss)
    check(not [m for m in miss if m != "learn"], "tous les modules sont accessibles depuis une catégorie (manquants : %s)" % miss)
    # catégorie Échecs : sections, tuiles, aucune description
    pg.click('.hub-cat[data-c="echecs"]'); pg.wait_for_timeout(120)
    fly_mid = pg.evaluate("document.querySelectorAll('.hub-fly').length")
    pg.wait_for_timeout(1100)
    secs = pg.evaluate("[...document.querySelectorAll('.hub-sec h4')].map((h) => h.textContent)")
    check(fly_mid == 1 and pg.evaluate("document.querySelectorAll('.hub-fly').length") == 0, "l'icône voyage vers l'en-tête puis disparaît (pendant : %d)" % fly_mid)
    check(secs == ["Jouer", "Affronter", "Apprendre", "Analyser", "Créer", "Profil"], "sections façon Chess.com : %s" % secs)
    n = pg.evaluate("document.querySelectorAll('.hub-tile').length"); check(n >= 27, "%d tuiles dans Échecs" % n)
    check(pg.evaluate("document.querySelectorAll('.hub-tile small').length") == 0, "aucune description sur les tuiles")
    over = pg.evaluate("[...document.querySelectorAll('.hub-tile')].filter((t) => t.scrollWidth > t.clientWidth + 1 || [...t.querySelectorAll('b')].some((x) => x.scrollWidth > x.clientWidth + 1)).map((t) => t.dataset.id)")
    check(not over, "aucune tuile ne déborde : %s" % over[:5])
    # préréglages et accès directs
    pg.click('.hub-tile[data-id="@tc:bullet"]'); pg.wait_for_selector("#tool-defis:not([hidden]) #df-home", timeout=8000)
    check(pg.evaluate("ENOS.settings.get('defi.tc')") == "bullet", "« Bullet » ouvre les Défis avec la cadence Bullet")
    pg.evaluate("ENOS.tools.show('')"); pg.wait_for_selector(".hub-tile[data-id='@prof:stats']")
    check(pg.evaluate("ENOS.hub.cur()") == "echecs", "retour d'un module : on retrouve la catégorie Échecs")
    pg.click(".hub-tile[data-id='@prof:prizes']"); pg.wait_for_selector("#tool-chessprofile:not([hidden]) .pf-prizes", timeout=8000)
    check(pg.evaluate("document.querySelectorAll('#tool-chessprofile .pf-prize').length") >= 20, "Prix : grille de succès")
    pg.evaluate("ENOS.tools.show('')"); pg.click(".hub-tile[data-id='@puz:fork']")
    pg.wait_for_selector("#tool-learn:not([hidden]) #lr-tabs button.on", timeout=8000)
    pg.wait_for_function("document.querySelector('#tool-learn #lr-tabs .on').dataset.t === 'puzzles'", timeout=8000)
    check(True, "« Fourchettes » ouvre les puzzles")
    pg.evaluate("ENOS.tools.show('')"); pg.wait_for_selector("#hub-back")
    pg.click("#hub-back"); pg.wait_for_selector(".hub-cat", state="visible"); pg.wait_for_timeout(700)
    check(pg.evaluate("ENOS.hub.cur()") is None and pg.locator(".hub-cat").count() == 7, "retour à l'accueil du hub")
    # récents + recherche
    rec = pg.evaluate("[...document.querySelectorAll('.hub-chip')].map((c) => c.dataset.id)"); check(len(rec) >= 1 and "defis" in rec or "learn" in rec or "chessprofile" in rec, "récents : %s" % rec)
    pg.fill("#hub-q", "bullet"); pg.wait_for_timeout(200)
    r1 = pg.evaluate("[...document.querySelectorAll('#hub-res .hub-tile')].map((t) => t.dataset.id)"); check("@tc:bullet" in r1 and pg.evaluate("document.querySelector('.hub-cats').hidden"), "recherche « bullet » : %s" % r1)
    pg.fill("#hub-q", "pdf"); pg.wait_for_timeout(200); check("pdf" in pg.evaluate("[...document.querySelectorAll('#hub-res .hub-tile')].map((t) => t.dataset.id)"), "recherche « pdf »")
    pg.fill("#hub-q", "zzzz"); pg.wait_for_timeout(200); check(pg.locator(".hub-none").count() == 1, "recherche sans résultat")
    pg.click("#hub-qx"); pg.wait_for_timeout(200); check(not pg.evaluate("document.querySelector('.hub-cats').hidden"), "effacer la recherche rend les catégories")
    # animation de clic : onde + tuile qui s'agrandit
    pg.click('.hub-cat[data-c="outils"]'); pg.wait_for_timeout(1200)
    box = pg.locator('.hub-tile[data-id="pdf"]').bounding_box()
    pg.mouse.move(box["x"] + 30, box["y"] + 30); pg.mouse.down(); pg.wait_for_timeout(60)
    check(pg.evaluate("document.querySelectorAll('.hub-tile .rip').length") >= 1, "onde lumineuse au toucher")
    pg.mouse.up(); pg.wait_for_timeout(100)
    z = pg.evaluate("document.querySelectorAll('.hub-zoom').length"); pg.wait_for_selector("#tool-pdf:not([hidden])", timeout=8000); pg.wait_for_timeout(700)
    check(z == 1 and pg.evaluate("document.querySelectorAll('.hub-zoom').length") == 0, "la tuile s'agrandit en module puis disparaît (%d)" % z)
    # module verrouillé : feuille explicative
    pg.evaluate("ENOS.tools.show('')"); pg.click("#hub-back"); pg.wait_for_timeout(700); pg.click('.hub-cat[data-c="ordinateur"]'); pg.wait_for_timeout(1200)
    pg.click('.hub-tile[data-id="b-dc"]'); pg.wait_for_selector("#sheet:not([hidden])", timeout=8000)
    check("réservé au PC" in pg.inner_text("#sheet"), "module verrouillé : explication")
    pg.evaluate("ENOS.ui.closeSheet(true)")
    # accueil des Défis : sections, aucune description
    pg.evaluate("ENOS.modules.open('defis')"); pg.wait_for_selector("#df-home .hub-sec")
    check(pg.evaluate("document.querySelectorAll('#df-home .df-mode small').length") == 0 and pg.locator("#df-home .df-mode").count() == 24, "Défis : 24 modes en tuiles sans description")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
