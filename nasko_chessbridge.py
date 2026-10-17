"""Pont WebSocket local entre le moteur d'échecs Python (règles, Stockfish) et le plateau Godot encastré.

  Godot → Python : {"t":"hello"} · {"t":"move","from":"e2","to":"e4","promo":"q"} · {"t":"ping"}
  Python → Godot : {"t":"state","state":{…}} (nouvelle partie / resynchronisation)
                   {"t":"update","steps":[{from,to,piece,capture,captured,extra,promo}…],"state":{…}} (animer puis caler)
                   {"t":"error","msg":"…"} · {"t":"idle"}

Sécurité : uniquement la boucle locale, aucun en-tête Origin (un navigateur ne peut pas s'y connecter), jeton aléatoire propre à la session
d'encastrement (transmis à Godot en argument de lancement). Le plateau ne fait que dessiner : Python reste seul juge de la légalité.
"""
import asyncio
import json
import secrets

from starlette.concurrency import run_in_threadpool

import nasko_chess
import nasko_persona
import opening_manager
import nasko_visualtheme

_tok = {"v": ""}
_conn = {"ws": None, "loop": None, "embedded": False}


def new_token():
    _tok["v"] = secrets.token_urlsafe(24)
    return _tok["v"]


def check_token(t):
    return bool(_tok["v"]) and secrets.compare_digest(str(t or ""), _tok["v"])


def connected():
    return _conn["ws"] is not None


def set_embedded(on):
    """Appelé par nasko_embed : la fenêtre Godot est rattachée à E.N.O.S. -> elle peut commencer à dessiner."""
    _conn["embedded"] = bool(on)
    if on:
        _send({"t": "embedded"})


def say(text, kind="normal"):
    """Sous-titre d'E.N.O.S. / ETO dans le plateau Godot (appelé quand la voix démarre). `tags` : balises audio d'ETO, jouées par son visage."""
    _send({"t": "say", "text": text, "kind": kind, "tags": nasko_persona.tags(nasko_chess.spoken_for(text))})


def arrows(lst, secs=7.0):
    """Flèches pédagogiques sur le plateau Godot (meilleur coup « best », menace « threat », coup qui punit « punish »), le temps de l'explication d'ETO."""
    if lst:
        _send({"t": "arrows", "list": lst, "secs": secs})


def push_persona(p=None):
    """Bascule le plateau Godot : œil rouge + thème noir (E.N.O.S.) ou visage blanc + thème clair (ETO)."""
    _send({"t": "persona", "p": p or nasko_persona.current()})


def send(obj):
    """Message libre vers le plateau Godot (mode apprentissage : état, animation, retour en arrière, cases surlignées…)."""
    _send(obj)


def restore():
    """Fin du mode apprentissage : le plateau retrouve la partie en cours (ou se vide) et la personnalité active."""
    st = nasko_chess.current()
    _send({"t": "state", "state": nasko_chess.view()} if st.get("active") else {"t": "idle"})
    push_persona()


def _send(obj):
    ws, loop = _conn["ws"], _conn["loop"]
    if ws and loop:
        asyncio.run_coroutine_threadsafe(ws.send_text(json.dumps(obj, ensure_ascii=False)), loop)


def _on_event(kind, payload):
    if kind == "new":
        _send({"t": "state", "state": payload})
    elif kind == "update":
        _send({"t": "update", "steps": payload["steps"], "state": payload["view"], "say": payload.get("say"), "decision": payload.get("decision")})
    elif kind == "undo":
        _send({"t": "undo", "from": payload["from"], "to": payload["to"], "state": payload["view"], "say": payload.get("say")})
    elif kind == "theme":
        _send({"t": "theme", "name": payload})
    elif kind == "boss":                                              # Stockfish annonce son prochain coup (logo + flèche), puis boss_end quand il le joue
        _send({"t": "boss", "text": payload["text"], "from": payload["from"], "to": payload["to"]})
    elif kind == "boss_end":
        _send({"t": "boss_end"})
    elif kind == "board":                                             # plateau à couleurs unies (chaîne vide = plateau du thème)
        _send({"t": "board", "name": payload})
    elif kind == "visual":                                            # thème visuel généré par E.N.O.S. (cfg vide = retour au rendu d'origine)
        _send({"t": "visual", "cfg": payload["cfg"], "secs": payload.get("secs", 1.4)})
    elif kind == "visual_mood":                                       # colère 0..1 : yeux des cavaliers rouge intense
        _send({"t": "visual_mood", "anger": payload})
    elif kind == "brilliant":                                       # coup brillant (!!) : secousse, onde dorée, son ; la flèche dorée et le « !! » arrivent avec le commentaire
        _send({"t": "brilliant", "from": payload["from"], "to": payload["to"]})


nasko_chess.LISTENERS.append(_on_event)


async def handle(ws):
    """Boucle d'une connexion Godot (authentification déjà faite par SecurityMiddleware)."""
    await ws.accept()
    _conn["ws"], _conn["loop"] = ws, asyncio.get_running_loop()
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > 2048:
                break
            try:
                m = json.loads(raw)
            except ValueError:
                continue
            t = m.get("t")
            if t == "hello":
                await ws.send_text(json.dumps({"t": "theme", "name": nasko_chess.get_theme()}))
                await ws.send_text(json.dumps({"t": "board", "name": nasko_chess.get_board()}))
                await ws.send_text(json.dumps({"t": "persona", "p": nasko_persona.current()}))
                vis = nasko_visualtheme.current()
                if vis:                                                # le thème choisi survit aux redémarrages / reconnexions de Godot
                    await ws.send_text(json.dumps({"t": "visual", "cfg": vis, "secs": 0}))
                if _conn["embedded"]:
                    await ws.send_text('{"t":"embedded"}')
                if opening_manager.active():                           # leçon d'ouverture en cours : le plateau reprend exactement là où elle en est
                    await ws.send_text(json.dumps({"t": "persona", "p": "eto"}))
                    await ws.send_text(json.dumps({"t": "state", "state": opening_manager.view()}))
                    await ws.send_text(json.dumps({"t": "study", "on": True, **opening_manager.hud()}))
                else:
                    st = nasko_chess.current()
                    await ws.send_text(json.dumps({"t": "state", "state": nasko_chess.view()} if st.get("active") else {"t": "idle"}))
            elif t == "move":
                uci = f"{m.get('from', '')}{m.get('to', '')}"
                try:
                    if opening_manager.active():                           # pratique d'une ouverture : le coup est comparé à l'arbre PGN
                        await run_in_threadpool(opening_manager.user_move, uci, "godot", m.get("promo") or None)
                    else:
                        await run_in_threadpool(nasko_chess.move, uci, m.get("promo") or None)
                except (nasko_chess.ChessError, opening_manager.OpeningError) as e:
                    await ws.send_text(json.dumps({"t": "error", "msg": str(e)}))
            elif t == "decision":
                try:
                    await run_in_threadpool(nasko_chess.decide, "takeback" if m.get("choice") == "takeback" else "continue")
                except nasko_chess.ChessError as e:
                    await ws.send_text(json.dumps({"t": "error", "msg": str(e)}))
            elif t == "ping":
                await ws.send_text('{"t":"pong"}')
    except Exception:                                                  # déconnexion : le jeu reste en mémoire, Godot pourra se reconnecter
        pass
    finally:
        if _conn["ws"] is ws:
            _conn["ws"] = None
