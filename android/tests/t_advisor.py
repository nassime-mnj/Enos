"""Conseiller brillants : capture d'écran synthétique -> position reconnue -> chasse aux sacrifices (Stockfish.js)."""
from mobile_common import *
import base64, os

SETS = os.environ.get("PIECE_SETS", r"C:\Users\samim\AppData\Local\Temp\pieces_dl\sets")
LEGAL = "rn1qkbnr/ppp2ppp/3p4/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 5"      # 5.Nxe5! (Légal)


def pieces_of(name):
    d = os.path.join(SETS, name)
    out = {}
    for c in "wb":
        for t in "KQRBNP":
            out[t if c == "w" else t.lower()] = base64.b64encode(open(os.path.join(d, c + t + ".svg"), "rb").read()).decode()
    return out


errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    pg.add_script_tag(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "scan_synth.js"))
    open_tool(pg, "advisor")
    # capture synthétique (jeu de pièces jamais intégré aux gabarits, plateau Chess.com vert)
    pg.evaluate("""async ([b64, fen]) => {
      const imgs = {}; for (const [k, v] of Object.entries(b64)) imgs[k] = await SYNTH.load('image/svg+xml', v);
      const r = SYNTH.render({pieces: imgs, theme: 'green', s: 60, fen, flipped: false, seed: 9, last: ['d7', 'd6'], dots: true});
      window._truth = r.truth;
      await document.querySelector('#tool-advisor .suite-body')._loadShot(r.canvas);
    }""", [pieces_of("mpchess"), LEGAL])
    pg.wait_for_function("document.querySelector('#ad-found').textContent.includes('repéré')", timeout=20000)
    check(True, "échiquier repéré : " + pg.inner_text("#ad-found"))
    api = "document.querySelector('#tool-advisor .suite-body')._api.G"
    fen = pg.evaluate(f"ENOS.boardScan.fenOf({api}.map, {api}.turn)")
    ok = pg.evaluate(f"(() => {{ const m = {api}.map, t = window._truth; const keys = new Set([...Object.keys(m), ...Object.keys(t)]); let bad = []; keys.forEach(k => {{ if ((m[k]||'') !== (t[k]||'')) bad.push(k + ':' + (t[k]||'-') + '>' + (m[k]||'-')); }}); return bad; }})()")
    check(len(ok) <= 1, "position lue : %d case(s) fausse(s) %s" % (len(ok), ok))
    check(pg.evaluate(f"{api}.turn") == "w", "trait deviné d'après le coup surligné (d7-d6 joué par les Noirs -> aux Blancs)")
    # on corrige les éventuelles erreurs en posant la vraie position (test du conseil)
    pg.evaluate(f"document.querySelector('#tool-advisor .suite-body')._api.setFen({LEGAL!r})")
    pg.click("#ad-lvl [data-l=fast]")
    pg.click("#ad-go")
    pg.wait_for_selector("#ad-list .ad-it", timeout=60000)
    items = pg.evaluate("[...document.querySelectorAll('#ad-list .ad-it')].map(e => e.innerText.replace(/\\n/g, ' '))")
    print("   ", items[:5])
    check(any("Nxe5" in i for i in items), "Nxe5 est proposé")
    check(any("Nxe5" in i and "BRILLANT" in i for i in items) or any("BRILLANT" in i for i in items) or any("SACRIFICE" in i for i in items), "un sacrifice est signalé")
    check(pg.locator("#ad-arrows line").count() == 1, "flèche tracée sur le plateau")
    # jouer le conseil
    pg.click("#ad-play")
    pg.wait_for_function(f"{api}.turn === 'b'", timeout=5000)
    check(pg.evaluate(f"Object.keys({api}.map).length") >= 20, "le coup est joué sur le plateau")
    # ---- partage Android : une capture envoyée à E.N.O.S. ouvre le Conseiller et la position est lue toute seule
    pg.evaluate("window.ENOS.tools.show('')")
    pg.evaluate("""async ([b64, fen]) => {
      const imgs = {}; for (const [k, v] of Object.entries(b64)) imgs[k] = await SYNTH.load('image/svg+xml', v);
      const r = SYNTH.render({pieces: imgs, theme: 'blue', s: 70, fen, flipped: true, seed: 12, dots: false});
      const png = r.canvas.toDataURL('image/png').split(',')[1];
      document.querySelector('#ad-found').textContent = '';
      ENOS.native.pendingShare = () => png;
      ENOS.native._shared();
    }""", [pieces_of("merida"), LEGAL])
    pg.wait_for_function("document.querySelector('#ad-found').textContent.includes('repéré')", timeout=20000)
    check("Noirs en bas" in pg.inner_text("#ad-found"), "capture partagée : lue et orientation détectée : " + pg.inner_text("#ad-found")[:80])
    check(pg.evaluate("ENOS.settings.get('persona','enos') !== undefined") and pg.locator("#tool-advisor:not([hidden])").count() == 1, "le Conseiller s'est ouvert tout seul")
    check(not errs, "aucune erreur JavaScript : %s" % errs)
print("\n%d échec(s)" % len(BAD))
