"""WIDGET DE BUREAU « Œil d'E.N.O.S. » : un second exécutable Godot (projet godot_eye/) flotte au-dessus du bureau, fenêtre sans bordure,
transparente, toujours au premier plan. Il regarde le curseur, se déplace au glisser avec un ressort, et un CLIC l'envoie ici par WebSocket :

    clic -> capture d'écran silencieuse -> micro (arrêt automatique au silence) -> transcription -> API Vision -> voix ElevenLabs

  Godot -> Python : {"t":"hello"} · {"t":"click"} · {"t":"text","text":…} (saisie au clic sur la tête) · {"t":"close"} · {"t":"ping"}
  Python -> Godot : {"t":"idle"} · {"t":"listening"} · {"t":"thinking"} · {"t":"say","text":…,"audio_path":…} · {"t":"opts","bubble":…,"voice":…,"typing":…} · {"t":"quit"}

Options d'accessibilité (config) : pet_voice (voix de l'IA, vrai par défaut) · pet_bubble (bulle de texte au-dessus de la tête, vrai) · pet_typing
(un clic sur la tête ouvre une zone de saisie au lieu du micro, faux : utile aux personnes muettes).

Sécurité : boucle locale uniquement, aucun en-tête Origin, jeton propre à chaque lancement (argument de ligne de commande). La capture d'écran n'est
prise QUE sur clic de l'Œil et n'est envoyée qu'au fournisseur LLM configuré ; rien n'est conservé sur disque.
"""
import asyncio
import json
import logging
import os
import secrets
import subprocess
import threading
import time

import nasko_core
import nasko_persona

log = logging.getLogger("nasko.pet")

_tok = {"v": ""}
_conn = {"ws": None, "loop": None}
P = {"proc": None, "busy": False, "rec": None, "trace": []}


def _note(what):
    """Étapes de la dernière session (clic -> micro -> transcription -> réponse), visibles dans /api/pet/status et nasko.log : diagnostic sans console."""
    P["trace"] = (P["trace"] + [f"{time.strftime('%H:%M:%S')} {what}"])[-12:]
    log.info("Œil : %s", what)
_lock = threading.Lock()
CREATE_NO_WINDOW = 0x08000000


def check_token(t):
    return bool(_tok["v"]) and secrets.compare_digest(str(t or ""), _tok["v"])


def project_dir():
    d = os.path.join(nasko_core.app_dir(), "godot_eye")
    return d if os.path.isfile(os.path.join(d, "project.godot")) else ""


def godot_exe():
    p = str(nasko_core.load_config().get("godot_path") or "").strip().strip('"')
    return p if p and os.path.isfile(p) and p.lower().endswith(".exe") else ""


def status():
    pr = P["proc"]
    return {"available": bool(project_dir() and godot_exe()), "running": bool(pr and pr.poll() is None), "connected": _conn["ws"] is not None,
            "busy": P["busy"], "project": bool(project_dir()), "godot": bool(godot_exe()), "trace": list(P["trace"])}


class PetError(Exception):
    pass


def start(port=8765):
    """Lance l'Œil de bureau (silencieux : aucune console). Sans effet s'il tourne déjà."""
    exe, proj = godot_exe(), project_dir()
    if not proj:
        raise PetError("Dossier godot_eye introuvable à côté d'ENOS.exe.")
    if not exe:
        raise PetError("Godot introuvable : renseignez son chemin dans RÉGLAGES → PROFIL.")
    with _lock:
        if P["proc"] and P["proc"].poll() is None:
            return True
        _tok["v"] = secrets.token_urlsafe(24)
        try:
            P["proc"] = subprocess.Popen([exe, "--path", proj, "--", "--port", str(port), "--token", _tok["v"]], cwd=os.path.dirname(exe),
                                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW)
        except OSError as e:
            raise PetError(f"Lancement impossible : {e}")
    threading.Thread(target=_hide_from_taskbar, args=(P["proc"],), daemon=True, name="pet-style").start()
    threading.Thread(target=_keep_visible, args=(P["proc"],), daemon=True, name="pet-keep").start()
    return True


def _hide_from_taskbar(proc):
    """Le widget ne doit pas encombrer la barre des tâches : style « fenêtre outil » appliqué dès que sa fenêtre existe."""
    try:
        import nasko_embed as em
        if not em.supported():
            return
        t0 = time.time()
        while proc.poll() is None and time.time() - t0 < 20:
            h = em._main_window(proc.pid, "Engine")
            if h:
                ex = em.U.GetWindowLongPtrW(h, em.GWL_EXSTYLE)
                em.U.ShowWindow(h, em.SW_HIDE)
                em.U.SetWindowLongPtrW(h, em.GWL_EXSTYLE, (ex & ~em.WS_EX_APPWINDOW) | em.WS_EX_TOOLWINDOW)
                em.U.ShowWindow(h, em.SW_SHOWNA)
                return
            time.sleep(0.01)
    except Exception as e:                                          # noqa: BLE001 — cosmétique
        log.info("style barre des tâches : %s", e)


def _keep_visible(proc):
    """L'Œil / le visage doit rester affiché même quand la fenêtre d'E.N.O.S. est réduite : si Windows le minimise, le masque ou lui retire le
    « toujours au premier plan » (réduction de l'application, Afficher le bureau…), on le remet aussitôt, sans voler le focus."""
    try:
        import ctypes
        import nasko_embed as em
        if not em.supported():
            return
        U = ctypes.windll.user32
        U.IsIconic.argtypes = [ctypes.c_void_p]
        U.IsWindowVisible.argtypes = [ctypes.c_void_p]
        U.ShowWindow.argtypes = [ctypes.c_void_p, ctypes.c_int]
        U.SetWindowPos.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_uint]
        U.GetWindowLongPtrW.argtypes = [ctypes.c_void_p, ctypes.c_int]
        U.GetWindowLongPtrW.restype = ctypes.c_ssize_t
        HWND_TOPMOST, FLAGS = ctypes.c_void_p(-1), 0x0001 | 0x0002 | 0x0010 | 0x0040      # NOSIZE | NOMOVE | NOACTIVATE | SHOWWINDOW
        h = 0
        while proc.poll() is None:
            time.sleep(0.6)
            if not h or not U.IsWindowVisible(h) and not U.IsIconic(h):
                h = em._main_window(proc.pid, "Engine") or 0
                if not h:
                    continue
            if U.IsIconic(h):
                U.ShowWindow(h, 4)                                  # SW_SHOWNOACTIVATE : restaure sans activer
            if not U.IsWindowVisible(h):
                U.ShowWindow(h, 8)                                  # SW_SHOWNA
            if not (U.GetWindowLongPtrW(h, -20) & 0x8):             # WS_EX_TOPMOST perdu
                U.SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, FLAGS)
    except Exception as e:                                          # noqa: BLE001 — confort : jamais bloquant
        log.info("maintien de l'Œil à l'écran : %s", e)


def stop_voice():
    """Coupe la voix du widget (bouton INTERROMPRE) et termine une écoute éventuelle."""
    _send({"t": "stop_voice"})
    r = P.get("rec")
    if r is not None:
        r.auto_ended = True


def vacuum(direction="auto"):
    """Bouton ASPIRATEUR : le widget est aspiré vers l'autre écran (« right » / « left » force le sens ; « auto » = vers l'écran voisin libre)."""
    _send({"t": "vacuum", "dir": direction if direction in ("auto", "right", "left") else "auto"})


def stop():
    _send({"t": "quit"})
    with _lock:
        p, P["proc"] = P["proc"], None
    if p and p.poll() is None:
        try:
            p.wait(timeout=1.5)
        except subprocess.TimeoutExpired:
            p.terminate()
    _tok["v"] = ""


def _send(obj):
    ws, loop = _conn["ws"], _conn["loop"]
    if ws and loop:
        try:
            asyncio.run_coroutine_threadsafe(ws.send_text(json.dumps(obj, ensure_ascii=False)), loop)
        except Exception:                                           # noqa: BLE001
            pass


# ----------------------------------------------------------------------------- session « clic » : écran + micro + vision + voix
def _say(text, audio_path=""):
    _send({"t": "say", "text": text, "audio_path": audio_path})


_OPTS = (("pet_voice", "voice", True), ("pet_bubble", "bubble", True), ("pet_typing", "typing", False))


def options(cfg=None):
    cfg = cfg if cfg is not None else nasko_core.load_config()
    return {k: bool(cfg.get(k, d)) for k, _, d in _OPTS}


def set_options(new):
    """Enregistre (booléens uniquement) et pousse au widget les options voix / bulle / saisie."""
    patch = {k: bool(new[k]) for k, _, _ in _OPTS if k in new}
    if patch:
        nasko_core.update_config(patch)
    push_options()
    return options()


def push_options():
    o = options()
    _send({"t": "opts", **{wire: o[k] for k, wire, _ in _OPTS}})


def comment(text, persona=None, cfg=None):
    """Commentaire spontané de l'IA (conseil, alerte…) : bulle au-dessus de la tête et, si l'option voix est active, voix de la personnalité.
    Sans widget connecté, retourne False (l'appelant peut alors se rabattre sur une notification). Jamais d'exception."""
    cfg = cfg if cfg is not None else nasko_core.load_config()
    if not _conn["ws"] or not text:
        return False
    audio_path = ""
    shown = text
    try:
        persona = persona or nasko_persona.current(cfg)
        if persona == "eto":
            spoken = nasko_persona.ensure_tags(text)
            shown = nasko_persona.clean(spoken)
        else:
            spoken = text
        if options(cfg)["pet_voice"] and cfg.get("tts_dynamic", True):
            import nasko_eleven
            if nasko_eleven.configured(cfg, persona):
                audio_path = nasko_eleven.synthesize(spoken, cfg, "eto") if persona == "eto" else nasko_eleven.synthesize(shown, cfg)
    except Exception as e:                                          # noqa: BLE001 — texte seul si la voix échoue
        log.warning("Commentaire : voix indisponible : %s", e)
    _say(shown, audio_path)
    return True


def set_persona(p=None):
    """E.N.O.S. : l'Œil rouge. ETO : la boule blanche au visage bleu (mêmes interactions : suivre le curseur, glisser, clic = micro + vision)."""
    _send({"t": "persona", "p": p or nasko_persona.current()})


_FACE = {"excited": "excited", "gasps": "surprised", "shouts": "excited", "screams": "panic", "hmm": "hmm", "sigh": "sigh", "laugh": "laugh", "chuckles": "chuckle", "clears throat": "awkward", "exhales": "relieved",
         "coughs": "awkward", "gulps": "nervous", "whistles": "cool", "applause": "victory", "cheers": "hyped", "sarcastic": "smug", "curious": "curious", "surprised": "surprised", "happy": "happy", "sad": "sad", "pause": "hmm", "whispers": "shy"}


def _emote(tags):
    """Le visage d'ETO joue les émotions des balises audio de sa réplique, l'une après l'autre."""
    for i, t in enumerate(n for n in (_FACE.get(x) for x in tags) if n):
        threading.Timer(i * 1.4, lambda n=t: _send({"t": "emote", "name": n, "secs": 1.9})).start()


def _msg(fr, en, cfg):
    return en if nasko_core.language(cfg) == "en" else fr


def _boost(audio):
    """Micro peu sensible : amplifie (gain ≤ 8×) les enregistrements faibles avant la transcription."""
    import numpy as np
    peak = int(np.abs(audio).max()) if len(audio) else 0
    if 150 < peak < 9000:
        g = min(8.0, 16000.0 / peak)
        return np.clip(audio.astype(np.float32) * g, -32768, 32767).astype(np.int16), peak
    return audio, peak


def _start_recording(rec, timeout=5.0):
    """Ouvre le micro avec un délai de garde : un pilote audio bloqué ne doit pas figer le widget indéfiniment."""
    import nasko_stt
    err = []

    def go():
        try:
            rec.start()
        except Exception as e:                                      # noqa: BLE001
            err.append(e)
    th = threading.Thread(target=go, daemon=True, name="pet-mic-open")
    th.start()
    th.join(timeout)
    if th.is_alive():
        threading.Thread(target=rec.cancel, daemon=True).start()
        raise nasko_stt.STTError("Le micro ne répond pas (occupé par une autre application ou pilote bloqué). Réessayez dans un instant.")
    if err:
        raise err[0]


def new_recorder():
    import nasko_stt
    # détection sensible : seuil bas (160 au lieu de 450), calibration courte, bruit du clic ignoré (0,35 s), plafonnée (si vous parlez déjà pendant la calibration, elle ne monte pas trop)
    return nasko_stt.Recorder(min_threshold=160, calib=0.2, mult=2.2, max_threshold=900, silence_end=1.6, no_speech_end=10.0, loud_blocks=3, ignore_first=0.35)


def _grab_screen():
    import nasko_screen
    nasko_screen._dpi_aware()
    return nasko_screen.jpeg(nasko_screen.capture_screen(), 1280, 70)


def session(recorder=None, grab=None, llm=None, tts=None, typed=None):
    """Déroulé complet d'un clic. Les dépendances sont injectables (tests) ; jamais d'exception vers l'appelant."""
    with _lock:
        if P["busy"]:                                               # 2e clic pendant l'écoute : « j'ai fini de parler »
            r = P.get("rec")
            if r is not None:
                r.auto_ended = True
            return
        P["busy"] = True
    cfg = nasko_core.load_config()
    try:
        import nasko_llm
        import nasko_stt
        grab = grab or _grab_screen
        llm = llm or nasko_llm.vision
        rec = None if typed is not None else (recorder or new_recorder())
        P["rec"] = rec
        if rec is not None:
            _send({"t": "listening"})
            try:
                _start_recording(rec)
                _note("micro ouvert : parlez")
            except nasko_stt.STTError as e:
                _say(str(e))
                return
        try:
            shot = grab()                                           # capture silencieuse, AU MOMENT du clic (pendant l'écoute)
        except Exception as e:                                      # noqa: BLE001
            log.warning("Capture d'écran impossible : %s", e)
            shot = None
        if typed is not None:                                       # saisie au clavier (clic sur la tête) : ni micro ni transcription
            text, peak = typed, 0
        else:
            t0 = time.time()
            while rec.status()["recording"] and time.time() - t0 < 20:
                time.sleep(0.08)
            audio, heard, peak = rec.stop()
            audio, peak = _boost(audio)
            heard = heard or peak >= 1200                           # un son net suffit : Whisper décide s'il y a de la parole
            log.info("Widget : %.1f s d'audio, pic %d, parole détectée %s", len(audio) / 16000.0, peak, heard)
            _note(f"audio {len(audio) / 16000.0:.1f} s, pic {peak}, parole détectée : {heard}")
            try:
                text = nasko_stt.transcribe(audio, heard, peak, cfg)
            except nasko_stt.STTError as e:
                _say(str(e))
                return
        if not text:
            _say(_msg(f"Je n'ai rien entendu (niveau du micro : {peak}). Parlez juste après le clic, ou cliquez à nouveau quand vous avez fini.",
                      f"I heard nothing (mic level: {peak}). Speak right after the click, or click again when you are done.", cfg))
            return
        _note(f"transcrit : {len(text)} caractères")
        _send({"t": "thinking"})
        if shot is None:
            _say(_msg("Je ne parviens pas à voir votre écran.", "I cannot see your screen.", cfg))
            return
        try:
            persona = nasko_persona.current(cfg)
            reply = llm(cfg, text, shot) if (llm is not nasko_llm.vision or persona != "eto") else nasko_llm.vision(cfg, text, shot, "eto")
        except nasko_llm.LLMError as e:
            _say(str(e))
            return
        _note("réponse du modèle de vision reçue")
        audio_path = ""
        spoken = reply
        if persona == "eto":                                        # ETO : texte affiché sans balises, voix eleven_v3 (sa clé, sa voix, jamais assombrie)
            spoken = nasko_persona.ensure_tags(reply)
            reply = nasko_persona.clean(spoken)
        if cfg.get("tts_dynamic", True) and options(cfg)["pet_voice"]:
            try:
                import nasko_eleven
                import nasko_voice
                if nasko_eleven.configured(cfg, persona):
                    if persona == "eto":
                        audio_path = (tts or nasko_eleven.synthesize)(spoken, cfg, "eto")
                    else:
                        audio_path = nasko_voice.deepen((tts or nasko_eleven.synthesize)(reply, cfg))
            except Exception as e:                                  # noqa: BLE001 — texte seul si la voix échoue
                log.warning("Voix du widget indisponible : %s", e)
        _say(reply, audio_path)
        if persona == "eto":
            _emote(nasko_persona.tags(spoken))
    except Exception as e:                                          # noqa: BLE001
        log.exception("session widget")
        _say(_msg("Une erreur est survenue.", "Something went wrong.", cfg))
    finally:
        P["busy"] = False
        P["rec"] = None
        _send({"t": "idle"})


async def handle(ws):
    """Connexion du widget Godot (authentification déjà faite par SecurityMiddleware)."""
    await ws.accept()
    _conn["ws"], _conn["loop"] = ws, asyncio.get_running_loop()
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > 1024:
                break
            try:
                msg = json.loads(raw)
                t = msg.get("t")
            except (ValueError, AttributeError):
                continue
            if t == "hello":
                await ws.send_text('{"t":"idle"}')
                await ws.send_text(json.dumps({"t": "persona", "p": nasko_persona.current()}))
                o = options()
                await ws.send_text(json.dumps({"t": "opts", "voice": o["pet_voice"], "bubble": o["pet_bubble"], "typing": o["pet_typing"]}))
            elif t == "click":
                _note("clic reçu du widget")
                threading.Thread(target=session, daemon=True, name="pet-session").start()
            elif t == "text":
                typed = str(msg.get("text", "")).strip()[:400]
                if typed:
                    _note("texte saisi dans le widget")
                    threading.Thread(target=session, kwargs={"typed": typed}, daemon=True, name="pet-session").start()
            elif t == "close":
                threading.Thread(target=stop, daemon=True).start()
            elif t == "ping":
                await ws.send_text('{"t":"pong"}')
    except Exception:                                               # noqa: BLE001
        pass
    finally:
        if _conn["ws"] is ws:
            _conn["ws"] = None
