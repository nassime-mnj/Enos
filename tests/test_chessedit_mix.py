"""Chess Edit : mixage FFmpeg (musique calée + bruitages + voix de Levy avec reverb/écho). Nécessite ffmpeg dans le PATH (sinon le test est ignoré)."""
import os
import re
import shutil
import subprocess
import tempfile
import unittest

import nasko_chessedit as ce

FF = shutil.which("ffmpeg")


def stat(path, start=0.0, dur=None):
    cmd = [FF, "-v", "info", "-ss", str(start)] + (["-t", str(dur)] if dur else []) + ["-i", path, "-af", "volumedetect", "-f", "null", "-"]
    err = subprocess.run(cmd, capture_output=True, text=True).stderr
    m = re.search(r"max_volume: (-?[\d.]+|-inf) dB", err)
    return float(m.group(1)) if m and m.group(1) != "-inf" else -99.0


def duration(path):
    return float(subprocess.run([shutil.which("ffprobe"), "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip())


@unittest.skipUnless(FF, "ffmpeg absent")
class MixTest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.manifest = {"version": 2, "pacing": {"duration": 9.0}, "audio": {"start_offset": 0},
                         "sfx": [{"t": 0.5, "id": "move", "gain": 0.8, "bus": "sfx"}, {"t": 1.0, "id": "capture", "gain": 1, "bus": "sfx"}, {"t": 1.5, "id": "check", "gain": 1, "bus": "sfx"},
                                 {"t": 2.0, "id": "brilliant", "gain": 0.9, "bus": "sfx"}, {"t": 2.2, "id": "the_queen", "gain": 1, "bus": "voice"},
                                 {"t": 5.5, "id": "this_is_the_way", "gain": 1, "bus": "voice"}, {"t": 8.0, "id": "mate", "gain": 1, "bus": "sfx"}, {"t": 8.2, "id": "move", "gain": 0.8, "bus": "sfx"}]}

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def test_sources_et_graphe(self):
        src = ce.sfx_sources(self.d, {"move", "capture", "check", "brilliant", "mate", "the_queen", "this_is_the_way"})
        self.assertEqual(set(src), {"move", "capture", "check", "brilliant", "mate", "the_queen", "this_is_the_way"}, "tous les sons trouvés")
        ins, graph, tracks = ce.mix_graph(self.manifest, src, False)
        self.assertIn("afir", graph)
        self.assertIn("aecho", graph)
        self.assertIn("asetrate=%d" % int(ce.SR * ce.VOICE_RATE), graph)
        self.assertEqual(len(ins), 7)
        self.assertTrue(any("vwet" in t for t in tracks) and any("vecho" in t for t in tracks))

    def test_mixage_sans_musique(self):
        out = ce.build_mix(self.manifest, self.d, "")
        self.assertTrue(out and os.path.isfile(out), "mix.wav écrit")
        self.assertAlmostEqual(duration(out), 9.5, delta=0.3)
        self.assertGreater(stat(out, 0.4, 0.3), -40, "le coup à 0,5 s est audible")
        self.assertLess(stat(out), 0.0, "pas d'écrêtage (limiteur)")
        self.assertGreater(stat(out, 3.2, 1.0), -55, "queue de reverb/écho après la voix de 2,2 s (la voix ralentie finit vers 3,8 s)")
        self.assertLess(stat(out, 7.3, 0.5), stat(out, 5.6, 0.5), "la queue de reverb/écho s'éteint")

    def test_musique_decalee(self):
        music = os.path.join(self.d, "m.wav")
        subprocess.run([FF, "-y", "-f", "lavfi", "-i", "sine=f=220:d=12", "-ar", "44100", music], capture_output=True)
        self.manifest["audio"]["start_offset"] = -2.0                                  # la musique démarre à t = 2 s
        out = ce.build_mix(self.manifest, self.d, music)
        self.assertTrue(out)
        self.assertLess(stat(out, 0.0, 0.3), -30, "pas de musique avant 2 s (juste le bruitage à 0,5 s)")
        self.assertGreater(stat(out, 3.0, 1.0), -28, "la musique joue à partir de 2 s")
        self.manifest["audio"]["start_offset"] = 4.0                                   # la musique démarre à 4 s de sa propre durée
        out2 = ce.build_mix(self.manifest, self.d, music)
        self.assertGreater(stat(out2, 0.0, 0.4), -28, "musique déjà en cours à t = 0")

    def test_sans_sfx(self):
        self.assertEqual(ce.build_mix({"sfx": []}, self.d, ""), "")


if __name__ == "__main__":
    unittest.main()
