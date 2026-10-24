// TIMELINE CANVAS : tout est dessiné sur UN <canvas> (aucun nœud DOM par clip) -> 60 FPS même avec 10 pistes. Rendu À LA DEMANDE (requestAnimationFrame
// seulement quand quelque chose change), clips hors écran ignorés, DPR pris en compte.
// Gestes (Pointer Events, souris + tactile + stylet) :
//   1 doigt sur la règle ou une zone vide : déplace la tête de lecture      2 doigts : pincer = zoom (centré), glisser = naviguer horizontalement et verticalement
//   appui sur un clip : le sélectionne       APPUI LONG (tactile, anneau de progression + vibration) : soulève le clip, puis glisser = déplacer (change de piste)
//   appui sur le badge d'une jonction (deux clips collés) : opts.onJunction -> roue des transitions
//   poignées gauche / droite du clip sélectionné : rogner / étirer (une image s'étire sans limite -> -loop 1 au rendu)      souris : glisser un clip, molette = naviguer, Ctrl+molette = zoom
// Magnétisme : début / fin du clip sur la tête de lecture, le zéro et les bords des autres clips (trait guide dessiné).
import { HEADER_W_DEFAULT } from "./constants.js";
import * as core from "./core.js";

export const RULER_H = 34, TRACK_H = 72, HEADER_W = HEADER_W_DEFAULT, CLIP_PAD = 4;
const LONG_PRESS_MS = 420, SNAP_PX = 12, MOVE_SLOP = 10, MOUSE_SLOP = 3;
const COLORS = { video: ["#1f3f78", "#4f86e0"], image: ["#7a4f0e", "#e0a43a"], audio: ["#145a3d", "#3ddc84"] };

const rr = (ctx, x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); };

export class TimelineCanvas {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} project  projet (core.createProject)
   * @param {object} opts     { asset(id) -> asset|undefined, peaks(id) -> Promise<number[]|null>, onChange(), onSelect(clip|null), onSeek(t), onZoom(pps), onJunction(j, clientX, clientY) }
   */
  constructor(canvas, project, opts = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext("2d", { alpha: false });
    this.project = project; this.opts = opts;
    this.view = { pps: 80, scrollX: 0, scrollY: 0 };
    this.playhead = 0; this.selected = null; this.snapping = true;
    this.history = new core.History();
    this.pointers = new Map(); this.op = null; this.guide = null; this.preview = null;
    this.W = 0; this.H = 0; this.dpr = 1; this._raf = 0; this._t = 0;
    this.thumbs = new Map(); this.peaks = new Map();
    this.stats = { frames: 0, lastMs: 0, totalMs: 0 };
    const cs = getComputedStyle(canvas);
    this.accent = (cs.getPropertyValue("--ac") || "").trim() || "#e0243c";
    canvas.style.touchAction = "none";
    canvas.setAttribute("role", "application");
    canvas.setAttribute("aria-label", "Timeline de montage : glisser pour déplacer la tête de lecture, deux doigts pour zoomer");
    this._bind();
    this.resize();
  }

  // ------------------------------------------------------------------ géométrie
  get headerW() { return HEADER_W; }
  xOf(t) { return HEADER_W + t * this.view.pps - this.view.scrollX; }
  tOf(x) { return (x - HEADER_W + this.view.scrollX) / this.view.pps; }
  trackIndex(id) { return this.project.tracks.findIndex((t) => t.id === id); }
  trackTop(i) { return RULER_H + i * TRACK_H - this.view.scrollY; }
  trackAtY(y) { const i = Math.floor((y - RULER_H + this.view.scrollY) / TRACK_H); return i >= 0 && i < this.project.tracks.length ? i : -1; }
  clipRect(c, override) {
    const i = this.trackIndex(override ? override.track : c.track), start = override ? override.start : c.start, dur = override ? override.dur : c.dur;
    return { x: this.xOf(start), y: this.trackTop(i) + CLIP_PAD, w: dur * this.view.pps, h: TRACK_H - 2 * CLIP_PAD };
  }
  get maxScrollY() { return Math.max(0, this.project.tracks.length * TRACK_H - (this.H - RULER_H)); }
  clampView() {
    const v = this.view;
    v.scrollX = Math.max(0, Math.min(v.scrollX, (core.projectDuration(this.project) + 30) * v.pps));
    v.scrollY = Math.max(0, Math.min(v.scrollY, this.maxScrollY));
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.W = Math.max(1, Math.round(r.width)); this.H = Math.max(1, Math.round(r.height));
    this.canvas.width = Math.round(this.W * this.dpr); this.canvas.height = Math.round(this.H * this.dpr);
    this.clampView(); this.requestDraw();
  }

  // ------------------------------------------------------------------ API publique
  setPlayhead(t, silent) { this.playhead = Math.max(0, t); if (!silent && this.opts.onSeek) this.opts.onSeek(this.playhead); this.requestDraw(); }
  setSnapping(on) { this.snapping = !!on; }
  select(clip) { this.selected = clip ? clip.id : null; if (this.opts.onSelect) this.opts.onSelect(clip || null); this.requestDraw(); }
  get selectedClip() { return this.project.clips.find((c) => c.id === this.selected) || null; }
  setProject(p) { this.project = p; this.selected = null; this.clampView(); this.requestDraw(); }
  zoomTo(pps, anchorX = (this.W - HEADER_W) / 2) { core.zoomAt(this.view, pps, anchorX); this.clampView(); if (this.opts.onZoom) this.opts.onZoom(this.view.pps); this.requestDraw(); }
  zoomFit() {
    const d = core.projectDuration(this.project) || 10;
    this.view.scrollX = 0; this.zoomTo((this.W - HEADER_W - 24) / d, 0);
  }

  _commit(before) {
    const after = JSON.stringify(this.project);
    if (before !== after) { this.history.pushRaw(before); if (this.opts.onChange) this.opts.onChange(); }
  }
  _mutate(fn) { const before = JSON.stringify(this.project); fn(); this._commit(before); this.requestDraw(); }

  undo() { const p = this.history.back(this.project); if (p) { this.project = p; this._afterRestore(); } }
  redo() { const p = this.history.forward(this.project); if (p) { this.project = p; this._afterRestore(); } }
  _afterRestore() { if (!this.selectedClip) this.select(null); this.clampView(); if (this.opts.onChange) this.opts.onChange(); this.requestDraw(); }

  // -- édition « en direct » (curseurs de l'inspecteur) : modifie sans historique, puis endEdit() enregistre UNE entrée d'annulation pour tout le geste
  snapshot() { return JSON.stringify(this.project); }
  editClip(id, fn) { const c = this.project.clips.find((x) => x.id === id); if (!c) return false; fn(c); this.requestDraw(); return true; }
  endEdit(before) { this._commit(before); this.requestDraw(); }
  setTransition(aId, bId, type, dur) {
    const a = this.project.clips.find((x) => x.id === aId), b = this.project.clips.find((x) => x.id === bId);
    if (a && b) this._mutate(() => core.setTransition(a, b, type, dur));
  }
  /** Coupe le clip sélectionné à la tête de lecture. Retourne le clip de droite, ou null (tête hors du clip). */
  splitAtPlayhead() {
    const c = this.selectedClip;
    if (!c) return null;
    let right = null;
    this._mutate(() => { right = core.splitClip(this.project, c, this.playhead); });
    if (right) this.select(c);
    return right;
  }

  deleteSelected() { const c = this.selectedClip; if (!c) return false; this._mutate(() => { this.project.clips = this.project.clips.filter((x) => x.id !== c.id); }); this.select(null); return true; }
  addTrack(type) { let id; this._mutate(() => { id = core.addTrack(this.project, type); }); this.requestDraw(); return id; }
  removeTrack(id) { let ok = false; this._mutate(() => { ok = core.removeTrack(this.project, id); }); return ok; }

  /** Choisit la piste d'accueil d'un média : vidéo / image -> piste vidéo la plus basse libre à `start` ; audio -> première piste audio libre. */
  pickTrack(asset, start, dur) {
    const hosts = this.project.tracks.filter((t) => core.canHost(t, asset.kind));
    if (!hosts.length) return null;
    const ordered = asset.kind === "audio" ? hosts : [...hosts].reverse();
    return ordered.find((t) => core.nearestFreeStart(this.project, t.id, dur, start) === start) || ordered[0];
  }

  /** Ajoute un média à la tête de lecture (ou à `start`). Retourne le clip. */
  addAsset(asset, start = this.playhead, trackId) {
    const probe = core.makeClip(asset, "", start), tr = trackId ? this.project.tracks.find((t) => t.id === trackId) : this.pickTrack(asset, start, probe.dur);
    if (!tr || !core.canHost(tr, asset.kind)) return null;
    let clip;
    this._mutate(() => {
      clip = core.makeClip(asset, tr.id, 0);
      clip.start = core.nearestFreeStart(this.project, tr.id, clip.dur, start);
      this.project.clips.push(clip);
    });
    this.select(clip);
    return clip;
  }

  /** Glisser-déposer depuis la bibliothèque : aperçu fantôme (coordonnées écran). Retourne true si le pointeur est au-dessus des pistes. */
  setDropPreview(asset, clientX, clientY) {
    const r = this.canvas.getBoundingClientRect(), x = clientX - r.left, y = clientY - r.top;
    if (x < HEADER_W - 30 || x > r.width || y < RULER_H - 6 || y > r.height) { this.clearDropPreview(); return false; }
    let i = this.trackAtY(Math.max(y, RULER_H + 1));
    if (i < 0) i = this.project.tracks.length - 1;
    let tr = this.project.tracks[i];
    if (!core.canHost(tr, asset.kind)) {                       // piste incompatible : la plus proche qui convient
      const ok = this.project.tracks.map((t, k) => [t, k]).filter(([t]) => core.canHost(t, asset.kind)).sort((a, b) => Math.abs(a[1] - i) - Math.abs(b[1] - i))[0];
      if (!ok) { this.clearDropPreview(); return false; }
      tr = ok[0];
    }
    const clip = core.makeClip(asset, tr.id, 0), dur = clip.dur;
    let start = Math.max(0, this.tOf(x));
    if (this.snapping) { const m = core.snapMove(core.snapPoints(this.project, new Set(), this.playhead), start, dur, SNAP_PX / this.view.pps); start = Math.max(0, m.start); this.guide = m.point; }
    this.preview = { track: tr.id, start: core.nearestFreeStart(this.project, tr.id, dur, start), dur, kind: asset.kind, name: asset.name };
    this.requestDraw();
    return true;
  }
  clearDropPreview() { if (this.preview || this.guide != null) { this.preview = null; this.guide = null; this.requestDraw(); } }
  dropAsset(asset, clientX, clientY) {
    if (!this.setDropPreview(asset, clientX, clientY)) return null;
    const p = this.preview;
    this.clearDropPreview();
    return this.addAsset(asset, p.start, p.track);
  }

  // ------------------------------------------------------------------ entrées
  _bind() {
    const c = this.canvas;
    this._on = (t, f, o) => { c.addEventListener(t, f, o); (this._unbind ||= []).push(() => c.removeEventListener(t, f, o)); };
    this._on("pointerdown", (e) => this._down(e));
    this._on("pointermove", (e) => this._move(e));
    this._on("pointerup", (e) => this._up(e));
    this._on("pointercancel", (e) => this._up(e, true));
    this._on("lostpointercapture", (e) => { if (this.pointers.has(e.pointerId) && e.pointerType === "mouse") this._up(e); });
    this._on("wheel", (e) => this._wheel(e), { passive: false });
    this._on("contextmenu", (e) => e.preventDefault());
    if (window.ResizeObserver) { this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(c); }
  }
  destroy() { (this._unbind || []).forEach((f) => f()); if (this._ro) this._ro.disconnect(); cancelAnimationFrame(this._raf); clearTimeout(this._lp); }

  _pt(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  /** Jonction (deux clips collés) dont le badge est sous le doigt : le badge est dans la bande haute de la piste, les poignées de rognage restent libres en dessous. */
  _junctionAt(x, y, touch) {
    if (x < HEADER_W || y < RULER_H) return null;
    const R = touch ? 22 : 13;
    for (const j of core.junctions(this.project)) {
      const cx = this.xOf(j.time), cy = this.trackTop(this.trackIndex(j.track)) + CLIP_PAD + 14;
      if (Math.hypot(x - cx, y - cy) <= R) return j;
    }
    return null;
  }
  _hit(x, y, touch) {
    if (x < HEADER_W || y < RULER_H) return null;
    const z = touch ? 24 : 9;
    for (let k = this.project.clips.length - 1; k >= 0; k--) {
      const c = this.project.clips[k], r = this.clipRect(c);
      if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue;
      const edge = Math.min(z, r.w / 3), sel = c.id === this.selected;
      return { clip: c, zone: sel && x <= r.x + edge ? "left" : sel && x >= r.x + r.w - edge ? "right" : "body" };
    }
    return null;
  }

  _down(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointeur synthétique */ }
    const p = this._pt(e), touch = e.pointerType !== "mouse";
    this.pointers.set(e.pointerId, { ...p, x0: p.x, y0: p.y, touch });
    if (this.pointers.size === 2) return this._startGesture();
    if (this.pointers.size > 2) return;
    this._cancelOp(true);
    if (p.y < RULER_H || p.x < HEADER_W) { if (p.x >= HEADER_W) { this.op = { type: "scrub" }; this._scrub(p.x); } return; }
    const jn = this._junctionAt(p.x, p.y, touch);
    if (jn) { this.op = { type: "junction", j: jn, x: p.x, y: p.y, cx: e.clientX, cy: e.clientY }; return; }
    const h = this._hit(p.x, p.y, touch);
    if (!h) { this.op = { type: "scrub", tap: true }; this.select(null); this._scrub(p.x); return; }
    const before = JSON.stringify(this.project);
    if (h.clip.id !== this.selected) this.select(h.clip);
    if (h.zone === "left" || h.zone === "right") { this.op = { type: "resize", side: h.zone, id: h.clip.id, before }; return; }
    this.op = { type: "press", id: h.clip.id, before, x: p.x, y: p.y, t0: performance.now(), touch };
    if (touch) { this._lp = setTimeout(() => this._lift(), LONG_PRESS_MS); this._animate(true); }
  }

  _lift() {
    const o = this.op, c = this.project.clips.find((x) => o && x.id === o.id);
    if (!o || o.type !== "press" || !c) return;
    this.op = { type: "drag", id: c.id, before: o.before, grab: this.tOf(o.x) - c.start, orig: { start: c.start, track: c.track }, cur: { start: c.start, track: c.track, dur: c.dur }, lifted: true, x: o.x, y: o.y };
    if (navigator.vibrate) { try { navigator.vibrate(14); } catch (err) { /* non supporté */ } }
    this._animate(true);
  }

  _move(e) {
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) return;
    const p = this._pt(e); ptr.x = p.x; ptr.y = p.y;
    if (this.pointers.size >= 2) return this._gesture();
    const o = this.op;
    if (!o) return;
    if (o.type === "scrub") return this._scrub(p.x);
    if (o.type === "junction") { if (Math.hypot(p.x - o.x, p.y - o.y) > MOVE_SLOP) this.op = null; return; }       // le doigt a glissé : ce n'était pas un appui
    if (o.type === "press") {
      const d = Math.hypot(p.x - o.x, p.y - o.y);
      if (!o.touch && d > MOUSE_SLOP) { this._lift(); return this._move(e); }                 // souris : le glisser suffit (pas d'appui long)
      if (o.touch && d > MOVE_SLOP) { clearTimeout(this._lp); this.op = { type: "scrub" }; this._animate(false); this._scrub(p.x); }
      return;
    }
    if (o.type === "drag") { o.x = p.x; o.y = p.y; return this._dragTo(p); }
    if (o.type === "resize") return this._resizeTo(p);
  }

  _up(e, cancelled) {
    const had = this.pointers.delete(e.pointerId);
    if (!had) return;
    if (this.op && this.op.type === "gesture") { if (this.pointers.size < 2) this.op = null; return; }
    if (this.pointers.size) return;
    const o = this.op;
    clearTimeout(this._lp); this._animate(false);
    if (o && o.type === "junction" && !cancelled && this.opts.onJunction) this.opts.onJunction({ a: o.j.a, b: o.j.b, track: o.j.track, time: o.j.time }, o.cx, o.cy);
    if (o && (o.type === "drag" || o.type === "resize")) {
      if (cancelled) this.project = JSON.parse(o.before);
      else if (o.type === "drag") this._dropDrag(o);
      else this._finishResize(o);
    }
    this.op = null; this.guide = null; this.requestDraw();
  }

  /** Fin d'un rognage : les images-clés suivent le contenu (elles ne glissent pas), les fondus restent plus courts que le clip. */
  _finishResize(o) {
    const c = this.project.clips.find((x) => x.id === o.id), orig = JSON.parse(o.before).clips.find((x) => x.id === o.id);
    if (c && orig && (Math.abs(c.dur - orig.dur) > 1e-9 || Math.abs(c.start - orig.start) > 1e-9)) {
      if (orig.kf) { const kf = core.retimeKeyframes(orig, c.start - orig.start, c.dur); if (kf) c.kf = kf; else delete c.kf; }
      core.normalizeClip(c);
    }
    this._commit(o.before);
  }

  _cancelOp(silent) { clearTimeout(this._lp); const o = this.op; if (o && (o.type === "drag" || o.type === "resize") && o.before) this.project = JSON.parse(o.before); this.op = null; this.guide = null; if (!silent) this.requestDraw(); }

  _scrub(x) { this.setPlayhead(Math.max(0, this.tOf(x))); }

  // -- déplacement d'un clip soulevé
  _dragTo(p) {
    const o = this.op, c = this.project.clips.find((x) => x.id === o.id);
    if (!c) return;
    let start = Math.max(0, this.tOf(p.x) - o.grab);
    if (this.snapping) { const m = core.snapMove(core.snapPoints(this.project, new Set([c.id]), this.playhead), start, c.dur, SNAP_PX / this.view.pps); start = Math.max(0, m.start); this.guide = m.point; } else this.guide = null;
    let track = o.cur.track;
    const i = this.trackAtY(p.y);
    if (i >= 0 && core.canHost(this.project.tracks[i], c.kind)) track = this.project.tracks[i].id;
    o.cur = { start, track, dur: c.dur };
    this._animate(true); this.requestDraw();
  }
  _dropDrag(o) {
    const c = this.project.clips.find((x) => x.id === o.id);
    if (!c) return;
    c.track = o.cur.track;
    c.start = core.nearestFreeStart(this.project, c.track, c.dur, o.cur.start, c.id);
    this._commit(o.before);
  }

  // -- poignées
  _resizeTo(p) {
    const o = this.op, c = this.project.clips.find((x) => x.id === o.id);
    if (!c) return;
    const pts = this.snapping ? core.snapPoints(this.project, new Set([c.id]), this.playhead) : null, thr = SNAP_PX / this.view.pps, t = this.tOf(p.x);
    const r = o.side === "right" ? core.resizeRight(this.project, c, this.opts.asset && this.opts.asset(c.asset), t, pts, thr) : core.resizeLeft(this.project, c, t, pts, thr);
    c.start = r.start; c.dur = r.dur; c.in = r.in; this.guide = r.point;
    this.requestDraw();
  }

  // -- deux doigts : pincer + naviguer
  _startGesture() {
    this._cancelOp(true);
    const [a, b] = [...this.pointers.values()];
    this.op = { type: "gesture", d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), mx0: (a.x + b.x) / 2, my0: (a.y + b.y) / 2, pps0: this.view.pps, sx0: this.view.scrollX, sy0: this.view.scrollY };
    this.op.t0 = (this.view.scrollX + this.op.mx0 - HEADER_W) / this.view.pps;
    this._animate(false);
  }
  _gesture() {
    const o = this.op;
    if (!o || o.type !== "gesture") return;
    const [a, b] = [...this.pointers.values()], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, d = Math.hypot(a.x - b.x, a.y - b.y);
    const pps = core.clampPps(o.pps0 * (d / o.d0)), anchor = mx - HEADER_W;
    this.view.pps = pps;
    this.view.scrollX = o.t0 * pps - anchor;                       // le temps sous les doigts reste sous les doigts (zoom + glissement horizontal)
    this.view.scrollY = o.sy0 - (my - o.my0);
    this.clampView();
    if (this.opts.onZoom) this.opts.onZoom(pps);
    this.requestDraw();
  }

  _wheel(e) {
    e.preventDefault();
    const p = this._pt(e), k = e.deltaMode === 1 ? 32 : 1;
    if (e.ctrlKey || e.metaKey) this.zoomTo(this.view.pps * Math.exp(-e.deltaY * k * 0.0025), p.x - HEADER_W);
    else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { this.view.scrollX += (e.shiftKey ? e.deltaY : e.deltaX) * k; this.clampView(); this.requestDraw(); }
    else if (this.maxScrollY > 0) { this.view.scrollY += e.deltaY * k; this.clampView(); this.requestDraw(); }
    else { this.view.scrollX += e.deltaY * k; this.clampView(); this.requestDraw(); }
  }

  // ------------------------------------------------------------------ boucle de rendu
  _animate(on) { this._anim = on; if (on) this.requestDraw(); }
  requestDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame((now) => { this._raf = 0; this._tick(now); this.draw(); if (this._anim) this.requestDraw(); });
  }
  _tick(now) {
    const dt = Math.min(0.05, ((now - (this._t || now)) || 16) / 1000); this._t = now;
    const o = this.op;
    if (o && o.type === "drag") {                                 // défilement automatique près des bords pendant un déplacement
      const edge = 56, speed = 700 * dt;
      if (o.x > this.W - edge) this.view.scrollX += speed * Math.min(1, (o.x - (this.W - edge)) / edge);
      else if (o.x < HEADER_W + edge && this.view.scrollX > 0) this.view.scrollX -= speed * Math.min(1, (HEADER_W + edge - o.x) / edge);
      if (o.y > this.H - 30) this.view.scrollY += speed * 0.6; else if (o.y < RULER_H + 30) this.view.scrollY -= speed * 0.6;
      this.clampView();
      this._dragTo({ x: o.x, y: o.y });
    }
  }

  _thumb(asset) {
    if (!asset || !asset.thumb_url) return null;
    let t = this.thumbs.get(asset.id);
    if (!t) { t = new Image(); t.onload = () => this.requestDraw(); t.src = asset.thumb_url; this.thumbs.set(asset.id, t); }
    return t.complete && t.naturalWidth ? t : null;
  }
  _peaks(asset) {
    if (!asset || !this.opts.peaks) return null;
    if (!this.peaks.has(asset.id)) { this.peaks.set(asset.id, null); Promise.resolve(this.opts.peaks(asset.id)).then((p) => { this.peaks.set(asset.id, p || null); this.requestDraw(); }).catch(() => {}); }
    return this.peaks.get(asset.id);
  }

  draw() {
    const t0 = performance.now(), ctx = this.ctx, W = this.W, H = this.H, v = this.view, tracks = this.project.tracks;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#08080a"; ctx.fillRect(0, 0, W, H);
    const step = core.rulerStep(v.pps), t_a = Math.max(0, this.tOf(HEADER_W)), t_b = this.tOf(W);
    // pistes + grille
    ctx.save(); ctx.beginPath(); ctx.rect(HEADER_W, RULER_H, W - HEADER_W, H - RULER_H); ctx.clip();
    tracks.forEach((tr, i) => {
      const y = this.trackTop(i);
      if (y > H || y + TRACK_H < RULER_H) return;
      ctx.fillStyle = i % 2 ? "#0c0c0f" : "#101014"; ctx.fillRect(HEADER_W, y, W - HEADER_W, TRACK_H);
    });
    ctx.strokeStyle = "#1b1b21"; ctx.lineWidth = 1; ctx.beginPath();
    for (let t = Math.floor(t_a / step) * step; t <= t_b; t += step) { const x = Math.round(this.xOf(t)) + 0.5; ctx.moveTo(x, RULER_H); ctx.lineTo(x, H); }
    ctx.stroke();
    // clips (le clip soulevé est dessiné en dernier, par-dessus)
    const drag = this.op && this.op.type === "drag" ? this.op : null;
    for (const c of this.project.clips) { if (!drag || drag.id !== c.id) this._drawClip(ctx, c, null, false); }
    if (drag) { const c = this.project.clips.find((x) => x.id === drag.id); if (c) this._drawClip(ctx, c, drag.cur, true); }
    const js = core.junctions(this.project);
    this._jb = new Map(js.map((j) => [j.b.id, j]));
    for (const j of js) this._drawJunction(ctx, j);
    if (this.preview) this._drawGhost(ctx, this.preview);
    if (this.guide != null) { const x = Math.round(this.xOf(this.guide)) + 0.5; ctx.strokeStyle = "#ffd93d"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, H); ctx.stroke(); ctx.setLineDash([]); }
    ctx.restore();
    // règle
    ctx.save(); ctx.beginPath(); ctx.rect(HEADER_W, 0, W - HEADER_W, RULER_H); ctx.clip();
    ctx.fillStyle = "#0b0b0e"; ctx.fillRect(HEADER_W, 0, W - HEADER_W, RULER_H);
    ctx.fillStyle = "#8b8b94"; ctx.strokeStyle = "#3a3a42"; ctx.font = "11px Rajdhani, system-ui, sans-serif"; ctx.textBaseline = "middle"; ctx.lineWidth = 1; ctx.beginPath();
    const sub = step / (step >= 1 ? (step >= 10 ? 5 : 4) : 5);
    for (let t = Math.floor(t_a / sub) * sub; t <= t_b; t += sub) { const x = Math.round(this.xOf(t)) + 0.5, major = Math.abs(t / step - Math.round(t / step)) < 1e-6; ctx.moveTo(x, RULER_H - (major ? 12 : 6)); ctx.lineTo(x, RULER_H); if (major) ctx.fillText(core.formatTime(t, this.project.fps).slice(0, step < 1 ? 8 : 5), x + 4, 12); }
    ctx.stroke(); ctx.restore();
    // tête de lecture
    const px = this.xOf(this.playhead);
    if (px >= HEADER_W - 8 && px <= W + 8) {
      ctx.save(); ctx.beginPath(); ctx.rect(HEADER_W, 0, W - HEADER_W, H); ctx.clip();
      ctx.strokeStyle = ctx.fillStyle = this.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(Math.round(px), RULER_H - 2); ctx.lineTo(Math.round(px), H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px - 9, 2); ctx.lineTo(px + 9, 2); ctx.lineTo(px + 9, RULER_H - 14); ctx.lineTo(px, RULER_H - 3); ctx.lineTo(px - 9, RULER_H - 14); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // en-têtes de pistes (fixes)
    ctx.fillStyle = "#0a0a0d"; ctx.fillRect(0, 0, HEADER_W, H);
    ctx.save(); ctx.beginPath(); ctx.rect(0, RULER_H, HEADER_W, H - RULER_H); ctx.clip();
    ctx.font = "700 13px Rajdhani, system-ui, sans-serif"; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    tracks.forEach((tr, i) => {
      const y = this.trackTop(i);
      if (y > H || y + TRACK_H < RULER_H) return;
      ctx.fillStyle = COLORS[tr.type === "audio" ? "audio" : "video"][1]; ctx.fillRect(0, y + 6, 4, TRACK_H - 12);
      ctx.fillStyle = "#e9e9ec"; ctx.fillText(tr.id, 12, y + TRACK_H / 2 - 7);
      ctx.fillStyle = "#6a6a74"; ctx.font = "600 10px Rajdhani, system-ui, sans-serif"; ctx.fillText(tr.type === "audio" ? "AUDIO" : "VIDÉO", 12, y + TRACK_H / 2 + 8); ctx.font = "700 13px Rajdhani, system-ui, sans-serif";
      ctx.fillStyle = "#1f1f25"; ctx.fillRect(0, y + TRACK_H - 1, HEADER_W, 1);
    });
    ctx.restore();
    ctx.fillStyle = "#0b0b0e"; ctx.fillRect(0, 0, HEADER_W, RULER_H);
    ctx.fillStyle = "#e9e9ec"; ctx.font = "700 11px Rajdhani, system-ui, sans-serif"; ctx.textBaseline = "middle"; ctx.fillText(core.formatTime(this.playhead, this.project.fps), 6, RULER_H / 2);
    ctx.fillStyle = "#26262b"; ctx.fillRect(HEADER_W - 1, 0, 1, H); ctx.fillRect(0, RULER_H - 1, W, 1);
    // anneau de l'appui long
    const o = this.op;
    if (o && o.type === "press" && o.touch) {
      const k = Math.min(1, (performance.now() - o.t0) / LONG_PRESS_MS);
      ctx.strokeStyle = this.accent; ctx.lineWidth = 4; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(o.x, o.y, 26, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.strokeStyle = "#ffffff30"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(o.x, o.y, 26, 0, Math.PI * 2); ctx.stroke();
    }
    const ms = performance.now() - t0, s = this.stats;
    s.frames++; s.lastMs = ms; s.totalMs += ms;
  }

  _drawClip(ctx, c, override, lifted) {
    const r = this.clipRect(c, override);
    if (r.x > this.W || r.x + r.w < HEADER_W || r.y > this.H || r.y + r.h < RULER_H) return;
    const asset = this.opts.asset && this.opts.asset(c.asset), [bg, fg] = COLORS[c.kind] || COLORS.video, sel = c.id === this.selected;
    const y = lifted ? r.y - 5 : r.y;
    ctx.save();
    if (lifted) { ctx.shadowColor = "#000c"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 8; ctx.globalAlpha = 0.93; }
    rr(ctx, r.x, y, r.w, r.h, 8); ctx.fillStyle = bg; ctx.fill();
    ctx.shadowColor = "transparent"; ctx.save(); rr(ctx, r.x, y, r.w, r.h, 8); ctx.clip();
    const th = c.kind !== "audio" ? this._thumb(asset) : null;
    if (th) {                                                     // vignette répétée sur la hauteur du clip (une seule image décodée, mise en cache)
      const tw = Math.max(24, (th.naturalWidth / th.naturalHeight) * r.h), x0 = Math.max(r.x, HEADER_W - tw), x1 = Math.min(r.x + r.w, this.W);
      ctx.globalAlpha = lifted ? 0.8 : 0.62;
      for (let x = r.x + Math.floor((x0 - r.x) / tw) * tw; x < x1; x += tw) ctx.drawImage(th, x, y, tw, r.h);
      ctx.globalAlpha = lifted ? 0.93 : 1;
    }
    if (c.kind === "audio" || (asset && asset.has_audio && c.kind === "video" && r.h > 40)) this._drawWave(ctx, c, asset, r, y);
    const g = ctx.createLinearGradient(0, y, 0, y + r.h); g.addColorStop(0, "#0000"); g.addColorStop(1, "#000a"); ctx.fillStyle = g; ctx.fillRect(r.x, y, r.w, r.h);
    this._drawFades(ctx, c, r, y);
    if (r.w > 36) { ctx.beginPath(); ctx.rect(r.x + 8, y, r.w - 14, r.h); ctx.clip(); ctx.fillStyle = "#fff"; ctx.font = "700 12px Rajdhani, system-ui, sans-serif"; ctx.textBaseline = "alphabetic"; ctx.fillText(c.name || (asset && asset.name) || c.kind, r.x + 9, y + r.h - 22); ctx.fillStyle = "#ffffffb0"; ctx.font = "600 10px Rajdhani, system-ui, sans-serif"; ctx.fillText(c.dur.toFixed(c.dur < 10 ? 2 : 1) + " s" + (c.kind === "image" ? " · image" : ""), r.x + 9, y + r.h - 9); }
    ctx.restore();
    rr(ctx, r.x + 0.5, y + 0.5, r.w - 1, r.h - 1, 8); ctx.lineWidth = sel || lifted ? 2.5 : 1; ctx.strokeStyle = sel || lifted ? "#fff" : fg + "aa"; ctx.stroke();
    if (sel && !lifted) {                                         // poignées : barres aux deux bords
      const hw = Math.min(10, r.w / 4);
      ctx.fillStyle = "#fff"; rr(ctx, r.x, y, hw, r.h, 8); ctx.fill(); rr(ctx, r.x + r.w - hw, y, hw, r.h, 8); ctx.fill();
      ctx.fillStyle = "#000a"; const gw = 2, gh = Math.min(22, r.h / 2); if (hw > 5) { ctx.fillRect(r.x + hw / 2 - 1, y + (r.h - gh) / 2, gw, gh); ctx.fillRect(r.x + r.w - hw / 2 - 1, y + (r.h - gh) / 2, gw, gh); }
    }
    if (sel && !lifted && c.kf) this._drawKeyframes(ctx, c, r, y);
    ctx.restore();
  }

  /** Fondus : triangle sombre + diagonale (à la manière des éditeurs vidéo) ; fondu enchaîné : « X » accent sur la durée de la transition, au début du clip B. */
  _drawFades(ctx, c, r, y) {
    const k = this.view.pps;
    if (c.fadeIn > 0.01) { const w = Math.min(c.fadeIn * k, r.w); ctx.fillStyle = "#000b"; ctx.beginPath(); ctx.moveTo(r.x, y); ctx.lineTo(r.x + w, y); ctx.lineTo(r.x, y + r.h); ctx.closePath(); ctx.fill(); ctx.strokeStyle = "#fffc"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(r.x, y + r.h); ctx.lineTo(r.x + w, y); ctx.stroke(); }
    if (c.fadeOut > 0.01) { const w = Math.min(c.fadeOut * k, r.w), e = r.x + r.w; ctx.fillStyle = "#000b"; ctx.beginPath(); ctx.moveTo(e, y); ctx.lineTo(e - w, y); ctx.lineTo(e, y + r.h); ctx.closePath(); ctx.fill(); ctx.strokeStyle = "#fffc"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(e, y + r.h); ctx.lineTo(e - w, y); ctx.stroke(); }
    const j = this._jb && this._jb.get(c.id);
    if (j && core.transitionOf(j.a, c).type === "crossfade") {
      const w = Math.min(c.trIn.dur * k, r.w);
      ctx.fillStyle = this.accent + "55"; ctx.fillRect(r.x, y, w, r.h);
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(r.x, y); ctx.lineTo(r.x + w, y + r.h); ctx.moveTo(r.x, y + r.h); ctx.lineTo(r.x + w, y); ctx.stroke();
    }
  }

  _drawKeyframes(ctx, c, r, y) {
    const times = new Set();
    for (const pts of Object.values(c.kf)) for (const q of pts) times.add(q.t);
    ctx.fillStyle = "#ffd93d"; ctx.strokeStyle = "#000"; ctx.lineWidth = 1;
    for (const t of times) { const x = r.x + t * this.view.pps, cy = y + r.h - 8; if (x < HEADER_W - 6 || x > this.W + 6) continue; ctx.beginPath(); ctx.moveTo(x, cy - 6); ctx.lineTo(x + 6, cy); ctx.lineTo(x, cy + 6); ctx.lineTo(x - 6, cy); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  }

  /** Badge de jonction : coupe | , fondu enchaîné X, fondu au noir ● (anneau accent quand une transition est posée). */
  _drawJunction(ctx, j) {
    const cx = this.xOf(j.time), cy = this.trackTop(this.trackIndex(j.track)) + CLIP_PAD + 14;
    if (cx < HEADER_W - 14 || cx > this.W + 14 || cy < RULER_H - 14 || cy > this.H + 14) return;
    const t = core.transitionOf(j.a, j.b).type;
    ctx.save(); ctx.beginPath(); ctx.rect(HEADER_W, RULER_H, this.W - HEADER_W, this.H - RULER_H); ctx.clip();
    ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2); ctx.fillStyle = "#050506e6"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = t === "cut" ? "#ffffffaa" : this.accent; ctx.stroke();
    ctx.strokeStyle = ctx.fillStyle = "#fff"; ctx.lineWidth = 1.8; ctx.beginPath();
    if (t === "cut") { ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy + 5); ctx.stroke(); }
    else if (t === "crossfade") { ctx.moveTo(cx - 5, cy - 5); ctx.lineTo(cx + 5, cy + 5); ctx.moveTo(cx - 5, cy + 5); ctx.lineTo(cx + 5, cy - 5); ctx.stroke(); }
    else { ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  _drawWave(ctx, c, asset, r, y) {
    const peaks = this._peaks(asset);
    if (!peaks || !peaks.length || !asset.duration) return;
    if (peaks.max == null) peaks.max = Math.max(0.05, ...peaks);                // onde normalisée sur le pic du média (comme un éditeur audio) : un son discret reste lisible
    const x0 = Math.max(r.x, HEADER_W), x1 = Math.min(r.x + r.w, this.W), mid = y + r.h / 2, amp = (r.h * 0.42) / peaks.max;
    ctx.fillStyle = c.kind === "audio" ? "#3ddc84dd" : "#ffffff66"; ctx.beginPath();
    for (let x = x0; x < x1; x += 2) {
      const t = c.in + (x - r.x) / this.view.pps, k = Math.min(peaks.length - 1, Math.max(0, Math.floor((t / asset.duration) * peaks.length)));
      const h = Math.max(1, peaks[k] * amp); ctx.rect(x, mid - h, 1.4, h * 2);
    }
    ctx.fill();
  }

  _drawGhost(ctx, g) {
    const i = this.trackIndex(g.track), x = this.xOf(g.start), y = this.trackTop(i) + CLIP_PAD, w = g.dur * this.view.pps, fg = (COLORS[g.kind] || COLORS.video)[1];
    ctx.save(); ctx.globalAlpha = 0.5; rr(ctx, x, y, w, TRACK_H - 2 * CLIP_PAD, 8); ctx.fillStyle = fg; ctx.fill(); ctx.globalAlpha = 1; ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke(); ctx.restore();
  }
}
