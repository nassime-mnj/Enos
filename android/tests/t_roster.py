"""Échelle des bots (113 personnages, de 1 Elo à Magnus) : tuile des Défis -> sélecteur par catégorie -> fiche -> partie ; coups au hasard à 1 Elo ; Mittens « 1 Elo » joue à 3200 ; bots adaptatifs (+/-100) ; avatars chargés. Captures avec SHOTS=dossier."""
import os
from mobile_common import *
OUT = os.environ.get("SHOTS", "")
errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(120000)
    pg.wait_for_function("!!(window.ENOS && ENOS.botRoster)")
    r = pg.evaluate("""() => { const R = ENOS.botRoster; return { pietro: (ENOS_BOT_LINES.r_pietro.bot_brilliant || [])[0], jynxzi: R.byId.r_jynxzi.elo, chessgpt: [R.byId.r_chessgpt.elo, R.byId.r_chessgpt.sub], magnus: ENOS.aiBots.def.magnus.elo, n: R.list.length, cats: R.CATS.length, per: R.CATS.map(([c]) => R.list.filter((b) => b.cat === c).length), linked: R.list.filter((b) => b.link).map((b) => b.link),
      noel: ENOS_AIPROF.r_noel.skill, mittens: ENOS_AIPROF.r_mittens.skill, magnusImg: ENOS.aiBots.def.magnus.img, elos: [R.byId.r_noel.elo, R.byId.r_mittens.elo, R.byId.r_mittens.real] }; }""")
    print(r)
    check(r["chessgpt"][0] == 3000 and "ChatGPT Prime" in r["chessgpt"][1] and r["magnus"] == 2882, "Elo de la planche (ChessGPT 3000, distinct de ChatGPT Prime ; Magnus 2882)")
    check(r["pietro"] == "What a move. What a masterclass!" and r["jynxzi"] == 450, "Pietro parle avec ses phrases fétiches ; Jynxzi à 450 Elo")
    check(r["n"] == 113 and r["cats"] == 11, "113 bots en 11 catégories : %s" % r["per"])
    check(sorted(r["linked"]) == ["hikaru", "levy", "magnus", "turk"], "Magnus, Hikaru, Levy et le Turc réutilisent leurs profils")
    check(r["noel"]["random"] == 1 and r["mittens"]["random"] == 0 and r["mittens"]["blunder"] == 0, "1 Elo = coups au hasard ; Mittens joue sans gaffe")
    check(r["elos"] == [1, 1, 3200] and r["magnusImg"] == "img/roster/magnus_carlsen.png", "Mittens affiche 1 Elo et joue à 3200 ; Magnus a son portrait")
    open_tool(pg, "defis"); pg.wait_for_selector(".df-mode", state="attached"); pg.wait_for_timeout(1200)
    sec = pg.evaluate("""() => [...document.querySelectorAll('#df-home .hub-sec')].map((x) => [x.querySelector('h4 span').innerText.trim(), [...x.querySelectorAll('.df-mode')].map((b) => b.dataset.m)])""")
    titles = [t for t, _ in sec]; d = dict(sec); print(titles)
    check(titles[:2] == ["BOTS E.N.O.S.", "LÉGENDES"] or titles[:2] == ["Bots E.N.O.S.", "Légendes"], "accueil rangé par familles : %s" % titles[:6])
    check({"brillant", "nasko", "jester"} <= set(d.get(titles[0], [])) and {"boss", "r_mittens", "obsidian", "r_pal_9000"} <= set(d.get(titles[1], [])), "Bots E.N.O.S. (tes personnages) puis Légendes (Stockfish 19, Mittens, moteurs, PAL 9000…)")
    allm = [m for _, ms in sec for m in ms]
    check(all(b in allm for b in pg.evaluate("ENOS.botRoster.list.map((b) => b.id)")) and "roster" not in allm, "les 113 bots de l'échelle sont rangés dans leurs familles (plus de tuile « Bots » à part)")
    pg.locator('.df-mode[data-m="r_witty_alien"]').scroll_into_view_if_needed(); pg.wait_for_timeout(600)
    bad = pg.evaluate("[...document.querySelectorAll('#df-home img.hub-av')].filter((i) => i.getBoundingClientRect().top < innerHeight && i.getBoundingClientRect().bottom > 0 && !(i.complete && i.naturalWidth > 0)).length")
    check(bad == 0, "avatars visibles chargés (%d manquants)" % bad)
    if OUT: os.makedirs(OUT, exist_ok=True); pg.screenshot(path=os.path.join(OUT, "roster_pick.png"))
    pg.locator('.df-mode[data-m="r_mittens"]').scroll_into_view_if_needed(); pg.click('.df-mode[data-m="r_mittens"]'); pg.wait_for_selector(".ro-head", timeout=8000)
    check("joue à 3200" in pg.inner_text(".ro-head"), "fiche de Mittens : « affiche 1 Elo… joue à 3200 »")
    if OUT: pg.screenshot(path=os.path.join(OUT, "roster_mittens.png"))
    pg.evaluate("ENOS.ui.back()"); pg.wait_for_selector("#sheet", state="hidden", timeout=5000)
    # partie contre Noel (1 Elo) : il joue au hasard, la partie avance
    API = "document.querySelector('#tool-defis .suite-body')._api"
    pg.evaluate("%s.launch('r_noel', {color: 'w'})" % API); pg.wait_for_selector("#df-board .cb-sq")
    for k in range(3):                                                        # coups légaux choisis selon la position (Noel joue au hasard)
        pg.wait_for_function("(() => { const g = %s.g; return g && !g.busy && g.ch.turn() === 'w' && g.moves.length === %d; })()" % (API, 2 * k), timeout=120000)
        f, t = pg.evaluate("(() => { const ms = %s.g.ch.moves({ verbose: true }).filter((m) => !m.promotion); const m = ms.find((x) => x.san === 'e4' || x.san === 'd4' || x.san === 'Nf3') || ms[0]; return [m.from, m.to]; })()" % API)
        pg.click('#df-board [data-sq="%s"]' % f); pg.click('#df-board [data-sq="%s"]' % t)
    pg.wait_for_function("(() => { const g = %s.g; return g && g.moves.length >= 6 && !g.busy; })()" % API, timeout=120000)
    g = pg.evaluate("(() => { const g = %s.g; return { b: g.pl.b.name, n: g.moves.length, over: g.over }; })()" % API)
    check(g["b"] == "Noel" and g["n"] >= 6, "partie contre Noel (1 Elo) : %s" % g)
    # WITTY ALIEN (Blancs) contre ma Caro-Kann : Alien Gambit jusqu'au sacrifice Cxf7
    pg.evaluate("%s.launch('r_witty_alien', {color: 'b'})" % API); pg.wait_for_selector("#df-board .cb-sq")
    for k, (f, t) in enumerate([("c7", "c6"), ("d7", "d5"), ("d5", "e4"), ("g8", "f6"), ("h7", "h6")]):
        pg.wait_for_function("(() => { const g = %s.g; return g && !g.busy && g.ch.turn() === 'b' && g.moves.length === %d; })()" % (API, 2 * k + 1), timeout=120000)
        pg.click('#df-board [data-sq="%s"]' % f); pg.click('#df-board [data-sq="%s"]' % t)
    pg.wait_for_function("(() => { const g = %s.g; return g && g.moves.length >= 11 && !g.busy; })()" % API, timeout=120000)
    w = pg.evaluate("%s.g.moves.map((m) => m.san)" % API)
    check(w[:11] == ["e4", "c6", "d4", "d5", "Nc3", "dxe4", "Nxe4", "Nf6", "Ng5", "h6", "Nxf7"], "Witty Alien sort l'ALIEN GAMBIT jusqu'au sacrifice Cxf7 : %s" % " ".join(w[:11]))
    check(pg.evaluate("%s.g.pl.w.kind" % API) == "witty", "Witty joue en mode monstre (chasse au sacrifice à pleine puissance)")
    # PIETRO (Blancs) : l'Attaque de la Licorne 1.e4 2.d4 3.f3 4.g4 quoi que fassent les Noirs
    pg.evaluate("%s.launch('r_pietro', {color: 'b'})" % API); pg.wait_for_selector("#df-board .cb-sq")
    for k, (f, t) in enumerate([("a7", "a6"), ("h7", "h6"), ("b7", "b6"), ("c7", "c6")]):
        pg.wait_for_function("(() => { const g = %s.g; return g && !g.busy && g.ch.turn() === 'b' && g.moves.length === %d; })()" % (API, 2 * k + 1), timeout=120000)
        pg.click('#df-board [data-sq="%s"]' % f); pg.click('#df-board [data-sq="%s"]' % t)
    pg.wait_for_function("(() => { const g = %s.g; return g && g.moves.length >= 7; })()" % API, timeout=120000)
    pm = [m for i, m in enumerate(pg.evaluate("%s.g.moves.map((m) => m.san)" % API)) if i % 2 == 0][:4]
    check(pm == ["e4", "d4", "f3", "g4"], "Pietro : l'Attaque de la Licorne 1.e4 2.d4 3.f3 4.g4 (%s)" % pm)
    check(pg.evaluate("ENOS.botRoster.byId.r_pietro.elo") == 1760, "Pietro à 1760 (FIDE)")
    # adaptatif : +100 si tu gagnes, -100 si tu perds
    a = pg.evaluate("(() => { ENOS.settings.set('roster.adapt', 1200); ENOS.botRoster.adapted(true, false); const x = ENOS.botRoster.adaptElo(); ENOS.botRoster.adapted(false, true); ENOS.botRoster.adapted(false, true); return [x, ENOS.botRoster.adaptElo()]; })()")
    check(a == [1300, 1100], "bots adaptatifs : 1200 -> 1300 (victoire) -> 1100 (2 défaites) : %s" % a)
    other = [e for e in errs if "favicon" not in e]
    check(not other, "aucune erreur JS : %s" % other[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
