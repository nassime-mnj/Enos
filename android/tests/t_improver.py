"""Mobile Improver (écran) avec un FAUX pont natif qui reproduit Improver.java (états, événements, autorisation système simulée) :
préparation avec progression, photos prêtes -> Appliquer -> corbeille et rapport, restauration, réglages de qualité transmis au natif,
mode automatique réservé à ETO Pro (Free : feuille « Avec ETO Pro »), arrêt d'une préparation. Le moteur Java lui-même est vérifié par la compilation."""
from mobile_common import *

FAKE = r"""
(() => {
  const st = { pending: 0, pendingSaved: 0, trash: 0, trashBytes: 0, trashItems: [], history: [], last: {}, auto: false, quality: 82, maxEdge: 4080, minAge: 30, minMb: 1.5, canApply: true };
  const cfg = [], sched = [];
  const emit = (id, evt, p) => setTimeout(() => ENOS.native._cb(id, evt, typeof p === "string" ? p : JSON.stringify(p)), 0);
  let cancel = false;
  window.Enos = {
    galleryPermission: (id) => emit(id, "perm", { granted: true }),
    improverState: () => JSON.stringify(st),
    improverConfig: (j) => { cfg.push(JSON.parse(j)); Object.assign(st, JSON.parse(j)); },
    improverSchedule: (on) => { sched.push(on); st.auto = on; return true; },
    improverRun: (id) => { cancel = false; let i = 0; const T = 5; const tick = () => { if (cancel) { st.last = { t: Date.now() / 1000 | 0, scanned: i, staged: i, saved: i * 2e6, left: T - i }; return emit(id, "done", { staged: i }); }
        i++; st.pending = i; st.pendingSaved = i * 2.1e6; emit(id, "progress", { done: i, total: T, saved: i * 2.1e6 });
        if (i < T) setTimeout(tick, 120); else { st.last = { t: Date.now() / 1000 | 0, scanned: T, staged: T, saved: T * 2.1e6, left: 0 }; emit(id, "done", { staged: T }); } }; setTimeout(tick, 50); },
    improverCancel: () => { cancel = true; },
    improverApply: (id) => { const n = st.pending, saved = st.pendingSaved; st.trash += n; st.trashBytes += n * 3.5e6;
        for (let k = 0; k < n; k++) st.trashItems.unshift({ id: (100 + k) + "_1700000000", name: "IMG_" + (100 + k) + ".jpg", orig: 3.5e6, size: 1.4e6, t: Date.now() / 1000 | 0 });
        st.history = [{ m: new Date().toISOString().slice(0, 7), n, saved }]; st.pending = 0; st.pendingSaved = 0; emit(id, "applied", { ok: true, n, saved, skipped: 0 }); },
    improverRestore: (id, tid) => { st.trashItems = st.trashItems.filter((t) => t.id !== tid); st.trash--; st.trashBytes -= 3.5e6; emit(id, "restored", { ok: true }); },
    improverDiscard: () => { st.pending = 0; st.pendingSaved = 0; },
    improverEmptyTrash: () => { st.trash = 0; st.trashBytes = 0; st.trashItems = []; },
    pendingModule: () => "",
  };
  window.__imp = { st, cfg, sched };
})();
"""
errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(20000)
    pg.add_style_tag(content="#toasts{display:none!important}")
    open_tool(pg, "improver")
    check("Disponible sur Android" in pg.inner_text("#tool-improver"), "sans pont natif : message honnête (Android seulement)")
    pg.evaluate(FAKE); pg.evaluate("ENOS.native.isTestBuild = () => false; ENOS.plans.apply(true); ENOS.modules.open('improver')")
    pg.wait_for_selector('#tool-improver [data-im="run"]')
    # mode automatique en Free -> feuille ETO Pro
    pg.click('#tool-improver [data-im="auto"]'); pg.wait_for_selector("#sheet:not([hidden])")
    check("ETO Pro" in pg.inner_text("#sheet") and pg.evaluate("__imp.sched.length") == 0, "Free : l'automatique ouvre « Avec ETO Pro », rien n'est planifié")
    pg.evaluate("ENOS.ui.closeSheet(true)")
    # réglages
    pg.click('#tool-improver .im-seg[data-k="quality"] button[data-v="76"]'); pg.click('#tool-improver .im-seg[data-k="maxEdge"] button[data-v="3264"]')
    check(pg.evaluate("JSON.stringify(__imp.cfg)") == '[{"quality":76},{"maxEdge":3264}]', "réglages transmis au moteur natif (qualité Compacte, 8 Mpx)")
    # préparation
    pg.click('#tool-improver [data-im="run"]'); pg.wait_for_selector("#tool-improver .im-run")
    check(True, "préparation : barre de progression affichée")
    pg.wait_for_selector('#tool-improver [data-im="apply"]', timeout=10000)
    txt = pg.inner_text("#tool-improver")
    check("5 photos prêtes" in txt and "10 Mo" in txt, "5 photos prêtes, 10 Mo à récupérer")
    pg.wait_for_timeout(700); pg.screenshot(path=(os.environ.get("SHOTS") or "/tmp") + "/improver.png")
    pg.click('#tool-improver [data-im="apply"]'); pg.wait_for_function("!document.querySelector('#tool-improver [data-im=\"apply\"]')")
    txt = pg.inner_text("#tool-improver").lower()
    check("5 originaux" in txt and "restaurer" in txt, "appliquer : originaux dans la corbeille, restaurables")
    check("10 mo au total" in txt, "rapport : 10 Mo récupérés ce mois-ci")
    pg.click("#tool-improver [data-restore] >> nth=0"); pg.wait_for_function("document.querySelector('#tool-improver').innerText.toLowerCase().includes('4 originaux')")
    check(True, "restauration d'une photo")
    # ETO Pro : automatique
    pg.evaluate("ENOS.native.isTestBuild = () => true; ENOS.plans.simulate('eto_pro'); ENOS.modules.open('improver')")
    pg.click('#tool-improver [data-im="auto"]'); pg.wait_for_timeout(300)
    check(pg.evaluate("__imp.sched") == [True] and "on" in pg.get_attribute('#tool-improver [data-im="auto"]', "class"), "ETO Pro : automatique planifié (en charge)")
    # arrêt
    pg.evaluate("__imp.st.pending = 0"); pg.evaluate("ENOS.modules.open('improver')")
    pg.click('#tool-improver [data-im="run"]'); pg.wait_for_selector('#tool-improver [data-im="cancel"]'); pg.click('#tool-improver [data-im="cancel"]')
    pg.wait_for_selector('#tool-improver [data-im="run"]', timeout=5000)
    check("restante" in pg.inner_text("#tool-improver"), "« Arrêter » : la préparation s'interrompt et reprendra plus tard")
    pg.evaluate("ENOS.plans.simulate('')")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
