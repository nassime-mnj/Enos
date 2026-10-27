"""Outil de mise au point : jeu de données d'entraînement pour le classifieur de pièces (board_scan.js).
Pour chaque jeu de pièces (SVG lila + Vecteezy) : captures synthétiques variées (6 thèmes de plateau, tailles de 34 à 84 px, variantes de style : normal, écrasé, étroit, épaissi, ombré, flou)
lues par le VRAI pipeline (S.read) ; on enregistre la silhouette normalisée de chaque pièce + sa vraie classe.
usage : export_scan_v2.py <sortie.json> <numéro_de_tranche> <nb_tranches>   (les jeux sont répartis entre les tranches ; tranches lancées en parallèle)"""
from mobile_common import *
import base64, os, sys, json, time

SETS = os.environ.get("PIECE_SETS", r"C:\Users\samim\AppData\Local\Temp\pieces_dl\sets")
VEC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "mobile", "img", "chess")


def set_images(name):
    out = {}
    if name == "vecteezy":
        for c in "wb":
            for t in "kqrbnp":
                out[t.upper() if c == "w" else t] = ("image/png", base64.b64encode(open(os.path.join(VEC, c + t + ".png"), "rb").read()).decode())
        return out
    d = os.path.join(SETS, name)
    for c in "wb":
        for t in "KQRBNP":
            out[t if c == "w" else t.lower()] = ("image/svg+xml", base64.b64encode(open(os.path.join(d, c + t + ".svg"), "rb").read()).decode())
    return out


JS = """async ({imgs, nboards, seed0}) => {
  const S = ENOS.boardScan, FILES = 'abcdefgh', out = [];
  const raw = {}; for (const [k, [m, v]] of Object.entries(imgs)) raw[k] = await SYNTH.load(m, v);
  const mkv = (fn) => { const o = {}; for (const k of Object.keys(raw)) { const c = document.createElement('canvas'); c.width = c.height = 192; fn(c.getContext('2d'), raw[k], k); o[k] = c; } return o; };
  const VAR = {
    normal: raw,
    short: mkv((x, im) => x.drawImage(im, 0, 192 * 0.12, 192, 192 * 0.88)),
    narrow: mkv((x, im) => x.drawImage(im, 192 * 0.06, 0, 192 * 0.88, 192)),
    thick: mkv((x, im) => { for (const [dx, dy] of [[-2,0],[2,0],[0,-2],[0,2],[-1.5,-1.5],[1.5,1.5],[1.5,-1.5],[-1.5,1.5],[0,0]]) x.drawImage(im, dx, dy, 192, 192); }),
    shadow: mkv((x, im) => { x.filter = 'blur(5px)'; x.fillStyle = 'rgba(0,0,0,0.28)'; x.beginPath(); x.ellipse(96, 178, 66, 11, 0, 0, 7); x.fill(); x.filter = 'none'; x.drawImage(im, 0, 0, 192, 192); }),
    blur: mkv((x, im) => { x.filter = 'blur(2.2px)'; x.drawImage(im, 0, 0, 192, 192); }),
  };
  const vnames = Object.keys(VAR), themes = Object.keys(SYNTH.THEMES), sizes = [34, 41.5, 52, 60, 72.5, 84];
  const fens = SYNTH.positions(nboards, seed0);
  const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  for (let i = 0; i < nboards; i++) {
    const vn = vnames[i % vnames.length], th = themes[(i * 7 + 1) % themes.length], s = sizes[(i * 5 + 2) % sizes.length], flipped = i % 2 === 1;
    const r = SYNTH.render({pieces: VAR[vn], theme: th, s, fen: fens[i], flipped, seed: seed0 + i, last: i % 3 === 0 ? ['e4', 'e5'] : null, dots: i % 2 === 0});
    const T = SYNTH.THEMES[th], rect = {x: 20, y: 60, s, light: hex(T.l), dark: hex(T.d)};
    const rd = S.read(r.canvas, rect, {flipped, noClassify: true});
    const hs = rd.squares.filter(z => z.piece).map(z => z.bh).sort((a, b) => b - a);
    for (const z of rd.squares) {
      const sq = flipped ? FILES[7 - z.c] + (z.r + 1) : FILES[z.c] + (8 - z.r), truth = r.truth[sq] || '';
      if (!truth) { if (z.piece) out.push({t: '', v: vn}); continue; }                               // fausse détection sur une case vide
      if (!z.piece || !z.norm) { out.push({t: truth, miss: 1, v: vn}); continue; }
      out.push({t: truth, v: vn, th, s, g: Array.from(z.norm.g).map(q => Math.round(q * 9)).join(''), a: +z.norm.aspect.toFixed(3), bh: z.bh, bw: z.bw, hmax: rd.hmax, lum: z.lum, lq: z.lq, lmean: z.lmean, area: +z.area.toFixed(3)});
    }
  }
  return out;
}"""

if __name__ == "__main__":
    outp, k, n = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    names = [x for x in sorted(os.listdir(SETS)) if os.path.exists(os.path.join(SETS, x, "wK.svg")) and os.path.getsize(os.path.join(SETS, x, "wK.svg")) > 50] + ["vecteezy"]
    mine = [x for i, x in enumerate(names) if i % n == k]
    res = {}
    t0 = time.time()
    with sync_playwright() as pw:
        b, ctx = launch(pw)
        pg = ctx.new_page(); pg.goto(URL); pg.wait_for_selector("#tabbar")
        pg.add_script_tag(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "scan_synth.js"))
        pg.wait_for_function("window.SYNTH && typeof Chess !== 'undefined'")
        for nm in mine:
            res[nm] = pg.evaluate(JS, {"imgs": set_images(nm), "nboards": int(os.environ.get("NB", "36")), "seed0": 11})
            print(nm, len(res[nm]), "échantillons", int(time.time() - t0), "s", flush=True)
            json.dump(res, open(outp, "w"))
        b.close()
    print("fini", flush=True)
