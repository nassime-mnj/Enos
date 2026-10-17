"""Tests de l'Anti-Tilt Coach (nasko_tilt). Lancer : python3 tests/test_tilt.py  (aucun matériel, aucun réseau)."""
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nasko_tilt as T  # noqa: E402


def mouse_samples(level, t0=0.0, dur=5.0, rng=None, hz=60, scale=1.0):
    """level 0 = calme (balayage lent) ; 1 = agité (zigzags rapides, coups secs). scale : joueur naturellement actif."""
    rng = rng or np.random.default_rng(0)
    out = []
    for i in range(int(dur * hz)):
        t = t0 + i / hz
        f = 0.4 + 7.0 * level
        a = (150 + 250 * level) * scale
        x = 800 + a * np.sin(2 * np.pi * f * t) + rng.normal(0, 0.4 + 6 * level)
        y = 500 + 0.5 * a * np.sin(2 * np.pi * f * 0.7 * t + 1) + rng.normal(0, 0.4 + 6 * level)
        out.append((t, x, y))
    return out


def key_events(rate, t0=0.0, dur=5.0, rng=None, burst=False):
    rng = rng or np.random.default_rng(1)
    ev = []
    for s in range(int(dur)):
        n = int(rng.poisson(rate))
        for _ in range(n):
            ev.append((t0 + s + rng.random() * (0.3 if burst else 1.0), 1))
    return ev


def window(level, rng, t0=0.0, rate=None, scale=1.0, audio=None):
    ms = mouse_samples(level, t0, 5.0, rng, scale=scale)
    ks = key_events(rate if rate is not None else 1.5 + 8 * level, t0, 5.0, rng, burst=level > 0.5)
    agg = T.Aggregator()
    f = T.build_features(ms, ks, [], agg, 5.0)
    if audio:
        f.update(audio)
    return f


def make_coach(tmp, **kw):
    cfg = {"tilt_enabled": True}
    cfg.update(kw.pop("cfg", {}))
    saved = []
    d = dict(llm=T.FakeLLM(), speaker=T.FakeSpeaker(), notifier=T.FakeNotifier(), capture=T.FakeCapture(), data_dir=lambda: tmp, sync=True,
             cfg_load=lambda: dict(cfg), cfg_save=lambda v: (cfg.update(v), saved.append(v)), sleep=lambda s: None, rng=__import__("random").Random(3))
    d.update(kw)
    c = T.Coach(**d)
    c._cfg, c._saved = cfg, saved
    return c


def run_scenario(c, levels, rng, t=0.0):
    """levels : liste de niveaux (un par fenêtre). Retourne (interventions, scores)."""
    ivs, scores = [], []
    for lv in levels:
        iv = c.process_window(window(lv, rng, t), t)
        if iv:
            ivs.append((t, iv))
        scores.append(c.score)
        t += 5.0
    return ivs, scores, t


class SignalTests(unittest.TestCase):
    def test_mouse_calm_vs_jerky(self):
        calm = T.mouse_features(mouse_samples(0.0))
        jerky = T.mouse_features(mouse_samples(1.0))
        self.assertGreater(jerky["mouse_reversals"], 5 * calm["mouse_reversals"] + 1)
        self.assertGreater(jerky["mouse_shakes"], calm["mouse_shakes"] + 3)
        self.assertGreater(jerky["mouse_jerk"], 10 * calm["mouse_jerk"])
        self.assertGreater(jerky["mouse_speed"], 5 * calm["mouse_speed"])
        self.assertIsNone(T.mouse_features([(0, 1, 1)]))

    def test_keys_normal_vs_burst(self):
        n = T.key_features(key_events(2), 5.0)
        b = T.key_features(key_events(12, burst=True), 5.0)
        self.assertGreater(b["keys_per_s"], 3 * n["keys_per_s"])
        self.assertGreater(b["key_burst"], 2 * n["key_burst"])
        self.assertEqual(T.key_features([], 5.0)["presses"], 0)

    def _noise(self, secs, lowpass=None, amp=0.05, sr=16000, seed=0):
        x = np.random.default_rng(seed).normal(0, 1, int(sr * secs))
        if lowpass:
            X = np.fft.rfft(x)
            fr = np.fft.rfftfreq(len(x), 1 / sr)
            X[fr > lowpass] = 0
            x = np.fft.irfft(X, len(x))
        x = x / (np.std(x) + 1e-9) * amp
        return x.astype(np.float32)

    def test_sigh_vs_noise_vs_speech_vs_burst(self):
        sr = 16000
        quiet = lambda s: self._noise(s, amp=0.002, seed=5)                         # noqa: E731
        sigh = np.concatenate([quiet(1), self._noise(1.2, lowpass=1500, amp=0.03), quiet(1)])
        fr = T.audio_frames(sigh, sr)
        f = T.audio_features(fr, 0.002)
        self.assertEqual(f["audio_sighs"], 1.0)
        self.assertEqual(f["audio_bursts"], 0.0)
        silence = T.audio_features(T.audio_frames(quiet(3), sr), 0.002)
        self.assertEqual((silence["audio_sighs"], silence["audio_bursts"]), (0.0, 0.0))
        t = np.arange(int(sr * 1.2)) / sr                                          # voix tonale (harmoniques), 1,2 s
        speech = sum(np.sin(2 * np.pi * 180 * k * t) / k for k in range(1, 8)) * 0.03
        sp = T.audio_features(T.audio_frames(np.concatenate([quiet(1), speech.astype(np.float32), quiet(1)]), sr), 0.002)
        self.assertEqual(sp["audio_sighs"], 0.0)
        blip = np.concatenate([quiet(1), self._noise(0.3, amp=0.4, seed=2), quiet(1)])    # claque / cri bref très fort
        b = T.audio_features(T.audio_frames(blip, sr), 0.002)
        self.assertEqual(b["audio_bursts"], 1.0)
        self.assertGreater(b["audio_peak"], 0.2)
        self.assertGreater(b["audio_peak"], 5 * f["audio_peak"] * 0.5)

    def test_calibration_zscores(self):
        b = T.Baseline()
        rng = np.random.default_rng(4)
        for _ in range(100):
            b.update({"mouse_jerk": 100000 + rng.normal(0, 10000), "keys_per_s": 2 + rng.normal(0, 0.3)})
        self.assertAlmostEqual(b.z("mouse_jerk", 100000), 0, delta=0.3)
        self.assertGreater(b.z("mouse_jerk", 160000), 3)
        self.assertEqual(b.z("audio_peak", 5.0), 0.0)                              # canal jamais vu
        self.assertAlmostEqual(b.percent(), 100 * 100 / T.CAL_FULL_WINDOWS)
        # adaptation lente : 5 fenêtres hautes déplacent peu la moyenne
        m0 = b.stats["keys_per_s"][1]
        for _ in range(5):
            b.update({"keys_per_s": 10})
        self.assertLess(b.stats["keys_per_s"][1] - m0, 0.5)


class ScenarioTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def test_calm_tilt_calm_single_intervention(self):
        c = make_coach(self.tmp)
        rng = np.random.default_rng(10)
        calm = [0.0 + 0.04 * (i % 3) for i in range(150)]
        ramp = [0.1 + 0.9 * i / 25 for i in range(25)]
        peak = [1.0] * 20
        after = [0.0] * 60
        ivs, scores, t = run_scenario(c, calm + ramp + peak + after, rng)
        self.assertEqual(len(ivs), 1)
        self.assertGreaterEqual(max(scores), 70)
        self.assertLess(max(scores[:150]), 30)
        t_iv = ivs[0][0]
        self.assertGreater(t_iv, 150 * 5)
        self.assertLess(scores[-1], 25)
        iv = ivs[0][1]
        self.assertTrue(iv["signals"])
        self.assertEqual(len(c.config() and c._llm.calls), 1)
        self.assertEqual(len(c._speaker.said), 1)
        self.assertEqual(len(c._notifier.sent), 1)

    def test_no_intervention_before_calibration(self):
        c = make_coach(self.tmp)
        rng = np.random.default_rng(11)
        ivs, scores, _ = run_scenario(c, [0.0] * 5 + [1.0] * 30, rng)
        self.assertEqual(ivs, [])
        self.assertFalse(c.baseline.calibrated())

    def test_cooldown_and_no_double_without_calm(self):
        c = make_coach(self.tmp)
        rng = np.random.default_rng(12)
        ivs, _, t = run_scenario(c, [0.02] * 100 + [1.0] * 200, rng)     # 16 min d'agitation continue : une seule intervention
        self.assertEqual(len(ivs), 1)

    def test_cooldown(self):
        c = make_coach(self.tmp)
        rng = np.random.default_rng(12)
        ivs, _, t = run_scenario(c, [0.02] * 100 + [1.0] * 20, rng)
        self.assertEqual(len(ivs), 1)
        ivs2, _, t = run_scenario(c, [0.02] * 15, rng, t)               # accalmie (75 s) puis nouvelle crise < 8 min
        self.assertEqual(ivs2, [])
        ivs3, _, t = run_scenario(c, [1.0] * 20, rng, t)
        self.assertEqual(ivs3, [], "refroidissement de 8 min non respecté")
        ivs4, _, t = run_scenario(c, [0.02] * 100 + [1.0] * 20, rng, t)  # > 8 min plus tard
        self.assertEqual(len(ivs4), 1)

    def test_naturally_active_player_no_false_positive(self):
        c = make_coach(self.tmp)
        rng = np.random.default_rng(13)
        ivs = []
        t = 0.0
        for i in range(260):
            lv = 0.35 + 0.1 * rng.random()          # joueur nerveux en permanence : la ligne de base est haute
            f = window(lv, rng, t, rate=10 * (0.8 + 0.4 * rng.random()), scale=1.0)
            iv = c.process_window(f, t)
            if iv:
                ivs.append(iv)
            t += 5
        self.assertEqual(ivs, [])
        self.assertLess(c.score, 40)
        self.assertGreater(c.baseline.stats["mouse_reversals"][1], 0.5)

    def test_death_streak_bonus(self):
        c = make_coach(self.tmp)
        c.mark_death(ts=1000.0)
        c.mark_death(ts=1010.0)
        self.assertEqual(c.death_streak(c.clock()), 2)
        self.assertEqual(c.death_streak(c.clock() + 400), 0)
        t0, _ = T.compute_score({"mouse_jerk": 0.0}, 0.0)
        t2, _ = T.compute_score({"mouse_jerk": 0.0}, 16.0)
        self.assertEqual(t2 - t0, 16.0)

    def test_inactive_window_decays(self):
        c = make_coach(self.tmp)
        c.score = 80.0
        for i in range(30):
            c.process_window({"active": False}, i * 5.0)
        self.assertLess(c.score, 5)

    def test_reset_clears_calibration_file(self):
        c = make_coach(self.tmp)
        rng = np.random.default_rng(14)
        run_scenario(c, [0.0] * 30, rng)
        c.save_calibration()
        p = os.path.join(self.tmp, T.CAL_FILE)
        self.assertTrue(os.path.isfile(p))
        c2 = make_coach(self.tmp)
        self.assertEqual(c2.baseline.windows, 30)                                  # rechargé
        c.reset()
        self.assertFalse(os.path.exists(p))
        self.assertEqual(c.baseline.windows, 0)
        self.assertEqual(c.status()["calibration"], 0)


class InterventionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def test_llm_message_trimmed_and_suggestions(self):
        llm = T.FakeLLM("[exhales] Respire un coup. Prends 2 minutes. Et une troisième phrase interdite.")
        c = make_coach(self.tmp, llm=llm)
        iv = c.test_intervention()
        self.assertNotIn("troisième", iv["text"])
        self.assertNotIn("[", iv["text"])
        self.assertEqual(len(iv["suggestions"]), 3)
        self.assertIn("ETO", llm.calls[0][0] + "ETO")
        self.assertIn("Score de tilt", llm.calls[0][1])
        self.assertEqual(c._speaker.said[0].count("[exhales]"), 1)                 # la voix reçoit les Audio Tags, l'écran non
        self.assertIn("eau", c._notifier.sent[0][1])

    def test_llm_failure_falls_back(self):
        c = make_coach(self.tmp, llm=T.FakeLLM(fail=True))
        iv = c.test_intervention()
        self.assertTrue(iv["fallback"])
        self.assertTrue(iv["text"])
        c2 = make_coach(self.tmp, llm=T.FakeLLM(reply="   "))
        self.assertTrue(c2.test_intervention()["fallback"])
        self.assertLessEqual(len(T._two_sentences(iv["text"]).split(".")), 3)

    def test_voice_off_text_only_and_bubble(self):
        c = make_coach(self.tmp, cfg={"tilt_voice": False, "tilt_bubble": True})
        iv = c.test_intervention()
        self.assertEqual(c._speaker.said, [])
        self.assertFalse(iv["voiced"])
        self.assertEqual(len(c._notifier.sent), 1)
        self.assertEqual(c.status()["bubble"], iv["text"])
        c._cfg["tilt_bubble"] = False
        self.assertIsNone(c.status()["bubble"])
        c._cfg.update(tilt_voice=True, tilt_bubble=True)
        c.test_intervention()
        self.assertEqual(len(c._speaker.said), 1)

    def test_speaker_and_notifier_failures_are_survived(self):
        def boom(*a):
            raise RuntimeError("x")
        c = make_coach(self.tmp, speaker=boom, notifier=boom)
        iv = c.test_intervention()
        self.assertFalse(iv["voiced"])
        self.assertEqual(c.status()["last_intervention"]["text"], iv["text"])


class ReplayTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def test_mark_death_timestamps(self):
        cap = T.FakeCapture(now=2000.0)
        c = make_coach(self.tmp, capture=cap)
        r = c.mark_death(ts=1500.0)
        self.assertTrue(r["ok"], r)
        self.assertEqual(cap.calls[0][:2], (1495.0, 1501.0))
        self.assertEqual(os.path.dirname(cap.calls[0][2]), os.path.join(self.tmp, "Replays"))
        self.assertTrue(r["name"].endswith(".mp4"))
        self.assertEqual(len(c.replays()), 1)
        self.assertEqual(c.replay_path(r["name"]), os.path.realpath(os.path.join(self.tmp, "Replays", r["name"])))
        r2 = c.mark_death()                                                      # ts par défaut = capture.now()
        self.assertEqual(cap.calls[1][:2], (1995.0, 2001.0))
        self.assertEqual(c.status()["last_replay"]["name"], r2["name"])

    def test_capture_missing_clean_error(self):
        def missing():
            raise ImportError("nasko_capture")
        c = make_coach(self.tmp, capture=None, capture_loader=missing)
        r = c.mark_death()
        self.assertFalse(r["ok"])
        self.assertIn("Capture indisponible", r["error"])
        self.assertEqual(c.replays(), [])
        cap = T.FakeCapture(running=False)
        r = make_coach(self.tmp, capture=cap).mark_death()
        self.assertFalse(r["ok"])
        self.assertEqual(cap.calls, [])
        r = make_coach(self.tmp, capture=T.FakeCapture(fail=True)).mark_death()
        self.assertFalse(r["ok"])
        self.assertIn("impossible", r["error"])

    def test_disabled_refuses(self):
        c = make_coach(self.tmp, cfg={"tilt_enabled": False}, sync=False)
        self.assertFalse(c.mark_death()["ok"])

    def test_trapped_names_refused(self):
        c = make_coach(self.tmp)
        ok = c.mark_death(ts=10.0)["name"]
        secret = os.path.join(self.tmp, "secret.mp4")
        open(secret, "wb").write(b"x")
        for bad in ["../secret.mp4", "..\\secret.mp4", "/etc/passwd", os.path.join(self.tmp, "secret.mp4"), "a/b.mp4", ok + "\x00", "x.txt",
                    "", None, 5, "..", ".mp4", "a b.mp4", ok[:-4], "nope.mp4", ok + "/"]:
            self.assertIsNone(c.replay_path(bad), repr(bad))
        link = os.path.join(self.tmp, "Replays", "lien.mp4")
        try:
            os.symlink(secret, link)
            self.assertIsNone(c.replay_path("lien.mp4"))
        except OSError:
            pass

    def test_purge_keeps_newest(self):
        cap = T.FakeCapture()
        c = make_coach(self.tmp, capture=cap, cfg={"tilt_max_replays": 3})
        names = []
        for i in range(6):
            c.clock = (lambda i=i: 1_700_000_000.0 + i)
            names.append(c.mark_death(ts=100.0 + i)["name"])
            p = os.path.join(self.tmp, "Replays", names[-1])
            if os.path.exists(p):
                os.utime(p, (1_700_000_000 + i, 1_700_000_000 + i))
        left = [r["name"] for r in c.replays()]
        self.assertEqual(len(left), 3)
        self.assertEqual(left, names[:2:-1][:3] if False else sorted(left, reverse=True))
        self.assertIn(names[-1], left)
        self.assertNotIn(names[0], left)
        open(os.path.join(self.tmp, "Replays", "notes.txt"), "w").write("garder")   # un fichier étranger n'est jamais purgé
        c.mark_death(ts=300.0)
        self.assertTrue(os.path.exists(os.path.join(self.tmp, "Replays", "notes.txt")))

    def test_vision_option(self):
        calls = []
        frames = []
        def vis(system, ask, jpeg):
            calls.append((ask, jpeg))
            return "Tu t'es exposé sans couverture. Et une autre phrase."
        extractor = lambda path, off: frames.append(off) or b"\xff\xd8jpeg"          # noqa: E731
        c = make_coach(self.tmp, vision=vis, frame_extractor=extractor)
        r = c.mark_death(ts=50.0)
        self.assertIsNone(r["explanation"])
        self.assertEqual(calls, [])                                                # faux par défaut : aucune image n'est envoyée
        c._cfg["tilt_replay_vision"] = True
        r = c.mark_death(ts=60.0)
        self.assertEqual(len(calls), 1)
        self.assertEqual(frames, [3.0])                                            # ~2 s avant la mort (clip commençant 5 s avant)
        self.assertEqual(r["explanation"], "Tu t'es exposé sans couverture.")
        c.test_intervention()
        self.assertIn("exposé sans couverture", c._llm.calls[-1][1])
        c2 = make_coach(self.tmp, vision=lambda *a: (_ for _ in ()).throw(RuntimeError("x")), frame_extractor=extractor, cfg={"tilt_replay_vision": True})
        self.assertTrue(c2.mark_death(ts=70.0)["ok"])


class DeathDetectTests(unittest.TestCase):
    def frame(self, kind="game", seed=0):
        rng = np.random.default_rng(seed)
        f = np.zeros((216, 384, 3), np.uint8)
        f[..., 0] = 60 + rng.integers(0, 30, f.shape[:2])
        f[..., 1] = 140 + rng.integers(0, 30, f.shape[:2])
        f[..., 2] = 70 + rng.integers(0, 40, f.shape[:2])      # décor vert saturé
        if kind == "grey":
            g = f.mean(axis=2, keepdims=True).astype(np.uint8)
            f = np.repeat(g, 3, axis=2)
        elif kind == "dark":
            f = (f * 0.1).astype(np.uint8)
        elif kind == "red":
            f[..., 0], f[..., 1], f[..., 2] = 200, 30, 30
        return f

    def play(self, seq, dt=0.25):
        d = T.DeathDetector()
        hits = []
        for i, k in enumerate(seq):
            r = d.feed(i * dt, k if isinstance(k, np.ndarray) else self.frame(k, i))
            if r:
                hits.append((i * dt, r))
        return hits

    def test_true_positives(self):
        for kind, label in (("grey", "desat"), ("dark", "dark"), ("red", "red")):
            hits = self.play(["game"] * 24 + [kind] * 8)
            self.assertEqual(len(hits), 1, kind)
            self.assertEqual(hits[0][1], label)

    def test_true_negatives(self):
        self.assertEqual(self.play(["game"] * 60), [])
        self.assertEqual(self.play(["game"] * 24 + ["grey"] + ["game"] * 20), [])          # flash d'une image : sous la durée minimale
        self.assertEqual(self.play(["dark"] * 40), [])                                      # déjà dans un écran sombre
        # fondu lent vers le noir : pas brusque
        fade = [(self.frame("game", 0) * (1 - i / 30)).astype(np.uint8) for i in range(30)]
        self.assertEqual(self.play(["game"] * 20 + fade + [fade[-1]] * 10), [])

    def test_cooldown(self):
        seq = ["game"] * 24 + ["grey"] * 6 + ["game"] * 24 + ["grey"] * 6
        self.assertEqual(len(self.play(seq)), 1)                                           # 2e mort 15 s plus tard : refroidissement 30 s
        seq2 = seq[:30] + ["game"] * 130 + ["grey"] * 6
        self.assertEqual(len(self.play(["game"] * 24 + ["grey"] * 6 + ["game"] * 130 + ["grey"] * 6)), 2)

    def test_auto_detect_marks_death(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        seq = iter([(i * 0.25, self.frame("game", i)) for i in range(24)] + [(6 + i * 0.25, self.frame("grey", i)) for i in range(8)])
        cap = T.FakeCapture(now=5000.0)
        c = make_coach(tmp, capture=cap, frame_source=lambda: next(seq, None), input=T.FakeInput(), hz=50, window_s=0.2,
                       cfg={"tilt_mic": False, "tilt_death_detect": True}, sync=False)
        c.start()
        deadline = time.time() + 15
        while time.time() < deadline and not cap.calls:
            time.sleep(0.05)
        c.stop()
        self.assertTrue(cap.calls)
        self.assertAlmostEqual(cap.calls[0][1] - cap.calls[0][0], 6.0)


class PrivacyAndThreadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def test_source_has_no_hooks_or_key_identity(self):
        with open(T.__file__, encoding="utf-8") as fh:
            src = fh.read()
        for bad in ("SetWindowsHookEx", "import pynput", "from pynput", "import keyboard", "from keyboard", "WH_KEYBOARD", "GetKeyNameText", "GetKeyboardState"):
            self.assertNotIn(bad, src)
        self.assertNotIn("requests", src)
        self.assertNotIn("httpx", src)

    def _walk(self, obj, depth=0, seen=None):
        seen = seen if seen is not None else set()
        if id(obj) in seen or depth > 6:
            return
        seen.add(id(obj))
        if isinstance(obj, (int, float, bool, type(None), str, np.floating, np.integer)):
            yield obj
        elif isinstance(obj, dict):
            for k, v in obj.items():
                yield from self._walk(k, depth + 1, seen)
                yield from self._walk(v, depth + 1, seen)
        elif isinstance(obj, (list, tuple, set, collections_deque)):
            for v in obj:
                yield from self._walk(v, depth + 1, seen)

    def test_privacy_only_numbers_and_disk_footprint(self):
        keys_pressed = {"n": 0}
        def keyfn(t):
            keys_pressed["n"] += 1
            return 2 if keys_pressed["n"] % 5 == 0 else 0                           # seulement un COMPTEUR d'appuis
        before = set(os.listdir(self.tmp))
        c = make_coach(self.tmp, input=T.FakeInput(key_fn=keyfn), mic=T.FakeMic(), hz=100, window_s=0.25, sync=False)
        c.start()
        time.sleep(1.4)
        with c.agg.lock:
            for t, n in c.agg.keys:
                self.assertIsInstance(n, int)
                self.assertIsInstance(t, float)
        c.mark_death(ts=10.0, sync=True)
        self.assertGreaterEqual(len(c.history), 2)
        for store in (c.history, c.baseline.stats, c.agg.keys, c.agg.mouse, c.agg.frames):
            for leaf in self._walk(store):
                if isinstance(leaf, str):
                    self.assertIn(leaf, T.WEIGHTS)                                  # seules chaînes : noms de signaux
                    continue
                self.assertTrue(leaf is None or isinstance(leaf, (int, float, np.floating, np.integer)))
        stored = vars(c.agg).keys() | vars(c).keys()
        for forbidden in ("keycodes", "vk", "typed", "text", "buffer", "audio", "samples"):
            self.assertNotIn(forbidden, stored)
        c.stop()
        created = set()
        for root, _, files in os.walk(self.tmp):
            for f in files:
                created.add(os.path.relpath(os.path.join(root, f), self.tmp))
        allowed = {T.CAL_FILE}
        for rel in created - before:
            self.assertTrue(rel in allowed or rel.startswith("Replays" + os.sep), rel)

    def test_clean_stop(self):
        c = make_coach(self.tmp, input=T.FakeInput(), mic=T.FakeMic(), hz=100, window_s=0.2, sync=False)
        n0 = threading.active_count()
        c.start()
        self.assertTrue(c.status()["running"])
        self.assertGreaterEqual(threading.active_count(), n0 + 2)
        time.sleep(0.5)
        t0 = time.time()
        c.stop()
        self.assertLess(time.time() - t0, 3.0)
        self.assertFalse(c.status()["running"])
        time.sleep(0.1)
        self.assertEqual(threading.active_count(), n0)
        c.stop()                                                                    # idempotent

    def test_start_without_windows_reports_error(self):
        c = make_coach(self.tmp, input=None)
        st = c.start()
        self.assertFalse(st["running"])
        self.assertTrue(st["error"])

    def test_autostart_inert_when_disabled(self):
        T._coach = make_coach(self.tmp, cfg={"tilt_enabled": False}, input=T.FakeInput())
        self.addCleanup(setattr, T, "_coach", None)
        n0 = threading.active_count()
        self.assertFalse(T.autostart())
        self.assertEqual(threading.active_count(), n0)
        self.assertFalse(T.status()["running"])
        self.assertEqual(os.listdir(self.tmp), [])
        T._coach._cfg["tilt_enabled"] = True
        T._coach.mic = None
        T._coach._cfg["tilt_mic"] = False
        self.assertTrue(T.autostart())
        self.assertTrue(T.status()["running"])
        T.stop()

    def test_config_validated_and_bounded(self):
        c = make_coach(self.tmp, cfg={})
        r = c.set_config({"tilt_threshold": 5000, "tilt_cooldown_min": "abc", "tilt_voice": "non", "tilt_max_replays": -4, "tilt_bubble": 1, "evil": 1})
        self.assertEqual(r["tilt_threshold"], 95)
        self.assertEqual(r["tilt_cooldown_min"], 8)
        self.assertFalse(r["tilt_voice"])
        self.assertEqual(r["tilt_max_replays"], 1)
        self.assertTrue(r["tilt_bubble"])
        self.assertEqual(r["ignored"], ["evil"])
        self.assertNotIn("evil", c._cfg)
        d = make_coach(self.tmp, cfg={"tilt_enabled": False}).config()
        self.assertEqual((d["tilt_enabled"], d["tilt_threshold"], d["tilt_cooldown_min"], d["tilt_replay_vision"], d["tilt_death_detect"]), (False, 70, 8, False, False))

    def test_disabled_never_intervenes(self):
        c = make_coach(self.tmp, cfg={"tilt_enabled": False}, sync=False)
        rng = np.random.default_rng(20)
        ivs, _, _ = run_scenario(c, [0.0] * 120 + [1.0] * 20, rng)
        self.assertEqual(ivs, [])
        self.assertEqual(c._speaker.said, [])


import collections  # noqa: E402
collections_deque = collections.deque

if __name__ == "__main__":
    unittest.main(verbosity=1)
