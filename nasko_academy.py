"""Code Academy : exécution locale (Python, C, C++, Java, Shell, JS), trace pas à pas de Python et ouverture dans VS Code.

Tout tourne dans un dossier temporaire avec délai maximal et sortie bornée. Les routes sont réservées au PC (voir nasko_server : _LOCAL).
Aucune dépendance : on utilise les outils déjà installés (gcc/g++, javac, bash, node, python) et l'interface dit lesquels manquent.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)
TIMEOUT = 8
MAX_OUT = 20000
MAX_CODE = 60000

_EXT = {"python": "py", "c": "c", "cpp": "cpp", "java": "java", "shell": "sh", "js": "js"}
_cache: dict = {"t": 0.0, "v": {}}


def _first(*cands: str) -> str:
    for c in cands:
        if os.path.isabs(c):
            if os.path.isfile(c):
                return c
        else:
            p = shutil.which(c)
            if p:
                return p
    return ""


def _find_python() -> str:
    if not getattr(sys, "frozen", False):
        return sys.executable
    return _first("python", "py", "python3")


def _find_vcvars() -> str:
    """vcvars64.bat de Visual Studio / Build Tools (préfixé « msvc: »), ou chaîne vide."""
    import glob
    for root in (os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), os.environ.get("ProgramFiles", r"C:\Program Files")):
        for f in sorted(glob.glob(os.path.join(root, "Microsoft Visual Studio", "*", "*", "VC", "Auxiliary", "Build", "vcvars64.bat")), reverse=True):
            return "msvc:" + f
    return ""


def _msvc(lang: str, vcvars: str, d: str, src: str, exe: str, env) -> dict:
    """Compile avec cl.exe via un petit .bat (l'environnement de vcvars64 ne vit que dans ce processus)."""
    std = "/std:c17" if lang == "c" else "/std:c++20 /EHsc"
    bat = os.path.join(d, "build.bat")
    script = f'@echo off\r\ncall "{vcvars}" >nul 2>&1\r\ncl /nologo /W3 /D_CRT_SECURE_NO_WARNINGS {std} "{src}" /Fe:"{exe}" /Fo:"{d}\\\\"\r\n'
    with open(bat, "w", encoding="mbcs", newline="") as fh:
        fh.write(script)
    r = _run(["cmd", "/d", "/c", bat], d, env=env)
    if r["code"] != 0:                                    # cl écrit ses erreurs sur la sortie standard
        r["stderr"], r["stdout"] = (r["stdout"] + r["stderr"]).strip(), ""
    return r


def _find_bash() -> str:
    # Git Bash avant le bash.exe de WSL (System32), qui n'a pas les mêmes chemins
    return _first(r"C:\Program Files\Git\bin\bash.exe", r"C:\Program Files (x86)\Git\bin\bash.exe", "bash")


def tools() -> dict:
    """Outils détectés (cache 30 s) : {langue: chemin ou ''}."""
    now = time.time()
    if now - _cache["t"] < 30 and _cache["v"]:
        return _cache["v"]
    ms = [r"C:\msys64\ucrt64\bin", r"C:\msys64\mingw64\bin", r"C:\mingw64\bin", r"C:\MinGW\bin"]
    gcc = _first("gcc", "cc", *[os.path.join(d, "gcc.exe") for d in ms])
    gpp = _first("g++", "c++", *[os.path.join(d, "g++.exe") for d in ms])
    if not gcc or not gpp:                                   # pas de gcc : on se rabat sur le compilateur de Visual Studio Build Tools (cl.exe)
        vc = _find_vcvars()
        gcc, gpp = gcc or vc, gpp or vc
    v = {"python": _find_python(), "c": gcc, "cpp": gpp, "java": _first("javac"), "shell": _find_bash(), "js": _first("node"),
         "vscode": _first("code", "code.cmd", r"C:\Users\%s\AppData\Local\Programs\Microsoft VS Code\bin\code.cmd" % os.environ.get("USERNAME", ""))}
    _cache.update(t=now, v=v)
    return v


def status() -> dict:
    t = tools()
    return {k: bool(v) for k, v in t.items()}


def _clip(s: str) -> str:
    return s if len(s) <= MAX_OUT else s[:MAX_OUT] + "\n… sortie tronquée"


def _decode(b: bytes) -> str:
    """UTF-8 d'abord ; sinon page de code de la console Windows (messages de cl.exe)."""
    try:
        t = b.decode("utf-8")
    except UnicodeDecodeError:
        try:
            t = b.decode("oem")
        except LookupError:
            t = b.decode("utf-8", "replace")
    return t.replace("\r\n", "\n")


def _run(argv, cwd, stdin="", env=None):
    t0 = time.time()
    try:
        # octets bruts : le mode texte de Windows transformerait les sauts de ligne de l'entrée des programmes
        p = subprocess.run(argv, cwd=cwd, input=stdin.encode("utf-8"), capture_output=True,
                           timeout=TIMEOUT, creationflags=NOWIN, env=env)
        dec = _decode
        return {"code": p.returncode, "stdout": _clip(dec(p.stdout)), "stderr": _clip(dec(p.stderr)), "timeout": False, "ms": int((time.time() - t0) * 1000)}
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or b"")
        err = (e.stderr or b"")
        out = out.decode("utf-8", "replace") if isinstance(out, bytes) else out
        err = err.decode("utf-8", "replace") if isinstance(err, bytes) else err
        return {"code": -1, "stdout": _clip(out), "stderr": _clip(err), "timeout": True, "ms": TIMEOUT * 1000}
    except OSError as e:
        return {"code": -1, "stdout": "", "stderr": str(e), "timeout": False, "ms": 0}


def run(lang: str, code: str, stdin: str = "") -> dict:
    """Compile (si besoin) puis exécute. Retour : {ok, phase, code, stdout, stderr, ms, timeout, missing}."""
    if lang not in _EXT:
        return {"ok": False, "phase": "setup", "stderr": "langage inconnu", "stdout": "", "missing": False}
    if len(code) > MAX_CODE:
        return {"ok": False, "phase": "setup", "stderr": "code trop long", "stdout": "", "missing": False}
    t = tools()
    need = t.get(lang)
    if not need:
        names = {"c": "gcc (MSYS2 : pacman -S mingw-w64-ucrt-x86_64-gcc)", "cpp": "g++ (MSYS2 : pacman -S mingw-w64-ucrt-x86_64-gcc)", "java": "le JDK (javac)",
                 "shell": "bash (Git for Windows)", "js": "Node.js", "python": "Python"}
        return {"ok": False, "phase": "setup", "stdout": "", "stderr": f"{names.get(lang, lang)} n'est pas installé sur ce PC.", "missing": True}
    d = tempfile.mkdtemp(prefix="enos_acad_")
    try:
        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "utf-8"
        if not need.startswith("msvc:"):
            env["PATH"] = os.path.dirname(need) + os.pathsep + env.get("PATH", "")
        if lang == "shell":                                  # Git Bash : ses outils (sort, uniq, awk…) avant ceux de Windows (sort.exe…)
            usr = os.path.join(os.path.dirname(os.path.dirname(need)), "usr", "bin")
            env["PATH"] = usr + os.pathsep + env["PATH"]
        if lang == "java":
            f = os.path.join(d, "Main.java")
            open(f, "w", encoding="utf-8", newline="\n").write(code)
            r = _run([need, "-encoding", "UTF-8", "Main.java"], d, env=env)
            if r["code"] != 0:
                return {**r, "ok": False, "phase": "compile", "missing": False}
            java = _first(os.path.join(os.path.dirname(need), "java.exe"), os.path.join(os.path.dirname(need), "java"), "java")
            r = _run([java, "-Dfile.encoding=UTF-8", "-cp", d, "Main"], d, stdin, env)
            return {**r, "ok": r["code"] == 0 and not r["timeout"], "phase": "run", "missing": False}
        f = os.path.join(d, "prog." + _EXT[lang])
        open(f, "w", encoding="utf-8", newline="\n").write(code)
        if lang in ("c", "cpp"):
            exe = os.path.join(d, "prog.exe" if os.name == "nt" else "prog")
            if need.startswith("msvc:"):
                r = _msvc(lang, need[5:], d, f, exe, env)
            else:
                std = ["-std=c17"] if lang == "c" else ["-std=c++20"]
                r = _run([need, *std, "-Wall", "-Wextra", f, "-o", exe, "-lm"], d, env=env)
            if r["code"] != 0:
                return {**r, "ok": False, "phase": "compile", "missing": False}
            r2 = _run([exe], d, stdin, env)
            r2["warnings"] = r["stderr"]
            return {**r2, "ok": r2["code"] == 0 and not r2["timeout"], "phase": "run", "missing": False}
        argv = {"python": [need, "-I", "-X", "utf8", f], "shell": [need, f], "js": [need, f]}[lang]
        r = _run(argv, d, stdin, env)
        return {**r, "ok": r["code"] == 0 and not r["timeout"], "phase": "run", "missing": False}
    finally:
        shutil.rmtree(d, ignore_errors=True)


# ------------------------------------------------------------------ trace Python (réel, ligne par ligne)
_TRACER = r'''
import sys, json, io, builtins
src = open(sys.argv[1], encoding="utf-8").read()
LIMIT = 600
steps, out = [], io.StringIO()
real_out = sys.stdout
sys.stdout = out
def short(v, depth=0):
    if isinstance(v, (int, float, bool, type(None))): return v
    if isinstance(v, str): return repr(v[:60])
    if depth > 1: return "…"
    if isinstance(v, (list, tuple, set)):
        return {"k": type(v).__name__, "v": [short(x, depth + 1) for x in list(v)[:12]], "n": len(v)}
    if isinstance(v, dict):
        return {"k": "dict", "v": [[short(a, 1), short(b, 1)] for a, b in list(v.items())[:12]], "n": len(v)}
    if callable(v): return "ƒ " + getattr(v, "__name__", "?")
    return "<" + type(v).__name__ + ">"
def frames(f):
    chain = []
    while f is not None:
        if f.f_code.co_filename == "<user>":
            loc = {k: short(v) for k, v in f.f_locals.items() if not k.startswith("__")}
            chain.append({"fn": f.f_code.co_name if f.f_code.co_name != "<module>" else "global", "vars": loc})
        f = f.f_back
    return list(reversed(chain))
class Stop(Exception): pass
def tr(frame, ev, arg):
    if frame.f_code.co_filename != "<user>": return None
    if ev in ("line", "return"):
        if len(steps) >= LIMIT: raise Stop()
        s = {"l": frame.f_lineno, "f": frames(frame), "o": out.getvalue()[-400:], "ev": ev}
        if ev == "return": s["ret"] = short(arg)
        steps.append(s)
    return tr
err = None
g = {"__name__": "__main__", "__builtins__": builtins}
try:
    code = compile(src, "<user>", "exec")
    sys.settrace(tr)
    try: exec(code, g)
    finally: sys.settrace(None)
except Stop: err = "Trace coupée après %d étapes" % LIMIT
except BaseException as e: err = type(e).__name__ + ": " + str(e)
sys.stdout = real_out
print("\x00TRACE" + json.dumps({"steps": steps, "error": err, "output": out.getvalue()[-4000:]}))
'''


def trace_python(code: str) -> dict:
    py = tools().get("python")
    if not py:
        return {"ok": False, "error": "Python introuvable"}
    d = tempfile.mkdtemp(prefix="enos_trace_")
    try:
        open(os.path.join(d, "t.py"), "w", encoding="utf-8").write(_TRACER)
        open(os.path.join(d, "u.py"), "w", encoding="utf-8").write(code[:MAX_CODE])
        r = _run([py, "-I", "-X", "utf8", os.path.join(d, "t.py"), os.path.join(d, "u.py")], d)
        if "\x00TRACE" not in r["stdout"]:
            return {"ok": False, "error": r["stderr"] or "trace impossible", "timeout": r["timeout"]}
        return {"ok": True, **json.loads(r["stdout"].split("\x00TRACE", 1)[1])}
    except (ValueError, OSError) as e:
        return {"ok": False, "error": str(e)}
    finally:
        shutil.rmtree(d, ignore_errors=True)


def open_vscode(lang: str, code: str, name: str = "") -> dict:
    code_bin = tools().get("vscode")
    if not code_bin:
        return {"ok": False, "error": "VS Code introuvable (commande « code »)."}
    base = os.path.join(os.path.expanduser("~"), "ENOS_Academy")
    os.makedirs(base, exist_ok=True)
    safe = "".join(c for c in (name or "exercice") if c.isalnum() or c in "-_")[:40] or "exercice"
    fname = "Main.java" if lang == "java" else f"{safe}.{_EXT.get(lang, 'txt')}"
    path = os.path.join(base, fname)
    open(path, "w", encoding="utf-8", newline="\n").write(code[:MAX_CODE])
    try:
        subprocess.Popen([code_bin, "-g", path] if not code_bin.lower().endswith(".cmd") else ["cmd", "/c", code_bin, "-g", path], creationflags=NOWIN)
    except OSError as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "path": path}
