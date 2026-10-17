"""Préparation de la version Linux : options PyInstaller, noms, Launcher ELF, clés de signature, paquet tar.gz + scripts d'installation, AppDir.
Bibliothèque standard seulement ; les scripts install.sh / uninstall.sh sont EXÉCUTÉS pour de vrai quand `sh` existe (Linux, WSL, Git Bash)."""
import hashlib
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import build_release as B  # noqa: E402
import release_linux as L  # noqa: E402

HAVE_SH = bool(shutil.which("sh")) and sys.platform != "win32"


class PosixArgs(unittest.TestCase):
    def test_add_data_separator_and_windows_options(self):
        src = ["--onefile", "--noconsole", "--name", "ENOS", "--icon=C:\\x\\logo.ico", "--add-data", "/s/static;static", "--add-data", "/s/logo.png;.",
               "--collect-all", "webview", "--hidden-import", "nasko_core", "nasko_server.py"]
        out = B.posix_pyinstaller_args(src)
        self.assertEqual(out, ["--onefile", "--name", "ENOS", "--add-data", "/s/static:static", "--add-data", "/s/logo.png:.", "--collect-all", "webview", "--hidden-import",
                               "nasko_core", "nasko_server.py"])
        self.assertEqual(B.posix_pyinstaller_args(["--icon", "x.ico", "--windowed", "-w", "--name", "X"]), ["--name", "X"])

    def test_real_build_bat_converts_cleanly(self):
        with mock.patch.object(B, "STAGE", Path("/tmp/stage")):
            args = B.pyinstaller_args()
        out = B.posix_pyinstaller_args(args)
        self.assertTrue(all(";" not in out[i + 1] for i, a in enumerate(out[:-1]) if a == "--add-data"), out)
        self.assertFalse(any(a.startswith("--icon") or a == "--noconsole" for a in out))
        self.assertIn("nasko_server.py", out)
        self.assertIn("--add-data", out)

    def test_windows_args_are_untouched(self):
        with mock.patch.object(B.sys, "platform", "win32"):
            self.assertTrue(B.is_windows() and not B.is_linux())
            self.assertEqual((B.app_exe(), B.launcher_file(), B.launcher_bin()), ("ENOS.exe", "DualPulseLauncher.exe", "dual-pulse-launcher.exe"))


class Names(unittest.TestCase):
    def test_linux_names(self):
        with mock.patch.object(B.sys, "platform", "linux"):
            self.assertTrue(B.is_linux() and not B.is_windows())
            self.assertEqual((B.app_exe(), B.launcher_file(), B.launcher_bin()), ("ENOS", "dual-pulse-launcher", "dual-pulse-launcher"))

    def test_package_names(self):
        self.assertEqual(L.package_name("1.0.1", "friends", architecture="x86_64"), "ENOS-1.0.1-friends-linux-x86_64.tar.gz")
        self.assertEqual(L.package_name("1.0.1", "friends", "AppImage", "aarch64"), "ENOS-1.0.1-friends-aarch64.AppImage")

    def test_keys_dir_per_platform(self):
        with mock.patch.dict(os.environ, {"ENOS_RELEASE_KEYS": "/mnt/c/k"}, clear=False):
            self.assertEqual(B.keys_dir(), Path("/mnt/c/k"))
        env = {k: v for k, v in os.environ.items() if k not in ("ENOS_RELEASE_KEYS", "LOCALAPPDATA", "XDG_DATA_HOME")}
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(B.keys_dir(), Path.home() / ".local" / "share" / "ENOS-release" / "keys")
        with mock.patch.dict(os.environ, {**env, "XDG_DATA_HOME": "/data"}, clear=True):
            self.assertEqual(B.keys_dir(), Path("/data/ENOS-release/keys"))
        with mock.patch.dict(os.environ, {**env, "LOCALAPPDATA": "C:\\Users\\u\\AppData\\Local"}, clear=True):
            self.assertEqual(B.keys_dir(), Path("C:\\Users\\u\\AppData\\Local") / "ENOS-release" / "keys")        # Windows : inchangé


class LauncherBinary(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="enos_lb_"))
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def test_elf_accepted_on_linux_and_mz_refused(self):
        elf, mz = self.tmp / "ok", self.tmp / "win"
        elf.write_bytes(b"\x7fELF" + b"\0" * (600 * 1024))
        mz.write_bytes(b"MZ" + b"\0" * (600 * 1024))
        with mock.patch.object(B.sys, "platform", "linux"):
            B.check_launcher_exe(elf)
            with self.assertRaises(SystemExit):
                B.check_launcher_exe(mz)
        with mock.patch.object(B.sys, "platform", "win32"):
            B.check_launcher_exe(mz)
            with self.assertRaises(SystemExit):
                B.check_launcher_exe(elf)

    def test_empty_shell_refused(self):
        tiny = self.tmp / "tiny"
        tiny.write_bytes(b"\x7fELF")
        with mock.patch.object(B.sys, "platform", "linux"), self.assertRaises(SystemExit):
            B.check_launcher_exe(tiny)


class Preflight(unittest.TestCase):
    def ok(self, which=lambda n: "/usr/bin/" + n, run=lambda *a, **k: subprocess.CompletedProcess(a, 0), mods=("gi",), launcher=True):
        return L.preflight(import_check=lambda m: m in mods, which=which, run=run, with_launcher=launcher)

    def test_ready(self):
        self.assertEqual(self.ok(), [])

    def test_missing_pieces_are_reported_with_the_fix(self):
        msgs = self.ok(which=lambda n: None, mods=())
        text = " ".join(msgs)
        self.assertIn("binutils", text)
        self.assertIn("python3-gi", text)
        self.assertIn("pkg-config", text)
        self.assertIn("sudo apt install", text)

    def test_missing_webkit_dev(self):
        msgs = self.ok(run=lambda *a, **k: subprocess.CompletedProcess(a, 1))
        self.assertTrue(any("libwebkit2gtk-4.1-dev" in m for m in msgs), msgs)

    def test_qt_is_an_acceptable_window_engine_and_launcher_is_optional(self):
        self.assertEqual(self.ok(mods=("PyQt5",), launcher=False, run=lambda *a, **k: subprocess.CompletedProcess(a, 1)), [])


class Package(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="enos_pkg "))                       # avec une espace
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.dist = self.tmp / "dist"
        (self.dist / "godot_eye").mkdir(parents=True)
        (self.dist / "godot_eye" / "p.txt").write_text("x")
        (self.dist / "ENOS").write_bytes(b"#!/bin/sh\necho ENOS-FAKE \"$ENOS_HOME\"\n")
        (self.dist / "nasko_config.json").write_text('{"modele": true}')
        (self.dist / "enos_profiles.json").write_text('{"modele": true}')
        self.launcher = self.tmp / "launcher-src"
        self.launcher.write_bytes(b"\x7fELF-fake")
        self.icon = self.tmp / "logo-512.png"
        self.icon.write_bytes(b"\x89PNG-fake")

    def make(self, launcher=True):
        pkg = L.assemble_tree(self.tmp / "pkg" / "ENOS-9.9.9-friends-linux-x86_64", self.dist, "9.9.9", "friends", self.launcher if launcher else None, self.icon)
        return pkg

    def test_tree_and_tarball(self):
        pkg = self.make()
        for rel in ("app/ENOS", "app/godot_eye/p.txt", "app/nasko_config.json", "launcher/dual-pulse-launcher", "install.sh", "uninstall.sh", "README.txt", "enos.png"):
            self.assertTrue((pkg / rel).exists(), rel)
        out = L.make_tarball(pkg, self.tmp / "out" / "p.tar.gz")
        with tarfile.open(out) as tf:
            modes = {m.name: m.mode for m in tf.getmembers()}
        top = pkg.name
        self.assertEqual(modes[f"{top}/app/ENOS"] & 0o111, 0o111)                   # exécutable même fabriqué depuis Windows
        self.assertEqual(modes[f"{top}/install.sh"] & 0o111, 0o111)
        self.assertEqual(modes[f"{top}/app/godot_eye/p.txt"], 0o644)

    def test_missing_binary_is_refused(self):
        (self.dist / "ENOS").unlink()
        with self.assertRaises(FileNotFoundError):
            self.make()

    def test_scripts_have_unix_line_endings_and_no_launcher_without_it(self):
        pkg = self.make(launcher=False)
        inst = (pkg / "install.sh").read_bytes()
        self.assertNotIn(b"\r", inst)
        self.assertNotIn(b'cp -f "$HERE/launcher', inst)                                # aucune copie du Launcher quand il n'est pas dans l'archive
        self.assertNotIn(b"dual-pulse-launcher.desktop", inst)
        self.assertTrue(inst.startswith(b"#!/bin/sh"))
        self.assertIn("pas le Dual Pulse Launcher", (pkg / "README.txt").read_text(encoding="utf-8"))

    def test_appdir_layout_and_apprun_moves_data_out_of_the_read_only_image(self):
        ad = L.assemble_appdir(self.tmp / "AppDir", self.dist, "9.9.9", "friends", self.icon)
        self.assertTrue((ad / "usr" / "bin" / "ENOS").is_file())
        run = (ad / "AppRun").read_text(encoding="utf-8")
        self.assertIn("ENOS_HOME", run)
        self.assertIn("exec \"$HERE/usr/bin/ENOS\"", run)
        desk = (ad / "enos.desktop").read_text(encoding="utf-8")
        self.assertIn("Exec=ENOS", desk)
        self.assertNotIn("\r", desk)

    def test_desktop_entry_refuses_injected_lines(self):
        with self.assertRaises(ValueError):
            L.desktop_entry("N\nExec=evil", "ENOS", "enos", "c")

    def test_appimage_without_tool_is_none(self):
        with mock.patch.object(L, "find_appimagetool", return_value=None):
            self.assertIsNone(L.build_appimage(self.tmp / "AppDir", self.tmp / "o.AppImage"))

    def test_full_package_step(self):
        with mock.patch.object(B, "DIST", self.dist), mock.patch.object(B, "STAGE", self.tmp / "stage"), mock.patch.object(B, "REL", self.tmp / "rel"), \
             mock.patch.object(B, "OUT", self.tmp / "installer"):
            (self.tmp / "stage").mkdir()
            (self.tmp / "stage" / "logo-512.png").write_bytes(b"png")
            made = B.build_linux_package("9.9.9", "friends", self.launcher, "tar")
        names = sorted(Path(m).name for m in made)
        self.assertEqual(names, [f"ENOS-9.9.9-friends-linux-{L.arch()}.tar.gz", f"ENOS-9.9.9-friends-linux-{L.arch()}.tar.gz.sha256"])
        tar = next(m for m in made if str(m).endswith(".tar.gz"))
        want = hashlib.sha256(Path(tar).read_bytes()).hexdigest()
        self.assertTrue(Path(str(tar) + ".sha256").read_text().startswith(want))

    def test_appimage_requested_without_tool_dies_but_both_only_warns(self):
        with mock.patch.object(B, "DIST", self.dist), mock.patch.object(B, "STAGE", self.tmp / "stage"), mock.patch.object(B, "REL", self.tmp / "rel"), \
             mock.patch.object(B, "OUT", self.tmp / "installer"), mock.patch.object(L, "find_appimagetool", return_value=None):
            with self.assertRaises(SystemExit):
                B.build_linux_package("9.9.9", "friends", None, "appimage")
            made = B.build_linux_package("9.9.9", "friends", None, "both")
        self.assertTrue(any(str(m).endswith(".tar.gz") for m in made))


@unittest.skipUnless(HAVE_SH, "sh requis (Linux / WSL / Git Bash)")
class InstallScripts(unittest.TestCase):
    """Exécute VRAIMENT install.sh / uninstall.sh dans un faux HOME : installation, mise à jour qui garde les données, désinstallation."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="enos inst "))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        dist = self.tmp / "dist"
        dist.mkdir()
        (dist / "ENOS").write_text("#!/bin/sh\necho v1\n")
        (dist / "nasko_config.json").write_text('{"modele": true}')
        (dist / "enos_profiles.json").write_text('{"modele": true}')
        (dist / "lib.bin").write_text("v1")
        launcher = self.tmp / "l"
        launcher.write_bytes(b"\x7fELF-fake")
        self.pkg = L.assemble_tree(self.tmp / "pkg" / "ENOS-1-friends-linux-x86_64", dist, "1.0.0", "friends", launcher, None)
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.env = {**os.environ, "HOME": str(self.home), "ENOS_PREFIX": str(self.home / ".local")}
        self.dist = dist

    def sh(self, script, *args):
        return subprocess.run(["sh", str(self.pkg / script), *args], env=self.env, capture_output=True, text=True)

    def test_install_update_uninstall(self):
        app = self.home / ".local" / "opt" / "enos"
        r = self.sh("install.sh")
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        self.assertTrue((app / "ENOS").is_file())
        self.assertTrue((self.home / ".local" / "bin" / "enos").is_symlink())
        desk = (self.home / ".local" / "share" / "applications" / "enos.desktop").read_text()
        self.assertIn(f'Exec="{app}/ENOS"', desk)                                      # chemin absolu, cité (espaces)
        self.assertTrue((self.home / ".local" / "opt" / "dual-pulse-launcher" / "dual-pulse-launcher").is_file())
        # l'utilisateur travaille : données et réglages
        (app / "nasko_config.json").write_text('{"cle": "perso"}')
        (app / "data").mkdir()
        (app / "data" / "agenda.json").write_text("mes taches")
        (app / "ancien.tmp").write_text("vieux fichier de programme")
        (self.dist / "lib.bin").write_text("v2")
        self.pkg = L.assemble_tree(self.tmp / "pkg" / "ENOS-1-friends-linux-x86_64", self.dist, "1.0.1", "friends", self.tmp / "l", None)
        r = self.sh("install.sh")
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        self.assertEqual((app / "lib.bin").read_text(), "v2")                          # programme mis à jour
        self.assertFalse((app / "ancien.tmp").exists())                                # ancien fichier de programme retiré
        self.assertEqual((app / "nasko_config.json").read_text(), '{"cle": "perso"}')  # réglages gardés (pas remplacés par le modèle vierge)
        self.assertEqual((app / "data" / "agenda.json").read_text(), "mes taches")
        r = self.sh("uninstall.sh")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse((app / "ENOS").exists())
        self.assertFalse((self.home / ".local" / "bin" / "enos").exists())
        self.assertFalse((self.home / ".local" / "share" / "applications" / "enos.desktop").exists())
        self.assertEqual((app / "data" / "agenda.json").read_text(), "mes taches")      # données conservées sans --purge
        r = self.sh("uninstall.sh", "--purge")
        self.assertFalse(app.exists())

    def test_incomplete_archive_is_refused(self):
        (self.pkg / "app" / "ENOS").unlink()
        r = self.sh("install.sh")
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse((self.home / ".local" / "opt" / "enos").exists())


if __name__ == "__main__":
    unittest.main()
