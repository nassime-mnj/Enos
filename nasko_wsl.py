"""ESPACE DE TRAVAIL WSL du CEO — règle absolue, source unique pour tout Enos.

    \\\\wsl.localhost\\Ubuntu\\home\\nasko   (= /home/nasko dans la distribution « Ubuntu »)

  * tout `git clone` lancé depuis Enos (Dev Manager, module Dépôt) atterrit dans ce dossier ;
  * tout script .sh glissé dans la zone de dépôt du Dev Manager y est enregistré (LF, exécutable) ;
  * le terminal WSL du module Dépôt y démarre.
La distribution et le dossier ne sont PAS des réglages : changer ce chemin = modifier WORKSPACE_UNC ci-dessous (et rien d'autre). Aucune valeur de la
configuration, de l'interface ou d'une requête ne peut rediriger un clone ou un dépôt de script ailleurs.
Ce module nomme l'utilisateur Linux du CEO : il fait partie du lot « devtools » et est remplacé par une coquille dans l'édition Friends (release_editions.py)."""
import re

WORKSPACE_UNC = "\\\\wsl.localhost\\Ubuntu\\home\\nasko"

_UNC = re.compile(r"^\\\\wsl(?:\.localhost|\$)\\([A-Za-z0-9][A-Za-z0-9._-]{0,63})((?:\\[A-Za-z0-9._-]+)+)$")
_PART = re.compile(r"^[A-Za-z0-9._-]{1,100}$")


def parse_unc(unc):
    """« \\\\wsl.localhost\\<distribution>\\<dossier>… » -> (distribution, chemin Linux absolu). Lève ValueError si le chemin n'a pas cette forme."""
    m = _UNC.match(unc or "")
    parts = m.group(2).split("\\")[1:] if m else []
    if not m or any(p in (".", "..") for p in parts):
        raise ValueError("Chemin WSL invalide (attendu : \\\\wsl.localhost\\<distribution>\\<dossier>).")
    return m.group(1), "/" + "/".join(parts)


DISTRO, DIR = parse_unc(WORKSPACE_UNC)          # ("Ubuntu", "/home/nasko")


def _parts(sub):
    for p in sub:
        if not isinstance(p, str) or not _PART.match(p) or p in (".", ".."):
            raise ValueError("Nom invalide dans l'espace de travail.")
    return sub


def linux_path(*sub):
    """Chemin Linux absolu d'un élément DIRECT ou imbriqué de l'espace de travail (chaque segment contrôlé : jamais « .. », jamais de « / »)."""
    return "/".join((DIR,) + _parts(sub))


def unc_path(*sub):
    """Même chemin, vu de Windows (Explorateur, VS Code…)."""
    return "\\".join((WORKSPACE_UNC,) + _parts(sub))
