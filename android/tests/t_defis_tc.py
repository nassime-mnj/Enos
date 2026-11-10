"""Défis : cadences Chess.com (bullet 1 min, blitz 3 min, rapide 10 min, différé 3 jours) : pendule, drapeau, Elo affichés plus hauts en blitz / bullet, bots rapides, parties en différé reprises."""
from mobile_common import *

errs = []
API = "document.querySelector('#tool-defis .suite-body')._api"
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(120000)
    open_tool(pg, "defis")
    pg.click('.df-mode[data-m="enos"]'); pg.wait_for_selector("#su-tc")
    opts = pg.evaluate("[...document.querySelectorAll('#su-tc option')].map((o) => o.value + ':' + o.textContent)")
    check(len(opts) == 5 and any("bullet" in o for o in opts) and any("daily" in o for o in opts), "sélecteur de cadence : %s" % opts)
    pg.evaluate("ENOS.ui.closeSheet(true)")
    # Elo affichés par cadence (même moteur, étiquette différente)
    shown = {}
    for tc in ["rapid", "blitz", "bullet", "daily"]:
        pg.evaluate("(() => { %s.launch('enos', { color: 'w', pow: 100, elo: 3200, tc: '%s' }); })()" % (API, tc))
        pg.wait_for_selector("#df-board .cb-sq")
        shown[tc] = [pg.evaluate("%s.g.pl.b.elo" % API), pg.evaluate("document.querySelectorAll('.df-clk').length")]
        pg.evaluate("%s.g.token++; clearInterval(%s.g.clkI)" % (API, API))
    print(shown)
    check(shown["rapid"][0] == 3200 and shown["blitz"][0] == 3900 and shown["bullet"][0] == 4800, "E.N.O.S. : rapide 3200, blitz 3900, bullet 4800 (étiquette) : %s" % {k: v[0] for k, v in shown.items()})
    check(shown["rapid"][1] == 2 and shown["bullet"][1] == 2 and shown["daily"][1] == 0, "pendule affichée pour les 2 camps (rapide / bullet), aucune en différé")
    pg.evaluate("(() => { %s.launch('boss', { color: 'w', boss: 'eto', tc: 'bullet' }); })()" % API)
    pg.wait_for_selector("#df-board .cb-sq")
    pe = pg.evaluate("[%s.g.pl.w.elo, %s.g.pl.b.elo, %s.g.pl.w.eloReal]" % (API, API, API)); pg.evaluate("%s.g.token++; clearInterval(%s.g.clkI)" % (API, API))
    check(pe[0] == 4900 and pe[1] == 5000 and pe[2] == 3200, "bullet : ETO 4900, Stockfish 5000 (étiquettes), force réelle conservée : %s" % pe)
    # pendule qui tourne + bot rapide + drapeau
    pg.evaluate("(() => { %s.launch('enos', { color: 'w', pow: 30, elo: 1200, tc: 'bullet' }); })()" % API)
    pg.wait_for_selector("#df-board .cb-sq")
    pg.click('#df-board [data-sq="e2"]'); pg.click('#df-board [data-sq="e4"]')
    pg.wait_for_function("%s.g.moves.length >= 2" % API, timeout=15000)
    pg.click('#df-board [data-sq="d2"]'); pg.click('#df-board [data-sq="d4"]')
    pg.wait_for_function("%s.g.moves.length >= 3" % API, timeout=15000)
    pg.wait_for_function("%s.g.moves.length >= 4" % API, timeout=15000)
    c0 = pg.evaluate("%s.g.clk.w" % API); pg.wait_for_timeout(1500); c1 = pg.evaluate("%s.g.clk.w" % API)
    check(c0 - c1 >= 1000 and c0 < 60000, "la pendule du camp au trait descend (%.1f s -> %.1f s)" % (c0 / 1000, c1 / 1000))
    check(pg.inner_text(".df-clk.on").strip() != "", "pendule active surlignée : %s" % pg.inner_text(".df-clk.on").strip())
    pg.evaluate("%s.g.clk.w = 250" % API)
    pg.wait_for_function("%s.g.over" % API, timeout=8000)
    over = pg.evaluate("%s.g.over" % API); check("Temps écoulé" in over and "Noirs" in over, "drapeau tombé : %s" % over)
    pg.evaluate("ENOS.ui.closeSheet(true)")
    # différé : sauvegarde + reprise
    pg.evaluate("(() => { %s.launch('enos', { color: 'w', pow: 20, elo: 800, tc: 'daily' }); })()" % API)
    pg.wait_for_selector("#df-board .cb-sq")
    pg.click('#df-board [data-sq="e2"]'); pg.click('#df-board [data-sq="e4"]')
    pg.wait_for_function("%s.g.moves.length >= 2" % API, timeout=30000)
    pg.wait_for_function("!%s.g.busy" % API)
    d = pg.evaluate("ENOS.settings.get('defi.daily', [])"); check(len(d) == 1 and len(d[0]["moves"]) >= 2 and d[0]["dl"] > 0, "partie en différé enregistrée (%d coups, échéance +3 j)" % len(d[0]["moves"]))
    pg.evaluate("%s.g.token++" % API); pg.click("#df-back"); pg.wait_for_selector("#df-daily [data-dres]")
    pg.click("#df-daily [data-dres]"); pg.wait_for_selector("#df-board .cb-sq")
    n = pg.evaluate("%s.g.moves.length" % API); check(n == len(d[0]["moves"]) and "À toi" in pg.inner_text("#df-status"), "reprise : %d coups rejoués, c'est à toi de jouer" % n)
    pg.evaluate("%s.g.token++" % API); pg.click("#df-back")
    d[0]["dl"] = 1; pg.evaluate("(d) => ENOS.settings.set('defi.daily', d)", d); pg.reload(); pg.wait_for_timeout(500)
    open_tool(pg, "defis"); pg.wait_for_selector("#df-daily [data-dres]"); pg.click("#df-daily [data-dres]")
    pg.wait_for_function("%s.g.over" % API, timeout=8000); check("3 jours" in pg.evaluate("%s.g.over" % API), "échéance dépassée : %s" % pg.evaluate("%s.g.over" % API))
    # Chess Edit : étiquettes d'Elo selon la cadence
    r = pg.evaluate("""() => { const M = ENOS.editMap, mk = (tc) => { const ch = new Chess(), mv = []; 'e4 e5'.split(' ').forEach((s) => { const m = ch.move(s); mv.push([m.from + m.to, m.san, 'good', 0, null, '']); }); return { t: 3, title: 'x', result: 'r', plies: 2, pw: 'E.N.O.S.', pb: 'ETO Brillant', mv, ch: [], tc }; };
      const f = (tc) => { const rec = mk(tc), tl = M.buildViral(M.gamePlies(rec), rec, null, { intro: true, synth: true }); const i = tl.events.find((e) => e.kind === 'intro').intro; return [i.white.elo, i.black.elo]; }; return { rapid: f('rapid'), blitz: f('blitz'), bullet: f('bullet') }; }""")
    check(r["rapid"] == [3200, 3200] and r["blitz"] == [3900, 4000] and r["bullet"] == [4800, 4900], "vidéo : Elo affichés par cadence %s" % r)
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
