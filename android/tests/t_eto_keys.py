"""Clés d'activation ETO de bout en bout, vrai serveur Dual Pulse local (uvicorn, base temporaire) :
Espace CEO › Générateur de clés (compte CEO du serveur) -> clé affichée une fois -> un compte ETO grand public l'active (Abonnement › Activer une clé)
-> licence signée ETO MAX dans l'app -> Espace CEO › Révocateur : l'abonnement est coupé -> l'app redescend en ETO Free à la relecture de la licence."""
import json, os, re, subprocess, sys, tempfile, time, urllib.request
from mobile_common import *

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "dualpulse_site")
TMP = tempfile.mkdtemp(prefix="etokeys_"); PORT = 8821; BASE = "http://127.0.0.1:%d" % PORT; PW = "Un-bon-mot-de-passe-42"
env = dict(os.environ, DP_DB=os.path.join(TMP, "t.db"), DP_ADMIN_TOKEN="jeton-test-123456", DP_ADMIN_PATH="admin-dp", DP_STORAGE_DIR=os.path.join(TMP, "s"))
srv = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(PORT), "--log-level", "warning"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
SHOTS = os.environ.get("SHOTS") or "/tmp"


def call(path, body=None, headers=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, headers=dict({"Content-Type": "application/json"}, **(headers or {})), method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def login_sheet(pg, mail, then=None):
    pg.wait_for_selector("#sheet #pa-mail")
    if pg.locator("#sheet #pa-url").count():
        pg.fill("#pa-url", BASE)
    pg.fill("#pa-mail", mail); pg.fill("#pa-pw", PW); pg.click("#pa-go")
    try:
        pg.wait_for_selector(then or "#sheet", state="visible" if then else "hidden", timeout=20000)
    except Exception:
        print("  feuille :", pg.inner_text("#sheet")[:300]); raise


try:
    for _ in range(60):
        try:
            call("/launcher/v1/keys"); break
        except Exception:
            time.sleep(0.5)
    call("/admin-dp/api/launcher/ceo", {"email": "ceo@example.com", "password": PW}, {"X-Admin-Token": "jeton-test-123456"})
    errs = []
    with sync_playwright() as pw:
        b, ctx = launch(pw, bypass_csp=True)
        CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE"}
        def relay(route):                                  # dans l'app, Java (NativeHttp) appelle le serveur sans CORS ; ici Playwright relaie
            if route.request.method == "OPTIONS":
                return route.fulfill(status=204, headers=CORS)
            r = route.fetch(); route.fulfill(response=r, headers=dict(r.headers, **CORS))
        ctx.route(BASE + "/**", relay)
        pg = open_app(ctx, errs); pg.set_default_timeout(30000)
        pg.add_style_tag(content="#toasts{display:none!important}")
        # ---- Espace CEO : sans compte CEO, le générateur demande la connexion
        open_tool(pg, "ceo"); pg.wait_for_selector("#ceo-admin [data-adm=login]")
        check(True, "Espace CEO : le générateur demande le compte CEO du serveur")
        pg.click("#ceo-admin [data-adm=login]"); login_sheet(pg, "ceo@example.com")
        pg.wait_for_selector("#kg-go", timeout=15000); pg.wait_for_selector("#kg-list .pl-krow, #kg-list p")
        check(True, "compte CEO connecté : générateur et révocateur affichés")
        pg.select_option("#kg-plan", "eto_max"); pg.select_option("#kg-days", "30"); pg.fill("#kg-count", "3"); pg.fill("#kg-note", "presse")
        pg.click("#kg-go"); pg.wait_for_selector(".pl-kcodebig >> nth=2")
        codes = [c.get_attribute("data-copy") for c in pg.locator(".pl-kcodebig").all()]
        check(len(codes) == 3 and all(re.fullmatch(r"ETO(-[0-9A-Z]{4}){4}", c) for c in codes), "3 clés ETO MAX générées : %s…" % codes[0][:9])
        check(pg.evaluate("(cs) => cs.every((c) => ENOS.plans._key.ok(ENOS.plans._key.norm(c)))", codes), "l'app reconnaît le contrôle des clés du serveur")
        pg.wait_for_function("document.querySelectorAll('#kg-list .pl-krow').length >= 3")
        check("presse" in pg.inner_text("#kg-list") and codes[0] not in pg.inner_text("#kg-list"), "liste des clés : note visible, clé jamais réaffichée en clair")
        pg.wait_for_timeout(700); pg.screenshot(path=SHOTS + "/ceo_keys.png", full_page=False)
        pg.evaluate("document.querySelector('#ceo-admin').scrollIntoView()"); pg.wait_for_timeout(300); pg.screenshot(path=SHOTS + "/ceo_keys2.png")
        # ---- client grand public : inscription puis activation
        pg.evaluate("ENOS.cloud.logout(true); ENOS.store.del('eto.license'); ENOS.native.isTestBuild = () => false; ENOS.plans.apply(true)")
        call("/launcher/v1/eto/signup", {"email": "lina@example.com", "password": PW})
        pg.evaluate("ENOS.ui.go('tools'); ENOS.modules.open('plans')"); pg.wait_for_timeout(500)
        pg.click('#tool-plans [data-acc="key"]'); pg.wait_for_selector("#sheet #pk-in")
        pg.fill("#pk-in", codes[0][:-1] + ("0" if codes[0][-1] != "0" else "1"))
        check(pg.is_disabled("#pk-go") and "faux" in pg.inner_text("#pk-st"), "faute de frappe détectée dans l'app avant tout envoi")
        pg.fill("#pk-in", codes[0].replace("-", "").lower()); pg.dispatch_event("#pk-in", "input")
        check(pg.input_value("#pk-in") == codes[0] and not pg.is_disabled("#pk-go"), "saisie remise en forme ETO-XXXX-… : %s" % pg.input_value("#pk-in")[:9])
        pg.click("#pk-go"); pg.wait_for_selector("#sheet #pa-name")            # pas connecté : création de compte proposée, la clé est gardée
        pg.click("#pa-sw"); pg.wait_for_function("!document.querySelector('#sheet #pa-name') && !!document.querySelector('#sheet #pa-mail')"); login_sheet(pg, "lina@example.com", then="#sheet #pk-in")
        check(pg.input_value("#pk-in") == codes[0], "après connexion, la clé est reprise")
        pg.click("#pk-go"); pg.wait_for_function("ENOS.plans.current() === 'eto_max'", timeout=20000)
        check(pg.evaluate("ENOS.plans.can('pc_control') && ENOS.plans.license().email === 'lina@example.com'"), "clé activée : licence signée ETO MAX dans l'app")
        pg.evaluate("ENOS.modules.open('plans')"); pg.click('#tool-plans [data-acc="key"]'); pg.wait_for_selector("#sheet #pk-in")
        pg.fill("#pk-in", codes[0]); pg.dispatch_event("#pk-in", "input"); pg.click("#pk-go"); pg.wait_for_function("document.querySelector('#pk-err').textContent.length > 3")
        check("déjà" in pg.inner_text("#pk-err"), "même clé une 2e fois : refusée (« %s »)" % pg.inner_text("#pk-err"))
        pg.evaluate("ENOS.ui.closeSheet(true)")
        # ---- Révocateur
        pg.evaluate("ENOS.cloud.logout(true); ENOS.native.isTestBuild = () => true; ENOS.plans.apply(true)")
        open_tool(pg, "ceo"); pg.click("#ceo-admin [data-adm=login]"); login_sheet(pg, "ceo@example.com")
        pg.wait_for_selector("#rv-q"); pg.fill("#rv-q", "lina"); pg.wait_for_selector('#rv-list [data-srev="lina@example.com"]')
        check("clé n°" in pg.inner_text("#rv-list"), "révocateur : compte trouvé, origine « clé n°… » affichée")
        pg.click('#rv-list [data-srev="lina@example.com"]'); pg.wait_for_selector("#sheet #rv-why"); pg.fill("#rv-why", "test")
        pg.click("#sheet .sheet-opts button >> text=Révoquer") if pg.locator("#sheet .sheet-opts").count() else pg.click("#sheet button:has-text('Révoquer')")
        pg.wait_for_function("!document.querySelector('#rv-list [data-srev]')", timeout=15000)
        tok = call("/launcher/v1/auth/login", {"email": "lina@example.com", "password": PW})["access_token"]
        me = call("/launcher/v1/eto/me", headers={"Authorization": "Bearer " + tok})
        check(me["subscription"]["plan"] == "eto_free", "abonnement révoqué côté serveur : ETO Free")
        # révocation d'une clé
        pg.click("#kg-list [data-krev] >> nth=0"); pg.wait_for_selector("#sheet #kr-subs")
        pg.click("#sheet button:has-text('Révoquer')"); pg.wait_for_function("document.querySelector('#kg-list').innerText.includes('Révoquée')", timeout=15000)
        check(True, "clé révoquée depuis l'Espace CEO")
        # l'app du client relit sa licence : ETO Free
        pg.evaluate("ENOS.cloud.logout(true); ENOS.native.isTestBuild = () => false")
        pg.evaluate("ENOS.modules.open('plans')"); pg.click('#tool-plans [data-acc="login"]'); login_sheet(pg, "lina@example.com")
        pg.wait_for_function("ENOS.plans.current() === 'eto_free'", timeout=15000)
        check(True, "l'app du client redescend en ETO Free à la relecture de la licence")
        check(not errs, "aucune erreur JS : %s" % errs[:3])
        b.close()
finally:
    srv.terminate()
raise SystemExit(1 if BAD else 0)
