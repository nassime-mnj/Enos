"""BOUTON « BRB » (urgence : le livreur sonne pendant une partie qu'on ne peut pas mettre en pause).

Ce module NE SIMULE AUCUNE ENTRÉE (ni clavier, ni souris) : faire jouer le personnage à ta place pour tromper la détection d'inactivité d'un jeu
est interdit par les conditions d'utilisation de la quasi-totalité des jeux et expose à un bannissement. À la place, le bouton :
  1. annonce ton absence à tes coéquipiers (phrase courte, dite avec ta voix traduite si Babel Voice est actif, sinon affichée),
  2. fait commenter l'Œil (bulle / voix selon tes options),
  3. lance un chronomètre d'absence et, si tu le demandes, te rappelle de revenir,
  4. à ton retour (`back()`), annonce que tu es là et donne la durée d'absence.
Les annonceurs sont injectables : `announce(text)` (chat vocal / texte du jeu) et `comment(text)` (Œil).
"""
import threading
import time

import nasko_core

_MAX_MIN = 120
_lock = threading.RLock()
S = {"since": None, "msg": "", "minutes": 0, "timer": None, "reminded": False}

DEFAULT_MSG = {"fr": "Je reviens dans quelques minutes, désolé !", "en": "Be right back, sorry guys!"}


def _announce(text, announce=None):
    try:
        if announce:
            announce(text)
            return
        if not nasko_core.load_config().get("babel_enabled"):      # pas de voix traduite si Babel Voice n'est pas activé
            return
        import nasko_babel
        nasko_babel.say(text)
    except Exception:                                               # noqa: BLE001 — l'annonce ne doit jamais échouer bruyamment
        pass


def _comment(text, comment=None):
    try:
        if comment:
            comment(text)
        else:
            import nasko_pet
            nasko_pet.comment(text)
    except Exception:                                               # noqa: BLE001
        pass


def start(message="", minutes=0, announce=None, comment=None, clock=time.time):
    """Active le mode BRB. `minutes` (0-120) : rappel de retour (0 = pas de rappel)."""
    cfg = nasko_core.load_config()
    msg = (message or "").strip()[:200] or DEFAULT_MSG["en" if nasko_core.language(cfg) == "en" else "fr"]
    minutes = max(0, min(_MAX_MIN, int(minutes or 0)))
    with _lock:
        if S["since"] is not None:
            return status(clock)
        S.update(since=clock(), msg=msg, minutes=minutes, reminded=False)
        if S["timer"]:
            S["timer"].cancel()
        S["timer"] = None
    _announce(msg, announce)
    _comment("Mode BRB activé. Je garde un œil sur tout ça.", comment)
    if minutes:
        t = threading.Timer(minutes * 60, _remind, kwargs={"comment": comment})
        t.daemon = True
        S["timer"] = t
        t.start()
    return status(clock)


def _remind(comment=None):
    with _lock:
        if S["since"] is None:
            return
        S["reminded"] = True
    _comment("Ton temps de BRB est écoulé : tes coéquipiers t'attendent.", comment)


def back(announce=None, comment=None, clock=time.time):
    """Fin du BRB : annonce le retour, retourne la durée d'absence (secondes)."""
    with _lock:
        since = S["since"]
        if since is None:
            return {"active": False, "elapsed": 0}
        elapsed = max(0, int(clock() - since))
        if S["timer"]:
            S["timer"].cancel()
        S.update(since=None, timer=None, reminded=False)
    cfg = nasko_core.load_config()
    _announce("I'm back!" if nasko_core.language(cfg) == "en" else "Je suis de retour !", announce)
    _comment(f"Bon retour ! Tu as été absent {elapsed // 60} min {elapsed % 60} s.", comment)
    return {"active": False, "elapsed": elapsed}


def status(clock=time.time):
    with _lock:
        since = S["since"]
        return {"active": since is not None, "message": S["msg"] if since else "", "elapsed": int(clock() - since) if since else 0,
                "minutes": S["minutes"] if since else 0, "reminded": S["reminded"] if since else False}
