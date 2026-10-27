"""Capture d'écran -> position : captures synthétiques (jeux de pièces jamais vus + jeux de la bibliothèque, 6 thèmes, plusieurs tailles, plateau retourné, JPEG).
usage : t_boardscan.py [held|lib|<jeu>]   (PIECE_SETS = dossier des jeux SVG ; NB = nombre de positions ; JPEG = qualité 0-1)"""
from mobile_common import *
from mobile_common import check, BAD
import base64, os, sys, json

SETS = os.environ.get("PIECE_SETS", r"C:\Users\samim\AppData\Local\Temp\pieces_dl\sets")
HELD = ["mpchess", "riohacha", "icpieces", "staunty", "kiwen-suwi", "totoy"]
LIB = ["cburnett", "merida", "alpha", "california"]


def pieces_of(name):
    d = os.path.join(SETS, name)
    out = {}
    for c in "wb":
        for t in "KQRBNP":
            out[t if c == "w" else t.lower()] = base64.b64encode(open(os.path.join(d, c + t + ".svg"), "rb").read()).decode()
    return out


RUN = """async ({sets, themes, sizes, nboards, jpeg}) => {
  const out = [];
  const pos = SYNTH.positions(nboards, 7);
  for (const [name, b64] of Object.entries(sets)) {
    const imgs = {}; for (const [k, v] of Object.entries(b64)) imgs[k] = await SYNTH.load('image/svg+xml', v);
    for (const th of themes) for (const s of sizes) for (let i = 0; i < pos.length; i++) {
      const flipped = i % 2 === 1;
      const r = SYNTH.render({pieces: imgs, theme: th, s, fen: pos[i], flipped, seed: i + 3, last: i % 3 === 0 ? ['e4','e5'] : null, dots: true, jpeg});
      let src = r.canvas;
      if (jpeg) { const im = new Image(); im.src = r.jpeg; await im.decode(); src = im; }
      const t0 = performance.now();
      const res = await ENOS.boardScan.scan(src);
      const dt = performance.now() - t0;
      if (!res.rect) { out.push({name, th, s, i, found: false}); continue; }
      const bad = [];
      const all = new Set([...Object.keys(r.truth), ...Object.keys(res.read.map)]);
      for (const sq of all) { if ((r.truth[sq] || '') !== (res.read.map[sq] || '')) bad.push(sq + ':' + (r.truth[sq]||'-') + '>' + (res.read.map[sq]||'-')); }
      out.push({name, th, s, i, found: true, flipped, gotFlip: res.read.flipped, exact: bad.length === 0, bad, dt: Math.round(dt), rs: res.rect.s / s});
    }
  }
  return out;
}"""

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(URL); pg.wait_for_selector("#tabbar")
    pg.add_script_tag(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "scan_synth.js"))
    pg.add_script_tag(url="data/piece_model.js")
    pg.wait_for_function("window.ENOS_PM && window.SYNTH")
    mode = sys.argv[1] if len(sys.argv) > 1 else "held"
    names = HELD if mode == "held" else LIB if mode == "lib" else [mode]
    sets = {n: pieces_of(n) for n in names if os.path.isdir(os.path.join(SETS, n))}
    jpeg = float(os.environ.get("JPEG", "0")) or None
    res = pg.evaluate(RUN, {"sets": sets, "themes": ["green", "brown", "blue", "gray", "wood", "purple"], "sizes": [38, 52.5, 80], "nboards": int(os.environ.get("NB", "4")), "jpeg": jpeg})
    by = {}
    for r in res:
        d = by.setdefault(r["name"], {"n": 0, "found": 0, "exact": 0, "sq_err": 0, "flip_ok": 0, "bad": []})
        d["n"] += 1
        if r["found"]:
            d["found"] += 1; d["exact"] += r["exact"]; d["sq_err"] += len(r["bad"]); d["flip_ok"] += (r["flipped"] == r["gotFlip"])
            if r["bad"]:
                d["bad"].append((r["th"], r["s"], r["bad"][:6]))
    tot = {"n": 0, "found": 0, "exact": 0, "sq_err": 0}
    for k, d in by.items():
        print("%-12s plateaux %3d  trouvés %3d  parfaits %3d  cases fausses %3d  orientation %3d" % (k, d["n"], d["found"], d["exact"], d["sq_err"], d["flip_ok"]))
        for kk in tot:
            tot[kk] += d[kk]
        for bb in d["bad"][:3]:
            print("      ", bb)
    print("TOTAL", tot)
    conf = {}
    sz = {}
    for r in res:
        if r["found"]:
            for bb in r["bad"]:
                k = bb.split(":")[1]
                conf[k] = conf.get(k, 0) + 1
                sz[r["s"]] = sz.get(r["s"], 0) + 1
    print("confusions :", sorted(conf.items(), key=lambda kv: -kv[1])[:14])
    print("erreurs par taille de case :", sz)
    thm = {}
    for r in res:
        if r["found"]:
            thm[r["th"]] = thm.get(r["th"], 0) + len(r["bad"])
    print("erreurs par thème :", thm)
    nf = [r for r in res if not r["found"]]
    print("non détectés :", [(r["name"], r["th"], r["s"]) for r in nf][:12])
    print("temps moyen par capture : %d ms" % (sum(r.get("dt", 0) for r in res) / max(1, len(res))))
    print("erreurs JS :", errs)
    if mode == "lib":                                              # régression : jeux standards (de la bibliothèque d'entraînement) lus parfaitement, toutes tailles / thèmes / orientations
        for n in ("cburnett", "merida", "alpha"):
            d = by[n]
            check(d["found"] == d["n"] and d["exact"] >= d["n"] - 1, "%s : %d / %d captures parfaites" % (n, d["exact"], d["n"]))
        check(not errs, "aucune erreur JavaScript")

print("\n%d échec(s)" % len(BAD))
