"""Éditeur PDF mobile : ouvre de vrais PDF, exporte, et VÉRIFIE les fichiers produits avec PyMuPDF."""
import os, io, random, tempfile
import pymupdf
from mobile_common import *

T = tempfile.mkdtemp(prefix="t_pdf_")


def mk(name, texts, size=(300, 400), meta=None, rot=None):
    d = pymupdf.open()
    for i, t in enumerate(texts):
        p = d.new_page(width=size[0], height=size[1]); p.insert_text((40, 100), t, fontsize=24)
        if rot and i in rot: p.set_rotation(rot[i])
    if meta: d.set_metadata(meta)
    path = os.path.join(T, name); d.save(path); d.close(); return path


def noisy_png(path, w=900, h=900):
    rnd = random.Random(1); pm = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, w, h), False)
    pm.set_rect(pm.irect, (255, 255, 255))
    buf = bytearray(w * h * 3)
    for i in range(0, len(buf), 3): v = rnd.randrange(256); buf[i] = v; buf[i + 1] = rnd.randrange(256); buf[i + 2] = 255 - v
    pm = pymupdf.Pixmap(pymupdf.csRGB, w, h, bytes(buf), False); pm.save(path); return path


A = mk("alpha.pdf", ["ALPHA-1", "ALPHA-2", "ALPHA-3", "ALPHA-4"], meta={"title": "Secret", "author": "Moi"})
B = mk("beta.pdf", ["BETA-1", "BETA-2"])
bigimg = noisy_png(os.path.join(T, "big.png"))
d = pymupdf.open(); p = d.new_page(width=500, height=500); p.insert_text((30, 40), "GROS-DOC", fontsize=20)
p.insert_image(pymupdf.Rect(20, 60, 480, 480), filename=bigimg); BIG = os.path.join(T, "gros.pdf"); d.save(BIG); d.close()
BAD_PDF = os.path.join(T, "casse.pdf"); open(BAD_PDF, "wb").write(b"%PDF-1.4\nce n'est pas un vrai pdf" + os.urandom(50))
ENC = os.path.join(T, "protege.pdf"); d = pymupdf.open(); d.new_page().insert_text((50, 50), "SECRET"); d.save(ENC, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="mdp", owner_pw="own"); d.close()
J1 = os.path.join(T, "photo.jpg"); pymupdf.Pixmap(noisy_png(os.path.join(T, "p1.png"), 400, 200)).save(J1)   # jpeg paysage 400x200
P2 = noisy_png(os.path.join(T, "p2.png"), 200, 300)

with sync_playwright() as pw:
    b, ctx = launch(pw, accept_downloads=True); errs = []
    pg = open_app(ctx, errs)
    check(True, "application ouverte")
    open_tool(pg, "pdf")

    def pick(btn, files):
        with pg.expect_file_chooser() as fc: pg.click(btn)
        fc.value.set_files(files)

    def export(btn="#pdf-export"):
        with pg.expect_download(timeout=60000) as dl: pg.click(btn)
        path = os.path.join(T, "out_%d.pdf" % random.randrange(10**9)); dl.value.save_as(path)
        return dl.value.suggested_filename, pymupdf.open(path), os.path.getsize(path)

    def texts(doc): return [pg_.get_text().strip() for pg_ in doc]

    def cells(): return pg.locator(".pdf-cell").count()

    def sel(*idx):
        for i in idx: pg.locator(".pdf-cell").nth(i).click()

    def op(o): pg.click(f'[data-op="{o}"]')

    # ---------------- erreurs à l'ouverture
    pick("#pdf-open", [BAD_PDF]); pg.wait_for_selector("#pdf-err:not([hidden])")
    check("illisible" in pg.inner_text("#pdf-err") and "casse.pdf" in pg.inner_text("#pdf-err"), "PDF corrompu : message clair « %s »" % pg.inner_text("#pdf-err")[:60])
    pick("#pdf-open", [ENC]); pg.wait_for_selector("#pdf-err:not([hidden])")
    pg.wait_for_function("document.querySelector('#pdf-err').textContent.includes('mot de passe')")
    check("mot de passe" in pg.inner_text("#pdf-err") and cells() == 0, "PDF protégé : message clair, rien d'ajouté")

    # ---------------- ouverture + vignettes
    pick("#pdf-open", [A]); pg.wait_for_function("document.querySelectorAll('.pdf-cell').length==4")
    check(cells() == 4 and pg.locator("#pdf-err").is_hidden(), "4 pages affichées, erreur effacée")
    pg.wait_for_function("document.querySelectorAll('.pdf-th canvas').length==4", timeout=20000)
    check(True, "vignettes rendues (4 canvas)")
    pg.wait_for_function("document.querySelector('#pdf-name').value.length>0")
    check(pg.input_value("#pdf-name") == "alpha_modifie.pdf", "nom de sortie proposé : " + pg.input_value("#pdf-name"))

    # export brut
    n, doc, sz = export()
    check(n == "alpha_modifie.pdf" and doc.page_count == 4 and texts(doc)[0].startswith("ALPHA-1"), "export intact : 4 pages, nom correct")
    check(doc.metadata.get("title") == "Secret", "métadonnées conservées par défaut")

    # rotation, suppression, duplication, déplacement
    sel(1); op("right"); sel(1); sel(2); op("left"); sel(2)       # p2 +90, p3 -90 ; sélection vide ensuite
    sel(0); op("dup"); sel(0)                                    # dup p1
    check(cells() == 5, "duplication : 5 pages")
    sel(4); op("del")                                            # supprime ALPHA-4 (dernière)
    check(cells() == 4, "suppression : 4 pages")
    # ordre actuel: A1,A1,A2(+90),A3(-90) ; descend la 1ère copie
    sel(0); op("down")
    pg.click('[data-op="none"]')
    n, doc, sz = export()
    t = texts(doc); rots = [p.rotation for p in doc]
    print("   textes", [x[:7] for x in t], "rot", rots)
    check(doc.page_count == 4 and [x[:7] for x in t] == ["ALPHA-1", "ALPHA-1", "ALPHA-2", "ALPHA-3"], "ordre/duplication/suppression corrects")
    check(rots == [0, 0, 90, 270], "rotations +90 / -90 appliquées %s" % rots)

    # sélection → export partiel
    pg.click('[data-op="none"]'); sel(2, 3)
    check("sélection (2 pages)" in pg.inner_text("#pdf-export"), "bouton : " + pg.inner_text("#pdf-export"))
    n, doc, sz = export(); check(doc.page_count == 2 and texts(doc)[0].startswith("ALPHA-2"), "export de la sélection seule")
    pg.click('[data-op="none"]')

    # ---------------- fusion de deux fichiers, ordre réglable
    pick("#pdf-open", [B]); pg.wait_for_function("document.querySelectorAll('.pdf-cell').length==6")
    check(pg.locator(".pdf-file").count() == 2, "2 fichiers listés")
    pg.locator(".pdf-file").nth(1).locator("button").first.click()        # beta monte
    n, doc, sz = export()
    t = [x[:6] for x in texts(doc)]
    check(n == "alpha_fusion.pdf" or n.endswith(".pdf"), "nom fusion : " + n)
    check(doc.page_count == 6 and t[:2] == ["BETA-1", "BETA-2"] and t[2] == "ALPHA-", "fusion dans l'ordre réglé (beta avant alpha) %s" % t)
    pg.locator(".pdf-file").nth(1).locator("button").first.click()        # alpha remonte
    n, doc, sz = export(); check(texts(doc)[0].startswith("ALPHA-1") and texts(doc)[4].startswith("BETA-1"), "ordre rétabli")
    # retirer beta
    pg.locator(".pdf-file").nth(1).locator("button").nth(2).click(); check(cells() == 4, "retrait d'un fichier retire ses pages")

    # ---------------- extraire / scinder / plages invalides (document propre)
    pg.locator(".pdf-file").nth(0).locator("button").nth(2).click(); check(cells() == 0, "document vidé")
    pick("#pdf-open", [A]); pg.wait_for_function("document.querySelectorAll('.pdf-cell').length==4")
    pg.fill("#pdf-ranges", "2-3"); n, doc, _ = export("#pdf-extract")
    check(doc.page_count == 2 and "ALPHA-2" in texts(doc)[0] and n.endswith("_extrait.pdf"), "extraction 2-3")
    pg.fill("#pdf-ranges", "4-"); n, doc, _ = export("#pdf-extract"); check(doc.page_count == 1 and "ALPHA-4" in texts(doc)[0], "plage ouverte « 4- »")
    pg.fill("#pdf-ranges", "1,3,1"); n, doc, _ = export("#pdf-extract"); check(doc.page_count == 3 and "ALPHA-1" in texts(doc)[2], "pages répétées « 1,3,1 »")
    for bad, word in (("9", "hors limites"), ("0-2", "hors limites"), ("3-1", "envers"), ("a-b", "invalide"), ("", "Indique")):
        pg.fill("#pdf-ranges", bad); pg.click("#pdf-extract"); pg.wait_for_selector("#pdf-err:not([hidden])")
        check(word in pg.inner_text("#pdf-err"), f"plage « {bad} » refusée : {pg.inner_text('#pdf-err')[:50]}")
    pg.fill("#pdf-ranges", "1-2,4")
    got = []
    pg.on("download", lambda d_: got.append(d_))
    pg.click("#pdf-split"); pg.wait_for_function("document.querySelector('#pdf-ok') && !document.querySelector('#pdf-ok').hidden && document.querySelector('#pdf-ok').textContent.includes('2 fichiers')", timeout=30000)
    check(len(got) == 2, "scission : 2 fichiers téléchargés")
    parts = []
    for i, d_ in enumerate(got): pth = os.path.join(T, f"part{i}.pdf"); d_.save_as(pth); parts.append(pymupdf.open(pth))
    check(parts[0].page_count == 2 and parts[1].page_count == 1 and "ALPHA-4" in texts(parts[1])[0], "scission : contenus 1-2 et 4")
    check(got[0].suggested_filename.endswith("_partie1.pdf") and got[1].suggested_filename.endswith("_partie2.pdf"), "noms des parties")

    # ---------------- numérotation + filigrane + métadonnées + renommage
    pg.check("#pdf-num"); pg.select_option("#pdf-numfmt", "nn")
    pg.check("#pdf-wm"); pg.fill("#pdf-wmtxt", "BROUILLON")
    pg.check("#pdf-meta"); pg.fill("#pdf-name", "mon doc/final.pdf")
    n, doc, _ = export()
    check(n == "mon doc_final.pdf", "renommage assaini : " + n)
    allt = [p.get_text() for p in doc]
    check(all(f"{i+1} / 4" in allt[i] for i in range(4)), "numérotation « n / 4 » sur chaque page")
    check(all("BROUILLON" in "".join(x.split()) or "BROUILLON" in x.replace("\n", "") for x in allt), "filigrane présent sur chaque page")
    m = doc.metadata; check(not m.get("title") and not m.get("author") and not m.get("producer") and not m.get("creationDate"), "métadonnées effacées %s" % {k: v for k, v in m.items() if v})
    # filigrane en diagonale : ligne non horizontale
    dr = doc[0].get_text("dict"); dirs = [l["dir"] for bl in dr["blocks"] if bl["type"] == 0 for l in bl["lines"] if "BROUILLON" in "".join(s["text"] for s in l["spans"])]
    check(dirs and abs(dirs[0][1]) > 0.5, "filigrane diagonal %s" % (dirs[:1],))
    pg.fill("#pdf-wmtxt", "漢字"); pg.click("#pdf-export"); pg.wait_for_selector("#pdf-err:not([hidden])")
    check("latines" in pg.inner_text("#pdf-err"), "filigrane non latin : erreur française")
    pg.uncheck("#pdf-wm"); pg.uncheck("#pdf-num"); pg.uncheck("#pdf-meta")

    # numérotation sur page pivotée : texte lisible quand même
    sel(0); op("right"); pg.click('[data-op="none"]'); pg.check("#pdf-num"); pg.select_option("#pdf-numfmt", "n")
    n, doc, _ = export(); check(doc[0].rotation == 90 and "1" in doc[0].get_text(), "numérotation sur page pivotée")
    pg.uncheck("#pdf-num")

    # ---------------- compression
    pg.evaluate("document.querySelectorAll('.pdf-file button')[2].click()")      # retire alpha
    check(cells() == 0 and pg.locator("#pdf-opt-card").is_hidden(), "tout retiré : panneau masqué")
    pick("#pdf-open", [BIG]); pg.wait_for_function("document.querySelectorAll('.pdf-cell').length==1")
    orig = os.path.getsize(BIG)
    pg.select_option("#pdf-comp", "std"); n, doc, s_std = export()
    check(doc.page_count == 1 and "GROS-DOC" in texts(doc)[0], "compression standard : PDF valide (%d -> %d)" % (orig, s_std))
    pg.select_option("#pdf-comp", "agg"); check(pg.locator("#pdf-q").is_visible(), "options agressives visibles")
    pg.fill("#pdf-q", "60") if False else pg.evaluate("(()=>{const q=document.querySelector('#pdf-q');q.value=60;q.dispatchEvent(new Event('input'))})()")
    pg.select_option("#pdf-scale", "1")
    n, doc, s_agg = export()
    check(doc.page_count == 1 and s_agg < orig * 0.7 and s_agg < s_std, "compression agressive : %d -> %d octets" % (orig, s_agg))
    check(len(doc[0].get_images()) == 1 and abs(doc[0].rect.width - 500) < 1, "page rastérisée, dimensions conservées")
    txt = pg.inner_text("#pdf-ok"); print("   ", txt)
    check("→" in txt and "−" in txt and "%" in txt, "affiche avant → après et gain")
    qlow = s_agg
    pg.evaluate("(()=>{const q=document.querySelector('#pdf-q');q.value=90;q.dispatchEvent(new Event('input'))})()"); pg.select_option("#pdf-scale", "2")
    n, doc, s_hi = export(); check(s_hi > qlow, "qualité/échelle plus hautes -> fichier plus gros (%d > %d)" % (s_hi, qlow))
    pg.select_option("#pdf-comp", "std")

    # ---------------- images -> PDF
    with pg.expect_file_chooser() as fc: pg.click("#pdf-img")
    fc.value.set_files([J1, P2]); pg.wait_for_selector(".pdf-modal")
    pg.click('.pdf-modal [data-m="a4"]'); pg.wait_for_function("document.querySelectorAll('.pdf-cell').length==3", timeout=20000)
    pg.locator(".pdf-file").nth(0).locator("button").nth(2).click()      # retire gros.pdf
    check(cells() == 2 and pg.locator(".pdf-file").count() == 1, "images ajoutées comme un document de 2 pages")
    n, doc, _ = export()
    r0, r1 = doc[0].rect, doc[1].rect
    check(doc.page_count == 2 and abs(r0.width - 841.89) < 1 and abs(r0.height - 595.28) < 1 and abs(r1.width - 595.28) < 1, "images → A4 (paysage puis portrait)")
    check(len(doc[0].get_images()) == 1 and len(doc[1].get_images()) == 1, "chaque page contient son image")
    pg.locator(".pdf-file").nth(0).locator("button").nth(2).click()
    with pg.expect_file_chooser() as fc: pg.click("#pdf-img")
    fc.value.set_files([P2]); pg.wait_for_selector(".pdf-modal"); pg.click('.pdf-modal [data-m="img"]')
    pg.wait_for_function("document.querySelectorAll('.pdf-cell').length==1", timeout=20000)
    n, doc, _ = export(); check(abs(doc[0].rect.width - 150) < 1 and abs(doc[0].rect.height - 225) < 1, "images → taille de l'image (200x300 px -> 150x225 pt)")
    pg.locator(".pdf-file").nth(0).locator("button").nth(2).click()
    with pg.expect_file_chooser() as fc: pg.click("#pdf-img")
    fc.value.set_files([BAD_PDF]); pg.wait_for_selector(".pdf-modal"); pg.click('.pdf-modal [data-m="a4"]')
    pg.wait_for_selector("#pdf-err:not([hidden])"); check("Aucune image utilisable" in pg.inner_text("#pdf-err"), "image invalide : " + pg.inner_text("#pdf-err")[:50])
    pick("#pdf-open", [B]); pg.wait_for_function("document.querySelectorAll('.pdf-cell').length==2")
    check(not pg.locator("#pdf-open").is_disabled(), "boutons réactivés après erreur")

    # PDF source jamais modifié
    check(pymupdf.open(A).page_count == 4, "fichier original intact")
    check(not errs, "aucune erreur JavaScript " + str(errs[:3]))
    b.close()
print("ÉCHECS:", BAD or "aucun")
