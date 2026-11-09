"""Chess Edit : intros / outros variés, icônes aléatoires pour les joueurs (jamais « Toi » écrit), affichage des équipes (intro, bandeau en jeu, victoire d'équipe)."""
import base64, os
from mobile_common import *

OUT = os.environ.get("SHOTS", "")
errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(300000)
    pg.wait_for_function("window.ENOS && ENOS.editMap && ENOS.editRender && !!ENOS.editRender.Renderer.prototype.endShatter")
    res = pg.evaluate("""async (OPEN) => {
      const mk = (names, teams, t) => { const ch = new Chess(), mv = []; OPEN.forEach((s) => { const m = ch.move(s); mv.push([m.from + m.to + (m.promotion || ''), m.san, 'good', 0, null, '', '']); });
        return { t, title: 'x', result: 'gagne', plies: mv.length, pw: names[0], pb: names[1], pk: ['a', 'b'], me: null, ch: [], mv, brill: 0, ...(teams ? { teams } : {}) }; };
      const solo = mk(['Toi', 'Nasko'], null, 1111), team = mk(['Toi + Bot 400 + Lelex + Joueur 2', 'ETO Brillant'], { w: [{ name: 'Toi', human: true }, { name: 'Bot 400', kind: 'sf', elo: 400 }, { name: 'Lelex', talk: 'lelex', elo: 1500 }, { name: 'Joueur 2', human: true }], b: [{ name: 'ETO Brillant', talk: 'eto', elo: 3200 }] }, 2222);
      const out = { frames: {}, info: {} }, M = ENOS.editMap;
      for (const [label, rec] of [['solo', solo], ['team', team]]) {
        const pl = M.gamePlies(rec), tl = M.buildViral(pl, rec, null, { voices: true, intro: true, synth: true }); out.info[label] = tl.events.find((e) => e.kind === 'intro').intro;
        const styles = [0, 1, 2, 3];
        for (const si of styles) { const cv = document.createElement('canvas'); cv.width = 540; cv.height = 960; const R = new ENOS.editRender.Renderer(cv, tl, { rec: { ...rec, introStyle: si, outroStyle: si } }); await R.load();
          for (const t of [0.7, 1.6, 2.6, 3.5]) { R.draw(t); out.frames[label + '_intro' + si + '_' + t] = cv.toDataURL('image/png'); }
          const to = tl.events.find((e) => e.kind === 'outro').t; for (const dt of [0.6, 1.2, 2.2]) { R.draw(to + dt); out.frames[label + '_outro' + si + '_' + dt] = cv.toDataURL('image/png'); }
          if (label === 'team') { const mv = tl.events.filter((e) => e.from && e.kind !== 'ff'); R.draw(mv[Math.min(4, mv.length - 1)].impact + 0.6); out.frames['team_hud' + si] = cv.toDataURL('image/png'); }
          out.info[label + '_px' + si] = Array.from(cv.getContext('2d').getImageData(0, 0, 4, 4).data).length; }
      }
      const eo = mk(['ETO Brillant', 'E.N.O.S.'], null, 3333), tm2 = mk(['ETO + Stockfish + Bot 400 + Joueur 3', 'Naskolit'], { w: [{ name: 'ETO Brillant', talk: 'eto', elo: 3200 }, { name: 'Stockfish', kind: 'sf', elo: 3200 }, { name: 'Bot 400', kind: 'sf', elo: 400 }, { name: 'Joueur 3', human: true }], b: [{ name: 'Naskolit', talk: 'naskolit', elo: 3200 }] }, 4444);
      out.info.eto = M.buildViral(M.gamePlies(eo), eo, null, { voices: true, intro: true, synth: true }).events.find((e) => e.kind === 'intro').intro; out.info.tm2 = M.buildViral(M.gamePlies(tm2), tm2, null, { voices: true, intro: true, synth: true }).events.find((e) => e.kind === 'intro').intro;
      { const tl = M.buildViral(M.gamePlies(eo), eo, null, { voices: true, intro: true, synth: true }), cv = document.createElement('canvas'); cv.width = 540; cv.height = 960; const R = new ENOS.editRender.Renderer(cv, tl, { rec: { ...eo, introStyle: 0 } }); await R.load(); R.draw(2.4); out.frames.eto_intro0 = cv.toDataURL('image/png'); }
      return out; }""", "e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#".split())
    info = res["info"]
    check(info["solo"]["white"]["name"] != "Toi" and "Toi" not in info["solo"]["white"]["name"], "« Toi » n'est jamais écrit : %s" % info["solo"]["white"]["name"])
    check(info["solo"]["white"]["img"].startswith("img/icons/ic") and info["solo"]["black"]["img"].startswith("img/bots/"), "joueur sans photo = icône aléatoire (%s), bot = sa tête (%s)" % (info["solo"]["white"]["img"], info["solo"]["black"]["img"]))
    tw = info["team"]["teams"]["w"]; imgs = [m["img"] for m in tw]
    check(len(tw) == 4 and len(set(imgs)) == 4 and imgs[0].startswith("img/icons/") and imgs[2].startswith("img/bots/lelex") and "Toi" not in [m["name"] for m in tw], "équipe de 4 : avatars distincts (joueurs = icônes, Lelex = sa tête) : %s" % imgs)
    check(all(v == 64 for k, v in info.items() if "_px" in k), "canvas non « tainted » (getImageData ok) pour toutes les scènes")
    e = info["eto"]; check(e["white"]["img"] == "img/bots/eto.png" and e["white"]["anim"] == "eto" and e["black"]["img"] == "img/bots/enos.png" and e["black"]["anim"] == "enos" and not e["white"]["icon"], "ETO (écran 8-bit) et E.N.O.S. (œil rouge) gardent leur icône d'origine, animée : %s / %s" % (e["white"]["img"], e["black"]["img"]))
    t2 = info["tm2"]["teams"]["w"]; check(t2[0]["anim"] == "eto" and t2[1]["ph"][0] == "SF" and t2[2]["ph"][0] == "SF" and t2[3]["img"].startswith("img/icons/") and info["tm2"]["teams"]["b"][0]["img"] == "img/bots/naskolit.png", "équipe : ETO / Stockfish / Bot 400 = pastilles d'origine, Naskolit = sa tête, seul le joueur humain a une icône aléatoire")
    frames = res["frames"]; check(len(frames) >= 61, "%d images de scènes rendues sans erreur" % len(frames))
    same = len({v for k, v in frames.items() if k.startswith("solo_intro") and k.endswith("_1.6")})
    check(same == 4, "4 intros solo différentes (%d)" % same)
    sameo = len({v for k, v in frames.items() if k.startswith("solo_outro") and k.endswith("_1.2")})
    check(sameo == 4, "4 outros différents (%d)" % sameo)
    check(len({frames["team_intro0_0.7"], frames["team_intro1_0.7"]}) == 2, "2 intros d'équipe différentes")
    if OUT:
        os.makedirs(OUT, exist_ok=True)
        for k, v in frames.items(): open(os.path.join(OUT, k + ".png"), "wb").write(base64.b64decode(v.split(",")[1]))
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
