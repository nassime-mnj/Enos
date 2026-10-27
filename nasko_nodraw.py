"""PAS DE NULLE PAR RÉPÉTITION, PAS DE DÉFAITE : le filtre que E.N.O.S. et ETO appliquent à chaque coup choisi par Stockfish.

Fonctions pures (aucun moteur, aucun état global) : on leur donne le plateau et les lignes MultiPV, elles disent quel coup jouer.
Le même raisonnement existe côté téléphone (android/assets/mobile/js/chess_local.js) et dans l'entraînement de Super Enos (nasko_train.py).

Règle : un coup qui mène à une nulle (position déjà vue, pat, matériel insuffisant, règle des 50 coups qui approche) est écarté TANT QU'IL RESTE
une alternative qui ne gâche pas la partie. « Ne gâche pas » = l'évaluation reste au-dessus d'un plancher qui dépend de la situation :
  - position gagnante (≥ +5,0)  : on peut céder jusqu'à 3,5 pions pour éviter la nulle, mais on reste gagnant ;
  - avantage net (≥ +1,5)       : jusqu'à 1,5 pion ;
  - équilibre (≥ -0,5)          : jusqu'à 0,7 pion ;
  - léger désavantage (≥ -1,5)  : jusqu'à 0,3 pion ;
  - position perdante           : on accepte la nulle (elle vaut mieux qu'une défaite). Jamais perdre pour éviter une nulle.
Un mat forcé en notre faveur n'est jamais écarté.
"""
import chess

FIFTY_GUARD = 88          # demi-coups sans prise ni coup de pion : au-delà, un coup qui ne remet pas le compteur à zéro approche la nulle des 50 coups (seuil de la nulle : 100)


def draw_after(board, move):
    """Raison pour laquelle `move` mène à une nulle (ou s'en approche dangereusement), sinon ''. Le plateau n'est pas modifié."""
    b = board.copy()                              # copie AVEC l'historique : is_repetition() en a besoin
    b.push(move)
    if b.is_checkmate():
        return ""
    if b.is_stalemate():
        return "pat"
    if b.is_insufficient_material():
        return "matériel insuffisant"
    if b.is_repetition(2):
        return "répétition"
    if b.halfmove_clock >= FIFTY_GUARD:
        return "50 coups"
    return ""


def slack(top_cp):
    """Combien de centipions on accepte de céder, par rapport à la meilleure ligne, pour éviter une nulle."""
    if top_cp >= 500:
        return 350
    if top_cp >= 150:
        return 150
    if top_cp >= -50:
        return 70
    if top_cp >= -150:
        return 30
    return 0


def _merge(lines, extra):
    seen = {ln["move"] for ln in lines}
    return lines + [ln for ln in extra if ln["move"] not in seen]


def pick(board, lines, default=None, more=None):
    """Coup à jouer : (coup, raison_esquivée).

    lines   : [{"move", "cp", "mate"}] du point de vue du camp au trait, meilleure ligne d'abord (cp plafonné par le mat, mate > 0 = nous matons).
    default : le coup que l'appelant allait jouer (sinon la meilleure ligne).
    more    : fonction sans argument qui renvoie davantage de lignes (même forme), appelée seulement si toutes les lignes connues mènent à une nulle.
    raison_esquivée : '' si `default` est conservé ; sinon pourquoi il a été remplacé (« répétition », « pat »…).
    """
    if not lines:
        return default, ""
    if default is None:
        default = lines[0]["move"]
    top = lines[0]
    if top.get("mate") and top["mate"] > 0:
        return (default if default == top["move"] else top["move"]), ""      # un mat forcé n'est jamais échangé contre autre chose
    why = draw_after(board, default)
    if not why:
        return default, ""
    floor = top["cp"] - slack(top["cp"])
    pool = lines
    for attempt in range(2):
        for ln in sorted(pool, key=lambda x: -x["cp"]):
            if ln["move"] == default or ln["cp"] < floor:
                continue
            if not draw_after(board, ln["move"]):
                return ln["move"], why
        if attempt == 0 and more is not None:
            try:
                pool = _merge(lines, more())
            except Exception:                                                  # noqa: BLE001 — le renfort est facultatif
                break
        else:
            break
    return default, ""                                                         # aucune alternative sans risque de défaite : la nulle vaut mieux que perdre


def lines_from_infos(infos, color, mate_score=10000):
    """Transforme les `info` de python-chess (analyse MultiPV) en lignes {"move","cp","mate","pv","depth"} du point de vue de `color`."""
    out = []
    for inf in infos if isinstance(infos, list) else [infos]:
        pv = inf.get("pv") or []
        if not pv:
            continue
        sc = inf["score"].pov(color)
        mate = sc.mate()
        out.append({"move": pv[0], "pv": pv, "cp": sc.score(mate_score=mate_score), "mate": mate if mate and mate > 0 else None, "depth": inf.get("depth", 0)})
    return out
