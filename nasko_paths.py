"""Dossiers utilisateur de Windows (Vidéos, Images…), robustes à la redirection OneDrive : on interroge le Known Folder réel."""
import ctypes
import os
import sys
from ctypes import wintypes

# FOLDERID_* (GUID des dossiers connus de Windows)
_GUIDS = {
    "videos": "{18989B1D-99B5-455B-841C-AB7C74E4DDFC}",
    "pictures": "{33E28130-4E1E-4676-835A-98395C3BC3BB}",
    "downloads": "{374DE290-123F-4565-9164-39C4925E467B}",
    "desktop": "{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}",
    "documents": "{FDD39AD0-238F-46AF-ADB4-6C85480369C7}",
    "music": "{4BD8D571-6D19-48D3-BE97-422220080E43}",
}
_FALLBACK = {"videos": "Videos", "pictures": "Pictures", "downloads": "Downloads", "desktop": "Desktop", "documents": "Documents", "music": "Music"}


def _known_folder(name):
    if sys.platform != "win32":
        return None
    try:
        class GUID(ctypes.Structure):
            _fields_ = [("a", wintypes.DWORD), ("b", wintypes.WORD), ("c", wintypes.WORD), ("d", ctypes.c_ubyte * 8)]

        g = GUID()
        ctypes.oledll.ole32.CLSIDFromString(ctypes.c_wchar_p(_GUIDS[name]), ctypes.byref(g))
        out = ctypes.c_wchar_p()
        if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(g), 0, None, ctypes.byref(out)) == 0:
            path = out.value
            ctypes.windll.ole32.CoTaskMemFree(out)
            return path
    except (OSError, AttributeError):
        pass
    return None


def user_dir(name):
    """Chemin du dossier `name` (videos | pictures | downloads) : Known Folder Windows, sinon le sous-dossier du profil, sinon le dossier personnel."""
    for p in (_known_folder(name), os.path.join(os.path.expanduser("~"), _FALLBACK[name])):
        if p and os.path.isdir(p):
            return p
    return os.path.expanduser("~")


def videos_dir():
    return user_dir("videos")


def pictures_dir():
    return user_dir("pictures")
