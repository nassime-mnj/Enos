"""Outils externes téléchargeables (adb, scrcpy, Stockfish) : recherche, téléchargement vérifié, extraction sûre.

Les binaires sont rangés dans %LOCALAPPDATA%\\ENOS\\outils (JAMAIS dans le dossier de l'application, qui est synchronisé par OneDrive).
Recherche, dans l'ordre : dossier outils/ à côté de l'exe, %LOCALAPPDATA%\\ENOS\\outils, PATH.
"""
import hashlib
import os
import shutil
import sys
import zipfile

import httpx

from nasko_core import app_dir, ssl_context

CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0
UA = {"User-Agent": "ENOS-tools"}
# hôtes autorisés pour les téléchargements (y compris après redirection)
ALLOWED_HOSTS = ("dl.google.com", "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com")


class ToolError(Exception):
    pass


def tools_root():
    base = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local")
    p = os.path.join(base, "ENOS", "outils")
    os.makedirs(p, exist_ok=True)
    return p


def search_dirs(sub):
    return [os.path.join(app_dir(), "outils", sub), os.path.join(app_dir(), sub), os.path.join(tools_root(), sub)]


def find_exe(exe, sub, match=None):
    """Chemin d'un exécutable déjà présent (ou None). `match` : filtre sur le nom de fichier (Stockfish a un nom variable)."""
    for d in search_dirs(sub):
        if not os.path.isdir(d):
            continue
        for root, _dirs, files in os.walk(d):
            for f in files:
                low = f.lower()
                if (match(low) if match else low == exe.lower()):
                    return os.path.join(root, f)
    return None if match else shutil.which(exe)


def _check_url(url):
    host = httpx.URL(url).host
    if httpx.URL(url).scheme != "https" or not any(host == h or host.endswith("." + h) for h in ALLOWED_HOSTS):
        raise ToolError("Téléchargement refusé : hôte non autorisé (" + host + ").")


def github_asset(repo, pick):
    """(url, nom, sha256|None) du premier asset de la dernière release GitHub dont `pick(nom)` est vrai."""
    try:
        with httpx.Client(timeout=30, verify=ssl_context(), headers=UA, follow_redirects=True) as c:
            r = c.get(f"https://api.github.com/repos/{repo}/releases/latest")
            r.raise_for_status()
            data = r.json()
    except (httpx.HTTPError, ValueError) as e:
        raise ToolError(f"Impossible de joindre GitHub ({repo}) : {e}")
    for a in data.get("assets", []):
        if pick(a.get("name", "").lower()):
            dg = a.get("digest") or ""
            return a["browser_download_url"], a["name"], (dg.split(":", 1)[1] if dg.startswith("sha256:") else None)
    raise ToolError(f"Aucune archive compatible dans la dernière release de {repo}.")


def download(url, dest_zip, sha256=None, progress=None):
    _check_url(url)
    h = hashlib.sha256()
    tmp = dest_zip + ".part"
    try:
        with httpx.Client(timeout=httpx.Timeout(60, read=120), verify=ssl_context(), headers=UA, follow_redirects=True) as c:
            with c.stream("GET", url) as r:
                r.raise_for_status()
                _check_url(str(r.url))
                total = int(r.headers.get("content-length") or 0)
                got = 0
                with open(tmp, "wb") as f:
                    for chunk in r.iter_bytes(1 << 16):
                        f.write(chunk)
                        h.update(chunk)
                        got += len(chunk)
                        if progress and total:
                            progress(got / total)
    except (httpx.HTTPError, OSError) as e:
        _rm(tmp)
        raise ToolError(f"Téléchargement échoué : {e}")
    if sha256 and h.hexdigest().lower() != sha256.lower():
        _rm(tmp)
        raise ToolError("Somme de contrôle SHA-256 incorrecte : archive rejetée.")
    os.replace(tmp, dest_zip)


def _rm(p):
    try:
        os.remove(p)
    except OSError:
        pass


def safe_extract(zip_path, dest):
    """Extraction protégée contre le zip-slip (chemins sortant de `dest`)."""
    root = os.path.realpath(dest)
    os.makedirs(root, exist_ok=True)
    try:
        with zipfile.ZipFile(zip_path) as z:
            for m in z.infolist():
                target = os.path.realpath(os.path.join(root, m.filename))
                if target != root and not target.startswith(root + os.sep):
                    raise ToolError("Archive refusée : chemin suspect.")
            z.extractall(root)
    except zipfile.BadZipFile:
        raise ToolError("Archive corrompue.")
    finally:
        _rm(zip_path)


def install_zip(url, sub, sha256=None, progress=None):
    """Télécharge `url` puis l'extrait dans outils/<sub> (l'ancienne version est remplacée)."""
    dest = os.path.join(tools_root(), sub)
    z = os.path.join(tools_root(), sub + ".zip")
    download(url, z, sha256, progress)
    if os.path.isdir(dest):
        shutil.rmtree(dest, ignore_errors=True)
    safe_extract(z, dest)
    return dest
