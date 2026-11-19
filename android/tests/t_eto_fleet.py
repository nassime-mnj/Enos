"""ETO Fleet de bout en bout, vrai serveur Dual Pulse local : un compte ETO Ultra crée son équipe dans l'application, invite (code affiché une fois),
un collègue rejoint (il passe en ETO Ultra par sa place), son téléphone envoie son pouls (stockage presque plein, batterie faible) -> alertes dans la
console ; action « Message » envoyée depuis la console -> reçue par l'appareil ; et l'inverse : une action envoyée à CE téléphone s'affiche ici."""
import json, os, subprocess, sys, tempfile, time, urllib.request
from mobile_common import *

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "dualpulse_site")
TMP = tempfile.mkdtemp(prefix="etofleet_"); PORT = 8824; BASE = "http://127.0.0.1:%d" % PORT; PW = "Un-bon-mot-de-passe-42"
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
    HC = {"Authorization": "Bearer " + call("/launcher/v1/auth/login", {"email": "ceo@example.com", "password": PW})["access_token"]}
    call("/launcher/v1/eto/signup", {"email": "boss@example.com", "password": PW})
    call("/launcher/v1/eto/admin/grant", {"email": "boss@example.com", "plan": "eto_ultra", "days": 30}, HC)
    HM = {"Authorization": "Bearer " + call("/launcher/v1/eto/signup", {"email": "ana@example.com", "password": PW})["access_token"]}
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
        open_tool(pg, "fleet"); pg.wait_for_selector('#tool-fleet [data-fl="acc"]')
        pg.click('#tool-fleet [data-fl="acc"]'); pg.wait_for_selector("#sheet #pa-mail")
        if pg.locator("#sheet #pa-url").count():
            pg.fill("#pa-url", BASE)
        pg.fill("#pa-mail", "boss@example.com"); pg.fill("#pa-pw", PW); pg.click("#pa-go"); pg.wait_for_function("ENOS.plans.current() === 'eto_ultra'", timeout=20000)
        pg.evaluate("ENOS.modules.open('fleet')"); pg.wait_for_selector('#tool-fleet [data-fl="create"]')
        pg.fill("#fl-name", "Studio Nova"); pg.click('#tool-fleet [data-fl="create"]'); pg.wait_for_selector('#tool-fleet [data-fl="inv1"]')
        check("Studio Nova" in pg.inner_text("#tool-fleet"), "équipe créée depuis l'application")
        pg.click('#tool-fleet [data-fl="inv1"]'); pg.wait_for_selector("#tool-fleet .pl-kcodebig")
        code = pg.get_attribute("#tool-fleet .pl-kcodebig", "data-copy")
        check(code.startswith("ETO-TEAM-"), "code d'invitation : %s…" % code[:13])
        call("/launcher/v1/eto/fleet/join", {"code": code}, HM)
        me = call("/launcher/v1/eto/me", headers=HM)
        check(me["subscription"]["plan"] == "eto_ultra" and me["subscription"]["source"] == "team", "le collègue rejoint et profite d'ETO Ultra par sa place")
        beat = {"device_id": "pixel-ana", "name": "Pixel d'Ana", "app_version": "1.90", "battery": 0.08, "charging": False, "storage_free": 3 * 2**30, "storage_total": 128 * 2**30}
        call("/launcher/v1/eto/fleet/beat", beat, HM)
        pg.evaluate("ENOS.modules.open('fleet')"); pg.wait_for_selector('#tool-fleet .fl-dev[data-dev="pixel-ana"]')
        txt = pg.inner_text('#tool-fleet .fl-dev[data-dev="pixel-ana"]')
        check("Stockage presque plein" in txt and "Batterie faible" in txt, "console : appareil du collègue avec ses alertes")
        check(pg.locator('#tool-fleet .fl-dev').count() == 2, "console : ce téléphone apparaît aussi (pouls envoyé à l'ouverture)")
        pg.wait_for_timeout(800); pg.screenshot(path=SHOTS + "/fleet.png")
        # action vers le collègue
        pg.click('#tool-fleet .fl-dev[data-dev="pixel-ana"] [data-act]'); pg.wait_for_selector("#sheet:not([hidden])")
        pg.click("#sheet button:has-text('Message')"); pg.wait_for_selector("#sheet-in"); pg.fill("#sheet-in", "Libère de l'espace stp"); pg.click("#sheet button:has-text('ENVOYER')")
        pg.wait_for_function("document.querySelector('#tool-fleet').innerText.includes('En attente')", timeout=15000)
        cmds = call("/launcher/v1/eto/fleet/beat", beat, HM)["commands"]
        check(len(cmds) == 1 and cmds[0]["cmd"] == "message" and cmds[0]["args"]["text"] == "Libère de l'espace stp", "l'appareil du collègue reçoit le message à son pouls suivant")
        # action vers CE téléphone : envoyée par le collègue (admin) via l'API
        mine = pg.evaluate("ENOS.native.deviceId()")
        dev = [d for d in call("/launcher/v1/eto/fleet", headers=HM)["devices"]]
        check(dev and all(d["device_id"] == "pixel-ana" for d in dev), "un simple membre ne voit que ses propres appareils")
        pg.evaluate("ENOS.ui.closeSheet && ENOS.ui.closeSheet(true)")
        r = pg.evaluate("""async (mine) => { const r = await ENOS.cloud.req('/eto/fleet/cmd', {method: 'POST', body: {email: 'boss@example.com', device_id: mine, cmd: 'message', args: {text: 'Réunion à 14 h'}}}); return r.status; }""", mine)
        pg.wait_for_timeout(500); pg.evaluate("ENOS.cloud.fleetBeat()")
        try:
            pg.wait_for_function("(document.querySelector('#sheet') || {}).innerText && document.querySelector('#sheet').innerText.includes('Réunion')", timeout=10000)
        except Exception:
            pass
        check("Réunion à 14 h" in pg.inner_text("#sheet") and r == 200, "ce téléphone exécute l'action reçue (message affiché)")
        pg.evaluate("ENOS.ui.closeSheet(true)")
        pg.evaluate("ENOS.modules.open('fleet')"); pg.wait_for_function("document.querySelector('#tool-fleet').innerText.includes('Exécutée')", timeout=15000)
        check(True, "compte rendu « Exécutée » dans les actions récentes")
        check(not errs, "aucune erreur JS : %s" % errs[:3])
        b.close()
finally:
    srv.terminate()
raise SystemExit(1 if BAD else 0)
