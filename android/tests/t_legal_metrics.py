"""Informations légales (4 textes, liens depuis l'Abonnement), statistiques anonymes désactivées par défaut puis activées (rapport reçu par un vrai
serveur local, sans lien avec le compte), tableau de bord de l'Espace CEO (comptes, inscriptions, installations actives, modules ouverts)."""
import json, os, subprocess, sys, tempfile, time, urllib.request
from mobile_common import *

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "dualpulse_site")
TMP = tempfile.mkdtemp(prefix="etomet_"); PORT = 8825; BASE = "http://127.0.0.1:%d" % PORT; PW = "Un-bon-mot-de-passe-42"
env = dict(os.environ, DP_DB=os.path.join(TMP, "t.db"), DP_ADMIN_TOKEN="jeton-test-123456", DP_ADMIN_PATH="admin-dp", DP_STORAGE_DIR=os.path.join(TMP, "s"))
srv = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(PORT), "--log-level", "warning"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
SHOTS = os.environ.get("SHOTS") or "/tmp"


def call(path, body=None, headers=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, headers=dict({"Content-Type": "application/json"}, **(headers or {})), method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


try:
    for _ in range(60):
        try:
            call("/launcher/v1/keys"); break
        except Exception:
            time.sleep(0.5)
    call("/admin-dp/api/launcher/ceo", {"email": "ceo@example.com", "password": PW}, {"X-Admin-Token": "jeton-test-123456"})
    call("/launcher/v1/eto/signup", {"email": "a@example.com", "password": PW})
    errs = []
    with sync_playwright() as pw:
        b, ctx = launch(pw, bypass_csp=True)
        CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE"}
        def fwd(route):
            if route.request.method == "OPTIONS":
                return route.fulfill(status=204, headers=CORS)
            r = route.fetch(); route.fulfill(response=r, headers=dict(r.headers, **CORS))
        ctx.route(BASE + "/**", lambda route: fwd(route))
        pg = open_app(ctx, errs); pg.set_default_timeout(30000)
        pg.add_style_tag(content="#toasts{display:none!important}")
        pg.evaluate("ENOS.native.isTestBuild = () => false; ENOS.plans.apply(true)")
        # liens depuis l'Abonnement
        open_tool(pg, "plans"); pg.click('#tool-plans .pl-legal [data-legal="cgv"]'); pg.wait_for_selector("#tool-legal .lg-doc")
        check("Droit de rétractation" in pg.inner_text("#tool-legal .lg-doc"), "Abonnement › Conditions de vente : CGV affichées")
        tabs = pg.evaluate("[...document.querySelectorAll('#tool-legal .lg-tabs button')].map((b) => b.textContent)")
        check(len(tabs) == 4, "4 textes : %s" % tabs)
        pg.click('#tool-legal .lg-tabs [data-t="privacy"]'); pg.wait_for_selector("#lg-met")
        check(pg.evaluate("ENOS.metrics.enabled()") is False and "on" not in (pg.get_attribute("#lg-met", "class") or ""), "statistiques désactivées par défaut")
        pg.evaluate("ENOS.modules.open('defis'); ENOS.modules.open('plans')")
        check(pg.evaluate("ENOS.store.get('metrics.buf', null)") is None, "désactivées : rien n'est compté")
        pg.evaluate("ENOS.modules.open('legal')"); pg.click("#lg-met")
        check(pg.evaluate("ENOS.metrics.enabled()") is True, "activées par l'utilisateur")
        pg.evaluate("ENOS.cloud.setUrl('%s'); ENOS.modules.open('defis'); ENOS.modules.open('defis'); ENOS.modules.open('improver')" % BASE)
        ok = pg.evaluate("ENOS.metrics.flush(true)")
        check(ok, "rapport du jour envoyé au serveur")
        # tableau de bord CEO
        pg.evaluate("ENOS.native.isTestBuild = () => true; ENOS.plans.apply(true)")
        open_tool(pg, "ceo"); pg.click("#ceo-admin [data-adm=login]"); pg.wait_for_selector("#sheet #pa-mail")
        pg.fill("#pa-mail", "ceo@example.com"); pg.fill("#pa-pw", PW); pg.click("#pa-go")
        pg.wait_for_selector("#db-body .db-kpi", timeout=20000)
        txt = pg.inner_text("#db-body")
        check("comptes eto" in txt.lower() and "ouvertures" in txt and "2 ouvertures" in txt, "tableau de bord : comptes, modules les plus ouverts")
        st = call("/launcher/v1/eto/admin/stats", headers={"Authorization": "Bearer " + call("/launcher/v1/auth/login", {"email": "ceo@example.com", "password": PW})["access_token"]})
        check(st["active_installs"][-1] == 1 and st["plans"]["eto_free"] == 1, "serveur : 1 installation active, 1 compte ETO Free")
        pg.evaluate("document.querySelector('#ceo-admin').scrollIntoView()"); pg.wait_for_timeout(700); pg.screenshot(path=SHOTS + "/ceo_dash.png")
        check(not errs, "aucune erreur JS : %s" % errs[:3])
        b.close()
finally:
    srv.terminate()
raise SystemExit(1 if BAD else 0)
