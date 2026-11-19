"""Game Clips · Simultanée : 1 héros contre 4 antagonistes, et 4 héros contre 1 antagoniste. Scènes réelles (Stockfish.js, temps courts),
coups légaux par plateau, tour de table entrelacé, format de la Simultanée (le montage « plateau à plateau » du Chess Edit se construit), écran du module."""
import time
from mobile_common import *

FAST = "{ think: 60, heroTop: 80, heroSac: 110, antLines: 80, antTop: 60, antSac: 90, evalMs: 60 }"
errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(300000)
    ev = pg.evaluate
    pg.wait_for_function("window.ENOS && ENOS.clips && ENOS.chessLocal && ENOS.brain && ENOS.editSimul")
    res = {}
    for mode, center, many in (("hero", "eto", ["lelex", "ghorghor", "jester", "naskurieux"]), ("ant", "lelex", ["eto", "nasko", "penoire", "stockfish"])):
        t0 = time.time()
        r = ev("""async ([mode, center, many]) => { const steps = []; const r = await ENOS.clips.runSimul({ mode, hero: mode === 'hero' ? center : '', ant: mode === 'ant' ? center : '', many, intensity: 'theatre', maxPlies: 10, times: %s },
            (s) => steps.push(s.board)); r.__boards = [...new Set(steps)]; return r; }""" % FAST, [mode, center, many])
        print("%s : %.0f s, %d coups" % (mode, time.time() - t0, r["plies"] if r else 0))
        res[mode] = r
        S = r["simul"]
        check(len(S["boards"]) == 4 and r["__boards"] == [0, 1, 2, 3], "%s : 4 plateaux tournés l'un après l'autre" % mode)
        legal = ev("""(rec) => rec.simul.boards.every((bd) => { const c = new Chess(); return bd.mv.every((m) => { const x = c.move({ from: m[0].slice(0, 2), to: m[0].slice(2, 4), promotion: m[0][4] }); return x && x.san === m[1]; }) && bd.mv.every((m) => m.length === 7); })""", r)
        check(legal, "%s : coups légaux sur chaque plateau, format Simultanée (7 champs)" % mode)
        o = S["order"]; tot = sum(len(x["mv"]) for x in S["boards"])
        inter = ev("""(rec) => { const o = rec.simul.order, seen = rec.simul.boards.map(() => -1); for (const [b, k] of o) { if (k !== seen[b] + 1) return false; seen[b] = k; } return o.length > 6 && o[0][0] === 0 && o[2][0] === 1 && o[4][0] === 2; }""", r)
        check(len(o) == tot and inter, "%s : tour de table entrelacé (plateau 1, 2, 3…), %d coups" % (mode, tot))
        boss = S["boss"]["name"]
        check(boss == ev("(id) => ENOS.clips.nameOf(id)", center) and all(bd["mv"][0][6] == boss for bd in S["boards"]), "%s : %s joue les Blancs sur les 4 plateaux" % (mode, boss))
        keys_center = [m[2] for bd in S["boards"] for i, m in enumerate(bd["mv"]) if i % 2 == 0]
        if mode == "hero":
            check(all(k in ("book", "best", "brilliant") for k in keys_center), "1 héros : ses coups sont théorie / meilleurs / brillants sur tous les plateaux")
        else:
            keys_heroes = [m[2] for bd in S["boards"] for i, m in enumerate(bd["mv"]) if i % 2 == 1]
            check(all(k in ("book", "best", "brilliant") for k in keys_heroes), "4 héros : chacun joue théorie / meilleurs / brillants")
        tl = ev("(rec) => { const t = ENOS.editSimul.build(rec, null, {}); return { nB: t.simul.nB, vis: t.simul.vis.length, d: t.duration }; }", r)
        check(tl["nB"] == 4 and tl["vis"] >= 4 and tl["d"] > 10, "%s : montage Simultanée du Chess Edit : %s" % (mode, tl))
    # écran du module
    ev("(r) => { ENOS.clips.save(r); }", res["ant"])
    open_tool(pg, "clips"); pg.wait_for_selector("#cl-mode")
    check(pg.is_hidden("#cl-many") and pg.is_visible("#cl-colorl"), "mode Duel : héros, antagoniste, couleur")
    pg.click('#cl-mode [data-m="hero"]'); pg.click('#cl-count [data-n="4"]')
    check(pg.is_visible("#cl-many") and pg.locator("#cl-slots .bp-slot").count() == 4 and pg.is_hidden("#cl-antl") and pg.is_hidden("#cl-colorl") and "antagonistes" in pg.inner_text("#cl-manyt").lower(), "1 héros / 4 antagonistes : quatre choix d'antagonistes")
    pg.click('#cl-count [data-n="6"]'); check(pg.locator("#cl-slots .bp-slot").count() == 6, "1 contre 6")
    pg.click('#cl-count [data-n="2"]'); check(pg.locator("#cl-slots .bp-slot").count() == 2, "1 contre 2")
    pg.click('#cl-slots .bp-slot >> nth=0'); pg.wait_for_selector("#sheet .bp-q")
    n = pg.locator("#sheet .ro-bot").count(); check(n >= 130, "le plateau se choisit parmi tous les bots : %d" % n)
    pg.click('#sheet .ro-bot[data-b="r_noel"]'); pg.wait_for_timeout(300)
    check("Noel" in pg.inner_text("#cl-slots"), "bot choisi dans la liste : Noel")
    pg.click('#cl-mode [data-m="ant"]')
    check(pg.is_hidden("#cl-herol") and pg.is_visible("#cl-antl") and "héros" in pg.inner_text("#cl-manyt").lower() and "v1" in pg.inner_text("#cl-count"), "plusieurs héros / 1 antagoniste")
    check("4 plateaux" in pg.inner_text("#cl-list"), "la scène simultanée apparaît dans la liste")
    pg.wait_for_timeout(500); pg.screenshot(path=(os.environ.get("SHOTS") or "/tmp") + "/clips_simul.png")
    pg.click("#cl-list [data-t]"); pg.wait_for_selector("#ce-game", timeout=15000)
    pg.wait_for_function("document.querySelector('#ce-sum') && document.querySelector('#ce-sum').textContent.includes('Simultanée') && document.querySelector('#ce-sum').textContent.includes('Lelex')", timeout=20000)
    check(True, "Chess Edit ouvre la scène en montage Simultanée")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
