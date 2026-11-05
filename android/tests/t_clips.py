"""Game Clips : scène héros / antagoniste (Stockfish.js), enregistrement dans l'historique, module, passage au Chess Edit."""
import time
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    pg.set_default_timeout(200000)
    ev = pg.evaluate
    pg.wait_for_function("window.ENOS && ENOS.clips && ENOS.chessLocal && ENOS.brain && ENOS.editMap")
    check(ev("ENOS.clips.BOTS.length") == 10 and ev("ENOS.clips.nameOf('eto')") == "ETO Brillant", "10 personnages disponibles")
    t0 = time.time()
    rec = ev("""async () => { const steps = [];
        const r = await ENOS.clips.run({ hero: 'eto', ant: 'lelex', heroColor: 'w', intensity: 'theatre', maxPlies: 20, times: { think: 70, heroTop: 90, heroSac: 140, antLines: 90, antTop: 70, antSac: 110, evalMs: 70 } },
          (s) => { steps.push([s.ply, s.role, s.key, s.gift]); });
        window.__steps = steps; return r; }""")
    print("tournage : %.0f s, %d coups" % (time.time() - t0, rec["plies"] if rec else 0))
    check(rec and rec["plies"] >= 14, "scène tournée : %s coups, %s" % (rec["plies"], rec["result"]))
    ok = ev("""(rec) => { const c = new Chess(); let legal = true; rec.mv.forEach((m) => { const x = c.move({ from: m[0].slice(0, 2), to: m[0].slice(2, 4), promotion: m[0][4] }); if (!x || x.san !== m[1]) legal = false; });
        return { legal, pgn: c.pgn() === rec.pgn, fmt: rec.mv.every((m) => m.length === 6 && typeof m[2] === 'string' && typeof m[4] === 'number'), keys: rec.mv.map((m) => m[2]), heroSide: rec.mv.filter((m, i) => i % 2 === 0).map((m) => m[2]), antSide: rec.mv.filter((m, i) => i % 2 === 1).map((m) => m[2]) }; }""", rec)
    check(ok["legal"] and ok["pgn"], "tous les coups sont légaux et le PGN correspond")
    check(ok["fmt"] and rec["clip"]["hero"] == "eto" and rec["clip"]["ant"] == "lelex" and rec["id"] == "clip" and rec["pw"] == "ETO Brillant" and rec["pb"] == "Lelex", "format identique aux parties des Défis + méta de la scène")
    check(all(k in ("book", "best", "brilliant") for k in ok["heroSide"]), "le héros ne joue que des coups de théorie / meilleurs / brillants : %s" % ok["heroSide"])
    check(all(k in ("book", "good", "inaccuracy", "mistake", "blunder") for k in ok["antSide"]) and ok["antSide"][:3] == ["book"] * 3, "l'antagoniste joue plausible dans l'ouverture (aucune gaffe avant le coup 8) : %s" % ok["antSide"])
    # --- ouvertures mises en scène : Scandinave (Lelex en Noir) et Alien Gambit (Nasko en Blanc) + son
    check(rec["mv"][1][0] == "d7d5" and rec["mv"][5][0] == "d5a5" and rec["clip"]["opening"] == "scand", "Lelex (Noirs) sort la SCANDINAVE : %s" % [m[1] for m in rec["mv"][:6]])
    al = ev("""async () => { const r = await ENOS.clips.run({ hero: 'nasko', ant: 'eto', heroColor: 'w', intensity: 'subtle', maxPlies: 14, times: { think: 60, heroTop: 80, heroSac: 100, antLines: 80, antTop: 60, antSac: 80, evalMs: 60 } }, () => {});
      const M = ENOS.editMap, pl = M.gamePlies(r), tl = M.buildViral(pl, r, null, { voices: true }); return { san: r.mv.slice(0, 11).map((m) => m[1]), k: r.mv[10][2], alien: r.clip.alien, sfx: tl.sfx.filter((x) => x.id === 'rec' || x.id === 'witty').map((x) => [x.id, x.bus, x.ply]) }; }""")
    check(al["san"][-1] == "Nxf7" and al["k"] == "brilliant" and al["alien"] == 11, "Nasko (Blancs) : ALIEN GAMBIT, Cxf7 = brillant (%s)" % " ".join(al["san"]))
    check(["rec", "epic", 11] in al["sfx"], "le sacrifice joue l'enregistrement avec l'écho épique : %s" % al["sfx"])
    check(len(rec["ch"]) >= 1 and rec["ch"][0][1] == "eto" and all(len(c) == 4 and isinstance(c[0], int) for c in rec["ch"]), "répliques de personnages dans le format du Chess Edit : %s" % rec["ch"][:2])
    # enregistrement + module
    ev("(rec) => { ENOS.clips.save(rec); }", rec)
    check(ev("ENOS.clips.list().length") == 1, "la scène est dans l'historique (defi.hist) : le Chess Edit et la sauvegarde la voient")
    open_tool(pg, "clips")
    pg.wait_for_timeout(450)
    check(pg.locator("#cl-hero option").count() == 10 and pg.locator("#cl-go").is_visible() and pg.locator(".cl-item").count() == 1, "module Game Clips : choix du héros / de l'antagoniste / de l'intensité + liste des scènes")
    # le Chess Edit prend la scène
    pg.click(".cl-item [data-t]")
    pg.wait_for_selector("#ce-game", timeout=10000)
    pg.wait_for_function("document.querySelector('#ce-gs') && document.querySelector('#ce-gs').textContent.includes('ETO')", timeout=10000)
    check("coups" in pg.inner_text("#ce-gs"), "le Chess Edit ouvre la scène : " + pg.inner_text("#ce-gs").replace("\\n", " ")[:80])
    r = ev("""(rec) => { const M = ENOS.editMap, pl = M.gamePlies(rec), tl = M.buildViral(pl, rec, null, {}); return { n: pl.length, ev: tl.events.filter((e) => e.from).length, intro: tl.events[0].intro.white.name, d: tl.duration }; }""", rec)
    check(r["n"] == rec["plies"] and r["ev"] == r["n"] and r["intro"] == "ETO Brillant", "montage viral généré sur la scène : %d coups, %.0f s" % (r["n"], r["d"]))
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
