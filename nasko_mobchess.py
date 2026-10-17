"""Échecs pour le TÉLÉPHONE : service SANS ÉTAT (la position arrive en FEN) qui prête le Stockfish du PC à l'application mobile.

  play / engine : le téléphone joue, le PC répond à la force réglée (même échelle que le CHESS du PC : puissance 1-100 % ↔ Elo).
  hint          : meilleur coup de la position.
  review        : bilan d'une partie collée en PGN (ex. une partie contre un bot de Chess.com) : chaque coup est jugé par le PC avec EXACTEMENT les règles
                  du bilan de CHESS (brillant / meilleur / imprécision / erreur / gaffe, précision, Elo estimé), puis ETO rédige des conseils de progression.
Moteurs DÉDIÉS (2 processus Stockfish, fermés après 5 min d'inactivité) : une partie en cours sur le PC n'est jamais perturbée.
Analyse d'une partie TERMINÉE uniquement : ce module ne lit pas l'écran et n'aide pas en direct (contre des humains, ce serait de la triche).
"""
import io
import logging
import random
import threading
import time
import uuid

import chess
import chess.engine
import chess.pgn

import nasko_chess as C
import nasko_core

log = logging.getLogger("nasko.mobchess")
_lock = threading.RLock()
_E = {"play": None, "ana": None, "t": time.time(), "reaper": False}
_JOBS = {}
MAX_PLIES = 160
ANA_TIME = 0.12


def _engines():
    """(moteur de jeu, moteur d'analyse) — ouverts à la demande. Lever ChessError si Stockfish est introuvable."""
    with _lock:
        _E["t"] = time.time()
        for k in ("play", "ana"):
            if _E[k] is None:
                _E[k], _ = C._open_engine()
        if not _E["reaper"]:
            _E["reaper"] = True
            threading.Thread(target=_reap, daemon=True, name="mobchess-reaper").start()
        return _E["play"], _E["ana"]


def _reap():
    while True:
        time.sleep(30)
        with _lock:
            if time.time() - _E["t"] > 300:
                for k in ("play", "ana"):
                    e, _E[k] = _E[k], None
                    if e:
                        try:
                            e.quit()
                        except Exception:                                   # noqa: BLE001
                            pass
                _E["reaper"] = False
                return


def close():
    with _lock:
        for k in ("play", "ana"):
            e, _E[k] = _E[k], None
            if e:
                try:
                    e.quit()
                except Exception:                                           # noqa: BLE001
                    pass


# ------------------------------------------------------------------ état d'une position
def _over(b):
    if b.is_checkmate():
        return "Échec et mat · " + ("les Noirs gagnent" if b.turn == chess.WHITE else "les Blancs gagnent")
    if b.is_stalemate():
        return "Pat · nulle"
    if b.is_insufficient_material():
        return "Nulle · matériel insuffisant"
    if b.can_claim_fifty_moves():
        return "Nulle · règle des 50 coups"
    if b.is_repetition(3):
        return "Nulle · triple répétition"
    return ""


def _board(fen):
    try:
        b = chess.Board(fen) if fen else chess.Board()
    except ValueError:
        raise C.ChessError("Position invalide.")
    return b


def view(b):
    return {"fen": b.fen(), "turn": "w" if b.turn == chess.WHITE else "b", "legal": [m.uci() for m in b.legal_moves], "check": b.is_check(), "over": _over(b)}


def _score(info):
    sc = info["score"].white()
    return sc.score(mate_score=C.MAT), sc.mate()


def _configure(eng, power):
    power = max(1, min(100, int(power)))
    if power >= 100:
        eng.configure({"UCI_LimitStrength": False})
        return 0.0
    elo = C.power_to_elo(power)
    opt = eng.options.get("UCI_Elo")
    lo, hi = (opt.min, opt.max) if opt else (1320, 3190)
    eng.configure({"UCI_LimitStrength": True, "UCI_Elo": max(lo, min(hi, elo))})
    return max(0.0, (lo - elo) / (lo - 250) * 0.6) if elo < lo else 0.0           # sous le plancher du moteur : coups au hasard de plus en plus fréquents


def _reply(b, power):
    """Coup du moteur pour la position b (trait au moteur). Retourne (coup, san)."""
    play, _ = _engines()
    blunder = _configure(play, power)
    if blunder and random.random() < blunder:
        mv = random.choice(list(b.legal_moves))
    else:
        mv = play.play(b, chess.engine.Limit(time=0.25 if power < 100 else 0.9)).move
    return mv, b.san(mv)


def _eval(b):
    if b.is_game_over():
        return {"cp": 0 if not b.is_checkmate() else (-C.MAT if b.turn == chess.WHITE else C.MAT), "mate": None}
    _, ana = _engines()
    cp, mate = _score(ana.analyse(b, chess.engine.Limit(time=0.15)))
    return {"cp": cp, "mate": mate}


# ------------------------------------------------------------------ API : jouer
def play(fen, uci, power=60, answer=True):
    """Le joueur joue `uci` sur `fen` ; le PC répond (sauf partie finie). Retourne la nouvelle position + coup du moteur + évaluation (Blancs)."""
    with _lock:
        b = _board(fen)
        try:
            mv = chess.Move.from_uci(uci)
        except ValueError:
            raise C.ChessError("Coup invalide.")
        if mv not in b.legal_moves:
            raise C.ChessError("Coup illégal.")
        san = b.san(mv)
        b.push(mv)
        out = {"san": san, "reply": None}
        if answer and not b.is_game_over() and not _over(b):
            r, rsan = _reply(b, power)
            out["reply"] = {"uci": r.uci(), "san": rsan}
            b.push(r)
        out.update(view(b))
        out["eval"] = _eval(b)
        return out


def state_of(fen):
    """Position (FEN) -> coups légaux, échec, fin de partie (le téléphone n'implémente pas les règles : le PC fait foi)."""
    return view(_board(fen))


def engine_first(fen, power=60):
    """Le moteur joue le premier coup (le joueur a les Noirs)."""
    with _lock:
        b = _board(fen)
        if b.is_game_over():
            return {**view(b), "reply": None}
        r, rsan = _reply(b, power)
        b.push(r)
        return {**view(b), "reply": {"uci": r.uci(), "san": rsan}, "eval": _eval(b)}


def hint(fen):
    with _lock:
        b = _board(fen)
        if b.is_game_over():
            raise C.ChessError("Partie terminée.")
        _, ana = _engines()
        info = ana.analyse(b, chess.engine.Limit(time=0.5))
        pv = info.get("pv") or []
        cp, mate = _score(info)
        return {"uci": pv[0].uci() if pv else "", "san": b.san(pv[0]) if pv else "", "eval": {"cp": cp, "mate": mate}}


# ------------------------------------------------------------------ API : bilan d'une partie (PGN)
def start_review(pgn_text, me="auto", username=""):
    game = chess.pgn.read_game(io.StringIO(pgn_text.strip()[:60000]))
    if game is None or not list(game.mainline_moves()):
        raise C.ChessError("PGN illisible : copie la partie en entier depuis Chess.com (Partager › PGN).")
    jid = uuid.uuid4().hex[:10]
    _JOBS[jid] = {"state": "running", "progress": 0.0, "result": None, "error": "", "t": time.time()}
    for k in [k for k, v in _JOBS.items() if time.time() - v["t"] > 3600]:
        _JOBS.pop(k, None)
    threading.Thread(target=_review_job, args=(jid, game, me, username), daemon=True, name="mobchess-review").start()
    return {"job": jid}


def review_status(jid):
    j = _JOBS.get(jid)
    if not j:
        raise C.ChessError("Analyse introuvable.")
    return {k: j[k] for k in ("state", "progress", "result", "error")}


def _color_of(game, me, username):
    if me in ("w", "b"):
        return chess.WHITE if me == "w" else chess.BLACK
    u = (username or "").strip().lower()
    h = game.headers
    if u and h.get("Black", "").strip().lower() == u:
        return chess.BLACK
    if u and h.get("White", "").strip().lower() == u:
        return chess.WHITE
    w, bk = h.get("White", "").lower(), h.get("Black", "").lower()
    if "bot" in w and "bot" not in bk:                                       # partie contre un bot de Chess.com : l'humain est l'autre camp
        return chess.BLACK
    if "bot" in bk and "bot" not in w:
        return chess.WHITE
    return chess.WHITE


def _review_job(jid, game, me, username):
    job = _JOBS[jid]
    try:
        me_color = _color_of(game, me, username)
        board = game.board()
        moves_in = list(game.mainline_moves())[:MAX_PLIES]
        with _lock:
            _, ana = _engines()
            info0 = ana.analyse(board, chess.engine.Limit(time=ANA_TIME))
            before, best = _score(info0)[0], (info0.get("pv") or [None])[0]
            moves, fens, n = [], [board.fen()], 0
            for mv in moves_in:
                n += 1
                san = board.san(mv)
                color = board.turn
                snap = board.copy(stack=False)
                board.push(mv)
                fens.append(board.fen())
                if board.is_game_over():
                    after, nxt = C._terminal(board), None
                else:
                    info = ana.analyse(board, chess.engine.Limit(time=ANA_TIME))
                    after, nxt = _score(info)[0], (info.get("pv") or [None])[0]
                q = C._quality(snap, mv, before, after, color)
                if best is not None and mv == best and q["key"] not in ("brilliant",) and q["loss"] <= 8:
                    q["key"], q["label"] = "best", C.QUALITY["best"]
                moves.append({**q, "n": n, "san": san, "uci": mv.uci(), "color": "w" if color == chess.WHITE else "b", "best": snap.san(best) if best and best != mv else "", "best_uci": best.uci() if best else ""})
                before, best = after, nxt
                job["progress"] = round(n / max(1, len(moves_in)), 3)
        rev = C.build_review(moves, me_color)
        opening = ""
        try:
            import nasko_boss
            ob = chess.Board()
            for mv in moves_in[:24]:                                         # dernier nom d'ouverture reconnu le long des premiers coups
                ob.push(mv)
                o = nasko_boss.opening_of(ob)
                if o:
                    opening = o["fr"][0].upper() + o["fr"][1:]
        except Exception:                                                    # noqa: BLE001
            pass
        for m in rev["critical"]:
            m["fen_before"] = fens[m["n"] - 1]
            m["fen_after"] = fens[m["n"]]
            m["uci"] = moves[m["n"] - 1]["uci"]
            m["best_uci"] = moves[m["n"] - 1]["best_uci"]
        res = {"review": rev, "headers": {k: str(game.headers.get(k, "")) for k in ("White", "Black", "Result", "Date", "Event", "Site")},
               "me": "w" if me_color == chess.WHITE else "b", "opening": opening, "fens": fens, "uci": [m["uci"] for m in moves], "keys": [m["key"] for m in moves],
               "truncated": len(list(game.mainline_moves())) > MAX_PLIES}
        res["advice"] = _advice(res)
        job["result"], job["state"] = res, "done"
    except Exception as e:                                                  # noqa: BLE001
        log.exception("bilan PGN")
        job.update(state="error", error=str(e)[:200] or e.__class__.__name__)


def _advice(res):
    """Conseils de progression d'ETO (3-5 phrases). Repli sur un gabarit si le LLM n'est pas configuré."""
    rv, me = res["review"], res["review"]["me"]
    crit = rv["critical"][:3]
    counts = me["counts"]
    facts = (f"Résultat {res['headers'].get('Result', '?')}. Ouverture : {res['opening'] or 'non identifiée'}. Précision {me['accuracy']} %, Elo estimé {me['elo']}, perte moyenne {me['acpl']} centipions par coup. "
             f"Brillants {counts.get('brilliant', 0)}, imprécisions {counts.get('inaccuracy', 0)}, erreurs {counts.get('mistake', 0)}, gaffes {counts.get('blunder', 0)}. "
             + " ".join(f"Coup {c['n']}: {c['san']} ({c['label']}, -{c['loss']} cp, mieux était {c['best'] or '?'})." for c in crit))
    cfg = nasko_core.load_config()
    try:
        import nasko_llm
        if nasko_llm.configured(cfg):
            sys_p = ("Tu es ETO, coach d'échecs bienveillant et exigeant. À partir du bilan d'une partie contre un bot, écris 4 à 5 phrases en français, tutoiement : "
                     "ce qui a bien marché, LES DEUX priorités de travail les plus utiles (concrètes, pas de généralités), puis un exercice à faire. "
                     "Cite les coups clés. Texte brut sans markdown, sans emoji.")
            return nasko_llm.complete(cfg, sys_p, facts, max_tokens=420).strip()
    except Exception as e:                                                  # noqa: BLE001
        log.info("conseils sans LLM : %s", e)
    worst = crit[0] if crit else None
    t = f"Précision {me['accuracy']} % (≈ {me['elo']} Elo). "
    t += f"Le moment décisif : coup {worst['n']} ({worst['san']}), {worst['label'].lower()} — il fallait jouer {worst['best'] or 'autre chose'}. " if worst else "Aucune gaffe majeure : beau travail. "
    return t + "Avant chaque coup, vérifie ce que ton adversaire menace (échecs, captures, pièces non protégées) : c'est le réflexe qui fait le plus gagner de points."
