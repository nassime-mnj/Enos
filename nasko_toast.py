"""Notifications natives INTERACTIVES (Windows) : carte discrète, sans son, avec boutons (« Fait », « Reporter à demain », « Ouvrir »).

Un clic sur un bouton lance « ENOS.exe --action enos-action://<verbe>/<id> » (protocole enregistré par nasko_autostart) : le traitement se fait
dans ce petit processus, directement sur data/agenda.json (le serveur relit le fichier à chaque appel) : l'application n'a pas besoin d'être ouverte.
Sécurité : le lien est rigoureusement validé (verbes autorisés, identifiant hexadécimal) ; il ne peut qu'agir sur une tâche de l'agenda.
"""
import base64
import logging
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta
from xml.sax.saxutils import quoteattr, escape

import nasko_autostart

log = logging.getLogger("nasko.toast")
SCHEME = nasko_autostart.SCHEME
VERBS = ("done", "snooze", "open", "briefing")
LABELS = {"done": "Fait", "snooze": "Reporter à demain", "open": "Ouvrir l'agenda", "briefing": "Voir le briefing"}

_PS = r"""
$ErrorActionPreference = 'Stop'
$xml = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ENOS_TOAST_XML))
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
$toast = [Windows.UI.Notifications.ToastNotification]::new($doc)
if ($env:ENOS_TOAST_TAG) { $toast.Tag = $env:ENOS_TOAST_TAG }
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:ENOS_AUMID).Show($toast)
"""


def uri(verb, ident=""):
    if verb not in VERBS:
        raise ValueError("verbe inconnu")
    return f"{SCHEME}://{verb}" + (f"/{ident}" if ident else "")


def parse_uri(u):
    """« enos-action://done/ab12cd34ef » -> ("done", "ab12cd34ef"). Lève ValueError pour tout ce qui n'est pas strictement conforme."""
    m = re.fullmatch(rf"{SCHEME}://([a-z]+)(?:/([0-9a-f]{{6,40}}))?/?", str(u or "").strip().strip('"'))
    if not m or m.group(1) not in VERBS:
        raise ValueError("lien d'action invalide")
    verb, ident = m.group(1), m.group(2) or ""
    if verb in ("done", "snooze") and not ident:
        raise ValueError("identifiant manquant")
    return verb, ident


def build_xml(title, message, actions=(), silent=True, launch=None):
    """actions : [{"label", "verb", "id"}]. Texte échappé (le titre / le message viennent de l'agenda : contenu non fiable)."""
    launch = launch or uri("open")
    acts = "".join(f'<action content={quoteattr(a["label"][:30])} activationType="protocol" arguments={quoteattr(uri(a["verb"], a.get("id", "")))}/>' for a in list(actions)[:3])
    return ("<toast activationType=\"protocol\" launch=" + quoteattr(launch) + ">"
            f"<visual><binding template=\"ToastGeneric\"><text>{escape(title[:80])}</text><text>{escape(message[:240])}</text></binding></visual>"
            + ('<audio silent="true"/>' if silent else "") + (f"<actions>{acts}</actions>" if acts else "") + "</toast>")


def show_native(xml, tag=""):
    """Affiche la notification via Windows PowerShell (WinRT). Retourne False (sans lever) si indisponible : l'appelant se replie sur plyer."""
    if os.name != "nt":
        return False
    env = {**os.environ, "ENOS_TOAST_XML": base64.b64encode(xml.encode("utf-8")).decode(), "ENOS_AUMID": nasko_autostart.AUMID, "ENOS_TOAST_TAG": tag[:64]}
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", _PS], env=env, capture_output=True, timeout=20,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.SubprocessError) as e:
        log.info("Notification native impossible : %s", e)
        return False
    if r.returncode != 0:
        log.info("Notification native refusée : %s", r.stderr.decode("utf-8", "replace")[:200])
    return r.returncode == 0


def actions_for(item):
    """Boutons adaptés à un élément d'agenda : une tâche manuelle se coche ou se reporte ; le reste (cours Zeus, rendu Moodle) s'ouvre."""
    if item.get("source") == "manual" and item.get("task_id"):
        return [{"label": LABELS["done"], "verb": "done", "id": item["task_id"]}, {"label": LABELS["snooze"], "verb": "snooze", "id": item["task_id"]}]
    return [{"label": LABELS["open"], "verb": "open"}]


def handle_action(u, now=None):
    """Exécute l'action d'un lien. Retourne {"ok", "verb", "message"} ; « open » est laissé à l'appelant (ouvrir la fenêtre)."""
    import nasko_agenda
    now = now or datetime.now()
    try:
        verb, ident = parse_uri(u)
    except ValueError as e:
        return {"ok": False, "verb": "", "message": str(e)}
    if verb in ("open", "briefing"):
        return {"ok": True, "verb": verb, "message": ""}
    try:
        if verb == "done":
            nasko_agenda.update_task(ident, done=True)
            return {"ok": True, "verb": verb, "message": "Tâche terminée."}
        t = nasko_agenda.postpone_task(ident, now)
        return {"ok": True, "verb": verb, "message": "Reportée à demain : " + t["due"].replace("T", " à ")}
    except KeyError:
        return {"ok": False, "verb": verb, "message": "Tâche introuvable (déjà supprimée ?)."}
