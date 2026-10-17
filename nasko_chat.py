"""Chat développeurs E.N.O.S. : concentrateur (hub) de messages texte, historique persistant, pont WebSocket vers le PC de l'associé.

- Les navigateurs/fenêtres se connectent à /ws/chat (clé ou ticket + origine vérifiés par le middleware).
- Le PONT (`bridge`) est un client WebSocket sortant vers le /ws/chat du PC de l'associé : les messages circulent dans les deux sens.
  Il suffit de le configurer d'UN côté. Jeton du pair chiffré DPAPI, certificat épinglé (empreinte SHA-256, mémorisée à la 1re connexion).
- Dédoublonnage par identifiant de message : aucune boucle possible, même si les deux côtés sont configurés.
"""
import asyncio
import hashlib
import json
import os
import ssl
import threading
import time
import uuid
from collections import deque

from nasko_core import data_dir

MAX_LEN = 4000
KEEP = 500
_lock = threading.RLock()
_clients = []                       # [(websocket, loop)]
_seen = deque(maxlen=2000)
_seen_set = set()
_bridge = {"thread": None, "stop": None, "state": "off", "detail": "", "loop": None, "ws": None, "peer": ""}
_relay = {"thread": None, "stop": None, "state": "off", "root": "", "me": "", "peers": {}}


def _hist_file():
    return os.path.join(data_dir(), "devchat.jsonl")


def history(limit=200, after=0.0):
    out = []
    try:
        with open(_hist_file(), encoding="utf-8") as f:
            for line in f:
                try:
                    m = json.loads(line)
                except ValueError:
                    continue
                if m.get("t", 0) > after:
                    out.append(m)
    except OSError:
        pass
    return out[-limit:]


def _remember(m):
    with _lock:
        if m["id"] in _seen_set:
            return False
        if len(_seen) == _seen.maxlen:
            _seen_set.discard(_seen[0])
        _seen.append(m["id"])
        _seen_set.add(m["id"])
        try:
            with open(_hist_file(), "a", encoding="utf-8") as f:
                f.write(json.dumps(m, ensure_ascii=False) + "\n")
        except OSError:
            pass
        return True


def trim():
    """Garde les KEEP derniers messages (appelé au démarrage)."""
    try:
        with open(_hist_file(), encoding="utf-8") as f:
            lines = f.readlines()
        if len(lines) > KEEP * 2:
            with open(_hist_file(), "w", encoding="utf-8") as f:
                f.writelines(lines[-KEEP:])
    except OSError:
        pass


def prime_seen():
    for m in history(KEEP):
        _seen.append(m["id"])
        _seen_set.add(m["id"])


def clean(m):
    """Message externe -> message sûr (types, longueurs). None si invalide."""
    if not isinstance(m, dict):
        return None
    text = str(m.get("text", "")).replace("\0", "").strip()[:MAX_LEN]
    if not text:
        return None
    mid = str(m.get("id") or "")
    if not (8 <= len(mid) <= 40 and mid.replace("-", "").isalnum()):
        mid = uuid.uuid4().hex
    try:
        t = float(m.get("t") or time.time())
    except (TypeError, ValueError):
        t = time.time()
    if abs(t - time.time()) > 86400:
        t = time.time()
    return {"id": mid, "t": t, "from": str(m.get("from", "?"))[:40], "label": str(m.get("label", "?"))[:40], "text": text}


def make(sender, label, text):
    return clean({"id": uuid.uuid4().hex, "t": time.time(), "from": sender, "label": label, "text": text})


# ----------------------------------------------------------------------------- clients locaux (navigateurs / fenêtre)
def add_client(ws, loop):
    with _lock:
        _clients.append((ws, loop))
    presence()


def remove_client(ws):
    with _lock:
        _clients[:] = [c for c in _clients if c[0] is not ws]
    presence()


def _push(frame):
    data = json.dumps(frame, ensure_ascii=False)
    with _lock:
        targets = list(_clients)
    for ws, loop in targets:
        try:
            asyncio.run_coroutine_threadsafe(ws.send_text(data), loop)
        except Exception:
            pass


def presence():
    _push({"type": "presence", "n": len(_clients), "peer": _bridge["state"]})


def post(m, relay=False):
    """Enregistre + diffuse un message. relay=True : il vient du pair, on ne le lui renvoie pas. Retourne False si déjà connu."""
    m = clean(m)
    if not m or not _remember(m):
        return False
    _push({"type": "msg", "msg": m})
    if not relay:
        _to_peer(m)
        _to_folder(m)
    return True


# ----------------------------------------------------------------------------- CANAL : connexion directe + relais par dossier partagé
# « Ouvrir le canal » = aucun réglage : chaque PC publie une fiche (adresses, jeton de canal, empreinte du certificat) dans SON dossier de
# l'entrepôt partagé ; l'autre PC la lit et se connecte tout seul. Deux voies en parallèle, dédoublonnées par identifiant de message :
#   1. liaison directe WebSocket (instantanée, même réseau local / VPN) avec le jeton de canal (limité au chat, jamais la clé d'administration) ;
#   2. relais par fichier dans le dossier partagé (OneDrive…) : fonctionne à distance, quelques secondes de latence.
def _chan_file():
    return os.path.join(data_dir(), "enos_channel.bin")


def channel_token():
    """Jeton de canal : 256 bits aléatoires, chiffré DPAPI, ne donne accès qu'à /ws/chat."""
    import nasko_security as sec
    try:
        with open(_chan_file(), "rb") as f:
            return sec._dpapi(f.read(), False).decode()
    except (OSError, ValueError):
        pass
    import secrets
    t = secrets.token_urlsafe(32)
    with open(_chan_file(), "wb") as f:
        f.write(sec._dpapi(t.encode(), True))
    return t


def check_channel(given):
    import hmac
    try:
        return bool(given) and hmac.compare_digest(given.encode(), channel_token().encode())
    except Exception:
        return False


def bridge_status():
    return {"state": _bridge["state"], "detail": _bridge["detail"], "peer": _bridge["peer"]}


def _to_peer(m):
    loop, ws = _bridge.get("loop"), _bridge.get("ws")
    if loop and ws and _bridge["state"] == "on":
        try:
            asyncio.run_coroutine_threadsafe(ws.send(json.dumps({"type": "msg", "msg": m}, ensure_ascii=False)), loop)
        except Exception:
            pass


async def _bridge_main(get_target, stop):
    """get_target() -> {urls:[...], token, fp, peer} relu à CHAQUE tentative (l'adresse de l'associé peut changer)."""
    import websockets
    backoff = 2
    while not stop.is_set():
        tg = None
        try:
            tg = get_target()
        except Exception:
            tg = None
        if not tg or not tg.get("urls"):
            _bridge.update(state="connecting", detail="en attente de la fiche de l'associé", ws=None, loop=None)
        else:
            for url in tg["urls"]:
                if stop.is_set():
                    break
                try:
                    ctx = ssl.create_default_context()
                    ctx.check_hostname = False
                    ctx.verify_mode = ssl.CERT_NONE                       # authenticité = empreinte du certificat contrôlée ci-dessous
                    kw = {"ssl": ctx} if url.startswith("wss://") else {}
                    _bridge.update(state="connecting", detail=url.split("//")[-1].split("/")[0], peer=tg.get("peer", ""))
                    async with websockets.connect(url, additional_headers={"X-Enos-Channel": tg["token"]}, open_timeout=4, max_size=64 * 1024, **kw) as ws:
                        if url.startswith("wss://"):
                            der = ws.transport.get_extra_info("ssl_object").getpeercert(binary_form=True)
                            fp = hashlib.sha256(der).hexdigest()
                            want = (tg.get("fp") or "").replace(":", "").lower()
                            if want and fp != want:
                                _bridge.update(state="error", detail="Certificat inattendu : connexion refusée (possible interception).")
                                await ws.close()
                                continue
                        _bridge.update(state="on", detail="liaison directe", ws=ws, loop=asyncio.get_running_loop())
                        backoff = 2
                        presence()
                        async for raw in ws:
                            try:
                                fr = json.loads(raw)
                            except ValueError:
                                continue
                            if fr.get("type") == "msg":
                                post(fr.get("msg"), relay=True)
                except asyncio.CancelledError:
                    raise
                except Exception as e:                                    # noqa: BLE001
                    _bridge.update(state="connecting", detail=(str(e) or type(e).__name__)[:120])
                _bridge.update(ws=None, loop=None)
                presence()
        for _ in range(backoff * 2):
            if stop.is_set():
                break
            await asyncio.sleep(0.5)
        backoff = min(backoff * 2, 20)
    _bridge.update(state="off", detail="", ws=None, loop=None)


def start_bridge(get_target):
    stop_bridge()
    stop = threading.Event()
    _bridge["stop"] = stop
    t = threading.Thread(target=lambda: asyncio.run(_bridge_main(get_target, stop)), daemon=True, name="enos-chat-bridge")
    _bridge["thread"] = t
    t.start()


def stop_bridge():
    s = _bridge.get("stop")
    if s:
        s.set()
    _bridge.update(state="off", detail="", ws=None, loop=None, stop=None, thread=None, peer="")


# ----------------------------------------------------------------------------- relais par dossier partagé
def _my_log():
    return os.path.join(_relay["root"], _relay["me"], "chat.jsonl") if _relay["root"] else ""


def _to_folder(m):
    p = _my_log()
    if not p or _relay["state"] != "on":
        return
    try:
        with _lock, open(p, "a", encoding="utf-8") as f:
            f.write(json.dumps(m, ensure_ascii=False) + "\n")
        if os.path.getsize(p) > 1_000_000:                              # le fichier ne grossit pas indéfiniment
            with open(p, encoding="utf-8") as f:
                keep = f.readlines()[-300:]
            with open(p, "w", encoding="utf-8") as f:
                f.writelines(keep)
    except OSError:
        pass


def _relay_loop(stop):
    root, me = _relay["root"], _relay["me"]
    while not stop.is_set():
        try:
            for peer in os.listdir(root):
                pd = os.path.join(root, peer)
                if peer == me or peer.startswith(("_", ".")) or not os.path.isdir(pd):
                    continue
                f = os.path.join(pd, "chat.jsonl")
                try:
                    size = os.path.getsize(f)
                except OSError:
                    continue
                off = _relay["peers"].get(peer, 0)
                if size < off:
                    off = 0                                              # fichier réduit par l'autre côté : relecture (dédoublonnée)
                if size > off:
                    with open(f, "rb") as fh:
                        fh.seek(off)
                        chunk = fh.read(size - off)
                    cut = chunk.rfind(b"\n") + 1                         # uniquement des lignes complètes (synchro en cours)
                    for line in chunk[:cut].decode("utf-8", "replace").splitlines():
                        try:
                            post(json.loads(line), relay=True)
                        except ValueError:
                            pass
                    _relay["peers"][peer] = off + cut
        except OSError:
            pass
        stop.wait(2.5)
    _relay["state"] = "off"


def start_relay(root, me):
    stop_relay()
    os.makedirs(os.path.join(root, me), exist_ok=True)
    stop = threading.Event()
    _relay.update(root=root, me=me, stop=stop, state="on", peers={})
    t = threading.Thread(target=_relay_loop, args=(stop,), daemon=True, name="enos-chat-relay")
    _relay["thread"] = t
    t.start()


def stop_relay():
    s = _relay.get("stop")
    if s:
        s.set()
    _relay.update(state="off", stop=None, thread=None)


def relay_status():
    return {"state": _relay["state"]}
