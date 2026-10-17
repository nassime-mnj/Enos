"""MODE APPRENTISSAGE : gestionnaire d'ouvertures (arbres de variantes PGN) animé par ETO.

  * Bibliothèque : tous les fichiers `openings/*.pgn` (dossier livré avec E.N.O.S. + `<dossier de ENOS.exe>\\openings\\` pour vos propres fichiers).
    Un fichier peut contenir plusieurs parties = plusieurs ouvertures. Format : PGN standard avec variantes, EN-TÊTES [Event] (nom), [Repertoire "white|black"],
    [Level], [Theory] (« de la Française », prononcé au passage de main), [Description]. Commentaires de coups au format Lichess :
    `{ [%name Variante d'Avance] [%cal Ge2e4,Rd7d5] [%csl Gd4] Texte de référence }` (flèches : G vert, R rouge, Y jaune, B bleu ; cases : G bon, R mauvais, Y info, B idée).
    Une étude Lichess exportée en PGN fonctionne telle quelle.
  * Navigation (python-chess, chess.pgn) : avancer d'un coup, reculer (Rewind), explorer les branches, aller à un nœud.
  * DÉMONSTRATION : un plan est construit en parcourant l'arbre (variantes secondaires d'abord, avec retours en arrière, puis la ligne principale) ;
    chaque étape joue un coup sur le plateau Godot (animation), dessine flèches / cases, et ETO parle aux nœuds clés (contexte envoyé au LLM par
    nasko_coach.write_study ; voix ElevenLabs d'ETO). À la fin, ETO rend la main : « À toi de jouer, montre-moi si t'as compris la théorie … ».
  * PRATIQUE : l'élève joue son camp ; son coup est comparé à l'arbre. Dans la théorie : ETO félicite et l'adversaire simulé (coups typiques 1200-1300 Elo
    décrits par les variantes) répond ; hors théorie : le coup est annulé sur le plateau, ETO montre le coup attendu (flèche verte) et laisse réessayer.

Le plateau ne fait que dessiner : Python reste seul juge de la légalité (comme pour les autres modes d'échecs). Sécurité : identifiant d'ouverture validé
dans la liste de la bibliothèque (jamais utilisé comme chemin de fichier)."""
import hashlib
import json
import logging
import os
import random
import re
import threading
import unicodedata

import chess
import chess.pgn

import nasko_core
import nasko_persona

log = logging.getLogger("nasko.openings")
STUDY_CACHE_VERSION = "1"


class OpeningError(Exception):
    pass


_lock = threading.RLock()
_CMD = re.compile(r"\[%(\w+)\s+([^\]]*)\]")
_SQ = re.compile(r"^[a-h][1-8]$")
ARROW_KIND = {"G": "best", "R": "threat", "Y": "played", "B": "punish"}
SQUARE_KIND = {"G": "good", "R": "bad", "Y": "info", "B": "idea"}
OPP_ELO = "1200-1300"


# ----------------------------------------------------------------------------- annotations PGN
def parse_comment(text):
    """{name, arrows[{from,to,kind}], squares[{sq,kind}], note} depuis un commentaire PGN (commandes Lichess [%cal] [%csl] + [%name])."""
    text = text or ""
    name, arrows, squares = "", [], []
    for m in _CMD.finditer(text):
        cmd, arg = m.group(1), m.group(2).strip()
        if cmd == "name":
            name = arg
        elif cmd == "cal":
            for tok in arg.split(","):
                tok = tok.strip()
                if len(tok) == 5 and tok[0] in ARROW_KIND and _SQ.match(tok[1:3]) and _SQ.match(tok[3:5]) and tok[1:3] != tok[3:5]:
                    arrows.append({"from": tok[1:3], "to": tok[3:5], "kind": ARROW_KIND[tok[0]]})
        elif cmd == "csl":
            for tok in arg.split(","):
                tok = tok.strip()
                if len(tok) == 3 and tok[0] in SQUARE_KIND and _SQ.match(tok[1:3]):
                    squares.append({"sq": tok[1:3], "kind": SQUARE_KIND[tok[0]]})
    note = " ".join(_CMD.sub("", text).split())
    return {"name": name, "arrows": arrows, "squares": squares, "note": note}


def _slug(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "ouverture"


# ----------------------------------------------------------------------------- bibliothèque
_lib = {"sig": None, "items": {}}


def openings_dirs():
    dirs = []
    for d in (nasko_core.resource_path("openings"), os.path.join(nasko_core.app_dir(), "openings")):
        d = os.path.abspath(d)
        if os.path.isdir(d) and d not in dirs:
            dirs.append(d)
    return dirs


def _count(node):
    kids = node.variations
    if not kids:
        return 1, 1
    leaves, nodes = 0, 1
    for k in kids:
        l, n = _count(k)
        leaves, nodes = leaves + l, nodes + n
    return leaves, nodes


def _scan():
    files = []
    for d in openings_dirs():
        for f in sorted(os.listdir(d)):
            if f.lower().endswith(".pgn"):
                files.append(os.path.join(d, f))
    sig = tuple((f, os.path.getmtime(f)) for f in files)
    if sig == _lib["sig"]:
        return _lib["items"]
    items = {}
    for f in files:
        try:
            with open(f, encoding="utf-8-sig") as fh:
                while True:
                    g = chess.pgn.read_game(fh)
                    if g is None:
                        break
                    name = (g.headers.get("Event") or "").strip()
                    if not name or name == "?":
                        continue
                    oid, n = _slug(name), 2
                    while oid in items:
                        oid, n = f"{_slug(name)}-{n}", n + 1
                    color = "black" if (g.headers.get("Repertoire") or "").strip().lower() in ("black", "noirs", "noir", "b") else "white"
                    leaves, nodes = _count(g)
                    items[oid] = {"game": g, "meta": {
                        "id": oid, "name": name, "color": color, "level": g.headers.get("Level", OPP_ELO), "eco": g.headers.get("ECO", ""),
                        "theory": g.headers.get("Theory") or f"de {name}", "description": g.headers.get("Description", ""),
                        "lines": leaves, "moves": nodes - 1, "file": os.path.basename(f), "warnings": [str(e) for e in g.errors][:3]}}
                    if g.errors:
                        log.warning("PGN %s (%s) : %s", os.path.basename(f), name, g.errors[:2])
        except (OSError, ValueError) as e:
            log.warning("PGN illisible %s : %s", f, e)
    _lib.update(sig=sig, items=items)
    return items


def list_openings():
    """Ouvertures disponibles, rangées par répertoire (Blancs d'abord) puis par nom."""
    with _lock:
        metas = [v["meta"] for v in _scan().values()]
    return sorted(metas, key=lambda m: (m["color"] != "white", m["name"].lower()))


def _entry(oid):
    e = _scan().get(str(oid or ""))
    if not e:
        raise OpeningError("Ouverture inconnue.")
    return e


# ----------------------------------------------------------------------------- mots / contexte LLM
def _say(san):
    return nasko_persona.say_san(san, nasko_core.language())


def _side(white):
    return "Blancs" if white else "Noirs"


def _anim(board_before, move):
    """Description d'un coup pour l'animation Godot (même format que nasko_chess : capture, roque, promotion, échec, mat)."""
    import nasko_chess
    a = nasko_chess._anim(board_before, move)
    b = board_before.copy(stack=False)
    b.push(move)
    a["check"], a["mate"] = b.is_check(), b.is_checkmate()
    return a


class Study:
    """Une leçon : arbre PGN + position courante (chemin d'indices de variantes) + mode (demo | explore | practice)."""

    def __init__(self, entry, detail="key", voice=True):
        self.meta = entry["meta"]
        self.game = entry["game"]
        self.user = chess.BLACK if self.meta["color"] == "black" else chess.WHITE
        self.path = []                       # [i0, i1, …] : indice de la variante choisie à chaque demi-coup depuis la racine
        self.mode = "explore"
        self.detail = detail if detail in ("full", "key") else "key"
        self.voice = bool(voice)
        self.plan, self.pi = [], 0
        self.errors, self.lines_done, self.ok_run = 0, 0, 0
        self.seq = 0
        self.over = False                    # ligne de pratique terminée
        self.arrows, self.squares = [], []
        self.note = ""

    # ---- navigation (python-chess) -------------------------------------------------
    def node_at(self, path=None):
        n = self.game
        for i in (self.path if path is None else path):
            n = n.variations[i]
        return n

    @property
    def node(self):
        return self.node_at()

    def board(self):
        return self.node.board()

    def children(self, node=None):
        node = node or self.node
        b = node.board()
        out = []
        for i, k in enumerate(node.variations):
            san = b.san(k.move)
            out.append({"idx": i, "san": san, "say": _say(san), "uci": k.move.uci(), "name": parse_comment(k.comment)["name"]})
        return out

    def forward(self, idx=0):
        node = self.node
        if not node.variations:
            raise OpeningError("Fin de la ligne : plus de coup dans cette branche.")
        if not 0 <= idx < len(node.variations):
            raise OpeningError("Variante inconnue.")
        before = node.board()
        kid = node.variations[idx]
        self.path.append(idx)
        return _anim(before, kid.move), kid

    def back(self):
        if not self.path:
            raise OpeningError("Déjà au début de la leçon.")
        node = self.node
        mv = node.move
        self.path.pop()
        return {"from": chess.square_name(mv.to_square), "to": chess.square_name(mv.from_square)}

    def variation_name(self, path=None):
        path = list(self.path if path is None else path)
        for k in range(len(path), 0, -1):
            n = parse_comment(self.node_at(path[:k]).comment)["name"]
            if n:
                return n
        return ""

    def san_list(self):
        b, out, n = chess.Board(), [], self.game
        for i in self.path:
            n = n.variations[i]
            out.append(b.san(n.move))
            b.push(n.move)
        return out

    def line_words(self, path=None, last=6):
        path = list(self.path if path is None else path)
        b, n, sans = chess.Board(), self.game, []
        for i in path:
            n = n.variations[i]
            sans.append(b.san(n.move))
            b.push(n.move)
        return ", ".join(_say(s) for s in sans[-last:])

    # ---- vues -----------------------------------------------------------------------
    def players(self):
        if self.mode == "practice":
            return {"w": "VOUS" if self.user == chess.WHITE else f"ETO ({OPP_ELO})", "b": "VOUS" if self.user == chess.BLACK else f"ETO ({OPP_ELO})"}
        return {"w": "ETO", "b": "ETO"}

    def view(self):
        """Vue minimale envoyée au plateau Godot (même format que nasko_chess.view)."""
        b = self.board()
        node = self.node
        legal = {}
        if self.mode == "practice" and b.turn == self.user and not self.over:
            for m in b.legal_moves:
                legal.setdefault(chess.square_name(m.from_square), []).append(chess.square_name(m.to_square))
        return {"board": {chess.square_name(s): p.symbol() for s, p in b.piece_map().items()}, "turn": "w" if b.turn == chess.WHITE else "b",
                "me": "w" if self.user == chess.WHITE else "b", "legal": legal, "check": b.is_check(), "over": "", "mode": "study",
                "last": node.move.uci() if node.move else "", "players": self.players(), "seq": self.seq, "eval": 0}

    def state(self):
        node = self.node
        ann = parse_comment(node.comment) if node is not self.game else {"name": "", "arrows": [], "squares": [], "note": ""}
        v = self.view()
        return {"active": True, "opening": self.meta, "mode": self.mode, "fen": node.board().fen(), "board": v["board"], "turn": v["turn"], "last": v["last"],
                "user": v["me"], "legal": v["legal"], "path": ".".join(map(str, self.path)), "ply": len(self.path), "sans": self.san_list(),
                "variations": self.children() if not self.over else [], "variation": self.variation_name(), "note": ann["note"], "name": ann["name"],
                "arrows": self.arrows if self.arrows else ann["arrows"], "squares": self.squares if self.squares else ann["squares"],
                "progress": [self.pi, len(self.plan)], "speeches": sum(1 for x in self.plan if x.get("speak")), "errors": self.errors, "lines_done": self.lines_done, "detail": self.detail, "voice": self.voice,
                "over": self.over, "check": v["check"], "seq": self.seq}


# ----------------------------------------------------------------------------- plan de démonstration
def build_plan(st):
    """Parcours de l'arbre : pour chaque point de bifurcation, les variantes secondaires d'abord (annonce, coups, retour en arrière), puis la ligne principale.
    Chaque étape : intro | announce | play | rewind | end. ETO parle (`speak`) à l'intro, avant chaque variante, à la fin de chaque paire de coups
    (mode « full », détaillé) ou aux coups qui nomment une variante et à la fin de chaque branche (mode « key », essentiel, par défaut), au retour en ligne principale et à la fin."""
    steps, group, cursor = [], [], []
    me_name = _side(st.user == chess.WHITE)
    base = {"opening": st.meta["name"], "color": st.meta["color"], "me_name": me_name, "theory": st.meta["theory"]}

    def ctx(path, **kw):
        return {**base, "variation": st.variation_name(path), "line": st.line_words(path), **kw}

    def flush(path):
        played = " ; ".join(f"{g['side']} : {g['say']}" for g in group)
        notes = [g["note"] for g in group if g["note"]][:3]
        group.clear()
        return played, notes

    def walk(node, path, depth_alt):
        kids = node.variations
        if not kids:
            return
        order = [(i, k) for i, k in enumerate(kids) if i != 0] + [(0, kids[0])]
        has_alts = len(kids) > 1
        board = node.board()
        for n, (i, kid) in enumerate(order):
            is_alt = i != 0
            p = path + [i]
            san = board.san(kid.move)
            ann = parse_comment(kid.comment)
            white = board.turn == chess.WHITE
            if is_alt or (i == 0 and has_alts):
                played, notes = flush(path)
                kind = "announce" if is_alt else "resume"
                back = is_alt and n > 0
                steps.append({"type": "announce", "kind": kind, "speak": kind, "ckey": f"{kind}|{'.'.join(map(str, p))}|{int(back)}",
                              "ctx": ctx(path, played=played, next=f"{_side(white)} : {_say(san)}", back=back, notes=notes + ([ann["note"]] if ann["note"] else []))})
            group.append({"side": _side(white), "say": _say(san), "note": ann["note"], "name": ann["name"]})
            leaf = not kid.variations
            speak_here = leaf or (not white and (st.detail == "full" or any(g["name"] for g in group)))
            step = {"type": "play", "path": p, "idx": i, "san": san, "uci": kid.move.uci(), "ply": len(p), "color": "w" if white else "b", "name": ann["name"],
                    "arrows": ann["arrows"], "squares": ann["squares"], "speak": None}
            if speak_here:
                played, notes = flush(p)
                step["speak"], step["ckey"] = "move", f"move|{'.'.join(map(str, p))}"
                step["ctx"] = ctx(p, played=played, notes=notes)
            steps.append(step)
            cursor[:] = p
            walk(kid, p, depth_alt or is_alt)
            if is_alt:
                steps.append({"type": "rewind", "to": list(path), "plies": len(cursor) - len(path), "speak": None})
                cursor[:] = path

    steps.append({"type": "intro", "speak": "intro", "ckey": "intro", "ctx": {**base, "variation": "", "line": "", "notes": [st.meta["description"]] if st.meta["description"] else []}})
    walk(st.game, [], False)
    steps.append({"type": "end", "speak": "end", "ckey": "end", "ctx": {**base, "variation": "", "line": "", "notes": [st.meta["description"]] if st.meta["description"] else []}})
    return steps


# ----------------------------------------------------------------------------- pont Godot (tout est tolérant : plateau absent = rien d'envoyé)
def _bridge():
    import nasko_chessbridge
    return nasko_chessbridge


def _gsend(obj):
    try:
        _bridge().send(obj)
    except Exception as e:                                               # noqa: BLE001
        log.debug("pont Godot : %s", e)


def _later(secs, fn, *a):
    t = threading.Timer(secs, fn, a)
    t.daemon = True
    t.start()


def hud():
    """Bandeau d'information du plateau Godot (nom, variante, mode, avancement)."""
    st = _S["st"]
    if st is None:
        return {"title": "", "variation": "", "mode": "", "step": "", "user": "w"}
    return {"title": st.meta["name"], "variation": st.variation_name(), "mode": st.mode, "step": f"{st.pi}/{len(st.plan)}" if st.mode == "demo" else "",
            "user": "b" if st.user == chess.BLACK else "w"}


def _push_hud(st):
    _gsend({"t": "study", "on": st is not None, **hud()})


def _push_marks(arrows, squares, secs=7.0, delay=0.9):
    """Flèches et cases surlignées, une fois le coup posé (l'animation d'un coup dure < 1 s)."""
    def go():
        if squares:
            _gsend({"t": "squares", "list": squares, "secs": secs})
        if arrows:
            _gsend({"t": "arrows", "list": arrows, "secs": secs})
    if arrows or squares:
        _later(delay, go)


# ----------------------------------------------------------------------------- session
_S = {"st": None}
EVENTS = []
_ev = {"n": 0}


def active():
    return _S["st"] is not None


def _need():
    st = _S["st"]
    if st is None:
        raise OpeningError("Aucune leçon en cours : choisissez une ouverture.")
    return st


def view():
    st = _S["st"]
    return st.view() if st else None


def _event(kind, **kw):
    with _lock:
        _ev["n"] += 1
        EVENTS.append({"n": _ev["n"], "kind": kind, **kw})
        del EVENTS[:-60]


def events(since=0):
    with _lock:
        return {"events": [e for e in EVENTS if e["n"] > int(since)], "last": _ev["n"]}


def start(oid, detail="key", voice=True):
    """Ouvre une leçon : plateau remis au départ, visage d'ETO, plan de démonstration construit. La démonstration démarre avec next_step()."""
    with _lock:
        st = Study(_entry(oid), detail, voice)
        st.mode = "demo"
        st.plan, st.pi = build_plan(st), 0
        _S["st"] = st
        EVENTS.clear()
        st.seq += 1
        st.arrows, st.squares = [], []
    try:
        _bridge().push_persona("eto")
    except Exception:                                                    # noqa: BLE001
        pass
    _gsend({"t": "state", "state": st.view()})
    _push_hud(st)
    return st.state()


def stop():
    with _lock:
        had = _S["st"] is not None
        _S["st"] = None
    if had:
        _gsend({"t": "study", "on": False})
        try:
            _bridge().restore()
        except Exception:                                                # noqa: BLE001
            pass
    return {"active": False}


def state():
    st = _S["st"]
    return st.state() if st else {"active": False, "openings": list_openings()}


# ----------------------------------------------------------------------------- voix d'ETO
_MEM = {}
_FLIGHT = {}


def speak(kind, ctx, ckey, voice=True):
    """Réplique d'ETO : LLM (cache), puis ElevenLabs (cache audio). Retourne {text, spoken, audio, tags, llm, notice}."""
    import nasko_cache
    import nasko_coach
    import nasko_eleven
    cfg = nasko_core.load_config()
    lang = nasko_core.language(cfg)
    key = hashlib.sha1("|".join(["study", STUDY_CACHE_VERSION, getattr(nasko_coach, "STUDY_VERSION", ""), lang, kind, ckey, json.dumps(ctx, sort_keys=True, ensure_ascii=False)]).encode()).hexdigest()[:24]
    with _lock:
        flight = _FLIGHT.setdefault(key, threading.Lock())          # une seule génération (LLM + voix) par réplique, même si le préchargement la demande en parallèle
    with flight:
        want_audio = voice and cfg.get("tts_dynamic", True) and nasko_eleven.configured(cfg, "eto")
        with _lock:
            mem = _MEM.get(key)
        if mem and (mem["audio"] or not want_audio):
            return dict(mem)
        hit = nasko_cache.get(key)
        if hit:
            spoken, shown, llm_ok = hit["spoken"], hit["shown"], True
        else:
            spoken, shown, llm_ok = nasko_coach.write_study(cfg, kind, ctx, lang)
            if llm_ok:
                nasko_cache.put(key, spoken, shown, nasko_persona.tags(spoken))
        audio, notice = None, ""
        if want_audio:
            name = nasko_cache.audio_for(key)
            if not name:
                try:
                    p = nasko_eleven.synthesize(spoken, cfg, "eto")
                    name = nasko_cache.store_audio(key, p) or os.path.splitext(os.path.basename(p))[0]
                except nasko_eleven.ElevenError as e:
                    notice = str(e)
                    log.warning("TTS étude : %s", e)
            audio = "/api/tts/" + name if name else None
        res = {"text": shown, "spoken": spoken, "audio": audio, "tags": nasko_persona.tags(spoken), "llm": llm_ok, "notice": notice}
        with _lock:
            if len(_MEM) > 300:
                _MEM.clear()
            _MEM[key] = res
        return dict(res)


def _show(res):
    """Sous-titre + visage d'ETO sur le plateau Godot (la voix est jouée par l'interface)."""
    if res and res.get("text"):
        try:
            import nasko_chess
            nasko_chess.TAGGED[res["text"]] = res["spoken"]
            _bridge().say(res["text"], "normal")
        except Exception:                                                # noqa: BLE001
            pass


_prefetching = set()


def _prefetch(st, upto=3):
    """Prépare en arrière-plan la prochaine réplique d'ETO (LLM + voix) pendant que la précédente est jouée."""
    for k in range(st.pi, min(len(st.plan), st.pi + upto + 3)):
        step = st.plan[k]
        if step.get("speak"):
            tag = (id(st), k)
            if tag in _prefetching:
                return
            _prefetching.add(tag)

            def run(step=step, voice=st.voice):
                try:
                    speak(step["speak"], step["ctx"], step["ckey"], voice)
                except Exception as e:                                   # noqa: BLE001
                    log.debug("préchargement : %s", e)
            threading.Thread(target=run, daemon=True, name="study-prefetch").start()
            return


# ----------------------------------------------------------------------------- démonstration
def _navigate(st, target):
    """Amène la position courante sur `target` (chemin) : recule (animé) jusqu'à l'ancêtre commun, puis avance (animé)."""
    while st.path and st.path != target[:len(st.path)]:
        _undo_one(st)
    for i in target[len(st.path):]:
        _play_idx(st, i)


def _undo_one(st):
    u = st.back()
    st.seq += 1
    _gsend({"t": "undo", "from": u["from"], "to": u["to"], "state": st.view(), "say": None})


def _play_idx(st, idx, marks=True):
    anim, kid = st.forward(idx)
    st.seq += 1
    _gsend({"t": "update", "steps": [anim], "state": st.view(), "say": None, "decision": None})
    ann = parse_comment(kid.comment)
    st.arrows, st.squares = ann["arrows"], ann["squares"]
    if marks:
        _push_marks(ann["arrows"], ann["squares"])
    return ann


def next_step():
    """Exécute l'étape suivante de la démonstration. Retourne {done, step, speech, state}. À la fin : ETO rend la main (mode pratique)."""
    with _lock:
        st = _need()
        if st.mode != "demo":
            raise OpeningError("La démonstration n'est pas en cours.")
        if st.pi >= len(st.plan):
            raise OpeningError("Démonstration terminée.")
        step = st.plan[st.pi]
        st.pi += 1
        speech_job = None
        info = {"type": step["type"]}
        if step["type"] == "play":
            if st.path != step["path"][:-1]:
                _navigate(st, step["path"][:-1])
            _play_idx(st, step["idx"])
            info.update(san=step["san"], ply=step["ply"], color=step["color"])
            _push_hud(st)
        elif step["type"] == "rewind":
            _navigate(st, step["to"])
            st.arrows, st.squares = [], []
            info.update(plies=step["plies"])
            _push_hud(st)
        elif step["type"] == "intro":
            st.arrows, st.squares = [], []
        if step.get("speak"):
            speech_job = (step["speak"], step["ctx"], step["ckey"])
        last = step["type"] == "end"
        voice = st.voice
    speech = None
    if speech_job:
        speech = speak(*speech_job, voice=voice)
        _show(speech)
    with _lock:
        st = _S["st"]
        if st is not None and not last:
            _prefetch(st)
    done = False
    if last:
        done = True
        begin_practice(announce=False)
    return {"done": done, "step": info, "speech": speech, "state": state()}


def set_options(detail=None, voice=None):
    with _lock:
        st = _need()
        if voice is not None:
            st.voice = bool(voice)
        if detail in ("full", "key") and detail != st.detail:
            st.detail = detail
            if st.mode == "demo":                                         # le plan est reconstruit ; on reprend à la position courante
                cur = list(st.path)
                st.plan = build_plan(st)
                st.pi = _resync(st, cur)
    return state()


def _resync(st, path):
    if not path:
        return 1
    for j in range(len(st.plan) - 1, -1, -1):
        s = st.plan[j]
        if s["type"] == "play" and s["path"] == path:
            return j + 1
    return 1


def restart_demo():
    with _lock:
        st = _need()
        st.mode = "demo"
        st.plan, st.pi, st.over = build_plan(st), 0, False
        st.path, st.arrows, st.squares = [], [], []
        st.seq += 1
    _gsend({"t": "state", "state": st.view()})
    _push_hud(st)
    return state()


# ----------------------------------------------------------------------------- exploration manuelle (Rewind, variantes)
def go_forward(idx=0):
    with _lock:
        st = _need()
        if st.mode == "practice":
            raise OpeningError("Pratique en cours : c'est à toi de jouer !")
        st.mode = "explore"
        _play_idx(st, int(idx))
        _push_hud(st)
    return state()


def go_back(plies=1):
    with _lock:
        st = _need()
        if st.mode == "practice":
            raise OpeningError("Pratique en cours : pas de retour en arrière.")
        st.mode = "explore"
        for _ in range(max(1, min(int(plies), len(st.path)))):
            _undo_one(st)
        st.arrows, st.squares = [], []
        _push_hud(st)
    return state()


def resume_demo():
    """Reprend la démonstration depuis la position courante (après une exploration manuelle)."""
    with _lock:
        st = _need()
        st.mode = "demo"
        st.pi = _resync(st, list(st.path))
        _push_hud(st)
    return state()


def explain_here():
    """ETO explique la position courante (note de référence du coup)."""
    with _lock:
        st = _need()
        node = st.node
        ann = parse_comment(node.comment) if node is not st.game else {"note": st.meta["description"], "name": ""}
        sans = st.san_list()
        last_white = (len(sans) % 2 == 1)
        played = f"{_side(last_white)} : {_say(sans[-1])}" if sans else ""
        c = {"opening": st.meta["name"], "color": st.meta["color"], "me_name": _side(st.user == chess.WHITE), "theory": st.meta["theory"],
             "variation": st.variation_name(), "line": st.line_words(), "played": played, "notes": [ann["note"]] if ann["note"] else []}
        ckey, voice = f"explain|{'.'.join(map(str, st.path))}", st.voice
    res = speak("move", c, ckey, voice)
    _show(res)
    return {"speech": res, "state": state()}


# ----------------------------------------------------------------------------- pratique : « à toi de jouer »
def _pick_reply(node):
    kids = node.variations
    if not kids:
        return None
    w = [3 if i == 0 else 1 for i in range(len(kids))]
    return random.choices(range(len(kids)), weights=w)[0]


def begin_practice(announce=True):
    """Plateau remis au départ : ETO rend la main. Si l'élève a les Noirs, l'adversaire simulé joue le premier coup."""
    with _lock:
        st = _need()
        st.mode, st.over, st.path, st.arrows, st.squares = "practice", False, [], [], []
        st.errors, st.ok_run, st.pi = 0, 0, len(st.plan)
        st.seq += 1
        _gsend({"t": "state", "state": st.view()})
        if st.user == chess.BLACK:
            _opponent_move(st, delay=0.7)
        _push_hud(st)
    return state()


def _opponent_move(st, delay=0.0):
    """Joue (et anime) la réponse de l'adversaire simulé ; retourne (san, say) ou None en fin de ligne."""
    node, board = st.node, st.board()
    idx = _pick_reply(node)
    if idx is None:
        return None
    san = board.san(node.variations[idx].move)
    kid = node.variations[idx]
    ann = parse_comment(kid.comment)
    anim = _anim(board, kid.move)
    st.path.append(idx)
    st.seq += 1
    st.arrows, st.squares = [], []
    msg = {"t": "update", "steps": [anim], "state": st.view(), "say": None, "decision": None}
    if delay:
        _later(delay, _gsend, msg)
    else:
        _gsend(msg)
    return {"san": san, "say": _say(san), "note": ann["note"]}


def user_move(uci, via="http", promotion=None):
    """Coup de l'élève (via='godot' : le plateau l'a déjà animé ; via='http' : plateau intégré)."""
    with _lock:
        st = _need()
        if st.mode != "practice":
            raise OpeningError("La pratique n'a pas commencé : regarde d'abord la démonstration.")
        if st.over:
            raise OpeningError("Ligne terminée : relance une ligne.")
        board = st.board()
        if board.turn != st.user:
            raise OpeningError("Ce n'est pas ton tour.")
        try:
            m = chess.Move.from_uci(uci)
        except ValueError:
            raise OpeningError("Coup invalide.")
        if m not in board.legal_moves:
            try:
                m = chess.Move.from_uci(uci + (promotion or "q"))
            except ValueError:
                raise OpeningError("Coup illégal.")
            if m not in board.legal_moves:
                raise OpeningError("Coup illégal.")
        node = st.node
        idx = next((i for i, k in enumerate(node.variations) if k.move == m), None)
        san = board.san(m)
        base = {"opening": st.meta["name"], "color": st.meta["color"], "me_name": _side(st.user == chess.WHITE), "theory": st.meta["theory"]}
        voice = st.voice
        if idx is None:                                                  # hors théorie : on annule, on montre le coup attendu
            st.errors += 1
            st.ok_run = 0
            exp = [(board.san(k.move), k.move) for k in node.variations]
            res = {"ok": False, "san": san, "expected": [e[0] for e in exp], "errors": st.errors}
            marks_a = [{"from": chess.square_name(mv.from_square), "to": chess.square_name(mv.to_square), "kind": "best"} for _, mv in exp][:3]
            marks_a.append({"from": chess.square_name(m.from_square), "to": chess.square_name(m.to_square), "kind": "threat"})
            marks_s = [{"sq": chess.square_name(mv.to_square), "kind": "good"} for _, mv in exp][:3] + [{"sq": chess.square_name(m.to_square), "kind": "bad"}]
            st.arrows, st.squares = marks_a, marks_s
            st.seq += 1
            if via == "godot":
                _gsend({"t": "undo", "from": chess.square_name(m.to_square), "to": chess.square_name(m.from_square), "state": st.view(), "say": None})
            _push_marks(marks_a, marks_s, secs=8.0, delay=0.7 if via == "godot" else 0.1)
            ctx = {**base, "variation": st.variation_name(), "line": st.line_words(), "student": _say(san), "expected": " ou ".join(_say(e[0]) for e in exp[:3]),
                   "notes": [parse_comment(k.comment)["note"] for k in node.variations if parse_comment(k.comment)["note"]][:2]}
            job = ("off", ctx, f"off|{'.'.join(map(str, st.path))}|{uci}")
        else:
            kid = node.variations[idx]
            ann = parse_comment(kid.comment)
            anim = _anim(board, kid.move)
            st.path.append(idx)
            steps = [anim]
            reply = None
            if st.node.variations:
                reply = _opponent_move_steps(st)
                if reply:
                    steps.append(reply["anim"])
            st.seq += 1
            st.arrows, st.squares = ann["arrows"], ann["squares"]
            _gsend({"t": "update", "steps": steps, "state": st.view(), "say": None, "decision": None})
            _push_marks(ann["arrows"], ann["squares"], delay=0.9 if via == "godot" else 1.4)
            finished = not st.node.variations
            if finished:
                st.over, st.lines_done = True, st.lines_done + 1
            st.ok_run += 1
            res = {"ok": True, "san": san, "reply": reply["san"] if reply else "", "finished": finished, "errors": st.errors}
            ctx = {**base, "variation": st.variation_name(), "line": st.line_words(), "student": _say(san), "reply": reply["say"] if reply else "",
                   "notes": [ann["note"]] if ann["note"] else [], "errors": st.errors}
            if finished:
                job = ("done", ctx, f"done|{'.'.join(map(str, st.path))}|{st.errors}")
            elif ann["note"] and st.ok_run % 2 == 1:                       # une réplique sur deux : la pratique doit rester fluide
                job = ("ok", ctx, f"ok|{'.'.join(map(str, st.path))}|{uci}")
            else:
                job = None
        _push_hud(st)
    speech = None
    if job:
        speech = speak(*job, voice=voice)
        _show(speech)
        if via == "godot":
            _event("say", speech=speech, result=res)
    elif via == "godot":
        _event("move", result=res)
    return {"result": res, "speech": speech, "state": state()}


def _opponent_move_steps(st):
    """Réponse de l'adversaire pour une mise à jour groupée (le coup de l'élève et la réponse partent dans le même message)."""
    node, board = st.node, st.board()
    idx = _pick_reply(node)
    if idx is None:
        return None
    kid = node.variations[idx]
    san = board.san(kid.move)
    anim = _anim(board, kid.move)
    st.path.append(idx)
    return {"san": san, "say": _say(san), "anim": anim}
