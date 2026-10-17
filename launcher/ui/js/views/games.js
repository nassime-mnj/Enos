// Jeux : TERNA est en développement — vitrine « Coming Soon / Wishlist ». AUCUN bouton « Jouer ». (Équipe : accès alpha séparé, si le serveur en publie un.)
import { h, clear } from "../ui.js";
import { TERNA_PITCH } from "../config.js";
import * as api from "../api.js";

export function renderGames(root, ctx) {
  clear(root);
  const terna = ctx.product("terna");
  let sent = false;
  const msg = h("div", { id: "wish-msg", style: { minHeight: "22px" } });
  const email = h("input", { class: "in", id: "wish-email", type: "email", placeholder: "you@example.com", "aria-label": "Email address", autocomplete: "email" });
  const go = h("button", { class: "btn pri", type: "button", id: "wish-go" }, "FOLLOW THE PROJECT");
  const submit = async () => {
    if (sent) return;
    go.disabled = true;
    try { await api.wishlist(email.value.trim()); sent = true; msg.className = "ok-msg"; msg.textContent = "Done: we'll keep you posted on TERNA's progress. Thank you!"; email.disabled = true; go.textContent = "SUBSCRIBED ✓"; }
    catch (e) { go.disabled = false; msg.className = "err"; msg.textContent = e.message; }
  };
  go.onclick = submit;
  email.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

  const hero = h("div", { class: "coming", id: "terna-hero" },
    h("div", { class: "sky" }), h("div", { class: "stars" }), h("div", { class: "earth" }), h("div", { class: "terna" }),
    h("div", { class: "in" },
      h("span", { class: "ribbon" }, "COMING SOON"),
      h("h3", null, "TERNA"),
      h("div", { class: "chips" }, h("span", null, "ROGUELIKE"), h("span", null, "SOLO & COOP"), h("span", null, "REMOTE PILOTING")),
      h("p", { class: "pitch" }, TERNA_PITCH.main),
      h("div", { class: "wish" }, email, go), msg));
  const team = terna && terna.can_download ? h("div", { class: "card", id: "terna-alpha", style: { marginTop: "18px" } }, h("h4", null, "TEAM ACCESS · ALPHA BUILD"),
    h("div", { class: "row sp" }, h("div", null, h("b", null, `Version ${terna.latest.version}`), h("div", { style: { color: "var(--muted)", fontSize: "13px" } }, "Team only — do not share.")),
      h("button", { class: "btn", type: "button", id: "terna-alpha-go", onclick: () => ctx.install("terna") }, "DOWNLOAD THE ALPHA")),
    h("div", { class: "prog", id: "terna-prog", hidden: true }, h("div", { class: "bar" }, h("i")), h("small"))) : null;
  ctx.bindProgress("terna", { bar: () => root.querySelector("#terna-prog"), btn: () => root.querySelector("#terna-alpha-go") });
  root.append(h("section", { class: "view", id: "view-games" }, h("h2", { class: "t" }, "GAMES"), h("p", { class: "sub" }, "The studio's first game, currently in development."), hero, team));
}
