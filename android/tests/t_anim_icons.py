"""Icônes animées d'ETO (visage 8-bit) et d'E.N.O.S. (œil) : humeurs, clignements, avatars de la chat box, rendu vidéo."""
import base64, os
from mobile_common import *

OUT = os.environ.get("SHOTS", "")
errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(120000)
    pg.wait_for_function("window.ENOS && ENOS.animIcons && ENOS.botChat")
    r = pg.evaluate("""async () => { const A = ENOS.animIcons, load = (id) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = window.ENOS_IMG['img/bots/' + id + '.png']; });
      const ims = { eto: await load('eto'), enos: await load('enos') }, out = { sheets: {}, hash: {} };
      const moods = { eto: ['smile', 'happy', 'wink', 'wow', 'sad', 'think', 'talk', 'look'], enos: ['idle', 'scan', 'alert', 'lock', 'think'] };
      for (const id of ['eto', 'enos']) { const cv = document.createElement('canvas'); cv.width = 256 * 8; cv.height = 256 * (id === 'eto' ? 2 : 1); const g = cv.getContext('2d');
        moods[id].forEach((m, i) => { A.draw(g, id, ims[id], 128 + i * 256, 128, 250, m === 'look' ? 0.3 : 1.37 + i * 0.01, m, 5); out.hash[id + '_' + m] = Array.from(g.getImageData(i * 256 + 40, 40, 176, 176).data.filter((_, k) => k % 97 === 0)).join(',').length + ':' + Array.from(g.getImageData(i * 256 + 100, 100, 56, 56).data.slice(0, 400)).join('').slice(0, 300); });
        if (id === 'eto') { [0.5, 0.58, 3.72, 3.95].forEach((t, i) => A.draw(g, id, ims[id], 128 + i * 256, 384, 250, t, 'smile', 5)); out.blinkDiff = [0, 1, 2, 3].map((i) => g.getImageData(i * 256 + 90, 256 + 70, 76, 60).data.reduce((a, v) => a + v, 0)); }
        else { [0.5, 3.72, 4.1, 5.2].forEach((t, i) => A.draw(g, id, ims[id], 128 + (5 + i) * 256, 128, 250, t, 'idle', 5)); }
        out.sheets[id] = cv.toDataURL('image/png'); }
      // DOM : avatar animé de la chat box
      const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:200px'; host.innerHTML = ENOS.botChat.avatar('eto'); document.body.appendChild(host);
      const c = host.querySelector('canvas'); out.domTag = c && c.className; await new Promise((r) => setTimeout(r, 900)); const px1 = c.getContext('2d').getImageData(0, 0, 164, 164).data.reduce((a, v) => a + v, 0);
      A.mood(c, 'wow'); await new Promise((r) => setTimeout(r, 400)); const px2 = c.getContext('2d').getImageData(0, 0, 164, 164).data.reduce((a, v) => a + v, 0);
      out.dom = [px1 > 0, px1 !== px2]; out.mood = [A.moodOf('eto', 'bot_blunder'), A.moodOf('enos', 'bot_brilliant'), A.moodOf('eto', 'zzz')];
      host.remove(); return out; }""")
    print({k: v for k, v in r.items() if k not in ("sheets", "hash")})
    hs = r["hash"]; check(len(set(hs[k] for k in hs if k.startswith("eto_"))) == 8 and len(set(hs[k] for k in hs if k.startswith("enos_"))) == 5, "8 expressions d'ETO et 5 humeurs d'E.N.O.S. toutes différentes")
    bd = r["blinkDiff"]; check(abs(bd[0] - bd[1]) < 2000 and bd[2] != bd[0] and abs(bd[3] - bd[0]) < 2000, "clignement d'ETO : yeux fermés à t = 3,72 s seulement (%s)" % bd)
    check(r["domTag"] and "bot-anim" in r["domTag"] and r["dom"] == [True, True], "avatar de la chat box = canvas animé qui change d'humeur : %s" % r["dom"])
    check(r["mood"] == ["sad", "alert", "talk"], "humeur d'après la réplique : %s" % r["mood"])
    if OUT:
        os.makedirs(OUT, exist_ok=True)
        for k, v in r["sheets"].items(): open(os.path.join(OUT, "anim_" + k + ".png"), "wb").write(base64.b64decode(v.split(",")[1]))
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
