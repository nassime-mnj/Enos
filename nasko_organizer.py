"""ORGANISATEUR DE DOSSIERS ET DE FICHIERS : explorateur rapide pour ranger (créer, renommer, déplacer, copier, extraire, supprimer, annuler).

Sécurité : tout chemin reçu est résolu (realpath) puis DOIT se trouver sous une « racine » accordée (dossiers utilisateur, projets, ou dossier choisi
dans le sélecteur natif de Windows). Les lecteurs entiers et les dossiers système sont refusés ; la racine elle-même ne peut être ni renommée,
ni déplacée, ni supprimée. La suppression passe toujours par la Corbeille de Windows (réversible). Rien n'est jamais écrasé : un nom déjà pris
devient « nom (2) ».
"""
import json
import logging
import os
import re
import shutil
import subprocess
import threading
import time

import nasko_paths
from nasko_core import app_dir

log = logging.getLogger("nasko")

_lock = threading.RLock()
_GRANTED = []                 # racines choisies par l'utilisateur (sélecteur natif), mémorisées
_UNDO = []                    # pile d'annulation : [{label, steps:[(op, a, b)]}]
MAX_ENTRIES = 6000
_RECENT_FILE = os.path.join(app_dir(), "data", "org_roots.json")

_FORBIDDEN_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}
_NO_OPEN = {".exe", ".bat", ".cmd", ".com", ".scr", ".msi", ".ps1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".lnk", ".reg", ".hta", ".cpl", ".jar", ".pif", ".dll", ".sys"}

CATEGORIES = {      # rangement automatique par type
    "Images": {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".svg", ".heic", ".ico", ".psd", ".raw"},
    "Vidéos": {".mp4", ".mov", ".mkv", ".avi", ".webm", ".wmv", ".flv", ".m4v", ".mpg", ".mpeg"},
    "Audio": {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".wma", ".opus", ".mid"},
    "Documents": {".pdf", ".doc", ".docx", ".odt", ".txt", ".rtf", ".md", ".xls", ".xlsx", ".csv", ".ppt", ".pptx", ".epub"},
    "Archives": {".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".iso"},
    "Code": {".py", ".js", ".ts", ".html", ".css", ".json", ".xml", ".cs", ".gd", ".cpp", ".c", ".h", ".java", ".sh", ".bat", ".yml", ".yaml", ".sql"},
    "Programmes": {".exe", ".msi", ".apk", ".dmg"},
}


class OrgError(Exception):
    """Erreur affichable telle quelle à l'utilisateur."""


# ----------------------------------------------------------------------------- racines
def _norm(p):
    return os.path.normcase(os.path.abspath(p))


def _real(p):
    return os.path.normcase(os.path.realpath(p))


def _load_granted():
    try:
        with open(_RECENT_FILE, encoding="utf-8") as f:
            for p in json.load(f):
                if isinstance(p, str) and os.path.isdir(p) and not _blocked_root(p) and p not in _GRANTED:
                    _GRANTED.append(p)
    except (OSError, ValueError):
        pass


def _save_granted():
    try:
        os.makedirs(os.path.dirname(_RECENT_FILE), exist_ok=True)
        with open(_RECENT_FILE, "w", encoding="utf-8") as f:
            json.dump(_GRANTED[:12], f, ensure_ascii=False)
    except OSError:
        pass


def _blocked_root(path):
    """Lecteur entier ou dossier système : jamais utilisable comme racine."""
    real = os.path.realpath(path)
    if os.path.dirname(real) == real:                       # « C:\ »
        return True
    n = os.path.normcase(real)
    for var in ("WINDIR", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"):
        v = os.environ.get(var)
        if v:
            vn = os.path.normcase(os.path.realpath(v))
            if n == vn or n.startswith(vn + os.sep):
                return True
    return False


def default_roots(projects=()):
    """Raccourcis proposés par défaut : projets E.N.O.S. + dossiers utilisateur de Windows."""
    out, seen = [], set()

    def add(name, path, kind):
        if path and os.path.isdir(path) and _norm(path) not in seen and not _blocked_root(path):
            seen.add(_norm(path))
            out.append({"name": name, "path": path, "kind": kind})

    for p in projects:
        add(p.get("name") or os.path.basename(p["path"]), p["path"], "project")
    for key, label in (("desktop", "Bureau"), ("documents", "Documents"), ("downloads", "Téléchargements"), ("pictures", "Images"), ("videos", "Vidéos"), ("music", "Musique")):
        add(label, nasko_paths.user_dir(key), "user")
    for p in _GRANTED:
        add(os.path.basename(p.rstrip("\\/")) or p, p, "picked")
    return out


def grant(path):
    """Accorde un dossier choisi dans le sélecteur natif (racine)."""
    if not os.path.isdir(path):
        raise OrgError("Dossier introuvable.")
    if _blocked_root(path):
        raise OrgError("Ce dossier (lecteur entier ou dossier système) ne peut pas être organisé ici.")
    with _lock:
        _GRANTED[:] = [p for p in _GRANTED if _norm(p) != _norm(path)]
        _GRANTED.insert(0, os.path.abspath(path))
        _save_granted()


def _allowed_roots(projects=()):
    return [r["path"] for r in default_roots(projects)]


_PROJECTS_PROVIDER = lambda: []          # noqa: E731  (remplacé par le serveur : liste des projets E.N.O.S.)


def set_projects_provider(fn):
    global _PROJECTS_PROVIDER
    _PROJECTS_PROVIDER = fn


def _root_of(path):
    """Racine accordée qui contient `path` (chemin réel), ou None."""
    real = _real(path)
    best = None
    for r in _allowed_roots(_PROJECTS_PROVIDER()):
        rr = _real(r)
        if real == rr or real.startswith(rr.rstrip("\\/") + os.sep):
            if best is None or len(rr) > len(best[1]):
                best = (r, rr)
    return best


def _check(path, allow_root=True):
    """Chemin absolu validé (sous une racine accordée, jamais via un lien qui sort de la racine)."""
    if not isinstance(path, str) or not path.strip():
        raise OrgError("Chemin vide.")
    p = os.path.abspath(path.strip().strip('"'))
    hit = _root_of(p)
    if hit is None:
        raise OrgError("Dossier non autorisé : choisissez-le d'abord avec « Autre dossier… ».")
    if not allow_root and _real(p) == hit[1]:
        raise OrgError("Le dossier racine ne peut pas être modifié depuis l'organisateur.")
    return p


def _valid_name(name):
    name = (name or "").strip()
    if not name:
        raise OrgError("Le nom ne peut pas être vide.")
    if len(name) > 255:
        raise OrgError("Nom trop long (255 caractères maximum).")
    if _FORBIDDEN_CHARS.search(name):
        raise OrgError('Caractères interdits : < > : " / \\ | ? *')
    if name.endswith((".", " ")):
        raise OrgError("Un nom ne peut pas se terminer par un point ou une espace.")
    if name.split(".")[0].lower() in _RESERVED:
        raise OrgError("Nom réservé par Windows.")
    return name


def _unique(dest_dir, name):
    """`name` s'il est libre dans dest_dir, sinon « nom (2).ext », « nom (3).ext »…"""
    cand = os.path.join(dest_dir, name)
    if not os.path.lexists(cand):
        return cand
    stem, ext = os.path.splitext(name) if not os.path.isdir(cand) else (name, "")
    i = 2
    while True:
        cand = os.path.join(dest_dir, f"{stem} ({i}){ext}")
        if not os.path.lexists(cand):
            return cand
        i += 1


def _is_inside(child, parent):
    c, p = _real(child), _real(parent)
    return c == p or c.startswith(p.rstrip("\\/") + os.sep)


# ----------------------------------------------------------------------------- annulation
def _push(label, steps):
    with _lock:
        _UNDO.append({"label": label, "steps": steps})
        del _UNDO[:-60]


def undo_info():
    with _lock:
        return _UNDO[-1]["label"] if _UNDO else None


def undo():
    """Annule la dernière action réversible. Retourne le libellé annulé."""
    with _lock:
        if not _UNDO:
            raise OrgError("Rien à annuler.")
        act = _UNDO.pop()
    errors = 0
    for op, a, b in reversed(act["steps"]):
        try:
            if op == "move":                                  # a (état actuel) -> b (ancien emplacement)
                if os.path.lexists(a):
                    os.makedirs(os.path.dirname(b), exist_ok=True)
                    shutil.move(a, _unique(os.path.dirname(b), os.path.basename(b)) if os.path.lexists(b) else b)
            elif op == "mkdir":
                os.makedirs(a, exist_ok=True)
            elif op == "rmdir":
                if os.path.isdir(a) and not os.listdir(a):
                    os.rmdir(a)
            elif op == "trash":
                if os.path.lexists(a):
                    _recycle(a)
        except (OSError, OrgError) as e:
            errors += 1
            log.warning("Annulation partielle (%s) : %s", op, e)
    if errors:
        raise OrgError(f"Annulation partielle : {errors} élément(s) n'ont pas pu être restaurés.")
    return act["label"]


# ----------------------------------------------------------------------------- lecture
def _hidden(attrs):
    return bool(attrs & 0x2) or bool(attrs & 0x4)            # HIDDEN | SYSTEM


def list_dir(path, show_hidden=False):
    path = _check(path)
    if not os.path.isdir(path):
        raise OrgError("Dossier introuvable.")
    hit = _root_of(path)
    root = hit[0]
    entries, truncated = [], False
    try:
        with os.scandir(path) as it:
            for e in it:
                if len(entries) >= MAX_ENTRIES:
                    truncated = True
                    break
                try:
                    st = e.stat(follow_symlinks=False)
                    attrs = getattr(st, "st_file_attributes", 0)
                    if not show_hidden and (_hidden(attrs) or e.name.lower() == "desktop.ini"):
                        continue
                    link = bool(attrs & 0x400) or e.is_symlink()           # point d'analyse (jonction / lien)
                    is_dir = e.is_dir(follow_symlinks=False) or (link and e.is_dir())
                    entries.append({"name": e.name, "dir": is_dir, "size": 0 if is_dir else st.st_size, "mtime": int(st.st_mtime),
                                    "link": link, "ext": "" if is_dir else os.path.splitext(e.name)[1].lower()})
                except OSError:
                    continue
    except PermissionError:
        raise OrgError("Accès refusé à ce dossier.")
    except OSError as e:
        raise OrgError(f"Lecture impossible : {e.strerror or e}")
    crumbs, cur = [], os.path.abspath(path)
    rootn = os.path.abspath(root)
    while True:
        crumbs.append({"name": os.path.basename(cur.rstrip("\\/")) or cur, "path": cur})
        if _norm(cur) == _norm(rootn) or os.path.dirname(cur) == cur:
            break
        cur = os.path.dirname(cur)
    crumbs.reverse()
    return {"path": os.path.abspath(path), "root": rootn, "crumbs": crumbs, "entries": entries, "truncated": truncated,
            "is_root": _norm(path) == _norm(rootn), "undo": undo_info()}


# ----------------------------------------------------------------------------- création / renommage
def mkdir(parent, name):
    parent = _check(parent)
    name = _valid_name(name)
    target = os.path.join(parent, name)
    if os.path.lexists(target):
        raise OrgError(f"« {name} » existe déjà ici.")
    try:
        os.mkdir(target)
    except OSError as e:
        raise OrgError(f"Création impossible : {e.strerror or e}")
    _push(f"Création du dossier « {name} »", [("rmdir", target, None)])
    return {"path": target, "name": name}


def newfile(parent, name):
    parent = _check(parent)
    name = _valid_name(name)
    target = os.path.join(parent, name)
    if os.path.lexists(target):
        raise OrgError(f"« {name} » existe déjà ici.")
    try:
        open(target, "x").close()
    except OSError as e:
        raise OrgError(f"Création impossible : {e.strerror or e}")
    _push(f"Création du fichier « {name} »", [("trash", target, None)])
    return {"path": target, "name": name}


def rename(path, new_name):
    path = _check(path, allow_root=False)
    new_name = _valid_name(new_name)
    if not os.path.lexists(path):
        raise OrgError("Élément introuvable.")
    target = os.path.join(os.path.dirname(path), new_name)
    if os.path.basename(path) == new_name:
        return {"path": path, "name": new_name}
    if os.path.lexists(target) and _norm(target) != _norm(path):
        raise OrgError(f"« {new_name} » existe déjà ici.")
    try:
        os.rename(path, target)
    except OSError as e:
        raise OrgError(f"Renommage impossible : {e.strerror or e}")
    _push(f"Renommage de « {os.path.basename(path)} »", [("move", target, path)])
    return {"path": target, "name": new_name}


# ----------------------------------------------------------------------------- renommage par modèle (lots)
def _strip_accents(t):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn")


def _title(t):
    return re.sub(r"[A-Za-zÀ-ÿ0-9]+", lambda m: m.group(0)[:1].upper() + m.group(0)[1:].lower(), t)


def rename_plan(paths, opts):
    """Aperçu d'un renommage par modèle. opts : pattern ({name} {n} {date} {datetime} {year} {month} {parent}), find / replace / regex,
    case (none|lower|upper|title), spaces (keep|underscore|dash|remove), accents (bool), start / step / pad, order (selection|name|mtime|size), keep_ext.
    Retourne [{path, old, new, changed, error}] ; rien n'est modifié."""
    if not paths or len(paths) > 5000:
        raise OrgError("Sélection vide ou trop grande (5 000 éléments maximum).")
    opts = opts or {}
    pattern = str(opts.get("pattern") or "{name}")[:200]
    find, repl = str(opts.get("find") or "")[:200], str(opts.get("replace") or "")[:200]
    rx = None
    if find and opts.get("regex"):
        try:
            rx = re.compile(find)
        except re.error as e:
            raise OrgError(f"Expression régulière invalide : {e}")
    case, spaces = opts.get("case") or "none", opts.get("spaces") or "keep"
    if case not in ("none", "lower", "upper", "title") or spaces not in ("keep", "underscore", "dash", "remove"):
        raise OrgError("Option inconnue.")
    try:
        start, step = int(opts.get("start", 1)), int(opts.get("step", 1))
        pad = max(0, min(int(opts.get("pad", 0)), 8))
    except (TypeError, ValueError):
        raise OrgError("Numérotation invalide.")
    checked = [_check(p, allow_root=False) for p in paths]
    for p in checked:
        if not os.path.lexists(p):
            raise OrgError(f"Introuvable : {os.path.basename(p)}")
    order = opts.get("order") or "selection"
    if order == "name":
        checked.sort(key=lambda p: os.path.basename(p).lower())
    elif order == "mtime":
        checked.sort(key=lambda p: os.path.getmtime(p))
    elif order == "size":
        checked.sort(key=lambda p: os.path.getsize(p) if os.path.isfile(p) else 0)
    width = pad or len(str(start + step * (len(checked) - 1)))
    keep_ext = opts.get("keep_ext", True)
    plan = []
    for i, p in enumerate(checked):
        base = os.path.basename(p)
        isdir = os.path.isdir(p)
        stem, ext = (base, "") if (isdir or not keep_ext) else os.path.splitext(base)
        if find:
            stem = rx.sub(repl, stem) if rx else stem.replace(find, repl)
        ts = time.localtime(os.path.getmtime(p))
        n = str(start + step * i).zfill(width)
        stem = (pattern.replace("{name}", stem).replace("{n}", n).replace("{datetime}", time.strftime("%Y-%m-%d_%H%M", ts)).replace("{date}", time.strftime("%Y-%m-%d", ts))
                .replace("{year}", time.strftime("%Y", ts)).replace("{month}", time.strftime("%m", ts)).replace("{parent}", os.path.basename(os.path.dirname(p))))
        if opts.get("accents"):
            stem, ext = _strip_accents(stem), _strip_accents(ext)
        stem = {"underscore": lambda t: re.sub(r"\s+", "_", t), "dash": lambda t: re.sub(r"\s+", "-", t), "remove": lambda t: re.sub(r"\s+", "", t)}.get(spaces, lambda t: t)(stem)
        stem = {"lower": str.lower, "upper": str.upper, "title": _title}.get(case, lambda t: t)(stem)
        new = stem.strip() + (ext.lower() if case == "lower" else ext)
        err = ""
        try:
            new = _valid_name(new)
        except OrgError as e:
            err = str(e)
        plan.append({"path": p, "old": base, "new": new, "changed": new != base, "error": err})
    # conflits : doublons dans le lot, ou nom déjà pris par un élément qui ne change pas
    leaving = {_norm(x["path"]) for x in plan if x["changed"]}
    seen = {}
    for x in plan:
        if x["error"] or not x["changed"]:
            if not x["error"]:
                seen[_norm(os.path.join(os.path.dirname(x["path"]), x["new"]))] = x
            continue
        target = _norm(os.path.join(os.path.dirname(x["path"]), x["new"]))
        if target in seen:
            x["error"] = "Ce nom est déjà donné à un autre élément du lot."
        elif os.path.lexists(target) and target not in leaving:
            x["error"] = "Un élément portant ce nom existe déjà ici."
        else:
            seen[target] = x
    return plan


def rename_batch(paths, opts):
    """Applique le plan (les éléments en conflit sont ignorés et signalés). Renommage en deux temps : permutations et cycles (a->b, b->a) sûrs.
    Annulable en une seule fois."""
    plan = rename_plan(paths, opts)
    todo = [x for x in plan if x["changed"] and not x["error"]]
    steps, done, fails = [], [], [{"name": x["old"], "message": x["error"]} for x in plan if x["error"]]
    staged = []
    try:
        for x in todo:
            tmp = os.path.join(os.path.dirname(x["path"]), f".enos-tmp-{os.getpid()}-{len(staged)}")
            os.rename(x["path"], tmp)
            steps.append(("move", tmp, x["path"]))
            staged.append((x, tmp))
        for x, tmp in staged:
            final = os.path.join(os.path.dirname(x["path"]), x["new"])
            os.rename(tmp, final)
            steps.append(("move", final, tmp))
            done.append({"old": x["old"], "new": x["new"]})
    except OSError as e:
        for op, a, b in reversed(steps):                      # échec en cours de route : on remet tout comme avant
            try:
                os.rename(a, b)
            except OSError:
                pass
        raise OrgError(f"Renommage interrompu et annulé : {e.strerror or e}")
    if done:
        _push(f"Renommage de {len(done)} élément{'s' if len(done) > 1 else ''}", steps)
    return {"done": done, "fails": fails}


# ----------------------------------------------------------------------------- déplacer / copier
def _transfer(paths, dest, copy):
    dest = _check(dest)
    if not os.path.isdir(dest):
        raise OrgError("Dossier de destination introuvable.")
    done, steps, fails = [], [], []
    for p in paths:
        try:
            src = _check(p, allow_root=False)
            if not os.path.lexists(src):
                raise OrgError("introuvable")
            name = os.path.basename(src)
            if os.path.isdir(src) and _is_inside(dest, src):
                raise OrgError("impossible de placer un dossier dans lui-même")
            if os.path.dirname(src) == os.path.abspath(dest) and not copy:
                continue                                                   # déjà là
            target = _unique(dest, name)
            if copy:
                if os.path.isdir(src) and not os.path.islink(src):
                    shutil.copytree(src, target, symlinks=True)
                else:
                    shutil.copy2(src, target)
                steps.append(("trash", target, None))
            else:
                shutil.move(src, target)
                steps.append(("move", target, src))
            done.append({"from": src, "to": target})
        except (OrgError, OSError, shutil.Error) as e:
            fails.append({"path": p, "message": f"{os.path.basename(str(p))} : {getattr(e, 'strerror', None) or e}"})
    if steps:
        n = len(steps)
        what = f"« {os.path.basename(done[0]['from'])} »" if n == 1 else f"{n} éléments"
        _push(("Copie de " if copy else "Déplacement de ") + what, steps)
    return {"done": done, "fails": fails}


def move(paths, dest):
    return _transfer(paths, dest, copy=False)


def copy(paths, dest):
    return _transfer(paths, dest, copy=True)


def group(paths, parent, name):
    """Crée le dossier `name` dans `parent` et y déplace la sélection (une seule action annulable)."""
    created = mkdir(parent, name)
    with _lock:
        mk = _UNDO.pop()                                                    # fusionné avec le déplacement
    res = _transfer(paths, created["path"], copy=False)
    with _lock:
        if _UNDO and _UNDO[-1]["steps"] is not None and res["done"]:
            last = _UNDO.pop()
            _UNDO.append({"label": f"Regroupement dans « {created['name']} »", "steps": mk["steps"] + last["steps"]})
        elif not res["done"]:
            _UNDO.append(mk)
    return {**res, "folder": created["path"]}


def extract(paths):
    """Extrait chaque élément vers le dossier parent de son dossier."""
    done, steps, fails = [], [], []
    for p in paths:
        try:
            src = _check(p, allow_root=False)
            parent = os.path.dirname(src)
            grand = os.path.dirname(parent)
            if _root_of(grand) is None or _real(parent) == (_root_of(parent) or ("", ""))[1]:
                raise OrgError("déjà au niveau le plus haut")
            target = _unique(grand, os.path.basename(src))
            shutil.move(src, target)
            steps.append(("move", target, src))
            done.append({"from": src, "to": target})
        except (OrgError, OSError, shutil.Error) as e:
            fails.append({"path": p, "message": f"{os.path.basename(str(p))} : {getattr(e, 'strerror', None) or e}"})
    if steps:
        _push(f"Extraction de {len(steps)} élément(s) vers le dossier parent", steps)
    return {"done": done, "fails": fails}


def flatten(path):
    """Aplatit un dossier : remonte tout son contenu d'un niveau puis supprime (Corbeille) le dossier vidé."""
    path = _check(path, allow_root=False)
    if not os.path.isdir(path):
        raise OrgError("Ce n'est pas un dossier.")
    names = [os.path.join(path, n) for n in os.listdir(path)]
    res = extract(names)
    if not res["fails"] and not os.listdir(path):
        os.rmdir(path)
        with _lock:
            if _UNDO:
                _UNDO[-1]["steps"].append(("mkdir", path, None))
                _UNDO[-1]["label"] = f"Dossier « {os.path.basename(path)} » aplati"
    return res


# ----------------------------------------------------------------------------- suppression
def _recycle(path):
    from nasko_cleaner import _recycle as _rc
    _rc(path)


def delete(paths):
    """Envoie à la Corbeille de Windows (réversible depuis la Corbeille)."""
    done, fails = [], []
    for p in paths:
        try:
            src = _check(p, allow_root=False)
            if not os.path.lexists(src):
                raise OrgError("introuvable")
            _recycle(src)
            done.append(src)
        except (OrgError, OSError) as e:
            fails.append({"path": p, "message": f"{os.path.basename(str(p))} : {getattr(e, 'strerror', None) or e}"})
    return {"done": done, "fails": fails}


# ----------------------------------------------------------------------------- import / ouverture
def import_into(dest, sources, move_them=False):
    """Copie (ou déplace) des fichiers/dossiers choisis dans le sélecteur natif vers `dest`."""
    dest = _check(dest)
    done, steps, fails = [], [], []
    for s in sources:
        try:
            if not os.path.lexists(s):
                raise OrgError("introuvable")
            target = _unique(dest, os.path.basename(s.rstrip("\\/")) or "dossier")
            if os.path.isdir(s):
                if _is_inside(dest, s):
                    raise OrgError("impossible d'importer un dossier dans lui-même")
                shutil.copytree(s, target, symlinks=True)
            else:
                shutil.copy2(s, target)
            steps.append(("trash", target, None))
            done.append({"from": s, "to": target})
        except (OrgError, OSError, shutil.Error) as e:
            fails.append({"path": s, "message": f"{os.path.basename(str(s))} : {getattr(e, 'strerror', None) or e}"})
    if steps:
        _push(f"Import de {len(steps)} élément(s)", steps)
    return {"done": done, "fails": fails}


_THUMB_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".tif", ".tiff"}
_THUMB_CACHE = {}             # (chemin réel, mtime, taille) -> octets PNG
_THUMB_MAX = 700


def thumbnail(path, size=256):
    """Miniature PNG (fond transparent conservé). Les petites images (tuiles, pixel art) sont agrandies en pixels nets."""
    path = _check(path)
    if os.path.splitext(path)[1].lower() not in _THUMB_EXT or not os.path.isfile(path):
        raise OrgError("Pas d'aperçu pour ce fichier.")
    size = max(32, min(int(size), 512))
    try:
        key = (_real(path), os.path.getmtime(path), size)
    except OSError:
        raise OrgError("Fichier introuvable.")
    with _lock:
        hit = _THUMB_CACHE.get(key)
    if hit:
        return hit
    try:
        from PIL import Image
        import io
        with Image.open(path) as im:
            im.draft("RGB", (size * 2, size * 2))
            im.load()
            im = im.convert("RGBA")
        w, h = im.size
        if max(w, h) < size:
            k = max(1, size // max(w, h))
            im = im.resize((w * k, h * k), Image.NEAREST)
        else:
            im.thumbnail((size, size), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "PNG", optimize=False)
        data = buf.getvalue()
    except Exception as e:                                       # fichier corrompu, trop gros, format exotique…
        raise OrgError(f"Aperçu impossible : {e}")
    with _lock:
        if len(_THUMB_CACHE) >= _THUMB_MAX:
            _THUMB_CACHE.pop(next(iter(_THUMB_CACHE)))
        _THUMB_CACHE[key] = data
    return data


def reveal(path):
    path = _check(path)
    if not os.path.lexists(path):
        raise OrgError("Élément introuvable.")
    subprocess.Popen(["explorer", "/select," + path] if not os.path.isdir(path) else ["explorer", path])


def open_item(path):
    """Ouvre un fichier avec son programme par défaut. Les programmes/scripts exécutables sont refusés (utiliser « Afficher dans l'Explorateur »)."""
    path = _check(path)
    if not os.path.isfile(path):
        raise OrgError("Fichier introuvable.")
    if os.path.splitext(path)[1].lower() in _NO_OPEN:
        raise OrgError("Programme ou script : ouverture bloquée par sécurité. Utilisez « Afficher dans l'Explorateur ».")
    os.startfile(path)


# ----------------------------------------------------------------------------- rangement automatique par type
def _category(name):
    ext = os.path.splitext(name)[1].lower()
    for cat, exts in CATEGORIES.items():
        if ext in exts:
            return cat
    return "Autres"


def autosort_plan(path):
    """Aperçu : {catégorie: [noms]} des fichiers directement présents dans `path` (les dossiers ne sont pas touchés)."""
    path = _check(path)
    plan = {}
    try:
        for e in os.scandir(path):
            if e.is_file(follow_symlinks=False) and not _hidden(getattr(e.stat(follow_symlinks=False), "st_file_attributes", 0)) and e.name.lower() != "desktop.ini":
                plan.setdefault(_category(e.name), []).append(e.name)
    except OSError as e:
        raise OrgError(f"Lecture impossible : {e.strerror or e}")
    return plan


def autosort(path):
    path = _check(path)
    plan = autosort_plan(path)
    steps, n = [], 0
    for cat, names in plan.items():
        sub = os.path.join(path, cat)
        if os.path.lexists(sub) and not os.path.isdir(sub):
            continue
        created = not os.path.isdir(sub)
        if created:
            os.mkdir(sub)
            steps.append(("rmdir", sub, None))
        for nm in names:
            try:
                target = _unique(sub, nm)
                shutil.move(os.path.join(path, nm), target)
                steps.append(("move", target, os.path.join(path, nm)))
                n += 1
            except OSError as e:
                log.warning("Rangement auto : %s (%s)", nm, e)
    if steps:
        _push(f"Rangement automatique de {n} fichier(s)", steps)
    return {"moved": n, "folders": len(plan)}


_load_granted()
