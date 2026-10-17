#!/usr/bin/env python3
"""Tests des Quêtes Enos CodeLab.

  python3 android/tests/test_codelab_quests.py

1. Structure de android/assets/mobile/js/codelab_quests.js (extrait via node).
2. Exécution de chaque solution de android/tests/codelab_solutions.json sur chaque test
   (python3, node, gcc, g++, javac/java, sqlite3 via python, bash) ; un outil absent => skip du langage.
   Le starter ne doit pas être déjà une solution, et doit compiler / s'exécuter proprement.
"""
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
QUESTS_JS = os.path.join(HERE, "..", "assets", "mobile", "js", "codelab_quests.js")
SOLUTIONS = os.path.join(HERE, "codelab_solutions.json")
TIMEOUT = 10

KNOWN_LANGS = {"python", "js", "c", "cpp", "java", "sql", "shell"}
PREFIX = {"python": "py", "js": "js", "c": "c", "cpp": "cpp", "java": "java", "sql": "sql", "shell": "sh"}
REQUIRED = ("id", "lang", "level", "xp", "title", "story", "goal", "starter", "tests", "concepts", "hints")


def _jload(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _write(path, text):
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def find_node():
    for c in (shutil.which("node"), "/opt/node22/bin/node"):
        if c and os.path.exists(c):
            return c
    return None


NODE = find_node()


def load_catalog():
    if not NODE:
        raise unittest.SkipTest("node introuvable")
    script = ("const fs=require('fs');global.window={};"
              "(0,eval)(fs.readFileSync(process.argv[1],'utf8'));"
              "process.stdout.write(JSON.stringify(window.CODELAB_QUESTS));")
    out = subprocess.run([NODE, "-e", script, os.path.abspath(QUESTS_JS)], capture_output=True, timeout=30, check=True)
    return json.loads(out.stdout.decode("utf-8"))


# ---------------------------------------------------------------- comparaison
def norm_lines(text):
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return "\n".join(l.rstrip() for l in text.split("\n")).rstrip()


_SEP = re.compile(r"^[\s\-+|]*-{3,}[\s\-+|]*$")


def sql_tokens(text):
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    for i, l in enumerate(lines):
        if _SEP.match(l):
            lines = lines[i + 1:]  # on jette l'en-tête et la ligne de séparation
            break
    return [t for t in re.split(r"[\s|]+", "\n".join(lines)) if t]


def same_output(quest, got, expected):
    if quest.get("compare") == "tokens":
        return sql_tokens(got) == sql_tokens(expected)
    return norm_lines(got) == norm_lines(expected)


# ---------------------------------------------------------------- exécution
ENV = dict(os.environ, LC_ALL="C.UTF-8", PYTHONIOENCODING="utf-8", PYTHONDONTWRITEBYTECODE="1")

JS_HARNESS = r"""
const fs = require('fs');
global.INPUT = fs.readFileSync(0, 'utf8');
const _l = INPUT.replace(/\r\n/g, '\n').split('\n');
if (_l.length && _l[_l.length - 1] === '') _l.pop();
let _i = 0;
global.readLine = () => (_i < _l.length ? _l[_i++] : null);
require('vm').runInThisContext(fs.readFileSync(process.argv[2], 'utf8'));
"""


def run(cmd, stdin, cwd):
    try:
        p = subprocess.run(cmd, input=stdin.encode("utf-8"), cwd=cwd, capture_output=True, timeout=TIMEOUT, env=ENV)
        return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")
    except subprocess.TimeoutExpired:
        return -9, "", "timeout"


def format_sql(cur):
    cols = [d[0] for d in cur.description]
    rows = [[("NULL" if v is None else str(v)) for v in r] for r in cur.fetchall()]
    w = [max([len(c)] + [len(r[i]) for r in rows]) for i, c in enumerate(cols)]
    fmt = lambda r: " | ".join(v.ljust(w[i]) for i, v in enumerate(r)).rstrip()
    return "\n".join([fmt(cols), "-+-".join("-" * x for x in w)] + [fmt(r) for r in rows]) + "\n"


def run_sql(code):
    conn = sqlite3.connect(":memory:")
    out, buf = [], ""
    try:
        for line in code.splitlines(keepends=True):
            buf += line
            if sqlite3.complete_statement(buf):
                cur = conn.execute(buf)
                if cur.description:
                    out.append(format_sql(cur))
                buf = ""
        if buf.strip() and not all(l.strip().startswith("--") or not l.strip() for l in buf.splitlines()):
            conn.execute(buf)
    finally:
        conn.close()
    return "".join(out)


TOOLS = {
    "python": ["python3"], "js": ["node"], "c": ["gcc"], "cpp": ["g++"],
    "java": ["javac", "java"], "sql": [], "shell": ["bash"],
}


def tool_missing(lang):
    return [t for t in TOOLS[lang] if not (shutil.which(t) or (t == "node" and NODE))]


def execute(lang, code, stdins):
    """Compile/prépare, puis exécute pour chaque stdin. Retourne (erreur_de_prep|None, [(rc, out, err)...])."""
    if lang == "sql":
        res = []
        for _ in stdins:
            try:
                res.append((0, run_sql(code), ""))
            except Exception as e:  # noqa
                return "SQL: %s" % e, []
        return None, res
    d = tempfile.mkdtemp(prefix="codelab_")
    try:
        if lang == "python":
            _write(os.path.join(d, "main.py"), code)
            cmd = ["python3", "-I", "main.py"]
        elif lang == "shell":
            _write(os.path.join(d, "main.sh"), code)
            cmd = ["bash", "main.sh"]
        elif lang == "js":
            _write(os.path.join(d, "user.js"), code)
            _write(os.path.join(d, "harness.js"), JS_HARNESS)
            cmd = [NODE or "node", "harness.js", "user.js"]
        elif lang in ("c", "cpp"):
            src = "main.c" if lang == "c" else "main.cpp"
            open(os.path.join(d, src), "w", encoding="utf-8").write(code)
            comp = ["gcc", "-O0", "-o", "prog", src, "-lm"] if lang == "c" else ["g++", "-std=c++17", "-O0", "-o", "prog", src]
            rc, _, err = run(comp, "", d)
            if rc != 0:
                return "compilation: " + err[:400], []
            cmd = ["./prog"]
        elif lang == "java":
            _write(os.path.join(d, "Main.java"), code)
            rc, _, err = run(["javac", "-encoding", "UTF-8", "Main.java"], "", d)
            if rc != 0:
                return "compilation: " + err[:400], []
            cmd = ["java", "-Xshare:auto", "-XX:TieredStopAtLevel=1", "-cp", ".", "Main"]
        else:
            return "langage inconnu", []
        return None, [run(cmd, s, d) for s in stdins]
    finally:
        shutil.rmtree(d, ignore_errors=True)


# ---------------------------------------------------------------- heuristique d'indices
BOILER = re.compile(r"^(#include|#!|import |using namespace|public class|public static void main|int main|class |package )")


def significant_lines(code):
    for l in code.splitlines():
        s = l.strip()
        if len(s) >= 12 and not BOILER.match(s) and not s.startswith(("--", "//", "# ")):
            yield s


def hint_leaks(solution, hints):
    leaks = []
    for s in significant_lines(solution):
        for h in hints:
            if s in h:
                leaks.append(s)
    return leaks


# ---------------------------------------------------------------- tests
class StructureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cat = load_catalog()
        cls.sols = _jload(SOLUTIONS)

    def test_top_level(self):
        c = self.cat
        self.assertEqual(c["version"], 1)
        self.assertEqual(set(c["languages"]), KNOWN_LANGS)
        for k, v in c["languages"].items():
            self.assertTrue(v.get("label") and v.get("intro"), k)
        self.assertGreaterEqual(len(c["quests"]), 45)
        self.assertIn("INPUT", c["languages"]["js"]["intro"])
        self.assertIn("readLine", c["languages"]["js"]["intro"])

    def test_counts(self):
        counts = {}
        for q in self.cat["quests"]:
            counts[q["lang"]] = counts.get(q["lang"], 0) + 1
        for lang in ("python", "js", "c", "cpp", "java"):
            self.assertGreaterEqual(counts.get(lang, 0), 8, lang)
        for lang in ("sql", "shell"):
            self.assertGreaterEqual(counts.get(lang, 0), 6, lang)

    def test_quest_fields(self):
        ids, last_level = set(), {}
        for q in self.cat["quests"]:
            with self.subTest(q=q.get("id")):
                for f in REQUIRED:
                    self.assertIn(f, q)
                self.assertNotIn(q["id"], ids)
                ids.add(q["id"])
                self.assertIn(q["lang"], KNOWN_LANGS)
                self.assertTrue(q["id"].startswith(PREFIX[q["lang"]] + "-"), q["id"])
                self.assertIsInstance(q["level"], int)
                self.assertGreater(q["level"], last_level.get(q["lang"], 0), "niveaux croissants")
                last_level[q["lang"]] = q["level"]
                self.assertIsInstance(q["xp"], int)
                self.assertGreater(q["xp"], 0)
                for f in ("title", "story", "goal", "starter"):
                    self.assertIsInstance(q[f], str)
                    self.assertTrue(q[f].strip(), f)
                self.assertTrue(q["concepts"] and all(isinstance(x, str) and x for x in q["concepts"]))
                self.assertEqual(len(q["hints"]), 3)
                self.assertTrue(all(isinstance(h, str) and h.strip() for h in q["hints"]))
                self.assertTrue(2 <= len(q["tests"]) <= 4)
                for t in q["tests"]:
                    self.assertIsInstance(t["stdin"], str)
                    self.assertIsInstance(t["expected"], str)
                    self.assertTrue(t["expected"].strip())
                if any(t["stdin"] for t in q["tests"]):
                    self.assertEqual(len({t["stdin"] for t in q["tests"]}), len(q["tests"]), "stdin variés")
                self.assertIn(q.get("compare", "lines"), ("lines", "tokens"))
                if q["lang"] == "sql":
                    self.assertEqual(q.get("compare"), "tokens")

    def test_solutions_cover_quests(self):
        self.assertEqual(set(self.sols), {q["id"] for q in self.cat["quests"]})

    def test_hints_do_not_leak_solution(self):
        for q in self.cat["quests"]:
            with self.subTest(q=q["id"]):
                sol = self.sols[q["id"]]
                self.assertEqual(hint_leaks(sol, q["hints"]), [])
                self.assertNotEqual(q["starter"].strip(), sol.strip())
                # le starter ne contient pas non plus toute la solution
                self.assertNotIn(sol.strip(), q["starter"])


class ExecutionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cat = load_catalog()
        cls.sols = _jload(SOLUTIONS)
        cls.quests = [q for q in cls.cat["quests"] if not tool_missing(q["lang"])]
        cls.skipped = sorted({q["lang"] for q in cls.cat["quests"] if tool_missing(q["lang"])})
        if cls.skipped:
            print("Langages ignorés (outil manquant) :", ", ".join(cls.skipped), file=sys.stderr)

        def job(q):
            stdins = [t["stdin"] for t in q["tests"]]
            return q["id"], execute(q["lang"], cls.sols[q["id"]], stdins), execute(q["lang"], q["starter"], stdins)

        with ThreadPoolExecutor(max_workers=min(8, (os.cpu_count() or 2) * 2)) as ex:
            cls.results = {qid: (s, st) for qid, s, st in ex.map(job, cls.quests)}

    def test_solutions_pass(self):
        for q in self.quests:
            with self.subTest(q=q["id"]):
                err, res = self.results[q["id"]][0]
                self.assertIsNone(err, err)
                for t, (rc, out, serr) in zip(q["tests"], res):
                    self.assertEqual(rc, 0, "code retour %s : %s" % (rc, serr[:300]))
                    self.assertTrue(same_output(q, out, t["expected"]),
                                    "stdin=%r attendu=%r obtenu=%r" % (t["stdin"], t["expected"], out))

    def test_starters_are_clean_but_unsolved(self):
        for q in self.quests:
            with self.subTest(q=q["id"]):
                err, res = self.results[q["id"]][1]
                self.assertIsNone(err, "le starter doit compiler / être valide : %s" % err)
                passed = 0
                for t, (rc, out, serr) in zip(q["tests"], res):
                    self.assertEqual(rc, 0, "le starter plante : %s" % serr[:300])
                    passed += same_output(q, out, t["expected"])
                self.assertLess(passed, len(q["tests"]), "le starter est déjà une solution")


class ComparisonTests(unittest.TestCase):
    def test_lines(self):
        q = {}
        self.assertTrue(same_output(q, "a  \r\nb\r\n\r\n", "a\nb"))
        self.assertFalse(same_output(q, "A\n", "a\n"))
        self.assertFalse(same_output(q, "a b\n", "a  b\n"))

    def test_tokens(self):
        q = {"compare": "tokens"}
        table = "nom | note\n----+-----\nAlice | 15\nBruno | 9\n"
        self.assertTrue(same_output(q, table, "Alice 15\nBruno 9\n"))
        self.assertFalse(same_output(q, table, "Alice 15\nBruno 8\n"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
