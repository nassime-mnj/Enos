"""Bots « IA » (Claude Fable 5, ChatGPT 6 Astra, Gemini 4 Argon, DeepSeek V4.1) : profils de style donnés à Stockfish, zéro appel réseau."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    reqs = []
    ctx.on("request", lambda r: reqs.append(r.url) if not r.url.startswith(("http://127.0.0.1", "data:", "blob:")) else None)
    pg = open_app(ctx, errs)
    ev = pg.evaluate
    r = ev("""() => { const A = ENOS.aiBots, out = {}; A.ids.forEach((id) => { const p = A.prof[id]; out[id] = { elo: p.eloEst, w: Object.keys(p.book.w).length, b: Object.keys(p.book.b).length, first: Object.keys(p.book.w[''] || {}) }; }); return out; }""")
    check(set(r) == {"claude", "gpt", "gemini", "deepseek"}, "4 bots IA : %s" % list(r))
    check(all(v["w"] >= 6 and v["b"] >= 6 and v["first"] for v in r.values()), "livres d'ouvertures construits pour les Blancs et les Noirs")
    check(r["gemini"]["elo"] > r["claude"]["elo"] > r["gpt"]["elo"] > r["deepseek"]["elo"], "niveaux : Gemini %d > Claude %d > GPT %d > DeepSeek %d" % (r["gemini"]["elo"], r["claude"]["elo"], r["gpt"]["elo"], r["deepseek"]["elo"]))
    first = ev("() => ENOS.aiBots.prof.gemini.book.b['e2e4']")
    check(first["c7c5"] > first["e7e5"], "Gemini (Noirs) répond surtout 1.e4 par la Sicilienne : %s" % first)
    open_tool(pg, "defis")
    pg.wait_for_selector(".df-mode", state="attached")
    names = pg.locator(".df-mode b").all_inner_texts()
    check(all(any(n in t for t in names) for n in ["Claude Fable 5", "ChatGPT 6 Astra", "Gemini 4 Argon", "DeepSeek V4.1"]), "les 4 bots sont dans les Défis")
    pg.locator(".df-mode", has_text="Gemini 4 Argon").click()
    pg.wait_for_selector("text=COMMENCER", timeout=5000)
    check("zéro token" in pg.inner_text("body") and "2170" in pg.inner_text("body"), "fiche du bot : illusion assumée + Elo")
    pg.click('#su-col [data-c="b"]'); pg.click("text=COMMENCER")
    pg.wait_for_function("document.querySelector('#tool-defis .suite-body')._api.g && document.querySelector('#tool-defis .suite-body')._api.g.moves.length >= 1", timeout=30000)
    f = ev("document.querySelector('#tool-defis .suite-body')._api.g.moves[0].uci || document.querySelector('#tool-defis .suite-body')._api.g.ch.history({verbose:true})[0].from + document.querySelector('#tool-defis .suite-body')._api.g.ch.history({verbose:true})[0].to")
    check(f in ("e2e4", "d2d4"), "Gemini (Blancs) sort son livre : %s" % f)
    check(pg.locator("#df-botchat img.bot-av").count() >= 1, "illustration du bot affichée dans le chat")
    check(not reqs, "aucun appel réseau externe (zéro token) : %s" % reqs[:2])
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
