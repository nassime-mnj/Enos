"""AUTO-CLIPPER IA : Enos tourne en fond ; sur un moment fort (cri de joie, rire explosif, multi-kill) il clippe les N dernières secondes,
ajoute un zoom dynamique sur le réticule / curseur (ou la webcam) et sort un MP4 VERTICAL 1080x1920 (TikTok / Shorts) dans <data_dir>/Clips/.

  start() / stop() / autostart() ; status() ; trigger(label) ; list_clips() ; delete_clip(name) ; clip_path(name) ; config() / set_config(dict)

VIE PRIVÉE : OPT-IN strict (clipper_enabled faux par défaut : rien ne tourne, rien n'est tamponné) ; tampon en RAM (nasko_capture) ;
aucun hook clavier/souris ; seule la confirmation visuelle (clipper_vision_confirm, faux par défaut) envoie ≤ 3 images (une planche) au fournisseur LLM
configuré, ≤ 1 appel / 30 s, sans rien conserver.
"""
import collections
import datetime as _dt
import json
import logging
import os
import queue
import re
import threading
import time

import numpy as np

import nasko_core

log = logging.getLogger("nasko.clipper")

DEFAULTS = {"clipper_enabled": False, "clipper_sensitivity": 50, "clipper_seconds": 30, "clipper_mode": "fps",
            "clipper_vision_confirm": False, "clipper_webcam": False, "clipper_max_clips": 30}
POST_ROLL = 2.0                    # s capturées APRÈS l'instant de détection
VISION_MIN_INTERVAL = 30.0
NAME_RE = re.compile(r"^\d{8}-\d{6}-[a-z0-9-]{1,40}\.(mp4|jpg|json)$")
RATE = 16000


# ============================================================================= détecteur d'excitation audio (pur, testable)
class ExcitementDetector:
    """Blocs audio (jeu + micro) -> score 0-100 + événements.

    Par trame de 25 ms et par source : énergie de la bande 500-4000 Hz relative à une ligne de base adaptative (médiane glissante 20 s),
    forme spectrale (part de bande, centroïde, taux de passage par zéro : un grondement grave n'est ni un cri ni un rire), modulation d'enveloppe sur 1 s
    (un bruit constant ne varie pas, une voix oui). Déclenchement : au moins 0,4 s de trames « fortes » dans la dernière seconde (un cri soutenu OU des
    bouffées de rire répétées ; un clic isolé non), avec hystérésis (ré-armement après 1 s de calme) et refroidissement ≥ 20 s.
    Le micro pèse 1,0 et l'audio du jeu 0,5 : le jeu seul ne déclenche qu'à sensibilité élevée (≥ 60)."""

    HOP_S = 0.025
    BASE_FRAMES = 800              # 20 s
    WARMUP_FRAMES = 120            # 3 s de ligne de base avant de pouvoir déclencher
    MIN_ACTIVE = 16                # 0,4 s
    WEIGHT = {"mic": 1.0, "out": 0.5}
    FLOOR = 0.002

    def __init__(self, sensitivity=50, rate=RATE, cooldown=20.0):
        self.rate = int(rate)
        self.hop = int(self.rate * self.HOP_S)
        self.sensitivity = sensitivity
        self.cooldown = cooldown
        self._buf = {"out": np.zeros(0, np.float32), "mic": np.zeros(0, np.float32)}
        self._hist = {"out": collections.deque(maxlen=self.BASE_FRAMES), "mic": collections.deque(maxlen=self.BASE_FRAMES)}
        self._rms = {"out": collections.deque(maxlen=40), "mic": collections.deque(maxlen=40)}
        self._act = collections.deque(maxlen=40)               # (t, inst, active)
        self._freqs = np.fft.rfftfreq(512, 1.0 / self.rate)
        self._band = (self._freqs >= 500) & (self._freqs <= 4000)
        self._win = np.hanning(self.hop)
        self.score = 0.0
        self.frames_seen = 0
        self.armed = True
        self.last_fire = -1e9
        self.last_features = {}

    # ---- réglages
    @property
    def sensitivity(self):
        return self._sens

    @sensitivity.setter
    def sensitivity(self, v):
        self._sens = max(0.0, min(100.0, float(v)))

    @property
    def cooldown(self):
        return self._cool

    @cooldown.setter
    def cooldown(self, v):
        self._cool = max(20.0, float(v))                      # jamais sous 20 s

    @property
    def threshold(self):
        """Seuil d'une trame « forte » (0-100) : 80 à sensibilité 0, 55 à 50, 30 à 100."""
        return 80.0 - 0.5 * self._sens

    # ---- analyse
    def _frame(self, x):
        """(rms, band_rms, band_frac, centroid, zcr_hz) d'une trame."""
        rms = float(np.sqrt(np.mean(x * x))) if len(x) else 0.0
        if rms < 1e-7:
            return 0.0, 0.0, 0.0, 0.0, 0.0
        sp = np.abs(np.fft.rfft(x * self._win, 512)) ** 2
        tot = float(sp.sum()) + 1e-12
        band = float(sp[self._band].sum())
        cen = float((self._freqs * sp).sum() / tot)
        zc = float(np.count_nonzero(np.diff(np.signbit(x)))) / (len(x) / self.rate)
        return rms, float(np.sqrt(band)) / len(x), band / tot, cen, zc

    def _level(self, src, x):
        rms, brms, bfrac, cen, zcr = self._frame(x)
        hist = self._hist[src]
        base = max(float(np.median(hist)) if len(hist) >= 20 else 0.0, self.FLOOR / 40.0)   # échelle de brms ~ rms/len
        hist.append(brms)
        if base <= 0 or brms <= 0:
            return 0.0, rms
        ratio_db = 20.0 * np.log10(brms / base)
        level = min(1.0, max(0.0, (ratio_db - 8.0) / 16.0))
        shape = min(min(1.0, max(0.0, (bfrac - 0.1) / 0.2)),
                    min(1.0, max(0.0, (cen - 500.0) / 500.0)) * min(1.0, max(0.0, (6500.0 - cen) / 2000.0)),
                    min(1.0, max(0.0, (zcr - 400.0) / 600.0)))
        self.last_features[src] = {"rms": round(rms, 4), "db": round(float(ratio_db), 1), "bfrac": round(bfrac, 2), "centroid": int(cen), "zcr": int(zcr)}
        return level * shape, rms

    def _modulation(self, src, rms):
        """0,2-1 : variabilité image à image de l'enveloppe sur 1 s (robuste à une marche brutale : 1 transition sur 40). Bruit constant -> 0,2 ; voix -> 1."""
        q = self._rms[src]
        q.append(rms)
        if len(q) < 12:
            return 0.2
        r = np.array(q)
        rel = np.abs(np.diff(r)) / (0.5 * (r[1:] + r[:-1]) + 1e-9)
        return min(1.0, max(0.2, (float(np.percentile(rel, 85)) - 0.10) / 0.12))

    def feed(self, out, mic, ts_end):
        """Ajoute des blocs (int16 ou float ±1, même fréquence `self.rate`) finissant à `ts_end`. Retourne la liste des événements déclenchés."""
        events = []
        for src, blk in (("out", out), ("mic", mic)):
            a = np.zeros(0, np.float32) if blk is None else np.asarray(blk)
            a = a.astype(np.float32) / (32768.0 if a.dtype.kind == "i" else 1.0)
            self._buf[src] = np.concatenate([self._buf[src], a])
        n = max(len(self._buf["out"]), len(self._buf["mic"]))
        for src in self._buf:                                   # alignement : la source courte est complétée par du silence
            if len(self._buf[src]) < n:
                self._buf[src] = np.concatenate([self._buf[src], np.zeros(n - len(self._buf[src]), np.float32)])
        thr = self.threshold
        while len(self._buf["out"]) >= self.hop:
            t = ts_end - (len(self._buf["out"]) - self.hop) / self.rate
            inst = 0.0
            for src in ("out", "mic"):
                x, self._buf[src] = self._buf[src][:self.hop], self._buf[src][self.hop:]
                l, r = self._level(src, x)
                inst += 100.0 * self.WEIGHT[src] * l * self._modulation(src, r)
            self.frames_seen += 1
            inst = min(100.0, inst)
            self.score = max(inst, self.score * 0.95)
            self._act.append((t, inst, inst >= thr))
            ev = self._decide(t, thr)
            if ev:
                events.append(ev)
        return events

    def _decide(self, t, thr):
        n_act = sum(1 for _, _, a in self._act if a)
        if not self.armed:
            if n_act == 0 and len(self._act) == self._act.maxlen:
                self.armed = True
            return None
        if n_act < self.MIN_ACTIVE or self.frames_seen < self.WARMUP_FRAMES or t - self.last_fire < self.cooldown:
            return None
        act = [(tt, i) for tt, i, a in self._act if a]
        peak_t, peak = max(act, key=lambda p: p[1])
        self.armed = False
        self.last_fire = t
        return {"ts": t, "peak_ts": peak_t, "score": round(float(np.mean([i for _, i in act])), 1), "peak": round(peak, 1)}


# ============================================================================= configuration validée
def _bool(v):
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes", "oui", "on")
    return bool(v)


def _int(v, lo, hi, default):
    try:
        return max(lo, min(hi, int(round(float(v)))))
    except (TypeError, ValueError):
        return default


def _clean(values, base):
    out = {}
    for k, v in values.items():
        if k not in DEFAULTS:
            continue
        if k in ("clipper_enabled", "clipper_vision_confirm", "clipper_webcam"):
            out[k] = _bool(v)
        elif k == "clipper_sensitivity":
            out[k] = _int(v, 0, 100, base[k])
        elif k == "clipper_seconds":
            out[k] = _int(v, 10, 60, base[k])
        elif k == "clipper_max_clips":
            out[k] = _int(v, 1, 500, base[k])
        elif k == "clipper_mode":
            if str(v).lower() not in ("fps", "cursor"):
                raise ValueError("clipper_mode : « fps » ou « cursor »")
            out[k] = str(v).lower()
    return out


def _slug(label):
    s = re.sub(r"[^a-z0-9]+", "-", _ascii(label).lower()).strip("-")[:24].strip("-")
    return s or "clip"


def _ascii(s):
    import unicodedata
    return unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()


class _Still:
    def __init__(self, img):
        self.img = img

    def grab(self):
        return self.img


def _cv_webcam_grab():
    """Une image de la webcam (ouverte puis refermée aussitôt : la caméra ne reste jamais allumée)."""
    import cv2
    cap = cv2.VideoCapture(0)
    try:
        img = None
        for _ in range(4):
            ok, f = cap.read()
            if ok:
                img = f
        return img
    finally:
        cap.release()


# ============================================================================= Auto-Clipper
class AutoClipper:
    def __init__(self, capture=None, vision=None, webcam_grab=None, clock=None, post_roll=POST_ROLL):
        if capture is None:
            import nasko_capture
            capture = nasko_capture.capture
        self.cap = capture
        self._vision = vision                          # callable(cfg, system, ask, jpeg_bytes) -> texte ; défaut nasko_llm.vision_raw
        self._webcam_grab = webcam_grab or _cv_webcam_grab
        self.post_roll = post_roll
        self.out_size = None                           # (l, h) de sortie ; None = 1080x1920
        self.det = ExcitementDetector()
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._threads = []
        self._running = False
        self._owns_capture = False
        self._q = queue.Queue(maxsize=5)
        self._rendering = None
        self._errors = []
        self._last_clip = None
        self._last_poll = None
        self._last_vision = -1e9
        self._vision_log = {"calls": 0, "refused": 0, "skipped": 0}
        self.score = 0.0

    # ---- configuration
    def config(self):
        try:
            raw = nasko_core.load_config() or {}
        except Exception:                              # noqa: BLE001
            raw = {}
        cfg = dict(DEFAULTS)
        cfg.update(_clean({k: raw[k] for k in DEFAULTS if k in raw}, DEFAULTS))
        return cfg

    def set_config(self, values):
        """Validation bornée puis écriture dans la config locale. Passer clipper_enabled à faux arrête tout ; à vrai démarre (opt-in explicite)."""
        before = self.config()
        clean = _clean(dict(values or {}), before)
        if clean:
            nasko_core.update_config(clean)
        after = self.config()
        if "clipper_enabled" in clean:
            if after["clipper_enabled"] and not self._running:
                self.start()
            elif not after["clipper_enabled"] and self._running:
                self.stop()
        self.det.sensitivity = after["clipper_sensitivity"]
        return after

    # ---- cycle de vie
    def autostart(self):
        """Au démarrage de l'appli : ne fait RIEN si clipper_enabled est faux."""
        if not self.config()["clipper_enabled"]:
            return False
        return self.start().get("running", False)

    def start(self):
        cfg = self.config()
        if not cfg["clipper_enabled"]:
            return {"running": False, "error": "Auto-Clipper désactivé (clipper_enabled)."}
        with self._lock:
            if self._running:
                return self.status()
            self.det = ExcitementDetector(cfg["clipper_sensitivity"], RATE)
            self._owns_capture = not self.cap.running()
            if self._owns_capture:
                self.cap.start(fps=15, seconds=max(40, cfg["clipper_seconds"] + 10), max_width=1280)
            self._last_poll = self.cap.now()
            self._stop.clear()
            self._running = True
            self._threads = [threading.Thread(target=self._watch_loop, daemon=True, name="clipper-watch"),
                             threading.Thread(target=self._render_loop, daemon=True, name="clipper-render")]
            for t in self._threads:
                t.start()
        return self.status()

    def stop(self):
        with self._lock:
            self._running = False
            self._stop.set()
            threads, self._threads = self._threads, []
            owns, self._owns_capture = self._owns_capture, False
        for t in threads:
            t.join(timeout=3.0)
        if owns:
            self.cap.stop()
        return {"running": False}

    def _err(self, msg):
        log.warning("clipper : %s", msg)
        with self._lock:
            self._errors = (self._errors + [{"t": time.time(), "msg": str(msg)[:300]}])[-8:]

    # ---- détection
    def _to_rate(self, a, r):
        if r == RATE or len(a) == 0:
            return a
        n = int(len(a) * RATE / r)
        return np.interp(np.linspace(0, len(a) - 1, n), np.arange(len(a)), a.astype(np.float32)).astype(np.int16)

    def poll(self):
        """Une passe de détection sur l'audio arrivé depuis la précédente (appelée par le thread ; publique pour les tests)."""
        now = self.cap.now() - 0.3
        t0 = self._last_poll if self._last_poll is not None else now - 1
        if now - t0 < 0.1:
            return []
        t0 = max(t0, now - 10.0)
        self._last_poll = now
        out, ro = self.cap.audio(t0, now, "out")
        mic, rm = self.cap.audio(t0, now, "mic")
        events = self.det.feed(self._to_rate(out, ro), self._to_rate(mic, rm), now)
        self.score = round(self.det.score, 1)
        for e in events:
            self._enqueue({"ts": e["ts"], "peak_ts": e["peak_ts"], "score": e["score"], "label": "moment fort", "trigger": "auto"})
        return events

    def _watch_loop(self):
        while not self._stop.wait(0.25):
            try:
                self.poll()
            except Exception as e:                      # noqa: BLE001
                self._err(f"détection : {e.__class__.__name__}: {e}")

    # ---- déclenchement
    def trigger(self, label="manuel"):
        if not self._running:
            return {"ok": False, "error": "Auto-Clipper non démarré (activez clipper_enabled)."}
        t = self.cap.now()
        ok = self._enqueue({"ts": t, "peak_ts": t - 1.0, "score": 100.0, "label": str(label or "manuel")[:60], "trigger": "manuel"})
        return {"ok": ok, "queued": self._q.qsize(), **({} if ok else {"error": "file pleine"})}

    def _enqueue(self, job):
        try:
            self._q.put_nowait(job)
            return True
        except queue.Full:
            self._err("file de rendu pleine : clip ignoré")
            return False

    # ---- rendu (un seul à la fois)
    def _render_loop(self):
        while not self._stop.is_set():
            try:
                job = self._q.get(timeout=0.25)
            except queue.Empty:
                continue
            try:
                self.process(job)
            except Exception as e:                      # noqa: BLE001
                self._err(f"rendu : {e.__class__.__name__}: {e}")
            finally:
                self._rendering = None

    def _confirm(self, job, cfg):
        """Confirmation visuelle : False = refus (clip annulé). Erreur technique = on garde le clip (l'audio avait déjà décidé)."""
        import cv2
        t = job["ts"]
        frames = self.cap.frames(t - 3.0, t + 0.5)
        if not frames:
            return True
        if time.time() - self._last_vision < VISION_MIN_INTERVAL:
            self._vision_log["skipped"] += 1
            return False                                # limite de débit : pas d'appel, donc pas de clip auto
        picks = [frames[0], frames[len(frames) // 2], frames[-1]][: 3]
        thumbs = [cv2.resize(f, (512, max(2, int(f.shape[0] * 512 / f.shape[1])))) for _, f in picks]
        sheet = np.hstack(thumbs)
        ok, buf = cv2.imencode(".jpg", sheet, [cv2.IMWRITE_JPEG_QUALITY, 70])
        del frames, picks, thumbs, sheet
        if not ok:
            return True
        fn = self._vision
        if fn is None:
            import nasko_llm
            fn = nasko_llm.vision_raw
        system = "Tu analyses des captures d'écran de jeu vidéo. Réponds uniquement par un objet JSON."
        ask = ("Ces 3 images (chronologiques) viennent des dernières secondes de jeu. Y a-t-il un moment fort "
               "(multi-kill, victoire, élimination, bannière de succès) ? Réponds en JSON strict : "
               '{"highlight": true|false, "label": "titre court de 3 mots max"}')
        self._last_vision = time.time()
        self._vision_log["calls"] += 1
        try:
            txt = fn(nasko_core.load_config(), system, ask, buf.tobytes())
            m = re.search(r"\{.*\}", str(txt), re.S)
            data = json.loads(m.group(0))
        except Exception as e:                          # noqa: BLE001
            self._err(f"confirmation visuelle indisponible ({e.__class__.__name__}) : clip conservé")
            return True
        if not data.get("highlight"):
            self._vision_log["refused"] += 1
            return False
        if data.get("label"):
            job["label"] = str(data["label"])[:60]
        return True

    def process(self, job):
        """Confirme (option), rend, écrit MP4 + miniature + JSON, purge. Retourne les métadonnées du clip ou None."""
        cfg = self.config()
        if job["trigger"] == "auto" and cfg["clipper_vision_confirm"] and not self._confirm(job, cfg):
            return None
        self._rendering = job["label"]
        secs = cfg["clipper_seconds"]
        end = job["ts"] + self.post_roll
        deadline = time.time() + self.post_roll + 5
        while self.cap.now() < end + 0.3 and time.time() < deadline and not self._stop.is_set():
            time.sleep(0.05)
        start = end - secs - self.post_roll
        sp = self.cap.span()
        if sp:
            start = max(start, sp[0])                    # tampon plus court que demandé : on prend ce qu'il y a
        webcam = None
        if cfg["clipper_webcam"]:
            try:
                img = self._webcam_grab()
                webcam = _Still(img) if img is not None else None
            except Exception as e:                      # noqa: BLE001
                self._err(f"webcam : {e.__class__.__name__}")
        d = self._dir()
        created = _dt.datetime.now()
        base = f"{created:%Y%m%d-%H%M%S}-{_slug(job['label'])}"
        name, i = base, 1
        while os.path.exists(os.path.join(d, name + ".mp4")):
            i += 1
            name = f"{base}-{i}"
        tmp = os.path.join(d, f".render-{name}.mp4")
        try:
            r = self.cap.export_segment(start, end, tmp, vertical=True, with_audio=True, webcam=webcam, mode=cfg["clipper_mode"],
                                        label=job["label"], out_size=self.out_size, zoom={"peak_ts": job["peak_ts"], "max": 1.6, "radius": 2.5})
            os.replace(tmp, os.path.join(d, name + ".mp4"))
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        self._thumb(os.path.join(d, name), job, r)
        meta = {"label": job["label"], "score": job["score"], "duration": r["duration"], "created": created.isoformat(timespec="seconds"),
                "trigger": job["trigger"], "name": name + ".mp4"}
        with open(os.path.join(d, name + ".json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False)
        self._last_clip = dict(meta, size_bytes=r["size_bytes"])
        self._purge(cfg["clipper_max_clips"])
        return self._last_clip

    def _thumb(self, base, job, r):
        try:
            import cv2
            cap = cv2.VideoCapture(base + ".mp4")
            total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            if total > 0:
                cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, min(total - 1, int(total * self.cap_peak_ratio(job, r)))))
            ok, img = cap.read()
            cap.release()
            if ok:
                img = cv2.resize(img, (360, 640), interpolation=cv2.INTER_AREA)
                cv2.imwrite(base + ".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 80])
        except Exception as e:                          # noqa: BLE001
            self._err(f"miniature : {e}")

    def cap_peak_ratio(self, job, r):
        end = job["ts"] + self.post_roll
        dur = max(0.1, r["duration"])
        return min(0.95, max(0.05, 1.0 - (end - job["peak_ts"]) / dur))

    # ---- fichiers
    def _dir(self):
        d = os.path.join(nasko_core.data_dir(), "Clips")
        os.makedirs(d, exist_ok=True)
        return d

    @staticmethod
    def _valid(name):
        if not isinstance(name, str) or not NAME_RE.match(name):
            raise ValueError("nom de clip invalide")
        return name

    def clip_path(self, name):
        """Chemin absolu confiné à Clips/ (ValueError si le nom est piégé, None si absent)."""
        self._valid(name)
        d = os.path.realpath(os.path.join(nasko_core.data_dir(), "Clips"))
        p = os.path.realpath(os.path.join(d, name))
        if os.path.dirname(p) != d:
            raise ValueError("nom de clip invalide")
        return p if os.path.isfile(p) else None

    def list_clips(self):
        d = os.path.join(nasko_core.data_dir(), "Clips")
        if not os.path.isdir(d):
            return []
        out = []
        for fn in sorted(os.listdir(d), reverse=True):
            if not fn.endswith(".mp4") or not NAME_RE.match(fn):
                continue
            base = os.path.join(d, fn[:-4])
            meta = {}
            try:
                with open(base + ".json", encoding="utf-8") as f:
                    meta = json.load(f)
            except (OSError, ValueError):
                pass
            out.append({"name": fn, "label": meta.get("label", ""), "score": meta.get("score"), "duration": meta.get("duration"),
                        "created": meta.get("created", ""), "trigger": meta.get("trigger", ""),
                        "size_bytes": os.path.getsize(base + ".mp4"), "thumb": fn[:-4] + ".jpg" if os.path.isfile(base + ".jpg") else None})
        return out

    def delete_clip(self, name):
        """Supprime MP4 + miniature + métadonnées. True si le MP4 existait."""
        self._valid(name)
        if not name.endswith(".mp4"):
            raise ValueError("nom de clip invalide")
        found = False
        for ext in (".mp4", ".jpg", ".json"):
            p = self.clip_path(name[:-4] + ext)
            if p:
                os.remove(p)
                found = found or ext == ".mp4"
        return found

    def _purge(self, keep):
        for c in self.list_clips()[keep:]:
            try:
                self.delete_clip(c["name"])
            except Exception as e:                      # noqa: BLE001
                self._err(f"purge : {e}")

    # ---- état
    def status(self):
        with self._lock:
            cs = self.cap.status() if self._running else {}
            return {"enabled": self.config()["clipper_enabled"], "running": self._running, "score": self.score, "last_clip": self._last_clip,
                    "queue": self._q.qsize(), "rendering": self._rendering, "errors": list(self._errors), "vision": dict(self._vision_log),
                    "cooldown_left": max(0.0, round(self.det.cooldown - (self.cap.now() - self.det.last_fire), 1)) if self._running else 0.0,
                    "capture": cs}


clipper = AutoClipper()


def _c():
    return clipper


def start():
    return _c().start()


def stop():
    return _c().stop()


def autostart():
    return _c().autostart()


def status():
    return _c().status()


def trigger(label="manuel"):
    return _c().trigger(label)


def list_clips():
    return _c().list_clips()


def delete_clip(name):
    return _c().delete_clip(name)


def clip_path(name):
    return _c().clip_path(name)


def config():
    return _c().config()


def set_config(values):
    return _c().set_config(values)
