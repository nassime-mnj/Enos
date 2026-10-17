"""Publie un manifeste signé (produit par build_release.py) sur le serveur Dual Pulse.

    py publish_release.py --server https://dualpulse.example --admin-path admin-dp --manifest launcher-enos-dev-3.2.0.manifest.json

Le jeton d'administration est lu dans la variable DP_ADMIN_TOKEN (jamais en argument : il resterait dans l'historique du terminal).
La signature est lue dans <manifeste>.sig si --sig n'est pas donné. Les binaires eux-mêmes se téléversent dans Cloudflare R2 sous la clé indiquée dans le manifeste
(ex. : rclone copyto release/installer/ENOS-Setup-3.2.0-dev.exe r2:dp-binaires/enos/dev/3.2.0/ENOS-Setup-3.2.0-dev.exe)."""
import argparse
import json
import os
import sys

import httpx


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--server", required=True)
    ap.add_argument("--admin-path", default="admin-dp")
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--sig", default="")
    a = ap.parse_args()
    token = os.environ.get("DP_ADMIN_TOKEN", "")
    if not token:
        sys.exit("DP_ADMIN_TOKEN absent de l'environnement.")
    manifest = json.load(open(a.manifest, encoding="utf-8"))
    sig = open(a.sig or a.manifest.replace(".manifest.json", ".sig")).read().strip()
    r = httpx.post(f"{a.server.rstrip('/')}/{a.admin_path.strip('/')}/api/launcher/releases", json={"manifest": manifest, "signature": sig},
                   headers={"X-Admin-Token": token}, timeout=30)
    print(r.status_code, r.text)
    sys.exit(0 if r.status_code == 200 else 1)


if __name__ == "__main__":
    main()
