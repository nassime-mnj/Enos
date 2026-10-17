// Petits utilitaires d'interface (aucun innerHTML avec des données du serveur : tout passe par textContent).
export const $ = (sel, el = document) => el.querySelector(sel);
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else if (k === "dataset") Object.assign(e.dataset, v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

let toastTimer = 0;
export function toast(text, kind) {
  let t = document.getElementById("toast");
  if (!t) { t = h("div", { id: "toast", role: "status" }); document.body.append(t); }
  t.textContent = text; t.className = "show " + (kind || "");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ""; }, 4500);
}

export const bytes = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(2) + " Go" : n >= 1048576 ? (n / 1048576).toFixed(1) + " Mo" : Math.max(1, Math.round(n / 1024)) + " Ko");
export const dateFr = (iso) => { try { return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }); } catch (e) { return iso || ""; } };
export const ROLE_LABEL = { ceo: "CEO", dev: "Dev", friends: "Friends", public: "Visiteur" };
export const CHANNEL_LABEL = { stable: "STABLE", dev: "DEV", ceo: "CEO", alpha: "ALPHA", public: "PUBLIC" };
