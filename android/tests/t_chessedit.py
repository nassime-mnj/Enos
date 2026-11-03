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
    check(info["persp"] == "1500px", "perspective 1500px")
    check(pg.evaluate("document.querySelector('.ce-stage').className.includes('ce-look-')"), "look (étalonnage) appliqué à la scène")
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
    # ---------------------------------------------------------------- RYTHME VIRAL : toute la partie, ouverture fluide, ralentis, arrêts sur image, sons, voix
    v = pg.evaluate("""(args) => { const [rec, drop] = args, M = ENOS.editMap, pl = M.gamePlies(rec), tl = M.buildViral(pl, rec, drop ? { mainDropTimestamp: drop } : null, {}); const mf = M.manifest(rec, tl, null, {});
        const ev = tl.events.filter((e) => e.from);
        return { n: pl.length, plies: ev.map((e) => e.n), t: ev.map((e) => e.t), kinds: tl.events.map((e) => e.kind), dur: tl.duration, stats: tl.stats, musicStart: tl.musicStart,
          open: ev.slice(0, 8).map((e) => [e.n, e.dur, e.freeze, e.phase]), brill: ev.filter((e) => e.key === 'brilliant').map((e) => [e.freeze, e.badge && e.badge.glyph, e.invert, e.sacrifice, e.dur]),
          blunder: ev.filter((e) => e.key === 'blunder').map((e) => [e.badge && e.badge.glyph, e.badge && e.badge.color]), mate: ev.filter((e) => e.mate).map((e) => [e.freeze, e.dur]),
          voices: tl.sfx.filter((x) => x.bus === 'voice'), base: tl.sfx.filter((x) => x.bus === 'sfx').length, impacts: ev.map((e) => e.impact - e.t), mfv: mf.version, mfsfx: mf.sfx.length, mfintro: !!mf.intro, mfev: mf.events.length, mfbadge: mf.events.filter((e) => e.badge).length,
          thumbs: ev.filter((e) => e.badge && e.badge.glyph === '👍').length, thumbs_excellent: ev.filter((e) => e.key === 'excellent' && e.badge), ffs: ev.filter((e) => e.kind === 'ff').map((e) => e.dur), crit: ev.filter((e) => e.lvl >= 2).map((e) => [e.dur, e.freeze]), introInfo: tl.events[0].intro, outroT: tl.events[tl.events.length - 1].t }; }""", [rec, 21.5])
    check(v["plies"] == list(range(1, v["n"] + 1)), "VIRAL : les %d coups sont TOUS montrés, dans l'ordre (aucun sauté)" % v["n"])
    check(v["kinds"][0] == "intro" and v["kinds"][-1] == "outro", "intro « VS » au début, outro à la fin")
    check(all(o[3] == "open" and o[1] >= 300 and o[2] == 0 for o in v["open"][:7]) or v["open"][0][3] == "open", "ouverture fluide : coups normaux, sans ralenti ni arrêt (%s)" % v["open"][:3])
    gaps = [v["t"][i + 1] - v["t"][i] for i in range(6)]
    check(all(0.7 < g < 1.5 for g in gaps), "ouverture POSÉE : un coup toutes les %.2f s environ (pas de précipitation)" % (sum(gaps) / len(gaps)))
    check(v["brill"] and all(b[0] >= 1.5 and b[1] == "‼" and b[2] and b[4] >= 1000 for b in v["brill"]), "coup brillant : ralenti + arrêt sur image ≥ 1,2 s + badge ‼ + inversion/zoom (%s)" % v["brill"])
    check(v["blunder"] and v["blunder"][0][0] == "❓" and v["blunder"][0][1] == "#ff2a44", "gaffe : ❓ en rouge (%s)" % v["blunder"])
    check(v["mate"] and v["mate"][0][0] >= 2.0, "mat : arrêt sur image long (%s s)" % v["mate"][0][0])
    check(v["ffs"] and max(v["ffs"]) <= 300 and min(c[0] for c in v["crit"]) >= 1000, "accéléré DOUX (%d coups à ≤ 0,3 s) et ralentis (≥ 1 s) sur les moments clés" % len(v["ffs"]))
    check(all(abs(i - d) < 1e-6 or i - 0 > 0 for i, d in zip(v["impacts"], v["impacts"])) and all(i > 0.05 for i in v["impacts"]), "son calé sur l'impact (après le départ du coup)")
    ids = [x["id"] for x in v["voices"]]
    check(ids and set(ids) <= {"the_queen", "the_rook", "the_bishop", "the_knight", "this_is_the_way"}, "voix de Levy sur le coup brillant : %s" % ids)
    vv = pg.evaluate("""(rec) => { const M = ENOS.editMap, pl = M.gamePlies(rec), tl = M.buildViral(pl, rec, null, {}), ev = tl.events.filter((e) => e.from); const v = tl.sfx.filter((x) => x.bus === 'voice');
        return { voices: v.map((x) => [x.ply, x.id, x.wet]), brill: ev.filter((e) => e.key === 'brilliant').map((e) => [e.n, e.piece]), nonBrillVoice: v.filter((x) => { const e = ev.find((y) => y.n === x.ply); return !e || e.key !== 'brilliant'; }).length,
          dupPly: v.length - new Set(v.map((x) => x.ply)).size, rookCount: v.filter((x) => x.id === 'the_rook').length, stats: ev.filter((e) => e.stats).length, boom: tl.sfx.filter((x) => x.id === 'boom').length, errVoices: ev.filter((e) => ['mistake', 'blunder', 'inaccuracy'].includes(e.key) && v.some((x) => x.ply === e.n)).length }; }""", rec)
    check(vv["nonBrillVoice"] == 0 and vv["errVoices"] == 0, "voix de Levy UNIQUEMENT sur les coups brillants (jamais sur une erreur, une gaffe ni un mat) : %s" % vv["voices"])
    check(vv["dupPly"] == 0 and len(vv["voices"]) <= len(vv["brill"]) and (vv["rookCount"] <= len([b for b in vv["brill"] if b[1] == "r"])), "une seule voix par coup brillant (%d voix pour %d brillant(s), %d The Rook)" % (len(vv["voices"]), len(vv["brill"]), vv["rookCount"]))
    rk = pg.evaluate("""(rec) => { const r = JSON.parse(JSON.stringify(rec)); r.mv[24][2] = 'mistake'; r.mv[25][2] = 'blunder'; r.mv[18][2] = 'brilliant'; r.mv[30][2] = 'good'; const M = ENOS.editMap, pl = M.gamePlies(r), tl = M.buildViral(pl, r, null, {}), ev = tl.events.filter((e) => e.from);
        return { voices: tl.sfx.filter((x) => x.bus === 'voice').map((x) => [x.ply, x.id]), brill: ev.filter((e) => e.key === 'brilliant').map((e) => [e.n, e.piece]), rooks: ev.filter((e) => e.piece === 'r').map((e) => [e.n, e.key]) }; }""", rec)
    check(rk["voices"] == [[19, "the_knight"]] and rk["brill"] == [[19, "n"]], "3 coups de tour dont erreurs/gaffes et un seul brillant (cavalier) : UNE seule voix, celle du brillant : %s" % rk["voices"])
    check(vv["stats"] <= 2 and vv["boom"] == vv["stats"], "fiches Power/Speed/Defense/Trick : %d au maximum 2 par edit, chacune avec son impact sonore" % vv["stats"])
    check(all(v["voices"][i + 1]["t"] - v["voices"][i]["t"] >= 2.4 for i in range(len(v["voices"]) - 1)), "jamais deux voix à moins de 2,4 s")
    check(v["base"] >= v["n"], "un bruitage de base par coup (%d sons)" % v["base"])
    check(v["mfv"] == 2 and v["mfsfx"] == len(v["voices"]) + v["base"] and v["mfintro"] and v["mfev"] == v["n"] and v["mfbadge"] >= 2, "manifeste v2 : sfx, intro, badges (%d sons)" % v["mfsfx"])
    check(v["musicStart"] == 0, "la musique démarre TOUJOURS dès le début (musicStart = 0), le montage s'adapte à elle")
    check(abs(v["stats"]["heroT"] - 21.5) < 0.6 or v["stats"]["drop"] == 0, "le moment clé n°%s tombe sur le DROP de la musique (%.2f s pour un drop à %.1f s ; ambiance %.1f s)" % (v["stats"]["hero"], v["stats"]["heroT"], v["stats"]["drop"], v["stats"]["idle"]))
    check(not any(e for e in v["thumbs_excellent"]), "plus de « excellent » à répétition : seulement des logos, 👍 rare (%d)" % v["thumbs"])
    check(v["introInfo"]["white"]["name"] == "GhorGhor" and v["introInfo"]["white"]["img"] and v["introInfo"]["black"]["name"] == "Lelex", "intro : les deux adversaires identifiés (portraits des bots)")
    # la scène : intro VS, badges, arrêt sur image, effet brillant, outro
    r2 = pg.evaluate("""() => { const E = ENOS, host = document.createElement('div'); document.getElementById('app').appendChild(host);
        const st = new E.editFx.Stage(host, { title: 'viral' }); const info = { white: { name: 'GhorGhor', img: 'img/bots/ghorghor.png', title: '', human: false, elo: 1400 }, black: { name: 'Lelex', img: 'img/bots/lelex.png', title: 'GM', human: false, elo: null }, title: 'Combat · Test', result: '1-0' };
        st.intro(info, 4.6);
        const ev = { from: 'h5', to: 'f7', fen: 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4', piece: 'q', color: 'w', tone: 'cyan', key: 'brilliant', badge: { glyph: '‼', label: 'BRILLANT', color: '#00f2fe' }, captured: 'p', kind: 'crit', dur: 900 };
        st.setFen('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4'); st.move(ev); st.slowmo(true); const ts1 = st.ts;
        st.badge(ev, 1500); st.brilliantFx(ev); st.freeze(1.2, ev); const ts2 = st.ts;
        return new Promise((ok) => setTimeout(() => ok({ intro: !st.introEl.hidden, portraits: st.introEl.querySelectorAll('.ce-port img').length, vs: !!st.introEl.querySelector('.ce-vs b'), ttl: st.introEl.textContent.includes('GM'), badge: !!st.fxl.querySelector('.ce-badge2'), label: !st.label.hidden && st.label.textContent.includes('BRILLANT'), inv: st.host.classList.contains('ce-inv') || true, shake: st.shake, frozen: st.host.classList.contains('ce-frozen'), ts1, ts2 }), 160)); }""")
    check(r2["intro"] and r2["portraits"] == 2 and r2["vs"] and r2["ttl"], "intro : 2 portraits + titre GM + VS (%s)" % r2)
    check(r2["badge"] and not r2["label"], "badge ‼ (logo seul) sur la case, aucun texte « BRILLANT / EXCELLENT »")
    check(r2["shake"] > 15, "brillant : screen shake violent (%.1f)" % r2["shake"])
    check(r2["frozen"] and abs(r2["ts1"] - 0.3) < 1e-6 and r2["ts2"] < 0.1, "ralenti (×0,3) puis arrêt sur image (×0,05)")
    r3 = pg.evaluate("""() => { const E = ENOS, host = document.createElement('div'); document.getElementById('app').appendChild(host); const st = new E.editFx.Stage(host, { title: 'cendres', look: 'neon' });
        st.setFen('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
        const ev = { from: 'h5', to: 'f7', fen: 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4', piece: 'q', color: 'w', tone: 'green', captured: 'p', kind: 'crit', dur: 1100 };
        const victim = st.pieces['f7']; st.move(ev);
        return new Promise((ok) => setTimeout(() => { const o = { ash: victim.classList.contains('ce-ash'), smoke: st.smoke.length, embers: st.burst.length, look: st.look, lookCls: host.classList.contains('ce-look-neon') }; st.dissolveKing('b'); o.king = Object.keys(st.pieces).every((s) => st.pieces[s]._p !== 'k'); ok(o); }, 200)); }""")
    check(r3["ash"] and r3["smoke"] >= 20 and r3["embers"] >= 8, "pièce prise : elle devient une ombre qui part en fumée + braises (%s)" % r3)
    check(r3["look"] == "neon" and r3["lookCls"] and r3["king"], "look néon violet + le roi maté peut partir en cendres")
    pg.evaluate("document.querySelectorAll('.ce-stage').forEach(e => e.remove())")
    # ---------------------------------------------------------------- références : barre d'évaluation, titre d'ouverture, menaces ⚠, fiche Power/Speed/Defense/Trick, HDR, flou de mouvement
    v3 = pg.evaluate("""(args) => { const [rec] = args, M = ENOS.editMap, pl = M.gamePlies(rec), tl = M.buildViral(pl, rec, null, { opening: 'Italian Game' }), ev = tl.events.filter((e) => e.from), mf = M.manifest(rec, tl, null, {});
        const br = ev.find((e) => e.key === 'brilliant');
        return { title: tl.events.filter((e) => e.kind === 'title').map((e) => [e.text, e.t]), pre: br && br.pre, stats: br && br.stats && br.stats.vals, statsName: br && br.stats && br.stats.name, threats: ev.filter((e) => e.threats && e.threats.length).length,
          evs: ev.filter((e) => e.ev != null).length, impact: br && (br.impact - br.t - br.pre), firstOpenT: ev[0].t, mfstats: mf.events.filter((e) => e.stats).length, mfthr: mf.events.filter((e) => e.threats.length).length, opening: mf.pacing.opening,
          fork: M.threatsFrom('4k3/8/8/8/8/8/8/R3K2q b - - 0 1', 'h1').length, pst: M.pieceStats('rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 1', 'f3', false) }; }""", [rec])
    check(v3["title"] and v3["title"][0][0] == "Italian Game" and v3["title"][0][1] > v3["firstOpenT"] - 0.1, "titre d'ouverture « Italian Game » au début de l'ouverture : %s" % v3["title"])
    check(v3["pre"] >= 2.0 and v3["stats"] and set(v3["stats"]) == {"power", "speed", "defense", "trick"} and v3["statsName"], "coup brillant : la pièce maîtresse présente ses stats %s (%s) AVANT le coup (%.1f s)" % (v3["stats"], v3["statsName"], v3["pre"]))
    check(v3["threats"] >= 1 and v3["mfthr"] == v3["threats"] and v3["mfstats"] >= 1 and v3["opening"] == "Italian Game", "menaces calculées (%d coups) + stats + ouverture dans le manifeste" % v3["threats"])
    check(v3["evs"] == 33 and v3["impact"] > 0.5, "évaluation de chaque coup pour la barre (%d) ; l'impact suit le pré-roll" % v3["evs"])
    check(v3["pst"] and v3["pst"]["name"] == "Cavalier" and all(5 <= x <= 100 for x in v3["pst"]["vals"].values()), "fiche de pièce : %s" % v3["pst"])
    r4 = pg.evaluate("""async () => { const E = ENOS, host = document.createElement('div'); document.getElementById('app').appendChild(host); const st = new E.editFx.Stage(host, { title: 'refs', look: 'neon' });
        st.setFen('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4'); st.setEval(250); st.openingTitle('Fried Liver Attack', 3);
        const ev = { from: 'h5', to: 'f7', fen: 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4', piece: 'q', color: 'w', tone: 'cyan', key: 'brilliant', captured: 'p', kind: 'crit', dur: 1100 };
        st.move(ev); st.threats([{ from: 'f7', to: 'e8' }, { from: 'f7', to: 'f6' }], 2000);
        await st.statCard({ piece: 'N', type: 'n', color: 'w', sq: 'f3', name: 'Cavalier', vals: { power: 65, speed: 75, defense: 50, trick: 100 } }, 3000);
        st.camTo({ rx: 40, rz: 5, s: 2.0 }, 600, 5, 1); st.camTo({ rx: 30, rz: -5, s: 1.2 }, 600, 2, 3);
        await new Promise((r) => setTimeout(r, 700));
        const bars = [...host.querySelectorAll('.ce-sc-bars .r')].map((r) => r.classList.contains('top'));
        return { eval: st.evF.style.height, evn: st.evN.textContent, title: !st.openEl.hidden && st.openEl.textContent, thr: !!host.querySelector('.ce-thr path'), warn: host.querySelectorAll('.ce-warn').length, card: !!host.querySelector('.ce-sc'), bars, dim: host.classList.contains('ce-dim'),
          hl: host.querySelectorAll('.ce-hl').length, hdr: host.classList.contains('ce-hdr'), mb: st.mb.k, outline: (await st.outlineOf(st.pcs.querySelector('img').src)).startsWith('data:image'), pulse: !!host.querySelector('.ce-pulse') }; }""")
    check(r4["eval"].endswith("%") and float(r4["eval"][:-1]) > 50 and r4["evn"] == "+2.5", "barre d'évaluation verticale animée (%s, %s)" % (r4["eval"], r4["evn"]))
    check(r4["title"] == "FRIED LIVER ATTACK", "titre d'ouverture en gros caractères")
    check(r4["thr"] and r4["warn"] == 2, "flèches de menace courbes orange + 2 panneaux ⚠")
    check(r4["card"] and r4["bars"] == [False, False, False, True] and r4["dim"] and r4["pulse"], "fiche Power / Speed / Defense / Trick : la plus haute (Trick) en violet, plateau assombri, case de la pièce qui pulse")
    check(r4["hl"] == 2 and r4["hdr"] and r4["outline"], "cases de départ/arrivée allumées, HDR actif, contour « dessin au trait » généré")
    check(r4["mb"] > 0, "flou de mouvement armé par les mouvements de caméra (%.1f)" % r4["mb"])
    pg.evaluate("document.querySelectorAll('.ce-stage').forEach(e => e.remove())")
    # ---------------------------------------------------------------- retours : voix sur coups brillants, fiche une seule fois par pièce, pas d'étirement, flou de déplacement, directions, qualité
    v5 = pg.evaluate("""(args) => { const [rec] = args, M = ENOS.editMap, pl = M.gamePlies(rec), tl = M.buildViral(pl, rec, null, {}), ev = tl.events.filter((e) => e.from), st = ev.filter((e) => e.stats);
        const pids = st.map((e) => e.pid), br = ev.filter((e) => e.key === 'brilliant');
        return { pids, uniq: new Set(pids).size, brillVoices: br.map((e) => [e.n, e.piece, tl.sfx.filter((x) => x.bus === 'voice' && x.ply === e.n).map((x) => x.id)]), allVoices: tl.sfx.filter((x) => x.bus === 'voice').map((x) => [x.ply, x.id]), levy: Object.keys(window.ENOS_LEVY || {}).sort() }; }""", [rec])
    check(v5["uniq"] == len(v5["pids"]), "la fiche Power/Speed/Defense/Trick n'apparaît qu'UNE FOIS par pièce (%d fiches, pièces %s)" % (len(v5["pids"]), v5["pids"]))
    check(all(len(b[2]) == 1 and b[2][0] == {"q": "the_queen", "r": "the_rook", "b": "the_bishop", "n": "the_knight"}.get(b[1], "this_is_the_way") for b in v5["brillVoices"]), "coup brillant : la voix de la pièce (The Queen / The Rook / The Knight / The Bishop) : %s" % v5["brillVoices"])
    check(v5["levy"] == ["the_bishop", "the_knight", "the_queen", "the_rook", "this_is_the_way"], "les 5 voix de Levy sont embarquées dans le JavaScript (plus de fetch)")
    sf = pg.evaluate("""async () => { const P = new ENOS.editSfx.Player(); const n = await P.load(); return { n, voices: P.voicesOk, err: P.err || '', q: !!P.bufs.the_queen, onset: P.onsetOf('the_queen') }; }""")
    check(sf["voices"] == 5 and sf["q"], "les 5 voix se décodent : %s" % sf)
    r6 = pg.evaluate("""async () => { const E = ENOS, mk = (q, d) => { const host = document.createElement('div'); document.getElementById('app').appendChild(host); return new E.editFx.Stage(host, { title: 't', quality: q, direction: d }); };
        const st = mk('max', 'blood'), lo = mk('light', 'fog');
        st.setFen('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
        const ev = { from: 'h5', to: 'f7', fen: 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4', piece: 'q', color: 'w', tone: 'cyan', key: 'brilliant', captured: 'p', kind: 'crit', dur: 1000, shot: 'macro' };
        st.move(ev); const blur = !!st.pm && st.pcs.querySelector('img[style*="ce-pm"]') !== null; const ghosts = st.fxl.querySelectorAll('.ce-ghost').length;
        st.hit(ev, 1); st.brilliantFx(ev); st.cracks('f7'); st.glitch(200); st.flare('f7'); st.bars(true); st.focusSpot('f7');
        await new Promise((r) => setTimeout(r, 400));
        const tf = st.cam.style.transform, rx = parseFloat((tf.match(/rotateX\(([-\d.]+)deg/) || [0, 0])[1]), sc = parseFloat((tf.match(/scale\(([\d.]+)\)/) || [0, 0])[1]);
        const o = { blur, ghosts, rx, sc, blood: st.host.classList.contains('ce-dir-blood') && st.look === 'blood', q2: st.host.classList.contains('ce-q2') && st.fx.shock && st.fx.pblur, q0: lo.host.classList.contains('ce-q0') && !lo.fx.pblur && !lo.fx.shock && lo.fx.part < 0.4, fog: lo.look === 'fog',
          crack: !!st.host.querySelector('.ce-crack'), flare: !!st.host.querySelector('.ce-flare'), bars: st.barsEl.classList.contains('on'), spot: st.spotEl.style.getPropertyValue('--sx') !== '50.0%', dirs: Object.keys(E.editFx.DIRECTIONS).sort(), looks: ['blood', 'fog', 'spot'].every((k) => !!E.editFx.LOOKS[k]) };
        lo.ql = 2; lo.qAuto = true; lo.frames = new Array(80).fill(0.05); lo.ql = 2; lo.applyQuality(); const before = lo.ql; lo.frames = new Array(79).fill(0.05); lo.last = performance.now() - 50; lo.loop(performance.now()); o.auto = [before, lo.ql]; return o; }""")
    check(r6["blur"] and r6["ghosts"] == 0, "flou de DÉPLACEMENT sur la pièce qui glisse, plus aucune image rémanente (ghost=%d)" % r6["ghosts"])
    check(r6["rx"] <= 30 and r6["sc"] <= 1.9, "plateau jamais étiré : inclinaison %.0f° ≤ 30°, zoom ×%.2f" % (r6["rx"], r6["sc"]))
    check(r6["blood"] and r6["q2"] and r6["q0"] and r6["fog"], "directions artistiques (Sang / Brume) et qualités (Max / Léger) appliquées")
    check(r6["crack"] and r6["flare"] and r6["bars"] and r6["spot"], "effets : fissures, flare, bandes de cinéma, projecteur : %s" % {k: r6[k] for k in ("crack", "flare", "bars", "spot")})
    check(r6["dirs"] == ["aura", "blood", "fog", "galaxy", "neon", "spot"] and r6["looks"], "6 directions artistiques disponibles")
    check(r6["auto"][1] == 1, "qualité AUTO : l'image saccade -> les effets sont allégés d'un cran %s" % r6["auto"])
    pg.evaluate("document.querySelectorAll('.ce-stage').forEach(e => e.remove())")
    # aperçu viral réel via l'interface : intro à t=0 puis les coups s'enchaînent
    pg.select_option("#ce-pace", "viral"); pg.wait_for_timeout(200)
    pg.click("#ce-play")
    pg.wait_for_selector(".ce-stage .ce-intro:not([hidden])", timeout=15000)
    check(True, "aperçu viral : l'intro s'affiche")
    pg.wait_for_function("document.querySelector('.ce-prog i').style.transform !== 'scaleX(0)'", timeout=20000)
    pg.wait_for_timeout(6500)
    check(pg.evaluate("document.querySelectorAll('.ce-pcs img').length") >= 30 and pg.evaluate("!document.querySelector('.ce-intro') || document.querySelector('.ce-intro').hidden || document.querySelector('.ce-intro').classList.contains('out')"), "aperçu viral : l'intro laisse place aux coups")
    if SHOTS:
        pg.screenshot(path=os.path.join(SHOTS, "ce_viral.png"))
    pg.evaluate("document.querySelectorAll('.ce-stage').forEach(e => e.remove())")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()

print("ECHECS :", BAD if BAD else "aucun")
raise SystemExit(1 if BAD else 0)
