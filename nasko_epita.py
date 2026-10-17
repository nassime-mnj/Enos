"""Données scolaires EPITA : emploi du temps ZEUS (export .ics) et échéances MOODLE (export calendrier .ics ou API web service).

Aucun identifiant de compte n'est stocké : seulement les liens d'export que Zeus / Moodle génèrent eux-mêmes (jeton intégré au lien),
rangés dans nasko_config.json comme les autres clés d'API. Les routes ne renvoient JAMAIS ces liens, seulement un état « configuré ».
Dernier résultat gardé en cache disque (data/epita_cache.json) : l'agenda reste lisible hors ligne.

Pas de dépendance ajoutée : l'analyseur iCalendar ci-dessous couvre les export Zeus/Moodle (VEVENT simples, repliement de lignes,
UTC / TZID / dates flottantes). Les règles RRULE ne sont pas développées (aucun des deux services n'en émet).
"""
import json
import logging
import os
import re
import time
from datetime import date, datetime, timedelta, timezone

import httpx

import nasko_core

log = logging.getLogger("nasko.epita")

TTL = 600                                   # secondes avant de re-télécharger un .ics
_mem = {}                                   # source -> {"t": epoch, "items": [...], "error": str|None}
_CACHE_FILE = "epita_cache.json"


# ------------------------------------------------------------------ fuseau Europe/Paris sans base tzdata (absente de ce PC)
def _last_sunday(year, month):
    d = date(year, month, 31 if month in (3, 10) else 30)
    while d.weekday() != 6:
        d -= timedelta(days=1)
    return d


def paris_offset(utc_dt):
    """+1 h l'hiver, +2 h l'été (du dernier dimanche de mars 01:00 UTC au dernier dimanche d'octobre 01:00 UTC)."""
    y = utc_dt.year
    start = datetime.combine(_last_sunday(y, 3), datetime.min.time(), timezone.utc) + timedelta(hours=1)
    end = datetime.combine(_last_sunday(y, 10), datetime.min.time(), timezone.utc) + timedelta(hours=1)
    return timedelta(hours=2) if start <= utc_dt < end else timedelta(hours=1)


def paris_to_utc(naive):
    guess = naive.replace(tzinfo=timezone.utc) - timedelta(hours=1)
    return (naive - paris_offset(guess)).replace(tzinfo=timezone.utc)


def to_paris(utc_dt):
    return (utc_dt + paris_offset(utc_dt)).replace(tzinfo=None)


# ------------------------------------------------------------------ analyseur iCalendar
def _unfold(text):
    return re.sub(r"\r?\n[ \t]", "", text).splitlines()


def _unescape(v):
    return v.replace("\\n", "\n").replace("\\N", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")


def _parse_dt(value, params):
    """-> (datetime heure de Paris sans fuseau, journée_entière). Renvoie (None, False) si illisible."""
    value = value.strip()
    try:
        if params.get("VALUE") == "DATE" or re.fullmatch(r"\d{8}", value):
            return datetime.strptime(value[:8], "%Y%m%d"), True
        if value.endswith("Z"):
            return to_paris(datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)), False
        naive = datetime.strptime(value, "%Y%m%dT%H%M%S")
        tzid = params.get("TZID", "")
        if tzid in ("UTC", "GMT", "Etc/UTC"):
            return to_paris(naive.replace(tzinfo=timezone.utc)), False
        return naive, False                                           # Europe/Paris ou flottante : déjà l'heure murale
    except ValueError:
        return None, False


def parse_ics(text):
    """Texte .ics -> liste d'événements triés : {uid, title, start, end, all_day, location, description, kind}."""
    events, cur = [], None
    for line in _unfold(text):
        if line == "BEGIN:VEVENT":
            cur = {}
        elif line == "END:VEVENT":
            if cur is not None and "DTSTART" in cur:
                events.append(cur)
            cur = None
        elif cur is not None and ":" in line:
            head, _, val = line.partition(":")
            name, *plist = head.split(";")
            params = dict(p.split("=", 1) for p in plist if "=" in p)
            cur[name.upper()] = (val, params)
    out = []
    for ev in events:
        start, all_day = _parse_dt(*ev["DTSTART"])
        if not start:
            continue
        end = _parse_dt(*ev["DTEND"])[0] if "DTEND" in ev else None
        if end is None:
            end = start + (timedelta(days=1) if all_day else timedelta(hours=1))
        title = _unescape(ev.get("SUMMARY", ("", {}))[0]).strip() or "(sans titre)"
        desc = _unescape(ev.get("DESCRIPTION", ("", {}))[0]).strip()
        out.append({
            "uid": ev.get("UID", ("", {}))[0] or f"{title}@{start.isoformat()}",
            "title": title, "start": start.isoformat(timespec="minutes"), "end": end.isoformat(timespec="minutes"),
            "all_day": all_day, "location": _unescape(ev.get("LOCATION", ("", {}))[0]).strip(),
            "description": desc[:600], "kind": classify(title, desc)})
    out.sort(key=lambda e: e["start"])
    return out


_EXAM = re.compile(r"\b(contr[oô]le|partiel|examen|exam|soutenance|DS|QCM|TP not[ée]|évaluation|evaluation|rattrapage)\b", re.I)
_DUE = re.compile(r"(rendu|d[ée]p[oô]t|due|deadline|remise|[ée]ch[ée]ance|auto-?[ée]valuation|ferme|closes|devoir)", re.I)


def classify(title, desc=""):
    """exam | deadline | class : sert au code couleur et à l'IA proactive."""
    if _EXAM.search(title):
        return "exam"
    if _DUE.search(title) or _DUE.search(desc[:200]):
        return "deadline"
    return "class"


# ------------------------------------------------------------------ téléchargement asynchrone + cache
def _cache_path():
    import nasko_roles
    return os.path.join(nasko_core.data_dir(), nasko_roles.data_name(_CACHE_FILE))


def _load_disk():
    try:
        with open(_cache_path(), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save_disk(source, items):
    data = _load_disk()
    data[source] = {"t": time.time(), "items": items}
    try:
        with open(_cache_path(), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    except OSError as e:
        log.warning("cache %s non écrit : %s", source, e)


def _check_url(url):
    if not re.match(r"https://[^\s]+$", url or ""):
        raise ValueError("le lien doit commencer par https://")
    return url


async def _download(url):
    async with httpx.AsyncClient(timeout=20, follow_redirects=True, verify=nasko_core.ssl_context()) as c:
        r = await c.get(_check_url(url), headers={"User-Agent": "ENOS/3 (agenda)"})
        r.raise_for_status()
        if "BEGIN:VCALENDAR" not in r.text[:500]:
            raise ValueError("le lien n'a pas renvoyé un fichier .ics (jeton expiré ?)")
        return r.text


async def _moodle_ws(base, token):
    """API web service Moodle : échéances d'actions (devoirs, quiz…) des 60 prochains jours + cours récents."""
    base = base.rstrip("/") + "/webservice/rest/server.php"
    common = {"wstoken": token, "moodlewsrestformat": "json"}
    now = int(time.time())
    async with httpx.AsyncClient(timeout=20, follow_redirects=True, verify=nasko_core.ssl_context()) as c:
        async def call(fn, **kw):
            r = await c.post(base, data={**common, "wsfunction": fn, **kw})
            r.raise_for_status()
            j = r.json()
            if isinstance(j, dict) and j.get("exception"):
                raise ValueError(j.get("message") or j["exception"])
            return j
        ev = await call("core_calendar_get_action_events_by_timesort", timesortfrom=now - 86400, timesortto=now + 60 * 86400, limitnum=50)
        items = []
        for e in ev.get("events", []):
            st = to_paris(datetime.fromtimestamp(e.get("timestart") or e["timesort"], timezone.utc))
            items.append({"uid": f"moodle-{e['id']}", "title": e.get("name", "Échéance"), "start": st.isoformat(timespec="minutes"),
                          "end": st.isoformat(timespec="minutes"), "all_day": False, "location": (e.get("course") or {}).get("fullname", ""),
                          "description": "", "kind": "deadline", "url": e.get("url", ""), "done": bool((e.get("action") or {}).get("actionable") is False)})
        items.sort(key=lambda x: x["start"])
        return items


def _config_for(source, cfg):
    if source == "zeus":
        return cfg.get("zeus_ics_url", "")
    return cfg.get("moodle_ics_url", "") or (cfg.get("moodle_base_url", "") and cfg.get("moodle_token", ""))


async def fetch(source, cfg=None, force=False):
    """source = 'zeus' | 'moodle'. Retourne {configured, items, error, age_s}. Ne lève jamais : hors ligne -> dernier cache disque."""
    cfg = cfg or nasko_core.load_config()
    if not _config_for(source, cfg):
        return {"configured": False, "items": [], "error": None, "age_s": None}
    m = _mem.get(source)
    if m and not force and time.time() - m["t"] < TTL and not m["error"]:
        return {"configured": True, "items": m["items"], "error": None, "age_s": int(time.time() - m["t"])}
    try:
        if source == "moodle" and not cfg.get("moodle_ics_url"):
            items = await _moodle_ws(cfg["moodle_base_url"], cfg["moodle_token"])
        else:
            url = cfg["zeus_ics_url"] if source == "zeus" else cfg["moodle_ics_url"]
            items = parse_ics(await _download(url))
        _mem[source] = {"t": time.time(), "items": items, "error": None}
        _save_disk(source, items)
        return {"configured": True, "items": items, "error": None, "age_s": 0}
    except Exception as e:                                            # noqa: BLE001 — hors ligne / lien expiré : on retombe sur le cache
        err = re.sub(r"https?://\S+", "<lien>", str(e))[:200] or e.__class__.__name__    # jamais le lien (il contient le jeton)
        log.warning("%s : %s", source, err)
        disk = _load_disk().get(source) or {}
        _mem[source] = {"t": time.time() - TTL + 60, "items": disk.get("items", []), "error": err}    # nouvel essai dans 1 min
        return {"configured": True, "items": disk.get("items", []), "error": err,
                "age_s": int(time.time() - disk["t"]) if disk.get("t") else None}


def fetch_sync(source, cfg=None):
    """Version bloquante pour le thread de l'agent proactif."""
    import asyncio
    return asyncio.run(fetch(source, cfg))


def window(items, start, end):
    """Événements qui chevauchent [start, end[ (datetimes naïfs, heure de Paris)."""
    s, e = start.isoformat(timespec="minutes"), end.isoformat(timespec="minutes")
    return [i for i in items if i["start"] < e and i["end"] > s]


def public_status(cfg=None):
    cfg = cfg or nasko_core.load_config()
    return {"zeus": bool(cfg.get("zeus_ics_url")), "moodle": bool(_config_for("moodle", cfg)),
            "moodle_mode": "ics" if cfg.get("moodle_ics_url") else ("api" if cfg.get("moodle_token") else None)}
