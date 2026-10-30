"""CinePulse mobile : boutons d'import visibles, l'accélérateur apparaît dès qu'une vidéo est posée sur la timeline."""
import os, subprocess, tempfile
from mobile_common import *

errs = []
vid = os.path.join(tempfile.mkdtemp(), "t.webm")
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    open_tool(pg, "cinepulse")
    check(pg.is_visible("#cp-impv"), "bouton « Importer une vidéo » visible dès l'ouverture")
    check(pg.is_visible("#cp-imp2"), "bouton « 📥 Importer » dans la barre de la timeline")
    check(pg.is_visible(".cp-insp-hint") and "ACCÉLÉRATEUR" in pg.inner_text(".cp-insp-hint"), "l'accélérateur est annoncé même sans clip")
    # une vraie vidéo (générée par le navigateur : MediaRecorder sur un canvas) importée par le bouton
    data = pg.evaluate("""async () => { const c = document.createElement('canvas'); c.width = 160; c.height = 90; const x = c.getContext('2d'); const st = c.captureStream(15), r = new MediaRecorder(st, {mimeType: 'video/webm'}), ch = [];
      r.ondataavailable = e => ch.push(e.data); r.start(); for (let i = 0; i < 20; i++) { x.fillStyle = 'hsl(' + i * 18 + ',80%,50%)'; x.fillRect(0, 0, 160, 90); await new Promise(r => setTimeout(r, 70)); }
      await new Promise(res => { r.onstop = res; r.stop(); }); const b = new Blob(ch, {type: 'video/webm'}); return Array.from(new Uint8Array(await b.arrayBuffer())); }""")
    open(vid, "wb").write(bytes(data))
    with pg.expect_file_chooser() as fc:
        pg.click("#cp-impv")
    fc.value.set_files(vid)
    pg.wait_for_selector(".cp-clip", timeout=15000)
    check(pg.locator(".cp-clip").count() == 1, "la vidéo est posée sur la timeline")
    pg.wait_for_selector(".cp-insp:not([hidden])", timeout=5000)
    check("VITESSE" in pg.inner_text(".cp-insp") and pg.locator(".cp-insp [data-sp]").count() >= 5, "l'accélérateur ⚡ s'affiche (vitesses prédéfinies)")
    check(pg.is_hidden(".cp-insp-hint"), "l'indication disparaît quand l'inspecteur est là")
    pg.click('.cp-insp [data-sp="2"]')
    pg.wait_for_timeout(300)
    check(pg.evaluate("document.querySelector('.cp-insp [data-sp=\"2\"]').classList.contains('on')"), "vitesse 2× appliquée")
    check(not errs, "aucune erreur JavaScript : %s" % errs[:2])
    b.close()
import sys
sys.exit(1 if BAD else 0)
