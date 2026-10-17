"""DEV MANAGER : console de développement WSL (Ubuntu) + VS Code, sans jamais ouvrir de terminal.

ESPACE DE TRAVAIL (règle absolue, voir nasko_wsl.py) : \\\\wsl.localhost\\Ubuntu\\home\\nasko. Tous les clones y atterrissent ; la zone de dépôt y enregistre les .sh.

  * dépôts de l'espace de travail (nom, branche, modifications, dernier commit) : liste instantanée, infos Git chargées ensuite en UNE seule commande WSL ;
  * clonage silencieux, VS Code relié au WSL (code --remote wsl+<distro>), Explorateur Windows sur le dossier ;
  * scripts .sh : ZONE DE DÉPÔT (tout .sh glissé est enregistré dans l'espace de travail, fins de ligne LF, chmod +x, prêt à être exécuté côté Linux) ;
    scripts de la racine d'un dépôt : détection, import, exécution avec arguments ;
  * N'IMPORTE QUELLE commande Linux dans le dépôt choisi : sortie en direct (flux incrémental), plusieurs tâches en parallèle, arrêt propre
    (tout le groupe de processus est tué, pas seulement wsl.exe).

Performance : aucune interrogation WSL pendant qu'aucune tâche ne tourne ; une tâche = un seul processus wsl.exe ; la sortie est lue par blocs, gardée
en mémoire plafonnée (2 Mo, les plus anciennes lignes sont éliminées) et l'interface ne demande que la suite (offset).
Sécurité : routes réservées à ce PC (jeton + local). Les valeurs variables (dépôt, nom de script, URL) passent en ARGUMENTS POSITIONNELS de bash,
jamais concaténées dans le texte du script ; le nom de dépôt est contrôlé (pas de « .. », pas de chemin)."""
import base64
import codecs
import os
import re
import secrets
import shlex
import shutil
import subprocess
import threading
import time

import nasko_wsl as W

NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)
DISTRO_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
REPO_RE = re.compile(r"^[A-Za-z0-9._-]{1,100}$")
SCRIPT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.sh$")
URL_RE = re.compile(r"^(https://[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+|ssh://[A-Za-z0-9._~:/@%+-]+|[A-Za-z0-9][A-Za-z0-9._-]{0,63}@[A-Za-z0-9][A-Za-z0-9.-]*:[A-Za-z0-9._~/%+-]+)$")
SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$")
ANSI_RE = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])")
OUT_MAX, OUT_KEEP = 2_000_000, 1_500_000
MAX_RUNNING, MAX_JOBS = 4, 24
MAX_IMPORT = 2 * 1024 * 1024
# $1 = fichier PID, $2 = dépôt, $3 = commande. `set -m` : la commande a son PROPRE groupe de processus (pgid = pid), tué en bloc par stop_job.
# Dossier des dépôts $B : TOUJOURS l'espace de travail (nasko_wsl.DIR, réglable) ; G=1 : seuls les dossiers Git sont listés (le dossier personnel contient aussi autre chose).
# S'il est introuvable : code 99 et message explicite (jamais de repli sur un autre dossier). Rien n'est créé.
# Les scripts portent des MARQUEURS (@@WSDIR@@, @@WSUNC@@) remplacés à l'envoi par _subst() : le réglage peut changer sans recharger le module.
WS_DIR_MARK, WS_UNC_MARK = "@@WSDIR@@", "@@WSUNC@@"
BSET = ('B=' + WS_DIR_MARK + '; G=1; [ -d "$B" ] || { echo \'Dossier de travail introuvable : ' + WS_UNC_MARK + '\' >&2; exit 99; }; ')


def _subst(script):
    """Remplace les marqueurs d'espace de travail par le dossier ACTUEL (déjà validé par nasko_wsl : lettres, chiffres, . _ - uniquement)."""
    return script.replace(WS_DIR_MARK, shlex.quote(W.DIR)).replace(WS_UNC_MARK, W.WORKSPACE_UNC)
WRAP = (BSET + 'cd "$B/$2" || exit 97\n'
        'export GIT_TERMINAL_PROMPT=0 TERM=dumb\n'
        'set -m\nbash -lc "$3" </dev/null &\np=$!\necho "$p" > "$1"\nwait "$p"\nexit $?\n')
_lock = threading.Lock()
JOBS = {}                                        # id -> job (dict)
_cache = {"repos": (0.0, None)}


class DevError(Exception):
    pass


def distro(cfg=None):
    """Distribution de l'espace de travail : imposée par nasko_wsl (le réglage `wsl_distro` n'a plus d'effet : le dossier de travail est sous cette distribution)."""
    return W.DISTRO


def available():
    return bool(shutil.which("wsl"))


def _need_wsl():
    if not available():
        raise DevError("WSL n'est pas installé sur ce PC.")


def _launcher(script, args=(), prefix=""):
    """wsl.exe ne transmet NI les arguments positionnels NI les guillemets imbriqués : tout le script (valeurs comprises, citées par shlex)
    voyage donc en base64 dans une commande 100 % alphanumérique, exécutée par `bash <(…)` — l'entrée standard reste libre pour des données."""
    body = "set -- " + " ".join(shlex.quote(str(a)) for a in args) + "\n" + _subst(script)
    return f"{prefix}bash <(echo {base64.b64encode(body.encode('utf-8')).decode()}|base64 -d)"


def _wsl_raw(d, script, *args, timeout=60, data=None):
    """Comme _wsl mais en octets : retourne (code, stdout brut, stderr texte). Sert à lire/écrire des fichiers sans rien altérer."""
    _need_wsl()
    cmd = ["wsl.exe", "-d", d, "--", "bash", "-c", _launcher(script, args)]
    try:
        p = subprocess.run(cmd, capture_output=True, input=data, timeout=timeout, stdin=None if data is not None else subprocess.DEVNULL, creationflags=NOWIN)
    except subprocess.TimeoutExpired:
        raise DevError("Délai dépassé (WSL ne répond pas).")
    except OSError as e:
        raise DevError(f"Lancement de WSL impossible : {e}")
    return p.returncode, p.stdout or b"", (p.stderr or b"").decode("utf-8", "replace").replace(chr(0), "").strip()


def _wsl(d, script, *args, timeout=60, data=None):
    """Exécute `script` (bash ; $1, $2… = args) dans la distribution. Retourne (code, sortie texte)."""
    rc, out, err = _wsl_raw(d, script, *args, timeout=timeout, data=data)
    return rc, (out + err.encode("utf-8")).decode("utf-8", "replace").replace(chr(0), "").strip()


def repo_name(name):
    name = (name or "").strip()
    if not REPO_RE.match(name) or name in (".", ".."):
        raise DevError("Nom de dépôt invalide.")
    return name


# ----------------------------------------------------------------------------- dépôts
LIST_LIGHT = BSET + 'echo "#$B"; cd "$B" || exit 0; for d in */; do d=${d%/}; [ -d "$d" ] || continue; [ "$G" = 1 ] && [ ! -e "$d/.git" ] && continue; echo "$d"; done'
LIST_FULL = (BSET + 'echo "#$B"; cd "$B" || exit 0; for d in */; do d=${d%/}; [ -d "$d" ] || continue; [ "$G" = 1 ] && [ ! -e "$d/.git" ] && continue; '
             'b=$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null); n=$(git -C "$d" status --porcelain 2>/dev/null | wc -l); '
             't=$(git -C "$d" log -1 --format=%ct 2>/dev/null); '
             'printf "%s\\t%s\\t%s\\t%s\\n" "$d" "$b" "$n" "$t"; done')


def _base(out):
    """Dossier des dépôts, tel qu'affiché (chemin Windows de l'espace de travail)."""
    return W.WORKSPACE_UNC


def list_repos(cfg=None, full=False):
    """full=False : noms seuls (instantané). full=True : + branche, nombre de modifications, date du dernier commit (cache 8 s)."""
    d = distro(cfg)
    if not full:
        rc, out = _wsl(d, LIST_LIGHT, timeout=40)
        if rc:
            raise DevError(f"Lecture de {W.WORKSPACE_UNC} impossible : {out[-200:] or 'distribution « ' + d + ' » inaccessible'} — règle ton dossier dans Dépôt Intranet › ESPACE WSL.")
        return {"distro": d, "base": _base(out), "repos": [{"name": n} for n in out.splitlines() if REPO_RE.match(n)]}
    t, v = _cache["repos"]
    if v and v["distro"] == d and time.time() - t < 8:
        return v
    rc, out = _wsl(d, LIST_FULL, timeout=90)
    if rc:
        raise DevError(f"Lecture de {W.WORKSPACE_UNC} impossible : {out[-200:]} — règle ton dossier dans Dépôt Intranet › ESPACE WSL.")
    repos = []
    for line in out.splitlines():
        p = line.split("\t")
        if len(p) == 4 and REPO_RE.match(p[0]):
            repos.append({"name": p[0], "branch": p[1], "dirty": int(p[2] or 0), "ts": int(p[3]) if p[3].isdigit() else 0})
    res = {"distro": d, "base": _base(out), "repos": repos}
    _cache["repos"] = (time.time(), res)
    return res


INFO = (BSET + 'cd "$B/$1" || exit 97; echo "path=$PWD"; echo "branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"; '
        'echo "dirty=$(git status --porcelain 2>/dev/null | wc -l)"; echo "remote=$(git remote get-url origin 2>/dev/null)"; '
        'echo "ab=$(git rev-list --left-right --count "@{u}...HEAD" 2>/dev/null)"; echo "last=$(git log -1 --format=%s 2>/dev/null)"; '
        'find . -maxdepth 1 -type f -name "*.sh" -printf "sh=%f\\t%s\\n" | sort')


def repo_info(name, cfg=None):
    d = distro(cfg)
    name = repo_name(name)
    rc, out = _wsl(d, INFO, name, timeout=40)
    if rc == 97:
        raise DevError(f"« {name} » n'existe pas dans {W.WORKSPACE_UNC}.")
    if rc:
        raise DevError(out[-200:] or f"Erreur WSL ({rc}).")
    info = {"name": name, "scripts": []}
    for line in out.splitlines():
        k, _, v = line.partition("=")
        if k == "sh":
            n, _, s = v.partition("\t")
            if SCRIPT_RE.match(n):
                info["scripts"].append({"name": n, "size": int(s) if s.isdigit() else 0})
        elif k in ("path", "branch", "remote", "last"):
            info[k] = v
        elif k == "dirty":
            info["dirty"] = int(v or 0)
        elif k == "ab":
            p = v.split()
            info["behind"], info["ahead"] = (int(p[0]), int(p[1])) if len(p) == 2 and all(x.isdigit() for x in p) else (None, None)
    return info


def normalize_url(text):
    """URL complète, ou « proprietaire/depot » (GitHub). Lève DevError sinon."""
    t = (text or "").strip()
    if not t or len(t) > 300 or any(c.isspace() or ord(c) < 32 for c in t):
        raise DevError("Collez l'adresse du dépôt (https://github.com/…/….git) ou « proprietaire/depot ».")
    if SLUG_RE.match(t):
        return f"https://github.com/{t}.git"
    if URL_RE.match(t) and not t.startswith("-"):
        return t
    raise DevError("Adresse invalide : utilisez https://…, ssh://…, utilisateur@hôte:chemin (ex. prenom.nom@git.forge.epita.fr:projet) ou « proprietaire/depot » (un nom seul ne suffit pas : GitHub a besoin du propriétaire).")


# ----------------------------------------------------------------------------- tâches (flux en direct)
def _clean(job, chunk):
    """Retire les séquences ANSI (même coupées entre deux blocs), ramène les « \\r » de progression à la dernière version de la ligne."""
    s = job["pend"] + chunk
    job["pend"] = ""
    i = s.rfind("\x1b")
    if i >= 0 and len(s) - i < 24 and not ANSI_RE.match(s, i):
        s, job["pend"] = s[:i], s[i:]
    s = ANSI_RE.sub("", s).replace("\r\n", "\n")
    if "\r" in s:
        s = "\n".join(p.split("\r")[-1] for p in s.split("\n"))
    return s


def _append(job, text):
    if not text:
        return
    with _lock:
        job["out"] += text
        if len(job["out"]) > OUT_MAX:
            cut = len(job["out"]) - OUT_KEEP
            job["out"] = job["out"][cut:]
            job["dropped"] += cut


def _reader(job):
    proc, dec = job["proc"], codecs.getincrementaldecoder("utf-8")("replace")
    try:
        while True:
            b = proc.stdout.read1(8192)
            if not b:
                break
            _append(job, _clean(job, dec.decode(b)))
        _append(job, _clean(job, dec.decode(b"", True)) + job["pend"])
    except (OSError, ValueError):
        pass
    rc = proc.wait()
    if rc == 97:
        _append(job, "Dépôt introuvable dans " + W.WORKSPACE_UNC + ".\n")
    job.update(rc=rc, t1=time.time(), running=False)
    try:                                                    # nettoyage du fichier de PID côté Linux (sans bloquer)
        threading.Thread(target=_wsl, args=(job["distro"], 'rm -f "$1"', job["pidfile"]), kwargs={"timeout": 15}, daemon=True).start()
    except Exception:                                       # noqa: BLE001
        pass
    if job["kind"] == "clone":
        _cache["repos"] = (0.0, None)


def public(job):
    return {k: job[k] for k in ("id", "kind", "repo", "cmd", "running", "rc", "t0", "t1", "stopping")} | {"size": job["dropped"] + len(job["out"])}


def start_job(kind, repo, cmd, cfg=None):
    """Lance `cmd` (texte bash libre) dans <espace de travail>/<repo> ; retourne l'id. repo='' : dans l'espace de travail (clonage, scripts déposés)."""
    d = distro(cfg)
    _need_wsl()
    cmd = (cmd or "").strip()
    if not cmd or len(cmd) > 8000 or "\x00" in cmd:
        raise DevError("Commande vide ou trop longue.")
    repo = repo_name(repo) if repo else ""
    with _lock:
        if sum(1 for j in JOBS.values() if j["running"]) >= MAX_RUNNING:
            raise DevError(f"{MAX_RUNNING} tâches tournent déjà : arrêtez-en une.")
        jid = secrets.token_hex(4)
        pidfile = f"/tmp/enosdev-{jid}.pid"
        job = {"id": jid, "kind": kind, "repo": repo, "cmd": cmd, "running": True, "rc": None, "t0": time.time(), "t1": 0, "stopping": False,
               "out": "", "dropped": 0, "pend": "", "proc": None, "pidfile": pidfile, "distro": d}
        try:
            job["proc"] = subprocess.Popen(["wsl.exe", "-d", d, "--", "bash", "-c", _launcher(WRAP, (pidfile, repo, cmd))],
                                           stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, creationflags=NOWIN)
        except OSError as e:
            raise DevError(f"Lancement de WSL impossible : {e}")
        JOBS[jid] = job
        for old in [k for k in JOBS if len(JOBS) > MAX_JOBS and not JOBS[k]["running"]][: max(0, len(JOBS) - MAX_JOBS)]:
            JOBS.pop(old, None)                             # on garde les 24 dernières tâches
    threading.Thread(target=_reader, args=(job,), daemon=True, name="devmgr-" + jid).start()
    return jid


def job_output(jid, since=0):
    job = JOBS.get(jid)
    if not job:
        raise DevError("Tâche introuvable.")
    with _lock:
        start = max(int(since), job["dropped"])
        text = job["out"][start - job["dropped"]:]
        return {**public(job), "from": start, "text": text, "reset": int(since) < job["dropped"]}


def jobs():
    with _lock:
        return [public(j) for j in sorted(JOBS.values(), key=lambda j: j["t0"])]


def stop_job(jid):
    job = JOBS.get(jid)
    if not job or not job["running"]:
        return False
    job["stopping"] = True

    def kill():
        try:
            _wsl(job["distro"], 'p=$(cat "$1" 2>/dev/null); [ -n "$p" ] && { kill -TERM -- -"$p"; sleep 2; kill -KILL -- -"$p"; }; true', job["pidfile"], timeout=20)
        except DevError:
            pass
        time.sleep(1)
        if job["running"] and job["proc"]:
            job["proc"].kill()                              # filet de sécurité : ferme au moins le processus wsl.exe
    threading.Thread(target=kill, daemon=True).start()
    return True


def stop_all():
    for j in list(JOBS.values()):
        if j["running"]:
            try:
                j["proc"].kill()
            except OSError:
                pass


def clone(text, cfg=None):
    """`git clone` d'un dépôt : la destination est TOUJOURS <espace de travail>/<nom> (chemin absolu, indépendant du dossier courant). Retourne (id de tâche, nom)."""
    url = normalize_url(text)
    name = repo_name(re.sub(r"(\.git)?/*$", "", url).replace(":", "/").rsplit("/", 1)[-1])
    dest = W.linux_path(name)
    return start_job("clone", "", "git clone --progress -- " + shlex.quote(url) + " " + shlex.quote(dest), cfg), name


def run_script(repo, script, args="", cfg=None):
    """Exécute un .sh : à la racine du dépôt `repo`, ou dans l'espace de travail si `repo` est vide (script déposé dans la zone de dépôt)."""
    if not SCRIPT_RE.match(script or ""):
        raise DevError("Nom de script invalide (lettres, chiffres, . _ - et extension .sh).")
    args = (args or "").strip()
    cmd = f'[ -f "./{script}" ] || {{ echo "{script} est absent du dossier courant."; exit 98; }}; bash "./{script}" {args}'
    return start_job("script", repo, cmd, cfg)


def _script_bytes(name, content):
    """Contrôle le nom et prépare le contenu : LF, BOM retiré (sinon le shebang casse), 2 Mo max. Retourne les octets UTF-8."""
    if not SCRIPT_RE.match(name or ""):
        raise DevError("Nom invalide : lettres, chiffres, . _ - et extension .sh.")
    text = (content or "").replace("\r\n", "\n").replace("\r", "\n")
    data = (text[1:] if text.startswith(chr(0xFEFF)) else text).encode("utf-8")
    if not data or len(data) > MAX_IMPORT:
        raise DevError("Fichier vide ou trop gros (2 Mo max).")
    if b"\x00" in data:
        raise DevError("Fichier binaire refusé.")
    return data


# $1 = sous-dossier ('' = espace de travail), $2 = nom, $3 = 1 pour remplacer. Écriture ATOMIQUE (fichier temporaire + renommage : jamais de script à moitié écrit,
# et un lien symbolique existant est remplacé, pas suivi), puis chmod +x. 97 = dossier introuvable, 96 = existe déjà, 95 = c'est un dossier.
PUT_SCRIPT = (BSET + 'cd "$B/$1" || exit 97; [ -d "$2" ] && exit 95; [ -e "$2" ] && [ "$3" != 1 ] && exit 96; '
              't=$(mktemp "./.enos-XXXXXX") && cat > "$t" && chmod +x "$t" && mv -fT -- "$t" "$2" || { [ -n "$t" ] && rm -f -- "$t"; exit 1; }')


def _put_script(d, repo, name, data, overwrite):
    rc, out = _wsl(d, PUT_SCRIPT, repo, name, "1" if overwrite else "0", data=data, timeout=40)
    if rc == 96:
        raise DevError("exists")
    if rc == 95:
        raise DevError("Un dossier porte déjà ce nom.")
    if rc == 97:
        raise DevError("Dépôt introuvable.")
    if rc:
        raise DevError("Import impossible : " + (out[-200:] or f"erreur WSL ({rc})"))


def drop_script(name, content, overwrite=False, cfg=None):
    """ZONE DE DÉPÔT : enregistre un .sh dans l'espace de travail (\\\\wsl.localhost\\Ubuntu\\home\\nasko), fins de ligne LF, exécutable : prêt à être lancé côté Linux.
    Ne l'exécute JAMAIS. Lève DevError('exists') si le fichier existe et overwrite est faux. Retourne {name, path (Windows), linux, bytes, executable}."""
    d = distro(cfg)
    data = _script_bytes(name, content)
    _put_script(d, "", name, data, overwrite)
    return {"name": name, "path": W.unc_path(name), "linux": W.linux_path(name), "bytes": len(data), "executable": True}


def import_script(repo, name, content, overwrite=False, cfg=None):
    """Dépose un .sh à la racine du dépôt `repo` (LF, exécutable). Retourne True ; lève DevError('exists') si présent et overwrite faux."""
    d = distro(cfg)
    repo = repo_name(repo)
    _put_script(d, repo, name, _script_bytes(name, content), overwrite)
    return True


# ----------------------------------------------------------------------------- explorateur + éditeur (mode observateur)
FILE_MAX = 1_500_000
FS_PRE = (BSET + 'cd "$B/$1" || exit 97; R=$PWD; '
          'chk(){ case "$1" in /*|../*|*/../*|*/..|..) exit 95;; esac; p=$(realpath -m -- "$1") || exit 95; case "$p" in "$R"|"$R"/*) ;; *) exit 95;; esac; }; chk "$2"; ')
FS_ERR = {97: "Dépôt introuvable.", 96: "Fichier ou dossier introuvable.", 95: "Chemin refusé (hors du dépôt).", 94: f"Fichier trop gros pour l'éditeur (> {FILE_MAX // 1000} Ko).",
          93: "Fichier binaire : non éditable.", 92: "C'est un dossier.", 91: "Existe déjà."}


def rel_path(path, allow_root=True):
    """Chemin relatif propre dans le dépôt ('.' = racine). Refuse '..', chemins absolus, caractères de contrôle."""
    path = (path or "").replace("\\", "/").strip().strip("/")
    if not path or path == ".":
        if allow_root:
            return "."
        raise DevError("Chemin vide.")
    if len(path) > 1000 or any(ord(c) < 32 for c in path):
        raise DevError("Chemin invalide.")
    parts = path.split("/")
    if any(x in ("", ".", "..") for x in parts):
        raise DevError("Chemin invalide.")
    return "/".join(parts)


def _fs(repo, script, path, *extra, cfg=None, data=None, timeout=40, allow_root=True):
    d = distro(cfg)
    repo = repo_name(repo)
    path = rel_path(path, allow_root)
    rc, out, err = _wsl_raw(d, FS_PRE + script, repo, path, *extra, data=data, timeout=timeout)
    if rc:
        raise DevError(FS_ERR.get(rc) or (err[-200:] or f"Erreur WSL ({rc})."))
    return out


def tree(repo, path=".", cfg=None):
    """Contenu d'UN dossier (chargement paresseux) : [{name, type: d|f|l, size}] — dossiers d'abord, .git masqué."""
    out = _fs(repo, 'cd "$2" 2>/dev/null || exit 96; find . -mindepth 1 -maxdepth 1 ! -name .git -printf "%Y\\t%s\\t%f\\0"', path, cfg=cfg)
    items = []
    for rec in out.split(b"\x00"):
        t, _, rest = rec.decode("utf-8", "replace").partition("	")
        size, _, name = rest.partition("	")
        if t and name:
            items.append({"name": name, "type": "d" if t == "d" else "f", "size": int(size) if size.isdigit() else 0})
    items.sort(key=lambda x: (x["type"] != "d", x["name"].lower()))
    return items


def read_file(repo, path, cfg=None):
    out = _fs(repo, '[ -f "$2" ] || exit 96; s=$(stat -c %s -- "$2"); [ "$s" -gt ' + str(FILE_MAX) + ' ] && exit 94; '
              '[ "$(head -c 8000 -- "$2" | tr -d "\\000" | wc -c)" = "$(head -c 8000 -- "$2" | wc -c)" ] || exit 93; cat -- "$2"', path, cfg=cfg, allow_root=False, timeout=60)
    try:
        text = out.decode("utf-8")
    except UnicodeDecodeError:
        raise DevError("Fichier non UTF-8 : non éditable.")
    return {"path": rel_path(path, False), "text": text, "size": len(out)}


def write_file(repo, path, content, cfg=None):
    data = (content or "").encode("utf-8")
    if len(data) > FILE_MAX * 2:
        raise DevError("Contenu trop gros.")
    _fs(repo, '[ -d "$2" ] && exit 92; [ -e "$2" ] || exit 96; cat > "$2"', path, cfg=cfg, data=data, allow_root=False, timeout=60)
    return True


def create_entry(repo, path, kind, cfg=None):
    if kind not in ("file", "dir"):
        raise DevError("Type invalide.")
    _fs(repo, '[ -e "$2" ] && exit 91; if [ "$3" = dir ]; then mkdir -p -- "$2"; else mkdir -p -- "$(dirname -- "$2")" && : > "$2"; fi', path, kind, cfg=cfg, allow_root=False)
    return True


def delete_entry(repo, path, cfg=None):
    rp = rel_path(path, False)
    if rp == ".git" or rp.startswith(".git/"):
        raise DevError("Suppression de .git refusée.")
    _fs(repo, '[ -e "$2" ] || [ -L "$2" ] || exit 96; if [ -d "$2" ] && [ ! -L "$2" ]; then rm -rf -- "$2"; else rm -f -- "$2"; fi', path, cfg=cfg, allow_root=False)
    return True


# ----------------------------------------------------------------------------- VS Code / Explorateur
def _repo_path(d, repo):
    rc, out = _wsl(d, BSET + 'test -d "$B/$1" && printf %s "$B/$1"', repo, timeout=40)
    if rc or not out.startswith("/"):
        raise DevError(f"« {repo} » n'existe pas dans {W.WORKSPACE_UNC} (ou la distribution « {d} » est inaccessible).")
    return out.splitlines()[-1]


def open_vscode(repo, cfg=None):
    """VS Code relié au WSL sur <espace de travail>/<repo> (fenêtre détachée, aucune console)."""
    d = distro(cfg)
    repo = repo_name(repo)
    path = _repo_path(d, repo)
    code = shutil.which("code.cmd") or shutil.which("code")
    if not code:
        raise DevError("VS Code introuvable (commande « code » absente du PATH Windows).")
    cmd = [code, "--remote", f"wsl+{d}", path]
    if code.lower().endswith((".cmd", ".bat")):
        cmd = ["cmd.exe", "/c", *cmd]
    try:
        subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=NOWIN | 0x00000008)
    except OSError as e:
        raise DevError(f"Lancement de VS Code impossible : {e}")
    return path


def open_explorer(repo, cfg=None):
    d = distro(cfg)
    repo = repo_name(repo)
    _repo_path(d, repo)
    unc = W.unc_path(repo)
    try:
        subprocess.Popen(["explorer.exe", unc], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as e:
        raise DevError(f"Explorateur impossible : {e}")
    return unc


# ------------------------------------------------------------------ espace de travail WSL réglable (chaque utilisateur a son propre dossier)
_HOME_RE = re.compile(r"/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*")


def _dir_exists(distro_name, path):
    rc, out = _wsl(distro_name, '[ -d "$1" ] && echo ok', path, timeout=40)
    return rc == 0 and out.strip().endswith("ok")


def workspace_state(cfg=None):
    """Dossier de travail courant + s'il existe réellement dans WSL. Ne lève jamais : `reason` explique un éventuel problème."""
    unc, ok, reason = W.workspace_unc(), False, ""
    if not available():
        reason = "WSL n'est pas installé sur ce PC."
    else:
        try:
            ok = _dir_exists(W.DISTRO, W.DIR)
            if not ok:
                reason = "Dossier introuvable dans WSL : vérifie le nom de la distribution et de l'utilisateur."
        except DevError as e:
            reason = str(e)
    return {"unc": unc, "distro": W.DISTRO, "linux": W.DIR, "default": W.is_default(), "exists": ok, "reason": reason, "wsl": available(), "example": "\\\\wsl.localhost\\Ubuntu\\home\\toi"}


def set_workspace(unc, cfg=None):
    """Enregistre le dossier de travail WSL. Forme contrôlée ET existence vérifiée dans WSL avant d'être appliqué (vide = dossier par défaut)."""
    unc = (unc or "").strip()
    try:
        new = W.clean_unc(unc) if unc else W.DEFAULT_UNC
        dist, path = W.parse_unc(new)
    except ValueError as e:
        raise DevError(str(e))
    _need_wsl()
    if not _dir_exists(dist, path):
        raise DevError(f"Dossier introuvable dans WSL : {new}. Vérifie la distribution et le nom d'utilisateur (le bouton DÉTECTER les trouve pour toi).")
    try:
        W.set_workspace(unc)
    except ValueError as e:
        raise DevError(str(e))
    return workspace_state()


def detect_workspace(cfg=None):
    """Propose \\\\wsl.localhost\\<distribution par défaut>\\<home de l'utilisateur WSL>, lu dans WSL lui-même."""
    _need_wsl()
    cmd = ["wsl.exe", "--", "bash", "-c", _launcher('printf "%s\\n%s\\n" "$WSL_DISTRO_NAME" "$HOME"')]
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=40, stdin=subprocess.DEVNULL, creationflags=NOWIN)
    except subprocess.TimeoutExpired:
        raise DevError("Délai dépassé (WSL ne répond pas).")
    except OSError as e:
        raise DevError(f"Lancement de WSL impossible : {e}")
    lines = (p.stdout or b"").decode("utf-8", "replace").replace(chr(0), "").split()
    if p.returncode != 0 or len(lines) < 2 or not DISTRO_RE.match(lines[0]) or not _HOME_RE.fullmatch(lines[1]):
        raise DevError("Détection impossible : saisis le chemin à la main (ex. \\\\wsl.localhost\\Ubuntu\\home\\toi).")
    unc = "\\\\wsl.localhost\\" + lines[0] + lines[1].replace("/", "\\")
    try:
        W.parse_unc(unc)
    except ValueError as e:
        raise DevError(str(e))
    return {"unc": unc}


# ------------------------------------------------------------------ désinstallation des versions de test (Inno Setup)
# Inno ne crée qu'UN désinstalleur (unins000.exe), dans le dossier de l'application : {autopf}\ENOS, pas dans « Dual Pulse Launcher ». Il retire donc E.N.O.S.
# ET le Launcher installés par enos.iss. On le retrouve par la clé Uninstall de l'AppId (le dossier peut avoir été changé à l'installation), avec repli.
INNO_APP_ID = "{6F1E2B7A-4C3D-4E8B-9A57-E905A1C0D3B2}"            # = AppId de installer/enos.iss : ne doit jamais changer
_UNINS_NAME = re.compile(r"unins\d{3}\.exe", re.I)


def _registry_uninstaller():
    """Chemin lu dans la clé Uninstall\\{AppId}_is1 (machine 64/32 bits, puis utilisateur), ou ''."""
    try:
        import winreg
    except ImportError:                                            # pas Windows
        return ""
    sub = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\%s_is1" % INNO_APP_ID
    for hive, view in ((winreg.HKEY_LOCAL_MACHINE, winreg.KEY_WOW64_64KEY), (winreg.HKEY_LOCAL_MACHINE, winreg.KEY_WOW64_32KEY), (winreg.HKEY_CURRENT_USER, 0)):
        try:
            with winreg.OpenKey(hive, sub, 0, winreg.KEY_READ | view) as k:
                raw = winreg.QueryValueEx(k, "UninstallString")[0]
        except OSError:
            continue
        m = re.match(r'\s*"([^"]+)"', raw) or re.match(r"\s*(\S+)", raw)          # Inno écrit : "C:\...\unins000.exe" (+ éventuellement des options)
        if m:
            return m.group(1)
    return ""


def find_uninstaller():
    """Chemin de l'exécutable de désinstallation Inno (unins000.exe), ou None. Jamais fourni par l'appelant : registre, puis emplacements par défaut."""
    pf = os.environ.get("ProgramFiles", r"C:\Program Files")
    for cand in (_registry_uninstaller(), os.path.join(pf, "ENOS", "unins000.exe"), os.path.join(pf, "Dual Pulse Launcher", "unins000.exe")):
        if cand and _UNINS_NAME.fullmatch(os.path.basename(cand)) and os.path.isfile(cand):
            return os.path.normpath(cand)
    return None


def uninstall_launcher(silent=True):
    """Lance le désinstalleur Inno SANS attendre. Droits administrateur : ShellExecute « runas » affiche l'UAC (Popen échouerait avec l'erreur 740 : l'exécutable
    exige l'élévation). Retourne immédiatement ; l'utilisateur peut refuser l'UAC (rien n'est alors désinstallé)."""
    exe = find_uninstaller()
    if not exe:
        raise DevError("Désinstalleur introuvable (aucune version installée par l'installeur Inno Setup, ou déjà désinstallée).")
    try:
        import ctypes
        rc = ctypes.windll.shell32.ShellExecuteW(None, "runas", exe, "/SILENT" if silent else "", os.path.dirname(exe), 1)
    except (AttributeError, OSError) as e:
        raise DevError(f"Lancement du désinstalleur impossible : {e}")
    if rc <= 32:                                                    # <= 32 : échec de ShellExecute (5 = accès refusé / UAC refusé)
        raise DevError("Désinstallation annulée (fenêtre administrateur refusée) ou impossible à lancer." if rc in (0, 5) else f"Désinstalleur non lancé (code {rc}).")
    return {"path": exe, "silent": bool(silent)}


def status(cfg=None):
    return {"wsl": available(), "running": sum(1 for j in JOBS.values() if j["running"]), "workspace": W.WORKSPACE_UNC, "distro": W.DISTRO,
            "uninstaller": bool(find_uninstaller())}
