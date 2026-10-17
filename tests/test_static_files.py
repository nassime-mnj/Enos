"""Chaque fichier /static/… appelé par index.html (ou par un script) doit être servi par nasko_server (liste blanche _STATIC_FILES). Lancer : python tests/test_static_files.py"""
import ast
import os
import re
import sys
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def served():
    src = open(os.path.join(ROOT, "nasko_server.py"), encoding="utf-8").read()
    start = src.index("_STATIC_FILES = {")
    depth, i = 0, src.index("{", start)
    for j in range(i, len(src)):
        depth += src[j] == "{"
        depth -= src[j] == "}"
        if depth == 0:
            return set(ast.literal_eval(src[i:j + 1])) | set(re.findall(r'@app\.get\("/static/([A-Za-z0-9_.\-]+)"\)', src))   # + routes dédiées (app.js)
    raise AssertionError("_STATIC_FILES introuvable")


class Static(unittest.TestCase):
    def test_every_file_referenced_by_index_is_served(self):
        html = open(os.path.join(ROOT, "static", "index.html"), encoding="utf-8").read()
        refs = set(re.findall(r"/static/([A-Za-z0-9_.\-]+\.(?:js|css|png|json|woff2))", html))
        missing = sorted(n for n in refs if n not in served() and os.path.isfile(os.path.join(ROOT, "static", n)))
        self.assertEqual(missing, [], "fichiers référencés mais NON servis (404 dans l'application) : %s" % missing)

    def test_every_served_file_exists(self):
        gone = sorted(n for n in served() if not os.path.isfile(os.path.join(ROOT, "static", n)))
        self.assertEqual(gone, [], gone)


if __name__ == "__main__":
    unittest.main(verbosity=1)
