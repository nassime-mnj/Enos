"""Assistant stratégique League of Legends : conseils de l'Œil d'E.N.O.S. à partir d'une CAPTURE D'ÉCRAN (vision par ordinateur).

CONFORMITÉ RIOT (même principe que Blitz.gg ou Porofessor) : ce module est 100 % LECTURE SEULE.
  * il ne fait QUE regarder les pixels de l'écran (mss, repli PIL) : aucune lecture de la mémoire du jeu, aucune injection, aucun hook, aucun appel à l'API interne du client ;
  * il n'envoie AUCUNE touche et AUCUN clic : le joueur décide et joue seul (pas de bot, pas d'automatisation) ;
  * il ne capture et n'envoie rien tant que le processus « League of Legends.exe » n'est pas lancé (vie privée) ;
  * la capture est réduite (≤ 1280 px) et envoyée au seul LLM de vision déjà configuré par l'utilisateur ; rien n'est gardé sur disque.
Boucle : capture toutes les N secondes (≥ 10) -> écran inchangé = pas d'appel -> LLM de vision (position sur la minimap, or, objets, danger) -> UN conseil court ->
bulle de texte de l'Œil (mode silencieux) ou voix + bulle (mode voix), via nasko_pet. Pas de répétition du même conseil, au plus un conseil toutes les 25 s."""
import io
import json
import logging
import re
import threading
import time

import nasko_core

log = logging.getLogger("nasko.lol")

PROCESS_NAMES = ("league of legends.exe", "leagueclient.exe")      # le client seul ne suffit pas : on attend la partie
GAME_PROCESS = "league of legends.exe"
MIN_INTERVAL, DEFAULT_INTERVAL = 10, 20
ADVICE_GAP_S, REPEAT_S = 25, 120
MAX_W, QUALITY = 1280, 62
MODES = ("text", "voice")                                           # text : bulle silencieuse · voice : voix + bulle

_lock = threading.RLock()
S = {"running": False, "stop": False, "thread": None, "last_advice": "", "last_ctx": {}, "frames": 0, "calls": 0, "error": "", "waiting": False, "t_advice": 0.0, "seen": {}}

SYSTEM = ("Tu es un coach de League of Legends. On te montre UNE capture d'écran d'une partie. Réponds UNIQUEMENT par un objet JSON, sans texte autour : "
          '{"in_game": true|false, "phase": "laning|teamfight|objectif|fin", "minimap": "où est le joueur sur la minimap (ex. bas-gauche, rivière, base) et menaces visibles", '
          '"gold": <or disponible, entier ou null>, "items": ["objets visibles dans l\'inventaire"], "can_buy": true|false, "hp_low": true|false, '
          '"advice": "UN conseil actionnable de 12 mots maximum, en français, ou chaîne vide s\'il n\'y a rien d\'utile", "urgency": 0-3}. '
          "Si l'image n'est pas une partie en cours, mets in_game à false et advice vide. N'invente pas ce que tu ne vois pas. "
          "Ne conseille JAMAIS d'automatiser, de scripter ou de tricher : seulement des décisions que le joueur prend lui-même.")


# ----------------------------------------------------------------------------- configuration
def config(cfg=None):
    cfg = cfg if cfg is not None else nasko_core.load_config()
    mode = cfg.get("lol_mode", "text")
    return {"enabled": bool(cfg.get("lol_enabled", False)), "mode": mode if mode in MODES else "text",
            "interval": max(MIN_INTERVAL, min(120, int(cfg.get("lol_interval", DEFAULT_INTERVAL) or DEFAULT_INTERVAL))), "need_game": bool(cfg.get("lol_need_game", True))}


def set_config(new):
    """Enregistre le réglage ; le mode pilote aussi les options de l'Œil : text = bulle seule, voice = voix + bulle."""
    patch = {}
    if "enabled" in new:
        patch["lol_enabled"] = bool(new["enabled"])
    if new.get("mode") in MODES:
        patch["lol_mode"] = new["mode"]
    if "interval" in new:
        patch["lol_interval"] = max(MIN_INTERVAL, min(120, int(new["interval"])))
    if "need_game" in new:
        patch["lol_need_game"] = bool(new["need_game"])
    if patch:
        nasko_core.update_config(patch)
    if patch.get("lol_mode"):
        try:
            import nasko_pet
            nasko_pet.set_options({"pet_voice": patch["lol_mode"] == "voice", "pet_bubble": True})
        except Exception:                                                    # noqa: BLE001 — l'Œil n'est peut-être pas lancé
            log.info("LoL : options de l'Œil non appliquées", exc_info=True)
    c = config()
    if "enabled" in patch:
        start() if c["enabled"] else stop()
    return status()


# ----------------------------------------------------------------------------- état et détection de la partie
def game_running():
    try:
        import psutil
        return any((p.info.get("name") or "").lower() == GAME_PROCESS for p in psutil.process_iter(["name"]))
    except Exception:                                                        # noqa: BLE001
        return False


def status():
    with _lock:
        c = config()
        return {**c, "running": S["running"], "waiting": S["waiting"], "last_advice": S["last_advice"], "context": dict(S["last_ctx"]), "frames": S["frames"], "calls": S["calls"],
                "error": S["error"], "game": game_running(), "read_only": True}


# ----------------------------------------------------------------------------- capture (lecture seule)
def grab():
    """Image PIL de l'écran principal. mss (léger, sans effet sur les FPS) sinon PIL.ImageGrab. Aucune autre source."""
    from PIL import Image
    try:
        import mss
        with mss.mss() as sct:
            shot = sct.grab(sct.monitors[1])
            return Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
    except ImportError:
        from PIL import ImageGrab
        return ImageGrab.grab().convert("RGB")


def encode(img):
    from PIL import Image
    if img.width > MAX_W:
        img = img.resize((MAX_W, max(1, round(img.height * MAX_W / img.width))), Image.BILINEAR)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=QUALITY)
    return buf.getvalue()


def _signature(img):
    """Empreinte minuscule de l'image : écran inchangé = aucun appel au LLM."""
    return list(img.convert("L").resize((16, 9)).getdata())


def _changed(a, b, thr=6.0):
    return a is None or sum(abs(x - y) for x, y in zip(a, b)) / len(a) > thr


# ----------------------------------------------------------------------------- vision -> conseil
def _json_obj(text):
    m = re.search(r"\{.*\}", text or "", re.S)
    try:
        return json.loads(m.group(0)) if m else {}
    except ValueError:
        return {}


def analyse(jpeg_bytes, cfg=None, vision=None):
    """-> contexte {in_game, phase, minimap, gold, items, can_buy, hp_low, advice, urgency}. `vision` injectable pour les tests."""
    import nasko_llm
    cfg = cfg if cfg is not None else nasko_core.load_config()
    raw = (vision or nasko_llm.vision_raw)(cfg, SYSTEM, "Analyse cette capture de partie.", jpeg_bytes, 400)
    d = _json_obj(raw)
    adv = re.sub(r"\s+", " ", str(d.get("advice") or "")).strip()[:140]
    try:
        gold = int(d["gold"]) if d.get("gold") not in (None, "") else None
    except (ValueError, TypeError):
        gold = None
    return {"in_game": bool(d.get("in_game")), "phase": str(d.get("phase") or "")[:20], "minimap": str(d.get("minimap") or "")[:160], "gold": gold,
            "items": [str(x)[:30] for x in (d.get("items") or [])][:8], "can_buy": bool(d.get("can_buy")), "hp_low": bool(d.get("hp_low")), "advice": adv,
            "urgency": max(0, min(3, int(d.get("urgency") or 0))) if str(d.get("urgency") or "0").isdigit() else 0}


def deliver(ctx, now=None, say=None):
    """Décide si le conseil est montré : partie en cours, non vide, pas de répétition (2 min), au plus un toutes les 25 s (sauf urgence 3). -> True si affiché."""
    now = now if now is not None else time.time()
    adv = ctx.get("advice", "")
    if not ctx.get("in_game") or not adv:
        return False
    key = re.sub(r"\W+", " ", adv.lower()).strip()
    with _lock:
        if now - S["seen"].get(key, 0) < REPEAT_S:
            return False
        if now - S["t_advice"] < ADVICE_GAP_S and ctx.get("urgency", 0) < 3:
            return False
        S["seen"][key] = now
        S["seen"] = {k: t for k, t in S["seen"].items() if now - t < REPEAT_S}
        S["t_advice"], S["last_advice"] = now, adv
    if say is None:
        import nasko_pet
        say = nasko_pet.comment
    return bool(say(adv))


def step(prev_sig=None, grab_fn=None, vision=None, say=None, force=False):
    """Un tour de boucle : (signature, contexte | None). `force` : ignore le test « partie lancée » (tests, bouton ANALYSER MAINTENANT)."""
    c = config()
    if not force and c["need_game"] and not game_running():
        with _lock:
            S["waiting"] = True
        return prev_sig, None
    with _lock:
        S["waiting"] = False
    img = (grab_fn or grab)()
    sig = _signature(img)
    with _lock:
        S["frames"] += 1
    if not force and not _changed(prev_sig, sig):
        return sig, None
    jpg = encode(img)
    with _lock:
        S["calls"] += 1
    ctx = analyse(jpg, vision=vision)
    with _lock:
        S["last_ctx"] = {k: ctx[k] for k in ("phase", "minimap", "gold", "items", "can_buy", "hp_low")}
        S["error"] = ""
    deliver(ctx, say=say)
    return sig, ctx


# ----------------------------------------------------------------------------- boucle
def _loop():
    sig = None
    try:
        while not S["stop"]:
            try:
                sig, _ = step(sig)
            except Exception as e:                                           # noqa: BLE001 — une erreur de vision ne tue pas la boucle
                with _lock:
                    S["error"] = f"{e.__class__.__name__}: {str(e)[:140]}"
                log.info("LoL : tour en échec : %s", e)
            t = time.time() + config()["interval"]
            while time.time() < t and not S["stop"]:
                time.sleep(0.25)
    finally:
        with _lock:
            S.update(running=False, stop=False, waiting=False)


def start():
    with _lock:
        if S["running"]:
            return status()
        S.update(running=True, stop=False, error="")
        t = threading.Thread(target=_loop, daemon=True, name="lol-vision")
        S["thread"] = t
        t.start()
    return status()


def stop(wait=False):
    with _lock:
        t = S["thread"] if S["running"] else None
        if t:
            S["stop"] = True
    if wait and t:
        t.join(timeout=5)
    return status()


def autostart_if_enabled():
    try:
        if config()["enabled"]:
            start()
    except Exception:                                                        # noqa: BLE001
        log.info("LoL : démarrage automatique impossible", exc_info=True)
