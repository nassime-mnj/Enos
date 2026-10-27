"""Super Enos (téléphone) : entraînement local en arrière-plan, mémoire, profils, service de premier plan demandé, transitions de pages."""
from mobile_common import *

errs = []
with sync_playwright() as pg_:
    b, ctx = launch(pg_)
    pg = open_app(ctx, errs)
    ev = pg.evaluate
    ev("""() => { window.__ka = []; const N = ENOS.native, o = N.keepAlive; N.keepAlive = (on, t) => { window.__ka.push([on, t]); return o(on, t); }; }""")

    # ---------------------------------------------------------------- module dans la grille + sous-vue
    pg.click('#tabbar [data-tab="tools"]'); ev("ENOS.tools.show('')"); pg.wait_for_selector('.mtile[data-m="train"]')
    check(True, "tuile « Super Enos » dans les modules")
    pg.click('.mtile[data-m="train"]'); pg.wait_for_selector("#tool-train:not([hidden])")
    check(pg.locator("#su-opps .su-opp.on").count() == 3, "3 profils sélectionnés par défaut (E.N.O.S., Stockfish, ETO)")

    # ---------------------------------------------------------------- une partie courte (limite de 24 demi-coups), sans LLM (pas de clé Groq)
    ev("ENOS.trainUi.setMaxPlies(24)")
    ev("""() => { const s = document.querySelector('#su-n'); s.insertAdjacentHTML('beforeend', '<option value="1">1</option>'); s.value = '1'; document.querySelector('#su-ms').value = '300'; }""")
    pg.click("#su-go")
    pg.wait_for_function("document.querySelector('#su-stop') && !document.querySelector('#su-stop').hidden", timeout=5000)
    check(ev("window.__ka.some(a => a[0] === true)"), "service de premier plan demandé au lancement (arrière-plan)")
    pg.wait_for_function("document.querySelector('#su-go') && !document.querySelector('#su-go').hidden", timeout=150000)
    check(ev("window.__ka.some(a => a[0] === false)"), "service relâché à la fin")
    mem = ev("JSON.parse(localStorage.getItem('enos.train.mem'))")
    g = mem["games"]
    check(len(g) == 1 and g[0]["opp"] == "enos", "1 partie enregistrée contre E.N.O.S. : %s" % (g and g[0]["why"]))
    check(len(mem["lessons"]) == 1 and len(mem["lessons"][0]["text"]) > 10, "une leçon (modèle de secours sans LLM) : %s" % (mem["lessons"] and mem["lessons"][0]["text"][:60]))
    check(mem["profiles"]["enos"]["g"] == 1 and mem["plies"] > 0, "profil E.N.O.S. mis à jour")
    txt = pg.inner_text("#su-prof")
    check("E.N.O.S." in txt and "STOCKFISH" in txt and "ETO" in txt, "3 profils affichés")
    check(pg.locator("#su-lessons .su-les").count() == 1, "leçon affichée")
    check(pg.locator("#su-board .pce").count() > 4, "plateau en direct dessiné")

    # ---------------------------------------------------------------- arrêt en cours de partie : rien n'est enregistré
    ev("ENOS.trainUi.setMaxPlies(240)")
    ev("document.querySelector('#su-n').value = '0'")
    pg.click("#su-go")
    pg.wait_for_function("document.querySelectorAll('#su-moves, #su-board .pce').length > 0 && document.querySelector('#su-sub').textContent.includes('PARTIE')", timeout=5000)
    pg.wait_for_timeout(3000)
    pg.click("#su-stop")
    pg.wait_for_function("document.querySelector('#su-go') && !document.querySelector('#su-go').hidden", timeout=20000)
    mem2 = ev("JSON.parse(localStorage.getItem('enos.train.mem'))")
    check(len(mem2["games"]) == 1, "partie interrompue : non comptée")

    # ---------------------------------------------------------------- effacer la mémoire
    pg.click("#su-reset"); pg.wait_for_selector("#sheet .opt"); pg.click("#sheet .opt >> nth=0")
    pg.wait_for_function("JSON.parse(localStorage.getItem('enos.train.mem')).games.length === 0", timeout=5000)
    check(True, "mémoire effacée")

    # ---------------------------------------------------------------- transitions de pages
    css = ev("""() => ({ sub: getComputedStyle(document.querySelector('#tool-train')).animationName, on: document.querySelectorAll('.view.on').length,
        off: getComputedStyle(document.querySelector('.view:not(.on)')).transform, home: document.documentElement.classList.contains('no-anim') })""")
    check(css["sub"] == "pgFwd", "entrée dans un module : animation pgFwd (%s)" % css["sub"])
    check(css["on"] == 1 and css["off"] != "none", "une seule page active, les autres reculent : %s" % css["off"])
    ev("ENOS.tools.show('')")
    check(ev("getComputedStyle(document.querySelector('#tools-home')).animationName") == "pgBack", "retour aux modules : animation pgBack")
    pg.click('#tabbar [data-tab="home"]'); pg.wait_for_timeout(120)
    mid = ev("getComputedStyle(document.querySelector('.view[data-v=home] .scroll > *:nth-child(3)')).opacity")
    check(float(mid) < 1, "les cartes de la page d'accueil entrent en cascade (opacité %s à 120 ms)" % mid)
    ev("ENOS.settings.set('anim', false); ENOS.ui.applyAnim()"); pg.wait_for_timeout(150)
    check(ev("document.documentElement.classList.contains('no-anim') && getComputedStyle(document.querySelector('.view:not(.on)')).transform") == "none", "réglage « Animations » désactivable")
    check(not errs, "aucune erreur JavaScript : %s" % errs[:2])
    b.close()
import sys
sys.exit(1 if BAD else 0)
