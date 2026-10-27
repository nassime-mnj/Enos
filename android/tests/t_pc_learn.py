"""Version PC (static/learn) : onglets Apprendre / Conseiller, lecture d'une capture d'écran et chasse aux brillants avec le moteur navigateur.
Lancer avec un serveur statique sur static/learn (port PC_PORT, 8803 par défaut) : voir run_pc_learn.sh"""
import base64, os
from playwright.sync_api import sync_playwright
from mobile_common import check, launch, BAD

PORT = os.environ.get("PC_PORT", "8803")
SETS = os.environ.get("PIECE_SETS", r"C:\Users\samim\AppData\Local\Temp\pieces_dl\sets")
LEGAL = "rn1qkbnr/ppp2ppp/3p4/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 5"


def pieces_of(name):
    d = os.path.join(SETS, name)
    return {(t if c == "w" else t.lower()): base64.b64encode(open(os.path.join(d, c + t + ".svg"), "rb").read()).decode() for c in "wb" for t in "KQRBNP"}


errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto("http://127.0.0.1:%s/index.html" % PORT)
    pg.wait_for_selector("#tabs")
    pg.wait_for_function("window.ENOS && ENOS.learnLib && ENOS.learnLib.puzzles", timeout=30000)
    check(pg.locator("#app-learn .card").count() >= 1, "onglet Apprendre monté")
    pg.click('#tabs [data-t="advisor"]')
    pg.wait_for_selector("#ad-board .cb-sq", timeout=30000)
    check(pg.evaluate("typeof ENOS.brain === 'object' && typeof ENOS.boardScan === 'object'"), "Conseiller monté (cerveau + reconnaissance chargés)")
    pg.add_script_tag(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "scan_synth.js"))
    pg.evaluate("""async ([b64, fen]) => {
      const imgs = {}; for (const [k, v] of Object.entries(b64)) imgs[k] = await SYNTH.load('image/svg+xml', v);
      const r = SYNTH.render({pieces: imgs, theme: 'brown', s: 64, fen, flipped: false, seed: 4, last: ['d7', 'd6'], dots: true});
      window._truth = r.truth;
      await document.querySelector('#app-advisor')._loadShot(r.canvas);
    }""", [pieces_of("cburnett"), LEGAL])
    pg.wait_for_function("document.querySelector('#ad-found').textContent.includes('repéré')", timeout=20000)
    bad = pg.evaluate("(() => { const G = document.querySelector('#app-advisor')._api.G, t = window._truth, m = G.map; const ks = new Set([...Object.keys(m), ...Object.keys(t)]); return [...ks].filter(k => (m[k]||'') !== (t[k]||'')); })()")
    check(not bad, "position lue sur la page PC : %s" % bad)
    pg.click("#ad-lvl [data-l=fast]"); pg.click("#ad-go")
    pg.wait_for_selector("#ad-list .ad-it", timeout=60000)
    items = pg.evaluate("[...document.querySelectorAll('#ad-list .ad-it')].map(e => e.innerText.replace(/\\n/g, ' '))")
    check(any("Nxe5" in i and "BRILLANT" in i for i in items), "Nxe5 !! BRILLANT trouvé sur la page PC : %s" % items[:2])
    check(not errs, "aucune erreur JavaScript : %s" % errs)
print("\n%d échec(s)" % len(BAD))
