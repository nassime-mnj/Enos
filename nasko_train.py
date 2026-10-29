"""SUPER ENOS : mode ENTRAÎNEMENT. Un joueur d'échecs piloté par un LLM s'entraîne en arrière-plan contre trois profils : E.N.O.S., STOCKFISH et ETO.

  Le thread tourne dans le serveur d'E.N.O.S. : fermer la fenêtre ne l'arrête pas (le bouton ARRÊTER, si). Moteurs DÉDIÉS (2 processus Stockfish) : une partie en cours
  dans CHESS n'est jamais perturbée.
  Super Enos choisit ses coups parmi ceux de Stockfish :
    1. un COUP BRILLANT trouvé par Stockfish (sacrifice qui rapporte) passe avant tout (même filtre que ETO, nasko_chess._eto_choose) ;
    2. sinon, quand plusieurs coups se valent (≤ 40 cp d'écart), le LLM départage selon l'adversaire et les LEÇONS déjà apprises ; le coup doit figurer parmi les candidats
       de Stockfish : le LLM ne peut JAMAIS choisir un coup qui fait perdre du terrain ;
    3. dans tous les cas : pas de nulle par répétition tant qu'une alternative tient la partie (nasko_nodraw), pas de défaite offerte.
  Après chaque partie : bilan chiffré (résultat, perte moyenne en centipions, brillants, nulles esquivées) + UNE leçon rédigée par le LLM (modèle de secours sans LLM).
  Les 6 dernières leçons sont rejouées au LLM avant chaque décision : c'est la mémoire de Super Enos (data/super_enos.json).
  Adversaires : « enos » (pleine puissance, coup brillant prioritaire) · « stockfish » (le moteur pur, 1 s par coup, sans aucun filtre) · « eto » (MultiPV + goût du spectacle).
"""
import json
import logging
import os
import random
import re
import threading
import time

import chess
import chess.engine

import nasko_chess as C
import nasko_core
import nasko_nodraw

log = logging.getLogger("nasko.train")

OPPONENTS = ("enos", "stockfish", "eto")
PROFILE = {
    "enos": "E.N.O.S. : Stockfish à pleine puissance, froid et précis ; il joue le coup brillant dès qu'il le trouve et ne répète jamais.",
    "stockfish": "STOCKFISH : le moteur pur, sans fioritures ni filtre ; il ne fait presque pas d'erreur et exploite la moindre faiblesse.",
    "eto": "ETO : Stockfish en MultiPV avec le goût du spectacle (échecs, captures, tactique) ; il sacrifie dès qu'un sacrifice rapporte.",
}
MAX_PLIES = 300
WIN_CP, WIN_PLIES = 1000, 6      # adjudication : +10 pions (ou pire) pendant 6 demi-coups = partie décidée
DEAD_CP, DEAD_PLIES = 12, 60     # ... et position sans vie (|éval| ≤ 0,12) pendant 60 demi-coups après le 100e : nulle adjugée (une nulle d'entraînement, pas une répétition)
OPENING_PLIES = 6               # premiers demi-coups tirés au hasard parmi les coups quasi équivalents : deux parties ne se ressemblent jamais
LLM_CALLS_PER_GAME = 10
LLM_NEAR_CP = 40                # le LLM ne départage que des coups à ≤ 40 cp du meilleur
KEEP_GAMES, KEEP_LESSONS = 100, 30

_lock = threading.RLock()
S = {"running": False, "stop": False, "thread": None, "cfg": {}, "started": 0.0, "games_done": 0, "game": 0, "opp": "", "color": "w", "fen": chess.STARTING_FEN,
     "san": [], "last": "", "eval": 0, "say": "", "llm": False, "llm_error": "", "error": "", "results": {"w": 0, "d": 0, "l": 0}, "ply": 0}


# ----------------------------------------------------------------------------- mémoire persistante
def _path():
    return os.path.join(nasko_core.data_dir(), "super_enos.json")


def _empty_profile():
    return {"g": 0, "w": 0, "d": 0, "l": 0, "loss_sum": 0.0, "loss_n": 0, "brilliants": 0, "dodged": 0}


def _fresh():
    return {"version": 1, "games": [], "profiles": {o: _empty_profile() for o in OPPONENTS}, "lessons": [], "openings": {}, "autostart": False, "plies": 0}


def memory():
    try:
        with open(_path(), encoding="utf-8") as f:
            m = json.load(f)
    except (OSError, ValueError):
        return _fresh()
    base = _fresh()
    for k, v in base.items():
        m.setdefault(k, v)
    for o in OPPONENTS:
        m["profiles"].setdefault(o, _empty_profile())
    return m


def _save(m):
    p = _path()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False)
    os.replace(tmp, p)


def reset():
    with _lock:
        if S["running"]:
            raise C.ChessError("Arrêtez l'entraînement avant d'effacer la mémoire de Super Enos.")
        _save({**_fresh(), "autostart": memory().get("autostart", False)})
    return summary()


# ----------------------------------------------------------------------------- cloud : le cerveau de Super Enos est commun au PC et au téléphone
# Chaque appareil envoie SON document (jamais celui des autres) ; ce qu'il reçoit des autres appareils est gardé à part (m["remote"]) et fusionné à l'affichage.
# Résultat : un seul entraînement, et la réinstallation de l'appli retrouve tout (l'ancien document reste dans le compte).
def _device_id():
    c = nasko_core.load_config()
    if not c.get("brain_device"):
        import uuid
        nasko_core.update_config({"brain_device": "pc-" + uuid.uuid4().hex[:12]})
        c = nasko_core.load_config()
    return c["brain_device"]


def merge_docs(docs):
    out = {"profiles": {o: _empty_profile() for o in OPPONENTS}, "lessons": [], "games": [], "openings": {}, "plies": 0}
    seen = set()
    for d in docs:
        doc = d.get("doc") or {}
        for o, p in (doc.get("profiles") or {}).items():
            q = out["profiles"].setdefault(o, _empty_profile())
            for k in q:
                q[k] += p.get(k, 0)
        for l in doc.get("lessons") or []:
            if l.get("text") and l["text"] not in seen:
                seen.add(l["text"])
                out["lessons"].append(l)
        out["games"] += doc.get("games") or []
        for n, v in (doc.get("openings") or {}).items():
            q = out["openings"].setdefault(n, {"w": 0, "d": 0, "l": 0})
            for k in q:
                q[k] += v.get(k, 0)
        out["plies"] += doc.get("plies", 0)
    out["lessons"] = sorted(out["lessons"], key=lambda x: x.get("t", 0))[-KEEP_LESSONS:]
    out["games"] = sorted(out["games"], key=lambda x: x.get("t", 0))[-KEEP_GAMES:]
    return out


def effective(m):
    """Mémoire vue par l'interface et par le LLM : celle de cet appareil + celle des autres appareils du compte."""
    r = m.get("remote")
    if not r:
        return m
    e = dict(m)
    e["profiles"] = {o: {k: m["profiles"].get(o, _empty_profile()).get(k, 0) + r["profiles"].get(o, {}).get(k, 0) for k in _empty_profile()} for o in OPPONENTS}
    seen, ls = set(), []
    for l in sorted(m["lessons"] + r["lessons"], key=lambda x: x.get("t", 0)):
        if l["text"] not in seen:
            seen.add(l["text"])
            ls.append(l)
    e["lessons"] = ls[-KEEP_LESSONS:]
    e["games"] = sorted(m["games"] + r["games"], key=lambda x: x.get("t", 0))[-KEEP_GAMES:]
    ops = {n: dict(v) for n, v in m["openings"].items()}
    for n, v in r["openings"].items():
        q = ops.setdefault(n, {"w": 0, "d": 0, "l": 0})
        for k in q:
            q[k] += v.get(k, 0)
    e["openings"] = ops
    e["plies"] = m["plies"] + r["plies"]
    return e


_last_sync = [0.0]


def cloud_sync(force=False):
    """Envoie la mémoire de CET appareil et récupère celle des autres. Silencieux hors ligne / sans compte. -> {"ok", "devices", "error"}."""
    import nasko_cloud
    c = nasko_core.load_config()
    if not c.get("cloud_refresh") or not c.get("cloud_brain", True):
        return {"ok": False, "devices": 0, "error": "" if not c.get("cloud_refresh") else "désactivé"}
    if not force and time.time() - _last_sync[0] < 30:
        return {"ok": True, "devices": len((memory().get("remote") or {}).get("_n", [])), "error": ""}
    with _lock:
        m = memory()
        doc = {k: m[k] for k in ("games", "profiles", "lessons", "openings", "plies")}
    try:
        d = nasko_cloud.request("POST", "/brain/sync", {"kind": "superenos", "device": _device_id(), "doc": doc})
    except Exception as e:                                                    # noqa: BLE001 — hors ligne : l'entraînement continue en local
        return {"ok": False, "devices": 0, "error": str(e)[:120]}
    _last_sync[0] = time.time()
    with _lock:
        m = memory()
        m["remote"] = merge_docs(d.get("docs") or [])
        m["remote"]["_n"] = [x.get("device") for x in d.get("docs") or []]
        _save(m)
    return {"ok": True, "devices": len(d.get("docs") or []), "error": ""}


def summary():
    m = effective(memory())
    prof = {}
    for o, p in m["profiles"].items():
        prof[o] = {**{k: p[k] for k in ("g", "w", "d", "l", "brilliants", "dodged")}, "acpl": round(p["loss_sum"] / p["loss_n"], 1) if p["loss_n"] else None,
                   "score": round((p["w"] + 0.5 * p["d"]) / p["g"] * 100) if p["g"] else None}
    ops = sorted(m["openings"].items(), key=lambda kv: -(kv[1]["w"] + kv[1]["d"] + kv[1]["l"]))[:8]
    return {"profiles": prof, "lessons": m["lessons"][-10:], "games": m["games"][-12:], "openings": [{"name": k, **v} for k, v in ops], "plies": m["plies"], "autostart": bool(m.get("autostart"))}


# ----------------------------------------------------------------------------- état public (suivi par l'interface PC et par le téléphone)
def status():
    with _lock:
        out = {k: S[k] for k in ("running", "games_done", "game", "opp", "color", "fen", "last", "eval", "say", "llm", "llm_error", "error", "results", "ply")}
        out["san"] = S["san"][-14:]
        out["cfg"] = dict(S["cfg"])
        out["elapsed"] = int(time.time() - S["started"]) if S["running"] else 0
        out["stockfish"] = bool(C.stockfish_path())
        out["memory"] = summary()
        out["cloud"] = {"on": bool(nasko_core.load_config().get("cloud_refresh")) and nasko_core.load_config().get("cloud_brain", True), "devices": len((memory().get("remote") or {}).get("_n", []))}
        return out


def _set(**kw):
    with _lock:
        S.update(kw)


# ----------------------------------------------------------------------------- LLM
def _llm_ready():
    try:
        import nasko_llm
        return bool(nasko_llm.configured(nasko_core.load_config()))
    except Exception:                                                        # noqa: BLE001
        return False


def _complete(system, user, max_tokens=140, clean=True):
    import nasko_llm
    return nasko_llm.complete(nasko_core.load_config(), system, user, max_tokens=max_tokens, clean=clean)


class _Brain:
    """Appels LLM d'une session : plafond par partie, coupure après 3 échecs d'affilée (clé absente, quota…)."""

    def __init__(self, enabled):
        self.on = bool(enabled) and _llm_ready()
        self.fails = 0
        self.calls = 0

    def new_game(self):
        self.calls = 0

    def can(self):
        return self.on and self.fails < 3 and self.calls < LLM_CALLS_PER_GAME

    def ask(self, system, user, **kw):
        self.calls += 1
        try:
            out = _complete(system, user, **kw)
            self.fails = 0
            return out
        except Exception as e:                                               # noqa: BLE001
            self.fails += 1
            if self.fails >= 3:
                _set(llm=False, llm_error=str(e)[:160])
            log.info("Super Enos : LLM indisponible (%s)", e)
            return None


def _lessons_text(m, opp):
    m = effective(m)
    ls = [x for x in m["lessons"] if x.get("opp") in (opp, "all")][-3:] + m["lessons"][-3:]
    seen, out = set(), []
    for x in ls:
        if x["text"] not in seen:
            seen.add(x["text"])
            out.append("- " + x["text"])
    return "\n".join(out[-6:]) or "(aucune leçon pour l'instant)"


def _json_obj(text):
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except ValueError:
        return {}


# ----------------------------------------------------------------------------- moteurs dédiés
def _open_engines(threads):
    me, _ = C._open_engine()
    foe, _ = C._open_engine()
    for e in (me, foe):
        try:
            opts = {}
            if "Threads" in e.options:
                opts["Threads"] = threads
            if "Hash" in e.options:
                opts["Hash"] = 64
            if opts:
                e.configure(opts)
        except Exception:                                                    # noqa: BLE001
            pass
    return me, foe


def _quit(*engines):
    for e in engines:
        try:
            e.quit()
        except Exception:                                                    # noqa: BLE001
            try:
                e.close()
            except Exception:                                                # noqa: BLE001
                pass


def _eval_white(eng, board):
    """Évaluation rapide (centipions, point de vue des Blancs, plafonnée) : sert à la perte moyenne et à la jauge."""
    if board.is_checkmate():
        return -C.CAP if board.turn == chess.WHITE else C.CAP
    if board.is_game_over():
        return 0
    info = eng.analyse(board, chess.engine.Limit(time=0.08))
    return max(-C.CAP, min(C.CAP, info["score"].white().score(mate_score=C.MAT)))


# ----------------------------------------------------------------------------- choix des coups
def _varied(board, eng):
    """Ouverture variée : un coup au hasard parmi ceux qui valent le meilleur à 25 cp près."""
    lines = C._pov_lines(board, 5, depth=10, secs=0.25, eng=eng)
    if not lines:
        return random.choice(list(board.legal_moves))
    ok = [ln for ln in lines if lines[0]["cp"] - ln["cp"] <= 25 and not ln["mate"]] or lines[:1]
    mv = random.choice(ok)["move"]
    return C._dodge(board, mv, eng)


def _opponent_move(board, opp, foe, secs):
    if len(board.move_stack) < OPENING_PLIES:
        return _varied(board, foe)
    if opp == "stockfish":
        return foe.play(board, chess.engine.Limit(time=max(0.3, secs * 1.5))).move                 # le moteur pur : aucun filtre
    mv, _ = C._eto_choose(board, taste=(opp == "eto"), eng=foe, secs=secs)
    return mv


def _trainee_move(board, opp, me, secs, brain, mem, rec):
    """Coup de Super Enos : (coup, commentaire)."""
    if len(board.move_stack) < OPENING_PLIES:
        return _varied(board, me), ""
    mv, brill = C._eto_choose(board, taste=False, eng=me, secs=secs)               # coup brillant prioritaire, jamais de nulle par répétition
    if brill:
        rec["brilliants"] += 1
        return mv, f"Coup brillant : sacrifice de {brill['piece']}, évaluation ensuite {brill['cp'] / 100:+.1f}."
    if not brain.can():
        return mv, ""
    try:
        lines = C._pov_lines(board, 4, depth=13, secs=min(0.8, secs), eng=me)
    except Exception:                                                        # noqa: BLE001
        return mv, ""
    if not lines or lines[0]["mate"]:
        return mv, ""
    near = [ln for ln in lines if lines[0]["cp"] - ln["cp"] <= LLM_NEAR_CP and not ln["mate"] and not nasko_nodraw.draw_after(board, ln["move"])]
    if len(near) < 2 or abs(lines[0]["cp"]) > 700:
        return mv, ""
    sans = {board.san(ln["move"]): ln for ln in near}
    cand = "\n".join(f"- {san} ({ln['cp'] / 100:+.2f})" for san, ln in sans.items())
    recent = " ".join(rec["san"][-8:]) or "(début de partie)"
    sys_p = ("Tu es SUPER ENOS, un joueur d'échecs qui s'entraîne contre des profils différents. Stockfish te propose des coups quasi équivalents ; tu choisis celui qui convient le mieux "
             "à l'adversaire et à tes leçons apprises. Réponds UNIQUEMENT par un objet JSON : {\"move\": \"<un coup de la liste, en notation SAN exacte>\", \"why\": \"<10 mots maximum>\"}.")
    usr = (f"Adversaire : {PROFILE[opp]}\nTu as les {'Blancs' if board.turn == chess.WHITE else 'Noirs'}. Position (FEN) : {board.fen()}\nDerniers coups : {recent}\n"
           f"Candidats (évaluation de ton point de vue) :\n{cand}\nTes leçons :\n{_lessons_text(mem, opp)}")
    ans = brain.ask(sys_p, usr, max_tokens=120, clean=False)
    obj = _json_obj(ans)
    san = str(obj.get("move", "")).strip().replace("0-0", "O-O")
    if san in sans:
        pick = sans[san]["move"]
        alt, _why = nasko_nodraw.pick(board, lines, pick)              # jamais de nulle par répétition, même si le LLM la choisit
        return alt, str(obj.get("why", ""))[:90]
    return mv, ""


# ----------------------------------------------------------------------------- une partie
def _result_for(board, me_color, timeout=False):
    """(code, texte) du point de vue de Super Enos : w / d / l."""
    if board.is_checkmate():
        return ("l" if board.turn == me_color else "w"), "Échec et mat"
    if board.is_stalemate():
        return "d", "Pat"
    if board.is_insufficient_material():
        return "d", "Matériel insuffisant"
    if board.is_repetition(3):
        return "d", "Triple répétition"
    if board.is_fifty_moves():
        return "d", "50 coups"
    return "d", ("Limite de coups" if timeout else "Nulle")


def _finished(board):
    return board.is_game_over() or board.is_repetition(3) or board.is_fifty_moves()


def play_game(opp, color, me, foe, secs, brain, mem):
    me_color = chess.WHITE if color == "w" else chess.BLACK
    board = chess.Board()
    rec = {"opp": opp, "color": color, "san": [], "brilliants": 0, "dodged": 0, "loss_sum": 0.0, "loss_n": 0, "worst": None}
    brain.new_game()
    dodged0 = C.G.get("dodged", 0)
    ev = _eval_white(me, board)
    streak = {"win": 0, "dead": 0}
    verdict = None
    _set(opp=opp, color=color, fen=board.fen(), san=[], last="", eval=ev, say="", ply=0)
    while not _finished(board) and len(board.move_stack) < MAX_PLIES and not S["stop"]:
        mine = board.turn == me_color
        say = ""
        if mine:
            mv, say = _trainee_move(board, opp, me, secs, brain, mem, rec)
        else:
            mv = _opponent_move(board, opp, foe, secs)
        san = board.san(mv)
        before = ev
        board.push(mv)
        ev = _eval_white(me, board)
        if mine:
            sgn = 1 if me_color == chess.WHITE else -1
            loss = max(0, sgn * (before - ev))
            rec["loss_sum"] += loss
            rec["loss_n"] += 1
            if not rec["worst"] or loss > rec["worst"][0]:
                rec["worst"] = (loss, san, len(board.move_stack))
        rec["san"].append(san)
        streak["win"] = streak["win"] + 1 if abs(ev) >= WIN_CP else 0
        streak["dead"] = streak["dead"] + 1 if abs(ev) <= DEAD_CP and len(board.move_stack) > 100 else 0
        if streak["win"] >= WIN_PLIES:
            verdict = ("w" if (ev > 0) == (me_color == chess.WHITE) else "l", "Adjugé (avantage décisif)")
        elif streak["dead"] >= DEAD_PLIES:
            verdict = ("d", "Adjugé (position morte)")
        _set(fen=board.fen(), san=S["san"] + [san], last=mv.uci(), eval=ev, ply=len(board.move_stack), say=say if mine else S["say"])
        if verdict:
            break
    rec["dodged"] = max(0, C.G.get("dodged", 0) - dodged0)
    if S["stop"] and not _finished(board) and not verdict:
        return None
    if verdict:
        return rec, board, verdict[0], verdict[1]
    code, why = _result_for(board, me_color, timeout=not board.is_game_over() and len(board.move_stack) >= MAX_PLIES)
    return rec, board, code, why


def _lesson(rec, board, code, why, brain, mem):
    """UNE leçon (≤ 25 mots) : rédigée par le LLM, sinon un gabarit tiré des faits."""
    acpl = round(rec["loss_sum"] / rec["loss_n"]) if rec["loss_n"] else 0
    res = {"w": "victoire", "d": "nulle", "l": "défaite"}[code]
    worst = rec["worst"]
    facts = (f"Partie contre {rec['opp'].upper()} avec les {'Blancs' if rec['color'] == 'w' else 'Noirs'} : {res} ({why}) en {len(board.move_stack)} demi-coups. "
             f"Perte moyenne {acpl} centipions par coup. Coups brillants : {rec['brilliants']}. Nulles par répétition esquivées : {rec['dodged']}. "
             + (f"Pire coup : {worst[1]} au demi-coup {worst[2]} (−{int(worst[0])} cp). " if worst and worst[0] >= 60 else "")
             + f"Début de partie : {' '.join(rec['san'][:10])}.")
    if brain.on and brain.fails < 3:
        sys_p = ("Tu es SUPER ENOS, joueur d'échecs en entraînement. À partir du bilan de la partie, écris UNE seule leçon concrète à retenir pour la prochaine fois contre ce profil "
                 "(25 mots maximum, à la première personne, texte brut, sans liste).")
        txt = brain.ask(sys_p, facts, max_tokens=90)
        if txt:
            return txt.strip().replace("\n", " ")[:240]
    if code == "l":
        return (f"Contre {rec['opp'].upper()}, je dois vérifier mes pièces en prise avant chaque coup"
                + (f" (le coup {worst[1]} m'a coûté {int(worst[0])} cp)." if worst and worst[0] >= 60 else "."))
    if code == "d":
        return f"Contre {rec['opp'].upper()}, la nulle n'est pas assez : je cherche un plan actif plutôt que d'échanger." + (f" J'ai dû esquiver {rec['dodged']} répétition(s)." if rec["dodged"] else "")
    return f"Contre {rec['opp'].upper()}, mon plan a fonctionné : garder l'initiative et éviter les répétitions."


def _record(rec, board, code, why, lesson):
    with _lock:
        m = memory()
        p = m["profiles"][rec["opp"]]
        p["g"] += 1
        p[code] += 1
        p["loss_sum"] += rec["loss_sum"]
        p["loss_n"] += rec["loss_n"]
        p["brilliants"] += rec["brilliants"]
        p["dodged"] += rec["dodged"]
        m["plies"] += len(board.move_stack)
        try:
            import nasko_boss
            ob, name = chess.Board(), ""
            for mv in list(board.move_stack)[:24]:
                ob.push(mv)
                o = nasko_boss.opening_of(ob)
                if o:
                    name = o["fr"]
            if name:
                d = m["openings"].setdefault(name[:60], {"w": 0, "d": 0, "l": 0})
                d[code] += 1
        except Exception:                                                    # noqa: BLE001
            pass
        m["games"].append({"t": int(time.time()), "opp": rec["opp"], "color": rec["color"], "result": code, "why": why, "plies": len(board.move_stack),
                           "acpl": round(rec["loss_sum"] / rec["loss_n"], 1) if rec["loss_n"] else None, "brilliants": rec["brilliants"], "dodged": rec["dodged"]})
        m["games"] = m["games"][-KEEP_GAMES:]
        m["lessons"].append({"t": int(time.time()), "opp": rec["opp"], "result": code, "text": lesson})
        m["lessons"] = m["lessons"][-KEEP_LESSONS:]
        _save(m)
        S["results"][code] += 1


# ----------------------------------------------------------------------------- boucle d'entraînement
def _loop(cfg):
    me = foe = None
    try:
        cloud_sync(force=True)                                                   # d'abord récupérer ce que le téléphone a appris
        me, foe = _open_engines(cfg["threads"])
        brain = _Brain(cfg["llm"])
        _set(llm=brain.on, llm_error="" if brain.on or not cfg["llm"] else "LLM non configuré : Super Enos s'entraîne avec Stockfish seul (clé dans nasko_config.json).")
        opps = cfg["opponents"]
        i = 0
        while not S["stop"] and (cfg["games"] <= 0 or S["games_done"] < cfg["games"]):
            opp = opps[i % len(opps)]
            color = "w" if (i // len(opps)) % 2 == 0 else "b"                        # chaque adversaire est affronté avec les deux couleurs
            i += 1
            _set(game=S["games_done"] + 1)
            out = play_game(opp, color, me, foe, cfg["secs"], brain, memory())
            if out is None:
                break
            rec, board, code, why = out
            _record(rec, board, code, why, _lesson(rec, board, code, why, brain, memory()))
            _set(games_done=S["games_done"] + 1)
            cloud_sync()
            time.sleep(0.5)
    except C.ChessError as e:
        _set(error=str(e))
    except Exception as e:                                                   # noqa: BLE001
        log.exception("Super Enos")
        _set(error=f"{e.__class__.__name__}: {str(e)[:160]}")
    finally:
        _quit(*[e for e in (me, foe) if e])
        _set(running=False, stop=False)


def start(opponents=None, games=0, secs=0.6, llm=True, threads=1):
    """Lance l'entraînement en arrière-plan. games = 0 : sans fin (jusqu'à l'arrêt)."""
    with _lock:
        if S["running"]:
            raise C.ChessError("Super Enos s'entraîne déjà.")
        if not C.stockfish_path():
            raise C.ChessError("Stockfish est introuvable : lancez d'abord une partie CHESS (il est téléchargé au premier lancement).")
        opps = [o for o in (opponents or OPPONENTS) if o in OPPONENTS] or list(OPPONENTS)
        cfg = {"opponents": opps, "games": max(0, min(10000, int(games))), "secs": max(0.2, min(5.0, float(secs))), "llm": bool(llm), "threads": max(1, min(4, int(threads)))}
        S.update(running=True, stop=False, cfg=cfg, started=time.time(), games_done=0, game=0, results={"w": 0, "d": 0, "l": 0}, error="", llm_error="", san=[], say="", ply=0, fen=chess.STARTING_FEN)
        t = threading.Thread(target=_loop, args=(cfg,), daemon=True, name="super-enos")
        S["thread"] = t
        t.start()
    return status()


def stop(wait=False):
    with _lock:
        if not S["running"]:
            return status()
        S["stop"] = True
        t = S["thread"]
    if wait and t:
        t.join(timeout=20)
    return status()


def set_autostart(on):
    with _lock:
        m = memory()
        m["autostart"] = bool(on)
        _save(m)
    return summary()


def autostart_if_enabled():
    """Appelé au démarrage du serveur : relance l'entraînement si l'utilisateur l'a demandé (option « Lancer au démarrage »)."""
    try:
        if memory().get("autostart") and not S["running"] and C.stockfish_path():
            start()
            log.info("Super Enos : entraînement relancé au démarrage")
    except Exception:                                                        # noqa: BLE001
        log.info("Super Enos : démarrage automatique impossible", exc_info=True)
