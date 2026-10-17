"""Utilitaires communs des tests de l'application mobile (navigateur Chromium, sans pont natif)."""
import os
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:%s/" % os.environ.get("MOBILE_PORT", "8802")
BAD = []


def check(c, m):
    print(("OK   " if c else "FAIL ") + m)
    if not c:
        BAD.append(m)


def launch(pw, bypass_csp=False, **ctx):
    kw = {"executable_path": os.environ["CHROMIUM"]} if os.environ.get("CHROMIUM") else {}
    if not kw and os.path.exists("/opt/pw-browsers/chromium"):
        kw = {"executable_path": "/opt/pw-browsers/chromium"}
    b = pw.chromium.launch(args=["--no-sandbox"], **kw)
    c = b.new_context(viewport={"width": 412, "height": 860}, bypass_csp=bypass_csp, **ctx)   # bypass_csp : seulement pour les tests qui appellent un vrai serveur (la page n'a pas de réseau en production)
    return b, c


def open_app(ctx, errs):
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(URL)
    pg.wait_for_selector("#tabbar")
    return pg


def open_tool(pg, tool):
    pg.click('#tabbar [data-tab="tools"]')
    pg.evaluate("window.ENOS.tools.show('')")
    pg.wait_for_selector(f'.mtile[data-m="{tool}"]')
    pg.click(f'.mtile[data-m="{tool}"]')
    pg.wait_for_selector(f"#tool-{tool}:not([hidden]) .suite-body > *", state="attached")
