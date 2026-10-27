"""Modules natifs du téléphone (sans PC) : Labo audio, Images & animations, Mode Chill, Compression, Abonnements."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    # -------------------------------------------------------------- hub : plus de tuile « PC » pour ces outils
    pg.click('#tabbar [data-tab="tools"]'); pg.evaluate("window.ENOS.tools.show('')")
    for mid in ["audiolab", "sprites", "chill", "compress", "subs", "defis", "advisor"]:
        check(pg.locator('.mtile[data-m="%s"]' % mid).count() == 1, "tuile native : " + mid)
    for mid in ["b-ch", "b-au", "b-cp", "b-ip", "b-av", "b-subs", "b-dm", "b-df", "b-st"]:
        check(pg.locator('.mtile[data-m="%s"]' % mid).count() == 0, "ancienne tuile PC retirée : " + mid)

    # -------------------------------------------------------------- Labo audio
    open_tool(pg, "audiolab")
    r = pg.evaluate("""async () => {
      const rate = 8000, n = rate * 3, d = new Float32Array(n);
      for (let i = 0; i < n; i++) { const t = i / rate; const on = (t > 0.3 && t < 0.8) || (t > 1.6 && t < 2.2); d[i] = on ? 0.5 * Math.sin(2 * Math.PI * 440 * t) : 0; }
      const bytes = ENOS.audioLab.wav([d], rate);
      const file = new File([bytes], 'bip.wav', {type: 'audio/wav'});
      const api = document.querySelector('#tool-audiolab .suite-body')._api;
      await api.load(file);
      const buf = api.buf;
      const segs = ENOS.audioLab.split([buf.getChannelData(0)], buf.sampleRate, -45, 0.25, 0.1);
      const p = ENOS.audioLab.process([d], rate, {gain: -6, normalize: false, fadeIn: 0.1, fadeOut: 0});
      return {dur: buf.duration, nseg: segs.length, seg0: segs[0], peak: Math.max(...p[0]), first: p[0][Math.round(0.3 * rate) + 5], wavLen: bytes.length};
    }""")
    check(abs(r["dur"] - 3) < 0.05, "fichier WAV décodé : %.2f s" % r["dur"])
    check(r["nseg"] == 2, "2 sons détectés par les silences : %s" % r["nseg"])
    check(abs(r["peak"] - 0.25) < 0.02, "gain -6 dB : pic %.3f" % r["peak"])
    check(r["wavLen"] == 44 + 8000 * 3 * 2, "WAV 16 bits : %d octets" % r["wavLen"])
    pg.wait_for_selector("#al-main:not([hidden])")
    pg.click("#al-split"); pg.wait_for_selector("#al-segs .it")
    check(pg.locator("#al-segs .it").count() == 2, "liste des sons affichée")

    # -------------------------------------------------------------- Images & animations
    pg.evaluate("window.ENOS.tools.show('')"); open_tool(pg, "sprites")
    r = pg.evaluate("""async () => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 16; const x = c.getContext('2d');
      ['#f00', '#0f0', '#00f', '#ff0'].forEach((col, i) => { x.fillStyle = col; x.fillRect(i * 16 + 3, 3, 10, 10); });
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const api = document.querySelector('#tool-sprites .suite-body')._api;
      await api.load(new File([blob], 'planche.png', {type: 'image/png'}));
      const a = api.frames.length;
      const z = ENOS.sprites.zip([{name: 'a.png', data: new Uint8Array([1, 2, 3])}, {name: 'b.png', data: new Uint8Array([4, 5])}]);
      return {frames: a, zipHead: Array.from(z.slice(0, 4)), zipLen: z.length, crc: ENOS.sprites.crc32(new TextEncoder().encode('123456789'))};
    }""")
    check(r["frames"] == 4, "4 sprites détectés automatiquement : %s" % r["frames"])
    check(r["zipHead"] == [0x50, 0x4B, 3, 4], "ZIP valide (signature PK)")
    check(r["crc"] == 0xCBF43926, "CRC32 correct")
    check("4 image" in pg.inner_text("#sp-fn"), "résumé : " + pg.inner_text("#sp-fn"))

    # -------------------------------------------------------------- Mode Chill
    pg.evaluate("window.ENOS.tools.show('')"); open_tool(pg, "chill")
    pg.click("#cl-go")
    pg.wait_for_function("document.querySelector('#tool-chill .suite-body')._api.ctx !== null")
    check(pg.evaluate("document.querySelector('#tool-chill .suite-body')._api.ctx.state") in ("running", "suspended"), "ambiance lancée (WebAudio)")
    pg.click('#cl-sleep [data-m="15"]'); pg.wait_for_timeout(1300)
    check(":" in pg.inner_text("#cl-left"), "minuteur de sommeil : " + pg.inner_text("#cl-left"))
    pg.click("#cl-stop")
    check(pg.evaluate("document.querySelector('#tool-chill .suite-body')._api.ctx") is None, "ambiance arrêtée")

    # -------------------------------------------------------------- Compression
    pg.evaluate("window.ENOS.tools.show('')"); open_tool(pg, "compress")
    r = pg.evaluate("""async () => {
      const c = document.createElement('canvas'); c.width = 1600; c.height = 1200; const x = c.getContext('2d');
      for (let i = 0; i < 400; i++) { x.fillStyle = `hsl(${(i * 37) % 360},70%,${30 + (i * 7) % 40}%)`; x.fillRect((i * 97) % 1600, (i * 53) % 1200, 120, 90); }
      const id = x.getImageData(0, 0, 1600, 1200), p = id.data; let sd = 7; for (let i = 0; i < p.length; i += 4) { sd = (sd * 1664525 + 1013904223) >>> 0; const n = (sd >>> 24) % 40 - 20; p[i] += n; p[i + 1] += n; p[i + 2] += n; } x.putImageData(id, 0, 0);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const small = await ENOS.compress.shrink(new File([blob], 'x.png'), {maxSide: 800, quality: 0.6});
      const target = await ENOS.compress.shrink(new File([blob], 'x.png'), {maxSide: 0, target: 400000});
      return {orig: blob.size, small: small.blob.size, w: small.w, tsize: target.blob.size, over: !!target.over};
    }""")
    check(r["small"] < r["orig"] / 3 and r["w"] == 800, "image réduite : %d -> %d octets, %d px" % (r["orig"], r["small"], r["w"]))
    check(r["tsize"] <= 400000 or r["over"], "taille cible : %d octets (cible trop basse : %s)" % (r["tsize"], r["over"]))

    # -------------------------------------------------------------- Abonnements
    pg.evaluate("window.ENOS.tools.show('')"); open_tool(pg, "subs")
    pg.evaluate("""() => { ENOS.settings.set('subs.list', [
      {id: 'a', name: 'Netflix', price: 13.5, cur: 'EUR', freq: 'monthly', next: '2020-01-05', status: 'active', url: 'https://www.netflix.com/youraccount'},
      {id: 'b', name: 'Assurance', price: 120, cur: 'EUR', freq: 'yearly', next: '2030-06-01', status: 'active', url: ''},
      {id: 'c', name: 'Ancien', price: 9, cur: 'EUR', freq: 'monthly', next: '2020-01-01', status: 'cancelled', url: ''}]);
      const api = document.querySelector('#tool-subs .suite-body')._api; api.list.length = 0; ENOS.settings.get('subs.list', []).forEach(x => api.list.push(x)); api.render(); }""")
    t = pg.evaluate("ENOS.subs.totals(ENOS.settings.get('subs.list', []))")
    check(abs(t["month"] - (13.5 + 10)) < 0.01 and t["n"] == 2, "total mensuel : %s" % t)
    nd = pg.evaluate("ENOS.subs.daysTo(ENOS.subs.nextDate(ENOS.settings.get('subs.list', [])[0]))")
    check(0 <= nd <= 31, "prochain prélèvement mensuel recalculé dans le futur : %d j" % nd)
    check(pg.locator("#sb-list .sb-c").count() == 2, "2 cartes d'abonnements actifs")
    check("Netflix" in pg.inner_text("#sb-list") and pg.locator('#sb-list a[href^="https://www.netflix.com"]').count() == 1, "lien « Gérer / Annuler »")
    check(not errs, "aucune erreur JavaScript : %s" % errs)
print("\n%d échec(s)" % len(BAD))
