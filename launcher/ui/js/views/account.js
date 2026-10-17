// Compte : profil, déconnexion, double authentification ; CEO : invitations, comptes, bannières, état de TERNA.
import { h, clear, toast, ROLE_LABEL, dateFr } from "../ui.js";
import * as api from "../api.js";

export function renderAccount(root, ctx) {
  clear(root);
  const u = api.session.user;
  const mine = h("div", { class: "card", id: "acc-me" }, h("h4", null, "MON COMPTE"),
    h("div", { class: "row sp" }, h("div", null, h("b", null, u.name || u.email), h("div", { style: { color: "var(--muted)", fontSize: "13px" } }, u.email)), h("span", { class: "badge " + u.role, id: "acc-role" }, ROLE_LABEL[u.role] || u.role)),
    h("div", { class: "row", style: { marginTop: "14px", flexWrap: "wrap" } },
      h("button", { class: "btn sm", type: "button", id: "acc-logout", onclick: () => ctx.logout() }, "SE DÉCONNECTER"),
      h("button", { class: "btn sm ghost", type: "button", id: "acc-pw", onclick: async () => {
        const o = prompt("Mot de passe actuel"); if (o === null) return; const n = prompt("Nouveau mot de passe (10 caractères minimum)"); if (n === null) return;
        try { await api.account.password(o, n); toast("Mot de passe modifié. Reconnexion…", "ok"); ctx.logout(); } catch (e) { toast(e.message, "err"); }
      } }, "CHANGER LE MOT DE PASSE")));
  root.append(h("section", { class: "view", id: "view-account" }, h("h2", { class: "t" }, "COMPTE"), h("p", { class: "sub" }, "Votre profil Dual Pulse détermine les versions auxquelles vous avez accès."), mine));
  const view0 = root.querySelector("#view-account");
  // --- mises à jour automatiques (tous les profils) : téléchargement silencieux, jamais de fermeture forcée
  const auto = h("input", { type: "checkbox", id: "set-auto", checked: !!ctx.settings.auto_update });
  auto.onchange = async () => { try { await ctx.setSettings({ auto_update: auto.checked }); toast(auto.checked ? "Mises à jour automatiques activées : le Launcher reste actif en arrière-plan." : "Mises à jour automatiques désactivées.", "ok"); } catch (e) { auto.checked = !auto.checked; toast(e.message || String(e), "err"); } };
  view0.append(h("div", { class: "card", id: "acc-settings", style: { marginTop: "16px" } }, h("h4", null, "MISES À JOUR"),
    h("label", { class: "toggle" }, auto, h("span", null, h("b", null, "Mises à jour automatiques"), h("small", null, "Le Launcher cherche les nouvelles versions en arrière-plan et les télécharge en silence, même pendant que tu utilises E.N.O.S. ou un jeu. Rien n'est jamais fermé de force : une bannière t'avertit dans l'application (« Redémarrer pour appliquer » / « Plus tard »), et les fichiers ne sont remplacés qu'une fois l'application fermée par toi."))),
    h("div", { class: "hint", style: { marginTop: "10px" } }, "Activé : fermer la fenêtre du Launcher le laisse actif dans la zone de notification (clic droit › Quitter pour l'arrêter).")));
  if (u.role !== "ceo") return;

  const view = root.querySelector("#view-account");
  const totp = h("div", { class: "card", id: "acc-totp", style: { marginTop: "16px" } }, h("h4", null, "DOUBLE AUTHENTIFICATION (TOTP)"),
    u.totp_enabled ? h("span", { class: "badge ok" }, "ACTIVÉE") : h("div", null, h("p", { class: "hint" }, "Recommandée pour le compte CEO : un code à 6 chiffres sera demandé à chaque connexion."),
      h("button", { class: "btn sm", type: "button", id: "totp-setup", onclick: async (e) => {
        try {
          const s = await api.account.totpSetup(); e.target.hidden = true;
          const code = h("input", { class: "in", id: "totp-code", placeholder: "Code à 6 chiffres", inputmode: "numeric", maxlength: "8", style: { maxWidth: "200px" } });
          totp.append(h("p", { class: "hint" }, "Ajoutez cette clé dans votre application d'authentification (Google Authenticator, Authy…), puis saisissez le code affiché :"), h("span", { class: "code", id: "totp-secret" }, s.secret),
            h("div", { class: "row", style: { marginTop: "10px" } }, code, h("button", { class: "btn sm pri", type: "button", id: "totp-enable", onclick: async () => { try { await api.account.totpEnable(code.value); toast("Double authentification activée.", "ok"); u.totp_enabled = true; renderAccount(root, ctx); } catch (x) { toast(x.message, "err"); } } }, "ACTIVER")));
        } catch (x) { toast(x.message, "err"); }
      } }, "CONFIGURER")));
  view.append(totp);

  // --- invitations
  const invBox = h("div", { class: "card", id: "acc-invites", style: { marginTop: "16px" } }, h("h4", null, "INVITATIONS"));
  const role = h("select", { class: "in", id: "inv-role" }, h("option", { value: "friends" }, "Friends"), h("option", { value: "dev" }, "Dev"));
  const days = h("input", { class: "in", id: "inv-days", type: "number", min: "1", max: "90", value: "7" });
  const note = h("input", { class: "in", id: "inv-note", placeholder: "Pour qui ? (facultatif)", maxlength: "80" });
  const shown = h("div", { id: "inv-shown" });
  const list = h("div", { id: "inv-list" });
  const loadInv = async () => {
    try {
      const { items } = await api.invites.list(); clear(list);
      if (!items.length) { list.append(h("div", { class: "empty" }, "Aucune invitation.")); return; }
      const now = Date.now() / 1000;
      list.append(h("table", { class: "tbl" }, h("thead", null, h("tr", null, ["PROFIL", "NOTE", "EXPIRE", "ÉTAT", ""].map((x) => h("th", null, x)))),
        h("tbody", null, items.map((i) => {
          const st = i.used_by ? ["UTILISÉE", "ok"] : i.revoked ? ["RÉVOQUÉE", ""] : i.expires_at < now ? ["EXPIRÉE", ""] : ["ACTIVE", "warn"];
          return h("tr", { dataset: { id: i.id } }, h("td", null, h("span", { class: "badge " + i.role }, ROLE_LABEL[i.role])), h("td", null, i.note || (i.used_email || "—")), h("td", null, dateFr(i.expires_at * 1000)),
            h("td", null, h("span", { class: "badge " + st[1] }, st[0])), h("td", null, st[0] === "ACTIVE" ? h("button", { class: "btn sm danger", type: "button", dataset: { revoke: i.id }, onclick: async () => { try { await api.invites.revoke(i.id); loadInv(); } catch (e) { toast(e.message, "err"); } } }, "RÉVOQUER") : null));
        }))));
    } catch (e) { clear(list).append(h("div", { class: "err" }, e.message)); }
  };
  invBox.append(h("div", { class: "form-row" }, h("div", { class: "fld" }, h("label", null, "PROFIL"), role), h("div", { class: "fld", style: { maxWidth: "110px" } }, h("label", null, "JOURS"), days), h("div", { class: "fld", style: { flex: "2" } }, h("label", null, "NOTE"), note),
    h("button", { class: "btn pri", type: "button", id: "inv-create", onclick: async () => {
      try {
        const r = await api.invites.create(role.value, parseInt(days.value, 10) || 7, note.value.trim());
        clear(shown).append(h("p", { class: "hint", style: { marginTop: "12px" } }, "Code d'invitation (affiché une seule fois — copiez-le maintenant) :"), h("span", { class: "code", id: "inv-code" }, r.code),
          h("button", { class: "btn sm", type: "button", style: { marginTop: "8px" }, onclick: () => { navigator.clipboard && navigator.clipboard.writeText(r.code).then(() => toast("Code copié.", "ok")); } }, "COPIER"));
        note.value = ""; loadInv();
      } catch (e) { toast(e.message, "err"); }
    } }, "GÉNÉRER")), shown, h("div", { style: { marginTop: "14px" } }, list));
  view.append(invBox); loadInv();

  // --- comptes
  const usersBox = h("div", { class: "card", id: "acc-users", style: { marginTop: "16px" } }, h("h4", null, "COMPTES"));
  const loadUsers = async () => {
    try {
      const { items } = await api.users.list();
      clear(usersBox).append(h("h4", null, "COMPTES"), h("table", { class: "tbl" }, h("thead", null, h("tr", null, ["E-MAIL", "PROFIL", "ÉTAT", ""].map((x) => h("th", null, x)))),
        h("tbody", null, items.map((x) => h("tr", null, h("td", null, x.email), h("td", null, h("span", { class: "badge " + x.role }, ROLE_LABEL[x.role])), h("td", null, h("span", { class: "badge " + (x.active ? "ok" : "") }, x.active ? "ACTIF" : "DÉSACTIVÉ")),
          h("td", null, x.role === "ceo" || x.id === u.id ? null : h("button", { class: "btn sm ghost", type: "button", onclick: async () => { try { await api.users.patch(x.id, { active: !x.active }); loadUsers(); } catch (e) { toast(e.message, "err"); } } }, x.active ? "DÉSACTIVER" : "RÉACTIVER")))))));
    } catch (e) { clear(usersBox).append(h("div", { class: "err" }, e.message)); }
  };
  view.append(usersBox); loadUsers();

  // --- statut de TERNA
  view.append(h("div", { class: "card", id: "acc-terna", style: { marginTop: "16px" } }, h("h4", null, "ÉTAT DE TERNA"),
    h("div", { class: "row" }, h("select", { class: "in", id: "terna-status", style: { maxWidth: "260px" } }, ["wishlist", "alpha", "released"].map((s) => h("option", { value: s }, { wishlist: "Wishlist (bientôt)", alpha: "Alpha (équipe)", released: "Sorti" }[s]))),
      h("button", { class: "btn sm", type: "button", id: "terna-status-go", onclick: async () => { try { await api.admin.ternaStatus(document.getElementById("terna-status").value); toast("État de TERNA mis à jour.", "ok"); } catch (e) { toast(e.message, "err"); } } }, "APPLIQUER"))));

  // --- bannières
  const newsBox = h("div", { class: "card", id: "acc-news", style: { marginTop: "16px" } }, h("h4", null, "BANNIÈRES"));
  const nt = h("input", { class: "in", id: "news-title", placeholder: "Titre", maxlength: "120" }), nb = h("input", { class: "in", id: "news-body", placeholder: "Texte court", maxlength: "600" });
  const nr = h("select", { class: "in", id: "news-role" }, [["public", "Tout le monde"], ["friends", "Friends et plus"], ["dev", "Dev et plus"], ["ceo", "CEO"]].map(([v, l]) => h("option", { value: v }, l)));
  const nlist = h("div", { id: "news-list", style: { marginTop: "12px" } });
  const loadNews = async () => {
    try {
      const { items } = await api.admin.news(); clear(nlist);
      if (!items.length) nlist.append(h("div", { class: "empty" }, "Aucune bannière (des bannières par défaut sont affichées)."));
      items.forEach((n) => nlist.append(h("div", { class: "row sp", style: { padding: "6px 0", borderBottom: "1px solid #161c27" }, dataset: { id: n.id } }, h("span", null, n.title, " ", h("span", { class: "badge" }, n.min_role.toUpperCase())),
        h("button", { class: "btn sm danger", type: "button", onclick: async () => { try { await api.admin.deleteNews(n.id); loadNews(); } catch (e) { toast(e.message, "err"); } } }, "SUPPRIMER"))));
    } catch (e) { toast(e.message, "err"); }
  };
  newsBox.append(h("div", { class: "form-row" }, h("div", { class: "fld", style: { flex: "2" } }, h("label", null, "TITRE"), nt), h("div", { class: "fld", style: { flex: "3" } }, h("label", null, "TEXTE"), nb), h("div", { class: "fld" }, h("label", null, "VISIBLE PAR"), nr),
    h("button", { class: "btn pri", type: "button", id: "news-add", onclick: async () => {
      try { await api.admin.createNews({ title: nt.value.trim(), body: nb.value.trim(), min_role: nr.value, kind: "announcement" }); nt.value = ""; nb.value = ""; loadNews(); ctx.refreshNews(); toast("Bannière publiée.", "ok"); } catch (e) { toast(e.message, "err"); }
    } }, "PUBLIER")), nlist);
  view.append(newsBox); loadNews();
}
