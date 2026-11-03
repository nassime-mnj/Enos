"""Sauvegarde / restauration : instantané, exclusions (secrets), fusion monotone, restauration, sauvegarde locale + cloud (pont simulé), nouvelle installation, module."""
import json
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    ev = pg.evaluate
    pg.wait_for_function("window.ENOS && ENOS.backup && ENOS.native")
    # ---------------------------------------------------------------- instantané
    ev("""() => { localStorage.clear(); const S = ENOS.store;
        S.set('defi.hist', [{ t: 100, title: 'A' }, { t: 200, title: 'B' }]); S.set('s.theme', 'neon'); S.set('variants.stats', { elixir: { w: 2, l: 1, d: 0 } }); S.set('train.mem', { lessons: ['x'] });
        S.set('ai.token', 'SECRET1'); S.set('s.apiKey', 'SECRET2'); S.set('cloud.user', { email: 'a@b' }); localStorage.setItem('enos.vault.blob', 'zzz'); }""")
    snap = ev("ENOS.backup.snapshot()")
    ks = list(snap["keys"].keys())
    check(snap["app"] == "ENOS" and "enos.defi.hist" in ks and "enos.s.theme" in ks and "enos.train.mem" in ks and "enos.variants.stats" in ks, "instantané : parties, préférences, entraînement, stats (%d clés)" % len(ks))
    check(not any("token" in k or "apiKey" in k or "vault" in k or "cloud.user" in k for k in ks), "secrets, jeton, coffre et session cloud NON sauvegardés")
    s = ev("ENOS.backup.summary(ENOS.backup.snapshot())")
    check(s["games"] == 2 and s["prefs"] >= 1 and s["training"] >= 1, "résumé : %s" % {k: s[k] for k in ("games", "prefs", "training")})
    # ---------------------------------------------------------------- fusion monotone
    m = ev("""() => { const M = ENOS.backup.merge;
        return { arr: M([{ t: 1 }, { t: 3 }], [{ t: 1 }, { t: 2 }]).map((x) => x.t), num: M(5, 9), obj: M({ a: 1, b: { c: 2 } }, { a: 4, b: { c: 1, d: 7 }, e: 'x' }), str: M('local', 'autre'), prim: M(['a', 'b'], ['b', 'c']) }; }""")
    check(m["arr"] == [1, 2, 3], "fusion de parties : union triée par date %s" % m["arr"])
    check(m["num"] == 9 and m["obj"] == {"a": 4, "b": {"c": 2, "d": 7}, "e": "x"} and m["str"] == "local" and sorted(m["prim"]) == ["a", "b", "c"], "fusion : plus grands compteurs, objets récursifs, valeur locale gardée, union simple")
    # ---------------------------------------------------------------- restauration (réinstallation simulée)
    ev("""() => { window.__snap = ENOS.backup.snapshot(); localStorage.clear(); ENOS.store.set('defi.hist', [{ t: 300, title: 'C (nouvelle partie)' }]); ENOS.store.set('s.theme', 'light'); }""")
    r = ev("(() => { const r = ENOS.backup.restore(window.__snap, 'merge'); const h = JSON.parse(localStorage.getItem('enos.defi.hist')); return { r, titles: h.map((x) => x.title), theme: localStorage.getItem('enos.s.theme'), stats: localStorage.getItem('enos.variants.stats') }; })()")
    check([t[0] for t in r["titles"]] == ["A", "B", "C"], "restauration FUSION : les 2 anciennes parties + la nouvelle %s" % r["titles"])
    check(r["theme"] == '"light"' and r["stats"] and r["r"]["added"] >= 2, "fusion : le réglage actuel est gardé, les données absentes sont ajoutées %s" % r["r"])
    r2 = ev("(() => { ENOS.backup.restore(window.__snap, 'replace'); return { h: JSON.parse(localStorage.getItem('enos.defi.hist')).length, theme: localStorage.getItem('enos.s.theme') }; })()")
    check(r2["h"] == 2 and r2["theme"] == '"neon"', "restauration REMPLACER : retour exact à la sauvegarde")
    bad = ev("(() => { try { ENOS.backup.restore({ app: 'autre' }); return 'accepté'; } catch (e) { return e.message; } })()")
    check("invalide" in bad, "fichier étranger refusé : " + bad)
    # ---------------------------------------------------------------- sauvegarde auto : locale (pont simulé) + cloud (serveur simulé)
    ev("""() => { window.__w = []; window.__cloud = null;
        ENOS.native.backup = { can: () => true, write: (n, t) => { window.__w.push([n, t.length]); return true; }, list: () => [{ id: 7, name: 'enos-sauvegarde-2026-11-03.json', size: 999, t: Date.now() }], read: () => JSON.stringify(window.__snap) };
        ENOS.cloud.loggedIn = () => true;
        ENOS.cloud.req = async (path, o) => { if (o && o.method === 'POST') { window.__cloud = o.body; return { status: 200, json: { updated: 1 } }; } return { status: 200, json: { doc: window.__cloud.doc } }; }; }""")
    d = ev("(() => { ENOS.store.set('defi.hist', [{ t: 1 }]); return ENOS.backup.dirty(); })()")
    check(d is True, "un changement marque la sauvegarde « à faire »")
    res = ev("ENOS.backup.save(true)")
    check(res["local"] and res["cloud"] and not res["err"], "sauvegarde locale + cloud : %s" % res)
    w = ev("window.__w")
    check(len(w) == 1 and w[0][0].startswith("enos-sauvegarde-") and w[0][0].endswith(".json") and w[0][1] > 100, "fichier local nommé par jour : %s" % w[0][0])
    check(ev("window.__cloud.doc.z.startsWith('g:') || window.__cloud.doc.z.startsWith('p:')") and ev("window.__cloud.doc.meta.games") == 1, "envoi cloud compressé (gzip) avec résumé")
    back = ev("(async () => { const s = await ENOS.backup.cloudGet(); return { n: Object.keys(s.keys).length, games: JSON.parse(s.keys['enos.defi.hist']).length }; })()")
    check(back["games"] == 1 and back["n"] >= 3, "aller-retour cloud (gzip) : les clés reviennent intactes %s" % back)
    check(ev("ENOS.backup.dirty()") is False and ev("ENOS.backup.meta().local") > 0 and ev("ENOS.backup.meta().cloud") > 0, "état mis à jour : plus rien à sauvegarder")
    ev("""() => { ENOS.settings.set('backup.local', false); }""")
    r3 = ev("ENOS.backup.save(true)")
    check(not r3["local"] and r3["cloud"], "case « téléphone » décochée : seulement le cloud")
    ev("ENOS.settings.set('backup.local', true)")
    # ---------------------------------------------------------------- nouvelle installation : proposition de restauration
    ev("""() => { localStorage.clear(); }""")
    ev("() => { ENOS.backup.firstRun(); }")
    pg.wait_for_selector(".sheet:not([hidden]), #sheet:not([hidden])", timeout=5000)
    txt = pg.inner_text("#sheet")
    check("Sauvegarde retrouvée" in txt and "RESTAURER" in txt, "nouvelle installation : la sauvegarde du téléphone est proposée")
    pg.click('#sheet button:has-text("PLUS TARD")'); pg.wait_for_timeout(300)
    # ---------------------------------------------------------------- module
    ev("() => { ENOS.store.set('defi.hist', [{ t: 5, title: 'x' }]); }")
    open_tool(pg, "backup")
    pg.wait_for_timeout(450)
    check(pg.locator("#bk-now").is_visible() and pg.locator("#bk-file").is_visible() and pg.locator("#bk-cl").is_visible(), "module Sauvegarde : boutons sauvegarder / fichier / téléphone / cloud")
    pg.click("#bk-now"); pg.wait_for_function("document.querySelector('#bk-st').textContent.includes('/')", timeout=5000)
    check("Cloud" in pg.inner_text("#bk-st") and "partie" in pg.inner_text("#bk-now-c"), "état affiché : " + pg.inner_text("#bk-st").replace("\\n", " ")[:80])
    pg.click("#bk-phone"); pg.wait_for_selector(".bk-item", timeout=3000)
    pg.click(".bk-item"); pg.wait_for_selector("#sheet button:has-text('FUSIONNER')", timeout=3000)
    check("Restaurer" in pg.inner_text("#sheet"), "choix FUSIONNER / REMPLACER proposé")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
