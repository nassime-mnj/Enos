"""ESPACE DE TRAVAIL WSL — source unique pour tout Enos.

    \\\\wsl.localhost\\<distribution>\\home\\<utilisateur>   (ex. \\\\wsl.localhost\\Ubuntu\\home\\nasko = /home/nasko dans la distribution « Ubuntu »)

  * tout `git clone` lancé depuis Enos (Dev Manager, module Dépôt) atterrit dans ce dossier ;
  * tout script .sh glissé dans la zone de dépôt du Dev Manager y est enregistré (LF, exécutable) ;
  * le terminal WSL du module Dépôt y démarre.
Le dossier est un RÉGLAGE (`wsl_workspace` dans nasko_config.json), modifiable depuis le module Dépôt (« ESPACE WSL ») : chaque utilisateur y met son propre dossier
(\\\\wsl.localhost\\Ubuntu\\home\\dimitri…). Tant que rien n'est réglé, le dossier historique du CEO (DEFAULT_UNC) s'applique. Seule la forme
\\\\wsl.localhost\\<distribution>\\<dossier>… est acceptée (chaque segment contrôlé, jamais « .. ») et seules les routes locales authentifiées peuvent le changer.
Les anciennes constantes WORKSPACE_UNC / DISTRO / DIR restent disponibles comme attributs du module mais sont calculées à chaque accès : ne jamais les copier à l'import.
Ce module nomme l'utilisateur Linux du CEO : il fait partie du lot « devtools » et est remplacé par une coquille dans les éditions qui l'excluent (release_editions.py)."""
import re

DEFAULT_UNC = "\\\\wsl.localhost\\Ubuntu\\home\\nasko"
CONFIG_KEY = "wsl_workspace"

_UNC = re.compile(r"^\\\\wsl(?:\.localhost|\$)\\([A-Za-z0-9][A-Za-z0-9._-]{0,63})((?:\\[A-Za-z0-9._-]+)+)$")
_PART = re.compile(r"^[A-Za-z0-9._-]{1,100}$")


def parse_unc(unc):
    """« \\\\wsl.localhost\\<distribution>\\<dossier>… » -> (distribution, chemin Linux absolu). Lève ValueError si le chemin n'a pas cette forme."""
    m = _UNC.match(unc or "")
    parts = m.group(2).split("\\")[1:] if m else []
    if not m or any(p in (".", "..") for p in parts):
        raise ValueError("Chemin WSL invalide (attendu : \\\\wsl.localhost\\<distribution>\\<dossier>, ex. \\\\wsl.localhost\\Ubuntu\\home\\toi).")
    return m.group(1), "/" + "/".join(parts)


def clean_unc(unc):
    """Chemin saisi par l'utilisateur -> forme canonique (espaces et antislash de fin retirés), ou ValueError."""
    unc = (unc or "").strip().rstrip("\\")
    parse_unc(unc)
    return unc


_state = {"unc": None}


def _configured():
    """Valeur du réglage `wsl_workspace` (chaîne vide si absente ou illisible)."""
    try:
        import nasko_core
        return str(nasko_core.load_config().get(CONFIG_KEY) or "").strip()
    except Exception:                                                  # noqa: BLE001 — jamais bloquer : on retombe sur le dossier par défaut
        return ""


def workspace_unc():
    """Dossier de travail courant (forme UNC). Réglage valide, sinon DEFAULT_UNC. Mis en cache jusqu'à set_workspace / reset."""
    if _state["unc"] is None:
        v = _configured()
        try:
            _state["unc"] = clean_unc(v) if v else DEFAULT_UNC
        except ValueError:
            _state["unc"] = DEFAULT_UNC
    return _state["unc"]


def is_default():
    return workspace_unc() == DEFAULT_UNC and not _configured()


def reset():
    """Oublie le cache (rechargé depuis la configuration à la prochaine lecture). Sert aux tests."""
    _state["unc"] = None


def set_workspace(unc, persist=True):
    """Change le dossier de travail. `unc` vide = retour au dossier par défaut. Lève ValueError si la forme est invalide. Retourne le dossier appliqué."""
    unc = (unc or "").strip()
    new = clean_unc(unc) if unc else DEFAULT_UNC
    if persist:
        import nasko_core
        nasko_core.update_config({CONFIG_KEY: new if unc else ""})
    _state["unc"] = new
    return new


def __getattr__(name):
    """WORKSPACE_UNC, DISTRO, DIR : calculés à chaque accès, donc toujours à jour après un changement de réglage."""
    if name == "WORKSPACE_UNC":
        return workspace_unc()
    if name == "DISTRO":
        return parse_unc(workspace_unc())[0]
    if name == "DIR":
        return parse_unc(workspace_unc())[1]
    raise AttributeError(name)


def _parts(sub):
    for p in sub:
        if not isinstance(p, str) or not _PART.match(p) or p in (".", ".."):
            raise ValueError("Nom invalide dans l'espace de travail.")
    return sub


def linux_path(*sub):
    """Chemin Linux absolu d'un élément DIRECT ou imbriqué de l'espace de travail (chaque segment contrôlé : jamais « .. », jamais de « / »)."""
    return "/".join((parse_unc(workspace_unc())[1],) + _parts(sub))


def unc_path(*sub):
    """Même chemin, vu de Windows (Explorateur, VS Code…)."""
    return "\\".join((workspace_unc(),) + _parts(sub))
