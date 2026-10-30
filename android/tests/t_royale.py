"""Battle Royale ×4 : préparation (équipes, cibles, ami au téléphone), partie de bots jusqu'au podium, joueur humain, annulation, tempête, apprentissage."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    ev = pg.evaluate
    open_tool(pg, "royale")
    A = "document.querySelector('#tool-royale .suite-body')._api"
    check(pg.locator(".ro-seat").count() == 4, "4 sièges (Bas, Gauche, Haut, Droite)")
    # --- équipes : préréglages
    pg.click('#ro-presets button:has-text("2 contre 2 · opposés alliés")')
    teams = ev(A + ".cfg().seats.map(s => s.team)")
    check(teams == [0, 1, 0, 1], "préréglage 2v2 opposés : équipes %s" % teams)
    tg = ev(A + ".cfg().seats.map((s, i) => s.target)")
    check(all(ev(A + ".cfg().seats[%d].team" % t) != ev(A + ".cfg().seats[%d].team" % i) for i, t in enumerate(tg)), "la cible de chaque siège est toujours un ennemi : %s" % tg)
    pg.click('#ro-presets button:has-text("Moi + 1 bot contre 2 bots")')
    check(ev(A + ".cfg().seats.map(s => s.team)") == [0, 1, 0, 3], "préréglage 2v1v1 (moi + 1 bot contre 2 bots)")
    check("Équipe" not in pg.inner_text("#ro-teams") and "vs" in pg.inner_text("#ro-teams"), "résumé des équipes : " + pg.inner_text("#ro-teams").replace("\n", " "))
    pg.click('#ro-presets button:has-text("1v1v1v1")')
    check(ev(A + ".cfg().seats.map(s => s.team)") == [0, 1, 2, 3], "préréglage 1v1v1v1")

    # --- partie 100 % bots en turbo, tempête rapide : doit finir et afficher le podium
    ev("""() => { const c = %s.cfg(); c.seats.forEach((s, i) => { s.who = ['penoire', 'nasko', 'lelex', 'enos'][i]; }); c.storm = 'fast'; c.speed = 'turbo'; }""" % A)
    ev(A + ".launch()")
    pg.wait_for_selector("#ro-end:not([hidden]) .ro-podium", timeout=120000)
    n = ev(A + ".g.st.ply")
    check(n > 20 and ev(A + ".g.over"), "la bataille se termine toute seule (%d demi-coups)" % n)
    check(pg.locator(".ro-pod").count() == 4 and "BATAILLE TERMINÉE" in pg.inner_text(".ro-podium"), "podium des 4 combattants")
    check(ev(A + ".g.st.level") >= 1 or ev(A + ".g.st.out.length") >= 1, "des éliminations ou la tempête ont eu lieu")
    pg.screenshot(path="/tmp/claude-0/royale_end.png")
    pg.click("#ro-menu")
    check(pg.is_visible("#ro-setup") and "bataille" in pg.inner_text("#ro-ngames"), "retour au menu, palmarès mis à jour : " + pg.inner_text("#ro-wins").replace("\n", " ")[:50])

    # --- joueur humain en bas : clic sur un pion, coup joué, les bots répondent
    ev("""() => { const c = %s.cfg(); c.seats[0].who = 'human'; c.seats[1].who = 'penoire'; c.seats[2].who = 'nasko'; c.seats[3].who = 'lelex'; c.storm = 'off'; c.speed = 'fast'; c.seats.forEach((s, i) => s.team = i); }""" % A)
    ev(A + ".launch()")
    pg.wait_for_selector("#ro-board .pc")
    check(pg.locator("#ro-board .pc").count() == 64, "64 pièces sur le plateau (4 armées de 16)")
    check(pg.locator(".ro-sq").count() == 160, "160 cases jouables")
    def click_sq(vx, vy):
        pg.wait_for_timeout(450)                                          # le temps que les animations de page se posent
        box = pg.locator("#ro-board").bounding_box()
        pg.mouse.click(box["x"] + (vx + 0.5) / 14 * box["width"], box["y"] + (vy + 0.5) / 14 * box["height"])
    click_sq(7, 12)                                                       # pion du roi du joueur du bas
    check(pg.locator(".ro-sq.tgt").count() == 2, "2 destinations affichées pour le pion (1 ou 2 pas)")
    click_sq(7, 10)
    pg.wait_for_function(A + ".g.st.ply >= 4", timeout=40000)
    check(ev(A + ".g.st.ply") >= 4, "les 3 bots ont répondu au coup de l'humain")
    # annuler : on revient au tour de l'humain
    pg.wait_for_function(A + ".g.st.turn === 0", timeout=40000)
    pg.click("#ro-undo")
    pg.wait_for_function(A + ".g.st.ply === 0 && " + A + ".g.st.turn === 0", timeout=5000)
    check(pg.locator("#ro-board .pc").count() == 64 and "annulé" in pg.inner_text("#ro-ticker"), "↶ annule le coup et rend le tour")

    # --- ami au téléphone : 2 sièges humains (moi + ami), moi + 1 « bot » contre 2 autres
    ev("""() => { const c = %s.cfg(); c.seats[0].who = 'human'; c.seats[0].name = 'Moi'; c.seats[2].who = 'human'; c.seats[2].name = 'Karim'; c.seats[1].who = 'penoire'; c.seats[3].who = 'lelex'; c.seats[0].team = 0; c.seats[2].team = 0; c.seats[1].team = 1; c.seats[3].team = 3; c.speed = 'fast'; }""" % A)
    ev(A + ".launch()")
    pg.wait_for_function(A + ".g.st.turn === 0", timeout=5000)
    click_sq(7, 12); click_sq(7, 10)
    pg.wait_for_function(A + ".g.st.turn === 2", timeout=40000)
    check("Joue le coup de" in pg.inner_text("#ro-turn") and "Karim" in pg.inner_text("#ro-turn"), "le tour de l'ami est rendu à l'utilisateur : " + pg.inner_text("#ro-turn").replace("\n", " "))
    check(ev(A + ".g.st.teams") == [0, 1, 0, 3], "équipes de la partie : moi + Karim contre Pénoire et Lelex")
    # on joue pour Karim (siège du haut) : son pion du roi (6,1) vers (6,3) — coordonnées du plateau vu du bas
    pg.keyboard.press("Escape") if False else None
    # coup dicté en texte pour Karim (haut) : le plateau est vu du bas, son pion du roi est en 7,1 -> h13 ; il avance en h11
    check(pg.is_visible("#ro-say"), "champ « coup dicté » affiché quand c'est le tour d'un humain")
    pg.fill("#ro-sayin", "h13 h11"); pg.press("#ro-sayin", "Enter")
    pg.wait_for_function(A + ".g.st.ply >= 2 && " + A + ".g.st.b[3 * 14 + 7] !== 0", timeout=8000)
    check(True, "le coup dicté « h13 h11 » est joué à la place de Karim")
    pg.fill("#ro-sayin", "z9 a1") if False else None
    img = ev(A + ".g ? 1 : 0")
    pg.wait_for_function(A + ".g.st.turn === 0 || " + A + ".g.st.turn === 2", timeout=40000)
    pg.click("#ro-share"); pg.wait_for_selector("#sheet img[alt=plateau]", timeout=10000)
    check(ev("document.querySelector('#sheet img[alt=plateau]').src.startsWith('data:image/png')"), "image du plateau générée pour l'ami")
    pg.keyboard.press("Escape")
    # --- échec et mat : le roi maté est éliminé, ses pièces restent GRISÉES sur le plateau
    ev("""() => { const c = %s.cfg(); c.seats.forEach((s, i) => { s.who = i === 0 ? 'human' : ['', 'nasko', 'lelex', 'enos'][i]; s.team = i; }); c.storm = 'off'; c.speed = 'slow'; }""" % A)
    ev(A + ".launch()")
    pg.wait_for_timeout(500)
    ev("""() => { const g = %s.g, C4 = ENOS.c4, b = g.st.b, q = (x, y) => y * 14 + x; b.fill(0);
      b[q(7, 13)] = C4.cell(0, C4.K); b[q(0, 3)] = C4.cell(1, C4.K); b[q(0, 5)] = C4.cell(1, C4.P); b[q(6, 0)] = C4.cell(2, C4.K); b[q(13, 6)] = C4.cell(3, C4.K);
      b[q(5, 4)] = C4.cell(0, C4.R); b[q(7, 5)] = C4.cell(0, C4.R); g.st.turn = 0; g.hist = []; %s.rebuild(); }""" % (A, A))
    pg.fill("#ro-sayin", "h9 h11"); pg.press("#ro-sayin", "Enter")
    pg.wait_for_function(A + ".g.st.alive[1] === false", timeout=8000)
    check("ÉCHEC ET MAT" in pg.inner_text("#ro-ticker"), "annonce de l'échec et mat : " + pg.inner_text("#ro-ticker"))
    pg.wait_for_timeout(600)
    check(pg.locator("#ro-board .pc.c4").count() == 2, "le roi et le pion du joueur maté restent sur le plateau, GRISÉS (%d)" % pg.locator("#ro-board .pc.c4").count())
    check(pg.locator(".ro-ban.ko").count() == 1 and pg.locator(".ro-ban.ko").get_attribute("data-s") == "1", "bannière « ÉLIMINÉ » sur le joueur de gauche")
    check(ev(A + ".g.st.pts[0]") == 15, "+15 points pour le mat")
    # --- alliés : captures interdites entre coéquipiers
    ok = ev("""() => { const C4 = ENOS.c4, s = C4.newGame({teams: [0, 1, 0, 3]}); s.b.fill(0); s.b[7 * 14 + 7] = C4.cell(0, C4.R); s.b[7 * 14 + 4] = C4.cell(2, C4.P); s.b[7 * 14 + 10] = C4.cell(1, C4.P);
      const to = C4.moves(s, 0).map(C4.to); return [to.includes(7 * 14 + 4), to.includes(7 * 14 + 10)]; }""")
    check(ok == [False, True], "la tour ne peut pas prendre son allié (pion du haut) mais prend l'ennemi : %s" % ok)

    # --- apprentissage : une variante mutée affronte l'originale
    r = ev("""async () => { const AI = ENOS.c4ai; const w = AI.defaultWeights('penoire'); const out = await AI.evolve('penoire', w, {games: 2, maxPlies: 90}); return {played: out.played, keys: Object.keys(out.w).length, acc: typeof out.accepted}; }""")
    check(r["played"] == 2 and r["keys"] == 9 and r["acc"] == "boolean", "évolution d'une stratégie : %s" % r)
    check(not errs, "aucune erreur JavaScript : %s" % errs[:2])
    b.close()
import sys
sys.exit(1 if BAD else 0)
