"""Chess Fog (interface) : brouillard, coup contre ETO, JOUEUR CONTRE JOUEUR avec écran de passage, fin de partie (brouillard levé), reprise, bouton Retour. Captures avec SHOTS=dossier."""
import os, time
from mobile_common import *

OUT = os.environ.get("SHOTS", "")
errs = []
def shot(pg, name):
    if OUT:
        os.makedirs(OUT, exist_ok=True); pg.screenshot(path=os.path.join(OUT, name + ".png"))
G = "document.querySelector('#tool-fog .suite-body')._api.game()"
API = "document.querySelector('#tool-fog .suite-body')._api"

def click_sq(pg, sq):
    px, py = pg.evaluate("(() => { const v = %s.v, i = %d, p = v.pos(i), r = v.cv.getBoundingClientRect(); return [r.left + p.x + p.cs / 2, r.top + p.y + p.cs / 2]; })()" % (G, sq)); pg.mouse.click(px, py); pg.wait_for_timeout(250)
def idx(s): return (ord(s[0]) - 97) + (int(s[1]) - 1) * 8
def move(pg, a, b): click_sq(pg, idx(a)); click_sq(pg, idx(b))

with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)[:300])); pg.on("console", lambda m: errs.append("console: " + m.text[:200]) if m.type == "error" and "Failed to load resource" not in m.text else None)
    pg.goto(URL); pg.wait_for_selector("#tabbar"); pg.set_default_timeout(60000); pg.wait_for_function("!!(ENOS.fog && ENOS.hub)")
    check(pg.evaluate("ENOS.hub.has('fog')"), "Chess Fog rangé dans Échecs › Affronter")
    pg.click('#tabbar [data-tab="tools"]'); pg.evaluate("ENOS.modules.open('fog')"); pg.wait_for_selector("#fg-play"); pg.wait_for_timeout(2500); shot(pg, "fg_home")
    # ---- contre ETO
    pg.evaluate("%s.prefs.level = 2" % API); pg.click("#fg-play"); pg.wait_for_selector(".fg-game .fg-cv"); pg.wait_for_timeout(1800); shot(pg, "fg_start")
    vis = pg.evaluate("%s.view.cells.filter((c) => c !== 99).length" % G)
    check(30 <= vis <= 40, "au départ, les Blancs ne voient que %d cases sur 64" % vis)
    leak = pg.evaluate("(() => { const g = %s, v = g.view; let n = 0; for (let i = 0; i < 64; i++) if (v.cells[i] === 99 && g.S.b[i] !== 0) n++; return n; })()" % G)
    check(leak >= 8 and pg.evaluate("[56,57,60,63].every((i) => %s.view.cells[i] === 99)" % G), "les pièces noires sont dans le brouillard (%d cases cachées occupées)" % leak)
    click_sq(pg, idx("e2")); n = pg.evaluate("%s.v.targets.length" % G); check(n == 2, "le pion e2 a 2 cibles"); shot(pg, "fg_select")
    click_sq(pg, idx("e4")); pg.wait_for_timeout(500)
    pg.wait_for_function("(() => { const g = %s; return g && !g.busy && g.S.turn === 'w' && g.S.ply >= 2; })()" % G, timeout=30000); pg.wait_for_timeout(600); shot(pg, "fg_after_eto")
    check(pg.evaluate("%s.S.ply" % G) == 2, "ETO a répondu (2 demi-coups)")
    # le bot n'a reçu que sa vue : on vérifie qu'il n'a jamais vu le vrai plateau
    check(pg.evaluate("(() => { const g = %s; return g.bot && g.bot.parts && g.bot.parts.length > 0 && !('S' in g.bot); })()" % G), "le bot garde sa croyance (particules) et n'a aucune référence à la partie")
    # ---- partie jusqu'au bout contre ETO niveau 1 (le joueur joue au hasard) : écran de fin avec brouillard levé
    pg.evaluate("%s.quit()" % G); pg.wait_for_selector("#fg-play")
    pg.evaluate("%s.prefs.level = 1" % API); pg.click("#fg-play"); pg.wait_for_selector(".fg-game .fg-cv"); pg.wait_for_timeout(800)
    t0 = time.time()
    while time.time() - t0 < 100:
        st = pg.evaluate("(() => { const g = %s; return g ? { over: !!g.S.over, ok: !g.busy && g.S.turn === 'w' && !g.S.over } : null; })()" % G)
        if not st or st["over"]: break
        if st["ok"]:
            m = pg.evaluate("(() => { const g = %s, v = g.view, flat = new Int8Array(64); for (let i = 0; i < 64; i++) flat[i] = v.cells[i] === 99 ? 0 : v.cells[i]; const ms = ENOS.fog.gen(flat, 'w', v.castle); const caps = ms.filter((q) => q.cap); const m = (caps.length ? caps : ms)[Math.floor(Math.random() * (caps.length || ms.length))]; return m ? [m.f, m.t, m.promo || 0] : null; })()" % G)
            if not m: break
            pg.evaluate("(() => { const g = %s; g.tap(%d); g.tap(%d); const p = g.q('#fg-promo'); if (!p.hidden) p.querySelector('[data-k=\"5\"]').click(); })()" % (G, m[0], m[1]))
        pg.wait_for_timeout(250)
    pg.wait_for_selector(".fd-over:not([hidden])", timeout=20000); pg.wait_for_timeout(1400); shot(pg, "fg_over")
    check(pg.evaluate("%s.v.reveal" % G) == 1, "fin de partie : le brouillard se lève (%s)" % pg.inner_text(".fd-over h2"))
    pg.click("[data-o=quit]"); pg.wait_for_selector("#fg-play")
    # ---- JOUEUR CONTRE JOUEUR : écran de passage
    pg.click("#fg-duo"); pg.wait_for_selector(".fg-pass:not([hidden])"); pg.wait_for_timeout(800); shot(pg, "fg_pass_w")
    check("BLANCS" in pg.inner_text(".fg-pass"), "JvJ : écran de passage « BLANCS » avant la 1ʳᵉ vue, le plateau est caché")
    check(pg.evaluate("%s.view.cells.every((c) => c === 99)" % G), "pendant le passage, la vue du plateau est entièrement dans le brouillard")
    pg.click("[data-p=go]"); pg.wait_for_timeout(1500); shot(pg, "fg_duo_white")
    move(pg, "e2", "e4"); pg.wait_for_selector(".fg-pass:not([hidden])", timeout=10000); check("NOIRS" in pg.inner_text(".fg-pass"), "après le coup blanc : passage aux NOIRS")
    pg.click("[data-p=go]"); pg.wait_for_timeout(1500); shot(pg, "fg_duo_black")
    seen = pg.evaluate("%s.view.seen" % G); check(seen is None, "les Noirs ne voient pas e2-e4 (trop loin de leurs pièces) : aucune info")
    check(pg.evaluate("%s.view.cells[%d]" % (G, idx("e1"))) == 99, "les Noirs ne voient pas le roi blanc")
    move(pg, "d7", "d5"); pg.wait_for_selector(".fg-pass:not([hidden])", timeout=10000); pg.click("[data-p=go]"); pg.wait_for_timeout(900)
    check(pg.evaluate("%s.S.ply" % G) == 2 and pg.evaluate("%s.viewer" % G) == "w", "retour aux Blancs, 2 demi-coups joués")
    # ---- Retour d'Android et reprise
    pg.evaluate("ENOS.ui.back()"); pg.wait_for_selector(".fd-menu:not([hidden])"); pg.evaluate("ENOS.ui.back()"); check(pg.locator(".fg-game").count() == 1, "Retour : ferme le menu sans quitter")
    pg.evaluate("%s.save(); %s.quit()" % (G, G)); pg.wait_for_selector("#fg-resume:not([hidden])"); pg.click("#fg-resume"); pg.wait_for_selector(".fg-pass:not([hidden])")
    check(pg.evaluate("%s.S.ply" % G) == 2, "la partie à deux est reprise")
    other = [e for e in errs if "favicon" not in e]
    check(not other, "aucune erreur JS : %s" % other[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
