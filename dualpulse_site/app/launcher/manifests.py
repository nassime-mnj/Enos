"""Manifestes de version signés (Ed25519 sur le JSON canonique). Le serveur ne détient JAMAIS la clé privée : la signature est faite chez le CEO
(build_release.py) ; le serveur vérifie avant d'accepter, le Launcher vérifie avant d'installer (même clé publique, livrée avec l'application)."""
import base64
import json
import re

from cryptography.exceptions import InvalidSignature

from . import tokens

PRODUCTS = {"enos": {"name": "E.N.O.S.", "kind": "app", "channels": ("stable", "dev", "ceo")},
            "enos-mobile": {"name": "E.N.O.S. Mobile", "kind": "app", "channels": ("stable", "dev", "ceo")},
            "terna": {"name": "TERNA", "kind": "game", "channels": ("alpha", "public")}}
CHANNEL_MIN_ROLE = {"stable": "friends", "dev": "dev", "ceo": "ceo", "alpha": "dev", "public": "friends"}
_VER = re.compile(r"^\d+(\.\d+){1,3}$")
_SHA = re.compile(r"^[0-9a-f]{64}$")
_SAFE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ \-]{0,120}(/[A-Za-z0-9][A-Za-z0-9._ \-]{0,120}){0,8}$")


def canonical(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sign(priv, manifest: dict) -> str:
    return base64.b64encode(priv.sign(canonical(manifest))).decode()


def verify(pub, manifest: dict, signature_b64: str) -> bool:
    try:
        pub.verify(base64.b64decode(signature_b64), canonical(manifest))
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False


def vkey(v: str):
    return tuple(int(x) for x in v.split("."))


def validate(m) -> dict:
    """Contrôle de forme : chemins sûrs (pas de .., pas de chemin absolu), empreintes SHA-256, tailles. Retourne le manifeste nettoyé ou lève ValueError."""
    if not isinstance(m, dict):
        raise ValueError("manifeste invalide")
    product, channel, version = m.get("product"), m.get("channel"), str(m.get("version", ""))
    if product not in PRODUCTS:
        raise ValueError("produit inconnu")
    if channel not in PRODUCTS[product]["channels"]:
        raise ValueError("canal inconnu pour ce produit")
    if not _VER.match(version):
        raise ValueError("version invalide (ex. 3.2.0)")
    files = m.get("files")
    if not isinstance(files, list) or not files or len(files) > 5000:
        raise ValueError("liste de fichiers invalide")
    out = []
    for f in files:
        if not isinstance(f, dict):
            raise ValueError("fichier invalide")
        path, sha, size, key = f.get("path", ""), f.get("sha256", ""), f.get("size"), f.get("key", "")
        if not isinstance(path, str) or not _SAFE.match(path) or ".." in path.split("/"):
            raise ValueError(f"chemin refusé : {path!r}")
        if not isinstance(sha, str) or not _SHA.match(sha):
            raise ValueError(f"empreinte SHA-256 invalide pour {path}")
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise ValueError(f"taille invalide pour {path}")
        if not isinstance(key, str) or not _SAFE.match(key) or ".." in key.split("/"):
            raise ValueError(f"clé de stockage refusée pour {path}")
        out.append({"path": path, "sha256": sha, "size": size, "key": key})
    launch = m.get("launch", "")
    if launch and launch not in {f["path"] for f in out}:
        raise ValueError("« launch » doit désigner un fichier du manifeste")
    mode = m.get("mode", "installer") or "installer"
    if mode not in ("installer", "files"):
        raise ValueError("mode inconnu (installer | files)")
    run = m.get("run", "") or ""
    if mode == "files":
        # mise à jour par remplacement de fichiers (staging puis application par le Launcher) : « run » = exécutable de l'application, jamais un installeur
        if launch:
            raise ValueError("« launch » n'a pas de sens en mode files")
        if run not in {f["path"] for f in out}:
            raise ValueError("« run » doit désigner un fichier du manifeste (mode files)")
        for f in out:
            low = f["path"].lower()
            if low == "nasko_config.json" or low.startswith(("data/", ".update-")):
                raise ValueError(f"chemin protégé (données de l'utilisateur) : {f['path']}")
    return {"product": product, "channel": channel, "version": version, "released": str(m.get("released", ""))[:10], "notes": str(m.get("notes", ""))[:8000],
            "min_launcher": str(m.get("min_launcher", ""))[:20], "launch": launch, "mode": mode, "run": run, "files": out}


def load_pubkey(text):
    if not text:
        return None
    return tokens.public_from_b64(text)
