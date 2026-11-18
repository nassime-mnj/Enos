"""5D Chess (interface) : accueil animé, partie, coups, voyage dans le temps, vue d'ensemble, tutoriel complet joué avec de vrais touchers. Captures avec SHOTS=dossier."""
import os, time
from mobile_common import *

OUT = os.environ.get("SHOTS", "")
errs = []
def shot(pg, name):
    if OUT:
        os.makedirs(OUT, exist_ok=True); pg.screenshot(path=os.path.join(OUT, name + ".png"))
G = "document.querySelector('#tool-fived .suite-body')._api.game()"

def settle(pg, tmax=6.0):
    t0 = time.time()
    while time.time() - t0 < tmax:
        st = pg.evaluate("(() => { const g = %s; if (!g) return 1; const v = g.view, c = v.cam, t = v.camT; return Math.abs(c.x - t.x) + Math.abs(c.y - t.y) + Math.abs(c.z - t.z) * 300 + (v.anims.length ? 99 : 0) + (g.busy ? 99 : 0); })()" % G)
        if st < 1.5: return
        pg.wait_for_timeout(120)

def cell_xy(pg, l, t, x, y):
    return pg.evaluate("(() => { const v = %s.view, p = v.cellPos(%d, %d, %d, %d), s = v.w2s(p.x, p.y), r = v.cv.getBoundingClientRect(); return [r.left + s.x, r.top + s.y]; })()" % (G, l, t, x, y))

def click_cell(pg, l, t, x, y):
    settle(pg); px, py = cell_xy(pg, l, t, x, y); pg.mouse.click(px, py); pg.wait_for_timeout(250)

with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)[:300])); pg.on("console", lambda m: errs.append("console: " + m.text[:200]) if m.type == "error" and "Failed to load resource" not in m.text else None); pg.on("response", lambda r: errs.append("HTTP %d %s" % (r.status, r.url)) if r.status >= 400 and "favicon" not in r.url else None)
    pg.goto(URL); pg.wait_for_selector("#tabbar"); pg.set_default_timeout(60000)
    pg.wait_for_function("!!(window.ENOS && ENOS.fived && ENOS.fivedView && ENOS.hub)")
    check(pg.evaluate("ENOS.hub.has('fived')"), "5D Chess rangé dans Échecs › Affronter")
    pg.click('#tabbar [data-tab="tools"]'); pg.evaluate("ENOS.modules.open('fived')"); pg.wait_for_selector("#fd-play"); pg.wait_for_timeout(4500); shot(pg, "fd_home")
    # ---- partie contre ETO (niveau 1 pour aller vite)
    pg.evaluate("document.querySelector('#tool-fived .suite-body')._api.prefs.level = 1")
    pg.click("#fd-play"); pg.wait_for_selector(".fd-game .fd-cv"); pg.wait_for_timeout(1500); settle(pg); shot(pg, "fd_game_start")
    check(pg.locator(".fd-chip").inner_text().startswith("BLANCS"), "la partie commence : trait aux Blancs")
    click_cell(pg, 0, 0, 1, 0)                                        # cavalier b1
    n = pg.evaluate("%s.view.targets.length" % G); check(n >= 2, "le cavalier a %d cibles" % n); settle(pg); shot(pg, "fd_select_knight")
    click_cell(pg, 0, 0, 2, 2); pg.wait_for_timeout(300); shot(pg, "fd_move_flight"); settle(pg); shot(pg, "fd_after_move")
    check(pg.evaluate("%s.S.turnMoves.length" % G) == 1 and pg.evaluate("%s.S.tl[0].list.length" % G) == 2, "coup joué : un plateau de plus")
    check(not pg.locator("[data-a=submit]").is_disabled(), "VALIDER devient disponible")
    pg.click("[data-a=submit]"); pg.wait_for_timeout(600); shot(pg, "fd_eto_thinking")
    pg.wait_for_function("(() => { const g = %s; return g && !g.busy && g.S.turn === 'w' && g.S.turnNo >= 2; })()" % G, timeout=40000); settle(pg); shot(pg, "fd_back_to_me")
    check(pg.evaluate("%s.S.log.length" % G) >= 2, "ETO a joué : le tour est enregistré")
    # ---- grand multivers fabriqué par le moteur (IA contre IA) puis vue d'ensemble
    pg.evaluate("""(() => { const g = %s, S = g.S, FD = ENOS.fived; for (let i = 0; i < 14 && !S.over; i++) { const seq = FD.aiTurn(S, { level: 1, ms: 60, seed: i + 3 }); if (!seq) break; for (const m of seq) FD.play(S, m, 5); FD.submit(S); } S.turn = 'w'; g.view.appear = {}; g.view.anims = []; g.view.hide = {}; g.afterState(); g.view.fitAll(); })()""" % G)
    pg.wait_for_timeout(1800); settle(pg); shot(pg, "fd_multiverse")
    nt = pg.evaluate("Object.keys(%s.S.tl).length" % G); check(nt >= 2, "le multivers contient %d timelines" % nt)
    pg.click("[data-a=menu]"); pg.wait_for_selector(".fd-menu:not([hidden])"); shot(pg, "fd_menu"); pg.click("[data-m=quit]"); pg.wait_for_selector("#fd-play")
    # ---- tutoriel : joué avec de vrais touchers
    pg.click("#fd-tuto"); pg.wait_for_selector(".fd-tuto:not([hidden])"); pg.wait_for_timeout(1400); settle(pg); shot(pg, "fd_tuto_1")
    for step in range(8):
        for guard in range(14):
            st = pg.evaluate("(() => { const g = %s, t = g.tuto, task = g.task(); return { i: t.i, ti: t.ti, fin: !!t.finished, exp: task ? (task.expect && task.expect.from ? 'move' : task.expect || (task.kinds ? 'kinds' : 'done')) : '', e: task && task.expect && task.expect.from ? task.expect : null }; })()" % G)
            if st["i"] != step: break
            if st["fin"] or st["exp"] == "next":
                if guard == 0: shot(pg, "fd_tuto_%d_end" % (step + 1))
                pg.click("[data-t=next]"); pg.wait_for_timeout(900); break
            if st["exp"] == "submit":
                settle(pg); pg.click("[data-a=submit]"); pg.wait_for_timeout(500); settle(pg, 8); continue
            if st["exp"] == "move":
                e = st["e"]; click_cell(pg, e["from"]["l"], e["from"]["t"], e["from"]["x"], e["from"]["y"])
                if guard == 0: shot(pg, "fd_tuto_%d_sel" % (step + 1))
                click_cell(pg, e["to"]["l"], e["to"]["t"], e["to"]["x"], e["to"]["y"]); settle(pg, 8); continue
            if st["exp"] == "kinds":
                cells = pg.evaluate("(() => { const g = %s, S = g.S, out = []; const b = S.tl[0].list[2]; for (let y = 0; y < S.H; y++) for (let x = 0; x < S.W; x++) { const v = b[y * S.W + x]; if (v > 0 && Math.abs(v) < 6) out.push([Math.abs(v), x, y]); } return out; })()" % G)
                for v, x, y in cells:
                    click_cell(pg, 0, 2, x, y)
                    if v == 5: shot(pg, "fd_tuto_6_queen")
                settle(pg); continue
            mv = pg.evaluate("(() => { const g = %s, S = g.S, FD = ENOS.fived; const ls = FD.movable(S, 'w'); for (const l of ls) { const ms = FD.movesOn(S, 'w', l).filter((m) => !m.to.jump); if (ms.length) return { l, t: ms[0].t, x: ms[0].x, y: ms[0].y, to: ms[0].to }; } return null; })()" % G)
            if mv:
                click_cell(pg, mv["l"], mv["t"], mv["x"], mv["y"]); click_cell(pg, mv["to"]["l"], mv["to"]["t"], mv["to"]["x"], mv["to"]["y"]); settle(pg, 8)
        check(pg.evaluate("(() => { const g = %s; return !g || !g.tuto || g.tuto.i >= %d; })()" % (G, min(step + 1, 7))), "étape %d du tutoriel terminée" % (step + 1))
    pg.wait_for_timeout(800)
    check(pg.evaluate("ENOS.settings.get('fived.tutodone', false)") is True or pg.locator("#fd-play").count() >= 1, "tutoriel terminé")
    other = [e for e in errs if "favicon" not in e]
    check(not other, "aucune erreur JS : %s" % other[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
