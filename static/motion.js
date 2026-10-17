"use strict";
// MOUVEMENT E.N.O.S. : transitions animées entre TOUTES les fenêtres, sans modifier chaque module.
//
// Presque toutes les fenêtres d'ENOS (≈ 35 <section role="dialog">, modales, onglets internes) s'ouvrent et se ferment avec `el.hidden = false/true`.
// On enveloppe donc UNE FOIS la propriété `hidden` : quand l'élément est une fenêtre connue, l'ouverture joue une animation d'entrée (+ révélation en cascade
// du contenu), et la fermeture joue une animation de sortie AVANT de vraiment masquer l'élément. Le code des modules ne change pas : `el.hidden` continue
// de répondre « masqué » dès la fermeture demandée (les modules testent isOpen() = !el.hidden).
//
//   - scène  : <section role="dialog"> plein écran  -> glissement + fondu + balayage lumineux, contenu en cascade
//   - modale : fond sombre + boîte (dc-modal, og-modal…) -> fondu du fond, rebond de la boîte
//   - volet  : onglet interne ([data-p], [role=tabpanel])  -> fondu glissé à l'ouverture seulement
//   Niveau « Réduites » : fondus seulement. « Aucune » : rien n'est animé. Défaut : suit prefers-reduced-motion du système.
(() => {
  const root = document.documentElement;
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  const level = () => { const v = get("enos_motion", ""); return v === "full" || v === "reduced" || v === "off" ? v : mq.matches ? "reduced" : "full"; };
  const applyLevel = () => { root.dataset.motion = level(); };
  applyLevel();
  if (mq.addEventListener) mq.addEventListener("change", applyLevel);

  const proto = HTMLElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "hidden");
  const OVERLAY = 'section[role="dialog"], div[role="dialog"], .pw, .dc-modal, .og-modal';
  const PANE = 'div[data-p], section[data-p], [role="tabpanel"]';
  const ITEM = '.cb-card, .cb-modes, .sd-find, .sd-rec, .sd-kpi, .sd-wins, .sd-bar, .tm-card, .tm-top, .tm-tabs, .box, article, .btn, h2, h3, table, .card, [class*="-card"], [class$="-top"], fieldset';
  const CLEAN_MS = 1500;
  const closing = new WeakMap();                                  // élément -> { timer } pendant l'animation de sortie
  const itemTimers = new WeakMap();
  let sweepEl = null;

  const kind = (el) => {
    if (!el || !el.matches) return null;
    if (el.matches(OVERLAY)) return el.tagName === "SECTION" ? "scene" : "modal";
    return el.matches(PANE) ? "pane" : null;
  };
  const covers = (el) => { const r = el.getBoundingClientRect(); return r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9; };
  const strip = (el) => el.classList.remove("mo-in", "mo-out", "mo-scene", "mo-backdrop", "mo-pop", "mo-pane");

  // ------------------------------------------------------------------ balayage lumineux (changements de scène)
  function sweep(dir) {
    if (level() !== "full" || !document.body) return;
    if (!sweepEl) { sweepEl = document.createElement("div"); sweepEl.id = "mo-sweep"; sweepEl.setAttribute("aria-hidden", "true"); sweepEl.innerHTML = "<i></i>"; document.body.appendChild(sweepEl); }
    sweepEl.className = "";
    void sweepEl.offsetWidth;                                     // relance l'animation même si elle jouait déjà
    sweepEl.className = dir === "up" ? "go up" : "go";
    clearTimeout(sweep.t);
    sweep.t = setTimeout(() => { if (sweepEl) sweepEl.className = ""; }, 800);
  }

  // ------------------------------------------------------------------ révélation en cascade du contenu d'une fenêtre
  function clearItems(el) {
    const t = itemTimers.get(el);
    if (t) { clearTimeout(t); itemTimers.delete(el); }
    el.classList.remove("mo-draw");
    el.querySelectorAll(".mo-item").forEach((x) => { x.classList.remove("mo-item"); x.style.removeProperty("--mo-i"); });
  }
  function reveal(el, opts) {
    if (!el || level() !== "full") return;
    clearItems(el);
    const cands = [...el.querySelectorAll(ITEM)].filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight + 80; });
    const set = new Set(cands);
    let items = cands.filter((x) => { for (let p = x.parentElement; p && p !== el; p = p.parentElement) if (set.has(p)) return false; return true; });
    if (items.length < 3) items = [...el.children].filter((x) => x.getBoundingClientRect().height > 0);
    items = items.slice(0, (opts && opts.max) || 36);
    items.forEach((x, i) => { x.style.setProperty("--mo-i", i); x.classList.add("mo-item"); });
    el.classList.add("mo-draw");
    itemTimers.set(el, setTimeout(() => clearItems(el), CLEAN_MS + items.length * 36));
  }

  // ------------------------------------------------------------------ ouverture / fermeture animées
  function cancelClosing(el) {
    const c = closing.get(el);
    if (c) { clearTimeout(c.timer); closing.delete(el); }
  }
  function playIn(el, k) {
    cancelClosing(el);
    strip(el);
    const mode = k === "scene" ? "mo-scene" : k === "pane" ? "mo-pane" : covers(el) ? "mo-backdrop" : "mo-pop";
    el.dataset.moMode = mode;
    void el.offsetWidth;
    el.classList.add("mo-in", mode);
    if (k === "scene") sweep("down");
    if (k !== "pane") reveal(el);
    const done = (e) => { if (e && e.target !== el) return; el.removeEventListener("animationend", done); if (!closing.has(el)) strip(el); };
    el.addEventListener("animationend", done);
    setTimeout(() => { el.removeEventListener("animationend", done); if (!closing.has(el)) strip(el); }, 900);
  }
  function playOut(el, k) {
    const mode = el.dataset.moMode && el.classList.contains("mo-in") ? el.dataset.moMode : k === "scene" ? "mo-scene" : covers(el) ? "mo-backdrop" : "mo-pop";
    clearItems(el);
    strip(el);
    void el.offsetWidth;
    el.classList.add("mo-out", mode);
    if (k === "scene") sweep("up");
    const finish = () => { if (!closing.has(el)) return; closing.delete(el); desc.set.call(el, true); strip(el); };
    closing.set(el, { timer: setTimeout(finish, k === "scene" ? 300 : 230) });
  }

  if (desc && desc.set && desc.get) {
    Object.defineProperty(proto, "hidden", {
      configurable: true, enumerable: desc.enumerable,
      get() { return closing.has(this) || desc.get.call(this); },                // pendant la sortie, les modules voient déjà « masqué »
      set(v) {
        v = !!v;
        const k = kind(this);
        if (!k) { desc.set.call(this, v); return; }                              // élément ordinaire : comportement natif, aucun effet de bord
        if (!this.isConnected || level() === "off") { cancelClosing(this); strip(this); desc.set.call(this, v); return; }
        const hid = desc.get.call(this), isClosing = closing.has(this);
        if (v) {
          if (hid || isClosing) return;
          if (k === "pane") { desc.set.call(this, true); return; }               // les onglets internes changent sans délai : seule l'arrivée est animée
          playOut(this, k);
        } else {
          if (!hid && !isClosing) return;                                        // déjà visible : rien à animer
          desc.set.call(this, false);
          playIn(this, k);
        }
      },
    });
  }

  // ------------------------------------------------------------------ intro au démarrage
  function boot() {
    if (level() !== "full" || !document.body) return;
    let i = 0;
    document.querySelectorAll("#side .btn").forEach((b) => { if (b.getBoundingClientRect().height > 0) b.style.setProperty("--mo-i", i++); });
    root.classList.add("mo-boot");
    sweep("down");
    setTimeout(() => { root.classList.remove("mo-boot"); document.querySelectorAll("#side .btn").forEach((b) => b.style.removeProperty("--mo-i")); }, 2200);
  }

  // ------------------------------------------------------------------ messages du chat, clics, changement de thème
  function watchChat() {
    const log = document.getElementById("log");
    if (!log || !window.MutationObserver) return;
    new MutationObserver((ms) => {
      if (level() === "off") return;
      for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains("m")) { n.classList.add("mo-msg"); setTimeout(() => n.classList.remove("mo-msg"), 700); }
    }).observe(log, { childList: true });
  }
  document.addEventListener("pointerdown", (e) => {
    if (level() !== "full") return;
    const b = e.target.closest && e.target.closest(".btn");
    if (!b || b.disabled) return;
    b.classList.remove("mo-click"); void b.offsetWidth; b.classList.add("mo-click");
    setTimeout(() => b.classList.remove("mo-click"), 520);
  }, { passive: true });

  function wrapTheme() {
    const T = window.enosTheme;
    if (!T || T.__mo) return;
    const orig = T.setTheme;
    T.setTheme = function (id) {                                                 // fondu des couleurs : on garde l'appel synchrone (team.js relit current() juste après)
      if (level() !== "off") { root.classList.add("mo-theme"); clearTimeout(wrapTheme.t); wrapTheme.t = setTimeout(() => root.classList.remove("mo-theme"), 700); }
      return orig.apply(T, arguments);
    };
    T.__mo = true;
  }

  // ------------------------------------------------------------------ réglage « Animations » (Réglages)
  function syncSettings() {
    const lv = level();
    document.querySelectorAll("#rg-motion [data-motion]").forEach((b) => b.classList.toggle("on", b.dataset.motion === lv));
    const n = document.getElementById("rg-motion-note");
    if (n) n.textContent = lv === "full" ? "Transitions complètes : glissements, balayage lumineux, apparition en cascade." : lv === "reduced" ? "Fondus simples, sans mouvement (recommandé si vous êtes sensible aux animations)." : "Aucune animation de transition.";
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("#rg-motion [data-motion]");
    if (b) { put("enos_motion", b.dataset.motion); applyLevel(); syncSettings(); return; }
    if (e.target.closest && e.target.closest("#rg-motion-demo")) { sweep("down"); reveal(document.getElementById("rg")); }
  });

  window.enosMotion = { level, setLevel(v) { put("enos_motion", v); applyLevel(); syncSettings(); }, reveal, sweep, boot };

  const ready = () => { wrapTheme(); watchChat(); syncSettings(); requestAnimationFrame(boot); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready); else ready();
})();
