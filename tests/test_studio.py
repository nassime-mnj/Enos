"""Tests du Studio média (nasko_studio). Lancer : python tests/test_studio.py"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nasko_studio as S  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402


def ff(*args):
    r = subprocess.run([S.ffmpeg_exe(), "-y", "-hide_banner", "-loglevel", "error", *map(str, args)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        S.ROOT = os.path.join(self.tmp, "Studio média")
        S.UP = os.path.join(S.ROOT, ".uploads")
        S.OUT = os.path.join(S.ROOT, "Livraison")
        S.JOB.update(busy=False, result=None, error="", cancel=False)
        S.ensure_dirs()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_tool(self, tool, path, **opts):
        ref = S.new_ref()
        shutil.copy(path, os.path.join(S.UP, ref, os.path.basename(path)))
        S.start(tool, ref, opts)
        for _ in range(600):
            if not S.job()["busy"]:
                break
            time.sleep(0.05)
        return S.job()

    def ok(self, tool, path, **opts):
        j = self.run_tool(tool, path, **opts)
        self.assertEqual(j["error"], "", j["error"])
        return j["result"]

    def video(self, name="v.mp4", dur=4, audio=True):
        p = os.path.join(self.tmp, name)
        args = ["-f", "lavfi", "-i", f"testsrc=size=320x240:rate=15:duration={dur}"]
        if audio:
            args += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={dur}"]
        ff(*args, "-c:v", "libx264", "-pix_fmt", "yuv420p", *(["-c:a", "aac"] if audio else []), "-shortest", p)
        return p


class Images(Base):
    def test_convert_heic_webp_to_jpg_png(self):
        import pillow_heif
        pillow_heif.register_heif_opener()
        im = Image.new("RGB", (200, 100), (200, 30, 30))
        heic = os.path.join(self.tmp, "photo.heic")
        im.save(heic, "HEIF")
        r = self.ok("convert_image", heic, fmt="jpg", quality=90)
        out = Image.open(r["paths"][0])
        self.assertEqual((out.format, out.size), ("JPEG", (200, 100)))
        webp = os.path.join(self.tmp, "w.webp")
        Image.new("RGBA", (50, 50), (0, 0, 255, 128)).save(webp, "WEBP")
        r = self.ok("convert_image", webp, fmt="png")
        self.assertEqual(Image.open(r["paths"][0]).mode, "RGBA")                  # transparence conservée
        r = self.ok("convert_image", webp, fmt="jpg")
        self.assertEqual(Image.open(r["paths"][0]).mode, "RGB")                   # JPG : aplati sur blanc

    def test_wrong_kind_is_rejected(self):
        v = self.video()
        j = self.run_tool("convert_image", v) if False else None
        ref = S.new_ref()
        shutil.copy(v, os.path.join(S.UP, ref, "v.mp4"))
        with self.assertRaises(S.StudioError):
            S.start("convert_image", ref, {})
        with self.assertRaises(S.StudioError):
            S.start("convert_image", "../../etc", {})

    def test_upscale(self):
        p = os.path.join(self.tmp, "s.png")
        Image.new("RGB", (60, 40), (10, 200, 10)).save(p)
        r = self.ok("upscale", p, factor=4)
        self.assertEqual(Image.open(r["paths"][0]).size, (240, 160))
        self.assertEqual(r["info"]["to"], "240×160")

    def test_exif_read_and_strip(self):
        p = os.path.join(self.tmp, "gps.jpg")
        im = Image.new("RGB", (80, 60), (120, 120, 120))
        ex = Image.Exif()
        ex[0x010F], ex[0x0110], ex[0x0132] = "Apple", "iPhone 15", "2024:05:01 10:20:30"
        gps = ex.get_ifd(0x8825)
        gps[1], gps[2], gps[3], gps[4] = "N", (48.0, 51.0, 24.0), "E", (2.0, 21.0, 8.0)
        im.save(p, "JPEG", exif=ex)
        r = self.ok("exif_read", p)
        self.assertAlmostEqual(r["gps"]["lat"], 48.856667, 4)
        self.assertAlmostEqual(r["gps"]["lon"], 2.352222, 4)
        labels = {x["label"]: x["value"] for x in r["rows"]}
        self.assertEqual(labels["Modèle de l'appareil"], "iPhone 15")
        out = self.ok("exif_strip", p)["paths"][0]
        again = self.ok("exif_read", out)
        self.assertTrue(again["empty"] and again["gps"] is None)
        self.assertEqual(Image.open(out).size, (80, 60))
        self.assertEqual(open(out, "rb").read()[:2], b"\xff\xd8")

    def test_strip_rotated_jpeg_keeps_visual_orientation(self):
        p = os.path.join(self.tmp, "rot.jpg")
        ex = Image.Exif()
        ex[0x0112] = 6                                                             # à tourner de 90°
        Image.new("RGB", (100, 40), (1, 2, 3)).save(p, "JPEG", exif=ex)
        out = self.ok("exif_strip", p)["paths"][0]
        self.assertEqual(Image.open(out).size, (40, 100))
        self.assertNotIn(0x0112, Image.open(out).getexif())

    def test_png_strip(self):
        from PIL.PngImagePlugin import PngInfo
        p = os.path.join(self.tmp, "t.png")
        meta = PngInfo()
        meta.add_text("Author", "Secret Person")
        Image.new("RGB", (20, 20)).save(p, pnginfo=meta)
        out = self.ok("exif_strip", p)["paths"][0]
        self.assertNotIn(b"Secret Person", open(out, "rb").read())

    def test_blur_faces_and_apply(self):
        import skimage.data as d
        p = os.path.join(self.tmp, "astro.png")
        Image.fromarray(d.astronaut()).save(p)
        r = self.ok("blur_detect", p, faces=True, plates=False, text=False)
        faces = [b for b in r["boxes"] if b["kind"] == "faces"]
        self.assertGreaterEqual(len(faces), 1)
        x0, y0, x1, y1 = faces[0]["rect"]
        self.assertTrue(0.15 < (x0 + x1) / 2 < 0.45 and y0 < 0.4, faces[0])       # visage de l'astronaute en haut à gauche
        out = self.ok("blur_apply", p, boxes=faces, mode="blur")["paths"][0]
        a, b = Image.open(p).convert("L"), Image.open(out).convert("L")
        box = (int(x0 * 512), int(y0 * 512), int(x1 * 512), int(y1 * 512))
        import numpy as np
        da = np.array(a.crop(box)).astype(float).std()
        db = np.array(b.crop(box)).astype(float).std()
        self.assertLess(db, da * 0.6)                                              # beaucoup moins de détail dans la zone
        self.assertEqual(np.array(a)[500:, 500:].tolist(), np.array(b)[500:, 500:].tolist())   # hors zone intact
        for mode in ("pixel", "black"):
            self.assertTrue(os.path.isfile(self.ok("blur_apply", p, boxes=faces, mode=mode)["paths"][0]))
        self.assertIn("Aucune zone", self.run_tool("blur_apply", p, boxes=[])["error"])

    def test_text_zone_detection(self):
        im = Image.new("RGB", (800, 600), "white")
        dr = ImageDraw.Draw(im)
        for i in range(3):
            dr.text((60, 80 + i * 40), "Nom Prenom 12 rue de la Paix 75002 Paris", fill="black")
        p = os.path.join(self.tmp, "txt.png")
        im.save(p)
        r = self.ok("blur_detect", p, faces=False, plates=False, text=True)
        self.assertTrue(any(b["kind"] == "text" for b in r["boxes"]))


class Media(Base):
    def test_video_to_mp3_and_wav(self):
        v = self.video()
        r = self.ok("video_audio", v, fmt="mp3", bitrate=128)
        out = r["paths"][0]
        self.assertTrue(out.endswith(".mp3"))
        self.assertAlmostEqual(S.probe_duration(out), 4.0, delta=0.4)
        r = self.ok("video_audio", v, fmt="wav", start="1", duration="2")
        self.assertAlmostEqual(S.probe_duration(r["paths"][0]), 2.0, delta=0.3)

    def test_no_audio_track_message(self):
        v = self.video("mute.mp4", audio=False)
        self.assertIn("piste audio", self.run_tool("video_audio", v)["error"])

    def test_video_to_gif_loops_forever(self):
        v = self.video(dur=5)
        r = self.ok("video_gif", v, start="1", duration="2", width=200, fps=10)
        out = r["paths"][0]
        g = Image.open(out)
        self.assertEqual((g.format, g.size[0]), ("GIF", 200))
        self.assertGreater(g.n_frames, 10)
        self.assertEqual(g.info.get("loop"), 0)                                    # boucle infinie
        self.assertIn("30 secondes", self.run_tool("video_gif", v, duration="45")["error"])
        self.assertIn("dépasse", self.run_tool("video_gif", v, start="99", duration="2")["error"])

    def test_denoise_reduces_noise(self):
        n = os.path.join(self.tmp, "noisy.wav")
        ff("-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-f", "lavfi", "-i", "anoisesrc=color=white:amplitude=0.15:duration=4", "-filter_complex", "amix=inputs=2:duration=first:normalize=0", n)
        out = self.ok("denoise", n, level="strong")["paths"][0]

        def rms_noise(path):
            r = subprocess.run([S.ffmpeg_exe(), "-hide_banner", "-i", path, "-af", "highpass=f=2000,astats=metadata=1:reset=0", "-f", "null", "-"], capture_output=True, text=True)
            import re
            vals = re.findall(r"RMS level dB:\s*(-?[\d.]+)", r.stderr)
            return float(vals[-1])
        self.assertLess(rms_noise(out), rms_noise(n) - 6)                          # au moins 6 dB de bruit en moins hors de la note
        v = self.video()
        out = self.ok("denoise", v, level="light", wind=True)["paths"][0]
        self.assertTrue(out.endswith(".mp4") and S.has_audio(out))


class Speech(Base):
    def setUp(self):
        super().setUp()
        self.calls = []
        self._orig = S._asr_chunk

        def fake(path, cfg, lang):
            self.calls.append((os.path.basename(path), lang))
            return [{"start": 0.0, "end": 1.5, "text": "Bonjour à tous."}, {"start": 1.6, "end": 3.0, "text": "Voici le point un."},
                    {"start": 6.0, "end": 8.0, "text": "Passons au deuxième sujet, qui est plus long."}]
        S._asr_chunk = fake

    def tearDown(self):
        S._asr_chunk = self._orig
        super().tearDown()

    def test_paragraphs(self):
        segs = S._asr_chunk("x", None, None)
        p = S.paragraphs(segs)
        self.assertEqual(len(p), 2)                                                # pause de 3 s -> nouveau paragraphe
        self.assertEqual(p[0][1], "Bonjour à tous. Voici le point un.")

    def test_transcribe_file(self):
        v = self.video(dur=3)
        r = self.ok("transcribe", v, lang="fr", timestamps=True)
        self.assertIn("\n\n", r["text"])
        self.assertTrue(r["text"].startswith("[0:00] Bonjour"))
        self.assertEqual(len(r["paths"]), 2)
        self.assertIn("-->", open(r["paths"][1], encoding="utf-8").read())
        self.assertEqual(self.calls[0][1], "fr")

    def test_long_media_is_chunked_with_offsets(self):
        a = os.path.join(self.tmp, "long.wav")
        ff("-f", "lavfi", "-i", "sine=frequency=300:duration=1250", "-ac", "1", "-ar", "8000", a)
        segs = S.transcribe_segments(a, "fr")
        self.assertEqual(len(self.calls), 3)                                       # 1250 s -> 3 morceaux de 10 min
        self.assertAlmostEqual(segs[3]["start"], 600.0)
        self.assertAlmostEqual(segs[6]["start"], 1200.0)
        self.assertAlmostEqual(segs[8]["start"], 1206.0)

    def test_cues_and_srt(self):
        cues = S.make_cues([{"start": 0, "end": 10, "text": "mot " * 60}])
        self.assertGreater(len(cues), 1)
        self.assertTrue(all(max(len(l) for l in c["text"].split("\n")) <= 42 for c in cues))
        self.assertTrue(all(a["end"] <= b["start"] + 1e-9 for a, b in zip(cues, cues[1:])))
        self.assertIn("00:00:00,000 -->", S.srt_text(cues))

    def test_subtitles_burned_in(self):
        v = self.video(dur=9)
        r = self.ok("subtitles", v, lang="fr", size="m", pos="bottom", color="yellow")
        mp4, srt = r["paths"]
        self.assertTrue(mp4.endswith("_soustitres.mp4") and os.path.getsize(mp4) > 1000)
        # l'image incrustée diffère de l'originale en bas de l'écran (sous-titre visible à t = 1 s)
        a, b = os.path.join(self.tmp, "a.png"), os.path.join(self.tmp, "b.png")
        ff("-ss", "1", "-i", v, "-frames:v", "1", a)
        ff("-ss", "1", "-i", mp4, "-frames:v", "1", b)
        import numpy as np
        ia, ib = np.array(Image.open(a).convert("RGB")).astype(int), np.array(Image.open(b).convert("RGB")).astype(int)
        self.assertGreater(np.abs(ia[150:] - ib[150:]).mean(), 1.0)
        self.assertLess(np.abs(ia[:60] - ib[:60]).mean(), 8.0)
        only = self.ok("subtitles", v, burn=False)
        self.assertEqual(len(only["paths"]), 1)


class Jobs(Base):
    def test_busy_and_cancel(self):
        v = self.video(dur=2)
        ref = S.new_ref()
        shutil.copy(v, os.path.join(S.UP, ref, "v.mp4"))
        S.JOB["busy"] = True
        with self.assertRaises(S.StudioError):
            S.start("video_audio", ref, {})
        S.JOB["busy"] = False

    def test_output_names_drop_upload_prefix(self):
        self.assertEqual(S.stem("/x/000_ma video.mp4"), "ma video")
        self.assertEqual(S.stem("/x/2024_photo.png"), "2024_photo")

    def test_time_parsing(self):
        self.assertEqual(S._t("1:05"), 65.0)
        self.assertEqual(S._t("00:01:05.5"), 65.5)
        self.assertEqual(S._t("", 5), 5.0)
        with self.assertRaises(S.StudioError):
            S._t("abc")


if __name__ == "__main__":
    unittest.main()
