"""Capture du micro Windows (sounddevice) et transcription (Whisper) : la dictee de la fenetre native.

- Recorder : enregistre le micro par defaut, detecte la parole et le silence (arret automatique).
- transcribe() : Whisper via une API compatible OpenAI (Groq par defaut, reutilise la cle du LLM)
  ou localement avec faster-whisper (optionnel, non inclus dans ENOS.exe).
"""
import io
import logging
import threading
import time
import wave

import httpx
import numpy as np

from nasko_core import ssl_context

log = logging.getLogger("nasko.stt")

RATE = 16000
BLOCK = 1600            # 100 ms
CALIB = 0.4             # s : mesure du bruit ambiant avant de chercher la parole
MIN_THRESHOLD = 450     # RMS int16 minimal pour considerer qu'on parle
SILENCE_END = 1.3       # s de silence apres la parole -> fin automatique
NO_SPEECH_END = 8.0     # s sans parole -> abandon
MAX_SECONDS = 30.0
OPEN_TIMEOUT = 5.0         # s : délai maximal d'ouverture du micro
VOCAB_HINT = "E.N.O.S., Nassime, Terna, PixelLab, Godot, Aseprite, SYFAL"
HALLUCINATIONS = {"merci.", "merci !", "sous-titres réalisés par la communauté d'amara.org",
                  "sous-titrage st' 501", "merci d'avoir regardé cette vidéo.", "..."}


class STTError(Exception):
    """Message lisible, affichable tel quel dans le chat."""


def _stt_lang(cfg):
    from nasko_core import language
    return "en" if language(cfg) == "en" else cfg.get("stt_language", "fr")


def default_input_name():
    """Nom du micro par defaut, ou None s'il n'y en a pas."""
    try:
        import sounddevice as sd
        return sd.query_devices(kind="input")["name"]
    except Exception:
        return None


class Recorder:
    """Un seul enregistrement a la fois. start() -> status() en boucle -> stop() (ou arret auto) -> audio."""

    def __init__(self, min_threshold=None, calib=None, mult=3.0, max_threshold=None, silence_end=None, no_speech_end=None, loud_blocks=3, ignore_first=0.0):
        """Paramètres de détection de la parole (défauts = dictée du chat). Le widget Œil les abaisse : micros peu sensibles, parole dès le clic."""
        self._lock = threading.Lock()
        self._stream = None
        self.min_threshold = MIN_THRESHOLD if min_threshold is None else min_threshold
        self.calib = CALIB if calib is None else calib
        self.mult = mult
        self.max_threshold = max_threshold
        self.silence_end = SILENCE_END if silence_end is None else silence_end
        self.no_speech_end = NO_SPEECH_END if no_speech_end is None else no_speech_end
        self.loud_blocks = loud_blocks
        self.ignore_first = ignore_first                  # s : le bruit du clic (souris) ne compte pas comme de la parole
        self._reset()

    def _reset(self):
        self._chunks = []
        self.level = 0.0
        self.heard = False
        self.auto_ended = False
        self.peak = 0
        self._t0 = 0.0
        self._amb = []
        self._thr = None
        self._loud = 0
        self._quiet_since = None
        self._watchdog = None

    # --- flux audio (thread PortAudio)
    def _callback(self, indata, frames, time_info, status):
        a = indata[:, 0]
        self._chunks.append(a.copy())
        rms = float(np.sqrt(np.mean(a.astype(np.float32) ** 2)))
        self.level = min(1.0, rms / 4000.0)
        self.peak = max(self.peak, int(np.abs(a).max()) if len(a) else 0)
        now = time.time()
        elapsed = now - self._t0
        if self._thr is None:
            self._amb.append(rms)
            if elapsed >= self.calib:
                thr = max(self.min_threshold, float(np.median(self._amb)) * self.mult)
                self._thr = min(thr, self.max_threshold) if self.max_threshold else thr
            return
        if elapsed < self.ignore_first:
            return
        if rms > self._thr:
            self._loud += 1
            if self._loud >= self.loud_blocks:
                self.heard = True
            self._quiet_since = None
        else:
            self._loud = 0
            if self.heard and self._quiet_since is None:
                self._quiet_since = now
        if not self.auto_ended and (
                (self.heard and self._quiet_since and now - self._quiet_since >= self.silence_end)
                or (not self.heard and elapsed >= self.no_speech_end) or elapsed >= MAX_SECONDS):
            self.auto_ended = True       # le flux reste ouvert jusqu'a stop() ; le client est prevenu par status()

    # --- API
    def start(self):
        with self._lock:
            if self._stream is not None:
                raise STTError("Un enregistrement est déjà en cours.")
            self._reset()
            try:
                import sounddevice as sd
                self._t0 = time.time()
                # ouverture dans un thread avec délai de garde : un pilote audio / un micro bloqué par une autre application peut figer
                # Pa_OpenStream indéfiniment (observé) ; l'appelant reçoit alors une erreur lisible au lieu d'un blocage silencieux
                box = {}

                def _open():
                    try:
                        st = sd.InputStream(samplerate=RATE, channels=1, dtype="int16", blocksize=BLOCK, callback=self._callback)
                        st.start()
                        if box.get("abandon"):                        # trop tard : l'appelant a abandonné, on libère le micro
                            st.stop()
                            st.close()
                        else:
                            box["s"] = st
                    except Exception as ex:                           # noqa: BLE001
                        box["e"] = ex
                th = threading.Thread(target=_open, daemon=True, name="mic-open")
                th.start()
                th.join(OPEN_TIMEOUT)
                if th.is_alive():
                    box["abandon"] = True
                    raise TimeoutError("ouverture du micro bloquée")
                if "e" in box:
                    raise box["e"]
                self._stream = box["s"]
            except TimeoutError as e:
                self._stream = None
                log.warning("Micro bloqué : %s", e)
                raise STTError("Le micro ne répond pas : il est probablement utilisé en exclusivité par une autre application "
                               "(Discord, OBS, navigateur…) ou son pilote est bloqué. Fermez l'application qui l'utilise, "
                               "ou débranchez puis rebranchez le micro, puis réessayez.") from e
            except Exception as e:
                self._stream = None
                log.warning("Micro indisponible : %s", e)
                raise STTError("Impossible d'ouvrir le micro. Vérifiez qu'un micro est branché et que Windows autorise "
                               "les applications de bureau à l'utiliser (Paramètres > Confidentialité et sécurité > "
                               "Microphone).") from e
            # filet de securite : si le client disparait sans appeler stop(), le micro est relache
            self._watchdog = threading.Timer(MAX_SECONDS + 10, self.cancel)
            self._watchdog.daemon = True
            self._watchdog.start()

    def status(self):
        return {"recording": self._stream is not None and not self.auto_ended, "level": round(self.level, 2),
                "heard": self.heard, "seconds": round(time.time() - self._t0, 1) if self._stream else 0}

    def _close(self):
        if self._watchdog:
            self._watchdog.cancel()
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:
                pass
            self._stream = None

    def stop(self):
        """Arrete l'enregistrement. Retourne (audio_int16, parole_detectee, pic)."""
        with self._lock:
            self._close()
            audio = np.concatenate(self._chunks) if self._chunks else np.zeros(0, dtype=np.int16)
            return audio, self.heard, self.peak

    def cancel(self):
        with self._lock:
            self._close()
            self._chunks = []


# --------------------------------------------------------------------------- transcription
def _wav_bytes(audio):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(audio.astype(np.int16).tobytes())
    return buf.getvalue()


def _api_settings(cfg):
    base = (cfg.get("stt_base_url") or "").strip()
    key = (cfg.get("stt_api_key") or "").strip()
    if not base and cfg.get("llm_provider") == "openai":
        base = (cfg.get("llm_base_url") or "https://api.openai.com/v1").strip()
    if not key and cfg.get("llm_provider") == "openai":
        key = (cfg.get("llm_api_key") or "").strip()
    if not base or not key:
        raise STTError("Transcription non configurée : renseignez stt_base_url et stt_api_key (ou utilisez un LLM "
                       "compatible OpenAI comme Groq), ou mettez stt_provider à « local ».")
    model = (cfg.get("stt_model") or "").strip() or ("whisper-large-v3-turbo" if "groq" in base else "whisper-1")
    return base.rstrip("/"), key, model


def _transcribe_api(audio, cfg):
    base, key, model = _api_settings(cfg)
    data = {"model": model, "language": _stt_lang(cfg), "response_format": "json",
            "temperature": "0", "prompt": VOCAB_HINT}
    try:
        with httpx.Client(timeout=60, verify=ssl_context()) as client:
            resp = client.post(f"{base}/audio/transcriptions", headers={"Authorization": f"Bearer {key}"},
                               data=data, files={"file": ("audio.wav", _wav_bytes(audio), "audio/wav")})
    except httpx.HTTPError as e:
        raise STTError(f"Transcription injoignable ({e.__class__.__name__}). Vérifiez la connexion internet.") from e
    if resp.status_code != 200:
        log.warning("STT HTTP %s : %s", resp.status_code, resp.text[:300])
        try:
            detail = resp.json().get("error", {}).get("message", "")
        except ValueError:
            detail = ""
        if resp.status_code in (401, 403):
            raise STTError("Transcription : clé API refusée (stt_api_key / llm_api_key).")
        if resp.status_code == 429:
            raise STTError(f"Transcription : limite de débit ou quota dépassé. {detail}".strip())
        raise STTError(f"Transcription : erreur {resp.status_code}. {detail}".strip())
    try:                                                             # API Control Panel : secondes d'audio transcrites (limite Whisper de Groq) + en-têtes de limite
        import nasko_apimon
        nasko_apimon.record(nasko_apimon.stt_pid(cfg), 0, 0, 1, len(audio) / RATE, resp.headers)
    except Exception:                                                # noqa: BLE001
        pass
    return resp.json().get("text", "")


_local_model = None


def _transcribe_local(audio, cfg):
    global _local_model
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        raise STTError("Moteur local absent : py -m pip install faster-whisper (non inclus dans ENOS.exe ; "
                       "utilisez stt_provider « api »).") from e
    if _local_model is None:
        log.info("Chargement du modele Whisper local %s", cfg.get("stt_local_model", "small"))
        _local_model = WhisperModel(cfg.get("stt_local_model", "small"), device="cpu", compute_type="int8")
    segments, _ = _local_model.transcribe(audio.astype(np.float32) / 32768.0, language=_stt_lang(cfg),
                                          initial_prompt=VOCAB_HINT, vad_filter=False)
    return " ".join(s.text.strip() for s in segments)


def transcribe(audio, heard, peak, cfg):
    """Texte transcrit ('' si aucune parole). Leve STTError avec un message lisible."""
    if len(audio) < RATE * 0.3:
        return ""
    if peak < 30:
        raise STTError("Aucun son capté : le micro semble muet ou bloqué. Vérifiez le niveau d'entrée et "
                       "l'autorisation du micro dans Windows.")
    if not heard:
        return ""        # pas de parole detectee : inutile d'interroger Whisper (il inventerait du texte)
    provider = (cfg.get("stt_provider") or "api").lower()
    text = (_transcribe_local if provider == "local" else _transcribe_api)(audio, cfg).strip()
    if text.lower() in HALLUCINATIONS:
        return ""
    log.info("STT (%s) : %d caracteres, %.1f s d'audio", provider, len(text), len(audio) / RATE)
    return text
