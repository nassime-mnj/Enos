"""Démarrage avec Windows et enregistrements système d'E.N.O.S. (registre HKCU uniquement : aucun droit administrateur).

  - Run\\ENOS           : lance « ENOS.exe --background » à l'ouverture de session (serveur + icône de la zone de notification, sans fenêtre) ;
  - enos-action://      : protocole utilisé par les boutons des notifications (« Fait », « Reporter à demain ») -> « ENOS.exe --action <lien> » ;
  - AppUserModelId      : nom et icône « E.N.O.S. » affichés sur les notifications natives.
Le module de registre est injectable (tests sous Linux).
"""
import os
import sys

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_NAME = "ENOS"
SCHEME = "enos-action"
AUMID = "ENOS.AI.Desktop"


def _reg():
    import winreg
    return winreg


def launch_command(args=""):
    """Commande de lancement : l'exe compilé, ou (en développement) pythonw + ce dépôt."""
    if getattr(sys, "frozen", False):
        base = f'"{sys.executable}"'
    else:
        py = sys.executable
        pyw = os.path.join(os.path.dirname(py), "pythonw.exe")
        base = f'"{pyw if os.path.isfile(pyw) else py}" "{os.path.join(os.path.dirname(os.path.abspath(__file__)), "nasko_server.py")}"'
    return (base + " " + args).strip()


def is_enabled(reg=None):
    reg = reg or _reg()
    try:
        with reg.OpenKey(reg.HKEY_CURRENT_USER, RUN_KEY, 0, reg.KEY_READ) as k:
            val, _ = reg.QueryValueEx(k, RUN_NAME)
        return "--background" in str(val)
    except OSError:
        return False


def set_enabled(on, reg=None):
    reg = reg or _reg()
    with reg.CreateKey(reg.HKEY_CURRENT_USER, RUN_KEY) as k:
        if on:
            reg.SetValueEx(k, RUN_NAME, 0, reg.REG_SZ, launch_command("--background"))
        else:
            try:
                reg.DeleteValue(k, RUN_NAME)
            except OSError:
                pass
    return is_enabled(reg)


def register_notifications(icon_path="", reg=None):
    """Protocole des boutons de notification + identité (nom / icône) des notifications. Idempotent."""
    reg = reg or _reg()
    base = r"Software\Classes\\" + SCHEME
    with reg.CreateKey(reg.HKEY_CURRENT_USER, base) as k:
        reg.SetValueEx(k, "", 0, reg.REG_SZ, "URL:E.N.O.S. action")
        reg.SetValueEx(k, "URL Protocol", 0, reg.REG_SZ, "")
    with reg.CreateKey(reg.HKEY_CURRENT_USER, base + r"\shell\open\command") as k:
        reg.SetValueEx(k, "", 0, reg.REG_SZ, launch_command('--action "%1"'))
    with reg.CreateKey(reg.HKEY_CURRENT_USER, r"Software\Classes\AppUserModelId\\" + AUMID) as k:
        reg.SetValueEx(k, "DisplayName", 0, reg.REG_SZ, "E.N.O.S.")
        if icon_path:
            reg.SetValueEx(k, "IconUri", 0, reg.REG_SZ, icon_path)
    return True
