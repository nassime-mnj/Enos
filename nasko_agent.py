"""IA PROACTIVE : un thread de fond surveille l'agenda (Zeus + Moodle + tâches manuelles) et prévient avant qu'il soit trop tard.

Cycle (toutes les 5 min, config `agent_interval_s`) :
  1. nasko_agenda.upcoming_for_agent() — les 72 prochaines heures, sources en cache (aucun téléchargement inutile) ;
  2. pour chaque élément, le palier le plus serré atteint (48 h / 24 h / 3 h ; 15 min pour un cours) — un seul message par palier,
     mémorisé dans data/agent_state.json (pas de doublon, même après redémarrage) ;
  3. le texte est écrit par Groq (nasko_llm.complete, 3 appels max par cycle) avec repli sur un gabarit : la notification part TOUJOURS ;
  4. nasko_notify.push() : bulle Windows native + événement lu par l'interface (toast JS dans home.js) ;
  5. chaque matin (à partir de 7 h), un « briefing du jour » résume cours, rendus et tâches.
Heures calmes 23 h → 7 h : rien n'est envoyé, les alertes encore valables partent au réveil.
"""
import json
import logging
import os
import threading
import time
from datetime import datetime, timedelta

import nasko_agenda
import nasko_core
import nasko_llm
import nasko_notify
import nasko_toast


def _who():
    return nasko_core.load_config().get("user_label") or "Nassime"

log = logging.getLogger("nasko.agent")

TIERS = {"exam": (48, 24, 3), "deadline": (48, 24, 3), "task": (24, 3, 0), "class": (0.25,)}      # task / 0 : carte « c'est l'heure » à l'échéance
MAX_LLM = 3
_state_lock = threading.Lock()
_thread = None
_stop = threading.Event()
_wake = threading.Event()
status = {"running": False, "last_run": None, "last_error": None, "sent_total": 0}


# ------------------------------------------------------------------ état persistant
def _file():
    import nasko_roles
    return os.path.join(nasko_core.data_dir(), nasko_roles.data_name("agent_state.json"))


def _load():
    try:
        with open(_file(), encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        d = {}
    d.setdefault("seen", {})
    d.setdefault("feed", [])
    return d


def _save(d):
    cut = time.time() - 14 * 86400
    d["seen"] = {k: v for k, v in d["seen"].items() if v > cut}
    d["feed"] = d["feed"][-30:]
    tmp = _file() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False)
    os.replace(tmp, _file())


def feed():
    with _state_lock:
        return list(reversed(_load()["feed"]))


# ------------------------------------------------------------------ langage naturel
_DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]


def when_fr(dt, now=None):
    now = now or datetime.now()
    delta = (dt.date() - now.date()).days
    hh = dt.strftime("%Hh%M").replace("h00", "h")
    if delta == 0:
        return f"aujourd'hui à {hh}"
    if delta == 1:
        return f"demain à {hh}"
    if delta < 7:
        return f"{_DAYS[dt.weekday()]} à {hh}"
    return dt.strftime("%d/%m à ") + hh


def _noun(it):
    return {"exam": "un contrôle", "deadline": "un rendu", "task": "une tâche", "class": "un cours"}.get(it["kind"], "un événement")


def _template(it, hours, tier=None):
    if tier == 0:
        return f"C'est l'heure : {it['title']}."
    start = datetime.fromisoformat(it["start"])
    when = when_fr(start)
    if it["kind"] == "class":
        room = f" en {it['location']}" if it["location"] else ""
        return f"Ton cours « {it['title']} » commence dans quelques minutes{room}."
    if hours <= 4:
        return f"{_who()}, {it['title']} : c'est {when}, soit dans moins de {max(1, round(hours))} h. Fonce."
    if hours <= 26:
        return f"Attention {_who()}, {it['title']} est à rendre {when}. Ne l'oublie pas."
    return f"{_who()}, {it['title']} arrive {when}. Prévois du temps dès maintenant."


def _llm_text(it, hours, cfg):
    start = datetime.fromisoformat(it["start"])
    facts = (f"Élément : {it['title']} ({_noun(it)}, source {it['source']}). Échéance : {when_fr(start)} (dans {hours:.0f} h). "
             + (f"Lieu : {it['location']}. " if it["location"] else "") + (f"Notes : {it['notes'][:160]}." if it.get("notes") else ""))
    system = (f"Tu es E.N.O.S., l'IA proactive de {_who()}, étudiant à l'EPITA. Écris UNE notification de 1 à 2 phrases courtes, en le tutoyant, "
              "qui cite précisément l'élément et l'échéance en langage naturel (demain, ce soir, dans 3 h). Ton froid mais loyal, direct, "
              f"sans emoji, sans markdown, sans guillemets autour de la réponse. Exemple : « Attention {_who()}, tu as ce projet à rendre pour demain, ne l'oublie pas. »")
    return nasko_llm.complete(cfg, system, facts, max_tokens=120).strip().strip("«»\"")[:240]


# ------------------------------------------------------------------ un cycle
def _quiet(now, cfg):
    a, b = (cfg.get("agent_quiet_hours") or [23, 7])[:2]
    return (now.hour >= a or now.hour < b) if a > b else (a <= now.hour < b)


def _emit(d, key, title, message, level, ref="", actions=None, silent=False):
    nasko_notify.push(title, message, level=level, actions=actions, silent=silent, ref=ref)
    d["seen"][key] = time.time()
    d["feed"].append({"t": time.time(), "level": level, "title": title, "message": message, "ref": ref})
    status["sent_total"] += 1


def run_once(force_brief=False):
    """Un passage complet. Retourne le nombre de notifications envoyées. Ne lève jamais.
    « Ne pas déranger » suspend tout ; les heures calmes suspendent les alertes (pas le briefing, dont l'heure est choisie par l'utilisateur)."""
    cfg = nasko_core.load_config()
    if not cfg.get("agent_enabled", True) and not force_brief:
        return 0
    now = datetime.now()
    sent = 0
    try:
        if nasko_notify.paused(cfg) and not force_brief:
            status["last_run"] = time.time()
            return 0
        with _state_lock:
            d = _load()
            if not _quiet(now, cfg) or force_brief:
                sent += _alerts(d, nasko_agenda.upcoming_for_agent(72), now, cfg)
            sent += _daily_briefing(d, now, cfg, force_brief)
            _save(d)
        status.update(last_run=time.time(), last_error=None)
    except Exception as e:                                          # noqa: BLE001
        log.exception("cycle de l'agent")
        status.update(last_run=time.time(), last_error=str(e)[:200])
    return sent


def _alerts(d, items, now, cfg):
    sent = 0
    llm_left = MAX_LLM if nasko_llm.configured(cfg) else 0
    for it in items:
        tiers = TIERS.get(it["kind"], (24,))
        start = datetime.fromisoformat(it["start"])
        if it["all_day"] and it["kind"] != "deadline":
            start = start.replace(hour=8)
        hours = (start - now).total_seconds() / 3600
        if hours < -0.5:
            continue
        reached = [t for t in tiers if hours <= t]
        if not reached:
            continue
        tier = min(reached)
        key = f"{it['id']}|{it['start']}|{tier}"
        if key in d["seen"]:
            continue
        for t in tiers:                                   # les paliers plus larges sont consommés : pas de « 48 h » après le « 24 h »
            if t > tier:
                d["seen"].setdefault(f"{it['id']}|{it['start']}|{t}", time.time())
        text = None
        if llm_left and it["kind"] != "class" and tier != 0:
            try:
                text = _llm_text(it, max(hours, 0), cfg)
                llm_left -= 1
            except Exception as e:                        # noqa: BLE001 — la notification part quand même (gabarit)
                log.info("LLM indisponible pour l'alerte : %s", e)
                llm_left = 0
        text = text or _template(it, hours, tier)
        level = "urgent" if hours <= 4 else "warn" if it["kind"] in ("exam", "deadline") else "info"
        label = {"exam": "CONTRÔLE", "deadline": "RENDU", "task": "TÂCHE", "class": "COURS"}.get(it["kind"], "AGENDA")
        _emit(d, key, f"E.N.O.S. — {label}", text, level, it["id"], actions=nasko_toast.actions_for(it))
        sent += 1
    return sent


# ------------------------------------------------------------------ briefing quotidien (silencieux)
def _pl(n, one, many):
    return f"{n} {one if n == 1 else many}"


def _hm(it):
    """« 8h », « 14h30 » ; vide pour un élément sans heure (00:00)."""
    hh, mm = int(it["start"][11:13] or 0), int(it["start"][14:16] or 0)
    return "" if (hh, mm) == (0, 0) else f"{hh}h" + (f"{mm:02d}" if mm else "")


def format_briefing(who, data, now=None):
    """Texte du briefing : déterministe (pas de LLM : rapide, gratuit, jamais faux). Exemple :
    « Bonjour Nassime. Aujourd'hui : 3 cours, 1 contrôle de Maths à 14h, 1 rendu (TP Physique), 2 notes en attente. Demain : rendu Projet C. Bonne journée ! »"""
    today, tomorrow = data["today"], data["tomorrow"]
    classes = [i for i in today if i["kind"] == "class"]
    exams = [i for i in today if i["kind"] == "exam"]
    deadlines = [i for i in today if i["kind"] == "deadline"]
    tasks = [i for i in today if i["kind"] == "task"]
    parts = []
    if classes:
        parts.append(_pl(len(classes), "cours", "cours") + (f" dès {_hm(classes[0])}" if _hm(classes[0]) else ""))
    for e in exams[:2]:
        parts.append(f"contrôle {e['title']}" + (f" à {_hm(e)}" if _hm(e) else ""))
    if len(exams) > 2:
        parts.append(f"+{len(exams) - 2} contrôle(s)")
    if deadlines:
        parts.append(_pl(len(deadlines), "rendu", "rendus") + " (" + ", ".join(d["title"] for d in deadlines[:2]) + (", …" if len(deadlines) > 2 else "") + ")")
    if tasks:
        parts.append(_pl(len(tasks), "tâche", "tâches") + (f" : {tasks[0]['title']}" if len(tasks) == 1 else ""))
    if data["undated"]:
        parts.append(_pl(len(data["undated"]), "note en attente", "notes en attente"))
    if data["overdue"]:
        parts.append(_pl(len(data["overdue"]), "tâche en retard", "tâches en retard"))
    text = f"Bonjour {who}. "
    text += ("Aujourd'hui : " + ", ".join(parts) + ".") if parts else "Journée libre : rien de prévu."
    if tomorrow:
        text += " Demain : " + ", ".join(f"{ {'exam': 'contrôle', 'deadline': 'rendu'}.get(i['kind'], 'tâche') } {i['title']}" for i in tomorrow[:2]) + (", …" if len(tomorrow) > 2 else "") + "."
    return text + " Bonne journée !"


def _brief_due(now, cfg, force):
    if force:
        return True
    if not cfg.get("briefing_enabled", True):
        return False
    try:
        h, m = (int(x) for x in str(cfg.get("briefing_time") or "08:00").split(":")[:2])
        at = now.replace(hour=h, minute=m, second=0, microsecond=0)
    except (ValueError, TypeError):
        at = now.replace(hour=8, minute=0, second=0, microsecond=0)
    return at <= now <= max(at + timedelta(hours=5), now.replace(hour=13, minute=0, second=0, microsecond=0))   # rattrapage si le PC démarre en retard


def _daily_briefing(d, now, cfg, force):
    key = f"brief|{now.date().isoformat()}"
    if not _brief_due(now, cfg, force) or (key in d["seen"] and not force):
        return 0
    data = nasko_agenda.briefing_data(now, cfg)
    text = format_briefing(_who(), data, now)
    _emit(d, key, "E.N.O.S. — BRIEFING DU JOUR", text, "info", "brief", actions=[{"label": "Ouvrir l'agenda", "verb": "open"}], silent=True)
    return 1


# ------------------------------------------------------------------ cycle de vie du thread
def _loop():
    status["running"] = True
    _stop.wait(20)                                                  # laisse le serveur et la fenêtre démarrer
    while not _stop.is_set():
        run_once()
        interval = max(60, int(nasko_core.load_config().get("agent_interval_s", 300)))
        _wake.wait(interval)
        _wake.clear()
    status["running"] = False


def start():
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="enos-agent", daemon=True)
    _thread.start()
    log.info("Agent proactif démarré")


def stop():
    _stop.set()
    _wake.set()


def poke():
    """Réveille le thread (nouvelle tâche ajoutée, source reconfigurée)."""
    _wake.set()
