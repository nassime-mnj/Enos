"""Dépôt Intranet : moteur Git + « Dépôt Shell » (E.N.O.S.).

Pensé pour des étudiants en école d'informatique (piscines, rendus stricts) : un bouton « Envoyer » fait add + commit + tag annoté V<n> + push.

MODÈLE DE MENACE
  * Aucune commande n'est jamais construite par concaténation de texte et AUCUN shell n'interprète une valeur saisie : tout est une liste
    d'arguments (`shell=False`). Sous WSL, les valeurs variables voyagent en ARGUMENTS POSITIONNELS d'un `sh -c` à script constant
    (`cd <espace de travail>/<dépôt>` en chemin absolu, puis `exec` des arguments cités), jamais interprétés.
  * Les chemins fournis par l'utilisateur sont relatifs à la racine du dépôt ; chemin absolu, `..`, pathspec magique (`:(top)`, `:/`…),
    retour chariot / caractère de contrôle, nom commençant par `-` sont refusés ; `--` précède toujours les chemins et `--literal-pathspecs`
    neutralise les jokers. Noms de branche / tag validés par `git check-ref-format`.
  * Aucune commande destructrice n'est implémentée : ni `--force`, ni `reset --hard`, ni `clean`, ni `push --force`. Les suppressions de
    branche / tag sont explicites (`-d` sûr, `-D` seulement si force=True).
  * Les invites git sont désactivées (`GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS` vide, `GIT_EDITOR=true`, pas de pager) : une commande ne reste
    jamais bloquée à attendre une saisie ; un délai maximal tue le processus.
  * Le Dépôt Shell dépose un .sh (nom strict, UTF-8, LF, <= 1 Mo, jamais de lien symbolique) mais ne l'EXÉCUTE JAMAIS.

LIMITE : l'authentification distante repose entièrement sur la clé SSH / le credential helper déjà configurés par l'utilisateur
(ssh-agent, gestionnaire d'identifiants Git…). Ce module ne stocke et ne demande aucun mot de passe ni jeton ; sans configuration valide,
push / pull / fetch / clone échouent avec un message explicite.
"""
from __future__ import annotations

import base64
import fnmatch
import os
import posixpath
import re
import shlex
import shutil
import signal
import subprocess
import tempfile

import nasko_wsl

__all__ = ["GitError", "Runner", "LocalRunner", "WslRunner", "GitRepo", "clone", "clone_argv", "validate_url", "drop_shell",
           "URL_RE", "SHELL_NAME_RE"]

# Même règle que nasko_devmanager.URL_RE (https://, ssh://, utilisateur@hote:chemin : forges d'école, GitHub…) ; copiée pour ne pas importer ce module (effets de bord).
# tests/test_git_urls.py vérifie que les deux copies restent identiques.
URL_RE = re.compile(r"^(https://[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+|ssh://[A-Za-z0-9._~:/@%+-]+|[A-Za-z0-9][A-Za-z0-9._-]{0,63}@[A-Za-z0-9][A-Za-z0-9.-]*:[A-Za-z0-9._~/%+-]+)$")
NAME_RE = re.compile(r"[A-Za-z0-9._-]{1,100}")
SHELL_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.sh")
WSL_PATH_RE = re.compile(r"[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*")
MAX_SHELL = 1024 * 1024
MAX_MESSAGE = 2000
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)

_ENV = {"GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "", "LC_ALL": "C.UTF-8", "GIT_EDITOR": "true", "GIT_PAGER": "cat",
        "GIT_SSH_COMMAND": "ssh -o BatchMode=yes"}


class GitError(Exception):
    """Erreur affichable telle quelle (français)."""


# ----------------------------------------------------------------------------- exécuteurs
class Runner:
    """Interface : exécute une commande (liste d'arguments, args[0] = « git » ou un utilitaire) dans `cwd`."""
    is_local = False

    def run(self, args, cwd, timeout=60, stdin=None):
        """Retourne (rc, stdout, stderr) en texte. Délai dépassé : rc 124. Ne lève pas."""
        raise NotImplementedError


def _decode(b, nul=True):
    t = (b or b"").decode("utf-8", "replace")
    return t if nul else t.replace("\x00", "")


class LocalRunner(Runner):
    is_local = True

    def __init__(self, env=None):
        self.env = dict(env or {})

    def run(self, args, cwd, timeout=60, stdin=None):
        env = dict(os.environ)
        env.update(_ENV)
        env.update(self.env)
        kw = {}
        if os.name == "nt":
            kw["creationflags"] = NOWIN | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        else:
            kw["start_new_session"] = True
        try:
            p = subprocess.Popen([str(a) for a in args], cwd=cwd, env=env, shell=False, stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kw)
        except FileNotFoundError:
            return 127, "", "Commande introuvable (git est-il installé ?)."
        except OSError as e:
            return 126, "", f"Lancement impossible : {e}"
        try:
            out, err = p.communicate(stdin, timeout=timeout)
        except subprocess.TimeoutExpired:
            try:
                if os.name == "nt":
                    p.kill()
                else:
                    os.killpg(p.pid, signal.SIGKILL)
            except OSError:
                pass
            out, err = p.communicate()
            return 124, _decode(out), "Délai dépassé : la commande a été interrompue."
        return p.returncode, _decode(out), _decode(err, False)


class WslRunner(Runner):
    """Exécute dans WSL. wsl.exe ne transmet NI les arguments positionnels NI les guillemets imbriqués (même constat que nasko_devmanager) : le script complet — chaque
    valeur citée par shlex — voyage en base64 dans une commande 100 % alphanumérique, exécutée par `bash <(…)` ; l'entrée standard reste libre (écriture de fichiers)."""
    PRE = 'export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS= GIT_EDITOR=true GIT_PAGER=cat LC_ALL=C.UTF-8 GIT_SSH_COMMAND="ssh -o BatchMode=yes"\n'

    def __init__(self, distro, base=None):
        """`base` : dossier Linux ABSOLU de référence (défaut : l'espace de travail WSL, nasko_wsl.DIR). Les `cwd` sont relatifs à ce dossier ; "" = le dossier lui-même."""
        if not re.match(r"^[A-Za-z0-9._ -]{1,60}$", distro or "") or distro.startswith("-"):
            raise GitError("Nom de distribution WSL invalide.")
        base = base or nasko_wsl.DIR
        if not re.fullmatch(r"/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*", base) or any(s in (".", "..") for s in base.split("/")):
            raise GitError("Dossier de base WSL invalide (chemin absolu, lettres, chiffres, . _ - uniquement).")
        self.distro = distro
        self.base = base

    @staticmethod
    def check_cwd(cwd):
        if not isinstance(cwd, str) or (cwd and (not WSL_PATH_RE.fullmatch(cwd) or any(s in (".", "..") or s.startswith("-") for s in cwd.split("/")))):
            raise GitError("Chemin WSL invalide (relatif à l'espace de travail, lettres, chiffres, . _ - uniquement).")
        return cwd

    def script(self, args, cwd):
        """Texte du script bash (pur, testable) : valeurs citées, jamais interprétées."""
        self.check_cwd(cwd)
        if not args:
            raise GitError("Commande vide.")
        where = shlex.quote(self.base) + ("/" + shlex.quote(cwd) if cwd else "")
        return self.PRE + "cd " + where + " || exit 97\nexec " + " ".join(shlex.quote(str(a)) for a in args) + "\n"

    def argv(self, args, cwd):
        """Ligne de commande complète (pure, testable sans WSL)."""
        b64 = base64.b64encode(self.script(args, cwd).encode("utf-8")).decode()
        return ["wsl.exe", "-d", self.distro, "--", "bash", "-c", "bash <(echo " + b64 + "|base64 -d)"]

    def run(self, args, cwd, timeout=60, stdin=None):
        cmd = self.argv(args, cwd)
        try:
            p = subprocess.run(cmd, input=stdin, stdin=None if stdin is not None else subprocess.DEVNULL, capture_output=True, timeout=timeout, creationflags=NOWIN)
        except subprocess.TimeoutExpired:
            return 124, "", "Délai dépassé : la commande a été interrompue."
        except OSError as e:
            return 126, "", f"Lancement de WSL impossible : {e}"
        return p.returncode, _decode(p.stdout), _decode(p.stderr, False)


# ----------------------------------------------------------------------------- validations
def _msg(message):
    if not isinstance(message, str) or not message.strip():
        raise GitError("Le message ne peut pas être vide.")
    message = message.strip()
    if len(message) > MAX_MESSAGE:
        raise GitError(f"Message trop long ({MAX_MESSAGE} caractères maximum).")
    if "\x00" in message:
        raise GitError("Message invalide.")
    return message


def _rel(path):
    """Chemin relatif sûr (relatif à la racine du dépôt). '.' = tout le dépôt."""
    if not isinstance(path, str) or not path.strip():
        raise GitError("Chemin vide.")
    p = path.strip().replace("\\", "/")
    if len(p) > 1000 or any(ord(c) < 32 or ord(c) == 127 for c in p):
        raise GitError("Chemin invalide (caractère de contrôle ou retour chariot).")
    if p.startswith("/") or re.match(r"^[A-Za-z]:", p):
        raise GitError("Chemin absolu refusé : donne un chemin relatif à la racine du dépôt.")
    if p.startswith(":"):
        raise GitError("Chemin refusé (syntaxe pathspec spéciale).")
    if any(s == ".." for s in p.split("/")):
        raise GitError("Chemin refusé : « .. » n'est pas autorisé.")
    q = posixpath.normpath(p)
    if q.startswith("-"):
        raise GitError("Chemin refusé (ne doit pas commencer par « - »).")
    return q


def _clean(text, *paths):
    t = (text or "").strip()
    for p in paths:
        if p and len(p) > 3:
            t = t.replace(p, ".")
    t = re.sub(r"\n{2,}", "\n", t)
    return t[-700:] if len(t) > 700 else t


def _hint(text):
    t = text or ""
    if "Permission denied (publickey" in t or "Authentication failed" in t or "could not read Username" in t or "terminal prompts disabled" in t:
        return " (authentification refusée : vérifie ta clé SSH / ton gestionnaire d'identifiants Git)"
    if "Could not resolve host" in t or "Network is unreachable" in t:
        return " (serveur injoignable : vérifie ta connexion)"
    if "Please tell me who you are" in t or "empty ident name" in t or "unable to auto-detect email" in t:
        return " (identité Git absente : git config --global user.name / user.email)"
    if "Host key verification failed" in t:
        return " (clé d'hôte inconnue : connecte-toi une fois en SSH pour l'accepter)"
    return ""


def _strip_creds(url):
    return re.sub(r"^(https?://)[^/@]+@", r"\1", url or "")


# ----------------------------------------------------------------------------- dépôt
class GitRepo:
    """Opérations Git sur un dépôt. `path` = racine du dépôt (absolu pour LocalRunner, relatif à l'espace de travail WSL pour WslRunner, ex. « ex00 »)."""

    def __init__(self, runner, path):
        self.runner = runner
        self.path = os.path.abspath(path) if getattr(runner, "is_local", False) else path
        self._top_cache = None

    # -- bas niveau
    def _cmd(self, args, top=False):
        cmd = ["git", "--no-pager", "-c", "core.quotepath=off"]
        if top:
            cmd += ["-C", self.toplevel(), "--literal-pathspecs"]
        return cmd + list(args)

    def _run(self, *args, timeout=60, ok=(0,), top=False, what="Commande Git"):
        rc, out, err = self.runner.run(self._cmd(args, top), self.path, timeout=timeout)
        if rc not in ok:
            raise GitError(f"{what} a échoué : {_clean(err or out, self.path, self._top_cache)}{_hint(err or out)}")
        return rc, out, err

    def _try(self, *args, timeout=60):
        """Comme _run mais sans lever : (rc, out, err)."""
        return self.runner.run(self._cmd(args), self.path, timeout=timeout)

    def toplevel(self):
        if self._top_cache is None:
            rc, out, err = self.runner.run(["git", "rev-parse", "--show-toplevel"], self.path, timeout=20)
            if rc != 0 or not out.strip():
                raise GitError("Ce dossier n'est pas un dépôt Git.")
            self._top_cache = out.strip().split("\n")[0]
        return self._top_cache

    def _has_head(self):
        return self._try("rev-parse", "--verify", "--quiet", "HEAD^{commit}")[0] == 0

    def _head(self):
        rc, out, _ = self._try("log", "-1", "--format=%H%x1f%s%x1f%an%x1f%aI")
        if rc != 0 or not out.strip():
            return None
        h, s, a, d = (out.strip().split("\x1f") + ["", "", "", ""])[:4]
        return {"hash": h, "subject": s, "author": a, "date": d}

    def _current_branch(self):
        rc, out, _ = self._try("symbolic-ref", "--quiet", "--short", "HEAD")
        return out.strip() if rc == 0 else ""

    def _has_upstream(self):
        return self._try("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")[0] == 0

    def _staged(self):
        return self._try("diff", "--cached", "--quiet")[0] == 1

    def _conflicts(self):
        rc, out, _ = self._try("diff", "--name-only", "--diff-filter=U", "-z")
        return [x for x in out.split("\x00") if x] if rc == 0 else []

    def _ref(self, name, kind="branche"):
        if not isinstance(name, str) or not name or name != name.strip():
            raise GitError(f"Nom de {kind} vide ou invalide.")
        if name.startswith("-") or len(name) > 200 or "@{" in name or any(ord(c) < 32 or ord(c) == 127 for c in name):
            raise GitError(f"Nom de {kind} invalide.")
        args = ["check-ref-format", "--branch", name] if kind == "branche" else ["check-ref-format", "refs/tags/" + name]
        if self.runner.run(["git"] + args, self.path, timeout=20)[0] != 0:
            raise GitError(f"Nom de {kind} invalide : « {name} » (espaces, ~ ^ : ? * [ \\ .. interdits).")
        return name

    # -- lecture
    def status(self):
        _, out, _ = self._run("status", "--porcelain=v2", "-b", "-z", "--untracked-files=all", what="Lecture de l'état")
        info = {"branch": "", "upstream": None, "ahead": 0, "behind": 0, "detached": False}
        files = []
        items = out.split("\x00")
        i = 0
        while i < len(items):
            it = items[i]
            i += 1
            if not it:
                continue
            if it.startswith("# branch.head "):
                h = it[14:]
                info["detached"] = h == "(detached)"
                info["branch"] = "" if info["detached"] else h
            elif it.startswith("# branch.upstream "):
                info["upstream"] = it[18:]
            elif it.startswith("# branch.ab "):
                m = re.match(r"# branch\.ab \+(\d+) -(\d+)", it)
                if m:
                    info["ahead"], info["behind"] = int(m.group(1)), int(m.group(2))
            elif it.startswith("# "):
                continue
            elif it[0] in "12u":
                p = it.split(" ", {"1": 8, "2": 9, "u": 10}[it[0]])
                files.append({"path": p[-1], "index": p[1][0].replace(".", " "), "worktree": p[1][1].replace(".", " ")})
                if it[0] == "2":
                    i += 1                                              # chemin d'origine du renommage
            elif it[0] == "?":
                files.append({"path": it[2:], "index": "?", "worktree": "?"})
        rc2, url, _ = self._try("config", "--get", "remote.origin.url")
        info.update(files=files, clean=not files, last_commit=self._head(), toplevel=self.toplevel(),
                    remote_url=_strip_creds(url.strip()) if rc2 == 0 and url.strip() else None)
        return info

    def log(self, n=30):
        try:
            n = max(1, min(500, int(n)))
        except (TypeError, ValueError):
            n = 30
        if not self._has_head():
            return []
        _, out, _ = self._run("log", "-n", str(n), "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%D%x1e", what="Lecture de l'historique")
        res = []
        for rec in out.split("\x1e"):
            rec = rec.strip("\n")
            if not rec:
                continue
            f = (rec.split("\x1f") + [""] * 6)[:6]
            res.append({"hash": f[0], "short": f[1], "subject": f[2], "author": f[3], "date": f[4], "refs": [r.strip() for r in f[5].split(",") if r.strip()]})
        return res

    def branches(self):
        _, out, _ = self._run("for-each-ref", "--format=%(refname:short)%1f%(upstream:short)%1f%(upstream:track,nobracket)", "refs/heads", what="Lecture des branches")
        local = []
        for line in out.splitlines():
            if not line:
                continue
            name, up, track = (line.split("\x1f") + ["", ""])[:3]
            a = re.search(r"ahead (\d+)", track)
            b = re.search(r"behind (\d+)", track)
            local.append({"name": name, "upstream": up or None, "ahead": int(a.group(1)) if a else 0, "behind": int(b.group(1)) if b else 0})
        _, out, _ = self._run("for-each-ref", "--format=%(refname)", "refs/remotes", what="Lecture des branches distantes")
        remote = [x[len("refs/remotes/"):] for x in out.splitlines() if x.startswith("refs/remotes/") and not x.endswith("/HEAD")]
        return {"current": self._current_branch(), "local": local, "remote": remote}

    def tags(self, pattern=None):
        if pattern is not None and not re.match(r"^[A-Za-z0-9._*?/-]{1,100}$", pattern):
            raise GitError("Motif de tag invalide.")
        fmt = "%(refname:strip=2)%1f%(objecttype)%1f%(contents:subject)%1f%(creatordate:iso-strict)%1f%(*objectname)%1f%(objectname)"
        _, out, _ = self._run("for-each-ref", "--sort=-refname", "--sort=-creatordate", "--format=" + fmt, "refs/tags", what="Lecture des tags")
        res = []
        for line in out.splitlines():
            f = (line.split("\x1f") + [""] * 6)[:6]
            if pattern and not fnmatch.fnmatchcase(f[0], pattern):
                continue
            annotated = f[1] == "tag"
            res.append({"name": f[0], "message": f[2] if annotated else "", "date": f[3], "commit": f[4] if annotated else f[5], "annotated": annotated})
        return res

    # -- écriture simple
    def add(self, paths):
        if isinstance(paths, str):
            paths = [paths]
        if not paths:
            raise GitError("Aucun chemin à ajouter.")
        clean = [_rel(p) for p in paths]
        self._run("add", "--", *clean, top=True, what="Ajout (git add)")
        return {"ok": True, "added": clean}

    def commit(self, message, allow_empty=False):
        message = _msg(message)
        if not allow_empty and not self._staged():
            raise GitError("Rien à valider : aucun changement ajouté (fais d'abord « add »).")
        self._run("commit", "-m", message, *(["--allow-empty"] if allow_empty else []), what="Commit")
        return {"ok": True, "commit": self._head()}

    def _push(self, follow_tags=False, tags=False):
        if not self._current_branch():
            raise GitError("Push impossible : HEAD détaché (crée ou choisis une branche).")
        args = ["push"] + (["--tags"] if tags else []) + (["--follow-tags"] if follow_tags else [])
        set_up = not self._has_upstream()
        if set_up:
            args += ["-u", "origin", "HEAD"]
        _, out, err = self._run(*args, timeout=120, what="Push")
        return {"ok": True, "upstream_set": set_up, "output": _clean(err or out, self.path, self._top_cache)}

    def push(self, set_upstream_auto=True, tags=False):
        if not set_upstream_auto and not self._has_upstream():
            raise GitError("Aucune branche distante suivie : relance avec set_upstream_auto.")
        return self._push(tags=bool(tags))

    def pull(self, rebase=False):
        rc, out, err = self._try("pull", "--rebase" if rebase else "--no-rebase", "--no-edit", timeout=120)
        if rc == 0:
            return {"ok": True, "conflict": False, "output": _clean(out or err, self.path, self._top_cache)}
        files = self._conflicts()
        if files:
            return {"ok": False, "conflict": True, "files": files}
        raise GitError(f"Pull a échoué : {_clean(err or out, self.path, self._top_cache)}{_hint(err or out)}")

    def fetch(self):
        _, out, err = self._run("fetch", timeout=120, what="Fetch")
        return {"ok": True, "output": _clean(err or out, self.path, self._top_cache)}

    # -- tags
    def next_tag(self, prefix=""):
        prefix = re.sub(r"V\d+$", "", (prefix or "").strip())
        if prefix.startswith("-") or not re.match(r"^[A-Za-z0-9._/-]{0,80}$", prefix):
            raise GitError("Nom de tag invalide (lettres, chiffres, . _ - /).")
        names = set(t["name"] for t in self.tags())
        rc, out, _ = self._try("ls-remote", "--tags", "origin", timeout=15)
        if rc == 0:
            for line in out.splitlines():
                if "\trefs/tags/" in line:
                    names.add(line.split("\trefs/tags/", 1)[1].replace("^{}", ""))
        rx = re.compile("^" + re.escape(prefix) + r"V(\d+)$")
        mx = max([int(m.group(1)) for m in (rx.match(x) for x in names) if m] or [0])
        tag = f"{prefix}V{mx + 1}"
        self._ref(tag, "tag")
        return tag

    def delete_tag(self, name, remote=False):
        """Supprime le tag en local ; avec remote=True, aussi sur origin (`git push origin :refs/tags/<name>`)."""
        self._ref(name, "tag")
        deleted = []
        if self._try("rev-parse", "--verify", "--quiet", "refs/tags/" + name)[0] == 0:
            self._run("tag", "-d", name, what="Suppression du tag")
            deleted.append("local")
        elif not remote:
            raise GitError(f"Le tag « {name} » n'existe pas en local.")
        if remote:
            self._run("push", "origin", ":refs/tags/" + name, timeout=120, what="Suppression du tag distant")
            deleted.append("distant")
        return {"ok": True, "deleted": deleted}

    # -- branches
    def create_branch(self, name, start_point=None, switch=True):
        self._ref(name)
        args = ["switch", "-c", name] if switch else ["branch", name]
        if start_point:
            sp = start_point
            if not isinstance(sp, str) or sp.startswith("-") or len(sp) > 200 or any(c.isspace() or ord(c) < 32 for c in sp):
                raise GitError("Point de départ invalide.")
            if self._try("rev-parse", "--verify", "--quiet", sp + "^{commit}")[0] != 0:
                raise GitError(f"Point de départ introuvable : « {sp} ».")
            args.append(sp)
        self._run(*args, what="Création de la branche")
        return {"ok": True, "branch": name}

    def switch(self, name):
        self._ref(name)
        self._run("switch", name, what="Changement de branche")
        return {"ok": True, "branch": self._current_branch()}

    def delete_branch(self, name, force=False):
        self._ref(name)
        if name == self._current_branch():
            raise GitError("Impossible de supprimer la branche courante : bascule d'abord sur une autre.")
        rc, out, err = self._try("branch", "-D" if force else "-d", name)
        if rc != 0:
            extra = " Elle contient des commits non fusionnés : utilise force=True pour la supprimer quand même." if "not fully merged" in err else ""
            raise GitError(f"Suppression de la branche refusée : {_clean(err or out, self.path)}.{extra}")
        return {"ok": True, "deleted": name}

    def merge(self, name, no_ff=False):
        self._ref(name)
        rc, out, err = self._try("merge", "--no-edit", *(["--no-ff"] if no_ff else []), name, timeout=120)
        if rc == 0:
            return {"ok": True, "conflict": False, "output": _clean(out or err, self.path, self._top_cache)}
        files = self._conflicts()
        if files:
            return {"ok": False, "conflict": True, "files": files}
        raise GitError(f"Fusion refusée : {_clean(err or out, self.path, self._top_cache)}")

    def merge_abort(self):
        self._run("merge", "--abort", what="Annulation de la fusion")
        return {"ok": True}

    # -- LE bouton « Envoyer »
    def send(self, folder, message, tag_prefix, push=True, allow_empty=False):
        """add -- <folder> ; commit -m <message> ; tag annoté <prefixe>V<n> ; push --follow-tags.

        Le tag est l'équivalent de `git tag -a <tag> -m <message>` (écrire `git tag -ma` collé donnerait le message « a » : on ne l'utilise pas).
        allow_empty=True : si rien n'est à valider, aucun commit n'est créé et le tag est posé sur le dernier commit (« tag seul »).
        Sans allow_empty, rien à valider -> GitError. En cas d'échec en cours de route, retourne les étapes déjà faites et l'état exact
        (aucune annulation automatique). Retourne {ok, tag, steps:[{name, ok, output}], commit, state}."""
        folder = _rel(folder)
        message = _msg(message)
        self._ref(re.sub(r"V\d+$", "", (tag_prefix or "").strip()) + "V1", "tag")        # valide le préfixe avant tout effet
        steps = []
        res = {"ok": False, "tag": None, "steps": steps, "commit": None, "state": ""}

        def fail(name, err, state):
            steps.append({"name": name, "ok": False, "output": str(err)})
            res["state"] = state
            res["commit"] = self._head() if self._has_head() else None
            return res

        try:
            self.add([folder])
        except GitError as e:
            return fail("add", e, f"Rien n'a été modifié : {e}")
        steps.append({"name": "add", "ok": True, "output": folder})
        staged = self._staged()
        if not staged and not allow_empty:
            raise GitError("Rien à envoyer : aucun changement dans « %s » depuis le dernier commit." % folder)
        if staged:
            try:
                self.commit(message)
            except GitError as e:
                return fail("commit", e, f"Fichiers ajoutés mais commit impossible : {e}")
            steps.append({"name": "commit", "ok": True, "output": message})
        else:
            if not self._has_head():
                raise GitError("Aucun commit existant sur lequel poser un tag.")
            steps.append({"name": "commit", "ok": True, "output": "Rien à valider : tag seul sur le dernier commit."})
        res["commit"] = self._head()
        try:
            tag = self.next_tag(tag_prefix)
        except GitError as e:
            return fail("tag", e, f"Commit créé localement, tag non calculé : {e}")
        res["tag"] = tag
        try:
            self._run("tag", "-a", tag, "-m", message, what="Création du tag")
        except GitError as e:
            return fail("tag", e, f"Commit créé localement, tag « {tag} » non créé : {e}")
        steps.append({"name": "tag", "ok": True, "output": tag})
        if not push:
            res.update(ok=True, state=f"Commit et tag « {tag} » créés localement (push non demandé).")
            return res
        try:
            r = self._push(follow_tags=True)
        except GitError as e:
            return fail("push", e, f"Commit et tag « {tag} » créés localement, push refusé : {e} Tu peux relancer le push (avec les tags) une fois le problème réglé.")
        steps.append({"name": "push", "ok": True, "output": r["output"]})
        res.update(ok=True, state=f"Commit, tag « {tag} » et push terminés.")
        return res


# ----------------------------------------------------------------------------- clone
def validate_url(url, allow_local=False):
    u = url.strip() if isinstance(url, str) else ""
    if not u or len(u) > 300 or any(c.isspace() or ord(c) < 32 for c in u):
        raise GitError("Adresse du dépôt vide ou invalide.")
    if u.startswith("-"):
        raise GitError("Adresse refusée (ne doit pas commencer par « - »).")
    if URL_RE.match(u):
        return u
    if allow_local and (u.startswith("/") or u.startswith("file://")):
        return u
    raise GitError("Adresse invalide : utilise https://…, ssh://… ou utilisateur@hote:chemin (file://, ext:: et chemins locaux sont refusés).")


def _clone_name(url, name):
    n = re.sub(r"\.git$", "", re.split(r"[/:]", url.rstrip("/"))[-1]) if name is None else name
    if not isinstance(n, str) or not NAME_RE.fullmatch(n) or ".." in n or n.startswith("-") or n == ".":
        raise GitError("Nom de dossier invalide (lettres, chiffres, . _ -, 100 max).")
    return n


def clone_argv(url, name, allow_local=False):
    """Commande pure `git clone -- <url> <name>` (le dossier de travail est la base). Protocoles dangereux coupés sauf allow_local."""
    pre = [] if allow_local else ["-c", "protocol.ext.allow=never", "-c", "protocol.file.allow=never"]
    return ["git", "--no-pager"] + pre + ["clone", "--", url, name]


def clone(runner, url, base_dir, name=None, allow_local=False):
    """Clone `url` dans base_dir/name. Local : base_dir absolu ; WslRunner : base_dir relatif à l'espace de travail ("" = l'espace de travail lui-même, qui doit exister).
    Retourne {path, name} (path : absolu en local, relatif à l'espace de travail en WSL, utilisable tel quel dans GitRepo)."""
    url = validate_url(url, allow_local)
    name = _clone_name(url, name)
    local = getattr(runner, "is_local", False)
    if local:
        base_dir = os.path.abspath(base_dir)
        dest = os.path.join(base_dir, name)
        if os.path.lexists(dest):
            raise GitError(f"Le dossier « {name} » existe déjà.")
        os.makedirs(base_dir, exist_ok=True)
    else:
        dest = base_dir.rstrip("/") + "/" + name if base_dir else name
        if runner.run(["sh", "-c", '[ -e "$1" ]', "sh", name], base_dir)[0] == 0:
            raise GitError(f"Le dossier « {name} » existe déjà.")
    rc, out, err = runner.run(clone_argv(url, name, allow_local), base_dir, timeout=300)
    if rc != 0:
        if local:
            shutil.rmtree(dest, ignore_errors=True)
        else:
            runner.run(["rm", "-rf", "--", name], base_dir)           # dossier partiel que ce clone vient de créer (nom validé, sans « / »)
        raise GitError(f"Clonage impossible : {_clean(err or out, base_dir)}{_hint(err or out)}")
    return {"path": dest, "name": name}


# ----------------------------------------------------------------------------- Dépôt Shell
_PROBE = 'if [ -L "$1" ]; then exit 3; elif [ -d "$1" ]; then exit 5; elif [ -e "$1" ]; then exit 4; fi; exit 0'
_WRITE = ('d=$(dirname -- "$1") && [ -d "$d" ] && t=$(mktemp "$d/.nasko-XXXXXX") && cat > "$t" && chmod "$2" "$t" && mv -f -- "$t" "$1" '
          '|| { [ -n "$t" ] && rm -f -- "$t"; exit 1; }')


def drop_shell(repo, filename, content, target="root", overwrite=False, executable=True):
    """Dépose un script .sh (UTF-8, LF, saut de ligne final, +x) à la racine du dépôt (target="root") ou dans le dossier qui le contient
    (target="parent"). NE L'EXÉCUTE JAMAIS. Retourne {ok, path, bytes, target, executable} ou {ok:False, exists:True} si présent."""
    if not isinstance(filename, str) or not SHELL_NAME_RE.fullmatch(filename):
        raise GitError("Nom invalide : lettres, chiffres, . _ - et extension .sh (aucun chemin).")
    if target not in ("root", "parent"):
        raise GitError("Cible invalide (root ou parent).")
    if isinstance(content, str):
        content = content.encode("utf-8")
    if not isinstance(content, (bytes, bytearray)) or not content:
        raise GitError("Fichier vide.")
    if len(content) > MAX_SHELL:
        raise GitError("Fichier trop gros (1 Mo maximum).")
    if b"\x00" in content:
        raise GitError("Fichier binaire refusé (octet NUL).")
    try:
        text = bytes(content).decode("utf-8-sig")
    except UnicodeDecodeError:
        raise GitError("Le fichier doit être du texte UTF-8.")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if not text.endswith("\n"):
        text += "\n"
    data = text.encode("utf-8")
    if len(data) > MAX_SHELL:
        raise GitError("Fichier trop gros (1 Mo maximum).")
    local = getattr(repo.runner, "is_local", False)
    top = repo.toplevel()
    folder = top if target == "root" else (os.path.dirname(top.rstrip("/\\")) if local else posixpath.dirname(top.rstrip("/")))
    if not folder:
        raise GitError("Dossier cible introuvable.")
    mode = "755" if executable else "644"
    if local:
        dest = os.path.join(folder, filename)
        if not os.path.isdir(folder):
            raise GitError("Dossier cible introuvable.")
        if os.path.islink(dest):
            raise GitError("Le fichier cible est un lien symbolique : refusé.")
        if os.path.isdir(dest):
            raise GitError("Un dossier porte déjà ce nom.")
        if os.path.exists(dest) and not overwrite:
            return {"ok": False, "exists": True, "path": dest, "target": target}
        fd, tmp = tempfile.mkstemp(prefix=".nasko-", dir=folder)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            os.chmod(tmp, int(mode, 8))
            os.replace(tmp, dest)
        except OSError as e:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise GitError(f"Écriture impossible : {e.strerror or e}")
    else:
        dest = folder.rstrip("/") + "/" + filename
        rc = repo.runner.run(["sh", "-c", _PROBE, "sh", dest], repo.path, timeout=20)[0]
        if rc == 3:
            raise GitError("Le fichier cible est un lien symbolique : refusé.")
        if rc == 5:
            raise GitError("Un dossier porte déjà ce nom.")
        if rc == 4 and not overwrite:
            return {"ok": False, "exists": True, "path": dest, "target": target}
        rc, out, err = repo.runner.run(["sh", "-c", _WRITE, "sh", dest, mode], repo.path, timeout=30, stdin=data)
        if rc != 0:
            raise GitError(f"Écriture impossible : {_clean(err or out, repo.path)}")
    return {"ok": True, "path": dest, "bytes": len(data), "target": target, "executable": bool(executable)}
