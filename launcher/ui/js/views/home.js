// Accueil : carrousel de bannières (annonces du studio, nouveautés) + état d'E.N.O.S. + teaser de TERNA.
import { h, clear } from "../ui.js";
import { FALLBACK_NEWS } from "../config.js";
import { openExternal } from "../native.js";

const KIND = { news: "NEWS", release: "NEW RELEASE", announcement: "ANNOUNCEMENT", event: "EVENT" };
const PALETTE = [["#19e6ff33", "#ff7a1a2e"], ["#ff7a1a38", "#19e6ff24"], ["#8b5cf633", "#19e6ff24"], ["#3ddc9730", "#ff7a1a24"]];

export function renderHome(root, ctx) {
  clear(root);
  const items = ctx.news.length ? ctx.news : FALLBACK_NEWS;
  let i = 0, timer = 0;
  const slides = items.map((n, k) => {
    const [c1, c2] = PALETTE[k % PALETTE.length];
    const s = h("div", { class: "slide" + (k === 0 ? " on" : ""), dataset: { id: n.id }, style: n.image ? { backgroundImage: `url("${n.image.replace(/"/g, "%22")}")` } : {} },
      n.image ? null : h("div", { class: "bg", style: { "--c1": c1, "--c2": c2 } }, h("i"), h("i")),
      h("div", { class: "tx" }, h("span", { class: "kind" }, KIND[n.kind] || "NEWS"), h("h3", null, n.title), n.body ? h("p", null, n.body) : null,
        (n.link || n.goto) ? h("button", { class: "btn pri", type: "button", onclick: () => (n.goto ? ctx.go(n.goto) : openExternal(n.link)) }, n.goto === "games" ? "DISCOVER" : "LEARN MORE") : null));
    return s;
  });
  const dots = items.map((_, k) => h("button", { "aria-label": "Banner " + (k + 1), class: k === 0 ? "on" : "", onclick: () => show(k) }));
  const show = (k) => { i = (k + items.length) % items.length; slides.forEach((s, j) => s.classList.toggle("on", j === i)); dots.forEach((d, j) => d.classList.toggle("on", j === i)); restart(); };
  const restart = () => { clearInterval(timer); if (items.length > 1) timer = setInterval(() => show(i + 1), 7000); };
  const hero = h("div", { class: "hero", id: "hero", onmouseenter: () => clearInterval(timer), onmouseleave: restart }, slides,
    items.length > 1 ? [h("button", { class: "arrow l", "aria-label": "Previous", onclick: () => show(i - 1) }, "‹"), h("button", { class: "arrow r", "aria-label": "Next", onclick: () => show(i + 1) }, "›"), h("div", { class: "dots" }, dots)] : null);
  restart();
  ctx.onLeave(() => clearInterval(timer));

  const enos = ctx.product("enos");
  const terna = ctx.product("terna");
  const enosCard = h("div", { class: "card", id: "home-enos" }, h("h4", null, "E.N.O.S."),
    enos ? [h("div", { class: "row sp" }, h("div", null, h("b", null, ctx.statusText(enos)), h("div", { style: { color: "var(--muted)", fontSize: "13px" } }, enos.latest ? `Latest version: ${enos.latest.version}` : "No version published")),
      h("button", { class: "btn pri", type: "button", id: "home-enos-go", onclick: () => ctx.go("software") }, ctx.actionLabel(enos)))] : h("div", { class: "empty" }, "Unavailable"));
  const ternaCard = h("div", { class: "card", id: "home-terna" }, h("h4", null, "TERNA"),
    h("div", { class: "row sp" }, h("div", null, h("b", null, "Coming soon"), h("div", { style: { color: "var(--muted)", fontSize: "13px" } }, terna && terna.can_download ? "Alpha build available to the team" : "Solo & co-op roguelike")),
      h("button", { class: "btn", type: "button", onclick: () => ctx.go("games") }, "VIEW")));
  root.append(h("section", { class: "view", id: "view-home" }, h("h2", { class: "t" }, "FEATURED"), h("p", { class: "sub" }, "The latest from Dual Pulse."), hero, h("div", { class: "grid2" }, enosCard, ternaCard)));
}
