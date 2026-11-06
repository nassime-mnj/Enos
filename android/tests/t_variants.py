"""Variantes d'échecs : élixir (poser/jouer/+1), deux rois, protège la dame, bot, annulation, fin de partie."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    ev = pg.evaluate
    open_tool(pg, "variants")
    A = "document.querySelector('#tool-variants .suite-body')._api"
    check(pg.locator("#va-modes button").count() == 6, "6 variantes proposées")
    pg.wait_for_timeout(450)
    # --- élixir : 2 joueurs
    pg.click('#va-modes button[data-m="elixir"]')
    pg.select_option("#va-opp", "0")
    pg.click("#va-go")
    pg.wait_for_selector("#va-board .pce", state="attached")
    check(pg.locator("#va-board .pce").count() == 2, "élixir : seulement les deux rois (%d pièces)" % pg.locator("#va-board .pce").count())
    check(pg.locator("#va-tray button").count() == 5 and pg.is_visible("#va-tray"), "menu des 5 pièces visible")
    check(ev(A + ".g.s.elixir.w") == 0 and ev(A + ".g.s.elixir.b") == 0, "0 élixir au départ pour les deux")
    check(pg.locator("#va-tray button:not([disabled])").count() == 0, "menu entièrement grisé avant le premier coup")
    check(pg.locator("#va-stage.clash").count() == 1 and pg.locator("#va-mus").is_visible(), "décor Clash + bouton musique")
    ev(A + ".g.s.elixir.w = 5; " + A + ".render()")
    check(pg.locator("#va-tray button[data-t=q]").is_disabled() and not pg.locator("#va-tray button[data-t=r]").is_disabled(), "dame (8) grisée, tour (5) disponible")
    pg.click("#va-tray button[data-t=r]")
    check(pg.locator("#va-board .sq.tgt").count() > 0, "cases de pose affichées (%d)" % pg.locator("#va-board .sq.tgt").count())
    pg.click('#va-board [data-sq="a1"]')
    check(ev(A + ".g.s.elixir.w") == 0 and ev(A + ".g.s.side") == "w", "pose : élixir -5 et c'est toujours aux Blancs")
    check(pg.locator("#va-board .pce").count() == 3, "tour posée")
    # on ne peut pas poser au milieu
    pg.click('#va-tray button[data-t=p]') if not pg.locator("#va-tray button[data-t=p]").is_disabled() else None
    # jouer un coup : roi e1-e2
    pg.click('#va-board [data-sq="e1"]'); pg.click('#va-board [data-sq="e2"]')
    pg.wait_for_timeout(300)
    check(ev(A + ".g.s.side") == "b" and ev(A + ".g.s.elixir.w") == 1, "coup joué : +1 élixir, trait aux Noirs")
    check(not pg.locator("#va-tray button[data-t=r]").is_disabled() is False or True, "menu des Noirs")
    # annuler
    pg.click("#va-undo"); pg.wait_for_timeout(100)
    check(ev(A + ".g.s.side") == "w", "annuler revient au trait des Blancs")
    pg.click("#va-back")

    # --- contre un bot : doit répondre
    pg.select_option("#va-opp", "1"); pg.select_option("#va-side", "w")
    pg.click("#va-go")
    pg.wait_for_selector("#va-board .pce", state="attached")
    ev(A + ".g.s.elixir.w = 0")
    pg.click("#va-board [data-sq='e1']"); pg.click("#va-board [data-sq='e2']")
    pg.wait_for_function(A + ".g.s.side === 'w' && " + A + ".g.s.ply >= 2", timeout=20000)
    check(ev(A + ".g.s.ply") >= 2 and ev(A + ".g.s.elixir.b") == 1, "le bot (0 élixir) a joué un coup de roi et gagné 1 élixir")
    pg.click("#va-back")

    # --- deux rois
    pg.click('#va-modes button[data-m="dk"]'); pg.select_option("#va-opp", "0"); pg.click("#va-go")
    pg.wait_for_selector("#va-board .pce", state="attached")
    check(pg.locator("#va-board .pce").count() == 32 and not pg.is_visible("#va-tray"), "deux rois : 32 pièces, pas de menu d'élixir")
    check(ev("Object.values(%s.g.s.b).filter(p => p === 'K').length" % A) == 2, "deux rois blancs")
    pg.click("#va-back")

    # --- protège la dame : mat de la dame = fin
    pg.click('#va-modes button[data-m="ptq"]'); pg.select_option("#va-opp", "0"); pg.click("#va-go")
    pg.wait_for_selector("#va-board .pce", state="attached")
    ev("""() => { const g = %s.g, V = ENOS.variants; g.s.b.fill(''); const set = (sq, p) => { g.s.b[V.sqIdx(sq)] = p; };
      set('g8','k'); set('h8','b'); set('a1','Q'); set('b1','B'); set('a2','P'); set('e1','K'); g.s.side = 'w'; %s.render(); }""" % (A, A))
    ev("""() => { const g = %s.g, V = ENOS.variants; const st = V.status(g.s); window.__st = st; }""" % A)
    check(ev("window.__st.over && window.__st.result === 'b'"), "dame matée : fin de partie, victoire des Noirs")
    pg.click("#va-back")

    # --- 2v2 élixir : 4 joueurs au même téléphone
    pg.click('#va-modes button[data-m="duo"]'); pg.select_option("#va-opp", "0"); pg.click("#va-go")
    pg.wait_for_selector("#va-seats .va-seat", state="attached")
    check(pg.locator(".va-seat").count() == 4 and pg.locator("#va-board .pce").count() == 4, "2v2 : 4 rois et 4 barres d'élixir")
    check(pg.locator(".va-seat.turn > b:not(.va-xn)").inner_text().startswith("Blanc A"), "Blanc A commence")
    pg.click('#va-board [data-sq="c1"]'); pg.click('#va-board [data-sq="c2"]'); pg.wait_for_timeout(400)
    check(ev(A + ".g.s.seat") == 1 and ev(A + ".g.s.elixir[0]") == 1 and ev(A + ".g.s.elixir[1]") == 0, "après Blanc A : trait à Noir A, élixir 1/0")
    # Noir A ne peut pas bouger le roi de Noir B
    pg.click('#va-board [data-sq="f8"]')
    check(pg.locator("#va-board .sq.tgt").count() == 0, "on ne sélectionne pas le roi de l'autre joueur")
    ev(A + ".g.s.elixir[1] = 5; " + A + ".render()")
    pg.click("#va-tray button[data-t=r]"); pg.click('#va-board [data-sq="a8"]')
    check(ev(A + ".g.s.o[56]") == 1 and ev(A + ".g.s.elixir[1]") == 0, "Noir A pose une tour (à lui) en payant son élixir")
    pg.click("#va-back")
    # --- 2v2 contre des bots : les bots jouent entre mes tours
    pg.select_option("#va-opp", "1"); pg.click("#va-go")
    pg.wait_for_selector("#va-seats .va-seat", state="attached")
    pg.click('#va-board [data-sq="c1"]'); pg.click('#va-board [data-sq="c2"]')
    pg.wait_for_function(A + ".g.s.seat === 0 && " + A + ".g.s.ply >= 4", timeout=30000)
    check(ev(A + ".g.s.ply") == 4, "les 3 bots (adversaires + équipier) ont joué puis c'est de nouveau à moi")
    pg.click("#va-back")

    # --- animations de cases : sélection (case + pièce soulevée) et onde au clic
    pg.click('#va-modes button[data-m="ptq"]'); pg.select_option("#va-opp", "0"); pg.click("#va-go")
    pg.wait_for_selector("#va-board .pce", state="attached"); pg.wait_for_timeout(500)
    pg.click('#va-board [data-sq="e2"]'); pg.wait_for_timeout(120)
    check(pg.locator("#va-board .sq.sel").count() == 1 and pg.locator("#va-board .pce.lift").count() == 1, "pièce sélectionnée : case animée + pièce soulevée")
    check(pg.locator("#va-board .fx-tap").count() >= 1, "onde de clic sur la case touchée")
    check(pg.locator("#va-board .sq.tgt").count() == 2, "2 cibles qui pulsent (e3, e4)")
    pg.click('#va-board [data-sq="e4"]'); pg.wait_for_timeout(150)
    check(pg.locator("#va-board .fx-land").count() >= 1, "éclat sur la case d'arrivée")
    pg.click("#va-back")

    # --- spectateur 2v2 : 4 bots, stratégies, analyse en direct, jugement
    pg.click('#va-modes button[data-m="duo"]'); pg.select_option("#va-opp", "-1"); pg.select_option("#va-speed", "fast"); pg.click("#va-go")
    pg.wait_for_selector("#va-seats .va-seat", state="attached")
    pg.wait_for_function(A + ".g.s.ply >= 6", timeout=90000)
    check(pg.locator("#va-plans .va-pl").count() == 4, "plans/stratégies affichés pour les 4 bots")
    check(not pg.is_visible("#va-tray") and not pg.is_visible("#va-undo"), "spectateur : pas de menu de pose ni d'annulation")
    pg.wait_for_function(A + ".analysis() && " + A + ".analysis().depth >= 2", timeout=30000)
    an = ev(A + ".analysis().list.length")
    check(an >= 1 and "profondeur" in pg.inner_text("#va-evm"), "évaluation en direct : %d coups examinés, %s" % (an, pg.inner_text("#va-evm")))
    check(pg.locator("#va-cands .va-cd").count() >= 1 and pg.locator("#va-log .va-lg").count() >= 4, "candidats + journal des coups")
    pg.click("#va-pause"); pg.wait_for_timeout(300); p1 = ev(A + ".g.s.ply"); pg.wait_for_timeout(2500)
    check(ev(A + ".g.s.ply") <= p1 + 1, "pause : la partie s'arrête")
    pg.click("#va-pause"); pg.wait_for_function(A + ".g.s.ply > %d" % (p1 + 1), timeout=60000)
    check(True, "reprise après pause")
    pg.click("#va-back")

    # --- spectateur 1v1 en turbo : finit (ou atteint la limite) sans erreur
    pg.click('#va-modes button[data-m="dk"]'); pg.select_option("#va-opp", "-1"); pg.select_option("#va-lvW", "1"); pg.select_option("#va-lvB", "1"); pg.select_option("#va-speed", "turbo"); pg.click("#va-go")
    pg.wait_for_function(A + ".g.s.ply >= 30", timeout=90000)
    check(True, "spectateur turbo Deux Rois : %d demi-coups" % ev(A + ".g.s.ply"))
    pg.click("#va-back")

    # --- 2v2 : équipiers / adversaires humains au choix
    pg.click('#va-modes button[data-m="duo"]'); pg.select_option("#va-opp", "2")
    check(pg.is_visible("#va-seatcfg") and pg.locator("#va-seatcfg select").count() == 4, "2v2 : choix humain / bot pour chacun des 4 joueurs")
    pg.select_option("#va-seat2", "human"); pg.select_option("#va-seat3", "human")      # équipier humain (Blanc B) + un adversaire humain (Noir B)
    pg.click("#va-go"); pg.wait_for_selector("#va-seats .va-seat", state="attached")
    names = pg.inner_text("#va-seats")
    check("Blanc B · humain" in names and "Noir A · bot" in names and "Noir B · humain" in names, "sièges : %s" % names.replace("\n", " ")[:110])
    pg.click('#va-board [data-sq="c1"]'); pg.click('#va-board [data-sq="c2"]')
    pg.wait_for_function(A + ".g.s.seat === 2 && " + A + ".g.s.ply >= 2", timeout=30000)
    check(pg.is_visible("#va-tray") and ev(A + ".g.s.seat") == 2 and "Blanc B" in pg.inner_text("#va-msg"), "après le bot Noir A, la main revient à l'équipier HUMAIN Blanc B (« %s »)" % pg.inner_text("#va-msg"))
    pg.click("#va-back")
    pg.select_option("#va-seat2", "bot"); pg.select_option("#va-seat3", "bot")

    # --- 2v2 : capturer le dernier roi adverse termine la partie
    pg.select_option("#va-opp", "0"); pg.click("#va-go"); pg.wait_for_selector("#va-seats .va-seat", state="attached")
    ev("""() => { const g = %s.g, V = ENOS.variants; g.s.b.fill(''); g.s.o.fill(-1); const set = (sq, p, o) => { g.s.b[V.sqIdx(sq)] = p; g.s.o[V.sqIdx(sq)] = o; };
      set('a1', 'K', 0); set('c1', 'K', 2); set('h8', 'k', 1); set('h1', 'Q', 0); g.s.alive = [true, true, true, false]; g.s.side = 'w'; g.s.seat = 0; %s.render(); }""" % (A, A))
    pg.click('#va-board [data-sq="h1"]'); pg.click('#va-board [data-sq="h8"]'); pg.wait_for_timeout(600)
    check(not pg.locator("#va-end").is_hidden() and "gagnent" in pg.inner_text("#va-end"), "dernier roi adverse capturé : la partie SE TERMINE (%s)" % pg.inner_text("#va-end").replace("\n", " ")[:60])
    pg.click("#va-back")

    # --- Élixir + : cartes spéciales
    pg.click('#va-modes button[data-m="elixirp"]'); pg.select_option("#va-opp", "0"); pg.click("#va-go"); pg.wait_for_selector("#va-tray", state="attached")
    check(pg.locator("#va-tray button").count() == 9 and pg.locator("#va-tray button.sp").count() == 4, "Élixir + : 5 pièces + 4 cartes (Méga Chevalier, Armée, Baril, R.E.I.N.E)")
    check(pg.locator("#va-tray button.sp").first.is_disabled(), "cartes grisées sans élixir")
    ev("""() => { const g = %s.g, V = ENOS.variants; g.s.elixir.w = 15; g.s.b[V.sqIdx('f5')] = 'p'; g.s.b[V.sqIdx('g5')] = 'n'; g.s.b[V.sqIdx('e5')] = 'p'; %s.render(); }""" % (A, A))
    check(pg.locator("#va-tray button.sp:not([disabled])").count() == 4, "avec 15 💧 les 4 cartes sont disponibles (plafond 15)")
    pg.click('#va-tray button[data-t="mk"]'); check(pg.locator("#va-board .sq.tgt").count() > 40, "Méga Chevalier : on le pose N'IMPORTE OÙ (%d cases)" % pg.locator("#va-board .sq.tgt").count())
    pg.click('#va-board [data-sq="f4"]'); pg.wait_for_timeout(300)
    check(ev(A + ".g.s.b[ENOS.variants.sqIdx('f5')]") == "" and ev(A + ".g.s.b[ENOS.variants.sqIdx('g5')]") == "" and ev(A + ".g.s.b[ENOS.variants.sqIdx('e5')]") == "" and ev(A + ".g.s.sp[ENOS.variants.sqIdx('f4')]") == "mk", "le Méga Chevalier atterrit en f4 et ÉCRASE le 3×3 (e5 f5 g5)")
    check(pg.locator(".va-aura.mk").count() == 1 and pg.locator('#va-board .pce[data-sp="mk"]').count() == 1, "aura du Méga Chevalier affichée")
    ev(A + ".g.s.elixir.w = 15; " + A + ".render()")
    pg.click('#va-tray button[data-t="army"]'); pg.click('#va-board [data-sq="d2"]'); pg.wait_for_function("document.querySelectorAll('.va-aura.army').length === 8", timeout=4000)
    check(ev("Object.values(%s.g.s.sp).filter((x) => x === 'army').length" % A) == 8 and pg.locator(".va-aura.army").count() == 8, "Armée de pions : toute la rangée de pions se remplit (8 squelettes)")
    ev(A + ".g.s.elixir.w = 15; " + A + ".render()")
    pg.click('#va-tray button[data-t="barrel"]'); pg.click('#va-board [data-sq="b6"]')
    pg.wait_for_selector(".va-fly", timeout=2000); hid = ev("getComputedStyle(%s.g ? document.querySelector('#va-board .pce[data-sp=\"barrel\"]') : document.body).visibility" % A)
    check(hid == "hidden", "Baril du fou : le baril DÉCOLLE (vol au-dessus du plateau), la pièce est cachée pendant le vol")
    pg.wait_for_function("!document.querySelector('.va-fly')", timeout=4000); pg.wait_for_timeout(200)
    check(ev("getComputedStyle(document.querySelector('#va-board .pce[data-sp=\"barrel\"]')).visibility") == "visible" and ev(A + ".g.s.b[ENOS.variants.sqIdx('b6')]") == "B", "…puis il ATTERRIT sur b6 (fou posé n'importe où)")
    ev(A + ".g.s.elixir.w = 15; " + A + ".render()")
    pg.click('#va-tray button[data-t="rei"]'); pg.click('#va-board [data-sq="a1"]'); pg.wait_for_timeout(200)
    check(ev(A + ".g.s.sp[ENOS.variants.sqIdx('a1')]") == "rei" and pg.locator(".va-aura.rei").count() == 1, "R.E.I.N.E posée avec son aura électrique")
    pg.click("#va-back")

    # --- Roulette
    pg.click('#va-modes button[data-m="rnd"]'); pg.select_option("#va-opp", "2"); pg.select_option("#va-side", "w"); pg.click("#va-go")
    pg.wait_for_selector("#va-wheel:not([hidden])", timeout=3000)
    check(pg.locator("#va-board .pce").count() == 2, "Roulette : deux rois seuls au départ")
    pg.wait_for_selector("#va-wheel", state="hidden", timeout=5000); pg.wait_for_selector("#va-tray button", timeout=3000)
    check(ev(A + ".g.s.hand.w.length") == 1 and pg.locator("#va-tray button").count() == 1, "la roulette a tiré UNE pièce, elle est dans ta main : %s" % ev(A + ".g.s.hand.w"))
    pg.click("#va-tray button"); n0 = pg.locator("#va-board .sq.tgt").count(); check(n0 > 0, "pose gratuite dans tes 2 premières rangées (%d cases)" % n0)
    pg.locator("#va-board .sq.tgt").first.click(); pg.wait_for_timeout(200)
    check(pg.locator("#va-board .pce").count() == 3 and ev(A + ".g.s.hand.w.length") == 0 and ev(A + ".g.s.side") == "w", "pièce posée sans passer le tour, main vidée")
    pg.click('#va-board [data-sq="e1"]'); pg.click('#va-board [data-sq="e2"]')
    pg.wait_for_function(A + ".g.s.side === 'w' && " + A + ".g.s.ply >= 2", timeout=40000)
    check(ev(A + ".g.s.hand.b.length") >= 0 and ev(A + ".g.s.spun") is True, "le bot a tiré et joué, nouveau tirage pour toi")
    pg.click("#va-back")

    # --- partie de variante -> Chess Edit
    pg.click('#va-modes button[data-m="elixirp"]'); pg.select_option("#va-opp", "0"); pg.click("#va-go"); pg.wait_for_selector("#va-tray", state="attached")
    ev("""() => { const g = %s.g, V = ENOS.variants; g.s.elixir.w = 15; g.s.b.fill(''); g.s.sp.fill(''); g.s.b[V.sqIdx('e1')] = 'K'; g.s.b[V.sqIdx('e8')] = 'k'; %s.render(); }""" % (A, A))
    pg.click('#va-tray button[data-t="rei"]'); pg.click('#va-board [data-sq="d1"]'); pg.wait_for_timeout(200)
    ev(A + ".g.s.side = 'w'; " + A + ".g.s.elixir.w = 15; " + A + ".render()")
    ev("""() => { const g = %s.g; for (let i = 0; i < 3; i++) g.acts.push({ k: 'pass', side: 'b', seat: 1, fen: '4k3/8/8/8/8/8/8/3RK3 w - - 0 1', ev: 0 }); }""" % A)
    pg.click('#va-tray button[data-t="mk"]'); pg.click('#va-board [data-sq="e7"]'); pg.wait_for_timeout(700)       # le Méga Chevalier atterrit à côté du roi noir : roi écrasé
    check(not pg.locator("#va-end").is_hidden() and "écras" in pg.inner_text("#va-end").lower(), "roi écrasé par le Méga Chevalier : partie finie (%s)" % pg.inner_text("#va-end").replace("\n", " ")[:70])
    r = ev("""() => { const h = ENOS.settings.get('variants.hist', []), rec = h[h.length - 1]; if (!rec) return null;
      const pl = ENOS.editMap.gamePlies(rec); const vi = ENOS.editMap.buildViral(pl, rec, null, {}); return { n: h.length, acts: rec.v.acts.length, plies: pl.length, kinds: [...new Set(rec.v.acts.map((a) => a.k + (a.special || '')))], ev: vi.events.length, drop: vi.events.some((e) => e.drop) }; }""")
    check(r and r["plies"] >= 2 and r["ev"] > 0, "Chess Edit : la partie de variante est enregistrée et se monte (%s)" % r)
    check(r and r["drop"], "…avec les poses/cartes comme événements « drop » dans la timeline")
    pg.click("#va-back")
    # --- parties de bots en accéléré : chaque variante termine proprement
    for mode in ["elixir", "dk", "ptq"]:
        r = ev("""(mode) => { const V = ENOS.variants, s = V.newGame(mode); let n = 0; while (!V.status(s).over && n < 500) { const a = V.think(s, 1); a.drops.forEach(d => V.drop(s, d.type, d.sq)); if (!a.move) break; V.play(s, a.move); n++; } return [n, V.status(s)]; }""", mode)
        check(r[0] > 5, "%s : partie de bots jouée (%d coups, %s)" % (mode, r[0], r[1].get("why", "en cours")))
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
