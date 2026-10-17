// Compte : profil, déconnexion, double authentification ; CEO : invitations, comptes, bannières, état de TERNA.
import { h, clear, toast, ROLE_LABEL, formatDate } from "../ui.js";
import * as api from "../api.js";

export function renderAccount(root, ctx) {
  clear(root);
  const u = api.session.user;
  const mine = h("div", { class: "card", id: "acc-me" }, h("h4", null, "MY ACCOUNT"),
    h("div", { class: "row sp" }, h("div", null, h("b", null, u.name || u.email), h("div", { style: { color: "var(--muted)", fontSize: "13px" } }, u.email)), h("span", { class: "badge " + u.role, id: "acc-role" }, ROLE_LABEL[u.role] || u.role)),
    h("div", { class: "row", style: { marginTop: "14px", flexWrap: "wrap" } },
      h("button", { class: "btn sm", type: "button", id: "acc-logout", onclick: () => ctx.logout() }, "SIGN OUT"),
      h("button", { class: "btn sm ghost", type: "button", id: "acc-pw", onclick: async () => {
        const o = prompt("Current password"); if (o === null) return; const n = prompt("New password (at least 10 characters)"); if (n === null) return;
        try { await api.account.password(o, n); toast("Password changed. Signing you out…", "ok"); ctx.logout(); } catch (e) { toast(e.message, "err"); }
      } }, "CHANGE PASSWORD")));
  root.append(h("section", { class: "view", id: "view-account" }, h("h2", { class: "t" }, "ACCOUNT"), h("p", { class: "sub" }, "Your Dual Pulse profile determines which versions you can access."), mine));
  const view0 = root.querySelector("#view-account");
  // --- mises à jour automatiques (tous les profils) : téléchargement silencieux, jamais de fermeture forcée
  const auto = h("input", { type: "checkbox", id: "set-auto", checked: !!ctx.settings.auto_update });
  auto.onchange = async () => { try { await ctx.setSettings({ auto_update: auto.checked }); toast(auto.checked ? "Automatic updates enabled: the Launcher stays active in the background." : "Automatic updates disabled.", "ok"); } catch (e) { auto.checked = !auto.checked; toast(e.message || String(e), "err"); } };
  view0.append(h("div", { class: "card", id: "acc-settings", style: { marginTop: "16px" } }, h("h4", null, "UPDATES"),
    h("label", { class: "toggle" }, auto, h("span", null, h("b", null, "Automatic updates"), h("small", null, "The Launcher checks for new versions in the background and downloads them silently, even while you are using E.N.O.S. or a game. Nothing is ever closed by force: a banner in the application lets you know (\"Restart to apply\" / \"Later\"), and files are only replaced once you have closed the application yourself."))),
    h("div", { class: "hint", style: { marginTop: "10px" } }, "When enabled, closing the Launcher window keeps it running in the notification area (right-click › Quit to stop it).")));
  if (u.role !== "ceo") return;

  const view = root.querySelector("#view-account");
  const totp = h("div", { class: "card", id: "acc-totp", style: { marginTop: "16px" } }, h("h4", null, "TWO-FACTOR AUTHENTICATION (TOTP)"),
    u.totp_enabled ? h("span", { class: "badge ok" }, "ENABLED") : h("div", null, h("p", { class: "hint" }, "Recommended for the CEO account: a 6-digit code will be requested at every sign-in."),
      h("button", { class: "btn sm", type: "button", id: "totp-setup", onclick: async (e) => {
        try {
          const s = await api.account.totpSetup(); e.target.hidden = true;
          const code = h("input", { class: "in", id: "totp-code", placeholder: "6-digit code", inputmode: "numeric", maxlength: "8", style: { maxWidth: "200px" } });
          totp.append(h("p", { class: "hint" }, "Add this key to your authenticator app (Google Authenticator, Authy…), then enter the code it shows:"), h("span", { class: "code", id: "totp-secret" }, s.secret),
            h("div", { class: "row", style: { marginTop: "10px" } }, code, h("button", { class: "btn sm pri", type: "button", id: "totp-enable", onclick: async () => { try { await api.account.totpEnable(code.value); toast("Two-factor authentication enabled.", "ok"); u.totp_enabled = true; renderAccount(root, ctx); } catch (x) { toast(x.message, "err"); } } }, "ENABLE")));
        } catch (x) { toast(x.message, "err"); }
      } }, "SET UP")));
  view.append(totp);

  // --- invitations
  const invBox = h("div", { class: "card", id: "acc-invites", style: { marginTop: "16px" } }, h("h4", null, "INVITATIONS"));
  const role = h("select", { class: "in", id: "inv-role" }, h("option", { value: "friends" }, "Friends"), h("option", { value: "dev" }, "Dev"));
  const days = h("input", { class: "in", id: "inv-days", type: "number", min: "1", max: "90", value: "7" });
  const note = h("input", { class: "in", id: "inv-note", placeholder: "Who is it for? (optional)", maxlength: "80" });
  const code = h("input", { class: "in", id: "inv-code-in", placeholder: "Custom code (optional), e.g. STUDIO-VIP-01", maxlength: "40", autocomplete: "off", spellcheck: "false" });
  const shown = h("div", { id: "inv-shown" });
  const list = h("div", { id: "inv-list" });
  const loadInv = async () => {
    try {
      const { items } = await api.invites.list(); clear(list);
      if (!items.length) { list.append(h("div", { class: "empty" }, "No invitations.")); return; }
      const now = Date.now() / 1000;
      list.append(h("table", { class: "tbl" }, h("thead", null, h("tr", null, ["PROFILE", "NOTE", "EXPIRES", "STATUS", ""].map((x) => h("th", null, x)))),
        h("tbody", null, items.map((i) => {
          const st = i.used_by ? ["USED", "ok"] : i.revoked ? ["REVOKED", ""] : i.expires_at < now ? ["EXPIRED", ""] : ["ACTIVE", "warn"];
          return h("tr", { dataset: { id: i.id } }, h("td", null, h("span", { class: "badge " + i.role }, ROLE_LABEL[i.role])), h("td", null, i.note || (i.used_email || "—")), h("td", null, formatDate(i.expires_at * 1000)),
            h("td", null, h("span", { class: "badge " + st[1] }, st[0])), h("td", null, st[0] === "ACTIVE" ? h("button", { class: "btn sm danger", type: "button", dataset: { revoke: i.id }, onclick: async () => { try { await api.invites.revoke(i.id); loadInv(); } catch (e) { toast(e.message, "err"); } } }, "REVOKE") : null));
        }))));
    } catch (e) { clear(list).append(h("div", { class: "err" }, e.message)); }
  };
  invBox.append(h("div", { class: "form-row" }, h("div", { class: "fld" }, h("label", null, "PROFILE"), role), h("div", { class: "fld", style: { maxWidth: "110px" } }, h("label", null, "DAYS"), days), h("div", { class: "fld", style: { flex: "2" } }, h("label", null, "NOTE"), note),
    h("div", { class: "fld", style: { flex: "2" } }, h("label", null, "CUSTOM CODE"), code),
    h("button", { class: "btn pri", type: "button", id: "inv-create", onclick: async () => {
      try {
        const r = await api.invites.create(role.value, parseInt(days.value, 10) || 7, note.value.trim(), code.value.trim());
        clear(shown).append(h("p", { class: "hint", style: { marginTop: "12px" } }, (r.custom ? "Custom code created (single use, case-insensitive):" : "Invitation code (shown only once — copy it now):")), h("span", { class: "code", id: "inv-code" }, r.code),
          h("button", { class: "btn sm", type: "button", style: { marginTop: "8px" }, onclick: () => { navigator.clipboard && navigator.clipboard.writeText(r.code).then(() => toast("Code copied.", "ok")); } }, "COPY"));
        note.value = ""; code.value = ""; loadInv();
      } catch (e) { toast(e.message, "err"); }
    } }, "GENERATE")), shown, h("div", { style: { marginTop: "14px" } }, list));
  view.append(invBox); loadInv();

  // --- comptes
  const usersBox = h("div", { class: "card", id: "acc-users", style: { marginTop: "16px" } }, h("h4", null, "ACCOUNTS"));
  const loadUsers = async () => {
    try {
      const { items } = await api.users.list();
      clear(usersBox).append(h("h4", null, "ACCOUNTS"), h("table", { class: "tbl" }, h("thead", null, h("tr", null, ["EMAIL", "PROFILE", "STATUS", ""].map((x) => h("th", null, x)))),
        h("tbody", null, items.map((x) => h("tr", null, h("td", null, x.email), h("td", null, h("span", { class: "badge " + x.role }, ROLE_LABEL[x.role])), h("td", null, h("span", { class: "badge " + (x.active ? "ok" : "") }, x.active ? "ACTIVE" : "DISABLED")),
          h("td", null, x.role === "ceo" || x.id === u.id ? null : h("button", { class: "btn sm ghost", type: "button", onclick: async () => { try { await api.users.patch(x.id, { active: !x.active }); loadUsers(); } catch (e) { toast(e.message, "err"); } } }, x.active ? "DISABLE" : "RE-ENABLE")))))));
    } catch (e) { clear(usersBox).append(h("div", { class: "err" }, e.message)); }
  };
  view.append(usersBox); loadUsers();

  // --- statut de TERNA
  view.append(h("div", { class: "card", id: "acc-terna", style: { marginTop: "16px" } }, h("h4", null, "TERNA STATUS"),
    h("div", { class: "row" }, h("select", { class: "in", id: "terna-status", style: { maxWidth: "260px" } }, ["wishlist", "alpha", "released"].map((s) => h("option", { value: s }, { wishlist: "Wishlist (coming soon)", alpha: "Alpha (team)", released: "Released" }[s]))),
      h("button", { class: "btn sm", type: "button", id: "terna-status-go", onclick: async () => { try { await api.admin.ternaStatus(document.getElementById("terna-status").value); toast("TERNA status updated.", "ok"); } catch (e) { toast(e.message, "err"); } } }, "APPLY"))));

  // --- bannières
  const newsBox = h("div", { class: "card", id: "acc-news", style: { marginTop: "16px" } }, h("h4", null, "BANNERS"));
  const nt = h("input", { class: "in", id: "news-title", placeholder: "Title", maxlength: "120" }), nb = h("input", { class: "in", id: "news-body", placeholder: "Short text", maxlength: "600" });
  const nr = h("select", { class: "in", id: "news-role" }, [["public", "Everyone"], ["friends", "Friends and above"], ["dev", "Dev and above"], ["ceo", "CEO"]].map(([v, l]) => h("option", { value: v }, l)));
  const nlist = h("div", { id: "news-list", style: { marginTop: "12px" } });
  const loadNews = async () => {
    try {
      const { items } = await api.admin.news(); clear(nlist);
      if (!items.length) nlist.append(h("div", { class: "empty" }, "No banners (default banners are shown)."));
      items.forEach((n) => nlist.append(h("div", { class: "row sp", style: { padding: "6px 0", borderBottom: "1px solid #161c27" }, dataset: { id: n.id } }, h("span", null, n.title, " ", h("span", { class: "badge" }, n.min_role.toUpperCase())),
        h("button", { class: "btn sm danger", type: "button", onclick: async () => { try { await api.admin.deleteNews(n.id); loadNews(); } catch (e) { toast(e.message, "err"); } } }, "DELETE"))));
    } catch (e) { toast(e.message, "err"); }
  };
  newsBox.append(h("div", { class: "form-row" }, h("div", { class: "fld", style: { flex: "2" } }, h("label", null, "TITLE"), nt), h("div", { class: "fld", style: { flex: "3" } }, h("label", null, "TEXT"), nb), h("div", { class: "fld" }, h("label", null, "VISIBLE TO"), nr),
    h("button", { class: "btn pri", type: "button", id: "news-add", onclick: async () => {
      try { await api.admin.createNews({ title: nt.value.trim(), body: nb.value.trim(), min_role: nr.value, kind: "announcement" }); nt.value = ""; nb.value = ""; loadNews(); ctx.refreshNews(); toast("Banner published.", "ok"); } catch (e) { toast(e.message, "err"); }
    } }, "PUBLISH")), nlist);
  view.append(newsBox); loadNews();
}
