"""Dépôt Intranet — SUIVI DE LA FORGE par lien d'agenda .ics (comme Zeus / Moodle) : pas d'API, pas de jeton à gérer.

L'utilisateur colle l'adresse .ics de sa Forge ; ce module la télécharge (cache + dernier résultat conservé hors ligne), l'analyse (iCalendar : VEVENT et VTODO, fuseaux
TZID/UTC/flottants, journées entières, lignes repliées, échappements, RRULE simples avec EXDATE) et en déduit pour chaque rendu / piscine : début, ÉCHÉANCE ABSOLUE
(`deadline_ts`, pour un compte à rebours à la seconde côté interface), temps restant, statut (upcoming / running / closed / submitted) et avancement dans le temps.

Sécurité : le lien .ics contient très souvent un jeton secret → il est stocké comme clé privée de profil, JAMAIS renvoyé (on n'expose que l'hôte), ni écrit dans un
message d'erreur ou un journal ; https obligatoire (http seulement vers 127.0.0.1 / localhost pour les tests) ; ni identifiants dans l'URL ; réponse ≤ 3 Mo ; au plus 3
redirections, toutes en https. Tout texte venant du fichier est du texte brut (l'interface utilise textContent) : HTML retiré, caractères de contrôle supprimés, tailles bornées.
"""
import html
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone, tzinfo
from urllib.parse import urljoin, urlsplit

import nasko_core

KEY_ICS = "depot_forge_ics"
KEY_REFRESH = "depot_forge_refresh_s"
MAX_BODY = 3 * 1024 * 1024
TIMEOUT = 12
WINDOW_PAST = timedelta(days=3)           # rendus terminés depuis moins de 3 jours : encore affichés
WINDOW_FUTURE = timedelta(days=180)
POINT_RUNNING_DAYS = 14                    # échéance « instantanée » (rendu à 23h59) : considérée en cours dans les 14 derniers jours
MAX_ITEMS = 300
_LOCAL_HOSTS = ("127.0.0.1", "localhost")


class ForgeError(ValueError):
    """Message FR lisible, affichable tel quel (jamais le lien .ics)."""


# ============================================================================ texte
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_TAG = re.compile(r"<[^<>]{0,300}>")


def _clean(v, limit=200, multiline=False):
    s = html.unescape(str(v or ""))
    s = _TAG.sub(" ", s)
    s = _CTRL.sub("", s)
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    if not multiline:
        s = s.replace("\n", " ")
    s = re.sub(r"\n{3,}", "\n\n", s).strip()
    return s[:limit].rstrip() if len(s) > limit else s


def _unescape(v):
    out, i = [], 0
    while i < len(v):
        c = v[i]
        if c == "\\" and i + 1 < len(v):
            n = v[i + 1]
            out.append("\n" if n in "nN" else n)
            i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


# ============================================================================ fuseaux
_EU_ZONES = {"Europe/Paris", "Europe/Brussels", "Europe/Berlin", "Europe/Madrid", "Europe/Rome", "Europe/Amsterdam", "Europe/Zurich", "Europe/Luxembourg", "Europe/Vienna", "Europe/Prague", "Europe/Warsaw"}


def _last_sunday(y, m):
    d = date(y, m + 1, 1) - timedelta(days=1) if m < 12 else date(y, 12, 31)
    return d - timedelta(days=(d.weekday() + 1) % 7)


class _EuTz(tzinfo):
    """Repli SANS base de fuseaux (Windows sans le paquet tzdata) : règles européennes CET (UTC+1) / CEST (UTC+2, du dernier dimanche de mars au dernier dimanche d'octobre)."""

    def utcoffset(self, dt):
        n = dt.replace(tzinfo=None)
        y = n.year
        start, end = datetime(y, 3, _last_sunday(y, 3).day, 2), datetime(y, 10, _last_sunday(y, 10).day, 3)
        return timedelta(hours=2) if start <= n < end else timedelta(hours=1)

    def dst(self, dt):
        return timedelta(0)

    def tzname(self, dt):
        return "CET"


_tz_cache = {}


def _tzinfo(tzid):
    """tzinfo d'un TZID (ou None → heure locale du PC)."""
    if not tzid:
        return None
    if tzid in _tz_cache:
        return _tz_cache[tzid]
    tz = None
    if tzid in ("UTC", "GMT", "Etc/UTC", "Z"):
        tz = timezone.utc
    else:
        try:
            from zoneinfo import ZoneInfo
            tz = ZoneInfo(tzid)
        except Exception:                                               # noqa: BLE001 — pas de base tz (Windows sans tzdata) ou nom inconnu
            tz = _EuTz() if tzid in _EU_ZONES else None
    _tz_cache[tzid] = tz
    return tz


def _local_tz():
    return datetime.now().astimezone().tzinfo


def _aware(naive, tz):
    return naive.replace(tzinfo=tz or _local_tz())


# ============================================================================ iCalendar
def _unfold(text):
    text = text.lstrip("﻿")
    return re.sub(r"\r?\n[ \t]", "", text).replace("\r\n", "\n").replace("\r", "\n").split("\n")


def _parse_value(value, params):
    """-> (datetime aware | date, all_day) ou (None, False)."""
    value = value.strip()
    try:
        if params.get("VALUE", "").upper() == "DATE" or re.fullmatch(r"\d{8}", value):
            return datetime.strptime(value[:8], "%Y%m%d").date(), True
        if value.endswith(("Z", "z")):
            return datetime.strptime(value[:-1], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc), False
        naive = datetime.strptime(value, "%Y%m%dT%H%M%S")
        return _aware(naive, _tzinfo(params.get("TZID", "").strip('"'))), False
    except ValueError:
        return None, False


def _split_prop(line):
    """NOM;P=V;P="a:b":valeur -> (NOM, {P: V}, valeur) en respectant les guillemets."""
    in_q, idx = False, -1
    for i, ch in enumerate(line):
        if ch == '"':
            in_q = not in_q
        elif ch == ":" and not in_q:
            idx = i
            break
    if idx < 0:
        return None
    head, val = line[:idx], line[idx + 1:]
    parts, cur, in_q = [], "", False
    for ch in head:
        if ch == '"':
            in_q = not in_q
        if ch == ";" and not in_q:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    params = {}
    for p in parts[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            params[k.upper()] = v.strip('"')
    return parts[0].upper(), params, val


def parse_ics(text, now=None):
    """Texte .ics -> liste de composants bruts [{uid, kind: 'VEVENT'|'VTODO', summary, description, location, url, status, start, end, all_day, percent, rrule, exdates}].
    Lève ForgeError si ce n'est pas un calendrier. Les composants illisibles sont ignorés."""
    if "BEGIN:VCALENDAR" not in (text or "")[:2000].upper():
        raise ForgeError("Le lien n'a pas renvoyé un fichier d'agenda .ics (lien expiré ou incorrect ?).")
    comps, cur, depth = [], None, 0
    for line in _unfold(text):
        u = line.strip().upper()
        if u in ("BEGIN:VEVENT", "BEGIN:VTODO") and cur is None:
            cur = {"_kind": u[6:], "_props": {}, "_ex": []}
            continue
        if cur is not None and u in ("END:VEVENT", "END:VTODO"):
            comps.append(cur)
            cur = None
            continue
        if cur is None:
            continue
        if u.startswith("BEGIN:"):                                     # VALARM imbriquée : ignorée
            depth += 1
            continue
        if u.startswith("END:"):
            depth = max(0, depth - 1)
            continue
        if depth:
            continue
        sp = _split_prop(line)
        if not sp:
            continue
        name, params, val = sp
        if name == "EXDATE":
            for v in val.split(","):
                d, _ = _parse_value(v, params)
                if d is not None:
                    cur["_ex"].append(d)
        else:
            cur["_props"].setdefault(name, (val, params))
        if len(comps) > 5000:
            break
    out = []
    for c in comps:
        p = c["_props"]
        kind = c["_kind"]
        sv = p.get("DTSTART") or (p.get("DUE") if kind == "VTODO" else None)
        if not sv:
            continue
        start, all_day = _parse_value(*sv)
        if start is None:
            continue
        ev = p.get("DTEND") or p.get("DUE")
        end = None
        if ev:
            end, _ = _parse_value(*ev)
        if end is None and p.get("DURATION"):
            m = re.fullmatch(r"([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?", p["DURATION"][0].strip())
            if m:
                w, d, h, mi, s = (int(x or 0) for x in m.groups()[1:])
                end = start + timedelta(weeks=w, days=d, hours=h, minutes=mi, seconds=s) if isinstance(start, datetime) else start + timedelta(weeks=w, days=d or 1)
        get = lambda k: _unescape(p[k][0]) if k in p else ""    # noqa: E731
        pc = p.get("PERCENT-COMPLETE")
        out.append({"uid": get("UID") or f"{get('SUMMARY')}@{start}", "kind": kind, "summary": _clean(get("SUMMARY"), 160) or "(sans titre)", "description": _clean(get("DESCRIPTION"), 400, True),
                    "location": _clean(get("LOCATION"), 120), "url": _safe_url(get("URL")), "status": get("STATUS").upper().strip(), "start": start, "end": end, "all_day": all_day,
                    "percent": int(pc[0]) if pc and pc[0].strip().isdigit() else None, "rrule": p["RRULE"][0] if "RRULE" in p else "", "exdates": c["_ex"]})
    return out


def _safe_url(u):
    u = (u or "").strip()
    return u if re.match(r"^https?://[^\s<>\"']{1,500}$", u, re.I) else None


# ---- récurrences simples (RRULE) : FREQ DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, COUNT, UNTIL, BYDAY (hebdo)
_DAYS = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


def _expand(ev, lo, hi):
    """Occurrences (start, end) d'un composant dans [lo, hi] (datetimes aware). Sans RRULE : l'unique occurrence."""
    start, end = ev["start"], ev["end"]
    base = _to_dt(start)
    dur = (_to_dt(end) - base) if end is not None else timedelta(0)
    if not ev["rrule"]:
        return [(base, base + dur)]
    rule = dict(kv.split("=", 1) for kv in ev["rrule"].split(";") if "=" in kv)
    freq = rule.get("FREQ", "").upper()
    if freq not in ("DAILY", "WEEKLY", "MONTHLY", "YEARLY"):
        return [(base, base + dur)]
    interval = max(1, int(rule.get("INTERVAL", "1") or 1)) if str(rule.get("INTERVAL", "1")).isdigit() else 1
    count = int(rule["COUNT"]) if str(rule.get("COUNT", "")).isdigit() else None
    until = None
    if rule.get("UNTIL"):
        u, _ = _parse_value(rule["UNTIL"], {})
        until = _to_dt(u) + (timedelta(days=1) if isinstance(u, date) and not isinstance(u, datetime) else timedelta(0)) if u is not None else None
    byday = [_DAYS[d[-2:]] for d in rule.get("BYDAY", "").split(",") if d[-2:] in _DAYS]
    ex = {_to_dt(x).replace(microsecond=0) for x in ev["exdates"]}
    wall = base.replace(tzinfo=None)
    tz = base.tzinfo
    res, n, cur = [], 0, wall
    for _ in range(4000):
        cands = []
        if freq == "WEEKLY" and byday:
            monday = cur - timedelta(days=cur.weekday())
            cands = [monday + timedelta(days=d) for d in sorted(byday)]
            cands = [c for c in cands if c >= wall]
        else:
            cands = [cur]
        for c in cands:
            occ = c.replace(tzinfo=tz)
            if until is not None and occ > until:
                return res
            n += 1
            if count is not None and n > count:
                return res
            if occ.replace(microsecond=0) not in ex and occ + dur >= lo and occ <= hi:
                res.append((occ, occ + dur))
            if occ > hi or len(res) >= 400:
                return res
        if freq == "DAILY":
            cur += timedelta(days=interval)
        elif freq == "WEEKLY":
            cur += timedelta(weeks=interval)
        elif freq == "MONTHLY":
            m = cur.month - 1 + interval
            try:
                cur = cur.replace(year=cur.year + m // 12, month=m % 12 + 1)
            except ValueError:
                cur = cur.replace(year=cur.year + m // 12, month=m % 12 + 1, day=28)
        else:
            try:
                cur = cur.replace(year=cur.year + interval)
            except ValueError:
                cur = cur.replace(year=cur.year + interval, day=28)
        if freq == "WEEKLY" and byday:
            cur = cur - timedelta(days=cur.weekday())
    return res


def _to_dt(v):
    if isinstance(v, datetime):
        return v
    return datetime(v.year, v.month, v.day, tzinfo=_local_tz())


# ============================================================================ normalisation
_POOL = re.compile(r"piscine|pool|bootcamp|rush", re.I)
_EXAM = re.compile(r"\b(exam|examen|soutenance|partiel|contr[oô]le|[ée]valuation|defense|défense|qcm)\b", re.I)
_PROJECT = re.compile(r"projet|project|rendu|exercice|\bex\d|\btp\b|devoir|deadline|due|d[ée]p[oô]t|submission|livrable|libft|minishell", re.I)


def _kind(title, desc):
    if _POOL.search(title):
        return "pool"
    if _EXAM.search(title):
        return "exam"
    if _PROJECT.search(title) or _PROJECT.search(desc[:200]):
        return "project"
    return "other"


def forge_normalize(events, now=None):
    """Composants bruts -> éléments du tableau de bord (triés : en cours par échéance, puis à venir, puis terminés récemment)."""
    now = now if now is not None else time.time()
    nowdt = datetime.fromtimestamp(now, tz=timezone.utc)
    lo, hi = nowdt - WINDOW_PAST - timedelta(days=60), nowdt + WINDOW_FUTURE
    items = []
    for ev in events:
        if ev["status"] == "CANCELLED":
            continue
        try:
            occs = _expand(ev, lo, hi)
        except Exception:                                               # noqa: BLE001 — récurrence illisible : on ignore ce composant
            continue
        for k, (s, e) in enumerate(occs):
            all_day = ev["all_day"]
            if all_day:
                dl = (e - timedelta(seconds=1)) if e > s else s + timedelta(days=1) - timedelta(seconds=1)
            else:
                dl = e if e > s else s
            span = (dl - s).total_seconds()
            ts = dl.timestamp()
            if dl < nowdt - WINDOW_PAST or s > hi:
                continue
            remaining = max(0, int(ts - now))
            point = span < 3600
            if ev["kind"] == "VTODO" and (ev["status"] == "COMPLETED" or ev["percent"] == 100):
                status = "submitted"
            elif ts < now:
                status = "closed"
            elif point:
                status = "running" if ts - now <= POINT_RUNNING_DAYS * 86400 else "upcoming"
            else:
                status = "running" if s.timestamp() <= now else "upcoming"
            prog = ev["percent"]
            if prog is None and not point and status == "running":
                prog = int(max(0, min(100, 100 * (now - s.timestamp()) / span)))
            elif prog is None and status in ("closed", "submitted"):
                prog = 100
            title = ev["summary"]
            items.append({"id": ev["uid"][:120] + (f"#{k}" if len(occs) > 1 else ""), "name": title, "kind": _kind(title, ev["description"]), "status": status,
                          "start": None if point else s.isoformat(timespec="seconds"), "deadline": dl.isoformat(timespec="seconds"), "deadline_ts": ts, "remaining_s": remaining,
                          "overdue": ts < now and status != "submitted", "progress": prog, "url": ev["url"], "location": ev["location"], "description": ev["description"][:240], "all_day": all_day})
    order = {"running": 0, "upcoming": 1, "closed": 2, "submitted": 3}
    items.sort(key=lambda i: (order.get(i["status"], 9), i["deadline_ts"] if i["status"] in ("running", "upcoming") else -i["deadline_ts"]))
    return items[:MAX_ITEMS]


# ============================================================================ configuration
def _val_ics(v):
    v = (v or "").strip()
    if v.lower().startswith("webcal://"):
        v = "https://" + v[9:]
    if not v:
        return ""
    if len(v) > 2000 or re.search(r"\s", v):
        raise ForgeError("Lien invalide.")
    sp = urlsplit(v)
    if sp.username or sp.password:
        raise ForgeError("Le lien ne doit pas contenir d'identifiants (utilise le lien .ics secret de la Forge).")
    if sp.scheme == "https" and sp.hostname:
        return v
    if sp.scheme == "http" and sp.hostname in _LOCAL_HOSTS:
        return v
    raise ForgeError("Le lien doit commencer par https:// (ou webcal://).")


def _val_refresh(v):
    try:
        n = int(v)
    except (TypeError, ValueError):
        raise ForgeError("Intervalle d'actualisation invalide.")
    if not 60 <= n <= 3600:
        raise ForgeError("L'intervalle d'actualisation doit être entre 60 et 3600 secondes.")
    return n


def forge_config():
    cfg = nasko_core.load_config()
    ics = cfg.get(KEY_ICS) or ""
    host = (urlsplit(ics).hostname or "") if ics else ""
    return {"ics_set": bool(ics), "host": host, "refresh_s": int(cfg.get(KEY_REFRESH) or 300)}


def forge_set_config(values):
    """values : {ics|ics_url|depot_forge_ics, refresh_s}. Un lien vide efface le lien. Lève ForgeError (FR)."""
    patch = {}
    for k in ("ics", "ics_url", KEY_ICS):
        if k in values:
            patch[KEY_ICS] = _val_ics(values[k])
    for k in ("refresh_s", KEY_REFRESH):
        if k in values:
            patch[KEY_REFRESH] = _val_refresh(values[k])
    if patch:
        nasko_core.update_config(patch)
        _reset()
    return forge_config()


def forge_clear():
    nasko_core.update_config({KEY_ICS: ""})
    _reset()
    return forge_config()


# ============================================================================ réseau
_lock = threading.RLock()
_cache = {"key": None, "at": 0.0, "result": None}
_clock = time.monotonic


def _reset():
    with _lock:
        _cache.update(key=None, at=0.0, result=None)


class _Resp:
    def __init__(self, code, headers, content):
        self.status_code, self.headers, self.content = code, headers, content


def _default_http(url, headers=None, timeout=TIMEOUT):
    import httpx
    with httpx.Client(timeout=timeout, follow_redirects=False, verify=nasko_core.ssl_context()) as c:
        with c.stream("GET", url, headers=headers or {}) as r:
            buf = bytearray()
            for chunk in r.iter_bytes():
                buf += chunk
                if len(buf) > MAX_BODY:
                    raise ForgeError("Fichier d'agenda trop gros (3 Mo maximum).")
            return _Resp(r.status_code, dict(r.headers), bytes(buf))


def _scrub(msg, url):
    s = str(msg)
    for part in {url, urlsplit(url).query, urlsplit(url).path}:
        if part and len(part) > 6:
            s = s.replace(part, "<lien>")
    return re.sub(r"https?://\S+", "<lien>", s)[:200]


def _download(url, http):
    cur = url
    for _ in range(4):
        r = http(cur, {"User-Agent": "ENOS/3 (forge)", "Accept": "text/calendar, */*"}, TIMEOUT)
        if r.status_code in (301, 302, 303, 307, 308):
            loc = next((v for k, v in (r.headers or {}).items() if k.lower() == "location"), "")
            nxt = urljoin(cur, loc) if loc else ""
            sp = urlsplit(nxt)
            if not nxt or not (sp.scheme == "https" or (sp.scheme == "http" and sp.hostname in _LOCAL_HOSTS)):
                raise ForgeError("Redirection refusée (le lien doit rester en https).")
            cur = nxt
            continue
        if r.status_code in (401, 403):
            raise ForgeError("Lien refusé par la Forge (jeton expiré ? régénère le lien .ics).")
        if r.status_code == 404:
            raise ForgeError("Lien introuvable (404) : vérifie l'adresse .ics.")
        if r.status_code >= 400:
            raise ForgeError(f"La Forge a répondu {r.status_code}.")
        if len(r.content) > MAX_BODY:
            raise ForgeError("Fichier d'agenda trop gros (3 Mo maximum).")
        return r.content.decode("utf-8", "replace")
    raise ForgeError("Trop de redirections.")


def forge_fetch(http=None, now=None, force=False):
    """-> {items, fetched_at, error|None, stale}. Ne lève jamais : en cas d'échec, le dernier résultat est conservé (stale=True). `http(url, headers, timeout)` injectable."""
    cfg = nasko_core.load_config()
    url = cfg.get(KEY_ICS) or ""
    if not url:
        return {"items": [], "fetched_at": None, "error": None, "stale": False}
    refresh = int(cfg.get(KEY_REFRESH) or 300)
    with _lock:
        c = _cache
        if not force and c["result"] and c["key"] == url and _clock() - c["at"] < refresh and not c["result"]["error"]:
            res = dict(c["result"])
            res["items"] = forge_normalize(res.pop("_events"), now) if "_events" in res else res["items"]
            return res
    try:
        events = parse_ics(_download(url, http or _default_http))
        t = now if now is not None else time.time()
        res = {"items": forge_normalize(events, t), "fetched_at": t, "error": None, "stale": False, "_events": events}
        with _lock:
            _cache.update(key=url, at=_clock(), result=res)
        out = dict(res)
        out.pop("_events")
        return out
    except Exception as e:                                              # noqa: BLE001
        msg = e if isinstance(e, ForgeError) else f"Forge injoignable ({e.__class__.__name__})"
        err = _scrub(msg, url)
        with _lock:
            old = _cache["result"] if _cache["key"] == url else None
            if old:
                evs = old.get("_events", [])
                _cache["at"] = _clock() - refresh + 30                # nouvel essai dans 30 s
                return {"items": forge_normalize(evs, now), "fetched_at": old["fetched_at"], "error": err, "stale": True}
        return {"items": [], "fetched_at": None, "error": err, "stale": False}


def forge_status():
    c = forge_config()
    c["configured"] = c["ics_set"]
    return c
