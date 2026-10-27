"""Vérifie la syntaxe de fichiers JavaScript (sans Node : on compile avec new Function dans le navigateur). usage : check_js.py fichier.js ..."""
import sys, os
from playwright.sync_api import sync_playwright
from mobile_common import launch
bad = 0
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = ctx.new_page(); pg.goto("about:blank")
    for f in sys.argv[1:]:
        src = open(f, encoding="utf-8").read()
        err = pg.evaluate("(s) => { try { new Function(s); return ''; } catch (e) { return String(e); } }", src)
        print(("OK   " if not err else "FAIL ") + os.path.basename(f) + (" : " + err if err else ""))
        bad += bool(err)
print("%d erreur(s)" % bad)
