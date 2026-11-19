"use strict";
// ETO FLEET (ETO Ultra) : équipe, invitations, parc d'appareils (santé, alertes) et actions à distance de la liste fermée du serveur (fleet.py).
(() => {
  const E = window.ENOS, esc = E.esc;
  const go = (b) => (b >= 1073741824 ? (b / 1073741824).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " Go" : Math.round(b / 1048576) + " Mo");
  const ago = (t) => { const s = Date.now() / 1000 - t; return s < 90 ? "à l'instant" : s < 3600 ? `il y a ${Math.round(s / 60)} min` : s < 86400 ? `il y a ${Math.round(s / 3600)} h` : new Date(t * 1000).toLocaleDateString("fr-FR"); };
  const ROLE = { owner: "Propriétaire", admin: "Admin", member: "Membre" };
  const ST = { pending: "En attente", done: "Exécutée", failed: "Échec", expired: "Expirée" };
  async function copyText(t) { try { await navigator.clipboard.writeText(t); } catch (e) { /* appui long */ } E.ui.toast("Copié.", "ok"); }

  E.suite.register({
    id: "fleet", group: "sync", title: "ETO Fleet", sub: "Équipe et appareils",
    icon: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><circle cx="7.5" cy="10" r="1.2"/><circle cx="12" cy="10" r="1.2"/><circle cx="16.5" cy="10" r="1.2"/>',
    onShow() { if (this._load) this._load(); },
    build(el) {
      let st = null, invite = null;
      const hero = (sub) => `<div class="pl-hero fl-hero" style="--c:#a78bfa"><div class="pl-orbs"><i></i><i></i><i></i></div><small>ETO Ultra</small><h2>ETO <em>Fleet</em></h2><p>${sub}</p></div>`;
      const dev = (d, admin) => {
        const x = d.data || {}, tot = x.storage_total || 0, used = tot ? 1 - (x.storage_free || 0) / tot : 0;
        return `<div class="fl-dev${d.online ? " on" : ""}" data-dev="${esc(d.device_id)}" data-mail="${esc(d.email)}">
          <div class="fl-dh"><i class="fl-dot"></i><b>${esc(x.name || "Appareil")}</b><span>${esc(d.email)}</span></div>
          <div class="fl-stats"><span>${x.battery != null ? Math.round(x.battery * 100) + " %" + (x.charging ? " · en charge" : "") : "—"}</span><span>v${esc(x.app_version || "?")}</span><span>${ago(d.seen)}</span></div>
          ${tot ? `<div class="fl-sto"><i style="width:${(used * 100).toFixed(1)}%" class="${used > 0.9 ? "bad" : ""}"></i></div><small class="fl-stol">${go(x.storage_free)} libres sur ${go(tot)}</small>` : ""}
          ${d.alerts.length ? `<div class="fl-al">${d.alerts.map((a) => `<i class="fl-a ${a.kind}">${esc(a.text)}</i>`).join("")}</div>` : ""}
          ${admin ? `<button class="pl-mini" data-act>Actions</button>` : ""}</div>`;
      };
      const paint = () => {
        if (!(E.cloud && E.cloud.loggedIn())) { el.innerHTML = hero("Ton équipe et ses appareils.") + `<div class="card"><h3>Compte ETO requis</h3><button class="btn pri wide" data-fl="acc">Se connecter</button></div>`; return; }
        if (!st) { el.innerHTML = hero("Chargement…") + `<div class="card"><div class="gw-skel"></div></div>`; return; }
        if (st.error) { el.innerHTML = hero("Serveur indisponible") + `<div class="card"><p class="pl-err">${esc(st.error)}</p><button class="btn wide" data-fl="reload">Réessayer</button></div>`; return; }
        const t = st.team;
        if (!t) {
          el.innerHTML = hero("Ton équipe et ses appareils.") +
            (st.can_create ? `<div class="card"><h3>Créer une équipe</h3><div class="pl-form"><input id="fl-name" type="text" maxlength="60" placeholder="Nom de l'équipe"></div><button class="btn pri wide" data-fl="create" style="margin-top:10px">Créer</button></div>`
              : `<div class="card"><h3>Créer une équipe</h3><p class="muted">Inclus dans ETO Ultra.</p><button class="btn wide" data-fl="plans">Voir ETO Ultra</button></div>`) +
            `<div class="card"><h3>Rejoindre une équipe</h3><div class="pl-form"><input id="fl-code" class="pl-keyin" type="text" maxlength="40" autocapitalize="characters" spellcheck="false" placeholder="ETO-TEAM-XXXX-XXXX-XXXX"></div><p class="pl-err" id="fl-err"></p><button class="btn pri wide" data-fl="join">Rejoindre</button></div>`;
          return;
        }
        const admin = t.role !== "member", devs = st.devices || [], online = devs.filter((d) => d.online).length, alerts = devs.reduce((a, d) => a + d.alerts.length, 0);
        el.innerHTML = hero(`${esc(t.name)} · ${ROLE[t.role]}`) +
          (t.active ? "" : `<div class="card gw-warn"><p class="muted">Abonnement ETO Ultra inactif. Les membres sont repassés en ETO Free.</p></div>`) +
          (admin ? `<div class="fl-kpi"><div><b>${t.used}<small>/${t.seats}</small></b><span>Places</span></div><div><b>${online}<small>/${devs.length}</small></b><span>En ligne</span></div><div class="${alerts ? "warn" : ""}"><b>${alerts}</b><span>Alertes</span></div></div>` : "") +
          (admin ? `<div class="card"><h3>Inviter<span class="sp">${t.seats - t.used} place${t.seats - t.used > 1 ? "s" : ""} libre${t.seats - t.used > 1 ? "s" : ""}</span></h3>
              ${invite ? `<button class="pl-kcodebig" data-copy="${esc(invite.code)}" style="--i:0;--c:#a78bfa">${esc(invite.code)}<small>copier</small></button><p class="muted" style="font-size:12.5px">Valable 7 jours · ${invite.max_uses} utilisation${invite.max_uses > 1 ? "s" : ""}</p>` : ""}
              <div class="row"><button class="btn pri" data-fl="inv1">Une personne</button><button class="btn" data-fl="inv5">Cinq personnes</button></div></div>` : "") +
          `<div class="card"><h3>Appareils<span class="sp">${devs.length} / ${st.max_devices}</span></h3><div class="fl-devs">${devs.length ? devs.map((d) => dev(d, admin)).join("") : `<p class="muted">Aucun appareil.</p>`}</div></div>` +
          (admin ? `<div class="card"><h3>Membres</h3>${st.members.map((m) => `<div class="pl-krow"><span class="pl-kcode">${esc(m.name || m.email)}</span><span class="pl-kmeta">${esc(m.email)} · ${ROLE[m.role]}</span>
              ${m.role === "owner" ? "" : `<button class="pl-mini${t.role === "owner" ? "" : " bad"}" data-mem="${esc(m.email)}" data-role="${m.role}">${t.role === "owner" ? "Gérer" : "Retirer"}</button>`}</div>`).join("")}</div>` : "") +
          (admin && st.commands.length ? `<div class="card"><h3>Actions récentes</h3>${st.commands.slice(0, 8).map((c) => `<div class="pl-krow"><span class="pl-kcode">${esc(st.catalog[c.cmd] || c.cmd)}</span><span class="pl-kmeta">${esc(c.target)}${c.result ? " · " + esc(c.result) : ""}</span><i class="pl-kst ${c.status === "done" ? "ok" : c.status === "failed" ? "bad" : c.status === "expired" ? "warn" : ""}">${ST[c.status] || c.status}</i></div>`).join("")}</div>` : "") +
          (t.role === "owner" ? `<button class="btn wide fl-danger" data-fl="delete">Supprimer l'équipe</button>` : `<button class="btn wide fl-danger" data-fl="leave">Quitter l'équipe</button>`);
      };
      const load = async () => {
        if (!(E.cloud && E.cloud.loggedIn())) { st = null; return paint(); }
        try { await E.cloud.fleetBeat(); } catch (e) { /* l'état reste lisible */ }
        try { const r = await E.cloud.req("/eto/fleet"); st = r.status === 200 ? r.json : { error: r.json.detail || "Erreur " + r.status }; } catch (e) { st = { error: e.message }; }
        paint();
      };
      const post = async (path, body, okMsg) => {
        const r = await E.cloud.req("/eto/fleet" + path, { method: "POST", body: body || {} });
        if (r.status !== 200) { E.ui.toast(r.json.detail || "Échec.", "warn"); return null; }
        if (okMsg) E.ui.toast(okMsg, "ok");
        return r.json;
      };
      const actions = (d) => {
        const send = async (id, args) => { if (await post("/cmd", { email: d.dataset.mail, device_id: d.dataset.dev, cmd: id, args }, "Action envoyée.")) load(); };
        const opts = Object.entries(st.catalog).map(([id, n]) => ({ label: n, fn: () => {
          if (id !== "message") return send(id, {});
          setTimeout(async () => { const t = await E.ui.prompt("Message", "Texte affiché sur l'appareil", "", "ENVOYER"); if (t) send(id, { text: t }); }, 320);   // après la fermeture de cette feuille
        } }));
        E.ui.sheet({ title: d.querySelector(".fl-dh b").textContent, html: `<p class="muted">Exécutée à la prochaine connexion de l'appareil.</p>`, options: opts.concat([{ label: "Annuler" }]) });
      };
      el.addEventListener("click", async (e) => {
        const cp = e.target.closest("[data-copy]"); if (cp) return copyText(cp.dataset.copy);
        const ac = e.target.closest("[data-act]"); if (ac) return actions(ac.closest(".fl-dev"));
        const mm = e.target.closest("[data-mem]");
        if (mm) {
          const mail = mm.dataset.mem;
          if (st.team.role !== "owner") { if (await E.ui.confirm("Retirer ce membre ?", mail, "RETIRER", true) && await post("/member/remove", { email: mail }, "Membre retiré.")) load(); return; }
          return E.ui.sheet({ title: mail, options: [
            { label: mm.dataset.role === "admin" ? "Repasser membre" : "Nommer admin", fn: async () => { if (await post("/member/role", { email: mail, role: mm.dataset.role === "admin" ? "member" : "admin" }, "Rôle modifié.")) load(); } },
            { label: "Retirer de l'équipe", cls: "bad", fn: async () => { if (await post("/member/remove", { email: mail }, "Membre retiré.")) load(); } }, { label: "Annuler" }] });
        }
        const b = e.target.closest("[data-fl]"); if (!b) return;
        const a = b.dataset.fl;
        if (a === "acc") return E.plans && E.plans.accountSheet ? E.plans.accountSheet("login") : null;
        if (a === "plans") { E.ui.go("tools"); return E.modules.open("plans"); }
        if (a === "reload") return load();
        if (a === "create") { if (await post("/team", { name: (el.querySelector("#fl-name").value || "").trim() || "Mon équipe" }, "Équipe créée.")) load(); return; }
        if (a === "join") {
          const r = await E.cloud.req("/eto/fleet/join", { method: "POST", body: { code: el.querySelector("#fl-code").value } });
          if (r.status !== 200) { el.querySelector("#fl-err").textContent = r.json.detail || "Échec."; return; }
          E.ui.toast(`Bienvenue dans ${r.json.team}.`, "ok"); if (E.plans) await E.plans.refreshLicense(); return load();
        }
        if (a === "inv1" || a === "inv5") { const j = await post("/invite", { max_uses: a === "inv1" ? 1 : 5, days: 7 }); if (j) { invite = j; paint(); } return; }
        if (a === "leave") { if (await E.ui.confirm("Quitter l'équipe ?", "Ton offre repassera à ton abonnement personnel.", "QUITTER", true) && await post("/leave", {}, "Équipe quittée.")) { if (E.plans) await E.plans.refreshLicense(); load(); } return; }
        if (a === "delete") {
          if (!(await E.ui.confirm("Supprimer l'équipe ?", "Tous les membres perdront leur accès ETO Ultra.", "SUPPRIMER", true))) return;
          const r = await E.cloud.req("/eto/fleet/team", { method: "DELETE" }); E.ui.toast(r.status === 200 ? "Équipe supprimée." : r.json.detail || "Échec.", r.status === 200 ? "ok" : "warn"); invite = null; return load();
        }
      });
      this._load = load; paint(); load();
    },
  });
})();
