"""Captures d'écran de contrôle visuel des nouveaux modules (412×860). usage : shots.py <dossier_de_sortie>"""
import base64, os, sys
from mobile_common import *

OUT = sys.argv[1]
SETS = os.environ.get("PIECE_SETS", r"C:\Users\samim\AppData\Local\Temp\pieces_dl\sets")
LEGAL = "rn1qkbnr/ppp2ppp/3p4/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 5"


def pieces_of(name):
    d = os.path.join(SETS, name)
    return {(t if c == "w" else t.lower()): base64.b64encode(open(os.path.join(d, c + t + ".svg"), "rb").read()).decode() for c in "wb" for t in "KQRBNP"}


errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    pg.add_script_tag(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "scan_synth.js"))

    def shot(name):
        pg.wait_for_timeout(400)
        pg.screenshot(path=os.path.join(OUT, name + ".png"), full_page=False)

    pg.click('#tabbar [data-tab="tools"]'); pg.evaluate("window.ENOS.tools.show('')"); shot("hub")
    pg.evaluate("document.querySelector('.view[data-v=tools] .scroll').scrollTo(0, 700)"); shot("hub2")
    open_tool(pg, "defis"); shot("defis_home")
    pg.evaluate("document.querySelector('#tool-defis .suite-body')._api.launch('brillant', {color: 'w'})")
    pg.wait_for_selector("#df-board .cb-sq"); pg.click('#df-board [data-sq="e2"]'); pg.click('#df-board [data-sq="e4"]')
    pg.wait_for_function("document.querySelector('#tool-defis .suite-body')._api.g.moves.length >= 2", timeout=60000)
    pg.wait_for_function("!document.querySelector('#tool-defis .suite-body')._api.g.busy", timeout=60000)
    shot("defis_game")
    pg.evaluate("window.ENOS.tools.show('')"); open_tool(pg, "advisor")
    pg.evaluate("""async ([b64, fen]) => {
      const imgs = {}; for (const [k, v] of Object.entries(b64)) imgs[k] = await SYNTH.load('image/svg+xml', v);
      const r = SYNTH.render({pieces: imgs, theme: 'green', s: 60, fen, flipped: false, seed: 9, last: ['d7', 'd6'], dots: true});
      await document.querySelector('#tool-advisor .suite-body')._loadShot(r.canvas);
    }""", [pieces_of("cburnett"), LEGAL])
    pg.wait_for_function("document.querySelector('#ad-found').textContent.includes('repéré')", timeout=20000)
    shot("advisor_scan")
    pg.click("#ad-lvl [data-l=fast]"); pg.click("#ad-go"); pg.wait_for_selector("#ad-list .ad-it", timeout=60000)
    pg.evaluate("document.querySelector('#ad-out').scrollIntoView()"); shot("advisor_result")
    for mid in ["chill", "subs", "compress", "sprites", "audiolab"]:
        pg.evaluate("window.ENOS.tools.show('')"); open_tool(pg, mid); shot(mid)
print("ok", errs)
