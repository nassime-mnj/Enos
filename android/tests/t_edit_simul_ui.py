"""Chess Edit Simultanée par l'interface : ouvrir la partie, APERÇU RAPIDE et GÉNÉRER ne doivent pas répondre « Timeline indisponible »."""
from mobile_common import *

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(120000)
    pg.wait_for_function("window.ENOS && !!ENOS.editSimul && !!ENOS.chessEdit")
    pg.evaluate("""() => {
      const G = [
        ['e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#', 'w', [18, 24]],
        ['f3 e5 g4 Qh4#', 'b', [1]],
        ['e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7 Kxf7 Qf3+ Ke6 Nc3 Nb4 Qe4 c6', '*', []],
        ['d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6 cxd5 Nxd5 Bxe7 Qxe7', '*', []]];
      const boards = G.map(([san, res, br], i) => { const ch = new Chess(), mv = []; san.split(' ').forEach((s, k) => { const m = ch.move(s); mv.push([m.from + m.to + (m.promotion || ''), m.san, br.includes(k) ? 'brilliant' : (k === 2 && i === 2 ? 'blunder' : 'good'), 3, null, '', '']); }); return { name: ['Lina', 'Nassime', 'Omar', 'Sam'][i], talk: '', human: true, elo: 1200 + i * 50, mv, result: res }; });
      const order = []; for (let k = 0; k < 40; k += 2) { boards.forEach((bd, i) => { if (bd.mv.length > k) order.push([i, k]); }); boards.forEach((bd, i) => { if (bd.mv.length > k + 1) order.push([i, k + 1]); }); }
      const rec = { t: 9, title: 'Simultanée', result: "L'équipe gagne", plies: 33, brill: 3, pw: 'ETO', pb: 'Équipe', pk: ['team', 'team'], me: null, ch: [], mv: boards[0].mv, simul: { boss: { name: 'ETO', talk: 'eto', elo: 3000, kind: 'eto' }, boards, order, team: 1 } };
      
      ENOS.settings.set('simul.hist', [rec]); window.__rec = rec; }""")
    pg.evaluate("ENOS.chessEdit.open(window.__rec)")
    pg.wait_for_selector("#ce-play")
    check("Simultanée" in pg.inner_text("#ce-sum"), "résumé Simultanée affiché : %s" % pg.inner_text("#ce-sum")[:80])
    pg.click("#ce-play"); pg.wait_for_selector(".ce-cvp"); pg.wait_for_timeout(2500)
    toasts = pg.evaluate("[...document.querySelectorAll('.toast, [class*=toast]')].map((x) => x.textContent).join('|')")
    check("indisponible" not in toasts and pg.locator(".ce-cvp").count() == 1, "aperçu rapide lancé sans erreur : %s" % toasts[:100])
    pg.click(".ce-x"); pg.wait_for_timeout(300)
    pg.click("#ce-gen"); pg.wait_for_selector(".ce-genbox", timeout=20000)
    toasts = pg.evaluate("[...document.querySelectorAll('.toast, [class*=toast]')].map((x) => x.textContent).join('|')")
    check("indisponible" not in toasts, "génération démarrée sans erreur : %s" % toasts[:100])
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
