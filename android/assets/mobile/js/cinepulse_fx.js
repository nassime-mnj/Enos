"use strict";
// CINEPULSE MOBILE : effets d'un clip (flou gaussien, luminosité, contraste, saturation, teinte, sépia, noir & blanc, négatif, vignette) et préréglages.
// Une seule chaîne de filtre sert à l'aperçu (CSS filter sur la <video>, accéléré par le GPU) ET à l'export (ctx.filter du canvas) : ce que tu vois est ce que tu exportes.
(() => {
  const E = window.ENOS;
  const DEFAULT = { blur: 0, bright: 100, contrast: 100, sat: 100, hue: 0, sepia: 0, gray: 0, invert: 0, vig: 0 };
  const PRESETS = [
    ["Aucun", {}],
    ["Cinéma", { contrast: 118, sat: 88, bright: 96, vig: 45 }],
    ["Vintage", { sepia: 55, contrast: 108, bright: 104, sat: 85, vig: 55 }],
    ["Noir & blanc", { gray: 100, contrast: 120 }],
    ["Néon", { sat: 190, contrast: 125, hue: 15, bright: 105 }],
    ["Froid", { hue: 190, sat: 95, bright: 98, sepia: 15 }],
    ["Chaud", { sepia: 35, sat: 125, bright: 105, hue: 340 }],
    ["Rêve", { blur: 2.5, bright: 118, sat: 115, vig: 25 }],
    ["Flou fort", { blur: 10 }],
    ["Négatif", { invert: 100 }],
  ];
  const norm = (fx) => ({ ...DEFAULT, ...(fx || {}) });
  const isDefault = (fx) => { const f = norm(fx); return Object.keys(DEFAULT).every((k) => Math.abs(f[k] - DEFAULT[k]) < 1e-6); };
  // chaîne de filtre CSS / canvas ; scale : rapport de taille (export 1280 px / aperçu) pour que le flou ait le même rendu
  const css = (fx, scale) => {
    const f = norm(fx), s = scale || 1, p = [];
    if (f.blur > 0) p.push(`blur(${(f.blur * s).toFixed(2)}px)`);
    if (f.bright !== 100) p.push(`brightness(${f.bright}%)`);
    if (f.contrast !== 100) p.push(`contrast(${f.contrast}%)`);
    if (f.sat !== 100) p.push(`saturate(${f.sat}%)`);
    if (f.hue) p.push(`hue-rotate(${f.hue}deg)`);
    if (f.sepia) p.push(`sepia(${f.sepia}%)`);
    if (f.gray) p.push(`grayscale(${f.gray}%)`);
    if (f.invert) p.push(`invert(${f.invert}%)`);
    return p.length ? p.join(" ") : "none";
  };
  const vignette = (fx) => Math.max(0, Math.min(100, norm(fx).vig)) / 100;
  // vignette : dégradé radial qui assombrit les bords (même formule pour l'aperçu et le canvas d'export)
  const vignetteCss = (a) => `radial-gradient(ellipse at center, rgba(0,0,0,0) ${Math.round(62 - a * 20)}%, rgba(0,0,0,${(a * 0.9).toFixed(2)}) 100%)`;
  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
  E.cpfx = { DEFAULT, PRESETS, SPEEDS, norm, isDefault, css, vignette, vignetteCss };
})();
