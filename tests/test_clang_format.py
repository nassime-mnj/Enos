"""Outils clang-format du module Dépôt (injection du .clang-format EPITA, formatage C/H). Les deux branches (local / WSL) sont testées ; WSL est simulé par un
exécuteur « distant » local, donc ces tests demandent `sh`, `cp`, `mktemp`, `find` dans le PATH (Linux, macOS, ou Git Bash sous Windows)."""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nasko_depot_git as G  # noqa: E402

ENV = {"GIT_AUTHOR_NAME": "T", "GIT_AUTHOR_EMAIL": "t@e.org", "GIT_COMMITTER_NAME": "T", "GIT_COMMITTER_EMAIL": "t@e.org", "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
HAVE_SH = all(shutil.which(x) for x in ("sh", "cp", "mktemp", "find", "wc"))


class FakeWsl(G.LocalRunner):
    is_local = False


def rd(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix="nasko_clang_"))
        self.work = os.path.join(self.tmp, "work")
        os.makedirs(self.work)
        e = dict(os.environ, **ENV)
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=self.work, env=e, check=True)
        self.src = os.path.join(self.tmp, "clang-format")             # SANS point, comme dans l'espace WSL
        with open(self.src, "w", encoding="utf-8", newline="\n") as f:
            f.write("BasedOnStyle: LLVM\nIndentWidth: 4\n")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def repo(self, wsl=False):
        return G.GitRepo((FakeWsl if wsl else G.LocalRunner)(ENV), self.work)


class InjectLocal(Base):
    def test_copy_renamed_with_dot(self):
        res = G.inject_clang_format(self.repo(), source=self.src)
        self.assertTrue(res["ok"])
        self.assertFalse(res["replaced"])
        self.assertEqual(os.path.basename(res["path"]), ".clang-format")
        self.assertEqual(rd(os.path.join(self.work, ".clang-format")), "BasedOnStyle: LLVM\nIndentWidth: 4\n")
        self.assertEqual([f for f in os.listdir(self.work) if f.startswith(".nasko-")], [])

    def test_existing_is_overwritten(self):
        with open(os.path.join(self.work, ".clang-format"), "w") as f:
            f.write("vieux\n")
        res = G.inject_clang_format(self.repo(), source=self.src)
        self.assertTrue(res["replaced"])
        self.assertEqual(rd(os.path.join(self.work, ".clang-format")), "BasedOnStyle: LLVM\nIndentWidth: 4\n")

    def test_missing_source_clear_error(self):
        with self.assertRaises(G.GitError) as cm:
            G.inject_clang_format(self.repo(), source=os.path.join(self.tmp, "absent"))
        self.assertIn("introuvable", str(cm.exception))
        self.assertFalse(os.path.exists(os.path.join(self.work, ".clang-format")))

    def test_empty_and_oversized_source(self):
        open(self.src, "w").close()
        with self.assertRaises(G.GitError):
            G.inject_clang_format(self.repo(), source=self.src)
        with open(self.src, "wb") as f:
            f.write(b"x" * (G.MAX_CLANG + 1))
        with self.assertRaises(G.GitError):
            G.inject_clang_format(self.repo(), source=self.src)

    def test_directory_in_the_way(self):
        os.makedirs(os.path.join(self.work, ".clang-format"))
        with self.assertRaises(G.GitError):
            G.inject_clang_format(self.repo(), source=self.src)


@unittest.skipUnless(HAVE_SH, "sh/cp/mktemp/find/wc introuvables dans le PATH")
class InjectWsl(Base):
    def test_copy_overwrite_and_missing(self):
        res = G.inject_clang_format(self.repo(True), source=self.src)
        self.assertTrue(res["ok"])
        self.assertFalse(res["replaced"])
        self.assertEqual(rd(os.path.join(self.work, ".clang-format")), "BasedOnStyle: LLVM\nIndentWidth: 4\n")
        with open(self.src, "w", newline="\n") as f:
            f.write("IndentWidth: 2\n")
        res = G.inject_clang_format(self.repo(True), source=self.src)
        self.assertTrue(res["replaced"])
        self.assertEqual(rd(os.path.join(self.work, ".clang-format")), "IndentWidth: 2\n")
        self.assertEqual([f for f in os.listdir(self.work) if f.startswith(".nasko-")], [])
        with self.assertRaises(G.GitError) as cm:
            G.inject_clang_format(self.repo(True), source=os.path.join(self.tmp, "absent"))
        self.assertIn("introuvable", str(cm.exception))

    def test_directory_in_the_way(self):
        os.makedirs(os.path.join(self.work, ".clang-format"))
        with self.assertRaises(G.GitError):
            G.inject_clang_format(self.repo(True), source=self.src)


class CleanSubfolder(unittest.TestCase):
    def test_accepts(self):
        for raw, exp in (("", []), (None, []), ("  ", []), ("src", ["src"]), ("src/", ["src"]), ("./src/lib/", ["src", "lib"]), ("src\\lib", ["src", "lib"]), ("a-b_c.d/x", ["a-b_c.d", "x"])):
            self.assertEqual(G.clean_subfolder(raw), exp, raw)

    def test_rejects(self):
        for raw in ("..", "../x", "a/../b", "/etc", "C:\\x", "C:/x", "-rf", "a/-b", ".git", "src/.git", "a b", "a;b", "a$(x)", "a`b`", "a\x00b", "a\nb", "x" * 301, 5):
            with self.assertRaises(G.GitError, msg=repr(raw)):
                G.clean_subfolder(raw)


def _fake_clang(dirpath, log):
    """Faux clang-format : consigne les fichiers reçus (un par ligne) et ajoute une ligne au fichier, pour prouver qu'il a bien été « formaté »."""
    p = os.path.join(dirpath, "clang-format")
    with open(p, "w", newline="\n") as f:
        f.write('#!/bin/sh\nfor a in "$@"; do case "$a" in -i|--style=*|--fallback-style=*) ;; *) echo "$a" >> "%s"; echo "// formaté" >> "$a";; esac; done\n' % log.replace("\\", "/"))
    os.chmod(p, 0o755)
    return p


@unittest.skipUnless(HAVE_SH, "sh/cp/mktemp/find/wc introuvables dans le PATH")
class FormatWsl(Base):
    def setUp(self):
        super().setUp()
        self.bin = os.path.join(self.tmp, "bin")
        os.makedirs(self.bin)
        self.log = os.path.join(self.tmp, "calls.log")
        _fake_clang(self.bin, self.log)
        self._path = os.environ["PATH"]
        os.environ["PATH"] = self.bin + os.pathsep + self._path
        self.addCleanup(lambda: os.environ.__setitem__("PATH", self._path))
        for rel in ("main.c", "util.h", "src/a.c", "src/lib/b.h", "src/notes.txt", "src/UP.C", "my dir/c.c", ".git/hooks/x.c"):
            p = os.path.join(self.work, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", newline="\n") as f:
                f.write("int x;\n")
        with open(os.path.join(self.work, ".clang-format"), "w") as f:
            f.write("IndentWidth: 4\n")

    def called(self):
        # le faux clang-format tourne sous sh (chemins style /tmp/… avec Git Bash) : on ne garde que la partie relative au dépôt
        return sorted(l.strip().replace("\\", "/").split("/work/", 1)[1] for l in rd(self.log).splitlines()) if os.path.exists(self.log) else []

    def test_whole_repo_only_c_and_h_not_git(self):
        r = G.format_c(self.repo(True))
        self.assertEqual(r, {"ok": True, "files": 5, "target": "."})
        self.assertEqual(self.called(), ["main.c", "my dir/c.c", "src/a.c", "src/lib/b.h", "util.h"])
        self.assertEqual(rd(os.path.join(self.work, "src", "notes.txt")), "int x;\n")
        self.assertEqual(rd(os.path.join(self.work, ".git", "hooks", "x.c")), "int x;\n")

    def test_subfolder(self):
        r = G.format_c(self.repo(True), "src/")
        self.assertEqual((r["files"], r["target"]), (2, "src"))
        self.assertEqual(self.called(), ["src/a.c", "src/lib/b.h"])
        self.assertEqual(rd(os.path.join(self.work, "main.c")), "int x;\n")

    def test_nested_subfolder(self):
        self.assertEqual(G.format_c(self.repo(True), "src/lib")["files"], 1)
        self.assertEqual(self.called(), ["src/lib/b.h"])

    def test_missing_folder_and_no_files(self):
        with self.assertRaises(G.GitError) as cm:
            G.format_c(self.repo(True), "nope")
        self.assertIn("introuvable", str(cm.exception))
        os.makedirs(os.path.join(self.work, "vide"))
        r = G.format_c(self.repo(True), "vide")
        self.assertEqual(r["files"], 0)
        self.assertEqual(self.called(), [])

    def test_requires_clang_format_file(self):
        os.unlink(os.path.join(self.work, ".clang-format"))
        with self.assertRaises(G.GitError) as cm:
            G.format_c(self.repo(True))
        self.assertIn("INJECTER", str(cm.exception))
        self.assertEqual(self.called(), [])

    def test_clang_format_not_installed(self):
        # Le script quitte avec 90 quand `command -v clang-format` échoue : on simule ce code de sortie (modifier le PATH retirerait aussi git sur un vrai Linux).
        repo = self.repo(True)
        real = repo.runner.run

        def run(args, cwd, **kw):
            if args[:2] == ["sh", "-c"] and "command -v clang-format" in args[2]:
                return 90, "", ""
            return real(args, cwd, **kw)
        repo.runner.run = run
        with self.assertRaises(G.GitError) as cm:
            G.format_c(repo)
        self.assertIn("pas installé", str(cm.exception))
        self.assertIn("apt install clang-format", str(cm.exception))

    def test_symlink_escape_refused(self):
        outside = os.path.join(self.tmp, "outside")
        os.makedirs(outside)
        with open(os.path.join(outside, "z.c"), "w") as f:
            f.write("int z;\n")
        try:
            os.symlink(outside, os.path.join(self.work, "evil"), target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest("liens symboliques indisponibles")
        with self.assertRaises(G.GitError):
            G.format_c(self.repo(True), "evil")
        self.assertEqual(rd(os.path.join(outside, "z.c")), "int z;\n")

    def test_injection_attempt_in_folder_is_rejected_before_any_command(self):
        for bad in ("src; touch PWNED", "$(touch PWNED)", "`touch PWNED`", "src && touch PWNED"):
            with self.assertRaises(G.GitError):
                G.format_c(self.repo(True), bad)
        self.assertFalse(os.path.exists(os.path.join(self.work, "PWNED")))


class mock_path_without:
    """Retire du PATH tout dossier contenant `exe` pendant le test."""
    def __init__(self, exe):
        self.exe = exe

    def __enter__(self):
        self.old = os.environ["PATH"]
        os.environ["PATH"] = os.pathsep.join(d for d in self.old.split(os.pathsep) if not os.path.isfile(os.path.join(d, self.exe)))

    def __exit__(self, *a):
        os.environ["PATH"] = self.old


class FormatLocalGuards(Base):
    def test_no_clang_format_file(self):
        with mock_which(None):
            with self.assertRaises(G.GitError):
                G.format_c(self.repo())
        with mock_which("/x/clang-format"):
            with self.assertRaises(G.GitError) as cm:
                G.format_c(self.repo())
            self.assertIn("INJECTER", str(cm.exception))

    def test_folder_validated_first(self):
        with self.assertRaises(G.GitError):
            G.format_c(self.repo(), "../x")


class mock_which:
    def __init__(self, value):
        self.value = value

    def __enter__(self):
        self.old = G.shutil.which
        G.shutil.which = lambda *_a, **_k: self.value

    def __exit__(self, *a):
        G.shutil.which = self.old


if __name__ == "__main__":
    unittest.main()
