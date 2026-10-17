"use strict";
// DUALITÉ E.N.O.S. / ETO : personnalité globale (le serveur fait foi, localStorage évite tout flash), transition cinématique entre les deux univers,
// visage d'ETO (eto_face.js) monté aux quatre endroits où vivait l'Œil, et liaison de ses expressions à l'état réel de l'application.
(() => {
  const KEY = "enos_persona";
  const get = () => { try { return localStorage.getItem(KEY) === "eto" ? "eto" : "enos"; } catch (e) { return "enos"; } };
  const store = (p) => { try { localStorage.setItem(KEY, p); } catch (e) {} };
  const root = document.documentElement;
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  let cur = get(), busy = false;

  const api = window.enosPersona = {
    current: () => cur,
    isEto: () => cur === "eto",
    name: () => (cur === "eto" ? "ETO" : "E.N.O.S."),
    async set(p, origin) {
      p = p === "eto" ? "eto" : "enos";
      if (p === cur || busy) return;
      const prev = cur;
      fetch("/api/settings/persona", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ persona: p }) })
        .then((r) => { if (!r.ok && r.status !== 403 && r.status !== 401) throw new Error(r.statusText); })
        .catch(() => { if (cur === p) swap(prev); });                 // le serveur n'a pas suivi : retour en arrière sans animation
      await transition(p, origin);
    },
    toggle(origin) { return api.set(cur === "eto" ? "enos" : "eto", origin); },
    // bascule INSTANTANÉE (sans la transition cinématique) : utilisée par le Choc des Titans à chaque changement de locuteur. sync = prévenir aussi le serveur (plateau Godot, widget).
    async quick(p, sync) {
      p = p === "eto" ? "eto" : "enos";
      if (p === cur) return;
      swap(p);
      flash(p);
      if (sync) { try { await fetch("/api/settings/persona", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ persona: p }) }); } catch (e) {} }
    },
    // ---- expressions d'ETO (sans effet en mode E.N.O.S.)
    emote(names, gap = 1400) { if (!names || !names.length || !window.EtoFace) return; names.forEach((n, i) => setTimeout(() => cur === "eto" && EtoFace.reactAll(n, 1900), i * gap)); },
    reply(r) { if (cur !== "eto" || !window.EtoFace) return; const t = EtoFace.fromTags(r && r.tags); api.emote(t || [EtoFace.guess(r && r.text)]); },
    rest(name) { window.__etoRest = name || "smile"; lastBase = ""; state(); },   // expression de repos (écoute, réflexion…) : la parole garde la priorité
    face: () => faces,
  };

  function flash(p) {                                               // éclair bref de 220 ms : le changement de camp se « sent » sans bloquer la voix
    if (reduced()) return;
    const v = document.createElement("div");
    v.style.cssText = `position:fixed;inset:0;z-index:2147482990;pointer-events:none;background:${p === "eto" ? "#fff" : "#1a0004"};opacity:.75;transition:opacity .22s ease-out`;
    document.body.appendChild(v);
    requestAnimationFrame(() => requestAnimationFrame(() => (v.style.opacity = "0")));
    setTimeout(() => v.remove(), 320);
  }

  // ---------------------------------------------------------------- libellés + thème
  function labels() {
    const n = api.name(), eto = cur === "eto";
    const set = (sel, txt) => { const el = document.querySelector(sel); if (el) el.textContent = txt; };
    set("#tag", eto ? "[ ETO // EN LIGNE ]" : "[ AI CORE // ONLINE ]");
    set("#df .tm-top h2 small", "AFFRONTEZ " + n);
    set("#cs .tm-top h2 small", "VOUS CONTRE " + n + " · STOCKFISH");
    set("#cs-mic", eto ? "🎤 PARLER À ETO" : "🎤 TRASH TALK");
    set("#dm .dm-top h2 small", (eto ? "ETO" : "E.N.O.S.") + " // INTERFACE VISUELLE");
    const dmi = document.getElementById("dm-inp"); if (dmi) dmi.placeholder = "Parlez à " + n + "…";
    document.title = n;
    document.querySelectorAll(".persona-sw button").forEach((b) => { const on = b.dataset.p === cur; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
    document.querySelectorAll(".persona-sw").forEach((sw) => { sw.dataset.on = cur; });
  }
  function swap(p) {                                                // changement instantané de l'état (le visuel est géré par transition())
    cur = p; store(p);
    if (window.enosTheme && window.enosTheme.refresh) window.enosTheme.refresh();
    root.dataset.persona = p;
    labels(); syncFaces();
    document.dispatchEvent(new CustomEvent("persona", { detail: { persona: p, name: api.name() } }));
  }

  // ---------------------------------------------------------------- visages
  const faces = [];
  const SLOTS = [["eto-avatar", "header"], ["eto-logo", "chat"], ["dm-eto", "dm"], ["cs-eye", "chess"]];
  function syncFaces() {
    if (!window.EtoFace) return;
    SLOTS.forEach(([id]) => {
      const el = document.getElementById(id); if (!el) return;
      const have = faces.find((f) => f.host === el);
      if (cur === "eto" && !have) faces.push(EtoFace.mount(el, { expression: "smile" }));
      if (cur !== "eto" && have) { have.destroy(); faces.splice(faces.indexOf(have), 1); }
    });
    if (cur === "eto") state();
  }
  // état réel de l'appli -> expression de fond (priorité : parole > réflexion > écoute > repos)
  let lastBase = "";
  function state() {
    if (cur !== "eto" || !window.EtoFace) return;
    const av = document.getElementById("avatar");
    const speaking = document.body.classList.contains("speaking"), thinking = av && av.classList.contains("is-thinking"), listening = av && av.classList.contains("is-listening");
    const base = speaking ? "speaking" : thinking ? "thinking" : listening ? "listening" : (window.__etoRest || "smile");
    EtoFace.speakingAll(speaking);
    if (base !== lastBase) { lastBase = base; faces.forEach((f) => f.set(base)); }
  }
  function watch() {
    const mo = new MutationObserver(state);
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    const av = document.getElementById("avatar"); if (av) mo.observe(av, { attributes: true, attributeFilter: ["class"] });
    const st = document.getElementById("dm-stage");                 // Mode discussion : l'état affiché pilote aussi le visage
    if (st) new MutationObserver(() => {
      if (cur !== "eto") return;
      const s = st.dataset.state;
      lastBase = "";
      if (s === "thinking" || s === "listening" || s === "speaking") { lastBase = s; faces.forEach((f) => f.set(s)); } else state();
    }).observe(st, { attributes: true, attributeFilter: ["data-state"] });
  }
  // repos / endormissement après un long silence : un petit détail vivant
  let idleT = 0;
  const wake = () => { clearTimeout(idleT); if (window.__etoRest === "sleepy") { window.__etoRest = "smile"; lastBase = ""; state(); EtoFace.reactAll("surprised", 900); } idleT = setTimeout(() => { if (cur === "eto") { window.__etoRest = "sleepy"; lastBase = ""; state(); } }, 180000); };
  ["pointerdown", "keydown"].forEach((e) => addEventListener(e, wake, { passive: true }));

  // ---------------------------------------------------------------- transition cinématique
  const bez = (x1, y1, x2, y2) => {                                  // cubic-bezier() identique à celui de CSS : l'anneau suit exactement le rideau
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const X = (t) => ((ax * t + bx) * t + cx) * t, Y = (t) => ((ay * t + by) * t + cy) * t, dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => { let t = x; for (let i = 0; i < 8; i++) { const e = X(t) - x; if (Math.abs(e) < 1e-5) break; const d = dX(t); if (Math.abs(d) < 1e-6) break; t -= e / d; } return Y(t); };
  };
  const EASE_IN = bez(0.55, 0, 0.12, 1), EASE_OUT = bez(0.7, 0, 0.3, 1);

  function chime(toEto) {                                           // accord discret (WebAudio) : cloche cristalline vers ETO, souffle grave vers E.N.O.S.
    try {
      const A = new (window.AudioContext || window.webkitAudioContext)(), t0 = A.currentTime, out = A.createGain(); out.gain.value = 0.55; out.connect(A.destination);
      const note = (f, at, dur, type, vol) => { const o = A.createOscillator(), g = A.createGain(); o.type = type; o.frequency.setValueAtTime(f, t0 + at); g.gain.setValueAtTime(0, t0 + at); g.gain.linearRampToValueAtTime(vol, t0 + at + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur); o.connect(g); g.connect(out); o.start(t0 + at); o.stop(t0 + at + dur + 0.05); };
      if (toEto) [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => note(f, i * 0.09, 1.3, "sine", 0.05));
      else { note(110, 0, 1.4, "sawtooth", 0.035); note(82.4, 0.1, 1.5, "sine", 0.07); note(55, 0.2, 1.6, "sine", 0.08); }
      setTimeout(() => A.close(), 2500);
    } catch (e) {}
  }

  function fxCanvas() {
    const c = document.createElement("canvas"); c.id = "persona-fx";
    const d = Math.min(2, devicePixelRatio || 1); c.width = innerWidth * d; c.height = innerHeight * d;
    c.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483000;pointer-events:none";
    document.body.appendChild(c); const g = c.getContext("2d"); g.scale(d, d); return { c, g };
  }

  async function transition(p, origin) {
    const toEto = p === "eto";
    const ox = origin && origin.x != null ? origin.x : innerWidth - 90, oy = origin && origin.y != null ? origin.y : 40;
    if (reduced()) { swap(p); return; }
    busy = true;
    const R = Math.hypot(Math.max(ox, innerWidth - ox), Math.max(oy, innerHeight - oy)) + 40, DUR = toEto ? 1500 : 1300;
    root.classList.add("persona-fx", toEto ? "fx-to-eto" : "fx-to-enos");
    const { c, g } = fxCanvas();
    chime(toEto);
    const sparks = [];
    const t0 = performance.now(), ease = toEto ? EASE_IN : EASE_OUT;
    const frame = (now) => {
      const k = clamp01((now - t0) / DUR), e = ease(k);
      const r = toEto ? e * R : (1 - e) * R;                          // vers ETO la lumière s'étend ; vers E.N.O.S. elle est aspirée vers le bouton
      g.clearRect(0, 0, innerWidth, innerHeight);
      if (r > 2) {
        const w = 60 + 40 * Math.sin(k * Math.PI);
        const ring = g.createRadialGradient(ox, oy, Math.max(0, r - w), ox, oy, r + w * 0.45);
        if (toEto) { ring.addColorStop(0, "rgba(255,255,255,0)"); ring.addColorStop(0.62, "rgba(190,215,255,.55)"); ring.addColorStop(0.82, "rgba(255,255,255,.95)"); ring.addColorStop(1, "rgba(120,170,255,0)"); }
        else { ring.addColorStop(0, "rgba(255,40,70,0)"); ring.addColorStop(0.55, "rgba(255,30,60,.6)"); ring.addColorStop(0.8, "rgba(255,200,205,.8)"); ring.addColorStop(1, "rgba(120,0,20,0)"); }
        g.fillStyle = ring; g.fillRect(0, 0, innerWidth, innerHeight);
        const n = toEto ? 5 : 4;                                       // particules nées sur l'anneau : lucioles lumineuses / braises
        for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2; sparks.push({ x: ox + Math.cos(a) * r, y: oy + Math.sin(a) * r, vx: (Math.random() - 0.5) * 30 + Math.cos(a) * (toEto ? 20 : -40), vy: (toEto ? -1 : 1) * (20 + Math.random() * 60), life: 0, max: 0.8 + Math.random() * 0.9, s: 1.5 + Math.random() * 3.5 }); }
      }
      if (k < 0.25) { const b = 1 - k / 0.25; g.fillStyle = toEto ? `rgba(255,255,255,${0.55 * b})` : `rgba(255,20,50,${0.35 * b})`; g.beginPath(); g.arc(ox, oy, 40 + (1 - b) * 220, 0, 7); g.fill(); }   // éclat au point de départ
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]; s.life += 0.016; if (s.life > s.max) { sparks.splice(i, 1); continue; }
        s.x += s.vx * 0.016; s.y += s.vy * 0.016; const a = 1 - s.life / s.max;
        const gr = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.s * 4); gr.addColorStop(0, toEto ? `rgba(255,255,255,${a})` : `rgba(255,120,120,${a})`); gr.addColorStop(1, toEto ? "rgba(140,185,255,0)" : "rgba(255,0,40,0)");
        g.fillStyle = gr; g.beginPath(); g.arc(s.x, s.y, s.s * 4, 0, 7); g.fill();
      }
      if (k < 1 || sparks.length) requestAnimationFrame(frame); else c.remove();
    };
    requestAnimationFrame(frame);
    const finish = () => { root.classList.remove("persona-fx", "fx-to-eto", "fx-to-enos"); busy = false; };
    if (document.startViewTransition) {
      const vt = document.startViewTransition(() => swap(p));
      try {
        await vt.ready;
        const clip = toEto ? [`circle(0px at ${ox}px ${oy}px)`, `circle(${R}px at ${ox}px ${oy}px)`] : [`circle(${R}px at ${ox}px ${oy}px)`, `circle(0px at ${ox}px ${oy}px)`];
        root.animate({ clipPath: clip }, { duration: DUR, easing: toEto ? "cubic-bezier(.55,0,.12,1)" : "cubic-bezier(.7,0,.3,1)", fill: "both", pseudoElement: toEto ? "::view-transition-new(root)" : "::view-transition-old(root)" });
        await vt.finished;
      } catch (e) { swap(p); }
    } else {                                                         // repli : voile qui s'étend puis se dissipe
      const veil = document.createElement("div"); veil.style.cssText = `position:fixed;inset:0;z-index:2147482990;pointer-events:none;background:${toEto ? "#fff" : "#050304"};opacity:0;transition:opacity .55s`;
      document.body.appendChild(veil); requestAnimationFrame(() => (veil.style.opacity = "1"));
      await sleep(600); swap(p); veil.style.opacity = "0"; await sleep(600); veil.remove();
    }
    await sleep(Math.max(0, DUR - (performance.now() - t0)) + 300);
    finish();
    if (toEto && window.EtoFace) { EtoFace.reactAll("joy", 1700); setTimeout(() => EtoFace.reactAll("warm", 1600), 1800); }
  }
  const clamp01 = (v) => Math.max(0, Math.min(1, v)), sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------- construction
  function build() {
    root.dataset.persona = cur;
    const html = `<div class="persona-sw" role="group" aria-label="Personnalité de l'IA" data-on="${cur}"><i class="thumb"></i><button type="button" data-p="enos" title="E.N.O.S. : l'antagoniste, grave et menaçant">E.N.O.S.</button><button type="button" data-p="eto" title="ETO : zen, calme et humain">ETO</button></div>`;
    document.querySelectorAll("[data-persona-slot]").forEach((slot) => { slot.innerHTML = html; });
    document.querySelectorAll(".persona-sw button").forEach((b) => { b.onclick = (ev) => { const r = b.getBoundingClientRect(); api.set(b.dataset.p, { x: r.left + r.width / 2, y: r.top + r.height / 2 }); }; });
    labels();
    const start = () => { syncFaces(); watch(); wake(); };
    window.EtoFace ? EtoFace.load().then(start) : start();
    fetch("/api/settings/persona").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && (j.persona === "eto" || j.persona === "enos") && j.persona !== cur) swap(j.persona); }).catch(() => {});
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", build) : build();
})();
