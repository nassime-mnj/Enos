"""DÉPÔT INTRANET : colle entre l'interface (routes /api/depot/*) et les moteurs — Git (nasko_depot_git), Forge + sujets PDF + entraînements (nasko_depot_study),
terminal (nasko_depot_term). Deux espaces de travail :
  * « wsl »   (Windows + WSL) : dépôts de l'espace de travail WSL (\\\\wsl.localhost\\Ubuntu\\home\\nasko, voir nasko_wsl.py), fichiers et clone via nasko_devmanager, Git exécuté DANS WSL ;
  * « local » (Linux / macOS / développement) : dépôts d'un dossier de cette machine (config depot_local_root, défaut ~/Nasko).
Sécurité : le nom de dépôt est validé (pas de chemin), toute opération fichier est confinée au dépôt (.git inaccessible), les exécutions passent par les moteurs
(jamais de shell construit avec du texte utilisateur). Les routes sont strictement locales (jeton + ce PC) et réservées aux profils avec la capacité « devtools »."""
import os
import re

import nasko_core
import nasko_depot_git as G
import nasko_wsl

REPO_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
FILE_MAX = 1_500_000


class DepotError(Exception):
    """Message français affichable tel quel."""


def _devmanager():
    try:
        import nasko_devmanager
        return nasko_devmanager
    except Exception:                                               # noqa: BLE001 — module absent de l'édition
        return None


def mode(cfg=None):
    dm = _devmanager()
    if os.name == "nt" and dm is not None:
        try:
            if dm.available():
                return "wsl"
        except Exception:                                           # noqa: BLE001
            pass
    return "local"


def local_root(cfg=None):
    cfg = cfg if cfg is not None else nasko_core.load_config()
    r = (cfg.get("depot_local_root") or "").strip() or os.path.join(os.path.expanduser("~"), "Nasko")
    return os.path.realpath(os.path.expanduser(r))


def valid_repo(name):
    if not isinstance(name, str) or not REPO_RE.match(name) or ".." in name:
        raise DepotError("Nom de dépôt invalide.")
    return name


def repo_dir(name, cfg=None):
    """Local : chemin absolu confiné à la racine. WSL : non applicable."""
    valid_repo(name)
    root = local_root(cfg)
    p = os.path.realpath(os.path.join(root, name))
    if os.path.dirname(p) != root or not os.path.isdir(p):
        raise DepotError("Dépôt introuvable.")
    return p


def git_repo(name, cfg=None):
    cfg = cfg if cfg is not None else nasko_core.load_config()
    valid_repo(name)
    if mode(cfg) == "wsl":
        dm = _devmanager()
        return G.GitRepo(G.WslRunner(dm.distro(cfg), nasko_wsl.DIR), name)
    return G.GitRepo(G.LocalRunner(), repo_dir(name, cfg))


def _branch_of(path):
    try:
        head = open(os.path.join(path, ".git", "HEAD"), encoding="utf-8").read().strip()
        return head.split("/", 2)[-1] if head.startswith("ref:") else head[:8]
    except OSError:
        return ""


def repos(cfg=None):
    cfg = cfg if cfg is not None else nasko_core.load_config()
    if mode(cfg) == "wsl":
        r = _devmanager().list_repos(cfg, full=True)
        return [{"name": x["name"], "branch": x.get("branch", ""), "dirty": x.get("dirty", 0)} for x in r["repos"]]
    root = local_root(cfg)
    out = []
    if os.path.isdir(root):
        for n in sorted(os.listdir(root)):
            p = os.path.join(root, n)
            if REPO_RE.match(n) and os.path.isdir(os.path.join(p, ".git")):
                out.append({"name": n, "branch": _branch_of(p), "dirty": 0})
    return out


def state(cfg=None):
    cfg = cfg if cfg is not None else nasko_core.load_config()
    return {"mode": mode(cfg), "repos": repos(cfg), "current": cfg.get("depot_repo", ""), "base": nasko_wsl.WORKSPACE_UNC if mode(cfg) == "wsl" else local_root(cfg),
            "options": {"shell_target": "parent" if cfg.get("depot_shell_target") == "parent" else "root"}}


def remember_repo(name):
    nasko_core.update_config({"depot_repo": valid_repo(name) if name else ""})


def clone(url, name="", cfg=None):
    """WSL : tâche asynchrone de Dev Manager ({job, name}) ; local : synchrone ({name})."""
    cfg = cfg if cfg is not None else nasko_core.load_config()
    if mode(cfg) == "wsl":
        dm = _devmanager()
        jid, nm = dm.clone(url, cfg)
        return {"job": jid, "name": nm}
    root = local_root(cfg)
    os.makedirs(root, exist_ok=True)
    r = G.clone(G.LocalRunner(), url, root, name or None)
    return {"job": None, "name": r["name"]}


# ----------------------------------------------------------------------------- fichiers (espace local ; en WSL c'est nasko_devmanager)
def _rel(path, allow_root=True):
    p = (path or ".").replace("\\", "/")
    if p.startswith("/") or re.match(r"^[A-Za-z]:", p) or "\x00" in p:
        raise DepotError("Chemin refusé.")
    parts = [x for x in p.split("/") if x not in ("", ".")]
    if ".." in parts or (parts and parts[0] == ".git"):
        raise DepotError("Chemin refusé (hors du dépôt).")
    if not parts and not allow_root:
        raise DepotError("Chemin vide.")
    return "/".join(parts)


def _lpath(repo, path, allow_root=True):
    base = repo_dir(repo)
    rel = _rel(path, allow_root)
    full = os.path.realpath(os.path.join(base, rel))
    if full != base and not full.startswith(base + os.sep):
        raise DepotError("Chemin refusé (hors du dépôt).")
    return base, rel, full


def fs_tree(repo, path="."):
    cfg = nasko_core.load_config()
    if mode(cfg) == "wsl":
        return _devmanager().tree(valid_repo(repo), path, cfg)
    _, _, full = _lpath(repo, path)
    if not os.path.isdir(full):
        raise DepotError("Dossier introuvable.")
    items = []
    for e in os.scandir(full):
        if e.name == ".git":
            continue
        d = e.is_dir(follow_symlinks=False)
        items.append({"name": e.name, "type": "d" if d else "f", "size": 0 if d else e.stat(follow_symlinks=False).st_size})
    items.sort(key=lambda x: (x["type"] != "d", x["name"].lower()))
    return items


def fs_read(repo, path):
    cfg = nasko_core.load_config()
    if mode(cfg) == "wsl":
        return _devmanager().read_file(valid_repo(repo), path, cfg)
    _, rel, full = _lpath(repo, path, False)
    if not os.path.isfile(full) or os.path.islink(os.path.join(repo_dir(repo), rel)):
        raise DepotError("Fichier introuvable.")
    if os.path.getsize(full) > FILE_MAX:
        raise DepotError("Fichier trop gros pour l'éditeur.")
    data = open(full, "rb").read()
    if b"\x00" in data[:8000]:
        raise DepotError("Fichier binaire : non éditable.")
    try:
        return {"path": rel, "text": data.decode("utf-8"), "size": len(data)}
    except UnicodeDecodeError:
        raise DepotError("Fichier non UTF-8 : non éditable.")


def fs_write(repo, path, content):
    cfg = nasko_core.load_config()
    if mode(cfg) == "wsl":
        return _devmanager().write_file(valid_repo(repo), path, content, cfg)
    _, _, full = _lpath(repo, path, False)
    data = (content or "").encode("utf-8")
    if len(data) > FILE_MAX * 2:
        raise DepotError("Contenu trop gros.")
    if not os.path.isfile(full):
        raise DepotError("Fichier introuvable (crée-le d'abord).")
    tmp = full + ".enos-tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, full)
    return True


def fs_create(repo, path, kind):
    cfg = nasko_core.load_config()
    if mode(cfg) == "wsl":
        return _devmanager().create_entry(valid_repo(repo), path, kind, cfg)
    if kind not in ("file", "dir"):
        raise DepotError("Type invalide.")
    _, _, full = _lpath(repo, path, False)
    if os.path.lexists(full):
        raise DepotError("Existe déjà.")
    if kind == "dir":
        os.makedirs(full)
    else:
        os.makedirs(os.path.dirname(full), exist_ok=True)
        open(full, "x").close()
    return True
