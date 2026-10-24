"""CinePulse NLE dans un vrai Edge (DevTools Protocol) : viewport téléphone, VRAIS événements tactiles (Input.dispatchTouchEvent), vraie bibliothèque.
Lancer : python tests/test_cinepulse_nle.py          (captures d'écran : variable d'environnement NLE_SHOTS=<dossier>)"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "CinePulse", "backend"))
import ffmpeg_wrapper as W  # noqa: E402

EDGE = next((p for p in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", r"C:\Program Files\Microsoft\Edge\Application\msedge.exe") if os.path.isfile(p)), None)
FF = W.FFmpeg()
SERVER_PORT, CDP_PORT = 8792, 9333
try:
    from websockets.sync.client import connect
except ImportError:                                                                                   # pragma: no cover
    connect = None


class CDP:
    def __init__(self, url):
        self.ws, self.n = connect(url, max_size=None, open_timeout=15), 0

    def call(self, method, **params):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv(timeout=60))
            if msg.get("id") == self.n:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg["result"]

    def ev(self, expr, wait=False):
        r = self.call("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=wait)
        if "exceptionDetails" in r:
            raise RuntimeError(r["exceptionDetails"].get("exception", {}).get("description") or str(r["exceptionDetails"]))
        return r["result"].get("value")

    def touch(self, kind, pts):
        self.call("Input.dispatchTouchEvent", type=kind, touchPoints=[{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)])

    def shot(self, name):
        d = os.environ.get("NLE_SHOTS")
        if d:
            import base64
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, name), "wb") as f:
                f.write(base64.b64decode(self.call("Page.captureScreenshot", format="png")["data"]))


def media(tmp):
    def mk(cmd, out):
        subprocess.run([FF.ffmpeg, "-y", "-v", "error"] + cmd + [out], check=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return out
    from PIL import Image
    v = mk(["-f", "lavfi", "-i", "testsrc=duration=3:size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-shortest", "-pix_fmt", "yuv420p"], os.path.join(tmp, "Interview.mp4"))
    a = mk(["-f", "lavfi", "-i", "sine=frequency=660:duration=6"], os.path.join(tmp, "Musique.wav"))
    i = os.path.join(tmp, "Logo.png")
    Image.new("RGBA", (800, 400), (224, 36, 60, 255)).save(i)
    return v, a, i


@unittest.skipUnless(EDGE and connect and FF.available, "Edge, websockets ou FFmpeg introuvable")
class Nle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.files = media(cls.tmp)
        env = dict(os.environ, CINEPULSE_ASSETS=os.path.join(cls.tmp, "lib"), CINEPULSE_EXPORTS=os.path.join(cls.tmp, "exports"))
        nw = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        cls.srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "CinePulse", "backend", "server.py"), "--port", str(SERVER_PORT)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=nw)
        base = f"http://127.0.0.1:{SERVER_PORT}"
        for _ in range(100):
            try:
                urllib.request.urlopen(base + "/api/status", timeout=1).read()
                break
            except OSError:
                time.sleep(0.1)
        for f in cls.files:                                                                       # la bibliothèque est peuplée AVANT d'ouvrir l'interface
            with open(f, "rb") as fh:
                urllib.request.urlopen(urllib.request.Request(f"{base}/api/library/import?name={os.path.basename(f)}", data=fh.read(), method="POST"), timeout=30).read()
        for _ in range(150):
            lib = json.loads(urllib.request.urlopen(base + "/api/library", timeout=5).read())
            if all(a["state"] == "ready" for a in lib["assets"]):
                break
            time.sleep(0.2)
        cls.base = base
        cls.edge = subprocess.Popen([EDGE, "--headless=new", f"--remote-debugging-port={CDP_PORT}", "--remote-allow-origins=*", "--no-first-run", "--disable-gpu", "--hide-scrollbars",
                                     f"--user-data-dir={os.path.join(cls.tmp, 'edge')}", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=nw)
        url = None
        for _ in range(100):
            try:
                tabs = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/list", timeout=1).read())
                url = next(t["webSocketDebuggerUrl"] for t in tabs if t["type"] == "page")
                break
            except (OSError, StopIteration):
                time.sleep(0.2)
        cls.c = CDP(url)
        cls.c.call("Page.enable")
        cls.c.call("Emulation.setDeviceMetricsOverride", width=390, height=800, deviceScaleFactor=2, mobile=True)
        cls.c.call("Emulation.setTouchEmulationEnabled", enabled=True, maxTouchPoints=5)

    @classmethod
    def tearDownClass(cls):
        for p in (getattr(cls, "edge", None), getattr(cls, "srv", None)):
            if p:
                p.terminate()
        for p in (getattr(cls, "edge", None), getattr(cls, "srv", None)):
            if p:
                try:
                    p.wait(10)
                except subprocess.TimeoutExpired:
                    p.kill()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def release_touches(self):
        for kind in ("touchEnd", "touchCancel"):
            try:
                self.c.touch(kind, [])
            except RuntimeError:
                pass

    def setUp(self):
        self.release_touches()

    def tearDown(self):
        self.release_touches()                                                                    # un test en échec ne doit jamais laisser un doigt « posé » pour les suivants

    def goto(self, path, ready):
        self.c.call("Page.navigate", url=self.base + path)
        for _ in range(100):
            try:
                if self.c.ev(ready):
                    return
            except RuntimeError:
                pass
            time.sleep(0.1)
        self.fail("page non prête : " + path)

    # ------------------------------------------------------------------ noyau
    def test_1_core(self):
        self.goto("/dev/nle_test.html", "window.__ready === true")
        results = self.c.ev("window.runCoreTests()")
        bad = [r for r in results if not r[1]]
        self.assertGreater(len(results), 40)
        self.assertEqual(bad, [], "tests du noyau en échec")

    # ------------------------------------------------------------------ application
    def setup_app(self):
        self.c.call("Page.navigate", url=self.base + "/nle.html")
        for _ in range(100):
            try:
                if self.c.ev("!!(window.nle && nle.lib && nle.lib.assets.length >= 3)"):
                    break
            except RuntimeError:
                pass
            time.sleep(0.15)
        else:
            self.fail("application non prête")
        self.c.ev("localStorage.clear(); nle.tl.setProject(nle.core.createProject()); nle.tl.history = new nle.core.History(); nle.tl.view.scrollX = 0; nle.tl.view.pps = 24; nle.tl.setPlayhead(0, true); nle.tl.requestDraw(); true")
        self.rect = self.c.ev("(() => { const r = document.getElementById('tl').getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; })()")

    def px(self, t, track=None):
        """Coordonnées écran du temps `t` (et du centre de la piste d'index `track`)."""
        v = self.c.ev("({pps: nle.tl.view.pps, sx: nle.tl.view.scrollX, sy: nle.tl.view.scrollY})")
        x = self.rect["x"] + 56 + t * v["pps"] - v["sx"]
        y = None if track is None else self.rect["y"] + 34 + track * 72 + 36 - v["sy"]
        return x, y

    def asset(self, kind):
        return self.c.ev(f"nle.lib.assets.find(a => a.kind === '{kind}').id")

    def add(self, kind, start=0, track=None):
        a = self.asset(kind)
        return self.c.ev(f"(() => {{ const c = nle.tl.addAsset(nle.lib.get('{a}'), {start}, {json.dumps(track)}); return c && c.id; }})()")

    def clip(self, cid):
        return self.c.ev(f"nle.tl.project.clips.find(c => c.id === '{cid}')")

    def test_2_library_and_tap_to_add(self):
        self.setup_app()
        self.c.ev("nle.lib.open(); true")
        time.sleep(0.6)
        st = self.c.ev("({n: nle.lib.assets.length, kinds: nle.lib.assets.map(a => a.kind).sort(), thumbs: [...document.querySelectorAll('.lib-card img')].filter(i => i.complete && i.naturalWidth > 0).length, busy: nle.lib.assets.filter(a => a.state !== 'ready').length})")
        self.assertEqual((st["n"], st["kinds"], st["busy"]), (3, ["audio", "image", "video"], 0))
        self.assertEqual(st["thumbs"], 2)                                                         # vidéo + image : vignettes ; l'audio n'en a pas
        for card in self.c.ev("[...document.querySelectorAll('.lib-card')].map(c => { const r = c.getBoundingClientRect(); return [c.dataset.id, r.width, r.height]; })"):
            self.assertGreaterEqual(card[1], 44)
            self.assertGreaterEqual(card[2], 44)
        self.c.shot("phone_library.png")
        r = self.c.ev("(() => { const c = [...document.querySelectorAll('.lib-card')].find(c => nle.lib.get(c.dataset.id).kind === 'video'); const b = c.querySelector('.lib-thumb').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()")
        self.c.touch("touchStart", [tuple(r)]); self.c.touch("touchEnd", [])                       # simple toucher : ajout à la tête de lecture
        time.sleep(0.2)
        clips = self.c.ev("nle.tl.project.clips")
        self.assertEqual((len(clips), clips[0]["kind"], clips[0]["track"], clips[0]["start"]), (1, "video", "V1", 0))
        self.assertAlmostEqual(clips[0]["dur"], 3, delta=0.3)

    def test_3_waveform_loaded(self):
        self.setup_app()
        self.add("audio")
        time.sleep(0.8)
        self.assertTrue(self.c.ev("nle.tl.peaks.size > 0 && [...nle.tl.peaks.values()].some(p => Array.isArray(p) && p.length > 100)"))

    def test_4_tap_moves_playhead_and_selects(self):
        self.setup_app()
        cid = self.add("image", 2, "V1")
        x, y = self.px(2.5, 1)
        self.c.touch("touchStart", [(x, y)]); self.c.touch("touchEnd", [])
        time.sleep(0.15)
        self.assertEqual(self.c.ev("nle.tl.selected"), cid)
        x, y = self.px(12, 2)                                                                    # zone vide d'une piste
        self.c.touch("touchStart", [(x, y)]); self.c.touch("touchEnd", [])
        time.sleep(0.15)
        self.assertIsNone(self.c.ev("nle.tl.selected"))
        self.assertAlmostEqual(self.c.ev("nle.tl.playhead"), 12, delta=0.05)
        x, _ = self.px(4)                                                                         # glisser sur la règle = scrub
        ry = self.rect["y"] + 15
        self.c.touch("touchStart", [(x, ry)])
        for k in range(1, 6):
            self.c.touch("touchMove", [(x + 25 * k, ry)])
        self.c.touch("touchEnd", [])
        self.assertAlmostEqual(self.c.ev("nle.tl.playhead"), 4 + 125 / self.c.ev("nle.tl.view.pps"), delta=0.05)

    def test_5_pinch_zoom_and_two_finger_pan(self):
        self.setup_app()
        self.add("audio", 0, "A1")
        v0 = self.c.ev("({...nle.tl.view})")
        mx, my = self.rect["x"] + 200, self.rect["y"] + 200
        t_under = self.c.ev(f"nle.tl.tOf({mx - self.rect['x']})")
        self.c.touch("touchStart", [(mx - 30, my)])
        self.c.touch("touchStart", [(mx - 30, my), (mx + 30, my)])
        for k in range(1, 9):                                                                    # écartement progressif des doigts : zoom
            self.c.touch("touchMove", [(mx - 30 - 12 * k, my), (mx + 30 + 12 * k, my)])
        self.c.touch("touchEnd", [(mx + 30 + 96, my)])
        self.c.touch("touchEnd", [])
        v1 = self.c.ev("({...nle.tl.view})")
        self.assertGreater(v1["pps"], v0["pps"] * 2.5)
        self.assertAlmostEqual(self.c.ev(f"nle.tl.tOf({mx - self.rect['x']})"), t_under, delta=0.1)   # le temps sous les doigts reste sous les doigts
        self.assertEqual(self.c.ev("nle.tl.op"), None)
        sx = v1["scrollX"]
        self.c.touch("touchStart", [(mx - 30, my)])
        self.c.touch("touchStart", [(mx - 30, my), (mx + 30, my)])
        for k in range(1, 7):                                                                    # glissement à deux doigts vers la gauche : la timeline avance
            self.c.touch("touchMove", [(mx - 30 - 20 * k, my), (mx + 30 - 20 * k, my)])
        self.c.touch("touchEnd", [(mx + 30 - 120, my)]); self.c.touch("touchEnd", [])
        self.assertAlmostEqual(self.c.ev("nle.tl.view.scrollX") - sx, 120, delta=8)
        self.assertEqual(self.c.ev("nle.tl.project.clips.length"), 1)                             # aucun clip touché par les gestes

    def test_6_long_press_lifts_and_moves_across_tracks(self):
        self.setup_app()
        cid = self.add("image", 1, "V1")                                                          # piste d'index 1
        self.c.ev("nle.tl.select(null)")
        x, y = self.px(2.5, 1)
        self.c.touch("touchStart", [(x, y)])
        time.sleep(0.15)
        self.assertEqual(self.c.ev("nle.tl.op.type"), "press")                                    # anneau de progression en cours
        time.sleep(0.45)
        self.assertEqual(self.c.ev("nle.tl.op.type"), "drag")                                     # soulevé
        tx, ty = self.px(8, 0)
        for k in range(1, 9):
            self.c.touch("touchMove", [(x + (tx - x) * k / 8, y + (ty - y) * k / 8)])
        self.c.touch("touchEnd", [])
        c = self.clip(cid)
        self.assertEqual(c["track"], "V2")
        self.assertAlmostEqual(c["start"], 8 - 1.5, delta=0.2)                                   # saisi à 1,5 s du début : la prise est conservée
        self.assertEqual(self.c.ev("nle.tl.history.canUndo"), True)
        self.c.ev("nle.tl.undo()")
        self.assertEqual((self.clip(cid)["track"], self.clip(cid)["start"]), ("V1", 1))

    def test_7_clip_cannot_land_on_incompatible_or_occupied(self):
        self.setup_app()
        cid = self.add("image", 0, "V1")
        other = self.add("video", 6, "V1")
        self.c.ev("nle.tl.select(null)")
        x, y = self.px(2.5, 1)
        self.c.touch("touchStart", [(x, y)])
        time.sleep(0.6)
        tx, ty = self.px(7, 2)                                                                    # piste AUDIO : refusée, le clip reste en vidéo
        for k in range(1, 7):
            self.c.touch("touchMove", [(x + (tx - x) * k / 6, y + (ty - y) * k / 6)])
        self.c.touch("touchEnd", [])
        a, b = self.clip(cid), self.clip(other)
        self.assertEqual(a["track"], "V1")
        self.assertTrue(a["start"] + a["dur"] <= b["start"] + 1e-6 or a["start"] >= b["start"] + b["dur"] - 1e-6, (a, b))   # posé sur l'autre clip -> poussé vers la place libre la plus proche, jamais de chevauchement

    def test_8_early_move_cancels_long_press(self):
        self.setup_app()
        cid = self.add("image", 1, "V1")
        self.c.ev("nle.tl.select(null)")
        x, y = self.px(2.5, 1)
        self.c.touch("touchStart", [(x, y)])
        for k in range(1, 5):
            self.c.touch("touchMove", [(x + 15 * k, y)])
        time.sleep(0.6)
        self.assertEqual(self.c.ev("nle.tl.op.type"), "scrub")
        self.c.touch("touchEnd", [])
        self.assertEqual(self.clip(cid)["start"], 1)

    def test_9_resize_handles_and_image_stretch(self):
        self.setup_app()
        self.c.ev("nle.tl.zoomTo(8, 0); nle.tl.view.scrollX = 0; true")                         # 40 s tiennent dans l'écran du téléphone
        img = self.add("image", 0, "V1")
        self.c.ev(f"nle.tl.select(nle.tl.project.clips[0])")
        x, y = self.px(5, 1)
        sx = x - 8                                                                                # poignée droite (zone tactile de 24 px)
        far, _ = self.px(40)
        self.c.touch("touchStart", [(sx, y)])
        for k in range(1, 9):
            self.c.touch("touchMove", [(sx + (far - sx) * k / 8, y)])
        self.c.touch("touchEnd", [])
        self.assertAlmostEqual(self.clip(img)["dur"], 40, delta=2.5)                              # une image s'étire bien au-delà de sa durée par défaut
        self.c.ev("nle.tl.setSnapping(false); nle.tl.zoomTo(30, 0); nle.tl.view.scrollX = 0; true")
        vid = self.add("video", 5, "V2")
        v0 = self.clip(vid)["dur"]
        self.c.ev(f"nle.tl.select(nle.tl.project.clips.find(c => c.id === '{vid}'))")
        x, y = self.px(5 + v0, 0)
        far, _ = self.px(10)
        self.c.touch("touchStart", [(x - 8, y)])
        for k in range(1, 7):
            self.c.touch("touchMove", [(x - 8 + (far - x) * k / 6, y)])
        self.c.touch("touchEnd", [])
        self.assertAlmostEqual(self.clip(vid)["dur"], v0, delta=0.05)                             # une vidéo ne s'étire pas au-delà du média
        x, y = self.px(5, 0)
        self.c.touch("touchStart", [(x + 8, y)])                                                  # rogner à gauche
        for k in range(1, 5):
            self.c.touch("touchMove", [(x + 8 + 30 * k, y)])
        self.c.touch("touchEnd", [])
        c = self.clip(vid)
        self.assertGreater(c["in"], 0.2)
        self.assertAlmostEqual(c["start"] + c["dur"], 5 + v0, delta=0.01)                       # la fin ne bouge pas

    def test_10_snapping_glues_to_neighbour_and_playhead(self):
        self.setup_app()
        a = self.add("image", 0, "V1")                                                            # 0 -> 5
        b = self.add("image", 12, "V1")
        self.c.ev("nle.tl.select(null); nle.tl.setSnapping(true); nle.tl.zoomTo(16, 0); nle.tl.view.scrollX = 0; true")      # loin du bord : pas de défilement automatique pendant le glisser
        x, y = self.px(13, 1)
        self.c.touch("touchStart", [(x, y)])
        time.sleep(0.6)
        pps = self.c.ev("nle.tl.view.pps")
        tx = x - (12 - 5.04) * pps                                                                # le clip b (début 12) est amené à 40 ms du bord du premier clip (fin 5)
        for k in range(1, 9):
            self.c.touch("touchMove", [(x + (tx - x) * k / 8, y)])
        time.sleep(0.15)                                                                          # Chrome regroupe les mouvements par image : on laisse le dernier arriver
        self.assertEqual(self.c.ev("nle.tl.guide"), 5)                                            # trait guide jaune affiché
        self.c.touch("touchEnd", [])
        self.assertAlmostEqual(self.clip(b)["start"], 5, delta=1e-6)                              # collé exactement
        self.assertIsNotNone(a)

    def test_11_library_drag_to_timeline(self):
        self.setup_app()
        self.c.ev("nle.lib.open(); true")
        time.sleep(0.5)
        r = self.c.ev("(() => { const c = [...document.querySelectorAll('.lib-card')].find(c => nle.lib.get(c.dataset.id).kind === 'audio'); const b = c.querySelector('.lib-thumb').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()")
        self.c.touch("touchStart", [tuple(r)])
        time.sleep(0.5)
        self.assertTrue(self.c.ev("document.querySelector('.lib-ghost') !== null"))               # appui long : fantôme
        tx, ty = self.px(3, 0)                                                                    # piste vidéo V2 : l'audio doit finir sur une piste AUDIO
        for k in range(1, 8):
            self.c.touch("touchMove", [(r[0] + (tx - r[0]) * k / 7, r[1] + (ty - r[1]) * k / 7)])
        self.assertTrue(self.c.ev("document.getElementById('lib').classList.contains('dragging')"))
        self.assertIsNotNone(self.c.ev("nle.tl.preview"))
        self.c.touch("touchEnd", [])
        time.sleep(0.3)
        clips = self.c.ev("nle.tl.project.clips")
        self.assertEqual((len(clips), clips[0]["kind"], clips[0]["track"]), (1, "audio", "A1"))
        self.assertIsNone(self.c.ev("document.querySelector('.lib-ghost')"))
        self.assertEqual(self.c.ev("nle.lib.assets.find(a => a.kind === 'audio').uses"), 0)        # compteur d'usage mis à jour côté serveur au prochain rafraîchissement
        time.sleep(0.2)
        self.c.ev("nle.lib.refresh()", wait=True)
        self.assertEqual(self.c.ev("nle.lib.assets.find(a => a.kind === 'audio').uses"), 1)

    def test_12_performance_ten_tracks(self):
        self.setup_app()
        self.c.ev("""(() => {
          const p = nle.core.createProject(); p.tracks = [];
          for (let i = 0; i < 5; i++) nle.core.addTrack(p, 'video'); for (let i = 0; i < 5; i++) nle.core.addTrack(p, 'audio');
          const a = nle.lib.assets;
          for (const t of p.tracks) for (let k = 0; k < 60; k++) { const kind = t.type === 'audio' ? 'audio' : (k % 2 ? 'image' : 'video'); const as = a.find(x => x.kind === kind);
            const c = nle.core.makeClip(as, t.id, k * 6); c.dur = 5; p.clips.push(c); }
          nle.tl.setProject(p); nle.tl.view.pps = 40; nle.tl.view.scrollX = 0; nle.tl.view.scrollY = 0; return p.clips.length; })()""")
        time.sleep(1.0)                                                                           # vignettes et ondes chargées : on mesure le régime établi
        res = self.c.ev("""(() => { const tl = nle.tl, ms = [];
          for (let i = 0; i < 240; i++) { tl.view.scrollX = i * 9; tl.view.pps = 40 + (i % 60); tl.clampView(); const t0 = performance.now(); tl.draw(); ms.push(performance.now() - t0); }
          ms.sort((a, b) => a - b); return { n: tl.project.clips.length, tracks: tl.project.tracks.length, avg: ms.reduce((a, b) => a + b, 0) / ms.length, p95: ms[Math.floor(ms.length * .95)], max: ms[ms.length - 1] }; })()""")
        print(f"\n[perf] {res['n']} clips / {res['tracks']} pistes : moyenne {res['avg']:.2f} ms, p95 {res['p95']:.2f} ms, max {res['max']:.2f} ms par image (budget 60 FPS = 16,7 ms)")
        self.assertEqual(res["tracks"], 10)
        self.assertLess(res["p95"], 16.0)
        self.c.ev("nle.tl.zoomFit(); true")
        time.sleep(0.2)
        self.c.shot("phone_ten_tracks.png")

    def test_13_screens(self):
        self.setup_app()
        self.add("video", 0, "V1"); self.add("image", 4, "V2"); self.add("audio", 0, "A1")
        self.c.ev("nle.tl.setPlayhead(3.2); nle.tl.select(nle.tl.project.clips[0]); true")
        time.sleep(0.8)
        self.c.shot("phone_timeline.png")
        self.c.call("Emulation.setDeviceMetricsOverride", width=1280, height=720, deviceScaleFactor=1, mobile=False)
        self.c.ev("nle.lib.open(); nle.tl.resize(); true")
        time.sleep(0.8)
        self.c.shot("desktop.png")
        self.c.call("Emulation.setDeviceMetricsOverride", width=390, height=800, deviceScaleFactor=2, mobile=True)

    # ================================================================== étape 2 : inspecteur, coupe, transitions, export
    def centre(self, sel):
        return tuple(self.c.ev(f"(() => {{ const b = document.querySelector({json.dumps(sel)}).getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }})()"))

    def tap(self, sel):
        self.c.touch("touchStart", [self.centre(sel)]); self.c.touch("touchEnd", [])
        time.sleep(0.15)

    def drag_slider(self, sel, v_from, v_to):
        """Glisse le curseur d'un <input type=range> avec un vrai doigt, de la valeur v_from à v_to."""
        r = self.c.ev(f"(() => {{ const i = document.querySelector({json.dumps(sel)}), b = i.getBoundingClientRect(); return {{l: b.left, w: b.width, y: b.top + b.height / 2, min: +i.min, max: +i.max}}; }})()")
        at = lambda v: r["l"] + 15 + (v - r["min"]) / (r["max"] - r["min"]) * (r["w"] - 30)       # noqa: E731  (la pastille de 30 px reste dans la piste)
        self.c.touch("touchStart", [(at(v_from), r["y"])])
        for k in range(1, 9):
            self.c.touch("touchMove", [(at(v_from + (v_to - v_from) * k / 8), r["y"])])
        time.sleep(0.12)                                                                          # le doigt s'arrête avant de se lever : pas d'élan (fling) qui avalerait le toucher suivant
        self.c.touch("touchEnd", [])
        time.sleep(0.35)

    def undo_len(self):
        return self.c.ev("nle.tl.history.undo.length")

    def test_14_inspector_touch_sliders(self):
        self.setup_app()
        cid = self.add("video", 0, "V1")
        self.tap("#b-insp")
        self.assertTrue(self.c.ev("nle.insp.isOpen"))
        rows = lambda: self.c.ev("[...document.querySelectorAll('.insp-row')].filter(r => !r.hidden).map(r => r.dataset.prop)")      # noqa: E731
        self.assertEqual(rows(), ["opacity", "scale", "x", "y"])
        box = self.c.ev("(() => { const i = document.getElementById('insp').getBoundingClientRect(), b = document.querySelector('.insp-body'); return {bottom: i.bottom, h: i.height, scroll: b.scrollHeight - b.clientHeight}; })()")
        self.assertLessEqual(box["scroll"], 1, "chaque onglet tient sans défilement sur un téléphone")
        self.assertLessEqual(box["bottom"], 800)
        for r in self.c.ev("[...document.querySelectorAll('.insp-row input, .insp-kf, .insp-tab, .insp-top .nle-btn')].filter(e => e.offsetParent).map(e => { const b = e.getBoundingClientRect(); return [e.className || e.type, b.width, b.height]; })"):
            self.assertGreaterEqual(r[2], 44, r)                                                  # zones tactiles ≥ 44 px
        self.c.shot("phone_inspector.png")
        n0 = self.undo_len()
        self.drag_slider(".insp-row[data-prop=opacity] input", 100, 25)
        self.assertAlmostEqual(self.clip(cid)["opacity"], 0.25, delta=0.12)
        self.assertEqual(self.undo_len(), n0 + 1, "un geste complet = une seule entrée d'annulation")
        self.assertIn("%", self.c.ev("document.querySelector('.insp-row[data-prop=opacity] output').textContent"))
        self.tap(".insp-tab[data-tab=son]")
        self.assertEqual(rows(), ["volume"])
        self.drag_slider(".insp-row[data-prop=volume] input", 100, 150)
        self.assertGreater(self.clip(cid)["volume"], 1.2)
        self.tap(".insp-tab[data-tab=fondus]")
        self.assertEqual(rows(), ["fadeIn", "fadeOut"])
        self.drag_slider(".insp-row[data-prop=fadeIn] input", 0, 1.5)
        self.assertGreater(self.clip(cid)["fadeIn"], 0.8)
        self.c.ev("nle.tl.undo(); nle.tl.undo(); nle.tl.undo(); true")
        c = self.clip(cid)
        self.assertEqual((c["opacity"], c["volume"], c["fadeIn"]), (1, 1, 0))
        self.tap(".insp-tab[data-tab=image]")
        self.assertEqual(self.c.ev("document.querySelector('.insp-row[data-prop=opacity] input').value"), "100")      # l'inspecteur suit l'annulation
        self.tap(".insp-top .nle-btn:last-child")                                                  # fermer
        self.assertFalse(self.c.ev("nle.insp.isOpen"))

    def test_15_inspector_depends_on_clip_kind(self):
        self.setup_app()
        self.tap("#b-insp")
        self.assertTrue(self.c.ev("!document.querySelector('.insp-hint').hidden"), "aucun clip : message d'aide")
        tabs = lambda: self.c.ev("[...document.querySelectorAll('.insp-tab')].filter(t => !t.hidden).map(t => t.dataset.tab)")      # noqa: E731
        self.add("audio", 0, "A1")
        self.assertEqual(tabs(), ["son", "fondus"])
        self.assertEqual(self.c.ev("document.querySelector('.insp-tab.on').dataset.tab"), "son", "clip audio : l'onglet IMAGE disparaît, SON s'ouvre")
        self.add("image", 0, "V1")
        self.assertEqual(tabs(), ["image", "fondus"])
        self.assertEqual(self.c.ev("document.querySelector('.insp-tab.on').dataset.tab"), "image")
        self.add("video", 10, "V1")
        self.assertEqual(tabs(), ["image", "son", "fondus"])

    def test_16_keyframes_via_inspector(self):
        self.setup_app()
        cid = self.add("video", 0, "V1")
        self.tap("#b-insp")
        kf, clr, sl = ".insp-row[data-prop=scale] .insp-kf", ".insp-row[data-prop=scale] .insp-clr", ".insp-row[data-prop=scale] input"
        self.c.ev("nle.tl.setPlayhead(0.5); true")
        self.assertTrue(self.c.ev(f"document.querySelector('{clr}').hidden"))
        self.tap(kf)
        c = self.clip(cid)
        self.assertEqual((len(c["kf"]["scale"]), c["kf"]["scale"][0]["v"]), (1, 1))
        self.assertAlmostEqual(c["kf"]["scale"][0]["t"], 0.5, delta=0.01)
        self.assertTrue(self.c.ev(f"document.querySelector('{kf}').classList.contains('on')"))
        self.assertFalse(self.c.ev(f"document.querySelector('{clr}').hidden"))
        self.c.ev("nle.tl.setPlayhead(2.0); true")
        self.assertFalse(self.c.ev(f"document.querySelector('{kf}').classList.contains('on')"))
        n0 = self.undo_len()
        self.drag_slider(sl, 100, 200)
        c = self.clip(cid)
        self.assertEqual(len(c["kf"]["scale"]), 2, "animé : le curseur pose une image-clé à la tête de lecture")
        self.assertAlmostEqual(c["kf"]["scale"][1]["t"], 2.0, delta=0.01)
        self.assertGreater(c["kf"]["scale"][1]["v"], 1.6)
        self.assertEqual(c["scale"], 1, "la valeur fixe n'est pas touchée")
        self.assertEqual(self.undo_len(), n0 + 1)
        mid = self.c.ev("(() => { const c = nle.tl.project.clips[0]; return nle.core.valueAt(c, 'scale', 1.25); })()")
        self.assertTrue(1.2 < mid < 1.8, mid)                                                      # interpolation entre les deux images-clés
        self.c.ev("nle.tl.zoomTo(60, 0); nle.tl.view.scrollX = 0; nle.tl.select(nle.tl.project.clips[0]); true")
        time.sleep(0.2)
        self.c.shot("phone_keyframes.png")
        self.c.ev("nle.tl.setPlayhead(9); true")
        self.assertTrue(self.c.ev(f"document.querySelector('{kf}').disabled && document.querySelector('{sl}').disabled"), "tête de lecture hors du clip : ◆ et curseur désactivés")
        self.c.ev("nle.tl.setPlayhead(2.0); true")
        self.tap(kf)                                                                                # ◆ plein : retire l'image-clé
        self.assertEqual(len(self.clip(cid)["kf"]["scale"]), 1)
        self.tap(clr)                                                                               # ⊘ : supprime l'animation
        c = self.clip(cid)
        self.assertNotIn("kf", c)
        self.assertEqual(c["scale"], 1)
        self.assertTrue(self.c.ev(f"document.querySelector('{clr}').hidden"))
        for _ in range(4):
            self.c.ev("nle.tl.undo(); true")
        self.assertNotIn("kf", self.clip(cid))

    def test_17_split_at_playhead(self):
        self.setup_app()
        cid = self.add("image", 0, "V1")
        self.assertTrue(self.c.ev("document.getElementById('b-split').disabled"), "tête de lecture au bord du clip : coupe impossible")
        self.c.ev("nle.tl.setPlayhead(2); true")
        self.assertFalse(self.c.ev("document.getElementById('b-split').disabled"))
        n0 = self.undo_len()
        self.tap("#b-split")
        clips = sorted(self.c.ev("nle.tl.project.clips"), key=lambda c: c["start"])
        self.assertEqual(len(clips), 2)
        self.assertAlmostEqual(clips[0]["dur"], 2, delta=1e-6)
        self.assertAlmostEqual(clips[1]["start"], 2, delta=1e-6)
        self.assertAlmostEqual(clips[1]["dur"], 3, delta=1e-6)
        self.assertEqual(self.undo_len(), n0 + 1)
        self.assertEqual(self.c.ev("nle.tl.selected"), cid)
        self.assertEqual(self.c.ev("nle.core.junctions(nle.tl.project).length"), 1, "les deux morceaux forment une jonction")
        self.c.ev("nle.tl.undo(); true")
        self.assertEqual(len(self.c.ev("nle.tl.project.clips")), 1)
        self.assertAlmostEqual(self.clip(cid)["dur"], 5, delta=1e-6)

    def test_18_transition_wheel(self):
        self.setup_app()
        self.add("image", 0, "V1")
        b = self.add("image", 5, "V1")
        self.c.ev("nle.tl.select(null); true")
        x, yc = self.px(5, 1)
        y = yc - 36 + 18                                                                            # badge de jonction : bande haute de la piste
        self.c.touch("touchStart", [(x, y)]); self.c.touch("touchEnd", [])
        time.sleep(0.2)
        self.assertTrue(self.c.ev("!document.querySelector('.wheel-bg').hidden"), "toucher le badge ouvre la roue")
        self.assertIsNone(self.c.ev("nle.tl.selected"), "le badge ne sélectionne aucun clip")
        for r in self.c.ev("[...document.querySelectorAll('.wheel-b, .wheel-c')].map(e => { const b = e.getBoundingClientRect(); return [e.className, b.width, b.height, b.left, b.top, b.right, b.bottom]; })"):
            self.assertGreaterEqual(min(r[1], r[2]), 44, r)
            self.assertTrue(r[3] >= 0 and r[4] >= 0 and r[5] <= 390 and r[6] <= 800, ("dans l'écran", r))
        self.c.shot("phone_wheel.png")
        n0 = self.undo_len()
        self.tap(".wheel-b[data-type=crossfade]")
        self.assertEqual(self.clip(b)["trIn"], {"type": "crossfade", "dur": 0.5})
        self.assertEqual(self.undo_len(), n0 + 1)
        self.assertIn("0.5", self.c.ev("document.querySelector('.wheel-c').textContent"))
        self.tap(".wheel-c")
        self.assertEqual(self.clip(b)["trIn"]["dur"], 1)
        self.tap(".wheel-b[data-type=dip]")
        c = self.clip(b)
        self.assertEqual((c["fadeIn"], "trIn" in c), (1, False))
        self.assertEqual(self.c.ev("nle.tl.project.clips.find(c => c.start === 0).fadeOut"), 1)
        self.assertTrue(self.c.ev("document.querySelector('.wheel-b[data-type=dip]').classList.contains('on')"))
        self.tap(".wheel-b[data-type=cut]")
        self.assertTrue(self.c.ev("document.querySelector('.wheel-bg').hidden"), "« coupe » referme la roue")
        c = self.clip(b)
        self.assertEqual((c["fadeIn"], "trIn" in c), (0, False))
        # fermeture par le fond ; un glissé sur le badge n'ouvre rien
        self.c.touch("touchStart", [(x, y)]); self.c.touch("touchEnd", [])
        time.sleep(0.15)
        self.c.touch("touchStart", [(5, 5)]); self.c.touch("touchEnd", [])
        time.sleep(0.15)
        self.assertTrue(self.c.ev("document.querySelector('.wheel-bg').hidden"))
        self.c.touch("touchStart", [(x, y)])
        for k in range(1, 6):
            self.c.touch("touchMove", [(x + 12 * k, y)])
        self.c.touch("touchEnd", [])
        self.assertTrue(self.c.ev("document.querySelector('.wheel-bg').hidden"))

    def test_19_resize_keeps_keyframes_on_content(self):
        self.setup_app()
        self.c.ev("nle.tl.zoomTo(40, 0); nle.tl.view.scrollX = 0; nle.tl.setSnapping(false); true")
        cid = self.add("image", 0, "V1")                                                            # 0 -> 5
        self.c.ev("""(() => { const c = nle.tl.project.clips[0]; nle.core.setKeyframe(c, 'x', 0, 0); nle.core.setKeyframe(c, 'x', 4, 1); c.fadeIn = 1; nle.tl.select(c); return true; })()""")
        x, y = self.px(0, 1)
        end, _ = self.px(2)
        self.c.touch("touchStart", [(x + 8, y)])                                                    # poignée gauche : rogner 2 s
        for k in range(1, 7):
            self.c.touch("touchMove", [(x + 8 + (end - x - 8) * k / 6, y)])
        self.c.touch("touchEnd", [])
        c = self.clip(cid)
        self.assertAlmostEqual(c["start"], 2, delta=0.1)
        pts = c["kf"]["x"]
        self.assertAlmostEqual(pts[0]["t"], 0, delta=1e-6)
        self.assertAlmostEqual(pts[0]["v"], 0.5, delta=0.06)                                       # le contenu garde son animation : la valeur à l'entrée est celle de t=2 s
        self.assertAlmostEqual(pts[-1]["t"], c["dur"], delta=0.01)
        self.assertAlmostEqual(pts[-1]["v"], 1, delta=0.01)
        self.assertLessEqual(c["fadeIn"], c["dur"])
        n0 = self.undo_len()
        self.c.touch("touchStart", [(x + 2 * 40 + 8, y)]); self.c.touch("touchEnd", [])            # simple toucher sur une poignée : aucune entrée d'annulation parasite
        self.assertEqual(self.undo_len(), n0)

    def test_20_performance_with_transitions(self):
        self.setup_app()
        self.c.ev("""(() => {
          const p = nle.core.createProject(); p.tracks = [];
          for (let i = 0; i < 5; i++) nle.core.addTrack(p, 'video'); for (let i = 0; i < 5; i++) nle.core.addTrack(p, 'audio');
          const a = nle.lib.assets;
          for (const t of p.tracks) for (let k = 0; k < 60; k++) { const kind = t.type === 'audio' ? 'audio' : (k % 2 ? 'image' : 'video'); const as = a.find(x => x.kind === kind);
            const c = nle.core.makeClip(as, t.id, k * 5); c.dur = 5; if (k % 3 === 0) c.fadeIn = 1; if (k % 4 === 0) c.trIn = { type: 'crossfade', dur: 1 }; if (k % 5 === 0) nle.core.setKeyframe(c, 'scale', 1, 1.2); p.clips.push(c); }
          nle.tl.setProject(p); nle.tl.view.pps = 40; nle.tl.view.scrollX = 0; nle.tl.view.scrollY = 0; nle.tl.select(p.clips[3]); return p.clips.length; })()""")
        self.assertEqual(self.c.ev("nle.core.junctions(nle.tl.project).length"), 590)               # 600 clips tous collés : 590 badges de jonction
        time.sleep(1.0)
        res = self.c.ev("""(() => { const tl = nle.tl, ms = [];
          for (let i = 0; i < 240; i++) { tl.view.scrollX = i * 9; tl.view.pps = 40 + (i % 60); tl.clampView(); const t0 = performance.now(); tl.draw(); ms.push(performance.now() - t0); }
          ms.sort((a, b) => a - b); return { avg: ms.reduce((a, b) => a + b, 0) / ms.length, p95: ms[Math.floor(ms.length * .95)], max: ms[ms.length - 1] }; })()""")
        print(f"\n[perf+transitions] 600 clips / 590 jonctions : moyenne {res['avg']:.2f} ms, p95 {res['p95']:.2f} ms, max {res['max']:.2f} ms par image")
        self.assertLess(res["p95"], 16.0)

    # -- export de bout en bout : EDL du navigateur -> moteur FFmpeg -> barre de progression -> MP4
    def wait_export(self, expr, timeout=120):
        end = time.time() + timeout
        samples = []
        while time.time() < end:
            s = self.c.ev("({st: nle.exp.job && nle.exp.job.status, p: nle.exp.job && nle.exp.job.progress, w: parseFloat(document.querySelector('.exp-bar i').style.width) || 0})")
            samples.append(s)
            if s["st"] and eval(expr, {"s": s}):
                return samples
            time.sleep(0.04)
        self.fail(f"export : état attendu non atteint ({samples[-1] if samples else None})")

    def test_21_export_flow_with_progress_and_download(self):
        self.setup_app()
        self.add("video", 0, "V1")
        self.add("audio", 0, "A1")
        self.c.ev("""(() => { const tl = nle.tl, c = tl.project.clips.find(c => c.kind === 'video'); c.fadeIn = 0.5; nle.core.setKeyframe(c, 'opacity', 0, 0.3); nle.core.setKeyframe(c, 'opacity', 3, 1);
          const img = nle.lib.assets.find(a => a.kind === 'image'); const k = nle.core.makeClip(img, 'V2', 0); k.dur = 3; k.scale = 0.3; k.x = 0.3; tl.project.clips.push(k); tl.requestDraw(); return true; })()""")
        self.tap("#b-exp")
        self.assertTrue(self.c.ev("nle.exp.isOpen"))
        self.assertIn("3", self.c.ev("document.querySelector('.exp-info').textContent"))
        self.tap(".exp .lib-chip[data-preset='540p']")
        self.assertTrue(self.c.ev("document.querySelector('.exp .lib-chip[data-preset=\"540p\"]').classList.contains('on')"))
        self.c.shot("phone_export_idle.png")
        self.tap(".exp-actions .pri")
        samples = self.wait_export("s['st'] in ('done', 'error')")
        self.assertEqual(samples[-1]["st"], "done", self.c.ev("nle.exp.job"))
        ps = [x["p"] for x in samples if x["p"] is not None]
        self.assertEqual(ps, sorted(ps), "la barre ne recule jamais")
        self.assertEqual(ps[-1], 1.0)
        time.sleep(0.4)
        st = self.c.ev("({txt: document.querySelector('.exp-stat').textContent, now: document.querySelector('.exp-bar').getAttribute('aria-valuenow'), href: document.querySelector('.exp-actions a').getAttribute('href'), hidden: document.querySelector('.exp-actions a').hidden, w: document.querySelector('.exp-bar i').style.width})")
        self.assertEqual((st["now"], st["hidden"], st["w"]), ("100", False, "100%"))
        self.assertIn("Terminé", st["txt"])
        self.c.shot("phone_export_done.png")
        data = urllib.request.urlopen(self.base + st["href"], timeout=30).read()
        self.assertEqual(data[4:8], b"ftyp")
        out = os.path.join(self.tmp, "dl.mp4")
        with open(out, "wb") as fh:
            fh.write(data)
        info = FF.probe(out)
        self.assertAlmostEqual(info["duration"], 6.0, delta=0.25)                                    # la musique (6 s) fixe la durée du projet
        self.assertEqual((info["width"], info["height"]), (960, 540))
        self.assertTrue(info["has_audio"])

    def test_22_export_cancel_and_errors(self):
        self.setup_app()
        self.tap("#b-exp")
        self.assertTrue(self.c.ev("document.querySelector('.exp-actions .pri').disabled"), "timeline vide : export désactivé")
        self.add("image", 0, "V1")
        self.c.ev("""(() => { const c = nle.tl.project.clips[0]; c.dur = 500; nle.core.setKeyframe(c, 'opacity', 0, 0); nle.core.setKeyframe(c, 'opacity', 500, 1); nle.exp._paint(); return true; })()""")
        self.tap(".exp .lib-chip[data-preset='1080p']")
        self.tap(".exp-actions .pri")
        self.wait_export("s['st'] == 'running'", 30)
        self.assertFalse(self.c.ev("document.querySelector('.exp-actions .danger').hidden"))
        self.c.shot("phone_export_running.png")
        self.tap(".exp-actions .danger")
        self.wait_export("s['st'] == 'cancelled'", 30)
        time.sleep(0.4)
        self.assertIn("annulé", self.c.ev("document.querySelector('.exp-stat').textContent"))
        self.assertTrue(self.c.ev("document.querySelector('.exp-actions a').hidden"))
        self.assertIn("RELANCER", self.c.ev("document.querySelector('.exp-actions .pri').textContent"))
        # média supprimé de la bibliothèque entre-temps : message clair, pas de plantage
        self.c.ev("""(() => { const c = nle.tl.project.clips[0]; c.dur = 2; delete c.kf; c.asset = 'zz00000000'; nle.exp._paint(); return true; })()""")
        self.tap(".exp-actions .pri")
        time.sleep(0.6)
        self.assertIn("introuvable", self.c.ev("document.querySelector('.exp-msg').textContent"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
