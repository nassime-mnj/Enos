"""Chess Edit : bouton « GÉNÉRER L'EDIT » -> barre de progression -> lecteur <video> + téléchargement."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    ev = pg.evaluate
    rec = ev("""() => { const P = ENOS.prime; let fen = P.START; const ch = new Chess(); const acts = []; const sans = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5'];
      sans.forEach((s, i) => { const m = ch.move(s); acts.push({ k: 'mv', side: m.color, seat: i % 2, key: i === 8 ? 'brilliant' : 'good', ev: null, from: m.from, to: m.to, piece: m.piece, cap: m.captured || '', promo: '', uci: m.from + m.to, san: m.san, fen: ch.fen(), cheat: '' }); });
      return { variant: true, mode: 'prime', t: Date.now(), title: 'mini', result: 'ChatGPT Prime gagne', plies: acts.length, pw: 'Toi', pb: 'ChatGPT Prime', me: 'w', ch: [], mv: acts.map((a) => [a.uci, a.san, a.key, 0, null, '']), v: { mode: 'prime', acts, start: P.START, over: 'end' } }; }""")
    ev("(rec) => { const l = ENOS.settings.get('variants.hist', []); l.push(rec); ENOS.settings.set('variants.hist', l); }", rec)
    open_tool(pg, "chessedit")
    pg.wait_for_selector("#ce-gen", state="attached")
    pg.select_option("#ce-pace", "viral"); pg.wait_for_timeout(300)
    check("ne bouge" not in pg.inner_text("#ce-sum").lower(), "résumé : %s" % pg.inner_text("#ce-sum")[:110])
    # le panneau de configuration ne se superpose plus (les textes d'aide sont dans le flux)
    pos = ev("[...document.querySelectorAll('#tool-chessedit p.ce-stat')].map((p) => getComputedStyle(p).position)")
    check(all(x == "static" for x in pos), "textes d'aide du panneau dans le flux (plus de position:absolute) : %s" % pos)
    ov = ev("""() => { const a = [...document.querySelectorAll('#tool-chessedit .card')].map((c) => c.getBoundingClientRect()); return a.every((r, i) => !i || r.top >= a[i - 1].bottom - 1); }""")
    check(ov, "les cartes du studio ne se chevauchent pas")
    pg.click("#ce-gen")
    pg.wait_for_selector(".ce-gbar i", timeout=5000)
    check(True, "barre de progression « Génération de l'edit »")
    pg.wait_for_selector(".ce-genbox video", timeout=240000)
    info = pg.inner_text(".ce-genbox .ce-gmsg")
    check("60 FPS" in info and ("WebCodecs" in info or "MediaRecorder" in info), "lecteur <video controls autoplay loop> + infos : %s" % info)
    check(pg.locator("#ce-dl").is_visible() and pg.evaluate("document.querySelector('.ce-genbox video').loop && document.querySelector('.ce-genbox video').controls"), "bouton « TÉLÉCHARGER LE MP4 » + vidéo en boucle")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
