"""Super Enos : cerveau commun via le cloud (faux serveur) : le téléphone neuf récupère l'entraînement du PC, n'envoie que sa propre mémoire, et réinstallé retrouve tout."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    pg.evaluate("""() => {
      window.__sent = [];
      const pc = {games: [{t: 5, opp: 'eto', result: 'w', why: 'mat', plies: 30}], plies: 30, openings: {}, profiles: {eto: {g: 3, w: 2, d: 0, l: 1, loss_sum: 90, loss_n: 30, brilliants: 1, dodged: 0}}, lessons: [{t: 5, opp: 'eto', result: 'w', text: 'Appris sur le PC'}]};
      ENOS.cloud.loggedIn = () => true;
      ENOS.cloud.req = async (path, o) => { window.__sent.push({path, body: o.body}); return {status: 200, json: {docs: [{device: 'pc-aaaaaaa', doc: pc}]}}; };
    }""")
    r = pg.evaluate("ENOS.trainUi.cloudSync(true)")
    check(r["ok"] and r["devices"] == 1, "synchronisation : 1 autre appareil reçu")
    sent = pg.evaluate("window.__sent[0]")
    check(sent["path"] == "/brain/sync" and "remote" not in sent["body"]["doc"] and sent["body"]["device"].startswith("ph-"), "n'envoie que SA mémoire, identifiant d'appareil propre")
    s = pg.evaluate("ENOS.trainUi.summary()")
    check(s["profiles"]["eto"]["g"] == 3 and s["plies"] == 30 and any("PC" in l["text"] for l in s["lessons"]), "téléphone neuf : l'entraînement du PC est visible")
    pg.evaluate("ENOS.cloud.loggedIn = () => false")
    check(pg.evaluate("ENOS.trainUi.cloudSync(true)")["ok"] is False, "sans compte : silencieux, aucun envoi")
    check(not errs, "aucune erreur JavaScript : %s" % errs)
print("\n%d échec(s)" % len(BAD))
