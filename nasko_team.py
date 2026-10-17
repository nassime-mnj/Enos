"""Équipe E.N.O.S. : appareils de confiance (édition Eto / Eto Dev) et Entrepôt partagé (échange de colis et de fichiers).

ENTREPÔT : un dossier synchronisé (OneDrive, partage réseau…) où chacun publie dans SON sous-dossier :
    <entrepôt>/<id>/colis/*.zip      colis générés par <id>
    <entrepôt>/<id>/fichiers/*       fichiers envoyés par <id>
    <entrepôt>/<id>/profile.json     présence (nom affiché, dernière activité)
    <entrepôt>/_archives/...         éléments rangés par l'un ou l'autre
Chacun n'écrit que dans son propre dossier (jamais deux PC sur le même fichier : pas de conflit de synchronisation) ;
agir sur le colis de l'autre = le copier chez soi, le livrer, l'archiver. Les écritures passent par un .part puis un renommage.
"""
import json
import os
import re
import shutil
import threading
import time
import zipfile
from datetime import datetime

from nasko_core import app_dir, data_dir

lock = threading.RLock()
UUID_RE = re.compile(r"^[0-9a-fA-F-]{16,64}$")
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
KINDS = ("colis", "fichiers")
IGNORED = (".part", ".tmp", ".crdownload", ".lnk")


class TeamError(Exception):
    pass


# ============================================================================= appareils de confiance (Eto / Eto Dev)
def _dev_file():
    return os.path.join(data_dir(), "enos_devices.json")


def _load():
    try:
        with open(_dev_file(), encoding="utf-8") as f:
            d = json.load(f)
        return {"devices": list(d.get("devices", [])), "pending": dict(d.get("pending", {}))}
    except (OSError, ValueError):
        return {"devices": [], "pending": {}}


def _save(d):
    tmp = _dev_file() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=1, ensure_ascii=False)
    os.replace(tmp, _dev_file())


def valid_uuid(u):
    return bool(u and UUID_RE.match(u))


def is_dev(uuid):
    return valid_uuid(uuid) and any(x["uuid"].lower() == uuid.lower() for x in _load()["devices"])


def preview(uuid):
    """Appareil de confiance en « aperçu grand public » : il voit exactement l'interface d'un utilisateur normal (pour les tests)."""
    return valid_uuid(uuid) and any(x["uuid"].lower() == uuid.lower() and x.get("preview") for x in _load()["devices"])


def set_preview(uuid, on):
    """Réservé aux appareils DÉJÀ de confiance : ne peut jamais donner l'accès dev à quelqu'un d'autre, seulement le masquer/rétablir pour soi."""
    with lock:
        d = _load()
        for x in d["devices"]:
            if x["uuid"].lower() == (uuid or "").lower():
                x["preview"] = bool(on)
                _save(d)
                return True
    return False


def edition(uuid, local):
    """Ce PC = toujours « dev ». Un appareil distant n'est « dev » (Eto Dev / E.N.O.S.) que si son UUID est dans la liste de confiance
    et qu'il n'est pas en aperçu grand public."""
    return "dev" if local or (is_dev(uuid) and not preview(uuid)) else "eto"


def touch(uuid, ip="", ua=""):
    """Appelé à chaque requête authentifiée d'un appareil distant : met à jour « vu le » ou inscrit l'appareil en attente d'approbation."""
    if not valid_uuid(uuid):
        return
    now = time.time()
    with lock:
        d = _load()
        for x in d["devices"]:
            if x["uuid"].lower() == uuid.lower():
                if now - x.get("last_seen", 0) > 30:               # pas d'écriture disque à chaque requête
                    x.update(last_seen=now, ip=ip)
                    _save(d)
                return
        p = d["pending"].get(uuid)
        if p is None and len(d["pending"]) >= 20:
            return                                                  # liste d'attente bornée (anti-saturation)
        if p is None or now - p.get("last", 0) > 30:
            d["pending"][uuid] = {"first": (p or {}).get("first", now), "last": now, "ip": ip, "ua": (ua or "")[:120]}
            _save(d)


def approve(uuid, name):
    if not valid_uuid(uuid):
        raise TeamError("UUID invalide")
    name = (name or "").strip()[:40] or "Appareil"
    with lock:
        d = _load()
        d["pending"].pop(uuid, None)
        d["devices"] = [x for x in d["devices"] if x["uuid"].lower() != uuid.lower()]
        d["devices"].append({"uuid": uuid, "name": name, "added": time.time(), "last_seen": 0, "ip": ""})
        _save(d)


def remove(uuid):
    with lock:
        d = _load()
        n = len(d["devices"]) + len(d["pending"])
        d["devices"] = [x for x in d["devices"] if x["uuid"].lower() != (uuid or "").lower()]
        d["pending"].pop(uuid, None)
        _save(d)
        return n != len(d["devices"]) + len(d["pending"])


def device_name(uuid):
    for x in _load()["devices"]:
        if x["uuid"].lower() == (uuid or "").lower():
            return x["name"]
    return ""


def snapshot():
    d = _load()
    return {"devices": sorted(d["devices"], key=lambda x: -x.get("last_seen", 0)),
            "pending": [{"uuid": u, **v} for u, v in sorted(d["pending"].items(), key=lambda kv: -kv[1].get("last", 0))]}


# ============================================================================= ENTREPÔT
def _ok_name(name):
    return bool(name) and name == os.path.basename(name) and not name.startswith(".") and name not in (".", "..") and not name.lower().endswith(IGNORED) \
        and not name.startswith("~$") and not any(c in name for c in '<>:"/\\|?*\0')


def root_of(cfg):
    r = (cfg.get("warehouse_dir") or "").strip()
    if not r:
        raise TeamError("Aucun dossier d'entrepôt : choisissez-le dans RÉGLAGES → PROFIL (dossier OneDrive ou réseau partagé avec votre associé).")
    if not os.path.isdir(r):
        raise TeamError(f"Dossier d'entrepôt introuvable : {r}")
    return os.path.abspath(r)


def _own(root, me):
    if not ID_RE.match(me or ""):
        raise TeamError("identifiant de profil invalide")
    return os.path.join(root, me)


def ensure(root, me, label):
    """Crée mon espace et écrit ma présence."""
    base = _own(root, me)
    for k in KINDS:
        os.makedirs(os.path.join(base, k), exist_ok=True)
    os.makedirs(os.path.join(root, "_archives"), exist_ok=True)
    try:
        with open(os.path.join(base, "profile.json"), "w", encoding="utf-8") as f:
            json.dump({"id": me, "label": label, "last_online": time.time()}, f)
    except OSError:
        pass


def peers(root, me):
    out = []
    for n in sorted(os.listdir(root)):
        p = os.path.join(root, n)
        if n == me or n.startswith(("_", ".")) or not os.path.isdir(p) or not ID_RE.match(n):
            continue
        info = {"id": n, "label": n.capitalize(), "last_online": 0}
        try:
            with open(os.path.join(p, "profile.json"), encoding="utf-8") as f:
                info.update({k: v for k, v in json.load(f).items() if k in ("label", "last_online")})
        except (OSError, ValueError):
            pass
        out.append(info)
    return out


def _seen_file():
    return os.path.join(data_dir(), "enos_warehouse_seen.json")


def _seen():
    try:
        with open(_seen_file(), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def list_items(root, me):
    """Tout ce qu'il y a dans l'entrepôt (les miens et ceux des autres), du plus récent au plus ancien, avec le marqueur « nouveau »."""
    seen, items = _seen(), []
    for owner in sorted(os.listdir(root)):
        od = os.path.join(root, owner)
        if owner.startswith(("_", ".")) or not os.path.isdir(od) or not ID_RE.match(owner):
            continue
        for kind in KINDS:
            kd = os.path.join(od, kind)
            if not os.path.isdir(kd):
                continue
            for n in os.listdir(kd):
                p = os.path.join(kd, n)
                if not os.path.isfile(p) or not _ok_name(n):
                    continue
                key = f"{owner}/{kind}/{n}"
                st = os.stat(p)
                it = {"owner": owner, "kind": kind, "name": n, "size": st.st_size, "t": st.st_mtime, "mine": owner == me,
                      "new": owner != me and seen.get(key) != st.st_mtime}
                if kind == "colis" and n.lower().endswith(".zip"):
                    try:
                        with zipfile.ZipFile(p) as z:
                            it["count"] = len([i for i in z.infolist() if not i.is_dir()])
                    except (zipfile.BadZipFile, OSError):
                        it["count"] = None                          # pas encore entièrement synchronisé, ou corrompu
                items.append(it)
    return sorted(items, key=lambda x: -x["t"])


def mark_seen(root, me):
    seen = _seen()
    for it in list_items(root, me):
        if not it["mine"]:
            seen[f"{it['owner']}/{it['kind']}/{it['name']}"] = it["t"]
    with open(_seen_file(), "w", encoding="utf-8") as f:
        json.dump(seen, f)


def new_count(root, me):
    return sum(1 for it in list_items(root, me) if it["new"])


def item_path(root, owner, kind, name):
    """Chemin d'un élément de l'entrepôt, vérifié : propriétaire/genre/nom valides et résolution STRICTEMENT dans l'entrepôt."""
    if not ID_RE.match(owner or "") or kind not in KINDS or not _ok_name(name or ""):
        raise TeamError("élément invalide")
    p = os.path.realpath(os.path.join(root, owner, kind, name))
    r = os.path.realpath(root)
    if not os.path.normcase(p).startswith(os.path.normcase(r) + os.sep) or not os.path.isfile(p):
        raise TeamError("élément introuvable")
    return p


def _unique(folder, name):
    base, ext = os.path.splitext(name)
    out, n = os.path.join(folder, name), 2
    while os.path.exists(out):
        out = os.path.join(folder, f"{base} ({n}){ext}")
        n += 1
    return out


def _copy_atomic(src, dst):
    part = dst + ".part"
    try:
        shutil.copyfile(src, part)
        os.replace(part, dst)
    finally:
        if os.path.exists(part):
            try:
                os.remove(part)
            except OSError:
                pass


def publish(root, me, label, src, kind=None):
    """Copie `src` dans MON dossier de l'entrepôt (colis si .zip, sinon fichiers). La source locale n'est pas modifiée."""
    if not os.path.isfile(src):
        raise TeamError("fichier introuvable")
    kind = kind or ("colis" if src.lower().endswith(".zip") else "fichiers")
    if kind not in KINDS:
        raise TeamError("genre invalide")
    ensure(root, me, label)
    name = os.path.basename(src)
    if not _ok_name(name):
        raise TeamError("nom de fichier non pris en charge")
    dst = _unique(os.path.join(_own(root, me), kind), name)
    _copy_atomic(src, dst)
    return {"owner": me, "kind": kind, "name": os.path.basename(dst), "size": os.path.getsize(dst)}


def fetch(root, owner, kind, name, dest_dir):
    """Copie un élément de l'entrepôt vers un dossier local (colis -> « Colis en attente » : il apparaît dans GÉRER LES COLIS)."""
    src = item_path(root, owner, kind, name)
    os.makedirs(dest_dir, exist_ok=True)
    dst = _unique(dest_dir, name)
    _copy_atomic(src, dst)
    return dst


def archive(root, owner, kind, name):
    """Range un élément dans _archives (n'importe lequel des deux peut le faire ; rien n'est supprimé)."""
    src = item_path(root, owner, kind, name)
    dstdir = os.path.join(root, "_archives", owner, kind)
    os.makedirs(dstdir, exist_ok=True)
    dst = _unique(dstdir, name)
    shutil.move(src, dst)
    return dst


def remove_mine(root, me, kind, name):
    p = item_path(root, me, kind, name)
    os.remove(p)


def contents(root, owner, name):
    p = item_path(root, owner, "colis", name)
    try:
        with zipfile.ZipFile(p) as z:
            infos = [i for i in z.infolist() if not i.is_dir()]
    except zipfile.BadZipFile:
        raise TeamError("colis illisible (synchronisation en cours ?)")
    return {"files": [{"name": os.path.basename(i.filename), "size": i.file_size} for i in infos[:300]], "count": len(infos),
            "unpacked": sum(i.file_size for i in infos)}


# ============================================================================= CANAL (fiche de connexion publiée dans MON dossier)
def publish_channel(root, me, data):
    base = _own(root, me)
    os.makedirs(base, exist_ok=True)
    tmp = os.path.join(base, "channel.json.part")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, os.path.join(base, "channel.json"))


def unpublish_channel(root, me):
    try:
        os.remove(os.path.join(_own(root, me), "channel.json"))
    except OSError:
        pass


def peer_channels(root, me):
    """Fiches de canal des AUTRES (adresses, jeton, empreinte). Seules les fiches bien formées sont retournées."""
    out = []
    for n in sorted(os.listdir(root)):
        p = os.path.join(root, n, "channel.json")
        if n == me or n.startswith(("_", ".")) or not ID_RE.match(n) or not os.path.isfile(p):
            continue
        try:
            with open(p, encoding="utf-8") as f:
                d = json.load(f)
            urls = [u for u in d.get("urls", []) if isinstance(u, str) and u.startswith(("wss://", "ws://")) and len(u) < 200][:8]
            tok = d.get("token", "")
            if not isinstance(tok, str) or not (20 <= len(tok) <= 100):
                continue
            out.append({"id": n, "label": str(d.get("label") or n.capitalize())[:40], "urls": urls, "token": tok,
                        "fp": str(d.get("fp") or "")[:100], "t": float(d.get("t") or 0)})
        except (OSError, ValueError, TypeError):
            continue
    return out
