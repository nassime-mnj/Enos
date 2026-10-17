"""Distribution publique du Launcher Dual Pulse (bouton « Télécharger pour Windows » de la page d'accueil).

Le public ne télécharge QUE le Launcher : c'est lui qui demande le code d'invitation (Dev ou Friends) et installe ensuite le reste selon le rôle.
Le fichier est hébergé hors de ce serveur (Cloudflare R2, domaine public ou personnalisé) ; ici on ne fait que rediriger, jamais de proxy.

Variables d'environnement (voir .env.example) :
  DP_LAUNCHER_URL      lien direct HTTPS du programme d'installation du Launcher (vide = bouton « bientôt disponible »)
  DP_LAUNCHER_VERSION  affichée sous le bouton (facultatif)
  DP_LAUNCHER_SHA256   empreinte affichée pour vérification (facultatif, 64 caractères hexadécimaux)
  DP_LAUNCHER_SIZE     taille en octets, affichée en Mo (facultatif)
"""
import os
import re
from urllib.parse import urlparse

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
_SHA = re.compile(r"^[0-9a-fA-F]{64}$")


def _clean_url(raw):
    """URL acceptée : HTTPS (HTTP seulement vers la machine locale, pour les essais), sans espace ni caractère de contrôle. Sinon ''."""
    raw = (raw or "").strip()
    if not raw or any(c.isspace() or ord(c) < 32 for c in raw):
        return ""
    u = urlparse(raw)
    if not u.hostname or u.username or u.password:
        return ""
    if u.scheme == "https" or (u.scheme == "http" and u.hostname in _LOCAL_HOSTS):
        return raw
    return ""


def launcher():
    """État du téléchargement, relu à chaque appel (changer la variable ne demande pas de redéploiement du code)."""
    url = _clean_url(os.environ.get("DP_LAUNCHER_URL"))
    sha = (os.environ.get("DP_LAUNCHER_SHA256") or "").strip()
    try:
        size = int(os.environ.get("DP_LAUNCHER_SIZE") or 0)
    except ValueError:
        size = 0
    return {"available": bool(url), "url": url, "version": (os.environ.get("DP_LAUNCHER_VERSION") or "").strip()[:20],
            "sha256": sha.lower() if _SHA.match(sha) else "", "size_mb": round(size / 1048576, 1) if size > 0 else 0}
