"""Module AGENDA : tâches manuelles (data/agenda.json) + fusion avec Zeus (cours) et Moodle (rendus) via nasko_epita.

Une seule vue normalisée pour l'interface ET pour l'IA proactive (nasko_agent) :
  {id, source: manual|zeus|moodle, kind: class|exam|deadline|task, title, start, end, all_day, location, done}
"""
import json
import logging
import os
import threading
import time
import uuid
from datetime import datetime, timedelta

import nasko_core
import nasko_epita

log = logging.getLogger("nasko.agenda")
_lock = threading.Lock()
_FILE = "agenda.json"


def _path():
    import nasko_roles                                                 # Friends : agenda.friends.json (jamais celui du CEO / Dev)
    return os.path.join(nasko_core.data_dir(), nasko_roles.data_name(_FILE))


def _load():
    try:
        with open(_path(), encoding="utf-8") as f:
            d = json.load(f)
            return d if isinstance(d, list) else []
    except (OSError, ValueError):
        return []


def _save(tasks):
    tmp = _path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(tasks, f, ensure_ascii=False, indent=1)
    os.replace(tmp, _path())                                  # écriture atomique : jamais de fichier à moitié écrit


def _clean_dt(v):
    if not v:
        return ""
    try:
        return datetime.fromisoformat(str(v)[:16]).isoformat(timespec="minutes")
    except ValueError:
        raise ValueError("date invalide (format AAAA-MM-JJTHH:MM)")


def list_tasks():
    with _lock:
        return [t for t in _load() if not t.get("deleted")]


KINDS = ("task", "class", "exam", "deadline")


def _new_task(title, due="", notes="", duration_min=0, kind="task", batch=""):
    title = (title or "").strip()[:200]
    if not title:
        raise ValueError("titre vide")
    t = {"id": uuid.uuid4().hex[:10], "title": title, "due": _clean_dt(due), "notes": (notes or "")[:1000],
         "duration_min": max(0, min(int(duration_min or 0), 1440)), "done": False, "created": datetime.now().isoformat(timespec="seconds"),
         "updated": time.time()}
    if kind in KINDS and kind != "task":
        t["kind"] = kind
    if batch:
        t["batch"] = str(batch)[:20]
    return t


def add_task(title, due="", notes="", duration_min=0, kind="task", batch=""):
    t = _new_task(title, due, notes, duration_min, kind, batch)
    with _lock:
        tasks = _load()
        tasks.append(t)
        _save(tasks)
    return t


def add_many(items, batch):
    """Import en lot (une seule écriture) : items = [{title, due, notes, duration_min, kind}]. Les doublons (même titre, même échéance) sont ignorés.
    Retourne (ajoutées, ignorées). Le lot peut être retiré d'un coup avec delete_batch."""
    with _lock:
        tasks = _load()
        seen = {(t.get("title", "").strip().lower(), t.get("due", "")) for t in tasks if not t.get("deleted")}
        added, skipped = [], 0
        for it in items:
            t = _new_task(it.get("title"), it.get("due", ""), it.get("notes", ""), it.get("duration_min", 0), it.get("kind", "task"), batch)
            key = (t["title"].lower(), t["due"])
            if key in seen:
                skipped += 1
                continue
            seen.add(key)
            added.append(t)
        tasks.extend(added)
        _save(tasks)
    return added, skipped


def delete_batch(batch):
    """Annule un import : supprime (pierres tombales, comme delete_task) toutes les tâches du lot. Retourne leur nombre."""
    n = 0
    with _lock:
        tasks = _load()
        for t in tasks:
            if t.get("batch") == batch and not t.get("deleted"):
                t.update(deleted=True, updated=time.time(), title="", notes="")
                n += 1
        if n:
            _save(tasks)
    return n


def update_task(tid, **fields):
    with _lock:
        tasks = _load()
        for t in tasks:
            if t["id"] == tid:
                if "title" in fields and fields["title"] is not None:
                    t["title"] = fields["title"].strip()[:200] or t["title"]
                if "due" in fields and fields["due"] is not None:
                    t["due"] = _clean_dt(fields["due"])
                if "notes" in fields and fields["notes"] is not None:
                    t["notes"] = fields["notes"][:1000]
                if "done" in fields and fields["done"] is not None:
                    t["done"] = bool(fields["done"])
                if "duration_min" in fields and fields["duration_min"] is not None:
                    t["duration_min"] = max(0, min(int(fields["duration_min"]), 1440))
                t["updated"] = time.time()
                _save(tasks)
                return t
    raise KeyError(tid)


def delete_task(tid):
    with _lock:
        tasks = _load()
        hit = next((t for t in tasks if t["id"] == tid and not t.get("deleted")), None)
        if not hit:
            raise KeyError(tid)
        hit.update(deleted=True, updated=time.time(), title="", notes="")      # pierre tombale : le téléphone apprend la suppression à sa prochaine synchro
        _save(tasks)


def postpone_task(tid, now=None):
    """« Reporter à demain » : même heure, lendemain de AUJOURD'HUI (une tâche en retard depuis trois jours revient demain, pas hier). Retourne la tâche."""
    now = now or datetime.now()
    with _lock:
        tasks = _load()
        for t in tasks:
            if t["id"] == tid and not t.get("deleted"):
                hm = datetime.fromisoformat(t["due"]).time() if t.get("due") else datetime.strptime("09:00", "%H:%M").time()
                t["due"] = datetime.combine(now.date() + timedelta(days=1), hm).isoformat(timespec="minutes")
                t["updated"] = time.time()
                _save(tasks)
                return dict(t)
    raise KeyError(tid)


def briefing_data(now=None, cfg=None):
    """Matière du briefing quotidien : éléments d'aujourd'hui (cours Zeus, rendus Moodle, tâches), échéances de demain, notes sans date, tâches en retard.
    Sources en cache (aucun téléchargement bloquant inutile)."""
    now = now or datetime.now()
    cfg = cfg or nasko_core.load_config()
    day0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day1, day2 = day0 + timedelta(days=1), day0 + timedelta(days=2)
    zeus = nasko_epita.fetch_sync("zeus", cfg)
    moodle = nasko_epita.fetch_sync("moodle", cfg)
    ext = [_ext_item("zeus", e) for e in nasko_epita.window(zeus["items"], day0, day2)] + [_ext_item("moodle", e) for e in nasko_epita.window(moodle["items"], day0, day2)]
    tasks = [i for i in map(_task_item, list_tasks()) if not i["done"]]
    dated = ext + [i for i in tasks if i["start"]]
    today = [i for i in dated if day0.isoformat() <= i["start"] < day1.isoformat() and not i["done"]]
    tomorrow = [i for i in dated if day1.isoformat() <= i["start"] < day2.isoformat() and i["kind"] in ("exam", "deadline", "task") and not i["done"]]
    overdue = [i for i in tasks if i["start"] and i["start"] < now.isoformat(timespec="minutes") and i["start"] < day0.isoformat()]
    undated = [i for i in tasks if not i["start"]]
    key = lambda i: (i["start"], i["title"])                                                    # noqa: E731
    return {"today": sorted(today, key=key), "tomorrow": sorted(tomorrow, key=key), "overdue": overdue, "undated": undated}


def _task_item(t):
    start = t["due"] or ""
    end = ""
    if start and t.get("duration_min"):
        end = (datetime.fromisoformat(start) + timedelta(minutes=t["duration_min"])).isoformat(timespec="minutes")
    return {"id": "t-" + t["id"], "task_id": t["id"], "source": "manual", "kind": t.get("kind") if t.get("kind") in KINDS else "task", "title": t["title"], "start": start,
            "end": end or start, "all_day": False, "location": "", "notes": t.get("notes", ""), "done": t["done"]}


def _ext_item(source, e):
    return {"id": f"{source}-{e['uid']}", "source": source, "kind": e["kind"] if source == "zeus" else "deadline",
            "title": e["title"], "start": e["start"], "end": e["end"], "all_day": e["all_day"], "location": e.get("location", ""),
            "notes": e.get("description", ""), "url": e.get("url", ""), "done": bool(e.get("done"))}


async def overview(days=7, start=None, force=False):
    """Fenêtre [start, start+days[ : cours Zeus + échéances Moodle + tâches manuelles, triés. `start` = date AAAA-MM-JJ (défaut : aujourd'hui)."""
    import asyncio
    day0 = datetime.fromisoformat(start) if start else datetime.now()
    day0 = day0.replace(hour=0, minute=0, second=0, microsecond=0)
    end = day0 + timedelta(days=max(1, min(days, 42)))
    cfg = nasko_core.load_config()
    zeus, moodle = await asyncio.gather(nasko_epita.fetch("zeus", cfg, force), nasko_epita.fetch("moodle", cfg, force))
    items = [_ext_item("zeus", e) for e in nasko_epita.window(zeus["items"], day0, end)]
    items += [_ext_item("moodle", e) for e in nasko_epita.window(moodle["items"], day0, end)]
    items += [i for i in map(_task_item, list_tasks()) if i["start"] and day0.isoformat() <= i["start"] < end.isoformat()]
    undated = [_task_item(t) for t in list_tasks() if not t["due"] and not t["done"]]
    items.sort(key=lambda i: (i["start"], i["title"]))
    meta = lambda r: {"configured": r["configured"], "error": r["error"], "age_s": r["age_s"]}      # noqa: E731
    return {"from": day0.date().isoformat(), "days": (end - day0).days, "items": items, "undated": undated,
            "sources": {"zeus": meta(zeus), "moodle": meta(moodle)}}


def upcoming_for_agent(horizon_h=72):
    """Pour l'IA proactive : tout ce qui commence dans les `horizon_h` prochaines heures (blocant, appelé depuis un thread)."""
    cfg = nasko_core.load_config()
    now = datetime.now()
    end = now + timedelta(hours=horizon_h)
    z = nasko_epita.fetch_sync("zeus", cfg)
    m = nasko_epita.fetch_sync("moodle", cfg)
    items = [_ext_item("zeus", e) for e in nasko_epita.window(z["items"], now, end)]
    items += [_ext_item("moodle", e) for e in nasko_epita.window(m["items"], now - timedelta(hours=1), end)]
    items += [i for i in map(_task_item, list_tasks()) if i["start"] and not i["done"] and now.isoformat() <= i["start"] < end.isoformat()]
    return [i for i in sorted(items, key=lambda i: i["start"]) if not i["done"]]


# ------------------------------------------------------------------ synchronisation avec l'application mobile (hors ligne d'abord)
def _stamp(t):
    """Date de dernière modification d'une tâche (anciennes tâches sans « updated » : date de création)."""
    if t.get("updated"):
        return float(t["updated"])
    try:
        return datetime.fromisoformat(t.get("created", "")).timestamp()
    except ValueError:
        return 0.0


def _sane(t):
    """Tâche reçue du téléphone : champs connus uniquement, tailles bornées (le contenu vient d'un autre appareil : non fiable)."""
    tid = str(t.get("id", ""))
    if not (6 <= len(tid) <= 40 and all(c.isalnum() or c in "-_" for c in tid)):
        raise ValueError("identifiant invalide")
    if t.get("deleted"):
        return {"id": tid, "deleted": True, "title": "", "notes": "", "due": "", "done": False, "updated": float(t.get("updated") or 0)}
    return {"id": tid, "title": str(t.get("title", ""))[:200].strip() or "(sans titre)", "due": _clean_dt(t.get("due", "")),
            "notes": str(t.get("notes", ""))[:1000], "duration_min": max(0, min(int(t.get("duration_min") or 0), 1440)),
            "done": bool(t.get("done")), "created": str(t.get("created", ""))[:25], "updated": float(t.get("updated") or 0)}


def changed_since(since):
    """Tâches (pierres tombales comprises) modifiées depuis `since` : ce que le PC envoie au cloud."""
    with _lock:
        return [dict(t) for t in _load() if _stamp(t) > float(since or 0)]


def sync(client_tasks, since):
    """Fusion « la dernière modification gagne », par tâche. Retourne (tâches modifiées côté PC depuis `since` -> à appliquer sur le téléphone, horloge du PC).
    Les écarts d'horloge téléphone/PC sont absorbés par le téléphone (il s'aligne sur `now` renvoyé)."""
    now = time.time()
    with _lock:
        tasks = _load()
        by_id = {t["id"]: t for t in tasks}
        accepted = set()
        for raw in client_tasks[:500]:
            try:
                c = _sane(raw)
            except (ValueError, TypeError):
                continue
            cur = by_id.get(c["id"])
            if cur is None or c["updated"] > _stamp(cur):
                c["updated"] = min(c["updated"], now)               # jamais une date dans le futur : elle gagnerait toutes les fusions suivantes
                by_id[c["id"]] = c
                accepted.add(c["id"])
        cut = now - 30 * 86400
        merged = [t for t in by_id.values() if not (t.get("deleted") and _stamp(t) < cut)]        # tombes de plus de 30 jours : oubliées
        _save(merged)
        changed = [t for t in merged if _stamp(t) > since and t["id"] not in accepted]
    return changed, now
