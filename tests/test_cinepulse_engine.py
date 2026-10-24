"""Moteur de rendu CinePulse (CinePulse/backend/cinepulse_engine.py) : EDL -> FFmpeg filter_complex, vérifié sur de VRAIS rendus (pixels et son mesurés).
Lancer : python tests/test_cinepulse_engine.py"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from array import array

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "CinePulse", "backend"))
import cinepulse_engine as E  # noqa: E402
import ffmpeg_wrapper as W  # noqa: E402

FF = W.FFmpeg()
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def make(cmd, out):
    subprocess.run([FF.ffmpeg, "-y", "-v", "error"] + cmd + [out], check=True, creationflags=NOWIN)
    return out


def pixel(path, t, fx=0.5, fy=0.5):
    """Couleur RVB du pixel situé à (fx, fy) de l'image à l'instant t (image réduite à 100x50 pour moyenner le bruit)."""
    raw = subprocess.run([FF.ffmpeg, "-v", "error", "-ss", str(t), "-i", path, "-frames:v", "1", "-vf", "scale=100:50:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         capture_output=True, check=True, creationflags=NOWIN).stdout
    assert len(raw) == 100 * 50 * 3, f"image absente à t={t}"
    x, y = min(99, int(fx * 100)), min(49, int(fy * 50))
    o = (y * 100 + x) * 3
    return tuple(raw[o:o + 3])


def rms(path, a, b):
    """Niveau RMS (0..1) du son entre a et b secondes."""
    raw = subprocess.run([FF.ffmpeg, "-v", "error", "-ss", str(a), "-t", str(b - a), "-i", path, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
                         capture_output=True, check=True, creationflags=NOWIN).stdout
    s = array("h")
    s.frombytes(raw[: len(raw) // 2 * 2])
    return (sum(v * v for v in s) / max(1, len(s))) ** 0.5 / 32768


def near(c, rgb, tol=40):
    return all(abs(a - b) <= tol for a, b in zip(c, rgb))


RED, BLUE, GREEN, BLACK = (255, 0, 0), (0, 0, 255), (0, 255, 0), (0, 0, 0)


@unittest.skipUnless(FF.available, "FFmpeg introuvable")
class Engine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        t = cls.tmp
        sine = ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000"]
        cls.media = {}

        def add(aid, kind, path, duration=None, has_audio=False):
            cls.media[aid] = {"path": path, "kind": kind, "duration": duration, "has_audio": has_audio}

        add("red", "video", make(["-f", "lavfi", "-i", "color=c=red:size=320x180:rate=25:duration=3"] + sine + ["-shortest", "-pix_fmt", "yuv420p"], os.path.join(t, "red.mp4")), 3.0, True)
        add("blue", "video", make(["-f", "lavfi", "-i", "color=c=blue:size=320x180:rate=25:duration=3", "-pix_fmt", "yuv420p"], os.path.join(t, "blue.mp4")), 3.0, False)
        add("red2", "video", make(["-f", "lavfi", "-i", "color=c=red:size=320x180:rate=25:duration=2", "-pix_fmt", "yuv420p"], os.path.join(t, "red2.mp4")), 2.0, False)   # sans marge : image figée
        add("tone", "audio", make(sine + ["-t", "4"], os.path.join(t, "tone.wav")), 4.0, True)
        from PIL import Image
        Image.new("RGB", (400, 400), (0, 255, 0)).save(os.path.join(t, "green.png"))
        add("green", "image", os.path.join(t, "green.png"))
        cls.ra = staticmethod(cls.media.get)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    # -- aides
    def edl(self, clips, **settings):
        tracks = [{"id": "V2", "type": "video"}, {"id": "V1", "type": "video"}, {"id": "A1", "type": "audio"}]
        return {"version": 1, "fps": 25, "settings": {"width": 320, "height": 180, "fps": 25, **settings}, "tracks": tracks, "clips": clips}

    @staticmethod
    def clip(asset, track="V1", start=0, dur=2, **kw):
        return {"asset": asset, "track": track, "start": start, "dur": dur, "in": 0, **kw}

    def render(self, edl, name="out.mp4"):
        out = os.path.join(self.tmp, name)
        warn = []
        cmd, graph, dur = E.build_command(edl, self.ra, out, FF.ffmpeg, warn)
        r = subprocess.run(cmd, capture_output=True, creationflags=NOWIN)
        self.assertEqual(r.returncode, 0, r.stderr.decode("utf-8", "replace")[-600:] + "\n" + graph)
        return out, dur, graph

    # ------------------------------------------------------------------ unitaires (sans rendu)
    def test_01_kf_expr_matches_value_at(self):
        pts = [(0.0, 0.2), (1.0, 1.0), (2.5, 0.0)]
        clip = {"kf": {"opacity": pts}, "opacity": 1}
        expr = E.kf_expr(pts, "t").replace("if(", "IF(")
        env = {"IF": lambda c, a, b: a if c else b, "lt": lambda a, b: a < b}
        for t in (0, 0.3, 0.999, 1.0, 1.7, 2.5, 4.0):
            self.assertAlmostEqual(eval(expr, env, {"t": t}), E.value_at(clip, "opacity", t), places=5, msg=f"t={t}")
        self.assertEqual(E.kf_expr([(0, 0.5)], "t"), "0.5")
        neg = E.kf_expr([(0, -0.5), (1, 0.5)], "t")
        self.assertIn("(-0.5)", neg)
        self.assertNotIn("e-", neg)

    def test_02_number_format(self):
        self.assertEqual(E.f(1e-9), "0")
        self.assertEqual(E.f(-0.0000001), "0")
        self.assertEqual(E.f(12.5), "12.5")
        self.assertEqual(E.f(-3), "(-3)")

    def test_03_invalid_edl(self):
        bad = [({}, "vide"), ({"clips": [], "tracks": [1]}, "vide"), ({"clips": [self.clip("red")], "tracks": []}, "pistes"),
               (self.edl([self.clip("nope")]), "introuvable"), (self.edl([self.clip("../../etc/passwd")]), "introuvable"),
               (self.edl([self.clip("red", "A1")]), "piste"), (self.edl([self.clip("tone", "V1")]), "piste"), (self.edl([self.clip("red", "ZZ")]), "piste inconnue"),
               (self.edl([self.clip("red", dur=float("nan"))]), "nombre"), (self.edl([self.clip("red", opacity="1; rm -rf")]), "nombre"),
               (self.edl([self.clip("red", dur=True)]), "nombre"), (self.edl([{**self.clip("red"), "in": 9}]), "point d'entrée"),
               (self.edl([{**self.clip("red"), "kf": {"x": "oops"}}]), "images-clés"), (self.edl([self.clip("red")], preset="8k"), "Préréglage"),
               ("pas un objet", "objet")]
        for edl, word in bad:
            with self.assertRaises(E.EdlError, msg=str(edl)[:60]) as cm:
                E.sanitize(edl, self.ra)
            self.assertIn(word, str(cm.exception), str(edl)[:60])

    def test_04_clamps_and_warnings(self):
        w = []
        plan = E.sanitize(self.edl([{**self.clip("red", dur=9), "opacity": 7, "volume": -3, "scale": 99, "x": 50, "fadeIn": 5, "fadeOut": 5}]), self.ra, w)
        c = plan["clips"][0]
        self.assertAlmostEqual(c["dur"], 3.0)
        self.assertTrue(any("raccourci" in x for x in w))
        self.assertEqual((c["opacity"], c["volume"], c["scale"], c["x"]), (1.0, 0.0, 4.0, 2.0))
        self.assertAlmostEqual(c["fadeIn"] + c["fadeOut"], c["dur"])
        self.assertEqual(plan["duration"], 3.0)

    def test_05_no_user_string_in_command(self):
        edl = self.edl([{**self.clip("red"), "name": "x'];evil;[", "id": "$(calc)", "kf": {"opacity": [{"t": 0, "v": 1}]}}])
        cmd, graph, _ = E.build_command(edl, self.ra, "o.mp4", "ffmpeg")
        self.assertNotIn("evil", " ".join(cmd))
        self.assertNotIn("calc", " ".join(cmd))

    def test_06_transition_sanitize(self):
        a, b = self.clip("red", start=0, dur=2), {**self.clip("blue", start=2, dur=2), "trIn": {"type": "crossfade", "dur": 1}}
        c = {**self.clip("blue", start=5, dur=2), "trIn": {"type": "crossfade", "dur": 1}}                     # pas collé : ignoré
        plan = E.sanitize(self.edl([a, b, c]), self.ra)
        by = {(x["start"]): x for x in plan["clips"]}
        self.assertEqual((by[0]["xf_out"], by[2]["xf_in"], by[5]["xf_in"]), (1.0, 1.0, 0.0))
        order = [x["start"] for x in sorted(plan["clips"], key=lambda x: x["key"])]
        self.assertEqual(order, [2, 0, 5], "A est dessiné au-dessus de B pendant le fondu")

    # ------------------------------------------------------------------ rendus réels
    def test_10_cut_gap_and_duration(self):
        out, dur, _ = self.render(self.edl([self.clip("red", start=1, dur=2), self.clip("blue", start=3, dur=1)]))
        self.assertEqual(dur, 4.0)
        self.assertTrue(near(pixel(out, 0.4), BLACK), "avant le premier clip : noir")
        self.assertTrue(near(pixel(out, 1.5), RED))
        self.assertTrue(near(pixel(out, 3.5), BLUE))
        info = FF.probe(out)
        self.assertAlmostEqual(info["duration"], 4.0, delta=0.15)
        self.assertEqual((info["width"], info["height"]), (320, 180))
        self.assertTrue(info["has_audio"], "une piste audio (silence) existe toujours")

    def test_11_image_stretch_loop(self):
        out, dur, graph = self.render(self.edl([self.clip("green", dur=9)]))
        self.assertIn("-loop", E.build_command(self.edl([self.clip("green", dur=9)]), self.ra, "o", "ffmpeg")[0])
        self.assertTrue(near(pixel(out, 8.0), GREEN), "l'image est encore là après 8 s (étirée sans limite)")
        self.assertAlmostEqual(FF.probe(out)["duration"], 9.0, delta=0.2)

    def test_12_opacity_and_layers(self):
        e = self.edl([self.clip("blue", "V1", 0, 2), {**self.clip("red", "V2", 0, 2), "opacity": 0.5}])
        out, _, _ = self.render(e)
        r, g, b = pixel(out, 1.0)
        self.assertTrue(80 < r < 180 and 80 < b < 180, (r, g, b))
        out, _, _ = self.render(self.edl([self.clip("blue", "V1", 0, 2), self.clip("red", "V2", 0, 2)]), "opaque.mp4")
        self.assertTrue(near(pixel(out, 1.0), RED), "la piste du haut recouvre celle du bas")

    def test_13_fade_in_out(self):
        out, _, _ = self.render(self.edl([{**self.clip("red", dur=3), "fadeIn": 1, "fadeOut": 1}]))
        self.assertLess(pixel(out, 0.1)[0], 90)
        self.assertGreater(pixel(out, 1.5)[0], 215)
        self.assertLess(pixel(out, 2.9)[0], 90)

    def test_14_crossfade_real_handle(self):
        out, dur, _ = self.render(self.edl([self.clip("red", dur=2), {**self.clip("blue", start=2, dur=2), "trIn": {"type": "crossfade", "dur": 1}}]))
        self.assertEqual(dur, 4.0)
        self.assertTrue(near(pixel(out, 1.8), RED))
        r, g, b = pixel(out, 2.5)
        self.assertTrue(70 < r < 190 and 70 < b < 190, ("mi-fondu", r, g, b))
        self.assertGreater(pixel(out, 2.1)[0], pixel(out, 2.9)[0], "le rouge s'efface")
        self.assertTrue(near(pixel(out, 3.5), BLUE))

    def test_15_crossfade_frozen_tail(self):
        out, _, _ = self.render(self.edl([self.clip("red2", dur=2), {**self.clip("blue", start=2, dur=2), "trIn": {"type": "crossfade", "dur": 1}}]))
        r, g, b = pixel(out, 2.5)
        self.assertTrue(70 < r < 190 and 70 < b < 190, ("image figée du clip A", r, g, b))

    def test_16_dip_to_black(self):
        out, _, _ = self.render(self.edl([{**self.clip("red", dur=2), "fadeOut": 1}, {**self.clip("blue", start=2, dur=2), "fadeIn": 1}]))
        self.assertLess(pixel(out, 1.97)[0], 40)
        self.assertLess(pixel(out, 2.03)[2], 40)
        self.assertGreater(pixel(out, 3.5)[2], 215)

    def test_17_keyframes_position(self):
        e = self.edl([{**self.clip("red", dur=2), "scale": 0.25, "kf": {"x": [{"t": 0, "v": -0.3}, {"t": 2, "v": 0.3}]}}])
        out, _, graph = self.render(e)
        self.assertTrue(near(pixel(out, 0.05, 0.2), RED) and near(pixel(out, 0.05, 0.8), BLACK))
        self.assertTrue(near(pixel(out, 1.9, 0.8), RED) and near(pixel(out, 1.9, 0.2), BLACK))

    def test_18_keyframes_scale_and_opacity(self):
        out, _, _ = self.render(self.edl([{**self.clip("red", dur=2), "kf": {"scale": [{"t": 0, "v": 1}, {"t": 2, "v": 0.25}]}}]))
        self.assertTrue(near(pixel(out, 0.05, 0.1), RED))
        self.assertTrue(near(pixel(out, 1.9, 0.1), BLACK) and near(pixel(out, 1.9, 0.5), RED))
        out, _, _ = self.render(self.edl([{**self.clip("red", dur=2), "kf": {"opacity": [{"t": 0, "v": 0}, {"t": 2, "v": 1}]}}]), "kfop.mp4")
        self.assertLess(pixel(out, 0.1)[0], 60)
        self.assertGreater(pixel(out, 1.9)[0], 200)

    def test_19_static_scale_and_position(self):
        out, _, _ = self.render(self.edl([{**self.clip("red", dur=1), "scale": 0.5, "x": 0.25}]))
        self.assertTrue(near(pixel(out, 0.5, 0.75), RED) and near(pixel(out, 0.5, 0.2), BLACK))

    def test_20_audio_volume_keyframes_and_mix(self):
        full, _, _ = self.render(self.edl([self.clip("tone", "A1", 0, 3)]))
        ref = rms(full, 0.2, 2.8)
        self.assertGreater(ref, 0.03)
        half, _, _ = self.render(self.edl([{**self.clip("tone", "A1", 0, 3), "volume": 0.5}]), "half.mp4")
        self.assertAlmostEqual(rms(half, 0.2, 2.8) / ref, 0.5, delta=0.08)
        kf, _, _ = self.render(self.edl([{**self.clip("tone", "A1", 0, 3), "kf": {"volume": [{"t": 0, "v": 0}, {"t": 3, "v": 1}]}}]), "kfv.mp4")
        self.assertLess(rms(kf, 0.0, 0.4), 0.4 * ref)
        self.assertGreater(rms(kf, 2.5, 2.9), 0.7 * ref)
        mute, _, _ = self.render(self.edl([{**self.clip("tone", "A1", 0, 3), "volume": 0}]), "mute.mp4")
        self.assertLess(rms(mute, 0.2, 2.8), 0.002)
        two, _, _ = self.render(self.edl([self.clip("tone", "A1", 0, 3), self.clip("red", "V1", 0, 3)]), "two.mp4")
        self.assertGreater(rms(two, 0.2, 2.8), 1.2 * ref, "deux sources s'additionnent (pas de normalisation automatique)")

    def test_21_audio_start_delay_fades_and_video_sound(self):
        out, _, _ = self.render(self.edl([{**self.clip("tone", "A1", 1, 2), "fadeIn": 0.5, "fadeOut": 0.5}]))
        self.assertLess(rms(out, 0.0, 0.9), 0.003, "silence avant le début du clip")
        self.assertGreater(rms(out, 1.7, 2.3), 0.03)
        self.assertLess(rms(out, 1.0, 1.1), rms(out, 1.7, 2.3) * 0.7)
        vid, _, _ = self.render(self.edl([self.clip("red", "V1", 0, 2)]), "vsound.mp4")
        self.assertGreater(rms(vid, 0.2, 1.8), 0.03, "le son d'un clip vidéo est mixé")

    def test_22_audio_crossfade(self):
        e = self.edl([self.clip("tone", "A1", 0, 2), {**self.clip("tone", "A1", 2, 2), "in": 0, "trIn": {"type": "crossfade", "dur": 1}}])
        out, _, _ = self.render(e)
        self.assertGreater(rms(out, 2.4, 2.6), 0.03, "pas de trou sonore pendant le fondu")

    def test_23_command_via_script_file(self):
        mgr = E.RenderManager(FF.ffmpeg, self.ra, os.path.join(self.tmp, "mgr_script"), script_threshold=50)
        job = mgr.start(self.edl([self.clip("red", dur=1)]))
        res = mgr.wait(job["id"], 60)
        self.assertEqual(res["status"], "done", res)
        self.assertFalse([f for f in os.listdir(mgr.dir) if f.endswith(".graph.txt")], "le fichier de graphe est nettoyé")

    # ------------------------------------------------------------------ tâches asynchrones
    def test_30_job_progress_and_file(self):
        mgr = E.RenderManager(FF.ffmpeg, self.ra, os.path.join(self.tmp, "mgr1"))
        job = mgr.start(self.edl([self.clip("red", dur=3), self.clip("green", "V2", 0, 3), self.clip("tone", "A1", 0, 3)]))
        seen = []
        end = time.time() + 90
        while time.time() < end:
            j = mgr.get(job["id"])
            seen.append(j["progress"])
            if j["status"] not in ("queued", "running"):
                break
            time.sleep(0.02)
        self.assertEqual(j["status"], "done", j)
        self.assertEqual(seen, sorted(seen), "la progression ne recule jamais")
        self.assertEqual(j["progress"], 1.0)
        self.assertTrue(j["file_url"].endswith("/file"))
        self.assertGreater(os.path.getsize(mgr.file(job["id"])), 1000)
        self.assertFalse([f for f in os.listdir(mgr.dir) if ".part" in f])
        self.assertNotIn("_cmd", j)

    def test_31_busy_cancel_and_cleanup(self):
        mgr = E.RenderManager(FF.ffmpeg, self.ra, os.path.join(self.tmp, "mgr2"))
        heavy = self.edl([{**self.clip("green", dur=600), "kf": {"opacity": [{"t": 0, "v": 0}, {"t": 600, "v": 1}]}}], width=1920, height=1080)
        job = mgr.start(heavy)
        with self.assertRaises(E.RenderBusy):
            mgr.start(self.edl([self.clip("red")]))
        time.sleep(1.0)
        self.assertEqual(mgr.get(job["id"])["status"], "running")
        mgr.cancel(job["id"])
        res = mgr.wait(job["id"], 30)
        self.assertEqual(res["status"], "cancelled", res)
        self.assertIsNone(mgr.file(job["id"]))
        self.assertEqual([f for f in os.listdir(mgr.dir)], [], "aucun fichier résiduel après annulation")
        self.assertEqual(mgr.start(self.edl([self.clip("red", dur=1)]))["status"] in ("queued", "running"), True, "un nouvel export est possible après annulation")

    def test_32_failure_reports_ffmpeg_error(self):
        broken = os.path.join(self.tmp, "broken.mp4")
        with open(broken, "wb") as fh:
            fh.write(b"pas une video" * 100)
        media = dict(self.media, broken={"path": broken, "kind": "video", "duration": 5, "has_audio": False})
        mgr = E.RenderManager(FF.ffmpeg, media.get, os.path.join(self.tmp, "mgr3"))
        res = mgr.wait(mgr.start(self.edl([self.clip("broken")]))["id"], 30)
        self.assertEqual(res["status"], "error")
        self.assertTrue(res["error"])
        self.assertFalse(os.listdir(mgr.dir))


@unittest.skipUnless(FF.available, "FFmpeg introuvable")
class Http(unittest.TestCase):
    """Serveur CinePulse réel (port 8793) : /api/render, progression, annulation, téléchargement avec Range."""
    PORT = 8793

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.v = make(["-f", "lavfi", "-i", "color=c=red:size=320x180:rate=25:duration=3", "-f", "lavfi", "-i", "sine=duration=3", "-shortest", "-pix_fmt", "yuv420p"], os.path.join(cls.tmp, "v.mp4"))
        env = dict(os.environ, CINEPULSE_ASSETS=os.path.join(cls.tmp, "lib"), CINEPULSE_EXPORTS=os.path.join(cls.tmp, "exports"))
        cls.proc = subprocess.Popen([sys.executable, os.path.join(ROOT, "CinePulse", "backend", "server.py"), "--port", str(cls.PORT)], env=env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=NOWIN)
        for _ in range(100):
            try:
                cls.call("GET", "/api/status")
                break
            except OSError:
                time.sleep(0.1)
        st, a, _ = cls.call("POST", "/api/library/import_path", json.dumps({"path": cls.v}).encode())
        cls.asset = a

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(10)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    @classmethod
    def call(cls, method, path, body=None, headers=None, raw=False):
        req = urllib.request.Request(f"http://127.0.0.1:{cls.PORT}{path}", data=body, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
                return r.status, (data if raw else json.loads(data)), dict(r.headers)
        except urllib.error.HTTPError as e:
            data = e.read()
            e.close()
            return e.code, (data if raw else json.loads(data or b"{}")), dict(e.headers)

    def edl(self, **kw):
        return {"version": 1, "fps": 25, "settings": {"preset": "480p", "fps": 25}, "tracks": [{"id": "V1", "type": "video"}, {"id": "A1", "type": "audio"}],
                "clips": [{"asset": self.asset["id"], "track": "V1", "start": 0, "dur": 2, "in": 0, **kw}]}

    def test_render_flow_and_download(self):
        st, job, _ = self.call("POST", "/api/render", json.dumps({"edl": self.edl(fadeIn=0.5)}).encode(), {"Content-Type": "application/json"})
        self.assertEqual(st, 202, job)
        for _ in range(300):
            st, j, _ = self.call("GET", f"/api/render/{job['id']}")
            if j["status"] not in ("queued", "running"):
                break
            time.sleep(0.1)
        self.assertEqual((st, j["status"], j["progress"]), (200, "done", 1.0), j)
        st, data, h = self.call("GET", j["file_url"], raw=True)
        self.assertEqual((st, h["Content-Type"]), (200, "video/mp4"))
        self.assertIn("attachment", h.get("Content-Disposition", ""))
        self.assertEqual(data[4:8], b"ftyp")
        st, part, h = self.call("GET", j["file_url"], headers={"Range": "bytes=0-99"}, raw=True)
        self.assertEqual((st, len(part)), (206, 100))

    def test_errors(self):
        post = lambda body: self.call("POST", "/api/render", body if isinstance(body, bytes) else json.dumps(body).encode(), {"Content-Type": "application/json"})  # noqa: E731
        self.assertEqual(post(b"{pas json")[0], 400)
        self.assertEqual(post({"edl": {"clips": [], "tracks": []}})[0], 400)
        st, r, _ = post({"edl": self.edl(asset="x")})
        self.assertEqual(st, 400)
        bad = self.edl()
        bad["clips"][0]["asset"] = "zz9999"
        st, r, _ = post({"edl": bad})
        self.assertEqual(st, 400)
        self.assertIn("introuvable", r["error"])
        self.assertEqual(self.call("GET", "/api/render/inconnu")[0], 404)
        self.assertEqual(self.call("GET", "/api/render/inconnu/file")[0], 404)
        self.assertEqual(self.call("POST", "/api/render/inconnu/cancel", b"")[0], 404)

    def test_cancel_and_busy(self):
        big = self.edl(kf={"opacity": [{"t": 0, "v": 0}, {"t": 500, "v": 1}]})
        big["settings"] = {"preset": "1080p", "fps": 30}
        big["clips"][0].update(dur=500)                                # opacité animée (geq) en 1080p sur 500 s : bien trop long pour finir avant l'annulation
        head = {"Content-Type": "application/json"}
        st, job, _ = self.call("POST", "/api/render", json.dumps({"edl": big}).encode(), head)
        self.assertEqual(st, 202, job)
        st, again, _ = self.call("POST", "/api/render", json.dumps({"edl": self.edl()}).encode(), head)
        self.assertEqual(st, 409, again)
        st, j, _ = self.call("POST", f"/api/render/{job['id']}/cancel", b"")
        self.assertEqual(st, 200)
        for _ in range(200):
            st, j, _ = self.call("GET", f"/api/render/{job['id']}")
            if j["status"] not in ("queued", "running"):
                break
            time.sleep(0.1)
        self.assertEqual(j["status"], "cancelled", j)
        self.assertEqual(self.call("GET", f"/api/render/{job['id']}/file")[0], 404)


if __name__ == "__main__":
    unittest.main(verbosity=2)
