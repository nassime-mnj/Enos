"""Espace de travail WSL du CEO : \\\\wsl.localhost\\Ubuntu\\home\\nasko (règle absolue, nasko_wsl.py).
  1. tout `git clone` lancé depuis Enos atterrit dans ce dossier ;
  2. tout .sh glissé dans la zone de dépôt y est enregistré (LF, exécutable), prêt à être lancé côté Linux.
WSL n'existe pas ici : un faux `wsl.exe` exécute VRAIMENT les scripts bash dans un dossier temporaire à la place de /home/nasko. Lancer : python3 tests/test_wsl_workspace.py"""
import os, shlex, stat, subprocess, sys, tempfile, unittest
from pathlib import Path
from unittest import mock
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import nasko_wsl as W  # noqa: E402
import nasko_devmanager as D  # noqa: E402
import nasko_depot_git as G  # noqa: E402
import nasko_depot_term as T  # noqa: E402
import release_editions  # noqa: E402

UNC = "\\\\wsl.localhost\\Ubuntu\\home\\nasko"


class Workspace(unittest.TestCase):
    def setUp(self):
        self.ws = tempfile.mkdtemp(prefix="nasko_ws_")
        self.calls = []

        def fake_wsl_raw(d, script, *args, timeout=60, data=None):
            self.calls.append(d)
            body = "set -- " + " ".join(shlex.quote(str(a)) for a in args) + "\n" + script.replace(W.DIR, self.ws)
            p = subprocess.run(["bash", "-c", body], capture_output=True, input=data, stdin=None if data is not None else subprocess.DEVNULL, cwd="/")
            return p.returncode, p.stdout, p.stderr.decode("utf-8", "replace").strip()

        self.patch = mock.patch.object(D, "_wsl_raw", fake_wsl_raw)
        self.patch.start()
        self.jobs = []
        self.patch_job = mock.patch.object(D, "start_job", lambda kind, repo, cmd, cfg=None: self.jobs.append((kind, repo, cmd)) or "job1")
        self.patch_job.start()

    def tearDown(self):
        self.patch.stop(); self.patch_job.stop()

    # ------------------------------------------------------------------ la règle
    def test_constants_are_the_ceo_workspace(self):
        self.assertEqual(W.WORKSPACE_UNC, UNC)
        self.assertEqual((W.DISTRO, W.DIR), ("Ubuntu", "/home/nasko"))
        self.assertEqual(W.unc_path("a.sh"), UNC + "\\a.sh"); self.assertEqual(W.linux_path("r", "x"), "/home/nasko/r/x")
        for bad in ("..", ".", "a/b", "", "a b", "-x;", "é"):
            with self.assertRaises(ValueError, msg=bad):
                W.linux_path(bad)
        self.assertEqual(W.parse_unc("\\\\wsl$\\Debian\\home\\u"), ("Debian", "/home/u"))
        for bad in ("C:\\x", "\\\\wsl.localhost\\Ubuntu", "\\\\wsl.localhost\\Ubuntu\\..\\x", "/home/nasko", ""):
            with self.assertRaises(ValueError, msg=bad):
                W.parse_unc(bad)

    def test_config_cannot_redirect_the_workspace(self):
        self.assertEqual(D.distro({"wsl_distro": "Debian"}), "Ubuntu")
        self.assertEqual(D.status({})["workspace"], UNC)
        self.assertEqual(T._distro({"wsl_distro": "x;rm -rf /"}), "Ubuntu")
        self.assertIn("B=/home/nasko;", D.BSET)

    def test_no_leftover_of_the_old_base_in_wsl_code(self):
        for f in ("nasko_devmanager.py", "nasko_depot_git.py", "nasko_depot_term.py"):
            self.assertNotIn("Nasko", (ROOT / f).read_text(encoding="utf-8").replace("nasko_wsl", ""), f)

    # ------------------------------------------------------------------ 1. git clone -> espace de travail
    def test_every_clone_lands_in_the_workspace(self):
        for text, name in (("owner/repo", "repo"), ("https://github.com/a/b.git", "b"), ("git@github.com:o/r.git", "r"), ("ssh://git@host/x/y", "y")):
            self.jobs.clear()
            _, got = D.clone(text)
            kind, repo, cmd = self.jobs[0]
            self.assertEqual((kind, got, repo), ("clone", name, ""))
            self.assertTrue(cmd.endswith(" /home/nasko/" + name), cmd)                  # destination ABSOLUE : indépendante du dossier courant
            self.assertIn("git clone --progress --", cmd)
        for bad in ("https://github.com/a/..", "https://github.com/a/.", "nom-seul", "https://x/y;rm -rf /", "-evil"):
            with self.assertRaises(D.DevError, msg=bad):
                D.clone(bad)

    def test_jobs_without_repo_start_in_the_workspace(self):
        os.makedirs(os.path.join(self.ws, "r"))
        script = D.WRAP.replace(W.DIR, self.ws)
        for repo, want in (("", self.ws), ("r", os.path.join(self.ws, "r"))):
            pidf = os.path.join(self.ws, ".pid")
            out = subprocess.run(["bash", "-c", "set -- " + " ".join(shlex.quote(x) for x in (pidf, repo, "pwd")) + "\n" + script], capture_output=True, text=True).stdout.strip()
            self.assertEqual(out, want)
        missing = subprocess.run(["bash", "-c", D.BSET.replace(W.DIR, self.ws + "/absent") + "echo ok"], capture_output=True, text=True)
        self.assertEqual(missing.returncode, 99)
        self.assertIn(UNC, missing.stderr)                                              # message explicite, aucun repli sur un autre dossier
        self.assertFalse(os.path.exists(self.ws + "/absent"), "rien n'est créé")

    def test_repo_list_is_the_workspace(self):
        for d, git in (("proj", True), ("notes", False), (".cache", True)):
            os.makedirs(os.path.join(self.ws, d, ".git" if git else ""), exist_ok=True)
        r = D.list_repos({})
        self.assertEqual((r["distro"], r["base"]), ("Ubuntu", UNC))
        self.assertEqual([x["name"] for x in r["repos"]], ["proj"], "seuls les dossiers Git de l'espace de travail")

    def test_missing_workspace_is_reported_not_replaced(self):
        os.rmdir(self.ws)
        with self.assertRaises(D.DevError) as e:
            D.list_repos({})
        self.assertIn(UNC, str(e.exception))

    def test_depot_module_uses_the_same_base(self):
        self.assertEqual(G.WslRunner("Ubuntu").base, W.DIR)
        self.assertIn("cd /home/nasko/r ||", G.WslRunner("Ubuntu").script(["git"], "r"))

    # ------------------------------------------------------------------ 2. zone de dépôt .sh -> espace de travail
    def test_dropped_script_is_saved_executable_with_lf(self):
        raw = "\ufeff#!/usr/bin/env bash\r\necho bonjour\r\nexit 3\r\n"
        r = D.drop_script("hello.sh", raw)
        p = Path(self.ws) / "hello.sh"
        self.assertEqual((r["name"], r["path"], r["linux"], r["executable"]), ("hello.sh", UNC + "\\hello.sh", "/home/nasko/hello.sh", True))
        data = p.read_bytes()
        self.assertEqual(data, b"#!/usr/bin/env bash\necho bonjour\nexit 3\n")        # LF, BOM retiré (sinon le shebang casse)
        self.assertTrue(p.stat().st_mode & stat.S_IXUSR, "chmod +x")
        self.assertEqual(r["bytes"], len(data))
        run = subprocess.run([str(p)], capture_output=True, text=True, cwd=self.ws)     # « prêt à être exécuté côté Linux »
        self.assertEqual((run.returncode, run.stdout), (3, "bonjour\n"))
        self.assertEqual([x.name for x in Path(self.ws).iterdir()], ["hello.sh"], "aucun fichier temporaire laissé")

    def test_drop_never_goes_to_a_repo_and_never_overwrites_silently(self):
        os.makedirs(os.path.join(self.ws, "proj", ".git"))
        D.drop_script("a.sh", "echo 1\n")
        self.assertFalse((Path(self.ws) / "proj" / "a.sh").exists())
        with self.assertRaises(D.DevError) as e:
            D.drop_script("a.sh", "echo 2\n")
        self.assertEqual(str(e.exception), "exists")                                    # l'interface propose REMPLACER (HTTP 409)
        self.assertEqual((Path(self.ws) / "a.sh").read_text(), "echo 1\n")
        D.drop_script("a.sh", "echo 2\n", overwrite=True)
        self.assertEqual((Path(self.ws) / "a.sh").read_text(), "echo 2\n")

    def test_drop_rejects_bad_names_and_content(self):
        for bad in ("../x.sh", "x.txt", "-x.sh", "a b.sh", ".sh", "a/b.sh", "a\\b.sh", "x.sh;rm", "", None):
            with self.assertRaises(D.DevError, msg=repr(bad)):
                D.drop_script(bad, "echo\n")
        for content in ("", "x" * (D.MAX_IMPORT + 1), "a\x00b"):
            with self.assertRaises(D.DevError):
                D.drop_script("ok.sh", content)
        self.assertEqual(list(Path(self.ws).iterdir()), [])

    def test_drop_does_not_follow_symlinks_or_enter_directories(self):
        outside = Path(tempfile.mkdtemp()) / "victim"; outside.write_text("intact")
        os.symlink(outside, os.path.join(self.ws, "link.sh"))
        D.drop_script("link.sh", "echo pwned\n", overwrite=True)
        self.assertEqual(outside.read_text(), "intact")                                 # le lien est remplacé, jamais suivi
        self.assertFalse((Path(self.ws) / "link.sh").is_symlink())
        os.makedirs(os.path.join(self.ws, "dir.sh"))
        with self.assertRaises(D.DevError):
            D.drop_script("dir.sh", "echo\n", overwrite=True)
        self.assertEqual(list((Path(self.ws) / "dir.sh").iterdir()), [], "rien n'est déposé dans un dossier homonyme")

    def test_dropped_script_can_be_run_from_the_workspace(self):
        D.drop_script("go.sh", "echo ici=$(pwd)\n")
        D.run_script("", "go.sh", "")
        kind, repo, cmd = self.jobs[-1]
        self.assertEqual((kind, repo), ("script", ""))                                  # tâche lancée dans l'espace de travail (repo vide)
        out = subprocess.run(["bash", "-c", cmd], capture_output=True, text=True, cwd=self.ws)
        self.assertEqual(out.stdout.strip(), "ici=" + self.ws)

    def test_repo_import_is_atomic_and_still_available(self):
        os.makedirs(os.path.join(self.ws, "proj"))
        self.assertTrue(D.import_script("proj", "x.sh", "echo\r\n"))
        self.assertTrue(os.access(os.path.join(self.ws, "proj", "x.sh"), os.X_OK))
        with self.assertRaises(D.DevError):
            D.import_script("absent", "x.sh", "echo\n")
        with self.assertRaises(D.DevError):
            D.import_script("../etc", "x.sh", "echo\n")

    # ------------------------------------------------------------------ édition Friends
    def test_workspace_module_is_withheld_from_friends(self):
        self.assertIn("nasko_wsl", release_editions.PY_MODULES["devtools"])
        self.assertIn("devtools", release_editions.EXCLUDED_CAPS["friends"])


if __name__ == "__main__":
    unittest.main()
