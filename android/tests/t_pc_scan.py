"""PC : static/scan_launch.js (bouton 📷 / Ctrl+V de « Mise en condition ») lit une capture d'écran et pose les pièces via window.enosCD. Serveur statique sur la RACINE du dépôt (port 8806)."""
import base64, os
from playwright.sync_api import sync_playwright
from mobile_common import check, launch, BAD

SETS = os.environ.get("PIECE_SETS", r"C:\Users\samim\AppData\Local\Temp\pieces_dl\sets")
LEGAL = "rn1qkbnr/ppp2ppp/3p4/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 5"


def pieces_of(name):
    d = os.path.join(SETS, name)
    return {(t if c == "w" else t.lower()): base64.b64encode(open(os.path.join(d, c + t + ".svg"), "rb").read()).decode() for c in "wb" for t in "KQRBNP"}


errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto("http://127.0.0.1:%s/android/tests/pc_scan_stub.html" % os.environ.get("PC_ROOT_PORT", "8806"))
    pg.add_script_tag(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "scan_synth.js"))
    # Chess (règles) pour le générateur de captures : chess.js de la page PC
    pg.add_script_tag(url="/static/learn/chess.js")
    pg.wait_for_function("window.SYNTH && typeof Chess !== 'undefined'")
    png = pg.evaluate("""async ([b64, fen]) => {
      const imgs = {}; for (const [k, v] of Object.entries(b64)) imgs[k] = await SYNTH.load('image/svg+xml', v);
      const r = SYNTH.render({pieces: imgs, theme: 'green', s: 58, fen, flipped: false, seed: 2, last: ['d7', 'd6'], dots: true});
      window._truth = r.truth; return r.canvas.toDataURL('image/png');
    }""", [pieces_of("cburnett"), LEGAL])
    raw = base64.b64decode(png.split(",")[1])
    path = os.path.join(os.environ.get("TEMP", "."), "pc_scan_test.png"); open(path, "wb").write(raw)
    pg.evaluate("document.getElementById('cd').hidden = false")
    pg.set_input_files("#cd-shotf", path)
    pg.wait_for_function("window.CALLS.some(c => c.board)", timeout=30000)
    call = pg.evaluate("window.CALLS.find(c => c.board)")
    bad = pg.evaluate("(() => { const t = window._truth, m = window.CALLS.find(c => c.board).board; return [...new Set([...Object.keys(t), ...Object.keys(m)])].filter(k => (t[k]||'') !== (m[k]||'')); })()")
    check(not bad, "position posée dans la mise en condition : %d case(s) fausse(s) %s" % (len(bad), bad))
    check(call["turn"] == "w" and call["flip"] is False, "trait (Blancs, déduit du coup surligné) et orientation : %s / flip=%s" % (call["turn"], call["flip"]))
    check(set(call["castling"]) == set("KQkq"), "droits de roque devinés : %s" % call["castling"])
    check(pg.evaluate("!document.getElementById('cd-mem').hidden"), "bouton « mémoriser » affiché")
    pg.click("#cd-mem")
    pg.wait_for_function("window.CALLS.some(c => c.msg && /mémorisée/.test(c.msg))", timeout=5000)
    check(pg.evaluate("ENOS.boardScan.memorySize()") >= 6, "formes mémorisées : %d" % pg.evaluate("ENOS.boardScan.memorySize()"))
    check(not errs, "aucune erreur JavaScript : %s" % errs)
print("\n%d échec(s)" % len(BAD))
