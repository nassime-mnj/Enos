"""Tests de nasko_depot_term (vrai pty sous Linux). Lancer : python3 tests/test_depot_term.py"""
import asyncio
import json
import os
import re
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import nasko_depot_term as T  # noqa: E402
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from platform_pin import windows  # noqa: E402

POSIX = os.name == "posix" and os.path.isdir("/proc")


def read_until(s, pattern, timeout=8.0):
    """Lit la sortie jusqu'à ce que le motif (regex bytes) apparaisse ; renvoie (tout, match|None)."""
    end = time.time() + timeout
    buf = b""
    while time.time() < end:
        buf += s.read(0.1)
        m = re.search(pattern, buf)
        if m:
            return buf, m
    return buf, None


def proc_dead(pid):
    try:
        with open("/proc/%d/stat" % pid, "rb") as f:
            return f.read().decode().rsplit(")", 1)[1].split()[0] == "Z"
    except OSError:
        return True


class FakeBackend:
    def __init__(self):
        self.chunks = []
        self.killed = False
        self.closed = False
        self.written = b""
        self.size = None

    def read_chunk(self):
        if self.chunks:
            return self.chunks.pop(0)
        time.sleep(0.01)
        return None if self.killed else b""

    def write(self, d):
        self.written += d

    def resize(self, c, r):
        self.size = (c, r)

    def poll(self):
        return 0 if self.killed else None

    def kill(self):
        self.killed = True

    def close(self):
        self.closed = True


class Base(unittest.TestCase):
    def setUp(self):
        T.close_all()
        T.set_clock(None)
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.realpath(self.tmp.name)
        self._env = dict(os.environ)
        os.environ["SHELL"] = "/bin/bash"

    def tearDown(self):
        T.close_all()
        T.set_clock(None)
        os.environ.clear()
        os.environ.update(self._env)
        self.tmp.cleanup()

    def local(self, repo=None, **kw):
        return T.open_session("local", repo=repo, root=self.root, **kw)


@unittest.skipUnless(POSIX, "pty POSIX requis")
class RealPty(Base):
    def test_echo_and_pwd(self):
        os.mkdir(os.path.join(self.root, "dep"))
        s = self.local("dep")
        self.assertEqual(len(s.id), 32)
        self.assertEqual(s.kind, "local")
        s.write(b"echo $((6*7)); pwd\n")
        out, m = read_until(s, rb"[\r\n]42\r?\n")
        self.assertIsNotNone(m, out)
        self.assertIn((self.root + "/dep").encode(), out + s.read(0.5))

    def test_resize(self):
        s = self.local()
        s.resize(120, 40)
        s.write(b"stty size\n")
        out, m = read_until(s, rb"[\r\n]40 120\r?\n")
        self.assertIsNotNone(m, out)
        s.resize(5000, 1)                       # borné
        self.assertEqual((s.cols, s.rows), (500, 3))
        s.resize(1, 999)
        self.assertEqual((s.cols, s.rows), (10, 200))
        with self.assertRaises(T.TermError):
            s.resize("x", 3)

    def test_ctrl_c(self):
        s = self.local()
        s.write(b"sleep 30\n")
        time.sleep(0.4)
        t0 = time.time()
        s.write(b"\x03")
        time.sleep(0.2)
        s.write(b"echo done$((1+1))\n")
        out, m = read_until(s, rb"[\r\n]done2\r?\n", 6)
        self.assertIsNotNone(m, out)
        self.assertLess(time.time() - t0, 6)
        self.assertTrue(s.alive())

    def test_interactive_program(self):
        s = self.local()
        s.write(b"read -p 'nom? ' x; echo got:$x\n")
        out, m = read_until(s, rb"nom\? ")
        self.assertIsNotNone(m, out)
        s.write(b"Zed\n")
        out, m = read_until(s, rb"got:Zed")
        self.assertIsNotNone(m, out)

    def test_secrets_not_inherited(self):
        os.environ.update({"GROQ_API_KEY": "sekret1", "DP_X": "sekret2", "MY_TOKEN": "sekret3", "NASKO_A": "s4",
                           "ANTHROPIC_API_KEY": "s5", "ELEVENLABS_X": "s6", "DB_PASSWORD": "s7", "VISIBLE_OK": "yes"})
        s = self.local()
        s.write(b"env | grep -c -E 'sekret|^s[4-7]$'; echo V=$VISIBLE_OK T=$TERM\n")
        out, m = read_until(s, rb"V=yes T=xterm-256color")
        self.assertIsNotNone(m, out)
        self.assertRegex(out, rb"[\r\n]0\r?\n")
        self.assertNotIn(b"sekret", out.replace(b"sekret|", b""))

    def test_bad_repo_refused(self):
        os.mkdir(os.path.join(self.root, "ok"))
        for bad in ("../x", "/etc", "", "a/b", "..", "a;b", "$(id)", 'a"b', "x" * 101, ".."+"/..", 5):
            with self.assertRaises(T.TermError, msg=repr(bad)):
                self.local(bad)
        with self.assertRaises(T.TermError):
            self.local("inexistant")

    def test_symlink_escape_and_root(self):
        os.symlink("/tmp", os.path.join(self.root, "lien"))
        with self.assertRaises(T.TermError):
            self.local("lien")
        for bad_root in ("/", os.path.join(self.root, "nope")):
            with self.assertRaises(T.TermError):
                T.open_session("local", root=bad_root)
        s = T.open_session("local", cfg={"depot_local_root": self.root})
        self.assertEqual(s.cwd, self.root)

    def test_close_kills_children_no_leak(self):
        before = set(os.listdir("/proc/self/fd"))
        s = self.local()
        s.write(b"sleep 300 & echo BG$!\n")
        out, m = read_until(s, rb"BG(\d+)")
        self.assertIsNotNone(m, out)
        pid = int(m.group(1))
        self.assertFalse(proc_dead(pid))
        s.close()
        s.close()                               # idempotent
        deadline = time.time() + 3
        while time.time() < deadline and not proc_dead(pid):
            time.sleep(0.05)
        self.assertTrue(proc_dead(pid))
        self.assertFalse(s.alive())
        self.assertIsNotNone(s.exit_code())
        self.assertIsNone(T.get(s.id))
        with self.assertRaises(ChildProcessError):       # plus aucun enfant (zombie) à récolter
            os.waitpid(-1, os.WNOHANG)
        time.sleep(0.2)
        self.assertEqual(set(os.listdir("/proc/self/fd")) - before, set())

    def test_shell_exit_reports_code(self):
        s = self.local()
        s.write(b"exit 3\n")
        end = time.time() + 5
        while s.alive() and time.time() < end:
            time.sleep(0.05)
        self.assertFalse(s.alive())
        self.assertEqual(s.exit_code(), 3)

    def test_pipe_backend(self):
        s = T.open_session("local", root=self.root, spawn=lambda a, c, e, co, ro: T.PipeBackend(["cat"], c, e, co, ro))
        s.write(b"abc\n")
        out, m = read_until(s, rb"abc\n")
        self.assertIsNotNone(m, out)
        s.close()

    def test_pump(self):
        s = self.local()

        async def run():
            q = asyncio.Queue()
            sent = []

            async def send(x):
                sent.append(x)

            async def receive():
                return await q.get()
            await q.put(json.dumps({"t": "resize", "cols": 90, "rows": 20}))
            await q.put(b"stty size; echo hi$((1+1))\n")
            await q.put(b"exit 0\n")
            await asyncio.wait_for(T.pump(send, receive, s), 15)
            return sent
        sent = asyncio.run(run())
        data = b"".join(x for x in sent if isinstance(x, bytes))
        self.assertIn(b"hi2", data)
        self.assertIn(b"20 90", data)
        self.assertEqual(json.loads(sent[-1]), {"t": "exit", "code": 0})
        self.assertIsNone(T.get(s.id))


@windows
class Logic(Base):
    def fake(self, store=None):
        def spawn(argv, cwd, env, cols, rows):
            b = FakeBackend()
            if store is not None:
                store.append((argv, cwd, env, cols, rows, b))
            return b
        return spawn

    def test_max_sessions(self):
        sp = self.fake()
        ss = [T.open_session("local", root=self.root, spawn=sp) for _ in range(4)]
        with self.assertRaises(T.TermError):
            T.open_session("local", root=self.root, spawn=sp)
        self.assertEqual(len(T.list_sessions()), 4)
        T.close(ss[0].id)
        T.open_session("local", root=self.root, spawn=sp)         # une place s'est libérée
        self.assertEqual(len({s.id for s in ss}), 4)

    def test_idle_expiry(self):
        now = [1000.0]
        T.set_clock(lambda: now[0])
        s = T.open_session("local", root=self.root, spawn=self.fake())
        now[0] += T.IDLE_TTL - 5
        self.assertIs(T.get(s.id), s)
        s.write(b"x")                                             # l'activité repousse l'expiration
        now[0] += T.IDLE_TTL - 5
        self.assertIs(T.get(s.id), s)
        now[0] += 10
        self.assertIsNone(T.get(s.id))
        self.assertFalse(s.alive())
        self.assertTrue(s._b.killed and s._b.closed)

    def test_bounded_buffer(self):
        b = FakeBackend()
        b.chunks = [b"a" * 100000 for _ in range(30)]             # 3 Mo
        s = T.Session(b, "local", "/", 80, 24)
        end = time.time() + 5
        while b.chunks and time.time() < end:
            time.sleep(0.01)
        time.sleep(0.1)
        self.assertLessEqual(s.pending(), T.BUF_MAX)
        self.assertGreater(s.dropped, 0)
        self.assertEqual(s.pending() + s.dropped, 3000000)
        self.assertEqual(len(s.read(0, 1000)), 1000)
        s.close()

    def test_write_capped_and_resize_forwarded(self):
        store = []
        s = T.open_session("local", root=self.root, spawn=self.fake(store))
        s.write(b"y" * 200000)
        self.assertEqual(len(store[0][5].written), T.MAX_MSG)
        s.resize(100, 50)
        self.assertEqual(store[0][5].size, (100, 50))

    def test_open_wsl_uses_argv_and_clean_env(self):
        os.environ["GROQ_API_KEY"] = "zzz"
        store = []
        s = T.open_session("wsl", repo="mon-depot", cfg={"wsl_distro": "Debian"}, spawn=self.fake(store))
        argv, cwd, env, cols, rows, _ = store[0]
        self.assertEqual(argv, ["wsl.exe", "-d", "Ubuntu", "--cd", "/home/nasko/mon-depot"])      # distribution et dossier imposés : « wsl_distro » n'a plus d'effet
        self.assertIsNone(cwd)
        self.assertNotIn("GROQ_API_KEY", env)
        self.assertEqual(s.cwd, "\\\\wsl.localhost\\Ubuntu\\home\\nasko\\mon-depot")
        for bad in ("../x", "a;b", ""):
            with self.assertRaises(T.TermError):
                T.open_session("wsl", repo=bad, spawn=self.fake())
        evil = []
        T.open_session("wsl", cfg={"wsl_distro": "x;rm -rf /"}, spawn=self.fake(evil))             # la configuration ne peut pas rediriger le terminal
        self.assertEqual(evil[0][0], ["wsl.exe", "-d", "Ubuntu", "--cd", "/home/nasko"])

    @unittest.skipIf(os.name == "nt", "pas de WSL réel ici")
    def test_wsl_unavailable_here(self):
        self.assertFalse(T.backends()["wsl"])
        with self.assertRaises(T.TermError):
            T.open_session("wsl")

    def test_backends_shape(self):
        b = T.backends()
        self.assertEqual(set(b), {"wsl", "local", "pty", "distro"})
        self.assertIn(b["pty"], ("posix", "conpty", "pipe"))
        if POSIX:
            self.assertTrue(b["local"])
            self.assertEqual(b["pty"], "posix")


class Pure(unittest.TestCase):
    @windows
    def test_wsl_argv(self):
        self.assertEqual(T.wsl_argv("Ubuntu", "r"), ["wsl.exe", "-d", "Ubuntu", "--cd", "/home/nasko/r"])
        self.assertEqual(T.wsl_argv("Ubuntu"), ["wsl.exe", "-d", "Ubuntu", "--cd", "/home/nasko"])
        self.assertEqual(T.wsl_argv("Ubuntu", "r", pipe=True)[-3:], ["--", "bash", "-i"])
        for d in ("", "-x", "a b", "a;b", "$(x)", "x" * 65, None):
            with self.assertRaises(T.TermError):
                T.wsl_argv(d, "r")
        for r in ('a"b', "a;b", "$(id)", "`id`", "a b", "../x", "/abs", "a&b", "a|b", "", "x\ny"):
            with self.assertRaises(T.TermError, msg=repr(r)):
                T.wsl_argv("Ubuntu", r)
        self.assertEqual(len(T.wsl_argv("Ubuntu", "ok.repo_1-2")), 5)    # structure inchangée

    def test_parse_client_message(self):
        p = T.parse_client_message
        self.assertEqual(p(b"ls\r"), ("input", b"ls\r"))
        self.assertEqual(p(b""), ("ignore",))
        self.assertEqual(p(b"x" * T.MAX_MSG), ("input", b"x" * T.MAX_MSG))
        self.assertEqual(p(b"x" * (T.MAX_MSG + 1)), ("ignore",))
        self.assertEqual(p(json.dumps({"t": "resize", "cols": 120, "rows": 40})), ("resize", 120, 40))
        for bad in ({"t": "resize", "cols": 5, "rows": 40}, {"t": "resize", "cols": 120, "rows": 2},
                    {"t": "resize", "cols": 501, "rows": 40}, {"t": "resize", "cols": 80, "rows": 201},
                    {"t": "resize", "cols": "80", "rows": 24}, {"t": "resize", "cols": True, "rows": 24},
                    {"t": "resize", "cols": 80.5, "rows": 24}, {"t": "resize"}, {"t": "autre"}, [1], 5):
            self.assertEqual(p(json.dumps(bad)), ("ignore",), bad)
        self.assertEqual(p("pas du json"), ("ignore",))
        self.assertEqual(p("x" * (T.MAX_MSG + 1)), ("ignore",))
        self.assertEqual(p(None), ("ignore",))

    def test_sanitized_env(self):
        e = T.sanitized_env({"A": "1", "x_token": "t", "PATH": "/bin", "DP_Z": "1", "NASKO_Q": "1", "ELEVENLABS_ID": "1",
                             "GROQ_API_KEY": "k", "My_Secret": "s", "PASSWORD": "p", "TERM": "dumb"})
        self.assertEqual(e, {"A": "1", "PATH": "/bin", "TERM": "xterm-256color", "COLORTERM": "truecolor"})


if __name__ == "__main__":
    unittest.main(verbosity=1)
