"""Nettoyeur de stockage (m_cleaner.js) avec un FAUX pont natif : regroupements, meilleurs conservés, totaux, sélection, suppression, garde-fous."""
import json, random, time
from mobile_common import *

MB = 1048576
NOW = 1_800_000_000          # le faux « maintenant » n'est pas utilisé : on fixe les dates par rapport à l'horloge réelle du navigateur
rng = random.Random(7)


def flip(h, bits):
    v = int(h, 16)
    for b in bits: v ^= 1 << b
    return "%016x" % v


def ham(a, b): return bin(int(a, 16) ^ int(b, 16)).count("1")


# ---- jeu de données synthétique
bases = []
while len(bases) < 40:
    h = "%016x" % rng.getrandbits(64)
    if 24 <= bin(int(h, 16)).count("1") <= 40 and all(ham(h, o) >= 24 for o in bases): bases.append(h)
it = iter(bases)
items, nid = [], [1000]


def mk(kind, name, mb, days, w, h, blur, dh, shot=False, folder="Camera", dur=0):
    nid[0] += 1
    i = nid[0]
    items.append({"kind": kind, "id": i, "uri": f"content://media/external/{'video' if kind == 'video' else 'images'}/media/{i}", "name": name, "size": int(mb * MB),
                  "daysAgo": days, "folder": folder, "w": w, "h": h, "blur": blur, "dhash": dh, "isScreenshot": shot, "duration": dur})
    return i


for n in range(14): mk("image", f"IMG_{n:03d}.jpg", 2 + n * 0.5, 5 + n, 4000, 3000, 180 + n * 20, next(it))                      # nettes et uniques
fl = [mk("image", f"IMG_flou{n}.jpg", 1.5, 20, 4000, 3000, b, next(it)) for n, b in enumerate((5, 12.5, 40))]                      # floues
li = [mk("image", f"IMG_limite{n}.jpg", 1.5, 20, 4000, 3000, b, next(it)) for n, b in enumerate((70, 100))]                      # limite
hA = next(it)
A1 = mk("image", "A1.jpg", 5, 3, 4000, 3000, 300, hA); A2 = mk("image", "A2.jpg", 1.5, 3, 2000, 1500, 500, flip(hA, [1])); A3 = mk("image", "A3.jpg", 4.5, 3, 4000, 3000, 150, flip(hA, [3, 9, 40]))
hB = next(it)
B1 = mk("image", "B_recent.jpg", 3, 1, 3000, 2000, 200, hB); B2 = mk("image", "B_ancien.jpg", 3, 9, 3000, 2000, 200, hB)
hC = next(it)
C1 = mk("image", "C1.jpg", 2, 8, 3000, 2000, 250, hC); C2 = mk("image", "C2.jpg", 2, 8, 3000, 2000, 250, flip(hC, [0, 8, 16, 24, 32, 40, 48, 56]))   # distance 8
hE = next(it)
E1 = mk("image", "E1.jpg", 2, 7, 3000, 2000, 260, hE); E2 = mk("image", "E2.jpg", 2, 7, 3000, 2000, 255, flip(hE, [2, 4, 6, 8, 10]))
E3 = mk("image", "E3.jpg", 2.5, 7, 3000, 2000, 250, flip(hE, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20][:5] and [2, 4, 6, 8, 10][:0] + [12, 14, 16, 18, 20][:5]))
# E2 = E1 + 5 bits ; E3 = E1 + 5 autres bits -> E1-E2 = 5, E1-E3 = 5, E2-E3 = 10 (chaîne, regroupée par union-find)
hF = next(it)
F1 = mk("image", "F1.jpg", 2, 6, 4000, 3000, 220, hF); F2 = mk("image", "F2.jpg", 1.5, 6, 3200, 1800, 220, hF)                    # même empreinte, formats différents
G1 = mk("image", "G1_uni.png", 1, 6, 1000, 1000, 200, "0000000000000000"); G2 = mk("image", "G2_uni.png", 2, 6, 1000, 1000, 200, "0000000000000000")   # images unies
sb = mk("image", "Screenshot_flou.png", 0.5, 90, 1080, 2400, 20, next(it), True, "Screenshots")
old = [mk("image", f"Screenshot_{n}.png", 0.5 + n * 0.5, 40 + n * 30, 1080, 2400, 300, next(it), True, "Screenshots") for n in range(4)]
rec = [mk("image", f"Screenshot_new{n}.png", 0.5, 2 + n * 4, 1080, 2400, 300, next(it), True, "Screenshots") for n in range(2)]
v1 = mk("video", "VID_big.mp4", 300, 30, 1920, 1080, None, None, dur=600); v2 = mk("video", "VID_mid.mp4", 150, 20, 1920, 1080, None, None, dur=300); v3 = mk("video", "VID_small.mp4", 30, 10, 1280, 720, None, None, dur=60)
print("   jeu de données :", len(items), "entrées")


def expected(dup=6, shot=30, big=100, blur=60):
    imgs = [x for x in items if x["kind"] == "image"]
    par = {x["id"]: x["id"] for x in imgs}
    def f(a):
        while par[a] != a: a = par[a]
        return a
    byid = {x["id"]: x for x in items}
    def low(h): return not (6 <= bin(int(h, 16)).count("1") <= 58)
    for a in imgs:
        for b in imgs:
            if a["id"] >= b["id"] or not a["dhash"] or not b["dhash"]: continue
            d = ham(a["dhash"], b["dhash"])
            if d > dup: continue
            if low(a["dhash"]) or low(b["dhash"]):
                ok = d == 0 and a["size"] == b["size"]
            else:
                ra, rb = a["w"] / a["h"], b["w"] / b["h"]
                ok = abs(ra - rb) / max(ra, rb) <= 0.12
            if ok: par[f(b["id"])] = f(a["id"])
    gr = {}
    for x in imgs: gr.setdefault(f(x["id"]), []).append(x)
    groups = [g for g in gr.values() if len(g) > 1]
    def key(x): return (-(x["w"] * x["h"]), -(x["blur"] if x["blur"] is not None else -1), -x["size"], -x["daysAgo"], x["id"])
    best = {min(g, key=key)["id"] for g in groups}
    rest = [x["id"] for g in groups for x in g if x["id"] not in best]
    blurry = [x["id"] for x in imgs if x["blur"] is not None and x["blur"] < blur]
    shots = [x["id"] for x in imgs if x["isScreenshot"] and x["daysAgo"] >= shot]
    bigs = [x["id"] for x in items if x["kind"] == "video" and x["size"] >= big * MB]
    return {"groups": [sorted(y["id"] for y in g) for g in groups], "best": best, "rest": rest, "blurry": blurry, "shots": shots, "big": bigs, "byid": byid}


def fmt(n):
    if n >= 1073741824: return ("%.2f" % (n / 1073741824)).replace(".", ",") + " Go"
    if n >= MB: return ("%.1f" % (n / MB)).replace(".", ",") + " Mo"
    return f"{n} o"


def size_of(ids, byid): return sum(byid[i]["size"] for i in ids)


FAKE = """([items, grant]) => {
  const now = Date.now() / 1000;
  const full = items.map((x) => Object.assign({}, x, { date: Math.floor(now - x.daysAgo * 86400) })); full.forEach((x) => delete x.daysAgo);
  window.__calls = []; window.__grant = grant; window.__del = 'ok'; window.__known = new Set(full.map((x) => x.uri));
  const emit = (id, evt, p) => setTimeout(() => ENOS.native._cb(id, evt, typeof p === 'string' ? p : JSON.stringify(p)), 3);
  window.Enos = {
    galleryPermission(id) { __calls.push(['perm']); emit(id, 'perm', { granted: window.__grant !== false }); },
    galleryScan(id) { __calls.push(['scan']); emit(id, 'head', { total: full.length }); for (let i = 0; i < full.length; i += 10) emit(id, 'items', full.slice(i, i + 10)); setTimeout(() => emit(id, 'end', { count: full.length }), 40); },
    galleryCancel() { __calls.push(['cancel']); },
    galleryDelete(id, json) {
      const uris = JSON.parse(json); __calls.push(['delete', uris]);
      if (!uris.every((u) => __known.has(u))) return emit(id, 'deleted', { ok: false, error: 'hors scan' });
      if (__del === 'cancel') return emit(id, 'deleted', { ok: false, cancelled: true, deleted: [] });
      if (__del === 'error') return emit(id, 'deleted', { ok: false, error: 'Suppression refusée par le système.' });
      uris.forEach((u) => __known.delete(u)); emit(id, 'deleted', { ok: true, deleted: uris });
    },
    galleryThumb(uri) { return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='; },
  };
  ENOS.native.available = true;
  ENOS.cleaner.rerender();
}"""


def uris(ids, byid): return sorted(byid[i]["uri"] for i in ids)


with sync_playwright() as pw:
    b, ctx = launch(pw); errs = []
    pg = open_app(ctx, errs)
    pg.click('#tabbar [data-tab="tools"]'); pg.wait_for_selector('.mtile[data-m="cleaner"]')
    check(pg.locator('.mtile[data-m="cleaner"]').count() == 1, "tuile « Nettoyeur de stockage » dans Modules")
    open_tool(pg, "cleaner")
    check("application Android" in pg.inner_text("#cln-root") and pg.locator("#cln-scan").count() == 0, "hors application : « disponible dans l'application Android »")

    # ---- fonctions pures (cleanerLib)
    L = pg.evaluate("""() => { const L = ENOS.cleanerLib;
      return { h0: L.hamming('0000000000000000', 'ffffffffffffffff'), h1: L.hamming('00000000000000ff', '0000000000000000'), hbad: L.hamming('zz', '00'),
        c: [L.blurClass(59.9), L.blurClass(60), L.blurClass(119.9), L.blurClass(120), L.blurClass(null), L.blurClass(30, { blur: 20, limit: 40 })],
        age: L.ageDays(1000000, 1000000 + 86400 * 45 + 5), age0: L.ageDays(1000, 900) }; }""")
    check(L["h0"] == 64 and L["h1"] == 8 and L["hbad"] == float("inf"), "hamming : 64 bits opposés = 64, 8 bits = 8, empreinte invalide = infini")
    check(L["c"] == ["floue", "limite", "limite", "nette", "inconnue", "limite"], "seuils de flou : " + str(L["c"]))
    check(L["age"] == 45 and L["age0"] == 0, "âge des captures en jours")

    pg.evaluate(FAKE, [items, False])
    check(pg.locator("#cln-scan").count() == 1, "pont injecté : bouton d'analyse affiché")
    pg.click("#cln-scan"); pg.wait_for_selector("#cln-perm")
    check("refusé" in pg.inner_text("#cln-perm") and pg.evaluate("__calls.map((c) => c[0]).join()") == "perm", "permission refusée : message clair, aucune analyse lancée")
    pg.evaluate("window.__grant = true; window.__calls = []")
    pg.click("#cln-scan"); pg.wait_for_selector("#cln-cats")
    pg.wait_for_function("/%d fichiers/.test(document.querySelector('#cln-total').textContent)" % len(items))
    check(pg.evaluate("__calls.map((c) => c[0]).join()") == "perm,scan", "permission accordée puis analyse lancée")

    # ---- catégories / totaux
    ex = expected(); by = ex["byid"]
    def cat(c): return pg.inner_text(f"#cln-cat-{c} .cln-count"), pg.inner_text(f"#cln-cat-{c} .cln-space")
    for key, ids in (("blurry", ex["blurry"]), ("dups", ex["rest"]), ("shots", ex["shots"]), ("big", ex["big"])):
        n, sp = cat(key)
        want = size_of(ids, by)
        check(int(n) == len(ids) and fmt(want) in sp, f"catégorie {key} : {n} élément(s), {sp} (attendu {len(ids)} / {fmt(want)})")
    # regroupements calculés par la lib, comparés à une implémentation indépendante
    for dist in (0, 6, 8, 12):
        e = expected(dup=dist)
        got = pg.evaluate("""([items, dist]) => ENOS.cleanerLib.groupDuplicates(items, dist).map((g) => ({ ids: g.items.map((i) => i.id).sort((a, b) => a - b), best: g.best.id }))""", [[dict(x, date=int(time.time()) - x["daysAgo"] * 86400) for x in items], dist])
        gids = sorted(map(tuple, (g["ids"] for g in got))); eids = sorted(map(tuple, e["groups"]))
        check(gids == eids and {g["best"] for g in got} == e["best"], f"groupes de doublons à distance <= {dist} : {len(got)} groupe(s), meilleurs conservés identiques à la référence")
    e6 = expected()
    named = {x["id"]: x["name"] for x in items}
    check(any(set(g) == {A1, A2, A3} for g in e6["groups"]) and A1 in e6["best"] and A2 not in e6["best"] and A3 not in e6["best"], "groupe A : meilleur = plus grande résolution puis plus nette (A1)")
    check(any(set(g) == {B1, B2} for g in e6["groups"]) and B2 in e6["best"], "groupe B : identiques, on garde la plus ancienne")
    check(any(set(g) == {E1, E2, E3} for g in e6["groups"]), "groupe E : chaîne regroupée par union-find")
    check(not any(C1 in g for g in e6["groups"]) and any(set(g) == {C1, C2} for g in expected(dup=8)["groups"]), "groupe C : distance 8, groupé seulement avec une tolérance >= 8")
    check(not any(F1 in g or G1 in g for g in e6["groups"]), "formats très différents ou images unies : jamais regroupés")

    # ---- doublons : aucune sélection par défaut
    pg.click("#cln-cat-dups"); pg.wait_for_selector("#cln-keepbest")
    check(pg.locator(".cln-item.on").count() == 0 and pg.locator("#cln-bar").is_hidden(), "doublons : aucune sélection par défaut, pas de bouton de suppression")
    check(pg.locator(".cln-keep").count() == len(e6["groups"]), "un « À GARDER » par groupe")
    pg.wait_for_selector(".cln-th img")
    check(pg.locator(".cln-th img").count() > 0, "vignettes fournies par le natif affichées")
    pg.click("#cln-keepbest")
    want = size_of(e6["rest"], by)
    check(pg.locator(".cln-item.on").count() == len(e6["rest"]), f"« garder le meilleur » : {len(e6['rest'])} sélectionnés")
    check(pg.inner_text("#cln-del").strip() == f"SUPPRIMER ({len(e6['rest'])}) · {fmt(want)}", "bouton : " + pg.inner_text("#cln-del"))
    best_cell = pg.locator(f'.cln-item[data-k="{by[A1]["uri"]}"]')
    best_cell.click()
    check(pg.locator(f'.cln-item[data-k="{by[A1]["uri"]}"].on').count() == 0, "garde-fou : impossible de sélectionner la dernière copie d'un groupe")
    pg.locator(f'.cln-item[data-k="{by[A2]["uri"]}"]').click()
    check(pg.locator(".cln-item.on").count() == len(e6["rest"]) - 1, "désélection d'une copie")
    pg.locator(f'.cln-item[data-k="{by[A2]["uri"]}"]').click()

    # ---- suppression annulée dans la boîte système
    pg.evaluate("window.__calls = []; window.__del = 'cancel'")
    pg.click("#cln-del"); pg.wait_for_selector("#cln-bar:not([hidden]) #cln-del:not([disabled])")
    pg.wait_for_function("window.__calls.length === 1")
    check(pg.evaluate("__calls[0][0]") == "delete" and sorted(pg.evaluate("__calls[0][1]")) == uris(e6["rest"], by), "appel galleryDelete avec EXACTEMENT les bons ids (annulation)")
    pg.wait_for_function("document.querySelector('.cln-item') !== null")
    check(pg.locator(".cln-item").count() >= len(e6["rest"]) and pg.locator(".cln-item.on").count() == len(e6["rest"]), "suppression annulée : rien n'est retiré, la sélection est conservée")
    # ---- erreur système
    pg.evaluate("window.__calls = []; window.__del = 'error'")
    pg.click("#cln-del"); pg.wait_for_function("window.__calls.length === 1"); pg.wait_for_selector("#cln-del:not([disabled])")
    check(pg.locator(".cln-item.on").count() == len(e6["rest"]), "erreur de suppression : éléments conservés")
    # ---- suppression confirmée
    pg.evaluate("window.__calls = []; window.__del = 'ok'")
    pg.click("#cln-del"); pg.wait_for_function("window.__calls.length === 1")
    check(sorted(pg.evaluate("__calls[0][1]")) == uris(e6["rest"], by), "appel galleryDelete avec EXACTEMENT les bons ids (confirmé)")
    pg.wait_for_selector("#cln-bar[hidden]", state="attached")
    left = len(items) - len(e6["rest"])
    check(pg.evaluate("ENOS.cleaner.state().count") == left and pg.evaluate("ENOS.cleaner.state().selected.length") == 0, f"après suppression : {left} fichiers restants, sélection vide")
    pg.click("#cln-back"); pg.wait_for_selector("#cln-cats")
    check(cat("dups")[0] == "0" and "Rien" in cat("dups")[1], "doublons : catégorie vidée")
    check("libérés" in pg.inner_text("#cln-msg"), "message : " + pg.inner_text("#cln-msg"))

    # ---- union de catégories : floue + capture = un seul fichier
    by = e6["byid"]
    pg.click("#cln-cat-blurry"); pg.click("#cln-selall")
    nb = len(ex["blurry"]); check(pg.inner_text("#cln-del").startswith(f"SUPPRIMER ({nb})"), "floues : tout sélectionner")
    pg.click("#cln-back"); pg.click("#cln-cat-shots"); pg.click("#cln-selall")
    uni = sorted(set(ex["blurry"]) | set(ex["shots"])); assert sb in uni and len(uni) == len(ex["blurry"]) + len(ex["shots"]) - 1
    check(pg.inner_text("#cln-del").strip() == f"SUPPRIMER ({len(uni)}) · {fmt(size_of(uni, by))}", "floues + captures : un fichier à la fois flou et capture n'est compté qu'une fois : " + pg.inner_text("#cln-del"))
    pg.click("#cln-back"); pg.click("#cln-cat-big"); pg.click("#cln-selall")
    allsel = sorted(set(uni) | set(ex["big"]))
    pg.evaluate("window.__calls = []; window.__del = 'ok'")
    pg.click("#cln-del"); pg.wait_for_function("window.__calls.length === 1")
    check(sorted(pg.evaluate("__calls[0][1]")) == uris(allsel, by), f"suppression groupée : exactement les {len(allsel)} bons ids (flous + captures + vidéos)")
    pg.wait_for_function("ENOS.cleaner.state().count === %d" % (len(items) - len(e6["rest"]) - len(allsel)))
    pg.click("#cln-back")
    check(cat("blurry")[0] == "0" and cat("shots")[0] == "0" and cat("big")[0] == "0", "catégories vidées après suppression")

    # ---- refus des ids hors scan et des URI invalides
    pg.evaluate("window.__calls = []")
    r = pg.evaluate("""async () => [
      await ENOS.cleaner.deleteKeys(['content://media/external/images/media/999999']),
      await ENOS.cleaner.deleteKeys(['file:///data/data/com.nasko.app/shared_prefs/x.xml']),
      await ENOS.cleaner.deleteKeys(['content://media/external/images/media/1001/../1002']),
      await ENOS.cleaner.deleteKeys([]),
      await ENOS.cleaner.deleteKeys(Array.from({ length: 600 }, (_, i) => 'content://media/external/images/media/' + i)) ]""")
    check(all(not x["ok"] for x in r) and "hors" in r[0]["error"] and r[0]["refused"] == ["content://media/external/images/media/999999"], "ids hors de la dernière analyse refusés")
    check(not r[1]["ok"] and not r[2]["ok"], "URI non content://media/… ou traversée refusées")
    check(pg.evaluate("window.__calls.length") == 0, "aucun appel natif pour les demandes refusées")
    # un groupe entier ne peut jamais être supprimé (rouvrir un jeu complet)
    pg.evaluate(FAKE, [items, True]); pg.click("#cln-scan"); pg.wait_for_selector("#cln-cats"); pg.wait_for_function("/%d fichiers/.test(document.querySelector('#cln-total').textContent)" % len(items))
    whole = [by[i]["uri"] for i in e6["groups"][0]]
    r = pg.evaluate("(k) => ENOS.cleaner.deleteKeys(k)", whole)
    check(not r["ok"] and "entièrement" in r["error"] and pg.evaluate("window.__calls.filter((c) => c[0] === 'delete').length") == 0, "supprimer toutes les copies d'un groupe : refusé")

    # ---- réglages : tolérance des doublons
    before = int(cat("dups")[0])
    pg.evaluate("document.querySelector('.cln-set').open = true"); pg.select_option("#cln-s-dup", "10"); pg.wait_for_selector("#cln-cats")
    after = int(cat("dups")[0]); e10 = expected(dup=10)
    check(after == len(e10["rest"]) and after > before, f"tolérance « Large » : {before} -> {after} doublons")
    pg.evaluate("document.querySelector('.cln-set').open = true"); pg.select_option("#cln-s-big", "250")
    check(cat("big")[0] == "1", "seuil des gros fichiers 250 Mo : 1 vidéo")
    pg.click("#cln-cat-big"); pg.click(".cln-i >> nth=0"); pg.wait_for_selector("#cln-info")
    check("VID_big" in pg.inner_text("#cln-info"), "détails d'un fichier (ⓘ)"); pg.click("#cln-iclose")
    # ---- cible tactile et XSS
    pg.click("#cln-selall")
    h = pg.evaluate("Array.from(document.querySelectorAll('#cln-bar .btn, #cln-back, #cln-selall')).map((e) => e.getBoundingClientRect().height)")
    check(all(x >= 44 for x in h), "cibles tactiles >= 44 px " + str(h))
    check(not errs, "aucune erreur JavaScript " + str(errs[:3]))
    b.close()
print("ÉCHECS:", BAD or "aucun")
