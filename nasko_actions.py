"""« Mains » de E.N.O.S. : actions locales declenchees par une balise [ACTION: NOM] dans la reponse du LLM.

Seules les actions de la liste blanche REGISTRY sont executees ; toute balise est retiree du texte final
(affichage et voix), qu'elle soit connue ou non.
"""
import logging
import re
import time

import nasko_tasks

log = logging.getLogger("nasko.actions")

ACTIONS_PROMPT = (
    "Actions locales : si Nassime te demande de préparer PixelLab, réponds naturellement et ajoute la balise exacte "
    "[ACTION: OPEN_PIXELLAB] à la toute fin de ta réponse texte. S'il te demande de préparer son environnement de dev, "
    "ajoute de la même façon la balise exacte [ACTION: OPEN_ENV]. N'ajoute aucune balise dans les autres cas, "
    "ne l'explique pas et ne la mentionne jamais : elle est invisible pour Nassime."
)

REGISTRY = {
    "OPEN_PIXELLAB": lambda cfg: nasko_tasks.ouvrir_navigation_privee(cfg),
    "OPEN_ENV": lambda cfg: nasko_tasks.lancer_environnement(cfg),
}
COOLDOWN = 15.0   # secondes : evite les ouvertures en rafale
_last = {}

_TAG = re.compile(r"\[\s*ACTION\s*:\s*([A-Za-z0-9_\-]*)\s*\]", re.I)
_DANGLING = re.compile(r"\[\s*ACTION[^\]]*$", re.I)   # balise tronquee en fin de texte


def extract(text):
    """Retourne (texte_sans_balises, [noms_d_actions_en_majuscules, sans doublon])."""
    names = []
    for m in _TAG.finditer(text):
        n = m.group(1).upper()
        if n and n not in names:
            names.append(n)
    clean = _DANGLING.sub("", _TAG.sub("", text))
    return re.sub(r"[ \t]+\n", "\n", clean).strip(), names


def execute(names, cfg):
    """Execute les actions autorisees. Retourne [{action, ok, message}]."""
    results = []
    for n in names:
        fn = REGISTRY.get(n)
        if fn is None:
            log.warning("Action inconnue ignoree : %s", n)
            continue
        if time.time() - _last.get(n, 0) < COOLDOWN:
            results.append({"action": n, "ok": True, "message": "Action déjà lancée à l'instant."})
            continue
        _last[n] = time.time()
        try:
            res = fn(cfg)
        except Exception as e:  # une action ne doit jamais faire echouer la reponse
            log.exception("Action %s en erreur", n)
            res = {"ok": False, "message": f"Erreur d'exécution : {e}"}
        if isinstance(res, tuple):                       # (ok, message) -> dict
            res = {"ok": res[0], "message": res[1]}
        log.info("Action %s -> %s (%s)", n, res.get("ok"), res.get("message"))
        results.append({"action": n, **res})
    return results
