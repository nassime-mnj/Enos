"""Synchronisation Git du projet en UN BOUTON : add . -> commit -> pull (avec résolution automatique) -> push.
Personne ne tape de commande : tout est enchaîné ici et le résultat est un simple statut.

Résolution des conflits, par paliers :
  1. pull normal (Git fusionne seul tout ce qui ne se chevauche pas) ;
  2. fichiers GÉNÉRÉS (.import, .uid, .godot/, caches…) : on garde la version locale, le moteur les régénère ;
  3. différences d'espaces/fins de ligne seulement : relance avec « ignore-space-change » ;
  4. vrai conflit (les deux ont modifié les mêmes lignes) : on ANNULE proprement (rien n'est modifié) et on alerte avec les fichiers,
     l'auteur et la date de l'autre version ; l'utilisateur choisit alors en un clic « garder les miennes » ou « prendre les siennes »
     (une branche de sauvegarde est créée avant, rien n'est jamais perdu).
Sécurités : jamais d'invite console (GIT_TERMINAL_PROMPT=0), délais maximum, commit seulement s'il y a des changements,
refus des fichiers > 90 Mo (limite GitHub 100 Mo), identité Git créée automatiquement si absente."""
import fnmatch
import os
import re
import subprocess
import threading
import time

COMMIT_MSG = "Auto-sync via E.N.O.S."
STEPS = ("add", "commit", "pull", "push")
LABELS = {"add": "Préparer les fichiers", "commit": "Enregistrer mes modifications", "pull": "Récupérer le travail de l'autre", "push": "Envoyer mon travail"}
CMDS = {"add": "git add .", "commit": f'git commit -m "{COMMIT_MSG}"', "pull": "git pull", "push": "git push"}
BIG = 90 * 1024 * 1024
GENERATED = ("*.import", "*.uid", ".godot/*", "*.tmp", "*.translation", "*.os.import", ".import/*", "*.cache")
GODOT_IGNORE = ".godot/\n.import/\n*.tmp\n*.translation\n/android/\n.mono/\ndata_*/\n"
_lock = threading.Lock()
STATE = {"running": False, "steps": [], "ok": None, "message": "", "conflicts": [], "needs_choice": False, "other": "", "t": 0, "auto": []}
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _git(cwd, *args, timeout=120):
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_EDITOR": "true", "LC_ALL": "C"}
    p = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=timeout, env=env, creationflags=NOWIN)
    return p.returncode, ((p.stdout or "") + (p.stderr or "")).strip()


def available():
    try:
        return _git(None, "--version", timeout=10)[0] == 0
    except (OSError, subprocess.SubprocessError):
        return False


def repo_root(path):
    if not path or not os.path.isdir(path):
        return None
    try:
        rc, out = _git(path, "rev-parse", "--show-toplevel", timeout=15)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.splitlines()[0] if rc == 0 and out else None


def info(path):
    """État résumé du dépôt pour l'affichage."""
    res = {"git": available(), "path": path, "repo": False}
    if not res["git"]:
        return res
    root = repo_root(path)
    if not root:
        return res
    res.update(repo=True, root=root)
    try:
        res["branch"] = _git(root, "rev-parse", "--abbrev-ref", "HEAD", timeout=15)[1]
        res["changes"] = len([l for l in _git(root, "status", "--porcelain", timeout=30)[1].splitlines() if l.strip()])
        remotes = _git(root, "remote", timeout=15)[1].strip()
        res["remote"] = _git(root, "remote", "get-url", "origin", timeout=15)[1] if remotes else ""
    except (OSError, subprocess.SubprocessError):
        pass
    return res


# https://…, ssh://…, ou SCP « utilisateur@hote:chemin » (n'importe quel utilisateur : git, prenom.nom…) ; ni espace, ni « - » initial
REMOTE_OK = re.compile(r"^(https://|ssh://|[A-Za-z0-9][A-Za-z0-9._-]{0,63}@[A-Za-z0-9][A-Za-z0-9.-]*:)\S+$")


def setup(path, url):
    """Premier branchement (par bouton) : crée le dépôt si besoin, ajoute un .gitignore Godot, relie le dépôt distant."""
    if not available():
        raise RuntimeError("Git n'est pas installé (https://git-scm.com).")
    if not path or not os.path.isdir(path):
        raise RuntimeError("Dossier du projet introuvable.")
    url = (url or "").strip()
    if url and not (REMOTE_OK.match(url) and " " not in url):
        raise RuntimeError("Adresse du dépôt invalide (ex. https://github.com/vous/projet.git ou utilisateur@hote:chemin).")
    root = repo_root(path)
    if not root:
        rc, out = _git(path, "init", "-b", "main")
        if rc:
            raise RuntimeError("git init a échoué : " + out[-200:])
        root = path
    gi = os.path.join(root, ".gitignore")
    if not os.path.exists(gi):
        with open(gi, "w", encoding="utf-8") as f:
            f.write(GODOT_IGNORE)
    if url:
        have = _git(root, "remote")[1].split()
        rc, out = _git(root, "remote", "set-url" if "origin" in have else "add", "origin", url)
        if rc:
            raise RuntimeError("Impossible de relier le dépôt : " + out[-200:])
    return info(root)


def _set(i, status, detail=""):
    STATE["steps"][i].update(status=status, detail=detail[-600:])


def _big_files(root):
    rc, out = _git(root, "ls-files", "--others", "--modified", "--exclude-standard", "-z", timeout=60)
    bad = []
    for f in out.split("\0"):
        f = f.strip()
        if f:
            try:
                if os.path.getsize(os.path.join(root, f)) > BIG:
                    bad.append(f)
            except OSError:
                pass
    return bad


def _unmerged(root):
    return [l for l in _git(root, "diff", "--name-only", "--diff-filter=U")[1].splitlines() if l.strip()]


def _is_generated(f):
    f = f.replace("\\", "/")
    return any(fnmatch.fnmatch(f, g) or fnmatch.fnmatch(os.path.basename(f), g) for g in GENERATED)


def _merging(root):
    return os.path.exists(os.path.join(root, ".git", "MERGE_HEAD")) or _git(root, "rev-parse", "-q", "--verify", "MERGE_HEAD")[0] == 0


def _other_info(root, files):
    """Qui a modifié ces fichiers de l'autre côté ? (« Raf, il y a 2 heures »)"""
    who = ""
    try:
        rc, out = _git(root, "log", "-1", "--format=%an|%ar", "MERGE_HEAD", "--", *files[:5])
        if rc == 0 and "|" in out:
            n, ago = out.split("|", 1)
            who = f"{n}, {ago}"
    except (OSError, subprocess.SubprocessError):
        pass
    return who


def _finish_merge(root, side):
    """Après un pull -X <side> : les conflits restants (binaires…) sont tranchés du même côté, puis la fusion est validée."""
    left = _unmerged(root)
    for f in left:
        _git(root, "checkout", "--" + side, "--", f)
        _git(root, "add", "--", f)
    if _merging(root):
        rc, out = _git(root, "commit", "--no-edit")
        return rc == 0, out
    return True, ""


def _pull(root, resolve):
    """Retourne ('ok'|'conflict'|'error', détail). Applique les paliers de résolution décrits en tête de fichier."""
    if resolve in ("ours", "theirs"):
        stamp = time.strftime("%Y%m%d-%H%M%S")
        _git(root, "branch", f"enos-sauvegarde-{stamp}")                 # filet de sécurité : rien ne peut être perdu
        rc, out = _git(root, "pull", "--no-edit", "-X", resolve, timeout=300)
        if rc and _merging(root):
            ok, o2 = _finish_merge(root, resolve)
            return ("ok", f"Conflits tranchés ({'mes versions' if resolve == 'ours' else 'versions de l’autre'}). Sauvegarde : enos-sauvegarde-{stamp}") if ok else ("error", o2)
        return ("ok", out.splitlines()[-1] if out else "") if rc == 0 else ("error", out)
    rc, out = _git(root, "pull", "--no-edit", timeout=300)
    if rc == 0:
        return "ok", out.splitlines()[-1] if out else ""
    if not _merging(root):
        if "no tracking information" in out or "couldn't find remote ref" in out or "no such ref" in out.lower():
            return "skip", "Branche pas encore publiée : rien à récupérer."
        return "error", out
    left = _unmerged(root)
    gen = [f for f in left if _is_generated(f)]
    for f in gen:                                                        # palier 2 : fichiers générés -> version locale
        _git(root, "checkout", "--ours", "--", f)
        _git(root, "add", "--", f)
    STATE["auto"] = gen
    left = _unmerged(root)
    if not left:
        rc2, o2 = _git(root, "commit", "--no-edit")
        return ("ok", f"{len(gen)} fichier(s) générés fusionnés automatiquement.") if rc2 == 0 else ("error", o2)
    other = _other_info(root, left)                                      # palier 3 : espaces / fins de ligne
    _git(root, "merge", "--abort")
    rc3, out3 = _git(root, "pull", "--no-edit", "-X", "ignore-space-change", timeout=300)
    if rc3 == 0:
        return "ok", "Différences d'espaces résolues automatiquement."
    if _merging(root):
        left = _unmerged(root)
        _git(root, "merge", "--abort")
    STATE["conflicts"], STATE["other"] = left, other                     # palier 4 : vrai conflit -> alerte + choix
    return "conflict", ""


def _run(path, resolve):
    st = STATE
    try:
        root = repo_root(path)
        if not available():
            raise RuntimeError("Git n'est pas installé (https://git-scm.com).")
        if not root:
            raise RuntimeError("Ce dossier n'est pas encore un dépôt Git : utilisez « CONNECTER LE DÉPÔT » ci-dessous.")
        if _merging(root):
            _git(root, "merge", "--abort")                               # reste d'une fusion interrompue
        if not _git(root, "config", "user.email")[1].strip():            # identité automatique (sinon le commit échoue)
            try:
                import nasko_core
                label = nasko_core.load_config().get("user_label", "E.N.O.S.")
                pid = nasko_core.load_config().get("profile_id", "enos")
            except Exception:
                label, pid = "E.N.O.S.", "enos"
            _git(root, "config", "user.name", label)
            _git(root, "config", "user.email", f"{pid}@enos.local")
        bad = _big_files(root)
        if bad:
            raise RuntimeError("Fichiers de plus de 90 Mo (refusés par GitHub) : " + ", ".join(bad[:5]) + ". Retirez-les du projet ou ajoutez-les au .gitignore.")
        _set(0, "run")
        rc, out = _git(root, "add", ".")
        if rc:
            _set(0, "err", out)
            raise RuntimeError("Préparation impossible : " + out[-300:])
        _set(0, "ok")
        _set(1, "run")
        if not _git(root, "status", "--porcelain")[1].strip():
            _set(1, "skip", "Rien de nouveau à enregistrer.")
        else:
            rc, out = _git(root, "commit", "-m", COMMIT_MSG)
            if rc:
                _set(1, "err", out)
                raise RuntimeError("Enregistrement impossible : " + out[-300:])
            _set(1, "ok", out.splitlines()[0] if out else "")
        if not _git(root, "remote")[1].strip():
            _set(2, "err", "Aucun dépôt distant relié.")
            raise RuntimeError("Aucun dépôt distant relié : utilisez « CONNECTER LE DÉPÔT » (adresse GitHub du projet).")
        _set(2, "run")
        kind, detail = _pull(root, resolve)
        if kind == "error":
            _set(2, "err", detail)
            raise RuntimeError("Récupération impossible : " + detail[-300:])
        if kind == "conflict":
            _set(2, "err", "Conflit sur : " + ", ".join(st["conflicts"][:6]))
            who = f" par {st['other']}" if st["other"] else " par l'autre développeur"
            st.update(needs_choice=True, ok=False, message=f"{len(st['conflicts'])} fichier(s) modifié(s) aux mêmes endroits{who}. "
                      "Rien n'a été touché. Choisissez quelle version garder :")
            return
        _set(2, "skip" if kind == "skip" else "ok", detail)
        _set(3, "run")
        rc, out = _git(root, "push", timeout=300)
        if rc and ("no upstream" in out or "set-upstream" in out):
            rc, out = _git(root, "push", "-u", "origin", "HEAD", timeout=300)
        if rc and ("rejected" in out or "non-fast-forward" in out or "fetch first" in out):     # l'autre a poussé entre-temps : une relance suffit
            kind, detail = _pull(root, resolve)
            rc, out = _git(root, "push", timeout=300) if kind != "conflict" else (1, "conflit")
        if rc:
            _set(3, "err", out)
            raise RuntimeError("Envoi impossible : " + out[-300:] + (" — connexion GitHub requise (fenêtre de connexion Windows)." if "authent" in out.lower() or "denied" in out.lower() else ""))
        _set(3, "ok", out.splitlines()[-1] if out else "")
        st.update(ok=True, message="Projet synchronisé." + (f" {len(st['auto'])} fichier(s) générés fusionnés automatiquement." if st["auto"] else ""))
    except subprocess.TimeoutExpired:
        for s in st["steps"]:
            if s["status"] == "run":
                s.update(status="err", detail="Délai dépassé (réseau ou connexion GitHub ?).")
        st.update(ok=False, message="Délai dépassé : le dépôt distant ne répond pas, ou attend une connexion GitHub (une fenêtre de connexion a pu s'ouvrir).")
    except Exception as e:                                  # noqa: BLE001
        st.update(ok=False, message=str(e))
    finally:
        st["running"] = False
        st["t"] = time.time()


def start(path, resolve="", on_ok=None):
    """on_ok : fonction appelée (sans argument) quand la synchronisation a réussi. Lance la synchronisation en arrière-plan ; une seule à la fois. resolve : '' | 'ours' | 'theirs' (choix de l'utilisateur après alerte)."""
    with _lock:
        if STATE["running"]:
            return False
        STATE.update(running=True, ok=None, message="", conflicts=[], needs_choice=False, other="", auto=[], t=time.time(),
                     steps=[{"id": s, "label": LABELS[s], "cmd": CMDS[s], "status": "wait", "detail": ""} for s in STEPS])
    def job():
        _run(path, resolve if resolve in ("ours", "theirs") else "")
        try:
            import nasko_notify
            if STATE["ok"] is not None and not STATE["needs_choice"]:
                nasko_notify.task_done("sync", os.path.basename(os.path.normpath(path or "")), bool(STATE["ok"]), STATE.get("message", ""))
        except Exception:                                    # noqa: BLE001 — jamais bloquant
            pass
        if on_ok and STATE["ok"]:                            # ex. : signaler la mise à jour dans le chat une fois le push réussi
            try:
                on_ok()
            except Exception:                                # noqa: BLE001 — la synchro elle-même a réussi
                pass
    threading.Thread(target=job, daemon=True).start()
    return True


def abort(path):
    root = repo_root(path)
    if not root:
        return "pas de dépôt"
    return _git(root, "merge", "--abort")[1] or "ok"
