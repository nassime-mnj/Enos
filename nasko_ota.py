"""Mise à jour OTA d'E.N.O.S. installé (sans Python ni code source) : manifeste signé -> installeur téléchargé -> vérifié -> lancé en silence.

  1. `update_manifest_url` (nasko_config.json) pointe vers un fichier enos-update.json (ex. GitHub Releases) ; sa signature détachée
     (même adresse + « .sig », Ed25519 en base64) est vérifiée avec la clé publique livrée dans l'application (ota_pubkey.txt).
     Un manifeste non signé ou modifié est REFUSÉ : sans cela, quiconque contrôle l'hébergement pourrait faire exécuter n'importe quoi.
  2. L'installeur (URL https uniquement) est téléchargé dans %TEMP%, comparé à la taille et au SHA-256 du manifeste, puis lancé en
     /SILENT : Windows affiche l'invite UAC, Inno Setup remplace les fichiers (jamais nasko_config.json ni data\\) et relance E.N.O.S.
Manifeste : {"version": "3.1.0", "url": "https://…/ENOS-Setup-3.1.0.exe", "sha256": "…", "size": 123, "notes": "…"}
"""
import base64
import hashlib
import json
import logging
import os
import re
import tempfile
import threading
import time

import httpx

import nasko_core

log = logging.getLogger("nasko.ota")
_lock = threading.Lock()
JOB = {"phase": "idle", "progress": 0.0, "message": "", "latest": None, "checked": 0.0}
_VER = re.compile(r"^\d+(\.\d+){0,3}$")


def current_version():
    try:
        with open(nasko_core.resource_path("version.txt"), encoding="utf-8") as f:
            return f.read().strip() or "dev"
    except OSError:
        return "dev"


def _vkey(v):
    return tuple(int(x) for x in v.split("."))


def _public_key():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    with open(nasko_core.resource_path("ota_pubkey.txt"), encoding="ascii") as f:
        return Ed25519PublicKey.from_public_bytes(base64.b64decode(f.read().strip()))


def _get(client, url, **kw):
    if not url.lower().startswith("https://"):
        raise ValueError("l'adresse de mise à jour doit être en https")
    r = client.get(url, follow_redirects=True, headers={"User-Agent": "ENOS-OTA"}, **kw)
    r.raise_for_status()
    return r


def check(cfg=None):
    """Interroge le manifeste. Retourne {current, latest, available, notes} ; lève ValueError (message clair) si impossible/non signé."""
    cfg = cfg or nasko_core.load_config()
    url = (cfg.get("update_manifest_url") or "").strip()
    if not url:
        raise ValueError("aucune adresse de mise à jour configurée (update_manifest_url)")
    with httpx.Client(timeout=20, verify=nasko_core.ssl_context()) as c:
        raw = _get(c, url).content
        sig = base64.b64decode(_get(c, url + ".sig").content.strip())
    try:
        _public_key().verify(sig, raw)
    except Exception:                                              # noqa: BLE001 — cryptography.exceptions.InvalidSignature, clé absente…
        raise ValueError("signature du manifeste invalide : mise à jour refusée")
    m = json.loads(raw)
    if not (_VER.match(str(m.get("version", ""))) and re.fullmatch(r"[0-9a-f]{64}", str(m.get("sha256", "")))
            and str(m.get("url", "")).lower().startswith("https://")):
        raise ValueError("manifeste invalide")
    cur = current_version()
    avail = bool(_VER.match(cur)) and _vkey(m["version"]) > _vkey(cur)       # « dev » (lancé depuis les sources) : jamais d'OTA
    with _lock:
        JOB.update(latest=m, checked=time.time())
    return {"current": cur, "latest": m["version"], "available": bool(avail), "notes": str(m.get("notes", ""))[:600]}


def _download_and_run(manifest, shutdown):
    try:
        dest_dir = os.path.join(tempfile.gettempdir(), "ENOS-update")
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, f"ENOS-Setup-{manifest['version']}.exe")
        h = hashlib.sha256()
        with httpx.Client(timeout=60, verify=nasko_core.ssl_context()) as c, c.stream("GET", manifest["url"], follow_redirects=True,
                                                                                 headers={"User-Agent": "ENOS-OTA"}) as r:
            r.raise_for_status()
            total = int(manifest.get("size") or r.headers.get("content-length") or 0)
            done = 0
            with open(dest, "wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    f.write(chunk)
                    h.update(chunk)
                    done += len(chunk)
                    JOB.update(phase="download", progress=min(0.95, done / total) if total else 0.5, message=f"{done >> 20} Mo")
        if h.hexdigest() != manifest["sha256"]:
            os.remove(dest)
            raise ValueError("somme SHA-256 incorrecte : fichier supprimé")
        JOB.update(phase="install", progress=1.0, message="Lancement de l'installeur (autorisez l'invite Windows)…")
        import ctypes                                              # « runas » : invite UAC (CreateProcess échoue en 740 sur un installeur administrateur)
        rc = ctypes.windll.shell32.ShellExecuteW(None, "runas", dest, "/SILENT /CLOSEAPPLICATIONS /NOCANCEL", None, 1)
        if rc <= 32:
            raise ValueError("autorisation administrateur refusée" if rc == 5 else f"lancement de l'installeur impossible (code {rc})")
        time.sleep(1.5)
        if shutdown:
            shutdown()                                             # ferme E.N.O.S. : l'installeur remplace les fichiers puis le relance
    except Exception as e:                                         # noqa: BLE001
        log.warning("OTA : %s", e)
        JOB.update(phase="error", message=re.sub(r"https?://\S+", "<lien>", str(e))[:200])


def install(shutdown=None):
    """Télécharge puis lance l'installeur du dernier manifeste vérifié. Retourne immédiatement (suivi : status())."""
    with _lock:
        m = JOB.get("latest")
        if JOB["phase"] in ("download", "install"):
            raise ValueError("mise à jour déjà en cours")
        if not m:
            raise ValueError("vérifiez d'abord les mises à jour")
        JOB.update(phase="download", progress=0.0, message="")
    threading.Thread(target=_download_and_run, args=(m, shutdown), daemon=True, name="enos-ota").start()


def status():
    with _lock:
        return {k: v for k, v in JOB.items() if k != "latest"} | {"current": current_version(), "latest": (JOB["latest"] or {}).get("version")}
