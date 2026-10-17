"""Installeur : le Launcher Dual Pulse (Tauri) est compilé par build_release.py, embarqué par installer/enos.iss, et les raccourcis pointent vers lui.
Inno Setup ne tourne pas hors Windows : le script .iss est donc contrôlé par un petit préprocesseur (#ifdef / #else / #endif) puis par des assertions sur chaque section.
Lancer : python3 tests/test_installer.py"""
import os, re, sys, tempfile, unittest
from pathlib import Path
from unittest import mock
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import build_release as B  # noqa: E402

ISS = (ROOT / "installer" / "enos.iss").read_text(encoding="utf-8-sig")
LAUNCHER_EXE = r"C:\build\launcher-bin\DualPulseLauncher.exe"
LPATH = r"{autopf}\Dual Pulse Launcher\DualPulseLauncher.exe"


def preprocess(text, defines):
    """Évalue #ifdef X / #else / #endif (imbriqués) pour un ensemble de symboles définis ; lève si les blocs ne sont pas équilibrés."""
    out, stack = [], []
    for n, line in enumerate(text.splitlines(), 1):
        t = line.strip()
        if t.startswith("#ifdef "):
            stack.append(t.split()[1] in defines)
        elif t.startswith("#ifndef "):
            stack.append(t.split()[1] not in defines)
        elif t == "#else":
            stack[-1] = not stack[-1]
        elif t == "#endif":
            stack.pop()
        elif all(stack):
            out.append(line)
    assert not stack, "#ifdef / #endif déséquilibrés"
    return "\n".join(out)


def sections(text):
    """{nom: [lignes utiles]} ; un en-tête n'est reconnu qu'EN DÉBUT de ligne et seul (jamais dans un commentaire qui le cite)."""
    res, cur = {}, None
    for line in text.splitlines():
        m = re.fullmatch(r"\[(\w+)\]", line.strip()) if not line.startswith(";") else None
        if m:
            assert m.group(1) not in res, "section en double : " + m.group(1)
            cur = res.setdefault(m.group(1), [])
        elif cur is not None and line.strip() and not line.strip().startswith(";"):
            cur.append(line.strip())
    return res


class IssScript(unittest.TestCase):
    def test_structure_and_identity(self):
        s = sections(preprocess(ISS, {"LauncherExe"}))
        self.assertEqual(list(s), ["Setup", "Languages", "CustomMessages", "Tasks", "Dirs", "Files", "Icons", "Run", "UninstallRun", "Code"])
        self.assertIn("AppId={{6F1E2B7A-4C3D-4E8B-9A57-E905A1C0D3B2}", s["Setup"])           # GUID fixe : le Launcher retrouve E.N.O.S. par ce {AppId}_is1
        self.assertIn("PrivilegesRequired=admin", s["Setup"])
        self.assertTrue(ISS.startswith("; E.N.O.S."), "BOM retiré par utf-8-sig")
        self.assertEqual(open(ROOT / "installer" / "enos.iss", "rb").read(3), b"\xef\xbb\xbf", "UTF-8 avec BOM : les accents du français restent corrects")

    def test_with_launcher_shortcuts_and_final_launch_point_to_launcher(self):
        s = sections(preprocess(ISS, {"LauncherExe"}))
        files = [l for l in s["Files"] if "{#LauncherExe}" in l]
        self.assertEqual(len(files), 1)
        self.assertIn(r'DestDir: "{autopf}\Dual Pulse Launcher"', files[0])
        self.assertIn('DestName: "DualPulseLauncher.exe"', files[0])
        self.assertIn("Check: LauncherReplaceable", files[0])                             # jamais remplacé pendant qu'il tourne
        icons = {re.match(r'Name: "([^"]+)"', l).group(1): l for l in s["Icons"]}
        self.assertIn(LPATH, icons[r"{autoprograms}\Dual Pulse Launcher"])
        self.assertIn(LPATH, icons[r"{autodesktop}\Dual Pulse Launcher"])
        self.assertIn("Tasks: desktopicon", icons[r"{autodesktop}\Dual Pulse Launcher"])
        for name, line in icons.items():
            if name.startswith(("{autoprograms}", "{autodesktop}")):
                self.assertNotIn("ENOS.exe", line, "plus aucun raccourci Bureau / menu Démarrer vers ENOS.exe : " + name)
        bg = [l for l in s["Icons"] if l.startswith('Name: "{userstartup}')]
        self.assertEqual(len(bg), 1)
        self.assertIn("{app}\\ENOS.exe", bg[0]); self.assertIn("--background", bg[0])     # la tâche de fond reste E.N.O.S. directement
        post = [l for l in s["Run"] if "postinstall" in l]
        self.assertEqual(len(post), 1); self.assertIn(LPATH, post[0]); self.assertIn("skipifsilent", post[0])
        self.assertTrue(any("Check: WizardSilent" in l and "ENOS.exe" in l for l in s["Run"]), "relance silencieuse d'E.N.O.S. (OTA) conservée")
        self.assertTrue(any("DualPulseLauncher.exe" in l and "KillLauncher" in l for l in s["UninstallRun"]))
        self.assertTrue(any("ENOS.exe" in l and "KillEnos" in l for l in s["UninstallRun"]))

    def test_without_launcher_keeps_historical_behaviour(self):
        s = sections(preprocess(ISS, set()))
        self.assertFalse(any("LauncherExe" in l or "DualPulseLauncher" in l for l in sum(s.values(), [])))
        icons = "\n".join(s["Icons"])
        self.assertIn(r'Name: "{autoprograms}\E.N.O.S."; Filename: "{app}\ENOS.exe"', icons)
        self.assertIn(r'Name: "{autodesktop}\E.N.O.S."; Filename: "{app}\ENOS.exe"', icons)
        post = [l for l in s["Run"] if "postinstall" in l]
        self.assertEqual(len(post), 1); self.assertIn("{app}\\ENOS.exe", post[0])

    def test_custom_messages_exist_in_both_languages_and_check_functions_are_defined(self):
        full = preprocess(ISS, {"LauncherExe"})
        s = sections(full)
        langs = [re.match(r'Name: "(\w+)"', l).group(1) for l in s["Languages"]]
        self.assertEqual(langs, ["english", "french"])
        defined = {l.split("=", 1)[0] for l in s["CustomMessages"]}
        used = set(re.findall(r"\{cm:(\w+)", full)) | set(re.findall(r"CustomMessage\('(\w+)'\)", full))
        self.assertTrue(used, "aucun message traduit utilisé ?")
        for k in used:
            for lang in langs:
                self.assertIn(f"{lang}.{k}", defined, f"message « {k} » absent en {lang}")
        code = "\n".join(s["Code"])
        for fn in set(re.findall(r"Check: (\w+)", full)) - {"WizardSilent"}:               # WizardSilent est une fonction native d'Inno
            self.assertRegex(code, rf"function {fn}\b", f"fonction Check « {fn} » non définie")
        self.assertIn("FindWindowByWindowName('Dual Pulse Launcher')", code)
        tauri = (ROOT / "launcher" / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8")
        self.assertIn('"title": "Dual Pulse Launcher"', tauri, "le titre de fenêtre cherché par l'installeur doit exister côté Tauri")

    def test_every_dist_reference_is_a_define(self):
        for d in set(re.findall(r"\{#(\w+)\}", ISS)):
            self.assertIn(d, {"AppVersion", "Edition", "DistDir", "OutDir", "AssetsDir", "LauncherExe"}, d)


class BuildScript(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.patches = [mock.patch.object(B, n, v) for n, v in (("REL", self.tmp / "release"), ("LAUNCHER_TARGET", self.tmp / "release" / "launcher-target"),
                                                                  ("LAUNCHER_OUT", self.tmp / "release" / "launcher-bin"), ("LAUNCHER", self.tmp / "launcher"), ("ROOT", self.tmp / "root"))]
        for p in self.patches:
            p.start()
        (self.tmp / "launcher" / "src-tauri").mkdir(parents=True)
        (self.tmp / "launcher" / "src-tauri" / "tauri.conf.json").write_text("{}")
        (self.tmp / "root").mkdir()
        (self.tmp / "root" / "ota_pubkey.txt").write_text("NEWKEYBASE64==")

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_iscc_command_embeds_launcher_only_when_given(self):
        a = B.iscc_command("ISCC.exe", "3.1.0", "friends", "assets", LAUNCHER_EXE)
        self.assertIn("/DLauncherExe=" + LAUNCHER_EXE, a); self.assertTrue(a[-1].endswith("enos.iss"))
        self.assertFalse(any(x.startswith("/DLauncherExe") for x in B.iscc_command("ISCC.exe", "3.1.0", "friends", "assets")))

    def test_pubkey_is_synced_to_the_launcher(self):
        (self.tmp / "launcher" / "src-tauri" / "manifest_pubkey.txt").write_text("OLDKEY==")
        self.assertEqual(B.sync_launcher_pubkey(), "NEWKEYBASE64==")
        self.assertEqual((self.tmp / "launcher" / "src-tauri" / "manifest_pubkey.txt").read_text().strip(), "NEWKEYBASE64==")

    def test_env_isolates_target_and_masks_local_paths(self):
        e = B.launcher_env()
        self.assertEqual(e["CARGO_TARGET_DIR"], str(B.LAUNCHER_TARGET))
        self.assertIn(f"--remap-path-prefix={Path.home()}=~", e["RUSTFLAGS"])

    def test_build_stops_clearly_when_tooling_or_platform_is_missing(self):
        with mock.patch.object(B.sys, "platform", "linux"), self.assertRaises(SystemExit):
            B.build_launcher()
        with mock.patch.object(B.sys, "platform", "win32"), mock.patch.object(B.shutil, "which", return_value=None), self.assertRaises(SystemExit):
            B.build_launcher()
        self.assertFalse((B.LAUNCHER_OUT / B.LAUNCHER_FILE).exists(), "aucun Launcher fantôme")

    def test_invalid_executable_is_refused(self):
        bad = self.tmp / "x.exe"
        with self.assertRaises(SystemExit):
            B.check_launcher_exe(bad)                                                    # absent
        bad.write_bytes(b"#!/bin/sh\n" + b"0" * 800000)
        with self.assertRaises(SystemExit):
            B.check_launcher_exe(bad)                                                    # pas un exécutable Windows
        bad.write_bytes(b"MZ" + b"0" * 100)
        with self.assertRaises(SystemExit):
            B.check_launcher_exe(bad)                                                    # coquille vide

    def test_full_launcher_build_with_fake_cargo(self):
        calls = []

        def fake_run(cmd, **kw):
            calls.append((cmd, kw))
            if cmd[1:3] == ["tauri", "build"]:
                exe = B.LAUNCHER_TARGET / "release" / B.LAUNCHER_BIN
                exe.parent.mkdir(parents=True, exist_ok=True)
                exe.write_bytes(b"MZ" + b"\0" * 700000)
            return mock.Mock(returncode=0)

        with mock.patch.object(B.sys, "platform", "win32"), mock.patch.object(B.shutil, "which", return_value="cargo"), \
                mock.patch.object(B.subprocess, "run", fake_run), mock.patch.object(B, "leak_scan", return_value=[]):
            out = B.build_launcher()
        self.assertEqual(out, B.LAUNCHER_OUT / B.LAUNCHER_FILE); self.assertTrue(out.read_bytes().startswith(b"MZ"))
        build = [c for c in calls if c[0][1:3] == ["tauri", "build"]][0]
        self.assertEqual(build[0], ["cargo", "tauri", "build", "--no-bundle"]); self.assertEqual(build[1]["cwd"], B.LAUNCHER)
        self.assertEqual((self.tmp / "launcher" / "src-tauri" / "manifest_pubkey.txt").read_text().strip(), "NEWKEYBASE64==")
        self.assertNotIn(str(B.LAUNCHER_OUT), str(B.DIST), "le Launcher n'est jamais dans dist-<édition> (donc jamais dans les manifestes « files » d'E.N.O.S.)")

    def test_leak_in_launcher_is_fatal(self):
        def fake_run(cmd, **kw):
            if cmd[1:3] == ["tauri", "build"]:
                exe = B.LAUNCHER_TARGET / "release" / B.LAUNCHER_BIN
                exe.parent.mkdir(parents=True, exist_ok=True)
                exe.write_bytes(b"MZ" + b"\0" * 700000)
            return mock.Mock(returncode=0)
        with mock.patch.object(B.sys, "platform", "win32"), mock.patch.object(B.shutil, "which", return_value="cargo"), mock.patch.object(B.subprocess, "run", fake_run), \
                mock.patch.object(B, "leak_scan", return_value=[(Path("x.exe"), "motif sensible")]), self.assertRaises(SystemExit):
            B.build_launcher()

    def test_skip_launcher_flag_exists_and_manifests_stay_free_of_the_launcher(self):
        src = (ROOT / "build_release.py").read_text(encoding="utf-8")
        self.assertIn("--skip-launcher", src)
        self.assertIn("build_installer(a.version, a.edition, launcher_exe)", src)


if __name__ == "__main__":
    unittest.main()
