"""E.N.O.S. - terminal interactif pour le dépôt (xterm.js côté interface).

Un vrai shell avec TTY (couleurs, vim/less/top, complétion, Ctrl-C) :
  * "wsl"   : WSL local sous Windows (distribution `distro(cfg)`, départ ~/Nasko/<dépôt>) ;
  * "local" : shell POSIX local (Linux/macOS), limité à un répertoire racine autorisé.
Jamais de terminal vers le sandbox du serveur cloud.

CE MODULE NE FAIT AUCUNE AUTHENTIFICATION : le serveur doit contrôler jeton + local + rôle AVANT open_session().
Il garantit seulement : aucune commande construite par concaténation de texte utilisateur (argv en liste), dépôt/distribution validés,
tailles et durées plafonnées, arrêt de TOUT le groupe de processus (et de la session POSIX) à la fermeture, environnement assaini
(aucun secret d'Enos hérité), aucun journal du contenu tapé ou affiché.

Backends :
  * POSIX  : os.openpty() + subprocess.Popen(start_new_session=True) ;
  * Windows: ConPTY via `pywinpty` (import paresseux, optionnel). Sans pywinpty : repli "pipe" (wsl.exe SANS TTY) - limitation : pas
    d'éditeurs plein écran (vim/top/less), pas d'écho local ni d'édition de ligne, pas de Ctrl-C fiable, pas de redimensionnement.
    Les backends Windows ne sont pas testés sur Linux ; ils sont remplaçables via `spawn`.

Protocole WebSocket (voir parse_client_message / pump) : client->serveur octets bruts = frappes, texte JSON
{"t":"resize","cols":N,"rows":N} ; serveur->client octets bruts = sortie, texte JSON {"t":"exit","code":N} à la fin.
"""
import asyncio
import atexit
import errno
import json
import os
import re
import secrets
import select
import shutil
import signal
import subprocess
import threading
import time

__all__ = ["TermError", "Session", "backends", "open_session", "get", "close", "close_all", "list_sessions",
           "parse_client_message", "pump", "wsl_argv", "sanitized_env", "set_clock"]

REPO_RE = re.compile(r"^[A-Za-z0-9._-]{1,100}$")
DISTRO_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")   # identique à nasko_devmanager.DISTRO_RE
MAX_SESSIONS = 4
IDLE_TTL = 30 * 60                       # secondes d'inactivité avant fermeture automatique
BUF_MAX = 2 * 1024 * 1024                # tampon de sortie par session
MAX_MSG = 64 * 1024                      # taille max d'un message client
WRITE_BLOCK = 4096
COLS_MIN, COLS_MAX, ROWS_MIN, ROWS_MAX = 10, 500, 3, 200
DEAD_KEEP = 60                           # une session terminée reste lisible 60 s avant d'être retirée
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)
SECRET_WORDS = ("TOKEN", "SECRET", "KEY", "PASSWORD", "PASSWD", "CREDENTIAL", "PRIVATE")
SECRET_PREFIXES = ("DP_", "NASKO_", "ANTHROPIC_", "GROQ_", "ELEVEN")
KNOWN_SHELLS = {"bash", "zsh", "sh", "dash", "fish", "ksh", "mksh", "ash"}

_clock = time.monotonic


def set_clock(fn):
    """Horloge injectable (tests) : fn() -> secondes (float). set_clock(None) rétablit time.monotonic."""
    global _clock
    _clock = fn or time.monotonic


class TermError(Exception):
    """Erreur au message français affichable."""


# --------------------------------------------------------------------------------------------- détection / validation
def _is_windows():
    return os.name == "nt"


def _winpty_ok():
    try:
        import importlib.util
        return importlib.util.find_spec("winpty") is not None
    except Exception:  # noqa: BLE001
        return False


def _distro(cfg):
    d = str((cfg or {}).get("wsl_distro") or "Ubuntu").strip()
    if not DISTRO_RE.match(d):
        raise TermError("Nom de distribution WSL invalide.")
    return d


def backends(cfg=None):
    """Détection sans rien lancer : {"wsl": bool, "local": bool, "pty": "posix"|"conpty"|"pipe", "distro": str|None}."""
    win = _is_windows()
    try:
        d = _distro(cfg)
    except TermError:
        d = None
    wsl = bool(win and d and (shutil.which("wsl") or shutil.which("wsl.exe")))
    local = (not win) and bool(_find_shell())
    pty = "posix" if not win else ("conpty" if _winpty_ok() else "pipe")
    return {"wsl": wsl, "local": local, "pty": pty, "distro": d if wsl else None}


def _check_repo(repo):
    if not isinstance(repo, str) or not REPO_RE.match(repo) or ".." in repo:
        raise TermError("Nom de dépôt invalide.")
    return repo


def wsl_argv(distro, repo=None, pipe=False):
    """Fonction pure : argv (liste, jamais de shell) pour lancer WSL dans ~/Nasko[/<repo>].
    pipe=True : repli sans TTY (bash interactif explicite)."""
    if not isinstance(distro, str) or not DISTRO_RE.match(distro):
        raise TermError("Nom de distribution WSL invalide.")
    path = "~/Nasko"
    if repo is not None:
        path += "/" + _check_repo(repo)
    argv = ["wsl.exe", "-d", distro, "--cd", path]
    if pipe:
        argv += ["--", "bash", "-i"]
    return argv


def sanitized_env(base=None):
    """Copie de l'environnement sans secrets ni variables d'Enos ; TERM=xterm-256color."""
    out = {}
    for k, v in (os.environ if base is None else base).items():
        u = k.upper()
        if u.startswith(SECRET_PREFIXES) or any(w in u for w in SECRET_WORDS):
            continue
        out[k] = v
    out["TERM"] = "xterm-256color"
    out.setdefault("COLORTERM", "truecolor")
    return out


def _find_shell():
    sh = os.environ.get("SHELL", "")
    if sh and os.path.isabs(sh) and os.path.basename(sh) in KNOWN_SHELLS and os.access(sh, os.X_OK):
        return sh
    for c in ("/bin/bash", "/usr/bin/bash", "/bin/sh"):
        if os.access(c, os.X_OK):
            return c
    return None


# ---------------------------------------------------------------------------------------------------- backends
def _session_members(sid):
    """PID de tous les processus de la session POSIX `sid` (Linux : /proc). Vide ailleurs."""
    res = []
    try:
        names = os.listdir("/proc")
    except OSError:
        return res
    for n in names:
        if not n.isdigit():
            continue
        try:
            with open("/proc/%s/stat" % n, "rb") as f:
                data = f.read().decode("ascii", "replace")
            parts = data[data.rindex(")") + 2:].split()
            if int(parts[3]) == sid:
                res.append(int(n))
        except (OSError, ValueError, IndexError):
            continue
    return res


def _posix_kill_tree(proc):
    """Tue le groupe de processus ET tous les processus de la session du shell (jobs d'arrière-plan compris)."""
    pid = proc.pid

    def sig_all(sig):
        try:
            os.killpg(pid, sig)
        except OSError:
            pass
        for p in _session_members(pid):
            try:
                os.kill(p, sig)
            except OSError:
                pass
    sig_all(signal.SIGHUP)
    sig_all(signal.SIGCONT)
    end = time.monotonic() + 0.5
    while time.monotonic() < end:
        if proc.poll() is not None and not _session_members(pid):
            break
        time.sleep(0.02)
    sig_all(signal.SIGKILL)
    try:
        proc.wait(2)
    except Exception:  # noqa: BLE001
        pass


def _win_kill_tree(pid):
    try:
        subprocess.run(["taskkill", "/PID", str(int(pid)), "/T", "/F"], capture_output=True, timeout=10, creationflags=NOWIN)
    except Exception:  # noqa: BLE001
        pass


class PosixPtyBackend:
    """Shell dans un vrai pty POSIX (terminal de contrôle, job control, Ctrl-C)."""

    def __init__(self, argv, cwd, env, cols, rows):
        import fcntl
        import termios
        self._fcntl, self._termios = fcntl, termios
        master, slave = os.openpty()
        try:
            self._setsize(slave, cols, rows)

            def _ctty():
                fcntl.ioctl(0, termios.TIOCSCTTY, 0)
            self.proc = subprocess.Popen(argv, stdin=slave, stdout=slave, stderr=slave, cwd=cwd, env=env,
                                         start_new_session=True, preexec_fn=_ctty, close_fds=True)
        except BaseException:
            os.close(master)
            raise
        finally:
            os.close(slave)
        self.master = master
        self._closed = False

    def _setsize(self, fd, cols, rows):
        import struct
        self._fcntl.ioctl(fd, self._termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

    def read_chunk(self):
        if self._closed:
            return None
        try:
            r, _, _ = select.select([self.master], [], [], 0.2)
            if not r:
                return b""
            d = os.read(self.master, 65536)
        except (OSError, ValueError):
            return None
        return d or None

    def write(self, data):
        view = memoryview(data)
        while len(view) and not self._closed:
            try:
                _, w, _ = select.select([], [self.master], [], 1.0)
                if not w:
                    return                                    # le terminal n'absorbe plus : on abandonne le reste
                n = os.write(self.master, view[:WRITE_BLOCK])
            except (OSError, ValueError):
                return
            view = view[n:]

    def resize(self, cols, rows):
        if not self._closed:
            try:
                self._setsize(self.master, cols, rows)
                os.killpg(self.proc.pid, signal.SIGWINCH)
            except OSError:
                pass

    def poll(self):
        rc = self.proc.poll()
        if rc is None:
            return None
        return rc if rc >= 0 else 128 - rc                    # tué par signal -> 128+sig

    def kill(self):
        _posix_kill_tree(self.proc)

    def close(self):
        if not self._closed:
            self._closed = True
            try:
                os.close(self.master)
            except OSError:
                pass


class WinPtyBackend:
    """ConPTY via pywinpty (optionnel, import paresseux). Non testable hors Windows."""

    def __init__(self, argv, cwd, env, cols, rows):
        try:
            import winpty
        except ImportError:
            raise TermError("pywinpty n'est pas installé (pip install pywinpty) : terminal complet indisponible.")
        self.p = winpty.PtyProcess.spawn(argv, cwd=cwd, env=env, dimensions=(rows, cols))
        self._pid = getattr(self.p, "pid", None)

    def read_chunk(self):
        try:
            s = self.p.read(65536)
        except (EOFError, OSError):
            return None
        if isinstance(s, str):
            s = s.encode("utf-8", "replace")
        return s or (None if not self.p.isalive() else b"")

    def write(self, data):
        for i in range(0, len(data), WRITE_BLOCK):
            try:
                self.p.write(data[i:i + WRITE_BLOCK].decode("utf-8", "replace"))
            except (EOFError, OSError):
                return

    def resize(self, cols, rows):
        try:
            self.p.setwinsize(rows, cols)
        except Exception:  # noqa: BLE001
            pass

    def poll(self):
        if self.p.isalive():
            return None
        return getattr(self.p, "exitstatus", None) or 0

    def kill(self):
        if self._pid:
            _win_kill_tree(self._pid)
        try:
            self.p.terminate(force=True)
        except Exception:  # noqa: BLE001
            pass

    def close(self):
        try:
            self.p.close(force=True)
        except Exception:  # noqa: BLE001
            pass


class PipeBackend:
    """Repli sans TTY : stdin/stdout en tubes. Pas d'éditeurs plein écran, pas de resize, pas d'écho local."""

    def __init__(self, argv, cwd, env, cols, rows):
        kw = {}
        if _is_windows():
            kw["creationflags"] = NOWIN | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        else:
            kw["start_new_session"] = True
        self.proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     cwd=cwd, env=env, bufsize=0, **kw)
        self._closed = False

    def read_chunk(self):
        try:
            d = os.read(self.proc.stdout.fileno(), 65536)
        except (OSError, ValueError):
            return None
        return d or None

    def write(self, data):
        try:
            for i in range(0, len(data), WRITE_BLOCK):
                self.proc.stdin.write(data[i:i + WRITE_BLOCK])
        except (OSError, ValueError):
            pass

    def resize(self, cols, rows):
        pass

    def poll(self):
        return self.proc.poll()

    def kill(self):
        if _is_windows():
            _win_kill_tree(self.proc.pid)
            try:
                self.proc.kill()
            except OSError:
                pass
        else:
            _posix_kill_tree(self.proc)

    def close(self):
        if not self._closed:
            self._closed = True
            for f in (self.proc.stdin, self.proc.stdout):
                try:
                    f.close()
                except Exception:  # noqa: BLE001
                    pass


def _default_spawn(kind, argv, cwd, env, cols, rows):
    if kind == "local" or not _is_windows():
        return PosixPtyBackend(argv, cwd, env, cols, rows)
    cls = WinPtyBackend if _winpty_ok() else PipeBackend
    if cls is PipeBackend:
        argv = argv + ["--", "bash", "-i"] if "--" not in argv else argv
    return cls(argv, cwd, env, cols, rows)


# ---------------------------------------------------------------------------------------------------- session
class Session:
    """Un terminal. `backend` : objet avec read_chunk() (bytes, b"" = rien, None = fin), write(bytes), resize(c, r),
    poll() (code|None), kill() (tout l'arbre), close() (libère les descripteurs)."""

    def __init__(self, backend, kind, cwd, cols=100, rows=30):
        self.id = secrets.token_hex(16)
        self.kind = kind
        self.cwd = cwd
        self.cols, self.rows = cols, rows
        self._b = backend
        self._buf = bytearray()
        self.dropped = 0                                      # octets éliminés par le plafond du tampon
        self._cv = threading.Condition()
        self._wlock = threading.Lock()
        self._closed = False
        self._eof = False
        self._last = _clock()
        self._exit_time = None
        self._code = None
        self._t = threading.Thread(target=self._reader, name="term-" + self.id[:6], daemon=True)
        self._t.start()

    # -- lecture en arrière-plan
    def _feed(self, chunk):
        with self._cv:
            self._buf += chunk
            over = len(self._buf) - BUF_MAX
            if over > 0:
                del self._buf[:over]
                self.dropped += over
            self._last = _clock()
            self._cv.notify_all()

    def _reader(self):
        try:
            while not self._closed:
                chunk = self._b.read_chunk()
                if chunk is None:
                    break
                if chunk:
                    self._feed(chunk)
                elif self._b.poll() is not None:              # shell terminé : dernier vidage puis fin
                    for _ in range(3):
                        c = self._b.read_chunk()
                        if not c:
                            break
                        self._feed(c)
                    break
        except Exception:  # noqa: BLE001 — jamais de trace contenant la sortie du terminal
            pass
        finally:
            with self._cv:
                self._eof = True
                self._exit_time = _clock()
                self._cv.notify_all()
            if not self._closed:
                try:
                    self._b.kill()                            # pas d'orphelins quand le shell s'arrête de lui-même
                except Exception:  # noqa: BLE001
                    pass

    # -- API publique
    def alive(self):
        if self._closed:
            return False
        try:
            return self._b.poll() is None
        except Exception:  # noqa: BLE001
            return False

    def exit_code(self):
        if self._code is None:
            try:
                self._code = self._b.poll()
            except Exception:  # noqa: BLE001
                pass
        return self._code

    def idle_seconds(self):
        return max(0.0, _clock() - self._last)

    def write(self, data):
        if self._closed or not isinstance(data, (bytes, bytearray, memoryview)):
            return
        data = bytes(data)[:MAX_MSG]
        self._last = _clock()
        with self._wlock:
            self._b.write(data)

    def resize(self, cols, rows):
        try:
            cols, rows = int(cols), int(rows)
        except (TypeError, ValueError):
            raise TermError("Taille de terminal invalide.")
        cols = min(COLS_MAX, max(COLS_MIN, cols))
        rows = min(ROWS_MAX, max(ROWS_MIN, rows))
        self.cols, self.rows = cols, rows
        self._last = _clock()
        if not self._closed:
            self._b.resize(cols, rows)

    def read(self, timeout=0.0, max_bytes=65536):
        """Sortie disponible (jusqu'à max_bytes). Attend au plus `timeout` s si rien n'est prêt. b"" = rien."""
        max_bytes = max(1, int(max_bytes))
        with self._cv:
            if not self._buf and timeout and timeout > 0 and not self._eof and not self._closed:
                self._cv.wait(timeout)
            out = bytes(self._buf[:max_bytes])
            del self._buf[:max_bytes]
            return out

    def pending(self):
        with self._cv:
            return len(self._buf)

    def close(self):
        """Tue tout le groupe de processus, libère les descripteurs, retire la session. Idempotent."""
        with self._cv:
            if self._closed:
                return
            self._closed = True
            self._cv.notify_all()
        try:
            self._b.kill()
        except Exception:  # noqa: BLE001
            pass
        if threading.current_thread() is not self._t:
            self._t.join(3)
        self.exit_code()
        try:
            self._b.close()
        except Exception:  # noqa: BLE001
            pass
        _forget(self)


# ---------------------------------------------------------------------------------------------------- gestionnaire
_LOCK = threading.RLock()
_SESSIONS = {}
_JANITOR = None


def _forget(s):
    with _LOCK:
        if _SESSIONS.get(s.id) is s:
            del _SESSIONS[s.id]


def _sweep():
    """Ferme les sessions inactives trop longtemps et retire les sessions terminées depuis DEAD_KEEP s."""
    with _LOCK:
        items = list(_SESSIONS.values())
    now = _clock()
    for s in items:
        if s.idle_seconds() > IDLE_TTL:
            s.close()
        elif s._eof and s._exit_time is not None and now - s._exit_time > DEAD_KEEP:
            s.close()


def _janitor():
    while True:
        time.sleep(30)
        with _LOCK:
            if not _SESSIONS:
                globals()["_JANITOR"] = None
                return
        try:
            _sweep()
        except Exception:  # noqa: BLE001
            pass


def _start_janitor():
    global _JANITOR
    if _JANITOR is None:
        _JANITOR = threading.Thread(target=_janitor, name="term-janitor", daemon=True)
        _JANITOR.start()


def get(session_id):
    _sweep()
    with _LOCK:
        return _SESSIONS.get(session_id)


def close(session_id):
    with _LOCK:
        s = _SESSIONS.get(session_id)
    if s:
        s.close()


def close_all():
    with _LOCK:
        items = list(_SESSIONS.values())
    for s in items:
        s.close()


def list_sessions():
    """[{id, kind, cwd, alive, idle, cols, rows}] (aucun contenu de terminal)."""
    _sweep()
    with _LOCK:
        items = list(_SESSIONS.values())
    return [{"id": s.id, "kind": s.kind, "cwd": s.cwd, "alive": s.alive(), "idle": int(s.idle_seconds()),
             "cols": s.cols, "rows": s.rows} for s in items]


atexit.register(close_all)


def _local_start(repo, cfg, root):
    root = root or (cfg or {}).get("depot_local_root") or os.path.expanduser("~")
    try:
        real_root = os.path.realpath(str(root))
    except (OSError, ValueError):
        raise TermError("Racine locale invalide.")
    if real_root == os.path.sep or not os.path.isdir(real_root):
        raise TermError("Racine locale non autorisée.")
    start = os.path.realpath(os.path.join(real_root, repo)) if repo else real_root
    if start != real_root and not start.startswith(real_root + os.path.sep):
        raise TermError("Dossier hors de la racine autorisée.")
    if not os.path.isdir(start):
        raise TermError("Dossier de départ introuvable.")
    return start


def open_session(kind="auto", repo=None, cols=100, rows=30, cfg=None, spawn=None, root=None):
    """Ouvre un terminal. kind : "auto" (WSL si disponible, sinon local) | "wsl" | "local".
    spawn(argv, cwd, env, cols, rows) -> backend : injectable (tests, backends personnalisés).
    root : racine locale autorisée (sinon cfg["depot_local_root"], sinon le home). Lève TermError."""
    if kind not in ("auto", "wsl", "local"):
        raise TermError("Type de terminal inconnu.")
    if repo is not None and repo != "":
        _check_repo(repo)
    elif repo == "":
        raise TermError("Nom de dépôt invalide.")
    try:
        cols = min(COLS_MAX, max(COLS_MIN, int(cols)))
        rows = min(ROWS_MAX, max(ROWS_MIN, int(rows)))
    except (TypeError, ValueError):
        raise TermError("Taille de terminal invalide.")
    if kind == "auto":
        info = backends(cfg)
        kind = "wsl" if info["wsl"] else ("local" if info["local"] else None)
        if kind is None:
            if spawn is None:
                raise TermError("Aucun terminal disponible sur cette machine.")
            kind = "local"
    if kind == "wsl":
        d = _distro(cfg)
        if spawn is None and not backends(cfg)["wsl"]:
            raise TermError("WSL n'est pas disponible sur cette machine.")
        argv, cwd = wsl_argv(d, repo), None
        shown = "~/Nasko" + ("/" + repo if repo else "")
        env = sanitized_env()
    else:
        if spawn is None and _is_windows():
            raise TermError("Shell local indisponible sous Windows : utiliser WSL.")
        cwd = _local_start(repo, cfg, root)
        sh = _find_shell()
        if not sh:
            raise TermError("Aucun shell trouvé.")
        argv, shown, env = [sh], cwd, sanitized_env()
    with _LOCK:
        _sweep()
        if sum(1 for s in _SESSIONS.values() if s.alive()) >= MAX_SESSIONS:
            raise TermError("Trop de terminaux ouverts (maximum %d)." % MAX_SESSIONS)
        try:
            if spawn is not None:
                backend = spawn(argv, cwd, env, cols, rows)
            else:
                backend = _default_spawn(kind, argv, cwd, env, cols, rows)
        except TermError:
            raise
        except Exception:  # noqa: BLE001
            raise TermError("Impossible de démarrer le terminal.")
        s = Session(backend, kind, shown, cols, rows)
        _SESSIONS[s.id] = s
        _start_janitor()
    return s


# ---------------------------------------------------------------------------------------------------- protocole WebSocket
def parse_client_message(msg):
    """Message client -> ("input", bytes) | ("resize", cols, rows) | ("ignore",). Pure.
    bytes = frappes ; str = JSON {"t":"resize","cols":N,"rows":N} ; tout le reste (texte non JSON, hors bornes, > 64 Ko) est ignoré."""
    if isinstance(msg, (bytes, bytearray, memoryview)):
        b = bytes(msg)
        return ("input", b) if 0 < len(b) <= MAX_MSG else ("ignore",)
    if isinstance(msg, str):
        if len(msg) > MAX_MSG:
            return ("ignore",)
        try:
            o = json.loads(msg)
        except ValueError:
            return ("ignore",)
        if isinstance(o, dict) and o.get("t") == "resize":
            c, r = o.get("cols"), o.get("rows")
            if (type(c) is int and type(r) is int and COLS_MIN <= c <= COLS_MAX and ROWS_MIN <= r <= ROWS_MAX):
                return ("resize", c, r)
    return ("ignore",)


async def pump(send, receive, session, close_at_end=True, poll=0.25):
    """Relie une session à un WebSocket.
      send(x)  : coroutine ; x est bytes (sortie du terminal -> send_bytes) ou str (JSON de fin -> send_text) ;
      receive(): coroutine ; renvoie bytes | str, ou None à la déconnexion (une exception vaut déconnexion).
    Se termine à la déconnexion du client ou à la fin du shell (après envoi de {"t":"exit","code":N}).
    close_at_end : ferme (et tue) la session à la sortie, sinon la laisse vivante pour un rattachement."""
    async def out():
        while True:
            data = await asyncio.to_thread(session.read, poll)
            if data:
                await send(data)
                continue
            if not session.alive() or session._eof:
                data = session.read(0)
                if data:
                    await send(data)
                    continue
                await send(json.dumps({"t": "exit", "code": session.exit_code()}))
                return

    async def inp():
        while True:
            try:
                msg = await receive()
            except Exception:  # noqa: BLE001
                return
            if msg is None:
                return
            act = parse_client_message(msg)
            if act[0] == "input":
                session.write(act[1])
            elif act[0] == "resize":
                session.resize(act[1], act[2])

    tasks = [asyncio.ensure_future(out()), asyncio.ensure_future(inp())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if close_at_end:
            await asyncio.to_thread(session.close)
