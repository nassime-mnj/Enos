"""Babel Voice (nasko_babel) : hors ligne, faux micro / STT / LLM / TTS / sorties. Lancer : python3 tests/test_babel.py"""
import io
import json
import os
import sys
import threading
import time
import unittest
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nasko_babel as B  # noqa: E402

RNG = np.random.default_rng(7)
SECRET = "sk_SECRETKEY_0123456789"
BLK = B.BLOCK


def noise(sec, k=3):
    """« Phrase » synthétique : bruit large bande dont l'amplitude (k * 1000) identifie la phrase."""
    return RNG.integers(-1000 * k, 1000 * k + 1, int(sec * 16000)).astype(np.int16)


def quiet(sec):
    return RNG.integers(-30, 31, int(sec * 16000)).astype(np.int16)


def wait_until(fn, timeout=6.0):
    end = time.time() + timeout
    while time.time() < end:
        if fn():
            return True
        time.sleep(0.01)
    return fn()


class FakeMic:
    def __init__(self):
        self.q = []
        self.lock = threading.Lock()
        self.closed = False
        self.reads = 0

    def push(self, *parts):
        a = np.concatenate(parts)
        a = a[:len(a) // BLK * BLK]
        with self.lock:
            self.q.extend(a[i:i + BLK] for i in range(0, len(a), BLK))

    def pending(self):
        with self.lock:
            return len(self.q)

    def read(self):
        self.reads += 1
        with self.lock:
            if self.q:
                return self.q.pop(0)
        time.sleep(0.003)
        return quiet(BLK / 16000)

    def close(self):
        self.closed = True


class FakeSink:
    def __init__(self, store, device):
        self.store, self.device = store, device
        store.setdefault(device, [])

    def write(self, data):
        self.store[self.device].append(np.frombuffer(data, dtype="<i2").copy())

    def close(self):
        pass


class Resp:
    def __init__(self, status=200, data=None):
        self.status_code, self._d = status, data or {}

    def json(self):
        return self._d


def make(**over):
    """-> (BabelVoice, mic, sinks, cfg, calls)"""
    mic = FakeMic()
    sinks, calls = {}, {"stt": 0, "tr": 0, "tts": 0, "http": []}
    cfg = {"elevenlabs_api_key": SECRET, "llm_api_key": SECRET + "L", "babel_voice_id": "VOICEID12345", "babel_max_lag": 6.0,
           "babel_mute_while_playing": False}
    cfg.update(over.pop("cfg", {}))

    def stt(audio, src, c):
        calls["stt"] += 1
        time.sleep(over.get("stt_delay", 0.01))
        k = int(round(int(np.abs(audio).max()) / 1000.0))
        return f"salut les amis {k}"

    def translate(text, src, dst, c):
        calls["tr"] += 1
        return f"zzzz qqqq {text.split()[-1]}"

    def tts(text, c, rate):
        calls["tts"] += 1
        time.sleep(over.get("tts_delay", 0.02))
        k = int(text.split()[-1])
        for _ in range(3):
            yield np.full(400, k, dtype="<i2").tobytes()

    def http(method, url, headers=None, data=None, files=None):
        calls["http"].append((method, url, headers, data, files))
        if url.endswith("/voices/add"):
            return Resp(200, {"voice_id": "NEWVOICE98765"})
        return Resp(200, {"voices": [{"voice_id": "abcdefgh1", "name": "Moi", "category": "cloned"}]})

    def upd(v):
        cfg.update(v)

    b = B.BabelVoice(mic_factory=over.get("mic_factory", lambda dev: mic), sink_factory=lambda dev, rate: FakeSink(sinks, dev or "default"),
                     stt=over.get("stt", stt), translate=over.get("translate", translate), tts=over.get("tts", tts),
                     cfg_get=lambda: dict(cfg), cfg_set=upd, http=http,
                     devices=lambda: {"inputs": [{"index": 0, "name": "Micro"}], "outputs": [{"index": 0, "name": "CABLE Input"}]})
    return b, mic, sinks, cfg, calls


def played(sinks, dev="default"):
    """Valeurs successives (une par phrase) jouées sur la sortie."""
    seq = []
    for c in sinks.get(dev, []):
        if len(c) and (not seq or seq[-1] != int(c[0])):
            seq.append(int(c[0]))
    return seq


def babel_threads():
    return [t.name for t in threading.enumerate() if t.name.startswith("babel-")]


class Base(unittest.TestCase):
    def tearDown(self):
        b = getattr(self, "b", None)
        if b:
            b.stop()
        self.assertEqual(babel_threads(), [])


class TestSegmenter(Base):
    def run_seg(self, audio, seg=None):
        seg = seg or B.Segmenter()
        out = []
        for i in range(0, len(audio) // BLK * BLK, BLK):
            p = seg.feed(audio[i:i + BLK])
            if p is not None:
                out.append(p)
        return out, seg

    def test_two_phrases(self):
        a = np.concatenate([quiet(1), noise(1.2, 3), quiet(1.0), noise(0.8, 4), quiet(1.0)])
        out, _ = self.run_seg(a)
        self.assertEqual(len(out), 2)
        self.assertGreater(len(out[0]) / 16000, 1.1)
        self.assertLess(len(out[0]) / 16000, 1.9)

    def test_silence_threshold(self):
        # silence de 0,3 s DANS la phrase : une seule phrase ; >= 0,45 s : deux
        one, _ = self.run_seg(np.concatenate([quiet(0.5), noise(0.6), quiet(0.3), noise(0.6), quiet(1)]))
        two, _ = self.run_seg(np.concatenate([quiet(0.5), noise(0.6), quiet(0.6), noise(0.6), quiet(1)]))
        self.assertEqual((len(one), len(two)), (1, 2))

    def test_noise_ignored(self):
        click = np.concatenate([quiet(1), noise(0.05, 8), quiet(1)])
        hum = (RNG.integers(-120, 121, 16000 * 3)).astype(np.int16)
        self.assertEqual(self.run_seg(click)[0], [])
        self.assertEqual(self.run_seg(hum)[0], [])

    def test_max_duration(self):
        out, _ = self.run_seg(np.concatenate([quiet(0.5), noise(15, 3), quiet(1)]))
        self.assertGreaterEqual(len(out), 1)
        self.assertLessEqual(len(out[0]) / 16000, 12.1)

    def test_adaptive_floor(self):
        seg = B.Segmenter()
        amb = RNG.integers(-340, 341, 16000 * 4).astype(np.int16)           # bruit de fond rms ~196
        self.run_seg(amb, seg)
        self.assertGreater(seg.floor, 150)
        out, _ = self.run_seg(np.concatenate([noise(1, 4), quiet(1)]), seg)
        self.assertEqual(len(out), 1)


class TestPipeline(Base):
    def test_order_latency_and_clean_stop(self):
        self.b, mic, sinks, cfg, calls = make()
        self.b.start()
        self.assertTrue(self.b.status()["running"])
        mic.push(quiet(1), noise(1, 2), quiet(0.8), noise(1, 3), quiet(0.8), noise(1, 4), quiet(0.8))
        self.assertTrue(wait_until(lambda: len(played(sinks)) >= 3))
        self.assertEqual(played(sinks), [2, 3, 4])
        st = self.b.status()
        for k in ("stt_ms", "translate_ms", "tts_ms", "total_ms"):
            self.assertIn(k, st["latency"])
            self.assertIn(k, st["latency_avg"])
        self.assertGreaterEqual(st["latency"]["stt_ms"], 8)
        self.assertGreaterEqual(st["latency"]["tts_ms"], 15)
        self.assertGreaterEqual(st["latency"]["total_ms"], st["latency"]["stt_ms"] + st["latency"]["tts_ms"] - 1)
        self.assertEqual(st["last_translated"], "zzzz qqqq 4")
        self.assertEqual(st["last_source"], "salut les amis 4")
        self.assertEqual(st["error"], "")
        self.b.stop()
        self.assertFalse(self.b.status()["running"])
        self.assertTrue(mic.closed)
        self.b.stop()                                                        # idempotent

    def test_start_twice(self):
        self.b, *_ = make()
        self.b.start()
        n = len(babel_threads())
        self.b.start()
        self.assertEqual(len(babel_threads()), n)

    def test_skip_old_when_lag(self):
        self.b, mic, sinks, cfg, calls = make(stt_delay=0.8, cfg={"babel_max_lag": 2.0})
        self.b.start()
        mic.push(quiet(0.5), *[np.concatenate([noise(0.8, k), quiet(0.6)]) for k in (2, 3, 4, 5, 6, 7)])
        self.assertTrue(wait_until(lambda: 7 in played(sinks), 15))
        seq = played(sinks)
        self.assertEqual(seq, sorted(seq))
        self.assertEqual(seq[0], 2)
        self.assertEqual(seq[-1], 7)
        self.assertLess(len(seq), 6)
        self.assertGreaterEqual(self.b.status()["skipped"], 1)
        self.assertEqual(len(seq) + self.b.status()["skipped"], 6)

    def test_antiloop_mutes_mic_while_playing(self):
        release = threading.Event()

        def slow_tts(text, c, rate):
            yield np.full(400, 2, dtype="<i2").tobytes()
            release.wait(5)
            yield np.full(400, 2, dtype="<i2").tobytes()
        self.b, mic, sinks, cfg, calls = make(tts=slow_tts, cfg={"babel_mute_while_playing": True})
        self.b.start()
        mic.push(quiet(0.5), noise(1, 2), quiet(0.8))
        self.assertTrue(wait_until(lambda: self.b.status()["playing"]))
        mic.push(noise(1, 3), quiet(0.8))                                    # l'utilisateur (ou l'écho) parle pendant la lecture
        self.assertTrue(wait_until(lambda: mic.pending() == 0))
        time.sleep(0.1)
        release.set()
        self.assertTrue(wait_until(lambda: not self.b.status()["playing"]))
        time.sleep(0.2)
        self.assertEqual(calls["stt"], 1)

    def test_no_antiloop_when_disabled(self):
        release = threading.Event()

        def slow_tts(text, c, rate):
            yield np.full(400, 2, dtype="<i2").tobytes()
            release.wait(5)
        self.b, mic, sinks, cfg, calls = make(tts=slow_tts, cfg={"babel_mute_while_playing": False})
        self.b.start()
        mic.push(quiet(0.5), noise(1, 2), quiet(0.8))
        self.assertTrue(wait_until(lambda: self.b.status()["playing"]))
        mic.push(noise(1, 3), quiet(0.8))
        self.assertTrue(wait_until(lambda: calls["stt"] == 2))
        release.set()

    def test_echo_filter(self):
        texts = iter(["bonjour tout le monde", "hello everyone"])
        tr = {"bonjour tout le monde": "hello everyone"}
        self.b, mic, sinks, cfg, calls = make(stt=lambda a, s, c: next(texts), translate=lambda t, s, d, c: tr.get(t, t),
                                              tts=lambda t, c, r: iter([np.full(400, 5, dtype="<i2").tobytes()]))
        self.b.start()
        mic.push(quiet(0.5), noise(1, 2), quiet(0.8), noise(1, 3), quiet(0.8))   # le micro réentend la voix traduite
        self.assertTrue(wait_until(lambda: len(sinks.get("default", [])) >= 1))
        time.sleep(0.6)
        self.assertEqual(len(sinks["default"]), 1)
        self.assertEqual(self.b.status()["phrases"], 1)

    def test_ptt(self):
        self.b, mic, sinks, cfg, calls = make(cfg={"babel_mode": "ptt"})
        self.b.start()
        mic.push(quiet(0.3), noise(1, 3), quiet(0.8))                        # touche relâchée : rien
        self.assertTrue(wait_until(lambda: mic.pending() == 0))
        time.sleep(0.2)
        self.assertEqual(calls["stt"], 0)
        self.b.ptt_down()
        self.assertTrue(self.b.status()["ptt"])
        mic.push(noise(1, 3))
        self.assertTrue(wait_until(lambda: mic.pending() == 0))
        time.sleep(0.05)
        self.assertEqual(calls["stt"], 0)                                    # tant que la touche est tenue, rien n'est envoyé
        self.b.ptt_up()
        self.assertTrue(wait_until(lambda: played(sinks) == [3]))
        self.assertEqual(calls["stt"], 1)

    def test_monitor_copy(self):
        self.b, mic, sinks, cfg, calls = make(cfg={"babel_monitor": True, "babel_out_device": "CABLE", "babel_monitor_device": "Casque"})
        self.b.start()
        mic.push(quiet(0.5), noise(1, 2), quiet(0.8))
        self.assertTrue(wait_until(lambda: played(sinks, "Casque") == [2] and played(sinks, "CABLE") == [2]))
        self.assertEqual(sum(map(len, sinks["CABLE"])), sum(map(len, sinks["Casque"])))

    def test_network_errors_do_not_crash(self):
        mode = {"stt": "boom", "tts": "boom"}

        def stt(a, s, c):
            if mode["stt"] == "boom":
                raise B.BabelError("Transcription injoignable (ConnectError).")
            return f"salut les amis {int(round(int(np.abs(a).max()) / 1000.0))}"

        def tts(t, c, r):
            if mode["tts"] == "boom":
                raise B.BabelError("ElevenLabs injoignable (ConnectError) " + SECRET)
            yield np.full(400, 3, dtype="<i2").tobytes()
        self.b, mic, sinks, cfg, calls = make(stt=stt, tts=tts)
        self.b.start()
        mic.push(quiet(0.5), noise(1, 2), quiet(0.8))
        self.assertTrue(wait_until(lambda: "Transcription" in self.b.status()["error"]))
        mode["stt"] = "ok"
        mic.push(noise(1, 3), quiet(0.8))
        self.assertTrue(wait_until(lambda: "ElevenLabs" in self.b.status()["error"]))
        self.assertNotIn(SECRET, json.dumps(self.b.status()))
        self.assertTrue(self.b.status()["running"])
        mode["tts"] = "ok"
        mic.push(noise(1, 3), quiet(0.8))
        self.assertTrue(wait_until(lambda: played(sinks) == [3]))

    def test_mic_unavailable(self):
        def bad(dev):
            raise OSError("pas de micro")
        self.b, *_ = make(mic_factory=bad)
        with self.assertRaises(B.BabelError):
            self.b.start()
        self.assertFalse(self.b.status()["running"])


class TestApi(Base):
    def test_say_without_mic(self):
        def nomic(dev):
            raise AssertionError("le micro ne doit pas être ouvert")
        self.b, mic, sinks, cfg, calls = make(mic_factory=nomic)
        r = self.b.say("salut les amis 7")
        self.assertEqual(r["translated"], "zzzz qqqq 7")
        self.assertEqual(played(sinks), [7])
        self.assertEqual(self.b.translate_text("salut les amis 9"), "zzzz qqqq 9")
        with self.assertRaises(B.BabelError):
            self.b.say("   ")

    def test_say_while_running_is_queued(self):
        self.b, mic, sinks, cfg, calls = make()
        self.b.start()
        self.assertTrue(self.b.say("salut les amis 6")["queued"])
        self.assertTrue(wait_until(lambda: played(sinks) == [6]))

    def test_config_validation(self):
        self.b, mic, sinks, cfg, calls = make()
        c = self.b.config()
        self.assertFalse(c["babel_enabled"])
        self.assertEqual((c["babel_src"], c["babel_dst"], c["babel_mode"], c["babel_max_lag"]), ("fr", "en", "vad", 6.0))
        bad = [{"babel_dst": "xx"}, {"babel_dst": "auto"}, {"babel_src": "klingon"}, {"babel_max_lag": 1}, {"babel_max_lag": 99},
               {"babel_max_lag": float("nan")}, {"babel_max_lag": "abc"}, {"babel_mode": "radio"}, {"babel_enabled": "oui"},
               {"babel_monitor": 1}, {"babel_model": "gpt"}, {"babel_voice_id": "../etc"}, {"babel_out_device": -2},
               {"babel_out_device": "x" * 500}, {"babel_rate": 8000}]
        for v in bad:
            with self.assertRaises(ValueError, msg=str(v)):
                self.b.set_config(v)
        with self.assertRaises(ValueError):                                  # tout ou rien
            self.b.set_config({"babel_src": "en", "babel_dst": "xx"})
        self.assertNotIn("babel_src", cfg)
        for dst in ("en", "ru", "de", "es", "pt", "it", "tr", "pl", "ja", "ko", "zh"):
            self.assertEqual(self.b.set_config({"babel_dst": dst})["babel_dst"], dst)
        r = self.b.set_config({"babel_src": "auto", "babel_max_lag": 10, "babel_mode": "ptt", "babel_out_device": 2, "babel_monitor": True,
                               "babel_model": "eleven_multilingual_v2", "evil_key": "x"})
        self.assertEqual((r["babel_src"], r["babel_max_lag"], r["babel_mode"], r["babel_out_device"]), ("auto", 10.0, "ptt", 2))
        self.assertNotIn("evil_key", cfg)

    def test_keys_never_exposed(self):
        self.b, mic, sinks, cfg, calls = make(cfg={"stt_api_key": SECRET + "S"})
        dumps = [json.dumps(self.b.config()), json.dumps(self.b.status()), json.dumps(self.b.set_config({"babel_dst": "ru"})),
                 json.dumps(self.b.list_devices())]
        self.b._err("Test", Exception("échec avec " + SECRET + " et " + SECRET + "L"))
        dumps.append(json.dumps(self.b.status()))
        for d in dumps:
            self.assertNotIn("SECRETKEY", d)
        self.assertTrue(self.b.config()["eleven_configured"])

    def test_clone_requires_consent(self):
        self.b, mic, sinks, cfg, calls = make()
        wav = b"RIFF" + b"\0" * 5000
        for consent in ({}, {"consent": False}, {"consent": None}, {"consent": "yes"}, {"consent": 1}):
            with self.assertRaises(B.BabelError) as cm:
                self.b.create_clone(wav, "Ma voix", **consent)
            self.assertIn("propre voix", str(cm.exception))
        self.assertEqual(calls["http"], [])                                  # aucune requête sans consentement
        r = self.b.create_clone(wav, "Ma voix", consent=True)
        self.assertEqual(r["voice_id"], "NEWVOICE98765")
        self.assertEqual(len(calls["http"]), 1)
        self.assertTrue(calls["http"][0][1].endswith("/voices/add"))
        self.assertEqual(cfg["babel_voice_id"], "NEWVOICE98765")
        self.assertNotIn("SECRETKEY", json.dumps(r))
        with self.assertRaises(B.BabelError):
            self.b.create_clone(b"x", "Ma voix", consent=True)                # échantillon trop court
        with self.assertRaises(B.BabelError):
            self.b.create_clone(wav, "", consent=True)

    def test_list_voices_and_devices(self):
        self.b, mic, sinks, cfg, calls = make()
        self.assertEqual(self.b.list_voices()[0]["name"], "Moi")
        d = self.b.list_devices()
        self.assertEqual(set(d) & {"inputs", "outputs"}, {"inputs", "outputs"})

    def test_record_sample(self):
        self.b, mic, sinks, cfg, calls = make()
        mic.push(noise(6, 2))
        wav = self.b.record_sample(5)
        with wave.open(io.BytesIO(wav)) as w:
            self.assertEqual((w.getframerate(), w.getnchannels()), (16000, 1))
            self.assertAlmostEqual(w.getnframes() / 16000, 5.0, delta=0.1)
        self.assertTrue(mic.closed)
        for s in (1, 500, "x"):
            with self.assertRaises(B.BabelError):
                self.b.record_sample(s)

    def test_autostart_inert(self):
        calls = []
        self.b, mic, sinks, cfg, _ = make(mic_factory=lambda d: calls.append(d) or FakeMic())
        self.assertFalse(self.b.autostart())
        self.assertEqual((calls, babel_threads(), self.b.status()["running"]), ([], [], False))
        cfg["babel_enabled"] = True
        self.assertTrue(self.b.autostart())
        self.assertTrue(self.b.status()["running"])
        self.b.stop()
        self.b2, *_ = make(cfg={"babel_enabled": True}, mic_factory=lambda d: (_ for _ in ()).throw(OSError("x")))
        self.assertFalse(self.b2.autostart())                                # ne lève jamais

    def test_start_requires_eleven_when_default_tts(self):
        b = B.BabelVoice(cfg_get=lambda: {}, cfg_set=lambda v: None)
        old = os.environ.pop("ELEVENLABS_API_KEY", None)
        try:
            with self.assertRaises(B.BabelError):
                b.start()
        finally:
            if old:
                os.environ["ELEVENLABS_API_KEY"] = old

    def test_no_audio_on_disk(self):
        before = set(os.listdir(os.getcwd()))
        self.b, mic, sinks, cfg, calls = make()
        mic.push(noise(6, 2))
        self.b.record_sample(5)
        self.assertEqual(set(os.listdir(os.getcwd())) - before, set())

    def test_translation_prompt(self):
        p = B.translation_prompt("fr", "ru")
        self.assertIn("Russian", p)
        self.assertIn("ONLY the translation", p)


if __name__ == "__main__":
    unittest.main(verbosity=1)
