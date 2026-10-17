"""CodeLab contre le VRAI serveur Dual Pulse (bac à sable bwrap) : exécution Python/C/C++/Java/SQL/Shell depuis l'interface, erreurs de compilation, entrée standard, quête Python réelle."""
import json, os
from mobile_common import *

SOL = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "codelab_solutions.json"), encoding="utf-8"))
ED = "window.ENOS.codelab._state.ed"
ERRS = []


def wait_text(pg, sel, text, timeout=40000):
    pg.wait_for_function("([s,t]) => document.querySelector(s).textContent.includes(t)", arg=[sel, text], timeout=timeout)


def run_in(pg, lang, code, expect, stdin=None, label=None):
    pg.click(f'[data-new="{lang}"]'); pg.wait_for_selector("#cl-ed .cm-editor")
    pg.evaluate(f"{ED}.setDoc({json.dumps(code)})")
    if stdin is not None:
        pg.click(".cl-stabs [data-t=in]"); pg.fill("#cl-stdin", stdin)
    pg.click("[data-a=run]"); wait_text(pg, "#cl-term", expect)
    t = pg.inner_text("#cl-term")
    check(expect in t, "%s : sortie attendue %r" % (label or lang, expect))
    pg.click("#cl-edit [data-a=back]"); pg.wait_for_selector("#cl-home:not([hidden])")
    return t


with sync_playwright() as pw:
    b, ctx = launch(pw, bypass_csp=True)
    pg = open_app(ctx, ERRS)
    pg.evaluate("localStorage.clear()"); pg.reload(); pg.wait_for_selector("#tabbar")
    pg.evaluate("""(async () => { ENOS.cloud.setUrl('http://127.0.0.1:8800'); await ENOS.cloud.login('ceo@dualpulse.test', 'Un-bon-mot-de-passe-42', ''); })()""")
    pg.wait_for_function("window.ENOS.cloud.loggedIn()", timeout=15000)
    open_tool(pg, "codelab"); pg.wait_for_selector(".cl-new")

    run_in(pg, "python", 'n = int(input())\nprint(sum(range(n + 1)))\n', "55", stdin="10\n", label="Python + stdin")
    run_in(pg, "c", '#include <stdio.h>\nint main(void){ printf("salut C %d\\n", 6*7); return 0; }\n', "salut C 42")
    run_in(pg, "cpp", '#include <iostream>\nint main(){ std::cout << "salut C++ " << 6*7 << "\\n"; }\n', "salut C++ 42")
    run_in(pg, "java", 'public class Main { public static void main(String[] a){ System.out.println("salut Java " + 6*7); } }\n', "salut Java 42")
    run_in(pg, "sql", "CREATE TABLE t(a INT, b TEXT); INSERT INTO t VALUES (1,'x'),(2,'y'); SELECT * FROM t ORDER BY a DESC;\n", "y")
    run_in(pg, "shell", 'for i in 1 2 3; do echo "n=$i"; done\n', "n=3")
    t = run_in(pg, "c", '#include <stdio.h>\nint main(void){ int x = ; return 0; }\n', "erreur de compilation", label="C : erreur de compilation")
    check("/tmp" not in t and "/work" not in t.replace("main.c", ""), "chemins temporaires du serveur masqués dans les erreurs")
    run_in(pg, "python", 'import socket\ntry:\n    socket.create_connection(("1.1.1.1", 80), 2)\n    print("NET OK")\nexcept OSError:\n    print("pas de réseau")\n', "pas de réseau", label="réseau coupé dans le bac à sable")
    run_in(pg, "python", 'while True:\n    pass\n', "délai dépassé", label="boucle infinie arrêtée par le serveur")

    # ---------- quête Python réelle avec la solution de référence
    pg.wait_for_selector(".cl-quest:not(.locked)")
    qid = pg.get_attribute(".cl-quest:not(.locked)", "data-quest")
    pg.click(f'[data-quest="{qid}"]'); pg.wait_for_selector("#cl-eto .cl-goal")
    pg.evaluate(f"{ED}.setDoc({json.dumps(SOL[qid])})")
    pg.click("#cl-eto [data-e=check]"); pg.wait_for_selector(".cl-win", timeout=60000)
    check(True, "quête Python %s validée par le vrai serveur" % qid)
    b.close()

check(not ERRS, "aucune erreur JavaScript de page : %s" % ERRS[:3])
print("\nECHECS:", BAD if BAD else "aucun")
raise SystemExit(1 if BAD else 0)
