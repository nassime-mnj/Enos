"""Compte cloud, presse-papiers universel, appareil visible du PC et mises à jour : application mobile (navigateur) contre le VRAI serveur Dual Pulse."""
import base64, hashlib, json, os, sys, urllib.request
from mobile_common import *

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "dualpulse_site"))
from app.launcher import manifests, tokens  # noqa: E402

API = "http://127.0.0.1:8800"
PW = "Un-bon-mot-de-passe-42"


def api(path, body=None, token=None, method=None, admin=False):
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    if admin: h["X-Admin-Token"] = "jeton-admin-e2e-123"
    r = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method or ("POST" if body is not None else "GET"))
    return json.load(urllib.request.urlopen(r))


# --- côté « PC » / serveur : un compte Friends invité par le CEO + une version mobile publiée
ceo = api("/launcher/v1/auth/login", {"email": "ceo@dualpulse.test", "password": PW})
inv = api("/launcher/v1/invites", {"role": "friends", "days": 3}, ceo["access_token"])
priv = tokens.private_from_b64(open("/tmp/dpl_e2e_priv").read())
store = "/tmp/dpl_e2e/store"; apk = b"PK-APK-MOBILE-1.12-" + b"x" * 5000
key = "enos-mobile/stable/1.12.0/NASKO.apk"; os.makedirs(os.path.dirname(f"{store}/{key}"), exist_ok=True); open(f"{store}/{key}", "wb").write(apk)
m = {"product": "enos-mobile", "channel": "stable", "version": "1.12.0", "version_code": 112, "released": "2026-10-20", "notes": "Parité PC", "min_launcher": "", "launch": "",
     "files": [{"path": "NASKO.apk", "sha256": hashlib.sha256(apk).hexdigest(), "size": len(apk), "key": key}]}
api("/admin-dp/api/launcher/releases", {"manifest": m, "signature": manifests.sign(priv, m)}, admin=True)

with sync_playwright() as pw:
    b, ctx = launch(pw, bypass_csp=True); errs = []
    pg = open_app(ctx, errs)
    pg.evaluate("localStorage.clear()"); pg.reload(); pg.wait_for_selector("#tabbar")
    open_tool(pg, "cloud")
    check(pg.locator("#cl-go").count() == 1, "écran de connexion cloud")
    pg.fill("#cl-url", "http://127.0.0.1:8800"); pg.dispatch_event("#cl-url", "change")
    pg.fill("#cl-mail", "ami@example.com"); pg.fill("#cl-pw", PW); pg.click("#cl-go")
    pg.wait_for_selector("#cl-err:not([hidden])"); check("incorrects" in pg.inner_text("#cl-err").lower(), "connexion refusée (compte inconnu)")
    pg.click("#cl-tr"); pg.fill("#cl-inv", "DP-faux"); pg.fill("#cl-mail", "ami@example.com"); pg.fill("#cl-pw", PW); pg.click("#cl-go")
    pg.wait_for_selector("#cl-err:not([hidden])"); check("invitation" in pg.inner_text("#cl-err").lower(), "inscription sans bonne invitation refusée")
    pg.fill("#cl-inv", inv["code"]); pg.click("#cl-go")
    pg.wait_for_selector("#cl-update", timeout=15000)
    check("Friends" in pg.inner_text("#tool-cloud") or "FRIENDS" in pg.inner_text("#tool-cloud").upper(), "inscrit avec le rôle de l'invitation")
    dev = pg.evaluate("JSON.parse(localStorage.getItem('enos.devvault')||'{}')")
    check("cloud_refresh" in dev and "cloud_access" in dev, "jetons rangés dans le coffre (mode dev : localStorage)")
    check("password" not in json.dumps(pg.evaluate("Object.assign({}, localStorage)")).lower() and PW not in json.dumps(pg.evaluate("Object.assign({}, localStorage)")), "aucun mot de passe mémorisé")
    # ---- mises à jour : jeton d'appareil + endpoints compatibles avec Updater.java
    pg.evaluate("ENOS.cloud.updateSetup()"); pg.wait_for_timeout(1200)
    base = pg.evaluate("JSON.parse(localStorage.getItem('enos.devvault')).cloud_update_base")
    check(base.startswith("http://127.0.0.1:8800/m/") and base.endswith("/"), "adresse de mise à jour enregistrée")
    v = json.load(urllib.request.urlopen(base + "api/app/version"))
    check(v["versionCode"] == 112 and v["versionName"] == "1.12.0" and v["sha256"] == hashlib.sha256(apk).hexdigest(), "le serveur annonce la version mobile 1.12.0 (code 112)")
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k): return None
    try:
        urllib.request.build_opener(NoRedirect).open(base + "nasko.apk"); loc = ""
    except urllib.error.HTTPError as e: loc = e.headers.get("Location", "")
    check("/launcher/v1/blob/" in loc and urllib.request.urlopen(loc).read() == apk, "nasko.apk -> lien signé vers le bon APK")
    # ---- appareil visible du PC
    pg.fill("#cl-dname", "Pixel de Léo"); pg.fill("#cl-adb", "37123"); pg.click("#cl-beat"); pg.wait_for_timeout(1500)
    me = api("/launcher/v1/auth/login", {"email": "ami@example.com", "password": PW})
    devs = api("/launcher/v1/devices", token=me["access_token"])["items"]
    check(len(devs) >= 1 and devs[0]["name"] == "Pixel de Léo" and devs[0]["adb_port"] == 37123 and devs[0]["online"], "le PC peut lire le nom / port ADB du téléphone : " + str(devs[:1]))
    # ---- presse-papiers universel
    open_tool(pg, "clip"); pg.wait_for_selector("#cp-send")
    pg.fill("#cp-text", "https://exemple.fr/à-ouvrir-sur-le-pc"); pg.click("#cp-send"); pg.wait_for_selector(".cp-it")
    got = api("/launcher/v1/clipboard", token=me["access_token"])["items"]
    check(got and got[0]["content"] == "https://exemple.fr/à-ouvrir-sur-le-pc" and got[0]["device"] == "phone", "texte copié sur le téléphone -> disponible côté PC")
    api("/launcher/v1/clipboard", {"kind": "text", "content": "texte venu du PC", "device": "pc"}, me["access_token"])
    pg.wait_for_selector("text=texte venu du PC", timeout=12000)
    check(True, "texte copié sur le PC -> apparaît sur le téléphone (sondage automatique)")
    png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\0" * 60).decode()
    api("/launcher/v1/clipboard", {"kind": "image", "mime": "image/png", "content": png, "device": "pc"}, me["access_token"]); pg.wait_for_selector(".cp-it img", timeout=12000)
    check(True, "image copiée sur le PC -> affichée sur le téléphone")
    pg.click(".cp-it [data-rm]"); pg.wait_for_timeout(800)
    check(len(api("/launcher/v1/clipboard", token=me["access_token"])["items"]) == 2, "suppression depuis le téléphone")
    # ---- isolation : l'autre compte (CEO) ne voit pas ce presse-papiers
    check(not [i for i in api("/launcher/v1/clipboard", token=ceo["access_token"])["items"] if "exemple.fr" in i["content"]], "le presse-papiers d'un compte n'est pas visible d'un autre")
    # ---- agenda via le cloud (le téléphone et le « PC » partagent les tâches)
    open_tool(pg, "cloud"); pg.wait_for_selector("#cl-agsync")
    pg.evaluate("ENOS.agenda.tasks.length = 0; ENOS.store.set('tasks', [])")
    pg.check("#cl-agsync"); pg.wait_for_timeout(1500)
    api("/launcher/v1/agenda/sync", {"since": 0, "tasks": [{"id": "pctask0001", "title": "Tâche créée sur le PC", "due": "2026-10-23T08:00", "updated": __import__("time").time()}]}, me["access_token"])
    pg.evaluate("ENOS.cloud.syncAgenda()"); pg.wait_for_timeout(1500)
    check(pg.evaluate("ENOS.agenda.tasks.some(t=>t.title==='Tâche créée sur le PC')"), "tâche du PC -> agenda du téléphone")
    pg.evaluate("ENOS.agenda.addTask('Tâche créée sur le téléphone','2026-10-24T09:00')"); pg.evaluate("ENOS.cloud.syncAgenda()"); pg.wait_for_timeout(1500)
    srv = api("/launcher/v1/agenda/sync", {"since": 0, "tasks": []}, me["access_token"])["tasks"]
    check(any(t["title"] == "Tâche créée sur le téléphone" for t in srv), "tâche du téléphone -> cloud (donc disponible sur le PC)")
    # ---- session persistante + déconnexion
    pg.reload(); pg.wait_for_selector("#tabbar"); open_tool(pg, "cloud"); pg.wait_for_selector("#cl-update", timeout=10000)
    check(True, "session conservée après rechargement")
    pg.click("#cl-out"); pg.wait_for_selector("#cl-go")
    dev = pg.evaluate("JSON.parse(localStorage.getItem('enos.devvault')||'{}')")
    check("cloud_refresh" not in dev and "cloud_access" not in dev and "cloud_update_base" not in dev, "déconnexion : coffre vidé")
    check(not errs, "aucune erreur JavaScript " + str(errs[:3]))
    b.close()
print("ÉCHECS:", BAD or "aucun")
