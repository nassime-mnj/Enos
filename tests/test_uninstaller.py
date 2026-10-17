"""Désinstalleur de versions de test (Dev Manager) : détection du unins000.exe Inno et lancement non bloquant avec UAC. Rien n'est réellement lancé."""
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nasko_devmanager as D


class FindUninstaller(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def _exe(self, name="unins000.exe"):
        p = os.path.join(self.tmp.name, name)
        open(p, "wb").write(b"MZ")
        return p

    def test_registry_path_wins_over_defaults(self):
        exe = self._exe()
        with mock.patch.object(D, "_registry_uninstaller", return_value=exe), mock.patch.dict(os.environ, {"ProgramFiles": os.path.join(self.tmp.name, "nada")}):
            self.assertEqual(D.find_uninstaller(), os.path.normpath(exe))

    def test_default_folder_fallback(self):
        pf = self.tmp.name
        os.makedirs(os.path.join(pf, "ENOS"))
        exe = os.path.join(pf, "ENOS", "unins000.exe")
        open(exe, "wb").write(b"MZ")
        with mock.patch.object(D, "_registry_uninstaller", return_value=""), mock.patch.dict(os.environ, {"ProgramFiles": pf}):
            self.assertEqual(D.find_uninstaller(), os.path.normpath(exe))

    def test_only_inno_uninstaller_names_accepted(self):
        for name in ("evil.exe", "unins.exe", "unins0000.exe", "cmd.exe"):
            exe = self._exe(name)
            with mock.patch.object(D, "_registry_uninstaller", return_value=exe), mock.patch.dict(os.environ, {"ProgramFiles": os.path.join(self.tmp.name, "nada")}):
                self.assertIsNone(D.find_uninstaller(), name)

    def test_missing_returns_none(self):
        with mock.patch.object(D, "_registry_uninstaller", return_value=os.path.join(self.tmp.name, "unins000.exe")), mock.patch.dict(os.environ, {"ProgramFiles": os.path.join(self.tmp.name, "nada")}):
            self.assertIsNone(D.find_uninstaller())


class Launch(unittest.TestCase):
    def _fake_ctypes(self, rc):
        shell = mock.Mock()
        shell.ShellExecuteW.return_value = rc
        ct = mock.Mock()
        ct.windll.shell32 = shell
        return ct, shell

    def test_runas_silent_and_non_blocking(self):
        ct, shell = self._fake_ctypes(42)
        with mock.patch.object(D, "find_uninstaller", return_value=r"C:\Program Files\ENOS\unins000.exe"), mock.patch.dict(sys.modules, {"ctypes": ct}):
            r = D.uninstall_launcher(True)
        args = shell.ShellExecuteW.call_args[0]
        self.assertEqual(args[1], "runas")                         # UAC
        self.assertEqual(args[2], r"C:\Program Files\ENOS\unins000.exe")
        self.assertEqual(args[3], "/SILENT")
        self.assertEqual(r, {"path": r"C:\Program Files\ENOS\unins000.exe", "silent": True})

    def test_not_silent_has_no_argument(self):
        ct, shell = self._fake_ctypes(33)
        with mock.patch.object(D, "find_uninstaller", return_value=r"C:\x\unins000.exe"), mock.patch.dict(sys.modules, {"ctypes": ct}):
            D.uninstall_launcher(False)
        self.assertEqual(shell.ShellExecuteW.call_args[0][3], "")

    def test_uac_refused_is_an_error(self):
        ct, _ = self._fake_ctypes(5)
        with mock.patch.object(D, "find_uninstaller", return_value=r"C:\x\unins000.exe"), mock.patch.dict(sys.modules, {"ctypes": ct}):
            with self.assertRaises(D.DevError):
                D.uninstall_launcher()

    def test_nothing_installed_is_an_error(self):
        with mock.patch.object(D, "find_uninstaller", return_value=None):
            with self.assertRaises(D.DevError):
                D.uninstall_launcher()


class Route(unittest.TestCase):
    def test_requires_confirm(self):
        import nasko_server as S
        with self.assertRaises(S.HTTPException) as cm:
            S.dev_uninstall_launcher(S.DevUninstall())
        self.assertEqual(cm.exception.status_code, 400)

    def test_confirmed_calls_backend(self):
        import nasko_server as S
        with mock.patch.object(S.nasko_devmanager, "uninstall_launcher", return_value={"path": "p", "silent": True}) as m:
            self.assertEqual(S.dev_uninstall_launcher(S.DevUninstall(confirm=True)), {"path": "p", "silent": True})
        m.assert_called_once_with(True)


if __name__ == "__main__":
    unittest.main()
