"use strict";
// Façade du pont Android (`window.Enos`, classe LocalBridge.java). En navigateur de bureau (développement), un repli minimal permet de tester l'interface.
// Règle d'or : le JavaScript ne LIT jamais une clé d'API. Il demande à Java « appelle ce service » ; Java injecte la clé.
(() => {
  const E = window.ENOS;
  const B = window.Enos;
  const N = (E.native = { available: typeof B !== "undefined" });
  const calls = new Map();
  let seq = 1;

  // Java -> JS : événements d'un appel asynchrone (en-têtes, morceaux de réponse, fin, erreur) et changements de réseau
  N._cb = (id, evt, payload) => { const f = calls.get(id); if (f) f(evt, payload); };
  N._net = (online, transport) => E.emit("net", { online: !!online, transport: transport || "" });

  const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };

  // ------------------------------------------------------------------ coffre (Android Keystore AES-GCM)
  const devVault = () => parse(E.ls.get("enos.devvault"), {}) || {};                   // navigateur de bureau uniquement (NON sécurisé, développement)
  const devSave = (d) => E.ls.set("enos.devvault", JSON.stringify(d));
  N.vault = {
    has: (k) => (N.available ? !!B.vaultHas(k) : !!devVault()[k]),
    set: (k, v) => { if (N.available) return !!B.vaultSet(k, String(v)); const d = devVault(); d[k] = v; devSave(d); return true; },
    del: (k) => { if (N.available) return B.vaultDel(k); const d = devVault(); delete d[k]; devSave(d); return true; },
  };

  // ------------------------------------------------------------------ HTTP via Java (clés injectées côté Java, liste blanche de services)
  // providers : groq | eleven_enos | eleven_eto | zeus | moodle | pc
  // opts : {provider, path, method, headers, body, bin}. handlers : {head(status,ctype), chunk(text|Uint8Array), end(), error(msg)}
  N.request = (opts, h) => {
    const id = seq++;
    h = h || {};
    if (!N.available) { devRequest(opts, h); return { id, cancel() {} }; }
    const decode = opts.bin ? (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) : (t) => t;
    calls.set(id, (evt, p) => {
      if (evt === "head") { const j = parse(p, {}); if (h.head) h.head(j.status, j.ctype); }
      else if (evt === "chunk") { if (h.chunk) h.chunk(decode(p)); }
      else if (evt === "end") { calls.delete(id); if (h.end) h.end(); }
      else if (evt === "error") { calls.delete(id); if (h.error) h.error(String(p)); }
    });
    B.http(id, JSON.stringify({ provider: opts.provider, path: opts.path || "/", method: opts.method || "GET", headers: opts.headers || {}, body: opts.body == null ? "" : String(opts.body), bin: !!opts.bin }));
    return { id, cancel() { B.cancel(id); calls.delete(id); } };
  };
  // Promesses : {status, text, json()} | {status, bytes, ctype}
  N.fetch = (opts) => new Promise((res, rej) => {
    let status = 0, ctype = "", size = 0;
    const parts = [];
    N.request(opts, {
      head: (s, c) => { status = s; ctype = c || ""; },
      chunk: (c) => { parts.push(c); size += c.length; },
      end: () => {
        if (opts.bin) { const out = new Uint8Array(size); let o = 0; parts.forEach((p) => { out.set(p, o); o += p.length; }); res({ status, ctype, bytes: out }); }
        else { const text = parts.join(""); res({ status, ctype, text, json: () => parse(text, null) }); }
      },
      error: (m) => rej(new Error(m)),
    });
  });

  // ------------------------------------------------------------------ PC (TLS épinglé, jeton Bearer, identifiant d'appareil : tout côté Java)
  function oneShot(kind, start) {
    return new Promise((res) => {
      if (!N.available) return res(kind === "probe" ? { ok: false } : { error: "pont natif absent" });
      const id = seq++;
      calls.set(id, (evt, p) => { calls.delete(id); res(parse(p, {})); });
      start(id);
      return undefined;
    });
  }
  N.pc = {
    config: () => (N.available ? parse(B.pcConfig(), {}) : { addrs: E.settings.get("pcAddrs", ""), pinned: false, paired: false }),
    setAddrs: (s) => (N.available ? B.pcSetAddrs(String(s)) : E.settings.set("pcAddrs", s)),
    fingerprint: (addr) => oneShot("fp", (id) => B.pcFingerprint(id, addr)),
    pin: (addr, fp) => (N.available ? B.pcPin(addr, fp) : true),
    probe: (timeoutMs) => oneShot("probe", (id) => B.pcProbe(id, timeoutMs || 1500)),
    clear: () => { if (N.available) B.pcClear(); },
  };

  // ------------------------------------------------------------------ fichiers
  N.files = {
    pickTree: () => oneShot("tree", (id) => B.treePick(id)),
    list: (uri, docId) => (N.available ? parse(B.treeList(uri, docId || ""), []) : []),
    op: (op, args) => (N.available ? parse(B.treeOp(op, JSON.stringify(args)), { ok: false }) : { ok: false, error: "pont natif absent" }),
    // collection : "images" -> Pictures/ENOS, "downloads" -> Download/ENOS
    save: (name, mime, bytes, collection) => {
      if (!N.available) return Promise.resolve(false);
      let bin = "";
      const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      return Promise.resolve(!!B.saveMedia(name, mime, btoa(bin), collection || "downloads"));
    },
  };

  // ------------------------------------------------------------------ import de la configuration du PC (fichier chiffré ; le code est vérifié par Java)
  N.pendingImport = () => (N.available ? B.pendingImport() : "");
  N.importApply = (blob, code) => oneShot("import", (id) => B.importApply(id, blob || "", code || ""));

  // ------------------------------------------------------------------ divers
  N.deviceId = () => (N.available ? B.deviceId() : "dev-browser");
  N.version = () => (N.available ? B.version() : "dev");
  N.openPcUi = () => { if (N.available) B.openPcUi(); };
  N.openPcModule = (id) => { if (N.available) B.openPcModule(String(id)); else U_dev(id); };
  function U_dev(id) { if (E.ui) E.ui.toast("Ouvre « " + id + " » : disponible dans l'application Android.", "warn"); }
  N.wake = () => { if (N.available) B.wake(); };

  // ------------------------------------------------------------------ repli navigateur de bureau (développement) : fetch direct, coffre factice
  function devRequest(o, h) {
    const bases = { groq: "https://api.groq.com", eleven_enos: "https://api.elevenlabs.io", eleven_eto: "https://api.elevenlabs.io" };
    const key = (n) => devVault()[n] || "";
    if (o.provider === "cloud" || o.provider === "cloud_refresh" || o.provider === "cloud_logout") return devCloud(o, h);
    if (!bases[o.provider]) { setTimeout(() => { if (h.error) h.error("service indisponible hors de l'application"); }, 0); return; }
    const headers = Object.assign({ "Content-Type": "application/json" }, o.headers || {});
    if (o.provider === "groq") headers.Authorization = "Bearer " + key("groq");
    else headers["xi-api-key"] = key(o.provider);
    fetch(bases[o.provider] + o.path, { method: o.method || "GET", headers, body: o.body || undefined }).then(async (r) => {
      if (h.head) h.head(r.status, r.headers.get("content-type") || "");
      const rd = r.body.getReader(), dec = new TextDecoder();
      for (;;) { const { done, value } = await rd.read(); if (done) break; if (h.chunk) h.chunk(o.bin ? value : dec.decode(value, { stream: true })); }
      if (h.end) h.end();
    }).catch((e) => { if (h.error) h.error(e.message); });
  }

  // Service cloud (Dual Pulse) en navigateur de bureau : mêmes règles que NativeHttp.java (adresse du coffre, jeton injecté, jamais renvoyé au JS) — développement et tests.
  async function devCloud(o, h) {
    const v = devVault(), base = (v.cloud_url || "").replace(/\/$/, "");
    const done = (status, body) => { if (h.head) h.head(status, "application/json"); if (h.chunk) h.chunk(typeof body === "string" ? body : JSON.stringify(body)); if (h.end) h.end(); };
    try {
      if (!/^https?:\/\//.test(base)) throw new Error("serveur cloud non configuré");
      if (o.provider === "cloud_logout") { delete v.cloud_access; delete v.cloud_refresh; delete v.cloud_update_base; devSave(v); return done(200, { ok: true }); }
      if (o.provider === "cloud_refresh") {
        if (!v.cloud_refresh) throw new Error("session cloud absente");
        const r = await fetch(base + "/launcher/v1/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: v.cloud_refresh }) });
        if (!r.ok) { if (r.status === 401) { delete v.cloud_access; delete v.cloud_refresh; devSave(v); } throw new Error("session cloud refusée (" + r.status + ")"); }
        const j = await r.json(); v.cloud_access = j.access_token; v.cloud_refresh = j.refresh_token; devSave(v);
        return done(200, { user: j.user, role: j.role });
      }
      if (!/^\/launcher\/v1\//.test(o.path)) throw new Error("chemin refusé");
      const headers = Object.assign({}, o.headers || {});
      if (v.cloud_access) headers.Authorization = "Bearer " + v.cloud_access;
      const r = await fetch(base + o.path, { method: o.method || "GET", headers, body: o.body || undefined, redirect: "manual" });
      done(r.status, await r.text());
    } catch (e) { if (h.error) h.error(e.message); }
  }
})();
