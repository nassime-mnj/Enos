"""Bibliothèque d'assets de CinePulse (CinePulse/backend/asset_store.py), avec le vrai FFmpeg. Lancer : python tests/test_cinepulse_assets.py"""
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "CinePulse", "backend"))
import asset_store as A  # noqa: E402
import ffmpeg_wrapper as W  # noqa: E402

FF = W.FFmpeg()


def make(cmd, out):
    subprocess.run([FF.ffmpeg, "-y", "-v", "error"] + cmd + [out], check=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return out


@unittest.skipUnless(FF.available, "FFmpeg introuvable")
class Store(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = tempfile.mkdtemp()
        cls.video = make(["-f", "lavfi", "-i", "testsrc=duration=2:size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-shortest", "-pix_fmt", "yuv420p"], os.path.join(cls.src, "clip.mp4"))
        cls.silent = make(["-f", "lavfi", "-i", "color=c=red:size=320x240:rate=25:duration=1", "-pix_fmt", "yuv420p"], os.path.join(cls.src, "mute.mp4"))
        cls.audio = make(["-f", "lavfi", "-i", "sine=frequency=880:duration=3"], os.path.join(cls.src, "bip.wav"))
        from PIL import Image
        cls.logo = os.path.join(cls.src, "logo.png")
        Image.new("RGBA", (1800, 900), (255, 0, 0, 128)).save(cls.logo)
        cls.junk = os.path.join(cls.src, "faux.mp4")
        with open(cls.junk, "wb") as f:
            f.write(b"ceci n'est pas une video" * 50)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.src, ignore_errors=True)

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.s = A.AssetStore(self.root, FF)

    def tearDown(self):
        self.s.close()
        shutil.rmtree(self.root, ignore_errors=True)

    def imp(self, path):
        a, dup = self.s.import_file(path, os.path.basename(path))
        return a, dup

    def test_video_import_proxy_thumb_peaks(self):
        a, dup = self.imp(self.video)
        self.assertFalse(dup)
        self.assertEqual((a["kind"], a["width"], a["height"], a["has_audio"]), ("video", 1280, 720, True))
        self.assertAlmostEqual(a["duration"], 2.0, delta=0.2)
        self.assertEqual(a["state"], "processing")                              # l'import répond avant le traitement
        self.assertTrue(self.s.wait_idle(120))
        a = self.s.get(a["id"])
        self.assertEqual((a["state"], a["error"], a["proxy"]), ("ready", "", True))
        proxy = self.s.path(a["id"], "proxy")
        self.assertTrue(proxy.endswith(".mp4") and os.path.getsize(proxy) > 0)
        self.assertEqual(W.FFmpeg().probe(proxy)["height"], 540)               # proxy basse résolution
        self.assertTrue(self.s.path(a["id"], "thumb"))
        self.assertEqual(len(self.s.peaks(a["id"], 100)), 100)
        self.assertTrue(os.path.isfile(self.s.path(a["id"], "original")))      # l'original reste intact

    def test_silent_video_has_no_peaks_and_small_video_not_upscaled(self):
        a, _ = self.imp(self.silent)
        self.assertFalse(a["has_audio"])
        self.assertTrue(self.s.wait_idle(120))
        self.assertIsNone(self.s.peaks(a["id"]))
        self.assertEqual(W.FFmpeg().probe(self.s.path(a["id"], "proxy"))["height"], 240)

    def test_image_keeps_alpha_and_is_reduced(self):
        a, _ = self.imp(self.logo)
        self.assertEqual((a["kind"], a["width"], a["height"], a["duration"]), ("image", 1800, 900, None))
        self.assertTrue(self.s.wait_idle(60))
        p = self.s.path(a["id"], "proxy")
        self.assertTrue(p.endswith(".png"))
        self.assertEqual(W.FFmpeg().probe(p)["width"], 960)
        from PIL import Image
        with Image.open(p) as im:
            self.assertEqual(im.mode, "RGBA")

    def test_audio(self):
        a, _ = self.imp(self.audio)
        self.assertEqual((a["kind"], a["has_audio"]), ("audio", True))
        self.assertTrue(self.s.wait_idle(60))
        a = self.s.get(a["id"])
        self.assertEqual((a["thumb_url"], a["proxy"], a["state"]), ("", False, "ready"))
        self.assertTrue(self.s.path(a["id"], "proxy").endswith(".wav"))        # sans proxy : l'original sert de lecture
        self.assertTrue(self.s.peaks(a["id"], 50))

    def test_dedupe_and_persistence(self):
        a, _ = self.imp(self.audio)
        b, dup = self.imp(self.audio)
        self.assertTrue(dup)
        self.assertEqual(a["id"], b["id"])
        self.assertEqual(self.s.stats()["count"], 1)
        self.assertEqual(len(os.listdir(self.s.dirs["originals"])), 1)
        self.s.wait_idle(60)
        again = A.AssetStore(self.root, FF)                                    # redémarrage : la bibliothèque est relue depuis le disque
        self.assertEqual([x["id"] for x in again.list()], [a["id"]])
        again.close()

    def test_rejects_unreadable_and_cleans_up(self):
        with self.assertRaises(ValueError):
            self.s.import_file(self.junk, "faux.mp4")
        with self.assertRaises(ValueError):
            self.s.import_file(self.junk, "pas-de-extension")
        self.assertEqual(os.listdir(self.s.dirs["originals"]), [])
        self.assertEqual(self.s.stats()["count"], 0)

    def test_list_filters_search_tags_rename_uses(self):
        v, _ = self.imp(self.video)
        i, _ = self.imp(self.logo)
        au, _ = self.imp(self.audio)
        self.assertEqual(len(self.s.list()), 3)
        self.assertEqual([x["id"] for x in self.s.list(kind="image")], [i["id"]])
        self.assertEqual([x["id"] for x in self.s.list(q="BIP")], [au["id"]])
        self.assertEqual(self.s.list(q="100%"), [])                            # % et _ sont littéraux, pas des jokers SQL
        self.assertTrue(self.s.rename(i["id"], name="Mon logo.png", tags=["Marque", "marque", "intro!"]))
        self.assertEqual(self.s.get(i["id"])["tags"], ["intro", "marque"])
        self.assertEqual([x["id"] for x in self.s.list(q="marque")], [i["id"]])
        self.s.use(au["id"]); self.s.use(au["id"]); self.s.use(v["id"])
        self.assertEqual([x["id"] for x in self.s.list(sort="used")][:2], [au["id"], v["id"]])
        self.s.wait_idle(120)

    def test_delete_removes_every_file(self):
        a, _ = self.imp(self.video)
        self.s.wait_idle(120)
        self.assertTrue(self.s.delete(a["id"]))
        for d in self.s.dirs.values():
            self.assertEqual(os.listdir(d), [], d)
        self.assertFalse(self.s.delete(a["id"]))
        self.assertIsNone(self.s.path(a["id"]))

    def test_bad_ids_are_refused(self):
        for bad in ("../x", "", "zz", "a" * 10 + "/..", None):
            self.assertIsNone(self.s.get(bad))
            self.assertIsNone(self.s.path(bad, "original"))
        a, _ = self.imp(self.audio)
        self.assertIsNone(self.s.path(a["id"], "../../etc"))

    def test_crash_recovery_requeues_processing(self):
        s = A.AssetStore(self.root, FF, start_worker=False)                    # worker figé : l'import reste « processing », comme après un arrêt brutal
        a, _ = s.import_file(self.video, "clip.mp4")
        self.assertEqual(s.get(a["id"])["state"], "processing")
        s.db.close()
        s2 = A.AssetStore(self.root, FF)
        self.assertTrue(s2.wait_idle(120))
        self.assertEqual(s2.get(a["id"])["state"], "ready")
        s2.close()


@unittest.skipUnless(FF.available, "FFmpeg introuvable")
class Http(unittest.TestCase):
    """Serveur CinePulse réel (port 8791, bibliothèque temporaire) : import brut, traitement asynchrone, Range, PATCH, DELETE."""
    PORT = 8791

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.video = make(["-f", "lavfi", "-i", "testsrc=duration=1:size=640x360:rate=25", "-f", "lavfi", "-i", "sine=duration=1", "-shortest", "-pix_fmt", "yuv420p"], os.path.join(cls.tmp, "v.mp4"))
        env = dict(os.environ, CINEPULSE_ASSETS=os.path.join(cls.tmp, "lib"))
        cls.proc = subprocess.Popen([sys.executable, os.path.join(ROOT, "CinePulse", "backend", "server.py"), "--port", str(cls.PORT)], env=env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        for _ in range(100):
            try:
                cls.call("GET", "/api/status")
                break
            except OSError:
                time.sleep(0.1)

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

    def test_full_flow(self):
        with open(self.video, "rb") as f:
            payload = f.read()
        st, a, _ = self.call("POST", "/api/library/import?name=v.mp4", payload)
        self.assertEqual((st, a["kind"], a["duplicate"]), (201, "video", False))
        for _ in range(150):
            st, lib, _ = self.call("GET", "/api/library")
            if lib["assets"][0]["state"] != "processing":
                break
            time.sleep(0.2)
        asset = lib["assets"][0]
        self.assertEqual((asset["state"], asset["proxy"], lib["stats"]["count"]), ("ready", True, 1))
        st, thumb, h = self.call("GET", asset["thumb_url"], raw=True)
        self.assertEqual((st, thumb[:2], h["Content-Type"]), (200, bytes([255, 216]), "image/jpeg"))
        st, part, h = self.call("GET", asset["url"], headers={"Range": "bytes=0-99"}, raw=True)
        self.assertEqual((st, len(part), h["Content-Range"].startswith("bytes 0-99/")), (206, 100, True))
        self.assertEqual(self.call("GET", asset["original_url"], raw=True)[2]["Content-Length"], str(len(payload)))
        self.assertEqual(len(self.call("GET", f"/api/library/{asset['id']}/waveform?buckets=64")[1]["peaks"]), 64)
        st, dup, _ = self.call("POST", "/api/library/import?name=copie.mp4", payload)                  # même contenu : pas de doublon
        self.assertEqual((st, dup["id"], dup["duplicate"]), (200, asset["id"], True))
        st, r, _ = self.call("PATCH", f"/api/library/{asset['id']}", json.dumps({"name": "Intro.mp4", "tags": ["Pub"]}).encode())
        self.assertEqual((st, r["name"], r["tags"]), (200, "Intro.mp4", ["pub"]))
        self.assertEqual(self.call("POST", f"/api/library/{asset['id']}/use", b"")[0], 200)
        self.assertEqual(self.call("GET", "/api/library?kind=audio")[1]["assets"], [])
        self.assertEqual(self.call("GET", "/api/library?q=intro")[1]["assets"][0]["uses"], 1)
        self.assertEqual(self.call("PATCH", f"/api/library/{asset['id']}", b"pas du json")[0], 400)
        self.assertEqual(self.call("DELETE", f"/api/library/{asset['id']}")[0], 200)
        self.assertEqual(self.call("GET", asset["url"], raw=True)[0], 404)
        self.assertEqual(self.call("DELETE", f"/api/library/{asset['id']}")[0], 404)

    def test_errors_and_traversal(self):
        self.assertEqual(self.call("POST", "/api/library/import?name=faux.mp4", b"pas une video")[0], 415)
        self.assertEqual(self.call("POST", "/api/library/import?name=sans_ext", b"x")[0], 415)
        for bad in ("/media/lib/..%2f..%2fserver", "/thumb/0000000000", "/media/lib/zzzzzzzzzz", "/api/library/0000000000/waveform"):
            self.assertEqual(self.call("GET", bad, raw=True)[0], 404, bad)
        self.assertEqual(self.call("POST", "/api/library/import_path", json.dumps({"path": os.path.join(self.tmp, "absent.mp4")}).encode())[0], 404)
        self.assertEqual(self.call("POST", "/api/library/import_path", b"{}")[0], 400)
        st, imp, _ = self.call("POST", "/api/library/import_path", json.dumps({"path": self.video}).encode())
        self.assertIn(st, (200, 201))
        self.call("DELETE", f"/api/library/{imp['id']}")


class Wrapper(unittest.TestCase):
    @unittest.skipUnless(FF.available, "FFmpeg introuvable")
    def test_probe_without_ffprobe(self):
        d = tempfile.mkdtemp()
        try:
            v = make(["-f", "lavfi", "-i", "testsrc=duration=1:size=640x360:rate=24", "-pix_fmt", "yuv420p"], os.path.join(d, "a.mp4"))
            f = W.FFmpeg()
            f.ffprobe = None
            i = f.probe(v)
            self.assertEqual((i["kind"], i["width"], i["height"], i["fps"], i["has_audio"]), ("video", 640, 360, 24.0, False))
            self.assertAlmostEqual(i["duration"], 1.0, delta=0.2)
            junk = os.path.join(d, "x.mp4")
            with open(junk, "wb") as fh:
                fh.write(b"zzzz")
            with self.assertRaises(W.FFmpegError):
                f.probe(junk)
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_kinds(self):
        self.assertEqual([W.kind_from_extension(x) for x in ("a.PNG", "a.mp4", "a.wav", "a.txt")], ["image", "video", "audio", None])


if __name__ == "__main__":
    unittest.main()
