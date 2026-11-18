"""Échiquier façon Chess.com : GLISSER-DÉPOSER (la pièce suit le pointeur, coup joué au lâcher, coup illégal = retour) et PREMOVE (coup préparé pendant que le bot joue, en rouge, joué tout seul ensuite). Gestes réels (pointeur). Captures avec SHOTS=dossier."""
import os
from mobile_common import *
OUT = os.environ.get("SHOTS", "")
errs = []
API = "document.querySelector('#tool-defis .suite-body')._api"
def center(pg, sq):
    return pg.evaluate("""(sq) => { const el = document.querySelector('#df-board'), r = el.getBoundingClientRect(), fl = el._cb.flip, f = sq.charCodeAt(0) - 97, k = +sq[1] - 1, x = fl ? 7 - f : f, y = fl ? k : 7 - k; return [r.left + (x + 0.5) * r.width / 8, r.top + (y + 0.5) * r.height / 8]; }""", sq)
def drag(pg, a, b, shot=None):
    x0, y0 = center(pg, a); x1, y1 = center(pg, b)
    pg.mouse.move(x0, y0); pg.mouse.down()
    for k in range(1, 9): pg.mouse.move(x0 + (x1 - x0) * k / 8, y0 + (y1 - y0) * k / 8); pg.wait_for_timeout(16)
    st = pg.evaluate("(() => { const n = document.querySelector('#df-board .pce.drag'); const o = document.querySelector('#df-board .sq.dragover'); return { drag: !!n, over: o ? o.dataset.sq : '' }; })()")
    if shot and OUT: pg.screenshot(path=os.path.join(OUT, shot))
    pg.mouse.up(); return st
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(120000)
    open_tool(pg, "defis"); pg.wait_for_selector(".df-mode", state="attached")
    if OUT: os.makedirs(OUT, exist_ok=True)
    pg.evaluate("%s.launch('magnus', {color: 'w'})" % API); pg.wait_for_selector("#df-board .cb-sq")
    pg.wait_for_function("(() => { const g = %s.g; return g && !g.busy && g.ch.turn() === 'w'; })()" % API); pg.wait_for_timeout(1500)      # fin de l'animation d'ouverture du module
    # 1) coup ILLÉGAL glissé : la pièce revient
    st = drag(pg, "e2", "e5"); pg.wait_for_timeout(300)
    check(st["drag"] and st["over"] == "e5", "glisser : la pièce suit le pointeur et la case survolée s'éclaire (%s)" % st)
    check(pg.evaluate("%s.g.moves.length" % API) == 0, "coup illégal lâché : rien n'est joué, la pièce revient")
    # 2) coup glissé e2-e4
    st = drag(pg, "e2", "e4", "dnd_drag.png")
    pg.wait_for_function("%s.g.moves.length >= 1" % API, timeout=10000)
    check(pg.evaluate("%s.g.moves[0].san" % API) == "e4", "glisser-déposer : 1.e4 joué au lâcher")
    # 3) PREMOVE pendant que le bot réfléchit : d2-d4 (glissé)
    pg.wait_for_function("(() => { const g = %s.g; return g.busy || g.ch.turn() === 'b'; })()" % API, timeout=5000)
    st = drag(pg, "d2", "d4")
    pg.wait_for_function("(() => { const g = %s.g; return !!g.pre || g.moves.length >= 3; })()" % API, timeout=5000)
    pre = pg.evaluate("(() => { const g = %s.g; return { pre: g.pre, moves: g.moves.length, red: document.querySelectorAll('#df-board .sq.pre').length }; })()" % API)
    if OUT: pg.screenshot(path=os.path.join(OUT, "dnd_premove.png"))
    check(pre["pre"] == {"from": "d2", "to": "d4"} or pre["moves"] >= 3 or pg.evaluate("%s.g.moves.length" % API) >= 3, "premove glissé pendant le coup du bot (posé en rouge, ou joué aussitôt si le bot a répondu pendant le geste) : %s" % pre)
    pg.wait_for_function("%s.g.moves.length >= 3" % API, timeout=60000)
    san = pg.evaluate("%s.g.moves.map((m) => m.san)" % API)
    check(san[2] == "d4", "premove joué tout seul juste après le coup du bot : %s" % san[:3])
    # 4) premove au TOUCHER puis annulation (toucher ailleurs)
    pg.wait_for_function("(() => { const g = %s.g; return g.busy || g.ch.turn() === 'b'; })()" % API, timeout=60000)
    pg.wait_for_function("(() => { const g = %s.g; return g.ch.turn() === 'w' && !g.busy; })()" % API, timeout=60000)
    x, y = center(pg, "g1"); pg.mouse.click(x, y); x, y = center(pg, "f3"); pg.mouse.click(x, y)
    pg.wait_for_function("%s.g.moves.length >= 5" % API, timeout=10000)
    pg.wait_for_function("(() => { const g = %s.g; return g.busy || g.ch.turn() === 'b'; })()" % API, timeout=5000)
    for sq in ("b1", "c3"): x, y = center(pg, sq); pg.mouse.click(x, y)
    p1 = pg.evaluate("%s.g.pre" % API); red = pg.evaluate("document.querySelectorAll('#df-board .sq.pre').length")
    if OUT: pg.screenshot(path=os.path.join(OUT, "dnd_premove.png"))
    x, y = center(pg, "h5"); pg.mouse.click(x, y)
    p2 = pg.evaluate("%s.g.pre" % API)
    check(p1 == {"from": "b1", "to": "c3"} and red == 2 and p2 is None, "premove au toucher (Cb1-c3) puis annulé en touchant une case vide (%s -> %s)" % (p1, p2))
    other = [e for e in errs if "favicon" not in e]
    check(not other, "aucune erreur JS : %s" % other[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
