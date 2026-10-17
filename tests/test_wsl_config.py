"""Portabilité WSL : espace de travail réglable (nasko_wsl, Dev Manager, routes) et style EPITA embarqué (aucune lecture dans le dossier personnel de quelqu'un)."""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nasko_depot_git as G  # noqa: E402
import nasko_devmanager as D  # noqa: E402
import nasko_server as S  # noqa: E402
import nasko_wsl as W  # noqa: E402

DEFAULT = "\\\\wsl.localhost\\Ubuntu\\home\\nasko"
DIMITRI = "\\\\wsl.localhost\\Ubuntu\\home\\dimitri"


class Base(unittest.TestCase):
    def setUp(self):
        self.cfg = {"v": ""}
        p = mock.patch.object(W, "_configured", side_effect=lambda: self.cfg["v"])
        p.start()
        self.addCleanup(p.stop)
        W.reset()
        self.addCleanup(W.reset)


class Workspace(Base):
    def test_default_when_nothing_configured(self):
        self.assertEqual(W.workspace_unc(), DEFAULT)
        self.assertTrue(W.is_default())
        self.assertEqual((W.DISTRO, W.DIR), ("Ubuntu", "/home/nasko"))

    def test_configured_value_is_used_everywhere_and_dynamically(self):
        self.cfg["v"] = DIMITRI
        self.assertEqual((W.WORKSPACE_UNC, W.DISTRO, W.DIR), (DIMITRI, "Ubuntu", "/home/dimitri"))
        self.assertEqual(W.linux_path("ex00", "a.c"), "/home/dimitri/ex00/a.c")
        self.assertEqual(W.unc_path("ex00"), DIMITRI + "\\ex00")
        self.assertFalse(W.is_default())
        self.assertEqual(G.WslRunner("Ubuntu").base, "/home/dimitri")

    def test_invalid_stored_value_falls_back_to_default(self):
        for bad in ("C:\\x", "/home/x", "\\\\wsl.localhost\\Ubuntu", "\\\\wsl.localhost\\Ubuntu\\..\\etc", "x; rm -rf /"):
            self.cfg["v"] = bad
            W.reset()
            self.assertEqual(W.workspace_unc(), DEFAULT, bad)

    def test_set_workspace_validates_and_persists(self):
        with mock.patch("nasko_core.update_config") as upd:
            self.assertEqual(W.set_workspace(DIMITRI + "\\ "), DIMITRI)          # espaces et antislash de fin retirés
            upd.assert_called_with({"wsl_workspace": DIMITRI})
            self.assertEqual(W.DIR, "/home/dimitri")
            W.set_workspace("")                                                  # vide = retour au défaut
            upd.assert_called_with({"wsl_workspace": ""})
            self.assertEqual(W.workspace_unc(), DEFAULT)
            n = upd.call_count
            for bad in ("C:\\Users\\dimitri", "\\\\wsl.localhost\\Ubuntu", "\\\\evil\\share\\x", "\\\\wsl.localhost\\Ubuntu\\home\\a b", "\\\\wsl.localhost\\Ubuntu\\home\\a;b",
                        "\\\\wsl.localhost\\Ubuntu\\home\\$(x)", "\\\\wsl.localhost\\Ubuntu\\..\\x", "\\\\wsl.localhost\\Ub untu\\home\\x"):
                with self.assertRaises(ValueError, msg=bad):
                    W.set_workspace(bad)
            self.assertEqual(upd.call_count, n)                                  # rien d'invalide n'est jamais enregistré


class DevManager(Base):
    def test_scripts_carry_markers_resolved_at_send_time(self):
        self.assertNotIn("/home/", D.BSET)
        self.assertNotIn("nasko", D.BSET)
        self.cfg["v"] = DIMITRI
        self.assertIn("B=/home/dimitri;", D._subst(D.BSET))
        self.assertIn(DIMITRI, D._subst(D.BSET))
        self.cfg["v"] = ""
        W.reset()
        self.assertIn("B=/home/nasko;", D._subst(D.BSET))
        self.assertNotIn("@@", D._subst(D.WRAP))

    def test_launcher_resolves_markers(self):
        import base64
        import re
        self.cfg["v"] = DIMITRI
        cmd = D._launcher(D.BSET + "echo ok")
        body = base64.b64decode(re.search(r"echo ([A-Za-z0-9+/=]+)\|base64", cmd).group(1)).decode()
        self.assertIn("B=/home/dimitri;", body)
        self.assertNotIn("@@", body)

    def test_set_workspace_checks_existence_before_applying(self):
        with mock.patch.object(D, "available", return_value=True), mock.patch.object(D, "_dir_exists", return_value=False), mock.patch("nasko_core.update_config") as upd:
            with self.assertRaises(D.DevError) as cm:
                D.set_workspace(DIMITRI)
            self.assertIn("introuvable", str(cm.exception))
            upd.assert_not_called()
            self.assertEqual(W.workspace_unc(), DEFAULT)
        with mock.patch.object(D, "available", return_value=True), mock.patch.object(D, "_dir_exists", return_value=True), mock.patch("nasko_core.update_config") as upd:
            st = D.set_workspace(DIMITRI)
            upd.assert_called_with({"wsl_workspace": DIMITRI})
            self.assertEqual((st["unc"], st["linux"], st["exists"]), (DIMITRI, "/home/dimitri", True))

    def test_set_workspace_rejects_bad_shape_without_calling_wsl(self):
        with mock.patch.object(D, "_dir_exists") as ex:
            for bad in ("C:\\x", "\\\\wsl.localhost\\Ubuntu\\home\\x;rm"):
                with self.assertRaises(D.DevError):
                    D.set_workspace(bad)
            ex.assert_not_called()

    def test_detect_parses_distro_and_home(self):
        ok = mock.Mock(returncode=0, stdout=b"Ubuntu\n/home/dimitri\n")
        with mock.patch.object(D, "available", return_value=True), mock.patch("subprocess.run", return_value=ok):
            self.assertEqual(D.detect_workspace(), {"unc": DIMITRI})
        for out in (b"", b"Ubuntu\n", b"Ubuntu\n/home/a;b\n", b"Ub untu\n/home/x\n", b"Ubuntu\nrelative\n"):
            with mock.patch.object(D, "available", return_value=True), mock.patch("subprocess.run", return_value=mock.Mock(returncode=0, stdout=out)):
                with self.assertRaises(D.DevError, msg=out):
                    D.detect_workspace()

    def test_state_reports_missing_folder_without_raising(self):
        self.cfg["v"] = DIMITRI
        with mock.patch.object(D, "available", return_value=True), mock.patch.object(D, "_dir_exists", return_value=False):
            st = D.workspace_state()
        self.assertFalse(st["exists"])
        self.assertTrue(st["reason"])
        with mock.patch.object(D, "available", return_value=False):
            self.assertIn("WSL", D.workspace_state()["reason"])


class Routes(Base):
    def test_terminals_closed_only_after_a_successful_change(self):
        with mock.patch.object(S.nasko_devmanager, "set_workspace", side_effect=D.DevError("non")), mock.patch.object(S.nasko_depot_term, "close_all") as ca:
            with self.assertRaises(S.HTTPException):
                S.depot_workspace_set(S.DepotWorkspace(unc="x"))
            ca.assert_not_called()
        with mock.patch.object(S.nasko_devmanager, "set_workspace", return_value={"unc": DIMITRI}), mock.patch.object(S.nasko_depot_term, "close_all") as ca:
            self.assertEqual(S.depot_workspace_set(S.DepotWorkspace(unc=DIMITRI)), {"unc": DIMITRI})
            ca.assert_called_once()


class EmbeddedStyle(unittest.TestCase):
    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix="nasko_style_"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        env = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1")
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=self.tmp, env=env, check=True)
        self.repo = G.GitRepo(G.LocalRunner(env), self.tmp)

    def test_asset_ships_with_the_app_and_is_plain_style_yaml(self):
        p = G.clang_asset_path()
        self.assertTrue(os.path.isfile(p), p)
        text = open(p, encoding="utf-8").read()
        self.assertIn("IndentWidth: 4", text)
        self.assertNotIn("\x00", text)
        self.assertLess(len(text.encode()), G.MAX_CLANG)
        self.assertNotRegex(text.lower(), r"nasko|dimitri|/home/|c:\\|wsl")           # aucune donnée personnelle dans ce qu'on distribue

    def test_default_injection_uses_embedded_asset_not_a_personal_folder(self):
        with mock.patch("nasko_wsl.unc_path", side_effect=AssertionError("lecture du dossier perso interdite")), \
             mock.patch("nasko_wsl.linux_path", side_effect=AssertionError("lecture du dossier perso interdite")):
            r = G.inject_clang_format(self.repo)
        self.assertTrue(r["ok"])
        got = open(os.path.join(self.tmp, ".clang-format"), "rb").read()
        want = open(G.clang_asset_path(), "rb").read().replace(b"\r\n", b"\n")
        self.assertEqual(got, want)
        self.assertNotIn(b"\r", got)                                                   # LF même si le fichier embarqué est en CRLF sur disque

    def test_second_injection_overwrites(self):
        G.inject_clang_format(self.repo)
        with open(os.path.join(self.tmp, ".clang-format"), "w") as f:
            f.write("vieux\n")
        r = G.inject_clang_format(self.repo)
        self.assertTrue(r["replaced"])
        self.assertIn("IndentWidth", open(os.path.join(self.tmp, ".clang-format")).read())

    def test_missing_asset_is_a_clear_error(self):
        with mock.patch.object(G, "clang_asset_path", return_value=os.path.join(self.tmp, "absent")):
            with self.assertRaises(G.GitError) as cm:
                G.inject_clang_format(self.repo)
        self.assertIn("embarqué", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
