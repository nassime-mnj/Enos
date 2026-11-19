"use strict";
// MOBILE IMPROVER : récupérer de l'espace en allégeant les grosses photos JPEG, sans perte visible (moteur natif : Improver.java).
//   Préparer (à la main pour tous, automatiquement téléphone en charge avec ETO Pro) -> Appliquer (autorisation d'Android) -> corbeille 30 jours -> rapport.
(() => {
  const E = window.ENOS, esc = E.esc, N = E.native;
  const mo = (b) => (b >= 1073741824 ? (b / 1073741824).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " Go" : Math.max(0, Math.round(b / 1048576)).toLocaleString("fr-FR") + " Mo");
  const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const QUAL = [[88, "Haute", "gain modéré"], [82, "Équilibrée", "recommandée"], [76, "Compacte", "gain maximal"]];
  const EDGE = [[8192, "Garder", "résolution d'origine"], [4080, "12 Mpx", "recommandé"], [3264, "8 Mpx", "plus léger"]];
  const AGE = [[7, "7 jours"], [30, "30 jours"], [90, "3 mois"]];

  E.suite.register({
    id: "improver", group: "scan", title: "Mobile Improver", sub: "Libère de l'espace",
    icon: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    onShow() { if (this._paint) this._paint(); },
    build(el) {
      let run = null, msg = "";                       // run : {done,total,saved} pendant une préparation
      const P = E.plans, autoOk = () => !P || P.can("improver_auto");
      const seg = (name, list, cur) => `<div class="im-seg" data-k="${name}">${list.map(([v, n, s]) => `<button data-v="${v}" class="${+cur === v ? "on" : ""}">${n}${s ? `<small>${s}</small>` : ""}</button>`).join("")}</div>`;
      const paint = () => {
        if (!N.improver.available()) {
          el.innerHTML = `<div class="pl-hero im-hero" style="--c:#3b82f6"><div class="pl-orbs"><i></i><i></i><i></i></div><small>ETO Pro</small><h2>Mobile <em>Improver</em></h2><p>Disponible sur Android.</p></div>`;
          return;
        }
        const s = N.improver.state(), hist = s.history || [], total = hist.reduce((a, h) => a + (+h.saved || 0), 0), maxH = Math.max(1, ...hist.map((h) => +h.saved || 0));
        const last = s.last || {};
        el.innerHTML = `<div class="pl-hero im-hero" style="--c:#3b82f6"><div class="pl-orbs"><i></i><i></i><i></i></div><small>Mobile Improver</small>
            <h2>${s.pending ? `<em>${mo(s.pendingSaved)}</em> à récupérer` : total ? `<em>${mo(total)}</em> récupérés` : `Un téléphone <em>plus léger</em>`}</h2>
            <p>Photos allégées, qualité préservée. Date, lieu et orientation conservés.</p></div>
          ${run ? `<div class="card im-run"><h3>Analyse…<span class="sp" id="im-cnt">${run.done} / ${run.total || "?"}</span></h3><div class="gw-bar"><i id="im-bar" style="width:${run.total ? (run.done / run.total) * 100 : 3}%"></i></div>
              <p class="muted"><b id="im-sv">${mo(run.saved)}</b> à récupérer</p><button class="btn wide" data-im="cancel">Arrêter</button></div>` : ""}
          ${!run && s.pending ? `<div class="card im-ready"><h3>${s.pending} photo${s.pending > 1 ? "s" : ""} prête${s.pending > 1 ? "s" : ""}<span class="sp">${mo(s.pendingSaved)}</span></h3>
              <p class="muted">Originaux conservés 30 jours.</p>
              <div class="row"><button class="btn pri" data-im="apply"${s.canApply ? "" : " disabled"}>Appliquer</button><button class="btn" data-im="discard">Oublier</button></div>
              ${s.canApply ? "" : `<p class="pl-err">Nécessite Android 11 ou plus.</p>`}</div>` : ""}
          ${!run ? `<div class="card"><h3>Analyse</h3><p class="muted">${last.t ? `Dernière analyse : ${new Date(last.t * 1000).toLocaleDateString("fr-FR")} · ${last.staged} prête${last.staged > 1 ? "s" : ""}${last.left ? ` · ${last.left} restante${last.left > 1 ? "s" : ""}` : ""}` : "Photos de plus de " + String(s.minMb).replace(".", ",") + " Mo et de plus de " + s.minAge + " jours."}</p>
              <button class="btn pri wide" data-im="run">Analyser maintenant</button>${msg ? `<p class="im-msg">${esc(msg)}</p>` : ""}</div>` : ""}
          <div class="card im-auto"><div class="im-sw"><div><h3>Automatique</h3><p class="muted">Pendant la charge, une fois par jour.</p></div>
              <button class="im-tg${s.auto ? " on" : ""}" data-im="auto" role="switch" aria-checked="${!!s.auto}"><i></i></button></div>${autoOk() ? "" : `<p class="im-lock">Avec ETO Pro · ${P ? "2,99 €/mois" : ""}</p>`}</div>
          <div class="card"><h3>Qualité</h3>${seg("quality", QUAL, s.quality)}<h4 class="pl-h4">Résolution maximale</h4>${seg("maxEdge", EDGE, s.maxEdge)}<h4 class="pl-h4">Ne pas toucher aux photos de moins de</h4>${seg("minAge", AGE, s.minAge)}</div>
          <div class="card im-trash"><h3>Corbeille<span class="sp">${s.trash || 0} ${s.trash > 1 ? "originaux" : "original"} · ${mo(s.trashBytes || 0)}</span></h3>
            <p class="muted">Suppression automatique après 30 jours.</p>
            ${(s.trashItems || []).slice(0, 8).map((t) => `<div class="pl-krow"><span class="pl-kcode">${esc(t.name)}</span><span class="pl-kmeta">${mo(t.orig)} → ${mo(t.size)} · ${new Date(t.t * 1000).toLocaleDateString("fr-FR")}</span><button class="pl-mini" data-restore="${esc(t.id)}">Restaurer</button></div>`).join("")}
            ${s.trash ? `<button class="btn wide" data-im="empty" style="margin-top:10px">Vider la corbeille (${mo(s.trashBytes)})</button>` : ""}</div>
          <div class="card im-rep"><h3>Rapport<span class="sp">${mo(total)} au total</span></h3>${hist.length ? `<div class="im-bars">${hist.slice(-6).map((h) => { const [y, m] = String(h.m).split("-"); return `<div><i style="height:${Math.max(6, ((+h.saved || 0) / maxH) * 100)}%"></i><b>${mo(+h.saved || 0)}</b><small>${MONTHS[(+m || 1) - 1]} ${String(y).slice(2)}</small></div>`; }).join("")}</div>` : `<p class="muted">Aucune donnée.</p>`}</div>
          <p class="pl-legal">Traitement sur l'appareil. Photos JPEG. Vidéos : bientôt.</p>`;
      };
      el.addEventListener("click", async (e) => {
        const sg = e.target.closest(".im-seg button");
        if (sg) { const k = sg.parentNode.dataset.k; N.improver.config({ [k]: +sg.dataset.v }); return paint(); }
        const rs = e.target.closest("[data-restore]");
        if (rs) { const r = await N.improver.restore(rs.dataset.restore); E.ui.toast(r.ok ? "Photo restaurée." : r.error === "cancelled" ? "Annulé." : r.error || "Échec.", r.ok ? "ok" : "warn"); return paint(); }
        const b = e.target.closest("[data-im]"); if (!b) return;
        const a = b.dataset.im;
        if (a === "run") {
          const ok = await new Promise((res) => { const g = window.Enos; if (!g || !g.galleryPermission) return res(true); N.stream((id) => g.galleryPermission(id), (evt, p) => { if (evt === "perm") { res(!!(p && p.granted)); return true; } return false; }); });
          if (!ok) { msg = "Accès aux photos refusé."; return paint(); }
          run = { done: 0, total: 0, saved: 0 }; msg = ""; paint();
          N.improver.run((evt, p) => {
            if (evt === "progress") {                                    // mise à jour sur place : le bouton « Arrêter » reste sous le doigt
              run = p; const c = el.querySelector("#im-cnt"), br = el.querySelector("#im-bar"), sv = el.querySelector("#im-sv");
              if (c && br && sv) { c.textContent = `${p.done} / ${p.total || "?"}`; br.style.width = (p.total ? (p.done / p.total) * 100 : 3) + "%"; sv.textContent = mo(p.saved); } else paint();
              return false;
            }
            run = null; msg = evt === "done" ? (p.staged ? `${p.staged} photo${p.staged > 1 ? "s" : ""} prête${p.staged > 1 ? "s" : ""}.` : "Aucune photo à alléger.") : String(p || "Erreur."); paint(); return true;
          });
          return;
        }
        if (a === "cancel") return N.improver.cancel();
        if (a === "apply") {
          const r = await N.improver.apply();
          if (r.ok) { E.ui.toast(`${mo(r.saved)} récupérés · ${r.n} photo${r.n > 1 ? "s" : ""}`, "ok"); E.vibrate && E.vibrate(16); }
          else E.ui.toast(r.error === "cancelled" ? "Annulé." : r.error || "Échec.", "warn");
          return paint();
        }
        if (a === "discard") { N.improver.discard(); return paint(); }
        if (a === "empty") { if (await E.ui.confirm("Vider la corbeille ?", "Les originaux seront supprimés définitivement.", "VIDER", true)) { N.improver.emptyTrash(); E.ui.toast("Corbeille vidée.", "ok"); } return paint(); }
        if (a === "auto") {
          const on = !N.improver.state().auto;
          if (on && !autoOk()) return P.gate("improver_auto_gate");
          N.improver.schedule(on); E.ui.toast(on ? "Automatique activé." : "Automatique désactivé.", "ok"); return paint();
        }
      });
      this._paint = paint; paint();
    },
  });
})();
