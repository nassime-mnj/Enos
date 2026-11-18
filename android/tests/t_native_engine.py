"""Moteurs natifs (pont Java simulé) : window.EnosEngine est remplacé par un faux pont qui lance de VRAIS processus UCI sur la machine de test
(« sf19 » = Stockfish 19 via Node, « obsidian » = Obsidian ARM64 sous qemu-aarch64 avec un réseau factice). On vérifie :
chess_local prend Stockfish 19 natif comme moteur principal (et ses analyses marchent), E.nativeEngine.best() d'Obsidian rend un coup légal,
la fiche du bot dit que le vrai moteur tourne, une partie Défis contre Obsidian demande bien ses coups au moteur natif hors du livre.
Variables : SF19_JS (stockfish-19-lite-single.js de npm), OBSIDIAN_A64 (binaire aarch64). Test sauté si absents."""
import os, sys, json, subprocess, threading, queue
from mobile_common import *

S = "/tmp/claude-0/-home-user-Enos/30c76a9a-45de-515d-a61d-f48c0131e373/scratchpad"
SF = os.environ.get("SF19_JS", S + "/sf19x/package/bin/stockfish-19-lite-single.js")
OB = os.environ.get("OBSIDIAN_A64", S + "/eng/build_obs/obsidian")
if not (os.path.isfile(SF) and os.path.isfile(OB)):
    print("SKIP : moteurs de test absents (%s, %s)" % (SF, OB)); raise SystemExit(0)
CMD = {"sf19": ["node", SF], "obsidian": ["qemu-aarch64-static", OB]}
procs, outq, sent = {}, {}, []

def reader(eid, p):
    for line in p.stdout:
        outq[eid].put(line.rstrip("\n"))

def eng_start(eid):
    if eid in procs and procs[eid].poll() is None: return True
    p = subprocess.Popen(CMD[eid], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    procs[eid] = p; outq[eid] = queue.Queue(); threading.Thread(target=reader, args=(eid, p), daemon=True).start(); return True

def eng_send(eid, text):
    sent.append((eid, text)); p = procs.get(eid)
    if not p: return False
    p.stdin.write(text + "\n"); p.stdin.flush(); return True

def eng_poll():
    out = {}
    for eid, q in outq.items():
        ls = []
        while not q.empty(): ls.append(q.get())
        if ls: out[eid] = ls
    return out

MOCK = """(() => { const pend = {};
  window.EnosEngine = { list: () => JSON.stringify({ engines: ["sf19", "obsidian"], cores: 8 }),
    start: (id) => { window.__eng_start(id); return true; }, send: (id, t) => { window.__eng_send(id, String(t)); return true; }, stop: () => {} };
  setInterval(async () => { const r = await window.__eng_poll(); for (const id in r) if (window.ENOS && ENOS.nativeEngine) ENOS.nativeEngine._recv(id, r[id]); }, 25);
})();"""
errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    ctx.expose_function("__eng_start", eng_start); ctx.expose_function("__eng_send", eng_send); ctx.expose_function("__eng_poll", eng_poll)
    ctx.add_init_script(MOCK)
    pg = open_app(ctx, errs); pg.set_default_timeout(180000)
    pg.wait_for_function("!!(window.ENOS && ENOS.nativeEngine && ENOS.chessLocal)")
    check(pg.evaluate("ENOS.nativeEngine.has('sf19') && ENOS.nativeEngine.has('obsidian') && !ENOS.nativeEngine.has('caissa')"), "le pont liste les moteurs présents dans l'APK")
    check(pg.evaluate("ENOS.nativeEngine.threads()") == 6, "8 cœurs -> 6 fils de recherche")
    r = pg.evaluate("""async () => { const L = ENOS.chessLocal; const a = await L.analyse('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', { movetime: 1500, multipv: 2 });
      const m = await L.analyse('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', { movetime: 600 }); return { eng: L.engine, best: a.best, n: a.lines.length, mate: m.lines[0] && m.lines[0].mate, mbest: m.best }; }""")
    print(r)
    check(r["eng"] == "Stockfish 19 complet (natif)", "moteur principal = Stockfish 19 natif (%s)" % r["eng"])
    check(r["best"] in ("d2d4", "f1b5", "f1c4", "b1c3") and r["n"] == 2, "analyse MultiPV 2 par le moteur natif : %s" % r["best"])
    check(r["mbest"] == "a1a8" and r["mate"] == 1, "mat en 1 trouvé par le moteur natif")
    check(any(e == "sf19" and "Threads value 6" in t for e, t in sent) and any(e == "sf19" and "Hash value 256" in t for e, t in sent), "options Threads 6 / Hash 256 envoyées à Stockfish 19")
    o = pg.evaluate("""async () => { const r = await ENOS.nativeEngine.best('obsidian', 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', { movetime: 700 }); const ch = new Chess('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'); return { uci: r.uci, legal: !!ch.move({ from: r.uci.slice(0, 2), to: r.uci.slice(2, 4), promotion: r.uci[4] }) }; }""")
    check(o["legal"], "Obsidian natif rend un coup légal : %s" % o["uci"])
    # ---- Défis : fiche + partie contre Obsidian (hors livre -> moteur natif)
    open_tool(pg, "defis"); pg.wait_for_selector(".df-mode", state="attached")
    names = [x.lower() for x in pg.locator(".df-mode b").all_inner_texts()]
    check(all(any(n in t for t in names) for n in ["obsidian", "plentychess", "caissa", "viridithas"]), "les 4 moteurs sont dans les Défis")
    pg.locator(".df-mode", has_text="Obsidian").first.click(); pg.wait_for_selector("text=COMMENCER", timeout=5000)
    check("VRAI moteur" in pg.inner_text("body"), "fiche : le vrai moteur tourne sur le téléphone")
    pg.evaluate("ENOS.ui.back()"); pg.wait_for_selector("#sheet", state="hidden", timeout=5000)
    before = len([1 for e, t in sent if e == "obsidian" and t.startswith("go ")])
    API = "document.querySelector('#tool-defis .suite-body')._api"
    pg.evaluate("%s.launch('obsidian', {color: 'w'})" % API); pg.wait_for_selector("#df-board .cb-sq")
    for k, (f, t) in enumerate([("a2", "a3"), ("h2", "h3"), ("a3", "a4")]):          # coups hors répertoire : Obsidian sort vite de son livre
        pg.wait_for_function("(() => { const g = %s.g; return g && !g.busy && g.ch.turn() === 'w' && g.moves.length === %d; })()" % (API, 2 * k), timeout=120000)
        pg.click('#df-board [data-sq="%s"]' % f); pg.click('#df-board [data-sq="%s"]' % t)
    pg.wait_for_function("(() => { const g = %s.g; return g && g.moves.length >= 6 && !g.busy; })()" % API, timeout=120000)
    after = len([1 for e, t in sent if e == "obsidian" and t.startswith("go ")])
    check(after > before, "partie Défis contre Obsidian : coups demandés au moteur natif (%d recherches)" % (after - before))
    other = [e for e in errs if "favicon" not in e]
    check(not other, "aucune erreur JS : %s" % other[:3])
    b.close()
for p in procs.values():
    try: p.kill()
    except Exception: pass
raise SystemExit(1 if BAD else 0)
