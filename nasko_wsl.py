"""ESPACE DE TRAVAIL — source unique pour tout Enos (WSL sous Windows, dossier local sous Linux natif).

  Windows : \\\\wsl.localhost\\<distribution>\\home\\<utilisateur>   (ex. \\\\wsl.localhost\\Ubuntu\\home\\nasko = /home/nasko dans la distribution « Ubuntu »)
  Linux   : un dossier local quelconque (ex. /home/dimitri/projets) — aucune surcouche WSL, les commandes s'exécutent directement dans le shell local.

  * tout `git clone` lancé depuis Enos (Dev Manager, module Dépôt) atterrit dans ce dossier ;
  * tout script .sh glissé dans la zone de dépôt du Dev Manager y est enregistré (LF, exécutable) ;
  * le terminal du module Dépôt y démarre.
Le dossier est un RÉGLAGE (`wsl_workspace` dans nasko_config.json), choisi depuis le module Dépôt (« ESPACE DE TRAVAIL » : boîte de dialogue native de sélection de dossier).
Tant que rien n'est réglé : Windows -> dossier historique du CEO (DEFAULT_UNC) ; Linux -> `depot_local_root` s'il existe, sinon le dossier personnel.
Windows : seule la forme \\\\wsl.localhost\\<distribution>\\<dossier>… est acceptée (chaque segment contrôlé, jamais « .. »). Linux : chemin absolu existant, sans « .. » ni octet nul.
Seules les routes locales authentifiées peuvent changer ce réglage. Les anciennes constantes WORKSPACE_UNC / DISTRO / DIR restent disponibles comme attributs du module mais sont
calculées à chaque accès : ne jamais les copier à l'import. Sous Linux DISTRO vaut "" et WORKSPACE_UNC / DIR sont le même chemin POSIX.
Ce module nomme l'utilisateur Linux du CEO : il fait partie de la capacité « depot » (release_editions.py) ; hors édition CEO ce nom est remplacé à la copie."""
import os
import platform
import posixpath
import re

DEFAULT_UNC = "\\\\wsl.localhost\\Ubuntu\\home\\nasko"
CONFIG_KEY = "wsl_workspace"

_UNC = re.compile(r"^\\\\wsl(?:\.localhost|\$)\\([A-Za-z0-9][A-Za-z0-9._-]{0,63})((?:\\[A-Za-z0-9._-]+)+)$")
_PART = re.compile(r"^[A-Za-z0-9._-]{1,100}$")


def system():
    """Nom du système (platform.system()) : « Windows », « Linux »… Point d'entrée UNIQUE de la détection de plateforme (les tests le remplacent).
    ENOS_PLATFORM=Windows|Linux force la valeur (diagnostic, émulation dans les tests) ; hors cela c'est platform.system()."""
    return os.environ.get("ENOS_PLATFORM") or platform.system()


def is_windows():
    return system() == "Windows"


def is_linux():
    return system() == "Linux"


def parse_unc(unc):
    """« \\\\wsl.localhost\\<distribution>\\<dossier>… » -> (distribution, chemin Linux absolu). Lève ValueError si le chemin n'a pas cette forme."""
    m = _UNC.match(unc or "")
    parts = m.group(2).split("\\")[1:] if m else []
    if not m or any(p in (".", "..") for p in parts):
        raise ValueError("Chemin WSL invalide (attendu : \\\\wsl.localhost\\<distribution>\\<dossier>, ex. \\\\wsl.localhost\\Ubuntu\\home\\toi).")
    return m.group(1), "/" + "/".join(parts)


def parse_posix(path):
    """Linux natif : chemin absolu local -> ("", chemin normalisé). Lève ValueError (relatif, « .. », octet nul/saut de ligne, racine seule)."""
    if not isinstance(path, str) or not path.startswith("/") or "\x00" in path or "\n" in path or "\r" in path or len(path) > 1000:
        raise ValueError("Chemin invalide : indique un dossier absolu (ex. /home/toi/projets).")
    if ".." in path.split("/"):
        raise ValueError("Chemin invalide : « .. » n'est pas accepté.")
    norm = posixpath.normpath(path)
    if norm == "/":
        raise ValueError("La racine du disque est trop large : choisis un sous-dossier.")
    return "", norm


def clean_unc(unc):
    """Chemin choisi -> forme canonique, ou ValueError. Windows : UNC WSL (antislash de fin retiré). Linux : chemin POSIX normalisé."""
    unc = (unc or "").strip()
    if is_linux():
        return parse_posix(unc)[1]
    unc = unc.rstrip("\\")
    parse_unc(unc)
    return unc


_state = {"unc": None}


def _config():
    try:
        import nasko_core
        return nasko_core.load_config()
    except Exception:                                                  # noqa: BLE001 — jamais bloquer : on retombe sur le dossier par défaut
        return {}


def _configured():
    """Valeur du réglage `wsl_workspace` (chaîne vide si absente ou illisible)."""
    return str(_config().get(CONFIG_KEY) or "").strip()


def default_workspace():
    """Dossier utilisé tant que rien n'est réglé. Windows : DEFAULT_UNC. Linux : `depot_local_root` (ancien réglage) s'il est valide, sinon le dossier personnel."""
    if is_linux():
        legacy = os.path.expanduser(str(_config().get("depot_local_root") or "").strip())
        for cand in (legacy, os.path.expanduser("~")):
            try:
                if cand:
                    return parse_posix(cand)[1]
            except ValueError:
                continue
        return "/tmp"                                      # dernier recours (HOME absent ou invalide) : jamais la racine du disque
    return DEFAULT_UNC


def workspace_unc():
    """Dossier de travail courant. Réglage valide, sinon le défaut de la plateforme. Mis en cache jusqu'à set_workspace / reset."""
    if _state["unc"] is None:
        v = _configured()
        try:
            _state["unc"] = clean_unc(v) if v else default_workspace()
        except ValueError:
            _state["unc"] = default_workspace()
    return _state["unc"]


def is_default():
    return not _configured()


def reset():
    """Oublie le cache (rechargé depuis la configuration à la prochaine lecture). Sert aux tests."""
    _state["unc"] = None


def set_workspace(unc, persist=True):
    """Change le dossier de travail. `unc` vide = retour au dossier par défaut. Lève ValueError si la forme est invalide. Retourne le dossier appliqué."""
    unc = (unc or "").strip()
    new = clean_unc(unc) if unc else default_workspace()
    if persist:
        import nasko_core
        nasko_core.update_config({CONFIG_KEY: new if unc else ""})
    _state["unc"] = new
    return new


def _split():
    cur = workspace_unc()
    return parse_posix(cur) if is_linux() else parse_unc(cur)


def __getattr__(name):
    """WORKSPACE_UNC, DISTRO, DIR : calculés à chaque accès, donc toujours à jour après un changement de réglage."""
    if name == "WORKSPACE_UNC":
        return workspace_unc()
    if name == "DISTRO":
        return _split()[0]
    if name == "DIR":
        return _split()[1]
    raise AttributeError(name)


def _parts(sub):
    for p in sub:
        if not isinstance(p, str) or not _PART.match(p) or p in (".", ".."):
            raise ValueError("Nom invalide dans l'espace de travail.")
    return sub


def linux_path(*sub):
    """Chemin Linux absolu d'un élément DIRECT ou imbriqué de l'espace de travail (chaque segment contrôlé : jamais « .. », jamais de « / »)."""
    return "/".join((_split()[1].rstrip("/"),) + _parts(sub))


def unc_path(*sub):
    """Même chemin, vu de l'utilisateur : UNC Windows (Explorateur, VS Code…) ; sous Linux, le chemin local."""
    if is_linux():
        return linux_path(*sub)
    return "\\".join((workspace_unc(),) + _parts(sub))
