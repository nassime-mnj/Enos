"""Tests du moteur Git + Dépôt Shell (nasko_depot_git). Lancer : python3 tests/test_depot_git.py"""
import os
import shutil
import stat
import re
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nasko_depot_git as G  # noqa: E402

ENV = {"GIT_AUTHOR_NAME": "Test", "GIT_AUTHOR_EMAIL": "t@example.org", "GIT_COMMITTER_NAME": "Test", "GIT_COMMITTER_EMAIL": "t@example.org",
       "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}


class FakeWsl(G.LocalRunner):
    """Se comporte comme un exécuteur distant (is_local faux) pour tester la branche WSL de drop_shell sans WSL."""
    is_local = False


def rd(path, mode="r"):
    with open(path, mode) as f:
        return f.read()


def sh(args, cwd, env=None):
    e = dict(os.environ)
    e.update(ENV)
    return subprocess.run(args, cwd=cwd, env=e, capture_output=True, text=True, check=True).stdout


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix="nasko_git_"))
        self.runner = G.LocalRunner(ENV)
        self.remote = os.path.join(self.tmp, "remote.git")
        sh(["git", "init", "-q", "--bare", "-b", "main", self.remote], self.tmp)
        self.work = os.path.join(self.tmp, "work")
        os.makedirs(self.work)
        sh(["git", "init", "-q", "-b", "main"], self.work)
        sh(["git", "remote", "add", "origin", self.remote], self.work)
        self.repo = G.GitRepo(self.runner, self.work)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write(self, rel, text="x\n", base=None):
        p = os.path.join(base or self.work, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            f.write(text)
        return p

    def first_commit(self):
        self.write("README", "hi\n")
        self.repo.add(["README"])
        self.repo.commit("init")

    def remote_tags(self):
        return [l.split("refs/tags/")[1] for l in sh(["git", "ls-remote", "--tags", self.remote], self.tmp).splitlines() if "^{}" not in l]

    def clone_other(self, name="other"):
        r = G.clone(self.runner, self.remote, self.tmp, name=name, allow_local=True)
        return G.GitRepo(self.runner, r["path"])


class TestStatus(Base):
    def test_empty_repo(self):
        s = self.repo.status()
        self.assertEqual(s["branch"], "main")
        self.assertIsNone(s["last_commit"])
        self.assertTrue(s["clean"])
        self.assertEqual(self.repo.log(), [])
        self.assertEqual(self.repo.branches()["local"], [])

    def test_clean_dirty_detached(self):
        self.first_commit()
        s = self.repo.status()
        self.assertTrue(s["clean"])
        self.assertEqual(s["last_commit"]["subject"], "init")
        self.assertEqual(s["remote_url"], self.remote)
        self.write("a b.txt")
        self.write("README", "changed\n")
        s = self.repo.status()
        self.assertFalse(s["clean"])
        by = {f["path"]: f for f in s["files"]}
        self.assertEqual(by["a b.txt"]["index"], "?")
        self.assertEqual(by["README"]["worktree"], "M")
        sh(["git", "checkout", "-q", "--detach"], self.work)
        s = self.repo.status()
        self.assertTrue(s["detached"])
        self.assertEqual(s["branch"], "")
        import json
        json.dumps(s)

    def test_not_a_repo(self):
        d = os.path.join(self.tmp, "plain")
        os.makedirs(d)
        with self.assertRaises(G.GitError):
            G.GitRepo(self.runner, d).status()


class TestBasics(Base):
    def test_add_commit_push_upstream_pull(self):
        self.first_commit()
        self.assertFalse(self.repo.status()["upstream"])
        r = self.repo.push()
        self.assertTrue(r["upstream_set"])
        s = self.repo.status()
        self.assertEqual(s["upstream"], "origin/main")
        self.assertEqual((s["ahead"], s["behind"]), (0, 0))
        other = self.clone_other()
        self.write("f.txt", "1\n", base=other.path)
        other.add(["f.txt"])
        other.commit("autre")
        other.push()
        self.repo.fetch()
        self.assertEqual(self.repo.status()["behind"], 1)
        r = self.repo.pull()
        self.assertTrue(r["ok"])
        self.assertTrue(os.path.exists(os.path.join(self.work, "f.txt")))
        self.assertEqual(self.repo.log(5)[0]["subject"], "autre")
        self.assertEqual(self.repo.branches()["local"][0]["upstream"], "origin/main")

    def test_pull_conflict(self):
        self.write("c.txt", "base\n")
        self.repo.add(["c.txt"])
        self.repo.commit("base")
        self.repo.push()
        other = self.clone_other()
        self.write("c.txt", "theirs\n", base=other.path)
        other.add(["c.txt"])
        other.commit("theirs")
        other.push()
        self.write("c.txt", "mine\n")
        self.repo.add(["c.txt"])
        self.repo.commit("mine")
        r = self.repo.pull()
        self.assertFalse(r["ok"])
        self.assertTrue(r["conflict"])
        self.assertEqual(r["files"], ["c.txt"])

    def test_commit_rules(self):
        self.first_commit()
        with self.assertRaises(G.GitError):
            self.repo.commit("rien")
        with self.assertRaises(G.GitError):
            self.repo.commit("   ")
        with self.assertRaises(G.GitError):
            self.repo.commit("x" * 2001, allow_empty=True)
        self.assertTrue(self.repo.commit("vide", allow_empty=True)["ok"])
        self.write("m.txt")
        self.repo.add(["m.txt"])
        self.repo.commit("-m $(touch pwned) ; `id`")
        self.assertEqual(self.repo.log(1)[0]["subject"], "-m $(touch pwned) ; `id`")
        self.assertFalse(os.path.exists(os.path.join(self.work, "pwned")))

    def test_log_and_tags_listing(self):
        self.first_commit()
        sh(["git", "tag", "light"], self.work)
        sh(["git", "tag", "-a", "ann", "-m", "msg"], self.work)
        t = {x["name"]: x for x in self.repo.tags()}
        self.assertTrue(t["ann"]["annotated"])
        self.assertEqual(t["ann"]["message"], "msg")
        self.assertFalse(t["light"]["annotated"])
        self.assertEqual(t["light"]["commit"], t["ann"]["commit"])
        self.assertEqual([x["name"] for x in self.repo.tags("ann*")], ["ann"])
        self.assertIn("tag: ann", ",".join(self.repo.log()[0]["refs"]))


class TestSend(Base):
    def test_send_twice(self):
        self.write("ex00/a.c", "int main(){}\n")
        r = self.repo.send("ex00", "premier rendu", "ex00")
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["tag"], "ex00V1")
        self.assertEqual([s["name"] for s in r["steps"]], ["add", "commit", "tag", "push"])
        self.write("ex00/a.c", "int main(){return 0;}\n")
        r = self.repo.send("ex00", "second", "ex00V1")
        self.assertEqual(r["tag"], "ex00V2")
        self.write("ex00/b.c")
        self.assertEqual(self.repo.send("ex00", "troisieme", "ex00")["tag"], "ex00V3")
        self.assertEqual(sorted(self.remote_tags()), ["ex00V1", "ex00V2", "ex00V3"])
        out = sh(["git", "cat-file", "-t", "ex00V1"], self.remote).strip()
        self.assertEqual(out, "tag")                                    # annoté
        self.assertIn("premier rendu", sh(["git", "tag", "-n1", "-l", "ex00V1"], self.work))
        self.assertEqual(self.repo.status()["upstream"], "origin/main")

    def test_nothing_to_send_and_tag_only(self):
        self.first_commit()
        with self.assertRaises(G.GitError):
            self.repo.send(".", "rien", "p")
        r = self.repo.send(".", "tag seul", "p", push=False, allow_empty=True)
        self.assertTrue(r["ok"])
        self.assertEqual(r["tag"], "pV1")
        self.assertEqual(len(self.repo.log()), 1)

    def test_independent_prefixes_and_stale_suffix(self):
        self.write("a/x")
        self.write("b/y")
        self.assertEqual(self.repo.send("a", "a", "ex00")["tag"], "ex00V1")
        self.assertEqual(self.repo.send("b", "b", "rush01")["tag"], "rush01V1")
        self.write("a/x", "2")
        self.assertEqual(self.repo.send("a", "a2", "ex00V7")["tag"], "ex00V2")      # V7 n'existe pas : recalcul sur le max réel
        self.write("a/x", "3")
        sh(["git", "tag", "-a", "ex00V7", "-m", "m"], self.work)
        self.assertEqual(self.repo.next_tag("ex00V7"), "ex00V8")
        self.assertEqual(self.repo.next_tag(""), "V1")

    def test_remote_tags_counted(self):
        self.first_commit()
        self.repo.push()
        other = self.clone_other()
        sh(["git", "tag", "-a", "zV5", "-m", "m"], other.path)
        sh(["git", "push", "-q", "origin", "zV5"], other.path)
        self.assertEqual(self.repo.next_tag("z"), "zV6")                  # vu seulement côté distant

    def test_push_refused_partial_state(self):
        self.write("ex/a")
        sh(["git", "remote", "set-url", "origin", os.path.join(self.tmp, "inexistant.git")], self.work)
        r = self.repo.send("ex", "msg", "ex")
        self.assertFalse(r["ok"])
        self.assertEqual(r["tag"], "exV1")
        self.assertEqual([(s["name"], s["ok"]) for s in r["steps"]], [("add", True), ("commit", True), ("tag", True), ("push", False)])
        self.assertIn("créés localement", r["state"])
        self.assertIn("push refusé", r["state"])
        self.assertTrue(r["commit"]["hash"])
        self.assertEqual([t["name"] for t in self.repo.tags()], ["exV1"])


class TestInjection(Base):
    def test_bad_paths(self):
        self.first_commit()
        bad = ["../x", "-x", "--exec", ":(top)x", ":/", "a\nb", "a\rb", "/etc/passwd", "a/../../x", "", "C:\\x", "--all"]
        for p in bad:
            with self.assertRaises(G.GitError, msg=p):
                self.repo.add([p])
            with self.assertRaises(G.GitError, msg=p):
                self.repo.send(p, "m", "ex")
        self.assertEqual(self.repo.log(), self.repo.log())
        self.assertEqual(len(self.repo.log()), 1)
        self.assertFalse(self.repo.tags())
        self.assertTrue(self.repo.status()["clean"])

    def test_bad_refs(self):
        self.first_commit()
        for n in ["-x", "--exec=touch", "a b", "a\nb", "a..b", "x~1", "", "a:b", "@{-1}", "x@{u}"]:
            with self.assertRaises(G.GitError, msg=repr(n)):
                self.repo.create_branch(n)
            with self.assertRaises(G.GitError, msg=repr(n)):
                self.repo.delete_tag(n)
        for pre in ["-x", "a b", "a\nb", "a..b"]:
            with self.assertRaises(G.GitError, msg=repr(pre)):
                self.repo.next_tag(pre)
        with self.assertRaises(G.GitError):
            self.repo.create_branch("ok", start_point="--exec")
        self.assertEqual([b["name"] for b in self.repo.branches()["local"]], ["main"])

    def test_glob_is_literal(self):
        self.write("a.txt")
        self.write("b.txt")
        with self.assertRaises(G.GitError):            # pathspec littéral : « *.txt » ne correspond à aucun fichier
            self.repo.add(["*.txt"])
        self.assertTrue(all(f["index"] == "?" for f in self.repo.status()["files"]))


class TestBranches(Base):
    def test_create_switch_delete(self):
        self.first_commit()
        self.repo.create_branch("feat")
        self.assertEqual(self.repo.branches()["current"], "feat")
        with self.assertRaises(G.GitError):
            self.repo.delete_branch("feat")
        self.write("f.txt")
        self.repo.add(["f.txt"])
        self.repo.commit("sur feat")
        self.repo.switch("main")
        with self.assertRaises(G.GitError) as c:
            self.repo.delete_branch("feat")
        self.assertIn("force", str(c.exception))
        self.assertTrue(self.repo.delete_branch("feat", force=True)["ok"])
        self.repo.create_branch("b2", switch=False)
        self.assertEqual(self.repo.branches()["current"], "main")
        self.assertTrue(self.repo.delete_branch("b2")["ok"])
        self.repo.create_branch("b3", start_point="main")
        self.assertEqual(self.repo.status()["branch"], "b3")

    def test_merge_ok_and_conflict_abort(self):
        self.write("c.txt", "base\n")
        self.repo.add(["c.txt"])
        self.repo.commit("base")
        self.repo.create_branch("x")
        self.write("c.txt", "x\n")
        self.write("n.txt", "n\n")
        self.repo.add(["c.txt", "n.txt"])
        self.repo.commit("x")
        self.repo.switch("main")
        r = self.repo.merge("x", no_ff=True)
        self.assertTrue(r["ok"])
        self.assertTrue(os.path.exists(os.path.join(self.work, "n.txt")))
        self.repo.create_branch("y", start_point="HEAD~1")
        self.write("c.txt", "y\n")
        self.repo.add(["c.txt"])
        self.repo.commit("y")
        self.repo.switch("main")
        r = self.repo.merge("y")
        self.assertFalse(r["ok"])
        self.assertTrue(r["conflict"])
        self.assertEqual(r["files"], ["c.txt"])
        self.assertTrue(os.path.exists(os.path.join(self.work, ".git", "MERGE_HEAD")))
        self.repo.merge_abort()
        self.assertFalse(os.path.exists(os.path.join(self.work, ".git", "MERGE_HEAD")))
        self.assertTrue(self.repo.status()["clean"])

    def test_delete_tag_local_and_remote(self):
        self.write("e/a")
        self.repo.send("e", "m", "e")
        self.assertEqual(self.remote_tags(), ["eV1"])
        self.repo.delete_tag("eV1")
        self.assertEqual(self.repo.tags(), [])
        self.assertEqual(self.remote_tags(), ["eV1"])
        self.repo.push(tags=True)
        r = self.repo.delete_tag("eV1", remote=True)
        self.assertEqual(r["deleted"], ["distant"])
        self.assertEqual(self.remote_tags(), [])
        with self.assertRaises(G.GitError):
            self.repo.delete_tag("nope")


class TestClone(Base):
    def test_refused_urls(self):
        base = os.path.join(self.tmp, "base")
        for u in ["file:///etc", "ext::sh -c touch% pwned", "/tmp/x", "-x", "--upload-pack=touch x", "http://insecure/x.git", "", "x y", self.remote]:
            with self.assertRaises(G.GitError, msg=u):
                G.clone(self.runner, u, base)
        self.assertFalse(os.path.exists(base))

    def test_clone_local_allowed_and_names(self):
        base = os.path.join(self.tmp, "base")
        r = G.clone(self.runner, self.remote, base, allow_local=True)
        self.assertEqual(r["name"], "remote")
        self.assertTrue(os.path.isdir(os.path.join(r["path"], ".git")))
        with self.assertRaises(G.GitError):
            G.clone(self.runner, self.remote, base, allow_local=True)       # existe déjà
        for n in ["..", "a/b", "../x", "-x", "a b", ""]:
            with self.assertRaises(G.GitError, msg=n):
                G.clone(self.runner, self.remote, base, name=n, allow_local=True)

    def test_cleanup_after_failure(self):
        base = os.path.join(self.tmp, "base")
        with self.assertRaises(G.GitError):
            G.clone(self.runner, os.path.join(self.tmp, "nope.git"), base, name="d", allow_local=True)
        self.assertFalse(os.path.exists(os.path.join(base, "d")))

    def test_clone_argv(self):
        a = G.clone_argv("https://h/x.git", "x")
        self.assertEqual(a[-4:], ["clone", "--", "https://h/x.git", "x"])
        self.assertIn("protocol.ext.allow=never", a)
        self.assertEqual(G.validate_url("git@github.com:u/r.git"), "git@github.com:u/r.git")


class TestDropShell(Base):
    def setUp(self):
        super().setUp()
        self.parent = self.tmp
        self.first_commit()

    def test_root_crlf_exec_not_run(self):
        r = G.drop_shell(self.repo, "go.sh", b"#!/bin/sh\r\ntouch EXECUTED\r\necho hi")
        self.assertTrue(r["ok"])
        self.assertEqual(r["path"], os.path.join(self.work, "go.sh"))
        data = rd(r["path"], "rb")
        self.assertEqual(data, b"#!/bin/sh\ntouch EXECUTED\necho hi\n")
        self.assertEqual(r["bytes"], len(data))
        self.assertTrue(os.stat(r["path"]).st_mode & stat.S_IXUSR)
        self.assertFalse(os.path.exists(os.path.join(self.work, "EXECUTED")))
        self.assertEqual([f for f in os.listdir(self.work) if f.startswith(".nasko-")], [])

    def test_parent_target(self):
        r = G.drop_shell(self.repo, "p.sh", b"echo 1\n", target="parent", executable=False)
        self.assertEqual(r["path"], os.path.join(self.tmp, "p.sh"))
        self.assertFalse(os.stat(r["path"]).st_mode & stat.S_IXUSR)
        self.assertFalse(os.path.exists(os.path.join(self.work, "p.sh")))

    def test_overwrite(self):
        G.drop_shell(self.repo, "o.sh", b"1\n")
        r = G.drop_shell(self.repo, "o.sh", b"2\n")
        self.assertEqual((r["ok"], r["exists"]), (False, True))
        self.assertEqual(rd(os.path.join(self.work, "o.sh")), "1\n")
        self.assertTrue(G.drop_shell(self.repo, "o.sh", b"2\n", overwrite=True)["ok"])
        self.assertEqual(rd(os.path.join(self.work, "o.sh")), "2\n")

    def test_bad_names_content_symlink(self):
        for n in ["../x.sh", "a/b.sh", ".hidden.sh", "x.txt", "x.sh\n", "-x.sh", "a b.sh", "x.sh/", "", "a" * 90 + ".sh", "/etc/x.sh"]:
            with self.assertRaises(G.GitError, msg=n):
                G.drop_shell(self.repo, n, b"echo\n")
        with self.assertRaises(G.GitError):
            G.drop_shell(self.repo, "n.sh", b"a\x00b")
        with self.assertRaises(G.GitError):
            G.drop_shell(self.repo, "n.sh", b"\xff\xfe")
        with self.assertRaises(G.GitError):
            G.drop_shell(self.repo, "n.sh", b"")
        with self.assertRaises(G.GitError):
            G.drop_shell(self.repo, "n.sh", b"a" * (1024 * 1024 + 1))
        self.assertTrue(G.drop_shell(self.repo, "big.sh", b"#" * (1024 * 1024 - 1))["ok"])
        outside = os.path.join(self.tmp, "victim")
        self.write("../victim", "safe")
        os.symlink(outside, os.path.join(self.work, "l.sh"))
        for ow in (False, True):
            with self.assertRaises(G.GitError):
                G.drop_shell(self.repo, "l.sh", b"evil\n", overwrite=ow)
        self.assertEqual(rd(outside), "safe")

    def test_wsl_branch_via_fake_runner(self):
        repo = G.GitRepo(FakeWsl(ENV), self.work)
        repo.runner.is_local = False
        r = G.drop_shell(repo, "w.sh", b"echo a\r\n", target="parent")
        self.assertTrue(r["ok"])
        p = os.path.join(self.tmp, "w.sh")
        self.assertEqual(rd(p, "rb"), b"echo a\n")
        self.assertTrue(os.stat(p).st_mode & stat.S_IXUSR)
        self.assertEqual(G.drop_shell(repo, "w.sh", b"x\n", target="parent")["exists"], True)
        self.assertTrue(G.drop_shell(repo, "w.sh", b"y\n", target="parent", overwrite=True)["ok"])
        os.symlink(os.path.join(self.tmp, "victim"), os.path.join(self.work, "s.sh"))
        with self.assertRaises(G.GitError):
            G.drop_shell(repo, "s.sh", b"x\n")
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "victim")))


class TestWslRunner(unittest.TestCase):
    @staticmethod
    def decode(argv):
        import base64
        m = re.fullmatch(r"bash <\(echo ([A-Za-z0-9+/=]+)\|base64 -d\)", argv[-1])
        assert m, argv[-1]
        return base64.b64decode(m.group(1)).decode()

    def test_argv_pure(self):
        home = tempfile.mkdtemp(); base = os.path.join(home, "Nasko"); os.makedirs(os.path.join(base, "ex00"))
        w = G.WslRunner("Ubuntu", base)                                          # base ABSOLUE ; par défaut : l'espace de travail WSL (nasko_wsl.DIR)
        evil = "a b; $(touch PWNED) `x` \"q\" 'z'"
        a = w.argv(["git", "commit", "-m", evil], "ex00")
        self.assertEqual(a[:6], ["wsl.exe", "-d", "Ubuntu", "--", "bash", "-c"])
        self.assertTrue(re.fullmatch(r"bash <\(echo [A-Za-z0-9+/=]+\|base64 -d\)", a[6]), "commande 100 % alphanumérique")
        body = self.decode(a)
        # le script décodé, exécuté pour de vrai avec printf à la place de git, restitue EXACTEMENT les arguments sans rien interpréter
        out = subprocess.run(["bash", "-c", body.replace("exec git", "exec printf '%s\\n'")], capture_output=True, text=True, env={"HOME": home, "PATH": os.environ["PATH"]}, cwd="/")
        self.assertEqual(out.stdout.split("\n")[:-1], ["commit", "-m", evil], out.stderr)
        self.assertFalse(os.path.exists(os.path.join(home, "Nasko", "ex00", "PWNED")) or os.path.exists("/PWNED"))

    def test_cwd_validation(self):
        w = G.WslRunner("Ubuntu")
        for c in ["../x", "Nasko/../x", "/etc", "a b", "-x", "a;b", "a\nb", ".", "a//b", "Nasko/.", "$HOME"]:
            with self.assertRaises(G.GitError, msg=c):
                w.argv(["git"], c)
        with self.assertRaises(G.GitError):
            G.WslRunner("-d x")
        for bad in ("relatif", "/a/../b", "/a b", "/a;b", "~/x", "$HOME"):
            with self.assertRaises(G.GitError, msg=bad):
                G.WslRunner("Ubuntu", bad)                                       # la base doit être un chemin absolu propre
        self.assertEqual(G.WslRunner("Ubuntu").base, "/home/nasko")              # défaut : l'espace de travail du CEO
        self.assertIn("cd /home/nasko ||", w.script(["git"], ""))               # "" = l'espace de travail lui-même (clone)
        self.assertIn("cd /home/nasko/ex00 ||", w.script(["git"], "ex00"))
        self.assertNotIn("$HOME", w.script(["git"], "ex00"))                      # plus aucune dépendance au dossier personnel de l'utilisateur Linux

    def test_clone_argv_in_wsl(self):
        w = G.WslRunner("Ubuntu")
        body = w.script(G.clone_argv("https://github.com/u/r.git", "r"), "")
        self.assertIn("clone -- https://github.com/u/r.git r", body)


class TestNoSideEffects(Base):
    def test_nothing_written_outside_tmp(self):
        before = set(os.listdir(os.path.dirname(self.tmp)))
        self.first_commit()
        self.write("d/a")
        self.repo.send("d", "m", "t")
        G.drop_shell(self.repo, "z.sh", b"echo\n", target="parent")
        after = set(os.listdir(os.path.dirname(self.tmp)))
        self.assertEqual(before, after)
        self.assertTrue(os.path.exists(os.path.join(self.tmp, "z.sh")))        # le « parent » reste dans le dossier temporaire


if __name__ == "__main__":
    unittest.main(verbosity=1)
