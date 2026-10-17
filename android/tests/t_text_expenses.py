from mobile_common import *
with sync_playwright() as pw:
    b, ctx = launch(pw); errs = []
    pg = open_app(ctx, errs)
    pg.click('#tabbar [data-tab="tools"]'); pg.wait_for_selector('.mtile[data-m="text"]')
    for t in ("text", "expenses"):
        check(pg.locator(f'.mtile[data-m="{t}"]').count() == 1, f"tuile « {t} » dans Modules")
    check(pg.locator('.mtile[data-m="img"]').count() == 1, "les outils existants (photos, dossiers) sont toujours là")
    # ---- JSON / XML
    open_tool(pg, "text")
    pg.fill("#tx-in", '{"b":1,"a":[1,2,{"z":true}]}'); pg.click("#tx-fmt")
    check('"a": [' in pg.inner_text("#tx-out") and "JSON valide" in pg.inner_text("#tx-ok"), "JSON : formaté et valide")
    pg.click("#tx-sort"); check(pg.inner_text("#tx-out").index('"a"') < pg.inner_text("#tx-out").index('"b"'), "JSON : clés triées")
    pg.click("#tx-min"); check(pg.inner_text("#tx-out").strip() == '{"b":1,"a":[1,2,{"z":true}]}', "JSON : minifié")
    pg.fill("#tx-in", '{"a": 1,\n "b": }'); pg.click("#tx-fmt")
    check("invalide" in pg.inner_text("#tx-err") and "ligne 2" in pg.inner_text("#tx-err"), "JSON invalide : erreur avec ligne " + pg.inner_text("#tx-err")[:80])
    pg.fill("#tx-in", "{a: 1, // commentaire\n 'b': [1,2,],}"); pg.click("#tx-fmt")
    check(pg.locator("#tx-fix").is_visible(), "JSON tolérant : bouton « Réparer »")
    pg.click("#tx-fix"); check('"a": 1' in pg.inner_text("#tx-out") and "réparé" in pg.inner_text("#tx-ok"), "JSON réparé (commentaire, quotes, virgules finales)")
    pg.fill("#tx-in", '<?xml version="1.0"?><r a="1"><i>x</i><i/><!-- c --></r>'); pg.click("#tx-fmt")
    out = pg.inner_text("#tx-out")
    check("<r a=\"1\">\n  <i>x</i>\n  <i/>" in out and "XML valide" in pg.inner_text("#tx-ok"), "XML : mis en forme")
    pg.click("#tx-min"); check(pg.inner_text("#tx-out").strip().startswith('<?xml version="1.0"?><r a="1"><i>x</i><i/>'), "XML : minifié")
    pg.fill("#tx-in", "<a><b></a>"); pg.click("#tx-fmt"); check("XML invalide" in pg.inner_text("#tx-err"), "XML invalide : erreur")
    # ---- dépenses partagées
    open_tool(pg, "expenses")
    for n in ("Léa", "Tom", "Zoé"):
        pg.fill("#ex-person", n); pg.click("#ex-addp")
    pg.fill("#ex-label", "Courses"); pg.fill("#ex-amount", "90,00"); pg.select_option("#ex-payer", "Léa"); pg.click("#ex-add")
    pg.fill("#ex-label", "Resto"); pg.fill("#ex-amount", "30"); pg.select_option("#ex-payer", "Tom"); pg.click("#ex-add")
    check("120,00" in pg.inner_text("#ex-total"), "total 120,00 € : " + pg.inner_text("#ex-total"))
    s = pg.inner_text("#ex-settle"); print("   ", s.replace("\n", " | "))
    check("Zoé → Léa" in s and "40,00" in s, "remboursements calculés (Zoé doit 40 € à Léa)")
    pg.fill("#ex-amount", "abc"); pg.fill("#ex-label", "X"); pg.click("#ex-add"); check("invalide" in pg.inner_text("#ex-err"), "montant invalide refusé")
    pg.reload(); pg.wait_for_selector("#tabbar"); open_tool(pg, "expenses")
    check("120,00" in pg.inner_text("#ex-total"), "données conservées après rechargement")
    check(not errs, "aucune erreur JavaScript " + str(errs[:3]))
    b.close()
print("ÉCHECS:", BAD or "aucun")
