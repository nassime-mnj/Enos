"""ETO Gateway de bout en bout : vrai serveur Dual Pulse local + FAUX OpenRouter local (aucun appel réel).
Compte ETO MAX -> module ETO Gateway -> « Obtenir ma clé » (créée par le serveur via l'API de gestion, rangée dans le coffre) -> le chat ETO passe par
OpenRouter avec CETTE clé -> « Recréer la clé » (l'ancienne est supprimée) -> révocation de l'offre par un CEO -> clé désactivée, le chat est refusé."""
import json, os, subprocess, sys, tempfile, time, urllib.request
from mobile_common import *

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..", "dualpulse_site")
TMP = tempfile.mkdtemp(prefix="etogw_"); PORT, FPORT = 8822, 8823; BASE = "http://127.0.0.1:%d" % PORT; FAKE = "http://127.0.0.1:%d" % FPORT; PW = "Un-bon-mot-de-passe-42"
fake = subprocess.Popen([sys.executable, os.path.join(HERE, "fake_openrouter.py"), str(FPORT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
env = dict(os.environ, DP_DB=os.path.join(TMP, "t.db"), DP_ADMIN_TOKEN="jeton-test-123456", DP_ADMIN_PATH="admin-dp", DP_STORAGE_DIR=os.path.join(TMP, "s"),
           DP_OPENROUTER_MGMT="mgmt-test", DP_OPENROUTER_BASE=FAKE + "/api/v1")
srv = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(PORT), "--log-level", "warning"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
SHOTS = os.environ.get("SHOTS") or "/tmp"


def call(path, body=None, headers=None, base=BASE):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, headers=dict({"Content-Type": "application/json"}, **(headers or {})), method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


state = lambda: call("/_state", base=FAKE)
try:
    for _ in range(60):
        try:
            call("/launcher/v1/keys"); state(); break
        except Exception:
            time.sleep(0.5)
    A = {"X-Admin-Token": "jeton-test-123456"}
    call("/admin-dp/api/launcher/ceo", {"email": "ceo@example.com", "password": PW}, A)
    HC = {"Authorization": "Bearer " + call("/launcher/v1/auth/login", {"email": "ceo@example.com", "password": PW})["access_token"]}
    call("/launcher/v1/eto/signup", {"email": "dev@example.com", "password": PW})
    call("/launcher/v1/eto/admin/grant", {"email": "dev@example.com", "plan": "eto_max", "days": 30}, HC)
    errs = []
    with sync_playwright() as pw:
        b, ctx = launch(pw, bypass_csp=True)
        CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE,PATCH"}
        def fwd(route, url=None):                          # dans l'app, Java appelle les services (pas de CORS) ; ici Playwright relaie (openrouter.ai -> faux local)
            if route.request.method == "OPTIONS":
                return route.fulfill(status=204, headers=CORS)
            r = route.fetch(url=url); route.fulfill(response=r, headers=dict(r.headers, **CORS))
        ctx.route(BASE + "/**", lambda route: fwd(route))
        ctx.route("https://openrouter.ai/**", lambda route: fwd(route, route.request.url.replace("https://openrouter.ai", FAKE)))
        pg = open_app(ctx, errs); pg.set_default_timeout(30000)
        pg.add_style_tag(content="#toasts{display:none!important}")
        pg.evaluate("ENOS.native.isTestBuild = () => false; ENOS.native.vault.del('groq'); ENOS.native.vault.del('openrouter'); ENOS.plans.apply(true)")
        check(not pg.evaluate("ENOS.ai.configured()"), "sans clé : l'IA d'ETO n'est pas configurée")
        open_tool(pg, "plans"); pg.click('#tool-plans [data-acc="login"]'); pg.wait_for_selector("#sheet #pa-mail")
        if pg.locator("#sheet #pa-url").count():
            pg.fill("#pa-url", BASE)
        pg.fill("#pa-mail", "dev@example.com"); pg.fill("#pa-pw", PW); pg.click("#pa-go"); pg.wait_for_function("ENOS.plans.current() === 'eto_max'", timeout=20000)
        pg.evaluate("ENOS.modules.open('gateway')"); pg.wait_for_selector('#tool-gateway [data-gw="new"]')
        check("2,00 $" in pg.inner_text("#tool-gateway"), "ETO MAX : plafond affiché (2,00 $ d'IA par mois)")
        pg.click('#tool-gateway [data-gw="new"]'); pg.wait_for_selector("#tool-gateway .gw-fresh", timeout=20000)
        s1 = state()
        check(len(s1["keys"]) == 1 and list(s1["keys"].values())[0]["limit"] == 2.0 and list(s1["keys"].values())[0]["limit_reset"] == "monthly", "clé créée chez OpenRouter par le serveur : plafond 2 $ / mois")
        check(pg.evaluate("ENOS.native.vault.has('openrouter') && ENOS.ai.source() === 'eto' && ENOS.ai.configured()"), "clé rangée dans le coffre, le chat passe sur ETO Gateway")
        pg.wait_for_selector("#tool-gateway .gw-bar i"); check("0,42 $" in pg.inner_text("#tool-gateway"), "consommation du mois lue chez OpenRouter (0,42 $)")
        pg.wait_for_timeout(900); pg.screenshot(path=SHOTS + "/gateway.png")
        out = pg.evaluate("ENOS.ai.chat('eto', 'salut', () => {}, {oneShot: true}).then((t) => t, (e) => 'ERR ' + e.message)")
        last = state()["last_chat"]
        check(out.strip() == "Bonjour depuis ETO Gateway." and last["key_ok"], "le chat ETO répond via OpenRouter avec la clé du client : %r" % out)
        check(last["model"] == "openai/gpt-oss-120b" and last["reasoning"] == {"effort": "low"}, "requête adaptée à OpenRouter (modèle %s, reasoning)" % last["model"])
        # rotation
        pg.click('#tool-gateway [data-gw="new"]'); pg.wait_for_selector("#sheet:not([hidden])"); pg.click("#sheet button:has-text('RECRÉER')")
        pg.wait_for_selector("#tool-gateway .gw-note", timeout=20000)
        s2 = state()
        check(len(s2["keys"]) == 1 and list(s2["keys"]) != list(s1["keys"]), "« Recréer » : l'ancienne clé est supprimée chez OpenRouter, une seule clé vivante")
        out = pg.evaluate("ENOS.ai.chat('eto', 'encore', () => {}, {oneShot: true}).then((t) => t, (e) => 'ERR ' + e.message)")
        check(out.strip() == "Bonjour depuis ETO Gateway.", "le chat utilise automatiquement la nouvelle clé")
        # révocation de l'offre -> clé désactivée
        call("/launcher/v1/eto/admin/revoke", {"email": "dev@example.com", "reason": "test"}, HC)
        check(list(state()["keys"].values())[0]["disabled"] is True, "offre révoquée par un CEO : clé désactivée chez OpenRouter")
        out = pg.evaluate("ENOS.ai.chat('eto', 'et maintenant', () => {}, {oneShot: true}).then((t) => t, (e) => 'ERR ' + e.message)")
        check(out.startswith("ERR"), "le chat est refusé avec la clé désactivée : %s" % out[:60])
        pg.evaluate("ENOS.modules.open('gateway')"); pg.wait_for_function("document.querySelector('#tool-gateway').innerText.includes('désactivée')", timeout=15000)
        check(True, "le module affiche la clé désactivée")
        check(not errs, "aucune erreur JS : %s" % errs[:3])
        b.close()
finally:
    srv.terminate(); fake.terminate()
raise SystemExit(1 if BAD else 0)
