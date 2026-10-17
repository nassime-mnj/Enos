"""Scanner Documentaire IA : détection des bords, redressement, filtres, PDF / JPEG / OCR / reçus -> XLSX / CSV, avec une VRAIE photo synthétique (Pillow + numpy)."""
import base64, csv, io, json, os, tempfile
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import pymupdf, openpyxl
from mobile_common import *

TMP = tempfile.mkdtemp(prefix="scan_")
rng = np.random.default_rng(7)


def persp_coeffs(dst, src):
    """Coefficients PIL (sortie -> entrée) pour amener le rectangle `src` sur le quadrilatère `dst`."""
    A, B = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); B.append(v)
    return np.linalg.solve(np.array(A, float), np.array(B, float))


def make_sheet(w=700, h=990):
    im = Image.new("RGB", (w, h), (250, 250, 248))
    d = ImageDraw.Draw(im)
    try:
        f = ImageFont.load_default(size=26)
    except TypeError:
        f = ImageFont.load_default()
    d.rectangle((40, 40, w - 40, 110), fill=(15, 15, 15))
    d.text((60, 62), "FACTURE N 2026-014", fill=(255, 255, 255), font=f)
    for i in range(18):
        d.text((50, 150 + i * 42), f"Ligne {i + 1} : designation article reference {1000 + i * 7} total {12 + i}.50", fill=(20, 20, 20), font=f)
    return im


def make_photo(sheet, dst, size=(1500, 1200), shade=True):
    bg = np.zeros((size[1], size[0], 3), float) + np.array([58, 44, 36])
    bg += rng.normal(0, 6, bg.shape)
    bgi = Image.fromarray(np.clip(bg, 0, 255).astype("uint8"))
    w, h = sheet.size
    co = persp_coeffs(dst, [(0, 0), (w, 0), (w, h), (0, h)])
    warped = sheet.transform(size, Image.PERSPECTIVE, co, Image.BICUBIC)
    mask = Image.new("L", sheet.size, 255).transform(size, Image.PERSPECTIVE, co, Image.BILINEAR)
    arr = np.array(warped, float)
    if shade:   # éclairage inégal : gradient horizontal (0.62 -> 1.0) et papier légèrement gris
        g = np.linspace(0.5, 1.0, size[0])[None, :, None]
        arr = arr * g * 0.86
    out = Image.composite(Image.fromarray(np.clip(arr, 0, 255).astype("uint8")), bgi, mask.filter(ImageFilter.GaussianBlur(0.8)))
    a = np.array(out, float) + rng.normal(0, 3, (size[1], size[0], 3))
    return Image.fromarray(np.clip(a, 0, 255).astype("uint8")).filter(ImageFilter.GaussianBlur(0.6))


def pinhole(rx, ry, rz, t, f, u0, v0, W, H):
    """Projette la feuille (W x H, plan z=0) avec une vraie caméra à sténopé (point principal au centre) : le format réel est donc retrouvable."""
    out = []
    for x, y in [(-W / 2, -H / 2), (W / 2, -H / 2), (W / 2, H / 2), (-W / 2, H / 2)]:
        X, Y, Z = x, y, 0
        Y, Z = Y * np.cos(rx) - Z * np.sin(rx), Y * np.sin(rx) + Z * np.cos(rx)
        X, Z = X * np.cos(ry) + Z * np.sin(ry), -X * np.sin(ry) + Z * np.cos(ry)
        X, Y = X * np.cos(rz) - Y * np.sin(rz), X * np.sin(rz) + Y * np.cos(rz)
        Z += t
        out.append((round(u0 + f * X / Z), round(v0 + f * Y / Z)))
    return out


SHEET = make_sheet()
DST = pinhole(0.35, -0.22, 0.06, 1.42, 1250, 750, 600, 0.7, 0.99)
DST2 = pinhole(-0.2, 0.25, -0.05, 1.5, 1250, 750, 600, 0.7, 0.99)
assert all(30 < x < 1470 and 30 < y < 1170 for x, y in DST + DST2), (DST, DST2)
PHOTO = make_photo(SHEET, DST)
P1 = os.path.join(TMP, "photo1.jpg"); PHOTO.save(P1, quality=90)
B64 = base64.b64encode(open(P1, "rb").read()).decode()
BLANK = Image.fromarray(np.clip(rng.normal(120, 10, (900, 1200, 3)), 0, 255).astype("uint8"))
BLANK_P = os.path.join(TMP, "blank.jpg"); BLANK.save(BLANK_P)

LOAD = """async (b64) => { const im = new Image(); im.src = "data:image/jpeg;base64," + b64; await im.decode();
  const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const x = c.getContext("2d"); x.drawImage(im, 0, 0);
  window.__img = x.getImageData(0, 0, c.width, c.height); return [c.width, c.height]; }"""
TOURL = """(img) => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; c.getContext("2d").putImageData(new ImageData(img.data, img.width, img.height), 0, 0); return c.toDataURL("image/png"); }"""


def decode(url):
    return Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1]))).convert("RGB")


def gray(im):
    return np.array(im.convert("L"), float)


with sync_playwright() as pw:
    b, ctx = launch(pw, accept_downloads=True); errs = []
    pg = open_app(ctx, errs)
    pg.on("console", lambda m: errs.append("console: " + m.text[:200]) if m.type == "error" else None)
    check(pg.evaluate("!!(window.ENOS.scanLib && window.ENOS.xlsxLib)"), "scanLib et xlsxLib exposés")

    # ============================================================ algorithmes purs
    print("-- algorithmes")
    pg.evaluate(LOAD, B64)
    det = pg.evaluate("(() => { const r = ENOS.scanLib.detectQuad(window.__img); return r; })()")
    q = det["quad"]
    errp = [max(abs(a["x"] - t[0]), abs(a["y"] - t[1])) for a, t in zip(q, DST)]
    print("    coins détectés:", [(round(a["x"]), round(a["y"])) for a in q], "erreurs max (px):", [round(e) for e in errp])
    check(det["found"], "bords détectés (found)")
    check(max(errp) < 30, "4 coins retrouvés à moins de 30 px (sur 1500 px) : max %.1f" % max(errp))
    det2 = pg.evaluate("(async (b) => { const im = new Image(); im.src='data:image/jpeg;base64,'+b; await im.decode(); const c=document.createElement('canvas'); c.width=im.width; c.height=im.height; const x=c.getContext('2d'); x.drawImage(im,0,0); return ENOS.scanLib.detectQuad(x.getImageData(0,0,c.width,c.height)); })",
                       base64.b64encode(open(BLANK_P, "rb").read()).decode())
    check(not det2["found"] and abs(det2["quad"][0]["x"] - 48) < 1, "image sans document : repli sur cadre de 4 %% (%s)" % det2["found"])

    # homographie
    hh = pg.evaluate("(() => { const L = ENOS.scanLib, s=[{x:0,y:0},{x:100,y:0},{x:100,y:200},{x:0,y:200}], d=[{x:10,y:5},{x:130,y:20},{x:120,y:230},{x:-5,y:210}]; const H = L.homography(s,d); return s.map(p=>L.applyH(H,p.x,p.y)); })()")
    exp = [(10, 5), (130, 20), (120, 230), (-5, 210)]
    check(all(abs(p["x"] - e[0]) < 1e-6 and abs(p["y"] - e[1]) < 1e-6 for p, e in zip(hh, exp)), "homographie : les 4 points se projettent exactement")

    # redressement avec les coins vrais
    pg.evaluate("(q) => { window.__q = q; }", [{"x": x, "y": y} for x, y in DST])
    sz = pg.evaluate("ENOS.scanLib.outSize(window.__q, 2000, 1500, 1200)")
    print("    taille de sortie:", sz)
    url = pg.evaluate("(() => { const L = ENOS.scanLib, s = L.outSize(window.__q, 2000, 1500, 1200); window.__warp = L.warp(window.__img, window.__q, s.w, s.h); return (" + TOURL + ")(window.__warp); })()")
    wim = decode(url)
    ref = SHEET.resize(wim.size, Image.LANCZOS)
    ratio_o, ratio_w = SHEET.size[0] / SHEET.size[1], wim.size[0] / wim.size[1]
    check(abs(ratio_w / ratio_o - 1) < 0.06, "redressé quasi rectangulaire, rapport %.3f vs feuille %.3f" % (ratio_w, ratio_o))
    # on compare les structures (corrélation de Pearson) : le photo est assombrie et dégradée
    blur = lambda im: gray(im.resize((350, 495)).filter(ImageFilter.GaussianBlur(2)))
    a, r = blur(wim), blur(ref)
    corr = float(np.corrcoef(a.ravel(), r.ravel())[0, 1])
    check(corr > 0.9, "redressé corrélé à la feuille d'origine : r = %.3f" % corr)
    # sortie plafonnée à 2000 px
    big = pg.evaluate("(() => { const L = ENOS.scanLib; return L.outSize([{x:0,y:0},{x:6000,y:0},{x:6000,y:3000},{x:0,y:3000}], 2000); })()")
    check(max(big["w"], big["h"]) == 2000 and big["w"] == 2000 and abs(big["h"] - 1000) <= 1, "taille de sortie plafonnée à 2000 px %s" % big)
    # avec les coins DÉTECTÉS
    url = pg.evaluate("(() => { const L = ENOS.scanLib, d = L.detectQuad(window.__img), s = L.outSize(d.quad, 2000, 1500, 1200); return (" + TOURL + ")(L.warp(window.__img, d.quad, s.w, s.h)); })()")
    w2 = decode(url); a2 = blur(w2)
    corr2 = float(np.corrcoef(a2.ravel(), r.ravel())[0, 1])
    check(corr2 > 0.85, "redressement sur coins détectés : r = %.3f" % corr2)

    # filtres sur le redressé
    def filt(name):
        return decode(pg.evaluate("(n) => (" + TOURL + ")(ENOS.scanLib.applyFilter(window.__warp, n))", name))
    orig, fdoc, fbw, fwb = filt("orig"), filt("doc"), filt("bw"), filt("wb")
    go, gd, gb, gw = gray(orig), gray(fdoc), gray(fbw), gray(fwb)
    h, w = go.shape
    paperL = (slice(int(h * .93), int(h * .98)), slice(int(w * .08), int(w * .25)))     # bandes de papier vide, à gauche (sombre) et à droite (clair)
    paperR = (slice(int(h * .93), int(h * .98)), slice(int(w * .75), int(w * .92)))
    print("    papier gauche/droite  orig %.0f/%.0f  doc %.0f/%.0f  wb %.0f/%.0f  bw %.0f/%.0f" % (go[paperL].mean(), go[paperR].mean(), gd[paperL].mean(), gd[paperR].mean(), gw[paperL].mean(), gw[paperR].mean(), gb[paperL].mean(), gb[paperR].mean()))
    check(orig.size == fdoc.size == fbw.size == fwb.size, "les filtres gardent les dimensions")
    check(np.abs(go - gray(Image.fromarray(np.array(orig)))).max() == 0, "Original = identité")
    check(go[paperL].mean() < 170 and gd[paperL].mean() > go[paperL].mean() + 40, "Document : éclaircit le papier sombre (%.0f -> %.0f)" % (go[paperL].mean(), gd[paperL].mean()))
    check(gd[paperR].mean() > 235, "Document : papier quasi blanc (%.0f)" % gd[paperR].mean())
    check(gd.std() > go.std() * 0.9 and (gd < 80).mean() > 0.01, "Document : le texte reste noir (contraste)")
    uniq = set(np.unique(np.array(fbw.convert("L"))).tolist())
    check(uniq <= {0, 255} and len(uniq) == 2, "Noir & blanc : uniquement 0 et 255 %s" % sorted(uniq))
    check((gb[paperL] > 128).mean() > 0.97 and (gb[paperR] > 128).mean() > 0.97, "N&B : papier vide blanc malgré l'ombre (gauche %.3f)" % (gb[paperL] > 128).mean())
    check(0.02 < (gb < 128).mean() < 0.25, "N&B : proportion d'encre plausible %.3f" % (gb < 128).mean())
    ink_ref = gray(ref) < 110
    ink_bw = gb < 128
    inter = (ink_ref & ink_bw).sum(); union = (ink_ref | ink_bw).sum()
    check(inter / union > 0.25, "N&B : l'encre correspond à celle de la feuille (IoU %.2f)" % (inter / union))
    check(abs(gw[paperL].mean() - gw[paperR].mean()) < 12 and gw[paperL].mean() > 235, "Tableau blanc : ombre supprimée (gauche %.0f / droite %.0f)" % (gw[paperL].mean(), gw[paperR].mean()))
    check(abs(go[paperL].mean() - go[paperR].mean()) > 25, "…alors que l'original avait bien une ombre (écart %.0f)" % abs(go[paperL].mean() - go[paperR].mean()))
    rot = pg.evaluate("(() => { const L = ENOS.scanLib, im = {width:3,height:2,data:new Uint8ClampedArray([1,0,0,255, 2,0,0,255, 3,0,0,255, 4,0,0,255, 5,0,0,255, 6,0,0,255])}; const r = L.rotate90(im,1); return [r.width,r.height,Array.from(r.data).filter((_,i)=>i%4===0), Array.from(L.rotate90(im,4).data).filter((_,i)=>i%4===0)]; })()")
    check(rot[0] == 2 and rot[1] == 3 and rot[2] == [4, 1, 5, 2, 6, 3] and rot[3] == [1, 2, 3, 4, 5, 6], "rotation 90° horaire exacte %s" % rot[2])

    # ============================================================ XLSX / CSV purs
    print("-- xlsx / csv")
    xb = pg.evaluate("Array.from(ENOS.xlsxLib.build([['2026-03-01','Café, \"Le Zinc\" & Cie','Restauration',12.5,2.08],['2026-03-02','<Taxi>','Transport',30,5],[null,'Sans montant','Autre',null,null]], ['Date','Commerçant','Catégorie','TTC','TVA']))")
    xp = os.path.join(TMP, "pur.xlsx"); open(xp, "wb").write(bytes(xb))
    wb = openpyxl.load_workbook(xp); ws = wb.active
    check([c.value for c in ws[1]] == ["Date", "Commerçant", "Catégorie", "TTC", "TVA"] and ws["A1"].font.b and ws["D1"].font.b, "XLSX : en-têtes, en gras")
    check(ws["B2"].value == 'Café, "Le Zinc" & Cie' and ws["B3"].value == "<Taxi>", "XLSX : texte avec caractères spéciaux préservé")
    check(ws["D2"].value == 12.5 and isinstance(ws["D3"].value, (int, float)) and ws["D4"].value is None, "XLSX : nombres numériques, cellule vide vide")
    check(str(ws["A2"].value)[:10] == "2026-03-01", "XLSX : dates lues comme dates (%s)" % ws["A2"].value)
    tot = [row for row in ws.iter_rows(min_row=5) if any(c.value for c in row)]
    check(tot and tot[0][3].value == "=SUM(D2:D4)" and tot[0][4].value == "=SUM(E2:E4)", "XLSX : ligne TOTAL en formule SUM %s" % (tot[0][3].value if tot else None))
    wv = openpyxl.load_workbook(xp, data_only=True).active
    check(tot and wv.cell(tot[0][3].row, 4).value == 42.5 and abs(wv.cell(tot[0][3].row, 5).value - 7.08) < 1e-9, "XLSX : valeurs en cache des totaux (42,5 / 7,08)")
    import zipfile
    zf = zipfile.ZipFile(xp)
    check(zf.testzip() is None and set(zf.namelist()) >= {"[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml", "xl/styles.xml"}, "XLSX : archive ZIP valide (CRC32) avec toutes les parties")
    cs = pg.evaluate("ENOS.xlsxLib.csv([['2026-03-01','A;B \"x\"',12.5,null],['2026-03-02','ligne\\nbis',3,1]], ['Date','Nom','TTC','TVA'])")
    rows = list(csv.reader(io.StringIO(cs.lstrip("﻿")), delimiter=";"))
    check(cs.startswith("﻿") and rows[0] == ["Date", "Nom", "TTC", "TVA"] and rows[1] == ["2026-03-01", 'A;B "x"', "12,5", ""] and rows[2][1] == "ligne\nbis", "CSV : séparateur, guillemets, virgule décimale %s" % rows[1])
    cr = pg.evaluate("[ENOS.scanLib.num('12,50 €'), ENOS.scanLib.num('1 234,56'), ENOS.scanLib.num('1,234.56'), ENOS.scanLib.num('abc'), ENOS.scanLib.num(null), ENOS.scanLib.num(7)]")
    check(cr == [12.5, 1234.56, 1234.56, None, None, 7], "montants des reçus normalisés %s" % cr)

    # ============================================================ interface
    print("-- interface")
    pg.evaluate("window.ENOS.native.vault.set('groq','x')")
    pg.evaluate("""(() => {
      window.__calls = []; let rc = 0;
      window.ENOS.native.fetch = async (o) => {
        const body = JSON.parse(o.body), msgs = body.messages, u = msgs[msgs.length - 1].content;
        const isV = Array.isArray(u), ask = isV ? u[0].text : u; window.__calls.push({ vision: isV, json: !!body.response_format, model: body.model, hasImg: isV && /^data:image\\/jpeg;base64,/.test(u[1].image_url.url) });
        let content;
        if (isV && body.response_format) {
          rc++;
          content = rc === 1 ? JSON.stringify({ merchant: "Boulangerie Paul", date: "2026-03-14", total: "12,50 €", vat: 1.14, currency: "EUR", category: "Restauration", invoice_number: "T-001", readable: true })
            : rc === 2 ? "Voici: " + JSON.stringify({ merchant: "Taxi G7", date: "2026-03-15", total: 45.3, vat: 7.55, currency: "eur", category: "Transport", readable: true })
            : "pas du tout du json";
        } else content = "Facture 2026-014\\nLigne 1 : ok";
        return { status: 200, json: () => ({ choices: [{ message: { content } }], usage: { total_tokens: 10 } }), text: "" };
      };
    })()""")
    open_tool(pg, "scan")
    check(pg.locator("#scan-cam").is_visible() and pg.locator("#scan-gal").is_visible(), "boutons PHOTOGRAPHIER / DEPUIS LA GALERIE")
    bb = pg.locator("#scan-cam").bounding_box()
    check(bb["height"] >= 44, "cible tactile >= 44 px (%d)" % bb["height"])
    check(pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "pas de défilement horizontal à 412 px")
    with pg.expect_file_chooser() as fc:
        pg.click("#scan-cam")
    check(fc.value.element.evaluate("e => e.getAttribute('capture')") == "environment" and "image" in fc.value.element.evaluate("e => e.accept"), "PHOTOGRAPHIER : input image + capture=environment")
    fc.value.set_files(P1)
    pg.wait_for_selector(".scan-ov")      # un seul cliché : le recadrage s'ouvre
    check(pg.locator(".scan-h").count() == 4, "recadrage : 4 poignées tactiles")
    hb = pg.locator(".scan-h").first.bounding_box()
    check(hb["width"] >= 44 and hb["height"] >= 44, "poignées >= 44 px")
    st0 = pg.evaluate("ENOS.scanLib.state()")[0]
    check(st0["found"] and max(abs(a["x"] - t[0]) for a, t in zip(st0["quad"], DST)) < 30, "page ajoutée avec cadre auto-détecté")
    # glisser la poignée haut-gauche
    cx, cy = hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2
    pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.move(cx + 40, cy + 30, steps=5); pg.mouse.up()
    pg.click("#scan-c-ok"); pg.wait_for_selector(".scan-ov", state="detached")
    pg.wait_for_function("ENOS.scanLib.state()[0].fw > 0")
    st1 = pg.evaluate("ENOS.scanLib.state()")[0]
    dx = st1["quad"][0]["x"] - st0["quad"][0]["x"]; dy = st1["quad"][0]["y"] - st0["quad"][0]["y"]
    print("    déplacement coin 1 (px photo): %.0f, %.0f" % (dx, dy))
    check(dx > 30 and dy > 20 and abs(st1["quad"][1]["x"] - st0["quad"][1]["x"]) < 1, "poignée glissée : seul le coin 1 a bougé")
    # annuler ne change rien
    pg.click("#scan-crop"); pg.wait_for_selector(".scan-ov"); pg.click("#scan-c-no"); pg.wait_for_selector(".scan-ov", state="detached")
    check(pg.evaluate("ENOS.scanLib.state()")[0]["quad"][0]["x"] == st1["quad"][0]["x"], "recadrage annulé : inchangé")
    # remise au cadre auto
    pg.click("#scan-crop"); pg.wait_for_selector(".scan-ov"); pg.click("#scan-c-auto"); pg.click("#scan-c-ok"); pg.wait_for_selector(".scan-ov", state="detached")
    pg.wait_for_timeout(300)
    # galerie : 2 images de plus
    P2 = os.path.join(TMP, "photo2.jpg"); make_photo(SHEET, DST2).save(P2, quality=90)
    with pg.expect_file_chooser() as fc:
        pg.click("#scan-gal")
    check(fc.value.element.evaluate("e => e.multiple"), "galerie : sélection multiple")
    fc.value.set_files([P2, P1])
    pg.wait_for_function("document.querySelectorAll('.scan-th').length === 3", timeout=60000)
    pg.wait_for_function("!document.querySelector('#scan-gal').disabled")
    check(pg.locator(".scan-th").count() == 3 and "3 page" in pg.inner_text("#scan-n"), "3 pages dans la liste")
    # filtres
    n0 = pg.evaluate("document.querySelector('#scan-prev').src")
    pg.click('.scan-f[data-f="bw"]'); pg.wait_for_function("ENOS.scanLib.state()[2].filter === 'bw'"); pg.wait_for_function("!document.querySelector('#scan-gal').disabled")
    check(pg.evaluate("document.querySelector('#scan-prev').src") != n0 and pg.locator('.scan-f[data-f="bw"].on').count() == 1, "filtre N&B appliqué et aperçu mis à jour")
    # pivoter la page 0, déplacer
    pg.click('.scan-th[data-i="0"]'); fw0, fh0 = [pg.evaluate("ENOS.scanLib.state()[0].%s" % k) for k in ("fw", "fh")]
    pg.click("#scan-rot"); pg.wait_for_function("ENOS.scanLib.state()[0].rot === 1"); pg.wait_for_function("!document.querySelector('#scan-gal').disabled")
    s = pg.evaluate("ENOS.scanLib.state()")
    check(s[0]["fw"] == fh0 and s[0]["fh"] == fw0, "rotation 90° : dimensions échangées")
    pg.click("#scan-right"); pg.wait_for_timeout(100)
    s = pg.evaluate("ENOS.scanLib.state()")
    check(s[1]["rot"] == 1 and s[0]["rot"] == 0, "réordonner : la page pivotée est passée en 2e position")
    pg.click('.scan-th[data-i="2"]'); pg.click("#scan-allf"); pg.wait_for_function("ENOS.scanLib.state().every(p => p.filter === 'bw')", timeout=30000); pg.wait_for_function("!document.querySelector('#scan-gal').disabled")
    pg.click('.scan-th[data-i="0"]'); pg.click('.scan-f[data-f="doc"]'); pg.wait_for_function("ENOS.scanLib.state()[0].filter === 'doc'"); pg.wait_for_function("!document.querySelector('#scan-gal').disabled")
    # suppression
    pg.click('.scan-th[data-i="2"]'); pg.click("#scan-del"); pg.wait_for_function("document.querySelectorAll('.scan-th').length === 2")
    check(pg.evaluate("ENOS.scanLib.state().length") == 2, "suppression d'une page")
    pg.set_input_files  # (rien)
    with pg.expect_file_chooser() as fc:
        pg.click("#scan-gal")
    fc.value.set_files([P1]); pg.wait_for_function("document.querySelectorAll('.scan-th').length === 3", timeout=30000); pg.wait_for_function("!document.querySelector('#scan-gal').disabled")
    check(pg.evaluate("ENOS.scanLib.state().length") == 3, "page rajoutée (3)")

    # ---- export PDF
    with pg.expect_download() as dl:
        pg.click("#scan-pdf")
    d = dl.value; pp = os.path.join(TMP, "out.pdf"); d.save_as(pp)
    check(d.suggested_filename.endswith(".pdf"), "PDF téléchargé : " + d.suggested_filename)
    doc = pymupdf.open(pp)
    check(doc.page_count == 3, "PDF : 3 pages (PyMuPDF) -> %d" % doc.page_count)
    check(all(len(p.get_images()) == 1 for p in doc), "PDF : une image JPEG par page")
    sizes = [(round(p.rect.width), round(p.rect.height)) for p in doc]
    print("    tailles de pages (pt):", sizes)
    check(all(max(s) <= 842 and min(s) <= 595 for s in sizes), "PDF : pages tenant dans un A4")
    check(any(s[0] > s[1] for s in sizes) and any(s[0] < s[1] for s in sizes), "PDF : page pivotée en paysage, les autres en portrait")

    # ---- export JPEG (galerie)
    got = []
    pg.on("download", lambda d: got.append(d))
    pg.click("#scan-jpg"); pg.wait_for_function("document.querySelector('#scan-stage').textContent.includes('image(s) enregistrée')", timeout=20000)
    pg.wait_for_timeout(500)
    check(len(got) == 3 and all(x.suggested_filename.endswith(".jpg") for x in got), "JPEG : 3 fichiers (%s)" % [x.suggested_filename for x in got])
    jp = os.path.join(TMP, "p.jpg"); got[0].save_as(jp)
    im = Image.open(jp); im.load()
    check(im.format == "JPEG" and max(im.size) <= 2000 and max(im.size) > 800, "JPEG valide, <= 2000 px : %s" % (im.size,))

    # ---- OCR
    pg.evaluate("window.__calls.length = 0")
    pg.click("#scan-ocr"); pg.wait_for_selector("#scan-ocr-card:not([hidden])", timeout=30000)
    txt = pg.input_value("#scan-ocr-out")
    check("--- Page 1 ---" in txt and "--- Page 3 ---" in txt and "Facture 2026-014" in txt, "OCR : texte de chaque page dans la zone éditable")
    calls = pg.evaluate("window.__calls")
    check(len(calls) == 3 and all(c["vision"] and c["hasImg"] and not c["json"] for c in calls), "OCR : 3 appels vision avec une image JPEG")
    pg.fill("#scan-ocr-out", "Texte corrigé é€")
    with pg.expect_download() as dl:
        pg.click("#scan-txt")
    tp = os.path.join(TMP, "o.txt"); dl.value.save_as(tp)
    check(open(tp, encoding="utf-8").read() == "Texte corrigé é€" and dl.value.suggested_filename.endswith(".txt"), "OCR : .txt enregistré avec le texte corrigé (UTF-8)")
    pg.evaluate("navigator.clipboard.writeText = async () => { window.__copied = true; }"); pg.click("#scan-copy")
    check(pg.evaluate("!!window.__copied"), "OCR : bouton copier")

    # ---- reçus -> Excel
    pg.click("#scan-rcpt"); pg.wait_for_selector("#scan-rc-card:not([hidden])", timeout=30000)
    pg.wait_for_function("document.querySelectorAll('#scan-rc-body tr[data-i]').length === 3")
    vals = pg.evaluate("Array.from(document.querySelectorAll('#scan-rc-body tr[data-i]')).map(tr => Array.from(tr.querySelectorAll('[data-k]')).map(i => i.value))")
    print("    lignes:", vals)
    check(vals[0][:2] == ["2026-03-14", "Boulangerie Paul"] and vals[0][4] == "12.5" and vals[0][5] == "1.14", "reçu 1 : date, commerçant, total 12,50 €->12.5, TVA")
    check(vals[1][1] == "Taxi G7" and vals[1][2] == "Transport" and vals[1][4] == "45.3" and vals[1][6] == "EUR", "reçu 2 : JSON entouré de texte lu, devise 'eur'->EUR")
    check(pg.locator("#scan-rc-body tr.bad").count() >= 1 and "illisible" in pg.inner_text("#scan-rc-body"), "reçu 3 (réponse non JSON) : ligne signalée à vérifier, jamais inventée")
    check(vals[2][4] == "" and vals[2][1] == "", "reçu 3 : champs vides (pas de valeur inventée)")
    # correction manuelle du 3e
    tr = pg.locator("#scan-rc-body tr[data-i='2']")
    tr.locator("[data-k=date]").fill("2026-03-16"); tr.locator("[data-k=merchant]").fill("Station Total")
    pg.locator("#scan-rc-body tr[data-i='2'] [data-k=total]").fill("30,00"); pg.locator("#scan-rc-body tr[data-i='2'] [data-k=total]").blur()
    pg.locator("#scan-rc-body tr[data-i='2'] [data-k=category]").select_option("Carburant")
    pg.locator("#scan-rc-body tr[data-i='1'] [data-k=vat]").fill("99"); pg.locator("#scan-rc-body tr[data-i='1'] [data-k=vat]").blur()
    check("TVA incohérente" in pg.inner_text("#scan-rc-body"), "TVA supérieure au total signalée")
    pg.locator("#scan-rc-body tr[data-i='1'] [data-k=vat]").fill("7.55"); pg.locator("#scan-rc-body tr[data-i='1'] [data-k=vat]").blur()
    check("87,80" in pg.inner_text("#scan-rc-tot"), "total affiché : " + pg.inner_text("#scan-rc-tot"))
    with pg.expect_download() as dl:
        pg.click("#scan-xlsx")
    xp = os.path.join(TMP, "recus.xlsx"); dl.value.save_as(xp)
    check(dl.value.suggested_filename.endswith(".xlsx"), "XLSX téléchargé " + dl.value.suggested_filename)
    ws = openpyxl.load_workbook(xp).active
    hdr = [c.value for c in ws[1]]
    check(hdr == ["Date", "Commerçant", "Catégorie", "N° facture", "Montant TTC", "dont TVA", "Devise", "Fichier"] and all(c.font.b for c in ws[1] if c.value), "XLSX reçus : en-têtes en gras %s" % hdr)
    r2 = [c.value for c in ws[2]]
    check(str(r2[0])[:10] == "2026-03-14" and r2[1] == "Boulangerie Paul" and r2[4] == 12.5 and r2[5] == 1.14 and r2[3] == "T-001", "XLSX reçus : ligne 1 %s" % r2)
    check(ws["E4"].value == 30 and ws["C4"].value == "Carburant" and ws["B4"].value == "Station Total", "XLSX reçus : ligne corrigée à la main exportée")
    tl = [row for row in ws.iter_rows(min_row=5) if any(c.value for c in row)][0]
    print("    ligne total:", [c.value for c in tl])
    check(tl[4].value == "=SUM(E2:E4)" and tl[5].value == "=SUM(F2:F4)" and tl[0].value == "TOTAL", "XLSX reçus : TOTAL en formules SUM")
    check(abs(openpyxl.load_workbook(xp, data_only=True).active.cell(tl[0].row, 5).value - 87.8) < 1e-9, "XLSX reçus : total en cache 87,80")
    with pg.expect_download() as dl:
        pg.click("#scan-csv")
    cp = os.path.join(TMP, "recus.csv"); dl.value.save_as(cp)
    rows = list(csv.reader(open(cp, encoding="utf-8-sig"), delimiter=";"))
    check(rows[0][0] == "Date" and rows[1][1] == "Boulangerie Paul" and rows[1][4] == "12,5" and len(rows) == 4 and rows[3][2] == "Carburant", "CSV reçus : %s" % rows[1])
    # suppression d'une ligne
    pg.click("#scan-rc-body [data-x='0']"); check(pg.locator("#scan-rc-body tr[data-i]").count() == 2, "ligne de reçu supprimée")

    # ---- clé absente
    pg.evaluate("window.ENOS.native.vault.del('groq')")
    pg.click("#scan-ocr"); pg.wait_for_selector("#scan-err:not([hidden])")
    check("Clé Groq absente" in pg.inner_text("#scan-err"), "OCR sans clé : message clair — " + pg.inner_text("#scan-err")[:60])
    pg.click("#scan-rcpt"); pg.wait_for_function("document.querySelector('#scan-err').textContent.includes('Clé Groq')")
    check(True, "reçus sans clé : message clair")

    # ---- fichier non image
    bad = os.path.join(TMP, "x.jpg"); open(bad, "wb").write(b"pas une image")
    pg.evaluate("window.ENOS.native.vault.set('groq','x')")
    with pg.expect_file_chooser() as fc:
        pg.click("#scan-gal")
    fc.value.set_files([bad]); pg.wait_for_function("document.querySelector('#scan-err').textContent.includes('illisible')", timeout=15000)
    check(pg.evaluate("ENOS.scanLib.state().length") == 3, "fichier corrompu refusé sans casser les pages")
    check(pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "toujours pas de défilement horizontal")
    check(not errs, "aucune erreur JavaScript " + str(errs[:3]))
    b.close()
print("ÉCHECS:", BAD or "aucun")
