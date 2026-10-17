"""Icône de la zone de notification (System Tray) : E.N.O.S. reste actif en arrière-plan (serveur + IA proactive) avec très peu de mémoire,
sans fenêtre. Menu : Ouvrir · Briefing maintenant · Ne pas déranger · Lancer avec Windows · Quitter.

La fenêtre n'est jamais « cachée » : fermée, elle libère WebView2 ; « Ouvrir » relance simplement une fenêtre sur le serveur déjà actif
(mécanisme existant : instance déjà active -> fenêtre seule). pystray est optionnel : sans lui (ou hors Windows), E.N.O.S. se comporte comme avant.
"""
import logging
import os
import threading
import time

import nasko_core

log = logging.getLogger("nasko.tray")
_icon = {"obj": None, "thread": None}


def available():
    if os.name != "nt" and os.environ.get("PYSTRAY_BACKEND") != "dummy":
        return False
    try:
        import pystray  # noqa: F401
        from PIL import Image  # noqa: F401
        return True
    except Exception:                                                  # noqa: BLE001
        return False


def menu_spec(cfg, autostart=False, now=None):
    """Description du menu (testable sans interface) : [{"id", "label", "checked", "default", "sep"}]."""
    now = now or time.time()
    paused = float(cfg.get("notify_paused_until") or 0) > now
    until = time.strftime("%H:%M", time.localtime(float(cfg["notify_paused_until"]))) if paused else ""
    return [
        {"id": "open", "label": "Ouvrir E.N.O.S.", "default": True},
        {"id": "briefing", "label": "Briefing du jour maintenant"},
        {"sep": True},
        {"id": "dnd", "label": f"Ne pas déranger (jusqu'à {until}) — réactiver" if paused else "Ne pas déranger pendant 1 h", "checked": paused},
        {"id": "dnd_day", "label": "Ne pas déranger jusqu'à demain 7 h", "enabled": not paused},
        {"id": "autostart", "label": "Lancer avec Windows", "checked": bool(autostart)},
        {"sep": True},
        {"id": "quit", "label": "Quitter E.N.O.S."},
    ]


def tooltip(next_item=None):
    return ("E.N.O.S. — " + next_item)[:120] if next_item else "E.N.O.S. — actif en arrière-plan"


def next_item_label(now=None):
    """Prochaine échéance pour l'infobulle (« TP Physique demain 14h »). Vide si rien ou en cas d'erreur."""
    try:
        import nasko_agenda
        from nasko_agent import when_fr
        from datetime import datetime
        now = now or datetime.now()
        items = [i for i in nasko_agenda.upcoming_for_agent(48) if i["start"] >= now.isoformat(timespec="minutes")]
        if not items:
            return ""
        it = items[0]
        return f"{it['title'][:50]} {when_fr(datetime.fromisoformat(it['start']), now)}"
    except Exception:                                                  # noqa: BLE001
        return ""


def _image():
    from PIL import Image
    path = nasko_core.find_asset("logo.png") or nasko_core.find_asset("logo-192.png")
    if path and os.path.isfile(path):
        try:
            return Image.open(path).convert("RGBA").resize((64, 64))
        except Exception:                                              # noqa: BLE001
            pass
    return Image.new("RGBA", (64, 64), (0, 200, 120, 255))


def pause_for(seconds=None, until_tomorrow=False, off=False):
    """Pose / lève « ne pas déranger » (config). Retourne le nouvel instant (0 = actif)."""
    from datetime import datetime, timedelta
    if off:
        ts = 0
    elif until_tomorrow:
        n = datetime.now()
        ts = (n.replace(hour=7, minute=0, second=0, microsecond=0) + timedelta(days=1 if n.hour >= 7 else 0)).timestamp()
    else:
        ts = time.time() + (seconds or 3600)
    nasko_core.update_config({"notify_paused_until": ts})
    return ts


def start(on_open, on_briefing, on_quit, get_autostart, set_autostart):
    """Démarre l'icône (thread détaché). Retourne True si elle tourne. Ne lève jamais."""
    if _icon["obj"] is not None:
        return True
    if not available():
        log.info("Icône de zone de notification indisponible (pystray / Pillow absents, ou système non Windows)")
        return False
    try:
        import pystray

        def act(aid):
            def run(icon=None, item=None):
                try:
                    if aid == "open":
                        on_open()
                    elif aid == "briefing":
                        on_briefing()
                    elif aid == "dnd":
                        paused = float(nasko_core.load_config().get("notify_paused_until") or 0) > time.time()
                        pause_for(off=True) if paused else pause_for(3600)
                    elif aid == "dnd_day":
                        pause_for(until_tomorrow=True)
                    elif aid == "autostart":
                        set_autostart(not get_autostart())
                    elif aid == "quit":
                        stop()
                        on_quit()
                except Exception:                                      # noqa: BLE001 — un clic ne doit jamais faire tomber l'icône
                    log.exception("Action de l'icône : %s", aid)
            return run

        def build():
            items = []
            for m in menu_spec(nasko_core.load_config(), get_autostart()):
                if m.get("sep"):
                    items.append(pystray.Menu.SEPARATOR)
                else:
                    items.append(pystray.MenuItem(m["label"], act(m["id"]), checked=(lambda it, c=m.get("checked"): bool(c)) if "checked" in m else None,
                                                  default=bool(m.get("default")), enabled=m.get("enabled", True)))
            return pystray.Menu(*items)

        icon = pystray.Icon("ENOS", _image(), tooltip(), menu=pystray.Menu(lambda: build().items))
        _icon["obj"] = icon

        def refresh():                                                 # infobulle = prochaine échéance, menu à jour (pause, démarrage auto)
            while _icon["obj"] is icon:
                try:
                    icon.title = tooltip(next_item_label())
                    icon.update_menu()
                except Exception:                                      # noqa: BLE001
                    pass
                time.sleep(60)
        icon.run_detached()
        threading.Thread(target=refresh, daemon=True, name="tray-refresh").start()
        log.info("Icône de zone de notification active")
        return True
    except Exception:                                                  # noqa: BLE001
        log.exception("Icône de zone de notification impossible")
        _icon["obj"] = None
        return False


def stop():
    icon, _icon["obj"] = _icon["obj"], None
    if icon is not None:
        try:
            icon.stop()
        except Exception:                                              # noqa: BLE001
            pass


def active():
    return _icon["obj"] is not None
