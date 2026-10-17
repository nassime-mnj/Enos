"""Visu a distance : image JPEG de la fenetre des scenes Godot lancees par E.N.O.S. (ou, si autorise, de l'ecran).

Mode « window » (defaut) : SEULES les fenetres des processus de scene suivis par E.N.O.S. sont capturees, via
PrintWindow(PW_RENDERFULLCONTENT) : ca fonctionne pour les fenetres GPU (Vulkan/D3D) meme partiellement recouvertes, et
ne montre donc jamais les autres applications. Mode « full » (reglage explicite) : tout l'ecran principal.
"""
import ctypes
import ctypes.wintypes as wt
import io
import logging
import os
import threading

import numpy as np
from PIL import Image, ImageGrab

log = logging.getLogger("nasko.screen")

PRESETS = {"eco": (640, 45, 4), "normal": (960, 60, 8), "hd": (1280, 72, 12)}   # largeur max, qualite JPEG, images/s
PW_RENDERFULLCONTENT = 2

try:
    _u, _g, _k = ctypes.windll.user32, ctypes.windll.gdi32, ctypes.windll.kernel32
    AVAILABLE = True
except (AttributeError, OSError):          # pas Windows
    AVAILABLE = False

if AVAILABLE:
    _u.GetWindowRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
    _u.IsWindowVisible.argtypes = [wt.HWND]
    _u.IsIconic.argtypes = [wt.HWND]
    _u.GetWindowThreadProcessId.argtypes = [wt.HWND, ctypes.POINTER(wt.DWORD)]
    _u.PrintWindow.argtypes = [wt.HWND, wt.HDC, wt.UINT]
    _u.GetWindowTextLengthW.argtypes = [wt.HWND]
    _u.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
    _u.GetClientRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
    _u.ClientToScreen.argtypes = [wt.HWND, ctypes.POINTER(wt.POINT)]
    _u.GetDC.argtypes = [wt.HWND]
    _u.GetDC.restype = wt.HDC
    _u.ReleaseDC.argtypes = [wt.HWND, wt.HDC]
    _g.CreateCompatibleDC.argtypes = [wt.HDC]
    _g.CreateCompatibleDC.restype = wt.HDC
    _g.CreateCompatibleBitmap.argtypes = [wt.HDC, ctypes.c_int, ctypes.c_int]
    _g.CreateCompatibleBitmap.restype = wt.HBITMAP
    _g.SelectObject.argtypes = [wt.HDC, wt.HGDIOBJ]
    _g.SelectObject.restype = wt.HGDIOBJ
    _g.DeleteObject.argtypes = [wt.HGDIOBJ]
    _g.DeleteDC.argtypes = [wt.HDC]
    _g.GetDIBits.argtypes = [wt.HDC, wt.HBITMAP, wt.UINT, wt.UINT, ctypes.c_void_p, ctypes.c_void_p, wt.UINT]
    _WNDENUM = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    _k.CreateToolhelp32Snapshot.restype = wt.HANDLE


class _BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", wt.DWORD), ("biWidth", wt.LONG), ("biHeight", wt.LONG), ("biPlanes", wt.WORD),
                ("biBitCount", wt.WORD), ("biCompression", wt.DWORD), ("biSizeImage", wt.DWORD),
                ("biXPelsPerMeter", wt.LONG), ("biYPelsPerMeter", wt.LONG), ("biClrUsed", wt.DWORD),
                ("biClrImportant", wt.DWORD)]


class _PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [("dwSize", wt.DWORD), ("cntUsage", wt.DWORD), ("th32ProcessID", wt.DWORD),
                ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wt.DWORD), ("cntThreads", wt.DWORD),
                ("th32ParentProcessID", wt.DWORD), ("pcPriClassBase", ctypes.c_long), ("dwFlags", wt.DWORD),
                ("szExeFile", ctypes.c_wchar * 260)]


if AVAILABLE:
    _k.Process32FirstW.argtypes = [wt.HANDLE, ctypes.POINTER(_PROCESSENTRY32W)]
    _k.Process32NextW.argtypes = [wt.HANDLE, ctypes.POINTER(_PROCESSENTRY32W)]
    _k.CloseHandle.argtypes = [wt.HANDLE]


def _dpi_aware():
    """Rend CE thread insensible a la mise a l'echelle de l'ecran : la capture garde la taille reelle des pixels."""
    try:
        ctypes.windll.user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))   # PER_MONITOR_AWARE_V2
    except Exception:
        pass


def descendants(pids):
    """`pids` + tous leurs processus enfants (le Godot « console » lance le vrai jeu dans un processus fils)."""
    found, parents = set(pids), {}
    snap = _k.CreateToolhelp32Snapshot(2, 0)       # TH32CS_SNAPPROCESS
    try:
        entry = _PROCESSENTRY32W()
        entry.dwSize = ctypes.sizeof(entry)
        ok = _k.Process32FirstW(snap, ctypes.byref(entry))
        while ok:
            parents[entry.th32ProcessID] = entry.th32ParentProcessID
            ok = _k.Process32NextW(snap, ctypes.byref(entry))
    finally:
        _k.CloseHandle(snap)
    changed = True
    while changed:
        changed = False
        for child, parent in parents.items():
            if parent in found and child not in found:
                found.add(child)
                changed = True
    return found


def game_windows(pids):
    """[(hwnd, titre, (l, t, r, b), reduite)] des fenetres visibles appartenant aux processus `pids` (et leurs fils)."""
    if not AVAILABLE or not pids:
        return []
    owners, out = descendants(pids), []

    def cb(hwnd, _):
        pid = wt.DWORD()
        _u.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value in owners and _u.IsWindowVisible(hwnd):
            r = wt.RECT()
            _u.GetWindowRect(hwnd, ctypes.byref(r))
            n = _u.GetWindowTextLengthW(hwnd)
            buf = ctypes.create_unicode_buffer(n + 1)
            _u.GetWindowTextW(hwnd, buf, n + 1)
            if r.right - r.left > 8 and r.bottom - r.top > 8:
                out.append((hwnd, buf.value, (r.left, r.top, r.right, r.bottom), bool(_u.IsIconic(hwnd))))
        return True

    _u.EnumWindows(_WNDENUM(cb), 0)
    return out


def _client_box(hwnd, origin):
    """Zone cliente de la fenetre (sans barre de titre ni bordures), relative a l'angle haut-gauche `origin` de la fenetre."""
    pt, cr = wt.POINT(0, 0), wt.RECT()
    if not (_u.ClientToScreen(hwnd, ctypes.byref(pt)) and _u.GetClientRect(hwnd, ctypes.byref(cr))):
        return None
    dx, dy = pt.x - origin[0], pt.y - origin[1]
    return (dx, dy, dx + cr.right, dy + cr.bottom) if cr.right > 8 and cr.bottom > 8 else None


def capture_window(hwnd, size, origin=None):
    """Image PIL de la zone cliente de la fenetre (contenu complet, meme GPU), ou None."""
    w, h = size
    sdc = _u.GetDC(None)
    mdc = _g.CreateCompatibleDC(sdc)
    bmp = _g.CreateCompatibleBitmap(sdc, w, h)
    old = _g.SelectObject(mdc, bmp)
    try:
        if not _u.PrintWindow(hwnd, mdc, PW_RENDERFULLCONTENT):
            return None
        bmi = _BITMAPINFOHEADER()
        bmi.biSize, bmi.biWidth, bmi.biHeight, bmi.biPlanes, bmi.biBitCount = ctypes.sizeof(bmi), w, -h, 1, 32
        buf = ctypes.create_string_buffer(w * h * 4)
        _g.GetDIBits(mdc, bmp, 0, h, buf, ctypes.byref(bmi), 0)
        img = Image.frombuffer("RGBA", (w, h), buf, "raw", "BGRA", 0, 1).convert("RGB")
        box = _client_box(hwnd, origin) if origin else None
        if box and 0 <= box[0] < box[2] <= w and 0 <= box[1] < box[3] <= h:
            img = img.crop(box)
        return img
    finally:
        _g.SelectObject(mdc, old)
        _g.DeleteObject(bmp)
        _g.DeleteDC(mdc)
        _u.ReleaseDC(None, sdc)


def capture_screen():
    return ImageGrab.grab().convert("RGB")           # ecran principal


def jpeg(img, max_w, quality):
    if img.width > max_w:
        img = img.resize((max_w, max(1, round(img.height * max_w / img.width))), Image.BILINEAR)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=False)
    return buf.getvalue()


_BLACK = None


def black_frame():
    """Petite image noire : maintient le flux ouvert quand il n'y a rien a montrer."""
    global _BLACK
    if _BLACK is None:
        _BLACK = jpeg(Image.new("RGB", (320, 180), (0, 0, 0)), 320, 40)
    return _BLACK


def frame(mode, pids, preset="normal"):
    """(jpeg | None, raison). raison : '' si image, sinon 'off' | 'aucune_fenetre' | 'reduite' | 'noir' | 'erreur'."""
    max_w, quality, _ = PRESETS.get(preset, PRESETS["normal"])
    if mode == "off" or not AVAILABLE:
        return None, "off"
    _dpi_aware()
    try:
        if mode == "full":
            return jpeg(capture_screen(), max_w, quality), ""
        wins = game_windows(pids)
        if not wins:
            return None, "aucune_fenetre"
        hwnd, _title, (l, t, r, b), iconic = max(wins, key=lambda x: (x[2][2] - x[2][0]) * (x[2][3] - x[2][1]))
        if iconic:
            return None, "reduite"
        img = capture_window(hwnd, (r - l, b - t), (l, t))
        if img is None:
            return None, "erreur"
        a = np.asarray(img.resize((64, 36)))
        if a.std() < 0.8 and a.mean() < 4:           # image entierement noire : fenetre pas encore dessinee
            return None, "noir"
        return jpeg(img, max_w, quality), ""
    except Exception as e:                           # ne jamais faire tomber le flux
        log.warning("Capture impossible : %s", e)
        return None, "erreur"
