"""ÉCOUTE DISCORD : capture l'audio de SORTIE du PC (loopback WASAPI : ce qu'on entend dans le casque, donc la voix de l'ami en appel Discord),
éventuellement fusionné avec le micro, découpe la parole en phrases, les transcrit (Whisper, comme la dictée) et les met à disposition de l'interface.

  start(mix_mic) -> ouvre la capture ; stop() ; poll(after) -> phrases transcrites depuis `after` + état (niveau, erreur) ; mute(secs) -> sourd pendant qu'ETO parle.

Pièges traités :
  * le loopback WASAPI ne livre RIEN pendant les silences (la lecture bloque) : la lecture se fait dans des threads, le temps est cadencé ici (silence = bloc de zéros) ;
  * ETO parle aussi dans le casque : sourdine pendant ses répliques + filtre d'écho (une phrase très proche d'une réplique récente d'ETO est ignorée) ;
  * les sons du jeu / de la musique ne contiennent pas de parole : un seuil de volume + Whisper (qui renvoie « » sans parole) les écartent.
Bibliothèque : `soundcard` (légère, native Windows, aucune compilation).
"""
import difflib
import logging
import queue
import threading
import time

import numpy as np

log = logging.getLogger("nasko.loopback")

RATE = 16000
BLOCK = 1600                 # 100 ms
THRESHOLD = 380              # RMS int16 : en dessous, c'est du silence (le loopback est numériquement silencieux ; avec le micro fusionné on relève le seuil)
THRESHOLD_MIC = 650
LOUD_BLOCKS = 3              # 300 ms de voix pour déclencher une phrase
SILENCE_END = 1.0            # s de silence = fin de phrase (conversation : plus court que la dictée)
MIN_SECONDS = 0.7
MAX_SECONDS = 22.0
ECHO_RATIO = 0.55            # similarité (difflib) au-delà de laquelle une phrase est considérée comme l'écho d'ETO
MAX_EVENTS = 60


def available():
    """(ok, message) : la bibliothèque et un périphérique de sortie sont-ils disponibles ?"""
    try:
        import soundcard as sc
        sp = sc.default_speaker()
        return True, sp.name
    except Exception as e:                                           # noqa: BLE001
        if "0x80070490" in str(e):
            return False, "aucune sortie audio Windows détectée (le service « Audio Windows » est-il arrêté ? Aucun casque / haut-parleur par défaut ?)"
        return False, f"{e.__class__.__name__}: {e}"


def _mono_int16(d):
    a = np.asarray(d, dtype=np.float32)
    if a.ndim > 1:
        a = a.mean(axis=1)
    return np.clip(a * 32767.0, -32768, 32767).astype(np.int16)


def _similar(a, b):
    a, b = a.lower().strip(" .!?…"), b.lower().strip(" .!?…")
    if len(a) < 6 or len(b) < 6:
        return False
    return difflib.SequenceMatcher(None, a, b).ratio() >= ECHO_RATIO or (a in b) or (b in a)


class DiscordListener:
    def __init__(self):
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None
        self.running = False
        self.mix_mic = False
        self.device = ""
        self.error = ""
        self.level = 0.0
        self._events = []
        self._next_id = 1
        self._muted_until = 0.0
        self._recent = lambda: []                                    # fournisseur des répliques récentes d'ETO (filtre d'écho)
        self._cfg = lambda: {}

    # ---- API
    def start(self, cfg_provider, recent_provider=None, mix_mic=False):
        ok, msg = available()
        if not ok:
            raise RuntimeError("Capture de l'audio du bureau indisponible : " + msg + " (py -m pip install soundcard).")
        with self._lock:
            if self.running:
                self.mix_mic = bool(mix_mic)
                return self.device
            self._stop.clear()
            self.mix_mic, self.error, self.level = bool(mix_mic), "", 0.0
            self._ready = threading.Event()                          # posé quand la capture est RÉELLEMENT ouverte (ou en échec)
            self._cfg = cfg_provider
            self._recent = recent_provider or (lambda: [])
            self.device = msg
            self.running = True
            jobs = queue.Queue()                                     # une file PAR démarrage : un arrêt/redémarrage rapide ne tue pas le nouveau transcripteur
            self._thread = threading.Thread(target=self._run, args=(jobs,), daemon=True, name="discord-listen")
            self._thread.start()
            threading.Thread(target=self._transcriber, args=(jobs,), daemon=True, name="discord-stt").start()
        if not self._ready.wait(7.0):                                # ouverture bloquée (pilote / service audio Windows qui ne répond pas) : erreur claire, pas de gel
            self.stop()
            raise RuntimeError("L'audio de Windows ne répond pas (ouverture de la capture bloquée > 7 s). Vérifiez que le service « Audio Windows » tourne, puis réessayez.")
        if self.error:
            self.stop()
            raise RuntimeError(self.error)
        return self.device

    def stop(self):
        self._stop.set()
        self.running = False

    def mute(self, secs):
        """Sourdine pour `secs` secondes (ETO parle : sa voix sort dans le même casque). 0 = lève la sourdine."""
        self._muted_until = time.time() + max(0.0, float(secs))

    def poll(self, after=0):
        with self._lock:
            ev = [e for e in self._events if e["id"] > after]
        return {"running": self.running, "level": round(self.level, 2), "error": self.error, "device": self.device, "mix_mic": self.mix_mic,
                "muted": time.time() < self._muted_until, "events": ev, "last": self._next_id - 1}

    # ---- capture
    def _reader(self, dev, q, tag):
        """Lit des blocs de 100 ms dans `dev` (peut bloquer très longtemps pour le loopback : silence) et les pose dans `q`."""
        try:
            with dev.recorder(samplerate=RATE, channels=1, blocksize=BLOCK) as rec:
                if tag == "loopback":
                    self._ready.set()
                while not self._stop.is_set():
                    q.put(_mono_int16(rec.record(numframes=BLOCK)))
        except Exception as e:                                       # noqa: BLE001
            log.warning("Écoute Discord (%s) : %s", tag, e)
            if tag == "loopback":
                self.error = f"Capture de l'audio du bureau interrompue ({e.__class__.__name__}). Vérifiez la sortie audio par défaut de Windows."
                self._ready.set()

    def _run(self, jobs):
        try:
            import soundcard as sc
            speaker = sc.default_speaker()
            lb = sc.get_microphone(id=str(speaker.name), include_loopback=True)
            q_lb, q_mic = queue.Queue(), queue.Queue()
            threading.Thread(target=self._reader, args=(lb, q_lb, "loopback"), daemon=True, name="loopback-read").start()
            if self.mix_mic:
                threading.Thread(target=self._reader, args=(sc.default_microphone(), q_mic, "micro"), daemon=True, name="mic-read").start()
        except Exception as e:                                       # noqa: BLE001
            self.error = f"Impossible d'ouvrir l'audio du bureau : {e}"
            self.running = False
            self._ready.set()
            return
        thr = THRESHOLD_MIC if self.mix_mic else THRESHOLD
        chunks, loud, quiet_since, started = [], 0, None, 0.0
        tick = time.time()
        while not self._stop.is_set():
            tick += BLOCK / RATE
            time.sleep(max(0.0, tick - time.time()))
            if time.time() - tick > 1.0:                             # retard important (veille, charge) : on resynchronise
                tick = time.time()
            blocks = []
            for q in (q_lb, q_mic):
                try:
                    blocks.append(q.get_nowait())
                    while q.qsize() > 3:                             # le lecteur a de l'avance : on rattrape
                        blocks[-1] = q.get_nowait()
                except queue.Empty:
                    pass
            block = np.zeros(BLOCK, dtype=np.int32)                  # aucun bloc = silence (loopback muet)
            for b in blocks:
                n = min(len(b), BLOCK)
                block[:n] += b[:n]
            block = np.clip(block, -32768, 32767).astype(np.int16)
            rms = float(np.sqrt(np.mean(block.astype(np.float32) ** 2)))
            self.level = min(1.0, rms / 4000.0)
            now = time.time()
            if now < self._muted_until:                              # ETO parle : on n'écoute pas (et on jette la phrase en cours)
                chunks, loud, quiet_since = [], 0, None
                continue
            if rms > thr:
                loud += 1
                quiet_since = None
                if loud >= LOUD_BLOCKS and not chunks:
                    started = now
                if loud >= LOUD_BLOCKS or chunks:
                    chunks.append(block)
            else:
                loud = 0
                if chunks:
                    chunks.append(block)
                    quiet_since = quiet_since or now
            if chunks and ((quiet_since and now - quiet_since >= SILENCE_END) or now - started >= MAX_SECONDS):
                audio = np.concatenate(chunks)
                chunks, quiet_since = [], None
                if len(audio) >= RATE * MIN_SECONDS:
                    jobs.put(audio)
        self.running = False
        jobs.put(None)

    # ---- transcription (un thread, une phrase à la fois)
    def _transcriber(self, jobs):
        import nasko_stt
        while True:
            audio = jobs.get()
            if audio is None:
                return
            try:
                text = nasko_stt.transcribe(audio, True, int(np.abs(audio).max()), self._cfg()).strip()
            except nasko_stt.STTError as e:
                self.error = str(e)
                continue
            except Exception as e:                                   # noqa: BLE001
                log.warning("Écoute Discord : transcription : %s", e)
                continue
            if len(text) < 3:
                continue
            if any(_similar(text, r) for r in self._recent()):
                log.info("Écoute Discord : écho d'ETO ignoré (%s)", text[:50])
                continue
            with self._lock:
                self._events.append({"id": self._next_id, "text": text[:500], "ts": time.time(), "secs": round(len(audio) / RATE, 1)})
                self._next_id += 1
                del self._events[:-MAX_EVENTS]
            self.error = ""


listener = DiscordListener()
