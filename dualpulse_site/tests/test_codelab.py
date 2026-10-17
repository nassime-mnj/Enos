"""Tests d'Enos CodeLab (/launcher/v1/codelab). Lancer :  python3 tests/test_codelab.py   (ou : python3 -m pytest -q tests/test_codelab.py)
Les tests d'isolation du système de fichiers exigent bubblewrap ; ceux d'un langage absent sont ignorés proprement."""
import contextlib
import http.server
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from test_launcher import H, fresh, invited, make_ceo, V, TMP  # noqa: E402  (positionne aussi DP_DB, DP_ADMIN_TOKEN… avant l'import de main)
from app import main  # noqa: E402
from app.codelab import api as codelab_api, runner, sandbox  # noqa: E402
from app.launcher import limits  # noqa: E402

codelab_api.install(main.app)
os.chmod(TMP, 0o711)                                                               # traversable par "nobody" si le serveur de test tourne en root
C = V + "/codelab"
_ctx = {}
LANGS = ("python", "c", "cpp", "java", "sql", "shell")


@contextlib.contextmanager
def env(**kw):
    old = {k: os.environ.get(k) for k in kw}
    try:
        for k, v in kw.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = str(v)
        yield
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def ctx():
    """Client + jeton d'un compte 'friends' (créés une fois) ; compteurs de débit remis à zéro."""
    if "c" not in _ctx:
        c = fresh()
        ceo = make_ceo(c)
        _ctx.update(c=c, tok=invited(c, ceo)["access_token"])
    limits.reset()
    sandbox.set_backend(None)
    return _ctx["c"], _ctx["tok"]


def post(c, tok, lang, code, stdin="", **kw):
    return c.post(C + "/run", json={"language": lang, "code": code, "stdin": stdin}, headers=H(tok), **kw)


def run_ok(lang, code, stdin=""):
    c, tok = ctx()
    r = post(c, tok, lang, code, stdin)
    assert r.status_code == 200, r.text
    return r.json()


def need(lang):
    c, tok = ctx()
    langs = {x["id"]: x for x in c.get(C + "/languages", headers=H(tok)).json()["languages"]}
    if not langs[lang]["available"]:
        raise unittest.SkipTest(lang + " indisponible")
    if not sandbox.detect().usable:
        raise unittest.SkipTest("aucun bac à sable")


def need_bwrap():
    if sandbox.detect().name != "bwrap":
        raise unittest.SkipTest("bubblewrap indisponible")


HELLO = {
    "python": 'print("bonjour")',
    "c": '#include <stdio.h>\nint main(void){puts("bonjour");return 0;}',
    "cpp": '#include <iostream>\nint main(){std::cout<<"bonjour\\n";}',
    "java": 'public class Salut { public static void main(String[] a){ System.out.println("bonjour"); } }',
    "sql": "select 'bonjour' as mot;",
    "shell": "echo bonjour",
}
STDIN = {
    "python": 'print(input().upper())',
    "c": '#include <stdio.h>\nint main(void){char s[64];scanf("%63s",s);printf("%s!\\n",s);return 0;}',
    "cpp": '#include <iostream>\n#include <string>\nint main(){std::string s;std::cin>>s;std::cout<<s<<"!\\n";}',
    "java": 'import java.util.*;\nclass Main{public static void main(String[] a){Scanner s=new Scanner(System.in);System.out.println(s.next()+"!");}}',
    "shell": 'read x; echo "$x!"',
}
PYPROBE = "import os,sys\n"


# ---------------------------------------------------------------- contrat & authentification
def test_auth_required():
    c, tok = ctx()
    assert c.get(C + "/languages").status_code == 401
    assert c.post(C + "/run", json={"language": "python", "code": "print(1)"}).status_code == 401
    assert c.post(C + "/run", json={"language": "python", "code": "print(1)"}, headers=H("faux.jeton.x")).status_code == 401


def test_languages_contract():
    c, tok = ctx()
    r = c.get(C + "/languages", headers=H(tok))
    assert r.status_code == 200
    j = r.json()
    assert {x["id"] for x in j["languages"]} == set(LANGS)
    for x in j["languages"]:
        assert set(x) == {"id", "label", "version", "available"} and isinstance(x["available"], bool) and isinstance(x["label"], str)
    assert set(j["sandbox"]) == {"mode", "strong"} and isinstance(j["sandbox"]["strong"], bool)
    assert j["limits"] == {"timeout_s": 10, "output_bytes": 65536, "code_bytes": 65536, "stdin_bytes": 16384}


def test_run_json_contract():
    need("python")
    j = run_ok("python", 'print("a")')
    assert set(j) == {"ok", "phase", "exit_code", "stdout", "stderr", "timed_out", "truncated", "duration_ms"}
    assert (j["ok"], j["phase"], j["exit_code"], j["stdout"], j["timed_out"], j["truncated"]) == (True, "run", 0, "a\n", False, False)
    assert isinstance(j["duration_ms"], int)


def test_bad_requests_400():
    c, tok = ctx()
    need("python")
    assert post(c, tok, "cobol", "x").status_code == 400
    assert post(c, tok, "python", "   \n").status_code == 400
    assert post(c, tok, "python", "x" * (64 * 1024 + 1)).status_code == 400
    assert post(c, tok, "python", "print(1)", "x" * (16 * 1024 + 1)).status_code == 400
    assert "detail" in post(c, tok, "cobol", "x").json()
    old = runner._tools_present
    runner._tools_present = lambda lid: False if lid == "java" else old(lid)
    try:
        r = post(c, tok, "java", "class A{}")
        assert r.status_code == 400 and "indisponible" in r.json()["detail"]
        assert [x for x in c.get(C + "/languages", headers=H(tok)).json()["languages"] if x["id"] == "java"][0]["available"] is False
    finally:
        runner._tools_present = old


def test_install_is_idempotent():
    n = len(main.app.routes)
    codelab_api.install(main.app)
    codelab_api.install(main.app)
    assert len(main.app.routes) == n
    assert ctx()[0].get(C + "/languages", headers=H(ctx()[1])).status_code == 200


# ---------------------------------------------------------------- langages
def _mk(lang):
    def hello():
        need(lang)
        j = run_ok(lang, HELLO[lang])
        assert j["ok"] and j["exit_code"] == 0 and "bonjour" in j["stdout"], j
    hello.__name__ = "test_hello_" + lang
    return hello


for _l in LANGS:
    globals()["test_hello_" + _l] = _mk(_l)


def _mks(lang):
    def f():
        need(lang)
        j = run_ok(lang, STDIN[lang], "salut\n")
        assert j["ok"] and "salut" in j["stdout"].lower(), j
    f.__name__ = "test_stdin_" + lang
    return f


for _l in STDIN:
    globals()["test_stdin_" + _l] = _mks(_l)


def test_compile_errors_are_clean():
    for lang, code in (("c", "int main(){ return x; }"), ("cpp", "int main(){ undefined_fn(); }"), ("java", "public class Boum { int x = \"s\"; }")):
        need(lang)
        j = run_ok(lang, code)
        assert j["ok"] is False and j["phase"] == "compile" and j["exit_code"] not in (0, None) and j["stderr"].strip(), j
        for bad in ("/tmp", "dpcl_", "/work", str(ROOT)):
            assert bad not in j["stderr"] + j["stdout"], (lang, j["stderr"])


def test_java_class_detection():
    need("java")
    assert runner.java_class("public final class Truc {}") == "Truc"
    assert runner.java_class("class A{} class B{ public static void main(String[] x){} }") == "B"
    assert runner.java_class("x") == "Main"
    j = run_ok("java", "class Zed { public static void main(String[] a){ System.out.println(7); } }")
    assert j["ok"] and j["stdout"] == "7\n", j


def test_runtime_errors():
    cases = {"python": "raise ValueError('oups')", "c": "#include <stdlib.h>\nint main(){ return 3; }", "cpp": "int main(){ return 3; }",
             "java": "class Main{public static void main(String[] a){ throw new IllegalStateException(\"oups\"); }}", "shell": "echo err >&2; exit 3"}
    for lang, code in cases.items():
        need(lang)
        j = run_ok(lang, code)
        assert j["ok"] is False and j["phase"] == "run" and j["exit_code"] not in (0, None) and not j["timed_out"], (lang, j)
    assert "oups" in run_ok("python", cases["python"])["stderr"]
    assert "oups" in run_ok("java", cases["java"])["stderr"]


def test_sql_tables_and_authorizer():
    need("sql")
    j = run_ok("sql", "create table t(a, nom); insert into t values (1,'x;y'),(22,NULL); select * from t order by a; select count(*) as n from t;")
    assert j["ok"], j
    lines = j["stdout"].splitlines()
    assert lines[0].split("|")[0].strip() == "a" and "NULL" in j["stdout"] and "x;y" in j["stdout"] and "(2 lignes)" in j["stdout"] and "n" in j["stdout"], j["stdout"]
    for bad in ("attach database 'x.db' as y;", "select load_extension('x');", "pragma journal_mode=wal;", "pragma writable_schema=1;"):
        r = run_ok("sql", bad)
        assert r["ok"] is False and "Erreur SQL" in r["stderr"], (bad, r)
    r = run_ok("sql", "selec 1;")
    assert r["ok"] is False and r["exit_code"] == 1


# ---------------------------------------------------------------- limites de ressources
def test_infinite_loop_times_out():
    with env(DP_CODELAB_TIMEOUT=2):
        for lang, code in (("python", "while True: pass"), ("c", "int main(){for(;;);}"), ("shell", "while :; do :; done")):
            need(lang)
            t0 = time.time()
            j = run_ok(lang, code)
            assert j["timed_out"] is True and j["ok"] is False and j["exit_code"] is None, (lang, j)
            assert time.time() - t0 < 2 + 3 + (15 if lang == "c" else 0) and j["duration_ms"] < 5500, (lang, time.time() - t0)


def test_sleep_blocking_read_times_out():
    need("python")
    with env(DP_CODELAB_TIMEOUT=1):
        t0 = time.time()
        j = run_ok("python", "import time\nprint('debut', flush=True)\ntime.sleep(60)")
        assert j["timed_out"] and "debut" in j["stdout"] and time.time() - t0 < 4


def test_huge_output_is_truncated_and_memory_bounded():
    import resource
    need("python")
    before = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    t0 = time.time()
    j = run_ok("python", "import sys\nwhile True:\n    sys.stdout.write('x'*100000)\n")
    assert j["truncated"] is True and j["ok"] is False and len(j["stdout"]) <= 65536 and time.time() - t0 < 8, j["duration_ms"]
    j = run_ok("python", "import sys\nwhile True:\n    sys.stderr.write('e'*100000)\n")
    assert j["truncated"] is True and len(j["stderr"]) <= 65536
    assert (resource.getrusage(resource.RUSAGE_SELF).ru_maxrss - before) < 150 * 1024        # Ko : le serveur n'a pas gonflé


def test_memory_hog_is_stopped():
    need("python")
    j = run_ok("python", "x = bytearray(2*1024**3)\nprint('alloue')")
    assert j["ok"] is False and "alloue" not in j["stdout"]


def test_fork_bomb_is_harmless():
    need("python")
    need("shell")
    with env(DP_CODELAB_TIMEOUT=3):
        t0 = time.time()
        j = run_ok("python", "import os\nwhile True:\n    try:\n        os.fork()\n    except OSError:\n        pass\n")
        assert j["ok"] is False and time.time() - t0 < 10
        j = run_ok("shell", ":(){ :|:& };:")
        assert time.time() - t0 < 20
    time.sleep(0.5)
    assert run_ok("python", 'print("vivant")')["stdout"] == "vivant\n"           # le serveur répond encore
    for _ in range(40):                                                            # le démontage d'un espace de noms plein de processus prend un instant
        out = subprocess.run(["ps", "-eo", "stat,comm"], capture_output=True, text=True).stdout
        left = [l for l in out.splitlines()[1:] if l.split()[-1] in ("bwrap", "prog") and not l.startswith("Z")]
        if not left:
            break
        time.sleep(0.25)
    assert not left, left                                                          # aucun résidu vivant du bac à sable

# ---------------------------------------------------------------- isolation
def test_no_network():
    need("python")
    srv = http.server.HTTPServer(("127.0.0.1", 0), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        port = srv.server_address[1]
        code = ("import socket\nfor h,p in (('127.0.0.1',%d),('1.1.1.1',80),('8.8.8.8',53)):\n    s=socket.socket(); s.settimeout(2)\n    try:\n        s.connect((h,p)); print('CONNECTE',h)\n"
                "    except OSError as e: print('refus',h)\n") % port
        with env(DP_CODELAB_TIMEOUT=10):
            j = run_ok("python", code)
        assert "CONNECTE" not in j["stdout"] and j["stdout"].count("refus") == 3, j
        need("shell")
        j = run_ok("shell", "(exec 3<>/dev/tcp/127.0.0.1/%d) 2>/dev/null && echo CONNECTE || echo refus; (command -v curl >/dev/null && curl -s -m 3 http://1.1.1.1 && echo CONNECTE) || echo refus" % port)
        assert "CONNECTE" not in j["stdout"], j
    finally:
        srv.shutdown()


def test_host_files_and_env_invisible():
    need_bwrap()
    need("python")
    os.environ["DP_CODELAB_SECRET_TEST"] = "jeton-secret-xyz"
    try:
        code = (PYPROBE + "import json\nr={}\nr['env']=sorted(os.environ)\nr['secret']=[v for v in os.environ.values() if 'secret-xyz' in v]\n"
                "for p in ('/home','/root','%s','%s','/proc/1/environ','/var','/opt','/srv','/mnt','/run'):\n"
                "    try: r[p]=sorted(os.listdir(p))[:5] if os.path.isdir(p) else open(p,'rb').read(50).decode('latin1')\n    except OSError as e: r[p]='ERR'\n"
                "try: r['passwd']=open('/etc/passwd').read()\nexcept OSError: r['passwd']='ABSENT'\nprint(json.dumps(r))") % (str(ROOT), str(ROOT / "app" / "main.py"))
        j = run_ok("python", code)
        assert j["ok"], j
        r = json.loads(j["stdout"])
        assert not r["secret"] and not [k for k in r["env"] if k.startswith("DP_")] and set(r["env"]) <= {"PATH", "HOME", "TMPDIR", "LANG", "PYTHONIOENCODING", "PWD", "LC_CTYPE"}, r["env"]
        for p in ("/home", "/root", str(ROOT), str(ROOT / "app" / "main.py"), "/var", "/opt", "/srv", "/mnt", "/run"):
            assert r[p] in ("ERR", []), (p, r[p])
        assert r["/proc/1/environ"] == "ERR" or "secret-xyz" not in r["/proc/1/environ"]
        assert r["passwd"] == "ABSENT" or r["passwd"] != Path("/etc/passwd").read_text()
        assert "jeton-secret-xyz" not in j["stdout"].split('"secret"')[1][:40]
    finally:
        os.environ.pop("DP_CODELAB_SECRET_TEST", None)


def test_cannot_write_outside_workdir():
    need_bwrap()
    need("python")
    marker = "dpcl_marker_%d" % os.getpid()
    code = ("import os\nres=[]\nfor p in ('/usr/%s','/etc/%s','/bin/%s','/proc/%s','/%s','%s/%s'):\n    try: open(p,'w').write('x'); res.append('ECRIT '+p)\n    except OSError: res.append('ok')\n"
            "open('/tmp/%s','w').write('x'); open('/work/%s','w').write('x'); print('\\n'.join(res))") % ((marker,) * 4 + (marker, str(ROOT), marker, marker, marker))
    j = run_ok("python", code)
    assert j["ok"] and "ECRIT" not in j["stdout"], j
    for d in ("/usr", "/etc", "/bin", "/", "/tmp", str(ROOT)):
        assert not os.path.exists(os.path.join(d, marker)), d


def test_tmp_dir_removed_after_run_timeout_and_exception():
    base = tempfile.mkdtemp(dir=TMP)
    os.chmod(base, 0o711)                                                           # traversable par 'nobody' (serveur lancé en root)
    with env(DP_CODELAB_TMPDIR=base, DP_CODELAB_TIMEOUT=1):
        need("python")
        run_ok("python", "print(1)")
        assert os.listdir(base) == []
        run_ok("python", "while True: pass")
        assert os.listdir(base) == []
        run_ok("c" if runner.available("c") else "python", "syntax error here (")
        assert os.listdir(base) == []
        try:
            with sandbox.workspace() as d:
                assert oct(os.stat(d).st_mode & 0o777) == "0o700"
                open(os.path.join(d, "f"), "w").write("x")
                raise KeyError("boum")
        except KeyError:
            pass
        assert os.listdir(base) == []


def test_files_not_shared_between_runs():
    need("python")
    run_ok("python", "open('/work/reste.txt','w').write('x'); open('/tmp/reste2.txt','w').write('x')")
    j = run_ok("python", "import os; print(os.path.exists('reste.txt'), os.path.exists('/tmp/reste2.txt'))")
    assert j["stdout"] == "False False\n"


# ---------------------------------------------------------------- débit, concurrence, modes
def test_rate_limit_429():
    need("python")
    c, tok = ctx()
    with env(DP_CODELAB_RATE=3):
        codes = [post(c, tok, "python", "print(1)").status_code for _ in range(5)]
        assert codes == [200, 200, 200, 429, 429], codes
        r = post(c, tok, "python", "print(1)")
        assert r.status_code == 429 and "Trop" in r.json()["detail"]


def test_one_concurrent_run_per_user():
    need("python")
    c, tok = ctx()
    out = {}
    t = threading.Thread(target=lambda: out.setdefault("a", post(c, tok, "python", "import time; time.sleep(2); print('fini')")))
    t.start()
    time.sleep(0.8)
    r = post(c, tok, "python", "print(2)")
    t.join()
    assert r.status_code == 429 and "en cours" in r.json()["detail"], r.text
    assert out["a"].status_code == 200 and out["a"].json()["stdout"] == "fini\n"
    assert post(c, tok, "python", "print(3)").status_code == 200


def test_weak_mode_refused_without_flag():
    c, tok = ctx()
    real = shutil.which
    shutil.which = lambda name, *a, **k: None if name in ("bwrap", "unshare") else real(name, *a, **k)
    try:
        with env(DP_CODELAB_ALLOW_WEAK=None, DP_CODELAB_REMOTE=None):
            sandbox.set_backend(None)
            b = sandbox.detect()
            assert (b.name, b.strong) == ("none", False)
            r = post(c, tok, "python", "print(1)")
            assert r.status_code == 503 and "indisponible" in r.json()["detail"], r.text
            j = c.get(C + "/languages", headers=H(tok)).json()
            assert j["sandbox"] == {"mode": "none", "strong": False}
        with env(DP_CODELAB_ALLOW_WEAK="1", DP_CODELAB_REMOTE=None):
            sandbox.set_backend(None)
            assert (sandbox.detect().name, sandbox.detect().strong) == ("rlimit", False)
            r = post(c, tok, "python", "print('faible')")
            assert r.status_code == 200 and r.json()["stdout"] == "faible\n"
            assert c.get(C + "/languages", headers=H(tok)).json()["sandbox"] == {"mode": "rlimit", "strong": False}
            base = tempfile.mkdtemp(dir=TMP)
            os.chmod(base, 0o711)
            with env(DP_CODELAB_TMPDIR=base, DP_CODELAB_TIMEOUT=1):
                rr = post(c, tok, "python", "while True: pass"); assert rr.json().get("timed_out"), rr.text
                assert os.listdir(base) == []
    finally:
        shutil.which = real
        sandbox.set_backend(None)


# ---------------------------------------------------------------- Piston distant simulé
class _Piston(http.server.BaseHTTPRequestHandler):
    seen = []

    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        _Piston.seen.append((self.path, body))
        src = body["files"][0]["content"]
        if "COMPILE" in src:
            out = {"language": body["language"], "compile": {"stdout": "", "stderr": "main.c:1: error: boum", "code": 1}}
        elif "TIMEOUT" in src:
            out = {"language": body["language"], "run": {"stdout": "", "stderr": "", "code": None, "signal": "SIGKILL"}}
        elif "BIG" in src:
            out = {"language": body["language"], "run": {"stdout": "z" * 200000, "stderr": "", "code": 0, "signal": None}}
        else:
            out = {"language": body["language"], "run": {"stdout": body["stdin"].upper() + "ok\n", "stderr": "", "code": 0, "signal": None}}
        data = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def test_remote_piston():
    c, tok = ctx()
    srv = http.server.HTTPServer(("127.0.0.1", 0), _Piston)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = "http://127.0.0.1:%d" % srv.server_address[1]
    real = shutil.which
    shutil.which = lambda name, *a, **k: None if name in ("bwrap", "unshare") else real(name, *a, **k)
    try:
        with env(DP_CODELAB_REMOTE=url + "/", DP_CODELAB_ALLOW_WEAK=None):
            sandbox.set_backend(None)
            b = sandbox.detect()
            assert (b.name, b.strong, b.remote) == ("remote", True, url)
            j = c.get(C + "/languages", headers=H(tok)).json()
            assert j["sandbox"] == {"mode": "remote", "strong": True} and all(x["available"] for x in j["languages"])
            r = post(c, tok, "cpp", "int main(){}", "abc")
            assert r.status_code == 200, r.text
            assert r.json()["stdout"] == "ABCok\n" and r.json()["ok"] and r.json()["phase"] == "run"
            path, body = _Piston.seen[-1]
            assert path == "/api/v2/execute" and body["language"] == "c++" and body["version"] == "*" and body["stdin"] == "abc" and body["files"] == [{"content": "int main(){}"}]
            j = post(c, tok, "c", "COMPILE").json()
            assert j["ok"] is False and j["phase"] == "compile" and "boum" in j["stderr"]
            j = post(c, tok, "python", "TIMEOUT").json()
            assert j["timed_out"] is True and j["exit_code"] is None and j["ok"] is False
            j = post(c, tok, "python", "BIG").json()
            assert j["truncated"] is True and len(j["stdout"]) == 65536
        srv.shutdown()
        srv.server_close()
        r = post(c, tok, "python", "print(1)") if False else None
        with env(DP_CODELAB_REMOTE=url):
            sandbox.set_backend(None)
            r = post(c, tok, "python", "print(1)")
            assert r.status_code == 503 and "distant" in r.json()["detail"]
    finally:
        shutil.which = real
        sandbox.set_backend(None)
        try:
            srv.shutdown()
        except Exception:
            pass


def test_sandbox_imports_without_resource_module_windows(monkeypatch):
    """Sous Windows `import resource` échoue : le module doit se charger, et ne JAMAIS proposer de backend local (rien ne confinerait le code)."""
    import importlib
    import sys
    from app.codelab import sandbox as real
    monkeypatch.setitem(sys.modules, "resource", None)                      # None : « import resource » lève ImportError
    monkeypatch.setenv("DP_CODELAB_ALLOW_WEAK", "1")
    monkeypatch.delenv("DP_CODELAB_REMOTE", raising=False)
    try:
        sb = importlib.reload(real)
        assert sb.resource is None
        monkeypatch.setattr(sb.shutil, "which", lambda _n: None)            # ni bwrap ni unshare
        b = sb._detect()
        assert b.name == "none" and not b.usable and not b.local
        import pytest
        with pytest.raises(RuntimeError):
            sb.run(["true"], ".", backend=sb.Backend("rlimit", False))
        monkeypatch.setenv("DP_CODELAB_REMOTE", "http://piston.example:2000")  # un backend distant reste possible
        assert sb._detect().name == "remote"
    finally:
        monkeypatch.undo()
        importlib.reload(real)


if __name__ == "__main__":
    import traceback
    bad = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn(); print("OK ", name)
            except unittest.SkipTest as e:
                print("-- ", name, "(ignoré :", e, ")")
            except Exception:
                bad += 1; print("!! ", name); traceback.print_exc()
    print("\nTOUT OK" if not bad else f"\n{bad} ÉCHEC(S)")
    sys.exit(1 if bad else 0)
