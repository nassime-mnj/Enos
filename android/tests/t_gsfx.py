"""Sons des jeux : chaque fichier de la banque se décode (OGG Vorbis) et contient du signal ; chaque événement se joue ; bouton son de l'écran de jeu ; sons branchés dans CHROMA, Poker, Dames, Flick, Néo-Cité."""
from mobile_common import *
errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(60000)
    n_ev = pg.evaluate("Object.keys(window.ENOS_GSFX_BANK).length")
    check(n_ev >= 50, "banque : %d événements" % n_ev)
    res = pg.evaluate("""(async () => {
      const B = window.ENOS_GSFX_BANK, G = ENOS.gsfx; await G.preload(Object.keys(B).map((k) => k.split('.')[0]));
      const ac = G.ctx(); const bad = [], quiet = []; let n = 0;
      for (const [ev, e] of Object.entries(B)) for (const f of e.files) {
        const d = window.ENOS_GSFX_DATA[f]; if (!d) { bad.push(f); continue; }
        const bin = atob(d), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const buf = await ac.decodeAudioData(u.buffer).catch(() => null); if (!buf) { bad.push(f); continue; }
        const x = buf.getChannelData(0); let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; if (Math.sqrt(s / x.length) < 0.003) quiet.push(f); n++;
      }
      const played = Object.keys(B).filter((k) => B[k].bus !== 'amb').map((k) => [k, G.play(k, { force: true })]).filter(([, ok]) => !ok).map(([k]) => k);
      return { n, bad, quiet, notPlayed: played };
    })()""")
    check(not res["bad"] and res["n"] >= 100, "%d fichiers décodés, illisibles : %s" % (res["n"], res["bad"][:3]))
    check(not res["quiet"], "aucun fichier silencieux : %s" % res["quiet"][:3])
    check(not res["notPlayed"], "chaque événement se joue : %s" % res["notPlayed"][:5])
    # écran de jeu : bouton son + jeu sonorisé
    open_tool(pg, "chroma"); pg.click('#tool-chroma .gm-mode[data-m="bots"]'); pg.click("#tool-chroma #gm-go"); pg.wait_for_selector("#gm-stage .gm-snd")
    pg.evaluate("window.__snd = []; const p = ENOS.gsfx.play; ENOS.gsfx.play = (ev, o) => { window.__snd.push(ev); return p(ev, o); }; 0")
    pg.wait_for_function("window.__snd.some((e) => typeof e === 'string' && e.startsWith('card.'))", timeout=30000)
    evs = pg.evaluate("window.__snd.map(String)"); check("null" not in evs and "undefined" not in evs, "CHROMA joue ses sons : " + ", ".join(sorted(set(evs))))
    pg.click("#gm-stage .gm-snd"); check(pg.evaluate("ENOS.gsfx.enabled()") is False and pg.locator(".gm-snd.off").count() == 1, "bouton son : coupé")
    check(pg.evaluate("ENOS.gsfx.play('card.place', {force: true})") is False, "son coupé : plus rien ne se joue")
    pg.click("#gm-stage .gm-snd"); check(pg.evaluate("ENOS.gsfx.enabled()") is True, "bouton son : rétabli")
    pg.evaluate("ENOS.jeux.close()")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
