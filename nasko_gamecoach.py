"""COPILOTE DE JEU : l'Œil d'E.N.O.S. regarde ton écran PENDANT que tu joues et te souffle UN conseil court, en temps réel — à n'importe quel jeu.

Généralise l'assistant League of Legends (nasko_lol) : tu donnes le nom du jeu (et, si tu veux, ton objectif : « je veux progresser sur le placement »),
l'Œil capture l'écran (ou seulement la fenêtre active), compare avec l'image précédente (écran inchangé = aucun appel), envoie une capture réduite au LLM de vision déjà
configuré, et affiche / dit un conseil de 14 mots maximum. Il se souvient de ce qu'il a déjà dit (pas de répétition) et de ce qui se passait à l'image précédente.

CONFORMITÉ (même principe que Blitz.gg / Porofessor) : 100 % LECTURE SEULE. Aucune lecture de la mémoire du jeu, aucune injection, aucun hook, aucune touche ni clic envoyé :
c'est toi qui joues. Rien n'est capturé tant que le copilote est désactivé, en pause, ou (réglage « attendre le jeu ») que le processus du jeu n'est pas lancé. La capture
(≤ 1280 px, JPEG) part vers TON LLM de vision seulement et n'est jamais gardée sur disque. Respecte les règles du jeu : dans un jeu compétitif qui interdit toute aide
extérieure, désactive le copilote.

Temps réel : une analyse toutes les N secondes (3 à 120, défaut 6) ; le délai réel dépend de la latence du modèle de vision (≈ 1 à 3 s)."""
import json
import logging
import re
import threading
import time

import nasko_core
import nasko_lol

log = logging.getLogger("nasko.gamecoach")

MIN_INTERVAL, DEFAULT_INTERVAL = 3, 6
ADVICE_GAP_S, REPEAT_S = 8, 90
MODES = ("text", "voice")
FOCUS = ("screen", "window")                                         # tout l'écran principal / la fenêtre au premier plan (Windows)

PRESETS = {                                                          # nom -> (consigne spécifique, noms de processus pour « attendre le jeu »)
    "lol": ("League of Legends : minimap, or disponible, objets, vague de sbires, danger, objectifs (dragon, Nashor).", ("league of legends.exe",)),
    "valorant": ("Valorant : économie (crédits), position sur la minimap, utilitaires/capacités disponibles, bombe, rotation.", ("valorant-win64-shipping.exe", "valorant.exe")),
    "fps": ("jeu de tir : munitions, vie, position, couverture, danger visible, radar.", ()),
    "echecs": ("échecs : lis la position, signale la menace ou la tactique principale (fourchette, clouage, pièce en prise, échec). N'invente JAMAIS un coup précis dont tu n'es pas sûr : "
               "dis plutôt l'idée (pièce menacée, case faible, plan).", ()),
    "autre": ("", ()),
}


def _preset(game):
    g = (game or "").lower()
    if re.search(r"league|lol", g):
        return "lol"
    if "valorant" in g:
        return "valorant"
    if re.search(r"[eé]checs|chess|lichess", g):
        return "echecs"
    if re.search(r"cs ?2|csgo|counter|apex|overwatch|fortnite|call of duty|warzone|rainbow", g):
        return "fps"
    return "autre"


_lock = threading.RLock()
S = {"running": False, "stop": False, "thread": None, "paused": False, "last_advice": "", "summary": "", "frames": 0, "calls": 0, "error": "", "waiting": False,
     "t_advice": 0.0, "seen": {}, "history": [], "latency": 0.0}


# ----------------------------------------------------------------------------- configuration
def config(cfg=None):
    cfg = cfg if cfg is not None else nasko_core.load_config()
    mode, focus = cfg.get("gc_mode", "text"), cfg.get("gc_focus", "screen")
    return {"enabled": bool(cfg.get("gc_enabled", False)), "game": str(cfg.get("gc_game", "") or "")[:60], "goal": str(cfg.get("gc_goal", "") or "")[:200],
            "mode": mode if mode in MODES else "text", "focus": focus if focus in FOCUS else "screen",
            "interval": max(MIN_INTERVAL, min(120, int(cfg.get("gc_interval", DEFAULT_INTERVAL) or DEFAULT_INTERVAL))),
            "process": str(cfg.get("gc_process", "") or "").strip().lower()[:80], "need_game": bool(cfg.get("gc_need_game", False)), "alerts_only": bool(cfg.get("gc_alerts_only", False))}


def set_config(new):
    patch = {}
    for k, ck in (("enabled", "gc_enabled"), ("need_game", "gc_need_game"), ("alerts_only", "gc_alerts_only")):
        if k in new:
            patch[ck] = bool(new[k])
    if "game" in new:
        patch["gc_game"] = str(new["game"])[:60]
    if "goal" in new:
        patch["gc_goal"] = str(new["goal"])[:200]
    if "process" in new:
        patch["gc_process"] = str(new["process"]).strip().lower()[:80]
    if new.get("mode") in MODES:
        patch["gc_mode"] = new["mode"]
    if new.get("focus") in FOCUS:
        patch["gc_focus"] = new["focus"]
    if "interval" in new:
        patch["gc_interval"] = max(MIN_INTERVAL, min(120, int(new["interval"])))
    if patch:
        nasko_core.update_config(patch)
    if patch.get("gc_mode"):
        try:
            import nasko_pet
            nasko_pet.set_options({"pet_voice": patch["gc_mode"] == "voice", "pet_bubble": True})
        except Exception:                                                # noqa: BLE001
            log.info("Copilote : options de l'Œil non appliquées", exc_info=True)
    if "gc_enabled" in patch:
        with _lock:
            S["paused"] = False
        start() if config()["enabled"] else stop()
    return status()


def pause(on):
    with _lock:
        S["paused"] = bool(on)
    return status()


# ----------------------------------------------------------------------------- détection du jeu
def _procs():
    try:
        import psutil
        return {(p.info.get("name") or "").lower() for p in psutil.process_iter(["name"])}
    except Exception:                                                    # noqa: BLE001
        return set()


def game_running(c=None):
    c = c or config()
    names = set(PRESETS[_preset(c["game"])][1])
    if c["process"]:
        names.add(c["process"] if c["process"].endswith(".exe") else c["process"] + ".exe")
        names.add(c["process"])
    if not names:
        return True                                                      # aucun processus connu : on ne peut pas savoir -> considéré comme lancé
    return bool(_procs() & names)


def status():
    with _lock:
        c = config()
        return {**c, "running": S["running"], "paused": S["paused"], "waiting": S["waiting"], "last_advice": S["last_advice"], "summary": S["summary"], "frames": S["frames"],
                "calls": S["calls"], "error": S["error"], "latency": round(S["latency"], 1), "history": list(S["history"][-12:]), "preset": _preset(c["game"]), "read_only": True}


# ----------------------------------------------------------------------------- capture (lecture seule)
def grab(focus="screen"):
    """Image PIL : fenêtre au premier plan (si demandé et possible) sinon écran principal. Réutilise la capture de l'assistant LoL (mss / ImageGrab)."""
    img = nasko_lol.grab()
    if focus == "window":
        try:
            import nasko_capture
            r = nasko_capture._foreground_rect()
            if r:
                l, t, rr, b = r
                if rr - l > 64 and b - t > 64 and (rr - l) * (b - t) < img.width * img.height * 0.98:
                    return img.crop((l, t, min(rr, img.width), min(b, img.height)))
        except Exception:                                                # noqa: BLE001
            pass
    return img


# ----------------------------------------------------------------------------- vision -> conseil
def _vision():
    import nasko_llm                                                 # import tardif : le module du LLM tire toute l'application
    return nasko_llm.vision_raw


def system_prompt(c):
    game = c["game"] or "un jeu vidéo"
    spec = PRESETS[_preset(c["game"])][0]
    return ("Tu es un copilote qui regarde l'écran d'un joueur PENDANT qu'il joue à " + game + " et lui souffle UN conseil à la fois, en temps réel. "
            + ("Particularités : " + spec + " " if spec else "")
            + ("Objectif du joueur : " + c["goal"] + ". " if c["goal"] else "")
            + 'Réponds UNIQUEMENT par un objet JSON, sans texte autour : {"in_game": true|false, "summary": "ce qui se passe, 15 mots max", '
              '"advice": "UN conseil actionnable de 14 mots maximum, en français, ou chaîne vide s\'il n\'y a rien d\'utile", "urgency": 0-3}. '
              "urgency 3 = danger immédiat ou occasion à saisir MAINTENANT ; 0 = simple remarque. Si l'écran n'est pas le jeu (menu, bureau, chargement), mets in_game à false et advice vide. "
              "N'invente jamais ce que tu ne vois pas ; ne répète pas un conseil déjà donné ; n'encourage jamais à tricher, automatiser, scripter ou exploiter un bug : "
              "seulement des décisions que le joueur prend lui-même.")


def analyse(jpeg_bytes, cfg=None, vision=None):
    """-> {in_game, summary, advice, urgency}. `vision` injectable (tests). Les 3 derniers conseils et le résumé précédent sont donnés au modèle."""
    cfg = cfg if cfg is not None else nasko_core.load_config()
    c = config(cfg)
    with _lock:
        recent = [h["advice"] for h in S["history"][-3:]]
        before = S["summary"]
    ask = "Analyse cette capture." + (f" Image précédente : {before}." if before else "") + (" Conseils déjà donnés (ne les répète pas) : " + " | ".join(recent) + "." if recent else "")
    t0 = time.time()
    raw = (vision or _vision())(cfg, system_prompt(c), ask, jpeg_bytes, 300)
    with _lock:
        S["latency"] = time.time() - t0
    d = nasko_lol._json_obj(raw)
    u = str(d.get("urgency") or "0")
    return {"in_game": bool(d.get("in_game")), "summary": re.sub(r"\s+", " ", str(d.get("summary") or "")).strip()[:140],
            "advice": re.sub(r"\s+", " ", str(d.get("advice") or "")).strip()[:140], "urgency": max(0, min(3, int(u))) if u.isdigit() else 0}


def deliver(ctx, now=None, say=None):
    """Montre le conseil si : jeu à l'écran, non vide, pas répété depuis 90 s, au plus un toutes les 8 s (sauf urgence 3), et — mode « alertes seulement » — urgence ≥ 2."""
    now = now if now is not None else time.time()
    adv, c = ctx.get("advice", ""), config()
    if not ctx.get("in_game") or not adv or (c["alerts_only"] and ctx.get("urgency", 0) < 2):
        return False
    key = re.sub(r"\W+", " ", adv.lower()).strip()
    with _lock:
        last = S["seen"].get(key)
        if last is not None and now - last < REPEAT_S:
            return False
        if S["t_advice"] and now - S["t_advice"] < ADVICE_GAP_S and ctx.get("urgency", 0) < 3:
            return False
        S["seen"][key] = now
        S["seen"] = {k: t for k, t in S["seen"].items() if now - t < REPEAT_S}
        S["t_advice"], S["last_advice"] = now, adv
        S["history"].append({"t": now, "advice": adv, "urgency": ctx.get("urgency", 0)})
        S["history"] = S["history"][-30:]
    if say is None:
        import nasko_pet
        say = nasko_pet.comment
    return bool(say(adv))


def step(prev_sig=None, grab_fn=None, vision=None, say=None, force=False):
    """Un tour : (signature, contexte | None). `force` : ignore pause / « attendre le jeu » / écran inchangé (bouton ANALYSER MAINTENANT, tests)."""
    c = config()
    if not force:
        if S["paused"]:
            return prev_sig, None
        if c["need_game"] and not game_running(c):
            with _lock:
                S["waiting"] = True
            return prev_sig, None
    with _lock:
        S["waiting"] = False
    img = (grab_fn or (lambda: grab(c["focus"])))()
    sig = nasko_lol._signature(img)
    with _lock:
        S["frames"] += 1
    if not force and not nasko_lol._changed(prev_sig, sig, 4.0):
        return sig, None
    jpg = nasko_lol.encode(img)
    with _lock:
        S["calls"] += 1
    ctx = analyse(jpg, vision=vision)
    with _lock:
        if ctx["summary"]:
            S["summary"] = ctx["summary"]
        S["error"] = ""
    deliver(ctx, say=say)
    return sig, ctx


def ask(question, grab_fn=None, vision=None):
    """Question libre sur ce que le joueur voit MAINTENANT (« que dois-je acheter ? », « où est le danger ? ») -> réponse courte (texte)."""
    cfg = nasko_core.load_config()
    c = config(cfg)
    img = (grab_fn or (lambda: grab(c["focus"])))()
    sysmsg = (f"Tu es un copilote de jeu ({c['game'] or 'jeu vidéo'}). On te montre l'écran du joueur et il te pose une question. Réponds en français, en 40 mots maximum, "
              "concrètement, à partir de ce que tu VOIS ; si tu ne vois pas l'information, dis-le. Jamais de triche ni d'automatisation. Texte brut.")
    raw = (vision or _vision())(cfg, sysmsg, str(question)[:300], nasko_lol.encode(img), 200)
    return re.sub(r"[*_`#>~]+", "", raw).strip()[:400]


# ----------------------------------------------------------------------------- boucle
def _loop():
    sig = None
    try:
        while not S["stop"]:
            try:
                sig, _ = step(sig)
            except Exception as e:                                       # noqa: BLE001 — une erreur de vision ne tue pas la boucle
                with _lock:
                    S["error"] = f"{e.__class__.__name__}: {str(e)[:140]}"
                log.info("Copilote : tour en échec : %s", e)
            t = time.time() + config()["interval"]
            while time.time() < t and not S["stop"]:
                time.sleep(0.2)
    finally:
        with _lock:
            S.update(running=False, stop=False, waiting=False)


def start():
    with _lock:
        if S["running"]:
            return status()
        S.update(running=True, stop=False, error="")
        t = threading.Thread(target=_loop, daemon=True, name="gamecoach")
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
    except Exception:                                                    # noqa: BLE001
        log.info("Copilote : démarrage automatique impossible", exc_info=True)
