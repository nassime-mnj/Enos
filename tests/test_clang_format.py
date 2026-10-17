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


if __name__ == "__main__":
    unittest.main()
