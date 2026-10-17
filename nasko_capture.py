"""TAMPON CIRCULAIRE ÉCRAN + AUDIO (partagé : Auto-Clipper, Tilt…), 100 % en RAM.

  capture.start(fps, seconds, max_width) ; capture.stop() ; capture.frames(t0, t1) ; capture.audio(t0, t1, "out"|"mic") ;
  capture.cursor(t0, t1) ; capture.export_segment(t0, t1, path, vertical=True, ...) -> MP4 H.264 + AAC (ffmpeg).

Principes :
  * les images sont des JPEG (qualité ~70) dans un deque borné par la durée ET par la mémoire (≤ MAX_MB : au-delà, fps et largeur baissent seuls) ;
  * l'audio (sortie du PC en loopback + micro) est gardé dans des tampons numpy bornés, placés sur la ligne du temps par horodatage (un loopback muet = trou = silence) ;
  * AUCUNE écriture disque hors export_segment ; AUCUN hook clavier/souris global (anti-triche) : seulement de l'échantillonnage (capture d'écran, GetCursorPos) ;
  * rien n'est envoyé sur le réseau ici ;
  * toute dépendance matérielle (mss, dxcam, soundcard, ctypes.windll) est importée paresseusement derrière des « sources » injectables :
      écran : grab() -> ndarray BGR | None  (+ optionnels : size=(w,h), cursor() -> (x,y)) ;  audio : read(n) -> ndarray int16 mono (peut être vide), attribut rate.
"""
import collections
import logging
import math
import os
import subprocess
import threading
import time
import wave

import numpy as np

log = logging.getLogger("nasko.capture")

MAX_MB = 150.0                     # plafond mémoire du tampon d'images
JPEG_QUALITY = 70
VERT_SIZE = (1080, 1920)
AUDIO_RATE = 48000                 # fréquence du mixage exporté
MAX_REQUEST_S = 180.0              # une requête audio/image ne dépasse jamais ça


# ----------------------------------------------------------------------------- sources réelles (Windows, import paresseux)
def _cv2():
    import cv2
    return cv2


def _win_cursor():
    """Position souris par échantillonnage (GetCursorPos) ; None hors Windows. Aucun hook."""
    try:
        import ctypes
        import ctypes.wintypes as wt
        pt = wt.POINT()
        if ctypes.windll.user32.GetCursorPos(ctypes.byref(pt)):
            return int(pt.x), int(pt.y)
    except Exception:                                              # noqa: BLE001
        pass
    return None


def _foreground_rect():
    try:
        import ctypes
        import ctypes.wintypes as wt
        u = ctypes.windll.user32
        hwnd = u.GetForegroundWindow()
        r = wt.RECT()
        if hwnd and u.GetWindowRect(hwnd, ctypes.byref(r)) and r.right - r.left > 64 and r.bottom - r.top > 64:
            return max(0, r.left), max(0, r.top), r.right, r.bottom
    except Exception:                                              # noqa: BLE001
        pass
    return None


class ScreenSource:
    """Écran principal (ou fenêtre active) : mss, sinon dxcam, sinon PIL.ImageGrab. Sort du BGR."""

    def __init__(self, active_window=False):
        self.active_window = bool(active_window)
        self.size = (0, 0)
        self._origin = (0, 0)
        self._mss = self._dx = None
        self._last = None
        self._kind = ""

    def _open(self):
        try:
            import mss
            self._mss = mss.mss()
            self._kind = "mss"
            return
        except Exception:                                          # noqa: BLE001
            pass
        try:
            import dxcam
            self._dx = dxcam.create(output_color="BGR")
            self._kind = "dxcam"
            return
        except Exception:                                          # noqa: BLE001
            pass
        from PIL import ImageGrab                                  # noqa: F401 — lève si indisponible
        self._kind = "pil"

    def grab(self):
        if not self._kind:
            self._open()
        rect = _foreground_rect() if self.active_window else None
        if self._kind == "mss":
            mon = self._mss.monitors[1]
            if rect:
                mon = {"left": rect[0], "top": rect[1], "width": rect[2] - rect[0], "height": rect[3] - rect[1]}
            img = np.asarray(self._mss.grab(mon))[:, :, :3]
            self._origin = (mon["left"], mon["top"])
        elif self._kind == "dxcam":
            img = self._dx.grab(region=rect) if rect else self._dx.grab()
            if img is None:
                return self._last
            self._origin = (rect[0], rect[1]) if rect else (0, 0)
        else:
            from PIL import ImageGrab
            im = ImageGrab.grab(bbox=rect) if rect else ImageGrab.grab()
            img = np.asarray(im.convert("RGB"))[:, :, ::-1]
            self._origin = (rect[0], rect[1]) if rect else (0, 0)
        self._last = img
        self.size = (img.shape[1], img.shape[0])
        return img

    def cursor(self):
        c = _win_cursor()
        if c is None:
            return None
        return c[0] - self._origin[0], c[1] - self._origin[1]


class _SoundcardSource:
    rate = 16000

    def __init__(self, loopback):
        self.loopback = loopback
        self._ctx = self._rec = None

    def _open(self):
        import soundcard as sc
        if self.loopback:
            dev = sc.get_microphone(id=str(sc.default_speaker().name), include_loopback=True)
        else:
            dev = sc.default_microphone()
        self._ctx = dev.recorder(samplerate=self.rate, channels=1, blocksize=1600)
        self._rec = self._ctx.__enter__()

    def read(self, n):
        if self._rec is None:
            self._open()
        d = np.asarray(self._rec.record(numframes=n), dtype=np.float32)
        if d.ndim > 1:
            d = d.mean(axis=1)
        return np.clip(d * 32767.0, -32768, 32767).astype(np.int16)

    def close(self):
        try:
            if self._ctx is not None:
                self._ctx.__exit__(None, None, None)
        except Exception:                                          # noqa: BLE001
            pass
        self._ctx = self._rec = None


def default_audio_out():
    return _SoundcardSource(True)


def default_mic():
    return _SoundcardSource(False)


# ----------------------------------------------------------------------------- rendu (fonctions pures)
def _smooth_bell(d, radius):
    """1 au centre, 0 à ±radius, courbe en cosinus (douce, dérivée nulle aux bords)."""
    if abs(d) >= radius:
        return 0.0
    return 0.5 * (1.0 + math.cos(math.pi * d / radius))


def _zoom_fn(zoom, default_peak):
    """zoom : None (pas de zoom) | callable(t)->facteur | dict {peak_ts, max, radius}."""
    if zoom is None:
        return lambda t: 1.0
    if callable(zoom):
        return zoom
    peak = float(zoom.get("peak_ts", default_peak))
    zmax = max(1.0, min(3.0, float(zoom.get("max", 1.6))))
    rad = max(0.2, float(zoom.get("radius", 2.5)))
    return lambda t: 1.0 + (zmax - 1.0) * _smooth_bell(t - peak, rad)


def _font(size):
    from PIL import ImageFont
    for name in ("arialbd.ttf", "arial.ttf", "DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "FreeSansBold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:                                          # noqa: BLE001
            continue
    return ImageFont.load_default()


def _label_overlay(text, width):
    """(bgr, alpha) d'une bande de titre en haut, ou None."""
    text = (text or "").strip()[:60]
    if not text:
        return None
    from PIL import Image, ImageDraw
    k = width / 1080.0
    h = max(8, int(170 * k))
    im = Image.new("RGBA", (width, h), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    for y in range(h):                                             # dégradé sombre pour la lisibilité
        dr.line([(0, y), (width, y)], fill=(0, 0, 0, int(150 * (1 - y / h))))
    size = max(8, int(78 * k))
    f = _font(size)
    while size > 8 and dr.textlength(text, font=f) > width - 80 * k:
        size -= max(1, int(6 * k))
        f = _font(size)
    tw = dr.textlength(text, font=f)
    x, y = (width - tw) / 2, 48 * k
    dr.text((x + 3 * k, y + 3 * k), text, font=f, fill=(0, 0, 0, 255))
    dr.text((x, y), text, font=f, fill=(255, 255, 255, 255))
    a = np.asarray(im)
    return a[:, :, 2::-1].copy(), a[:, :, 3:4].astype(np.float32) / 255.0


def _webcam_overlay(img, out_w, out_h):
    """(bgr, alpha, x, y) : image webcam en cadre arrondi, centrée en bas."""
    cv2 = _cv2()
    h0, w0 = img.shape[:2]
    w = int(out_w * 0.46)
    h = max(2, int(w * h0 / max(1, w0)))
    h = min(h, int(out_h * 0.28))
    small = cv2.resize(img[:, :, :3], (w, h), interpolation=cv2.INTER_AREA)
    mask = np.zeros((h, w), np.uint8)
    r = max(4, min(w, h) // 8)
    cv2.rectangle(mask, (r, 0), (w - r, h), 255, -1)
    cv2.rectangle(mask, (0, r), (w, h - r), 255, -1)
    for cx, cy in ((r, r), (w - r - 1, r), (r, h - r - 1), (w - r - 1, h - r - 1)):
        cv2.circle(mask, (cx, cy), r, 255, -1)
    border = cv2.dilate(mask, np.ones((7, 7), np.uint8))
    small = small.copy()
    small[(border > 0) & (mask == 0)] = 255
    full = (border > 0).astype(np.float32)[:, :, None]
    return small, full, (out_w - w) // 2, max(0, out_h - h - int(out_h * 0.073))


def _mix_audio(out, mic, rate_out, rate_mic, duration):
    """Mixe jeu + micro en mono int16 à AUDIO_RATE sur `duration` s, normalisé (gain borné, pic à -3 dB)."""
    n = int(round(duration * AUDIO_RATE))

    def rs(a, r):
        a = np.asarray(a, dtype=np.float32)
        if len(a) == 0 or r <= 0:
            return np.zeros(n, np.float32)
        if r != AUDIO_RATE:
            x = np.linspace(0, len(a) - 1, n)
            a = np.interp(x, np.arange(len(a)), a).astype(np.float32)
        a = a[:n]
        return np.pad(a, (0, n - len(a)))

    mix = rs(out, rate_out) * 0.8 + rs(mic, rate_mic) * 1.0
    peak = float(np.max(np.abs(mix))) if n else 0.0
    if peak > 300.0:                                               # ne remonte pas un souffle : gain ≤ ×6
        mix *= min(6.0, 0.7 * 32767.0 / peak)
    return np.clip(mix, -32768, 32767).astype(np.int16)


def _ffmpeg_exe():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:                                              # noqa: BLE001
        return "ffmpeg"


# ----------------------------------------------------------------------------- tampon
class Capture:
    def __init__(self, screen=None, audio=None, mic=None, clock=time.time, max_mb=MAX_MB):
        self._screen, self._audio_src, self._mic_src = screen, audio, mic
        self._clock = clock
        self.max_mb = float(max_mb)
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._threads = []
        self._running = False
        self._frames = collections.deque()          # (ts, jpeg bytes)
        self._bytes = 0
        self._cursor = collections.deque()          # (ts, x, y) en pixels de la source
        self._aud = {"out": collections.deque(), "mic": collections.deque()}   # (ts_fin, ndarray int16)
        self._rate = {"out": 16000, "mic": 16000}
        self._errors = []
        self._screen_size = (0, 0)
        self._frame_size = (0, 0)
        self.seconds, self.fps, self.max_width = 40, 15, 1280
        self._fps_eff, self._width_eff = 15.0, 1280
        self._active_window = False
        self._made_here = []                        # sources créées par défaut (à fermer)

    # ---- cycle de vie
    def now(self):
        return self._clock()

    def running(self):
        return self._running

    def start(self, fps=15, seconds=40, max_width=1280, active_window=False):
        with self._lock:
            if self._running:
                return
            self.fps = max(1, min(60, int(fps)))
            self.seconds = max(5, min(180, int(seconds)))
            self.max_width = max(320, min(3840, int(max_width)))
            self._fps_eff, self._width_eff = float(self.fps), int(self.max_width)
            self._active_window = bool(active_window)
            self._stop.clear()
            self._errors = []
            if self._screen is None:
                self._screen = ScreenSource(self._active_window)
                self._made_here.append(self._screen)
            if self._audio_src is None:
                self._audio_src = default_audio_out()
                self._made_here.append(self._audio_src)
            if self._mic_src is None:
                self._mic_src = default_mic()
                self._made_here.append(self._mic_src)
            self._running = True
            specs = [(self._video_loop, "cap-video"), (lambda: self._audio_loop("out", self._audio_src), "cap-out"),
                     (lambda: self._audio_loop("mic", self._mic_src), "cap-mic")]
            self._threads = [threading.Thread(target=fn, daemon=True, name=nm) for fn, nm in specs]
            for t in self._threads:
                t.start()

    def stop(self):
        with self._lock:
            self._running = False
            self._stop.set()
            threads, self._threads = self._threads, []
        for t in threads:
            t.join(timeout=1.5)
        for s in self._made_here:                                  # sources par défaut : rendues ; les sources injectées restent à l'appelant
            try:
                if s is self._screen:
                    self._screen = None
                elif s is self._audio_src:
                    self._audio_src = None
                elif s is self._mic_src:
                    self._mic_src = None
                if hasattr(s, "close"):
                    s.close()
            except Exception:                                      # noqa: BLE001
                pass
        self._made_here = []
        with self._lock:                                           # tampon en RAM uniquement : on le vide à l'arrêt
            self._frames.clear()
            self._bytes = 0
            self._cursor.clear()
            for d in self._aud.values():
                d.clear()

    def _err(self, msg):
        with self._lock:
            if msg not in self._errors:
                self._errors.append(msg)
                self._errors = self._errors[-8:]
        log.warning("capture : %s", msg)

    # ---- alimentation (utilisables directement par les tests)
    def push_frame(self, ts, img, cursor_xy=None, screen_size=None):
        cv2 = _cv2()
        h, w = img.shape[:2]
        self._screen_size = tuple(screen_size) if screen_size else (w, h)
        if w > self._width_eff:
            nh = max(2, int(round(h * self._width_eff / w)))
            img = cv2.resize(img, (int(self._width_eff), nh), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
        if not ok:
            return
        data = buf.tobytes()
        with self._lock:
            self._frame_size = (img.shape[1], img.shape[0])
            self._frames.append((ts, data))
            self._bytes += len(data)
            if cursor_xy is not None:
                self._cursor.append((ts, int(cursor_xy[0]), int(cursor_xy[1])))
            horizon = ts - self.seconds
            while self._frames and self._frames[0][0] < horizon:
                self._bytes -= len(self._frames.popleft()[1])
            while self._cursor and self._cursor[0][0] < horizon:
                self._cursor.popleft()
            if self._bytes > self.max_mb * 1e6:                    # plafond mémoire : on dégrade AVANT de raccourcir la fenêtre
                self._fps_eff = max(4.0, self._fps_eff * 0.8)
                self._width_eff = max(480, int(self._width_eff * 0.85))
                while self._frames and self._bytes > self.max_mb * 1e6:
                    self._bytes -= len(self._frames.popleft()[1])

    def push_audio(self, ts_end, samples, source="out", rate=None):
        if rate:
            self._rate[source] = int(rate)
        a = np.asarray(samples)
        if a.dtype != np.int16:
            a = np.clip(a, -32768, 32767).astype(np.int16)
        if a.ndim > 1:
            a = a.mean(axis=1).astype(np.int16)
        if len(a) == 0:
            return
        with self._lock:
            d = self._aud[source]
            d.append((ts_end, a))
            horizon = ts_end - self.seconds - 5
            while d and d[0][0] < horizon:
                d.popleft()
            while len(d) > 4000:                                   # garde-fou mémoire
                d.popleft()

    # ---- threads
    def _video_loop(self):
        src = self._screen
        nxt = self.now()
        while not self._stop.is_set():
            try:
                img = src.grab()
                ts = self.now()
                if img is not None:
                    cur = None
                    try:
                        cur = src.cursor() if hasattr(src, "cursor") else _win_cursor()
                    except Exception:                              # noqa: BLE001
                        pass
                    size = getattr(src, "size", None)
                    self.push_frame(ts, img, cur, size if size and size[0] else None)
            except Exception as e:                                 # noqa: BLE001
                self._err(f"écran : {e.__class__.__name__}: {e}")
                self._stop.wait(1.0)
            nxt += 1.0 / self._fps_eff
            delay = nxt - self.now()
            if delay < -1.0:
                nxt = self.now()
            elif delay > 0:
                self._stop.wait(delay)

    def _audio_loop(self, kind, src):
        rate = int(getattr(src, "rate", 16000) or 16000)
        self._rate[kind] = rate
        block = max(160, rate // 10)
        while not self._stop.is_set():
            try:
                d = src.read(block)
                ts = self.now()
                if d is None or len(d) == 0:
                    self._stop.wait(0.02)
                    continue
                self.push_audio(ts, d, kind)
            except Exception as e:                                 # noqa: BLE001
                self._err(f"audio {kind} : {e.__class__.__name__}: {e}")
                self._stop.wait(2.0)

    # ---- lecture
    def frames(self, start_ts, end_ts):
        """[(ts, BGR ndarray)] sur [start_ts, end_ts] (décodage JPEG à la demande)."""
        cv2 = _cv2()
        with self._lock:
            sel = [(t, d) for t, d in self._frames if start_ts <= t <= end_ts]
        out = []
        for t, d in sel:
            im = cv2.imdecode(np.frombuffer(d, np.uint8), cv2.IMREAD_COLOR)
            if im is not None:
                out.append((t, im))
        return out

    def audio(self, start_ts, end_ts, source="out"):
        """(int16 mono, sample_rate) : exactement (end-start)*rate échantillons, trous = silence."""
        if source not in self._aud:
            raise ValueError("source audio inconnue : " + str(source))
        end_ts = min(end_ts, start_ts + MAX_REQUEST_S)
        with self._lock:
            chunks = list(self._aud[source])
            rate = self._rate[source]
        n = max(0, int(round((end_ts - start_ts) * rate)))
        out = np.zeros(n, np.int16)
        for te, a in chunks:
            ts0 = te - len(a) / rate
            if te < start_ts or ts0 > end_ts:
                continue
            i0 = int(round((ts0 - start_ts) * rate))
            lo, hi = max(0, i0), min(n, i0 + len(a))
            if hi > lo:
                out[lo:hi] = a[lo - i0:hi - i0]
        return out, rate

    def cursor(self, start_ts, end_ts):
        """[(ts, x, y)] en pixels de l'écran source ; taille d'écran dans status()['screen']."""
        with self._lock:
            return [c for c in self._cursor if start_ts <= c[0] <= end_ts]

    def span(self):
        """(premier_ts, dernier_ts) des images tamponnées, ou None."""
        with self._lock:
            return (self._frames[0][0], self._frames[-1][0]) if self._frames else None

    def screen_size(self):
        return self._screen_size

    def status(self):
        with self._lock:
            n = len(self._frames)
            fps = 0.0
            if n >= 2:
                span = self._frames[-1][0] - self._frames[max(0, n - 31)][0]
                fps = (min(n, 31) - 1) / span if span > 0 else 0.0
            nb_audio = {k: sum(len(a) for _, a in d) for k, d in self._aud.items()}
            return {
                "running": self._running, "fps": round(fps, 1), "fps_target": round(self._fps_eff, 1), "frames": n,
                "memory_mb": round((self._bytes + 2 * sum(nb_audio.values())) / 1e6, 2), "max_mb": self.max_mb,
                "seconds": self.seconds, "width": self._width_eff, "screen": list(self._screen_size), "frame_size": list(self._frame_size),
                "sources": {"screen": self._screen is not None, "out": self._audio_src is not None and nb_audio["out"] > 0,
                            "mic": self._mic_src is not None and nb_audio["mic"] > 0},
                "errors": list(self._errors),
            }

    # ---- export MP4
    def _poi_fn(self, mode, t0, t1, fw, fh):
        """Point d'intérêt (x, y) en pixels de l'image tamponnée, à l'instant t. fps = réticule = centre ; cursor = curseur échantillonné."""
        if mode != "cursor":
            return lambda t: (fw / 2.0, fh / 2.0)
        cur = self.cursor(t0 - 1.0, t1 + 1.0)
        sw, sh = self._screen_size if self._screen_size[0] else (fw, fh)
        if not cur:
            return lambda t: (fw / 2.0, fh / 2.0)
        ts = np.array([c[0] for c in cur])
        xs = np.array([c[1] for c in cur], float) * fw / sw
        ys = np.array([c[2] for c in cur], float) * fh / sh
        return lambda t: (float(np.interp(t, ts, xs)), float(np.interp(t, ts, ys)))

    def export_segment(self, start_ts, end_ts, path, *, vertical=False, with_audio=True, zoom=None, webcam=None,
                       mode="fps", label="", peak_ts=None, out_fps=None, out_size=None):
        """Écrit un MP4 H.264 (+AAC) de [start_ts, end_ts]. vertical : 1080x1920, recadrage 9:16 suivant le point d'intérêt
        (mode « fps » : centre/réticule ; « cursor » : curseur lissé) avec zoom dynamique (zoom : None | dict {peak_ts,max,radius} | callable(t)).
        webcam : objet .grab() -> BGR, incrusté en bas. Retourne {path, duration, frames, size_bytes}."""
        cv2 = _cv2()
        dur = float(end_ts - start_ts)
        if dur <= 0.2 or dur > MAX_REQUEST_S:
            raise ValueError("intervalle d'export invalide")
        fr = self.frames(start_ts - 0.5, end_ts)
        if not fr:
            raise RuntimeError("aucune image dans le tampon pour cet intervalle")
        ts_arr = np.array([t for t, _ in fr])
        real_fps = (len(fr) - 1) / (ts_arr[-1] - ts_arr[0]) if len(fr) > 1 and ts_arr[-1] > ts_arr[0] else 15.0
        fps = int(out_fps or max(5, min(30, round(real_fps))))
        n_out = max(1, int(round(dur * fps)))
        fh0, fw0 = fr[0][1].shape[:2]
        ow, oh = (out_size or VERT_SIZE) if vertical else (fw0 - fw0 % 2, fh0 - fh0 % 2)
        zf = _zoom_fn(zoom, (peak_ts if peak_ts is not None else end_ts - 2.0))
        poi = self._poi_fn(mode, start_ts, end_ts, fw0, fh0)
        lab = _label_overlay(label, ow) if vertical else None
        cam = None
        if webcam is not None:
            try:
                g = webcam.grab()
                if g is not None:
                    cam = _webcam_overlay(g, ow, oh)
            except Exception as e:                                 # noqa: BLE001
                self._err(f"webcam : {e}")
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        wav_path = None
        cmd = [_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
               "-s", f"{ow}x{oh}", "-r", str(fps), "-i", "-"]
        if with_audio:
            ao, ro = self.audio(start_ts, end_ts, "out")
            am, rm = self.audio(start_ts, end_ts, "mic")
            mix = _mix_audio(ao, am, ro, rm, dur)
            wav_path = os.path.abspath(path) + ".tmp.wav"
            with wave.open(wav_path, "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(AUDIO_RATE)
                w.writeframes(mix.tobytes())
            cmd += ["-i", wav_path]
        cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-maxrate", "8M", "-bufsize", "16M", "-pix_fmt", "yuv420p"]
        if with_audio:
            cmd += ["-af", "alimiter=limit=0.89", "-c:a", "aac", "-b:a", "160k", "-ar", "48000"]
        cmd += ["-t", f"{dur:.3f}", "-movflags", "+faststart", os.path.abspath(path)]
        flags = 0x08000000 if os.name == "nt" else 0
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=flags)
        errbuf = []
        threading.Thread(target=lambda: errbuf.append(proc.stderr.read()), daemon=True).start()
        px = py = None
        alpha = 1.0 - math.exp(-(1.0 / fps) / 0.08)
        idx, cur_img = 0, None
        try:
            for i in range(n_out):
                t = start_ts + i / fps
                while idx + 1 < len(fr) and fr[idx + 1][0] <= t:
                    idx += 1
                    cur_img = None
                if cur_img is None:
                    cur_img = fr[idx][1]
                img = cur_img
                h, w = img.shape[:2]
                if vertical:
                    tx, ty = poi(t)
                    px, py = (tx, ty) if px is None else (px + alpha * (tx - px), py + alpha * (ty - py))   # filtre exponentiel (constante de temps 80 ms)
                    z = max(1.0, zf(t))
                    ch = h / z
                    cw = ch * ow / oh
                    if cw > w:
                        cw, ch = float(w), w * oh / ow
                    x0 = min(max(px - cw / 2, 0), w - cw)
                    y0 = min(max(py - ch / 2, 0), h - ch)
                    M = np.float32([[ow / cw, 0, -x0 * ow / cw], [0, oh / ch, -y0 * oh / ch]])
                    out = cv2.warpAffine(img, M, (ow, oh), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
                    if lab is not None:
                        bh = lab[0].shape[0]
                        out[:bh] = (out[:bh] * (1 - lab[1]) + lab[0] * lab[1]).astype(np.uint8)
                    if cam is not None:
                        cimg, cal, cx, cy = cam
                        hh, ww = cimg.shape[:2]
                        roi = out[cy:cy + hh, cx:cx + ww]
                        out[cy:cy + hh, cx:cx + ww] = (roi * (1 - cal) + cimg * cal).astype(np.uint8)
                else:
                    out = img[:oh, :ow]
                    if out.shape[1] != ow or out.shape[0] != oh:
                        out = cv2.resize(out, (ow, oh))
                proc.stdin.write(np.ascontiguousarray(out).tobytes())
            proc.stdin.close()
            rc = proc.wait(timeout=120)
            if rc != 0:
                raise RuntimeError("ffmpeg a échoué : " + (errbuf[0].decode("utf-8", "replace")[-300:] if errbuf else str(rc)))
        except BrokenPipeError:
            proc.wait(timeout=10)
            raise RuntimeError("ffmpeg a échoué : " + (errbuf[0].decode("utf-8", "replace")[-300:] if errbuf else "pipe"))
        finally:
            if proc.poll() is None:
                proc.kill()
            for f in (proc.stdin, proc.stderr):
                try:
                    f.close()
                except Exception:                                  # noqa: BLE001
                    pass
            if wav_path and os.path.exists(wav_path):
                try:
                    os.remove(wav_path)
                except OSError:
                    pass
        return {"path": os.path.abspath(path), "duration": round(n_out / fps, 3), "frames": n_out, "size_bytes": os.path.getsize(path)}


capture = Capture()
