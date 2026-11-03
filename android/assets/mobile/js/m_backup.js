"use strict";
// MODULE « Sauvegarde » : état de la sauvegarde automatique, sauvegarder / exporter maintenant, restaurer (fichier, sauvegardes du téléphone, cloud). Logique : js/backup.js.
(() => {
  const E = window.ENOS, esc = E.esc;
  const fmt = (t) => (t ? new Date(t).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "jamais");
  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " Mo" : Math.max(1, Math.round(n / 1024)) + " Ko");

  E.suite.register({
    id: "backup", group: "sync", title: "Sauvegarde", sub: "Parties, entraînements, préférences",
    icon: '<path d="M12 3v12m0 0l-4-4m4 4l4-4M5 19h14"/>',
    onShow() { if (E.backup && E.backup._paint) E.backup._paint(); },
    build(el, A) {
      const $ = (s) => el.querySelector(s), B = E.backup, N = E.native;
      el.innerHTML = `
        <div class="card"><h3>💾 Sauvegarde automatique</h3>
          <p class="muted">Tes parties, entraînements et préférences sont sauvegardés <b>tout seuls</b> (toutes les 2 min si quelque chose a changé, et quand tu quittes l'appli). Quand tu désinstalles puis réinstalles l'appli, tu les retrouves.</p>
          <div id="bk-st" class="bk-st"></div>
          <label class="bk-opt"><input type="checkbox" id="bk-local"> <span><b>Sur le téléphone</b> · Téléchargements/ENOS (reste après la désinstallation, 6 jours gardés)</span></label>
          <label class="bk-opt"><input type="checkbox" id="bk-cloud"> <span><b>Cloud</b> · compte Dual Pulse (récupérable sur n'importe quel téléphone connecté)</span></label>
          <div class="row"><button class="btn pri" id="bk-now">💾 SAUVEGARDER MAINTENANT</button><button class="btn" id="bk-exp">📤 EXPORTER UN FICHIER</button></div></div>
        <div class="card"><h3>♻ Restaurer</h3>
          <p class="muted">Par défaut on <b>fusionne</b> : rien de ce que tu as déjà n'est perdu (parties ajoutées, compteurs les plus hauts gardés). Tu peux aussi tout remplacer.</p>
          <div class="row"><button class="btn" id="bk-file">📂 DEPUIS UN FICHIER</button><button class="btn" id="bk-phone">🕘 SAUVEGARDES DU TÉLÉPHONE</button></div>
          <div class="row"><button class="btn" id="bk-cl">☁ DEPUIS LE CLOUD</button></div>
          <div id="bk-list"></div></div>
        <div class="card"><h3>Contenu actuel</h3><div id="bk-now-c" class="muted"></div>
          <p class="muted" style="margin-top:8px;font-size:12.5px">Jamais sauvegardés : clés d'API, jetons, mots de passe (ils restent dans le coffre Android, à ressaisir après une réinstallation).</p></div>`;

      function paint() {
        const m = B.meta() || {}, c = B.cfg();
        $("#bk-local").checked = c.local; $("#bk-cloud").checked = c.cloud;
        $("#bk-local").disabled = !N.backup.can(); $("#bk-cloud").disabled = !B.cloudOk();
        $("#bk-st").innerHTML = `<div class="bk-row"><span>📱 Téléphone</span><b class="${m.local ? "ok" : ""}">${N.backup.can() ? fmt(m.local) : "indisponible ici"}</b></div>
          <div class="bk-row"><span>☁ Cloud</span><b class="${m.cloud ? "ok" : ""}">${B.cloudOk() ? fmt(m.cloud) : "connecte-toi au cloud (Réglages)"}</b></div>${m.err ? `<div class="bk-err">⚠ ${esc(m.err)}</div>` : ""}`;
        const s = B.summary(B.snapshot());
        $("#bk-now-c").innerHTML = `<b>${s.games}</b> partie(s) enregistrée(s) · <b>${s.prefs}</b> réglage(s) · <b>${s.training}</b> donnée(s) d'entraînement / apprentissage · ${s.keys} éléments, ${kb(s.bytes)}.`;
      }
      B._paint = paint; E.on && E.on("backup", paint);
      $("#bk-local").onchange = (e) => E.settings.set("backup.local", e.target.checked);
      $("#bk-cloud").onchange = (e) => E.settings.set("backup.cloud", e.target.checked);

      $("#bk-now").onclick = async () => {
        const b = $("#bk-now"); b.disabled = true; b.textContent = "Sauvegarde…";
        const r = await B.save(true); b.disabled = false; b.textContent = "💾 SAUVEGARDER MAINTENANT"; paint();
        if (!r) return A.toast("Une sauvegarde est déjà en cours.", "warn");
        A.toast(r.local || r.cloud ? "Sauvegardé" + (r.local ? " · téléphone" : "") + (r.cloud ? " · cloud" : "") + " (" + (r.games || 0) + " parties)" : "Aucune destination disponible : exporte un fichier ou connecte-toi au cloud.", r.local || r.cloud ? "ok" : "warn");
      };
      $("#bk-exp").onclick = async () => {
        const snap = B.snapshot(), name = "enos-sauvegarde-" + new Date().toISOString().slice(0, 10) + ".json";
        await A.save(name, "application/json", new TextEncoder().encode(JSON.stringify(snap)), "downloads");
      };

      // ---- restauration : aperçu puis choix fusion / remplacement
      function offer(snap, from) {
        if (!B.valid(snap)) return A.toast("Ce fichier n'est pas une sauvegarde E.N.O.S.", "err");
        const s = B.summary(snap), cur = B.summary(B.snapshot());
        E.ui.sheet({ title: "Restaurer ?", html: `<p class="muted"><b>${esc(from)}</b> · ${fmt(snap.t)}<br>Sauvegarde : <b>${s.games}</b> partie(s), ${s.prefs} réglage(s), ${s.training} donnée(s) d'entraînement.<br>Actuellement : ${cur.games} partie(s), ${cur.prefs} réglage(s).</p><p class="muted">Fusionner garde tout (recommandé). Remplacer écrase les données actuelles.</p>`,
          options: [{ label: "FUSIONNER (recommandé)", cls: "pri", fn: () => done(snap, "merge") }, { label: "REMPLACER TOUT", fn: () => done(snap, "replace") }, { label: "ANNULER" }] });
      }
      function done(snap, mode) {
        try { const r = B.restore(snap, mode); A.toast(`Restauré : ${r.added} ajouté(s), ${r.merged} fusionné(s). Rechargement…`, "ok"); setTimeout(() => location.reload(), 900); }
        catch (e) { A.toast(e.message, "err"); }
      }
      $("#bk-file").onclick = async () => {
        const f = (await A.pick({ accept: ".json,application/json" }))[0]; if (!f) return;
        try { offer(JSON.parse(await A.readText(f)), f.name); } catch (e) { A.toast("Fichier illisible.", "err"); }
      };
      $("#bk-phone").onclick = () => {
        const list = N.backup.list(), box = $("#bk-list");
        if (!list.length) { box.innerHTML = '<p class="muted">Aucune sauvegarde visible par cette installation. Après une réinstallation, Android peut la cacher : utilise « Depuis un fichier » et choisis-la dans Téléchargements/ENOS.</p>'; return; }
        box.innerHTML = list.map((x) => `<button class="btn bk-item" data-id="${x.id}">${esc(x.name.replace(/^enos-sauvegarde-|\.json$/g, ""))} · ${kb(x.size)}</button>`).join("");
        box.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => { try { offer(JSON.parse(N.backup.read(b.dataset.id)), b.textContent); } catch (e) { A.toast("Sauvegarde illisible.", "err"); } }));
      };
      $("#bk-cl").onclick = async () => {
        if (!B.cloudOk()) return A.toast("Connecte-toi d'abord au cloud (Modules › Cloud).", "warn");
        const b = $("#bk-cl"); b.disabled = true; b.textContent = "Réveil du serveur…";
        try { if (E.cloud.wake) await E.cloud.wake(); offer(await B.cloudGet(), "Cloud"); }
        catch (e) { A.toast(e.message, "err"); }
        b.disabled = false; b.textContent = "☁ DEPUIS LE CLOUD";
      };
      paint();
    },
  });
})();
