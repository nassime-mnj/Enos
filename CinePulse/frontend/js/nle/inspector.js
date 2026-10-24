// INSPECTEUR DE CLIP (100 % tactile) : curseurs larges (zone ≥ 44 px) pour opacité, échelle, position X / Y, volume, fondu d'entrée / de sortie.
// Trois onglets (IMAGE / SON / FONDUS) : chaque page tient sans défilement sur un téléphone.
// Chaque réglage animable a un bouton ◆ : il pose une image-clé À LA TÊTE DE LECTURE (re-toucher = la retirer). Dès qu'un réglage est animé, le curseur écrit
// l'image-clé de la tête de lecture au lieu de la valeur fixe. Un geste complet (poser le doigt -> le lever) = UNE entrée d'annulation.
import * as core from "./core.js";

const SLIDERS = [
  { prop: "opacity", k: 100, step: 1, tab: "image" },
  { prop: "scale", k: 100, step: 1, tab: "image" },
  { prop: "x", k: 100, step: 1, tab: "image" },
  { prop: "y", k: 100, step: 1, tab: "image" },
  { prop: "volume", k: 100, step: 1, tab: "son" },
];
const FADES = [{ prop: "fadeIn", label: "Fondu d'entrée", tab: "fondus" }, { prop: "fadeOut", label: "Fondu de sortie", tab: "fondus" }];
const TABS = [["image", "IMAGE"], ["son", "SON"], ["fondus", "FONDUS"]];

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const fmtPct = (v) => `${Math.round(v * 100)} %`;
const fmtSec = (v) => `${v.toFixed(2)} s`;

export class Inspector {
  /** @param {HTMLElement} root  @param {TimelineCanvas} tl  @param {{hasAudio(clip):boolean, onToggle(open)}} opts */
  constructor(root, tl, opts = {}) {
    this.root = root; this.tl = tl; this.opts = opts; this.rows = new Map(); this.before = null; this.active = null; this.tab = "image";
    root.classList.add("insp"); root.hidden = true;
    root.setAttribute("role", "region"); root.setAttribute("aria-label", "Réglages du clip");
    const top = el("div", "insp-top");
    this.title = el("span", "insp-name", "Réglages");
    this.btnReset = el("button", "nle-btn", "↺ <span class='lbl'>RÉINITIALISER</span>"); this.btnReset.type = "button"; this.btnReset.setAttribute("aria-label", "Réinitialiser les réglages du clip");
    const close = el("button", "nle-btn", "✕"); close.type = "button"; close.setAttribute("aria-label", "Fermer les réglages");
    top.append(this.title, this.btnReset, close);
    this.tabs = el("div", "insp-tabs"); this.tabs.setAttribute("role", "tablist");
    for (const [id, label] of TABS) {
      const b = el("button", "insp-tab", label); b.type = "button"; b.dataset.tab = id; b.setAttribute("role", "tab");
      b.onclick = () => { this.tab = id; this.refresh(); };
      this.tabs.append(b);
    }
    this.hint = el("div", "insp-hint", "Touchez un clip de la timeline pour régler son opacité, son échelle, sa position et son volume.");
    this.body = el("div", "insp-body");
    for (const d of SLIDERS) this.body.append(this._row(d, true));
    for (const d of FADES) this.body.append(this._row(d, false));
    root.append(top, this.tabs, this.hint, this.body);
    close.onclick = () => this.close();
    this.btnReset.onclick = () => this._reset();
  }

  get isOpen() { return !this.root.hidden; }
  open() { this.root.hidden = false; this.refresh(); if (this.opts.onToggle) this.opts.onToggle(true); }
  close() { this.root.hidden = true; if (this.opts.onToggle) this.opts.onToggle(false); }
  toggle() { this.isOpen ? this.close() : this.open(); }

  _row(d, animable) {
    const label = d.label || core.PROPS[d.prop].label;
    const row = el("div", "insp-row"), l = el("div", "insp-l"), out = el("output"), c = el("div", "insp-c");
    row.dataset.prop = d.prop;
    l.append(el("span", null, label), out);
    const input = el("input"); input.type = "range"; input.setAttribute("aria-label", label);
    if (animable) { const p = core.PROPS[d.prop]; input.min = p.min * d.k; input.max = p.max * d.k; input.step = d.step; }
    else { input.min = 0; input.max = 5; input.step = 0.05; }
    c.append(input);
    let kf = null, clr = null;
    if (animable) {
      kf = el("button", "insp-kf", "◆"); kf.type = "button"; kf.setAttribute("aria-label", `Image-clé « ${label} » à la tête de lecture`);
      clr = el("button", "insp-clr", "⊘"); clr.type = "button"; clr.title = "Supprimer l'animation"; clr.setAttribute("aria-label", `Supprimer l'animation « ${label} »`);
      c.append(kf, clr);
    }
    row.append(l, c);
    const r = { d, row, input, out, kf, clr, animable };
    this.rows.set(d.prop, r);
    const begin = () => { if (this.before == null) this.before = this.tl.snapshot(); this.active = d.prop; };
    input.addEventListener("pointerdown", begin);
    input.addEventListener("input", () => { begin(); this._apply(r); });
    input.addEventListener("change", () => { if (this.before != null) this.tl.endEdit(this.before); this.before = null; this.active = null; this.refresh(); });
    if (kf) kf.onclick = () => this._toggleKeyframe(r);
    if (clr) clr.onclick = () => this._edit((c, rel) => core.clearAnimation(c, d.prop, rel));
    return row;
  }

  _edit(fn) {
    const c = this.tl.selectedClip;
    if (!c) return;
    const before = this.tl.snapshot(), rel = core.relTime(c, this.tl.playhead);
    this.tl.editClip(c.id, (cc) => fn(cc, rel));
    this.tl.endEdit(before);
    this.refresh();
  }
  _reset() { this._edit((c) => core.resetClip(c)); }
  _toggleKeyframe(r) {
    this._edit((c, rel) => { if (core.keyframeNear(c, r.d.prop, rel)) core.removeKeyframe(c, r.d.prop, rel); else core.setKeyframe(c, r.d.prop, rel, core.valueAt(c, r.d.prop, rel)); });
  }

  _apply(r) {
    const c = this.tl.selectedClip;
    if (!c) return;
    const v = Number(r.input.value) / (r.animable ? r.d.k : 1), rel = core.relTime(c, this.tl.playhead);
    this.tl.editClip(c.id, (cc) => { if (r.animable) core.setValue(cc, r.d.prop, rel, v); else { cc[r.d.prop] = v; core.normalizeClip(cc); } });
    this._paint(r, c, rel);
  }

  _paint(r, c, rel) {
    const inside = this.tl.playhead >= c.start - 1e-6 && this.tl.playhead <= c.start + c.dur + 1e-6;
    if (!r.animable) { r.out.textContent = fmtSec(c[r.d.prop] || 0); return; }
    const v = core.valueAt(c, r.d.prop, rel), anim = core.isAnimated(c, r.d.prop), on = anim && !!core.keyframeNear(c, r.d.prop, rel);
    r.out.textContent = fmtPct(v);
    r.kf.classList.toggle("on", on); r.kf.classList.toggle("anim", anim && !on);
    r.kf.setAttribute("aria-pressed", String(on)); r.kf.disabled = !inside;
    r.kf.title = inside ? (on ? "Retirer l'image-clé" : "Poser une image-clé à la tête de lecture") : "Placez la tête de lecture sur le clip";
    r.clr.hidden = !anim;
    r.input.disabled = anim && !inside;
    r.row.classList.toggle("animated", anim);
    return v;
  }

  /** Relit le clip sélectionné et la tête de lecture : à appeler après chaque sélection, déplacement de la tête, annulation ou modification. */
  refresh() {
    if (!this.isOpen) return;
    const c = this.tl.selectedClip;
    this.root.classList.toggle("empty", !c);
    this.hint.hidden = !!c; this.body.hidden = !c; this.tabs.hidden = !c; this.btnReset.disabled = !c;
    this.title.textContent = c ? c.name || c.kind : "Réglages";
    if (!c) return;
    const rel = core.relTime(c, this.tl.playhead), audio = c.kind === "audio" || (c.kind === "video" && this.opts.hasAudio && this.opts.hasAudio(c));
    const avail = { image: c.kind !== "audio", son: audio, fondus: true };
    if (!avail[this.tab]) this.tab = TABS.find(([id]) => avail[id])[0];
    for (const b of this.tabs.children) { b.hidden = !avail[b.dataset.tab]; b.classList.toggle("on", b.dataset.tab === this.tab); b.setAttribute("aria-selected", String(b.dataset.tab === this.tab)); }
    for (const r of this.rows.values()) {
      r.row.hidden = r.d.tab !== this.tab;
      if (r.row.hidden) continue;
      if (!r.animable) { r.input.max = Math.min(5, c.dur); r.input.value = c[r.d.prop] || 0; }
      const v = this._paint(r, c, rel);
      if (r.animable && this.active !== r.d.prop) r.input.value = v * r.d.k;
    }
  }
}
