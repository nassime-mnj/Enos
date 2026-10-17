"use strict";
// SÉCURITÉ côté interface : chargé AVANT tout le reste.
//  - clé d'API : pont natif pywebview (PC), pont de l'APK (collée une fois dans ses réglages) ou page distante déjà authentifiée ;
//  - ajoute `Authorization: Bearer <clé>` à TOUTE requête /api/* (fetch et XMLHttpRequest) ;
//  - tickets courts pour <img>/<audio> (pas d'en-tête possible) ;
//  - AES-256-GCM sur les échanges si l'appareil possède la clé de chiffrement (APK appairée) ;
//  - alerte rouge plein écran en cas de rafale de requêtes / force brute.
(() => {
  const origFetch = window.fetch.bind(window);
  const XP = XMLHttpRequest.prototype, xOpen = XP.open, xSend = XP.send, xSet = XP.setRequestHeader;
  const hostLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const te = new TextEncoder(), td = new TextDecoder();
  const S = { api: "", env: null, file: null, skew: 0, ticket: null, ready: false };
  const NOAUTH = /^\/api\/(ping|app\/version)$/;
  const TICKET = /^\/api\/(voice|tts|screen|chill\/file)/;
  const ENC_UPLOADS = new Set(["/api/sync/upload", "/api/compress/upload"]);
  const CH = 1 << 20;

  // ---------------------------------------------------------------- utilitaires
  const b64u = (buf) => { const a = new Uint8Array(buf); let s = ""; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
  const canCrypto = () => !!(window.crypto && crypto.subtle);
  const encActive = () => !!S.env && (!hostLocal || window.__NASKO_ENC_FORCE === true);

  async function hmacKey(raw, label) {
    const k = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const d = await crypto.subtle.sign("HMAC", k, te.encode(label));
    return crypto.subtle.importKey("raw", d, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  async function setToken(tok) {
    tok = String(tok || "").trim();
    S.api = ""; S.env = S.file = null;
    if (!tok) return;
    const p = tok.split(".");
    if (p[0] === "NK1" && p.length >= 2) {
      S.api = p[1];
      if (p[2] && canCrypto()) {                                  // jeton complet : la clé de chiffrement ne quitte jamais l'appareil
        const raw = unb64u(p[2]);
        S.env = await hmacKey(raw, "nasko-env-v1"); S.file = await hmacKey(raw, "nasko-file-v1");
      }
    } else S.api = tok;
  }

  // ---------------------------------------------------------------- acquisition de la clé
  function nativeKey() {
    return new Promise((res) => {
      const t0 = Date.now(), limit = window.pywebview ? 8000 : 1500;     // hors fenêtre native : on n'attend presque pas
      let done = false;
      const fin = (v) => { if (!done) { done = true; res(v); } };
      const tryNow = async () => {
        if (done) return;
        const api = window.pywebview && window.pywebview.api;
        if (api && typeof api.get_key === "function") { try { return fin(await api.get_key()); } catch (e) {} }
        if (Date.now() - t0 > limit) return fin(null);
        setTimeout(tryNow, 60);
      };
      window.addEventListener("pywebviewready", tryNow);
      tryNow();
    });
  }

  async function acquire() {
    let tok = window.__NASKO_KEY || "";
    if (!tok && window.NaskoApp && typeof window.NaskoApp.apiKey === "function") { try { tok = window.NaskoApp.apiKey() || ""; } catch (e) {} }
    if (!tok) { const m = document.querySelector('meta[name="nasko-key"]'); tok = (m && m.content) || ""; }
    if (!tok) tok = (await nativeKey()) || "";
    await setToken(tok);
    S.ready = true;
    return !!S.api;
  }
  let ready = acquire();

  // ---------------------------------------------------------------- identité de l'appareil (Eto / Eto Dev)
  // UUID stable : celui de l'APK (SharedPreferences) ou, dans un navigateur, un identifiant mémorisé. Le PC décide s'il est « de confiance ».
  const deviceId = () => {
    try { const a = window.NaskoApp && window.NaskoApp.deviceId && window.NaskoApp.deviceId(); if (a) return a; } catch (e) {}
    try {
      let d = localStorage.getItem("eto_device");
      if (!d) {
        d = (crypto.randomUUID && crypto.randomUUID()) || Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("");
        localStorage.setItem("eto_device", d);
      }
      return d;
    } catch (e) { return ""; }
  };

  // ---------------------------------------------------------------- horloge serveur (tolérance de l'anti-rejeu)
  const noteTime = (res) => { const t = +res.headers.get("X-Nasko-Time"); if (t) S.skew = t - Date.now(); };

  // ---------------------------------------------------------------- fetch
  window.fetch = async function (input, init) {
    init = init || {};
    let url;
    try { url = new URL(typeof input === "string" ? input : input.url || String(input), location.href); } catch (e) { return origFetch(input, init); }
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/") || NOAUTH.test(url.pathname)) return origFetch(input, init);
    await ready;
    const headers = new Headers(init.headers || {});
    if (S.api) headers.set("Authorization", "Bearer " + S.api);
    if (!hostLocal) { const d = deviceId(); if (d) headers.set("X-Eto-Device", d); }
    let body = init.body, encHeader = null;
    const method = (init.method || "GET").toUpperCase();
    if (encActive() && !TICKET.test(url.pathname) && !(body instanceof FormData)) {
      const ts = Date.now() + S.skew, nonce = crypto.getRandomValues(new Uint8Array(12));
      encHeader = ts + "." + b64u(nonce);
      headers.set("X-Nasko-Enc", encHeader);
      if (body != null && body !== "") {
        headers.set("X-Nasko-Enc-Ct", headers.get("Content-Type") || "application/json");
        headers.set("Content-Type", "application/octet-stream");
        const plain = typeof body === "string" ? te.encode(body) : new Uint8Array(await new Response(body).arrayBuffer());
        body = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: te.encode(`REQ|${ts}|${method}|${url.pathname}${url.search}`) }, S.env, plain);
      }
    }
    let res = await origFetch(url.toString(), { ...init, headers, body });
    noteTime(res);
    if (encHeader && res.status === 400 && !res.headers.get("X-Nasko-Enc") && !init._skewRetry) {          // horloge de l'appareil très décalée : on se recale sur l'heure du PC et on réessaie une fois
      try { const j = await res.clone().json(); if (/périmée/.test(j.detail || "")) return window.fetch(input, { ...init, _skewRetry: true }); } catch (e) {}
    }
    if (encHeader && res.headers.get("X-Nasko-Enc") === "1") {
      const buf = new Uint8Array(await res.arrayBuffer());
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12), additionalData: te.encode(`RES|${encHeader}|${res.status}`) }, S.env, buf.slice(12));
      return new Response(plain, { status: res.status, statusText: res.statusText, headers: { "Content-Type": res.headers.get("X-Nasko-Enc-Ct") || "application/json" } });
    }
    return res;
  };

  // ---------------------------------------------------------------- envois de fichiers chiffrés (blocs de 1 Mio, format NKE1)
  async function encryptBlob(file) {
    const prefix = crypto.getRandomValues(new Uint8Array(8)), head = new Uint8Array(12);
    head.set([0x4e, 0x4b, 0x45, 0x31]); head.set(prefix, 4);
    const parts = [head], n = file.size, total = Math.max(1, Math.ceil(n / CH));
    let batch = [];
    for (let i = 0; i < total; i++) {
      const plain = await file.slice(i * CH, Math.min(n, (i + 1) * CH)).arrayBuffer();
      const iv = new Uint8Array(12); iv.set(prefix); new DataView(iv.buffer).setUint32(8, i);
      const aad = new Uint8Array(6); aad[0] = 70; aad[1] = i === total - 1 ? 1 : 0; new DataView(aad.buffer).setUint32(2, i);
      batch.push(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, S.file, plain));
      if (batch.length >= 8) { parts.push(new Blob(batch)); batch = []; }        // la mémoire reste bornée : les blocs passent en Blob
    }
    if (batch.length) parts.push(new Blob(batch));
    return new Blob(parts, { type: "application/octet-stream" });
  }

  async function sealMeta(meta, route) {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: te.encode("META|" + route) }, S.env, te.encode(JSON.stringify(meta))));
    const out = new Uint8Array(12 + ct.length); out.set(nonce); out.set(ct, 12);
    return b64u(out);
  }

  async function encryptForm(fd, route) {
    const out = new FormData(), meta = { ts: Date.now() + S.skew };
    let file = null, field = "file";
    for (const [k, v] of fd.entries()) {
      if (v instanceof Blob) { file = v; field = k; meta.name = v.name || "fichier"; }
      else if (k === "mode" || k === "value") meta[k] = v;
      else out.append(k, v);
    }
    if (!file) return fd;
    out.append(field, await encryptBlob(file), "data.nke");
    out.append("enc", "1");
    out.append("meta", await sealMeta(meta, route));
    return out;
  }

  // ---------------------------------------------------------------- XMLHttpRequest (envois avec progression)
  XP.open = function (m, u) { this._nm = m; this._nu = u; return xOpen.apply(this, arguments); };
  XP.send = function (body) {
    let url;
    try { url = new URL(this._nu, location.href); } catch (e) { return xSend.call(this, body); }
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/") || NOAUTH.test(url.pathname)) return xSend.call(this, body);
    ready.then(async () => {
      if (S.api) xSet.call(this, "Authorization", "Bearer " + S.api);
      if (!hostLocal) { const d = deviceId(); if (d) xSet.call(this, "X-Eto-Device", d); }
      if (encActive() && body instanceof FormData && ENC_UPLOADS.has(url.pathname)) { try { body = await encryptForm(body, url.pathname); } catch (e) { console.warn("chiffrement impossible, envoi non chiffré", e); } }
      xSend.call(this, body);
    });
  };

  // ---------------------------------------------------------------- tickets <img>/<audio>
  async function ticketUrl(path) {
    const now = Date.now() / 1000 + S.skew / 1000;
    if (!S.ticket || S.ticket.exp - 60 < now) {
      const r = await window.fetch("/api/security/ticket");
      if (!r.ok) throw new Error("ticket refusé (" + r.status + ")");
      const j = await r.json();
      S.ticket = { t: j.ticket, exp: j.exp };
    }
    return path + (path.includes("?") ? "&" : "?") + "k=" + encodeURIComponent(S.ticket.t);
  }

  // ---------------------------------------------------------------- alerte rouge
  let lastAlert = 0, bar = null, dismissedT = 0;
  function banner(a) {
    if (a.t === dismissedT) return;                       // alerte déjà acquittée : on ne la réaffiche pas
    if (!bar) {
      const st = document.createElement("style");
      st.textContent = `#sec-alert{position:fixed;left:0;right:0;top:0;z-index:2147483000;display:flex;pointer-events:none;align-items:center;gap:14px;padding:12px 18px;padding-top:calc(12px + env(safe-area-inset-top,0px));
        background:linear-gradient(90deg,#7a0000,#ff1a1a 50%,#7a0000);color:#fff;font:700 14px Consolas,monospace;letter-spacing:1px;box-shadow:0 0 40px #ff0000;animation:secPulse 1s ease-in-out infinite}
        #sec-alert b{letter-spacing:3px}#sec-alert span{flex:1}#sec-alert button{pointer-events:auto;border:2px solid #fff;background:#0006;color:#fff;padding:6px 14px;font:700 12px Consolas,monospace;cursor:pointer}
        #sec-alert button:hover{background:#fff;color:#a00}
        #sec-alert[hidden],#sec-vig[hidden]{display:none!important}
        #sec-vig{position:fixed;inset:0;z-index:2147482999;pointer-events:none;box-shadow:inset 0 0 120px 30px #ff0000aa;animation:secPulse 1s ease-in-out infinite}
        @keyframes secPulse{50%{opacity:.55}}`;
      document.head.appendChild(st);
      bar = document.createElement("div"); bar.id = "sec-alert"; bar.setAttribute("role", "alert");
      bar.innerHTML = '<button type="button">COMPRIS</button><b>⚠ ALERTE SÉCURITÉ</b><span></span>';        // bouton à gauche : ne recouvre jamais les « FERMER » des panneaux
      bar.querySelector("button").onclick = () => { dismissedT = lastAlert; window.fetch("/api/security/dismiss", { method: "POST" }).catch(() => {}); hide(); };
      const v = document.createElement("div"); v.id = "sec-vig";
      document.body.append(v, bar);
    }
    const what = a.kind === "bruteforce" ? "Tentatives d'authentification en rafale" : "Rafale de requêtes (>50/s)";
    bar.querySelector("span").textContent = `${what} depuis ${a.ip || "?"} — connexion coupée${a.remaining ? " " + a.remaining + " s" : ""}. Un programme tente peut-être de scanner E.N.O.S.`;
    bar.hidden = false; document.getElementById("sec-vig").hidden = false;
    if (a.t !== lastAlert) { lastAlert = a.t; try { if (typeof sfx !== "undefined") sfx.err(); } catch (e) {} }
  }
  function hide() { if (bar) { bar.hidden = true; document.getElementById("sec-vig").hidden = true; } }

  async function poll() {
    if (document.visibilityState !== "visible" || !S.api) return;
    try {
      const r = await window.fetch("/api/security/status");
      if (!r.ok) return;
      const j = await r.json();
      j.alert && j.alert.live ? banner(j.alert) : hide();
    } catch (e) {}
  }
  ready.then(() => { poll(); setInterval(poll, 3000); });

  // ---------------------------------------------------------------- API publique
  window.naskoSec = {
    ready: () => ready,
    ticketUrl,
    deviceId,
    async wsUrl(path) {            // WebSocket : pas d'en-têtes possibles -> ticket court + identifiant d'appareil dans l'URL
      const u = new URL(await ticketUrl(path), location.href);
      if (!hostLocal) u.searchParams.set("d", deviceId());
      u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
      return u.toString();
    },
    hasKey: () => !!S.api,
    encActive,
    canEncrypt: () => !!S.env,
    async reload(token) { ready = token ? setToken(token).then(() => (S.ready = true)) : acquire(); S.ticket = null; await ready; return !!S.api; },
    banner, hide,
  };
})();
