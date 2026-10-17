"""Coffre-fort hors-ligne (m_vault.js) : chiffrement WebCrypto, IndexedDB sans octet en clair, round-trip octet pour octet."""
import json, hashlib, os, struct, tempfile, time, zlib
from mobile_common import *

MARK = b"SECRET-MARQUEUR-ENOS-0042"
PH1, PH2 = "correct horse battery", "autre phrase solide 2026"


def png():
    w, h = 64, 48
    raw = b"".join(b"\x00" + b"".join(bytes((x * 4 % 256, y * 5 % 256, (x + y) % 256)) for x in range(w)) for y in range(h))
    def ch(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + ch(b"tEXt", b"Comment\x00" + MARK) + ch(b"IDAT", zlib.compress(raw)) + ch(b"IEND", b"")


def pdf():
    s = b"BT /F1 24 Tf 72 700 Td (" + MARK + b") Tj ET"
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            b"<< /Length %d >>\nstream\n" % len(s) + s + b"\nendstream", b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offs = b"%PDF-1.4\n", []
    for i, o in enumerate(objs):
        offs.append(len(out)); out += b"%d 0 obj\n" % (i + 1) + o + b"\nendobj\n"
    x = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offs)
    return out + b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)


def big():
    n = 10 * 1024 * 1024 + 12345
    b = bytearray(os.urandom(n))
    for p in (0, n // 2, n - len(MARK)): b[p:p + len(MARK)] = MARK
    return bytes(b)


SCAN = """async ([dbn, needles]) => {
  const enc = new TextEncoder(), nds = needles.map((s) => (typeof s === "string" ? enc.encode(s) : Uint8Array.from(s)));
  const db = await new Promise((res, rej) => { const r = indexedDB.open(dbn); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const hit = {}, stats = { records: 0, bytes: 0 };
  const has = (b, nd) => { let i = b.indexOf(nd[0]); while (i >= 0 && i <= b.length - nd.length) { let k = 1; while (k < nd.length && b[i + k] === nd[k]) k++; if (k === nd.length) return true; i = b.indexOf(nd[0], i + 1); } return false; };
  const chk = (b, tag) => nds.forEach((nd, j) => { if (has(b, nd)) hit[JSON.stringify(needles[j])] = tag; });
  const walk = (v, tag) => {
    if (v == null) return;
    if (typeof v === "string") return chk(enc.encode(v), tag);
    if (typeof v === "number" || typeof v === "boolean") return;
    if (v instanceof ArrayBuffer) { stats.bytes += v.byteLength; return chk(new Uint8Array(v), tag); }
    if (ArrayBuffer.isView(v)) { stats.bytes += v.byteLength; return chk(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), tag); }
    if (v instanceof Blob) return;
    Object.keys(v).forEach((k) => { chk(enc.encode(k), tag + ".key"); walk(v[k], tag + "." + k); });
  };
  for (const name of Array.from(db.objectStoreNames)) {
    const st = db.transaction(name).objectStore(name);
    const vals = await new Promise((r) => { const q = st.getAll(); q.onsuccess = () => r(q.result); });
    const keys = await new Promise((r) => { const q = st.getAllKeys(); q.onsuccess = () => r(q.result); });
    stats.records += vals.length; stats[name] = vals.length;
    vals.forEach((v) => walk(v, name)); keys.forEach((k) => walk(k, name + ".pk"));
  }
  db.close(); return { hit, stats };
}"""


def sha(b): return hashlib.sha256(b).hexdigest()


with sync_playwright() as pw:
    b, ctx = launch(pw, accept_downloads=True); errs = []
    pg = open_app(ctx, errs)
    pg.on("console", lambda m: m.type == "error" and print("   console.error:", m.text[:160]))
    tmp = tempfile.mkdtemp(prefix="vlt_")
    files = {"facture_secrete.png": png(), "contrat_confidentiel.pdf": pdf(), "gros_fichier.bin": big()}
    paths = {}
    for n, d in files.items():
        paths[n] = os.path.join(tmp, n); open(paths[n], "wb").write(d)
    hashes = {n: sha(d) for n, d in files.items()}
    needles = [MARK.decode(), "facture_secrete", "contrat_confidentiel", "gros_fichier", PH1, [137, 80, 78, 71, 13, 10, 26, 10], "%PDF-", "ENOS-VAULT-v1", "image/png", "application/pdf"]

    pg.click('#tabbar [data-tab="tools"]'); pg.wait_for_selector('.mtile[data-m="vault"]')
    check(pg.locator('.mtile[data-m="vault"]').count() == 1, "tuile « Coffre-fort » dans Modules")
    open_tool(pg, "vault")

    # ---- lib : primitives
    r = pg.evaluate("""async () => {
      const L = ENOS.vaultLib, salt = crypto.getRandomValues(new Uint8Array(16)), k = await L.deriveKey("phrase de test 1", salt, L.MIN_ITER);
      const data = crypto.getRandomValues(new Uint8Array(1000)), ch = await L.encryptChunks(k, data, "fid1", 300);
      const back = await L.decryptChunks(k, ch, "fid1"), same = back.length === 1000 && back.every((v, i) => v === data[i]);
      const tamper = ch.map((c) => c.slice()); tamper[1][20] ^= 1;
      const fails = async (f) => { try { await f(); return false; } catch (e) { return true; } };
      let ext = true; try { await crypto.subtle.exportKey("raw", k); } catch (e) { ext = false; }
      const k2 = await L.deriveKey("autre phrase test", salt, L.MIN_ITER), v = await L.makeVerifier(k);
      return { n: ch.length, same, ivUniq: new Set(ch.map((c) => Array.from(c.slice(0, 12)).join())).size === ch.length,
        tamper: await fails(() => L.decryptChunks(k, tamper, "fid1")), swap: await fails(() => L.decryptChunks(k, [ch[1], ch[0], ch[2], ch[3]], "fid1")),
        otherId: await fails(() => L.decryptChunks(k, ch, "fid2")), trunc: await fails(() => L.decryptChunks(k, ch.slice(0, 3), "fid1")),
        extractable: ext, vOk: await L.checkVerifier(k, v), vBad: await L.checkVerifier(k2, v), lowIter: await fails(() => L.deriveKey("x", salt, 1000)),
        iter: L.ITER, d0: L.delayFor(2), d3: L.delayFor(3), d5: L.delayFor(5), chunk: L.CHUNK };
    }""")
    check(r["n"] == 4 and r["same"] and r["ivUniq"], "lib : 4 blocs, round-trip exact, IV tous distincts")
    check(r["tamper"] and r["swap"] and r["otherId"] and r["trunc"], "lib : bloc altéré / permuté / autre fichier / tronqué -> refusé")
    check(not r["extractable"], "lib : clé non extractable")
    check(r["vOk"] and not r["vBad"], "lib : vérificateur accepte la bonne clé, refuse la mauvaise")
    check(r["iter"] >= 310000 and r["lowIter"], f"lib : PBKDF2 {r['iter']} itérations (>= 310000), valeur trop basse refusée")
    check(r["chunk"] == 4 * 1024 * 1024 and r["d0"] == 0 and r["d3"] == 5000 and r["d5"] == 20000, "lib : blocs de 4 Mo, délai croissant (0 / 5 s / 20 s)")

    # ---- création
    check(pg.locator("#vlt-create").count() == 1 and "rien n'est récupérable" in pg.inner_text("#tool-vault"), "création : avertissement « rien n'est récupérable »")
    pg.fill("#vlt-phrase", "court"); pg.fill("#vlt-phrase2", "court"); pg.check("#vlt-ack"); pg.click("#vlt-create")
    check("10 caractères" in pg.inner_text("#vlt-err"), "phrase trop courte refusée")
    pg.fill("#vlt-phrase", PH1); pg.fill("#vlt-phrase2", PH1 + "x"); pg.click("#vlt-create")
    check("pas identiques" in pg.inner_text("#vlt-err"), "confirmation différente refusée")
    pg.fill("#vlt-phrase2", PH1); pg.uncheck("#vlt-ack"); pg.click("#vlt-create")
    check("Coche la case" in pg.inner_text("#vlt-err"), "case « j'ai compris » obligatoire")
    pg.check("#vlt-ack"); pg.click("#vlt-create"); pg.wait_for_selector("#vlt-add")
    check("ouvert" in pg.inner_text("#tool-vault h3").lower(), "coffre créé et ouvert")

    # ---- ajout
    with pg.expect_file_chooser() as fc: pg.click("#vlt-add")
    fc.value.set_files(list(paths.values()))
    pg.wait_for_function("document.querySelector('#vlt-status') && /3 fichier/.test(document.querySelector('#vlt-status').textContent)", timeout=60000)
    names = [t.strip() for t in pg.locator(".vlt-item b").all_inner_texts()]
    check(sorted(names) == sorted(files), f"3 fichiers listés {names}")
    pg.wait_for_selector('.vlt-item img', timeout=5000)
    check(pg.locator(".vlt-item img").count() == 1, "vignette de l'image (déchiffrée en mémoire)")

    # ---- verrouillage + contenu d'IndexedDB
    pg.click("#vlt-lock"); pg.wait_for_selector("#vlt-unlock")
    check(pg.locator(".vlt-item").count() == 0 and "facture_secrete" not in pg.inner_text("#tool-vault"), "verrouillé : plus aucun nom ni vignette dans la page")
    ctl = pg.evaluate("""async () => { await new Promise((res) => { const r = indexedDB.open('enos-ctl', 1); r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onsuccess = () => { const t = r.result.transaction('s', 'readwrite'); t.objectStore('s').put(new TextEncoder().encode('xx SECRET-MARQUEUR-ENOS-0042 yy'), 'k'); t.oncomplete = () => { r.result.close(); res(); }; }; }); return 1; }""")
    c = pg.evaluate(SCAN, ["enos-ctl", [MARK.decode()]])
    check(json.dumps(MARK.decode()) in c["hit"], "témoin positif : le détecteur trouve bien un marqueur en clair")
    pg.evaluate("indexedDB.deleteDatabase('enos-ctl')")
    d = pg.evaluate(SCAN, ["enos-vault", needles])
    print("   IndexedDB :", d["stats"])
    check(d["hit"] == {}, "IndexedDB : AUCUNE signature en clair (marqueur, noms, types, PNG, %PDF, phrase) " + str(d["hit"]))
    check(d["stats"].get("chunks") == 1 + 1 + 3 and d["stats"].get("files") == 3, "IndexedDB : 5 blocs chiffrés (gros fichier = 3 blocs de 4 Mo)")
    ls = pg.evaluate("JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)])")
    check(PH1 not in ls and "ENOS-VAULT" not in ls, "aucune phrase ni clé dans localStorage / sessionStorage")

    # ---- mauvaise / bonne phrase
    pg.fill("#vlt-phrase", "mauvaise phrase!!"); pg.click("#vlt-unlock"); pg.wait_for_function("!document.querySelector('#vlt-err').hidden")
    check("incorrecte" in pg.inner_text("#vlt-err") and pg.locator("#vlt-add").count() == 0, "mauvaise phrase refusée")
    pg.fill("#vlt-phrase", PH1); pg.click("#vlt-unlock"); pg.wait_for_selector("#vlt-add")
    check(pg.locator(".vlt-item").count() == 3, "bonne phrase : coffre ouvert, 3 fichiers")

    # ---- round-trip octet pour octet (export)
    def export(name):
        pg.locator(".vlt-item", has_text=name).click(); pg.wait_for_selector(".vlt-view #vlt-exp")
        pg.wait_for_function("!document.querySelector('#vlt-vb').textContent.includes('Déchiffrement')", timeout=30000)
        with pg.expect_download() as dl: pg.click("#vlt-exp")
        data = open(dl.value.path(), "rb").read()
        return data
    for n in files:
        got = export(n)
        if n == "facture_secrete.png": check(pg.locator(".vlt-vb img").count() == 1, "aperçu image affiché")
        if n.endswith(".pdf"):
            try: pg.wait_for_selector(".vlt-page", timeout=15000)
            except Exception: pass
            check(pg.locator(".vlt-page").count() >= 1, "aperçu PDF rendu (pdf.js)")
        check(sha(got) == hashes[n] and len(got) == len(files[n]), f"round-trip SHA-256 identique : {n} ({len(got)} o)")
        pg.click("#vlt-close")
    check(pg.locator(".vlt-view").count() == 0, "visionneuse fermée")

    # ---- renommer
    pg.locator(".vlt-item", has_text="contrat").click(); pg.wait_for_selector("#vlt-rnb"); pg.click("#vlt-rnb"); pg.fill("#vlt-rn", "bail_2026.pdf"); pg.click("#vlt-rnok")
    pg.wait_for_selector(".vlt-item:has-text('bail_2026.pdf')")
    check(pg.locator(".vlt-item:has-text('contrat')").count() == 0, "renommé")

    # ---- changement de phrase
    pg.evaluate("document.querySelector('.vlt-set').open = true")
    pg.fill("#vlt-old", "pas la bonne"); pg.fill("#vlt-new", PH2); pg.fill("#vlt-new2", PH2); pg.click("#vlt-chg")
    pg.wait_for_function("!document.querySelector('#vlt-err').hidden")
    check("incorrecte" in pg.inner_text("#vlt-err"), "changement refusé si la phrase actuelle est fausse")
    pg.fill("#vlt-old", PH1); pg.fill("#vlt-new2", PH2 + "!"); pg.click("#vlt-chg")
    check("pas identiques" in pg.inner_text("#vlt-err"), "confirmation de la nouvelle phrase vérifiée")
    pg.fill("#vlt-new2", PH2); pg.click("#vlt-chg"); pg.wait_for_function("/Phrase changée/.test(document.querySelector('#vlt-status').textContent)", timeout=60000)
    pg.click("#vlt-lock"); pg.wait_for_selector("#vlt-unlock")
    pg.fill("#vlt-phrase", PH1); pg.click("#vlt-unlock"); pg.wait_for_function("!document.querySelector('#vlt-err').hidden")
    check("incorrecte" in pg.inner_text("#vlt-err"), "ancienne phrase refusée après changement")
    pg.fill("#vlt-phrase", PH2); pg.click("#vlt-unlock"); pg.wait_for_selector("#vlt-add")
    check(pg.locator(".vlt-item").count() == 3, "nouvelle phrase : 3 fichiers présents")
    got = export("gros_fichier"); check(sha(got) == hashes["gros_fichier.bin"], "après changement de phrase : gros fichier identique (SHA-256)"); pg.click("#vlt-close")
    d = pg.evaluate(SCAN, ["enos-vault", needles])
    check(d["hit"] == {} and d["stats"]["files"] == 3 and d["stats"]["chunks"] == 5, "après changement : toujours rien en clair, aucun reste de l'ancienne génération " + str(d))

    # ---- suppression (2 temps)
    pg.locator(".vlt-item", has_text="facture").click(); pg.wait_for_selector("#vlt-del"); pg.click("#vlt-del")
    check("CONFIRMER" in pg.inner_text("#vlt-del") and pg.locator(".vlt-item").count() == 3, "suppression : demande de confirmation")
    pg.click("#vlt-del"); pg.wait_for_function("document.querySelectorAll('.vlt-item').length === 2")
    d = pg.evaluate(SCAN, ["enos-vault", needles])
    check(d["stats"]["files"] == 2 and d["stats"]["chunks"] == 4, "suppression : fichier et blocs effacés d'IndexedDB")

    # ---- verrouillage automatique (inactivité) + arrière-plan
    pg.evaluate("ENOS.vaultLib.autoLockMs = 1200")
    pg.click("#tool-vault h3")
    pg.wait_for_selector("#vlt-unlock", timeout=6000)
    check(pg.locator(".vlt-item").count() == 0, "inactivité : coffre verrouillé (liste vidée)")
    pg.evaluate("ENOS.vaultLib.autoLockMs = null")
    pg.fill("#vlt-phrase", PH2); pg.click("#vlt-unlock"); pg.wait_for_selector("#vlt-add")
    pg.evaluate("""() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); }""")
    pg.wait_for_selector("#vlt-unlock", timeout=5000)
    check(pg.locator("#vlt-add").count() == 0, "application en arrière-plan : coffre verrouillé")
    pg.evaluate("() => { delete document.visibilityState; delete document.hidden; }")

    # ---- essais limités
    for i in range(3):
        pg.fill("#vlt-phrase", f"mauvaise phrase {i}"); pg.click("#vlt-unlock")
        pg.wait_for_function("document.querySelector('#vlt-unlock') && !document.querySelector('#vlt-unlock').disabled")
    pg.wait_for_function("/Trop d'essais/.test(document.querySelector('#vlt-err').textContent)")
    cfg = pg.evaluate("""async () => { const v = ENOS.vaultLib.createVault('enos-vault'); return await v.config(); }""")
    check(cfg["fails"] == 3 and cfg["lockUntil"] > time.time() * 1000, "3 échecs : délai d'attente stocké")
    pg.fill("#vlt-phrase", PH2); pg.click("#vlt-unlock")
    pg.wait_for_function("document.querySelector('#vlt-unlock') && !document.querySelector('#vlt-unlock').disabled")
    check(pg.locator("#vlt-add").count() == 0 and "Trop d'essais" in pg.inner_text("#vlt-err"), "pendant le délai, même la bonne phrase est refusée")
    pg.wait_for_timeout(5500)
    pg.fill("#vlt-phrase", PH2); pg.click("#vlt-unlock"); pg.wait_for_selector("#vlt-add", timeout=10000)
    check(pg.locator("#vlt-add").count() == 1, "après le délai, la bonne phrase ouvre le coffre")
    pg.reload(); pg.wait_for_selector("#tabbar"); open_tool(pg, "vault")
    check(pg.locator("#vlt-unlock").count() == 1 and pg.locator("#vlt-add").count() == 0, "rechargement de la page : coffre verrouillé (la clé n'est pas conservée)")

    # ---- panique : appui long + confirmation
    pg.locator("#vlt-panic0").scroll_into_view_if_needed(); pg.wait_for_timeout(300)
    box = pg.locator("#vlt-panic0").bounding_box()
    pg.mouse.move(box["x"] + 20, box["y"] + 10); pg.mouse.down(); pg.mouse.up(); pg.wait_for_timeout(200)
    check(pg.locator("#vlt-pyes").count() == 0, "appui court : pas d'effacement")
    pg.mouse.move(box["x"] + 20, box["y"] + 10); pg.mouse.down(); pg.wait_for_timeout(1100); pg.mouse.up()
    pg.wait_for_selector("#vlt-pyes")
    pg.click("#vlt-pno"); check(pg.locator("#vlt-pyes").count() == 0 and pg.locator("#vlt-unlock").count() == 1, "panique annulée : coffre intact")
    pg.mouse.move(box["x"] + 20, box["y"] + 10); pg.mouse.down(); pg.wait_for_timeout(1100); pg.mouse.up()
    pg.wait_for_selector("#vlt-pyes"); pg.click("#vlt-pyes"); pg.wait_for_selector("#vlt-create")
    d = pg.evaluate(SCAN, ["enos-vault", needles])
    check(d["stats"]["records"] == 0 and d["stats"]["bytes"] == 0, "panique : plus aucun enregistrement dans IndexedDB " + str(d["stats"]))
    pg.reload(); pg.wait_for_selector("#tabbar"); open_tool(pg, "vault")
    check(pg.locator("#vlt-create").count() == 1, "après panique : plus de coffre (écran de création)")
    check(not errs, "aucune erreur JavaScript " + str(errs[:3]))
    b.close()
print("ÉCHECS:", BAD or "aucun")
