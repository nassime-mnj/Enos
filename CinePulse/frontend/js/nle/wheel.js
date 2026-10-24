// ROUE DES TRANSITIONS : s'ouvre en touchant le badge d'une jonction (deux clips collés). Trois secteurs (coupe, fondu enchaîné, fondu au noir) autour du doigt
// et, au centre, la durée (un appui la fait passer à la valeur suivante). Chaque choix est UNE entrée d'annulation.
import * as core from "./core.js";

const R = 82, BTN = 72, CENTER = 64, SIZE = 2 * (R + BTN / 2) + 8;
const ANGLES = { cut: -90, crossfade: 30, dip: 150 };
const SHORT = { cut: "COUPE", crossfade: "ENCHAÎNÉ", dip: "NOIR" };
const ICON = { cut: "|", crossfade: "✕", dip: "●" };

export class TransitionWheel {
  /** @param {TimelineCanvas} tl */
  constructor(tl) {
    this.tl = tl; this.j = null; this.buttons = {};
    this.bg = document.createElement("div"); this.bg.className = "wheel-bg"; this.bg.hidden = true;
    this.bg.addEventListener("pointerdown", (e) => { if (e.target === this.bg) this.close(); });
    this.wheel = document.createElement("div"); this.wheel.className = "wheel"; this.wheel.setAttribute("role", "dialog"); this.wheel.setAttribute("aria-label", "Transition entre deux clips");
    this.wheel.style.width = this.wheel.style.height = SIZE + "px";
    for (const t of core.TRANSITIONS) {
      const b = document.createElement("button"); b.type = "button"; b.className = "wheel-b"; b.dataset.type = t.type; b.setAttribute("aria-label", t.label);
      const a = (ANGLES[t.type] * Math.PI) / 180;
      b.style.width = b.style.height = BTN + "px";
      b.style.left = SIZE / 2 + R * Math.cos(a) - BTN / 2 + "px"; b.style.top = SIZE / 2 + R * Math.sin(a) - BTN / 2 + "px";
      b.innerHTML = `<i>${ICON[t.type]}</i><span>${SHORT[t.type]}</span>`;
      b.onclick = () => this._choose(t.type);
      this.buttons[t.type] = b; this.wheel.append(b);
    }
    this.center = document.createElement("button"); this.center.type = "button"; this.center.className = "wheel-c";
    this.center.style.width = this.center.style.height = CENTER + "px"; this.center.style.left = this.center.style.top = SIZE / 2 - CENTER / 2 + "px";
    this.center.onclick = () => this._nextDur();
    this.wheel.append(this.center);
    this.bg.append(this.wheel);
    document.body.append(this.bg);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && this.isOpen) this.close(); });
  }

  get isOpen() { return !this.bg.hidden; }

  /** @param {{a, b}} j  jonction  @param {number} x,y  position écran du toucher */
  open(j, x, y) {
    this.j = { a: j.a.id, b: j.b.id };
    const m = 8, left = Math.min(Math.max(m, x - SIZE / 2), window.innerWidth - SIZE - m), top = Math.min(Math.max(m, y - SIZE / 2), window.innerHeight - SIZE - m);
    this.wheel.style.left = left + "px"; this.wheel.style.top = top + "px";
    this.bg.hidden = false;
    this._paint();
  }
  close() { this.bg.hidden = true; this.j = null; }

  _clips() {
    const p = this.tl.project;
    return this.j ? [p.clips.find((c) => c.id === this.j.a), p.clips.find((c) => c.id === this.j.b)] : [];
  }
  _paint() {
    const [a, b] = this._clips();
    if (!a || !b) return this.close();
    const cur = core.transitionOf(a, b), max = core.maxTransitionDur(a, b);
    for (const [t, btn] of Object.entries(this.buttons)) { btn.classList.toggle("on", t === cur.type); btn.setAttribute("aria-pressed", String(t === cur.type)); }
    this.center.disabled = cur.type === "cut";
    this.center.innerHTML = cur.type === "cut" ? "<b>—</b><span>durée</span>" : `<b>${(Math.min(cur.dur, max)).toFixed(2).replace(/\.?0+$/, "")} s</b><span>durée</span>`;
    this.center.setAttribute("aria-label", cur.type === "cut" ? "Durée (sans objet pour une coupe)" : `Durée ${cur.dur} secondes, toucher pour changer`);
  }
  _choose(type) {
    const [a, b] = this._clips();
    if (!a || !b) return this.close();
    const cur = core.transitionOf(a, b);
    this.tl.setTransition(a.id, b.id, type, cur.dur || 0.5);
    if (type === "cut") this.close(); else this._paint();
  }
  _nextDur() {
    const [a, b] = this._clips();
    if (!a || !b) return this.close();
    const cur = core.transitionOf(a, b), max = core.maxTransitionDur(a, b), opts = core.TRANSITION_DURS.filter((d) => d <= max + 1e-6);
    if (cur.type === "cut" || !opts.length) return;
    const next = opts.find((d) => d > cur.dur + 1e-6) || opts[0];
    this.tl.setTransition(a.id, b.id, cur.type, next);
    this._paint();
  }
}
