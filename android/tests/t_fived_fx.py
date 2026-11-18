"""5D Chess : effets (voyage dans le temps, nouvelle timeline), mat + écran de victoire, promotion, 2 joueurs, reprise de partie, bouton Retour. Captures avec SHOTS=dossier."""
import os, time
from mobile_common import *

OUT = os.environ.get("SHOTS", "")
errs = []
def shot(pg, name):
    if OUT:
        os.makedirs(OUT, exist_ok=True); pg.screenshot(path=os.path.join(OUT, name + ".png"))
G = "document.querySelector('#tool-fived .suite-body')._api.game()"
API = "document.querySelector('#tool-fived .suite-body')._api"

def settle(pg, tmax=6.0):
    t0 = time.time()
    while time.time() - t0 < tmax:
        st = pg.evaluate("(() => { const g = %s; if (!g) return 1; const v = g.view, c = v.cam, t = v.camT; return Math.abs(c.x - t.x) + Math.abs(c.y - t.y) + Math.abs(c.z - t.z) * 300 + (v.anims.length ? 99 : 0) + (g.busy ? 99 : 0); })()" % G)
        if st < 1.5: return
        pg.wait_for_timeout(100)

def click_cell(pg, l, t, x, y):
    settle(pg); px, py = pg.evaluate("(() => { const v = %s.view, p = v.cellPos(%d, %d, %d, %d), s = v.w2s(p.x, p.y), r = v.cv.getBoundingClientRect(); return [r.left + s.x, r.top + s.y]; })()" % (G, l, t, x, y)); pg.mouse.click(px, py); pg.wait_for_timeout(250)

def start(pg, setup_js, mode="duo"):
    pg.evaluate("(() => { const a = %s; a.launch({ mode: '%s', human: 'w', S: %s }); })()" % (API, mode, setup_js)); pg.wait_for_selector(".fd-game .fd-cv"); pg.wait_for_timeout(900); settle(pg)

with sync_playwright() as pw:
    from mobile_common import launch as lb
    b, ctx = lb(pw)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)[:300])); pg.on("console", lambda m: errs.append("console: " + m.text[:200]) if m.type == "error" and "Failed to load resource" not in m.text else None)
    pg.goto(URL); pg.wait_for_selector("#tabbar"); pg.set_default_timeout(60000); pg.click('#tabbar [data-tab="tools"]'); pg.evaluate("ENOS.modules.open('fived')"); pg.wait_for_selector("#fd-play"); pg.wait_for_timeout(1500)
    # ---- 1. voyage dans le temps : capture dans le passé + nouvelle timeline
    start(pg, "%s.STEPS[4].setup()" % API)
    click_cell(pg, 0, 4, 0, 0); settle(pg); click_cell(pg, 0, 2, 0, 0)
    for i, ms in enumerate([120, 260, 380, 420, 500, 600, 700]):
        pg.wait_for_timeout(ms if i == 0 else 130); shot(pg, "fx_travel_%d" % i)
    settle(pg, 8); shot(pg, "fx_travel_end")
    check(pg.evaluate("Object.keys(%s.S.tl).length" % G) == 2 and pg.evaluate("%s.S.nW" % G) == 1, "la capture dans le passé crée la timeline L+1")
    pg.click("[data-a=undo]"); pg.wait_for_timeout(500)
    check(pg.evaluate("Object.keys(%s.S.tl).length" % G) == 1, "ANNULER supprime la timeline créée")
    # ---- 2. mat en un coup -> écran de victoire
    start(pg, "ENOS.fived.fromSetup({ W: 5, H: 5, turn: 'w', tl: { 0: { t0: 0, boards: [['....k', '...Q.', '....K', '.....', '.....']] } } })")
    click_cell(pg, 0, 0, 3, 3); click_cell(pg, 0, 0, 4, 3); settle(pg); pg.click("[data-a=submit]"); pg.wait_for_selector(".fd-over:not([hidden])", timeout=20000); pg.wait_for_timeout(600); shot(pg, "fx_win")
    check("Victoire" in pg.inner_text(".fd-over").capitalize() or "VICTOIRE" in pg.inner_text(".fd-over"), "échec et mat : écran de victoire (%s)" % pg.inner_text(".fd-over h2"))
    pg.click("[data-o=quit]"); pg.wait_for_selector("#fd-play")
    # ---- 3. promotion
    start(pg, "ENOS.fived.fromSetup({ W: 5, H: 5, turn: 'w', tl: { 0: { t0: 0, boards: [['....k', 'P....', '.....', '.....', '....K']] } } })")
    click_cell(pg, 0, 0, 0, 3); click_cell(pg, 0, 0, 0, 4); pg.wait_for_selector(".fd-promo:not([hidden])"); shot(pg, "fx_promo"); pg.click(".fd-promo [data-k='5']"); settle(pg, 8)
    check(pg.evaluate("%s.S.tl[0].list[1][4 * 5]" % G) == 5, "promotion en dame")
    pg.click("[data-m=quit]") if False else None
    pg.evaluate("%s.quit()" % G); pg.wait_for_selector("#fd-play")
    # ---- 4. reprise de partie
    pg.evaluate("document.querySelector('#tool-fived .suite-body')._api.prefs.level = 1"); pg.click("#fd-play"); pg.wait_for_selector(".fd-game .fd-cv"); pg.wait_for_timeout(800); settle(pg)
    click_cell(pg, 0, 0, 2, 1); click_cell(pg, 0, 0, 2, 2); settle(pg); pg.click("[data-a=submit]")
    pg.wait_for_function("(() => { const g = %s; return g && !g.busy && g.S.turn === 'w' && g.S.turnNo >= 2; })()" % G, timeout=40000)
    pg.evaluate("%s.save(); %s.quit()" % (G, G)); pg.wait_for_selector("#fd-play"); pg.wait_for_selector("#fd-resume:not([hidden])")
    pg.click("#fd-resume"); pg.wait_for_selector(".fd-game .fd-cv"); pg.wait_for_timeout(800)
    check(pg.evaluate("%s.S.turnNo" % G) >= 2 and pg.evaluate("%s.S.tl[0].list.length" % G) >= 3, "la partie est reprise là où elle était")
    # ---- 5. bouton Retour d'Android : ouvre le menu, puis le ferme
    pg.evaluate("ENOS.ui.back()"); pg.wait_for_selector(".fd-menu:not([hidden])"); shot(pg, "fx_menu"); pg.evaluate("ENOS.ui.back()"); pg.wait_for_selector(".fd-menu", state="hidden")
    check(pg.locator(".fd-game").count() == 1, "Retour ferme la fiche sans quitter la partie")
    pg.evaluate("%s.quit()" % G)
    other = [e for e in errs if "favicon" not in e]
    check(not other, "aucune erreur JS : %s" % other[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
