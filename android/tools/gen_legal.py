"""Génère android/assets/mobile/js/legal_data.js (HTML) depuis docs/legal/*.md : à relancer après chaque modification des textes juridiques."""
import html, json, os, re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
DOCS = [("cgu", "Conditions d'utilisation", "CGU.md"), ("cgv", "Conditions de vente", "CGV.md"), ("privacy", "Confidentialité", "CONFIDENTIALITE.md"), ("mentions", "Mentions légales", "MENTIONS_LEGALES.md")]


def inline(t):
    t = html.escape(t, quote=False)
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    return re.sub(r"\*(.+?)\*", r"<i>\1</i>", t)


def md(src):
    out, lst, tbl = [], False, []
    def flush():
        nonlocal lst, tbl
        if lst:
            out.append("</ul>"); lst = False
        if tbl:
            rows = [r for r in tbl if not re.match(r"^\|[-| ]+\|$", r)]
            cells = [[c.strip() for c in r.strip("|").split("|")] for r in rows]
            out.append("<table><thead><tr>" + "".join("<th>%s</th>" % inline(c) for c in cells[0]) + "</tr></thead><tbody>" +
                       "".join("<tr>" + "".join("<td>%s</td>" % inline(c) for c in r) + "</tr>" for r in cells[1:]) + "</tbody></table>")
            tbl = []
    for line in src.splitlines():
        s = line.rstrip()
        if s.startswith("|"):
            if lst:
                out.append("</ul>"); lst = False
            tbl.append(s); continue
        if tbl:
            flush()
        if not s:
            flush(); continue
        if s.startswith("# "):
            continue                                                         # le titre est affiché par l'onglet
        if s.startswith("## "):
            flush(); out.append("<h4>%s</h4>" % inline(s[3:])); continue
        if s.startswith("- "):
            if not lst:
                out.append("<ul>"); lst = True
            out.append("<li>%s</li>" % inline(s[2:])); continue
        flush(); out.append("<p>%s</p>" % inline(s))
    flush()
    return "".join(out)


data = [{"id": i, "title": t, "html": md(open(os.path.join(ROOT, "docs", "legal", f), encoding="utf-8").read())} for i, t, f in DOCS]
dst = os.path.join(ROOT, "android", "assets", "mobile", "js", "legal_data.js")
with open(dst, "w", encoding="utf-8") as f:
    f.write("// généré par android/tools/gen_legal.py depuis docs/legal/*.md — ne pas modifier à la main\nwindow.ENOS_LEGAL = " + json.dumps(data, ensure_ascii=False) + ";\n")
print("écrit :", dst, sum(len(d["html"]) for d in data), "caractères")
