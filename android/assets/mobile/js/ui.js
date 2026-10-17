"use strict";
// Interactions au pouce : pager glissé (swipe), barre de navigation basse, appui long, feuilles du bas (bottom sheets), toasts, clavier, retour Android.
(() => {
  const E = window.ENOS, $ = E.$;
  const U = (E.ui = {});
  const TABS = ["home", "chat", "tools", "pc"];
  let index = 0, W = 360;

  // ------------------------------------------------------------------ pager + barre du bas
  const track = () => $("#track");
  const place = (px, animate) => { const t = track(); t.classList.toggle("drag", !animate); t.style.transform = `translate3d(${px}px,0,0)`; };
  U.go = (tab, opts) => {
    const i = typeof tab === "number" ? tab : TABS.indexOf(tab);
    if (i < 0) return;
    const changed = i !== index;
    index = i;
    E.state.tab = TABS[i];
    place(-index * W, true);
    E.$$("#tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === TABS[i]));
    $("#tab-ind").style.transform = `translateX(${index * 100}%)`;
    if (changed && !(opts && opts.silent)) E.vibrate(8);
    E.emit("tab", TABS[i]);
  };
  U.tab = () => TABS[index];
  const measure = () => { W = $("#pager").clientWidth || window.innerWidth; place(-index * W, false); };

  function swipe() {
    const pager = $("#pager");
    let sx = 0, sy = 0, dx = 0, mode = "", t0 = 0, down = false;
    pager.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1 || e.target.closest("input[type=range],.no-swipe,.sheet")) { down = false; return; }
      down = true; mode = ""; sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; t0 = Date.now();
    }, { passive: true });
    pager.addEventListener("touchmove", (e) => {
      if (!down) return;
      const x = e.touches[0].clientX - sx, y = e.touches[0].clientY - sy;
      if (!mode) { if (Math.abs(x) < 9 && Math.abs(y) < 9) return; mode = Math.abs(x) > Math.abs(y) * 1.25 ? "h" : "v"; }
      if (mode !== "h") return;
      dx = x;
      const edge = (index === 0 && x > 0) || (index === TABS.length - 1 && x < 0);
      place(-index * W + (edge ? x * 0.25 : x), false);                        // résistance élastique aux extrémités
    }, { passive: true });
    pager.addEventListener("touchend", () => {
      if (!down || mode !== "h") { down = false; return; }
      down = false;
      const v = Math.abs(dx) / Math.max(1, Date.now() - t0);                    // px/ms
      let to = index;
      if (dx < -W * 0.22 || (dx < -30 && v > 0.45)) to = Math.min(TABS.length - 1, index + 1);
      else if (dx > W * 0.22 || (dx > 30 && v > 0.45)) to = Math.max(0, index - 1);
      U.go(to);
    });
    pager.addEventListener("touchcancel", () => { down = false; U.go(index, { silent: true }); });
  }

  // ------------------------------------------------------------------ appui long (délégué) : handler(élément) ; le clic qui suit est supprimé
  U.longPress = (container, selector, handler) => {
    let timer = 0, sx = 0, sy = 0, target = null, fired = false;
    const cancel = () => { clearTimeout(timer); if (target) target.classList.remove("pressing"); target = null; };
    container.addEventListener("touchstart", (e) => {
      const el = e.target.closest(selector);
      if (!el || e.touches.length !== 1) return;
      target = el; fired = false; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      timer = setTimeout(() => { fired = true; el.classList.remove("pressing"); E.vibrate(22); handler(el); }, 480);
      setTimeout(() => { if (target === el && !fired) el.classList.add("pressing"); }, 120);
    }, { passive: true });
    container.addEventListener("touchmove", (e) => { if (target && (Math.abs(e.touches[0].clientX - sx) > 10 || Math.abs(e.touches[0].clientY - sy) > 10)) cancel(); }, { passive: true });
    container.addEventListener("touchend", () => { const f = fired; cancel(); if (f) container.dataset.lp = "1", setTimeout(() => delete container.dataset.lp, 400); });
    container.addEventListener("touchcancel", cancel);
    container.addEventListener("click", (e) => { if (container.dataset.lp) { e.stopPropagation(); e.preventDefault(); } }, true);
    container.addEventListener("contextmenu", (e) => { if (e.target.closest(selector)) e.preventDefault(); });
  };

  // ------------------------------------------------------------------ toasts
  U.toast = (msg, kind, ms) => {
    const t = document.createElement("div");
    t.className = "toast " + (kind || "");
    t.textContent = msg;
    $("#toasts").appendChild(t);
    while ($("#toasts").children.length > 3) $("#toasts").firstChild.remove();
    const kill = () => { t.classList.add("out"); setTimeout(() => t.remove(), 260); };
    t.onclick = kill;
    setTimeout(kill, ms || 4200);
  };

  // ------------------------------------------------------------------ feuilles du bas
  let onClose = null;
  U.sheet = (o) => {
    U.closeSheet(true);
    const s = $("#sheet");
    s.className = "sheet";
    s.innerHTML = `<div class="grab"></div>${o.title ? `<h2>${E.esc(o.title)}</h2>` : ""}${o.html || ""}${(o.options || []).map((x, i) => `<button class="opt ${x.cls || ""}" data-i="${i}">${E.esc(x.label)}</button>`).join("")}`;
    s.hidden = false; $("#scrim").hidden = false;
    onClose = o.onClose || null;
    s.querySelectorAll(".opt").forEach((b) => (b.onclick = () => { const x = o.options[+b.dataset.i]; U.closeSheet(); if (x.fn) x.fn(); }));
    $("#scrim").onclick = () => U.closeSheet();
    let y0 = 0, dy = 0, drag = false;                                           // glisser la poignée vers le bas pour fermer
    s.ontouchstart = (e) => { drag = s.scrollTop <= 0 && e.touches[0].clientY < s.getBoundingClientRect().top + 60; y0 = e.touches[0].clientY; dy = 0; };
    s.ontouchmove = (e) => { if (!drag) return; dy = Math.max(0, e.touches[0].clientY - y0); s.style.transform = `translateY(${dy}px)`; s.style.animation = "none"; };
    s.ontouchend = () => { if (!drag) return; drag = false; if (dy > 90) U.closeSheet(); else { s.style.transform = ""; s.style.animation = ""; } };
    if (o.onOpen) o.onOpen(s);
    return s;
  };
  U.closeSheet = (instant) => {
    const s = $("#sheet");
    if (s.hidden) return false;
    const done = () => { s.hidden = true; s.className = "sheet"; s.style.transform = ""; s.style.animation = ""; s.innerHTML = ""; $("#scrim").hidden = true; };
    if (instant) done(); else { s.classList.add("closing"); setTimeout(done, 200); }
    if (onClose) { const f = onClose; onClose = null; f(); }
    return true;
  };
  U.confirm = (title, text, okLabel, danger) => new Promise((res) => {
    let answered = false;
    U.sheet({ title, html: `<p class="muted" style="margin-bottom:14px">${E.esc(text)}</p>`, options: [
      { label: okLabel || "CONFIRMER", cls: danger ? "bad" : "", fn: () => { answered = true; res(true); } }, { label: "ANNULER", fn: () => { answered = true; res(false); } }],
      onClose: () => { if (!answered) res(false); } });
  });
  U.prompt = (title, placeholder, initial, okLabel) => new Promise((res) => {
    let answered = false;
    const s = U.sheet({ title, html: `<div class="f"><input type="text" id="sheet-in" placeholder="${E.esc(placeholder || "")}" value="${E.esc(initial || "")}" maxlength="120"></div>`, options: [
      { label: okLabel || "VALIDER", fn: () => { answered = true; res((E.$("#sheet-in") || {}).value || ""); } }, { label: "ANNULER", fn: () => { answered = true; res(null); } }],
      onClose: () => { if (!answered) res(null); } });
    const inp = s.querySelector("#sheet-in");
    setTimeout(() => inp && inp.focus(), 260);
    if (inp) inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); s.querySelector(".opt").click(); } };
  });

  // ------------------------------------------------------------------ clavier (la barre du bas s'efface) et bouton retour d'Android
  function keyboard() {
    let base = window.innerHeight;
    window.addEventListener("resize", () => {
      base = Math.max(base, window.innerHeight);
      $("#app").classList.toggle("keyboard-open", window.innerHeight < base * 0.78);
      measure();
    });
  }
  // Appelé par Java (onBackPressed) : true = événement consommé (sinon Java met l'application en arrière-plan)
  U.back = () => {
    if (U.closeSheet()) return true;
    if (E.codelab && E.codelab.back && E.codelab.back()) return true;
    const open = E.$$(".subview").find((x) => !x.hidden);
    if (open) { E.emit("tools-back"); return true; }
    if (index !== 0) { U.go(0); return true; }
    return false;
  };

  U.init = () => {
    measure();
    swipe(); keyboard();
    E.$$("#tabbar button").forEach((b) => (b.onclick = () => U.go(b.dataset.tab)));
    window.addEventListener("orientationchange", () => setTimeout(measure, 300));
    U.go(0, { silent: true });
  };
})();
