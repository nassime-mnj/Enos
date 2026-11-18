"""Enregistrer / télécharger une vidéo de plusieurs dizaines de Mo : écriture PAR MORCEAUX vers le pont natif (plus de chaîne base64 géante -> plantage)."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    ctx.add_init_script("""window.__rx = { begin: 0, chunks: 0, bytes: 0, maxStr: 0, ended: null, big: 0 };
      window.Enos = new Proxy({ saveMedia(n, m, s, c) { window.__rx.big++; window.__rx.maxStr = Math.max(window.__rx.maxStr, s.length); return true; },
        saveBegin(n, m, c) { window.__rx.begin++; return true; }, saveChunk(s) { const r = window.__rx; r.chunks++; r.maxStr = Math.max(r.maxStr, s.length); r.bytes += s.length * 3 / 4 - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0); return true; }, saveEnd(ok) { window.__rx.ended = ok; return true; } },
        { get: (t, k) => (k in t ? t[k] : () => '') });""")
    pg = open_app(ctx, errs); pg.set_default_timeout(120000)
    r = pg.evaluate("""async () => {
      const u8 = new Uint8Array(40 * 1024 * 1024); for (let i = 0; i < u8.length; i += 4096) u8[i] = i & 255;
      const blob = new Blob([u8], { type: 'video/mp4' }); const t0 = performance.now();
      const ok = await ENOS.native.files.save('t.mp4', 'video/mp4', blob, 'downloads');
      const ok2 = await ENOS.ui && true; const small = await ENOS.native.files.save('s.png', 'image/png', new Uint8Array(1000), 'images');
      return { ok, small, ms: Math.round(performance.now() - t0), rx: window.__rx, size: blob.size, native: ENOS.native.available }; }""")
    print(r)
    rx = r["rx"]
    check(r["native"] and r["ok"] and rx["ended"] is True, "enregistrement natif réussi (saveEnd(true))")
    check(rx["bytes"] == r["size"], "les 40 Mo arrivent en entier : %d / %d octets en %d morceaux" % (rx["bytes"], r["size"], rx["chunks"]))
    check(rx["maxStr"] < 1100000, "aucun appel ne dépasse ~1 Mo (plus gros : %d caractères)" % rx["maxStr"])
    check(r["small"] and rx["big"] == 1, "un petit fichier reste en un seul appel")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
