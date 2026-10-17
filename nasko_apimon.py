"""API CONTROL PANEL : suivi de la consommation de vos clés API (ElevenLabs, Groq, OpenAI, Anthropic, …) et de leurs dates de reset.

Deux sources de données, toujours indiquées dans la carte (« source ») :
  * « API » : interrogation directe du service (ElevenLabs : /v1/user/subscription -> caractères utilisés / quota / prochain reset EXACT) ;
  * « estimation locale » : compteur E.N.O.S. (data/api_usage.json) alimenté à chaque requête par nasko_llm / nasko_stt via `record()` (tokens entrants/sortants,
    requêtes, secondes d'audio Whisper), plus les en-têtes de limite renvoyés par le service quand il en donne (Groq : x-ratelimit-*).

AJOUTER UN SERVICE (architecture modulaire) :
  1. dans ce fichier : une fonction `def _mon_service(cfg): return [card, ...]` décorée par `@register` (une carte par compte ; `[]` = rien à afficher) ; utilisez
     `_local_card(...)` pour un service sans endpoint de quota (compteur local + test de la clé) ;
  2. OU sans coder : dans nasko_config.json, `"api_monitor_extra": [{"id": "mistral", "label": "Mistral", "key_field": "mistral_api_key",
     "check_url": "https://api.mistral.ai/v1/models", "monthly_token_limit": 0}]` ;
  3. pour que ses tokens soient comptés : appeler `nasko_apimon.record("mistral", tokens_in, tokens_out)` après chaque requête.
Une carte = {id, label, status, source, bars:[{label, used, limit, pct, level, text}], reset_text, reset_iso, lines:[…], error}. Les clés ne sortent JAMAIS d'ici.
status : ok · offline (serveur injoignable) · bad_key (clé invalide / sans permission) · unconfigured · estimate (estimation locale sans test réseau).
"""
import datetime as dt
import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

from nasko_core import data_dir, load_config, ssl_context

log = logging.getLogger("nasko.apimon")

FILE = os.path.join(data_dir(), "api_usage.json")
TIMEOUT = 8.0                 # s par requête de quota
CACHE_S = 15.0                # le panneau peut rafraîchir souvent : on ne harcèle pas les services
KEEP_DAYS = 70
WARN, DANGER = 60.0, 85.0     # % : vert -> orange -> rouge

_lock = threading.Lock()
_state = None
_cache = {"t": 0.0, "cards": None}
MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]


# ----------------------------------------------------------------------------- compteurs locaux (JSON)
def _utc_day(ts=None):
    return dt.datetime.fromtimestamp(ts or time.time(), dt.timezone.utc).strftime("%Y-%m-%d")


def _load():
    global _state
    if _state is None:
        try:
            with open(FILE, encoding="utf-8") as f:
                _state = json.load(f)
        except (OSError, ValueError):
            _state = {}
        _state.setdefault("days", {})
        _state.setdefault("headers", {})
    return _state


def _save():
    try:
        tmp = FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_state, f, ensure_ascii=False)
        os.replace(tmp, FILE)
    except OSError as e:
        log.warning("api_usage.json non écrit : %s", e)


_RL = ("x-ratelimit-limit-requests", "x-ratelimit-remaining-requests", "x-ratelimit-reset-requests",
       "x-ratelimit-limit-tokens", "x-ratelimit-remaining-tokens", "x-ratelimit-reset-tokens")


def record(pid, tokens_in=0, tokens_out=0, requests=1, audio_s=0.0, headers=None):
    """Compte une requête pour le service `pid` (jamais d'exception : le suivi ne doit pas gêner l'appel d'API)."""
    try:
        with _lock:
            s = _load()
            day = s["days"].setdefault(_utc_day(), {})
            p = day.setdefault(pid, {"in": 0, "out": 0, "req": 0, "audio_s": 0.0})
            p["in"] += int(tokens_in or 0)
            p["out"] += int(tokens_out or 0)
            p["req"] += int(requests or 0)
            p["audio_s"] = round(p["audio_s"] + float(audio_s or 0.0), 2)
            if headers:
                h = {k: str(headers.get(k)) for k in _RL if headers.get(k) is not None}
                if h:
                    h["at"] = time.time()
                    s["headers"][pid] = h
            for d in sorted(s["days"])[:-KEEP_DAYS]:
                del s["days"][d]
            _save()
    except Exception as e:                                           # noqa: BLE001
        log.warning("compteur API : %s", e)


def note_llm(cfg, data, headers):
    """Appelé par nasko_llm après une réponse : lit « usage » (OpenAI/Groq : prompt_tokens / completion_tokens ; Anthropic : input_tokens / output_tokens)."""
    try:
        u = (data or {}).get("usage") or {}
        tin = u.get("prompt_tokens", u.get("input_tokens", 0)) or 0
        tout = u.get("completion_tokens", u.get("output_tokens", 0)) or 0
        record(llm_pid(cfg), tin, tout, 1, 0.0, headers)
    except Exception as e:                                           # noqa: BLE001
        log.warning("compteur LLM : %s", e)


def _sum(pid, since_prefix):
    s = _load()
    t = {"in": 0, "out": 0, "req": 0, "audio_s": 0.0}
    for d, v in s["days"].items():
        if d.startswith(since_prefix) and pid in v:
            for k in t:
                t[k] += v[pid].get(k, 0)
    return t


def day_total(pid):
    with _lock:
        return _sum(pid, _utc_day())


def month_total(pid):
    with _lock:
        return _sum(pid, _utc_day()[:7])


def llm_pid(cfg):
    """Quel service reçoit les requêtes LLM, d'après la configuration."""
    base = (cfg.get("llm_base_url") or "").lower()
    prov = (cfg.get("llm_provider") or "").lower()
    if prov == "anthropic":
        return "anthropic"
    if "groq.com" in base:
        return "groq"
    if "api.openai.com" in base or (prov == "openai" and not base):
        return "openai"
    return "llm"


def stt_pid(cfg):
    base = (cfg.get("stt_base_url") or cfg.get("llm_base_url") or "").lower()
    return "groq" if "groq.com" in base else "openai" if "openai.com" in base or not base else "llm"


# ----------------------------------------------------------------------------- mise en forme
def _n(x):
    return f"{int(round(x)):,}".replace(",", " ")


def _level(pct):
    return "danger" if pct >= DANGER else "warn" if pct >= WARN else "ok"


def _bar(label, used, limit, unit):
    pct = max(0.0, min(100.0, 100.0 * used / limit)) if limit else 0.0
    return {"label": label, "used": used, "limit": limit, "pct": round(pct, 1), "level": _level(pct), "text": f"{_n(used)} / {_n(limit)} {unit}"}


def _reset_text(ts, estimate=False):
    d = dt.datetime.fromtimestamp(ts)
    left = max(0, ts - time.time())
    rel = f"{int(left // 86400)} j {int(left % 86400 // 3600)} h" if left >= 86400 else f"{int(left // 3600)} h {int(left % 3600 // 60)} min"
    return f"Reset le {d.day} {MONTHS[d.month - 1]} à {d.hour:02d}h{d.minute:02d} (dans {rel})" + (" · estimation" if estimate else "")


def _next_utc_midnight():
    now = dt.datetime.now(dt.timezone.utc)
    return (now.replace(hour=0, minute=0, second=0, microsecond=0) + dt.timedelta(days=1)).timestamp()


def _next_utc_month():
    now = dt.datetime.now(dt.timezone.utc)
    y, m = (now.year + 1, 1) if now.month == 12 else (now.year, now.month + 1)
    return dt.datetime(y, m, 1, tzinfo=dt.timezone.utc).timestamp()


def _card(pid, label, status, source, **kw):
    c = {"id": pid, "label": label, "status": status, "source": source, "bars": [], "reset_text": "", "reset_iso": "", "lines": [], "error": ""}
    c.update(kw)
    return c


def _get(url, headers):
    """GET court ; retourne (réponse | None, erreur_texte)."""
    try:
        return httpx.get(url, headers=headers, timeout=TIMEOUT, verify=ssl_context()), ""
    except httpx.HTTPError as e:
        return None, f"serveur injoignable ({e.__class__.__name__})"


# ----------------------------------------------------------------------------- fournisseurs
PROVIDERS = []


def register(fn):
    PROVIDERS.append(fn)
    return fn


def _eleven_account(key, label):
    pid = "elevenlabs:" + label
    r, err = _get("https://api.elevenlabs.io/v1/user/subscription", {"xi-api-key": key})
    if r is None:
        return _card(pid, "ElevenLabs · " + label, "offline", "API", error="Hors ligne : " + err)
    if r.status_code in (401, 403):
        try:
            detail = r.json().get("detail", {})
            st = detail.get("status", "") if isinstance(detail, dict) else ""
        except ValueError:
            st = ""
        if st == "missing_permissions":
            msg = "Clé sans la permission « user_read » : activez-la (ElevenLabs → Developers → API Keys) pour voir le quota."
        else:
            msg = "Erreur de clé : clé ElevenLabs invalide ou révoquée."
        return _card(pid, "ElevenLabs · " + label, "bad_key", "API", error=msg)
    if r.status_code != 200:
        return _card(pid, "ElevenLabs · " + label, "offline", "API", error=f"Hors ligne : ElevenLabs a répondu {r.status_code}.")
    try:
        d = r.json()
        used, limit = int(d["character_count"]), int(d["character_limit"])
        reset = d.get("next_character_count_reset_unix")
    except (ValueError, KeyError, TypeError):
        return _card(pid, "ElevenLabs · " + label, "offline", "API", error="Réponse ElevenLabs illisible.")
    c = _card(pid, "ElevenLabs · " + label, "ok", "API (exacte)", bars=[_bar("Caractères du mois", used, limit, "caractères")])
    if reset:
        c["reset_text"], c["reset_iso"] = _reset_text(reset), dt.datetime.fromtimestamp(reset).isoformat(timespec="minutes")
    c["lines"].append(f"Forfait : {d.get('tier', '?')} · état : {d.get('status', '?')}" + (f" · {_n(limit - used)} caractères restants" if limit >= used else " · quota dépassé"))
    return c


@register
def _elevenlabs(cfg):
    cards, seen = [], set()
    for field, label in (("elevenlabs_api_key", "E.N.O.S."), ("elevenlabs_eto_api_key", "ETO"), ("elevenlabs_backup_api_key", "E.N.O.S. · secours")):
        key = (cfg.get(field) or (os.environ.get("ELEVENLABS_API_KEY", "") if field == "elevenlabs_api_key" else "") or "").strip()
        if key and key not in seen:                                  # deux personnages sur le même compte : une seule carte
            seen.add(key)
            cards.append(_eleven_account(key, label))
        elif key and key in seen and cards:
            cards[-1]["label"] = "ElevenLabs · E.N.O.S. + ETO"
    return cards


def _key_check(url, headers, pid, label, source):
    """Teste la clé (GET sans coût) : retourne (status, erreur)."""
    r, err = _get(url, headers)
    if r is None:
        return "offline", "Hors ligne : " + err
    if r.status_code in (401, 403):
        return "bad_key", f"Erreur de clé : {label} refuse la clé."
    if r.status_code >= 500:
        return "offline", f"Hors ligne : {label} a répondu {r.status_code}."
    return "ok", ""


def _local_card(cfg, pid, label, key, check_url, headers, monthly_limit, unit="tokens", daily_limit=0):
    """Service SANS endpoint de quota : compteur local E.N.O.S. (tokens, requêtes) + test de la clé."""
    status, err = _key_check(check_url, headers, pid, label, "") if (check_url and key) else ("estimate", "")
    d, m = day_total(pid), month_total(pid)
    bars = []
    if daily_limit:
        bars.append(_bar("Tokens aujourd'hui (estimation)", d["in"] + d["out"], daily_limit, unit))
    if monthly_limit:
        bars.append(_bar("Tokens du mois (estimation)", m["in"] + m["out"], monthly_limit, unit))
    c = _card(pid, label, status, "estimation locale (compteur E.N.O.S.)", bars=bars, error=err)
    c["lines"] += [f"Aujourd'hui : {_n(d['in'])} entrants · {_n(d['out'])} sortants · {d['req']} requête(s)",
                   f"Ce mois-ci : {_n(m['in'] + m['out'])} tokens · {m['req']} requête(s)"]
    if not bars:
        c["lines"].append("Aucun plafond défini : ajoutez-en un dans nasko_config.json (voir la clé « " + pid + "_monthly_token_limit »).")
    if monthly_limit:
        c["reset_text"], c["reset_iso"] = _reset_text(_next_utc_month(), True), dt.datetime.fromtimestamp(_next_utc_month()).isoformat(timespec="minutes")
    return c


@register
def _groq(cfg):
    base = (cfg.get("llm_base_url") or "").lower()
    key = (cfg.get("groq_api_key") or (cfg.get("llm_api_key") if "groq.com" in base else "") or "").strip()
    if not key:
        return []
    status, err = _key_check("https://api.groq.com/openai/v1/models", {"Authorization": "Bearer " + key}, "groq", "Groq", "")
    d = day_total("groq")
    limit = int(cfg.get("groq_daily_token_limit", 100000) or 0)
    bars = [_bar("Tokens du jour (estimation locale)", d["in"] + d["out"], limit, "tokens")] if limit else []
    with _lock:
        h = dict(_load()["headers"].get("groq") or {})
    fresh = h and time.time() - float(h.get("at", 0)) < 24 * 3600
    lines = [f"Aujourd'hui : {_n(d['in'])} entrants · {_n(d['out'])} sortants · {d['req']} requête(s)"]
    if d["audio_s"]:
        lines.append(f"Whisper (transcription) : {d['audio_s'] / 60:.1f} min d'audio aujourd'hui")
    if fresh:                                                        # limites RÉELLES annoncées par Groq dans les en-têtes de la dernière réponse
        try:
            lim_r, rem_r = int(h["x-ratelimit-limit-requests"]), int(h["x-ratelimit-remaining-requests"])
            bars.append(_bar("Requêtes du jour (réel, en-têtes Groq)", lim_r - rem_r, lim_r, "requêtes"))
        except (KeyError, ValueError):
            pass
        try:
            lim_t, rem_t = int(h["x-ratelimit-limit-tokens"]), int(h["x-ratelimit-remaining-tokens"])
            lines.append(f"Tokens par minute : {_n(rem_t)} / {_n(lim_t)} restants" + (f" (reset dans {h['x-ratelimit-reset-tokens']})" if h.get("x-ratelimit-reset-tokens") else ""))
        except (KeyError, ValueError):
            pass
    lines.append("Groq ne fournit pas d'endpoint de quota : tokens comptés localement ; plafond réglable (groq_daily_token_limit).")
    c = _card("groq", "Groq (LLM + Whisper)", status, "estimation locale + en-têtes Groq", bars=bars, lines=lines, error=err)
    c["reset_text"], c["reset_iso"] = _reset_text(_next_utc_midnight(), True), dt.datetime.fromtimestamp(_next_utc_midnight()).isoformat(timespec="minutes")
    return [c]


@register
def _openai(cfg):
    key = (cfg.get("openai_api_key") or (cfg.get("llm_api_key") if llm_pid(cfg) == "openai" else "") or "").strip()
    if not key:
        return []
    return [_local_card(cfg, "openai", "OpenAI", key, "https://api.openai.com/v1/models", {"Authorization": "Bearer " + key},
                        int(cfg.get("openai_monthly_token_limit", 0) or 0))]    # (plafond mensuel réglable : openai_monthly_token_limit)


@register
def _anthropic(cfg):
    key = (cfg.get("anthropic_api_key") or (cfg.get("llm_api_key") if llm_pid(cfg) == "anthropic" else "") or "").strip()
    if not key:
        return []
    return [_local_card(cfg, "anthropic", "Claude (Anthropic)", key, "https://api.anthropic.com/v1/models",
                        {"x-api-key": key, "anthropic-version": "2023-06-01"}, int(cfg.get("anthropic_monthly_token_limit", 0) or 0))]


@register
def _extras(cfg):
    """Services déclarés dans nasko_config.json -> « api_monitor_extra » (aucun code à écrire)."""
    out = []
    for e in cfg.get("api_monitor_extra") or []:
        if not isinstance(e, dict) or not e.get("id"):
            continue
        key = (cfg.get(e.get("key_field", "")) or "").strip()
        if not key:
            continue
        hdr = {"Authorization": "Bearer " + key} if e.get("auth", "bearer") == "bearer" else {e.get("auth_header", "x-api-key"): key}
        out.append(_local_card(cfg, str(e["id"]), str(e.get("label", e["id"])), key, e.get("check_url", ""), hdr,
                               int(e.get("monthly_token_limit", 0) or 0), daily_limit=int(e.get("daily_token_limit", 0) or 0)))
    return out


# ----------------------------------------------------------------------------- instantané
def snapshot(force=False):
    """Toutes les cartes. Chaque fournisseur est interrogé en parallèle, avec son propre délai ; une panne chez l'un n'affecte jamais les autres."""
    if not force and _cache["cards"] is not None and time.time() - _cache["t"] < CACHE_S:
        return _cache["cards"]
    cfg = load_config()
    cards = []
    with ThreadPoolExecutor(max_workers=max(1, len(PROVIDERS))) as pool:
        futs = [(fn.__name__, pool.submit(fn, cfg)) for fn in PROVIDERS]
        for name, fut in futs:
            try:
                cards += fut.result(timeout=TIMEOUT + 6)
            except Exception as e:                                   # noqa: BLE001 — jamais de crash : une carte d'erreur à la place
                log.warning("API monitor %s : %s", name, e)
                cards.append(_card(name.strip("_"), name.strip("_").capitalize(), "offline", "—", error=f"Erreur interne : {e.__class__.__name__}"))
    _cache.update(t=time.time(), cards=cards)
    return cards
