// Jeux : TERNA est en développement — vitrine « Coming Soon / Wishlist ». AUCUN bouton « Jouer ». (Équipe : accès alpha séparé, si le serveur en publie un.)
import { h, clear } from "../ui.js";
import { TERNA_PITCH } from "../config.js";
import * as api from "../api.js";

export function renderGames(root, ctx) {
  clear(root);
  const terna = ctx.product("terna");
  let sent = false;
  const msg = h("div", { id: "wish-msg", style: { minHeight: "22px" } });
  const email = h("input", { class: "in", id: "wish-email", type: "email", placeholder: "votre@email.com", "aria-label": "Adresse e-mail", autocomplete: "email" });
  const go = h("button", { class: "btn pri", type: "button", id: "wish-go" }, "SUIVRE LE PROJET");
  const submit = async () => {
    if (sent) return;
    go.disabled = true;
    try { await api.wishlist(email.value.trim()); sent = true; msg.className = "ok-msg"; msg.textContent = "C'est noté : vous serez prévenu de l'avancée de TERNA. Merci !"; email.disabled = true; go.textContent = "INSCRIT ✓"; }
    catch (e) { go.disabled = false; msg.className = "err"; msg.textContent = e.message; }
  };
  go.onclick = submit;
  email.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

  const hero = h("div", { class: "coming", id: "terna-hero" },
    h("div", { class: "sky" }), h("div", { class: "stars" }), h("div", { class: "earth" }), h("div", { class: "terna" }),
    h("div", { class: "in" },
      h("span", { class: "ribbon" }, "COMING SOON"),
      h("h3", null, "TERNA"),
      h("div", { class: "chips" }, h("span", null, "ROGUELIKE"), h("span", null, "SOLO & COOP"), h("span", null, "PILOTAGE À DISTANCE")),
      h("p", { class: "pitch" }, TERNA_PITCH.main),
      h("div", { class: "wish" }, email, go), msg));
  const team = terna && terna.can_download ? h("div", { class: "card", id: "terna-alpha", style: { marginTop: "18px" } }, h("h4", null, "ACCÈS ÉQUIPE · BUILD ALPHA"),
    h("div", { class: "row sp" }, h("div", null, h("b", null, `Version ${terna.latest.version}`), h("div", { style: { color: "var(--muted)", fontSize: "13px" } }, "Réservé à l'équipe — ne pas diffuser.")),
      h("button", { class: "btn", type: "button", id: "terna-alpha-go", onclick: () => ctx.install("terna") }, "TÉLÉCHARGER L'ALPHA")),
    h("div", { class: "prog", id: "terna-prog", hidden: true }, h("div", { class: "bar" }, h("i")), h("small"))) : null;
  ctx.bindProgress("terna", { bar: () => root.querySelector("#terna-prog"), btn: () => root.querySelector("#terna-alpha-go") });
  root.append(h("section", { class: "view", id: "view-games" }, h("h2", { class: "t" }, "JEUX"), h("p", { class: "sub" }, "Le premier jeu du studio, en développement."), hero, team));
}
