// Dual Pulse Launcher — point d'entrée : session, données (catalogue, bannières, versions installées), navigation, installation.
import { $, h, clear, toast, bytes } from "./ui.js";
import * as api from "./api.js";
import * as native from "./native.js";
import { PRODUCTS } from "./config.js";
import { renderLogin } from "./views/login.js";
import { renderHome } from "./views/home.js";
import { renderSoftware } from "./views/software.js";
import { renderGames } from "./views/games.js";
import { renderAccount } from "./views/account.js";

const root = $("#root");
const state = { view: "home", catalog: null, news: [], manifests: {}, installed: {}, progress: {}, retried: {}, leave: [], bound: {}, settings: { auto_update: false, check_interval_min: 30 }, staged: {}, stage: {}, stageRetried: {} };

// ------------------------------------------------------------------ versions (même règle que le moteur Rust : comparaison numérique)
const parseV = (v) => { const p = String(v || "").trim().split("."); return p.length && p.length <= 4 && p.every((x) => /^\d+$/.test(x)) ? p.map(Number) : null; };
function cmpV(a, b) { const x = parseV(a), y = parseV(b); if (!x || !y) return null; const n = Math.max(x.length, y.length); for (let i = 0; i < n; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; } return 0; }

const ctx = {
  get news() { return state.news; },
  get manifests() { return state.manifests; },
  get installed() { return state.installed; },
  get staged() { return state.staged; },
  get stage() { return state.stage; },
  get settings() { return state.settings; },
  get role() { return api.session.role; },
  product: (id) => (state.catalog ? state.catalog.products.find((p) => p.id === id) || null : null),
  actionOf(id) {
    const p = ctx.product(id), inst = state.installed[id];
    if (state.progress[id] && state.progress[id].active) return "busy";
    if (!p || !p.latest) return inst ? "launch" : "none";
    if (!inst) return "install";
    const c = cmpV(inst.version, p.latest.version);
    return c === -1 || c === null ? "update" : "launch";
  },
  actionLabel(p) { return { install: "INSTALLER", update: "METTRE À JOUR", launch: "LANCER", busy: "INSTALLATION…", none: "INDISPONIBLE" }[ctx.actionOf(p.id)]; },
  statusText(p) { const a = ctx.actionOf(p.id); return { install: "Non installé", update: "Mise à jour disponible", launch: "À jour", busy: "Installation en cours", none: "Non disponible" }[a]; },
  go, logout, install, launch, cancel,
  async setSettings(patch) { state.settings = await native.settings.set(patch); scheduleAuto(); if (state.settings.auto_update) autoTick(); return state.settings; },
  async applyStaged(id) { try { await native.applyUpdate(id); await refreshStaged(); await refreshInstalled(); toast("Mise à jour appliquée.", "ok"); go(state.view); } catch (e) { toast(e.message || String(e), "err"); } },
  async discardStaged(id) { await native.discardStaged(id); await refreshStaged(); go(state.view); },
  async refreshNews() { try { state.news = (await api.news()).items; } catch (e) {} },
  onLeave: (fn) => state.leave.push(fn),
  bindProgress(id, refs) { state.bound[id] = refs; paintProgress(id); },
};

// ------------------------------------------------------------------ progression
function paintProgress(id) {
  const refs = state.bound[id]; if (!refs) return;
  const p = state.progress[id] || {}, bar = refs.bar && refs.bar(), btn = refs.btn && refs.btn(), cancel = refs.cancel && refs.cancel();
  if (btn && !btn.isConnected) return;
  if (bar) {
    bar.hidden = !p.active;
    const fill = bar.querySelector(".bar"), i = bar.querySelector(".bar i"), s = bar.querySelector("small");
    if (p.active) {
      const pct = p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0;
      const ind = p.phase !== "download" || !p.total;
      fill.classList.toggle("ind", ind); i.style.width = ind ? "" : pct + "%";
      s.textContent = p.phase === "verify" ? "Vérification de la signature…" : p.phase === "download" ? `Téléchargement ${pct} % · ${bytes(p.done)} / ${bytes(p.total)}` : "Installation… autorisez la fenêtre Windows si elle apparaît.";
    }
  }
  if (btn) { btn.disabled = !!p.active; const pr = ctx.product(id); if (pr && id !== "terna") btn.textContent = ctx.actionLabel(pr); }
  if (cancel) cancel.hidden = !(p.active && p.phase !== "install");
}

async function refreshInstalled() {
  for (const p of Object.values(PRODUCTS)) {
    if (!p.app_id) { try { const s = await native.productState(p.id, ""); state.installed[p.id] = s.installed || undefined; } catch (e) {} continue; }
    try { const s = await native.productState(p.id, p.app_id); state.installed[p.id] = s.installed || undefined; } catch (e) {}
  }
}

// ------------------------------------------------------------------ mises à jour automatiques (téléchargement silencieux dans le dossier de staging)
// Le Launcher ne ferme JAMAIS une application de force : une fois la mise à jour prête, il la signale à l'application (bannière « Redémarrer pour appliquer »)
// et ne remplace les fichiers que lorsque l'application s'est fermée d'elle-même (côté natif).
async function refreshStaged() {
  for (const p of Object.values(PRODUCTS)) {
    try { const i = await native.stagedInfo(p.id); if (i) state.staged[p.id] = i; else delete state.staged[p.id]; } catch (e) { /* produit sans staging */ }
  }
}
async function autoStage() {
  if (!state.settings.auto_update || !state.catalog) return;
  for (const p of state.catalog.products) {
    const m = state.manifests[p.id], inst = state.installed[p.id];
    if (!m || !inst || !p.latest || !m.manifest || m.manifest.mode !== "files") continue;              // les manifestes « installeur » restent à la main (bouton METTRE À JOUR)
    if (cmpV(inst.version, p.latest.version) !== -1) continue;                                          // déjà à jour
    if (state.staged[p.id] && cmpV(state.staged[p.id].version, p.latest.version) !== -1) continue;       // déjà prête
    if (state.stage[p.id] && state.stage[p.id].active) continue;
    state.stage[p.id] = { active: true, phase: "verify", done: 0, total: 0 };
    try { await native.stageUpdate({ server: api.session.server, token: api.session.token, product: p.id, channel: p.channel, manifest: m.manifest, signature: m.signature }); }
    catch (e) { state.stage[p.id] = { active: false }; }
  }
}
let autoTimer = 0, autoBusy = false;
async function autoTick() {
  if (autoBusy || !state.settings.auto_update || !api.session.user) return;
  autoBusy = true;
  try { await api.ensureFreshToken(); await loadData(); await refreshStaged(); await autoStage(); } catch (e) { /* hors ligne : prochain passage */ } finally { autoBusy = false; }
}
function scheduleAuto() {
  clearInterval(autoTimer);
  if (state.settings.auto_update) autoTimer = setInterval(autoTick, Math.max(5, state.settings.check_interval_min || 30) * 60 * 1000);
}

async function install(id) {
  const p = ctx.product(id), m = state.manifests[id];
  if (!p || !m) return toast("Aucune version disponible pour votre profil.", "err");
  state.progress[id] = { active: true, phase: "verify", done: 0, total: 0 };
  paintProgress(id);
  try { await native.installProduct({ server: api.session.server, token: api.session.token, product: id, channel: p.channel, manifest: m.manifest, signature: m.signature }); }
  catch (e) { state.progress[id] = { active: false }; paintProgress(id); toast(e.message || String(e), "err"); }
}
function cancel() { native.cancelInstall().catch(() => {}); }

async function launch(id) {
  const meta = PRODUCTS[id];
  try { await native.launchProduct(id, meta.app_id || "", meta.run || ""); toast(meta.name + " se lance…", "ok"); }
  catch (e) { toast(e.message || String(e), "err"); }
}

async function onNative() {
  await native.listen("stage-progress", (e) => { state.stage[e.product] = { active: true, phase: e.phase, done: e.done, total: e.total }; });
  await native.listen("stage-ready", async (e) => {
    state.stage[e.product] = { active: false }; state.stageRetried[e.product] = false; await refreshStaged();
    toast((PRODUCTS[e.product] || {}).name + " " + e.version + " est prêt : il s'appliquera au prochain redémarrage.", "ok");
    if (["software", "home"].includes(state.view)) go(state.view);
  });
  await native.listen("stage-error", async (e) => {
    state.stage[e.product] = { active: false };
    if (e.token_expired && !state.stageRetried[e.product]) { state.stageRetried[e.product] = true; try { await api.ensureFreshToken(); return autoStage(); } catch (x) { return; } }
    state.stageRetried[e.product] = false;
    if (!e.cancelled) toast("Mise à jour en arrière-plan : " + e.message, "err");
  });
  await native.listen("update-applied", async (e) => {
    await refreshInstalled(); await refreshStaged(); toast((PRODUCTS[e.product] || {}).name + " a été mis à jour vers " + e.version + ".", "ok");
    if (["software", "home"].includes(state.view)) go(state.view);
  });
  await native.listen("update-apply-failed", (e) => toast("Mise à jour non appliquée (ancienne version restaurée) : " + e.message, "err"));
  await native.listen("install-progress", (e) => { state.progress[e.product] = { active: true, phase: e.phase, done: e.done, total: e.total }; paintProgress(e.product); });
  await native.listen("install-done", async (e) => {
    state.progress[e.product] = { active: false }; state.retried[e.product] = false;
    await refreshInstalled(); paintProgress(e.product); toast((PRODUCTS[e.product] || {}).name + " " + e.version + " est installé.", "ok"); updateNavDot(); if (["software", "home", "games"].includes(state.view)) go(state.view);
  });
  await native.listen("install-error", async (e) => {
    state.progress[e.product] = { active: false }; paintProgress(e.product);
    if (e.token_expired && !state.retried[e.product]) {                       // jeton expiré pendant un long téléchargement : on le renouvelle et on reprend (le .part est conservé)
      state.retried[e.product] = true;
      try { await api.ensureFreshToken(); return install(e.product); } catch (x) { return toast("Session expirée : reconnectez-vous.", "err"); }
    }
    state.retried[e.product] = false;
    if (!e.cancelled) toast(e.message, "err"); else toast("Installation annulée.");
  });
}

// ------------------------------------------------------------------ données
async function loadData() {
  const [cat, nws] = await Promise.allSettled([api.catalog(), api.news()]);
  state.catalog = cat.status === "fulfilled" ? cat.value : state.catalog;
  state.news = nws.status === "fulfilled" ? nws.value.items : state.news;
  if (cat.status === "rejected") toast(cat.reason.message, "err");
  if (state.catalog) {
    await Promise.all(state.catalog.products.map(async (p) => {
      if (p.channel && p.latest) { try { state.manifests[p.id] = await api.manifest(p.id, p.channel); } catch (e) { delete state.manifests[p.id]; } } else delete state.manifests[p.id];
    }));
  }
  await refreshInstalled();
  updateNavDot();
}
function updateNavDot() { const d = document.querySelector('[data-nav="software"] .dot'); if (d) d.hidden = ctx.actionOf("enos") !== "update"; }

// ------------------------------------------------------------------ coque
const ICON = {
  home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10"/>',
  game: '<rect x="2" y="7" width="20" height="11" rx="4"/><path d="M7 10v5M4.5 12.5h5M15.5 11.5h.01M18 13.5h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
};
const VIEWS = { home: renderHome, software: renderSoftware, games: renderGames, account: renderAccount };

function go(view) {
  state.leave.splice(0).forEach((f) => f());
  state.view = view;
  document.querySelectorAll(".nav").forEach((n) => n.classList.toggle("on", n.dataset.nav === view));
  const main = $("#main"); if (!main) return;
  const body = h("div");
  VIEWS[view](body, ctx);
  clear(main).append(...body.childNodes);
  main.scrollTop = 0;
}

function shell() {
  const u = api.session.user;
  const nav = (id, label, icon) => h("button", { class: "nav" + (id === state.view ? " on" : ""), dataset: { nav: id }, type: "button", onclick: () => go(id) },
    (() => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.innerHTML = ICON[icon]; return s; })(), h("span", null, label), id === "software" ? h("i", { class: "dot", hidden: true }) : null);
  clear(root).append(h("div", { id: "shell" },
    h("nav", { id: "side", "aria-label": "Navigation" }, nav("home", "ACCUEIL", "home"), nav("software", "LOGICIELS", "box"), nav("games", "JEUX", "game"), nav("account", "COMPTE", "user"), h("span", { class: "sp" }),
      h("div", { class: "me", id: "me" }, h("div", { class: "av" }, (u.name || u.email)[0].toUpperCase()), h("div", null, h("b", null, u.name || u.email), h("small", null, ({ ceo: "CEO", dev: "Dev", friends: "Friends" })[u.role])))),
    h("main", { id: "main" })));
}

async function logout() { await api.logout(); }          // api.logout() déclenche onLogout -> showLogin()
function showLogin() { state.catalog = null; state.manifests = {}; state.installed = {}; renderLogin(root, start); }

async function start() {
  clear(root).append(h("div", { style: { display: "grid", placeItems: "center", height: "100%" } }, h("span", { class: "spin" })));
  state.view = "home"; shell();
  try { state.settings = await native.settings.get(); } catch (e) { /* réglages par défaut */ }
  await loadData();
  await refreshStaged();
  go("home");
  scheduleAuto(); setTimeout(autoTick, 15000);
  clearInterval(state.poll); state.poll = setInterval(async () => { if (!document.hidden) { await loadData(); if (["home", "software"].includes(state.view) && !Object.values(state.progress).some((p) => p.active)) go(state.view); } }, 5 * 60 * 1000);
}

async function boot() {
  document.body.classList.toggle("native", native.isNative);
  $("#preview-tag").hidden = native.isNative;
  $("#wc-min").onclick = native.win.minimize; $("#wc-max").onclick = native.win.maximize; $("#wc-close").onclick = native.win.close;
  api.session.onLogout(() => showLogin());
  await onNative();
  await api.loadServer();
  if (await api.restore()) start(); else showLogin();
}
boot();
