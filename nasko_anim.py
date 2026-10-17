"""Visualiseur d'animation : explorateur de dossiers borne a « Binageux » / « Jeu Projet » et tri numerique des frames."""
import os
import re

import nasko_imagefactory

IMG_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp")
NUM_RE = re.compile(r"\d+")
MAX_FRAMES = 1000


def roots():
    """Points de depart de l'explorateur : les raccourcis de livraison (Binageux, Jeu Projet)."""
    return [{"key": d["key"], "label": d["label"], "path": d["path"], "ok": d["ok"]} for d in nasko_imagefactory.destinations()]


def _real(p):
    return os.path.normcase(os.path.realpath(p))


def _root_of(path):
    """Racine autorisee qui contient `path` (liens symboliques resolus), sinon None."""
    rp = _real(path)
    for r in roots():
        if not r["ok"]:
            continue
        rr = _real(r["path"])
        if rp == rr or rp.startswith(rr + os.sep):
            return r
    return None


def _checked(path):
    path = os.path.abspath((path or "").strip().strip('"'))
    root = _root_of(path)
    if root is None:
        raise PermissionError("dossier hors de Binageux / Jeu Projet")
    if not os.path.isdir(path):
        raise FileNotFoundError("dossier introuvable : " + path)
    return path, root


def _images(path):
    out = []
    for n in os.listdir(path):
        p = os.path.join(path, n)
        if n.lower().endswith(IMG_EXTS) and os.path.isfile(p):
            out.append(n)
    return out


def browse(path):
    """Contenu d'un dossier : sous-dossiers (avec nombre d'images) ; aucune validation implicite."""
    path, root = _checked(path)
    dirs = []
    try:
        entries = sorted(os.listdir(path), key=str.lower)
    except OSError as e:
        raise PermissionError(str(e))
    for n in entries:
        p = os.path.join(path, n)
        if n.startswith(".") or not os.path.isdir(p):
            continue
        try:
            imgs = len(_images(p))
        except OSError:
            continue                                         # dossier illisible : ignore
        dirs.append({"name": n, "path": p, "images": imgs})
    at_root = _real(path) == _real(root["path"])
    return {"path": path, "root": root["label"], "root_path": root["path"], "parent": None if at_root else os.path.dirname(path),
            "dirs": dirs, "images": len(_images(path))}


def number_key(name):
    """Cle de tri : uniquement les nombres du nom (b7.png -> (7,), sprite_12.png -> (12,), a2_f10 -> (2, 10))."""
    return tuple(int(x) for x in NUM_RE.findall(os.path.splitext(name)[0]))


def frames(path):
    """Images du dossier triees du plus petit au plus grand nombre present dans leur nom.
    Les fichiers sans aucun nombre ne peuvent pas etre ordonnes : ils sont ecartes (compteur `ignored`)."""
    path, _ = _checked(path)
    names = _images(path)
    numbered = [n for n in names if NUM_RE.search(os.path.splitext(n)[0])]
    numbered.sort(key=lambda n: (number_key(n), n.lower()))
    return {"path": path, "frames": [{"name": n, "key": list(number_key(n))} for n in numbered[:MAX_FRAMES]],
            "ignored": len(names) - len(numbered), "truncated": len(numbered) > MAX_FRAMES}


def frame_file(path, name):
    path, _ = _checked(path)
    if name != os.path.basename(name) or not name.lower().endswith(IMG_EXTS):
        raise ValueError("nom invalide")
    p = os.path.join(path, name)
    if not os.path.isfile(p):
        raise FileNotFoundError(name)
    return p
