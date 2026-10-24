// PANNEAU D'EXPORT : envoie l'EDL au moteur (POST /api/render), interroge la progression toutes les 250 ms (barre + temps restant), permet d'annuler,
// puis propose le téléchargement du MP4. L'export continue côté serveur même si le panneau est refermé.
import * as core from "./core.js";

const PRESETS = [["540p", "540p · léger"], ["720p", "720p · HD"], ["1080p", "1080p · Full HD"]];
const POLL_MS = 250;

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const fmtSize = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + " Go" : n >= 1e6 ? (n / 1e6).toFixed(1) + " Mo" : Math.max(1, Math.round(n / 1e3)) + " Ko");
export const fmtEta = (s) => (s == null ? "" : s < 90 ? `reste ${Math.max(1, Math.round(s))} s` : `reste ${Math.round(s / 60)} min`);

export class ExportPanel {
  /** @param {HTMLElement} root  @param {() => object} getProject  projet courant (EDL = core.toEDL) */
  constructor(root, getProject, opts = {}) {
    this.root = root; this.getProject = getProject; this.opts = opts; this.preset = "720p"; this.job = null; this.timer = 0; this.busy = false;
    root.classList.add("exp"); root.hidden = true;
    root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Exporter la vidéo");
    const top = el("div", "exp-top", "<b>EXPORTER</b>");
    const close = el("button", "nle-btn", "✕"); close.type = "button"; close.setAttribute("aria-label", "Fermer"); close.onclick = () => this.close();
    top.append(close);
    this.chips = el("div", "lib-chips");
    for (const [id, label] of PRESETS) {
      const b = el("button", "lib-chip", label); b.type = "button"; b.dataset.preset = id;
      b.onclick = () => { if (!this.running) { this.preset = id; this._paint(); } };
      this.chips.append(b);
    }
    this.info = el("div", "exp-info");
    this.bar = el("div", "exp-bar"); this.fill = el("i"); this.bar.append(this.fill);
    this.bar.setAttribute("role", "progressbar"); this.bar.setAttribute("aria-valuemin", "0"); this.bar.setAttribute("aria-valuemax", "100");
    this.stat = el("div", "exp-stat");
    this.msg = el("div", "exp-msg", "");
    this.actions = el("div", "exp-actions");
    this.go = el("button", "nle-btn pri", "LANCER L'EXPORT"); this.go.type = "button"; this.go.onclick = () => this.start();
    this.cancel = el("button", "nle-btn danger", "ANNULER"); this.cancel.type = "button"; this.cancel.onclick = () => this._cancel();
    this.dl = el("a", "nle-btn pri", "⬇ TÉLÉCHARGER"); this.dl.setAttribute("download", "cinepulse-export.mp4");
    this.actions.append(this.go, this.cancel, this.dl);
    root.append(top, this.chips, this.info, this.bar, this.stat, this.msg, this.actions);
    this._paint();
  }

  get isOpen() { return !this.root.hidden; }
  get running() { return !!this.job && (this.job.status === "queued" || this.job.status === "running"); }
  open() { this.root.hidden = false; this._paint(); if (this.opts.onToggle) this.opts.onToggle(true); }
  close() { this.root.hidden = true; if (this.opts.onToggle) this.opts.onToggle(false); }
  toggle() { this.isOpen ? this.close() : this.open(); }

  _paint() {
    const p = this.getProject(), dur = core.projectDuration(p), j = this.job, run = this.running, done = j && j.status === "done";
    for (const b of this.chips.children) { b.classList.toggle("on", b.dataset.preset === this.preset); b.disabled = run; }
    this.info.textContent = dur ? `Durée ${core.formatTime(dur, p.fps)} · ${p.clips.length} clip${p.clips.length > 1 ? "s" : ""} · ${this.preset} · ${p.fps} i/s` : "La timeline est vide.";
    const pct = j ? Math.round(j.progress * 100) : 0;
    this.bar.hidden = this.stat.hidden = !j;
    this.fill.style.width = pct + "%"; this.bar.setAttribute("aria-valuenow", String(pct)); this.bar.classList.toggle("done", !!done);
    if (j) this.stat.textContent = run ? `${pct} %${j.eta != null ? " · " + fmtEta(j.eta) : ""}${j.speed ? ` · ${j.speed}×` : ""}` : done ? `✓ Terminé · ${fmtSize(j.size || 0)} · ${j.width}×${j.height}` : j.status === "cancelled" ? "Export annulé" : "Échec de l'export";
    this.go.hidden = run; this.go.disabled = !dur || this.busy;
    this.go.textContent = done || (j && j.status !== "running") ? "RELANCER L'EXPORT" : "LANCER L'EXPORT";
    this.cancel.hidden = !run;
    this.dl.hidden = !done; if (done) this.dl.href = j.file_url;
    const warn = j && j.warnings && j.warnings.length ? "⚠ " + j.warnings.map(esc).join(" · ") : "";
    const err = j && j.status === "error" && j.error ? `<span class="bad">${esc(j.error)}</span>` : "";
    this.msg.innerHTML = this._error ? `<span class="bad">${esc(this._error)}</span>` : err || warn;
  }

  async start() {
    const p = this.getProject();
    if (!core.projectDuration(p) || this.running || this.busy) return;
    this.busy = true; this._error = ""; this._paint();
    try {
      const edl = { ...core.toEDL(p), settings: { preset: this.preset, fps: p.fps } };
      const r = await fetch("/api/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ edl }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
      this.job = j; this._poll();
    } catch (e) { this._error = e.message || "Serveur injoignable"; this.job = null; }
    this.busy = false; this._paint();
  }

  _poll() {
    clearTimeout(this.timer);
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/render/${this.job.id}`, { cache: "no-store" });
        if (r.ok) this.job = await r.json();
        else if (r.status === 404) { this.job = null; this._error = "Export perdu (serveur redémarré ?)"; }
      } catch (e) { /* coupure passagère : on réessaie */ }
      this._paint(); this._poll();
    }, POLL_MS);
  }

  async _cancel() {
    if (!this.job) return;
    try { const r = await fetch(`/api/render/${this.job.id}/cancel`, { method: "POST" }); if (r.ok) this.job = await r.json(); } catch (e) { /* le sondage montrera l'état réel */ }
    this._paint(); this._poll();
  }
}
