"""Défis > Équipes : 2v1, 3v1, 4v1, 2v2, 3v2, 4v2 avec joueurs, bots Stockfish, personnages et chat bots ; rotation des membres, interface de réglage, partie enregistrée."""
from mobile_common import *

errs = []
API = "document.querySelector('#tool-defis .suite-body')._api"
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(120000)
    open_tool(pg, "defis")
    check(pg.locator('.df-mode[data-m="teams"]').count() == 1, "mode « Équipes » présent")
    # --- interface : 6 formats, sélecteurs de membres (joueurs / bots / personnages / chat bots)
    pg.click('.df-mode[data-m="teams"]'); pg.wait_for_selector("#su-tf")
    fm = pg.evaluate("[...document.querySelectorAll('#su-tf option')].map((o) => o.textContent)")
    check(fm == ["2 contre 1", "3 contre 1", "4 contre 1", "2 contre 2", "3 contre 2", "4 contre 2"], "6 formats : %s" % fm)
    sizes = []
    for i in range(6):
        pg.select_option("#su-tf", str(i))
        sizes.append(pg.evaluate("[document.querySelectorAll('#su-tm select[data-t=\"1\"]').length, document.querySelectorAll('#su-tm select[data-t=\"2\"]').length]"))
    check(sizes == [[2, 1], [3, 1], [4, 1], [2, 2], [3, 2], [4, 2]], "tailles d'équipes affichées : %s" % sizes)
    groups = pg.evaluate("[...document.querySelectorAll('#su-tm select[data-t=\"1\"][data-i=\"0\"] optgroup')].map((g) => g.label + ':' + g.children.length)")
    print(groups)
    check(len(groups) >= 3 and any(g.startswith("Joueurs") for g in groups) and any("Chat bots" in g for g in groups), "joueurs, bots Stockfish, personnages et chat bots proposés : %s" % groups)
    pg.select_option("#su-tf", "4")
    pg.evaluate("[...document.querySelectorAll('#su-tm select')].forEach((x, i) => { x.value = i % 2 ? 'bot:400' : 'nasko'; })")
    pg.click(".sheet button >> text=COMMENCER")
    pg.wait_for_function("%s.g && %s.g.teams && %s.g.teams.w.length === 3 && %s.g.teams.b.length === 2" % (API, API, API, API), timeout=20000)
    check(True, "départ depuis l'interface (3 contre 2) : équipes %s" % pg.evaluate("[%s.g.tname.w, %s.g.tname.b]" % (API, API)))
    pg.evaluate("%s.g.token++; ENOS.ui.closeSheet(true)" % API)
    # --- les 6 formats se lancent, rotation des membres correcte (bots rapides)
    for (a, bb) in [(2, 1), (3, 1), (4, 1), (2, 2), (3, 2), (4, 2)]:
        t1 = ["bot:400", "nasko", "eto", "lelex"][:a]; t2 = ["bot:600", "naskolit"][:bb]
        r = pg.evaluate("""async ([t1, t2]) => { const api = %s; api.launch('teams', { color: 'w', t1, t2 }); const g0 = api.g; const want = (t1.length + t2.length) * 1 + 2;
          const start = Date.now(); while (api.g.moves.length < want && Date.now() - start < 90000) await new Promise((r) => setTimeout(r, 200));
          const g = api.g, by = g.moves.map((m) => [m.color, m.by]); const ok = by.every(([c, n], i) => { const own = by.slice(0, i).filter((x) => x[0] === c).length, team = g.teams[c]; return n === team[own %% team.length].name; });
          const names = [g.tname.w, g.tname.b]; g.token++; return { n: g.moves.length, ok, names, sizes: [g.teams.w.length, g.teams.b.length], by: by.slice(0, 8) }; }""" % API, [t1, t2])
        print(a, bb, r)
        check(r["sizes"] == [a, bb] and r["n"] >= 4 and r["ok"], "%dv%d : rotation des membres respectée sur %d coups (%s)" % (a, bb, r["n"], r["names"]))
    # --- partie jouable : toi + Nasko contre ENOS ; humain joue e2e4, puis bots, puis retour à toi
    pg.evaluate("(() => { %s.launch('teams', { color: 'w', t1: ['h:Toi', 'bot:400'], t2: ['bot:400'] }); })()" % API)
    pg.wait_for_selector("#df-board .cb-sq")
    check("À toi de jouer" in pg.inner_text("#df-status"), "au 1er coup : « À toi de jouer »")
    pg.click('#df-board [data-sq="e2"]'); pg.click('#df-board [data-sq="e4"]')
    pg.wait_for_function("%s.g.moves.length >= 3" % API, timeout=90000)
    pg.wait_for_function("document.querySelector('#df-status').textContent.includes('À toi')", timeout=90000)
    by = pg.evaluate("%s.g.moves.map((m) => m.by)" % API)
    check(by[:3] == ["Toi", "Bot 400", "Bot 400 (2)"] or by[:2] == ["Toi", "Bot 400"], "joueur humain puis bots en rotation : %s" % by)
    pg.evaluate("%s.g.token++" % API)
    pg.click("#b-res"); pg.click(".sheet button >> text=ABANDONNER")
    pg.wait_for_function("%s.g.over" % API)
    rec = pg.evaluate("ENOS.settings.get('defi.hist', []).pop()")
    check(rec["pw"].startswith("Toi") and "Bot" in rec["pb"] and rec["mv"], "partie enregistrée avec les noms d'équipe : %s – %s" % (rec["pw"], rec["pb"]))
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
