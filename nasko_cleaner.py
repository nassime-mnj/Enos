"""Deep System Cleaner : scan profond du disque, classement des plus gros fichiers par type et niveau de risque, suppression guidée.

Sécurité (tout est vérifié CÔTÉ SERVEUR, jamais fait confiance au navigateur) :
- l'interface ne manipule que des identifiants : seuls les fichiers trouvés par le dernier scan peuvent être supprimés ;
- le risque est recalculé au moment de la suppression à partir du chemin réel ; 🔴 = refus systématique, 🟠 = confirmation explicite exigée ;
- liens/jonctions (points d'analyse) ignorés au scan et refusés à la suppression ; fichier modifié depuis le scan = refusé ;
- par défaut, la suppression passe par la Corbeille de Windows (réversible) ; la suppression définitive est une option.
"""
import ctypes
import heapq
import logging
import os
import shutil
import string
import subprocess
import sys
import threading
import time
from ctypes import wintypes

from nasko_core import app_dir

log = logging.getLogger("nasko.cleaner")

# ----------------------------------------------------------------------------- catégories
CATS = {"video": "Vidéos", "image": "Images", "doc": "Documents", "app": "Applications", "archive": "Archives & disques", "other": "Autres"}
_EXT = {
    "video": (".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mpg", ".mpeg", ".ts", ".m2ts", ".3gp", ".vob"),
    "image": (".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tif", ".tiff", ".webp", ".heic", ".psd", ".raw", ".cr2", ".nef", ".arw", ".dng", ".ico", ".svg", ".exr", ".tga", ".xcf", ".ase", ".aseprite"),
    "doc": (".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv", ".odt", ".ods", ".odp", ".rtf", ".md", ".epub", ".mobi", ".json", ".xml", ".log", ".sql", ".db", ".sqlite"),
    "app": (".exe", ".msi", ".dll", ".sys", ".apk", ".aab", ".appx", ".msix", ".msp", ".cab", ".jar", ".bat", ".cmd", ".com", ".scr", ".ocx", ".pak", ".dmp"),
    "archive": (".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".iso", ".img", ".vhd", ".vhdx", ".vmdk", ".wim", ".esd", ".bak", ".bin"),
}
EXT_CAT = {e: c for c, exts in _EXT.items() for e in exts}

RISK_LABEL = {"green": "Ultra safe", "orange": "Moins safe", "red": "À risque"}
RISK_ICON = {"green": "🟢", "orange": "🟠", "red": "🔴"}

# ----------------------------------------------------------------------------- classification du risque (par chemin)
_USER_DIRS = {"downloads", "téléchargements", "telechargements", "videos", "vidéos", "documents", "pictures", "images", "desktop", "bureau", "music", "musique"}
_CACHE_PARTS = {"temp", "tmp", "cache", "code cache", "gpucache", "cache2", "inetcache", "crashdumps", "webcache", "shadercache", "dxcache", "glcache"}
_ROOT_SYSTEM_FILES = {"pagefile.sys", "hiberfil.sys", "swapfile.sys", "bootmgr", "bootnxt", "dumpstack.log", "dumpstack.log.tmp"}
_ROOT_SYSTEM_DIRS = {"windows", "boot", "efi", "recovery", "system volume information", "$recycle.bin", "$winreagent", "config.msi", "documents and settings"}
_ORANGE_ROOT_DIRS = {"program files", "program files (x86)", "programdata"}
_SKIP_DIRS = {"winsxs"}                      # magasin de liens physiques : les tailles y sont des doublons de System32, sans intérêt (et jamais supprimable)


def _parts(path):
    drive, rest = os.path.splitdrive(os.path.normpath(path))
    return [p.lower() for p in rest.split(os.sep) if p]


def classify(path):
    """(risque, raison) d'un chemin. Priorité : système (rouge) > caches utilisateur (vert) > Program Files/ProgramData/AppData (orange) > dossiers personnels (vert) > reste (orange)."""
    parts = _parts(path)
    if not parts:
        return "red", "Racine du disque"
    top = parts[0]
    if top in _ROOT_SYSTEM_DIRS or (len(parts) == 1 and top in _ROOT_SYSTEM_FILES):
        return "red", "Fichier système Windows"
    sysroot = os.path.normcase(os.environ.get("SystemRoot", r"C:\Windows"))
    if os.path.normcase(os.path.abspath(path)).startswith(sysroot + os.sep):
        return "red", "Fichier système Windows"
    if "system32" in parts or "syswow64" in parts:
        return "red", "Fichier système Windows"
    me = os.path.normcase(os.path.abspath(path))
    if me == os.path.normcase(os.path.abspath(sys.executable)):
        return "red", "Programme E.N.O.S. en cours d'exécution"
    if me.startswith(os.path.normcase(os.path.abspath(app_dir())) + os.sep):
        return "orange", "Fichier de l'application E.N.O.S."
    if top == "users" and len(parts) >= 3:
        user_rel = parts[2:]                                                   # après Users\<nom>
        if user_rel[0] == "appdata":
            if any(p in _CACHE_PARTS for p in user_rel[:-1]):
                return "green", "Cache / fichiers temporaires"
            return "orange", "Données d'applications (AppData)"
        i = 1 if user_rel[0].startswith("onedrive") and len(user_rel) > 1 else 0   # OneDrive\Documents = Documents
        if user_rel[i] in _USER_DIRS:
            return "green", "Dossier personnel (" + user_rel[i].capitalize() + ")"
        return "orange", "Profil utilisateur (hors dossiers personnels)"
    if top in _ORANGE_ROOT_DIRS:
        return "orange", "Programmes installés" if top.startswith("program files") else "Données de programmes (ProgramData)"
    if any(p in _CACHE_PARTS for p in parts[:-1]):
        return "orange", "Dossier temporaire hors profil"
    return "orange", "Emplacement hors dossiers personnels"


def category(name):
    return EXT_CAT.get(os.path.splitext(name)[1].lower(), "other")


# ----------------------------------------------------------------------------- scan
_FILE_ATTRIBUTE_REPARSE = 0x400
_CLOUD_ATTRS = 0x400000 | 0x40000 | 0x1000        # RECALL_ON_DATA_ACCESS · RECALL_ON_OPEN · OFFLINE : fichiers OneDrive « à la demande », aucun octet sur le disque
PER_CAT = 300

_lock = threading.Lock()
STATE = {"phase": "idle", "files": 0, "dirs": 0, "bytes": 0, "denied": 0, "current": "", "started": 0.0, "elapsed": 0.0, "found": 0, "message": "", "cancel": False}
RESULTS = {}                                                   # id -> fiche d'un fichier trouvé par le dernier scan


def fixed_drives():
    """Lettres des disques fixes (HDD/SSD) ; le disque système en premier."""
    out = []
    if sys.platform == "win32":
        mask = ctypes.windll.kernel32.GetLogicalDrives()
        for i, ch in enumerate(string.ascii_uppercase):
            if mask & (1 << i) and ctypes.windll.kernel32.GetDriveTypeW(f"{ch}:\\") == 3:          # DRIVE_FIXED
                out.append(f"{ch}:\\")
    sysdrive = (os.environ.get("SystemDrive", "C:") + "\\").upper()
    out.sort(key=lambda d: d.upper() != sysdrive)
    return out or [sysdrive]


def disk_info():
    d = (os.environ.get("SystemDrive", "C:") + "\\")
    u = shutil.disk_usage(d)
    return {"drive": d, "total": u.total, "used": u.used, "free": u.free}


def _set(**kw):
    with _lock:
        STATE.update(kw)


def state():
    with _lock:
        s = dict(STATE)
    if s["phase"] == "scanning":
        s["elapsed"] = time.time() - s["started"]
    s["disk"] = disk_info()
    return s


def start(min_mb=100, scope="system"):
    with _lock:
        if STATE["phase"] == "scanning":
            raise RuntimeError("Un scan est déjà en cours.")
        STATE.update(phase="scanning", files=0, dirs=0, bytes=0, denied=0, current="", started=time.time(), elapsed=0.0, found=0, message="", cancel=False)
        RESULTS.clear()
    drives = fixed_drives() if scope == "all" else fixed_drives()[:1]
    threading.Thread(target=_scan, args=(drives, max(1, int(min_mb)) * 1048576), daemon=True, name="enos-cleaner").start()


def cancel():
    _set(cancel=True)


def _scan(roots, min_bytes):
    heaps = {c: [] for c in CATS}                              # tas-min par catégorie : on ne garde que les PER_CAT plus gros
    seq = 0
    n_files = n_dirs = n_bytes = denied = 0
    stack = list(reversed(roots))
    last = 0.0
    try:
        while stack:
            if STATE["cancel"]:
                break
            d = stack.pop()
            n_dirs += 1
            try:
                it = os.scandir(d)
            except OSError:
                denied += 1
                continue
            with it:
                for e in it:
                    try:
                        st = e.stat(follow_symlinks=False)
                        attrs = getattr(st, "st_file_attributes", 0)
                        if e.is_dir(follow_symlinks=False):
                            if not (attrs & _FILE_ATTRIBUTE_REPARSE) and e.name.lower() not in _SKIP_DIRS:      # jonctions/liens : jamais suivis (boucles, doublons)
                                stack.append(e.path)
                            continue
                        if attrs & (_FILE_ATTRIBUTE_REPARSE | _CLOUD_ATTRS):          # liens, fichiers OneDrive « à la demande » (0 octet local)
                            continue
                        size = st.st_size
                    except OSError:
                        denied += 1
                        continue
                    n_files += 1
                    n_bytes += size
                    if size >= min_bytes:
                        cat = category(e.name)
                        h = heaps[cat]
                        seq += 1
                        item = (size, seq, e.path, st.st_mtime)
                        if len(h) < PER_CAT:
                            heapq.heappush(h, item)
                        elif size > h[0][0]:
                            heapq.heapreplace(h, item)
            now = time.time()
            if now - last > 0.25:                              # l'interface lit l'état ~2 fois par seconde : inutile de verrouiller à chaque dossier
                last = now
                _set(files=n_files, dirs=n_dirs, bytes=n_bytes, denied=denied, current=d)
        cancelled = STATE["cancel"]
        items = {}
        i = 0
        for cat, h in heaps.items():
            for size, _s, path, mtime in sorted(h, reverse=True):
                risk, reason = classify(path)
                i += 1
                items[i] = {"id": i, "path": path, "name": os.path.basename(path), "dir": os.path.dirname(path), "size": size, "mtime": mtime, "cat": cat,
                            "risk": risk, "reason": reason, "onedrive": any(p.startswith("onedrive") for p in _parts(path))}
        with _lock:
            RESULTS.clear()
            RESULTS.update(items)
        _set(files=n_files, dirs=n_dirs, bytes=n_bytes, denied=denied, current="", found=len(items), phase="done",
             message="Scan interrompu : résultats partiels." if cancelled else "", elapsed=time.time() - STATE["started"])
    except Exception as ex:                                    # le thread ne doit jamais mourir en silence
        log.exception("scan")
        _set(phase="error", message=f"Erreur pendant le scan : {ex}")


def results():
    with _lock:
        items = sorted(RESULTS.values(), key=lambda x: -x["size"])
    return {"items": items, "cats": CATS}


# ----------------------------------------------------------------------------- suppression
class _SHFILEOPSTRUCT(ctypes.Structure):
    _fields_ = [("hwnd", wintypes.HWND), ("wFunc", wintypes.UINT), ("pFrom", wintypes.LPCWSTR), ("pTo", wintypes.LPCWSTR),
                ("fFlags", ctypes.c_ushort), ("fAnyOperationsAborted", wintypes.BOOL), ("hNameMappings", ctypes.c_void_p), ("lpszProgressTitle", wintypes.LPCWSTR)]


def _recycle(path):
    """Envoie le fichier à la Corbeille de Windows (SHFileOperation + FOF_ALLOWUNDO). Lève OSError en cas d'échec."""
    FO_DELETE, FOF_SILENT, FOF_NOCONFIRMATION, FOF_ALLOWUNDO, FOF_NOERRORUI = 3, 0x4, 0x10, 0x40, 0x400
    buf = ctypes.create_unicode_buffer(path + "\0\0")          # liste de chemins terminée par un double zéro
    op = _SHFILEOPSTRUCT(None, FO_DELETE, ctypes.cast(buf, wintypes.LPCWSTR), None, FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT, False, None, None)
    rc = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
    if rc != 0 or op.fAnyOperationsAborted or os.path.exists(path):
        raise OSError(f"Corbeille refusée (code {rc})")


def delete(ids, permanent=False, allow_risky=False):
    """Supprime les fichiers désignés par `ids` (issus du dernier scan). Retourne {freed, results:[{id, ok, message}]}."""
    out, freed = [], 0
    for fid in ids:
        with _lock:
            it = RESULTS.get(fid)
        if it is None:
            out.append({"id": fid, "ok": False, "message": "Fichier inconnu : relancez le scan."})
            continue
        path = it["path"]
        try:
            real = os.path.realpath(path)
            if os.path.normcase(real) != os.path.normcase(os.path.abspath(path)):
                raise PermissionError("Chemin modifié (lien symbolique) : refusé.")
            risk, _why = classify(real)                         # recalculé : on ne se fie ni au scan ni au client
            if risk == "red":
                raise PermissionError("🔴 Fichier système : suppression BLOQUÉE par E.N.O.S.")
            if risk == "orange" and not allow_risky:
                raise PermissionError("🟠 Fichier à risque modéré : confirmation explicite requise.")
            st = os.lstat(real)
            if getattr(st, "st_file_attributes", 0) & _FILE_ATTRIBUTE_REPARSE or not os.path.isfile(real):
                raise PermissionError("Ce n'est pas un fichier ordinaire : refusé.")
            if st.st_size != it["size"]:
                raise PermissionError("Le fichier a changé depuis le scan : relancez le scan.")
            if permanent:
                os.remove(real)
            else:
                _recycle(real)
            freed += it["size"]
            with _lock:
                RESULTS.pop(fid, None)
            log.info("Cleaner : %s %s (%d octets)", "supprimé" if permanent else "mis à la Corbeille", real, it["size"])
            out.append({"id": fid, "ok": True, "message": "Supprimé" if permanent else "Mis à la Corbeille"})
        except FileNotFoundError:
            with _lock:
                RESULTS.pop(fid, None)
            out.append({"id": fid, "ok": True, "message": "Déjà absent"})
        except PermissionError as e:
            out.append({"id": fid, "ok": False, "message": str(e) or "Accès refusé (fichier en cours d'utilisation ?)"})
        except OSError as e:
            out.append({"id": fid, "ok": False, "message": f"Échec : {e}"})
    return {"freed": freed, "results": out, "disk": disk_info()}


def reveal(fid):
    """Ouvre l'Explorateur sur le fichier (identifiant issu du scan)."""
    with _lock:
        it = RESULTS.get(fid)
    if it is None or not os.path.exists(it["path"]):
        raise RuntimeError("Fichier introuvable.")
    subprocess.Popen(["explorer", "/select," + it["path"]])
