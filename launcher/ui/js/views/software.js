// Software: E.N.O.S. — Install / Update / Launch button depending on the installed version, progress, release notes.
import { h, clear, formatDate, CHANNEL_LABEL, ROLE_LABEL } from "../ui.js";

export function renderSoftware(root, ctx) {
  clear(root);
  const p = ctx.product("enos");
  if (!p) { root.append(h("section", { class: "view" }, h("div", { class: "empty" }, "Catalogue unavailable."))); return; }
  const m = ctx.manifests.enos ? ctx.manifests.enos.manifest : null;
  const action = ctx.actionOf("enos");
  const btn = h("button", { class: "btn pri", type: "button", id: "enos-go", disabled: !p.can_download && action !== "launch" }, ctx.actionLabel(p));
  btn.onclick = () => (ctx.actionOf("enos") === "launch" ? ctx.launch("enos") : ctx.install("enos"));
  const cancel = h("button", { class: "btn sm ghost", type: "button", id: "enos-cancel", hidden: true, onclick: () => ctx.cancel("enos") }, "CANCEL");
  const prog = h("div", { class: "prog", id: "enos-prog", hidden: true }, h("div", { class: "bar" }, h("i")), h("small"));
  const inst = ctx.installed.enos;
  root.append(h("section", { class: "view", id: "view-software" }, h("h2", { class: "t" }, "SOFTWARE"), h("p", { class: "sub" }, "Install and update your Dual Pulse software."),
    h("div", { class: "prod" }, h("div", { class: "art" }, h("i"), h("i")),
      h("div", { class: "in" }, h("h3", null, "E.N.O.S."), h("p", { class: "tag" }, "The AI desktop assistant: calendar, PDF editor, media studio and tools."),
        h("div", { class: "meta" }, p.channel ? h("span", { class: "badge " + (p.channel === "stable" ? "friends" : p.channel), id: "enos-channel" }, "CHANNEL " + (CHANNEL_LABEL[p.channel] || p.channel)) : null,
          p.latest ? h("span", { class: "badge", id: "enos-latest" }, "VERSION " + p.latest.version) : null,
          inst ? h("span", { class: "badge ok", id: "enos-installed" }, "INSTALLED " + inst.version) : h("span", { class: "badge", id: "enos-installed" }, "NOT INSTALLED"),
          action === "update" ? h("span", { class: "badge warn", id: "enos-update-badge" }, "UPDATE AVAILABLE") : null),
        h("div", { class: "cta" }, btn, cancel, prog),
        (() => {                                                                    // mise à jour téléchargée en arrière-plan (staging) : prête à être appliquée à la fermeture de l'application
          const st = ctx.staged.enos, sg = ctx.stage.enos;
          if (sg && sg.active) return h("p", { class: "hint", id: "enos-staging" }, "An update is downloading in the background" + (sg.total ? " · " + Math.min(100, Math.round(100 * sg.done / sg.total)) + " %" : "…"));
          if (!st) return null;
          return h("div", { class: "staged", id: "enos-staged" }, h("span", { class: "badge ok" }, "UPDATE READY · " + st.version),
            h("small", null, "It will be applied when you close E.N.O.S. using \"Restart to apply\" (a banner appears in the app)."),
            h("button", { class: "btn sm ghost", type: "button", id: "enos-apply-now", onclick: () => ctx.applyStaged("enos") }, "APPLY NOW"));
        })(),
        !p.latest ? h("p", { class: "hint", id: "enos-none" }, "No version has been published for your profile yet (" + (ROLE_LABEL[ctx.role] || ctx.role) + ").") : null))),
    h("div", { class: "grid2", style: { gridTemplateColumns: "1fr" } },
      h("div", { class: "card", id: "enos-notes-card" }, h("h4", null, "RELEASE NOTES" + (m ? " · " + m.version : "")),
        m ? [h("div", { style: { color: "var(--muted)", fontSize: "13px", marginBottom: "8px" } }, m.released ? "Released on " + formatDate(m.released) : ""), h("div", { class: "notes", id: "enos-notes" }, m.notes || "No notes for this version.")]
          : h("div", { class: "empty" }, "No release notes available."))))
  ctx.bindProgress("enos", { bar: () => root.querySelector("#enos-prog"), btn: () => root.querySelector("#enos-go"), cancel: () => root.querySelector("#enos-cancel") });
}
