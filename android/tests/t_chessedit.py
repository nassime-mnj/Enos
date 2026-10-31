"""CHESS EDIT STUDIO : analyse audio d'une musique synthétique (drop connu), mapping partie <-> audio, scène 3D, aperçu temps réel, manifeste Godot.
Le morceau : intro faible (kick léger toutes les 0,5 s) 0-12 s, montée de bruit 12-20 s, creux 20-21,5 s, DROP à 21,5 s puis kick fort toutes les 0,46875 s jusqu'à 40 s."""
import json
import math
import os
import random
import struct
import tempfile
import wave
from mobile_common import *
from playwright.sync_api import sync_playwright

SHOTS = os.environ.get("SHOTS", "")
SR, DUR, DROP = 22050, 40.0, 21.5


def make_wav(path):
    random.seed(3)
    n = int(SR * DUR)
    buf = [0.0] * n
    def kick(t0, amp):
        i0 = int(t0 * SR)
        for k in range(int(0.12 * SR)):
            if i0 + k < n:
                t = k / SR
                buf[i0 + k] += amp * math.sin(2 * math.pi * (50 + 60 * math.exp(-t * 30)) * t) * math.exp(-t * 22)
    for i in range(n):
        t = i / SR
        if t < 12:
            buf[i] += 0.04 * math.sin(2 * math.pi * 220 * t)
        elif t < 20:
            buf[i] += (0.03 + 0.4 * ((t - 12) / 8) ** 2) * (random.random() * 2 - 1)
        elif t >= DROP:
            buf[i] += 0.25 * math.sin(2 * math.pi * 55 * t) + 0.12 * math.sin(2 * math.pi * 1000 * t) * (1 if int((t - DROP) * 2) % 2 == 0 else 0.3)
    for b in range(24):
        kick(b * 0.5, 0.25)
    t = DROP
    while t < DUR - 0.2:
        kick(t, 0.9); t += 0.46875
    pk = max(abs(x) for x in buf) or 1
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, x / pk)) * 30000)) for x in buf))


OPERA = "e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#".split()

errs = []
tmp = tempfile.mkdtemp()
wav = os.path.join(tmp, "synth.wav")
make_wav(wav)
with sync_playwright() as pw:
    kw = {"executable_path": os.environ["CHROMIUM"]} if os.environ.get("CHROMIUM") else {}
    b = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"], **kw)
    ctx = b.new_context(viewport={"width": 412, "height": 860})
    pg = open_app(ctx, errs)
    pg.set_default_timeout(60000)
    pg.wait_for_function("window.ENOS && ENOS.editMap && ENOS.editFx && ENOS.editAudio && ENOS.chessEdit", timeout=10000)

    # ---------------------------------------------------------------- partie enregistrée (Opéra de Paris) avec jugements et répliques
    rec = pg.evaluate("""(san) => { const c = new Chess(), mv = [];
        san.forEach((s, i) => { const m = c.move(s); const key = i === 30 ? 'brilliant' : i === 11 ? 'blunder' : (m.captured ? 'good' : 'book'); mv.push([m.from + m.to + (m.promotion || ''), m.san, key, i === 11 ? 420 : 5, (i % 2 ? -1 : 1) * i * 12, '']); });
        return { t: 1, title: 'Opéra · Test', result: 'Les Blancs gagnent', plies: mv.length, brill: 1, pgn: c.pgn(), id: 'combat', pw: 'GhorGhor', pb: 'Lelex', me: null,
          ch: [[12, 'ghorghor', 'XDDD vrm mdrr', 'bot_blunder'], [14, 'ghorghor', 'Att att…', 'transform'], [31, 'eto', 'Un sacrifice magnifique.', 'bot_brilliant'], [33, 'ghorghor', 'Echec et mat.', 'mate_win']], mv }; }""", OPERA)
    check(len(rec["mv"]) == 33, "partie de test : 33 demi-coups")

    # ---------------------------------------------------------------- 1. analyse audio
    pg.evaluate("(r) => { ENOS.settings.set('defi.hist', [r]); }", rec)
    open_tool(pg, "chessedit")
    with pg.expect_file_chooser() as fc:
        pg.click("#ce-pick")
    fc.value.set_files(wav)
    pg.wait_for_function("document.querySelector('#ce-as').textContent.includes('impacts de basse')", timeout=120000)
    a = pg.evaluate("document.querySelector('#tool-chessedit .suite-body')._api ? 0 : 0")
    a = pg.evaluate("(() => ENOS.editMap && window.__ceAudio)() || 0")
    txt = pg.inner_text("#ce-as")
    print(txt.replace("\n", " | "))
    st = pg.evaluate("""async () => { const r = await fetch(document.querySelector('#ce-pick') && ''); return 0; }""") if False else 0

    # on relit l'analyse en rappelant directement l'analyseur sur le même fichier (le module ne l'expose pas)
    an = pg.evaluate("""async (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        return await ENOS.editAudio.analyseFile(new File([u], 's.wav', { type: 'audio/wav' })); }""", __import__("base64").b64encode(open(wav, "rb").read()).decode())
    check(abs(an["mainDropTimestamp"] - DROP) < 0.35, "DROP détecté à %.2f s (attendu %.1f)" % (an["mainDropTimestamp"], DROP))
    check(19.5 <= an["preDropSilence"] <= DROP, "creux avant le drop : %.2f s" % an["preDropSilence"])
    check(8 <= an["buildUpStart"] <= 17, "début de la montée : %.2f s (attendu ~12)" % an["buildUpStart"])
    hb = an["hardBeats"]
    check(len(hb) >= 20 and all(t > DROP for t in hb), "%d hardBeats après le drop" % len(hb))
    exp = [DROP + 0.46875 * k for k in range(1, 38)]
    hit = sum(1 for e in exp if any(abs(t - e) < 0.08 for t in hb))
    check(hit >= 0.7 * len(exp), "hardBeats alignés sur les kicks : %d/%d à ±80 ms" % (hit, len(exp)))
    check(len(an["introBeats"]) >= 6 and all(t < an["buildUpStart"] for t in an["introBeats"]), "%d introBeats avant la montée" % len(an["introBeats"]))
    check(len(an["wave"]) == 1000, "forme d'onde 1000 points")

    # ---------------------------------------------------------------- 2. mapping
    r = pg.evaluate("""(arg) => { const [rec, an] = arg, M = ENOS.editMap, pl = M.gamePlies(rec), sl = M.autoSlots(an, pl), tl = M.build(pl, sl, an);
        return { pl: pl.map(p => [p.n, p.san, p.drama, p.tags]), key: tl.key.map(e => [e.t, e.n, e.kind, e.fx, e.cut && e.cut.text]), all: tl.events.map(e => [e.t, e.ply, e.kind]), man: M.manifest(rec, tl, an, {audioName: 's.wav'}) }; }""", [rec, an])
    pl, key = r["pl"], r["key"]
    drop = max(pl, key=lambda p: p[2])
    check(any(k[2] == "drop" and k[1] == drop[0] and abs(k[0] - an["mainDropTimestamp"]) < 1e-6 for k in key), "le coup le plus dramatique (coup %d %s, %s) est verrouillé sur le DROP" % (drop[0], drop[1], drop[2]))
    check(key[-1][1] == 33, "le dernier coup (mat) clôt l'edit")
    ts = [k[0] for k in key]
    check(ts == sorted(ts) and [k[1] for k in key] == sorted(set(k[1] for k in key)), "ordre de la partie respecté (%d coups clés)" % len(key))
    allp = [e[1] for e in r["all"]]
    check(len(allp) == len(set(allp)), "aucun coup joué deux fois (%d événements dont %d accélérés)" % (len(allp), sum(1 for e in r["all"] if e[2] == "ff")))
    check(any(k[3] == "BOSS_AWAKENING" for k in key), "transformation du boss : effet BOSS_AWAKENING")
    check(any(k[3] == "BRILLIANT_SHOCKWAVE" for k in key), "coup brillant : BRILLIANT_SHOCKWAVE")
    man = r["man"]
    check(man["audio"]["name"] == "s.wav" and man["events"][0]["from_xy"] is not None and all(isinstance(e["t"], (int, float)) for e in man["events"]), "manifeste : audio, cases, temps")
    check(all(e["effect"] in ("SHAKE_HEAVY", "BRILLIANT_SHOCKWAVE", "BOSS_AWAKENING", "PROMOTION_CUTSCENE", "BLUNDER_RED", "BEAT", "FASTFORWARD") for e in man["events"]), "types d'effets du manifeste")
    open(os.path.join(tmp, "manifest.json"), "w", encoding="utf-8").write(json.dumps(man))
    print("manifeste de test :", os.path.join(tmp, "manifest.json"))
    # mode manuel
    mk = pg.evaluate("""([rec, an]) => { const M = ENOS.editMap, pl = M.gamePlies(rec), sl = M.manualSlots([{t: 5, type: 'beat'}, {t: 9, type: 'drop'}, {t: 12, type: 'beat'}, {t: 14, type: 'brill'}, {t: 18, type: 'beat'}], pl), tl = M.build(pl, sl, an); return tl.key.map(e => [e.t, e.n, e.kind]); }""", [rec, an])
    check(len(mk) >= 4 and [m[1] for m in mk] == sorted(m[1] for m in mk), "mode manuel : %s" % mk)

    # ---------------------------------------------------------------- 3. aperçu 3D temps réel
    pg.click("#ce-play")
    pg.wait_for_selector(".ce-stage .ce-cam")
    pg.wait_for_timeout(1500)
    info = pg.evaluate("""() => { const c = document.querySelector('.ce-cam'), p = document.querySelector('.ce-persp'), b = document.querySelector('.ce-board');
        return { persp: getComputedStyle(p).perspective, board: getComputedStyle(b).filter, pieces: document.querySelectorAll('.ce-pcs img').length, vig: !!document.querySelector('.ce-vig') }; }""")
    check(info["persp"] == "900px", "perspective 900px")
    check("grayscale" in info["board"], "échiquier noir & blanc contrasté")
    check(info["pieces"] == 32 or info["pieces"] > 0, "pièces dessinées (%d)" % info["pieces"])
    # on saute le temps : audio -> juste avant puis après le drop
    pg.evaluate("document.querySelectorAll('audio').length")
    for t, name in ((5, "intro"), ):
        pass
    if SHOTS:
        pg.screenshot(path=os.path.join(SHOTS, "ce_intro.png"))
    pg.wait_for_timeout(500)
    # lecture réelle : on attend le premier coup clé puis on capture
    pg.wait_for_function("document.querySelectorAll('.ce-pcs img').length > 0 && document.querySelector('.ce-prog i').style.transform !== 'scaleX(0)'", timeout=20000)
    pg.wait_for_timeout(3500)
    if SHOTS:
        pg.screenshot(path=os.path.join(SHOTS, "ce_play.png"))
    # direct sur la scène : impact brillant + cutscene + réplique
    res = pg.evaluate("""() => { const E = ENOS, host = document.createElement('div'); document.getElementById('app').appendChild(host);
        const st = new E.editFx.Stage(host, { title: 'direct' });
        const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
        const ev = { from: 'h5', to: 'f7', fen: 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4', piece: 'q', color: 'w', tone: 'cyan', fx: 'BRILLIANT_SHOCKWAVE', key: 'brilliant', captured: 'p', kind: 'hard' };
        st.setFen(fen); st.move(ev); st.hit(ev, 1); st.cutscene({ text: 'THE ROOK !', piece: 'r', color: 'w' }, 'cyan'); st.say('ghorghor', 'Att att... c\\'est réel.');
        return new Promise((ok) => setTimeout(() => { const o = { cut: !st.cut.hidden, cap: !st.cap.hidden, halo: st.fxl.querySelectorAll('.ce-halo,.ce-ring,.ce-bang').length, shake: st.shake, burst: st.burst.length, cam: st.cam.style.transform, abr: !!st.wrap.style.filter };
          if (document.querySelector('.ce-stage:last-of-type')) window.__st = st; ok(o); }, 450)); }""")
    print(res)
    check(res["cut"] and res["cap"], "cutscene « THE ROOK ! » et réplique de bot affichées")
    check(res["halo"] >= 3, "halo + ondes de choc + « !! » (%d éléments)" % res["halo"])
    check(res["shake"] > 0.4 and res["burst"] > 0, "screen shake + particules d'explosion")
    check("rotateX" in res["cam"] and "scale(" in res["cam"], "caméra 3D : " + res["cam"][:90])
    check(res["abr"], "aberration chromatique active pendant l'impact")
    if SHOTS:
        pg.screenshot(path=os.path.join(SHOTS, "ce_fx.png"))
    pg.evaluate("document.querySelectorAll('.ce-stage').forEach(e => e.remove())")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()

print("ECHECS :", BAD if BAD else "aucun")
raise SystemExit(1 if BAD else 0)
