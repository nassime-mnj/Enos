"""Fin de tâche : notification Windows native + phrase réflexe vocale (ElevenLabs, fichier conservé après la 1re génération).

Toutes les tâches lourdes d'E.N.O.S. tournent déjà sur leur propre thread (compression, audio, conversion d'images, colis, synchronisation Git)
et les routes synchrones de FastAPI sont exécutées dans un pool de threads : l'interface reste fluide (on peut jouer aux échecs pendant un traitement).
Ce module ne bloque jamais l'appelant : toast et synthèse vocale partent sur un thread dédié et ne lèvent jamais d'exception.

L'interface (notify.js) interroge /api/notify/poll et joue la phrase réflexe ; la notification Windows, elle, est émise ici.
"""
import collections
import itertools
import logging
import os
import threading
import time

import nasko_core

log = logging.getLogger("nasko.notify")

# type de tâche -> (libellé FR, libellé EN, id de la phrase réflexe)
KINDS = {
    "compress": ("Compression terminée", "Compression finished", "task_done_compress"),
    "audio": ("Analyse audio terminée", "Audio analysis finished", "task_done_audio"),
    "image": ("Traitement d'image terminé", "Image processing finished", "task_done_image"),
    "pack": ("Colis créé", "Package built", "task_done_pack"),
    "pack_send": ("Colis envoyé", "Package sent", "task_done_pack"),
    "sync": ("Synchronisation terminée", "Synchronization finished", "task_done_sync"),
}
_ids = itertools.count(1)
_events = collections.deque(maxlen=30)
_lock = threading.Lock()
_last_toast = {"t": 0.0, "key": ""}


def _lang(cfg):
    return nasko_core.language(cfg)


def paused(cfg=None):
    """« Ne pas déranger » : vrai tant que notify_paused_until n'est pas dépassé."""
    cfg = cfg or nasko_core.load_config()
    try:
        return float(cfg.get("notify_paused_until") or 0) > time.time()
    except (TypeError, ValueError):
        return False


def toast(title, message, actions=None, silent=False, tag=""):
    """Notification Windows native. Avec `actions` (ou silent) : carte interactive WinRT sans son (nasko_toast) ; sinon, ou en cas d'échec, plyer
    (bulle système), puis repli PowerShell. N'échoue jamais."""
    if actions or silent:
        try:
            import nasko_toast
            if nasko_toast.show_native(nasko_toast.build_xml(title, message, actions or [], silent=silent), tag):
                return True
        except Exception as e:                                       # noqa: BLE001
            log.info("Carte interactive indisponible (%s) : repli", e)
    try:
        from plyer import notification
        icon = nasko_core.find_asset("logo.ico")
        notification.notify(title=title[:60], message=message[:240], app_name="E.N.O.S.", app_icon=icon or "", timeout=8)
        return True
    except Exception as e:                                           # noqa: BLE001 — repli : bulle PowerShell
        log.info("plyer indisponible (%s) : repli PowerShell", e)
    try:
        import subprocess
        ps = ("Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; "
              "$n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; "
              f"$n.ShowBalloonTip(8000, '{title[:60]}'.Replace(\"'\", ''), '{message[:240]}'.Replace(\"'\", ''), 'Info'); Start-Sleep 9; $n.Dispose()")
        subprocess.Popen(["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], creationflags=0x08000000)
        return True
    except Exception as e:                                           # noqa: BLE001
        log.warning("Notification impossible : %s", e)
        return False


def task_done(kind, name="", ok=True, detail=""):
    """À appeler à la fin d'une tâche (n'importe quel thread). `name` = fichier / colis concerné."""
    cfg = nasko_core.load_config()
    if not cfg.get("notify_enabled", True):
        return
    fr, en, vid = KINDS.get(kind, ("Tâche terminée", "Task finished", "task_done"))
    en_mode = _lang(cfg) == "en"
    label = en if en_mode else fr
    title = "E.N.O.S. — " + (label if ok else ("Task failed" if en_mode else "Tâche échouée"))
    message = (name or label) if ok else ((f"{name} : " if name else "") + (detail or ("error" if en_mode else "erreur")))[:200]
    key = f"{kind}|{name}|{ok}"
    with _lock:                                                      # anti-doublon (une même tâche ne notifie pas deux fois en 3 s)
        if _last_toast["key"] == key and time.time() - _last_toast["t"] < 3:
            return
        _last_toast.update(key=key, t=time.time())
    threading.Thread(target=_deliver, args=(kind, title, message, vid if ok else "task_fail", ok, cfg), daemon=True, name="notify").start()


def _deliver(kind, title, message, vid, ok, cfg):
    toast(title, message)
    voice = None
    if cfg.get("notify_voice", True):
        try:
            import nasko_voice
            voice = nasko_voice.ref(vid, cfg)                        # fichier local ou 1 seule génération ElevenLabs ; texte seul si indisponible
        except Exception as e:                                       # noqa: BLE001
            log.info("Phrase réflexe de fin de tâche indisponible : %s", e)
    with _lock:
        _events.append({"id": next(_ids), "kind": kind, "ok": ok, "title": title, "message": message, "voice": voice, "t": time.time()})


def poll(since=0):
    """Événements postérieurs à `since` (identifiant). Les plus anciens que 2 minutes sont ignorés."""
    with _lock:
        return [e for e in _events if e["id"] > since and time.time() - e["t"] < 120]


def push(title, message, level="info", source="agent", speak=True, actions=None, silent=False, ref=""):
    """Alerte proactive (IA de fond) : carte / bulle Windows native tout de suite, puis voix ElevenLabs (la phrase est synthétisée UNE fois, mise en cache),
    puis événement lu par l'interface (toast + audio, voir home.js / notify.js). Si la voix échoue, l'événement part sans audio (repli voix du navigateur).
    level : info | warn | urgent. actions : [{"label", "verb": done|snooze|open, "id"}] (boutons de la carte ET du toast de l'interface).
    silent : ni son système ni voix (briefing du matin). « Ne pas déranger » : rien n'est émis. Ne bloque jamais l'appelant."""
    cfg = nasko_core.load_config()
    if not cfg.get("notify_enabled", True) or paused(cfg):
        return None
    eid = next(_ids)
    threading.Thread(target=_deliver_alert, args=(eid, title, message, level, source, speak and not silent and cfg.get("notify_voice", True), cfg, actions or [], silent, ref),
                     daemon=True, name="notify-alert").start()
    return eid


def _deliver_alert(eid, title, message, level, source, speak, cfg, actions, silent, ref):
    toast(title, message, actions, silent, tag=ref or f"alert-{eid}")
    voice = None
    if speak:
        try:
            import nasko_eleven
            persona = "eto" if cfg.get("persona") == "eto" else "enos"
            if nasko_eleven.configured(cfg, persona):
                path = nasko_eleven.synthesize(message, cfg, persona)
                voice = {"text": message, "audio": "/api/tts/" + os.path.splitext(os.path.basename(path))[0]}
            else:
                log.info("Alerte parlée : ElevenLabs non configuré pour %s", persona)
        except Exception as e:                                       # noqa: BLE001 — quota épuisé, réseau… : l'alerte reste visible
            log.warning("Alerte parlée : voix indisponible (%s)", e)
    with _lock:
        _events.append({"id": eid, "kind": "alert", "ok": True, "title": title, "message": message, "voice": voice,
                        "level": level, "source": source, "silent": silent, "actions": actions, "t": time.time()})
