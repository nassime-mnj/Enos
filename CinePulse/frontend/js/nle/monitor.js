// MONITEUR D'APERÇU : un <canvas> compose l'image exacte sous la tête de lecture à partir des PROXYS de la bibliothèque (vidéo ≤ 540 p, images 960 px), avec
// opacité / échelle / position / images-clés lus dans le projet à chaque image -> les réglages de l'inspecteur se voient instantanément.
// Lecture : l'horloge est celle du navigateur ; chaque <video> / <audio> tourne à sa vitesse et n'est resynchronisé que s'il dérive (> 0,3 s), la tête de lecture
// de la timeline suit l'horloge. Fluidité d'abord : le gouverneur passe en mode « allégé » (sans fondus ni fondu enchaîné) si les images deviennent trop lentes.
import * as core from "./core.js";
import { layersAt, FpsGovernor } from "./preview_model.js";

const ASPECT = 16 / 9, MAX_W = 960, MAX_POOL = 8, DRIFT = 0.3, AHEAD = 1.5;

export class Monitor {
  /**
   * @param {{canvas, view, play, home, time, lite}} ui  éléments du DOM
   * @param {TimelineCanvas} tl
   * @param {{asset(id), hasAudio(clip), onTransport(playing)}} opts
   */
  constructor(ui, tl, opts = {}) {
    this.ui = ui; this.tl = tl; this.opts = opts;
    this.ctx = ui.canvas.getContext("2d", { alpha: false });
    this.playing = false; this.lite = false; this.gov = new FpsGovernor();
    this.pool = new Map(); this.images = new Map(); this._raf = 0; this._loopRaf = 0;
    this.stats = { frames: 0, lastMs: 0, totalMs: 0, drawn: 0 };
    this.host = document.createElement("div");                       // réserve des éléments média (hors écran : certains navigateurs mobiles ne décodent pas un <video> détaché)
    this.host.setAttribute("aria-hidden", "true");
    this.host.style.cssText = "position:fixed;left:-9999px;top:0;width:2px;height:2px;overflow:hidden;opacity:0;pointer-events:none";
    document.body.append(this.host);
    ui.play.onclick = () => this.toggle();
    ui.home.onclick = () => { this.seek(0); };
    if (window.ResizeObserver) { this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(ui.view); }
    this.resize();
  }

  get fps() { return this.tl.project.fps || 30; }
  get duration() { return core.projectDuration(this.tl.project); }

  // ------------------------------------------------------------------ taille du canvas : jamais plus que nécessaire (fluidité sur mobile)
  resize() {
    const r = this.ui.view.getBoundingClientRect();
    let w = r.width, h = r.height;
    if (w / h > ASPECT) w = h * ASPECT; else h = w / ASPECT;               // image 16:9 entière dans la zone
    const k = Math.min(window.devicePixelRatio || 1, 2), px = Math.min(MAX_W, Math.max(2, Math.round(w * k)));
    this.ui.canvas.style.width = Math.round(w) + "px"; this.ui.canvas.style.height = Math.round(h) + "px";
    this.ui.canvas.width = px; this.ui.canvas.height = Math.round(px / ASPECT);
    this.requestRender();
  }

  // ------------------------------------------------------------------ transport
  toggle() { this.playing ? this.pause() : this.play(); }

  play() {
    if (this.playing) return;
    const end = this.duration;
    if (!end) return;
    if (this.tl.playhead >= end - 1e-3) this.tl.setPlayhead(0, true);
    this.playing = true; this.gov.reset();
    this._t0 = this.tl.playhead; this._w0 = performance.now(); this._last = this._w0;
    this._paintTransport();
    this._loopRaf = requestAnimationFrame((n) => this._loop(n));
  }

  pause() {
    if (!this.playing) return;
    this.playing = false; cancelAnimationFrame(this._loopRaf);
    this._paintTransport();
    this.refresh();                                                    // met les médias en pause sur l'image exacte
    if (this.opts.onTransport) this.opts.onTransport(false);
  }

  /** Déplacement de la tête de lecture (par l'utilisateur ou ⏮) : en lecture, l'horloge repart de là ; à l'arrêt, l'image est recomposée. */
  seek(t) {
    this.tl.setPlayhead(Math.max(0, t), true);
    if (this.opts.onSeekDone) this.opts.onSeekDone();
    this.userSeek();
  }
  userSeek() {
    if (this.playing) { this._t0 = this.tl.playhead; this._w0 = performance.now(); } else this.refresh();
    this._paintTime();
  }

  _loop(now) {
    if (!this.playing) return;
    const ch = this.gov.push(now - this._last); this._last = now;
    if (ch !== null) this.setLite(ch, true);
    let t = this._t0 + (now - this._w0) / 1000;
    const end = this.duration;
    if (t >= end) { t = end; this.tl.setPlayhead(t, true); this._frame(t); this.pause(); return; }
    this.tl.setPlayhead(t, true);
    this._follow(t);
    this._frame(t);
    this._loopRaf = requestAnimationFrame((n) => this._loop(n));
  }

  /** Tourne la timeline quand la tête de lecture atteint le bord droit (pas par pas, jamais pendant que l'utilisateur la tient). */
  _follow(t) {
    const tl = this.tl, x = tl.xOf(t);
    if (tl.op && tl.op.type !== "gesture") return;
    if (x > tl.W - 28 || x < tl.headerW) { tl.view.scrollX = Math.max(0, t * tl.view.pps - (tl.W - tl.headerW) * 0.25); tl.clampView(); }
  }

  setLite(on, auto = false) {
    if (this.lite === on) return;
    this.lite = on; this.ui.lite.hidden = !on;
    this.ui.lite.title = auto ? "Aperçu allégé automatiquement pour rester fluide : l'export garde tous les effets" : "Aperçu allégé";
    this.requestRender();
  }

  // ------------------------------------------------------------------ synchronisation des médias + composition
  _layers(t) { return layersAt(this.tl.project, t, { lite: this.lite, hasAudio: this.opts.hasAudio }); }

  _frame(t) {
    const t0 = performance.now(), L = this._layers(t);
    this._sync(L, t, this.playing);
    this._draw(L);
    this._paintTime();
    const s = this.stats; s.frames++; s.lastMs = performance.now() - t0; s.totalMs += s.lastMs;
  }

  /** Recompose l'image à la tête de lecture (à l'arrêt) : à appeler après toute modification du projet ou déplacement. */
  refresh() { if (this.playing) return; cancelAnimationFrame(this._raf); this._raf = requestAnimationFrame(() => { this._raf = 0; if (!this.playing) this._frame(this.tl.playhead); }); }
  requestRender() { this.refresh(); }

  _media(clip) {
    let m = this.pool.get(clip.id);
    if (m) { m.used = performance.now(); return m; }
    const a = this.opts.asset && this.opts.asset(clip.asset);
    if (!a || !a.url) return null;
    const el = document.createElement(clip.kind === "audio" ? "audio" : "video");
    el.preload = "auto"; el.playsInline = true; el.setAttribute("playsinline", ""); el.crossOrigin = "anonymous";
    for (const ev of ["seeked", "loadeddata", "canplay"]) el.addEventListener(ev, () => { if (!this.playing) this.requestRender(); });
    el.src = a.url; this.host.append(el);
    m = { el, used: performance.now(), clip: clip.id };
    this.pool.set(clip.id, m);
    this._evict();
    return m;
  }

  _evict() {
    if (this.pool.size <= MAX_POOL) return;
    const live = new Set(this.tl.project.clips.map((c) => c.id));
    for (const [id, m] of [...this.pool].sort((a, b) => a[1].used - b[1].used)) {
      if (this.pool.size <= MAX_POOL) break;
      if (live.has(id) && performance.now() - m.used < 1000) continue;
      this._release(id);
    }
  }
  _release(id) { const m = this.pool.get(id); if (!m) return; m.el.pause(); m.el.removeAttribute("src"); m.el.load(); m.el.remove(); this.pool.delete(id); }

  _sync(L, t, playing) {
    const want = new Map();
    for (const v of L.video) if (v.clip.kind === "video") want.set(v.clip.id, { clip: v.clip, src: v.srcTime, vol: 0 });
    for (const a of L.audio) { const w = want.get(a.clip.id); if (w) w.vol = a.vol; else want.set(a.clip.id, { clip: a.clip, src: a.srcTime, vol: a.vol }); }
    const frame = 0.5 / this.fps;
    for (const w of want.values()) {
      const m = this._media(w.clip);
      if (!m) continue;
      const el = m.el, max = Math.max(0, (el.duration || w.clip.in + w.clip.dur) - 0.02), target = Math.min(max, Math.max(0, w.src));
      el.volume = Math.min(1, Math.max(0, w.vol)); el.muted = w.vol <= 0.001;
      if (playing) {
        if (el.paused) { if (Math.abs(el.currentTime - target) > 0.04) el.currentTime = target; const p = el.play(); if (p && p.catch) p.catch(() => {}); }
        else if (Math.abs(el.currentTime - target) > DRIFT) el.currentTime = target;
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - target) > frame) el.currentTime = target;
      }
    }
    for (const [id, m] of this.pool) {                                 // clips hors champ : en pause ; ceux qui démarrent bientôt sont préparés sur leur premier point
      if (want.has(id)) continue;
      if (!m.el.paused) m.el.pause();
    }
    this._prepare(t, want);
  }

  _prepare(t, want) {
    for (const c of this.tl.project.clips) {
      if (want.has(c.id) || c.kind === "image" || c.start < t || c.start > t + AHEAD) continue;
      const m = this._media(c);
      if (m && m.el.paused && Math.abs(m.el.currentTime - c.in) > 0.05) m.el.currentTime = c.in;
    }
  }

  _image(asset) {
    let im = this.images.get(asset.id);
    if (!im) { im = new Image(); im.onload = () => this.requestRender(); im.src = asset.url; this.images.set(asset.id, im); }
    return im.complete && im.naturalWidth ? im : null;
  }

  _draw(L) {
    const ctx = this.ctx, W = this.ui.canvas.width, H = this.ui.canvas.height;
    ctx.globalAlpha = 1; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    for (const v of L.video) {
      if (v.alpha <= 0.002) continue;
      let src, iw, ih;
      if (v.clip.kind === "image") {
        const a = this.opts.asset && this.opts.asset(v.clip.asset), im = a && this._image(a);
        if (!im) continue;
        src = im; iw = im.naturalWidth; ih = im.naturalHeight;
      } else {
        const m = this.pool.get(v.clip.id), el = m && m.el;
        if (!el || el.readyState < 2 || !el.videoWidth) continue;
        src = el; iw = el.videoWidth; ih = el.videoHeight;
      }
      const fit = Math.min(W / iw, H / ih) * v.scale, dw = iw * fit, dh = ih * fit;
      ctx.globalAlpha = v.alpha;
      ctx.drawImage(src, (W - dw) / 2 + v.x * W, (H - dh) / 2 + v.y * H, dw, dh);   // même géométrie que le moteur : tient dans l'image, puis échelle, puis décalage en fraction de l'image
    }
    ctx.globalAlpha = 1;
    this.stats.drawn++;
  }

  // ------------------------------------------------------------------ interface
  _paintTransport() {
    const b = this.ui.play;
    b.textContent = this.playing ? "⏸" : "▶"; b.setAttribute("aria-label", this.playing ? "Pause" : "Lecture"); b.setAttribute("aria-pressed", String(this.playing));
    if (this.opts.onTransport && this.playing) this.opts.onTransport(true);
  }
  _paintTime() {
    this.ui.time.textContent = `${core.formatTime(this.tl.playhead, this.fps)} / ${core.formatTime(this.duration, this.fps)}`;
  }

  destroy() { this.pause(); cancelAnimationFrame(this._raf); if (this._ro) this._ro.disconnect(); for (const id of [...this.pool.keys()]) this._release(id); this.host.remove(); }
}
