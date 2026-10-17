"""Usine de traitement d'image : surveillance des dossiers, orchestration PhotoRoom/Sprite Slicer, colis et livraison."""
import base64
import json
import io
import os
import random
import re
import shutil
import threading
import time
import uuid
import zipfile

from nasko_core import app_dir, load_config

ROOT = os.path.join(app_dir(), "Traitement d'image")
CATS = {"simple": "Image Simple", "multiple": "Image Multiple"}
SUB = {"todo": "A faire", "store": "Stockage", "out": "Livraison"}
PENDING = os.path.join(ROOT, "Colis en attente")
DELIVERED = os.path.join(ROOT, "Colis livrés")
SCRATCH = os.path.join(ROOT, ".tmp")
EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp")
IMG_OUT = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp")

TASK_RE = re.compile(r"^Tâche (\d+)$")
COLIS_RE = re.compile(r"^Colis (\d+)\.zip$", re.I)

lock = threading.Lock()
STATE = {"busy": False, "cat": "", "name": "", "stage": "", "progress": 0, "error": "", "done": 0, "log": [], "redirect": None, "jobs": {}}
def _max_par():
    try:
        return max(1, min(3, int(load_config().get("imgproc_parallel", 1))))
    except (TypeError, ValueError):
        return 1


MAX_PAR = _max_par()      # traitements simultanés : 1 = FILE STRICTE (une image à la fois, validée avant la suivante) ; réglable : « imgproc_parallel » (1 à 3) dans nasko_config.json
_SLOTS = threading.BoundedSemaphore(MAX_PAR)
HUMAN_PAUSE = (2.0, 5.0)  # délai aléatoire (secondes) entre deux images : temps de réaction humain, et charge raisonnable sur le site
_active = set()           # fichiers en cours de traitement
_task_lock = threading.Lock()
_ctx = threading.local()  # identifiant du traitement du thread courant (route _progress vers le bon suivi)
MANIFEST = ".source.json"  # dans chaque tâche : nom de l'original archive dans Stockage
_failed = {}            # chemin -> mtime deja en echec (evite la boucle de relance)
_thumbs = {}


def _sync_summary():
    """Résumé global pour l'interface (verrou `lock` déjà pris) : 1 traitement = ses détails ; plusieurs = moyenne."""
    jobs = list(STATE["jobs"].values())
    STATE["busy"] = bool(jobs)
    if not jobs:
        return
    STATE["cat"] = jobs[0]["cat"]
    STATE["name"] = jobs[0]["name"] if len(jobs) == 1 else f"{len(jobs)} images en parallèle"
    STATE["stage"] = jobs[0]["stage"] if len(jobs) == 1 else " · ".join(j["name"][:18] for j in jobs[:3])
    STATE["progress"] = round(sum(j["progress"] for j in jobs) / len(jobs))


def _job_begin(cat, name):
    jid = uuid.uuid4().hex[:6]
    _ctx.jid = jid
    with lock:
        STATE["jobs"][jid] = {"id": jid, "cat": cat, "name": name, "stage": "Préparation…", "progress": 1, "t": time.time()}
        STATE.update(error="", redirect=None)
        _sync_summary()
    return jid


def _job_end(jid):
    with lock:
        STATE["jobs"].pop(jid, None)
        _sync_summary()
    _ctx.jid = None


def _log(msg):
    with lock:
        STATE["log"] = (STATE["log"] + [time.strftime("%H:%M:%S ") + msg])[-30:]


def _dir(cat, sub):
    """Dossier existant retrouve sans tenir compte de la casse (ex. « Image simple » deja present), sinon cree."""
    parent = ROOT
    for want in (CATS[cat], SUB[sub]):
        os.makedirs(parent, exist_ok=True)
        match = next((n for n in os.listdir(parent) if n.lower() == want.lower() and os.path.isdir(os.path.join(parent, n))), want)
        parent = os.path.join(parent, match)
    os.makedirs(parent, exist_ok=True)
    return parent


def ensure_tree():
    for cat in CATS:
        for sub in SUB:
            _dir(cat, sub)
    os.makedirs(PENDING, exist_ok=True)
    os.makedirs(DELIVERED, exist_ok=True)
    for cat in CATS:                          # fichiers en vrac (ancien format) : regroupes dans une nouvelle tâche
        out = _dir(cat, "out")
        loose = [n for n in os.listdir(out) if os.path.isfile(os.path.join(out, n)) and n.lower().endswith(IMG_OUT)]
        if loose:
            t = new_task(cat)
            for n in loose:
                shutil.move(os.path.join(out, n), os.path.join(t, n))


def _unique(folder, name):
    base, ext = os.path.splitext(name)
    out, n = os.path.join(folder, name), 1
    while os.path.exists(out):
        out = os.path.join(folder, f"{base}_{n}{ext}")
        n += 1
    return out


def _task_dir(cat, task):
    if not TASK_RE.match(task or ""):
        raise ValueError("tâche invalide")
    p = os.path.join(_dir(cat, "out"), task)
    if not os.path.isdir(p):
        raise FileNotFoundError(task)
    return p


def new_task(cat):
    """Crée le sous-dossier « Tâche N » suivant dans Livraison (N = plus grand numéro existant + 1 ; 1 si le dossier est vide)."""
    with _task_lock:                                          # deux traitements simultanés ne doivent pas obtenir le même numéro
        out = _dir(cat, "out")
        nums = [int(m.group(1)) for n in os.listdir(out) if (m := TASK_RE.match(n)) and os.path.isdir(os.path.join(out, n))]
        path = os.path.join(out, f"Tâche {max(nums, default=0) + 1}")
        os.makedirs(path)
        return path


def _safe_name(cat, task, name):
    """Fichier d'une tâche (anti-traversee de chemin)."""
    if name != os.path.basename(name) or not name:
        raise ValueError("nom invalide")
    p = os.path.join(_task_dir(cat, task), name)
    if not os.path.isfile(p):
        raise FileNotFoundError(name)
    return p


# ----------------------------------------------------------------------------- traitement
def _pending(cat):
    out = []                                                         # ordre d'ARRIVÉE (FIFO) : la plus ancienne image d'abord
    held = _pack_missing().get(cat, set())                           # images en attente de « Réparer » : jamais retraitées toutes seules
    def _age(n):
        try:
            return (os.path.getmtime(os.path.join(_dir(cat, "todo"), n)), n.lower())
        except OSError:
            return (0.0, n.lower())
    for n in sorted(os.listdir(_dir(cat, "todo")), key=_age):
        p = os.path.join(_dir(cat, "todo"), n)
        if n.lower().endswith(EXTS) and os.path.isfile(p) and p not in _reserved and n.lower() not in held:
            try:
                m = os.path.getmtime(p)
                if time.time() - m < 2 or _failed.get(p) == m:      # fichier en cours de copie, ou deja en echec
                    continue
            except OSError:
                continue
            out.append(p)
    return out


def _extract_zip(zpath, dest):
    n = 0
    with zipfile.ZipFile(zpath) as z:
        for info in z.infolist():
            leaf = os.path.basename(info.filename)
            if info.is_dir() or not leaf.lower().endswith(IMG_OUT):
                continue
            with z.open(info) as src, open(_unique(dest, leaf), "wb") as dst:
                shutil.copyfileobj(src, dst)
            n += 1
    return n


def _progress(label, pct):
    jid = getattr(_ctx, "jid", None)
    with lock:
        if jid in STATE["jobs"]:
            STATE["jobs"][jid].update(stage=label, progress=pct)
        _sync_summary()


def _validate_outputs(folder):
    """Vérifie PHYSIQUEMENT les fichiers générés : présents, non vides, images lisibles. Lève ValueError sinon. Retourne leur nombre."""
    imgs = _images(folder)
    if not imgs:
        raise ValueError("aucun fichier image n'a été généré")
    try:
        from PIL import Image
    except ImportError:
        Image = None
    for n in imgs:
        p = os.path.join(folder, n)
        if not os.path.isfile(p) or os.path.getsize(p) <= 0:
            raise ValueError(f"« {n} » est absent ou vide sur le disque")
        if Image is not None:
            try:
                with Image.open(p) as im:
                    im.verify()
            except Exception as e:                                   # noqa: BLE001
                raise ValueError(f"« {n} » est corrompu ({e.__class__.__name__})")
    return len(imgs)


def _archive_source(path, store, out_dir):
    """Range l'original dans Stockage. Sous OneDrive le déplacement peut échouer un instant (fichier verrouillé) : on réessaie.
    Si cela échoue quand même, les tuiles déjà validées sont CONSERVÉES (jamais détruites pour un simple problème d'archivage)."""
    name = os.path.basename(path)
    for i in range(5):
        try:
            _write_source(out_dir, os.path.basename(shutil.move(path, _unique(store, name))))
            return
        except OSError as e:
            if not os.path.exists(path):
                return
            time.sleep(1 + i)
            last = e
    _failed[path] = os.path.getmtime(path) if os.path.exists(path) else 0       # ne sera pas retraité en boucle
    _log(f"Original « {name} » non archivé ({last.__class__.__name__}) : résultat conservé")


def _process(cat, path, final=True):
    """Traite UNE image. Retourne le nom de la « Tâche N » créée, ou None (message dans `_ctx.err`).
    final=False : un échec n'est pas définitif (l'appelant réessaiera) -> l'image n'est pas marquée en échec."""
    _ctx.err = ""
    name = os.path.basename(path)
    jid = out_dir = None
    scratch = os.path.join(SCRATCH, uuid.uuid4().hex[:8])
    try:                                                      # TOUT est dans le try : plus aucune étape ne peut tuer le thread en silence
        import nasko_webauto
        jid = _job_begin(cat, name)
        _log(f"Début : {name} ({CATS[cat]})")
        store = _dir(cat, "store")
        out_dir = new_task(cat)                               # chaque image originale = une nouvelle « Tâche N »
        res = nasko_webauto.run(cat, path, out_dir, scratch, _progress, fresh=True)
        _progress("Réception du colis…", 96)
        if cat == "multiple":
            n = _extract_zip(res, out_dir)
            if not n:
                raise nasko_webauto.AutomationError("Le ZIP de Sprite Slicer ne contient aucune image.")
        _progress("Vérification des fichiers sur le disque…", 98)
        n = _validate_outputs(out_dir)
        _log(f"{n} fichier(s) vérifiés dans {os.path.basename(out_dir)}")
        _archive_source(path, store, out_dir)                # l'original est archivé seulement après succès VÉRIFIÉ
        _progress("Terminé", 100)
        with lock:
            STATE["done"] += 1
        time.sleep(0.8)
        return os.path.basename(out_dir)
    except Exception as e:
        msg = str(e) or e.__class__.__name__
        _ctx.err = msg
        if final:
            _failed[path] = os.path.getmtime(path) if os.path.exists(path) else 0
        if out_dir:
            shutil.rmtree(out_dir, ignore_errors=True)        # pas de dossier de tâche à moitié rempli
        with lock:
            STATE["error"] = msg
        _log("ÉCHEC : " + msg)
        return None
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
        if jid:
            _job_end(jid)


def _write_source(task_path, stored_name):
    try:
        with open(os.path.join(task_path, MANIFEST), "w", encoding="utf-8") as f:
            json.dump({"source": stored_name}, f, ensure_ascii=False)
    except OSError:
        pass


def _find_source(cat, task_path):
    """Original archivé d'une tâche : via le manifeste, sinon fichier de Stockage de même nom (sans extension)."""
    store = _dir(cat, "store")
    try:
        with open(os.path.join(task_path, MANIFEST), encoding="utf-8") as f:
            name = json.load(f).get("source", "")
        if name and os.path.isfile(os.path.join(store, name)):
            return os.path.join(store, name)
    except (OSError, ValueError):
        pass
    for img in _images(task_path):
        stem = os.path.splitext(img)[0]
        for n in os.listdir(store):
            if os.path.splitext(n)[0] == stem and os.path.isfile(os.path.join(store, n)):
                return os.path.join(store, n)
    return None


def _convert(task):
    """Simple -> Multiple : PNG deja detoure -> Sprite Slicer (PhotoRoom contourne) -> nouvelle tâche Multiple ;
    la tâche d'erreur et l'original sont migrés/supprimes seulement apres reussite."""
    import nasko_webauto
    src_task = _task_dir("simple", task)
    png = os.path.join(src_task, _images(src_task)[0]) if _images(src_task) else None
    jid = _job_begin("multiple", task)
    _log(f"Conversion Simple → Multiple : {task}")
    new_path, scratch = None, os.path.join(SCRATCH, "conv" + uuid.uuid4().hex[:8])
    try:
        if not png:
            raise nasko_webauto.AutomationError(f"{task} ne contient aucune image à découper.")
        zpath = nasko_webauto.run("slice", png, None, scratch, _progress, fresh=True)
        _progress("Réception des tuiles…", 98)
        new_path = new_task("multiple")
        n = _extract_zip(zpath, new_path)
        if not n:
            raise nasko_webauto.AutomationError("Le ZIP de Sprite Slicer ne contient aucune image.")
        src = _find_source("simple", src_task)
        if src:                                              # archivage cohérent : l'original rejoint Image Multiple/Stockage
            stored = shutil.move(src, _unique(_dir("multiple", "store"), os.path.basename(src)))
            _write_source(new_path, os.path.basename(stored))
        else:
            _log("Original introuvable dans Image Simple/Stockage : non déplacé")
        shutil.rmtree(src_task)                              # la tâche d'erreur disparait
        _log(f"{n} tuiles placées dans {os.path.basename(new_path)} (Image Multiple) ; {task} supprimée")
        with lock:
            STATE["redirect"] = {"cat": "multiple", "task": os.path.basename(new_path)}
            STATE["done"] += 1
        _progress("Terminé", 100)
        _notify(True, task)
        time.sleep(0.8)
    except Exception as e:
        if new_path:
            shutil.rmtree(new_path, ignore_errors=True)       # rien de laisse a moitie : la tâche Simple reste intacte
        with lock:
            STATE["error"] = str(e) or e.__class__.__name__
        _log("ÉCHEC : " + STATE["error"])
        _notify(False, task, STATE["error"])
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
        _job_end(jid)
        _SLOTS.release()


def _notify(ok, name, detail=""):
    try:
        import nasko_notify
        nasko_notify.task_done("image", name, ok, detail)
    except Exception:                                                # noqa: BLE001 — jamais bloquant
        pass


def convert_to_multiple(task):
    """Lance la conversion en arrière-plan (suivie via state()). Lève RuntimeError si un traitement est déjà en cours."""
    _task_dir("simple", task)                                 # valide le nom et l'existence
    if not _SLOTS.acquire(blocking=False):
        raise RuntimeError(f"{MAX_PAR} traitements sont déjà en cours : réessayez dans un instant.")
    threading.Thread(target=_convert, args=(task,), daemon=True, name="imgconvert").start()


def _run_job(cat, path):
    task = None
    try:
        task = _process(cat, path)
    finally:
        _batch_done(path, task)
        _active.discard(path)
        time.sleep(random.uniform(*HUMAN_PAUSE))                     # respiration AVANT de libérer la place : l'image suivante ne démarre pas à la chaîne
        _SLOTS.release()


def _loop():
    """Surveille « A faire » et lance un traitement par image, jusqu'à MAX_PAR en parallèle (chacun sur son thread)."""
    while True:
        try:
            ensure_tree()
            for cat in CATS:
                for p in _pending(cat):
                    if p in _active:
                        continue
                    if not _SLOTS.acquire(blocking=False):            # tous les emplacements sont occupés : les autres images attendent
                        break
                    _active.add(p)
                    threading.Thread(target=_run_job, args=(cat, p), daemon=True, name="imgjob").start()
        except Exception as e:
            _log("Surveillance : " + str(e)[:120])
        time.sleep(2)


def start():
    ensure_tree()
    threading.Thread(target=_loop, daemon=True, name="imagefactory").start()


def retry():
    _failed.clear()
    with lock:
        STATE["error"] = ""


def state():
    with lock:
        s = dict(STATE, log=list(STATE["log"]), jobs=[dict(j) for j in STATE["jobs"].values()])
    s["todo"] = {c: len(_pending(c)) for c in CATS}
    s["todo_all"] = {c: len([n for n in os.listdir(_dir(c, "todo")) if n.lower().endswith(EXTS)]) for c in CATS}
    s["batch"] = _ready_batch()
    s["queue"] = queue_state()
    return s


# ----------------------------------------------------------------------------- galerie / nettoyage
def _thumb(p):
    key = (p, os.path.getmtime(p))
    if key not in _thumbs:
        try:
            from PIL import Image
            with Image.open(p) as im:
                im = im.convert("RGBA")
                im.thumbnail((144, 144), Image.NEAREST)           # NEAREST : le pixel art reste net
                buf = io.BytesIO()
                im.save(buf, "PNG")
            _thumbs[key] = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
        except Exception:
            _thumbs[key] = ""
    return _thumbs[key]


def _images(d):
    return sorted((n for n in os.listdir(d) if os.path.isfile(os.path.join(d, n)) and n.lower().endswith(IMG_OUT)), key=str.lower)


def tasks(cat):
    """Dossiers « Tâche N » de Livraison (ordre croissant) avec nombre de fichiers et quelques miniatures."""
    out, res = _dir(cat, "out"), []
    for n in os.listdir(out):
        m, p = TASK_RE.match(n), os.path.join(out, n)
        if m and os.path.isdir(p):
            imgs = _images(p)
            res.append({"name": n, "n": int(m.group(1)), "count": len(imgs),
                        "previews": [_thumb(os.path.join(p, i)) for i in imgs[:4]], "t": os.path.getmtime(p)})
    return sorted(res, key=lambda t: t["n"])


def files(cat, task):
    d = _task_dir(cat, task)
    return [{"name": n, "thumb": _thumb(os.path.join(d, n)), "size": os.path.getsize(os.path.join(d, n))} for n in _images(d)[:600]]


def clean(cat):
    d, n = _dir(cat, "out"), 0
    for name in os.listdir(d):
        p = os.path.join(d, name)
        try:
            shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
            n += 1
        except OSError:
            pass
    return n


def open_folder(cat, sub):
    os.startfile(_dir(cat, sub) if cat in CATS else ROOT)


# ----------------------------------------------------------------------------- colis
def _colis_name():
    """Nommage séquentiel : « Colis N.zip », N = plus grand numéro présent dans les colis en attente + 1."""
    nums = [int(m.group(1)) for n in os.listdir(PENDING) if (m := COLIS_RE.match(n))]
    return f"Colis {max(nums, default=0) + 1}.zip"


def make_colis(cat, task, names):
    paths = [_safe_name(cat, task, n) for n in dict.fromkeys(names)]
    if not paths:
        raise ValueError("aucune tuile sélectionnée")
    os.makedirs(PENDING, exist_ok=True)
    name = _colis_name()
    with zipfile.ZipFile(os.path.join(PENDING, name), "w", zipfile.ZIP_DEFLATED) as z:
        for p in paths:
            z.write(p, os.path.basename(p))
    return {"name": name, "count": len(paths)}


def make_colis_tasks(cat, task_names):
    """Un seul colis regroupant TOUTES les images de plusieurs tâches (à plat ; un nom déjà pris reçoit un suffixe _1, _2…)."""
    paths = []
    for t in dict.fromkeys(task_names):
        d = _task_dir(cat, t)
        paths += [os.path.join(d, n) for n in _images(d)]
    if not paths:
        raise ValueError("les tâches sélectionnées sont vides")
    os.makedirs(PENDING, exist_ok=True)
    name, used = _colis_name(), set()
    with zipfile.ZipFile(os.path.join(PENDING, name), "w", zipfile.ZIP_DEFLATED) as z:
        for p in paths:
            base, ext = os.path.splitext(os.path.basename(p))
            arc, k = base + ext, 1
            while arc.lower() in used:
                arc = f"{base}_{k}{ext}"
                k += 1
            used.add(arc.lower())
            z.write(p, arc)
    return {"name": name, "count": len(paths), "tasks": len(dict.fromkeys(task_names))}


def list_colis(details=False):
    """Colis .zip en attente. `details` ajoute la liste des fichiers contenus (nom + poids) pour le gestionnaire."""
    os.makedirs(PENDING, exist_ok=True)
    out = []
    for n in os.listdir(PENDING):
        p = os.path.join(PENDING, n)
        if n.lower().endswith(".zip") and os.path.isfile(p):
            try:
                with zipfile.ZipFile(p) as z:
                    infos = [i for i in z.infolist() if not i.is_dir()]
            except zipfile.BadZipFile:
                continue
            item = {"name": n, "count": len(infos), "size": os.path.getsize(p), "t": os.path.getmtime(p)}
            if details:
                item["files"] = [{"name": os.path.basename(i.filename), "size": i.file_size} for i in infos[:300]]
                item["unpacked"] = sum(i.file_size for i in infos)
            out.append(item)
    return sorted(out, key=lambda c: -c["t"])


_WIN_RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}
_BAD_CHARS = set('<>:"/' + chr(92) + '|?*')               # + caracteres de controle (code < 32)


def rename_colis(old, new):
    """Renomme physiquement un colis en attente. L'extension .zip est toujours conservée (jamais doublée)."""
    src = os.path.join(PENDING, old)
    if old != os.path.basename(old) or not old.lower().endswith(".zip") or not os.path.isfile(src):
        raise FileNotFoundError("colis introuvable")
    base = (new or "").strip()
    while base.lower().endswith(".zip"):                      # « Run.zip » ou « Run.zip.zip » -> « Run » : jamais .zip.zip
        base = base[:-4].rstrip()
    base = base.strip().rstrip(". ")
    if not base:
        raise ValueError("le nom ne peut pas être vide")
    if len(base) > 100:
        raise ValueError("nom trop long (100 caractères maximum)")
    if any(c in _BAD_CHARS or ord(c) < 32 for c in base):
        raise ValueError('caractères interdits : < > : " / ' + chr(92) + ' | ? *')
    if base.lower() in _WIN_RESERVED:
        raise ValueError("nom réservé par Windows")
    dst = os.path.join(PENDING, base + ".zip")
    if os.path.normcase(dst) == os.path.normcase(src):
        if dst == src:
            return {"name": old, "changed": False}
    elif os.path.exists(dst):
        raise FileExistsError(f"« {base}.zip » existe déjà")
    os.rename(src, dst)                                       # os.rename (et non replace) : jamais d'écrasement
    return {"name": base + ".zip", "changed": True}


def destinations():
    """Raccourcis stricts : « Binageux » (BIN A JEU) et « Jeu Projet ». Chemins surchargeables dans nasko_config.json."""
    cfg = load_config()
    docs = os.path.join(os.path.expanduser("~"), "OneDrive", "Documents")
    if not os.path.isdir(docs):
        docs = os.path.join(os.path.expanduser("~"), "Documents")
    jeu = (cfg.get("imgproc_dest_jeu") or cfg.get("project_dir") or os.path.join(docs, "Jeu Projet")).strip()
    bina = (cfg.get("imgproc_dest_binageux") or os.path.join(docs, "BIN A JEU")).strip()
    claude = (cfg.get("imgproc_dest_pourclaude") or os.path.join(app_dir(), "PourClaude")).strip()
    return [{"key": "pourclaude", "label": "PourClaude", "path": claude, "ok": os.path.isdir(claude)},
            {"key": "binageux", "label": "Binageux", "path": bina, "ok": os.path.isdir(bina)},
            {"key": "jeu", "label": "Jeu Projet", "path": jeu, "ok": os.path.isdir(jeu)}]


def deliver_zip(src, dest_path, folder_name=None):
    """Extrait un .zip dans un SOUS-DOSSIER de la destination (nom du colis, sans écraser). Retourne {count, dest, folder}."""
    dest = os.path.abspath(dest_path.strip().strip('"'))
    if not os.path.isdir(dest):
        raise FileNotFoundError("dossier de destination introuvable : " + dest)
    folder = _unique(dest, folder_name or os.path.splitext(os.path.basename(src))[0])
    os.makedirs(folder)
    n = 0
    with zipfile.ZipFile(src) as z:
        for info in z.infolist():
            leaf = os.path.basename(info.filename)               # extraction a plat dans ce dossier : pas de traversee de chemin possible
            if info.is_dir() or not leaf:
                continue
            with z.open(info) as s_, open(_unique(folder, leaf), "wb") as d_:
                shutil.copyfileobj(s_, d_)
            n += 1
    return {"count": n, "dest": dest, "folder": folder}


def deliver(colis, dest_path):
    src = os.path.join(PENDING, colis)
    if colis != os.path.basename(colis) or not os.path.isfile(src):
        raise FileNotFoundError("colis introuvable")
    res = deliver_zip(src, dest_path, os.path.splitext(colis)[0])
    os.makedirs(DELIVERED, exist_ok=True)
    shutil.move(src, _unique(DELIVERED, colis))
    return res


# ----------------------------------------------------------------------------- raccourci « Téléchargements » : images récentes, import en un clic
def downloads_dir():
    """Dossier Téléchargements de l'utilisateur (la vraie valeur Windows, pas seulement ~/Downloads : le dossier peut être déplacé)."""
    try:
        import ctypes
        from ctypes import wintypes
        buf = ctypes.create_unicode_buffer(1024)
        guid = (ctypes.c_ubyte * 16)(*bytes.fromhex("90e24d373f126545916439c4925e467b"))
        p = ctypes.c_wchar_p()
        if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(guid), 0, None, ctypes.byref(p)) == 0 and p.value and os.path.isdir(p.value):
            return p.value
    except Exception:                                                # noqa: BLE001
        pass
    d = os.path.join(os.path.expanduser("~"), "Downloads")
    return d if os.path.isdir(d) else ""


def list_downloads(limit=60):
    d = downloads_dir()
    if not d:
        return {"folder": "", "items": []}
    items = []
    for e in os.scandir(d):
        if e.is_file() and e.name.lower().endswith(EXTS):
            try:
                st = e.stat()
                items.append({"name": e.name, "size": st.st_size, "t": st.st_mtime})
            except OSError:
                pass
    items.sort(key=lambda x: -x["t"])
    items = items[:limit]
    for it in items:
        it["thumb"] = _thumb(os.path.join(d, it["name"]))
    return {"folder": d, "items": items}


def import_downloads(cat, names):
    """Copie les images choisies depuis Téléchargements vers « A faire » (les originaux restent en place) : le traitement démarre tout seul,
    en parallèle si plusieurs images."""
    d = downloads_dir()
    if not d:
        raise FileNotFoundError("Dossier Téléchargements introuvable.")
    dest = _dir(cat, "todo")
    n = 0
    for name in names[:40]:
        if name != os.path.basename(name) or not name.lower().endswith(EXTS):
            continue
        src = os.path.join(d, name)
        if os.path.isfile(src):
            tmp = os.path.join(dest, name + ".part")
            shutil.copy2(src, tmp)
            os.replace(tmp, _unique(dest, name))
            n += 1
    return n


def open_downloads():
    d = downloads_dir()
    if not d:
        raise FileNotFoundError("Dossier Téléchargements introuvable.")
    os.startfile(d)                                                   # noqa: S606 — dossier connu


# ----------------------------------------------------------------------------- import de dossier + lots (batch)
FOLDERS = os.path.join(ROOT, "Dossiers")      # Dossiers Principaux : Dossiers/<Principal>/<Sous-dossier>/<image>
BATCH_MAX = 500
_batches = {}                                  # id -> lot d'images importées depuis un dossier
_batch_of = {}                                 # chemin dans « A faire » -> id du lot


def _valid_name(raw, what="nom"):
    base = (raw or "").strip().rstrip(". ").strip()
    if not base:
        raise ValueError(f"le {what} ne peut pas être vide")
    if len(base) > 100:
        raise ValueError(f"{what} trop long (100 caractères maximum)")
    if any(c in _BAD_CHARS or ord(c) < 32 for c in base):
        raise ValueError('caractères interdits : < > : " / ' + chr(92) + ' | ? *')
    if base.lower() in _WIN_RESERVED:
        raise ValueError("nom réservé par Windows")
    return base


def import_folder(cat, folder):
    """Copie toutes les images d'un dossier (sous-dossiers compris) dans « A faire » ; elles forment un lot suivi jusqu'à la fin du traitement."""
    src = os.path.abspath((folder or "").strip().strip('"'))
    if not os.path.isdir(src):
        raise FileNotFoundError("dossier introuvable : " + src)
    found = []
    for root, dirs, fnames in os.walk(src):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        found += [os.path.join(root, n) for n in sorted(fnames, key=str.lower) if n.lower().endswith(EXTS)]
        if len(found) > BATCH_MAX:
            raise ValueError(f"trop d'images ({BATCH_MAX} maximum par dossier)")
    if not found:
        raise ValueError("aucune image dans ce dossier")
    _queue_claim()                                     # un seul traitement par lot à la fois (lève RuntimeError sinon)
    dest = _dir(cat, "todo")
    bid = uuid.uuid4().hex[:6]
    b = {"id": bid, "cat": cat, "name": os.path.basename(src) or "Dossier", "total": 0, "remaining": set(), "tasks": [], "failed": 0, "failed_paths": [], "open": True}
    with lock:
        _batches[bid] = b
    items = []
    try:
        for p in found:
            target = _unique(dest, os.path.basename(p))
            with lock:
                b["remaining"].add(target)
                _batch_of[target] = bid
                _reserved.add(target)                  # la surveillance automatique n'y touche pas : le lot est traité image par image
            try:
                shutil.copy2(p, target + ".part")
                os.replace(target + ".part", target)
                b["total"] += 1
                items.append((cat, target))
            except OSError:
                with lock:
                    b["remaining"].discard(target)
                    _batch_of.pop(target, None)
                    _reserved.discard(target)
    except BaseException:
        _queue_release()
        raise
    finally:
        with lock:
            b["open"] = False
    if not b["total"]:
        with lock:
            _batches.pop(bid, None)
        _queue_release()
        raise ValueError("aucune image n'a pu être copiée")
    _log(f"Dossier « {b['name']} » : {b['total']} image(s) envoyée(s) au traitement")
    _queue_start("batch", b["name"], items, bid=bid)
    return {"batch": bid, "count": b["total"], "name": b["name"]}


def _batch_done(path, task):
    with lock:
        b = _batches.get(_batch_of.pop(path, None))
        if not b:
            return
        b["remaining"].discard(path)
        if task:
            b["tasks"].append(task)
        else:
            b["failed"] += 1
            b["failed_paths"].append(path)


def _ready_batch():
    """Premier lot entièrement traité et pas encore réglé (Oui / Non) ; un lot sans aucun résultat est abandonné."""
    with lock:
        for bid, b in list(_batches.items()):
            if b["open"] or b["remaining"]:
                continue
            if not b["tasks"]:
                _batches.pop(bid, None)
                continue
            return {"id": bid, "name": b["name"], "cat": b["cat"], "tasks": len(b["tasks"]), "failed": b["failed"], "total": b["total"]}
    return None


def batch_resolve(bid, folder_name):
    """folder_name None = « Non » (tâches laissées en vrac) ; sinon crée le Dossier Principal et y déplace toutes les tuiles du lot."""
    with lock:
        b = _batches.get(bid)
    if not b or b["open"] or b["remaining"]:
        raise FileNotFoundError("lot introuvable ou encore en cours")
    if folder_name is None:
        with lock:
            _batches.pop(bid, None)
        return {"folder": None, "count": 0}
    name = _valid_name(folder_name, "nom du dossier")
    root = os.path.join(FOLDERS, name)
    if os.path.exists(root):
        raise FileExistsError(f"le dossier « {name} » existe déjà")
    os.makedirs(root)
    n = 0
    out = _dir(b["cat"], "out")
    for t in b["tasks"]:
        tdir = os.path.join(out, t)
        if not os.path.isdir(tdir):
            continue
        for img in _images(tdir):
            shutil.move(os.path.join(tdir, img), _unique(root, img))
            n += 1
        shutil.rmtree(tdir, ignore_errors=True)               # la tâche vidée disparaît : tout est dans le Dossier Principal
    _write_pack(root, b["cat"], [os.path.basename(p) for p in b.get("failed_paths", []) if os.path.isfile(p)])   # pour « Réparer »
    with lock:
        _batches.pop(bid, None)
    _log(f"Dossier « {name} » créé : {n} image(s) à trier")
    return {"folder": name, "count": n}


# ----------------------------------------------------------------------------- Dossiers Principaux : tri en sous-dossiers + export .zip
def _folder_path(name):
    if not name or name != os.path.basename(name) or name in (".", ".."):
        raise ValueError("nom de dossier invalide")
    p = os.path.join(FOLDERS, name)
    if not os.path.isdir(p):
        raise FileNotFoundError(name)
    return p


def _sub_path(name, sub):
    root = _folder_path(name)
    if not sub:
        return root
    if sub != os.path.basename(sub) or sub in (".", ".."):
        raise ValueError("nom de sous-dossier invalide")
    p = os.path.join(root, sub)
    if not os.path.isdir(p):
        raise FileNotFoundError(sub)
    return p


def _subs(root):
    return sorted((n for n in os.listdir(root) if os.path.isdir(os.path.join(root, n))), key=str.lower)


def folders():
    os.makedirs(FOLDERS, exist_ok=True)
    res = []
    for n in os.listdir(FOLDERS):
        p = os.path.join(FOLDERS, n)
        if os.path.isdir(p):
            subs = _subs(p)
            count = len(_images(p)) + sum(len(_images(os.path.join(p, s))) for s in subs)
            res.append({"name": n, "subs": len(subs), "count": count, "t": os.path.getmtime(p)})
    return sorted(res, key=lambda f: -f["t"])


def folder_tree(name):
    root = _folder_path(name)
    return {"name": name, "unsorted": len(_images(root)), "missing": len(_repair_items(name)),
            "subs": [{"name": s, "count": len(_images(os.path.join(root, s)))} for s in _subs(root)]}


def folder_files(name, sub=""):
    d = _sub_path(name, sub)
    return [{"name": n, "thumb": _thumb(os.path.join(d, n)), "size": os.path.getsize(os.path.join(d, n))} for n in _images(d)[:600]]


def folder_add_sub(name, sub):
    root = _folder_path(name)
    sub = _valid_name(sub, "nom du dossier")
    if any(n.lower() == sub.lower() for n in os.listdir(root)):
        raise FileExistsError(f"« {sub} » existe déjà")
    os.makedirs(os.path.join(root, sub))
    return {"name": sub}


def folder_del_sub(name, sub):
    """Supprime un sous-dossier : ses images retournent dans « Non triés » (rien n'est perdu)."""
    if not sub:
        raise ValueError("sous-dossier requis")
    root, d = _folder_path(name), _sub_path(name, sub)
    for n in os.listdir(d):
        p = os.path.join(d, n)
        if os.path.isfile(p):
            shutil.move(p, _unique(root, n))
    shutil.rmtree(d, ignore_errors=True)


def folder_move(name, files, to):
    """files : [{sub, file}] -> déplace vers le sous-dossier `to` (vide = Non triés)."""
    dst = _sub_path(name, to)
    n = 0
    for f in files[:BATCH_MAX * 2]:
        leaf = f.get("file", "")
        if not leaf or leaf != os.path.basename(leaf):
            continue
        src = os.path.join(_sub_path(name, f.get("sub", "")), leaf)
        if os.path.isfile(src) and os.path.normcase(os.path.dirname(src)) != os.path.normcase(dst):
            shutil.move(src, _unique(dst, leaf))
            n += 1
    return n


def folder_export(name, dest_path):
    """Archive le Dossier Principal (sous-dossiers compris) en « <Nom>.zip » dans la destination (BIN A JEU…), sans écraser."""
    root = _folder_path(name)
    dest = os.path.abspath((dest_path or "").strip().strip('"'))
    if not os.path.isdir(dest):
        raise FileNotFoundError("dossier de destination introuvable : " + dest)
    target = _unique(dest, name + ".zip")
    tmp = target + ".part"
    n = 0
    try:
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
            for sub in [""] + _subs(root):
                d = os.path.join(root, sub) if sub else root
                if sub:
                    z.writestr(f"{name}/{sub}/", "")                       # garde aussi les sous-dossiers vides
                for img in _images(d):
                    z.write(os.path.join(d, img), f"{name}/{sub}/{img}" if sub else f"{name}/{img}")
                    n += 1
        os.replace(tmp, target)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    _log(f"Export : {os.path.basename(target)} ({n} image(s)) → {dest}")
    return {"zip": target, "dest": dest, "count": n}


def default_export_dest():
    """« BIN A JEU » (clé binageux) s'il existe, sinon chaîne vide."""
    d = next((x for x in destinations() if x["key"] == "binageux"), None)
    return d["path"] if d and d["ok"] else ""


# ----------------------------------------------------------------------------- file d'attente séquentielle (lots + réparation)
# Une image à la fois : traitée -> vérifiée sur le disque -> installée -> pause -> image suivante. Jamais de plantage silencieux :
# chaque image est tentée RETRIES fois (avec attente croissante) et un échec définitif est consigné, sans arrêter le reste du lot.
RETRIES = 3
PAUSE_S = HUMAN_PAUSE                           # respiration ALÉATOIRE (2 à 5 s) entre deux images (OS, OneDrive, sites web, rythme humain)
PACK_FILE = ".pack.json"                       # dans un Dossier Principal : images restées en plan (lues par « Réparer »)
_reserved = set()                              # fichiers de « A faire » pris en charge par une file (la surveillance les ignore)
_qlock = threading.Lock()
QUEUE = {"id": "", "active": False, "finished": False, "kind": "", "name": "", "total": 0, "index": 0, "current": "",
         "ok": 0, "failed": 0, "t0": 0.0, "t_end": 0.0, "dur": [], "events": [], "failed_names": []}


def _q(**kw):
    with lock:
        QUEUE.update(kw)


def _q_event(kind, msg):
    with lock:
        QUEUE["events"] = (QUEUE["events"] + [{"k": kind, "m": msg, "t": time.strftime("%H:%M:%S")}])[-60:]
    _log(msg)


def _queue_claim():
    with lock:
        if QUEUE["active"]:
            raise RuntimeError("Un traitement par lot est déjà en cours : attendez qu'il se termine.")
        QUEUE.update(id=uuid.uuid4().hex[:6], active=True, finished=False, kind="", name="", total=0, index=0, current="",
                     ok=0, failed=0, t0=time.time(), t_end=0.0, dur=[], events=[], failed_names=[])


def _queue_release():
    with lock:
        QUEUE.update(active=False, finished=False)


def queue_dismiss():
    with lock:
        if not QUEUE["active"]:
            QUEUE.update(finished=False, id="")


def queue_state():
    with lock:
        q = {k: (list(v) if isinstance(v, list) else v) for k, v in QUEUE.items()}
        job = next(iter(STATE["jobs"].values()), None)
    left = max(0, q["total"] - q["ok"] - q["failed"])
    avg = sum(q["dur"]) / len(q["dur"]) if q["dur"] else 0
    q["left"] = left
    q["eta"] = round(avg * left) if avg and q["active"] else None
    q["elapsed"] = round((q["t_end"] or time.time()) - q["t0"]) if q["t0"] else 0
    q["stage"] = job["stage"] if job and q["active"] else ""
    q["sub"] = round(job["progress"]) if job and q["active"] else 0
    q["events"] = q["events"][-12:][::-1]
    return q


def _queue_start(kind, name, items, bid=None, on_ok=None, on_end=None):
    """Lance le thread séquentiel sur `items` = [(cat, chemin)]. `_queue_claim()` doit avoir été appelé avant."""
    _q(kind=kind, name=name, total=len(items))
    with lock:
        for _, p in items:
            _reserved.add(p)
    threading.Thread(target=_queue_worker, args=(kind, items, bid, on_ok, on_end), daemon=True, name="imgqueue").start()


def _queue_worker(kind, items, bid, on_ok, on_end):
    total = len(items)
    failed_paths = []
    try:
        for i, (cat, path) in enumerate(items, 1):
            base = os.path.basename(path)
            task, err, t_img = None, "", time.time()
            try:
                _q(index=i, current=base)
                _q_event("run", f"Traitement de l'image {i} sur {total} : {base}")
                for attempt in range(1, RETRIES + 1):
                    if not os.path.isfile(path):
                        err = "fichier source introuvable"
                        break
                    _SLOTS.acquire()                                  # respecte la limite globale de traitements
                    try:
                        task = _process(cat, path, final=False)
                        err = getattr(_ctx, "err", "")
                    finally:
                        _SLOTS.release()
                    if task:
                        break
                    if attempt < RETRIES:
                        wait = 6 * attempt
                        _q_event("warn", f"Image {i} : tentative {attempt}/{RETRIES} échouée ({err[:90]}) — nouvel essai dans {wait} s")
                        time.sleep(wait)
                n_files = 0
                if task:
                    n_files = on_ok(cat, path, task) if on_ok else len(_images(os.path.join(_dir(cat, "out"), task)))
            except Exception as e:                                    # noqa: BLE001 — une image ne doit JAMAIS arrêter le lot
                task, err = None, f"{e.__class__.__name__}: {e}"
            if task:
                with lock:
                    QUEUE["ok"] += 1
                    QUEUE["dur"] = (QUEUE["dur"] + [time.time() - t_img])[-12:]
                _q_event("ok", f"Image {i} installée avec succès : {base} ({n_files} fichier{'s' if n_files > 1 else ''})")
            else:
                failed_paths.append(path)
                _failed[path] = os.path.getmtime(path) if os.path.exists(path) else 0
                with lock:
                    QUEUE["failed"] += 1
                    QUEUE["failed_names"].append(base)
                _q_event("bad", f"Image {i} : ÉCHEC définitif — {base} ({err[:120]}). Elle reste dans « A faire » (bouton Réparer).")
            if bid:
                _batch_done(path, task)
            with lock:
                _reserved.discard(path)
            if i < total:
                time.sleep(random.uniform(*PAUSE_S))
    except Exception as e:                                            # noqa: BLE001
        _q_event("bad", "Erreur inattendue dans la file : " + str(e)[:160])
    finally:
        with lock:                                                    # tout ce qui reste est libéré, quoi qu'il arrive
            for _, p in items:
                _reserved.discard(p)
                if bid and p in _batch_of:
                    b = _batches.get(_batch_of.pop(p))
                    if b:
                        b["remaining"].discard(p)
                        b["failed"] += 1
                        b["failed_paths"].append(p)
        try:
            if on_end:
                on_end(failed_paths)
        except Exception as e:                                        # noqa: BLE001
            _q_event("bad", "Fin de file : " + str(e)[:120])
        ok = QUEUE["ok"]
        _q_event("ok" if not QUEUE["failed"] else "warn", f"Terminé : {ok} image(s) installée(s), {QUEUE['failed']} en échec sur {total}.")
        with lock:
            QUEUE.update(active=False, finished=True, t_end=time.time(), current="")
        _notify(not QUEUE["failed"], QUEUE["name"] or "lot", f"{ok}/{total} image(s)")


# ----------------------------------------------------------------------------- Réparer : reprise des images restées dans « A faire »
def _write_pack(root, cat, missing):
    try:
        with open(os.path.join(root, PACK_FILE), "w", encoding="utf-8") as f:
            json.dump({"cat": cat, "missing": sorted(missing)}, f, ensure_ascii=False)
    except OSError:
        pass


def _read_pack(root):
    try:
        with open(os.path.join(root, PACK_FILE), encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _pack_missing():
    """{cat: {noms en minuscules}} des images en attente de réparation, tous Dossiers Principaux confondus."""
    res = {}
    try:
        for n in os.listdir(FOLDERS):
            d = _read_pack(os.path.join(FOLDERS, n))
            if d.get("cat") in CATS:
                res.setdefault(d["cat"], set()).update(str(x).lower() for x in d.get("missing") or [])
    except OSError:
        pass
    return res


def _repair_items(name):
    """[(cat, chemin)] des images à reprendre pour ce Dossier Principal : celles notées dans son manifeste, sinon
    (dossier créé avant ce correctif) tout ce qui reste dans « A faire »."""
    root = _folder_path(name)
    man = _read_pack(root)
    cats = [man["cat"]] if man.get("cat") in CATS else list(CATS)
    wanted = {str(x).lower() for x in man["missing"]} if isinstance(man.get("missing"), list) else None
    items = []
    for cat in cats:
        todo = _dir(cat, "todo")
        for n in sorted(os.listdir(todo), key=str.lower):
            p = os.path.join(todo, n)
            if n.lower().endswith(EXTS) and os.path.isfile(p) and p not in _reserved and p not in _active \
                    and (wanted is None or n.lower() in wanted):
                items.append((cat, p))
    return items


def repair_folder(name):
    """Reprend UNIQUEMENT les images restées dans « A faire » et ajoute le résultat à la racine du Dossier Principal (« Non triés »).
    Rien n'est effacé ni écrasé : chaque fichier reçoit un nom libre (_unique)."""
    root = _folder_path(name)
    items = _repair_items(name)
    if not items:
        raise ValueError("Rien à réparer : plus aucune image en attente dans « A faire ».")
    _queue_claim()
    for _, p in items:
        _failed.pop(p, None)

    def on_ok(cat, path, task):
        tdir = os.path.join(_dir(cat, "out"), task)
        n = 0
        for img in _images(tdir):
            dst = _unique(root, img)                                   # jamais d'écrasement d'un fichier existant du pack
            shutil.move(os.path.join(tdir, img), dst)
            if not os.path.isfile(dst) or os.path.getsize(dst) <= 0:
                raise OSError(f"{img} n'a pas été installé correctement")
            n += 1
        shutil.rmtree(tdir, ignore_errors=True)
        return n

    def on_end(failed_paths):
        cat = items[0][0] if len({c for c, _ in items}) == 1 else _read_pack(root).get("cat", "")
        _write_pack(root, cat, [os.path.basename(p) for p in failed_paths if os.path.isfile(p)])

    _queue_start("repair", name, items, on_ok=on_ok, on_end=on_end)
    return {"count": len(items), "name": name}
