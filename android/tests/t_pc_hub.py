"""Version PC (static/learn) — HUB ÉCHECS : accueil unifié (héros 3D qui rejoue l'Opéra de Morphy, 16 cartes de modes, défilé des bots),
barre latérale, palette Ctrl+K, en-tête de page des modules, Arène (bannière ×4, Défier → choix de couleur, Détails), actions demandées
à la fenêtre principale par postMessage. Lancer avec un serveur statique sur static/learn (port PC_PORT, 8803 par défaut)."""
import os
from mobile_common import launch, check, BAD
from playwright.sync_api import sync_playwright
S = (os.environ.get("SHOTS") or "/tmp") + "/"; PORT = os.environ.get("PC_PORT", "8803")
URL = "http://127.0.0.1:%s/index.html" % PORT
errs = []
with sync_playwright() as pw:
    b, _ctx = launch(pw)
    # la page du hub est ouverte dans un cadre, comme dans E.N.O.S. : le parent reçoit les demandes (partie, mise en condition…)
    host = b.new_page(viewport={"width": 1920, "height": 1080}); host.set_default_timeout(60000)
    host.on("pageerror", lambda e: errs.append(str(e)[:200]))
    host.set_content('<html><body style="margin:0;background:#000"><iframe id="f" src="%s" style="border:0;width:100vw;height:100vh"></iframe>'
                     '<script>window.got=[];addEventListener("message",(e)=>{ if (e.data && e.data.enos) window.got.push(e.data); });</script></body></html>' % URL)
    host.wait_for_timeout(500)
    pg = host.frame_locator("#f"); fr = host.frames[1]
    fr.wait_for_selector("#hub .mc", timeout=30000); fr.wait_for_timeout(2500)
    check(fr.locator("#hub .mc").count() == 17, "hub : 17 cartes de modes (Simultanée comprise) (%d)" % fr.locator("#hub .mc").count())
    check(fr.evaluate("document.body.dataset.view") == "hub" and not fr.is_hidden("#hub"), "l'accueil est le hub")
    n0 = fr.evaluate("document.querySelectorAll('#lb .pc').length"); fr.wait_for_timeout(3200)
    san = fr.inner_text("#lb-san")
    check(n0 == 32 and san.strip() != "", "héros : plateau 3D avec les 32 pièces, la partie de l'Opéra avance (%s)" % san)
    check(fr.evaluate("[...document.querySelectorAll('#tabs .hi')].length") >= 18, "barre latérale : icônes posées")
    check(fr.evaluate("document.querySelectorAll('.mq-b').length") > 100, "défilé : plus de cent adversaires")
    stats = fr.evaluate("[...document.querySelectorAll('.hero-stats b[data-count]')].map(b => +b.dataset.count)")
    check(stats[0] >= 130 and stats[1] == 17, "statistiques réelles (bots, modes) : %s" % stats)
    host.screenshot(path=S + "pc_hub.png")
    # palette Ctrl+K
    fr.click("#top-search"); fr.wait_for_selector("#pal:not([hidden]) #pal-q")
    fr.fill("#pal-q", "variantes"); fr.wait_for_timeout(150)
    check(fr.locator(".pal-it").count() >= 1 and "Variantes" in fr.inner_text(".pal-it.on"), "palette (bouton Rechercher) : recherche « variantes »")
    fr.press("#pal-q", "Enter"); fr.wait_for_selector("#va-modes", state="attached", timeout=30000)
    check(fr.evaluate("document.body.dataset.view") == "variants" and "Variantes" in fr.inner_text("#page-head h1"), "palette → module Variantes avec son en-tête")
    check("Variantes" in fr.inner_text("#top-t"), "fil d'Ariane : Échecs › Variantes")
    fr.click("#page-head .ph-back"); fr.wait_for_timeout(400)
    check(fr.evaluate("document.body.dataset.view") == "hub", "retour au hub")
    # carte « Jouer contre E.N.O.S. » : sous-mode Choc des titans → demande à la fenêtre principale
    fr.locator('.mc[data-id=play]').scroll_into_view_if_needed(); fr.wait_for_timeout(900)
    fr.click('.mc[data-id=play] .mc-sub[data-mode=titans]'); host.wait_for_timeout(300)
    got = host.evaluate("window.got")
    check({"enos": "learn-act", "act": "play", "mode": "titans"} in got, "Choc des titans demandé à E.N.O.S. : %s" % got[-1:])
    fr.click('#tabs [data-x=study]'); host.wait_for_timeout(300)
    check(host.evaluate("window.got.some(g => g.act === 'study')"), "Ouvertures avec ETO demandé à E.N.O.S.")
    # Arène : bannière ×4, Défier → couleur, Détails → fiche
    fr.click('#tabs [data-t="arena"]'); fr.wait_for_selector("#ar-lobby .ar-card", timeout=60000); fr.wait_for_timeout(1500)
    check(fr.locator(".ar-hero [data-x4]").count() == 3, "Arène : bannière ×4 avec les 3 modes")
    check(fr.locator("#ar-lobby .ar-card").count() == 9, "Arène : les 9 bots E.N.O.S.")
    fr.click('.ar-card[data-id="lelex"] .ar-defy'); fr.wait_for_timeout(300)
    check(fr.is_visible('.ar-card[data-id="lelex"] .ar-pick button[data-c="b"]'), "Défier : choix Blancs / Noirs / Au hasard")
    host.screenshot(path=S + "pc_hub_arena.png")
    fr.click('.ar-card[data-id="penoire"] .ar-info'); fr.wait_for_selector("text=COMMENCER", timeout=8000)
    check(True, "Détails : fiche du bot")
    other = [e for e in errs if "favicon" not in e]; print("errs", other[:4])
    check(not other, "aucune erreur JS")
    b.close()
raise SystemExit(1 if BAD else 0)
