"""Langages CodeLab : compilation, exécution, normalisation des erreurs. Le confinement lui-même est dans sandbox.py."""
import json
import os
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request

from . import sandbox

CODE_BYTES = 64 * 1024
STDIN_BYTES = 16 * 1024
OUTPUT_BYTES = sandbox.OUTPUT_BYTES


class RunnerError(Exception):
    def __init__(self, status, detail):
        super().__init__(detail)
        self.status, self.detail = status, detail


_SQL_RUNNER = r'''
import sqlite3, sys
DENY_ACTIONS = {sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH}
SAFE_PRAGMAS = {"table_info", "table_xinfo", "table_list", "index_list", "index_info", "foreign_key_list", "foreign_keys", "case_sensitive_like",
                "count_changes", "encoding", "user_version", "schema_version", "collation_list", "database_list", "compile_options", "integrity_check", "quick_check"}
def auth(action, a1, a2, db, trigger):
    if action in DENY_ACTIONS:
        return sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_PRAGMA and (a1 or "").lower() not in SAFE_PRAGMAS:
        return sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_FUNCTION and (a2 or "").lower() in ("load_extension", "readfile", "writefile", "edit"):
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK
def fmt(v):
    if v is None: return "NULL"
    if isinstance(v, bytes): return "x'" + v.hex() + "'"
    return str(v).replace("\n", "\\n")
def table(cols, rows):
    w = [len(c) for c in cols]
    for r in rows:
        for i, v in enumerate(r): w[i] = max(w[i], len(v))
    line = lambda r: " | ".join(v.ljust(w[i]) for i, v in enumerate(r)).rstrip()
    out = [line(cols), "-+-".join("-" * x for x in w)] + [line(r) for r in rows]
    return "\n".join(out)
con = sqlite3.connect(":memory:", isolation_level=None)
con.enable_load_extension(False) if hasattr(con, "enable_load_extension") else None
con.execute("PRAGMA max_page_count=4000")
con.set_authorizer(auth)
src = open("input.sql", encoding="utf-8", errors="replace").read()
buf, stmts = "", []
for ch in src:
    buf += ch
    if ch == ";" and sqlite3.complete_statement(buf):
        stmts.append(buf); buf = ""
if buf.strip(): stmts.append(buf)
code = 0
for st in stmts:
    if not st.strip(): continue
    try:
        cur = con.execute(st)
        if cur.description:
            cols = [d[0] for d in cur.description]
            rows = [[fmt(v) for v in r] for r in cur.fetchmany(1000)]
            more = cur.fetchone() is not None
            print(table(cols, rows)); print("(%d ligne%s%s)" % (len(rows), "s" if len(rows) > 1 else "", ", tronqué" if more else "")); print()
    except Exception as e:
        print("Erreur SQL : %s" % e, file=sys.stderr); code = 1; break
sys.exit(code)
'''

_JAVA_DECL = re.compile(r"\bpublic\s+(?:(?:final|abstract|sealed|strictfp)\s+)*(?:class|interface|enum|record)\s+([A-Za-z_$][A-Za-z0-9_$]*)")
_JAVA_ANY = re.compile(r"\b(?:class|interface|enum|record)\s+([A-Za-z_$][A-Za-z0-9_$]*)")


def java_class(code):
    """Nom de la classe à lancer : classe publique, sinon celle qui contient main, sinon Main."""
    m = _JAVA_DECL.search(code)
    if m:
        return m.group(1)
    mm = re.search(r"static\s+void\s+main\s*\(", code)
    if mm:
        found = _JAVA_ANY.findall(code[:mm.start()])
        if found:
            return found[-1]
    return "Main"


# id -> description. build(code, wd) -> (fichiers {nom: texte}, cmd compilation|None, cmd exécution, env, mem_run_mb, mem_compile_mb)
def _py(code):
    return {"main.py": code}, None, ["python3", "-I", "-B", "-u", "main.py"], {"PYTHONIOENCODING": "utf-8"}, 512, 512


def _c(code):
    return {"main.c": code}, ["gcc", "-O1", "-std=c17", "-Wall", "-Wextra", "-fdiagnostics-color=never", "-o", "prog", "main.c", "-lm"], ["./prog"], {}, 512, 2048


def _cpp(code):
    return {"main.cpp": code}, ["g++", "-std=c++20", "-O1", "-Wall", "-Wextra", "-fdiagnostics-color=never", "-o", "prog", "main.cpp", "-lm"], ["./prog"], {}, 512, 2048


def _java(code):
    cls = java_class(code)
    jvm = ["-XX:CompressedClassSpaceSize=64m", "-XX:ReservedCodeCacheSize=48m", "-XX:MaxMetaspaceSize=128m", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1", "-Xshare:auto"]
    return ({cls + ".java": code},
            ["javac", "-encoding", "UTF-8", "-nowarn", "-J-Xmx384m", "-J-XX:+UseSerialGC", "-J-XX:TieredStopAtLevel=1", "-d", ".", cls + ".java"],
            ["java", "-Xmx256m", "-Xss512k"] + jvm + ["-cp", ".", cls], {}, 3072, 4096)


def _sql(code):
    return {"input.sql": code, "_runner.py": _SQL_RUNNER}, None, ["python3", "-I", "-B", "_runner.py"], {"PYTHONIOENCODING": "utf-8"}, 512, 512


def _sh(code):
    return {"main.sh": code}, None, ["bash", "--noprofile", "--norc", "main.sh"], {}, 512, 512


LANGS = {
    "python": dict(label="Python", tools=["python3"], version=["python3", "--version"], build=_py, piston="python"),
    "c": dict(label="C", tools=["gcc"], version=["gcc", "--version"], build=_c, piston="c"),
    "cpp": dict(label="C++", tools=["g++"], version=["g++", "--version"], build=_cpp, piston="c++"),
    "java": dict(label="Java", tools=["javac", "java"], version=["javac", "-version"], build=_java, piston="java"),
    "sql": dict(label="SQL (SQLite)", tools=["python3"], version=None, build=_sql, piston="sqlite3"),
    "shell": dict(label="Shell (bash)", tools=["bash"], version=["bash", "--version"], build=_sh, piston="bash"),
}

_versions = {}


def _version(lid):
    if lid in _versions:
        return _versions[lid]
    spec = LANGS[lid]
    v = ""
    try:
        if lid == "sql":
            import sqlite3
            v = "SQLite " + sqlite3.sqlite_version
        else:
            p = subprocess.run(spec["version"], capture_output=True, text=True, timeout=8, stdin=subprocess.DEVNULL)
            line = ((p.stdout or "") + (p.stderr or "")).strip().splitlines()
            v = line[0].strip() if line else ""
            m = re.search(r"\d+(?:\.\d+)+", v)
            v = m.group(0) if m else v[:40]
    except (OSError, subprocess.SubprocessError):
        v = ""
    _versions[lid] = v
    return v


def reset_cache():
    _versions.clear()


def _tools_present(lid):
    return all(shutil.which(t, path=sandbox.SAFE_PATH) for t in LANGS[lid]["tools"])


def available(lid, backend=None):
    b = backend or sandbox.detect()
    if b.name == "remote":
        return True
    return _tools_present(lid)


def languages(backend=None):
    b = backend or sandbox.detect()
    return [{"id": lid, "label": s["label"], "version": (_version(lid) if b.name != "remote" and _tools_present(lid) else ""), "available": available(lid, b)}
            for lid, s in LANGS.items()]


def limits():
    return {"timeout_s": sandbox.timeout_s(), "output_bytes": OUTPUT_BYTES, "code_bytes": CODE_BYTES, "stdin_bytes": STDIN_BYTES}


# ----------------------------------------------------------------------------- nettoyage
_PATHS = [re.compile(r"/(?:tmp|var/tmp|private/tmp)/dpcl_[A-Za-z0-9_]+/?"), re.compile(r"(?<![\w.])/work/"), re.compile(r"(?<![\w.])\./(?=\w)")]


def clean(text, workdir=""):
    if workdir:
        text = text.replace(workdir.rstrip("/") + "/", "").replace(workdir, "")
    for rx in _PATHS[:2]:
        text = rx.sub("", text)
    return text


# ----------------------------------------------------------------------------- exécution
def _result(ok, phase, r, workdir="", extra_ms=0):
    return {"ok": ok, "phase": phase, "exit_code": r.exit_code, "stdout": clean(r.stdout, workdir), "stderr": clean(r.stderr, workdir), "timed_out": r.timed_out, "truncated": r.truncated,
            "duration_ms": r.duration_ms + extra_ms}


def validate(language, code, stdin, backend=None):
    if language not in LANGS:
        raise RunnerError(400, "Langage inconnu : " + str(language)[:30])
    if not isinstance(code, str) or not code.strip():
        raise RunnerError(400, "Le code est vide.")
    if len(code.encode("utf-8", "replace")) > CODE_BYTES:
        raise RunnerError(400, "Code trop volumineux (64 Ko maximum).")
    if len((stdin or "").encode("utf-8", "replace")) > STDIN_BYTES:
        raise RunnerError(400, "Entrée standard trop volumineuse (16 Ko maximum).")
    if not available(language, backend):
        raise RunnerError(400, "Langage indisponible sur ce serveur.")


def execute(language, code, stdin="", backend=None):
    """Exécute et renvoie le dictionnaire du contrat /run. Lève RunnerError (400/503)."""
    b = backend or sandbox.detect()
    validate(language, code, stdin, b)
    if not b.usable:
        raise RunnerError(503, "Bac à sable indisponible sur ce serveur : exécution refusée.")
    if b.name == "remote":
        return _remote(b, language, code, stdin)
    files, ccmd, rcmd, env, mem_run, mem_comp = LANGS[language]["build"](code)
    sin = (stdin or "").encode("utf-8", "replace")
    spent = 0
    with sandbox.workspace() as wd:
        for name, content in files.items():
            with open(os.path.join(wd, name), "w", encoding="utf-8", newline="") as f:
                f.write(content)
        if ccmd:
            cr = sandbox.run(ccmd, wd, timeout=sandbox.compile_timeout_s(), mem_mb=mem_comp, env=env, backend=b)
            if cr.timed_out or cr.exit_code != 0:
                return _result(False, "compile", cr, wd)
            spent = cr.duration_ms
        rr = sandbox.run(rcmd, wd, stdin=sin, timeout=sandbox.timeout_s(), mem_mb=mem_run, env=env, backend=b)
        return _result(rr.exit_code == 0 and not rr.timed_out and not rr.truncated, "run", rr, wd, spent)


def _remote(b, language, code, stdin):
    """Piston (engineer-man/piston) : POST {base}/api/v2/execute."""
    t0 = time.monotonic()
    body = json.dumps({"language": LANGS[language]["piston"], "version": "*", "files": [{"content": code}], "stdin": stdin or "",
                       "run_timeout": sandbox.timeout_s() * 1000, "compile_timeout": sandbox.compile_timeout_s() * 1000}).encode()
    req = urllib.request.Request(b.remote + "/api/v2/execute", data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=sandbox.timeout_s() + sandbox.compile_timeout_s() + 10) as resp:
            data = json.loads(resp.read(2_000_000).decode("utf-8", "replace"))
    except (urllib.error.URLError, OSError, ValueError):
        raise RunnerError(503, "Bac à sable distant injoignable.")
    ms = int((time.monotonic() - t0) * 1000)

    def cap(s):
        raw = (s or "").encode("utf-8", "replace")
        return raw[:OUTPUT_BYTES].decode("utf-8", "replace"), len(raw) > OUTPUT_BYTES
    comp, run = data.get("compile") or {}, data.get("run") or {}
    if comp and comp.get("code") not in (0, None):
        so, t1 = cap(comp.get("stdout"))
        se, t2 = cap(comp.get("stderr") or comp.get("output"))
        return {"ok": False, "phase": "compile", "exit_code": comp.get("code"), "stdout": so, "stderr": clean(se), "timed_out": False, "truncated": t1 or t2, "duration_ms": ms}
    so, t1 = cap(run.get("stdout"))
    se, t2 = cap(run.get("stderr"))
    killed = run.get("signal") == "SIGKILL"
    code = None if killed else run.get("code")
    return {"ok": code == 0 and not t1 and not t2, "phase": "run", "exit_code": code, "stdout": so, "stderr": se, "timed_out": killed, "truncated": t1 or t2, "duration_ms": ms}
