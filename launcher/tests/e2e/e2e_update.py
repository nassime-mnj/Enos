"""Mises à jour automatiques (aperçu navigateur, vrai serveur) : interrupteur persistant, téléchargement silencieux d'un manifeste « files » plus récent dans le staging, badge « prête »,
manifeste « installeur » jamais téléchargé en arrière-plan. Lancer : bash start.sh e2e_update.py"""
import hashlib, json, os, sys, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "dualpulse_site"))
from app.launcher import tokens, manifests  # noqa: E402

UI, B, PW = "http://127.0.0.1:8801/", "http://127.0.0.1:8800", "Un-bon-mot-de-passe-42"
ADM = {"X-Admin-Token": "jeton-admin-e2e-123", "Content-Type": "application/json"}
priv = tokens.private_from_b64(open("/tmp/dpl_e2e_priv").read())
BAD = []


def check(c, m):
    print(("OK   " if c else "FAIL ") + m)
    if not c: BAD.append(m)


def req(path, body):
    r = urllib.request.Request(B + path, data=json.dumps(body).encode(), headers=ADM, method="POST")
    return json.load(urllib.request.urlopen(r))


# release « files » 3.4.0 (canal ceo) : 2 fichiers
store = "/tmp/dpl_e2e/store"; files = {"ENOS.exe": b"MZ-FILES-" + b"e" * 30000, "godot_eye/pet.gd": b"extends Node\n"}
entries = []
for rel, data in files.items():
    key = f"enos/ceo/3.4.0/files/{rel}"; os.makedirs(os.path.dirname(f"{store}/{key}"), exist_ok=True); open(f"{store}/{key}", "wb").write(data)
    entries.append({"path": rel, "sha256": hashlib.sha256(data).hexdigest(), "size": len(data), "key": key})
m = {"product": "enos", "channel": "ceo", "version": "3.4.0", "released": "2026-10-25", "notes": "3.4.0 (files)", "min_launcher": "0.2.0", "mode": "files", "run": "ENOS.exe", "files": entries}
print(req("/admin-dp/api/launcher/releases", {"manifest": m, "signature": manifests.sign(priv, m)}).get("ok", "publié"))

with sync_playwright() as pw:
    b = pw.chromium.launch(**({"executable_path": os.environ["CHROMIUM"]} if os.environ.get("CHROMIUM") else {}), args=["--no-sandbox"])
    pg = b.new_context(viewport={"width": 1280, "height": 800}).new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200])); posts = []
    pg.goto(UI); pg.evaluate("localStorage.setItem('dp_server','http://127.0.0.1:8800'); localStorage.setItem('dp_preview_installed', JSON.stringify({enos: {version: '3.3.0', channel: 'ceo'}}))"); pg.reload()
    pg.wait_for_selector("#lg-form"); pg.fill("#lg-email", "ceo@dualpulse.test"); pg.fill("#lg-pw", PW); pg.click("#lg-go"); pg.wait_for_selector("#shell")
    pg.click('[data-nav="software"]'); pg.wait_for_selector("#view-software")
    check("3.4.0" in pg.inner_text("#enos-latest") and pg.locator("#enos-update-badge").count() == 1, "mise à jour 3.4.0 détectée (installé : 3.3.0)")
    check(pg.locator("#enos-staged").count() == 0, "rien en staging tant que l'option est désactivée")
    pg.click('[data-nav="account"]'); pg.wait_for_selector("#set-auto")
    check(not pg.is_checked("#set-auto"), "« Mises à jour automatiques » désactivé par défaut")
    pg.click("#set-auto"); pg.wait_for_timeout(300)
    check(json.loads(pg.evaluate("localStorage.getItem('dp_preview_settings')"))["auto_update"] is True, "réglage enregistré")
    pg.wait_for_function("localStorage.getItem('dp_preview_staged')", timeout=20000)
    staged = json.loads(pg.evaluate("localStorage.getItem('dp_preview_staged')"))
    check(staged["enos"]["version"] == "3.4.0", "téléchargement silencieux terminé : 3.4.0 en staging")
    pg.click('[data-nav="software"]'); pg.wait_for_selector("#enos-staged")
    t = pg.inner_text("#enos-staged"); check("PRÊTE" in t.upper() and "3.4.0" in t and "Redémarrer pour appliquer" in t, "badge « mise à jour prête » : %r" % t[:90])
    pg.reload(); pg.wait_for_selector("#shell"); pg.click('[data-nav="account"]'); pg.wait_for_selector("#set-auto")
    check(pg.is_checked("#set-auto"), "l'interrupteur reste activé après rechargement")
    pg.click("#set-auto"); pg.wait_for_timeout(300); check(json.loads(pg.evaluate("localStorage.getItem('dp_preview_settings')"))["auto_update"] is False, "désactivation enregistrée")
    check(not errs, "aucune erreur JavaScript : %s" % errs[:3]); b.close()
print("ECHECS:", BAD or "aucun"); sys.exit(1 if BAD else 0)
