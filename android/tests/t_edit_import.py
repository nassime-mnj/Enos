"""Chess Edit : import d'une partie Chess.com (PGN) avec pseudos, classements et photos de profil -> intro VS avec les vraies photos, sans réseau."""
import base64, os, struct, tempfile, zlib
from mobile_common import *
from playwright.sync_api import sync_playwright

def png(path, rgb):
    w = h = 64; raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    ch = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + ch(b"IDAT", zlib.compress(raw)) + ch(b"IEND", b""))

PGN = '[Event "Live Chess"]\n[Site "Chess.com"]\n[White "Lelex"]\n[Black "Naskolit"]\n[Result "1-0"]\n[WhiteElo "1850"]\n[BlackElo "1790"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0'
errs = []
tmp = tempfile.mkdtemp(); a, b2 = os.path.join(tmp, "a.png"), os.path.join(tmp, "b.png"); png(a, (220, 40, 40)); png(b2, (40, 90, 220))
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(120000)
    pg.wait_for_function("window.ENOS && ENOS.editMap && ENOS.chessEdit")
    open_tool(pg, "chessedit")
    pg.fill("#ce-pgn", PGN)
    with pg.expect_file_chooser() as fc: pg.click("#ce-pwi")
    fc.value.set_files(a)
    pg.wait_for_function("document.querySelectorAll('#ce-avs img').length === 1")
    with pg.expect_file_chooser() as fc: pg.click("#ce-pbi")
    fc.value.set_files(b2)
    pg.wait_for_function("document.querySelectorAll('#ce-avs img').length === 2")
    pg.click("#ce-imp-go")
    pg.wait_for_function("document.querySelector('#ce-imp-st').textContent.startsWith('✔') || document.querySelector('#ce-imp-st').textContent.startsWith('✕')", timeout=180000)
    st = pg.inner_text("#ce-imp-st"); print(st)
    check(st.startswith("✔"), "import + analyse du PGN : %s" % st)
    r = pg.evaluate("""async () => { const rec = ENOS.settings.get('chessedit.imports', []).pop(), M = ENOS.editMap, pl = M.gamePlies(rec), tl = M.buildViral(pl, rec, null, { voices: true, intro: true, synth: true }), it = tl.events.find((e) => e.intro), I = it.intro;
      const cv = document.createElement('canvas'); cv.width = 270; cv.height = 480; const R = new ENOS.editRender.Renderer(cv, tl, {}); await R.load(); R.draw(1.5);
      const px = cv.getContext('2d').getImageData(0, 0, 4, 4).data.length; return { pw: rec.pw, pb: rec.pb, elo: [rec.pwElo, rec.pbElo], n: rec.mv.length, img: [I.white.img.slice(0, 22), I.black.img.slice(0, 22)], names: [I.white.name, I.black.name], elos: [I.white.elo, I.black.elo], loaded: Object.keys(R.av).length, px, winner: tl.events.find((e) => e.kind === 'outro').winner }; }""")
    print(r)
    check(r["pw"] == "Lelex" and r["pb"] == "Naskolit" and r["elo"] == [1850, 1790] and r["n"] == 7, "pseudos + classements lus dans le PGN Chess.com")
    check(all(x.startswith("data:image/jpeg") for x in r["img"]) and r["loaded"] >= 2, "photos de profil chargées dans l'intro (data URI, canvas non taché)")
    check(r["names"] == ["Lelex", "Naskolit"] and r["elos"] == [1850, 1790], "intro VS : vrais pseudos et classements")
    check(r["winner"] and r["winner"]["name"] == "Lelex", "vainqueur dynamique : %s" % r["winner"])
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
