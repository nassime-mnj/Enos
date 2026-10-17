// Logiciels : E.N.O.S. — bouton Installer / Mettre à jour / Lancer selon la version installée, progression, notes de version.
import { h, clear, dateFr, CHANNEL_LABEL, ROLE_LABEL } from "../ui.js";

export function renderSoftware(root, ctx) {
  clear(root);
  const p = ctx.product("enos");
  if (!p) { root.append(h("section", { class: "view" }, h("div", { class: "empty" }, "Catalogue indisponible."))); return; }
  const m = ctx.manifests.enos ? ctx.manifests.enos.manifest : null;
  const action = ctx.actionOf("enos");
  const btn = h("button", { class: "btn pri", type: "button", id: "enos-go", disabled: !p.can_download && action !== "launch" }, ctx.actionLabel(p));
  btn.onclick = () => (ctx.actionOf("enos") === "launch" ? ctx.launch("enos") : ctx.install("enos"));
  const cancel = h("button", { class: "btn sm ghost", type: "button", id: "enos-cancel", hidden: true, onclick: () => ctx.cancel("enos") }, "ANNULER");
  const prog = h("div", { class: "prog", id: "enos-prog", hidden: true }, h("div", { class: "bar" }, h("i")), h("small"));
  const inst = ctx.installed.enos;
  root.append(h("section", { class: "view", id: "view-software" }, h("h2", { class: "t" }, "LOGICIELS"), h("p", { class: "sub" }, "Installez et mettez à jour vos logiciels Dual Pulse."),
    h("div", { class: "prod" }, h("div", { class: "art" }, h("i"), h("i")),
      h("div", { class: "in" }, h("h3", null, "E.N.O.S."), h("p", { class: "tag" }, "L'assistant IA de bureau : agenda, éditeur PDF, studio média et outils."),
        h("div", { class: "meta" }, p.channel ? h("span", { class: "badge " + (p.channel === "stable" ? "friends" : p.channel), id: "enos-channel" }, "CANAL " + (CHANNEL_LABEL[p.channel] || p.channel)) : null,
          p.latest ? h("span", { class: "badge", id: "enos-latest" }, "VERSION " + p.latest.version) : null,
          inst ? h("span", { class: "badge ok", id: "enos-installed" }, "INSTALLÉ " + inst.version) : h("span", { class: "badge", id: "enos-installed" }, "NON INSTALLÉ"),
          action === "update" ? h("span", { class: "badge warn", id: "enos-update-badge" }, "MISE À JOUR DISPONIBLE") : null),
        h("div", { class: "cta" }, btn, cancel, prog),
        (() => {                                                                    // mise à jour téléchargée en arrière-plan (staging) : prête à être appliquée à la fermeture de l'application
          const st = ctx.staged.enos, sg = ctx.stage.enos;
          if (sg && sg.active) return h("p", { class: "hint", id: "enos-staging" }, "Mise à jour en cours de téléchargement en arrière-plan" + (sg.total ? " · " + Math.min(100, Math.round(100 * sg.done / sg.total)) + " %" : "…"));
          if (!st) return null;
          return h("div", { class: "staged", id: "enos-staged" }, h("span", { class: "badge ok" }, "MISE À JOUR PRÊTE · " + st.version),
            h("small", null, "Elle sera appliquée quand tu fermeras E.N.O.S. avec « Redémarrer pour appliquer » (bannière dans l'application)."),
            h("button", { class: "btn sm ghost", type: "button", id: "enos-apply-now", onclick: () => ctx.applyStaged("enos") }, "APPLIQUER MAINTENANT"));
        })(),
        !p.latest ? h("p", { class: "hint", id: "enos-none" }, "Aucune version n'est encore publiée pour votre profil (" + (ROLE_LABEL[ctx.role] || ctx.role) + ").") : null))),
    h("div", { class: "grid2", style: { gridTemplateColumns: "1fr" } },
      h("div", { class: "card", id: "enos-notes-card" }, h("h4", null, "NOTES DE VERSION" + (m ? " · " + m.version : "")),
        m ? [h("div", { style: { color: "var(--muted)", fontSize: "13px", marginBottom: "8px" } }, m.released ? "Publiée le " + dateFr(m.released) : ""), h("div", { class: "notes", id: "enos-notes" }, m.notes || "Aucune note pour cette version.")]
          : h("div", { class: "empty" }, "Aucune note de version disponible."))))
  ctx.bindProgress("enos", { bar: () => root.querySelector("#enos-prog"), btn: () => root.querySelector("#enos-go"), cancel: () => root.querySelector("#enos-cancel") });
}
