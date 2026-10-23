"""Publie l'application mobile (ENOS.apk) dans le cloud : téléverse l'APK dans Cloudflare R2, signe le manifeste (clé OTA du CEO) et l'enregistre sur le serveur.

    py publish_apk.py --apk ..\\ENOS.apk --server https://dualpulse.onrender.com --channel stable [--notes "…"]

Lit ENOS.apk.json (écrit par construire_apk.py : versionCode, versionName, sha256, size). Variables d'environnement :
    DP_ADMIN_TOKEN                                  jeton d'administration du serveur
    DP_R2_ENDPOINT DP_R2_BUCKET DP_R2_ACCESS_KEY DP_R2_SECRET_KEY    Cloudflare R2 (jeton d'API « Écriture »)
    ENOS_OTA_KEY                                    (facultatif) chemin de ota_private.pem ; défaut : %LOCALAPPDATA%\\ENOS-release\\keys\\ota_private.pem
Le serveur ne reçoit JAMAIS la clé privée : il vérifie la signature avec DP_MANIFEST_PUBKEY."""
import argparse
import base64
import datetime
import hashlib
import json
import os
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.launcher import manifests, storage  # noqa: E402


def load_key():
    from cryptography.hazmat.primitives import serialization
    default = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "ENOS-release" / "keys" / "ota_private.pem"
    p = Path(os.environ.get("ENOS_OTA_KEY") or default)
    if not p.is_file():
        sys.exit(f"Clé de signature introuvable : {p} (créée par build_release.py ; à sauvegarder).")
    return serialization.load_pem_private_key(p.read_bytes(), None)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apk", required=True)
    ap.add_argument("--server", required=True)
    ap.add_argument("--channel", default="stable", choices=("stable", "dev", "ceo"))
    ap.add_argument("--admin-path", default="admin-dp")
    ap.add_argument("--notes", default="Améliorations et corrections.")
    ap.add_argument("--dry-run", action="store_true", help="calcule et affiche le manifeste sans rien envoyer")
    a = ap.parse_args()
    apk = Path(a.apk)
    info = json.loads(Path(str(apk) + ".json").read_text(encoding="utf-8"))
    data = apk.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    if info.get("sha256") and info["sha256"] != sha:
        sys.exit("L'APK ne correspond pas à ENOS.apk.json : reconstruisez-la.")
    version, code = str(info["versionName"]), int(info["versionCode"])
    key = f"enos-mobile/{a.channel}/{version}/NASKO.apk"
    manifest = {"product": "enos-mobile", "channel": a.channel, "version": version, "version_code": code, "released": datetime.date.today().isoformat(), "notes": a.notes,
                "min_launcher": "", "launch": "", "files": [{"path": "NASKO.apk", "sha256": sha, "size": len(data), "key": key}]}
    sig = manifests.sign(load_key(), manifest)
    print(f"APK {version} (code {code}), {len(data) // 1024} Ko, sha256 {sha[:12]}… -> {key}")
    if a.dry_run:
        print(json.dumps(manifest, indent=1, ensure_ascii=False)); return
    r2 = storage.r2_config()
    if not r2:
        sys.exit("Variables Cloudflare R2 manquantes (DP_R2_ENDPOINT, DP_R2_BUCKET, DP_R2_ACCESS_KEY, DP_R2_SECRET_KEY).")
    url = storage.presign_get(endpoint=r2["DP_R2_ENDPOINT"], bucket=r2["DP_R2_BUCKET"], key=key, access_key=r2["DP_R2_ACCESS_KEY"], secret_key=r2["DP_R2_SECRET_KEY"], expires=900, method="PUT")
    r = httpx.put(url, content=data, headers={"Content-Type": "application/vnd.android.package-archive"}, timeout=600)
    if r.status_code not in (200, 201):
        sys.exit(f"Téléversement R2 refusé : {r.status_code} {r.text[:200]}")
    print("Téléversé dans R2.")
    token = os.environ.get("DP_ADMIN_TOKEN", "")
    if not token:
        sys.exit("DP_ADMIN_TOKEN absent de l'environnement.")
    r = httpx.post(f"{a.server.rstrip('/')}/{a.admin_path.strip('/')}/api/launcher/releases", json={"manifest": manifest, "signature": sig}, headers={"X-Admin-Token": token}, timeout=60)
    print(r.status_code, r.text)
    sys.exit(0 if r.status_code == 200 else 1)


if __name__ == "__main__":
    main()
