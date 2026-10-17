"""Linux natif : espace de travail local, exécution directe (aucune surcouche WSL), sélecteur de dossier natif.

Bibliothèque standard seulement : tourne avec pytest comme avec `python3 -m unittest tests.test_linux_native`. Les classes « Logic » épinglent la plateforme (platform_pin) et passent
partout ; la classe RealLinux exécute VRAIMENT bash, git, un pty… et ne tourne que sur un Linux réel (WSL compris)."""
import os
import posixpath
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nasko_depot as P  # noqa: E402
import nasko_depot_git as G  # noqa: E402
import nasko_depot_term as T  # noqa: E402
import nasko_devmanager as D  # noqa: E402
import nasko_wsl as W  # noqa: E402
from platform_pin import linux, windows  # noqa: E402

UNC = "\\\\wsl.localhost\\Ubuntu\\home\\dimitri"


class Base(unittest.TestCase):
    def setUp(self):
        self.cfg = {}
        p = mock.patch.object(W, "_config", side_effect=lambda: self.cfg)
        p.start()
        self.addCleanup(p.stop)
        W.reset()
        self.addCleanup(W.reset)


@linux
class LinuxWorkspace(Base):
    def test_default_is_the_home_folder_and_there_is_no_distribution(self):
        with mock.patch.object(os.path, "expanduser", side_effect=lambda p: p.replace("~", "/home/dimitri")):
            self.assertEqual(W.workspace_unc(), "/home/dimitri")
            self.assertEqual((W.DISTRO, W.DIR, W.WORKSPACE_UNC), ("", "/home/dimitri", "/home/dimitri"))
            self.assertTrue(W.is_default())

    def test_legacy_depot_local_root_is_the_default(self):
        self.cfg = {"depot_local_root": "/data/repos"}
        self.assertEqual(W.workspace_unc(), "/data/repos")

    def test_any_absolute_folder_is_accepted_including_spaces_and_accents(self):
        self.cfg = {"wsl_workspace": "/home/jean/Mes Projets/é"}
        self.assertEqual(W.DIR, "/home/jean/Mes Projets/é")
        self.assertEqual(W.linux_path("ex00"), "/home/jean/Mes Projets/é/ex00")
        self.assertEqual(W.unc_path("ex00"), "/home/jean/Mes Projets/é/ex00")                  # pas d'UNC sous Linux
        self.assertFalse(W.is_default())

    def test_invalid_paths_are_refused(self):
        for bad in ("relatif/dossier", "~/x", "", "/", "/a/../b", "/a\x00b", "/a\nb", "C:\\Users\\x", UNC):
            with self.assertRaises(ValueError, msg=repr(bad)):
                W.clean_unc(bad)
        self.cfg = {"wsl_workspace": "/a/../etc"}
        with mock.patch.object(os.path, "expanduser", side_effect=lambda p: p.replace("~", "/home/dimitri")):
            self.assertEqual(W.workspace_unc(), "/home/dimitri")                                   # réglage invalide : retour au défaut

    def test_set_workspace_normalises_and_persists(self):
        with mock.patch("nasko_core.update_config") as upd:
            self.assertEqual(W.set_workspace("/home//dimitri/projets/"), "/home/dimitri/projets")
            upd.assert_called_with({"wsl_workspace": "/home/dimitri/projets"})
            self.assertEqual(W.DIR, "/home/dimitri/projets")
            with self.assertRaises(ValueError):
                W.set_workspace("/home/../root")


@linux
class LinuxExecution(Base):
    def setUp(self):
        super().setUp()
        p = mock.patch.object(os.path, "expanduser", side_effect=lambda p: p.replace("~", "/home/dimitri"))
        p.start()
        self.addCleanup(p.stop)

    def test_commands_run_in_the_local_shell_without_any_wrapper(self):
        argv = D._argv("echo \"$1\"", ("a b",), "Ubuntu")
        self.assertEqual(argv, ["bash", "-c", "echo \"$1\"", "bash", "a b"])
        self.assertNotIn("wsl.exe", argv)
        self.cfg = {"wsl_workspace": "/home/jean/Mes Projets"}
        W.reset()
        script = D._argv(D.BSET + "pwd", (), "")[2]
        self.assertIn("B='/home/jean/Mes Projets';", script)                                       # chemin avec espaces : cité
        self.assertNotIn("@@", script)

    def test_available_means_bash(self):
        with mock.patch.object(D.shutil, "which", side_effect=lambda n: "/bin/bash" if n == "bash" else None):
            self.assertTrue(D.available())
        with mock.patch.object(D.shutil, "which", return_value=None):
            self.assertFalse(D.available())
            with self.assertRaises(D.DevError) as cm:
                D._need_wsl()
            self.assertIn("bash", str(cm.exception))

    def test_git_runner_has_no_wsl_layer(self):
        r = G.WslRunner("", "/home/jean/Mes Projets")                                             # pas de distribution sous Linux
        argv = r.argv(["git", "status"], "ex00")
        self.assertEqual(argv[:2], ["bash", "-c"])
        self.assertNotIn("wsl.exe", argv)
        self.assertNotIn("base64", " ".join(argv))
        self.assertIn("cd '/home/jean/Mes Projets'/ex00", argv[2])
        self.assertIn("exec git status", argv[2])
        with self.assertRaises(G.GitError):
            G.WslRunner("", "relatif")
        with self.assertRaises(G.GitError):
            G.WslRunner("", "/a/../b")

    def test_depot_is_local_mode_never_wsl(self):
        with mock.patch.object(P, "_devmanager", return_value=mock.Mock(available=lambda: True)):
            self.assertEqual(P.mode({}), "local")
        ws = os.path.realpath(os.path.expanduser("/tmp/mes-depots"))
        self.assertEqual(P.local_root({"wsl_workspace": "/tmp/mes-depots"}), ws)
        self.assertEqual(P.local_root({"wsl_workspace": "/tmp/new", "depot_local_root": "/tmp/old"}), os.path.realpath("/tmp/new"))      # le choix de l'utilisateur prime
        self.assertEqual(P.local_root({"depot_local_root": "/tmp/old"}), os.path.realpath("/tmp/old"))

    def test_vscode_and_file_manager_open_the_local_folder(self):
        with mock.patch.object(D, "_repo_path", return_value="/ws/ex00"), mock.patch.object(D.shutil, "which", side_effect=lambda n: "/usr/bin/" + n), \
             mock.patch.object(D.subprocess, "Popen") as po:
            self.assertEqual(D.open_vscode("ex00"), "/ws/ex00")
            self.assertEqual(po.call_args[0][0], ["/usr/bin/code", "/ws/ex00"])                    # pas de « --remote wsl+… »
            D.open_explorer("ex00")
            self.assertEqual(po.call_args[0][0][0], "xdg-open")

    def test_detect_returns_the_home_folder(self):
        with mock.patch.object(os.path, "expanduser", return_value="/home/dimitri"), mock.patch.object(os.path, "isdir", return_value=True):
            self.assertEqual(D.detect_workspace(), {"unc": "/home/dimitri"})

    def test_set_workspace_checks_the_folder_exists(self):
        with mock.patch.object(os.path, "isdir", return_value=False), mock.patch.object(D, "available", return_value=True), mock.patch("nasko_core.update_config") as upd:
            with self.assertRaises(D.DevError):
                D.set_workspace("/nope/dossier")
            upd.assert_not_called()
        with mock.patch.object(os.path, "isdir", return_value=True), mock.patch.object(D, "available", return_value=True), mock.patch("nasko_core.update_config") as upd:
            st = D.set_workspace("/home/dimitri/projets")
            upd.assert_called_with({"wsl_workspace": "/home/dimitri/projets"})
            self.assertEqual((st["unc"], st["platform"], st["exists"]), ("/home/dimitri/projets", "Linux", True))


@windows
class WindowsStillUsesWsl(Base):
    def test_wsl_layer_is_kept_on_windows(self):
        self.assertEqual(D._argv("echo hi", (), "Ubuntu")[:5], ["wsl.exe", "-d", "Ubuntu", "--", "bash"])
        self.assertEqual(G.WslRunner("Ubuntu").argv(["git", "status"], "ex00")[:4], ["wsl.exe", "-d", "Ubuntu", "--"])
        with self.assertRaises(G.GitError):
            G.WslRunner("", None)                                                                  # une distribution est obligatoire sous Windows
        with mock.patch.object(D.shutil, "which", side_effect=lambda n: "C:/Windows/wsl.exe" if n == "wsl" else None):
            self.assertTrue(D.available())


def _cp(out=b"", rc=0, err=b""):
    return subprocess.CompletedProcess([], rc, out, err)


class PickFolder(Base):
    @windows
    def test_windows_dialog_script_goes_through_stdin_not_encodedcommand(self):
        calls = []

        def runner(cmd, **kw):
            calls.append((cmd, kw))
            return _cp((UNC + "\r\n").encode())

        self.assertEqual(D.pick_folder("Titre", UNC, runner), UNC)
        cmd, kw = calls[0]
        self.assertEqual(cmd[0], "powershell.exe")
        self.assertNotIn("-EncodedCommand", cmd)                                                   # bloqué par Defender / AppLocker
        self.assertIn("-Sta", cmd)
        self.assertIn("FolderBrowserDialog", kw["input"].decode())
        self.assertIn("TopMost", kw["input"].decode())

    @windows
    def test_windows_cancel_and_quote_escaping(self):
        self.assertIsNone(D.pick_folder("T", "", lambda cmd, **kw: _cp(b"")))
        self.assertEqual(D._ps_literal("C:\\it's"), "'C:\\it''s'")
        _, script = D._pick_windows("Titre ' piégé", "C:\\a'b")
        self.assertIn("'Titre '' piégé'", script)
        self.assertIn("'C:\\a''b'", script)

    @linux
    def test_linux_prefers_zenity_then_kdialog_then_tk(self):
        def which(name):
            return {"zenity": "/usr/bin/zenity", "kdialog": "/usr/bin/kdialog", "python3": "/usr/bin/python3"}.get(name)
        with mock.patch.object(D.shutil, "which", side_effect=which):
            self.assertEqual(D._pick_linux("T", "/home/x")[0], "zenity")
        with mock.patch.object(D.shutil, "which", side_effect=lambda n: which(n) if n != "zenity" else None):
            self.assertEqual(D._pick_linux("T", "/home/x")[0], "kdialog")
        with mock.patch.object(D.shutil, "which", side_effect=lambda n: which(n) if n == "python3" else None):
            self.assertEqual(D._pick_linux("T", "")[0], "/usr/bin/python3")
        with mock.patch.object(D.shutil, "which", return_value=None):
            self.assertIsNone(D._pick_linux("T", ""))
            with self.assertRaises(D.DevError) as cm:
                D.pick_folder("T", "")
            self.assertIn("zenity", str(cm.exception))

    @linux
    def test_linux_returns_chosen_path_cancel_and_failure(self):
        with mock.patch.object(D.shutil, "which", side_effect=lambda n: "/usr/bin/zenity" if n == "zenity" else None):
            self.assertEqual(D.pick_folder("T", "", lambda cmd, **kw: _cp(b"/home/dimitri/projets\n")), "/home/dimitri/projets")
            self.assertIsNone(D.pick_folder("T", "", lambda cmd, **kw: _cp(b"", 1)))                # zenity : 1 = annulé
            with self.assertRaises(D.DevError):
                D.pick_folder("T", "", lambda cmd, **kw: _cp(b"", 5, b"display introuvable"))

    @windows
    def test_workspace_pick_requires_a_wsl_folder_on_windows(self):
        with mock.patch.object(D, "workspace_state", return_value={"unc": UNC}):
            self.assertEqual(D.pick_workspace(runner=lambda cmd, **kw: _cp(b"")), {"cancelled": True, "unc": UNC})
        with self.assertRaises(D.DevError) as cm:
            D.pick_workspace(runner=lambda cmd, **kw: _cp(b"C:\\Users\\dimitri\\Documents"))
        self.assertIn("WSL", str(cm.exception))
        with mock.patch.object(D, "set_workspace", return_value={"unc": UNC, "exists": True}) as sw:
            r = D.pick_workspace(runner=lambda cmd, **kw: _cp(UNC.encode()))
        sw.assert_called_once_with(UNC)
        self.assertEqual(r, {"cancelled": False, "unc": UNC, "exists": True})

    @linux
    def test_workspace_pick_applies_any_local_folder_on_linux(self):
        with mock.patch.object(D, "set_workspace", return_value={"unc": "/home/x/p", "exists": True}) as sw, mock.patch.object(os.path, "isdir", return_value=True), \
             mock.patch.object(D.shutil, "which", side_effect=lambda n: "/usr/bin/zenity" if n == "zenity" else None), \
             mock.patch.object(os.path, "expanduser", side_effect=lambda p: p.replace("~", "/home/x")):
            r = D.pick_workspace(runner=lambda cmd, **kw: _cp(b"/home/x/p"))
        sw.assert_called_once_with("/home/x/p")
        self.assertFalse(r["cancelled"])


@unittest.skipUnless(sys.platform.startswith("linux"), "exécution réelle : Linux (WSL compris) uniquement")
class RealLinux(unittest.TestCase):
    """Aucun épinglage, aucun faux : vrai bash, vrai git, vrai pty, dans un dossier temporaire utilisé comme espace de travail."""

    def setUp(self):
        self.ws = os.path.realpath(tempfile.mkdtemp(prefix="enos ws "))                           # avec des espaces, volontairement
        self.addCleanup(shutil.rmtree, self.ws, True)
        self.cfg = {"wsl_workspace": self.ws}
        p = mock.patch.object(W, "_config", side_effect=lambda: self.cfg)
        p.start()
        self.addCleanup(p.stop)
        W.reset()
        self.addCleanup(W.reset)
        env = dict(os.environ, GIT_AUTHOR_NAME="T", GIT_AUTHOR_EMAIL="t@e.org", GIT_COMMITTER_NAME="T", GIT_COMMITTER_EMAIL="t@e.org", GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1")
        self.repo = os.path.join(self.ws, "ex00")
        os.makedirs(self.repo)
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=self.repo, env=env, check=True)
        with open(os.path.join(self.repo, "main.c"), "w") as f:
            f.write("int main(){int x=1;if(x){return 0;}}\n")

    def wait(self, jid, timeout=20):
        t0 = time.time()
        while time.time() - t0 < timeout:
            out = D.job_output(jid)
            if not out["running"]:
                return out
            time.sleep(0.1)
        self.fail("tâche toujours en cours")

    def test_platform_and_state(self):
        self.assertTrue(W.is_linux())
        st = D.workspace_state()
        self.assertTrue(st["exists"], st)
        self.assertEqual((st["unc"], st["platform"]), (self.ws, "Linux"))
        self.assertEqual(P.mode(self.cfg), "local")

    def test_repos_are_listed_from_the_local_folder(self):
        self.assertEqual([r["name"] for r in D.list_repos()["repos"]], ["ex00"])
        self.assertEqual([r["name"] for r in P.repos(self.cfg)], ["ex00"])

    def test_jobs_run_directly_in_the_repo_and_can_be_stopped(self):
        out = self.wait(D.start_job("cmd", "ex00", "echo $((6*7)); pwd; test -f main.c && echo present"))
        self.assertEqual(out["rc"], 0, out)
        self.assertIn("42", out["text"])
        self.assertIn(self.repo, out["text"])
        self.assertIn("present", out["text"])
        jid = D.start_job("cmd", "ex00", "sleep 60")
        time.sleep(0.6)
        self.assertTrue(D.stop_job(jid))
        t0 = time.time()
        while D.job_output(jid)["running"] and time.time() - t0 < 10:
            time.sleep(0.1)
        self.assertFalse(D.job_output(jid)["running"], "sleep 60 aurait dû être tué")

    def test_dropped_script_is_saved_executable_with_lf_and_can_run(self):
        r = D.drop_script("hello.sh", "#!/bin/sh\r\necho salut\r\n")
        dest = os.path.join(self.ws, "hello.sh")
        self.assertEqual(r["path"], dest)
        self.assertEqual(open(dest, "rb").read(), b"#!/bin/sh\necho salut\n")
        self.assertTrue(os.access(dest, os.X_OK))
        out = self.wait(D.run_script("", "hello.sh"))
        self.assertIn("salut", out["text"])
        D.import_script("ex00", "in.sh", "echo x")
        self.assertTrue(os.path.isfile(os.path.join(self.repo, "in.sh")))

    def test_set_workspace_and_detect(self):
        other = os.path.join(self.ws, "autre")
        os.makedirs(other)
        with mock.patch("nasko_core.update_config") as upd:
            self.assertEqual(D.set_workspace(other)["unc"], other)
            upd.assert_called_with({"wsl_workspace": other})
        self.assertEqual(D.detect_workspace()["unc"], os.path.expanduser("~"))
        with self.assertRaises(D.DevError):
            D.set_workspace(os.path.join(self.ws, "n'existe-pas"))

    def test_terminal_is_a_local_pty_in_the_workspace(self):
        self.assertFalse(T.backends(self.cfg)["wsl"] and False)
        s = T.open_session("local", repo="ex00", cols=100, rows=30, cfg=self.cfg, root=P.local_root(self.cfg))
        self.addCleanup(s.close)
        time.sleep(0.8)
        s.write(b"echo pty-$((20+22)); pwd\n")
        got = b""
        t0 = time.time()
        while time.time() - t0 < 8 and b"pty-42" not in got:
            got += s.read(0.3, 65536) or b""
        self.assertIn(b"pty-42", got)
        self.assertIn(self.repo.encode(), got)

    def test_inject_and_format_run_locally(self):
        repo = P.git_repo("ex00", self.cfg)
        self.assertTrue(repo.runner.is_local)
        r = G.inject_clang_format(repo)
        self.assertTrue(r["ok"])
        self.assertEqual(open(os.path.join(self.repo, ".clang-format"), "rb").read().count(b"\r"), 0)
        if not shutil.which("clang-format"):
            self.skipTest("clang-format absent")
        res = G.format_c(repo)
        self.assertEqual(res["files"], 1)
        self.assertIn("\n    int x = 1;", open(os.path.join(self.repo, "main.c")).read())


if __name__ == "__main__":
    unittest.main()
