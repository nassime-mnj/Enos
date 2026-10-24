// PROJETS ENREGISTRÉS CÔTÉ SERVEUR (cross-device) : nommer, enregistrer, lister, ouvrir, dupliquer, supprimer. Enregistrement automatique 1,2 s après la dernière
// modification. Le navigateur ne garde qu'un pointeur (l'identifiant du dernier projet ouvert sur CET appareil) ; le contenu vit sur le serveur.
// Verrouillage optimiste : chaque enregistrement envoie la révision connue ; si un autre appareil a enregistré entre-temps, le serveur répond 409 et rien n'est écrasé
// sans que l'utilisateur choisisse (recharger la version du serveur, ou garder la sienne).
import * as core from "./core.js";

const POINTER = "cinepulse.nle.current";
const DEBOUNCE_MS = 1200;
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const ago = (t, now = Date.now() / 1000) => { const s = Math.max(0, now - t); return s < 60 ? "à l'instant" : s < 3600 ? `il y a ${Math.floor(s / 60)} min` : s < 86400 ? `il y a ${Math.floor(s / 3600)} h` : `il y a ${Math.floor(s / 86400)} j`; };
const validProject = (p) => !!p && p.version === 1 && Array.isArray(p.tracks) && p.tracks.length && Array.isArray(p.clips);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
/** Égalité profonde indépendante de l'ordre des clés (le serveur renvoie ses propres clés dans son propre ordre). */
export const deepEq = (a, b) => (a === b) || (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => deepEq(a[k], b[k])));

/** Appel JSON. Coupure réseau (Wi-Fi du téléphone, antivirus qui filtre le trafic local) : jusqu'à `tries` essais ; la requête n'a alors pas de statut HTTP. */
async function call(method, path, body, tries = 1) {
  for (let i = 1; ; i++) {
    let r;
    try { r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" }); }
    catch (err) { if (i >= tries) { const e = new Error("Serveur injoignable"); e.network = true; throw e; } await sleep(250 * i); continue; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (i > 1 && method === "DELETE" && r.status === 404) return { ok: true };       // le premier envoi avait réussi, seule la réponse s'est perdue
      const e = new Error(j.error || `Erreur ${r.status}`); e.status = r.status; e.body = j; throw e;
    }
    return j;
  }
}

/** PUT sûr face à une réponse perdue : si le serveur répond 409 après une coupure, c'est peut-être notre propre envoi qui est passé -> on compare le contenu. */
async function putProject(id, body) {
  let net = false;
  for (let i = 1; i <= 3; i++) {
    try { return await call("PUT", `/api/projects/${id}`, body); }
    catch (e) {
      if (e.network) { net = true; await sleep(300 * i); continue; }
      if (e.status === 409 && net && body.project) {
        const cur = await call("GET", `/api/projects/${id}`, null, 3);
        if (deepEq(cur.project, body.project)) return { id, name: cur.name, rev: cur.rev };
      }
      throw e;
    }
  }
  const e = new Error("Serveur injoignable"); e.network = true; throw e;
}

/** Logique (sans interface) : projet courant, enregistrement automatique, ouverture. */
export class Projects {
  /** @param {TimelineCanvas} tl  @param {{onState(state, info)}} hooks  états : saved | dirty | saving | error | conflict */
  constructor(tl, hooks = {}) {
    this.tl = tl; this.hooks = hooks; this.id = null; this.name = ""; this.rev = null; this.state = "saved"; this.timer = 0; this.inflight = null; this.again = false; this.lastJSON = "";
    window.addEventListener("pagehide", () => this.flushBeacon());
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") this.flushBeacon(); });
  }

  _set(state, info) { this.state = state; if (this.hooks.onState) this.hooks.onState(state, info); }
  _snapshot() { return JSON.stringify(this.tl.project); }
  get dirty() { return this._snapshot() !== this.lastJSON; }

  list() { return call("GET", "/api/projects", null, 3).then((j) => j.projects); }

  /** Au démarrage : le dernier projet de CET appareil, sinon le plus récent du serveur, sinon un projet vierge. */
  async init() {
    let id = null;
    try { id = localStorage.getItem(POINTER); } catch (e) { /* stockage indisponible */ }
    try {
      if (id) { try { return await this.open(id); } catch (e) { if (e.status !== 404) throw e; } }
      const all = await this.list();
      if (all.length) return await this.open(all[0].id);
    } catch (e) { this._set("error", e.message); return null; }
    this._blank();
    return null;
  }

  _point(id) { try { if (id) localStorage.setItem(POINTER, id); else localStorage.removeItem(POINTER); } catch (e) { /* ignoré */ } }

  _load(p) {
    this.tl.setProject(p);
    this.tl.history = new core.History();
    this.tl.setPlayhead(0, true); this.tl.view.scrollX = 0; this.tl.view.scrollY = 0;
    this.tl.zoomFit();
    this.lastJSON = this._snapshot();
    if (this.hooks.onLoaded) this.hooks.onLoaded();
  }
  _blank() { this.id = null; this.name = ""; this.rev = null; this._point(null); this._load(core.createProject()); this._set("saved"); }

  async open(id) {
    await this.flush();
    const r = await call("GET", `/api/projects/${id}`, null, 3);
    if (!validProject(r.project)) throw new Error("Projet illisible");
    this.id = r.id; this.name = r.name; this.rev = r.rev; this._point(r.id);
    this._load(r.project);
    this._set("saved", { name: r.name });
    return r;
  }

  /** Nouveau projet vierge (l'actuel est d'abord enregistré). Il n'est créé sur le serveur qu'au premier clip. */
  async newProject() { await this.flush(); this._blank(); }

  /** Enregistre sous un nom (création ou renommage). `copy` : crée un NOUVEAU projet à partir du contenu actuel. */
  async saveAs(name, copy = false) {
    await this.flush();
    const project = JSON.parse(this._snapshot());
    if (copy || !this.id) {
      const m = await call("POST", "/api/projects", { id: newId(), name, project }, 3);       // identifiant choisi par le client : un renvoi ne crée pas de doublon
      this.id = m.id; this.name = m.name; this.rev = m.rev; this._point(m.id);
    } else {
      const m = await putProject(this.id, { name, project, rev: this.rev });
      this.name = m.name; this.rev = m.rev;
    }
    this.lastJSON = JSON.stringify(project);
    this._set("saved", { name: this.name });
  }

  async remove(id) {
    await call("DELETE", `/api/projects/${id}`, null, 3);
    if (id === this.id) { clearTimeout(this.timer); this._blank(); }
  }

  /** À appeler à chaque modification : planifie l'enregistrement automatique. */
  markDirty() {
    if (this.state === "conflict") return;
    if (!this.id && !this.tl.project.clips.length) return;           // pas de projet vide sur le serveur
    this._set("dirty");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), DEBOUNCE_MS);
  }

  /** Enregistre maintenant si nécessaire (création au premier clip). */
  async save(force = false) {
    clearTimeout(this.timer);
    if (this.inflight) { this.again = true; return this.inflight; }
    if (!this.dirty && !force) { if (this.state === "dirty") this._set("saved"); return; }
    const project = JSON.parse(this._snapshot());
    this._set("saving");
    this.inflight = (async () => {
      try {
        if (!this.id) { const m = await call("POST", "/api/projects", { id: newId(), project }, 3); this.id = m.id; this.name = m.name; this.rev = m.rev; this._point(m.id); }
        else { const m = await putProject(this.id, { project, rev: force ? undefined : this.rev }); this.rev = m.rev; this.name = m.name; }
        this.lastJSON = JSON.stringify(project);
        this._set("saved", { name: this.name });
      } catch (e) {
        if (e.status === 409) this._set("conflict", e.body && e.body.current);
        else if (e.status === 404) { this.id = null; this._set("error", "Projet supprimé depuis un autre appareil : il sera recréé à la prochaine modification"); }
        else this._set("error", e.message || "Serveur injoignable");
      }
    })();
    try { await this.inflight; } finally { this.inflight = null; }
    if (this.again && this.state !== "conflict") { this.again = false; if (this.dirty) return this.save(); }
    this.again = false;
  }

  async flush() { if (this.state === "conflict" || this.state === "error") return; clearTimeout(this.timer); if (this.dirty && (this.id || this.tl.project.clips.length)) await this.save(); else if (this.inflight) await this.inflight; }

  /** Page quittée : dernier envoi (fetch keepalive : survit à la fermeture de l'onglet). */
  flushBeacon() {
    if (!this.id || !this.dirty || this.state === "conflict") return;
    try { fetch(`/api/projects/${this.id}`, { method: "PUT", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: JSON.parse(this._snapshot()), rev: this.rev }) }); } catch (e) { /* tant pis : l'enregistrement automatique avait déjà eu lieu */ }
  }

  /** Après un conflit : adopter la version du serveur, ou garder la sienne (écrase). */
  async resolveConflict(keepMine) {
    if (keepMine) { this._set("saved"); return this.save(true); }
    this.lastJSON = this._snapshot();                                  // « recharger » abandonne mes modifications : surtout ne pas les renvoyer avant d'ouvrir
    this._set("saved"); return this.open(this.id);
  }
}

/** Feuille « Projets » (liste, nommer, enregistrer, ouvrir, dupliquer, supprimer). */
export class ProjectsPanel {
  constructor(root, prj, opts = {}) {
    this.root = root; this.prj = prj; this.opts = opts; this.confirm = null;
    root.classList.add("exp", "prj"); root.hidden = true;
    root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Projets");
    const top = el("div", "exp-top", "<b>PROJETS</b>");
    const close = el("button", "nle-btn", "✕"); close.type = "button"; close.setAttribute("aria-label", "Fermer"); close.onclick = () => this.close();
    top.append(close);
    this.name = el("input", "prj-name"); this.name.type = "text"; this.name.maxLength = 80; this.name.placeholder = "Nom du projet"; this.name.setAttribute("aria-label", "Nom du projet"); this.name.autocomplete = "off";
    this.status = el("div", "exp-stat");
    this.banner = el("div", "prj-banner"); this.banner.hidden = true;
    const row = el("div", "exp-actions");
    this.bSave = el("button", "nle-btn pri", "ENREGISTRER"); this.bSave.type = "button"; this.bSave.onclick = () => this._guard(() => this.prj.saveAs(this._nameValue(), false));
    this.bCopy = el("button", "nle-btn", "ENREGISTRER SOUS"); this.bCopy.type = "button"; this.bCopy.onclick = () => this._guard(() => this.prj.saveAs(this._nameValue(true), true));
    this.bNew = el("button", "nle-btn", "+ NOUVEAU"); this.bNew.type = "button"; this.bNew.onclick = () => this._guard(() => this.prj.newProject());
    row.append(this.bSave, this.bCopy, this.bNew);
    this.list = el("div", "prj-list"); this.list.setAttribute("role", "list");
    this.msg = el("div", "exp-msg");
    root.append(top, this.name, this.status, this.banner, row, this.msg, this.list);
    this.name.addEventListener("keydown", (e) => { if (e.key === "Enter") this.bSave.click(); });
  }

  get isOpen() { return !this.root.hidden; }
  open() { this.root.hidden = false; this.refresh(); if (this.opts.onToggle) this.opts.onToggle(true); }
  close() { this.root.hidden = true; this.confirm = null; if (this.opts.onToggle) this.opts.onToggle(false); }
  toggle() { this.isOpen ? this.close() : this.open(); }

  _nameValue(copy) {
    const v = this.name.value.trim();
    return copy && (!v || v === this.prj.name) ? (this.prj.name ? `${this.prj.name} (copie)` : "Projet sans titre") : v || this.prj.name || "Projet sans titre";
  }

  async _guard(fn) {
    this.msg.textContent = "";
    try { await fn(); } catch (e) { this.msg.innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
    this.refresh();
  }

  /** Reçoit chaque changement d'état du projet : met à jour l'état affiché et, feuille ouverte, la liste. */
  paintState(state, info) {
    this._paintStatus(state, info);
    if (this.isOpen && state !== "dirty" && state !== "saving") this.refresh();
  }

  _paintStatus(state, info) {
    const t = { saved: "✓ Enregistré sur le serveur", dirty: "Modifications en attente…", saving: "Enregistrement…", error: "⚠ Non enregistré", conflict: "⚠ Conflit" }[state] || "";
    this.status.textContent = state === "error" && info ? `⚠ Non enregistré : ${info}` : t;
    this.status.classList.toggle("bad", state === "error" || state === "conflict");
    this.banner.hidden = state !== "conflict";
    if (state === "conflict") {
      this.banner.innerHTML = "Ce projet a été enregistré depuis un autre appareil. Que faire ?";
      const a = el("button", "nle-btn", "RECHARGER LA VERSION DU SERVEUR"), b = el("button", "nle-btn danger", "GARDER LA MIENNE (ÉCRASER)");
      a.type = b.type = "button";
      a.onclick = () => this._guard(() => this.prj.resolveConflict(false)); b.onclick = () => this._guard(() => this.prj.resolveConflict(true));
      this.banner.append(a, b);
    }
  }

  async refresh() {
    if (!this.isOpen) return;
    if (document.activeElement !== this.name) this.name.value = this.prj.name || "";
    this._paintStatus(this.prj.state);
    let items = [];
    try { items = await this.prj.list(); } catch (e) { this.list.innerHTML = `<div class="lib-empty"><span class="bad">${esc(e.message)}</span></div>`; return; }
    this.list.replaceChildren();
    if (!items.length) { this.list.append(el("div", "lib-empty", "<span>Aucun projet enregistré.<br>Le projet est créé automatiquement dès le premier clip.</span>")); return; }
    for (const p of items) {
      const cur = p.id === this.prj.id, row = el("div", "prj-item" + (cur ? " cur" : ""));
      row.setAttribute("role", "listitem");
      const open = el("button", "prj-open"); open.type = "button"; open.dataset.id = p.id;
      open.innerHTML = `<b>${esc(p.name)}</b><small>${p.clips} clip${p.clips > 1 ? "s" : ""} · ${core.formatTime(p.duration, 30).slice(0, 5)} · ${ago(p.updated)}${cur ? " · ouvert" : ""}</small>`;
      open.onclick = () => { if (!cur) this._guard(async () => { await this.prj.open(p.id); this.close(); }); else this.close(); };
      const del = el("button", "nle-btn danger prj-del", this.confirm === p.id ? "SUPPRIMER ?" : "🗑"); del.type = "button"; del.dataset.id = p.id; del.setAttribute("aria-label", `Supprimer le projet ${p.name}`);
      del.onclick = () => { if (this.confirm === p.id) { this.confirm = null; this._guard(() => this.prj.remove(p.id)); } else { this.confirm = p.id; this.refresh(); } };
      row.append(open, del);
      this.list.append(row);
    }
  }
}
