"""Battle Royale x4 : icones/effets des coups, roue HDR du Jester avant son coup, cinematique de GhorGhor le vrai, sommeil de Naskolit, changement de cible calcule."""
import os
from mobile_common import *

SH = os.environ.get("SHOTS")
errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    pg.set_default_timeout(60000)
    ev = pg.evaluate
    open_tool(pg, "royale")
    A = "document.querySelector('#tool-royale .suite-body')._api"
    ev("""() => { const c = %s.cfg(); c.seats.forEach((s, i) => { s.who = ['nasko', 'jester', 'naskolit', 'ghorghor'][i]; s.team = i; s.target = (i + 1) %% 4; }); c.speed = 'normal'; c.storm = 'off'; }""" % A)
    ev(A + ".launch()")

    # ---- la roue du Jester tourne AVANT son 1er coup
    pg.wait_for_selector(".ro-wheel", timeout=30000)
    check(True, "la roue du Jester apparait avant son premier coup")
    check(ev(A + ".g.busy"), "la partie attend pendant que la roue tourne")
    pg.wait_for_timeout(1500)
    if SH: pg.screenshot(path=os.path.join(SH, "fx_wheel_spin.png"))
    pg.wait_for_selector(".rw-res small", timeout=15000)
    if SH: pg.screenshot(path=os.path.join(SH, "fx_wheel_done.png"))
    shown = int(ev("document.querySelector('.rw-res b').textContent"))
    pg.wait_for_selector(".ro-wheel", state="detached", timeout=10000)
    jx = ev(A + ".g.seats[1].ai.elo")
    check(jx == shown, "l'Elo affiche sur la roue (%s) est celui que le Jester joue (%s)" % (shown, jx))
    check(not ev(A + ".g.busy"), "la partie reprend apres la roue")

    # ---- icones et effets des coups
    pg.wait_for_function(A + ".g.st.ply >= 10", timeout=60000)
    ev(A + ".g.paused = true")
    n = ev("document.querySelectorAll('.ro-fx .rfx-badge').length")
    ev("() => { const a = %s; a.badge(0, 40, 'brilliant'); a.badge(1, 41, 'blunder'); }" % A)
    check(ev("document.querySelectorAll('.ro-fx .rfx-badge').length") >= 2, "pastilles !! et ?? posees sur les cases d'arrivee")
    ev("() => %s.moveFx(0, 40, 54, { captured: { owner: 1, type: 5 }, promo: false, check: null, elim: [] })" % A)
    check(ev("document.querySelectorAll('.ro-fx .sparks, .ro-fx .rfx-trail, .ro-fx .pts').length") >= 3, "capture : etincelles, trainee et points")
    if SH: pg.screenshot(path=os.path.join(SH, "fx_move.png"))

    # ---- changement de cible calcule
    ev(A + ".g.paused = false")
    rt = ev("() => { const g = %s.g; return window.ENOS.c4ai.retarget(g.st, 3, Object.assign({}, g.seats[3].ai, { target: 2 })); }" % A)
    check(rt is None or (rt.get("to") in (0, 1, 2) and rt.get("why")), "retarget renvoie une decision argumentee : %s" % rt)
    ev("() => { const g = %s.g; g.st.pts[0] = 90; }" % A)
    ev("() => { const a = %s; a.retargeted(3, { to: 0, why: 'mene la partie' }); }" % A)
    check(ev(A + ".g.seats[3].target") == 0 and "change de cible" in ev("document.getElementById('ro-ticker').textContent"), "changement de cible annonce")

    # ---- Naskolit endort
    ev(A + ".g.paused = true")
    ev("() => %s.putToSleep(2, 1)" % A)
    check(ev(A + ".g.sleep[1]") == 1 and pg.locator(".ro-ban.sleep").count() == 1, "le Jester est endormi 1 tour")
    if SH: pg.screenshot(path=os.path.join(SH, "fx_sleep.png"))
    ev(A + ".g.st.turn = 1")
    ev("() => %s.napSkip(1)" % A)
    pg.wait_for_function(A + ".g.sleep[1] === 0 && " + A + ".g.st.turn !== 1", timeout=8000)
    check(ev(A + ".g.sleep[1]") == 0 and ev(A + ".g.st.turn") == 2, "son tour est saute (le trait passe au suivant)")

    # ---- GhorGhor le vrai : cinematique + aura
    ev(A + ".g.paused = false")
    ev("() => { %s.ghorTransform(3); }" % A)
    pg.wait_for_selector(".ro-ghorov")
    pg.wait_for_timeout(900)
    if SH: pg.screenshot(path=os.path.join(SH, "fx_ghor.png"))
    pg.wait_for_function(A + ".g.seats[3].id === 'ghorreal'", timeout=20000)
    check(ev("document.getElementById('ro-board').classList.contains('ghorfx')") and pg.locator(".pc.ghorpc").count() >= 8, "aura rouge sur le plateau et les pieces de GhorGhor")
    pg.wait_for_timeout(1500)
    if SH: pg.screenshot(path=os.path.join(SH, "fx_ghor_after.png"))
    ev(A + ".back()")
    check(pg.locator(".ro-wheel,.ro-ghorov").count() == 0, "aucun calque oublie en quittant")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
print("ECHECS :", BAD if BAD else "aucun")
raise SystemExit(1 if BAD else 0)
