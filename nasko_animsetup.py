"""Setup Animation : range chaque fichier d'un dossier dans un sous-dossier portant son nom (cam 1.png -> cam 1/cam 1.png).

Utile pour préparer des animations : un dossier par élément (caméra, distributeur, objet…). Seuls les fichiers à la racine du dossier choisi sont déplacés ;
les sous-dossiers existants sont laissés tels quels. Si le sous-dossier existe déjà, le fichier y est ajouté ; un nom déjà pris reçoit un suffixe « (2) ».
"""
import os
import shutil

IGNORED = {"desktop.ini", "thumbs.db", ".ds_store"}


def _free_name(folder, name):
    stem, ext = os.path.splitext(name)
    dest, n = os.path.join(folder, name), 2
    while os.path.exists(dest):
        dest = os.path.join(folder, f"{stem} ({n}){ext}")
        n += 1
    return dest


def organize(folder):
    """Range les fichiers de `folder`. Retourne {folder, moved: [[fichier, sous-dossier]], skipped: [[fichier, raison]]}."""
    folder = os.path.abspath(folder)
    if not os.path.isdir(folder):
        raise ValueError(f"Dossier introuvable : {folder}")
    moved, skipped = [], []
    for name in sorted(os.listdir(folder), key=str.lower):
        src = os.path.join(folder, name)
        if not os.path.isfile(src) or name.lower() in IGNORED or name.startswith("."):
            continue
        stem = os.path.splitext(name)[0].strip().rstrip(".") or name
        target = os.path.join(folder, stem)
        try:
            if os.path.exists(target) and not os.path.isdir(target):
                raise OSError("un fichier porte déjà ce nom")
            os.makedirs(target, exist_ok=True)
            shutil.move(src, _free_name(target, name))
            moved.append([name, stem])
        except OSError as e:
            skipped.append([name, str(e)])
    return {"folder": folder, "moved": moved, "skipped": skipped}
