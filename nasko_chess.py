"""DÉFI · CHESS : partie d'échecs contre Stockfish (python-chess) avec évaluation de chaque coup.

Backend uniquement : l'interface (plateau 2D) est dans static/defi.js. Une partie à la fois, conservée en mémoire.
Chaque coup (joueur ET moteur) est jugé en comparant l'évaluation en centipions AVANT et APRÈS, du point de vue de celui qui joue :
    perte = éval(avant, meilleur jeu) − éval(après, meilleure réponse adverse)
    BRILLANT      sacrifice de matériel (≥ 2 pions) qui reste (quasi) le meilleur coup, sans position déjà gagnée/perdue
    MEILLEUR COUP le coup recommandé par le moteur (perte ≤ 8 cp)
    EXCELLENT     perte ≤ 30 cp
    BON ≤ 70 · IMPRÉCISION ≤ 130 · ERREUR < 250 · GAFFE ≥ 250 cp
(les évaluations sont plafonnées à ±1000 cp : laisser filer une position déjà gagnée n'est pas une gaffe.)
"""
import datetime
import json
import math
import os
import random
import re
import threading
import time
import uuid

import chess
import chess.engine
import chess.pgn

import nasko_boss
import nasko_cache
import nasko_coach
import nasko_core
import nasko_persona
import nasko_titans
import nasko_tools as tools

SF_API = "official-stockfish/Stockfish"
SF_HOW = ("Placez stockfish*.exe dans « outils\\stockfish » à côté d'ENOS.exe ou dans %LOCALAPPDATA%\\ENOS\\outils\\stockfish "
          "(stockfishchess.org/download).")
CAP = 1000
MAT = 10000
VAL = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 100}
LIMIT_TIME = 0.5

QUALITY = {   # clé → libellé affiché
    "brilliant": "Brillant", "best": "Meilleur coup", "excellent": "Excellent", "good": "Bon",
    "inaccuracy": "Imprécision", "mistake": "Erreur", "blunder": "Gaffe",
}


class ChessError(Exception):
    pass


TAGGED = {}           # texte affiché -> même réplique avec Audio Tags (ETO) : ce que la voix eleven_v3 doit réellement prononcer


def _say(ctx, lang):
    """Commentaire de la personnalité active (E.N.O.S. ou ETO) ; mémorise la réplique pour la synthèse vocale et l'anti-répétition."""
    if G["mode"] != "enos" and not (ctx.get("force") or ctx.get("end")):      # cours : ETO commente via le coach, pas de réplique automatique à chaque coup
        return {"text": "", "kind": "normal", "voice": False, "tags": []}
    say = nasko_boss.comment(ctx, lang, G["last_taunt"], nasko_persona.current())
    speak = say.pop("speak", None)
    _remember(say["text"], speak)
    say["tags"] = nasko_persona.tags(speak) if speak else []        # le visage d'ETO joue ces émotions pendant qu'il parle
    return say


def _remember(text, speak=None):
    if not text:
        return
    G["last_taunt"] = text
    G["issued"].add(text)
    if speak:
        if len(TAGGED) > 300:
            TAGGED.clear()
        TAGGED[text] = speak


def spoken_for(text):
    """Texte à synthétiser pour une réplique affichée `text` : la version balisée d'ETO si elle existe."""
    return TAGGED.get(text, text)


_lock = threading.RLock()
_dl = {"busy": False, "pct": 0.0}
G = {"board": None, "engine": None, "play": None, "path": "", "me": chess.WHITE, "base": None, "moves": [], "over": "",
     "power": 100, "elo": 3200, "blunder_p": 0.0, "last_taunt": "", "seq": 0, "extra": {}, "opening": "", "issued": set(), "saved": True, "resigned": False,
     "pending": None, "takebacks": 0, "trash_n": 0,
     "mode": "enos", "challenger": "eto", "bot": "", "coach_ply": 0, "coach_last": 0, "base_pv": [], "_pv": [], "mate_said": 0}
LISTENERS = []        # fonctions (kind, payload) : le pont Godot s'y abonne pour animer chaque coup


# ----------------------------------------------------------------------------- Stockfish
def _is_sf(name):
    return name.startswith("stockfish") and name.endswith(".exe")


def stockfish_path():
    return tools.find_exe("stockfish.exe", "stockfish", _is_sf)


def _asset_pick(n):
    return n.startswith("stockfish-windows") and n.endswith(".zip")


def install_stockfish():
    """Dernière release officielle (variante x86-64-avx2, sinon la plus générique)."""
    _dl.update(busy=True, pct=0.0)
    try:
        import httpx
        try:
            with httpx.Client(timeout=30, verify=tools.ssl_context(), headers=tools.UA, follow_redirects=True) as c:
                r = c.get(f"https://api.github.com/repos/{SF_API}/releases/latest")
                r.raise_for_status()
                assets = [a for a in r.json().get("assets", []) if _asset_pick(a["name"].lower())]
        except (httpx.HTTPError, ValueError) as e:
            raise tools.ToolError(f"Impossible de joindre GitHub : {e}")
        best = None
        for suffix in ("x86-64-universal.zip", "x86-64-avx2.zip", "x86-64-sse41-popcnt.zip", "x86-64.zip"):   # « universal » = choisit le jeu d'instructions au lancement
            best = next((a for a in assets if a["name"].lower().endswith("-" + suffix)), None)
            if best:
                break
        if not best:
            raise tools.ToolError("Aucune archive Stockfish Windows trouvée dans la dernière release.")
        dg = best.get("digest") or ""
        tools.install_zip(best["browser_download_url"], "stockfish", dg.split(":", 1)[1] if dg.startswith("sha256:") else None,
                          lambda p: _dl.update(pct=p))
    except tools.ToolError as e:
        raise ChessError(f"{e} {SF_HOW}")
    finally:
        _dl["busy"] = False
    p = stockfish_path()
    if not p:
        raise ChessError("Stockfish introuvable après extraction. " + SF_HOW)
    return p


def _open_engine():
    path = stockfish_path() or install_stockfish()
    kw = {"creationflags": tools.CREATE_NO_WINDOW} if tools.CREATE_NO_WINDOW else {}
    try:
        eng = chess.engine.SimpleEngine.popen_uci(path, **kw)
    except (OSError, chess.engine.EngineError, chess.engine.EngineTerminatedError) as e:
        raise ChessError(f"Stockfish ne démarre pas ({e}). {SF_HOW}")
    return eng, path


def _engine():
    e = G["engine"]
    if e is None:
        G["engine"], G["path"] = _open_engine()
    return G["engine"]


def power_to_elo(power):
    """Jauge 1–100 % → Elo : 1 % = 250, 50 % = 1500, 100 % = 3200 (interpolation linéaire par segments)."""
    p = max(1, min(100, int(power)))
    return round(250 + (p - 1) / 49 * 1250) if p <= 50 else round(1500 + (p - 50) / 50 * 1700)


def _player():
    """Moteur qui JOUE les coups d'E.N.O.S. (2e processus : l'ANALYSE reste à pleine puissance), réglé selon la puissance de la partie."""
    if G["play"] is None:
        G["play"], _ = _open_engine()
    eng = G["play"]
    if G["power"] >= 100:
        eng.configure({"UCI_LimitStrength": False})
        G["blunder_p"] = 0.0
        return eng
    opt = eng.options.get("UCI_Elo")
    lo, hi = (opt.min, opt.max) if opt else (1320, 3190)
    elo = G["elo"]
    eng.configure({"UCI_LimitStrength": True, "UCI_Elo": max(lo, min(hi, elo))})
    # sous le plancher d'Elo du moteur (≈1320) : coups aléatoires de plus en plus fréquents (250 Elo ≈ 60 % de coups au hasard)
    G["blunder_p"] = max(0.0, (lo - elo) / (lo - 250) * 0.6) if elo < lo else 0.0
    return eng


def _choose(board):
    if G["blunder_p"] and random.random() < G["blunder_p"]:
        return random.choice(list(board.legal_moves))
    return _player().play(board, chess.engine.Limit(time=0.25 if G["power"] < 100 else LIMIT_TIME)).move


def close():
    with _lock:
        for k in ("engine", "play"):
            e, G[k] = G[k], None
            if e:
                try:
                    e.quit()
                except Exception:
                    try:
                        e.close()
                    except Exception:
                        pass


# ----------------------------------------------------------------------------- évaluation
def _analyse(board):
    """(score centipions point de vue des BLANCS, meilleur coup, mat en N point de vue des Blancs ou None) pour la position."""
    if board.is_game_over(claim_draw=False):
        G["_pv"] = []
        return _terminal(board), None, None
    info = _engine().analyse(board, chess.engine.Limit(time=LIMIT_TIME))
    pv = info.get("pv") or []
    G["_pv"] = list(pv[:8])                                          # ligne principale : sert au coach ETO (meilleure suite, façon de punir une erreur)
    sc = info["score"].white()
    return sc.score(mate_score=MAT), (pv[0] if pv else None), sc.mate()


def _terminal(board):
    if board.is_checkmate():
        return -MAT if board.turn == chess.WHITE else MAT
    return 0


def _material(board, color):
    return sum(VAL[p.piece_type] for p in board.piece_map().values() if p.color == color and p.piece_type != chess.KING)


def _is_sacrifice(board, move):
    """Le coup abandonne-t-il ≥ 2 pions de matériel, même après les échanges ? (estimation : 1 échange évalué à la volée)"""
    piece = board.piece_at(move.from_square)
    if piece is None or piece.piece_type in (chess.PAWN, chess.KING) and not board.is_capture(move):
        return False
    me = board.turn
    gain = VAL[board.piece_type_at(move.to_square) or chess.PAWN] if board.is_capture(move) else 0
    after = board.copy(stack=False)
    after.push(move)
    sq = move.to_square
    attackers = after.attackers(not me, sq)
    if not attackers:
        return False
    defended = bool(after.attackers(me, sq))
    cheapest = min(VAL[after.piece_type_at(a)] for a in attackers)
    mine = VAL[after.piece_type_at(sq)]
    lost = mine if not defended else (mine - cheapest if cheapest < mine else 0)
    return lost - gain >= 2


def _quality(board_before, move, before_w, after_w, color):
    sgn = 1 if color == chess.WHITE else -1
    b, a = max(-CAP, min(CAP, sgn * before_w)), max(-CAP, min(CAP, sgn * after_w))
    loss = max(0, b - a)
    if loss <= 15 and _is_sacrifice(board_before, move) and a >= -50 and b < 600:
        key = "brilliant"
    elif loss <= 8:
        key = "best"
    elif loss <= 30:
        key = "excellent"
    elif loss <= 70:
        key = "good"
    elif loss <= 130:
        key = "inaccuracy"
    elif loss < 250:
        key = "mistake"
    else:
        key = "blunder"
    return {"key": key, "label": QUALITY[key], "loss": int(loss), "before": int(sgn * before_w), "after": int(sgn * after_w)}


def _anim(b, move):
    """Description d'un coup pour l'animation (plateau AVANT le coup) : capture (y compris prise en passant), roque, promotion."""
    name = chess.square_name
    pc = b.piece_at(move.from_square)
    a = {"from": name(move.from_square), "to": name(move.to_square), "piece": pc.symbol() if pc else "",
         "capture": None, "captured": "", "extra": None, "promo": chess.piece_symbol(move.promotion) if move.promotion else None}
    if b.is_en_passant(move):
        sq = chess.square(chess.square_file(move.to_square), chess.square_rank(move.from_square))
        a["capture"], a["captured"] = name(sq), b.piece_at(sq).symbol()
    elif b.is_capture(move):
        a["capture"], a["captured"] = name(move.to_square), b.piece_at(move.to_square).symbol()
    if b.is_castling(move):
        r = chess.square_rank(move.from_square)
        king_side = chess.square_file(move.to_square) > chess.square_file(move.from_square)
        a["extra"] = {"from": name(chess.square(7 if king_side else 0, r)), "to": name(chess.square(5 if king_side else 3, r))}
    return a


def _why(snap, move, after, pv, q, mate_after):
    """POURQUOI le coup est bon ou mauvais, en faits vérifiés sur l'échiquier (matériel, échec, mat, pièce en prise) : de quoi nourrir le coach."""
    out = []
    bad = q["key"] in ("inaccuracy", "mistake", "blunder")
    reply = pv[0] if pv else None
    if bad and reply and reply in after.legal_moves:
        if after.is_capture(reply):
            ct = after.piece_type_at(reply.to_square) or chess.PAWN
            out.append(f"l'adversaire peut gagner {PIECE_FR[ct]} en {chess.square_name(reply.to_square)}")
        t = after.copy(stack=False)
        t.push(reply)
        if t.is_checkmate():
            out.append("le coup permet un échec et mat")
        elif t.is_check():
            out.append("le coup ouvre la porte à un échec gênant")
    if mate_after and mate_after < 0:
        out.append(f"un mat forcé en {abs(mate_after)} coups devient possible contre celui qui a joué")
    pc = after.piece_at(move.to_square)
    if bad and pc and pc.piece_type != chess.KING:
        att = after.attackers(not pc.color, move.to_square)
        if att and (not after.attackers(pc.color, move.to_square) or min(VAL[after.piece_type_at(a)] for a in att) < VAL[pc.piece_type]):
            out.append(f"la pièce déplacée se retrouve menacée en {chess.square_name(move.to_square)}")
        if pc.piece_type == chess.PAWN and chess.square_file(move.to_square) in (5, 6, 7):
            out.append("ce pion avance et laisse des cases faibles autour du roi")
        elif pc.piece_type == chess.PAWN:
            out.append("ce pion avance et laisse des cases faibles derrière lui")
    if q["loss"] >= 30:
        out.append(f"l'évaluation passe de {q['before'] / 100:+.1f} à {q['after'] / 100:+.1f} pour celui qui joue")
    return out


def _san_line(board, moves, n=5):
    """Une ligne de coups en SAN français (depuis `board`, qui n'est pas modifié)."""
    b, out = board.copy(stack=False), []
    for m in list(moves)[:n]:
        try:
            out.append(nasko_boss.san_local(b.san(m), "fr"))
            b.push(m)
        except Exception:                                            # noqa: BLE001 — ligne devenue illégale : on s'arrête là
            break
    return out


def _play(move, with_ctx=False):
    """Joue `move` pour le camp au trait ; renvoie son jugement. G['base'] = (éval blanc, meilleur coup) de la position courante."""
    b = G["board"]
    color = b.turn
    before_w, best, before_mate = G["base"]
    pv_before = list(G.get("base_pv") or [])
    san = b.san(move)
    snap = b.copy(stack=False)
    anim = _anim(snap, move)
    b.push(move)
    anim["check"], anim["mate"] = b.is_check(), b.is_checkmate()
    after_w, nxt, _after_mate = _analyse(b)
    G["base"] = (after_w, nxt, _after_mate)
    G["base_pv"] = list(G.get("_pv") or [])
    q = _quality(snap, move, before_w, after_w, color)
    anim["quality"] = q["key"]
    if q["key"] in ("best", "excellent", "good") and nasko_boss.opening_of(b):
        anim["quality"] = "book"                                     # coup de théorie : icône « livre »
    q["best_uci"] = best.uci() if best and best != move else ""
    q.update(san=san, uci=move.uci(), color="w" if color == chess.WHITE else "b", best=(snap.san(best) if best and best != move else ""),
             n=len(b.move_stack), anim=anim)
    sg = 1 if color == chess.WHITE else -1
    q.update(pv_best=_san_line(snap, pv_before) if best and best != move else [], pv_after=_san_line(b, G["base_pv"]),
             mate_after=(_after_mate * sg) if _after_mate else None,
             pv_after_uci=[m.uci() for m in G["base_pv"][:3]], pv_best_uci=[m.uci() for m in pv_before[:3]] if best and best != move else [])
    q["why"] = _why(snap, move, b, G["base_pv"], q, _after_mate * sg if _after_mate else None)
    if with_ctx:                                                    # contexte du commentaire (coup du JOUEUR uniquement)
        sgn = 1 if color == chess.WHITE else -1
        mate = before_mate * sgn if before_mate and before_mate * sgn > 0 else None          # mat que le joueur avait et n'a pas joué
        hang = None
        if nxt and b.is_capture(nxt):
            pc = b.piece_at(nxt.to_square)
            if pc and pc.piece_type in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN):
                hang = pc.symbol().lower()
        q["ctx"] = {"key": q["key"], "best_move": snap.san(best) if best and best != move else "", "mate": mate, "hang": hang,
                    "capture": anim["capture"] is not None, "check": anim["check"], "castle": anim["extra"] is not None,
                    "promo": anim["promo"] is not None}
    G["moves"].append(q)
    return q


def _result():
    b = G["board"]
    if G.get("resigned"):
        return "Abandon : le bot gagne" if G.get("mode") == "coach" else "Abandon : E.N.O.S. gagne"
    if b.is_checkmate():
        return "Échec et mat : " + ("les Noirs" if b.turn == chess.WHITE else "les Blancs") + " gagnent"
    if b.is_stalemate():
        return "Pat : nulle"
    if b.is_insufficient_material() or b.is_fifty_moves() or b.is_repetition(3):
        return "Nulle"
    return ""


def _bot_move(b):
    """Coup de l'adversaire : (coup, info_brillant | None). Le bot « ETO Brillant » (3200 Elo, choisi dans la liste des bots) cherche le sacrifice brillant comme ETO."""
    if G.get("bot_brilliant"):
        return _eto_choose(b)
    return _choose(b), None


def _engine_turn():
    b = G["board"]
    if b.is_game_over() or b.turn == G["me"]:
        return None
    brill = None
    # ETO Brillant : cherche toujours le sacrifice brillant. ETO (adversaire « normal » choisi explicitement) : meilleur coup à la force réglée, sans chasse au !!.
    # Ancien comportement conservé quand aucun adversaire n'est choisi : ETO actif à pleine force = chasse au sacrifice.
    if (G["power"] >= 100 and nasko_persona.current() == "eto" and G.get("opponent") != "eto") or G.get("bot_brilliant"):
        mv, brill = _eto_choose(b)
    else:
        mv = _choose(b)
    snap = b.copy(stack=False)
    rec = _play(mv)
    if brill:
        _mark_brilliant(rec, brill, snap)
    return rec

# ----------------------------------------------------------------------------- COUP BRILLANT (!!) : l'obsession d'ETO
# ETO est un joueur de spectacle : s'il existe une tactique avec SACRIFICE de pièce qui garde un avantage décisif, il la joue en priorité absolue, même si
# Stockfish la classe 2e ou 3e. Stockfish est lancé en MultiPV (4 lignes à profondeur 15+) ; chaque ligne passe par le filtre de sacrifice ci-dessous.
BRILL_MULTIPV = 4
BRILL_DEPTH = 15
BRILL_MIN_CP = 200                  # le sacrifice doit laisser au moins +2,0 (ou un mat) au bout de la ligne
BRILL_MAX_LOSS = 200                # ... et ne pas coûter plus de 2 pions par rapport à la meilleure ligne (sauf mat à la clé)


def _net(board, color):
    return _material(board, color) - _material(board, not color)


def _sacrifice_of(board, pv):
    """FILTRE DE SACRIFICE. Joue les 3 premiers demi-coups de la ligne et vérifie, sur l'échiquier :
      1. au demi-coup 2, l'adversaire CAPTURE une de nos pièces lourdes (cavalier, fou, tour ou dame) : on donne du matériel ;
      2. le déficit matériel après ce demi-coup 2 est d'au moins 2 pions (un échange à égalité n'est pas un sacrifice) ;
      3. au demi-coup 3 nous NE recapturons PAS immédiatement : le déficit reste d'au moins 1 pion (sinon c'est un simple échange).
    Retourne {piece, deficit} ou None."""
    if len(pv) < 2:
        return None
    color = board.turn
    b = board.copy(stack=False)
    base = _net(b, color)
    try:
        b.push(pv[0])
        if pv[1] not in b.legal_moves:
            return None
        lost = b.piece_type_at(pv[1].to_square)                  # ce que l'adversaire prend au demi-coup 2
        if b.is_en_passant(pv[1]) or lost not in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN):
            return None
        b.push(pv[1])
        d2 = base - _net(b, color)
        d3 = d2
        if len(pv) >= 3 and pv[2] in b.legal_moves:
            b.push(pv[2])
            d3 = base - _net(b, color)
    except (ValueError, AssertionError):
        return None
    if d2 >= 2 and d3 >= 1:
        return {"piece": PIECE_FR[lost], "piece_type": lost, "deficit": int(d2)}
    return None


def _offered_sacrifice(board, move):
    """SACRIFICE OFFERT (piège) : après notre coup, l'adversaire PEUT prendre une pièce lourde, mais ce n'est pas sa meilleure réponse (il se ferait mater / écraser).
    On force chaque prise (root_moves) et on regarde ce que Stockfish trouve ensuite : si, prise acceptée, l'évaluation reste ≥ +2,0 (ou mat) avec un matériel toujours
    déficitaire au demi-coup 3, c'est un vrai sacrifice brillant, qu'il soit accepté ou refusé. Retourne {piece, deficit, cp, mate, depth, line_pv} ou None."""
    color = board.turn
    b = board.copy(stack=False)
    b.push(move)
    heavy = (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN)
    caps = [c for c in b.legal_moves if b.is_capture(c) and not b.is_en_passant(c) and b.piece_type_at(c.to_square) in heavy]
    caps.sort(key=lambda c: -VAL[b.piece_type_at(c.to_square)])
    for cap in caps[:2]:
        try:
            inf = _engine().analyse(b, chess.engine.Limit(depth=13, time=1.0), root_moves=[cap])
        except Exception:                                            # noqa: BLE001
            continue
        pv = [cap] + list((inf.get("pv") or [])[1:5])
        sc = inf["score"].pov(color)
        mate = sc.mate()
        cp = sc.score(mate_score=MAT)
        sac = _sacrifice_of(board, [move] + pv)
        if sac and (cp >= BRILL_MIN_CP or (mate and mate > 0)):
            return {**sac, "cp": cp, "mate": mate if mate and mate > 0 else None, "depth": inf.get("depth", 0), "line_pv": [move] + pv, "offered": True}
    return None


def _tension(board, move):
    """Goût du spectacle : un coup qui donne échec, capture, ou pose une pièce en prise est plus « tactique » qu'un coup calme."""
    t = 0
    if board.gives_check(move):
        t += 2
    if board.is_capture(move):
        t += 1
    p = board.piece_at(move.from_square)
    if p and p.piece_type != chess.PAWN and board.is_attacked_by(not board.turn, move.to_square):
        t += 1
    return t


def _eto_choose(board):
    """Coup d'ETO : (coup, info_brillant | None). MultiPV puis filtre de sacrifice ; sinon la meilleure ligne (avec un penchant pour les lignes tactiques)."""
    color = board.turn
    try:
        infos = _engine().analyse(board, chess.engine.Limit(depth=BRILL_DEPTH, time=2.5), multipv=BRILL_MULTIPV)
    except Exception:                                                # noqa: BLE001 — jamais bloquer la partie : on retombe sur le meilleur coup habituel
        infos = []
    lines = []
    for inf in infos if isinstance(infos, list) else [infos]:
        pv = inf.get("pv") or []
        if not pv:
            continue
        sc = inf["score"].pov(color)
        mate = sc.mate()
        lines.append({"move": pv[0], "pv": pv, "cp": sc.score(mate_score=MAT), "mate": mate if mate and mate > 0 else None, "depth": inf.get("depth", 0)})
    if not lines:
        best = G["base"][1] if G["base"] and G["base"][1] in board.legal_moves else _engine().play(board, chess.engine.Limit(time=0.4)).move
        return best, None
    top = lines[0]
    # 1) coup brillant ?  (priorité absolue sur la ligne 1)
    cands = []
    for ln in lines:
        sac = _sacrifice_of(board, ln["pv"])                          # sacrifice FORCÉ : la meilleure défense prend la pièce
        if not sac:
            sac = _offered_sacrifice(board, ln["move"])               # sacrifice OFFERT : prise possible mais fatale pour l'adversaire
            if sac and not (ln["cp"] >= BRILL_MIN_CP or ln["mate"]):  # ... et la défense (refus) ne doit pas gâcher l'avantage
                sac = None
        if not sac:
            continue
        decisive = ln["mate"] is not None or ln["cp"] >= BRILL_MIN_CP
        keeps = (top["mate"] is None and top["cp"] - ln["cp"] <= BRILL_MAX_LOSS) or (top["mate"] is not None and ln["mate"] is not None)
        if decisive and keeps:
            cands.append((1 if ln["mate"] else 0, ln["cp"], sac["deficit"], ln, sac))
    if cands:
        cands.sort(key=lambda c: (c[0], c[1], c[2]), reverse=True)  # mat d'abord, puis la meilleure évaluation, puis le plus gros sacrifice
        _, _, _, ln, sac = cands[0]
        shown = sac.get("line_pv") or ln["pv"]                       # ligne montrée : celle où la pièce est prise
        info = {**sac, "cp": max(ln["cp"], sac.get("cp", 0)) if not sac.get("offered") else sac["cp"], "mate": sac.get("mate") or ln["mate"], "depth": ln["depth"],
                "rank": lines.index(ln) + 1, "line": _san_line(board, shown, 6)}
        info.pop("line_pv", None)
        return ln["move"], info
    # 2) pas de sacrifice : parmi les lignes quasi équivalentes (≤ 25 cp de la meilleure), on préfère la plus tactique (sauf si la partie est déjà gagnée à coup sûr)
    if top["mate"] is None and -150 < top["cp"] < 600:
        near = [ln for ln in lines if top["cp"] - ln["cp"] <= 25 and ln["mate"] is None]
        near.sort(key=lambda ln: (_tension(board, ln["move"]), ln["cp"]), reverse=True)
        return near[0]["move"], None
    return top["move"], None


def _mark_brilliant(rec, info, snap):
    """Le coup devient « Brillant » (!!) : jugement, icône, raisons et intentions pour le coach."""
    rec["key"], rec["label"], rec["brilliant"] = "brilliant", "Brillant", True
    rec["anim"]["quality"] = "brilliant"
    rec["sacrifice"] = info
    rec.setdefault("hints", []).insert(0, f"SACRIFICE de {info['piece']} (déficit de {info['deficit']} pions)")
    tail = f"mat forcé en {info['mate']} coups" if info.get("mate") else f"évaluation ensuite {info['cp'] / 100:+.1f} pour celui qui sacrifie"
    rec.setdefault("why", []).insert(0, f"sacrifice de {info['piece']} qui rapporte : {tail} (ligne : {' '.join(info['line'][:5])})")




def state(extra=None):
    b = G["board"]
    if b is None:
        return {"active": False, **_tools_state()}
    legal = {}
    if b.turn == G["me"] and not b.is_game_over() and not G["resigned"] and not G["pending"] and G["mode"] not in ("speedrun", "titans", "boss"):
        for m in b.legal_moves:
            legal.setdefault(chess.square_name(m.from_square), []).append(chess.square_name(m.to_square))
    ev = G["base"][0] if G["base"] else 0
    last = b.peek().uci() if b.move_stack else ""
    return {"active": True, "fen": b.fen(), "board": {chess.square_name(s): p.symbol() for s, p in b.piece_map().items()},
            "turn": "w" if b.turn == chess.WHITE else "b", "me": "w" if G["me"] == chess.WHITE else "b", "legal": legal,
            "power": G["power"], "elo": G["elo"], "mode": G["mode"], "challenger": G.get("challenger", "eto") if G["mode"] == "boss" else "", "opponent": G.get("opponent", ""), "bot": G["bot"], "players": players(), "setup": bool(G.get("setup")), "check": b.is_check(), "over": _result(), "eval": int(ev), "last": last, "moves": G["moves"][-60:], "seq": G["seq"], "decision": _public_pending(),
            "review": build_review(G["moves"], G["me"]) if _result() else None,
            **(extra if extra is not None else G["extra"]), **_tools_state()}


def players():
    """Qui tient quelle couleur : {"w": nom des Blancs, "b": nom des Noirs} (affiché à gauche du plateau)."""
    me_w = G["me"] == chess.WHITE
    mode = G["mode"]
    if mode == "boss":
        mine, other = {"eto": "ETO", "enos": "E.N.O.S.", "duo": "E.N.O.S. + ETO"}.get(G.get("challenger"), "ETO"), "STOCKFISH"
    elif mode == "titans":
        mine, other = "ETO", "E.N.O.S."
    elif mode == "speedrun":
        mine, other = "ETO", G["bot"]
    elif mode == "coach":
        mine, other = "VOUS", G["bot"]
    else:
        opp = G.get("opponent")
        mine, other = "VOUS", ("ETO" if (opp in ("eto", "eto_brillant") or (not opp and nasko_persona.current() == "eto")) else "E.N.O.S.")
    return {"w": mine if me_w else other, "b": other if me_w else mine}


def view():
    """Vue minimale envoyée au plateau Godot (position, trait, coups légaux, mode et camps)."""
    st = state()
    out = {k: st[k] for k in ("board", "turn", "me", "legal", "check", "over", "last", "power", "elo", "eval", "seq", "decision", "mode", "players", "challenger") if k in st}
    return out


def _emit(kind, payload):
    for fn in list(LISTENERS):
        try:
            fn(kind, payload)
        except Exception:
            pass


def _tools_state():
    return {"stockfish": bool(stockfish_path()), "download": dict(_dl)}


# ----------------------------------------------------------------------------- API
def new_game(color="w", power=100, mode="enos", elo=None, fen=None, challenger="eto", opponent=""):
    """`fen` : MISE EN CONDITION — la partie démarre depuis une position libre (défi E.N.O.S./ETO uniquement, non archivée dans l'historique)."""
    with _lock:
        b0 = G["board"]
        if b0 is not None and not G["saved"] and len(b0.move_stack) >= 4 and not b0.is_game_over():
            _save_game("abandon")
        opponent = opponent if opponent in ("enos", "eto", "eto_brillant") else ""      # duel : E.N.O.S., ETO ou ETO Brillant (3200 Elo, traque le sacrifice)
        power = 100 if mode == "titans" or opponent == "eto_brillant" else BOSS_CHALLENGER_POWER if mode == "boss" else max(1, min(100, int(power)))   # Titans : 3200 Elo chacun · Boss : les challengers sont un cran sous Stockfish
        board = chess.Board()
        custom = bool(fen)
        if custom:
            board = setup_board({"fen": fen})
            if board.is_game_over():
                raise ChessError("Cette position est déjà terminée (mat ou nulle) : modifiez-la.")
            mode = "enos"
        G.update(board=board, me=chess.BLACK if color == "b" else chess.WHITE, moves=[], over="", power=power, setup=custom,
                 elo=power_to_elo(power), last_taunt="", opening="", issued=set(), saved=custom, resigned=False, pending=None, takebacks=0, trash_n=0,
                 mode=mode if mode in ("coach", "speedrun", "titans", "boss") else "enos", challenger=challenger if challenger in ("eto", "enos", "duo") else "eto", ti_last=None, ti_log=[], ti_ply=0, bot_brilliant=bool(elo and int(elo) >= 3200 and mode in ("coach", "speedrun")) or (opponent == "eto_brillant" and mode == "enos"), opponent=opponent if mode == "enos" else "", coach_ply=0, coach_last=0, base_pv=[], mate_said=0, sr_last_bot=None, sr_last_eto=None)
        if elo:                                                     # Elo exact demandé (cours) : le bot affiche et joue ce niveau, pas l'arrondi de la jauge
            G["elo"] = max(250, min(3190, int(elo)))
        G["bot"] = f"Bot {G['elo']} Elo" if G["mode"] in ("coach", "speedrun") else "STOCKFISH" if G["mode"] == "boss" else "ETO" if G["opponent"] == "eto" else "E.N.O.S."
        if G["mode"] == "boss":
            _boss_tune()
        if G["bot_brilliant"]:
            G["elo"], G["bot"] = 3200, "ETO Brillant"                    # bot sélectionnable : 3200 Elo, traque le sacrifice brillant (!!)
        _player()                                                   # applique la difficulté avant le 1er coup
        G["base"] = _analyse(G["board"])
        G["base_pv"] = list(G.get("_pv") or [])
        reply = None if G["mode"] in ("speedrun", "titans", "boss") else _engine_turn()          # speedrun : ETO et le bot jouent via speedrun_step(), le joueur est spectateur
        G["seq"] += 1
        G["extra"] = {"reply": reply}
        st = state()
        _emit("new", view())
        return st


def move(uci, promotion=None):
    with _lock:
        b = G["board"]
        if b is None:
            raise ChessError("Aucune partie en cours.")
        if G["resigned"] or b.is_game_over():
            raise ChessError("La partie est terminée.")
        if G["mode"] == "speedrun":
            raise ChessError("Speedrun : vous êtes spectateur, c'est ETO qui joue.")
        if G["mode"] == "titans":
            raise ChessError("Choc des Titans : vous êtes spectateur, E.N.O.S. et ETO s'affrontent.")
        if G["mode"] == "boss":
            raise ChessError("Combat contre le boss : vous êtes spectateur, E.N.O.S. et/ou ETO affrontent Stockfish.")
        if G["pending"]:
            raise ChessError("Une décision est en attente : continuez avec la gaffe ou annulez le coup.")
        if b.turn != G["me"]:
            raise ChessError("Ce n'est pas votre tour.")
        try:
            m = chess.Move.from_uci(uci)
        except ValueError:
            raise ChessError("Coup invalide.")
        if m not in b.legal_moves:
            promo = chess.Move.from_uci(uci + (promotion or "q"))
            if promo not in b.legal_moves:
                raise ChessError("Coup illégal.")
            m = promo
        base_before, opening_before, moves_before = G["base"], G["opening"], len(G["moves"])
        pv_before = list(G.get("base_pv") or [])
        mine = _play(m, with_ctx=True)
        ctx = mine.pop("ctx")
        lang = nasko_core.language()
        if ctx["best_move"]:
            ctx["best"] = nasko_boss.san_local(ctx["best_move"], lang)
        G["trash_n"] = 0                                            # le joueur a joué : le compteur de bavardage repart de zéro
        if _is_catastrophe(mine) and G["takebacks"] < int(nasko_core.load_config().get("chess_takebacks", 2)) and not G["board"].is_game_over():
            ctx["force"] = "catastrophe"
            say = _say(ctx, lang)
            G["pending"] = {"uci": m.uci(), "san": mine["san"], "best": ctx.get("best", ""), "best_uci": mine.get("best_uci", ""), "loss": mine["loss"],
                            "ctx": ctx, "base": base_before, "opening": opening_before, "moves_before": moves_before, "base_pv": pv_before}
            G["seq"] += 1
            G["extra"] = {"played": mine, "reply": None, "taunt": say}
            st = state()
            _emit("update", {"steps": [mine["anim"]], "view": view(), "say": say, "decision": _public_pending()})
            return st
        return _finish_turn(mine, ctx, lang)


def _is_catastrophe(q):
    """Gaffe monumentale : le jugement est « Gaffe » ET la probabilité de gain chute d'au moins 25 points depuis une position encore jouable."""
    if q["key"] != "blunder":
        return False
    drop = _winpct(q["before"]) - _winpct(q["after"])
    return drop >= 25.0 and q["before"] > -300


def _public_pending():
    p = G.get("pending")
    return {"san": p["san"], "best": p["best"], "best_uci": p["best_uci"], "loss": p["loss"], "from": p["uci"][:2], "to": p["uci"][2:4]} if p else None


def _finish_turn(mine, ctx, lang):
    """Fin du tour du joueur : ouverture, réplique du moteur, fin de partie, commentaire, notification du plateau."""
    op = nasko_boss.opening_of(G["board"])
    if op and op["san"] != G["opening"]:
        ctx["opening"] = op
    if op:
        G["opening"] = op["san"]
    reply = None if G["board"].is_game_over() else _engine_turn()
    end = None
    if G["board"].is_checkmate():
        end = "player_mate" if reply is None else "engine_mate"
    elif G["board"].is_game_over():
        end = "draw"
    if reply:                                                       # le coup d'E.N.O.S. met à jour l'ouverture courante, sans commentaire
        op2 = nasko_boss.opening_of(G["board"])
        if op2:
            G["opening"] = op2["san"]
    ctx["end"] = end
    if end is None and G["mode"] == "enos" and not ctx.get("force") and nasko_persona.current() == "enos":
        mn = _forced_mate_for_engine()                              # E.N.O.S. a trouvé un mat forcé : il l'annonce avec arrogance
        if mn and mn <= 30 and (G["mate_said"] == 0 or (mn < G["mate_said"] and mn in (5, 3, 2, 1))):
            G["mate_said"] = mn
            ctx["force"], ctx["mate_n"] = "mate_announce", mn
    say = _say(ctx, lang)                                           # ne juge QUE le coup du joueur (et la fin de partie) : jamais le prochain coup
    if end:
        _save_game("end")
    G["seq"] += 1
    G["extra"] = {"played": mine, "reply": reply, "taunt": say}
    st = state()
    steps = ([mine["anim"]] if not ctx.get("force") else []) + ([reply["anim"]] if reply else [])
    _emit("update", {"steps": steps, "view": view(), "say": say})
    if reply and reply.get("brilliant"):
        _emit("brilliant", {"from": reply["anim"]["from"], "to": reply["anim"]["to"]})
    return st


def _forced_mate_for_engine():
    """Mat forcé d'E.N.O.S. : nombre de coups, ou 0. (G['base'][2] = mat en N du point de vue des Blancs, positif si les Blancs matent.)"""
    m = G["base"][2] if G["base"] else None
    if not m:
        return 0
    engine_white = G["me"] == chess.BLACK
    return abs(m) if (m > 0) == engine_white else 0


def decide(choice):
    """Réponse à la gaffe catastrophique : « continue » (le moteur joue) ou « takeback » (le coup est annulé, le joueur rejoue)."""
    with _lock:
        pend = G["pending"]
        if not pend:
            raise ChessError("Aucune décision en attente.")
        G["pending"] = None
        b = G["board"]
        lang = nasko_core.language()
        if choice == "takeback":
            b.pop()
            G["moves"].pop()
            G["base"], G["opening"] = pend["base"], pend["opening"]
            G["base_pv"] = list(pend.get("base_pv") or [])
            G["coach_ply"] = min(G["coach_ply"], len(G["moves"]))
            G["takebacks"] += 1
            say = _say({"key": "normal", "force": "takeback"}, lang)
            G["seq"] += 1
            G["extra"] = {"taunt": say, "undone": pend["san"]}
            st = state()
            _emit("undo", {"from": pend["uci"][2:4], "to": pend["uci"][:2], "view": view(), "say": say})
            return st
        ctx = pend["ctx"]
        ctx["force"] = "assume"
        return _finish_turn(G["moves"][-1], ctx, lang)


# ----------------------------------------------------------------------------- COACH ETO
PIECE_FR = {chess.PAWN: "le pion", chess.KNIGHT: "le cavalier", chess.BISHOP: "le fou", chess.ROOK: "la tour", chess.QUEEN: "la dame", chess.KING: "le roi"}


def _threats(board, color):
    """Pièces de `color` attaquées et mal protégées (non défendues, ou attaquées par une pièce de moindre valeur)."""
    out = []
    for sq, p in board.piece_map().items():
        if p.color != color or p.piece_type == chess.KING:
            continue
        att = board.attackers(not color, sq)
        if not att:
            continue
        cheapest = min(VAL[board.piece_type_at(a)] for a in att)
        if not board.attackers(color, sq) or cheapest < VAL[p.piece_type]:
            out.append(f"{PIECE_FR[p.piece_type]} en {chess.square_name(sq)}")
    return out[:4]


def _crec(r):
    if not r:
        return None
    return {"uci": r.get("uci", ""), "san": nasko_boss.san_local(r["san"], "fr"), "label": r["label"], "key": r["key"], "loss": r["loss"],
            "best": nasko_boss.san_local(r["best"], "fr") if r.get("best") else "", "pv_best": r.get("pv_best", []), "pv_after": r.get("pv_after", []),
            "mate_after": r.get("mate_after"), "check": r["anim"].get("check"), "capture": r["anim"].get("capture") is not None, "hints": r.get("hints", []),
            "brilliant": r["key"] == "brilliant", "sacrifice": r.get("sacrifice"), "before": r.get("before", 0), "after": r.get("after", 0), "best_uci": r.get("best_uci", ""), "pv_after_uci": r.get("pv_after_uci", []),
            "pv_best_uci": r.get("pv_best_uci", []), "why": r.get("why", [])}


def _situation(mine, theirs):
    """Alerte envoyée au LLM quand un coup brillant vient d'être joué (par ETO, par l'élève ou par l'adversaire) : il doit s'enflammer."""
    for who, r in (("mine", mine), ("theirs", theirs)):
        if r and r["key"] == "brilliant":
            return {"who": who, "san": r["san"], "sacrifice": r.get("sacrifice"), "why": r.get("why", [])[:2]}
    return None


def _coach_payload(mine, theirs):
    b = G["board"]
    sgn = 1 if G["me"] == chess.WHITE else -1
    op = nasko_boss.opening_of(b)
    mover = [r for r in G["moves"] if r["color"] == ("w" if G["me"] == chess.WHITE else "b")]
    n_bad = sum(1 for r in mover if r["key"] in ("mistake", "blunder"))
    n_best = sum(1 for r in mover if r["key"] in ("best", "brilliant", "excellent"))
    return {"situation": _situation(mine, theirs), "mode": G["mode"], "bot_elo": G["elo"], "opponent": (f"un bot virtuel de {G['elo']} Elo" if G["mode"] in ("coach", "speedrun") else "E.N.O.S., un adversaire agressif"),
            "me_name": "Blancs" if G["me"] == chess.WHITE else "Noirs", "fullmove": b.fullmove_number,
            "opening": op["fr"] if op else "", "eval": (G["base"][0] if G["base"] else 0) * sgn / 100.0,
            "mine": _crec(mine), "theirs": _crec(theirs), "my_hanging": _threats(b, G["me"]), "their_hanging": _threats(b, not G["me"]),
            "check": b.is_check() and b.turn == G["me"], "over": _result(), "fen": b.fen(),
            "stats": f"{n_best} bons coups sur {len(mover)}, {n_bad} erreur(s) ou gaffe(s) de l'élève." if mover else ""}


def _is_knight_arrow(uci):
    """Flèche de cavalier (dessinée en équerre) : géométrie en « L » ET un cavalier sur la case de départ ou d'arrivée de la position courante."""
    try:
        f, t = chess.parse_square(uci[:2]), chess.parse_square(uci[2:4])
    except ValueError:
        return False
    df, dr = abs(chess.square_file(f) - chess.square_file(t)), abs(chess.square_rank(f) - chess.square_rank(t))
    if (df, dr) not in ((1, 2), (2, 1)):
        return False
    b = G["board"]
    return bool(b) and any((pc := b.piece_at(sq)) is not None and pc.piece_type == chess.KNIGHT for sq in (f, t))


def _arrows(task, p):
    """Flèches à dessiner sur le plateau pendant qu'ETO parle : coup qu'il joue (ambre), meilleur coup (vert), menace / réponse attendue (rouge), coup qui punit (bleu).
    Chaque flèche porte la PHRASE parlée correspondante (« cavalier en d2 ») : l'interface la fait apparaître à l'instant où ETO la prononce (voir _anchor)."""
    out, seen = [], set()

    def add(uci, kind, san=None):
        if uci and len(uci) >= 4 and (uci[:4], kind) not in seen:
            seen.add((uci[:4], kind))
            out.append({"from": uci[:2], "to": uci[2:4], "kind": kind, "knight": _is_knight_arrow(uci), "phrase": nasko_coach.say(san) if san else ""})
    mine, theirs = p.get("mine"), p.get("theirs")
    bad = ("inaccuracy", "mistake", "blunder")
    first = lambda r, k: ((r or {}).get(k) or [None])[0]
    second = lambda r, k: (((r or {}).get(k) or []) + [None, None])[1]
    for r in (mine, theirs):                                         # coup brillant : flèche DORÉE sur le coup + « !! » sur la case d'arrivée (dessinés par le plateau)
        if r and r.get("brilliant"):
            add(r["uci"], "brilliant", r["san"])
    if task == "sr_eto" and mine:
        add(mine["uci"], "played", mine["san"])                                     # « je joue cavalier en d2 » : flèche sur son propre coup
        add(first(mine, "pv_after_uci"), "threat", first(mine, "pv_after"))         # « il va répondre ça » : la réponse attendue
        add(second(mine, "pv_after_uci"), "punish", second(mine, "pv_after"))       # « et moi je réplique » : la suite qu'ETO prépare
    elif task == "sr_bot" and theirs:
        if theirs["key"] in bad:
            add(theirs["best_uci"], "best", theirs.get("best"))                     # ce que le bot aurait dû jouer
            add(first(theirs, "pv_after_uci"), "punish", first(theirs, "pv_after")) # le coup qui punit
    else:
        if mine and mine["key"] in bad:
            add(mine["best_uci"], "best", mine.get("best"))
            add(first(mine, "pv_after_uci"), "threat", first(mine, "pv_after"))
        if theirs and theirs["key"] in bad:
            add(first(theirs, "pv_after_uci"), "punish", first(theirs, "pv_after"))
    out.sort(key=lambda a: a["kind"] != "brilliant")                  # la flèche dorée en premier
    return out[:4]


def _anchor(arrows, shown):
    """Position (0..1) de chaque phrase dans le texte : au moment où l'audio atteint cette fraction, la flèche apparaît. Sans phrase retrouvée, `at` = None (l'interface répartit)."""
    low = shown.lower()
    n = max(1, len(shown))
    cursor = 0
    for a in arrows:
        ph = (a.get("phrase") or "").lower()
        idx = low.find(ph, cursor) if ph else -1
        if idx < 0 and ph:
            idx = low.find(ph)
        a["at"] = round(idx / n, 3) if idx >= 0 else None
        if idx >= 0:
            cursor = idx
    return arrows


PROMPT_VERSION = "4-court-synchro"
CACHEABLE = ("sr_eto", "sr_bot", "coach", "enos", "sr_start", "start")
TEXT_KEY = {}                      # texte affiché -> clé de cache (pour retrouver l'audio mémorisé quand l'interface demande la voix)


def cache_key(task, p):
    """Identifiant d'une situation : position exacte (FEN sans compteurs) + coup(s) joué(s) + Elo du bot (+ tâche, mode, langue). None = jamais mémorisé (questions, bilans)."""
    if task not in CACHEABLE:
        return None
    import hashlib
    mv = lambda r: (r or {}).get("uci", "")
    fen = " ".join(str(p.get("fen", "")).split()[:4])
    if task in ("sr_start", "start"):
        parts = [task, p.get("mode", ""), p.get("bot_elo", ""), p.get("me_name", "")]
    else:
        parts = [task, p.get("mode", ""), fen, mv(p.get("mine")), mv(p.get("theirs")), p.get("bot_elo", "")]
    parts.append(nasko_core.language())
    parts.append(PROMPT_VERSION)                                      # un nouveau prompt invalide l'ancien cache (sinon ETO relirait d'anciens commentaires)
    return hashlib.sha1("|".join(str(x) for x in parts).encode()).hexdigest()[:24]


def key_of(text):
    return TEXT_KEY.get(text)


def _coach_say(task, payload):
    cfg = nasko_core.load_config()
    key = cache_key(task, payload)
    hit = nasko_cache.get(key)
    if hit:                                                          # situation déjà commentée : ni LLM ni (voir audio) ElevenLabs
        spoken, shown, llm_ok, cached = hit["spoken"], hit["shown"], True, True
    else:
        spoken, shown, llm_ok = nasko_coach.write(cfg, task, payload, nasko_core.language(cfg))
        cached = False
        if llm_ok:                                                   # un texte de secours n'est jamais mémorisé
            nasko_cache.put(key, spoken, shown, nasko_persona.tags(spoken))
    with _lock:
        _remember(shown, spoken)
        if key:
            if len(TEXT_KEY) > 500:
                TEXT_KEY.clear()
            TEXT_KEY[shown] = key
    arrows = _anchor(_arrows(task, payload), shown) if task in ("sr_eto", "sr_bot", "coach", "enos") else []
    played = next((a for a in arrows if a["kind"] == "played"), None)
    move_at = (played["at"] if played and played["at"] is not None else 0.3) if task == "sr_eto" else 0.0        # le coup d'ETO se joue quand il l'annonce
    return {"text": shown, "tags": nasko_persona.tags(spoken), "task": task, "mode": G["mode"], "persona": "eto", "llm": llm_ok, "cached": cached, "cache_key": key,
            "arrows": arrows, "timed": True, "move_at": move_at}


def _hints(snap, move, after):
    """Intentions d'un coup (pour que le commentaire explique le PLAN, pas seulement le coup) : prise, développement, centre, roque, échec, menaces créées."""
    p = snap.piece_at(move.from_square)
    to = chess.square_name(move.to_square)
    out = []
    if snap.is_castling(move):
        out.append("roque : le roi se met à l'abri et la tour entre en jeu")
    elif snap.is_en_passant(move):
        out.append(f"prise en passant en {to}")
    elif snap.is_capture(move):
        out.append(f"prend {PIECE_FR[snap.piece_type_at(move.to_square)]} en {to}")
    else:
        out.append(f"{PIECE_FR[p.piece_type]} vers {to}")
    if p.piece_type in (chess.KNIGHT, chess.BISHOP) and chess.square_rank(move.from_square) in (0, 7):
        out.append("développe une pièce mineure")
    if p.piece_type == chess.PAWN and to[0] in "de" and to[1] in "45":
        out.append("occupe le centre")
    if move.promotion:
        out.append("promotion")
    if after.is_checkmate():
        out.append("échec et mat")
    elif after.is_check():
        out.append("donne échec")
    thr = _threats(after, not p.color)
    if thr:
        out.append("menace " + ", ".join(thr[:2]))
    return out


_DEFERRED = []                     # (type, charge) d'événements Godot mis en attente : l'animation se joue au moment où ETO annonce son coup


def release_deferred():
    """Émet vers Godot les animations retenues par speedrun_step(defer=True). Appelé quand ETO prononce le coup (ou à la fin de sa phrase)."""
    with _lock:
        pend = list(_DEFERRED)
        _DEFERRED.clear()
        for kind, payload in pend:
            _emit(kind, payload)
    return bool(pend)


def speedrun_step(tts=None, defer=False):
    """SPEEDRUN : joue UN demi-coup (ETO au trait : son meilleur coup ; sinon le bot à l'Elo choisi), génère le commentaire d'ETO, synthétise sa voix
    (`tts(texte_balisé) -> url|None`), PUIS anime le plateau : les pièces bougent au moment où ETO se met à parler."""
    release_deferred()
    with _lock:
        b = G["board"]
        if b is None or G["mode"] != "speedrun":
            raise ChessError("Aucun speedrun en cours.")
        if b.is_game_over() or G["resigned"]:
            return {"state": state(), "coach": None, "done": True, "eto": False}
        eto_turn = b.turn == G["me"]
        brill = None
        if eto_turn:
            mv, brill = _eto_choose(b)                               # MultiPV + filtre de sacrifice : un coup brillant passe avant la « ligne 1 »
        else:
            mv, brill = _bot_move(b)
        snap = b.copy(stack=False)
        rec = _play(mv)
        rec["hints"] = _hints(snap, mv, b)
        if brill:
            _mark_brilliant(rec, brill, snap)
        over = _result()
        if over:
            _save_game("end")
        if eto_turn:
            mine, theirs = rec, G.get("sr_last_bot")
            G["sr_last_eto"] = rec
        else:
            mine, theirs = None, rec                                  # commentaire du coup du bot : on ne mélange pas avec le coup précédent d'ETO
            G["sr_last_bot"] = rec
        payload = _coach_payload(mine, theirs)
        bad = rec["key"] in ("inaccuracy", "mistake", "blunder", "brilliant")
        notable = eto_turn or bad or rec["anim"].get("check") or rec["anim"].get("capture") is not None or len(G["moves"]) <= 6 or bool(over)
        steps = [rec["anim"]]
    coach = None
    if notable:                                                      # coups anodins du bot : pas de commentaire (rythme de stream), ETO les évoquera au coup suivant
        coach = _coach_say("sr_eto" if eto_turn else "sr_bot", payload)
        if tts and coach:
            coach["audio"] = tts(spoken_for(coach["text"]), coach.get("cache_key"))
    with _lock:
        G["seq"] += 1
        G["extra"] = {("played" if eto_turn else "reply"): rec}
        st = state()
        send = _DEFERRED.append if defer else (lambda ev: _emit(*ev))
        send(("update", {"steps": steps, "view": view(), "say": None}))
        if rec.get("brilliant"):
            send(("brilliant", {"from": rec["anim"]["from"], "to": rec["anim"]["to"]}))
    return {"state": st, "coach": coach, "eto": eto_turn, "done": bool(over)}


# ----------------------------------------------------------------------------- LE BOSS FINAL : E.N.O.S. et/ou ETO contre STOCKFISH (muet : il annonce son prochain coup)
BOSS_TIME = 2.0                     # secondes de réflexion de Stockfish par coup (pleine puissance, sans limite d'Elo) : plus que les challengers
BOSS_CHALLENGER_POWER = 92          # jauge d'E.N.O.S. face au boss : ~2950 Elo (ETO joue, lui, sa MultiPV à pleine puissance)
BOSS_ANNOUNCE_S = 1.7               # durée pendant laquelle le boss « dit » son coup (logo + flèche) avant de le jouer


def _boss_tune():
    """Moteur du boss : plus de threads et de mémoire de hachage que pour une partie normale (sans effet si l'option n'existe pas)."""
    try:
        eng = _engine()
        opts = {}
        if "Threads" in eng.options:
            opts["Threads"] = max(1, min(4, (os.cpu_count() or 2) // 2))
        if "Hash" in eng.options:
            opts["Hash"] = 256
        if opts:
            eng.configure(opts)
    except Exception:                                                # noqa: BLE001 — réglage facultatif
        pass


def _boss_choose(board):
    return _engine().play(board, chess.engine.Limit(time=BOSS_TIME)).move


def _boss_mover(board):
    """Qui joue le prochain coup des challengers : E.N.O.S., ETO, ou en alternance (duo : E.N.O.S. ouvre, un coup chacun)."""
    ch = G.get("challenger", "eto")
    if ch != "duo":
        return ch
    mine = "w" if G["me"] == chess.WHITE else "b"
    n = sum(1 for r in G["moves"] if r["color"] == mine)
    return nasko_titans.ENOS if n % 2 == 0 else nasko_titans.ETO


def _boss_ctx(speaker, kind, why, rec=None, mover=None, over=""):
    """Contexte d'une réplique d'un challenger face au boss (sous verrou)."""
    b = G["board"]
    ch_white = G["me"] == chess.WHITE
    sgn = 1 if ch_white else -1
    op = nasko_boss.opening_of(b)
    last = G["ti_log"][-1] if G["ti_log"] else None
    winner = None
    if over:
        if b.is_checkmate():
            winner = speaker if (ch_white != (b.turn == chess.WHITE)) else "boss"
        elif G.get("resigned"):
            winner = "boss"
    moved_name = None
    if mover == nasko_titans.BOSS:
        moved_name = nasko_titans.BOSS_NAME
    elif mover and mover != speaker:
        moved_name = nasko_titans.NAME[mover]
    ctx = {"speaker": speaker, "kind": kind, "why": why, "moved": mover, "moved_name": moved_name, "rec": _crec(rec) if rec else None, "fullmove": b.fullmove_number,
           "opening": op["fr"] if op else "", "eval": (G["base"][0] if G["base"] else 0) * sgn / 100.0, "over": over, "winner": winner,
           "my_color": "Blancs" if ch_white else "Noirs", "foe_color": "Noirs" if ch_white else "Blancs",
           "last_line": last if last and last["who"] != speaker else None,
           "boss": "duo" if G.get("challenger") == "duo" else "solo", "foe_name": nasko_titans.BOSS_NAME}
    if rec and rec["key"] in ("blunder", "mistake", "inaccuracy"):
        ctx["swing_note"] = f"L'évaluation vient de changer de {abs(rec['after'] - rec['before']) / 100:.1f} pion(s) à cause de ce coup."
    thr = _threats(b, ch_white) + ["(adverse) " + t for t in _threats(b, not ch_white)]
    ctx["threats"] = thr[:4]
    return ctx


def _boss_speakers():
    ch = G.get("challenger", "eto")
    return [nasko_titans.ENOS, nasko_titans.ETO] if ch == "duo" else [ch]


def _boss_lines(plan, rec, mover, over, tts):
    out = []
    for speaker, why in plan:
        with _lock:
            ctx = _boss_ctx(speaker, "move", why, rec, mover, over)
        gold = [{"from": rec["uci"][:2], "to": rec["uci"][2:4], "kind": "brilliant"}] if rec.get("brilliant") and speaker == mover else None
        out.append(_titans_line(speaker, ctx, tts, gold))
    return out


def boss_event(kind, tts=None):
    """« start » : le(s) challenger(s) défient le boss · « end » : bilan après la partie (le boss, lui, ne dit rien)."""
    with _lock:
        b = G["board"]
        if b is None or G["mode"] != "boss":
            raise ChessError("Aucun combat contre le boss en cours.")
        over = _result()
    out = []
    if kind == "end":
        for speaker in _boss_speakers():
            with _lock:
                ctx = _boss_ctx(speaker, "end", "", over=over)
            out.append(_titans_line(speaker, ctx, tts))
    else:
        sp = _boss_speakers()
        for i, speaker in enumerate(sp):
            with _lock:
                ctx = _boss_ctx(speaker, "start" if i == 0 else "start_reply", "")
            out.append(_titans_line(speaker, ctx, tts))
    return {"lines": out}


def boss_step(tts=None):
    """Un demi-coup du combat. Tour du BOSS : il calcule, ANNONCE son coup (logo + flèche sur le plateau Godot, ~1,7 s), puis le joue ; il ne dit rien d'autre.
    Tour des challengers : E.N.O.S. (puissance ~2950 Elo) et/ou ETO (MultiPV, chasse au coup brillant) ; ils commentent les moments marquants."""
    with _lock:
        b = G["board"]
        if b is None or G["mode"] != "boss":
            raise ChessError("Aucun combat contre le boss en cours.")
        if b.is_game_over() or G["resigned"]:
            return {"state": state(), "lines": [], "done": True, "boss_turn": False, "announce": None}
        boss_turn = b.turn != G["me"]
        brill = None
        if boss_turn:
            mv, mover = _boss_choose(b), nasko_titans.BOSS
        else:
            mover = _boss_mover(b)
            if mover == nasko_titans.ETO:
                mv, brill = _eto_choose(b)
            else:
                mv = _choose(b)
        fen0 = b.fen()
        san = b.san(mv)
    ann = None
    if boss_turn:
        ann = {"san": san, "text": nasko_boss.san_local(san, nasko_core.language()), "from": mv.uci()[:2], "to": mv.uci()[2:4], "uci": mv.uci()}
        _emit("boss", ann)                                           # le plateau affiche le logo de Stockfish, son coup et sa flèche
        time.sleep(BOSS_ANNOUNCE_S)
    with _lock:
        b = G["board"]
        if b is None or G["mode"] != "boss" or b.fen() != fen0:
            raise ChessError("La partie a changé pendant l'annonce du coup.")
        snap = b.copy(stack=False)
        rec = _play(mv)
        rec["hints"] = _hints(snap, mv, b)
        if brill:
            _mark_brilliant(rec, brill, snap)
        over = _result()
        if over:
            _save_game("end")
        swing = rec["after"] - rec["before"]                           # point de vue de celui qui vient de jouer
        mate = rec.get("mate_after") or 0
        good = bool(rec.get("brilliant")) or swing >= 150 or mate > 0
        bad = rec["key"] in ("mistake", "blunder") or swing <= -150 or mate < 0
        since = len(G["moves"]) - G.get("ti_ply", 0)
        notable = good or bad or rec["anim"].get("check") or rec["anim"].get("capture") is not None or rec["anim"].get("promo") is not None or len(G["moves"]) <= 4 or since >= 4
        sp = _boss_speakers()
        last = G.get("ti_last")
        nxt = next((x for x in sp if x != last), sp[0])                # duo : celui qui n'a pas parlé en dernier
        if over:
            plan = []                                                  # fin de partie : boss_event("end")
        elif mover == nasko_titans.BOSS:
            plan = [(nxt, "mock" if bad else "react")] if (notable and (bad or good or since >= 2)) else []
        elif good:
            plan = [(mover, "brag")]
        elif bad:
            plan = [(mover, "retort")]
        elif notable and since >= 4:
            plan = [(mover, "own")]
        else:
            plan = []
        steps = [rec["anim"]]
    lines = _boss_lines(plan, rec, mover, over, tts) if plan else []
    with _lock:
        G["seq"] += 1
        G["extra"] = {("reply" if boss_turn else "played"): rec}
        st = state()
        _emit("update", {"steps": steps, "view": view(), "say": None})
        if boss_turn:
            _emit("boss_end", None)
        if rec.get("brilliant"):
            _emit("brilliant", {"from": rec["anim"]["from"], "to": rec["anim"]["to"]})
    return {"state": st, "lines": lines, "boss_turn": boss_turn, "announce": ann, "done": bool(over)}


# ----------------------------------------------------------------------------- LE CHOC DES TITANS : E.N.O.S. (3200) contre ETO (3200), spectateur
def _titans_ctx(speaker, kind, why, rec=None, mover=None, over=""):
    """Contexte d'une réplique (sous verrou) : faits Stockfish du point de vue de `speaker` + dernière réplique de l'adversaire (pour qu'il y réponde)."""
    b = G["board"]
    eto_white = G["me"] == chess.WHITE
    me_white = eto_white if speaker == nasko_titans.ETO else not eto_white
    sgn = 1 if me_white else -1
    op = nasko_boss.opening_of(b)
    last = G["ti_log"][-1] if G["ti_log"] else None
    winner = None
    if over:
        if b.is_checkmate():
            loser_white = b.turn == chess.WHITE
            winner = nasko_titans.ETO if (eto_white != loser_white) else nasko_titans.ENOS
        elif G.get("resigned"):
            winner = nasko_titans.ENOS
    ctx = {"speaker": speaker, "kind": kind, "why": why, "moved": mover, "rec": _crec(rec) if rec else None, "fullmove": b.fullmove_number,
           "opening": op["fr"] if op else "", "eval": (G["base"][0] if G["base"] else 0) * sgn / 100.0, "over": over, "winner": winner,
           "my_color": "Blancs" if me_white else "Noirs", "foe_color": "Noirs" if me_white else "Blancs",
           "last_line": last if last and last["who"] != speaker else None}
    if rec and rec["key"] in ("blunder", "mistake", "inaccuracy"):
        ctx["swing_note"] = f"L'évaluation vient de changer de {abs(rec['after'] - rec['before']) / 100:.1f} pion(s) à cause de ce coup."
    thr = _threats(b, me_white) + ["(adverse) " + t for t in _threats(b, not me_white)]
    ctx["threats"] = thr[:4]
    return ctx


def _titans_line(speaker, ctx, tts, arrows=None):
    cfg = nasko_core.load_config()
    spoken, shown, llm_ok = nasko_titans.write(cfg, ctx, nasko_core.language(cfg))
    with _lock:
        G["ti_log"].append({"who": speaker, "text": shown})
        del G["ti_log"][:-8]
        G["ti_last"] = speaker
        G["ti_ply"] = len(G["moves"])
        _remember(shown, spoken)
    line = {"persona": speaker, "name": nasko_titans.NAME[speaker], "text": shown, "tags": nasko_persona.tags(spoken), "llm": llm_ok, "arrows": arrows or [], "audio": None}
    if tts:
        line["audio"] = tts(spoken_for(shown), speaker)
    return line


def _titans_lines(plan, rec, mover, over, tts):
    """Joue une suite de répliques [(locuteur, raison)] : chacune voit la précédente et peut y répondre."""
    out = []
    for speaker, why in plan:
        with _lock:
            ctx = _titans_ctx(speaker, "move", why, rec, mover, over)
        gold = [{"from": rec["uci"][:2], "to": rec["uci"][2:4], "kind": "brilliant"}] if rec.get("brilliant") and speaker == mover else None
        out.append(_titans_line(speaker, ctx, tts, gold))
    return out


def titans_event(kind, tts=None):
    """« start » : E.N.O.S. ouvre, ETO réplique · « end » : le vainqueur écrase, le perdant réagit."""
    with _lock:
        b = G["board"]
        if b is None or G["mode"] != "titans":
            raise ChessError("Aucun match Titans en cours.")
        over = _result()
    out = []
    if kind == "end":
        with _lock:
            winner = _titans_ctx(nasko_titans.ENOS, "end", "", over=over)["winner"]
        first = winner or nasko_titans.ENOS
        for speaker in (first, nasko_titans.other(first)):
            with _lock:
                ctx = _titans_ctx(speaker, "end", "", over=over)
            out.append(_titans_line(speaker, ctx, tts))
    else:
        for speaker, k in ((nasko_titans.ENOS, "start"), (nasko_titans.ETO, "start_reply")):
            with _lock:
                ctx = _titans_ctx(speaker, k, "")
            out.append(_titans_line(speaker, ctx, tts))
    return {"lines": out}


def titans_step(tts=None):
    """Joue UN demi-coup (ETO : MultiPV + filtre de sacrifice ; E.N.O.S. : pleine puissance), puis orchestre la guerre des commentaires.
    Alternance : à tour de rôle ; mais une variation drastique de l'évaluation déclenche un échange à deux (le bénéficiaire jubile, l'autre réplique ; une erreur est moquée par l'adversaire,
    puis le fautif réplique). `tts(texte, persona) -> url|None` synthétise avec la voix du locuteur AVANT l'animation du plateau."""
    with _lock:
        b = G["board"]
        if b is None or G["mode"] != "titans":
            raise ChessError("Aucun match Titans en cours.")
        if b.is_game_over() or G["resigned"]:
            return {"state": state(), "lines": [], "done": True, "eto": False}
        eto_turn = b.turn == G["me"]
        brill = None
        if eto_turn:
            mv, brill = _eto_choose(b)
        else:
            mv = _choose(b)                                                    # G["power"] = 100 : Stockfish à pleine puissance
        snap = b.copy(stack=False)
        rec = _play(mv)
        rec["hints"] = _hints(snap, mv, b)
        if brill:
            _mark_brilliant(rec, brill, snap)
        over = _result()
        if over:
            _save_game("end")
        mover = nasko_titans.ETO if eto_turn else nasko_titans.ENOS
        foe = nasko_titans.other(mover)
        swing = rec["after"] - rec["before"]                                   # point de vue de celui qui vient de jouer
        mate = rec.get("mate_after") or 0
        good = bool(rec.get("brilliant")) or swing >= 150 or mate > 0
        bad = rec["key"] in ("mistake", "blunder") or swing <= -150 or mate < 0
        since = len(G["moves"]) - G.get("ti_ply", 0)
        notable = good or bad or rec["key"] == "inaccuracy" or rec["anim"].get("check") or rec["anim"].get("capture") is not None or rec["anim"].get("promo") is not None \
            or len(G["moves"]) <= 6 or since >= 2
        last = G.get("ti_last")
        if over:
            plan = []                                                          # la fin de partie est traitée par titans_event("end")
        elif good:
            plan = [(mover, "brag"), (foe, "retort")]                          # le bénéficiaire jubile, l'autre réplique
        elif bad:
            plan = [(foe, "mock"), (mover, "retort")]                          # l'adversaire se moque de l'erreur, le fautif réplique
        elif notable:
            speaker = foe if last == mover else mover if last == foe else foe  # à tour de rôle (celui qui n'a pas parlé en dernier)
            plan = [(speaker, "own" if speaker == mover else "react")]
        else:
            plan = []
        steps = [rec["anim"]]
    lines = _titans_lines(plan, rec, mover, over, tts) if plan else []
    with _lock:
        G["seq"] += 1
        G["extra"] = {("played" if eto_turn else "reply"): rec}
        st = state()
        _emit("update", {"steps": steps, "view": view(), "say": None})
        if rec.get("brilliant"):
            _emit("brilliant", {"from": rec["anim"]["from"], "to": rec["anim"]["to"]})
    return {"state": st, "lines": lines, "eto": eto_turn, "done": bool(over)}


def coach_turn():
    """Commentaire d'ETO sur les coups joués depuis le dernier appel. Cours : à chaque tour. Défi E.N.O.S. : seulement quand ça en vaut la peine
    (erreur de l'élève, menace, échec, capture), espacé de quelques coups."""
    with _lock:
        if G["board"] is None or G["pending"]:
            return None
        n = len(G["moves"])
        if n <= G["coach_ply"]:
            return None
        recs = G["moves"][G["coach_ply"]:]
        G["coach_ply"] = n
        me = "w" if G["me"] == chess.WHITE else "b"
        mine = next((r for r in reversed(recs) if r["color"] == me), None)
        theirs = next((r for r in reversed(recs) if r["color"] != me), None)
        payload = _coach_payload(mine, theirs)
        if G["mode"] != "coach":
            bad = bool(mine) and mine["key"] in ("inaccuracy", "mistake", "blunder")
            sharp = bool(theirs) and (theirs.get("brilliant") or theirs["anim"].get("check") or theirs["anim"].get("capture") is not None) or bool(payload["my_hanging"])
            if not (bad or (sharp and n - G["coach_last"] >= 4)):
                return None
        G["coach_last"] = n
        task = "coach" if G["mode"] == "coach" else "enos"
    return _coach_say(task, payload)


def coach_event(kind):
    """« start » : accueil de l'élève · « end » : bilan de fin de partie."""
    with _lock:
        if G["board"] is None:
            raise ChessError("Aucune partie en cours.")
        payload = _coach_payload(None, None)
    return _coach_say(("sr_" if G["mode"] == "speedrun" else "") + ("end" if kind == "end" else "start"), payload)


def coach_ask(text):
    text = (text or "").strip()[:400]
    if not text:
        raise ChessError("Rien entendu.")
    with _lock:
        if G["board"] is None:
            raise ChessError("Aucune partie en cours.")
        last = G["moves"][-2:] if G["moves"] else []
        me = "w" if G["me"] == chess.WHITE else "b"
        payload = _coach_payload(next((r for r in reversed(last) if r["color"] == me), None), next((r for r in reversed(last) if r["color"] != me), None))
        payload["question"] = text
    return _coach_say("ask", payload)


# ----------------------------------------------------------------------------- TRASH TALK : le joueur parle à E.N.O.S. pendant la partie
def _board_context(lang):
    """Contexte envoyé au LLM pendant la discussion : trait, évaluation, matériel, derniers coups et FEN (l'IA « voit » le plateau)."""
    b = G["board"]
    if b is None:
        return ""
    ev = (G["base"][0] if G["base"] else 0) / 100.0
    mat = {c: sum(VAL[p.piece_type] for p in b.piece_map().values() if p.color == c and p.piece_type != chess.KING) for c in (chess.WHITE, chess.BLACK)}
    last = " ".join(m["san"] for m in G["moves"][-8:])
    mine = "Blancs" if G["me"] == chess.WHITE else "Noirs"
    pend = " Le joueur vient de faire une gaffe et hésite à l'annuler." if G.get("pending") else ""
    if lang == "en":
        mine = "White" if G["me"] == chess.WHITE else "Black"
        return (f"Game state: the user plays {mine}; {'White' if b.turn else 'Black'} to move; evaluation {ev:+.1f} (positive = White better); material White {mat[chess.WHITE]} "
                f"vs Black {mat[chess.BLACK]}; {len(G['moves'])} half-moves played; last moves: {last or 'none'}; FEN: {b.fen()}.{' The user just blundered and may take it back.' if G.get('pending') else ''} ")
    return (f"État de la partie : le joueur a les {mine} ; trait aux {'Blancs' if b.turn else 'Noirs'} ; évaluation {ev:+.1f} (positif = Blancs mieux) ; matériel Blancs {mat[chess.WHITE]} "
            f"contre Noirs {mat[chess.BLACK]} ; {len(G['moves'])} demi-coups joués ; derniers coups : {last or 'aucun'} ; FEN : {b.fen()}.{pend} ")


def trash(text, guest=False):
    """Le joueur parle à l'IA pendant la partie. E.N.O.S. : sarcasme / rage bait (après 3 interventions sans coup : « tais-toi et joue »).
    ETO : poli, joueur, confiant, avec des Audio Tags. L'IA reçoit le contexte du plateau ; elle ne révèle jamais de coup."""
    text = (text or "").strip()[:500]
    if not text:
        raise ChessError("Rien entendu.")
    if G["mode"] != "enos":
        return {**coach_ask(text), "kind": "normal", "focus": False}
    persona = nasko_persona.current()
    guest = bool(guest) or nasko_persona.guest_on()                  # écoute Discord : c'est la voix de l'invité distant, pas celle de l'utilisateur
    with _lock:
        G["trash_n"] += 1
        focus = G["trash_n"] >= 3 and not guest                       # un invité qui joue a le droit de parler : jamais de « tais-toi et joue »
        lang = nasko_core.language()
        ctx = _board_context(lang)
    try:
        import nasko_llm
        who_says = ("The guest says" if lang == "en" else "L'invité dit") if guest else ("The player says" if lang == "en" else "Le joueur dit")
        reply = nasko_llm.complete(nasko_core.load_config(), nasko_boss.trash_system(lang, focus, persona, guest),
                                   f"{ctx}{who_says} : « {text} »", 160)
    except Exception:                                               # noqa: BLE001 — repli : banque de répliques
        reply = nasko_boss.trash_fallback(lang, focus, persona)
    if persona == "eto":
        speak = nasko_persona.ensure_tags(reply, lang)
        reply = nasko_persona.clean(speak)
    else:
        speak = None
        reply = nasko_persona.clean(reply)                          # E.N.O.S. : jamais de balise audio (multilingual_v2 la lirait)
    with _lock:
        _remember(reply, speak)
        G["last_taunt"] = reply
    return {"text": reply, "kind": "blunder" if focus and persona != "eto" else "normal", "focus": focus, "persona": persona, "guest": guest,
            "tags": nasko_persona.tags(speak) if speak else []}

def recent_lines(n=40):
    """Dernières répliques de l'IA (filtre d'écho de l'écoute Discord : sa propre voix ne doit pas être prise pour celle de l'invité)."""
    with _lock:
        return [t for t in list(G["issued"])[-n:] if isinstance(t, str)] + ([G["last_taunt"]] if G.get("last_taunt") else [])


# ----------------------------------------------------------------------------- MISE EN CONDITION : position libre, E.N.O.S./ETO « en sommeil »
# Le joueur compose une position (pièces, trait, roques), l'analyse avec ETO (questions libres), puis réveille E.N.O.S. ou ETO pour la jouer
# contre lui, dans la couleur de son choix. Rien ici n'écrit dans la partie en cours : seule new_game(fen=…) démarre une partie.
_SETUP_TOLERATED = (chess.STATUS_TOO_MANY_WHITE_PAWNS | chess.STATUS_TOO_MANY_BLACK_PAWNS
                    | chess.STATUS_TOO_MANY_WHITE_PIECES | chess.STATUS_TOO_MANY_BLACK_PIECES)       # position d'entraînement : trois dames, neuf pions… permis
_SETUP_ERRORS = ((chess.STATUS_EMPTY, "Le plateau est vide."), (chess.STATUS_NO_WHITE_KING, "Il manque le roi blanc."),
                 (chess.STATUS_NO_BLACK_KING, "Il manque le roi noir."), (chess.STATUS_TOO_MANY_KINGS, "Un seul roi par camp."),
                 (chess.STATUS_PAWNS_ON_BACKRANK, "Un pion ne peut pas être sur la 1re ou la 8e rangée."),
                 (chess.STATUS_OPPOSITE_CHECK, "Le camp qui n'a pas le trait est en échec : position impossible (changez le trait)."),
                 (chess.STATUS_TOO_MANY_CHECKERS, "Le roi est attaqué par trop de pièces à la fois : position impossible."),
                 (chess.STATUS_IMPOSSIBLE_CHECK, "L'échec donné au roi est impossible dans cette position."))
_CASTLE_BITS = (("K", chess.BB_H1), ("Q", chess.BB_A1), ("k", chess.BB_H8), ("q", chess.BB_A8))


def setup_board(pos):
    """{"board": {"e4": "P", …}, "turn": "w"|"b", "castling": "KQkq"} (ou {"fen": "…"}) -> chess.Board jouable. Lève ChessError (message lisible)."""
    pos = pos if isinstance(pos, dict) else {}
    try:
        if pos.get("fen"):
            b = chess.Board(str(pos["fen"])[:120])
        else:
            b = chess.Board(None)
            for sq, sym in list((pos.get("board") or {}).items())[:64]:
                b.set_piece_at(chess.parse_square(str(sq)), chess.Piece.from_symbol(str(sym)))
            b.turn = chess.BLACK if pos.get("turn") == "b" else chess.WHITE
            want = str(pos.get("castling") or "")
            b.castling_rights = sum(bit for c, bit in _CASTLE_BITS if c in want)
            b.castling_rights = b.clean_castling_rights()                 # un roque n'existe que si le roi et la tour sont à leur place
    except (ValueError, TypeError, AttributeError):
        raise ChessError("Position illisible.")
    st = b.status() & ~_SETUP_TOLERATED
    msgs = [m for flag, m in _SETUP_ERRORS if st & flag]
    if msgs:
        raise ChessError(" ".join(msgs))
    if st & ~(chess.STATUS_BAD_CASTLING_RIGHTS | chess.STATUS_INVALID_EP_SQUARE):
        raise ChessError("Position impossible.")
    return b


def _setup_view(b, last=""):
    op = nasko_boss.opening_of(b)
    return {"ok": True, "fen": b.fen(), "board": {chess.square_name(s): p.symbol() for s, p in b.piece_map().items()}, "turn": "w" if b.turn == chess.WHITE else "b",
            "castling": "".join(c for c, bit in _CASTLE_BITS if b.castling_rights & bit), "opening": op["fr"] if op else "", "check": b.is_check(),
            "over": "mat" if b.is_checkmate() else ("nulle" if b.is_game_over() else ""), "last": last}


def setup_check(pos):
    """Valide la position en cours d'édition (sans erreur HTTP : l'éditeur affiche le message)."""
    try:
        return _setup_view(setup_board(pos))
    except ChessError as e:
        return {"ok": False, "error": str(e)}


_MOVE_NUM = re.compile(r"^\d+\.+$")
_FR_PIECES = str.maketrans("RDTFC", "KQRBN")


def setup_play(pos, text):
    """Joue sur la position posée une suite de coups (« e4 e6 d4 d5 », « 1.e4 e6 2.d4 d5 », notation française ou UCI tolérées)."""
    b = setup_board(pos)
    toks = [t for t in re.split(r"[\s,;]+", str(text or "")[:600]) if t and not _MOVE_NUM.match(t) and t not in ("1-0", "0-1", "1/2-1/2", "*")]
    toks = [re.sub(r"^\d+\.+", "", t) for t in toks][:80]
    last = ""
    for tok in toks:
        mv = None
        for cand in (tok, tok.translate(_FR_PIECES) if tok[:1] in "RDTFC" else None):
            if not cand:
                continue
            try:
                mv = b.parse_san(cand)
                break
            except ValueError:
                try:
                    m2 = chess.Move.from_uci(cand)
                    if m2 in b.legal_moves:
                        mv = m2
                        break
                except ValueError:
                    pass
        if mv is None:
            raise ChessError(f"Coup illégal ou illisible dans cette position : « {tok} ».")
        b.push(mv)
        last = mv.uci()
    v = _setup_view(chess.Board(b.fen()), last)               # nouvelle racine : la position posée repart sans historique
    return v


def setup_ask(pos, question):
    """Question libre à ETO sur la position posée (« si mon adversaire fait ça, que dois-je faire ? »). Stockfish (3 lignes) fournit les faits, ETO les met en mots."""
    q = (question or "").strip()[:500]
    if not q:
        raise ChessError("Posez votre question à ETO.")
    b = setup_board(pos)
    me = chess.BLACK if (pos or {}).get("side") == "b" else chess.WHITE
    lines = []
    if not b.is_game_over():
        with _lock:
            infos = _engine().analyse(b, chess.engine.Limit(time=1.2), multipv=3)
        for info in infos:
            pv = info.get("pv") or []
            if pv:
                sc = info["score"].pov(me)
                lines.append({"cp": sc.score(mate_score=MAT), "mate": sc.mate(), "line": _san_line(b, pv, 6), "uci": [m.uci() for m in pv[:2]]})
    op = nasko_boss.opening_of(b)
    payload = {"setup": True, "mode": "coach", "bot_elo": 3200, "opponent": "l'adversaire de la position posée", "me_name": "Blancs" if me == chess.WHITE else "Noirs",
               "turn_name": "Blancs" if b.turn == chess.WHITE else "Noirs", "fullmove": b.fullmove_number, "opening": op["fr"] if op else "",
               "eval": (lines[0]["cp"] / 100.0) if lines and not lines[0]["mate"] else 0.0, "fen": b.fen(), "mine": None, "theirs": None,
               "my_hanging": _threats(b, me), "their_hanging": _threats(b, not me), "check": b.is_check() and b.turn == me, "over": _result_of(b),
               "stats": "", "lines": lines, "question": q, "situation": None}
    spoken, shown, ok = nasko_coach.write(nasko_core.load_config(), "setup", payload, nasko_core.language())
    with _lock:
        _remember(shown, spoken)
    first = lines[0]["uci"][0] if lines else ""
    return {"text": shown, "tags": nasko_persona.tags(spoken), "llm": ok, "persona": "eto", "opening": payload["opening"],
            "arrows": [{"from": first[:2], "to": first[2:4], "kind": "best"}] if len(first) >= 4 else [],
            "lines": [{"line": l["line"], "cp": l["cp"], "mate": l["mate"]} for l in lines]}


def _result_of(b):
    if b.is_checkmate():
        return "Échec et mat"
    return "Nulle" if b.is_game_over() else ""


# ----------------------------------------------------------------------------- thèmes de pièces
def _themes_dir():
    return os.path.join(nasko_core.app_dir(), "godot_chess", "assets", "themes")


_PIECE_FILES = tuple(c + t + ".png" for c in "wb" for t in "kqrbnp")


def themes():
    """Tous les dossiers de assets/themes/ qui contiennent les 12 pièces (wk.png … bp.png). `theme.json` est optionnel : sans lui, le nom du dossier sert d'intitulé
    et les hauteurs du thème classique s'appliquent. Il suffit donc de déposer un dossier de 12 images pour qu'il apparaisse dans le sélecteur."""
    out = []
    try:
        for n in sorted(os.listdir(_themes_dir())):
            d = os.path.join(_themes_dir(), n)
            if not os.path.isdir(d) or not all(os.path.isfile(os.path.join(d, f)) for f in _PIECE_FILES):
                continue
            label = n.replace("_", " ").title()
            try:
                with open(os.path.join(d, "theme.json"), encoding="utf-8") as f:
                    label = json.load(f).get("label", label)
            except (OSError, ValueError):
                pass
            out.append({"id": n, "label": label})
    except OSError:
        pass
    return out


# ----------------------------------------------------------------------------- plateaux à couleurs unies (assets/boards, générés par godot_chess/preparer_boards.py)
def _boards_dir():
    return os.path.join(nasko_core.app_dir(), "godot_chess", "assets", "boards")


def boards():
    """Plateaux disponibles : [{id, label, light, dark}] lus dans boards.json (seuls ceux dont l'image existe)."""
    try:
        with open(os.path.join(_boards_dir(), "boards.json"), encoding="utf-8") as f:
            lst = json.load(f)
    except (OSError, ValueError):
        return []
    return [b for b in lst if isinstance(b, dict) and os.path.isfile(os.path.join(_boards_dir(), str(b.get("id", "")) + ".png"))]


def get_board():
    """Plateau choisi (chaîne vide = plateau du thème de pièces)."""
    b = str(nasko_core.load_config().get("chess_board") or "")
    return b if any(x["id"] == b for x in boards()) else ""


def set_board(name):
    if name and not any(x["id"] == name for x in boards()):
        raise ChessError("Plateau inconnu.")
    nasko_core.update_config({"chess_board": name or ""})
    _emit("board", name or "")
    return {"board": name or ""}


def get_theme():
    t = str(nasko_core.load_config().get("chess_theme") or "classic")
    return t if any(x["id"] == t for x in themes()) else "classic"


def set_theme(name):
    if not any(x["id"] == name for x in themes()):
        raise ChessError("Thème inconnu.")
    nasko_core.update_config({"chess_theme": name})
    _emit("theme", name)
    return {"theme": name}


def resign():
    """Le joueur abandonne : moquerie prédéfinie (voix ElevenLabs côté interface), partie archivée comme défaite."""
    with _lock:
        b = G["board"]
        if b is None or b.is_game_over() or G["resigned"]:
            raise ChessError("Aucune partie en cours.")
        G["resigned"] = True
        say = _say({"key": "normal", "end": "resign"}, nasko_core.language())
        _save_game("resign")
        G["seq"] += 1
        G["extra"] = {"taunt": say}
        st = state()
        _emit("update", {"steps": [], "view": view(), "say": say})
        return st


def current():
    with _lock:
        return state()


# ----------------------------------------------------------------------------- voix : seules les répliques émises par le serveur sont synthétisées
def taunt_allowed(text):
    """Texte libre refusé : seule une réplique produite par ce serveur pendant la partie (banque + variables calculées) peut être prononcée."""
    return text in G["issued"]


# ----------------------------------------------------------------------------- historique des parties (chess_history.json, 10 parties maximum)
HIST_MAX = 10
_hist_lock = threading.Lock()


def _hist_path():
    return os.path.join(nasko_core.data_dir(), "chess_history.json")


def _hist_read():
    try:
        with open(_hist_path(), encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, list) else []
    except (OSError, ValueError):
        return []


def history():
    """Parties enregistrées, la plus récente d'abord."""
    with _hist_lock:
        return list(reversed(_hist_read()))


def _save_game(reason):
    """Archive la partie courante (fin de partie ou abandon). Au-delà de HIST_MAX, les plus anciennes sont supprimées."""
    b = G["board"]
    if b is None or G["saved"] or not b.move_stack:
        return
    G["saved"] = True
    out = b.outcome()
    if reason == "resign":
        result, outcome = ("0-1" if G["me"] == chess.WHITE else "1-0"), "défaite"
    elif reason == "abandon" or out is None:
        result, outcome = "*", "abandon"
    else:
        result = out.result()
        outcome = "nulle" if out.winner is None else ("victoire" if out.winner == G["me"] else "défaite")
    cfg = nasko_core.load_config()
    me_name = cfg.get("user_label") or "Joueur"
    en_name = f"E.N.O.S. ({G['elo']} Elo)"
    game = chess.pgn.Game.from_board(b)
    game.headers.update({"Event": "E.N.O.S. CHESS", "Site": "E.N.O.S.", "Date": datetime.date.today().strftime("%Y.%m.%d"),
                         "White": me_name if G["me"] == chess.WHITE else en_name, "Black": en_name if G["me"] == chess.WHITE else me_name,
                         "Result": result})
    mine = [m for m in G["moves"] if m["color"] == ("w" if G["me"] == chess.WHITE else "b")]
    stats = {}
    for m in mine:
        stats[m["key"]] = stats.get(m["key"], 0) + 1
    rec = {"id": uuid.uuid4().hex[:10], "date": datetime.datetime.now().isoformat(timespec="seconds"), "player": me_name,
           "me": "w" if G["me"] == chess.WHITE else "b", "power": G["power"], "elo": G["elo"], "result": result, "outcome": outcome,
           "over": _result() if reason != "abandon" else "Abandon", "n_moves": len(b.move_stack),
           "moves": _san_list(b), "pgn": str(game), "stats": stats,
           "opening": (nasko_boss.OPEN_BY_EPD.get(_last_opening_epd(b)) or {}).get("fr", ""),
           "review": build_review(G["moves"], G["me"])}
    with _hist_lock:
        h = _hist_read()
        h.append(rec)
        h = h[-HIST_MAX:]                                           # limite stricte : la plus ancienne disparaît à la 11e partie
        tmp = _hist_path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(h, f, ensure_ascii=False, indent=1)
        os.replace(tmp, _hist_path())


def _san_list(board):
    bd, out = board.root(), []
    for mv in board.move_stack:
        out.append(bd.san(mv))
        bd.push(mv)
    return out


def _last_opening_epd(board):
    """EPD de la dernière position reconnue comme ouverture (parcours de la partie)."""
    last, bd = "", board.root()
    for mv in board.move_stack[:24]:
        bd.push(mv)
        if bd.epd() in nasko_boss.OPEN_BY_EPD:
            last = bd.epd()
    return last


def position_at(game_id, ply):
    """Position d'une partie archivée après `ply` demi-coups (pour la relecture)."""
    rec = next((g for g in history() if g["id"] == game_id), None)
    if rec is None:
        raise ChessError("Partie introuvable.")
    bd = chess.Board()
    mv = None
    for san in rec["moves"][:max(0, min(int(ply), len(rec["moves"])))]:
        mv = bd.push_san(san)
    return {"board": {chess.square_name(s): p.symbol() for s, p in bd.piece_map().items()}, "ply": min(int(ply), len(rec["moves"])),
            "total": len(rec["moves"]), "last": mv.uci() if mv else ""}


# ----------------------------------------------------------------------------- REVIEW (précision, Elo estimé, catégories, courbe d'avantage)
KEYS = ("brilliant", "best", "excellent", "good", "inaccuracy", "mistake", "blunder")


def _winpct(cp):
    """Probabilité de gain (0–100) pour un score en centipions (formule logistique de Lichess/Chess.com)."""
    cp = max(-2000, min(2000, cp))
    return 50.0 + 50.0 * (2.0 / (1.0 + math.exp(-0.00368208 * cp)) - 1.0)


def _move_accuracy(win_before, win_after):
    """Précision d'un coup (0–100) : chute de probabilité de gain → score exponentiel (formule Lichess)."""
    drop = max(0.0, win_before - win_after)
    return max(0.0, min(100.0, 103.1668 * math.exp(-0.04354 * drop) - 3.1669))


def _side_review(moves):
    accs, losses = [], []
    counts = {k: 0 for k in KEYS}
    for q in moves:
        accs.append(_move_accuracy(_winpct(q["before"]), _winpct(q["after"])))
        losses.append(min(q["loss"], 1000))
        counts[q["key"]] = counts.get(q["key"], 0) + 1
    n = len(accs)
    if not n:
        return {"moves": 0, "accuracy": None, "elo": None, "acpl": None, "counts": counts}
    mean = sum(accs) / n
    harm = n / sum(1.0 / max(a, 1.0) for a in accs)                 # la moyenne harmonique pénalise les coups très faibles (comme Chess.com)
    acpl = sum(losses) / n
    elo = max(100, min(3200, round(3100 * math.exp(-0.01 * acpl) / 10) * 10))
    return {"moves": n, "accuracy": round((mean + harm) / 2, 1), "elo": elo, "acpl": round(acpl, 1), "counts": counts}


def build_review(moves, me_color):
    """Bilan d'une partie à partir des coups jugés (G['moves'] ou archive). `me` = le joueur humain, `engine` = E.N.O.S."""
    me = "w" if me_color == chess.WHITE else "b"
    mine = [m for m in moves if m["color"] == me]
    theirs = [m for m in moves if m["color"] != me]
    evals = [(m["after"] if m["color"] == "w" else -m["after"]) for m in moves]          # point de vue des Blancs
    bad = sorted([m for m in mine if m["key"] in ("blunder", "mistake")], key=lambda m: -m["loss"])[:4]
    r_me = _side_review(mine)
    return {"me": r_me, "engine": _side_review(theirs), "me_color": me, "evals": evals, "keys": [m["key"] for m in moves], "sans": [m["san"] for m in moves], "plies": len(moves),
            "confidence": "faible" if r_me["moves"] < 8 else "correcte",
            "critical": [{"n": m["n"], "san": m["san"], "label": m["label"], "key": m["key"], "loss": m["loss"], "best": m.get("best", "")} for m in bad]}


def current_review():
    with _lock:
        if G["board"] is None or not G["moves"]:
            raise ChessError("Aucune partie à analyser.")
        return build_review(G["moves"], G["me"])
