// Générateur de captures d'écran synthétiques (tests de reconnaissance) : plateau + pièces SVG/PNG + surbrillances + coordonnées + interface autour.
window.SYNTH = (() => {
  const FILES = "abcdefgh";
  const THEMES = {
    green: { l: "#eeeed2", d: "#769656", hl: ["#f6f669", "#baca2b"], bg: "#2b2926" },
    brown: { l: "#f0d9b5", d: "#b58863", hl: ["#cdd26a", "#aaa23a"], bg: "#161512" },
    blue: { l: "#dee3e6", d: "#8ca2ad", hl: ["#a4cf9a", "#7fa76f"], bg: "#1f2a33" },
    gray: { l: "#d9d9d9", d: "#8a8a8a", hl: ["#e6e08a", "#b5b060"], bg: "#202020" },
    wood: { l: "#e8c999", d: "#a9743d", hl: ["#d8d26a", "#a9a43a"], bg: "#111111", noise: 10 },
    purple: { l: "#e4dff0", d: "#8877b2", hl: ["#cfd27a", "#a3a74e"], bg: "#181422" },
  };
  const load = async (mime, b64) => { const im = new Image(); im.src = "data:" + mime + ";base64," + b64; await im.decode(); return im; };
  const rnd = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  // positions : parties aléatoires légales
  const positions = (n, seed) => {
    const R = rnd(seed), out = [];
    for (let i = 0; i < n; i++) {
      const ch = new Chess(), plies = 16 + Math.floor(R() * 50);
      for (let p = 0; p < plies && !ch.game_over(); p++) { const mv = ch.moves(); ch.move(mv[Math.floor(R() * mv.length)]); }
      out.push(ch.fen());
    }
    return out;
  };
  /** opts: {pieces:{P,N,B,R,Q,K,p,n,b,r,q,k -> Image}, theme, s, flipped, fen, seed, last:[from,to], dots, coords, ui} -> {canvas, truth:{sq:piece}} */
  const render = (o) => {
    const T = THEMES[o.theme], s = o.s, R = rnd(o.seed || 1), W = Math.round(s * 8 + s * 3 + 40), H = Math.round(s * 8 + 120);
    const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
    x.fillStyle = T.bg; x.fillRect(0, 0, W, H);
    if (o.ui !== false) { x.fillStyle = "#3a3835"; x.fillRect(0, 0, W, 50); x.fillStyle = "#555"; x.fillRect(W - s * 3 + 10, 70, s * 3 - 30, H - 100); x.fillStyle = "#81b64c"; x.fillRect(W - s * 3 + 20, H - 70, s * 2, 30); }
    const bx = 20, by = 60;
    const ch = new Chess(o.fen), truth = {};
    ch.board().forEach((row, r) => row.forEach((p, f) => { if (p) truth[FILES[f] + (8 - r)] = p.color === "w" ? p.type.toUpperCase() : p.type; }));
    for (let r = 0; r < 8; r++) for (let cc = 0; cc < 8; cc++) {
      const sqName = o.flipped ? FILES[7 - cc] + (r + 1) : FILES[cc] + (8 - r);
      const light = (r + cc) % 2 === 0;
      let col = light ? T.l : T.d;
      if (o.last && o.last.includes(sqName)) col = T.hl[light ? 0 : 1];
      x.fillStyle = col; x.fillRect(bx + cc * s, by + r * s, Math.ceil(s), Math.ceil(s));
      if (T.noise) { const id = x.getImageData(bx + cc * s | 0, by + r * s | 0, s | 0, s | 0); for (let i = 0; i < id.data.length; i += 4) { const n = (R() - 0.5) * T.noise * 2; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; } x.putImageData(id, bx + cc * s | 0, by + r * s | 0); }
      if (o.coords !== false) { x.font = `bold ${Math.round(s * 0.2)}px sans-serif`; x.fillStyle = light ? T.d : T.l; if (cc === 0) x.fillText(sqName[1], bx + cc * s + 2, by + r * s + s * 0.2); if (r === 7) x.fillText(sqName[0], bx + (cc + 1) * s - s * 0.2, by + (r + 1) * s - 3); }
    }
    for (let r = 0; r < 8; r++) for (let cc = 0; cc < 8; cc++) {
      const sqName = o.flipped ? FILES[7 - cc] + (r + 1) : FILES[cc] + (8 - r), p = truth[sqName];
      if (p) { const im = o.pieces[p]; x.drawImage(im, bx + cc * s, by + r * s, s, s); }
      else if (o.dots && R() < 0.08) { x.fillStyle = "rgba(0,0,0,0.16)"; x.beginPath(); x.arc(bx + (cc + 0.5) * s, by + (r + 0.5) * s, s * 0.17, 0, 7); x.fill(); }
    }
    if (o.jpeg) { const u = c.toDataURL("image/jpeg", o.jpeg); return { canvas: c, truth, jpeg: u }; }
    return { canvas: c, truth };
  };
  return { THEMES, load, positions, render };
})();
