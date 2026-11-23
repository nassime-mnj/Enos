"use strict";
// THE SITE IS AN ABANDONED MACHINE THAT IS STILL RUNNING.
// Nobody operates it any more, yet its two swarms keep obeying orders:
//   - the CYAN pulse builds: each block is first traced as a wireframe, then filled row by row by flying pixels while the real content
//     is revealed behind the welding front;
//   - the ORANGE pulse recycles: blocks left far behind are dismantled and their material goes back to the pool. The material is FINITE
//     (one fixed pool of pixels for the whole page): what is torn down up there is what builds down here.
//   - tap a built block (outside links / buttons): orange pixels are torn off and leave a hole, cyan pixels come back to weld it shut;
//   - a heartbeat (ECG) runs under the header, cyan + orange, faster when you scroll fast, slower when you stop; idle, the machines keep
//     doing maintenance on their own;
//   - work orders scroll in a small terminal; at the end, the free pixels assemble the studio name, which beats with the pulse.
// The content is real HTML (readable without JavaScript, for search engines and screen readers). Reduced motion: nothing moves, everything shows.
(() => {
  const D = document, root = D.documentElement;
  if (!window.requestAnimationFrame || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
  const SEL = "[data-build], .reveal, .sec-h, .hero-in > *:not(.pulses), .access-in, .center > .btn, .hero .cue";
  const A = [25, 230, 255], B = [255, 122, 26];
  const cv = D.createElement("canvas"); cv.className = "asm-fx"; cv.setAttribute("aria-hidden", "true"); D.body.appendChild(cv);
  const g = cv.getContext("2d");
  const term = D.createElement("div"); term.className = "asm-term"; term.setAttribute("aria-hidden", "true"); D.body.appendChild(term);
  root.classList.add("asm");

  let W = 0, H = 0, dpr = 1, sy = window.scrollY, lastSy = sy, vel = 0, bpm = 62, beatPh = 0, lastInput = performance.now(), order = 400 + Math.floor(Math.random() * 300);
  const small = () => W < 720;
  const POOL = () => (small() ? 520 : 900);
  const px = [];                                                   // all pixels: {x, y (document coords), tx, ty, st: free|fly|set|shard, c, job, t, d}
  const jobs = new Set(), blocks = [];
  const rnd = (a, b) => a + Math.random() * (b - a), clamp = (v, a, b) => Math.max(a, Math.min(b, v)), ease = (k) => 1 - Math.pow(1 - clamp(k, 0, 1), 3);

  // ------------------------------------------------------------------ terminal (work orders)
  const lines = [];
  function log(txt, cls) { const l = D.createElement("p"); l.textContent = txt; if (cls) l.className = cls; term.appendChild(l); lines.push(l); while (lines.length > 5) lines.shift().remove(); }
  const label = (el) => { const h = el.matches("h1,h2,h3") ? el : el.querySelector("h1,h2,h3,summary,b"); const t = (el.dataset.build || (h ? h.textContent : el.textContent) || "").replace(/\s+/g, " ").trim(); return t.length > 28 ? t.slice(0, 27) + "…" : t || "block"; };

  // ------------------------------------------------------------------ pool
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    while (px.length < POOL()) px.push(freePixel({}));
  }
  function freePixel(p) {                                           // free material drifts along the screen edges, near the visitor
    const side = Math.random() < 0.5 ? 0 : 1;
    return Object.assign(p, { st: "free", x: side ? rnd(W - 26, W - 4) : rnd(4, 26), y: sy + rnd(0, H), vx: 0, vy: rnd(-12, 12), c: Math.random() < 0.6 ? A : B, a: rnd(0.15, 0.45), job: null, s: 2 });
  }
  const takeFree = (n, nearY) => { const f = px.filter((p) => p.st === "free"); f.sort((a, b) => Math.abs(a.y - nearY) - Math.abs(b.y - nearY)); return f.slice(0, n); };

  // ------------------------------------------------------------------ blocks
  function scan() {
    D.querySelectorAll(SEL).forEach((el) => { if (el.__asm || el.closest(".chat,.top nav")) return; if (el.parentElement && el.parentElement.closest("[data-asm]")) return;
      el.__asm = { state: "raw", holes: [] }; el.setAttribute("data-asm", "raw"); el.classList.add("in"); blocks.push(el); });
  }
  function docRect(el) { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top + sy, w: r.width, h: r.height }; }
  function build(el, quick) {
    const s = el.__asm; if (s.state !== "raw") return;
    const r = docRect(el); if (r.w < 4 || r.h < 4) { s.state = "built"; el.setAttribute("data-asm", "built"); return; }
    const n = clamp(Math.round((r.w * r.h) / (small() ? 900 : 1300)), 14, small() ? 56 : 120), step = Math.sqrt((r.w * r.h) / n), cols = Math.max(1, Math.round(r.w / step)), rows = Math.max(1, Math.round(r.h / step));
    const targets = []; for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) targets.push({ x: r.x + (i + 0.5) * (r.w / cols) + rnd(-2, 2), y: r.y + (j + 0.5) * (r.h / rows) + rnd(-2, 2), row: j });
    const job = { el, r, rows, targets, done: 0, t0: performance.now(), wire: quick ? 0.12 : 0.38, dur: quick ? 0.45 : 0.75 + rows * 0.03, size: clamp(step * 0.42, 2.5, 7), pixels: [] };
    s.state = "building"; el.setAttribute("data-asm", "building"); el.style.clipPath = "inset(0 0 100% 0)"; jobs.add(job);
    if (!quick) log(`ORDER #${String(order++).padStart(4, "0")} · ASSEMBLE “${label(el)}” · OPERATOR: NONE FOUND · PROCEEDING`);
    claim(job);
  }
  function claim(job) {                                             // finite material: a job only gets the pixels that are free right now; the rest arrives later
    const need = job.targets.length - job.pixels.length; if (need <= 0) return;
    const got = takeFree(need, job.r.y);
    got.forEach((p, k) => { const t = job.targets[job.pixels.length]; job.pixels.push(p);
      Object.assign(p, { st: "fly", job, ox: p.x, oy: p.y, tx: t.x, ty: t.y, t: 0, d: job.wire + (t.row / job.rows) * job.dur * 0.8 + rnd(0, 0.12), c: A, a: 1, s: job.size }); });
    if (got.length < need && !job.low) { job.low = true; log("MATERIAL LOW · RECLAIMING FROM ABANDONED BLOCKS", "warn"); reclaim(need - got.length); }
  }
  function reclaim(n) {                                             // ORANGE pulse: dismantle built blocks far away from the visitor to free their material
    const far = blocks.filter((el) => el.__asm.state === "built").map((el) => ({ el, d: Math.abs(docRect(el).y - sy - H / 2) })).filter((x) => x.d > H * 2.2).sort((a, b) => b.d - a.d);
    for (const { el } of far) { if (n <= 0) break; dismantle(el); n -= 40; }
  }
  function dismantle(el) {
    const s = el.__asm; s.state = "raw"; el.setAttribute("data-asm", "raw"); el.style.clipPath = "inset(0 0 100% 0)"; s.holes = []; applyHoles(el);
    log(`ORDER #${String(order++).padStart(4, "0")} · RECYCLE “${label(el)}” · NO VIEWER IN RANGE`, "b");
  }
  function finishJob(job) {
    jobs.delete(job); const el = job.el; el.__asm.state = "built"; el.setAttribute("data-asm", "built"); el.style.clipPath = "";
    job.pixels.forEach((p) => { p.st = "set"; p.t = 0; p.c = A; });
    setTimeout(() => job.pixels.forEach((p) => { if (p.st === "set" && p.job === job) freePixel(p); }), 420);
  }

  // ------------------------------------------------------------------ damage + repair (tap a block)
  function applyHoles(el) {
    const h = el.__asm.holes.filter((x) => x.r > 0.6);
    if (!h.length) { el.style.webkitMaskImage = el.style.maskImage = ""; return; }
    const m = h.map((x) => `radial-gradient(circle at ${x.x.toFixed(0)}px ${x.y.toFixed(0)}px, transparent ${x.r.toFixed(1)}px, #000 ${(x.r + 1.5).toFixed(1)}px)`).join(",");
    el.style.webkitMaskImage = el.style.maskImage = m; el.style.webkitMaskComposite = "source-in"; el.style.maskComposite = "intersect";
  }
  D.addEventListener("click", (e) => {
    if (e.target.closest("a,button,summary,input,textarea,label,video,.chat,.top")) return;
    const el = e.target.closest("[data-asm='built']"); if (!el) return;
    const r = el.getBoundingClientRect(), hx = e.clientX - r.left, hy = e.clientY - r.top, hole = { x: hx, y: hy, r: small() ? 26 : 34, born: performance.now() };
    el.__asm.holes.push(hole); if (el.__asm.holes.length > 4) el.__asm.holes.shift(); applyHoles(el);
    const shards = takeFree(26, e.clientY + sy);
    shards.forEach((p) => { const a = rnd(0, 6.283), v = rnd(120, 360); Object.assign(p, { st: "shard", x: e.clientX + rnd(-hole.r, hole.r) * 0.6, y: e.clientY + sy + rnd(-hole.r, hole.r) * 0.6, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, c: B, a: 1, s: rnd(2.5, 5), t: 0, el, hole, hx: e.clientX, hy: e.clientY + sy }); });
    log(`DAMAGE DETECTED ON “${label(el)}” · DISPATCHING REPAIR`, "b"); pulseKick(14);
  });

  // ------------------------------------------------------------------ the pulse
  const ecg = [];
  function pulseKick(n) { bpm = Math.min(150, bpm + n); }
  function beatShape(ph) { // one heartbeat (0..1) -> amplitude
    if (ph < 0.06) return Math.sin((ph / 0.06) * Math.PI) * 0.18; if (ph < 0.1) return -0.15; if (ph < 0.14) return 1; if (ph < 0.18) return -0.55; if (ph < 0.32) return Math.sin(((ph - 0.18) / 0.14) * Math.PI) * 0.22; return 0;
  }

  // ------------------------------------------------------------------ final formation: the free pixels write the studio name
  let form = null;
  // 5x7 pixel font (hand-drawn, same on every device): the studio name is spelled like the game's own pixel art
  const FONT = { A: "01110100011000111111100011000110001", B: "11110100011000111110100011000111110", C: "01110100011000010000100001000101110", D: "11110100011000110001100011000111110",
    E: "11111100001000011110100001000011111", F: "11111100001000011110100001000010000", G: "01110100011000010111100011000101111", H: "10001100011000111111100011000110001",
    I: "01110001000010000100001000010001110", J: "00111000100001000010000101001001100", K: "10001100101010011000101001001010001", L: "10000100001000010000100001000011111",
    M: "10001110111010110101100011000110001", N: "10001100011100110101100111000110001", O: "01110100011000110001100011000101110", P: "11110100011000111110100001000010000",
    Q: "01110100011000110001101011001001101", R: "11110100011000111110101001001010001", S: "01111100001000001110000010000111110", T: "11111001000010000100001000010000100",
    U: "10001100011000110001100011000101110", V: "10001100011000110001100010101000100", W: "10001100011000110101101011010101010", X: "10001100010101000100010101000110001",
    Y: "10001100010101000100001000010000100", Z: "11111000010001000100010001000011111", " ": "00000000000000000000000000000000000" };
  function formationPoints(text, w, maxPts) {
    const chars = [...text.toUpperCase()].map((ch) => FONT[ch] || FONT[" "]), cols = chars.length * 6 - 1, lit = chars.reduce((a, c) => a + [...c].filter((b) => b === "1").length, 0);
    const cell = Math.min(w / cols, 26), sub = lit * 4 <= maxPts && cell >= 14 ? 2 : 1, step = cell / sub, pts = [];
    chars.forEach((c, k) => { for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) if (c[r * 5 + q] === "1") for (let a = 0; a < sub; a++) for (let b = 0; b < sub; b++) pts.push({ x: (k * 6 + q) * cell + (a + 0.5) * step, y: r * cell + (b + 0.5) * step }); });
    return { pts: pts.slice(0, maxPts), w: cols * cell, h: 7 * cell, step };
  }
  function checkFormation() {
    const host = D.querySelector("[data-formation]"); if (!host) return;
    const r = host.getBoundingClientRect(), vis = r.top < H * 0.75 && r.bottom > H * 0.25;
    if (vis && !form) {
      const F = formationPoints(host.dataset.formation, Math.min(W * 0.94, 1000), Math.round(POOL() * 0.62)), ox = (W - F.w) / 2, oy = r.top + sy + (r.height - F.h) / 2;
      form = { host, F, ox, oy, list: [] }; host.classList.add("asm-formed"); log("ALL ORDERS COMPLETE · SIGNING THE WORK", "a");
    } else if (!vis && form) { form.list.forEach((p) => { if (p.st === "form") freePixel(p); }); form.host.classList.remove("asm-formed"); form = null; }
    if (form && form.list.length < form.F.pts.length) {                // the name takes the material as it is freed (letters by letters, left to right)
      const F = form.F, got = takeFree(Math.min(36, F.pts.length - form.list.length), form.oy);
      got.forEach((p) => { const k = form.list.length, t = F.pts[k]; Object.assign(p, { st: "form", ox: p.x, oy: p.y, tx: form.ox + t.x, ty: form.oy + t.y, t: 0, d: rnd(0, 0.25), c: t.x < F.w / 2 ? A : B, a: 1, s: Math.max(2.5, F.step * 0.82) }); form.list.push(p); });
    }
  }

  // ------------------------------------------------------------------ main loop
  let last = performance.now(), idleSaid = false;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    sy = window.scrollY; vel = vel * 0.9 + Math.abs(sy - lastSy) / Math.max(dt, 0.001) * 0.1; lastSy = sy;
    if (vel > 400) { bpm = Math.min(150, bpm + dt * vel * 0.02); lastInput = now; idleSaid = false; }
    bpm += (62 - bpm) * dt * 0.25; beatPh += dt * bpm / 60; const ph = beatPh % 1, beat = beatShape(ph);
    if (now - lastInput > 9000 && !idleSaid) { idleSaid = true; log("NO INPUT · OPERATOR LOST · CONTINUING MAINTENANCE", "muted"); }

    // blocks entering the view get built; blocks far behind get recycled when material runs low
    for (const el of blocks) { const s = el.__asm; if (s.state !== "raw") continue; const r = el.getBoundingClientRect(); if (r.top < H * 0.92 && r.bottom > -40) build(el, s.seen); s.seen = s.seen || r.top < H; }
    for (const job of jobs) { if (job.pixels.length < job.targets.length) claim(job); }
    checkFormation();

    g.clearRect(0, 0, W, H);
    // wireframes (blueprint phase)
    g.lineWidth = 1;
    for (const job of jobs) { const k = clamp((now - job.t0) / 1000 / Math.max(0.05, job.wire), 0, 1), r = job.r, y = r.y - sy, per = 2 * (r.w + r.h), len = per * ease(k);
      g.strokeStyle = `rgba(${A},${0.7 * (1 - clamp((now - job.t0) / 1000 - job.wire - job.dur, 0, 1))})`; g.setLineDash([5, 4]); g.beginPath();
      let rem = len; const seg = [[r.x, y, r.x + r.w, y], [r.x + r.w, y, r.x + r.w, y + r.h], [r.x + r.w, y + r.h, r.x, y + r.h], [r.x, y + r.h, r.x, y]];
      for (const [x1, y1, x2, y2] of seg) { const L = Math.hypot(x2 - x1, y2 - y1), f = clamp(rem / L, 0, 1); if (f <= 0) break; g.moveTo(x1, y1); g.lineTo(x1 + (x2 - x1) * f, y1 + (y2 - y1) * f); rem -= L; }
      g.stroke(); g.setLineDash([]);
      // reveal behind the welding front (rows of arrived pixels)
      const arrived = job.pixels.filter((p) => p.st === "set" || (p.st === "fly" && p.t >= p.d + 0.35)).length, frac = job.targets.length ? arrived / job.targets.length : 1;
      job.el.style.clipPath = `inset(0 0 ${Math.max(0, 100 - frac * 104).toFixed(1)}% 0)`;
      if (arrived >= job.targets.length) finishJob(job);
    }
    // pixels
    g.globalCompositeOperation = "lighter";
    for (const p of px) {
      if (p.st === "free") { p.vy += rnd(-30, 30) * dt; p.vy *= 0.98; p.y += p.vy * dt; if (p.y < sy - 40 || p.y > sy + H + 40) { p.y = sy + rnd(0, H); } p.x += Math.sin(now / 900 + p.y) * 0.05; }
      else if (p.st === "fly" || p.st === "form") { p.t += dt; const k = ease((p.t - p.d) / 0.35); if (p.t < p.d) { p.x += (p.ox > W / 2 ? -1 : 1) * dt * 8; } else { p.x = p.ox + (p.tx - p.ox) * k + Math.sin(k * 3.14) * 18 * (p.ox > W / 2 ? -1 : 1); p.y = p.oy + (p.ty - p.oy) * k; } }
      else if (p.st === "set") { p.t += dt; p.a = 1 - p.t / 0.42; }
      else if (p.st === "shard") { p.t += dt;
        if (p.t < 0.55) { p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
        else { if (!p.back) { p.back = true; p.ox = p.x; p.oy = p.y; p.c = A; } const k = ease((p.t - 0.55) / 0.6); p.x = p.ox + (p.hx - p.ox) * k; p.y = p.oy + (p.hy - p.oy) * k;
          if (k >= 1) { const h = p.hole; if (h) { h.r = Math.max(0, h.r - 1.6); if (p.el) applyHoles(p.el); } freePixel(p); continue; } } }
      const y = p.y - sy; if (y < -20 || y > H + 20) continue;
      const pulse = p.st === "form" ? 1 + beat * 0.5 : 1, s = p.s * pulse, al = p.st === "free" ? p.a * (0.6 + beat * 0.4) : p.a;
      g.fillStyle = `rgba(${p.c},${clamp(al, 0, 1).toFixed(3)})`; g.fillRect(p.x - s / 2, y - s / 2, s, s);
      if (p.st === "fly" && p.t > p.d && p.t < p.d + 0.38) { g.fillStyle = `rgba(${p.c},0.18)`; g.fillRect(p.x - s * 1.5, y - s * 1.5, s * 3, s * 3); }
    }
    g.globalCompositeOperation = "source-over";
    // the pulse (ECG) under the header
    const top = D.querySelector(".top,.bar"), hy = top ? Math.min(top.getBoundingClientRect().bottom, 90) : 64;
    ecg.push(beat); while (ecg.length > Math.ceil(W / 3)) ecg.shift();
    for (const [col, off, amp] of [[A, 0, 10], [B, 6, -7]]) { g.strokeStyle = `rgba(${col},0.75)`; g.lineWidth = 1.4; g.beginPath();
      ecg.forEach((v, i) => { const x = W - (ecg.length - i) * 3, yy = hy + 2 + off + v * amp; i ? g.lineTo(x, yy) : g.moveTo(x, yy); }); g.stroke(); }
    // repaired holes decay
    for (const el of blocks) { const hs = el.__asm.holes; if (hs.length && hs.some((h) => now - h.born > 2600 && h.r > 0)) { hs.forEach((h) => { if (now - h.born > 2600) h.r = Math.max(0, h.r - dt * 30); }); applyHoles(el); } }
    raf = requestAnimationFrame(frame);
  }
  let raf = 0;
  ["pointermove", "touchstart", "keydown", "wheel"].forEach((ev) => addEventListener(ev, () => { lastInput = performance.now(); idleSaid = false; }, { passive: true }));
  addEventListener("resize", () => { resize(); for (const job of [...jobs]) { job.pixels.forEach(freePixel); jobs.delete(job); job.el.__asm.state = "raw"; } });
  D.addEventListener("visibilitychange", () => { if (D.hidden) { cancelAnimationFrame(raf); raf = 0; } else if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } });
  resize(); scan(); log("BOOT · NO OPERATOR DETECTED", "muted"); log("RESUMING STANDING ORDERS", "muted");
  if (D.readyState === "complete") raf = requestAnimationFrame(frame); else addEventListener("load", () => { scan(); raf = requestAnimationFrame(frame); });
  window.__asm = { blocks, jobs, px, log };
})();
