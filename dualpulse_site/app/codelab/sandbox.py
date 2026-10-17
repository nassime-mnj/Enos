"""Bac à sable bas niveau : détection des backends (bwrap > unshare > Piston distant > rlimit seul refusé par défaut) et exécution d'un processus
confiné (répertoire de travail 0700 jetable, rlimits, groupe de processus tué au timeout, sortie plafonnée lue en flux)."""
import contextlib
import os
import shutil
import signal
import stat
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass, field

try:
    import resource
except ImportError:        # Windows : pas de module « resource » (rlimit, exclusif Unix). Le bac à sable local reste alors indisponible (voir _detect) ; seul un backend distant sert.
    resource = None

SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
OUTPUT_BYTES = 64 * 1024
WORK = "/work"          # point de montage du répertoire de travail dans bwrap


def _int_env(name, default, lo, hi):
    try:
        v = int(os.environ.get(name, default))
    except (TypeError, ValueError):
        v = default
    return max(lo, min(hi, v))


def timeout_s():
    return _int_env("DP_CODELAB_TIMEOUT", 10, 1, 30)


def compile_timeout_s():
    return _int_env("DP_CODELAB_COMPILE_TIMEOUT", 15, 1, 60)


@dataclass
class Backend:
    name: str                       # bwrap | unshare | remote | rlimit | none
    strong: bool
    prefix: list = field(default_factory=list)   # préfixe de commande (bwrap/unshare)
    remote: str = ""

    @property
    def local(self):
        return self.name in ("bwrap", "unshare", "rlimit")

    @property
    def usable(self):
        return self.name != "none"


@dataclass
class Result:
    exit_code: object = None
    stdout: str = ""
    stderr: str = ""
    timed_out: bool = False
    truncated: bool = False
    duration_ms: int = 0


# ----------------------------------------------------------------------------- répertoire de travail
def tmp_base():
    return os.environ.get("DP_CODELAB_TMPDIR") or tempfile.gettempdir()


def _rmtree(path):
    def onerr(func, p, _exc):
        try:
            os.chmod(os.path.dirname(p), 0o700)
            os.chmod(p, stat.S_IRWXU)
            func(p)
        except OSError:
            pass
    shutil.rmtree(path, onerror=onerr)


@contextlib.contextmanager
def workspace():
    """Répertoire unique 0700, supprimé quoi qu'il arrive (exception, timeout)."""
    d = tempfile.mkdtemp(prefix="dpcl_", dir=tmp_base())
    os.chmod(d, 0o700)
    try:
        yield d
    finally:
        _rmtree(d)


# ----------------------------------------------------------------------------- construction des commandes
def _bwrap_binds():
    a = []
    for p in ("/bin", "/sbin", "/lib", "/lib32", "/lib64"):
        if os.path.islink(p):
            a += ["--symlink", os.readlink(p), p]
        elif os.path.isdir(p):
            a += ["--ro-bind", p, p]
    a += ["--ro-bind", "/usr", "/usr"]
    for p in ("/etc/alternatives", "/etc/ld.so.cache", "/etc/ld.so.conf", "/etc/ld.so.conf.d", "/etc/localtime"):
        if os.path.exists(p):
            a += ["--ro-bind", p, p]
    for p in sorted(os.listdir("/etc")) if os.path.isdir("/etc") else []:
        if p.startswith("java-"):
            a += ["--ro-bind", "/etc/" + p, "/etc/" + p]
    return a


def _bwrap_prefix(strict=True):
    a = ["bwrap", "--unshare-all", "--die-with-parent", "--new-session"]
    if strict:
        a += ["--cap-drop", "ALL", "--uid", "65534", "--gid", "65534"]
    a += _bwrap_binds()
    a += ["--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--dir", WORK, "--remount-ro", "/"]
    return a


def _probe(cmd, timeout=8):
    try:
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout, env={"PATH": SAFE_PATH})
        return p.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def _probe_bwrap(prefix):
    with workspace() as d:
        return _probe(prefix + ["--bind", d, WORK, "--chdir", WORK, "--clearenv", "--setenv", "PATH", SAFE_PATH, "--", "true"])


_cache = {"backend": None}
_lock = threading.Lock()


def detect(force=False):
    """Détecte (une fois, puis cache) le meilleur backend. Ne retourne jamais 'rlimit' sans DP_CODELAB_ALLOW_WEAK=1."""
    with _lock:
        if _cache["backend"] is not None and not force:
            return _cache["backend"]
        b = _detect()
        _cache["backend"] = b
        return b


def set_backend(b):
    """Injection (tests) ; None = oublier le cache."""
    with _lock:
        _cache["backend"] = b


def _detect():
    if shutil.which("bwrap"):
        for strict in (True, False):
            pre = _bwrap_prefix(strict)
            if _probe_bwrap(pre):
                return Backend("bwrap", True, pre)
    if shutil.which("unshare"):
        for pre in (["unshare", "-r", "-n", "-m", "-p", "-f", "--mount-proc", "--kill-child", "--"],
                    ["unshare", "-r", "-n", "-m", "-p", "-f", "--mount-proc", "--"]):
            if _probe(pre + ["true"]):
                return Backend("unshare", True, pre)
    remote = os.environ.get("DP_CODELAB_REMOTE", "").strip().rstrip("/")
    if remote:
        return Backend("remote", True, remote=remote)
    if os.environ.get("DP_CODELAB_ALLOW_WEAK") == "1" and resource is not None:     # sans rlimit (Windows), rien ne confine le code : jamais de repli local
        return Backend("rlimit", False)
    return Backend("none", False)


def describe(b=None):
    b = b or detect()
    return {"mode": b.name, "strong": bool(b.strong)}


# ----------------------------------------------------------------------------- exécution
NOBODY = 65534


def _drop_root():
    return hasattr(os, "geteuid") and os.geteuid() == 0 and os.environ.get("DP_CODELAB_KEEP_ROOT") != "1"


def _limits(cpu_s, mem_mb, nproc, drop=False):
    def apply():
        def lim(r, v):
            try:
                resource.setrlimit(r, (v, v))
            except (ValueError, OSError):
                pass
        lim(resource.RLIMIT_CORE, 0)
        lim(resource.RLIMIT_CPU, cpu_s)
        lim(resource.RLIMIT_AS, mem_mb * 1024 * 1024)
        lim(resource.RLIMIT_FSIZE, 5 * 1024 * 1024)
        lim(resource.RLIMIT_NOFILE, 64)
        lim(resource.RLIMIT_NPROC, nproc)
        if drop:        # serveur lancé en root : RLIMIT_NPROC ne s'applique pas à root, on passe donc en 'nobody' avant exec
            os.setgroups([])
            os.setgid(NOBODY)
            os.setuid(NOBODY)
    return apply


def _kill_group(proc):
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def run(argv, workdir, *, stdin=b"", timeout=None, mem_mb=512, env=None, backend=None, out_cap=OUTPUT_BYTES, nproc=None):
    """Exécute argv dans le bac à sable avec workdir comme répertoire courant. Lève RuntimeError si le backend n'est pas local/utilisable."""
    b = backend or detect()
    if not b.local:
        raise RuntimeError("backend non local : " + b.name)
    if resource is None:                      # garde-fou : Windows n'a ni rlimit, ni preexec_fn, ni groupes de processus POSIX
        raise RuntimeError("bac à sable local indisponible sur ce système (Linux requis)")
    timeout = timeout or timeout_s()
    nproc = nproc or _int_env("DP_CODELAB_NPROC", 512, 16, 100000)
    inside = WORK if b.name == "bwrap" else workdir
    e = {"PATH": SAFE_PATH, "HOME": inside, "TMPDIR": "/tmp" if b.name == "bwrap" else workdir, "LANG": "C.UTF-8"}
    e.update(env or {})
    if b.name == "bwrap":
        cmd = list(b.prefix) + ["--bind", workdir, WORK, "--chdir", WORK, "--clearenv"]
        for k, v in e.items():
            cmd += ["--setenv", k, v]
        cmd += ["--"] + list(argv)
        penv = {"PATH": SAFE_PATH}
    else:
        cmd = list(b.prefix) + list(argv)
        penv = e
    drop = _drop_root()
    if drop:
        os.chown(workdir, NOBODY, NOBODY)
    t0 = time.monotonic()
    res = Result()
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=workdir, env=penv, bufsize=0,
                            start_new_session=True, close_fds=True, preexec_fn=_limits(int(timeout) + 1, mem_mb, nproc, drop))
    bufs = {"out": [], "err": []}
    over = threading.Event()

    def pump(f, key):
        total = 0
        fd = f.fileno()
        while True:
            try:
                data = os.read(fd, 65536)
            except OSError:
                break
            if not data:
                break
            if total < out_cap:
                bufs[key].append(data[:out_cap - total])
            total += len(data)
            if total > out_cap:        # flot dépassant le plafond : on tue tout le groupe (pas de mémoire ni de CPU gaspillés)
                over.set()
                _kill_group(proc)
                break

    def feed():
        try:
            if stdin:
                proc.stdin.write(stdin)
        except (BrokenPipeError, OSError):
            pass
        finally:
            try:
                proc.stdin.close()
            except OSError:
                pass

    threads = [threading.Thread(target=pump, args=(proc.stdout, "out"), daemon=True),
               threading.Thread(target=pump, args=(proc.stderr, "err"), daemon=True),
               threading.Thread(target=feed, daemon=True)]
    try:
        for t in threads:
            t.start()
        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            res.timed_out = True
            _kill_group(proc)
            proc.wait()
    finally:
        _kill_group(proc)
        for t in threads:
            t.join(3)
        for f in (proc.stdout, proc.stderr):
            try:
                f.close()
            except OSError:
                pass
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass
    res.truncated = over.is_set()
    res.exit_code = None if res.timed_out else proc.returncode
    res.stdout = b"".join(bufs["out"]).decode("utf-8", "replace")
    res.stderr = b"".join(bufs["err"]).decode("utf-8", "replace")
    res.duration_ms = int((time.monotonic() - t0) * 1000)
    return res
