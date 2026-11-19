"""Compte ETO de bout en bout : vrai serveur Dual Pulse local (uvicorn, base temporaire), inscription depuis l'application (Abonnement › Créer un compte),
licence signée vérifiée par l'application, offre accordée par un CEO puis relue (« Actualiser »), verrous des modules et de l'onglet PC selon l'offre.
L'application est vue comme une app grand public (pas l'app de test)."""
import json, os, subprocess, sys, tempfile, time, urllib.request
from mobile_common import *

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "dualpulse_site")
TMP = tempfile.mkdtemp(prefix="etoacc_"); PORT = 8820; BASE = "http://127.0.0.1:%d" % PORT; PW = "Un-bon-mot-de-passe-42"
env = dict(os.environ, DP_DB=os.path.join(TMP, "t.db"), DP_ADMIN_TOKEN="jeton-test-123456", DP_ADMIN_PATH="admin-dp", DP_STORAGE_DIR=os.path.join(TMP, "s"))
srv = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(PORT), "--log-level", "warning"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


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
    errs = []
    with sync_playwright() as pw:
        b, ctx = launch(pw, bypass_csp=True)
        CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE"}
        def relay(route):                                  # dans l'app, c'est Java (NativeHttp) qui appelle le serveur : pas de CORS ; ici le navigateur de test passe par Playwright
            if route.request.method == "OPTIONS":
                return route.fulfill(status=204, headers=CORS)
            r = route.fetch(); route.fulfill(response=r, headers=dict(r.headers, **CORS))
        ctx.route(BASE + "/**", relay)
        pg = open_app(ctx, errs); pg.set_default_timeout(30000)
        pg.add_style_tag(content="#toasts{display:none!important}")
        pg.evaluate("ENOS.native.isTestBuild = () => false; ENOS.plans.apply(true)")
        check(pg.evaluate("ENOS.plans.current()") == "eto_free", "app grand public sans compte : ETO Free")
        open_tool(pg, "plans"); pg.wait_for_timeout(600)
        check(pg.locator("#tool-plans .pl-test").count() == 0, "pas de mode test hors de l'app de test")
        pg.click('#tool-plans [data-acc="signup"]'); pg.wait_for_selector("#sheet #pa-mail")
        pg.fill("#pa-url", BASE); pg.fill("#pa-name", "Lina"); pg.fill("#pa-mail", "lina@example.com"); pg.fill("#pa-pw", PW)
        pg.click("#pa-go");         pg.wait_for_selector("#sheet", state="hidden", timeout=20000)
        lic = pg.evaluate("ENOS.plans.license()")
        check(lic and lic["plan"] == "eto_free" and lic["email"] == "lina@example.com", "inscription depuis l'app + licence signée vérifiée : %s" % (lic and lic["plan"]))
        # verrous : Codelab (MAX) et onglet PC
        pg.evaluate("ENOS.modules.open('codelab')"); pg.wait_for_selector("#sheet:not([hidden])")
        check("ETO MAX" in pg.inner_text("#sheet"), "Codelab verrouillé en Free : « Avec ETO MAX »")
        pg.evaluate("ENOS.ui.closeSheet(true)")
        pg.evaluate("ENOS.ui.go('pc')"); pg.wait_for_timeout(500)
        check(pg.is_visible("#pc-gate") and not pg.is_visible("#pc-locked"), "onglet PC : carte « Ton PC, depuis ton téléphone » à la place du pilotage")
        # paiement non configuré : honnête
        pg.evaluate("ENOS.ui.go('tools'); ENOS.modules.open('plans')"); pg.wait_for_timeout(500)
        pg.click('#tool-plans .pl-card[data-p="eto_pro"] .pl-go'); pg.wait_for_selector("#sheet:not([hidden])")
        check("Aucun montant n'est prélevé" in pg.inner_text("#sheet"), "Choisir ETO Pro sans Stripe configuré : rien n'est prélevé")
        pg.evaluate("ENOS.ui.closeSheet(true)")
        # un CEO accorde ETO MAX
        A = {"X-Admin-Token": "jeton-test-123456"}
        call("/admin-dp/api/launcher/ceo", {"email": "ceo@example.com", "password": PW}, A)
        tok = call("/launcher/v1/auth/login", {"email": "ceo@example.com", "password": PW})["access_token"]
        call("/launcher/v1/eto/admin/grant", {"email": "lina@example.com", "plan": "eto_max", "days": 30}, {"Authorization": "Bearer " + tok})
        pg.click('#tool-plans [data-acc="refresh"]'); pg.wait_for_function("ENOS.plans.current() === 'eto_max'", timeout=15000)
        check(pg.evaluate("ENOS.plans.can('pc_control') && ENOS.plans.can('improver_auto') && !ENOS.plans.can('fleet')"), "ETO MAX accordé : pilotage du PC et Mobile Improver ouverts, Flotte fermée")
        pg.evaluate("ENOS.ui.go('pc')"); pg.wait_for_timeout(500)
        check(pg.locator("#pc-gate").count() == 0, "onglet PC déverrouillé")
        pg.evaluate("ENOS.store.set('eto.license', {token: 'x', claims: Object.assign({}, ENOS.plans.license(), {plan: 'eto_ultra'})})")
        check(pg.evaluate("ENOS.plans.license().plan") == "eto_ultra", "(contrôle) une licence modifiée à la main n'est relue qu'à partir du jeton signé : voir test suivant")
        pg.evaluate("ENOS.plans.refreshLicense()"); pg.wait_for_function("ENOS.plans.license().plan === 'eto_max'", timeout=15000)
        check(True, "la licence du serveur fait foi après actualisation")
        forged = pg.evaluate("""async () => { const l = ENOS.store.get('eto.license').token, pk = ENOS.store.get('eto.pubkey'); const [h, b, s] = l.split('.');
            const body = JSON.parse(atob(b.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b.length + 3) % 4))); body.plan = 'eto_ultra';
            const b2 = btoa(JSON.stringify(body)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
            return [!!(await ENOS.plans._verify(l, pk)), !!(await ENOS.plans._verify(h + '.' + b2 + '.' + s, pk))]; }""")
        check(forged == [True, False], "signature Ed25519 vérifiée : la vraie licence passe, une licence modifiée (ETO Ultra) est refusée : %s" % forged)
        check(not errs, "aucune erreur JS : %s" % errs[:3])
        b.close()
finally:
    srv.terminate()
raise SystemExit(1 if BAD else 0)
