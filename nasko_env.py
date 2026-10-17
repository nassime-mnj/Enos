"""Gestionnaire de session de travail : lancement ÉCHELONNÉ (anti-lag) des outils choisis, détection des écrans (screeninfo)
et placement de chaque nouvelle fenêtre sur l'écran de destination (user32 via ctypes, comme le reste de E.N.O.S.)."""
import ctypes
import ctypes.wintypes as wt
import logging
import os
import subprocess
import threading
import time

import nasko_tasks

log = logging.getLogger("nasko.env")

ALL_TOOLS = ("powershell", "claude", "godot", "aseprite")          # ordre de lancement
LABELS = {"powershell": "PowerShell", "claude": "Claude", "godot": "Godot", "aseprite": "Aseprite"}
SUBS = {"powershell": "Terminal ouvert dans le projet", "claude": "PowerShell + Claude Code", "godot": "Éditeur du projet", "aseprite": "Éditeur pixel art"}
DEFAULT_STAGGER = 2.0                                                # secondes entre deux lancements (config : env_stagger_s)
# processus propriétaires des fenêtres de chaque outil (minuscules) : sert à reconnaître « la fenêtre qui vient de s'ouvrir »
_TERMINALS = ("powershell.exe", "pwsh.exe", "windowsterminal.exe", "conhost.exe", "openconsole.exe", "cmd.exe")
TOOL_PROCS = {"powershell": _TERMINALS, "claude": _TERMINALS, "godot": ("godot",), "aseprite": ("aseprite.exe",)}
FIRST_WINDOW_TIMEOUT = {"powershell": 10, "claude": 12, "godot": 40, "aseprite": 20}     # attente max de la 1re fenêtre

lock = threading.Lock()
JOB = {"id": 0, "running": False, "items": [], "screen": None, "stagger": DEFAULT_STAGGER, "path": "", "done": False, "note": ""}


# ----------------------------------------------------------------------------- écrans (screeninfo)
def screens():
    """Écrans branchés : Écran 1 = principal, puis les autres de gauche à droite. [] si indétectable."""
    try:
        from screeninfo import get_monitors
        mons = list(get_monitors())
    except Exception as e:                                          # pas de session graphique, import impossible…
        log.warning("Détection des écrans impossible : %s", e)
        return []
    mons.sort(key=lambda m: (not m.is_primary, m.x, m.y))
    return [{"index": i + 1, "label": f"Écran {i + 1}", "x": m.x, "y": m.y, "width": m.width, "height": m.height,
             "primary": bool(m.is_primary), "name": m.name or ""} for i, m in enumerate(mons)]


# ----------------------------------------------------------------------------- fenêtres (user32)
_u = ctypes.WinDLL("user32", use_last_error=True)
_k = ctypes.WinDLL("kernel32", use_last_error=True)
_k.OpenProcess.restype = wt.HANDLE
_EnumProc = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
GWL_EXSTYLE, WS_EX_TOOLWINDOW = -20, 0x80
SWP_NOZORDER, SWP_NOACTIVATE = 0x0004, 0x0010
SW_RESTORE, SW_MAXIMIZE = 9, 3


def _proc_name(pid):
    h = _k.OpenProcess(0x1000, False, pid)                          # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return ""
    try:
        buf = ctypes.create_unicode_buffer(520)
        n = wt.DWORD(520)
        return os.path.basename(buf.value).lower() if _k.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(n)) else ""
    finally:
        _k.CloseHandle(h)


def _windows():
    """Fenêtres visibles de premier niveau avec un titre : {hwnd: (pid, titre)}."""
    out = {}

    def cb(hwnd, _):
        if _u.IsWindowVisible(hwnd) and not _u.IsIconic(hwnd) and not (_u.GetWindowLongW(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW):
            n = _u.GetWindowTextLengthW(hwnd)
            if n > 0:
                buf = ctypes.create_unicode_buffer(n + 1)
                _u.GetWindowTextW(hwnd, buf, n + 1)
                pid = wt.DWORD()
                _u.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                out[int(hwnd)] = (pid.value, buf.value)
        return True
    _u.EnumWindows(_EnumProc(cb), 0)
    return out


def _rect(hwnd):
    r = wt.RECT()
    _u.GetWindowRect(hwnd, ctypes.byref(r))
    return r.left, r.top, r.right - r.left, r.bottom - r.top


def _on_screen(hwnd, mon):
    x, y, w, h = _rect(hwnd)
    cx, cy = x + w // 2, y + h // 2
    return mon["x"] <= cx < mon["x"] + mon["width"] and mon["y"] <= cy < mon["y"] + mon["height"]


def move_to_screen(hwnd, mon):
    """Centre la fenêtre sur l'écran `mon` (taille conservée, ramenée à l'écran si trop grande).
    Une fenêtre maximisée est restaurée, déplacée, puis maximisée de nouveau sur le nouvel écran. Retourne True si déplacée."""
    if _on_screen(hwnd, mon):
        return False
    zoomed = bool(_u.IsZoomed(hwnd))
    if zoomed:
        _u.ShowWindow(hwnd, SW_RESTORE)
    _, _, w, h = _rect(hwnd)
    w, h = min(w, mon["width"]), min(h, mon["height"])
    x, y = mon["x"] + (mon["width"] - w) // 2, mon["y"] + (mon["height"] - h) // 2
    _u.SetWindowPos(hwnd, 0, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE)
    if zoomed:
        _u.ShowWindow(hwnd, SW_MAXIMIZE)
    return True


def _matching(tool, snapshot, before):
    """Nouvelles fenêtres (absentes de `before`) appartenant à un processus de l'outil."""
    names = TOOL_PROCS[tool]
    res = []
    for hwnd, (pid, title) in snapshot.items():
        if hwnd in before:
            continue
        pn = _proc_name(pid)
        if any(pn == n or (n == "godot" and pn.startswith("godot")) for n in names):
            res.append(hwnd)
    return res


def _place_new(tool, before, mon, timeout):
    """Attend la première nouvelle fenêtre de l'outil et la déplace. Retourne (hwnd | None, déplacée?)."""
    end = time.time() + timeout
    while time.time() < end:
        for hwnd in _matching(tool, _windows(), before):
            time.sleep(0.4)                                          # laisse la fenêtre finir son initialisation
            return hwnd, move_to_screen(hwnd, mon)
        time.sleep(0.4)
    return None, False


def _late_place(tool, before, mon, seen, total=60):
    """Godot ouvre d'abord un écran de démarrage puis la vraie fenêtre : on continue de surveiller en arrière-plan."""
    end = time.time() + total
    while time.time() < end:
        for hwnd in _matching(tool, _windows(), before):
            if hwnd not in seen:
                seen.add(hwnd)
                time.sleep(0.4)
                move_to_screen(hwnd, mon)
        time.sleep(1.0)


def _move_existing(tool, cfg, path, mon):
    """Outil déjà ouvert : sa fenêtre est aussi envoyée sur l'écran choisi (au mieux)."""
    pids = nasko_tasks.detect_open(cfg, path).get(tool)
    if not pids:
        return False
    wanted = nasko_tasks._ancestors(pids) if tool == "claude" else set(int(p) for p in pids)
    moved = False
    for hwnd, (pid, _) in _windows().items():
        if pid in wanted:
            moved |= move_to_screen(hwnd, mon)
    return moved


# ----------------------------------------------------------------------------- lancement
def _launch(cfg, tool, path):
    """Lance UN outil. PowerShell simple : nouvelle console dans le projet (toujours, pas de détection de doublon)."""
    if tool == "powershell":
        exe = nasko_tasks.tool_exe(cfg, "powershell") or "powershell.exe"
        try:
            subprocess.Popen([exe, "-NoExit", "-Command", f"Set-Location -LiteralPath {nasko_tasks._ps_quote(path)}"],
                             creationflags=subprocess.CREATE_NEW_CONSOLE)
        except OSError as e:
            return {"ok": False, "message": f"PowerShell : lancement impossible ({e.strerror or e})."}
        return {"ok": True, "message": "PowerShell lancé."}
    return nasko_tasks.lancer_outil(cfg, tool, path)


def info(cfg, project_dir=None):
    """Données du sous-menu : outils (prêt / déjà ouvert / sélection par défaut) + écrans. Ne lance rien."""
    path, err = nasko_tasks.check_project(cfg, project_dir)
    if err:
        return err
    opened = nasko_tasks.detect_open(cfg, path)
    tools = []
    for t in ALL_TOOLS:
        ready = True if t == "powershell" else nasko_tasks.tool_exe(cfg, t) is not None
        tools.append({"id": t, "label": LABELS[t], "sub": SUBS[t], "ready": ready, "open": t in opened,
                      "default": bool(cfg.get(f"launch_{t}", t != "powershell")) and ready})
    return {"ok": True, "path": path, "name": os.path.basename(path.rstrip("\\/")) or path, "tools": tools, "screens": screens(),
            "stagger": float(cfg.get("env_stagger_s", DEFAULT_STAGGER))}


def _set(i, **kw):
    with lock:
        JOB["items"][i].update(kw)


def _run(cfg, tools, screen_idx, path, stagger):
    mon = None
    if screen_idx:
        mon = next((s for s in screens() if s["index"] == screen_idx), None)
    opened = nasko_tasks.detect_open(cfg, path)
    try:
        for i, tool in enumerate(tools):
            label = LABELS[tool]
            if tool != "powershell" and nasko_tasks.tool_exe(cfg, tool) is None:
                _set(i, state="skipped", msg=f"{label} introuvable (vérifiez {tool}_path)")
                continue
            if tool in opened and tool != "powershell":
                _set(i, state="launching", msg="Déjà ouvert : ramené au premier plan")
                res = nasko_tasks.lancer_outil(cfg, tool, path)           # ramène la fenêtre devant, sans doublon
                moved = bool(mon and _move_existing(tool, cfg, path, mon))
                _set(i, state="already", msg="Déjà ouvert" + (f" · envoyé sur {mon['label']}" if moved else ""))
                time.sleep(0.3)
                continue
            _set(i, state="launching", msg="Lancement…")
            before = set(_windows()) if mon else set()
            res = _launch(cfg, tool, path)
            if not res.get("ok"):
                _set(i, state="failed", msg=res.get("message", "Échec"))
            else:
                msg = "Lancé"
                if mon:
                    _set(i, state="waiting", msg=f"Attente de la fenêtre → {mon['label']}…")
                    hwnd, moved = _place_new(tool, before, mon, FIRST_WINDOW_TIMEOUT[tool])
                    msg = (f"Lancé · placé sur {mon['label']}" if moved else f"Lancé · déjà sur {mon['label']}") if hwnd else "Lancé · fenêtre non repérée (non déplacée)"
                    if tool == "godot":
                        threading.Thread(target=_late_place, args=(tool, before, mon, {hwnd} if hwnd else set()), daemon=True).start()
                _set(i, state="launched", msg=msg)
            if i < len(tools) - 1:                                       # lancement différé : jamais deux outils en même temps
                time.sleep(stagger)
    except Exception as e:
        log.exception("Session de travail")
        with lock:
            JOB["note"] = f"Erreur : {e}"
    finally:
        with lock:
            JOB.update(running=False, done=True)
        log.info("Session terminée : %s", [(x["id"], x["state"]) for x in JOB["items"]])


def start(cfg, tools, screen_idx, project_dir=None):
    path, err = nasko_tasks.check_project(cfg, project_dir)
    if err:
        return err
    tools = [t for t in ALL_TOOLS if t in set(tools or [])]
    if not tools:
        return {"ok": False, "message": "Aucun outil sélectionné."}
    stagger = max(0.0, float(cfg.get("env_stagger_s", DEFAULT_STAGGER)))
    with lock:
        if JOB["running"]:
            return {"ok": False, "code": "busy", "message": "Un lancement est déjà en cours."}
        JOB.update(id=JOB["id"] + 1, running=True, done=False, screen=screen_idx, stagger=stagger, path=path, note="",
                   items=[{"id": t, "label": LABELS[t], "state": "pending", "msg": "En attente"} for t in tools])
    threading.Thread(target=_run, args=(cfg, tools, screen_idx, path, stagger), daemon=True, name="env-session").start()
    return {"ok": True, "path": path}


def status():
    with lock:
        return {**JOB, "items": [dict(x) for x in JOB["items"]]}
