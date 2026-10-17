"use strict";
// Particules d'ambiance de la page d'accueil : braises cyan / orange qui montent lentement. Légères, mises en pause onglet masqué,
// désactivées (image fixe) si l'utilisateur demande moins d'animations.
(() => {
  const cv = document.getElementById("fx");
  if (!cv || !cv.getContext) return;
  const ctx = cv.getContext("2d");
  const still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const COLORS = ["25,230,255", "255,122,26", "255,255,255"];
  let w = 0, h = 0, dpr = 1, ps = [], raf = 0, last = 0;

  const rnd = (a, b) => a + Math.random() * (b - a);
  function spawn(fromBottom) {
    return { x: rnd(0, w), y: fromBottom ? h + rnd(0, 40) : rnd(0, h), r: rnd(0.6, 2.2), vy: rnd(8, 34), sway: rnd(0, 6.28), sp: rnd(0.2, 0.8),
      amp: rnd(6, 28), a: rnd(0.25, 0.85), c: COLORS[Math.random() < 0.46 ? 0 : Math.random() < 0.8 ? 1 : 2] };
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(110, Math.max(28, (w * h) / 15000)));
    ps = Array.from({ length: n }, () => spawn(false));
  }
  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    for (const p of ps) {
      const fade = Math.min(1, p.y / (h * 0.35), (h - p.y) / 60 + 0.2) ;               // s'éteignent en montant
      const x = p.x + Math.sin(t / 1000 * p.sp + p.sway) * p.amp;
      ctx.fillStyle = `rgba(${p.c},${(p.a * Math.max(0, fade) * 0.16).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(x, p.y, p.r * 4, 0, 6.2832); ctx.fill();                  // halo
      ctx.fillStyle = `rgba(${p.c},${(p.a * Math.max(0, fade)).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(x, p.y, p.r, 0, 6.2832); ctx.fill();                      // cœur
    }
  }
  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016); last = t;
    for (let i = 0; i < ps.length; i++) { const p = ps[i]; p.y -= p.vy * dt; if (p.y < -10) ps[i] = spawn(true); }
    draw(t);
    raf = requestAnimationFrame(frame);
  }
  function run() { if (!raf && !still) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function halt() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  resize();
  draw(0);
  window.addEventListener("resize", () => { resize(); draw(0); });
  document.addEventListener("visibilitychange", () => (document.hidden ? halt() : run()));
  run();
})();
