"""Compression vidéo : file d'attente, taille finale par fichier (Mo ou %), transcodage WebCodecs (MP4 lu directement, son AAC recopié,
rotation conservée), 2e passe si la cible est dépassée, résultats sous la taille demandée."""
import os, base64, subprocess, json
from mobile_common import *
errs = []
SH = (os.environ.get("SHOTS") or "/tmp") + "/"
VID = os.environ.get("VIDS") or "/tmp/vid"
OUT = SH + "cv_out/"; os.makedirs(OUT, exist_ok=True)
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(60000)
    open_tool(pg, "compress"); pg.click('#tool-compress #cp-seg [data-m="vid"]')
    pg.evaluate("(() => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.id = 'tf'; document.body.appendChild(i); })()")
    pg.set_input_files("#tf", [VID + "/phone1080.mp4", VID + "/phone60.mp4", VID + "/rotated.mp4"])
    pg.evaluate("document.querySelector('#tool-compress .suite-body')._api.addFiles(document.getElementById('tf').files)")
    pg.wait_for_function("document.querySelectorAll('#tool-compress .cv-it').length === 3 && [...document.querySelectorAll('#tool-compress .cv-plan')].every(p => p.textContent.length > 3)", timeout=30000)
    check(True, "3 vidéos dans la file, réglage prévu affiché pour chacune")
    # tailles finales : 6 Mo, −70 %, défaut (−70 %) puis 4 Mo pour la tournée
    its = pg.locator("#tool-compress .cv-it")
    its.nth(0).locator(".cv-mo").fill("6"); its.nth(0).locator(".cv-mo").dispatch_event("change")
    its.nth(1).locator('.cv-chips [data-p="0.3"]').click()
    its.nth(2).locator(".cv-mo").fill("4"); its.nth(2).locator(".cv-mo").dispatch_event("change")
    pg.wait_for_timeout(800)
    plans = pg.evaluate("[...document.querySelectorAll('#tool-compress .cv-plan')].map(p => p.textContent)")
    print("plans :", plans)
    pg.screenshot(path=SH + "cv_queue.png", full_page=True)
    pg.evaluate("document.getElementById('cv-auto').checked = false")
    pg.click("#tool-compress #cv-go")
    pg.wait_for_function("[...document.querySelectorAll('#tool-compress .cv-st')].every(s => /Terminé|✕/.test(s.textContent))", timeout=900000)
    pg.screenshot(path=SH + "cv_done.png", full_page=True)
    res = pg.evaluate("""(async () => { const Q = document.querySelector('#tool-compress .suite-body')._api.queue; const out = [];
      for (const it of Q) { const t = it.k === 'm' ? it.v * 1048576 : Math.round(it.file.size * it.v);
        if (!it.out) { out.push({ name: it.file.name, err: it.err }); continue; }
        const buf = new Uint8Array(await it.out.blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
        out.push({ name: it.file.name, src: it.file.size, target: t, size: it.out.blob.size, plan: it.out.plan.label, passes: it.out.passes, audio: it.out.audio, b64: btoa(s) }); }
      return out; })()""")
    for r in res:
        if "err" in r: check(False, "%s : %s" % (r["name"], r["err"])); continue
        p = OUT + r["name"]; open(p, "wb").write(base64.b64decode(r["b64"]))
        pr = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", p], capture_output=True, text=True).stdout or "{}")
        vs = [s for s in pr.get("streams", []) if s["codec_type"] == "video"]; au = [s for s in pr.get("streams", []) if s["codec_type"] == "audio"]
        rot = 0
        for s in vs:
            for sd in s.get("side_data_list", []):
                if "rotation" in sd: rot = abs(int(sd["rotation"]))
        dur = float(pr.get("format", {}).get("duration", 0))
        check(r["size"] <= r["target"] * 1.05, "%s : %.1f Mo → %.2f Mo (cible %.2f Mo, %s, %d passe(s))" % (r["name"], r["src"] / 1048576, r["size"] / 1048576, r["target"] / 1048576, r["plan"], r["passes"]))
        check(len(vs) == 1 and len(au) == 1 and au[0]["codec_name"] == "aac" and dur > 7, "%s : vidéo %s %sx%s + son AAC intact, %.1f s" % (r["name"], vs[0]["codec_name"] if vs else "?", vs[0].get("width") if vs else "?", vs[0].get("height") if vs else "?", dur))
        if r["name"] == "rotated.mp4": check(rot == 90, "rotation conservée (%d°)" % rot)
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
