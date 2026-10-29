"""CinePulse mobile : vitesse (accélérateur), flou gaussien et filtres, volume, découpe à vitesse variable, export vidéo réel (MediaRecorder)."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    open_tool(pg, "cinepulse")
    body = "document.querySelector('#tool-cinepulse .suite-body')"
    # fabrique une vraie vidéo WebM (canvas animé + son) dans la page, puis l'importe comme le ferait le sélecteur de fichiers
    pg.evaluate("""async () => {
      const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180; const g = cv.getContext('2d');
      const ac = new AudioContext(), dst = ac.createMediaStreamDestination(), o = ac.createOscillator(); o.connect(dst); o.start();
      const st = cv.captureStream(25); dst.stream.getAudioTracks().forEach(t => st.addTrack(t));
      const rec = new MediaRecorder(st, {mimeType: 'video/webm;codecs=vp8,opus'}), ch = []; rec.ondataavailable = e => ch.push(e.data);
      rec.start(100); const t0 = performance.now();
      await new Promise(res => { const f = () => { const t = (performance.now() - t0) / 1000; g.fillStyle = `hsl(${t * 120},80%,50%)`; g.fillRect(0, 0, 320, 180); g.fillStyle = '#fff'; g.fillRect(20 + t * 80, 70, 40, 40); if (t < 3) requestAnimationFrame(f); else res(); }; f(); });
      rec.stop(); await new Promise(r => rec.onstop = r); o.stop();
      window.__file = new File(ch, 'test.webm', {type: 'video/webm'});
    }""")
    pg.evaluate(f"{body}._api.importList([window.__file])")
    pg.wait_for_function(f"{body}._api.S.assets.length === 1", timeout=15000)
    dur = pg.evaluate(f"{body}._api.S.assets[0].dur")
    check(dur > 1, "vidéo de test importée (%.1f s)" % dur)
    pg.evaluate(f"{body}._api.addClip({body}._api.S.assets[0], 'V1', 0)")
    check(pg.locator(".cp-insp:not([hidden])").count() == 1 and pg.locator(".cp-tabs button").count() == 3, "inspecteur Vitesse / Filtres / Audio affiché")
    # --- accélérateur : x2 raccourcit le clip de moitié, la source consommée reste la même
    pg.locator('[data-sp="2"]').click()
    c = pg.evaluate(f"{body}._api.S.clips[0]")
    check(abs(c["dur"] - dur / 2) < 0.01 and c["speed"] == 2, "accélérateur 2× : %.2f s -> %.2f s" % (dur, c["dur"]))
    pg.locator('[data-sp="0.5"]').click()
    c = pg.evaluate(f"{body}._api.S.clips[0]")
    check(abs(c["dur"] - dur * 2) < 0.01, "ralenti 0,5× : durée x2 (%.2f s)" % c["dur"])
    pg.locator('[data-sp="2"]').click()
    c = pg.evaluate(f"{body}._api.S.clips[0]")
    pg.evaluate(f"{body}._api.S.ph = 0.1")
    pg.click('[data-a=back]'); pg.click('[data-a=fwd]')
    check(pg.evaluate("document.querySelector('#tool-cinepulse video').playbackRate") == 2 and pg.inner_text(".cp-spd") == "2×", "aperçu : vitesse 2× et badge")
    # --- découpe à vitesse 2× : la 2e moitié reprend exactement là où la 1re s'arrête dans la source
    pg.evaluate(f"{body}._api.S.ph = {c['dur'] / 2}")
    pg.click("#cp-split")
    cl = pg.evaluate(f"{body}._api.S.clips")
    check(len(cl) == 2 and abs(cl[1]["in"] - cl[0]["dur"] * 2) < 0.02 and cl[1]["speed"] == 2, "découpe à 2× : point de coupe cohérent dans la source")
    # on garde un seul clip pour la suite
    pg.evaluate(f"{body}._api.S.clips.pop(); {body}._api.S.clips[0].dur = {c['dur']}; {body}._api.S.sel = {body}._api.S.clips[0].id")
    pg.locator('.cp-tabs [data-p="fx"]').click()
    pg.wait_for_selector('.cp-panel[data-p="fx"] [data-k="blur"]')
    pg.evaluate("""() => { const i = document.querySelector('.cp-panel[data-p="fx"] [data-k="blur"]'); i.value = 6; i.dispatchEvent(new Event('input', {bubbles: true})); }""")
    pg.evaluate(f"{body}._api.S.ph = 0.05; document.querySelector('[data-a=fwd]').click()")
    f = pg.evaluate("document.querySelector('#tool-cinepulse video').style.filter")
    check("blur(6px)" in f, "flou gaussien appliqué à l'aperçu : " + f)
    pg.locator('[data-pr="3"]').click()
    f = pg.evaluate("document.querySelector('#tool-cinepulse video').style.filter")
    check("grayscale(100%)" in f and "blur" not in f, "préréglage « Noir & blanc » : " + f)
    pg.locator('[data-pr="1"]').click(); pg.wait_for_timeout(400)
    check(pg.evaluate("getComputedStyle(document.querySelector('.cp-vig')).opacity") == "1", "préréglage « Cinéma » : vignette affichée")
    pg.locator('.cp-tabs [data-p="aud"]').click()
    pg.evaluate("""() => { const i = document.querySelector('.cp-panel[data-p="aud"] [data-k="vol"]'); i.value = 40; i.dispatchEvent(new Event('input', {bubbles: true})); }""")
    check(pg.evaluate(f"{body}._api.S.clips[0].vol") == 40, "volume du clip à 40 %")
    # --- export réel : un fichier vidéo est produit et se relit
    pg.evaluate(f"{body}._api.S.clips[0].fx = {{blur: 3, vig: 40}}")
    pg.select_option("#cp-expres", "854x480")
    pg.evaluate(f"{body}._api.exportVideo()")
    pg.wait_for_function(f"{body}._api.lastExport", timeout=60000)
    size = pg.evaluate(f"{body}._api.lastExport.size")
    check(size > 5000, "export vidéo produit un fichier : %d Ko" % (size // 1024))
    ok = pg.evaluate("""async () => {
      const v = document.createElement('video'); v.src = URL.createObjectURL(document.querySelector('#tool-cinepulse .suite-body')._api.lastExport); v.muted = true;
      await new Promise(r => v.onloadeddata = r); await v.play(); await new Promise(r => setTimeout(r, 600));
      const c = document.createElement('canvas'); c.width = 64; c.height = 36; const g = c.getContext('2d'); g.drawImage(v, 0, 0, 64, 36);
      const d = g.getImageData(0, 0, 64, 36).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      return {w: v.videoWidth, h: v.videoHeight, lum: s / (d.length / 4 * 3)};
    }""")
    check(ok["w"] == 854 and ok["h"] == 480, "le fichier exporté se relit en 854×480 : %s" % ok)
    check(ok["lum"] > 15, "l'image exportée n'est pas noire (luminosité moyenne %.0f)" % ok["lum"])
    check(not errs, "aucune erreur JavaScript : %s" % errs)
print("\n%d échec(s)" % len(BAD))
