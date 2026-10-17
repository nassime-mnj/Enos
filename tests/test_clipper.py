"""Tampon écran/audio + Auto-Clipper (sans matériel). Lancer : python3 tests/test_clipper.py"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nasko_capture as NC  # noqa: E402
import nasko_clipper as CL  # noqa: E402
import nasko_core  # noqa: E402

W, H = 640, 360
T0 = 5000.0
RATE = 16000
FFMPEG = NC._ffmpeg_exe()


def disk(img, x, y, r=14):
    cv2.circle(img, (int(x), int(y)), r, (0, 255, 0), -1)


class FakeScreen:
    """Écran synthétique animé : dégradé qui bouge + disque vert (« réticule ») placé à pos(i). cursor() = la même position."""
    size = (W, H)

    def __init__(self, pos=None):
        self.i = 0
        self.pos = pos or (lambda i: (W / 2, H / 2))

    def render(self, i):
        g = np.tile(np.linspace(20, 90, W, dtype=np.uint8), (H, 1))
        img = np.dstack([np.roll(g, i * 3, axis=1)] * 3).copy()
        img[:, :, 2] = 40
        disk(img, *self.pos(i))
        return img

    def grab(self):
        self.i += 1
        return self.render(self.i)

    def cursor(self):
        return tuple(int(v) for v in self.pos(self.i))


class FakeAudio:
    """Silence + bruit de jeu + pic injecté, au rythme du temps réel."""

    def __init__(self, rate=RATE, noise=0.02, burst_at=None, seed=1):
        self.rate, self.noise, self.burst_at, self.t0 = rate, noise, burst_at, None
        self.rng = np.random.default_rng(seed)

    def read(self, n):
        time.sleep(n / self.rate)
        now = time.time()
        self.t0 = self.t0 or now
        x = self.rng.normal(0, self.noise, n)
        if self.burst_at is not None and now - self.t0 >= self.burst_at:
            x += self.rng.normal(0, 0.3, n)
        return (np.clip(x, -1, 1) * 32767).astype(np.int16)


def tone(sec, f=440, amp=0.3, rate=RATE):
    t = np.arange(int(sec * rate)) / rate
    return (amp * 32767 * np.sin(2 * np.pi * f * t)).astype(np.int16)


def make_buffer(n_sec=5.0, fps=15, pos=None, seconds=40, mic=True):
    """Capture à horloge figée alimentée directement (déterministe) : images, curseur, audio jeu (440 Hz) + micro (880 Hz)."""
    clk = {"t": T0 + n_sec + 0.5}
    cap = NC.Capture(clock=lambda: clk["t"])
    cap.seconds = seconds
    sc = FakeScreen(pos)
    for i in range(int(n_sec * fps)):
        ts = T0 + i / fps
        sc.i = i
        cap.push_frame(ts, sc.render(i), cursor_xy=sc.cursor(), screen_size=(W, H))
    cap.push_audio(T0 + n_sec, tone(n_sec, 440), "out", rate=RATE)
    if mic:
        cap.push_audio(T0 + n_sec, tone(n_sec, 880, 0.2), "mic", rate=RATE)
    return cap, clk


def ffinfo(path):
    r = subprocess.run([FFMPEG, "-hide_banner", "-i", path], capture_output=True, text=True)
    return r.stderr


def read_video(path):
    cap = cv2.VideoCapture(path)
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(f)
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.release()
    return frames, fps


def green_blob(img):
    m = (img[:, :, 1] > 180) & (img[:, :, 0] < 110) & (img[:, :, 2] < 110)
    n = int(m.sum())
    if n < 20:
        return None
    ys, xs = np.nonzero(m)
    return float(xs.mean()), float(ys.mean()), n


# ============================================================================= Capture
class TestCapture(unittest.TestCase):
    def test_buffer_bounded_by_time_and_memory(self):
        cap = NC.Capture(clock=lambda: T0, max_mb=0.3)
        cap.seconds = 5
        rng = np.random.default_rng(0)
        for i in range(300):                                    # 20 s à 15 i/s d'images BRUITÉES (lourdes) dans un tampon de 5 s
            img = rng.integers(0, 255, (180, 320, 3), dtype=np.uint8)
            cap.push_frame(T0 + i / 15, img)
        st = cap.status()
        self.assertLessEqual(st["frames"], 5 * 15 + 2)
        self.assertLessEqual(cap._bytes, 0.3e6 + 1)
        self.assertLess(st["fps_target"], 15)                   # dégradation automatique quand le plafond est dépassé
        self.assertLess(st["width"], 1280)
        cap2 = NC.Capture(clock=lambda: T0)
        cap2.seconds = 5
        for i in range(300):
            cap2.push_frame(T0 + i / 15, np.zeros((90, 160, 3), np.uint8))
        self.assertLessEqual(cap2.status()["frames"], 77)       # borné par la durée
        self.assertGreaterEqual(cap2.status()["frames"], 70)

    def test_frames_audio_cursor_intervals(self):
        cap, _ = make_buffer(5.0, pos=lambda i: (100 + i * 4, 200))
        fr = cap.frames(T0 + 1.0, T0 + 2.0)
        self.assertTrue(14 <= len(fr) <= 16)
        self.assertTrue(all(T0 + 1.0 <= t <= T0 + 2.0 for t, _ in fr))
        self.assertEqual(fr[0][1].shape, (H, W, 3))
        self.assertEqual(cap.frames(T0 + 100, T0 + 101), [])
        a, r = cap.audio(T0 + 1.0, T0 + 2.5, "out")
        self.assertEqual((len(a), r, a.dtype), (int(1.5 * RATE), RATE, np.int16))
        self.assertGreater(int(np.abs(a).max()), 5000)
        a2, _ = cap.audio(T0 + 10, T0 + 11, "out")             # hors tampon : silence de la bonne longueur
        self.assertEqual((len(a2), int(np.abs(a2).max())), (RATE, 0))
        # le tampon est placé par horodatage : un trou reste un trou
        cap3 = NC.Capture(clock=lambda: T0)
        cap3.push_audio(T0 + 1.0, tone(1.0), "out", rate=RATE)
        cap3.push_audio(T0 + 3.0, tone(1.0), "out", rate=RATE)
        x, _ = cap3.audio(T0, T0 + 3.0, "out")
        self.assertGreater(np.abs(x[:RATE]).max(), 1000)
        self.assertEqual(int(np.abs(x[RATE + 200:2 * RATE - 200]).max()), 0)
        cur = cap.cursor(T0 + 1.0, T0 + 2.0)
        self.assertTrue(14 <= len(cur) <= 16)
        t, x, y = cur[0]
        self.assertEqual(y, 200)
        self.assertEqual(x, 100 + round((t - T0) * 15) * 4)
        self.assertEqual(cap.screen_size(), (W, H))
        with self.assertRaises(ValueError):
            cap.audio(0, 1, "autre")

    def test_threads_with_fake_sources(self):
        cap = NC.Capture(screen=FakeScreen(), audio=FakeAudio(), mic=FakeAudio(noise=0.005))
        self.assertFalse(cap.running())
        cap.start(fps=20, seconds=6, max_width=320)
        cap.start(fps=20, seconds=6, max_width=320)             # idempotent
        self.assertTrue(cap.running())
        self.assertEqual(sum(t.name.startswith("cap-") for t in __import__("threading").enumerate()), 3)
        time.sleep(1.6)
        st = cap.status()
        self.assertGreater(st["frames"], 15)
        self.assertGreater(st["fps"], 8)
        self.assertTrue(st["sources"]["out"] and st["sources"]["mic"] and st["sources"]["screen"])
        self.assertEqual(st["errors"], [])
        now = cap.now()
        fr = cap.frames(now - 1.0, now)
        self.assertEqual(fr[0][1].shape[1], 320)                # largeur plafonnée
        a, r = cap.audio(now - 1.0, now, "mic")
        self.assertGreater(int(np.abs(a).max()), 100)
        self.assertTrue(cap.cursor(now - 1.0, now))
        cap.stop()
        self.assertFalse(cap.running())
        self.assertEqual(cap.status()["frames"], 0)             # RAM vidée à l'arrêt
        time.sleep(0.2)
        self.assertEqual(sum(t.name.startswith("cap-") for t in __import__("threading").enumerate()), 0)

    def test_source_errors_reported_not_raised(self):
        class Boom:
            def grab(self):
                raise RuntimeError("écran HS")

        cap = NC.Capture(screen=Boom(), audio=FakeAudio(), mic=FakeAudio())
        cap.start(fps=10, seconds=5)
        time.sleep(0.5)
        errs = cap.status()["errors"]
        cap.stop()
        self.assertTrue(any("écran HS" in e for e in errs))

    def test_export_vertical_follows_cursor_and_zooms(self):
        tmp = tempfile.mkdtemp()
        try:
            # le curseur (donc le disque vert) traverse l'écran de gauche à droite : 120 -> 520 px sur 4 s
            cap, _ = make_buffer(4.0, pos=lambda i: (120 + i * (400 / 60), 150 + (i % 30)))
            out = os.path.join(tmp, "v.mp4")
            r = cap.export_segment(T0, T0 + 4.0, out, vertical=True, mode="cursor", label="Triple kill ÉNORME",
                                   zoom={"peak_ts": T0 + 2.0, "max": 1.6, "radius": 1.8})
            self.assertEqual(set(r), {"path", "duration", "frames", "size_bytes"})
            self.assertAlmostEqual(r["duration"], 4.0, delta=0.3)
            info = ffinfo(out)
            self.assertIn("1080x1920", info)
            self.assertIn("h264", info)
            self.assertRegex(info, r"Audio: aac")
            m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", info)
            self.assertAlmostEqual(int(m.group(2)) * 60 + float(m.group(3)), 4.0, delta=0.3)
            frames, fps = read_video(out)
            self.assertEqual(frames[0].shape[:2], (1920, 1080))
            self.assertAlmostEqual(len(frames) / fps, 4.0, delta=0.3)
            # le réticule reste proche du centre de l'image de sortie alors qu'il se déplace de 400 px dans la source
            xs = []
            for k in (3, len(frames) // 2, len(frames) - 8):
                b = green_blob(frames[k])
                self.assertIsNotNone(b, f"réticule introuvable image {k}")
                xs.append(b[0])
                self.assertLess(abs(b[0] - 540), 160)
                self.assertLess(abs(b[1] - 960), 260)
            # zoom : le disque grossit au pic (≈ 1.6² en surface) puis redevient petit
            a_start = green_blob(frames[3])[2]
            a_peak = green_blob(frames[len(frames) // 2])[2]
            a_end = green_blob(frames[-4])[2]
            self.assertGreater(a_peak, a_start * 1.8)
            self.assertLess(a_end, a_peak * 0.75)
            # l'étiquette est dessinée en haut (pixels clairs dans la bande de titre)
            self.assertGreater(int((frames[5][20:150, :, :].min(axis=2) > 200).sum()), 200)
        finally:
            shutil.rmtree(tmp)

    def test_export_fps_mode_centers_on_screen_center(self):
        tmp = tempfile.mkdtemp()
        try:
            cap, _ = make_buffer(3.0, pos=lambda i: (W / 2, H / 2))
            r = cap.export_segment(T0, T0 + 3.0, os.path.join(tmp, "f.mp4"), vertical=True, mode="fps", with_audio=False,
                                   out_size=(270, 480), zoom={"peak_ts": T0 + 1.5, "max": 1.6})
            frames, _ = read_video(r["path"])
            self.assertEqual(frames[0].shape[:2], (480, 270))
            self.assertNotIn("Audio:", ffinfo(r["path"]))
            for k in (2, len(frames) // 2):
                b = green_blob(frames[k])
                self.assertLess(abs(b[0] - 135), 20)
                self.assertLess(abs(b[1] - 240), 30)
            # fps mode : un curseur ailleurs n'attire PAS le cadrage (le point d'intérêt est le centre) -> le disque n'est pas centré
            cap2, _ = make_buffer(3.0, pos=lambda i: (40, 40))
            r2 = cap2.export_segment(T0, T0 + 3.0, os.path.join(tmp, "g.mp4"), vertical=True, mode="fps", with_audio=False, out_size=(270, 480))
            fr2, _ = read_video(r2["path"])
            self.assertIsNone(green_blob(fr2[5]))               # recadrage 9:16 centré : le coin gauche est hors champ
        finally:
            shutil.rmtree(tmp)

    def test_export_horizontal_audio_and_webcam(self):
        tmp = tempfile.mkdtemp()
        try:
            cap, _ = make_buffer(3.0)
            r = cap.export_segment(T0, T0 + 3.0, os.path.join(tmp, "h.mp4"), vertical=False)
            frames, _ = read_video(r["path"])
            self.assertEqual(frames[0].shape[:2], (H, W))
            self.assertIn("Audio: aac", ffinfo(r["path"]))
            self.assertEqual([f for f in os.listdir(tmp) if f.endswith(".wav")], [])      # wav temporaire supprimé
            magenta = np.zeros((120, 160, 3), np.uint8)
            magenta[:] = (255, 0, 255)
            r = cap.export_segment(T0, T0 + 3.0, os.path.join(tmp, "w.mp4"), vertical=True, with_audio=False, out_size=(270, 480),
                                   webcam=CL._Still(magenta))
            frames, _ = read_video(r["path"])
            px = frames[5][int(480 * 0.80), 135]                # bas centre = webcam incrustée
            self.assertGreater(int(px[0]), 150)
            self.assertGreater(int(px[2]), 150)
            self.assertLess(int(px[1]), 110)
            with self.assertRaises(RuntimeError):
                cap.export_segment(T0 + 500, T0 + 503, os.path.join(tmp, "z.mp4"))
            with self.assertRaises(ValueError):
                cap.export_segment(T0 + 2, T0 + 2, os.path.join(tmp, "z.mp4"))
        finally:
            shutil.rmtree(tmp)

    def test_no_global_hooks(self):
        with open(NC.__file__, encoding="utf-8") as f:
            src = f.read()
        for bad in ("SetWindowsHookEx", "pynput", "keyboard", "GetAsyncKeyState", "RegisterRawInputDevices"):
            self.assertNotIn(bad, src)


# ============================================================================= Détecteur
def noise(sec, amp, rng, am=None, rate=RATE):
    n = int(sec * rate)
    x = rng.normal(0, amp, n)
    if am:
        f, depth = am
        x *= 1 - depth + depth * (0.5 + 0.5 * np.sin(2 * np.pi * f * np.arange(n) / rate))
    return x


def run_det(det, out, mic, t0=0.0, block=1600):
    """Alimente le détecteur par blocs de 100 ms ; retourne les événements."""
    n = max(len(out), len(mic))
    out = np.pad(out, (0, n - len(out)))
    mic = np.pad(mic, (0, n - len(mic)))
    ev = []
    for i in range(0, n, block):
        ev += det.feed(out[i:i + block], mic[i:i + block], t0 + (min(n, i + block)) / RATE)
    return ev


def scene(rng, base_s=8.0, game=0.05, mic=0.003, extra_s=0.0):
    """Ligne de base : bruit de jeu constant + souffle de micro."""
    n = base_s + extra_s
    return noise(n, game, rng), noise(n, mic, rng)


class TestDetector(unittest.TestCase):
    def setUp(self):
        self.rng = np.random.default_rng(42)

    def test_silence_no_trigger(self):
        d = CL.ExcitementDetector()
        ev = run_det(d, np.zeros(30 * RATE), np.zeros(30 * RATE))
        self.assertEqual(ev, [])
        self.assertLess(d.score, 5)

    def test_constant_game_noise_no_trigger(self):
        d = CL.ExcitementDetector(sensitivity=80)
        out, mic = scene(self.rng, 40.0)
        self.assertEqual(run_det(d, out, mic), [])
        # un bruit constant qui DÉMARRE fort (moteur, vent) mais ne varie pas n'est pas un cri
        d2 = CL.ExcitementDetector()
        o, m = scene(self.rng, 8.0)
        o = np.concatenate([o, noise(6.0, 0.4, self.rng)])
        m = np.concatenate([m, noise(6.0, 0.3, self.rng)])
        self.assertEqual(run_det(d2, o, m), [])

    def test_scream_triggers_once_at_the_right_time(self):
        d = CL.ExcitementDetector()
        o, m = scene(self.rng, 8.0, extra_s=6.0)
        o = o.copy()
        m = m.copy()
        i0 = 8 * RATE
        m[i0:i0 + int(1.2 * RATE)] += noise(1.2, 0.3, self.rng, am=(5, 0.6))        # cri : bruit large bande modulé
        ev = run_det(d, o, m)
        self.assertEqual(len(ev), 1)
        self.assertTrue(8.35 <= ev[0]["ts"] <= 9.3, ev[0])
        self.assertGreater(ev[0]["score"], 50)
        self.assertLessEqual(ev[0]["score"], 100)

    def test_laugh_bursts_trigger(self):
        d = CL.ExcitementDetector()
        o, m = scene(self.rng, 8.0, extra_s=5.0)
        m = m.copy()
        for k in range(5):                                      # 5 bouffées de 0,2 s toutes les 0,4 s
            i = int((8.0 + 0.4 * k) * RATE)
            m[i:i + int(0.2 * RATE)] += noise(0.2, 0.25, self.rng, am=(8, 0.5))
        ev = run_det(d, o, m)
        self.assertEqual(len(ev), 1)
        self.assertTrue(8.3 <= ev[0]["ts"] <= 10.3, ev[0])

    def test_isolated_click_ignored(self):
        d = CL.ExcitementDetector(sensitivity=70)
        o, m = scene(self.rng, 8.0, extra_s=3.0)
        m = m.copy()
        m[8 * RATE:8 * RATE + int(0.05 * RATE)] += noise(0.05, 0.6, self.rng)
        self.assertEqual(run_det(d, o, m), [])

    def test_low_rumble_is_not_a_scream(self):
        d = CL.ExcitementDetector(sensitivity=70)
        o, m = scene(self.rng, 8.0, extra_s=4.0)
        t = np.arange(4 * RATE) / RATE
        rumble = 0.5 * np.sin(2 * np.pi * 90 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 4 * t))
        m = m.copy()
        m[8 * RATE:] += rumble
        self.assertEqual(run_det(d, o, m), [])

    def test_cooldown(self):
        d = CL.ExcitementDetector(sensitivity=60, cooldown=5)             # < 20 s demandé : plancher à 20 s
        self.assertEqual(d.cooldown, 20.0)
        n = 70
        o, m = scene(self.rng, 8.0, extra_s=n - 8)
        m = m.copy()
        for start in (8.0, 18.0, 33.0):                                    # 2e à +10 s (bloqué), 3e à +25 s (autorisé)
            i = int(start * RATE)
            m[i:i + int(1.2 * RATE)] += noise(1.2, 0.3, self.rng, am=(5, 0.6))
        ev = run_det(d, o, m)
        self.assertEqual(len(ev), 2, ev)
        self.assertGreaterEqual(ev[1]["ts"] - ev[0]["ts"], 20.0)
        self.assertTrue(32.5 <= ev[1]["ts"] <= 35, ev[1])

    def test_sensitivity_scales_threshold(self):
        def burst(sens):
            rng = np.random.default_rng(7)
            d = CL.ExcitementDetector(sensitivity=sens)
            o, m = scene(rng, 8.0, extra_s=3.0)
            m = m.copy()
            m[8 * RATE:int(10.5 * RATE)] += noise(2.5, 0.025, rng, am=(5, 0.6))   # cri modeste (≈ 18 dB au-dessus du souffle)
            return run_det(d, o, m)

        self.assertEqual(burst(0), [])
        self.assertEqual(len(burst(100)), 1)

    def test_game_alone_needs_high_sensitivity(self):
        def game_boom(sens):
            rng = np.random.default_rng(3)
            d = CL.ExcitementDetector(sensitivity=sens)
            o, m = scene(rng, 8.0, extra_s=3.0)
            o = o.copy()
            o[8 * RATE:int(10 * RATE)] += noise(2.0, 0.6, rng, am=(5, 0.7))
            return run_det(d, o, m)

        self.assertEqual(game_boom(50), [])
        self.assertEqual(len(game_boom(100)), 1)


# ============================================================================= Auto-Clipper
class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.cfg = {}
        self._o = (nasko_core.data_dir, nasko_core.load_config, nasko_core.update_config)
        nasko_core.data_dir = lambda: self.tmp
        nasko_core.load_config = lambda: dict(self.cfg)
        nasko_core.update_config = lambda v: self.cfg.update(v)

    def tearDown(self):
        nasko_core.data_dir, nasko_core.load_config, nasko_core.update_config = self._o
        shutil.rmtree(self.tmp, ignore_errors=True)

    def clipper(self, n_sec=5.0, **kw):
        cap, clk = make_buffer(n_sec, pos=lambda i: (200 + i * 3, 180))
        self.n = n_sec
        ck = CL.AutoClipper(capture=cap, post_roll=0.5, **kw)
        ck.out_size = (270, 480)
        self.cfg.update({"clipper_enabled": True, "clipper_seconds": 10})
        return ck, cap

    def job(self, label="manuel", trigger="manuel"):
        return {"ts": T0 + self.n - 1.0, "peak_ts": T0 + self.n - 2.0, "score": 77.0, "label": label, "trigger": trigger}

    def all_files(self):
        out = []
        for root, _, files in os.walk(self.tmp):
            out += [os.path.relpath(os.path.join(root, f), self.tmp) for f in files]
        return sorted(out)


class TestConfig(Base):
    def test_defaults_and_validation(self):
        ck = CL.AutoClipper(capture=type("C", (), {"running": lambda s: False})())
        c = ck.config()
        self.assertFalse(c["clipper_enabled"])
        self.assertFalse(c["clipper_vision_confirm"])
        self.assertEqual(c["clipper_mode"], "fps")
        c = ck.set_config({"clipper_sensitivity": 500, "clipper_seconds": 3, "clipper_max_clips": -4, "clipper_vision_confirm": "oui",
                           "clipper_mode": "CURSOR", "inconnue": 1, "clipper_webcam": 1})
        self.assertEqual((c["clipper_sensitivity"], c["clipper_seconds"], c["clipper_max_clips"]), (100, 10, 1))
        self.assertTrue(c["clipper_vision_confirm"] and c["clipper_webcam"])
        self.assertEqual(c["clipper_mode"], "cursor")
        self.assertNotIn("inconnue", self.cfg)
        self.assertEqual(ck.set_config({"clipper_seconds": 999})["clipper_seconds"], 60)
        with self.assertRaises(ValueError):
            ck.set_config({"clipper_mode": "mouse"})
        self.assertEqual(ck.set_config({"clipper_sensitivity": "abc"})["clipper_sensitivity"], 100)   # invalide : valeur conservée

    def test_autostart_inert_when_disabled(self):
        calls = []

        class Cap:
            def running(self): return False
            def start(self, **k): calls.append("start")
            def stop(self): calls.append("stop")
            def now(self): return time.time()
            def status(self): return {}

        ck = CL.AutoClipper(capture=Cap())
        before = __import__("threading").active_count()
        self.assertFalse(ck.autostart())
        self.assertFalse(ck.start()["running"])
        self.assertEqual(calls, [])
        self.assertEqual(__import__("threading").active_count(), before)
        self.assertEqual(self.all_files(), [])                  # rien d'écrit, pas même Clips/
        self.assertFalse(ck.trigger("x")["ok"])
        # opt-in : activer démarre, désactiver arrête
        ck.set_config({"clipper_enabled": True})
        self.assertTrue(ck.status()["running"])
        self.assertEqual(calls, ["start"])
        ck.set_config({"clipper_enabled": False})
        self.assertFalse(ck.status()["running"])
        self.assertEqual(calls, ["start", "stop"])
        self.assertTrue(ck.autostart() is False)
        self.cfg["clipper_enabled"] = True
        self.assertTrue(ck.autostart())
        ck.stop()


class TestClipper(Base):
    def test_process_writes_clip_thumb_json_only_in_clips(self):
        ck, _ = self.clipper()
        meta = ck.process(self.job("Triple kill !"))
        self.assertTrue(re.fullmatch(r"\d{8}-\d{6}-triple-kill\.mp4", meta["name"]), meta["name"])
        files = self.all_files()
        self.assertEqual(sorted(files), sorted(os.path.join("Clips", meta["name"][:-4] + e) for e in (".mp4", ".jpg", ".json")))
        with open(os.path.join(self.tmp, "Clips", meta["name"][:-4] + ".json"), encoding="utf-8") as f:
            j = json.load(f)
        self.assertEqual((j["label"], j["score"], j["trigger"]), ("Triple kill !", 77.0, "manuel"))
        self.assertTrue(j["created"] and j["duration"] > 2)
        frames, _ = read_video(ck.clip_path(meta["name"]))
        self.assertEqual(frames[0].shape[:2], (480, 270))
        th = cv2.imread(ck.clip_path(meta["name"][:-4] + ".jpg"))
        self.assertEqual(th.shape[:2], (640, 360))
        lst = ck.list_clips()
        self.assertEqual([c["name"] for c in lst], [meta["name"]])
        self.assertEqual(lst[0]["thumb"], meta["name"][:-4] + ".jpg")

    def test_trapped_names_rejected(self):
        ck, _ = self.clipper()
        meta = ck.process(self.job())
        with open(os.path.join(self.tmp, "secret.mp4"), "w") as f:
            f.write("x")
        for bad in ("../x", "a/b", "..\\x", "../secret.mp4", "20250101-000000-x.mp4/../../secret.mp4", os.path.join(self.tmp, "secret.mp4"),
                    "", "x.exe", "..", ".", None, 12, "20250101-000000-x.mp4\x00.jpg", "20250101-000000-.mp4"):
            with self.assertRaises(ValueError, msg=repr(bad)):
                ck.clip_path(bad)
            with self.assertRaises(ValueError, msg=repr(bad)):
                ck.delete_clip(bad)
        self.assertTrue(os.path.isfile(os.path.join(self.tmp, "secret.mp4")))
        self.assertIsNone(ck.clip_path("20250101-000000-absent.mp4"))
        self.assertTrue(ck.clip_path(meta["name"]).startswith(os.path.realpath(os.path.join(self.tmp, "Clips"))))
        self.assertTrue(ck.delete_clip(meta["name"]))
        self.assertFalse(ck.delete_clip(meta["name"]))
        self.assertEqual([f for f in self.all_files() if f.startswith("Clips")], [])

    def test_purge_keeps_newest(self):
        ck, _ = self.clipper(n_sec=3.0)
        self.cfg["clipper_max_clips"] = 2
        names = []
        for i in range(3):
            names.append(ck.process(self.job(f"clip {i}"))["name"])
            time.sleep(1.05)                                    # noms horodatés à la seconde
        left = [c["name"] for c in ck.list_clips()]
        self.assertEqual(left, [names[2], names[1]])
        self.assertEqual(len([f for f in self.all_files() if f.endswith(".mp4")]), 2)
        self.assertEqual(len([f for f in self.all_files() if f.endswith(".json")]), 2)

    def test_same_second_names_do_not_collide(self):
        ck, _ = self.clipper(n_sec=3.0)
        a = ck.process(self.job("x"))["name"]
        b = ck.process(self.job("x"))["name"]
        if a[:15] == b[:15]:
            self.assertNotEqual(a, b)
        self.assertEqual(len(ck.list_clips()), 2)

    def test_vision_refusal_cancels_clip(self):
        calls = []

        def refuse(cfg, system, ask, jpg):
            calls.append((system, ask, jpg))
            return 'Voici : {"highlight": false, "label": "rien"}'

        ck, _ = self.clipper(vision=refuse)
        self.cfg["clipper_vision_confirm"] = True
        self.assertIsNone(ck.process(self.job("auto", "auto")))
        self.assertEqual(len(calls), 1)
        self.assertEqual(ck.list_clips(), [])
        self.assertEqual(self.all_files(), [])
        img = cv2.imdecode(np.frombuffer(calls[0][2], np.uint8), cv2.IMREAD_COLOR)    # 1 seule planche de ≤ 3 images
        self.assertLessEqual(img.shape[1], 3 * 512)
        self.assertGreaterEqual(img.shape[1], 2 * 512)
        # limite de débit : un 2e déclenchement dans les 30 s n'appelle PAS le modèle (et ne produit pas de clip)
        self.assertIsNone(ck.process(self.job("auto", "auto")))
        self.assertEqual(len(calls), 1)
        self.assertEqual(ck.status()["vision"], {"calls": 1, "refused": 1, "skipped": 1})
        # le manuel ne passe jamais par la vision
        self.assertIsNotNone(ck.process(self.job("manuel", "manuel")))
        self.assertEqual(len(calls), 1)

    def test_vision_accept_uses_label_and_error_keeps_clip(self):
        ck, _ = self.clipper(vision=lambda *a: '{"highlight": true, "label": "Quadra kill"}')
        self.cfg["clipper_vision_confirm"] = True
        m = ck.process(self.job("moment fort", "auto"))
        self.assertEqual(m["label"], "Quadra kill")
        self.assertIn("quadra-kill", m["name"])

        def boom(*a):
            raise RuntimeError("LLM HS")

        ck2, _ = self.clipper(n_sec=3.0, vision=boom)
        self.cfg["clipper_vision_confirm"] = True
        self.assertIsNotNone(ck2.process(self.job("auto", "auto")))
        self.assertTrue(ck2.status()["errors"])

    def test_vision_not_called_when_disabled(self):
        calls = []
        ck, _ = self.clipper(n_sec=3.0, vision=lambda *a: calls.append(1) or "{}")
        self.assertIsNotNone(ck.process(self.job("auto", "auto")))
        self.assertEqual(calls, [])

    def test_webcam_snapshot_is_overlaid(self):
        mag = np.zeros((120, 160, 3), np.uint8)
        mag[:] = (255, 0, 255)
        ck, _ = self.clipper(n_sec=3.0, webcam_grab=lambda: mag)
        self.cfg["clipper_webcam"] = True
        m = ck.process(self.job())
        frames, _ = read_video(ck.clip_path(m["name"]))
        px = frames[5][int(480 * 0.80), 135]
        self.assertGreater(int(px[0]), 150)
        self.assertLess(int(px[1]), 110)

    def test_detection_to_queue_via_poll(self):
        """Audio réel du tampon -> détecteur -> file de rendu (horloge simulée)."""
        clk = {"t": T0}
        cap = NC.Capture(clock=lambda: clk["t"])
        ck = CL.AutoClipper(capture=cap, post_roll=0.5)
        rng = np.random.default_rng(5)
        ck._last_poll = T0
        events, top = [], []
        for s in range(14):
            clk["t"] = T0 + s + 1.0
            out = (noise(1.0, 0.05, rng) * 32767).astype(np.int16)
            mic = noise(1.0, 0.003, rng)
            if s == 9:
                mic = mic + noise(1.0, 0.3, rng, am=(5, 0.6))
            cap.push_audio(clk["t"], out, "out", rate=RATE)
            cap.push_audio(clk["t"], (np.clip(mic, -1, 1) * 32767).astype(np.int16), "mic", rate=RATE)
            events += ck.poll()
            if events and not top:
                top.append(ck.status()["score"])
        self.assertEqual(len(events), 1)
        self.assertEqual(ck._q.qsize(), 1)
        job = ck._q.get_nowait()
        self.assertEqual(job["trigger"], "auto")
        self.assertTrue(T0 + 9.3 <= job["ts"] <= T0 + 10.5)
        self.assertGreater(top[0], 30)

    def test_trigger_end_to_end_threads(self):
        """start() réel (threads, sources factices) -> trigger manuel -> clip écrit dans Clips/ ; stop() propre."""
        cap = NC.Capture(screen=FakeScreen(), audio=FakeAudio(), mic=FakeAudio(noise=0.005))
        ck = CL.AutoClipper(capture=cap, post_roll=0.4)
        ck.out_size = (270, 480)
        self.cfg.update({"clipper_enabled": True, "clipper_seconds": 10, "clipper_mode": "cursor"})
        st = ck.start()
        self.assertTrue(st["running"])
        self.assertTrue(cap.running())
        time.sleep(2.2)
        r = ck.trigger("test manuel")
        self.assertTrue(r["ok"])
        deadline = time.time() + 40
        while time.time() < deadline and not ck.list_clips():
            time.sleep(0.2)
        clips = ck.list_clips()
        self.assertEqual(len(clips), 1, ck.status()["errors"])
        self.assertEqual(clips[0]["trigger"], "manuel")
        self.assertIn("Audio: aac", ffinfo(ck.clip_path(clips[0]["name"])))
        self.assertGreater(clips[0]["duration"], 1.5)
        ck.stop()
        self.assertFalse(cap.running())
        self.assertFalse(ck.status()["running"])
        self.assertTrue(all(f.startswith("Clips") for f in self.all_files()))
        self.assertFalse([f for f in self.all_files() if ".render-" in f or f.endswith(".wav")])


if __name__ == "__main__":
    unittest.main(verbosity=1)
