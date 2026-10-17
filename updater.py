"""Fenêtre de MISE À JOUR d'E.N.O.S. : reconstruit ENOS.exe (build.bat auto) en montrant la progression, puis le relance.

Lancé par le serveur (bouton MISE À JOUR) avec pythonw : E.N.O.S. se ferme, cette fenêtre prend le relais.
    pyw updater.py [--hue 356] [--demo]      (--demo : simule la compilation, sans rien reconstruire)
Si pywebview est indisponible, on retombe sur mise_a_jour.bat (console classique).
"""
import base64
import math
import os
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
EXE = os.path.join(HERE, "ENOS.exe")
LOG = os.path.join(HERE, "mise_a_jour.log")
DETACHED = 0x00000008 | 0x00000200            # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
NO_WINDOW = 0x08000000

# jalons de la sortie PyInstaller : (motif, étape, plancher %, plafond %, constante de temps en s). La jauge monte en douceur du plancher
# vers le plafond tant que le jalon suivant n'est pas atteint, puis saute au plancher suivant : jamais de recul.
MILESTONES = [
    ("Running Analysis", 1, 8, 48, 80),
    ("Building PYZ", 2, 50, 58, 15),
    ("Building PKG", 2, 58, 72, 40),
    ("Building EXE", 3, 72, 93, 35),
]


class Updater:
    def __init__(self, demo=False):
        self._demo = demo
        self._lock = threading.Lock()
        self._t0 = time.time()
        self._step, self._floor, self._cap, self._tau, self._t_ms = 0, 2.0, 7.0, 3.0, time.time()
        self._pct, self._stage = 0.0, "Initialisation…"
        self._lines, self._done, self._ok, self._error, self._n = [], False, False, "", 0
        self._tail = []
        self._window = None

    # ---- appelé par l'interface
    def poll(self):
        with self._lock:
            if not self._done:
                age = time.time() - self._t_ms
                p = self._floor + (self._cap - self._floor) * (1 - math.exp(-age / max(self._tau, 0.1)))
                self._pct = max(self._pct, min(p, 99.0))
            return {"pct": 100.0 if self._ok else round(self._pct, 1), "step": self._step, "stage": self._stage, "lines": self._lines[-6:],
                    "done": self._done, "ok": self._ok, "error": self._error, "elapsed": int(time.time() - self._t0)}

    def launch(self):
        """OK : relance E.N.O.S. et ferme cette fenêtre."""
        try:
            if os.path.isfile(EXE):
                env = {k: v for k, v in os.environ.items() if not k.startswith("_PYI") and k != "_MEIPASS2"}
                env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"                 # le nouvel exe doit extraire SA version, pas réutiliser celle de l'ancien
                subprocess.Popen([EXE], cwd=HERE, creationflags=DETACHED, close_fds=True, env=env)
        finally:
            self.close()

    def close(self):
        try:
            self._window.destroy()
        except Exception:
            os._exit(0)

    # ---- construction
    def _set(self, step=None, stage=None, floor=None, cap=None, tau=None):
        with self._lock:
            if step is not None:
                self._step = max(self._step, step)
            if stage:
                self._stage = stage
            if floor is not None:
                self._pct = max(self._pct, floor)
                self._floor, self._cap, self._tau, self._t_ms = floor, cap, tau, time.time()

    def _line(self, text):
        text = text.rstrip()
        if not text:
            return
        self._tail = (self._tail + [text])[-14:]
        try:
            with open(LOG, "a", encoding="utf-8") as f:
                f.write(text + "\n")
        except OSError:
            pass
        low = text.lower()
        with self._lock:
            self._n += 1
            self._lines = (self._lines + [text.replace("INFO: ", "")[:110]])[-8:]
        for pat, step, fl, cap, tau in MILESTONES:
            if pat.lower() in low and step >= self._step and fl > self._pct - 1:
                self._set(step, {1: "Analyse du code et des dépendances…", 2: "Compilation des modules…", 3: "Assemblage de ENOS.exe…"}[step], fl, cap, tau)
                break

    def _finish(self, ok, error=""):
        with self._lock:
            self._done, self._ok, self._error = True, ok, error
            if ok:
                self._step, self._pct, self._stage = 5, 100.0, "Mise à jour terminée"

    def begin(self):
        threading.Thread(target=self._run, daemon=True, name="build").start()

    def _run(self):
        try:
            open(LOG, "w").close()
            self._set(0, "Fermeture d'E.N.O.S.…", 2, 7, 3)
            if not self._demo:
                subprocess.run(["taskkill", "/f", "/im", "ENOS.exe"], capture_output=True, creationflags=NO_WINDOW)
                for _ in range(40):                                        # attend que le fichier ne soit plus verrouillé
                    out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq ENOS.exe", "/NH"], capture_output=True, text=True, creationflags=NO_WINDOW).stdout
                    if "enos.exe" not in out.lower():
                        break
                    time.sleep(0.5)
            time.sleep(1.0)
            self._set(1, "Préparation de la compilation…", 8, 12, 4)
            before = os.path.getmtime(EXE) if os.path.isfile(EXE) else 0
            code = self._demo_build() if self._demo else self._real_build()
            if code != 0:
                return self._finish(False, "La reconstruction a échoué (code %s).\n\n%s" % (code, "\n".join(self._tail[-10:])))
            if not self._demo and (not os.path.isfile(EXE) or os.path.getmtime(EXE) <= before):
                return self._finish(False, "Le build s'est terminé mais ENOS.exe n'a pas été mis à jour.\n\n" + "\n".join(self._tail[-8:]))
            self._set(4, "Finalisation…", 96, 99, 2)
            time.sleep(0.8)
            self._finish(True)
        except Exception as e:                                             # noqa: BLE001 — jamais de fenêtre figée
            self._finish(False, "Erreur inattendue : %s: %s" % (e.__class__.__name__, e))

    def _real_build(self):
        env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
        p = subprocess.Popen(["cmd", "/c", "build.bat", "auto"], cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             stdin=subprocess.DEVNULL, creationflags=NO_WINDOW, env=env)
        for raw in iter(p.stdout.readline, b""):
            self._line(raw.decode("utf-8", errors="replace"))
        p.wait()
        return p.returncode

    def _demo_build(self):
        script = [("Running Analysis Analysis-00.toc", 0.4)] + [("Analyzing module %d" % i, 0.03) for i in range(120)] + \
                 [("Building PYZ (ZlibArchive)", 1.5), ("Building PKG (CArchive) ENOS.pkg", 2.5), ("Building EXE from EXE-00.toc", 2.5),
                  ("Building EXE completed successfully.", 0.5)]
        for text, wait in script:
            self._line("INFO: " + text)
            time.sleep(wait)
        return 0


def _fallback_bat():
    subprocess.Popen(["cmd", "/c", os.path.join(HERE, "mise_a_jour.bat")], cwd=HERE, creationflags=0x00000010)


def main():
    args = sys.argv[1:]
    hue = "356"
    if "--hue" in args:
        try:
            hue = str(int(float(args[args.index("--hue") + 1])) % 360)
        except (ValueError, IndexError):
            pass
    try:
        import webview
    except ImportError:
        return _fallback_bat()
    logo = ""
    for name in ("logo.png", "logo-192.png"):
        p = os.path.join(HERE, name)
        if os.path.isfile(p):
            with open(p, "rb") as f:
                logo = "data:image/png;base64," + base64.b64encode(f.read()).decode()
            break
    with open(os.path.join(HERE, "updater_ui.html"), encoding="utf-8") as f:
        html = f.read().replace("__HUE__", hue).replace("__LOGO__", logo)
    up = Updater(demo="--demo" in args)
    up._window = webview.create_window("E.N.O.S. — Mise à jour", html=html, js_api=up, width=900, height=620,
                                       frameless=True, easy_drag=True, resizable=False, background_color="#000000")
    webview.start(up.begin)


if __name__ == "__main__":
    main()
