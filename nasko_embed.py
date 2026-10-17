"""Encastrement de fenêtre (Windows) : lance un exécutable de jeu SANS jamais l'afficher, capture son HWND et le fixe (SetParent)
dans la fenêtre d'E.N.O.S., à l'emplacement d'un conteneur de l'interface (#cs-embed du panneau CHESS).

Illusion recherchée : aucune fenêtre ne s'ouvre, aucune console ne clignote.
  * lancement : STARTUPINFO(SW_HIDE) + CREATE_NO_WINDOW ;
  * capture : interrogation toutes les 5 ms ; dès que la fenêtre existe, elle est retirée de la barre des tâches, dépouillée de son cadre,
    rattachée à E.N.O.S. puis seulement affichée DANS le conteneur (une fenêtre qui s'afficherait avant d'être rattachée est masquée aussitôt) ;
  * l'exécutable vient UNIQUEMENT de nasko_config.json (« chess_board_exe »), jamais d'une requête.
Sans jeu configuré, rien ne se passe : le plateau 2D intégré reste affiché.
"""
import os
import subprocess
import sys
import threading
import time

if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes
    U = ctypes.WinDLL("user32", use_last_error=True)
    K = ctypes.WinDLL("kernel32", use_last_error=True)
    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    U.GetWindowLongPtrW.restype = ctypes.c_ssize_t
    U.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
    U.SetWindowLongPtrW.restype = ctypes.c_ssize_t
    U.SetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t]
    U.SetParent.argtypes = [wintypes.HWND, wintypes.HWND]
    U.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
    U.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    U.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    U.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    U.GetParent.argtypes = [wintypes.HWND]
    U.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    U.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    U.GetParent.restype = wintypes.HWND
    U.IsWindow.argtypes = [wintypes.HWND]
    U.EnumChildWindows.argtypes = [wintypes.HWND, WNDENUMPROC, wintypes.LPARAM]
    U.IsWindowVisible.argtypes = [wintypes.HWND]
    U.EnumWindows.argtypes = [WNDENUMPROC, wintypes.LPARAM]

GWL_STYLE, GWL_EXSTYLE = -16, -20
WS_CHILD, WS_VISIBLE, WS_POPUP, WS_CAPTION, WS_THICKFRAME, WS_BORDER = 0x40000000, 0x10000000, 0x80000000, 0x00C00000, 0x00040000, 0x00800000
WS_SYSMENU, WS_MINIMIZEBOX, WS_MAXIMIZEBOX = 0x00080000, 0x00020000, 0x00010000
WS_EX_TOOLWINDOW, WS_EX_APPWINDOW, WS_EX_NOACTIVATE = 0x80, 0x40000, 0x08000000
SW_HIDE, SW_SHOWNA = 0, 8
SWP_NOACTIVATE, SWP_SHOWWINDOW, SWP_FRAMECHANGED, SWP_NOZORDER = 0x10, 0x40, 0x20, 0x4
HWND_TOP = 0
CREATE_NO_WINDOW = 0x08000000

_lock = threading.RLock()
E = {"proc": None, "hwnd": 0, "host": 0, "shown": False, "stop": False, "rect": None, "via": ""}


class EmbedError(Exception):
    pass


def supported():
    return sys.platform == "win32"


def _project_dir():
    import nasko_core
    d = os.path.join(nasko_core.app_dir(), "godot_chess")
    return d if os.path.isfile(os.path.join(d, "project.godot")) else ""


def configured_args():
    """Arguments de lancement (config « chess_board_args », liste) ; « {HWND} » = fenêtre d'E.N.O.S. Pour Godot : ["--wid", "{HWND}"]
    (la fenêtre du jeu naît directement enfant d'E.N.O.S. : aucun affichage, même d'une milliseconde)."""
    import nasko_core
    cfg = nasko_core.load_config()
    if not str(cfg.get("chess_board_exe") or "").strip() and _project_dir():       # mode automatique : projet Godot livré avec E.N.O.S.
        # NB : « --wid » de Godot 4.7 ne crée aucune fenêtre dans ce mode (testé) : la fenêtre est donc capturée puis rattachée (SetParent)
        return ["--path", _project_dir(), "--", "--port", "{PORT}", "--token", "{TOKEN}"]
    a = cfg.get("chess_board_args") or []
    return [str(x) for x in a] if isinstance(a, list) else []


def configured_class():
    """Classe Win32 de la fenêtre du jeu (Godot : « Engine »). Permet de la saisir dès sa création, MASQUÉE, avant tout affichage."""
    import nasko_core
    cfg = nasko_core.load_config()
    if str(cfg.get("chess_board_exe") or "").strip():
        return str(cfg.get("chess_board_class") or "")
    return "Engine" if _project_dir() else ""


def configured_exe():
    import nasko_core
    cfg = nasko_core.load_config()
    p = str(cfg.get("chess_board_exe") or "").strip().strip('"')
    if not p and _project_dir():
        p = str(cfg.get("godot_path") or "").strip().strip('"')
    return p if p and os.path.isfile(p) and p.lower().endswith(".exe") else ""


def _windows_of(pids):
    found = []

    def cb(hwnd, _):
        pid = wintypes.DWORD()
        U.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value in pids and not U.GetParent(hwnd):
            found.append(hwnd)
        return True
    U.EnumWindows(WNDENUMPROC(cb), 0)
    return found


def host_hwnd():
    """Fenêtre principale d'E.N.O.S. (la plus grande fenêtre visible de ce processus)."""
    best, area = 0, 0
    for h in _windows_of({os.getpid()}):
        if not U.IsWindowVisible(h):
            continue
        r = wintypes.RECT()
        U.GetWindowRect(h, ctypes.byref(r))
        a = (r.right - r.left) * (r.bottom - r.top)
        if a > area:
            best, area = h, a
    return best


def _attach(hwnd, host):
    U.ShowWindow(hwnd, SW_HIDE)                                      # invisible AVANT toute modification
    style = U.GetWindowLongPtrW(hwnd, GWL_STYLE)
    style &= ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_BORDER | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX)
    U.SetWindowLongPtrW(hwnd, GWL_STYLE, style | WS_CHILD)
    ex = U.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)
    U.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (ex & ~WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW)   # pas de bouton dans la barre des tâches
    U.SetParent(hwnd, host)
    E["hwnd"], E["host"] = hwnd, host


def _class_of(h):
    buf = ctypes.create_unicode_buffer(80)
    U.GetClassNameW(h, buf, 80)
    return buf.value


def _title_of(h):
    buf = ctypes.create_unicode_buffer(120)
    U.GetWindowTextW(h, buf, 120)
    return buf.value


def _main_window(pid, cls=""):
    """Fenêtre principale du jeu. Avec `cls` : la fenêtre de cette classe (même masquée). Sinon : la plus grande fenêtre ≥ 100×100 qui est
    visible ou titrée (écarte les fenêtres techniques invisibles que créent les pilotes graphiques : WGLDetect, Pbuffer, IME…)."""
    best, area = 0, 0
    for h in _windows_of({pid}):
        r = wintypes.RECT()
        U.GetWindowRect(h, ctypes.byref(r))
        w, hh = r.right - r.left, r.bottom - r.top
        if w < 100 or hh < 100:
            continue
        if cls:
            if _class_of(h) != cls:
                continue
        elif not (U.IsWindowVisible(h) or _title_of(h)):
            continue
        if w * hh > area:
            best, area = h, w * hh
    return best


def _child_window(host, pid):
    """Fenêtre du jeu DÉJÀ enfant d'E.N.O.S. (lancement avec --wid)."""
    found = []

    def cb(hwnd, _):
        p = wintypes.DWORD()
        U.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
        if p.value == pid:
            found.append(hwnd)
        return True
    U.EnumChildWindows(host, WNDENUMPROC(cb), 0)
    return found[0] if found else 0


def _capture_loop(proc, host, cls="", timeout=25.0):
    """Surveille l'apparition de la fenêtre du jeu ; la rattache aussitôt (masquée), l'affiche dès qu'un emplacement est connu."""
    t0 = time.time()
    while not E["stop"] and proc.poll() is None and time.time() - t0 < timeout:
        c = _child_window(host, proc.pid)
        if c:
            with _lock:
                E["hwnd"], E["via"] = c, "wid"
                _apply()
            return
        h = _main_window(proc.pid, cls)
        if h and h != E["hwnd"]:
            U.ShowWindow(h, SW_HIDE)                                  # coupe court à tout affichage « sauvage »
            with _lock:
                if U.IsWindow(h) and not U.GetParent(h):
                    _attach(h, host)
                    E["via"] = "setparent"
                    _apply()
                    _notify(True)
                    return
        time.sleep(0.002)


def _notify(on):
    try:
        import nasko_chessbridge
        nasko_chessbridge.set_embedded(on)
    except Exception:
        pass


def _apply():
    r, h = E["rect"], E["hwnd"]
    if not h or not U.IsWindow(h):
        return
    if r and r[2] > 8 and r[3] > 8 and E["shown"]:
        U.SetWindowPos(h, HWND_TOP, int(r[0]), int(r[1]), int(r[2]), int(r[3]), SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED)
    else:
        U.ShowWindow(h, SW_HIDE)


def start(exe=None, host=None, args=(), port=8765, cls=None):
    """Lance le jeu en silence et l'encastre. `exe`/`host` ne servent qu'aux tests ; en production : chess_board_exe de la config."""
    if not supported():
        raise EmbedError("Encastrement disponible sous Windows uniquement.")
    cls = configured_class() if cls is None else cls
    exe = exe or configured_exe()
    if not exe:
        raise EmbedError("Aucun jeu configuré (clé « chess_board_exe » de nasko_config.json).")
    with _lock:
        if E["proc"] and E["proc"].poll() is None:
            return True
        host = host or host_hwnd()
        if not host:
            raise EmbedError("Fenêtre E.N.O.S. introuvable.")
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        si.wShowWindow = SW_HIDE
        import nasko_chessbridge
        sub = {"{HWND}": str(host), "{PORT}": str(port), "{TOKEN}": nasko_chessbridge.new_token()}
        args = [sub.get(a, a) for a in (args or configured_args())]
        try:
            log = os.environ.get("ENOS_EMBED_LOG")                   # diagnostic : journal de sortie du jeu
            out = open(log, "ab") if log else subprocess.DEVNULL
            proc = subprocess.Popen([exe, *args], cwd=os.path.dirname(exe), startupinfo=si, creationflags=CREATE_NO_WINDOW,
                                    stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT if log else subprocess.DEVNULL)
        except OSError as e:
            raise EmbedError(f"Lancement impossible : {e}")
        E.update(proc=proc, hwnd=0, host=host, stop=False)
    threading.Thread(target=_capture_loop, args=(proc, host, cls), daemon=True).start()
    return True


def set_rect(x, y, w, h, shown=True):
    """Emplacement du conteneur, en pixels physiques, relatif à la zone cliente de la fenêtre E.N.O.S."""
    with _lock:
        E["rect"], E["shown"] = (x, y, w, h), bool(shown)
        _apply()


def stop():
    with _lock:
        E["stop"] = True
        p, E["proc"] = E["proc"], None
        E["hwnd"], E["rect"], E["shown"] = 0, None, False
    _notify(False)
    if p and p.poll() is None:
        p.terminate()


def status():
    p = E["proc"]
    return {"supported": supported(), "configured": bool(configured_exe()), "running": bool(p and p.poll() is None),
            "attached": bool(E["hwnd"] and U.IsWindow(E["hwnd"])) if supported() else False, "via": E["via"]}
