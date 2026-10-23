"""Échecs autonomes (chess.js + Stockfish.js dans un Worker) et CinePulse mobile (soundboard, timeline, magnétisme, zoom)."""
import os
from mobile_common import *

HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLES = os.path.join(HERE, "..", "..", "CinePulse", "samples")
START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)

    # ---------------------------------------------------------------- échecs locaux
    st = pg.evaluate("ENOS.chessLocal.call('/state', {fen: %r})" % START)
    check(len(st["legal"]) == 20 and not st["over"], "règles : 20 coups légaux au départ")
    r = pg.evaluate("ENOS.chessLocal.call('/play', {fen: %r, uci: 'e2e4', power: 20, answer: true})" % START)
    check(r["san"] == "e4" and r["reply"] and len(r["reply"]["uci"]) >= 4, "Stockfish répond : " + str(r.get("reply")))
    check("eval" in r and ("cp" in r["eval"] or "mate" in r["eval"]), "évaluation renvoyée")
    mate = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"
    st = pg.evaluate("ENOS.chessLocal.call('/state', {fen: %r})" % mate)
    check("mat" in st["over"].lower() or "pat" in st["over"].lower(), "fin de partie détectée : " + st["over"])
    try:
        pg.evaluate("ENOS.chessLocal.call('/play', {fen: %r, uci: 'e2e5', power: 20})" % START)
        check(False, "coup illégal refusé")
    except Exception:
        check(True, "coup illégal refusé")

    # interface : jouer e2-e4 au doigt
    pg.click('#tabbar [data-tab="tools"]'); pg.evaluate("ENOS.tools.show('')"); pg.click('.mtile[data-m="chess"]'); pg.wait_for_selector("#ch-board .sq")
    pg.click("#ch-new"); pg.click("#nw-go")
    pg.wait_for_function("document.querySelector('#ch-status').textContent.includes('À toi')", timeout=15000)
    pg.click('#ch-board [data-sq="e2"]'); pg.click('#ch-board [data-sq="e4"]')
    pg.wait_for_function("document.querySelectorAll('#ch-moves span').length >= 2", timeout=60000)
    check(True, "partie jouée dans l'interface : " + pg.inner_text("#ch-moves"))
    g = pg.evaluate("""() => { const b = document.querySelector('#ch-board'), r = b.getBoundingClientRect(), p = b.parentElement, cs = getComputedStyle(p);
      const inner = p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const sq = b.querySelector('.sq.l'), sd = b.querySelector('.sq.d');
      return { w: r.width, h: r.height, inner, pieces: b.querySelectorAll('img.pce').length, imgs: [...b.querySelectorAll('img.pce')].every(i => i.naturalWidth > 0),
               light: getComputedStyle(sq).backgroundColor, dark: getComputedStyle(sd).backgroundColor, tr: getComputedStyle(b.querySelector('img.pce')).transitionDuration }; }""")
    check(abs(g["w"] - g["h"]) < 1.5 and g["w"] >= g["inner"] - 2, "plateau carré (aspect 1/1) et pleine largeur : %.0fx%.0f / %.0f" % (g["w"], g["h"], g["inner"]))
    check(g["pieces"] >= 30 and g["imgs"], "pièces en images (PNG chargés) : %d" % g["pieces"])
    check(g["light"] == "rgb(238, 238, 210)" and g["dark"] == "rgb(118, 150, 86)", "couleurs Chess.com : %s / %s" % (g["light"], g["dark"]))
    snd = pg.evaluate("""async () => { await ENOS.chessSound.play('capture'); await ENOS.chessSound.play('move'); await ENOS.chessSound.play('check'); return typeof AudioContext; }""")
    check(snd == "function", "effets sonores Web Audio sans erreur")

    slide = pg.evaluate("""async () => {
      const b = document.querySelector('#ch-board'), E = ENOS, START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      const after = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
      E.board.render(b, E.board.parse(START).m, {});
      const img = [...b.querySelectorAll('img.pce')].find(i => i.style.transform.replace(/ /g, '') === 'translate(400%,600%)');
      E.board.render(b, E.board.parse(after).m, { anim: 'e2e4' });
      const mid = new Promise(r => setTimeout(() => r(getComputedStyle(img).transform), 90));
      await new Promise(r => setTimeout(r, 400));
      return { same: img.isConnected && img.style.transform.replace(/ /g, '') === 'translate(400%,400%)', mid: await mid, n: b.querySelectorAll('img.pce').length };
    }""")
    check(slide["same"] and slide["n"] == 32, "le MÊME pion glisse de e2 vers e4 (32 pièces conservées)")
    m = slide["mid"]
    check(m not in ("none", "matrix(1, 0, 0, 1, 0, 0)"), "position intermédiaire pendant l'animation : " + m)

    # ---------------------------------------------------------------- grille des modules
    pg.evaluate("ENOS.tools.show('')"); pg.click('#tabbar [data-tab="tools"]'); pg.wait_for_selector(".mtile")
    over = pg.evaluate("""() => [...document.querySelectorAll('.mtile')].filter(t => t.scrollWidth > t.clientWidth + 1 || [...t.querySelectorAll('b,small')].some(x => x.scrollWidth > x.clientWidth + 1)).map(t => t.dataset.m)""")
    check(not over, "aucune carte de module ne déborde (412 px) : %s" % over[:6])
    cols = pg.evaluate("getComputedStyle(document.querySelector('.mod-grid')).gridTemplateColumns.split(' ').length")
    check(cols == 2, "grille en 2 colonnes sur téléphone : %d" % cols)

    # ---------------------------------------------------------------- CinePulse mobile
    pg.evaluate("ENOS.tools.show('')")
    open_tool(pg, "cinepulse")
    with pg.expect_file_chooser() as fc:
        pg.click("#cp-imp")
    fc.value.set_files([os.path.join(SAMPLES, "kick.wav"), os.path.join(SAMPLES, "nappe_220.wav")])
    pg.wait_for_selector(".cp-pad .cp-add >> nth=1")
    check(pg.locator(".cp-pad").count() == 2, "2 médias dans la soundboard")
    pg.locator(".cp-add").nth(1).click()          # nappe (6 s) au curseur 0
    pg.locator(".cp-add").nth(0).click()          # kick au curseur 0 : piste A2 car A1 est occupée
    pg.wait_for_selector(".cp-clip")
    n = pg.evaluate("document.querySelectorAll('.cp-clip').length")
    tracks = pg.evaluate("[...document.querySelectorAll('.cp-clip')].map(c => c.parentElement.dataset.t)")
    check(n == 2 and sorted(tracks) == ["A1", "A2"], "clips posés sur des pistes libres : %s" % tracks)

    small = pg.evaluate("""() => [...document.querySelectorAll('.cp button, .cp .cp-grip')].filter(b => b.offsetParent && !b.closest('[hidden]')).map(b => { const r = b.getBoundingClientRect(); return [b.id || b.className, Math.round(r.width), Math.round(r.height)]; }).filter(x => x[1] < 44 || x[2] < 44)""")
    check(not small, "toutes les cibles tactiles >= 44x44 px : %s" % small[:5])
    ov = pg.evaluate("getComputedStyle(document.querySelector('.cp-scroll')).overflowX + '/' + getComputedStyle(document.querySelector('.cp-scroll')).webkitOverflowScrolling")
    check(ov.startswith("scroll"), "timeline en overflow-x:scroll : " + ov)
    # déplacer le kick (A2) vers le bord droit de la nappe (≈ 6 s) : doit s'aimanter à 6.000
    pg.set_viewport_size({"width": 900, "height": 860}); pg.wait_for_timeout(300); pg.click("#cp-fit")
    pg.locator('.cp-lane[data-t="A2"] .cp-clip').scroll_into_view_if_needed()
    pps = pg.evaluate("parseFloat(document.querySelector('.cp-lane[data-t=A1] .cp-clip').style.width) / 6.0")
    box = pg.locator('.cp-lane[data-t="A2"] .cp-clip').bounding_box()
    x0, y0 = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    pg.mouse.move(x0, y0); pg.mouse.down()
    pg.mouse.move(x0 + 6.0 * pps - 3, y0, steps=8)        # 3 px avant le bord : dans le rayon d'aimantation
    tip = pg.inner_text(".cp-tip")
    pg.mouse.up()
    check("0:06.000" in tip and "Fin de clip" in tip, "aimantation à la fin de la nappe : " + tip)
    left = pg.evaluate("parseFloat(document.querySelector('.cp-lane[data-t=A2] .cp-clip').style.left) / %s" % pps)
    check(abs(left - 6.0) < 0.001, "position finale = 6.000 s (%.4f)" % left)

    # zoom : à 40 px/ms la règle doit afficher des millisecondes
    pg.evaluate("document.querySelector('#cp-zoom').value = 1000; document.querySelector('#cp-zoom').dispatchEvent(new Event('input'))")
    check("px/ms" in pg.inner_text("#cp-sc"), "zoom maximal : " + pg.inner_text("#cp-sc"))

    # lecture : la tête avance puis s'arrête
    pg.evaluate("document.querySelector('#cp-fit').click()")
    pg.click('[data-a="play"]')
    pg.wait_for_function("document.querySelector('.cp-tc').textContent !== '00:00:00:00'", timeout=8000)
    check(True, "lecture : timecode " + pg.inner_text(".cp-tc"))
    pg.click('[data-a="play"]')
    b.close()

check(not errs, "aucune erreur JS : %s" % errs[:3])
print("RESULTAT :", "ECHEC %d" % len(BAD) if BAD else "TOUT PASSE")
