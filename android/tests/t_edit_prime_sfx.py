"""ChatGPT Prime : triches résurrection / invention / conversion ; dans le Chess Edit chaque coup aberrant est ANNONCÉ (flèche verte ou case visée + message fier de ChatGPT), la flèche s'efface puis le coup est joué ; prise aberrante = gunshot ; mort de Mario dans les sons de mat. Plus aucun « BANG ! »."""
import json, os, base64
from mobile_common import *

AN = os.environ.get("ANALYSIS", "/tmp/claude-0/aud/user_music_analysis.json")
OUT = os.environ.get("SHOTS", "")
errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(180000)
    pg.wait_for_function("window.ENOS && ENOS.prime && ENOS.editMap && window.ENOS_EDITSFX")
    au = json.load(open(AN))
    check(all(pg.evaluate("['sx_gunshot', 'sx_mariodeath'].map((k) => !!window.ENOS_EDITSFX[k])")), "gunshot et mort de Mario embarqués")
    # ---- moteur de triche : les 3 nouvelles triches existent et donnent des positions valides
    t = pg.evaluate("""() => { const P = ENOS.prime, seen = {}, bad = [];
      const fens = ['rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/1NBQKBN1 w - - 0 5', 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', '4k3/8/3q4/8/8/8/3B4/4K3 w - - 0 30'];
      for (let r = 0; r < 120; r++) for (const f of fens) { const c = P.makeCheat(f, true, {}); if (!c) continue; seen[c.type] = (seen[c.type] || 0) + 1;
        if (c.type === 'convert') { const o = P.parse(f).b[c.to]; if (!o || o === o.toUpperCase() || c.b[c.to] !== o.toUpperCase()) bad.push('convert ' + c.to); }
        if (c.type === 'revive' && P.parse(f).b[c.to]) bad.push('revive occupé'); if (!P.safe(c.b, true)) bad.push(c.type + ' laisse le roi en échec'); }
      const sp = new Set(); for (let r = 0; r < 200; r++) { const c = P.makeCheat(fens[1], true, {}); if (c && c.type === 'spawn') sp.add(c.piece); }
      return { seen, bad, spawn: [...sp] }; }""")
    print(t)
    check(t["seen"].get("convert", 0) > 0 and t["seen"].get("revive", 0) > 0 and t["seen"].get("spawn", 0) > 0 and not t["bad"], "triches : conversion d'une pièce adverse, résurrection d'une pièce perdue, pièce inventée (%s)" % t["seen"])
    check(len(t["spawn"]) >= 2, "pièces inventées variées : %s" % t["spawn"])
    # ---- une vraie partie Prime avec des triches
    for attempt in range(12):
        rec = pg.evaluate("""async () => { const P = ENOS.prime, st = P.newState(true, false); let n = 0;
          while (!st.over && n < 80) { const ch = new Chess(st.fen);
            if (ch.turn() === 'w') { const r = await P.turn(st, {}); r.acts.forEach((a) => st.acts.push(a)); if (r.over) break; }
            else { const ms = ch.moves({ verbose: true }); if (!ms.length) break; const m = ms[Math.floor(Math.random() * ms.length)]; ch.move(m); st.acts.push({ k: 'mv', side: 'b', seat: 1, key: 'good', ev: null, from: m.from, to: m.to, piece: m.piece, cap: m.captured || '', promo: '', uci: m.from + m.to, san: m.san, fen: ch.fen(), cheat: '' }); st.fen = ch.fen(); }
            n++; }
          const acts = st.acts; return { variant: true, mode: 'prime', t: 777, title: 't', result: 'ChatGPT Prime gagne', plies: acts.length, pw: 'ChatGPT Prime', pb: 'Toi', me: 'b', ch: [], mv: acts.map((a) => [a.uci, a.san, 'good', 0, null, '']), v: { mode: 'prime', acts, start: P.START, over: 'kill' },
            _cap: acts.filter((a) => a.cheat && a.cheat !== 'double' && a.cheat !== 'revive' && a.cap).length, _drop: acts.filter((a) => a.k === 'drop' && a.cheat).length }; }""")
        if rec["_cap"] >= 1 and rec["_drop"] >= 1: break
    check(rec["_cap"] >= 1, "partie Prime avec %d prise(s) aberrante(s) et %d pièce(s) apparue(s) / convertie(s)" % (rec["_cap"], rec["_drop"]))
    r = pg.evaluate("""async ([rec, au]) => { const M = ENOS.editMap, pl = M.gamePlies(rec), tl = M.buildViral(pl, rec, au, { voices: true, intro: true, syncDrop: true });
      const ev = tl.events.filter((e) => (e.from || e.drop || e.cheat) && e.kind !== 'ff'), ill = ev.filter((e) => e.illegal && e.cheat !== 'twist');
      const cv = document.createElement('canvas'); cv.width = 540; cv.height = 960; const R = new ENOS.editRender.Renderer(cv, tl, { rec }); await R.load();
      const green = () => { const d = cv.getContext('2d').getImageData(0, 0, 540, 960).data; let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i + 1] > 150 && d[i] > 90 && d[i] < 160 && d[i + 2] < 110) n++; return n; };
      const out = ill.map((e) => { const A0 = e.t - (e.announce || 0); let sayAt = null, mid = {}, aft = {};
        if (e.announce) { const tm = A0 + e.announce * 0.6; R.draw(tm); mid = R.stateAt(tm); const g1 = green(); R.draw(e.t + 0.02); const g2 = green(); sayAt = { g1, g2 }; }
        aft = R.stateAt(e.impact + 0.05);
        return { san: e.san, cheat: e.cheat, ann: e.announce || 0, from: e.from, to: e.to, conv: e.conv, line: !!(e.lines && e.lines.length), gun: !!e.gunshot, midFrom: e.from ? mid.map && mid.map[e.from] || '' : '', aftTo: aft.map ? aft.map[e.to] || '' : '', green: sayAt }; });
      const shots = {}; const e0 = ill.find((e) => e.announce && e.from) || ill[0]; if (e0) for (const dt of [-0.7, -0.3, 0.1, 0.6]) { R.draw((dt < 0 ? e0.t : e0.impact) + (dt < 0 ? dt * (e0.announce || 1) : dt)); shots[dt] = cv.toDataURL('image/jpeg', 0.85); }
      return { ill: out, sfx: tl.sfx.map((x) => x.id), shots }; }""", [rec, au])
    ill = r["ill"]; print([(x["san"], x["cheat"], x["ann"]) for x in ill])
    check(len(ill) >= 2 and all(x["ann"] >= 0.45 for x in ill), "chaque coup aberrant montré a son annonce (≥ 0,45 s) avant d'être joué : %s" % [x["ann"] for x in ill])
    check(all(x["line"] for x in ill), "chaque coup aberrant a son message de ChatGPT")
    withf = [x for x in ill if x["from"]]
    check(all(x["midFrom"] for x in withf), "pendant l'annonce la pièce est encore sur sa case de départ (le coup n'est pas joué)")
    # sans case de départ (pièce inventée / ressuscitée / convertie) : seulement le cadre vert de la case visée
    check(all(x["green"]["g1"] > x["green"]["g2"] + (120 if x["from"] else 40) for x in ill if x["green"]), "flèche verte visible pendant l'annonce puis effacée au moment du coup : %s" % [x["green"] for x in ill][:4])
    check(all(x["aftTo"] for x in ill), "après l'impact la pièce est bien sur sa case d'arrivée")
    check(r["sfx"].count("sx_gunshot") == sum(1 for x in ill if x["gun"]) >= 1, "prise aberrante = gunshot (%d)" % r["sfx"].count("sx_gunshot"))
    if OUT:
        os.makedirs(OUT, exist_ok=True)
        for k, v in r["shots"].items(): open(os.path.join(OUT, "ann_%s.jpg" % k), "wb").write(base64.b64decode(v.split(",")[1]))
    check(not pg.evaluate("typeof ENOS.editRender.Renderer.prototype.bang === 'function' || typeof ENOS.editRender.Renderer.prototype.bangText === 'function'"), "plus de « BANG ! » de BD")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
