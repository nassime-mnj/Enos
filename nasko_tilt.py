"""ANTI-TILT COACH : détecte qu'un joueur commence à s'énerver et l'apaise avec la voix d'ETO.

Signaux (tous calculés sur SA machine, par échantillonnage, jamais par hook global) :
  * souris : position du curseur lue ~60 fois/s (GetCursorPos) -> vitesse, accélération, jerk, demi-tours/s, secousses ;
  * clavier : GetAsyncKeyState lu ~60 fois/s, on ne garde que le NOMBRE de touches enfoncées d'un échantillon à l'autre -> « appuis/s ».
    Aucune touche n'est identifiée ni stockée, aucun texte n'existe nulle part ;
  * micro (option) : uniquement RMS, centroïde, platitude, durée par tranche de 100 ms ; le son est jeté aussitôt, rien n'est enregistré.
Chaque fenêtre de 5 s ne laisse que des agrégats numériques en RAM (30 min max). Seul l'étalonnage (moyennes / écarts-types) est écrit sur disque
(data/tilt_calibration.json, effaçable par reset()), plus les MP4 de replay dans data/Replays. Rien n'est envoyé en ligne : le LLM ne reçoit qu'un
court contexte textuel (score, signaux dominants), et UNE image du replay seulement si `tilt_replay_vision` est vrai (faux par défaut).
OPT-IN : `tilt_enabled` est faux par défaut.

API : start() stop() status() mark_death(ts=None) config() set_config(d) reset() autostart() test_intervention() replays() replay_path(name).
Toutes les entrées (souris/clavier, micro, capture, LLM, voix, notification, vision, config, horloge) sont injectables dans `Coach` : voir FakeInput & co.
"""
import collections
import json
import logging
import os
import random
import re
import threading
import time

import numpy as np

log = logging.getLogger("nasko.tilt")

WINDOW_S = 5.0
HZ = 60
HISTORY_MAX = 360                 # 30 min de fenêtres de 5 s
CAL_MIN_WINDOWS = 60              # 5 min d'activité : aucune intervention avant
CAL_FULL_WINDOWS = 120            # 10 min d'activité : étalonnage complet (100 %)
ALPHA_SLOW = 0.01                 # adaptation de la ligne de base (lente) ; le score monte à 0,5 / descend à 0,15 par fenêtre
RISE, FALL = 0.5, 0.15
ZMAX = 3.0
DEATH_STREAK_S = 180.0
DEATH_BONUS = 8.0
REPLAY_BEFORE, REPLAY_AFTER = 5.0, 1.0
CAL_FILE = "tilt_calibration.json"

DEFAULTS = {"tilt_enabled": False, "tilt_threshold": 70, "tilt_cooldown_min": 8, "tilt_voice": True, "tilt_bubble": True,
            "tilt_replay_vision": False, "tilt_death_detect": False, "tilt_max_replays": 20, "tilt_mic": True}
BOUNDS = {"tilt_threshold": (30, 95), "tilt_cooldown_min": (1, 120), "tilt_max_replays": (1, 200)}

WEIGHTS = {"mouse_speed": 0.05, "mouse_speed_std": 0.10, "mouse_jerk": 0.15, "mouse_reversals": 0.20, "mouse_shakes": 0.15,
           "keys_per_s": 0.10, "key_burst": 0.10, "audio_peak": 0.07, "audio_sighs": 0.05, "audio_bursts": 0.08}
LABELS = {"mouse_speed": "souris rapide", "mouse_speed_std": "souris irrégulière", "mouse_jerk": "souris saccadée",
          "mouse_reversals": "demi-tours de souris", "mouse_shakes": "secousses de souris", "keys_per_s": "frappe rapide",
          "key_burst": "rafales de touches", "audio_peak": "volume élevé", "audio_sighs": "soupirs", "audio_bursts": "éclats de voix"}
STD_FLOOR = {"mouse_speed": 30.0, "mouse_speed_std": 30.0, "mouse_jerk": 5000.0, "mouse_reversals": 0.2, "mouse_shakes": 0.3,
             "keys_per_s": 0.3, "key_burst": 1.0, "audio_peak": 0.01, "audio_sighs": 0.3, "audio_bursts": 0.3}

SUGGESTIONS = ["Respire : inspire 4 secondes, souffle 6, trois fois", "Fais une pause de 2 minutes", "Bois un verre d'eau"]
FALLBACKS = [
    "[exhales] Respire un coup. Une erreur ne fait pas la partie : prends 2 minutes, bois de l'eau, et reviens plus lucide.",
    "[hmm] Hey, on ralentit. Souffle profondément, étire-toi 2 minutes et reprends avec la tête froide.",
    "[exhales] Doucement, champion. Pause de 2 minutes, un verre d'eau, et on analyse ça tranquillement.",
    "Stop, respire. Le prochain round se gagne calme : 2 minutes de pause et un peu d'eau.",
]
_NAME_RE = re.compile(r"[A-Za-z0-9_-]{1,80}\.mp4")


# ----------------------------------------------------------------------------- signaux : fonctions pures
def mouse_features(samples, min_dt=0.05, shake_acc=15000.0, min_rev_speed=200.0):
    """samples : [(t, x, y)]. Retourne {mouse_speed, mouse_speed_std, mouse_jerk, mouse_reversals (/s), mouse_shakes (/s), path} ou None."""
    pts = []
    for t, x, y in samples:
        if not pts or t - pts[-1][0] >= min_dt:
            pts.append((t, float(x), float(y)))
    if len(pts) < 3:
        return None
    dur = max(pts[-1][0] - pts[0][0], 1e-6)
    v, dts = [], []
    for a, b in zip(pts, pts[1:]):
        dt = b[0] - a[0]
        v.append(((b[1] - a[1]) / dt, (b[2] - a[2]) / dt))
        dts.append(dt)
    spd = [float(np.hypot(*q)) for q in v]
    acc = [float(np.hypot(v[i][0] - v[i - 1][0], v[i][1] - v[i - 1][1])) / dts[i] for i in range(1, len(v))]
    jerk = [abs(acc[i] - acc[i - 1]) / dts[i + 1] for i in range(1, len(acc))]
    rev = 0
    for i in range(1, len(v)):
        if spd[i] > min_rev_speed and spd[i - 1] > min_rev_speed:
            cos = (v[i][0] * v[i - 1][0] + v[i][1] * v[i - 1][1]) / (spd[i] * spd[i - 1])
            if cos < -0.5:
                rev += 1
    path = float(sum(np.hypot(b[1] - a[1], b[2] - a[2]) for a, b in zip(pts, pts[1:])))
    return {"mouse_speed": float(np.mean(spd)), "mouse_speed_std": float(np.std(spd)),
            "mouse_jerk": float(np.mean(jerk)) if jerk else 0.0, "mouse_reversals": rev / dur,
            "mouse_shakes": sum(1 for a in acc if a > shake_acc) / dur, "path": path}


def key_features(events, duration):
    """events : [(t, n_appuis)] (compteurs seulement). Retourne {keys_per_s, key_burst (max d'appuis sur 1 s), presses}."""
    total = int(sum(n for _, n in events))
    bins = collections.Counter()
    for t, n in events:
        bins[int(t)] += int(n)
    return {"keys_per_s": total / max(duration, 1e-6), "key_burst": float(max(bins.values()) if bins else 0), "presses": total}


def audio_frames(x, sr=16000, frame_s=0.1):
    """Découpe un bloc mono (float -1..1) en tranches et retourne [(rms, centroïde Hz, largeur de bande Hz, tonalité = part d'énergie des 3 plus fortes raies)]. Rien d'autre n'est gardé."""
    x = np.asarray(x, dtype=np.float32)
    n = int(sr * frame_s)
    out = []
    for i in range(0, len(x) - n + 1, n):
        f = x[i:i + n]
        rms = float(np.sqrt(np.mean(f * f)))
        mag = np.abs(np.fft.rfft(f * np.hanning(n)))
        freqs = np.fft.rfftfreq(n, 1.0 / sr)
        s = float(mag.sum()) + 1e-12
        cen = float((freqs * mag).sum() / s)
        bw = float(np.sqrt(((freqs - cen) ** 2 * mag).sum() / s))
        p = mag * mag
        out.append((rms, cen, bw, float(np.sort(p)[-3:].sum() / (p.sum() + 1e-12))))
    return out


def audio_features(frames, floor, frame_s=0.1, burst_ratio=8.0):
    """frames : sortie d'audio_frames. floor : bruit de fond (RMS). Retourne {audio_peak, audio_sighs, audio_bursts}.
    Soupir = souffle large bande, centroïde bas, non tonal, 0,5-2 s. Éclat = pic net au-dessus de burst_ratio x le fond (cri, coup sur le bureau)."""
    floor = max(float(floor), 1e-4)
    peak = max((f[0] for f in frames), default=0.0)
    sighs = bursts = 0
    run = []

    def close(r):
        nonlocal sighs, bursts
        if not r:
            return
        dur = len(r) * frame_s
        sighlike = sum(1 for f in r if f[1] < 2000 and f[2] > 300 and f[3] < 0.3) / len(r)
        pk = max(f[0] for f in r)
        if 0.5 <= dur <= 2.0 and sighlike >= 0.6:
            sighs += 1
        elif pk > max(floor * burst_ratio, 0.08) and dur <= 2.0:
            bursts += 1
    for f in frames:
        if f[0] > max(floor * 3.0, 0.004):
            run.append(f)
        else:
            close(run)
            run = []
    close(run)
    return {"audio_peak": float(peak), "audio_sighs": float(sighs), "audio_bursts": float(bursts)}


def frame_stats(frame):
    """Statistiques d'une image RGB uint8 (H,W,3) sous-échantillonnée : (saturation, luminosité, fraction rouge dominant)."""
    a = np.asarray(frame)[::8, ::8, :3].astype(np.float32)
    mx, mn = a.max(axis=2), a.min(axis=2)
    sat = float(np.mean((mx - mn) / (mx + 1.0)))
    val = float(np.mean(mx) / 255.0)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    red = float(np.mean((r > 90) & (r > 1.6 * g) & (r > 1.6 * b)))
    return sat, val, red


def death_condition(stats, base):
    """Quelle anomalie (desat | dark | red) sépare `stats` de la base (médiane récente) ? None si aucune."""
    sat, val, red = stats
    bsat, bval, bred = base
    if bval >= 0.25 and val <= 0.35 * bval:
        return "dark"
    if bsat >= 0.18 and sat <= 0.4 * bsat:
        return "desat"
    if red >= 0.35 and bred <= 0.12:
        return "red"
    return None


class DeathDetector:
    """Heuristique générique : chute brutale de saturation, assombrissement plein écran ou dominante rouge soudaine.
    Garde-fous : l'anomalie doit tenir `min_hold` s, être BRUSQUE (l'échantillon juste avant ne la présentait pas), et `cooldown` s entre deux détections."""

    def __init__(self, min_hold=0.5, cooldown=30.0, history_s=8.0):
        self.min_hold, self.cooldown, self.history_s = min_hold, cooldown, history_s
        self.hist = collections.deque()
        self.last = -1e9

    def feed(self, ts, frame):
        """Retourne 'desat' | 'dark' | 'red' quand une mort probable est détectée, sinon None."""
        st = frame_stats(frame)
        self.hist.append((ts, st))
        while self.hist and ts - self.hist[0][0] > self.history_s:
            self.hist.popleft()
        if ts - self.last < self.cooldown:
            return None
        old = [s for t, s in self.hist if t <= ts - 1.0]
        if len(old) < 4:
            return None
        base = tuple(float(np.median([s[i] for s in old])) for i in range(3))
        win = [s for t, s in self.hist if t >= ts - self.min_hold]
        if len(win) < 2 or self.hist[0][0] > ts - self.min_hold - 0.3:
            return None
        kinds = {death_condition(s, base) for s in win}
        if len(kinds) != 1 or None in kinds:
            return None
        pre = [s for t, s in self.hist if t <= ts - self.min_hold - 0.3]
        if not pre:
            return None
        p = pre[-1]
        kind = next(iter(kinds))
        if death_condition(p, base) is not None:
            return None
        if kind == "dark" and p[1] < 0.75 * base[1] or kind == "desat" and p[0] < 0.75 * base[0] or kind == "red" and p[2] > 0.5 * 0.35:
            return None
        self.last = ts
        return kind


# ----------------------------------------------------------------------------- étalonnage et score
class Baseline:
    """Moyenne / variance par signal. Cumul exact au début, puis moyenne glissante LENTE (alpha 0,01 par fenêtre active)."""

    def __init__(self):
        self.stats = {}          # nom -> [n, mean, var]
        self.windows = 0

    def z(self, name, value):
        s = self.stats.get(name)
        if s is None or s[0] < 5 or value is None:
            return 0.0
        sd = max(np.sqrt(s[2]), 0.1 * abs(s[1]), STD_FLOOR.get(name, 1e-3))
        return float((value - s[1]) / sd)

    def update(self, feats):
        self.windows += 1
        for name in WEIGHTS:
            v = feats.get(name)
            if v is None:
                continue
            s = self.stats.setdefault(name, [0, float(v), 0.0])
            s[0] += 1
            a = max(1.0 / s[0], ALPHA_SLOW)
            d = v - s[1]
            s[1] += a * d
            s[2] = (1 - a) * (s[2] + a * d * d)

    def percent(self):
        return min(100.0, 100.0 * self.windows / CAL_FULL_WINDOWS)

    def calibrated(self):
        return self.windows >= CAL_MIN_WINDOWS

    def to_json(self):
        return {"version": 1, "windows": self.windows, "stats": {k: [int(v[0]), float(v[1]), float(v[2])] for k, v in self.stats.items()}}

    def from_json(self, d):
        self.windows = int(d.get("windows", 0))
        self.stats = {k: [int(v[0]), float(v[1]), float(v[2])] for k, v in d.get("stats", {}).items() if k in WEIGHTS}


def compute_score(zs, bonus=0.0):
    """Cible 0-100 : moyenne pondérée des z positifs (plafonnés à ZMAX) sur les canaux disponibles + bonus contextuel. Retourne (cible, contributions)."""
    tot = sum(WEIGHTS[k] for k in zs)
    if tot <= 0:
        return min(100.0, bonus), {}
    contrib = {k: WEIGHTS[k] * min(max(z, 0.0), ZMAX) / ZMAX for k, z in zs.items()}
    return min(100.0, 100.0 * sum(contrib.values()) / tot + bonus), contrib


def smooth(score, target):
    return score + (RISE if target > score else FALL) * (target - score)


# ----------------------------------------------------------------------------- sources (injectables)
class FakeInput:
    """Souris / clavier synthétiques. mouse_fn(t)->(x,y) ; key_fn(t)->nombre d'appuis depuis la lecture précédente."""

    def __init__(self, mouse_fn=None, key_fn=None):
        self.mouse_fn = mouse_fn or (lambda t: (500 + 100 * np.sin(t), 400))
        self.key_fn = key_fn or (lambda t: 0)

    def mouse_pos(self):
        return self.mouse_fn(time.time())

    def key_presses(self):
        return int(self.key_fn(time.time()))

    def close(self):
        pass


class FakeMic:
    """Micro synthétique : read() -> bloc float32 mono de 100 ms."""

    def __init__(self, fn=None, sr=16000):
        self.sr = sr
        self.fn = fn or (lambda n: np.random.default_rng().normal(0, 0.002, n).astype(np.float32))

    def read(self):
        time.sleep(0.02)
        return self.fn(int(self.sr * 0.1))

    def close(self):
        pass


class FakeCapture:
    """Faux nasko_capture.capture : enregistre les appels d'export."""

    def __init__(self, now=1000.0, running=True, fail=False):
        self._now, self._running, self.fail, self.calls = now, running, fail, []

    def now(self):
        return self._now

    def running(self):
        return self._running

    def export_segment(self, start_ts, end_ts, path, *, vertical=False, with_audio=True, zoom=None, webcam=None):
        self.calls.append((start_ts, end_ts, path))
        if self.fail:
            raise RuntimeError("export impossible")
        with open(path, "wb") as f:
            f.write(b"\x00\x00\x00\x18ftypmp42")
        return {"path": path, "duration": end_ts - start_ts, "frames": 360, "size_bytes": os.path.getsize(path)}


class FakeLLM:
    def __init__(self, reply="[exhales] Respire, tu as raté parce qu'il avait l'avantage de la hauteur. Prends 2 minutes.", fail=False):
        self.reply, self.fail, self.calls = reply, fail, []

    def __call__(self, system, user):
        self.calls.append((system, user))
        if self.fail:
            raise RuntimeError("LLM indisponible")
        return self.reply


class FakeSpeaker:
    def __init__(self):
        self.said = []

    def __call__(self, text):
        self.said.append(text)


class FakeNotifier:
    def __init__(self):
        self.sent = []

    def __call__(self, title, message):
        self.sent.append((title, message))


class WinInput:
    """Entrées Windows réelles par POLLING (ctypes) : GetCursorPos + GetAsyncKeyState. Aucun hook global. Pour le clavier on ne garde que le
    NOMBRE de touches enfoncées ; un appui = hausse de ce nombre. Aucune identité de touche n'est lue ni stockée."""

    def __init__(self):
        import ctypes
        if not hasattr(ctypes, "windll"):
            raise RuntimeError("Anti-Tilt : les entrées réelles ne sont disponibles que sous Windows.")
        self._u = ctypes.windll.user32
        import ctypes.wintypes as wt
        self._pt = wt.POINT()
        self._down = 0

    def mouse_pos(self):
        self._u.GetCursorPos(self._pt)
        return self._pt.x, self._pt.y

    def key_presses(self):
        n = sum(1 for vk in range(0x08, 0xFF) if self._u.GetAsyncKeyState(vk) & 0x8000)
        new = max(0, n - self._down)
        self._down = n
        return new

    def close(self):
        pass


class WinMic:
    """Micro réel via soundcard : blocs de 100 ms remis tels quels à l'agrégateur, jamais écrits ni conservés."""

    def __init__(self, sr=16000):
        import soundcard as sc
        self.sr = sr
        self._rec = sc.default_microphone().recorder(samplerate=sr, channels=1)
        self._rec.__enter__()

    def read(self):
        return self._rec.record(numframes=int(self.sr * 0.1))[:, 0]

    def close(self):
        try:
            self._rec.__exit__(None, None, None)
        except Exception:                                                  # noqa: BLE001
            pass


def _load_capture():
    import nasko_capture
    return nasko_capture.capture


# ----------------------------------------------------------------------------- agrégation d'une fenêtre
class Aggregator:
    """Accumule, pour la fenêtre courante, des échantillons NUMÉRIQUES (t,x,y), (t,n_appuis), (rms,cen,bw,crête). Jamais de touche, jamais d'audio."""

    def __init__(self, with_mic=False):
        self.lock = threading.Lock()
        self.with_mic = with_mic
        self.mouse, self.keys, self.frames = [], [], []
        self.floor = 0.002
        self.t0 = None

    def feed_input(self, t, pos, n):
        with self.lock:
            if self.t0 is None:
                self.t0 = t
            self.mouse.append((t, pos[0], pos[1]))
            if n:
                self.keys.append((t, int(n)))

    def feed_audio(self, block, sr=16000):
        fr = audio_frames(block, sr)                 # le bloc brut est jeté ici
        with self.lock:
            self.frames.extend(fr)

    def close(self, t):
        with self.lock:
            mouse, keys, frames, t0 = self.mouse, self.keys, self.frames, self.t0
            self.mouse, self.keys, self.frames, self.t0 = [], [], [], None
        dur = max((t - t0) if t0 is not None else WINDOW_S, 1e-3)
        return build_features(mouse, keys, frames, self, dur)


def build_features(mouse, keys, frames, agg, dur):
    """Fenêtre -> dict de signaux (None = canal absent) + 'active'."""
    f = {k: None for k in WEIGHTS}
    m = mouse_features(mouse)
    if m:
        f.update({k: m[k] for k in ("mouse_speed", "mouse_speed_std", "mouse_jerk", "mouse_reversals", "mouse_shakes")})
    k = key_features(keys, dur)
    f["keys_per_s"], f["key_burst"] = k["keys_per_s"], k["key_burst"]
    if agg.with_mic and frames:
        rms = sorted(x[0] for x in frames)
        agg.floor = 0.9 * agg.floor + 0.1 * max(rms[len(rms) // 5], 1e-4)
        f.update(audio_features(frames, agg.floor))
    f["active"] = bool((m and m["path"] > 5.0) or k["presses"] > 0)
    return f


# ----------------------------------------------------------------------------- le coach
class Coach:
    def __init__(self, *, input=None, mic=None, llm=None, speaker=None, notifier=None, capture=None, capture_loader=None, vision=None,
                 frame_source=None, frame_extractor=None, cfg_load=None, cfg_save=None, data_dir=None, clock=None, sleep=None,
                 sync=False, window_s=WINDOW_S, hz=HZ, rng=None):
        self.input, self.mic, self._llm, self._speaker, self._notifier = input, mic, llm, speaker, notifier
        self._capture_obj, self._capture_loader = capture, capture_loader or _load_capture
        self._vision, self.frame_source, self._frame_extractor = vision, frame_source, frame_extractor
        self._cfg_load, self._cfg_save, self._data_dir = cfg_load, cfg_save, data_dir
        self.clock, self._sleep = clock or time.time, sleep or time.sleep
        self.sync, self.window_s, self.hz = sync, window_s, hz
        self.rng = rng or random.Random()
        self.lock = threading.RLock()
        self.baseline = Baseline()
        self.agg = Aggregator()
        self.history = collections.deque(maxlen=HISTORY_MAX)     # (t, score) : nombres uniquement
        self.score = 0.0
        self.signals = []
        self.armed = True
        self.over = 0
        self.last_iv = None
        self.last_iv_ts = -1e12
        self.last_replay = None
        self.deaths = collections.deque(maxlen=20)
        self.threads, self.stop_ev, self.running = [], threading.Event(), False
        self.error = None
        self.detector = DeathDetector()
        self._saved_at = 0
        self._load_calibration()

    # ----- config / chemins
    def _load(self):
        if self._cfg_load:
            return dict(self._cfg_load())
        import nasko_core
        return nasko_core.load_config()

    def config(self):
        raw = self._load()
        out = dict(DEFAULTS)
        for k, d in DEFAULTS.items():
            if k in raw:
                out[k] = _coerce(k, raw[k], d)
        return out

    def set_config(self, values):
        clean = {}
        ignored = []
        for k, v in (values or {}).items():
            if k in DEFAULTS:
                clean[k] = _coerce(k, v, DEFAULTS[k])
            else:
                ignored.append(k)
        if clean:
            if self._cfg_save:
                self._cfg_save(clean)
            else:
                import nasko_core
                nasko_core.update_config(clean)
        res = self.config()
        res["ignored"] = ignored
        return res

    def data_dir(self):
        if self._data_dir:
            return self._data_dir()
        import nasko_core
        return nasko_core.data_dir()

    def replays_dir(self):
        p = os.path.join(self.data_dir(), "Replays")
        os.makedirs(p, exist_ok=True)
        return p

    def _cal_path(self):
        return os.path.join(self.data_dir(), CAL_FILE)

    def _load_calibration(self):
        try:
            p = self._cal_path()
            if os.path.isfile(p):
                with open(p, "r", encoding="utf-8") as f:
                    self.baseline.from_json(json.load(f))
        except Exception as e:                                           # noqa: BLE001 — étalonnage corrompu : on repart de zéro
            log.info("Étalonnage illisible : %s", e)
            self.baseline = Baseline()

    def save_calibration(self):
        try:
            p = self._cal_path()
            tmp = p + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.baseline.to_json(), f)
            os.replace(tmp, p)
            self._saved_at = self.baseline.windows
        except OSError as e:
            log.warning("Étalonnage non enregistré : %s", e)

    def reset(self):
        with self.lock:
            self.baseline = Baseline()
            self.score, self.signals, self.over, self.armed = 0.0, [], 0, True
            self.history.clear()
            self.deaths.clear()
            self.last_iv, self.last_iv_ts = None, -1e12
            self.detector = DeathDetector()
            try:
                os.remove(self._cal_path())
            except OSError:
                pass
        return self.status()

    # ----- moteur : une fenêtre
    def death_streak(self, now):
        return sum(1 for d in self.deaths if now - d <= DEATH_STREAK_S)

    def process_window(self, feats, now=None):
        """Intègre une fenêtre de 5 s. Retourne l'intervention déclenchée (dict) si elle est synchrone, sinon None."""
        now = self.clock() if now is None else now
        cfg = self.config()
        with self.lock:
            streak = self.death_streak(now)
            if not feats.get("active"):
                self.score = smooth(self.score, min(100.0, streak * DEATH_BONUS) if streak else 0.0)
                self.signals, self.over = [], 0
                self.history.append((now, self.score))
                self._maybe_rearm(cfg)
                return None
            zs = {k: self.baseline.z(k, feats.get(k)) for k in WEIGHTS if feats.get(k) is not None}
            target, contrib = compute_score(zs, min(3, streak) * DEATH_BONUS)
            prev = self.score
            self.score = smooth(self.score, target)
            self.signals = [{"name": k, "label": LABELS[k], "z": round(zs[k], 1)}
                            for k, c in sorted(contrib.items(), key=lambda kv: -kv[1])[:3] if zs[k] >= 1.0]
            if prev < 0.5 * cfg["tilt_threshold"] or not self.baseline.calibrated():   # pas d'apprentissage pendant un énervement
                self.baseline.update(feats)
                if self.baseline.windows - self._saved_at >= 12:
                    self.save_calibration()
            self.history.append((now, self.score))
            self._maybe_rearm(cfg)
            self.over = self.over + 1 if self.score >= cfg["tilt_threshold"] else 0
            ok = (cfg["tilt_enabled"] or self.sync) and self.armed and self.baseline.calibrated() and self.over >= 2 \
                and now - self.last_iv_ts >= cfg["tilt_cooldown_min"] * 60
            if not ok:
                return None
            self.armed, self.last_iv_ts = False, now
            score, signals = self.score, list(self.signals)
        if self.sync:
            return self._intervene(score, signals, now)
        t = threading.Thread(target=self._intervene, args=(score, signals, now), daemon=True, name="tilt-intervene")
        t.start()
        self.threads.append(t)
        return None

    def _maybe_rearm(self, cfg):
        if not self.armed and self.score < 0.6 * cfg["tilt_threshold"]:
            self.armed = True

    # ----- intervention
    def _system_prompt(self):
        try:
            import nasko_persona
            base = nasko_persona.chat_prompt(self._load())
        except Exception:                                                  # noqa: BLE001
            base = "Tu es ETO, un streamer bienveillant et calme."
        return base + ("\n\nMISSION : le joueur commence à s'énerver (tilt). Dis-lui, d'une voix posée et chaleureuse, EN DEUX PHRASES COURTES MAXIMUM, "
                       "de respirer et de faire une pause de 2 minutes (eau, respiration). Si une explication de son erreur t'est donnée, utilise-la avec bienveillance. "
                       "Aucune critique, aucune liste, texte brut.")

    def _default_llm(self, system, user):
        import nasko_llm
        return nasko_llm.complete(self._load(), system, user, max_tokens=120, clean=False)

    def _context(self, score, signals, now):
        sig = ", ".join(s["label"] for s in signals) or "agitation générale"
        txt = f"Score de tilt : {int(score)}/100. Signaux dominants : {sig}."
        n = self.death_streak(now)
        if n:
            txt += f" Morts récentes : {n}."
        r = self.last_replay
        if r and r.get("ok") and r.get("explanation") and now - r.get("clock", 0) < DEATH_STREAK_S:
            txt += f" Erreur de la dernière mort : {r['explanation']}"
        return txt

    def _intervene(self, score, signals, now, demo=False):
        cfg = self.config()
        raw = ""
        try:
            raw = (self._llm or self._default_llm)(self._system_prompt(), self._context(score, signals, now)) or ""
        except Exception as e:                                             # noqa: BLE001 — repli sur un message fixe
            log.info("Anti-Tilt : LLM indisponible (%s)", e)
        raw = _two_sentences(raw)
        used_fallback = not raw
        if used_fallback:
            raw = self.rng.choice(FALLBACKS)
        text = _display(raw)
        replay = None
        r = self.last_replay
        if r and r.get("ok") and now - r.get("clock", 0) < DEATH_STREAK_S:
            replay = r.get("name")
        message = text + " • " + " • ".join(SUGGESTIONS) + (f" • Replay de ta dernière mort dispo : {replay}" if replay else "")
        iv = {"ts": now, "score": int(score), "signals": signals, "text": text, "suggestions": list(SUGGESTIONS), "replay": replay,
              "fallback": used_fallback, "demo": demo, "voiced": False}
        if cfg["tilt_voice"]:
            try:
                (self._speaker or _default_speaker(self._load))(raw)
                iv["voiced"] = True
            except Exception as e:                                         # noqa: BLE001 — texte seul
                log.info("Anti-Tilt : voix indisponible (%s)", e)
        try:
            (self._notifier or _default_notifier)("ETO", message)
        except Exception as e:                                             # noqa: BLE001
            log.info("Anti-Tilt : notification impossible (%s)", e)
        with self.lock:
            self.last_iv = iv
        return iv

    def test_intervention(self):
        """Intervention de démonstration (ne touche ni au refroidissement ni à l'armement)."""
        now = self.clock()
        sig = [{"name": "mouse_jerk", "label": LABELS["mouse_jerk"], "z": 3.0}, {"name": "keys_per_s", "label": LABELS["keys_per_s"], "z": 2.5}]
        return self._intervene(max(self.score, 75.0), sig, now, demo=True)

    # ----- replay
    def _capture(self):
        if self._capture_obj is not None:
            return self._capture_obj, None
        try:
            return self._capture_loader(), None
        except Exception:                                                  # noqa: BLE001
            return None, "Capture indisponible : le module d'enregistrement (nasko_capture) n'est pas installé."

    def mark_death(self, ts=None, sync=None):
        """Note une mort : alimente la série de morts et demande à la capture un MP4 [ts-5 s, ts+1 s] dans Replays/. Retourne un dict {ok, ...}."""
        if not self.config()["tilt_enabled"] and not self.sync:
            return {"ok": False, "error": "Anti-Tilt désactivé (tilt_enabled)."}
        now = self.clock()
        with self.lock:
            self.deaths.append(now)
        cap, err = self._capture()
        if cap is None:
            self.last_replay = {"ok": False, "error": err, "clock": now}
            return dict(self.last_replay)
        try:
            if not cap.running():
                self.last_replay = {"ok": False, "error": "Capture non démarrée : lance l'enregistrement du tampon pour obtenir des replays.", "clock": now}
                return dict(self.last_replay)
            if ts is None:
                ts = cap.now()
        except Exception as e:                                             # noqa: BLE001
            self.last_replay = {"ok": False, "error": f"Capture indisponible : {e}", "clock": now}
            return dict(self.last_replay)
        name = time.strftime("mort_%Y%m%d_%H%M%S", time.localtime(now)) + f"_{int(now * 1000) % 1000:03d}.mp4"
        if (self.sync if sync is None else sync):
            return self._export(cap, float(ts), name, now)
        t = threading.Thread(target=self._export, args=(cap, float(ts), name, now), daemon=True, name="tilt-replay")
        t.start()
        self.threads.append(t)
        self.last_replay = {"ok": True, "pending": True, "name": name, "clock": now}
        return dict(self.last_replay)

    def _export(self, cap, ts, name, now):
        try:
            for _ in range(20):                                           # la fin du clip (ts+1) doit exister dans le tampon
                if cap.now() >= ts + REPLAY_AFTER or self.stop_ev.is_set():
                    break
                self._sleep(0.1)
            path = os.path.join(self.replays_dir(), name)
            res = cap.export_segment(ts - REPLAY_BEFORE, ts + REPLAY_AFTER, path)
            rep = {"ok": True, "name": name, "ts": ts, "clock": now, "duration": (res or {}).get("duration"),
                   "size_bytes": (res or {}).get("size_bytes"), "explanation": None}
            cfg = self.config()
            if cfg["tilt_replay_vision"]:
                rep["explanation"] = self._explain(path)
            self.last_replay = rep
            self._purge(cfg["tilt_max_replays"])
            return dict(rep)
        except Exception as e:                                             # noqa: BLE001
            self.last_replay = {"ok": False, "error": f"Export du replay impossible : {e}", "clock": now}
            return dict(self.last_replay)

    def _explain(self, path):
        """UNE image prise ~2 s avant la mort (3 s après le début du clip) -> une phrase du modèle de vision. Échec = pas d'explication."""
        try:
            jpeg = (self._frame_extractor or _ffmpeg_frame)(path, REPLAY_BEFORE - 2.0)
            if not jpeg:
                return None
            ask = "Voici l'image 2 secondes avant la mort du joueur. En UNE phrase courte, bienveillante, quelle erreur a pu causer sa mort ?"
            system = "Tu es ETO, un coach de jeu calme. Une seule phrase, texte brut."
            if self._vision:
                out = self._vision(system, ask, jpeg)
            else:
                import nasko_llm
                out = nasko_llm.vision_raw(self._load(), system, ask, jpeg, 120)
            return _two_sentences(out, 1) or None
        except Exception as e:                                             # noqa: BLE001
            log.info("Anti-Tilt : explication visuelle indisponible (%s)", e)
            return None

    def replays(self):
        d = self.replays_dir()
        out = []
        for n in os.listdir(d):
            p = os.path.join(d, n)
            if _NAME_RE.fullmatch(n) and os.path.isfile(p):
                st = os.stat(p)
                out.append({"name": n, "size_bytes": st.st_size, "mtime": st.st_mtime})
        return sorted(out, key=lambda r: -r["mtime"])

    def replay_path(self, name):
        """Chemin absolu du replay `name` (nom simple validé, confiné à Replays/), ou None."""
        if not isinstance(name, str) or not _NAME_RE.fullmatch(name):
            return None
        d = os.path.realpath(self.replays_dir())
        p = os.path.realpath(os.path.join(d, name))
        if os.path.dirname(p) != d or not os.path.isfile(p):
            return None
        return p

    def _purge(self, keep):
        for r in self.replays()[keep:]:
            try:
                os.remove(os.path.join(self.replays_dir(), r["name"]))
            except OSError:
                pass

    # ----- threads
    def start(self):
        with self.lock:
            if self.running:
                return self.status()
            cfg = self.config()
            self.error = None
            try:
                if self.input is None:
                    self.input = WinInput()
                if cfg["tilt_mic"] and self.mic is None:
                    try:
                        self.mic = WinMic()
                    except Exception as e:                                 # noqa: BLE001 — sans micro on continue avec souris + clavier
                        log.info("Anti-Tilt : micro indisponible (%s)", e)
            except Exception as e:                                         # noqa: BLE001
                self.error = str(e)
                return self.status()
            self.agg = Aggregator(with_mic=bool(self.mic) and cfg["tilt_mic"])
            self.stop_ev = threading.Event()
            self.running = True
            specs = [("tilt-sampler", self._sampler)]
            if self.agg.with_mic:
                specs.append(("tilt-mic", self._mic_loop))
            if cfg["tilt_death_detect"]:
                specs.append(("tilt-death", self._death_loop))
            self.threads = [threading.Thread(target=fn, daemon=True, name=n) for n, fn in specs]
            for t in self.threads:
                t.start()
        return self.status()

    def stop(self):
        with self.lock:
            was = self.running
            self.running = False
            self.stop_ev.set()
            threads, self.threads = list(self.threads), []
        for t in threads:
            t.join(timeout=3.0)
        if was:
            self.save_calibration()
            for src in (self.input, self.mic):
                try:
                    if src is not None and hasattr(src, "close"):
                        src.close()
                except Exception:                                          # noqa: BLE001
                    pass
        return self.status()

    def _sampler(self):
        stop = self.stop_ev
        next_close = self.clock() + self.window_s
        while not stop.wait(1.0 / self.hz):
            t = self.clock()
            try:
                self.agg.feed_input(t, self.input.mouse_pos(), self.input.key_presses())
            except Exception as e:                                         # noqa: BLE001
                self.error = f"entrée : {e}"
                continue
            if t >= next_close:
                next_close = t + self.window_s
                try:
                    self.process_window(self.agg.close(t), t)
                except Exception as e:                                     # noqa: BLE001
                    log.warning("Anti-Tilt : fenêtre ignorée (%s)", e)

    def _mic_loop(self):
        while not self.stop_ev.is_set():
            try:
                self.agg.feed_audio(self.mic.read(), getattr(self.mic, "sr", 16000))
            except Exception as e:                                         # noqa: BLE001
                self.error = f"micro : {e}"
                self.stop_ev.wait(1.0)

    def _death_loop(self):
        while not self.stop_ev.wait(0.25):
            try:
                got = self.frame_source() if self.frame_source else _capture_frame(self)
                if not got:
                    continue
                ts, frame = got
                if self.detector.feed(ts, frame):
                    self.mark_death(ts=ts)
            except Exception as e:                                         # noqa: BLE001
                log.info("Anti-Tilt : détection de mort : %s", e)

    # ----- état
    def status(self):
        with self.lock:
            cfg = self.config()
            iv = self.last_iv
            now = self.clock()
            bubble = iv["text"] if (cfg["tilt_bubble"] and iv and now - iv["ts"] < 90) else None
            return {"enabled": cfg["tilt_enabled"], "running": self.running, "score": int(round(self.score)), "signals": list(self.signals),
                    "calibration": int(round(self.baseline.percent())), "calibrated": self.baseline.calibrated(),
                    "death_streak": self.death_streak(now), "last_intervention": dict(iv) if iv else None, "bubble": bubble,
                    "last_replay": dict(self.last_replay) if self.last_replay else None, "voice": cfg["tilt_voice"],
                    "error": self.error}


# ----------------------------------------------------------------------------- utilitaires
def _coerce(key, value, default):
    if isinstance(default, bool):
        if isinstance(value, str):
            return value.strip().lower() in ("1", "true", "yes", "oui", "on")
        return bool(value)
    try:
        v = int(float(value))
    except (TypeError, ValueError):
        return default
    lo, hi = BOUNDS[key]
    return max(lo, min(hi, v))


def _two_sentences(text, n=2):
    text = re.sub(r"[*_`#>~]+", "", str(text or "")).strip()
    parts = re.findall(r"[^.!?…]+[.!?…]+|[^.!?…]+$", text)
    out = " ".join(p.strip() for p in parts[:n]).strip()
    return out[:260].strip()


def _display(raw):
    try:
        import nasko_persona
        return nasko_persona.clean(raw)
    except Exception:                                                      # noqa: BLE001
        return re.sub(r"\[[^\]]{1,30}\]", "", raw).strip()


def _default_notifier(title, message):
    import nasko_notify
    nasko_notify.push(title, message, level="info", source="tilt", speak=False)


def _default_speaker(cfg_loader):
    def speak(text):
        import nasko_eleven
        cfg = cfg_loader()
        path = nasko_eleven.synthesize(text, cfg, "eto")
        _play_mp3(path)
    return speak


def _play_mp3(path):
    import ctypes
    if not hasattr(ctypes, "windll"):
        raise RuntimeError("lecture audio locale : Windows uniquement")
    mci = ctypes.windll.winmm.mciSendStringW
    mci('close tiltvoice', None, 0, None)
    mci(f'open "{path}" type mpegvideo alias tiltvoice', None, 0, None)
    mci('play tiltvoice', None, 0, None)


def _ffmpeg_frame(path, offset):
    import subprocess
    import nasko_compress
    exe = nasko_compress.ffmpeg_exe()
    if not exe:
        return None
    r = subprocess.run([exe, "-loglevel", "error", "-ss", str(offset), "-i", path, "-frames:v", "1", "-vf", "scale=960:-2", "-f", "image2pipe", "-vcodec", "mjpeg", "-"],
                       capture_output=True, timeout=30, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return r.stdout if r.returncode == 0 and r.stdout else None


def _capture_frame(coach):
    """Dernière image du tampon de nasko_capture (frames() renvoie du BGR -> RGB), ou None si déjà vue / capture absente."""
    cap, _ = coach._capture()
    if cap is None or not hasattr(cap, "frames") or not cap.running():
        return None
    now = cap.now()
    got = cap.frames(now - 0.6, now)
    if not got or got[-1][0] <= getattr(coach, "_last_frame_ts", -1):
        return None
    coach._last_frame_ts = got[-1][0]
    return got[-1][0], np.ascontiguousarray(got[-1][1][..., ::-1])


# ----------------------------------------------------------------------------- API module
_coach = None
_clock_lock = threading.Lock()


def get():
    global _coach
    with _clock_lock:
        if _coach is None:
            _coach = Coach()
        return _coach


def start():
    return get().start()


def stop():
    return get().stop()


def status():
    return get().status()


def mark_death(ts=None):
    return get().mark_death(ts)


def config():
    return get().config()


def set_config(values):
    return get().set_config(values)


def reset():
    return get().reset()


def autostart():
    """Au démarrage de l'app : ne fait RIEN (aucun thread, aucune lecture) tant que tilt_enabled est faux."""
    c = get()
    if not c.config()["tilt_enabled"]:
        return False
    c.start()
    return True


def test_intervention():
    return get().test_intervention()


def replays():
    return get().replays()


def replay_path(name):
    return get().replay_path(name)
