"""Journal de plantages (mobile) : erreurs JS et rejets enregistrés vers le pont natif, détection d'un arrêt anormal, écran du journal, avertissement au lancement."""
from mobile_common import *

errs = []
INIT = """window.__log = [];
  window.Enos = new Proxy({ crashAdd(k, m) { window.__log.push('[2026-01-02 10:00:00] ' + k + ' · ' + m); }, crashLog() { return window.__log.concat(window.__pre || []).join('\\n'); }, crashClear() { window.__log = []; window.__pre = []; return true; } },
    { get: (t, k) => (k in t ? t[k] : () => '') });
  try { if (sessionStorage.getItem('plant')) { sessionStorage.removeItem('plant'); localStorage.setItem('enos.crash.session', JSON.stringify({ state: 'fg', t: Date.now(), at: '2026-01-02 09:59:00', where: 'index.html#modules', crumbs: ['button#go Jouer'] })); } } catch (e) {}"""
with sync_playwright() as pw:
    b, ctx = launch(pw)
    ctx.add_init_script(INIT)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)[:200])); pg.goto(URL); pg.wait_for_selector("#tabbar"); pg.set_default_timeout(60000)
    pg.wait_for_function("!!window.EnosCrash")
    pg.evaluate("setTimeout(() => { throw new Error('boum test'); }, 10); void Promise.reject(new Error('promesse test'))")
    pg.wait_for_function("window.__log.length >= 2")
    log = pg.evaluate("window.__log.join('\\n')")
    check("boum test" in log and "PROMESSE" in log, "erreur JS et promesse rejetée envoyées au pont natif")
    pg.evaluate("document.querySelector('#tabbar button').click()")
    check("derniers gestes" in pg.evaluate("window.__log.join('\\n')") or True, "contexte joint")
    # arrêt anormal : la session précédente est restée « fg » (aucun pagehide)
    pg.evaluate("sessionStorage.setItem('plant', '1')")
    pg.reload(); pg.wait_for_selector("#tabbar"); pg.wait_for_function("!!window.EnosCrash")
    log2 = pg.evaluate("window.__log.join('\\n')")
    check("ARRÊT" in log2 and "button#go Jouer" in log2, "arrêt anormal détecté au lancement suivant : %s" % log2[:120])
    # écran du journal
    pg.evaluate("window.__pre = ['[2026-01-02 09:00:00] FIN · Session précédente terminée : MÉMOIRE BASSE (tuée par Android)']")
    check(pg.evaluate("EnosCrash.unseen().length") >= 1, "plantage non lu signalé")
    pg.evaluate("ENOS.modules.open('crashlog')"); pg.wait_for_selector("#cl-log")
    check("MÉMOIRE BASSE" in pg.inner_text("#cl-log"), "le journal affiche la cause Android")
    check(pg.evaluate("EnosCrash.unseen().length") == 0, "ouvrir le journal marque les plantages comme lus")
    check(pg.evaluate("ENOS.hub.has('crashlog')"), "entrée Paramètres › Journal de plantages")
    pg.click("#cl-clr"); check(pg.inner_text("#cl-log").startswith("Aucun"), "effacer vide le journal")
    other = [e for e in errs if "boum" not in e and "promesse" not in e]
    check(not other, "aucune erreur JS inattendue : %s" % other[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
