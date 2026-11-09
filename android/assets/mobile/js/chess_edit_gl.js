"use strict";
// CHESS EDIT — POST-PRODUCTION WEBGL (le « look » des chess edits pro : bloom HDR, assombrissement avec projecteur sur la pièce héros, déformation du plateau « drapeau », traînée de fumée turbulente,
// plateau en feu avec braises, profondeur de champ + vide final, aberration chromatique, niveaux de gris). Un SEUL fragment shader, piloté par des « pistes » calculées à partir de la timeline :
// tout est une fonction pure de t (aucun aléa non semé) → l'aperçu et l'export 60 FPS donnent exactement la même image.
// Branchement : Renderer.draw() appelle glPost(t) juste après le dessin du monde (plateau + pièces) et AVANT les textes / bandeaux (qui restent nets). Sans WebGL2 : on ne fait rien (rendu 2D d'origine).
(() => {
  const E = window.ENOS, RR = E.editRender;
  if (!RR || !RR.Renderer) return;
  const EASE = RR.EASE, clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, k) => a + (b - a) * k;

  const VS = `#version 300 es
in vec2 aP; void main(){ gl_Position = vec4(aP, 0.0, 1.0); }`;
  const FS = `#version 300 es
precision highp float;
uniform sampler2D uS; uniform vec2 uRes; uniform float uT;
uniform float uDim; uniform vec2 uSpot; uniform float uSpotR;
uniform float uWarp; uniform float uWarpAge;
uniform float uBloom; uniform float uBloomTh;
uniform float uSmoke; uniform vec4 uSmokeP; uniform vec4 uSmokeQ; uniform vec3 uSmokeCol;
uniform float uFire; uniform float uGray; uniform float uAber;
uniform float uDof; uniform float uVoid; uniform vec2 uFocus; uniform float uFocusR;
uniform float uFlash; uniform vec4 uBlade; uniform float uBladeK; uniform vec3 uTint; uniform float uTintK;
out vec4 o;
float h11(float n){ return fract(sin(n*127.1)*43758.5453); }
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*vn(p); p=p*2.03+vec2(17.3,9.1); a*=0.5; } return s; }
float luma(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
vec2 UV(vec2 p){ return vec2(p.x/uRes.x, 1.0 - p.y/uRes.y); }   // p = pixels, origine en haut à gauche
void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);          // pixels, origine en haut à gauche
  vec2 uv = p / uRes;
  float asp = uRes.x / uRes.y;
  // --- déformation « drapeau » (impact héros) + chaleur (feu)
  vec2 d = vec2(0.0);
  if (uWarp > 0.001) { float fall = exp(-uWarpAge*2.6); d += vec2(sin(uv.y*4.5 + uWarpAge*14.0), cos(uv.x*3.6*asp + uWarpAge*11.0)) * 0.011 * uWarp * fall * (0.4 + 0.6*uv.y); }
  if (uFire > 0.001) { d += (vec2(fbm(uv*vec2(9.0,14.0) + vec2(0.0,-uT*1.2)), fbm(uv*vec2(11.0,13.0) + vec2(5.0,-uT*1.1))) - 0.5) * 0.012 * uFire; }
  vec2 tuv = uv + d;
  vec2 su = vec2(tuv.x, 1.0 - tuv.y);                                // coordonnées texture (la 1re ligne de l'image = haut)
  // --- couleur de base (+ aberration chromatique radiale)
  vec3 c;
  if (uAber > 0.001) { vec2 r = (uv - 0.5) * uAber * 0.012; c = vec3(texture(uS, su + vec2(r.x, -r.y)).r, texture(uS, su).g, texture(uS, su - vec2(r.x, -r.y)).b); } else c = texture(uS, su).rgb;
  // --- profondeur de champ (vide final) : flou progressif hors du plan de netteté
  if (uDof > 0.001) { float dist = length((p - uFocus)) / uFocusR; float lod = uDof * smoothstep(0.6, 2.2, dist) * 4.6; vec3 b = vec3(0.0); for (int i=0;i<8;i++){ float a = float(i)*0.785398; b += textureLod(uS, su + vec2(cos(a), sin(a))*(0.004+0.002*lod)*lod, lod).rgb; } c = mix(c, b/8.0, clamp(lod/1.6, 0.0, 1.0)); }
  // --- niveaux de gris
  if (uGray > 0.001) c = mix(c, vec3(luma(c)), uGray);
  // --- bloom (pyramide de mip, seuil doux) : l'éclat des cases / pièces qui brillent
  vec3 bl = vec3(0.0);
  for (int L = 2; L <= 6; L++) { float lod = float(L); vec2 ts = 1.0/uRes*exp2(lod); float w = 0.55 + 0.18*float(L-2);
    vec3 a = textureLod(uS, su + vec2( ts.x, 0.0), lod).rgb + textureLod(uS, su - vec2( ts.x, 0.0), lod).rgb + textureLod(uS, su + vec2(0.0, ts.y), lod).rgb + textureLod(uS, su - vec2(0.0, ts.y), lod).rgb + textureLod(uS, su, lod).rgb*2.0;
    a *= (1.0/6.0); bl += max(a - uBloomTh, 0.0) * w; }
  c += bl * uBloom * 1.05;
  // --- fumée turbulente (traînée de la pièce héros)
  if (uSmoke > 0.001) {
    vec2 a = uSmokeP.xy, b = uSmokeP.zw; vec2 ab = b - a; float L = length(ab); vec2 dir = ab / max(L, 1.0); vec2 ap = p - a;
    float s = clamp(dot(ap, dir)/max(L,1.0), 0.0, 1.0), lat = dot(ap, vec2(-dir.y, dir.x)); float w = uSmokeQ.z, age = uSmokeQ.x, head = clamp(age/0.14, 0.0, 1.0);
    float n = fbm(vec2(s*5.5 - uT*1.8 + uSmokeQ.w, lat/w*0.8 + uSmokeQ.w*3.0)), n2 = fbm(vec2(s*11.0 - uT*2.7, lat/w*1.6 + 7.0));
    float wid = w * (0.30 + 1.05*(1.0 - s)) * (0.65 + 0.9*n), core = smoothstep(wid, 0.0, abs(lat + (n-0.5)*w*1.4));
    float along = smoothstep(0.0, 0.1, s) * (1.0 - step(head, s)*1.0) * (1.0 - smoothstep(0.55, 1.0, 1.0 - s) * 0.0);
    float tailFade = smoothstep(0.0, 0.55, 1.0 - s);                  // s=1 : tête de la traînée (la plus dense), s=0 : queue
    float life = 1.0 - smoothstep(0.35, 1.25, age);
    float sm = core * (0.55 + 0.7*n2) * (0.25 + 0.75*s) * along * life * uSmoke;
    c += uSmokeCol * sm * 1.35 + vec3(0.7,1.0,1.0) * pow(core, 3.0) * sm * 0.6;
  }
  // --- feu : bords des cases claires en flammes, chaleur orange, braises qui montent
  if (uFire > 0.001) {
    float Lb = luma(textureLod(uS, su, 3.0).rgb), Lc = luma(textureLod(uS, su, 5.0).rgb), rim = clamp((Lb - Lc)*4.0 + (smoothstep(0.08, 0.45, Lb) - smoothstep(0.45, 0.9, Lb))*0.9, 0.0, 1.0);
    float fn = fbm(uv*vec2(7.0,12.0) + vec2(0.0, -uT*1.6)), fl = clamp(rim*(0.4+1.3*fn) + smoothstep(0.55,1.0,Lc)*0.25*fn, 0.0, 1.5);
    vec3 fc = mix(vec3(1.0,0.28,0.02), vec3(1.0,0.82,0.3), clamp(fl-0.4, 0.0, 1.0));
    c = mix(c, c*vec3(1.25,0.72,0.38), 0.55*uFire);
    c += fc * fl * uFire * 1.15;
    for (int k = 0; k < 3; k++) { float fk = float(k); vec2 g = vec2(uv.x*(34.0+fk*17.0), uv.y*(60.0+fk*25.0) + uT*(1.7+fk*0.9)); vec2 ci = floor(g), cf = fract(g) - 0.5; float hh = h21(ci + fk*9.0); vec2 off = vec2(sin(uT*2.0 + hh*6.28)*0.25, 0.0); float dd = length(cf - off); float em = smoothstep(0.1, 0.0, dd) * step(0.82, hh) * (0.5+0.5*sin(uT*7.0+hh*20.0)); c += vec3(1.0,0.55,0.12) * em * uFire * 1.4; }
  }
  // --- étalonnage couleur (teinte) + assombrissement avec projecteur sur la pièce héros
  c = mix(c, c * uTint, uTintK);
  if (uDim > 0.001) { float r = length(p - uSpot) / max(uSpotR, 1.0); float lit = 1.0 - smoothstep(0.4, 1.25, r); float k = mix(1.0 - 0.8*uDim, 1.0, lit); c *= k; c += vec3(0.0, 0.02, 0.05) * uDim * (1.0 - lit); }
  // --- vide final : tout part dans le noir sauf la pièce
  if (uVoid > 0.001) { float r = length(p - uFocus) / max(uFocusR, 1.0); c *= 1.0 - uVoid * smoothstep(0.5, 1.9, r); }
  // --- lame de lumière (coupure finale)
  if (uBladeK > 0.001) { vec2 a = uBlade.xy, b = uBlade.zw; vec2 ab = b - a, ap = p - a; float s = clamp(dot(ap, ab)/dot(ab, ab), 0.0, 1.0); float dd = length(ap - ab*s); c += vec3(1.0,0.94,0.8) * (exp(-dd/3.5) + 0.35*exp(-dd/22.0)) * uBladeK; }
  c += vec3(uFlash);
  // épaule douce au-dessus de 0,85 (le bloom ne « brûle » pas en blanc plat)
  c = mix(c, vec3(0.85) + (1.0 - exp(-(max(c, 0.85) - 0.85)*5.0))*0.15, step(0.85, c));
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
  const NAMES = ["uS", "uRes", "uT", "uDim", "uSpot", "uSpotR", "uWarp", "uWarpAge", "uBloom", "uBloomTh", "uSmoke", "uSmokeP", "uSmokeQ", "uSmokeCol", "uFire", "uGray", "uAber", "uDof", "uVoid", "uFocus", "uFocusR", "uFlash", "uBlade", "uBladeK", "uTint", "uTintK"];

  class PostFX {
    constructor(W, H) {
      this.W = W; this.H = H; this.ok = false;
      try {
        const cv = (this.cv = document.createElement("canvas")); cv.width = W; cv.height = H;
        const gl = (this.gl = cv.getContext("webgl2", { alpha: false, antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false })); if (!gl) return;
        const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
        const pr = (this.prog = gl.createProgram()); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
        gl.useProgram(pr); this.u = {}; NAMES.forEach((n) => { this.u[n] = gl.getUniformLocation(pr, n); });
        const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); const loc = gl.getAttribLocation(pr, "aP"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.viewport(0, 0, W, H); this.ok = true;
      } catch (e) { this.ok = false; this.err = String((e && e.message) || e); }
    }
    /** src : canvas 2D (le monde) ; v : pistes (voir fxTracks) -> résultat dans this.cv */
    render(src, T, v) {
      const gl = this.gl, u = this.u; gl.useProgram(this.prog); gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); gl.generateMipmap(gl.TEXTURE_2D);
      gl.uniform1i(u.uS, 0); gl.uniform2f(u.uRes, this.W, this.H); gl.uniform1f(u.uT, T);
      gl.uniform1f(u.uDim, v.dim); gl.uniform2f(u.uSpot, v.spot[0], v.spot[1]); gl.uniform1f(u.uSpotR, v.spotR); gl.uniform1f(u.uWarp, v.warp); gl.uniform1f(u.uWarpAge, v.warpAge);
      gl.uniform1f(u.uBloom, v.bloom); gl.uniform1f(u.uBloomTh, v.bloomTh); gl.uniform1f(u.uSmoke, v.smoke); gl.uniform4f(u.uSmokeP, ...v.smokeP); gl.uniform4f(u.uSmokeQ, ...v.smokeQ); gl.uniform3f(u.uSmokeCol, ...v.smokeCol);
      gl.uniform1f(u.uFire, v.fire); gl.uniform1f(u.uGray, v.gray); gl.uniform1f(u.uAber, v.aber); gl.uniform1f(u.uDof, v.dof); gl.uniform1f(u.uVoid, v.voidK); gl.uniform2f(u.uFocus, v.focus[0], v.focus[1]); gl.uniform1f(u.uFocusR, v.focusR);
      gl.uniform1f(u.uFlash, v.flash); gl.uniform4f(u.uBlade, ...v.blade); gl.uniform1f(u.uBladeK, v.bladeK); gl.uniform3f(u.uTint, ...v.tint); gl.uniform1f(u.uTintK, v.tintK);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }
  RR.PostFX = PostFX;

  // ------------------------------------------------------------------ PISTES : la timeline -> uniformes (fonction pure de t)
  const P = RR.Renderer.prototype, smooth = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  P.fxTracks = function (t) {
    const { W, H } = this, k = this.k(), flip = this.flipAt(t), S = this._S || 1.15, cell = this.cell * S, scr = (name) => (this._toScreen ? this._toScreen(this.sq(name, flip)) : { x: W / 2, y: H / 2 });
    const v = { dim: 0, spot: [W / 2, H / 2], spotR: cell * 1.3, warp: 0, warpAge: 0, bloom: 0.34, bloomTh: 0.7, smoke: 0, smokeP: [0, 0, 1, 1], smokeQ: [0, 0, 1, 0], smokeCol: [0.1, 0.85, 0.9], fire: 0, gray: 0, aber: 0, dof: 0, voidK: 0, focus: [W / 2, H / 2], focusR: W * 0.3, flash: 0, blade: [0, 0, 1, 1], bladeK: 0, tint: [1, 1, 1], tintK: 0 };
    let dimBest = 0;
    for (const e of this.imp) {
      if (e.cheat === "twist") continue; const age = t - e.impact;
      if (e.bigMove && !e.soft) {                                                                         // COUP BRILLANT : halo qui monte (anticipation) → IMPACT → fumée, drapeau, nuit + projecteur, lumière qui revient en 3 s
        const pre = clamp((t - (e.impact - 0.6)) / 0.6, 0, 1);
        if (age > -0.6 && age < 0) v.bloom = Math.max(v.bloom, 0.34 + 0.65 * EASE.out3(pre));
        if (age >= 0 && age < 4.2) {
          const dimK = smooth(0, 0.14, age) * (1 - smooth(0.9, 3.6, age)); if (dimK > dimBest) { dimBest = dimK; const P1 = scr(e.to); v.spot = [P1.x, P1.y]; v.spotR = cell * 0.95; }
          v.bloom = Math.max(v.bloom, 0.34 + 0.75 * Math.exp(-age * 0.7)); v.warp = Math.max(v.warp, Math.exp(-age * 2.0)); v.warpAge = age; v.aber = Math.max(v.aber, 1.6 * Math.exp(-age * 9));
        }
        if (age > -0.04 && age < 1.5 && e.from) { const A = scr(e.from), B = scr(e.to), dx = A.x - B.x, dy = A.y - B.y; v.smoke = 1; v.smokeP = [B.x + dx * 2.1, B.y + dy * 2.1, B.x, B.y]; v.smokeQ = [Math.max(0, age + 0.04), 0, cell * 0.5, (e.n || 1) * 0.37]; v.smokeCol = [0.08, 0.86, 0.95]; }
      } else if (e.blunderHold && !e.soft) {                                                              // GAFFE : le monde se fige et se désature, projecteur sur la case, puis revient
        if (age >= 0 && age < 2.6) { const dk = smooth(0, 0.12, age) * (1 - smooth(1.2, 2.5, age)); if (dk * 0.8 > dimBest) { dimBest = dk * 0.8; const P1 = scr(e.to); v.spot = [P1.x, P1.y]; v.spotR = cell * 1.5; } v.gray = Math.max(v.gray, 0.85 * dk); v.warp = Math.max(v.warp, 0.55 * Math.exp(-age * 2.6)); v.warpAge = age; v.aber = Math.max(v.aber, 1.2 * Math.exp(-age * 8)); }
      } else if (!e.soft && e.kind !== "ff" && !e.minor && age >= 0 && age < 0.7) {                      // coups forts : léger éclat + onde
        v.bloom = Math.max(v.bloom, 0.34 + 0.3 * Math.exp(-age * 6)); v.aber = Math.max(v.aber, 0.6 * Math.exp(-age * 14)); if (e.kind === "drop") v.warp = Math.max(v.warp, 0.5 * Math.exp(-age * 5)), v.warpAge = age;
      }
    }
    v.dim = dimBest;
    // FINALE : le mat. Plateau en feu (braises, bords qui brûlent, teinte orange) puis VIDE : la pièce flotte floue dans le noir, lame de lumière.
    const o = this.outro;
    if (o && !o.defeat) {
      const last = this.mv[this.mv.length - 1], to = last ? scr(last.to) : { x: W / 2, y: H / 2 }, u0 = t - (o.t - 1.6), fireK = smooth(0, 0.9, u0) * (1 - smooth(1.6, 2.4, t - o.t));
      if (last && o.winner && o.winner.mate) { v.fire = Math.max(v.fire, fireK); v.tint = [1.12, 0.82, 0.55]; v.tintK = Math.max(v.tintK, 0.55 * fireK); v.bloom = Math.max(v.bloom, 0.34 + 0.55 * fireK); }
      const vk = smooth(0.1, 1.4, t - o.t - 0.9);                                                           // vide
      if (vk > 0 && last && o.winner) { v.voidK = vk; v.dof = vk; v.focus = [to.x, to.y]; v.focusR = cell * 1.6; v.bloom = Math.max(v.bloom, 0.5 * vk); v.tintK = Math.max(v.tintK, 0.45 * vk); v.tint = [1.2, 0.8, 0.5];
        const bk = clamp((t - o.t - 1.6) / 0.35, 0, 1) * (1 - clamp((t - o.t - 1.95) / 0.5, 0, 1)); if (bk > 0) { const sl = lerp(-W * 0.2, W * 1.2, clamp((t - o.t - 1.6) / 0.5, 0, 1)); v.blade = [sl - W * 0.5, to.y - H * 0.3, sl + W * 0.5, to.y + H * 0.3]; v.bladeK = bk * 1.1; } }
    }
    // intro : fondu depuis le noir (0 → 1 en 0,7 s) sur la 1re image du plateau
    if (this.introEnd && t >= this.introEnd && t < this.introEnd + 0.7) v.flash = -0.0;
    return v;
  };
  P.glPost = function (t) {
    if (this.noFx) return;
    if (this._post === undefined) { this._post = null; try { const g = new PostFX(this.W, this.H); if (g.ok) this._post = g; else this._glErr = g.err; } catch (e) { this._glErr = String(e); } }
    if (!this._post) return;
    try {
      const v = this.fxTracks(t); this._post.render(this.cv, t, v);
      const c = this.ctx; c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = "copy"; c.drawImage(this._post.cv, 0, 0); c.restore();
    } catch (e) { this._glErr = String((e && e.stack) || e).slice(0, 300); this._post = null; }                       // jamais de plantage du rendu : on retombe sur l'image 2D d'origine
  };
})();
